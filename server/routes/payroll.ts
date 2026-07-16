import { Router } from "express";
import { nanoid } from "nanoid";
import { db } from "../db/index.js";
import { requireAdmin } from "../middleware/auth.js";
import {
  calculateAutomaticMonthlySalary,
  calculatePayrollBreakdown,
  calculatePayrollTotals,
  comparePayrollAmounts,
  formatPayrollAmount,
  getPayrollMonthRange,
  normalizePayrollAmount,
  type PayrollAmountField,
} from "../services/payrollCalculator.js";

const router = Router();

interface EligibleEmployee {
  id: string;
  employee_no: string | null;
  name: string;
  department: string | null;
  position: string | null;
  hire_date: string | null;
  salary_start_date: string | null;
  contract_end_date: string | null;
  initial_monthly_salary: string | null;
}

interface StoredPayrollRow {
  id: string;
  employee_id: string;
  employee_no: string | null;
  employee_name: string;
  department: string | null;
  position: string | null;
  contract_end_date: string | null;
  initial_monthly_salary: string | null;
  automatic_salary: string;
  monthly_salary: string;
  contribution_base: string;
  individual_income_tax: string;
  monthly_salary_is_manual: boolean;
  contribution_base_is_manual: boolean;
  tax_is_manual: boolean;
  updated_at: string;
}

function getCurrentPayrollMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function buildPayrollRow(row: StoredPayrollRow) {
  const monthlySalary = formatPayrollAmount(row.monthly_salary);
  const contributionBase = formatPayrollAmount(row.contribution_base);
  const individualIncomeTax = formatPayrollAmount(row.individual_income_tax);
  const breakdown = calculatePayrollBreakdown(
    monthlySalary,
    contributionBase,
    individualIncomeTax,
  );

  return {
    id: row.id,
    employee_id: row.employee_id,
    employee_no: row.employee_no,
    employee_name: row.employee_name,
    department: row.department,
    position: row.position,
    contract_end_date: row.contract_end_date,
    initial_monthly_salary: row.initial_monthly_salary
      ? formatPayrollAmount(row.initial_monthly_salary)
      : null,
    automatic_salary: formatPayrollAmount(row.automatic_salary),
    monthly_salary: monthlySalary,
    contribution_base: contributionBase,
    individual_income_tax: individualIncomeTax,
    monthly_salary_is_manual: row.monthly_salary_is_manual,
    contribution_base_is_manual: row.contribution_base_is_manual,
    tax_is_manual: row.tax_is_manual,
    salary_recognized: row.initial_monthly_salary !== null,
    updated_at: row.updated_at,
    ...breakdown,
  };
}

async function loadPayrollRows(
  payrollMonth: string,
): Promise<ReturnType<typeof buildPayrollRow>[]> {
  const storedRows = (await db
    .prepare(
      `
    SELECT
      pr.id,
      pr.employee_id,
      COALESCE(u.employee_no, ep.employee_no) AS employee_no,
      ep.name AS employee_name,
      ep.department,
      ep.position,
      ep.contract_end_date,
      esp.initial_monthly_salary::text AS initial_monthly_salary,
      pr.automatic_salary::text AS automatic_salary,
      pr.monthly_salary::text AS monthly_salary,
      pr.contribution_base::text AS contribution_base,
      pr.individual_income_tax::text AS individual_income_tax,
      pr.monthly_salary_is_manual,
      pr.contribution_base_is_manual,
      pr.tax_is_manual,
      pr.updated_at
    FROM payroll_records pr
    JOIN employee_profiles ep ON ep.id = pr.employee_id
    LEFT JOIN users u ON u.id = ep.user_id
    LEFT JOIN employee_salary_profiles esp ON esp.employee_id = ep.id
    WHERE pr.payroll_month = ?
      AND COALESCE(u.role, 'user') <> 'super_admin'
    ORDER BY
      NULLIF(REGEXP_REPLACE(COALESCE(u.employee_no, ep.employee_no), '[^0-9]', '', 'g'), '')::int ASC NULLS LAST,
      ep.name ASC
  `,
    )
    .all(payrollMonth)) as StoredPayrollRow[];

  return storedRows.map(buildPayrollRow);
}

