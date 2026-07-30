import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import type { PoolClient } from 'pg'
import { db } from '../db/index.js'
import { requireAuth, requireAdmin, requireGeneralManager } from '../middleware/auth.js'
import { nanoid } from 'nanoid'
import {
  calculateLeaveDays,
  calculateLeaveDaysByYear,
  calculateAnnualLeaveEntitlement,
  type LeaveHalf,
  type LeaveYearAllocation,
} from '../services/leaveCalculator.js'
import { ensureDatedUploadDirectory, toStoredUploadPath } from '../utils/upload-date.js'
import { parsePagination } from '../utils/pagination.js'
import { validateLeavePeriod } from '../utils/leave.js'
import {
  hardDeleteLeaveDraftChain,
  LeaveDraftDeleteError,
} from '../services/leaveDraftCleanup.js'
import { enrichLeaveRequestsWithSchedule } from '../services/leaveSchedule.js'

const router = Router()

const MAX_LEAVE_BALANCE_DAYS = 999.5

class LeaveOperationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message)
    this.name = 'LeaveOperationError'
  }
}

interface BalanceRequestData {
  user_id: string
  leave_type_code: string
  total_days: number
  start_date: string
  start_half: LeaveHalf
  end_date: string
  end_half: LeaveHalf
  balance_allocations_json: string | null
  balance_reserved: boolean
}

function parseLeaveBalanceDays(value: unknown): number | null {
  const days = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(days) || days < 0 || days > MAX_LEAVE_BALANCE_DAYS || !Number.isInteger(days * 2)) {
    return null
  }
  return days
}

function getRoleDisplayName(role: string): string {
  const roleNames: Record<string, string> = {
    super_admin: '超级管理员',
    admin: '管理员',
    general_manager: '总经理',
    employee: '员工',
  }
  return roleNames[role] || role
}

function removeUploadedFiles(files: Express.Multer.File[]) {
  for (const file of files) {
    try {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path)
    } catch {
      // 清理临时文件失败时不覆盖原始业务错误。
    }
  }
}

async function getStoredBalanceAllocations(request: BalanceRequestData): Promise<LeaveYearAllocation[]> {
  if (request.balance_allocations_json) {
    try {
      const parsed = JSON.parse(request.balance_allocations_json) as LeaveYearAllocation[]
      const isValid =
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every((item) => Number.isInteger(item.year) && Number.isFinite(item.days) && item.days > 0)
      const allocatedDays = isValid ? parsed.reduce((sum, item) => sum + item.days, 0) : 0
      if (isValid && Math.abs(allocatedDays - request.total_days) < 0.001) {
        return [...parsed].sort((a, b) => a.year - b.year)
      }
    } catch {
      // 兼容旧版无效分配数据，后续按请假日期重新计算。
    }
  }

  return await calculateLeaveDaysByYear(request.start_date, request.start_half, request.end_date, request.end_half)
}

async function ensureLeaveBalanceForUpdate(
  client: PoolClient,
  userId: string,
  leaveTypeCode: string,
  year: number
): Promise<{ total_days: number; used_days: number; pending_days: number }> {
  const existing = await client.query<{
    total_days: number
    used_days: number
    pending_days: number
  }>(
    `SELECT total_days, used_days, pending_days
     FROM leave_balances
     WHERE user_id = $1 AND leave_type_code = $2 AND year = $3
     FOR UPDATE`,
    [userId, leaveTypeCode, year]
  )
  const existingBalance = existing.rows[0]
  if (existingBalance) {
    if (leaveTypeCode === 'annual') {
      const annualSourceResult = await client.query<{
        hire_date: string | null
        default_days: number
      }>(
        `SELECT ep.hire_date, COALESCE(ltc.default_days, 0) AS default_days
         FROM leave_type_configs ltc
         LEFT JOIN employee_profiles ep
           ON ep.user_id = $1 AND ep.status = 'submitted'
         WHERE ltc.code = 'annual'
         LIMIT 1`,
        [userId]
      )
      const annualSource = annualSourceResult.rows[0]
      const calculatedTotal = calculateAnnualLeaveEntitlement(
        annualSource?.hire_date,
        year,
        Number(annualSource?.default_days ?? 0)
      )
      const committedDays = Number(existingBalance.used_days) + Number(existingBalance.pending_days)

      if (calculatedTotal > Number(existingBalance.total_days) && calculatedTotal >= committedDays) {
        const updated = await client.query<{
          total_days: number
          used_days: number
          pending_days: number
        }>(
          `UPDATE leave_balances
           SET total_days = $1, updated_at = $2
           WHERE user_id = $3 AND leave_type_code = 'annual' AND year = $4
           RETURNING total_days, used_days, pending_days`,
          [calculatedTotal, new Date().toISOString(), userId, year]
        )
        if (updated.rows[0]) return updated.rows[0]
      }
    }
    return existingBalance
  }

  let totalDays = 0
  if (leaveTypeCode === 'annual') {
    const annualSourceResult = await client.query<{
      hire_date: string | null
      default_days: number
    }>(
      `SELECT ep.hire_date, COALESCE(ltc.default_days, 0) AS default_days
       FROM leave_type_configs ltc
       LEFT JOIN employee_profiles ep
         ON ep.user_id = $1 AND ep.status = 'submitted'
       WHERE ltc.code = 'annual'
       LIMIT 1`,
      [userId]
    )
    const annualSource = annualSourceResult.rows[0]
    totalDays = calculateAnnualLeaveEntitlement(
      annualSource?.hire_date,
      year,
      Number(annualSource?.default_days ?? 0)
    )
  } else {
    const configResult = await client.query<{ default_days: number }>(
      `SELECT default_days FROM leave_type_configs WHERE code = $1`,
      [leaveTypeCode]
    )
    totalDays = Number(configResult.rows[0]?.default_days ?? 0)
  }

  const now = new Date().toISOString()
  await client.query(
    `INSERT INTO leave_balances (
       id, user_id, leave_type_code, year, total_days, used_days, pending_days, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,0,0,$6,$7)
     ON CONFLICT (user_id, leave_type_code, year) DO NOTHING`,
    [nanoid(), userId, leaveTypeCode, year, totalDays, now, now]
  )

  const locked = await client.query<{
    total_days: number
    used_days: number
    pending_days: number
  }>(
    `SELECT total_days, used_days, pending_days
     FROM leave_balances
     WHERE user_id = $1 AND leave_type_code = $2 AND year = $3
     FOR UPDATE`,
    [userId, leaveTypeCode, year]
  )

  if (!locked.rows[0]) throw new LeaveOperationError('假期余额初始化失败', 500)
  return locked.rows[0]
}

async function reserveLeaveBalances(
  client: PoolClient,
  userId: string,
  leaveTypeCode: string,
  leaveTypeName: string,
  allocations: LeaveYearAllocation[],
  now: string
) {
  for (const allocation of allocations) {
    const balance = await ensureLeaveBalanceForUpdate(client, userId, leaveTypeCode, allocation.year)
    const available = balance.total_days - balance.used_days - balance.pending_days
    if (available < allocation.days) {
      throw new LeaveOperationError(
        `${allocation.year} 年${leaveTypeName}余额不足，可用 ${available} 天，申请 ${allocation.days} 天`
      )
    }
  }

  for (const allocation of allocations) {
    await client.query(
      `UPDATE leave_balances
       SET pending_days = pending_days + $1, updated_at = $2
       WHERE user_id = $3 AND leave_type_code = $4 AND year = $5`,
      [allocation.days, now, userId, leaveTypeCode, allocation.year]
    )
  }
}

