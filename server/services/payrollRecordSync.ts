import type { PoolClient } from "pg";
import { nanoid } from "nanoid";
import {
  calculateAutomaticMonthlySalary,
  comparePayrollAmounts,
} from "./payrollCalculator.js";

interface PayrollSyncOptions {
  resetManualMonthlySalary: boolean;
  ensureCurrentMonth: boolean;
  updatedAt: string;
}

interface SalarySourceRow {
  initial_monthly_salary: string | null;
  salary_start_date: string | null;
}

function getCurrentPayrollMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function syncEmployeeCurrentAndFuturePayroll(
  client: PoolClient,
  employeeId: string,
  options: PayrollSyncOptions,
): Promise<number> {
  const currentPayrollMonth = getCurrentPayrollMonth();
  const sourceResult = await client.query<SalarySourceRow>(
    `SELECT
       esp.initial_monthly_salary::text AS initial_monthly_salary,
       COALESCE(
         (
           SELECT MIN(ed.contract_start_date)
           FROM employee_documents ed
           WHERE ed.employee_id = ep.id
             AND ed.document_type = 'contract'
             AND ed.contract_start_date IS NOT NULL
         ),
         ep.hire_date
       ) AS salary_start_date
     FROM employee_profiles ep
     LEFT JOIN employee_salary_profiles esp ON esp.employee_id = ep.id
     WHERE ep.id = $1`,
    [employeeId],
  );
  const source = sourceResult.rows[0];
  if (!source?.initial_monthly_salary) return 0;

  const currentAutomaticSalary = calculateAutomaticMonthlySalary(
    source.initial_monthly_salary,
    source.salary_start_date,
    currentPayrollMonth,
  );

  if (options.ensureCurrentMonth) {
    const previousBaseResult = await client.query<{
      contribution_base: string;
    }>(
      `SELECT contribution_base::text AS contribution_base
       FROM payroll_records
       WHERE employee_id = $1 AND payroll_month < $2
       ORDER BY payroll_month DESC
       LIMIT 1`,
      [employeeId, currentPayrollMonth],
    );
    const previousBase = previousBaseResult.rows[0]?.contribution_base;
    const defaultContributionBase =
      previousBase && comparePayrollAmounts(previousBase, "0") > 0
        ? previousBase
        : currentAutomaticSalary;

    await client.query(
      `INSERT INTO payroll_records (
         id, employee_id, payroll_month, automatic_salary, monthly_salary,
         contribution_base, individual_income_tax, created_at, updated_at
       ) VALUES ($1,$2,$3,$4::numeric,$4::numeric,$5::numeric,0,$6,$6)
       ON CONFLICT (employee_id, payroll_month) DO NOTHING`,
      [
        nanoid(),
        employeeId,
        currentPayrollMonth,
        currentAutomaticSalary,
        defaultContributionBase,
        options.updatedAt,
      ],
    );
  }

  const payrollResult = await client.query<{ payroll_month: string }>(
    `SELECT payroll_month
     FROM payroll_records
     WHERE employee_id = $1 AND payroll_month >= $2
     ORDER BY payroll_month ASC
     FOR UPDATE`,
    [employeeId, currentPayrollMonth],
  );

  for (const payroll of payrollResult.rows) {
    const automaticSalary = calculateAutomaticMonthlySalary(
      source.initial_monthly_salary,
      source.salary_start_date,
      payroll.payroll_month,
    );
    await client.query(
      `UPDATE payroll_records
       SET automatic_salary = $1::numeric,
           monthly_salary = CASE
             WHEN $2::boolean OR NOT monthly_salary_is_manual
               THEN $1::numeric
             ELSE monthly_salary
           END,
           monthly_salary_is_manual = CASE
             WHEN $2::boolean THEN FALSE ELSE monthly_salary_is_manual
           END,
           updated_at = $3
       WHERE employee_id = $4 AND payroll_month = $5`,
      [
        automaticSalary,
        options.resetManualMonthlySalary,
        options.updatedAt,
        employeeId,
        payroll.payroll_month,
      ],
    );
  }

  return payrollResult.rows.length;
}
