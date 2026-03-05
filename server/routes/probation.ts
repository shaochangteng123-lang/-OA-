/// <reference path="../types/express-session.d.ts" />
import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { db } from '../db/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import type { ProbationConfirmation, ProbationConfirmationWithEmployee, ProbationDocument, ProbationTemplate } from '../types/database.js'
import { nanoid } from 'nanoid'

const router = Router()

// 转正文件上传目录
const probationDocsDir = path.join(process.cwd(), 'uploads', 'probation-documents')
const probationTemplatesDir = path.join(process.cwd(), 'uploads', 'probation-templates')

// 确保目录存在
if (!fs.existsSync(probationDocsDir)) {
  fs.mkdirSync(probationDocsDir, { recursive: true })
}
if (!fs.existsSync(probationTemplatesDir)) {
  fs.mkdirSync(probationTemplatesDir, { recursive: true })
}

// 配置 multer 用于转正文件上传
const uploadProbationDoc = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const confirmationId = req.params.id || 'temp'
      const destDir = path.join(probationDocsDir, confirmationId)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      cb(null, destDir)
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname)
      const filename = `application-${Date.now()}${ext}`
      cb(null, filename)
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 PDF、JPG、PNG、DOC、DOCX 格式的文件'))
    }
  },
})

// 配置 multer 用于转正模板上传
const uploadTemplate = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, probationTemplatesDir)
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname)
      const filename = `template-${Date.now()}${ext}`
      cb(null, filename)
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 PDF、JPG、PNG、DOC、DOCX 格式的文件'))
    }
  },
})

// ==================== 模板管理 API ====================

// 获取转正文件模板列表
router.get('/templates', requireAuth, (req, res) => {
  try {
    const templates = db.prepare(`
      SELECT * FROM probation_templates ORDER BY created_at DESC
    `).all() as ProbationTemplate[]

    res.json({
      success: true,
      data: templates
    })
  } catch (error) {
    console.error('获取转正模板列表失败:', error)
    res.status(500).json({ success: false, message: '获取转正模板列表失败' })
  }
})

// 上传转正文件模板（管理员）
router.post('/templates', requireAdmin, uploadTemplate.single('file'), (req, res) => {
  try {
    const { name, originalFileName } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    if (!name) {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '请输入模板名称' })
    }

    // 优先使用前端传递的原始文件名，否则尝试解码
    const decodedFileName = originalFileName || Buffer.from(file.originalname, 'latin1').toString('utf8')

    // 获取上传者信息
    const uploader = db.prepare(`
      SELECT name FROM users WHERE id = ?
    `).get(req.session.userId) as { name: string } | undefined

    const id = nanoid()
    const now = new Date().toISOString()
    const relativePath = `/uploads/probation-templates/${file.filename}`

    db.prepare(`
      INSERT INTO probation_templates (
        id, name, file_name, file_path, file_size, mime_type,
        uploaded_by, uploaded_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      decodedFileName,
      relativePath,
      file.size,
      file.mimetype,
      req.session.userId,
      uploader?.name || null,
      now
    )

    const template = db.prepare(`
      SELECT * FROM probation_templates WHERE id = ?
    `).get(id)

    res.json({
      success: true,
      message: '模板上传成功',
      data: template
    })
  } catch (error) {
    console.error('上传转正模板失败:', error)
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (e) {
        // 忽略删除失败
      }
    }
    res.status(500).json({ success: false, message: '上传转正模板失败' })
  }
})

// 删除转正文件模板（管理员）
router.delete('/templates/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params

    const template = db.prepare(`
      SELECT * FROM probation_templates WHERE id = ?
    `).get(id) as ProbationTemplate | undefined

    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' })
    }

    // 删除物理文件
    const filePath = path.join(process.cwd(), template.file_path)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除数据库记录
    db.prepare(`DELETE FROM probation_templates WHERE id = ?`).run(id)

    res.json({
      success: true,
      message: '模板删除成功'
    })
  } catch (error) {
    console.error('删除转正模板失败:', error)
    res.status(500).json({ success: false, message: '删除转正模板失败' })
  }
})

// 下载转正文件模板
router.get('/templates/:id/download', requireAuth, (req, res) => {
  try {
    const { id } = req.params

    const template = db.prepare(`
      SELECT * FROM probation_templates WHERE id = ?
    `).get(id) as ProbationTemplate | undefined

    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' })
    }

    const filePath = path.join(process.cwd(), template.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    res.setHeader('Content-Type', template.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(template.file_name)}"`)

    const fileStream = fs.createReadStream(filePath)
    fileStream.pipe(res)
  } catch (error) {
    console.error('下载转正模板失败:', error)
    res.status(500).json({ success: false, message: '下载转正模板失败' })
  }
})

