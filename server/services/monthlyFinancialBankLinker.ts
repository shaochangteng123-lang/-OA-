import { nanoid } from "nanoid";
import type { PoolClient } from "pg";

import {
  bridgeMonthlyBankTransactionGroupsToContractRegistrations,
  bridgeMonthlyBankTransactionToContractRegistration,
  cleanupMonthlyContractBridgeGroupFiles,
  type MonthlyContractBridgeResult,
  type MonthlyContractBridgeGroupResult,
} from "./monthlyFinancialContractBridge.js";

export type MonthlyFinancialBankCategoryOverride =
  | "main_income"
  | "asset_expense";

export type MonthlyFinancialBankBusinessObjectType =
  | "contract_receipt"
  | "contract_payment"
  | "contract_external_payment"
  | "reimbursement"
  | "payment_batch"
  | "human_cost_receipt_item";

type MonthlyFinancialBankLinkKind =
  | "display_replacement"
  | "classification_basis";

interface BankTransactionRow {
  id: string;
  account_code: string;
  electronic_receipt_no: string | null;
  normalized_electronic_receipt_no: string | null;
  transaction_date: string | null;
  amount: string | null;
  direction: string | null;
  payer_account: string | null;
  payee_account: string | null;
}

interface ContractCandidate {
  businessObjectType:
    | "contract_receipt"
    | "contract_payment"
    | "contract_external_payment";
  businessObjectId: string;
  fileId: string | null;
  electronicReceiptNo: string | null;
  transactionDate: string | null;
  amount: string;
  payerAccount: string | null;
  payeeAccount: string | null;
  status: string;
  contractCategory: string | null;
  financialRecognitionMethod: string | null;
}

interface ReimbursementCandidate {
  businessObjectType: "reimbursement" | "payment_batch";
  businessObjectId: string;
  batchId: string;
  electronicReceiptNo: string | null;
  batchDate: string | null;
  reimbursementDate: string | null;
  batchAmount: string;
  allocatedTotal: string;
  allocatedAmount: string | null;
  proofCount: number;
  batchStatus: string;
  reimbursementStatus: string | null;
  reimbursementType: string | null;
}

interface HumanCostCandidate {
  businessObjectType: "human_cost_receipt_item";
  businessObjectId: string;
  electronicReceiptNo: string | null;
  amount: string;
  payeeAccount: string;
  payrollMonth: string;
  category: string;
  matchStatus: string;
}

export interface MonthlyFinancialBankMatchedLink {
  businessObjectType: MonthlyFinancialBankBusinessObjectType;
  businessObjectId: string;
  linkIds: string[];
  linkKinds: MonthlyFinancialBankLinkKind[];
  allocatedAmount: string | null;
}

export interface MonthlyFinancialBankLinkConflict {
  businessObjectType: MonthlyFinancialBankBusinessObjectType;
  businessObjectId: string;
  linkIds: string[];
  reasons: string[];
  allocatedAmount: string | null;
}

export interface MonthlyFinancialBankLinkResult {
  matched: MonthlyFinancialBankMatchedLink[];
  conflicts: MonthlyFinancialBankLinkConflict[];
  warnings: string[];
  categoryOverride?: MonthlyFinancialBankCategoryOverride;
  changed: boolean;
}

interface LinkWriteInput {
  transactionId: string;
  businessObjectType: MonthlyFinancialBankBusinessObjectType;
  businessObjectId: string;
  linkKind: MonthlyFinancialBankLinkKind;
  matchStatus: "active" | "conflict";
  matchKey: Record<string, unknown>;
  allocatedAmount: string | null;
  warnings: string[];
  actorId: string;
  now: string;
}

interface LinkWriteResult {
  id: string;
  preservedManualLink: boolean;
  changed: boolean;
}

function normalizeBankIdentifier(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

function normalizeBankAccount(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

function normalizeBusinessDate(value: unknown): string | null {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim();
  const match = normalized.match(
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|\b)/u,
  );
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function moneyToCents(value: unknown): bigint | null {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[,，\s]/gu, "");
  const match = normalized.match(/^([0-9]+)(?:\.([0-9]{1,2}))?$/u);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
}

function uniqueWarnings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stableJsonStringify(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  };
  return JSON.stringify(normalize(value));
}

function exactAccountCheck(
  label: string,
  transactionValue: string | null,
  businessValue: string | null,
): string | null {
  const transactionAccount = normalizeBankAccount(transactionValue);
  const businessAccount = normalizeBankAccount(businessValue);
  if (!transactionAccount) return `银行回单缺少${label}完整账号`;
  if (!businessAccount) return `原业务凭证缺少${label}完整账号`;
  if (transactionAccount !== businessAccount) {
    return `${label}完整账号不一致`;
  }
  return null;
}

