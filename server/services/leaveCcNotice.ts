import type { PoolClient } from 'pg'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'

export type LeaveCcNoticeAction = 'submit' | 'resubmit' | 'approve' | 'reject'

export interface LeaveCcNoticeRow {
  request_id: string
  cc_notice_unread: boolean
  cc_notice_revision: string
}

// 抄送仅属于真实管理员角色，不沿用董事长等角色的管理权限继承规则。
export const LEAVE_CC_RECIPIENT_ROLES = ['admin', 'super_admin'] as const

export function isLeaveCcRecipientRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin'
}

// 所有未读入口共享同一有效范围：当前版本、非草稿、当前仍在职的抄送接收人。
const VALID_LEAVE_CC_NOTICE = `
  lr.status <> 'draft'
  AND lr.user_id <> notice.recipient_id
  AND recipient.status = 'active'
  AND recipient.role IN ('admin', 'super_admin')
  AND NOT EXISTS (
    SELECT 1 FROM leave_requests next_version
    WHERE next_version.original_id = lr.id
  )`

/** 在业务事务中更新抄送状态；新事件使用独立版本，避免旧详情误读新消息。 */
export async function notifyLeaveCcRecipients(
  client: PoolClient,
  requestId: string,
  action: LeaveCcNoticeAction,
  actorId: string,
  now: string
): Promise<void> {
  await client.query(
    `INSERT INTO leave_cc_notifications (
       request_id, recipient_id, revision, action, created_at, read_at
     )
     SELECT lr.id, recipient.id, $2, $3, $5,
            CASE WHEN recipient.id = $4 THEN $5 ELSE NULL END
     FROM leave_requests lr
     CROSS JOIN users recipient
     WHERE lr.id = $1
       AND lr.status <> 'draft'
       AND recipient.id <> lr.user_id
       AND recipient.role IN ('admin', 'super_admin')
       AND recipient.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM leave_requests next_version
         WHERE next_version.original_id = lr.id
       )
     ON CONFLICT (request_id, recipient_id) DO UPDATE
     SET revision = EXCLUDED.revision,
         action = EXCLUDED.action,
         created_at = EXCLUDED.created_at,
         read_at = EXCLUDED.read_at`,
    [requestId, nanoid(), action, actorId, now]
  )
}

export async function getUnreadLeaveCcCount(userId: string): Promise<number> {
  const result = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM leave_cc_notifications notice
     INNER JOIN leave_requests lr ON lr.id = notice.request_id
     INNER JOIN users recipient ON recipient.id = notice.recipient_id
     WHERE notice.recipient_id = ?
       AND notice.read_at IS NULL
       AND ${VALID_LEAVE_CC_NOTICE}`
  ).get<{ count: number | string }>(userId)
  return Number(result?.count || 0)
}

export async function getLeaveCcNotices(
  userId: string,
  requestIds: string[]
): Promise<Map<string, LeaveCcNoticeRow>> {
  if (requestIds.length === 0) return new Map()
  const rows = await db.prepare(
    `SELECT notice.request_id,
            notice.read_at IS NULL AS cc_notice_unread,
            notice.revision AS cc_notice_revision
     FROM leave_cc_notifications notice
     INNER JOIN leave_requests lr ON lr.id = notice.request_id
     INNER JOIN users recipient ON recipient.id = notice.recipient_id
     WHERE notice.recipient_id = ?
       AND notice.request_id = ANY(?::text[])
       AND ${VALID_LEAVE_CC_NOTICE}`
  ).all<LeaveCcNoticeRow>(userId, requestIds)
  return new Map(rows.map(row => [row.request_id, {
    ...row,
    cc_notice_unread: Boolean(row.cc_notice_unread),
  }]))
}

export async function markLeaveCcNoticeRead(
  userId: string,
  requestId: string,
  revision: string
): Promise<number> {
  await db.prepare(
    `UPDATE leave_cc_notifications AS notice
     SET read_at = ?
     FROM leave_requests lr, users recipient
     WHERE lr.id = notice.request_id
       AND recipient.id = notice.recipient_id
       AND notice.recipient_id = ?
       AND notice.request_id = ?
       AND notice.revision = ?
       AND notice.read_at IS NULL
       AND ${VALID_LEAVE_CC_NOTICE}`
  ).run(new Date().toISOString(), userId, requestId, revision)
  return getUnreadLeaveCcCount(userId)
}
