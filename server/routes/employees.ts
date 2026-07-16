import { Router, type Response } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { db } from '../db/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import type { EmployeeProfile, EmployeeDocument, EmployeeResignationArchive, ProbationConfirmation } from '../types/database.js'
import { nanoid } from 'nanoid'
import { ensureDatedUploadDirectory, toStoredUploadPath } from '../utils/upload-date.js'
import {
  recognizeInvitationMonthlySalary,
  type InvitationSalaryRecognition,
} from '../services/invitationSalaryOcr.js'
import {
  recognizeEmploymentContractTerm,
  type EmploymentContractTermRecognition,
} from '../services/employmentContractOcr.js'
import { syncEmployeeCurrentAndFuturePayroll } from '../services/payrollRecordSync.js'
import {
  type EmployeeDocumentType,
} from '../services/employeeDocumentClassifier.js'
import {
  analyzeEmployeeDocumentBundle,
  splitEmployeeDocumentBundle,
  type SplitEmployeeDocumentFile,
} from '../services/employeeDocumentBundle.js'
import {
  EmployeeNumberFieldNotFoundError,
  isNumberedOnboardingDocumentType,
  writeEmployeeNumberToOnboardingTemplate,
} from '../services/onboardingTemplateNumber.js'
import { isValidEmployeeNumber, normalizeEmployeeNumber } from '../utils/employee-number.js'

const router = Router()

class EmployeeOperationError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message)
    this.name = 'EmployeeOperationError'
  }
}

const EMPLOYEE_DOCUMENT_TYPES = new Set<EmployeeDocumentType>([
  'invitation',
  'application',
  'contract',
  'nda',
  'declaration',
  'asset_handover',
  'id_card',
  'health_report',
  'diploma',
  'bank_card',
  'other',
])

function isEmployeeDocumentType(value: unknown): value is EmployeeDocumentType {
  return typeof value === 'string' && EMPLOYEE_DOCUMENT_TYPES.has(value as EmployeeDocumentType)
}

function sendEmployeeDocument(
  res: Response,
  document: EmployeeDocument,
  filePath: string,
): void {
  res.setHeader('Content-Type', document.mime_type || 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.file_name)}"`)
  res.setHeader('Cache-Control', 'no-store')
  fs.createReadStream(filePath).pipe(res)
}

const ONBOARDING_TEMPLATE_TYPES = new Set([
  'invitation',
  'application',
  'contract',
  'nda',
  'declaration',
  'asset',
])

function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// 配置 multer 用于员工档案文件上传
const uploadEmployeeDoc = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const employeeId = req.params.id
      const destDir = ensureDatedUploadDirectory('employee-documents', new Date(), employeeId)
      cb(null, destDir)
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname)
      const filename = `document-${Date.now()}-${nanoid(6)}${ext.toLowerCase()}`
      cb(null, filename)
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
    ]
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 PDF 格式的文件'))
    }
  },
})

function removeUploadedEmployeeDocument(file: Express.Multer.File | undefined): void {
  if (!file) return
  try {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path)
  } catch {
    // 忽略上传失败后的文件清理错误
  }
}

function resolveOriginalFileName(file: Express.Multer.File, originalFileName: unknown): string {
  if (typeof originalFileName === 'string' && originalFileName.trim()) {
    return path.basename(originalFileName.trim())
  }
  return path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'))
}

interface EmployeeDocumentFileToPersist {
  documentType: EmployeeDocumentType
  filePath: string
  originalFileName: string
  fileSize: number
  mimeType: string
}

interface PersistEmployeeDocumentsOptions {
  employeeId: string
  files: EmployeeDocumentFileToPersist[]
  uploaderId: string
}

interface PreparedEmployeeDocumentFile extends EmployeeDocumentFileToPersist {
  documentId: string
  relativePath: string
  salaryRecognition: InvitationSalaryRecognition | null
  contractRecognition: EmploymentContractTermRecognition | null
}

