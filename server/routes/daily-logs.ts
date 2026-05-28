import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import archiver from 'archiver'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { requireAuth, requireAdminOrGM } from '../middleware/auth.js'
import { chat, isLLMConfigured } from '../services/llm.js'
import { sendConvertedPdf, CONVERTIBLE_EXT } from '../utils/doc-preview.js'

const router = Router()

export type EditPermission = 'free' | 'edit' | 'supplement' | 'locked'

/**
 * 判断某日期日志的编辑权限
 * - free: 当天，自由编辑草稿
 * - edit: T+1（严格日历次日），可直接修改原文
 * - supplement: T+2 ~ 周报锁定前，只能追加补充
 * - locked: 周报已形成，不可编辑
 */
export async function getEditPermission(logDate: string, userId: string): Promise<EditPermission> {
  // 计算 logDate 所属周的周一
  const d = new Date(logDate + 'T00:00:00')
  const dayOfWeek = d.getDay() || 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - dayOfWeek + 1)
  const weekStart = monday.toISOString().slice(0, 10)

  // 检查该周周报是否已锁定
  const summary = await db.get<{ locked_at: string | null }>(
    `SELECT locked_at FROM weekly_summaries WHERE user_id = ? AND week_start = ?`,
    userId, weekStart,
  )
  if (summary?.locked_at) return 'locked'

  // 该周周日 23:59:59 已过，视为锁定（即使定时任务未触发）
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  if (new Date() > sunday) return 'locked'

  // 计算日历天数差
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const todayDate = new Date(todayStr + 'T00:00:00')
  const logDateObj = new Date(logDate + 'T00:00:00')
  const diffDays = Math.floor((todayDate.getTime() - logDateObj.getTime()) / (24 * 60 * 60 * 1000))

  if (diffDays <= 0) return 'free'
  if (diffDays === 1) return 'edit'
  return 'supplement'
}

const dailyLogUploadsDir = path.resolve(process.cwd(), 'uploads/daily-logs')
if (!fs.existsSync(dailyLogUploadsDir)) {
  fs.mkdirSync(dailyLogUploadsDir, { recursive: true })
}

const uploadAttachment = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dateDir = new Date().toISOString().slice(0, 10)
      const destDir = path.join(dailyLogUploadsDir, dateDir)
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
      cb(null, destDir)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname)
      const base = path.basename(file.originalname, ext).replace(/[^\w一-鿿-]/g, '_').slice(0, 40)
      cb(null, `${base}-${Date.now()}-${nanoid(6)}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]
    const allowedExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx']
    const ext = (file.originalname.split('.').pop() || '').toLowerCase()
    if (!allowedMimes.includes(file.mimetype) && !allowedExts.includes(ext)) {
      return cb(new Error('仅支持图片(JPG/PNG/GIF/WebP)和文档(PDF/Word/Excel)'))
    }
    cb(null, true)
  },
})

// 北京限号规则（每13周轮换一次）
// 返回限行尾号字符串，不限行返回 '不限行'
async function getTrafficRestriction(date: Date): Promise<string> {
  const day = date.getDay()

  // 周六日不限行
  if (day === 0 || day === 6) return '不限行'

  // 查询 holidays 表：当天是法定节假日则不限行，调休工作日则正常限行
  const dateStr = date.toISOString().slice(0, 10)
  const holiday = await db.get<{ type: string }>('SELECT type FROM holidays WHERE date = ?', dateStr)
  if (holiday && holiday.type === 'holiday') return '不限行'

  // 周一~周五对应 day=1~5，每个周期固定顺序：周一、周二、周三、周四、周五
  // 2025.10.06 ~ 2026.01.04: 2和7, 3和8, 4和9, 5和0, 1和6
  // 2026.01.05 ~ 2026.03.29: 5和0, 1和6, 2和7, 3和8, 4和9
  // 2026.03.30 ~ 2026.06.28: 2和7, 3和8, 4和9, 5和0, 1和6
  // 2026.06.29 ~ 2026.09.27: 5和0, 1和6, 2和7, 3和8, 4和9

  const rotations = [
    ['2和7', '3和8', '4和9', '5和0', '1和6'],
    ['5和0', '1和6', '2和7', '3和8', '4和9'],
  ]

  const periods = [
    { start: new Date('2025-10-06'), end: new Date('2026-01-04'), rotation: 0 },
    { start: new Date('2026-01-05'), end: new Date('2026-03-29'), rotation: 1 },
    { start: new Date('2026-03-30'), end: new Date('2026-06-28'), rotation: 0 },
    { start: new Date('2026-06-29'), end: new Date('2026-09-27'), rotation: 1 },
  ]

  const period = periods.find(p => date >= p.start && date <= p.end)
  if (!period) return '不限行'

  return rotations[period.rotation][day - 1] || '不限行'
}

// 天气缓存
let weatherCache: { date: string; data: any } | null = null

async function getWeatherInfo(): Promise<{ text: string; temp: string; icon: string } | null> {
  const today = new Date().toISOString().slice(0, 10)
  if (weatherCache && weatherCache.date === today) return weatherCache.data

  try {
    // 使用 wttr.in 免费天气 API（无需 key）
    const { default: axios } = await import('axios')
    const resp = await axios.get('https://wttr.in/Beijing?format=j1', { timeout: 5000 })
    const current = resp.data?.current_condition?.[0]
    if (current) {
      const engDesc = (current.weatherDesc?.[0]?.value || '').trim()
      let zhDesc = WEATHER_ZH[engDesc]
      if (!zhDesc) {
        const key = Object.keys(WEATHER_ZH).find(k => engDesc.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(engDesc.toLowerCase()))
        zhDesc = key ? WEATHER_ZH[key] : engDesc || '未知'
      }
      const data = {
        text: zhDesc,
        temp: `${current.temp_C}°C`,
        icon: getWeatherIcon(current.weatherCode),
      }
      weatherCache = { date: today, data }
      return data
    }
  } catch {
    // 天气获取失败不影响主流程
  }
  return null
}

function getWeatherIcon(code: string): string {
  const c = Number(code)
  if (c === 113) return 'sunny'
  if (c === 116) return 'partly-cloudy'
  if ([119, 122].includes(c)) return 'cloudy'
  if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 311, 314, 353, 356, 359].includes(c)) return 'rainy'
  if ([179, 182, 185, 227, 230, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377, 392, 395].includes(c)) return 'snowy'
  if ([200, 386, 389].includes(c)) return 'thunderstorm'
  return 'cloudy'
}

const WEATHER_ZH: Record<string, string> = {
  'Sunny': '晴',
  'Clear': '晴',
  'Partly cloudy': '多云',
  'Partly Cloudy': '多云',
  'Cloudy': '阴',
  'Overcast': '阴天',
  'Mist': '薄雾',
  'Fog': '雾',
  'Freezing fog': '冻雾',
  'Patchy rain possible': '局部有雨',
  'Patchy rain nearby': '局部有雨',
  'Patchy snow possible': '局部有雪',
  'Patchy snow nearby': '局部有雪',
  'Blowing snow': '吹雪',
  'Blizzard': '暴风雪',
  'Thundery outbreaks possible': '可能有雷暴',
  'Light rain': '小雨',
  'Moderate rain': '中雨',
  'Heavy rain': '大雨',
  'Light snow': '小雪',
  'Moderate snow': '中雪',
  'Heavy snow': '大雪',
  'Light sleet': '小冻雨',
  'Moderate or heavy sleet': '冻雨',
  'Light rain shower': '阵雨',
  'Moderate or heavy rain shower': '大阵雨',
  'Torrential rain shower': '暴雨',
  'Light snow showers': '阵雪',
  'Moderate or heavy snow showers': '大阵雪',
  'Patchy light rain': '局部小雨',
  'Patchy light snow': '局部小雪',
  'Thunderstorm': '雷暴',
  'Patchy light drizzle': '局部毛毛雨',
  'Light drizzle': '毛毛雨',
  'Freezing drizzle': '冻毛毛雨',
  'Heavy freezing drizzle': '强冻毛毛雨',
  'Light freezing rain': '小冻雨',
  'Moderate or heavy freezing rain': '冻雨',
  'Ice pellets': '冰粒',
  'Light showers of ice pellets': '小冰粒阵',
  'Moderate or heavy showers of ice pellets': '冰粒阵',
  'Patchy light rain with thunder': '局部雷阵雨',
  'Moderate or heavy rain with thunder': '雷阵雨',
  'Patchy light snow with thunder': '局部雷雪',
  'Moderate or heavy snow with thunder': '雷雪',
}

/**
 * 获取今日信息（天气+限号）
 */
router.get('/info', requireAuth, async (_req, res) => {
  try {
    const today = new Date()
    const weather = await getWeatherInfo()
    const restriction = await getTrafficRestriction(today)
    res.json({ success: true, data: { weather, trafficRestriction: restriction } })
  } catch (err) {
    console.error('获取今日信息失败:', err)
    res.json({ success: true, data: { weather: null, trafficRestriction: null } })
  }
})

/**
 * 获取今日日志（草稿）
 */
router.get('/today', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const today = new Date().toISOString().slice(0, 10)

    let log = await db.get<any>(
      `SELECT * FROM daily_logs WHERE user_id = ? AND log_date = ?`,
      userId, today,
    )

    if (!log) {
      const id = nanoid()
      const now = new Date().toISOString()
      await db.run(
        `INSERT INTO daily_logs (id, user_id, log_date, content, status, created_at, updated_at)
         VALUES (?, ?, ?, '', 'draft', ?, ?)`,
        id, userId, today, now, now,
      )
      log = { id, user_id: userId, log_date: today, content: '', status: 'draft', weather: null, traffic_restriction: null, created_at: now, updated_at: now }
    }

    const attachments = await db.all<any>(
      `SELECT * FROM daily_log_attachments WHERE daily_log_id = ? ORDER BY created_at ASC`,
      log.id,
    )

    res.json({
      success: true,
      data: {
        id: log.id,
        logDate: log.log_date,
        content: log.content,
        status: log.status,
        weather: log.weather,
        trafficRestriction: log.traffic_restriction,
        createdAt: log.created_at,
        updatedAt: log.updated_at,
        attachments: attachments.map((a: any) => ({
          id: a.id,
          fileKind: a.file_kind,
          fileName: a.file_name,
          filePath: a.file_path,
          fileSize: a.file_size,
          mimeType: a.mime_type,
          createdAt: a.created_at,
        })),
      },
    })
  } catch (err) {
    console.error('获取今日日志失败:', err)
    res.status(500).json({ success: false, message: '获取今日日志失败' })
  }
})

/**
 * 暂存日志
 */
router.post('/save', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { content, logDate } = req.body
    const date = logDate || new Date().toISOString().slice(0, 10)
    const now = new Date().toISOString()

    const existing = await db.get<any>(
      `SELECT id FROM daily_logs WHERE user_id = ? AND log_date = ?`,
      userId, date,
    )

    if (existing) {
      await db.run(
        `UPDATE daily_logs SET content = ?, updated_at = ? WHERE id = ?`,
        content || '', now, existing.id,
      )
      res.json({ success: true, data: { id: existing.id } })
    } else {
      const id = nanoid()
      await db.run(
        `INSERT INTO daily_logs (id, user_id, log_date, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
        id, userId, date, content || '', now, now,
      )
      res.json({ success: true, data: { id } })
    }
  } catch (err) {
    console.error('暂存日志失败:', err)
    res.status(500).json({ success: false, message: '暂存失败' })
  }
})