// ==================== 转正申请管理 API ====================

// 获取待转正员工列表（管理员）
router.get('/list', requireAdmin, (req, res) => {
  try {
    const { status, page = 1, pageSize = 20 } = req.query

    // 使用 employee_profiles 表中的 hire_date 作为入职日期，保持与用户端一致
    let sql = `
      SELECT pc.*, ep.name as employee_name, ep.department as employee_department,
             ep.position as employee_position, ep.mobile as employee_mobile,
             ep.hire_date as employee_hire_date
      FROM probation_confirmations pc
      LEFT JOIN employee_profiles ep ON pc.employee_id = ep.id
      WHERE 1=1
    `
    const params: any[] = []

    if (status) {
      sql += ` AND pc.status = ?`
      params.push(status)
    }

    // 获取总数
    let countSql = `
      SELECT COUNT(*) as total
      FROM probation_confirmations pc
      LEFT JOIN employee_profiles ep ON pc.employee_id = ep.id
      WHERE 1=1
    `
    if (status) {
      countSql += ` AND pc.status = ?`
    }
    const countResult = db.prepare(countSql).get(...(status ? [status] : [])) as { total: number }

    // 分页
    const offset = (Number(page) - 1) * Number(pageSize)
    sql += ` ORDER BY pc.created_at DESC LIMIT ? OFFSET ?`
    params.push(Number(pageSize), offset)

    const list = db.prepare(sql).all(...params) as (ProbationConfirmationWithEmployee & { employee_hire_date?: string })[]

    // 为每个申请获取文档列表，并动态计算试用期截止日期（与用户端一致）
    const listWithDocs = list.map(item => {
      const documents = db.prepare(`
        SELECT * FROM probation_documents WHERE confirmation_id = ? ORDER BY created_at DESC
      `).all(item.id) as ProbationDocument[]

      // 使用员工表中的入职日期，动态计算试用期截止日期（与用户端 /my-status 保持一致）
      const hireDate = item.employee_hire_date || item.hire_date
      let probationEndDate = item.probation_end_date
      if (hireDate) {
        const hireDateObj = new Date(hireDate)
        hireDateObj.setMonth(hireDateObj.getMonth() + 6)
        probationEndDate = hireDateObj.toISOString().split('T')[0]
      }

      return {
        ...item,
        documents,
        // 使用员工表中的入职日期
        hire_date: hireDate,
        // 使用动态计算的试用期截止日期
        probation_end_date: probationEndDate
      }
    })

    res.json({
      success: true,
      data: {
        list: listWithDocs,
        total: countResult.total,
        page: Number(page),
        pageSize: Number(pageSize)
      }
    })
  } catch (error) {
    console.error('获取待转正员工列表失败:', error)
    res.status(500).json({ success: false, message: '获取待转正员工列表失败' })
  }
})

