/**
 * 审批路由
 * 处理工作日志、报销单等业务的审批流程
 */

import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth, requireAdmin, requireRole } from '../middleware/auth.js'
import { validateFilePath } from '../utils/file-validation.js'
import type { ApprovalInstance, ApprovalRecord } from '../types/database.js'
import type { PoolClient } from 'pg'

const router = Router()

// 事务辅助函数
function convertTxPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}
async function txGet<T = any>(client: PoolClient, sql: string, ...params: any[]): Promise<T | undefined> {
  const result = await client.query(convertTxPlaceholders(sql), params)
  return result.rows[0] as T | undefined
}
async function txRun(client: PoolClient, sql: string, ...params: any[]): Promise<void> {
  await client.query(convertTxPlaceholders(sql), params)
}

// 格式化时间为中国时间，格式：YYYY-MM-DD HH:mm
// 不依赖 Intl，避免 Alpine 容器 small-icu 导致乱码
function formatDateTime(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  // UTC 时间加 8 小时得到中国时间
  const cnTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const y = cnTime.getUTCFullYear()
  const m = String(cnTime.getUTCMonth() + 1).padStart(2, '0')
  const d = String(cnTime.getUTCDate()).padStart(2, '0')
  const h = String(cnTime.getUTCHours()).padStart(2, '0')
  const min = String(cnTime.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}`
}

// 标准化报销事由标题格式：统一为 YYYY年MM月-基础报销/大额报销/商务报销
function normalizeReimbursementTitle(title: string): string {
  const match = title.match(/^(\d{4}年\d{2}月).*?-(基础报销|大额报销|商务报销)$/)
  if (match) {
    return `${match[1]}-${match[2]}`
  }
  return title
}

// 格式化发票分类：去重并用顿号分隔
function formatInvoiceCategories(categories: string | null): string {
  if (!categories) return ''
  const unique = [...new Set(categories.split(','))]
  return unique.join('、')
}

// 获取审批统计数据
router.get('/statistics', requireAdmin, async (req, res) => {
  try {
    const userRole = req.session?.user?.role

    // 获取当月的开始和结束时间（使用北京时间 UTC+8）
    const now = new Date()
    // 转换为北京时间
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const year = beijingTime.getUTCFullYear()
    const month = beijingTime.getUTCMonth()

    // 计算当月开始时间（北京时间 00:00:00）
    const monthStartBeijing = new Date(Date.UTC(year, month, 1, 0, 0, 0))
    const monthStart = new Date(monthStartBeijing.getTime() - 8 * 60 * 60 * 1000).toISOString()

    // 计算当月结束时间（北京时间 23:59:59）
    const monthEndBeijing = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59))
    const monthEnd = new Date(monthEndBeijing.getTime() - 8 * 60 * 60 * 1000).toISOString()

    // admin 统计基础和大额报销的全部流程 + 商务报销的待付款流程，super_admin 统计所有
    const typeFilter = userRole === 'admin'
      ? `AND (
          ai.type IN ('reimbursement_basic', 'reimbursement_large')
          OR (ai.type = 'reimbursement_business' AND r.status IN ('approved', 'payment_uploaded'))
        )`
      : ''

    // admin 对 reimbursements 表的类型过滤（不经过 approval_instances）
    const reimbursementTypeFilter = userRole === 'admin'
      ? `AND (
          r.type IN ('basic', 'large')
          OR (r.type = 'business' AND r.status IN ('approved', 'payment_uploaded'))
        )`
      : ''

    // 1. 待办数量（所有未完成的流程：待审批、待付款、付款中、待确认收款）
    const pendingApproval = await db.prepare(`
      SELECT COUNT(*) as count FROM approval_instances ai
      LEFT JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
      WHERE ai.status NOT IN ('rejected', 'withdrawn', 'cancelled')
      AND (ai.target_type != 'reimbursement' OR r.id IS NOT NULL)
      AND (ai.target_type != 'reimbursement' OR r.status != 'completed')
      ${typeFilter}
    `).get() as { count: number }

    // 2. 按报销类型统计当月数量和金额（排除草稿和驳回）
    const typeStats = await db.prepare(`
      SELECT
        r.type,
        COUNT(*) as count,
        COALESCE(SUM(r.total_amount), 0) as amount
      FROM reimbursements r
      WHERE r.created_at >= ? AND r.created_at <= ?
      AND r.status NOT IN ('draft', 'rejected')
      ${reimbursementTypeFilter}
      GROUP BY r.type
    `).all(monthStart, monthEnd) as Array<{ type: string; count: number; amount: number }>

    const typeStatsMap: Record<string, { count: number; amount: number }> = {}
    for (const stat of typeStats) {
      typeStatsMap[stat.type] = { count: stat.count, amount: stat.amount }
    }

    // 3. 已通过未付款数量
    const approvedUnpaid = await db.prepare(`
      SELECT COUNT(*) as count FROM reimbursements r
      WHERE r.status = 'approved'
      ${reimbursementTypeFilter}
    `).get() as { count: number }

    // 4. 本月已付款数量（包括待确认收款和已完成）
    const paidThisMonth = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(r.total_amount), 0) as amount FROM reimbursements r
      WHERE r.status IN ('payment_uploaded', 'completed')
      AND r.pay_time >= ? AND r.pay_time <= ?
      ${reimbursementTypeFilter}
    `).get(monthStart, monthEnd) as { count: number; amount: number }

    // 5. 本月已完成数量（员工已确认收款）
    const completedThisMonth = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(r.total_amount), 0) as amount FROM reimbursements r
      WHERE r.status = 'completed'
      AND r.completed_time >= ? AND r.completed_time <= ?
      ${reimbursementTypeFilter}
    `).get(monthStart, monthEnd) as { count: number; amount: number }

    res.json({
      success: true,
      data: {
        pendingCount: pendingApproval.count,
        approvedUnpaid: approvedUnpaid.count,
        paidThisMonth: paidThisMonth.count,
        paidThisMonthAmount: paidThisMonth.amount,
        completedThisMonth: completedThisMonth.count,
        completedThisMonthAmount: completedThisMonth.amount,
        currentMonth: `${now.getFullYear()}年${now.getMonth() + 1}月`,
        // 按类型统计当月数据
        basicStats: typeStatsMap['basic'] || { count: 0, amount: 0 },
        largeStats: typeStatsMap['large'] || { count: 0, amount: 0 },
        businessStats: typeStatsMap['business'] || { count: 0, amount: 0 },
      },
    })
  } catch (error) {
    console.error('获取审批统计失败:', error)
    res.status(500).json({
      success: false,
      message: '获取审批统计失败',
    })
  }
})

// 获取已通过未付款的报销单列表
router.get('/approved-unpaid', requireAdmin, async (req, res) => {
  try {
    const { userId, type, status, startDate, endDate } = req.query as Record<string, string>
    const conditions: string[] = []
    const params: any[] = []

    // 默认只查 approved，如果传了 status 则按传入的查（限制允许的状态值）
    const allowedStatuses = ['approved', 'payment_uploaded', 'completed']
    if (status) {
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `无效的状态筛选值，允许的值: ${allowedStatuses.join(', ')}`,
        })
      }
      conditions.push('r.status = ?')
      params.push(status)
    } else {
      conditions.push(`r.status = 'approved'`)
    }

    if (userId) {
      conditions.push('r.user_id = ?')
      params.push(userId)
    }
    if (type) {
      const types = (type as string).split(',')
      conditions.push(`r.type IN (${types.map(() => '?').join(',')})`)
      params.push(...types)
    }
    if (startDate) {
      conditions.push('r.approve_time >= ?')
      params.push(startDate + 'T00:00:00')
    }
    if (endDate) {
      conditions.push('r.approve_time <= ?')
      params.push(endDate + 'T23:59:59')
    }

    const reimbursements = await db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar,
        (SELECT STRING_AGG(DISTINCT ri.category, ',') FROM reimbursement_invoices ri WHERE ri.reimbursement_id = r.id AND ri.category IS NOT NULL) as invoice_categories
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.approve_time DESC
    `).all(...params) as Array<any>

    res.json({
      success: true,
      data: reimbursements.map(r => ({
        id: r.id,
        type: r.type,
        title: normalizeReimbursementTitle(r.title || ''),
        amount: r.total_amount,
        totalAmount: r.total_amount,
        deductionAmount: r.deduction_amount || 0,
        status: r.status,
        applicantName: r.applicant_name,
        applicantAvatar: r.applicant_avatar,
        approveTime: formatDateTime(r.approve_time),
        userId: r.user_id,
        reimbursementScope: r.reimbursement_scope,
        invoiceCategories: formatInvoiceCategories(r.invoice_categories),
      })),
    })
  } catch (error) {
    console.error('获取已通过未付款列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取已通过未付款列表失败',
    })
  }
})

