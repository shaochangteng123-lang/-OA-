export interface FinancialReimbursementDateDiagnostic {
  type: string;
  count: string;
  amount: string | null;
}

const REIMBURSEMENT_LABELS = [
  ["basic", "基础报销"],
  ["large", "大额报销"],
  ["business", "商务报销"],
] as const;

/** 仅在全历史分组查询成功后调用；空结果表示不存在缺失日期的已付款报销。 */
export function financialReimbursementDatesComplete(
  rows: readonly FinancialReimbursementDateDiagnostic[],
): Record<"basic" | "large" | "business", boolean> {
  return Object.fromEntries(
    REIMBURSEMENT_LABELS.map(([type]) => [
      type,
      rows
        .filter((row) => row.type === type)
        .every((row) => /^\d+$/u.test(row.count) && BigInt(row.count) === 0n),
    ]),
  ) as Record<"basic" | "large" | "business", boolean>;
}

function diagnosticAmount(value: string | null): string {
  // 数据库汇总以十进制文本传入；只添加分隔符与显示位，不转换为浮点数。
  const matched =
    typeof value === "string" && value.match(/^(-?)(\d+)(?:\.(\d+))?$/u);
  if (!matched) return "未知（原始合计无效）";
  const integer = matched[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `¥${matched[1]}${integer}.${(matched[3] || "").padEnd(2, "0")}`;
}

/**
 * 全历史日期缺失诊断，不将待核对金额分配到任何月份或改写业务事实。
 * 仅输出已授权报销类型的汇总，不输出人员、单号或未知类型的原始文本。
 */
export function financialReimbursementDateWarnings(
  rows: readonly FinancialReimbursementDateDiagnostic[],
): string[] {
  return REIMBURSEMENT_LABELS.flatMap(([type, label]) => {
    const row = rows.find((item) => item.type === type);
    if (!row || !/^\d+$/u.test(row.count) || BigInt(row.count) === 0n)
      return [];
    const count = BigInt(row.count).toString();
    return [
      `存在${count}笔已付款${label}缺少有效实际付款日期，金额${diagnosticAmount(row.amount)}；尚未纳入按付款月份统计，不能理解为没有报销。此为全历史日期诊断，不代表当前月份、人员或报销范围筛选金额；请核对原付款凭证。`,
    ];
  });
}
