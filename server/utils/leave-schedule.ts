export type LeaveScheduleHalf = 'morning' | 'afternoon'

export interface LeaveScheduleRequest {
  status: string
  start_date: string
  start_half: LeaveScheduleHalf
  end_date: string
  end_half: LeaveScheduleHalf
  total_days: number
  combination_group_id?: string | null
}

export interface LeaveWorkdayCalendar {
  holidayDates: Set<string>
  workdayDates: Set<string>
}

export interface LeaveReturnInfo {
  remaining_days: number | null
  remaining_leave_days: number | null
  return_to_work_date: string | null
  return_to_work_half: LeaveScheduleHalf | null
  leave_timing_status: 'not_applicable' | 'upcoming' | 'on_leave' | 'returned'
}

export interface BeijingLeaveClock {
  date: string
  half: LeaveScheduleHalf
  halfIndex: 0 | 1
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseDateToEpochDay(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
}

function formatEpochDay(epochDay: number): string {
  return formatUtcDate(new Date(epochDay * DAY_MS))
}

function halfToIndex(half: LeaveScheduleHalf): 0 | 1 {
  return half === 'morning' ? 0 : 1
}

function toSlot(date: string, half: LeaveScheduleHalf): number {
  return parseDateToEpochDay(date) * 2 + halfToIndex(half)
}

function fromSlot(slot: number): { date: string; half: LeaveScheduleHalf } {
  return {
    date: formatEpochDay(Math.floor(slot / 2)),
    half: slot % 2 === 0 ? 'morning' : 'afternoon',
  }
}

function findReturnSlot(
  request: Pick<LeaveScheduleRequest, 'end_date' | 'end_half'>,
  calendar: LeaveWorkdayCalendar,
): number {
  let returnSlot = toSlot(request.end_date, request.end_half) + 1
  // 单次请假区间最长一年；额外一年足以跨过连续节假日并找到返岗时段。
  const returnSearchLimit = returnSlot + 366 * 2
  while (returnSlot <= returnSearchLimit) {
    const candidate = fromSlot(returnSlot)
    if (isWorkingDate(candidate.date, calendar)) return returnSlot
    returnSlot = (Math.floor(returnSlot / 2) + 1) * 2
  }
  return returnSlot
}

export function addUtcCalendarDays(date: string, days: number): string {
  return formatEpochDay(parseDateToEpochDay(date) + days)
}

export function getBeijingLeaveClock(now = new Date()): BeijingLeaveClock {
  const beijingTime = new Date(now.getTime() + BEIJING_OFFSET_MS)
  const hour = beijingTime.getUTCHours()
  const halfIndex: 0 | 1 = hour < 12 ? 0 : 1
  return {
    date: formatUtcDate(beijingTime),
    half: halfIndex === 0 ? 'morning' : 'afternoon',
    halfIndex,
  }
}

export function isWorkingDate(
  date: string,
  calendar: LeaveWorkdayCalendar,
): boolean {
  if (calendar.workdayDates.has(date)) return true
  if (calendar.holidayDates.has(date)) return false

  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay()
  return dayOfWeek !== 0 && dayOfWeek !== 6
}

export function resolveApprovedCombinationSchedule(
  request: LeaveScheduleRequest,
  combinationRequests: LeaveScheduleRequest[],
): LeaveScheduleRequest {
  const groupId = request.combination_group_id
  if (!groupId || request.status !== 'approved') return request

  const groupRequests = combinationRequests.filter(
    (item) => item.combination_group_id === groupId,
  )
  if (
    groupRequests.length < 2 ||
    groupRequests.some((item) => item.status !== 'approved')
  ) {
    return request
  }

  const firstRequest = groupRequests.reduce((first, item) =>
    toSlot(item.start_date, item.start_half) <
    toSlot(first.start_date, first.start_half)
      ? item
      : first,
  )
  const lastRequest = groupRequests.reduce((last, item) =>
    toSlot(item.end_date, item.end_half) >
    toSlot(last.end_date, last.end_half)
      ? item
      : last,
  )

  return {
    ...request,
    start_date: firstRequest.start_date,
    start_half: firstRequest.start_half,
    end_date: lastRequest.end_date,
    end_half: lastRequest.end_half,
    total_days: groupRequests.reduce(
      (total, item) => total + Number(item.total_days),
      0,
    ),
  }
}

export function isApprovedLeaveActive(
  request: Pick<
    LeaveScheduleRequest,
    'status' | 'start_date' | 'start_half' | 'end_date' | 'end_half'
  >,
  now = new Date(),
  calendar: LeaveWorkdayCalendar = {
    holidayDates: new Set(),
    workdayDates: new Set(),
  },
): boolean {
  if (request.status !== 'approved') return false

  const clock = getBeijingLeaveClock(now)
  const currentSlot = toSlot(clock.date, clock.half)
  return (
    currentSlot >= toSlot(request.start_date, request.start_half) &&
    currentSlot < findReturnSlot(request, calendar)
  )
}

export function calculateLeaveReturnInfo(
  request: LeaveScheduleRequest,
  calendar: LeaveWorkdayCalendar,
  now = new Date(),
): LeaveReturnInfo {
  if (request.status !== 'approved') {
    return {
      remaining_days: null,
      remaining_leave_days: null,
      return_to_work_date: null,
      return_to_work_half: null,
      leave_timing_status: 'not_applicable',
    }
  }

  const startSlot = toSlot(request.start_date, request.start_half)
  const endSlot = toSlot(request.end_date, request.end_half)
  const clock = getBeijingLeaveClock(now)
  const currentSlot = toSlot(clock.date, clock.half)

  const returnSlot = findReturnSlot(request, calendar)
  const returnToWork = fromSlot(returnSlot)

  let remainingLeaveDays = 0
  if (currentSlot < startSlot) {
    remainingLeaveDays = Number(request.total_days)
  } else if (currentSlot <= endSlot) {
    for (
      let slot = Math.max(currentSlot, startSlot);
      slot <= endSlot;
      slot += 1
    ) {
      const segment = fromSlot(slot)
      if (isWorkingDate(segment.date, calendar)) remainingLeaveDays += 0.5
    }
  }

  const leaveTimingStatus =
    currentSlot < startSlot
      ? 'upcoming'
      : currentSlot < returnSlot
        ? 'on_leave'
        : 'returned'

  return {
    remaining_days: Math.max(0, (returnSlot - currentSlot) / 2),
    remaining_leave_days: remainingLeaveDays,
    return_to_work_date: returnToWork.date,
    return_to_work_half: returnToWork.half,
    leave_timing_status: leaveTimingStatus,
  }
}