// 获取本月已付款列表
router.get('/paid-this-month', requireAdmin, async (req, res) => {
  try {
    const { userId, type, status, startDate, endDate } = req.query as Record<string, string>

    const conditions = [`r.status IN ('payment_uploaded', 'completed')`]
    const params: any[] = []

    // 如果没有传日期参数，默认查当月
    if (!startDate && !endDate) {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
      conditions.push('r.pay_time >= ? AND r.pay_time <= ?')
      params.push(monthStart, monthEnd)
    } else {
      if (startDate) {
        conditions.push('r.pay_time >= ?')
        params.push(startDate + 'T00:00:00')
      }
      if (endDate) {
        conditions.push('r.pay_time <= ?')
        params.push(endDate + 'T23:59:59')
      }
    }

    if (userId) {
      conditions.push('r.user_id = ?')
      params.push(userId)
    }
    if (type) {
      const types = (type as string).split(',')
      conditions.push(`r.type IN (${types.map(() => '?').join(',')})`)
      params.push(...types)
    }
    if (status) {
      conditions.push('r.status = ?')
      params.push(status)
    }

    const reimbursements = await db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar,
        (SELECT STRING_AGG(DISTINCT ri.category, ',') FROM reimbursement_invoices ri WHERE ri.reimbursement_id = r.id AND ri.category IS NOT NULL) as invoice_categories
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY r.pay_time DESC
    `).all(...params) as Array<any>

    res.json({
      success: true,
      data: reimbursements.map(r => ({
        id: r.id,
        type: r.type,
        title: normalizeReimbursementTitle(r.title || ''),
        amount: r.total_amount,
        totalAmount: r.total_amount,
        deductionAmount: r.deduction_amount || 0,
        status: r.status,
        applicantName: r.applicant_name,
        applicantAvatar: r.applicant_avatar,
        approveTime: formatDateTime(r.approve_time),
        approver: r.approver,
        payTime: formatDateTime(r.pay_time),
        paymentUploadTime: formatDateTime(r.payment_upload_time),
        completedTime: formatDateTime(r.completed_time),
        paymentProofPath: r.payment_proof_path,
        receiptConfirmedBy: r.receipt_confirmed_by,
        userId: r.user_id,
        reimbursementScope: r.reimbursement_scope,
        invoiceCategories: formatInvoiceCategories(r.invoice_categories),
      })),
    })
  } catch (error) {
    console.error('获取本月已付款列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取本月已付款列表失败',
    })
  }
})

// 获取本月已完成列表（员工已确认收款）
router.get('/completed-this-month', requireAdmin, async (req, res) => {
  try {
    // 获取当月的开始和结束时间
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    const reimbursements = await db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.status = 'completed'
      AND r.completed_time >= ? AND r.completed_time <= ?
      ORDER BY r.completed_time DESC
    `).all(monthStart, monthEnd) as Array<any>

    res.json({
      success: true,
      data: reimbursements.map(r => ({
        id: r.id,
        type: r.type,
        title: normalizeReimbursementTitle(r.title || ''),
        amount: r.total_amount,
        totalAmount: r.total_amount,
        deductionAmount: r.deduction_amount || 0,
        status: r.status,
        applicantName: r.applicant_name,
        applicantAvatar: r.applicant_avatar,
        approveTime: formatDateTime(r.approve_time),
        approver: r.approver,
        payTime: formatDateTime(r.pay_time),
        paymentUploadTime: formatDateTime(r.payment_upload_time),
        completedTime: formatDateTime(r.completed_time),
        paymentProofPath: r.payment_proof_path,
        receiptConfirmedBy: r.receipt_confirmed_by,
        userId: r.user_id,
      })),
    })
  } catch (error) {
    console.error('获取本月已完成列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取本月已完成列表失败',
    })
  }
})

// 获取收款人信息（从入职信息 employee_profiles 表获取）
router.get('/payee-info/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params

    // 优先从 employee_profiles 表获取收款信息（入职时填写的信息）
    const profile = await db.prepare(`
      SELECT bank_account_name, bank_account_phone, bank_name, bank_account_number
      FROM employee_profiles WHERE user_id = ?
    `).get(userId) as { bank_account_name: string | null; bank_account_phone: string | null; bank_name: string | null; bank_account_number: string | null } | undefined

    if (profile && (profile.bank_account_name || profile.bank_account_number)) {
      // 如果入职信息中有收款信息，使用入职信息
      return res.json({
        success: true,
        data: {
          bankAccountName: profile.bank_account_name,
          bankAccountPhone: profile.bank_account_phone,
          bankName: profile.bank_name,
          bankAccountNumber: profile.bank_account_number,
        },
      })
    }

    // 如果入职信息中没有收款信息，回退到 users 表（兼容旧数据）
    const user = await db.prepare(`
      SELECT bank_account_name, bank_account_phone, bank_name, bank_account_number
      FROM users WHERE id = ?
    `).get(userId) as { bank_account_name: string | null; bank_account_phone: string | null; bank_name: string | null; bank_account_number: string | null } | undefined

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在',
      })
    }

    res.json({
      success: true,
      data: {
        bankAccountName: user.bank_account_name,
        bankAccountPhone: user.bank_account_phone,
        bankName: user.bank_name,
        bankAccountNumber: user.bank_account_number,
      },
    })
  } catch (error) {
    console.error('获取收款人信息失败:', error)
    res.status(500).json({
      success: false,
      message: '获取收款人信息失败',
    })
  }
})

