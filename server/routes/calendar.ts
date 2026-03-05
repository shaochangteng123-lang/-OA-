import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import type { CalendarEvent } from '../types/database.js'

const router = Router()

// 获取所有日历事件
router.get('/events', requireAuth, (req, res) => {
  try {
    const currentUserId = req.session?.userId
    const { start, end, userId: requestedUserId } = req.query

    // 确定目标用户ID
    let targetUserId = currentUserId

    // 如果请求查看其他用户的日历
    if (requestedUserId && requestedUserId !== currentUserId) {
      // 检查权限：只有 super_admin 和 admin 可以查看他人日历
      const currentUser = db
        .prepare('SELECT role FROM users WHERE id = ?')
        .get(currentUserId) as { role: string } | undefined

      if (!currentUser || !['super_admin', 'admin'].includes(currentUser.role)) {
        return res.status(403).json({
          success: false,
          message: '无权查看他人日历',
        })
      }

      targetUserId = String(requestedUserId)
    }

    let query = 'SELECT * FROM calendar_events WHERE user_id = ?'
    const params: (string | undefined)[] = [targetUserId]

    if (start && end) {
      query += ' AND start_time >= ? AND end_time <= ?'
      params.push(String(start), String(end))
    }

    query += ' ORDER BY start_time ASC'

    const events = db.prepare(query).all(...params) as CalendarEvent[]

    const result = events.map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      startTime: event.start_time,
      endTime: event.end_time,
      allDay: event.all_day === 1,
      location: event.location,
      color: event.color,
      reminderMinutes: event.reminder_minutes,
      recurrenceRule: event.recurrence_rule,
      userId: event.user_id,
      createdAt: event.created_at,
      updatedAt: event.updated_at,
    }))

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('获取日历事件失败:', error)
    res.status(500).json({ success: false, message: '获取日历事件失败' })
  }
})

// 获取单个事件
router.get('/events/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session?.userId

    const event = db.prepare('SELECT * FROM calendar_events WHERE id = ? AND user_id = ?').get(id, userId) as CalendarEvent | undefined

    if (!event) {
      return res.status(404).json({ success: false, message: '事件不存在' })
    }

    res.json({
      success: true,
      data: {
        id: event.id,
        title: event.title,
        description: event.description,
        startTime: event.start_time,
        endTime: event.end_time,
        allDay: event.all_day === 1,
        location: event.location,
        color: event.color,
        reminderMinutes: event.reminder_minutes,
        recurrenceRule: event.recurrence_rule,
        createdAt: event.created_at,
        updatedAt: event.updated_at,
      },
    })
  } catch (error) {
    console.error('获取事件详情失败:', error)
    res.status(500).json({ success: false, message: '获取事件详情失败' })
  }
})

// 创建日历事件
router.post('/events', requireAuth, (req, res) => {
  try {
    const userId = req.session?.userId
    const {
      title,
      description,
      startTime,
      endTime,
      allDay,
      location,
      color,
      reminderMinutes,
      recurrenceRule,
    } = req.body

    const id = nanoid()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO calendar_events (
        id, title, description, start_time, end_time, all_day,
        location, color, reminder_minutes, recurrence_rule,
        user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      description || null,
      startTime,
      endTime,
      allDay ? 1 : 0,
      location || null,
      color || '#3b82f6',
      reminderMinutes || null,
      recurrenceRule || null,
      userId,
      now,
      now
    )

    res.json({ success: true, data: { id } })
  } catch (error) {
    console.error('创建日历事件失败:', error)
    res.status(500).json({ success: false, message: '创建日历事件失败' })
  }
})

// 更新日历事件
router.put('/events/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session?.userId
    const {
      title,
      description,
      startTime,
      endTime,
      allDay,
      location,
      color,
      reminderMinutes,
      recurrenceRule,
    } = req.body

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE calendar_events
      SET title = ?, description = ?, start_time = ?, end_time = ?, all_day = ?,
          location = ?, color = ?, reminder_minutes = ?, recurrence_rule = ?,
          updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      title,
      description || null,
      startTime,
      endTime,
      allDay ? 1 : 0,
      location || null,
      color || '#3b82f6',
      reminderMinutes || null,
      recurrenceRule || null,
      now,
      id,
      userId
    )

    res.json({ success: true })
  } catch (error) {
    console.error('更新日历事件失败:', error)
    res.status(500).json({ success: false, message: '更新日历事件失败' })
  }
})

// 删除日历事件
router.delete('/events/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session?.userId

    db.prepare('DELETE FROM calendar_events WHERE id = ? AND user_id = ?').run(id, userId)
    res.json({ success: true })
  } catch (error) {
    console.error('删除日历事件失败:', error)
    res.status(500).json({ success: false, message: '删除日历事件失败' })
  }
})

export default router
