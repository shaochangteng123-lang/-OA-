import { Router } from "express";
import { db } from "../db/index.js";
import { requireRole } from "../middleware/auth.js";
import {
  calculatePayrollBreakdown,
  calculatePayrollTotals,
  formatPayrollAmount,
  type PayrollAmountField,
} from "../services/payrollCalculator.js";

const router = Router();

const DASHBOARD_MONTH_COUNT = 12;
const MAX_DASHBOARD_MONTH_COUNT = 24;
const STALE_PROJECT_DAYS = 7;
const METRIC_REGISTRY_VERSION = "1.0.0";
const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

type MetricUnit = "元" | "%" | "人" | "个";
type MetricCategory = "成本" | "人员" | "项目" | "风险";

export interface BossDashboardMetricDefinition {
  code: string;
  key:
    | "registeredTotalCost"
    | "humanCost"
    | "reimbursementCost"
    | "humanCostRatio"
    | "averageHumanCost"
    | "activeEmployees"
    | "activeProjects"
    | "riskProjects";
  name: string;
  category: MetricCategory;
  unit: MetricUnit;
  description: string;
  formula: string;
  source: string[];
  permission: "boss_dashboard_view";
  updateFrequency: "请求时实时计算";
  drilldownPath: string | null;
  visualization: "number";
  sortOrder: number;
  version: number;
  enabled: boolean;
}

/**
 * 羽隶经营看板指标注册表。
 *
 * 新业务模块需要进入羽隶经营看板时，应先增加指标定义，再在汇总函数中提供
 * 对应的数据源和可用性判断。看板只加载 enabled=true 的指标。
 */
export const BOSS_DASHBOARD_METRICS: ReadonlyArray<BossDashboardMetricDefinition> =
  Object.freeze([
    {
      code: "cost.registered_total.month",
      key: "registeredTotalCost",
      name: "所选周期已登记总成本",
      category: "成本",
      unit: "元",
      description: "所选周期内系统能够追溯的人力成本与报销费用合计",
      formula: "所选周期人力成本 + 所选周期报销费用",
      source: ["payroll_records", "reimbursements"],
      permission: "boss_dashboard_view",
      updateFrequency: "请求时实时计算",
      drilldownPath: null,
      visualization: "number",
      sortOrder: 10,
      version: 1,
      enabled: true,
    },
    {
      code: "cost.human.month",
      key: "humanCost",
      name: "所选周期人力成本",
      category: "成本",
      unit: "元",
      description: "所选周期工资与单位承担社保、公积金的合计",
      formula: "工资 + 单位承担社保 + 单位承担公积金",
      source: ["payroll_records"],
      permission: "boss_dashboard_view",
      updateFrequency: "请求时实时计算",
      drilldownPath: null,
      visualization: "number",
      sortOrder: 20,
      version: 1,
      enabled: true,
    },
    {
      code: "cost.reimbursement.month",
      key: "reimbursementCost",
      name: "所选周期报销费用",
      category: "成本",
      unit: "元",
      description: "按报销归属月份统计且已进入业务流程的报销金额",
      formula: "非草稿、非驳回、未删除报销单金额之和",
      source: ["reimbursements"],
      permission: "boss_dashboard_view",
      updateFrequency: "请求时实时计算",
      drilldownPath: null,
      visualization: "number",
      sortOrder: 30,
      version: 1,
      enabled: true,
    },
    {
      code: "cost.human_ratio.month",
      key: "humanCostRatio",
      name: "所选周期人力成本占比",
      category: "成本",
      unit: "%",
      description: "人力成本占系统已登记总成本的比例",
      formula: "所选周期人力成本 ÷ 所选周期已登记总成本 × 100%",
      source: ["payroll_records", "reimbursements"],
      permission: "boss_dashboard_view",
      updateFrequency: "请求时实时计算",
      drilldownPath: null,
      visualization: "number",
      sortOrder: 40,
      version: 1,
      enabled: true,
    },
    {
      code: "cost.human_average.month",
      key: "averageHumanCost",
      name: "所选周期人均／人月均人力成本",
      category: "成本",
      unit: "元",
      description:
        "单月按工资记录人数计算人均金额，多月按工资记录人次计算人月均金额",
      formula: "所选周期人力成本 ÷ 所选周期工资记录人次",
      source: ["payroll_records"],
      permission: "boss_dashboard_view",
      updateFrequency: "请求时实时计算",
      drilldownPath: null,
      visualization: "number",
      sortOrder: 50,
      version: 1,
      enabled: true,
    },
    {
      code: "people.active.current",
      key: "activeEmployees",
      name: "当前在职人数",
      category: "人员",
      unit: "人",
      description: "已提交档案且未离职的员工人数",
      formula: "正式 + 试用期 + 请假员工",
      source: ["employee_profiles"],
      permission: "boss_dashboard_view",
      updateFrequency: "请求时实时计算",
      drilldownPath: null,
      visualization: "number",
      sortOrder: 60,
      version: 1,
      enabled: true,
    },
    {
      code: "project.active.current",
      key: "activeProjects",
      name: "当前在办项目",
      category: "项目",
      unit: "个",
      description: "结构化项目中尚未办结的项目数量",
      formula: "is_completed=false 的项目数量",
      source: ["worklog_projects"],
      permission: "boss_dashboard_view",
      updateFrequency: "请求时实时计算",
      drilldownPath: null,
      visualization: "number",
      sortOrder: 70,
      version: 1,
      enabled: true,
    },
    {
      code: "risk.project.current",
      key: "riskProjects",
      name: "当前风险项目",
      category: "风险",
      unit: "个",
      description: "存在事项逾期、跟进到期或长期未更新的在办项目数量",
      formula: "三类风险关联项目去重计数",
      source: ["worklog_projects", "worklog_entries", "worklog_matters"],
      permission: "boss_dashboard_view",
      updateFrequency: "请求时实时计算",
      drilldownPath: null,
      visualization: "number",
      sortOrder: 80,
      version: 1,
      enabled: true,
    },
  ]);

interface MetricValue {
  code: string;
  name: string;
  value: number | null;
  unit: MetricUnit;
  available: boolean;
  reason: string | null;
  month: string | null;
}

interface PayrollRow {
  payroll_month: string;
  monthly_salary: string;
  housing_fund_base: string;
  contribution_base: string;
  individual_income_tax: string;
  updated_at: string;
}

interface PayrollMonthSummary {
  month: string;
  recordCount: number;
  salary: number;
  companySocial: number;
  personalSocial: number;
  companyHousingFund: number;
  personalHousingFund: number;
  individualIncomeTax: number;
  total: number;
}

interface ReimbursementMonthRow {
  month: string;
  record_count: number;
  amount: number;
  last_updated_at: string | null;
}

type ReimbursementType = "basic" | "large" | "business";

interface ReimbursementTypeMonthRow extends ReimbursementMonthRow {
  type: ReimbursementType;
}

interface ReimbursementTypeSummaryRow {
  type: ReimbursementType;
  record_count: number;
  amount: number;
}