async function persistEmployeeDocuments(options: PersistEmployeeDocumentsOptions) {
  const { employeeId, files, uploaderId } = options
  if (files.length === 0) throw new Error('没有可归档的员工档案文件')

  const uploader = await db.prepare(`
    SELECT name FROM users WHERE id = ?
  `).get(uploaderId) as { name: string } | undefined

  const now = new Date().toISOString()
  const preparedFiles: PreparedEmployeeDocumentFile[] = []
  for (const file of files) {
    const salaryRecognition = file.documentType === 'invitation'
      ? await recognizeInvitationMonthlySalary(file.filePath)
      : null
    const contractRecognition = file.documentType === 'contract'
      ? await recognizeEmploymentContractTerm(file.filePath)
      : null
    preparedFiles.push({
      ...file,
      documentId: nanoid(),
      relativePath: toStoredUploadPath(file.filePath, true),
      salaryRecognition,
      contractRecognition,
    })
  }

  const transactionResult = await db.transaction(async (client) => {
    const insertedDocuments: EmployeeDocument[] = []

    for (const file of preparedFiles) {
      const insertResult = await client.query<EmployeeDocument>(
        `INSERT INTO employee_documents (
           id, employee_id, document_type, file_name, file_path,
           file_size, mime_type, uploaded_by, uploaded_by_name,
           contract_start_date, contract_end_date, contract_recognized_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          file.documentId,
          employeeId,
          file.documentType,
          file.originalFileName,
          file.relativePath,
          file.fileSize,
          file.mimeType,
          uploaderId,
          uploader?.name || null,
          file.contractRecognition?.status === 'success'
            ? file.contractRecognition.contractStartDate
            : null,
          file.contractRecognition?.status === 'success'
            ? file.contractRecognition.contractEndDate
            : null,
          file.contractRecognition?.status === 'success' ? now : null,
          now,
        ],
      )

      if (file.salaryRecognition?.status === 'success' && file.salaryRecognition.monthlySalary) {
        await client.query(
          `INSERT INTO employee_salary_profiles (
             employee_id, initial_monthly_salary, source_document_id,
             recognized_at, created_at, updated_at
           ) VALUES ($1,$2::numeric,$3,$4,$4,$4)
           ON CONFLICT (employee_id) DO UPDATE SET
             initial_monthly_salary = EXCLUDED.initial_monthly_salary,
             source_document_id = EXCLUDED.source_document_id,
             recognized_at = EXCLUDED.recognized_at,
             updated_at = EXCLUDED.updated_at`,
          [employeeId, file.salaryRecognition.monthlySalary, file.documentId, now],
        )

        await syncEmployeeCurrentAndFuturePayroll(client, employeeId, {
          resetManualMonthlySalary: true,
          ensureCurrentMonth: true,
          updatedAt: now,
        })
      }

      const insertedDocument = insertResult.rows[0]
      if (!insertedDocument) throw new Error('员工档案文件记录写入失败')
      insertedDocuments.push(insertedDocument)
    }

    let currentContractEndDate: string | null = null
    if (
      preparedFiles.some(
        (file) =>
          file.documentType === 'contract' &&
          file.contractRecognition?.status === 'success',
      )
    ) {
      const latestContractResult = await client.query<{ contract_end_date: string }>(
        `SELECT contract_end_date
         FROM employee_documents
         WHERE employee_id = $1
           AND document_type = 'contract'
           AND contract_end_date IS NOT NULL
         ORDER BY contract_end_date DESC, created_at DESC
         LIMIT 1`,
        [employeeId],
      )
      currentContractEndDate = latestContractResult.rows[0]?.contract_end_date ?? null
      await client.query(
        `UPDATE employee_profiles
         SET contract_end_date = $1, updated_at = $2
         WHERE id = $3`,
        [currentContractEndDate, now, employeeId],
      )
      await syncEmployeeCurrentAndFuturePayroll(client, employeeId, {
        resetManualMonthlySalary: false,
        ensureCurrentMonth: false,
        updatedAt: now,
      })
    }

    return { documents: insertedDocuments, currentContractEndDate }
  })

  return {
    documents: transactionResult.documents,
    salaryRecognition:
      preparedFiles.find((file) => file.documentType === 'invitation')?.salaryRecognition || null,
    contractRecognition:
      preparedFiles.find((file) => file.documentType === 'contract')?.contractRecognition || null,
    currentContractEndDate: transactionResult.currentContractEndDate,
  }
}

// 获取当前用户的档案文件列表（用于入职页面查看管理员上传的文件）
router.get('/my-documents', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId

    // 先获取当前用户的员工信息
    const profile = await db.prepare(`
      SELECT id FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string } | undefined

    if (!profile) {
      return res.json({
        success: true,
        data: []
      })
    }

    // 获取该员工的档案文件
    const documents = await db.prepare(`
      SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC
    `).all(profile.id) as EmployeeDocument[]

    res.json({
      success: true,
      data: documents,
    })
  } catch (error) {
    console.error('获取我的档案文件失败:', error)
    res.status(500).json({ success: false, message: '获取档案文件失败' })
  }
})

// 下载/预览当前用户的档案文件
router.get('/my-documents/:docId/download', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { docId } = req.params

    // 先获取当前用户的员工信息
    const profile = await db.prepare(`
      SELECT id FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string } | undefined

    if (!profile) {
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    // 获取文档信息，确保是当前用户的文档
    const document = await db.prepare(`
      SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?
    `).get(docId, profile.id) as EmployeeDocument | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文档不存在' })
    }

    const filePath = path.join(process.cwd(), document.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    sendEmployeeDocument(res, document, filePath)
  } catch (error) {
    console.error('下载我的档案文件失败:', error)
    res.status(500).json({ success: false, message: '下载档案文件失败' })
  }
})

// 获取当前用户的员工信息（用于入职页面）
router.get('/my-profile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId

    // 联合查询 employee_profiles 和 users 表，获取员工编号
    const profile = await db.prepare(`
      SELECT
        ep.*,
        COALESCE(u.employee_no, ep.employee_no) as employee_no,
        u.department as user_department,
        u.position as user_position
      FROM employee_profiles ep
      LEFT JOIN users u ON ep.user_id = u.id
      WHERE ep.user_id = ?
    `).get(userId) as (EmployeeProfile & { employee_no?: string; user_department?: string; user_position?: string }) | undefined

    // 如果 employee_profiles 中没有部门和职位，使用 users 表中的
    if (profile) {
      if (!profile.department && profile.user_department) {
        profile.department = profile.user_department
      }
      if (!profile.position && profile.user_position) {
        profile.position = profile.user_position
      }
    }

    // 如果没有 employee_profiles 记录，从 users 表获取基本信息，并自动创建草稿记录
    if (!profile) {
      const user = await db.prepare(`
        SELECT u.id, u.name, u.email, u.mobile, u.employee_no, u.department, u.position,
               u.bank_account_name, u.bank_account_phone, u.bank_name, u.bank_account_number
        FROM users u WHERE u.id = ?
      `).get(userId) as any | undefined

      if (user) {
        // 自动创建一条草稿记录（预填基本信息）
        const profileId = nanoid()
        const now = new Date().toISOString()
        await db.prepare(`
          INSERT INTO employee_profiles (id, user_id, name, employee_no, department, position, email, mobile, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
        `).run(profileId, user.id, user.name, user.employee_no, user.department, user.position, user.email || null, user.mobile, now, now)

        const newProfile = await db.prepare(`SELECT * FROM employee_profiles WHERE id = ?`).get(profileId) as any
        return res.json({
          success: true,
          data: newProfile
        })
      }
    }

    res.json({
      success: true,
      data: profile || null
    })
  } catch (error) {
    console.error('获取员工信息失败:', error)
    res.status(500).json({ success: false, message: '获取员工信息失败' })
  }
})

// 保存/更新当前用户的员工信息（草稿）
router.post('/my-profile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const data = req.body
    const now = new Date().toISOString()

    // 检查是否已有记录
    const existing = await db.prepare(`
      SELECT id, status, contract_end_date FROM employee_profiles WHERE user_id = ?
    `).get(userId) as {
      id: string
      status: string
      contract_end_date: string | null
    } | undefined

    // 如果已提交，不允许修改
    if (existing?.status === 'submitted') {
      return res.status(400).json({
        success: false,
        message: '员工信息已提交，无法修改'
      })
    }

    if (existing) {
      // 更新现有记录
      // 注意：department、position、employment_status 由管理员在用户管理中分配，用户不可自行修改
      await db.prepare(`
        UPDATE employee_profiles SET
          employee_no = ?,
          name = ?,
          gender = ?,
          birth_date = ?,
          id_number = ?,
          native_place = ?,
          ethnicity = ?,
          marital_status = ?,
          education = ?,
          school = ?,
          major = ?,
          mobile = ?,
          email = ?,
          emergency_contact = ?,
          emergency_phone = ?,
          address = ?,
          hire_date = ?,
          contract_end_date = ?,
          bank_account_name = ?,
          bank_account_phone = ?,
          bank_name = ?,
          bank_account_number = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        data.employee_no || null,
        data.name,
        data.gender || null,
        data.birth_date || null,
        data.id_number || null,
        data.native_place || null,
        data.ethnicity || null,
        data.marital_status || null,
        data.education || null,
        data.school || null,
        data.major || null,
        data.mobile || null,
        data.email || null,
        data.emergency_contact || null,
        data.emergency_phone || null,
        data.address || null,
        data.hire_date || null,
        existing.contract_end_date,
        data.bank_account_name || null,
        data.bank_account_phone || null,
        data.bank_name || null,
        data.bank_account_number || null,
        now,
        existing.id
      )

      const updated = await db.prepare(`
        SELECT * FROM employee_profiles WHERE id = ?
      `).get(existing.id)

      res.json({
        success: true,
        data: updated,
        message: '保存成功'
      })
    } else {
      // 创建新记录
      const id = nanoid()
      await db.prepare(`
        INSERT INTO employee_profiles (
          id, user_id, employee_no, name, gender, birth_date,
          id_number, native_place, ethnicity, marital_status,
          education, school, major, mobile, email,
          emergency_contact, emergency_phone, address,
          hire_date, contract_end_date, department, position,
          bank_account_name, bank_account_phone, bank_name, bank_account_number,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      `).run(
        id,
        userId,
        data.employee_no || null,
        data.name,
        data.gender || null,
        data.birth_date || null,
        data.id_number || null,
        data.native_place || null,
        data.ethnicity || null,
        data.marital_status || null,
        data.education || null,
        data.school || null,
        data.major || null,
        data.mobile || null,
        data.email || null,
        data.emergency_contact || null,
        data.emergency_phone || null,
        data.address || null,
        data.hire_date || null,
        null,
        data.department || null,
        data.position || null,
        data.bank_account_name || null,
        data.bank_account_phone || null,
        data.bank_name || null,
        data.bank_account_number || null,
        now,
        now
      )

      const created = await db.prepare(`
        SELECT * FROM employee_profiles WHERE id = ?
      `).get(id)

      res.json({
        success: true,
        data: created,
        message: '保存成功'
      })
    }
  } catch (error) {
    console.error('保存员工信息失败:', error)
    res.status(500).json({ success: false, message: '保存员工信息失败' })
  }
})

