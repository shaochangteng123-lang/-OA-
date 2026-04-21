import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { db } from '../db/index.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { nanoid } from 'nanoid'
import { calculateLeaveDays, calculateAnnualLeaveDays } from '../services/leaveCalculator.js'

const router = Router()

// ==================== 文件上传配置 ====================

const leaveAttachmentsDir = path.join(process.cwd(), 'uploads', 'leave-attachments')

if (!fs.existsSync(leaveAttachmentsDir)) {
  fs.mkdirSync(leaveAttachmentsDir, { recursive: true })
}

const uploadLeaveAttachment = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const requestId = req.params.id || 'temp'
      const destDir = path.join(leaveAttachmentsDir, requestId)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      cb(null, destDir)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname)
      cb(null, `${nanoid()}-${Date.now()}${ext}`)
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg', 'image/png', 'image/webp',
      'application/pdf',
    ]
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 JPG、PNG、PDF 格式的文件'))
    }
  },
})

// ==================== 工具函数 ====================

/**
 * 查找申请人的审批人（同部门的管理人员）
 * 逻辑：同部门且 role 为 admin/general_manager/super_admin，不含申请人自身
 * 若无，则回退到任意 admin
 */
async function findApprover(applicantUserId: string, applicantDepartment: string | null): Promise<{ id: string; name: string } | null> {
  if (applicantDepartment) {
    const sameDeptApprover = await db.prepare(`
      SELECT id, name FROM users
      WHERE department = ?
        AND role IN ('admin', 'general_manager', 'super_admin')
        AND id != ?
        AND status = 'active'
      LIMIT 1
    `).get<{ id: string; name: string }>(applicantDepartment, applicantUserId)

    if (sameDeptApprover) return sameDeptApprover
  }

  // 回退：任意 admin
  const fallbackApprover = await db.prepare(`
    SELECT id, name FROM users
    WHERE role IN ('super_admin', 'admin')
      AND id != ?
      AND status = 'active'
    LIMIT 1
  `).get<{ id: string; name: string }>(applicantUserId)

  return fallbackApprover || null
}

/**
 * 生成请假申请编号：LR-YYYY-NNNNN
 */
async function generateRequestNo(): Promise<string> {
  const year = new Date().getFullYear()
  const lastReq = await db.prepare(`
    SELECT request_no FROM leave_requests
    WHERE request_no LIKE ?
    ORDER BY request_no DESC LIMIT 1
  `).get<{ request_no: string }>(`LR-${year}-%`)

  let seq = 1
  if (lastReq?.request_no) {
    const match = lastReq.request_no.match(/LR-\d{4}-(\d+)/)
    if (match) seq = parseInt(match[1], 10) + 1
  }
  return `LR-${year}-${String(seq).padStart(5, '0')}`
}

/**
 * 获取或初始化用户当年假期余额
 * 年假根据入职日期自动计算，其他类型使用默认值
 */
async function ensureLeaveBalance(userId: string, leaveTypeCode: string, year: number): Promise<{ total_days: number; used_days: number; pending_days: number }> {
  const existing = await db.prepare(`
    SELECT total_days, used_days, pending_days
    FROM leave_balances
    WHERE user_id = ? AND leave_type_code = ? AND year = ?
  `).get<{ total_days: number; used_days: number; pending_days: number }>(userId, leaveTypeCode, year)

  if (existing) return existing

  // 初始化余额
  let totalDays = 0
  const typeConfig = await db.prepare(`
    SELECT default_days FROM leave_type_configs WHERE code = ?
  `).get<{ default_days: number }>(leaveTypeCode)

  if (leaveTypeCode === 'annual') {
    // 年假：根据入职日期计算
    const userInfo = await db.prepare(`
      SELECT hire_date FROM employee_profiles WHERE user_id = ? AND status = 'submitted'
    `).get<{ hire_date: string | null }>(userId)
    if (userInfo?.hire_date) {
      totalDays = calculateAnnualLeaveDays(userInfo.hire_date, year)
    }
  } else {
    totalDays = Number(typeConfig?.default_days ?? 0)
  }

  const id = nanoid()
  const now = new Date().toISOString()
  await db.prepare(`
    INSERT INTO leave_balances (id, user_id, leave_type_code, year, total_days, used_days, pending_days, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
  `).run(id, userId, leaveTypeCode, year, totalDays, now, now)

  return { total_days: totalDays, used_days: 0, pending_days: 0 }
}

// ==================== 工具函数：根据性别获取需排除的假期类型 ====================

/**
 * 根据用户性别返回应排除的假期类型 code 列表
 * male（男）→ 排除产假 maternity
 * female（女）→ 排除陪产假 paternity
 * 其他/未知 → 不排除
 */
async function getGenderExcludedTypes(userId: string): Promise<string[]> {
  const profile = await db.prepare(`
    SELECT gender FROM employee_profiles WHERE user_id = ? AND status = 'submitted'
  `).get<{ gender: string | null }>(userId)

  const gender = profile?.gender
  if (gender === 'male') return ['maternity']
  if (gender === 'female') return ['paternity']
  return []
}

