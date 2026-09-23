import {
  addDateOnlyDays,
  getBusinessDate,
  getDateOnlyDayOfWeek,
  getMonthRangeFromMonth,
  getWeekRangeFromDate,
  toBusinessDateTime,
} from '../server/utils/business-date'

describe('上海业务日期工具', () => {
  it('按上海时区识别世界标准时间的跨日边界', () => {
    expect(getBusinessDate(new Date('2026-09-20T15:59:59.999Z'))).toBe('2026-09-20')
    expect(getBusinessDate(new Date('2026-09-20T16:00:00.000Z'))).toBe('2026-09-21')
  })

  it('拒绝无效时刻', () => {
    expect(() => getBusinessDate(new Date(Number.NaN))).toThrow('时间不是有效值')
  })

  it('按自然日跨越月份、年份和闰日', () => {
    expect(addDateOnlyDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDateOnlyDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDateOnlyDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDateOnlyDays('2024-02-29', 1)).toBe('2024-03-01')
  })

  it('要求自然日增量为整数', () => {
    expect(() => addDateOnlyDays('2026-09-21', 1.5)).toThrow('日期增量必须是整数')
    expect(() => addDateOnlyDays('2026-09-21', Number.MAX_VALUE)).toThrow('日期增量必须是整数')
  })

  it('使用星期日为零的星期序号', () => {
    expect(getDateOnlyDayOfWeek('2026-09-20')).toBe(0)
    expect(getDateOnlyDayOfWeek('2026-09-21')).toBe(1)
    expect(getDateOnlyDayOfWeek('2026-09-26')).toBe(6)
  })

  it('始终返回周一到周日的完整自然周', () => {
    expect(getWeekRangeFromDate('2026-09-20')).toEqual({
      weekStart: '2026-09-14',
      weekEnd: '2026-09-20',
    })
    expect(getWeekRangeFromDate('2026-09-21')).toEqual({
      weekStart: '2026-09-21',
      weekEnd: '2026-09-27',
    })
  })

  it('返回平年、闰年及年末月份的完整范围', () => {
    expect(getMonthRangeFromMonth('2026-02')).toEqual({
      monthStart: '2026-02-01',
      monthEnd: '2026-02-28',
      daysInMonth: 28,
    })
    expect(getMonthRangeFromMonth('2024-02')).toEqual({
      monthStart: '2024-02-01',
      monthEnd: '2024-02-29',
      daysInMonth: 29,
    })
    expect(getMonthRangeFromMonth('2026-12')).toEqual({
      monthStart: '2026-12-01',
      monthEnd: '2026-12-31',
      daysInMonth: 31,
    })
  })

  it('把三种完整时间格式转换为固定东八区时刻', () => {
    expect(toBusinessDateTime('2026-09-21', '20:00').toISOString()).toBe(
      '2026-09-21T12:00:00.000Z',
    )
    expect(toBusinessDateTime('2026-09-21', '23:59:00').toISOString()).toBe(
      '2026-09-21T15:59:00.000Z',
    )
    expect(toBusinessDateTime('2026-09-21', '23:59:59.999').toISOString()).toBe(
      '2026-09-21T15:59:59.999Z',
    )
  })

  it.each([
    '2026-9-01',
    '2026-09-1',
    '2026/09/01',
    '2026-02-29',
    '2024-02-30',
    '2026-04-31',
    '0000-01-01',
  ])('拒绝无效或不完整的日期：%s', dateText => {
    expect(() => addDateOnlyDays(dateText, 0)).toThrow()
  })

  it.each(['2026-9', '2026-00', '2026-13', '0000-01'])('拒绝无效或不完整的月份：%s', monthText => {
    expect(() => getMonthRangeFromMonth(monthText)).toThrow()
  })

  it.each(['1:00', '24:00', '20:60', '20:00:60', '20:00:00.1', '20:00:00.0000'])(
    '拒绝无效或不完整的时间：%s',
    timeText => {
      expect(() => toBusinessDateTime('2026-09-21', timeText)).toThrow()
    },
  )
})