interface ReimbursementDistributionRow {
  name: string | null;
  record_count: number;
  amount: number;
}

interface ReimbursementDetailRow {
  id: string;
  type: ReimbursementType;
  title: string;
  amount: number;
  applicant_name: string;
  reimbursement_month: string;
  district_name: string | null;
  scope_name: string | null;
  service_unit: string | null;
  status: string;
  updated_at: string;
}

interface EligibleLogUserRow {
  id: string;
  name: string;
  department: string | null;
  position: string | null;
}

interface DailyLogItemRow {
  id: string;
  user_id: string;
  user_name: string;
  department: string | null;
  position: string | null;
  log_date: string;
  content: string;
  state: "written" | "archived";
  updated_at: string;
}

interface WeeklyLogItemRow {
  id: string;
  user_id: string;
  user_name: string;
  department: string | null;
  position: string | null;
  week_start: string;
  week_end: string;
  summary_content: string;
  generated_at: string;
}

interface WorkLogSourceAggregate {
  record_count: number;
  last_updated_at: string | null;
}

interface EmployeeAggregate {
  total: number;
  active: number;
  probation: number;
  on_leave: number;
  resigned: number;
  new_hires_this_month: number;
  missing_hire_date: number;
  last_updated_at: string | null;
}

interface DistributionRow {
  name: string | null;
  count: number;
}

interface ProjectAggregate {
  total: number;
  active: number;
  completed: number;
  last_updated_at: string | null;
}

interface OverdueMatterRow {
  project_id: string;
  project_name: string;
  owner_name: string;
  matter: string;
  first_date: string;
  days_elapsed: number;
  standard_days: number;
}

interface DueFollowUpRow {
  entry_id: string;
  project_id: string;
  project_name: string;
  owner_name: string;
  matter: string;
  next_follow_up_date: string;
}

interface StaleProjectRow {
  project_id: string;
  project_name: string;
  owner_name: string;
  last_updated_at: string;
}

interface SourceQuality {
  available: boolean;
  recordCount: number;
  latestMonth: string | null;
  lastUpdatedAt: string | null;
}

interface DataQualityIssue {
  code: string;
  level: "warning" | "error";
  message: string;
  affectedMetrics: string[];
}

interface RiskItem {
  projectId: string;
  projectName: string;
  ownerName: string;
  type: "overdue_matter" | "due_follow_up" | "stale_project";
  level: "high" | "medium";
  description: string;
  occurredAt: string;
}

function getBeijingDateParts(): {
  year: number;
  month: number;
  day: number;
  date: string;
  monthKey: string;
} {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const monthText = String(month).padStart(2, "0");
  const dayText = String(day).padStart(2, "0");

  return {
    year,
    month,
    day,
    date: `${year}-${monthText}-${dayText}`,
    monthKey: `${year}-${monthText}`,
  };
}

function buildRecentMonths(
  year: number,
  month: number,
  count = DASHBOARD_MONTH_COUNT,
): string[] {
  return Array.from({ length: count }, (_, index) => {
    const offset = index - count + 1;
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
      2,
      "0",
    )}`;
  });
}

function buildMonthRange(startMonth: string, endMonth: string): string[] {
  if (
    !MONTH_KEY_PATTERN.test(startMonth) ||
    !MONTH_KEY_PATTERN.test(endMonth)
  ) {
    throw new Error("月份格式应为YYYY-MM");
  }

  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const startIndex = startYear * 12 + startMonthNumber - 1;
  const endIndex = endYear * 12 + endMonthNumber - 1;
  const monthCount = endIndex - startIndex + 1;

  if (monthCount <= 0) {
    throw new Error("开始月份不能晚于结束月份");
  }
  if (monthCount > MAX_DASHBOARD_MONTH_COUNT) {
    throw new Error(`趋势查询范围不能超过${MAX_DASHBOARD_MONTH_COUNT}个月`);
  }

  return Array.from({ length: monthCount }, (_item, index) => {
    const date = new Date(Date.UTC(startYear, startMonthNumber - 1 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
      2,
      "0",
    )}`;
  });
}

function describeDashboardPeriod(
  months: string[],
  currentMonth: string,
): {
  scope: "month" | "yearToDate" | "year" | "range";
  label: string;
  financialMetricAggregation: "selectedPeriodSum";
} {
  const startMonth = months[0];
  const endMonth = months.at(-1) ?? startMonth;
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);

  if (months.length === 1) {
    return {
      scope: "month",
      label: `${startYear}年${startMonthNumber}月`,
      financialMetricAggregation: "selectedPeriodSum",
    };
  }

  if (
    startYear === endYear &&
    startMonthNumber === 1 &&
    endMonthNumber === 12
  ) {
    return {
      scope: "year",
      label: `${startYear}年`,
      financialMetricAggregation: "selectedPeriodSum",
    };
  }

  if (
    startYear === endYear &&
    startMonthNumber === 1 &&
    endMonth === currentMonth
  ) {
    return {
      scope: "yearToDate",
      label: `${startYear}年累计`,
      financialMetricAggregation: "selectedPeriodSum",
    };
  }

  return {
    scope: "range",
    label: `${startYear}年${startMonthNumber}月至${endYear}年${endMonthNumber}月`,
    financialMetricAggregation: "selectedPeriodSum",
  };
}

function subtractDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
}

function getWeekRange(dateText: string): {
  weekStart: string;
  weekEnd: string;
} {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const dayOfWeek = date.getUTCDay() || 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - dayOfWeek + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10),
  };
}

function toAmount(value: string | number): number {
  return Number(Number(value).toFixed(2));
}

function buildPayrollMonthSummaries(
  months: string[],
  rows: PayrollRow[],
): Map<string, PayrollMonthSummary> {
  const rowsByMonth = new Map<string, PayrollRow[]>();
  for (const row of rows) {
    const current = rowsByMonth.get(row.payroll_month) ?? [];
    current.push(row);
    rowsByMonth.set(row.payroll_month, current);
  }

  const result = new Map<string, PayrollMonthSummary>();
  for (const month of months) {
    const monthRows = rowsByMonth.get(month) ?? [];
    if (monthRows.length === 0) continue;

    const payrollRows = monthRows.map((row) => {
      const monthlySalary = formatPayrollAmount(row.monthly_salary);
      const housingFundBase = formatPayrollAmount(row.housing_fund_base);
      const contributionBase = formatPayrollAmount(row.contribution_base);
      const individualIncomeTax = formatPayrollAmount(
        row.individual_income_tax,
      );
      const breakdown = calculatePayrollBreakdown(
        monthlySalary,
        housingFundBase,
        contributionBase,
        individualIncomeTax,
      );

      return {
        monthly_salary: monthlySalary,
        housing_fund_base: housingFundBase,
        contribution_base: contributionBase,
        individual_income_tax: individualIncomeTax,
        ...breakdown,
      } satisfies Record<PayrollAmountField, string>;
    });
    const totals = calculatePayrollTotals(payrollRows);

    result.set(month, {
      month,
      recordCount: monthRows.length,
      salary: toAmount(totals.monthly_salary),
      companySocial: toAmount(totals.company_social_total),
      personalSocial: toAmount(totals.personal_social_total),
      companyHousingFund: toAmount(totals.company_housing_fund),
      personalHousingFund: toAmount(totals.personal_housing_fund),
      individualIncomeTax: toAmount(totals.individual_income_tax),
      total: toAmount(totals.cost_total),
    });
  }

  return result;
}

