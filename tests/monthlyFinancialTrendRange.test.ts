import { splitMonthlyFinancialTrendRange } from "../src/utils/monthlyFinancialTrendRange";

describe("财务趋势完整历史查询分段", () => {
  it("二百四十个月保持单段且第二百四十一个月从下一段开始", () => {
    expect(splitMonthlyFinancialTrendRange("2000-01", "2019-12")).toEqual([
      ["2000-01", "2019-12"],
    ]);
    expect(splitMonthlyFinancialTrendRange("2000-01", "2020-01")).toEqual([
      ["2000-01", "2019-12"],
      ["2020-01", "2020-01"],
    ]);
  });

  it("跨年分段连续且拒绝倒序或错误月份", () => {
    expect(splitMonthlyFinancialTrendRange("2021-12", "2026-12", 24)).toEqual([
      ["2021-12", "2023-11"],
      ["2023-12", "2025-11"],
      ["2025-12", "2026-12"],
    ]);
    expect(() => splitMonthlyFinancialTrendRange("2026-02", "2026-01")).toThrow(
      "趋势开始月份不能晚于结束月份",
    );
    expect(() => splitMonthlyFinancialTrendRange("2026-2", "2026-12")).toThrow(
      "趋势月份格式必须为 YYYY-MM",
    );
  });
});
