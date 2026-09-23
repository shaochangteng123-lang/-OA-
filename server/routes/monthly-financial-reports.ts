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
import { requireAuth, requireExactRole } from "../middleware/auth.js";
import {
  MONTHLY_FINANCIAL_MAINTAIN_ROLES,
  MONTHLY_FINANCIAL_READ_ROLES,
  canMaintainMonthlyFinancialReport,
  canReadMonthlyFinancialReport,
} from "../utils/monthly-financial-permissions.js";
import { normalizeUploadFileName } from "../utils/upload-file-name.js";
import {
  calculateMainBusinessIncome,
  type ContractRateBasisPoints,
} from "../services/contractAccounting.js";
import {
  calculatePayrollBreakdown,
  calculatePayrollTotals,
  formatPayrollAmount,
  type PayrollAmountField,
} from "../services/payrollCalculator.js";
import {
  MANUAL_CATEGORY_RULES,
  FIXED_WELFARE_ONE_EXPENSE_CATEGORIES,
  FIXED_WELFARE_TWO_EXPENSE_CATEGORIES,
  addFinancialAmounts,
  assertFinancialMonth,
  buildMonthlyFinancialReportView,
  centsToFinancialAmount,
  emptyAccountAmounts,
  isNegativeFinancialAmount,
  isValidFinancialAnalysisMetadata,
  mergeOpenMonthlyFinancialWelfareCatalogs,
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
import { loadMonthlyFinancialAnalysis } from "../services/monthlyFinancialAnalysis.js";
import {
  prepareProjectReceiptPreview,
  ProjectReceiptPreviewError,
} from "../services/monthlyFinancialProjectReceiptPreview.js";
import {
  buildFinancialReimbursementScopeMap,
  unknownFinancialReimbursementScope,
  type FinancialReimbursementScopeNode,
} from "../services/monthlyFinancialReimbursementScope.js";
import {
  protectMonthlyFinancialAnalysis,
  protectMonthlyFinancialPayrollMetadata,
} from "../services/monthlyFinancialAnalysisPermissions.js";
import {
  parseMonthlyFinancialAnalysisModule,
  parseMonthlyFinancialAnalysisQuery,
  parseMonthlyFinancialAnalysisVersion,
} from "../services/monthlyFinancialAnalysisQuery.js";
import {
  buildMonthlyFinancialAnalysisWorkbook,
  monthlyFinancialAnalysisVersion,
} from "../services/monthlyFinancialAnalysisWorkbook.js";
import type { FinancialAnalysisQuery } from "../types/monthly-financial-analysis.js";
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
import { cleanupMonthlyContractBridgeGroupFiles } from "../services/monthlyFinancialContractBridge.js";
import {
  reconcileMonthlyReimbursementTransactions,
  type MonthlyReimbursementReconciliationResult,
} from "../services/monthlyFinancialReimbursementMatcher.js";
import {
  reconcileMonthlySalaryReceiptMonth,
  type MonthlySalaryReceiptReconciliationResult,
} from "../services/monthlyFinancialSalaryReceiptMatcher.js";
import {
  createMonthlyBankContentCorrectionChallengeToken,
  fingerprintMonthlyBankContentCorrections,
  hashMonthlyBankContentCorrectionSession,
  verifyMonthlyBankContentCorrectionChallengeToken,
} from "../services/monthlyFinancialBankContentCorrection.js";
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
const READ_ROLES = [...MONTHLY_FINANCIAL_READ_ROLES];
const WRITE_ROLES = [...MONTHLY_FINANCIAL_MAINTAIN_ROLES];
const requireMonthlyReadRole = requireExactRole(READ_ROLES);
const requireMonthlyWriteRole = requireExactRole(WRITE_ROLES);
const FORMULA_VERSION = "monthly-finance-v6-dual-welfare-reimbursement-categories";
const MONTHLY_BANK_RECOGNITION_VERSION =
  "monthly-bank-parser-v6-party-coordinate-binding";
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
    readonly details?: unknown,
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

function conflictWithDetails(
  code: string,
  message: string,
  details: unknown,
): MonthlyFinancialRouteError {
  return new MonthlyFinancialRouteError(409, code, message, details);
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
    welfareCategoryId: item.welfareCategoryId || null,
    welfareCategoryNameSnapshot: item.welfareCategoryNameSnapshot || null,
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
  generatedAt: string;
  savedAt: string | null;
  closedAt: string | null;
  accounts: Array<{
    code: FinancialAccountCode;
    name: string;
    opening: string;
    inflow: string;
    outflow: string;
    closing: string;
  }>;
  income: {
    mainReceipt: string;
    generalInterest: string;
    [key: string]: string;
  };
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
    sourceType?: "manual" | "monthly_bank_transaction" | "reimbursement";
    readOnly?: boolean;
    effective?: boolean;
    previewUrl?: string | null;
    welfareCategoryId?: string | null;
    welfareCategoryNameSnapshot?: string | null;
  }>;
  welfareOneExpenseCategories: MonthlyFinancialReportView["welfareOneExpenseCategories"];
  welfareTwoExpenseCategories: MonthlyFinancialReportView["welfareTwoExpenseCategories"];
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
    for (const welfareCategories of [
      snapshot.welfareOneExpenseCategories,
      snapshot.welfareTwoExpenseCategories,
    ]) {
      if (
        welfareCategories !== undefined &&
        (!Array.isArray(welfareCategories) ||
          !welfareCategories.every((category) => {
          if (
            !category ||
            typeof category.id !== "string" ||
            !category.id.trim() ||
            typeof category.code !== "string" ||
            !category.code.trim() ||
            typeof category.name !== "string" ||
            !category.name.trim() ||
            !Number.isInteger(category.sortOrder) ||
            category.sortOrder < 0 ||
            typeof category.isActive !== "boolean"
          ) {
            return false;
          }
          normalizeFinancialAmount(category.amount);
          return true;
          }))
      ) {
        return null;
      }
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
      if (
        !isValidFinancialAnalysisMetadata(
          detail.analysis,
          detail.sourceType,
          detail.amount,
        )
      )
        return false;
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
    welfareCategoryRows,
    welfareTwoCategoryRows,
  ] = await resolveMonthlyQueryBatch(
    [
      () =>
        queryAll<{
          id: string;
          receipt_date: string;
          amount: string;
          rate_snapshot_json: unknown;
          title: string | null;
          root_id: string | null;
          party_a: string | null;
          region: string | null;
          updated_at: string;
        }>(
          `SELECT receipt.id, receipt.receipt_date, receipt.amount::text AS amount,
              receipt.rate_snapshot_json, COALESCE(root.title, contract.title) AS title,
              receipt.updated_at, root.id AS root_id, root.party_a, root.area AS region
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
          withheld_actual_amount: string | null;
          net_salary_actual_amount: string | null;
          updated_at: string;
        }>(
          `SELECT payroll.id, employee.id AS employee_id, employee.name AS employee_name,
              payroll.monthly_salary::text AS monthly_salary,
              payroll.housing_fund_base::text AS housing_fund_base,
              payroll.contribution_base::text AS contribution_base,
              payroll.individual_income_tax::text AS individual_income_tax,
              payroll.withheld_actual_amount::text AS withheld_actual_amount,
              payroll.net_salary_actual_amount::text AS net_salary_actual_amount,
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
          type: "basic" | "large" | "business" | "welfare_one" | "welfare_two";
          title: string;
          applicant_name: string;
          total_amount: string;
          occurred_at: string;
          updated_at: string;
          category: string | null;
          reimbursement_scope: string | null;
          scope_label: string | null;
          scope_name_count: number;
          service_target: string | null;
          employee_id: string | null;
          welfare_category_id: string | null;
          welfare_category_name_snapshot: string | null;
          welfare_two_category_id: string | null;
          welfare_two_category_name_snapshot: string | null;
        }>(
          `SELECT reimbursement.id, reimbursement.user_id, reimbursement.type,
              reimbursement.title, reimbursement.applicant_name, reimbursement.total_amount::text AS total_amount,
              reimbursement.payment_business_date::text AS occurred_at, reimbursement.updated_at,
              reimbursement.category, reimbursement.reimbursement_scope, reimbursement.service_target,
              reimbursement.welfare_category_id,
              reimbursement.welfare_category_name_snapshot,
              reimbursement.welfare_two_category_id,
              reimbursement.welfare_two_category_name_snapshot,
              scope.name AS scope_label, scope.name_count AS scope_name_count,
              employee.id AS employee_id
       FROM reimbursements reimbursement
       LEFT JOIN employee_profiles employee ON employee.user_id = reimbursement.user_id
       LEFT JOIN LATERAL (
         SELECT CASE WHEN COUNT(DISTINCT name) = 1 THEN MIN(name) ELSE NULL END AS name,
                COUNT(DISTINCT name)::int AS name_count
         FROM reimbursement_scopes
         WHERE value = reimbursement.reimbursement_scope
       ) scope ON TRUE
       WHERE reimbursement.status IN ('paid', 'payment_uploaded', 'completed')
         AND reimbursement.is_deleted = FALSE
         AND reimbursement.payment_business_date >= ?::date
         AND reimbursement.payment_business_date < (?::date + INTERVAL '1 month')
       ORDER BY occurred_at, reimbursement.id`,
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
      () =>
        queryAll<{
          id: string;
          code: string;
          name: string;
          sort_order: number;
          is_active: boolean;
        }>(
          `SELECT id, code, name, sort_order, is_active
             FROM welfare_one_expense_categories
            ORDER BY sort_order, id`,
          [],
          client,
        ),
      () =>
        queryAll<{
          id: string;
          code: string;
          name: string;
          sort_order: number;
          is_active: boolean;
        }>(
          `SELECT id, code, name, sort_order, is_active
             FROM welfare_two_expense_categories
            ORDER BY sort_order, id`,
          [],
          client,
        ),
    ] as const,
    Boolean(client),
  );

  if (
    new Set(reimbursementRows.map((row) => row.id)).size !==
    reimbursementRows.length
  ) {
    throw dataIntegrity("报销自动来源出现重复编号，已阻止重复计算金额");
  }
  // 独立读取维度表后按来源值唯一解析，绝不把一笔报销连接成多个行政区而重复累计。
  const scopeNodes = reimbursementRows.length
    ? await queryAll<FinancialReimbursementScopeNode>(
        `SELECT id, parent_id AS "parentId", name, value
           FROM reimbursement_scopes ORDER BY sort_order, id`,
        [],
        client,
      )
    : [];
  const reimbursementScopes = buildFinancialReimbursementScopeMap(scopeNodes);
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
        analysis: {
          schemaVersion: 1,
          contractRootId: row.root_id || null,
          partyA: row.party_a || null,
          contractRegion: row.region || null,
        },
      });
    }
  }

  const payrollCalculatedRows = payrollRows.map((row) => {
    const breakdown = calculatePayrollBreakdown(
      row.monthly_salary,
      row.housing_fund_base,
      row.contribution_base,
      row.individual_income_tax,
    );
    return {
      monthly_salary: row.monthly_salary,
      housing_fund_base: row.housing_fund_base,
      contribution_base: row.contribution_base,
      individual_income_tax: row.individual_income_tax,
      ...breakdown,
      withheld_actual_amount: formatPayrollAmount(
        row.withheld_actual_amount ?? breakdown.withheld_total,
      ),
      net_salary_actual_amount: formatPayrollAmount(
        row.net_salary_actual_amount ?? breakdown.net_salary,
      ),
    };
  }) as Array<Record<PayrollAmountField, string>>;
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
      analysis: {
        schemaVersion: 1,
        canonicalPersonId: row.employee_id,
        payrollParts: {
          salary: normalizeFinancialAmount(row.monthly_salary),
          social: normalizeFinancialAmount(
            payrollCalculatedRows[index].company_social_total,
          ),
          housing: normalizeFinancialAmount(
            payrollCalculatedRows[index].company_housing_fund,
          ),
          adjustment: subtractFinancialAmounts(
            cost,
            row.monthly_salary,
            payrollCalculatedRows[index].company_social_total,
            payrollCalculatedRows[index].company_housing_fund,
          ),
        },
      },
    });
  });

  const reimbursementTotals = { basic: "0", large: "0", business: "0" };
  const welfareCategoryById = new Map(
    welfareCategoryRows.map((row) => [row.id, row]),
  );
  const welfareCategoryAmounts = new Map<string, string>();
  const missingWelfareCategories = new Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      sort_order: number;
      is_active: boolean;
    }
  >();
  const welfareTwoCategoryById = new Map(
    welfareTwoCategoryRows.map((row) => [row.id, row]),
  );
  const welfareTwoCategoryAmounts = new Map<string, string>();
  const missingWelfareTwoCategories = new Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      sort_order: number;
      is_active: boolean;
    }
  >();
  for (const row of reimbursementRows) {
    const normalizedAmount = normalizeFinancialAmount(row.total_amount);
    if (row.type === "welfare_one") {
      const categoryId = row.welfare_category_id || "welfare_one_unknown";
      const category = welfareCategoryById.get(categoryId) || {
        id: categoryId,
        code: `legacy_${categoryId}`,
        name:
          row.welfare_category_name_snapshot?.trim() || "历史福利分类",
        sort_order: Number.MAX_SAFE_INTEGER,
        is_active: false,
      };
      if (!welfareCategoryById.has(categoryId)) {
        missingWelfareCategories.set(categoryId, category);
      }
      welfareCategoryAmounts.set(
        categoryId,
        addFinancialAmounts(
          welfareCategoryAmounts.get(categoryId) || "0",
          normalizedAmount,
        ),
      );
      details.push({
        sourceType: "reimbursement",
        sourceId: row.id,
        occurredOn: row.occurred_at.slice(0, 10),
        accountCode: "welfare_one",
        metric: "welfare_one_expense",
        amount: normalizedAmount,
        description: row.title,
        personId: row.user_id,
        personName: row.applicant_name,
        analysis: {
          schemaVersion: 1,
          canonicalPersonId: row.employee_id || `user:${row.user_id}`,
          reimbursementCategory: row.category || null,
          reimbursementServiceTarget: row.service_target || null,
          welfareCategoryId: category.id,
          welfareCategoryCode: category.code,
          welfareCategoryName:
            row.welfare_category_name_snapshot?.trim() || category.name,
        },
      });
      continue;
    }
    if (row.type === "welfare_two") {
      const categoryId = row.welfare_two_category_id || "welfare_two_unknown";
      const category = welfareTwoCategoryById.get(categoryId) || {
        id: categoryId,
        code: `legacy_${categoryId}`,
        name:
          row.welfare_two_category_name_snapshot?.trim() || "历史福利分类",
        sort_order: Number.MAX_SAFE_INTEGER,
        is_active: false,
      };
      if (!welfareTwoCategoryById.has(categoryId)) {
        missingWelfareTwoCategories.set(categoryId, category);
      }
      welfareTwoCategoryAmounts.set(
        categoryId,
        addFinancialAmounts(
          welfareTwoCategoryAmounts.get(categoryId) || "0",
          normalizedAmount,
        ),
      );
      details.push({
        sourceType: "reimbursement",
        sourceId: row.id,
        occurredOn: row.occurred_at.slice(0, 10),
        accountCode: "welfare_two",
        metric: "welfare_two_expense",
        amount: normalizedAmount,
        description: row.title,
        personId: row.user_id,
        personName: row.applicant_name,
        analysis: {
          schemaVersion: 1,
          canonicalPersonId: row.employee_id || `user:${row.user_id}`,
          reimbursementCategory: row.category || null,
          reimbursementServiceTarget: row.service_target || null,
          welfareCategoryId: category.id,
          welfareCategoryCode: category.code,
          welfareCategoryName:
            row.welfare_two_category_name_snapshot?.trim() || category.name,
        },
      });
      continue;
    }
    const scope =
      reimbursementScopes.get(row.reimbursement_scope || "") ||
      unknownFinancialReimbursementScope(row.reimbursement_scope);
    reimbursementTotals[row.type] = addFinancialAmounts(
      reimbursementTotals[row.type],
      normalizedAmount,
    );
    details.push({
      sourceType: "reimbursement",
      sourceId: row.id,
      occurredOn: row.occurred_at.slice(0, 10),
      accountCode: row.type === "business" ? "business" : "general",
      metric: `${row.type}_reimbursement`,
      amount: normalizedAmount,
      description: row.title,
      personId: row.user_id,
      personName: row.applicant_name,
      analysis: {
        schemaVersion: 1,
        canonicalPersonId: row.employee_id || `user:${row.user_id}`,
        reimbursementCategory: row.category || null,
        reimbursementScope: scope.path || row.reimbursement_scope || null,
        reimbursementScopeValue: row.reimbursement_scope || null,
        reimbursementScopePath: scope.path,
        reimbursementRegion: scope.region,
        reimbursementRegionSource: `生成自动来源快照时核对；${scope.source}`,
        reimbursementServiceTarget: row.service_target || null,
      },
    });
  }
  const welfareOneExpenseCategories = [
    ...welfareCategoryRows,
    ...missingWelfareCategories.values(),
  ].map((category) => ({
    id: category.id,
    code: category.code,
    name: category.name,
    sortOrder: category.sort_order,
    isActive: category.is_active,
    amount: welfareCategoryAmounts.get(category.id) || "0",
  }));
  const welfareOneReimbursement = addFinancialAmounts(
    ...welfareOneExpenseCategories.map((category) => category.amount),
  );
  const welfareTwoExpenseCategories = [
    ...welfareTwoCategoryRows,
    ...missingWelfareTwoCategories.values(),
  ].map((category) => ({
    id: category.id,
    code: category.code,
    name: category.name,
    sortOrder: category.sort_order,
    isActive: category.is_active,
    amount: welfareTwoCategoryAmounts.get(category.id) || "0",
  }));
  const welfareTwoReimbursement = addFinancialAmounts(
    ...welfareTwoExpenseCategories.map((category) => category.amount),
  );

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
    welfareOneReimbursement,
    welfareTwoReimbursement,
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
    welfareOneExpenseCategories,
    welfareTwoExpenseCategories,
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
          ? "统计金额以系统内已支付报销为准，银行回单仅作付款凭证" +
            (reimbursementRows.some((row) => row.scope_name_count > 1)
              ? "；部分报销范围名称冲突，已冻结原范围值，金额未重复计算"
              : "") +
            (reimbursementRows.some(
              (row) =>
                row.type === "business" &&
                !reimbursementScopes.get(row.reimbursement_scope || "")?.region,
            )
              ? "；部分商务报销范围父级行政区无法唯一核对，已冻结未知归属而非猜测"
              : "")
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
    welfare_category_id: string | null;
    welfare_category_name_snapshot: string | null;
    welfare_two_category_id: string | null;
    welfare_two_category_name_snapshot: string | null;
  }>(
    `SELECT id, category, account_code, direction, amount::text AS amount,
            occurred_on, description, voucher_reference,
            welfare_category_id, welfare_category_name_snapshot,
            welfare_two_category_id, welfare_two_category_name_snapshot
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
    welfareCategoryId:
      row.category === "welfare_two_expense"
        ? row.welfare_two_category_id
        : row.welfare_category_id,
    welfareCategoryNameSnapshot:
      row.category === "welfare_two_expense"
        ? row.welfare_two_category_name_snapshot
        : row.welfare_category_name_snapshot,
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
      categoryLabel:
        item.category === "welfare_one_expense" ||
        item.category === "welfare_two_expense"
          ? item.welfareCategoryNameSnapshot || MANUAL_CATEGORY_RULES[item.category].label
          : MANUAL_CATEGORY_RULES[item.category].label,
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
  const welfareReimbursementRows: ClientMonthlyReport["manualItems"] =
    automatic.details
      .filter(
        (detail) =>
          detail.sourceType === "reimbursement" &&
          detail.accountCode === "welfare_one" &&
          detail.metric === "welfare_one_expense" &&
          Boolean(detail.analysis?.welfareCategoryId),
      )
      .map((detail) => ({
        id: `reimbursement:${detail.sourceId}`,
        category: "welfare_one_expense",
        categoryLabel:
          detail.analysis?.welfareCategoryName || "福利账户一分类支出",
        accountCode: "welfare_one",
        direction: "expense",
        occurredOn: detail.occurredOn,
        amount: detail.amount,
        description: detail.description,
        voucherReference: detail.sourceId,
        sourceType: "reimbursement" as const,
        readOnly: true,
        effective: true,
        previewUrl: null,
        welfareCategoryId: detail.analysis?.welfareCategoryId || null,
        welfareCategoryNameSnapshot:
          detail.analysis?.welfareCategoryName || null,
      }));
  const welfareTwoReimbursementRows: ClientMonthlyReport["manualItems"] =
    automatic.details
      .filter(
        (detail) =>
          detail.sourceType === "reimbursement" &&
          detail.accountCode === "welfare_two" &&
          detail.metric === "welfare_two_expense" &&
          Boolean(detail.analysis?.welfareCategoryId),
      )
      .map((detail) => ({
        id: `reimbursement:${detail.sourceId}`,
        category: "welfare_two_expense",
        categoryLabel:
          detail.analysis?.welfareCategoryName || "福利账户二分类支出",
        accountCode: "welfare_two",
        direction: "expense",
        occurredOn: detail.occurredOn,
        amount: detail.amount,
        description: detail.description,
        voucherReference: detail.sourceId,
        sourceType: "reimbursement" as const,
        readOnly: true,
        effective: true,
        previewUrl: null,
        welfareCategoryId: detail.analysis?.welfareCategoryId || null,
        welfareCategoryNameSnapshot:
          detail.analysis?.welfareCategoryName || null,
      }));
  return [
    ...manualRows,
    ...bankRows,
    ...welfareReimbursementRows,
    ...welfareTwoReimbursementRows,
  ];
}

function legacyClosedWelfareOneCategories(
  internal: MonthlyFinancialReportView,
): MonthlyFinancialReportView["welfareOneExpenseCategories"] {
  const amounts: Record<string, string> = {
    drinking_water: internal.expenses.welfareOneDrinkingWater || "0",
    office: addFinancialAmounts(
      internal.expenses.welfareOneOffice || "0",
      internal.expenses.welfareOne407 || "0",
    ),
    electricity: internal.expenses.welfareOneElectricity || "0",
    "407_ai": internal.expenses.welfareOne407Ai || "0",
    "8h_ai": internal.expenses.welfareOne8hAi || "0",
  };
  return FIXED_WELFARE_ONE_EXPENSE_CATEGORIES.map((category) => ({
    ...category,
    isActive: true,
    automaticAmount: "0",
    manualAmount: amounts[category.code] || "0",
    totalAmount: amounts[category.code] || "0",
    isFixed: true,
  }));
}

function legacyClosedWelfareTwoCategories(
  internal: MonthlyFinancialReportView,
): MonthlyFinancialReportView["welfareTwoExpenseCategories"] {
  const amounts: Record<string, string> = {
    refreshment: internal.expenses.welfareTwoRefreshment || "0",
    team_building: internal.expenses.welfareTwoTeamBuilding || "0",
    physical_exam: internal.expenses.welfareTwoHealthCheck || "0",
  };
  return FIXED_WELFARE_TWO_EXPENSE_CATEGORIES.map((category) => ({
    ...category,
    isActive: true,
    automaticAmount: "0",
    manualAmount: amounts[category.code] || "0",
    totalAmount: amounts[category.code] || "0",
    isFixed: true,
  }));
}

function toClientReport(input: {
  internal: MonthlyFinancialReportView;
  automatic: MonthlyFinancialAutomaticSnapshot;
  previous: PreviousReportContext;
  reportRow: ReportRow | null;
  role: string;
}): ClientMonthlyReport {
  const { internal, automatic, previous, reportRow, role } = input;
  const canMaintain = canMaintainMonthlyFinancialReport(role);
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
      generalTaxPayment: internal.expenses.generalTaxPayment,
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
    automaticDetails: protectMonthlyFinancialPayrollMetadata(
      automatic.details,
      role,
    ),
    bank: automatic.bank,
    totals: {
      opening,
      income: incomeTotal,
      expense: expenseTotal,
      closing,
      netChange: subtractFinancialAmounts(closing, opening),
    },
    manualItems: buildClientManualItems(internal, automatic),
    welfareOneExpenseCategories: internal.welfareOneExpenseCategories,
    welfareTwoExpenseCategories: internal.welfareTwoExpenseCategories,
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
  client?: QueryClient,
): Promise<LoadedMonthlyReport> {
  assertFinancialMonth(month);
  const reportRow = await loadReportRow(month, client);
  const previous = await loadPreviousContext(month, reportRow, client);

  if (reportRow?.status === "closed") {
    const snapshot = await queryOne<{ snapshot_json: Record<string, unknown> }>(
      `SELECT snapshot_json FROM monthly_financial_snapshots
       WHERE report_id = ? AND report_version = ?`,
      [reportRow.id, reportRow.version],
      client,
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
        automaticDetails: protectMonthlyFinancialPayrollMetadata(
          validatedAutomatic.details,
          role,
        ),
        manualItems: buildClientManualItems(__internal, validatedAutomatic),
        welfareOneExpenseCategories: Array.isArray(
          publicSnapshot.welfareOneExpenseCategories,
        )
          ? publicSnapshot.welfareOneExpenseCategories
          : legacyClosedWelfareOneCategories(__internal),
        welfareTwoExpenseCategories: Array.isArray(
          publicSnapshot.welfareTwoExpenseCategories,
        )
          ? publicSnapshot.welfareTwoExpenseCategories
          : legacyClosedWelfareTwoCategories(__internal),
        validations: {
          ...publicSnapshot.validations,
          canClose: false,
        },
        permissions: {
          canEdit: false,
          canRefresh: false,
          canSubmitReview: false,
          canClose: false,
          canReopen: canMaintainMonthlyFinancialReport(role),
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
  let baseAutomatic: MonthlyFinancialAutomaticSnapshot =
    !forceAutomatic && storedAutomatic
      ? storedAutomatic
      : await loadAutomaticSnapshot(month, client);
  if (!forceAutomatic && reportRow && storedAutomatic) {
    // 开放月报的金额仍冻结在已保存自动快照中，但分类名称、顺序和启停状态应立即反映主数据。
    const [welfareOneCatalog, welfareTwoCatalog] = await Promise.all([
      queryAll<{
        id: string;
        code: string;
        name: string;
        sort_order: number;
        is_active: boolean;
      }>(
        `SELECT id, code, name, sort_order, is_active
           FROM welfare_one_expense_categories ORDER BY sort_order, id`,
        [],
        client,
      ),
      queryAll<{
        id: string;
        code: string;
        name: string;
        sort_order: number;
        is_active: boolean;
      }>(
        `SELECT id, code, name, sort_order, is_active
           FROM welfare_two_expense_categories ORDER BY sort_order, id`,
        [],
        client,
      ),
    ]);
    baseAutomatic = mergeOpenMonthlyFinancialWelfareCatalogs(
      reportRow.status,
      baseAutomatic,
      welfareOneCatalog,
      welfareTwoCatalog,
    );
  }
  const liveBankValidation = reportRow
    ? await loadMonthlyBankValidationState(month, client)
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
  const manualItems = await loadManualItems(reportRow?.id || null, client);
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
    canMaintain: canMaintainMonthlyFinancialReport(role),
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

type MonthlyBankCorrectionDifference =
  | "transactionDate"
  | "amount"
  | "payerAccount"
  | "payeeAccount";

interface MonthlyBankCorrectionExistingRow {
  id: string;
  report_month: string;
  account_code: MonthlyBankAccountCode;
  electronic_receipt_no: string | null;
  normalized_electronic_receipt_no: string;
  transaction_date: string | null;
  amount: string | null;
  direction: string | null;
  payer_account: string | null;
  payee_account: string | null;
  current_file_id: string;
  current_file_version: number;
  original_name: string | null;
  recognition_version: string | null;
  has_business_links: boolean;
}

interface MonthlyBankContentCorrectionAuditEntry {
  transactionId: string;
  normalizedReceiptNo: string;
  receiptNo: string;
  differenceDigest: string;
  differences: MonthlyBankCorrectionDifference[];
  previous: {
    reportMonth: string;
    accountCode: MonthlyBankAccountCode;
    transactionDate: string | null;
    amount: string;
    direction: string | null;
    payerAccount: string;
    payeeAccount: string;
    currentFileId: string;
    currentFileVersion: number;
    originalName: string | null;
    recognitionVersion: string;
  };
  incoming: {
    reportMonth: string;
    accountCode: MonthlyBankAccountCode;
    transactionDate: string;
    amount: string;
    direction: string;
    payerAccount: string;
    payeeAccount: string;
    candidateFileId: string;
    candidateFileHash: string;
    originalName: string;
    pageNo: number;
    position: string;
    recognitionVersion: string;
  };
}

interface MonthlyBankContentCorrectionPublicConflict {
  transactionId: string;
  receiptNo: string;
  normalizedReceiptNo: string;
  differenceDigest: string;
  accountCode: MonthlyBankAccountCode;
  accountName: string;
  differences: MonthlyBankCorrectionDifference[];
  correctable: boolean;
  blockingReason: string | null;
  previous: {
    fileName: string | null;
    fileVersion: number;
    transactionDate: string | null;
    amount: string;
    payerAccount: string;
    payeeAccount: string;
  };
  incoming: {
    fileName: string;
    pageNo: number;
    position: string;
    transactionDate: string;
    amount: string;
    payerAccount: string;
    payeeAccount: string;
  };
}

interface MonthlyBankContentCorrectionState {
  auditEntries: MonthlyBankContentCorrectionAuditEntry[];
  publicConflicts: MonthlyBankContentCorrectionPublicConflict[];
  fingerprint: string;
  allCorrectable: boolean;
}

function stableMonthlyBankContentCorrectionEntry(
  entry:
    | MonthlyBankContentCorrectionAuditEntry
    | Omit<MonthlyBankContentCorrectionAuditEntry, "differenceDigest">,
) {
  const stableIncoming = {
    reportMonth: entry.incoming.reportMonth,
    accountCode: entry.incoming.accountCode,
    transactionDate: entry.incoming.transactionDate,
    amount: entry.incoming.amount,
    direction: entry.incoming.direction,
    payerAccount: entry.incoming.payerAccount,
    payeeAccount: entry.incoming.payeeAccount,
    candidateFileHash: entry.incoming.candidateFileHash,
    originalName: entry.incoming.originalName,
    pageNo: entry.incoming.pageNo,
    position: entry.incoming.position,
    recognitionVersion: entry.incoming.recognitionVersion,
  };
  return {
    transactionId: entry.transactionId,
    normalizedReceiptNo: entry.normalizedReceiptNo,
    receiptNo: entry.receiptNo,
    differences: entry.differences,
    previous: entry.previous,
    incoming: stableIncoming,
  };
}

interface MonthlyBankContentCorrectionAcknowledgement {
  transactionId: string;
  normalizedReceiptNo: string;
  differenceDigest: string;
}

interface MonthlyBankContentCorrectionConfirmation {
  reviewId: string;
  token: string;
  batchDigest: string;
  reason: string;
  acknowledgements: MonthlyBankContentCorrectionAcknowledgement[];
}

interface MonthlyBankContentCorrectionReviewResponse {
  reviewId: string;
  expectedVersion: number;
  batchDigest: string;
  confirmationToken: string;
  expiresAt: string;
  requiredFiles: Array<{
    originalName: string;
    fileHash: string;
    accountCode: MonthlyBankAccountCode;
  }>;
  conflicts: MonthlyBankContentCorrectionPublicConflict[];
}

interface MonthlyBankContentCorrectionReviewRow {
  id: string;
  report_id: string;
  report_month: string;
  expected_report_version: number;
  status: "pending" | "confirmed" | "expired" | "cancelled";
  requested_by: string;
  requested_role: string;
  session_binding_hash: string;
  token_hash: string;
  batch_digest: string;
  file_hashes_json: string[];
  parser_version: string;
  analysis_digest: string;
  conflict_fingerprint: string;
  conflicts_json: MonthlyBankContentCorrectionAuditEntry[];
  expires_at: string;
}

function monthlyBankCorrectionSecret(): string {
  return `${process.env.SESSION_SECRET || "development-only-session-secret"}:monthly-bank-content-correction`;
}

function monthlyBankCorrectionAmount(value: unknown): string {
  return (financialAmountToCents(value) / 100).toFixed(2);
}

function redactMonthlyBankCorrectionAccount(value: unknown): string {
  const account = normalizeMonthlyBankAccount(value);
  if (!account) return "未识别为完整账号";
  if (account.length <= 10) {
    return `${account.slice(0, 4)}…${account.slice(-2)}（${account.length}位片段）`;
  }
  return `${account.slice(0, 4)}…${account.slice(-4)}（${account.length}位）`;
}

function monthlyBankOwnAccountRole(
  accountCode: MonthlyBankAccountCode,
  payerAccount: unknown,
  payeeAccount: unknown,
): "payer" | "payee" | "both" | "none" {
  const ownAccount = MONTHLY_BANK_ACCOUNTS[accountCode].accountNumber;
  const payerMatches = normalizeMonthlyBankAccount(payerAccount) === ownAccount;
  const payeeMatches = normalizeMonthlyBankAccount(payeeAccount) === ownAccount;
  if (payerMatches && payeeMatches) return "both";
  if (payerMatches) return "payer";
  if (payeeMatches) return "payee";
  return "none";
}

async function collectMonthlyBankContentCorrections(
  client: QueryClient,
  candidates: MonthlyBankUploadCandidate[],
): Promise<MonthlyBankContentCorrectionState> {
  const normalizedNumbers = [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.analysis.transactions
          .map((transaction) => transaction.normalizedElectronicReceiptNo)
          .filter(Boolean),
      ),
    ),
  ].sort();
  if (!normalizedNumbers.length) {
    return {
      auditEntries: [],
      publicConflicts: [],
      fingerprint: fingerprintMonthlyBankContentCorrections([]),
      allCorrectable: true,
    };
  }
  const existingRows = await client.query<MonthlyBankCorrectionExistingRow>(
    `SELECT transaction.id, transaction.report_month,
            transaction.account_code, transaction.electronic_receipt_no,
            transaction.normalized_electronic_receipt_no,
            transaction.transaction_date, transaction.amount::text AS amount,
            transaction.direction, transaction.payer_account,
            transaction.payee_account, transaction.current_file_id,
            transaction.current_file_version, file.original_name,
            file.recognition_version,
            EXISTS(
              SELECT 1
              FROM monthly_financial_bank_transaction_links business_link
              WHERE business_link.transaction_id = transaction.id
                AND business_link.is_active = TRUE
                AND business_link.business_object_type <> 'monthly_bank_file'
            ) AS has_business_links
     FROM monthly_financial_bank_transactions transaction
     LEFT JOIN monthly_financial_bank_files file
       ON file.id = transaction.current_file_id
     WHERE transaction.normalized_electronic_receipt_no = ANY($1::text[])
     FOR UPDATE OF transaction`,
    [normalizedNumbers],
  );
  const existingByNumber = new Map(
    existingRows.rows.map((row) => [row.normalized_electronic_receipt_no, row]),
  );
  const auditEntries: MonthlyBankContentCorrectionAuditEntry[] = [];
  const publicConflicts: MonthlyBankContentCorrectionPublicConflict[] = [];

  for (const candidate of candidates) {
    const accountCode = candidate.analysis.accountCode!;
    for (const transaction of candidate.analysis.transactions) {
      const normalizedNo = transaction.normalizedElectronicReceiptNo;
      if (!normalizedNo) continue;
      const existing = existingByNumber.get(normalizedNo);
      const transactionMonth = transaction.transactionMonth;
      if (
        !existing ||
        existing.account_code !== accountCode ||
        existing.report_month !== transactionMonth
      ) {
        continue;
      }
      const differences: MonthlyBankCorrectionDifference[] = [];
      if (existing.transaction_date !== transaction.transactionDate) {
        differences.push("transactionDate");
      }
      if (
        financialAmountToCents(existing.amount || "0") !==
        financialAmountToCents(transaction.amount)
      ) {
        differences.push("amount");
      }
      if (
        normalizeMonthlyBankAccount(existing.payer_account) !==
        normalizeMonthlyBankAccount(transaction.payerAccount)
      ) {
        differences.push("payerAccount");
      }
      if (
        normalizeMonthlyBankAccount(existing.payee_account) !==
        normalizeMonthlyBankAccount(transaction.payeeAccount)
      ) {
        differences.push("payeeAccount");
      }
      if (!differences.length) continue;

      const previousRole = monthlyBankOwnAccountRole(
        accountCode,
        existing.payer_account,
        existing.payee_account,
      );
      const incomingRole = monthlyBankOwnAccountRole(
        accountCode,
        transaction.payerAccount,
        transaction.payeeAccount,
      );
      const blockingReason = existing.has_business_links
        ? "该历史回单已挂载合同、报销或薪资业务，不能在月报上传中直接纠正"
        : previousRole === "none" || incomingRole === "none"
          ? "新旧记录未能在同一收付方确认本公司完整账号"
          : previousRole !== incomingRole ||
              existing.direction !== transaction.direction
            ? "新旧记录的收付方向不一致，需先进行专项财务复核"
            : null;
      const receiptNo =
        transaction.electronicReceiptNo ||
        existing.electronic_receipt_no ||
        normalizedNo;
      const auditEntryWithoutDigest = {
        transactionId: existing.id,
        normalizedReceiptNo: normalizedNo,
        receiptNo,
        differences,
        previous: {
          reportMonth: existing.report_month,
          accountCode: existing.account_code,
          transactionDate: existing.transaction_date,
          amount: monthlyBankCorrectionAmount(existing.amount || "0"),
          direction: existing.direction,
          payerAccount: normalizeMonthlyBankAccount(existing.payer_account),
          payeeAccount: normalizeMonthlyBankAccount(existing.payee_account),
          currentFileId: existing.current_file_id,
          currentFileVersion: existing.current_file_version,
          originalName: existing.original_name,
          recognitionVersion: existing.recognition_version || "legacy-unknown",
        },
        incoming: {
          reportMonth: transactionMonth,
          accountCode,
          transactionDate: transaction.transactionDate,
          amount: monthlyBankCorrectionAmount(transaction.amount),
          direction: transaction.direction,
          payerAccount: normalizeMonthlyBankAccount(transaction.payerAccount),
          payeeAccount: normalizeMonthlyBankAccount(transaction.payeeAccount),
          candidateFileId: candidate.id,
          candidateFileHash: candidate.analysis.fileHash,
          originalName: candidate.file.originalname,
          pageNo: transaction.pageNo,
          position: transaction.position,
          recognitionVersion: MONTHLY_BANK_RECOGNITION_VERSION,
        },
      };
      const auditEntry: MonthlyBankContentCorrectionAuditEntry = {
        ...auditEntryWithoutDigest,
        differenceDigest: fingerprintMonthlyBankContentCorrections([
          stableMonthlyBankContentCorrectionEntry(auditEntryWithoutDigest),
        ]),
      };
      auditEntries.push(auditEntry);
      publicConflicts.push({
        transactionId: existing.id,
        receiptNo,
        normalizedReceiptNo: normalizedNo,
        differenceDigest: auditEntry.differenceDigest,
        accountCode,
        accountName: MONTHLY_BANK_ACCOUNTS[accountCode].label,
        differences,
        correctable: blockingReason === null,
        blockingReason,
        previous: {
          fileName: existing.original_name,
          fileVersion: existing.current_file_version,
          transactionDate: existing.transaction_date,
          amount: auditEntry.previous.amount,
          payerAccount: redactMonthlyBankCorrectionAccount(
            existing.payer_account,
          ),
          payeeAccount: redactMonthlyBankCorrectionAccount(
            existing.payee_account,
          ),
        },
        incoming: {
          fileName: candidate.file.originalname,
          pageNo: transaction.pageNo,
          position: transaction.position,
          transactionDate: transaction.transactionDate,
          amount: auditEntry.incoming.amount,
          payerAccount: redactMonthlyBankCorrectionAccount(
            transaction.payerAccount,
          ),
          payeeAccount: redactMonthlyBankCorrectionAccount(
            transaction.payeeAccount,
          ),
        },
      });
    }
  }

  auditEntries.sort((left, right) =>
    left.normalizedReceiptNo.localeCompare(right.normalizedReceiptNo),
  );
  publicConflicts.sort((left, right) =>
    left.receiptNo.localeCompare(right.receiptNo),
  );
  return {
    auditEntries,
    publicConflicts,
    fingerprint: fingerprintMonthlyBankContentCorrections(
      auditEntries.map(stableMonthlyBankContentCorrectionEntry),
    ),
    allCorrectable: publicConflicts.every((item) => item.correctable),
  };
}

function monthlyBankCorrectionFileHashes(
  candidates: MonthlyBankUploadCandidate[],
): string[] {
  return [...new Set(candidates.map((item) => item.analysis.fileHash))].sort();
}

function monthlyBankCorrectionBatchDigest(
  candidates: MonthlyBankUploadCandidate[],
): string {
  return fingerprintMonthlyBankContentCorrections(
    monthlyBankCorrectionFileHashes(candidates),
  );
}

function monthlyBankCorrectionAnalysisDigest(
  candidates: MonthlyBankUploadCandidate[],
): string {
  const canonical = candidates
    .map((candidate) => ({
      fileHash: candidate.analysis.fileHash,
      accountCode: candidate.analysis.accountCode,
      recognitionVersion: MONTHLY_BANK_RECOGNITION_VERSION,
      pageCount: candidate.analysis.pageCount,
      transactions: candidate.analysis.transactions
        .map((transaction) => ({
          normalizedReceiptNo: transaction.normalizedElectronicReceiptNo,
          transactionDate: transaction.transactionDate,
          transactionMonth: transaction.transactionMonth,
          amountCents: financialAmountToCents(transaction.amount),
          payer: transaction.payer,
          payerAccount: normalizeMonthlyBankAccount(transaction.payerAccount),
          payee: transaction.payee,
          payeeAccount: normalizeMonthlyBankAccount(transaction.payeeAccount),
          direction: transaction.direction,
          category: transaction.category,
          recognitionStatus: transaction.recognitionStatus,
          includeInReport: transaction.includeInReport,
          pageNo: transaction.pageNo,
          position: transaction.position,
          warnings: [...transaction.warnings].sort(),
          rawTextHash: transaction.rawTextHash,
        }))
        .sort((left, right) =>
          `${left.normalizedReceiptNo}:${left.pageNo}:${left.position}`.localeCompare(
            `${right.normalizedReceiptNo}:${right.pageNo}:${right.position}`,
          ),
        ),
    }))
    .sort((left, right) => left.fileHash.localeCompare(right.fileHash));
  return fingerprintMonthlyBankContentCorrections(canonical);
}

function monthlyBankCorrectionAcknowledgementKey(
  item: MonthlyBankContentCorrectionAcknowledgement,
): string {
  return `${item.transactionId}:${item.normalizedReceiptNo}:${item.differenceDigest}`;
}

async function createMonthlyBankContentCorrectionReview(input: {
  client: QueryClient;
  reportId: string;
  month: string;
  expectedVersion: number;
  actor: FinancialActor;
  sessionId: string;
  candidates: MonthlyBankUploadCandidate[];
  correctionState: MonthlyBankContentCorrectionState;
  now: string;
}): Promise<MonthlyBankContentCorrectionReviewResponse> {
  const secret = monthlyBankCorrectionSecret();
  const sessionBindingHash = hashMonthlyBankContentCorrectionSession(
    input.sessionId,
    secret,
  );
  const challenge = createMonthlyBankContentCorrectionChallengeToken(secret);
  const reviewId = `mfbcr_${nanoid(16)}`;
  const expiresAt = new Date(
    Date.parse(input.now) + 30 * 60 * 1000,
  ).toISOString();
  const fileHashes = monthlyBankCorrectionFileHashes(input.candidates);
  const batchDigest = monthlyBankCorrectionBatchDigest(input.candidates);
  const analysisDigest = monthlyBankCorrectionAnalysisDigest(input.candidates);

  await input.client.query(
    `UPDATE monthly_financial_bank_correction_reviews
     SET status = 'expired', updated_at = $1
     WHERE status = 'pending' AND expires_at < $1`,
    [input.now],
  );
  await input.client.query(
    `UPDATE monthly_financial_bank_correction_reviews
     SET status = 'cancelled', updated_at = $1
     WHERE report_month = $2 AND requested_by = $3
       AND session_binding_hash = $4 AND status = 'pending'`,
    [input.now, input.month, input.actor.id, sessionBindingHash],
  );
  await input.client.query(
    `INSERT INTO monthly_financial_bank_correction_reviews(
       id, report_id, report_month, expected_report_version, status,
       requested_by, requested_role, session_binding_hash, token_hash,
       batch_digest, file_hashes_json, parser_version, analysis_digest,
       conflict_fingerprint, conflicts_json, expires_at, created_at, updated_at
     ) VALUES(
       $1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,
       $14::jsonb,$15,$16,$16
     )`,
    [
      reviewId,
      input.reportId,
      input.month,
      input.expectedVersion,
      input.actor.id,
      input.actor.role,
      sessionBindingHash,
      challenge.tokenHash,
      batchDigest,
      JSON.stringify(fileHashes),
      MONTHLY_BANK_RECOGNITION_VERSION,
      analysisDigest,
      input.correctionState.fingerprint,
      JSON.stringify(input.correctionState.auditEntries),
      expiresAt,
      input.now,
    ],
  );
  return {
    reviewId,
    expectedVersion: input.expectedVersion,
    batchDigest,
    confirmationToken: challenge.token,
    expiresAt,
    requiredFiles: input.candidates
      .map((candidate) => ({
        originalName: candidate.file.originalname,
        fileHash: candidate.analysis.fileHash,
        accountCode: candidate.analysis.accountCode!,
      }))
      .sort((left, right) => left.fileHash.localeCompare(right.fileHash)),
    conflicts: input.correctionState.publicConflicts,
  };
}

async function verifyMonthlyBankContentCorrectionReview(input: {
  client: QueryClient;
  reportId: string;
  month: string;
  expectedVersion: number;
  actor: FinancialActor;
  sessionId: string;
  candidates: MonthlyBankUploadCandidate[];
  correctionState: MonthlyBankContentCorrectionState;
  confirmation: MonthlyBankContentCorrectionConfirmation;
  now: string;
}): Promise<MonthlyBankContentCorrectionReviewRow> {
  const reason = input.confirmation.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw badRequest(
      "MONTHLY_BANK_CORRECTION_REASON_REQUIRED",
      "请填写10至500字的历史回单核实原因",
    );
  }
  const reviewResult =
    await input.client.query<MonthlyBankContentCorrectionReviewRow>(
      `SELECT id, report_id, report_month, expected_report_version, status,
            requested_by, requested_role, session_binding_hash, token_hash,
            batch_digest, file_hashes_json, parser_version, analysis_digest,
            conflict_fingerprint, conflicts_json, expires_at
     FROM monthly_financial_bank_correction_reviews
     WHERE id = $1 FOR UPDATE`,
      [input.confirmation.reviewId],
    );
  const review = reviewResult.rows[0];
  if (
    !review ||
    review.report_id !== input.reportId ||
    review.report_month !== input.month
  ) {
    throw new MonthlyFinancialRouteError(
      404,
      "MONTHLY_BANK_CORRECTION_REVIEW_NOT_FOUND",
      "历史回单复核记录不存在，请重新上传并核对",
    );
  }
  if (review.status !== "pending") {
    throw conflict(
      "MONTHLY_BANK_CORRECTION_REVIEW_NOT_PENDING",
      review.status === "confirmed"
        ? "该历史回单复核已经确认，请刷新回单状态"
        : "该历史回单复核已失效，请重新上传并核对",
    );
  }
  if (Date.parse(review.expires_at) < Date.parse(input.now)) {
    throw new MonthlyFinancialRouteError(
      410,
      "MONTHLY_BANK_CORRECTION_REVIEW_EXPIRED",
      "历史回单复核已超过30分钟，请重新上传并核对",
    );
  }
  const secret = monthlyBankCorrectionSecret();
  const sessionBindingHash = hashMonthlyBankContentCorrectionSession(
    input.sessionId,
    secret,
  );
  if (
    review.requested_by !== input.actor.id ||
    review.requested_role !== input.actor.role ||
    review.session_binding_hash !== sessionBindingHash ||
    !verifyMonthlyBankContentCorrectionChallengeToken(
      input.confirmation.token,
      review.token_hash,
      secret,
    )
  ) {
    throw new MonthlyFinancialRouteError(
      403,
      "MONTHLY_BANK_CORRECTION_CONFIRMATION_FORBIDDEN",
      "复核确认人与原上传会话不一致，请由原管理员重新上传并核对",
    );
  }
  const fileHashes = monthlyBankCorrectionFileHashes(input.candidates);
  const expectedAcknowledgements = review.conflicts_json
    .map((item) =>
      monthlyBankCorrectionAcknowledgementKey({
        transactionId: item.transactionId,
        normalizedReceiptNo: item.normalizedReceiptNo,
        differenceDigest: item.differenceDigest,
      }),
    )
    .sort();
  const suppliedAcknowledgements = input.confirmation.acknowledgements
    .map(monthlyBankCorrectionAcknowledgementKey)
    .sort();
  const stateStillMatches =
    review.expected_report_version === input.expectedVersion &&
    review.batch_digest === input.confirmation.batchDigest &&
    review.batch_digest ===
      monthlyBankCorrectionBatchDigest(input.candidates) &&
    JSON.stringify(review.file_hashes_json) === JSON.stringify(fileHashes) &&
    review.parser_version === MONTHLY_BANK_RECOGNITION_VERSION &&
    review.analysis_digest ===
      monthlyBankCorrectionAnalysisDigest(input.candidates) &&
    review.conflict_fingerprint === input.correctionState.fingerprint &&
    JSON.stringify(expectedAcknowledgements) ===
      JSON.stringify(suppliedAcknowledgements);
  if (!stateStillMatches) {
    throw conflict(
      "MONTHLY_BANK_CORRECTION_REVIEW_STALE",
      "原件、识别结果、月报版本或历史记录已经变化，请重新上传并核对差异",
    );
  }
  return review;
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

function transactionCommitOutcomeUncertain(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "commitOutcomeUncertain" in error &&
    (error as { commitOutcomeUncertain?: unknown }).commitOutcomeUncertain,
  );
}

async function cleanupRolledBackContractEvidence(
  results: MonthlyContractReceiptReconciliationResult[],
  error: unknown,
): Promise<void> {
  if (transactionCommitOutcomeUncertain(error)) return;
  await Promise.all(
    results.map((result) => cleanupMonthlyContractBridgeGroupFiles(result)),
  );
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
  sessionId: string;
  candidates: MonthlyBankUploadCandidate[];
  correctionConfirmation?: MonthlyBankContentCorrectionConfirmation;
}): Promise<{
  affectedMonths: string[];
  contractReconciliation: MonthlyContractReceiptReconciliationResult[];
  reimbursementReconciliation: MonthlyReimbursementReconciliationResult;
  salaryReconciliation: MonthlySalaryReceiptReconciliationResult[];
  pendingCorrectionReview: MonthlyBankContentCorrectionReviewResponse | null;
  confirmedCorrection: {
    reviewId: string;
    status: "confirmed";
    correctedTransactionIds: string[];
  } | null;
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
  let pendingCorrectionReview: MonthlyBankContentCorrectionReviewResponse | null =
    null;
  let confirmedCorrectionReview: MonthlyBankContentCorrectionReviewRow | null =
    null;
  let confirmedCorrectionEntries: MonthlyBankContentCorrectionAuditEntry[] = [];
  let confirmedCorrectionResult: {
    reviewId: string;
    status: "confirmed";
    correctedTransactionIds: string[];
  } | null = null;
  const confirmedCorrectionTransactionIds = new Set<string>();
  const persistence = db.transaction(async (client) => {
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
      !canMaintainMonthlyFinancialReport(currentActor.rows[0]?.role) ||
      currentActor.rows[0]?.role !== input.actor.role
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
    const correctionState = await collectMonthlyBankContentCorrections(
      client,
      input.candidates,
    );
    if (correctionState.auditEntries.length) {
      if (!reportRow) {
        throw dataIntegrity("历史银行回单存在，但对应月报记录缺失");
      }
      if (!correctionState.allCorrectable) {
        throw conflictWithDetails(
          "MONTHLY_BANK_RECEIPT_CONTENT_CONFLICT",
          "发现已挂载业务或收付方向变化的历史回单，不能直接换版，请先专项复核",
          { conflicts: correctionState.publicConflicts },
        );
      }
      if (!input.sessionId) {
        throw new MonthlyFinancialRouteError(
          403,
          "MONTHLY_BANK_CORRECTION_SESSION_REQUIRED",
          "当前登录会话无法绑定历史回单复核，请重新登录后再试",
        );
      }
      if (!input.correctionConfirmation) {
        pendingCorrectionReview =
          await createMonthlyBankContentCorrectionReview({
            client,
            reportId,
            month: input.month,
            expectedVersion: input.expectedVersion,
            actor: input.actor,
            sessionId: input.sessionId,
            candidates: input.candidates,
            correctionState,
            now,
          });
        return;
      }
      confirmedCorrectionReview =
        await verifyMonthlyBankContentCorrectionReview({
          client,
          reportId,
          month: input.month,
          expectedVersion: input.expectedVersion,
          actor: input.actor,
          sessionId: input.sessionId,
          candidates: input.candidates,
          correctionState,
          confirmation: input.correctionConfirmation,
          now,
        });
      confirmedCorrectionEntries = correctionState.auditEntries;
      for (const entry of confirmedCorrectionEntries) {
        confirmedCorrectionTransactionIds.add(entry.transactionId);
      }
    } else if (input.correctionConfirmation) {
      throw conflict(
        "MONTHLY_BANK_CORRECTION_REVIEW_STALE",
        "本次重新识别已不存在原复核差异，请重新上传并核对当前结果",
      );
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
           storage_path, mime_type, file_size, file_hash, recognition_version,
           file_version,
           is_active, replaces_file_id, page_count, recognized_receipt_count,
           included_receipt_count, recognition_status, detected_months_json,
           warnings_json, anomalies_json, uploaded_by, activated_at,
           recognized_at, created_at, updated_at
         ) VALUES(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12,$13,$14,$15,$16,
           $17::jsonb,$18::jsonb,$19::jsonb,$20,$21,$21,$21,$21
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
          MONTHLY_BANK_RECOGNITION_VERSION,
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
          if (
            !existingContentMatches &&
            !confirmedCorrectionTransactionIds.has(existing.id)
          ) {
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
    if (confirmedCorrectionReview && input.correctionConfirmation) {
      const correctionAuditId = `mfal_${nanoid(16)}`;
      const correctionReason = input.correctionConfirmation.reason.trim();
      await client.query(
        `INSERT INTO monthly_financial_audit_logs(
           id, report_id, report_version, action, actor_id, actor_role,
           reason, changes_json, created_at
         ) VALUES(
           $1,$2,$3,'bank_receipt_correction',$4,$5,$6,$7::jsonb,$8
         )`,
        [
          correctionAuditId,
          reportId,
          nextVersion,
          input.actor.id,
          input.actor.role,
          correctionReason,
          JSON.stringify({
            reviewId: confirmedCorrectionReview.id,
            batchDigest: confirmedCorrectionReview.batch_digest,
            parserVersion: MONTHLY_BANK_RECOGNITION_VERSION,
            corrections: confirmedCorrectionEntries,
            contractReconciliation,
            reimbursementReconciliation,
            salaryReconciliation,
            invalidatedMonths: affectedMonths,
          }),
          now,
        ],
      );
      await client.query(
        `UPDATE monthly_financial_bank_correction_reviews
         SET status = 'confirmed', reason = $2, confirmed_by = $3,
             confirmed_role = $4, confirmed_at = $5,
             confirmed_report_version = $6, audit_log_id = $7,
             updated_at = $5
         WHERE id = $1 AND status = 'pending'`,
        [
          confirmedCorrectionReview.id,
          correctionReason,
          input.actor.id,
          input.actor.role,
          now,
          nextVersion,
          correctionAuditId,
        ],
      );
      confirmedCorrectionResult = {
        reviewId: confirmedCorrectionReview.id,
        status: "confirmed",
        correctedTransactionIds: confirmedCorrectionEntries.map(
          (entry) => entry.transactionId,
        ),
      };
    }
  });
  try {
    await persistence;
  } catch (error) {
    await cleanupRolledBackContractEvidence(contractReconciliation, error);
    throw error;
  }
  return {
    affectedMonths,
    contractReconciliation,
    reimbursementReconciliation,
    salaryReconciliation,
    pendingCorrectionReview,
    confirmedCorrection: confirmedCorrectionResult,
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
      ...(error.details === undefined ? {} : { data: error.details }),
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
      const canReadMonthlyReport = canReadMonthlyFinancialReport(actor.role);
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
        canMaintainMonthlyFinancialReport(actor.role) ||
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
  requireMonthlyReadRole,
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
  requireMonthlyWriteRole,
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
          !canMaintainMonthlyFinancialReport(currentActor.rows[0]?.role)
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

function parseMonthlyBankCorrectionAcknowledgements(
  value: unknown,
): MonthlyBankContentCorrectionAcknowledgement[] {
  if (value === undefined || value === null || value === "") return [];
  let parsed: unknown;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw badRequest(
      "MONTHLY_BANK_CORRECTION_ACKNOWLEDGEMENTS_INVALID",
      "历史回单差异确认清单格式不正确",
    );
  }
  if (!Array.isArray(parsed)) {
    throw badRequest(
      "MONTHLY_BANK_CORRECTION_ACKNOWLEDGEMENTS_INVALID",
      "历史回单差异确认清单格式不正确",
    );
  }
  const result: MonthlyBankContentCorrectionAcknowledgement[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const candidate = item as Record<string, unknown>;
    const acknowledgement = {
      transactionId: String(candidate?.transactionId || "").trim(),
      normalizedReceiptNo: String(candidate?.normalizedReceiptNo || "").trim(),
      differenceDigest: String(candidate?.differenceDigest || "").trim(),
    };
    if (
      !acknowledgement.transactionId ||
      !acknowledgement.normalizedReceiptNo ||
      !/^[0-9a-f]{64}$/u.test(acknowledgement.differenceDigest)
    ) {
      throw badRequest(
        "MONTHLY_BANK_CORRECTION_ACKNOWLEDGEMENTS_INVALID",
        "历史回单差异确认清单缺少必要字段",
      );
    }
    const key = monthlyBankCorrectionAcknowledgementKey(acknowledgement);
    if (seen.has(key)) {
      throw badRequest(
        "MONTHLY_BANK_CORRECTION_ACKNOWLEDGEMENTS_INVALID",
        "历史回单差异确认清单存在重复项目",
      );
    }
    seen.add(key);
    result.push(acknowledgement);
  }
  return result;
}

async function handleMonthlyBankReceiptUpload(
  req: Request,
  res: Response,
): Promise<void> {
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
    const correctionReviewId = String(req.params.reviewId || "").trim();
    const correctionConfirmation = correctionReviewId
      ? {
          reviewId: correctionReviewId,
          token: String(req.body?.confirmationToken || "").trim(),
          batchDigest: String(req.body?.batchDigest || "").trim(),
          reason: String(req.body?.reason || "").trim(),
          acknowledgements: parseMonthlyBankCorrectionAcknowledgements(
            req.body?.acknowledgements,
          ),
        }
      : undefined;
    if (
      correctionConfirmation &&
      (!correctionConfirmation.token ||
        !/^[0-9a-f]{64}$/u.test(correctionConfirmation.batchDigest) ||
        !correctionConfirmation.acknowledgements.length)
    ) {
      throw badRequest(
        "MONTHLY_BANK_CORRECTION_CONFIRMATION_INVALID",
        "历史回单复核确认信息不完整，请重新上传并核对",
      );
    }
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
           WHERE report_month = ? AND file_hash = ?
             AND recognition_version = ?`,
        [month, fileHash, MONTHLY_BANK_RECOGNITION_VERSION],
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
      pendingCorrectionReview,
      confirmedCorrection,
    } = await persistMonthlyBankAnalyses({
      month,
      expectedVersion,
      actor,
      sessionId: String(req.sessionID || ""),
      candidates,
      correctionConfirmation,
    });
    if (pendingCorrectionReview) {
      throw conflictWithDetails(
        "MONTHLY_BANK_RECEIPT_CONTENT_CONFLICT_CONFIRMATION_REQUIRED",
        `发现${pendingCorrectionReview.conflicts.length}笔历史识别结果与本次原件不一致，请核对差异后确认换版`,
        pendingCorrectionReview,
      );
    }
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
        correctionReview: confirmedCorrection,
      },
      message: confirmedCorrection
        ? "历史识别差异已核实，银行回单已换版并更新月度财务报表"
        : duplicateOnly
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
}