function metricValue(
  key: BossDashboardMetricDefinition["key"],
  value: number | null,
  month: string | null,
  reason: string | null = null,
): MetricValue {
  const definition = BOSS_DASHBOARD_METRICS.find(
    (metric) => metric.key === key,
  );
  if (!definition) {
    throw new Error(`未找到羽隶经营看板指标定义：${key}`);
  }

  return {
    code: definition.code,
    name: definition.name,
    value,
    unit: definition.unit,
    available: value !== null,
    reason: value === null ? reason || "数据暂不可用" : null,
    month,
  };
}

function latestTimestamp(
  values: Array<string | null | undefined>,
): string | null {
  const availableValues = values.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return availableValues.sort().at(-1) ?? null;
}

async function loadPayrollRows(
  startMonth: string,
  endMonth: string,
): Promise<PayrollRow[]> {
  return db.all<PayrollRow>(
    `SELECT
       pr.payroll_month,
       pr.monthly_salary::text AS monthly_salary,
       pr.housing_fund_base::text AS housing_fund_base,
       pr.contribution_base::text AS contribution_base,
       pr.individual_income_tax::text AS individual_income_tax,
       pr.updated_at
     FROM payroll_records pr
     JOIN employee_profiles ep ON ep.id = pr.employee_id
     LEFT JOIN users u ON u.id = ep.user_id
     WHERE pr.payroll_month BETWEEN ? AND ?
       AND COALESCE(u.role, 'user') NOT IN ('super_admin', 'boss')
     ORDER BY pr.payroll_month ASC`,
    startMonth,
    endMonth,
  );
}

async function loadIncurredReimbursements(
  startMonth: string,
  endMonth: string,
): Promise<ReimbursementMonthRow[]> {
  return db.all<ReimbursementMonthRow>(
    `SELECT
       reimbursement_month AS month,
       COUNT(*)::int AS record_count,
       COALESCE(SUM(total_amount), 0)::numeric AS amount,
       MAX(updated_at) AS last_updated_at
     FROM reimbursements
     WHERE COALESCE(is_deleted, FALSE) = FALSE
       AND status NOT IN ('draft', 'rejected')
       AND reimbursement_month BETWEEN ? AND ?
     GROUP BY reimbursement_month
     ORDER BY reimbursement_month ASC`,
    startMonth,
    endMonth,
  );
}

async function loadPaidReimbursements(
  startMonth: string,
  endMonth: string,
): Promise<ReimbursementMonthRow[]> {
  return db.all<ReimbursementMonthRow>(
    `SELECT
       LEFT(COALESCE(paid_time, pay_time, completed_time), 7) AS month,
       COUNT(*)::int AS record_count,
       COALESCE(SUM(total_amount), 0)::numeric AS amount,
       MAX(updated_at) AS last_updated_at
     FROM reimbursements
     WHERE COALESCE(is_deleted, FALSE) = FALSE
       AND status NOT IN ('draft', 'rejected')
       AND COALESCE(paid_time, pay_time, completed_time) IS NOT NULL
       AND LEFT(COALESCE(paid_time, pay_time, completed_time), 7)
         BETWEEN ? AND ?
     GROUP BY LEFT(COALESCE(paid_time, pay_time, completed_time), 7)
     ORDER BY month ASC`,
    startMonth,
    endMonth,
  );
}

async function loadIncurredReimbursementsByType(
  startMonth: string,
  endMonth: string,
): Promise<ReimbursementTypeMonthRow[]> {
  return db.all<ReimbursementTypeMonthRow>(
    `SELECT
       reimbursement_month AS month,
       type,
       COUNT(*)::int AS record_count,
       COALESCE(SUM(total_amount), 0)::numeric AS amount,
       MAX(updated_at) AS last_updated_at
     FROM reimbursements
     WHERE COALESCE(is_deleted, FALSE) = FALSE
       AND status NOT IN ('draft', 'rejected')
       AND reimbursement_month BETWEEN ? AND ?
     GROUP BY reimbursement_month, type
     ORDER BY reimbursement_month ASC, type ASC`,
    startMonth,
    endMonth,
  );
}

async function loadReimbursementAnalysis(
  startMonth: string,
  endMonth: string,
): Promise<{
  byType: ReimbursementTypeSummaryRow[];
  byDistrict: ReimbursementDistributionRow[];
  byServiceUnit: ReimbursementDistributionRow[];
  recentItems: ReimbursementDetailRow[];
}> {
  const commonWhere = `
    COALESCE(r.is_deleted, FALSE) = FALSE
    AND r.status NOT IN ('draft', 'rejected')
    AND r.reimbursement_month BETWEEN ? AND ?
  `;

  const [byType, byDistrict, byServiceUnit, recentItems] = await Promise.all([
    db.all<ReimbursementTypeSummaryRow>(
      `SELECT
         r.type,
         COUNT(*)::int AS record_count,
         COALESCE(SUM(r.total_amount), 0)::numeric AS amount
       FROM reimbursements r
       WHERE ${commonWhere}
       GROUP BY r.type
       ORDER BY r.type ASC`,
      startMonth,
      endMonth,
    ),
    db.all<ReimbursementDistributionRow>(
      `SELECT
         COALESCE(parent.name, leaf.name, r.reimbursement_scope) AS name,
         COUNT(*)::int AS record_count,
         COALESCE(SUM(r.total_amount), 0)::numeric AS amount
       FROM reimbursements r
       LEFT JOIN reimbursement_scopes leaf
         ON leaf.value = r.reimbursement_scope
       LEFT JOIN reimbursement_scopes parent
         ON parent.id = leaf.parent_id
       WHERE ${commonWhere}
         AND NULLIF(TRIM(r.reimbursement_scope), '') IS NOT NULL
       GROUP BY COALESCE(parent.name, leaf.name, r.reimbursement_scope)
       ORDER BY amount DESC, name ASC
       LIMIT 10`,
      startMonth,
      endMonth,
    ),
    db.all<ReimbursementDistributionRow>(
      `SELECT
         TRIM(r.service_target) AS name,
         COUNT(*)::int AS record_count,
         COALESCE(SUM(r.total_amount), 0)::numeric AS amount
       FROM reimbursements r
       WHERE ${commonWhere}
         AND NULLIF(TRIM(r.service_target), '') IS NOT NULL
       GROUP BY TRIM(r.service_target)
       ORDER BY amount DESC, name ASC
       LIMIT 10`,
      startMonth,
      endMonth,
    ),
    db.all<ReimbursementDetailRow>(
      `SELECT
         r.id,
         r.type,
         r.title,
         r.total_amount::numeric AS amount,
         r.applicant_name,
         r.reimbursement_month,
         COALESCE(parent.name, leaf.name, r.reimbursement_scope) AS district_name,
         COALESCE(leaf.name, r.reimbursement_scope) AS scope_name,
         NULLIF(TRIM(r.service_target), '') AS service_unit,
         r.status,
         r.updated_at
       FROM reimbursements r
       LEFT JOIN reimbursement_scopes leaf
         ON leaf.value = r.reimbursement_scope
       LEFT JOIN reimbursement_scopes parent
         ON parent.id = leaf.parent_id
       WHERE ${commonWhere}
       ORDER BY COALESCE(r.submit_time, r.updated_at) DESC, r.id ASC
       LIMIT 12`,
      startMonth,
      endMonth,
    ),
  ]);

  return {
    byType,
    byDistrict,
    byServiceUnit,
    recentItems,
  };
}

