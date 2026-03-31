import express from 'express'
import type { PoolClient } from 'pg'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import type { UserRow, UserActivityRow } from '../types/database.js'
import { hashPassword, validatePasswordStrength, validateUsername } from '../utils/password.js'
import { generateEmployeeNumber } from '../utils/employee-number.js'

const router = express.Router()

function convertTxPlaceholders(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

async function txGet<T = any>(client: PoolClient, sql: string, ...params: any[]): Promise<T | undefined> {
  const result = await client.query(convertTxPlaceholders(sql), params)
  return result.rows[0] as T | undefined
}

async function txAll<T = any>(client: PoolClient, sql: string, ...params: any[]): Promise<T[]> {
  const result = await client.query(convertTxPlaceholders(sql), params)
  return result.rows as T[]
}

async function txRun(client: PoolClient, sql: string, ...params: any[]): Promise<{ changes: number }> {
  const result = await client.query(convertTxPlaceholders(sql), params)
  return { changes: result.rowCount ?? 0 }
}

// 获取用户列表（简化版，用于日历用户选择器）
router.get('/list', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId

    // 检查权限：只有 super_admin 和 admin 可以查看用户列表
    const currentUser = await db
      .prepare('SELECT role FROM users WHERE id = ?')
      .get(currentUserId) as { role: string } | undefined

    if (!currentUser || !['super_admin', 'admin'].includes(currentUser.role)) {
      return res.status(403).json({
        success: false,
        message: '无权查看用户列表',
      })
    }

    // 只返回激活状态的用户
    const users = await db
      .prepare('SELECT id, name, email, avatar_url FROM users WHERE status = ? ORDER BY name ASC')
      .all('active') as Array<{ id: string; name: string; email: string | null; avatar_url: string | null }>

    const result = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatar_url,
    }))

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('获取用户列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取用户列表失败',
    })
  }
})