// 提交当前用户的员工信息
router.post('/my-profile/submit', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const now = new Date().toISOString()
    let employeeId = ''

    await db.transaction(async (client) => {
      const profileResult = await client.query<{
        id: string
        status: string
        name: string
        hire_date: string | null
        employment_status: string | null
      }>(
        `SELECT id, status, name, hire_date, employment_status
         FROM employee_profiles
         WHERE user_id = $1
         FOR UPDATE`,
        [userId]
      )
      const existing = profileResult.rows[0]

      if (!existing) throw new EmployeeOperationError('请先填写员工信息')
      if (existing.status === 'submitted') throw new EmployeeOperationError('员工信息已提交', 409)
      if (!existing.name?.trim()) throw new EmployeeOperationError('请填写姓名')

      employeeId = existing.id
      const newEmploymentStatus = existing.employment_status || 'probation'
      await client.query(
        `UPDATE employee_profiles
         SET status = 'submitted', employment_status = $1, updated_at = $2
         WHERE id = $3`,
        [newEmploymentStatus, now, existing.id]
      )

      if (newEmploymentStatus === 'probation') {
        const hireDate = existing.hire_date || now.split('T')[0]
        const hireDateObject = new Date(hireDate)
        hireDateObject.setMonth(hireDateObject.getMonth() + 6)
        const probationEndDate = hireDateObject.toISOString().split('T')[0]

        const confirmationResult = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM probation_confirmations WHERE employee_id = $1 FOR UPDATE`,
          [existing.id]
        )
        const confirmation = confirmationResult.rows[0]

        if (confirmation && confirmation.status !== 'pending') {
          throw new EmployeeOperationError('当前转正记录状态异常，请联系管理员', 409)
        }

        if (confirmation) {
          await client.query(
            `UPDATE probation_confirmations
             SET hire_date = $1, probation_end_date = $2, updated_at = $3
             WHERE id = $4`,
            [hireDate, probationEndDate, now, confirmation.id]
          )
        } else {
          await client.query(
            `INSERT INTO probation_confirmations (
               id, employee_id, hire_date, probation_end_date, status, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
            [nanoid(), existing.id, hireDate, probationEndDate, now, now]
          )
        }
      }
    })

    const updated = await db.prepare(`
      SELECT * FROM employee_profiles WHERE id = ?
    `).get(employeeId)

    res.json({
      success: true,
      data: updated,
      message: '提交成功'
    })
  } catch (error) {
    console.error('提交员工信息失败:', error)
    if (error instanceof EmployeeOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '提交员工信息失败' })
  }
})

