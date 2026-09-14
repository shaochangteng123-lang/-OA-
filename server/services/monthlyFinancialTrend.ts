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
  type MonthlyFinancialMainBusinessTrendPoint,
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
    actualReceiptState: null,
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
    actualReceiptState: report.status === "closed" ? "closed" : "current",
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
  actualReceipts?: Array<{ month: string; amount: string }>;
  mainBusinessRegions?: string[];
  mainBusinessPoints?: MonthlyFinancialMainBusinessTrendPoint[];
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

  const mainBusinessRegions = [...new Set(input.mainBusinessRegions || [])]
    .map((region) =>
      String(region || "")
        .normalize("NFKC")
        .trim(),
    )
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  const mainBusinessPointKeys = new Set<string>();
  const mainBusinessPoints = (input.mainBusinessPoints || [])
    .flatMap((point) => {
      assertFinancialMonth(point.month);
      const region = String(point.region || "")
        .normalize("NFKC")
        .trim();
      if (!monthSet.has(point.month) || !region) return [];
      if (
        point.contractCount !== null &&
        (!Number.isInteger(point.contractCount) || point.contractCount < 0)
      ) {
        throw new Error(`${point.month}${region}主营合同数量不正确`);
      }
      const key = `${point.month}\u0000${region}`;
      if (mainBusinessPointKeys.has(key)) {
        throw new Error(`${point.month}${region}存在重复主营趋势数据`);
      }
      mainBusinessPointKeys.add(key);
      return [
        {
          month: point.month,
          region,
          actualReceipt:
            point.actualReceipt === null
              ? null
              : normalizeFinancialAmount(point.actualReceipt),
          contractAmount:
            point.contractAmount === null
              ? null
              : normalizeFinancialAmount(point.contractAmount),
          contractCount: point.contractCount,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.month.localeCompare(right.month) ||
        left.region.localeCompare(right.region, "zh-CN"),
    );

  const actualReceiptByMonth = new Map<string, string>();
  for (const receipt of input.actualReceipts || []) {
    assertFinancialMonth(receipt.month);
    if (!monthSet.has(receipt.month)) continue;
    if (actualReceiptByMonth.has(receipt.month)) {
      throw new Error(`${receipt.month}存在重复的主营实际到账趋势来源`);
    }
    actualReceiptByMonth.set(
      receipt.month,
      normalizeFinancialAmount(receipt.amount),
    );
  }
  const points = months.map((month) => {
    const report = reportByMonth.get(month);
    const point = report
      ? buildMonthlyFinancialTrendPoint(report)
      : buildMonthlyFinancialTrendGap(month);
    const actualReceipt = actualReceiptByMonth.get(month);
    if (point.actualReceipt !== null || actualReceipt === undefined) {
      return point;
    }
    return {
      ...point,
      actualReceipt,
      actualReceiptState: "confirmed_source" as const,
    };
  });
  const missingMonths = points
    .filter((point) => point.status === null)
    .map((point) => point.month);
  const currentMonths = points
    .filter((point) => point.valueState === "current")
    .map((point) => point.month);
  const confirmedSourceMonths = points
    .filter((point) => point.actualReceiptState === "confirmed_source")
    .map((point) => point.month);
  const warningGroups = new Map<string, MonthlyFinancialTrendWarning>();
  if (missingMonths.length) {
    appendGroupedWarning(warningGroups, {
      code: "MONTHLY_FINANCE_TREND_MISSING_MONTHS",
      message: `范围内有${missingMonths.length}个月尚未建立月度财务报表；有已确认合同回款的历史月份仅展示“主营实际到账”，其他指标及无回款月份保留断点`,
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
  if (confirmedSourceMonths.length) {
    appendGroupedWarning(warningGroups, {
      code: "MONTHLY_FINANCE_TREND_CONFIRMED_RECEIPT_SOURCE",
      message: `范围内有${confirmedSourceMonths.length}个月尚未建立月报，仅“主营实际到账”按合同已确认回款展示，其他指标保持断点`,
      months: confirmedSourceMonths,
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
    mainBusinessRegions,
    mainBusinessPoints,
    warnings: [...warningGroups.values()],
  };
}