router.post(
  "/:month/bank-receipts",
  requireMonthlyWriteRole,
  receiveMonthlyBankFiles,
  handleMonthlyBankReceiptUpload,
);

router.post(
  "/:month/bank-receipt-corrections/:reviewId/confirm",
  requireMonthlyWriteRole,
  receiveMonthlyBankFiles,
  handleMonthlyBankReceiptUpload,
);

async function readFinancialAnalysis(
  query: FinancialAnalysisQuery,
  actor: { id: string; role: string },
) {
  const client = await pool.connect();
  try {
    // 全部业务来源和月结快照使用同一只读视图，查询不触发同步、建账或凭证关联。
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const current = await client.query<{ role: string; status: string }>(
      "SELECT role, status FROM users WHERE id = $1",
      [actor.id],
    );
    if (
      current.rows[0]?.status !== "active" ||
      !canReadMonthlyFinancialReport(current.rows[0]?.role)
    ) {
      throw new MonthlyFinancialRouteError(
        403,
        "MONTHLY_FINANCE_ANALYSIS_FORBIDDEN",
        "当前账号无权读取财务分析",
      );
    }
    const data = await loadMonthlyFinancialAnalysis(query, {
      queryClient: client,
      loadReport: async (month, reportClient) => {
        const loaded = await loadMonthlyReport(
          month,
          current.rows[0].role,
          true,
          reportClient,
        );
        return {
          ...loaded.report,
          automaticDetails: loaded.automatic.details,
          analysisLive: loaded.report.status !== "closed",
        };
      },
    });
    await client.query("COMMIT");
    const visibleData = protectMonthlyFinancialAnalysis(
      data,
      current.rows[0].role,
    );
    return {
      ...visibleData,
      dataVersion: monthlyFinancialAnalysisVersion(visibleData),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function analysisQuery(req: Request): FinancialAnalysisQuery {
  try {
    return parseMonthlyFinancialAnalysisQuery(req.query);
  } catch (error) {
    throw badRequest(
      "MONTHLY_FINANCE_ANALYSIS_QUERY_INVALID",
      error instanceof Error ? error.message : "财务分析筛选条件无效",
    );
  }
}

router.get("/analysis/export", requireMonthlyReadRole, async (req, res) => {
  try {
    const query = analysisQuery(req);
    let moduleKey;
    let requestedVersion;
    try {
      moduleKey = parseMonthlyFinancialAnalysisModule(req.query.module);
      requestedVersion = parseMonthlyFinancialAnalysisVersion(
        req.query.dataVersion,
      );
    } catch (error) {
      throw badRequest(
        "MONTHLY_FINANCE_ANALYSIS_EXPORT_INVALID",
        error instanceof Error ? error.message : "导出条件无效",
      );
    }
    const data = await readFinancialAnalysis(query, getActor(req));
    if (requestedVersion && requestedVersion !== data.dataVersion) {
      throw conflict(
        "MONTHLY_FINANCE_ANALYSIS_CHANGED",
        "分析数据已更新，请先刷新页面再导出，避免页面与文件金额不一致",
      );
    }
    const buffer = buildMonthlyFinancialAnalysisWorkbook(data, moduleKey);
    const fileName = `财务趋势分析-${query.from}-${query.to}.xlsx`;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="financial-analysis.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.send(buffer);
  } catch (error) {
    sendFailure(res, error);
  }
});

router.get("/analysis", requireMonthlyReadRole, async (req, res) => {
  try {
    const data = await readFinancialAnalysis(analysisQuery(req), getActor(req));
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, data });
  } catch (error) {
    sendFailure(res, error);
  }
});

router.get(
  "/analysis/projects/:rootId/receipts/:receiptId/preview",
  requireMonthlyReadRole,
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let client: PoolClient | undefined;
    try {
      if (!req.session.user?.id || !req.session.user.role)
        throw new ProjectReceiptPreviewError(401, "登录信息已失效");
      const actor = getActor(req);
      client = await pool.connect();
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout = '60s'");
      const file = await prepareProjectReceiptPreview({
        client,
        actorId: actor.id,
        rootContractId: req.params.rootId,
        receiptId: req.params.receiptId,
        from: req.query.from,
        to: req.query.to,
        evidenceVersion: req.query.evidenceVersion,
      });
      await client.query("COMMIT");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      res.sendFile(file.absolutePath, (error) => {
        if (error && !res.headersSent)
          res
            .status(404)
            .json({ success: false, message: "回款文件暂时不可用" });
      });
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => undefined);
      res
        .status(
          error instanceof ProjectReceiptPreviewError ? error.status : 500,
        )
        .json({
          success: false,
          code: "MONTHLY_FINANCE_PROJECT_RECEIPT_PREVIEW_UNAVAILABLE",
          message:
            error instanceof ProjectReceiptPreviewError
              ? error.message
              : "回款凭证预览失败，请稍后重试",
        });
    } finally {
      client?.release();
    }
  },
);

