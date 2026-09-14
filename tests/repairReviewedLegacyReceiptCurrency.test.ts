import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  REVIEWED_LEGACY_RECEIPTS,
  REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION,
  REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY,
  applyReviewedLegacyReceiptCurrencyRepair,
  assertReviewedLegacyReceiptAppliedTargetDatabaseSha256,
  assertReviewedLegacyReceiptCurrencyRepairAuthorization,
  buildReviewedLegacyReceiptTargetDatabaseSha256,
  classifyReviewedLegacyReceiptCurrencyRepairState,
  parseReviewedLegacyReceiptCurrencyRepairArguments,
  readReviewedLegacyReceiptCurrencyRepairState,
  reviewedLegacyReceiptCurrencyRepairAuditId,
  runReviewedLegacyReceiptCurrencyRepair,
  verifyReviewedLegacyReceiptPhysicalFile,
  type DatabaseIdentityRow,
  type ReviewedLegacyReceiptCurrencyRepairDependencies,
  type ReviewedLegacyReceiptCurrencyRepairInspection,
  type ReviewedLegacyReceiptCurrencyRepairState,
} from "../server/scripts/repair-reviewed-legacy-receipt-currency.js";
import { LEGACY_REVIEWED_CNY_RECEIPT_FILE_HASHES } from "../server/services/monthlyFinancialAnalysisSources.js";

const DATABASE_IDENTITY: DatabaseIdentityRow = {
  database_name: "yulilog_worklog",
  database_oid: "16384",
  database_user: "postgres",
  system_identifier: "7654321",
};

function pendingRepairState(): ReviewedLegacyReceiptCurrencyRepairState {
  const actor = {
    id: "tVvL0xGPggBqH7Hc1qSLZ",
    username: "吴静雯",
    name: "吴静雯",
    role: "admin",
    status: "active",
    snapshot: {
      id: "tVvL0xGPggBqH7Hc1qSLZ",
      username: "吴静雯",
      name: "吴静雯",
      role: "admin",
      status: "active",
    },
  };
  const receipts = REVIEWED_LEGACY_RECEIPTS.map((frozen) => {
    const row = {
      id: frozen.receiptId,
      contract_id: frozen.contractId,
      file_id: frozen.fileId,
      receipt_date: frozen.receiptDate,
      payment_time: frozen.receiptDate,
      booking_date: null,
      amount: (frozen.amountCents / 100).toFixed(2),
      payer: "国网北京市电力公司",
      payer_account: "212300490",
      payee: "北京羽隶工程咨询有限公司",
      payee_account: "0200303519000018418",
      bank_name: null,
      currency: null,
      electronic_receipt_no: frozen.electronicReceiptNo,
      transaction_serial_no: null,
      proof_no: null,
      note: null,
      financial_ocr_job_id: frozen.ocrJobId,
      rate_snapshot_json: {
        tax: 0.1172,
        marketing: 0.05,
        business: 0.1,
        financial: 0.0028,
      },
      status: "confirmed",
      created_by: actor.id,
      confirmed_by: actor.id,
      confirmed_at: frozen.receiptConfirmedAt,
      reversed_by: null,
      reversed_at: null,
      reverse_reason: null,
      created_at: frozen.receiptCreatedAt,
      updated_at: frozen.receiptUpdatedAt,
    };
    return { ...row, snapshot: { ...row } };
  });
  const files = REVIEWED_LEGACY_RECEIPTS.map((frozen) => {
    const row = {
      id: frozen.fileId,
      contract_id: frozen.contractId,
      file_type: "receipt",
      file_name: frozen.fileName,
      file_path: frozen.filePath,
      file_size: frozen.fileSize,
      mime_type: "image/png",
      file_hash: frozen.fileSha256,
      version: 1,
      is_current: true,
      uploaded_by: actor.id,
      created_at: frozen.fileCreatedAt,
    };
    return { ...row, snapshot: { ...row } };
  });
  const jobs = REVIEWED_LEGACY_RECEIPTS.map((frozen) => {
    const row = {
      id: frozen.ocrJobId,
      contract_id: frozen.contractId,
      file_id: frozen.fileId,
      file_hash: frozen.fileSha256,
      record_kind: "receipt",
      document_kind: "bank_receipt",
      status: "consumed",
      validation_status: "verified",
      failure_kind: null,
      retry_count: 0,
      worker_token: null,
      lease_expires_at: null,
      recognition_method: "paddle_ocr",
      engine_version: "v6_medium",
      parser_version: "contract-bank-receipt-parser-v11",
      direction: "receipt",
      document_status: "normal",
      can_auto_post: true,
      snapshot_json: {
        fields: {
          payee: "北京羽隶工程咨询有限公司",
          payer: "国网北京市电力公司",
          amount: frozen.amountCents / 100,
          paymentTime: frozen.receiptDate,
          payeeAccount: "0200303519000018418",
          payerAccount: "212300490",
          electronicReceiptNo: frozen.electronicReceiptNo,
        },
        format: "png",
      },
      blocking_reasons_json: [],
      warnings_json: [],
      business_purpose: null,
      target_id: null,
      requested_by: actor.id,
      record_id: frozen.receiptId,
    };
    return { ...row, snapshot: { ...row } };
  });
  const contracts = REVIEWED_LEGACY_RECEIPTS.map((frozen) => {
    const row = {
      id: frozen.contractId,
      contract_no: frozen.contractNo,
      title: frozen.projectName,
      project_name: frozen.projectName,
      category: "main_business",
      declared_category: "main_business",
      relation_type: "main",
      root_contract_id: frozen.contractId,
      is_deleted: false,
      status: frozen.contractStatus,
      area: frozen.contractArea,
      party_a: "国网北京市电力公司",
      party_b: "北京羽隶工程咨询有限公司",
      contract_date: frozen.contractDate,
      current_effective_amount: (frozen.contractAmountCents / 100).toFixed(2),
      financial_direction: "income",
    };
    return { ...row, snapshot: { ...row } };
  });
  const financialHashes = REVIEWED_LEGACY_RECEIPTS.map((frozen) => {
    const row = {
      file_hash: frozen.fileSha256,
      file_id: frozen.fileId,
      contract_id: frozen.contractId,
      created_at: frozen.fileCreatedAt,
    };
    return { ...row, snapshot: { ...row } };
  });
  return {
    actor: [actor],
    receipts,
    files,
    jobs,
    contracts,
    financialHashes,
    audits: [],
  } as ReviewedLegacyReceiptCurrencyRepairState;
}

