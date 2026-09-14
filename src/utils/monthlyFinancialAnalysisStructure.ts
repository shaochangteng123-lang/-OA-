import type {
  FinancialAnalysisDetail,
  FinancialAnalysisModule,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  FinancialAnalysisValue,
} from "@/types/monthlyFinancialAnalysis";
import { addFinancialAmountTexts } from "@/utils/monthlyFinancialReportPresentation";

export interface FinancialAnalysisStructure {
  items: FinancialAnalysisValue[];
  scopeLabel: string;
  note: string;
  isPartial: boolean;
  disabledReason?: string;
}

const ACCOUNT_LABELS: Record<string, string> = {
  general: "一般账户",
  business: "商务账户",
  welfare_one: "福利金账户一",
  welfare_two: "福利金账户二",
};
const COST_KEYS = new Set([
  "salary",
  "social",
  "housing",
  "adjustment",
  "basic",
  "large",
  "business",
  "overhead",
]);

function knownAmount(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text && /^[+-]?\d+(?:\.\d+)?$/u.test(text) ? text : null;
}

function negativeAmount(value: string | null): boolean {
  return !!value?.startsWith("-") && !/^-0+(?:\.0+)?$/u.test(value);
}

function copyValue(value: FinancialAnalysisValue): FinancialAnalysisValue {
  return { ...value, amount: knownAmount(value.amount) };
}

function monthKey(value: string | null | undefined): string | null {
  const match = value?.match(
    /^(\d{4}-(?:0[1-9]|1[0-2]))(?:$|-\d{2}(?:T.*)?$)/u,
  );
  return match?.[1] || null;
}

function periodInQuery(
  period: FinancialAnalysisPeriod,
  query: FinancialAnalysisQuery,
): boolean {
  const from = monthKey(period.from);
  const to = monthKey(period.to);
  return !!from && !!to && from <= to && from >= query.from && to <= query.to;
}

function detailInQuery(
  detail: FinancialAnalysisDetail,
  module: FinancialAnalysisModule,
  query: FinancialAnalysisQuery,
): boolean {
  const period = module.periods.find(
    (candidate) =>
      candidate.key === detail.period || candidate.label === detail.period,
  );
  if (period) return periodInQuery(period, query);
  const month = monthKey(detail.month) || monthKey(detail.date);
  return !!month && month >= query.from && month <= query.to;
}

function baseStructure(
  module: FinancialAnalysisModule,
  query: FinancialAnalysisQuery,
): FinancialAnalysisStructure {
  const items = module.breakdown.map(copyValue);
  const isPartial = items.some(
    (item) => item.amount === null || negativeAmount(item.amount),
  );
  return {
    items,
    scopeLabel:
      module.key === "balances"
        ? `${query.to} 期末账户构成`
        : `${query.from} 至 ${query.to} · 所选期间构成`,
    note: isPartial
      ? "构成包含未知或负金额；若展示占比，仅以已知正金额为分母，未知及负金额单列，不代表完整总额。"
      : "使用当前查询返回的分类金额；结构展示不改写统计摘要与来源明细。",
    isPartial,
  };
}

function recentBalanceStructure(
  module: FinancialAnalysisModule,
  query: FinancialAnalysisQuery,
): FinancialAnalysisStructure | null {
  // 同一时点取四账户；绝不把合计再算一次，也不为不同账户拼接不同月份。
  const accounts = Object.entries(ACCOUNT_LABELS).map(([key, label]) => ({
    key,
    label: module.breakdown.find((item) => item.key === key)?.label || label,
    series: module.series.find((series) => series.key === key),
  }));
  const candidates = module.periods
    .map((period, index) => ({ period, index }))
    .filter(({ period }) => periodInQuery(period, query))
    .sort((left, right) => right.period.to.localeCompare(left.period.to));
  for (const { period, index } of candidates) {
    const items = accounts.map(({ key, label, series }) => ({
      key,
      label,
      amount: knownAmount(series?.values[index]),
    }));
    if (!items.some((item) => item.amount !== null)) continue;
    const isEarlier = monthKey(period.to) !== query.to;
    return {
      items,
      scopeLabel: isEarlier
        ? `${period.to} 期末账户构成（所选范围内最近已知时点，非所选期末 ${query.to}）`
        : `${period.to} 期末已知序列构成（仅结构补充）`,
      note: "部分口径：仅引用上述同一时点已知的账户序列，未知及负金额仍保留；占比仅表示该时点已知正余额构成，不替代所选期末摘要，也不跨出所选查询范围。",
      isPartial: true,
    };
  }
  return null;
}