function exactDateCheck(
  transactionDate: string | null,
  businessDate: string | null,
): string | null {
  const normalizedTransactionDate = normalizeBusinessDate(transactionDate);
  const normalizedBusinessDate = normalizeBusinessDate(businessDate);
  if (!normalizedTransactionDate) return "银行回单缺少有效交易日期";
  if (!normalizedBusinessDate) return "原业务凭证缺少有效交易日期";
  if (normalizedTransactionDate !== normalizedBusinessDate) {
    return "交易日期不一致";
  }
  return null;
}

function exactAmountCheck(
  transactionAmount: string | null,
  businessAmount: string | null,
): string | null {
  const transactionCents = moneyToCents(transactionAmount);
  const businessCents = moneyToCents(businessAmount);
  if (transactionCents === null) return "银行回单缺少有效金额";
  if (businessCents === null) return "原业务凭证缺少有效金额";
  if (transactionCents !== businessCents) return "交易金额不一致";
  return null;
}

function exactReceiptNoCheck(
  transactionReceiptNo: string,
  businessReceiptNo: string | null,
): string | null {
  const businessKey = normalizeBankIdentifier(businessReceiptNo);
  if (!businessKey) return "原业务凭证缺少电子回单号";
  if (businessKey !== transactionReceiptNo) return "电子回单号不一致";
  return null;
}

async function ensureLink(
  client: PoolClient,
  input: LinkWriteInput,
): Promise<LinkWriteResult> {
  const existing = await client.query<{
    id: string;
    match_status: string;
    match_method: string;
    match_key_json: unknown;
    allocated_amount: string | null;
    warnings_json: unknown;
    is_active: boolean;
  }>(
    `SELECT id, match_status, match_method, match_key_json,
            allocated_amount::text AS allocated_amount,
            warnings_json, is_active
     FROM monthly_financial_bank_transaction_links
     WHERE transaction_id = $1
       AND business_object_type = $2
       AND business_object_id = $3
       AND link_kind = $4
       AND match_status IN ('active', 'conflict')
     ORDER BY CASE match_status WHEN 'active' THEN 0 ELSE 1 END, created_at, id
     FOR UPDATE`,
    [
      input.transactionId,
      input.businessObjectType,
      input.businessObjectId,
      input.linkKind,
    ],
  );
  const manualActive = existing.rows.find(
    (row) => row.match_status === "active" && row.match_method === "manual",
  );
  if (manualActive) {
    return {
      id: manualActive.id,
      preservedManualLink: true,
      changed: false,
    };
  }

  const target = existing.rows[0];
  const matchKeyJson = JSON.stringify(input.matchKey);
  const warningsJson = JSON.stringify(uniqueWarnings(input.warnings));
  if (target) {
    const shouldBeActive = input.matchStatus === "active";
    const changed =
      target.match_method !== "electronic_receipt_no" ||
      target.match_status !== input.matchStatus ||
      stableJsonStringify(target.match_key_json) !==
        stableJsonStringify(input.matchKey) ||
      moneyToCents(target.allocated_amount) !==
        moneyToCents(input.allocatedAmount) ||
      stableJsonStringify(target.warnings_json) !==
        stableJsonStringify(uniqueWarnings(input.warnings)) ||
      target.is_active !== shouldBeActive;
    if (changed) {
      await client.query(
        `UPDATE monthly_financial_bank_transaction_links
       SET match_method = 'electronic_receipt_no', match_status = $2,
           match_key_json = $3::jsonb, allocated_amount = $4::numeric,
           warnings_json = $5::jsonb, is_active = ($2 = 'active'),
           updated_at = $6
       WHERE id = $1`,
        [
          target.id,
          input.matchStatus,
          matchKeyJson,
          input.allocatedAmount,
          warningsJson,
          input.now,
        ],
      );
    }
    const duplicateIds = existing.rows
      .slice(1)
      .filter((row) => row.match_method !== "manual")
      .map((row) => row.id);
    if (duplicateIds.length > 0) {
      await client.query(
        `UPDATE monthly_financial_bank_transaction_links
         SET match_status = 'dismissed', is_active = FALSE, updated_at = $2
         WHERE id = ANY($1::text[])`,
        [duplicateIds, input.now],
      );
    }
    return {
      id: target.id,
      preservedManualLink: false,
      changed: changed || duplicateIds.length > 0,
    };
  }

  const id = `mfbl_${nanoid(16)}`;
  await client.query(
    `INSERT INTO monthly_financial_bank_transaction_links(
       id, transaction_id, business_object_type, business_object_id,
       link_kind, match_method, match_status, match_key_json,
       allocated_amount, warnings_json, is_active, created_by,
       created_at, updated_at
     ) VALUES(
       $1,$2,$3,$4,$5,'electronic_receipt_no',$6,$7::jsonb,$8::numeric,
       $9::jsonb,($6 = 'active'),$10,$11,$11
     )`,
    [
      id,
      input.transactionId,
      input.businessObjectType,
      input.businessObjectId,
      input.linkKind,
      input.matchStatus,
      matchKeyJson,
      input.allocatedAmount,
      warningsJson,
      input.actorId,
      input.now,
    ],
  );
  return { id, preservedManualLink: false, changed: true };
}