// ==================== 通用接口 ====================

// 获取假期类型列表
router.get('/types', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const excludedCodes = await getGenderExcludedTypes(userId!)

    let types
    if (excludedCodes.length > 0) {
      const placeholders = excludedCodes.map(() => '?').join(', ')
      types = await db.prepare(`
        SELECT * FROM leave_type_configs
        WHERE is_active = true AND code NOT IN (${placeholders})
        ORDER BY sort_order
      `).all(...excludedCodes)
    } else {
      types = await db.prepare(`
        SELECT * FROM leave_type_configs WHERE is_active = true ORDER BY sort_order
      `).all()
    }

    res.json({ success: true, data: types })
  } catch (error) {
    console.error('获取假期类型失败:', error)
    res.status(500).json({ success: false, message: '获取假期类型失败' })
  }
})

// 预计算请假时长（前端填表实时调用）
router.post('/calculate-days', requireAuth, async (req, res) => {
  try {
    const { startDate, startHalf, endDate, endHalf } = req.body

    if (!startDate || !endDate || !startHalf || !endHalf) {
      return res.status(400).json({ success: false, message: '参数不完整' })
    }

    if (startDate > endDate) {
      return res.status(400).json({ success: false, message: '结束日期不能早于开始日期' })
    }

    if (startDate === endDate && startHalf === 'afternoon' && endHalf === 'morning') {
      return res.status(400).json({ success: false, message: '结束时间不能早于开始时间' })
    }

    const days = await calculateLeaveDays(startDate, startHalf, endDate, endHalf)
    res.json({ success: true, data: { days } })
  } catch (error) {
    console.error('计算请假时长失败:', error)
    res.status(500).json({ success: false, message: '计算请假时长失败' })
  }
})

// 查询本人当年假期余额
router.get('/balances', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const year = new Date().getFullYear()
    const excludedCodes = await getGenderExcludedTypes(userId!)

    let types
    if (excludedCodes.length > 0) {
      const placeholders = excludedCodes.map(() => '?').join(', ')
      types = await db.prepare(`
        SELECT code, name, requires_balance_check, default_days
        FROM leave_type_configs
        WHERE is_active = true AND code NOT IN (${placeholders})
        ORDER BY sort_order
      `).all<{ code: string; name: string; requires_balance_check: boolean; default_days: number }>(...excludedCodes)
    } else {
      types = await db.prepare(`
        SELECT code, name, requires_balance_check, default_days
        FROM leave_type_configs WHERE is_active = true ORDER BY sort_order
      `).all<{ code: string; name: string; requires_balance_check: boolean; default_days: number }>()
    }

    const balances = []
    for (const type of types) {
      const balance = await ensureLeaveBalance(userId!, type.code, year)
      balances.push({
        leave_type_code: type.code,
        leave_type_name: type.name,
        requires_balance_check: type.requires_balance_check,
        year,
        total_days: balance.total_days,
        used_days: balance.used_days,
        pending_days: balance.pending_days,
        available_days: Math.max(0, balance.total_days - balance.used_days - balance.pending_days),
      })
    }

    res.json({ success: true, data: balances })
  } catch (error) {
    console.error('获取假期余额失败:', error)
    res.status(500).json({ success: false, message: '获取假期余额失败' })
  }
})

// ==================== 申请管理 ====================

