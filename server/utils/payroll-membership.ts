export interface PayrollMembershipSource {
  hireDate: string | null;
  approvedResignDate: string | null;
  employmentStatus: string | null;
}

export function isEmployeeIncludedInPayrollPeriod(
  employee: PayrollMembershipSource,
  periodStartDate: string,
  periodEndDate: string,
): boolean {
  if (employee.hireDate && employee.hireDate > periodEndDate) return false;

  if (employee.approvedResignDate) {
    return employee.approvedResignDate >= periodStartDate;
  }

  // 没有可核验的离职日期时不能推断应从哪个月份移除，继续保留月度成员。
  return true;
}
