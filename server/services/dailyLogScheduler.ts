import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { chat, isLLMConfigured } from './llm.js'
import {
  addDateOnlyDays,
  getBusinessDate,
  getDateOnlyDayOfWeek,
  getWeekRangeFromDate,
  toBusinessDateTime,
} from '../utils/business-date.js'

/**
 * 获取指定日期所在周的最后一个工作日（周一到周日为一周）
 * 考虑节假日和调休
 */
export async function getLastWorkdayOfWeekFor(refDate: Date): Promise<string> {
  const refDateText = getBusinessDate(refDate)
  const { weekStart: mondayStr, weekEnd: sundayStr } = getWeekRangeFromDate(refDateText)

  // 查询本周的假期和调休数据
  const holidays = await db.all<{ date: string; type: string }>(
    'SELECT date, type FROM holidays WHERE date >= ? AND date <= ?',
    mondayStr, sundayStr
  )
  const holidayMap = new Map<string, string>()
  for (const row of holidays) {
    holidayMap.set(row.date, row.type)
  }

  // 从周日往前找最后一个工作日
  let lastWorkday = ''
  for (let i = 6; i >= 0; i--) {
    const dateStr = addDateOnlyDays(mondayStr, i)
    const dayOfWeek = getDateOnlyDayOfWeek(dateStr)
    const holidayType = holidayMap.get(dateStr)

    if (holidayType === 'workday') {
      // 调休上班日
      lastWorkday = dateStr
      break
    } else if (holidayType === 'holiday') {
      // 法定假日，跳过
      continue
    } else if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      // 普通工作日（周一到周五）
      lastWorkday = dateStr
      break
    }
  }

  // 兜底：如果整周都是假期，用周五
  if (!lastWorkday) {
    lastWorkday = addDateOnlyDays(mondayStr, 4)
  }

  return lastWorkday
}

async function getLastWorkdayOfWeek(): Promise<string> {
  return getLastWorkdayOfWeekFor(new Date())
}

/**
 * 归档指定日期的非空草稿为正式日志
 */
async function archiveLogsForDate(targetDate: string) {
  const now = new Date().toISOString()

  const drafts = await db.all<any>(
    `SELECT * FROM daily_logs WHERE log_date = ? AND status = 'draft' AND content != '' AND content IS NOT NULL`,
    targetDate,
  )

  if (drafts.length === 0) return 0

  let archived = 0
  for (const draft of drafts) {
    const existing = await db.get<any>(
      `SELECT id FROM daily_log_submissions WHERE user_id = ? AND log_date = ?`,
      draft.user_id, targetDate,
    )

    if (existing) {
      await db.run(
        `UPDATE daily_log_submissions SET content = ?, submitted_at = ? WHERE id = ?`,
        draft.content, now, existing.id,
      )
    } else {
      const submissionId = nanoid()
      await db.run(
        `INSERT INTO daily_log_submissions (id, user_id, log_date, content, submitted_at)
         VALUES (?, ?, ?, ?, ?)`,
        submissionId, draft.user_id, targetDate, draft.content, now,
      )
    }

    await db.run(
      `UPDATE daily_logs SET content = '', status = 'submitted', updated_at = ? WHERE id = ?`,
      now, draft.id,
    )
    archived++
  }

  return archived
}

/**
 * 每日 23:59 自动归档：将当天非空草稿转为正式日志
 */
async function archiveDailyLogs() {
  const today = getBusinessDate()
  try {
    const archived = await archiveLogsForDate(today)
    if (archived === 0) {
      console.log(`📋 日志自动归档：${today} 无需归档（无非空草稿）`)
    } else {
      console.log(`✅ 日志自动归档：${today} 归档 ${archived} 条日志`)
    }

    // 最后工作日及其后每天核对原周；生成函数会跳过未变化人员。
    const lastWorkday = await getLastWorkdayOfWeek()
    if (today >= lastWorkday) {
      const { weekStart, weekEnd } = getWeekRangeFromDate(today)
      await generateWeeklySummariesForRange(weekStart, weekEnd)
    }
  } catch (err) {
    console.error('❌ 日志自动归档失败:', err)
  }
}

/**
 * 启动时补归档：检查过去7天内未归档的草稿并自动归档
 * 防止因容器重启、定时器未触发等原因导致日志丢失
 */
async function catchUpArchive() {
  const today = getBusinessDate()
  let totalArchived = 0

  try {
    for (let i = 1; i <= 7; i++) {
      const dateStr = addDateOnlyDays(today, -i)
      const archived = await archiveLogsForDate(dateStr)
      totalArchived += archived
    }

    if (totalArchived > 0) {
      console.log(`🔄 启动补归档完成：补归档 ${totalArchived} 条历史草稿`)
    } else {
      console.log(`🔄 启动补归档检查完成：无遗漏`)
    }
  } catch (err) {
    console.error('❌ 启动补归档失败:', err)
  }
}