// 提交请假申请（支持附件上传）
router.post('/requests', requireAuth, uploadLeaveAttachment.array('attachments', 5), async (req, res) => {
  const uploadedFiles = (req.files as Express.Multer.File[]) || []
  try {
    const userId = req.session.userId!
    const { leaveTypeCode, startDate, startHalf, endDate, endHalf, reason } = req.body

    // 基础校验
    const NO_REASON_TYPES = ['annual', 'marriage', 'bereavement', 'maternity', 'paternity']
    const requiresReason = !NO_REASON_TYPES.includes(leaveTypeCode)
    if (!leaveTypeCode || !startDate || !startHalf || !endDate || !endHalf || (requiresReason && !reason)) {
      // 清理已上传文件
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '请填写所有必填字段' })
    }

    if (startDate > endDate) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '结束日期不能早于开始日期' })
    }

    if (startDate === endDate && startHalf === 'afternoon' && endHalf === 'morning') {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '结束时间不能早于开始时间' })
    }

    // 获取假期类型配置
    const typeConfig = await db.prepare(`
      SELECT * FROM leave_type_configs WHERE code = ? AND is_active = true
    `).get<{ id: string; code: string; name: string; requires_attachment: boolean; requires_balance_check: boolean }>(leaveTypeCode)

    if (!typeConfig) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '假期类型不存在' })
    }

    // 性别与假期类型匹配校验：产假仅限女性，陪产假仅限男性
    const excludedCodes = await getGenderExcludedTypes(userId)
    if (excludedCodes.includes(leaveTypeCode)) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      const tipMap: Record<string, string> = {
        maternity: '产假仅适用于女性员工',
        paternity: '陪产假仅适用于男性员工',
      }
      return res.status(400).json({ success: false, message: tipMap[leaveTypeCode] || '该假期类型不适用于您的性别' })
    }

    // 病假必须上传附件
    if (typeConfig.requires_attachment && uploadedFiles.length === 0) {
      return res.status(400).json({ success: false, message: `${typeConfig.name}需要上传证明文件（病历或假条）` })
    }

    // 服务端计算请假天数
    const totalDays = await calculateLeaveDays(startDate, startHalf, endDate, endHalf)
    if (totalDays <= 0) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '请假时长不能为0（所选时间段全为休息日）' })
    }

    // 获取申请人信息
    const userInfo = await db.prepare(`
      SELECT name, department FROM users WHERE id = ?
    `).get<{ name: string; department: string | null }>(userId)

    if (!userInfo) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '用户信息不存在' })
    }

    // 检查余额（需要校验余额的类型）
    const year = new Date().getFullYear()
    if (typeConfig.requires_balance_check) {
      const balance = await ensureLeaveBalance(userId, leaveTypeCode, year)
      const available = balance.total_days - balance.used_days - balance.pending_days
      if (available < totalDays) {
        for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
        return res.status(400).json({
          success: false,
          message: `${typeConfig.name}余额不足，可用 ${available} 天，申请 ${totalDays} 天`
        })
      }
    }

    // 查找审批人
    const approver = await findApprover(userId, userInfo.department)
    if (!approver) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '未找到审批人，请联系管理员' })
    }

    const requestId = nanoid()
    const requestNo = await generateRequestNo()
    const now = new Date().toISOString()

    // 使用事务保证原子性
    await db.transaction(async (client) => {
      // 插入申请记录
      await client.query(
        `INSERT INTO leave_requests (
          id, request_no, user_id, applicant_name, applicant_department,
          leave_type_code, leave_type_name, start_date, start_half, end_date, end_half,
          total_days, reason, status, approver_id, approver_name,
          submitted_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$15,$16,$17,$18)`,
        [
          requestId, requestNo, userId, userInfo.name, userInfo.department,
          leaveTypeCode, typeConfig.name, startDate, startHalf, endDate, endHalf,
          totalDays, reason, approver.id, approver.name,
          now, now, now
        ]
      )

      // 插入附件记录（需要先移动文件到正式目录）
      for (const file of uploadedFiles) {
        const newDir = path.join(leaveAttachmentsDir, requestId)
        if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true })
        const newPath = path.join(newDir, path.basename(file.path))
        if (file.path !== newPath) fs.renameSync(file.path, newPath)

        const relativePath = `/uploads/leave-attachments/${requestId}/${path.basename(newPath)}`
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
        await client.query(
          `INSERT INTO leave_attachments (id, leave_request_id, file_name, file_path, file_size, mime_type, uploaded_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [nanoid(), requestId, originalName, relativePath, file.size, file.mimetype, userId, now]
        )
      }

      // 更新余额：pending_days += totalDays（需要校验余额的类型）
      if (typeConfig.requires_balance_check) {
        await ensureLeaveBalance(userId, leaveTypeCode, year) // 确保余额记录存在
        await client.query(
          `UPDATE leave_balances SET pending_days = pending_days + $1, updated_at = $2
           WHERE user_id = $3 AND leave_type_code = $4 AND year = $5`,
          [totalDays, now, userId, leaveTypeCode, year]
        )
      }

      // 写入审批日志
      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'submit',null,$5)`,
        [nanoid(), requestId, userId, userInfo.name, now]
      )
    })

    res.json({ success: true, message: '请假申请已提交，等待审批', data: { id: requestId, requestNo } })
  } catch (error) {
    console.error('提交请假申请失败:', error)
    // 清理上传文件
    for (const f of uploadedFiles) {
      try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path) } catch {}
    }
    res.status(500).json({ success: false, message: '提交请假申请失败' })
  }
})

// 查询本人申请列表
router.get('/requests', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { status, leaveTypeCode, startDate, endDate, page = 1, pageSize = 20 } = req.query

    let sql = `SELECT lr.*, u.name as user_name
               FROM leave_requests lr
               LEFT JOIN users u ON lr.user_id = u.id
               WHERE lr.user_id = ?`
    const params: any[] = [userId]

    if (status) { sql += ` AND lr.status = ?`; params.push(status) }
    if (leaveTypeCode) { sql += ` AND lr.leave_type_code = ?`; params.push(leaveTypeCode) }
    if (startDate) { sql += ` AND lr.start_date >= ?`; params.push(startDate) }
    if (endDate) { sql += ` AND lr.end_date <= ?`; params.push(endDate) }

    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM')
    const countResult = await db.prepare(countSql).get<{ total: number }>(...params)

    const offset = (Number(page) - 1) * Number(pageSize)
    sql += ` ORDER BY lr.created_at DESC LIMIT ? OFFSET ?`
    params.push(Number(pageSize), offset)

    const list = await db.prepare(sql).all(...params)

    res.json({
      success: true,
      data: {
        list,
        total: Number(countResult?.total || 0),
        page: Number(page),
        pageSize: Number(pageSize),
      }
    })
  } catch (error) {
    console.error('获取请假申请列表失败:', error)
    res.status(500).json({ success: false, message: '获取请假申请列表失败' })
  }
})

