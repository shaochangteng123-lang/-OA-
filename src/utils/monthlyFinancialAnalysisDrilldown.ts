import type {
  FinancialAnalysisDetail,
  FinancialAnalysisModule,
  FinancialAnalysisProjectReceipt,
  FinancialAnalysisValue,
} from "@/types/monthlyFinancialAnalysis";
import {
  addFinancialAmountTexts,
  formatMonthlyFinancialAmount,
} from "@/utils/monthlyFinancialReportPresentation";

const outflowCategories = [
  { key: "administration", label: "行政支出" },
  { key: "salary", label: "薪资支出（含公司社保公积金）" },
  { key: "other", label: "一般账户跨行手续费" },
  { key: "tax", label: "实际税费支出" },
  { key: "business", label: "业务支出" },
  { key: "asset", label: "资产类合同支出" },
];

export function knownDrilldownAmount(value: unknown): string | null {
  return typeof value === "string" && /^[+-]?\d+(?:\.\d+)?$/u.test(value.trim())
    ? value.trim()
    : null;
}

export function formatDrilldownAmount(value: unknown): string {
  const amount = knownDrilldownAmount(value);
  if (amount === null) return "未知";
  return formatMonthlyFinancialAmount(
    addFinancialAmountTexts(amount, "0") === "0" ? "0" : amount,
  );
}

/** 合计只使用十进制字符串；任何一个来源未知，完整合计就仍然未知。 */
export function sumDrilldownAmounts(values: unknown[]): string | null {
  const amounts = values.map(knownDrilldownAmount);
  if (amounts.some((amount) => amount === null)) return null;
  return amounts.reduce<string>(
    (sum, amount) => addFinancialAmountTexts(sum, amount!),
    "0",
  );
}
function sumKnownDrilldownAmounts(values: unknown[]): string | null {
  const amounts = values
    .map(knownDrilldownAmount)
    .filter((amount): amount is string => amount !== null);
  return amounts.length
    ? amounts.reduce<string>(
        (sum, amount) => addFinancialAmountTexts(sum, amount),
        "0",
      )
    : null;
}

export interface MonthlyFinancialOutflowStructureData {
  items: FinancialAnalysisValue[];
  total: string | null;
  scopeLabel: string;
  note: string;
  month: string | null;
  totalLabel: string;
  comparableToTotal: boolean;
}

