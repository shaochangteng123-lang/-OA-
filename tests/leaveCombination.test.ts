import { getAutomaticCombinedLeaveDays } from '../src/utils/leaveCombination'

describe('组合假期自动分配', () => {
  it('固定额度类型直接取完整可用余额', () => {
    expect(getAutomaticCombinedLeaveDays({
      requiresBalanceCheck: true,
      availableDays: 5,
      currentDays: 0.5,
    })).toBe(5)
  })

  it('每种固定额度独立取满，不为其他类型预留天数', () => {
    const annualDays = getAutomaticCombinedLeaveDays({
      requiresBalanceCheck: true,
      availableDays: 5,
    })
    const personalDays = getAutomaticCombinedLeaveDays({
      requiresBalanceCheck: true,
      availableDays: 3,
    })

    expect(annualDays + personalDays).toBe(8)
  })

  it('不限额度类型保留员工填写的天数', () => {
    expect(getAutomaticCombinedLeaveDays({
      requiresBalanceCheck: false,
      availableDays: 0,
      currentDays: 2.5,
    })).toBe(2.5)
  })

  it('不限额度类型未填写有效天数时保持未分配', () => {
    expect(getAutomaticCombinedLeaveDays({
      requiresBalanceCheck: false,
      availableDays: 0,
      currentDays: 0,
    })).toBe(0)
  })

  it('固定额度为零时返回零并阻止选择', () => {
    expect(getAutomaticCombinedLeaveDays({
      requiresBalanceCheck: true,
      availableDays: 0,
    })).toBe(0)
  })
})