// 查看单条申请详情（含审批日志）
router.get('/requests/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { id } = req.params

    // 查申请（本人 or 审批人 or 管理员均可查看）
    const userInfo = await db.prepare(`SELECT role FROM users WHERE id = ?`).get<{ role: string }>(userId)
    const isAdmin = userInfo?.role === 'admin' || userInfo?.role === 'super_admin'

    let request
    if (isAdmin) {
      request = await db.prepare(`SELECT * FROM leave_requests WHERE id = ?`).get(id)
    } else {
      request = await db.prepare(`
        SELECT * FROM leave_requests WHERE id = ? AND (user_id = ? OR approver_id = ?)
      `).get(id, userId, userId)
    }

    if (!request) {
      return res.status(404).json({ success: false, message: '申请不存在或无权查看' })
    }

    // 获取附件
    const attachments = await db.prepare(`
      SELECT id, file_name, file_size, mime_type, created_at
      FROM leave_attachments WHERE leave_request_id = ? ORDER BY created_at
    `).all(id)

    // 获取审批日志
    const logs = await db.prepare(`
      SELECT * FROM leave_approval_logs WHERE leave_request_id = ? ORDER BY created_at
    `).all(id)

    res.json({ success: true, data: { ...request, attachments, logs } })
  } catch (error) {
    console.error('获取申请详情失败:', error)
    res.status(500).json({ success: false, message: '获取申请详情失败' })
  }
})

// 下载附件
router.get('/attachments/:attachmentId/download', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { attachmentId } = req.params

    const attachment = await db.prepare(`
      SELECT la.*, lr.user_id, lr.approver_id
      FROM leave_attachments la
      JOIN leave_requests lr ON la.leave_request_id = lr.id
      WHERE la.id = ?
    `).get<{ file_name: string; file_path: string; mime_type: string; user_id: string; approver_id: string }>(attachmentId)

    if (!attachment) {
      return res.status(404).json({ success: false, message: '附件不存在' })
    }

    // 权限：本人、审批人或管理员
    const userInfo = await db.prepare(`SELECT role FROM users WHERE id = ?`).get<{ role: string }>(userId)
    const isAdmin = userInfo?.role === 'admin' || userInfo?.role === 'super_admin'
    if (!isAdmin && attachment.user_id !== userId && attachment.approver_id !== userId) {
      return res.status(403).json({ success: false, message: '无权下载此附件' })
    }

    const filePath = path.join(process.cwd(), attachment.file_path)
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '文件不存在' })
    }

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.file_name)}"`)
    fs.createReadStream(filePath).pipe(res)
  } catch (error) {
    console.error('下载附件失败:', error)
    res.status(500).json({ success: false, message: '下载附件失败' })
  }
})

