/**
 * 认证路由
 * 账号密码登录系统
 */

import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import type { User } from '../types/database.js'
import { verifyPassword, hashPassword, validatePasswordStrength } from '../utils/password.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// 账号密码登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    // 验证输入
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '请输入用户名和密码',
      })
    }

    // 查找用户
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined

    if (!user) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误',
      })
    }

    // 检查用户状态
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: '账号已被禁用，请联系管理员',
      })
    }

    // 检查是否设置了密码
    if (!user.password_hash) {
      return res.status(401).json({
        success: false,
        message: '账号未设置密码，请联系管理员重置密码',
      })
    }

    // 验证密码
    const isPasswordValid = await verifyPassword(password, user.password_hash)
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误',
      })
    }

    // 更新最后登录时间
    const now = new Date().toISOString()
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, user.id)

    // 设置session
    if (req.session) {
      req.session.isLoggedIn = true
      req.session.userId = user.id
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email || '',
        avatar_url: user.avatar_url,
        role: user.role,
      }

      // 保存session
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error('❌ Session 保存失败:', err)
            reject(err)
          } else {
            console.log('✅ 登录成功:', { userId: user.id, userName: user.name, role: user.role })
            resolve()
          }
        })
      })
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatar_url: user.avatar_url,
          role: user.role,
        },
      },
      message: '登录成功',
    })
  } catch (error) {
    console.error('❌ 登录失败:', error)
    res.status(500).json({
      success: false,
      message: '登录失败，请稍后重试',
    })
  }
})

// 修改密码
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    const userId = req.session?.userId

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    // 验证输入
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: '请输入当前密码和新密码',
      })
    }

    // 验证新密码强度
    const passwordValidation = validatePasswordStrength(newPassword)
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      })
    }

    // 获取用户
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在',
      })
    }

    // 验证当前密码
    if (!user.password_hash) {
      return res.status(400).json({
        success: false,
        message: '账号未设置密码',
      })
    }

    const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password_hash)
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: '当前密码错误',
      })
    }

    // 更新密码
    const newPasswordHash = await hashPassword(newPassword)
    const now = new Date().toISOString()
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(newPasswordHash, now, userId)

    console.log('✅ 密码修改成功:', { userId, userName: user.name })

    res.json({
      success: true,
      message: '密码修改成功',
    })
  } catch (error) {
    console.error('❌ 修改密码失败:', error)
    res.status(500).json({
      success: false,
      message: '修改密码失败，请稍后重试',
    })
  }
})

// 检查会话
router.get('/session', (req, res) => {
  if (req.session?.userId) {
    res.json({
      success: true,
      data: {
        isLoggedIn: true,
        user: req.session.user,
      },
    })
  } else {
    res.json({
      success: true,
      data: {
        isLoggedIn: false,
      },
    })
  }
})

// 获取当前用户信息（用于前端 auth store）
router.get('/user', (req, res) => {
  console.log('📋 检查用户会话:', {
    hasSession: !!req.session,
    userId: req.session?.userId,
    userName: req.session?.user?.name
  })

  if (req.session?.userId && req.session?.user) {
    res.json({
      success: true,
      data: req.session.user,
    })
  } else {
    res.status(401).json({
      success: false,
      message: '未登录',
    })
  }
})

// 登出
router.post('/logout', (req, res) => {
  req.session?.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: '登出失败',
      })
    }
    res.json({
      success: true,
      message: '登出成功',
    })
  })
})

export default router
