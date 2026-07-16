import type { PoolClient } from "pg";

jest.mock("nanoid", () => ({ nanoid: () => "payroll-test-id" }));

import { syncEmployeeCurrentAndFuturePayroll } from "../server/services/payrollRecordSync";

describe("邀请函薪资同步", () => {
  it("上传新邀请函时覆盖当月手工工资，但不改缴费基数和个税", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FROM employee_profiles ep")) {
        return {
          rows: [
            {
              initial_monthly_salary: "8000",
              salary_start_date: "2025-06-16",
            },
          ],
        };
      }
      if (sql.includes("payroll_month <")) {
        return { rows: [{ contribution_base: "7162" }] };
      }
      if (sql.includes("INSERT INTO payroll_records")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT payroll_month")) {
        return { rows: [{ payroll_month: "2026-07" }] };
      }
      if (sql.includes("UPDATE payroll_records")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`出现未处理的测试查询：${sql}`);
    });

    await syncEmployeeCurrentAndFuturePayroll(
      { query } as unknown as PoolClient,
      "employee-1",
      {
        resetManualMonthlySalary: true,
        ensureCurrentMonth: true,
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
    );

    const updateCall = query.mock.calls.find(([sql]) =>
      sql.includes("UPDATE payroll_records"),
    );
    expect(updateCall?.[1]).toEqual([
      "9000.00",
      true,
      "2026-07-16T00:00:00.000Z",
      "employee-1",
      "2026-07",
    ]);
    expect(updateCall?.[0]).not.toContain("contribution_base =");
    expect(updateCall?.[0]).not.toContain("individual_income_tax =");
  });
});
