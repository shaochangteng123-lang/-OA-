import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import type { PoolClient } from 'pg'
import { db } from '../db/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import type {
  EmployeeProfile,
  ResignationDocument,
  ResignationDocumentType,
  ResignationRequest,
  ResignationRequestWithEmployee,
  ResignationTemplate,
  ResignationTemplateType,
  ResignationType,
  ResignationUploaderRole,
} from '../types/database.js'
import { nanoid } from 'nanoid'
import { ensureDatedUploadDirectory, toStoredUploadPath } from '../utils/upload-date.js'

const router = Router()

const EMPLOYEE_EDITABLE_STATUSES: ResignationRequest['status'][] = ['draft', 'rejected']
const HANDOVER_EDITABLE_STATUSES: ResignationRequest['status'][] = ['submitted', 'handover_rejected']

class ResignationOperationError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message)
    this.name = 'ResignationOperationError'
  }
}

// 写入审批流程日志
async function addAuditLog(requestId: string, action: string, operatorId: string, comment?: string | null) {
  const operatorName = await getUploaderName(operatorId)
  await db.prepare(`
    INSERT INTO resignation_audit_logs (id, request_id, action, operator_id, operator_name, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(), requestId, action, operatorId, operatorName, comment || null, new Date().toISOString())
}

async function addAuditLogWithClient(
  client: PoolClient,
  requestId: string,
  action: string,
  operatorId: string,
  comment: string | null,
  createdAt: string
) {
  const operatorResult = await client.query<{ name: string }>(
    `SELECT name FROM users WHERE id = $1`,
    [operatorId]
  )
  await client.query(
    `INSERT INTO resignation_audit_logs (
       id, request_id, action, operator_id, operator_name, comment, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [nanoid(), requestId, action, operatorId, operatorResult.rows[0]?.name || null, comment, createdAt]
  )
}

function isInlinePreviewMimeType(mimeType: string | null | undefined): boolean {
  return !!mimeType && [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
  ].includes(mimeType)
}

const RESIGNATION_DOCUMENT_LABELS: Record<ResignationDocumentType, string> = {
  application_form: '离职申请表',
  handover_form_employee: '离职人交接单',
  handover_form_handover: '交接人交接单',
  termination_proof: '终止/解除劳动关系证明',
  asset_handover: '固定资产交接单',
  compensation_agreement: '离职经济补偿协议书',
  expense_settlement_agreement: '离职其他费用结算约定',
}

const RESIGNATION_TEMPLATE_LABELS: Record<ResignationTemplateType, string> = {
  application_form: '离职申请表模板',
  handover_form: '交接单模板',
  termination_proof: '终止/解除劳动关系证明模板',
  asset_handover: '固定资产交接单模板',
  compensation_agreement: '离职经济补偿协议书模板',
  expense_settlement_agreement: '离职其他费用结算约定模板',
  partner_dividend_settlement: '合伙人离任分红结算模板',
}

const RESIGNATION_REQUIRED_DOCUMENTS: Record<ResignationType, ResignationDocumentType[]> = {
  voluntary: [
    'application_form',
    'handover_form_employee',
    'termination_proof',
    'asset_handover',
    'expense_settlement_agreement',
  ],
  contract_end: [
    'application_form',
    'handover_form_employee',
    'termination_proof',
    'asset_handover',
    'expense_settlement_agreement',
  ],
  dismissal: [
    'application_form',
    'handover_form_employee',
    'termination_proof',
    'asset_handover',
    'compensation_agreement',
    'expense_settlement_agreement',
  ],
}

function getRequiredDocumentTypes(resignType: ResignationType) {
  return RESIGNATION_REQUIRED_DOCUMENTS[resignType] || []
}

function getMissingRequiredDocumentTypes(request: ResignationRequest, documents: ResignationDocument[]) {
  const uploaded = new Set(
    documents
      .filter(doc => doc.uploader_role === 'employee')
      .map(doc => doc.document_type),
  )

  return getRequiredDocumentTypes(request.resign_type).filter(type => !uploaded.has(type))
}

function getMissingRequiredDocumentLabels(request: ResignationRequest, documents: ResignationDocument[]) {
  return getMissingRequiredDocumentTypes(request, documents).map(type => RESIGNATION_DOCUMENT_LABELS[type])
}

function getSafeOriginalName(file: Express.Multer.File, providedName?: string) {
  return providedName || Buffer.from(file.originalname, 'latin1').toString('utf8')
}

async function getUploaderName(userId: string) {
  const uploader = await db.prepare(`
    SELECT name FROM users WHERE id = ?
  `).get(userId) as { name: string } | undefined
  return uploader?.name || null
}

async function getMyEmployeeProfile(userId: string) {
  return await db.prepare(`
    SELECT id, user_id, name, department, position, mobile, employment_status
    FROM employee_profiles
    WHERE user_id = ?
  `).get(userId) as EmployeeProfile | undefined
}

async function getResignationRequestById(id: string) {
  return await db.prepare(`
    SELECT rr.*, ep.name as employee_name, ep.department as employee_department,
           ep.position as employee_position, ep.mobile as employee_mobile
    FROM resignation_requests rr
    LEFT JOIN employee_profiles ep ON rr.employee_id = ep.id
    WHERE rr.id = ?
  `).get(id) as ResignationRequestWithEmployee | undefined
}

async function getRequestDocuments(requestId: string) {
  return await db.prepare(`
    SELECT * FROM resignation_documents
    WHERE request_id = ? AND is_current = 1
    ORDER BY created_at DESC
  `).all(requestId) as ResignationDocument[]
}

async function getTemplates() {
  return await db.prepare(`
    SELECT * FROM resignation_templates ORDER BY template_type, created_at DESC
  `).all() as ResignationTemplate[]
}

function canAccessRequest(request: ResignationRequest, userId: string, isAdmin: boolean) {
  return isAdmin || request.employee_user_id === userId || request.handover_user_id === userId
}

async function isDatabaseAdmin(userId: string): Promise<boolean> {
  const user = await db.prepare(`
    SELECT role, status FROM users WHERE id = ?
  `).get(userId) as { role: string; status: string } | undefined
  return user?.status === 'active' && ['admin', 'super_admin'].includes(user.role)
}

function canEmployeeEditDocuments(request: ResignationRequest): boolean {
  return EMPLOYEE_EDITABLE_STATUSES.includes(request.status)
}

function canHandoverEditDocuments(request: ResignationRequest): boolean {
  if (!HANDOVER_EDITABLE_STATUSES.includes(request.status)) return false
  return request.status === 'handover_rejected' || !request.handover_confirm_time
}

function computeStatus(request: ResignationRequest, documents: ResignationDocument[]): ResignationRequest['status'] {
  if (request.status === 'approved' || request.status === 'rejected' || request.status === 'handover_rejected') {
    return request.status
  }

  const hasEmployeeApplication = documents.some(doc => doc.document_type === 'application_form' && doc.uploader_role === 'employee')
  const hasEmployeeHandover = documents.some(doc => doc.document_type === 'handover_form_employee' && doc.uploader_role === 'employee')
  const hasHandoverForm = documents.some(doc => doc.document_type === 'handover_form_handover' && doc.uploader_role === 'handover')

  if (!request.submit_time) {
    return 'draft'
  }

  if (request.employee_confirm_time && request.handover_confirm_time && hasEmployeeApplication && hasEmployeeHandover && hasHandoverForm) {
    return 'mutual_confirmed'
  }

  if (request.handover_confirm_time) {
    return 'handover_confirmed'
  }

  return 'submitted'
}

async function refreshRequestStatus(requestId: string) {
  const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ?`).get(requestId) as ResignationRequest | undefined
  if (!request) return null

  const documents = await getRequestDocuments(requestId)
  const nextStatus = computeStatus(request, documents)

  if (nextStatus !== request.status) {
    await db.prepare(`
      UPDATE resignation_requests SET status = ?, updated_at = ? WHERE id = ?
    `).run(nextStatus, new Date().toISOString(), requestId)
  }

  return nextStatus
}

const uploadResignationDocument = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const requestId = req.params.id || req.body.requestId || req.body.request_id || 'temp'
      const destDir = ensureDatedUploadDirectory('resignation-documents', new Date(), requestId)
      cb(null, destDir)
    },
    filename: (req, file, cb) => {
      const documentType = req.body.document_type || 'document'
      const ext = path.extname(file.originalname)
      cb(null, `${documentType}-${Date.now()}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const documentType = req.body.document_type
    const pdfOnly = ['application_form'].includes(documentType)
    const allowedMimeTypes = pdfOnly
      ? ['application/pdf']
      : ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(pdfOnly ? '只支持 PDF 格式的文件' : '只支持 PDF、JPG、PNG 格式的文件'))
    }
  },
})