// 获取转正统计数据（管理员）
router.get('/statistics', requireAdmin, (req, res) => {
  try {
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations
    `).get() as { count: number }

    const pending = db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations WHERE status = 'pending'
    `).get() as { count: number }

    const submitted = db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations WHERE status = 'submitted'
    `).get() as { count: number }

    const approved = db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations WHERE status = 'approved'
    `).get() as { count: number }

    const rejected = db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations WHERE status = 'rejected'
    `).get() as { count: number }

    res.json({
      success: true,
      data: {
        total: total.count,
        pending: pending.count,
        submitted: submitted.count,
        approved: approved.count,
        rejected: rejected.count
      }
    })
  } catch (error) {
    console.error('获取转正统计失败:', error)
    res.status(500).json({ success: false, message: '获取转正统计失败' })
  }
})

// 获取当前用户的转正状态
router.get('/my-status', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId

    // 获取当前用户的员工信息
    const profile = db.prepare(`
      SELECT id, name, department, position, hire_date, employment_status FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string; name: string; department: string; position: string; hire_date: string; employment_status: string } | undefined

    if (!profile) {
      return res.json({
        success: true,
        data: null
      })
    }

    // 根据入职时间计算试用期截止日期（入职 + 6个月）
    let probationEndDate: string | null = null
    if (profile.hire_date) {
      const hireDate = new Date(profile.hire_date)
      hireDate.setMonth(hireDate.getMonth() + 6)
      probationEndDate = hireDate.toISOString().split('T')[0]
    }

    // 获取转正申请
    let confirmation = db.prepare(`
      SELECT * FROM probation_confirmations WHERE employee_id = ?
    `).get(profile.id) as ProbationConfirmation | undefined

    // 如果没有转正申请记录，构造一个虚拟的记录用于前端显示
    let confirmationData: Partial<ProbationConfirmation> | null = null
    if (confirmation) {
      // 使用计算的试用期截止日期覆盖数据库中的值
      confirmationData = {
        ...confirmation,
        probation_end_date: probationEndDate || confirmation.probation_end_date
      }
    } else if (profile.employment_status === 'probation') {
      // 试用期员工但还没有转正申请记录，构造虚拟记录
      confirmationData = {
        id: '',
        employee_id: profile.id,
        hire_date: profile.hire_date,
        probation_end_date: probationEndDate ?? undefined,
        status: 'pending',
        created_at: '',
        updated_at: ''
      }
    }

    // 获取转正文件
    let documents: ProbationDocument[] = []
    if (confirmation) {
      documents = db.prepare(`
        SELECT * FROM probation_documents WHERE confirmation_id = ? ORDER BY created_at DESC
      `).all(confirmation.id) as ProbationDocument[]
    }

    res.json({
      success: true,
      data: {
        profile: {
          id: profile.id,
          name: profile.name,
          department: profile.department,
          position: profile.position,
          hire_date: profile.hire_date,
          employment_status: profile.employment_status
        },
        confirmation: confirmationData,
        documents
      }
    })
  } catch (error) {
    console.error('获取转正状态失败:', error)
    res.status(500).json({ success: false, message: '获取转正状态失败' })
  }
})

