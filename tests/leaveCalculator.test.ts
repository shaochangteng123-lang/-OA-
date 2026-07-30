import { calculateAnnualLeaveDays, calculateAnnualLeaveEntitlement } from '../server/utils/leave'

describe('年假额度计算', () => {
  it('入职满一周年当天开始获得五天年假', () => {
    expect(calculateAnnualLeaveDays('2025-04-15', 2026, new Date(2026, 3, 14))).toBe(0)
    expect(calculateAnnualLeaveDays('2025-04-15', 2026, new Date(2026, 3, 15))).toBe(5)
  })

  it('按十年和二十年周年日切换额度', () => {
    const referenceDate = new Date(2026, 6, 17)
    expect(calculateAnnualLeaveDays('2016-07-18', 2026, referenceDate)).toBe(5)
    expect(calculateAnnualLeaveDays('2016-07-17', 2026, referenceDate)).toBe(10)
    expect(calculateAnnualLeaveDays('2006-07-17', 2026, referenceDate)).toBe(15)
  })

  it('闰日入职在非闰年的二月最后一天达到周年', () => {
    expect(calculateAnnualLeaveDays('2024-02-29', 2025, new Date(2025, 1, 27))).toBe(0)
    expect(calculateAnnualLeaveDays('2024-02-29', 2025, new Date(2025, 1, 28))).toBe(5)
  })

  it('无效入职日期不产生年假额度', () => {
    expect(calculateAnnualLeaveDays('2025-02-30', 2026, new Date(2026, 6, 17))).toBe(0)
    expect(calculateAnnualLeaveDays('无效日期', 2026, new Date(2026, 6, 17))).toBe(0)
  })

  it('所有员工至少获得年假配置的基础额度', () => {
    const referenceDate = new Date(2026, 6, 17)
    expect(calculateAnnualLeaveEntitlement(null, 2026, 5, referenceDate)).toBe(5)
    expect(calculateAnnualLeaveEntitlement('2026-07-01', 2026, 5, referenceDate)).toBe(5)
    expect(calculateAnnualLeaveEntitlement('无效日期', 2026, 5, referenceDate)).toBe(5)
    expect(calculateAnnualLeaveEntitlement('2016-07-17', 2026, 5, referenceDate)).toBe(10)
  })
})
