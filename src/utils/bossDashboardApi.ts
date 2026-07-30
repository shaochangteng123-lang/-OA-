import { api } from "@/utils/api";

export interface BossDashboardMetric {
  code: string;
  name: string;
  value: number | null;
  unit: string;
  available: boolean;
  reason: string | null;
  month: string | null;
}

export interface BossTotalCostTrend {
  month: string;
  value: number | null;
  humanCost: number | null;
  reimbursementCost: number | null;
  available: boolean;
}

export interface BossHumanCostTrend {
  month: string;
  salary: number | null;
  companySocial: number | null;
  personalSocial: number | null;
  companyHousingFund: number | null;
  personalHousingFund: number | null;
  individualIncomeTax: number | null;
  total: number | null;
  available: boolean;
}

export interface BossReimbursementTrend {
  month: string;
  incurred: number | null;
  paid: number | null;
  basic: number | null;
  large: number | null;
  business: number | null;
  available: boolean;
}

export type BossReimbursementType = "basic" | "large" | "business";

export interface BossReimbursementBreakdownItem {
  key?: BossReimbursementType;
  name: string;
  count: number;
  amount: number;
}

export interface BossReimbursementDetailItem {
  id: string;
  type: BossReimbursementType;
  title: string;
  amount: number;
  applicantName: string;
  reimbursementMonth: string;
  districtName: string | null;
  scopeName: string | null;
  serviceUnit: string | null;
  status: string;
  updatedAt: string;
}

export interface BossReimbursementSummary {
  available: boolean;
  reason: string | null;
  totalCount: number;
  totalAmount: number;
  byType: BossReimbursementBreakdownItem[];
  byDistrict: BossReimbursementBreakdownItem[];
  byServiceUnit: BossReimbursementBreakdownItem[];
  recentItems: BossReimbursementDetailItem[];
}

export interface BossWorkLogUser {
  userId: string;
  userName: string;
  department: string | null;
  position: string | null;
}

export interface BossDailyLogItem extends BossWorkLogUser {
  id: string;
  date: string;
  content: string;
  state: "written" | "archived";
  updatedAt: string;
}

export interface BossWeeklyLogItem extends BossWorkLogUser {
  id: string;
  weekStart: string;
  weekEnd: string;
  content: string;
  generatedAt: string;
}

export interface BossWorkLogSummary {
  available: boolean;
  daily: {
    date: string;
    eligibleCount: number;
    writtenCount: number;
    archivedCount: number;
    missingCount: number;
    completionRate: number | null;
    missingUsers: BossWorkLogUser[];
    items: BossDailyLogItem[];
  };
  weekly: {
    currentWeekStart: string;
    currentWeekEnd: string;
    eligibleCount: number;
    generatedCount: number;
    missingCount: number;
    completionRate: number | null;
    missingUsers: BossWorkLogUser[];
    displayWeekStart: string;
    displayWeekEnd: string;
    isCurrentWeek: boolean;
    items: BossWeeklyLogItem[];
  };
}

export interface BossDashboardPeriod {
  startMonth: string;
  endMonth: string;
  months: string[];
  scope: "month" | "yearToDate" | "year" | "range";
  label: string;
  financialMetricAggregation: "selectedPeriodSum";
  humanCostAverageBasis: "payrollRecordCount" | "payrollPersonMonthCount";
  humanCostAverageDenominator: number;
}

export interface BossDepartmentPeopleItem {
  name: string;
  count: number;
}

export interface BossPeopleSummary {
  available: boolean;
  total: number | null;
  active: number | null;
  probation: number | null;
  onLeave: number | null;
  resigned: number | null;
  newHiresThisMonth: number | null;
  departments: BossDepartmentPeopleItem[];
}

export interface BossProjectDistributionItem {
  name: string;
  count: number;
}

export interface BossProjectSummary {
  available: boolean;
  total: number | null;
  active: number | null;
  completed: number | null;
  stale: number | null;
  districts: BossProjectDistributionItem[];
  types: BossProjectDistributionItem[];
}

export type BossRiskLevel = "high" | "medium";
export type BossRiskType = "overdue_matter" | "due_follow_up" | "stale_project";

export interface BossRiskItem {
  projectId: string;
  projectName: string;
  ownerName: string;
  type: BossRiskType;
  level: BossRiskLevel;
  description: string;
  occurredAt: string;
}

export interface BossRiskSummary {
  available: boolean;
  totalRiskProjects: number | null;
  overdueMatters: number | null;
  dueFollowUps: number | null;
  staleProjects: number | null;
  items: BossRiskItem[];
}

export interface BossDataSourceStatus {
  available: boolean;
  recordCount: number;
  latestMonth: string | null;
  lastUpdatedAt: string | null;
}

export interface BossDataQualityIssue {
  code: string;
  level: "warning" | "error";
  message: string;
  affectedMetrics: string[];
}

export interface BossDataQuality {
  status: "ready" | "partial" | "unavailable";
  lastBusinessUpdate: string | null;
  issues: BossDataQualityIssue[];
  sources: {
    payroll: BossDataSourceStatus;
    reimbursements: BossDataSourceStatus;
    employees: BossDataSourceStatus;
    projects: BossDataSourceStatus;
    workLogs: BossDataSourceStatus;
  };
}

export interface BossDashboardSummary {
  generatedAt: string;
  period: BossDashboardPeriod;
  dataQuality: BossDataQuality;
  metrics: Record<string, BossDashboardMetric>;
  financialTrends: {
    totalCost: BossTotalCostTrend[];
    humanCostBreakdown: BossHumanCostTrend[];
    reimbursement: BossReimbursementTrend[];
  };
  reimbursements: BossReimbursementSummary;
  workLogs: BossWorkLogSummary;
  people: BossPeopleSummary;
  projects: BossProjectSummary;
  risks: BossRiskSummary;
}

interface BossDashboardResponse {
  success: boolean;
  data: BossDashboardSummary;
  message?: string;
}

export interface BossDashboardQuery {
  startMonth?: string;
  endMonth?: string;
}

export async function getBossDashboardSummary(
  query: BossDashboardQuery = {},
): Promise<BossDashboardSummary> {
  const response = await api.get<BossDashboardResponse>(
    "/api/boss-dashboard/summary",
    {
      params: query,
    },
  );
  return response.data.data;
}
