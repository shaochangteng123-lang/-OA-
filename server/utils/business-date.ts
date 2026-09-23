const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'
const SHANGHAI_OFFSET_HOURS = 8
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_ONLY_PATTERN = /^(\d{4})-(\d{2})$/
const TIME_ONLY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{3}))?)?$/

interface DateOnlyParts {
  year: number
  month: number
  day: number
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }

  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function parseDateOnly(dateText: string): DateOnlyParts {
  const match = typeof dateText === 'string' ? DATE_ONLY_PATTERN.exec(dateText) : null
  if (!match) {
    throw new Error('日期必须使用四位年份、两位月份和两位日期')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > getDaysInMonth(year, month)) {
    throw new Error('日期不是有效的公历日期')
  }

  return { year, month, day }
}

function createUtcDate(parts: DateOnlyParts): Date {
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  return date
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear()
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error('日期计算结果超出四位年份范围')
  }

  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${String(year).padStart(4, '0')}-${month}-${day}`
}

/**
 * 按上海时区返回业务日期，不受服务器本地时区影响。
 */
export function getBusinessDate(date: Date = new Date()): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('时间不是有效值')
  }

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = new Map(parts.map(part => [part.type, part.value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')

  if (!year || !month || !day) {
    throw new Error('无法确定上海业务日期')
  }

  const businessDate = `${year.padStart(4, '0')}-${month}-${day}`
  parseDateOnly(businessDate)
  return businessDate
}

/**
 * 在纯日期上增减自然日，不经过服务器本地时区。
 */
export function addDateOnlyDays(dateText: string, days: number): string {
  const parts = parseDateOnly(dateText)
  if (!Number.isSafeInteger(days)) {
    throw new Error('日期增量必须是整数')
  }

  const date = createUtcDate(parts)
  date.setUTCDate(date.getUTCDate() + days)
  return formatUtcDate(date)
}

/**
 * 返回纯日期对应的星期序号，星期日为零。
 */
export function getDateOnlyDayOfWeek(dateText: string): number {
  return createUtcDate(parseDateOnly(dateText)).getUTCDay()
}

/**
 * 返回指定日期所在自然周的周一和周日。
 */
export function getWeekRangeFromDate(dateText: string): { weekStart: string; weekEnd: string } {
  const dayOfWeek = getDateOnlyDayOfWeek(dateText)
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = addDateOnlyDays(dateText, -daysFromMonday)

  return {
    weekStart,
    weekEnd: addDateOnlyDays(weekStart, 6),
  }
}

/**
 * 返回指定月份的首日、末日和总天数。
 */
export function getMonthRangeFromMonth(monthText: string): {
  monthStart: string
  monthEnd: string
  daysInMonth: number
} {
  const match = typeof monthText === 'string' ? MONTH_ONLY_PATTERN.exec(monthText) : null
  if (!match) {
    throw new Error('月份必须使用四位年份和两位月份')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (year < 1 || month < 1 || month > 12) {
    throw new Error('月份不是有效的公历月份')
  }

  const daysInMonth = getDaysInMonth(year, month)
  return {
    monthStart: `${monthText}-01`,
    monthEnd: `${monthText}-${String(daysInMonth).padStart(2, '0')}`,
    daysInMonth,
  }
}

/**
 * 将上海业务日期和时间转换为固定东八区时刻。
 */
export function toBusinessDateTime(dateText: string, timeText: string): Date {
  const dateParts = parseDateOnly(dateText)
  const match = typeof timeText === 'string' ? TIME_ONLY_PATTERN.exec(timeText) : null
  if (!match) {
    throw new Error('时间必须使用时分、时分秒或含三位毫秒的完整格式')
  }

  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = match[3] === undefined ? 0 : Number(match[3])
  const millisecond = match[4] === undefined ? 0 : Number(match[4])
  const date = createUtcDate(dateParts)
  date.setUTCHours(hour - SHANGHAI_OFFSET_HOURS, minute, second, millisecond)
  return date
}
