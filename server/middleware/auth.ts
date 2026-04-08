import { Request, Response, NextFunction } from 'express'
import { db } from '../db/index.js'

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.isLoggedIn || !req.session.userId) {
    console.log('🔒 认证失败:', {
      path: req.path,
      sessionId: req.sessionID,
      isLoggedIn: req.session.isLoggedIn,
      userId: req.session.userId,
    })
    return res.status(401).json({
      success: false,
      message: '未登录或登录已过期',
    })
  }
  next()
}

export function requireRole(roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // 确保用户已登录
    if (!req.session.userId) {
      return res.status(401).json({
        success: false,
        message: '未登录或登录已过期',
      })
    }

    try {
      // 从数据库查询用户角色
      const user = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId) as
        | { role: string }
        | undefined

      if (!user) {
        return res.status(401).json({
          success: false,
          message: '用户不存在',
        })
      }

      // 检查用户角色是否在允许的角色列表中
      if (!roles.includes(user.role)) {
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

// 快捷中间件：仅管理员
export const requireAdmin = requireRole(['super_admin', 'admin'])

// 快捷中间件：管理员或总经理
export const requireAdminOrGM = requireRole(['super_admin', 'admin', 'general_manager'])

// 快捷中间件：仅超级管理员
export const requireSuperAdmin = requireRole(['super_admin'])
