import type {
  AnalysisOverheadAllocation,
  AnalysisOverheadCandidate,
} from "./monthlyFinancialAnalysis.js";
import {
  addFinancialAmounts,
  isValidFinancialDate,
  subtractFinancialAmounts,
} from "./monthlyFinancialReport.js";

/** 仅来源层使用的结构化证据，不增加公共接口字段。 */
export interface FinancialOverheadScopeSource extends AnalysisOverheadCandidate {
  expenseCategory?: string | null;
  rawMatchCount?: string;
}
export interface FinancialOverheadScopeEvidence {
  scopeCoverage: "included" | "excluded" | "unknown";
  scopeReason: string;
  /** 已发现租金来源矛盾或非法证据时，不允许把该付款分配计入已知房租。 */
  scopeConflict?: boolean;
}
const VERIFIED_LINE_CATEGORIES = new Set([
  "rent",
  "property_management",
  "electricity",
  "system_maintenance",
  "other_cost",
]);
const EXCLUDED_PAYMENT_CATEGORIES = new Set([
  "car_rental",
  "parking",
  "internet",
  "property_management",
  "electricity",
  "system_maintenance",
]);
const PAYMENT_CATEGORY_NAMES: Record<string, string> = {
  car_rental: "汽车租赁",
  parking: "停车费用",
  internet: "网络费用",
  rent: "租金",
  electricity: "电费",
  property_management: "物业管理费",
  system_maintenance: "系统维护费",
};
function positiveAmount(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value)) return null;
  const normalized = addFinancialAmounts(value);
  return normalized === "0" ? null : normalized;
}
function unknown(
  scopeReason: string,
  scopeConflict = false,
): FinancialOverheadScopeEvidence {
  return {
    scopeCoverage: "unknown",
    scopeReason,
    ...(scopeConflict ? { scopeConflict: true } : {}),
  };
}
function lineFingerprint(allocation: AnalysisOverheadAllocation): string {
  return JSON.stringify(
    allocation.lines
      .map((line) => [
        line.id,
        line.category,
        positiveAmount(line.amount),
        line.verified,
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

/** 范围判断不负责分配金额；混合发票的全部原始行仍交给既有精确票款分配算法。 */
export function financialOverheadScopeEvidence(
  candidate: FinancialOverheadScopeSource,
  allocations: readonly AnalysisOverheadAllocation[],
): FinancialOverheadScopeEvidence {
  const matched = allocations.filter(
    (row) =>
      row.paymentKind === candidate.kind && row.paymentId === candidate.id,
  );
  const category = candidate.expenseCategory || "";
  const declaredExcluded = EXCLUDED_PAYMENT_CATEGORIES.has(category);
  const declaredIncluded = category === "rent";
  const hasRentLine = matched.some((row) =>
    row.lines.some((line) => line.category === "rent"),
  );
  const hasVerifiedRentLine = matched.some((row) =>
    row.lines.some(
      (line) =>
        line.category === "rent" &&
        line.verified === true &&
        positiveAmount(line.amount),
    ),
  );
  // 只有结构化租金类别或租金明细进入房租核验；普通未分类资产不因缺票据而污染房租完整性。
  if (
    (!declaredIncluded && !hasRentLine) ||
    (declaredExcluded && !hasVerifiedRentLine)
  )
    return {
      scopeCoverage: "excluded",
      scopeReason: declaredExcluded
        ? `已确认付款的结构化费用类别为${PAYMENT_CATEGORY_NAMES[category]}，不属于房租；不按标题推断`
        : "没有结构化租金类别或租金发票明细证据，未纳入房租分摊；未分类资产不按标题猜测为房租",
    };
  const paymentAmount = positiveAmount(candidate.amount);
  if (
    typeof candidate.id !== "string" ||
    !candidate.id.trim() ||
    !paymentAmount ||
    !isValidFinancialDate(candidate.date) ||
    !["payment", "external_payment"].includes(candidate.kind)
  )
    return unknown(
      "租金付款身份、类型、实际日期或正金额尚不能核验房租范围",
      true,
    );
  // 实际矛盾优先于来源不完整；不能因少加载一张票就掩盖已发现的重复、日期或金额问题。
  if (
    new Set(matched.map((row) => row.id)).size !== matched.length ||
    matched.some(
      (row) =>
        !row.id?.trim() ||
        !row.invoiceId?.trim() ||
        row.date !== candidate.date ||
        !isValidFinancialDate(row.date) ||
        !positiveAmount(row.amount) ||
        positiveAmount(row.paymentAmount) !== paymentAmount,
    )
  )
    return unknown(
      "付款与发票对应身份重复或实际日期、金额矛盾，不能计入已知分摊",
      true,
    );
  if (
    subtractFinancialAmounts(
      paymentAmount,
      ...matched.map((row) => row.amount),
    ).startsWith("-")
  )
    return unknown("已加载票款分配超过原付款金额，不能计入已知分摊", true);
  // 已确认付款的明确业务类别本身就是范围依据；缺少老发票行不等于类别冲突。
  // 但真实已核验的正金额租金明细必须保留冲突，不能借付款类别覆盖。
  if (declaredExcluded) {
    if (
      matched.some((row) =>
        row.lines.some(
          (line) =>
            line.verified === true &&
            positiveAmount(line.amount) &&
            line.category === "rent",
        ),
      )
    )
      return unknown(
        "结构化付款类别与已核验发票明细范围冲突，需要核对而不能任意选择一方",
        true,
      );
    return {
      scopeCoverage: "excluded",
      scopeReason: `已确认付款的结构化费用类别为${PAYMENT_CATEGORY_NAMES[category]}，不属于房租；未按标题推断，老票款关联缺少明细不改写该业务类别`,
    };
  }
  if (
    typeof candidate.rawMatchCount !== "string" ||
    !/^\d+$/u.test(candidate.rawMatchCount)
  )
    return unknown("未取得完整票款关联计数，不能把未加载的分类证据视为不存在");
  if (BigInt(candidate.rawMatchCount) !== BigInt(matched.length))
    return unknown(
      "票款关联未全部取得有效发票明细，费用范围待核对",
      BigInt(candidate.rawMatchCount) < BigInt(matched.length),
    );
  if (!matched.length) {
    if (declaredIncluded)
      return {
        scopeCoverage: "included",
        scopeReason:
          "已确认付款的结构化费用类别为租金；仍需完整已核验票款明细才能分摊",
      };
    return unknown(
      "没有可证明房租范围的已核验明细或明确付款类别；未按项目名称推断",
    );
  }
  const allocationIds = new Set<string>();
  const categories = new Set<string>();
  const checkedInvoices = new Set<string>();
  for (const allocation of matched) {
    const amount = positiveAmount(allocation.amount);
    const invoiceAmount = positiveAmount(allocation.invoiceAmount);
    if (
      !allocation.id ||
      allocationIds.has(allocation.id) ||
      !allocation.invoiceId ||
      !amount ||
      allocation.date !== candidate.date ||
      positiveAmount(allocation.paymentAmount) !== paymentAmount
    )
      return unknown(
        "付款与发票对应证据重复或日期、金额不一致，房租范围待核对",
        true,
      );
    allocationIds.add(allocation.id);
    if (!invoiceAmount)
      return unknown(
        "发票票面金额未提供或无效，不能核验费用范围",
        allocation.invoiceAmount !== undefined &&
          allocation.invoiceAmount !== null,
      );
    if (
      new Set(allocation.lines.map((line) => line.id)).size !==
        allocation.lines.length ||
      allocation.lines.some((line) => !line.id || !positiveAmount(line.amount))
    )
      return unknown("发票明细身份重复或正金额无效，不能计入已知分摊", true);
    if (
      !allocation.lines.length ||
      allocation.lines.some(
        (line) =>
          line.verified !== true ||
          !VERIFIED_LINE_CATEGORIES.has(line.category),
      )
    )
      return unknown(
        "发票明细未全部核验、分类未知或全行合计不等于票面，不能排除房租",
      );
    if (
      addFinancialAmounts(...allocation.lines.map((line) => line.amount)) !==
      invoiceAmount
    )
      return unknown(
        "已核验发票明细全行合计与票面金额矛盾，不能计入已知分摊",
        true,
      );
    for (const line of allocation.lines) categories.add(line.category);
    if (checkedInvoices.has(allocation.invoiceId)) continue;
    checkedInvoices.add(allocation.invoiceId);
    const invoiceMatches = allocations.filter(
      (row) => row.invoiceId === allocation.invoiceId,
    );
    if (
      new Set(invoiceMatches.map((row) => row.id)).size !==
        invoiceMatches.length ||
      invoiceMatches.some(
        (row) =>
          !positiveAmount(row.amount) ||
          positiveAmount(row.invoiceAmount) !== invoiceAmount ||
          lineFingerprint(row) !== lineFingerprint(allocation),
      ) ||
      subtractFinancialAmounts(
        invoiceAmount,
        ...invoiceMatches.map((row) => row.amount),
      ).startsWith("-")
    )
      return unknown("同发票跨次分配证据冲突或超过票面，房租范围待核对", true);
  }
  if (
    addFinancialAmounts(...matched.map((row) => row.amount)) !== paymentAmount
  )
    return unknown(
      "付款尚未达到全额票款闭合，不能以已匹配片段排除未匹配金额的房租可能",
    );
  const containsShared = categories.has("rent");
  // 租赁合同付款也可能只支付电费等项目；全额闭合且全行核验后，以实际票面无租金为零房租证据。
  return containsShared
    ? {
        scopeCoverage: "included",
        scopeReason:
          "付款全额票款闭合且发票全行已核验，包含房租；混合明细仍按完整票面分配，不先剔除范围外行",
      }
    : {
        scopeCoverage: "excluded",
        scopeReason:
          "付款全额票款闭合、发票全行已核验且全部明确为其他费用，不属于房租",
      };
}
