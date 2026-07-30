import { pool } from '../db/index.js'
import { isValidLeaveDate } from '../utils/leave.js'
export { calculateAnnualLeaveDays, calculateAnnualLeaveEntitlement } from '../utils/leave.js'
export { isValidLeaveDate }

/**
 * 工作日计算服务
 * 用于计算请假申请的实际工作天数，排除周末和法定节假日
 */

/**
 * 将日期格式化为 YYYY-MM-DD 字符串
 */
function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export type LeaveHalf = 'morning' | 'afternoon'

export interface LeaveYearAllocation {
  year: number
  days: number
}

/**
 * 计算两个半天之间的实际工作天数
 * - 排除周六、周日（除非 holidays 表标注为 workday 调班日）
 * - 排除 holidays 表中 type='holiday' 的日期
 * - start_half='afternoon' 时，首日算 0.5 天
 * - end_half='morning' 时，末日算 0.5 天
 */
export async function calculateLeaveDays(
  startDate: string,
  startHalf: LeaveHalf,
  endDate: string,
  endHalf: LeaveHalf
): Promise<number> {
  if (startDate > endDate) return 0
  if (startDate === endDate && startHalf === 'afternoon' && endHalf === 'morning') return 0

  // 查询区间内所有假期/调班日记录
  const holidayResult = await pool.query(
    `SELECT date, type FROM holidays WHERE date >= $1 AND date <= $2`,
    [startDate, endDate]
  )

  const holidaySet = new Set<string>()
  const workdaySet = new Set<string>()
  for (const row of holidayResult.rows) {
    if (row.type === 'holiday') holidaySet.add(row.date)
    else if (row.type === 'workday') workdaySet.add(row.date)
  }

  let days = 0
  const cursor = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')

  while (cursor <= end) {
    const dateStr = formatDate(cursor)
    const dayOfWeek = cursor.getDay() // 0=周日, 6=周六
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const isHoliday = holidaySet.has(dateStr)
    const isWorkday = workdaySet.has(dateStr) // 调班日，周末也算工作日

    const isWorkingDay = (!isWeekend && !isHoliday) || isWorkday

    if (isWorkingDay) {
      const isFirst = dateStr === startDate
      const isLast = dateStr === endDate

      if (isFirst && isLast) {
        // 同一天
        if (startHalf === 'morning' && endHalf === 'afternoon') {
          days += 1 // 全天
        } else {
          days += 0.5 // 只有上午或只有下午
        }
      } else if (isFirst) {
        // 首日：下午开始只算半天
        days += startHalf === 'morning' ? 1 : 0.5
      } else if (isLast) {
        // 末日：上午结束只算半天
        days += endHalf === 'afternoon' ? 1 : 0.5
      } else {
        days += 1 // 中间整日
      }
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  return days
}

/**
 * 按实际请假日期所属年份拆分工作日天数。
 */
export async function calculateLeaveDaysByYear(
  startDate: string,
  startHalf: LeaveHalf,
  endDate: string,
  endHalf: LeaveHalf
): Promise<LeaveYearAllocation[]> {
  if (!isValidLeaveDate(startDate) || !isValidLeaveDate(endDate) || startDate > endDate) {
    return []
  }

  const startYear = Number(startDate.slice(0, 4))
  const endYear = Number(endDate.slice(0, 4))
  if (endYear - startYear > 1) return []
  const allocations: LeaveYearAllocation[] = []

  for (let year = startYear; year <= endYear; year++) {
    const segmentStart = year === startYear ? startDate : `${year}-01-01`
    const segmentEnd = year === endYear ? endDate : `${year}-12-31`
    const segmentStartHalf: LeaveHalf = year === startYear ? startHalf : 'morning'
    const segmentEndHalf: LeaveHalf = year === endYear ? endHalf : 'afternoon'
    const days = await calculateLeaveDays(segmentStart, segmentStartHalf, segmentEnd, segmentEndHalf)

    if (days > 0) allocations.push({ year, days })
  }

  return allocations
}

/**
 * 根据假期类型代码返回法定默认额度
 */
export function getLegalLeaveDays(leaveTypeCode: string): number {
  const defaults: Record<string, number> = {
    annual: 5,
    personal: 3,
    sick: 30,
    compensatory: 0,
    marriage: 3,
    maternity: 98,
    paternity: 15,
  }
  return defaults[leaveTypeCode] ?? 0
}