// 撤销申请（仅 pending 状态）
router.post('/requests/:id/cancel', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { id } = req.params

    const request = await db.prepare(`
      SELECT * FROM leave_requests WHERE id = ? AND user_id = ?
    `).get<{ status: string; leave_type_code: string; total_days: number }>(id, userId)

    if (!request) {
      return res.status(404).json({ success: false, message: '申请不存在' })
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: '只能撤销审批中的申请' })
    }

    const now = new Date().toISOString()
    const year = new Date().getFullYear()
    const userInfo = await db.prepare(`SELECT name FROM users WHERE id = ?`).get<{ name: string }>(userId)

    await db.transaction(async (client) => {
      await client.query(
        `UPDATE leave_requests SET status = 'cancelled', cancelled_at = $1, updated_at = $2 WHERE id = $3`,
        [now, now, id]
      )

      // 释放 pending_days
      const typeConfig = await db.prepare(`SELECT requires_balance_check FROM leave_type_configs WHERE code = ?`).get<{ requires_balance_check: boolean }>(request.leave_type_code)
      if (typeConfig?.requires_balance_check) {
        await client.query(
          `UPDATE leave_balances SET pending_days = GREATEST(0, pending_days - $1), updated_at = $2
           WHERE user_id = $3 AND leave_type_code = $4 AND year = $5`,
          [request.total_days, now, userId, request.leave_type_code, year]
        )
      }

      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'cancel',null,$5)`,
        [nanoid(), id, userId, userInfo?.name || '', now]
      )
    })

    res.json({ success: true, message: '申请已撤销' })
  } catch (error) {
    console.error('撤销申请失败:', error)
    res.status(500).json({ success: false, message: '撤销申请失败' })
  }
})

// 驳回后修改重新提交（创建新版本）
router.post('/requests/:id/resubmit', requireAuth, uploadLeaveAttachment.array('attachments', 5), async (req, res) => {
  const uploadedFiles = (req.files as Express.Multer.File[]) || []
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const { startDate, startHalf, endDate, endHalf, reason } = req.body

    const originalRequest = await db.prepare(`
      SELECT * FROM leave_requests WHERE id = ? AND user_id = ?
    `).get<{
      status: string; version: number; leave_type_code: string;
      total_days: number; request_no: string
    }>(id, userId)

    if (!originalRequest) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(404).json({ success: false, message: '申请不存在' })
    }
    if (originalRequest.status !== 'rejected') {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '只有被驳回的申请才可重新提交' })
    }

    const leaveTypeCode = req.body.leaveTypeCode || originalRequest.leave_type_code
    const typeConfig = await db.prepare(`
      SELECT * FROM leave_type_configs WHERE code = ? AND is_active = true
    `).get<{ name: string; requires_attachment: boolean; requires_balance_check: boolean }>(leaveTypeCode)

    if (!typeConfig) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '假期类型不存在' })
    }

    // 性别与假期类型匹配校验
    const excludedCodesResubmit = await getGenderExcludedTypes(userId)
    if (excludedCodesResubmit.includes(leaveTypeCode)) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      const tipMap: Record<string, string> = {
        maternity: '产假仅适用于女性员工',
        paternity: '陪产假仅适用于男性员工',
      }
      return res.status(400).json({ success: false, message: tipMap[leaveTypeCode] || '该假期类型不适用于您的性别' })
    }

    if (typeConfig.requires_attachment && uploadedFiles.length === 0) {
      return res.status(400).json({ success: false, message: `${typeConfig.name}需要上传证明文件` })
    }

    const totalDays = await calculateLeaveDays(startDate, startHalf, endDate, endHalf)
    if (totalDays <= 0) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '请假时长不能为0' })
    }

    const userInfo = await db.prepare(`SELECT name, department FROM users WHERE id = ?`).get<{ name: string; department: string | null }>(userId)
    const approver = await findApprover(userId, userInfo?.department || null)

    if (!approver) {
      for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
      return res.status(400).json({ success: false, message: '未找到审批人，请联系管理员' })
    }

    const year = new Date().getFullYear()
    if (typeConfig.requires_balance_check) {
      const balance = await ensureLeaveBalance(userId, leaveTypeCode, year)
      const available = balance.total_days - balance.used_days - balance.pending_days
      if (available < totalDays) {
        for (const f of uploadedFiles) fs.existsSync(f.path) && fs.unlinkSync(f.path)
        return res.status(400).json({
          success: false,
          message: `${typeConfig.name}余额不足，可用 ${available} 天，申请 ${totalDays} 天`
        })
      }
    }

    const newRequestId = nanoid()
    const newRequestNo = await generateRequestNo()
    const now = new Date().toISOString()

    await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO leave_requests (
          id, request_no, user_id, applicant_name, applicant_department,
          leave_type_code, leave_type_name, start_date, start_half, end_date, end_half,
          total_days, reason, status, approver_id, approver_name,
          submitted_at, version, original_id, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$15,$16,$17,$18,$19,$20)`,
        [
          newRequestId, newRequestNo, userId, userInfo?.name || '', userInfo?.department || null,
          leaveTypeCode, typeConfig.name, startDate, startHalf, endDate, endHalf,
          totalDays, reason, approver.id, approver.name,
          now, originalRequest.version + 1, id, now, now
        ]
      )

      for (const file of uploadedFiles) {
        const newDir = path.join(leaveAttachmentsDir, newRequestId)
        if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true })
        const newPath = path.join(newDir, path.basename(file.path))
        if (file.path !== newPath) fs.renameSync(file.path, newPath)
        const relativePath = `/uploads/leave-attachments/${newRequestId}/${path.basename(newPath)}`
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
        await client.query(
          `INSERT INTO leave_attachments (id, leave_request_id, file_name, file_path, file_size, mime_type, uploaded_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [nanoid(), newRequestId, originalName, relativePath, file.size, file.mimetype, userId, now]
        )
      }

      if (typeConfig.requires_balance_check) {
        await ensureLeaveBalance(userId, leaveTypeCode, year)
        await client.query(
          `UPDATE leave_balances SET pending_days = pending_days + $1, updated_at = $2
           WHERE user_id = $3 AND leave_type_code = $4 AND year = $5`,
          [totalDays, now, userId, leaveTypeCode, year]
        )
      }

      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'resubmit','重新提交',$5)`,
        [nanoid(), newRequestId, userId, userInfo?.name || '', now]
      )
    })

    res.json({ success: true, message: '已重新提交申请', data: { id: newRequestId, requestNo: newRequestNo } })
  } catch (error) {
    console.error('重新提交申请失败:', error)
    for (const f of uploadedFiles) {
      try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path) } catch {}
    }
    res.status(500).json({ success: false, message: '重新提交申请失败' })
  }
})

// ==================== 审批端接口 ====================

// 待我审批的申请列表
router.get('/pending', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const list = await db.prepare(`
      SELECT lr.*, u.name as user_name, u.department as user_department
      FROM leave_requests lr
      LEFT JOIN users u ON lr.user_id = u.id
      WHERE lr.approver_id = ? AND lr.status = 'pending'
      ORDER BY lr.submitted_at ASC
    `).all(userId)
    res.json({ success: true, data: list })
  } catch (error) {
    console.error('获取待审批列表失败:', error)
    res.status(500).json({ success: false, message: '获取待审批列表失败' })
  }
})