// 根据目标ID和类型获取审批记录
router.get('/by-target', requireAuth, async (req, res) => {
  try {
    const { targetId, targetType } = req.query
    const userId = req.session.user?.id
    const userRole = req.session.user?.role

    if (!targetId || !targetType) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    if (!userId || !userRole) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    // 查询最新的审批实例
    const instance = await db.prepare(`
      SELECT * FROM approval_instances
      WHERE target_id = ? AND target_type = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(targetId, targetType) as ApprovalInstance | undefined

    if (!instance) {
      return res.json({
        success: true,
        data: {
          instance: null,
          records: [],
        },
      })
    }

    // 权限校验：只允许申请人、审批人、管理员或总经理（商务报销）查看
    const isApplicant = instance.applicant_id === userId
    const isAdmin = userRole === 'admin' || userRole === 'super_admin'
    const isGMForBusiness = userRole === 'general_manager' && instance.type === 'reimbursement_business'

    // 检查是否是审批人（查询该用户是否有该实例的审批记录）
    const approvalRecord = await db.prepare(`
      SELECT COUNT(*) as count FROM approval_records
      WHERE instance_id = ? AND approver_id = ?
    `).get(instance.id, userId) as { count: number }
    const isApprover = approvalRecord.count > 0

    console.log('[by-target] 权限检查 - userId:', userId, 'userRole:', userRole, 'instance.type:', instance.type)
    console.log('[by-target] isApplicant:', isApplicant, 'isAdmin:', isAdmin, 'isGMForBusiness:', isGMForBusiness, 'isApprover:', isApprover)

    if (!isApplicant && !isApprover && !isAdmin && !isGMForBusiness) {
      return res.status(403).json({
        success: false,
        message: '无权查看该审批记录',
      })
    }

    // 获取所有历史审批记录（包括所有审批实例的记录，不仅限于当前实例）
    const records = await db.prepare(`
      SELECT
        ar.*,
        u.name as approver_name,
        u.avatar_url as approver_avatar
      FROM approval_records ar
      LEFT JOIN approval_instances ai ON ar.instance_id = ai.id
      LEFT JOIN users u ON ar.approver_id = u.id
      WHERE ai.target_id = ? AND ai.target_type = ?
      ORDER BY ar.action_time ASC
    `).all(targetId, targetType) as Array<ApprovalRecord & { approver_name: string; approver_avatar: string | null }>

    console.log('[by-target] 查询到的审批记录数量:', records.length)
    console.log('[by-target] 审批记录详情:', records.map(r => ({ action: r.action, approver: r.approver_name, comment: r.comment })))

    // 获取报销单最新状态（用于前端实时展示）
    const reimbursement = await db.prepare(`
      SELECT status, description, payment_proof_path, pay_time, payment_upload_time, completed_time, receipt_confirmed_by
      FROM reimbursements WHERE id = ?
    `).get(targetId) as { status: string; description: string | null; payment_proof_path: string | null; pay_time: string | null; payment_upload_time: string | null; completed_time: string | null; receipt_confirmed_by: string | null } | undefined

    // 查询管理员和总经理的名字（用于审批流程显示）
    const adminUser = await db.prepare(`
      SELECT name FROM users WHERE role IN ('admin', 'super_admin') AND status = 'active' ORDER BY role ASC LIMIT 1
    `).get() as { name: string } | undefined
    const gmUser = await db.prepare(`
      SELECT name FROM users WHERE role = 'general_manager' AND status = 'active' LIMIT 1
    `).get() as { name: string } | undefined

    res.json({
      success: true,
      data: {
        instance: {
          id: instance.id,
          status: instance.status,
          submitTime: formatDateTime(instance.submit_time),
          completeTime: formatDateTime(instance.complete_time),
        },
        records: records.map(record => ({
          id: record.id,
          step: record.step,
          approverId: record.approver_id,
          approverName: record.approver_name,
          approverAvatar: record.approver_avatar,
          action: record.action,
          comment: record.comment,
          actionTime: formatDateTime(record.action_time),
        })),
        reimbursementStatus: reimbursement?.status,
        reimbursementDescription: reimbursement?.description,
        paymentProofPath: reimbursement?.payment_proof_path,
        payTime: reimbursement?.pay_time ? formatDateTime(reimbursement.pay_time) : null,
        paymentUploadTime: reimbursement?.payment_upload_time ? formatDateTime(reimbursement.payment_upload_time) : null,
        completedTime: reimbursement?.completed_time ? formatDateTime(reimbursement.completed_time) : null,
        receiptConfirmedBy: reimbursement?.receipt_confirmed_by,
        adminApproverName: adminUser?.name || null,
        gmApproverName: gmUser?.name || null,
      },
    })
  } catch (error) {
    console.error('获取审批记录失败:', error)
    res.status(500).json({
      success: false,
      message: '获取审批记录失败',
    })
  }
})

// 获取待我审批的列表
router.get('/pending', requireAdmin, async (req, res) => {
  try {
    const userRole = req.session?.user?.role

    // 待办列表包含除已完成(completed)外的所有状态：
    // pending(待审批)、approved(待付款)、payment_uploaded(待确认收款)
    // admin 不审批商务报销，super_admin 可以审批所有
    // 排序：待审批 → 待支付 → 待确认，同状态按提交时间倒序

    // 筛选参数
    const { userId, type, status, startDate, endDate } = req.query as {
      userId?: string
      type?: string       // 逗号分隔的类型列表，如 "basic,large"
      status?: string     // 单个状态值
      startDate?: string
      endDate?: string
    }

    const conditions: string[] = [
      `ai.status NOT IN ('rejected', 'withdrawn', 'cancelled')`,
      `(ai.target_type != 'reimbursement' OR r.id IS NOT NULL)`,
    ]
    const params: unknown[] = []

    // admin 只能审批基础和大额报销，但可以看到所有类型的待付款（包括商务报销）
    if (userRole === 'admin') {
      conditions.push(`(
        ai.target_type != 'reimbursement'
        OR r.type IN ('basic', 'large')
        OR (r.type = 'business' AND r.status IN ('approved', 'payment_uploaded'))
      )`)
    }

    // 类型筛选
    if (type) {
      const types = type.split(',').filter(Boolean)
      if (types.length > 0) {
        const placeholders = types.map(() => '?').join(',')
        conditions.push(`r.type IN (${placeholders})`)
        params.push(...types)
      }
    }

    // 状态筛选为 completed 时不排除已完成，否则默认排除
    if (status === 'completed') {
      conditions.push(`r.status = 'completed'`)
    } else {
      conditions.push(`(ai.target_type != 'reimbursement' OR r.status != 'completed')`)
      if (status === 'pending') {
        conditions.push(`ai.status = 'pending'`)
      } else if (status === 'approved') {
        conditions.push(`ai.status = 'approved' AND r.status = 'approved'`)
      } else if (status === 'payment_uploaded') {
        conditions.push(`r.status = 'payment_uploaded'`)
      }
    }

    // 员工筛选
    if (userId) {
      conditions.push(`ai.applicant_id = ?`)
      params.push(userId)
    }

    // 日期筛选（按提交时间）
    if (startDate) {
      conditions.push(`ai.submit_time >= ?`)
      params.push(startDate)
    }
    if (endDate) {
      conditions.push(`ai.submit_time <= ?`)
      params.push(endDate + 'T23:59:59.999Z')
    }

    const whereClause = conditions.join(' AND ')

    const instances = await db.prepare(`
      SELECT
        ai.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar,
        r.title as reimbursement_title,
        r.total_amount as reimbursement_amount,
        r.deduction_amount as reimbursement_deduction,
        r.status as reimbursement_status,
        r.user_id as reimbursement_user_id,
        r.type as reimbursement_type,
        r.reimbursement_scope as reimbursement_scope,
        (SELECT STRING_AGG(DISTINCT ri.category, ',') FROM reimbursement_invoices ri WHERE ri.reimbursement_id = r.id AND ri.category IS NOT NULL) as invoice_categories
      FROM approval_instances ai
      LEFT JOIN users u ON ai.applicant_id = u.id
      LEFT JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
      WHERE ${whereClause}
      ORDER BY
        CASE
          WHEN ai.status = 'pending' THEN 1
          WHEN ai.status = 'approved' AND r.status = 'approved' THEN 2
          WHEN r.status = 'payment_uploaded' THEN 3
          WHEN r.status = 'completed' THEN 4
          ELSE 5
        END,
        ai.submit_time ASC
    `).all(...params) as Array<ApprovalInstance & { applicant_name: string; applicant_avatar: string | null; reimbursement_title: string | null; reimbursement_amount: number | null; reimbursement_deduction: number | null; reimbursement_status: string | null; reimbursement_user_id: string | null; reimbursement_type: string | null; reimbursement_scope: string | null; invoice_categories: string | null }>

    res.json({
      success: true,
      data: instances.map(instance => ({
        id: instance.id,
        type: instance.type,
        targetId: instance.target_id,
        targetType: instance.target_type,
        applicantId: instance.applicant_id,
        applicantName: instance.applicant_name,
        applicantAvatar: instance.applicant_avatar,
        currentStep: instance.current_step,
        status: instance.status,
        reimbursementStatus: instance.reimbursement_status,
        submitTime: formatDateTime(instance.submit_time),
        createdAt: formatDateTime(instance.created_at),
        reimbursementInfo: instance.target_type === 'reimbursement' && instance.reimbursement_title ? {
          title: normalizeReimbursementTitle(instance.reimbursement_title),
          amount: (instance.reimbursement_amount || 0),
        } : null,
        reimbursementUserId: instance.reimbursement_user_id,
        reimbursementType: instance.reimbursement_type,
        reimbursementScope: instance.reimbursement_scope,
        invoiceCategories: formatInvoiceCategories(instance.invoice_categories),
      })),
    })
  } catch (error) {
    console.error('获取待审批列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取待审批列表失败',
    })
  }
})

// 获取我提交的审批
router.get('/my-submissions', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId

    const instances = await db.prepare(`
      SELECT * FROM approval_instances
      WHERE applicant_id = ?
      ORDER BY submit_time DESC
    `).all(userId) as ApprovalInstance[]

    res.json({
      success: true,
      data: instances.map(instance => ({
        id: instance.id,
        type: instance.type,
        targetId: instance.target_id,
        targetType: instance.target_type,
        currentStep: instance.current_step,
        status: instance.status,
        submitTime: formatDateTime(instance.submit_time),
        completeTime: formatDateTime(instance.complete_time),
        createdAt: formatDateTime(instance.created_at),
      })),
    })
  } catch (error) {
    console.error('获取我的审批列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取我的审批列表失败',
    })
  }
})

// 获取已处理的审批（管理员）
router.get('/processed', requireAdmin, async (req, res) => {
  try {
    const userId = req.session?.userId

    // 获取我处理过的审批实例ID
    const processedRecords = await db.prepare(`
      SELECT DISTINCT instance_id FROM approval_records
      WHERE approver_id = ?
    `).all(userId) as Array<{ instance_id: string }>

    if (processedRecords.length === 0) {
      return res.json({
        success: true,
        data: [],
      })
    }

    const instanceIds = processedRecords.map(r => r.instance_id)
    const placeholders = instanceIds.map(() => '?').join(',')

    const instances = await db.prepare(`
      SELECT
        ai.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar
      FROM approval_instances ai
      LEFT JOIN users u ON ai.applicant_id = u.id
      WHERE ai.id IN (${placeholders})
      ORDER BY ai.updated_at DESC
    `).all(...instanceIds) as Array<ApprovalInstance & { applicant_name: string; applicant_avatar: string | null }>

    res.json({
      success: true,
      data: instances.map(instance => ({
        id: instance.id,
        type: instance.type,
        targetId: instance.target_id,
        targetType: instance.target_type,
        applicantId: instance.applicant_id,
        applicantName: instance.applicant_name,
        applicantAvatar: instance.applicant_avatar,
        currentStep: instance.current_step,
        status: instance.status,
        submitTime: formatDateTime(instance.submit_time),
        completeTime: formatDateTime(instance.complete_time),
        createdAt: formatDateTime(instance.created_at),
      })),
    })
  } catch (error) {
    console.error('获取已处理审批列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取已处理审批列表失败',
    })
  }
})

// 获取所有员工列表（用于汇总查询下拉选择）
// 注意：此路由必须放在 /:id 路由之前，否则会被 /:id 路由拦截
router.get('/employees', requireRole(['super_admin', 'admin', 'general_manager']), async (req, res) => {
  try {
    // 排除系统管理员账号（super_admin 角色）
    const employees = await db.prepare(`
      SELECT id, name, username, department, position
      FROM users
      WHERE status = 'active'
      AND role != 'super_admin'
      ORDER BY name ASC
    `).all() as Array<{ id: string; name: string; username: string; department: string | null; position: string | null }>

    res.json({
      success: true,
      data: employees.map(e => ({
        id: e.id,
        name: e.name,
        username: e.username,
        department: e.department,
        position: e.position,
      })),
    })
  } catch (error) {
    console.error('获取员工列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取员工列表失败',
    })
  }
})

// 员工报销汇总查询
// 注意：此路由必须放在 /:id 路由之前，否则会被 /:id 路由拦截
router.get('/employee-summary', requireAdmin, async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query

    if (!userId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: '请选择员工和日期范围',
      })
    }

    // 获取员工信息
    const employee = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as { id: string; name: string } | undefined

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: '员工不存在',
      })
    }

    // 查询该员工在指定时间范围内的报销数据（管理员可以看到所有数据，包括已删除的）
    // 按类型分组统计
    const summaryByType = await db.prepare(`
      SELECT
        type,
        COUNT(*) as count,
        COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE user_id = ?
        AND created_at >= ?
        AND created_at <= ?
        AND status NOT IN ('draft', 'rejected')
      GROUP BY type
    `).all(userId, startDate, endDate + 'T23:59:59.999Z') as Array<{ type: string; count: number; amount: number }>

    // 查询明细列表
    const details = await db.prepare(`
      SELECT
        id, type, title, total_amount as amount, status,
        submit_time as submitTime, approve_time as approveTime,
        created_at as createTime, is_deleted as isDeleted
      FROM reimbursements
      WHERE user_id = ?
        AND created_at >= ?
        AND created_at <= ?
        AND status NOT IN ('draft', 'rejected')
      ORDER BY created_at DESC
    `).all(userId, startDate, endDate + 'T23:59:59.999Z') as Array<any>

    // 计算总金额
    const totalAmount = summaryByType.reduce((sum, item) => sum + item.amount, 0)
    const totalCount = summaryByType.reduce((sum, item) => sum + item.count, 0)

    // 类型映射
    const typeMap: Record<string, string> = {
      basic: '基础报销',
      large: '大额报销',
      business: '商务报销',
    }

    // 状态映射
    const statusMap: Record<string, string> = {
      pending: '待审批',
      approved: '已审批',
      payment_uploaded: '已付款',
      completed: '已完成',
    }

    res.json({
      success: true,
      data: {
        employee: {
          id: employee.id,
          name: employee.name,
        },
        dateRange: {
          startDate,
          endDate,
        },
        summary: {
          total: {
            count: totalCount,
            amount: totalAmount,
          },
          byType: summaryByType.map(item => ({
            type: item.type,
            typeName: typeMap[item.type] || item.type,
            count: item.count,
            amount: item.amount,
          })),
        },
        details: details.map(item => ({
          id: item.id,
          type: item.type,
          typeName: typeMap[item.type] || item.type,
          title: normalizeReimbursementTitle(item.title || ''),
          amount: item.amount,
          status: item.status,
          statusName: statusMap[item.status] || item.status,
          submitTime: formatDateTime(item.submitTime),
          approveTime: formatDateTime(item.approveTime),
          createTime: formatDateTime(item.createTime),
          isDeleted: item.isDeleted === true,
        })),
      },
    })
  } catch (error) {
    console.error('获取员工报销汇总失败:', error)
    res.status(500).json({
      success: false,
      message: '获取员工报销汇总失败',
    })
  }
})

// 获取全部报销记录（支持筛选）
router.get('/all-reimbursements', requireAdmin, async (req, res) => {
  try {
    const { status, type, userId, reimbursementScope, startDate, endDate } = req.query

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    // 默认只查询已付款状态（payment_uploaded, completed）
    if (status) {
      whereClause += ' AND r.status = ?'
      params.push(status)
    } else {
      // 未指定状态时，默认只返回已付款的记录
      whereClause += " AND r.status IN ('payment_uploaded', 'completed')"
    }

    // 类型支持多选（逗号分隔）
    if (type) {
      const types = String(type).split(',').filter(t => t.trim())
      if (types.length > 0) {
        whereClause += ` AND r.type IN (${types.map(() => '?').join(',')})`
        params.push(...types)
      }
    }

    if (userId) {
      whereClause += ' AND r.user_id = ?'
      params.push(userId)
    }

    // 所属区域支持多选（逗号分隔）
    if (reimbursementScope) {
      const scopes = String(reimbursementScope).split(',').filter(s => s.trim())
      if (scopes.length > 0) {
        whereClause += ` AND r.reimbursement_scope IN (${scopes.map(() => '?').join(',')})`
        params.push(...scopes)
      }
    }

    if (startDate) {
      const startDateObj = new Date(startDate + 'T00:00:00+08:00')
      const startISO = startDateObj.toISOString()
      whereClause += ' AND r.submit_time >= ?'
      params.push(startISO)
    }

    if (endDate) {
      const endDateObj = new Date(endDate + 'T23:59:59+08:00')
      const endISO = endDateObj.toISOString()
      whereClause += ' AND r.submit_time <= ?'
      params.push(endISO)
    }

    const reimbursements = await db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar,
        u.department as applicant_department,
        (SELECT STRING_AGG(DISTINCT ri.category, ',') FROM reimbursement_invoices ri WHERE ri.reimbursement_id = r.id AND ri.category IS NOT NULL) as invoice_categories
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      ${whereClause}
      ORDER BY r.created_at DESC
    `).all(...params) as Array<any>

    // 类型映射
    const typeMap: Record<string, string> = {
      basic: '基础报销',
      large: '大额报销',
      business: '商务报销',
    }

    // 状态映射
    const statusMap: Record<string, string> = {
      draft: '草稿',
      pending: '待审批',
      approved: '待付款',
      rejected: '已驳回',
      payment_uploaded: '待确认',
      completed: '已完成',
    }

    // 已付款状态：金额显示实际银行转账金额（与银行流水对应）
    const paidStatuses = ['payment_uploaded', 'completed']

    res.json({
      success: true,
      data: reimbursements.map(r => {
        const isPaid = paidStatuses.includes(r.status)
        // amount：已付款的显示实际转账金额，未付款的显示0
        const paidAmount = isPaid ? Math.max(0, r.total_amount) : 0

        return {
          id: r.id,
          type: r.type,
          typeName: typeMap[r.type] || r.type,
          title: normalizeReimbursementTitle(r.title || ''),
          amount: paidAmount,
          totalAmount: r.total_amount,
          deductionAmount: r.deduction_amount || 0,
          status: r.status,
          statusName: statusMap[r.status] || r.status,
          applicantName: r.applicant_name,
          applicantAvatar: r.applicant_avatar,
          applicantDepartment: r.applicant_department,
          submitTime: formatDateTime(r.submit_time),
          approveTime: formatDateTime(r.approve_time),
          approver: r.approver,
          rejectReason: r.reject_reason,
          payTime: formatDateTime(r.pay_time),
          paymentUploadTime: formatDateTime(r.payment_upload_time),
          completedTime: formatDateTime(r.completed_time),
          paymentProofPath: r.payment_proof_path,
          receiptConfirmedBy: r.receipt_confirmed_by,
          reimbursementMonth: r.reimbursement_month,
          reimbursementScope: r.reimbursement_scope,
          invoiceCategories: formatInvoiceCategories(r.invoice_categories),
          createdAt: formatDateTime(r.created_at),
          userId: r.user_id,
        }
      }),
    })
  } catch (error) {
    console.error('获取全部报销记录失败:', error)
    res.status(500).json({
      success: false,
      message: '获取全部报销记录失败',
    })
  }
})

