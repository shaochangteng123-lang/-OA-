import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()

// 获取部门职位配置（所有已登录用户可访问）- 必须在 /:id 路由之前
router.get('/org-options', requireAuth, async (_req, res) => {
  try {
    const config = await db.prepare('SELECT config_json FROM department_position_configs WHERE id = ?').get('default') as
      | { config_json: string }
      | undefined

    if (!config) {
      return res.json({
        success: true,
        data: {
          '行政部': ['行政主管', '行政专员', '财务', '出纳'],
          '项目部': ['项目经理', '员工'],
        },
      })
    }

    res.json({ success: true, data: JSON.parse(config.config_json) })
  } catch (error) {
    console.error('获取部门职位配置失败:', error)
    res.status(500).json({ success: false, message: '获取部门职位配置失败' })
  }
})

// 更新部门职位配置（仅管理员）- 必须在 /:id 路由之前
router.post('/org-options', requireAdmin, async (req, res) => {
  try {
    const { departmentPositionMap } = req.body
    if (!departmentPositionMap || typeof departmentPositionMap !== 'object') {
      return res.status(400).json({ success: false, message: '无效的部门职位数据' })
    }

    const now = new Date().toISOString()
    const existing = await db.prepare('SELECT id FROM department_position_configs WHERE id = ?').get('default')

    if (existing) {
      await db.prepare('UPDATE department_position_configs SET config_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(departmentPositionMap),
        now,
        'default'
      )
    } else {
      await db.prepare('INSERT INTO department_position_configs (id, config_json, updated_at) VALUES (?, ?, ?)').run(
        'default',
        JSON.stringify(departmentPositionMap),
        now
      )
    }

    res.json({ success: true, message: '部门职位配置已更新' })
  } catch (error) {
    console.error('更新部门职位配置失败:', error)
    res.status(500).json({ success: false, message: '更新失败' })
  }
})

// 获取所有部门
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search } = req.query
    let query = 'SELECT * FROM government_departments WHERE is_active = TRUE ORDER BY sort_order, full_name'
    let params: unknown[] = []

    if (search) {
      query = `
        SELECT * FROM government_departments
        WHERE is_active = TRUE
        AND (full_name LIKE ? OR short_names LIKE ?)
        ORDER BY sort_order, full_name
      `
      params = [`%${search}%`, `%${search}%`]
    }

    const departments = await db.prepare(query).all(...params) as Array<{
      id: string
      full_name: string
      short_names: string
      website_url: string | null
      sort_order: number
      is_active: boolean
      created_at: string
      updated_at: string
    }>

    res.json({
      success: true,
      data: departments.map((dept) => ({
        id: dept.id,
        fullName: dept.full_name,
        shortNames: dept.short_names.split(',').map((s) => s.trim()),
        websiteUrl: dept.website_url || undefined,
        sortOrder: dept.sort_order,
        isActive: dept.is_active === true,
        createdAt: dept.created_at,
        updatedAt: dept.updated_at,
      })),
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
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const dept = await db.prepare('SELECT * FROM government_departments WHERE id = ?').get(id) as
      | {
          id: string
          full_name: string
          short_names: string
          website_url: string | null
          sort_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
      | undefined

    if (!dept) {
      return res.status(404).json({ success: false, message: '部门不存在' })
    }

    res.json({
      success: true,
      data: {
        id: dept.id,
        fullName: dept.full_name,
        shortNames: dept.short_names.split(',').map((s) => s.trim()),
        websiteUrl: dept.website_url || undefined,
        sortOrder: dept.sort_order,
        isActive: dept.is_active === true,
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
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { fullName, shortNames, websiteUrl, sortOrder } = req.body

    if (!fullName || !shortNames || !Array.isArray(shortNames) || shortNames.length === 0) {
      return res.status(400).json({ success: false, message: '部门全称和简称不能为空' })
    }

    const existing = await db.prepare('SELECT id FROM government_departments WHERE full_name = ?').get(fullName)
    if (existing) {
      return res.status(400).json({ success: false, message: '部门全称已存在' })
    }

    const now = new Date().toISOString()
    const id = nanoid()
    const shortNamesStr = shortNames.join(',')

    await db.prepare(
      `
      INSERT INTO government_departments (
        id, full_name, short_names, website_url, sort_order, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(id, fullName, shortNamesStr, websiteUrl || null, sortOrder || 0, true, now, now)

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
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { fullName, shortNames, websiteUrl, sortOrder, isActive } = req.body

    const existing = await db.prepare('SELECT id FROM government_departments WHERE id = ?').get(id)
    if (!existing) {
      return res.status(404).json({ success: false, message: '部门不存在' })
    }

    if (fullName) {
      const conflict = await db
        .prepare('SELECT id FROM government_departments WHERE full_name = ? AND id != ?')
        .get(fullName, id)
      if (conflict) {
        return res.status(400).json({ success: false, message: '部门全称已被其他部门使用' })
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
        return res.status(400).json({ success: false, message: '简称不能为空' })
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
      params.push(Boolean(isActive))
    }

    updates.push('updated_at = ?')
    params.push(now)
    params.push(id)

    await db.prepare(
      `
      UPDATE government_departments
      SET ${updates.join(', ')}
      WHERE id = ?
    `
    ).run(...params)

    const updated = await db.prepare('SELECT * FROM government_departments WHERE id = ?').get(id) as {
      id: string
      full_name: string
      short_names: string
      website_url: string | null
      sort_order: number
      is_active: boolean
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
        isActive: updated.is_active === true,
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
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const eventCount = await db
      .prepare('SELECT COUNT(*) as count FROM event_library WHERE department_id = ?')
      .get(id) as { count: number | string }

    if (Number(eventCount.count) > 0) {
      return res.status(400).json({
        success: false,
        message: `无法删除,该部门关联了 ${eventCount.count} 个事件`,
      })
    }

    const result = await db.prepare('DELETE FROM government_departments WHERE id = ?').run(id)
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: '部门不存在' })
    }

    res.json({ success: true, message: '部门删除成功' })
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