const uploadResignationTemplate = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureDatedUploadDirectory('resignation-templates')),
    filename: (req, file, cb) => {
      const templateType = req.body.template_type || 'template'
      const ext = path.extname(file.originalname)
      cb(null, `${templateType}-${Date.now()}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(new Error('只支持 PDF 格式的文件'))
    }
  },
})

router.get('/templates', requireAuth, async (_req, res) => {
  try {
    res.json({ success: true, data: await getTemplates() })
  } catch (error) {
    console.error('获取离职模板失败:', error)
    res.status(500).json({ success: false, message: '获取离职模板失败' })
  }
})

router.post('/templates', requireAdmin, uploadResignationTemplate.single('file'), async (req, res) => {
  try {
    const { template_type, name, originalFileName } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }
    if (!template_type || ![
      'application_form',
      'handover_form',
      'termination_proof',
      'asset_handover',
      'compensation_agreement',
      'expense_settlement_agreement',
      'partner_dividend_settlement',
    ].includes(template_type)) {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '请指定正确的模板类型' })
    }
    if (!name) {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '请输入模板名称' })
    }

    const id = nanoid()
    const now = new Date().toISOString()
    const relativePath = toStoredUploadPath(file.path, true)

    await db.prepare(`
      INSERT INTO resignation_templates (
        id, template_type, name, file_name, file_path, file_size, mime_type,
        uploaded_by, uploaded_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      template_type,
      name,
      getSafeOriginalName(file, originalFileName),
      relativePath,
      file.size,
      file.mimetype,
      req.session.userId,
      await getUploaderName(req.session.userId!),
      now,
    )

    const template = await db.prepare(`SELECT * FROM resignation_templates WHERE id = ?`).get(id)
    res.json({ success: true, message: `${RESIGNATION_TEMPLATE_LABELS[template_type as ResignationTemplateType] || '模板'}上传成功`, data: template })
  } catch (error) {
    console.error('上传离职模板失败:', error)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    res.status(500).json({ success: false, message: '上传离职模板失败' })
  }
})

router.delete('/templates/:id', requireAdmin, async (req, res) => {
  try {
    const template = await db.prepare(`SELECT * FROM resignation_templates WHERE id = ?`).get(req.params.id) as ResignationTemplate | undefined
    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' })
    }

    const filePath = path.join(process.cwd(), template.file_path)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    await db.prepare(`DELETE FROM resignation_templates WHERE id = ?`).run(req.params.id)

    res.json({ success: true, message: '模板删除成功' })
  } catch (error) {
    console.error('删除离职模板失败:', error)
    res.status(500).json({ success: false, message: '删除离职模板失败' })
  }
})

router.get('/templates/:id/download', requireAuth, async (req, res) => {
  try {
    const template = await db.prepare(`SELECT * FROM resignation_templates WHERE id = ?`).get(req.params.id) as ResignationTemplate | undefined
    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' })
    }

    const filePath = path.join(process.cwd(), template.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    res.setHeader('Content-Type', template.mime_type || 'application/octet-stream')
    const disposition = isInlinePreviewMimeType(template.mime_type) ? 'inline' : 'attachment'
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(template.file_name)}"`)
    fs.createReadStream(filePath).pipe(res)
  } catch (error) {
    console.error('下载离职模板失败:', error)
    res.status(500).json({ success: false, message: '下载离职模板失败' })
  }
})

