import { Router } from 'express'
import { nanoid } from 'nanoid'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()

/**
 * 获取所有报销范围配置（树形结构）
 * GET /api/reimbursement-scope/list
 */
router.get('/list', requireAuth, async (req, res) => {
  try {
    const { db } = await import('../db/index.js')

    // 获取所有启用的报销范围
    const scopes = db.prepare(`
      SELECT id, parent_id, name, value, sort_order, is_active
      FROM reimbursement_scopes
      WHERE is_active = 1
      ORDER BY sort_order ASC
    `).all()

    // 构建树形结构
    const buildTree = (items: any[], parentId: string | null = null): any[] => {
      return items
        .filter(item => item.parent_id === parentId)
        .map(item => ({
          ...item,
          children: buildTree(items, item.id)
        }))
    }

    const tree = buildTree(scopes)

    res.json({
      success: true,
      data: tree
    })
  } catch (error) {
    console.error('获取报销范围列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取报销范围列表失败'
    })
  }
})

/**
 * 获取所有报销范围配置（管理用，包含禁用项）
 * GET /api/reimbursement-scope/admin/list
 */
router.get('/admin/list', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { db } = await import('../db/index.js')

    // 获取所有报销范围（包含禁用的）
    const scopes = db.prepare(`
      SELECT id, parent_id, name, value, sort_order, is_active, created_at, updated_at
      FROM reimbursement_scopes
      ORDER BY sort_order ASC
    `).all()

    // 构建树形结构
    const buildTree = (items: any[], parentId: string | null = null): any[] => {
      return items
        .filter(item => item.parent_id === parentId)
        .map(item => ({
          ...item,
          children: buildTree(items, item.id)
        }))
    }

    const tree = buildTree(scopes)

    res.json({
      success: true,
      data: tree
    })
  } catch (error) {
    console.error('获取报销范围管理列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取报销范围管理列表失败'
    })
  }
})

/**
 * 创建报销范围
 * POST /api/reimbursement-scope/create
 */
router.post('/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { parentId, name, value } = req.body

    if (!name || !value) {
      return res.status(400).json({
        success: false,
        message: '名称和值不能为空'
      })
    }

    const { db } = await import('../db/index.js')

    // 获取同级最大排序号
    let maxSort: { max_sort: number | null }
    if (parentId) {
      maxSort = db.prepare(`
        SELECT MAX(sort_order) as max_sort
        FROM reimbursement_scopes
        WHERE parent_id = ?
      `).get(parentId) as { max_sort: number | null }
    } else {
      maxSort = db.prepare(`
        SELECT MAX(sort_order) as max_sort
        FROM reimbursement_scopes
        WHERE parent_id IS NULL
      `).get() as { max_sort: number | null }
    }

    const sortOrder = (maxSort.max_sort || 0) + 1
    const id = nanoid()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO reimbursement_scopes (id, parent_id, name, value, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, parentId || null, name, value, sortOrder, now, now)

    res.json({
      success: true,
      data: { id, parentId, name, value, sortOrder }
    })
  } catch (error) {
    console.error('创建报销范围失败:', error)
    res.status(500).json({
      success: false,
      message: '创建报销范围失败'
    })
  }
})

/**
 * 更新排序
 * PUT /api/reimbursement-scope/sort
 */
router.put('/sort', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { items } = req.body as { items: Array<{ id: string; sortOrder: number }> }

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        message: '参数错误'
      })
    }

    const { db } = await import('../db/index.js')
    const now = new Date().toISOString()

    const updateStmt = db.prepare(`
      UPDATE reimbursement_scopes
      SET sort_order = ?, updated_at = ?
      WHERE id = ?
    `)

    for (const item of items) {
      updateStmt.run(item.sortOrder, now, item.id)
    }

    res.json({
      success: true,
      message: '排序更新成功'
    })
  } catch (error) {
    console.error('更新排序失败:', error)
    res.status(500).json({
      success: false,
      message: '更新排序失败'
    })
  }
})

/**
 * 更新报销范围
 * PUT /api/reimbursement-scope/:id
 */
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { name, value, isActive } = req.body

    if (!name || !value) {
      return res.status(400).json({
        success: false,
        message: '名称和值不能为空'
      })
    }

    const { db } = await import('../db/index.js')
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE reimbursement_scopes
      SET name = ?, value = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(name, value, isActive ? 1 : 0, now, id)

    res.json({
      success: true,
      message: '更新成功'
    })
  } catch (error) {
    console.error('更新报销范围失败:', error)
    res.status(500).json({
      success: false,
      message: '更新报销范围失败'
    })
  }
})

/**
 * 删除报销范围
 * DELETE /api/reimbursement-scope/:id
 */
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { db } = await import('../db/index.js')

    // 检查是否有子项
    const children = db.prepare(`
      SELECT COUNT(*) as count
      FROM reimbursement_scopes
      WHERE parent_id = ?
    `).get(id) as { count: number }

    if (children.count > 0) {
      return res.status(400).json({
        success: false,
        message: '该项下有子项，无法删除'
      })
    }

    db.prepare('DELETE FROM reimbursement_scopes WHERE id = ?').run(id)

    res.json({
      success: true,
      message: '删除成功'
    })
  } catch (error) {
    console.error('删除报销范围失败:', error)
    res.status(500).json({
      success: false,
      message: '删除报销范围失败'
    })
  }
})

export default router
