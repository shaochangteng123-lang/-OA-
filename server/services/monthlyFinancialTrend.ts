import {
  addFinancialAmounts,
  assertFinancialMonth,
  normalizeFinancialAmount,
  subtractFinancialAmounts,
} from "./monthlyFinancialReport.js";
import {
  FINANCIAL_ACCOUNT_CODES,
  type FinancialAccountCode,
  type MonthlyFinancialReportStatus,
  type MonthlyFinancialTrendData,
  type MonthlyFinancialTrendPoint,
  type MonthlyFinancialTrendWarning,
} from "../types/monthly-financial-report.js";

export const MAX_MONTHLY_FINANCIAL_TREND_MONTHS = 240;

interface MonthlyFinancialTrendIssueInput {
  code: string;
  message: string;
}

export interface MonthlyFinancialTrendReportInput {
  month: string;
  status: MonthlyFinancialReportStatus;
  accounts: Array<{
    code: FinancialAccountCode;
    opening: string;
    inflow: string;
    outflow: string;
    closing: string;
  }>;
  income: {
    mainReceipt: string;
  };
  validations?: {
    blockers: MonthlyFinancialTrendIssueInput[];
    warnings: MonthlyFinancialTrendIssueInput[];
  };
}

function financialMonthIndex(month: string): number {
  assertFinancialMonth(month);
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + monthNumber - 1;
}

