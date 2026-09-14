import type { FinancialAnalysisModule } from "@/types/monthlyFinancialAnalysis";
import type { FinancialAnalysisPointSelection } from "@/types/monthlyFinancialAnalysisChart";
import { addFinancialAmountTexts } from "@/utils/monthlyFinancialReportPresentation";
import {
  buildFinancialAnalysisStructure,
  type FinancialAnalysisStructure,
} from "@/utils/monthlyFinancialAnalysisStructure";

export interface FinancialPersonnelSelectionView extends FinancialAnalysisStructure {
  total: string | null;
  totalIsPartial: boolean;
}
function known(value: unknown): string | null {
  return typeof value === "string" && /^[+-]?\d+(?:\.\d+)?$/u.test(value)
    ? value
    : null;
}
export function buildFinancialPersonnelSelection(
  module: FinancialAnalysisModule | undefined,
  selection: FinancialAnalysisPointSelection | null,
  personId?: string,
  personLabel?: string,
): FinancialPersonnelSelectionView {
  const empty: FinancialPersonnelSelectionView = {
    items: [],
    total: null,
    totalIsPartial: true,
    scopeLabel: "",
    note: "",
    isPartial: true,
    disabledReason: "请选择已有金额的人员成本点位。",
  };
  if (!module || module.key !== "personnel" || !selection) return empty;
  if (module.payrollDetailsVisible === false)
    return {
      ...empty,
      disabledReason: "当前账号没有工资分项查看权限，不能生成成本构成。",
    };
  const from = selection.from || selection.month;
  const to = selection.to || selection.month;
  const matches = module.periods
    .map((period, index) => ({ period, index }))
    .filter(
      ({ period }) =>
        period.from === from &&
        period.to === to &&
        (!selection.periodKey || selection.periodKey === period.key),
    );
  if (matches.length !== 1) return empty;
  const { period, index } = matches[0];
  if (
    known(
      module.series.find((series) => series.key === selection.metricKey)
        ?.values[index],
    ) === null
  )
    return empty;
  const structure = buildFinancialAnalysisStructure(
    module,
    {
      from,
      to,
      personId,
      granularity:
        from === to ? "month" : period.key.includes("Q") ? "quarter" : "year",
    },
    { includeAllPersonnel: true },
  );
  const total = known(
    module.series.find((series) => series.key === "total")?.values[index],
  );
  const knownTotal = known(
    module.series.find((series) => series.key === "knownTotal")?.values[index],
  );
  const range = from === to ? from : `${period.label}（${from} 至 ${to}）`;
  const effectiveTotal = total ?? knownTotal;
  const itemTotal = structure.items.reduce(
    (sum, item) =>
      known(item.amount) === null
        ? sum
        : addFinancialAmountTexts(sum, item.amount!),
    "0",
  );
  const unbalanced =
    effectiveTotal !== null &&
    structure.items.some((item) => known(item.amount) !== null) &&
    itemTotal !== addFinancialAmountTexts("0", effectiveTotal);
  return {
    ...structure,
    total: effectiveTotal,
    totalIsPartial: total === null,
    scopeLabel: `${selection.comparison ? "对比期 · " : ""}${range} · ${personId ? personLabel || "所选人员" : "全部人员"}`,
    note: `${structure.note} 点击不同指标均展示该期间的各项人力成本构成；仅切换饼图，统计表与导出仍按上方已查询期间。`,
    ...(unbalanced
      ? {
          isPartial: true,
          disabledReason:
            "所选期间成本分项与原始合计不一致，暂不计算占比；保留原金额，请核对来源。",
        }
      : {}),
  };
}
