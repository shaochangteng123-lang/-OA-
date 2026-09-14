import type { FinancialAnalysisModule } from "@/types/monthlyFinancialAnalysis";

const filteredSeries = new WeakMap<
  FinancialAnalysisModule["series"],
  FinancialAnalysisModule["series"]
>();

/** 仅过滤折线可选指标；权威合计仍供账户核对与饼图中心使用，不能与分类再次相加。 */
export function visibleFinancialChartModule(
  module: FinancialAnalysisModule,
): FinancialAnalysisModule {
  // 老接口没有指标清单时保留旧响应兼容；新接口明确给出五类白名单。
  if (module.key !== "outflow" || !module.chartMetricKeys) return module;
  const selected = module.chartMetricKeys.flatMap((key) => {
    const series = module.series.find((item) => item.key === key);
    return series ? [series] : [];
  });
  const previous = filteredSeries.get(module.series);
  const stable =
    previous &&
    previous.length === selected.length &&
    previous.every((series, index) => series === selected[index])
      ? previous
      : selected;
  filteredSeries.set(module.series, stable);
  return {
    ...module,
    series: stable,
  };
}
