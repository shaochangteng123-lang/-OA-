export const LEAVE_REQUEST_NO_PREFIX = 'QJ'

export function getLeaveRequestNoPattern(year: number): string {
  return `${LEAVE_REQUEST_NO_PREFIX}-${year}-%`
}

export function getNextLeaveRequestNo(
  year: number,
  lastRequestNo?: string | null,
): string {
  const match = lastRequestNo?.match(
    new RegExp(`^${LEAVE_REQUEST_NO_PREFIX}-${year}-(\\d+)$`),
  )
  const sequence = match ? Number.parseInt(match[1], 10) + 1 : 1
  return `${LEAVE_REQUEST_NO_PREFIX}-${year}-${String(sequence).padStart(5, '0')}`
}
