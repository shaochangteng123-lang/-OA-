import { Router } from 'express'
import { nanoid } from 'nanoid'
import { requireAuth, requireAdmin } from '../middleware/auth.js'

const router = Router()

type WelfareOneExpenseCategoryRow = {
  id: string
  code: string
  name: string
  sort_order: number
  is_active: boolean
  created_at?: string
  updated_at?: string
}

function toWelfareOneExpenseCategory(row: WelfareOneExpenseCategoryRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    value: row.id,
    children: [],
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeWelfareCategoryName(value: unknown): string {
  return String(value || '').normalize('NFKC').trim()
}

function normalizeWelfareCategoryCode(value: unknown): string | null {
  const code = String(value || '').normalize('NFKC').trim().toLowerCase()
  if (!code) return null
  return /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : null
}

router.get('/list', requireAuth, async (_req, res) => {
  try {
    const { db } = await import('../db/index.js')
    const scopes = await db.prepare(`
      SELECT id, parent_id, name, value, sort_order, is_active
      FROM reimbursement_scopes
      WHERE is_active = TRUE
      ORDER BY sort_order ASC
    `).all()

    const buildTree = (items: any[], parentId: string | null = null): any[] =>
      items
        .filter((item) => item.parent_id === parentId)
        .map((item) => ({ ...item, children: buildTree(items, item.id) }))

    res.json({ success: true, data: buildTree(scopes) })
  } catch (error) {
    console.error('获取报销范围列表失败:', error)
    res.status(500).json({ success: false, message: '获取报销范围列表失败' })
  }
})

router.get('/admin/list', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { db } = await import('../db/index.js')
    const scopes = await db.prepare(`
      SELECT id, parent_id, name, value, sort_order, is_active, created_at, updated_at
      FROM reimbursement_scopes
      ORDER BY sort_order ASC
    `).all()

    const buildTree = (items: any[], parentId: string | null = null): any[] =>
      items
        .filter((item) => item.parent_id === parentId)
        .map((item) => ({ ...item, children: buildTree(items, item.id) }))

    res.json({ success: true, data: buildTree(scopes) })
  } catch (error) {
    console.error('获取报销范围管理列表失败:', error)
    res.status(500).json({ success: false, message: '获取报销范围管理列表失败' })
  }
})

router.post('/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { parentId, name, value } = req.body
    if (!name || !value) {
      return res.status(400).json({ success: false, message: '名称和值不能为空' })
    }

    const { db } = await import('../db/index.js')
    let maxSort: { max_sort: number | null }

    if (parentId) {
      maxSort = await db.prepare(`
        SELECT MAX(sort_order) as max_sort
        FROM reimbursement_scopes
        WHERE parent_id = ?
      `).get(parentId) as { max_sort: number | null }
    } else {
      maxSort = await db.prepare(`
        SELECT MAX(sort_order) as max_sort
        FROM reimbursement_scopes
        WHERE parent_id IS NULL
      `).get() as { max_sort: number | null }
    }

    const sortOrder = (maxSort.max_sort || 0) + 1
    const id = nanoid()
    const now = new Date().toISOString()

    await db.prepare(`
      INSERT INTO reimbursement_scopes (id, parent_id, name, value, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, parentId || null, name, value, sortOrder, true, now, now)

    res.json({ success: true, data: { id, parentId, name, value, sortOrder } })
  } catch (error) {
    console.error('创建报销范围失败:', error)
    res.status(500).json({ success: false, message: '创建报销范围失败' })
  }
})

router.put('/sort', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { items } = req.body as { items: Array<{ id: string; sortOrder: number }> }
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ success: false, message: '参数错误' })
    }

    const { db } = await import('../db/index.js')
    const now = new Date().toISOString()
    const updateStmt = db.prepare(`
      UPDATE reimbursement_scopes
      SET sort_order = ?, updated_at = ?
      WHERE id = ?
    `)

    for (const item of items) {
      await updateStmt.run(item.sortOrder, now, item.id)
    }

    res.json({ success: true, message: '排序更新成功' })
  } catch (error) {
    console.error('更新排序失败:', error)
    res.status(500).json({ success: false, message: '更新排序失败' })
  }
})

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { name, value, isActive } = req.body
    if (!name || !value) {
      return res.status(400).json({ success: false, message: '名称和值不能为空' })
    }

    const { db } = await import('../db/index.js')
    const now = new Date().toISOString()
    await db.prepare(`
      UPDATE reimbursement_scopes
      SET name = ?, value = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(name, value, Boolean(isActive), now, id)

    res.json({ success: true, message: '更新成功' })
  } catch (error) {
    console.error('更新报销范围失败:', error)
    res.status(500).json({ success: false, message: '更新报销范围失败' })
  }
})

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { db } = await import('../db/index.js')
    const children = await db.prepare(`
      SELECT COUNT(*) as count
      FROM reimbursement_scopes
      WHERE parent_id = ?
    `).get(id) as { count: number | string }

    if (Number(children.count) > 0) {
      return res.status(400).json({ success: false, message: '该项下有子项，无法删除' })
    }

    await db.prepare('DELETE FROM reimbursement_scopes WHERE id = ?').run(id)
    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('删除报销范围失败:', error)
    res.status(500).json({ success: false, message: '删除报销范围失败' })
  }
})

