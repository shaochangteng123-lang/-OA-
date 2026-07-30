import { formatLocalDate } from './date.js'

const PROFILE_FIELDS = [
  'name',
  'gender',
  'birth_date',
  'id_number',
  'native_place',
  'ethnicity',
  'marital_status',
  'education',
  'school',
  'major',
  'mobile',
  'email',
  'emergency_contact',
  'emergency_phone',
  'address',
  'hire_date',
  'bank_account_name',
  'bank_account_phone',
  'bank_name',
  'bank_account_number',
] as const

export type EmployeeProfileField = typeof PROFILE_FIELDS[number]
export type NormalizedEmployeeProfileInput = Record<EmployeeProfileField, string | null>

const REQUIRED_FIELD_LABELS: Record<EmployeeProfileField, string> = {
  name: '姓名',
  gender: '性别',
  birth_date: '出生日期',
  id_number: '身份证号',
  native_place: '籍贯',
  ethnicity: '民族',
  marital_status: '婚姻状况',
  education: '学历',
  school: '毕业院校',
  major: '所学专业',
  mobile: '手机号码',
  email: '电子邮箱',
  emergency_contact: '紧急联系人',
  emergency_phone: '紧急联系人电话',
  address: '现居住地址',
  hire_date: '入职日期',
  bank_account_name: '收款人姓名',
  bank_account_phone: '收款人手机号',
  bank_name: '开户行',
  bank_account_number: '银行卡号',
}

export function normalizeEmployeeProfileInput(input: unknown): {
  data: NormalizedEmployeeProfileInput | null
  error: string | null
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { data: null, error: '员工信息格式不正确' }
  }

  const source = input as Record<string, unknown>
  const normalized = {} as NormalizedEmployeeProfileInput
  for (const field of PROFILE_FIELDS) {
    const value = source[field]
    if (value === undefined || value === null || value === '') {
      normalized[field] = null
      continue
    }
    if (typeof value !== 'string') {
      return { data: null, error: `${REQUIRED_FIELD_LABELS[field]}格式不正确` }
    }
    normalized[field] = value.trim() || null
  }

  if (normalized.id_number) normalized.id_number = normalized.id_number.toUpperCase()
  return { data: normalized, error: null }
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isValidChineseIdNumber(value: string): boolean {
  if (!/^\d{17}[\dX]$/.test(value)) return false
  const birthDate = `${value.slice(6, 10)}-${value.slice(10, 12)}-${value.slice(12, 14)}`
  if (!isValidDate(birthDate)) return false

  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = value.slice(0, 17).split('').reduce((total, digit, index) => (
    total + Number(digit) * weights[index]
  ), 0)
  return checkCodes[sum % 11] === value[17]
}

export function validateEmployeeProfile(
  data: NormalizedEmployeeProfileInput,
  requireAll: boolean,
): string | null {
  if (requireAll) {
    const missing = PROFILE_FIELDS
      .filter(field => field !== 'hire_date' && !data[field])
      .map(field => REQUIRED_FIELD_LABELS[field])
    if (missing.length > 0) return `请填写完整的员工信息：${missing.join('、')}`
  }

  const maxLengths: Partial<Record<EmployeeProfileField, number>> = {
    name: 100,
    id_number: 18,
    mobile: 20,
    email: 255,
    emergency_phone: 20,
    address: 500,
    bank_account_number: 30,
  }
  for (const field of PROFILE_FIELDS) {
    const value = data[field]
    if (value && value.length > (maxLengths[field] || 255)) {
      return `${REQUIRED_FIELD_LABELS[field]}内容过长`
    }
  }

  if (data.gender && !['male', 'female', 'other'].includes(data.gender)) return '性别取值无效'
  if (data.marital_status && !['single', 'married', 'divorced', 'widowed'].includes(data.marital_status)) {
    return '婚姻状况取值无效'
  }
  if (data.birth_date) {
    if (!isValidDate(data.birth_date)) return '出生日期无效'
    if (data.birth_date > formatLocalDate()) return '出生日期不能晚于今天'
  }
  if (data.hire_date && !isValidDate(data.hire_date)) return '入职日期无效'
  if (data.id_number) {
    if (!isValidChineseIdNumber(data.id_number)) return '身份证号格式或校验位不正确'
  }
  if (data.mobile && !/^1[3-9]\d{9}$/.test(data.mobile)) return '手机号码格式不正确'
  if (data.emergency_phone && !/^1[3-9]\d{9}$/.test(data.emergency_phone)) return '紧急联系人电话格式不正确'
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return '电子邮箱格式不正确'
  if (data.bank_account_phone && !/^1[3-9]\d{9}$/.test(data.bank_account_phone)) return '收款人手机号格式不正确'
  if (data.bank_account_number && !/^\d{16,19}$/.test(data.bank_account_number)) {
    return '银行卡号格式不正确（16至19位数字）'
  }
  if (data.name && data.emergency_contact === data.name) return '紧急联系人不可与本人一致'
  if (data.mobile && data.emergency_phone === data.mobile) return '紧急联系人电话不可与本人一致'

  return null
}
