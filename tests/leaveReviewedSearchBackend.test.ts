/** @jest-environment node */

const mockPrepare = jest.fn()
const mockGet = jest.fn()
const mockAll = jest.fn()

jest.mock('../server/db/index', () => ({ db: { prepare: mockPrepare } }))
jest.mock('nanoid', () => ({ nanoid: jest.fn() }))
jest.mock('../server/services/leaveSchedule', () => ({
  enrichLeaveRequestsWithSchedule: jest.fn(async (rows: unknown[]) => rows),
}))

import type { Request, Response } from 'express'
import router from '../server/routes/leave'

const MemoryDatabase = require('better-sqlite3')

async function readReviewed(
  query: Record<string, unknown>,
  userId = 'manager',
  role = 'general_manager',
) {
  const route = router.stack.find(item => item.route?.path === '/reviewed')
  const handler = route?.route.stack.at(-1)?.handle
  if (!handler) throw new Error('审批记录路由不存在')
  const req = {
    session: { userId, user: { id: userId, role } },
    query,
  } as unknown as Request
  const res = { status: jest.fn(), json: jest.fn() }
  res.status.mockReturnValue(res)
  await handler(req, res as unknown as Response, jest.fn())
  return res
}

describe('请假审批记录关键词搜索', () => {
  let database: InstanceType<typeof MemoryDatabase>

  beforeEach(() => {
    jest.clearAllMocks()
    database = new MemoryDatabase(':memory:')
    database.function('STRPOS', (value: string, keyword: string) => value.indexOf(keyword) + 1)
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, name TEXT, department TEXT, role TEXT, status TEXT
      );
      CREATE TABLE leave_requests (
        id TEXT PRIMARY KEY, user_id TEXT, applicant_name TEXT, applicant_department TEXT,
        reason TEXT, request_no TEXT, leave_type_name TEXT, status TEXT,
        approver_id TEXT, original_id TEXT
      );
      CREATE TABLE leave_approval_logs (
        id TEXT PRIMARY KEY, leave_request_id TEXT, operator_id TEXT, action TEXT
      );
      INSERT INTO users VALUES
        ('employee', '当前姓名', '当前部门', 'user', 'active'),
        ('manager', '总经理甲', '管理层', 'general_manager', 'active'),
        ('other-manager', '总经理乙', '管理层', 'general_manager', 'active'),
        ('delegate', '超级管理员', NULL, 'super_admin', 'active');
    `)
    const insertRequest = database.prepare('INSERT INTO leave_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const insertLog = database.prepare('INSERT INTO leave_approval_logs VALUES (?, ?, ?, ?)')
    const fixtures = [
      ['real', 'approved', 'manager', 'manager', 'approve', null],
      ['import', 'approved', 'manager', 'uploader', 'historical_import', null],
      ['other-import', 'approved', 'other-manager', 'uploader', 'historical_import', null],
      ['previous-approver', 'approved', 'other-manager', 'manager', 'approve', null],
      ['reject', 'rejected', 'manager', 'manager', 'reject', null],
      ['other-review', 'approved', 'manager', 'delegate', 'approve', null],
      ['old', 'approved', 'manager', 'manager', 'approve', null],
      ['latest-pending', 'pending', 'manager', 'manager', 'approve', 'old'],
      ['removed-user', 'approved', 'manager', 'uploader', 'historical_import', null],
    ]
    for (const [id, status, approver, operator, action, originalId] of fixtures) {
      insertRequest.run(
        id, id === 'real' ? 'employee' : 'missing-user',
        id === 'real' ? '快照姓名' : '导入员工', id === 'real' ? '快照部门' : null,
        id === 'real' ? '共同搜索 50%_原因' : '共同搜索',
        id === 'real' ? 'QJ-2026-001' : id, id === 'real' ? '年假' : '病假',
        status, approver, originalId,
      )
      insertLog.run(`${id}-log`, id, operator, action)
    }
    mockAll.mockResolvedValue([])
    mockPrepare.mockImplementation((sql: string) => ({
      // 直接执行计数查询验证搜索与审批范围；分页侧仅检查条件和绑定参数。
      get: (...params: unknown[]) => {
        mockGet(...params)
        return Promise.resolve(database.prepare(sql).get(...params))
      },
      all: mockAll,
    }))
  })

  afterEach(() => database.close())

  it.each(['快照姓名', '当前姓名', '快照部门', '当前部门', '50%_', 'qj-2026-001', '年假'])(
    '在全部可见记录中按“%s”检索，计数与分页共用参数和条件',
    async keyword => {
      const res = await readReviewed({ keyword: `  ${keyword}  `, page: '2', pageSize: '1' })
      expect(res.status).not.toHaveBeenCalled()
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { list: [], total: 1, page: 2, pageSize: 1 },
      })
      expect(mockAll).toHaveBeenCalledWith(...mockGet.mock.calls[0], 1, 1)
      const [countSql, listSql] = mockPrepare.mock.calls.map(([sql]) => sql as string)
      expect(countSql).not.toContain(keyword)
      const filterStart = "lr.status IN ('approved', 'rejected')"
      const countFilter = countSql.slice(countSql.lastIndexOf(filterStart)).trim()
      expect(listSql).toContain(countFilter)
      expect(listSql).toContain('ORDER BY lal.created_at DESC, lr.id DESC')
      expect(listSql).toContain('lal.created_at DESC, lal.id DESC')
    },
  )

  it('总经理看到本人真实审批、本人历史导入、超级管理员代审及最终版本', async () => {
    const res = await readReviewed({ keyword: '共同搜索', page: '99', pageSize: '2' })
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { list: [], total: 6, page: 99, pageSize: 2 },
    })
    expect(mockGet.mock.calls[0].slice(0, 3)).toEqual([
      'manager',
      'manager',
      'manager',
    ])
    expect(mockAll).toHaveBeenCalledWith(...mockGet.mock.calls[0], 2, 196)
  })

  it('超级管理员看到全部活动总经理职责范围历史与系统导入记录', async () => {
    const res = await readReviewed(
      { keyword: '共同搜索', page: '1', pageSize: '20' },
      'delegate',
      'super_admin',
    )
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { list: [], total: 7, page: 1, pageSize: 20 },
    })
    expect(mockGet.mock.calls[0][0]).toBe('delegate')
    const [countSql, listSql] = mockPrepare.mock.calls.map(([sql]) => sql as string)
    expect(countSql).toContain("assigned_manager.role = 'general_manager'")
    expect(countSql).toContain("assigned_manager.status = 'active'")
    expect(countSql).toContain("lal.action = 'historical_import'")
    expect(listSql).toContain("manager_applicant.role = 'general_manager'")
  })

  it('空白关键词取消筛选，百分号与下划线按字面搜索，输入不插入查询文本', async () => {
    const empty = await readReviewed({ keyword: '   ' })
    expect(empty.json.mock.calls[0][0].data.total).toBe(6)
    expect(mockGet).toHaveBeenCalledWith('manager', 'manager', 'manager')
    const literal = await readReviewed({ keyword: '%_' })
    expect(literal.json.mock.calls[0][0].data.total).toBe(1)
    const injection = await readReviewed({ keyword: "' OR 1=1 --" })
    expect(injection.json.mock.calls[0][0].data.total).toBe(0)
    expect(mockPrepare.mock.calls.at(-1)?.[0]).not.toContain("' OR 1=1 --")
  })

  it('超过 200 字符的关键词返回中文错误且不执行查询', async () => {
    const res = await readReviewed({ keyword: '字'.repeat(201) })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ success: false, message: '搜索关键词不能超过 200 个字符' })
    expect(mockPrepare).not.toHaveBeenCalled()
  })
})
