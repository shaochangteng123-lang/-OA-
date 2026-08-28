import { nanoid } from "nanoid";
import type { PoolClient } from "pg";

import { MONTHLY_BANK_ACCOUNTS } from "./monthlyFinancialBankStatement.js";

type SalaryDisplayObjectType = "employee_profile" | "human_cost_receipt_item";

interface SalaryBankTransaction {
  id: string;
  report_month: string;
  account_code: string;
  electronic_receipt_no: string | null;
  normalized_electronic_receipt_no: string | null;
  transaction_date: string | null;
  amount: string | null;
  direction: string | null;
  payer_name: string | null;
  payer_account: string | null;
  payee_name: string | null;
  payee_account: string | null;
  category: string;
  recognition_status: string;
}

interface SalaryEmployeeLink {
  employee_id: string;
  employee_name: string;
  bank_account_number: string | null;
}

interface ExistingSalaryReceiptItem {
  id: string;
  receipt_id: string;
  employee_id: string | null;
  payee_name: string;
  payee_account: string;
  amount: string;
  proof_no: string | null;
  page_no: number;
  position: string;
  match_status: string;
  payroll_month: string;
  recognition_status: string;
  file_name: string;
  file_path: string;
  file_hash: string;
}

interface SalaryLinkInput {
  transactionId: string;
  businessObjectType: SalaryDisplayObjectType;
  businessObjectId: string;
  matchStatus: "active" | "conflict";
  matchMethod: "electronic_receipt_no" | "account_date_amount";
  matchKey: Record<string, unknown>;
  allocatedAmount: string | null;
  warnings: string[];
  actorId: string;
  now: string;
}

export interface MonthlySalaryReceiptReconciliationResult {
  transactionId: string;
  status: "ignored" | "attached" | "replaced" | "conflict";
  employeeId: string | null;
  linkIds: string[];
  previousReceiptItemId: string | null;
  warnings: string[];
  changed: boolean;
}

interface SalaryLinkWriteResult {
  id: string;
  changed: boolean;
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

function normalizeAccount(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

function normalizePersonName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .trim();
}

function amountToCents(value: unknown): bigint | null {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[,，\s]/gu, "");
  const match = normalized.match(/^([0-9]+)(?:\.([0-9]{1,2}))?$/u);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
}

