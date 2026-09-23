/** @jest-environment node */

const mockAll = jest.fn()

jest.mock('../server/db/index', () => ({
  db: {
    all: mockAll,
    get: jest.fn(),
    run: jest.fn(),
    prepare: jest.fn(),
  },
}))

jest.mock('../server/services/llm', () => ({
  chat: jest.fn(),
  isLLMConfigured: jest.fn(() => false),
}))

jest.mock('nanoid', () => ({ nanoid: jest.fn(() => '测试编号') }))

import type { Request, Response } from 'express'
import router from '../server/routes/daily-logs'

function response() {
  const res = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  return res
}

function teamHandler() {
  const layer = router.stack.find(item => item.route?.path === '/team' && item.route.methods.get)
  if (!layer?.route) throw new Error('未找到团队日志路由')
  return layer.route.stack[layer.route.stack.length - 1].handle
}

describe('团队日志实时填写状态', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockAll.mockImplementation(async (sql: string) => {
      if (sql.includes('LEFT JOIN employee_profiles')) {
        return [
          { id: '员工一', name: '员工一', position: '职位一', role: 'user' },
          { id: '员工二', name: '员工二', position: '职位二', role: 'user' },
        ]
      }
      if (sql.includes('FROM holidays')) return []
      if (sql.includes(') written_logs')) {
        return [
          { user_id: '员工一', log_date: '2026-08-31' },
          { user_id: '员工二', log_date: '2026-09-01' },
        ]
      }
      if (sql.includes('FROM daily_log_comments')) return []
      if (sql.includes('WITH candidates AS')) {
        return [
          {
            id: '草稿一',
            user_id: '员工一',
            content: '<p>当天已写内容</p>',
            updated_at: '2026-08-31T03:00:00.000Z',
            state: 'written',
            user_name: '员工一',
            user_position: '职位一',
          },
        ]
      }
      if (sql.includes('SELECT id, user_id FROM daily_logs')) {
        return [{ id: '草稿一', user_id: '员工一' }]
      }
      if (sql.includes('FROM daily_log_attachments')) return []
      throw new Error(`未覆盖的查询：${sql}`)
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('把非空草稿计入已填写，并返回跨月完整周', async () => {
    const req = {
      session: { userId: '管理员' },
      query: { date: '2026-08-31', month: '2026-08' },
    } as unknown as Request
    const res = response()

    await teamHandler()(req, res as unknown as Response, jest.fn())

    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledTimes(1)
    const payload = res.json.mock.calls[0][0]
    expect(payload.success).toBe(true)
    expect(payload.data.monthEnd).toBe('2026-08-31')
    expect(payload.data.monthDays).toHaveLength(31)
    expect(payload.data.weekDays.map((day: { date: string }) => day.date)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ])
    expect(payload.data.weekDays[1].submitted).toBe(1)
    expect(payload.data.submissions).toEqual([
      expect.objectContaining({
        id: '草稿一',
        userId: '员工一',
        state: 'written',
        submittedAt: '2026-08-31T03:00:00.000Z',
      }),
    ])
    expect(payload.data.notSubmitted).toEqual([
      { id: '员工二', name: '员工二', position: '职位二' },
    ])
    expect(payload.data.totalUsers).toBe(2)
  })
})
