import type {
  FinancialAnalysisDetail,
  FinancialAnalysisModule,
  FinancialAnalysisValue,
} from "@/types/monthlyFinancialAnalysis";
import {
  addFinancialAmountTexts,
  formatMonthlyFinancialAmount,
} from "@/utils/monthlyFinancialReportPresentation";

export interface MonthlyFinancialBalanceStructure {
  items: FinancialAnalysisValue[];
  total: string | null;
  scopeLabel: string;
  note: string;
  month: string | null;
}

const ACCOUNTS = [
  { key: "general", label: "一般账户" },
  { key: "business", label: "商务账户" },
  { key: "welfare_one", label: "福利金账户一" },
  { key: "welfare_two", label: "福利金账户二" },
] as const;
type AccountCode = (typeof ACCOUNTS)[number]["key"];
const MONTH_PATTERN = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/u;

function validMonth(month: unknown): month is string {
  return typeof month === "string" && MONTH_PATTERN.test(month);
}

function knownAmount(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[+-]?\d+(?:\.\d+)?$/u.test(text) ? text : null;
}

function emptyItems(): FinancialAnalysisValue[] {
  return ACCOUNTS.map((account) => ({ ...account, amount: null }));
}

function exactTotal(items: FinancialAnalysisValue[]): string | null {
  if (items.some((item) => knownAmount(item.amount) === null)) return null;
  // 加法工具对非法输入会保留左值，因此必须先验证全部四项，不能静默跳过未知项。
  return items.reduce(
    (total, item) => addFinancialAmountTexts(total, item.amount!),
    "0",
  );
}

function amountNote(
  items: FinancialAnalysisValue[],
  total: string | null,
): string {
  if (total === null)
    return "同一月份的四账户余额不完整，合计保持未知，不从总金额反推或拼接其他月份。";
  const isZero = (value: string) => /^[+-]?0+(?:\.0+)?$/u.test(value);
  if (
    items.some((item) => item.amount!.startsWith("-") && !isZero(item.amount!))
  )
    return "同月四账户余额按原符号精确求和；存在负余额，不取绝对值或删除负数生成完整账户占比。";
  if (items.every((item) => isZero(item.amount!)))
    return "同月四账户余额均为零，合计为¥0.00；零金额不是缺失数据，不计算无意义的占比。";
  return "仅使用同一月份的一般、商务、福利金一和福利金二账户余额；合计由四项精确求和，不重复计入已有合计序列。";
}

function readMonthlySeries(
  module: FinancialAnalysisModule,
  month: string,
): {
  found: boolean;
  items: FinancialAnalysisValue[];
} {
  const periods = module.periods
    .map((period, index) => ({ period, index }))
    .filter(({ period }) => period.from === month && period.to === month);
  if (periods.length !== 1)
    return { found: periods.length > 0, items: emptyItems() };
  const index = periods[0].index;
  return {
    found: true,
    items: ACCOUNTS.map((account) => {
      const sources = module.series.filter(
        (series) => series.key === account.key,
      );
      return {
        ...account,
        amount:
          sources.length === 1 ? knownAmount(sources[0].values[index]) : null,
      };
    }),
  };
}

function sourceTotalNote(
  module: FinancialAnalysisModule,
  month: string,
  total: string | null,
): string {
  if (total === null) return "";
  const periods = module.periods
    .map((period, index) => ({ period, index }))
    .filter(({ period }) => period.from === month && period.to === month);
  const totals = module.series.filter((series) => series.key === "total");
  if (periods.length !== 1 || totals.length !== 1) return "";
  const sourceTotal = knownAmount(totals[0].values[periods[0].index]);
  if (
    sourceTotal === null ||
    addFinancialAmountTexts(sourceTotal, "0") === total
  )
    return "";
  return `来源合计序列金额${formatMonthlyFinancialAmount(sourceTotal)}与四账户精确合计${formatMonthlyFinancialAmount(total)}不一致；圆心仍展示四项合计，不反推或修改账户余额。`;
}

function accountCode(value: string | null | undefined): AccountCode | null {
  if (!value) return null;
  const normalized = value.trim();
  const account = ACCOUNTS.find(
    (item) => item.key === normalized || item.label === normalized,
  );
  if (account) return account.key;
  // 兼容旧快照使用的两个福利账户名称，仅接受明确账户名，不模糊猜测。
  if (normalized === "福利账户一") return "welfare_one";
  if (normalized === "福利账户二") return "welfare_two";
  return null;
}