interface WeeklySourceLog {
  submissionId: string | null
  userId: string
  logDate: string
  content: string
  updatedAt: string
}

interface WeeklySummaryRow {
  id: string
  user_id: string
  week_end: string
  generated_at: string
}

async function loadWeeklySourceLogs(weekStart: string, weekEnd: string): Promise<WeeklySourceLog[]> {
  const submissions = await db.all<any>(
    `SELECT id, user_id, log_date, content, submitted_at
     FROM daily_log_submissions
     WHERE log_date >= ? AND log_date <= ?`,
    weekStart, weekEnd,
  )
  const drafts = await db.all<any>(
    `SELECT user_id, log_date, content, updated_at
     FROM daily_logs
     WHERE log_date >= ? AND log_date <= ?
       AND NULLIF(BTRIM(content), '') IS NOT NULL`,
    weekStart, weekEnd,
  )

  const logsByUserDate = new Map<string, WeeklySourceLog>()
  for (const row of submissions) {
    logsByUserDate.set(`${row.user_id}\u0000${row.log_date}`, {
      submissionId: row.id,
      userId: row.user_id,
      logDate: row.log_date,
      content: row.content,
      updatedAt: row.submitted_at,
    })
  }
  for (const row of drafts) {
    const key = `${row.user_id}\u0000${row.log_date}`
    if (!logsByUserDate.has(key)) {
      logsByUserDate.set(key, {
        submissionId: null,
        userId: row.user_id,
        logDate: row.log_date,
        content: row.content,
        updatedAt: row.updated_at,
      })
    }
  }

  return [...logsByUserDate.values()].sort((a, b) =>
    a.logDate.localeCompare(b.logDate) || a.userId.localeCompare(b.userId),
  )
}

function renderWeeklySource(logs: WeeklySourceLog[], supplementMap: Map<string, string[]>): string {
  return logs.map((log) => {
    let text = `【${log.logDate}】\n${log.content}`
    const supplements = log.submissionId ? supplementMap.get(log.submissionId) : undefined
    if (supplements?.length) {
      text += '\n' + supplements.map((content, index) => `[补充${index + 1}] ${content}`).join('\n')
    }
    return text
  }).join('\n\n')
}

/**
 * 幂等生成指定自然周的周报。已归档日志与非空草稿按人员、日期去重，
 * 后续归档或补充晚于摘要生成时间时只重算受影响人员。
 */
