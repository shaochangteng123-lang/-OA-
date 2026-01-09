import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import session from 'express-session'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDatabase } from './db/index.js'
import { seedDatabase } from './db/seed.js'
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000
const NODE_ENV = process.env.NODE_ENV || 'development'

// Initialize database and seed data
console.log('Initializing database...')
initDatabase()
seedDatabase()

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
      // Only require HTTPS in production when not on localhost
      secure: NODE_ENV === 'production' && !process.env.FRONTEND_URL?.includes('localhost'),
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      sameSite: 'lax', // Allows cookie to be sent on redirects from external sites (like Feishu)
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
  })
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

// Start server
app.listen(PORT, () => {
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
