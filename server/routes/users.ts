import express from 'express'
import { db } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import type { UserRow, UserActivityRow } from '../types/database.js'

const router = express.Router()

// 获取用户列表（简化版，用于日历用户选择器）
router.get('/list', requireAuth, (req, res) => {
  try {
    const currentUserId = req.session.userId

    // 检查权限：只有 super_admin 和 admin 可以查看用户列表
    const currentUser = db
      .prepare('SELECT role FROM users WHERE id = ?')
      .get(currentUserId) as { role: string } | undefined

    if (!currentUser || !['super_admin', 'admin'].includes(currentUser.role)) {
      return res.status(403).json({
        success: false,
        message: '无权查看用户列表',
      })
    }

    // 只返回激活状态的用户
    const users = db
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
router.get('/', requireAuth, (req, res) => {
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

    const users = db.prepare(query).all(...params) as UserRow[]

    // 转换数据格式，移除敏感信息
    const result = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      avatarUrl: user.avatar_url,
      role: user.role,
      status: user.status,
      department: user.department,
      position: user.position,
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
router.post('/', requireAuth, (req, res) => {
  try {
    const { id, role, status, department, position } = req.body
    const now = new Date().toISOString()

    if (!id) {
      return res.status(400).json({
        success: false,
        message: '缺少用户ID',
      })
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id)

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在',
      })
    }

    db.prepare(
      `
      UPDATE users
      SET role = ?, status = ?, department = ?, position = ?, updated_at = ?
      WHERE id = ?
    `
    ).run(role, status, department || null, position || null, now, id)

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
router.get('/activities', requireAuth, (req, res) => {
  try {
    const { userId, limit = 100 } = req.query
    const currentUserId = req.session.userId

    let query = 'SELECT * FROM user_activities WHERE user_id = ?'
    const params: unknown[] = [userId || currentUserId]

    query += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(Number(limit))

    const activities = db.prepare(query).all(...params) as UserActivityRow[]

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

export default router
