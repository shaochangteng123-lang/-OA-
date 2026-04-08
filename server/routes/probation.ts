import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import type { PoolClient } from 'pg'
import { db } from '../db/index.js'
import { requireAuth, requireAdmin, requireAdminOrGM } from '../middleware/auth.js'
import type { ProbationConfirmation, ProbationConfirmationWithEmployee, ProbationDocument, ProbationTemplate } from '../types/database.js'
import { nanoid } from 'nanoid'

const router = Router()

function convertPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

async function txRun(client: PoolClient, sql: string, ...params: any[]): Promise<void> {
  await client.query(convertPlaceholders(sql), params)
}

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
router.get('/templates', requireAuth, async (req, res) => {
  try {
    const templates = await db.prepare(`
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
router.post('/templates', requireAdmin, uploadTemplate.single('file'), async (req, res) => {
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
    const uploader = await db.prepare(`
      SELECT name FROM users WHERE id = ?
    `).get(req.session.userId) as { name: string } | undefined

    const id = nanoid()
    const now = new Date().toISOString()
    const relativePath = `/uploads/probation-templates/${file.filename}`

    await db.prepare(`
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

    const template = await db.prepare(`
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
router.delete('/templates/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const template = await db.prepare(`
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
    await db.prepare(`DELETE FROM probation_templates WHERE id = ?`).run(id)

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
router.get('/templates/:id/download', requireAuth, async (req, res) => {
  try {
    const { id } = req.params

    const template = await db.prepare(`
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

// 获取待转正员工列表（管理员或总经理）
router.get('/list', requireAdminOrGM, async (req, res) => {
  try {
    const { status, thisMonth, page = 1, pageSize = 20 } = req.query

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

    if (thisMonth === '1' && status === 'approved') {
      const now = new Date()
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      sql += ` AND pc.approve_time >= ?`
      params.push(monthStart)
    }

    // 获取总数
    let countSql = `
      SELECT COUNT(*) as total
      FROM probation_confirmations pc
      LEFT JOIN employee_profiles ep ON pc.employee_id = ep.id
      WHERE 1=1
    `
    const countParams: any[] = []
    if (status) {
      countSql += ` AND pc.status = ?`
      countParams.push(status)
    }
    if (thisMonth === '1' && status === 'approved') {
      const now = new Date()
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      countSql += ` AND pc.approve_time >= ?`
      countParams.push(monthStart)
    }
    const countResult = await db.prepare(countSql).get(...countParams) as { total: number }

    // 分页
    const offset = (Number(page) - 1) * Number(pageSize)
    sql += ` ORDER BY pc.created_at DESC LIMIT ? OFFSET ?`
    params.push(Number(pageSize), offset)

    const list = await db.prepare(sql).all(...params) as (ProbationConfirmationWithEmployee & { employee_hire_date?: string })[]

    // 为每个申请获取文档列表，并动态计算试用期截止日期（与用户端一致）
    const listWithDocs = await Promise.all(list.map(async item => {
      const documents = await db.prepare(`
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
    }))

    res.json({
      success: true,
      data: {
        list: listWithDocs,
        total: Number(countResult.total),
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
router.get('/statistics', requireAdminOrGM, async (req, res) => {
  try {
    const total = await db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations
    `).get() as { count: number }

    const pending = await db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations WHERE status = 'pending'
    `).get() as { count: number }

    const submitted = await db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations WHERE status = 'submitted'
    `).get() as { count: number }

    const approved = await db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations WHERE status = 'approved'
    `).get() as { count: number }

    const rejected = await db.prepare(`
      SELECT COUNT(*) as count FROM probation_confirmations WHERE status = 'rejected'
    `).get() as { count: number }

    res.json({
      success: true,
      data: {
        total: Number(total.count),
        pending: Number(pending.count),
        submitted: Number(submitted.count),
        approved: Number(approved.count),
        rejected: Number(rejected.count)
      }
    })
  } catch (error) {
    console.error('获取转正统计失败:', error)
    res.status(500).json({ success: false, message: '获取转正统计失败' })
  }
})

// 获取当前用户的转正状态
router.get('/my-status', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId

    // 获取当前用户的员工信息
    const profile = await db.prepare(`
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
    const confirmation = await db.prepare(`
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
      documents = await db.prepare(`
        SELECT * FROM probation_documents WHERE confirmation_id = ? ORDER BY created_at DESC
      `).all(confirmation.id) as ProbationDocument[]
    }

    // 是否有过提交历史（用于判断撤回后是否可以删除）
    let hasHistory = false
    if (confirmation) {
      const historyCount = await db.prepare(`
        SELECT COUNT(*) as count FROM approval_records ar
        JOIN approval_instances ai ON ar.instance_id = ai.id
        WHERE ai.target_id = ? AND ai.target_type = 'probation'
        AND ar.action IN ('submit', 'resubmit')
      `).get(confirmation.id) as { count: number } | undefined
      hasHistory = (historyCount?.count ?? 0) > 0
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
        hasHistory,
        documents
      }
    })
  } catch (error) {
    console.error('获取转正状态失败:', error)
    res.status(500).json({ success: false, message: '获取转正状态失败' })
  }
})

// 提交转正申请（员工）
router.post('/apply', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId

    // 获取当前用户的员工信息
    const profile = await db.prepare(`
      SELECT id, hire_date, employment_status FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string; hire_date: string; employment_status: string } | undefined

    if (!profile) {
      return res.status(400).json({ success: false, message: '请先完成入职信息填写' })
    }

    if (profile.employment_status !== 'probation') {
      return res.status(400).json({ success: false, message: '当前状态不是实习期，无法申请转正' })
    }

    // 检查是否已有转正申请
    const existing = await db.prepare(`
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

    if (!existing) {
      return res.status(400).json({ success: false, message: '转正记录不存在，请联系管理员' })
    }

    // 检查是否已上传文件
    const docCount = await db.prepare(`
      SELECT COUNT(*) as count FROM probation_documents WHERE confirmation_id = ?
    `).get(existing.id) as { count: number }
    if (Number(docCount.count) === 0) {
      return res.status(400).json({ success: false, message: '请先上传转正申请表' })
    }

    const now = new Date().toISOString()

    // 更新转正申请状态为已提交
    await db.prepare(`
      UPDATE probation_confirmations SET status = 'submitted', submit_time = ?, updated_at = ? WHERE id = ?
    `).run(now, now, existing.id)

    // 将旧的审批实例（如有）关闭，然后新建审批实例（支持驳回后重新提交）
    const hadRejected = existing.status === 'rejected'
    await db.prepare(`
      UPDATE approval_instances SET status = 'cancelled', updated_at = ?
      WHERE target_id = ? AND target_type = 'probation' AND status = 'pending'
    `).run(now, existing.id)

    const instanceId = nanoid()
    await db.prepare(`
      INSERT INTO approval_instances (
        id, flow_id, type, target_id, target_type,
        applicant_id, current_step, status, submit_time, created_at, updated_at
      ) VALUES (?, NULL, 'probation', ?, 'probation', ?, 1, 'pending', ?, ?, ?)
    `).run(instanceId, existing.id, userId, now, now, now)

    // 如果是驳回后重新提交，记录 resubmit；否则记录 submit
    const submitAction = hadRejected ? 'resubmit' : 'submit'
    const submitComment = hadRejected ? '员工驳回后重新提交转正申请' : '员工提交转正申请'
    await db.prepare(`
      INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
      VALUES (?, ?, 0, ?, ?, ?, ?)
    `).run(nanoid(), instanceId, userId, submitAction, submitComment, now)

    const updated = await db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(existing.id)

    res.json({
      success: true,
      message: '转正申请已提交',
      data: updated
    })
  } catch (error) {
    console.error('提交转正申请失败:', error)
    res.status(500).json({ success: false, message: '提交转正申请失败' })
  }
})

// 上传转正申请书（员工）
router.post('/upload-doc', requireAuth, uploadProbationDoc.single('file'), async (req, res) => {
  try {
    const userId = req.session.userId
    const { originalFileName } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    // 获取当前用户的员工信息
    const profile = await db.prepare(`
      SELECT id FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string } | undefined

    if (!profile) {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '请先完成入职信息填写' })
    }

    // 获取或创建转正申请记录
    let confirmation = await db.prepare(`
      SELECT id, status FROM probation_confirmations WHERE employee_id = ?
    `).get(profile.id) as { id: string; status: string } | undefined

    // 如果转正记录不存在，自动创建一个
    if (!confirmation) {
      // 计算试用期截止日期（入职 + 6个月）
      const hireDate = await db.prepare(`
        SELECT hire_date FROM employee_profiles WHERE id = ?
      `).get(profile.id) as { hire_date: string } | undefined

      let probationEndDate: string | null = null
      if (hireDate?.hire_date) {
        const hireDateObj = new Date(hireDate.hire_date)
        hireDateObj.setMonth(hireDateObj.getMonth() + 6)
        probationEndDate = hireDateObj.toISOString().split('T')[0]
      }

      const confirmationId = nanoid()
      const now = new Date().toISOString()

      await db.prepare(`
        INSERT INTO probation_confirmations (
          id, employee_id, hire_date, probation_end_date, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `).run(confirmationId, profile.id, hireDate?.hire_date || null, probationEndDate, now, now)

      confirmation = { id: confirmationId, status: 'pending' }
    }

    // 检查状态：已通过的不能再上传
    if (confirmation.status === 'approved') {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '转正已通过，无法上传文件' })
    }

    // 移动文件到正确目录
    const destDir = path.join(probationDocsDir, confirmation.id)
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }
    const newPath = path.join(destDir, file.filename)
    fs.renameSync(file.path, newPath)

    // 获取上传者信息
    const uploader = await db.prepare(`
      SELECT name FROM users WHERE id = ?
    `).get(userId) as { name: string } | undefined

    // 优先使用前端传递的原始文件名，否则尝试解码
    const decodedFileName = originalFileName || Buffer.from(file.originalname, 'latin1').toString('utf8')

    const docId = nanoid()
    const now = new Date().toISOString()
    const relativePath = `/uploads/probation-documents/${confirmation.id}/${file.filename}`

    await db.prepare(`
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

    const document = await db.prepare(`
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
router.delete('/my-doc/:docId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { docId } = req.params

    // 获取当前用户的员工信息
    const profile = await db.prepare(`
      SELECT id FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string } | undefined

    if (!profile) {
      return res.status(400).json({ success: false, message: '员工信息不存在' })
    }

    // 获取转正申请
    const confirmation = await db.prepare(`
      SELECT id, status FROM probation_confirmations WHERE employee_id = ?
    `).get(profile.id) as { id: string; status: string } | undefined

    if (!confirmation) {
      return res.status(400).json({ success: false, message: '转正记录不存在' })
    }

    if (confirmation.status === 'approved') {
      return res.status(400).json({ success: false, message: '转正已通过，无法删除文件' })
    }

    // 获取文件信息
    const document = await db.prepare(`
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
    await db.prepare(`DELETE FROM probation_documents WHERE id = ?`).run(docId)

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
router.get('/my-doc/:docId/download', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { docId } = req.params

    // 获取当前用户的员工信息
    const profile = await db.prepare(`
      SELECT id FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string } | undefined

    if (!profile) {
      return res.status(400).json({ success: false, message: '员工信息不存在' })
    }

    // 获取转正申请
    const confirmation = await db.prepare(`
      SELECT id FROM probation_confirmations WHERE employee_id = ?
    `).get(profile.id) as { id: string } | undefined

    if (!confirmation) {
      return res.status(400).json({ success: false, message: '转正记录不存在' })
    }

    // 获取文件信息，确保是当前用户的文件
    const document = await db.prepare(`
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
router.get('/:id', requireAdminOrGM, async (req, res) => {
  try {
    const { id } = req.params

    const confirmation = await db.prepare(`
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
    const documents = await db.prepare(`
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

// 获取转正申请的审批流程（员工、管理员、总经理）
router.get('/:id/approval-flow', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session.userId

    // 检查转正申请是否存在
    const confirmation = await db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id) as ProbationConfirmation | undefined

    if (!confirmation) {
      return res.status(404).json({ success: false, message: '转正申请不存在' })
    }

    // 获取用户信息和权限
    const user = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as { id: string; role: string } | undefined
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' })
    }

    // 获取员工信息
    const employee = await db.prepare('SELECT user_id FROM employee_profiles WHERE id = ?').get(confirmation.employee_id) as { user_id: string } | undefined

    // 权限检查：只有本人、管理员、总经理可以查看审批流程
    const isOwner = employee && employee.user_id === userId
    const isAdmin = user.role === 'admin' || user.role === 'super_admin'
    const isGM = user.role === 'general_manager'

    if (!isOwner && !isAdmin && !isGM) {
      return res.status(403).json({ success: false, message: '无权查看该审批流程' })
    }

    // 获取所有审批实例（支持多次提交的完整历史）
    const instances = await db.prepare(`
      SELECT * FROM approval_instances
      WHERE target_id = ? AND target_type = 'probation'
      ORDER BY created_at ASC
    `).all(id) as any[]

    // 获取所有实例的审批记录
    let records: any[] = []
    for (const inst of instances) {
      const instRecords = await db.prepare(`
        SELECT
          ar.id, ar.instance_id, ar.step, ar.approver_id,
          ar.action, ar.comment, ar.action_time,
          u.name as approver_name, u.role as approver_role
        FROM approval_records ar
        LEFT JOIN users u ON ar.approver_id = u.id
        WHERE ar.instance_id = ?
        ORDER BY ar.step ASC, ar.action_time ASC
      `).all(inst.id) as any[]
      records.push(...instRecords)
    }

    // 按时间排序
    records.sort((a, b) => new Date(a.action_time).getTime() - new Date(b.action_time).getTime())

    // 最新的审批实例（用于状态判断）
    const instance = instances[instances.length - 1] || null

    // 获取当前总经理姓名（用于待审批状态的下一步提示）
    const gmUser = await db.prepare(`
      SELECT name FROM users WHERE role = 'general_manager' AND status = 'active' LIMIT 1
    `).get() as { name: string } | undefined

    res.json({
      success: true,
      data: {
        instance,
        records,
        gmName: gmUser?.name || null
      }
    })
  } catch (error) {
    console.error('获取审批流程失败:', error)
    res.status(500).json({ success: false, message: '获取审批流程失败' })
  }
})

// 审批通过转正申请（总经理）
router.post('/:id/approve', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { comment } = req.body
    const approverId = req.session.userId

    // 查询审批人角色
    const approver = await db.prepare('SELECT role FROM users WHERE id = ?').get(approverId) as { role: string } | undefined
    if (!approver) {
      return res.status(401).json({ success: false, message: '用户不存在' })
    }

    // 检查权限：只有总经理可以审批转正
    if (approver.role !== 'general_manager' && approver.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: '只有总经理可以审批转正申请' })
    }

    const confirmation = await db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id) as ProbationConfirmation | undefined

    if (!confirmation) {
      return res.status(404).json({ success: false, message: '转正申请不存在' })
    }

    if (confirmation.status !== 'submitted') {
      return res.status(400).json({ success: false, message: '该申请不在待审批状态' })
    }

    const now = new Date().toISOString()

    // 获取审批实例
    const instance = await db.prepare(`
      SELECT id FROM approval_instances
      WHERE target_id = ? AND target_type = 'probation' AND status = 'pending'
    `).get(id) as { id: string } | undefined

    if (!instance) {
      return res.status(400).json({ success: false, message: '审批实例不存在' })
    }

    // 获取所有管理员用户（用于抄送）
    const adminUsers = await db.prepare(`
      SELECT id FROM users WHERE role IN ('admin', 'super_admin')
    `).all() as { id: string }[]

    // 使用事务处理多表更新
    await db.transaction(async (client) => {
      // 1. 更新转正申请状态
      await txRun(client, `
        UPDATE probation_confirmations
        SET status = 'approved', approve_time = ?, approver_id = ?, approver_comment = ?, updated_at = ?
        WHERE id = ?
      `, now, approverId, comment || null, now, id)

      // 2. 更新审批实例状态
      await txRun(client, `
        UPDATE approval_instances
        SET status = 'approved', complete_time = ?, updated_at = ?
        WHERE id = ?
      `, now, now, instance.id)

      // 3. 创建总经理审批记录
      await txRun(client, `
        INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
        VALUES (?, ?, 1, ?, 'approve', ?, ?)
      `, nanoid(), instance.id, approverId, comment || '审批通过', now)

      // 4. 为每个管理员创建抄送记录
      for (const adminUser of adminUsers) {
        await txRun(client, `
          INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
          VALUES (?, ?, 2, ?, 'cc', '已抄送存档', ?)
        `, nanoid(), instance.id, adminUser.id, now)
      }

      // 5. 更新员工状态为在职
      await txRun(client, `
        UPDATE employee_profiles SET employment_status = 'active', updated_at = ? WHERE id = ?
      `, now, confirmation.employee_id)
    })

    const updated = await db.prepare(`
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

// 拒绝转正申请（总经理）
router.post('/:id/reject', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { comment } = req.body
    const approverId = req.session.userId

    if (!comment) {
      return res.status(400).json({ success: false, message: '请填写拒绝原因' })
    }

    // 查询审批人角色
    const approver = await db.prepare('SELECT role FROM users WHERE id = ?').get(approverId) as { role: string } | undefined
    if (!approver) {
      return res.status(401).json({ success: false, message: '用户不存在' })
    }

    // 检查权限：只有总经理可以审批转正
    if (approver.role !== 'general_manager' && approver.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: '只有总经理可以审批转正申请' })
    }

    const confirmation = await db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id) as ProbationConfirmation | undefined

    if (!confirmation) {
      return res.status(404).json({ success: false, message: '转正申请不存在' })
    }

    if (confirmation.status !== 'submitted') {
      return res.status(400).json({ success: false, message: '该申请不在待审批状态' })
    }

    const now = new Date().toISOString()

    // 获取审批实例
    const instance = await db.prepare(`
      SELECT id FROM approval_instances
      WHERE target_id = ? AND target_type = 'probation' AND status = 'pending'
    `).get(id) as { id: string } | undefined

    if (!instance) {
      return res.status(400).json({ success: false, message: '审批实例不存在' })
    }

    // 使用事务处理多表更新
    await db.transaction(async (client) => {
      // 1. 更新转正申请状态
      await txRun(client, `
        UPDATE probation_confirmations
        SET status = 'rejected', approve_time = ?, approver_id = ?, approver_comment = ?, updated_at = ?
        WHERE id = ?
      `, now, approverId, comment, now, id)

      // 2. 更新审批实例状态
      await txRun(client, `
        UPDATE approval_instances
        SET status = 'rejected', complete_time = ?, updated_at = ?
        WHERE id = ?
      `, now, now, instance.id)

      // 3. 创建总经理驳回记录
      await txRun(client, `
        INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
        VALUES (?, ?, 1, ?, 'reject', ?, ?)
      `, nanoid(), instance.id, approverId, comment, now)
    })

    const updated = await db.prepare(`
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

// 员工硬删除转正记录（仅驳回状态可操作）
router.delete('/my-record', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const profile = await db.prepare(`SELECT id FROM employee_profiles WHERE user_id = ?`).get(userId) as { id: string } | undefined
    if (!profile) return res.status(400).json({ success: false, message: '员工信息不存在' })

    const confirmation = await db.prepare(`SELECT id, status FROM probation_confirmations WHERE employee_id = ?`).get(profile.id) as { id: string; status: string } | undefined
    if (!confirmation) return res.status(404).json({ success: false, message: '转正记录不存在' })

    if (confirmation.status !== 'rejected' && confirmation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '只有被驳回或撤回的申请才能删除' })
    }

    if (confirmation.status === 'pending') {
      // 检查是否有提交历史（撤回后才能删除）
      const historyCount = await db.prepare(`
        SELECT COUNT(*) as count FROM approval_records ar
        JOIN approval_instances ai ON ar.instance_id = ai.id
        WHERE ai.target_id = ? AND ai.target_type = 'probation'
        AND ar.action IN ('submit', 'resubmit')
      `).get(confirmation.id) as { count: number } | undefined
      if ((historyCount?.count ?? 0) === 0) {
        return res.status(400).json({ success: false, message: '只有被驳回或撤回的申请才能删除' })
      }
    }

    // 删除物理文件
    const docs = await db.prepare(`SELECT file_path FROM probation_documents WHERE confirmation_id = ?`).all(confirmation.id) as { file_path: string }[]
    for (const doc of docs) {
      const fp = path.join(process.cwd(), doc.file_path)
      if (fs.existsSync(fp)) fs.unlinkSync(fp)
    }

    // 删除相关数据库记录
    await db.prepare(`DELETE FROM probation_documents WHERE confirmation_id = ?`).run(confirmation.id)
    await db.prepare(`DELETE FROM approval_records WHERE instance_id IN (SELECT id FROM approval_instances WHERE target_id = ? AND target_type = 'probation')`).run(confirmation.id)
    await db.prepare(`DELETE FROM approval_instances WHERE target_id = ? AND target_type = 'probation'`).run(confirmation.id)
    await db.prepare(`DELETE FROM probation_confirmations WHERE id = ?`).run(confirmation.id)

    res.json({ success: true, message: '转正记录已删除' })
  } catch (error) {
    console.error('删除转正记录失败:', error)
    res.status(500).json({ success: false, message: '删除转正记录失败' })
  }
})

// 员工撤回已提交的转正申请
router.post('/my-record/withdraw', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const profile = await db.prepare(`SELECT id FROM employee_profiles WHERE user_id = ?`).get(userId) as { id: string } | undefined
    if (!profile) return res.status(400).json({ success: false, message: '员工信息不存在' })

    const confirmation = await db.prepare(`SELECT id, status FROM probation_confirmations WHERE employee_id = ?`).get(profile.id) as { id: string; status: string } | undefined
    if (!confirmation) return res.status(404).json({ success: false, message: '转正记录不存在' })
    if (confirmation.status !== 'submitted') return res.status(400).json({ success: false, message: '只有待审批的申请才能撤回' })

    const now = new Date().toISOString()

    // 撤回：状态改回 pending，取消审批实例，记录撤回操作
    const instance = await db.prepare(`SELECT id FROM approval_instances WHERE target_id = ? AND target_type = 'probation' AND status = 'pending'`).get(confirmation.id) as { id: string } | undefined

    await db.prepare(`UPDATE probation_confirmations SET status = 'pending', submit_time = NULL, updated_at = ? WHERE id = ?`).run(now, confirmation.id)

    if (instance) {
      await db.prepare(`UPDATE approval_instances SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, instance.id)
      await db.prepare(`INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time) VALUES (?, ?, 0, ?, 'withdraw', '员工撤回转正申请', ?)`).run(nanoid(), instance.id, userId, now)
    }

    res.json({ success: true, message: '转正申请已撤回' })
  } catch (error) {
    console.error('撤回转正申请失败:', error)
    res.status(500).json({ success: false, message: '撤回转正申请失败' })
  }
})

// 管理员上传转正文件
router.post('/:id/documents', requireAdmin, uploadProbationDoc.single('file'), async (req, res) => {
  try {
    const { id } = req.params
    const { originalFileName } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    // 检查转正申请是否存在
    const confirmation = await db.prepare(`
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
    const uploader = await db.prepare(`
      SELECT name FROM users WHERE id = ?
    `).get(req.session.userId) as { name: string } | undefined

    // 优先使用前端传递的原始文件名，否则尝试解码
    const decodedFileName = originalFileName || Buffer.from(file.originalname, 'latin1').toString('utf8')

    const docId = nanoid()
    const now = new Date().toISOString()
    const relativePath = `/uploads/probation-documents/${id}/${file.filename}`

    await db.prepare(`
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

    const document = await db.prepare(`
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
router.delete('/:id/documents/:docId', requireAdmin, async (req, res) => {
  try {
    const { id, docId } = req.params

    // 获取文件信息
    const document = await db.prepare(`
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
    await db.prepare(`DELETE FROM probation_documents WHERE id = ?`).run(docId)

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
router.post('/:id/submit', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const confirmation = await db.prepare(`
      SELECT * FROM probation_confirmations WHERE id = ?
    `).get(id) as ProbationConfirmation | undefined

    if (!confirmation) {
      return res.status(404).json({ success: false, message: '转正申请不存在' })
    }

    if (confirmation.status !== 'pending') {
      return res.status(400).json({ success: false, message: '该申请已提交或已处理' })
    }

    // 检查是否有上传文件
    const documents = await db.prepare(`
      SELECT COUNT(*) as count FROM probation_documents WHERE confirmation_id = ?
    `).get(id) as { count: number }

    if (Number(documents.count) === 0) {
      return res.status(400).json({ success: false, message: '请先上传转正申请表' })
    }

    const now = new Date().toISOString()

    // 更新状态为已提交
    await db.prepare(`
      UPDATE probation_confirmations SET status = 'submitted', submit_time = ?, updated_at = ? WHERE id = ?
    `).run(now, now, id)

    const updated = await db.prepare(`
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
router.get('/:id/documents/:docId/download', requireAdminOrGM, async (req, res) => {
  try {
    const { id, docId } = req.params

    const document = await db.prepare(`
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
