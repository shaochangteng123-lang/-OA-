const FIXED_BALANCE_LEAVE_TYPES = new Set([
  "annual",
  "personal",
  "bereavement",
  "compensatory",
  "marriage",
  "maternity",
  "paternity",
]);

export function resolveLeaveTypeBalancePolicy(
  code: string,
  requestedRequiresBalanceCheck: boolean,
  requestedDefaultDays: number,
): { requiresBalanceCheck: boolean; defaultDays: number } {
  if (FIXED_BALANCE_LEAVE_TYPES.has(code)) {
    return { requiresBalanceCheck: true, defaultDays: requestedDefaultDays };
  }
  return {
    requiresBalanceCheck: requestedRequiresBalanceCheck,
    defaultDays: requestedDefaultDays,
  };
}
