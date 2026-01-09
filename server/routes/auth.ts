import { Router } from 'express'
import { db } from '../db/index.js'
import { nanoid } from 'nanoid'
import type { User } from '../types/database.js'
import { getAccessTokenByCode, getUserInfo } from '../services/feishu.js'
import { readFileSync } from 'fs'
import { join } from 'path'

const router = Router()

// 加载管理员配置
function loadAdminConfig() {
  try {
    const configPath = join(process.cwd(), 'server', 'config', 'admins.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    return {
      superAdmins: (config.superAdmins || []).map((admin: { name: string }) => admin.name),
      admins: (config.admins || []).map((admin: { name: string }) => admin.name),
    }
  } catch (error) {
    console.error('❌ 加载管理员配置失败:', error)
    return { superAdmins: [], admins: [] }
  }
}

// 根据用户名确定角色
function determineUserRole(userName: string): string {
  const adminConfig = loadAdminConfig()
  
  if (adminConfig.superAdmins.includes(userName)) {
    return 'super_admin'
  }
  if (adminConfig.admins.includes(userName)) {
    return 'admin'
  }
  return 'user'
}

// 飞书登录
router.get('/login', (req, res) => {
  const { redirect } = req.query
  const redirectUri = process.env.FEISHU_REDIRECT_URI || ''

  console.log('🔐 飞书登录请求:', {
    appId: process.env.FEISHU_APP_ID,
    redirectUri,
    state: redirect || '/'
  })

  // 构建飞书OAuth URL - redirect_uri 不编码,直接使用
  const feishuAuthUrl = `https://open.feishu.cn/open-apis/authen/v1/index?app_id=${process.env.FEISHU_APP_ID}&redirect_uri=${redirectUri}&state=${redirect || '/'}`

  console.log('🔗 重定向到飞书:', feishuAuthUrl)
  res.redirect(feishuAuthUrl)
})

// 飞书回调
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query
    console.log('🔐 登录回调:', { code: !!code, state })

    if (!code) {
      console.error('❌ 缺少授权码')
      return res.redirect('/?error=no_code')
    }

    // 使用code换取access_token
    let accessToken: string
    try {
      accessToken = await getAccessTokenByCode(code as string)
      console.log('✅ 获取访问令牌成功')
    } catch (error) {
      console.error('❌ 获取访问令牌失败:', error)
      return res.redirect('/?error=token_failed')
    }

    // 获取用户信息
    let feishuUser: { open_id: string; union_id: string; name: string; email: string; avatar_url: string }
    try {
      feishuUser = await getUserInfo(accessToken)
      console.log('✅ 获取用户信息成功:', feishuUser.name)
    } catch (error) {
      console.error('❌ 获取用户信息失败:', error)
      return res.redirect('/?error=user_info_failed')
    }

    // 确定用户角色
    const userRole = determineUserRole(feishuUser.name)
    console.log(`👤 用户角色: ${userRole}`)

    // 查找或创建用户
    let user = db.prepare('SELECT * FROM users WHERE feishu_open_id = ?').get(feishuUser.open_id) as User | undefined
    const now = new Date().toISOString()

    if (!user) {
      const userId = nanoid()
      console.log('👤 创建新用户:', feishuUser.name)

      db.prepare(`
        INSERT INTO users (id, feishu_open_id, feishu_union_id, name, email, avatar_url, role, status, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        feishuUser.open_id,
        feishuUser.union_id,
        feishuUser.name,
        feishuUser.email,
        feishuUser.avatar_url,
        userRole,
        'active',
        now,
        now,
        now
      )

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined
    } else {
      console.log('👤 用户已存在:', user.name)
      
      // 更新用户信息和角色（根据配置文件）
      const adminConfig = loadAdminConfig()
      let newRole = userRole
      
      // 如果配置文件中的角色有变化，更新角色
      if (adminConfig.superAdmins.includes(feishuUser.name) && user.role !== 'super_admin') {
        newRole = 'super_admin'
      } else if (adminConfig.admins.includes(feishuUser.name) && user.role !== 'admin') {
        newRole = 'admin'
      } else if (!adminConfig.superAdmins.includes(feishuUser.name) && !adminConfig.admins.includes(feishuUser.name) && user.role !== 'user') {
        newRole = 'user'
      }

      // 更新用户信息
      db.prepare(`
        UPDATE users 
        SET name = ?, email = ?, avatar_url = ?, role = ?, updated_at = ?, last_login_at = ?
        WHERE id = ?
      `).run(
        feishuUser.name,
        feishuUser.email,
        feishuUser.avatar_url,
        newRole,
        now,
        now,
        user.id
      )

      // 重新获取用户信息
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as User | undefined
    }

    if (!user) {
      console.error('❌ 用户创建失败')
      return res.status(500).json({ success: false, message: '用户创建失败' })
    }

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

      // 强制保存 session
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error('❌ Session 保存失败:', err)
            reject(err)
          } else {
            console.log('✅ Session 已保存:', { userId: user?.id, userName: user?.name })
            resolve()
          }
        })
      })
    }

    const redirectUrl = (state as string) || '/'
    console.log('🔄 重定向到:', redirectUrl)
    res.redirect(redirectUrl)
  } catch (error) {
    console.error('❌ 登录回调失败:', error)
    res.redirect('/?error=callback_failed')
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
