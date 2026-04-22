import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { db, initDatabase, pool } from './db/index.js'
import { seedDatabase } from './db/seed.js'
import { initNotionClient } from './services/notion.js'

import authRoutes from './routes/auth.js'
import projectsRoutes from './routes/projects.js'
import worklogsRoutes from './routes/worklogs.js'
import calendarRoutes from './routes/calendar.js'
import eventLibraryRoutes from './routes/event-library.js'
import eventPresetsRoutes from './routes/event-presets.js'
import blocksRoutes from './routes/blocks.js'
import usersRoutes from './routes/users.js'
import departmentsRoutes from './routes/departments.js'
import draftsRoutes from './routes/drafts.js'
import userPreferencesRoutes from './routes/user-preferences.js'
import holidaysRoutes from './routes/holidays.js'
import reimbursementRoutes from './routes/reimbursement.js'
import reimbursementScopeRoutes from './routes/reimbursement-scope.js'
import approvalRoutes from './routes/approval.js'
import employeesRoutes from './routes/employees.js'
import probationRoutes from './routes/probation.js'
import resignationRoutes from './routes/resignation.js'
import filesRoutes from './routes/files.js'
import leaveRoutes from './routes/leave.js'
import bankReceiptsRoutes from './routes/bank-receipts.js'
import { shutdownOcrDaemon } from './services/ocrDaemon.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT) || 3000
const NODE_ENV = process.env.NODE_ENV || 'development'

const isProduction = NODE_ENV === 'production'
const isLocalhost = process.env.FRONTEND_URL?.includes('localhost') || !process.env.FRONTEND_URL
const isHttps = process.env.FRONTEND_URL?.startsWith('https://')

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:8899',
    credentials: true,
  })
)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
// 已移除静态目录暴露，改用受控下载接口 /api/files

const PgStore = connectPgSimple(session)

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isHttps === true,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      sameSite: 'lax' as const,
      ...(isLocalhost && !isProduction ? { domain: undefined } : {}),
    },
  })
)

app.use('/api/auth', authRoutes)
app.use('/api/projects', projectsRoutes)
app.use('/api/worklogs', worklogsRoutes)
app.use('/api/calendar', calendarRoutes)
app.use('/api/event-library', eventLibraryRoutes)
app.use('/api/event-presets', eventPresetsRoutes)
app.use('/api/blocks', blocksRoutes)
app.use('/api/users', usersRoutes)
app.use('/api/departments', departmentsRoutes)
app.use('/api/drafts', draftsRoutes)
app.use('/api/user-preferences', userPreferencesRoutes)
app.use('/api/holidays', holidaysRoutes)
app.use('/api/reimbursement', reimbursementRoutes)
app.use('/api/reimbursement-scope', reimbursementScopeRoutes)
app.use('/api/approval', approvalRoutes)
app.use('/api/employees', employeesRoutes)
app.use('/api/probation', probationRoutes)
app.use('/api/resignation', resignationRoutes)
app.use('/api/files', filesRoutes)
app.use('/api/leave', leaveRoutes)
app.use('/api/bank-receipts', bankReceiptsRoutes)

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() })
})

app.get('/api/videos/:filename', (req, res) => {
  const filename = req.params.filename
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ success: false, message: 'Invalid filename' })
  }

  const videosPath = NODE_ENV === 'production'
    ? path.join(__dirname, '..', '..', 'videos')
    : path.join(process.cwd(), 'videos')

  const filePath = path.join(videosPath, filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Video not found' })
  }

  res.setHeader('Content-Type', 'video/mp4')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.sendFile(path.resolve(filePath))
})

if (NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..')
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Global error handler:', err)
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: NODE_ENV === 'development' ? err.message : undefined,
  })
})

const setupReimbursementCleanup = () => {
  const runCleanup = async () => {
    try {
      const now = new Date()
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      if (tomorrow.getDate() !== 1) return

      // 只归档已完成/已拒绝且超过 90 天的报销单
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
      const cleanupTime = now.toISOString()

      const result = await db.run(
        `UPDATE reimbursements
         SET is_deleted = TRUE, deleted_at = ?, updated_at = ?
         WHERE status IN ('completed', 'rejected')
         AND created_at < ?
         AND COALESCE(is_deleted, FALSE) = FALSE`,
        cleanupTime,
        cleanupTime,
        ninetyDaysAgo
      )

      if (result.changes > 0) {
        console.log(`✅ 月末归档：已归档 ${result.changes} 条历史报销数据（已完成/已拒绝且超过90天）`)
      }
    } catch (error) {
      console.error('月末归档报销数据失败:', error)
    }
  }

  const scheduleCheck = () => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 55, 0)
    let delay = target.getTime() - now.getTime()
    if (delay < 0) delay += 24 * 60 * 60 * 1000
    setTimeout(() => {
      void runCleanup()
      setInterval(() => {
        void runCleanup()
      }, 24 * 60 * 60 * 1000)
    }, delay)
  }

  scheduleCheck()
  console.log('✅ 月末报销数据自动归档任务已启动（归档已完成/已拒绝且超过90天的报销单）')
}