// 审批通过
router.post('/requests/:id/approve', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { id } = req.params
    const { comment } = req.body

    const request = await db.prepare(`
      SELECT * FROM leave_requests WHERE id = ? AND approver_id = ? AND status = 'pending'
    `).get<{ user_id: string; leave_type_code: string; total_days: number }>(id, userId)

    if (!request) {
      return res.status(404).json({ success: false, message: '申请不存在或无权操作' })
    }

    const userInfo = await db.prepare(`SELECT name FROM users WHERE id = ?`).get<{ name: string }>(userId)
    const now = new Date().toISOString()
    const year = new Date(now).getFullYear()

    await db.transaction(async (client) => {
      await client.query(
        `UPDATE leave_requests SET status = 'approved', approved_at = $1, updated_at = $2 WHERE id = $3`,
        [now, now, id]
      )

      // 余额操作：pending_days - totalDays；used_days + totalDays
      const typeConfig = await db.prepare(`SELECT requires_balance_check FROM leave_type_configs WHERE code = ?`).get<{ requires_balance_check: boolean }>(request.leave_type_code)
      if (typeConfig?.requires_balance_check) {
        await client.query(
          `UPDATE leave_balances
           SET pending_days = GREATEST(0, pending_days - $1),
               used_days = used_days + $2,
               updated_at = $3
           WHERE user_id = $4 AND leave_type_code = $5 AND year = $6`,
          [request.total_days, request.total_days, now, request.user_id, request.leave_type_code, year]
        )
      }

      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'approve',$5,$6)`,
        [nanoid(), id, userId, userInfo?.name || '', comment || null, now]
      )
    })

    res.json({ success: true, message: '已审批通过' })
  } catch (error) {
    console.error('审批通过失败:', error)
    res.status(500).json({ success: false, message: '审批操作失败' })
  }
})

// 驳回
router.post('/requests/:id/reject', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { id } = req.params
    const { rejectReason } = req.body

    if (!rejectReason || !rejectReason.trim()) {
      return res.status(400).json({ success: false, message: '驳回时必须填写驳回理由' })
    }

    const request = await db.prepare(`
      SELECT * FROM leave_requests WHERE id = ? AND approver_id = ? AND status = 'pending'
    `).get<{ user_id: string; leave_type_code: string; total_days: number }>(id, userId)

    if (!request) {
      return res.status(404).json({ success: false, message: '申请不存在或无权操作' })
    }

    const userInfo = await db.prepare(`SELECT name FROM users WHERE id = ?`).get<{ name: string }>(userId)
    const now = new Date().toISOString()
    const year = new Date(now).getFullYear()

    await db.transaction(async (client) => {
      await client.query(
        `UPDATE leave_requests SET status = 'rejected', reject_reason = $1, rejected_at = $2, updated_at = $3 WHERE id = $4`,
        [rejectReason.trim(), now, now, id]
      )

      // 释放 pending_days
      const typeConfig = await db.prepare(`SELECT requires_balance_check FROM leave_type_configs WHERE code = ?`).get<{ requires_balance_check: boolean }>(request.leave_type_code)
      if (typeConfig?.requires_balance_check) {
        await client.query(
          `UPDATE leave_balances
           SET pending_days = GREATEST(0, pending_days - $1), updated_at = $2
           WHERE user_id = $3 AND leave_type_code = $4 AND year = $5`,
          [request.total_days, now, request.user_id, request.leave_type_code, year]
        )
      }

      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'reject',$5,$6)`,
        [nanoid(), id, userId, userInfo?.name || '', rejectReason.trim(), now]
      )
    })

    res.json({ success: true, message: '已驳回申请' })
  } catch (error) {
    console.error('驳回申请失败:', error)
    res.status(500).json({ success: false, message: '驳回操作失败' })
  }
})

// ==================== 管理员接口 ====================

// 获取所有假期类型（管理员视图，仅活跃）
router.get('/admin/types', requireAdmin, async (req, res) => {
  try {
    const types = await db.prepare(`
      SELECT * FROM leave_type_configs WHERE is_active = true ORDER BY sort_order
    `).all()
    res.json({ success: true, data: types })
  } catch (error) {
    console.error('获取假期类型失败:', error)
    res.status(500).json({ success: false, message: '获取假期类型失败' })
  }
})

// 新增假期类型
router.post('/admin/types', requireAdmin, async (req, res) => {
  try {
    const { name, default_days, requires_balance_check, requires_attachment, description } = req.body
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: '假期名称不能为空' })
    }

    const code = `custom_${nanoid(8)}`
    const id = nanoid()
    const now = new Date().toISOString()
    const maxOrder = await db.prepare(`SELECT MAX(sort_order) as max_order FROM leave_type_configs`).get<{ max_order: number | null }>()
    const sortOrder = (maxOrder?.max_order ?? 0) + 1

    await db.prepare(`
      INSERT INTO leave_type_configs (id, code, name, requires_attachment, requires_balance_check, default_days, description, sort_order, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, ?)
    `).run(id, code, name.trim(), requires_attachment ? true : false, requires_balance_check !== false, Number(default_days ?? 0), description?.trim() || null, sortOrder, now)

    res.json({ success: true, message: '假期类型已添加' })
  } catch (error) {
    console.error('添加假期类型失败:', error)
    res.status(500).json({ success: false, message: '添加假期类型失败' })
  }
})

