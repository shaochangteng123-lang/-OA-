import fs from "fs";
import path from "path";

import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import { db, pool } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { normalizeUploadFileName } from "../utils/upload-file-name.js";
import {
  calculateMainBusinessIncome,
  type ContractRateBasisPoints,
} from "../services/contractAccounting.js";
import {
  calculatePayrollBreakdown,
  calculatePayrollTotals,
  type PayrollAmountField,
} from "../services/payrollCalculator.js";
import {
  MANUAL_CATEGORY_RULES,
  addFinancialAmounts,
  assertFinancialMonth,
  buildMonthlyFinancialReportView,
  centsToFinancialAmount,
  emptyAccountAmounts,
  isNegativeFinancialAmount,
  normalizeFinancialAmount,
  normalizeOpeningBalances,
  previousFinancialMonth,
  subtractFinancialAmounts,
  validateManualItems,
} from "../services/monthlyFinancialReport.js";
import {
  buildMonthlyFinancialTrendData,
  listMonthlyFinancialTrendMonths,
  type MonthlyFinancialTrendReportInput,
} from "../services/monthlyFinancialTrend.js";
import { buildMonthlyFinancialWorkbook } from "../services/monthlyFinancialReportWorkbook.js";
import {
  MONTHLY_BANK_ACCOUNTS,
  analyzeMonthlyFinancialBankFile,
  calculateMonthlyBankFileHash,
  normalizeMonthlyBankAccount,
  type MonthlyBankAccountCode,
  type MonthlyBankFileAnalysis,
  type MonthlyBankRecognizedTransaction,
} from "../services/monthlyFinancialBankStatement.js";
import {
  linkMonthlyFinancialBankTransaction,
  reconcileMonthlyContractBankTransactions,
  type MonthlyContractReceiptReconciliationResult,
} from "../services/monthlyFinancialBankLinker.js";
import {
  reconcileMonthlyReimbursementTransactions,
  type MonthlyReimbursementReconciliationResult,
} from "../services/monthlyFinancialReimbursementMatcher.js";
import {
  reconcileMonthlySalaryReceiptMonth,
  type MonthlySalaryReceiptReconciliationResult,
} from "../services/monthlyFinancialSalaryReceiptMatcher.js";
import {
  FINANCIAL_ACCOUNT_CODES,
  type FinancialAccountAmounts,
  type FinancialAccountCode,
  type MonthlyFinancialAutomaticSnapshot,
  type MonthlyFinancialManualItemInput,
  type MonthlyFinancialReportStatus,
  type MonthlyFinancialReportView,
} from "../types/monthly-financial-report.js";

const router = Router();
const READ_ROLES = ["admin", "general_manager"];
const WRITE_ROLES = ["admin"];
const FORMULA_VERSION = "monthly-finance-v4-welfare-demand-layout";
const MONTHLY_BANK_UPLOAD_ROOT = path.join(
  process.cwd(),
  "uploads",
  "monthly-financial-bank",
);
const MONTHLY_BANK_INCOMING_ROOT = path.join(
  MONTHLY_BANK_UPLOAD_ROOT,
  "incoming",
);
const MONTHLY_BANK_RECOGNIZED_ROOT = path.join(
  MONTHLY_BANK_UPLOAD_ROOT,
  "recognized",
);
const PREVIOUS_PAYMENT_PROOF_ROOTS = [
  path.join(process.cwd(), "uploads", "invoices"),
  path.join(process.cwd(), "uploads", "bank-receipts"),
  MONTHLY_BANK_UPLOAD_ROOT,
];

for (const directory of [
  MONTHLY_BANK_INCOMING_ROOT,
  MONTHLY_BANK_RECOGNIZED_ROOT,
]) {
  fs.mkdirSync(directory, { recursive: true });
}

// 成功文件会移动到各自证据目录；incoming 仅保留处理中临时文件。
// 服务异常退出遗留的临时文件在一天后清理，避免误删仍在处理的请求。
for (const fileName of fs.readdirSync(MONTHLY_BANK_INCOMING_ROOT)) {
  const filePath = path.join(MONTHLY_BANK_INCOMING_ROOT, fileName);
  try {
    const stats = fs.statSync(filePath);
    if (stats.isFile() && Date.now() - stats.mtimeMs > 24 * 60 * 60 * 1000) {
      fs.rmSync(filePath, { force: true });
    }
  } catch {
    // 临时文件并发消失不影响服务启动。
  }
}

const monthlyBankUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) =>
      callback(null, MONTHLY_BANK_INCOMING_ROOT),
    filename: (_req, file, callback) =>
      callback(
        null,
        `monthly-bank-${Date.now()}-${nanoid(12)}${path.extname(file.originalname).toLowerCase() || ".pdf"}`,
      ),
  }),
  limits: { files: 3, fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension !== ".pdf") {
      callback(new Error("银行回单仅支持 PDF 文件"));
      return;
    }
    callback(null, true);
  },
});

type QueryClient = Pick<PoolClient, "query">;

class MonthlyFinancialRouteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MonthlyFinancialRouteError";
  }
}

function badRequest(code: string, message: string): MonthlyFinancialRouteError {
  return new MonthlyFinancialRouteError(400, code, message);
}

function conflict(code: string, message: string): MonthlyFinancialRouteError {
  return new MonthlyFinancialRouteError(409, code, message);
}

function dataIntegrity(message: string): MonthlyFinancialRouteError {
  return new MonthlyFinancialRouteError(
    500,
    "MONTHLY_FINANCE_DATA_INTEGRITY_ERROR",
    message,
  );
}

function toPostgresPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function queryAll<T>(
  sql: string,
  params: unknown[],
  client?: QueryClient,
): Promise<T[]> {
  if (!client) return db.all<T>(sql, ...params);
  const result = await client.query(toPostgresPlaceholders(sql), params);
  return result.rows as T[];
}

async function queryOne<T>(
  sql: string,
  params: unknown[],
  client?: QueryClient,
): Promise<T | null> {
  if (!client) return (await db.get<T>(sql, ...params)) || null;
  const result = await client.query(toPostgresPlaceholders(sql), params);
  return (result.rows[0] as T | undefined) || null;
}

async function lockFinancialMonth(
  client: QueryClient,
  month: string,
): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `monthly-financial-report:${month}`,
  ]);
}

interface ReportRow {
  id: string;
  report_month: string;
  status: MonthlyFinancialReportStatus;
  version: number;
  opening_balances_json: FinancialAccountAmounts;
  automatic_snapshot_json: MonthlyFinancialAutomaticSnapshot | null;
  closing_balances_json: FinancialAccountAmounts | null;
  last_refreshed_at: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  reopened_at: string | null;
  updated_at: string;
}

interface PreviousReportContext {
  isFirstMonth: boolean;
  previousMonthClosed: boolean;
  openingBalances: FinancialAccountAmounts;
}

interface LoadedMonthlyReport {
  report: ClientMonthlyReport;
  internal: MonthlyFinancialReportView;
  automatic: MonthlyFinancialAutomaticSnapshot;
  previous: PreviousReportContext;
}

interface FinancialActor {
  id: string;
  role: string;
  name: string;
}

async function invalidateClosedReportRows(input: {
  client: QueryClient;
  rows: ReportRow[];
  sourceMonth: string;
  actor: FinancialActor;
  now: string;
  reason: string;
}): Promise<string[]> {
  const { client, sourceMonth, actor, now, reason } = input;
  const closedRows = input.rows.filter((row) => row.status === "closed");
  for (const row of closedRows) {
    const nextVersion = row.version + 1;
    const rowReason = `因${sourceMonth}历史月发生变化，后续承接链需重新核算：${reason}`;
    await client.query(
      `UPDATE monthly_financial_reports
       SET status = 'reopened', version = $2,
           closing_balances_json = NULL, closed_at = NULL, closed_by = NULL,
           reopened_at = $3, reopened_by = $4, reopen_reason = $5,
           updated_by = $4, updated_at = $3
       WHERE id = $1`,
      [row.id, nextVersion, now, actor.id, rowReason],
    );
    await client.query(
      `INSERT INTO monthly_financial_audit_logs(
         id, report_id, report_version, action, actor_id, actor_role, reason, changes_json, created_at
       ) VALUES($1, $2, $3, 'reopen', $4, $5, $6, $7::jsonb, $8)`,
      [
        `mfal_${nanoid(16)}`,
        row.id,
        nextVersion,
        actor.id,
        actor.role,
        rowReason,
        JSON.stringify({
          previousClosedVersion: row.version,
          invalidatedByMonth: sourceMonth,
          cascaded: true,
          preservedSnapshotVersion: row.version,
        }),
        now,
      ],
    );
  }
  return closedRows.map((row) => row.report_month);
}

function summarizeManualItemChanges(
  before: MonthlyFinancialManualItemInput[],
  after: MonthlyFinancialManualItemInput[],
): Record<string, unknown> {
  const beforeById = new Map(before.map((item) => [item.id!, item]));
  const afterById = new Map(after.map((item) => [item.id!, item]));
  const comparable = (item: MonthlyFinancialManualItemInput) => ({
    category: item.category,
    accountCode: item.accountCode,
    direction: item.direction,
    amount: item.amount,
    occurredOn: item.occurredOn,
    description: item.description || null,
    voucherReference: item.voucherReference || null,
  });
  const addedIds = [...afterById.keys()].filter((id) => !beforeById.has(id));
  const removedIds = [...beforeById.keys()].filter((id) => !afterById.has(id));
  const changedIds = [...afterById.keys()].filter((id) => {
    const oldItem = beforeById.get(id);
    return (
      oldItem &&
      JSON.stringify(comparable(oldItem)) !==
        JSON.stringify(comparable(afterById.get(id)!))
    );
  });
  return {
    beforeCount: before.length,
    afterCount: after.length,
    beforeTotal: addFinancialAmounts(...before.map((item) => item.amount)),
    afterTotal: addFinancialAmounts(...after.map((item) => item.amount)),
    addedIds,
    removedIds,
    changedIds,
  };
}

interface ClientMonthlyReport {
  [key: string]: unknown;
  month: string;
  status: MonthlyFinancialReportStatus;
  version: number;
  accounts: Array<{
    code: FinancialAccountCode;
    name: string;
    opening: string;
    inflow: string;
    outflow: string;
    closing: string;
  }>;
  income: { mainReceipt: string; [key: string]: string };
  expenses: Record<string, string>;
  automaticDetails: MonthlyFinancialAutomaticSnapshot["details"];
  bank?: MonthlyFinancialAutomaticSnapshot["bank"];
  manualItems: Array<{
    id?: string;
    category: string;
    categoryLabel: string;
    accountCode: FinancialAccountCode;
    direction: string;
    occurredOn: string;
    amount: string;
    description?: string | null;
    voucherReference?: string | null;
    sourceType?: "manual" | "monthly_bank_transaction";
    readOnly?: boolean;
    effective?: boolean;
    previewUrl?: string | null;
  }>;
  validations: {
    canClose: boolean;
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
}

function getActor(req: Request): { id: string; role: string; name: string } {
  const user = req.session.user;
  if (!user?.id || !user.role) throw new Error("登录信息已失效");
  return { id: user.id, role: user.role, name: user.name || "" };
}

async function resolvePreviousPaymentProofPath(
  storedPath: string,
): Promise<string | null> {
  const normalizedPath = storedPath
    .normalize("NFKC")
    .replace(/\\/gu, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!normalizedPath) return null;
  const candidatePath = path.resolve(process.cwd(), normalizedPath);
  const lexicalRoot = PREVIOUS_PAYMENT_PROOF_ROOTS.find(
    (root) =>
      candidatePath !== path.resolve(root) &&
      candidatePath.startsWith(`${path.resolve(root)}${path.sep}`),
  );
  if (!lexicalRoot) return null;
  try {
    const [realCandidate, realRoot] = await Promise.all([
      fs.promises.realpath(candidatePath),
      fs.promises.realpath(lexicalRoot),
    ]);
    if (
      realCandidate === realRoot ||
      !realCandidate.startsWith(`${realRoot}${path.sep}`)
    ) {
      return null;
    }
    const stats = await fs.promises.stat(realCandidate);
    return stats.isFile() ? realCandidate : null;
  } catch {
    return null;
  }
}

function parseExpectedVersion(value: unknown): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 0)
    throw new Error("版本号不正确");
  return version;
}

function asAutomaticSnapshot(
  value: unknown,
): MonthlyFinancialAutomaticSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snapshot = value as MonthlyFinancialAutomaticSnapshot;
  try {
    if (
      !snapshot.income ||
      !snapshot.expenses ||
      !Array.isArray(snapshot.sources) ||
      !Array.isArray(snapshot.details) ||
      typeof snapshot.generatedAt !== "string"
    ) {
      return null;
    }
    const incomeKeys = [
      "mainBusinessReceipts",
      "tax",
      "marketingReserve",
      "businessCost",
      "accountingBase",
    ] as const;
    const expenseKeys = [
      "humanCost",
      "basicReimbursement",
      "largeReimbursement",
      "businessReimbursement",
      "assetAdministration",
    ] as const;
    for (const key of incomeKeys) {
      if (!Object.prototype.hasOwnProperty.call(snapshot.income, key))
        return null;
      normalizeFinancialAmount(snapshot.income[key]);
    }
    for (const key of expenseKeys) {
      if (!Object.prototype.hasOwnProperty.call(snapshot.expenses, key))
        return null;
      normalizeFinancialAmount(snapshot.expenses[key]);
    }
    if (
      !snapshot.sources.every(
        (source) =>
          source &&
          typeof source.code === "string" &&
          typeof source.name === "string" &&
          Number.isInteger(source.recordCount) &&
          source.recordCount >= 0 &&
          typeof source.available === "boolean" &&
          (() => {
            normalizeFinancialAmount(source.amount);
            return true;
          })(),
      )
    ) {
      return null;
    }
    if (snapshot.bank) {
      const validBankAccounts = ["basic", "general", "business"];
      const chargeAccounts = Array.isArray(snapshot.bank.chargeAccounts)
        ? snapshot.bank.chargeAccounts
        : Array.isArray(snapshot.bank.activeAccounts)
          ? snapshot.bank.activeAccounts.filter(
              (code): code is "general" | "business" =>
                code === "general" || code === "business",
            )
          : [];
      if (
        !Array.isArray(snapshot.bank.activeAccounts) ||
        !snapshot.bank.activeAccounts.every((code) =>
          validBankAccounts.includes(code),
        ) ||
        !chargeAccounts.every(
          (code) => code === "general" || code === "business",
        ) ||
        (snapshot.bank.partialAccounts !== undefined &&
          (!Array.isArray(snapshot.bank.partialAccounts) ||
            !snapshot.bank.partialAccounts.every((code) =>
              validBankAccounts.includes(code),
            )))
      ) {
        return null;
      }
      snapshot.bank.chargeAccounts = [...new Set(chargeAccounts)];
      for (const value of [
        snapshot.bank.generalInterest,
        snapshot.bank.businessInterest,
        snapshot.bank.generalBankFee,
        snapshot.bank.businessBankFee,
        snapshot.bank.internalTransferTotal,
      ]) {
        normalizeFinancialAmount(value);
      }
      for (const value of [
        snapshot.bank.reviewRequiredCount,
        snapshot.bank.unclassifiedCount,
        snapshot.bank.conflictCount,
      ]) {
        if (
          value !== undefined &&
          (!Number.isInteger(value) || Number(value) < 0)
        ) {
          return null;
        }
      }
    }
    const hasValidPersonMetadata = snapshot.details.every((detail) => {
      if (
        !detail ||
        typeof detail.sourceType !== "string" ||
        typeof detail.sourceId !== "string" ||
        typeof detail.occurredOn !== "string" ||
        typeof detail.metric !== "string" ||
        typeof detail.description !== "string" ||
        !["general", "business", "welfare_one", "welfare_two"].includes(
          detail.accountCode,
        )
      ) {
        return false;
      }
      normalizeFinancialAmount(detail.amount);
      if (!["payroll", "reimbursement"].includes(detail.sourceType)) {
        return true;
      }
      const hasValidName =
        detail.personName === undefined ||
        detail.personName === null ||
        typeof detail.personName === "string";
      const hasValidId =
        detail.personId === undefined ||
        detail.personId === null ||
        typeof detail.personId === "string";
      return hasValidName && hasValidId;
    });
    return hasValidPersonMetadata ? snapshot : null;
  } catch {
    return null;
  }
}

function asOpeningBalances(
  value: unknown,
  context = "账户余额",
): FinancialAccountAmounts {
  try {
    return normalizeOpeningBalances(value);
  } catch {
    throw dataIntegrity(`${context}数据不完整或格式错误，请联系管理员处理`);
  }
}

function assertClosedSnapshotAccounts(
  publicAccounts: unknown,
  internalAccounts: unknown,
  month: string,
): void {
  if (!Array.isArray(publicAccounts) || !Array.isArray(internalAccounts)) {
    throw dataIntegrity(`${month}月结快照缺少四账户明细`);
  }
  const validate = (
    rows: Array<Record<string, unknown>>,
    amountKeys: string[],
  ): boolean => {
    if (rows.length !== FINANCIAL_ACCOUNT_CODES.length) return false;
    const codes = new Set<string>();
    try {
      for (const row of rows) {
        const code = String(row.code || "");
        if (!FINANCIAL_ACCOUNT_CODES.includes(code as FinancialAccountCode)) {
          return false;
        }
        codes.add(code);
        for (const key of amountKeys) normalizeFinancialAmount(row[key], true);
      }
    } catch {
      return false;
    }
    return codes.size === FINANCIAL_ACCOUNT_CODES.length;
  };
  if (
    !validate(publicAccounts, ["opening", "inflow", "outflow", "closing"]) ||
    !validate(internalAccounts, [
      "openingBalance",
      "income",
      "expense",
      "closingBalance",
    ])
  ) {
    throw dataIntegrity(`${month}月结快照四账户明细不完整或金额格式错误`);
  }
}

function maxUpdatedAt(values: Array<string | null>): string | null {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null
  );
}

function financialAmountToCents(value: unknown): number {
  const cents = Math.round(Number(value || 0) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw dataIntegrity("银行回单金额超出月报可计算范围");
  }
  return cents;
}

function bankTransactionPersonName(input: {
  remark: string | null;
  payee_name: string | null;
}): string | null {
  const remark = String(input.remark || "").normalize("NFKC");
  const match = remark.match(
    /(?:基础报销|大额报销|商务报销|薪资)\s*[-—－:]\s*([\u3400-\u9fff]{2,8})/u,
  );
  return match?.[1] || input.payee_name || null;
}

function resolveRateBasisPoints(
  snapshot: unknown,
): Partial<ContractRateBasisPoints> {
  if (!snapshot || typeof snapshot !== "object") return {};
  const input = snapshot as Record<string, unknown>;
  const output: Partial<ContractRateBasisPoints> = {};
  for (const code of ["tax", "marketing", "business", "financial"] as const) {
    const value = Number(input[code]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      output[code] = Math.round(value * 10000);
    }
  }
  return output;
}