async function loadContractCandidates(
  client: PoolClient,
  normalizedReceiptNo: string,
): Promise<ContractCandidate[]> {
  const commonWhere = `
    UPPER(REGEXP_REPLACE(
      NORMALIZE(BTRIM(record.electronic_receipt_no), NFKC),
      '[^[:alnum:]]+', '', 'g'
    )) = $1`;
  const candidates: ContractCandidate[] = [];
  const definitions = [
    {
      table: "contract_receipts",
      type: "contract_receipt" as const,
      dateColumn: "receipt_date",
    },
    {
      table: "contract_payments",
      type: "contract_payment" as const,
      dateColumn: "payment_date",
    },
    {
      table: "contract_external_payments",
      type: "contract_external_payment" as const,
      dateColumn: "payment_date",
    },
  ];
  for (const definition of definitions) {
    const result = await client.query<{
      id: string;
      file_id: string | null;
      electronic_receipt_no: string | null;
      transaction_date: string | null;
      amount: string;
      payer_account: string | null;
      payee_account: string | null;
      status: string;
      contract_category: string | null;
      financial_recognition_method: string | null;
    }>(
      `SELECT record.id, record.file_id, record.electronic_receipt_no,
              record.${definition.dateColumn} AS transaction_date,
              record.amount::text AS amount, record.payer_account,
              record.payee_account, record.status,
              financial_ocr.recognition_method AS financial_recognition_method,
              COALESCE(root.category, root.declared_category,
                       contract.category, contract.declared_category)
                AS contract_category
       FROM ${definition.table} record
       LEFT JOIN contract_financial_ocr_jobs financial_ocr
         ON financial_ocr.id = record.financial_ocr_job_id
       JOIN contracts contract ON contract.id = record.contract_id
       LEFT JOIN contracts root
         ON root.id = COALESCE(contract.root_contract_id, contract.id)
       WHERE ${commonWhere}
         AND record.status <> 'reversed'
       ORDER BY record.created_at, record.id
       FOR SHARE OF record`,
      [normalizedReceiptNo],
    );
    candidates.push(
      ...result.rows.map((row) => ({
        businessObjectType: definition.type,
        businessObjectId: row.id,
        fileId: row.file_id,
        electronicReceiptNo: row.electronic_receipt_no,
        transactionDate: row.transaction_date,
        amount: row.amount,
        payerAccount: row.payer_account,
        payeeAccount: row.payee_account,
        status: row.status,
        contractCategory: row.contract_category,
        financialRecognitionMethod: row.financial_recognition_method,
      })),
    );
  }
  return candidates;
}

async function loadReimbursementCandidates(
  client: PoolClient,
  normalizedReceiptNo: string,
): Promise<ReimbursementCandidate[]> {
  const result = await client.query<{
    reimbursement_id: string | null;
    batch_id: string;
    proof_no: string | null;
    batch_date: string | null;
    reimbursement_date: string | null;
    batch_amount: string;
    allocated_total: string;
    allocated_amount: string | null;
    proof_count: number;
    batch_status: string;
    reimbursement_status: string | null;
    reimbursement_type: string | null;
  }>(
    `SELECT reimbursement.id AS reimbursement_id, batch.id AS batch_id,
            proof.proof_no, batch.payment_business_date::text AS batch_date,
            reimbursement.payment_business_date::text AS reimbursement_date,
            batch.total_amount::text AS batch_amount,
            COALESCE(allocation.allocated_total, 0)::text AS allocated_total,
            item.amount::text AS allocated_amount,
            proof_summary.proof_count::int AS proof_count,
            batch.status AS batch_status,
            reimbursement.status AS reimbursement_status,
            reimbursement.type AS reimbursement_type
     FROM payment_proof_hashes proof
     JOIN payment_batches batch ON batch.id = proof.batch_id
     JOIN (
       SELECT batch_id, COUNT(proof_no)::int AS proof_count
       FROM payment_proof_hashes GROUP BY batch_id
     ) proof_summary ON proof_summary.batch_id = batch.id
     LEFT JOIN (
       SELECT batch_id, SUM(amount) AS allocated_total
       FROM payment_batch_items GROUP BY batch_id
     ) allocation ON allocation.batch_id = batch.id
     LEFT JOIN payment_batch_items item ON item.batch_id = batch.id
     LEFT JOIN reimbursements reimbursement
       ON reimbursement.id = item.reimbursement_id
      AND reimbursement.is_deleted = FALSE
     WHERE UPPER(REGEXP_REPLACE(
       NORMALIZE(BTRIM(proof.proof_no), NFKC),
       '[^[:alnum:]]+', '', 'g'
     )) = $1
     ORDER BY batch.created_at, batch.id, item.created_at, item.id`,
    [normalizedReceiptNo],
  );
  return result.rows.map((row) => ({
    businessObjectType: row.reimbursement_id
      ? "reimbursement"
      : "payment_batch",
    businessObjectId: row.reimbursement_id || row.batch_id,
    batchId: row.batch_id,
    electronicReceiptNo: row.proof_no,
    batchDate: row.batch_date,
    reimbursementDate: row.reimbursement_date,
    batchAmount: row.batch_amount,
    allocatedTotal: row.allocated_total,
    allocatedAmount: row.allocated_amount,
    proofCount: row.proof_count,
    batchStatus: row.batch_status,
    reimbursementStatus: row.reimbursement_status,
    reimbursementType: row.reimbursement_type,
  }));
}

