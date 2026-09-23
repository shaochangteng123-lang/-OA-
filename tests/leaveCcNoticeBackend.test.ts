/** @jest-environment node */

const mockPrepare = jest.fn()
const mockTransaction = jest.fn()
let mockRevision = 0

jest.mock('../server/db/index', () => ({
  db: { prepare: mockPrepare, transaction: mockTransaction },
}))
jest.mock('nanoid', () => ({ nanoid: jest.fn(() => `提醒版本-${++mockRevision}`) }))
jest.mock('../server/services/leaveSchedule', () => ({
  enrichLeaveRequestsWithSchedule: jest.fn(async (rows: unknown[]) => rows),
}))

import fs from 'fs'
import path from 'path'
import type { Request, Response } from 'express'
import type { PoolClient } from 'pg'
import router from '../server/routes/leave'
import {
  getLeaveCcNotices,
  getUnreadLeaveCcCount,
  isLeaveCcRecipientRole,
  markLeaveCcNoticeRead,
  notifyLeaveCcRecipients,
} from '../server/services/leaveCcNotice'

const MemoryDatabase = require('better-sqlite3')

function response() {
  const res = { status: jest.fn(), json: jest.fn(), clearCookie: jest.fn() }
  res.status.mockReturnValue(res)
  return res
}

function routeLayer(method: 'get' | 'post', routePath: string) {
  const layer = router.stack.find(item => item.route?.path === routePath && item.route.methods[method])
  if (!layer) throw new Error(`未找到请假路由：${routePath}`)
  return layer.route
}