// 导出本月报销数据（包含员工明细）
router.get('/export-monthly', requireAdmin, async (req, res) => {
  try {
    const { month } = req.query // 格式: YYYY-MM

    // 如果没有指定月份，使用当前月份
    const now = new Date()
    let targetMonth = month as string
    if (!targetMonth) {
      targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    }

    // 解析月份获取开始和结束日期
    const [year, monthNum] = targetMonth.split('-').map(Number)
    const monthStart = new Date(year, monthNum - 1, 1).toISOString()
    const monthEnd = new Date(year, monthNum, 0, 23, 59, 59).toISOString()

    // 获取该月所有已完成的报销记录（按员工分组）
    const reimbursements = await db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.department as applicant_department,
        u.position as applicant_position
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.status IN ('payment_uploaded', 'completed')
      AND r.pay_time >= ? AND r.pay_time <= ?
      ORDER BY u.name ASC, r.pay_time DESC
    `).all(monthStart, monthEnd) as Array<any>

    // 类型映射
    const typeMap: Record<string, string> = {
      basic: '基础报销',
      large: '大额报销',
      business: '商务报销',
    }

    // 状态映射
    const statusMap: Record<string, string> = {
      payment_uploaded: '待确认',
      completed: '已完成',
    }

    // 按员工分组统计
    const employeeSummary: Record<string, {
      name: string
      department: string | null
      position: string | null
      totalAmount: number
      count: number
      details: Array<any>
    }> = {}

    let grandTotal = 0

    for (const r of reimbursements) {
      const userId = r.user_id
      if (!employeeSummary[userId]) {
        employeeSummary[userId] = {
          name: r.applicant_name,
          department: r.applicant_department,
          position: r.applicant_position,
          totalAmount: 0,
          count: 0,
          details: [],
        }
      }

      employeeSummary[userId].totalAmount += r.total_amount
      employeeSummary[userId].count += 1
      grandTotal += r.total_amount

      employeeSummary[userId].details.push({
        id: r.id,
        type: r.type,
        typeName: typeMap[r.type] || r.type,
        title: normalizeReimbursementTitle(r.title || ''),
        amount: r.total_amount,  // total_amount 已经是扣除核减后的实际金额
        status: r.status,
        statusName: statusMap[r.status] || r.status,
        payTime: formatDateTime(r.pay_time),
        completedTime: formatDateTime(r.completed_time),
      })
    }

    // 转换为数组格式
    const employeeList = Object.entries(employeeSummary).map(([userId, data]) => ({
      userId,
      ...data,
    }))

    res.json({
      success: true,
      data: {
        month: targetMonth,
        monthDisplay: `${year}年${monthNum}月`,
        summary: {
          totalAmount: grandTotal,
          totalCount: reimbursements.length,
          employeeCount: employeeList.length,
        },
        employees: employeeList,
      },
    })
  } catch (error) {
    console.error('导出月度报销数据失败:', error)
    res.status(500).json({
      success: false,
      message: '导出月度报销数据失败',
    })
  }
})

// 核减金额查询（必须在 /:id 之前定义，否则会被通配路由拦截）
router.get('/deduction-query', requireAdmin, async (req, res) => {
  try {
    const { dateType, startDate, endDate, userId, month, year } = req.query as {
      dateType?: string
      startDate?: string
      endDate?: string
      userId?: string
      month?: string
      year?: string
    }

    // 兼容旧参数：如果没有提供 startDate / endDate，但有 month/year，则按原逻辑转换
    let finalStartDate = startDate
    let finalEndDate = endDate

    if (!finalStartDate || !finalEndDate) {
      if (dateType === 'month' && month) {
        const [y, m] = String(month).split('-')
        finalStartDate = `${y}-${m}-01`
        const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate()
        finalEndDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`
      } else if (dateType === 'year' && year) {
        finalStartDate = `${year}-01-01`
        finalEndDate = `${year}-12-31`
      }
    }

    if (!dateType || !finalStartDate || !finalEndDate) {
      return res.status(400).json({
        success: false,
        message: '请提供查询参数',
      })
    }

    const startDateStr: string = finalStartDate
    const endDateStr: string = finalEndDate
    let period: string

    // 生成 period 文本，用于前端显示
    const [startY, startM, startD] = startDateStr.split('-')
    const [endY, endM, endD] = endDateStr.split('-')

    if (dateType === 'year') {
      if (startY === endY) {
        period = `${startY}年`
      } else {
        period = `${startY}年 - ${endY}年`
      }
    } else if (dateType === 'month') {
      const startMonthText = `${startY}年${parseInt(startM, 10)}月`
      const endMonthText = `${endY}年${parseInt(endM, 10)}月`
      period = startMonthText === endMonthText ? startMonthText : `${startMonthText} - ${endMonthText}`
    } else {
      period = `${startDateStr} 至 ${endDateStr}`
    }

    // 查询核减记录：包含两种情况：
    // 1. 发票明细中有 deducted_amount > 0（运输类自动核减）
    // 2. 发票明细中有 is_deduction = 1（核减发票）
    let whereSql = `
      SELECT
        r.id,
        r.type,
        r.title,
        r.original_amount,
        r.total_amount,
        r.deduction_amount,
        r.deduction_reason,
        r.submit_time,
        r.user_id,
        u.name as user_name,
        u.department as user_department,
        COALESCE((SELECT SUM(i.deducted_amount) FROM reimbursement_invoices i WHERE i.reimbursement_id = r.id), 0)
          + COALESCE((SELECT SUM(i.amount) FROM reimbursement_invoices i WHERE i.reimbursement_id = r.id AND i.is_deduction = 1), 0)
        AS total_deduction_amount
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE (
        EXISTS (SELECT 1 FROM reimbursement_invoices i WHERE i.reimbursement_id = r.id AND i.deducted_amount > 0)
        OR EXISTS (SELECT 1 FROM reimbursement_invoices i WHERE i.reimbursement_id = r.id AND i.is_deduction = 1)
      )
        AND r.submit_time >= ?
        AND r.submit_time <= ?
        AND r.status = 'completed'
    `

    const params: any[] = [
      `${startDateStr}T00:00:00.000Z`,
      `${endDateStr}T23:59:59.999Z`,
    ]

    if (userId) {
      whereSql += ' AND r.user_id = ?'
      params.push(userId)
    }

    whereSql += ' ORDER BY u.name ASC, r.created_at DESC'

    const deductions = await db.prepare(whereSql).all(...params) as Array<any>

    // 类型映射
    const typeMap: Record<string, string> = {
      basic: '基础报销',
      large: '大额报销',
      business: '商务报销',
    }

    // 按员工分组统计
    const employeeMap: Record<string, {
      userId: string
      name: string
      department: string | null
      deductionAmount: number
      deductionCount: number
      details: Array<any>
    }> = {}

    let totalDeduction = 0
    let totalCount = 0

    for (const d of deductions) {
      const uid = d.user_id
      if (!employeeMap[uid]) {
        employeeMap[uid] = {
          userId: uid,
          name: d.user_name,
          department: d.user_department,
          deductionAmount: 0,
          deductionCount: 0,
          details: [],
        }
      }

      const deductionAmount = d.total_deduction_amount || 0
      employeeMap[uid].deductionAmount += deductionAmount
      employeeMap[uid].deductionCount += 1
      totalDeduction += deductionAmount
      totalCount += 1

      employeeMap[uid].details.push({
        id: d.id,
        type: d.type,
        typeName: typeMap[d.type] || d.type,
        title: normalizeReimbursementTitle(d.title || ''),
        originalAmount: d.original_amount || d.total_amount + deductionAmount,
        deductionAmount: deductionAmount,
        deductionReason: d.deduction_reason,
        submitTime: formatDateTime(d.submit_time),
      })
    }

    // 转换为数组并按核减金额降序排序
    const employees = Object.values(employeeMap).sort((a, b) => b.deductionAmount - a.deductionAmount)

    res.json({
      success: true,
      data: {
        period,
        totalDeduction,
        totalCount,
        employeeCount: employees.length,
        employees,
      },
    })
  } catch (error) {
    console.error('查询核减金额失败:', error)
    res.status(500).json({
      success: false,
      message: '查询核减金额失败',
    })
  }
})