async function loadHumanCostCandidates(
  client: PoolClient,
  normalizedReceiptNo: string,
): Promise<HumanCostCandidate[]> {
  const result = await client.query<{
    id: string;
    proof_no: string | null;
    amount: string;
    payee_account: string;
    payroll_month: string;
    category: string;
    match_status: string;
  }>(
    `SELECT item.id, item.proof_no, item.amount::text AS amount,
            item.payee_account, receipt.payroll_month,
            receipt.category, item.match_status
     FROM human_cost_receipt_items item
     JOIN human_cost_receipts receipt ON receipt.id = item.receipt_id
     WHERE UPPER(REGEXP_REPLACE(
       NORMALIZE(BTRIM(item.proof_no), NFKC),
       '[^[:alnum:]]+', '', 'g'
     )) = $1
     ORDER BY receipt.created_at, receipt.id, item.page_no, item.position`,
    [normalizedReceiptNo],
  );
  return result.rows.map((row) => ({
    businessObjectType: "human_cost_receipt_item",
    businessObjectId: row.id,
    electronicReceiptNo: row.proof_no,
    amount: row.amount,
    payeeAccount: row.payee_account,
    payrollMonth: row.payroll_month,
    category: row.category,
    matchStatus: row.match_status,
  }));
}

function contractCategoryOverride(
  candidate: ContractCandidate,
): MonthlyFinancialBankCategoryOverride | undefined {
  if (candidate.businessObjectType === "contract_receipt") {
    return candidate.contractCategory === "main_business"
      ? "main_income"
      : undefined;
  }
  return candidate.contractCategory === "asset" ? "asset_expense" : undefined;
}

function contractBankRoleCheck(
  transaction: BankTransactionRow,
  candidate: ContractCandidate,
): string | null {
  if (transaction.account_code !== "general") {
    return "主营回款和资产支出仅允许挂载一般账户回单";
  }
  const expectedDirection =
    candidate.businessObjectType === "contract_receipt" ? "inflow" : "outflow";
  if (transaction.direction !== expectedDirection) {
    return candidate.businessObjectType === "contract_receipt"
      ? "主营回款必须是一般账户入账"
      : "资产支出必须是一般账户出账";
  }
  return null;
}

/**
 * 将一笔月报银行回单与既有业务凭证建立严格证据链接。
 *
 * 本函数必须在调用方已经开启的 PostgreSQL 事务中执行。只有电子回单号、
 * 双方完整账号、交易日期和金额全部一致的合同凭证才会成为有效展示替换；
 * 原业务事实、金额、状态和原文件始终保持不变。
 */
