import { Router } from 'express'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()

// 四类字典表 + 允许携带的额外字段
type DictKind = 'districts' | 'project-types' | 'matters' | 'contract-statuses'
const TABLE_MAP: Record<DictKind, string> = {
  'districts': 'worklog_districts',
  'project-types': 'worklog_project_types',
  'matters': 'worklog_matters',
  'contract-statuses': 'worklog_contract_statuses',
}

// matters 表额外支持 standard_days 字段
function isMatters(kind: string): kind is 'matters' {
  return kind === 'matters'
}

function isValidKind(kind: string): kind is DictKind {
  return kind in TABLE_MAP
}

// 所有登录用户可查字典（下拉要用）
router.get('/:kind', requireAuth, async (req, res) => {
  try {
    const { kind } = req.params
    if (!isValidKind(kind)) return res.status(400).json({ success: false, message: '未知的字典类别' })
    const table = TABLE_MAP[kind]

    const includeInactive = req.query.includeInactive === 'true'
    const whereSql = includeInactive ? '' : 'WHERE is_active = TRUE'
    const rows = await db.all<any>(
      `SELECT * FROM ${table} ${whereSql} ORDER BY sort_order ASC, name ASC`,
    )
    res.json({ success: true, data: rows })
  } catch (err: any) {
    console.error('获取日志字典失败:', err)
    res.status(500).json({ success: false, message: '获取字典失败' })
  }
})

// 管理员新增字典项
router.post('/:kind', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { kind } = req.params
    if (!isValidKind(kind)) return res.status(400).json({ success: false, message: '未知的字典类别' })
    const table = TABLE_MAP[kind]

    const { name, sort_order = 0, standard_days } = req.body as { name?: string; sort_order?: number; standard_days?: number | null }
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: '名称不能为空' })

    const now = new Date().toISOString()
    const id = nanoid()

    if (isMatters(kind)) {
      await db.run(
        `INSERT INTO ${table} (id, name, standard_days, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, TRUE, ?, ?)`,
        id, name.trim(), standard_days ?? null, sort_order, now, now,
      )
    } else {
      await db.run(
        `INSERT INTO ${table} (id, name, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, TRUE, ?, ?)`,
        id, name.trim(), sort_order, now, now,
      )
    }

    res.json({ success: true, data: { id } })
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ success: false, message: '名称已存在' })
    }
    console.error('新增字典项失败:', err)
    res.status(500).json({ success: false, message: '新增字典项失败' })
  }
})

// 管理员更新字典项
router.put('/:kind/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { kind, id } = req.params
    if (!isValidKind(kind)) return res.status(400).json({ success: false, message: '未知的字典类别' })
    const table = TABLE_MAP[kind]

    const { name, sort_order, is_active, standard_days } = req.body as { name?: string; sort_order?: number; is_active?: boolean; standard_days?: number | null }
    const now = new Date().toISOString()

    const sets: string[] = []
    const params: any[] = []
    if (name !== undefined) { sets.push('name = ?'); params.push(name.trim()) }
    if (sort_order !== undefined) { sets.push('sort_order = ?'); params.push(sort_order) }
    if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active) }
    if (isMatters(kind) && standard_days !== undefined) { sets.push('standard_days = ?'); params.push(standard_days) }
    if (sets.length === 0) return res.status(400).json({ success: false, message: '没有可更新字段' })
    sets.push('updated_at = ?'); params.push(now)
    params.push(id)

    const result = await db.run(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, ...params)
    if (result.changes === 0) return res.status(404).json({ success: false, message: '字典项不存在' })
    res.json({ success: true })
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(400).json({ success: false, message: '名称已存在' })
    }
    console.error('更新字典项失败:', err)
    res.status(500).json({ success: false, message: '更新字典项失败' })
  }
})

// 管理员删除字典项（软删除：置 is_active = false，避免影响历史日志）
router.delete('/:kind/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { kind, id } = req.params
    if (!isValidKind(kind)) return res.status(400).json({ success: false, message: '未知的字典类别' })
    const table = TABLE_MAP[kind]

    const now = new Date().toISOString()
    const result = await db.run(`UPDATE ${table} SET is_active = FALSE, updated_at = ? WHERE id = ?`, now, id)
    if (result.changes === 0) return res.status(404).json({ success: false, message: '字典项不存在' })
    res.json({ success: true })
  } catch (err: any) {
    console.error('删除字典项失败:', err)
    res.status(500).json({ success: false, message: '删除字典项失败' })
  }
})

export default router
