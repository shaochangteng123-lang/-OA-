import {
  formatEmployeeNumber,
  getEmployeeNumberSequence,
  getNextEmployeeNumber,
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

  it('提取员工编号中的数字序号', () => {
    expect(getEmployeeNumberSequence('YULI-CS027')).toBe(27)
    expect(getEmployeeNumberSequence('无效编号')).toBeNull()
  })

  it('格式化数字序号为员工编号', () => {
    expect(formatEmployeeNumber(1)).toBe('YULI-CS001')
    expect(formatEmployeeNumber(28)).toBe('YULI-CS028')
    expect(formatEmployeeNumber(1000)).toBe('YULI-CS1000')
  })

  it('根据已有员工编号生成下一号', () => {
    expect(getNextEmployeeNumber([])).toBe('YULI-CS001')
    expect(getNextEmployeeNumber(['YULI-CS001', 'YULI-CS027'])).toBe('YULI-CS028')
    expect(getNextEmployeeNumber(['YULI-CS999', 'YULI-CS010', '历史编号'])).toBe('YULI-CS1000')
    expect(getNextEmployeeNumber(['YULI-CS000999'])).toBe('YULI-CS001000')
  })

  it('超过员工编号上限时阻止继续生成', () => {
    expect(() => getNextEmployeeNumber(['YULI-CS999999'])).toThrow(
      '员工编号已到最大值，无法继续自动生成',
    )
  })
})
