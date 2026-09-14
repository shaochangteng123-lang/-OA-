const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;

function monthIndex(month: string): number {
  const match = month.match(MONTH_PATTERN);
  if (!match) throw new Error("趋势月份格式必须为 YYYY-MM");
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const monthNumber = (index % 12) + 1;
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

export function splitMonthlyFinancialTrendRange(
  from: string,
  to: string,
  maximumMonths = 240,
): Array<[string, string]> {
  if (!Number.isInteger(maximumMonths) || maximumMonths < 1) {
    throw new Error("趋势分段月份数量必须为正整数");
  }
  const endIndex = monthIndex(to);
  let startIndex = monthIndex(from);
  if (startIndex > endIndex) throw new Error("趋势开始月份不能晚于结束月份");
  const ranges: Array<[string, string]> = [];
  while (startIndex <= endIndex) {
    const chunkEnd = Math.min(startIndex + maximumMonths - 1, endIndex);
    ranges.push([monthFromIndex(startIndex), monthFromIndex(chunkEnd)]);
    startIndex = chunkEnd + 1;
  }
  return ranges;
}
