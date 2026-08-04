import { db } from '../db/index.js'
import {
  addUtcCalendarDays,
  calculateLeaveReturnInfo,
  getBeijingLeaveClock,
  resolveApprovedCombinationSchedule,
  type LeaveReturnInfo,
  type LeaveScheduleRequest,
  type LeaveWorkdayCalendar,
} from '../utils/leave-schedule.js'

interface HolidayRow {
  date: string
  type: 'holiday' | 'workday'
}

async function getCombinationRequests(
  requests: LeaveScheduleRequest[],
): Promise<LeaveScheduleRequest[]> {
  const groupIds = [
    ...new Set(
      requests
        .filter(
          (request) =>
            request.status === 'approved' && request.combination_group_id,
        )
        .map((request) => request.combination_group_id as string),
    ),
  ]
  if (groupIds.length === 0) return []

  const placeholders = groupIds.map(() => '?').join(', ')
  return db
    .prepare(
      `SELECT lr.status, lr.start_date, lr.start_half, lr.end_date, lr.end_half,
              lr.total_days, lr.combination_group_id
       FROM leave_requests lr
       WHERE lr.combination_group_id IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1
           FROM leave_requests next_version
           WHERE next_version.original_id = lr.id
         )`,
    )
    .all<LeaveScheduleRequest>(...groupIds)
}

export async function enrichLeaveRequestsWithSchedule<
  T extends LeaveScheduleRequest,
>(requests: T[], now = new Date()): Promise<Array<T & LeaveReturnInfo>> {
  const combinationRequests = await getCombinationRequests(requests)
  const scheduleRequests = requests.map((request) => ({
    original: request,
    effective: resolveApprovedCombinationSchedule(
      request,
      combinationRequests,
    ),
  }))
  const approvedRequests = scheduleRequests
    .map((request) => request.effective)
    .filter(
      (request) => request.status === 'approved',
  )
  if (approvedRequests.length === 0) {
    const emptyCalendar: LeaveWorkdayCalendar = {
      holidayDates: new Set(),
      workdayDates: new Set(),
    }
    return scheduleRequests.map(({ original, effective }) => ({
      ...original,
      ...calculateLeaveReturnInfo(effective, emptyCalendar, now),
    }))
  }

  const clock = getBeijingLeaveClock(now)
  const earliestDate = approvedRequests.reduce(
    (earliest, request) =>
      request.start_date < earliest ? request.start_date : earliest,
    clock.date,
  )
  const latestEndDate = approvedRequests.reduce(
    (latest, request) =>
      request.end_date > latest ? request.end_date : latest,
    approvedRequests[0].end_date,
  )
  const holidayRows = await db
    .prepare(
      `SELECT date, type
     FROM holidays
     WHERE date >= ? AND date <= ?`,
    )
    .all<HolidayRow>(earliestDate, addUtcCalendarDays(latestEndDate, 366))

  const calendar: LeaveWorkdayCalendar = {
    holidayDates: new Set(
      holidayRows
        .filter((row) => row.type === 'holiday')
        .map((row) => row.date),
    ),
    workdayDates: new Set(
      holidayRows
        .filter((row) => row.type === 'workday')
        .map((row) => row.date),
    ),
  }

  return scheduleRequests.map(({ original, effective }) => ({
    ...original,
    ...calculateLeaveReturnInfo(effective, calendar, now),
  }))
}
