// 中国节假日数据
// 数据来源：国务院办公厅关于节假日安排的通知
// 参考：https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html

import { api } from './api.js'
import { fallbackHolidays, mergeHolidaysWithFallback, type HolidayInfo } from './holidayData.js'

export type { HolidayInfo } from './holidayData.js'

// 节假日数据缓存
let holidaysCache: HolidayInfo[] | null = null
let cacheTimestamp: number = 0
const CACHE_DURATION = 1000 * 60 * 60 // 1小时缓存

/**
 * 从API获取节假日数据
 */
async function fetchHolidays(): Promise<HolidayInfo[] | null> {
  try {
    const response = await api.get<{ success: boolean; data: HolidayInfo[] }>('/api/holidays')
    if (response.data.success && Array.isArray(response.data.data)) {
      return response.data.data
    }
    return null
  } catch (error) {
    console.error('获取节假日数据失败:', error)
    return null
  }
}

/**
 * 获取节假日数据（带缓存）
 */
async function getHolidaysData(): Promise<HolidayInfo[]> {
  const now = Date.now()

  // 如果缓存有效，直接返回
  if (holidaysCache && now - cacheTimestamp < CACHE_DURATION) {
    return holidaysCache
  }

  const fetchedHolidays = await fetchHolidays()
  const availableHolidays = fetchedHolidays ?? holidaysCache ?? []
  holidaysCache = mergeHolidaysWithFallback(availableHolidays)

  // 请求失败或空表通常发生在前后端启动阶段，不缓存该状态，允许后续重新获取。
  cacheTimestamp = fetchedHolidays?.length ? now : 0

  return holidaysCache
}

function getSynchronousHolidayData(): HolidayInfo[] {
  return holidaysCache?.length ? holidaysCache : fallbackHolidays
}

/**
 * 获取指定日期的节假日信息
 * @param date 日期对象或日期字符串
 * @returns 节假日信息，如果不是节假日/补班日则返回 null
 */
export async function getHolidayInfo(date: Date | string): Promise<HolidayInfo | null> {
  const dateStr = typeof date === 'string' ? date : formatDateString(date)
  const holidays = await getHolidaysData()
  return holidays.find((h) => h.date === dateStr) || null
}

/**
 * 同步版本的获取节假日信息（使用缓存或备用数据）
 * 注意：首次调用可能返回备用数据，建议使用异步版本
 */
export function getHolidayInfoSync(date: Date | string): HolidayInfo | null {
  const dateStr = typeof date === 'string' ? date : formatDateString(date)
  return getSynchronousHolidayData().find((h) => h.date === dateStr) || null
}

/**
 * 判断是否为节假日
 * @param date 日期对象或日期字符串
 */
export async function isHoliday(date: Date | string): Promise<boolean> {
  const info = await getHolidayInfo(date)
  return info?.type === 'holiday'
}

/**
 * 同步版本的判断是否为节假日
 */
export function isHolidaySync(date: Date | string): boolean {
  const info = getHolidayInfoSync(date)
  return info?.type === 'holiday'
}

/**
 * 判断是否为补班日
 * @param date 日期对象或日期字符串
 */
export async function isWorkday(date: Date | string): Promise<boolean> {
  const info = await getHolidayInfo(date)
  return info?.type === 'workday'
}

/**
 * 同步版本的判断是否为补班日
 */
export function isWorkdaySync(date: Date | string): boolean {
  const info = getHolidayInfoSync(date)
  return info?.type === 'workday'
}

/**
 * 获取节假日名称（简短版本，用于日历显示）
 * @param date 日期对象或日期字符串
 */
export function getHolidayLabel(date: Date | string): string | null {
  const info = getHolidayInfoSync(date)
  if (!info) return null

  if (info.type === 'workday') {
    return '班'
  }

  // 节假日显示为"名称（休）"格式
  return `${info.name}（休）`
}

/**
 * 格式化日期为 yyyy-MM-dd 字符串
 * 使用本地时区，确保与日历组件中的日期对象匹配
 * 注意：date-fns 返回的日期对象可能包含时间部分，但 getFullYear/getMonth/getDate 会返回本地时区的值
 */
function formatDateString(date: Date): string {
  // 确保使用本地时区的年月日，避免时区转换问题
  // 即使日期对象包含时间部分，这些方法也会返回本地时区的值
  const year = date.getFullYear()
  const month = date.getMonth() + 1 // 0-11 -> 1-12
  const day = date.getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * 获取指定年份的所有节假日
 * @param year 年份
 */
export async function getHolidaysByYear(year: number): Promise<HolidayInfo[]> {
  const holidays = await getHolidaysData()
  return holidays.filter((h) => h.date.startsWith(`${year}-`))
}

/**
 * 同步版本的获取指定年份的所有节假日
 */
export function getHolidaysByYearSync(year: number): HolidayInfo[] {
  const holidays = getSynchronousHolidayData()
  return holidays.filter((h) => h.date.startsWith(`${year}-`))
}

/**
 * 获取指定月份的所有节假日
 * @param year 年份
 * @param month 月份 (1-12)
 */
export async function getHolidaysByMonth(year: number, month: number): Promise<HolidayInfo[]> {
  const holidays = await getHolidaysData()
  const monthStr = String(month).padStart(2, '0')
  return holidays.filter((h) => h.date.startsWith(`${year}-${monthStr}-`))
}

/**
 * 同步版本的获取指定月份的所有节假日
 */
export function getHolidaysByMonthSync(year: number, month: number): HolidayInfo[] {
  const holidays = getSynchronousHolidayData()
  const monthStr = String(month).padStart(2, '0')
  return holidays.filter((h) => h.date.startsWith(`${year}-${monthStr}-`))
}

/**
 * 初始化节假日数据（在应用启动时调用）
 */
export async function initHolidays(): Promise<void> {
  try {
    await getHolidaysData()
  } catch (error) {
    console.error('初始化节假日数据失败:', error)
  }
}
