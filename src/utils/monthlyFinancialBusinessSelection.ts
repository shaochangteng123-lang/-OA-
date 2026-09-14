import type {
  FinancialAnalysisDetail,
  FinancialAnalysisModule,
  FinancialAnalysisValue,
} from "@/types/monthlyFinancialAnalysis";
import type { FinancialAnalysisPointSelection } from "@/types/monthlyFinancialAnalysisChart";
import { addFinancialAmountTexts } from "@/utils/monthlyFinancialReportPresentation";
import { knownDrilldownAmount } from "@/utils/monthlyFinancialAnalysisDrilldown";

export interface FinancialBusinessSelectionView {
  total: string | null;
  items: FinancialAnalysisValue[];
  scopeLabel: string;
  note: string;
  complete: boolean;
}
const normalize = (value: unknown) => {
  const text = knownDrilldownAmount(value);
  return text === null ? null : addFinancialAmountTexts(text, "0");
};
function sourceMonth(row: FinancialAnalysisDetail): string | null {
  if (row.date) {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])-\d{2}$/u.test(row.date)) return null;
    const date = new Date(`${row.date}T00:00:00Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== row.date
    )
      return null;
    const month = row.date.slice(0, 7);
    return !row.month || row.month === month ? month : null;
  }
  return row.month && /^\d{4}-(?:0[1-9]|1[0-2])$/u.test(row.month)
    ? row.month
    : null;
}

/** 只从已加载的所选真实期间取分类，权威总额沿用同一折线点；不请求或改写业务数据。 */
export function buildFinancialBusinessSelection(
  module: FinancialAnalysisModule | undefined,
  selection: FinancialAnalysisPointSelection,
): FinancialBusinessSelectionView {
  const from = selection.from || selection.month;
  const to = selection.to || selection.month;
  const prefix = selection.comparison ? "对比期 · " : "";
  const unknown = (): FinancialBusinessSelectionView => ({
    total: null,
    items: [],
    scopeLabel: `${prefix}${from} 至 ${to}`,
    note: "未取得对应期间的商务数据",
    complete: false,
  });
  if (module?.key !== "business" || selection.metricKey !== "business")
    return unknown();
  const matches = module.periods
    .map((period, index) => ({ period, index }))
    .filter(
      ({ period }) =>
        period.from === from &&
        period.to === to &&
        (!selection.periodKey || period.key === selection.periodKey),
    );
  if (matches.length !== 1) return unknown();
  const { period, index } = matches[0];
  const total = normalize(
    module.series.find((series) => series.key === "business")?.values[index],
  );
  if (total === null) return unknown();
  const groups = new Map<string, { amount: string | null }>();
  const seen = new Map<string, string>();
  let invalid = false;
  for (const row of module.details) {
    const month = sourceMonth(row);
    if (!month) {
      invalid = true;
      continue;
    }
    if (month < from || month > to) continue;
    const scope =
      row.scopePath?.trim() ||
      row.scope?.trim() ||
      row.region?.trim() ||
      "行政区未知";
    const amount = normalize(row.amount);
    const id = row.sourceId?.trim() || row.id?.trim();
    if (!id) {
      invalid = true;
      continue;
    }
    const fingerprint = JSON.stringify([row.date || month, scope, amount]);
    if (seen.has(id)) {
      if (seen.get(id) !== fingerprint) invalid = true;
      continue;
    }
    seen.set(id, fingerprint);
    const group = groups.get(scope) || { amount: "0" };
    group.amount =
      group.amount === null || amount === null
        ? null
        : addFinancialAmountTexts(group.amount, amount);
    groups.set(scope, group);
  }
  const items = [...groups].map(([scope, group]) => ({
    key: scope,
    label: scope,
    amount: group.amount,
  }));
  const sum = items.every((item) => item.amount !== null)
    ? items.reduce(
        (sum, item) => addFinancialAmountTexts(sum, item.amount!),
        "0",
      )
    : null;
  const complete = !invalid && sum === total;
  // 来源冲突时保持选中总额，不用互相冲突的分类画占比。
  if (invalid) for (const item of items) item.amount = null;
  return {
    total,
    items,
    scopeLabel: `${prefix}${period.label}${from === to ? "" : `（${from} 至 ${to}）`} · 商务报销`,
    note: complete
      ? ""
      : "当前分类明细未完全对应所选金额，分类仅作已知部分展示。",
    complete,
  };
}
