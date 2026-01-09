import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import type { EventBlock, BlockCategory } from '../types/database.js'

const router = Router()

// 获取板块分类（必须在 /:id 路由之前）
router.get('/categories', requireAuth, (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM block_categories WHERE is_active = 1 ORDER BY sort_order').all() as BlockCategory[]

    res.json({
      success: true,
      data: categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sort_order,
      })),
    })
  } catch (error) {
    console.error('获取分类失败:', error)
    res.status(500).json({ success: false, message: '获取分类失败' })
  }
})

// 获取所有板块
router.get('/', requireAuth, (req, res) => {
  try {
    interface BlockWithCategory extends EventBlock {
      category_name?: string
    }
    const blocks = db.prepare(`
      SELECT eb.*, bc.name as category_name
      FROM event_blocks eb
      LEFT JOIN block_categories bc ON eb.category_id = bc.id
      ORDER BY eb.created_at DESC
    `).all() as BlockWithCategory[]

    const result = blocks.map((block) => ({
      id: block.id,
      name: block.name,
      categoryId: block.category_id,
      categoryName: block.category_name,
      description: block.description,
      events: block.events_json ? JSON.parse(block.events_json) : [],
      createdAt: block.created_at,
      updatedAt: block.updated_at,
    }))

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('获取板块列表失败:', error)
    res.status(500).json({ success: false, message: '获取板块列表失败' })
  }
})

// 获取单个板块
router.get('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const block = db.prepare('SELECT * FROM event_blocks WHERE id = ?').get(id) as EventBlock | undefined

    if (!block) {
      return res.status(404).json({ success: false, message: '板块不存在' })
    }

    res.json({
      success: true,
      data: {
        id: block.id,
        name: block.name,
        categoryId: block.category_id,
        description: block.description,
        events: block.events_json ? JSON.parse(block.events_json) : [],
        createdAt: block.created_at,
        updatedAt: block.updated_at,
      },
    })
  } catch (error) {
    console.error('获取板块详情失败:', error)
    res.status(500).json({ success: false, message: '获取板块详情失败' })
  }
})

// 创建板块
router.post('/', requireAuth, (req, res) => {
  try {
    const { name, categoryId, description, events } = req.body
    const id = nanoid()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO event_blocks (id, name, category_id, description, events_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, categoryId, description || null, JSON.stringify(events || []), now, now)

    res.json({ success: true, data: { id } })
  } catch (error) {
    console.error('创建板块失败:', error)
    res.status(500).json({ success: false, message: '创建板块失败' })
  }
})

// 更新板块
router.put('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const { name, categoryId, description, events } = req.body
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE event_blocks
      SET name = ?, category_id = ?, description = ?, events_json = ?, updated_at = ?
      WHERE id = ?
    `).run(name, categoryId, description || null, JSON.stringify(events || []), now, id)

    res.json({ success: true })
  } catch (error) {
    console.error('更新板块失败:', error)
    res.status(500).json({ success: false, message: '更新板块失败' })
  }
})

// 删除板块
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    db.prepare('DELETE FROM event_blocks WHERE id = ?').run(id)
    res.json({ success: true })
  } catch (error) {
    console.error('删除板块失败:', error)
    res.status(500).json({ success: false, message: '删除板块失败' })
  }
})

export default router