/**
 * 查询某日期的编辑权限
 */
router.get('/edit-permission', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { logDate } = req.query as { logDate?: string }
    if (!logDate) {
      return res.status(400).json({ success: false, message: '缺少 logDate 参数' })
    }
    const permission = await getEditPermission(logDate, userId)
    res.json({ success: true, data: { permission } })
  } catch (err) {
    console.error('查询编辑权限失败:', err)
    res.status(500).json({ success: false, message: '查询编辑权限失败' })
  }
})

/**
 * 修改已提交的日志（仅 T+1 允许）
 */
router.put('/submissions/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const { content } = req.body

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '日志内容不能为空' })
    }

    const submission = await db.get<any>(
      `SELECT * FROM daily_log_submissions WHERE id = ? AND user_id = ?`,
      id, userId,
    )
    if (!submission) {
      return res.status(404).json({ success: false, message: '日志不存在或无权修改' })
    }

    const permission = await getEditPermission(submission.log_date, userId)
    if (permission === 'locked') {
      return res.status(403).json({ success: false, message: '周报已形成，本周日志不可修改' })
    }
    if (permission === 'supplement') {
      return res.status(403).json({ success: false, message: '已超过修改期限，请使用补充功能' })
    }
    if (permission === 'free') {
      return res.status(403).json({ success: false, message: '当天日志请直接编辑草稿' })
    }

    const now = new Date().toISOString()
    await db.run(
      `UPDATE daily_log_submissions SET content = ?, submitted_at = ? WHERE id = ?`,
      content, now, id,
    )

    res.json({ success: true, data: { id, content, submittedAt: now } })
  } catch (err) {
    console.error('修改已提交日志失败:', err)
    res.status(500).json({ success: false, message: '修改失败' })
  }
})

/**
 * 添加日志补充（T+2 及以后）
 */
router.post('/submissions/:id/supplement', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const { content } = req.body

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '补充内容不能为空' })
    }

    const submission = await db.get<any>(
      `SELECT * FROM daily_log_submissions WHERE id = ? AND user_id = ?`,
      id, userId,
    )
    if (!submission) {
      return res.status(404).json({ success: false, message: '日志不存在或无权操作' })
    }

    const permission = await getEditPermission(submission.log_date, userId)
    if (permission === 'locked') {
      return res.status(403).json({ success: false, message: '周报已形成，本周日志不可补充' })
    }
    if (permission === 'free' || permission === 'edit') {
      return res.status(403).json({ success: false, message: '当天或次日请直接编辑日志' })
    }

    // 计算下一个 seq
    const maxSeq = await db.get<{ max_seq: number }>(
      `SELECT COALESCE(MAX(seq), 0) as max_seq FROM daily_log_supplements WHERE submission_id = ?`,
      id,
    )
    const seq = (maxSeq?.max_seq || 0) + 1

    const supplementId = nanoid()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO daily_log_supplements (id, submission_id, user_id, seq, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      supplementId, id, userId, seq, content, now, now,
    )

    res.json({
      success: true,
      data: { id: supplementId, submissionId: id, seq, content, createdAt: now },
    })
  } catch (err) {
    console.error('添加日志补充失败:', err)
    res.status(500).json({ success: false, message: '添加补充失败' })
  }
})

/**
 * 获取某条日志的补充记录
 */
router.get('/submissions/:id/supplements', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const supplements = await db.all<any>(
      `SELECT * FROM daily_log_supplements WHERE submission_id = ? ORDER BY seq ASC`,
      id,
    )
    res.json({
      success: true,
      data: supplements.map((s: any) => ({
        id: s.id,
        seq: s.seq,
        content: s.content,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      })),
    })
  } catch (err) {
    console.error('获取日志补充失败:', err)
    res.status(500).json({ success: false, message: '获取补充记录失败' })
  }
})

/**
 * 清除日志内容
 */
router.delete('/:id/clear', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const now = new Date().toISOString()

    const log = await db.get<any>(`SELECT * FROM daily_logs WHERE id = ? AND user_id = ?`, id, userId)
    if (!log) return res.status(404).json({ success: false, message: '日志不存在' })

    await db.run(
      `UPDATE daily_logs SET content = '', status = 'draft', updated_at = ? WHERE id = ?`,
      now, id,
    )
    await db.run(`DELETE FROM daily_log_attachments WHERE daily_log_id = ?`, id)
    res.json({ success: true })
  } catch (err) {
    console.error('清除日志失败:', err)
    res.status(500).json({ success: false, message: '清除失败' })
  }
})

// 日历视图：获取指定范围内有日志的日期列表
router.get('/calendar-dates', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { startDate, endDate } = req.query as Record<string, string>
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: '缺少 startDate 或 endDate' })
    }
    const rows = await db.all<{ log_date: string }>(
      `SELECT DISTINCT log_date FROM daily_log_submissions
       WHERE user_id = ? AND log_date >= ? AND log_date <= ?
       ORDER BY log_date`,
      userId, startDate, endDate,
    )
    // 有评论的日期
    const commentDates = await db.all<{ log_date: string }>(
      `SELECT DISTINCT s.log_date FROM daily_log_comments c
       INNER JOIN daily_log_submissions s ON c.submission_id = s.id
       WHERE s.user_id = ? AND s.log_date >= ? AND s.log_date <= ?`,
      userId, startDate, endDate,
    )
    // 有未读评论的日期
    const unreadDates = await db.all<{ log_date: string }>(
      `SELECT DISTINCT s.log_date FROM daily_log_comments c
       INNER JOIN daily_log_submissions s ON c.submission_id = s.id
       WHERE s.user_id = ? AND c.user_id != ? AND c.read_at IS NULL
       AND s.log_date >= ? AND s.log_date <= ?`,
      userId, userId, startDate, endDate,
    )
    res.json({
      success: true,
      data: {
        dates: rows.map(r => r.log_date),
        commentDates: commentDates.map(r => r.log_date),
        unreadCommentDates: unreadDates.map(r => r.log_date),
      },
    })
  } catch (err) {
    console.error('获取日历日期失败:', err)
    res.status(500).json({ success: false, message: '获取日历日期失败' })
  }
})