router.get('/handover-task', requireAuth, async (req, res) => {
  try {
    const list = await db.prepare(`
      SELECT rr.*, ep.name as employee_name, ep.department as employee_department,
             ep.position as employee_position, ep.mobile as employee_mobile
      FROM resignation_requests rr
      LEFT JOIN employee_profiles ep ON rr.employee_id = ep.id
      WHERE rr.handover_user_id = ? AND (
        (rr.status = 'submitted' AND rr.handover_confirm_time IS NULL)
        OR rr.status = 'handover_rejected'
      )
      ORDER BY rr.updated_at DESC
    `).all(req.session.userId) as ResignationRequestWithEmployee[]

    const withDocs = await Promise.all(list.map(async item => ({
      ...item,
      documents: await getRequestDocuments(item.id),
    })))

    res.json({ success: true, data: withDocs })
  } catch (error) {
    console.error('获取交接任务失败:', error)
    res.status(500).json({ success: false, message: '获取交接任务失败' })
  }
})

// 获取已完成的交接记录（交接人已确认的）
router.get('/handover-task/completed', requireAuth, async (req, res) => {
  try {
    const list = await db.prepare(`
      SELECT rr.*, ep.name as employee_name, ep.department as employee_department,
             ep.position as employee_position, ep.mobile as employee_mobile
      FROM resignation_requests rr
      LEFT JOIN employee_profiles ep ON rr.employee_id = ep.id
      WHERE rr.handover_user_id = ? AND rr.handover_confirm_time IS NOT NULL
      ORDER BY rr.handover_confirm_time DESC
    `).all(req.session.userId) as ResignationRequestWithEmployee[]

    const withDocs = await Promise.all(list.map(async item => ({
      ...item,
      documents: await getRequestDocuments(item.id),
    })))

    res.json({ success: true, data: withDocs })
  } catch (error) {
    console.error('获取已完成交接记录失败:', error)
    res.status(500).json({ success: false, message: '获取已完成交接记录失败' })
  }
})

router.get('/my-request', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const profile = await getMyEmployeeProfile(userId)
    const request = await db.prepare(`
      SELECT rr.*, ep.name as employee_name, ep.department as employee_department,
             ep.position as employee_position, ep.mobile as employee_mobile
      FROM resignation_requests rr
      LEFT JOIN employee_profiles ep ON rr.employee_id = ep.id
      WHERE rr.employee_user_id = ?
    `).get(userId) as ResignationRequestWithEmployee | undefined

    const data = request
      ? {
          profile,
          request,
          documents: await getRequestDocuments(request.id),
          templates: await getTemplates(),
        }
      : {
          profile,
          request: null,
          documents: [],
          templates: await getTemplates(),
        }

    res.json({ success: true, data })
  } catch (error) {
    console.error('获取我的离职申请失败:', error)
    res.status(500).json({ success: false, message: '获取我的离职申请失败' })
  }
})

router.post('/my-request', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { handover_user_id, resign_type, resign_date, reason } = req.body
    const profile = await getMyEmployeeProfile(userId)

    if (!profile) {
      return res.status(400).json({ success: false, message: '请先完善员工信息' })
    }
    if (!handover_user_id || !resign_type || !resign_date) {
      return res.status(400).json({ success: false, message: '请填写完整的离职信息' })
    }
    if (!['voluntary', 'contract_end', 'dismissal'].includes(resign_type)) {
      return res.status(400).json({ success: false, message: '离职类型不正确' })
    }
    if (handover_user_id === userId) {
      return res.status(400).json({ success: false, message: '交接人不能选择自己' })
    }

    const handoverUser = await db.prepare(`
      SELECT id, name FROM users WHERE id = ? AND status = 'active'
    `).get(handover_user_id) as { id: string; name: string } | undefined

    if (!handoverUser) {
      return res.status(400).json({ success: false, message: '交接人不存在或已停用' })
    }

    const existing = await db.prepare(`SELECT * FROM resignation_requests WHERE employee_user_id = ?`).get(userId) as ResignationRequest | undefined
    const now = new Date().toISOString()

    if (existing) {
      if (existing.status === 'approved') {
        return res.status(400).json({ success: false, message: '当前离职申请已审批通过，无法修改' })
      }

      // 仅在草稿或已驳回状态下允许编辑，其他状态需先撤回
      if (!['draft', 'rejected'].includes(existing.status)) {
        return res.status(400).json({ success: false, message: '申请已提交，如需修改请先撤回' })
      }

      await db.prepare(`
        UPDATE resignation_requests
        SET handover_user_id = ?, handover_name = ?, resign_type = ?, resign_date = ?, reason = ?,
            status = 'draft', employee_confirm_time = NULL, handover_confirm_time = NULL,
            submit_time = NULL, approve_time = NULL, approver_id = NULL, approver_comment = NULL,
            updated_at = ?
        WHERE id = ?
      `).run(handoverUser.id, handoverUser.name, resign_type, resign_date, reason || null, now, existing.id)

      const updated = await getResignationRequestById(existing.id)
      return res.json({ success: true, message: '保存成功', data: updated })
    }

    const id = nanoid()
    await db.prepare(`
      INSERT INTO resignation_requests (
        id, employee_id, employee_user_id, handover_user_id, handover_name,
        resign_type, resign_date, reason, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(
      id,
      profile.id,
      userId,
      handoverUser.id,
      handoverUser.name,
      resign_type,
      resign_date,
      reason || null,
      now,
      now,
    )

    const created = await getResignationRequestById(id)
    res.json({ success: true, message: '保存成功', data: created })
  } catch (error) {
    console.error('保存离职申请失败:', error)
    res.status(500).json({ success: false, message: '保存离职申请失败' })
  }
})

async function saveRequestDocument(options: {
  requestId: string
  file: Express.Multer.File
  originalFileName?: string
  documentType: ResignationDocumentType
  uploaderRole: ResignationUploaderRole
  uploadedBy: string
}) {
  const uploaderName = await getUploaderName(options.uploadedBy)
  const docId = nanoid()
  const now = new Date().toISOString()
  const relativePath = toStoredUploadPath(options.file.path, true)

  await db.transaction(async (client) => {
    const requestResult = await client.query(
      `SELECT * FROM resignation_requests WHERE id = $1 FOR UPDATE`,
      [options.requestId]
    )
    const request = requestResult.rows[0] as ResignationRequest | undefined
    if (!request) throw new ResignationOperationError('离职申请不存在', 404)
    if (options.uploaderRole === 'employee' && !canEmployeeEditDocuments(request)) {
      throw new ResignationOperationError('当前状态不允许修改离职材料，请先撤回申请', 409)
    }
    if (options.uploaderRole === 'handover' && !canHandoverEditDocuments(request)) {
      throw new ResignationOperationError('当前状态不允许修改交接材料', 409)
    }

    // 每种文档类型只保留最新的一份，旧文档标记为历史版本（不删除）。
    await client.query(
      `UPDATE resignation_documents SET is_current = 0
       WHERE request_id = $1 AND document_type = $2 AND uploader_role = $3 AND is_current = 1`,
      [options.requestId, options.documentType, options.uploaderRole]
    )

    await client.query(
      `INSERT INTO resignation_documents (
         id, request_id, document_type, uploader_role, file_name, file_path,
         file_size, mime_type, uploaded_by, uploaded_by_name, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        docId,
        options.requestId,
        options.documentType,
        options.uploaderRole,
        getSafeOriginalName(options.file, options.originalFileName),
        relativePath,
        options.file.size,
        options.file.mimetype,
        options.uploadedBy,
        uploaderName,
        now,
      ]
    )

    await client.query(
      `UPDATE resignation_requests SET updated_at = $1 WHERE id = $2`,
      [now, options.requestId]
    )
  })

  await refreshRequestStatus(options.requestId)

  return await db.prepare(`SELECT * FROM resignation_documents WHERE id = ?`).get(docId)
}