async function loadEmployeeAggregate(
  currentMonth: string,
): Promise<EmployeeAggregate> {
  const aggregate = await db.get<EmployeeAggregate>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (
         WHERE COALESCE(ep.employment_status, 'active') = 'active'
       )::int AS active,
       COUNT(*) FILTER (
         WHERE ep.employment_status = 'probation'
       )::int AS probation,
       COUNT(*) FILTER (
         WHERE ep.employment_status = 'on_leave'
       )::int AS on_leave,
       COUNT(*) FILTER (
         WHERE ep.employment_status = 'resigned'
       )::int AS resigned,
       COUNT(*) FILTER (
         WHERE LEFT(ep.hire_date, 7) = ?
       )::int AS new_hires_this_month,
       COUNT(*) FILTER (
         WHERE ep.hire_date IS NULL
       )::int AS missing_hire_date,
       MAX(ep.updated_at) AS last_updated_at
     FROM employee_profiles ep
     LEFT JOIN users u ON u.id = ep.user_id
     WHERE ep.status = 'submitted'
       AND COALESCE(u.role, 'user') NOT IN ('super_admin', 'boss')`,
    currentMonth,
  );

  return (
    aggregate ?? {
      total: 0,
      active: 0,
      probation: 0,
      on_leave: 0,
      resigned: 0,
      new_hires_this_month: 0,
      missing_hire_date: 0,
      last_updated_at: null,
    }
  );
}

async function loadEmployeeDepartments(): Promise<DistributionRow[]> {
  return db.all<DistributionRow>(
    `SELECT
       NULLIF(TRIM(ep.department), '') AS name,
       COUNT(*)::int AS count
     FROM employee_profiles ep
     LEFT JOIN users u ON u.id = ep.user_id
     WHERE ep.status = 'submitted'
       AND COALESCE(ep.employment_status, 'active') <> 'resigned'
       AND COALESCE(u.role, 'user') NOT IN ('super_admin', 'boss')
     GROUP BY NULLIF(TRIM(ep.department), '')
     ORDER BY count DESC, name ASC`,
  );
}

async function loadWorkLogOverview(today: string): Promise<{
  available: boolean;
  recordCount: number;
  lastUpdatedAt: string | null;
  daily: {
    date: string;
    eligibleCount: number;
    writtenCount: number;
    archivedCount: number;
    missingCount: number;
    completionRate: number | null;
    missingUsers: EligibleLogUserRow[];
    items: DailyLogItemRow[];
  };
  weekly: {
    currentWeekStart: string;
    currentWeekEnd: string;
    eligibleCount: number;
    generatedCount: number;
    missingCount: number;
    completionRate: number | null;
    missingUsers: EligibleLogUserRow[];
    displayWeekStart: string;
    displayWeekEnd: string;
    isCurrentWeek: boolean;
    items: WeeklyLogItemRow[];
  };
}> {
  const { weekStart, weekEnd } = getWeekRange(today);
  const [
    eligibleUsers,
    writtenToday,
    archivedToday,
    recentDailyItems,
    currentWeeklyItems,
    latestWeeklyRange,
    sourceAggregate,
  ] = await Promise.all([
    db.all<EligibleLogUserRow>(
      `SELECT
         u.id,
         u.name,
         COALESCE(NULLIF(TRIM(ep.department), ''), NULLIF(TRIM(u.department), '')) AS department,
         COALESCE(NULLIF(TRIM(ep.position), ''), NULLIF(TRIM(u.position), '')) AS position
       FROM users u
       JOIN employee_profiles ep ON ep.user_id = u.id
       WHERE u.status = 'active'
         AND ep.status = 'submitted'
         AND COALESCE(ep.employment_status, 'active') <> 'resigned'
         AND u.role NOT IN ('guest', 'super_admin', 'boss')
       ORDER BY u.name ASC`,
    ),
    db.all<{ user_id: string }>(
      `SELECT DISTINCT user_id
       FROM (
         SELECT user_id
         FROM daily_logs
         WHERE log_date = ?
           AND NULLIF(TRIM(content), '') IS NOT NULL
         UNION
         SELECT user_id
         FROM daily_log_submissions
         WHERE log_date = ?
       ) written_today`,
      today,
      today,
    ),
    db.all<{ user_id: string }>(
      `SELECT DISTINCT user_id
       FROM daily_log_submissions
       WHERE log_date = ?`,
      today,
    ),
    db.all<DailyLogItemRow>(
      `WITH candidates AS (
         SELECT
           s.id,
           s.user_id,
           s.log_date,
           LEFT(s.content, 1600) AS content,
           'archived'::text AS state,
           s.submitted_at AS updated_at,
           0 AS source_priority
         FROM daily_log_submissions s
         UNION ALL
         SELECT
           d.id,
           d.user_id,
           d.log_date,
           LEFT(d.content, 1600) AS content,
           'written'::text AS state,
           d.updated_at,
           1 AS source_priority
         FROM daily_logs d
         WHERE NULLIF(TRIM(d.content), '') IS NOT NULL
       ),
       ranked AS (
         SELECT
           candidates.*,
           ROW_NUMBER() OVER (
             PARTITION BY user_id, log_date
             ORDER BY source_priority ASC, updated_at DESC
           ) AS row_number
         FROM candidates
       )
       SELECT
         ranked.id,
         ranked.user_id,
         u.name AS user_name,
         COALESCE(NULLIF(TRIM(ep.department), ''), NULLIF(TRIM(u.department), '')) AS department,
         COALESCE(NULLIF(TRIM(ep.position), ''), NULLIF(TRIM(u.position), '')) AS position,
         ranked.log_date,
         ranked.content,
         ranked.state,
         ranked.updated_at
       FROM ranked
       JOIN users u ON u.id = ranked.user_id
       LEFT JOIN employee_profiles ep ON ep.user_id = ranked.user_id
       WHERE ranked.row_number = 1
         AND u.role NOT IN ('guest', 'super_admin', 'boss')
       ORDER BY ranked.log_date DESC, ranked.updated_at DESC
       LIMIT 10`,
    ),
    db.all<WeeklyLogItemRow>(
      `SELECT
         ws.id,
         ws.user_id,
         u.name AS user_name,
         COALESCE(NULLIF(TRIM(ep.department), ''), NULLIF(TRIM(u.department), '')) AS department,
         COALESCE(NULLIF(TRIM(ep.position), ''), NULLIF(TRIM(u.position), '')) AS position,
         ws.week_start,
         ws.week_end,
         LEFT(ws.summary_content, 2200) AS summary_content,
         ws.generated_at
       FROM weekly_summaries ws
       JOIN users u ON u.id = ws.user_id
       LEFT JOIN employee_profiles ep ON ep.user_id = ws.user_id
       WHERE ws.week_start = ?
         AND u.role NOT IN ('guest', 'super_admin', 'boss')
       ORDER BY u.name ASC`,
      weekStart,
    ),
    db.get<{ week_start: string; week_end: string }>(
      `SELECT week_start, week_end
       FROM weekly_summaries
       ORDER BY week_start DESC, week_end DESC
       LIMIT 1`,
    ),
    db.get<WorkLogSourceAggregate>(
      `SELECT
         (
           (SELECT COUNT(*) FROM daily_log_submissions) +
           (SELECT COUNT(*) FROM weekly_summaries)
         )::int AS record_count,
         GREATEST(
           (SELECT MAX(submitted_at) FROM daily_log_submissions),
           (SELECT MAX(generated_at) FROM weekly_summaries),
           (SELECT MAX(updated_at) FROM daily_logs WHERE NULLIF(TRIM(content), '') IS NOT NULL)
         ) AS last_updated_at`,
    ),
  ]);

  let displayedWeeklyItems = currentWeeklyItems;
  let displayWeekStart = weekStart;
  let displayWeekEnd = weekEnd;
  let isCurrentWeek = true;

  if (
    displayedWeeklyItems.length === 0 &&
    latestWeeklyRange?.week_start &&
    latestWeeklyRange.week_start !== weekStart
  ) {
    displayedWeeklyItems = await db.all<WeeklyLogItemRow>(
      `SELECT
         ws.id,
         ws.user_id,
         u.name AS user_name,
         COALESCE(NULLIF(TRIM(ep.department), ''), NULLIF(TRIM(u.department), '')) AS department,
         COALESCE(NULLIF(TRIM(ep.position), ''), NULLIF(TRIM(u.position), '')) AS position,
         ws.week_start,
         ws.week_end,
         LEFT(ws.summary_content, 2200) AS summary_content,
         ws.generated_at
       FROM weekly_summaries ws
       JOIN users u ON u.id = ws.user_id
       LEFT JOIN employee_profiles ep ON ep.user_id = ws.user_id
       WHERE ws.week_start = ?
         AND u.role NOT IN ('guest', 'super_admin', 'boss')
       ORDER BY u.name ASC`,
      latestWeeklyRange.week_start,
    );
    displayWeekStart = latestWeeklyRange.week_start;
    displayWeekEnd = latestWeeklyRange.week_end;
    isCurrentWeek = false;
  }

  const eligibleUserIds = new Set(eligibleUsers.map((user) => user.id));
  const writtenUserIds = new Set(
    writtenToday
      .map((item) => item.user_id)
      .filter((userId) => eligibleUserIds.has(userId)),
  );
  const archivedUserIds = new Set(
    archivedToday
      .map((item) => item.user_id)
      .filter((userId) => eligibleUserIds.has(userId)),
  );
  const currentWeeklyUserIds = new Set(
    currentWeeklyItems
      .map((item) => item.user_id)
      .filter((userId) => eligibleUserIds.has(userId)),
  );
  const eligibleCount = eligibleUsers.length;
  const dailyWrittenCount = writtenUserIds.size;
  const weeklyGeneratedCount = currentWeeklyUserIds.size;

  return {
    available:
      eligibleCount > 0 || Number(sourceAggregate?.record_count || 0) > 0,
    recordCount: Number(sourceAggregate?.record_count || 0),
    lastUpdatedAt: sourceAggregate?.last_updated_at || null,
    daily: {
      date: today,
      eligibleCount,
      writtenCount: dailyWrittenCount,
      archivedCount: archivedUserIds.size,
      missingCount: Math.max(eligibleCount - dailyWrittenCount, 0),
      completionRate:
        eligibleCount > 0
          ? Number(((dailyWrittenCount / eligibleCount) * 100).toFixed(1))
          : null,
      missingUsers: eligibleUsers.filter(
        (user) => !writtenUserIds.has(user.id),
      ),
      items: recentDailyItems,
    },
    weekly: {
      currentWeekStart: weekStart,
      currentWeekEnd: weekEnd,
      eligibleCount,
      generatedCount: weeklyGeneratedCount,
      missingCount: Math.max(eligibleCount - weeklyGeneratedCount, 0),
      completionRate:
        eligibleCount > 0
          ? Number(((weeklyGeneratedCount / eligibleCount) * 100).toFixed(1))
          : null,
      missingUsers: eligibleUsers.filter(
        (user) => !currentWeeklyUserIds.has(user.id),
      ),
      displayWeekStart,
      displayWeekEnd,
      isCurrentWeek,
      items: displayedWeeklyItems,
    },
  };
}

async function loadProjectAggregate(): Promise<ProjectAggregate> {
  const aggregate = await db.get<ProjectAggregate>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE is_completed = FALSE)::int AS active,
       COUNT(*) FILTER (WHERE is_completed = TRUE)::int AS completed,
       MAX(updated_at) AS last_updated_at
     FROM worklog_projects`,
  );

  return (
    aggregate ?? {
      total: 0,
      active: 0,
      completed: 0,
      last_updated_at: null,
    }
  );
}