/**
 * 历史日志列表（从提交快照表查询，按日期分组，支持分页+搜索）
 * 返回结构：每个日期下包含该日所有提交记录
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { page = '1', pageSize = '15', keyword, startDate, endDate } = req.query as Record<string, string>
    const offset = (Number(page) - 1) * Number(pageSize)

    const where: string[] = ['user_id = ?']
    const params: any[] = [userId]

    if (keyword) {
      where.push(`regexp_replace(content, '<[^>]*>', '', 'g') LIKE ?`)
      params.push(`%${keyword}%`)
    }
    if (startDate) { where.push(`log_date >= ?`); params.push(startDate) }
    if (endDate) { where.push(`log_date <= ?`); params.push(endDate) }

    const whereSql = where.join(' AND ')

    // 统计不重复的日期数（用于分页）
    const countResult = await db.get<{ count: number }>(
      `SELECT COUNT(DISTINCT log_date) as count FROM daily_log_submissions WHERE ${whereSql}`,
      ...params,
    )
    const total = countResult?.count || 0

    // 取分页范围内的日期列表
    const dates = await db.all<{ log_date: string }>(
      `SELECT DISTINCT log_date FROM daily_log_submissions WHERE ${whereSql}
       ORDER BY log_date DESC LIMIT ? OFFSET ?`,
      ...params, Number(pageSize), offset,
    )

    if (dates.length === 0) {
      return res.json({ success: true, data: { groups: [], total, page: Number(page), pageSize: Number(pageSize) } })
    }

    // 取这些日期下的所有提交记录
    const datePlaceholders = dates.map(() => '?').join(',')
    const dateValues = dates.map(d => d.log_date)
    const submissions = await db.all<any>(
      `SELECT * FROM daily_log_submissions
       WHERE user_id = ? AND log_date IN (${datePlaceholders})
       ORDER BY log_date DESC, submitted_at DESC`,
      userId, ...dateValues,
    )

    // 按日期分组
    const groupMap = new Map<string, any[]>()
    for (const s of submissions) {
      if (!groupMap.has(s.log_date)) groupMap.set(s.log_date, [])
      groupMap.get(s.log_date)!.push({
        id: s.id,
        content: s.content,
        submittedAt: s.submitted_at,
        comments: [],
      })
    }

    // 查询这些 submission 的评论
    const allSubIds = submissions.map((s: any) => s.id)
    if (allSubIds.length > 0) {
      const subPlaceholders = allSubIds.map(() => '?').join(',')
      const comments = await db.all<any>(
        `SELECT c.id, c.submission_id, c.user_id, c.content, c.created_at, c.read_at, c.reply_to, u.name as user_name,
                rc.user_id as reply_to_user_id, ru.name as reply_to_user_name
         FROM daily_log_comments c
         INNER JOIN users u ON c.user_id = u.id
         LEFT JOIN daily_log_comments rc ON rc.id = c.reply_to
         LEFT JOIN users ru ON ru.id = rc.user_id
         WHERE c.submission_id IN (${subPlaceholders})
         ORDER BY c.created_at ASC`,
        ...allSubIds,
      )
      const commentMap = new Map<string, any[]>()
      for (const c of comments) {
        if (!commentMap.has(c.submission_id)) commentMap.set(c.submission_id, [])
        commentMap.get(c.submission_id)!.push({
          id: c.id,
          userId: c.user_id,
          content: c.content,
          createdAt: c.created_at,
          userName: c.user_name,
          replyTo: c.reply_to || null,
          replyToUserId: c.reply_to_user_id || null,
          replyToUserName: c.reply_to_user_name || null,
          isUnread: c.read_at === null && c.user_id !== userId,
        })
      }
      for (const subs of groupMap.values()) {
        for (const sub of subs) {
          sub.comments = commentMap.get(sub.id) || []
        }
      }
    }

    // 查询这些日期对应的附件
    const logs = await db.all<{ id: string; log_date: string }>(
      `SELECT id, log_date FROM daily_logs WHERE user_id = ? AND log_date IN (${datePlaceholders})`,
      userId, ...dateValues,
    )
    const logIdToDate = new Map(logs.map(l => [l.id, l.log_date]))
    const logIds = logs.map(l => l.id)

    let attachmentsByDate = new Map<string, any[]>()
    if (logIds.length > 0) {
      const attPlaceholders = logIds.map(() => '?').join(',')
      const atts = await db.all<any>(
        `SELECT id, daily_log_id, file_kind, file_name, file_path, file_size, mime_type
         FROM daily_log_attachments WHERE daily_log_id IN (${attPlaceholders})
         ORDER BY created_at`,
        ...logIds,
      )
      for (const att of atts) {
        const date = logIdToDate.get(att.daily_log_id)
        if (!date) continue
        if (!attachmentsByDate.has(date)) attachmentsByDate.set(date, [])
        attachmentsByDate.get(date)!.push({
          id: att.id,
          fileKind: att.file_kind,
          fileName: att.file_name,
          filePath: att.file_path,
          fileSize: att.file_size,
          mimeType: att.mime_type,
        })
      }
    }

    const dateToLogId = new Map(logs.map(l => [l.log_date, l.id]))

    // 查询补充记录
    if (allSubIds.length > 0) {
      const subPlaceholders2 = allSubIds.map(() => '?').join(',')
      const supplements = await db.all<any>(
        `SELECT id, submission_id, seq, content, created_at, updated_at
         FROM daily_log_supplements WHERE submission_id IN (${subPlaceholders2})
         ORDER BY seq ASC`,
        ...allSubIds,
      )
      const supplementMap = new Map<string, any[]>()
      for (const s of supplements) {
        if (!supplementMap.has(s.submission_id)) supplementMap.set(s.submission_id, [])
        supplementMap.get(s.submission_id)!.push({
          id: s.id,
          seq: s.seq,
          content: s.content,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        })
      }
      for (const subs of groupMap.values()) {
        for (const sub of subs) {
          sub.supplements = supplementMap.get(sub.id) || []
        }
      }
    }

    // 计算每个日期的编辑权限
    const permissionMap = new Map<string, EditPermission>()
    for (const d of dates) {
      permissionMap.set(d.log_date, await getEditPermission(d.log_date, userId))
    }

    const groups = dates.map(d => ({
      logDate: d.log_date,
      logId: dateToLogId.get(d.log_date) || null,
      editPermission: permissionMap.get(d.log_date) || 'locked',
      submissions: groupMap.get(d.log_date) || [],
      attachments: attachmentsByDate.get(d.log_date) || [],
    }))

    res.json({
      success: true,
      data: { groups, total, page: Number(page), pageSize: Number(pageSize) },
    })
  } catch (err) {
    console.error('获取历史日志失败:', err)
    res.status(500).json({ success: false, message: '获取历史日志失败' })
  }
})

// 获取有未读评论的最早日期
router.get('/comments/unread-date', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const countRow = await db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM daily_log_comments c
       INNER JOIN daily_log_submissions s ON c.submission_id = s.id
       WHERE s.user_id = ? AND c.user_id != ? AND c.read_at IS NULL`,
      userId, userId,
    )
    const row = await db.get<{ log_date: string }>(
      `SELECT s.log_date FROM daily_log_comments c
       INNER JOIN daily_log_submissions s ON c.submission_id = s.id
       WHERE s.user_id = ? AND c.user_id != ? AND c.read_at IS NULL
       ORDER BY s.log_date DESC LIMIT 1`,
      userId, userId,
    )
    res.json({ success: true, data: { date: row?.log_date || null, count: countRow?.count || 0 } })
  } catch (err) {
    console.error('获取未读评论日期失败:', err)
    res.status(500).json({ success: false, message: '获取未读评论日期失败' })
  }
})

// 标记评论已读
router.post('/comments/mark-read', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { submissionIds } = req.body as { submissionIds: string[] }

    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      return res.json({ success: true })
    }

    const placeholders = submissionIds.map(() => '?').join(',')
    const now = new Date().toISOString()
    await db.run(
      `UPDATE daily_log_comments SET read_at = ?
       WHERE submission_id IN (${placeholders})
       AND read_at IS NULL
       AND submission_id IN (
         SELECT id FROM daily_log_submissions WHERE user_id = ?
       )
       AND user_id != ?`,
      now, ...submissionIds, userId, userId,
    )

    res.json({ success: true })
  } catch (err) {
    console.error('标记评论已读失败:', err)
    res.status(500).json({ success: false, message: '标记评论已读失败' })
  }
})

// 员工回复评论（所有登录用户可用）
router.post('/comments/:submissionId/reply', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { submissionId } = req.params
    const { content, replyTo } = req.body as { content?: string; replyTo?: string }

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '回复内容不能为空' })
    }

    // 校验 submission 存在且属于当前用户或当前用户是管理员/总经理
    const submission = await db.get<{ user_id: string }>(
      `SELECT user_id FROM daily_log_submissions WHERE id = ?`, submissionId,
    )
    if (!submission) {
      return res.status(404).json({ success: false, message: '日志提交不存在' })
    }
    const user = await db.get<{ role: string }>(`SELECT role FROM users WHERE id = ?`, userId)
    const isOwner = submission.user_id === userId
    const isManager = user && ['super_admin', 'admin', 'general_manager'].includes(user.role)
    if (!isOwner && !isManager) {
      return res.status(403).json({ success: false, message: '无权回复此日志评论' })
    }

    const id = nanoid()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO daily_log_comments (id, submission_id, user_id, content, created_at, reply_to) VALUES (?, ?, ?, ?, ?, ?)`,
      id, submissionId, userId, content.trim(), now, replyTo || null,
    )

    const userName = (await db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, userId))?.name || ''

    let replyToUserId: string | null = null
    let replyToUserName: string | null = null
    if (replyTo) {
      const parentComment = await db.get<{ user_id: string }>(
        `SELECT user_id FROM daily_log_comments WHERE id = ?`, replyTo,
      )
      if (parentComment) {
        replyToUserId = parentComment.user_id
        const replyUser = await db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, parentComment.user_id)
        replyToUserName = replyUser?.name || null
      }
    }

    res.json({
      success: true,
      data: { id, content: content.trim(), createdAt: now, userId, userName, replyTo: replyTo || null, replyToUserId, replyToUserName, isUnread: false },
    })
  } catch (err) {
    console.error('回复评论失败:', err)
    res.status(500).json({ success: false, message: '回复评论失败' })
  }
})

/**
 * 上传附件
 */
