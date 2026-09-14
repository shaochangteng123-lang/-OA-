import type { FinancialAnalysisValue } from "@/types/monthlyFinancialAnalysis";
import { addFinancialAmountTexts } from "@/utils/monthlyFinancialReportPresentation";

/** 只排序展示副本；使用精确十进制文本比较，未知靠后，同额维持原有顺序。 */
export function sortPersonnelComparisonDescending(
  items: readonly FinancialAnalysisValue[],
): FinancialAnalysisValue[] {
  const known = (value: string | null) =>
    typeof value === "string" && /^[+-]?\d+(?:\.\d+)?$/u.test(value.trim());
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftKnown = known(left.item.amount),
        rightKnown = known(right.item.amount);
      if (!leftKnown || !rightKnown)
        return leftKnown ? -1 : rightKnown ? 1 : left.index - right.index;
      const rightAmount = right.item.amount!.trim();
      const opposite = rightAmount.startsWith("-")
        ? rightAmount.slice(1)
        : `-${rightAmount.replace(/^\+/u, "")}`;
      const difference = addFinancialAmountTexts(left.item.amount!, opposite);
      return difference === "0"
        ? left.index - right.index
        : difference.startsWith("-")
          ? 1
          : -1;
    })
    .map(({ item }) => item);
}