async function settleLeaveBalances(
  client: PoolClient,
  request: BalanceRequestData,
  allocations: LeaveYearAllocation[],
  action: 'approve' | 'release',
  now: string
) {
  if (!request.balance_reserved) return

  for (const allocation of allocations) {
    const result =
      action === 'approve'
        ? await client.query(
            `UPDATE leave_balances
           SET pending_days = pending_days - $1,
               used_days = used_days + $1,
               updated_at = $2
           WHERE user_id = $3 AND leave_type_code = $4 AND year = $5
             AND pending_days >= $1`,
            [allocation.days, now, request.user_id, request.leave_type_code, allocation.year]
          )
        : await client.query(
            `UPDATE leave_balances
           SET pending_days = pending_days - $1, updated_at = $2
           WHERE user_id = $3 AND leave_type_code = $4 AND year = $5
             AND pending_days >= $1`,
            [allocation.days, now, request.user_id, request.leave_type_code, allocation.year]
          )

    if ((result.rowCount ?? 0) !== 1) {
      throw new LeaveOperationError(`${allocation.year} 年假期余额记录不一致，请联系管理员`, 409)
    }
  }
}

// ==================== 文件上传配置 ====================

const uploadLeaveAttachment = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const requestId = req.params.id || 'temp'
      const destDir = ensureDatedUploadDirectory('leave-attachments', new Date(), requestId)
      cb(null, destDir)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname)
      cb(null, `${nanoid()}-${Date.now()}${ext}`)
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 JPG、PNG、PDF 格式的文件'))
    }
  },
})

// ==================== 工具函数 ====================

/**
 * 请假统一由总经理审批；申请人本人不能成为审批人。
 */
async function findApprover(applicantUserId: string): Promise<{ id: string; name: string } | null> {
  const approver = await db
    .prepare(
      `
    SELECT id, name FROM users
    WHERE role = 'general_manager'
      AND id != ?
      AND status = 'active'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `
    )
    .get<{ id: string; name: string }>(applicantUserId)

  return approver || null
}

async function assertNoOverlappingLeave(
  client: PoolClient,
  userId: string,
  startDate: string,
  startHalf: LeaveHalf,
  endDate: string,
  endHalf: LeaveHalf
) {
  // 同一员工的提交串行化，避免两个并发请求都通过重叠检查。
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`leave-overlap-${userId}`])

  const startSlot = startHalf === 'morning' ? 0 : 1
  const endSlot = endHalf === 'morning' ? 0 : 1
  const overlapResult = await client.query<{ request_no: string }>(
    `SELECT request_no
     FROM leave_requests
     WHERE user_id = $1
       AND status IN ('pending', 'approved')
       AND (
         start_date < $4
         OR (start_date = $4 AND CASE start_half WHEN 'morning' THEN 0 ELSE 1 END <= $5)
       )
       AND (
         end_date > $2
         OR (end_date = $2 AND CASE end_half WHEN 'morning' THEN 0 ELSE 1 END >= $3)
       )
     ORDER BY start_date ASC, request_no ASC
     LIMIT 1`,
    [userId, startDate, startSlot, endDate, endSlot]
  )
  if (overlapResult.rows[0]) {
    throw new LeaveOperationError(
      `请假时间与申请 ${overlapResult.rows[0].request_no} 重叠，请调整日期或先撤销原申请`,
      409
    )
  }
}

/**
 * 生成请假申请编号：LR-YYYY-NNNNN
 */
async function generateRequestNo(client: PoolClient): Promise<string> {
  const year = new Date().getFullYear()
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`leave-request-${year}`])
  const lastRequestResult = await client.query<{ request_no: string }>(
    `SELECT request_no FROM leave_requests
     WHERE request_no LIKE $1
     ORDER BY request_no DESC LIMIT 1`,
    [`LR-${year}-%`]
  )
  const lastReq = lastRequestResult.rows[0]

  let seq = 1
  if (lastReq?.request_no) {
    const match = lastReq.request_no.match(/LR-\d{4}-(\d+)/)
    if (match) seq = parseInt(match[1], 10) + 1
  }
  return `LR-${year}-${String(seq).padStart(5, '0')}`
}

/**
 * 获取或初始化用户当年假期余额
 * 年假先使用配置基础额度，再根据入职日期和工龄上调；其他类型使用默认值
 */
async function ensureLeaveBalance(
  userId: string,
  leaveTypeCode: string,
  year: number
): Promise<{ total_days: number; used_days: number; pending_days: number }> {
  const existing = await db
    .prepare(
      `
    SELECT total_days, used_days, pending_days
    FROM leave_balances
    WHERE user_id = ? AND leave_type_code = ? AND year = ?
  `
    )
    .get<{ total_days: number; used_days: number; pending_days: number }>(userId, leaveTypeCode, year)

  if (existing) {
    if (leaveTypeCode === 'annual') {
      const annualSource = await db
        .prepare(
          `
        SELECT ep.hire_date, COALESCE(ltc.default_days, 0) AS default_days
        FROM leave_type_configs ltc
        LEFT JOIN employee_profiles ep
          ON ep.user_id = ? AND ep.status = 'submitted'
        WHERE ltc.code = 'annual'
        LIMIT 1
      `
        )
        .get<{ hire_date: string | null; default_days: number }>(userId)
      const calculatedTotal = calculateAnnualLeaveEntitlement(
        annualSource?.hire_date,
        year,
        Number(annualSource?.default_days ?? 0)
      )
      const committedDays = Number(existing.used_days) + Number(existing.pending_days)

      if (calculatedTotal > Number(existing.total_days) && calculatedTotal >= committedDays) {
        await db
          .prepare(
            `
          UPDATE leave_balances
          SET total_days = ?, updated_at = ?
          WHERE user_id = ? AND leave_type_code = 'annual' AND year = ?
        `
          )
          .run(calculatedTotal, new Date().toISOString(), userId, year)
        return { ...existing, total_days: calculatedTotal }
      }
    }
    return existing
  }

  // 初始化余额
  let totalDays = 0
  const typeConfig = await db
    .prepare(
      `
    SELECT default_days FROM leave_type_configs WHERE code = ?
  `
    )
    .get<{ default_days: number }>(leaveTypeCode)

  if (leaveTypeCode === 'annual') {
    // 年假：先使用配置基础额度，再根据入职日期和工龄上调。
    const annualSource = await db
      .prepare(
        `
      SELECT ep.hire_date, COALESCE(ltc.default_days, 0) AS default_days
      FROM leave_type_configs ltc
      LEFT JOIN employee_profiles ep
        ON ep.user_id = ? AND ep.status = 'submitted'
      WHERE ltc.code = 'annual'
      LIMIT 1
    `
      )
      .get<{ hire_date: string | null; default_days: number }>(userId)
    totalDays = calculateAnnualLeaveEntitlement(
      annualSource?.hire_date,
      year,
      Number(annualSource?.default_days ?? typeConfig?.default_days ?? 0)
    )
  } else {
    totalDays = Number(typeConfig?.default_days ?? 0)
  }

  const id = nanoid()
  const now = new Date().toISOString()
  await db
    .prepare(
      `
    INSERT INTO leave_balances (id, user_id, leave_type_code, year, total_days, used_days, pending_days, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)
    ON CONFLICT (user_id, leave_type_code, year) DO NOTHING
  `
    )
    .run(id, userId, leaveTypeCode, year, totalDays, now, now)

  const initialized = await db
    .prepare(
      `
    SELECT total_days, used_days, pending_days
    FROM leave_balances
    WHERE user_id = ? AND leave_type_code = ? AND year = ?
  `
    )
    .get<{ total_days: number; used_days: number; pending_days: number }>(userId, leaveTypeCode, year)

  return initialized || { total_days: totalDays, used_days: 0, pending_days: 0 }
}

// ==================== 工具函数：根据性别获取需排除的假期类型 ====================

/**
 * 根据用户性别返回应排除的假期类型 code 列表
 * male（男）→ 排除产假 maternity
 * female（女）→ 排除陪产假 paternity
 * 其他/未知 → 不排除
 */