// 获取员工统计数据（管理员）
router.get('/statistics', requireAdmin, async (req, res) => {
  try {
    // 只统计已提交的员工
    const total = await db.prepare(`
      SELECT COUNT(*) as count FROM employee_profiles WHERE status = 'submitted'
    `).get() as { count: number }

    const active = await db.prepare(`
      SELECT COUNT(*) as count FROM employee_profiles
      WHERE status = 'submitted' AND (employment_status = 'active' OR employment_status IS NULL)
    `).get() as { count: number }

    const probation = await db.prepare(`
      SELECT COUNT(*) as count FROM employee_profiles
      WHERE status = 'submitted' AND employment_status = 'probation'
    `).get() as { count: number }

    const resigned = await db.prepare(`
      SELECT COUNT(*) as count FROM employee_profiles
      WHERE status = 'submitted' AND employment_status = 'resigned'
    `).get() as { count: number }

    const onLeave = await db.prepare(`
      SELECT COUNT(*) as count FROM employee_profiles
      WHERE status = 'submitted' AND employment_status = 'on_leave'
    `).get() as { count: number }

    res.json({
      success: true,
      data: {
        total: Number(total.count),
        active: Number(active.count),
        probation: Number(probation.count),
        resigned: Number(resigned.count),
        onLeave: Number(onLeave.count)
      }
    })
  } catch (error) {
    console.error('获取员工统计失败:', error)
    res.status(500).json({ success: false, message: '获取员工统计失败' })
  }
})

// 获取所有员工信息列表（管理员）
router.get('/list', requireAdmin, async (req, res) => {
  try {
    const { status, employmentStatus, department, keyword, page = 1, pageSize = 20 } = req.query

    // 联合查询 employee_profiles 和 users 表，获取员工编号
    let sql = `
      SELECT
        ep.*,
        COALESCE(u.employee_no, ep.employee_no) as employee_no
      FROM employee_profiles ep
      LEFT JOIN users u ON ep.user_id = u.id
      WHERE 1=1
    `
    const params: any[] = []

    // status 是入职信息提交状态（draft/submitted）
    if (status) {
      sql += ` AND ep.status = ?`
      params.push(status)
    }

    // employmentStatus 是在职状态（active/probation/resigned/on_leave）
    if (employmentStatus) {
      sql += ` AND ep.employment_status = ?`
      params.push(employmentStatus)
    }

    if (department) {
      sql += ` AND ep.department = ?`
      params.push(department)
    }

    if (keyword) {
      sql += ` AND (ep.name ILIKE ? OR u.employee_no ILIKE ? OR ep.mobile ILIKE ?)`
      const kw = `%${keyword}%`
      params.push(kw, kw, kw)
    }

    // 获取总数
    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM')
    const countResult = await db.prepare(countSql).get(...params) as { total: number }

    // 分页，合同到期（含已过期）且未处理的员工置顶，其余按员工编号升序
    const offset = (Number(page) - 1) * Number(pageSize)
    sql += ` ORDER BY
      CASE WHEN ep.contract_end_date IS NOT NULL
           AND ep.contract_end_date::date <= (CURRENT_DATE + INTERVAL '10 days')
           AND ep.employment_status != 'resigned'
           THEN 0 ELSE 1 END,
      REGEXP_REPLACE(COALESCE(u.employee_no, ep.employee_no), '[^0-9]', '', 'g')::int ASC NULLS LAST,
      ep.created_at DESC
      LIMIT ? OFFSET ?`
    params.push(Number(pageSize), offset)

    const list = await db.prepare(sql).all(...params) as EmployeeProfile[]

    res.json({
      success: true,
      data: {
        list,
        total: Number(countResult.total),
        page: Number(page),
        pageSize: Number(pageSize)
      }
    })
  } catch (error) {
    console.error('获取员工列表失败:', error)
    res.status(500).json({ success: false, message: '获取员工列表失败' })
  }
})

// 获取单个员工信息（管理员）
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const profile = await db.prepare(`
      SELECT * FROM employee_profiles WHERE id = ?
    `).get(id) as EmployeeProfile | undefined

    if (!profile) {
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    res.json({
      success: true,
      data: profile
    })
  } catch (error) {
    console.error('获取员工信息失败:', error)
    res.status(500).json({ success: false, message: '获取员工信息失败' })
  }
})

// 获取员工离职档案（管理员）
router.get('/:id/resignation-archive', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const employee = await db.prepare(`
      SELECT id, user_id, name, department, position, mobile, employment_status, updated_at
      FROM employee_profiles WHERE id = ?
    `).get(id) as {
      id: string
      user_id: string | null
      name: string
      department: string | null
      position: string | null
      mobile: string | null
      employment_status: string | null
      updated_at: string
    } | undefined

    if (!employee) {
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    const request = await db.prepare(`
      SELECT rr.*, ep.name as employee_name, ep.department as employee_department,
             ep.position as employee_position, ep.mobile as employee_mobile
      FROM resignation_requests rr
      LEFT JOIN employee_profiles ep ON rr.employee_id = ep.id
      WHERE rr.employee_id = ?
    `).get(id) as EmployeeResignationArchive['request']

    if (!request) {
      const shouldFallback = employee.employment_status === 'resigned'

      return res.json({
        success: true,
        data: {
          request: shouldFallback
            ? {
                id: `employee-status-${employee.id}`,
                employee_id: employee.id,
                employee_user_id: employee.user_id || '',
                handover_user_id: '',
                handover_name: null,
                resign_type: 'voluntary',
                resign_date: '',
                reason: null,
                status: 'approved',
                employee_confirm_time: null,
                handover_confirm_time: null,
                submit_time: null,
                approve_time: employee.updated_at || null,
                approver_id: null,
                approver_comment: '该员工暂无离职申请记录，当前信息根据员工状态兜底展示',
                reject_target: null,
                created_at: employee.updated_at,
                updated_at: employee.updated_at,
                employee_name: employee.name,
                employee_department: employee.department,
                employee_position: employee.position,
                employee_mobile: employee.mobile,
              }
            : null,
          documents: [],
          fallback_from_employee_status: shouldFallback,
        } satisfies EmployeeResignationArchive,
      })
    }

    const documents = await db.prepare(`
      SELECT * FROM resignation_documents WHERE request_id = ? ORDER BY created_at DESC
    `).all(request.id) as EmployeeResignationArchive['documents']

    res.json({
      success: true,
      data: {
        request,
        documents,
        fallback_from_employee_status: false,
      } satisfies EmployeeResignationArchive,
    })
  } catch (error) {
    console.error('获取员工离职档案失败:', error)
    res.status(500).json({ success: false, message: '获取员工离职档案失败' })
  }
})

