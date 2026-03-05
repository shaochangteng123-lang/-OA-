/**
 * 审批路由
 * 处理工作日志、报销单等业务的审批流程
 */

import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import type { ApprovalInstance, ApprovalRecord } from '../types/database.js'

const router = Router()

// 获取审批统计数据
router.get('/statistics', requireAdmin, (req, res) => {
  try {
    // 获取当月的开始和结束时间
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    // 1. 待审批数量（排除已删除的报销单）
    const pendingCount = db.prepare(`
      SELECT COUNT(*) as count FROM approval_instances ai
      LEFT JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
      WHERE ai.status = 'pending'
      AND (ai.target_type != 'reimbursement' OR r.id IS NOT NULL)
    `).get() as { count: number }

    // 2. 当月审批通过数量（排除已删除的报销单）
    const approvedThisMonth = db.prepare(`
      SELECT COUNT(*) as count FROM approval_instances ai
      LEFT JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
      WHERE ai.status = 'approved'
      AND ai.complete_time >= ? AND ai.complete_time <= ?
      AND (ai.target_type != 'reimbursement' OR r.id IS NOT NULL)
    `).get(monthStart, monthEnd) as { count: number }

    // 3. 审批通过但未付款的报销单数量（status = 'approved' 的报销单）
    const approvedUnpaid = db.prepare(`
      SELECT COUNT(*) as count FROM reimbursements
      WHERE status = 'approved'
    `).get() as { count: number }

    // 4. 本月已付款数量（包括待确认收款和已完成）
    const paidThisMonth = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount FROM reimbursements
      WHERE status IN ('paying', 'payment_uploaded', 'completed')
      AND pay_time >= ? AND pay_time <= ?
    `).get(monthStart, monthEnd) as { count: number; amount: number }

    // 5. 本月已完成数量（员工已确认收款）
    const completedThisMonth = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount FROM reimbursements
      WHERE status = 'completed'
      AND completed_time >= ? AND completed_time <= ?
    `).get(monthStart, monthEnd) as { count: number; amount: number }

    res.json({
      success: true,
      data: {
        pendingCount: pendingCount.count,
        approvedThisMonth: approvedThisMonth.count,
        approvedUnpaid: approvedUnpaid.count,
        paidThisMonth: paidThisMonth.count,
        paidThisMonthAmount: paidThisMonth.amount,
        completedThisMonth: completedThisMonth.count,
        completedThisMonthAmount: completedThisMonth.amount,
        currentMonth: `${now.getFullYear()}年${now.getMonth() + 1}月`,
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

// 获取本月已通过的审批列表
router.get('/approved-this-month', requireAdmin, (req, res) => {
  try {
    // 获取当月的开始和结束时间
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    const instances = db.prepare(`
      SELECT
        ai.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar,
        r.title as reimbursement_title,
        r.total_amount as reimbursement_amount
      FROM approval_instances ai
      LEFT JOIN users u ON ai.applicant_id = u.id
      LEFT JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
      WHERE ai.status = 'approved'
      AND ai.complete_time >= ? AND ai.complete_time <= ?
      AND (ai.target_type != 'reimbursement' OR r.id IS NOT NULL)
      ORDER BY ai.complete_time DESC
    `).all(monthStart, monthEnd) as Array<ApprovalInstance & { applicant_name: string; applicant_avatar: string | null; reimbursement_title: string | null; reimbursement_amount: number | null }>

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
        submitTime: instance.submit_time,
        completeTime: instance.complete_time,
        createdAt: instance.created_at,
        reimbursementInfo: instance.target_type === 'reimbursement' && instance.reimbursement_title ? {
          title: instance.reimbursement_title,
          amount: instance.reimbursement_amount || 0,
        } : null,
      })),
    })
  } catch (error) {
    console.error('获取本月已通过列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取本月已通过列表失败',
    })
  }
})