// ==================== 总经理审批中心 API ====================

// 获取总经理审批统计数据
router.get('/gm-statistics', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id

    // 检查是否是总经理
    const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
    if (!user || user.role !== 'general_manager') {
      return res.status(403).json({
        success: false,
        message: '无权访问',
      })
    }

    // 获取当月的开始和结束时间
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    // 1. 待审批数量和金额（统计商务报销和转正申请）
    // 商务报销统计
    const pendingReimbursement = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(r.total_amount), 0) as amount
      FROM approval_instances ai
      INNER JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
      WHERE ai.status = 'pending'
      AND r.type = 'business'
    `).get() as { count: number; amount: number }

    // 转正申请统计
    const pendingProbation = await db.prepare(`
      SELECT COUNT(*) as count
      FROM probation_confirmations
      WHERE status = 'submitted'
    `).get() as { count: number }

    const pendingStats = {
      count: pendingReimbursement.count + pendingProbation.count,
      amount: pendingReimbursement.amount,
    }

    // 2. 本月已审批数量（包括通过和驳回的商务报销）
    const completedThisMonth = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(r.total_amount), 0) as amount
      FROM approval_instances ai
      INNER JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
      WHERE ai.status IN ('approved', 'rejected')
      AND r.type = 'business'
      AND ai.updated_at >= ? AND ai.updated_at <= ?
    `).get(monthStart, monthEnd) as { count: number; amount: number }

    // 3. 全部已完成商务报销数量和金额
    const completedAll = await db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
      FROM reimbursements
      WHERE type = 'business'
      AND status = 'completed'
    `).get() as { count: number; amount: number }

    res.json({
      success: true,
      data: {
        pendingCount: pendingStats.count,
        pendingAmount: pendingStats.amount,
        completedThisMonth: completedThisMonth.count,
        completedThisMonthAmount: completedThisMonth.amount,
        completedCount: completedAll.count,
        completedAmount: completedAll.amount,
        currentMonth: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      },
    })
  } catch (error) {
    console.error('获取总经理审批统计失败:', error)
    res.status(500).json({
      success: false,
      message: '获取统计数据失败',
    })
  }
})

// 获取总经理待审批列表（商务报销 + 转正申请）
router.get('/gm-pending', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id

    // 检查是否是总经理
    const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
    if (!user || user.role !== 'general_manager') {
      return res.status(403).json({
        success: false,
        message: '无权访问',
      })
    }

    // 查询待审批的商务报销
    const reimbursements = await db.prepare(`
      SELECT
        ai.id,
        ai.target_type,
        ai.target_id,
        ai.applicant_id,
        ai.current_step,
        ai.status,
        ai.submit_time,
        ai.created_at,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar,
        r.title as reimbursement_title,
        r.total_amount as reimbursement_amount,
        r.type as reimbursement_type,
        r.reimbursement_scope,
        r.client,
        r.service_target,
        r.status as reimbursement_status
      FROM approval_instances ai
      LEFT JOIN users u ON ai.applicant_id = u.id
      INNER JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
      WHERE ai.status = 'pending'
      AND r.type = 'business'
      ORDER BY ai.submit_time ASC
    `).all() as Array<{
      id: string
      target_type: string
      target_id: string
      applicant_id: string
      current_step: number
      status: string
      submit_time: string
      created_at: string
      applicant_name: string
      applicant_avatar: string | null
      reimbursement_title: string
      reimbursement_amount: number
      reimbursement_type: string
      reimbursement_scope: string | null
      client: string | null
      service_target: string | null
      reimbursement_status: string
    }>

    // 查询待审批的转正申请
    const probations = await db.prepare(`
      SELECT
        pc.id,
        pc.employee_id,
        pc.status,
        pc.submit_time,
        pc.created_at,
        e.name as employee_name,
        u.avatar_url as employee_avatar
      FROM probation_confirmations pc
      LEFT JOIN employee_profiles e ON pc.employee_id = e.id
      LEFT JOIN users u ON e.user_id = u.id
      WHERE pc.status = 'submitted'
      ORDER BY pc.submit_time ASC
    `).all() as Array<{
      id: string
      employee_id: string
      status: string
      submit_time: string
      created_at: string
      employee_name: string
      employee_avatar: string | null
    }>

    // 合并商务报销和转正申请
    const result = [
      ...reimbursements.map((item) => ({
        id: item.id,
        type: 'business',
        targetId: item.target_id,
        targetType: item.target_type,
        applicantId: item.applicant_id,
        applicantName: item.applicant_name,
        applicantAvatar: item.applicant_avatar,
        currentStep: item.current_step,
        status: item.status,
        submitTime: formatDateTime(item.submit_time),
        createdAt: formatDateTime(item.created_at),
        reimbursementInfo: {
          title: normalizeReimbursementTitle(item.reimbursement_title),
          amount: item.reimbursement_amount,
        },
        reimbursementType: item.reimbursement_type,
        reimbursementScope: item.reimbursement_scope,
        client: item.client,
        serviceTarget: item.service_target,
        reimbursementStatus: item.reimbursement_status,
      })),
      ...probations.map((item) => ({
        id: item.id,
        type: 'probation',
        targetId: item.id,
        targetType: 'probation',
        applicantId: item.employee_id,
        applicantName: item.employee_name,
        applicantAvatar: item.employee_avatar,
        currentStep: 1,
        status: item.status,
        submitTime: formatDateTime(item.submit_time),
        createdAt: formatDateTime(item.created_at),
        reimbursementInfo: null,
        reimbursementType: null,
        reimbursementScope: null,
        client: null,
        serviceTarget: null,
        reimbursementStatus: null,
      })),
    ]

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('获取总经理待审批列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取待审批列表失败',
    })
  }
})

// 获取总经理本月已审批列表（只显示商务报销）
router.get('/gm-completed', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id

    // 检查是否是总经理
    const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
    if (!user || user.role !== 'general_manager') {
      return res.status(403).json({
        success: false,
        message: '无权访问',
      })
    }

    // 获取当月的开始和结束时间
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    // 查询本月已审批的商务报销（用子查询取每张报销单最新的审批实例，避免重复）
    const reimbursements = await db.prepare(`
      SELECT
        r.id,
        r.type,
        r.title,
        r.total_amount,
        r.status,
        r.approve_time,
        r.approver,
        r.pay_time,
        r.completed_time,
        r.user_id,
        r.created_at as submit_time,
        r.payment_proof_path,
        r.payment_upload_time,
        r.reimbursement_scope,
        r.client,
        r.service_target,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      INNER JOIN (
        SELECT DISTINCT ON (target_id) id, target_id, status, updated_at
        FROM approval_instances
        WHERE target_type = 'reimbursement'
        ORDER BY target_id, updated_at DESC
      ) ai ON ai.target_id = r.id
      WHERE r.type = 'business'
      AND ai.status IN ('approved', 'rejected')
      AND ai.updated_at >= ? AND ai.updated_at <= ?
      ORDER BY ai.updated_at DESC
    `).all(monthStart, monthEnd) as Array<{
      id: string
      type: string
      title: string
      total_amount: number
      status: string
      approve_time: string | null
      approver: string | null
      pay_time: string | null
      completed_time: string | null
      user_id: string
      submit_time: string | null
      payment_proof_path: string | null
      payment_upload_time: string | null
      reimbursement_scope: string | null
      client: string | null
      service_target: string | null
      applicant_name: string
      applicant_avatar: string | null
    }>

    const result = reimbursements.map((item) => ({
      id: item.id,
      type: item.type,
      title: normalizeReimbursementTitle(item.title || ''),
      amount: item.total_amount,
      status: item.status,
      applicantName: item.applicant_name,
      applicantAvatar: item.applicant_avatar,
      approveTime: formatDateTime(item.approve_time),
      approver: item.approver,
      payTime: formatDateTime(item.pay_time),
      completedTime: formatDateTime(item.completed_time),
      submitTime: formatDateTime(item.submit_time),
      userId: item.user_id,
      paymentProofPath: item.payment_proof_path,
      paymentUploadTime: formatDateTime(item.payment_upload_time),
      reimbursementScope: item.reimbursement_scope,
      client: item.client,
      serviceTarget: item.service_target,
    }))

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('获取总经理已审批列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取已审批列表失败',
    })
  }
})

// 获取总经理全部查询列表（支持完整筛选条件，和管理员一致）
router.get('/gm-all', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const { status, type, userId: filterUserId, reimbursementScope, startDate, endDate } = req.query

    // 检查是否是总经理
    const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined
    if (!user || user.role !== 'general_manager') {
      return res.status(403).json({
        success: false,
        message: '无权访问',
      })
    }

    let whereClause = "WHERE 1=1"
    const params: any[] = []

    // 总经理只能查询商务报销
    whereClause += " AND r.type = 'business'"

    // 状态筛选
    if (status) {
      whereClause += ' AND r.status = ?'
      params.push(status)
    } else {
      // 未指定状态时，默认只返回已付款的记录
      whereClause += " AND r.status IN ('payment_uploaded', 'completed')"
    }

    // 员工筛选
    if (filterUserId) {
      whereClause += ' AND r.user_id = ?'
      params.push(filterUserId)
    }

    // 所属区域支持多选（逗号分隔）
    if (reimbursementScope) {
      const scopes = String(reimbursementScope).split(',').filter(s => s.trim())
      if (scopes.length > 0) {
        whereClause += ` AND r.reimbursement_scope IN (${scopes.map(() => '?').join(',')})`
        params.push(...scopes)
      }
    }

    // 日期范围筛选（使用提交时间，转换为北京时间进行比较）
    if (startDate) {
      // 将北京时间的日期转换为UTC时间范围的开始（2026-03-26 00:00 +08:00 = 2026-03-25 16:00 UTC）
      const startDateObj = new Date(startDate + 'T00:00:00+08:00')
      const startISO = startDateObj.toISOString()
      whereClause += ' AND r.submit_time >= ?'
      params.push(startISO)
      console.log('[GM-ALL] Date filter - startDate:', startDate, '-> UTC:', startISO)
    }

    if (endDate) {
      // 将北京时间的日期转换为UTC时间范围的结束（2026-03-26 23:59:59 +08:00 = 2026-03-26 15:59:59 UTC）
      const endDateObj = new Date(endDate + 'T23:59:59+08:00')
      const endISO = endDateObj.toISOString()
      whereClause += ' AND r.submit_time <= ?'
      params.push(endISO)
      console.log('[GM-ALL] Date filter - endDate:', endDate, '-> UTC:', endISO)
    }

    const reimbursements = await db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar,
        u.department as applicant_department,
        (SELECT STRING_AGG(DISTINCT ri.category, ',') FROM reimbursement_invoices ri WHERE ri.reimbursement_id = r.id AND ri.category IS NOT NULL) as invoice_categories
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      ${whereClause}
      ORDER BY r.created_at DESC
    `).all(...params) as Array<any>

    // 类型映射
    const typeMap: Record<string, string> = {
      basic: '基础报销',
      large: '大额报销',
      business: '商务报销',
    }

    // 状态映射
    const statusMap: Record<string, string> = {
      draft: '草稿',
      pending: '待审批',
      approved: '待付款',
      rejected: '已驳回',
      payment_uploaded: '待确认',
      completed: '已完成',
    }

    const result = reimbursements.map((item) => ({
      id: item.id,
      type: item.type,
      typeName: typeMap[item.type] || item.type,
      title: normalizeReimbursementTitle(item.title || ''),
      amount: item.total_amount,
      status: item.status,
      statusName: statusMap[item.status] || item.status,
      submitTime: formatDateTime(item.submit_time),
      applicantName: item.applicant_name,
      applicantAvatar: item.applicant_avatar,
      applicantDepartment: item.applicant_department,
      approveTime: formatDateTime(item.approve_time),
      approver: item.approver,
      payTime: formatDateTime(item.pay_time),
      completedTime: formatDateTime(item.completed_time),
      paymentUploadTime: formatDateTime(item.payment_upload_time),
      paymentProofPath: item.payment_proof_path,
      userId: item.user_id,
      reimbursementScope: item.reimbursement_scope,
      client: item.client,
      serviceTarget: item.service_target,
      createdAt: formatDateTime(item.created_at),
    }))

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('获取总经理全部查询列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取全部查询列表失败',
    })
  }
})