router.get('/welfare-one/list', requireAuth, async (_req, res) => {
  try {
    const { db } = await import('../db/index.js')
    const rows = await db.prepare(`
      SELECT id, code, name, sort_order, is_active
      FROM welfare_one_expense_categories
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, id ASC
    `).all() as WelfareOneExpenseCategoryRow[]

    res.json({ success: true, data: rows.map(toWelfareOneExpenseCategory) })
  } catch (error) {
    console.error('获取福利账户一报销范围失败:', error)
    res.status(500).json({ success: false, message: '获取福利账户一报销范围失败' })
  }
})

router.get('/welfare-one/admin/list', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { db } = await import('../db/index.js')
    const rows = await db.prepare(`
      SELECT id, code, name, sort_order, is_active, created_at, updated_at
      FROM welfare_one_expense_categories
      ORDER BY sort_order ASC, id ASC
    `).all() as WelfareOneExpenseCategoryRow[]

    res.json({ success: true, data: rows.map(toWelfareOneExpenseCategory) })
  } catch (error) {
    console.error('获取福利账户一报销范围管理列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取福利账户一报销范围管理列表失败',
    })
  }
})

router.post('/welfare-one/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = normalizeWelfareCategoryName(req.body?.name)
    if (!name || name.length > 100) {
      return res.status(400).json({ success: false, message: '名称不能为空且不能超过100个字符' })
    }

    const submittedCode = req.body?.code
    const code = submittedCode
      ? normalizeWelfareCategoryCode(submittedCode)
      : `custom_${nanoid(12).toLowerCase()}`
    if (!code) {
      return res.status(400).json({
        success: false,
        message: '代码必须以小写字母开头，且只能包含小写字母、数字和下划线',
      })
    }

    const { db } = await import('../db/index.js')
    const duplicate = await db.prepare(`
      SELECT id FROM welfare_one_expense_categories
      WHERE code = ? OR name = ?
      LIMIT 1
    `).get(code, name) as { id: string } | undefined
    if (duplicate) {
      return res.status(409).json({ success: false, message: '报销范围名称或代码已存在' })
    }

    const maxSort = await db.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) AS max_sort
      FROM welfare_one_expense_categories
    `).get() as { max_sort: number }
    const id = `welfare_one_${nanoid(16)}`
    const now = new Date().toISOString()
    const sortOrder = Number(maxSort.max_sort || 0) + 1
    await db.prepare(`
      INSERT INTO welfare_one_expense_categories
        (id, code, name, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, TRUE, ?, ?)
    `).run(id, code, name, sortOrder, now, now)

    res.status(201).json({
      success: true,
      data: { id, code, name, sortOrder, isActive: true, createdAt: now, updatedAt: now },
    })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return res.status(409).json({ success: false, message: '报销范围名称或代码已存在' })
    }
    console.error('创建福利账户一报销范围失败:', error)
    res.status(500).json({ success: false, message: '创建福利账户一报销范围失败' })
  }
})

router.put('/welfare-one/sort', requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = req.body?.items as Array<{ id?: unknown; sortOrder?: unknown }> | undefined
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: '排序数据不能为空' })
    }
    const normalizedItems = items.map((item) => ({
      id: String(item?.id || '').trim(),
      sortOrder: Number(item?.sortOrder),
    }))
    if (
      normalizedItems.some((item) => !item.id || !Number.isInteger(item.sortOrder) || item.sortOrder < 0)
      || new Set(normalizedItems.map((item) => item.id)).size !== normalizedItems.length
    ) {
      return res.status(400).json({ success: false, message: '排序数据无效' })
    }

    const { db } = await import('../db/index.js')
    const now = new Date().toISOString()
    await db.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM welfare_one_expense_categories
         WHERE id = ANY($1::text[]) FOR UPDATE`,
        [normalizedItems.map((item) => item.id)],
      )
      if (result.rowCount !== normalizedItems.length) {
        throw new Error('部分报销范围不存在')
      }
      for (const item of normalizedItems) {
        await client.query(
          `UPDATE welfare_one_expense_categories
           SET sort_order = $1, updated_at = $2 WHERE id = $3`,
          [item.sortOrder, now, item.id],
        )
      }
    })

    res.json({ success: true, message: '排序更新成功' })
  } catch (error) {
    console.error('更新福利账户一报销范围排序失败:', error)
    res.status(500).json({ success: false, message: '更新福利账户一报销范围排序失败' })
  }
})