router.post('/my-request/upload-application', requireAuth, uploadResignationDocument.single('file'), async (req, res) => {
  try {
    const file = req.file
    const requestId = req.body.requestId
    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND employee_user_id = ?`).get(requestId, req.session.userId) as ResignationRequest | undefined
    if (!request) {
      fs.unlinkSync(file.path)
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }
    if (!canEmployeeEditDocuments(request)) {
      fs.unlinkSync(file.path)
      return res.status(409).json({ success: false, message: '当前状态不允许修改离职材料，请先撤回申请' })
    }

    const doc = await saveRequestDocument({
      requestId,
      file,
      originalFileName: req.body.originalFileName,
      documentType: 'application_form',
      uploaderRole: 'employee',
      uploadedBy: req.session.userId!,
    })

    res.json({ success: true, message: '离职申请表上传成功', data: doc })
  } catch (error) {
    console.error('上传离职申请表失败:', error)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    if (error instanceof ResignationOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '上传离职申请表失败' })
  }
})

router.post('/my-request/upload-handover', requireAuth, uploadResignationDocument.single('file'), async (req, res) => {
  try {
    const file = req.file
    const requestId = req.body.requestId
    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND employee_user_id = ?`).get(requestId, req.session.userId) as ResignationRequest | undefined
    if (!request) {
      fs.unlinkSync(file.path)
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }
    if (!canEmployeeEditDocuments(request)) {
      fs.unlinkSync(file.path)
      return res.status(409).json({ success: false, message: '当前状态不允许修改离职材料，请先撤回申请' })
    }

    const doc = await saveRequestDocument({
      requestId,
      file,
      originalFileName: req.body.originalFileName,
      documentType: 'handover_form_employee',
      uploaderRole: 'employee',
      uploadedBy: req.session.userId!,
    })

    res.json({ success: true, message: '交接单上传成功', data: doc })
  } catch (error) {
    console.error('上传离职人交接单失败:', error)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    if (error instanceof ResignationOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '上传交接单失败' })
  }
})

