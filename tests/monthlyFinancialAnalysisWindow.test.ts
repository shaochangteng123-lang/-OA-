import {
  FINANCIAL_WINDOW_MONTHS,
  financialMonthOffset,
  financialTwelveMonthRange,
  financialWindowQuery,
} from "../src/utils/monthlyFinancialAnalysisWindow";
import type { FinancialAnalysisQuery } from "../src/types/monthlyFinancialAnalysis";

describe("财务月份窗口平移", () => {
  it("固定为十二个月并正确跨年、跨闰年平移", () => {
    expect(FINANCIAL_WINDOW_MONTHS).toBe(12);
    expect(financialMonthOffset("2026-01", -1)).toBe("2025-12");
    expect(financialMonthOffset("2026-12", 1)).toBe("2027-01");
    expect(financialMonthOffset("2024-02", 12)).toBe("2025-02");
    expect(financialMonthOffset("2025-02", -12)).toBe("2024-02");
    expect(financialMonthOffset("2026-08", 0)).toBe("2026-08");
  });

  it("结果允许完整财务年份边界，不能越界", () => {
    expect(financialMonthOffset("1900-01", 0)).toBe("1900-01");
    expect(financialMonthOffset("2099-12", 0)).toBe("2099-12");
    expect(financialMonthOffset("1899-12", 1)).toBe("1900-01");
    expect(financialMonthOffset("2100-01", -1)).toBe("2099-12");
    expect(() => financialMonthOffset("1900-01", -1)).toThrow("1900至2099");
    expect(() => financialMonthOffset("2099-12", 1)).toThrow("1900至2099");
    expect(() => financialMonthOffset("1899-12", 0)).toThrow("1900至2099");
  });

  it.each([
    "2026-1",
    "2026-00",
    "2026-13",
    "2026-01-01",
    "26-01",
    "0000-01",
    " 2026-01",
    "2026-01 ",
    "",
    null,
    202601,
  ])("拒绝无效月份 %j", (month) => {
    expect(() => financialMonthOffset(month as string, 0)).toThrow();
  });

  it.each([
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("拒绝非安全整数偏移 %j", (offset) => {
    expect(() => financialMonthOffset("2026-01", offset)).toThrow("安全整数");
  });
});

describe("连续十二个月窗口", () => {
  it("始终包含结束月份及此前十一个月", () => {
    expect(financialTwelveMonthRange("2026-09")).toEqual({
      from: "2025-10",
      to: "2026-09",
    });
    expect(financialTwelveMonthRange("2026-12")).toEqual({
      from: "2026-01",
      to: "2026-12",
    });
    expect(financialTwelveMonthRange("2024-02")).toEqual({
      from: "2023-03",
      to: "2024-02",
    });
  });

  it("年份边界不足十二个月时明确拒绝，不缩成伪十二月窗口", () => {
    expect(financialTwelveMonthRange("1900-12")).toEqual({
      from: "1900-01",
      to: "1900-12",
    });
    expect(financialTwelveMonthRange("2099-12")).toEqual({
      from: "2099-01",
      to: "2099-12",
    });
    expect(() => financialTwelveMonthRange("1900-11")).toThrow("1900至2099");
    expect(() => financialTwelveMonthRange("1900-01")).toThrow("1900至2099");
    expect(() => financialTwelveMonthRange("2100-01")).toThrow("1900至2099");
  });
});

describe("月份窗口查询条件", () => {
  const source: FinancialAnalysisQuery = {
    from: "2026-01",
    to: "2026-09",
    granularity: "quarter",
    partyA: "甲方",
    contractRegion: "朝阳区",
    reimbursementScope: "区域范围",
    personId: "employee",
    comparisonYear: 2024,
  };

  it("保留所有业务筛选、强制月度并按原年差更新跨年对比锚点", () => {
    const before = { ...source };
    const range = Object.freeze({ from: "2025-10", to: "2026-09" });
    const result = financialWindowQuery(Object.freeze({ ...source }), range);
    expect(result).toEqual({
      ...source,
      from: "2025-10",
      to: "2026-09",
      granularity: "month",
      comparisonYear: 2023,
    });
    expect(source).toEqual(before);
    expect(range).toEqual({ from: "2025-10", to: "2026-09" });
    expect(result).not.toBe(source);
  });

  it("向后移动窗口保持同一年差，可用于连续跨年翻阅", () => {
    const first = financialWindowQuery(
      source,
      financialTwelveMonthRange("2027-01"),
    );
    expect(first.comparisonYear).toBe(2024);
    const next = financialWindowQuery(
      first,
      financialTwelveMonthRange("2028-01"),
    );
    expect(next.comparisonYear).toBe(2025);
    expect(next.from).toBe("2027-02");
  });

  it("平移后的比较年份不足1900时省略，不制造非法比较查询", () => {
    const result = financialWindowQuery(source, {
      from: "1900-01",
      to: "1900-12",
    });
    expect(result).not.toHaveProperty("comparisonYear");
    expect(result.personId).toBe("employee");
  });

  it("未启用对比仍不启用，也不改写原对象", () => {
    const plain = {
      from: "2026-01",
      to: "2026-09",
      granularity: "year" as const,
      partyA: "甲方",
    };
    expect(
      financialWindowQuery(plain, { from: "2025-10", to: "2026-09" }),
    ).toEqual({
      from: "2025-10",
      to: "2026-09",
      granularity: "month",
      partyA: "甲方",
    });
    expect(plain.granularity).toBe("year");
  });

  it("拒绝反向区间及无效原比较年差", () => {
    expect(() =>
      financialWindowQuery(source, { from: "2026-09", to: "2026-01" }),
    ).toThrow("不能晚于");
    expect(() =>
      financialWindowQuery(
        { ...source, comparisonYear: 2026 },
        { from: "2025-10", to: "2026-09" },
      ),
    ).toThrow("早于原查询");
    expect(() =>
      financialWindowQuery(
        { ...source, comparisonYear: Number.NaN },
        { from: "2025-10", to: "2026-09" },
      ),
    ).toThrow("对比年份");
  });
});
