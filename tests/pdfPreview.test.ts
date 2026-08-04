import {
  getPdfPreviewPlaceholderMetrics,
  getPdfPreviewRenderMetrics,
} from "../src/utils/pdfPreview";

describe("劳动合同在线预览清晰度", () => {
  it("在双倍屏幕像素密度上继续增加高清采样", () => {
    const metrics = getPdfPreviewRenderMetrics(595, 842, 920, 2);

    expect(metrics.pixelWidth).toBe(2300);
    expect(metrics.pixelHeight).toBe(3255);
    expect(metrics.renderScale).toBeCloseTo(2300 / 595, 6);
  });

  it("限制超高密度屏幕的画布宽度以控制多页合同内存", () => {
    const metrics = getPdfPreviewRenderMetrics(595, 842, 920, 3);

    expect(metrics.pixelWidth).toBe(2560);
    expect(metrics.pixelHeight).toBe(3623);
  });

  it("普通屏幕也采用高于显示宽度的清晰采样", () => {
    const metrics = getPdfPreviewRenderMetrics(595, 842, 920, 1);

    expect(metrics.pixelWidth).toBe(1150);
    expect(metrics.pixelHeight).toBe(1628);
  });

  it("超长页面受总像素上限保护，避免单页画布无限占用内存", () => {
    const metrics = getPdfPreviewRenderMetrics(595, 5000, 920, 3);

    expect(metrics.pixelWidth * metrics.pixelHeight).toBeLessThanOrEqual(
      9_510_000,
    );
    expect(metrics.pixelWidth).toBeLessThan(2560);
  });

  it("页面离开预加载区域后可降为低内存占位画布", () => {
    const placeholder = getPdfPreviewPlaceholderMetrics(595, 842);

    expect(placeholder).toEqual({
      pixelWidth: 120,
      pixelHeight: 170,
    });
  });

  it("异常尺寸回退为有限正数，避免生成无效画布", () => {
    const metrics = getPdfPreviewRenderMetrics(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    );

    expect(metrics).toEqual({
      renderScale: 2,
      pixelWidth: 2,
      pixelHeight: 2,
    });
  });
});
