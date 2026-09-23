/** @jest-environment node */

const mockAll = jest.fn()
const mockRun = jest.fn()
const mockChat = jest.fn()
const mockIsLLMConfigured = jest.fn()

jest.mock('../server/db/index', () => ({
  db: {
    all: mockAll,
    run: mockRun,
  },
}))

jest.mock('../server/services/llm', () => ({
  chat: mockChat,
  isLLMConfigured: mockIsLLMConfigured,
}))

jest.mock('nanoid', () => ({ nanoid: jest.fn(() => '新周报') }))

import {
  generateWeeklySummariesForRange,
  getLastWorkdayOfWeekFor,
} from '../server/services/dailyLogScheduler'

describe('团队周报定时生成', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRun.mockResolvedValue({ changes: 1 })
    mockIsLLMConfigured.mockReturnValue(false)
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('上海时区下能把周日调休识别为本周最后工作日', async () => {
    mockAll.mockResolvedValue([
      { date: '2026-09-20', type: 'workday' },
      { date: '2026-09-19', type: 'holiday' },
    ])

    await expect(
      getLastWorkdayOfWeekFor(new Date('2026-09-16T04:00:00.000Z')),
    ).resolves.toBe('2026-09-20')
    expect(mockAll).toHaveBeenCalledWith(
      expect.stringContaining('FROM holidays'),
      '2026-09-14',
      '2026-09-20',
    )
  })

  it('合并正式日志和非空草稿，并按原自然周补齐缺失人员', async () => {
    mockAll.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM daily_log_submissions')) {
        return [
          {
            id: '提交一',
            user_id: '员工一',
            log_date: '2026-09-14',
            content: '周一工作',
            submitted_at: '2026-09-14T15:59:00.000Z',
          },
        ]
      }
      if (sql.includes('FROM daily_logs')) {
        return [
          {
            user_id: '员工二',
            log_date: '2026-09-20',
            content: '周日调休工作',
            updated_at: '2026-09-20T10:00:00.000Z',
          },
        ]
      }
      if (sql.includes('FROM daily_log_supplements')) return []
      if (sql.includes('FROM weekly_summaries')) {
        return [
          {
            id: '旧周报',
            user_id: '员工一',
            week_end: '2026-09-20',
            generated_at: '2026-09-14T12:00:00.000Z',
          },
        ]
      }
      throw new Error(`未覆盖的查询：${sql}`)
    })

    await expect(
      generateWeeklySummariesForRange('2026-09-14', '2026-09-20'),
    ).resolves.toBe(2)

    expect(mockRun).toHaveBeenCalledTimes(2)
    expect(mockRun.mock.calls[0][0]).toContain('UPDATE weekly_summaries')
    expect(mockRun.mock.calls[0][1]).toBe('2026-09-20')
    expect(mockRun.mock.calls[0][2]).toContain('周一工作')
    expect(mockRun.mock.calls[1][0]).toContain('INSERT INTO weekly_summaries')
    expect(mockRun.mock.calls[1]).toEqual(
      expect.arrayContaining(['员工二', '2026-09-14', '2026-09-20']),
    )
    expect(mockRun.mock.calls[1][5]).toContain('周日调休工作')
  })

  it('摘要已覆盖最新日志时保持幂等，不重复调用生成服务', async () => {
    mockAll.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM daily_log_submissions')) {
        return [
          {
            id: '提交一',
            user_id: '员工一',
            log_date: '2026-09-18',
            content: '已覆盖内容',
            submitted_at: '2026-09-18T15:59:00.000Z',
          },
        ]
      }
      if (sql.includes('FROM daily_logs') || sql.includes('FROM daily_log_supplements')) return []
      if (sql.includes('FROM weekly_summaries')) {
        return [
          {
            id: '现有周报',
            user_id: '员工一',
            week_end: '2026-09-20',
            generated_at: '2026-09-20T16:10:00.000Z',
          },
        ]
      }
      throw new Error(`未覆盖的查询：${sql}`)
    })

    await expect(
      generateWeeklySummariesForRange('2026-09-14', '2026-09-20'),
    ).resolves.toBe(0)
    expect(mockRun).not.toHaveBeenCalled()
    expect(mockChat).not.toHaveBeenCalled()
  })
})