export async function generateWeeklySummariesForRange(weekStart: string, weekEnd: string): Promise<number> {
  const allLogs = await loadWeeklySourceLogs(weekStart, weekEnd)
  if (allLogs.length === 0) {
    console.log(`📋 周报自动生成：第 ${weekStart} 周无日志填写`)
    return 0
  }

  const submissionIds = allLogs
    .map((log) => log.submissionId)
    .filter((id): id is string => Boolean(id))
  const supplementMap = new Map<string, string[]>()
  const supplementUpdatedAt = new Map<string, string>()
  if (submissionIds.length > 0) {
    const placeholders = submissionIds.map(() => '?').join(',')
    const supplements = await db.all<any>(
      `SELECT submission_id, seq, content, created_at
       FROM daily_log_supplements
       WHERE submission_id IN (${placeholders})
       ORDER BY submission_id, seq ASC`,
      ...submissionIds,
    )
    for (const supplement of supplements) {
      const contents = supplementMap.get(supplement.submission_id) || []
      contents.push(supplement.content)
      supplementMap.set(supplement.submission_id, contents)
      const previous = supplementUpdatedAt.get(supplement.submission_id)
      if (!previous || supplement.created_at > previous) {
        supplementUpdatedAt.set(supplement.submission_id, supplement.created_at)
      }
    }
  }

  const existingRows = await db.all<WeeklySummaryRow>(
    `SELECT id, user_id, week_end, generated_at
     FROM weekly_summaries WHERE week_start = ?`,
    weekStart,
  )
  const existingByUser = new Map(existingRows.map((row) => [row.user_id, row]))
  const logsByUser = new Map<string, WeeklySourceLog[]>()
  for (const log of allLogs) {
    const userLogs = logsByUser.get(log.userId) || []
    userLogs.push(log)
    logsByUser.set(log.userId, userLogs)
  }

  let generated = 0
  for (const [userId, logs] of logsByUser) {
    const existing = existingByUser.get(userId)
    const latestSourceAt = logs.reduce((latest, log) => {
      const supplementAt = log.submissionId ? supplementUpdatedAt.get(log.submissionId) : undefined
      let nextLatest = log.updatedAt > latest ? log.updatedAt : latest
      if (supplementAt && supplementAt > nextLatest) nextLatest = supplementAt
      return nextLatest
    }, '')
    if (existing && existing.week_end === weekEnd && existing.generated_at >= latestSourceAt) {
      continue
    }

    const logsText = renderWeeklySource(logs, supplementMap)
    let summaryContent = logsText
    if (isLLMConfigured()) {
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
      try {
        const result = await chat([
          { role: 'system', content: '你是一个专业的工作周报助手，擅长将日常工作日志归纳为简洁的周报摘要。' },
          { role: 'user', content: prompt },
        ])
        if (result) summaryContent = result
      } catch (error) {
        console.error(`❌ ${userId} 周报智能摘要失败，已回退为日志原文:`, error)
      }
    }

    const generatedAt = new Date().toISOString()
    if (existing) {
      await db.run(
        `UPDATE weekly_summaries
         SET week_end = ?, summary_content = ?, generated_at = ?
         WHERE id = ?`,
        weekEnd, summaryContent, generatedAt, existing.id,
      )
    } else {
      await db.run(
        `INSERT INTO weekly_summaries (id, user_id, week_start, week_end, summary_content, generated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        nanoid(), userId, weekStart, weekEnd, summaryContent, generatedAt,
      )
    }
    generated++
  }

  console.log(`✅ 周报自动生成：${weekStart} ~ ${weekEnd}，更新 ${generated} 位用户`)
  return generated
}

async function generateWeeklySummaries() {
  try {
    const { weekStart, weekEnd } = getWeekRangeFromDate(getBusinessDate())
    await generateWeeklySummariesForRange(weekStart, weekEnd)
  } catch (err) {
    console.error('❌ 周报自动生成失败:', err)
  }
}

/**
 * 启动时先修复上一完整周；若本周最后工作日已到，再补算本周。
 */
async function catchUpWeeklySummaries() {
  try {
    const today = getBusinessDate()
    const currentWeek = getWeekRangeFromDate(today)
    const previousWeekStart = addDateOnlyDays(currentWeek.weekStart, -7)
    const previousWeekEnd = addDateOnlyDays(currentWeek.weekStart, -1)
    await generateWeeklySummariesForRange(previousWeekStart, previousWeekEnd)

    const lastWorkday = await getLastWorkdayOfWeek()
    if (today >= lastWorkday) {
      await generateWeeklySummariesForRange(currentWeek.weekStart, currentWeek.weekEnd)
    }
  } catch (err) {
    console.error('❌ 启动补算周报失败:', err)
  }
}

/**
 * 启动日志定时任务
 */
export function setupDailyLogScheduler() {
  // 每日 23:59 自动归档
  const scheduleArchive = () => {
    const now = new Date()
    const today = getBusinessDate(now)
    let target = toBusinessDateTime(today, '23:59:00')
    if (target.getTime() <= now.getTime()) {
      target = toBusinessDateTime(addDateOnlyDays(today, 1), '23:59:00')
    }
    const delay = target.getTime() - now.getTime()
    setTimeout(() => {
      void archiveDailyLogs()
      setInterval(() => {
        void archiveDailyLogs()
      }, 24 * 60 * 60 * 1000)
    }, delay)
  }

  // 每周工作的最后一天 20:00 自动生成周报
  const scheduleWeekly = () => {
    const scheduleNext = async () => {
      const lastWorkday = await getLastWorkdayOfWeek()
      const now = new Date()
      const target = toBusinessDateTime(lastWorkday, '20:00:00')
      let delay = target.getTime() - now.getTime()
      if (delay <= 0) {
        // 本周已过，计算下周
        const nextWeekDate = addDateOnlyDays(getBusinessDate(now), 7)
        const nextWeekDay = toBusinessDateTime(nextWeekDate, '12:00:00')
        const nextLastWorkday = await getLastWorkdayOfWeekFor(nextWeekDay)
        const nextTarget = toBusinessDateTime(nextLastWorkday, '20:00:00')
        delay = nextTarget.getTime() - now.getTime()
      }
      setTimeout(() => {
        void generateWeeklySummaries()
        // 生成后安排下一次
        void scheduleNext()
      }, delay)
    }
    void scheduleNext()
  }

  scheduleArchive()
  scheduleWeekly()

  // 先补归档历史草稿，再按原自然周补算周报，避免把迟到内容混入下一周。
  void (async () => {
    await catchUpArchive()
    await catchUpWeeklySummaries()
  })()

  console.log('✅ 日志定时任务已启动（每日 23:59 自动归档并补算，每周最后工作日 20:00 自动生成，启动时修复上一完整周）')
}