/** 单月只使用同月序列；默认期间使用后端分类及权威汇总，绝不由分类猜测总支出。 */
export function buildMonthlyOutflowStructure(
  module: FinancialAnalysisModule | undefined,
  month?: string | null,
  comparison = false,
): MonthlyFinancialOutflowStructureData {
  const prefix = comparison ? "对比期 · " : "";
  const valid = !!month && /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/u.test(month);
  const source = module?.key === "outflow" ? module : undefined;
  const index = valid
    ? (source?.periods.findIndex(
        (period) => period.from === month && period.to === month,
      ) ?? -1)
    : -1;
  const isMonthly = month !== undefined && month !== null;
  const items = outflowCategories
    .filter(
      (category) =>
        category.key !== "business" ||
        source?.series.some((series) => series.key === "business"),
    )
    .map((category) => {
      const series = isMonthly
        ? source?.series.find((item) => item.key === category.key)
        : undefined;
      const breakdown = !isMonthly
        ? source?.breakdown.find((item) => item.key === category.key)
        : undefined;
      const item = series || breakdown;
      const knownValue = index >= 0 ? series?.knownValues?.[index] : null;
      const partial = isMonthly
        ? index >= 0 && series?.partial?.[index] === true
        : Boolean(breakdown?.note);
      return {
        key: category.key,
        label:
          (item?.label || category.label) + (partial ? "（已知部分）" : ""),
        amount: knownDrilldownAmount(
          isMonthly
            ? index >= 0 && series
              ? (series.values[index] ?? knownValue)
              : null
            : breakdown?.amount,
        ),
      };
    });
  const categoryTotalSeries = source?.series.find(
    (series) => series.key === "categoryTotal",
  );
  const hasCategoryTotal = Boolean(categoryTotalSeries);
  const total = knownDrilldownAmount(
    hasCategoryTotal
      ? isMonthly
        ? index >= 0
          ? categoryTotalSeries?.values[index]
          : null
        : sumKnownDrilldownAmounts(categoryTotalSeries?.values || [])
      : isMonthly
        ? index >= 0
          ? source?.series.find((series) => series.key === "total")?.values[
              index
            ]
          : null
        : source?.summaries.find((summary) => summary.key === "total")?.amount,
  );
  const scopeLabel = isMonthly
    ? `${prefix}${valid ? month : "月份无效"}支出构成`
    : `${prefix}${source?.periods.length ? `${source.periods[0].from} 至 ${source.periods.at(-1)!.to}` : "所选统计期间"}支出构成`;
  const missing = isMonthly && index < 0;
  const totalPartial = isMonthly
    ? index >= 0 && categoryTotalSeries?.partial?.[index] === true
    : categoryTotalSeries?.partial?.some(Boolean) === true;
  const mixedBasis =
    source?.outflowReimbursementBasis === "reimbursement-month";
  return {
    items,
    total,
    scopeLabel,
    month: !missing && valid ? month! : null,
    totalLabel: hasCategoryTotal
      ? totalPartial
        ? "已知分类总金额"
        : "总金额"
      : mixedBasis
        ? "银行实际支出"
        : "总支出",
    comparableToTotal: hasCategoryTotal || !mixedBasis,
    note: missing
      ? "没有该月份的独立月度序列，不以季度、年度或其他月份金额代替；总支出保持未知。"
      : hasCategoryTotal
        ? "圆心总金额与折线使用同期间五类指标的精确已知合计；未知分类不按零计算，银行实际支出保留在上方摘要单独核对。"
        : mixedBasis
          ? "行政支出按报销月份，中心为一般账户银行实际支出；两个时间口径不要求月度闭合，也不以分类合计反推银行余额。"
          : "总支出采用一般账户权威合计，分类未知不按零处理，也不从分类推算总额。",
  };
}

export interface ProjectPeriodSelection {
  from: string;
  to: string;
  periodKey?: string;
  comparison?: boolean;
  metricKey?: "received" | "periodReceived";
}

export interface ProjectPeriodDetails {
  rows: FinancialAnalysisDetail[];
  receipts: FinancialAnalysisProjectReceipt[];
  total: string | null;
  scopeLabel: string;
  note: string;
}

/** 季度、年度点选沿用对应响应的分类，只读所选期间，不能标成单月。 */
export function buildPeriodOutflowStructure(
  module: FinancialAnalysisModule | undefined,
  selection: ProjectPeriodSelection,
): MonthlyFinancialOutflowStructureData {
  const source = module?.key === "outflow" ? module : undefined;
  const index =
    source?.periods.findIndex((period) =>
      selection.periodKey
        ? period.key === selection.periodKey
        : period.from === selection.from && period.to === selection.to,
    ) ?? -1;
  const period = source?.periods[index];
  const items = outflowCategories
    .filter(
      (category) =>
        category.key !== "business" ||
        source?.series.some((series) => series.key === "business"),
    )
    .map((category) => {
      const series = source?.series.find((value) => value.key === category.key);
      const partial = index >= 0 && series?.partial?.[index] === true;
      return {
        ...category,
        label:
          (series?.label || category.label) + (partial ? "（已知部分）" : ""),
        amount: knownDrilldownAmount(
          index < 0
            ? null
            : (series?.values[index] ?? series?.knownValues?.[index]),
        ),
      };
    });
  const categoryTotal = source?.series.find(
    (series) => series.key === "categoryTotal",
  );
  const hasCategoryTotal = Boolean(categoryTotal);
  const totalPartial = index >= 0 && categoryTotal?.partial?.[index] === true;
  return {
    items,
    total: knownDrilldownAmount(
      index < 0
        ? null
        : hasCategoryTotal
          ? categoryTotal?.values[index]
          : source?.series.find((series) => series.key === "total")?.values[
              index
            ],
    ),
    scopeLabel: `${selection.comparison ? "对比期 · " : ""}${period ? `${period.label}（${period.from} 至 ${period.to}）` : `${selection.from} 至 ${selection.to}`}支出构成`,
    month: period?.from === period?.to ? period?.to || null : null,
    totalLabel: hasCategoryTotal
      ? totalPartial
        ? "已知分类总金额"
        : "总金额"
      : source?.outflowReimbursementBasis === "reimbursement-month"
        ? "银行实际支出"
        : "总支出",
    comparableToTotal:
      hasCategoryTotal ||
      source?.outflowReimbursementBasis !== "reimbursement-month",
    note: period
      ? hasCategoryTotal
        ? "圆心总金额与折线使用所选期间五类指标的精确已知合计；未知分类不按零计算，银行实际支出仍在上方摘要单独核对。"
        : source?.outflowReimbursementBasis === "reimbursement-month"
          ? "行政支出按报销月份，中心为一般账户银行实际支出；两个时间口径不要求月度闭合。"
          : "总支出采用同一期一般账户权威合计，分类未知不按零处理。"
      : "未取得指定统计期间的独立支出序列；不回退到其他期间，分类与总支出保持未知。",
  };
}

