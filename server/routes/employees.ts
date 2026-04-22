import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { db } from '../db/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import type { EmployeeProfile, EmployeeDocument, EmployeeResignationArchive } from '../types/database.js'
import { nanoid } from 'nanoid'

const router = Router()

// 根据入职日期计算合同到期日期（+1年）
function calculateContractEndDate(hireDate: string | null | undefined): string | null {
  if (!hireDate) return null
  try {
    const date = new Date(hireDate)
    if (isNaN(date.getTime())) return null
    date.setFullYear(date.getFullYear() + 1)
    return date.toISOString().split('T')[0] // YYYY-MM-DD
  } catch {
    return null
  }
}

// 员工档案文件上传目录
const employeeDocsDir = path.join(process.cwd(), 'uploads', 'employee-documents')

// 确保目录存在
if (!fs.existsSync(employeeDocsDir)) {
  fs.mkdirSync(employeeDocsDir, { recursive: true })
}

// 配置 multer 用于员工档案文件上传
const uploadEmployeeDoc = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const employeeId = req.params.id
      const destDir = path.join(employeeDocsDir, employeeId)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      cb(null, destDir)
    },
    filename: (req, file, cb) => {
      const documentType = req.body.document_type
      const ext = path.extname(file.originalname)
      const filename = `${documentType}-${Date.now()}${ext}`
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
      data: documents
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

    // 设置响应头
    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.file_name)}"`)

    // 发送文件
    const fileStream = fs.createReadStream(filePath)
    fileStream.pipe(res)
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
      SELECT id, status FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string; status: string } | undefined

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
        calculateContractEndDate(data.hire_date),
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
        calculateContractEndDate(data.hire_date),
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
    const userId = req.session.userId
    const now = new Date().toISOString()

    // 检查是否已有记录
    const existing = await db.prepare(`
      SELECT id, status, name, hire_date, employment_status FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { id: string; status: string; name: string; hire_date: string | null; employment_status: string | null } | undefined

    if (!existing) {
      return res.status(400).json({
        success: false,
        message: '请先填写员工信息'
      })
    }

    if (existing.status === 'submitted') {
      return res.status(400).json({
        success: false,
        message: '员工信息已提交'
      })
    }

    // 验证必填字段
    if (!existing.name) {
      return res.status(400).json({
        success: false,
        message: '请填写姓名'
      })
    }

    // 更新状态为已提交，仅在未设置 employment_status 时默认为 probation
    const newEmploymentStatus = existing.employment_status || 'probation'
    await db.prepare(`
      UPDATE employee_profiles SET status = 'submitted', employment_status = ?, updated_at = ? WHERE id = ?
    `).run(newEmploymentStatus, now, existing.id)

    // 计算试用期结束日期（入职日期 + 6个月）
    let probationEndDate = now.split('T')[0] // 默认为今天
    if (existing.hire_date) {
      const hireDate = new Date(existing.hire_date)
      hireDate.setMonth(hireDate.getMonth() + 6)
      probationEndDate = hireDate.toISOString().split('T')[0]
    }

    // 创建转正申请记录
    const confirmationId = nanoid()
    await db.prepare(`
      INSERT INTO probation_confirmations (
        id, employee_id, hire_date, probation_end_date, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      confirmationId,
      existing.id,
      existing.hire_date || now.split('T')[0],
      probationEndDate,
      now,
      now
    )

    const updated = await db.prepare(`
      SELECT * FROM employee_profiles WHERE id = ?
    `).get(existing.id)

    res.json({
      success: true,
      data: updated,
      message: '提交成功'
    })
  } catch (error) {
    console.error('提交员工信息失败:', error)
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

    const existing = await db.prepare(`
      SELECT id, employment_status, hire_date, status FROM employee_profiles WHERE id = ?
    `).get(id) as { id: string; employment_status: string | null; hire_date: string | null; status: string } | undefined

    if (!existing) {
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    // 检测是否将员工状态改回实习期（需要重新走转正流程）
    // 只有当请求中明确传入 employment_status 时才处理状态变更
    const requestedEmploymentStatus = data.employment_status
    const isResetToProbation = requestedEmploymentStatus === 'probation' && existing.employment_status !== 'probation'

    if (isResetToProbation) {
      // 归档旧转正记录到 probation_history
      const oldConfirmation = await db.prepare(`
        SELECT * FROM probation_confirmations WHERE employee_id = ?
      `).get(id) as any | undefined

      if (oldConfirmation) {
        const historyId = nanoid()
        await db.prepare(`
          INSERT INTO probation_history (
            id, employee_id, confirmation_id, hire_date, probation_end_date,
            status, submit_time, approve_time, approver_id, approver_comment,
            application_comment, reset_reason, reset_by, reset_at, new_hire_date, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          historyId,
          id,
          oldConfirmation.id,
          oldConfirmation.hire_date,
          oldConfirmation.probation_end_date,
          oldConfirmation.status,
          oldConfirmation.submit_time,
          oldConfirmation.approve_time,
          oldConfirmation.approver_id,
          oldConfirmation.approver_comment,
          oldConfirmation.application_comment,
          data.reset_reason || '管理员将员工状态改为实习期',
          req.session.userId,
          now,
          data.hire_date || null,
          now
        )

        // 删除旧转正文件的物理文件
        const oldDocs = await db.prepare(`
          SELECT file_path FROM probation_documents WHERE confirmation_id = ?
        `).all(oldConfirmation.id) as { file_path: string }[]
        for (const doc of oldDocs) {
          const fp = path.join(process.cwd(), doc.file_path)
          if (fs.existsSync(fp)) fs.unlinkSync(fp)
        }

        // 删除旧转正相关的数据库记录
        await db.prepare(`DELETE FROM probation_documents WHERE confirmation_id = ?`).run(oldConfirmation.id)
        await db.prepare(`DELETE FROM approval_records WHERE instance_id IN (SELECT id FROM approval_instances WHERE target_id = ? AND target_type = 'probation')`).run(oldConfirmation.id)
        await db.prepare(`DELETE FROM approval_instances WHERE target_id = ? AND target_type = 'probation'`).run(oldConfirmation.id)
        await db.prepare(`DELETE FROM probation_confirmations WHERE id = ?`).run(oldConfirmation.id)
      }

      // 用新的入职日期创建新的转正记录
      const newHireDate = data.hire_date || now.split('T')[0]
      const hireDateObj = new Date(newHireDate)
      hireDateObj.setMonth(hireDateObj.getMonth() + 6)
      const newProbationEndDate = hireDateObj.toISOString().split('T')[0]

      const confirmationId = nanoid()
      await db.prepare(`
        INSERT INTO probation_confirmations (
          id, employee_id, hire_date, probation_end_date, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `).run(confirmationId, id, newHireDate, newProbationEndDate, now, now)
    }

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
        department = ?,
        position = ?,
        bank_account_name = ?,
        bank_account_phone = ?,
        bank_name = ?,
        bank_account_number = ?,
        employment_status = ?,
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
      calculateContractEndDate(data.hire_date),
      data.department || null,
      data.position || null,
      data.bank_account_name || null,
      data.bank_account_phone || null,
      data.bank_name || null,
      data.bank_account_number || null,
      requestedEmploymentStatus || existing.employment_status,   // 如果请求中传了 employment_status 则更新，否则保持原有
      now,
      id
    )

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

    // 删除员工档案文件（物理文件）
    const employeeDocDir = path.join(employeeDocsDir, id)
    if (fs.existsSync(employeeDocDir)) {
      fs.rmSync(employeeDocDir, { recursive: true })
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
    `).get(id)

    if (!employee) {
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    const documents = await db.prepare(`
      SELECT * FROM employee_documents WHERE employee_id = ? ORDER BY created_at DESC
    `).all(id) as EmployeeDocument[]

    res.json({
      success: true,
      data: documents
    })
  } catch (error) {
    console.error('获取员工档案文件失败:', error)
    res.status(500).json({ success: false, message: '获取员工档案文件失败' })
  }
})

// 上传员工档案文件
router.post('/:id/documents', requireAdmin, uploadEmployeeDoc.single('file'), async (req, res) => {
  try {
    const { id } = req.params
    const { document_type, originalFileName } = req.body
    const file = req.file

    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' })
    }

    if (!document_type) {
      // 删除已上传的文件
      fs.unlinkSync(file.path)
      return res.status(400).json({ success: false, message: '请指定文档类型' })
    }

    // 检查员工是否存在
    const employee = await db.prepare(`
      SELECT id FROM employee_profiles WHERE id = ?
    `).get(id)

    if (!employee) {
      fs.unlinkSync(file.path)
      return res.status(404).json({ success: false, message: '员工信息不存在' })
    }

    // 获取上传者信息
    const uploader = await db.prepare(`
      SELECT name FROM users WHERE id = ?
    `).get(req.session.userId) as { name: string } | undefined

    // 优先使用前端传递的原始文件名，否则尝试解码
    const decodedFileName = originalFileName || Buffer.from(file.originalname, 'latin1').toString('utf8')

    const docId = nanoid()
    const now = new Date().toISOString()
    const relativePath = `/uploads/employee-documents/${id}/${file.filename}`

    await db.prepare(`
      INSERT INTO employee_documents (
        id, employee_id, document_type, file_name, file_path,
        file_size, mime_type, uploaded_by, uploaded_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      docId,
      id,
      document_type,
      decodedFileName,
      relativePath,
      file.size,
      file.mimetype,
      req.session.userId,
      uploader?.name || null,
      now
    )

    const document = await db.prepare(`
      SELECT * FROM employee_documents WHERE id = ?
    `).get(docId)

    res.json({
      success: true,
      message: '文件上传成功',
      data: document
    })
  } catch (error) {
    console.error('上传员工档案文件失败:', error)
    // 如果有文件，尝试删除
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path)
      } catch (e) {
        // 忽略删除失败
      }
    }
    res.status(500).json({ success: false, message: '上传员工档案文件失败' })
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

    // 删除物理文件
    const filePath = path.join(process.cwd(), document.file_path)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除数据库记录
    await db.prepare(`DELETE FROM employee_documents WHERE id = ?`).run(docId)

    res.json({
      success: true,
      message: '文件删除成功'
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

    // 设置响应头
    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.file_name)}"`)

    // 发送文件
    const fileStream = fs.createReadStream(filePath)
    fileStream.pipe(res)
  } catch (error) {
    console.error('下载员工档案文件失败:', error)
    res.status(500).json({ success: false, message: '下载员工档案文件失败' })
  }
})

// ==================== 入职文件模板管理 API ====================

// 入职文件模板上传目录
const onboardingTemplatesDir = path.join(process.cwd(), 'uploads', 'onboarding-templates')

// 确保目录存在
if (!fs.existsSync(onboardingTemplatesDir)) {
  fs.mkdirSync(onboardingTemplatesDir, { recursive: true })
}

// 配置 multer 用于入职文件模板上传
const uploadOnboardingTemplate = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, onboardingTemplatesDir)
    },
    filename: (req, file, cb) => {
      const fileType = req.body.file_type || 'unknown'
      // 解码中文文件名
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
      const ext = path.extname(originalName)
      const filename = `${fileType}-${Date.now()}${ext}`
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

    // 优先使用前端传递的原始文件名，否则尝试解码
    const originalFileName = bodyOriginalFileName || Buffer.from(file.originalname, 'latin1').toString('utf8')

    // 获取上传者信息
    const uploader = await db.prepare(`
      SELECT name FROM users WHERE id = ?
    `).get(req.session.userId) as { name: string } | undefined

    const templateId = nanoid()
    const now = new Date().toISOString()
    const relativePath = `/uploads/onboarding-templates/${file.filename}`

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

    // 设置响应头
    res.setHeader('Content-Type', template.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(template.file_name)}"`)

    // 发送文件
    const fileStream = fs.createReadStream(filePath)
    fileStream.pipe(res)
  } catch (error) {
    console.error('下载入职文件模板失败:', error)
    res.status(500).json({ success: false, message: '下载入职文件模板失败' })
  }
})

export default router