router.post('/:id/attachments', requireAuth, uploadAttachment.single('file'), async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const file = req.file

    if (!file) return res.status(400).json({ success: false, message: '请选择文件' })

    const log = await db.get<any>(`SELECT * FROM daily_logs WHERE id = ? AND user_id = ?`, id, userId)
    if (!log) return res.status(404).json({ success: false, message: '日志不存在' })

    const fileKind = file.mimetype.startsWith('image/') ? 'image' : 'document'
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8')
    const relativePath = path.relative(process.cwd(), file.path).replace(/\\/g, '/')
    const attachId = nanoid()
    const now = new Date().toISOString()

    await db.run(
      `INSERT INTO daily_log_attachments (id, daily_log_id, file_kind, file_name, file_path, file_size, mime_type, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      attachId, id, fileKind, originalName, relativePath, file.size, file.mimetype, userId, now,
    )

    res.json({
      success: true,
      data: {
        id: attachId,
        fileKind,
        fileName: originalName,
        filePath: relativePath,
        fileSize: file.size,
        mimeType: file.mimetype,
        createdAt: now,
      },
    })
  } catch (err) {
    console.error('上传附件失败:', err)
    res.status(500).json({ success: false, message: '上传附件失败' })
  }
})

/**
 * 删除附件
 */
router.delete('/attachments/:attachmentId', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { attachmentId } = req.params

    const attachment = await db.get<any>(
      `SELECT a.*, d.user_id FROM daily_log_attachments a
       JOIN daily_logs d ON d.id = a.daily_log_id
       WHERE a.id = ?`,
      attachmentId,
    )
    if (!attachment) return res.status(404).json({ success: false, message: '附件不存在' })
    if (attachment.user_id !== userId) return res.status(403).json({ success: false, message: '无权删除' })

    // 删除物理文件
    const filePath = path.resolve(process.cwd(), attachment.file_path)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)

    await db.run(`DELETE FROM daily_log_attachments WHERE id = ?`, attachmentId)
    res.json({ success: true })
  } catch (err) {
    console.error('删除附件失败:', err)
    res.status(500).json({ success: false, message: '删除附件失败' })
  }
})

/**
 * 附件在线预览
 */
router.get('/attachments/:attachmentId/preview', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { attachmentId } = req.params

    const attachment = await db.get<any>(
      `SELECT a.*, d.user_id FROM daily_log_attachments a
       JOIN daily_logs d ON d.id = a.daily_log_id
       WHERE a.id = ?`,
      attachmentId,
    )
    if (!attachment) return res.status(404).json({ success: false, message: '附件不存在' })
    if (attachment.user_id !== userId) return res.status(403).json({ success: false, message: '无权访问' })

    const fullPath = path.resolve(process.cwd(), attachment.file_path)
    if (!fs.existsSync(fullPath)) return res.status(404).json({ success: false, message: '文件不存在' })

    const ext = path.extname(attachment.file_name).toLowerCase().replace('.', '')

    if (attachment.file_kind === 'image') {
      if (attachment.mime_type) res.setHeader('Content-Type', attachment.mime_type)
      return res.sendFile(fullPath)
    }

    if (ext === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.file_name)}"`)
      return res.sendFile(fullPath)
    }

    if (CONVERTIBLE_EXT.includes(ext)) {
      return await sendConvertedPdf(res, fullPath, attachment.file_name)
    }

    res.status(400).json({ success: false, message: '不支持预览的文件格式' })
  } catch (err) {
    console.error('附件预览失败:', err)
    res.status(500).json({ success: false, message: '预览失败' })
  }
})

/**
 * 获取周报摘要
 */
router.get('/weekly-summary', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { weekStart } = req.query as Record<string, string>

    // 计算本周起止
    const now = new Date()
    const dayOfWeek = now.getDay() || 7
    const monday = new Date(now)
    monday.setDate(now.getDate() - dayOfWeek + 1)
    const start = weekStart || monday.toISOString().slice(0, 10)
    const endDate = new Date(monday)
    endDate.setDate(monday.getDate() + 6)
    const end = endDate.toISOString().slice(0, 10)

    // 查找已有摘要
    const summary = await db.get<any>(
      `SELECT * FROM weekly_summaries WHERE user_id = ? AND week_start = ?`,
      userId, start,
    )

    // 获取周报补充记录
    let supplements: any[] = []
    if (summary) {
      supplements = await db.all<any>(
        `SELECT * FROM weekly_summary_supplements WHERE weekly_summary_id = ? ORDER BY seq ASC`,
        summary.id,
      )
    }

    // 获取本周已归档日志
    const submissions = await db.all<any>(
      `SELECT log_date, content FROM daily_log_submissions
       WHERE user_id = ? AND log_date >= ? AND log_date <= ?
       ORDER BY log_date ASC`,
      userId, start, end,
    )

    // 获取当天未归档的草稿
    const drafts = await db.all<any>(
      `SELECT log_date, content FROM daily_logs
       WHERE user_id = ? AND log_date >= ? AND log_date <= ? AND content != '' AND status = 'draft'
       ORDER BY log_date ASC`,
      userId, start, end,
    )

    // 合并：已归档 + 未归档草稿（去重）
    const logDateSet = new Set(submissions.map((s: any) => s.log_date))
    const logs = [
      ...submissions.map((s: any) => ({ logDate: s.log_date, content: s.content, status: 'submitted' })),
      ...drafts.filter((d: any) => !logDateSet.has(d.log_date)).map((d: any) => ({ logDate: d.log_date, content: d.content, status: 'draft' })),
    ].sort((a, b) => a.logDate.localeCompare(b.logDate))

    const formatSummary = (s: any, sups: any[]) => s ? {
      id: s.id,
      content: s.summary_content,
      generatedAt: s.generated_at,
      lockedAt: s.locked_at || null,
      supplements: sups.map((sup: any) => ({ id: sup.id, seq: sup.seq, content: sup.content, createdAt: sup.created_at })),
    } : null

    // 如果本周无周报（未指定 weekStart 参数），回退显示上周周报
    if (!weekStart && !summary) {
      const lastMonday = new Date(monday)
      lastMonday.setDate(monday.getDate() - 7)
      const lastSunday = new Date(lastMonday)
      lastSunday.setDate(lastMonday.getDate() + 6)
      const lastStart = lastMonday.toISOString().slice(0, 10)
      const lastEnd = lastSunday.toISOString().slice(0, 10)

      const lastSummary = await db.get<any>(
        `SELECT * FROM weekly_summaries WHERE user_id = ? AND week_start = ?`,
        userId, lastStart,
      )
      let lastSupplements: any[] = []
      if (lastSummary) {
        lastSupplements = await db.all<any>(
          `SELECT * FROM weekly_summary_supplements WHERE weekly_summary_id = ? ORDER BY seq ASC`,
          lastSummary.id,
        )
      }
      const lastLogs = await db.all<any>(
        `SELECT log_date, content FROM daily_log_submissions
         WHERE user_id = ? AND log_date >= ? AND log_date <= ?
         ORDER BY log_date ASC`,
        userId, lastStart, lastEnd,
      )

      if (lastSummary || lastLogs.length > 0) {
        return res.json({
          success: true,
          data: {
            weekStart: lastStart,
            weekEnd: lastEnd,
            summary: formatSummary(lastSummary, lastSupplements),
            logs: lastLogs.map((s: any) => ({ logDate: s.log_date, content: s.content, status: 'submitted' })),
          },
        })
      }
    }

    res.json({
      success: true,
      data: {
        weekStart: start,
        weekEnd: end,
        summary: formatSummary(summary, supplements),
        logs,
      },
    })
  } catch (err) {
    console.error('获取周报摘要失败:', err)
    res.status(500).json({ success: false, message: '获取周报摘要失败' })
  }
})

router.get('/weekly-summaries', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const summaries = await db.all<any>(
      `SELECT * FROM weekly_summaries WHERE user_id = ? ORDER BY week_start DESC`,
      userId,
    )

    const result = []
    for (const s of summaries) {
      const supplements = await db.all<any>(
        `SELECT * FROM weekly_summary_supplements WHERE weekly_summary_id = ? ORDER BY seq ASC`,
        s.id,
      )

      // 查询该周的附件（带日期）
      const weekLogs = await db.all<{ id: string; log_date: string }>(
        `SELECT id, log_date FROM daily_logs WHERE user_id = ? AND log_date >= ? AND log_date <= ?`,
        userId, s.week_start, s.week_end,
      )
      let attachments: any[] = []
      if (weekLogs.length > 0) {
        const logIdToDate = new Map(weekLogs.map(l => [l.id, l.log_date]))
        const logIds = weekLogs.map(l => l.id)
        const placeholders = logIds.map(() => '?').join(',')
        const rawAtts = await db.all<any>(
          `SELECT id, daily_log_id, file_kind, file_name, file_path, file_size, mime_type, created_at
           FROM daily_log_attachments WHERE daily_log_id IN (${placeholders})
           ORDER BY created_at ASC`,
          ...logIds,
        )
        attachments = rawAtts.map((a: any) => ({
          id: a.id,
          logDate: logIdToDate.get(a.daily_log_id) || '',
          fileKind: a.file_kind,
          fileName: a.file_name,
          filePath: a.file_path,
          fileSize: a.file_size,
          mimeType: a.mime_type,
          createdAt: a.created_at,
        }))
      }

      result.push({
        id: s.id,
        weekStart: s.week_start,
        weekEnd: s.week_end,
        content: s.summary_content,
        generatedAt: s.generated_at,
        lockedAt: s.locked_at || null,
        supplements: supplements.map((sup: any) => ({ id: sup.id, seq: sup.seq, content: sup.content, createdAt: sup.created_at })),
        attachments,
      })
    }

    res.json({ success: true, data: result })
  } catch (err) {
    console.error('获取周报列表失败:', err)
    res.status(500).json({ success: false, message: '获取周报列表失败' })
  }
})

