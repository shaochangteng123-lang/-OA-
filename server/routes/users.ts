import express from 'express'
import type { PoolClient } from 'pg'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import type { UserRow, UserActivityRow } from '../types/database.js'
import { hashPassword, validatePasswordStrength, validateUsername } from '../utils/password.js'
import {
  getNextEmployeeNumber,
  isValidEmployeeNumber,
  normalizeEmployeeNumber,
} from '../utils/employee-number.js'
import {
  parseStoredDepartmentPositionMap,
  validateDepartmentPositionPair,
  type DepartmentPositionMap,
} from '../utils/department-position.js'
import {
  canCreateChairmanAccount,
  getStandaloneRoleTransitionError,
  getUserCreationRequiredFieldsError,
  isBossRole,
  isChairmanRole,
  isSystemAdminEquivalentRole,
  requiresEmployeeProfile,
  resolveUserAccountName,
} from '../utils/boss-role.js'

const router = express.Router()

const USER_ROLES = ['super_admin', 'chairman', 'admin', 'general_manager', 'boss', 'user', 'guest'] as const
const USER_STATUSES = ['active', 'inactive'] as const
const EMPLOYMENT_STATUSES = ['probation', 'active', 'resigned'] as const
const EMPLOYEE_NUMBER_SOURCE_QUERY = `
  SELECT employee_no
  FROM users
  WHERE employee_no IS NOT NULL AND BTRIM(employee_no) <> ''
  UNION
  SELECT employee_no
  FROM employee_profiles
  WHERE employee_no IS NOT NULL AND BTRIM(employee_no) <> ''
`

type EmployeeNumberRow = {
  employee_no: string | null
}

async function getDepartmentPositionMap(): Promise<DepartmentPositionMap> {
  const config = await db.prepare(
    'SELECT config_json FROM department_position_configs WHERE id = ?',
  ).get('default') as { config_json: string } | undefined
  return parseStoredDepartmentPositionMap(config?.config_json)
}

class UserOperationError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message)
    this.name = 'UserOperationError'
  }
}

async function getNextAvailableEmployeeNumber(client?: PoolClient): Promise<string> {
  const rows = client
    ? (await client.query<EmployeeNumberRow>(EMPLOYEE_NUMBER_SOURCE_QUERY)).rows
    : await db.prepare(EMPLOYEE_NUMBER_SOURCE_QUERY).all() as EmployeeNumberRow[]

  try {
    return getNextEmployeeNumber(rows.map((item) => item.employee_no))
  } catch (error) {
    throw new UserOperationError((error as Error).message, 409)
  }
}

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

    // 管理员和具备系统管理员能力的账号可以查看用户列表。
    const currentUser = await db
      .prepare('SELECT role FROM users WHERE id = ?')
      .get(currentUserId) as { role: string } | undefined

    if (
      !currentUser ||
      (!isSystemAdminEquivalentRole(currentUser.role) &&
        currentUser.role !== 'admin')
    ) {
      return res.status(403).json({
        success: false,
        message: '无权查看用户列表',
      })
    }

    // 只返回激活状态的用户
    const users = await db
      .prepare(`
        SELECT id, name, email, avatar_url
        FROM users
        WHERE status = ?
          AND role NOT IN ('boss', 'chairman')
        ORDER BY name ASC
      `)
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

// 获取精简同事目录，仅返回项目负责人等选择器所需字段
router.get('/directory', requireAuth, async (_req, res) => {
  try {
    const users = await db
      .prepare(`
        SELECT id, name, avatar_url, department, position, role
        FROM users
        WHERE status = 'active'
          AND role NOT IN ('boss', 'chairman')
        ORDER BY name ASC
      `)
      .all() as Array<{
        id: string
        name: string
        avatar_url: string | null
        department: string | null
        position: string | null
        role: string
      }>

    res.json({
      success: true,
      data: users.map((user) => ({
        id: user.id,
        name: user.name,
        avatarUrl: user.avatar_url,
        department: user.department,
        position: user.position,
        role: user.role,
      })),
    })
  } catch (error) {
    console.error('获取同事目录失败:', error)
    res.status(500).json({
      success: false,
      message: '获取同事目录失败',
    })
  }
})

