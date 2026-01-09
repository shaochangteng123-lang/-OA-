import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()

// 获取所有部门
router.get('/', requireAuth, (req, res) => {
  try {
    const { search } = req.query
    let query =
      'SELECT * FROM government_departments WHERE is_active = 1 ORDER BY sort_order, full_name'
    let params: unknown[] = []

    if (search) {
      query = `
        SELECT * FROM government_departments
        WHERE is_active = 1
        AND (full_name LIKE ? OR short_names LIKE ?)
        ORDER BY sort_order, full_name
      `
      params = [`%${search}%`, `%${search}%`]
    }

    const departments = db.prepare(query).all(...params) as Array<{
      id: string
      full_name: string
      short_names: string
      website_url: string | null
      sort_order: number
      is_active: number
      created_at: string
      updated_at: string
    }>

    const result = departments.map((dept) => ({
      id: dept.id,
      fullName: dept.full_name,
      shortNames: dept.short_names.split(',').map((s) => s.trim()),
      websiteUrl: dept.website_url || undefined,
      sortOrder: dept.sort_order,
      isActive: dept.is_active === 1,
      createdAt: dept.created_at,
      updatedAt: dept.updated_at,
    }))

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('获取部门列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取部门列表失败',
      error: process.env.NODE_ENV === 'development' ? String(error) : undefined,
    })
  }
})

// 获取单个部门
router.get('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const dept = db.prepare('SELECT * FROM government_departments WHERE id = ?').get(id) as
      | {
          id: string
          full_name: string
          short_names: string
          website_url: string | null
          sort_order: number
          is_active: number
          created_at: string
          updated_at: string
        }
      | undefined

    if (!dept) {
      return res.status(404).json({
        success: false,
        message: '部门不存在',
      })
    }

    res.json({
      success: true,
      data: {
        id: dept.id,
        fullName: dept.full_name,
        shortNames: dept.short_names.split(',').map((s) => s.trim()),
        websiteUrl: dept.website_url || undefined,
        sortOrder: dept.sort_order,
        isActive: dept.is_active === 1,
        createdAt: dept.created_at,
        updatedAt: dept.updated_at,
      },
    })
  } catch (error) {
    console.error('获取部门详情失败:', error)
    res.status(500).json({
      success: false,
      message: '获取部门详情失败',
      error: process.env.NODE_ENV === 'development' ? String(error) : undefined,
    })
  }
})

// 创建部门（仅管理员）
router.post('/', requireAdmin, (req, res) => {
  try {
    const { fullName, shortNames, websiteUrl, sortOrder } = req.body

    if (!fullName || !shortNames || !Array.isArray(shortNames) || shortNames.length === 0) {
      return res.status(400).json({
        success: false,
        message: '部门全称和简称不能为空',
      })
    }

    // 检查全称是否已存在
    const existing = db
      .prepare('SELECT id FROM government_departments WHERE full_name = ?')
      .get(fullName)

    if (existing) {
      return res.status(400).json({
        success: false,
        message: '部门全称已存在',
      })
    }

    const now = new Date().toISOString()
    const id = nanoid()
    const shortNamesStr = shortNames.join(',')

    db.prepare(
      `
      INSERT INTO government_departments (
        id, full_name, short_names, website_url, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(id, fullName, shortNamesStr, websiteUrl || null, sortOrder || 0, 1, now, now)

    res.json({
      success: true,
      data: {
        id,
        fullName,
        shortNames,
        websiteUrl,
        sortOrder: sortOrder || 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      message: '部门创建成功',
    })
  } catch (error) {
    console.error('创建部门失败:', error)
    res.status(500).json({
      success: false,
      message: '创建部门失败',
      error: process.env.NODE_ENV === 'development' ? String(error) : undefined,
    })
  }
})

// 更新部门（仅管理员）
router.put('/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    const { fullName, shortNames, websiteUrl, sortOrder, isActive } = req.body

    // 检查部门是否存在
    const existing = db.prepare('SELECT id FROM government_departments WHERE id = ?').get(id)

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: '部门不存在',
      })
    }

    if (fullName) {
      // 检查全称是否与其他部门冲突
      const conflict = db
        .prepare('SELECT id FROM government_departments WHERE full_name = ? AND id != ?')
        .get(fullName, id)

      if (conflict) {
        return res.status(400).json({
          success: false,
          message: '部门全称已被其他部门使用',
        })
      }
    }

    const now = new Date().toISOString()
    const updates: string[] = []
    const params: unknown[] = []

    if (fullName !== undefined) {
      updates.push('full_name = ?')
      params.push(fullName)
    }
    if (shortNames !== undefined) {
      if (!Array.isArray(shortNames) || shortNames.length === 0) {
        return res.status(400).json({
          success: false,
          message: '简称不能为空',
        })
      }
      updates.push('short_names = ?')
      params.push(shortNames.join(','))
    }
    if (websiteUrl !== undefined) {
      updates.push('website_url = ?')
      params.push(websiteUrl || null)
    }
    if (sortOrder !== undefined) {
      updates.push('sort_order = ?')
      params.push(sortOrder)
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?')
      params.push(isActive ? 1 : 0)
    }

    updates.push('updated_at = ?')
    params.push(now)
    params.push(id)

    db.prepare(
      `
      UPDATE government_departments
      SET ${updates.join(', ')}
      WHERE id = ?
    `
    ).run(...params)

    // 获取更新后的数据
    const updated = db.prepare('SELECT * FROM government_departments WHERE id = ?').get(id) as {
      id: string
      full_name: string
      short_names: string
      website_url: string | null
      sort_order: number
      is_active: number
      created_at: string
      updated_at: string
    }

    res.json({
      success: true,
      data: {
        id: updated.id,
        fullName: updated.full_name,
        shortNames: updated.short_names.split(',').map((s) => s.trim()),
        websiteUrl: updated.website_url || undefined,
        sortOrder: updated.sort_order,
        isActive: updated.is_active === 1,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
      },
      message: '部门更新成功',
    })
  } catch (error) {
    console.error('更新部门失败:', error)
    res.status(500).json({
      success: false,
      message: '更新部门失败',
      error: process.env.NODE_ENV === 'development' ? String(error) : undefined,
    })
  }
})

// 删除部门（仅管理员）
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params

    // 检查是否有事件关联此部门
    const eventCount = db
      .prepare('SELECT COUNT(*) as count FROM event_library WHERE department_id = ?')
      .get(id) as { count: number }

    if (eventCount.count > 0) {
      return res.status(400).json({
        success: false,
        message: `无法删除,该部门关联了 ${eventCount.count} 个事件`,
      })
    }

    const result = db.prepare('DELETE FROM government_departments WHERE id = ?').run(id)

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: '部门不存在',
      })
    }

    res.json({
      success: true,
      message: '部门删除成功',
    })
  } catch (error) {
    console.error('删除部门失败:', error)
    res.status(500).json({
      success: false,
      message: '删除部门失败',
      error: process.env.NODE_ENV === 'development' ? String(error) : undefined,
    })
  }
})

export default router