router.get("/trend", requireMonthlyReadRole, async (req, res) => {
  try {
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    let trendMonths: string[];
    try {
      trendMonths = listMonthlyFinancialTrendMonths(from, to);
    } catch (error) {
      throw badRequest(
        "MONTHLY_FINANCE_TREND_RANGE_INVALID",
        error instanceof Error ? error.message : "趋势查询月份范围不正确",
      );
    }

    const actor = getActor(req);
    const [firstReport, earliestMainReceipt] = await Promise.all([
      queryOne<{ report_month: string | null }>(
        `SELECT MIN(report_month) AS report_month
           FROM monthly_financial_reports`,
        [],
      ),
      queryOne<{ month: string | null }>(
        `SELECT MIN(LEFT(receipt.receipt_date, 7)) AS month
           FROM contract_receipts receipt
           JOIN contracts contract ON contract.id = receipt.contract_id
           JOIN contracts root
             ON root.id = COALESCE(contract.root_contract_id, contract.id)
          WHERE receipt.status = 'confirmed'
            AND CASE
                  WHEN receipt.receipt_date ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                    THEN TO_CHAR(
                      TO_DATE(receipt.receipt_date, 'YYYY-MM-DD'),
                      'YYYY-MM-DD'
                    ) = receipt.receipt_date
                  ELSE FALSE
                END
            AND (
              receipt.currency IS NULL
              OR UPPER(BTRIM(receipt.currency)) = 'CNY'
            )
            AND COALESCE(root.category, root.declared_category) = 'main_business'
            AND root.is_deleted = FALSE
            AND root.status NOT IN ('draft', 'rejected')`,
        [],
      ),
    ]);
    const firstReportMonth = firstReport?.report_month || null;
    const earliestMainReceiptMonth = earliestMainReceipt?.month || null;
    const [
      reportMonths,
      reportYearRows,
      receiptRows,
      receiptYearRows,
      contractRows,
      contractYearRows,
    ] = await Promise.all([
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
      queryAll<{
        month: string;
        region: string;
        amount: string;
        currency: string | null;
        rate_snapshot_json: unknown;
      }>(
        `SELECT LEFT(receipt.receipt_date, 7) AS month,
                COALESCE(NULLIF(BTRIM(root.area), ''), '未标注行政区') AS region,
                receipt.amount::text AS amount, receipt.currency,
                receipt.rate_snapshot_json
           FROM contract_receipts receipt
           JOIN contracts contract ON contract.id = receipt.contract_id
           JOIN contracts root
             ON root.id = COALESCE(contract.root_contract_id, contract.id)
          WHERE receipt.status = 'confirmed'
            AND CASE
                  WHEN receipt.receipt_date ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                    THEN TO_CHAR(
                      TO_DATE(receipt.receipt_date, 'YYYY-MM-DD'),
                      'YYYY-MM-DD'
                    ) = receipt.receipt_date
                  ELSE FALSE
                END
            AND LEFT(receipt.receipt_date, 7) >= ?
            AND LEFT(receipt.receipt_date, 7) <= ?
            AND COALESCE(root.category, root.declared_category) = 'main_business'
            AND root.is_deleted = FALSE
            AND root.status NOT IN ('draft', 'rejected')
          ORDER BY receipt.receipt_date, receipt.id`,
        [from, to],
      ),
      queryAll<{ year: number }>(
        `SELECT DISTINCT LEFT(receipt.receipt_date, 4)::int AS year
           FROM contract_receipts receipt
           JOIN contracts contract ON contract.id = receipt.contract_id
           JOIN contracts root
             ON root.id = COALESCE(contract.root_contract_id, contract.id)
          WHERE receipt.status = 'confirmed'
            AND CASE
                  WHEN receipt.receipt_date ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                    THEN TO_CHAR(
                      TO_DATE(receipt.receipt_date, 'YYYY-MM-DD'),
                      'YYYY-MM-DD'
                    ) = receipt.receipt_date
                  ELSE FALSE
                END
            AND ?::text IS NOT NULL
            AND LEFT(receipt.receipt_date, 7) < ?
            AND (
              receipt.currency IS NULL
              OR UPPER(BTRIM(receipt.currency)) = 'CNY'
            )
            AND COALESCE(root.category, root.declared_category) = 'main_business'
            AND root.is_deleted = FALSE
            AND root.status NOT IN ('draft', 'rejected')
          ORDER BY year`,
        [firstReportMonth, firstReportMonth],
      ),
      queryAll<{
        id: string;
        month: string;
        region: string;
        amount: string;
        contract_date_source: string | null;
      }>(
        `SELECT root.id, LEFT(root.contract_date, 7) AS month,
                  COALESCE(NULLIF(BTRIM(root.area), ''), '未标注行政区') AS region,
                  root.current_effective_amount::text AS amount,
                  root.contract_date_source
             FROM contracts root
            WHERE root.is_deleted = FALSE
              AND root.relation_type = 'main'
              AND COALESCE(root.root_contract_id, root.id) = root.id
              AND root.status NOT IN ('draft', 'rejected')
              AND COALESCE(root.category, root.declared_category) = 'main_business'
              AND CASE
                    WHEN root.contract_date ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                      THEN TO_CHAR(
                        TO_DATE(root.contract_date, 'YYYY-MM-DD'),
                        'YYYY-MM-DD'
                      ) = root.contract_date
                    ELSE FALSE
                  END
              AND LEFT(root.contract_date, 7) >= ?
              AND LEFT(root.contract_date, 7) <= ?
            ORDER BY root.contract_date, root.id`,
        [from, to],
      ),
      queryAll<{ year: number }>(
        `SELECT DISTINCT LEFT(root.contract_date, 4)::int AS year
             FROM contracts root
            WHERE root.is_deleted = FALSE
              AND root.relation_type = 'main'
              AND COALESCE(root.root_contract_id, root.id) = root.id
              AND root.status NOT IN ('draft', 'rejected')
              AND COALESCE(root.category, root.declared_category) = 'main_business'
              AND root.contract_date_source IN ('ocr', 'manual')
              AND CASE
                    WHEN root.contract_date ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
                      THEN TO_CHAR(
                        TO_DATE(root.contract_date, 'YYYY-MM-DD'),
                        'YYYY-MM-DD'
                      ) = root.contract_date
                    ELSE FALSE
                  END
            ORDER BY year`,
        [],
      ),
    ]);

    const receiptCentsByMonth = new Map<string, number>();
    const receiptCentsByMonthRegion = new Map<string, number>();
    const unsupportedCurrencyMonths = new Set<string>();
    const unsupportedCurrencyRegionKeys = new Set<string>();
    const mainBusinessRegions = new Set<string>();
    for (const receipt of receiptRows) {
      const region = String(receipt.region || "未标注行政区")
        .normalize("NFKC")
        .trim();
      const regionKey = `${receipt.month}\u0000${region}`;
      mainBusinessRegions.add(region);
      const currency = String(receipt.currency || "CNY")
        .normalize("NFKC")
        .trim()
        .toUpperCase();
      if (currency !== "CNY") {
        unsupportedCurrencyMonths.add(receipt.month);
        unsupportedCurrencyRegionKeys.add(regionKey);
        continue;
      }
      const calculation = calculateMainBusinessIncome(
        receipt.amount,
        resolveRateBasisPoints(receipt.rate_snapshot_json),
      );
      receiptCentsByMonth.set(
        receipt.month,
        (receiptCentsByMonth.get(receipt.month) || 0) +
          calculation.contractAmountCents,
      );
      receiptCentsByMonthRegion.set(
        regionKey,
        (receiptCentsByMonthRegion.get(regionKey) || 0) +
          calculation.contractAmountCents,
      );
    }
    for (const month of unsupportedCurrencyMonths) {
      receiptCentsByMonth.delete(month);
    }

    const contractAmountByMonthRegion = new Map<string, string>();
    const contractCountByMonthRegion = new Map<string, number>();
    const unsupportedContractDateMonths = new Set<string>();
    const unsupportedContractDateRegionKeys = new Set<string>();
    for (const contract of contractRows) {
      const region = String(contract.region || "未标注行政区")
        .normalize("NFKC")
        .trim();
      const key = `${contract.month}\u0000${region}`;
      mainBusinessRegions.add(region);
      if (!["ocr", "manual"].includes(String(contract.contract_date_source))) {
        unsupportedContractDateMonths.add(contract.month);
        unsupportedContractDateRegionKeys.add(key);
        continue;
      }
      contractAmountByMonthRegion.set(
        key,
        addFinancialAmounts(
          contractAmountByMonthRegion.get(key) || "0",
          normalizeFinancialAmount(contract.amount),
        ),
      );
      contractCountByMonthRegion.set(
        key,
        (contractCountByMonthRegion.get(key) || 0) + 1,
      );
    }

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

    const regions = [...mainBusinessRegions].sort((left, right) =>
      left.localeCompare(right, "zh-CN"),
    );
    const currentDate = new Date();
    const currentMonth = `${currentDate.getFullYear()}-${String(
      currentDate.getMonth() + 1,
    ).padStart(2, "0")}`;
    const actualReceipts = trendMonths.flatMap((month) => {
      if (
        !earliestMainReceiptMonth ||
        month < earliestMainReceiptMonth ||
        month > currentMonth ||
        unsupportedCurrencyMonths.has(month)
      ) {
        return [];
      }
      return [
        {
          month,
          amount: centsToFinancialAmount(receiptCentsByMonth.get(month) || 0),
        },
      ];
    });
    const mainBusinessPoints = trendMonths.flatMap((month) =>
      regions.map((region) => {
        const key = `${month}\u0000${region}`;
        return {
          month,
          region,
          actualReceipt: unsupportedCurrencyRegionKeys.has(key)
            ? null
            : centsToFinancialAmount(receiptCentsByMonthRegion.get(key) || 0),
          contractAmount: unsupportedContractDateRegionKeys.has(key)
            ? null
            : contractAmountByMonthRegion.get(key) || "0",
          contractCount: unsupportedContractDateRegionKeys.has(key)
            ? null
            : contractCountByMonthRegion.get(key) || 0,
        };
      }),
    );

    const trend = buildMonthlyFinancialTrendData({
      from,
      to,
      availableYears: [
        ...reportYearRows.map((row) => Number(row.year)),
        ...receiptYearRows.map((row) => Number(row.year)),
        ...contractYearRows.map((row) => Number(row.year)),
      ],
      reports,
      actualReceipts,
      mainBusinessRegions: regions,
      mainBusinessPoints,
    });
    if (unsupportedCurrencyMonths.size > 0) {
      trend.warnings.push({
        code: "MONTHLY_FINANCE_TREND_FOREIGN_CURRENCY_RECEIPT",
        message:
          "部分历史月份存在非人民币主营回款且没有冻结汇率，未生成该月主营实际到账趋势点",
        months: [...unsupportedCurrencyMonths].sort(),
      });
    }
    if (unsupportedContractDateMonths.size > 0) {
      trend.warnings.push({
        code: "MONTHLY_FINANCE_TREND_CONTRACT_DATE_SOURCE_UNCONFIRMED",
        message:
          "部分主营合同仅有上传日期，未纳入按签订月统计的合同额和合同数量趋势",
        months: [...unsupportedContractDateMonths].sort(),
      });
    }
    res.json({ success: true, data: trend });
  } catch (error) {
    sendFailure(res, error);
  }
});

