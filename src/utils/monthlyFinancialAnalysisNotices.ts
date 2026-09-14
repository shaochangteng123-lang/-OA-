import type {
  FinancialAnalysisModule,
  FinancialAnalysisQuery,
  FinancialAnalysisValue,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";

export interface FinancialAnalysisNotice {
  key: string;
  message: string;
  scopeLabel: string;
  kind: "review" | "information";
}

export interface FinancialAnalysisNotices {
  items: FinancialAnalysisNotice[];
  primary: FinancialAnalysisNotice | null;
  hasReview: boolean;
  undatedBusinessNote: string;
}

/** 只把实际缺项或核对障碍标成待核对；一般统计口径与权限说明不是数据错误。 */
export function financialAnalysisNoticeKind(
  message: string,
): FinancialAnalysisNotice["kind"] {
  if (
    /^公共费用仅按已核验票款分配|^年度总额按自然年已录入费用汇总/u.test(message)
  )
    return "information";
  if (
    /^(?:缺失|未知)(?:数据|金额|月份)(?:不按零处理|不会按零处理|不补零)[。；]?$/u.test(
      message,
    )
  )
    return "information";
  if (/全历史日期诊断|已付款但缺少付款业务日期/u.test(message)) return "review";
  if (
    /仅.*(?:管理员|权限)|(?:不使用|不套用).*(?:甲方|合同区域).*筛选|服务对象文本不视为|不重复增加|不重复计入/u.test(
      message,
    ) &&
    !/缺少|缺失|冲突|不一致|无法核对/u.test(message)
  )
    return "information";
  return /缺少|缺失|缺月|未提供|未记录|待核对|待复核|尚未|未核验|无法|不一致|不闭合|断裂|冲突|不完整|不可用|失败|无效|非人民币|不支持的币种|未具备|币种.{0,8}(?:为空|缺|未知)|没有.*(?:凭证|来源|名单|分项)|(?:合计|总额|金额|余额|成本|分类|分项|行政区|归属).{0,12}(?:保持未知|为未知|归未知|显示未知)/u.test(
    message,
  )
    ? "review"
    : "information";
}

/** 仅识别服务端明确命名的已知部分，不把正常期末余额或其他总额改成部分金额。 */
export function isKnownPartialAnalysisValue(
  value: FinancialAnalysisValue,
): boolean {
  return (
    /^known(?:Total|Amount|Subtotal)$/u.test(value.key) ||
    /已知|部分/u.test(value.label)
  );
}

function rangeLabel(query: FinancialAnalysisQuery): string {
  return `${query.from} 至 ${query.to}`;
}
function sameQuery(
  left: FinancialAnalysisQuery,
  right: FinancialAnalysisQuery,
): boolean {
  return (
    [
      "from",
      "to",
      "granularity",
      "comparisonYear",
      "partyA",
      "contractRegion",
      "reimbursementScope",
      "personId",
    ] as const
  ).every((key) => left[key] === right[key]);
}
function fullHistoryWarning(message: string): boolean {
  return /全历史日期诊断|已付款但缺少付款业务日期/u.test(message);
}
function businessPaymentDateWarning(message: string): boolean {
  return (
    /商务报销/u.test(message) && /付款业务日期|实际付款日期/u.test(message)
  );
}
function quantifiedBusinessDateWarning(message: string): boolean {
  return (
    fullHistoryWarning(message) &&
    businessPaymentDateWarning(message) &&
    /\d+笔/u.test(message)
  );
}

/** 展示既有受保护响应的提示，不计算金额、不猜测缺日期记录属于哪个月或模块。 */
export function buildMonthlyFinancialAnalysisNotices(
  data: MonthlyFinancialAnalysisData,
  module: FinancialAnalysisModule,
  history: MonthlyFinancialAnalysisData | null = null,
  visibleWindow: { from: string; to: string } | null = null,
): FinancialAnalysisNotices {
  const items: FinancialAnalysisNotice[] = [];
  const seen = new Set<string>();
  const add = (messages: string[], scope: string, global = false) => {
    for (const raw of messages) {
      const message = raw.trim();
      if (!message) continue;
      const kind = financialAnalysisNoticeKind(message);
      // 通用口径仍在顶部既有说明内，不在每个模块重复铺陈。
      if (global && kind === "information") continue;
      const scopeLabel = fullHistoryWarning(message)
        ? "全历史来源诊断 · 不代表当前期间笔数"
        : scope;
      const key = scopeLabel + ":" + message;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ key, message, scopeLabel, kind });
    }
  };
  add(module.warnings, `统计响应 · ${rangeLabel(data.query)}`);
  add(data.warnings, "全局来源诊断 · 不作为期间合计", true);
  const comparison = data.comparison;
  if (comparison) {
    add(
      comparison.modules.find((item) => item.key === module.key)?.warnings ||
        [],
      `对比统计响应 · ${rangeLabel(comparison.query)}`,
    );
    add(comparison.warnings, "对比来源诊断 · 不作为期间合计", true);
  }
  if (history && !sameQuery(history.query, data.query)) {
    const scope = `图表加载数据 · ${rangeLabel(history.query)}（含缓冲；当前可见 ${visibleWindow ? `${visibleWindow.from} 至 ${visibleWindow.to}` : "区间未确定"}）`;
    add(
      history.modules.find((item) => item.key === module.key)?.warnings || [],
      scope,
    );
    add(history.warnings, scope + " · 全局来源诊断", true);
    if (history.comparison) {
      const earlier = `对比图表加载数据 · ${rangeLabel(history.comparison.query)}（含缓冲，不等于当前统计期间）`;
      add(
        history.comparison.modules.find((item) => item.key === module.key)
          ?.warnings || [],
        earlier,
      );
      add(history.comparison.warnings, earlier + " · 全局来源诊断", true);
    }
  }
  // 仅当前统计响应的明确部分口径可以描述当前金额；不能从其他类型、同期或缓冲告警反推。
  const currentBusinessIsPartial =
    module.key === "business" &&
    (module.summaries.some((summary) => summary.key === "knownTotal") ||
      module.series.some((series) => /已归期部分/u.test(series.label)));
  const priority = (item: FinancialAnalysisNotice) =>
    item.kind === "information"
      ? 10
      : module.key === "business" && quantifiedBusinessDateWarning(item.message)
        ? 0
        : module.key === "business" && businessPaymentDateWarning(item.message)
          ? 1
          : module.key === "projects" && /币种/u.test(item.message)
            ? 0
            : 2;
  items.sort((left, right) => priority(left) - priority(right));
  return {
    items,
    primary: items.find((item) => item.kind === "review") || null,
    hasReview: items.some((item) => item.kind === "review"),
    undatedBusinessNote: currentBusinessIsPartial
      ? "本次商务统计采用已归期部分口径，不代表完整期间总额，不能据此判断没有报销。已月结快照仍按原冻结值展示。"
      : "",
  };
}
