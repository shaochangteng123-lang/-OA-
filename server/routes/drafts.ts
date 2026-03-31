import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import type { Draft } from '../types/database.js'

const router = Router()

// 获取指定日期的草稿
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId
    const { date } = req.query

    if (!date) {
      return res.status(400).json({ success: false, message: '缺少日期参数' })
    }

    const draft = await db
      .prepare('SELECT * FROM drafts WHERE user_id = ? AND date = ?')
      .get(userId, date) as Draft | undefined

    if (!draft) {
      return res.json({ success: true, data: null })
    }

    const result = {
      id: draft.id,
      userId: draft.user_id,
      date: draft.date,
      pages: draft.pages_json ? JSON.parse(draft.pages_json) : [],
      createdAt: draft.created_at,
      updatedAt: draft.updated_at,
    }

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('获取草稿失败:', error)
    res.status(500).json({ success: false, message: '获取草稿失败' })
  }
})

// 保存或更新草稿
router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId
    const { date, pages } = req.body

    if (!date || !pages) {
      return res.status(400).json({ success: false, message: '缺少必要参数' })
    }

    const now = new Date().toISOString()
    const pagesJson = JSON.stringify(pages)

    // 检查草稿是否已存在
    const existingDraft = await db
      .prepare('SELECT * FROM drafts WHERE user_id = ? AND date = ?')
      .get(userId, date) as Draft | undefined

    if (existingDraft) {
      // 更新现有草稿
      await db.prepare(
        `UPDATE drafts
         SET pages_json = ?, updated_at = ?
         WHERE user_id = ? AND date = ?`
      ).run(pagesJson, now, userId, date)

      res.json({
        success: true,
        data: {
          id: existingDraft.id,
          userId,
          date,
          pages,
          updatedAt: now,
        },
        message: '草稿已更新',
      })
    } else {
      // 创建新草稿
      const draftId = nanoid()
      await db.prepare(
        `INSERT INTO drafts (id, user_id, date, pages_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(draftId, userId, date, pagesJson, now, now)

      res.json({
        success: true,
        data: {
          id: draftId,
          userId,
          date,
          pages,
          createdAt: now,
          updatedAt: now,
        },
        message: '草稿已保存',
      })
    }
  } catch (error) {
    console.error('保存草稿失败:', error)
    res.status(500).json({ success: false, message: '保存草稿失败' })
  }
})

// 删除草稿
router.delete('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId
    const { date } = req.query

    if (!date) {
      return res.status(400).json({ success: false, message: '缺少日期参数' })
    }

    await db.prepare('DELETE FROM drafts WHERE user_id = ? AND date = ?').run(userId, date)

    res.json({ success: true, message: '草稿已删除' })
  } catch (error) {
    console.error('删除草稿失败:', error)
    res.status(500).json({ success: false, message: '删除草稿失败' })
  }
})

export default router
