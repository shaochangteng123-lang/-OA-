export interface PreviousPayrollMonthValues {
  monthly_salary: string;
  housing_fund_base: string;
  contribution_base: string;
}

export interface PayrollMonthDefaults {
  monthlySalary: string;
  housingFundBase: string;
  contributionBase: string;
  individualIncomeTax: string;
}

/**
 * 返回指定工资月份的上一个自然月，兼容跨年月份。
 */
export function getPreviousPayrollMonth(payrollMonth: string): string {
  const match = payrollMonth.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) throw new Error("工资月份格式无效");

  const previousMonth = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 2, 1),
  );
  return `${previousMonth.getUTCFullYear()}-${String(
    previousMonth.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

/**
 * 新月份沿用上月可修改的工资和缴费基数；应纳个税按月重新确认，默认清零。
 */
export function resolvePayrollMonthDefaults(
  automaticSalary: string,
  previousMonthValues?: PreviousPayrollMonthValues,
): PayrollMonthDefaults {
  return {
    monthlySalary: previousMonthValues?.monthly_salary ?? automaticSalary,
    housingFundBase: previousMonthValues?.housing_fund_base ?? automaticSalary,
    contributionBase: previousMonthValues?.contribution_base ?? automaticSalary,
    individualIncomeTax: "0",
  };
}