function request(userId = 'admin-1', overrides: Record<string, unknown> = {}) {
  return {
    session: { userId, isLoggedIn: true, user: { id: userId, name: '管理员甲', role: 'admin' } },
    params: { id: 'leave-1' },
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request
}

describe('请假抄送逐人未读提醒', () => {
  let database: InstanceType<typeof MemoryDatabase>
  let client: PoolClient

  // 内存数据库执行实际查询，仅适配 PostgreSQL（关系型数据库）的参数和数组语法。
  function execute(sql: string, params: unknown[], method: 'get' | 'all' | 'run') {
    const bindings: unknown[] = []
    let questionIndex = 0
    const adapted = sql.replace(/\$(\d+)|\?(::text\[\])?/g, (_match, position, arrayCast) => {
      const value = params[position ? Number(position) - 1 : questionIndex++]
      if (arrayCast) {
        const values = value as unknown[]
        bindings.push(...values)
        return values.map(() => '?').join(', ')
      }
      bindings.push(value)
      return '?'
    }).replace(/= ANY\(([^)]+)\)/g, 'IN ($1)').replace(/\s+FOR UPDATE(?: OF lr)?/g, '')
    return database.prepare(adapted)[method](...bindings)
  }

  function insertRequest(id: string, status = 'pending', userId = 'employee', originalId: string | null = null) {
    database.prepare(`INSERT INTO leave_requests (
      id, request_no, user_id, status, original_id, version, created_at, submitted_at,
      approver_id, applicant_name, applicant_department, leave_type_code, leave_type_name,
      start_date, start_half, end_date, end_half, total_days, reason,
      balance_reserved, balance_allocations_json, application_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manager', '员工甲', '项目部', 'other', '其他请假',
      '2026-09-21', 'morning', '2026-09-21', 'afternoon', 1, '请假事由', 0, ?, 'normal')`).run(
      id, id, userId, status, originalId, originalId ? 2 : 1, '2026-09-20T01:00:00Z',
      '2026-09-20T01:00:00Z', '[{"year":2026,"days":1}]'
    )
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    mockRevision = 0
    database = new MemoryDatabase(':memory:')
    database.pragma('foreign_keys = ON')
    database.function('BTRIM', (value: string | null) => value?.trim() ?? null)
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, name TEXT, role TEXT, status TEXT, department TEXT,
        email TEXT, avatar_url TEXT, force_change_password INTEGER, position TEXT
      );
      CREATE TABLE employee_profiles (user_id TEXT, position TEXT);
      CREATE TABLE leave_requests (
        id TEXT PRIMARY KEY, request_no TEXT, user_id TEXT, status TEXT, original_id TEXT,
        version INTEGER, created_at TEXT, submitted_at TEXT, updated_at TEXT,
        approver_id TEXT, applicant_name TEXT, applicant_department TEXT,
        leave_type_code TEXT, leave_type_name TEXT, start_date TEXT, start_half TEXT,
        end_date TEXT, end_half TEXT, total_days REAL, reason TEXT, balance_reserved INTEGER,
        balance_allocations_json TEXT, application_kind TEXT, parent_request_id TEXT,
        combination_group_id TEXT, approved_at TEXT, rejected_at TEXT, reject_reason TEXT,
        approval_notice_unread INTEGER, rejection_notice_unread INTEGER
      );
      CREATE TABLE leave_attachments (
        id TEXT, leave_request_id TEXT, file_name TEXT, file_size INTEGER, mime_type TEXT, created_at TEXT
      );
      CREATE TABLE leave_approval_logs (
        id TEXT, leave_request_id TEXT, operator_id TEXT, operator_name TEXT, action TEXT,
        comment TEXT, created_at TEXT
      );
      CREATE TABLE leave_cc_notifications (
        request_id TEXT NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
        recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        revision TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
        PRIMARY KEY (request_id, recipient_id)
      );
      INSERT INTO users(id,name,role,status) VALUES
        ('employee','员工甲','user','active'),
        ('admin-1','管理员甲','admin','active'),
        ('admin-2','管理员乙','admin','active'),
        ('super','超级管理员','super_admin','active'),
        ('manager','总经理','general_manager','active'),
        ('chairman','董事长','chairman','active'),
        ('boss','经营查看','boss','active'),
        ('disabled','已停用管理员','admin','disabled');
    `)
    insertRequest('leave-1')
    mockPrepare.mockImplementation((sql: string) => ({
      get: (...params: unknown[]) => Promise.resolve(execute(sql, params, 'get')),
      all: (...params: unknown[]) => Promise.resolve(execute(sql, params, 'all')),
      run: (...params: unknown[]) => Promise.resolve(execute(sql, params, 'run')),
    }))
    client = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (/^\s*(SELECT|WITH)/.test(sql)) return { rows: execute(sql, params, 'all') }
        const result = execute(sql, params, 'run')
        return { rows: [], rowCount: result.changes }
      }),
    } as unknown as PoolClient
    mockTransaction.mockImplementation(async callback => {
      database.exec('BEGIN')
      try {
        const result = await callback(client)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    })
  })

  afterEach(() => {
    database.close()
    jest.restoreAllMocks()
  })

  it('只向活动管理员和超级管理员分别生成提醒，不向董事长、总经理或普通员工扩散', async () => {
    await notifyLeaveCcRecipients(client, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
    const recipients = database.prepare('SELECT recipient_id FROM leave_cc_notifications ORDER BY recipient_id').all()
    expect(recipients).toEqual([{ recipient_id: 'admin-1' }, { recipient_id: 'admin-2' }, { recipient_id: 'super' }])
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(1)
    expect(await getUnreadLeaveCcCount('admin-2')).toBe(1)
    expect(await getUnreadLeaveCcCount('chairman')).toBe(0)
  })

  it('管理员本人申请不抄送给自己，其他接收人仍独立收到提醒', async () => {
    insertRequest('self-request', 'pending', 'admin-1')
    await notifyLeaveCcRecipients(client, 'self-request', 'submit', 'admin-1', '2026-09-20T02:00:00Z')
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(0)
    expect(await getUnreadLeaveCcCount('admin-2')).toBe(1)
    expect(await getUnreadLeaveCcCount('super')).toBe(1)
  })

  it('一个接收人已读不影响他人，重复确认具有幂等性', async () => {
    await notifyLeaveCcRecipients(client, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
    const revision = (await getLeaveCcNotices('admin-1', ['leave-1'])).get('leave-1')!.cc_notice_revision
    expect(await markLeaveCcNoticeRead('admin-1', 'leave-1', revision)).toBe(0)
    expect(await markLeaveCcNoticeRead('admin-1', 'leave-1', revision)).toBe(0)
    expect(await getUnreadLeaveCcCount('admin-2')).toBe(1)
    expect(await getUnreadLeaveCcCount('super')).toBe(1)
  })

  it('新审批事件重置未读，旧详情版本不能清除并发到达的新提醒', async () => {
    await notifyLeaveCcRecipients(client, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
    const oldRevision = (await getLeaveCcNotices('admin-1', ['leave-1'])).get('leave-1')!.cc_notice_revision
    await markLeaveCcNoticeRead('admin-1', 'leave-1', oldRevision)
    await notifyLeaveCcRecipients(client, 'leave-1', 'approve', 'super', '2026-09-20T03:00:00Z')
    const latest = (await getLeaveCcNotices('admin-1', ['leave-1'])).get('leave-1')!
    expect(latest.cc_notice_revision).not.toBe(oldRevision)
    expect(await markLeaveCcNoticeRead('admin-1', 'leave-1', oldRevision)).toBe(1)
    expect(await getUnreadLeaveCcCount('super')).toBe(0)
    expect(await markLeaveCcNoticeRead('admin-1', 'leave-1', latest.cc_notice_revision)).toBe(0)
  })

  it('草稿和被新版本替代的申请不计未读，删除请求自动级联清理提醒', async () => {
    await notifyLeaveCcRecipients(client, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
    database.prepare("UPDATE leave_requests SET status='draft' WHERE id='leave-1'").run()
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(0)
    expect((await getLeaveCcNotices('admin-1', ['leave-1'])).size).toBe(0)
    database.prepare("UPDATE leave_requests SET status='rejected' WHERE id='leave-1'").run()
    insertRequest('leave-2', 'pending', 'employee', 'leave-1')
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(0)
    await notifyLeaveCcRecipients(client, 'leave-2', 'resubmit', 'employee', '2026-09-20T03:00:00Z')
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(1)
    database.prepare("DELETE FROM leave_requests WHERE id='leave-2'").run()
    expect(database.prepare("SELECT COUNT(*) AS count FROM leave_cc_notifications WHERE request_id='leave-2'").get().count).toBe(0)
  })

  it('角色变更或禁用后，旧通知不继续成为有效未读', async () => {
    await notifyLeaveCcRecipients(client, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
    database.prepare("UPDATE users SET role='chairman' WHERE id='admin-1'").run()
    database.prepare("UPDATE users SET status='disabled' WHERE id='admin-2'").run()
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(0)
    expect(await getUnreadLeaveCcCount('admin-2')).toBe(0)
    expect((await getLeaveCcNotices('admin-1', ['leave-1'])).size).toBe(0)
  })

  it('通知和业务共用事务，业务回滚不会留下幽灵提醒', async () => {
    await expect(mockTransaction(async (transactionClient: PoolClient) => {
      await notifyLeaveCcRecipients(transactionClient, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
      throw new Error('模拟业务失败')
    })).rejects.toThrow('模拟业务失败')
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(0)
  })

  it.each(['admin', 'super_admin', 'general_manager', 'chairman', 'boss', 'user'])(
    '已读接口对角色 %s 使用真实数据库身份进行精确授权', async role => {
      const userId = role === 'admin' ? 'admin-1' : role === 'super_admin' ? 'super' : role === 'general_manager' ? 'manager' : role === 'user' ? 'employee' : role
      const next = jest.fn()
      const res = response()
      await routeLayer('post', '/admin/requests/:id/cc/mark-read').stack[0].handle(
        request(userId), res as unknown as Response, next
      )
      if (isLeaveCcRecipientRole(role)) expect(next).toHaveBeenCalled()
      else expect(res.status).toHaveBeenCalledWith(403)
    }
  )

  it.each([undefined, '', ' ', 123, ['版本'], '长'.repeat(129)])('拒绝无效提醒版本 %s', async revision => {
    const res = response()
    await routeLayer('post', '/admin/requests/:id/cc/mark-read').stack.at(-1).handle(
      request('admin-1', { body: { revision } }), res as unknown as Response, jest.fn()
    )
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('已读操作仅使用会话用户，不接受客户端指定他人的接收身份', async () => {
    await notifyLeaveCcRecipients(client, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
    const revision = (await getLeaveCcNotices('admin-1', ['leave-1'])).get('leave-1')!.cc_notice_revision
    const res = response()
    await routeLayer('post', '/admin/requests/:id/cc/mark-read').stack.at(-1).handle(
      request('admin-1', { body: { revision, recipient_id: 'admin-2', userId: 'admin-2' } }),
      res as unknown as Response, jest.fn()
    )
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { unreadCount: 0 } })
    expect(await getUnreadLeaveCcCount('admin-2')).toBe(1)
  })

  it('只看未读在数据库分页前筛选，列表与总数绑定当前接收人且不会自动已读', async () => {
    insertRequest('leave-2')
    insertRequest('leave-3')
    await notifyLeaveCcRecipients(client, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
    await notifyLeaveCcRecipients(client, 'leave-2', 'submit', 'employee', '2026-09-20T03:00:00Z')
    const revision = (await getLeaveCcNotices('admin-1', ['leave-2'])).get('leave-2')!.cc_notice_revision
    await markLeaveCcNoticeRead('admin-1', 'leave-2', revision)
    const res = response()
    await routeLayer('get', '/admin/requests').stack.at(-1).handle(
      request('admin-1', { query: { unreadOnly: 'true', recipientId: 'admin-2', page: '1', pageSize: '1' } }),
      res as unknown as Response, jest.fn()
    )
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0].data).toEqual(expect.objectContaining({
      total: 1, page: 1, pageSize: 1,
      list: [expect.objectContaining({ id: 'leave-1', cc_notice_unread: true, cc_notice_revision: expect.any(String) })],
    }))
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(1)
    expect(await getUnreadLeaveCcCount('admin-2')).toBe(2)
  })

  it('旧申请详情返回最新版本的通知，不自动标记为已读；历史导入不产生提醒', async () => {
    database.prepare("UPDATE leave_requests SET status='rejected' WHERE id='leave-1'").run()
    insertRequest('leave-2', 'pending', 'employee', 'leave-1')
    insertRequest('historical-import', 'approved')
    await notifyLeaveCcRecipients(client, 'leave-2', 'resubmit', 'employee', '2026-09-20T02:00:00Z')
    const res = response()
    await routeLayer('get', '/requests/:id').stack.at(-1).handle(request(), res as unknown as Response, jest.fn())
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0].data).toEqual(expect.objectContaining({
      id: 'leave-2', cc_notice_unread: true, cc_notice_revision: expect.any(String),
    }))
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(1)
    expect((await getLeaveCcNotices('admin-1', ['historical-import'])).size).toBe(0)
  })

  it('详情与提醒版本使用同一快照，读取附件前并发审批不会让旧详情清掉新消息', async () => {
    await notifyLeaveCcRecipients(client, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
    const oldRevision = (await getLeaveCcNotices('admin-1', ['leave-1'])).get('leave-1')!.cc_notice_revision
    const prepareImplementation = mockPrepare.getMockImplementation()!
    mockPrepare.mockImplementation((sql: string) => {
      if (!sql.includes('WITH RECURSIVE ancestors')) return prepareImplementation(sql)
      expect(sql).toContain('LEFT JOIN leave_cc_notifications cc_notice')
      return {
        all: async (...params: unknown[]) => {
          const snapshot = execute(sql, params, 'all')
          database.prepare("UPDATE leave_requests SET status='approved' WHERE id='leave-1'").run()
          await notifyLeaveCcRecipients(client, 'leave-1', 'approve', 'manager', '2026-09-20T03:00:00Z')
          return snapshot
        },
      }
    })
    const res = response()
    await routeLayer('get', '/requests/:id').stack.at(-1).handle(request(), res as unknown as Response, jest.fn())
    expect(res.status).not.toHaveBeenCalled()
    const detail = res.json.mock.calls[0][0].data
    expect(detail.status).toBe('pending')
    expect(detail.cc_notice_revision).toBe(oldRevision)
    expect(await markLeaveCcNoticeRead('admin-1', detail.id, detail.cc_notice_revision)).toBe(1)
  })

  it.each(['approve', 'reject'] as const)('实际%s路由在同一事务中更新逐人提醒，超级管理员操作自身无需再读', async action => {
    await notifyLeaveCcRecipients(client, 'leave-1', 'submit', 'employee', '2026-09-20T02:00:00Z')
    const res = response()
    await routeLayer('post', `/requests/:id/${action}`).stack.at(-1).handle(
      request('super', { body: { comment: '同意', rejectReason: '资料待补充' } }),
      res as unknown as Response, jest.fn()
    )
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0].success).toBe(true)
    expect(database.prepare("SELECT action FROM leave_cc_notifications WHERE recipient_id='admin-1'").get().action).toBe(action)
    expect(await getUnreadLeaveCcCount('admin-1')).toBe(1)
    expect(await getUnreadLeaveCcCount('super')).toBe(0)
  })

  it('所有普通、返岗补假、组合、续假和重提入口均在事务内发提醒，撤回与历史导入不新增提醒', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'server/routes/leave.ts'), 'utf8')
    const helper = source.slice(source.indexOf('async function createPendingLeaveRequest'), source.indexOf('function cleanupLeaveUploadPaths'))
    expect(helper).toContain("await notifyLeaveCcRecipients(client, input.requestId, 'submit', input.userId, input.now)")
    const single = source.slice(source.indexOf("router.post('/requests'"), source.indexOf('// 提交组合请假'))
    expect(single).toContain("await notifyLeaveCcRecipients(client, requestId, 'submit', userId, now)")
    const combined = source.slice(source.indexOf("'/requests/combined'"), source.indexOf('// 查询本人申请列表'))
    expect(combined).toContain('await createPendingLeaveRequest(client, {')
    expect(combined).toContain('await db.transaction(')
    const related = source.slice(source.indexOf("'/requests/:id/related'"), source.indexOf('// 查看单条申请详情'))
    expect(related).toContain('await createPendingLeaveRequest(client, {')
    const resubmit = source.slice(source.indexOf("router.post('/requests/:id/resubmit'"), source.indexOf('// ==================== 审批端接口'))
    expect(resubmit).toMatch(/notifyLeaveCcRecipients\(\s*client,\s*resultRequestId,\s*lockedRequest.status === 'draft' \? 'submit' : 'resubmit'/)
    const cancel = source.slice(source.indexOf("router.post('/requests/:id/cancel'"), source.indexOf('// 手动硬删除草稿'))
    expect(cancel).not.toContain('notifyLeaveCcRecipients')
    const dbSource = fs.readFileSync(path.resolve(process.cwd(), 'server/db/index.ts'), 'utf8')
    expect(dbSource).toContain('CREATE TABLE IF NOT EXISTS leave_cc_notifications')
    expect(dbSource).toContain('PRIMARY KEY (request_id, recipient_id)')
    expect(dbSource).not.toContain('INSERT INTO leave_cc_notifications')
  })
})