async function loadProjectDistribution(
  field: "district" | "project_type",
): Promise<DistributionRow[]> {
  return db.all<DistributionRow>(
    `SELECT
       NULLIF(TRIM(${field}), '') AS name,
       COUNT(*)::int AS count
     FROM worklog_projects
     GROUP BY NULLIF(TRIM(${field}), '')
     ORDER BY count DESC, name ASC`,
  );
}

async function loadOverdueMatters(today: string): Promise<OverdueMatterRow[]> {
  return db.all<OverdueMatterRow>(
    `WITH matter_activity AS (
       SELECT
         p.id AS project_id,
         p.name AS project_name,
         p.owner_name,
         e.matter,
         MIN(e.log_date) AS first_date,
         COUNT(*)::int AS total_count,
         COUNT(*) FILTER (WHERE e.is_finalized)::int AS finalized_count,
         m.standard_days
       FROM worklog_projects p
       JOIN worklog_entries e ON e.project_id = p.id
       LEFT JOIN worklog_matters m ON m.name = e.matter
       WHERE p.is_completed = FALSE
       GROUP BY
         p.id, p.name, p.owner_name, e.matter, m.standard_days
     )
     SELECT
       project_id,
       project_name,
       owner_name,
       matter,
       first_date,
       ((?::date - first_date::date) + 1)::int AS days_elapsed,
       standard_days
     FROM matter_activity
     WHERE total_count > finalized_count
       AND standard_days IS NOT NULL
       AND ((?::date - first_date::date) + 1) > standard_days
     ORDER BY days_elapsed DESC, project_name ASC`,
    today,
    today,
  );
}