// ==================== 发票管理 API ====================

// 发票管理 - 查询发票列表
router.get('/invoice-management', requireAdmin, async (req, res) => {
  try {
    const { userId, type, fileType, reimbursementScope, startDate, endDate } = req.query

    let whereClause = 'WHERE r.status IN (\'payment_uploaded\', \'completed\')'
    const params: any[] = []

    // 员工筛选
    if (userId) {
      whereClause += ' AND r.user_id = ?'
      params.push(userId)
    }

    // 类型筛选（支持多选，逗号分隔）
    if (type) {
      const types = String(type).split(',').filter(t => t.trim())
      if (types.length > 0) {
        whereClause += ` AND r.type IN (${types.map(() => '?').join(',')})`
        params.push(...types)
      }
    }

    // 所属区域筛选（支持多选，逗号分隔）
    if (reimbursementScope) {
      const scopes = String(reimbursementScope).split(',').filter(s => s.trim())
      if (scopes.length > 0) {
        whereClause += ` AND r.reimbursement_scope IN (${scopes.map(() => '?').join(',')})`
        params.push(...scopes)
      }
    }

    // 文件类型筛选（receipt=收据, invoice=发票）
    if (fileType) {
      if (fileType === 'receipt') {
        whereClause += " AND LOWER(ri.file_path) LIKE '%receipt-%'"
      } else if (fileType === 'invoice') {
        whereClause += " AND LOWER(ri.file_path) NOT LIKE '%receipt-%'"
      }
    }

    // 日期范围筛选（按提交时间）
    if (startDate) {
      whereClause += ' AND r.submit_time >= ?'
      params.push(startDate)
    }

    if (endDate) {
      whereClause += ' AND r.submit_time <= ?'
      params.push(endDate + 'T23:59:59.999Z')
    }

    // 查询发票列表（包含核减发票）
    const invoices = await db.prepare(`
      SELECT
        ri.id,
        ri.reimbursement_id,
        ri.amount,
        ri.invoice_date,
        ri.invoice_number,
        ri.file_path,
        ri.category,
        ri.deducted_amount,
        ri.seller,
        ri.buyer,
        ri.is_deduction,
        ri.created_at,
        r.type as reimbursement_type,
        r.title as reimbursement_title,
        r.user_id,
        r.reimbursement_scope,
        r.status as reimbursement_status,
        r.submit_time,
        u.name as user_name,
        u.department as user_department
      FROM reimbursement_invoices ri
      INNER JOIN reimbursements r ON ri.reimbursement_id = r.id
      LEFT JOIN users u ON r.user_id = u.id
      ${whereClause}
      ORDER BY ri.invoice_date DESC, ri.created_at DESC
    `).all(...params) as Array<any>

    // 查询核减发票总金额（避免重复统计）
    // 只统计已付款状态的报销单的核减发票（is_deduction = 1）
    // 需要构建一个适用于子查询的WHERE子句（将 r. 替换为 r2.）
    const subWhereClause = whereClause.replace(/\br\./g, 'r2.')

    const deductionInvoicesTotal = await db.prepare(`
      SELECT COALESCE(SUM(ri.amount), 0) as total
      FROM reimbursement_invoices ri
      INNER JOIN reimbursements r ON ri.reimbursement_id = r.id
      LEFT JOIN users u ON r.user_id = u.id
      ${whereClause}
        AND ri.is_deduction = 1
    `).get(...params) as { total: number }

    // 类型映射
    const typeMap: Record<string, string> = {
      basic: '基础报销',
      large: '大额报销',
      business: '商务报销',
    }

    // 判断文件类型（发票 PDF 或收据图片）
    const getFileType = (filePath: string) => {
      const lowerPath = filePath.toLowerCase()
      if (lowerPath.includes('receipt-')) {
        return 'receipt' // 收据/无票
      }
      return 'invoice' // 发票
    }

    res.json({
      success: true,
      data: invoices.map(inv => ({
        id: inv.id,
        reimbursementId: inv.reimbursement_id,
        amount: inv.amount,
        invoiceDate: inv.invoice_date,
        invoiceNumber: inv.invoice_number,
        filePath: inv.file_path,
        fileType: getFileType(inv.file_path),
        category: inv.category,
        deductedAmount: inv.deducted_amount || 0,
        isDeduction: inv.is_deduction || 0,
        seller: inv.seller,
        buyer: inv.buyer,
        reimbursementType: inv.reimbursement_type,
        reimbursementTypeName: typeMap[inv.reimbursement_type] || inv.reimbursement_type,
        reimbursementTitle: normalizeReimbursementTitle(inv.reimbursement_title || ''),
        reimbursementScope: inv.reimbursement_scope,
        reimbursementStatus: inv.reimbursement_status,
        submitTime: formatDateTime(inv.submit_time),
        userId: inv.user_id,
        userName: inv.user_name,
        userDepartment: inv.user_department,
        createdAt: formatDateTime(inv.created_at),
      })),
      // 核减发票总金额（单独返回，前端不再使用，保留兼容性）
      deductionInvoicesTotal: deductionInvoicesTotal.total || 0,
    })
  } catch (error) {
    console.error('查询发票列表失败:', error)
    res.status(500).json({
      success: false,
      message: '查询发票列表失败',
    })
  }
})

