import { Router, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import type { PoolClient } from "pg";
import { db, pool } from "../db/index.js";
import { requireRole } from "../middleware/auth.js";
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
import { buildMonthlyFinancialWorkbook } from "../services/monthlyFinancialReportWorkbook.js";
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
const FORMULA_VERSION = "monthly-finance-v1";

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
  status: string;
  version: number;
  accounts: Array<{
    code: FinancialAccountCode;
    name: string;
    opening: string;
    inflow: string;
    outflow: string;
    closing: string;
  }>;
  income: Record<string, string>;
  expenses: Record<string, string>;
  automaticDetails: MonthlyFinancialAutomaticSnapshot["details"];
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

async function loadAutomaticSnapshot(
  month: string,
  client?: QueryClient,
): Promise<MonthlyFinancialAutomaticSnapshot> {
  const [receiptRows, payrollRows, reimbursementRows, assetRows] =
    await Promise.all([
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
    ]);

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
        message: receiptRows.length ? null : "本月没有已确认主营回款",
      },
      {
        code: "payroll",
        name: "人力成本",
        recordCount: payrollRows.length,
        amount: humanCost,
        updatedAt: maxUpdatedAt(payrollRows.map((row) => row.updated_at)),
        available: true,
        message: payrollRows.length ? null : "本月没有工资记录",
      },
      {
        code: "reimbursements",
        name: "已支付报销",
        recordCount: reimbursementRows.length,
        amount: reimbursementAmount,
        updatedAt: maxUpdatedAt(reimbursementRows.map((row) => row.updated_at)),
        available: true,
        message: reimbursementRows.length ? null : "本月没有已支付报销",
      },
      {
        code: "asset_payments",
        name: "资产类合同付款",
        recordCount: assetRows.length,
        amount: assetAdministration,
        updatedAt: maxUpdatedAt(assetRows.map((row) => row.updated_at)),
        available: true,
        message: assetRows.length
          ? "当前仅纳入公司账户已确认付款，未重复统计外部承担付款"
          : "本月没有已确认资产付款",
      },
    ],
    details,
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
      welfareOne407Ai: internal.expenses.welfareOne407Ai,
      welfareOne8hAi: internal.expenses.welfareOne8hAi,
      welfareTwoRefreshment: internal.expenses.welfareTwoRefreshment,
      welfareTwoTeamBuilding: internal.expenses.welfareTwoTeamBuilding,
      welfareTwoPhysicalExam: internal.expenses.welfareTwoHealthCheck,
    },
    automaticDetails: automatic.details,
    totals: {
      opening,
      income: incomeTotal,
      expense: expenseTotal,
      closing,
      netChange: subtractFinancialAmounts(closing, opening),
    },
    manualItems: internal.manualItems.map((item) => ({
      ...item,
      categoryLabel: MANUAL_CATEGORY_RULES[item.category].label,
    })),
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
  const automatic =
    !forceAutomatic && storedAutomatic
      ? storedAutomatic
      : await loadAutomaticSnapshot(month);
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
  const databaseCode =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
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
    await db.transaction(async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      await lockFinancialMonth(client, month);
      const row = await loadReportRow(month, client, true);
      if ((row?.version || 0) !== expectedVersion)
        throw new Error("月度报表版本已变化，请刷新后重试");
      if (row?.status === "closed")
        throw new Error("已月结报表不能刷新，请先重新开启");
      const previous = await loadPreviousContext(month, row, client);
      const automatic = await loadAutomaticSnapshot(month, client);
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
