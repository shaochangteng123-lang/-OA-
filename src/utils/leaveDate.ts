function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function parseLocalDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date.getTime()
}

export function formatLocalDateValue(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isPastLeaveDateDisabled(time: Date, today = new Date()): boolean {
  return startOfLocalDay(time) < startOfLocalDay(today)
}

export function isLeaveEndDateDisabled(time: Date, startDate: string, today = new Date()): boolean {
  const todayStart = startOfLocalDay(today)
  const startTimestamp = parseLocalDate(startDate)
  return startOfLocalDay(time) < Math.max(todayStart, startTimestamp ?? todayStart)
}
