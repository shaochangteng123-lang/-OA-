export const MONTHLY_FINANCIAL_MAINTAIN_ROLES = [
  "admin",
  "super_admin",
] as const;

export const MONTHLY_FINANCIAL_READ_ROLES = [
  ...MONTHLY_FINANCIAL_MAINTAIN_ROLES,
  "general_manager",
] as const;

export function canMaintainMonthlyFinancialReport(role: unknown): boolean {
  return (
    typeof role === "string" &&
    (MONTHLY_FINANCIAL_MAINTAIN_ROLES as readonly string[]).includes(role)
  );
}

export function canReadMonthlyFinancialReport(role: unknown): boolean {
  return (
    typeof role === "string" &&
    (MONTHLY_FINANCIAL_READ_ROLES as readonly string[]).includes(role)
  );
}
