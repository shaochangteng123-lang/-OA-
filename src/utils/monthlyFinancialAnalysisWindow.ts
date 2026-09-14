import type { FinancialAnalysisQuery } from "@/types/monthlyFinancialAnalysis";

export const FINANCIAL_WINDOW_MONTHS = 12;
export const FINANCIAL_WINDOW_QUARTERS = 12;

export interface FinancialMonthRange {
  from: string;
  to: string;
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const FIRST_MONTH_INDEX = 1900 * 12;
const LAST_MONTH_INDEX = 2099 * 12 + 11;

/** 仅按自然月序号平移，不受时区、月末日期或夏令时影响。 */
export function financialMonthOffset(month: string, offset: number): string {
  const match = typeof month === "string" ? month.match(MONTH_PATTERN) : null;
  if (!match || Number(match[1]) === 0) {
    throw new Error("财务月份必须为有效的 YYYY-MM 格式");
  }
  if (!Number.isSafeInteger(offset)) {
    throw new Error("财务月份偏移量必须为安全整数");
  }
  const targetIndex = Number(match[1]) * 12 + Number(match[2]) - 1 + offset;
  if (targetIndex < FIRST_MONTH_INDEX || targetIndex > LAST_MONTH_INDEX) {
    throw new Error("财务月份范围必须在1900至2099年之间");
  }
  return `${Math.floor(targetIndex / 12)}-${String((targetIndex % 12) + 1).padStart(2, "0")}`;
}

export function financialTwelveMonthRange(end: string): FinancialMonthRange {
  const to = financialMonthOffset(end, 0);
  return { from: financialMonthOffset(to, 1 - FINANCIAL_WINDOW_MONTHS), to };
}

/** 自然季度范围；未完季度只统计到明确传入的截止月份。 */
export function financialQuarterRange(
  month: string,
  maxMonth?: string,
): FinancialMonthRange {
  const normalized = financialMonthOffset(month, 0);
  const from = financialMonthOffset(
    normalized,
    -((Number(normalized.slice(5)) - 1) % 3),
  );
  const quarterEnd = financialMonthOffset(from, 2);
  const maximum =
    maxMonth === undefined ? quarterEnd : financialMonthOffset(maxMonth, 0);
  if (maximum < from) throw new Error("财务季度截止月份不能早于当季首月");
  return { from, to: maximum < quarterEnd ? maximum : quarterEnd };
}

/** 最多十二个自然季度；1900年边界不足十二期时不补造更早季度。 */
export function financialTwelveQuarterRange(
  end: string,
  maxMonth?: string,
): FinancialMonthRange {
  const normalized = financialMonthOffset(end, 0);
  const maximum =
    maxMonth === undefined ? undefined : financialMonthOffset(maxMonth, 0);
  const last = financialQuarterRange(
    maximum && normalized > maximum ? maximum : normalized,
    maximum,
  );
  const firstIndex =
    Number(last.from.slice(0, 4)) * 12 + Number(last.from.slice(5)) - 1;
  const availableOffset = Math.min(
    (FINANCIAL_WINDOW_QUARTERS - 1) * 3,
    firstIndex - FIRST_MONTH_INDEX,
  );
  return {
    from: financialMonthOffset(last.from, -availableOffset),
    to: last.to,
  };
}

/** 窗口移动时保留业务筛选和对比年差，不把跨年后的同期锚点留在旧年份。 */
export function financialWindowQuery(
  sourceQuery: Readonly<FinancialAnalysisQuery>,
  range: Readonly<FinancialMonthRange>,
  granularity: "month" | "quarter" = "month",
): FinancialAnalysisQuery {
  if (granularity !== "month" && granularity !== "quarter")
    throw new Error("财务连续窗口粒度只能为月度或季度");
  const from = financialMonthOffset(range.from, 0);
  const to = financialMonthOffset(range.to, 0);
  if (from > to) throw new Error("财务窗口开始月份不能晚于结束月份");
  const next: FinancialAnalysisQuery = {
    ...sourceQuery,
    from,
    to,
    granularity,
  };
  delete next.comparisonYear;
  if (sourceQuery.comparisonYear !== undefined) {
    const sourceYear = Number(
      financialMonthOffset(sourceQuery.from, 0).slice(0, 4),
    );
    if (
      !Number.isInteger(sourceQuery.comparisonYear) ||
      sourceQuery.comparisonYear < 1900 ||
      sourceQuery.comparisonYear > 2098 ||
      sourceQuery.comparisonYear >= sourceYear
    ) {
      throw new Error("对比年份必须在1900至2098年间且早于原查询开始年份");
    }
    const previousYear =
      Number(from.slice(0, 4)) - (sourceYear - sourceQuery.comparisonYear);
    if (previousYear >= 1900) next.comparisonYear = previousYear;
  }
  return next;
}