// 获取已通过未付款的报销单列表
router.get('/approved-unpaid', requireAdmin, (req, res) => {
  try {
    const reimbursements = db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.status = 'approved'
      ORDER BY r.approve_time DESC
    `).all() as Array<any>

    res.json({
      success: true,
      data: reimbursements.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        amount: r.total_amount,
        status: r.status,
        applicantName: r.applicant_name,
        applicantAvatar: r.applicant_avatar,
        approveTime: r.approve_time,
        userId: r.user_id,
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
router.get('/paid-this-month', requireAdmin, (req, res) => {
  try {
    // 获取当月的开始和结束时间
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    const reimbursements = db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.status IN ('paying', 'payment_uploaded', 'completed')
      AND r.pay_time >= ? AND r.pay_time <= ?
      ORDER BY r.pay_time DESC
    `).all(monthStart, monthEnd) as Array<any>

    res.json({
      success: true,
      data: reimbursements.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        amount: r.total_amount,
        status: r.status,
        applicantName: r.applicant_name,
        applicantAvatar: r.applicant_avatar,
        approveTime: r.approve_time,
        approver: r.approver,
        payTime: r.pay_time,
        paymentUploadTime: r.payment_upload_time,
        completedTime: r.completed_time,
        paymentProofPath: r.payment_proof_path,
        receiptConfirmedBy: r.receipt_confirmed_by,
        userId: r.user_id,
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
router.get('/completed-this-month', requireAdmin, (req, res) => {
  try {
    // 获取当月的开始和结束时间
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()

    const reimbursements = db.prepare(`
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
        title: r.title,
        amount: r.total_amount,
        status: r.status,
        applicantName: r.applicant_name,
        applicantAvatar: r.applicant_avatar,
        approveTime: r.approve_time,
        approver: r.approver,
        payTime: r.pay_time,
        paymentUploadTime: r.payment_upload_time,
        completedTime: r.completed_time,
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
router.get('/payee-info/:userId', requireAdmin, (req, res) => {
  try {
    const { userId } = req.params

    // 优先从 employee_profiles 表获取收款信息（入职时填写的信息）
    const profile = db.prepare(`
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
    const user = db.prepare(`
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

// 获取待我审批的列表
router.get('/pending', requireAdmin, (req, res) => {
  try {
    const instances = db.prepare(`
      SELECT
        ai.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar,
        r.title as reimbursement_title,
        r.total_amount as reimbursement_amount
      FROM approval_instances ai
      LEFT JOIN users u ON ai.applicant_id = u.id
      LEFT JOIN reimbursements r ON ai.target_type = 'reimbursement' AND ai.target_id = r.id
      WHERE ai.status = 'pending'
      AND (ai.target_type != 'reimbursement' OR r.id IS NOT NULL)
      ORDER BY ai.submit_time DESC
    `).all() as Array<ApprovalInstance & { applicant_name: string; applicant_avatar: string | null; reimbursement_title: string | null; reimbursement_amount: number | null }>

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
        submitTime: instance.submit_time,
        createdAt: instance.created_at,
        reimbursementInfo: instance.target_type === 'reimbursement' && instance.reimbursement_title ? {
          title: instance.reimbursement_title,
          amount: instance.reimbursement_amount || 0,
        } : null,
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
router.get('/my-submissions', requireAuth, (req, res) => {
  try {
    const userId = req.session?.userId

    const instances = db.prepare(`
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
        submitTime: instance.submit_time,
        completeTime: instance.complete_time,
        createdAt: instance.created_at,
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
router.get('/processed', requireAdmin, (req, res) => {
  try {
    const userId = req.session?.userId

    // 获取我处理过的审批实例ID
    const processedRecords = db.prepare(`
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

    const instances = db.prepare(`
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
        submitTime: instance.submit_time,
        completeTime: instance.complete_time,
        createdAt: instance.created_at,
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
router.get('/employees', requireAdmin, (req, res) => {
  try {
    // 排除系统管理员（super_admin 和 admin 角色）
    const employees = db.prepare(`
      SELECT id, name, username, department, position
      FROM users
      WHERE status = 'active'
      AND role NOT IN ('super_admin', 'admin')
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
router.get('/employee-summary', requireAdmin, (req, res) => {
  try {
    const { userId, startDate, endDate } = req.query

    if (!userId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: '请选择员工和日期范围',
      })
    }

    // 获取员工信息
    const employee = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) as { id: string; name: string } | undefined

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: '员工不存在',
      })
    }

    // 查询该员工在指定时间范围内的报销数据（管理员可以看到所有数据，包括已删除的）
    // 按类型分组统计
    const summaryByType = db.prepare(`
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
    const details = db.prepare(`
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
      paying: '付款中',
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
          title: item.title,
          amount: item.amount,
          status: item.status,
          statusName: statusMap[item.status] || item.status,
          submitTime: item.submitTime,
          approveTime: item.approveTime,
          createTime: item.createTime,
          isDeleted: item.isDeleted === 1,
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
router.get('/all-reimbursements', requireAdmin, (req, res) => {
  try {
    const { status, type, userId, startDate, endDate } = req.query

    let whereClause = 'WHERE 1=1'
    const params: any[] = []

    if (status) {
      whereClause += ' AND r.status = ?'
      params.push(status)
    }

    if (type) {
      whereClause += ' AND r.type = ?'
      params.push(type)
    }

    if (userId) {
      whereClause += ' AND r.user_id = ?'
      params.push(userId)
    }

    if (startDate) {
      whereClause += ' AND DATE(r.created_at) >= ?'
      params.push(startDate)
    }

    if (endDate) {
      whereClause += ' AND DATE(r.created_at) <= ?'
      params.push(endDate)
    }

    const reimbursements = db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.avatar_url as applicant_avatar,
        u.department as applicant_department
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
      approved: '已审批未付款',
      rejected: '已拒绝',
      paying: '付款中',
      payment_uploaded: '待确认',
      completed: '已完成',
    }

    res.json({
      success: true,
      data: reimbursements.map(r => ({
        id: r.id,
        type: r.type,
        typeName: typeMap[r.type] || r.type,
        title: r.title,
        amount: r.total_amount,
        status: r.status,
        statusName: statusMap[r.status] || r.status,
        applicantName: r.applicant_name,
        applicantAvatar: r.applicant_avatar,
        applicantDepartment: r.applicant_department,
        submitTime: r.submit_time,
        approveTime: r.approve_time,
        approver: r.approver,
        rejectReason: r.reject_reason,
        payTime: r.pay_time,
        paymentUploadTime: r.payment_upload_time,
        completedTime: r.completed_time,
        paymentProofPath: r.payment_proof_path,
        receiptConfirmedBy: r.receipt_confirmed_by,
        createdAt: r.created_at,
        userId: r.user_id,
      })),
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
router.get('/export-monthly', requireAdmin, (req, res) => {
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
    const reimbursements = db.prepare(`
      SELECT
        r.*,
        u.name as applicant_name,
        u.department as applicant_department,
        u.position as applicant_position
      FROM reimbursements r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.status IN ('paying', 'payment_uploaded', 'completed')
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
      paying: '付款中',
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
        title: r.title,
        amount: r.total_amount,
        status: r.status,
        statusName: statusMap[r.status] || r.status,
        payTime: r.pay_time,
        completedTime: r.completed_time,
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

// 获取审批详情
router.get('/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params

    const instance = db.prepare(`
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

    // 获取审批记录
    const records = db.prepare(`
      SELECT
        ar.*,
        u.name as approver_name,
        u.avatar_url as approver_avatar
      FROM approval_records ar
      LEFT JOIN users u ON ar.approver_id = u.id
      WHERE ar.instance_id = ?
      ORDER BY ar.action_time ASC
    `).all(id) as Array<ApprovalRecord & { approver_name: string; approver_avatar: string | null }>

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
        submitTime: instance.submit_time,
        completeTime: instance.complete_time,
        createdAt: instance.created_at,
        records: records.map(record => ({
          id: record.id,
          step: record.step,
          approverId: record.approver_id,
          approverName: record.approver_name,
          approverAvatar: record.approver_avatar,
          action: record.action,
          comment: record.comment,
          actionTime: record.action_time,
        })),
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

// 通过审批
router.post('/:id/approve', requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    const { comment } = req.body
    const userId = req.session?.userId
    const userName = req.session?.user?.name

    // 获取审批实例
    const instance = db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(id) as ApprovalInstance | undefined

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

    const now = new Date().toISOString()
    const recordId = nanoid()

    // 创建审批记录
    db.prepare(`
      INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
      VALUES (?, ?, ?, ?, 'approve', ?, ?)
    `).run(recordId, id, instance.current_step, userId, comment || null, now)

    // 更新审批实例状态
    db.prepare(`
      UPDATE approval_instances
      SET status = 'approved', complete_time = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id)

    // 如果是报销单审批，同步更新报销单状态
    if (instance.target_type === 'reimbursement') {
      db.prepare(`
        UPDATE reimbursements
        SET status = 'approved', approve_time = ?, approver = ?, updated_at = ?
        WHERE id = ?
      `).run(now, userName || '系统', now, instance.target_id)
      console.log('✅ 同步更新报销单状态为已通过:', instance.target_id)
    }

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

// 驳回审批
router.post('/:id/reject', requireAdmin, (req, res) => {
  try {
    const { id } = req.params
    const { comment } = req.body
    const userId = req.session?.userId

    if (!comment) {
      return res.status(400).json({
        success: false,
        message: '请填写驳回原因',
      })
    }

    // 获取审批实例
    const instance = db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(id) as ApprovalInstance | undefined

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

    const now = new Date().toISOString()
    const recordId = nanoid()

    // 创建审批记录
    db.prepare(`
      INSERT INTO approval_records (id, instance_id, step, approver_id, action, comment, action_time)
      VALUES (?, ?, ?, ?, 'reject', ?, ?)
    `).run(recordId, id, instance.current_step, userId, comment, now)

    // 更新审批实例状态
    db.prepare(`
      UPDATE approval_instances
      SET status = 'rejected', complete_time = ?, updated_at = ?
      WHERE id = ?
    `).run(now, now, id)

    // 如果是报销单审批，同步更新报销单状态
    if (instance.target_type === 'reimbursement') {
      const userName = req.session?.user?.name
      db.prepare(`
        UPDATE reimbursements
        SET status = 'rejected', approve_time = ?, approver = ?, reject_reason = ?, updated_at = ?
        WHERE id = ?
      `).run(now, userName || '系统', comment, now, instance.target_id)
      console.log('✅ 同步更新报销单状态为已拒绝:', instance.target_id)
    }

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
router.post('/submit', requireAuth, (req, res) => {
  try {
    const { type, targetId, targetType } = req.body
    const userId = req.session?.userId

    if (!type || !targetId || !targetType) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    // 检查是否已有pending状态的审批
    const existing = db.prepare(`
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
    db.prepare(`
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
router.post('/:id/cancel', requireAuth, (req, res) => {
  try {
    const { id } = req.params
    const userId = req.session?.userId

    // 获取审批实例
    const instance = db.prepare('SELECT * FROM approval_instances WHERE id = ?').get(id) as ApprovalInstance | undefined

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
    db.prepare(`
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

export default router