/**
 * 每年 1 月 1 日 00:05 重置假期余额：为所有活跃用户初始化新一年的余额记录
 * 不删除历史年份数据，仅为新年度插入初始余额（不覆盖已存在的记录）
 */
const setupLeaveBalanceReset = () => {
  const runReset = async () => {
    try {
      const now = new Date()
      // 只在 1 月 1 日执行
      if (now.getMonth() !== 0 || now.getDate() !== 1) return

      const year = now.getFullYear()
      console.log(`📅 开始初始化 ${year} 年假期余额...`)

      // 获取所有活跃用户
      const users = await db.prepare(`SELECT id FROM users WHERE status = 'active'`).all<{ id: string }>()
      // 获取所有活跃假期类型
      const types = await db.prepare(`SELECT code, default_days FROM leave_type_configs WHERE is_active = true`).all<{ code: string; default_days: number }>()

      let initialized = 0
      let updated = 0
      const nowStr = now.toISOString()

      for (const user of users) {
        for (const type of types) {
          let totalDays = Number(type.default_days ?? 0)
          if (type.code === 'annual') {
            const { calculateAnnualLeaveDays } = await import('./services/leaveCalculator.js')
            const profile = await db.prepare(`SELECT hire_date FROM employee_profiles WHERE user_id = ? AND status = 'submitted'`).get<{ hire_date: string | null }>(user.id)
            totalDays = profile?.hire_date ? calculateAnnualLeaveDays(profile.hire_date, year) : 0
          }

          const existing = await db.prepare(`SELECT id FROM leave_balances WHERE user_id = ? AND leave_type_code = ? AND year = ?`).get(user.id, type.code, year)
          if (existing) {
            // 已存在记录：重置已用天数和待审批天数，重新计算总天数（确保真正清零）
            await db.prepare(`UPDATE leave_balances SET total_days = ?, used_days = 0, pending_days = 0, updated_at = ? WHERE user_id = ? AND leave_type_code = ? AND year = ?`).run(totalDays, nowStr, user.id, type.code, year)
            updated++
          } else {
            const { nanoid } = await import('nanoid')
            await db.prepare(`INSERT INTO leave_balances (id, user_id, leave_type_code, year, total_days, used_days, pending_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`).run(nanoid(), user.id, type.code, year, totalDays, nowStr, nowStr)
            initialized++
          }
        }
      }

      console.log(`✅ ${year} 年假期余额重置完成：新建 ${initialized} 条，更新清零 ${updated} 条`)
    } catch (error) {
      console.error('假期余额年度重置失败:', error)
    }
  }

  // 每天 00:05 检查一次，只在 1 月 1 日执行重置
  const scheduleReset = () => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 5, 0)
    let delay = target.getTime() - now.getTime()
    if (delay < 0) delay += 24 * 60 * 60 * 1000
    setTimeout(() => {
      void runReset()
      setInterval(() => {
        void runReset()
      }, 24 * 60 * 60 * 1000)
    }, delay)
  }

  scheduleReset()
  console.log('✅ 假期余额年度重置任务已启动（每年 1 月 1 日 00:05 自动执行）')
}

async function start() {
  console.log('Initializing database...')
  await initDatabase()
  await seedDatabase()

  console.log('Initializing Notion client...')
  initNotionClient()

  setupReimbursementCleanup()
  setupLeaveBalanceReset()

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server is running on port ${PORT}`)
    console.log(`✅ Environment: ${NODE_ENV}`)
    console.log(`✅ Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:8899'}`)
    console.log(`✅ Database: ${process.env.DATABASE_URL || `postgresql://${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'yulilog_worklog'}`}`)
  })
}

void start().catch((error) => {
  console.error('❌ 服务启动失败:', error)
  process.exit(1)
})

async function gracefulShutdown(signal: string) {
  console.log(`${signal} signal received: closing HTTP server`)
  shutdownOcrDaemon()
  // 强制终止所有连接，不等待查询完成（防止 tsx watch 超时后留下僵尸事务）
  try {
    const clients = (pool as any)._clients as Set<any> | undefined
    if (clients) {
      for (const client of clients) {
        try { client.end() } catch {}
      }
    }
  } catch {}
  try { await Promise.race([pool.end(), new Promise(r => setTimeout(r, 2000))]) } catch {}
  process.exit(0)
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => void gracefulShutdown('SIGINT'))