router.get("/", requireAdmin, async (req, res) => {
  try {
    const payrollMonth = String(req.query.month || getCurrentPayrollMonth());
    const { startDate, endDate } = getPayrollMonthRange(payrollMonth);
    const currentPayrollMonth = getCurrentPayrollMonth();
    const now = new Date().toISOString();

    await db.transaction(async (client) => {
      const employeeResult = await client.query<EligibleEmployee>(
        `SELECT
           ep.id,
           COALESCE(u.employee_no, ep.employee_no) AS employee_no,
           ep.name,
           ep.department,
           ep.position,
           ep.hire_date,
           COALESCE(
             (
               SELECT MIN(ed.contract_start_date)
               FROM employee_documents ed
               WHERE ed.employee_id = ep.id
                 AND ed.document_type = 'contract'
                 AND ed.contract_start_date IS NOT NULL
             ),
             ep.hire_date
           ) AS salary_start_date,
           ep.contract_end_date,
           esp.initial_monthly_salary::text AS initial_monthly_salary
         FROM employee_profiles ep
         LEFT JOIN users u ON u.id = ep.user_id
         LEFT JOIN employee_salary_profiles esp ON esp.employee_id = ep.id
         WHERE ep.status = 'submitted'
           AND COALESCE(u.role, 'user') <> 'super_admin'
           AND (ep.hire_date IS NULL OR ep.hire_date <= $1)
           AND (
             COALESCE(ep.employment_status, 'active') <> 'resigned'
             OR EXISTS (
               SELECT 1 FROM resignation_requests rr
               WHERE rr.employee_id = ep.id
                 AND rr.status = 'approved'
                 AND rr.resign_date >= $2
             )
           )
         ORDER BY ep.created_at ASC`,
        [endDate, startDate],
      );

      for (const employee of employeeResult.rows) {
        const automaticSalary = calculateAutomaticMonthlySalary(
          employee.initial_monthly_salary,
          employee.salary_start_date,
          payrollMonth,
        );

        const previousBaseResult = await client.query<{
          contribution_base: string;
        }>(
          `SELECT contribution_base::text AS contribution_base
           FROM payroll_records
           WHERE employee_id = $1 AND payroll_month < $2
           ORDER BY payroll_month DESC
           LIMIT 1`,
          [employee.id, payrollMonth],
        );
        const previousBase = previousBaseResult.rows[0]?.contribution_base;
        const defaultContributionBase =
          previousBase && comparePayrollAmounts(previousBase, "0") > 0
            ? previousBase
            : automaticSalary;

        await client.query(
          `INSERT INTO payroll_records (
             id, employee_id, payroll_month, automatic_salary, monthly_salary,
             contribution_base, individual_income_tax, created_at, updated_at
           ) VALUES ($1,$2,$3,$4::numeric,$4::numeric,$5::numeric,0,$6,$6)
           ON CONFLICT (employee_id, payroll_month) DO NOTHING`,
          [
            nanoid(),
            employee.id,
            payrollMonth,
            automaticSalary,
            defaultContributionBase,
            now,
          ],
        );

        // 历史月份是工资快照；仅本月及未来月份随未手工修改的基础数据重算。
        if (payrollMonth >= currentPayrollMonth) {
          await client.query(
            `UPDATE payroll_records
             SET automatic_salary = $1::numeric,
                 monthly_salary = CASE
                   WHEN monthly_salary_is_manual THEN monthly_salary ELSE $1::numeric
                 END,
                 contribution_base = CASE
                   WHEN contribution_base_is_manual THEN contribution_base ELSE $2::numeric
                 END,
                 updated_at = $3
             WHERE employee_id = $4 AND payroll_month = $5`,
            [
              automaticSalary,
              defaultContributionBase,
              now,
              employee.id,
              payrollMonth,
            ],
          );
        }
      }
    });

    const list = await loadPayrollRows(payrollMonth);
    const totals = calculatePayrollTotals(
      list as Array<Record<PayrollAmountField, string>>,
    );

    res.json({
      success: true,
      data: {
        month: payrollMonth,
        list,
        totals,
      },
    });
  } catch (error) {
    console.error("获取人力成本工资表失败:", error);
    const message =
      error instanceof Error ? error.message : "获取人力成本工资表失败";
    const status = message.includes("月份") ? 400 : 500;
    res.status(status).json({ success: false, message });
  }
});

router.patch("/:month/:employeeId", requireAdmin, async (req, res) => {
  try {
    const { month, employeeId } = req.params;
    getPayrollMonthRange(month);

    const hasMonthlySalary = Object.prototype.hasOwnProperty.call(
      req.body,
      "monthly_salary",
    );
    const hasContributionBase = Object.prototype.hasOwnProperty.call(
      req.body,
      "contribution_base",
    );
    const hasIncomeTax = Object.prototype.hasOwnProperty.call(
      req.body,
      "individual_income_tax",
    );
    if (!hasMonthlySalary && !hasContributionBase && !hasIncomeTax) {
      return res
        .status(400)
        .json({ success: false, message: "没有需要修改的工资字段" });
    }

    const monthlySalary = hasMonthlySalary
      ? normalizePayrollAmount(req.body.monthly_salary)
      : "0";
    const contributionBase = hasContributionBase
      ? normalizePayrollAmount(req.body.contribution_base)
      : "0";
    const incomeTax = hasIncomeTax
      ? normalizePayrollAmount(req.body.individual_income_tax)
      : "0";
    const now = new Date().toISOString();

    const result = await db.pool.query(
      `UPDATE payroll_records
       SET monthly_salary = CASE WHEN $1::boolean THEN $2::numeric ELSE monthly_salary END,
           contribution_base = CASE WHEN $3::boolean THEN $4::numeric ELSE contribution_base END,
           individual_income_tax = CASE WHEN $5::boolean THEN $6::numeric ELSE individual_income_tax END,
           monthly_salary_is_manual = monthly_salary_is_manual OR $1::boolean,
           contribution_base_is_manual = contribution_base_is_manual OR $3::boolean,
           tax_is_manual = tax_is_manual OR $5::boolean,
           updated_by = $7,
           updated_at = $8
       WHERE employee_id = $9 AND payroll_month = $10`,
      [
        hasMonthlySalary,
        monthlySalary,
        hasContributionBase,
        contributionBase,
        hasIncomeTax,
        incomeTax,
        req.session.userId,
        now,
        employeeId,
        month,
      ],
    );

    if ((result.rowCount ?? 0) !== 1) {
      return res
        .status(404)
        .json({ success: false, message: "工资记录不存在，请先刷新工资表" });
    }

    const list = await loadPayrollRows(month);
    const row = list.find((item) => item.employee_id === employeeId);
    res.json({ success: true, message: "工资数据已更新", data: row });
  } catch (error) {
    console.error("更新工资数据失败:", error);
    const message = error instanceof Error ? error.message : "更新工资数据失败";
    const status =
      message.includes("金额") || message.includes("月份") ? 400 : 500;
    res.status(status).json({ success: false, message });
  }
});

export default router;