// 更新员工信息（管理员）
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const data = req.body
    const now = new Date().toISOString()
    const requestedEmploymentStatus = data.employment_status
    if (requestedEmploymentStatus && !['active', 'probation', 'resigned', 'on_leave'].includes(requestedEmploymentStatus)) {
      return res.status(400).json({ success: false, message: '员工状态无效' })
    }
    if (!String(data.name || '').trim()) {
      return res.status(400).json({ success: false, message: '员工姓名不能为空' })
    }
    if (data.hire_date && !isValidDateString(data.hire_date)) {
      return res.status(400).json({ success: false, message: '入职日期无效' })
    }
    let isResetToProbation = false
    const oldDocumentPaths: string[] = []
    await db.transaction(async (client) => {
      const existingResult = await client.query<{
        employment_status: string | null
        contract_end_date: string | null
      }>(
        `SELECT employment_status, contract_end_date
         FROM employee_profiles
         WHERE id = $1
         FOR UPDATE`,
        [id]
      )
      const existing = existingResult.rows[0]
      if (!existing) throw new EmployeeOperationError('员工信息不存在', 404)

      isResetToProbation = requestedEmploymentStatus === 'probation' && existing.employment_status !== 'probation'
      if (isResetToProbation) {
        const newHireDate = data.hire_date || now.split('T')[0]
        if (!isValidDateString(newHireDate)) throw new EmployeeOperationError('入职日期无效')

        const oldConfirmationResult = await client.query<ProbationConfirmation>(
          `SELECT * FROM probation_confirmations WHERE employee_id = $1 FOR UPDATE`,
          [id]
        )
        const oldConfirmation = oldConfirmationResult.rows[0]

        if (oldConfirmation) {
          const oldDocumentsResult = await client.query<{ file_path: string }>(
            `SELECT file_path FROM probation_documents WHERE confirmation_id = $1`,
            [oldConfirmation.id]
          )
          oldDocumentPaths.push(...oldDocumentsResult.rows.map((document) => document.file_path))

          await client.query(
            `INSERT INTO probation_history (
               id, employee_id, confirmation_id, hire_date, probation_end_date,
               status, submit_time, approve_time, approver_id, approver_comment,
               application_comment, reset_reason, reset_by, reset_at, new_hire_date, created_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
              nanoid(), id, oldConfirmation.id, oldConfirmation.hire_date,
              oldConfirmation.probation_end_date, oldConfirmation.status,
              oldConfirmation.submit_time, oldConfirmation.approve_time,
              oldConfirmation.approver_id, oldConfirmation.approver_comment,
              oldConfirmation.application_comment,
              String(data.reset_reason || '').trim() || '管理员将员工状态改为实习期',
              req.session.userId, now, data.hire_date || null, now,
            ]
          )

          await client.query(`DELETE FROM probation_documents WHERE confirmation_id = $1`, [oldConfirmation.id])
          await client.query(
            `DELETE FROM approval_records
             WHERE instance_id IN (
               SELECT id FROM approval_instances WHERE target_id = $1 AND target_type = 'probation'
             )`,
            [oldConfirmation.id]
          )
          await client.query(
            `DELETE FROM approval_instances WHERE target_id = $1 AND target_type = 'probation'`,
            [oldConfirmation.id]
          )
          await client.query(`DELETE FROM probation_confirmations WHERE id = $1`, [oldConfirmation.id])
        }

        const hireDateObject = new Date(`${newHireDate}T00:00:00Z`)
        hireDateObject.setUTCMonth(hireDateObject.getUTCMonth() + 6)
        const newProbationEndDate = hireDateObject.toISOString().slice(0, 10)
        await client.query(
          `INSERT INTO probation_confirmations (
             id, employee_id, hire_date, probation_end_date, status, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
          [nanoid(), id, newHireDate, newProbationEndDate, now, now]
        )
      }

      const updateResult = await client.query(
        `UPDATE employee_profiles SET
           employee_no = $1, name = $2, gender = $3, birth_date = $4,
           id_number = $5, native_place = $6, ethnicity = $7, marital_status = $8,
           education = $9, school = $10, major = $11, mobile = $12, email = $13,
           emergency_contact = $14, emergency_phone = $15, address = $16,
           hire_date = $17, contract_end_date = $18, department = $19, position = $20,
           bank_account_name = $21, bank_account_phone = $22, bank_name = $23,
           bank_account_number = $24, employment_status = $25, updated_at = $26
         WHERE id = $27`,
        [
          data.employee_no || null, String(data.name).trim(), data.gender || null,
          data.birth_date || null, data.id_number || null, data.native_place || null,
          data.ethnicity || null, data.marital_status || null, data.education || null,
          data.school || null, data.major || null, data.mobile || null, data.email || null,
          data.emergency_contact || null, data.emergency_phone || null, data.address || null,
          data.hire_date || null, existing.contract_end_date,
          data.department || null, data.position || null, data.bank_account_name || null,
          data.bank_account_phone || null, data.bank_name || null, data.bank_account_number || null,
          requestedEmploymentStatus || existing.employment_status, now, id,
        ]
      )
      if ((updateResult.rowCount ?? 0) !== 1) {
        throw new EmployeeOperationError('员工信息更新失败', 409)
      }
    })

    // 数据库事务成功后再清理旧文件；失败只会留下可清理的孤立文件，不会破坏业务记录。
    for (const storedPath of oldDocumentPaths) {
      try {
        const filePath = path.join(process.cwd(), storedPath)
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch (error) {
        console.error('清理旧转正文件失败:', error)
      }
    }

    const updated = await db.prepare(`
      SELECT * FROM employee_profiles WHERE id = ?
    `).get(id)

    res.json({
      success: true,
      data: updated,
      message: isResetToProbation ? '已将员工改为实习期，需重新走转正审批流程' : '更新成功'
    })
  } catch (error) {
    console.error('更新员工信息失败:', error)
    if (error instanceof EmployeeOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '更新员工信息失败' })
  }
})