// 通用文档上传接口 - 用于上传补充材料（终止劳动关系证明、固定资产交接单等）
router.post('/my-request/upload-document', requireAuth, uploadResignationDocument.single('file'), async (req, res) => {
  try {
    const file = req.file
    const requestId = req.body.requestId
    const documentType = req.body.document_type as ResignationDocumentType

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    // 验证文档类型是否合法
    const validTypes: ResignationDocumentType[] = [
      'application_form', 'handover_form_employee', 'handover_form_handover',
      'termination_proof', 'asset_handover', 'compensation_agreement', 'expense_settlement_agreement',
    ]
    if (!documentType || !validTypes.includes(documentType)) {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '文档类型不正确' })
    }

    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND employee_user_id = ?`).get(requestId, req.session.userId) as ResignationRequest | undefined
    if (!request) {
      fs.unlinkSync(file.path)
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }
    if (!canEmployeeEditDocuments(request)) {
      fs.unlinkSync(file.path)
      return res.status(409).json({ success: false, message: '当前状态不允许修改离职材料，请先撤回申请' })
    }

    const doc = await saveRequestDocument({
      requestId,
      file,
      originalFileName: req.body.originalFileName,
      documentType,
      uploaderRole: 'employee',
      uploadedBy: req.session.userId!,
    })

    const label = RESIGNATION_DOCUMENT_LABELS[documentType] || '文档'
    res.json({ success: true, message: `${label}上传成功`, data: doc })
  } catch (error) {
    console.error('上传离职文档失败:', error)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    if (error instanceof ResignationOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '上传文档失败' })
  }
})

// 删除已上传的文档
router.delete('/my-request/documents/:docId', requireAuth, async (req, res) => {
  try {
    const { docId } = req.params
    const userId = req.session.userId!

    const document = await db.prepare(`
      SELECT rd.*, rr.employee_user_id, rr.status as request_status
      FROM resignation_documents rd
      JOIN resignation_requests rr ON rd.request_id = rr.id
      WHERE rd.id = ?
    `).get(docId) as (ResignationDocument & { employee_user_id: string; request_status: string }) | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文档不存在' })
    }

    // 只有文档所属离职申请的申请人才能删除自己上传的文档
    if (document.employee_user_id !== userId || document.uploaded_by !== userId) {
      return res.status(403).json({ success: false, message: '无权删除该文档' })
    }

    if (!EMPLOYEE_EDITABLE_STATUSES.includes(document.request_status as ResignationRequest['status'])) {
      return res.status(409).json({ success: false, message: '当前状态不允许删除离职材料，请先撤回申请' })
    }

    // 删除物理文件
    const filePath = path.join(process.cwd(), document.file_path)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)

    // 删除数据库记录
    await db.prepare(`DELETE FROM resignation_documents WHERE id = ?`).run(docId)

    // 更新申请的 updated_at
    const now = new Date().toISOString()
    await db.prepare(`UPDATE resignation_requests SET updated_at = ? WHERE id = ?`).run(now, document.request_id)

    // 刷新状态
    await refreshRequestStatus(document.request_id)

    const label = RESIGNATION_DOCUMENT_LABELS[document.document_type as ResignationDocumentType] || '文档'
    res.json({ success: true, message: `${label}已删除` })
  } catch (error) {
    console.error('删除离职文档失败:', error)
    res.status(500).json({ success: false, message: '删除文档失败' })
  }
})

router.post('/my-request/submit', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.body
    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND employee_user_id = ?`).get(requestId, req.session.userId) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }
    if (!EMPLOYEE_EDITABLE_STATUSES.includes(request.status)) {
      return res.status(409).json({ success: false, message: '当前状态不允许提交离职申请' })
    }

    const documents = await getRequestDocuments(requestId)
    const missingLabels = getMissingRequiredDocumentLabels(request, documents)

    if (missingLabels.length > 0) {
      return res.status(400).json({
        success: false,
        message: `请先上传以下材料：${missingLabels.join('、')}`,
        data: {
          missingDocumentTypes: getMissingRequiredDocumentTypes(request, documents),
          missingDocumentLabels: missingLabels,
        },
      })
    }

    const now = new Date().toISOString()
    const isResubmit = request.status === 'rejected'
    await db.prepare(`
      UPDATE resignation_requests
      SET status = 'submitted', submit_time = ?, reject_target = NULL,
          approve_time = NULL, approver_id = NULL, approver_comment = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(now, now, requestId)

    await refreshRequestStatus(requestId)
    await addAuditLog(requestId, isResubmit ? '重新提交离职申请' : '提交离职申请', req.session.userId!)
    res.json({ success: true, message: '离职申请已提交' })
  } catch (error) {
    console.error('提交离职申请失败:', error)
    res.status(500).json({ success: false, message: '提交离职申请失败' })
  }
})

// 撤回已提交的离职申请，回退到草稿状态
router.post('/my-request/withdraw', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.body
    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND employee_user_id = ?`).get(requestId, req.session.userId) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }

    // 允许在"已提交"且交接人尚未确认时，或"已驳回"时撤回
    const canWithdraw = (request.status === 'submitted' && !request.handover_confirm_time)
      || request.status === 'rejected'
    if (!canWithdraw) {
      return res.status(400).json({ success: false, message: '当前状态不允许撤回' })
    }

    const now = new Date().toISOString()
    await db.prepare(`
      UPDATE resignation_requests
      SET status = 'draft', submit_time = NULL,
          employee_confirm_time = NULL, handover_confirm_time = NULL,
          approver_id = NULL, approver_comment = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(now, requestId)

    await refreshRequestStatus(requestId)
    await addAuditLog(requestId, '撤回离职申请', req.session.userId!)
    res.json({ success: true, message: '离职申请已撤回' })
  } catch (error) {
    console.error('撤回离职申请失败:', error)
    res.status(500).json({ success: false, message: '撤回离职申请失败' })
  }
})

// 删除离职申请（仅草稿或已驳回状态）
router.delete('/my-request', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE employee_user_id = ?`).get(userId) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }

    if (!['draft', 'rejected'].includes(request.status)) {
      return res.status(400).json({ success: false, message: '当前状态不允许删除' })
    }

    // 删除关联的文档文件
    const documents = await getRequestDocuments(request.id)
    for (const doc of documents) {
      const filePath = path.join(process.cwd(), doc.file_path)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    // 数据库级联删除会自动清理 resignation_documents
    await db.prepare(`DELETE FROM resignation_requests WHERE id = ?`).run(request.id)

    res.json({ success: true, message: '离职申请已删除' })
  } catch (error) {
    console.error('删除离职申请失败:', error)
    res.status(500).json({ success: false, message: '删除离职申请失败' })
  }
})