async function resolveMonthlyQueryBatch<T extends readonly unknown[]>(
  tasks: { [K in keyof T]: () => Promise<T[K]> },
  sequential: boolean,
): Promise<T> {
  if (!sequential) {
    return (await Promise.all(tasks.map((task) => task()))) as unknown as T;
  }
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as unknown as T;
}

export async function loadAutomaticSnapshot(
  month: string,
  client?: QueryClient,
): Promise<MonthlyFinancialAutomaticSnapshot> {
  const [
    receiptRows,
    payrollRows,
    reimbursementRows,
    assetRows,
    bankFileRows,
    bankRows,
    bankChargeAccountRows,
    bankIssueRows,
  ] = await resolveMonthlyQueryBatch(
    [
      () =>
        queryAll<{
          id: string;
          receipt_date: string;
          amount: string;
          rate_snapshot_json: unknown;
          title: string | null;
          updated_at: string;
        }>(
          `SELECT receipt.id, receipt.receipt_date, receipt.amount::text AS amount,
              receipt.rate_snapshot_json, COALESCE(root.title, contract.title) AS title,
              receipt.updated_at
       FROM contract_receipts receipt
       JOIN contracts contract ON contract.id = receipt.contract_id
       JOIN contracts root ON root.id = COALESCE(contract.root_contract_id, contract.id)
       WHERE receipt.status = 'confirmed'
         AND LEFT(receipt.receipt_date, 7) = ?
         AND COALESCE(root.category, root.declared_category) = 'main_business'
         AND root.is_deleted = FALSE
         AND root.status NOT IN ('draft', 'rejected')
       ORDER BY receipt.receipt_date, receipt.id`,
          [month],
          client,
        ),
      () =>
        queryAll<{
          id: string;
          employee_id: string;
          employee_name: string;
          monthly_salary: string;
          housing_fund_base: string;
          contribution_base: string;
          individual_income_tax: string;
          updated_at: string;
        }>(
          `SELECT payroll.id, employee.id AS employee_id, employee.name AS employee_name,
              payroll.monthly_salary::text AS monthly_salary,
              payroll.housing_fund_base::text AS housing_fund_base,
              payroll.contribution_base::text AS contribution_base,
              payroll.individual_income_tax::text AS individual_income_tax,
              payroll.updated_at
       FROM payroll_records payroll
       JOIN employee_profiles employee ON employee.id = payroll.employee_id
       LEFT JOIN users user_account ON user_account.id = employee.user_id
       WHERE payroll.payroll_month = ?
         AND COALESCE(user_account.role, 'user') NOT IN ('super_admin', 'chairman', 'boss')
       ORDER BY employee.name, payroll.id`,
          [month],
          client,
        ),
      () =>
        queryAll<{
          id: string;
          user_id: string;
          type: "basic" | "large" | "business";
          title: string;
          applicant_name: string;
          total_amount: string;
          occurred_at: string;
          updated_at: string;
        }>(
          `SELECT id, user_id, type, title, applicant_name, total_amount::text AS total_amount,
              payment_business_date::text AS occurred_at,
              updated_at
       FROM reimbursements
       WHERE status IN ('paid', 'payment_uploaded', 'completed')
         AND is_deleted = FALSE
         AND payment_business_date >= ?::date
         AND payment_business_date < (?::date + INTERVAL '1 month')
       ORDER BY occurred_at, id`,
          [`${month}-01`, `${month}-01`],
          client,
        ),
      () =>
        queryAll<{
          id: string;
          payment_date: string;
          amount: string;
          title: string | null;
          updated_at: string;
        }>(
          `SELECT payment.id, payment.payment_date, payment.amount::text AS amount,
              COALESCE(root.title, contract.title) AS title, payment.updated_at
       FROM contract_payments payment
       JOIN contracts contract ON contract.id = payment.contract_id
       JOIN contracts root ON root.id = COALESCE(contract.root_contract_id, contract.id)
       WHERE payment.status = 'confirmed'
         AND LEFT(payment.payment_date, 7) = ?
         AND COALESCE(root.category, root.declared_category) = 'asset'
         AND root.is_deleted = FALSE
         AND root.status NOT IN ('draft', 'rejected')
       ORDER BY payment.payment_date, payment.id`,
          [month],
          client,
        ),
      () =>
        queryAll<{
          account_code: MonthlyBankAccountCode;
          recognition_status: string;
          updated_at: string;
        }>(
          `SELECT account_code, recognition_status, updated_at
         FROM monthly_financial_bank_files
         WHERE report_month = ? AND is_active = TRUE
         ORDER BY account_code`,
          [month],
          client,
        ),
      () =>
        queryAll<{
          id: string;
          current_file_id: string;
          account_code: MonthlyBankAccountCode;
          transaction_date: string;
          amount: string;
          direction: "inflow" | "outflow" | "unknown";
          category: string;
          remark: string | null;
          payer_name: string | null;
          payee_name: string | null;
          payee_account: string | null;
          electronic_receipt_no: string | null;
          include_in_report: boolean;
          person_id: string | null;
          rate_snapshot_json: unknown;
          linked_description: string | null;
          updated_at: string;
          file_recognition_status: string;
          transaction_recognition_status: string;
        }>(
          `SELECT transaction.id, transaction.current_file_id,
                transaction.account_code,
                transaction.transaction_date, transaction.amount::text AS amount,
                transaction.direction, transaction.category, transaction.remark,
                transaction.payer_name, transaction.payee_name,
                transaction.payee_account,
                transaction.electronic_receipt_no,
                transaction.include_in_report,
                file.recognition_status AS file_recognition_status,
                transaction.recognition_status AS transaction_recognition_status,
                (SELECT link.business_object_id
                   FROM monthly_financial_bank_transaction_links link
                  WHERE link.transaction_id = transaction.id
                    AND link.business_object_type = 'employee_profile'
                    AND link.link_kind = 'classification_basis'
                    AND link.match_status = 'active'
                    AND link.is_active = TRUE
                  ORDER BY link.updated_at DESC, link.id DESC LIMIT 1)
                  AS person_id,
                linked_receipt.rate_snapshot_json,
                linked_receipt.linked_description,
                transaction.updated_at
         FROM monthly_financial_bank_transactions transaction
         JOIN monthly_financial_bank_files file
           ON file.id = transaction.current_file_id
         LEFT JOIN LATERAL (
           SELECT receipt.rate_snapshot_json,
                  COALESCE(root.title, contract.title) AS linked_description
           FROM monthly_financial_bank_transaction_links link
           JOIN contract_receipts receipt
             ON link.business_object_type = 'contract_receipt'
            AND receipt.id = link.business_object_id
           JOIN contracts contract ON contract.id = receipt.contract_id
           LEFT JOIN contracts root
             ON root.id = COALESCE(contract.root_contract_id, contract.id)
           WHERE link.transaction_id = transaction.id
             AND link.link_kind = 'classification_basis'
             AND link.match_status = 'active'
             AND link.is_active = TRUE
             AND receipt.status = 'confirmed'
           ORDER BY link.updated_at DESC, link.id DESC
           LIMIT 1
         ) linked_receipt ON TRUE
         WHERE transaction.report_month = ?
           AND transaction.is_current = TRUE
           AND file.is_active = TRUE
           AND file.recognition_status IN ('recognized', 'partial')
         ORDER BY transaction.transaction_date, transaction.receipt_index`,
          [month],
          client,
        ),
      () =>
        queryAll<{ account_code: "general" | "business" }>(
          `SELECT file.account_code
           FROM monthly_financial_bank_files file
           WHERE file.report_month = ?
             AND file.is_active = TRUE
             AND file.account_code IN ('general', 'business')
             AND (
               file.recognition_status = 'recognized'
               OR (
                 file.recognition_status = 'partial'
                 AND EXISTS (
                   SELECT 1
                   FROM monthly_financial_bank_transactions review_transaction
                   WHERE review_transaction.current_file_id = file.id
                     AND review_transaction.is_current = TRUE
                     AND review_transaction.recognition_status = 'review_required'
                 )
                 AND NOT EXISTS (
                   SELECT 1
                   FROM monthly_financial_bank_transactions unsafe_transaction
                   WHERE unsafe_transaction.current_file_id = file.id
                     AND unsafe_transaction.is_current = TRUE
                     AND unsafe_transaction.recognition_status = 'review_required'
                     AND NOT (
                       unsafe_transaction.category IN (
                         'main_income', 'asset_expense', 'unclassified'
                       )
                       AND EXISTS (
                         SELECT 1
                         FROM jsonb_array_elements_text(
                           COALESCE(unsafe_transaction.warnings_json, '[]'::jsonb)
                         ) warning(value)
                         WHERE warning.value LIKE
                           'MONTHLY_BANK_CONTRACT_MATCH_REQUIRED:%'
                            OR warning.value LIKE
                              '原合同财务凭证已冲正%'
                       )
                     )
                 )
               )
             )
           ORDER BY file.account_code`,
          [month],
          client,
        ),
      () =>
        queryAll<{
          review_required_count: number;
          unclassified_count: number;
          conflict_count: number;
        }>(
          `SELECT
         COUNT(*) FILTER (
           WHERE transaction.recognition_status = 'review_required'
         )::int AS review_required_count,
         COUNT(*) FILTER (
           WHERE transaction.category = 'unclassified'
         )::int AS unclassified_count,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM monthly_financial_bank_transaction_links link
             WHERE link.transaction_id = transaction.id
               AND link.match_status = 'conflict'
               AND link.business_object_type <> 'monthly_bank_file'
           )
         )::int AS conflict_count
       FROM monthly_financial_bank_files file
       LEFT JOIN monthly_financial_bank_transactions transaction
         ON transaction.current_file_id = file.id
        AND transaction.is_current = TRUE
       WHERE file.report_month = ? AND file.is_active = TRUE`,
          [month],
          client,
        ),
    ] as const,
    Boolean(client),
  );

  let receiptCents = 0;
  let taxCents = 0;
  let marketingCents = 0;
  let businessCents = 0;
  let accountingBaseCents = 0;
  const details: MonthlyFinancialAutomaticSnapshot["details"] = [];
  for (const row of receiptRows) {
    const calculation = calculateMainBusinessIncome(
      row.amount,
      resolveRateBasisPoints(row.rate_snapshot_json),
    );
    receiptCents += calculation.contractAmountCents;
    taxCents += calculation.taxCents;
    marketingCents += calculation.marketingReserveCents;
    businessCents += calculation.businessCostCents;
    accountingBaseCents += calculation.accountingBaseCents;
    for (const [metric, cents] of [
      ["main_receipt", calculation.contractAmountCents],
      ["tax", calculation.taxCents],
      ["marketing_reserve", calculation.marketingReserveCents],
      ["business_cost", calculation.businessCostCents],
      ["accounting_base", calculation.accountingBaseCents],
    ] as const) {
      details.push({
        sourceType: "contract_receipt",
        sourceId: row.id,
        occurredOn: row.receipt_date.slice(0, 10),
        accountCode:
          metric === "marketing_reserve" || metric === "business_cost"
            ? "business"
            : "general",
        metric,
        amount: centsToFinancialAmount(cents),
        description: row.title || "主营合同回款",
        personId: null,
        personName: null,
      });
    }
  }

  const payrollCalculatedRows = payrollRows.map((row) => ({
    monthly_salary: row.monthly_salary,
    housing_fund_base: row.housing_fund_base,
    contribution_base: row.contribution_base,
    individual_income_tax: row.individual_income_tax,
    ...calculatePayrollBreakdown(
      row.monthly_salary,
      row.housing_fund_base,
      row.contribution_base,
      row.individual_income_tax,
    ),
  })) as Array<Record<PayrollAmountField, string>>;
  const humanCost = payrollCalculatedRows.length
    ? normalizeFinancialAmount(
        calculatePayrollTotals(payrollCalculatedRows).cost_total,
      )
    : "0";
  payrollRows.forEach((row, index) => {
    const cost = normalizeFinancialAmount(
      calculatePayrollTotals([payrollCalculatedRows[index]]).cost_total,
    );
    details.push({
      sourceType: "payroll",
      sourceId: row.id,
      occurredOn: `${month}-01`,
      accountCode: "general",
      metric: "human_cost",
      amount: cost,
      description: "人力成本",
      personId: row.employee_id,
      personName: row.employee_name,
    });
  });

  const reimbursementTotals = { basic: "0", large: "0", business: "0" };
  for (const row of reimbursementRows) {
    reimbursementTotals[row.type] = addFinancialAmounts(
      reimbursementTotals[row.type],
      normalizeFinancialAmount(row.total_amount),
    );
    details.push({
      sourceType: "reimbursement",
      sourceId: row.id,
      occurredOn: row.occurred_at.slice(0, 10),
      accountCode: row.type === "business" ? "business" : "general",
      metric: `${row.type}_reimbursement`,
      amount: normalizeFinancialAmount(row.total_amount),
      description: row.title,
      personId: row.user_id,
      personName: row.applicant_name,
    });
  }

  let assetAdministration = "0";
  for (const row of assetRows) {
    const amount = normalizeFinancialAmount(row.amount);
    assetAdministration = addFinancialAmounts(assetAdministration, amount);
    details.push({
      sourceType: "asset_payment",
      sourceId: row.id,
      occurredOn: row.payment_date.slice(0, 10),
      accountCode: "general",
      metric: "asset_administration",
      amount,
      description: row.title || "资产类合同付款",
      personId: null,
      personName: null,
    });
  }

  const activeBankAccounts = new Set(
    bankFileRows
      .filter((row) => row.recognition_status === "recognized")
      .map((row) => row.account_code),
  );
  const chargeBankAccounts = new Set(
    bankChargeAccountRows.map((row) => row.account_code),
  );
  const partialBankAccounts = bankFileRows
    .filter((row) => row.recognition_status === "partial")
    .map((row) => row.account_code);
  const bankIssues = bankIssueRows[0] || {
    review_required_count: 0,
    unclassified_count: 0,
    conflict_count: 0,
  };
  const accountingBankRows = bankRows.filter(
    (row) =>
      row.file_recognition_status === "recognized" ||
      (row.file_recognition_status === "partial" &&
        row.transaction_recognition_status === "recognized" &&
        row.include_in_report &&
        chargeBankAccounts.has(row.account_code as "general" | "business") &&
        (row.category === "interest" || row.category === "bank_fee")),
  );
  const includedBankRows = accountingBankRows.filter(
    (row) => row.include_in_report,
  );
  const appendBankDetail = (
    row: (typeof bankRows)[number],
    metric: string,
    amount: string,
    accountCode: FinancialAccountCode,
    description: string,
  ) => {
    details.push({
      sourceType: "monthly_bank_transaction",
      sourceId: row.id,
      occurredOn: row.transaction_date,
      accountCode,
      metric,
      amount,
      description,
      personId:
        row.person_id ||
        ([
          "salary",
          "basic_reimbursement",
          "large_reimbursement",
          "business_reimbursement",
        ].includes(row.category) && row.payee_account
          ? `bank-account:${normalizeMonthlyBankAccount(row.payee_account)}`
          : null),
      personName: bankTransactionPersonName(row),
      bankAccountCode: row.account_code,
      electronicReceiptNo: row.electronic_receipt_no,
      previewUrl: `/api/monthly-financial-reports/bank-transactions/${row.id}/preview?fileId=${encodeURIComponent(row.current_file_id)}`,
      linkStatus: null,
    });
  };

  for (const row of includedBankRows) {
    if (
      !["general", "business"].includes(row.account_code) ||
      (row.category !== "interest" && row.category !== "bank_fee")
    ) {
      continue;
    }
    const financialAccountCode = row.account_code as FinancialAccountCode;
    const metric = `${row.account_code}_${row.category}`;
    appendBankDetail(
      row,
      metric,
      normalizeFinancialAmount(row.amount),
      financialAccountCode,
      row.category === "interest"
        ? `${MONTHLY_BANK_ACCOUNTS[row.account_code].label}利息`
        : `${MONTHLY_BANK_ACCOUNTS[row.account_code].label}跨行手续费`,
    );
  }

  const sumBankCategory = (
    accountCode: MonthlyBankAccountCode,
    category: string,
  ): string =>
    addFinancialAmounts(
      ...includedBankRows
        .filter(
          (row) =>
            row.account_code === accountCode && row.category === category,
        )
        .map((row) => normalizeFinancialAmount(row.amount)),
    );
  const internalTransferTotal = addFinancialAmounts(
    ...accountingBankRows
      .filter((row) => row.category === "internal_transfer")
      .map((row) => normalizeFinancialAmount(row.amount)),
  );
  const bankUpdatedAt = maxUpdatedAt([
    ...bankFileRows.map((row) => row.updated_at),
    ...bankRows.map((row) => row.updated_at),
  ]);
  const reimbursementAmount = addFinancialAmounts(
    reimbursementTotals.basic,
    reimbursementTotals.large,
    reimbursementTotals.business,
  );
  const generatedAt = new Date().toISOString();
  return {
    income: {
      mainBusinessReceipts: centsToFinancialAmount(receiptCents),
      tax: centsToFinancialAmount(taxCents),
      marketingReserve: centsToFinancialAmount(marketingCents),
      businessCost: centsToFinancialAmount(businessCents),
      accountingBase: centsToFinancialAmount(accountingBaseCents),
    },
    expenses: {
      humanCost,
      basicReimbursement: reimbursementTotals.basic,
      largeReimbursement: reimbursementTotals.large,
      businessReimbursement: reimbursementTotals.business,
      assetAdministration,
    },
    sources: [
      {
        code: "contract_receipts",
        name: "主营合同回款",
        recordCount: receiptRows.length,
        amount: centsToFinancialAmount(receiptCents),
        updatedAt: maxUpdatedAt(receiptRows.map((row) => row.updated_at)),
        available: true,
        message: receiptRows.length
          ? "统计金额以系统内已确认主营回款为准，银行回单仅作匹配凭证"
          : "本月没有已确认主营回款",
      },
      {
        code: "payroll",
        name: "人力成本",
        recordCount: payrollRows.length,
        amount: humanCost,
        updatedAt: maxUpdatedAt(payrollRows.map((row) => row.updated_at)),
        available: true,
        message: payrollRows.length
          ? "统计金额沿用系统薪资核算，银行回单仅作逐人付款凭证"
          : "本月没有工资记录",
      },
      {
        code: "reimbursements",
        name: "已支付报销",
        recordCount: reimbursementRows.length,
        amount: reimbursementAmount,
        updatedAt: maxUpdatedAt(reimbursementRows.map((row) => row.updated_at)),
        available: true,
        message: reimbursementRows.length
          ? "统计金额以系统内已支付报销为准，银行回单仅作付款凭证"
          : "本月没有已支付报销",
      },
      {
        code: "asset_payments",
        name: "资产类合同付款",
        recordCount: assetRows.length,
        amount: assetAdministration,
        updatedAt: maxUpdatedAt(assetRows.map((row) => row.updated_at)),
        available: true,
        message: assetRows.length
          ? "统计金额以系统内已确认资产付款为准，银行回单仅作匹配凭证"
          : "本月没有已确认资产付款",
      },
      {
        code: "monthly_bank_receipts",
        name: "月度银行回单",
        recordCount: accountingBankRows.length,
        amount: addFinancialAmounts(
          sumBankCategory("general", "interest"),
          sumBankCategory("general", "bank_fee"),
          sumBankCategory("business", "interest"),
          sumBankCategory("business", "bank_fee"),
        ),
        updatedAt: bankUpdatedAt,
        available: true,
        message: bankFileRows.length
          ? `已识别${bankFileRows.length}个银行账户文件；业务金额仍取系统记录，仅利息和手续费取银行回单`
          : "本月尚未上传银行回单",
      },
    ],
    details,
    bank: {
      activeAccounts: [...activeBankAccounts],
      chargeAccounts: [...chargeBankAccounts],
      generalInterest: sumBankCategory("general", "interest"),
      businessInterest: sumBankCategory("business", "interest"),
      generalBankFee: sumBankCategory("general", "bank_fee"),
      businessBankFee: sumBankCategory("business", "bank_fee"),
      internalTransferTotal,
      partialAccounts: partialBankAccounts,
      reviewRequiredCount: Number(bankIssues.review_required_count || 0),
      unclassifiedCount: Number(bankIssues.unclassified_count || 0),
      conflictCount: Number(bankIssues.conflict_count || 0),
      updatedAt: bankUpdatedAt,
    },
    generatedAt,
  };
}