/**
 * 生成周报（AI 汇总）
 */
router.post('/weekly-summary/generate', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { weekStart, weekEnd } = req.body

    if (!weekStart || !weekEnd) {
      return res.status(400).json({ success: false, message: '请提供 weekStart 和 weekEnd' })
    }

    // 查询已归档日志
    const submissions = await db.all<any>(
      `SELECT id, log_date, content FROM daily_log_submissions
       WHERE user_id = ? AND log_date >= ? AND log_date <= ?
       ORDER BY log_date ASC`,
      userId, weekStart, weekEnd,
    )

    // 也查询当天未归档的草稿
    const drafts = await db.all<any>(
      `SELECT log_date, content FROM daily_logs
       WHERE user_id = ? AND log_date >= ? AND log_date <= ? AND content != '' AND status = 'draft'
       ORDER BY log_date ASC`,
      userId, weekStart, weekEnd,
    )

    if (submissions.length === 0 && drafts.length === 0) {
      return res.status(400).json({ success: false, message: '本周暂无日志记录' })
    }

    if (!isLLMConfigured()) {
      return res.status(400).json({ success: false, message: 'AI 服务未配置' })
    }

    // 获取补充记录
    let supplementMap = new Map<string, string[]>()
    if (submissions.length > 0) {
      const subIds = submissions.map((s: any) => s.id)
      const placeholders = subIds.map(() => '?').join(',')
      const supplements = await db.all<any>(
        `SELECT submission_id, seq, content FROM daily_log_supplements
         WHERE submission_id IN (${placeholders}) ORDER BY seq ASC`,
        ...subIds,
      )
      for (const s of supplements) {
        if (!supplementMap.has(s.submission_id)) supplementMap.set(s.submission_id, [])
        supplementMap.get(s.submission_id)!.push(s.content)
      }
    }

    // 拼接日志文本（归档 + 补充 + 草稿）
    const parts: string[] = []
    for (const s of submissions) {
      let text = `【${s.log_date}】\n${s.content}`
      const sups = supplementMap.get(s.id)
      if (sups && sups.length > 0) text += '\n' + sups.map((c, i) => `[补充${i + 1}] ${c}`).join('\n')
      parts.push(text)
    }
    for (const d of drafts) {
      if (!submissions.some((s: any) => s.log_date === d.log_date)) {
        parts.push(`【${d.log_date}】\n${d.content}`)
      }
    }

    const logsText = parts.join('\n\n')
    const prompt = `请根据以下一周的工作日志，生成一份简洁的周报摘要。要求：
1. 按工作类别归纳总结，不要逐日罗列
2. 使用"一、二、三、四..."的中文序号分段落组织内容
3. 每个段落是一个工作类别，简要说明本周成果和进展
4. 语言简洁专业
5. 控制在 300 字以内

示例格式：
一、项目推进
完成xxx项目现场勘查，与相关部门对接...

二、文件处理
完成xxx文件审批流程...

工作日志：
${logsText}`

    const result = await chat([
      { role: 'system', content: '你是一个专业的工作周报助手，擅长将日常工作日志归纳为简洁的周报摘要。' },
      { role: 'user', content: prompt },
    ])

    if (!result) {
      return res.status(500).json({ success: false, message: 'AI 生成失败，请稍后重试' })
    }

    const id = nanoid()
    const now = new Date().toISOString()

    // upsert
    const existing = await db.get<any>(
      `SELECT id FROM weekly_summaries WHERE user_id = ? AND week_start = ?`,
      userId, weekStart,
    )
    if (existing) {
      await db.run(
        `UPDATE weekly_summaries SET summary_content = ?, generated_at = ? WHERE id = ?`,
        result, now, existing.id,
      )
    } else {
      await db.run(
        `INSERT INTO weekly_summaries (id, user_id, week_start, week_end, summary_content, generated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id, userId, weekStart, weekEnd, result, now,
      )
    }

    res.json({ success: true, data: { content: result, generatedAt: now } })
  } catch (err) {
    console.error('生成周报失败:', err)
    res.status(500).json({ success: false, message: '生成周报失败' })
  }
})

/**
 * 导出周报 Word 文档
 * scope=team: 团队周报（按人名分组）
 * 默认: 个人周报（仅当前用户）
 */
router.get('/weekly-summary/download', requireAuth, async (req, res) => {
  try {
    const { weekStart, weekEnd, scope } = req.query as { weekStart?: string; weekEnd?: string; scope?: string }
    if (!weekStart || !weekEnd) {
      return res.status(400).json({ success: false, message: '请提供 weekStart 和 weekEnd' })
    }

    const isTeam = scope === 'team'
    const userId = req.session.userId!

    const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType, ImageRun } = await import('docx')

    // 获取日志（团队=全部用户，个人=仅自己）
    const submissions = isTeam
      ? await db.all<any>(
          `SELECT s.id, s.user_id, s.log_date, s.content, s.submitted_at, u.name as user_name
           FROM daily_log_submissions s
           JOIN users u ON u.id = s.user_id
           WHERE s.log_date >= ? AND s.log_date <= ?
           ORDER BY u.name ASC, s.log_date ASC`,
          weekStart, weekEnd,
        )
      : await db.all<any>(
          `SELECT s.id, s.user_id, s.log_date, s.content, s.submitted_at, u.name as user_name
           FROM daily_log_submissions s
           JOIN users u ON u.id = s.user_id
           WHERE s.user_id = ? AND s.log_date >= ? AND s.log_date <= ?
           ORDER BY s.log_date ASC`,
          userId, weekStart, weekEnd,
        )

    if (submissions.length === 0) {
      return res.status(400).json({ success: false, message: '本周暂无日志记录' })
    }

    // 获取所有补充记录
    const subIds = submissions.map((s: any) => s.id)
    let supplementMap = new Map<string, any[]>()
    if (subIds.length > 0) {
      const placeholders = subIds.map(() => '?').join(',')
      const supplements = await db.all<any>(
        `SELECT submission_id, seq, content FROM daily_log_supplements
         WHERE submission_id IN (${placeholders}) ORDER BY seq ASC`,
        ...subIds,
      )
      for (const s of supplements) {
        if (!supplementMap.has(s.submission_id)) supplementMap.set(s.submission_id, [])
        supplementMap.get(s.submission_id)!.push(s)
      }
    }

    // 获取所有附件
    const userIds = [...new Set(submissions.map((s: any) => s.user_id))]
    const userPlaceholders = userIds.map(() => '?').join(',')
    const dailyLogs = await db.all<any>(
      `SELECT id, user_id, log_date FROM daily_logs
       WHERE user_id IN (${userPlaceholders}) AND log_date >= ? AND log_date <= ?`,
      ...userIds, weekStart, weekEnd,
    )
    let attachments: any[] = []
    if (dailyLogs.length > 0) {
      const logIds = dailyLogs.map((l: any) => l.id)
      const attPlaceholders = logIds.map(() => '?').join(',')
      attachments = await db.all<any>(
        `SELECT a.*, dl.log_date, dl.user_id FROM daily_log_attachments a
         JOIN daily_logs dl ON dl.id = a.daily_log_id
         WHERE a.daily_log_id IN (${attPlaceholders})
         ORDER BY dl.log_date ASC, a.created_at ASC`,
        ...logIds,
      )
    }

    // 按用户分组
    const userGroups = new Map<string, { name: string; submissions: any[] }>()
    for (const sub of submissions) {
      if (!userGroups.has(sub.user_id)) {
        userGroups.set(sub.user_id, { name: sub.user_name, submissions: [] })
      }
      userGroups.get(sub.user_id)!.submissions.push(sub)
    }

    // HTML 转 Word 段落（保留嵌套列表层级、缩进、加粗、斜体、下划线）
    const htmlToDocxParagraphs = (html: string): any[] => {
      const paragraphs: any[] = []
      if (!html) return paragraphs

      // 去掉日期标题行（已在外层输出）
      html = html.replace(/<p[^>]*class="log-date"[^>]*>[\s\S]*?<\/p>/gi, '')

      const CN_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
        '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
      const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
        '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']

      function buildLabel(depth: number, index: number, listType: string): string {
        if (listType === 'ul') return '• '
        const n = index + 1
        if (depth === 1) return (CN_NUMBERS[index] ?? n) + '、'
        if (depth === 2) return n + '. '
        if (depth === 3) return '（' + n + '）'
        if (depth === 4) return (CIRCLED[index] ?? n + ')') + ' '
        return '— '
      }

      // 递归处理列表，支持嵌套
      function processList(listHtml: string, listType: string, depth: number) {
        // 手动解析顶层 <li> 项（不贪婪匹配，处理嵌套）
        const items = parseListItems(listHtml)
        items.forEach((liContent, idx) => {
          // 提取 li 中的直接文本（在子列表之前的内容）
          const subListMatch = liContent.match(/<(ol|ul)[^>]*>[\s\S]*$/i)
          const textPart = subListMatch ? liContent.slice(0, subListMatch.index) : liContent
          const textClean = textPart.replace(/<\/?p[^>]*>/gi, '')
          const runs = parseInlineRuns(textClean)

          if (runs.length > 0) {
            const prefix = buildLabel(depth, idx, listType)
            runs.unshift(new TextRun({ text: prefix }))
            const indent = depth * 360
            paragraphs.push(new Paragraph({ children: runs, indent: { left: indent } }))
          }

          // 处理子列表
          if (subListMatch) {
            const remaining = liContent.slice(subListMatch.index!)
            const subListRegex = /<(ol|ul)[^>]*>([\s\S]*?)<\/\1>/gi
            let subMatch
            while ((subMatch = subListRegex.exec(remaining)) !== null) {
              processList(subMatch[2], subMatch[1], depth + 1)
            }
          }
        })
      }

      // 解析顶层 li 元素（处理嵌套标签）
      function parseListItems(html: string): string[] {
        const items: string[] = []
        const liOpenRegex = /<li[^>]*>/gi
        let liMatch
        while ((liMatch = liOpenRegex.exec(html)) !== null) {
          const startIdx = liMatch.index + liMatch[0].length
          // 找到对应的闭合 </li>，考虑嵌套
          let depth = 1
          let i = startIdx
          while (i < html.length && depth > 0) {
            if (html.slice(i).match(/^<li[^>]*>/i)) {
              depth++
              const m = html.slice(i).match(/^<li[^>]*>/i)!
              i += m[0].length
            } else if (html.slice(i, i + 5).toLowerCase() === '</li>') {
              depth--
              if (depth === 0) break
              i += 5
            } else {
              i++
            }
          }
          items.push(html.slice(startIdx, i))
        }
        return items
      }

      // 分割顶层块：找顶层 ol/ul（支持嵌套）
      const topBlocks: { type: string; content: string; start: number; end: number }[] = []
      const topListRegex = /<(ol|ul)[^>]*>/gi
      let tlMatch
      while ((tlMatch = topListRegex.exec(html)) !== null) {
        const tag = tlMatch[1].toLowerCase()
        const openEnd = tlMatch.index + tlMatch[0].length
        // 找对应闭合标签
        let nestDepth = 1
        let i = openEnd
        while (i < html.length && nestDepth > 0) {
          const openNext = html.slice(i).match(new RegExp(`^<${tag}[^>]*>`, 'i'))
          const closeNext = html.slice(i).match(new RegExp(`^</${tag}>`, 'i'))
          if (openNext) { nestDepth++; i += openNext[0].length }
          else if (closeNext) { nestDepth--; i += closeNext[0].length }
          else { i++ }
        }
        topBlocks.push({ type: tag, content: html.slice(openEnd, i - `</${tag}>`.length), start: tlMatch.index, end: i })
      }

      // 按顺序处理：列表前的文本 → 列表 → 列表后的文本
      let pos = 0
      for (const block of topBlocks) {
        // 列表前的普通文本
        if (block.start > pos) {
          const textBetween = html.slice(pos, block.start).trim()
          if (textBetween) {
            const pParts = textBetween.split(/<\/?p[^>]*>/gi).filter(s => s.trim())
            for (const part of pParts) {
              const runs = parseInlineRuns(part)
              if (runs.length > 0) {
                paragraphs.push(new Paragraph({ children: runs }))
              }
            }
          }
        }
        // 处理列表
        processList(block.content, block.type, 1)
        pos = block.end
      }
      // 剩余文本
      if (pos < html.length) {
        const rest = html.slice(pos).trim()
        if (rest) {
          const pParts = rest.split(/<\/?p[^>]*>/gi).filter(s => s.trim())
          for (const part of pParts) {
            const runs = parseInlineRuns(part)
            if (runs.length > 0) {
              paragraphs.push(new Paragraph({ children: runs }))
            }
          }
        }
      }

      return paragraphs

      function parseInlineRuns(html: string): any[] {
        const runs: any[] = []
        const inlineRegex = /<(strong|b|em|i|u)>([\s\S]*?)<\/\1>/gi
        let lastIndex = 0
        let inlineMatch
        while ((inlineMatch = inlineRegex.exec(html)) !== null) {
          if (inlineMatch.index > lastIndex) {
            const text = stripTags(html.slice(lastIndex, inlineMatch.index))
            if (text) runs.push(new TextRun({ text }))
          }
          const tag = inlineMatch[1].toLowerCase()
          const text = stripTags(inlineMatch[2])
          if (text) {
            runs.push(new TextRun({
              text,
              bold: tag === 'strong' || tag === 'b',
              italics: tag === 'em' || tag === 'i',
              underline: tag === 'u' ? {} : undefined,
            }))
          }
          lastIndex = inlineMatch.index + inlineMatch[0].length
        }
        if (lastIndex < html.length) {
          const text = stripTags(html.slice(lastIndex))
          if (text) runs.push(new TextRun({ text }))
        }
        return runs
      }

      function stripTags(s: string): string {
        return s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
      }
    }

    // 构建 Word 文档
    const children: any[] = []

    const title = isTeam ? '团队工作周报' : '个人工作周报'
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: title, bold: true })],
    }))
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${weekStart} ~ ${weekEnd}`, color: '666666' })],
    }))
    children.push(new Paragraph({ text: '' }))

    // 按人名输出
    for (const [uid, group] of userGroups) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: group.name, bold: true })],
      }))

      for (const sub of group.submissions) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `【${sub.log_date}】`, bold: true })],
        }))

        children.push(...htmlToDocxParagraphs(sub.content))

        // 补充记录
        const sups = supplementMap.get(sub.id)
        if (sups && sups.length > 0) {
          for (const sp of sups) {
            children.push(new Paragraph({
              children: [new TextRun({ text: `[补充${sp.seq}] `, bold: true, color: 'E6A23C' })],
            }))
            children.push(...htmlToDocxParagraphs(sp.content))
          }
        }

        // 当天该用户的图片附件内嵌
        const dayImages = attachments.filter(a => a.user_id === uid && a.log_date === sub.log_date && a.file_kind === 'image')
        for (const img of dayImages) {
          const imgPath = path.join(process.cwd(), img.file_path)
          if (fs.existsSync(imgPath)) {
            try {
              const imgData = fs.readFileSync(imgPath)
              const ext = (img.file_name || '').split('.').pop()?.toLowerCase()
              children.push(new Paragraph({
                children: [new ImageRun({
                  data: imgData,
                  transformation: { width: 400, height: 300 },
                  type: ext === 'png' ? 'png' : ext === 'gif' ? 'gif' : 'jpg',
                })],
              }))
            } catch {}
          }
        }
      }

      // 该用户的非图片附件
      const userDocAtts = attachments.filter(a => a.user_id === uid && a.file_kind !== 'image')
      if (userDocAtts.length > 0) {
        children.push(new Paragraph({
          children: [new TextRun({ text: '附件：', bold: true })],
        }))
        for (const att of userDocAtts) {
          children.push(new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: `${att.log_date} - ${att.file_name}` })],
          }))
        }
      }

      children.push(new Paragraph({ text: '' }))
    }

    const doc = new Document({
      sections: [{ properties: {}, children }],
    })
    const buffer = await Packer.toBuffer(doc)

    // 计算 ISO 周数
    const startD = new Date(weekStart + 'T00:00:00')
    const d = new Date(Date.UTC(startD.getFullYear(), startD.getMonth(), startD.getDate()))
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)

    const startMonth = startD.getMonth() + 1
    const startDay = startD.getDate()
    const endD = new Date(weekEnd + 'T00:00:00')
    const endMonth = endD.getMonth() + 1
    const endDay = endD.getDate()
    const folderName = `${startD.getFullYear()}-${weekNum}周周报（${startMonth}月${startDay}日—${endMonth}月${endDay}日）`

    // 按用户+日期分组附件并编号
    const chineseNums = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
      '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']
    const attByUserDate = new Map<string, any[]>()
    for (const att of attachments) {
      const key = `${att.user_id}||${att.log_date}`
      if (!attByUserDate.has(key)) attByUserDate.set(key, [])
      attByUserDate.get(key)!.push(att)
    }

    // 生成 ZIP
    const archive = archiver('zip', { zlib: { level: 9 } })
    const zipFilename = encodeURIComponent(`${folderName}.zip`)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`)
    archive.pipe(res)

    // 添加 Word 文件（直接放在 ZIP 根目录）
    archive.append(buffer, { name: `${folderName}.docx` })

    // 添加附件文件（直接放在 ZIP 根目录）
    for (const [key, atts] of attByUserDate) {
      const [uid, date] = key.split('||')
      const userName = userGroups.get(uid)?.name || '未知'
      for (let i = 0; i < atts.length; i++) {
        const att = atts[i]
        const filePath = path.join(process.cwd(), att.file_path)
        if (fs.existsSync(filePath)) {
          const ext = path.extname(att.file_name || '')
          const numLabel = chineseNums[i] || String(i + 1)
          const attName = `${userName}-${date}日附件${numLabel}${ext}`
          archive.file(filePath, { name: `${attName}` })
        }
      }
    }

    await archive.finalize()
  } catch (err: any) {
    console.error('导出周报失败:', err)
    res.status(500).json({ success: false, message: '导出周报失败' })
  }
})

/**
 * 添加周报补充（周报锁定后的下一个周日 23:59:59 前允许）
 */
router.post('/weekly-summary/:id/supplement', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const { content } = req.body

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '补充内容不能为空' })
    }

    const summary = await db.get<any>(
      `SELECT * FROM weekly_summaries WHERE id = ? AND user_id = ?`,
      id, userId,
    )
    if (!summary) {
      return res.status(404).json({ success: false, message: '周报不存在' })
    }
    if (!summary.locked_at) {
      return res.status(403).json({ success: false, message: '周报尚未锁定，请直接编辑' })
    }

    // 检查是否在下一个周日 23:59:59 之前
    const lockedDate = new Date(summary.locked_at)
    const lockedDayOfWeek = lockedDate.getDay() || 7
    const nextSunday = new Date(lockedDate)
    nextSunday.setDate(lockedDate.getDate() + (7 - lockedDayOfWeek) + 7)
    nextSunday.setHours(23, 59, 59, 999)

    if (new Date() > nextSunday) {
      return res.status(403).json({ success: false, message: '已超过周报补充期限' })
    }

    const maxSeq = await db.get<{ max_seq: number }>(
      `SELECT COALESCE(MAX(seq), 0) as max_seq FROM weekly_summary_supplements WHERE weekly_summary_id = ?`,
      id,
    )
    const seq = (maxSeq?.max_seq || 0) + 1

    const supplementId = nanoid()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO weekly_summary_supplements (id, weekly_summary_id, user_id, seq, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      supplementId, id, userId, seq, content, now,
    )

    res.json({
      success: true,
      data: { id: supplementId, seq, content, createdAt: now },
    })
  } catch (err) {
    console.error('添加周报补充失败:', err)
    res.status(500).json({ success: false, message: '添加周报补充失败' })
  }
})

/**
 * 获取周报补充记录
 */
router.get('/weekly-summary/:id/supplements', requireAuth, async (req, res) => {
  try {
    const { id } = req.params
    const supplements = await db.all<any>(
      `SELECT * FROM weekly_summary_supplements WHERE weekly_summary_id = ? ORDER BY seq ASC`,
      id,
    )
    res.json({
      success: true,
      data: supplements.map((s: any) => ({
        id: s.id,
        seq: s.seq,
        content: s.content,
        createdAt: s.created_at,
      })),
    })
  } catch (err) {
    console.error('获取周报补充失败:', err)
    res.status(500).json({ success: false, message: '获取周报补充失败' })
  }
})

// ==================== 团队日志（总经理/管理员） ====================

router.get('/team', requireAdminOrGM, async (req, res) => {
  try {
    const { date, month } = req.query as { date?: string; month?: string }
    const today = new Date().toISOString().slice(0, 10)
    const targetDate = date || today

    // 计算月份范围
    const targetMonth = month || targetDate.slice(0, 7)
    const monthStart = `${targetMonth}-01`
    const monthEndDate = new Date(Number(targetMonth.slice(0, 4)), Number(targetMonth.slice(5, 7)), 0)
    const monthEnd = monthEndDate.toISOString().slice(0, 10)
    const daysInMonth = monthEndDate.getDate()

    // 获取所有活跃用户（排除 guest 和 super_admin）
    const allUsers = await db.all<{ id: string; name: string; position: string | null; role: string }>(
      `SELECT id, name, position, role FROM users WHERE role NOT IN ('guest', 'super_admin') ORDER BY name`,
    )

    // 查询该月的节假日/调休数据
    const holidays = await db.all<{ date: string; type: string; name: string }>(
      `SELECT date, type, name FROM holidays WHERE date >= ? AND date <= ?`,
      monthStart, monthEnd,
    )
    const holidayMap = new Map(holidays.map(h => [h.date, { type: h.type, name: h.name }]))

    // 判断某天是否为工作日
    function isWorkingDay(dateStr: string): boolean {
      const d = new Date(dateStr)
      const dayOfWeek = d.getDay()
      const h = holidayMap.get(dateStr)
      // 调休工作日（周末但标记为 workday）
      if (h?.type === 'workday') return true
      // 法定节假日
      if (h?.type === 'holiday') return false
      // 普通周末
      if (dayOfWeek === 0 || dayOfWeek === 6) return false
      return true
    }

    // 整月每天的提交人 user_id 集合
    const monthSubmissions = await db.all<{ user_id: string; log_date: string }>(
      `SELECT DISTINCT user_id, log_date FROM daily_log_submissions
       WHERE log_date >= ? AND log_date <= ?`,
      monthStart, monthEnd,
    )

    // 构建整月每天的统计（非工作日 total 为 0，附带节假日/调休标签）
    const monthDays: { date: string; submitted: number; total: number; label: string | null }[] = []
    for (let i = 1; i <= daysInMonth; i++) {
      const ds = `${targetMonth}-${String(i).padStart(2, '0')}`
      const daySubmitted = new Set(monthSubmissions.filter(s => s.log_date === ds).map(s => s.user_id))
      const working = isWorkingDay(ds)
      const h = holidayMap.get(ds)
      let label: string | null = null
      if (h?.type === 'holiday') label = h.name
      else if (h?.type === 'workday') label = '调休'
      monthDays.push({ date: ds, submitted: daySubmitted.size, total: working ? allUsers.length : 0, label })
    }

    // 查询整月有评论的日期和有未读回复的日期（管理员视角：别人回复了自己的评论）
    const currentUserId = req.session.userId!
    const commentDateRows = await db.all<{ log_date: string }>(
      `SELECT DISTINCT s.log_date FROM daily_log_comments c
       INNER JOIN daily_log_submissions s ON c.submission_id = s.id
       WHERE s.log_date >= ? AND s.log_date <= ?`,
      monthStart, monthEnd,
    )
    const unreadReplyDateRows = await db.all<{ log_date: string }>(
      `SELECT DISTINCT s.log_date FROM daily_log_comments c
       INNER JOIN daily_log_comments parent ON c.reply_to = parent.id
       INNER JOIN daily_log_submissions s ON c.submission_id = s.id
       WHERE parent.user_id = ? AND c.user_id != ? AND c.read_at IS NULL
       AND s.log_date >= ? AND s.log_date <= ?`,
      currentUserId, currentUserId, monthStart, monthEnd,
    )

    // 指定日期的提交详情
    const submissions = await db.all<any>(
      `SELECT s.id, s.user_id, s.content, s.submitted_at, u.name as user_name, u.position as user_position
       FROM daily_log_submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.log_date = ?
       ORDER BY s.submitted_at DESC`,
      targetDate,
    )

    // 非工作日不显示未提交人员
    const targetIsWorkingDay = isWorkingDay(targetDate)
    const submittedUserIds = new Set(submissions.map((s: any) => s.user_id))
    const notSubmitted = targetIsWorkingDay
      ? allUsers.filter(u => !submittedUserIds.has(u.id))
      : []

    // 获取评论数
    const submissionIds = submissions.map((s: any) => s.id)
    let commentCounts: Record<string, number> = {}
    let unreadReplySubmissions: Set<string> = new Set()
    if (submissionIds.length > 0) {
      const placeholders = submissionIds.map(() => '?').join(',')
      const counts = await db.all<{ submission_id: string; cnt: number }>(
        `SELECT submission_id, COUNT(*)::int as cnt FROM daily_log_comments
         WHERE submission_id IN (${placeholders}) GROUP BY submission_id`,
        ...submissionIds,
      )
      for (const c of counts) commentCounts[c.submission_id] = c.cnt

      // 查询哪些 submission 有未读回复（别人回复了当前用户的评论）
      const unreadRows = await db.all<{ submission_id: string }>(
        `SELECT DISTINCT c.submission_id FROM daily_log_comments c
         INNER JOIN daily_log_comments parent ON c.reply_to = parent.id
         WHERE c.submission_id IN (${placeholders})
         AND parent.user_id = ? AND c.user_id != ? AND c.read_at IS NULL`,
        ...submissionIds, currentUserId, currentUserId,
      )
      for (const r of unreadRows) unreadReplySubmissions.add(r.submission_id)
    }

    // 获取当日提交用户的附件
    const submittedUserIdList = submissions.map((s: any) => s.user_id)
    let attachmentsByUser: Record<string, any[]> = {}
    if (submittedUserIdList.length > 0) {
      const userPlaceholders = submittedUserIdList.map(() => '?').join(',')
      const logs = await db.all<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM daily_logs WHERE log_date = ? AND user_id IN (${userPlaceholders})`,
        targetDate, ...submittedUserIdList,
      )
      if (logs.length > 0) {
        const logIdToUser = new Map(logs.map(l => [l.id, l.user_id]))
        const logIds = logs.map(l => l.id)
        const attPlaceholders = logIds.map(() => '?').join(',')
        const atts = await db.all<any>(
          `SELECT id, daily_log_id, file_kind, file_name, file_path, file_size, mime_type
           FROM daily_log_attachments WHERE daily_log_id IN (${attPlaceholders})
           ORDER BY created_at`,
          ...logIds,
        )
        for (const att of atts) {
          const userId = logIdToUser.get(att.daily_log_id)
          if (!userId) continue
          if (!attachmentsByUser[userId]) attachmentsByUser[userId] = []
          attachmentsByUser[userId].push({
            id: att.id,
            fileKind: att.file_kind,
            fileName: att.file_name,
            filePath: att.file_path,
            fileSize: att.file_size,
            mimeType: att.mime_type,
          })
        }
      }
    }

    // 获取补充记录
    let supplementsBySubmission: Record<string, any[]> = {}
    if (submissionIds.length > 0) {
      const placeholders2 = submissionIds.map(() => '?').join(',')
      const supplements = await db.all<any>(
        `SELECT id, submission_id, seq, content, created_at FROM daily_log_supplements
         WHERE submission_id IN (${placeholders2}) ORDER BY seq ASC`,
        ...submissionIds,
      )
      for (const s of supplements) {
        if (!supplementsBySubmission[s.submission_id]) supplementsBySubmission[s.submission_id] = []
        supplementsBySubmission[s.submission_id].push({
          id: s.id,
          seq: s.seq,
          content: s.content,
          createdAt: s.created_at,
        })
      }
    }

    res.json({
      success: true,
      data: {
        targetDate,
        month: targetMonth,
        monthStart,
        monthEnd,
        monthDays,
        commentDates: commentDateRows.map(r => r.log_date),
        unreadReplyDates: unreadReplyDateRows.map(r => r.log_date),
        submissions: submissions.map((s: any) => ({
          id: s.id,
          userId: s.user_id,
          userName: s.user_name,
          userPosition: s.user_position,
          content: s.content,
          submittedAt: s.submitted_at,
          commentCount: commentCounts[s.id] || 0,
          hasUnreadReply: unreadReplySubmissions.has(s.id),
          attachments: attachmentsByUser[s.user_id] || [],
          supplements: supplementsBySubmission[s.id] || [],
        })),
        notSubmitted: notSubmitted.map(u => ({ id: u.id, name: u.name, position: u.position })),
        totalUsers: allUsers.length,
      },
    })
  } catch (err: any) {
    console.error('获取团队日志失败:', err)
    res.status(500).json({ success: false, message: '获取团队日志失败' })
  }
})

