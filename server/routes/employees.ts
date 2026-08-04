import { Router, type Response } from 'express'
import type { PoolClient } from 'pg'
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
  isEmployeeDocumentOcrInfrastructureError,
  type EmployeeDocumentType,
} from '../services/employeeDocumentClassifier.js'
import {
  analyzeEmployeeDocumentBundle,
  mapEmployeeDocumentSectionRecognizedTexts,
  splitEmployeeDocumentBundle,
  type SplitEmployeeDocumentFile,
} from '../services/employeeDocumentBundle.js'
import {
  AssetAgreementFieldNotFoundError,
  ContractTemplateDateFieldNotFoundError,
  ContractTemplatePositionFieldNotFoundError,
  EmployeeNumberFieldNotFoundError,
  type EmployeeAssetAgreementTemplateData,
  isNumberedOnboardingDocumentType,
  writeEmployeeAssetAgreementToOnboardingTemplate,
  writeEmployeeContractDataToOnboardingTemplate,
  writeEmployeeContractPositionToOnboardingTemplate,
  writeEmployeeNumberToOnboardingTemplate,
} from '../services/onboardingTemplateNumber.js'
import { closeContractTemplateCycle } from '../services/contractTemplateCycle.js'
import { isValidEmployeeNumber, normalizeEmployeeNumber } from '../utils/employee-number.js'
import {
  normalizeEmployeeProfileInput,
  validateEmployeeProfile,
  type NormalizedEmployeeProfileInput,
} from '../utils/employee-profile-validation.js'
import { resolveEmployeeContractDates } from '../utils/employee-contract-dates.js'
import { normalizeContractTemplateDates } from '../utils/contract-template-dates.js'
import { parsePagination } from '../utils/pagination.js'
import { getBeijingLeaveClock } from '../utils/leave-schedule.js'
import {
  parseStoredDepartmentPositionMap,
  validateDepartmentPositionPair,
  type DepartmentPositionMap,
} from '../utils/department-position.js'
import {
  resolveContractTemplatePreviewFields,
  validateContractTemplateDownload,
  type ContractTemplateAccessFields,
} from '../utils/onboarding-template-access.js'
import { requiresEmployeeProfile } from '../utils/boss-role.js'

const router = Router()

async function getDepartmentPositionMap(): Promise<DepartmentPositionMap> {
  const config = await db.prepare(
    'SELECT config_json FROM department_position_configs WHERE id = ?',
  ).get('default') as { config_json: string } | undefined
  return parseStoredDepartmentPositionMap(config?.config_json)
}

function getWorkingDateSql(dateExpression: string, aliasSuffix: string): string {
  return `(
    EXISTS (
      SELECT 1 FROM holidays workday_${aliasSuffix}
      WHERE workday_${aliasSuffix}.date = (${dateExpression})
        AND workday_${aliasSuffix}.type = 'workday'
    )
    OR (
      EXTRACT(ISODOW FROM (${dateExpression})::date) BETWEEN 1 AND 5
      AND NOT EXISTS (
        SELECT 1 FROM holidays holiday_${aliasSuffix}
        WHERE holiday_${aliasSuffix}.date = (${dateExpression})
          AND holiday_${aliasSuffix}.type = 'holiday'
      )
    )
  )`
}

export function getEffectiveEmploymentStatusSql(profileAlias = 'ep', clockAlias = 'clock'): string {
  const endDateIsWorking = getWorkingDateSql('active_leave.end_date', 'end')
  const returnDateIsWorking = getWorkingDateSql('return_day::date::text', 'return')
  const nextReturnDateSql = `(
    SELECT return_day::date::text
    FROM generate_series(
      active_leave.end_date::date + INTERVAL '1 day',
      active_leave.end_date::date + INTERVAL '366 days',
      INTERVAL '1 day'
    ) AS return_day
    WHERE ${returnDateIsWorking}
    ORDER BY return_day
    LIMIT 1
  )`

  return `CASE
    WHEN COALESCE(${profileAlias}.employment_status, 'active') != 'resigned'
      AND EXISTS (
        SELECT 1
        FROM leave_requests active_leave
        WHERE active_leave.user_id = ${profileAlias}.user_id
          AND active_leave.status = 'approved'
          AND (
            active_leave.start_date < ${clockAlias}.current_date
            OR (
              active_leave.start_date = ${clockAlias}.current_date
              AND CASE active_leave.start_half WHEN 'morning' THEN 0 ELSE 1 END <= ${clockAlias}.current_half
            )
          )
          AND (
            (
              active_leave.end_half = 'morning'
              AND ${endDateIsWorking}
              AND (
                active_leave.end_date > ${clockAlias}.current_date
                OR (
                  active_leave.end_date = ${clockAlias}.current_date
                  AND ${clockAlias}.current_half < 1
                )
              )
            )
            OR (
              NOT (active_leave.end_half = 'morning' AND ${endDateIsWorking})
              AND ${clockAlias}.current_date < COALESCE(
                ${nextReturnDateSql},
                (active_leave.end_date::date + INTERVAL '367 days')::date::text
              )
            )
          )
      )
    THEN 'on_leave'
    ELSE COALESCE(${profileAlias}.employment_status, 'active')
  END`
}

export function getEffectiveStatusParams(now = new Date()): Array<string | number> {
  const clock = getBeijingLeaveClock(now)
  return [clock.date, clock.halfIndex]
}

class EmployeeOperationError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message)
    this.name = 'EmployeeOperationError'
  }
}