async function loadReportRow(
  month: string,
  client?: QueryClient,
  forUpdate = false,
): Promise<ReportRow | null> {
  return queryOne<ReportRow>(
    `SELECT report.*, closer.name AS closed_by_name
       FROM monthly_financial_reports report
       LEFT JOIN users closer ON closer.id = report.closed_by
       WHERE report.report_month = ?${forUpdate ? " FOR UPDATE OF report" : ""}`,
    [month],
    client,
  );
}

async function loadManualItems(
  reportId: string | null,
  client?: QueryClient,
): Promise<MonthlyFinancialManualItemInput[]> {
  if (!reportId) return [];
  const rows = await queryAll<{
    id: string;
    category: MonthlyFinancialManualItemInput["category"];
    account_code: FinancialAccountCode;
    direction: "income" | "expense";
    amount: string;
    occurred_on: string;
    description: string | null;
    voucher_reference: string | null;
  }>(
    `SELECT id, category, account_code, direction, amount::text AS amount,
            occurred_on, description, voucher_reference
     FROM monthly_financial_manual_items
     WHERE report_id = ?
     ORDER BY occurred_on, created_at, id`,
    [reportId],
    client,
  );
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    accountCode: row.account_code,
    direction: row.direction,
    amount: normalizeFinancialAmount(row.amount),
    occurredOn: row.occurred_on,
    description: row.description,
    voucherReference: row.voucher_reference,
  }));
}

async function loadPreviousContext(
  month: string,
  current: ReportRow | null,
  client?: QueryClient,
): Promise<PreviousReportContext> {
  const prior = await queryOne<{
    report_month: string;
    status: MonthlyFinancialReportStatus;
    closing_balances_json: FinancialAccountAmounts | null;
  }>(
    `SELECT report_month, status, closing_balances_json
     FROM monthly_financial_reports
     WHERE report_month < ?
     ORDER BY report_month DESC
     LIMIT 1`,
    [month],
    client,
  );
  const expectedPreviousMonth = previousFinancialMonth(month);
  const previousMonthClosed = Boolean(
    prior &&
    prior.report_month === expectedPreviousMonth &&
    prior.status === "closed" &&
    prior.closing_balances_json,
  );
  let openingBalances: FinancialAccountAmounts;
  if (previousMonthClosed) {
    openingBalances = asOpeningBalances(
      prior?.closing_balances_json,
      `${expectedPreviousMonth}月结期末余额`,
    );
  } else if (current) {
    openingBalances = asOpeningBalances(
      current.opening_balances_json,
      `${month}期初余额`,
    );
  } else {
    openingBalances = emptyAccountAmounts();
  }
  return {
    isFirstMonth: !prior,
    previousMonthClosed,
    openingBalances,
  };
}

async function loadMonthlyBankValidationState(
  month: string,
  client?: QueryClient,
): Promise<{
  chargeAccounts: Array<"general" | "business">;
  partialAccounts: MonthlyBankAccountCode[];
  reviewRequiredCount: number;
  unclassifiedCount: number;
  conflictCount: number;
}> {
  const [fileRows, issueRow] = await Promise.all([
    queryAll<{
      account_code: MonthlyBankAccountCode;
      recognition_status: string;
      charge_eligible: boolean;
    }>(
      `SELECT file.account_code, file.recognition_status,
              CASE
                WHEN file.account_code IN ('general', 'business')
                 AND file.recognition_status = 'recognized' THEN TRUE
                WHEN file.account_code IN ('general', 'business')
                 AND file.recognition_status = 'partial'
                 AND EXISTS (
                   SELECT 1 FROM monthly_financial_bank_transactions review_transaction
                   WHERE review_transaction.current_file_id = file.id
                     AND review_transaction.is_current = TRUE
                     AND review_transaction.recognition_status = 'review_required'
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM monthly_financial_bank_transactions unsafe_transaction
                   WHERE unsafe_transaction.current_file_id = file.id
                     AND unsafe_transaction.is_current = TRUE
                     AND unsafe_transaction.recognition_status = 'review_required'
                     AND NOT (
                       unsafe_transaction.category IN (
                         'main_income', 'asset_expense', 'unclassified'
                       )
                       AND EXISTS (
                         SELECT 1 FROM jsonb_array_elements_text(
                           COALESCE(unsafe_transaction.warnings_json, '[]'::jsonb)
                         ) warning(value)
                         WHERE warning.value LIKE
                           'MONTHLY_BANK_CONTRACT_MATCH_REQUIRED:%'
                            OR warning.value LIKE
                              '原合同财务凭证已冲正%'
                       )
                     )
                 ) THEN TRUE
                ELSE FALSE
              END AS charge_eligible
       FROM monthly_financial_bank_files file
       WHERE file.report_month = ? AND file.is_active = TRUE
       ORDER BY file.account_code`,
      [month],
      client,
    ),
    queryOne<{
      review_required_count: number;
      unclassified_count: number;
      conflict_count: number;
    }>(
      `SELECT
         COUNT(*) FILTER (
           WHERE transaction.recognition_status = 'review_required'
         )::int AS review_required_count,
         COUNT(*) FILTER (
           WHERE transaction.category = 'unclassified'
         )::int AS unclassified_count,
         COUNT(*) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM monthly_financial_bank_transaction_links link
             WHERE link.transaction_id = transaction.id
               AND link.match_status = 'conflict'
               AND link.business_object_type <> 'monthly_bank_file'
           )
         )::int AS conflict_count
       FROM monthly_financial_bank_files file
       LEFT JOIN monthly_financial_bank_transactions transaction
         ON transaction.current_file_id = file.id
        AND transaction.is_current = TRUE
       WHERE file.report_month = ? AND file.is_active = TRUE`,
      [month],
      client,
    ),
  ]);
  return {
    chargeAccounts: fileRows
      .filter((row) => row.charge_eligible)
      .map((row) => row.account_code)
      .filter(
        (code): code is "general" | "business" =>
          code === "general" || code === "business",
      ),
    partialAccounts: fileRows
      .filter((row) => row.recognition_status === "partial")
      .map((row) => row.account_code),
    reviewRequiredCount: Number(issueRow?.review_required_count || 0),
    unclassifiedCount: Number(issueRow?.unclassified_count || 0),
    conflictCount: Number(issueRow?.conflict_count || 0),
  };
}

const BANK_MANUAL_CATEGORY_BY_METRIC: Record<
  string,
  keyof typeof MANUAL_CATEGORY_RULES
> = {
  general_interest: "general_interest",
  general_bank_fee: "general_bank_fee",
  business_interest: "business_interest",
  business_bank_fee: "business_bank_fee",
};

function buildClientManualItems(
  internal: MonthlyFinancialReportView,
  automatic: MonthlyFinancialAutomaticSnapshot,
): ClientMonthlyReport["manualItems"] {
  const chargeAccounts = new Set(
    automatic.bank?.chargeAccounts ||
      (automatic.bank?.activeAccounts || []).filter(
        (code): code is "general" | "business" =>
          code === "general" || code === "business",
      ),
  );
  const bankControlledCategories = new Set<
    keyof typeof MANUAL_CATEGORY_RULES
  >();
  if (chargeAccounts.has("general")) {
    bankControlledCategories.add("general_interest");
    bankControlledCategories.add("general_bank_fee");
  }
  if (chargeAccounts.has("business")) {
    bankControlledCategories.add("business_interest");
    bankControlledCategories.add("business_bank_fee");
  }

  const manualRows: ClientMonthlyReport["manualItems"] =
    internal.manualItems.map((item) => ({
      ...item,
      categoryLabel: MANUAL_CATEGORY_RULES[item.category].label,
      sourceType: "manual",
      readOnly: false,
      effective: !bankControlledCategories.has(item.category),
      previewUrl: null,
    }));
  const bankRows: ClientMonthlyReport["manualItems"] = automatic.details
    .filter(
      (detail) =>
        detail.sourceType === "monthly_bank_transaction" &&
        Boolean(BANK_MANUAL_CATEGORY_BY_METRIC[detail.metric]) &&
        bankControlledCategories.has(
          BANK_MANUAL_CATEGORY_BY_METRIC[detail.metric]!,
        ),
    )
    .map((detail) => {
      const category = BANK_MANUAL_CATEGORY_BY_METRIC[detail.metric]!;
      const rule = MANUAL_CATEGORY_RULES[category];
      return {
        id: `monthly-bank:${detail.sourceId}`,
        category,
        categoryLabel: rule.label,
        accountCode: rule.accountCode,
        direction: rule.direction,
        occurredOn: detail.occurredOn,
        amount: detail.amount,
        description: detail.description,
        voucherReference: detail.electronicReceiptNo || null,
        sourceType: "monthly_bank_transaction" as const,
        readOnly: true,
        effective: true,
        previewUrl: detail.previewUrl || null,
      };
    });
  return [...manualRows, ...bankRows];
}

function toClientReport(input: {
  internal: MonthlyFinancialReportView;
  automatic: MonthlyFinancialAutomaticSnapshot;
  previous: PreviousReportContext;
  reportRow: ReportRow | null;
  role: string;
}): ClientMonthlyReport {
  const { internal, automatic, previous, reportRow, role } = input;
  const canMaintain = role === "admin";
  const blockers: Array<{ code: string; message: string }> = [];
  if (!reportRow) {
    blockers.push({
      code: "REPORT_NOT_PERSISTED",
      message: "请先保存或同步本月报表后再月结",
    });
  }
  if (!previous.isFirstMonth && !previous.previousMonthClosed) {
    blockers.push({
      code: "PREVIOUS_MONTH_NOT_CLOSED",
      message: "上月尚未月结，不能执行本月月结",
    });
  }
  const warnings = internal.warnings.map(({ code, message }) => ({
    code,
    message,
  }));
  const bankSnapshot = automatic.bank;
  const partialBankAccounts = bankSnapshot?.partialAccounts || [];
  if (
    partialBankAccounts.length > 0 ||
    Number(bankSnapshot?.reviewRequiredCount || 0) > 0
  ) {
    blockers.push({
      code: "MONTHLY_BANK_REVIEW_REQUIRED",
      message: `银行回单仍有未完成识别或待复核交易：${
        partialBankAccounts
          .map((code) => MONTHLY_BANK_ACCOUNTS[code].label)
          .join("、") || `${bankSnapshot?.reviewRequiredCount || 0}笔`
      }，处理后才能月结`,
    });
  }
  if (Number(bankSnapshot?.unclassifiedCount || 0) > 0) {
    warnings.push({
      code: "MONTHLY_BANK_UNCLASSIFIED_TRANSACTIONS",
      message: `${bankSnapshot?.unclassifiedCount || 0}笔银行交易未归入月报项目，已排除经营收支`,
    });
  }
  if (Number(bankSnapshot?.conflictCount || 0) > 0) {
    warnings.push({
      code: "MONTHLY_BANK_LINK_CONFLICTS",
      message: `${bankSnapshot?.conflictCount || 0}笔月底回单与旧业务凭证校验存在冲突，未自动替换旧展示`,
    });
  }
  const accounts = internal.accounts.map((account) => ({
    code: account.code,
    name: account.name,
    opening: account.openingBalance,
    inflow: account.income,
    outflow: account.expense,
    closing: account.closingBalance,
  }));
  const opening = addFinancialAmounts(
    ...accounts.map((account) => account.opening),
  );
  // 月报顶部的收入表示公司银行实际收到的主营业务回款总额。
  // 四账户流入是税费、营销和商务费用拆分后的结算口径，不能反向充当
  // 银行到账额，否则 10 万元回款会被误显示为税后分配金额。
  const incomeTotal = internal.income.mainBusinessReceipts;
  const expenseTotal = addFinancialAmounts(
    ...accounts.map((account) => account.outflow),
  );
  const closing = addFinancialAmounts(
    ...accounts.map((account) => account.closing),
  );
  return {
    month: internal.month,
    status: internal.status,
    version: internal.version,
    snapshotVersion: internal.status === "closed" ? internal.version : null,
    isFirstMonth: previous.isFirstMonth,
    generatedAt: automatic.generatedAt,
    savedAt: internal.updatedAt,
    closedAt: internal.closedAt,
    closedByName: reportRow?.closed_by_name || null,
    reopenedAt: reportRow?.reopened_at || null,
    accounts,
    income: {
      mainReceipt: internal.income.mainBusinessReceipts,
      tax: internal.income.tax,
      marketingReserve: internal.income.marketingReserve,
      businessCost: internal.income.businessCost,
      accountingBase: internal.income.accountingBase,
      generalInterest: internal.income.generalInterest,
      businessInterest: internal.income.businessInterest,
      welfareOneSupplement: internal.income.welfareOneSupplementIncome,
      welfareTwoSupplement: internal.income.welfareTwoSupplementIncome,
    },
    expenses: {
      humanCost: internal.expenses.humanCost,
      basicReimbursement: internal.expenses.basicReimbursement,
      largeReimbursement: internal.expenses.largeReimbursement,
      assetAdministration: internal.expenses.assetAdministration,
      generalBankFee: internal.expenses.generalBankFee,
      generalOther: internal.expenses.generalOtherExpense,
      businessReimbursement: internal.expenses.businessReimbursement,
      businessBankFee: internal.expenses.businessBankFee,
      welfareOne407: internal.expenses.welfareOne407,
      welfareOneDrinkingWater: internal.expenses.welfareOneDrinkingWater || "0",
      welfareOneOffice: addFinancialAmounts(
        internal.expenses.welfareOneOffice || "0",
        internal.expenses.welfareOne407 || "0",
      ),
      welfareOneElectricity: internal.expenses.welfareOneElectricity || "0",
      welfareOne407Ai: internal.expenses.welfareOne407Ai,
      welfareOne8hAi: internal.expenses.welfareOne8hAi,
      welfareTwoRefreshment: internal.expenses.welfareTwoRefreshment,
      welfareTwoTeamBuilding: internal.expenses.welfareTwoTeamBuilding,
      welfareTwoPhysicalExam: internal.expenses.welfareTwoHealthCheck,
    },
    automaticDetails: automatic.details,
    bank: automatic.bank,
    totals: {
      opening,
      income: incomeTotal,
      expense: expenseTotal,
      closing,
      netChange: subtractFinancialAmounts(closing, opening),
    },
    manualItems: buildClientManualItems(internal, automatic),
    sources: automatic.sources.map((source) => ({
      key: source.code,
      status: source.available
        ? source.recordCount
          ? "ready"
          : "empty"
        : "missing",
      recordCount: source.recordCount,
      amount: source.amount,
      lastUpdatedAt: source.updatedAt,
      message: source.message,
    })),
    validations: {
      canClose:
        Boolean(reportRow) &&
        internal.status !== "closed" &&
        blockers.length === 0,
      blockers,
      warnings,
    },
    permissions: {
      canEdit: canMaintain && internal.status !== "closed",
      canRefresh: canMaintain && internal.status !== "closed",
      canSubmitReview: false,
      canClose:
        canMaintain &&
        Boolean(reportRow) &&
        internal.status !== "closed" &&
        blockers.length === 0,
      canReopen: canMaintain && internal.status === "closed",
      canDownload: true,
    },
  };
}