async function loadDueFollowUps(today: string): Promise<DueFollowUpRow[]> {
  return db.all<DueFollowUpRow>(
    `SELECT
       e.id AS entry_id,
       p.id AS project_id,
       p.name AS project_name,
       p.owner_name,
       e.matter,
       e.next_follow_up_date
     FROM worklog_entries e
     JOIN worklog_projects p ON p.id = e.project_id
     WHERE p.is_completed = FALSE
       AND e.is_finalized = FALSE
       AND e.next_follow_up_date IS NOT NULL
       AND e.next_follow_up_date <= ?
     ORDER BY e.next_follow_up_date ASC, p.name ASC`,
    today,
  );
}

async function loadStaleProjects(
  cutoffTime: string,
): Promise<StaleProjectRow[]> {
  return db.all<StaleProjectRow>(
    `WITH project_activity AS (
       SELECT
         p.id AS project_id,
         p.name AS project_name,
         p.owner_name,
         GREATEST(
           p.updated_at,
           COALESCE(MAX(e.updated_at), p.updated_at),
           COALESCE(MAX(n.created_at), p.updated_at)
         ) AS last_updated_at
       FROM worklog_projects p
       LEFT JOIN worklog_entries e ON e.project_id = p.id
       LEFT JOIN worklog_progress_notes n ON n.entry_id = e.id
       WHERE p.is_completed = FALSE
       GROUP BY p.id, p.name, p.owner_name, p.updated_at
     )
     SELECT project_id, project_name, owner_name, last_updated_at
     FROM project_activity
     WHERE last_updated_at < ?
     ORDER BY last_updated_at ASC, project_name ASC`,
    cutoffTime,
  );
}

function sourceQuality(input: {
  available: boolean;
  recordCount: number;
  latestMonth?: string | null;
  lastUpdatedAt: string | null;
}): SourceQuality {
  return {
    available: input.available,
    recordCount: input.recordCount,
    latestMonth: input.latestMonth ?? null,
    lastUpdatedAt: input.lastUpdatedAt,
  };
}

router.use(requireRole(["boss", "admin", "super_admin"]));

router.get("/metrics", (_req, res) => {
  res.json({
    success: true,
    data: {
      version: METRIC_REGISTRY_VERSION,
      metrics: BOSS_DASHBOARD_METRICS.filter((metric) => metric.enabled),
    },
  });
});

