const mockDbAll = jest.fn()
const mockDbTransaction = jest.fn()
const mockClientQuery = jest.fn()

jest.mock('../server/db/index', () => ({
  db: {
    all: (...args: unknown[]) => mockDbAll(...args),
    transaction: (...args: unknown[]) => mockDbTransaction(...args),
  },
}))

import {
  assessHolidayDataCompleteness,
  parseHolidayNotice,
  refreshHolidaysForYear,
  type HolidayInfo,
} from '../server/services/holidayUpdater'

const notice2026 = `
  <h1>国务院办公厅关于2026年部分节假日安排的通知</h1>
  <p>一、元旦：1月1日（周四）至3日（周六）放假调休，共3天。1月4日（周日）上班。</p>
  <p>二、春节：2月15日（农历腊月二十八、周日）至23日（农历正月初七、周一）放假调休，共9天。2月14日（周六）、2月28日（周六）上班。</p>
  <p>三、清明节：4月4日（周六）至6日（周一）放假，共3天。</p>
  <p>四、劳动节：5月1日（周五）至5日（周二）放假调休，共5天。5月9日（周六）上班。</p>
  <p>五、端午节：6月19日（周五）至21日（周日）放假，共3天。</p>
  <p>六、中秋节：9月25日（周五）至27日（周日）放假，共3天。</p>
  <p>七、国庆节：10月1日（周四）至7日（周三）放假调休，共7天。9月20日（周日）、10月10日（周六）上班。</p>
`

describe('节假日通知解析', () => {
  it('应解析通知中跨多个节日段落的全部调休工作日', () => {
    const holidays = parseHolidayNotice(notice2026, 2026)
    const workdays = holidays.filter((holiday) => holiday.type === 'workday').map((holiday) => holiday.date)

    expect(workdays).toEqual(['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'])
    expect(holidays.find((holiday) => holiday.date === '2026-09-20')).toEqual({
      date: '2026-09-20',
      name: '国庆节补班',
      type: 'workday',
    })
  })

  it('应支持同一月份后续日期省略月份的写法', () => {
    const holidays = parseHolidayNotice('春节：2月15日至23日放假调休，共9天。2月14日、28日上班。', 2026)

    expect(holidays.filter((holiday) => holiday.type === 'workday')).toEqual([
      { date: '2026-02-14', name: '春节补班', type: 'workday' },
      { date: '2026-02-28', name: '春节补班', type: 'workday' },
    ])
  })
})

describe('年度节假日完整性判断', () => {
  const expected = parseHolidayNotice(notice2026, 2026)

  it('年度已有部分数据时仍应找出缺失的补班日期', () => {
    const existing = expected.filter((holiday) => holiday.date !== '2026-02-28')

    expect(assessHolidayDataCompleteness(existing, expected)).toEqual({
      complete: false,
      missing: [{ date: '2026-02-28', name: '春节补班', type: 'workday' }],
    })
  })

  it('同日期的管理员更正应视为已存在并予以保留', () => {
    const existing = expected.map((holiday) =>
      holiday.date === '2026-02-14' ? { ...holiday, name: '管理员更正', type: 'holiday' as const } : holiday,
    )

    expect(assessHolidayDataCompleteness(existing, expected)).toEqual({
      complete: true,
      missing: [],
    })
  })
})

describe('年度节假日自动修复', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => notice2026,
    }) as jest.Mock
    mockClientQuery.mockResolvedValue({ rowCount: 1 })
    mockDbTransaction.mockImplementation(async (handler) => handler({ query: mockClientQuery }))
  })

  afterAll(() => {
    global.fetch = originalFetch
  })

  it('自动任务只补齐缺失日期且冲突时不覆盖原记录', async () => {
    const expected = parseHolidayNotice(notice2026, 2026)
    const existing: HolidayInfo[] = expected
      .filter((holiday) => holiday.date !== '2026-02-28')
      .map((holiday) => (holiday.date === '2026-02-14' ? { ...holiday, name: '管理员更正', type: 'holiday' } : holiday))
    mockDbAll.mockResolvedValue(existing)

    const result = await refreshHolidaysForYear(2026, {
      sourceUrl: 'https://www.gov.cn/2026-holiday.html',
    })

    expect(result).toMatchObject({ updated: true, skipped: false, count: 1 })
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockClientQuery.mock.calls[0]
    expect(sql).toContain('ON CONFLICT(date) DO NOTHING')
    expect(sql).not.toContain('DO UPDATE SET')
    expect(params).toContain('2026-02-28')
    expect(params).not.toContain('2026-02-14')
  })

  it('通知中的日期均已存在时应跳过写入', async () => {
    mockDbAll.mockResolvedValue(parseHolidayNotice(notice2026, 2026))

    const result = await refreshHolidaysForYear(2026, {
      sourceUrl: 'https://www.gov.cn/2026-holiday.html',
    })

    expect(result).toMatchObject({ updated: false, skipped: true })
    expect(mockDbTransaction).not.toHaveBeenCalled()
  })
})