async function loadMonthlyReport(
  month: string,
  role: string,
  forceAutomatic = false,
): Promise<LoadedMonthlyReport> {
  assertFinancialMonth(month);
  const reportRow = await loadReportRow(month);
  const previous = await loadPreviousContext(month, reportRow);

  if (reportRow?.status === "closed") {
    const snapshot = await queryOne<{ snapshot_json: Record<string, unknown> }>(
      `SELECT snapshot_json FROM monthly_financial_snapshots
       WHERE report_id = ? AND report_version = ?`,
      [reportRow.id, reportRow.version],
    );
    if (!snapshot?.snapshot_json) {
      throw dataIntegrity(
        `${month}已月结报表缺少版本${reportRow.version}快照，已阻止实时重算`,
      );
    }
    const stored = snapshot.snapshot_json as unknown as ClientMonthlyReport & {
      __internal?: MonthlyFinancialReportView;
      __automatic?: MonthlyFinancialAutomaticSnapshot;
    };
    const { __internal, __automatic, ...publicSnapshot } = stored;
    const validatedAutomatic = asAutomaticSnapshot(__automatic);
    if (
      !__internal ||
      !validatedAutomatic ||
      __internal.id !== reportRow.id ||
      __internal.month !== month ||
      __internal.status !== "closed" ||
      __internal.version !== reportRow.version ||
      publicSnapshot.month !== month ||
      publicSnapshot.status !== "closed" ||
      publicSnapshot.version !== reportRow.version
    ) {
      throw dataIntegrity(`${month}月结快照结构不完整或版本不匹配`);
    }
    asOpeningBalances(__internal.openingBalances, `${month}月结快照期初余额`);
    assertClosedSnapshotAccounts(
      publicSnapshot.accounts,
      __internal.accounts,
      month,
    );
    return {
      report: {
        ...publicSnapshot,
        automaticDetails:
          publicSnapshot.automaticDetails || validatedAutomatic.details,
        manualItems: buildClientManualItems(__internal, validatedAutomatic),
        validations: {
          ...publicSnapshot.validations,
          canClose: false,
        },
        permissions: {
          canEdit: false,
          canRefresh: false,
          canSubmitReview: false,
          canClose: false,
          canReopen: role === "admin",
          canDownload: true,
        },
      },
      internal: __internal,
      automatic: validatedAutomatic,
      previous,
    };
  }

  const storedAutomatic = asAutomaticSnapshot(
    reportRow?.automatic_snapshot_json,
  );
  if (!forceAutomatic && reportRow && !storedAutomatic) {
    throw dataIntegrity(`${month}自动数据快照不完整，请执行重新同步`);
  }
  const baseAutomatic =
    !forceAutomatic && storedAutomatic
      ? storedAutomatic
      : await loadAutomaticSnapshot(month);
  const liveBankValidation = reportRow
    ? await loadMonthlyBankValidationState(month)
    : null;
  const automatic = liveBankValidation
    ? {
        ...baseAutomatic,
        bank: {
          activeAccounts: baseAutomatic.bank?.activeAccounts || [],
          generalInterest: baseAutomatic.bank?.generalInterest || "0",
          businessInterest: baseAutomatic.bank?.businessInterest || "0",
          generalBankFee: baseAutomatic.bank?.generalBankFee || "0",
          businessBankFee: baseAutomatic.bank?.businessBankFee || "0",
          internalTransferTotal:
            baseAutomatic.bank?.internalTransferTotal || "0",
          ...liveBankValidation,
          updatedAt: baseAutomatic.bank?.updatedAt || null,
        },
      }
    : baseAutomatic;
  const manualItems = await loadManualItems(reportRow?.id || null);
  const internal = buildMonthlyFinancialReportView({
    id: reportRow?.id || null,
    month,
    status: reportRow?.status || "draft",
    version: reportRow?.version || 0,
    openingBalances: previous.openingBalances,
    automatic,
    manualItems,
    lastRefreshedAt: reportRow?.last_refreshed_at || null,
    closedAt: reportRow?.closed_at || null,
    updatedAt: reportRow?.updated_at || null,
    canMaintain: role === "admin",
  });
  return {
    report: toClientReport({ internal, automatic, previous, reportRow, role }),
    internal,
    automatic,
    previous,
  };
}

interface MonthlyBankUploadCandidate {
  id: string;
  file: Express.Multer.File;
  outputDir: string;
  analysis: MonthlyBankFileAnalysis;
}

async function assertMonthlyBankPdfHeader(filePath: string): Promise<void> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 5 || header.toString("ascii") !== "%PDF-") {
      throw badRequest(
        "MONTHLY_BANK_FILE_FORMAT_INVALID",
        "银行回单真实文件格式必须为 PDF",
      );
    }
  } finally {
    await handle.close();
  }
}