// 获取有未读回复的最近日期（管理员/总经理用）
router.get('/team/comments/unread-date', requireAdminOrGM, async (req, res) => {
  try {
    const userId = req.session.userId!
    const row = await db.get<{ log_date: string }>(
      `SELECT s.log_date FROM daily_log_comments c
       INNER JOIN daily_log_comments parent ON c.reply_to = parent.id
       INNER JOIN daily_log_submissions s ON c.submission_id = s.id
       WHERE parent.user_id = ? AND c.user_id != ? AND c.read_at IS NULL
       ORDER BY c.created_at DESC LIMIT 1`,
      userId, userId,
    )
    res.json({ success: true, data: { date: row?.log_date || null } })
  } catch (err) {
    console.error('获取未读回复日期失败:', err)
    res.status(500).json({ success: false, message: '获取未读回复日期失败' })
  }
})

router.get('/team/comments/:submissionId', requireAuth, async (req, res) => {
  try {
    const { submissionId } = req.params
    const currentUserId = req.session.userId!
    const comments = await db.all<any>(
      `SELECT c.id, c.content, c.created_at, c.read_at, c.user_id, c.reply_to, u.name as user_name,
              rc.user_id as reply_to_user_id, ru.name as reply_to_user_name
       FROM daily_log_comments c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN daily_log_comments rc ON rc.id = c.reply_to
       LEFT JOIN users ru ON ru.id = rc.user_id
       WHERE c.submission_id = ?
       ORDER BY c.created_at ASC`,
      submissionId,
    )
    res.json({
      success: true,
      data: comments.map((c: any) => ({
        id: c.id,
        content: c.content,
        createdAt: c.created_at,
        userId: c.user_id,
        userName: c.user_name,
        replyTo: c.reply_to || null,
        replyToUserId: c.reply_to_user_id || null,
        replyToUserName: c.reply_to_user_name || null,
        isUnread: c.read_at === null && c.user_id !== currentUserId,
      })),
    })

    // 自动标记回复自己的评论为已读
    await db.run(
      `UPDATE daily_log_comments SET read_at = ?
       WHERE submission_id = ? AND read_at IS NULL AND user_id != ?
       AND reply_to IN (SELECT id FROM daily_log_comments WHERE user_id = ?)`,
      new Date().toISOString(), submissionId, currentUserId, currentUserId,
    )
  } catch (err: any) {
    console.error('获取评论失败:', err)
    res.status(500).json({ success: false, message: '获取评论失败' })
  }
})