function formatFinancialMonth(index: number): string {
  const year = Math.floor(index / 12);
  const monthNumber = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

export function listMonthlyFinancialTrendMonths(
  from: string,
  to: string,
): string[] {
  const fromIndex = financialMonthIndex(from);
  const toIndex = financialMonthIndex(to);
  if (fromIndex > toIndex) {
    throw new Error("趋势开始月份不能晚于结束月份");
  }
  const monthCount = toIndex - fromIndex + 1;
  if (monthCount > MAX_MONTHLY_FINANCIAL_TREND_MONTHS) {
    throw new Error(
      `趋势查询范围不能超过${MAX_MONTHLY_FINANCIAL_TREND_MONTHS}个月`,
    );
  }
  return Array.from({ length: monthCount }, (_, index) =>
    formatFinancialMonth(fromIndex + index),
  );
}

function emptyAccountClosing(): Record<FinancialAccountCode, null> {
  return {
    general: null,
    business: null,
    welfare_one: null,
    welfare_two: null,
  };
}

export function buildMonthlyFinancialTrendGap(
  month: string,
): MonthlyFinancialTrendPoint {
  assertFinancialMonth(month);
  return {
    month,
    status: null,
    valueState: null,
    actualReceipt: null,
    settlementInflow: null,
    totalOutflow: null,
    netChange: null,
    closingTotal: null,
    accountClosing: emptyAccountClosing(),
  };
}

export function buildMonthlyFinancialTrendPoint(
  report: MonthlyFinancialTrendReportInput,
): MonthlyFinancialTrendPoint {
  assertFinancialMonth(report.month);
  const accountsByCode = new Map(
    report.accounts.map((account) => [account.code, account]),
  );
  if (
    report.accounts.length !== FINANCIAL_ACCOUNT_CODES.length ||
    accountsByCode.size !== FINANCIAL_ACCOUNT_CODES.length ||
    FINANCIAL_ACCOUNT_CODES.some((code) => !accountsByCode.has(code))
  ) {
    throw new Error(`${report.month}月度趋势四账户明细不完整`);
  }

  const openingAmounts: string[] = [];
  const inflowAmounts: string[] = [];
  const outflowAmounts: string[] = [];
  const closingAmounts: string[] = [];
  const accountClosing = {} as Record<FinancialAccountCode, string>;
  for (const code of FINANCIAL_ACCOUNT_CODES) {
    const account = accountsByCode.get(code)!;
    openingAmounts.push(normalizeFinancialAmount(account.opening, true));
    inflowAmounts.push(normalizeFinancialAmount(account.inflow));
    outflowAmounts.push(normalizeFinancialAmount(account.outflow));
    const closing = normalizeFinancialAmount(account.closing, true);
    closingAmounts.push(closing);
    accountClosing[code] = closing;
  }

  const openingTotal = addFinancialAmounts(...openingAmounts);
  const settlementInflow = addFinancialAmounts(...inflowAmounts);
  const totalOutflow = addFinancialAmounts(...outflowAmounts);
  const closingTotal = addFinancialAmounts(...closingAmounts);
  const netChange = subtractFinancialAmounts(closingTotal, openingTotal);
  if (netChange !== subtractFinancialAmounts(settlementInflow, totalOutflow)) {
    throw new Error(`${report.month}月度趋势账户余额与收支变动不一致`);
  }
  return {
    month: report.month,
    status: report.status,
    valueState: report.status === "closed" ? "closed" : "current",
    actualReceipt: normalizeFinancialAmount(report.income.mainReceipt),
    settlementInflow,
    totalOutflow,
    netChange,
    closingTotal,
    accountClosing,
  };
}

function appendGroupedWarning(
  groups: Map<string, MonthlyFinancialTrendWarning>,
  warning: MonthlyFinancialTrendWarning,
): void {
  const key = `${warning.code}\u0000${warning.message}`;
  const current = groups.get(key);
  if (current) {
    for (const month of warning.months) {
      if (!current.months.includes(month)) current.months.push(month);
    }
    return;
  }
  groups.set(key, { ...warning, months: [...warning.months] });
}

export function buildMonthlyFinancialTrendData(input: {
  from: string;
  to: string;
  availableYears: number[];
  reports: MonthlyFinancialTrendReportInput[];
}): MonthlyFinancialTrendData {
  const months = listMonthlyFinancialTrendMonths(input.from, input.to);
  const monthSet = new Set(months);
  const reportByMonth = new Map<string, MonthlyFinancialTrendReportInput>();
  for (const report of input.reports) {
    if (!monthSet.has(report.month)) continue;
    if (reportByMonth.has(report.month)) {
      throw new Error(`${report.month}存在重复的月度财务报表`);
    }
    reportByMonth.set(report.month, report);
  }

  const points = months.map((month) => {
    const report = reportByMonth.get(month);
    return report
      ? buildMonthlyFinancialTrendPoint(report)
      : buildMonthlyFinancialTrendGap(month);
  });
  const missingMonths = points
    .filter((point) => point.status === null)
    .map((point) => point.month);
  const currentMonths = points
    .filter((point) => point.valueState === "current")
    .map((point) => point.month);
  const warningGroups = new Map<string, MonthlyFinancialTrendWarning>();
  if (missingMonths.length) {
    appendGroupedWarning(warningGroups, {
      code: "MONTHLY_FINANCE_TREND_MISSING_MONTHS",
      message: `范围内有${missingMonths.length}个月尚未建立月度财务报表，趋势图已保留断点`,
      months: missingMonths,
    });
  }
  if (currentMonths.length) {
    appendGroupedWarning(warningGroups, {
      code: "MONTHLY_FINANCE_TREND_CURRENT_MONTHS",
      message: `范围内有${currentMonths.length}个月尚未月结，当前显示未月结报表的当前精确工作值`,
      months: currentMonths,
    });
  }
  for (const report of input.reports) {
    if (!monthSet.has(report.month) || !report.validations) continue;
    for (const issue of [
      ...report.validations.blockers,
      ...report.validations.warnings,
    ]) {
      appendGroupedWarning(warningGroups, {
        code: issue.code,
        message: issue.message,
        months: [report.month],
      });
    }
  }

  return {
    from: input.from,
    to: input.to,
    availableYears: [...new Set(input.availableYears)]
      .filter((year) => Number.isInteger(year) && year >= 0 && year <= 9999)
      .sort((left, right) => left - right),
    points,
    warnings: [...warningGroups.values()],
  };
}
