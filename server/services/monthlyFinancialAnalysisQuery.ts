import type {
  FinancialAnalysisGranularity,
  FinancialAnalysisModuleKey,
  FinancialAnalysisQuery,
} from "../types/monthly-financial-analysis.js";
import { listMonthlyFinancialTrendMonths } from "./monthlyFinancialTrend.js";

export const FINANCIAL_ANALYSIS_MODULES: FinancialAnalysisModuleKey[] = [
  "balances",
  "inflow",
  "outflow",
  "projects",
  "settlement",
  "business",
  "personnel",
];

function queryText(value: unknown, label: string, maxLength = 150): string {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${label}只能提供一个文本值`);
  const text = value.trim();
  if (
    text.length > maxLength ||
    [...text].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new Error(`${label}格式不正确或过长`);
  }
  return text;
}

export function parseMonthlyFinancialAnalysisQuery(
  raw: Record<string, unknown>,
): FinancialAnalysisQuery {
  const from = queryText(raw.from, "开始月份", 7);
  const to = queryText(raw.to, "结束月份", 7);
  const monthPattern = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/u;
  if (!monthPattern.test(from) || !monthPattern.test(to)) {
    throw new Error("请选择1900至2099年内的有效开始和结束月份");
  }
  listMonthlyFinancialTrendMonths(from, to);
  const granularity = queryText(raw.granularity, "统计粒度", 10) || "month";
  if (!["month", "quarter", "year"].includes(granularity)) {
    throw new Error("统计粒度只能是月度、季度或年度");
  }
  const query: FinancialAnalysisQuery = {
    from,
    to,
    granularity: granularity as FinancialAnalysisGranularity,
  };
  for (const field of [
    "partyA",
    "contractRegion",
    "reimbursementScope",
    "personId",
  ] as const) {
    const value = queryText(raw[field], "筛选条件");
    if (value) query[field] = value;
  }
  if (raw.comparisonYear !== undefined && raw.comparisonYear !== "") {
    const yearText =
      typeof raw.comparisonYear === "number"
        ? String(raw.comparisonYear)
        : queryText(raw.comparisonYear, "对比年份", 4);
    if (!/^\d{4}$/u.test(yearText))
      throw new Error("对比年份必须是四位整数年份");
    const comparisonYear = Number(yearText);
    query.comparisonYear = comparisonYear;
    buildMonthlyFinancialComparisonQuery(query);
  }
  return query;
}

/** 保持起止月份及全部业务筛选，只按相同年差平移对比区间。 */
export function buildMonthlyFinancialComparisonQuery(
  query: FinancialAnalysisQuery,
): FinancialAnalysisQuery | null {
  if (query.comparisonYear === undefined) return null;
  const { comparisonYear, ...withoutComparison } = query;
  const fromYear = Number(query.from.slice(0, 4));
  if (
    !Number.isInteger(comparisonYear) ||
    comparisonYear < 1900 ||
    comparisonYear > 2098 ||
    comparisonYear >= fromYear
  ) {
    throw new Error("对比年份必须为1900至2098年间且早于开始月份所在年份");
  }
  const shiftYears = fromYear - comparisonYear;
  const comparison = {
    ...withoutComparison,
    from: `${comparisonYear}${query.from.slice(4)}`,
    to: `${Number(query.to.slice(0, 4)) - shiftYears}${query.to.slice(4)}`,
  };
  const monthPattern = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/u;
  if (
    !monthPattern.test(query.from) ||
    !monthPattern.test(query.to) ||
    !monthPattern.test(comparison.from) ||
    !monthPattern.test(comparison.to)
  ) {
    throw new Error("对比区间必须在1900至2099年的有效月份内");
  }
  listMonthlyFinancialTrendMonths(query.from, query.to);
  listMonthlyFinancialTrendMonths(comparison.from, comparison.to);
  return comparison;
}

export function parseMonthlyFinancialAnalysisModule(
  value: unknown,
): FinancialAnalysisModuleKey | "all" {
  const key = queryText(value, "导出模块", 20) || "all";
  if (
    key !== "all" &&
    !FINANCIAL_ANALYSIS_MODULES.includes(key as FinancialAnalysisModuleKey)
  ) {
    throw new Error("导出模块不存在");
  }
  return key as FinancialAnalysisModuleKey | "all";
}

export function parseMonthlyFinancialAnalysisVersion(
  value: unknown,
): string | null {
  const version = queryText(value, "数据版本", 64);
  if (!version) return null;
  if (!/^[a-f0-9]{64}$/u.test(version)) throw new Error("数据版本格式不正确");
  return version;
}
