import type { FinancialAnalysisQuery } from "@/types/monthlyFinancialAnalysis";
import type { FinancialMonthRange } from "@/utils/monthlyFinancialAnalysisWindow";

export type FinancialHistoryGranularity = "month" | "quarter";
const FIRST_MONTH = 1900 * 12;
const LAST_MONTH = 2099 * 12 + 11;
const FILTER_KEYS = [
  "partyA",
  "contractRegion",
  "reimbursementScope",
  "personId",
] as const;

function monthIndex(month: string): number {
  const match =
    typeof month === "string"
      ? month.match(/^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/u)
      : null;
  if (!match) throw new Error("历史月份必须为1900至2099年内有效的YYYY-MM格式");
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}
function monthText(index: number): string {
  return (
    Math.floor(index / 12) + "-" + String((index % 12) + 1).padStart(2, "0")
  );
}
function quarterStart(index: number): number {
  return Math.floor(index / 3) * 3;
}
function quarterEnd(index: number): number {
  return quarterStart(index) + 2;
}
function supportedGranularity(
  value: unknown,
): value is FinancialHistoryGranularity {
  return value === "month" || value === "quarter";
}
function yearDifference(
  query: Readonly<FinancialAnalysisQuery>,
): number | null {
  if (query.comparisonYear === undefined) return null;
  const year = Math.floor(monthIndex(query.from) / 12);
  if (
    !Number.isInteger(query.comparisonYear) ||
    query.comparisonYear < 1900 ||
    query.comparisonYear > 2098 ||
    query.comparisonYear >= year
  )
    throw new Error("同比年份必须在1900至2098年间且早于源查询开始年份");
  return year - query.comparisonYear;
}

/**
 * 扩充历史读取范围，默认在可见窗口前后各缓冲12期；不切片或计算任何业务数据。
 * 可见范围必须已经落在合法min/max内，未完季度边界保持不变以免改变该期金额。
 */
export function financialHistoryBufferRange(
  range: Readonly<FinancialMonthRange>,
  granularity: FinancialHistoryGranularity,
  minMonth: string,
  maxMonth: string,
  sourceQuery?: Readonly<FinancialAnalysisQuery>,
  paddingPeriods = 12,
): FinancialMonthRange {
  if (!supportedGranularity(granularity))
    throw new Error("历史缓冲仅支持月度或季度");
  if (!Number.isSafeInteger(paddingPeriods) || paddingPeriods < 0)
    throw new Error("历史缓冲期数必须为非负安全整数");
  const from = monthIndex(range.from),
    to = monthIndex(range.to);
  const minimum = monthIndex(minMonth),
    maximum = monthIndex(maxMonth);
  if (minimum > maximum || from > to)
    throw new Error("历史缓冲开始月份不能晚于结束月份");
  if (from < minimum || to > maximum)
    throw new Error("可见历史窗口不能超出允许的开始或截止月份");
  const padding =
    Math.min(paddingPeriods, LAST_MONTH - FIRST_MONTH + 1) *
    (granularity === "quarter" ? 3 : 1);
  let first = Math.max(FIRST_MONTH, minimum, from - padding);
  let last = Math.min(LAST_MONTH, maximum, to + padding);
  if (granularity === "quarter") {
    // 部分首季/尾季不能用包含其他月份的季度合计替代，因此该侧不扩展。
    first = from === quarterStart(from) ? Math.ceil(first / 3) * 3 : from;
    last = to === quarterEnd(to) ? Math.min(maximum, quarterEnd(last)) : to;
  }
  if (sourceQuery) {
    const difference = yearDifference(sourceQuery);
    if (difference !== null) {
      const firstComparableMonth = (1900 + difference) * 12;
      // 只缩前缓冲，不丢可见期；可见查询本就无合法同比时不能伪造1899年对比。
      if (from >= firstComparableMonth)
        first = Math.max(first, firstComparableMonth);
    }
  }
  return { from: monthText(first), to: monthText(last) };
}

/**
 * 判断完整历史响应能否复用：业务筛选、粒度和固定同比年差必须一致。
 * 季度还必须保留目标首尾季的实际起止月份，完整季不能替代未完季。
 */
export function financialHistoryRangeCovered(
  candidateQuery: Readonly<FinancialAnalysisQuery>,
  targetQuery: Readonly<FinancialAnalysisQuery>,
): boolean {
  try {
    if (
      !supportedGranularity(candidateQuery.granularity) ||
      candidateQuery.granularity !== targetQuery.granularity
    )
      return false;
    const from = monthIndex(candidateQuery.from),
      to = monthIndex(candidateQuery.to);
    const targetFrom = monthIndex(targetQuery.from),
      targetTo = monthIndex(targetQuery.to);
    if (
      from > to ||
      targetFrom > targetTo ||
      from > targetFrom ||
      to < targetTo
    )
      return false;
    if (yearDifference(candidateQuery) !== yearDifference(targetQuery))
      return false;
    for (const key of FILTER_KEYS) {
      const candidate = candidateQuery[key],
        target = targetQuery[key];
      if (
        (candidate !== undefined && typeof candidate !== "string") ||
        (target !== undefined && typeof target !== "string") ||
        (candidate ?? "") !== (target ?? "")
      )
        return false;
    }
    if (candidateQuery.granularity === "quarter") {
      if (Math.max(from, quarterStart(targetFrom)) !== targetFrom) return false;
      if (Math.min(to, quarterEnd(targetTo)) !== targetTo) return false;
    }
    return true;
  } catch {
    return false;
  }
}
