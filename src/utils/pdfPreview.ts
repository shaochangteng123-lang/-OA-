export interface PdfPreviewRenderMetrics {
  renderScale: number;
  pixelWidth: number;
  pixelHeight: number;
}

const PREVIEW_QUALITY_SCALE = 1.25;
const MAX_DEVICE_PIXEL_RATIO = 2.5;
const MAX_PREVIEW_PIXEL_WIDTH = 2560;
const MAX_PREVIEW_PIXEL_COUNT = 9_500_000;
const PLACEHOLDER_PIXEL_WIDTH = 120;

function toPositiveFiniteNumber(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getPdfPreviewRenderMetrics(
  pageWidth: number,
  pageHeight: number,
  displayWidth: number,
  devicePixelRatio: number,
): PdfPreviewRenderMetrics {
  const safePageWidth = toPositiveFiniteNumber(pageWidth, 1);
  const safePageHeight = toPositiveFiniteNumber(pageHeight, 1);
  const safeDisplayWidth = toPositiveFiniteNumber(displayWidth, safePageWidth);
  const safeDevicePixelRatio = Math.min(
    Math.max(toPositiveFiniteNumber(devicePixelRatio, 1), 1),
    MAX_DEVICE_PIXEL_RATIO,
  );
  const requestedPixelWidth = Math.ceil(
    safeDisplayWidth * safeDevicePixelRatio * PREVIEW_QUALITY_SCALE,
  );
  const pixelAreaLimitedWidth = Math.floor(
    Math.sqrt((MAX_PREVIEW_PIXEL_COUNT * safePageWidth) / safePageHeight),
  );
  const pixelWidth = Math.min(
    requestedPixelWidth,
    MAX_PREVIEW_PIXEL_WIDTH,
    Math.max(pixelAreaLimitedWidth, 1),
  );
  const renderScale = pixelWidth / safePageWidth;

  return {
    renderScale,
    pixelWidth,
    pixelHeight: Math.ceil(safePageHeight * renderScale),
  };
}

export function getPdfPreviewPlaceholderMetrics(
  pageWidth: number,
  pageHeight: number,
) {
  const safePageWidth = toPositiveFiniteNumber(pageWidth, 1);
  const safePageHeight = toPositiveFiniteNumber(pageHeight, 1);
  const pixelWidth = Math.min(
    PLACEHOLDER_PIXEL_WIDTH,
    Math.max(Math.ceil(safePageWidth), 1),
  );

  return {
    pixelWidth,
    pixelHeight: Math.max(
      Math.ceil((safePageHeight * pixelWidth) / safePageWidth),
      1,
    ),
  };
}