router.put('/welfare-one/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = normalizeWelfareCategoryName(req.body?.name)
    if (!name || name.length > 100) {
      return res.status(400).json({ success: false, message: '名称不能为空且不能超过100个字符' })
    }
    const isActive = req.body?.isActive
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: '启用状态无效' })
    }

    const { db } = await import('../db/index.js')
    const duplicate = await db.prepare(`
      SELECT id FROM welfare_one_expense_categories
      WHERE name = ? AND id <> ?
      LIMIT 1
    `).get(name, req.params.id) as { id: string } | undefined
    if (duplicate) {
      return res.status(409).json({ success: false, message: '报销范围名称已存在' })
    }
    const now = new Date().toISOString()
    const result = await db.prepare(`
      UPDATE welfare_one_expense_categories
      SET name = ?, is_active = COALESCE(?, is_active), updated_at = ?
      WHERE id = ?
    `).run(name, isActive ?? null, now, req.params.id)
    if (result.changes !== 1) {
      return res.status(404).json({ success: false, message: '报销范围不存在' })
    }

    res.json({ success: true, message: '更新成功' })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return res.status(409).json({ success: false, message: '报销范围名称已存在' })
    }
    console.error('更新福利账户一报销范围失败:', error)
    res.status(500).json({ success: false, message: '更新福利账户一报销范围失败' })
  }
})

router.delete('/welfare-one/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { db } = await import('../db/index.js')
    const now = new Date().toISOString()
    const outcome = await db.transaction(async (client) => {
      const category = await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM welfare_one_expense_categories WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      )
      const row = category.rows[0]
      if (!row) return { status: 'missing' as const }
      const references = await client.query<{
        reimbursement_count: number
        manual_item_count: number
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM reimbursements
             WHERE welfare_category_id = $1) AS reimbursement_count,
           (SELECT COUNT(*)::int FROM monthly_financial_manual_items
             WHERE welfare_category_id = $1
                OR ($2 = 'drinking_water' AND category = 'welfare_one_drinking_water')
                OR ($2 = 'office' AND category IN ('welfare_one_office', 'welfare_one_407'))
                OR ($2 = 'electricity' AND category = 'welfare_one_electricity')
                OR ($2 = '407_ai' AND category = 'welfare_one_407_ai')
                OR ($2 = '8h_ai' AND category = 'welfare_one_8h_ai')) AS manual_item_count`,
        [row.id, row.code],
      )
      const reimbursementCount = Number(references.rows[0]?.reimbursement_count || 0)
      const manualItemCount = Number(references.rows[0]?.manual_item_count || 0)
      if (reimbursementCount > 0 || manualItemCount > 0) {
        return { status: 'in_use' as const, reimbursementCount, manualItemCount }
      }
      await client.query(
        `INSERT INTO welfare_expense_category_tombstones(account_code, code, deleted_at)
         VALUES('welfare_one', $1, $2)
         ON CONFLICT(account_code, code) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
        [row.code, now],
      )
      await client.query(`DELETE FROM welfare_one_expense_categories WHERE id = $1`, [row.id])
      return { status: 'deleted' as const }
    })

    if (outcome.status === 'missing') {
      return res.status(404).json({ success: false, message: '报销范围不存在' })
    }
    if (outcome.status === 'in_use') {
      return res.status(409).json({
        success: false,
        code: 'WELFARE_ONE_CATEGORY_IN_USE',
        message: '该报销范围已有历史报销或月报手工记录，不能删除；如不再使用，请将其停用',
        data: {
          reimbursementCount: outcome.reimbursementCount,
          manualItemCount: outcome.manualItemCount,
        },
      })
    }
    res.json({ success: true, message: '报销范围已删除' })
  } catch (error) {
    if ((error as { code?: string }).code === '23503') {
      return res.status(409).json({
        success: false,
        code: 'WELFARE_ONE_CATEGORY_IN_USE',
        message: '该报销范围已被使用，不能删除；如不再使用，请将其停用',
      })
    }
    console.error('删除福利账户一报销范围失败:', error)
    res.status(500).json({ success: false, message: '删除福利账户一报销范围失败' })
  }
})

