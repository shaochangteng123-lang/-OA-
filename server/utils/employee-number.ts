export const EMPLOYEE_NUMBER_PATTERN = /^YULI-CS\d{3,6}$/

export function normalizeEmployeeNumber(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '')
}

export function isValidEmployeeNumber(value: unknown): boolean {
  return EMPLOYEE_NUMBER_PATTERN.test(normalizeEmployeeNumber(value))
}
