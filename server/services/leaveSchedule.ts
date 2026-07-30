import { db } from '../db/index.js'
import {
  addUtcCalendarDays,
  calculateLeaveReturnInfo,
  getBeijingLeaveClock,
  type LeaveReturnInfo,
  type LeaveScheduleRequest,
  type LeaveWorkdayCalendar,
} from '../utils/leave-schedule.js'

interface HolidayRow {
  date: string
  type: 'holiday' | 'workday'
}

export async function enrichLeaveRequestsWithSchedule<
  T extends LeaveScheduleRequest,
>(requests: T[], now = new Date()): Promise<Array<T & LeaveReturnInfo>> {
  const approvedRequests = requests.filter(
    (request) => request.status === 'approved',
  )
  if (approvedRequests.length === 0) {
    const emptyCalendar: LeaveWorkdayCalendar = {
      holidayDates: new Set(),
      workdayDates: new Set(),
    }
    return requests.map((request) => ({
      ...request,
      ...calculateLeaveReturnInfo(request, emptyCalendar, now),
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

  return requests.map((request) => ({
    ...request,
    ...calculateLeaveReturnInfo(request, calendar, now),
  }))
}