async function getGenderExcludedTypes(userId: string): Promise<string[]> {
  const profile = await db
    .prepare(
      `
    SELECT gender FROM employee_profiles WHERE user_id = ? AND status = 'submitted'
  `
    )
    .get<{ gender: string | null }>(userId)

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
      types = await db
        .prepare(
          `
        SELECT * FROM leave_type_configs
        WHERE is_active = true AND code NOT IN (${placeholders})
        ORDER BY sort_order
      `
        )
        .all(...excludedCodes)
    } else {
      types = await db
        .prepare(
          `
        SELECT * FROM leave_type_configs WHERE is_active = true ORDER BY sort_order
      `
        )
        .all()
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

    const periodError = validateLeavePeriod(startDate, startHalf, endDate, endHalf)
    if (periodError) return res.status(400).json({ success: false, message: periodError })

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
      types = await db
        .prepare(
          `
        SELECT code, name, requires_balance_check, default_days
        FROM leave_type_configs
        WHERE is_active = true AND code NOT IN (${placeholders})
        ORDER BY sort_order
      `
        )
        .all<{
          code: string
          name: string
          requires_balance_check: boolean
          default_days: number
        }>(...excludedCodes)
    } else {
      types = await db
        .prepare(
          `
        SELECT code, name, requires_balance_check, default_days
        FROM leave_type_configs WHERE is_active = true ORDER BY sort_order
      `
        )
        .all<{
          code: string
          name: string
          requires_balance_check: boolean
          default_days: number
        }>()
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
    const normalizedReason = String(reason || '').trim()

    // 基础校验
    const NO_REASON_TYPES = ['annual', 'marriage', 'bereavement', 'maternity', 'paternity']
    const requiresReason = !NO_REASON_TYPES.includes(leaveTypeCode)
    if (
      !leaveTypeCode ||
      !startDate ||
      !startHalf ||
      !endDate ||
      !endHalf ||
      (requiresReason && !normalizedReason)
    ) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: '请填写所有必填字段' })
    }
    if (normalizedReason.length > 500) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: '请假事由不能超过500个字符' })
    }

    const periodError = validateLeavePeriod(startDate, startHalf, endDate, endHalf)
    if (periodError) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: periodError })
    }

    // 获取假期类型配置
    const typeConfig = await db
      .prepare(
        `
      SELECT * FROM leave_type_configs WHERE code = ? AND is_active = true
    `
      )
      .get<{
        id: string
        code: string
        name: string
        requires_attachment: boolean
        requires_balance_check: boolean
      }>(leaveTypeCode)

    if (!typeConfig) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: '假期类型不存在' })
    }

    // 性别与假期类型匹配校验：产假仅限女性，陪产假仅限男性
    const excludedCodes = await getGenderExcludedTypes(userId)
    if (excludedCodes.includes(leaveTypeCode)) {
      removeUploadedFiles(uploadedFiles)
      const tipMap: Record<string, string> = {
        maternity: '产假仅适用于女性员工',
        paternity: '陪产假仅适用于男性员工',
      }
      return res.status(400).json({
        success: false,
        message: tipMap[leaveTypeCode] || '该假期类型不适用于您的性别',
      })
    }

    // 病假必须上传附件
    if (typeConfig.requires_attachment && uploadedFiles.length === 0) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({
        success: false,
        message: `${typeConfig.name}需要上传证明文件（病历或假条）`,
      })
    }

    // 服务端计算请假天数
    const totalDays = await calculateLeaveDays(startDate, startHalf, endDate, endHalf)
    if (totalDays <= 0) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({
        success: false,
        message: '请假时长不能为0（所选时间段全为休息日）',
      })
    }
    const allocations = await calculateLeaveDaysByYear(startDate, startHalf, endDate, endHalf)

    // 获取申请人信息
    const userInfo = await db
      .prepare(
        `
      SELECT name, department FROM users WHERE id = ?
    `
      )
      .get<{ name: string; department: string | null }>(userId)

    if (!userInfo) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: '用户信息不存在' })
    }

    // 查找审批人
    const approver = await findApprover(userId)
    if (!approver) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({
        success: false,
        message: '未找到可用的总经理审批人，请联系管理员配置总经理账号',
      })
    }

    const requestId = nanoid()
    let requestNo = ''
    const now = new Date().toISOString()

    // 使用事务保证原子性
    await db.transaction(async (client) => {
      await assertNoOverlappingLeave(client, userId, startDate, startHalf, endDate, endHalf)
      requestNo = await generateRequestNo(client)
      if (typeConfig.requires_balance_check) {
        await reserveLeaveBalances(client, userId, leaveTypeCode, typeConfig.name, allocations, now)
      }

      // 插入申请记录
      await client.query(
        `INSERT INTO leave_requests (
          id, request_no, user_id, applicant_name, applicant_department,
          leave_type_code, leave_type_name, start_date, start_half, end_date, end_half,
          total_days, balance_allocations_json, balance_reserved, reason, status, approver_id, approver_name,
          submitted_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',$16,$17,$18,$19,$20)`,
        [
          requestId,
          requestNo,
          userId,
          userInfo.name,
          userInfo.department,
          leaveTypeCode,
          typeConfig.name,
          startDate,
          startHalf,
          endDate,
          endHalf,
          totalDays,
          JSON.stringify(allocations),
          typeConfig.requires_balance_check,
          normalizedReason,
          approver.id,
          approver.name,
          now,
          now,
          now,
        ]
      )

      // 插入附件记录（需要先移动文件到正式目录）
      for (const file of uploadedFiles) {
        const uploadedAt = fs.statSync(file.path).mtime
        const newDir = ensureDatedUploadDirectory('leave-attachments', uploadedAt, requestId)
        const newPath = path.join(newDir, path.basename(file.path))
        if (file.path !== newPath) {
          fs.renameSync(file.path, newPath)
          file.path = newPath
        }

        const relativePath = toStoredUploadPath(newPath, true)
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
        await client.query(
          `INSERT INTO leave_attachments (id, leave_request_id, file_name, file_path, file_size, mime_type, uploaded_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [nanoid(), requestId, originalName, relativePath, file.size, file.mimetype, userId, now]
        )
      }

      // 写入审批日志
      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'submit',null,$5)`,
        [nanoid(), requestId, userId, userInfo.name, now]
      )
    })

    res.json({
      success: true,
      message: '请假申请已提交，等待审批',
      data: { id: requestId, requestNo },
    })
  } catch (error) {
    console.error('提交请假申请失败:', error)
    removeUploadedFiles(uploadedFiles)
    if (error instanceof LeaveOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '提交请假申请失败' })
  }
})

