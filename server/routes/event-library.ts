import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import type { EventLibrary } from '../types/database.js'

const router = Router()

// 获取所有事件
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, eventType } = req.query

    let query = 'SELECT * FROM event_library WHERE 1=1'
    const params: (string | undefined)[] = []

    if (search) {
      query += ' AND (name LIKE ? OR description LIKE ?)'
      params.push(`%${String(search)}%`, `%${String(search)}%`)
    }

    if (eventType) {
      query += ' AND event_type = ?'
      params.push(String(eventType))
    }

    query += ' ORDER BY created_at DESC'

    const events = await db.prepare(query).all(...params) as EventLibrary[]

    const result = events.map((event) => ({
      id: event.id,
      name: event.name,
      description: event.description,
      eventType: event.event_type,
      level: event.level,
      standardDuration: event.standard_duration,
      dependencies: event.dependencies,
      createdAt: event.created_at,
      updatedAt: event.updated_at,
    }))

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('获取事件库失败:', error)
    res.status(500).json({ success: false, message: '获取事件库失败' })
  }
})

// 获取单个事件
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const event = await db.prepare('SELECT * FROM event_library WHERE id = ?').get(id) as EventLibrary | undefined

    if (!event) {
      return res.status(404).json({ success: false, message: '事件不存在' })
    }

    res.json({
      success: true,
      data: {
        id: event.id,
        name: event.name,
        description: event.description,
        eventType: event.event_type,
        level: event.level,
        standardDuration: event.standard_duration,
        dependencies: event.dependencies,
        createdAt: event.created_at,
        updatedAt: event.updated_at,
      },
    })
  } catch (error) {
    console.error('获取事件详情失败:', error)
    res.status(500).json({ success: false, message: '获取事件详情失败' })
  }
})

// 创建事件
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, eventType, description, standardDuration } = req.body
    const id = nanoid()
    const now = new Date().toISOString()

    await db.prepare(`
      INSERT INTO event_library (id, name, event_type, description, level, standard_duration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, eventType, description || null, 1, standardDuration || null, now, now)

    res.json({ success: true, data: { id } })
  } catch (error) {
    console.error('创建事件失败:', error)
    res.status(500).json({ success: false, message: '创建事件失败' })
  }
})

// 更新事件
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { name, eventType, description, standardDuration } = req.body
    const now = new Date().toISOString()

    await db.prepare(`
      UPDATE event_library
      SET name = ?, event_type = ?, description = ?, standard_duration = ?, updated_at = ?
      WHERE id = ?
    `).run(name, eventType, description || null, standardDuration || null, now, id)

    res.json({ success: true })
  } catch (error) {
    console.error('更新事件失败:', error)
    res.status(500).json({ success: false, message: '更新事件失败' })
  }
})

// 删除事件
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    await db.prepare('DELETE FROM event_library WHERE id = ?').run(id)
    res.json({ success: true })
  } catch (error) {
    console.error('删除事件失败:', error)
    res.status(500).json({ success: false, message: '删除事件失败' })
  }
})

export default router