// 发票管理 - 合并 PDF 用于打印（浏览器原生 PDF 查看器打印，预览彩色）
router.post('/invoice-management/merge-for-print', requireAdmin, async (req, res) => {
  try {
    const { filePaths } = req.body
    if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
      return res.status(400).json({ success: false, message: '请选择要打印的发票' })
    }

    // 校验所有文件路径安全性
    for (const filePath of filePaths) {
      if (!validateFilePath(filePath)) {
        return res.status(400).json({ success: false, message: '文件路径不合法' })
      }
    }

    const { PDFDocument } = await import('pdf-lib')
    const mergedPdf = await PDFDocument.create()

    for (const filePath of filePaths) {
      const fullPath = path.resolve(process.cwd(), filePath)
      if (!fs.existsSync(fullPath)) continue
      try {
        const pdfBytes = fs.readFileSync(fullPath)
        const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
        pages.forEach(page => mergedPdf.addPage(page))
      } catch (err) {
        console.warn(`合并 PDF 失败，跳过: ${filePath}`, err)
      }
    }

    const mergedBytes = await mergedPdf.save()
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="invoices-print.pdf"')
    res.send(Buffer.from(mergedBytes))
  } catch (error) {
    console.error('合并 PDF 失败:', error)
    res.status(500).json({ success: false, message: '合并 PDF 失败' })
  }
})

