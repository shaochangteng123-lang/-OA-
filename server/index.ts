import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { initDatabase } from './db/index.js'
import { seedDatabase } from './db/seed.js'
import { initNotionClient } from './services/notion.js'
import betterSqlite3SessionStore from 'better-sqlite3-session-store'
import Database from 'better-sqlite3'

// Route imports
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT) || 3000
const NODE_ENV = process.env.NODE_ENV || 'development'

// Initialize database and seed data
console.log('Initializing database...')
initDatabase()
seedDatabase()

// Initialize Notion client
console.log('Initializing Notion client...')
initNotionClient()

// Configure session store
const SqliteStore = betterSqlite3SessionStore(session)
const sessionDb = new Database(process.env.DATABASE_PATH || './data/worklog.db')

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:8899',
    credentials: true,
  })
)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 静态文件服务 - 用于访问上传的发票文件
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

// Cookie 配置：针对开发环境和无痕模式优化
const isProduction = NODE_ENV === 'production'
const isLocalhost = process.env.FRONTEND_URL?.includes('localhost') || !process.env.FRONTEND_URL

app.use(
  session({
    store: new SqliteStore({
      client: sessionDb,
      expired: {
        clear: true,
        intervalMs: 900000, // 15 minutes
      },
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      // 开发环境或 localhost：不使用 secure，允许 HTTP
      // 生产环境且非 localhost：使用 secure，要求 HTTPS
      secure: isProduction && !isLocalhost,
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      // 开发环境使用 'lax' 以支持无痕模式
      // 生产环境使用 'lax' 以支持飞书 OAuth 重定向
      sameSite: 'lax' as const,
      // 开发环境：设置域名以支持无痕模式
      ...(isLocalhost && !isProduction ? { domain: undefined } : {}),
    },
  })
)

// API Routes
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
  })
})

// Video download endpoint
app.get('/api/videos/:filename', (req, res) => {
  const filename = req.params.filename
  // 防止路径遍历攻击
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ success: false, message: 'Invalid filename' })
  }
  
  // 在开发环境和生产环境中都支持
  const videosPath = NODE_ENV === 'production' 
    ? path.join(__dirname, '..', '..', 'videos')  // 生产环境: /app/dist/server -> /app/videos
    : path.join(process.cwd(), 'videos')  // 开发环境: 项目根目录/videos
  
  const filePath = path.join(videosPath, filename)
  
  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Video not found' })
  }
  
  // 设置下载头
  res.setHeader('Content-Type', 'video/mp4')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  
  // 发送文件
  res.sendFile(path.resolve(filePath))
})

// Serve static files in production
if (NODE_ENV === 'production') {
  // In production, __dirname is /app/dist/server, so we need to go up one level to /app/dist
  const distPath = path.join(__dirname, '..')
  app.use(express.static(distPath))

  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
}

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Global error handler:', err)
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: NODE_ENV === 'development' ? err.message : undefined,
  })
})

// 月末自动清除报销数据（软删除非当月数据，历史数据在报销统计中仍可查看）
const setupReimbursementCleanup = () => {
  const runCleanup = async () => {
    try {
      const now = new Date()
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      // 判断是否是当月最后一天（明天是下个月1号）
      if (tomorrow.getDate() !== 1) return

      const { db } = await import('./db/index.js')
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const cleanupTime = now.toISOString()

      // 软删除当月之前的未删除报销数据
      const result = db.prepare(
        'UPDATE reimbursements SET is_deleted = 1, deleted_at = ?, updated_at = ? WHERE created_at < ? AND (is_deleted IS NULL OR is_deleted = 0)'
      ).run(cleanupTime, cleanupTime, firstDayOfMonth)

      if (result.changes > 0) {
        console.log(`✅ 月末清除：已软删除 ${result.changes} 条历史报销数据`)
      }
    } catch (error) {
      console.error('月末清除报销数据失败:', error)
    }
  }

  // 每天凌晨 23:55 检查一次
  const scheduleCheck = () => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 55, 0)
    let delay = target.getTime() - now.getTime()
    if (delay < 0) {
      // 已过今天的检查时间，安排明天
      delay += 24 * 60 * 60 * 1000
    }
    setTimeout(() => {
      runCleanup()
      // 之后每24小时执行一次
      setInterval(runCleanup, 24 * 60 * 60 * 1000)
    }, delay)
  }

  scheduleCheck()
  console.log('✅ 月末报销数据自动清除任务已启动')
}

setupReimbursementCleanup()

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is running on port ${PORT}`)
  console.log(`✅ Environment: ${NODE_ENV}`)
  console.log(`✅ Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:8899'}`)
  console.log(`✅ Database: ${process.env.DATABASE_PATH || './data/worklog.db'}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server')
  process.exit(0)
})
