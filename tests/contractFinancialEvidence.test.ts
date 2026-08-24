import { calculateContractFinancialPdfRenderDpi } from "../server/services/contractFinancialEvidence";

describe("合同财务 PDF 首页安全渲染预算", () => {
  it("标准 A4 页面保留 300 DPI 且不超过九百万像素", () => {
    expect(calculateContractFinancialPdfRenderDpi(595, 842)).toBe(300);
  });

  it("超大页面按边长和总像素预算自动降低分辨率", () => {
    const dpi = calculateContractFinancialPdfRenderDpi(1440, 1440);
    const renderedEdge = Math.ceil((1440 / 72) * dpi);

    expect(dpi).toBe(150);
    expect(renderedEdge).toBeLessThanOrEqual(4000);
    expect(renderedEdge * renderedEdge).toBeLessThanOrEqual(9_000_000);
  });

  it.each([
    [0, 842],
    [595, Number.NaN],
    [1_000_000_000, 1_000_000_000],
  ])("页面尺寸 %s × %s 无法安全渲染时拒绝", (width, height) => {
    expect(() =>
      calculateContractFinancialPdfRenderDpi(width, height),
    ).toThrow();
  });
});
