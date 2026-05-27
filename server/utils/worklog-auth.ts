import { db } from '../db/index.js'

// 可查看全部项目日志的角色：总经理和系统管理员
export const VIEW_ALL_ROLES = ['super_admin', 'general_manager'] as const

// 兼容旧引用
export const ADMIN_ROLES = VIEW_ALL_ROLES

export async function getUserRole(userId: string): Promise<string | null> {
  const row = await db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', userId)
  return row?.role ?? null
}

export async function isAdminLike(userId: string): Promise<boolean> {
  const role = await getUserRole(userId)
  return role !== null && (VIEW_ALL_ROLES as readonly string[]).includes(role)
}

export interface EntryRow {
  id: string
  user_id: string
  is_finalized: boolean
}

/**
 * 校验写权限：只有日志发起人才能修改自己的日志
 */
export async function checkEntryWritePermission(userId: string, entry: EntryRow): Promise<{ ok: true } | { ok: false; message: string }> {
  if (entry.user_id === userId) return { ok: true }
  return { ok: false, message: '只能操作自己的日志' }
}

/**
 * 校验日志是否已办结：办结后任何人都不能编辑、删除、加附件
 */
export function checkFinalizedLock(entry: EntryRow): { ok: true } | { ok: false; message: string } {
  if (entry.is_finalized) return { ok: false, message: '该日志已办结，禁止修改' }
  return { ok: true }
}

/**
 * 校验是否在周报下载白名单
 */
export async function checkWeeklyReportWhitelist(userId: string): Promise<boolean> {
  const row = await db.get<{ id: string }>(
    `SELECT id FROM worklog_permissions WHERE permission_code = ? AND user_id = ?`,
    'download_weekly_report', userId,
  )
  return !!row
}