// 获取用户列表（完整版）
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { role, status, keyword } = req.query

    let query = 'SELECT u.*, ep.employment_status FROM users u LEFT JOIN employee_profiles ep ON u.id = ep.user_id WHERE 1=1'
    const params: unknown[] = []

    if (role) {
      query += ' AND u.role = ?'
      params.push(role)
    }

    if (status) {
      query += ' AND u.status = ?'
      params.push(status)
    }

    if (keyword) {
      query += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)'
      const searchTerm = `%${keyword}%`
      params.push(searchTerm, searchTerm, searchTerm)
    }

    query += ' ORDER BY u.created_at DESC'

    const users = await db.prepare(query).all(...params) as (UserRow & { employment_status?: string })[]

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
      employmentStatus: user.employment_status || null,
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
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { id, username, name, password, email, mobile, role, status, department, position, employeeNo, bankAccountName, bankAccountPhone, bankName, bankAccountNumber, employmentStatus } = req.body
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

    const roleTransitionError = getStandaloneRoleTransitionError(user.role, role)
    if (roleTransitionError) {
      return res.status(400).json({
        success: false,
        message: roleTransitionError,
      })
    }

    const clearsEmployeeFields = isBossRole(role) || isChairmanRole(role)
    const needsEmployeeProfile = requiresEmployeeProfile(role)
    const normalizedEmployeeNo = needsEmployeeProfile
      ? normalizeEmployeeNumber(employeeNo ?? user.employee_no)
      : clearsEmployeeFields
        ? null
        : user.employee_no
    if (needsEmployeeProfile && !isValidEmployeeNumber(normalizedEmployeeNo)) {
      return res.status(400).json({
        success: false,
        message: '员工编号格式应为 YULI-CS 加 3 至 6 位数字',
      })
    }

    if (!USER_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: '无效的用户角色',
      })
    }

    if (!USER_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: '无效的账号状态',
      })
    }

    if (employmentStatus && !EMPLOYMENT_STATUSES.includes(employmentStatus)) {
      return res.status(400).json({
        success: false,
        message: '无效的员工状态',
      })
    }

    const organizationSelection = needsEmployeeProfile
      ? validateDepartmentPositionPair(
          await getDepartmentPositionMap(),
          department,
          position,
          true,
        )
      : {
          department: clearsEmployeeFields ? null : user.department,
          position: clearsEmployeeFields ? null : user.position,
          error: null,
        }
    if (organizationSelection.error) {
      return res.status(400).json({
        success: false,
        message: organizationSelection.error,
      })
    }

    const currentUser = await db
      .prepare('SELECT role FROM users WHERE id = ?')
      .get(req.session.userId) as { role: string } | undefined

    if (
      isSystemAdminEquivalentRole(user.role) &&
      !isSystemAdminEquivalentRole(currentUser?.role)
    ) {
      return res.status(403).json({
        success: false,
        message: '只有超级管理员或董事长可以修改系统级账号',
      })
    }

    if (
      isSystemAdminEquivalentRole(role) &&
      !isSystemAdminEquivalentRole(currentUser?.role)
    ) {
      return res.status(403).json({
        success: false,
        message: '只有超级管理员或董事长可以授予系统级角色',
      })
    }

    if (id === req.session.userId && status === 'inactive') {
      return res.status(400).json({
        success: false,
        message: '不能停用当前登录账号',
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
    if (needsEmployeeProfile && mobile && !/^1[3-9]\d{9}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: '手机号格式不正确',
      })
    }

    // 验证邮箱格式（如果提供）
    if (needsEmployeeProfile && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: '邮箱格式不正确',
      })
    }

    // 验证银行卡信息格式（如果提供）
    if (needsEmployeeProfile && bankAccountPhone && !/^1[3-9]\d{9}$/.test(bankAccountPhone)) {
      return res.status(400).json({
        success: false,
        message: '收款人手机号格式不正确',
      })
    }

    if (needsEmployeeProfile && bankAccountNumber && !/^\d{16,19}$/.test(bankAccountNumber)) {
      return res.status(400).json({
        success: false,
        message: '银行卡号格式不正确（16-19位数字）',
      })
    }

    const passwordHash = password ? await hashPassword(password) : null
    const nextUsername = username || user.username
    const nextName = resolveUserAccountName(role, nextUsername, name, user.name)
    await db.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['employee-number-write'])

      if (requiresEmployeeProfile(role)) {
        const duplicateEmployeeNo = await txGet<{ id: string }>(
          client,
          'SELECT id FROM users WHERE employee_no = ? AND id != ?',
          normalizedEmployeeNo,
          id,
        )
        if (duplicateEmployeeNo) {
          throw new UserOperationError('员工编号已被使用', 409)
        }
      }

      if (passwordHash) {
        await txRun(client, 'UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, id)
      }

      await txRun(
        client,
        `UPDATE users
         SET username = ?, name = ?, email = ?, mobile = ?, role = ?, status = ?,
             department = ?, position = ?, employee_no = ?, bank_account_name = ?,
             bank_account_phone = ?, bank_name = ?, bank_account_number = ?, updated_at = ?
         WHERE id = ?`,
        nextUsername,
        nextName,
        needsEmployeeProfile ? email || user.email || null : clearsEmployeeFields ? null : user.email,
        needsEmployeeProfile ? mobile || user.mobile || null : clearsEmployeeFields ? null : user.mobile,
        role,
        status,
        organizationSelection.department,
        organizationSelection.position,
        normalizedEmployeeNo,
        needsEmployeeProfile
          ? bankAccountName || user.bank_account_name || null
          : clearsEmployeeFields ? null : user.bank_account_name,
        needsEmployeeProfile
          ? bankAccountPhone || user.bank_account_phone || null
          : clearsEmployeeFields ? null : user.bank_account_phone,
        needsEmployeeProfile ? bankName || user.bank_name || null : clearsEmployeeFields ? null : user.bank_name,
        needsEmployeeProfile
          ? bankAccountNumber || user.bank_account_number || null
          : clearsEmployeeFields ? null : user.bank_account_number,
        now,
        id,
      )

      if (!needsEmployeeProfile) return

      const profile = await txGet<{ id: string; employment_status: string | null }>(
        client,
        'SELECT id, employment_status FROM employee_profiles WHERE user_id = ? FOR UPDATE',
        id,
      )
      if (profile) {
        if (
          profile.employment_status === 'resigned'
          && employmentStatus
          && employmentStatus !== 'resigned'
        ) {
          throw new UserOperationError(
            '已离职员工的原档案不能恢复为在职；返聘请创建新账号和新员工档案',
            409,
          )
        }
        if (
          employmentStatus === 'resigned'
          && profile.employment_status !== 'resigned'
        ) {
          throw new UserOperationError(
            '员工离职状态只能在五类离职档案全部归档后由系统自动更新',
            409,
          )
        }
        if (employmentStatus) {
          if (employmentStatus === 'active' && profile.employment_status === 'probation') {
            const confirmation = await txGet<{ status: string }>(
              client,
              'SELECT status FROM probation_confirmations WHERE employee_id = ?',
              profile.id,
            )
            if (confirmation?.status !== 'approved') {
              throw new UserOperationError('实习期员工必须通过转正审批后才能改为在职', 409)
            }
          }
          await txRun(
            client,
            `UPDATE employee_profiles
             SET employee_no = ?, department = ?, position = ?,
                 employment_status = ?, updated_at = ?
             WHERE user_id = ?`,
            normalizedEmployeeNo,
            organizationSelection.department,
            organizationSelection.position,
            employmentStatus,
            now,
            id,
          )
        } else {
          await txRun(
            client,
            `UPDATE employee_profiles
             SET employee_no = ?, department = ?, position = ?, updated_at = ?
             WHERE user_id = ?`,
            normalizedEmployeeNo,
            organizationSelection.department,
            organizationSelection.position,
            now,
            id,
          )
        }
      } else if (employmentStatus) {
        await txRun(
          client,
          `INSERT INTO employee_profiles (
             id, user_id, name, employee_no, department, position,
             employment_status, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
          nanoid(),
          id,
          name || username || '',
          normalizedEmployeeNo,
          organizationSelection.department,
          organizationSelection.position,
          employmentStatus,
          now,
          now,
        )
      }

    })

    res.json({
      success: true,
      data: { id, employeeNo: normalizedEmployeeNo },
    })
  } catch (error) {
    console.error('更新用户失败:', error)
    if (error instanceof UserOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    if ((error as { code?: string; constraint?: string }).code === '23505') {
      return res.status(409).json({ success: false, message: '员工编号已被使用' })
    }
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

    const targetUserId = typeof userId === 'string' ? userId : currentUserId

    if (targetUserId !== currentUserId) {
      const currentUser = await db
        .prepare('SELECT role FROM users WHERE id = ?')
        .get(currentUserId) as { role: string } | undefined

      if (
        !currentUser ||
        (!isSystemAdminEquivalentRole(currentUser.role) &&
          currentUser.role !== 'admin')
      ) {
        return res.status(403).json({
          success: false,
          message: '无权查看其他用户的活动记录',
        })
      }
    }

    let query = 'SELECT * FROM user_activities WHERE user_id = ?'
    const params: unknown[] = [targetUserId]

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

// 获取创建用户时将使用的下一个员工编号
router.get('/next-employee-number', requireAdmin, async (_req, res) => {
  try {
    let employeeNo = ''

    await db.transaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['employee-number-write'])
      employeeNo = await getNextAvailableEmployeeNumber(client)
    })

    res.json({
      success: true,
      data: { employeeNo },
    })
  } catch (error) {
    console.error('获取下一个员工编号失败:', error)
    if (error instanceof UserOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    res.status(500).json({
      success: false,
      message: '获取下一个员工编号失败',
    })
  }
})

// 创建新用户（管理员可用）
router.post('/create', requireAdmin, async (req, res) => {
  try {
    const { username, password, email, mobile, role, department, position, employmentStatus, bankAccountName, bankAccountPhone, bankName, bankAccountNumber } = req.body
    const normalizedUsername = String(username || '').trim()
    const normalizedEmail = String(email || '').trim()
    const normalizedMobile = String(mobile || '').trim()

    const requiredFieldsError = getUserCreationRequiredFieldsError({
      username: normalizedUsername,
      password,
      email: normalizedEmail,
      mobile: normalizedMobile,
      department,
      position,
      role,
    })
    if (requiredFieldsError) {
      return res.status(400).json({
        success: false,
        message: requiredFieldsError,
      })
    }
    const needsEmployeeProfile = requiresEmployeeProfile(role)

    const usernameValidation = validateUsername(normalizedUsername)
    if (!usernameValidation.valid) {
      return res.status(400).json({ success: false, message: usernameValidation.message })
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
    if (needsEmployeeProfile && !/^1[3-9]\d{9}$/.test(normalizedMobile)) {
      return res.status(400).json({
        success: false,
        message: '手机号格式不正确',
      })
    }

    // 验证收款人手机号格式（如果提供）
    if (needsEmployeeProfile && bankAccountPhone && !/^1[3-9]\d{9}$/.test(bankAccountPhone)) {
      return res.status(400).json({
        success: false,
        message: '收款人手机号格式不正确',
      })
    }

    // 验证银行卡号格式（如果提供）
    if (needsEmployeeProfile && bankAccountNumber && !/^\d{16,19}$/.test(bankAccountNumber)) {
      return res.status(400).json({
        success: false,
        message: '银行卡号格式不正确（16-19位数字）',
      })
    }

    // 验证邮箱格式（如果提供）
    if (needsEmployeeProfile && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: '邮箱格式不正确',
      })
    }

    // 验证角色
    const validRoles = ['chairman', 'admin', 'general_manager', 'boss', 'user', 'guest']
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: '无效的角色',
      })
    }
    if (role === 'chairman') {
      const currentUser = await db.prepare(
        'SELECT role FROM users WHERE id = ?',
      ).get(req.session.userId) as { role: string } | undefined
      if (!canCreateChairmanAccount(currentUser?.role)) {
        return res.status(403).json({
          success: false,
          message: '只有管理员、超级管理员或董事长可以创建董事长账号',
        })
      }
    }
    const nextEmploymentStatus = needsEmployeeProfile
      ? employmentStatus || 'probation'
      : null
    if (nextEmploymentStatus && !EMPLOYMENT_STATUSES.includes(nextEmploymentStatus)) {
      return res.status(400).json({ success: false, message: '无效的员工状态' })
    }
    if (nextEmploymentStatus === 'resigned') {
      return res.status(400).json({
        success: false,
        message: '新账号不能直接创建为已离职状态',
      })
    }
    const organizationSelection = needsEmployeeProfile
      ? validateDepartmentPositionPair(
          await getDepartmentPositionMap(),
          department,
          position,
        )
      : { department: null, position: null, error: null }
    if (organizationSelection.error) {
      return res.status(400).json({ success: false, message: organizationSelection.error })
    }

    // 创建用户（用户名即为显示名称）
    const userId = nanoid()
    const passwordHash = await hashPassword(password)
    const now = new Date().toISOString()
    let generatedEmployeeNo: string | null = null

    await db.transaction(async (client) => {
      // 串行化账号创建，避免用户名、手机号在并发请求中重复。
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['user-create'])
      if (needsEmployeeProfile) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['employee-number-write'])
      }

      const existingUser = await client.query<{
        username: string
        mobile: string | null
        employment_status: string | null
      }>(
        `SELECT u.username, u.mobile, ep.employment_status
         FROM users u
         LEFT JOIN employee_profiles ep ON ep.user_id = u.id
         WHERE u.username = $1 OR u.mobile = $2`,
        [normalizedUsername, normalizedMobile || null]
      )
      if (existingUser.rows.some((item) => item.username === normalizedUsername)) {
        throw new UserOperationError('用户名已存在', 409)
      }
      if (normalizedMobile && existingUser.rows.some((item) => (
        item.mobile === normalizedMobile
        && item.employment_status !== 'resigned'
      ))) {
        throw new UserOperationError('手机号已被使用', 409)
      }

      if (needsEmployeeProfile) {
        generatedEmployeeNo = await getNextAvailableEmployeeNumber(client)
      }

      await client.query(
        `INSERT INTO users (
           id, username, password_hash, name, email, mobile, role, status, department, position,
           bank_account_name, bank_account_phone, bank_name, bank_account_number, employee_no,
           force_change_password, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12,$13,$14,true,$15,$16)`,
        [
          userId, normalizedUsername, passwordHash, normalizedUsername,
          needsEmployeeProfile ? normalizedEmail : null,
          needsEmployeeProfile ? normalizedMobile : null,
          role || 'user', organizationSelection.department,
          organizationSelection.position, needsEmployeeProfile ? bankAccountName || null : null,
          needsEmployeeProfile ? bankAccountPhone || null : null,
          needsEmployeeProfile ? bankName || null : null,
          needsEmployeeProfile ? bankAccountNumber || null : null,
          generatedEmployeeNo,
          now, now,
        ]
      )

      if (!needsEmployeeProfile) return

      // 同步创建员工档案（草稿），由员工本人完善后提交。
      const profileId = nanoid()
      await client.query(
        `INSERT INTO employee_profiles (
           id, user_id, name, employee_no, department, position, email, mobile,
           employment_status, status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11)`,
        [
          profileId, userId, normalizedUsername, generatedEmployeeNo,
          organizationSelection.department, organizationSelection.position,
          normalizedEmail, normalizedMobile, nextEmploymentStatus, now, now,
        ]
      )
    })

    console.log('✅ 创建用户成功:', { userId, username: normalizedUsername, employeeNo: generatedEmployeeNo, role: role || 'user' })

    res.json({
      success: true,
      data: {
        id: userId,
        username: normalizedUsername,
        name: normalizedUsername,
        email: needsEmployeeProfile ? normalizedEmail : null,
        mobile: needsEmployeeProfile ? normalizedMobile : null,
        employeeNo: generatedEmployeeNo,
        role: role || 'user',
      },
      message: '用户创建成功',
    })
  } catch (error) {
    console.error('❌ 创建用户失败:', error)
    if (error instanceof UserOperationError) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    if ((error as { code?: string; constraint?: string }).code === '23505') {
      return res.status(409).json({ success: false, message: '员工编号已被使用' })
    }
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

    // 系统级账号不能通过普通删除入口移除。
    if (isSystemAdminEquivalentRole(user.role)) {
      return res.status(400).json({
        success: false,
        message: '不能删除超级管理员或董事长账号',
      })
    }

    // 使用事务删除用户及其关联数据
    await db.transaction(async (client) => {
      // 1. 删除用户的基础关联数据
      await txRun(client, 'DELETE FROM user_preferences WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM user_activities WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM drafts WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM calendar_events WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM worklogs WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM projects WHERE user_id = ?', id)
      await txRun(client, 'DELETE FROM user_uploaded_files WHERE user_id = ?', id)

      // 2. 删除报销相关数据（先删子表再删主表）
      await txRun(client, 'DELETE FROM reimbursement_deductions WHERE user_id = ?', id)
      const reimbursements = await txAll<{ id: string }>(client, 'SELECT id FROM reimbursements WHERE user_id = ?', id)
      for (const r of reimbursements) {
        await txRun(client, 'DELETE FROM reimbursement_invoices WHERE reimbursement_id = ?', r.id)
        await txRun(client, 'DELETE FROM reimbursement_deduction_invoices WHERE reimbursement_id = ?', r.id)
        await txRun(client, 'DELETE FROM payment_batch_items WHERE reimbursement_id = ?', r.id)
      }
      await txRun(client, 'DELETE FROM reimbursements WHERE user_id = ?', id)

      // 3. 删除该用户作为付款人的付款批次（先删批次项目再删批次）
      const paymentBatches = await txAll<{ id: string }>(client, 'SELECT id FROM payment_batches WHERE payer_id = ?', id)
      for (const b of paymentBatches) {
        await txRun(client, 'DELETE FROM payment_batch_items WHERE batch_id = ?', b.id)
      }
      await txRun(client, 'DELETE FROM payment_batches WHERE payer_id = ?', id)

      // 4. 删除审批相关数据
      const approvalInstances = await txAll<{ id: string }>(client, 'SELECT id FROM approval_instances WHERE applicant_id = ?', id)
      for (const instance of approvalInstances) {
        await txRun(client, 'DELETE FROM approval_records WHERE instance_id = ?', instance.id)
      }
      await txRun(client, 'DELETE FROM approval_instances WHERE applicant_id = ?', id)
      // 删除该用户作为审批人的记录
      await txRun(client, 'DELETE FROM approval_records WHERE approver_id = ?', id)

      // 5. 删除离职申请相关数据（作为申请人或交接人）
      const resignations = await txAll<{ id: string }>(
        client,
        'SELECT id FROM resignation_requests WHERE employee_user_id = ? OR handover_user_id = ?',
        id, id
      )
      for (const r of resignations) {
        await txRun(client, 'DELETE FROM resignation_documents WHERE request_id = ?', r.id)
        await txRun(client, 'DELETE FROM resignation_audit_logs WHERE request_id = ?', r.id)
      }
      await txRun(client, 'DELETE FROM resignation_requests WHERE employee_user_id = ? OR handover_user_id = ?', id, id)

      // 6. 删除人事档案相关数据
      const employeeProfiles = await txAll<{ id: string }>(client, 'SELECT id FROM employee_profiles WHERE user_id = ?', id)
      for (const ep of employeeProfiles) {
        await txRun(client, 'DELETE FROM employee_documents WHERE employee_id = ?', ep.id)
        const probations = await txAll<{ id: string }>(client, 'SELECT id FROM probation_confirmations WHERE employee_id = ?', ep.id)
        for (const pb of probations) {
          await txRun(client, 'DELETE FROM probation_documents WHERE confirmation_id = ?', pb.id)
        }
        await txRun(client, 'DELETE FROM probation_confirmations WHERE employee_id = ?', ep.id)
        await txRun(client, 'DELETE FROM probation_history WHERE employee_id = ?', ep.id)
      }
      await txRun(client, 'DELETE FROM employee_profiles WHERE user_id = ?', id)

      // 7. 最后删除用户
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

    // 更新密码，同时设置强制修改密码标记
    const passwordHash = await hashPassword(newPassword)
    const now = new Date().toISOString()
    await db.prepare('UPDATE users SET password_hash = ?, force_change_password = true, updated_at = ? WHERE id = ?').run(passwordHash, now, id)

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
