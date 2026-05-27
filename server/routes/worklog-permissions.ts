import { Router } from 'express'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js'
import { checkWeeklyReportWhitelist } from '../utils/worklog-auth.js'

const router = Router()

// 查询当前登录人是否在指定权限白名单（前端按钮根据此显隐）
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const canDownloadWeekly = await checkWeeklyReportWhitelist(userId)
    res.json({
      success: true,
      data: { downloadWeeklyReport: canDownloadWeekly },
    })
  } catch (err) {
    console.error('查询个人权限失败:', err)
    res.status(500).json({ success: false, message: '查询权限失败' })
  }
})

// 超管：列出所有权限白名单（连 user 信息）
router.get('/', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const rows = await db.all<{ id: string; permission_code: string; user_id: string; user_name: string; created_at: string }>(
      `SELECT wp.id, wp.permission_code, wp.user_id, wp.created_at, u.name AS user_name
       FROM worklog_permissions wp
       JOIN users u ON u.id = wp.user_id
       ORDER BY wp.permission_code ASC, u.name ASC`,
    )
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('查询权限白名单失败:', err)
    res.status(500).json({ success: false, message: '查询权限白名单失败' })
  }
})

// 超管：给某用户授权
router.post('/', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { permissionCode, userId } = req.body as { permissionCode?: string; userId?: string }
    if (!permissionCode || !userId) return res.status(400).json({ success: false, message: 'permissionCode 和 userId 必填' })
    const user = await db.get(`SELECT id FROM users WHERE id = ?`, userId)
    if (!user) return res.status(400).json({ success: false, message: '用户不存在' })
    const exist = await db.get(
      `SELECT id FROM worklog_permissions WHERE permission_code = ? AND user_id = ?`,
      permissionCode, userId,
    )
    if (exist) return res.json({ success: true, data: { id: (exist as any).id }, existed: true })
    const id = nanoid()
    await db.run(
      `INSERT INTO worklog_permissions (id, permission_code, user_id, created_at) VALUES (?, ?, ?, ?)`,
      id, permissionCode, userId, new Date().toISOString(),
    )
    res.json({ success: true, data: { id } })
  } catch (err) {
    console.error('授予权限失败:', err)
    res.status(500).json({ success: false, message: '授予权限失败' })
  }
})

// 超管：撤销授权
router.delete('/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await db.run(`DELETE FROM worklog_permissions WHERE id = ?`, req.params.id)
    if (result.changes === 0) return res.status(404).json({ success: false, message: '授权记录不存在' })
    res.json({ success: true })
  } catch (err) {
    console.error('撤销权限失败:', err)
    res.status(500).json({ success: false, message: '撤销权限失败' })
  }
})

export default router