function appliedRepairState(): {
  state: ReviewedLegacyReceiptCurrencyRepairState;
  beforeSha256: string;
} {
  const pending = pendingRepairState();
  const beforeSha256 = buildReviewedLegacyReceiptTargetDatabaseSha256(
    DATABASE_IDENTITY,
    pending,
  );
  const now = "2026-09-13T16:00:00.000Z";
  const receipts = pending.receipts.map((receipt) => {
    const row = { ...receipt, currency: "CNY", updated_at: now };
    return {
      ...row,
      snapshot: { ...receipt.snapshot, currency: "CNY", updated_at: now },
    };
  });
  const audits = REVIEWED_LEGACY_RECEIPTS.map((frozen) => {
    const receiptBefore = pending.receipts.find(
      (receipt) => receipt.id === frozen.receiptId,
    )!;
    const row = {
      id: reviewedLegacyReceiptCurrencyRepairAuditId(frozen.fileSha256),
      contract_id: frozen.contractId,
      action: "reviewed_legacy_receipt_currency_repaired",
      actor_id: "tVvL0xGPggBqH7Hc1qSLZ",
      actor_role: "admin",
      from_status: frozen.contractStatus,
      to_status: frozen.contractStatus,
      changes_json: {
        repairKey: REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY,
        receiptId: frozen.receiptId,
        contractId: frozen.contractId,
        fileId: frozen.fileId,
        ocrJobId: frozen.ocrJobId,
        fileSha256: frozen.fileSha256,
        filePath: frozen.filePath,
        fileBytes: frozen.fileSize,
        electronicReceiptNo: frozen.electronicReceiptNo,
        amountCents: frozen.amountCents,
        receiptDate: frozen.receiptDate,
        currencyBefore: null,
        currencyAfter: "CNY",
        targetDatabaseSha256: beforeSha256,
        physicalFileVerified: true,
        receiptBefore: receiptBefore.snapshot,
      },
      comment: "补齐已逐张核验的旧版人民币银行回单币种",
      created_at: now,
    };
    return { ...row, snapshot: { ...row } };
  });
  return {
    beforeSha256,
    state: {
      ...pending,
      receipts,
      audits,
    } as ReviewedLegacyReceiptCurrencyRepairState,
  };
}