async function cleanupMonthlyBankUpload(
  filePath: string,
  outputDir?: string,
): Promise<void> {
  await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
  if (outputDir) {
    await fs.promises
      .rm(outputDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}

function monthlyBankMatchedAccountRole(
  transaction: MonthlyBankRecognizedTransaction,
  accountCode: MonthlyBankAccountCode,
): "payer" | "payee" | "both" | "none" {
  const account = MONTHLY_BANK_ACCOUNTS[accountCode].accountNumber;
  const payerMatches =
    normalizeMonthlyBankAccount(transaction.payerAccount) === account;
  const payeeMatches =
    normalizeMonthlyBankAccount(transaction.payeeAccount) === account;
  if (payerMatches && payeeMatches) return "both";
  if (payerMatches) return "payer";
  if (payeeMatches) return "payee";
  return "none";
}

async function loadMonthlyBankState(month: string): Promise<{
  month: string;
  knownFileHashes: string[];
  accounts: Array<Record<string, unknown>>;
}> {
  const files = await queryAll<{
    id: string;
    account_code: MonthlyBankAccountCode;
    original_name: string;
    file_hash: string;
    file_version: number;
    page_count: number | null;
    recognized_receipt_count: number;
    included_receipt_count: number;
    recognition_status: string;
    charge_eligible: boolean;
    detected_months_json: string[];
    warnings_json: string[];
    anomalies_json: Array<string | { warning?: unknown }>;
    uploaded_by: string;
    uploader_name: string | null;
    recognized_at: string | null;
    updated_at: string;
  }>(
    `SELECT file.id, file.account_code, file.original_name, file.file_hash,
            file.file_version, file.page_count, file.recognized_receipt_count,
            file.included_receipt_count, file.recognition_status,
            CASE
              WHEN file.account_code IN ('general', 'business')
               AND file.recognition_status = 'recognized' THEN TRUE
              WHEN file.account_code IN ('general', 'business')
               AND file.recognition_status = 'partial'
               AND EXISTS (
                 SELECT 1 FROM monthly_financial_bank_transactions review_transaction
                 WHERE review_transaction.current_file_id = file.id
                   AND review_transaction.is_current = TRUE
                   AND review_transaction.recognition_status = 'review_required'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM monthly_financial_bank_transactions unsafe_transaction
                 WHERE unsafe_transaction.current_file_id = file.id
                   AND unsafe_transaction.is_current = TRUE
                   AND unsafe_transaction.recognition_status = 'review_required'
                   AND NOT (
                     unsafe_transaction.category IN (
                       'main_income', 'asset_expense', 'unclassified'
                     )
                     AND EXISTS (
                       SELECT 1 FROM jsonb_array_elements_text(
                         COALESCE(unsafe_transaction.warnings_json, '[]'::jsonb)
                       ) warning(value)
                       WHERE warning.value LIKE
                         'MONTHLY_BANK_CONTRACT_MATCH_REQUIRED:%'
                          OR warning.value LIKE
                            '原合同财务凭证已冲正%'
                     )
                   )
               ) THEN TRUE
              ELSE FALSE
            END AS charge_eligible,
            file.detected_months_json, file.warnings_json, file.anomalies_json,
            file.uploaded_by, uploader.name AS uploader_name,
            file.recognized_at, file.updated_at
     FROM monthly_financial_bank_files file
     LEFT JOIN users uploader ON uploader.id = file.uploaded_by
     WHERE file.report_month = ? AND file.is_active = TRUE
     ORDER BY file.account_code`,
    [month],
  );
  const transactions = await queryAll<{
    id: string;
    account_code: MonthlyBankAccountCode;
    electronic_receipt_no: string | null;
    transaction_date: string | null;
    amount: string | null;
    direction: string | null;
    payer_name: string | null;
    payer_account: string | null;
    payee_name: string | null;
    payee_account: string | null;
    remark: string | null;
    page_number: number;
    receipt_position: string;
    category: string;
    recognition_status: string;
    file_recognition_status: string;
    include_in_report: boolean;
    warnings_json: string[];
    link_warnings: string[];
    occurrence_account_codes: MonthlyBankAccountCode[];
    employee_match_status: "matched" | "unmatched" | "ambiguous";
    employee_id: string | null;
    employee_name: string | null;
    reimbursement_link_status: "matched" | "unmatched" | "conflict";
    reimbursement_link_warnings: string[];
    link_status: "matched" | "conflict" | "unmatched";
  }>(
    `SELECT transaction.id, transaction.account_code,
            transaction.electronic_receipt_no, transaction.transaction_date,
            transaction.amount::text AS amount, transaction.direction,
            transaction.payer_name, transaction.payer_account,
            transaction.payee_name, transaction.payee_account,
            transaction.remark, transaction.page_number,
            transaction.receipt_position, transaction.category,
            transaction.recognition_status,
            file.recognition_status AS file_recognition_status,
            transaction.include_in_report,
            transaction.warnings_json,
            ARRAY(
              SELECT DISTINCT warning.value
              FROM monthly_financial_bank_transaction_links conflict_link
              CROSS JOIN LATERAL jsonb_array_elements_text(
                conflict_link.warnings_json
              ) AS warning(value)
              WHERE conflict_link.transaction_id = transaction.id
                AND conflict_link.match_status = 'conflict'
                AND conflict_link.business_object_type <> 'monthly_bank_file'
              ORDER BY warning.value
            ) AS link_warnings,
            ARRAY(
              SELECT occurrence_file.account_code
              FROM monthly_financial_bank_transaction_links occurrence
              JOIN monthly_financial_bank_files occurrence_file
                ON occurrence_file.id = occurrence.business_object_id
              WHERE occurrence.transaction_id = transaction.id
                AND occurrence.business_object_type = 'monthly_bank_file'
                AND occurrence.link_kind = 'matched'
                AND occurrence.match_status = 'active'
                AND occurrence.is_active = TRUE
                AND occurrence_file.is_active = TRUE
              ORDER BY occurrence_file.account_code
            ) AS occurrence_account_codes,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM monthly_financial_bank_transaction_links link
                WHERE link.transaction_id = transaction.id
                  AND link.business_object_type = 'employee_profile'
                  AND link.match_status = 'conflict'
              ) THEN 'ambiguous'
              WHEN EXISTS (
                SELECT 1 FROM monthly_financial_bank_transaction_links link
                WHERE link.transaction_id = transaction.id
                  AND link.business_object_type = 'employee_profile'
                  AND link.match_status = 'active'
                  AND link.is_active = TRUE
              ) THEN 'matched'
              ELSE 'unmatched'
            END AS employee_match_status,
            (SELECT link.business_object_id
             FROM monthly_financial_bank_transaction_links link
             WHERE link.transaction_id = transaction.id
               AND link.business_object_type = 'employee_profile'
               AND link.match_status = 'active'
               AND link.is_active = TRUE
             ORDER BY link.updated_at DESC, link.id DESC LIMIT 1)
              AS employee_id,
            (SELECT employee.name
             FROM monthly_financial_bank_transaction_links link
             JOIN employee_profiles employee
               ON employee.id = link.business_object_id
             WHERE link.transaction_id = transaction.id
               AND link.business_object_type = 'employee_profile'
               AND link.match_status = 'active'
               AND link.is_active = TRUE
             ORDER BY link.updated_at DESC, link.id DESC LIMIT 1)
              AS employee_name,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM monthly_financial_bank_transaction_links link
                WHERE link.transaction_id = transaction.id
                  AND link.business_object_type = 'reimbursement'
                  AND link.link_kind = 'display_replacement'
                  AND link.match_status = 'active'
                  AND link.is_active = TRUE
              ) THEN 'matched'
              WHEN EXISTS (
                SELECT 1 FROM monthly_financial_bank_transaction_links link
                WHERE link.transaction_id = transaction.id
                  AND link.business_object_type IN ('reimbursement', 'payment_batch')
                  AND link.match_status = 'conflict'
              ) THEN 'conflict'
              ELSE 'unmatched'
            END AS reimbursement_link_status,
            ARRAY(
              SELECT DISTINCT warning.value
              FROM monthly_financial_bank_transaction_links link
              CROSS JOIN LATERAL jsonb_array_elements_text(
                link.warnings_json
              ) AS warning(value)
              WHERE link.transaction_id = transaction.id
                AND link.business_object_type IN ('reimbursement', 'payment_batch')
                AND link.match_status = 'conflict'
              ORDER BY warning.value
            ) AS reimbursement_link_warnings,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM monthly_financial_bank_transaction_links link
                WHERE link.transaction_id = transaction.id
                  AND link.match_status = 'conflict'
                  AND link.business_object_type <> 'monthly_bank_file'
              ) THEN 'conflict'
              WHEN EXISTS (
                SELECT 1 FROM monthly_financial_bank_transaction_links link
                WHERE link.transaction_id = transaction.id
                  AND link.match_status = 'active'
                  AND link.business_object_type <> 'monthly_bank_file'
              ) THEN 'matched'
              ELSE 'unmatched'
            END AS link_status
     FROM monthly_financial_bank_transactions transaction
     JOIN monthly_financial_bank_files file
       ON file.id = transaction.current_file_id
     WHERE file.report_month = ?
       AND transaction.is_current = TRUE
       AND file.is_active = TRUE
     ORDER BY transaction.account_code, transaction.transaction_date,
              transaction.page_number, transaction.receipt_index`,
    [month],
  );
  const linkedReimbursementRows = await queryAll<{
    transaction_id: string;
    reimbursement_id: string;
    type: "basic" | "large" | "business";
    title: string;
    user_id: string;
    applicant_name: string;
    status: string;
    total_amount: string;
    allocated_amount: string | null;
    display_action: "attached" | "replaced" | null;
    payment_batch_id: string | null;
    original_payment_proof_path: string | null;
  }>(
    `SELECT DISTINCT ON (link.transaction_id, reimbursement.id)
            link.transaction_id, reimbursement.id AS reimbursement_id,
            reimbursement.type, reimbursement.title, reimbursement.user_id,
            reimbursement.applicant_name, reimbursement.status,
            reimbursement.total_amount::text AS total_amount,
            link.allocated_amount::text AS allocated_amount,
            CASE
              WHEN link.match_key_json ->> 'displayAction'
                   IN ('attached', 'replaced')
                THEN link.match_key_json ->> 'displayAction'
              ELSE NULL
            END AS display_action,
            COALESCE(reimbursement.payment_batch_id,
                     link.match_key_json ->> 'paymentBatchId')
              AS payment_batch_id,
            NULLIF(BTRIM(
              link.match_key_json ->> 'previousPaymentProofPath'
            ), '')
              AS original_payment_proof_path
     FROM monthly_financial_bank_transaction_links link
     JOIN monthly_financial_bank_transactions transaction
       ON transaction.id = link.transaction_id
     JOIN monthly_financial_bank_files file
       ON file.id = transaction.current_file_id
     JOIN reimbursements reimbursement
       ON reimbursement.id = link.business_object_id
     WHERE file.report_month = ?
       AND transaction.is_current = TRUE
       AND file.is_active = TRUE
       AND link.business_object_type = 'reimbursement'
       AND link.link_kind = 'display_replacement'
       AND link.match_status = 'active'
       AND link.is_active = TRUE
       AND reimbursement.is_deleted = FALSE
     ORDER BY link.transaction_id, reimbursement.id,
              link.updated_at DESC, link.id DESC`,
    [month],
  );
  const knownFileRows = await queryAll<{ file_hash: string }>(
    `SELECT file_hash
     FROM monthly_financial_bank_files
     WHERE report_month = ?
     ORDER BY created_at, id`,
    [month],
  );

  const accountCodes = Object.keys(
    MONTHLY_BANK_ACCOUNTS,
  ) as MonthlyBankAccountCode[];
  return {
    month,
    knownFileHashes: [...new Set(knownFileRows.map((row) => row.file_hash))],
    accounts: accountCodes.map((accountCode) => {
      const file =
        files.find((item) => item.account_code === accountCode) || null;
      const accountNumber = MONTHLY_BANK_ACCOUNTS[accountCode].accountNumber;
      const rows = transactions
        .filter((item) =>
          item.category === "internal_transfer"
            ? item.occurrence_account_codes.length
              ? item.occurrence_account_codes.includes(accountCode)
              : item.account_code === accountCode
            : item.account_code === accountCode,
        )
        .map((item) => ({
          ...item,
          include_in_report:
            item.include_in_report &&
            (item.file_recognition_status === "recognized" ||
              (item.file_recognition_status === "partial" &&
                Boolean(file?.charge_eligible) &&
                item.recognition_status === "recognized" &&
                (item.category === "interest" ||
                  item.category === "bank_fee"))),
          direction:
            item.category === "internal_transfer"
              ? normalizeMonthlyBankAccount(item.payer_account) ===
                accountNumber
                ? "outflow"
                : normalizeMonthlyBankAccount(item.payee_account) ===
                    accountNumber
                  ? "inflow"
                  : item.direction
              : item.direction,
        }));
      const sum = (predicate: (row: (typeof rows)[number]) => boolean) =>
        addFinancialAmounts(
          ...rows
            .filter(predicate)
            .map((row) => normalizeFinancialAmount(row.amount || "0")),
        );
      return {
        accountCode,
        accountName: MONTHLY_BANK_ACCOUNTS[accountCode].label,
        accountNumber: MONTHLY_BANK_ACCOUNTS[accountCode].accountNumber,
        file: file
          ? {
              id: file.id,
              originalName: file.original_name,
              fileHash: file.file_hash,
              version: file.file_version,
              pageCount: file.page_count,
              receiptCount: file.recognized_receipt_count,
              includedReceiptCount: file.included_receipt_count,
              status: file.recognition_status,
              detectedMonths: file.detected_months_json,
              warnings: file.warnings_json,
              anomalies: (file.anomalies_json || []).map((item) =>
                typeof item === "string"
                  ? item
                  : String(item?.warning || "银行回单存在待核对异常"),
              ),
              uploadedBy: file.uploaded_by,
              uploaderName: file.uploader_name,
              recognizedAt: file.recognized_at,
              updatedAt: file.updated_at,
            }
          : null,
        totals: {
          inflow: sum((row) => row.direction === "inflow"),
          outflow: sum((row) => row.direction === "outflow"),
          included: sum((row) => row.include_in_report),
          internalTransfer: sum((row) => row.category === "internal_transfer"),
          interest: sum((row) => row.category === "interest"),
          bankFee: sum((row) => row.category === "bank_fee"),
        },
        transactions: rows.map((row) => {
          const bankProofPreviewUrl = `/api/monthly-financial-reports/bank-transactions/${row.id}/preview?accountCode=${accountCode}`;
          const reimbursementLinks = linkedReimbursementRows.filter(
            (linked) => linked.transaction_id === row.id,
          );
          const linkedReimbursements = reimbursementLinks.map((linked) => {
            const hasOriginalProof = String(
              linked.original_payment_proof_path || "",
            )
              .split(",")
              .some((value) => Boolean(value.trim()));
            const originalProofPreviewUrl = hasOriginalProof
              ? `/api/monthly-financial-reports/bank-transactions/${encodeURIComponent(row.id)}/reimbursements/${encodeURIComponent(linked.reimbursement_id)}/previous-proof`
              : null;
            return {
              id: linked.reimbursement_id,
              type: linked.type,
              title: linked.title,
              applicantId: linked.user_id,
              applicantName: linked.applicant_name,
              status: linked.status,
              amount: linked.total_amount,
              allocatedAmount: linked.allocated_amount,
              detailUrl: `/${linked.type}-reimbursement/${encodeURIComponent(linked.reimbursement_id)}`,
              originalProofPreviewUrl,
              bankProofPreviewUrl,
              effectiveProofPreviewUrl: bankProofPreviewUrl,
              paymentBatchId: linked.payment_batch_id,
            };
          });
          const displayAction = reimbursementLinks.length
            ? reimbursementLinks.some(
                (linked) =>
                  linked.display_action === "replaced" ||
                  (linked.display_action === null &&
                    Boolean(linked.original_payment_proof_path)),
              )
              ? "replaced"
              : "attached"
            : "none";
          return {
            id: row.id,
            electronicReceiptNo: row.electronic_receipt_no,
            transactionDate: row.transaction_date,
            amount: row.amount || "0",
            direction: row.direction,
            payer: row.payer_name,
            payerAccount: row.payer_account,
            payee: row.payee_name,
            payeeAccount: row.payee_account,
            remark: row.remark,
            pageNo: row.page_number,
            position: row.receipt_position,
            category: row.category,
            recognitionStatus: row.recognition_status,
            includeInReport: row.include_in_report,
            warnings: [...row.warnings_json, ...row.link_warnings],
            // 旧字段继续保留，避免现有页面或调用方失效。
            linkStatus: row.link_status,
            previewUrl: bankProofPreviewUrl,
            employeeMatch: {
              status: row.employee_match_status,
              employeeId: row.employee_id,
              employeeName: row.employee_name,
            },
            reimbursementLink: {
              status: row.reimbursement_link_status,
              displayAction,
              reasons: row.reimbursement_link_warnings,
              linkedReimbursements,
            },
          };
        }),
      };
    }),
  };
}

async function persistMonthlyBankAnalyses(input: {
  month: string;
  expectedVersion: number;
  actor: FinancialActor;
  candidates: MonthlyBankUploadCandidate[];
}): Promise<{
  affectedMonths: string[];
  contractReconciliation: MonthlyContractReceiptReconciliationResult[];
  reimbursementReconciliation: MonthlyReimbursementReconciliationResult;
  salaryReconciliation: MonthlySalaryReceiptReconciliationResult[];
}> {
  let affectedMonths: string[] = [];
  let contractReconciliation: MonthlyContractReceiptReconciliationResult[] = [];
  let reimbursementReconciliation: MonthlyReimbursementReconciliationResult = {
    links: [],
    matchedGroups: [],
    pendingTransactions: [],
    replacedEvidence: [],
  };
  let salaryReconciliation: MonthlySalaryReceiptReconciliationResult[] = [];
  let bankAccountingFlagsNormalized = false;
  await db.transaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await lockFinancialMonth(client, input.month);
    const currentActor = await client.query<{
      role: string;
      status: string;
    }>("SELECT role, status FROM users WHERE id = $1 FOR UPDATE", [
      input.actor.id,
    ]);
    if (
      currentActor.rows[0]?.status !== "active" ||
      currentActor.rows[0]?.role !== "admin"
    ) {
      throw new MonthlyFinancialRouteError(
        403,
        "MONTHLY_BANK_UPLOAD_PERMISSION_CHANGED",
        "当前账号权限已变化，银行回单未写入，请重新登录后再试",
      );
    }
    const receiptNumbers = [
      ...new Set(
        input.candidates.flatMap((candidate) =>
          candidate.analysis.transactions
            .map((transaction) => transaction.normalizedElectronicReceiptNo)
            .filter(Boolean),
        ),
      ),
    ].sort();
    for (const receiptNo of receiptNumbers) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`monthly-bank-receipt:${receiptNo}`],
      );
    }
    const reportRow = await loadReportRow(input.month, client, true);
    if ((reportRow?.version || 0) !== input.expectedVersion) {
      throw new Error("月度报表版本已变化，请刷新后重试");
    }
    if (reportRow?.status === "closed") {
      throw conflict(
        "MONTHLY_FINANCE_REPORT_CLOSED",
        "已月结报表不能上传银行回单，请先重新开启",
      );
    }
    const previous = await loadPreviousContext(input.month, reportRow, client);
    const now = new Date().toISOString();
    const reportId = reportRow?.id || `mfr_${nanoid(16)}`;
    const currentAutomatic = reportRow
      ? asAutomaticSnapshot(reportRow.automatic_snapshot_json)
      : await loadAutomaticSnapshot(input.month, client);
    if (!currentAutomatic) {
      throw dataIntegrity(`${input.month}自动数据快照不完整，请先执行重新同步`);
    }
    if (!reportRow) {
      await client.query(
        `INSERT INTO monthly_financial_reports(
           id, report_month, status, version, opening_balances_json,
           automatic_snapshot_json, last_refreshed_at,
           created_by, updated_by, created_at, updated_at
         ) VALUES($1, $2, 'draft', 1, $3::jsonb, $4::jsonb, $5, $6, $6, $5, $5)`,
        [
          reportId,
          input.month,
          JSON.stringify(previous.openingBalances),
          JSON.stringify(currentAutomatic),
          now,
          input.actor.id,
        ],
      );
    }

    for (const candidate of input.candidates) {
      const analysis = candidate.analysis;
      const accountCode = analysis.accountCode!;
      const previousFile = await client.query<{
        id: string;
        file_version: number;
      }>(
        `SELECT id, file_version FROM monthly_financial_bank_files
         WHERE report_month = $1 AND account_code = $2 AND is_active = TRUE
         FOR UPDATE`,
        [input.month, accountCode],
      );
      const replaced = previousFile.rows[0] || null;
      const fileVersion = (replaced?.file_version || 0) + 1;
      if (replaced) {
        const replacedTransactions = await client.query<{ id: string }>(
          `SELECT id FROM monthly_financial_bank_transactions
           WHERE current_file_id = $1 AND is_current = TRUE FOR UPDATE`,
          [replaced.id],
        );
        await client.query(
          `UPDATE monthly_financial_bank_files
           SET is_active = FALSE, recognition_status = 'replaced',
               replaced_at = $2, updated_at = $2
           WHERE id = $1`,
          [replaced.id, now],
        );
        await client.query(
          `UPDATE monthly_financial_bank_transaction_links
           SET match_status = 'replaced', is_active = FALSE, updated_at = $2
           WHERE business_object_type = 'monthly_bank_file'
             AND business_object_id = $1
             AND link_kind = 'matched'
             AND is_active = TRUE`,
          [replaced.id, now],
        );
        await client.query(
          `UPDATE monthly_financial_bank_transactions
           SET is_current = FALSE, include_in_report = FALSE, updated_at = $2
           WHERE current_file_id = $1 AND is_current = TRUE`,
          [replaced.id, now],
        );
        for (const transaction of replacedTransactions.rows) {
          const fallbackOccurrence = await client.query<{
            file_id: string;
            file_version: number;
            receipt_index: number | null;
            preview_path: string | null;
          }>(
            `SELECT file.id AS file_id, file.file_version,
                    NULLIF(
                      link.match_key_json ->> 'receiptIndex', ''
                    )::int AS receipt_index,
                    link.match_key_json ->> 'previewPath' AS preview_path
             FROM monthly_financial_bank_transaction_links link
             JOIN monthly_financial_bank_files file
               ON file.id = link.business_object_id
             WHERE link.transaction_id = $1
               AND link.business_object_type = 'monthly_bank_file'
               AND link.link_kind = 'matched'
               AND link.match_status = 'active'
               AND link.is_active = TRUE
               AND file.is_active = TRUE
             ORDER BY file.updated_at DESC, file.id DESC
             LIMIT 1`,
            [transaction.id],
          );
          const fallback = fallbackOccurrence.rows[0];
          if (!fallback) continue;
          await client.query(
            `UPDATE monthly_financial_bank_transactions
             SET current_file_id = $2, current_file_version = $3,
                 receipt_index = COALESCE($4, receipt_index),
                 crop_path = COALESCE($5, crop_path), is_current = TRUE,
                 updated_at = $6
             WHERE id = $1`,
            [
              transaction.id,
              fallback.file_id,
              fallback.file_version,
              fallback.receipt_index,
              fallback.preview_path,
              now,
            ],
          );
        }
      }

      const recognizedCount = analysis.transactions.length;
      const includedCount = analysis.transactions.filter(
        (transaction) => transaction.includeInReport,
      ).length;
      const hasReview =
        analysis.warnings.some((warning) =>
          /识别失败|未识别到有效回单文本|页面转换失败|页转换失败|超过两张回单|未成功拆分|同一文件电子回单号.*不一致/u.test(
            warning,
          ),
        ) ||
        analysis.transactions.some(
          (transaction) => transaction.recognitionStatus === "review_required",
        );
      await client.query(
        `INSERT INTO monthly_financial_bank_files(
           id, report_id, report_month, account_code, original_name,
           storage_path, mime_type, file_size, file_hash, file_version,
           is_active, replaces_file_id, page_count, recognized_receipt_count,
           included_receipt_count, recognition_status, detected_months_json,
           warnings_json, anomalies_json, uploaded_by, activated_at,
           recognized_at, created_at, updated_at
         ) VALUES(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12,$13,$14,$15,
           $16::jsonb,$17::jsonb,$18::jsonb,$19,$20,$20,$20,$20
         )`,
        [
          candidate.id,
          reportId,
          input.month,
          accountCode,
          candidate.file.originalname,
          path.relative(process.cwd(), candidate.file.path),
          candidate.file.mimetype,
          candidate.file.size,
          analysis.fileHash,
          fileVersion,
          replaced?.id || null,
          analysis.pageCount,
          recognizedCount,
          includedCount,
          hasReview ? "partial" : "recognized",
          JSON.stringify(analysis.transactionMonths),
          JSON.stringify(analysis.warnings),
          JSON.stringify(
            analysis.transactions.flatMap((transaction) =>
              transaction.warnings.map((warning) => ({
                electronicReceiptNo: transaction.electronicReceiptNo,
                warning,
              })),
            ),
          ),
          input.actor.id,
          now,
        ],
      );

      for (const [index, transaction] of analysis.transactions.entries()) {
        const normalizedNo = transaction.normalizedElectronicReceiptNo || null;
        const existing = normalizedNo
          ? (
              await client.query<{
                id: string;
                account_code: MonthlyBankAccountCode;
                report_month: string;
                transaction_date: string | null;
                amount: string | null;
                payer_account: string | null;
                payee_account: string | null;
                category: string;
                is_current: boolean;
              }>(
                `SELECT id, account_code, report_month, transaction_date,
                        amount::text AS amount, payer_account, payee_account,
                        category, is_current
                 FROM monthly_financial_bank_transactions
                 WHERE normalized_electronic_receipt_no = $1 FOR UPDATE`,
                [normalizedNo],
              )
            ).rows[0] || null
          : null;
        const transactionMonth = transaction.transactionMonth || input.month;
        const existingContentMatches = existing
          ? existing.transaction_date === transaction.transactionDate &&
            financialAmountToCents(existing.amount || "0") ===
              financialAmountToCents(transaction.amount) &&
            normalizeMonthlyBankAccount(existing.payer_account) ===
              normalizeMonthlyBankAccount(transaction.payerAccount) &&
            normalizeMonthlyBankAccount(existing.payee_account) ===
              normalizeMonthlyBankAccount(transaction.payeeAccount)
          : false;
        const sharedInternalTransfer = Boolean(
          existing &&
          existingContentMatches &&
          existing.report_month === transactionMonth &&
          existing.account_code !== accountCode &&
          existing.category === "internal_transfer" &&
          transaction.category === "internal_transfer",
        );
        if (
          existing &&
          (existing.account_code !== accountCode ||
            existing.report_month !== transactionMonth) &&
          !sharedInternalTransfer
        ) {
          throw conflict(
            "MONTHLY_BANK_RECEIPT_ALREADY_EXISTS",
            `电子回单号${transaction.electronicReceiptNo}已在其他账户或月份存在，未生成重复数据`,
          );
        }
        if (
          existing &&
          existing.account_code === accountCode &&
          existing.report_month === transactionMonth
        ) {
          if (!existingContentMatches) {
            throw conflict(
              "MONTHLY_BANK_RECEIPT_CONTENT_CONFLICT",
              `电子回单号${transaction.electronicReceiptNo}已存在，但完整账号、日期或金额不一致，请管理员核对`,
            );
          }
        }
        const values = [
          candidate.id,
          fileVersion,
          index + 1,
          transaction.electronicReceiptNo || null,
          normalizedNo,
          transaction.transactionDate || null,
          transaction.amount > 0 ? transaction.amount : null,
          transaction.direction,
          transaction.payer || null,
          transaction.payerAccount || null,
          transaction.payee || null,
          transaction.payeeAccount || null,
          monthlyBankMatchedAccountRole(transaction, accountCode),
          transaction.remark || null,
          transaction.pageNo,
          transaction.position,
          transaction.previewPath,
          transaction.category,
          transaction.recognitionStatus,
          JSON.stringify(transaction.warnings),
          JSON.stringify({
            rawTextHash: transaction.rawTextHash,
            sourceFileHash: analysis.fileHash,
          }),
          transaction.includeInReport,
          now,
        ];

        let persistedTransactionId: string | null = null;
        if (
          existing &&
          !sharedInternalTransfer &&
          existing.account_code === accountCode &&
          existing.report_month === transactionMonth
        ) {
          await client.query(
            `UPDATE monthly_financial_bank_transactions
             SET current_file_id = $2, current_file_version = $3,
                 receipt_index = $4, electronic_receipt_no = $5,
                 normalized_electronic_receipt_no = $6,
                 transaction_date = $7, amount = $8::numeric,
                 direction = $9, payer_name = $10, payer_account = $11,
                 payee_name = $12, payee_account = $13,
                 matched_account_role = $14, remark = $15,
                 page_number = $16, receipt_position = $17, crop_path = $18,
                 category = $19, recognition_status = $20,
                 warnings_json = $21::jsonb, raw_ocr_json = $22::jsonb,
                 include_in_report = $23, is_current = TRUE,
                 recognized_at = $24, updated_at = $24
             WHERE id = $1`,
            [existing.id, ...values],
          );
          persistedTransactionId = existing.id;
        } else if (!existing) {
          const newTransactionId = `mfbt_${nanoid(16)}`;
          await client.query(
            `INSERT INTO monthly_financial_bank_transactions(
               id, report_id, report_month, account_code, first_seen_file_id,
               current_file_id, current_file_version, receipt_index,
               electronic_receipt_no, normalized_electronic_receipt_no,
               transaction_date, amount, direction, payer_name, payer_account,
               payee_name, payee_account, matched_account_role, remark,
               page_number, receipt_position, crop_path, category,
               recognition_status, warnings_json, raw_ocr_json,
               include_in_report, is_current, recognized_at, created_at, updated_at
             ) VALUES(
               $1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11::numeric,$12,$13,$14,
               $15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25::jsonb,
               $26,TRUE,$27,$27,$27
             )`,
            [
              newTransactionId,
              reportId,
              transactionMonth,
              accountCode,
              candidate.id,
              fileVersion,
              index + 1,
              transaction.electronicReceiptNo || null,
              normalizedNo,
              transaction.transactionDate || null,
              transaction.amount > 0 ? transaction.amount : null,
              transaction.direction,
              transaction.payer || null,
              transaction.payerAccount || null,
              transaction.payee || null,
              transaction.payeeAccount || null,
              monthlyBankMatchedAccountRole(transaction, accountCode),
              transaction.remark || null,
              transaction.pageNo,
              transaction.position,
              transaction.previewPath,
              transaction.category,
              transaction.recognitionStatus,
              JSON.stringify(transaction.warnings),
              JSON.stringify({
                rawTextHash: transaction.rawTextHash,
                sourceFileHash: analysis.fileHash,
              }),
              transaction.includeInReport,
              now,
            ],
          );
          persistedTransactionId = newTransactionId;
        } else if (sharedInternalTransfer && existing) {
          persistedTransactionId = existing.id;
          if (!existing.is_current) {
            await client.query(
              `UPDATE monthly_financial_bank_transactions
               SET current_file_id = $2, current_file_version = $3,
                   receipt_index = $4, direction = $5,
                   page_number = $6, receipt_position = $7, crop_path = $8,
                   include_in_report = FALSE, is_current = TRUE,
                   recognized_at = $9, updated_at = $9
               WHERE id = $1`,
              [
                existing.id,
                candidate.id,
                fileVersion,
                index + 1,
                transaction.direction,
                transaction.pageNo,
                transaction.position,
                transaction.previewPath,
                now,
              ],
            );
          }
        }

        if (persistedTransactionId) {
          await client.query(
            `INSERT INTO monthly_financial_bank_transaction_links(
               id, transaction_id, business_object_type, business_object_id,
               link_kind, match_method, match_status, match_key_json,
               allocated_amount, warnings_json, is_active, created_by,
               created_at, updated_at
             )
             SELECT $1,$2,'monthly_bank_file',$3,'matched','business_key',
                    'active',$4::jsonb,NULL,'[]'::jsonb,TRUE,$5,$6,$6
             WHERE NOT EXISTS (
               SELECT 1 FROM monthly_financial_bank_transaction_links
               WHERE transaction_id = $2
                 AND business_object_type = 'monthly_bank_file'
                 AND business_object_id = $3
                 AND link_kind = 'matched'
                 AND is_active = TRUE
             )`,
            [
              `mfbl_${nanoid(16)}`,
              persistedTransactionId,
              candidate.id,
              JSON.stringify({
                accountCode,
                direction: transaction.direction,
                receiptIndex: index + 1,
                previewPath: transaction.previewPath,
                pageNo: transaction.pageNo,
                position: transaction.position,
              }),
              input.actor.id,
              now,
            ],
          );
        }

        if (
          persistedTransactionId &&
          ([
            "salary",
            "basic_reimbursement",
            "large_reimbursement",
            "business_reimbursement",
          ].includes(transaction.category) ||
            (accountCode === "basic" &&
              transaction.direction === "outflow" &&
              transaction.category === "ignored"))
        ) {
          const employeeMatches = await client.query<{ id: string }>(
            `SELECT employee.id
             FROM employee_profiles employee
             LEFT JOIN users user_account ON user_account.id = employee.user_id
             WHERE BTRIM(employee.name) = BTRIM($1)
               AND REGEXP_REPLACE(
                     COALESCE(employee.bank_account_number,
                              user_account.bank_account_number, ''),
                     '[^0-9]+', '', 'g'
                   ) = $2
             ORDER BY employee.id`,
            [
              transaction.payee || "",
              normalizeMonthlyBankAccount(transaction.payeeAccount),
            ],
          );
          if (
            transaction.category === "ignored" &&
            employeeMatches.rows.length > 0
          ) {
            throw badRequest(
              "MONTHLY_BANK_EMPLOYEE_PAYMENT_PURPOSE_UNCLEAR",
              `电子回单号${transaction.electronicReceiptNo}为基本账户向员工付款，但未识别到“薪资”或“商务报销”用途，本次文件未替换当前月报数据`,
            );
          }
          if (employeeMatches.rows.length === 1) {
            const employeeId = employeeMatches.rows[0]!.id;
            await client.query(
              `INSERT INTO monthly_financial_bank_transaction_links(
                 id, transaction_id, business_object_type, business_object_id,
                 link_kind, match_method, match_status, match_key_json,
                 allocated_amount, warnings_json, is_active, created_by,
                 created_at, updated_at
               )
               SELECT $1,$2,'employee_profile',$3,'classification_basis',
                      'account_date_amount','active',$4::jsonb,$5::numeric,
                      '[]'::jsonb,TRUE,$6,$7,$7
               WHERE NOT EXISTS (
                 SELECT 1 FROM monthly_financial_bank_transaction_links
                 WHERE transaction_id = $2
                   AND business_object_type = 'employee_profile'
                   AND business_object_id = $3
                   AND link_kind = 'classification_basis'
                   AND is_active = TRUE
               )`,
              [
                `mfbl_${nanoid(16)}`,
                persistedTransactionId,
                employeeId,
                JSON.stringify({
                  payeeName: transaction.payee,
                  payeeAccount: normalizeMonthlyBankAccount(
                    transaction.payeeAccount,
                  ),
                }),
                transaction.amount,
                input.actor.id,
                now,
              ],
            );
          } else if (transaction.category !== "ignored") {
            const paymentLabel =
              (
                {
                  salary: "工资",
                  basic_reimbursement: "基础报销",
                  large_reimbursement: "大额报销",
                  business_reimbursement: "商务报销",
                } as Record<string, string>
              )[transaction.category] || "员工付款";
            const warning = employeeMatches.rows.length
              ? `${paymentLabel}收款人姓名与完整账号匹配到多名员工，需管理员复核`
              : `${paymentLabel}收款人姓名与完整账号未匹配员工`;
            throw badRequest(
              "MONTHLY_BANK_EMPLOYEE_NOT_MATCHED",
              `${warning}，本次文件未替换当前月报数据`,
            );
          }
        }

        const shouldTryContractMatch =
          accountCode === "general" &&
          ["main_income", "asset_expense", "unclassified"].includes(
            transaction.category,
          );
        const shouldTryEmployeePaymentMatch =
          accountCode !== "business" &&
          [
            "basic_reimbursement",
            "large_reimbursement",
            "business_reimbursement",
            "salary",
          ].includes(transaction.category);
        if (
          persistedTransactionId &&
          normalizedNo &&
          (shouldTryContractMatch || shouldTryEmployeePaymentMatch)
        ) {
          const linkResult = await linkMonthlyFinancialBankTransaction(
            client,
            persistedTransactionId,
            input.actor.id,
            now,
          );
          if (shouldTryContractMatch) {
            if (!linkResult.categoryOverride) {
              const contractReviewWarning = linkResult.conflicts.length
                ? "MONTHLY_BANK_CONTRACT_MATCH_REQUIRED: 存在同回单号合同记录，但账户归属、收支方向、完整账号、交易日期、金额、确认状态或合同分类不一致，已转为待核对"
                : "MONTHLY_BANK_CONTRACT_MATCH_REQUIRED: 未找到对应的已确认合同收付款记录，已保存银行回单并转为待关联";
              await client.query(
                `UPDATE monthly_financial_bank_transactions
                 SET recognition_status = 'review_required',
                     include_in_report = FALSE,
                     warnings_json = COALESCE(warnings_json, '[]'::jsonb) ||
                       jsonb_build_array($2::text),
                     updated_at = $3
                 WHERE id = $1`,
                [persistedTransactionId, contractReviewWarning, now],
              );
            } else {
              await client.query(
                `UPDATE monthly_financial_bank_transactions
                 SET category = $2, recognition_status = 'recognized',
                     include_in_report = FALSE,
                     warnings_json = COALESCE(warnings_json, '[]'::jsonb) -
                       '该回单无法安全归入主营收入或资产支出，需管理员核对',
                     updated_at = $3
                 WHERE id = $1`,
                [persistedTransactionId, linkResult.categoryOverride, now],
              );
            }
          }
        }
      }

      await client.query(
        `UPDATE monthly_financial_bank_files file
         SET included_receipt_count = CASE
               WHEN summary.review_count > 0
                 THEN summary.safe_charge_count
               ELSE summary.included_count
             END,
             recognition_status = CASE
               WHEN summary.review_count > 0 THEN 'partial'
               ELSE 'recognized'
             END,
             warnings_json = CASE
               WHEN summary.review_count > 0
                AND NOT (
                  COALESCE(file.warnings_json, '[]'::jsonb) ?
                    '存在未关联的合同收付款回单，已确认的利息和跨行手续费仍计入月报'
                )
                 THEN COALESCE(file.warnings_json, '[]'::jsonb) ||
                   jsonb_build_array(
                     '存在未关联的合同收付款回单，已确认的利息和跨行手续费仍计入月报'
                   )
               ELSE file.warnings_json
             END,
             updated_at = $2
         FROM (
           SELECT current_file_id,
                  COUNT(*) FILTER (WHERE include_in_report)::int AS included_count,
                  COUNT(*) FILTER (
                    WHERE include_in_report
                      AND recognition_status = 'recognized'
                      AND account_code IN ('general', 'business')
                      AND category IN ('interest', 'bank_fee')
                  )::int AS safe_charge_count,
                  COUNT(*) FILTER (
                    WHERE recognition_status = 'review_required'
                  )::int AS review_count
           FROM monthly_financial_bank_transactions
           WHERE current_file_id = $1 AND is_current = TRUE
           GROUP BY current_file_id
         ) summary
         WHERE file.id = $1 AND summary.current_file_id = file.id`,
        [candidate.id, now],
      );
    }

    contractReconciliation = await reconcileMonthlyContractBankTransactions(
      client,
      input.month,
      input.actor.id,
      now,
      input.actor.role,
    );
    salaryReconciliation = await reconcileMonthlySalaryReceiptMonth(
      client,
      input.month,
      input.actor.id,
      now,
    );
    reimbursementReconciliation =
      await reconcileMonthlyReimbursementTransactions(client, {
        reportMonth: input.month,
        actorId: input.actor.id,
        now,
      });
    bankAccountingFlagsNormalized = await normalizeMonthlyBankAccountingFlags(
      client,
      input.month,
      now,
    );
    const hasPersistedChanges =
      input.candidates.length > 0 ||
      contractReconciliation.some((result) => result.changed) ||
      salaryReconciliation.some((result) => result.changed) ||
      bankAccountingFlagsNormalized ||
      reimbursementReconciliation.links.length > 0 ||
      reimbursementReconciliation.replacedEvidence.length > 0;
    if (!hasPersistedChanges) return;
    const laterRows = await client.query<ReportRow>(
      `SELECT * FROM monthly_financial_reports
       WHERE report_month > $1 ORDER BY report_month FOR UPDATE`,
      [input.month],
    );
    affectedMonths = await invalidateClosedReportRows({
      client,
      rows: laterRows.rows,
      sourceMonth: input.month,
      actor: input.actor,
      now,
      reason: input.candidates.length
        ? "上传或替换月度银行回单"
        : "重新匹配并挂载月度银行业务回单",
    });
    const automatic = await loadAutomaticSnapshot(input.month, client);
    const nextVersion = reportRow ? reportRow.version + 1 : 1;
    await client.query(
      `UPDATE monthly_financial_reports
       SET automatic_snapshot_json = $2::jsonb, last_refreshed_at = $3,
           version = $4, updated_by = $5, updated_at = $3
       WHERE id = $1`,
      [reportId, JSON.stringify(automatic), now, nextVersion, input.actor.id],
    );
    await client.query(
      `INSERT INTO monthly_financial_audit_logs(
         id, report_id, report_version, action, actor_id, actor_role,
         changes_json, created_at
       ) VALUES($1,$2,$3,'refresh',$4,$5,$6::jsonb,$7)`,
      [
        `mfal_${nanoid(16)}`,
        reportId,
        nextVersion,
        input.actor.id,
        input.actor.role,
        JSON.stringify({
          source: "monthly_bank_receipt_upload",
          files: input.candidates.map((candidate) => ({
            fileId: candidate.id,
            accountCode: candidate.analysis.accountCode,
            fileHash: candidate.analysis.fileHash,
            receiptCount: candidate.analysis.transactions.length,
          })),
          reimbursementReconciliation,
          salaryReconciliation,
          contractReconciliation,
          bankAccountingFlagsNormalized,
          invalidatedMonths: affectedMonths,
        }),
        now,
      ],
    );
  });
  return {
    affectedMonths,
    contractReconciliation,
    reimbursementReconciliation,
    salaryReconciliation,
  };
}