// 查询本人申请列表
router.get('/requests', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { status, leaveTypeCode, startDate, endDate } = req.query
    const pagination = parsePagination(req.query.page, req.query.pageSize)

    const conditions = [
      'lr.user_id = ?',
      `NOT EXISTS (
        SELECT 1 FROM leave_requests next_version
        WHERE next_version.original_id = lr.id
      )`,
    ]
    const params: any[] = [userId]

    if (status) {
      conditions.push('lr.status = ?')
      params.push(status)
    }
    if (leaveTypeCode) {
      conditions.push('lr.leave_type_code = ?')
      params.push(leaveTypeCode)
    }
    if (startDate) {
      conditions.push('lr.start_date >= ?')
      params.push(startDate)
    }
    if (endDate) {
      conditions.push('lr.end_date <= ?')
      params.push(endDate)
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`
    const countSql = `SELECT COUNT(*) as total FROM leave_requests lr ${whereSql}`
    const countResult = await db.prepare(countSql).get<{ total: number }>(...params)

    const { page, pageSize, offset } = pagination
    const listSql = `
      SELECT lr.*, u.name as user_name, au.name as approver_real_name,
             COALESCE(
               NULLIF(BTRIM(au.position), ''),
               NULLIF(BTRIM(aep.position), ''),
               CASE au.role
                 WHEN 'super_admin' THEN '超级管理员'
                 WHEN 'general_manager' THEN '总经理'
                 WHEN 'admin' THEN '管理员'
                 ELSE '员工'
               END
             ) as approver_position
      FROM leave_requests lr
      LEFT JOIN users u ON lr.user_id = u.id
      LEFT JOIN users au ON lr.approver_id = au.id
      LEFT JOIN employee_profiles aep ON aep.user_id = au.id
      ${whereSql}
      ORDER BY lr.submitted_at DESC, lr.created_at DESC, lr.request_no DESC
      LIMIT ? OFFSET ?
    `

    const list = await db.prepare(listSql).all(...params, pageSize, offset)

    res.json({
      success: true,
      data: {
        list,
        total: Number(countResult?.total || 0),
        page,
        pageSize,
      },
    })
  } catch (error) {
    console.error('获取请假申请列表失败:', error)
    res.status(500).json({ success: false, message: '获取请假申请列表失败' })
  }
})

// 员工确认已查看全部请假审批通过提醒
router.post('/requests/approved/mark-read', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    await db.run(
      `UPDATE leave_requests
       SET approval_notice_unread = FALSE
       WHERE user_id = ?
         AND status = 'approved'
         AND approval_notice_unread = TRUE`,
      userId
    )
    res.json({ success: true, message: '审批通过提醒已标记为已读' })
  } catch (error) {
    console.error('标记请假审批通过提醒失败:', error)
    res.status(500).json({ success: false, message: '标记审批通过提醒失败' })
  }
})

// 查看单条申请详情（含审批日志）
router.get('/requests/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { id } = req.params

    // 查申请链：无论传入哪个版本，都返回该申请的最新版本和完整历史。
    const userInfo = await db.prepare(`SELECT role, name FROM users WHERE id = ?`).get<{
      role: string
      name: string
    }>(userId)
    const isAdmin = userInfo?.role === 'admin' || userInfo?.role === 'super_admin'
    const canReviewAssigned = userInfo?.role === 'general_manager'

    const requestChain = await db.prepare(`
      WITH RECURSIVE ancestors AS (
        SELECT * FROM leave_requests WHERE id = ?
        UNION ALL
        SELECT parent.*
        FROM leave_requests parent
        INNER JOIN ancestors child ON child.original_id = parent.id
      ),
      root_request AS (
        SELECT * FROM ancestors WHERE original_id IS NULL LIMIT 1
      ),
      request_chain AS (
        SELECT * FROM root_request
        UNION ALL
        SELECT child.*
        FROM leave_requests child
        INNER JOIN request_chain parent ON child.original_id = parent.id
      )
      SELECT rc.*, au.name as approver_real_name,
             COALESCE(
               NULLIF(BTRIM(au.position), ''),
               NULLIF(BTRIM(aep.position), ''),
               CASE au.role
                 WHEN 'super_admin' THEN '超级管理员'
                 WHEN 'general_manager' THEN '总经理'
                 WHEN 'admin' THEN '管理员'
                 ELSE '员工'
               END
             ) as approver_position
      FROM request_chain rc
      LEFT JOIN users au ON rc.approver_id = au.id
      LEFT JOIN employee_profiles aep ON aep.user_id = au.id
      ORDER BY rc.version ASC, rc.created_at ASC
    `).all<Record<string, any>>(id)

    if (requestChain.length === 0) {
      return res.status(404).json({ success: false, message: '申请不存在或无权查看' })
    }

    const request = requestChain[requestChain.length - 1]
    const canView = isAdmin
      || request.user_id === userId
      || (canReviewAssigned && requestChain.some(item => item.approver_id === userId))
    if (!canView) {
      return res.status(404).json({ success: false, message: '申请不存在或无权查看' })
    }

    const chainIds = requestChain.map(item => item.id)
    const chainPlaceholders = chainIds.map(() => '?').join(', ')

    // 汇总所有版本的附件，避免重提后看不到旧版本材料。
    const attachments = await db
      .prepare(
        `
      SELECT la.id, la.leave_request_id, la.file_name, la.file_size, la.mime_type, la.created_at,
             lr.version, lr.request_no
      FROM leave_attachments la
      INNER JOIN leave_requests lr ON lr.id = la.leave_request_id
      WHERE la.leave_request_id IN (${chainPlaceholders})
      ORDER BY lr.version ASC, la.created_at ASC
    `
      )
      .all(...chainIds)

    // 汇总所有版本的审批日志，并返回操作人的职位和当前姓名。
    const logs = await db
      .prepare(
        `
      SELECT lal.*, lr.version, lr.request_no,
             COALESCE(u.name, lal.operator_name) as operator_real_name,
             COALESCE(
               NULLIF(BTRIM(u.position), ''),
               NULLIF(BTRIM(ep.position), ''),
               CASE u.role
                 WHEN 'super_admin' THEN '超级管理员'
                 WHEN 'general_manager' THEN '总经理'
                 WHEN 'admin' THEN '管理员'
                 ELSE '员工'
               END
             ) as operator_position
      FROM leave_approval_logs lal
      INNER JOIN leave_requests lr ON lr.id = lal.leave_request_id
      LEFT JOIN users u ON u.id = lal.operator_id
      LEFT JOIN employee_profiles ep ON ep.user_id = u.id
      WHERE lal.leave_request_id IN (${chainPlaceholders})
      ORDER BY lal.created_at ASC, lr.version ASC
    `
      )
      .all(...chainIds)

    res.json({
      success: true,
      data: {
        ...request,
        root_request_no: requestChain[0].request_no,
        version_count: requestChain.length,
        cc_recipient_role: isAdmin && userInfo ? getRoleDisplayName(userInfo.role) : null,
        cc_recipient_name: isAdmin ? userInfo?.name || null : null,
        attachments,
        logs,
      },
    })
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

    const attachment = await db
      .prepare(
        `
      SELECT la.*, lr.user_id, lr.approver_id
      FROM leave_attachments la
      JOIN leave_requests lr ON la.leave_request_id = lr.id
      WHERE la.id = ?
    `
      )
      .get<{
        file_name: string
        file_path: string
        mime_type: string
        leave_request_id: string
        user_id: string
        approver_id: string
      }>(attachmentId)

    if (!attachment) {
      return res.status(404).json({ success: false, message: '附件不存在' })
    }

    // 权限：本人、审批人或管理员
    const userInfo = await db.prepare(`SELECT role FROM users WHERE id = ?`).get<{ role: string }>(userId)
    const isAdmin = userInfo?.role === 'admin' || userInfo?.role === 'super_admin'
    const canReviewAssigned = userInfo?.role === 'general_manager'
    let isChainApprover = false
    if (canReviewAssigned) {
      const chainAssignment = await db.prepare(`
        WITH RECURSIVE ancestors AS (
          SELECT id, original_id, approver_id FROM leave_requests WHERE id = ?
          UNION ALL
          SELECT parent.id, parent.original_id, parent.approver_id
          FROM leave_requests parent
          INNER JOIN ancestors child ON child.original_id = parent.id
        ),
        root_request AS (
          SELECT id FROM ancestors WHERE original_id IS NULL LIMIT 1
        ),
        request_chain AS (
          SELECT lr.id, lr.original_id, lr.approver_id
          FROM leave_requests lr
          INNER JOIN root_request root ON root.id = lr.id
          UNION ALL
          SELECT child.id, child.original_id, child.approver_id
          FROM leave_requests child
          INNER JOIN request_chain parent ON child.original_id = parent.id
        )
        SELECT 1 as assigned FROM request_chain WHERE approver_id = ? LIMIT 1
      `).get<{ assigned: number }>(attachment.leave_request_id, userId)
      isChainApprover = Boolean(chainAssignment)
    }
    if (!isAdmin && attachment.user_id !== userId && !isChainApprover) {
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

// 撤回申请（仅 pending 状态，撤回后转为草稿）
router.post('/requests/:id/cancel', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params

    const now = new Date().toISOString()
    const userInfo = await db.prepare(`SELECT name FROM users WHERE id = ?`).get<{ name: string }>(userId)

    await db.transaction(async (client) => {
      const requestResult = await client.query<BalanceRequestData & { status: string }>(
        `SELECT lr.user_id, lr.leave_type_code, lr.total_days, lr.balance_allocations_json, lr.balance_reserved,
                lr.start_date, lr.start_half, lr.end_date, lr.end_half, lr.status
         FROM leave_requests lr
         WHERE lr.id = $1 AND lr.user_id = $2
         FOR UPDATE OF lr`,
        [id, userId]
      )
      const request = requestResult.rows[0]
      if (!request) throw new LeaveOperationError('申请不存在', 404)
      if (request.status !== 'pending') throw new LeaveOperationError('只能撤回审批中的申请', 409)

      const allocations = await getStoredBalanceAllocations(request)

      await client.query(
        `UPDATE leave_requests
         SET status = 'draft', balance_reserved = FALSE, cancelled_at = $1, updated_at = $2
         WHERE id = $3 AND status = 'pending'`,
        [now, now, id]
      )

      await settleLeaveBalances(client, request, allocations, 'release', now)

      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'cancel',null,$5)`,
        [nanoid(), id, userId, userInfo?.name || '', now]
      )
    })

    res.json({ success: true, message: '申请已撤回并保存为草稿' })
  } catch (error) {
    console.error('撤回申请失败:', error)
    if (error instanceof LeaveOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '撤回申请失败' })
  }
})

