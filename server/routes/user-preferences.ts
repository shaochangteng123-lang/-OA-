import express from 'express'
import { db } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import type { UserPreferencesRow } from '../types/database.js'

const router = express.Router()

// 默认颜色标签
const DEFAULT_COLOR_LABELS = [
  { id: 'label-1', name: '工作', color: '#3b82f6', order: 0 },
  { id: 'label-2', name: '重要', color: '#f59e0b', order: 1 },
  { id: 'label-3', name: '警示', color: '#ef4444', order: 2 },
  { id: 'label-4', name: '个人', color: '#10b981', order: 3 },
  { id: 'label-5', name: '生日', color: '#8b5cf6', order: 4 },
]

// 获取颜色偏好
router.get('/colors', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId

    const preferences = db
      .prepare('SELECT event_colors, color_labels FROM user_preferences WHERE user_id = ?')
      .get(userId) as UserPreferencesRow | undefined

    let eventColors = null
    let colorLabels = null

    if (preferences) {
      eventColors = preferences.event_colors ? JSON.parse(JSON.stringify(preferences.event_colors)) : null
      colorLabels = preferences.color_labels ? JSON.parse(JSON.stringify(preferences.color_labels)) : null
    }

    res.json({
      success: true,
      data: {
        eventColors,
        colorLabels,
      },
    })
  } catch (error) {
    console.error('获取颜色偏好失败:', error)
    res.status(500).json({
      success: false,
      message: '获取颜色偏好失败',
      error:
        process.env.NODE_ENV === 'development'
          ? error instanceof Error
            ? error.message
            : String(error)
          : undefined,
    })
  }
})

// 保存颜色偏好
router.put('/colors', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId
    const { eventColors, colorLabels } = req.body

    // 检查是否存在偏好记录
    const existing = db
      .prepare('SELECT user_id FROM user_preferences WHERE user_id = ?')
      .get(userId)

    if (existing) {
      // 更新现有记录
      db.prepare(
        `
        UPDATE user_preferences
        SET event_colors = ?, color_labels = ?
        WHERE user_id = ?
      `
      ).run(JSON.stringify(eventColors), JSON.stringify(colorLabels), userId)
    } else {
      // 创建新记录
      db.prepare(
        `
        INSERT INTO user_preferences (user_id, event_colors, color_labels)
        VALUES (?, ?, ?)
      `
      ).run(userId, JSON.stringify(eventColors), JSON.stringify(colorLabels))
    }

    res.json({
      success: true,
      message: '颜色偏好保存成功',
    })
  } catch (error) {
    console.error('保存颜色偏好失败:', error)
    res.status(500).json({
      success: false,
      message: '保存颜色偏好失败',
      error:
        process.env.NODE_ENV === 'development'
          ? error instanceof Error
            ? error.message
            : String(error)
          : undefined,
    })
  }
})

// 获取所有用户偏好设置（日历模块使用）
router.get('/', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId

    const preferences = db
      .prepare('SELECT * FROM user_preferences WHERE user_id = ?')
      .get(userId) as UserPreferencesRow | undefined

    let colorLabels = DEFAULT_COLOR_LABELS
    let calendarViewMode = 'week'
    let weekDisplayDays = 7

    if (preferences) {
      if (preferences.color_labels) {
        try {
          colorLabels = JSON.parse(preferences.color_labels as string)
        } catch (e) {
          console.error('解析 color_labels 失败:', e)
        }
      }
      if (preferences.calendar_view_mode) {
        calendarViewMode = preferences.calendar_view_mode
      }
      if (preferences.week_display_days !== null && preferences.week_display_days !== undefined) {
        weekDisplayDays = preferences.week_display_days
      }
    }

    res.json({
      success: true,
      data: {
        colorLabels,
        calendarViewMode,
        weekDisplayDays,
      },
    })
  } catch (error) {
    console.error('获取用户偏好失败:', error)
    res.status(500).json({
      success: false,
      message: '获取用户偏好失败',
      error:
        process.env.NODE_ENV === 'development'
          ? error instanceof Error
            ? error.message
            : String(error)
          : undefined,
    })
  }
})

// 更新用户偏好设置（日历模块使用）
router.put('/', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId
    const { colorLabels, calendarViewMode, weekDisplayDays } = req.body

    // 检查是否存在偏好记录
    const existing = db
      .prepare('SELECT user_id FROM user_preferences WHERE user_id = ?')
      .get(userId)

    if (existing) {
      // 更新现有记录（只更新提供的字段）
      const updates: string[] = []
      const values: any[] = []

      if (colorLabels !== undefined) {
        updates.push('color_labels = ?')
        values.push(JSON.stringify(colorLabels))
      }
      if (calendarViewMode !== undefined) {
        updates.push('calendar_view_mode = ?')
        values.push(calendarViewMode)
      }
      if (weekDisplayDays !== undefined) {
        updates.push('week_display_days = ?')
        values.push(weekDisplayDays)
      }

      if (updates.length > 0) {
        values.push(userId)
        db.prepare(
          `UPDATE user_preferences SET ${updates.join(', ')} WHERE user_id = ?`
        ).run(...values)
      }
    } else {
      // 创建新记录
      db.prepare(
        `
        INSERT INTO user_preferences (
          user_id, color_labels, calendar_view_mode, week_display_days
        )
        VALUES (?, ?, ?, ?)
      `
      ).run(
        userId,
        colorLabels ? JSON.stringify(colorLabels) : JSON.stringify(DEFAULT_COLOR_LABELS),
        calendarViewMode || 'week',
        weekDisplayDays !== undefined ? weekDisplayDays : 7
      )
    }

    res.json({
      success: true,
      message: '用户偏好设置保存成功',
    })
  } catch (error) {
    console.error('保存用户偏好失败:', error)
    res.status(500).json({
      success: false,
      message: '保存用户偏好失败',
      error:
        process.env.NODE_ENV === 'development'
          ? error instanceof Error
            ? error.message
            : String(error)
          : undefined,
    })
  }
})

// 重置颜色标签为默认值
router.post('/reset-labels', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId

    // 检查是否存在偏好记录
    const existing = db
      .prepare('SELECT user_id FROM user_preferences WHERE user_id = ?')
      .get(userId)

    if (existing) {
      // 更新现有记录
      db.prepare(
        `UPDATE user_preferences SET color_labels = ? WHERE user_id = ?`
      ).run(JSON.stringify(DEFAULT_COLOR_LABELS), userId)
    } else {
      // 创建新记录
      db.prepare(
        `
        INSERT INTO user_preferences (user_id, color_labels)
        VALUES (?, ?)
      `
      ).run(userId, JSON.stringify(DEFAULT_COLOR_LABELS))
    }

    res.json({
      success: true,
      message: '已恢复默认颜色标签',
      data: DEFAULT_COLOR_LABELS,
    })
  } catch (error) {
    console.error('重置颜色标签失败:', error)
    res.status(500).json({
      success: false,
      message: '重置颜色标签失败',
      error:
        process.env.NODE_ENV === 'development'
          ? error instanceof Error
            ? error.message
            : String(error)
          : undefined,
    })
  }
})

export default router
