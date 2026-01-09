import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth } from '../middleware/auth.js'
import type { Project } from '../types/database.js'

const router = Router()

// 获取所有项目
router.get('/', requireAuth, (req, res) => {
  try {
    const userId = req.session?.userId
    const { district, status } = req.query

    let query = 'SELECT * FROM projects WHERE user_id = ?'
    const params: (string | undefined)[] = [userId]

    if (district) {
      query += ' AND district = ?'
      params.push(String(district))
    }

    if (status) {
      query += ' AND status = ?'
      params.push(String(status))
    }

    query += ' ORDER BY created_at DESC'

    const projects = db.prepare(query).all(...params) as Project[]

    const result = projects.map((p) => ({
      id: p.id,
      name: p.name,
      district: p.district,
      projectType: p.project_type,
      implementationType: p.implementation_type,
      status: p.status,
      startDate: p.start_date,
      reportSpecialist: p.report_specialist,
      reportSpecialistPhone: p.report_specialist_phone,
      projectManager: p.project_manager,
      projectManagerPhone: p.project_manager_phone,
      description: p.description,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }))

    res.json({ success: true, data: result })
  } catch (error) {
    console.error('获取项目列表失败:', error)
    res.status(500).json({ success: false, message: '获取项目列表失败' })
  }
})

// 获取单个项目
router.get('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session?.userId

    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId) as Project | undefined

    if (!project) {
      return res.status(404).json({ success: false, message: '项目不存在' })
    }

    res.json({
      success: true,
      data: {
        id: project.id,
        name: project.name,
        district: project.district,
        projectType: project.project_type,
        implementationType: project.implementation_type,
        status: project.status,
        startDate: project.start_date,
        reportSpecialist: project.report_specialist,
        reportSpecialistPhone: project.report_specialist_phone,
        projectManager: project.project_manager,
        projectManagerPhone: project.project_manager_phone,
        description: project.description,
        createdAt: project.created_at,
        updatedAt: project.updated_at,
      },
    })
  } catch (error) {
    console.error('获取项目详情失败:', error)
    res.status(500).json({ success: false, message: '获取项目详情失败' })
  }
})

// 创建项目
router.post('/', requireAuth, (req, res) => {
  try {
    const userId = req.session?.userId
    const {
      name,
      district,
      projectType,
      implementationType,
      status,
      startDate,
      reportSpecialist,
      reportSpecialistPhone,
      projectManager,
      projectManagerPhone,
      description,
    } = req.body

    const id = nanoid()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO projects (
        id, name, district, project_type, implementation_type, status,
        start_date, report_specialist, report_specialist_phone,
        project_manager, project_manager_phone, description,
        user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      district,
      projectType,
      implementationType,
      status || 'active',
      startDate || null,
      reportSpecialist,
      reportSpecialistPhone,
      projectManager,
      projectManagerPhone,
      description || null,
      userId,
      now,
      now
    )

    res.json({ success: true, data: { id } })
  } catch (error) {
    console.error('创建项目失败:', error)
    res.status(500).json({ success: false, message: '创建项目失败' })
  }
})

// 更新项目
router.put('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session?.userId
    const {
      name,
      district,
      projectType,
      implementationType,
      status,
      startDate,
      reportSpecialist,
      reportSpecialistPhone,
      projectManager,
      projectManagerPhone,
      description,
      currentTask,
    } = req.body

    const now = new Date().toISOString()

    db.prepare(`
      UPDATE projects
      SET name = ?, district = ?, project_type = ?, implementation_type = ?,
          status = ?, start_date = ?, report_specialist = ?, report_specialist_phone = ?,
          project_manager = ?, project_manager_phone = ?, description = ?,
          current_task = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `).run(
      name,
      district,
      projectType,
      implementationType,
      status,
      startDate || null,
      reportSpecialist,
      reportSpecialistPhone,
      projectManager,
      projectManagerPhone,
      description || null,
      currentTask || null,
      now,
      id,
      userId
    )

    res.json({ success: true })
  } catch (error) {
    console.error('更新项目失败:', error)
    res.status(500).json({ success: false, message: '更新项目失败' })
  }
})

// 删除项目
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session?.userId

    db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId)
    res.json({ success: true })
  } catch (error) {
    console.error('删除项目失败:', error)
    res.status(500).json({ success: false, message: '删除项目失败' })
  }
})

export default router
