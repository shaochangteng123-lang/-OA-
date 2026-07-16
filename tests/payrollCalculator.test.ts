import {
  calculateAutomaticMonthlySalary,
  calculatePayrollBreakdown,
  countCompletedSalaryYears,
} from "../server/services/payrollCalculator";

describe("工资精确计算", () => {
  it("按工资表公式计算 8000 元样例", () => {
    expect(calculatePayrollBreakdown("8000", "8000", "50.31")).toEqual({
      company_pension: "1280.00",
      company_medical: "784.00",
      company_unemployment: "40.00",
      company_injury: "32.00",
      company_social_total: "2136.00",
      company_housing_fund: "480.00",
      company_paid_total: "2616.00",
      withheld_social: "2979.00",
      withheld_housing_fund: "960.00",
      withheld_tax: "50.31",
      withheld_total: "3989.31",
      personal_pension: "640.00",
      personal_medical: "163.00",
      personal_unemployment: "40.00",
      personal_social_total: "843.00",
      personal_housing_fund: "480.00",
      net_salary: "6626.69",
    });
  });

  it("保留完整小数参与后续合计，不四舍五入", () => {
    const result = calculatePayrollBreakdown("7000", "7162", "26.55");

    expect(result.company_medical).toBe("701.876");
    expect(result.company_injury).toBe("28.648");
    expect(result.company_social_total).toBe("1912.254");
    expect(result.withheld_total).toBe("3533.814");
    expect(result.net_salary).toBe("5798.44");
  });

  it("缴费基数为零时不产生固定 3 元医疗费用", () => {
    const result = calculatePayrollBreakdown("0", "0", "0");

    expect(result.personal_medical).toBe("0.00");
    expect(result.net_salary).toBe("0.00");
  });
});

describe("满十二个月自动涨薪", () => {
  it("按工资月份最后一天判断是否满十二个月", () => {
    expect(countCompletedSalaryYears("2025-01-01", "2025-12")).toBe(0);
    expect(countCompletedSalaryYears("2025-01-01", "2026-01")).toBe(1);
    expect(
      calculateAutomaticMonthlySalary("8000", "2025-01-01", "2026-01"),
    ).toBe("9000.00");
  });

  it("自动涨薪封顶 10000 元，初始工资超过封顶值时保留原值", () => {
    expect(
      calculateAutomaticMonthlySalary("8000", "2025-01-01", "2027-01"),
    ).toBe("10000.00");
    expect(
      calculateAutomaticMonthlySalary("12000", "2025-01-01", "2027-01"),
    ).toBe("12000.00");
  });
});