router.get("/summary", async (req, res) => {
  try {
    const clock = getBeijingDateParts();
    const requestedStartMonth =
      typeof req.query.startMonth === "string"
        ? req.query.startMonth.trim()
        : "";
    const requestedEndMonth =
      typeof req.query.endMonth === "string" ? req.query.endMonth.trim() : "";

    if (Boolean(requestedStartMonth) !== Boolean(requestedEndMonth)) {
      return res.status(400).json({
        success: false,
        message: "开始月份和结束月份需要同时提供",
      });
    }

    let months: string[];
    try {
      months =
        requestedStartMonth && requestedEndMonth
          ? buildMonthRange(requestedStartMonth, requestedEndMonth)
          : buildRecentMonths(clock.year, clock.month);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "趋势月份范围无效",
      });
    }
    const startMonth = months[0];
    const endMonth = months.at(-1) ?? clock.monthKey;
    const periodDescription = describeDashboardPeriod(months, clock.monthKey);
    const staleCutoff = subtractDays(clock.date, STALE_PROJECT_DAYS);

    const [
      payrollRows,
      incurredRows,
      paidRows,
      incurredTypeRows,
      reimbursementAnalysis,
      workLogs,
      employeeAggregate,
      employeeDepartments,
      projectAggregate,
      projectDistricts,
      projectTypes,
      overdueMatters,
      dueFollowUps,
      staleProjects,
    ] = await Promise.all([
      loadPayrollRows(startMonth, endMonth),
      loadIncurredReimbursements(startMonth, endMonth),
      loadPaidReimbursements(startMonth, endMonth),
      loadIncurredReimbursementsByType(startMonth, endMonth),
      loadReimbursementAnalysis(startMonth, endMonth),
      loadWorkLogOverview(clock.date),
      loadEmployeeAggregate(clock.monthKey),
      loadEmployeeDepartments(),
      loadProjectAggregate(),
      loadProjectDistribution("district"),
      loadProjectDistribution("project_type"),
      loadOverdueMatters(clock.date),
      loadDueFollowUps(clock.date),
      loadStaleProjects(staleCutoff),
    ]);

    const payrollByMonth = buildPayrollMonthSummaries(months, payrollRows);
    const incurredByMonth = new Map(
      incurredRows.map((row) => [row.month, row] as const),
    );
    const paidByMonth = new Map(
      paidRows.map((row) => [row.month, row] as const),
    );
    const incurredByMonthAndType = new Map(
      incurredTypeRows.map((row) => [`${row.month}:${row.type}`, row] as const),
    );
    const periodPayrollSummaries = months
      .map((month) => payrollByMonth.get(month))
      .filter((summary): summary is PayrollMonthSummary => Boolean(summary));

    const employeesAvailable = employeeAggregate.total > 0;
    const projectsAvailable = projectAggregate.total > 0;
    const currentActiveEmployees = employeesAvailable
      ? employeeAggregate.active +
        employeeAggregate.probation +
        employeeAggregate.on_leave
      : null;

    const riskProjectIds = new Set<string>([
      ...overdueMatters.map((item) => item.project_id),
      ...dueFollowUps.map((item) => item.project_id),
      ...staleProjects.map((item) => item.project_id),
    ]);
    const riskProjectsValue = projectsAvailable ? riskProjectIds.size : null;

    const periodHumanCost =
      periodPayrollSummaries.length > 0
        ? toAmount(
            periodPayrollSummaries.reduce(
              (total, summary) => total + summary.total,
              0,
            ),
          )
        : null;
    const periodReimbursementCost =
      incurredRows.length > 0
        ? toAmount(
            incurredRows.reduce(
              (total, reimbursement) => total + Number(reimbursement.amount),
              0,
            ),
          )
        : null;
    const registeredTotalCost =
      periodHumanCost !== null && periodReimbursementCost !== null
        ? toAmount(periodHumanCost + periodReimbursementCost)
        : null;
    const humanCostRatio =
      periodHumanCost !== null &&
      registeredTotalCost !== null &&
      registeredTotalCost > 0
        ? Number(((periodHumanCost / registeredTotalCost) * 100).toFixed(2))
        : null;
    const averageHumanCost =
      periodHumanCost !== null && payrollRows.length > 0
        ? toAmount(periodHumanCost / payrollRows.length)
        : null;

    const missingCostReason =
      periodHumanCost === null && periodReimbursementCost === null
        ? `${periodDescription.label}工资和报销数据均未录入`
        : periodHumanCost === null
          ? `${periodDescription.label}工资数据未录入`
          : periodReimbursementCost === null
            ? `${periodDescription.label}报销数据未录入`
            : null;
    const metricMonth = months.length === 1 ? startMonth : null;

    const metrics = {
      registeredTotalCost: metricValue(
        "registeredTotalCost",
        registeredTotalCost,
        metricMonth,
        missingCostReason,
      ),
      humanCost: metricValue(
        "humanCost",
        periodHumanCost,
        metricMonth,
        `${periodDescription.label}工资数据未录入`,
      ),
      reimbursementCost: metricValue(
        "reimbursementCost",
        periodReimbursementCost,
        metricMonth,
        `${periodDescription.label}报销数据未录入`,
      ),
      humanCostRatio: metricValue(
        "humanCostRatio",
        humanCostRatio,
        metricMonth,
        registeredTotalCost === 0
          ? `${periodDescription.label}已登记总成本为零，无法计算占比`
          : missingCostReason,
      ),
      averageHumanCost: metricValue(
        "averageHumanCost",
        averageHumanCost,
        metricMonth,
        periodHumanCost === null
          ? `${periodDescription.label}工资数据未录入`
          : "所选周期工资记录人数不可用",
      ),
      activeEmployees: metricValue(
        "activeEmployees",
        currentActiveEmployees,
        null,
        "员工档案尚未接入",
      ),
      activeProjects: metricValue(
        "activeProjects",
        projectsAvailable ? projectAggregate.active : null,
        null,
        "结构化项目尚未接入",
      ),
      riskProjects: metricValue(
        "riskProjects",
        riskProjectsValue,
        null,
        "结构化项目尚未接入",
      ),
    };

    const financialTrends = {
      totalCost: months.map((month) => {
        const human = payrollByMonth.get(month);
        const reimbursement = incurredByMonth.get(month);
        const available = Boolean(human && reimbursement);
        const humanCost = human?.total ?? null;
        const reimbursementCost = reimbursement
          ? toAmount(reimbursement.amount)
          : null;
        return {
          month,
          value:
            available && humanCost !== null && reimbursementCost !== null
              ? toAmount(humanCost + reimbursementCost)
              : null,
          humanCost,
          reimbursementCost,
          available,
        };
      }),
      humanCostBreakdown: months.map((month) => {
        const summary = payrollByMonth.get(month);
        return {
          month,
          salary: summary?.salary ?? null,
          companySocial: summary?.companySocial ?? null,
          personalSocial: summary?.personalSocial ?? null,
          companyHousingFund: summary?.companyHousingFund ?? null,
          personalHousingFund: summary?.personalHousingFund ?? null,
          individualIncomeTax: summary?.individualIncomeTax ?? null,
          total: summary?.total ?? null,
          available: Boolean(summary),
        };
      }),
      reimbursement: months.map((month) => {
        const incurred = incurredByMonth.get(month);
        const paid = paidByMonth.get(month);
        const basic = incurredByMonthAndType.get(`${month}:basic`);
        const large = incurredByMonthAndType.get(`${month}:large`);
        const business = incurredByMonthAndType.get(`${month}:business`);
        return {
          month,
          incurred: incurred ? toAmount(incurred.amount) : null,
          paid: paid ? toAmount(paid.amount) : null,
          basic: basic ? toAmount(basic.amount) : null,
          large: large ? toAmount(large.amount) : null,
          business: business ? toAmount(business.amount) : null,
          available: Boolean(incurred || paid),
        };
      }),
    };

    const riskItems: RiskItem[] = [
      ...overdueMatters.map<RiskItem>((item) => ({
        projectId: item.project_id,
        projectName: item.project_name,
        ownerName: item.owner_name,
        type: "overdue_matter",
        level: "high",
        description: `${item.matter}已进行${item.days_elapsed}天，超过标准时长${item.standard_days}天`,
        occurredAt: item.first_date,
      })),
      ...dueFollowUps.map<RiskItem>((item) => ({
        projectId: item.project_id,
        projectName: item.project_name,
        ownerName: item.owner_name,
        type: "due_follow_up",
        level: "medium",
        description: `${item.matter}的计划跟进日期已到`,
        occurredAt: item.next_follow_up_date,
      })),
      ...staleProjects.map<RiskItem>((item) => ({
        projectId: item.project_id,
        projectName: item.project_name,
        ownerName: item.owner_name,
        type: "stale_project",
        level: "medium",
        description: `项目超过${STALE_PROJECT_DAYS}天未更新`,
        occurredAt: item.last_updated_at,
      })),
    ]
      .sort((left, right) => {
        if (left.level !== right.level) return left.level === "high" ? -1 : 1;
        return left.occurredAt.localeCompare(right.occurredAt);
      })
      .slice(0, 50);

    const reimbursementTypeDefinitions: Array<{
      type: ReimbursementType;
      name: string;
    }> = [
      { type: "basic", name: "基础报销" },
      { type: "large", name: "大额报销" },
      { type: "business", name: "商务报销" },
    ];
    const reimbursementByType = new Map(
      reimbursementAnalysis.byType.map((row) => [row.type, row] as const),
    );
    const reimbursementTypeItems = reimbursementTypeDefinitions.map(
      (definition) => {
        const row = reimbursementByType.get(definition.type);
        return {
          key: definition.type,
          name: definition.name,
          count: Number(row?.record_count || 0),
          amount: toAmount(row?.amount || 0),
        };
      },
    );
    const reimbursementAnalysisRecordCount = reimbursementTypeItems.reduce(
      (total, item) => total + item.count,
      0,
    );
    const reimbursementAnalysisAmount = toAmount(
      reimbursementTypeItems.reduce((total, item) => total + item.amount, 0),
    );

    const payrollLatestMonth =
      payrollRows
        .map((row) => row.payroll_month)
        .sort()
        .at(-1) ?? null;
    const reimbursementLatestMonth =
      [
        ...incurredRows.map((row) => row.month),
        ...paidRows.map((row) => row.month),
      ]
        .sort()
        .at(-1) ?? null;
    const reimbursementRecordCount = incurredRows.reduce(
      (total, row) => total + Number(row.record_count),
      0,
    );

    const sources = {
      payroll: sourceQuality({
        available: payrollRows.length > 0,
        recordCount: payrollRows.length,
        latestMonth: payrollLatestMonth,
        lastUpdatedAt: latestTimestamp(
          payrollRows.map((row) => row.updated_at),
        ),
      }),
      reimbursements: sourceQuality({
        available: reimbursementRecordCount > 0,
        recordCount: reimbursementRecordCount,
        latestMonth: reimbursementLatestMonth,
        lastUpdatedAt: latestTimestamp([
          ...incurredRows.map((row) => row.last_updated_at),
          ...paidRows.map((row) => row.last_updated_at),
        ]),
      }),
      employees: sourceQuality({
        available: employeesAvailable,
        recordCount: employeeAggregate.total,
        lastUpdatedAt: employeeAggregate.last_updated_at,
      }),
      projects: sourceQuality({
        available: projectsAvailable,
        recordCount: projectAggregate.total,
        lastUpdatedAt: projectAggregate.last_updated_at,
      }),
      workLogs: sourceQuality({
        available: workLogs.available,
        recordCount: workLogs.recordCount,
        lastUpdatedAt: workLogs.lastUpdatedAt,
      }),
    };

    const issues: DataQualityIssue[] = [];
    if (periodPayrollSummaries.length === 0) {
      issues.push({
        code: "payroll.period_missing",
        level: "warning",
        message: `${periodDescription.label}工资数据未录入，人力成本相关指标不可用`,
        affectedMetrics: [
          "cost.registered_total.month",
          "cost.human.month",
          "cost.human_ratio.month",
          "cost.human_average.month",
        ],
      });
    }
    if (incurredRows.length === 0) {
      issues.push({
        code: "reimbursement.period_missing",
        level: "warning",
        message: `${periodDescription.label}没有可确认的报销归属数据，报销成本相关指标不可用`,
        affectedMetrics: [
          "cost.registered_total.month",
          "cost.reimbursement.month",
          "cost.human_ratio.month",
        ],
      });
    }
    if (!employeesAvailable) {
      issues.push({
        code: "employees.unavailable",
        level: "error",
        message: "没有已提交的员工档案，人员指标不可用",
        affectedMetrics: ["people.active.current"],
      });
    } else if (employeeAggregate.missing_hire_date > 0) {
      issues.push({
        code: "employees.hire_date_incomplete",
        level: "warning",
        message: `有${employeeAggregate.missing_hire_date}名员工缺少入职日期，本月入职统计可能不完整`,
        affectedMetrics: [],
      });
    }
    if (!projectsAvailable) {
      issues.push({
        code: "projects.unavailable",
        level: "error",
        message: "结构化项目尚未录入，项目和风险指标不可用",
        affectedMetrics: ["project.active.current", "risk.project.current"],
      });
    }

    const availableSourceCount = Object.values(sources).filter(
      (source) => source.available,
    ).length;
    const qualityStatus =
      availableSourceCount === 0
        ? "unavailable"
        : issues.length > 0
          ? "partial"
          : "ready";

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        period: {
          startMonth,
          endMonth,
          months,
          ...periodDescription,
          humanCostAverageBasis:
            months.length === 1
              ? "payrollRecordCount"
              : "payrollPersonMonthCount",
          humanCostAverageDenominator: payrollRows.length,
        },
        dataQuality: {
          status: qualityStatus,
          lastBusinessUpdate: latestTimestamp(
            Object.values(sources).map((source) => source.lastUpdatedAt),
          ),
          issues,
          sources,
        },
        metrics,
        financialTrends,
        reimbursements: {
          available: reimbursementAnalysisRecordCount > 0,
          reason:
            reimbursementAnalysisRecordCount > 0
              ? null
              : "当前统计周期没有可确认的报销记录",
          totalCount: reimbursementAnalysisRecordCount,
          totalAmount: reimbursementAnalysisAmount,
          byType: reimbursementTypeItems,
          byDistrict: reimbursementAnalysis.byDistrict.map((row) => ({
            name: row.name || "未填写行政区或范围",
            count: Number(row.record_count),
            amount: toAmount(row.amount),
          })),
          byServiceUnit: reimbursementAnalysis.byServiceUnit.map((row) => ({
            name: row.name || "未填写服务单位",
            count: Number(row.record_count),
            amount: toAmount(row.amount),
          })),
          recentItems: reimbursementAnalysis.recentItems.map((row) => ({
            id: row.id,
            type: row.type,
            title: row.title,
            amount: toAmount(row.amount),
            applicantName: row.applicant_name,
            reimbursementMonth: row.reimbursement_month,
            districtName: row.district_name,
            scopeName: row.scope_name,
            serviceUnit: row.service_unit,
            status: row.status,
            updatedAt: row.updated_at,
          })),
        },
        workLogs: {
          available: workLogs.available,
          daily: {
            ...workLogs.daily,
            missingUsers: workLogs.daily.missingUsers.map((user) => ({
              userId: user.id,
              userName: user.name,
              department: user.department,
              position: user.position,
            })),
            items: workLogs.daily.items.map((item) => ({
              id: item.id,
              userId: item.user_id,
              userName: item.user_name,
              department: item.department,
              position: item.position,
              date: item.log_date,
              content: item.content,
              state: item.state,
              updatedAt: item.updated_at,
            })),
          },
          weekly: {
            ...workLogs.weekly,
            missingUsers: workLogs.weekly.missingUsers.map((user) => ({
              userId: user.id,
              userName: user.name,
              department: user.department,
              position: user.position,
            })),
            items: workLogs.weekly.items.map((item) => ({
              id: item.id,
              userId: item.user_id,
              userName: item.user_name,
              department: item.department,
              position: item.position,
              weekStart: item.week_start,
              weekEnd: item.week_end,
              content: item.summary_content,
              generatedAt: item.generated_at,
            })),
          },
        },
        people: {
          available: employeesAvailable,
          total: employeesAvailable ? employeeAggregate.total : null,
          active: employeesAvailable ? employeeAggregate.active : null,
          probation: employeesAvailable ? employeeAggregate.probation : null,
          onLeave: employeesAvailable ? employeeAggregate.on_leave : null,
          resigned: employeesAvailable ? employeeAggregate.resigned : null,
          newHiresThisMonth: employeesAvailable
            ? employeeAggregate.new_hires_this_month
            : null,
          departments: employeesAvailable
            ? employeeDepartments.map((row) => ({
                name: row.name || "未设置部门",
                count: Number(row.count),
              }))
            : [],
        },
        projects: {
          available: projectsAvailable,
          total: projectsAvailable ? projectAggregate.total : null,
          active: projectsAvailable ? projectAggregate.active : null,
          completed: projectsAvailable ? projectAggregate.completed : null,
          stale: projectsAvailable ? staleProjects.length : null,
          districts: projectsAvailable
            ? projectDistricts.map((row) => ({
                name: row.name || "未设置区域",
                count: Number(row.count),
              }))
            : [],
          types: projectsAvailable
            ? projectTypes.map((row) => ({
                name: row.name || "未设置类型",
                count: Number(row.count),
              }))
            : [],
        },
        risks: {
          available: projectsAvailable,
          totalRiskProjects: riskProjectsValue,
          overdueMatters: projectsAvailable ? overdueMatters.length : null,
          dueFollowUps: projectsAvailable ? dueFollowUps.length : null,
          staleProjects: projectsAvailable ? staleProjects.length : null,
          items: projectsAvailable ? riskItems : [],
        },
      },
    });
  } catch (error) {
    console.error("获取羽隶经营看板汇总失败:", error);
    res.status(500).json({
      success: false,
      message: "获取羽隶经营看板汇总失败",
    });
  }
});

export default router;