/** 累计和本期回款分别读取同名权威序列，只选一个明确期间，不互相推算。 */
export function buildProjectPeriodDetails(
  module: FinancialAnalysisModule | undefined,
  selection: ProjectPeriodSelection,
): ProjectPeriodDetails {
  const prefix = selection.comparison ? "对比期 · " : "";
  const isPeriod = selection.metricKey === "periodReceived";
  const metricKey = isPeriod ? "periodReceived" : "received";
  const source = module?.key === "projects" ? module : undefined;
  const periods = source?.periods || [];
  const index = periods.findIndex((period) =>
    selection.periodKey
      ? period.key === selection.periodKey
      : period.to === selection.to &&
        (isPeriod
          ? period.from === selection.from
          : period.from >= selection.from),
  );
  const period = periods[index];
  if (!source || !period)
    return {
      rows: [],
      receipts: [],
      total: null,
      scopeLabel: `${prefix}${selection.from} 至 ${selection.to}`,
      note: isPeriod
        ? "未取得明确所选期间的实际回款明细；不使用累计回款或其他期间金额补齐。"
        : "未取得对应截止期间的项目明细；不使用其他期间累计回款补齐。",
    };
  const rows = source.details.filter((row) => {
    const keyMatches = row.periodKey
      ? row.periodKey === period.key
      : row.period === period.key || row.period === period.label;
    return (
      keyMatches &&
      (isPeriod || row.detailKind !== "period_receipt_only") &&
      (!row.from || row.from === period.from) &&
      (!row.to || row.to === period.to) &&
      (!row.periodFrom || row.periodFrom === period.from) &&
      (!row.periodTo || row.periodTo === period.to)
    );
  });
  const unique = uniqueProjectDrilldownRows(rows);
  const projectIds = new Set(unique.map((row) => row.sourceId).filter(Boolean));
  const receipts =
    isPeriod && Array.isArray(source.projectReceipts)
      ? source.projectReceipts.filter((receipt) => {
          if (
            !receipt ||
            !projectIds.has(receipt.rootContractId) ||
            receipt.periodKey !== period.key ||
            receipt.from !== period.from ||
            receipt.to !== period.to ||
            typeof receipt.receiptDate !== "string" ||
            !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(
              receipt.receiptDate,
            )
          )
            return false;
          const date = new Date(`${receipt.receiptDate}T00:00:00Z`);
          const month = receipt.receiptDate.slice(0, 7);
          return (
            Number.isFinite(date.getTime()) &&
            date.toISOString().slice(0, 10) === receipt.receiptDate &&
            month >= period.from &&
            month <= period.to
          );
        })
      : [];
  return {
    rows: unique,
    receipts,
    total: knownDrilldownAmount(
      source.series.find((series) => series.key === metricKey)?.values[index],
    ),
    scopeLabel: isPeriod
      ? `${prefix}${period.label} · ${period.from} 至 ${period.to} ${period.from === period.to ? "本月回款" : "本期回款"}`
      : `${prefix}${period.label} · 截至 ${period.to} 期末`,
    note:
      (isPeriod
        ? "仅展示所选期间当前已确认且未冲正的实际回款，按回款业务日期归期，可能与历史冻结入账不同；不使用累计回款、合同金额或未回款推算；行政区与项目小计只汇总本期唯一来源，未知不按零处理。"
        : "按所选期末展示累计已回款，不跨月份、季度或年度相加；行政区与项目小计只汇总本期唯一来源，未知不按零处理。") +
      (unique.length < rows.length ? "同一来源编号重复记录已去重。" : ""),
  };
}