// 获取用户列表（完整版）
router.get('/', requireAuth, async (req, res) => {
  try {
    const { role, status, keyword } = req.query

    let query = 'SELECT * FROM users WHERE 1=1'
    const params: unknown[] = []

    if (role) {
      query += ' AND role = ?'
      params.push(role)
    }

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    if (keyword) {
      query += ' AND (name LIKE ? OR email LIKE ? OR mobile LIKE ?)'
      const searchTerm = `%${keyword}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    query += ' ORDER BY created_at DESC'

    const users = await db.prepare(query).all(...params) as UserRow[]

    // 转换数据格式，移除敏感信息
    const result = users.map((user) => ({
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      avatarUrl: user.avatar_url,
      role: user.role,
      status: user.status,
      department: user.department,
      position: user.position,
      employeeNo: user.employee_no,
      bankAccountName: user.bank_account_name,
      bankAccountPhone: user.bank_account_phone,
      bankName: user.bank_name,
      bankAccountNumber: user.bank_account_number,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      lastLoginAt: user.last_login_at,
    }))

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('获取用户列表失败:', error)
    res.status(500).json({
      success: false,
      message: '获取用户列表失败',
    })
  }
})

// 更新用户信息
router.post('/', requireAuth, async (req, res) => {
  try {
    const { id, username, name, password, email, mobile, role, status, department, position, bankAccountName, bankAccountPhone, bankName, bankAccountNumber } = req.body
    const now = new Date().toISOString()

    if (!id) {
      return res.status(400).json({
        success: false,
        message: '缺少用户ID',
      })
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在',
      })
    }

    // 如果要修改用户名，验证格式并检查是否重复
    if (username && username !== user.username) {
      const usernameValidation = validateUsername(username)
      if (!usernameValidation.valid) {
        return res.status(400).json({
          success: false,
          message: usernameValidation.message,
        })
      }

      const existingUser = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id)
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: '用户名已被使用',
        })
      }
    }

    // 验证密码强度（如果提供）
    if (password) {
      const passwordValidation = validatePasswordStrength(password)
      if (!passwordValidation.valid) {
        return res.status(400).json({
          success: false,
          message: passwordValidation.message,
        })
      }
    }

    // 验证手机号格式（如果提供）
    if (mobile && !/^1[3-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: '手机号格式不正确',
      })
    }

    // 验证邮箱格式（如果提供）
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: '邮箱格式不正确',
      })
    }

    // 验证银行卡信息格式（如果提供）
    if (bankAccountPhone && !/^1[3-9]\d{9}$/.test(bankAccountPhone)) {
      return res.status(400).json({
        success: false,
        message: '收款人手机号格式不正确',
      })
    }

    if (bankAccountNumber && !/^\d{16,19}$/.test(bankAccountNumber)) {
      return res.status(400).json({
        success: false,
        message: '银行卡号格式不正确（16-19位数字）',
      })
    }

    // 更新密码（如果提供）
    if (password) {
      const passwordHash = await hashPassword(password)
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id)
    }

    await db.prepare(
      `
      UPDATE users
      SET username = ?, name = ?, email = ?, mobile = ?, role = ?, status = ?, department = ?, position = ?,
          bank_account_name = ?, bank_account_phone = ?, bank_name = ?, bank_account_number = ?,
          updated_at = ?
      WHERE id = ?
    `
    ).run(
      username || user.username,
      name || user.name,
      email || user.email || null,
      mobile || user.mobile || null,
      role,
      status,
      department || null,
      position || null,
      bankAccountName || user.bank_account_name || null,
      bankAccountPhone || user.bank_account_phone || null,
      bankName || user.bank_name || null,
      bankAccountNumber || user.bank_account_number || null,
      now,
      id
    )

    res.json({
      success: true,
      data: { id },
    })
  } catch (error) {
    console.error('更新用户失败:', error)
    res.status(500).json({
      success: false,
      message: '更新用户失败',
    })
  }
})

// 获取用户活动日志
router.get('/activities', requireAuth, async (req, res) => {
  try {
    const { userId, limit = 100 } = req.query
    const currentUserId = req.session.userId

    let query = 'SELECT * FROM user_activities WHERE user_id = ?'
    const params: unknown[] = [userId || currentUserId]

    query += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(Number(limit))

    const activities = await db.prepare(query).all(...params) as UserActivityRow[]

    // 转换数据格式
    const result = activities.map((activity) => ({
      id: activity.id,
      userId: activity.user_id,
      action: activity.action,
      description: activity.description,
      metadata: activity.metadata_json ? JSON.parse(activity.metadata_json) : null,
      ipAddress: activity.ip_address,
      userAgent: activity.user_agent,
      timestamp: activity.timestamp,
    }))

    res.json({
      success: true,
      data: result,
    })
  } catch (error) {
    console.error('获取用户活动失败:', error)
    res.status(500).json({
      success: false,
      message: '获取用户活动失败',
    })
  }
})

// 获取下一个员工编号（管理员可用）
router.get('/next-employee-no', requireAdmin, async (req, res) => {
  try {
    const employeeNo = await generateEmployeeNumber()
    res.json({ success: true, data: { employeeNo } })
  } catch (error) {
    console.error('获取员工编号失败:', error)
    res.status(500).json({ success: false, message: '获取员工编号失败' })
  }
})

// 创建新用户（管理员可用）
router.post('/create', requireAdmin, async (req, res) => {
  try {
    const { username, password, email, mobile, role, department, position, bankAccountName, bankAccountPhone, bankName, bankAccountNumber } = req.body

    // 验证必填字段
    if (!username || !password || !email || !mobile || !department || !position) {
      return res.status(400).json({
        success: false,
        message: '用户名、密码、邮箱、手机号、部门、职位为必填项',
      })
    }

    // 验证密码强度
    const passwordValidation = validatePasswordStrength(password)
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      })
    }

    // 验证手机号格式（必须11位）
    if (!/^1[3-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: '手机号格式不正确',
      })
    }

    // 验证收款人手机号格式（如果提供）
    if (bankAccountPhone && !/^1[3-9]\d{9}$/.test(bankAccountPhone)) {
      return res.status(400).json({
        success: false,
        message: '收款人手机号格式不正确',
      })
    }

    // 验证银行卡号格式（如果提供）
    if (bankAccountNumber && !/^\d{16,19}$/.test(bankAccountNumber)) {
      return res.status(400).json({
        success: false,
        message: '银行卡号格式不正确（16-19位数字）',
      })
    }

    // 验证邮箱格式（如果提供）
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: '邮箱格式不正确',
      })
    }

    // 检查用户名是否已存在
    const existingUser = await db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: '用户名已存在',
      })
    }

    // 检查手机号是否已存在
    const existingMobile = await db.prepare('SELECT id FROM users WHERE mobile = ?').get(mobile)
    if (existingMobile) {
      return res.status(400).json({
        success: false,
        message: '手机号已被使用',
      })
    }

    // 验证角色
    const validRoles = ['admin', 'general_manager', 'user', 'guest']
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: '无效的角色，可选值：admin, general_manager, user, guest',
      })
    }

    // 创建用户（用户名即为显示名称）
    const userId = nanoid()
    const passwordHash = await hashPassword(password)
    const now = new Date().toISOString()

    // 自动生成员工编号
    const employeeNo = await generateEmployeeNumber()

    await db.prepare(`
      INSERT INTO users (id, username, password_hash, name, email, mobile, role, status, department, position, bank_account_name, bank_account_phone, bank_name, bank_account_number, employee_no, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      username,
      passwordHash,
      username, // name 使用 username 的值
      email || null,
      mobile,
      role || 'user',
      department,
      position,
      bankAccountName,
      bankAccountPhone,
      bankName,
      bankAccountNumber,
      employeeNo,
      now,
      now
    )

    console.log('✅ 创建用户成功:', { userId, username, employeeNo, role: role || 'user' })

    res.json({
      success: true,
      data: {
        id: userId,
        username,
        name: username,
        email,
        mobile,
        employeeNo,
        role: role || 'user',
      },
      message: '用户创建成功',
    })
  } catch (error) {
    console.error('❌ 创建用户失败:', error)
    res.status(500).json({
      success: false,
      message: '创建用户失败',
    })
  }
})

// 删除用户（管理员可用）
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const currentUserId = req.session?.userId

    // 不能删除自己
    if (id === currentUserId) {
      return res.status(400).json({
        success: false,
        message: '不能删除当前登录的账号',
      })
    }

    // 检查用户是否存在
    const user = await db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(id) as { id: string; name: string; role: string } | undefined
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在',
      })
    }

    // 不能删除超级管理员
    if (user.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        message: '不能删除超级管理员账号',
      })
    }

    // 使用事务删除用户及其关联数据
    await db.transaction(async (client) => {
      // 删除用户的关联数据
      await txRun(client, 'DELETE FROM user_preferences WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM user_activities WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM drafts WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM calendar_events WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM worklogs WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM projects WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM reimbursements WHERE user_id = ?', id)

      // 删除审批相关数据
      // 先获取该用户作为申请人的审批实例ID
      const approvalInstances = await txAll<{ id: string }>(client, 'SELECT id FROM approval_instances WHERE applicant_id = ?', id)
      for (const instance of approvalInstances) {
        await txRun(client, 'DELETE FROM approval_records WHERE instance_id = ?', instance.id)
      }
      await txRun(client, 'DELETE FROM approval_instances WHERE applicant_id = ?', id)

      // 删除该用户作为审批人的记录
      await txRun(client, 'DELETE FROM approval_records WHERE approver_id = ?', id)

      // 最后删除用户
      await txRun(client, 'DELETE FROM users WHERE id = ?', id)
    })

    console.log('✅ 删除用户成功:', { userId: id, userName: user.name })

    res.json({
      success: true,
      message: '用户删除成功',
    })
  } catch (error) {
    console.error('❌ 删除用户失败:', error)
    res.status(500).json({
      success: false,
      message: '删除用户失败',
    })
  }
})

// 重置用户密码（管理员可用）
router.post('/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { newPassword } = req.body

    // 验证密码
    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: '请输入新密码',
      })
    }

    const passwordValidation = validatePasswordStrength(newPassword)
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      })
    }

    // 检查用户是否存在
    const user = await db.prepare('SELECT id, name FROM users WHERE id = ?').get(id) as { id: string; name: string } | undefined
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在',
      })
    }

    // 更新密码
    const passwordHash = await hashPassword(newPassword)
    const now = new Date().toISOString()
    await db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, id)

    console.log('✅ 重置密码成功:', { userId: id, userName: user.name })

    res.json({
      success: true,
      message: '密码重置成功',
    })
  } catch (error) {
    console.error('❌ 重置密码失败:', error)
    res.status(500).json({
      success: false,
      message: '重置密码失败',
    })
  }
})

export default router