// 删除员工信息（管理员）
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    const existing = await db.prepare(`
      SELECT id FROM employee_profiles WHERE id = ?
    `).get(id)

    if (!existing) {
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    // 文件按上传日期分散存放，删除员工时逐条清理数据库记录指向的文件。
    const employeeDocuments = await db.prepare(`
      SELECT file_path FROM employee_documents WHERE employee_id = ?
    `).all(id) as Array<{ file_path: string }>
    for (const document of employeeDocuments) {
      const filePath = path.join(process.cwd(), document.file_path)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    }

    // 删除员工档案文件记录（数据库会级联删除）
    await db.prepare(`DELETE FROM employee_profiles WHERE id = ?`).run(id)

    res.json({
      success: true,
      message: '删除成功'
    })
  } catch (error) {
    console.error('删除员工信息失败:', error)
    res.status(500).json({ success: false, message: '删除员工信息失败' })
  }
})

// ==================== 员工档案文件管理 API ====================

// 获取员工档案文件列表
router.get('/:id/documents', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params

    // 检查员工是否存在
    const employee = await db.prepare(`
      SELECT id FROM employee_profiles WHERE id = ?
    `).get(id) as { id: string } | undefined

    if (!employee) {
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    const documents = await db.prepare(`
      SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC
    `).all(id) as EmployeeDocument[]

    res.json({
      success: true,
      data: documents,
    })
  } catch (error) {
    console.error('获取员工档案文件失败:', error)
    res.status(500).json({ success: false, message: '获取员工档案文件失败' })
  }
})

// 自动识别并上传员工档案文件
router.post('/:id/documents/auto-classify', requireAdmin, uploadEmployeeDoc.single('file'), async (req, res) => {
  let persisted = false
  let splitFiles: SplitEmployeeDocumentFile[] = []
  try {
    const { id } = req.params
    const file = req.file
    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    const employee = await db.prepare(`
      SELECT id FROM employee_profiles WHERE id = ?
    `).get(id)
    if (!employee) {
      removeUploadedEmployeeDocument(file)
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    const originalFileName = resolveOriginalFileName(file, req.body.originalFileName)
    const analysis = await analyzeEmployeeDocumentBundle(file.path, originalFileName)
    if (analysis.status !== 'success' || analysis.sections.length === 0) {
      removeUploadedEmployeeDocument(file)
      return res.status(422).json({
        success: false,
        message: analysis.message,
        analysis,
      })
    }

    splitFiles = await splitEmployeeDocumentBundle(
      file.path,
      originalFileName,
      analysis.sections,
    )
    const result = await persistEmployeeDocuments({
      employeeId: id,
      files: splitFiles,
      uploaderId: req.session.userId!,
    })
    persisted = true
    removeUploadedEmployeeDocument(file)

    const otherPageCount = analysis.unsupportedSegments.reduce(
      (count, segment) => count + segment.pageNumbers.length,
      0,
    )

    res.json({
      success: true,
      message: result.salaryRecognition?.status === 'success'
        ? `已拆分归档${analysis.sections.length}份档案，月保障薪酬已自动进入工资计算`
        : `已拆分归档${analysis.sections.length}份档案${otherPageCount > 0 ? `，其中${otherPageCount}页已归档至其他` : ''}`,
      data: result.documents,
      classifications: analysis.sections,
      unsupportedSegments: analysis.unsupportedSegments,
      otherSegments: analysis.unsupportedSegments,
      missingTypes: analysis.missingTypes,
      salaryRecognition: result.salaryRecognition,
      contractRecognition: result.contractRecognition,
      currentContractEndDate: result.currentContractEndDate,
    })
  } catch (error) {
    console.error('自动识别员工档案文件失败:', error)
    if (!persisted) {
      removeUploadedEmployeeDocument(req.file)
      for (const splitFile of splitFiles) {
        try {
          if (fs.existsSync(splitFile.filePath)) fs.unlinkSync(splitFile.filePath)
        } catch {
          // 忽略自动归档失败后的拆分文件清理错误
        }
      }
    }
    res.status(500).json({ success: false, message: '自动识别员工档案文件失败' })
  }
})

// 上传员工档案文件
router.post('/:id/documents', requireAdmin, uploadEmployeeDoc.single('file'), async (req, res) => {
  let persisted = false
  try {
    const { id } = req.params
    const { document_type, originalFileName } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }
    if (!document_type) {
      removeUploadedEmployeeDocument(file)
      return res.status(400).json({ success: false, message: '请指定文档类型' })
    }
    if (!isEmployeeDocumentType(document_type)) {
      removeUploadedEmployeeDocument(file)
      return res.status(400).json({ success: false, message: '文档类型无效' })
    }

    const employee = await db.prepare(`
      SELECT id FROM employee_profiles WHERE id = ?
    `).get(id)
    if (!employee) {
      removeUploadedEmployeeDocument(file)
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    const result = await persistEmployeeDocuments({
      employeeId: id,
      files: [
        {
          documentType: document_type,
          filePath: file.path,
          originalFileName: resolveOriginalFileName(file, originalFileName),
          fileSize: file.size,
          mimeType: file.mimetype,
        },
      ],
      uploaderId: req.session.userId!,
    })
    persisted = true

    res.json({
      success: true,
      message: result.salaryRecognition?.status === 'success'
        ? '入职邀请函上传成功，月保障薪酬已自动进入工资计算'
        : '文件上传成功',
      data: result.documents[0],
      salaryRecognition: result.salaryRecognition,
      contractRecognition: result.contractRecognition,
      currentContractEndDate: result.currentContractEndDate,
    })
  } catch (error) {
    console.error('上传员工档案文件失败:', error)
    if (!persisted) removeUploadedEmployeeDocument(req.file)
    res.status(500).json({ success: false, message: '上传员工档案文件失败' })
  }
})

// 一键删除员工全部人事档案文件
router.delete('/:id/documents', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const now = new Date().toISOString()

    const result = await db.transaction(async (client) => {
      const employeeResult = await client.query<{ id: string }>(
        `SELECT id
         FROM employee_profiles
         WHERE id = $1
         FOR UPDATE`,
        [id],
      )
      if (employeeResult.rows.length === 0) {
        throw new EmployeeOperationError('员工信息不存在', 404)
      }

      const documentsResult = await client.query<Pick<EmployeeDocument, 'file_path' | 'document_type'>>(
        `SELECT file_path, document_type
         FROM employee_documents
         WHERE employee_id = $1
         FOR UPDATE`,
        [id],
      )
      const hasContractDocuments = documentsResult.rows.some(
        document => document.document_type === 'contract',
      )

      await client.query(
        `DELETE FROM employee_documents WHERE employee_id = $1`,
        [id],
      )
      await client.query(
        `UPDATE employee_profiles
         SET contract_end_date = NULL, updated_at = $1
         WHERE id = $2`,
        [now, id],
      )

      if (hasContractDocuments) {
        await syncEmployeeCurrentAndFuturePayroll(client, id, {
          resetManualMonthlySalary: false,
          ensureCurrentMonth: false,
          updatedAt: now,
        })
      }

      return {
        deletedCount: documentsResult.rows.length,
        filePaths: documentsResult.rows.map(document => document.file_path),
        payrollRecalculated: hasContractDocuments,
      }
    })

    let fileCleanupFailedCount = 0
    for (const storedPath of new Set(result.filePaths)) {
      const filePath = path.join(process.cwd(), storedPath)
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch (error) {
        fileCleanupFailedCount += 1
        console.error('员工档案数据库记录已删除，但物理文件清理失败:', error)
      }
    }

    res.json({
      success: true,
      message: result.deletedCount > 0
        ? `已删除全部人事档案，共 ${result.deletedCount} 份`
        : '当前没有可删除的人事档案',
      deletedCount: result.deletedCount,
      fileCleanupFailedCount,
      payrollRecalculated: result.payrollRecalculated,
      currentContractEndDate: null,
    })
  } catch (error) {
    if (error instanceof EmployeeOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    console.error('一键删除员工人事档案失败:', error)
    res.status(500).json({ success: false, message: '一键删除员工人事档案失败' })
  }
})

