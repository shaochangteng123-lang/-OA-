export const MONTHLY_FINANCIAL_VIEW_ROLES = [
  "super_admin",
  "admin",
  "general_manager",
] as const;

export const MONTHLY_FINANCIAL_MAINTAINER_ROLES = [
  "super_admin",
  "admin",
] as const;

export function canViewMonthlyFinancialReport(role?: string | null): boolean {
  return MONTHLY_FINANCIAL_VIEW_ROLES.some(
    (allowedRole) => allowedRole === role,
  );
}

export function canMaintainMonthlyFinancialReport(
  role?: string | null,
): boolean {
  return MONTHLY_FINANCIAL_MAINTAINER_ROLES.some(
    (allowedRole) => allowedRole === role,
  );
}
