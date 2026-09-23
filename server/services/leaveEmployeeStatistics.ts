import {
  addLeaveCalendarDays,
  listLeaveHalfSlots,
  type LeaveHalf,
  type LeaveHalfSlot,
  type LeaveScheduleDay,
} from "../utils/leave-period.js";
import { isValidLeaveDate } from "../utils/leave.js";

export interface LeaveEmployeeStatisticsRequestRow {
  id: string;
  request_no: string;
  user_id: string;
  applicant_name: string;
  applicant_department: string | null;
  leave_type_code: string;
  leave_type_name: string;
  start_date: string;
  start_half: string;
  end_date: string;
  end_half: string;
  total_days: number | string;
  target_year_days: number;
  reason: string;
  status: string;
  submitted_at: string;
  approved_at: string | null;
  application_kind: string;
  combination_group_id: string | null;
  parent_request_id: string | null;
  target_year?: number;
}

export type LeaveEmployeeStatisticsSourceRow = Omit<
  LeaveEmployeeStatisticsRequestRow,
  "target_year_days" | "target_year"
> & {
  balance_allocations_json: string | null;
};

export interface LeaveEmployeeStatisticsBalanceRow {
  user_id: string;
  leave_type_code: string;
  leave_type_name: string;
  requires_balance_check: boolean;
  total_days: number | string | null;
  used_days: number | string | null;
  pending_days: number | string | null;
}

export interface LeaveEmployeeStatisticsEmployeeRow {
  user_id: string;
  name: string;
  department: string | null;
  statistics_year?: number;
}

export interface LeaveEmployeeStatisticsManager {
  id: string;
  name: string;
  roleLabel: string;
}

export interface LeaveEmployeeStatisticsAnnualPoint {
  year: number;
  employeeCount: number;
  approvedRequestCount: number;
  approvedLeaveDays: number;
}

export interface LeaveEmployeeStatisticsEmployeeAnnualPoint {
  year: number;
  approvedRequestCount: number;
  approvedLeaveDays: number;
}

export interface LeaveEmployeeStatisticsMonthlyPoint {
  month: string;
  approvedRequestCount: number;
  approvedLeaveDays: number;
}

export interface LeaveEmployeeStatisticsEmployeeMonthlyPoint extends LeaveEmployeeStatisticsMonthlyPoint {
  typeSummaries: LeaveEmployeeStatisticsTypeSummary[];
}

export interface LeaveEmployeeStatisticsMonthlyRequestRow extends Omit<
  LeaveEmployeeStatisticsRequestRow,
  "target_year_days"
> {
  target_month: string;
  target_month_days: number;
}

export interface LeaveEmployeeStatisticsSegment {
  id: string;
  requestNo: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  startDate: string;
  startHalf: string;
  endDate: string;
  endHalf: string;
  totalDays: number;
}

export interface LeaveEmployeeStatisticsRequest {
  id: string;
  requestNo: string;
  applicationKind: string;
  parentRequestId: string | null;
  status: string;
  startDate: string;
  startHalf: string;
  endDate: string;
  endHalf: string;
  totalDays: number;
  reason: string;
  submittedAt: string;
  approvedAt: string | null;
  segments: LeaveEmployeeStatisticsSegment[];
}

export interface LeaveEmployeeStatisticsTypeSummary {
  leaveTypeCode: string;
  leaveTypeName: string;
  requestCount: number;
  totalDays: number;
}

export interface LeaveEmployeeStatisticsBalanceSummary {
  leaveTypeCode: string;
  leaveTypeName: string;
  requiresBalanceCheck: boolean;
  unlimited: boolean;
  totalDays: number | null;
  usedDays: number | null;
  pendingDays: number | null;
  remainingDays: number | null;
}