// 手动硬删除草稿及其完整历史链
router.delete('/requests/:id', requireAuth, async (req, res) => {
  try {
    const result = await hardDeleteLeaveDraftChain(req.params.id, req.session.userId!)
    res.json({
      success: true,
      message: '草稿已永久删除',
      data: {
        deletedRequestCount: result.deletedRequestCount,
        deletedAttachmentCount: result.deletedAttachmentCount,
      },
    })
  } catch (error) {
    console.error('删除请假草稿失败:', error)
    if (error instanceof LeaveDraftDeleteError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '删除请假草稿失败' })
  }
})

// 草稿重新提交时沿用当前记录；驳回后重新提交时创建新版本
router.post('/requests/:id/resubmit', requireAuth, uploadLeaveAttachment.array('attachments', 5), async (req, res) => {
  const uploadedFiles = (req.files as Express.Multer.File[]) || []
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const { startDate, startHalf, endDate, endHalf, reason } = req.body
    const normalizedReason = String(reason || '').trim()

    const originalRequest = await db
      .prepare(
        `
      SELECT * FROM leave_requests WHERE id = ? AND user_id = ?
    `
      )
      .get<{
        status: string
        version: number
        leave_type_code: string
        total_days: number
        request_no: string
      }>(id, userId)

    if (!originalRequest) {
      removeUploadedFiles(uploadedFiles)
      return res.status(404).json({ success: false, message: '申请不存在' })
    }
    if (!['draft', 'rejected'].includes(originalRequest.status)) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: '只有草稿或被驳回的申请才可重新提交' })
    }

    const periodError = validateLeavePeriod(startDate, startHalf, endDate, endHalf)
    if (periodError) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: periodError })
    }

    const leaveTypeCode = req.body.leaveTypeCode || originalRequest.leave_type_code
    const typeConfig = await db
      .prepare(
        `
      SELECT * FROM leave_type_configs WHERE code = ? AND is_active = true
    `
      )
      .get<{
        name: string
        requires_attachment: boolean
        requires_balance_check: boolean
      }>(leaveTypeCode)

    if (!typeConfig) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: '假期类型不存在' })
    }

    const noReasonTypes = ['annual', 'marriage', 'bereavement', 'maternity', 'paternity']
    if (!noReasonTypes.includes(leaveTypeCode) && !normalizedReason) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: '请填写请假事由' })
    }
    if (normalizedReason.length > 500) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: '请假事由不能超过500个字符' })
    }

    // 性别与假期类型匹配校验
    const excludedCodesResubmit = await getGenderExcludedTypes(userId)
    if (excludedCodesResubmit.includes(leaveTypeCode)) {
      removeUploadedFiles(uploadedFiles)
      const tipMap: Record<string, string> = {
        maternity: '产假仅适用于女性员工',
        paternity: '陪产假仅适用于男性员工',
      }
      return res.status(400).json({
        success: false,
        message: tipMap[leaveTypeCode] || '该假期类型不适用于您的性别',
      })
    }

    const existingAttachment = await db.prepare(
      `WITH RECURSIVE ancestors AS (
         SELECT id, original_id FROM leave_requests WHERE id = ?
         UNION ALL
         SELECT parent.id, parent.original_id
         FROM leave_requests parent
         INNER JOIN ancestors child ON child.original_id = parent.id
       )
       SELECT EXISTS(
         SELECT 1 FROM leave_attachments la
         INNER JOIN ancestors a ON a.id = la.leave_request_id
       ) AS has_attachment`
    ).get<{ has_attachment: boolean }>(id)

    if (typeConfig.requires_attachment && uploadedFiles.length === 0 && !existingAttachment?.has_attachment) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({
        success: false,
        message: `${typeConfig.name}需要上传证明文件`,
      })
    }

    const totalDays = await calculateLeaveDays(startDate, startHalf, endDate, endHalf)
    if (totalDays <= 0) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({ success: false, message: '请假时长不能为0' })
    }
    const allocations = await calculateLeaveDaysByYear(startDate, startHalf, endDate, endHalf)

    const userInfo = await db
      .prepare(`SELECT name, department FROM users WHERE id = ?`)
      .get<{ name: string; department: string | null }>(userId)
    const approver = await findApprover(userId)

    if (!approver) {
      removeUploadedFiles(uploadedFiles)
      return res.status(400).json({
        success: false,
        message: '未找到可用的总经理审批人，请联系管理员配置总经理账号',
      })
    }

    let resultRequestId = originalRequest.status === 'draft' ? id : nanoid()
    let resultRequestNo = originalRequest.status === 'draft' ? originalRequest.request_no : ''
    const now = new Date().toISOString()

    await db.transaction(async (client) => {
      const lockedRequestResult = await client.query<{
        status: string
        version: number
        request_no: string
      }>(
        `SELECT status, version, request_no
         FROM leave_requests
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [id, userId]
      )
      const lockedRequest = lockedRequestResult.rows[0]
      if (!lockedRequest) throw new LeaveOperationError('申请不存在', 404)
      if (!['draft', 'rejected'].includes(lockedRequest.status)) {
        throw new LeaveOperationError('该申请状态已变化，请刷新后重试', 409)
      }

      if (lockedRequest.status === 'rejected') {
        const existingVersion = await client.query(
          `SELECT id FROM leave_requests WHERE original_id = $1 LIMIT 1`,
          [id]
        )
        if (existingVersion.rows[0]) {
          throw new LeaveOperationError('该申请已重新提交，请勿重复操作', 409)
        }
      }

      await assertNoOverlappingLeave(client, userId, startDate, startHalf, endDate, endHalf)
      if (typeConfig.requires_balance_check) {
        await reserveLeaveBalances(client, userId, leaveTypeCode, typeConfig.name, allocations, now)
      }

      if (lockedRequest.status === 'draft') {
        resultRequestId = id
        resultRequestNo = lockedRequest.request_no
        await client.query(
          `UPDATE leave_requests
           SET applicant_name = $1, applicant_department = $2,
               leave_type_code = $3, leave_type_name = $4,
               start_date = $5, start_half = $6, end_date = $7, end_half = $8,
               total_days = $9, balance_allocations_json = $10, balance_reserved = $11,
               reason = $12, status = 'pending', approver_id = $13, approver_name = $14,
               reject_reason = NULL, approved_at = NULL, rejected_at = NULL, cancelled_at = NULL,
               submitted_at = $15, updated_at = $16
           WHERE id = $17 AND status = 'draft'`,
          [
            userInfo?.name || '',
            userInfo?.department || null,
            leaveTypeCode,
            typeConfig.name,
            startDate,
            startHalf,
            endDate,
            endHalf,
            totalDays,
            JSON.stringify(allocations),
            typeConfig.requires_balance_check,
            normalizedReason,
            approver.id,
            approver.name,
            now,
            now,
            id,
          ]
        )
      } else {
        resultRequestId = nanoid()
        resultRequestNo = await generateRequestNo(client)
        await client.query(
          `INSERT INTO leave_requests (
            id, request_no, user_id, applicant_name, applicant_department,
            leave_type_code, leave_type_name, start_date, start_half, end_date, end_half,
            total_days, balance_allocations_json, balance_reserved, reason, status, approver_id, approver_name,
            submitted_at, version, original_id, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',$16,$17,$18,$19,$20,$21,$22)`,
          [
            resultRequestId,
            resultRequestNo,
            userId,
            userInfo?.name || '',
            userInfo?.department || null,
            leaveTypeCode,
            typeConfig.name,
            startDate,
            startHalf,
            endDate,
            endHalf,
            totalDays,
            JSON.stringify(allocations),
            typeConfig.requires_balance_check,
            normalizedReason,
            approver.id,
            approver.name,
            now,
            lockedRequest.version + 1,
            id,
            now,
            now,
          ]
        )
      }

      for (const file of uploadedFiles) {
        const uploadedAt = fs.statSync(file.path).mtime
        const newDir = ensureDatedUploadDirectory('leave-attachments', uploadedAt, resultRequestId)
        const newPath = path.join(newDir, path.basename(file.path))
        if (file.path !== newPath) {
          fs.renameSync(file.path, newPath)
          file.path = newPath
        }
        const relativePath = toStoredUploadPath(newPath, true)
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
        await client.query(
          `INSERT INTO leave_attachments (id, leave_request_id, file_name, file_path, file_size, mime_type, uploaded_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [nanoid(), resultRequestId, originalName, relativePath, file.size, file.mimetype, userId, now]
        )
      }

      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'resubmit','重新提交',$5)`,
        [nanoid(), resultRequestId, userId, userInfo?.name || '', now]
      )
    })

    res.json({
      success: true,
      message: '已重新提交申请',
      data: { id: resultRequestId, requestNo: resultRequestNo },
    })
  } catch (error) {
    console.error('重新提交申请失败:', error)
    removeUploadedFiles(uploadedFiles)
    if (error instanceof LeaveOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '重新提交申请失败' })
  }
})

