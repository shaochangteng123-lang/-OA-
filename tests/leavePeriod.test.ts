import {
  findLeavePeriodByDays,
  findNextLeaveHalfSlot,
  listLeaveHalfSlots,
  splitLeaveHalfSlots,
} from '../server/utils/leave-period'

describe('请假工作时段拆分', () => {
  it('排除法定节假日并把周末补班计入工作时段', () => {
    const slots = listLeaveHalfSlots(
      '2026-10-01',
      'morning',
      '2026-10-05',
      'afternoon',
      [
        { date: '2026-10-01', type: 'holiday' },
        { date: '2026-10-02', type: 'holiday' },
        { date: '2026-10-04', type: 'workday' },
      ]
    )

    expect(slots).toEqual([
      { date: '2026-10-04', half: 'morning' },
      { date: '2026-10-04', half: 'afternoon' },
      { date: '2026-10-05', half: 'morning' },
      { date: '2026-10-05', half: 'afternoon' },
    ])
  })

  it('组合假期按半天边界顺序拆成互不重叠的区间', () => {
    const slots = listLeaveHalfSlots(
      '2026-07-31',
      'morning',
      '2026-08-04',
      'afternoon'
    )
    const periods = splitLeaveHalfSlots(slots, [1.5, 1.5])

    expect(periods).toEqual([
      {
        startDate: '2026-07-31',
        startHalf: 'morning',
        endDate: '2026-08-03',
        endHalf: 'morning',
        days: 1.5,
      },
      {
        startDate: '2026-08-03',
        startHalf: 'afternoon',
        endDate: '2026-08-04',
        endHalf: 'afternoon',
        days: 1.5,
      },
    ])
  })

  it('一键请满从首个可用工作半天开始计算', () => {
    const period = findLeavePeriodByDays(
      '2026-10-01',
      'morning',
      2,
      '2026-10-10',
      [
        { date: '2026-10-01', type: 'holiday' },
        { date: '2026-10-02', type: 'holiday' },
        { date: '2026-10-04', type: 'workday' },
      ]
    )

    expect(period).toEqual({
      startDate: '2026-10-04',
      startHalf: 'morning',
      endDate: '2026-10-05',
      endHalf: 'afternoon',
      days: 2,
    })
  })

  it('组合分配总天数可直接反算结束时间', () => {
    const period = findLeavePeriodByDays(
      '2026-07-31',
      'morning',
      8,
      '2026-12-31'
    )

    expect(period).toEqual({
      startDate: '2026-07-31',
      startHalf: 'morning',
      endDate: '2026-08-11',
      endHalf: 'afternoon',
      days: 8,
    })
  })

  it('续假开始时间会跳过周末', () => {
    const nextSlot = findNextLeaveHalfSlot(
      '2026-07-31',
      'afternoon',
      '2026-08-10'
    )

    expect(nextSlot).toEqual({ date: '2026-08-03', half: 'morning' })
  })

  it('组合分配天数与所选时段不一致时拒绝拆分', () => {
    const slots = listLeaveHalfSlots(
      '2026-08-03',
      'morning',
      '2026-08-04',
      'afternoon'
    )

    expect(() => splitLeaveHalfSlots(slots, [1, 0.5])).toThrow(
      '组合假期已分配 1.5 天，与所选时段 2 天不一致'
    )
  })
})