// 提交转正申请（员工）
router.post('/apply', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId

    // 获取当前用户的员工信息
    const profile = db.prepare(`
      SELECT id, hire_date, employment_status FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string; hire_date: string; employment_status: string } | undefined

    if (!profile) {
      return res.status(400).json({ success: false, message: '请先完成入职信息填写' })
    }

    if (profile.employment_status !== 'probation') {
      return res.status(400).json({ success: false, message: '当前状态不是实习期，无法申请转正' })
    }

    // 检查是否已有转正申请
    const existing = db.prepare(`
      SELECT id, status FROM probation_confirmations WHERE employee_id = ?
    `).get(profile.id) as { id: string; status: string } | undefined

    if (existing) {
      if (existing.status === 'submitted') {
        return res.status(400).json({ success: false, message: '您已提交转正申请，请等待审批' })
      }
      if (existing.status === 'approved') {
        return res.status(400).json({ success: false, message: '您的转正申请已通过' })
      }
    }

    const now = new Date().toISOString()

    if (existing) {
      // 更新现有申请
      db.prepare(`
        UPDATE probation_confirmations SET status = 'submitted', submit_time = ?, updated_at = ? WHERE id = ?
      `).run(now, now, existing.id)

      const updated = db.prepare(`
        SELECT * FROM probation_confirmations WHERE id = ?
      `).get(existing.id)

      res.json({
        success: true,
        message: '转正申请已提交',
        data: updated
      })
    } else {
      return res.status(400).json({ success: false, message: '转正记录不存在，请联系管理员' })
    }
  } catch (error) {
    console.error('提交转正申请失败:', error)
    res.status(500).json({ success: false, message: '提交转正申请失败' })
  }
})

// 上传转正申请书（员工）
router.post('/upload-doc', requireAuth, uploadProbationDoc.single('file'), (req, res) => {
  try {
    const userId = req.session.userId
    const { originalFileName } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    // 获取当前用户的员工信息
    const profile = db.prepare(`
      SELECT id FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string } | undefined

    if (!profile) {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '请先完成入职信息填写' })
    }

    // 获取转正申请
    const confirmation = db.prepare(`
      SELECT id FROM probation_confirmations WHERE employee_id = ?
    `).get(profile.id) as { id: string } | undefined

    if (!confirmation) {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '转正记录不存在' })
    }

    // 移动文件到正确目录
    const destDir = path.join(probationDocsDir, confirmation.id)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    const newPath = path.join(destDir, file.filename)
    fs.renameSync(file.path, newPath)

    // 获取上传者信息
    const uploader = db.prepare(`
      SELECT name FROM users WHERE id = ?
    `).get(userId) as { name: string } | undefined

    // 优先使用前端传递的原始文件名，否则尝试解码
    const decodedFileName = originalFileName || Buffer.from(file.originalname, 'latin1').toString('utf8')

    const docId = nanoid()
    const now = new Date().toISOString()
    const relativePath = `/uploads/probation-documents/${confirmation.id}/${file.filename}`

    db.prepare(`
      INSERT INTO probation_documents (
        id, confirmation_id, document_type, file_name, file_path,
        file_size, mime_type, uploaded_by, uploaded_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      docId,
      confirmation.id,
      'application',
      decodedFileName,
      relativePath,
      file.size,
      file.mimetype,
      userId,
      uploader?.name || null,
      now
    )

    const document = db.prepare(`
      SELECT * FROM probation_documents WHERE id = ?
    `).get(docId)

    res.json({
      success: true,
      message: '文件上传成功',
      data: document
    })
  } catch (error) {
    console.error('上传转正文件失败:', error)
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (e) {
        // 忽略删除失败
      }
    }
    res.status(500).json({ success: false, message: '上传转正文件失败' })
  }
})

// 删除转正申请书（员工）
router.delete('/my-doc/:docId', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId
    const { docId } = req.params

    // 获取当前用户的员工信息
    const profile = db.prepare(`
      SELECT id FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string } | undefined

    if (!profile) {
      return res.status(400).json({ success: false, message: '员工信息不存在' })
    }

    // 获取转正申请
    const confirmation = db.prepare(`
      SELECT id, status FROM probation_confirmations WHERE employee_id = ?
    `).get(profile.id) as { id: string; status: string } | undefined

    if (!confirmation) {
      return res.status(400).json({ success: false, message: '转正记录不存在' })
    }

    if (confirmation.status === 'approved') {
      return res.status(400).json({ success: false, message: '转正已通过，无法删除文件' })
    }

    // 获取文件信息
    const document = db.prepare(`
      SELECT * FROM probation_documents WHERE id = ? AND confirmation_id = ?
    `).get(docId, confirmation.id) as ProbationDocument | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    // 删除物理文件
    const filePath = path.join(process.cwd(), document.file_path)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除数据库记录
    db.prepare(`DELETE FROM probation_documents WHERE id = ?`).run(docId)

    res.json({
      success: true,
      message: '文件删除成功'
    })
  } catch (error) {
    console.error('删除转正文件失败:', error)
    res.status(500).json({ success: false, message: '删除转正文件失败' })
  }
})

// 下载/预览转正申请书（员工自己的文件）
router.get('/my-doc/:docId/download', requireAuth, (req, res) => {
  try {
    const userId = req.session.userId
    const { docId } = req.params

    // 获取当前用户的员工信息
    const profile = db.prepare(`
      SELECT id FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string } | undefined

    if (!profile) {
      return res.status(400).json({ success: false, message: '员工信息不存在' })
    }

    // 获取转正申请
    const confirmation = db.prepare(`
      SELECT id FROM probation_confirmations WHERE employee_id = ?
    `).get(profile.id) as { id: string } | undefined

    if (!confirmation) {
      return res.status(400).json({ success: false, message: '转正记录不存在' })
    }

    // 获取文件信息，确保是当前用户的文件
    const document = db.prepare(`
      SELECT * FROM probation_documents WHERE id = ? AND confirmation_id = ?
    `).get(docId, confirmation.id) as ProbationDocument | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    const filePath = path.join(process.cwd(), document.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.file_name)}"`)

    const fileStream = fs.createReadStream(filePath)
    fileStream.pipe(res)
  } catch (error) {
    console.error('下载转正文件失败:', error)
    res.status(500).json({ success: false, message: '下载转正文件失败' })
  }
})

