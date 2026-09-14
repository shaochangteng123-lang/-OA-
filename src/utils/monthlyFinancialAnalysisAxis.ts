/** 这里只计算绘图轴范围；金额文本、业务汇总不得使用本工具的近似数值。 */
export interface FinancialLineAxisRange {
  min: number;
  max: number;
  hasValues: boolean;
  nonZeroOrigin: boolean;
}

/**
 * 始终包含零点，将可见金额的绝对值上限扩大一倍，让高位聚集的折线靠近中部。
 * 正值向上留白、负值向下留白，跨零时使用对称范围；极端值饱和处理以保持有限坐标。
 */
export function financialLineAxisRange(
  values: ReadonlyArray<number | null | undefined>,
): FinancialLineAxisRange {
  const known = values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
  if (!known.length)
    return { min: 0, max: 1, hasValues: false, nonZeroOrigin: false };
  const minimum = Math.min(...known);
  const maximum = Math.max(...known);
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum));
  if (magnitude === 0)
    return { min: 0, max: 1, hasValues: true, nonZeroOrigin: false };
  const limit =
    magnitude > Number.MAX_VALUE / 2 ? Number.MAX_VALUE : magnitude * 2;
  return {
    min: minimum < 0 ? -limit : 0,
    max: maximum > 0 ? limit : 0,
    hasValues: true,
    nonZeroOrigin: false,
  };
}
