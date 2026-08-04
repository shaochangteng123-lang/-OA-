export type LeaveHalf = 'morning' | 'afternoon'

export interface LeaveScheduleDay {
  date: string
  type: 'holiday' | 'workday'
}

export interface LeaveHalfSlot {
  date: string
  half: LeaveHalf
}

export interface LeavePeriod {
  startDate: string
  startHalf: LeaveHalf
  endDate: string
  endHalf: LeaveHalf
  days: number
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function addLeaveCalendarDays(date: string, days: number): string {
  const result = parseDate(date)
  result.setUTCDate(result.getUTCDate() + days)
  return formatDate(result)
}

function createScheduleMap(schedule: LeaveScheduleDay[]): Map<string, LeaveScheduleDay['type']> {
  return new Map(schedule.map(item => [item.date, item.type]))
}

function isWorkingDate(date: string, scheduleMap: Map<string, LeaveScheduleDay['type']>): boolean {
  const configuredType = scheduleMap.get(date)
  if (configuredType === 'workday') return true
  if (configuredType === 'holiday') return false

  const day = parseDate(date).getUTCDay()
  return day !== 0 && day !== 6
}

function assertHalfDayValue(days: number): number {
  const slots = days * 2
  if (!Number.isFinite(days) || days <= 0 || !Number.isInteger(slots)) {
    throw new Error('请假天数必须是大于 0 的半天倍数')
  }
  return slots
}

/**
 * 将一个日期区间展开为可请假的半天时段，自动排除周末和法定节假日。
 */
export function listLeaveHalfSlots(
  startDate: string,
  startHalf: LeaveHalf,
  endDate: string,
  endHalf: LeaveHalf,
  schedule: LeaveScheduleDay[] = []
): LeaveHalfSlot[] {
  if (startDate > endDate) return []
  if (startDate === endDate && startHalf === 'afternoon' && endHalf === 'morning') return []

  const scheduleMap = createScheduleMap(schedule)
  const slots: LeaveHalfSlot[] = []
  let date = startDate

  while (date <= endDate) {
    if (isWorkingDate(date, scheduleMap)) {
      const halves: LeaveHalf[] = ['morning', 'afternoon']
      for (const half of halves) {
        if (date === startDate && startHalf === 'afternoon' && half === 'morning') continue
        if (date === endDate && endHalf === 'morning' && half === 'afternoon') continue
        slots.push({ date, half })
      }
    }
    date = addLeaveCalendarDays(date, 1)
  }

  return slots
}

/**
 * 根据可用半天时段和每段天数，按时间顺序拆分为独立请假区间。
 */
export function splitLeaveHalfSlots(slots: LeaveHalfSlot[], segmentDays: number[]): LeavePeriod[] {
  const segmentSlotCounts = segmentDays.map(assertHalfDayValue)
  const requiredSlots = segmentSlotCounts.reduce((sum, count) => sum + count, 0)
  if (requiredSlots !== slots.length) {
    throw new Error(`组合假期已分配 ${requiredSlots / 2} 天，与所选时段 ${slots.length / 2} 天不一致`)
  }

  let offset = 0
  return segmentSlotCounts.map((slotCount, index) => {
    const first = slots[offset]
    const last = slots[offset + slotCount - 1]
    if (!first || !last) throw new Error('组合假期时间拆分失败')
    offset += slotCount

    return {
      startDate: first.date,
      startHalf: first.half,
      endDate: last.date,
      endHalf: last.half,
      days: segmentDays[index],
    }
  })
}

/**
 * 从指定日期和半天开始，向后找到可容纳目标天数的连续工作时段。
 */
export function findLeavePeriodByDays(
  startDate: string,
  startHalf: LeaveHalf,
  targetDays: number,
  maxEndDate: string,
  schedule: LeaveScheduleDay[] = []
): LeavePeriod | null {
  const requiredSlots = assertHalfDayValue(targetDays)
  const slots = listLeaveHalfSlots(startDate, startHalf, maxEndDate, 'afternoon', schedule)
  if (slots.length < requiredSlots) return null

  const selected = slots.slice(0, requiredSlots)
  const first = selected[0]
  const last = selected[selected.length - 1]
  if (!first || !last) return null

  return {
    startDate: first.date,
    startHalf: first.half,
    endDate: last.date,
    endHalf: last.half,
    days: targetDays,
  }
}

/**
 * 返回给定半天结束后的第一个工作半天。
 */
export function findNextLeaveHalfSlot(
  endDate: string,
  endHalf: LeaveHalf,
  maxEndDate: string,
  schedule: LeaveScheduleDay[] = []
): LeaveHalfSlot | null {
  const candidateDate = endHalf === 'morning' ? endDate : addLeaveCalendarDays(endDate, 1)
  const candidateHalf: LeaveHalf = endHalf === 'morning' ? 'afternoon' : 'morning'
  const period = findLeavePeriodByDays(candidateDate, candidateHalf, 0.5, maxEndDate, schedule)
  return period ? { date: period.startDate, half: period.startHalf } : null
}
