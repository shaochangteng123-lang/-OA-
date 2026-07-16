import {
  isValidEmployeeNumber,
  normalizeEmployeeNumber,
} from '../server/utils/employee-number'

describe('员工编号', () => {
  it('统一转为大写并移除空白', () => {
    expect(normalizeEmployeeNumber('  yuli- cs027  ')).toBe('YULI-CS027')
  })

  it.each([
    'YULI-CS001',
    'YULI-CS999',
    'YULI-CS1000',
    'YULI-CS999999',
  ])('接受有效编号 %s', (employeeNo) => {
    expect(isValidEmployeeNumber(employeeNo)).toBe(true)
  })

  it.each([
    '',
    'CS001',
    'YULI-CS01',
    'YULI-CS0000000',
    'YULI-CSABC',
  ])('拒绝无效编号 %s', (employeeNo) => {
    expect(isValidEmployeeNumber(employeeNo)).toBe(false)
  })
})
