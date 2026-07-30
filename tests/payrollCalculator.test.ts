import {
  calculateAutomaticMonthlySalary,
  calculatePayrollBreakdown,
  calculatePayrollTotals,
  countCompletedSalaryYears,
} from "../server/services/payrollCalculator";

describe("工资精确计算", () => {
  it("按工资表公式计算 8000 元样例", () => {
    expect(calculatePayrollBreakdown("8000", "8000", "8000", "50.31")).toEqual({
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

  it("分别按公积金和社保缴费基数计算，每个险种先四舍五入至分再合计", () => {
    const result = calculatePayrollBreakdown("7000", "6000", "7162", "26.55");

    expect(result.company_medical).toBe("701.88");
    expect(result.company_injury).toBe("28.65");
    expect(result.company_social_total).toBe("1912.26");
    expect(result.withheld_social).toBe("2667.27");
    expect(result.company_housing_fund).toBe("360.00");
    expect(result.withheld_total).toBe("3413.82");
    expect(result.net_salary).toBe("5858.44");
  });

  it("缴费基数为零时不产生固定 3 元医疗费用", () => {
    const result = calculatePayrollBreakdown("0", "0", "0", "0");

    expect(result.personal_medical).toBe("0.00");
    expect(result.net_salary).toBe("0.00");
  });

  it("按图片中的六人工资表计算各列合计", () => {
    const createRow = (
      salary: string,
      housingFundBase: string,
      socialInsuranceBase: string,
      tax: string,
    ) => ({
      monthly_salary: salary,
      housing_fund_base: housingFundBase,
      contribution_base: socialInsuranceBase,
      individual_income_tax: tax,
      ...calculatePayrollBreakdown(
        salary,
        housingFundBase,
        socialInsuranceBase,
        tax,
      ),
    });
    const totals = calculatePayrollTotals([
      createRow("8000", "8000", "8000", "50.31"),
      createRow("7000", "6000", "7162", "26.55"),
      createRow("9000", "9000", "9000", "0"),
      createRow("10000", "10000", "10000", "100.41"),
      createRow("9000", "8000", "8000", "80.31"),
      createRow("10000", "10000", "10000", "55.41"),
    ]);

    expect(totals.monthly_salary).toBe("53000.00");
    expect(totals.housing_fund_base).toBe("51000.00");
    expect(totals.contribution_base).toBe("52162.00");
    expect(totals.company_social_total).toBe("13927.26");
    expect(totals.company_housing_fund).toBe("3060.00");
    expect(totals.company_paid_total).toBe("16987.26");
    expect(totals.withheld_social).toBe("19422.27");
    expect(totals.withheld_housing_fund).toBe("6120.00");
    expect(totals.withheld_tax).toBe("312.99");
    expect(totals.withheld_total).toBe("25855.26");
    expect(totals.personal_social_total).toBe("5495.01");
    expect(totals.personal_housing_fund).toBe("3060.00");
    expect(totals.net_salary).toBe("44132.00");
    expect(totals.cost_total).toBe("69987.26");
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