router.get('/welfare-two/list', requireAuth, async (_req, res) => {
  try {
    const { db } = await import('../db/index.js')
    const rows = await db.prepare(`
      SELECT id, code, name, sort_order, is_active
      FROM welfare_two_expense_categories
      WHERE is_active = TRUE
      ORDER BY sort_order ASC, id ASC
    `).all() as WelfareOneExpenseCategoryRow[]

    res.json({ success: true, data: rows.map(toWelfareOneExpenseCategory) })
  } catch (error) {
    console.error('获取福利账户二报销范围失败:', error)
    res.status(500).json({ success: false, message: '获取福利账户二报销范围失败' })
  }
})

router.get('/welfare-two/admin/list', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { db } = await import('../db/index.js')
    const rows = await db.prepare(`
      SELECT id, code, name, sort_order, is_active, created_at, updated_at
      FROM welfare_two_expense_categories
      ORDER BY sort_order ASC, id ASC
    `).all() as WelfareOneExpenseCategoryRow[]

    res.json({ success: true, data: rows.map(toWelfareOneExpenseCategory) })
  } catch (error) {
    console.error('获取福利账户二报销范围管理列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取福利账户二报销范围管理列表失败',
    })
  }
})

router.post('/welfare-two/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = normalizeWelfareCategoryName(req.body?.name)
    if (!name || name.length > 100) {
      return res.status(400).json({ success: false, message: '名称不能为空且不能超过100个字符' })
    }
    const submittedCode = req.body?.code
    const code = submittedCode
      ? normalizeWelfareCategoryCode(submittedCode)
      : `custom_${nanoid(12).toLowerCase()}`
    if (!code) {
      return res.status(400).json({
        success: false,
        message: '代码必须以小写字母开头，且只能包含小写字母、数字和下划线',
      })
    }

    const { db } = await import('../db/index.js')
    const duplicate = await db.prepare(`
      SELECT id FROM welfare_two_expense_categories
      WHERE code = ? OR LOWER(BTRIM(name)) = LOWER(BTRIM(?))
      LIMIT 1
    `).get(code, name) as { id: string } | undefined
    if (duplicate) {
      return res.status(409).json({ success: false, message: '报销范围名称或代码已存在' })
    }
    const maxSort = await db.prepare(`
      SELECT COALESCE(MAX(sort_order), 0) AS max_sort
      FROM welfare_two_expense_categories
    `).get() as { max_sort: number }
    const id = `welfare_two_${nanoid(16)}`
    const now = new Date().toISOString()
    const sortOrder = Number(maxSort.max_sort || 0) + 1
    await db.prepare(`
      INSERT INTO welfare_two_expense_categories
        (id, code, name, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, TRUE, ?, ?)
    `).run(id, code, name, sortOrder, now, now)

    res.status(201).json({
      success: true,
      data: {
        id,
        code,
        name,
        value: id,
        children: [],
        sortOrder,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return res.status(409).json({ success: false, message: '报销范围名称或代码已存在' })
    }
    console.error('创建福利账户二报销范围失败:', error)
    res.status(500).json({ success: false, message: '创建福利账户二报销范围失败' })
  }
})