export async function linkMonthlyFinancialBankTransaction(
  client: PoolClient,
  transactionId: string,
  actorId: string,
  now: string,
): Promise<MonthlyFinancialBankLinkResult> {
  const transactionResult = await client.query<BankTransactionRow>(
    `SELECT id, account_code, electronic_receipt_no,
            normalized_electronic_receipt_no,
            transaction_date, amount::text AS amount, direction,
            payer_account, payee_account
     FROM monthly_financial_bank_transactions
     WHERE id = $1 AND is_current = TRUE
     FOR UPDATE`,
    [transactionId],
  );
  const transaction = transactionResult.rows[0];
  if (!transaction) {
    throw new Error("月报银行回单不存在或已不是当前版本");
  }

  const result: MonthlyFinancialBankLinkResult = {
    matched: [],
    conflicts: [],
    warnings: [],
    changed: false,
  };
  const receiptNoFromOriginal = normalizeBankIdentifier(
    transaction.electronic_receipt_no,
  );
  const receiptNoFromStored = normalizeBankIdentifier(
    transaction.normalized_electronic_receipt_no,
  );
  if (!receiptNoFromOriginal && !receiptNoFromStored) {
    result.warnings.push("银行回单缺少电子回单号，不能自动关联既有业务凭证");
    return result;
  }
  if (
    receiptNoFromOriginal &&
    receiptNoFromStored &&
    receiptNoFromOriginal !== receiptNoFromStored
  ) {
    result.warnings.push(
      "银行回单原始电子回单号与规范化字段不一致，已停止自动关联",
    );
    return result;
  }
  const normalizedReceiptNo = receiptNoFromOriginal || receiptNoFromStored;

  const contractCandidates = await loadContractCandidates(
    client,
    normalizedReceiptNo,
  );
  const contractChecks = contractCandidates.map((candidate) => {
    const reasons = uniqueWarnings(
      [
        exactReceiptNoCheck(normalizedReceiptNo, candidate.electronicReceiptNo),
        exactAccountCheck(
          "付款账号",
          transaction.payer_account,
          candidate.payerAccount,
        ),
        exactAccountCheck(
          "收款账号",
          transaction.payee_account,
          candidate.payeeAccount,
        ),
        exactDateCheck(transaction.transaction_date, candidate.transactionDate),
        exactAmountCheck(transaction.amount, candidate.amount),
        contractBankRoleCheck(transaction, candidate),
        candidate.status === "confirmed" ? null : "合同财务凭证尚未确认",
        contractCategoryOverride(candidate)
          ? null
          : "合同分类与月报自动分类规则不一致",
      ].filter((value): value is string => Boolean(value)),
    );
    return { candidate, reasons };
  });
  const exactContractCandidates = contractChecks.filter(
    (entry) => entry.reasons.length === 0,
  );
  const contractAmbiguous = exactContractCandidates.length > 1;
  if (contractAmbiguous) {
    result.warnings.push(
      "同一电子回单号命中多条完整一致的合同财务凭证，需人工确认",
    );
  }

  for (const entry of contractChecks) {
    const exact = entry.reasons.length === 0 && !contractAmbiguous;
    const reasons = contractAmbiguous
      ? uniqueWarnings([...entry.reasons, "电子回单号命中多条合同财务凭证"])
      : entry.reasons;
    const linkIds: string[] = [];
    let preservedManualLink = false;
    for (const linkKind of [
      "display_replacement",
      "classification_basis",
    ] as const) {
      const originatedFromMonthlyBank =
        entry.candidate.financialRecognitionMethod ===
        "monthly_bank_transaction";
      const link = await ensureLink(client, {
        transactionId,
        businessObjectType: entry.candidate.businessObjectType,
        businessObjectId: entry.candidate.businessObjectId,
        linkKind,
        matchStatus: exact ? "active" : "conflict",
        matchKey: {
          normalizedElectronicReceiptNo: normalizedReceiptNo,
          displayAction:
            entry.candidate.fileId && !originatedFromMonthlyBank
              ? "replaced"
              : "attached",
          previousFileId: originatedFromMonthlyBank
            ? null
            : entry.candidate.fileId,
          transaction: {
            accountCode: transaction.account_code,
            direction: transaction.direction,
            payerAccount: normalizeBankAccount(transaction.payer_account),
            payeeAccount: normalizeBankAccount(transaction.payee_account),
            transactionDate: normalizeBusinessDate(
              transaction.transaction_date,
            ),
            amount: transaction.amount,
          },
          business: {
            payerAccount: normalizeBankAccount(entry.candidate.payerAccount),
            payeeAccount: normalizeBankAccount(entry.candidate.payeeAccount),
            transactionDate: normalizeBusinessDate(
              entry.candidate.transactionDate,
            ),
            amount: entry.candidate.amount,
            status: entry.candidate.status,
            contractCategory: entry.candidate.contractCategory,
          },
        },
        allocatedAmount: null,
        warnings: reasons,
        actorId,
        now,
      });
      linkIds.push(link.id);
      preservedManualLink ||= link.preservedManualLink;
      result.changed ||= link.changed;
    }
    if (preservedManualLink) {
      result.warnings.push(
        `业务对象${entry.candidate.businessObjectId}已有人工有效链接，自动校验未覆盖该链接`,
      );
    }
    if (exact) {
      result.matched.push({
        businessObjectType: entry.candidate.businessObjectType,
        businessObjectId: entry.candidate.businessObjectId,
        linkIds,
        linkKinds: ["display_replacement", "classification_basis"],
        allocatedAmount: null,
      });
      result.categoryOverride = contractCategoryOverride(entry.candidate);
    } else {
      result.conflicts.push({
        businessObjectType: entry.candidate.businessObjectType,
        businessObjectId: entry.candidate.businessObjectId,
        linkIds,
        reasons,
        allocatedAmount: null,
      });
    }
  }

  const reimbursementCandidates = await loadReimbursementCandidates(
    client,
    normalizedReceiptNo,
  );
  for (const candidate of reimbursementCandidates) {
    const reasons = uniqueWarnings(
      [
        exactReceiptNoCheck(normalizedReceiptNo, candidate.electronicReceiptNo),
        exactDateCheck(transaction.transaction_date, candidate.batchDate),
        candidate.reimbursementDate
          ? exactDateCheck(
              transaction.transaction_date,
              candidate.reimbursementDate,
            )
          : "原报销记录缺少有效交易日期",
        exactAmountCheck(transaction.amount, candidate.batchAmount),
        exactAmountCheck(transaction.amount, candidate.allocatedTotal),
        "原报销回单未保存付款方完整账号",
        "原报销回单未保存收款方完整账号",
        candidate.proofCount === 1
          ? null
          : "同一付款批次包含多张回单，无法严格确定单张回单分摊",
        candidate.businessObjectType === "reimbursement"
          ? null
          : "付款批次没有可关联的报销明细",
        candidate.batchStatus === "confirmed" ? null : "付款批次尚未确认",
        candidate.reimbursementStatus &&
        ["paid", "payment_uploaded", "completed"].includes(
          candidate.reimbursementStatus,
        )
          ? null
          : "报销记录尚未形成有效付款事实",
      ].filter((value): value is string => Boolean(value)),
    );
    const link = await ensureLink(client, {
      transactionId,
      businessObjectType: candidate.businessObjectType,
      businessObjectId: candidate.businessObjectId,
      linkKind: "display_replacement",
      matchStatus: "conflict",
      matchKey: {
        normalizedElectronicReceiptNo: normalizedReceiptNo,
        batchId: candidate.batchId,
        transactionDate: normalizeBusinessDate(transaction.transaction_date),
        batchDate: normalizeBusinessDate(candidate.batchDate),
        reimbursementDate: normalizeBusinessDate(candidate.reimbursementDate),
        transactionAmount: transaction.amount,
        batchAmount: candidate.batchAmount,
        allocatedTotal: candidate.allocatedTotal,
        reimbursementType: candidate.reimbursementType,
      },
      allocatedAmount: candidate.allocatedAmount,
      warnings: reasons,
      actorId,
      now,
    });
    result.conflicts.push({
      businessObjectType: candidate.businessObjectType,
      businessObjectId: candidate.businessObjectId,
      linkIds: [link.id],
      reasons,
      allocatedAmount: candidate.allocatedAmount,
    });
    if (link.preservedManualLink) {
      result.warnings.push(
        `业务对象${candidate.businessObjectId}已有人工有效链接，自动校验未覆盖该链接`,
      );
    }
    result.changed ||= link.changed;
  }

  const humanCostCandidates = await loadHumanCostCandidates(
    client,
    normalizedReceiptNo,
  );
  for (const candidate of humanCostCandidates) {
    const reasons = uniqueWarnings(
      [
        exactReceiptNoCheck(normalizedReceiptNo, candidate.electronicReceiptNo),
        exactAccountCheck(
          "收款账号",
          transaction.payee_account,
          candidate.payeeAccount,
        ),
        exactAmountCheck(transaction.amount, candidate.amount),
        "原薪资回单未保存付款方完整账号",
        "原薪资回单未保存精确交易日期",
        candidate.category === "net_salary"
          ? null
          : "人力成本回单不是实发薪资类别",
        candidate.matchStatus === "matched"
          ? null
          : "薪资收款人尚未唯一匹配员工",
      ].filter((value): value is string => Boolean(value)),
    );
    const link = await ensureLink(client, {
      transactionId,
      businessObjectType: candidate.businessObjectType,
      businessObjectId: candidate.businessObjectId,
      linkKind: "display_replacement",
      matchStatus: "conflict",
      matchKey: {
        normalizedElectronicReceiptNo: normalizedReceiptNo,
        transactionDate: normalizeBusinessDate(transaction.transaction_date),
        payrollMonth: candidate.payrollMonth,
        transactionAmount: transaction.amount,
        itemAmount: candidate.amount,
        transactionPayeeAccount: normalizeBankAccount(
          transaction.payee_account,
        ),
        itemPayeeAccount: normalizeBankAccount(candidate.payeeAccount),
        category: candidate.category,
      },
      allocatedAmount: candidate.amount,
      warnings: reasons,
      actorId,
      now,
    });
    result.conflicts.push({
      businessObjectType: candidate.businessObjectType,
      businessObjectId: candidate.businessObjectId,
      linkIds: [link.id],
      reasons,
      allocatedAmount: candidate.amount,
    });
    if (link.preservedManualLink) {
      result.warnings.push(
        `业务对象${candidate.businessObjectId}已有人工有效链接，自动校验未覆盖该链接`,
      );
    }
    result.changed ||= link.changed;
  }

  if (
    contractCandidates.length === 0 &&
    reimbursementCandidates.length === 0 &&
    humanCostCandidates.length === 0
  ) {
    result.warnings.push("未找到电子回单号完全一致的既有业务凭证");
  }
  result.warnings = uniqueWarnings(result.warnings);
  return result;
}

