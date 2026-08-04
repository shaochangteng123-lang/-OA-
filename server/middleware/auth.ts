import { Request, Response, NextFunction } from 'express'
import { db } from '../db/index.js'
import {
  isBossRequestAllowed,
  isRoleAllowed,
} from '../utils/boss-role.js'
import { LEAVE_APPROVER_ROLES } from '../utils/leave-approval.js'

interface AuthenticatedUser {
  id: string
  name: string
  email: string | null
  role: string
  avatar_url: string | null
  status: string
  force_change_password: boolean
}

async function destroyInvalidSession(req: Request, res: Response) {
  await new Promise<void>((resolve) => {
    req.session.destroy(() => resolve())
  })
  res.clearCookie('connect.sid', { path: '/' })
}

async function loadActiveUser(req: Request, res: Response): Promise<AuthenticatedUser | null> {
  const userId = req.session.userId || req.session.user?.id
  const isLoggedIn = req.session.isLoggedIn || !!req.session.user?.id
  if (!isLoggedIn || !userId) {
    console.log('🔒 认证失败:', {
      path: req.path,
      sessionId: req.sessionID,
      isLoggedIn: req.session.isLoggedIn,
      userId: req.session.userId,
    })
    res.status(401).json({
      success: false,
      message: '未登录或登录已过期',
    })
    return null
  }

  const user = await db.prepare(`
    SELECT id, name, email, role, avatar_url, status, force_change_password
    FROM users
    WHERE id = ?
  `).get(userId) as AuthenticatedUser | undefined

  if (!user || user.status !== 'active') {
    await destroyInvalidSession(req, res)
    res.status(401).json({
      success: false,
      message: user ? '账号已被禁用，请联系管理员' : '用户不存在或已被删除',
      code: user ? 'ACCOUNT_INACTIVE' : 'USER_NOT_FOUND',
    })
    return null
  }

  // 每次请求同步数据库中的最新身份，避免角色变更后旧会话继续沿用。
  req.session.isLoggedIn = true
  req.session.userId = user.id
  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar_url: user.avatar_url,
    forceChangePassword: user.force_change_password,
  }

  return user
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await loadActiveUser(req, res)
    if (!user) return
    next()
  } catch (error) {
    console.error('认证检查失败:', error)
    return res.status(500).json({
      success: false,
      message: '认证检查失败',
    })
  }
}

export function requireRole(roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await loadActiveUser(req, res)
      if (!user) return

      // 检查用户角色是否在允许的角色列表中
      if (!isRoleAllowed(user.role, roles)) {
        console.log('🔒 权限不足:', {
          path: req.path,
          userId: req.session.userId,
          userRole: user.role,
          requiredRoles: roles,
        })
        return res.status(403).json({
          success: false,
          message: '权限不足',
        })
      }

      next()
    } catch (error) {
      console.error('❌ 权限检查失败:', error)
      return res.status(500).json({
        success: false,
        message: '权限检查失败',
      })
    }
  }
}

// BOSS角色只负责经营查看，禁止直接修改业务数据。
export async function blockBossBusinessMutations(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (isBossRequestAllowed(req.method, req.path)) {
    next()
    return
  }

  const userId = req.session.userId || req.session.user?.id
  if (!userId) {
    next()
    return
  }

  try {
    const user = await db.prepare(
      'SELECT role, status FROM users WHERE id = ?',
    ).get(userId) as { role: string; status: string } | undefined

    if (!user || user.status !== 'active' || user.role !== 'boss') {
      next()
      return
    }

    res.status(403).json({
      success: false,
      code: 'BOSS_READ_ONLY',
      message: 'BOSS角色仅可查看经营数据，不能修改业务数据',
    })
  } catch (error) {
    console.error('BOSS只读权限检查失败:', error)
    res.status(500).json({
      success: false,
      message: 'BOSS只读权限检查失败',
    })
  }
}

// 快捷中间件：仅管理员
export const requireAdmin = requireRole(['super_admin', 'admin'])

// 快捷中间件：管理员或总经理
export const requireAdminOrGM = requireRole(['super_admin', 'admin', 'general_manager'])

// 快捷中间件：仅总经理
export const requireGeneralManager = requireRole(['general_manager'])

// 快捷中间件：请假审批人（总经理或董事长）
export const requireLeaveApprover = requireRole([...LEAVE_APPROVER_ROLES])

// 快捷中间件：总经理或超级管理员
export const requireGMOrSuperAdmin = requireRole(['super_admin', 'general_manager'])

// 快捷中间件：仅超级管理员
export const requireSuperAdmin = requireRole(['super_admin'])
