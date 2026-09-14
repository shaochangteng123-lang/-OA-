import path from "node:path";

import { nanoid } from "nanoid";
import type { PoolClient } from "pg";

import {
  SECOND_HISTORICAL_IMPORT_BATCH_KEY,
  SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
} from "./second-historical-import-config.js";
import {
  rebuildContractFinancialRegistrationMatches,
  type ContractRow,
} from "../services/contractService.js";

interface FinancialRecordRow {
  id: string;
  financial_ocr_job_id: string;
  amount: number;
}

interface RegistrationRow {
  id: string;
  settlement_kind: "receipt" | "payment";
  status: "draft" | "confirmed" | "reversed";
}

export interface SecondHistoricalFinancialRepairResult {
  rootId: string;
  registrationId?: string;
  invoiceCount?: number;
  settlementCount?: number;
  invoiceAmount?: number;
  settlementAmount?: number;
  allocatedAmount?: number;
  status?: "confirmed" | "draft";
  skipped?: boolean;
  reason?: string;
}

function stableDirection(contract: ContractRow): "income" | "cost" {
  if (
    contract.financial_direction === "income" ||
    contract.financial_direction === "cost"
  ) {
    return contract.financial_direction;
  }
  throw new Error(`合同缺少财务方向：${contract.id}`);
}

async function activeRegistration(
  client: PoolClient,
  rootId: string,
): Promise<RegistrationRow | null> {
  const result = await client.query<RegistrationRow>(
    `SELECT registration.id,registration.settlement_kind,registration.status
     FROM contract_financial_registrations registration
     WHERE registration.status<>'reversed'
       AND registration.contract_id=$1
     ORDER BY registration.created_at,registration.id
     FOR UPDATE OF registration`,
    [rootId],
  );
  if (result.rows.length > 1) {
    throw new Error(`合同存在多个未冲正财务登记，拒绝自动合并：${rootId}`);
  }
  return result.rows[0] || null;
}

async function financialRows(
  client: PoolClient,
  rootId: string,
  table: "contract_invoices" | "contract_receipts" | "contract_payments",
  allowedFileIds: readonly string[],
): Promise<FinancialRecordRow[]> {
  if (!allowedFileIds.length) return [];
  const result = await client.query<FinancialRecordRow>(
    `SELECT record.id,record.financial_ocr_job_id,record.amount
     FROM ${table} record
     JOIN contracts owner ON owner.id=record.contract_id
     WHERE COALESCE(owner.root_contract_id,owner.id)=$1
       AND owner.is_deleted=FALSE AND owner.status<>'rejected'
       AND record.status='confirmed'
       AND record.file_id=ANY($2::text[])
     ORDER BY record.created_at,record.id
     FOR UPDATE OF record`,
    [rootId, allowedFileIds],
  );
  for (const row of result.rows) {
    if (!row.financial_ocr_job_id) {
      throw new Error(`历史财务记录缺少识别任务：${table}.${row.id}`);
    }
  }
  return result.rows;
}

async function batchFinancialFileIds(
  client: PoolClient,
  rootId: string,
): Promise<string[]> {
  const result = await client.query<{ contract_file_id: string }>(
    `SELECT contract_file_id
       FROM contract_historical_import_files
      WHERE batch_key=$1 AND contract_id=$2 AND accounting_included=TRUE
        AND contract_file_id IS NOT NULL
      ORDER BY source_path`,
    [SECOND_HISTORICAL_IMPORT_BATCH_KEY, rootId],
  );
  return [...new Set(result.rows.map((row) => row.contract_file_id))];
}

async function completedRepairMarker(
  client: PoolClient,
  rootId: string,
): Promise<{
  registrationId: string | null;
  status: "confirmed" | "draft";
} | null> {
  const result = await client.query<{ changes_json: Record<string, unknown> }>(
    `SELECT changes_json FROM contract_audit_logs
      WHERE contract_id=$1 AND action='historical_financial_links_rebuilt'
        AND changes_json->>'batchKey'=$2
      ORDER BY created_at,id LIMIT 2`,
    [rootId, SECOND_HISTORICAL_IMPORT_BATCH_KEY],
  );
  if (result.rows.length > 1) {
    throw new Error(`第二批财务关系存在重复完成标记：${rootId}`);
  }
  const marker = result.rows[0]?.changes_json;
  if (!marker) return null;
  return {
    registrationId: String(marker.registrationId || "") || null,
    status: marker.closed === true ? "confirmed" : "draft",
  };
}