router.post('/my-request/confirm', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.body
    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND employee_user_id = ?`).get(requestId, req.session.userId) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }
    if (!request.submit_time) {
      return res.status(400).json({ success: false, message: '请先提交离职申请' })
    }
    if (!['submitted', 'handover_confirmed'].includes(request.status) || request.employee_confirm_time) {
      return res.status(409).json({ success: false, message: '当前状态不允许重复确认' })
    }

    const now = new Date().toISOString()
    await db.prepare(`
      UPDATE resignation_requests SET employee_confirm_time = ?, updated_at = ? WHERE id = ?
    `).run(now, now, requestId)

    const status = await refreshRequestStatus(requestId)
    await addAuditLog(requestId, '离职人确认交接完成', req.session.userId!)
    res.json({ success: true, message: '已确认交接完成', data: { status } })
  } catch (error) {
    console.error('确认离职交接失败:', error)
    res.status(500).json({ success: false, message: '确认离职交接失败' })
  }
})

router.post('/:id/handover-upload', requireAuth, uploadResignationDocument.single('file'), async (req, res) => {
  try {
    const file = req.file
    const { id } = req.params
    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND handover_user_id = ?`).get(id, req.session.userId) as ResignationRequest | undefined
    if (!request) {
      fs.unlinkSync(file.path)
      return res.status(404).json({ success: false, message: '交接任务不存在' })
    }

    if (!canHandoverEditDocuments(request)) {
      fs.unlinkSync(file.path)
      return res.status(409).json({ success: false, message: '当前状态不允许修改交接材料' })
    }

    // handover_rejected 状态下重新上传：先删除旧文件，再重置确认时间和状态
    if (request.status === 'handover_rejected') {
      const oldDocs = await db.prepare(`
        SELECT * FROM resignation_documents WHERE request_id = ? AND document_type = 'handover_form_handover' AND is_current = 1
      `).all(id) as ResignationDocument[]
      for (const oldDoc of oldDocs) {
        const filePath = path.join(process.cwd(), oldDoc.file_path)
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        await db.prepare(`DELETE FROM resignation_documents WHERE id = ?`).run(oldDoc.id)
      }
      // 重置确认时间和状态回 submitted
      const now = new Date().toISOString()
      await db.prepare(`
        UPDATE resignation_requests
        SET handover_confirm_time = NULL, status = 'submitted', reject_target = NULL, approver_comment = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, id)
      await addAuditLog(id, '交接人重新提交交接单', req.session.userId!)
    }

    const doc = await saveRequestDocument({
      requestId: id,
      file,
      originalFileName: req.body.originalFileName,
      documentType: 'handover_form_handover',
      uploaderRole: 'handover',
      uploadedBy: req.session.userId!,
    })

    res.json({ success: true, message: '交接单上传成功', data: doc })
  } catch (error) {
    console.error('上传交接人交接单失败:', error)
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path)
    if (error instanceof ResignationOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '上传交接单失败' })
  }
})

// 交接人在线签名确认：将签名合成到离职人交接单 PDF，生成交接人交接单
router.post('/:id/handover-sign', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const { signatureDataUrl } = req.body

    if (!signatureDataUrl || !signatureDataUrl.startsWith('data:image/png;base64,')) {
      return res.status(400).json({ success: false, message: '签名数据无效' })
    }

    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND handover_user_id = ?`).get(id, req.session.userId) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '交接任务不存在' })
    }

    if (!canHandoverEditDocuments(request)) {
      return res.status(409).json({ success: false, message: '当前状态不允许修改交接材料' })
    }

    // handover_rejected 状态下重新签名：先删除旧文件，再重置状态
    if (request.status === 'handover_rejected') {
      const oldDocs = await db.prepare(`
        SELECT * FROM resignation_documents WHERE request_id = ? AND document_type = 'handover_form_handover' AND is_current = 1
      `).all(id) as ResignationDocument[]
      for (const oldDoc of oldDocs) {
        const filePath = path.join(process.cwd(), oldDoc.file_path)
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        await db.prepare(`DELETE FROM resignation_documents WHERE id = ?`).run(oldDoc.id)
      }
      const nowReset = new Date().toISOString()
      await db.prepare(`
        UPDATE resignation_requests
        SET handover_confirm_time = NULL, status = 'submitted', reject_target = NULL, approver_comment = NULL, updated_at = ?
        WHERE id = ?
      `).run(nowReset, id)
    }

    // 获取离职人上传的交接单
    const employeeHandoverDoc = await db.prepare(`
      SELECT * FROM resignation_documents
      WHERE request_id = ? AND document_type = 'handover_form_employee' AND uploader_role = 'employee'
      ORDER BY created_at DESC LIMIT 1
    `).get(id) as ResignationDocument | undefined

    if (!employeeHandoverDoc) {
      return res.status(400).json({ success: false, message: '离职人尚未上传交接单' })
    }

    const sourcePath = path.join(process.cwd(), employeeHandoverDoc.file_path)
    if (!fs.existsSync(sourcePath)) {
      return res.status(400).json({ success: false, message: '离职人交接单文件不存在' })
    }

    // 解析签名图片
    const sigBase64 = signatureDataUrl.replace('data:image/png;base64,', '')
    const sigBytes = Buffer.from(sigBase64, 'base64')

    const uploaderName = await getUploaderName(req.session.userId!) || '交接人'
    const now = new Date().toISOString()
    const dateStr = new Date().toLocaleDateString('zh-CN')

    // 根据原文件类型处理
    const mimeType = employeeHandoverDoc.mime_type || ''
    let outputFileName: string
    let outputRelativePath: string
    let outputMimeType: string

    const destDir = ensureDatedUploadDirectory('resignation-documents', new Date(), id)

    if (mimeType === 'application/pdf') {
      // PDF: 在最后一页底部合成签名
      const pdfBytes = fs.readFileSync(sourcePath)
      const pdfDoc = await PDFDocument.load(pdfBytes)
      const pages = pdfDoc.getPages()
      const lastPage = pages[pages.length - 1]
      const { width, height } = lastPage.getSize()

      const sigImage = await pdfDoc.embedPng(sigBytes)
      const sigDims = sigImage.scale(1)
      // 签名区域：右下角，宽度不超过页面 1/3，高度按比例缩放
      const maxW = width / 3
      const scale = Math.min(maxW / sigDims.width, 60 / sigDims.height)
      const sigW = sigDims.width * scale
      const sigH = sigDims.height * scale

      lastPage.drawImage(sigImage, {
        x: width - sigW - 40,
        y: 40,
        width: sigW,
        height: sigH,
      })

      // 在签名下方添加日期文字 (使用 Helvetica，中文日期用数字)
      const font = await pdfDoc.embedFont('Helvetica' as any)
      lastPage.drawText(dateStr, {
        x: width - sigW - 40,
        y: 28,
        size: 9,
        font,
      })

      outputFileName = `signed-handover-${Date.now()}.pdf`
      const outputPath = path.join(destDir, outputFileName)
      const signedPdfBytes = await pdfDoc.save()
      fs.writeFileSync(outputPath, signedPdfBytes)
      outputRelativePath = toStoredUploadPath(outputPath, true)
      outputMimeType = 'application/pdf'
    } else {
      // 图片 (jpg/png): 用 canvas 将签名绘制到图片右下角
      // 由于服务端 canvas 可能不可用，直接保存签名图片作为独立文件
      outputFileName = `signature-${Date.now()}.png`
      const outputPath = path.join(destDir, outputFileName)
      fs.writeFileSync(outputPath, sigBytes)
      outputRelativePath = toStoredUploadPath(outputPath, true)
      outputMimeType = 'image/png'
    }

    // 保存为交接人交接单文档
    const signedDocName = mimeType === 'application/pdf'
      ? `${employeeHandoverDoc.file_name.replace(/\.pdf$/i, '')}_已签名.pdf`
      : `${uploaderName}_签名确认.png`

    const doc = await saveRequestDocument({
      requestId: id,
      file: {
        filename: outputFileName,
        originalname: signedDocName,
        path: path.join(destDir, outputFileName),
        size: fs.statSync(path.join(destDir, outputFileName)).size,
        mimetype: outputMimeType,
      } as Express.Multer.File,
      originalFileName: signedDocName,
      documentType: 'handover_form_handover',
      uploaderRole: 'handover',
      uploadedBy: req.session.userId!,
    })

    res.json({ success: true, message: '签名确认成功', data: doc })
  } catch (error) {
    console.error('签名确认失败:', error)
    if (error instanceof ResignationOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '签名确认失败' })
  }
})