router.put('/welfare-two/sort', requireAuth, requireAdmin, async (req, res) => {
  try {
    const items = req.body?.items as Array<{ id?: unknown; sortOrder?: unknown }> | undefined
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: '排序数据不能为空' })
    }
    const normalizedItems = items.map((item) => ({
      id: String(item?.id || '').trim(),
      sortOrder: Number(item?.sortOrder),
    }))
    if (
      normalizedItems.some((item) => !item.id || !Number.isInteger(item.sortOrder) || item.sortOrder < 0)
      || new Set(normalizedItems.map((item) => item.id)).size !== normalizedItems.length
    ) {
      return res.status(400).json({ success: false, message: '排序数据无效' })
    }

    const { db } = await import('../db/index.js')
    const now = new Date().toISOString()
    await db.transaction(async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM welfare_two_expense_categories
         WHERE id = ANY($1::text[]) FOR UPDATE`,
        [normalizedItems.map((item) => item.id)],
      )
      if (result.rowCount !== normalizedItems.length) {
        throw new Error('部分报销范围不存在')
      }
      for (const item of normalizedItems) {
        await client.query(
          `UPDATE welfare_two_expense_categories
           SET sort_order = $1, updated_at = $2 WHERE id = $3`,
          [item.sortOrder, now, item.id],
        )
      }
    })
    res.json({ success: true, message: '排序更新成功' })
  } catch (error) {
    console.error('更新福利账户二报销范围排序失败:', error)
    res.status(500).json({ success: false, message: '更新福利账户二报销范围排序失败' })
  }
})

router.put('/welfare-two/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = normalizeWelfareCategoryName(req.body?.name)
    if (!name || name.length > 100) {
      return res.status(400).json({ success: false, message: '名称不能为空且不能超过100个字符' })
    }
    const isActive = req.body?.isActive
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: '启用状态无效' })
    }

    const { db } = await import('../db/index.js')
    const duplicate = await db.prepare(`
      SELECT id FROM welfare_two_expense_categories
      WHERE LOWER(BTRIM(name)) = LOWER(BTRIM(?)) AND id <> ?
      LIMIT 1
    `).get(name, req.params.id) as { id: string } | undefined
    if (duplicate) {
      return res.status(409).json({ success: false, message: '报销范围名称已存在' })
    }
    const now = new Date().toISOString()
    const result = await db.prepare(`
      UPDATE welfare_two_expense_categories
      SET name = ?, is_active = COALESCE(?, is_active), updated_at = ?
      WHERE id = ?
    `).run(name, isActive ?? null, now, req.params.id)
    if (result.changes !== 1) {
      return res.status(404).json({ success: false, message: '报销范围不存在' })
    }
    res.json({ success: true, message: '更新成功' })
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return res.status(409).json({ success: false, message: '报销范围名称已存在' })
    }
    console.error('更新福利账户二报销范围失败:', error)
    res.status(500).json({ success: false, message: '更新福利账户二报销范围失败' })
  }
})

router.delete('/welfare-two/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { db } = await import('../db/index.js')
    const outcome = await db.transaction(async (client) => {
      const category = await client.query<{ id: string; code: string }>(
        `SELECT id, code FROM welfare_two_expense_categories WHERE id = $1 FOR UPDATE`,
        [req.params.id],
      )
      const row = category.rows[0]
      if (!row) return { status: 'missing' as const }

      const references = await client.query<{
        reimbursement_count: number
        manual_item_count: number
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM reimbursements
             WHERE welfare_two_category_id = $1) AS reimbursement_count,
           (SELECT COUNT(*)::int FROM monthly_financial_manual_items
             WHERE welfare_two_category_id = $1
                OR ($2 = 'refreshment' AND category = 'welfare_two_refreshment')
                OR ($2 = 'team_building' AND category = 'welfare_two_team_building')
                OR ($2 = 'physical_exam' AND category = 'welfare_two_physical_exam')) AS manual_item_count`,
        [row.id, row.code],
      )
      const reimbursementCount = Number(references.rows[0]?.reimbursement_count || 0)
      const manualItemCount = Number(references.rows[0]?.manual_item_count || 0)
      if (reimbursementCount > 0 || manualItemCount > 0) {
        return { status: 'in_use' as const, reimbursementCount, manualItemCount }
      }
      await client.query(
        `INSERT INTO welfare_expense_category_tombstones(account_code, code, deleted_at)
         VALUES('welfare_two', $1, $2)
         ON CONFLICT(account_code, code) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
        [row.code, new Date().toISOString()],
      )
      await client.query(
        `DELETE FROM welfare_two_expense_categories WHERE id = $1`,
        [row.id],
      )
      return { status: 'deleted' as const }
    })

    if (outcome.status === 'missing') {
      return res.status(404).json({ success: false, message: '报销范围不存在' })
    }
    if (outcome.status === 'in_use') {
      return res.status(409).json({
        success: false,
        code: 'WELFARE_TWO_CATEGORY_IN_USE',
        message: '该报销范围已有历史报销或月报手工记录，不能删除；如不再使用，请将其停用',
        data: {
          reimbursementCount: outcome.reimbursementCount,
          manualItemCount: outcome.manualItemCount,
        },
      })
    }
    res.json({ success: true, message: '报销范围已删除' })
  } catch (error) {
    if ((error as { code?: string }).code === '23503') {
      return res.status(409).json({
        success: false,
        code: 'WELFARE_TWO_CATEGORY_IN_USE',
        message: '该报销范围已被使用，不能删除；如不再使用，请将其停用',
      })
    }
    console.error('删除福利账户二报销范围失败:', error)
    res.status(500).json({ success: false, message: '删除福利账户二报销范围失败' })
  }
})

export default router