function detailAccount(
  detail: FinancialAnalysisDetail,
  month: string,
): AccountCode | null {
  const id = typeof detail.id === "string" ? detail.id : "";
  const fromId = id.startsWith(`${month}:`)
    ? accountCode(id.slice(month.length + 1))
    : null;
  const codes = new Set(
    [
      accountCode(detail.accountCode),
      accountCode(detail.account),
      fromId,
    ].filter((code): code is AccountCode => code !== null),
  );
  return codes.size === 1 ? [...codes][0] : null;
}

function readMonthlyDetails(
  module: FinancialAnalysisModule,
  month: string,
): FinancialAnalysisValue[] {
  const details = module.details.filter((detail) => detail.month === month);
  const sourceIds = details.map((detail) =>
    typeof detail.id === "string" ? detail.id.trim() : "",
  );
  if (
    sourceIds.some((id) => !id) ||
    new Set(sourceIds).size !== sourceIds.length
  )
    return emptyItems();
  const resolved = details.map((detail) => ({
    detail,
    code: detailAccount(detail, month),
  }));
  return ACCOUNTS.map((account) => {
    const sources = resolved.filter((row) => row.code === account.key);
    return {
      ...account,
      amount:
        sources.length === 1 ? knownAmount(sources[0].detail.closing) : null,
    };
  });
}

/** 点击折线时只按明确的单月序列取四账户，不用季度、年度或合计值替代。 */
export function buildMonthlyBalanceStructure(
  module: FinancialAnalysisModule | undefined,
  month: string,
  comparison = false,
): MonthlyFinancialBalanceStructure {
  const scopeLabel = `${comparison ? "对比期 · " : ""}${validMonth(month) ? month : "月份无效"}资金占比`;
  if (!module || module.key !== "balances" || !validMonth(month))
    return {
      items: emptyItems(),
      total: null,
      scopeLabel,
      note: "未取得该月份的账户余额来源，不按零填充。",
      month: null,
    };
  const result = readMonthlySeries(module, month);
  const total = exactTotal(result.items);
  return {
    items: result.items,
    total,
    scopeLabel,
    note: result.found
      ? amountNote(result.items, total) + sourceTotalNote(module, month, total)
      : "没有该月份的独立月度序列，不以季度、年度合计或其他月份明细替代。",
    month: result.found ? month : null,
  };
}

/** 年度余额是年度内最近完整时点的存量，不是逐月余额之和；截止月之后不参与选择。 */
export function buildAnnualBalanceStructure(
  module: FinancialAnalysisModule | undefined,
  cutoffMonth: string,
): MonthlyFinancialBalanceStructure {
  const validCutoff = validMonth(cutoffMonth);
  const year = validCutoff ? cutoffMonth.slice(0, 4) : "";
  const empty: MonthlyFinancialBalanceStructure = {
    items: emptyItems(),
    total: null,
    scopeLabel: validCutoff
      ? `${year}年度资金占比 · 截至${cutoffMonth}（暂无年度有效时点）`
      : "年度资金占比 · 截止月份无效",
    note: "本年度截止范围内尚无完整、可核验的同月四账户余额，不跨到其他年度或未来月份补值。",
    month: null,
  };
  if (!module || module.key !== "balances" || !validCutoff) return empty;
  const firstMonth = `${year}-01`;
  const candidates = [
    ...new Set(
      [
        ...module.periods
          .filter((period) => period.from === period.to)
          .map((period) => period.from),
        ...module.details.map((detail) => detail.month),
      ].filter(
        (month): month is string =>
          validMonth(month) && month >= firstMonth && month <= cutoffMonth,
      ),
    ),
  ].sort((left, right) => right.localeCompare(left));
  for (const month of candidates) {
    const series = readMonthlySeries(module, month);
    // 月度序列已明确该月时，空值和重复项同样是权威状态，不用明细反向覆盖。
    const items = series.found
      ? series.items
      : readMonthlyDetails(module, month);
    const total = exactTotal(items);
    if (total === null) continue;
    return {
      items,
      total,
      scopeLabel: `${year}年度资金占比 · 截至${month}（年度最新有效时点）`,
      note: `来源为${series.found ? "月度账户序列" : "同月账户余额明细"}。${amountNote(items, total)}年度不累计各月余额。${sourceTotalNote(module, month, total)}`,
      month,
    };
  }
  return empty;
}