// 交接人删除自己上传的文档
router.delete('/:id/handover-documents/:docId', requireAuth, async (req, res) => {
  try {
    const { id, docId } = req.params
    const userId = req.session.userId!

    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND handover_user_id = ?`).get(id, userId) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '交接任务不存在' })
    }

    if (!canHandoverEditDocuments(request)) {
      return res.status(409).json({ success: false, message: '当前状态不允许删除交接材料' })
    }

    const document = await db.prepare(`
      SELECT * FROM resignation_documents WHERE id = ? AND request_id = ? AND uploaded_by = ?
    `).get(docId, id, userId) as ResignationDocument | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文档不存在' })
    }

    const filePath = path.join(process.cwd(), document.file_path)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    await db.prepare(`DELETE FROM resignation_documents WHERE id = ?`).run(docId)

    const now = new Date().toISOString()
    await db.prepare(`UPDATE resignation_requests SET updated_at = ? WHERE id = ?`).run(now, id)
    await refreshRequestStatus(id)

    res.json({ success: true, message: '交接单已删除' })
  } catch (error) {
    console.error('删除交接人文档失败:', error)
    res.status(500).json({ success: false, message: '删除文档失败' })
  }
})

router.post('/:id/handover-confirm', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ? AND handover_user_id = ?`).get(id, req.session.userId) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '交接任务不存在' })
    }
    if (!request.submit_time) {
      return res.status(400).json({ success: false, message: '该离职申请尚未提交' })
    }
    if (request.status !== 'submitted' || request.handover_confirm_time) {
      return res.status(409).json({ success: false, message: '当前状态不允许重复确认' })
    }

    const documents = await getRequestDocuments(id)
    const hasHandoverForm = documents.some(doc => doc.document_type === 'handover_form_handover' && doc.uploader_role === 'handover')
    if (!hasHandoverForm) {
      return res.status(400).json({ success: false, message: '请先上传交接单' })
    }

    const now = new Date().toISOString()
    await db.prepare(`
      UPDATE resignation_requests SET handover_confirm_time = ?, updated_at = ? WHERE id = ?
    `).run(now, now, id)

    const status = await refreshRequestStatus(id)
    await addAuditLog(id, '交接人确认交接完成', req.session.userId!)
    res.json({ success: true, message: '已确认交接完成', data: { status } })
  } catch (error) {
    console.error('交接人确认失败:', error)
    res.status(500).json({ success: false, message: '交接人确认失败' })
  }
})

// 获取某个离职申请的历史交接单（包含已替换的旧版本）
router.get('/:id/document-history', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session.userId!

    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ?`).get(id) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }

    const isAdmin = await isDatabaseAdmin(userId)
    if (!canAccessRequest(request, userId, isAdmin)) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    // 只返回交接单相关的文档（含历史版本）
    const docs = await db.prepare(`
      SELECT * FROM resignation_documents
      WHERE request_id = ? AND document_type IN ('handover_form_employee', 'handover_form_handover')
      ORDER BY created_at DESC
    `).all(id) as ResignationDocument[]

    res.json({ success: true, data: docs })
  } catch (error) {
    console.error('获取历史交接单失败:', error)
    res.status(500).json({ success: false, message: '获取历史记录失败' })
  }
})

// 获取审批流程日志
router.get('/:id/audit-logs', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ?`).get(id) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }

    const isAdmin = await isDatabaseAdmin(req.session.userId!)
    if (!canAccessRequest(request, req.session.userId!, isAdmin)) {
      return res.status(403).json({ success: false, message: '无权查看' })
    }

    const logs = await db.prepare(`
      SELECT * FROM resignation_audit_logs
      WHERE request_id = ?
      ORDER BY created_at ASC
    `).all(id)

    res.json({ success: true, data: logs })
  } catch (error) {
    console.error('获取审批流程失败:', error)
    res.status(500).json({ success: false, message: '获取审批流程失败' })
  }
})

router.get('/management', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query
    let sql = `
      SELECT rr.*, ep.name as employee_name, ep.department as employee_department,
             ep.position as employee_position, ep.mobile as employee_mobile
      FROM resignation_requests rr
      LEFT JOIN employee_profiles ep ON rr.employee_id = ep.id
      WHERE 1=1
    `
    const params: any[] = []

    if (status) {
      sql += ' AND rr.status = ?'
      params.push(status)
    } else {
      // 默认只显示双方已完成确认后的记录（mutual_confirmed、approved、rejected）
      sql += ` AND rr.status IN ('mutual_confirmed', 'approved', 'rejected')`
    }

    sql += ' ORDER BY rr.updated_at DESC'
    const list = await db.prepare(sql).all(...params) as ResignationRequestWithEmployee[]
    const withDocs = await Promise.all(list.map(async item => ({
      ...item,
      documents: await getRequestDocuments(item.id),
    })))

    res.json({ success: true, data: withDocs })
  } catch (error) {
    console.error('获取离职管理列表失败:', error)
    res.status(500).json({ success: false, message: '获取离职管理列表失败' })
  }
})

router.get('/management/:id', requireAdmin, async (req, res) => {
  try {
    const detail = await getResignationRequestById(req.params.id)
    if (!detail) {
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }

    const requiredDocumentTypes = getRequiredDocumentTypes(detail.resign_type)
    const documents = await getRequestDocuments(detail.id)
    const missingDocumentTypes = getMissingRequiredDocumentTypes(detail, documents)

    res.json({
      success: true,
      data: {
        request: detail,
        documents,
        templates: await getTemplates(),
        requiredDocumentTypes,
        missingDocumentTypes,
      },
    })
  } catch (error) {
    console.error('获取离职详情失败:', error)
    res.status(500).json({ success: false, message: '获取离职详情失败' })
  }
})