export interface LeaveEmployeeStatistic {
  rank: number;
  userId: string;
  name: string;
  department: string | null;
  approvedRequestCount: number;
  approvedLeaveDays: number;
  paidLeaveTotalDays: number;
  paidLeaveUsedDays: number;
  paidLeavePendingDays: number;
  paidLeaveRemainingDays: number;
  balanceSummaries: LeaveEmployeeStatisticsBalanceSummary[];
  typeSummaries: LeaveEmployeeStatisticsTypeSummary[];
  requests: LeaveEmployeeStatisticsRequest[];
  annualTrend: LeaveEmployeeStatisticsEmployeeAnnualPoint[];
  monthlyTrend: LeaveEmployeeStatisticsEmployeeMonthlyPoint[];
}

export interface LeaveEmployeeStatisticsResult {
  year: number;
  generatedAt: string;
  manager: LeaveEmployeeStatisticsManager;
  summary: {
    employeeCount: number;
    approvedRequestCount: number;
    approvedLeaveDays: number;
  };
  annualComparison: LeaveEmployeeStatisticsAnnualPoint[];
  monthlyComparison: LeaveEmployeeStatisticsMonthlyPoint[];
  employees: LeaveEmployeeStatistic[];
}

export interface LeaveEmployeeStatisticsBuildOptions {
  manager: LeaveEmployeeStatisticsManager;
  comparisonYears?: number[];
  monthlyRequestRows?: LeaveEmployeeStatisticsMonthlyRequestRow[];
  generatedAt?: string;
}

interface MutableTypeSummary {
  leaveTypeCode: string;
  leaveTypeName: string;
  requestKeys: Set<string>;
  totalDays: number;
}

interface MutableLogicalRequest {
  sourceRows: LeaveEmployeeStatisticsRequestRow[];
  totalDays: number;
}

interface MutableEmployeeStatistic {
  userId: string;
  name: string;
  department: string | null;
  requestKeys: Set<string>;
  approvedLeaveDays: number;
  typeSummaries: Map<string, MutableTypeSummary>;
  requests: Map<string, MutableLogicalRequest>;
}

interface MutableMonthlyPoint {
  month: string;
  requestKeys: Set<string>;
  approvedLeaveDays: number;
  typeSummaries: Map<string, MutableTypeSummary>;
}

function roundLeaveDays(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
}