// 获取转正申请详情（管理员）
router.get('/:id', requireAdmin, (req, res) => {
  try {
    const { id } = req.params

    const confirmation = db.prepare(`
      SELECT pc.*, ep.name as employee_name, ep.department as employee_department,
             ep.position as employee_position, ep.mobile as employee_mobile,
             ep.email as employee_email, ep.hire_date as employee_hire_date
      FROM probation_confirmations pc
      LEFT JOIN employee_profiles ep ON pc.employee_id = ep.id
      WHERE pc.id = ?
    `).get(id) as (ProbationConfirmationWithEmployee & { employee_hire_date?: string }) | undefined

    if (!confirmation) {
      return res.status(404).json({ success: false, message: '转正申请不存在' })
    }

    // 获取转正文件
    const documents = db.prepare(`
      SELECT * FROM probation_documents WHERE confirmation_id = ? ORDER BY created_at DESC
    `).all(id) as ProbationDocument[]

    // 使用员工表中的入职日期，动态计算试用期截止日期（与用户端 /my-status 保持一致）
    const hireDate = confirmation.employee_hire_date || confirmation.hire_date
    let probationEndDate = confirmation.probation_end_date
    if (hireDate) {
      const hireDateObj = new Date(hireDate)
      hireDateObj.setMonth(hireDateObj.getMonth() + 6)
      probationEndDate = hireDateObj.toISOString().split('T')[0]
    }

    res.json({
      success: true,
      data: {
        ...confirmation,
        hire_date: hireDate,
        probation_end_date: probationEndDate,
        documents
      }
    })
  } catch (error) {
    console.error('获取转正申请详情失败:', error)
    res.status(500).json({ success: false, message: '获取转正申请详情失败' })
  }
})

// 审批通过转正申请（管理员）
router.post('/:id/approve', requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    const { comment } = req.body
    const approverId = req.session.userId

    const confirmation = db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id) as ProbationConfirmation | undefined

    if (!confirmation) {
      return res.status(404).json({ success: false, message: '转正申请不存在' })
    }

    if (confirmation.status !== 'submitted') {
      return res.status(400).json({ success: false, message: '该申请不在待审批状态' })
    }

    const now = new Date().toISOString()

    // 更新转正申请状态
    db.prepare(`
      UPDATE probation_confirmations
      SET status = 'approved', approve_time = ?, approver_id = ?, approver_comment = ?, updated_at = ?
      WHERE id = ?
    `).run(now, approverId, comment || null, now, id)

    // 更新员工状态为在职
    db.prepare(`
      UPDATE employee_profiles SET employment_status = 'active', updated_at = ? WHERE id = ?
    `).run(now, confirmation.employee_id)

    const updated = db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id)

    res.json({
      success: true,
      message: '转正审批通过',
      data: updated
    })
  } catch (error) {
    console.error('审批转正申请失败:', error)
    res.status(500).json({ success: false, message: '审批转正申请失败' })
  }
})

// 拒绝转正申请（管理员）
router.post('/:id/reject', requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    const { comment } = req.body
    const approverId = req.session.userId

    if (!comment) {
      return res.status(400).json({ success: false, message: '请填写拒绝原因' })
    }

    const confirmation = db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id) as ProbationConfirmation | undefined

    if (!confirmation) {
      return res.status(404).json({ success: false, message: '转正申请不存在' })
    }

    if (confirmation.status !== 'submitted') {
      return res.status(400).json({ success: false, message: '该申请不在待审批状态' })
    }

    const now = new Date().toISOString()

    // 更新转正申请状态
    db.prepare(`
      UPDATE probation_confirmations
      SET status = 'rejected', approve_time = ?, approver_id = ?, approver_comment = ?, updated_at = ?
      WHERE id = ?
    `).run(now, approverId, comment, now, id)

    const updated = db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id)

    res.json({
      success: true,
      message: '转正申请已拒绝',
      data: updated
    })
  } catch (error) {
    console.error('拒绝转正申请失败:', error)
    res.status(500).json({ success: false, message: '拒绝转正申请失败' })
  }
})

