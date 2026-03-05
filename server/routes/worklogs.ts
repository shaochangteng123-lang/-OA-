import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import { syncWorklogToNotion } from '../services/notion.js'
import type { WorkLog } from '../types/database.js'

const router = Router()

// 获取所有工作日志
router.get('/', requireAuth, (req, res) => {
  try {
    const userId = req.session?.userId
    const { startDate, endDate } = req.query

    let query = 'SELECT * FROM worklogs WHERE user_id = ?'
    const params: (string | undefined)[] = [userId]

    if (startDate && endDate) {
      query += ' AND date >= ? AND date <= ?'
      params.push(String(startDate), String(endDate))
    }

    query += ' ORDER BY date DESC'

    const worklogs = db.prepare(query).all(...params) as WorkLog[]

    const result = worklogs.map((log) => ({
      id: log.id,
      date: log.date,
      title: log.title,
      content: log.overall_content, // 前端使用content字段
      overallContent: log.overall_content, // 保持向后兼容
      projects: log.projects_json ? JSON.parse(log.projects_json) : [],
      createdAt: log.created_at,
      updatedAt: log.updated_at,
    }))

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('获取工作日志失败:', error)
    res.status(500).json({ success: false, message: '获取工作日志失败' })
  }
})

// 获取指定日期的工作日志
router.get('/:date', requireAuth, (req, res) => {
  try {
    const { date } = req.params
    const userId = req.session?.userId

    const worklog = db.prepare('SELECT * FROM worklogs WHERE date = ? AND user_id = ?').get(date, userId) as WorkLog | undefined

    if (!worklog) {
      return res.json({
        success: true,
        data: null,
      })
    }

    res.json({
      success: true,
      data: {
        id: worklog.id,
        date: worklog.date,
        title: worklog.title,
        content: worklog.overall_content, // 前端使用content字段
        overallContent: worklog.overall_content, // 保持向后兼容
        projects: worklog.projects_json ? JSON.parse(worklog.projects_json) : [],
        createdAt: worklog.created_at,
        updatedAt: worklog.updated_at,
      },
    })
  } catch (error) {
    console.error('获取工作日志失败:', error)
    res.status(500).json({ success: false, message: '获取工作日志失败' })
  }
})

// 创建或更新工作日志
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId
    // 支持content字段（前端发送）和overallContent字段（向后兼容）
    const { date, title, content, overallContent, projects } = req.body
    const finalContent = content || overallContent || ''

    // 检查是否已存在
    const existing = db.prepare('SELECT id, notion_page_id FROM worklogs WHERE date = ? AND user_id = ?').get(date, userId) as
      | { id: string; notion_page_id: string | null }
      | undefined

    const now = new Date().toISOString()
    let notionPageId: string | null = null

    // 同步到Notion（异步执行，不阻塞保存）
    try {
      notionPageId = await syncWorklogToNotion(
        date,
        title || '工作日志',
        finalContent,
        projects || [],
        existing?.notion_page_id || undefined
      )

      if (notionPageId) {
        console.log(`✅ 工作日志已同步到Notion: ${date}, page_id: ${notionPageId}`)
      }
    } catch (notionError) {
      // Notion同步失败不影响本地保存
      console.error('⚠️  Notion同步失败（不影响本地保存）:', notionError)
    }

    if (existing) {
      // 更新
      db.prepare(`
        UPDATE worklogs
        SET title = ?, overall_content = ?, projects_json = ?, updated_at = ?, notion_page_id = ?
        WHERE id = ?
      `).run(title, finalContent, JSON.stringify(projects || []), now, notionPageId || existing.notion_page_id, existing.id)

      res.json({ success: true, data: { id: existing.id } })
    } else {
      // 创建
      const id = nanoid()

      db.prepare(`
        INSERT INTO worklogs (id, date, title, overall_content, projects_json, user_id, notion_page_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, date, title, finalContent, JSON.stringify(projects || []), userId, notionPageId, now, now)

      res.json({ success: true, data: { id } })
    }
  } catch (error) {
    console.error('保存工作日志失败:', error)
    res.status(500).json({ success: false, message: '保存工作日志失败' })
  }
})

// 更新工作日志
router.put('/:date', requireAuth, (req, res) => {
  try {
    const { date } = req.params
    const userId = req.session?.userId
    const { title, overallContent, projects } = req.body

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE worklogs
      SET title = ?, overall_content = ?, projects_json = ?, updated_at = ?
      WHERE date = ? AND user_id = ?
    `).run(title, overallContent, JSON.stringify(projects || []), now, date, userId)

    res.json({ success: true })
  } catch (error) {
    console.error('更新工作日志失败:', error)
    res.status(500).json({ success: false, message: '更新工作日志失败' })
  }
})

// 删除工作日志
router.delete('/:date', requireAuth, (req, res) => {
  try {
    const { date } = req.params
    const userId = req.session?.userId

    db.prepare('DELETE FROM worklogs WHERE date = ? AND user_id = ?').run(date, userId)
    res.json({ success: true })
  } catch (error) {
    console.error('删除工作日志失败:', error)
    res.status(500).json({ success: false, message: '删除工作日志失败' })
  }
})

export default router