router.post('/team/comments/:submissionId', requireAdminOrGM, async (req, res) => {
  try {
    const { submissionId } = req.params
    const { content, replyTo } = req.body as { content?: string; replyTo?: string }
    const userId = req.session.userId!

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '评论内容不能为空' })
    }

    const id = nanoid()
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO daily_log_comments (id, submission_id, user_id, content, created_at, reply_to) VALUES (?, ?, ?, ?, ?, ?)`,
      id, submissionId, userId, content.trim(), now, replyTo || null,
    )

    const userName = (await db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, userId))?.name || ''

    let replyToUserId: string | null = null
    let replyToUserName: string | null = null
    if (replyTo) {
      const parentComment = await db.get<{ user_id: string }>(
        `SELECT user_id FROM daily_log_comments WHERE id = ?`, replyTo,
      )
      if (parentComment) {
        replyToUserId = parentComment.user_id
        const replyUser = await db.get<{ name: string }>(`SELECT name FROM users WHERE id = ?`, parentComment.user_id)
        replyToUserName = replyUser?.name || null
      }
    }

    res.json({
      success: true,
      data: { id, content: content.trim(), createdAt: now, userId, userName, replyTo: replyTo || null, replyToUserId, replyToUserName, isUnread: false },
    })
  } catch (err: any) {
    console.error('添加评论失败:', err)
    res.status(500).json({ success: false, message: '添加评论失败' })
  }
})

// ==================== 快捷短语 ====================

router.get('/phrases', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const phrases = await db.all<any>(
      `SELECT id, content, sort_order, created_at FROM daily_log_phrases
       WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC`,
      userId,
    )
    res.json({ success: true, data: phrases })
  } catch (err) {
    console.error('获取快捷短语失败:', err)
    res.status(500).json({ success: false, message: '获取快捷短语失败' })
  }
})

router.post('/phrases', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { content } = req.body as { content?: string }
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '短语内容不能为空' })
    }

    const maxOrder = await db.get<{ max_order: number | null }>(
      `SELECT MAX(sort_order) as max_order FROM daily_log_phrases WHERE user_id = ?`,
      userId,
    )
    const sortOrder = (maxOrder?.max_order ?? -1) + 1
    const id = nanoid()
    const now = new Date().toISOString()

    await db.run(
      `INSERT INTO daily_log_phrases (id, user_id, content, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id, userId, content.trim(), sortOrder, now,
    )

    res.json({ success: true, data: { id, content: content.trim(), sort_order: sortOrder, created_at: now } })
  } catch (err) {
    console.error('新增快捷短语失败:', err)
    res.status(500).json({ success: false, message: '新增快捷短语失败' })
  }
})