export async function normalizeMonthlyBankAccountingFlags(
  client: QueryClient,
  month: string,
  now: string,
): Promise<boolean> {
  const updated = await client.query<{ current_file_id: string }>(
    `UPDATE monthly_financial_bank_transactions transaction
        SET include_in_report = (
              transaction.recognition_status = 'recognized'
              AND transaction.account_code IN ('general', 'business')
              AND transaction.category IN ('interest', 'bank_fee')
            ),
            updated_at = $2
      WHERE transaction.report_month = $1
        AND transaction.is_current = TRUE
        AND EXISTS (
          SELECT 1 FROM monthly_financial_bank_files file
          WHERE file.id = transaction.current_file_id
            AND file.is_active = TRUE
        )
        AND transaction.include_in_report IS DISTINCT FROM (
              transaction.recognition_status = 'recognized'
              AND transaction.account_code IN ('general', 'business')
              AND transaction.category IN ('interest', 'bank_fee')
            )
      RETURNING transaction.current_file_id`,
    [month, now],
  );
  const fileIds = [...new Set(updated.rows.map((row) => row.current_file_id))];
  for (const fileId of fileIds) {
    await client.query(
      `UPDATE monthly_financial_bank_files file
          SET included_receipt_count = (
                SELECT COUNT(*)::int
                FROM monthly_financial_bank_transactions transaction
                WHERE transaction.current_file_id = file.id
                  AND transaction.is_current = TRUE
                  AND transaction.include_in_report = TRUE
              ),
              updated_at = $2
        WHERE file.id = $1 AND file.is_active = TRUE`,
      [fileId, now],
    );
  }
  return updated.rows.length > 0;
}

function sendFailure(res: Response, error: unknown): void {
  const message =
    error instanceof Error ? error.message : "月度财务报表操作失败";
  if (error instanceof MonthlyFinancialRouteError) {
    res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
    return;
  }
  if (message.includes("monthly_financial_manual_items_category_check")) {
    res.status(400).json({
      success: false,
      message: "手工项目分类与数据库版本不一致，请重启服务完成升级后重试",
    });
    return;
  }
  if (
    /银行回单仅支持|银行回单真实文件格式|银行回单(?:合计)?不能超过|银行回单 PDF 无法打开|银行回单页面转换失败|页尺寸异常|File too large|Unexpected field|Too many files/u.test(
      message,
    )
  ) {
    res.status(400).json({
      success: false,
      code: "MONTHLY_BANK_UPLOAD_VALIDATION_ERROR",
      message:
        message === "File too large"
          ? "单个银行回单文件不能超过 50MB"
          : message,
    });
    return;
  }
  const databaseCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const databaseConstraint =
    error && typeof error === "object" && "constraint" in error
      ? String((error as { constraint?: unknown }).constraint || "")
      : "";
  if (
    databaseCode === "23505" &&
    databaseConstraint.includes("monthly_financial_bank_files") &&
    databaseConstraint.includes("hash")
  ) {
    res.status(409).json({
      success: false,
      code: "MONTHLY_BANK_FILE_ALREADY_UPLOADED",
      message: "该文件已经上传",
    });
    return;
  }
  if (
    databaseCode === "23505" &&
    databaseConstraint === "uq_monthly_financial_bank_receipt_no"
  ) {
    res.status(409).json({
      success: false,
      code: "MONTHLY_BANK_RECEIPT_ALREADY_EXISTS",
      message: "电子回单号码已存在，未生成重复数据",
    });
    return;
  }
  if (
    message === "月度报表版本已变化，请刷新后重试" ||
    databaseCode === "23505" ||
    databaseCode === "40001" ||
    databaseCode === "40P01"
  ) {
    res.status(409).json({
      success: false,
      code: "MONTHLY_FINANCE_VERSION_CONFLICT",
      message: "月度报表版本已变化，请刷新后重试",
    });
    return;
  }
  if (message.includes("已月结") || message.includes("尚未月结")) {
    res.status(409).json({ success: false, message });
    return;
  }
  if (
    /月份格式|版本号|金额|手工项目|日期必须|账户或收支方向|期初余额|重新开启必须|重新开启原因|负数期末余额/.test(
      message,
    )
  ) {
    res.status(400).json({
      success: false,
      code: "MONTHLY_FINANCE_VALIDATION_ERROR",
      message,
    });
    return;
  }
  console.error("月度财务报表操作失败:", error);
  res.status(500).json({
    success: false,
    code: "MONTHLY_FINANCE_INTERNAL_ERROR",
    message: "月度财务报表服务暂时不可用，请稍后重试",
  });
}

function receiveMonthlyBankFiles(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  monthlyBankUpload.array("files", 3)(req, res, (error: unknown) => {
    if (error) {
      const uploadedFiles = (
        Array.isArray(req.files) ? req.files : []
      ) as Express.Multer.File[];
      void Promise.all(
        uploadedFiles.map((file) => cleanupMonthlyBankUpload(file.path)),
      ).finally(() => sendFailure(res, error));
      return;
    }
    next();
  });
}

