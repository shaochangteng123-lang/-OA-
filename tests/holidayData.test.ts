import { mergeHolidaysWithFallback } from '../src/utils/holidayData'

describe('节假日备用数据合并', () => {
  it('接口为空时仍保留法定节假日和补班日', () => {
    const holidays = mergeHolidaysWithFallback([])

    expect(holidays).toEqual(
      expect.arrayContaining([
        {
          date: '2026-10-01',
          name: '国庆节',
          type: 'holiday',
        },
        {
          date: '2026-10-10',
          name: '国庆节补班',
          type: 'workday',
        },
      ])
    )
  })

  it('接口记录优先于同日期的备用记录，并保留其他年份数据', () => {
    const holidays = mergeHolidaysWithFallback([
      {
        date: '2026-10-01',
        name: '国庆假期',
        type: 'holiday',
      },
      {
        date: '2027-01-01',
        name: '元旦',
        type: 'holiday',
      },
    ])

    expect(holidays.find((holiday) => holiday.date === '2026-10-01')).toEqual({
      date: '2026-10-01',
      name: '国庆假期',
      type: 'holiday',
    })
    expect(holidays.at(-1)?.date).toBe('2027-01-01')
  })
})