// 修改假期类型
router.put('/admin/types/:code', requireAdmin, async (req, res) => {
  try {
    const { code } = req.params
    const { name, default_days, requires_balance_check, requires_attachment, description } = req.body
    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: '假期名称不能为空' })
    }

    const existing = await db.prepare(`SELECT id FROM leave_type_configs WHERE code = ? AND is_active = true`).get(code)
    if (!existing) {
      return res.status(404).json({ success: false, message: '假期类型不存在' })
    }

    await db.prepare(`
      UPDATE leave_type_configs
      SET name = ?, default_days = ?, requires_balance_check = ?, requires_attachment = ?, description = ?
      WHERE code = ?
    `).run(name.trim(), Number(default_days ?? 0), requires_balance_check !== false, requires_attachment ? true : false, description?.trim() || null, code)

    res.json({ success: true, message: '假期类型已更新' })
  } catch (error) {
    console.error('修改假期类型失败:', error)
    res.status(500).json({ success: false, message: '修改假期类型失败' })
  }
})

// 删除假期类型（软删除，设 is_active=false）
router.delete('/admin/types/:code', requireAdmin, async (req, res) => {
  try {
    const { code } = req.params

    const pendingCount = await db.prepare(`
      SELECT COUNT(*) as count FROM leave_requests WHERE leave_type_code = ? AND status = 'pending'
    `).get<{ count: number }>(code)

    if (Number(pendingCount?.count) > 0) {
      return res.status(400).json({ success: false, message: '该假期类型存在待审批申请，无法删除' })
    }

    await db.prepare(`UPDATE leave_type_configs SET is_active = false WHERE code = ?`).run(code)
    res.json({ success: true, message: '假期类型已删除' })
  } catch (error) {
    console.error('删除假期类型失败:', error)
    res.status(500).json({ success: false, message: '删除假期类型失败' })
  }
})

// 获取所有申请（支持多条件筛选）
router.get('/admin/requests', requireAdmin, async (req, res) => {
  try {
    const { status, leaveTypeCode, userId, department, startDate, endDate, page = 1, pageSize = 20 } = req.query

    let sql = `SELECT lr.*, u.name as user_name, u.department as user_department,
               au.name as approver_real_name
               FROM leave_requests lr
               LEFT JOIN users u ON lr.user_id = u.id
               LEFT JOIN users au ON lr.approver_id = au.id
               WHERE 1=1`
    const params: any[] = []

    if (status) { sql += ` AND lr.status = ?`; params.push(status) }
    if (leaveTypeCode) { sql += ` AND lr.leave_type_code = ?`; params.push(leaveTypeCode) }
    if (userId) { sql += ` AND lr.user_id = ?`; params.push(userId) }
    if (department) { sql += ` AND lr.applicant_department = ?`; params.push(department) }
    if (startDate) { sql += ` AND lr.start_date >= ?`; params.push(startDate) }
    if (endDate) { sql += ` AND lr.end_date <= ?`; params.push(endDate) }

    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM')
    const countResult = await db.prepare(countSql).get<{ total: number }>(...params)

    const offset = (Number(page) - 1) * Number(pageSize)
    sql += ` ORDER BY lr.submitted_at DESC LIMIT ? OFFSET ?`
    params.push(Number(pageSize), offset)

    const list = await db.prepare(sql).all(...params)

    res.json({
      success: true,
      data: {
        list,
        total: Number(countResult?.total || 0),
        page: Number(page),
        pageSize: Number(pageSize),
      }
    })
  } catch (error) {
    console.error('管理员获取申请列表失败:', error)
    res.status(500).json({ success: false, message: '获取申请列表失败' })
  }
})

// 获取所有人余额总览
router.get('/admin/balances', requireAdmin, async (req, res) => {
  try {
    const { department, year: yearQuery } = req.query
    const year = Number(yearQuery) || new Date().getFullYear()

    // 获取所有活跃用户
    let userSql = `SELECT id, name, department FROM users WHERE status = 'active'`
    const userParams: any[] = []
    if (department) {
      userSql += ` AND department = ?`
      userParams.push(department)
    }
    userSql += ` ORDER BY name`

    const users = await db.prepare(userSql).all<{ id: string; name: string; department: string | null }>(...userParams)
    const types = await db.prepare(`SELECT code, name FROM leave_type_configs WHERE is_active = true ORDER BY sort_order`).all<{ code: string; name: string }>()

    const result = []
    for (const user of users) {
      const userBalances: Record<string, any> = { userId: user.id, userName: user.name, department: user.department }
      for (const type of types) {
        const balance = await db.prepare(`
          SELECT total_days, used_days, pending_days
          FROM leave_balances WHERE user_id = ? AND leave_type_code = ? AND year = ?
        `).get<{ total_days: number; used_days: number; pending_days: number }>(user.id, type.code, year)
        userBalances[type.code] = balance
          ? { total: balance.total_days, used: balance.used_days, pending: balance.pending_days, available: Math.max(0, balance.total_days - balance.used_days - balance.pending_days) }
          : null
      }
      result.push(userBalances)
    }

    res.json({ success: true, data: { users: result, types, year } })
  } catch (error) {
    console.error('获取余额总览失败:', error)
    res.status(500).json({ success: false, message: '获取余额总览失败' })
  }
})