// 管理员上传转正文件
router.post('/:id/documents', requireAdmin, uploadProbationDoc.single('file'), (req, res) => {
  try {
    const { id } = req.params
    const { originalFileName } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    // 检查转正申请是否存在
    const confirmation = db.prepare(`
      SELECT id, status FROM probation_confirmations WHERE id = ?
    `).get(id) as { id: string; status: string } | undefined

    if (!confirmation) {
      fs.unlinkSync(file.path)
      return res.status(404).json({ success: false, message: '转正申请不存在' })
    }

    // 移动文件到正确目录
    const destDir = path.join(probationDocsDir, id)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    const newPath = path.join(destDir, file.filename)
    fs.renameSync(file.path, newPath)

    // 获取上传者信息
    const uploader = db.prepare(`
      SELECT name FROM users WHERE id = ?
    `).get(req.session.userId) as { name: string } | undefined

    // 优先使用前端传递的原始文件名，否则尝试解码
    const decodedFileName = originalFileName || Buffer.from(file.originalname, 'latin1').toString('utf8')

    const docId = nanoid()
    const now = new Date().toISOString()
    const relativePath = `/uploads/probation-documents/${id}/${file.filename}`

    db.prepare(`
      INSERT INTO probation_documents (
        id, confirmation_id, document_type, file_name, file_path,
        file_size, mime_type, uploaded_by, uploaded_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      docId,
      id,
      'application',
      decodedFileName,
      relativePath,
      file.size,
      file.mimetype,
      req.session.userId,
      uploader?.name || null,
      now
    )

    const document = db.prepare(`
      SELECT * FROM probation_documents WHERE id = ?
    `).get(docId)

    res.json({
      success: true,
      message: '文件上传成功',
      data: document
    })
  } catch (error) {
    console.error('管理员上传转正文件失败:', error)
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (e) {
        // 忽略删除失败
      }
    }
    res.status(500).json({ success: false, message: '上传转正文件失败' })
  }
})

// 管理员删除转正文件
router.delete('/:id/documents/:docId', requireAdmin, (req, res) => {
  try {
    const { id, docId } = req.params

    // 获取文件信息
    const document = db.prepare(`
      SELECT * FROM probation_documents WHERE id = ? AND confirmation_id = ?
    `).get(docId, id) as ProbationDocument | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    // 删除物理文件
    const filePath = path.join(process.cwd(), document.file_path)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除数据库记录
    db.prepare(`DELETE FROM probation_documents WHERE id = ?`).run(docId)

    res.json({
      success: true,
      message: '文件删除成功'
    })
  } catch (error) {
    console.error('管理员删除转正文件失败:', error)
    res.status(500).json({ success: false, message: '删除转正文件失败' })
  }
})

// 管理员提交转正申请
router.post('/:id/submit', requireAdmin, (req, res) => {
  try {
    const { id } = req.params

    const confirmation = db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id) as ProbationConfirmation | undefined

    if (!confirmation) {
      return res.status(404).json({ success: false, message: '转正申请不存在' })
    }

    if (confirmation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '该申请已提交或已处理' })
    }

    // 检查是否有上传文件
    const documents = db.prepare(`
      SELECT COUNT(*) as count FROM probation_documents WHERE confirmation_id = ?
    `).get(id) as { count: number }

    if (documents.count === 0) {
      return res.status(400).json({ success: false, message: '请先上传转正申请表' })
    }

    const now = new Date().toISOString()

    // 更新状态为已提交
    db.prepare(`
      UPDATE probation_confirmations SET status = 'submitted', submit_time = ?, updated_at = ? WHERE id = ?
    `).run(now, now, id)

    const updated = db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id)

    res.json({
      success: true,
      message: '转正申请已提交',
      data: updated
    })
  } catch (error) {
    console.error('管理员提交转正申请失败:', error)
    res.status(500).json({ success: false, message: '提交转正申请失败' })
  }
})

// 下载转正文件（管理员）
router.get('/:id/documents/:docId/download', requireAdmin, (req, res) => {
  try {
    const { id, docId } = req.params

    const document = db.prepare(`
      SELECT * FROM probation_documents WHERE id = ? AND confirmation_id = ?
    `).get(docId, id) as ProbationDocument | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    const filePath = path.join(process.cwd(), document.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.file_name)}"`)

    const fileStream = fs.createReadStream(filePath)
    fileStream.pipe(res)
  } catch (error) {
    console.error('下载转正文件失败:', error)
    res.status(500).json({ success: false, message: '下载转正文件失败' })
  }
})

export default router