function uniqueWarnings(values: readonly (string | null)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
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

function exactTextCheck(
  label: string,
  transactionValue: unknown,
  expectedValue: unknown,
  normalize: (value: unknown) => string,
): string | null {
  const transactionText = normalize(transactionValue);
  const expectedText = normalize(expectedValue);
  if (!transactionText) return `银行工资回单缺少${label}`;
  if (!expectedText) return `员工或原工资回单缺少${label}`;
  return transactionText === expectedText ? null : `${label}不一致`;
}

function exactAmountCheck(
  transactionAmount: unknown,
  expectedAmount: unknown,
): string | null {
  const transactionCents = amountToCents(transactionAmount);
  const expectedCents = amountToCents(expectedAmount);
  if (transactionCents === null) return "银行工资回单缺少有效金额";
  if (expectedCents === null) return "原工资回单缺少有效金额";
  return transactionCents === expectedCents ? null : "工资回单金额不一致";
}

function salaryTransactionBaseWarnings(
  transaction: SalaryBankTransaction,
  employee: SalaryEmployeeLink,
): string[] {
  const transactionMonth = String(transaction.transaction_date || "").slice(
    0,
    7,
  );
  return uniqueWarnings([
    normalizeIdentifier(transaction.electronic_receipt_no) ||
    normalizeIdentifier(transaction.normalized_electronic_receipt_no)
      ? null
      : "银行工资回单缺少电子回单号",
    normalizeAccount(transaction.payer_account) ===
    normalizeAccount(MONTHLY_BANK_ACCOUNTS.basic.accountNumber)
      ? null
      : "工资回单付款账号不是基本账户完整账号",
    exactTextCheck(
      "收款账号",
      transaction.payee_account,
      employee.bank_account_number,
      normalizeAccount,
    ),
    exactTextCheck(
      "收款人姓名",
      transaction.payee_name,
      employee.employee_name,
      normalizePersonName,
    ),
    amountToCents(transaction.amount) === null
      ? "银行工资回单缺少有效金额"
      : null,
    transactionMonth && transactionMonth === transaction.report_month
      ? null
      : "工资回单交易日期与工资月份不一致",
  ]);
}

function salaryReceiptItemWarnings(
  transaction: SalaryBankTransaction,
  employee: SalaryEmployeeLink,
  item: ExistingSalaryReceiptItem,
): string[] {
  const normalizedReceiptNo =
    normalizeIdentifier(transaction.electronic_receipt_no) ||
    normalizeIdentifier(transaction.normalized_electronic_receipt_no);
  return uniqueWarnings([
    item.employee_id === employee.employee_id
      ? null
      : "原工资回单关联员工不一致",
    normalizeIdentifier(item.proof_no)
      ? normalizeIdentifier(item.proof_no) === normalizedReceiptNo
        ? null
        : "电子回单号不一致"
      : "原工资回单缺少电子回单号",
    exactTextCheck(
      "收款账号",
      transaction.payee_account,
      item.payee_account,
      normalizeAccount,
    ),
    exactTextCheck(
      "收款人姓名",
      transaction.payee_name,
      item.payee_name,
      normalizePersonName,
    ),
    exactAmountCheck(transaction.amount, item.amount),
    item.match_status === "matched" ? null : "原工资回单未唯一匹配员工",
    ["recognized", "partial"].includes(item.recognition_status)
      ? null
      : "原工资回单尚未完成识别",
  ]);
}

async function ensureSalaryDisplayLink(
  client: PoolClient,
  input: SalaryLinkInput,
): Promise<SalaryLinkWriteResult> {
  const existing = await client.query<{
    id: string;
    match_method: string;
    match_status: string;
    match_key_json: unknown;
    allocated_amount: string | null;
    warnings_json: unknown;
    is_active: boolean;
  }>(
    `SELECT id, match_method, match_status, match_key_json,
            allocated_amount::text AS allocated_amount,
            warnings_json, is_active
     FROM monthly_financial_bank_transaction_links
     WHERE transaction_id = $1
       AND business_object_type = $2
       AND business_object_id = $3
       AND link_kind = 'display_replacement'
       AND match_status IN ('active', 'conflict', 'dismissed', 'replaced')
     ORDER BY updated_at DESC, id DESC
     FOR UPDATE`,
    [input.transactionId, input.businessObjectType, input.businessObjectId],
  );
  const target = existing.rows[0];
  const matchKeyJson = stableJsonStringify(input.matchKey);
  const warningsJson = stableJsonStringify(uniqueWarnings(input.warnings));
  if (target) {
    const existingMatchKey = stableJsonStringify(target.match_key_json);
    const existingWarnings = stableJsonStringify(target.warnings_json);
    const shouldBeActive = input.matchStatus === "active";
    const changed =
      target.match_method !== input.matchMethod ||
      target.match_status !== input.matchStatus ||
      existingMatchKey !== stableJsonStringify(input.matchKey) ||
      amountToCents(target.allocated_amount) !==
        amountToCents(input.allocatedAmount) ||
      existingWarnings !==
        stableJsonStringify(uniqueWarnings(input.warnings)) ||
      target.is_active !== shouldBeActive;
    if (changed) {
      await client.query(
        `UPDATE monthly_financial_bank_transaction_links
       SET match_method = $2, match_status = $3,
           match_key_json = $4::jsonb, allocated_amount = $5::numeric,
           warnings_json = $6::jsonb, is_active = ($3 = 'active'),
           updated_at = $7
       WHERE id = $1`,
        [
          target.id,
          input.matchMethod,
          input.matchStatus,
          matchKeyJson,
          input.allocatedAmount,
          warningsJson,
          input.now,
        ],
      );
    }
    const duplicateIds = existing.rows.slice(1).map((row) => row.id);
    if (duplicateIds.length > 0) {
      await client.query(
        `UPDATE monthly_financial_bank_transaction_links
         SET match_status = 'dismissed', is_active = FALSE, updated_at = $2
         WHERE id = ANY($1::text[])`,
        [duplicateIds, input.now],
      );
    }
    return { id: target.id, changed: changed || duplicateIds.length > 0 };
  }

  const linkId = `mfbl_${nanoid(16)}`;
  await client.query(
    `INSERT INTO monthly_financial_bank_transaction_links(
       id, transaction_id, business_object_type, business_object_id,
       link_kind, match_method, match_status, match_key_json,
       allocated_amount, warnings_json, is_active, created_by,
       created_at, updated_at
     ) VALUES(
       $1,$2,$3,$4,'display_replacement',$5,$6,$7::jsonb,$8::numeric,
       $9::jsonb,($6 = 'active'),$10,$11,$11
     )`,
    [
      linkId,
      input.transactionId,
      input.businessObjectType,
      input.businessObjectId,
      input.matchMethod,
      input.matchStatus,
      matchKeyJson,
      input.allocatedAmount,
      warningsJson,
      input.actorId,
      input.now,
    ],
  );
  return { id: linkId, changed: true };
}

async function dismissStaleSalaryLinks(
  client: PoolClient,
  transactionId: string,
  keepLinkIds: string[],
  now: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE monthly_financial_bank_transaction_links
     SET match_status = 'dismissed', is_active = FALSE, updated_at = $3
     WHERE transaction_id = $1
       AND link_kind = 'display_replacement'
       AND business_object_type IN (
         'employee_profile', 'human_cost_receipt_item'
       )
       AND NOT (id = ANY($2::text[]))
       AND match_status IN ('active', 'conflict')`,
    [transactionId, keepLinkIds, now],
  );
  return Number(result.rowCount || 0) > 0;
}

function salaryEvidenceMatchKey(input: {
  transaction: SalaryBankTransaction;
  employee: SalaryEmployeeLink;
  displayAction: "attached" | "replaced";
  previousItem?: ExistingSalaryReceiptItem;
}): Record<string, unknown> {
  const { transaction, employee, displayAction, previousItem } = input;
  return {
    displayAction,
    employeeId: employee.employee_id,
    normalizedElectronicReceiptNo:
      normalizeIdentifier(transaction.electronic_receipt_no) ||
      normalizeIdentifier(transaction.normalized_electronic_receipt_no),
    transaction: {
      transactionDate: transaction.transaction_date,
      amount: transaction.amount,
      payerAccount: normalizeAccount(transaction.payer_account),
      payeeName: normalizePersonName(transaction.payee_name),
      payeeAccount: normalizeAccount(transaction.payee_account),
    },
    previousEvidence: previousItem
      ? {
          receiptId: previousItem.receipt_id,
          receiptItemId: previousItem.id,
          fileName: previousItem.file_name,
          filePath: previousItem.file_path,
          fileHash: previousItem.file_hash,
          proofNo: previousItem.proof_no,
          payrollMonth: previousItem.payroll_month,
          payeeName: previousItem.payee_name,
          payeeAccount: normalizeAccount(previousItem.payee_account),
          amount: previousItem.amount,
          pageNo: previousItem.page_no,
          position: previousItem.position,
        }
      : null,
  };
}

/**
 * 将基本账户的一笔工资回单挂到唯一员工的工资明细。
 *
 * 本函数只写证据链接，不修改工资记录、人力成本金额或原工资回单。员工当月
 * 已有回单时，只有电子回单号、员工、姓名、完整账号和金额全部一致才切换
 * 当前展示证据；旧人力成本回单继续保留，供审计预览。
 */
export async function reconcileMonthlySalaryReceiptTransaction(
  client: PoolClient,
  transactionId: string,
  actorId: string,
  now: string,
): Promise<MonthlySalaryReceiptReconciliationResult> {
  const transactionResult = await client.query<SalaryBankTransaction>(
    `SELECT transaction.id, transaction.report_month,
            transaction.account_code, transaction.electronic_receipt_no,
            transaction.normalized_electronic_receipt_no,
            transaction.transaction_date, transaction.amount::text AS amount,
            transaction.direction, transaction.payer_name,
            transaction.payer_account, transaction.payee_name,
            transaction.payee_account, transaction.category,
            transaction.recognition_status
     FROM monthly_financial_bank_transactions transaction
     JOIN monthly_financial_bank_files file
       ON file.id = transaction.current_file_id
      AND file.is_active = TRUE
     WHERE transaction.id = $1
       AND transaction.is_current = TRUE
     FOR UPDATE OF transaction`,
    [transactionId],
  );
  const transaction = transactionResult.rows[0];
  if (
    !transaction ||
    transaction.account_code !== "basic" ||
    transaction.category !== "salary" ||
    transaction.direction !== "outflow" ||
    transaction.recognition_status !== "recognized"
  ) {
    return {
      transactionId,
      status: "ignored",
      employeeId: null,
      linkIds: [],
      previousReceiptItemId: null,
      warnings: [],
      changed: false,
    };
  }

  const employeeResult = await client.query<SalaryEmployeeLink>(
    `SELECT link.business_object_id AS employee_id,
            employee.name AS employee_name,
            COALESCE(employee.bank_account_number,
                     user_account.bank_account_number) AS bank_account_number
     FROM monthly_financial_bank_transaction_links link
     JOIN employee_profiles employee
       ON employee.id = link.business_object_id
     LEFT JOIN users user_account ON user_account.id = employee.user_id
     WHERE link.transaction_id = $1
       AND link.business_object_type = 'employee_profile'
       AND link.link_kind = 'classification_basis'
       AND link.match_status = 'active'
       AND link.is_active = TRUE
     ORDER BY link.updated_at DESC, link.id DESC
     FOR UPDATE OF link`,
    [transactionId],
  );
  if (employeeResult.rows.length !== 1) {
    return {
      transactionId,
      status: "conflict",
      employeeId: null,
      linkIds: [],
      previousReceiptItemId: null,
      warnings: ["工资银行回单未唯一关联员工"],
      changed: false,
    };
  }
  const employee = employeeResult.rows[0]!;
  const normalizedReceiptNo =
    normalizeIdentifier(transaction.electronic_receipt_no) ||
    normalizeIdentifier(transaction.normalized_electronic_receipt_no);
  const baseWarnings = salaryTransactionBaseWarnings(transaction, employee);

  const itemResult = await client.query<ExistingSalaryReceiptItem>(
    `SELECT item.id, item.receipt_id, item.employee_id, item.payee_name,
            item.payee_account, item.amount::text AS amount, item.proof_no,
            item.page_no, item.position, item.match_status,
            receipt.payroll_month, receipt.recognition_status,
            receipt.file_name, receipt.file_path, receipt.file_hash
     FROM human_cost_receipt_items item
     JOIN human_cost_receipts receipt ON receipt.id = item.receipt_id
     WHERE receipt.category = 'net_salary'
       AND receipt.recognition_status IN ('recognized', 'partial')
       AND $1 <> ''
       AND UPPER(REGEXP_REPLACE(
         NORMALIZE(BTRIM(COALESCE(item.proof_no, '')), NFKC),
         '[^[:alnum:]]+', '', 'g'
       )) = $1
     ORDER BY receipt.created_at, receipt.id, item.page_no, item.position
     FOR SHARE OF item, receipt`,
    [normalizedReceiptNo],
  );
  const candidates = itemResult.rows;
  const proofCandidates = candidates.filter(
    (item) =>
      Boolean(normalizedReceiptNo) &&
      normalizeIdentifier(item.proof_no) === normalizedReceiptNo,
  );
  const checks = candidates.map((item) => ({
    item,
    warnings: uniqueWarnings([
      ...baseWarnings,
      ...salaryReceiptItemWarnings(transaction, employee, item),
    ]),
  }));
  const exactCandidates = checks.filter((entry) => entry.warnings.length === 0);
  const proofCollision = proofCandidates.some(
    (candidate) =>
      !exactCandidates.some((entry) => entry.item.id === candidate.id),
  );

  if (
    baseWarnings.length === 0 &&
    exactCandidates.length === 1 &&
    !proofCollision
  ) {
    const previousItem = exactCandidates[0]!.item;
    const link = await ensureSalaryDisplayLink(client, {
      transactionId,
      businessObjectType: "human_cost_receipt_item",
      businessObjectId: previousItem.id,
      matchStatus: "active",
      matchMethod: "electronic_receipt_no",
      matchKey: salaryEvidenceMatchKey({
        transaction,
        employee,
        displayAction: "replaced",
        previousItem,
      }),
      allocatedAmount: transaction.amount,
      warnings: [],
      actorId,
      now,
    });
    const dismissed = await dismissStaleSalaryLinks(
      client,
      transactionId,
      [link.id],
      now,
    );
    return {
      transactionId,
      status: "replaced",
      employeeId: employee.employee_id,
      linkIds: [link.id],
      previousReceiptItemId: previousItem.id,
      warnings: [],
      changed: link.changed || dismissed,
    };
  }

  if (baseWarnings.length === 0 && proofCandidates.length === 0) {
    const link = await ensureSalaryDisplayLink(client, {
      transactionId,
      businessObjectType: "employee_profile",
      businessObjectId: employee.employee_id,
      matchStatus: "active",
      matchMethod: "account_date_amount",
      matchKey: salaryEvidenceMatchKey({
        transaction,
        employee,
        displayAction: "attached",
      }),
      allocatedAmount: transaction.amount,
      warnings: [],
      actorId,
      now,
    });
    const dismissed = await dismissStaleSalaryLinks(
      client,
      transactionId,
      [link.id],
      now,
    );
    return {
      transactionId,
      status: "attached",
      employeeId: employee.employee_id,
      linkIds: [link.id],
      previousReceiptItemId: null,
      warnings: [],
      changed: link.changed || dismissed,
    };
  }

  const conflictingEntries = checks.length
    ? checks
    : [
        {
          item: null,
          warnings: uniqueWarnings([
            ...baseWarnings,
            exactCandidates.length > 1
              ? "同一工资回单命中多条完整一致的历史凭证"
              : null,
            proofCollision ? "电子回单号已指向其他工资凭证" : null,
          ]),
        },
      ];
  const linkIds: string[] = [];
  let changed = false;
  const allWarnings: string[] = [];
  for (const entry of conflictingEntries) {
    const warnings = uniqueWarnings([
      ...entry.warnings,
      exactCandidates.length > 1
        ? "同一工资回单命中多条完整一致的历史凭证"
        : null,
      proofCollision ? "电子回单号已指向其他工资凭证" : null,
    ]);
    allWarnings.push(...warnings);
    const targetItem = entry.item;
    const link = await ensureSalaryDisplayLink(client, {
      transactionId,
      businessObjectType: targetItem
        ? "human_cost_receipt_item"
        : "employee_profile",
      businessObjectId: targetItem?.id || employee.employee_id,
      matchStatus: "conflict",
      matchMethod: normalizedReceiptNo
        ? "electronic_receipt_no"
        : "account_date_amount",
      matchKey: {
        ...salaryEvidenceMatchKey({
          transaction,
          employee,
          displayAction: targetItem ? "replaced" : "attached",
          ...(targetItem ? { previousItem: targetItem } : {}),
        }),
        strictVerificationPassed: false,
      },
      allocatedAmount: transaction.amount,
      warnings,
      actorId,
      now,
    });
    linkIds.push(link.id);
    changed ||= link.changed;
  }
  changed ||= await dismissStaleSalaryLinks(
    client,
    transactionId,
    linkIds,
    now,
  );
  return {
    transactionId,
    status: "conflict",
    employeeId: employee.employee_id,
    linkIds,
    previousReceiptItemId: null,
    warnings: uniqueWarnings(allWarnings),
    changed,
  };
}

export async function reconcileMonthlySalaryReceiptMonth(
  client: PoolClient,
  month: string,
  actorId: string,
  now: string,
): Promise<MonthlySalaryReceiptReconciliationResult[]> {
  const transactions = await client.query<{ id: string }>(
    `SELECT transaction.id
     FROM monthly_financial_bank_transactions transaction
     JOIN monthly_financial_bank_files file
       ON file.id = transaction.current_file_id
      AND file.is_active = TRUE
     WHERE transaction.report_month = $1
       AND transaction.account_code = 'basic'
       AND transaction.category = 'salary'
       AND transaction.direction = 'outflow'
       AND transaction.recognition_status = 'recognized'
       AND transaction.is_current = TRUE
     ORDER BY transaction.transaction_date, transaction.id`,
    [month],
  );
  const results: MonthlySalaryReceiptReconciliationResult[] = [];
  for (const transaction of transactions.rows) {
    results.push(
      await reconcileMonthlySalaryReceiptTransaction(
        client,
        transaction.id,
        actorId,
        now,
      ),
    );
  }
  return results;
}
