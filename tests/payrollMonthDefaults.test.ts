import {
  getPreviousPayrollMonth,
  resolvePayrollMonthDefaults,
} from "../server/utils/payroll-month-defaults";

describe("人力成本新月份默认值", () => {
  it("工资和缴费基数沿用上月，应纳个税默认清零", () => {
    expect(
      resolvePayrollMonthDefaults("9000.00", {
        monthly_salary: "8800.00",
        housing_fund_base: "8000.00",
        contribution_base: "7162.00",
      }),
    ).toEqual({
      monthlySalary: "8800.00",
      housingFundBase: "8000.00",
      contributionBase: "7162.00",
      individualIncomeTax: "0",
    });
  });

  it("上月明确填写为零时仍原样沿用", () => {
    expect(
      resolvePayrollMonthDefaults("9000.00", {
        monthly_salary: "0",
        housing_fund_base: "0",
        contribution_base: "0",
      }),
    ).toEqual({
      monthlySalary: "0",
      housingFundBase: "0",
      contributionBase: "0",
      individualIncomeTax: "0",
    });
  });

  it("没有上月记录时工资和缴费基数使用自动工资", () => {
    expect(resolvePayrollMonthDefaults("9000.00")).toEqual({
      monthlySalary: "9000.00",
      housingFundBase: "9000.00",
      contributionBase: "9000.00",
      individualIncomeTax: "0",
    });
  });

  it("跨年时能正确取得上一个自然月", () => {
    expect(getPreviousPayrollMonth("2026-01")).toBe("2025-12");
    expect(getPreviousPayrollMonth("2026-08")).toBe("2026-07");
  });
});
