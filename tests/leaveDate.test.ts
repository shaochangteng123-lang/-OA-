import { validateLeavePeriod } from '../server/utils/leave'
import {
  formatLocalDateValue,
  isLeaveEndDateDisabled,
  isPastLeaveDateDisabled,
} from '../src/utils/leaveDate'

describe('请假日期边界', () => {
  const today = new Date(2026, 6, 17, 12)

  it('前端禁用今天以前的开始日期，但允许今天', () => {
    expect(isPastLeaveDateDisabled(new Date(2026, 6, 16), today)).toBe(true)
    expect(isPastLeaveDateDisabled(new Date(2026, 6, 17), today)).toBe(false)
  })

  it('结束日期不得早于今天或已选开始日期', () => {
    expect(isLeaveEndDateDisabled(new Date(2026, 6, 18), '2026-07-19', today)).toBe(true)
    expect(isLeaveEndDateDisabled(new Date(2026, 6, 19), '2026-07-19', today)).toBe(false)
    expect(isLeaveEndDateDisabled(new Date(2026, 6, 16), '', today)).toBe(true)
  })

  it('后端拒绝历史开始日期并允许从今天开始', () => {
    expect(validateLeavePeriod('2026-07-16', 'morning', '2026-07-17', 'afternoon', '2026-07-17')).toBe(
      '开始日期不能早于今天'
    )
    expect(validateLeavePeriod('2026-07-17', 'morning', '2026-07-17', 'afternoon', '2026-07-17')).toBeNull()
  })

  it('本地日期格式不受时分秒影响', () => {
    expect(formatLocalDateValue(today)).toBe('2026-07-17')
  })
})
