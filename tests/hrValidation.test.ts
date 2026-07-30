import { addCalendarMonthsClamped, formatLocalDate } from '../server/utils/date'
import {
  normalizeEmployeeProfileInput,
  validateEmployeeProfile,
} from '../server/utils/employee-profile-validation'
import { parsePagination } from '../server/utils/pagination'

const validProfile = {
  name: '测试员工',
  gender: 'male',
  birth_date: '1949-12-31',
  id_number: '11010519491231002X',
  native_place: '北京',
  ethnicity: '汉族',
  marital_status: 'single',
  education: '本科',
  school: '测试大学',
  major: '工程管理',
  mobile: '13800138000',
  email: 'employee@example.com',
  emergency_contact: '紧急联系人',
  emergency_phone: '13900139000',
  address: '北京市测试地址',
  hire_date: '2026-01-31',
  bank_account_name: '测试员工',
  bank_account_phone: '13800138000',
  bank_name: '中国工商银行',
  bank_account_number: '6222021234567890123',
}

describe('人事日期边界', () => {
  it('月末增加月份时限制在目标月份最后一天', () => {
    expect(addCalendarMonthsClamped('2025-08-31', 6)).toBe('2026-02-28')
    expect(addCalendarMonthsClamped('2023-08-31', 6)).toBe('2024-02-29')
    expect(addCalendarMonthsClamped('2026-01-31', 6)).toBe('2026-07-31')
  })

  it('业务当天按服务器本地日期计算', () => {
    expect(formatLocalDate(new Date(2026, 6, 16, 0, 1))).toBe('2026-07-16')
  })
})

describe('入职资料服务端校验', () => {
  it('接受完整且格式正确的资料', () => {
    const normalized = normalizeEmployeeProfileInput(validProfile)
    expect(normalized.error).toBeNull()
    expect(validateEmployeeProfile(normalized.data!, true)).toBeNull()
  })

  it('劳动合同尚未上传时允许入职日期为空', () => {
    const normalized = normalizeEmployeeProfileInput({ ...validProfile, hire_date: null })
    expect(normalized.error).toBeNull()
    expect(validateEmployeeProfile(normalized.data!, true)).toBeNull()
  })

  it('允许出生日期与身份证日期不同，但拒绝紧急电话重复', () => {
    const differentBirthDate = normalizeEmployeeProfileInput({ ...validProfile, birth_date: '1950-01-01' })
    expect(validateEmployeeProfile(differentBirthDate.data!, true)).toBeNull()

    const samePhone = normalizeEmployeeProfileInput({ ...validProfile, emergency_phone: validProfile.mobile })
    expect(validateEmployeeProfile(samePhone.data!, true)).toBe('紧急联系人电话不可与本人一致')
  })

  it('草稿允许缺项，但拒绝错误格式', () => {
    const draft = normalizeEmployeeProfileInput({ name: '测试员工', mobile: '123' })
    expect(validateEmployeeProfile(draft.data!, false)).toBe('手机号码格式不正确')
  })
})

describe('人事列表分页边界', () => {
  it('修正非法页码并限制每页最大数量', () => {
    expect(parsePagination('-1', 'not-a-number')).toEqual({ page: 1, pageSize: 20, offset: 0 })
    expect(parsePagination('3', '1000')).toEqual({ page: 3, pageSize: 100, offset: 200 })
  })
})
