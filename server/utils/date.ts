export function addCalendarMonthsClamped(dateString: string, months: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString) || !Number.isInteger(months)) {
    throw new Error('日期或月份增量无效')
  }

  const source = new Date(`${dateString}T00:00:00Z`)
  if (Number.isNaN(source.getTime()) || source.toISOString().slice(0, 10) !== dateString) {
    throw new Error('日期无效')
  }

  const totalMonths = source.getUTCFullYear() * 12 + source.getUTCMonth() + months
  const targetYear = Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const targetDay = Math.min(source.getUTCDate(), lastDay)
  return new Date(Date.UTC(targetYear, targetMonth, targetDay)).toISOString().slice(0, 10)
}

export function formatLocalDate(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
