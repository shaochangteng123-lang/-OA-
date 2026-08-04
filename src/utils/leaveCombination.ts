export interface AutomaticCombinedLeaveDaysInput {
  requiresBalanceCheck: boolean
  availableDays: number
  currentDays?: number
}

function toHalfDaysOrZero(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.floor((days + Number.EPSILON) * 2) / 2
}

/**
 * 固定额度类型自动取全部可用余额；不限额度类型保留当前填写值。
 */
export function getAutomaticCombinedLeaveDays(
  input: AutomaticCombinedLeaveDaysInput
): number {
  if (input.requiresBalanceCheck) return toHalfDaysOrZero(input.availableDays)
  return toHalfDaysOrZero(Number(input.currentDays))
}
