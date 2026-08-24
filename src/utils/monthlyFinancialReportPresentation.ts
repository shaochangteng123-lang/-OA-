import type { MonthlyFinancialAutomaticDetail } from "@/types/monthlyFinancialReport";

const UNSIGNED_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/;
const SIGNED_AMOUNT_PATTERN = /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/;

export function isMonthlyFinancialAmountText(
  value: string,
  allowNegative = false,
): boolean {
  const pattern = allowNegative
    ? SIGNED_AMOUNT_PATTERN
    : UNSIGNED_AMOUNT_PATTERN;
  return pattern.test(value.trim());
}

export function isPositiveMonthlyFinancialAmountText(value: string): boolean {
  const text = value.trim();
  return isMonthlyFinancialAmountText(text) && !/^0(?:\.0+)?$/.test(text);
}

export function aggregateAutomaticDetailsByPerson(
  details: MonthlyFinancialAutomaticDetail[],
  metric: string,
  month: string,
): MonthlyFinancialAutomaticDetail[] {
  const grouped = new Map<string, MonthlyFinancialAutomaticDetail>();
  for (const detail of details.filter((item) => item.metric === metric)) {
    const personName = detail.personName?.trim() || "未记录姓名";
    const personId = detail.personId?.trim() || null;
    const personKey = personId
      ? `${detail.sourceType}:${personId}`
      : `${detail.sourceType}:${detail.sourceId}`;
    const existing = grouped.get(personKey);
    grouped.set(personKey, {
      ...detail,
      sourceId: `${metric}-${personKey}`,
      occurredOn: `${month}-01`,
      personId,
      personName,
      amount: existing
        ? addFinancialAmountTexts(existing.amount, detail.amount)
        : detail.amount,
      description: "该类型当月总计",
    });
  }
  return [...grouped.values()].sort((left, right) => {
    const nameComparison = String(left.personName).localeCompare(
      String(right.personName),
      "zh-CN",
    );
    return nameComparison || left.sourceId.localeCompare(right.sourceId);
  });
}

export function addFinancialAmountTexts(left: string, right: string): string {
  const leftMatch = left.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  const rightMatch = right.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!leftMatch || !rightMatch) return left;
  const scale = Math.max(leftMatch[3]?.length || 0, rightMatch[3]?.length || 0);
  const toScaledInteger = (match: RegExpMatchArray): bigint => {
    const digits = `${match[2]}${(match[3] || "").padEnd(scale, "0")}`;
    return BigInt(`${match[1] === "-" ? "-" : ""}${digits}`);
  };
  const total = toScaledInteger(leftMatch) + toScaledInteger(rightMatch);
  const sign = total < 0n ? "-" : "";
  const digits = (total < 0n ? -total : total)
    .toString()
    .padStart(scale + 1, "0");
  if (scale === 0) return `${sign}${digits}`;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  const integer = digits.slice(0, -scale) || "0";
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}