// 删除员工档案文件
router.delete('/:id/documents/:docId', requireAdmin, async (req, res) => {
  try {
    const { id, docId } = req.params

    // 获取文档信息
    const document = await db.prepare(`
      SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?
    `).get(docId, id) as EmployeeDocument | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文档不存在' })
    }

    const filePath = path.join(process.cwd(), document.file_path)
    let currentContractEndDate: string | null = null
    const now = new Date().toISOString()
    await db.transaction(async (client) => {
      await client.query(
        `DELETE FROM employee_documents WHERE id = $1 AND employee_id = $2`,
        [docId, id],
      )

      if (document.document_type === 'contract') {
        const latestContractResult = await client.query<{ contract_end_date: string }>(
          `SELECT contract_end_date
           FROM employee_documents
           WHERE employee_id = $1
             AND document_type = 'contract'
             AND contract_end_date IS NOT NULL
           ORDER BY contract_end_date DESC, created_at DESC
           LIMIT 1`,
          [id],
        )
        currentContractEndDate = latestContractResult.rows[0]?.contract_end_date ?? null
        await client.query(
          `UPDATE employee_profiles
           SET contract_end_date = $1, updated_at = $2
           WHERE id = $3`,
          [currentContractEndDate, now, id],
        )
        await syncEmployeeCurrentAndFuturePayroll(client, id, {
          resetManualMonthlySalary: false,
          ensureCurrentMonth: false,
          updatedAt: now,
        })
      }
    })

    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch (error) {
      console.error('员工档案数据库记录已删除，但物理文件清理失败:', error)
    }

    res.json({
      success: true,
      message: '文件删除成功',
      currentContractEndDate,
    })
  } catch (error) {
    console.error('删除员工档案文件失败:', error)
    res.status(500).json({ success: false, message: '删除员工档案文件失败' })
  }
})

// 下载/预览员工档案文件
router.get('/:id/documents/:docId/download', requireAdmin, async (req, res) => {
  try {
    const { id, docId } = req.params

    const employee = await db.prepare(`
      SELECT id FROM employee_profiles WHERE id = ?
    `).get(id) as { id: string } | undefined

    if (!employee) {
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    // 获取文档信息
    const document = await db.prepare(`
      SELECT * FROM employee_documents WHERE id = ? AND employee_id = ?
    `).get(docId, id) as EmployeeDocument | undefined

    if (!document) {
      return res.status(404).json({ success: false, message: '文档不存在' })
    }

    const filePath = path.join(process.cwd(), document.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    sendEmployeeDocument(res, document, filePath)
  } catch (error) {
    console.error('下载员工档案文件失败:', error)
    res.status(500).json({ success: false, message: '下载员工档案文件失败' })
  }
})

// ==================== 入职文件模板管理 API ====================

// 配置 multer 用于入职文件模板上传
const uploadOnboardingTemplate = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, ensureDatedUploadDirectory('onboarding-templates'))
    },
    filename: (req, file, cb) => {
      // 解码中文文件名
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
      const ext = path.extname(originalName)
      const filename = `template-${Date.now()}-${nanoid(6)}${ext.toLowerCase()}`
      cb(null, filename)
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
    ]
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 PDF 格式的文件'))
    }
  },
})

// 入职文件模板类型
interface OnboardingTemplate {
  id: string
  file_type: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string
  uploaded_by_name: string | null
  created_at: string
}