// 手动调整余额（管理员）
router.put('/admin/balances/:targetUserId/:typeCode/:year', requireAdmin, async (req, res) => {
  try {
    const { targetUserId, typeCode, year } = req.params
    const { totalDays } = req.body

    if (typeof totalDays !== 'number' || totalDays < 0) {
      return res.status(400).json({ success: false, message: '总天数必须为非负数' })
    }

    const now = new Date().toISOString()
    const existing = await db.prepare(`
      SELECT id FROM leave_balances WHERE user_id = ? AND leave_type_code = ? AND year = ?
    `).get(targetUserId, typeCode, Number(year))

    if (existing) {
      await db.prepare(`
        UPDATE leave_balances SET total_days = ?, updated_at = ?
        WHERE user_id = ? AND leave_type_code = ? AND year = ?
      `).run(totalDays, now, targetUserId, typeCode, Number(year))
    } else {
      await db.prepare(`
        INSERT INTO leave_balances (id, user_id, leave_type_code, year, total_days, used_days, pending_days, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
      `).run(nanoid(), targetUserId, typeCode, Number(year), totalDays, now, now)
    }

    res.json({ success: true, message: '余额已调整' })
  } catch (error) {
    console.error('调整余额失败:', error)
    res.status(500).json({ success: false, message: '调整余额失败' })
  }
})

// 导出请假记录（CSV）
router.get('/admin/export', requireAdmin, async (req, res) => {
  try {
    const { status, leaveTypeCode, userId, department, startDate, endDate, year: yearQuery } = req.query
    const year = Number(yearQuery) || new Date().getFullYear()

    let sql = `SELECT lr.request_no, u.name as user_name, lr.applicant_department,
               lr.leave_type_name, lr.start_date, lr.start_half, lr.end_date, lr.end_half,
               lr.total_days, lr.reason, lr.status, lr.approver_name,
               lr.reject_reason, lr.submitted_at, lr.approved_at, lr.rejected_at
               FROM leave_requests lr
               LEFT JOIN users u ON lr.user_id = u.id
               WHERE EXTRACT(YEAR FROM lr.submitted_at::timestamp) = ?`
    const params: any[] = [year]

    if (status) { sql += ` AND lr.status = ?`; params.push(status) }
    if (leaveTypeCode) { sql += ` AND lr.leave_type_code = ?`; params.push(leaveTypeCode) }
    if (userId) { sql += ` AND lr.user_id = ?`; params.push(userId) }
    if (department) { sql += ` AND lr.applicant_department = ?`; params.push(department) }
    if (startDate) { sql += ` AND lr.start_date >= ?`; params.push(startDate) }
    if (endDate) { sql += ` AND lr.end_date <= ?`; params.push(endDate) }

    sql += ` ORDER BY lr.submitted_at DESC`

    const rows = await db.prepare(sql).all<Record<string, any>>(...params)

    const statusMap: Record<string, string> = { pending: '审批中', approved: '已批准', rejected: '已驳回', cancelled: '已撤销' }
    const halfMap: Record<string, string> = { morning: '上午', afternoon: '下午' }

    const headers = ['申请编号', '申请人', '部门', '假期类型', '开始日期', '开始时段', '结束日期', '结束时段', '天数', '事由', '状态', '审批人', '驳回理由', '提交时间', '审批时间']
    const csvRows = [headers.join(',')]
    for (const row of rows) {
      const line = [
        row.request_no, row.user_name, row.applicant_department || '',
        row.leave_type_name, row.start_date, halfMap[row.start_half] || row.start_half,
        row.end_date, halfMap[row.end_half] || row.end_half,
        row.total_days, `"${(row.reason || '').replace(/"/g, '""')}"`,
        statusMap[row.status] || row.status, row.approver_name || '',
        `"${(row.reject_reason || '').replace(/"/g, '""')}"`,
        row.submitted_at ? row.submitted_at.substring(0, 10) : '',
        row.approved_at ? row.approved_at.substring(0, 10) : ''
      ]
      csvRows.push(line.join(','))
    }

    const csv = csvRows.join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="leave_export_${year}.csv"`)
    res.write('\uFEFF') // BOM，Excel 中文兼容
    res.end(csv)
  } catch (error) {
    console.error('导出请假记录失败:', error)
    res.status(500).json({ success: false, message: '导出失败' })
  }
})

export default router
