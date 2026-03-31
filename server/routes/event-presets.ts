import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import type { EventPreset } from '../types/database.js'

const router = Router()

// 获取所有预设方案
router.get('/', requireAuth, async (req, res) => {
  try {
    const { implementationType, projectType } = req.query

    let query = 'SELECT * FROM event_presets WHERE 1=1'
    const params: (string | undefined)[] = []

    if (implementationType) {
      query += ' AND implementation_type = ?'
      params.push(String(implementationType))
    }

    if (projectType) {
      query += ' AND project_type = ?'
      params.push(String(projectType))
    }

    query += ' ORDER BY is_default DESC, created_at DESC'

    const presets = await db.prepare(query).all(...params) as EventPreset[]

    const result = presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      implementationType: preset.implementation_type,
      projectType: preset.project_type,
      events: preset.events_json ? JSON.parse(preset.events_json) : [],
      isDefault: preset.is_default === true,
      createdAt: preset.created_at,
      updatedAt: preset.updated_at,
    }))

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('获取预设方案失败:', error)
    res.status(500).json({ success: false, message: '获取预设方案失败' })
  }
})

// 获取单个预设方案
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const preset = await db.prepare('SELECT * FROM event_presets WHERE id = ?').get(id) as EventPreset | undefined

    if (!preset) {
      return res.status(404).json({ success: false, message: '预设方案不存在' })
    }

    res.json({
      success: true,
      data: {
        id: preset.id,
        name: preset.name,
        implementationType: preset.implementation_type,
        projectType: preset.project_type,
        events: preset.events_json ? JSON.parse(preset.events_json) : [],
        isDefault: preset.is_default === true,
        createdAt: preset.created_at,
        updatedAt: preset.updated_at,
      },
    })
  } catch (error) {
    console.error('获取预设方案详情失败:', error)
    res.status(500).json({ success: false, message: '获取预设方案详情失败' })
  }
})

// 创建预设方案
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, implementationType, projectType, blocks, isDefault } = req.body
    const id = nanoid()
    const now = new Date().toISOString()

    // 如果设置为默认，先取消其他默认方案
    if (isDefault) {
      await db.prepare(`
        UPDATE event_presets
        SET is_default = 0
        WHERE implementation_type = ? AND project_type = ?
      `).run(implementationType, projectType)
    }

    await db.prepare(`
      INSERT INTO event_presets (
        id, name, implementation_type, project_type, blocks_json, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      implementationType,
      projectType,
      JSON.stringify(blocks || []),
      isDefault ? 1 : 0,
      now,
      now
    )

    res.json({ success: true, data: { id } })
  } catch (error) {
    console.error('创建预设方案失败:', error)
    res.status(500).json({ success: false, message: '创建预设方案失败' })
  }
})

// 更新预设方案
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { name, implementationType, projectType, blocks, isDefault } = req.body
    const now = new Date().toISOString()

    // 如果设置为默认，先取消其他默认方案
    if (isDefault) {
      await db.prepare(`
        UPDATE event_presets
        SET is_default = 0
        WHERE implementation_type = ? AND project_type = ? AND id != ?
      `).run(implementationType, projectType, id)
    }

    await db.prepare(`
      UPDATE event_presets
      SET name = ?, implementation_type = ?, project_type = ?, blocks_json = ?, is_default = ?, updated_at = ?
      WHERE id = ?
    `).run(name, implementationType, projectType, JSON.stringify(blocks || []), isDefault ? 1 : 0, now, id)

    res.json({ success: true })
  } catch (error) {
    console.error('更新预设方案失败:', error)
    res.status(500).json({ success: false, message: '更新预设方案失败' })
  }
})

// 删除预设方案
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    await db.prepare('DELETE FROM event_presets WHERE id = ?').run(id)
    res.json({ success: true })
  } catch (error) {
    console.error('删除预设方案失败:', error)
    res.status(500).json({ success: false, message: '删除预设方案失败' })
  }
})

export default router
