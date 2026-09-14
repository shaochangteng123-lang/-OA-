import {
  FINANCIAL_WINDOW_QUARTERS,
  financialQuarterRange,
  financialTwelveQuarterRange,
  financialWindowQuery,
} from "../src/utils/monthlyFinancialAnalysisWindow";
import type { FinancialAnalysisQuery } from "../src/types/monthlyFinancialAnalysis";

describe("财务连续十二季度窗口工具", () => {
  it.each([
    ["2026-01", "2026-01", "2026-03"],
    ["2026-05", "2026-04", "2026-06"],
    ["2026-09", "2026-07", "2026-09"],
    ["2024-12", "2024-10", "2024-12"],
  ])("%s归入真实自然季度", (month, from, to) => {
    expect(financialQuarterRange(month)).toEqual({ from, to });
  });

  it("十二自然季度包含本季度和此前十一季，不是最近十二个月", () => {
    expect(FINANCIAL_WINDOW_QUARTERS).toBe(12);
    expect(financialTwelveQuarterRange("2026-09")).toEqual({
      from: "2023-10",
      to: "2026-09",
    });
    expect(financialTwelveQuarterRange("2026-01")).toEqual({
      from: "2023-04",
      to: "2026-03",
    });
    expect(financialTwelveQuarterRange("2024-02")).toEqual({
      from: "2021-04",
      to: "2024-03",
    });
  });

  it("未完季度严格截止到最大月份，前一完整季不被截成不相关月份", () => {
    expect(financialQuarterRange("2026-07", "2026-08")).toEqual({
      from: "2026-07",
      to: "2026-08",
    });
    expect(financialQuarterRange("2026-04", "2026-08")).toEqual({
      from: "2026-04",
      to: "2026-06",
    });
    expect(financialTwelveQuarterRange("2026-08", "2026-08")).toEqual({
      from: "2023-10",
      to: "2026-08",
    });
    expect(financialTwelveQuarterRange("2026-12", "2026-08")).toEqual({
      from: "2023-10",
      to: "2026-08",
    });
  });

  it("1900年初不足十二季时只返回可用历史，绝不补1899或未来季度", () => {
    expect(financialTwelveQuarterRange("1900-01", "1900-01")).toEqual({
      from: "1900-01",
      to: "1900-01",
    });
    expect(financialTwelveQuarterRange("1901-06")).toEqual({
      from: "1900-01",
      to: "1901-06",
    });
    expect(financialTwelveQuarterRange("1902-10", "1902-10")).toEqual({
      from: "1900-01",
      to: "1902-10",
    });
    expect(financialTwelveQuarterRange("2099-12")).toEqual({
      from: "2097-01",
      to: "2099-12",
    });
    expect(() => financialTwelveQuarterRange("1899-12")).toThrow("1900至2099");
    expect(() => financialTwelveQuarterRange("2100-01")).toThrow("1900至2099");
  });

  it.each(["2026-1", "2026-00", "2026-Q1", "2026-13", "", null])(
    "拒绝无效截止月份 %j",
    (month) => {
      expect(() => financialQuarterRange(month as string)).toThrow();
      expect(() => financialTwelveQuarterRange(month as string)).toThrow();
      expect(() =>
        financialTwelveQuarterRange("2026-06", month as string),
      ).toThrow();
    },
  );

  it("拒绝将某一季度截止到该季度之前", () => {
    expect(() => financialQuarterRange("2026-07", "2026-06")).toThrow(
      "不能早于当季首月",
    );
  });

  it("季度查询保留业务筛选与同比年差，跨年后重新锚定而不改源对象", () => {
    const source: FinancialAnalysisQuery = Object.freeze({
      from: "2026-01",
      to: "2026-08",
      granularity: "quarter",
      comparisonYear: 2024,
      partyA: "甲方",
      contractRegion: "区域",
      reimbursementScope: "范围",
      personId: "人员",
    });
    const result = financialWindowQuery(
      source,
      financialTwelveQuarterRange("2026-08", "2026-08"),
      "quarter",
    );
    expect(result).toEqual({
      ...source,
      from: "2023-10",
      to: "2026-08",
      comparisonYear: 2021,
    });
    expect(source.from).toBe("2026-01");
    const earlier = financialWindowQuery(
      result,
      financialTwelveQuarterRange("2025-09", "2026-08"),
      "quarter",
    );
    expect(earlier).toEqual({
      ...source,
      from: "2022-10",
      to: "2025-09",
      comparisonYear: 2020,
    });
    expect(
      financialWindowQuery(
        source,
        { from: "1900-01", to: "1900-01" },
        "quarter",
      ),
    ).not.toHaveProperty("comparisonYear");
  });

  it("旧两参数调用仍生成月度查询，季度需显式选择且拒绝未知连续粒度", () => {
    const source: FinancialAnalysisQuery = {
      from: "2026-01",
      to: "2026-08",
      granularity: "quarter",
    };
    const range = { from: "2023-10", to: "2026-08" };
    expect(financialWindowQuery(source, range).granularity).toBe("month");
    expect(financialWindowQuery(source, range, "quarter").granularity).toBe(
      "quarter",
    );
    expect(() =>
      financialWindowQuery(source, range, "year" as "quarter"),
    ).toThrow("只能为月度或季度");
  });
});