router.put('/phrases/reorder', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { ids } = req.body as { ids?: string[] }
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ success: false, message: '请提供 ids 数组' })
    }

    for (let i = 0; i < ids.length; i++) {
      await db.run(
        `UPDATE daily_log_phrases SET sort_order = ? WHERE id = ? AND user_id = ?`,
        i, ids[i], userId,
      )
    }

    res.json({ success: true })
  } catch (err) {
    console.error('排序快捷短语失败:', err)
    res.status(500).json({ success: false, message: '排序失败' })
  }
})

router.put('/phrases/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params
    const { content } = req.body as { content?: string }
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, message: '短语内容不能为空' })
    }

    const result = await db.run(
      `UPDATE daily_log_phrases SET content = ? WHERE id = ? AND user_id = ?`,
      content.trim(), id, userId,
    )
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: '短语不存在' })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('更新快捷短语失败:', err)
    res.status(500).json({ success: false, message: '更新快捷短语失败' })
  }
})

router.delete('/phrases/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params

    const result = await db.run(
      `DELETE FROM daily_log_phrases WHERE id = ? AND user_id = ?`,
      id, userId,
    )
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: '短语不存在' })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('删除快捷短语失败:', err)
    res.status(500).json({ success: false, message: '删除快捷短语失败' })
  }
})

/**
 * 单条日志详情（放在最后，避免 /:id 匹配到具名路由）
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { id } = req.params

    const log = await db.get<any>(`SELECT * FROM daily_logs WHERE id = ? AND user_id = ?`, id, userId)
    if (!log) return res.status(404).json({ success: false, message: '日志不存在' })

    const attachments = await db.all<any>(
      `SELECT * FROM daily_log_attachments WHERE daily_log_id = ? ORDER BY created_at ASC`,
      id,
    )

    res.json({
      success: true,
      data: {
        id: log.id,
        logDate: log.log_date,
        content: log.content,
        status: log.status,
        createdAt: log.created_at,
        updatedAt: log.updated_at,
        attachments: attachments.map((a: any) => ({
          id: a.id,
          fileKind: a.file_kind,
          fileName: a.file_name,
          filePath: a.file_path,
          fileSize: a.file_size,
          mimeType: a.mime_type,
          createdAt: a.created_at,
        })),
      },
    })
  } catch (err) {
    console.error('获取日志详情失败:', err)
    res.status(500).json({ success: false, message: '获取日志详情失败' })
  }
})

export default router
