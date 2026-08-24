const CONTRACT_COPY_COUNT_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  两: 2,
  贰: 2,
  三: 3,
  叁: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};

const CONTRACT_COPY_COUNT_TOKEN =
  "[0-9零〇一二两三四五六七八九十壹贰叁肆伍陆柒捌玖拾]{1,3}";
const CONTRACT_COPY_COUNT_SEPARATOR = "[\\s_]*";

function parseContractCopyCountToken(token: string): number | null {
  if (/^\d{1,2}$/u.test(token)) return Number(token);
  const normalized = token.replace(/拾/gu, "十");
  if (!normalized.includes("十")) {
    return CONTRACT_COPY_COUNT_DIGITS[normalized] ?? null;
  }
  const [tensText, onesText] = normalized.split("十");
  const tens = tensText ? CONTRACT_COPY_COUNT_DIGITS[tensText] : 1;
  const ones = onesText ? CONTRACT_COPY_COUNT_DIGITS[onesText] : 0;
  return tens == null || ones == null ? null : tens * 10 + ones;
}

function uniqueParsedCounts(
  matches: Iterable<RegExpMatchArray>,
): number[] | null {
  const parsed = Array.from(matches, (match) =>
    parseContractCopyCountToken(match[1] || ""),
  );
  if (
    parsed.length === 0 ||
    parsed.some((count) => count == null || count < 1 || count > 20)
  ) {
    return null;
  }
  return [...new Set(parsed as number[])];
}

function partyAllocatedMinimum(text: string): {
  valid: boolean;
  minimum: number;
} {
  const explicitPartyCounts: number[] = [];
  for (const party of ["甲方", "乙方"] as const) {
    const expression = new RegExp(
      `${party}${CONTRACT_COPY_COUNT_SEPARATOR}(?:各${CONTRACT_COPY_COUNT_SEPARATOR})?执${CONTRACT_COPY_COUNT_SEPARATOR}(${CONTRACT_COPY_COUNT_TOKEN})${CONTRACT_COPY_COUNT_SEPARATOR}份`,
      "gu",
    );
    const matches = Array.from(text.matchAll(expression));
    if (matches.length === 0) continue;
    const counts = uniqueParsedCounts(matches);
    if (counts == null || counts.length !== 1) {
      return { valid: false, minimum: 0 };
    }
    explicitPartyCounts.push(counts[0]!);
  }
  if (explicitPartyCounts.length > 0) {
    return {
      valid: true,
      minimum: explicitPartyCounts.reduce((sum, count) => sum + count, 0),
    };
  }

  const bothParties = new RegExp(
    `(?:甲乙双方|双方)${CONTRACT_COPY_COUNT_SEPARATOR}各${CONTRACT_COPY_COUNT_SEPARATOR}执${CONTRACT_COPY_COUNT_SEPARATOR}(${CONTRACT_COPY_COUNT_TOKEN})${CONTRACT_COPY_COUNT_SEPARATOR}份`,
    "gu",
  );
  const sharedMatches = Array.from(text.matchAll(bothParties));
  if (sharedMatches.length === 0) return { valid: true, minimum: 0 };
  const sharedCounts = uniqueParsedCounts(sharedMatches);
  if (sharedCounts == null || sharedCounts.length !== 1) {
    return { valid: false, minimum: 0 };
  }
  return { valid: true, minimum: sharedCounts[0]! * 2 };
}

/**
 * 从合同正文唯一明确的“一式×份”提取用印总份数。正文存在冲突、越界或
 * 甲乙方最低持有份数已经超过总份数时一律返回空值，不根据分配份数猜总数。
 */
export function extractContractSealCopyCount(rawText: unknown): number | null {
  const text = String(rawText || "").normalize("NFKC");
  const totalExpression = new RegExp(
    `(?:本?(?:补充|解除|终止|变更)?(?:合同|协议|合约))?${CONTRACT_COPY_COUNT_SEPARATOR}一式${CONTRACT_COPY_COUNT_SEPARATOR}(${CONTRACT_COPY_COUNT_TOKEN})${CONTRACT_COPY_COUNT_SEPARATOR}份`,
    "gu",
  );
  const totals = uniqueParsedCounts(text.matchAll(totalExpression));
  if (totals == null || totals.length !== 1) return null;
  const total = totals[0]!;
  const allocation = partyAllocatedMinimum(text);
  if (!allocation.valid || allocation.minimum > total) return null;
  return total;
}