export interface MonthlyContractReceiptReconciliationResult {
  transactionId: string;
  status: "matched" | "pending";
  category: "main_income" | "asset_expense" | "unclassified";
  changed: boolean;
  warnings: string[];
}

const CONTRACT_PENDING_FILE_WARNING =
  "存在未关联的合同收付款回单，已确认的利息和跨行手续费仍计入月报";

function contractTransactionWarnings(
  current: string[],
  nextContractWarning: string | null,
): string[] {
  const retained = current.filter(
    (warning) =>
      warning !== "该回单无法安全归入主营收入或资产支出，需管理员核对" &&
      !warning.startsWith("MONTHLY_BANK_CONTRACT_MATCH_REQUIRED:"),
  );
  return uniqueWarnings(
    nextContractWarning ? [...retained, nextContractWarning] : retained,
  );
}

/**
 * 对活动月报中的主营／资产银行回单执行整月重匹配。
 *
 * 用于银行文件早于合同财务登记的场景。优先链接既有合同凭证；若主营收入
 * 回单唯一命中一笔尚无结算项、全额闭合的合同财务草稿，则通过专用桥接
 * 服务补入并确认回款，再按完整字段重新建立证据链接。任何歧义均保持待核对。
 */
export async function reconcileMonthlyContractBankTransactions(
  client: PoolClient,
  month: string,
  actorId: string,
  now: string,
  actorRole = "admin",
): Promise<MonthlyContractReceiptReconciliationResult[]> {
  const transactions = await client.query<{
    id: string;
    category: "main_income" | "asset_expense" | "unclassified";
    direction: string | null;
    recognition_status: string;
    include_in_report: boolean;
    warnings_json: string[];
    current_file_id: string;
  }>(
    `SELECT transaction.id, transaction.category, transaction.direction,
            transaction.recognition_status, transaction.include_in_report,
            transaction.warnings_json, transaction.current_file_id
       FROM monthly_financial_bank_transactions transaction
       JOIN monthly_financial_bank_files file
         ON file.id = transaction.current_file_id
        AND file.is_active = TRUE
      WHERE transaction.report_month = $1
        AND transaction.account_code = 'general'
        AND transaction.category IN (
          'main_income', 'asset_expense', 'unclassified'
        )
        AND transaction.normalized_electronic_receipt_no IS NOT NULL
        AND transaction.is_current = TRUE
      ORDER BY transaction.transaction_date, transaction.id
      FOR UPDATE OF transaction`,
    [month],
  );
  const results: MonthlyContractReceiptReconciliationResult[] = [];
  const affectedFileIds = new Set<string>();
  const initialLinks = new Map<string, MonthlyFinancialBankLinkResult>();
  const groupEligibleTransactionIds: string[] = [];

  for (const transaction of transactions.rows) {
    const linkResult = await linkMonthlyFinancialBankTransaction(
      client,
      transaction.id,
      actorId,
      now,
    );
    initialLinks.set(transaction.id, linkResult);
    if (
      transaction.direction === "inflow" &&
      ["main_income", "unclassified"].includes(transaction.category) &&
      linkResult.matched.length === 0 &&
      linkResult.conflicts.length === 0
    ) {
      groupEligibleTransactionIds.push(transaction.id);
    }
  }

  const groupResults =
    await bridgeMonthlyBankTransactionGroupsToContractRegistrations(
      client,
      groupEligibleTransactionIds,
      actorId,
      actorRole,
      now,
    );
  const groupResultByTransaction = new Map<
    string,
    MonthlyContractBridgeGroupResult
  >();
  const createdGroupResults: MonthlyContractBridgeGroupResult[] = [];
  const createdSingleResults: MonthlyContractBridgeResult[] = [];
  try {
    for (const groupResult of groupResults) {
      for (const transactionId of groupResult.transactionIds) {
        groupResultByTransaction.set(transactionId, groupResult);
      }
      if (groupResult.status !== "created") continue;
      createdGroupResults.push(groupResult);
      for (const receipt of groupResult.receipts) {
        const linkResult = await linkMonthlyFinancialBankTransaction(
          client,
          receipt.transactionId,
          actorId,
          now,
        );
        const bridgedReceiptLinked = linkResult.matched.some(
          (match) =>
            match.businessObjectType === "contract_receipt" &&
            match.businessObjectId === receipt.receiptRecordId,
        );
        if (
          linkResult.categoryOverride !== "main_income" ||
          !bridgedReceiptLinked
        ) {
          throw new Error(
            "月报多张回单已补入合同，但其中一张未能按完整字段建立唯一挂载",
          );
        }
        initialLinks.set(receipt.transactionId, linkResult);
      }
    }

    for (const transaction of transactions.rows) {
      let linkResult = initialLinks.get(transaction.id)!;
      const groupResult = groupResultByTransaction.get(transaction.id);
      const shouldTryDraftBridge =
        (!groupResult || groupResult.status === "pending") &&
        transaction.direction === "inflow" &&
        ["main_income", "unclassified"].includes(transaction.category) &&
        linkResult.matched.length === 0 &&
        linkResult.conflicts.length === 0;
      const bridgeResult = shouldTryDraftBridge
        ? await bridgeMonthlyBankTransactionToContractRegistration(
            client,
            transaction.id,
            actorId,
            actorRole,
            now,
          )
        : null;
      if (bridgeResult?.status === "created") {
        createdSingleResults.push(bridgeResult);
        linkResult = await linkMonthlyFinancialBankTransaction(
          client,
          transaction.id,
          actorId,
          now,
        );
        const bridgedReceiptLinked = linkResult.matched.some(
          (match) =>
            match.businessObjectType === "contract_receipt" &&
            match.businessObjectId === bridgeResult.receiptRecordId,
        );
        if (
          linkResult.categoryOverride !== "main_income" ||
          !bridgedReceiptLinked
        ) {
          throw new Error(
            "月报回单已补入合同，但完整字段复核未能建立唯一挂载，已回滚本次同步",
          );
        }
      }
      const matchedCategory = linkResult.categoryOverride;
      const bridgeWarning =
        groupResult?.status === "pending"
          ? groupResult.warnings[0]
          : bridgeResult?.status === "pending"
            ? bridgeResult.warnings[0]
            : null;
      const contractWarning = matchedCategory
        ? null
        : linkResult.conflicts.length > 0
          ? "MONTHLY_BANK_CONTRACT_MATCH_REQUIRED: 存在同回单号合同记录，但完整账号、交易日期、金额、确认状态或合同分类不一致，已转为待核对"
          : bridgeWarning
            ? `MONTHLY_BANK_CONTRACT_MATCH_REQUIRED: ${bridgeWarning}`
            : "MONTHLY_BANK_CONTRACT_MATCH_REQUIRED: 未找到对应的已确认合同收付款记录，已保存银行回单并转为待关联";
      const warnings = contractTransactionWarnings(
        transaction.warnings_json || [],
        contractWarning,
      );
      const nextCategory = matchedCategory || transaction.category;
      const nextRecognitionStatus = matchedCategory
        ? "recognized"
        : "review_required";
      const transactionChanged =
        transaction.category !== nextCategory ||
        transaction.recognition_status !== nextRecognitionStatus ||
        transaction.include_in_report !== false ||
        stableJsonStringify(transaction.warnings_json || []) !==
          stableJsonStringify(warnings);
      if (transactionChanged) {
        await client.query(
          `UPDATE monthly_financial_bank_transactions
            SET category = $2, recognition_status = $3,
                include_in_report = FALSE, warnings_json = $4::jsonb,
                updated_at = $5
          WHERE id = $1 AND is_current = TRUE`,
          [
            transaction.id,
            nextCategory,
            nextRecognitionStatus,
            JSON.stringify(warnings),
            now,
          ],
        );
      }
      affectedFileIds.add(transaction.current_file_id);
      results.push({
        transactionId: transaction.id,
        status: matchedCategory ? "matched" : "pending",
        category: nextCategory,
        changed:
          Boolean(groupResult?.changed) ||
          Boolean(bridgeResult?.changed) ||
          linkResult.changed ||
          transactionChanged,
        warnings: matchedCategory ? [] : [contractWarning!],
      });
    }

    for (const fileId of affectedFileIds) {
      const fileResult = await client.query<{
        recognition_status: string;
        warnings_json: string[];
        included_receipt_count: number;
      }>(
        `SELECT recognition_status, warnings_json, included_receipt_count
         FROM monthly_financial_bank_files
        WHERE id = $1 AND is_active = TRUE
        FOR UPDATE`,
        [fileId],
      );
      const file = fileResult.rows[0];
      if (!file) continue;
      const summary = await client.query<{
        review_count: number;
        included_count: number;
      }>(
        `SELECT
         COUNT(*) FILTER (
           WHERE recognition_status = 'review_required'
         )::int AS review_count,
         COUNT(*) FILTER (WHERE include_in_report)::int AS included_count
       FROM monthly_financial_bank_transactions
       WHERE current_file_id = $1 AND is_current = TRUE`,
        [fileId],
      );
      const reviewCount = Number(summary.rows[0]?.review_count || 0);
      const includedCount = Number(summary.rows[0]?.included_count || 0);
      const warnings = uniqueWarnings(
        (file.warnings_json || []).filter(
          (warning) => warning !== CONTRACT_PENDING_FILE_WARNING,
        ),
      );
      if (reviewCount > 0) warnings.push(CONTRACT_PENDING_FILE_WARNING);
      const recognitionStatus = reviewCount > 0 ? "partial" : "recognized";
      if (
        file.recognition_status !== recognitionStatus ||
        file.included_receipt_count !== includedCount ||
        stableJsonStringify(file.warnings_json || []) !==
          stableJsonStringify(warnings)
      ) {
        await client.query(
          `UPDATE monthly_financial_bank_files
            SET recognition_status = $2, included_receipt_count = $3,
                warnings_json = $4::jsonb, updated_at = $5
          WHERE id = $1 AND is_active = TRUE`,
          [
            fileId,
            recognitionStatus,
            includedCount,
            JSON.stringify(warnings),
            now,
          ],
        );
        for (const result of results) {
          if (
            transactions.rows.find(
              (transaction) =>
                transaction.id === result.transactionId &&
                transaction.current_file_id === fileId,
            )
          ) {
            result.changed = true;
          }
        }
      }
    }

    return results;
  } catch (error) {
    for (const groupResult of createdGroupResults) {
      await cleanupMonthlyContractBridgeGroupFiles(groupResult);
    }
    for (const bridgeResult of createdSingleResults) {
      await cleanupMonthlyContractBridgeGroupFiles(bridgeResult);
    }
    throw error;
  }
}