async function assertRegistrationScope(
  client: PoolClient,
  registrationId: string,
  allowedRecords: readonly {
    id: string;
    itemKind: "invoice" | "receipt" | "payment";
  }[],
): Promise<void> {
  const expected = new Set(
    allowedRecords.map((row) => `${row.itemKind}:${row.id}`),
  );
  const existing = await client.query<{ item_kind: string; record_id: string }>(
    `SELECT item_kind,record_id
       FROM contract_financial_registration_items
      WHERE registration_id=$1
      ORDER BY item_kind,record_id`,
    [registrationId],
  );
  if (
    existing.rows.some(
      (row) => !expected.has(`${row.item_kind}:${row.record_id}`),
    )
  ) {
    throw new Error(
      `财务登记包含第二批范围外记录，拒绝重建：${registrationId}`,
    );
  }
}

async function ensureRegistrationItem(
  client: PoolClient,
  input: {
    registrationId: string;
    contractId: string;
    itemKind: "invoice" | "receipt" | "payment";
    row: FinancialRecordRow;
    now: string;
    id: string;
  },
): Promise<void> {
  const existing = await client.query<{
    id: string;
    registration_id: string;
    item_kind: string;
  }>(
    `SELECT id,registration_id,item_kind
     FROM contract_financial_registration_items
     WHERE record_id=$1 OR ocr_job_id=$2
     LIMIT 1`,
    [input.row.id, input.row.financial_ocr_job_id],
  );
  if (existing.rows[0]) {
    if (
      existing.rows[0].registration_id !== input.registrationId ||
      existing.rows[0].item_kind !== input.itemKind
    ) {
      throw new Error(
        `财务记录已属于其他登记：${input.itemKind}.${input.row.id}`,
      );
    }
    return;
  }
  await client.query(
    `INSERT INTO contract_financial_registration_items(
       id,registration_id,contract_id,item_kind,ocr_job_id,record_id,
       business_key_hash,created_at
     ) VALUES($1,$2,$3,$4,$5,$6,NULL,$7)`,
    [
      input.id,
      input.registrationId,
      input.contractId,
      input.itemKind,
      input.row.financial_ocr_job_id,
      input.row.id,
      input.now,
    ],
  );
}