router.post('/management/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { comment } = req.body
    const operatorId = req.session.userId!
    const now = new Date().toISOString()

    await db.transaction(async (client) => {
      const requestResult = await client.query(
        `SELECT * FROM resignation_requests WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      )
      const request = requestResult.rows[0] as ResignationRequest | undefined
      if (!request) throw new ResignationOperationError('离职申请不存在', 404)

      const documentsResult = await client.query(
        `SELECT * FROM resignation_documents
         WHERE request_id = $1 AND is_current = 1
         ORDER BY created_at DESC`,
        [request.id]
      )
      const status = computeStatus(request, documentsResult.rows as ResignationDocument[])
      if (status !== 'mutual_confirmed') {
        throw new ResignationOperationError('双方尚未完成交接确认，无法审批通过', 409)
      }

      await client.query(
        `UPDATE resignation_requests
         SET status = 'approved', approve_time = $1, approver_id = $2,
             approver_comment = $3, reject_target = NULL, updated_at = $4
         WHERE id = $5`,
        [now, operatorId, String(comment || '').trim() || null, now, request.id]
      )

      const employeeResult = await client.query(
        `UPDATE employee_profiles
         SET employment_status = 'resigned', updated_at = $1
         WHERE id = $2`,
        [now, request.employee_id]
      )
      if ((employeeResult.rowCount ?? 0) !== 1) {
        throw new ResignationOperationError('员工档案不存在，无法完成离职审批', 409)
      }

      await addAuditLogWithClient(
        client,
        request.id,
        '管理员审批通过',
        operatorId,
        String(comment || '').trim() || null,
        now
      )
    })

    res.json({ success: true, message: '离职审批通过' })
  } catch (error) {
    console.error('审批通过离职申请失败:', error)
    if (error instanceof ResignationOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '审批通过离职申请失败' })
  }
})

router.delete('/management/:id', requireAdmin, async (req, res) => {
  try {
    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ?`).get(req.params.id) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }

    if (!['draft', 'rejected'].includes(request.status)) {
      return res.status(400).json({ success: false, message: '只能删除草稿或已驳回的离职申请' })
    }

    const documents = await db.prepare(`SELECT * FROM resignation_documents WHERE request_id = ?`).all(request.id) as ResignationDocument[]
    for (const doc of documents) {
      const filePath = path.join(process.cwd(), doc.file_path)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    await db.prepare(`DELETE FROM resignation_requests WHERE id = ?`).run(request.id)

    res.json({ success: true, message: '离职申请已删除' })
  } catch (error) {
    console.error('管理员删除离职申请失败:', error)
    res.status(500).json({ success: false, message: '删除离职申请失败' })
  }
})

router.post('/management/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { comment, rejectTarget } = req.body
    if (!String(comment || '').trim()) {
      return res.status(400).json({ success: false, message: '请填写驳回原因' })
    }
    if (!['employee', 'handover', 'both'].includes(rejectTarget)) {
      return res.status(400).json({ success: false, message: '请选择有效的驳回对象' })
    }

    const operatorId = req.session.userId!
    const now = new Date().toISOString()

    // 根据驳回对象生成不同日志描述
    const targetLabel: Record<string, string> = {
      employee: '（驳回给离职人）',
      handover: '（驳回给交接人）',
      both: '（同时驳回给离职人和交接人）',
    }
    const suffix = targetLabel[rejectTarget] || ''

    await db.transaction(async (client) => {
      const requestResult = await client.query(
        `SELECT * FROM resignation_requests WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      )
      const request = requestResult.rows[0] as ResignationRequest | undefined
      if (!request) throw new ResignationOperationError('离职申请不存在', 404)

      const documentsResult = await client.query(
        `SELECT * FROM resignation_documents
         WHERE request_id = $1 AND is_current = 1
         ORDER BY created_at DESC`,
        [request.id]
      )
      const status = computeStatus(request, documentsResult.rows as ResignationDocument[])
      if (status !== 'mutual_confirmed') {
        throw new ResignationOperationError('只有等待管理员审批的申请可以驳回', 409)
      }

      const newStatus: ResignationRequest['status'] = rejectTarget === 'handover' ? 'handover_rejected' : 'rejected'
      const clearEmployeeConfirmation = rejectTarget === 'employee' || rejectTarget === 'both'
      const clearHandoverConfirmation = true

      await client.query(
        `UPDATE resignation_requests
         SET status = $1,
             reject_target = $2,
             employee_confirm_time = CASE WHEN $3 THEN NULL ELSE employee_confirm_time END,
             handover_confirm_time = CASE WHEN $4 THEN NULL ELSE handover_confirm_time END,
             approver_id = $5,
             approver_comment = $6,
             approve_time = NULL,
             updated_at = $7
         WHERE id = $8`,
        [
          newStatus,
          rejectTarget,
          clearEmployeeConfirmation,
          clearHandoverConfirmation,
          operatorId,
          String(comment).trim(),
          now,
          request.id,
        ]
      )

      await addAuditLogWithClient(
        client,
        request.id,
        `管理员驳回申请${suffix}`,
        operatorId,
        String(comment).trim(),
        now
      )
    })

    res.json({ success: true, message: '已驳回离职申请' })
  } catch (error) {
    console.error('驳回离职申请失败:', error)
    if (error instanceof ResignationOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '驳回离职申请失败' })
  }
})

router.get('/requests/:id/documents/:docId/download', requireAuth, async (req, res) => {
  try {
    const request = await db.prepare(`SELECT * FROM resignation_requests WHERE id = ?`).get(req.params.id) as ResignationRequest | undefined
    if (!request) {
      return res.status(404).json({ success: false, message: '离职申请不存在' })
    }

    const isAdmin = await isDatabaseAdmin(req.session.userId!)
    if (!canAccessRequest(request, req.session.userId!, isAdmin)) {
      return res.status(403).json({ success: false, message: '无权查看该文件' })
    }

    const document = await db.prepare(`
      SELECT * FROM resignation_documents WHERE id = ? AND request_id = ?
    `).get(req.params.docId, req.params.id) as ResignationDocument | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    const filePath = path.join(process.cwd(), document.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream')
    // 支持 ?download=1 强制下载
    const forceDownload = req.query.download === '1'
    const disposition = forceDownload ? 'attachment' : (isInlinePreviewMimeType(document.mime_type) ? 'inline' : 'attachment')
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(document.file_name)}"`)
    fs.createReadStream(filePath).pipe(res)
  } catch (error) {
    console.error('下载离职附件失败:', error)
    res.status(500).json({ success: false, message: '下载离职附件失败' })
  }
})

router.get('/handover-candidates', requireAuth, async (req, res) => {
  try {
    const candidates = await db.prepare(`
      SELECT id, name, department, position
      FROM users
      WHERE status = 'active' AND role IN ('user', 'admin', 'general_manager', 'super_admin') AND id != ?
      ORDER BY name ASC
    `).all(req.session.userId) as Array<{ id: string; name: string; department: string | null; position: string | null }>

    res.json({ success: true, data: candidates })
  } catch (error) {
    console.error('获取交接人候选列表失败:', error)
    res.status(500).json({ success: false, message: '获取交接人候选列表失败' })
  }
})

export default router