// 发票管理 - 批量下载发票（ZIP打包）
router.post('/invoice-management/batch-download', requireAdmin, async (req, res) => {
  try {
    const { invoiceIds } = req.body

    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '请选择要下载的发票',
      })
    }

    // 查询发票信息
    const placeholders = invoiceIds.map(() => '?').join(',')
    const invoices = await db.prepare(`
      SELECT
        ri.id,
        ri.file_path,
        ri.invoice_number,
        ri.invoice_date,
        ri.reimbursement_id,
        r.type as reimbursement_type,
        u.name as user_name
      FROM reimbursement_invoices ri
      INNER JOIN reimbursements r ON ri.reimbursement_id = r.id
      LEFT JOIN users u ON r.user_id = u.id
      WHERE ri.id IN (${placeholders})
    `).all(...invoiceIds) as Array<any>

    if (invoices.length === 0) {
      return res.status(404).json({
        success: false,
        message: '未找到发票',
      })
    }

    // 动态导入 archiver
    const archiver = (await import('archiver')).default
    const path = (await import('path')).default
    const fs = (await import('fs')).default

    // 设置响应头
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="invoices_${timestamp}.zip"`)

    // 创建 ZIP 归档
    const archive = archiver('zip', {
      zlib: { level: 9 }, // 最高压缩级别
    })

    // 监听错误
    archive.on('error', (err) => {
      console.error('ZIP 创建失败:', err)
      res.status(500).json({
        success: false,
        message: 'ZIP 创建失败',
      })
    })

    // 将 ZIP 流输出到响应
    archive.pipe(res)

    // 添加文件到 ZIP
    for (const inv of invoices) {
      // 校验文件路径安全性
      if (!validateFilePath(inv.file_path)) {
        console.warn(`文件路径不合法: ${inv.file_path}`)
        continue
      }

      const filePath = path.resolve(process.cwd(), inv.file_path)

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        console.warn(`文件不存在: ${filePath}`)
        continue
      }

      // 生成文件名：员工姓名_发票日期_发票号码.扩展名
      // 清洗文件名，只保留中英文、数字、下划线、横线、点号，防止路径穿越
      const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_\-\.]/g, '_')
      const ext = path.extname(inv.file_path)
      const fileName = inv.invoice_number
        ? `${sanitize(inv.user_name)}_${sanitize(inv.invoice_date)}_${sanitize(inv.invoice_number)}${ext}`
        : `${sanitize(inv.user_name)}_${sanitize(inv.invoice_date)}_${inv.id}${ext}`

      // 添加文件到 ZIP
      archive.file(filePath, { name: fileName })
    }

    // 完成 ZIP 归档
    await archive.finalize()

    console.log(`✅ 批量下载发票成功: ${invoices.length} 个文件`)
  } catch (error) {
    console.error('批量下载发票失败:', error)
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: '批量下载发票失败',
      })
    }
  }
})

// 获取审批详情
// 获取待办计数（必须在 /:id 之前定义，避免被通配路由拦截）
router.get('/pending-counts', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId
    const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined

    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' })
    }

    const data: Record<string, any> = {}

    // Admin/Super Admin: 审批中心待办（包含所有未完成流程：pending、approved、payment_uploaded）
    if (user.role === 'admin' || user.role === 'super_admin') {
      // admin 统计基础和大额报销的全部流程 + 商务报销的待付款流程，super_admin 统计所有
      const typeFilter = user.role === 'admin'
        ? `AND (
            ai.type IN ('reimbursement_basic', 'reimbursement_large')
            OR (ai.type = 'reimbursement_business' AND r.status IN ('approved', 'payment_uploaded'))
          )`
        : ''
      const approvalPending = await db.prepare(`
        SELECT COUNT(*) as count FROM approval_instances ai
        LEFT JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
        WHERE ai.status NOT IN ('rejected', 'withdrawn', 'cancelled')
        AND (ai.target_type != 'reimbursement' OR r.id IS NOT NULL)
        AND (ai.target_type != 'reimbursement' OR r.status != 'completed')
        ${typeFilter}
      `).get() as { count: number }
      data.approvalPending = approvalPending.count

      // Admin: 转正待审批（status='submitted'）
      const probationPending = await db.prepare(`
        SELECT COUNT(*) as count FROM probation_confirmations WHERE status = 'submitted'
      `).get() as { count: number }
      data.probationPending = probationPending.count
    }

    // General Manager: 商务报销待审批 + 转正待审批
    if (user.role === 'general_manager') {
      const gmPending = await db.prepare(`
        SELECT COUNT(*) as count
        FROM approval_instances ai
        INNER JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
        WHERE ai.status = 'pending'
        AND r.type = 'business'
      `).get() as { count: number }

      // 转正待审批（只统计有审批实例的转正申请）
      const probationPending = await db.prepare(`
        SELECT COUNT(*) as count
        FROM probation_confirmations pc
        INNER JOIN approval_instances ai ON ai.target_type = 'probation' AND ai.target_id = pc.id
        WHERE pc.status = 'pending' AND ai.status = 'pending'
      `).get() as { count: number }

      // 总经理待审批 = 商务报销待审批 + 转正待审批
      data.gmApprovalPending = gmPending.count + probationPending.count
      data.probationPending = probationPending.count
    }

    // 所有用户: 自己的报销待确认收款（按类型分）
    const myReimbursementPending = await db.prepare(`
      SELECT type, COUNT(*) as count FROM reimbursements
      WHERE user_id = ? AND status = 'payment_uploaded'
      GROUP BY type
    `).all(userId) as Array<{ type: string; count: number }>

    const reimbursementMap: Record<string, number> = {}
    for (const item of myReimbursementPending) {
      reimbursementMap[item.type] = item.count
    }
    data.myReimbursementBasic = reimbursementMap['basic'] || 0
    data.myReimbursementLarge = reimbursementMap['large'] || 0
    data.myReimbursementBusiness = reimbursementMap['business'] || 0

    // 所有用户: 自己的报销已驳回（按类型分）
    const myReimbursementRejected = await db.prepare(`
      SELECT type, COUNT(*) as count FROM reimbursements
      WHERE user_id = ? AND status = 'rejected'
      GROUP BY type
    `).all(userId) as Array<{ type: string; count: number }>

    const rejectedMap: Record<string, number> = {}
    for (const item of myReimbursementRejected) {
      rejectedMap[item.type] = item.count
    }
    data.myReimbursementBasicRejected = rejectedMap['basic'] || 0
    data.myReimbursementLargeRejected = rejectedMap['large'] || 0
    data.myReimbursementBusinessRejected = rejectedMap['business'] || 0

    // 所有用户: 转正待提交（试用期且未提交申请）
    const profile = await db.prepare(`
      SELECT ep.id, ep.employment_status FROM employee_profiles ep
      WHERE ep.user_id = ?
    `).get(userId) as { id: string; employment_status: string } | undefined

    if (profile && profile.employment_status === 'probation') {
      const confirmation = await db.prepare(`
        SELECT status FROM probation_confirmations WHERE employee_id = ?
      `).get(profile.id) as { status: string } | undefined

      data.myProbationPending = !confirmation || confirmation.status === 'pending'
    } else {
      data.myProbationPending = false
    }

    res.json({ success: true, data })
  } catch (error) {
    console.error('获取待办计数失败:', error)
    res.status(500).json({ success: false, message: '获取待办计数失败' })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session.user?.id
    const userRole = req.session.user?.role

    if (!userId || !userRole) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const instance = await db.prepare(`
      SELECT
        ai.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar
      FROM approval_instances ai
      LEFT JOIN users u ON ai.applicant_id = u.id
      WHERE ai.id = ?
    `).get(id) as (ApprovalInstance & { applicant_name: string; applicant_avatar: string | null }) | undefined

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '审批不存在',
      })
    }

    // 权限校验：只允许申请人、审批人、管理员或总经理（商务报销）查看
    const isApplicant = instance.applicant_id === userId
    const isAdmin = userRole === 'admin' || userRole === 'super_admin'
    const isGMForBusiness = userRole === 'general_manager' && instance.type === 'reimbursement_business'

    // 检查是否是审批人
    const approvalRecord = await db.prepare(`
      SELECT COUNT(*) as count FROM approval_records
      WHERE instance_id = ? AND approver_id = ?
    `).get(id, userId) as { count: number }
    const isApprover = approvalRecord.count > 0

    if (!isApplicant && !isApprover && !isAdmin && !isGMForBusiness) {
      return res.status(403).json({
        success: false,
        message: '无权查看该审批记录',
      })
    }

    // 获取审批记录
    const records = await db.prepare(`
      SELECT
        ar.*,
        u.name as approver_name,
        u.avatar_url as approver_avatar
      FROM approval_records ar
      LEFT JOIN users u ON ar.approver_id = u.id
      WHERE ar.instance_id = ?
      ORDER BY ar.action_time ASC
    `).all(id) as Array<ApprovalRecord & { approver_name: string; approver_avatar: string | null }>

    // 查询管理员和总经理的名字（用于审批流程显示）
    const adminUser = await db.prepare(`
      SELECT name FROM users WHERE role IN ('admin', 'super_admin') AND status = 'active' ORDER BY role ASC LIMIT 1
    `).get() as { name: string } | undefined
    const gmUser = await db.prepare(`
      SELECT name FROM users WHERE role = 'general_manager' AND status = 'active' LIMIT 1
    `).get() as { name: string } | undefined

    res.json({
      success: true,
      data: {
        id: instance.id,
        type: instance.type,
        targetId: instance.target_id,
        targetType: instance.target_type,
        applicantId: instance.applicant_id,
        applicantName: instance.applicant_name,
        applicantAvatar: instance.applicant_avatar,
        currentStep: instance.current_step,
        status: instance.status,
        submitTime: formatDateTime(instance.submit_time),
        completeTime: formatDateTime(instance.complete_time),
        createdAt: formatDateTime(instance.created_at),
        records: records.map(record => ({
          id: record.id,
          step: record.step,
          approverId: record.approver_id,
          approverName: record.approver_name,
          approverAvatar: record.approver_avatar,
          action: record.action,
          comment: record.comment,
          actionTime: formatDateTime(record.action_time),
        })),
        adminApproverName: adminUser?.name || null,
        gmApproverName: gmUser?.name || null,
      },
    })
  } catch (error) {
    console.error('获取审批详情失败:', error)
    res.status(500).json({
      success: false,
      message: '获取审批详情失败',
    })
  }
})

// 通过审批（管理员和总经理均可操作）
router.post('/:id/approve', requireRole(['super_admin', 'admin', 'general_manager']), async (req, res) => {
  try {
    const { id } = req.params
    const { comment } = req.body
    const userId = req.session?.userId
    const userName = req.session?.user?.name
    const userRole = req.session?.user?.role

    // 获取审批实例
    const instance = await db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(id) as ApprovalInstance | undefined

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '审批不存在',
      })
    }

    if (instance.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: '该审批已处理',
      })
    }

    // 权限边界校验：总经理只能审批商务报销，管理员只能审批基础和大额报销
    if (userRole === 'general_manager') {
      if (instance.type !== 'reimbursement_business') {
        return res.status(403).json({
          success: false,
          message: '总经理只能审批商务报销',
        })
      }
    } else if (userRole === 'admin') {
      if (instance.type === 'reimbursement_business') {
        return res.status(403).json({
          success: false,
          message: '管理员不能审批商务报销',
        })
      }
    }
    // super_admin 可以审批所有类型

    const now = new Date().toISOString()
    const recordId = nanoid()

    // 使用事务确保审批记录、实例状态、报销单状态原子性写入
    await db.transaction(async (client) => {
      // 创建审批记录
      await txRun(client, `
        INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
        VALUES (?, ?, ?, ?, 'approve', ?, ?)
      `, recordId, id, instance.current_step, userId, comment || null, now)

      // 更新审批实例状态
      await txRun(client, `
        UPDATE approval_instances
        SET status = 'approved', complete_time = ?, updated_at = ?
        WHERE id = ?
      `, now, now, id)

      // 如果是报销单审批，同步更新报销单状态
      if (instance.target_type === 'reimbursement') {
        // 计算总核减金额
        const invoices = await txGet<{ total_deduction: number }>(client, `
          SELECT COALESCE(SUM(deducted_amount), 0) as total_deduction
          FROM reimbursement_invoices
          WHERE reimbursement_id = ?
        `, instance.target_id)

        const totalDeduction = invoices?.total_deduction || 0

        // 获取报销单实际金额（total_amount 已经是扣除核减后的金额）
        const reimbursement = await txGet<{ total_amount: number }>(client, 'SELECT total_amount FROM reimbursements WHERE id = ?', instance.target_id)
        const actualAmount = reimbursement?.total_amount || 0

        // 实际报销金额为0时（全额核减），直接完成，无需付款流程
        if (actualAmount <= 0) {
          await txRun(client, `
            UPDATE reimbursements
            SET status = 'completed', approve_time = ?, approver = ?, deduction_amount = ?, completed_time = ?, updated_at = ?
            WHERE id = ?
          `, now, userName || '系统', totalDeduction, now, now, instance.target_id)
          console.log('✅ 报销单全额核减，直接完成:', instance.target_id, '核减金额:', totalDeduction)
        } else {
          await txRun(client, `
            UPDATE reimbursements
            SET status = 'approved', approve_time = ?, approver = ?, deduction_amount = ?, updated_at = ?
            WHERE id = ?
          `, now, userName || '系统', totalDeduction, now, instance.target_id)
          console.log('✅ 同步更新报销单状态为已通过:', instance.target_id, '核减金额:', totalDeduction)
        }
      }
    })

    console.log('✅ 审批通过:', { instanceId: id, approverId: userId })

    res.json({
      success: true,
      message: '审批已通过',
    })
  } catch (error) {
    console.error('审批通过失败:', error)
    res.status(500).json({
      success: false,
      message: '审批通过失败',
    })
  }
})

// 驳回审批（管理员和总经理均可操作）
router.post('/:id/reject', requireRole(['super_admin', 'admin', 'general_manager']), async (req, res) => {
  try {
    const { id } = req.params
    const { comment } = req.body
    const userId = req.session?.userId
    const userRole = req.session?.user?.role

    if (!comment) {
      return res.status(400).json({
        success: false,
        message: '请填写驳回原因',
      })
    }

    // 获取审批实例
    const instance = await db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(id) as ApprovalInstance | undefined

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '审批不存在',
      })
    }

    if (instance.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: '该审批已处理',
      })
    }

    // 权限边界校验：总经理只能驳回商务报销，管理员只能驳回基础和大额报销
    if (userRole === 'general_manager') {
      if (instance.type !== 'reimbursement_business') {
        return res.status(403).json({
          success: false,
          message: '总经理只能驳回商务报销',
        })
      }
    } else if (userRole === 'admin') {
      if (instance.type === 'reimbursement_business') {
        return res.status(403).json({
          success: false,
          message: '管理员不能驳回商务报销',
        })
      }
    }
    // super_admin 可以驳回所有类型

    const now = new Date().toISOString()
    const recordId = nanoid()
    const rejectUserName = req.session?.user?.name

    // 使用事务确保审批记录、实例状态、报销单状态原子性写入
    await db.transaction(async (client) => {
      // 创建审批记录
      await txRun(client, `
        INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
        VALUES (?, ?, ?, ?, 'reject', ?, ?)
      `, recordId, id, instance.current_step, userId, comment, now)

      // 更新审批实例状态
      await txRun(client, `
        UPDATE approval_instances
        SET status = 'rejected', complete_time = ?, updated_at = ?
        WHERE id = ?
      `, now, now, id)

      // 如果是报销单审批，同步更新报销单状态
      if (instance.target_type === 'reimbursement') {
        await txRun(client, `
          UPDATE reimbursements
          SET status = 'rejected', approve_time = ?, approver = ?, reject_reason = ?, updated_at = ?
          WHERE id = ?
        `, now, rejectUserName || '系统', comment, now, instance.target_id)
        console.log('✅ 同步更新报销单状态为已驳回:', instance.target_id)
      }
    })

    console.log('✅ 审批驳回:', { instanceId: id, approverId: userId, reason: comment })

    res.json({
      success: true,
      message: '审批已驳回',
    })
  } catch (error) {
    console.error('审批驳回失败:', error)
    res.status(500).json({
      success: false,
      message: '审批驳回失败',
    })
  }
})

// 提交审批（用于报销单、工作日志等提交审批）
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const { type, targetId, targetType } = req.body
    const userId = req.session?.userId

    if (!type || !targetId || !targetType) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    // 针对报销单类型，校验目标存在性、归属和状态
    if (targetType === 'reimbursement') {
      const reimbursement = await db.get(
        'SELECT id, user_id, status FROM reimbursements WHERE id = ?',
        targetId
      )

      if (!reimbursement) {
        return res.status(404).json({
          success: false,
          message: '报销单不存在',
        })
      }

      if (reimbursement.user_id !== userId) {
        return res.status(403).json({
          success: false,
          message: '无权提交此报销单的审批',
        })
      }

      // 只有 pending 状态的报销单才能提交审批
      if (reimbursement.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: '只有待审批状态的报销单才能提交审批',
        })
      }
    }

    // 检查是否已有pending状态的审批
    const existing = await db.prepare(`
      SELECT id FROM approval_instances
      WHERE target_id = ? AND target_type = ? AND status = 'pending'
    `).get(targetId, targetType)

    if (existing) {
      return res.status(400).json({
        success: false,
        message: '该项目已有待处理的审批',
      })
    }

    const now = new Date().toISOString()
    const instanceId = nanoid()

    // 创建审批实例
    await db.prepare(`
      INSERT INTO approval_instances (id, flow_id, type, target_id, target_type, applicant_id, current_step, status, submit_time, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, ?, 1, 'pending', ?, ?, ?)
    `).run(instanceId, type, targetId, targetType, userId, now, now, now)

    console.log('✅ 提交审批:', { instanceId, type, targetId, applicantId: userId })

    res.json({
      success: true,
      data: { id: instanceId },
      message: '审批已提交',
    })
  } catch (error) {
    console.error('提交审批失败:', error)
    res.status(500).json({
      success: false,
      message: '提交审批失败',
    })
  }
})

// 撤销审批
router.post('/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session?.userId

    // 获取审批实例
    const instance = await db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(id) as ApprovalInstance | undefined

    if (!instance) {
      return res.status(404).json({
        success: false,
        message: '审批不存在',
      })
    }

    // 只有申请人可以撤销
    if (instance.applicant_id !== userId) {
      return res.status(403).json({
        success: false,
        message: '只有申请人可以撤销审批',
      })
    }

    if (instance.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: '只能撤销待处理的审批',
      })
    }

    const now = new Date().toISOString()

    // 更新审批实例状态
    await db.prepare(`
      UPDATE approval_instances
      SET status = 'cancelled', complete_time = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id)

    console.log('✅ 审批已撤销:', { instanceId: id, userId })

    res.json({
      success: true,
      message: '审批已撤销',
    })
  } catch (error) {
    console.error('撤销审批失败:', error)
    res.status(500).json({
      success: false,
      message: '撤销审批失败',
    })
  }
})

// ==================== 统一待办计数接口 ====================

// 获取当前用户所有待办计数（菜单栏角标用）
export default router