interface DetailGroup {
  key: string;
  label: string;
  known: string | null;
  unknown: boolean;
}

function knownDetailStructure(
  module: FinancialAnalysisModule,
  query: FinancialAnalysisQuery,
): FinancialAnalysisStructure | null {
  if (!["outflow", "business", "personnel"].includes(module.key)) return null;
  const groups = new Map<string, DetailGroup>();
  const add = (key: string, label: string, raw: string | null | undefined) => {
    const group = groups.get(key) || {
      key,
      label,
      known: null,
      unknown: false,
    };
    const amount = knownAmount(raw);
    if (amount === null) group.unknown = true;
    else
      group.known =
        group.known === null
          ? amount
          : addFinancialAmountTexts(group.known, amount);
    groups.set(key, group);
  };
  const costColumns = module.columns.filter(
    (column) => column.format === "amount" && COST_KEYS.has(column.key),
  );
  for (const detail of module.details) {
    // 明细必须已有来源编号及可定位的期间，不能把年度总额、无主分摊或范围外数据拿来补图。
    if (!detail.sourceId?.trim() || !detailInQuery(detail, module, query))
      continue;
    if (module.key === "personnel") {
      if (detail.personId !== query.personId) continue;
      for (const column of costColumns)
        add(column.key, column.label, detail[column.key]);
      continue;
    }
    if (
      module.key === "business" &&
      query.reimbursementScope &&
      detail.scope !== query.reimbursementScope
    )
      continue;
    const label =
      module.key === "outflow"
        ? detail.category?.trim() || "未标注支出分类"
        : detail.scope?.trim() || "未标注／历史范围未知";
    const original = module.breakdown.find(
      (item) => item.label === label || item.key === label,
    );
    add(
      original?.key || `${module.key}:detail:${label}`,
      original?.label || label,
      detail.amount,
    );
  }
  if (![...groups.values()].some((group) => group.known !== null)) return null;

  const items: FinancialAnalysisValue[] = [];
  const appended = new Set<string>();
  const appendGroup = (
    group: DetailGroup,
    original?: FinancialAnalysisValue,
  ) => {
    appended.add(group.key);
    items.push({
      ...(original || { key: group.key, label: group.label }),
      amount: group.known,
      note:
        group.known === null
          ? "存在未知明细金额，不按零处理。"
          : "仅合计可核验的已知明细；正负金额按原符号相加，不代表该分类完整金额。",
    });
    if (group.unknown && group.known !== null) {
      items.push({
        key: `${group.key}:unknown-details`,
        label: `${group.label}（未知明细）`,
        amount: null,
        note: "本分类另有未知明细，未纳入已知小计。",
      });
    }
  };
  for (const original of module.breakdown) {
    const group = groups.get(original.key);
    if (group) appendGroup(group, original);
    else items.push(copyValue(original));
  }
  for (const group of groups.values())
    if (!appended.has(group.key)) appendGroup(group);
  return {
    items,
    scopeLabel: `${query.from} 至 ${query.to} · 已知明细构成（部分口径）`,
    note: "部分口径：仅按所选范围内已有来源编号的明细精确汇总；缺月、未知项与负金额不会变成零或绝对值，占比仅以已知正金额为分母。此构成不代表完整期间总额，不替代原摘要、明细或年度金额。",
    isPartial: true,
  };
}