// 获取所有入职文件模板列表
router.get('/onboarding/templates', requireAuth, async (req, res) => {
  try {
    const templates = await db.prepare(`
      SELECT * FROM onboarding_templates ORDER BY file_type, created_at DESC
    `).all() as OnboardingTemplate[]

    res.json({
      success: true,
      data: templates
    })
  } catch (error) {
    console.error('获取入职文件模板失败:', error)
    res.status(500).json({ success: false, message: '获取入职文件模板失败' })
  }
})

// 上传入职文件模板（管理员）
router.post('/onboarding/templates', requireAdmin, uploadOnboardingTemplate.single('file'), async (req, res) => {
  try {
    const { file_type, originalFileName: bodyOriginalFileName } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    if (!file_type) {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '请指定文件类型' })
    }
    if (!ONBOARDING_TEMPLATE_TYPES.has(file_type)) {
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '入职模板类型无效' })
    }

    if (isNumberedOnboardingDocumentType(file_type)) {
      try {
        // 上传时逐页试写示例编号，避免员工下载时才发现模板缺少编号位置。
        await writeEmployeeNumberToOnboardingTemplate(file.path, 'YULI-CS000', file_type)
      } catch (error) {
        removeUploadedEmployeeDocument(file)
        const message = error instanceof EmployeeNumberFieldNotFoundError
          ? error.message
          : '模板编号位置无法写入，请确认 PDF 未加密、未旋转且各目标页的“编号”字样可识别'
        return res.status(422).json({ success: false, message })
      }
    }

    // 优先使用前端传递的原始文件名，否则尝试解码
    const originalFileName = bodyOriginalFileName || Buffer.from(file.originalname, 'latin1').toString('utf8')

    // 获取上传者信息
    const uploader = await db.prepare(`
      SELECT name FROM users WHERE id = ?
    `).get(req.session.userId) as { name: string } | undefined

    const templateId = nanoid()
    const now = new Date().toISOString()
    const relativePath = toStoredUploadPath(file.path, true)

    await db.prepare(`
      INSERT INTO onboarding_templates (
        id, file_type, file_name, file_path,
        file_size, mime_type, uploaded_by, uploaded_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      templateId,
      file_type,
      originalFileName,
      relativePath,
      file.size,
      file.mimetype,
      req.session.userId,
      uploader?.name || null,
      now
    )

    const template = await db.prepare(`
      SELECT * FROM onboarding_templates WHERE id = ?
    `).get(templateId)

    res.json({
      success: true,
      message: '文件上传成功',
      data: template
    })
  } catch (error) {
    console.error('上传入职文件模板失败:', error)
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (e) {
        // 忽略删除失败
      }
    }
    res.status(500).json({ success: false, message: '上传入职文件模板失败' })
  }
})

// 删除入职文件模板（管理员）
router.delete('/onboarding/templates/:templateId', requireAdmin, async (req, res) => {
  try {
    const { templateId } = req.params

    // 获取模板信息
    const template = await db.prepare(`
      SELECT * FROM onboarding_templates WHERE id = ?
    `).get(templateId) as OnboardingTemplate | undefined

    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' })
    }

    // 删除物理文件
    const filePath = path.join(process.cwd(), template.file_path)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除数据库记录
    await db.prepare(`DELETE FROM onboarding_templates WHERE id = ?`).run(templateId)

    res.json({
      success: true,
      message: '文件删除成功'
    })
  } catch (error) {
    console.error('删除入职文件模板失败:', error)
    res.status(500).json({ success: false, message: '删除入职文件模板失败' })
  }
})

// 管理员预览原始模板，不写入任何员工编号
router.get('/onboarding/templates/:templateId/original', requireAdmin, async (req, res) => {
  try {
    const { templateId } = req.params
    const template = await db.prepare(`
      SELECT * FROM onboarding_templates WHERE id = ?
    `).get(templateId) as OnboardingTemplate | undefined

    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' })
    }

    const filePath = path.join(process.cwd(), template.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    res.setHeader('Content-Type', template.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(template.file_name)}"`)
    fs.createReadStream(filePath).pipe(res)
  } catch (error) {
    console.error('预览入职原始模板失败:', error)
    res.status(500).json({ success: false, message: '预览入职原始模板失败' })
  }
})

// 下载/预览入职文件模板
router.get('/onboarding/templates/:templateId/download', requireAuth, async (req, res) => {
  try {
    const { templateId } = req.params

    // 获取模板信息
    const template = await db.prepare(`
      SELECT * FROM onboarding_templates WHERE id = ?
    `).get(templateId) as OnboardingTemplate | undefined

    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' })
    }

    const filePath = path.join(process.cwd(), template.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    if (!isNumberedOnboardingDocumentType(template.file_type)) {
      res.setHeader('Content-Type', template.mime_type || 'application/octet-stream')
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(template.file_name)}"`)
      return fs.createReadStream(filePath).pipe(res)
    }

    const user = await db.prepare(`
      SELECT u.employee_no, ep.employee_no AS profile_employee_no
      FROM users u
      LEFT JOIN employee_profiles ep ON ep.user_id = u.id
      WHERE u.id = ?
      ORDER BY ep.updated_at DESC NULLS LAST
      LIMIT 1
    `).get(req.session.userId) as {
      employee_no: string | null
      profile_employee_no: string | null
    } | undefined
    const employeeNo = normalizeEmployeeNumber(user?.employee_no || user?.profile_employee_no)
    if (!isValidEmployeeNumber(employeeNo)) {
      return res.status(409).json({
        success: false,
        message: '当前账号尚未设置有效员工编号，请联系管理员在用户管理中补充',
      })
    }

    const numberedPdf = await writeEmployeeNumberToOnboardingTemplate(
      filePath,
      employeeNo,
      template.file_type,
    )
    const numberedBuffer = Buffer.from(numberedPdf)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(template.file_name)}"`)
    res.setHeader('Content-Length', String(numberedBuffer.length))
    res.setHeader('Cache-Control', 'no-store')
    res.send(numberedBuffer)
  } catch (error) {
    console.error('下载入职文件模板失败:', error)
    if (error instanceof EmployeeNumberFieldNotFoundError) {
      return res.status(422).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '下载入职文件模板失败' })
  }
})

export default router
