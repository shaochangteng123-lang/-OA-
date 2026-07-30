export const EMPLOYEE_NUMBER_PATTERN = /^YULI-CS\d{3,6}$/
const EMPLOYEE_NUMBER_PREFIX = 'YULI-CS'
const EMPLOYEE_NUMBER_MIN_DIGITS = 3
const EMPLOYEE_NUMBER_MAX_DIGITS = 6
const EMPLOYEE_NUMBER_MAX_SEQUENCE = 999999

type EmployeeNumberMax = {
  sequence: number
  digitCount: number
}

export function normalizeEmployeeNumber(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '')
}

export function isValidEmployeeNumber(value: unknown): boolean {
  return EMPLOYEE_NUMBER_PATTERN.test(normalizeEmployeeNumber(value))
}

function getEmployeeNumberDigits(value: unknown): string | null {
  const employeeNo = normalizeEmployeeNumber(value)
  if (!EMPLOYEE_NUMBER_PATTERN.test(employeeNo)) return null
  return employeeNo.slice(EMPLOYEE_NUMBER_PREFIX.length)
}

export function getEmployeeNumberSequence(value: unknown): number | null {
  const digits = getEmployeeNumberDigits(value)
  return digits === null ? null : Number(digits)
}

export function formatEmployeeNumber(
  sequence: number,
  minDigits = EMPLOYEE_NUMBER_MIN_DIGITS,
): string {
  if (
    !Number.isSafeInteger(sequence)
    || sequence < 1
    || sequence > EMPLOYEE_NUMBER_MAX_SEQUENCE
  ) {
    throw new Error('员工编号已到最大值，无法继续自动生成')
  }

  const digitCount = Math.max(
    EMPLOYEE_NUMBER_MIN_DIGITS,
    Math.min(EMPLOYEE_NUMBER_MAX_DIGITS, minDigits),
  )
  return `${EMPLOYEE_NUMBER_PREFIX}${String(sequence).padStart(digitCount, '0')}`
}

export function getNextEmployeeNumber(existingEmployeeNumbers: unknown[]): string {
  const maxNumber = existingEmployeeNumbers.reduce<EmployeeNumberMax>(
    (max, value) => {
      const digits = getEmployeeNumberDigits(value)
      if (digits === null) return max

      const sequence = Number(digits)
      if (sequence > max.sequence) {
        return { sequence, digitCount: digits.length }
      }
      if (sequence === max.sequence && digits.length > max.digitCount) {
        return { sequence, digitCount: digits.length }
      }
      return max
    },
    { sequence: 0, digitCount: EMPLOYEE_NUMBER_MIN_DIGITS },
  )

  return formatEmployeeNumber(maxNumber.sequence + 1, maxNumber.digitCount)
}