// ==================== 审批端接口 ====================

// 待我审批的申请列表
router.get('/pending', requireGeneralManager, async (req, res) => {
  try {
    const userId = req.session.userId!
    const list = await db
      .prepare(
        `
      SELECT lr.*, u.name as user_name, u.department as user_department
      FROM leave_requests lr
      LEFT JOIN users u ON lr.user_id = u.id
      WHERE lr.approver_id = ? AND lr.status = 'pending' AND lr.user_id <> ?
      ORDER BY lr.submitted_at ASC
    `
      )
      .all<BalanceRequestData & { status: string } & Record<string, any>>(userId, userId)
    const listWithSchedule = await enrichLeaveRequestsWithSchedule(list)
    res.json({ success: true, data: listWithSchedule })
  } catch (error) {
    console.error('获取待审批列表失败:', error)
    res.status(500).json({ success: false, message: '获取待审批列表失败' })
  }
})

// 当前审批人已处理的申请链，每条申请只展示当前最终版本。
router.get('/reviewed', requireGeneralManager, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { page, pageSize, offset } = parsePagination(req.query.page, req.query.pageSize)
    const countResult = await db.prepare(
      `SELECT COUNT(*) as total
       FROM leave_requests lr
       WHERE lr.status IN ('approved', 'rejected')
         AND EXISTS (
           SELECT 1
           FROM leave_approval_logs lal
           WHERE lal.leave_request_id = lr.id
             AND lal.operator_id = ?
             AND lal.action = CASE lr.status
               WHEN 'approved' THEN 'approve'
               WHEN 'rejected' THEN 'reject'
             END
         )
         AND NOT EXISTS (
           SELECT 1 FROM leave_requests next_version
           WHERE next_version.original_id = lr.id
         )`,
    ).get<{ total: number }>(userId)

    const list = await db.prepare(
      `SELECT lr.*, u.name as user_name, u.department as user_department,
              lal.action as review_action, lal.comment as review_comment,
              lal.created_at as reviewed_at
       FROM leave_requests lr
       INNER JOIN LATERAL (
         SELECT action, comment, created_at
         FROM leave_approval_logs
         WHERE leave_request_id = lr.id
           AND operator_id = ?
           AND action = CASE lr.status
             WHEN 'approved' THEN 'approve'
             WHEN 'rejected' THEN 'reject'
           END
         ORDER BY created_at DESC
         LIMIT 1
       ) lal ON TRUE
       LEFT JOIN users u ON lr.user_id = u.id
       WHERE lr.status IN ('approved', 'rejected')
         AND NOT EXISTS (
           SELECT 1 FROM leave_requests next_version
           WHERE next_version.original_id = lr.id
         )
       ORDER BY lal.created_at DESC
       LIMIT ? OFFSET ?`,
    ).all<BalanceRequestData & { status: string } & Record<string, any>>(userId, pageSize, offset)
    const listWithSchedule = await enrichLeaveRequestsWithSchedule(list)

    res.json({
      success: true,
      data: {
        list: listWithSchedule,
        total: Number(countResult?.total || 0),
        page,
        pageSize,
      },
    })
  } catch (error) {
    console.error('获取审批历史失败:', error)
    res.status(500).json({ success: false, message: '获取审批历史失败' })
  }
})