router.get(
  "/bank-transactions/:transactionId/preview",
  requireAuth,
  async (req, res) => {
    try {
      const actor = getActor(req);
      const canReadMonthlyReport = READ_ROLES.includes(actor.role);
      const requestedAccountCode = ["basic", "general", "business"].includes(
        String(req.query.accountCode || ""),
      )
        ? String(req.query.accountCode)
        : null;
      const requestedFileId = /^mfbf_[A-Za-z0-9_-]{1,80}$/u.test(
        String(req.query.fileId || ""),
      )
        ? String(req.query.fileId)
        : null;
      const row = await queryOne<{
        crop_path: string | null;
        occurrence_crop_path: string | null;
        historical_crop_path: string | null;
        owns_linked_reimbursement: boolean;
      }>(
        `SELECT transaction.crop_path,
                (SELECT link.match_key_json ->> 'previewPath'
                 FROM monthly_financial_bank_transaction_links link
                 JOIN monthly_financial_bank_files file
                   ON file.id = link.business_object_id
                 WHERE link.transaction_id = transaction.id
                   AND link.business_object_type = 'monthly_bank_file'
                   AND link.link_kind = 'matched'
                   AND link.match_status = 'active'
                   AND link.is_active = TRUE
                   AND file.is_active = TRUE
                   AND file.account_code = ?
                 ORDER BY file.updated_at DESC, file.id DESC LIMIT 1)
                   AS occurrence_crop_path,
                (SELECT link.match_key_json ->> 'previewPath'
                 FROM monthly_financial_bank_transaction_links link
                 WHERE link.transaction_id = transaction.id
                   AND link.business_object_type = 'monthly_bank_file'
                   AND link.business_object_id = ?
                   AND link.link_kind = 'matched'
                 ORDER BY link.created_at DESC, link.id DESC LIMIT 1)
                   AS historical_crop_path,
                EXISTS (
                  SELECT 1
                  FROM monthly_financial_bank_transaction_links link
                  JOIN reimbursements reimbursement
                    ON reimbursement.id = link.business_object_id
                  WHERE link.transaction_id = transaction.id
                    AND link.business_object_type = 'reimbursement'
                    AND link.link_kind = 'display_replacement'
                    AND link.match_status = 'active'
                    AND link.is_active = TRUE
                    AND reimbursement.user_id = ?
                    AND reimbursement.is_deleted = FALSE
                ) AS owns_linked_reimbursement
         FROM monthly_financial_bank_transactions transaction
         WHERE transaction.id = ?`,
        [
          requestedAccountCode,
          requestedFileId,
          actor.id,
          req.params.transactionId,
        ],
      );
      if (!canReadMonthlyReport && !row?.owns_linked_reimbursement) {
        res.status(403).json({
          success: false,
          code: "MONTHLY_BANK_PREVIEW_FORBIDDEN",
          message: "无权预览该报销关联的银行回单",
        });
        return;
      }
      const previewPath = requestedFileId
        ? row?.historical_crop_path
        : requestedAccountCode
          ? row?.occurrence_crop_path
          : row?.crop_path;
      if (!previewPath) {
        res.status(404).json({ success: false, message: "回单预览不存在" });
        return;
      }
      const resolvedRoot = path.resolve(MONTHLY_BANK_UPLOAD_ROOT);
      const resolvedPath = path.resolve(process.cwd(), previewPath);
      if (
        resolvedPath !== resolvedRoot &&
        !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
      ) {
        res.status(403).json({
          success: false,
          code: "MONTHLY_BANK_PREVIEW_PATH_FORBIDDEN",
          message: "回单预览路径不安全",
        });
        return;
      }
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
      res.type("image/jpeg");
      res.sendFile(resolvedPath);
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.get(
  "/bank-transactions/:transactionId/reimbursements/:reimbursementId/previous-proof",
  requireAuth,
  async (req, res) => {
    try {
      const actor = getActor(req);
      const indexText = String(req.query.index ?? "0");
      if (!/^\d+$/u.test(indexText)) {
        res.status(400).json({
          success: false,
          code: "MONTHLY_PREVIOUS_PAYMENT_PROOF_INDEX_INVALID",
          message: "原回单序号不正确",
        });
        return;
      }
      const proofIndex = Number(indexText);
      if (!Number.isSafeInteger(proofIndex) || proofIndex > 99) {
        res.status(400).json({
          success: false,
          code: "MONTHLY_PREVIOUS_PAYMENT_PROOF_INDEX_INVALID",
          message: "原回单序号不正确",
        });
        return;
      }
      const linked = await queryOne<{
        user_id: string;
        type: "basic" | "large" | "business";
        previous_payment_proof_path: string;
      }>(
        `SELECT reimbursement.user_id, reimbursement.type,
                link.match_key_json ->> 'previousPaymentProofPath'
                  AS previous_payment_proof_path
         FROM monthly_financial_bank_transaction_links link
         JOIN monthly_financial_bank_transactions bank_transaction
           ON bank_transaction.id = link.transaction_id
         JOIN monthly_financial_bank_files bank_file
           ON bank_file.id = bank_transaction.current_file_id
          AND bank_file.is_active = TRUE
         JOIN reimbursements reimbursement
           ON reimbursement.id = link.business_object_id
         WHERE link.transaction_id = ?
           AND link.business_object_type = 'reimbursement'
           AND link.business_object_id = ?
           AND link.link_kind = 'display_replacement'
           AND link.match_status = 'active'
           AND link.is_active = TRUE
           AND link.match_key_json ->> 'displayAction' = 'replaced'
           AND NULLIF(BTRIM(
                 link.match_key_json ->> 'previousPaymentProofPath'
               ), '') IS NOT NULL
           AND bank_transaction.is_current = TRUE
           AND reimbursement.is_deleted = FALSE
         ORDER BY link.updated_at DESC, link.id DESC
         LIMIT 1`,
        [req.params.transactionId, req.params.reimbursementId],
      );
      if (!linked) {
        res.status(404).json({
          success: false,
          code: "MONTHLY_PREVIOUS_PAYMENT_PROOF_NOT_FOUND",
          message: "原回单不存在或替换链接已失效",
        });
        return;
      }
      const canRead =
        actor.role === "admin" ||
        linked.user_id === actor.id ||
        (actor.role === "general_manager" && linked.type === "business");
      if (!canRead) {
        res.status(403).json({
          success: false,
          code: "MONTHLY_PREVIOUS_PAYMENT_PROOF_FORBIDDEN",
          message: "无权预览该报销被替换的原回单",
        });
        return;
      }
      const storedPaths = linked.previous_payment_proof_path
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const storedPath = storedPaths[proofIndex];
      if (!storedPath) {
        res.status(404).json({
          success: false,
          code: "MONTHLY_PREVIOUS_PAYMENT_PROOF_NOT_FOUND",
          message: "原回单不存在",
        });
        return;
      }
      const resolvedPath = await resolvePreviousPaymentProofPath(storedPath);
      if (!resolvedPath) {
        res.status(403).json({
          success: false,
          code: "MONTHLY_PREVIOUS_PAYMENT_PROOF_PATH_FORBIDDEN",
          message: "原回单路径不安全或文件不存在",
        });
        return;
      }
      res.sendFile(resolvedPath);
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.get(
  "/:month/bank-receipts",
  requireRole(READ_ROLES),
  async (req, res) => {
    try {
      const month = assertFinancialMonth(req.params.month);
      res.json({ success: true, data: await loadMonthlyBankState(month) });
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.post(
  "/:month/bank-transactions/:transactionId/review",
  requireRole(WRITE_ROLES),
  async (req, res) => {
    try {
      const month = assertFinancialMonth(req.params.month);
      const actor = getActor(req);
      const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
      const action = String(req.body?.action || "");
      const reason = String(req.body?.reason || "").trim();
      if (action !== "exclude") {
        throw badRequest(
          "MONTHLY_BANK_REVIEW_ACTION_INVALID",
          "当前仅支持复核后排除该笔交易",
        );
      }
      if (!reason || reason.length > 500) {
        throw badRequest(
          "MONTHLY_BANK_REVIEW_REASON_REQUIRED",
          "复核排除原因必须填写且不能超过500字",
        );
      }

      let affectedMonths: string[] = [];
      await db.transaction(async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        await lockFinancialMonth(client, month);
        const currentActor = await client.query<{
          role: string;
          status: string;
        }>("SELECT role, status FROM users WHERE id = $1 FOR UPDATE", [
          actor.id,
        ]);
        if (
          currentActor.rows[0]?.status !== "active" ||
          currentActor.rows[0]?.role !== "admin"
        ) {
          throw new MonthlyFinancialRouteError(
            403,
            "MONTHLY_BANK_REVIEW_PERMISSION_CHANGED",
            "当前账号权限已变化，复核结果未写入，请重新登录后再试",
          );
        }
        const reportRow = await loadReportRow(month, client, true);
        if (!reportRow) {
          throw badRequest(
            "MONTHLY_FINANCE_REPORT_NOT_FOUND",
            "月度报表不存在",
          );
        }
        if (reportRow.version !== expectedVersion) {
          throw new Error("月度报表版本已变化，请刷新后重试");
        }
        if (reportRow.status === "closed") {
          throw conflict(
            "MONTHLY_FINANCE_REPORT_CLOSED",
            "已月结报表不能复核银行交易，请先重新开启",
          );
        }
        const transactionResult = await client.query<{
          id: string;
          current_file_id: string;
          recognition_status: string;
          include_in_report: boolean;
        }>(
          `SELECT bank_transaction.id, bank_transaction.current_file_id,
                  bank_transaction.recognition_status,
                  bank_transaction.include_in_report
           FROM monthly_financial_bank_transactions bank_transaction
           JOIN monthly_financial_bank_files bank_file
             ON bank_file.id = bank_transaction.current_file_id
           WHERE bank_transaction.id = $1
             AND bank_transaction.report_month = $2
             AND bank_transaction.is_current = TRUE
             AND bank_file.is_active = TRUE
           FOR UPDATE OF bank_transaction, bank_file`,
          [req.params.transactionId, month],
        );
        const transaction = transactionResult.rows[0];
        if (!transaction) {
          throw badRequest(
            "MONTHLY_BANK_TRANSACTION_NOT_FOUND",
            "待复核银行交易不存在或已被替换",
          );
        }
        if (
          transaction.recognition_status !== "review_required" ||
          transaction.include_in_report
        ) {
          throw conflict(
            "MONTHLY_BANK_TRANSACTION_NOT_REVIEWABLE",
            "该银行交易当前不处于可排除的待复核状态",
          );
        }

        const now = new Date().toISOString();
        const laterRows = await client.query<ReportRow>(
          `SELECT * FROM monthly_financial_reports
           WHERE report_month > $1 ORDER BY report_month FOR UPDATE`,
          [month],
        );
        affectedMonths = await invalidateClosedReportRows({
          client,
          rows: laterRows.rows,
          sourceMonth: month,
          actor,
          now,
          reason: "复核排除月度银行交易",
        });
        await client.query(
          `UPDATE monthly_financial_bank_transactions
           SET category = 'ignored', recognition_status = 'ignored',
               include_in_report = FALSE,
               warnings_json = warnings_json || jsonb_build_array($2::text),
               updated_at = $3
           WHERE id = $1`,
          [transaction.id, `管理员复核排除：${reason}`, now],
        );
        await client.query(
          `UPDATE monthly_financial_bank_transaction_links
           SET match_status = 'dismissed', is_active = FALSE,
               warnings_json = warnings_json || jsonb_build_array($2::text),
               updated_at = $3
           WHERE transaction_id = $1
             AND business_object_type <> 'monthly_bank_file'
             AND is_active = TRUE`,
          [transaction.id, `管理员复核排除：${reason}`, now],
        );
        await client.query(
          `UPDATE monthly_financial_bank_files bank_file
           SET recognition_status = CASE
                 WHEN EXISTS (
                   SELECT 1 FROM monthly_financial_bank_transactions other
                   WHERE other.current_file_id = bank_file.id
                     AND other.is_current = TRUE
                     AND other.recognition_status = 'review_required'
                 ) THEN 'partial'
                 ELSE 'recognized'
               END,
               included_receipt_count = (
                 SELECT COUNT(*)::int
                 FROM monthly_financial_bank_transactions current_transaction
                 WHERE current_transaction.current_file_id = bank_file.id
                   AND current_transaction.is_current = TRUE
                   AND current_transaction.include_in_report = TRUE
               ),
               warnings_json = CASE
                 WHEN EXISTS (
                   SELECT 1 FROM monthly_financial_bank_transactions other
                   WHERE other.current_file_id = bank_file.id
                     AND other.is_current = TRUE
                     AND other.recognition_status = 'review_required'
                 ) THEN bank_file.warnings_json
                 ELSE COALESCE((
                   SELECT jsonb_agg(warning.value)
                   FROM jsonb_array_elements_text(bank_file.warnings_json)
                     AS warning(value)
                   WHERE warning.value <>
                     '关联的合同财务凭证已冲正，文件已转为待复核'
                 ), '[]'::jsonb) ||
                   jsonb_build_array('管理员已复核排除冲正交易')
               END,
               updated_at = $2
           WHERE bank_file.id = $1`,
          [transaction.current_file_id, now],
        );
        const automatic = await loadAutomaticSnapshot(month, client);
        const nextVersion = reportRow.version + 1;
        await client.query(
          `UPDATE monthly_financial_reports
           SET automatic_snapshot_json = $2::jsonb, last_refreshed_at = $3,
               version = $4, updated_by = $5, updated_at = $3
           WHERE id = $1`,
          [reportRow.id, JSON.stringify(automatic), now, nextVersion, actor.id],
        );
        await client.query(
          `INSERT INTO monthly_financial_audit_logs(
             id, report_id, report_version, action, actor_id, actor_role,
             reason, changes_json, created_at
           ) VALUES($1,$2,$3,'refresh',$4,$5,$6,$7::jsonb,$8)`,
          [
            `mfal_${nanoid(16)}`,
            reportRow.id,
            nextVersion,
            actor.id,
            actor.role,
            reason,
            JSON.stringify({
              source: "monthly_bank_transaction_review",
              action,
              transactionId: transaction.id,
              invalidatedMonths: affectedMonths,
            }),
            now,
          ],
        );
      });

      const loaded = await loadMonthlyReport(month, actor.role);
      res.json({
        success: true,
        data: {
          report: loaded.report,
          bankStatements: await loadMonthlyBankState(month),
          duplicateFiles: [],
          affectedMonths,
        },
        message: "待复核银行交易已排除，月报已重新计算",
      });
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.post(
  "/:month/bank-receipts",
  requireRole(WRITE_ROLES),
  receiveMonthlyBankFiles,
  async (req, res) => {
    const files = (
      Array.isArray(req.files) ? req.files : []
    ) as Express.Multer.File[];
    const candidates: MonthlyBankUploadCandidate[] = [];
    const outputDirsByFilePath = new Map<string, string>();
    const submittedFileHashes = new Set<string>();
    let remainingPageBudget = 200;
    const duplicateFiles: Array<{
      originalName: string;
      existingFileId: string;
    }> = [];
    let committed = false;
    try {
      const month = assertFinancialMonth(req.params.month);
      const actor = getActor(req);
      const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
      const mixedMonthConfirmed =
        String(req.body?.mixedMonthConfirmed || "").toLowerCase() === "true";
      if (!files.length) {
        throw badRequest(
          "MONTHLY_BANK_FILES_REQUIRED",
          "请至少选择一份基本、一般或商务账户银行回单",
        );
      }

      for (const file of files) {
        file.originalname = normalizeUploadFileName(file.originalname);
        await assertMonthlyBankPdfHeader(file.path);
        const fileHash = await calculateMonthlyBankFileHash(file.path);
        if (submittedFileHashes.has(fileHash)) {
          duplicateFiles.push({
            originalName: file.originalname,
            existingFileId: "",
          });
          await cleanupMonthlyBankUpload(file.path);
          continue;
        }
        submittedFileHashes.add(fileHash);
        const existing = await queryOne<{ id: string }>(
          `SELECT id FROM monthly_financial_bank_files
           WHERE report_month = ? AND file_hash = ?`,
          [month, fileHash],
        );
        if (existing) {
          duplicateFiles.push({
            originalName: file.originalname,
            existingFileId: existing.id,
          });
          await cleanupMonthlyBankUpload(file.path);
          continue;
        }

        const candidateId = `mfbf_${nanoid(16)}`;
        const outputDir = path.join(MONTHLY_BANK_RECOGNIZED_ROOT, candidateId);
        outputDirsByFilePath.set(file.path, outputDir);
        const analysis = await analyzeMonthlyFinancialBankFile({
          filePath: file.path,
          originalName: file.originalname,
          reportMonth: month,
          outputDir,
          maxPageCount: remainingPageBudget,
        });
        remainingPageBudget -= analysis.pageCount;
        if (!analysis.accountCode) {
          throw badRequest(
            "MONTHLY_BANK_ACCOUNT_NOT_RECOGNIZED",
            `${file.originalname}虽可能包含系统账号，但未能唯一确定所属的基本、一般或商务账户，未写入月报`,
          );
        }
        if (
          analysis.transactionMonths.length === 1 &&
          analysis.transactionMonths[0] !== month
        ) {
          throw badRequest(
            "MONTHLY_BANK_REPORT_MONTH_MISMATCH",
            `${file.originalname}的银行交易日期归属${analysis.transactionMonths[0]}，与当前报表${month}不一致`,
          );
        }
        if (analysis.transactionMonths.length > 1 && !mixedMonthConfirmed) {
          throw conflict(
            "MONTHLY_BANK_MIXED_MONTH_CONFIRMATION_REQUIRED",
            `${file.originalname}包含${analysis.transactionMonths.join("、")}多个交易月份，请管理员确认后重新提交`,
          );
        }
        if (analysis.transactionMonths.length > 1 && mixedMonthConfirmed) {
          const excludedCount = analysis.transactions.filter(
            (transaction) => transaction.transactionMonth !== month,
          ).length;
          analysis.transactions = analysis.transactions.filter(
            (transaction) => transaction.transactionMonth === month,
          );
          if (!analysis.transactions.length) {
            throw badRequest(
              "MONTHLY_BANK_REPORT_MONTH_MISMATCH",
              `${file.originalname}不包含交易日期属于当前报表${month}的回单，不能入账`,
            );
          }
          analysis.warnings.push(
            `管理员已确认跨月文件；仅交易日期属于${month}的回单进入本月，其他月份${excludedCount}张回单不生成本月交易事实，请切换到对应月份重新上传并确认`,
          );
        }
        const blockingWarnings = analysis.warnings.filter((warning) =>
          /识别失败|未识别到有效回单文本|页面转换失败|页转换失败|超过两张回单|未成功拆分|同一文件电子回单号.*不一致/u.test(
            warning,
          ),
        );
        const reviewTransactions = analysis.transactions.filter(
          (transaction) =>
            transaction.recognitionStatus === "review_required" &&
            !(
              analysis.accountCode === "general" &&
              transaction.category === "unclassified" &&
              Boolean(transaction.normalizedElectronicReceiptNo) &&
              Boolean(transaction.transactionDate) &&
              transaction.amount > 0 &&
              ["inflow", "outflow"].includes(transaction.direction) &&
              Boolean(transaction.payerAccount) &&
              Boolean(transaction.payeeAccount)
            ),
        );
        if (blockingWarnings.length || reviewTransactions.length) {
          throw badRequest(
            "MONTHLY_BANK_REVIEW_REQUIRED",
            `${file.originalname}识别不完整，未替换当前月报文件：${[
              ...blockingWarnings,
              ...reviewTransactions.flatMap(
                (transaction) => transaction.warnings,
              ),
            ]
              .slice(0, 3)
              .join("；")}`,
          );
        }
        const incomingPath = file.path;
        const stableSourcePath = path.join(outputDir, "source.pdf");
        await fs.promises.rename(incomingPath, stableSourcePath);
        outputDirsByFilePath.delete(incomingPath);
        outputDirsByFilePath.set(stableSourcePath, outputDir);
        file.path = stableSourcePath;
        candidates.push({
          id: candidateId,
          file,
          outputDir,
          analysis,
        });
      }

      const duplicateOnly = candidates.length === 0;
      const accountCodes = candidates.map(
        (candidate) => candidate.analysis.accountCode!,
      );
      if (new Set(accountCodes).size !== accountCodes.length) {
        throw badRequest(
          "MONTHLY_BANK_ACCOUNT_FILE_DUPLICATED",
          "本次上传识别出重复账户文件，请每个账户只保留一份完整回单",
        );
      }

      const {
        affectedMonths,
        contractReconciliation,
        reimbursementReconciliation,
        salaryReconciliation,
      } = await persistMonthlyBankAnalyses({
        month,
        expectedVersion,
        actor,
        candidates,
      });
      committed = true;
      const loaded = await loadMonthlyReport(month, actor.role);
      res.json({
        success: true,
        data: {
          report: loaded.report,
          bankStatements: await loadMonthlyBankState(month),
          duplicateFiles,
          affectedMonths,
          contractReconciliation,
          reimbursementReconciliation,
          salaryReconciliation,
        },
        message: duplicateOnly
          ? contractReconciliation.some(
              (result) => result.changed && result.status === "matched",
            ) ||
            reimbursementReconciliation.matchedGroups.length ||
            salaryReconciliation.some(
              (result) =>
                result.changed &&
                (result.status === "attached" || result.status === "replaced"),
            )
            ? "文件已存在，已重新匹配并挂载业务回单"
            : "文件已存在，未发现新的可唯一关联业务回单"
          : duplicateFiles.length
            ? "新回单已更新，重复文件已跳过"
            : "银行回单已识别并更新月度财务报表",
      });
    } catch (error) {
      const commitOutcomeUncertain = Boolean(
        error &&
        typeof error === "object" &&
        "commitOutcomeUncertain" in error &&
        (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
      );
      if (committed || commitOutcomeUncertain) {
        console.error("银行回单已提交，但响应刷新失败:", error);
        res.status(500).json({
          success: false,
          code: "MONTHLY_BANK_UPLOAD_COMMITTED_REFRESH_REQUIRED",
          message:
            "银行回单提交结果暂时无法确认；已保留原件，请先重新加载回单状态，不要重复上传",
        });
        return;
      }
      if (!committed) {
        await Promise.all(
          files.map((file) => {
            return cleanupMonthlyBankUpload(
              file.path,
              outputDirsByFilePath.get(file.path),
            );
          }),
        );
      }
      sendFailure(res, error);
    }
  },
);

router.get("/trend", requireRole(READ_ROLES), async (req, res) => {
  try {
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    try {
      listMonthlyFinancialTrendMonths(from, to);
    } catch (error) {
      throw badRequest(
        "MONTHLY_FINANCE_TREND_RANGE_INVALID",
        error instanceof Error ? error.message : "趋势查询月份范围不正确",
      );
    }

    const actor = getActor(req);
    const [reportMonths, yearRows] = await Promise.all([
      queryAll<{ report_month: string }>(
        `SELECT report_month
         FROM monthly_financial_reports
         WHERE report_month >= ? AND report_month <= ?
         ORDER BY report_month`,
        [from, to],
      ),
      queryAll<{ year: number }>(
        `SELECT DISTINCT LEFT(report_month, 4)::int AS year
         FROM monthly_financial_reports
         ORDER BY year`,
        [],
      ),
    ]);

    const reports: MonthlyFinancialTrendReportInput[] = [];
    const concurrency = 8;
    for (let offset = 0; offset < reportMonths.length; offset += concurrency) {
      const loadedReports = await Promise.all(
        reportMonths.slice(offset, offset + concurrency).map(async (row) => {
          const loaded = await loadMonthlyReport(row.report_month, actor.role);
          return loaded.report;
        }),
      );
      reports.push(
        ...loadedReports.map((report) => ({
          month: report.month,
          status: report.status,
          accounts: report.accounts,
          income: { mainReceipt: report.income.mainReceipt },
          validations: report.validations,
        })),
      );
    }

    res.json({
      success: true,
      data: buildMonthlyFinancialTrendData({
        from,
        to,
        availableYears: yearRows.map((row) => Number(row.year)),
        reports,
      }),
    });
  } catch (error) {
    sendFailure(res, error);
  }
});

router.get("/:month", requireRole(READ_ROLES), async (req, res) => {
  try {
    const actor = getActor(req);
    const loaded = await loadMonthlyReport(req.params.month, actor.role);
    res.json({ success: true, data: loaded.report });
  } catch (error) {
    sendFailure(res, error);
  }
});

router.put(
  "/:month/manual-items",
  requireRole(WRITE_ROLES),
  async (req, res) => {
    try {
      const month = assertFinancialMonth(req.params.month);
      const actor = getActor(req);
      const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
      const items = validateManualItems(req.body?.items, month);
      const requestedOpening =
        req.body?.openingBalances === undefined
          ? null
          : normalizeOpeningBalances(req.body.openingBalances);
      let affectedMonths: string[] = [];

      await db.transaction(async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
        await lockFinancialMonth(client, month);
        const row = await loadReportRow(month, client, true);
        if ((row?.version || 0) !== expectedVersion) {
          throw new Error("月度报表版本已变化，请刷新后重试");
        }
        if (row?.status === "closed")
          throw new Error("已月结报表不能直接修改，请先重新开启");
        const previous = await loadPreviousContext(month, row, client);
        let openingBalances: FinancialAccountAmounts;
        if (previous.previousMonthClosed) {
          openingBalances = previous.openingBalances;
        } else if (previous.isFirstMonth) {
          if (!requestedOpening) {
            throw badRequest(
              "MONTHLY_FINANCE_OPENING_BALANCES_REQUIRED",
              "首月必须完整填写四个账户期初余额",
            );
          }
          openingBalances = requestedOpening;
        } else if (row) {
          openingBalances = asOpeningBalances(
            row.opening_balances_json,
            `${month}期初余额`,
          );
        } else {
          openingBalances = previous.openingBalances;
        }
        const automatic = row
          ? asAutomaticSnapshot(row.automatic_snapshot_json)
          : await loadAutomaticSnapshot(month, client);
        if (!automatic) {
          throw dataIntegrity(`${month}自动数据快照不完整，请先执行重新同步`);
        }
        const now = new Date().toISOString();
        const reportId = row?.id || `mfr_${nanoid(16)}`;
        const laterRows = await client.query<ReportRow>(
          `SELECT * FROM monthly_financial_reports
           WHERE report_month > $1
           ORDER BY report_month
           FOR UPDATE`,
          [month],
        );
        affectedMonths = await invalidateClosedReportRows({
          client,
          rows: laterRows.rows,
          sourceMonth: month,
          actor,
          now,
          reason: row ? "维护历史月份" : "补建历史月份",
        });
        const nextVersion = row ? row.version + 1 : 1;
        if (row) {
          await client.query(
            `UPDATE monthly_financial_reports
           SET opening_balances_json = $2::jsonb,
               automatic_snapshot_json = $3::jsonb,
               last_refreshed_at = COALESCE(last_refreshed_at, $4),
               version = $5, updated_by = $6, updated_at = $4
           WHERE id = $1`,
            [
              row.id,
              JSON.stringify(openingBalances),
              JSON.stringify(automatic),
              now,
              nextVersion,
              actor.id,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO monthly_financial_reports(
             id, report_month, status, version, opening_balances_json,
             automatic_snapshot_json, last_refreshed_at,
             created_by, updated_by, created_at, updated_at
           ) VALUES($1, $2, 'draft', 1, $3::jsonb, $4::jsonb, $5, $6, $6, $5, $5)`,
            [
              reportId,
              month,
              JSON.stringify(openingBalances),
              JSON.stringify(automatic),
              now,
              actor.id,
            ],
          );
        }
        const persistedReportId = row?.id || reportId;
        const beforeItems = await loadManualItems(row?.id || null, client);
        const beforeIds = new Set(beforeItems.map((item) => item.id));
        for (const item of items) {
          if (item.id && !beforeIds.has(item.id)) {
            throw badRequest(
              "MONTHLY_FINANCE_MANUAL_ITEM_NOT_FOUND",
              `手工项目${item.id}不存在或不属于当前月份`,
            );
          }
        }
        const persistedItems = items.map((item) => ({
          ...item,
          id: item.id || `mfmi_${nanoid(16)}`,
        }));
        const persistedIds = new Set(persistedItems.map((item) => item.id));
        for (const oldItem of beforeItems) {
          if (!persistedIds.has(oldItem.id!)) {
            await client.query(
              `DELETE FROM monthly_financial_manual_items
               WHERE report_id = $1 AND id = $2`,
              [persistedReportId, oldItem.id],
            );
          }
        }
        for (const item of persistedItems) {
          if (beforeIds.has(item.id)) {
            await client.query(
              `UPDATE monthly_financial_manual_items
               SET category = $3, account_code = $4, direction = $5,
                   amount = $6::numeric, occurred_on = $7, description = $8,
                   voucher_reference = $9, updated_at = $10
               WHERE report_id = $1 AND id = $2`,
              [
                persistedReportId,
                item.id,
                item.category,
                item.accountCode,
                item.direction,
                item.amount,
                item.occurredOn,
                item.description,
                item.voucherReference,
                now,
              ],
            );
          } else {
            await client.query(
              `INSERT INTO monthly_financial_manual_items(
               id, report_id, category, account_code, direction, amount,
               occurred_on, description, voucher_reference, created_by, created_at, updated_at
             ) VALUES($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11, $11)`,
              [
                item.id,
                persistedReportId,
                item.category,
                item.accountCode,
                item.direction,
                item.amount,
                item.occurredOn,
                item.description,
                item.voucherReference,
                actor.id,
                now,
              ],
            );
          }
        }
        await client.query(
          `INSERT INTO monthly_financial_audit_logs(
           id, report_id, report_version, action, actor_id, actor_role, changes_json, created_at
         ) VALUES($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            `mfal_${nanoid(16)}`,
            persistedReportId,
            nextVersion,
            row ? "save_manual_items" : "create",
            actor.id,
            actor.role,
            JSON.stringify({
              openingBalances,
              manualItemChanges: summarizeManualItemChanges(
                beforeItems,
                persistedItems,
              ),
              invalidatedMonths: affectedMonths,
            }),
            now,
          ],
        );
      });

      const loaded = await loadMonthlyReport(month, actor.role);
      res.json({
        success: true,
        data: loaded.report,
        affectedMonths,
        message: "月度财务报表已保存",
      });
    } catch (error) {
      sendFailure(res, error);
    }
  },
);

router.post("/:month/refresh", requireRole(WRITE_ROLES), async (req, res) => {
  try {
    const month = assertFinancialMonth(req.params.month);
    const actor = getActor(req);
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    let affectedMonths: string[] = [];
    let reimbursementReconciliation: MonthlyReimbursementReconciliationResult =
      {
        links: [],
        matchedGroups: [],
        pendingTransactions: [],
        replacedEvidence: [],
      };
    let contractReconciliation: MonthlyContractReceiptReconciliationResult[] =
      [];
    let salaryReconciliation: MonthlySalaryReceiptReconciliationResult[] = [];
    let bankAccountingFlagsNormalized = false;
    await db.transaction(async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      await lockFinancialMonth(client, month);
      const row = await loadReportRow(month, client, true);
      if ((row?.version || 0) !== expectedVersion)
        throw new Error("月度报表版本已变化，请刷新后重试");
      if (row?.status === "closed")
        throw new Error("已月结报表不能刷新，请先重新开启");
      const previous = await loadPreviousContext(month, row, client);
      const now = new Date().toISOString();
      contractReconciliation = await reconcileMonthlyContractBankTransactions(
        client,
        month,
        actor.id,
        now,
        actor.role,
      );
      salaryReconciliation = await reconcileMonthlySalaryReceiptMonth(
        client,
        month,
        actor.id,
        now,
      );
      reimbursementReconciliation =
        await reconcileMonthlyReimbursementTransactions(client, {
          reportMonth: month,
          actorId: actor.id,
          now,
        });
      bankAccountingFlagsNormalized = await normalizeMonthlyBankAccountingFlags(
        client,
        month,
        now,
      );
      const automatic = await loadAutomaticSnapshot(month, client);
      const reportId = row?.id || `mfr_${nanoid(16)}`;
      const laterRows = await client.query<ReportRow>(
        `SELECT * FROM monthly_financial_reports
         WHERE report_month > $1
         ORDER BY report_month
         FOR UPDATE`,
        [month],
      );
      affectedMonths = await invalidateClosedReportRows({
        client,
        rows: laterRows.rows,
        sourceMonth: month,
        actor,
        now,
        reason: row ? "同步历史月份" : "补建历史月份",
      });
      const nextVersion = row ? row.version + 1 : 1;
      if (row) {
        await client.query(
          `UPDATE monthly_financial_reports
           SET automatic_snapshot_json = $2::jsonb, last_refreshed_at = $3,
               version = $4, updated_by = $5, updated_at = $3
           WHERE id = $1`,
          [row.id, JSON.stringify(automatic), now, nextVersion, actor.id],
        );
      } else {
        await client.query(
          `INSERT INTO monthly_financial_reports(
             id, report_month, status, version, opening_balances_json,
             automatic_snapshot_json, last_refreshed_at,
             created_by, updated_by, created_at, updated_at
           ) VALUES($1, $2, 'draft', 1, $3::jsonb, $4::jsonb, $5, $6, $6, $5, $5)`,
          [
            reportId,
            month,
            JSON.stringify(previous.openingBalances),
            JSON.stringify(automatic),
            now,
            actor.id,
          ],
        );
      }
      await client.query(
        `INSERT INTO monthly_financial_audit_logs(
           id, report_id, report_version, action, actor_id, actor_role, changes_json, created_at
         ) VALUES($1, $2, $3, 'refresh', $4, $5, $6::jsonb, $7)`,
        [
          `mfal_${nanoid(16)}`,
          row?.id || reportId,
          nextVersion,
          actor.id,
          actor.role,
          JSON.stringify({
            sourceCount: automatic.sources.length,
            contractReconciliation,
            reimbursementReconciliation,
            salaryReconciliation,
            bankAccountingFlagsNormalized,
            invalidatedMonths: affectedMonths,
          }),
          now,
        ],
      );
    });
    const loaded = await loadMonthlyReport(month, actor.role);
    res.json({
      success: true,
      data: loaded.report,
      affectedMonths,
      contractReconciliation,
      reimbursementReconciliation,
      salaryReconciliation,
      bankAccountingFlagsNormalized,
      message: "自动数据已同步",
    });
  } catch (error) {
    sendFailure(res, error);
  }
});

router.post("/:month/close", requireRole(WRITE_ROLES), async (req, res) => {
  try {
    const month = assertFinancialMonth(req.params.month);
    const actor = getActor(req);
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    await db.transaction(async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      await lockFinancialMonth(client, previousFinancialMonth(month));
      await lockFinancialMonth(client, month);
      const current = await loadReportRow(month, client, true);
      if (!current) {
        throw badRequest(
          "MONTHLY_FINANCE_REPORT_NOT_PERSISTED",
          "请先保存或同步本月报表后再月结",
        );
      }
      if (current.version !== expectedVersion)
        throw new Error("月度报表版本已变化，请刷新后重试");
      if (current.status === "closed") throw new Error("本月报表已经月结");

      const previous = await loadPreviousContext(month, current, client);
      if (!previous.isFirstMonth && !previous.previousMonthClosed) {
        throw conflict(
          "MONTHLY_FINANCE_PREVIOUS_MONTH_NOT_CLOSED",
          "上月尚未月结，不能执行本月月结",
        );
      }
      const automatic = await loadAutomaticSnapshot(month, client);
      if (
        (automatic.bank?.partialAccounts || []).length > 0 ||
        Number(automatic.bank?.reviewRequiredCount || 0) > 0
      ) {
        throw badRequest(
          "MONTHLY_BANK_REVIEW_REQUIRED",
          "银行回单仍有未完成识别或待复核交易，请处理后再月结",
        );
      }
      const manualItems = await loadManualItems(current.id, client);
      const now = new Date().toISOString();
      const internal = buildMonthlyFinancialReportView({
        id: current.id,
        month,
        status: current.status,
        version: current.version,
        openingBalances: previous.openingBalances,
        automatic,
        manualItems,
        lastRefreshedAt: now,
        closedAt: null,
        updatedAt: current.updated_at,
        canMaintain: true,
      });
      const hasNegativeBalance = internal.accounts.some((account) =>
        isNegativeFinancialAmount(account.closingBalance),
      );
      if (hasNegativeBalance && req.body?.negativeBalanceConfirmed !== true) {
        throw badRequest(
          "MONTHLY_FINANCE_NEGATIVE_BALANCE_CONFIRMATION_REQUIRED",
          "存在负数期末余额，请确认后再月结",
        );
      }
      const nextVersion = current.version + 1;
      const closingBalances = Object.fromEntries(
        internal.accounts.map((account) => [
          account.code,
          account.closingBalance,
        ]),
      ) as FinancialAccountAmounts;
      const reportRowForSnapshot: ReportRow = {
        ...current,
        status: "closed",
        version: nextVersion,
        closed_at: now,
        closed_by_name: actor.name,
        last_refreshed_at: now,
        updated_at: now,
        closing_balances_json: closingBalances,
        automatic_snapshot_json: automatic,
        opening_balances_json: previous.openingBalances,
      };
      const closedInternal = {
        ...internal,
        status: "closed" as const,
        version: nextVersion,
        closedAt: now,
        updatedAt: now,
      };
      const clientSnapshot = toClientReport({
        internal: closedInternal,
        automatic,
        previous,
        reportRow: reportRowForSnapshot,
        role: actor.role,
      });
      const storedSnapshot = {
        ...clientSnapshot,
        __internal: closedInternal,
        __automatic: automatic,
      };

      await client.query(
        `UPDATE monthly_financial_reports
         SET status = 'closed', version = $2, opening_balances_json = $3::jsonb,
             automatic_snapshot_json = $4::jsonb, closing_balances_json = $5::jsonb,
             last_refreshed_at = $6, closed_at = $6, closed_by = $7,
             updated_by = $7, updated_at = $6
         WHERE id = $1`,
        [
          current.id,
          nextVersion,
          JSON.stringify(previous.openingBalances),
          JSON.stringify(automatic),
          JSON.stringify(closingBalances),
          now,
          actor.id,
        ],
      );
      await client.query(
        `INSERT INTO monthly_financial_snapshots(
           id, report_id, report_version, formula_version, snapshot_json, created_by, created_at
         ) VALUES($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          `mfs_${nanoid(16)}`,
          current.id,
          nextVersion,
          FORMULA_VERSION,
          JSON.stringify(storedSnapshot),
          actor.id,
          now,
        ],
      );
      await client.query(
        `INSERT INTO monthly_financial_audit_logs(
           id, report_id, report_version, action, actor_id, actor_role, reason, changes_json, created_at
         ) VALUES($1, $2, $3, 'close', $4, $5, $6, $7::jsonb, $8)`,
        [
          `mfal_${nanoid(16)}`,
          current.id,
          nextVersion,
          actor.id,
          actor.role,
          String(req.body?.note || "").trim() || null,
          JSON.stringify({ closingBalances, formulaVersion: FORMULA_VERSION }),
          now,
        ],
      );
    });
    const loaded = await loadMonthlyReport(month, actor.role);
    res.json({ success: true, data: loaded.report, message: "月结完成" });
  } catch (error) {
    sendFailure(res, error);
  }
});

router.post("/:month/reopen", requireRole(WRITE_ROLES), async (req, res) => {
  try {
    const month = assertFinancialMonth(req.params.month);
    const actor = getActor(req);
    const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
    const reason = String(req.body?.reason || "").trim();
    if (!reason) throw new Error("重新开启必须填写原因");
    if (reason.length > 500) throw new Error("重新开启原因不能超过500字");
    const now = new Date().toISOString();
    let affectedMonths: string[] = [];
    await db.transaction(async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      await lockFinancialMonth(client, month);
      const locked = await client.query<ReportRow>(
        `SELECT * FROM monthly_financial_reports
         WHERE report_month >= $1
         ORDER BY report_month
         FOR UPDATE`,
        [month],
      );
      const target = locked.rows.find((row) => row.report_month === month);
      if (!target) {
        throw badRequest("MONTHLY_FINANCE_REPORT_NOT_FOUND", "月度报表不存在");
      }
      if (target.version !== expectedVersion)
        throw new Error("月度报表版本已变化，请刷新后重试");
      if (target.status !== "closed")
        throw new Error("只有已月结报表可以重新开启");
      const rowsToInvalidate = locked.rows.filter(
        (row) => row.status === "closed",
      );
      affectedMonths = rowsToInvalidate.map((row) => row.report_month);
      for (const row of rowsToInvalidate) {
        const nextVersion = row.version + 1;
        const isTarget = row.report_month === month;
        const rowReason = isTarget
          ? reason
          : `因${month}历史月重新开启，后续承接链需重新核算：${reason}`;
        await client.query(
          `UPDATE monthly_financial_reports
           SET status = 'reopened', version = $2,
               closing_balances_json = NULL, closed_at = NULL, closed_by = NULL,
               reopened_at = $3, reopened_by = $4, reopen_reason = $5,
               updated_by = $4, updated_at = $3
           WHERE id = $1`,
          [row.id, nextVersion, now, actor.id, rowReason],
        );
        await client.query(
          `INSERT INTO monthly_financial_audit_logs(
             id, report_id, report_version, action, actor_id, actor_role, reason, changes_json, created_at
           ) VALUES($1, $2, $3, 'reopen', $4, $5, $6, $7::jsonb, $8)`,
          [
            `mfal_${nanoid(16)}`,
            row.id,
            nextVersion,
            actor.id,
            actor.role,
            rowReason,
            JSON.stringify({
              previousClosedVersion: row.version,
              invalidatedByMonth: month,
              cascaded: !isTarget,
              preservedSnapshotVersion: row.version,
            }),
            now,
          ],
        );
      }
    });
    const loaded = await loadMonthlyReport(month, actor.role);
    res.json({
      success: true,
      data: loaded.report,
      affectedMonths,
      message:
        affectedMonths.length > 1
          ? `月报已重新开启，${affectedMonths.slice(1).join("、")}已标记为待重新核算`
          : "月报已重新开启",
    });
  } catch (error) {
    sendFailure(res, error);
  }
});

router.get("/:month/export", requireRole(READ_ROLES), async (req, res) => {
  try {
    const month = assertFinancialMonth(req.params.month);
    const actor = getActor(req);
    const loaded = await loadMonthlyReport(month, actor.role);
    const buffer = await buildMonthlyFinancialWorkbook(
      loaded.report,
      loaded.automatic,
    );
    const fileName = `月度财务报表-${month}.xlsx`;
    const downloadedReportId = loaded.internal.id;
    const downloadedVersion = loaded.report.version;
    if (downloadedReportId) {
      await pool.query(
        `INSERT INTO monthly_financial_audit_logs(
           id, report_id, report_version, action, actor_id, actor_role, changes_json, created_at
         ) VALUES($1, $2, $3, 'export', $4, $5, '{}'::jsonb, $6)`,
        [
          `mfal_${nanoid(16)}`,
          downloadedReportId,
          downloadedVersion,
          actor.id,
          actor.role,
          new Date().toISOString(),
        ],
      );
    }
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="monthly-financial-report-${month}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.send(buffer);
  } catch (error) {
    sendFailure(res, error);
  }
});

export default router;