/** 同编号不是第二份项目；冲突金额保守留未知，不能随意选一份覆盖。 */
export function uniqueProjectDrilldownRows(
  rows: FinancialAnalysisDetail[],
): FinancialAnalysisDetail[] {
  const unique = new Map<string, FinancialAnalysisDetail>();
  for (const row of rows) {
    const key = row.sourceId?.trim() || row.id;
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, { ...row });
      continue;
    }
    let conflict = false;
    let periodConflict = false;
    for (const field of [
      "contract",
      "received",
      "periodReceived",
      "outstanding",
    ]) {
      const left = knownDrilldownAmount(existing[field]);
      const right = knownDrilldownAmount(row[field]);
      if (
        (left === null) !== (right === null) ||
        (left !== null &&
          right !== null &&
          addFinancialAmountTexts(left, "0") !==
            addFinancialAmountTexts(right, "0"))
      ) {
        existing[field] = null;
        conflict = true;
        if (field === "periodReceived") periodConflict = true;
      }
    }
    if ((existing.region?.trim() || "") !== (row.region?.trim() || "")) {
      existing.region = null;
      conflict = true;
      periodConflict = true;
    }
    if (
      (existing.projectNumber?.trim() || "") !==
      (row.projectNumber?.trim() || "")
    ) {
      existing.projectNumber = null;
      existing.projectNumberSource = "重复来源的项目编号不一致，待核对";
      conflict = true;
    }
    if (conflict)
      existing.sourceState = `${existing.sourceState || ""}；重复来源存在冲突，冲突字段保持未知`;
    if (periodConflict)
      existing.periodReceivedSourceState = `${existing.periodReceivedSourceState || ""}；重复来源的期间回款或行政区存在冲突，冲突字段保持未知`;
    const receiptIds = [
      ...new Set(
        [existing.periodReceivedSourceIds, row.periodReceivedSourceIds].flatMap(
          (value) =>
            value
              ?.split("、")
              .map((id) => id.trim())
              .filter(Boolean) || [],
        ),
      ),
    ];
    if (receiptIds.length)
      existing.periodReceivedSourceIds = receiptIds.join("、");
  }
  return [...unique.values()];
}

export interface ProjectDrilldownRegion {
  region: string;
  rows: FinancialAnalysisDetail[];
  contract: string | null;
  received: string | null;
  periodReceived: string | null;
  outstanding: string | null;
}

export function groupProjectDrilldownRows(
  rows: FinancialAnalysisDetail[],
): ProjectDrilldownRegion[] {
  const groups = new Map<string, FinancialAnalysisDetail[]>();
  for (const row of uniqueProjectDrilldownRows(rows)) {
    const region = row.region?.trim() || "未标注行政区";
    groups.set(region, [...(groups.get(region) || []), row]);
  }
  return [...groups.entries()].map(([region, details]) => ({
    region,
    rows: details,
    contract: sumDrilldownAmounts(details.map((row) => row.contract)),
    received: sumDrilldownAmounts(details.map((row) => row.received)),
    periodReceived: sumDrilldownAmounts(
      details.map((row) => row.periodReceived),
    ),
    outstanding: sumDrilldownAmounts(details.map((row) => row.outstanding)),
  }));
}