async function ensureEmployeeAccount(userId: string): Promise<void> {
  const account = await db.prepare(
    'SELECT role FROM users WHERE id = ? AND status = ?',
  ).get(userId, 'active') as { role: string } | undefined
  if (!account) throw new EmployeeOperationError('用户不存在或已停用', 401)
  if (!requiresEmployeeProfile(account.role)) {
    throw new EmployeeOperationError('当前角色不建立员工档案', 403)
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
  preRecognizedPageTextCandidates?: ReadonlyMap<number, readonly string[]>
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

async function findCurrentContractDates(client: PoolClient, employeeId: string) {
  const contractsResult = await client.query<{
    contract_start_date: string | null
    contract_end_date: string | null
    probation_end_date: string | null
    created_at: string
  }>(
    `SELECT contract_start_date, contract_end_date, probation_end_date, created_at
     FROM employee_documents
     WHERE employee_id = $1
       AND document_type = 'contract'
     ORDER BY created_at DESC`,
    [employeeId],
  )

  return resolveEmployeeContractDates(contractsResult.rows)
}

async function syncProbationConfirmationFromContract(
  client: PoolClient,
  employeeId: string,
  hireDate: string | null,
  probationEndDate: string | null,
  now: string,
): Promise<boolean> {
  if (!hireDate) {
    const clearResult = await client.query(
      `UPDATE probation_confirmations
       SET hire_date = NULL, probation_end_date = NULL, updated_at = $1
       WHERE employee_id = $2
         AND (hire_date IS NOT NULL OR probation_end_date IS NOT NULL)`,
      [now, employeeId],
    )
    return (clearResult.rowCount ?? 0) > 0
  }

  const profileResult = await client.query<{
    employment_status: string | null
  }>(
    `SELECT employment_status
     FROM employee_profiles
     WHERE id = $1
     FOR UPDATE`,
    [employeeId],
  )
  const profile = profileResult.rows[0]
  if (!profile) return false

  const confirmationResult = await client.query<{ id: string; status: string }>(
    `SELECT id, status
     FROM probation_confirmations
     WHERE employee_id = $1
     FOR UPDATE`,
    [employeeId],
  )
  const confirmation = confirmationResult.rows[0]

  if (confirmation) {
    await client.query(
      `UPDATE probation_confirmations
       SET hire_date = $1, probation_end_date = $2, updated_at = $3
       WHERE id = $4`,
      [hireDate, probationEndDate, now, confirmation.id],
    )
    return true
  }

  if (profile.employment_status !== 'probation' || !probationEndDate) return false

  await client.query(
    `INSERT INTO probation_confirmations (
       id, employee_id, hire_date, probation_end_date, status, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
    [nanoid(), employeeId, hireDate, probationEndDate, now, now],
  )
  return true
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
      ? await recognizeInvitationMonthlySalary(file.filePath, {
          preRecognizedPageTextCandidates:
            file.preRecognizedPageTextCandidates?.get(1),
        })
      : null
    const contractRecognition = file.documentType === 'contract'
      ? await recognizeEmploymentContractTerm(file.filePath, {
          preRecognizedPageTextCandidates:
            file.preRecognizedPageTextCandidates,
        })
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
    const hasArchivedContract = preparedFiles.some(
      file => file.documentType === 'contract',
    )

    for (const file of preparedFiles) {
      const insertResult = await client.query<EmployeeDocument>(
        `INSERT INTO employee_documents (
           id, employee_id, document_type, file_name, file_path,
           file_size, mime_type, uploaded_by, uploaded_by_name,
           contract_start_date, contract_end_date, contract_recognized_at,
           probation_end_date, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
          file.contractRecognition?.status === 'success'
            ? file.contractRecognition.probationEndDate
            : null,
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

    let contractTemplateLocked = false
    if (hasArchivedContract) {
      contractTemplateLocked = await closeContractTemplateCycle(
        client,
        employeeId,
        now,
      )
    }

    let currentHireDate: string | null = null
    let currentContractEndDate: string | null = null
    let currentProbationEndDate: string | null = null
    let probationConfirmationSynced = false
    if (
      preparedFiles.some(
        (file) =>
          file.documentType === 'contract' &&
          file.contractRecognition?.status === 'success',
      )
    ) {
      const currentContractDates = await findCurrentContractDates(client, employeeId)
      currentHireDate = currentContractDates.hireDate
      currentContractEndDate = currentContractDates.contractEndDate
      currentProbationEndDate = currentContractDates.probationEndDate
      await client.query(
        `UPDATE employee_profiles
         SET hire_date = $1, contract_end_date = $2, updated_at = $3
         WHERE id = $4`,
        [currentHireDate, currentContractEndDate, now, employeeId],
      )
      await syncEmployeeCurrentAndFuturePayroll(client, employeeId, {
        resetManualMonthlySalary: false,
        ensureCurrentMonth: false,
        updatedAt: now,
      })
      probationConfirmationSynced = await syncProbationConfirmationFromContract(
        client,
        employeeId,
        currentHireDate,
        currentProbationEndDate,
        now,
      )
    }

    return {
      documents: insertedDocuments,
      currentHireDate,
      currentContractEndDate,
      currentProbationEndDate,
      probationConfirmationSynced,
      contractTemplateLocked,
    }
  })

  const lastInvitationFile = [...preparedFiles]
    .reverse()
    .find(file => file.documentType === 'invitation')
  const lastContractFile = [...preparedFiles]
    .reverse()
    .find(file => file.documentType === 'contract')

  return {
    documents: transactionResult.documents,
    salaryRecognition: lastInvitationFile?.salaryRecognition || null,
    contractRecognition: lastContractFile?.contractRecognition || null,
    currentHireDate: transactionResult.currentHireDate,
    currentContractEndDate: transactionResult.currentContractEndDate,
    currentProbationEndDate: transactionResult.currentProbationEndDate,
    probationConfirmationSynced: transactionResult.probationConfirmationSynced,
    contractTemplateLocked: transactionResult.contractTemplateLocked,
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
    const account = await db.prepare(`
      SELECT role
      FROM users
      WHERE id = ?
    `).get(userId) as { role: string } | undefined

    // 独立系统账号不自动创建或返回员工档案。
    if (account && !requiresEmployeeProfile(account.role)) {
      return res.json({
        success: true,
        data: null,
      })
    }

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
    const userId = req.session.userId!
    await ensureEmployeeAccount(userId)
    const normalized = normalizeEmployeeProfileInput(req.body)
    if (!normalized.data) {
      return res.status(400).json({ success: false, message: normalized.error })
    }
    const data = normalized.data
    const validationError = validateEmployeeProfile(data, false)
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError })
    }
    const now = new Date().toISOString()

    const account = await db.prepare(`
      SELECT name, employee_no, department, position, email, mobile
      FROM users WHERE id = ?
    `).get(userId) as {
      name: string
      employee_no: string | null
      department: string | null
      position: string | null
      email: string | null
      mobile: string | null
    } | undefined
    if (!account) return res.status(404).json({ success: false, message: '用户不存在' })

    // 检查是否已有记录
    const existing = await db.prepare(`
      SELECT id, status, hire_date, contract_end_date, employee_no, name
      FROM employee_profiles WHERE user_id = ?
    `).get(userId) as {
      id: string
      status: string
      hire_date: string | null
      contract_end_date: string | null
      employee_no: string | null
      name: string
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
      // 入职日期来源于劳动合同；部门、职位、在职状态同样不允许员工自行修改。
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
        existing.employee_no || account.employee_no,
        data.name || existing.name || account.name,
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
        existing.hire_date,
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
          employment_status, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'probation', 'draft', ?, ?)
      `).run(
        id,
        userId,
        account.employee_no,
        data.name || account.name,
        data.gender || null,
        data.birth_date || null,
        data.id_number || null,
        data.native_place || null,
        data.ethnicity || null,
        data.marital_status || null,
        data.education || null,
        data.school || null,
        data.major || null,
        data.mobile || account.mobile,
        data.email || account.email,
        data.emergency_contact || null,
        data.emergency_phone || null,
        data.address || null,
        null,
        null,
        account.department,
        account.position,
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
    if (error instanceof EmployeeOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '保存员工信息失败' })
  }
})

// 提交当前用户的员工信息
router.post('/my-profile/submit', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    await ensureEmployeeAccount(userId)
    const now = new Date().toISOString()
    let employeeId = ''

    await db.transaction(async (client) => {
      const profileResult = await client.query<{
        id: string
        status: string
        employee_no: string | null
        name: string
        gender: string | null
        birth_date: string | null
        id_number: string | null
        native_place: string | null
        ethnicity: string | null
        marital_status: string | null
        education: string | null
        school: string | null
        major: string | null
        mobile: string | null
        email: string | null
        emergency_contact: string | null
        emergency_phone: string | null
        address: string | null
        hire_date: string | null
        bank_account_name: string | null
        bank_account_phone: string | null
        bank_name: string | null
        bank_account_number: string | null
        employment_status: string | null
      }>(
        `SELECT id, status, employee_no, name, gender, birth_date, id_number,
                native_place, ethnicity, marital_status, education, school, major,
                mobile, email, emergency_contact, emergency_phone, address, hire_date,
                bank_account_name, bank_account_phone, bank_name, bank_account_number,
                employment_status
         FROM employee_profiles
         WHERE user_id = $1
         FOR UPDATE`,
        [userId]
      )
      const existing = profileResult.rows[0]

      if (!existing) throw new EmployeeOperationError('请先填写员工信息')
      if (existing.status === 'submitted') throw new EmployeeOperationError('员工信息已提交', 409)
      if (!existing.employee_no) throw new EmployeeOperationError('员工编号尚未分配，请联系管理员')

      const submissionData: NormalizedEmployeeProfileInput = {
        name: existing.name,
        gender: existing.gender,
        birth_date: existing.birth_date,
        id_number: existing.id_number,
        native_place: existing.native_place,
        ethnicity: existing.ethnicity,
        marital_status: existing.marital_status,
        education: existing.education,
        school: existing.school,
        major: existing.major,
        mobile: existing.mobile,
        email: existing.email,
        emergency_contact: existing.emergency_contact,
        emergency_phone: existing.emergency_phone,
        address: existing.address,
        hire_date: existing.hire_date,
        bank_account_name: existing.bank_account_name,
        bank_account_phone: existing.bank_account_phone,
        bank_name: existing.bank_name,
        bank_account_number: existing.bank_account_number,
      }
      const validationError = validateEmployeeProfile(submissionData, true)
      if (validationError) throw new EmployeeOperationError(validationError)

      const duplicateIdNumber = await client.query<{ id: string }>(
        `SELECT id FROM employee_profiles
         WHERE id_number = $1 AND id <> $2
         LIMIT 1`,
        [existing.id_number, existing.id]
      )
      if (duplicateIdNumber.rows[0]) throw new EmployeeOperationError('身份证号已被其他员工使用', 409)

      employeeId = existing.id
      const newEmploymentStatus = existing.employment_status || 'probation'
      await client.query(
        `UPDATE employee_profiles
         SET status = 'submitted', employment_status = $1, updated_at = $2
         WHERE id = $3`,
        [newEmploymentStatus, now, existing.id]
      )

      if (newEmploymentStatus === 'probation') {
        const currentContractDates = await findCurrentContractDates(client, existing.id)
        const hireDate = currentContractDates.hireDate
        const probationEndDate = currentContractDates.probationEndDate

        if (!hireDate || !probationEndDate) return

        await client.query(
          `UPDATE employee_profiles
           SET hire_date = $1, updated_at = $2
           WHERE id = $3`,
          [hireDate, now, existing.id],
        )

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
    const effectiveStatusSql = getEffectiveEmploymentStatusSql()
    const statistics = await db.prepare(`
      WITH leave_clock AS (
        SELECT ?::text AS current_date, ?::integer AS current_half
      ),
      employee_statuses AS (
        SELECT ${effectiveStatusSql} AS effective_employment_status
        FROM employee_profiles ep
        LEFT JOIN users u ON ep.user_id = u.id
        CROSS JOIN leave_clock clock
        WHERE ep.status = 'submitted'
          AND COALESCE(u.role, 'user') NOT IN ('boss', 'chairman', 'super_admin')
      )
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE effective_employment_status = 'active') as active,
        COUNT(*) FILTER (WHERE effective_employment_status = 'probation') as probation,
        COUNT(*) FILTER (WHERE effective_employment_status = 'resigned') as resigned,
        COUNT(*) FILTER (WHERE effective_employment_status = 'on_leave') as on_leave
      FROM employee_statuses
    `).get<{
      total: number
      active: number
      probation: number
      resigned: number
      on_leave: number
    }>(...getEffectiveStatusParams())

    res.json({
      success: true,
      data: {
        total: Number(statistics?.total || 0),
        active: Number(statistics?.active || 0),
        probation: Number(statistics?.probation || 0),
        resigned: Number(statistics?.resigned || 0),
        onLeave: Number(statistics?.on_leave || 0)
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
    const { status, employmentStatus, department, keyword } = req.query
    const pagination = parsePagination(req.query.page, req.query.pageSize)

    const effectiveStatusSql = getEffectiveEmploymentStatusSql()
    const statusParams = getEffectiveStatusParams()
    const employeeListCte = `
      WITH leave_clock AS (
        SELECT ?::text AS current_date, ?::integer AS current_half
      ),
      employee_list AS (
        SELECT
          ep.*,
          COALESCE(u.employee_no, ep.employee_no) as display_employee_no,
          ${effectiveStatusSql} as effective_employment_status
        FROM employee_profiles ep
        LEFT JOIN users u ON ep.user_id = u.id
        CROSS JOIN leave_clock clock
        WHERE COALESCE(u.role, 'user') NOT IN ('boss', 'chairman', 'super_admin')
      )
    `
    const conditions: string[] = []
    const filterParams: any[] = []

    // status 是入职信息提交状态（draft/submitted）
    if (status) {
      conditions.push('status = ?')
      filterParams.push(status)
    }

    // employmentStatus 是在职状态（active/probation/resigned/on_leave）
    if (employmentStatus) {
      conditions.push('effective_employment_status = ?')
      filterParams.push(employmentStatus)
    }

    if (department) {
      conditions.push('department = ?')
      filterParams.push(department)
    }

    if (keyword) {
      conditions.push('(name ILIKE ? OR display_employee_no ILIKE ? OR mobile ILIKE ?)')
      const kw = `%${keyword}%`
      filterParams.push(kw, kw, kw)
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const queryParams = [...statusParams, ...filterParams]
    const countResult = await db.prepare(
      `${employeeListCte}
       SELECT COUNT(*) as total
       FROM employee_list
       ${whereSql}`,
    ).get<{ total: number }>(...queryParams)

    // 分页，合同到期（含已过期）且未处理的员工置顶，其余按员工编号升序
    const { page, pageSize, offset } = pagination
    const listSql = `${employeeListCte}
      SELECT employee_list.*, display_employee_no as employee_no
      FROM employee_list
      ${whereSql}
      ORDER BY
      CASE WHEN contract_end_date IS NOT NULL
           AND contract_end_date::date <= (CURRENT_DATE + INTERVAL '10 days')
           AND employment_status != 'resigned'
           THEN 0 ELSE 1 END,
      REGEXP_REPLACE(display_employee_no, '[^0-9]', '', 'g')::int ASC NULLS LAST,
      created_at DESC
      LIMIT ? OFFSET ?`

    const list = await db.prepare(listSql).all<EmployeeProfile & {
      effective_employment_status: 'active' | 'probation' | 'resigned' | 'on_leave'
    }>(...queryParams, pageSize, offset)

    res.json({
      success: true,
      data: {
        list,
        total: Number(countResult?.total || 0),
        page,
        pageSize
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
      return res.json({
        success: true,
        data: {
          request: null,
          documents: [],
          fallback_from_employee_status: false,
        } satisfies EmployeeResignationArchive,
      })
    }

    const documents = await db.prepare(`
      SELECT * FROM resignation_documents
      WHERE request_id = ?
        AND is_current = 1
      ORDER BY created_at DESC
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
    const normalizedProfile = normalizeEmployeeProfileInput(req.body)
    if (!normalizedProfile.data) {
      return res.status(400).json({ success: false, message: normalizedProfile.error })
    }
    const validationError = validateEmployeeProfile(normalizedProfile.data, false)
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError })
    }
    const normalizedTemplateDates = normalizeContractTemplateDates(req.body)
    if (!normalizedTemplateDates.data) {
      return res.status(400).json({ success: false, message: normalizedTemplateDates.error })
    }
    const data = { ...req.body, ...normalizedProfile.data }
    const templateDates = normalizedTemplateDates.data
    const now = new Date().toISOString()
    const normalizedEmployeeNo = normalizeEmployeeNumber(data.employee_no)
    if (!isValidEmployeeNumber(normalizedEmployeeNo)) {
      return res.status(400).json({ success: false, message: '员工编号格式应为 YULI-CS 加 3 至 6 位数字' })
    }
    const requestedEmploymentStatus = data.employment_status
    if (requestedEmploymentStatus && !['active', 'probation', 'resigned', 'on_leave'].includes(requestedEmploymentStatus)) {
      return res.status(400).json({ success: false, message: '员工状态无效' })
    }
    if (!String(data.name || '').trim()) {
      return res.status(400).json({ success: false, message: '员工姓名不能为空' })
    }
    const organizationSelection = validateDepartmentPositionPair(
      await getDepartmentPositionMap(),
      data.department,
      data.position,
    )
    if (organizationSelection.error) {
      return res.status(400).json({ success: false, message: organizationSelection.error })
    }
    let isResetToProbation = false
    let resolvedHireDate: string | null = null
    const oldDocumentPaths: string[] = []
    const oldSignaturePaths: string[] = []
    await db.transaction(async (client) => {
      const existingResult = await client.query<{
        employment_status: string | null
        hire_date: string | null
        contract_end_date: string | null
        user_id: string | null
        id_number: string | null
      }>(
        `SELECT employment_status, hire_date, contract_end_date, user_id, id_number
         FROM employee_profiles
         WHERE id = $1
         FOR UPDATE`,
        [id]
      )
      const existing = existingResult.rows[0]
      if (!existing) throw new EmployeeOperationError('员工信息不存在', 404)
      resolvedHireDate = existing.hire_date

      if (
        existing.employment_status === 'resigned'
        && requestedEmploymentStatus
        && requestedEmploymentStatus !== 'resigned'
      ) {
        throw new EmployeeOperationError(
          '已离职员工的原档案不能恢复为在职；返聘请创建新账号和新员工档案',
          409,
        )
      }
      if (
        requestedEmploymentStatus === 'resigned'
        && existing.employment_status !== 'resigned'
      ) {
        throw new EmployeeOperationError(
          '员工离职状态只能在五类离职档案全部归档后由系统自动更新',
          409,
        )
      }

      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['employee-number-write'])
      const duplicateEmployeeNo = await client.query<{ id: string }>(
        `SELECT id FROM employee_profiles WHERE employee_no = $1 AND id <> $2 LIMIT 1`,
        [normalizedEmployeeNo, id]
      )
      if (duplicateEmployeeNo.rows[0]) throw new EmployeeOperationError('员工编号已被使用', 409)
      if (data.id_number && data.id_number !== existing.id_number) {
        const duplicateIdNumber = await client.query<{ id: string }>(
          `SELECT id FROM employee_profiles WHERE id_number = $1 AND id <> $2 LIMIT 1`,
          [data.id_number, id]
        )
        if (duplicateIdNumber.rows[0]) throw new EmployeeOperationError('身份证号已被其他员工使用', 409)
      }

      if (requestedEmploymentStatus === 'active' && existing.employment_status === 'probation') {
        const confirmationResult = await client.query<{ status: string }>(
          `SELECT status FROM probation_confirmations WHERE employee_id = $1`,
          [id]
        )
        if (confirmationResult.rows[0]?.status !== 'approved') {
          throw new EmployeeOperationError('实习期员工必须通过转正审批后才能改为在职', 409)
        }
      }

      isResetToProbation = requestedEmploymentStatus === 'probation' && existing.employment_status !== 'probation'
      if (isResetToProbation) {
        const currentContractDates = await findCurrentContractDates(client, id)
        const newHireDate = currentContractDates.hireDate
        if (!newHireDate) {
          throw new EmployeeOperationError('请先上传并成功识别劳动合同，再将员工改为实习期')
        }
        resolvedHireDate = newHireDate

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
          const oldSignaturesResult = await client.query<{
            id: string
            form_version: number
            stage: string
            signer_id: string
            signer_name: string
            signer_role: string
            signer_department: string | null
            signer_position: string | null
            signature_path: string
            signature_type: string
            signature_owner_name: string
            opinion: string | null
            decision: string
            signed_at: string
          }>(
            `SELECT id, form_version, stage, signer_id, signer_name, signer_role,
                    signer_department, signer_position, signature_path,
                    signature_type, signature_owner_name, opinion, decision, signed_at
             FROM probation_signature_records
             WHERE confirmation_id = $1
             ORDER BY form_version ASC, signed_at ASC`,
            [oldConfirmation.id]
          )
          oldSignaturePaths.push(...oldSignaturesResult.rows.map(signature => signature.signature_path))
          const signatureHistorySnapshot = oldSignaturesResult.rows.map(
            ({ signature_path: _signaturePath, ...signature }) => signature,
          )
          const approvalRecordsResult = await client.query<{
            id: string
            instance_id: string
            step: number
            approver_id: string
            action: string
            comment: string | null
            action_time: string
            approver_name: string | null
            approver_role: string | null
          }>(
            `SELECT
               ar.id, ar.instance_id, ar.step, ar.approver_id,
               ar.action, ar.comment, ar.action_time,
               u.name AS approver_name, u.role AS approver_role
             FROM approval_records ar
             JOIN approval_instances ai ON ai.id = ar.instance_id
             LEFT JOIN users u ON u.id = ar.approver_id
             WHERE ai.target_id = $1 AND ai.target_type = 'probation'
             ORDER BY ar.action_time ASC`,
            [oldConfirmation.id],
          )

          await client.query(
            `INSERT INTO probation_history (
               id, employee_id, confirmation_id, hire_date, probation_end_date,
               status, submit_time, approve_time, approver_id, approver_comment,
               application_comment, reset_reason, reset_by, reset_at, new_hire_date,
               form_version, review_stage, approval_records_json,
               signature_history_json, created_at
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               $16,$17,$18,$19,$20
             )`,
            [
              nanoid(), id, oldConfirmation.id, oldConfirmation.hire_date,
              oldConfirmation.probation_end_date, oldConfirmation.status,
              oldConfirmation.submit_time, oldConfirmation.approve_time,
              oldConfirmation.approver_id, oldConfirmation.approver_comment,
              oldConfirmation.application_comment,
              String(data.reset_reason || '').trim() || '管理员将员工状态改为实习期',
              req.session.userId, now, newHireDate,
              oldConfirmation.form_version, oldConfirmation.review_stage,
              JSON.stringify(approvalRecordsResult.rows),
              JSON.stringify(signatureHistorySnapshot), now,
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

        const newProbationEndDate = currentContractDates.probationEndDate
        if (!newProbationEndDate) {
          throw new EmployeeOperationError('当前劳动合同未设置试用期，不能改为实习期')
        }
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
           hire_date = $17, contract_end_date = $18,
           contract_template_start_date = $19, contract_template_end_date = $20,
           probation_template_start_date = $21, probation_template_end_date = $22,
           department = $23, position = $24,
           bank_account_name = $25, bank_account_phone = $26, bank_name = $27,
           bank_account_number = $28, employment_status = $29, updated_at = $30
         WHERE id = $31`,
        [
          normalizedEmployeeNo, String(data.name).trim(), data.gender || null,
          data.birth_date || null, data.id_number || null, data.native_place || null,
          data.ethnicity || null, data.marital_status || null, data.education || null,
          data.school || null, data.major || null, data.mobile || null, data.email || null,
          data.emergency_contact || null, data.emergency_phone || null, data.address || null,
          resolvedHireDate, existing.contract_end_date,
          templateDates.contract_template_start_date,
          templateDates.contract_template_end_date,
          templateDates.probation_template_start_date,
          templateDates.probation_template_end_date,
          organizationSelection.department, organizationSelection.position,
          data.bank_account_name || null,
          data.bank_account_phone || null, data.bank_name || null, data.bank_account_number || null,
          requestedEmploymentStatus || existing.employment_status, now, id,
        ]
      )
      if ((updateResult.rowCount ?? 0) !== 1) {
        throw new EmployeeOperationError('员工信息更新失败', 409)
      }
      if (existing.user_id) {
        const userConflict = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE employee_no = $1 AND id <> $2 LIMIT 1`,
          [normalizedEmployeeNo, existing.user_id]
        )
        if (userConflict.rows[0]) throw new EmployeeOperationError('员工编号已被其他账号使用', 409)
        await client.query(
          `UPDATE users
           SET employee_no = $1, department = $2, position = $3, updated_at = $4
           WHERE id = $5`,
          [
            normalizedEmployeeNo,
            organizationSelection.department,
            organizationSelection.position,
            now,
            existing.user_id,
          ]
        )
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
    for (const storedPath of oldSignaturePaths) {
      try {
        const filePath = path.resolve(process.cwd(), storedPath.replace(/^[/\\]+/, ''))
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch (error) {
        console.error('清理旧转正签名失败:', error)
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
      UNION ALL
      SELECT file_path FROM probation_documents WHERE employee_id = ?
    `).all(id, id) as Array<{ file_path: string }>
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
    const recognizedTextBySourcePage = new Map<number, readonly string[]>()
    const analysis = await analyzeEmployeeDocumentBundle(file.path, originalFileName, {
      onPageRecognized: (pageNumber, recognizedTextCandidates) => {
        recognizedTextBySourcePage.set(pageNumber, recognizedTextCandidates)
      },
    })
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
      files: splitFiles.map(splitFile => ({
        ...splitFile,
        preRecognizedPageTextCandidates: mapEmployeeDocumentSectionRecognizedTexts(
          splitFile.pageNumbers,
          recognizedTextBySourcePage,
        ),
      })),
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
      currentHireDate: result.currentHireDate,
      currentContractEndDate: result.currentContractEndDate,
      currentProbationEndDate: result.currentProbationEndDate,
      probationConfirmationSynced: result.probationConfirmationSynced,
      contractTemplateLocked: result.contractTemplateLocked,
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
    if (isEmployeeDocumentOcrInfrastructureError(error)) {
      return res.status(503).json({
        success: false,
        message:
          '档案文字识别服务本次未能完整处理文件，为避免错误归档，本次未上传任何文件，请稍后重新上传',
      })
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
      currentHireDate: result.currentHireDate,
      currentContractEndDate: result.currentContractEndDate,
      currentProbationEndDate: result.currentProbationEndDate,
      probationConfirmationSynced: result.probationConfirmationSynced,
      contractTemplateLocked: result.contractTemplateLocked,
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
         SET hire_date = NULL, contract_end_date = NULL, updated_at = $1
         WHERE id = $2`,
        [now, id],
      )
      const probationConfirmationSynced = await syncProbationConfirmationFromContract(
        client,
        id,
        null,
        null,
        now,
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
        probationConfirmationSynced,
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
      currentHireDate: null,
      currentContractEndDate: null,
      currentProbationEndDate: null,
      probationConfirmationSynced: result.probationConfirmationSynced,
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
    let currentHireDate: string | null = null
    let currentContractEndDate: string | null = null
    let currentProbationEndDate: string | null = null
    let probationConfirmationSynced = false
    const now = new Date().toISOString()
    await db.transaction(async (client) => {
      await client.query(
        `DELETE FROM employee_documents WHERE id = $1 AND employee_id = $2`,
        [docId, id],
      )

      if (document.document_type === 'contract') {
        const currentContractDates = await findCurrentContractDates(client, id)
        currentHireDate = currentContractDates.hireDate
        currentContractEndDate = currentContractDates.contractEndDate
        currentProbationEndDate = currentContractDates.probationEndDate
        await client.query(
          `UPDATE employee_profiles
           SET hire_date = $1, contract_end_date = $2, updated_at = $3
           WHERE id = $4`,
          [currentHireDate, currentContractEndDate, now, id],
        )
        await syncEmployeeCurrentAndFuturePayroll(client, id, {
          resetManualMonthlySalary: false,
          ensureCurrentMonth: false,
          updatedAt: now,
        })
        probationConfirmationSynced = await syncProbationConfirmationFromContract(
          client,
          id,
          currentHireDate,
          currentProbationEndDate,
          now,
        )
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
      currentHireDate,
      currentContractEndDate,
      currentProbationEndDate,
      probationConfirmationSynced,
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

interface OnboardingTemplateEmployeeData {
  user_name: string | null
  profile_name: string | null
  id_number: string | null
  employee_no: string | null
  profile_employee_no: string | null
  contract_template_start_date: string | null
  contract_template_end_date: string | null
  probation_template_start_date: string | null
  probation_template_end_date: string | null
  position: string | null
}

async function getOnboardingTemplateEmployeeData(
  userId: string,
): Promise<OnboardingTemplateEmployeeData | undefined> {
  return await db.prepare(`
    SELECT
      u.name AS user_name,
      ep.name AS profile_name,
      ep.id_number,
      u.employee_no,
      ep.employee_no AS profile_employee_no,
      ep.contract_template_start_date,
      ep.contract_template_end_date,
      ep.probation_template_start_date,
      ep.probation_template_end_date,
      COALESCE(NULLIF(BTRIM(ep.position), ''), NULLIF(BTRIM(u.position), '')) AS position
    FROM users u
    LEFT JOIN employee_profiles ep ON ep.user_id = u.id
    WHERE u.id = ?
    ORDER BY ep.updated_at DESC NULLS LAST
    LIMIT 1
  `).get(userId) as OnboardingTemplateEmployeeData | undefined
}

function getContractTemplateAccessFields(
  user: OnboardingTemplateEmployeeData,
): ContractTemplateAccessFields {
  return {
    contractTemplateStartDate: user.contract_template_start_date,
    contractTemplateEndDate: user.contract_template_end_date,
    probationTemplateStartDate: user.probation_template_start_date,
    probationTemplateEndDate: user.probation_template_end_date,
    position: user.position,
  }
}

function getAssetAgreementTemplateData(
  user: OnboardingTemplateEmployeeData,
): EmployeeAssetAgreementTemplateData | null {
  const employeeName = (user.profile_name || user.user_name || '').trim()
  const idNumber = (user.id_number || '').trim()
  if (!employeeName || !idNumber) return null
  return { employeeName, idNumber }
}

function sendOnboardingTemplatePdf(
  res: Response,
  fileName: string,
  renderedPdf: Uint8Array,
) {
  const renderedBuffer = Buffer.from(renderedPdf)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`)
  res.setHeader('Content-Length', String(renderedBuffer.length))
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.send(renderedBuffer)
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
        // 上传时试写示例数据，避免员工下载时才发现模板缺少编号或日期位置。
        if (file_type === 'contract') {
          await writeEmployeeContractDataToOnboardingTemplate(
            file.path,
            'YULI-CS000',
            {
              contractStartDate: '2026-01-01',
              contractEndDate: '2026-12-31',
              probationStartDate: '2026-01-01',
              probationEndDate: '2026-06-30',
              position: '项目经理',
            },
          )
        } else if (file_type === 'asset') {
          await writeEmployeeAssetAgreementToOnboardingTemplate(
            file.path,
            'YULI-CS000',
            {
              employeeName: '张三',
              idNumber: '110101199001010000',
            },
          )
        } else {
          await writeEmployeeNumberToOnboardingTemplate(file.path, 'YULI-CS000', file_type)
        }
      } catch (error) {
        removeUploadedEmployeeDocument(file)
        const message = error instanceof EmployeeNumberFieldNotFoundError
          || error instanceof ContractTemplateDateFieldNotFoundError
          || error instanceof ContractTemplatePositionFieldNotFoundError
          || error instanceof AssetAgreementFieldNotFoundError
          ? error.message
          : '模板编号、日期、职位或电脑协议字段无法写入，请确认 PDF 未加密、未旋转且对应字样可识别'
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

// 在线预览入职文件模板。新周期未设置时继续显示上一期完整合同内容。
router.get('/onboarding/templates/:templateId/preview', requireAuth, async (req, res) => {
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

    if (!isNumberedOnboardingDocumentType(template.file_type)) {
      return sendOnboardingTemplatePdf(
        res,
        template.file_name,
        fs.readFileSync(filePath),
      )
    }

    const user = await getOnboardingTemplateEmployeeData(req.session.userId!)
    const employeeNo = normalizeEmployeeNumber(
      user?.employee_no || user?.profile_employee_no,
    )
    if (!user || !isValidEmployeeNumber(employeeNo)) {
      return res.status(409).json({
        success: false,
        message: '当前账号尚未设置有效员工编号，请联系管理员在用户管理中补充',
      })
    }

    let renderedPdf: Uint8Array
    const previewFields = template.file_type === 'contract'
      ? resolveContractTemplatePreviewFields(getContractTemplateAccessFields(user))
      : null
    if (template.file_type === 'asset') {
      const assetData = getAssetAgreementTemplateData(user)
      if (!assetData) {
        return res.status(409).json({
          success: false,
          message: '当前员工基础信息缺少姓名或身份证号码，请先填写并保存',
        })
      }
      renderedPdf = await writeEmployeeAssetAgreementToOnboardingTemplate(
        filePath,
        employeeNo,
        assetData,
      )
    } else if (template.file_type === 'contract') {
      if (!user.position?.trim()) {
        return res.status(409).json({
          success: false,
          message: '当前员工尚未设置职位，请联系管理员在员工数据中选择',
        })
      }
      renderedPdf = previewFields
        ? await writeEmployeeContractDataToOnboardingTemplate(
            filePath,
            employeeNo,
            {
              contractStartDate: previewFields.contractTemplateStartDate!,
              contractEndDate: previewFields.contractTemplateEndDate!,
              probationStartDate: previewFields.probationTemplateStartDate,
              probationEndDate: previewFields.probationTemplateEndDate,
              position: user.position,
            },
          )
        : await writeEmployeeContractPositionToOnboardingTemplate(
            filePath,
            employeeNo,
            user.position,
          )
    } else {
      renderedPdf = await writeEmployeeNumberToOnboardingTemplate(
        filePath,
        employeeNo,
        template.file_type,
      )
    }

    sendOnboardingTemplatePdf(res, template.file_name, renderedPdf)
  } catch (error) {
    console.error('预览入职文件模板失败:', error)
    if (
      error instanceof EmployeeNumberFieldNotFoundError
      || error instanceof ContractTemplateDateFieldNotFoundError
      || error instanceof ContractTemplatePositionFieldNotFoundError
      || error instanceof AssetAgreementFieldNotFoundError
    ) {
      return res.status(422).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '预览入职文件模板失败' })
  }
})

// 下载入职文件模板
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

    const user = await getOnboardingTemplateEmployeeData(req.session.userId!)
    const employeeNo = normalizeEmployeeNumber(user?.employee_no || user?.profile_employee_no)
    if (!user || !isValidEmployeeNumber(employeeNo)) {
      return res.status(409).json({
        success: false,
        message: '当前账号尚未设置有效员工编号，请联系管理员在用户管理中补充',
      })
    }

    let renderedPdf: Uint8Array
    if (template.file_type === 'asset') {
      const assetData = getAssetAgreementTemplateData(user)
      if (!assetData) {
        return res.status(409).json({
          success: false,
          message: '当前员工基础信息缺少姓名或身份证号码，请先填写并保存',
        })
      }
      renderedPdf = await writeEmployeeAssetAgreementToOnboardingTemplate(
        filePath,
        employeeNo,
        assetData,
      )
    } else if (template.file_type === 'contract') {
      const validationError = validateContractTemplateDownload(
        getContractTemplateAccessFields(user),
      )
      if (validationError) {
        return res.status(409).json({
          success: false,
          message: validationError,
        })
      }
      renderedPdf = await writeEmployeeContractDataToOnboardingTemplate(
        filePath,
        employeeNo,
        {
          contractStartDate: user.contract_template_start_date!,
          contractEndDate: user.contract_template_end_date!,
          probationStartDate: user.probation_template_start_date,
          probationEndDate: user.probation_template_end_date,
          position: user.position!,
        },
      )
    } else {
      renderedPdf = await writeEmployeeNumberToOnboardingTemplate(
        filePath,
        employeeNo,
        template.file_type,
      )
    }
    sendOnboardingTemplatePdf(res, template.file_name, renderedPdf)
  } catch (error) {
    console.error('下载入职文件模板失败:', error)
    if (
      error instanceof EmployeeNumberFieldNotFoundError
      || error instanceof ContractTemplateDateFieldNotFoundError
      || error instanceof ContractTemplatePositionFieldNotFoundError
      || error instanceof AssetAgreementFieldNotFoundError
    ) {
      return res.status(422).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '下载入职文件模板失败' })
  }
})

export default router