export async function repairSecondHistoricalFinancialRoot(
  client: PoolClient,
  rootId: string,
  actor: { id: string; role: string },
  now: string,
  options: {
    allowedFinancialFileIds?: readonly string[];
    idFactory?: (scope: string, key: string) => string;
  } = {},
): Promise<SecondHistoricalFinancialRepairResult> {
  const batchMembership = await client.query<{ id: string }>(
    `SELECT id FROM contract_audit_logs
      WHERE contract_id=$1 AND action='historical_contract_imported'
        AND changes_json->>'batchKey'=$2
      ORDER BY created_at,id LIMIT 2`,
    [rootId, SECOND_HISTORICAL_IMPORT_BATCH_KEY],
  );
  if (batchMembership.rows.length !== 1) {
    throw new Error(`合同不属于唯一的第二批主合同范围：${rootId}`);
  }
  const contractResult = await client.query<ContractRow>(
    `SELECT * FROM contracts WHERE id=$1 AND relation_type='main'
       AND root_contract_id=id AND is_deleted=FALSE FOR UPDATE`,
    [rootId],
  );
  const contract = contractResult.rows[0];
  if (!contract) throw new Error(`第二批主合同不存在：${rootId}`);
  const completedMarker = await completedRepairMarker(client, rootId);
  if (completedMarker) {
    return {
      rootId,
      registrationId: completedMarker.registrationId || undefined,
      status: completedMarker.status,
      skipped: true,
      reason: "第二批财务关系已经重建",
    };
  }
  const direction = stableDirection(contract);
  const settlementKind = direction === "income" ? "receipt" : "payment";
  const allowedFileIds = [
    ...new Set(
      options.allowedFinancialFileIds ||
        (await batchFinancialFileIds(client, rootId)),
    ),
  ];
  const [invoices, settlements] = await Promise.all([
    financialRows(client, rootId, "contract_invoices", allowedFileIds),
    financialRows(
      client,
      rootId,
      settlementKind === "receipt" ? "contract_receipts" : "contract_payments",
      allowedFileIds,
    ),
  ]);
  if (invoices.length + settlements.length !== allowedFileIds.length) {
    throw new Error(`第二批财务文件与正式记录未一一对应：${rootId}`);
  }
  if (!invoices.length && !settlements.length) {
    return { rootId, skipped: true, reason: "没有财务记录" };
  }
  if (!invoices.length) {
    throw new Error(`第二批合同有回款或付款但没有发票，需单独复核：${rootId}`);
  }
  let registration = await activeRegistration(client, rootId);
  if (registration && registration.settlement_kind !== settlementKind) {
    throw new Error(`财务登记收支方向与合同不一致：${registration.id}`);
  }
  if (registration) {
    const allowedRecords: Array<{
      id: string;
      itemKind: "invoice" | "receipt" | "payment";
    }> = [
      ...invoices.map((row) => ({ ...row, itemKind: "invoice" as const })),
      ...settlements.map((row) => ({
        ...row,
        itemKind: settlementKind as "receipt" | "payment",
      })),
    ];
    await assertRegistrationScope(client, registration.id, allowedRecords);
  }
  if (!registration) {
    registration = {
      id: options.idFactory?.("financial-registration", rootId) || nanoid(),
      settlement_kind: settlementKind,
      status: "draft",
    };
    await client.query(
      `INSERT INTO contract_financial_registrations(
         id,contract_id,settlement_kind,financial_direction,
         direction_invoice_record_id,status,created_by,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$7)`,
      [
        registration.id,
        rootId,
        settlementKind,
        direction,
        invoices[0]!.id,
        actor.id,
        now,
      ],
    );
  } else {
    await client.query(
      `UPDATE contract_financial_registrations SET financial_direction=$2,
         direction_invoice_record_id=$3,updated_at=$4
       WHERE id=$1`,
      [registration.id, direction, invoices[0]!.id, now],
    );
  }
  for (const invoice of invoices) {
    await ensureRegistrationItem(client, {
      registrationId: registration.id,
      contractId: rootId,
      itemKind: "invoice",
      row: invoice,
      now,
      id:
        options.idFactory?.(
          "financial-registration-item",
          `${rootId}:invoice:${invoice.id}`,
        ) || nanoid(),
    });
  }
  for (const settlement of settlements) {
    await ensureRegistrationItem(client, {
      registrationId: registration.id,
      contractId: rootId,
      itemKind: settlementKind,
      row: settlement,
      now,
      id:
        options.idFactory?.(
          "financial-registration-item",
          `${rootId}:${settlementKind}:${settlement.id}`,
        ) || nanoid(),
    });
  }
  const rebuilt = await rebuildContractFinancialRegistrationMatches(client, {
    registrationId: registration.id,
    contractId: rootId,
    settlementKind,
    now,
    matchIdFactory: options.idFactory
      ? ({ invoiceRecordId, settlementRecordId }) =>
          options.idFactory!(
            "financial-registration-match",
            `${rootId}:${invoiceRecordId}:${settlementRecordId}`,
          )
      : undefined,
  });
  const closed =
    rebuilt.invoiceTotalCents > 0 &&
    rebuilt.invoiceTotalCents === rebuilt.settlementTotalCents &&
    rebuilt.allocatedTotalCents === rebuilt.invoiceTotalCents;
  await client.query(
    `UPDATE contract_financial_registrations SET status=$2,
       confirmed_by=CASE WHEN $2='confirmed' THEN $3 ELSE NULL END,
       confirmed_at=CASE WHEN $2='confirmed' THEN $4 ELSE NULL END,
       reversed_by=NULL,reversed_at=NULL,reverse_reason=NULL,updated_at=$4
     WHERE id=$1`,
    [registration.id, closed ? "confirmed" : "draft", actor.id, now],
  );
  await client.query(
    `INSERT INTO contract_audit_logs(
       id,contract_id,action,actor_id,actor_role,from_status,to_status,
       changes_json,comment,created_at
     ) VALUES($1,$2,'historical_financial_links_rebuilt',$3,$4,$5,$6,
       $7::jsonb,$8,$9)`,
    [
      options.idFactory?.("financial-registration-audit", rootId) || nanoid(),
      rootId,
      actor.id,
      actor.role,
      registration.status,
      closed ? "confirmed" : "draft",
      JSON.stringify({
        batchKey: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
        registrationId: registration.id,
        invoiceCount: invoices.length,
        settlementCount: settlements.length,
        invoiceAmount: rebuilt.invoiceTotalCents / 100,
        settlementAmount: rebuilt.settlementTotalCents / 100,
        allocatedAmount: rebuilt.allocatedTotalCents / 100,
        closed,
      }),
      "第二批历史合同发票与回单／付款对应关系重建",
      now,
    ],
  );
  return {
    rootId,
    registrationId: registration.id,
    invoiceCount: invoices.length,
    settlementCount: settlements.length,
    invoiceAmount: rebuilt.invoiceTotalCents / 100,
    settlementAmount: rebuilt.settlementTotalCents / 100,
    allocatedAmount: rebuilt.allocatedTotalCents / 100,
    status: closed ? "confirmed" : "draft",
  };
}

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.VITE_ENABLE_WORKLOG !== "true" ||
    path.resolve(process.cwd()) !== "/app" ||
    /prod(?:uction)?/iu.test(process.env.DATABASE_URL || "")
  ) {
    throw new Error("第二批财务关系修复只允许在开发容器执行");
  }
  const { db, pool } = await import("../db/index.js");
  try {
    const result = await db.transaction(async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [
          `second-historical-contract-import:${SECOND_HISTORICAL_IMPORT_BATCH_KEY}`,
        ],
      );
      const database = await client.query<{ name: string }>(
        "SELECT current_database() AS name",
      );
      if (database.rows[0]?.name !== "yulilog_worklog") {
        throw new Error("数据库名称不是开发库");
      }
      const batch = await client.query<{ batch_key: string }>(
        `SELECT batch_key FROM contract_historical_import_batches
          WHERE batch_key=$1 AND status='completed' AND manifest_hash=$2`,
        [
          SECOND_HISTORICAL_IMPORT_BATCH_KEY,
          SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
        ],
      );
      if (batch.rows.length !== 1) {
        throw new Error("第二批冻结清单尚未完整提交，拒绝独立修复财务关系");
      }
      const actorResult = await client.query<{ id: string; role: string }>(
        `SELECT id,role FROM users WHERE name='吴静雯' AND status='active'
         AND role IN ('admin','super_admin','chairman') LIMIT 2`,
      );
      if (actorResult.rows.length !== 1)
        throw new Error("吴静雯管理员账号不唯一");
      const roots = await client.query<{ contract_id: string }>(
        `SELECT DISTINCT contract_id FROM contract_audit_logs
         WHERE action='historical_contract_imported'
           AND changes_json->>'batchKey'=$1 ORDER BY contract_id`,
        [SECOND_HISTORICAL_IMPORT_BATCH_KEY],
      );
      if (roots.rows.length !== 42) {
        throw new Error(`第二批主合同应为42份，实际${roots.rows.length}份`);
      }
      const now = new Date().toISOString();
      const items: SecondHistoricalFinancialRepairResult[] = [];
      for (const root of roots.rows) {
        items.push(
          await repairSecondHistoricalFinancialRoot(
            client,
            root.contract_id,
            actorResult.rows[0]!,
            now,
          ),
        );
      }
      return {
        batchKey: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
        repairedAt: now,
        roots: items,
        confirmed: items.filter((item) => item.status === "confirmed").length,
        open: items.filter((item) => item.status === "draft").length,
        noFinancials: items.filter((item) => item.skipped).length,
      };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

const invokedAsScript =
  /repair-second-historical-financial-links\.(?:ts|js)$/u.test(
    path.basename(process.argv[1] || ""),
  );
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
