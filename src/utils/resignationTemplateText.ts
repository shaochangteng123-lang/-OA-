export interface ResignationFieldTextFit {
  fontScale: number;
  horizontalScale: number;
  widthPercent: number;
  transformOrigin: "left center";
}

export function calculateResignationFieldTextFit(
  measuredTextWidth: number,
  fieldWidth: number,
  horizontalMargin: number,
  fontSize: number,
  minimumFontSize = 7,
): ResignationFieldTextFit {
  const safeMeasuredWidth = Number.isFinite(measuredTextWidth)
    ? Math.max(0, measuredTextWidth)
    : 0;
  const safeFieldWidth = Number.isFinite(fieldWidth)
    ? Math.max(1, fieldWidth)
    : 1;
  const safeMargin = Number.isFinite(horizontalMargin)
    ? Math.max(0, horizontalMargin)
    : 0;
  const safeFontSize = Number.isFinite(fontSize) ? Math.max(1, fontSize) : 1;
  const safeMinimumFontSize = Number.isFinite(minimumFontSize)
    ? Math.max(1, Math.min(safeFontSize, minimumFontSize))
    : 1;
  const availableWidth = Math.max(1, safeFieldWidth - safeMargin * 2);
  const requiredScale =
    safeMeasuredWidth > availableWidth && safeMeasuredWidth > 0
      ? availableWidth / safeMeasuredWidth
      : 1;
  const fontScale = Math.max(
    safeMinimumFontSize / safeFontSize,
    Math.min(1, requiredScale),
  );
  const fittedTextWidth = safeMeasuredWidth * fontScale;
  const horizontalScale =
    fittedTextWidth > availableWidth ? availableWidth / fittedTextWidth : 1;
  return {
    fontScale,
    horizontalScale,
    widthPercent: horizontalScale < 1 ? 100 / horizontalScale : 100,
    transformOrigin: "left center",
  };
}