function toFiniteLeaveDays(value: number | string): number {
  const days = Number(value);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

function hasValidStatisticsPeriod(
  row: Pick<
    LeaveEmployeeStatisticsSourceRow,
    "start_date" | "start_half" | "end_date" | "end_half"
  >,
): boolean {
  return (
    isValidLeaveDate(row.start_date) &&
    isValidLeaveDate(row.end_date) &&
    row.start_date <= row.end_date &&
    ["morning", "afternoon"].includes(row.start_half) &&
    ["morning", "afternoon"].includes(row.end_half) &&
    !(
      row.start_date === row.end_date &&
      row.start_half === "afternoon" &&
      row.end_half === "morning"
    )
  );
}

function listCalendarHalfSlotsForYear(
  row: Pick<
    LeaveEmployeeStatisticsSourceRow,
    "start_date" | "start_half" | "end_date" | "end_half"
  >,
  year: number,
): LeaveHalfSlot[] {
  if (!hasValidStatisticsPeriod(row)) return [];

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (row.end_date < yearStart || row.start_date > yearEnd) return [];

  const startDate = row.start_date < yearStart ? yearStart : row.start_date;
  const endDate = row.end_date > yearEnd ? yearEnd : row.end_date;
  const startHalf: LeaveHalf =
    row.start_date < yearStart ? "morning" : (row.start_half as LeaveHalf);
  const endHalf: LeaveHalf =
    row.end_date > yearEnd ? "afternoon" : (row.end_half as LeaveHalf);
  const slots: LeaveHalfSlot[] = [];
  let date = startDate;

  while (date <= endDate) {
    if (!(date === startDate && startHalf === "afternoon")) {
      slots.push({ date, half: "morning" });
    }
    if (!(date === endDate && endHalf === "morning")) {
      slots.push({ date, half: "afternoon" });
    }
    date = addLeaveCalendarDays(date, 1);
  }

  return slots;
}

function listWorkingHalfSlotsForYear(
  row: Pick<
    LeaveEmployeeStatisticsSourceRow,
    "start_date" | "start_half" | "end_date" | "end_half"
  >,
  year: number,
  schedule: LeaveScheduleDay[],
): LeaveHalfSlot[] {
  if (!hasValidStatisticsPeriod(row)) return [];

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (row.end_date < yearStart || row.start_date > yearEnd) return [];

  return listLeaveHalfSlots(
    row.start_date < yearStart ? yearStart : row.start_date,
    row.start_date < yearStart ? "morning" : (row.start_half as LeaveHalf),
    row.end_date > yearEnd ? yearEnd : row.end_date,
    row.end_date > yearEnd ? "afternoon" : (row.end_half as LeaveHalf),
    schedule,
  );
}

interface StoredLeaveYearAllocation {
  year: number;
  days: number;
}

function parseStoredYearAllocations(
  row: LeaveEmployeeStatisticsSourceRow,
): StoredLeaveYearAllocation[] | null {
  if (!row.balance_allocations_json) return null;

  try {
    const parsed = JSON.parse(
      row.balance_allocations_json,
    ) as StoredLeaveYearAllocation[];
    const isValid =
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every(
        (item) =>
          Number.isInteger(item?.year) &&
          Number.isFinite(item?.days) &&
          item.days > 0,
      );
    const allocatedDays = isValid
      ? parsed.reduce((sum, item) => sum + item.days, 0)
      : 0;
    return isValid && Math.abs(allocatedDays - Number(row.total_days)) < 0.001
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function calculateYearAllocationsFromSchedule(
  row: LeaveEmployeeStatisticsSourceRow,
  schedule: LeaveScheduleDay[],
): StoredLeaveYearAllocation[] {
  if (!hasValidStatisticsPeriod(row)) return [];

  const startYear = Number(row.start_date.slice(0, 4));
  const endYear = Number(row.end_date.slice(0, 4));
  if (endYear - startYear > 1) return [];

  const daysByYear = new Map<number, number>();
  const slots = listLeaveHalfSlots(
    row.start_date,
    row.start_half as LeaveHalf,
    row.end_date,
    row.end_half as LeaveHalf,
    schedule,
  );
  for (const slot of slots) {
    const slotYear = Number(slot.date.slice(0, 4));
    daysByYear.set(slotYear, (daysByYear.get(slotYear) || 0) + 0.5);
  }

  return [...daysByYear.entries()]
    .map(([allocationYear, days]) => ({ year: allocationYear, days }))
    .sort((left, right) => left.year - right.year);
}

/**
 * 将一个年度区间内的申请一次性展开为逐年分摊行。
 * 优先沿用申请提交时保存的分摊；旧数据缺失或无效时，复用一次批量读取的节假日表在内存计算。
 */
export function expandLeaveEmployeeStatisticsRequestRows(
  sourceRows: LeaveEmployeeStatisticsSourceRow[],
  comparisonYears: number[],
  schedule: LeaveScheduleDay[] = [],
): LeaveEmployeeStatisticsRequestRow[] {
  const years = [...new Set(comparisonYears)]
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
  const expandedRows: LeaveEmployeeStatisticsRequestRow[] = [];

  for (const row of sourceRows) {
    const storedAllocations = parseStoredYearAllocations(row);
    const allocations =
      storedAllocations || calculateYearAllocationsFromSchedule(row, schedule);

    for (const targetYear of years) {
      // 与原统计口径一致：已保存的同年度分配取首项。
      const targetYearDays = toFiniteLeaveDays(
        allocations.find((allocation) => allocation.year === targetYear)
          ?.days || 0,
      );
      if (targetYearDays <= 0) continue;

      expandedRows.push({
        ...row,
        target_year: targetYear,
        target_year_days: roundLeaveDays(targetYearDays),
      });
    }
  }

  return expandedRows;
}

/**
 * 复用年度统计已读取的申请和节假日数据，将所选年度精确拆分到工作半天所在月份。
 * 有有效年度分配快照时，以快照半天数为守恒目标：当前工作半天过多则按时间截取，
 * 不足则从申请区间内尚未选中的日历半天按时间补足。
 */
export function expandLeaveEmployeeStatisticsMonthlyRequestRows(
  sourceRows: LeaveEmployeeStatisticsSourceRow[],
  year: number,
  schedule: LeaveScheduleDay[] = [],
): LeaveEmployeeStatisticsMonthlyRequestRow[] {
  if (!Number.isInteger(year)) return [];

  const yearPrefix = `${year}-`;
  const expandedRows: LeaveEmployeeStatisticsMonthlyRequestRow[] = [];

  for (const row of sourceRows) {
    if (!hasValidStatisticsPeriod(row)) continue;

    const currentWorkingSlots = listWorkingHalfSlotsForYear(
      row,
      year,
      schedule,
    );
    const storedAllocations = parseStoredYearAllocations(row);
    const storedAllocation = storedAllocations?.find(
      (allocation) => allocation.year === year,
    );
    let slots = currentWorkingSlots;

    if (storedAllocation) {
      const targetSlotCount = storedAllocation.days * 2;
      if (currentWorkingSlots.length >= targetSlotCount) {
        slots = currentWorkingSlots.slice(0, targetSlotCount);
      } else {
        slots = [...currentWorkingSlots];
        const selectedSlotKeys = new Set(
          slots.map((slot) => `${slot.date}:${slot.half}`),
        );
        for (const slot of listCalendarHalfSlotsForYear(row, year)) {
          if (slots.length >= targetSlotCount) break;
          const slotKey = `${slot.date}:${slot.half}`;
          if (selectedSlotKeys.has(slotKey)) continue;
          selectedSlotKeys.add(slotKey);
          slots.push(slot);
        }
        slots.sort((left, right) => {
          const dateComparison = left.date.localeCompare(right.date);
          if (dateComparison !== 0) return dateComparison;
          return left.half === right.half
            ? 0
            : left.half === "morning"
              ? -1
              : 1;
        });
      }
    } else if (storedAllocations) {
      // 有效快照未给目标年度分配时，该申请在目标年度不计入月度统计。
      slots = [];
    }

    const daysByMonth = new Map<string, number>();
    for (const slot of slots) {
      if (!slot.date.startsWith(yearPrefix)) continue;
      const month = slot.date.slice(0, 7);
      daysByMonth.set(month, (daysByMonth.get(month) || 0) + 0.5);
    }

    for (const [targetMonth, targetMonthDays] of daysByMonth) {
      expandedRows.push({
        ...row,
        target_year: year,
        target_month: targetMonth,
        target_month_days: roundLeaveDays(targetMonthDays),
      });
    }
  }

  return expandedRows;
}

function getLogicalRequestKey(
  row: Pick<LeaveEmployeeStatisticsRequestRow, "combination_group_id" | "id">,
): string {
  return row.combination_group_id
    ? `combination:${row.combination_group_id}`
    : `request:${row.id}`;
}

function getHalfOrder(half: string): number {
  return half === "afternoon" ? 1 : 0;
}

function compareRequestPeriods(
  left: LeaveEmployeeStatisticsRequestRow,
  right: LeaveEmployeeStatisticsRequestRow,
): number {
  const dateComparison = left.start_date.localeCompare(right.start_date);
  if (dateComparison !== 0) return dateComparison;
  const halfComparison =
    getHalfOrder(left.start_half) - getHalfOrder(right.start_half);
  if (halfComparison !== 0) return halfComparison;
  return left.request_no.localeCompare(right.request_no);
}

function compareNullableDatesDesc(
  left: string | null,
  right: string | null,
): number {
  return String(right || "").localeCompare(String(left || ""));
}

function buildLogicalRequest(
  mutableRequest: MutableLogicalRequest,
): LeaveEmployeeStatisticsRequest {
  const rows = [...mutableRequest.sourceRows].sort(compareRequestPeriods);
  const first = rows[0];
  const last = rows.reduce((currentLast, row) => {
    if (row.end_date > currentLast.end_date) return row;
    if (
      row.end_date === currentLast.end_date &&
      getHalfOrder(row.end_half) > getHalfOrder(currentLast.end_half)
    ) {
      return row;
    }
    return currentLast;
  }, first);
  const reasons = [
    ...new Set(
      rows.map((row) => String(row.reason || "").trim()).filter(Boolean),
    ),
  ];
  const submittedAt = rows.reduce(
    (earliest, row) =>
      row.submitted_at < earliest ? row.submitted_at : earliest,
    first.submitted_at,
  );
  const approvedAt = rows.reduce<string | null>((latest, row) => {
    if (!row.approved_at) return latest;
    return !latest || row.approved_at > latest ? row.approved_at : latest;
  }, null);

  return {
    id: first.id,
    requestNo: first.request_no,
    applicationKind: first.application_kind,
    parentRequestId: first.parent_request_id,
    status: first.status,
    startDate: first.start_date,
    startHalf: first.start_half,
    endDate: last.end_date,
    endHalf: last.end_half,
    totalDays: roundLeaveDays(mutableRequest.totalDays),
    reason: reasons.join("；"),
    submittedAt,
    approvedAt,
    segments: rows.map((row) => ({
      id: row.id,
      requestNo: row.request_no,
      leaveTypeCode: row.leave_type_code,
      leaveTypeName: row.leave_type_name,
      startDate: row.start_date,
      startHalf: row.start_half,
      endDate: row.end_date,
      endHalf: row.end_half,
      totalDays: roundLeaveDays(row.target_year_days),
    })),
  };
}

function buildTypeSummaries(
  summaries: Map<string, MutableTypeSummary>,
): LeaveEmployeeStatisticsTypeSummary[] {
  return [...summaries.values()]
    .map((summary) => ({
      leaveTypeCode: summary.leaveTypeCode,
      leaveTypeName: summary.leaveTypeName,
      requestCount: summary.requestKeys.size,
      totalDays: roundLeaveDays(summary.totalDays),
    }))
    .sort((left, right) => {
      if (right.requestCount !== left.requestCount) {
        return right.requestCount - left.requestCount;
      }
      if (right.totalDays !== left.totalDays)
        return right.totalDays - left.totalDays;
      return left.leaveTypeName.localeCompare(right.leaveTypeName, "zh-CN");
    });
}

function buildStatisticsForYear(
  year: number,
  employeeRows: LeaveEmployeeStatisticsEmployeeRow[],
  requestRows: LeaveEmployeeStatisticsRequestRow[],
  balanceRows: LeaveEmployeeStatisticsBalanceRow[],
): Pick<LeaveEmployeeStatisticsResult, "summary" | "employees"> {
  const employees = new Map<string, MutableEmployeeStatistic>();

  for (const row of employeeRows) {
    if (row.statistics_year !== undefined && row.statistics_year !== year)
      continue;
    employees.set(row.user_id, {
      userId: row.user_id,
      name: row.name,
      department: row.department,
      requestKeys: new Set<string>(),
      approvedLeaveDays: 0,
      typeSummaries: new Map<string, MutableTypeSummary>(),
      requests: new Map<string, MutableLogicalRequest>(),
    });
  }

  for (const row of requestRows) {
    if ((row.target_year ?? year) !== year) continue;
    const targetYearDays = toFiniteLeaveDays(row.target_year_days);
    if (row.status !== "approved" || targetYearDays <= 0) continue;

    let employee = employees.get(row.user_id);
    if (!employee) {
      employee = {
        userId: row.user_id,
        name: row.applicant_name,
        department: row.applicant_department,
        requestKeys: new Set<string>(),
        approvedLeaveDays: 0,
        typeSummaries: new Map<string, MutableTypeSummary>(),
        requests: new Map<string, MutableLogicalRequest>(),
      };
      employees.set(row.user_id, employee);
    }

    const logicalKey = getLogicalRequestKey(row);
    employee.requestKeys.add(logicalKey);
    employee.approvedLeaveDays += targetYearDays;

    let typeSummary = employee.typeSummaries.get(row.leave_type_code);
    if (!typeSummary) {
      typeSummary = {
        leaveTypeCode: row.leave_type_code,
        leaveTypeName: row.leave_type_name,
        requestKeys: new Set<string>(),
        totalDays: 0,
      };
      employee.typeSummaries.set(row.leave_type_code, typeSummary);
    }
    typeSummary.requestKeys.add(logicalKey);
    typeSummary.totalDays += targetYearDays;

    let logicalRequest = employee.requests.get(logicalKey);
    if (!logicalRequest) {
      logicalRequest = { sourceRows: [], totalDays: 0 };
      employee.requests.set(logicalKey, logicalRequest);
    }
    logicalRequest.sourceRows.push(row);
    logicalRequest.totalDays += targetYearDays;
  }

  const balancesByUser = new Map<
    string,
    {
      total: number;
      used: number;
      pending: number;
      summaries: LeaveEmployeeStatisticsBalanceSummary[];
    }
  >();
  for (const row of balanceRows) {
    const balance = balancesByUser.get(row.user_id) || {
      total: 0,
      used: 0,
      pending: 0,
      summaries: [],
    };
    if (row.requires_balance_check) {
      const totalDays = toFiniteLeaveDays(row.total_days ?? 0);
      const usedDays = toFiniteLeaveDays(row.used_days ?? 0);
      const pendingDays = toFiniteLeaveDays(row.pending_days ?? 0);
      balance.total += totalDays;
      balance.used += usedDays;
      balance.pending += pendingDays;
      balance.summaries.push({
        leaveTypeCode: row.leave_type_code,
        leaveTypeName: row.leave_type_name,
        requiresBalanceCheck: true,
        unlimited: false,
        totalDays: roundLeaveDays(totalDays),
        usedDays: roundLeaveDays(usedDays),
        pendingDays: roundLeaveDays(pendingDays),
        remainingDays: roundLeaveDays(
          Math.max(0, totalDays - usedDays - pendingDays),
        ),
      });
    } else {
      balance.summaries.push({
        leaveTypeCode: row.leave_type_code,
        leaveTypeName: row.leave_type_name,
        requiresBalanceCheck: false,
        unlimited: true,
        totalDays: null,
        usedDays: null,
        pendingDays: null,
        remainingDays: null,
      });
    }
    balancesByUser.set(row.user_id, balance);
  }

  const rankedEmployees = [...employees.values()]
    .map((employee) => {
      const balance = balancesByUser.get(employee.userId) || {
        total: 0,
        used: 0,
        pending: 0,
        summaries: [],
      };
      const requests = [...employee.requests.values()]
        .map(buildLogicalRequest)
        .sort((left, right) => {
          const approvedComparison = compareNullableDatesDesc(
            left.approvedAt,
            right.approvedAt,
          );
          if (approvedComparison !== 0) return approvedComparison;
          return right.submittedAt.localeCompare(left.submittedAt);
        });

      return {
        rank: 0,
        userId: employee.userId,
        name: employee.name,
        department: employee.department,
        approvedRequestCount: employee.requestKeys.size,
        approvedLeaveDays: roundLeaveDays(employee.approvedLeaveDays),
        paidLeaveTotalDays: roundLeaveDays(balance.total),
        paidLeaveUsedDays: roundLeaveDays(balance.used),
        paidLeavePendingDays: roundLeaveDays(balance.pending),
        paidLeaveRemainingDays: roundLeaveDays(
          Math.max(0, balance.total - balance.used - balance.pending),
        ),
        balanceSummaries: balance.summaries,
        typeSummaries: buildTypeSummaries(employee.typeSummaries),
        requests,
        annualTrend: [],
        monthlyTrend: [],
      } satisfies LeaveEmployeeStatistic;
    })
    .sort((left, right) => {
      if (right.approvedRequestCount !== left.approvedRequestCount) {
        return right.approvedRequestCount - left.approvedRequestCount;
      }
      if (right.approvedLeaveDays !== left.approvedLeaveDays) {
        return right.approvedLeaveDays - left.approvedLeaveDays;
      }
      const nameComparison = left.name.localeCompare(right.name, "zh-CN");
      return nameComparison !== 0
        ? nameComparison
        : left.userId.localeCompare(right.userId);
    })
    .map((employee, index) => ({ ...employee, rank: index + 1 }));

  return {
    summary: {
      employeeCount: rankedEmployees.length,
      approvedRequestCount: rankedEmployees.reduce(
        (sum, employee) => sum + employee.approvedRequestCount,
        0,
      ),
      approvedLeaveDays: roundLeaveDays(
        rankedEmployees.reduce(
          (sum, employee) => sum + employee.approvedLeaveDays,
          0,
        ),
      ),
    },
    employees: rankedEmployees,
  };
}

function buildMonthlyStatistics(
  year: number,
  employees: LeaveEmployeeStatistic[],
  requestRows: LeaveEmployeeStatisticsMonthlyRequestRow[],
): {
  monthlyComparison: LeaveEmployeeStatisticsMonthlyPoint[];
  trendsByEmployee: Map<string, LeaveEmployeeStatisticsEmployeeMonthlyPoint[]>;
} {
  const months = Array.from(
    { length: 12 },
    (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
  );
  const mutableTrendsByEmployee = new Map<
    string,
    Map<string, MutableMonthlyPoint>
  >(
    employees.map((employee) => [
      employee.userId,
      new Map(
        months.map((month) => [
          month,
          {
            month,
            requestKeys: new Set<string>(),
            approvedLeaveDays: 0,
            typeSummaries: new Map<string, MutableTypeSummary>(),
          },
        ]),
      ),
    ]),
  );

  for (const row of requestRows) {
    const targetMonthDays = toFiniteLeaveDays(row.target_month_days);
    if (
      row.status !== "approved" ||
      row.target_year !== year ||
      targetMonthDays <= 0
    ) {
      continue;
    }

    const monthlyPoint = mutableTrendsByEmployee
      .get(row.user_id)
      ?.get(row.target_month);
    if (!monthlyPoint) continue;

    const logicalKey = getLogicalRequestKey(row);
    monthlyPoint.requestKeys.add(logicalKey);
    monthlyPoint.approvedLeaveDays += targetMonthDays;

    let typeSummary = monthlyPoint.typeSummaries.get(row.leave_type_code);
    if (!typeSummary) {
      typeSummary = {
        leaveTypeCode: row.leave_type_code,
        leaveTypeName: row.leave_type_name,
        requestKeys: new Set<string>(),
        totalDays: 0,
      };
      monthlyPoint.typeSummaries.set(row.leave_type_code, typeSummary);
    }
    typeSummary.requestKeys.add(logicalKey);
    typeSummary.totalDays += targetMonthDays;
  }

  const trendsByEmployee = new Map<
    string,
    LeaveEmployeeStatisticsEmployeeMonthlyPoint[]
  >();
  for (const employee of employees) {
    const mutableTrend = mutableTrendsByEmployee.get(employee.userId)!;
    trendsByEmployee.set(
      employee.userId,
      months.map((month) => {
        const point = mutableTrend.get(month)!;
        return {
          month,
          approvedRequestCount: point.requestKeys.size,
          approvedLeaveDays: roundLeaveDays(point.approvedLeaveDays),
          typeSummaries: buildTypeSummaries(point.typeSummaries),
        };
      }),
    );
  }

  return {
    monthlyComparison: months.map((month, monthIndex) => ({
      month,
      approvedRequestCount: employees.reduce(
        (sum, employee) =>
          sum +
          (trendsByEmployee.get(employee.userId)?.[monthIndex]
            ?.approvedRequestCount || 0),
        0,
      ),
      approvedLeaveDays: roundLeaveDays(
        employees.reduce(
          (sum, employee) =>
            sum +
            (trendsByEmployee.get(employee.userId)?.[monthIndex]
              ?.approvedLeaveDays || 0),
          0,
        ),
      ),
    })),
    trendsByEmployee,
  };
}

/**
 * 将限定审批范围、限定年度且仅保留版本链叶子的已批准申请聚合为员工排名，
 * 并在同一批输入数据上生成年度对比和员工趋势。
 */
export function buildLeaveEmployeeStatistics(
  year: number,
  employeeRows: LeaveEmployeeStatisticsEmployeeRow[],
  requestRows: LeaveEmployeeStatisticsRequestRow[],
  balanceRows: LeaveEmployeeStatisticsBalanceRow[],
  options: LeaveEmployeeStatisticsBuildOptions,
): LeaveEmployeeStatisticsResult {
  const comparisonYears = [
    ...new Set([...(options.comparisonYears || [year]), year]),
  ]
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
  const normalizedRequestRows = requestRows.map((row) =>
    row.target_year === undefined ? { ...row, target_year: year } : row,
  );
  const statisticsByYear = new Map(
    comparisonYears.map((comparisonYear) => [
      comparisonYear,
      buildStatisticsForYear(
        comparisonYear,
        employeeRows,
        normalizedRequestRows,
        comparisonYear === year ? balanceRows : [],
      ),
    ]),
  );
  const selectedStatistics = statisticsByYear.get(year)!;
  const monthlyStatistics = buildMonthlyStatistics(
    year,
    selectedStatistics.employees,
    options.monthlyRequestRows || [],
  );
  const employeesByYear = new Map(
    [...statisticsByYear.entries()].map(([comparisonYear, statistics]) => [
      comparisonYear,
      new Map(
        statistics.employees.map((employee) => [employee.userId, employee]),
      ),
    ]),
  );

  return {
    year,
    generatedAt: options.generatedAt || new Date().toISOString(),
    manager: options.manager,
    summary: selectedStatistics.summary,
    annualComparison: comparisonYears.map((comparisonYear) => {
      const summary = statisticsByYear.get(comparisonYear)!.summary;
      return {
        year: comparisonYear,
        employeeCount: summary.employeeCount,
        approvedRequestCount: summary.approvedRequestCount,
        approvedLeaveDays: summary.approvedLeaveDays,
      };
    }),
    monthlyComparison: monthlyStatistics.monthlyComparison,
    employees: selectedStatistics.employees.map((employee) => ({
      ...employee,
      annualTrend: comparisonYears.map((comparisonYear) => {
        const annualEmployee = employeesByYear
          .get(comparisonYear)
          ?.get(employee.userId);
        return {
          year: comparisonYear,
          approvedRequestCount: annualEmployee?.approvedRequestCount || 0,
          approvedLeaveDays: annualEmployee?.approvedLeaveDays || 0,
        };
      }),
      monthlyTrend:
        monthlyStatistics.trendsByEmployee.get(employee.userId) || [],
    })),
  };
}