function databaseError(
  message: string,
  code: string,
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function repairInspection(
  state: ReviewedLegacyReceiptCurrencyRepairState,
  kind: "pending" | "applied",
  beforeSha256: string,
): ReviewedLegacyReceiptCurrencyRepairInspection {
  return {
    state,
    kind,
    currentTargetDatabaseSha256: buildReviewedLegacyReceiptTargetDatabaseSha256(
      DATABASE_IDENTITY,
      state,
    ),
    appliedFromTargetDatabaseSha256: kind === "applied" ? beforeSha256 : null,
  };
}

function repairRuntime(
  options: {
    initialKind?: "pending" | "applied";
    commitError?: Error;
    rollbackError?: Error;
    releaseError?: Error;
    endPoolError?: Error;
  } = {},
) {
  const pending = pendingRepairState();
  const applied = appliedRepairState();
  const beforeSha256 = applied.beforeSha256;
  const initial =
    options.initialKind === "applied"
      ? repairInspection(applied.state, "applied", beforeSha256)
      : repairInspection(pending, "pending", beforeSha256);
  const final = repairInspection(applied.state, "applied", beforeSha256);
  let inspectionIndex = 0;
  const query = jest.fn(async (statement: string) => {
    if (statement === "COMMIT" && options.commitError) {
      throw options.commitError;
    }
    if (statement === "ROLLBACK" && options.rollbackError) {
      throw options.rollbackError;
    }
    return { rows: [] };
  });
  const release = jest.fn(() => {
    if (options.releaseError) throw options.releaseError;
  });
  const endPool = jest.fn(async () => {
    if (options.endPoolError) throw options.endPoolError;
  });
  const inspect = jest.fn(async () => {
    const value = inspectionIndex === 0 ? initial : final;
    inspectionIndex += 1;
    return value;
  });
  const apply = jest.fn(async () => ({ affectedRows: 3, auditRows: 3 }));
  const verifyPhysicalFiles = jest.fn(async () => undefined);
  const dependencies = {
    connect: async () => ({ query, release }),
    endPool,
    now: () => "2026-09-13T16:00:00.000Z",
    verifyPhysicalFiles,
    readIdentity: async () => DATABASE_IDENTITY,
    inspect,
    apply,
  } as unknown as ReviewedLegacyReceiptCurrencyRepairDependencies;
  return {
    dependencies,
    beforeSha256,
    query,
    release,
    endPool,
    inspect,
    apply,
    verifyPhysicalFiles,
  };
}

describe("已核验旧回单人民币币种补齐", () => {
  const temporaryRoots: string[] = [];

  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("冻结且仅冻结三张已逐张复核的原始回单摘要", () => {
    expect(REVIEWED_LEGACY_RECEIPTS).toHaveLength(3);
    expect(Object.isFrozen(REVIEWED_LEGACY_RECEIPTS)).toBe(true);
    for (const row of REVIEWED_LEGACY_RECEIPTS) {
      expect(Object.isFrozen(row)).toBe(true);
    }
    expect(REVIEWED_LEGACY_RECEIPTS.map((row) => row.fileSha256)).toEqual(
      LEGACY_REVIEWED_CNY_RECEIPT_FILE_HASHES,
    );
    expect(REVIEWED_LEGACY_RECEIPTS).toEqual([
      expect.objectContaining({
        receiptId: "Ewue7Y7OfFgYZsuDi1-PO",
        contractId: "vtJwoAi7IB7TNC3CoDho3",
        receiptDate: "2026-09-08",
        amountCents: 7_600_000,
        electronicReceiptNo: "0920-3487-3565-1100",
        fileId: "wkVtnF-5Wah90UUL_Sdav",
        ocrJobId: "PrKv7bGGmpR3qqmOQ53dv",
      }),
      expect.objectContaining({
        receiptId: "-cDeLzsE7VcO3CkV0epPx",
        contractId: "7rxNEY2owwoteQ04qgNPM",
        receiptDate: "2026-09-10",
        amountCents: 8_000_000,
        electronicReceiptNo: "0920-3777-6739-1100",
        fileId: "nHfH5dl882z5NL0dkyF-l",
        ocrJobId: "PxI8z1xCtTEYBaZFN3BKx",
      }),
      expect.objectContaining({
        receiptId: "CQNDqz02zd1tLlYjYkMHF",
        contractId: "OWNZQ2Le1mhdn_PenwTIl",
        receiptDate: "2026-09-10",
        amountCents: 8_000_000,
        electronicReceiptNo: "0920-3778-0115-1100",
        fileId: "j3Eru5zbWG6bSylylR1bh",
        ocrJobId: "aAv_TGwLIv-uHKwkXX-bP",
      }),
    ]);
    expect(
      new Set(
        REVIEWED_LEGACY_RECEIPTS.map((row) =>
          reviewedLegacyReceiptCurrencyRepairAuditId(row.fileSha256),
        ),
      ).size,
    ).toBe(3);
  });

  it("默认只做事务预演，正式提交必须绑定预演摘要和专用确认令牌", () => {
    expect(parseReviewedLegacyReceiptCurrencyRepairArguments([])).toEqual({
      mode: "dry-run",
      confirmationToken: null,
      targetDatabaseSha256: null,
    });
    expect(
      parseReviewedLegacyReceiptCurrencyRepairArguments([
        "--print-target-database-sha256",
      ]),
    ).toEqual({
      mode: "inspect",
      confirmationToken: null,
      targetDatabaseSha256: null,
    });
    const databaseSha256 = "1".repeat(64);
    expect(
      parseReviewedLegacyReceiptCurrencyRepairArguments([
        "--commit",
        `--target-database-sha256=${databaseSha256}`,
        `--confirm-target=${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION}`,
      ]),
    ).toEqual({
      mode: "commit",
      confirmationToken: REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION,
      targetDatabaseSha256: databaseSha256,
    });
    expect(() =>
      parseReviewedLegacyReceiptCurrencyRepairArguments([
        "--commit",
        `--confirm-target=${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION}`,
      ]),
    ).toThrow("事务预演返回的生产数据库状态摘要");
    expect(() =>
      parseReviewedLegacyReceiptCurrencyRepairArguments([
        "--commit",
        `--target-database-sha256=${databaseSha256}`,
        "--confirm-target=错误令牌",
      ]),
    ).toThrow(REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION);
    expect(() =>
      parseReviewedLegacyReceiptCurrencyRepairArguments([
        "--dry-run",
        `--confirm-target=${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION}`,
      ]),
    ).toThrow("只读检查或事务预演不得携带正式提交确认令牌");
    expect(() =>
      parseReviewedLegacyReceiptCurrencyRepairArguments([
        "--dry-run",
        "--commit",
      ]),
    ).toThrow("只能指定一个执行模式");
    expect(() =>
      parseReviewedLegacyReceiptCurrencyRepairArguments([
        "--target=development",
      ]),
    ).toThrow("不支持的命令行参数");
  });

  it("只允许生产容器身份执行", () => {
    const production = {
      NODE_ENV: "production",
      VITE_ENABLE_WORKLOG: "",
      DATABASE_URL: "postgresql://postgres@postgres/yulilog_worklog",
    };
    expect(() =>
      assertReviewedLegacyReceiptCurrencyRepairAuthorization(
        production,
        "/app",
      ),
    ).not.toThrow();
    expect(() =>
      assertReviewedLegacyReceiptCurrencyRepairAuthorization(
        { ...production, NODE_ENV: "development" },
        "/app",
      ),
    ).toThrow("不是生产模式");
    expect(() =>
      assertReviewedLegacyReceiptCurrencyRepairAuthorization(
        production,
        "/workspace",
      ),
    ).toThrow("生产容器的 /app");
    expect(() =>
      assertReviewedLegacyReceiptCurrencyRepairAuthorization(
        { ...production, DATABASE_URL: "" },
        "/app",
      ),
    ).toThrow("缺少数据库连接配置");
  });

  it("数据库摘要绑定系统身份以及全部回单证据链", () => {
    const state = pendingRepairState();
    const first = buildReviewedLegacyReceiptTargetDatabaseSha256(
      DATABASE_IDENTITY,
      state,
    );
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      buildReviewedLegacyReceiptTargetDatabaseSha256(DATABASE_IDENTITY, state),
    ).toBe(first);
    const changed = JSON.parse(
      JSON.stringify(state),
    ) as ReviewedLegacyReceiptCurrencyRepairState;
    changed.receipts[0]!.currency = "CNY";
    expect(
      buildReviewedLegacyReceiptTargetDatabaseSha256(
        DATABASE_IDENTITY,
        changed,
      ),
    ).not.toBe(first);
  });

  it("完整更正态的三条审计必须来自同一份且可重建的预演摘要", () => {
    const applied = appliedRepairState();
    expect(
      assertReviewedLegacyReceiptAppliedTargetDatabaseSha256(
        DATABASE_IDENTITY,
        applied.state,
      ),
    ).toBe(applied.beforeSha256);

    const mismatched = JSON.parse(
      JSON.stringify(applied.state),
    ) as ReviewedLegacyReceiptCurrencyRepairState;
    mismatched.audits[0]!.changes_json.targetDatabaseSha256 = "2".repeat(64);
    expect(() =>
      assertReviewedLegacyReceiptAppliedTargetDatabaseSha256(
        DATABASE_IDENTITY,
        mismatched,
      ),
    ).toThrow("三条币种更正审计绑定的预演数据库摘要不一致");

    const forged = JSON.parse(
      JSON.stringify(applied.state),
    ) as ReviewedLegacyReceiptCurrencyRepairState;
    (
      forged.audits[0]!.changes_json.receiptBefore as Record<string, unknown>
    ).amount = "1.00";
    expect(() =>
      assertReviewedLegacyReceiptAppliedTargetDatabaseSha256(
        DATABASE_IDENTITY,
        forged,
      ),
    ).toThrow("无法重建事务预演数据库摘要");
  });

  it("管理员和合同的非门禁快照字段变化不影响后态幂等重建", () => {
    const applied = appliedRepairState();
    const changed = JSON.parse(
      JSON.stringify(applied.state),
    ) as ReviewedLegacyReceiptCurrencyRepairState;
    changed.actor[0]!.snapshot.last_login = "2026-09-14T08:00:00.000Z";
    changed.contracts[0]!.snapshot.unrelated_display_cache = "已刷新";
    (changed.actor[0] as unknown as Record<string, unknown>).last_login =
      "2026-09-14T08:00:00.000Z";
    (
      changed.contracts[0] as unknown as Record<string, unknown>
    ).unrelated_display_cache = "已刷新";

    expect(
      assertReviewedLegacyReceiptAppliedTargetDatabaseSha256(
        DATABASE_IDENTITY,
        changed,
      ),
    ).toBe(applied.beforeSha256);
  });

  it("识别任务存在任何警告时拒绝补齐币种", () => {
    const state = pendingRepairState();
    state.jobs[0]!.warnings_json = ["币种证据待复核"];
    expect(() =>
      classifyReviewedLegacyReceiptCurrencyRepairState(state),
    ).toThrow("识别任务与冻结回单链路不一致");
  });

  it("在同一事务连接内顺序锁定管理员、回单、文件、识别任务、合同、摘要和审计", async () => {
    let activeQueries = 0;
    let maximumActiveQueries = 0;
    const statements: string[] = [];
    const query = jest.fn(async (statement: string) => {
      activeQueries += 1;
      maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);
      statements.push(statement);
      await Promise.resolve();
      activeQueries -= 1;
      return { rows: [] };
    });
    await readReviewedLegacyReceiptCurrencyRepairState({ query } as never);
    expect(maximumActiveQueries).toBe(1);
    expect(query).toHaveBeenCalledTimes(7);
    expect(
      statements.map((statement) => statement.match(/FROM\s+(\w+)/u)?.[1]),
    ).toEqual([
      "users",
      "contract_receipts",
      "contract_files",
      "contract_financial_ocr_jobs",
      "contracts",
      "contract_financial_file_hashes",
      "contract_audit_logs",
    ]);
    for (const statement of statements)
      expect(statement).toContain("FOR UPDATE");
  });

  it("更新影响行数不是精确3条时立即报错且不写审计", async () => {
    const query = jest.fn(
      async (statement: string, values?: readonly unknown[]) => {
        expect(statement).toContain("receipt.id=ANY($2::text[])");
        expect(statement).toContain("receipt.contract_id=ANY($6::text[])");
        expect(statement).toContain("receipt.currency IS NULL");
        expect(statement).toContain("receipt.status='confirmed'");
        expect(statement).toContain("file_row.contract_id=receipt.contract_id");
        expect(statement).toContain("file_row.id=ANY($4::text[])");
        expect(statement).toContain("job.id=receipt.financial_ocr_job_id");
        expect(statement).toContain("job.id=ANY($5::text[])");
        expect(statement).toContain("job.record_id=receipt.id");
        expect(statement).toContain("job.can_auto_post=TRUE");
        expect(statement).toContain(
          "jsonb_array_length(job.blocking_reasons_json)=0",
        );
        expect(statement).toContain("jsonb_array_length(job.warnings_json)=0");
        expect(statement).toContain("job.recognition_method='paddle_ocr'");
        expect(statement).toContain("job.engine_version='v6_medium'");
        expect(statement).toContain(
          "job.parser_version='contract-bank-receipt-parser-v11'",
        );
        expect(values?.[1]).toEqual(
          REVIEWED_LEGACY_RECEIPTS.map((row) => row.receiptId),
        );
        expect(values?.[2]).toEqual(
          REVIEWED_LEGACY_RECEIPTS.map((row) => row.fileSha256),
        );
        expect(values?.[3]).toEqual(
          REVIEWED_LEGACY_RECEIPTS.map((row) => row.fileId),
        );
        expect(values?.[4]).toEqual(
          REVIEWED_LEGACY_RECEIPTS.map((row) => row.ocrJobId),
        );
        expect(values?.[5]).toEqual(
          REVIEWED_LEGACY_RECEIPTS.map((row) => row.contractId),
        );
        return {
          rows: REVIEWED_LEGACY_RECEIPTS.slice(0, 2).map((row) => ({
            id: row.receiptId,
          })),
          rowCount: 2,
        };
      },
    );
    await expect(
      applyReviewedLegacyReceiptCurrencyRepair({ query } as never, {
        stateBefore: { receipts: [] } as never,
        targetDatabaseSha256: "1".repeat(64),
        now: "2026-09-13T16:00:00.000Z",
      }),
    ).rejects.toThrow("影响行数不是精确的3条");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("精确更新3条后为每笔回单写入独立审计并保留更正前快照", async () => {
    let call = 0;
    const query = jest.fn(
      async (_statement: string, values?: readonly unknown[]) => {
        call += 1;
        if (call === 1) {
          return {
            rows: REVIEWED_LEGACY_RECEIPTS.map((row) => ({
              id: row.receiptId,
            })),
            rowCount: 3,
          };
        }
        const changes = JSON.parse(String(values?.[6])) as Record<
          string,
          unknown
        >;
        expect(changes).toMatchObject({
          repairKey: REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_KEY,
          currencyBefore: null,
          currencyAfter: "CNY",
          physicalFileVerified: true,
        });
        expect(changes.receiptBefore).toMatchObject({ currency: null });
        return { rows: [], rowCount: 1 };
      },
    );
    const stateBefore = {
      receipts: REVIEWED_LEGACY_RECEIPTS.map((row) => ({
        id: row.receiptId,
        snapshot: {
          id: row.receiptId,
          file_id: row.fileId,
          financial_ocr_job_id: row.ocrJobId,
          currency: null,
        },
      })),
    };
    await expect(
      applyReviewedLegacyReceiptCurrencyRepair({ query } as never, {
        stateBefore: stateBefore as never,
        targetDatabaseSha256: "1".repeat(64),
        now: "2026-09-13T16:00:00.000Z",
      }),
    ).resolves.toEqual({ affectedRows: 3, auditRows: 3 });
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("物理文件校验覆盖正常、缺失、大小、摘要、越界和符号链接", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "reviewed-receipt-currency-"),
    );
    temporaryRoots.push(root);
    const directory = path.join(root, "uploads", "receipts");
    fs.mkdirSync(directory, { recursive: true });
    const content = Buffer.from("已核验人民币银行回单");
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const filePath = path.join(directory, "receipt.png");
    fs.writeFileSync(filePath, content);
    const frozen = {
      filePath: "uploads/receipts/receipt.png",
      fileSize: content.length,
      fileSha256: sha256,
    };
    await expect(
      verifyReviewedLegacyReceiptPhysicalFile(frozen, root),
    ).resolves.toBeUndefined();
    await expect(
      verifyReviewedLegacyReceiptPhysicalFile(
        { ...frozen, filePath: "uploads/receipts/missing.png" },
        root,
      ),
    ).rejects.toThrow("无法打开原始回单");
    await expect(
      verifyReviewedLegacyReceiptPhysicalFile(
        { ...frozen, fileSize: content.length + 1 },
        root,
      ),
    ).rejects.toThrow("大小不一致");
    await expect(
      verifyReviewedLegacyReceiptPhysicalFile(
        { ...frozen, fileSha256: "0".repeat(64) },
        root,
      ),
    ).rejects.toThrow("文件摘要不一致");
    await expect(
      verifyReviewedLegacyReceiptPhysicalFile(
        { ...frozen, filePath: "uploads/../outside.png" },
        root,
      ),
    ).rejects.toThrow("保存路径不安全");

    const finalLink = path.join(directory, "linked.png");
    fs.symlinkSync(filePath, finalLink);
    await expect(
      verifyReviewedLegacyReceiptPhysicalFile(
        { ...frozen, filePath: "uploads/receipts/linked.png" },
        root,
      ),
    ).rejects.toThrow("符号链接");

    const actualDirectory = path.join(root, "uploads", "actual");
    fs.mkdirSync(actualDirectory);
    fs.writeFileSync(path.join(actualDirectory, "receipt.png"), content);
    fs.symlinkSync(actualDirectory, path.join(root, "uploads", "linked-dir"));
    await expect(
      verifyReviewedLegacyReceiptPhysicalFile(
        { ...frozen, filePath: "uploads/linked-dir/receipt.png" },
        root,
      ),
    ).rejects.toThrow("符号链接");
  });

  it("只读检查直接返回现场数据库摘要且不执行更新", async () => {
    const runtime = repairRuntime();
    await expect(
      runReviewedLegacyReceiptCurrencyRepair(
        parseReviewedLegacyReceiptCurrencyRepairArguments([
          "--print-target-database-sha256",
        ]),
        runtime.dependencies,
      ),
    ).resolves.toMatchObject({
      targetDatabaseSha256: runtime.beforeSha256,
      inspectionOnly: true,
      pendingReceiptCount: 3,
      physicalFilesVerified: true,
    });
    expect(runtime.apply).not.toHaveBeenCalled();
    expect(runtime.inspect).toHaveBeenCalledTimes(1);
    expect(runtime.verifyPhysicalFiles).toHaveBeenCalledTimes(1);
    expect(runtime.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("事务预演先设置三项超时再加锁，并完整模拟后回滚", async () => {
    const runtime = repairRuntime();
    await expect(
      runReviewedLegacyReceiptCurrencyRepair(
        parseReviewedLegacyReceiptCurrencyRepairArguments([]),
        runtime.dependencies,
      ),
    ).resolves.toMatchObject({
      targetDatabaseSha256: runtime.beforeSha256,
      affectedRows: 3,
      auditRows: 3,
      dryRunRolledBack: true,
    });
    const statements = runtime.query.mock.calls.map(([statement]) => statement);
    expect(statements.slice(0, 6)).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "SET LOCAL lock_timeout = '8s'",
      "SET LOCAL statement_timeout = '60s'",
      "SET LOCAL idle_in_transaction_session_timeout = '120s'",
      expect.stringContaining("pg_advisory_xact_lock"),
      expect.stringContaining("LOCK TABLE"),
    ]);
    expect(statements.at(-1)).toBe("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(runtime.release).toHaveBeenCalledWith(false);
    expect(runtime.endPool).toHaveBeenCalledTimes(1);
    expect(runtime.apply).toHaveBeenCalledTimes(1);
    expect(runtime.inspect).toHaveBeenCalledTimes(2);
    expect(runtime.verifyPhysicalFiles).toHaveBeenCalledTimes(2);
  });

  it("正式提交绑定预演摘要并在完整后态复核后提交", async () => {
    const runtime = repairRuntime();
    const args = parseReviewedLegacyReceiptCurrencyRepairArguments([
      "--commit",
      `--target-database-sha256=${runtime.beforeSha256}`,
      `--confirm-target=${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION}`,
    ]);
    await expect(
      runReviewedLegacyReceiptCurrencyRepair(args, runtime.dependencies),
    ).resolves.toMatchObject({
      affectedRows: 3,
      auditRows: 3,
      dryRunRolledBack: false,
    });
    const statements = runtime.query.mock.calls.map(([statement]) => statement);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements).not.toContain("ROLLBACK");
    expect(runtime.release).toHaveBeenCalledWith(false);
    expect(runtime.endPool).toHaveBeenCalledTimes(1);
  });

  it("完整后态再次运行只做幂等只读核验", async () => {
    const runtime = repairRuntime({ initialKind: "applied" });
    await expect(
      runReviewedLegacyReceiptCurrencyRepair(
        parseReviewedLegacyReceiptCurrencyRepairArguments([]),
        runtime.dependencies,
      ),
    ).resolves.toMatchObject({
      skipped: true,
      reason: "目标库已经处于完整更正态",
      appliedFromTargetDatabaseSha256: runtime.beforeSha256,
      affectedRows: 0,
    });
    expect(runtime.apply).not.toHaveBeenCalled();
    expect(runtime.inspect).toHaveBeenCalledTimes(1);
    expect(runtime.verifyPhysicalFiles).toHaveBeenCalledTimes(1);
    expect(runtime.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it.each([
    ["40001", "可串行化冲突"],
    ["40P01", "数据库死锁"],
  ])("提交遇到%s时回滚且连接仍可安全释放", async (code, message) => {
    const runtime = repairRuntime({
      commitError: databaseError(message, code),
    });
    const args = parseReviewedLegacyReceiptCurrencyRepairArguments([
      "--commit",
      `--target-database-sha256=${runtime.beforeSha256}`,
      `--confirm-target=${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION}`,
    ]);
    await expect(
      runReviewedLegacyReceiptCurrencyRepair(args, runtime.dependencies),
    ).rejects.toThrow(message);
    const statements = runtime.query.mock.calls.map(([statement]) => statement);
    expect(statements.slice(-2)).toEqual(["COMMIT", "ROLLBACK"]);
    expect(runtime.release).toHaveBeenCalledWith(false);
  });

  it("提交返回未知错误时销毁连接且禁止盲目重试", async () => {
    const runtime = repairRuntime({
      commitError: databaseError("网络连接中断", "08006"),
    });
    const args = parseReviewedLegacyReceiptCurrencyRepairArguments([
      "--commit",
      `--target-database-sha256=${runtime.beforeSha256}`,
      `--confirm-target=${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION}`,
    ]);
    await expect(
      runReviewedLegacyReceiptCurrencyRepair(args, runtime.dependencies),
    ).rejects.toThrow("提交结果无法确认，连接已销毁，禁止重试");
    const statements = runtime.query.mock.calls.map(([statement]) => statement);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements).not.toContain("ROLLBACK");
    expect(runtime.release).toHaveBeenCalledWith(true);
  });

  it("事务回滚失败时销毁连接并明确报告", async () => {
    const runtime = repairRuntime({ rollbackError: new Error("连接不可用") });
    await expect(
      runReviewedLegacyReceiptCurrencyRepair(
        parseReviewedLegacyReceiptCurrencyRepairArguments([]),
        runtime.dependencies,
      ),
    ).rejects.toThrow("事务回滚失败，连接已标记销毁");
    expect(runtime.release).toHaveBeenCalledWith(true);
    expect(runtime.endPool).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["release", "释放数据库连接失败"],
    ["pool", "关闭数据库连接池失败"],
  ])("提交成功后的%s清理异常明确禁止重试", async (kind, message) => {
    const runtime = repairRuntime(
      kind === "release"
        ? { releaseError: new Error("释放异常") }
        : { endPoolError: new Error("连接池异常") },
    );
    const args = parseReviewedLegacyReceiptCurrencyRepairArguments([
      "--commit",
      `--target-database-sha256=${runtime.beforeSha256}`,
      `--confirm-target=${REVIEWED_LEGACY_RECEIPT_CURRENCY_REPAIR_CONFIRMATION}`,
    ]);
    const execution = runReviewedLegacyReceiptCurrencyRepair(
      args,
      runtime.dependencies,
    );
    await expect(execution).rejects.toThrow(`数据库提交已经成功，但${message}`);
    await expect(execution).rejects.toThrow("禁止盲目重试");
  });

  it("脚本具备可串行化事务、表锁、物理摘要复核、回滚和提交不确定保护", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "server/scripts/repair-reviewed-legacy-receipt-currency.ts",
      ),
      "utf8",
    );
    expect(source).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(source).toContain("SET LOCAL lock_timeout = '8s'");
    expect(source).toContain("SET LOCAL statement_timeout = '60s'");
    expect(source).toContain("SET LOCAL idle_in_transaction_session_timeout");
    expect(source).toContain("LOCK TABLE users,contracts,contract_files");
    expect(source).toContain("verifyReviewedLegacyReceiptPhysicalFiles");
    expect(source).toContain("fs.constants.O_NOFOLLOW");
    expect(source).toContain("await handle.stat({ bigint: true })");
    expect(source).toContain("await handle.read(");
    expect(source).not.toContain("fs.createReadStream");
    expect(source).toContain(
      "updated.rowCount !== REVIEWED_LEGACY_RECEIPTS.length",
    );
    expect(source).toContain('await client.query("ROLLBACK")');
    expect(source).toContain('await client.query("COMMIT")');
    expect(source).toContain("提交结果无法确认，连接已销毁，禁止重试");

    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts["contract:finance:repair-reviewed-cny"]).toBe(
      "node dist/server/scripts/repair-reviewed-legacy-receipt-currency.js",
    );
  });
});