router.get("/:month", requireMonthlyReadRole, async (req, res) => {
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
  requireMonthlyWriteRole,
  async (req, res) => {
    try {
      const month = assertFinancialMonth(req.params.month);
      const actor = getActor(req);
      const expectedVersion = parseExpectedVersion(req.body?.expectedVersion);
      let items = validateManualItems(req.body?.items, month);
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
        if (requestedOpening && !previous.isFirstMonth) {
          throw conflict(
            "MONTHLY_FINANCE_OPENING_BALANCES_READ_ONLY",
            `${month}不是首月，期初余额只能由上月月结期末承接，不能通过本次请求修改`,
          );
        }
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
        const welfareCategories = await client.query<{
          id: string;
          name: string;
          is_active: boolean;
        }>(
          `SELECT id, name, is_active
             FROM welfare_one_expense_categories
            FOR SHARE`,
        );
        const welfareTwoCategories = await client.query<{
          id: string;
          name: string;
          is_active: boolean;
        }>(
          `SELECT id, name, is_active
             FROM welfare_two_expense_categories
            FOR SHARE`,
        );
        const welfareCategoryById = new Map(
          [
            ...welfareCategories.rows.map(
              (category) => [`welfare_one:${category.id}`, category] as const,
            ),
            ...welfareTwoCategories.rows.map(
              (category) => [`welfare_two:${category.id}`, category] as const,
            ),
          ],
        );
        const beforeItemById = new Map(
          beforeItems.map((item) => [item.id!, item]),
        );
        items = items.map((item, index) => {
          const welfareAccount =
            item.category === "welfare_one_expense"
              ? "welfare_one"
              : item.category === "welfare_two_expense"
                ? "welfare_two"
                : null;
          if (!welfareAccount) return item;
          const category = welfareCategoryById.get(
            `${welfareAccount}:${item.welfareCategoryId || ""}`,
          );
          if (!category) {
            throw badRequest(
              "MONTHLY_FINANCE_WELFARE_CATEGORY_NOT_FOUND",
              `第${index + 1}条福利账户费用分类不存在`,
            );
          }
          const previousItem = item.id ? beforeItemById.get(item.id) : undefined;
          if (
            previousItem?.welfareCategoryId &&
            (previousItem.welfareCategoryId !== item.welfareCategoryId ||
              previousItem.category !== item.category)
          ) {
            throw badRequest(
              "MONTHLY_FINANCE_WELFARE_CATEGORY_IMMUTABLE",
              `第${index + 1}条福利账户手工项目不能改换费用分类`,
            );
          }
          if (!previousItem && !category.is_active) {
            throw badRequest(
              "MONTHLY_FINANCE_WELFARE_CATEGORY_INACTIVE",
              `第${index + 1}条福利账户费用分类已停用`,
            );
          }
          return {
            ...item,
            welfareCategoryNameSnapshot:
              previousItem?.welfareCategoryNameSnapshot || category.name,
          };
        });
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
                   voucher_reference = $9, welfare_category_id = $10,
                   welfare_category_name_snapshot = $11,
                   welfare_two_category_id = $12,
                   welfare_two_category_name_snapshot = $13, updated_at = $14
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
                item.category === "welfare_one_expense"
                  ? item.welfareCategoryId
                  : null,
                item.category === "welfare_one_expense"
                  ? item.welfareCategoryNameSnapshot
                  : null,
                item.category === "welfare_two_expense"
                  ? item.welfareCategoryId
                  : null,
                item.category === "welfare_two_expense"
                  ? item.welfareCategoryNameSnapshot
                  : null,
                now,
              ],
            );
          } else {
            await client.query(
              `INSERT INTO monthly_financial_manual_items(
               id, report_id, category, account_code, direction, amount,
               occurred_on, description, voucher_reference,
               welfare_category_id, welfare_category_name_snapshot,
               welfare_two_category_id, welfare_two_category_name_snapshot,
               created_by, created_at, updated_at
             ) VALUES($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)`,
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
                item.category === "welfare_one_expense"
                  ? item.welfareCategoryId
                  : null,
                item.category === "welfare_one_expense"
                  ? item.welfareCategoryNameSnapshot
                  : null,
                item.category === "welfare_two_expense"
                  ? item.welfareCategoryId
                  : null,
                item.category === "welfare_two_expense"
                  ? item.welfareCategoryNameSnapshot
                  : null,
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

router.post("/:month/refresh", requireMonthlyWriteRole, async (req, res) => {
  let contractReconciliation: MonthlyContractReceiptReconciliationResult[] = [];
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
      if (!row && previous.isFirstMonth) {
        throw conflict(
          "MONTHLY_FINANCE_OPENING_BALANCES_REQUIRED",
          "首月尚未保存，请先完整填写四个账户期初余额并点击保存维护数据，再同步自动数据",
        );
      }
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
    await cleanupRolledBackContractEvidence(contractReconciliation, error);
    sendFailure(res, error);
  }
});

router.post("/:month/close", requireMonthlyWriteRole, async (req, res) => {
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

router.post("/:month/reopen", requireMonthlyWriteRole, async (req, res) => {
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

router.get("/:month/export", requireMonthlyReadRole, async (req, res) => {
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
