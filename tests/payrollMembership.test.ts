import { isEmployeeIncludedInPayrollPeriod } from "../server/utils/payroll-membership";

describe("人力成本月度员工范围", () => {
  const monthStart = "2026-06-01";
  const monthEnd = "2026-06-30";

  it("入职当月加入，入职前月份不加入", () => {
    expect(
      isEmployeeIncludedInPayrollPeriod(
        {
          hireDate: "2026-06-18",
          approvedResignDate: null,
          employmentStatus: "active",
        },
        monthStart,
        monthEnd,
      ),
    ).toBe(true);
    expect(
      isEmployeeIncludedInPayrollPeriod(
        {
          hireDate: "2026-07-01",
          approvedResignDate: null,
          employmentStatus: "active",
        },
        monthStart,
        monthEnd,
      ),
    ).toBe(false);
  });

  it("离职当月保留，离职次月移除", () => {
    const employee = {
      hireDate: "2025-01-01",
      approvedResignDate: "2026-06-18",
      employmentStatus: "resigned",
    };
    expect(
      isEmployeeIncludedInPayrollPeriod(employee, "2026-06-01", "2026-06-30"),
    ).toBe(true);
    expect(
      isEmployeeIncludedInPayrollPeriod(employee, "2026-07-01", "2026-07-31"),
    ).toBe(false);
  });

  it("只有离职状态但没有离职日期时不误删历史月份", () => {
    expect(
      isEmployeeIncludedInPayrollPeriod(
        {
          hireDate: "2025-01-01",
          approvedResignDate: null,
          employmentStatus: "resigned",
        },
        monthStart,
        monthEnd,
      ),
    ).toBe(true);
  });
});