// 审批通过
router.post('/requests/:id/approve', requireGeneralManager, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const { comment } = req.body

    const userInfo = await db.prepare(`SELECT name FROM users WHERE id = ?`).get<{ name: string }>(userId)
    const now = new Date().toISOString()

    await db.transaction(async (client) => {
      const requestResult = await client.query<BalanceRequestData & { status: string }>(
        `SELECT lr.user_id, lr.leave_type_code, lr.total_days, lr.balance_allocations_json, lr.balance_reserved,
                lr.start_date, lr.start_half, lr.end_date, lr.end_half, lr.status
         FROM leave_requests lr
         WHERE lr.id = $1 AND lr.user_id <> $2 AND lr.approver_id = $2
         FOR UPDATE OF lr`,
        [id, userId]
      )
      const request = requestResult.rows[0]
      if (!request) throw new LeaveOperationError('申请不存在或无权操作', 404)
      if (request.status !== 'pending') throw new LeaveOperationError('该申请已经处理，请勿重复操作', 409)

      const allocations = await getStoredBalanceAllocations(request)

      await settleLeaveBalances(client, request, allocations, 'approve', now)

      await client.query(
        `UPDATE leave_requests
         SET status = 'approved', approved_at = $1, approval_notice_unread = TRUE, updated_at = $2
         WHERE id = $3 AND status = 'pending'`,
        [now, now, id]
      )

      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'approve',$5,$6)`,
        [nanoid(), id, userId, userInfo?.name || '', comment || null, now]
      )
    })

    res.json({ success: true, message: '已审批通过' })
  } catch (error) {
    console.error('审批通过失败:', error)
    if (error instanceof LeaveOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '审批操作失败' })
  }
})

// 驳回
router.post('/requests/:id/reject', requireGeneralManager, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const { rejectReason } = req.body

    if (!rejectReason || !rejectReason.trim()) {
      return res.status(400).json({ success: false, message: '驳回时必须填写驳回理由' })
    }

    const userInfo = await db.prepare(`SELECT name FROM users WHERE id = ?`).get<{ name: string }>(userId)
    const now = new Date().toISOString()

    await db.transaction(async (client) => {
      const requestResult = await client.query<BalanceRequestData & { status: string }>(
        `SELECT lr.user_id, lr.leave_type_code, lr.total_days, lr.balance_allocations_json, lr.balance_reserved,
                lr.start_date, lr.start_half, lr.end_date, lr.end_half, lr.status
         FROM leave_requests lr
         WHERE lr.id = $1 AND lr.user_id <> $2 AND lr.approver_id = $2
         FOR UPDATE OF lr`,
        [id, userId]
      )
      const request = requestResult.rows[0]
      if (!request) throw new LeaveOperationError('申请不存在或无权操作', 404)
      if (request.status !== 'pending') throw new LeaveOperationError('该申请已经处理，请勿重复操作', 409)

      const allocations = await getStoredBalanceAllocations(request)

      await settleLeaveBalances(client, request, allocations, 'release', now)

      await client.query(
        `UPDATE leave_requests
         SET status = 'rejected', reject_reason = $1, rejected_at = $2, updated_at = $3
         WHERE id = $4 AND status = 'pending'`,
        [rejectReason.trim(), now, now, id]
      )

      await client.query(
        `INSERT INTO leave_approval_logs (id, leave_request_id, operator_id, operator_name, action, comment, created_at)
         VALUES ($1,$2,$3,$4,'reject',$5,$6)`,
        [nanoid(), id, userId, userInfo?.name || '', rejectReason.trim(), now]
      )
    })

    res.json({ success: true, message: '已驳回申请' })
  } catch (error) {
    console.error('驳回申请失败:', error)
    if (error instanceof LeaveOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '驳回操作失败' })
  }
})

// ==================== 管理员接口 ====================

// 获取所有假期类型（管理员视图，仅活跃）
router.get('/admin/types', requireAdmin, async (req, res) => {
  try {
    const types = await db
      .prepare(
        `
      SELECT * FROM leave_type_configs WHERE is_active = true ORDER BY sort_order
    `
      )
      .all()
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
    const defaultDays = parseLeaveBalanceDays(default_days ?? 0)
    if (defaultDays === null) {
      return res.status(400).json({
        success: false,
        message: `默认天数必须是 0 到 ${MAX_LEAVE_BALANCE_DAYS} 之间的半天倍数`,
      })
    }

    const code = `custom_${nanoid(8)}`
    const id = nanoid()
    const now = new Date().toISOString()
    const maxOrder = await db
      .prepare(`SELECT MAX(sort_order) as max_order FROM leave_type_configs`)
      .get<{ max_order: number | null }>()
    const sortOrder = (maxOrder?.max_order ?? 0) + 1

    await db
      .prepare(
        `
      INSERT INTO leave_type_configs (id, code, name, requires_attachment, requires_balance_check, default_days, description, sort_order, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, ?)
    `
      )
      .run(
        id,
        code,
        name.trim(),
        requires_attachment ? true : false,
        requires_balance_check !== false,
        defaultDays,
        description?.trim() || null,
        sortOrder,
        now
      )

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
    const nextDefaultDays = parseLeaveBalanceDays(default_days ?? 0)
    if (nextDefaultDays === null) {
      return res.status(400).json({
        success: false,
        message: `默认天数必须是 0 到 ${MAX_LEAVE_BALANCE_DAYS} 之间的半天倍数`,
      })
    }

    const nextRequiresBalanceCheck = requires_balance_check !== false
    const nextRequiresAttachment = requires_attachment ? true : false
    const nextDescription = description?.trim() || null
    const now = new Date().toISOString()
    const currentYear = new Date().getFullYear()
    let syncedBalanceCount = 0

    await db.transaction(async (client) => {
      const existingResult = await client.query<{
        default_days: number | null
      }>(
        `SELECT default_days
         FROM leave_type_configs
         WHERE code = $1 AND is_active = true
         FOR UPDATE`,
        [code]
      )
      const existing = existingResult.rows[0]
      if (!existing) throw new LeaveOperationError('假期类型不存在', 404)
      const previousDefaultDays = Number(existing.default_days ?? 0)

      await client.query(
        `
        UPDATE leave_type_configs
        SET name = $1, default_days = $2, requires_balance_check = $3, requires_attachment = $4, description = $5
        WHERE code = $6
      `,
        [name.trim(), nextDefaultDays, nextRequiresBalanceCheck, nextRequiresAttachment, nextDescription, code]
      )

      if (nextRequiresBalanceCheck && previousDefaultDays !== nextDefaultDays) {
        const syncResult = await client.query(
          `
          UPDATE leave_balances
          SET total_days = $1, updated_at = $2
          WHERE leave_type_code = $3
            AND year = $4
            AND total_days = $5
            AND used_days + pending_days <= $1
        `,
          [nextDefaultDays, now, code, currentYear, previousDefaultDays]
        )
        syncedBalanceCount = syncResult.rowCount ?? 0
      }
    })

    res.json({
      success: true,
      message: '假期类型已更新',
      data: { syncedBalanceCount },
    })
  } catch (error) {
    console.error('修改假期类型失败:', error)
    if (error instanceof LeaveOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '修改假期类型失败' })
  }
})

// 删除假期类型（软删除，设 is_active=false）
router.delete('/admin/types/:code', requireAdmin, async (req, res) => {
  try {
    const { code } = req.params

    const pendingCount = await db
      .prepare(
        `
      SELECT COUNT(*) as count FROM leave_requests WHERE leave_type_code = ? AND status = 'pending'
    `
      )
      .get<{ count: number }>(code)

    if (Number(pendingCount?.count) > 0) {
      return res.status(400).json({
        success: false,
        message: '该假期类型存在待审批申请，无法删除',
      })
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
    const currentUser = req.session.user
    if (!currentUser) {
      return res.status(401).json({ success: false, message: '登录状态已失效，请重新登录' })
    }

    const { status, leaveTypeCode, userId, department, startDate, endDate } = req.query
    const pagination = parsePagination(req.query.page, req.query.pageSize)

    const conditions = [
      `NOT EXISTS (
        SELECT 1 FROM leave_requests next_version
        WHERE next_version.original_id = lr.id
      )`,
    ]
    const params: any[] = []

    if (status) {
      conditions.push('lr.status = ?')
      params.push(status)
    }
    if (leaveTypeCode) {
      conditions.push('lr.leave_type_code = ?')
      params.push(leaveTypeCode)
    }
    if (userId) {
      conditions.push('lr.user_id = ?')
      params.push(userId)
    }
    if (department) {
      conditions.push('lr.applicant_department = ?')
      params.push(department)
    }
    if (startDate) {
      conditions.push('lr.start_date >= ?')
      params.push(startDate)
    }
    if (endDate) {
      conditions.push('lr.end_date <= ?')
      params.push(endDate)
    }

    const whereSql = `WHERE ${conditions.join(' AND ')}`
    const countSql = `SELECT COUNT(*) as total FROM leave_requests lr ${whereSql}`
    const countResult = await db.prepare(countSql).get<{ total: number }>(...params)

    const { page, pageSize, offset } = pagination
    const listSql = `
      SELECT lr.*, u.name as user_name, u.department as user_department,
             au.name as approver_real_name,
             COALESCE(
               NULLIF(BTRIM(au.position), ''),
               NULLIF(BTRIM(aep.position), ''),
               CASE au.role
                 WHEN 'super_admin' THEN '超级管理员'
                 WHEN 'general_manager' THEN '总经理'
                 WHEN 'admin' THEN '管理员'
                 ELSE '员工'
               END
             ) as approver_position
      FROM leave_requests lr
      LEFT JOIN users u ON lr.user_id = u.id
      LEFT JOIN users au ON lr.approver_id = au.id
      LEFT JOIN employee_profiles aep ON aep.user_id = au.id
      ${whereSql}
      ORDER BY lr.submitted_at DESC
      LIMIT ? OFFSET ?
    `

    const list = await db.prepare(listSql).all<
      BalanceRequestData & { status: string } & Record<string, any>
    >(...params, pageSize, offset)
    const listWithSchedule = await enrichLeaveRequestsWithSchedule(list)
    const ccRecipientRole = getRoleDisplayName(currentUser.role)
    const ccRecipientName = currentUser.name

    res.json({
      success: true,
      data: {
        list: listWithSchedule.map(item => ({
          ...item,
          cc_recipient_role: ccRecipientRole,
          cc_recipient_name: ccRecipientName,
        })),
        total: Number(countResult?.total || 0),
        page,
        pageSize,
      },
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
    let userSql = `
      SELECT
        u.id,
        u.name,
        u.department,
        COALESCE(u.employee_no, ep.employee_no) AS employee_no
      FROM users u
      LEFT JOIN employee_profiles ep ON ep.user_id = u.id
      WHERE u.status = 'active'
        AND u.role <> 'boss'
    `
    const userParams: any[] = []
    if (department) {
      userSql += ` AND u.department = ?`
      userParams.push(department)
    }
    userSql += `
      ORDER BY
        NULLIF(REGEXP_REPLACE(COALESCE(u.employee_no, ep.employee_no, ''), '[^0-9]', '', 'g'), '')::int ASC NULLS LAST,
        COALESCE(u.employee_no, ep.employee_no) ASC NULLS LAST,
        u.name ASC
    `

    const users = await db.prepare(userSql).all<{
      id: string
      name: string
      department: string | null
      employee_no: string | null
    }>(...userParams)
    const types = await db
      .prepare(`SELECT code, name FROM leave_type_configs WHERE is_active = true ORDER BY sort_order`)
      .all<{ code: string; name: string }>()

    const result = []
    for (const user of users) {
      const excludedCodes = await getGenderExcludedTypes(user.id)
      const userBalances: Record<string, any> = {
        userId: user.id,
        userName: user.name,
        employeeNo: user.employee_no,
        department: user.department,
      }
      for (const type of types) {
        if (excludedCodes.includes(type.code)) {
          userBalances[type.code] = null
          continue
        }
        const balance = await ensureLeaveBalance(user.id, type.code, year)
        const totalDays = Number(balance.total_days)
        const usedDays = Number(balance.used_days)
        const pendingDays = Number(balance.pending_days)
        userBalances[type.code] = {
          total: totalDays,
          used: usedDays,
          pending: pendingDays,
          available: Math.max(0, totalDays - usedDays - pendingDays),
        }
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
    const parsedYear = Number(year)
    const nextTotalDays = parseLeaveBalanceDays(totalDays)

    if (nextTotalDays === null) {
      return res.status(400).json({
        success: false,
        message: `总天数必须是 0 到 ${MAX_LEAVE_BALANCE_DAYS} 之间的半天倍数`,
      })
    }
    if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
      return res.status(400).json({ success: false, message: '年份无效' })
    }

    const now = new Date().toISOString()
    await db.transaction(async (client) => {
      const targetResult = await client.query(
        `SELECT
           EXISTS(SELECT 1 FROM users WHERE id = $1) AS user_exists,
           EXISTS(SELECT 1 FROM leave_type_configs WHERE code = $2 AND is_active = true) AS type_exists`,
        [targetUserId, typeCode]
      )
      const target = targetResult.rows[0] as {
        user_exists: boolean
        type_exists: boolean
      }
      if (!target.user_exists) throw new LeaveOperationError('用户不存在', 404)
      if (!target.type_exists) throw new LeaveOperationError('假期类型不存在或已停用', 404)

      await client.query(
        `INSERT INTO leave_balances (
           id, user_id, leave_type_code, year, total_days, used_days, pending_days, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,0,0,$6,$7)
         ON CONFLICT (user_id, leave_type_code, year) DO NOTHING`,
        [nanoid(), targetUserId, typeCode, parsedYear, nextTotalDays, now, now]
      )

      const balanceResult = await client.query<{
        used_days: number
        pending_days: number
      }>(
        `SELECT used_days, pending_days
         FROM leave_balances
         WHERE user_id = $1 AND leave_type_code = $2 AND year = $3
         FOR UPDATE`,
        [targetUserId, typeCode, parsedYear]
      )
      const balance = balanceResult.rows[0]
      if (!balance) throw new LeaveOperationError('假期余额初始化失败', 500)

      const committedDays = Number(balance.used_days) + Number(balance.pending_days)
      if (nextTotalDays < committedDays) {
        throw new LeaveOperationError(`总天数不能低于已使用与审批中天数之和 ${committedDays} 天`, 409)
      }

      await client.query(
        `UPDATE leave_balances
         SET total_days = $1, updated_at = $2
         WHERE user_id = $3 AND leave_type_code = $4 AND year = $5`,
        [nextTotalDays, now, targetUserId, typeCode, parsedYear]
      )
    })

    res.json({ success: true, message: '余额已调整' })
  } catch (error) {
    console.error('调整余额失败:', error)
    if (error instanceof LeaveOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({ success: false, message: '调整余额失败' })
  }
})

// 导出请假记录（CSV）
router.get('/admin/export', requireAdmin, async (req, res) => {
  try {
    const currentUser = req.session.user
    if (!currentUser) {
      return res.status(401).json({ success: false, message: '登录状态已失效，请重新登录' })
    }

    const { status, leaveTypeCode, userId, department, startDate, endDate, year: yearQuery } = req.query
    const year = Number(yearQuery) || new Date().getFullYear()

    let sql = `SELECT lr.request_no, u.name as user_name, lr.applicant_department,
               lr.leave_type_name, lr.start_date, lr.start_half, lr.end_date, lr.end_half,
               lr.total_days, lr.reason, lr.status, lr.approver_name,
               lr.reject_reason, lr.submitted_at, lr.approved_at, lr.rejected_at
               FROM leave_requests lr
               LEFT JOIN users u ON lr.user_id = u.id
               WHERE EXTRACT(YEAR FROM lr.submitted_at::timestamp) = ?
               AND NOT EXISTS (
                 SELECT 1 FROM leave_requests next_version
                 WHERE next_version.original_id = lr.id
               )`
    const params: any[] = [year]

    if (status) {
      sql += ` AND lr.status = ?`
      params.push(status)
    }
    if (leaveTypeCode) {
      sql += ` AND lr.leave_type_code = ?`
      params.push(leaveTypeCode)
    }
    if (userId) {
      sql += ` AND lr.user_id = ?`
      params.push(userId)
    }
    if (department) {
      sql += ` AND lr.applicant_department = ?`
      params.push(department)
    }
    if (startDate) {
      sql += ` AND lr.start_date >= ?`
      params.push(startDate)
    }
    if (endDate) {
      sql += ` AND lr.end_date <= ?`
      params.push(endDate)
    }

    sql += ` ORDER BY lr.submitted_at DESC`

    const rows = await db.prepare(sql).all<Record<string, any>>(...params)

    const statusMap: Record<string, string> = {
      pending: '审批中',
      approved: '已批准',
      rejected: '已驳回',
      draft: '草稿',
      cancelled: '已撤销',
    }
    const halfMap: Record<string, string> = {
      morning: '上午',
      afternoon: '下午',
    }
    const ccRecipient = `${getRoleDisplayName(currentUser.role)} ${currentUser.name}`

    const headers = [
      '申请编号',
      '申请人',
      '部门',
      '假期类型',
      '开始日期',
      '开始时段',
      '结束日期',
      '结束时段',
      '天数',
      '事由',
      '状态',
      '审批人',
      '抄送对象',
      '驳回理由',
      '提交时间',
      '审批时间',
    ]
    const csvRows = [headers.join(',')]
    for (const row of rows) {
      const line = [
        row.request_no,
        row.user_name,
        row.applicant_department || '',
        row.leave_type_name,
        row.start_date,
        halfMap[row.start_half] || row.start_half,
        row.end_date,
        halfMap[row.end_half] || row.end_half,
        row.total_days,
        `"${(row.reason || '').replace(/"/g, '""')}"`,
        statusMap[row.status] || row.status,
        row.approver_name || '',
        ccRecipient,
        `"${(row.reject_reason || '').replace(/"/g, '""')}"`,
        row.submitted_at ? row.submitted_at.substring(0, 10) : '',
        row.approved_at ? row.approved_at.substring(0, 10) : '',
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
