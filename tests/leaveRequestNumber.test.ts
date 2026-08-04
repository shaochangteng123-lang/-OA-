import {
  getLeaveRequestNoPattern,
  getNextLeaveRequestNo,
} from '../server/utils/leave-request-number'

describe('请假申请编号', () => {
  it('使用 QJ 前缀生成年度首个编号', () => {
    expect(getLeaveRequestNoPattern(2026)).toBe('QJ-2026-%')
    expect(getNextLeaveRequestNo(2026)).toBe('QJ-2026-00001')
  })

  it('在当前年度最大编号后连续递增', () => {
    expect(getNextLeaveRequestNo(2026, 'QJ-2026-00009')).toBe(
      'QJ-2026-00010',
    )
  })

  it('忽略其他年份或旧格式编号', () => {
    expect(getNextLeaveRequestNo(2026, 'QJ-2025-00009')).toBe(
      'QJ-2026-00001',
    )
    expect(getNextLeaveRequestNo(2026, 'LR-2026-00009')).toBe(
      'QJ-2026-00001',
    )
  })
})