/** 人员分项按同一已提交期间累计；已知金额不因其他来源缺口而被整项遮住。 */
function personnelKnownStructure(
  module: FinancialAnalysisModule,
  query: FinancialAnalysisQuery,
  includeAllPersonnel = false,
): FinancialAnalysisStructure | null {
  const rows = module.details.filter(
    (row) =>
      (row.personId === query.personId ||
        (includeAllPersonnel && !query.personId && Boolean(row.personId))) &&
      detailInQuery(row, module, query),
  );
  if (
    !rows.some((row) =>
      Object.prototype.hasOwnProperty.call(row, "known_payrollCost"),
    )
  )
    return null;
  const groups = new Map<
    string,
    { label: string; amount: string | null; partial: boolean }
  >();
  const wageKeys = ["salary", "social", "housing", "adjustment"];
  const costKeys = ["basic", "large", "business", "overhead"];
  const allowed = new Set(module.columns.map((column) => column.key));
  const labelFor = (key: string) =>
    module.columns.find((column) => column.key === key)?.label || key;
  let isPartial = false;
  let hasUnsplitWages = false;
  const add = (
    key: string,
    label: string,
    raw: string | null,
    partial: boolean,
  ) => {
    const group = groups.get(key) || { label, amount: null, partial: false };
    if (raw !== null)
      group.amount =
        group.amount === null
          ? raw
          : addFinancialAmountTexts(group.amount, raw);
    group.partial ||= partial;
    groups.set(key, group);
    isPartial ||= partial || negativeAmount(raw);
  };
  for (const row of rows) {
    const amountFor = (key: string) =>
      knownAmount(row[key]) ?? knownAmount(row[`known_${key}`]);
    const wages = amountFor("payrollCost");
    const wagePartsKnown =
      wageKeys.every((key) => allowed.has(key) && amountFor(key) !== null) &&
      wages !== null &&
      wageKeys.reduce(
        (total, key) => addFinancialAmountTexts(total, amountFor(key)!),
        "0",
      ) === addFinancialAmountTexts("0", wages);
    if (wagePartsKnown) {
      for (const key of wageKeys)
        add(key, labelFor(key), amountFor(key), knownAmount(row[key]) === null);
    } else if (allowed.has("payrollCost")) {
      // 旧月结只冻结工资总额时保留整笔，不把未知拆分与该总额重复计入饼图。
      add("payrollUnsplit", "工资总成本（分项未确认）", wages, true);
      hasUnsplitWages = true;
    }
    for (const key of costKeys) {
      if (!allowed.has(key)) continue;
      add(key, labelFor(key), amountFor(key), knownAmount(row[key]) === null);
    }
  }
  const items = [...groups].map(([key, group]) => ({
    key,
    label: group.label,
    amount: group.amount,
    ...(group.partial
      ? { note: "仅合计可核验的已知费用，未确认部分不按零处理。" }
      : {}),
  }));
  return {
    items,
    scopeLabel: `${query.from} 至 ${query.to} · 所选人员${isPartial ? "已知" : ""}成本构成`,
    isPartial,
    note: `${isPartial ? "已知分项与人员明细采用同一期间、同一来源；未确认部分不按零处理，当前占比不代表完整成本。" : "分项与人员明细采用同一期间、同一来源，工资总额不与工资及公司缴费分项重复计算。"}${hasUnsplitWages ? "分项未确认的工资以原工资总成本单列，不反推社保或公积金。" : ""}`,
    ...(!items.some((item) => item.amount !== null)
      ? { disabledReason: "所选期间没有可核验的人员成本构成。" }
      : {}),
  };
}

/** 提供明确标记口径的结构展示数据；不修改服务端摘要，也不推导未经授权的工资分项。 */
export function buildFinancialAnalysisStructure(
  module: FinancialAnalysisModule,
  query: FinancialAnalysisQuery,
  options: { includeAllPersonnel?: boolean } = {},
): FinancialAnalysisStructure {
  const base = baseStructure(module, query);
  if (
    module.key === "personnel" &&
    !query.personId &&
    !options.includeAllPersonnel
  ) {
    return {
      ...base,
      items: [],
      isPartial: false,
      disabledReason: "请先选择一位人员并查询，再查看该人员的成本构成。",
    };
  }
  if (module.key === "personnel" && module.payrollDetailsVisible === false) {
    return {
      ...base,
      items: [],
      isPartial: false,
      disabledReason:
        "当前账号无工资分项查看权限，不能生成个人成本构成；不从授权总成本反推工资分项。",
    };
  }
  if (module.key === "personnel") {
    const personnel = personnelKnownStructure(
      module,
      query,
      options.includeAllPersonnel,
    );
    if (personnel) return personnel;
    if (options.includeAllPersonnel)
      return {
        ...base,
        items: [],
        isPartial: true,
        disabledReason:
          "所选期间未返回可核验的人员分项，不使用整个统计期间构成代替。",
      };
  }
  if (base.items.some((item) => item.amount !== null)) return base;
  const supplement =
    module.key === "balances"
      ? recentBalanceStructure(module, query)
      : knownDetailStructure(module, query);
  return (
    supplement || {
      ...base,
      isPartial: true,
      note: "所选范围内没有可核验的已知构成金额；未知数据不按零填充，也不从总额反推分类。",
      disabledReason: "所选范围内暂无可展示的已知金额构成。",
    }
  );
}
