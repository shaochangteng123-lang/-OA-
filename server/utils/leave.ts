import { formatLocalDate } from './date.js'

const MAX_LEAVE_RANGE_DAYS = 366

export function isValidLeaveDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime()) && formatLocalDate(date) === value
}

export function validateLeavePeriod(
  startDate: unknown,
  startHalf: unknown,
  endDate: unknown,
  endHalf: unknown,
  today = formatLocalDate()
): string | null {
  if (
    typeof startDate !== 'string' ||
    typeof endDate !== 'string' ||
    !isValidLeaveDate(startDate) ||
    !isValidLeaveDate(endDate)
  ) {
    return '请填写有效的请假日期'
  }

  if (!['morning', 'afternoon'].includes(String(startHalf)) || !['morning', 'afternoon'].includes(String(endHalf))) {
    return '请选择有效的请假时段'
  }

  if (startDate < today) return '开始日期不能早于今天'
  if (startDate > endDate) return '结束日期不能早于开始日期'
  if (startDate === endDate && startHalf === 'afternoon' && endHalf === 'morning') {
    return '结束时间不能早于开始时间'
  }

  const startTime = Date.parse(`${startDate}T00:00:00Z`)
  const endTime = Date.parse(`${endDate}T00:00:00Z`)
  const calendarDays = Math.floor((endTime - startTime) / 86400000) + 1
  if (calendarDays > MAX_LEAVE_RANGE_DAYS) return `单次请假区间不能超过 ${MAX_LEAVE_RANGE_DAYS} 天`

  return null
}

/**
 * 根据入职日期和指定年份计算年假额度
 * - 工龄 < 1 年：0 天
 * - 1 ≤ 工龄 < 10 年：5 天
 * - 10 ≤ 工龄 < 20 年：10 天
 * - 工龄 ≥ 20 年：15 天
 */
export function calculateAnnualLeaveDays(hireDate: Date | string, year: number, asOfDate = new Date()): number {
  let hireYear: number
  let hireMonth: number
  let hireDay: number

  if (typeof hireDate === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(hireDate)
    if (!match) return 0
    hireYear = Number(match[1])
    hireMonth = Number(match[2])
    hireDay = Number(match[3])
    const normalizedHireDate = new Date(hireYear, hireMonth - 1, hireDay)
    if (
      normalizedHireDate.getFullYear() !== hireYear ||
      normalizedHireDate.getMonth() !== hireMonth - 1 ||
      normalizedHireDate.getDate() !== hireDay
    ) {
      return 0
    }
  } else {
    if (Number.isNaN(hireDate.getTime())) return 0
    hireYear = hireDate.getFullYear()
    hireMonth = hireDate.getMonth() + 1
    hireDay = hireDate.getDate()
  }

  if (Number.isNaN(asOfDate.getTime())) return 0
  const referenceDate = asOfDate.getFullYear() === year ? asOfDate : new Date(year, 0, 1)
  const referenceYear = referenceDate.getFullYear()
  const referenceMonth = referenceDate.getMonth() + 1
  const referenceDay = referenceDate.getDate()
  const anniversaryDay = Math.min(hireDay, new Date(referenceYear, hireMonth, 0).getDate())
  let yearsOfService = referenceYear - hireYear

  if (referenceMonth < hireMonth || (referenceMonth === hireMonth && referenceDay < anniversaryDay)) {
    yearsOfService -= 1
  }

  if (yearsOfService < 1) return 0
  if (yearsOfService < 10) return 5
  if (yearsOfService < 20) return 10
  return 15
}

/**
 * 计算员工最终年假额度。
 * 所有员工先获得年假类型配置的基础额度，有有效入职日期时再按工龄上调。
 */
export function calculateAnnualLeaveEntitlement(
  hireDate: Date | string | null | undefined,
  year: number,
  defaultDays: number,
  asOfDate = new Date()
): number {
  const baseDays = Number.isFinite(defaultDays) && defaultDays > 0 ? defaultDays : 0
  if (!hireDate) return baseDays
  return Math.max(baseDays, calculateAnnualLeaveDays(hireDate, year, asOfDate))
}
