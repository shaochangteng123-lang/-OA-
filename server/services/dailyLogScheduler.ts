import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { chat, isLLMConfigured } from './llm.js'

/**
 * 获取指定日期所在周的最后一个工作日（周一到周日为一周）
 * 考虑节假日和调休
 */
async function getLastWorkdayOfWeekFor(refDate: Date): Promise<string> {
  // 计算本周一和周日
  const day = refDate.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate() + diffToMonday)
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)

  const mondayStr = monday.toISOString().slice(0, 10)
  const sundayStr = sunday.toISOString().slice(0, 10)

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
    const d = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000)
    const dateStr = d.toISOString().slice(0, 10)
    const dayOfWeek = d.getDay()
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
    const friday = new Date(monday.getTime() + 4 * 24 * 60 * 60 * 1000)
    lastWorkday = friday.toISOString().slice(0, 10)
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
  const today = new Date().toISOString().slice(0, 10)
  try {
    const archived = await archiveLogsForDate(today)
    if (archived === 0) {
      console.log(`📋 日志自动归档：${today} 无需归档（无非空草稿）`)
    } else {
      console.log(`✅ 日志自动归档：${today} 归档 ${archived} 条日志`)
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
  const today = new Date()
  let totalArchived = 0

  try {
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
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

/**
 * 每周最后工作日 20:00 自动生成周报（不锁定日志，周末补写的日志纳入下周周报）
 */
async function generateWeeklySummaries() {
  const now = new Date()
  const nowStr = now.toISOString()

  // 计算本周一~周日
  const dayOfWeek = now.getDay() || 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - dayOfWeek + 1)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const weekStart = monday.toISOString().slice(0, 10)
  const weekEnd = sunday.toISOString().slice(0, 10)

  // 同时查找上周未被纳入周报的日志（周报生成后周末补写的）
  const lastMonday = new Date(monday)
  lastMonday.setDate(monday.getDate() - 7)
  const lastSunday = new Date(monday)
  lastSunday.setDate(monday.getDate() - 1)
  const lastWeekStart = lastMonday.toISOString().slice(0, 10)
  const lastWeekEnd = lastSunday.toISOString().slice(0, 10)

  // 获取上周周报的生成时间
  const lastWeekSummary = await db.get<{ generated_at: string }>(
    `SELECT generated_at FROM weekly_summaries WHERE week_start = ? LIMIT 1`,
    lastWeekStart,
  )

  try {
    // 查找本周有提交记录的所有用户
    const users = await db.all<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM daily_log_submissions WHERE log_date >= ? AND log_date <= ?`,
      weekStart, weekEnd,
    )

    // 如果上周有周报，查找上周周报生成后补写的用户
    let lateUsers: { user_id: string }[] = []
    if (lastWeekSummary) {
      lateUsers = await db.all<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM daily_log_submissions
         WHERE log_date >= ? AND log_date <= ? AND submitted_at > ?`,
        lastWeekStart, lastWeekEnd, lastWeekSummary.generated_at,
      )
    }

    // 合并用户列表
    const allUserIds = new Set([...users.map(u => u.user_id), ...lateUsers.map(u => u.user_id)])

    if (allUserIds.size === 0) {
      console.log(`📋 周报自动生成：第 ${weekStart} 周无日志提交`)
      return
    }

    let generated = 0
    for (const user_id of allUserIds) {
      // 获取本周所有日志
      const logs = await db.all<any>(
        `SELECT id, log_date, content FROM daily_log_submissions
         WHERE user_id = ? AND log_date >= ? AND log_date <= ?
         ORDER BY log_date ASC`,
        user_id, weekStart, weekEnd,
      )

      // 获取上周周报生成后补写的日志
      let lateLogs: any[] = []
      if (lastWeekSummary) {
        lateLogs = await db.all<any>(
          `SELECT id, log_date, content FROM daily_log_submissions
           WHERE user_id = ? AND log_date >= ? AND log_date <= ? AND submitted_at > ?
           ORDER BY log_date ASC`,
          user_id, lastWeekStart, lastWeekEnd, lastWeekSummary.generated_at,
        )
      }

      const allLogs = [...lateLogs, ...logs]
      if (allLogs.length === 0) continue

      // 获取补充记录
      const logIds = allLogs.map((l: any) => l.id)
      const placeholders = logIds.map(() => '?').join(',')
      const supplements = await db.all<any>(
        `SELECT submission_id, seq, content FROM daily_log_supplements
         WHERE submission_id IN (${placeholders}) ORDER BY seq ASC`,
        ...logIds,
      )
      const supplementMap = new Map<string, string[]>()
      for (const s of supplements) {
        if (!supplementMap.has(s.submission_id)) supplementMap.set(s.submission_id, [])
        supplementMap.get(s.submission_id)!.push(s.content)
      }

      let summaryContent: string

      if (isLLMConfigured()) {
        const logsText = allLogs.map((l: any) => {
          let text = `【${l.log_date}】\n${l.content}`
          const sups = supplementMap.get(l.id)
          if (sups && sups.length > 0) {
            text += '\n' + sups.map((c, i) => `[补充${i + 1}] ${c}`).join('\n')
          }
          return text
        }).join('\n\n')
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

        summaryContent = result || logs.map((l: any) => {
          let text = `${l.log_date}：${l.content}`
          const sups = supplementMap.get(l.id)
          if (sups && sups.length > 0) text += '\n' + sups.map((c, i) => `[补充${i + 1}] ${c}`).join('\n')
          return text
        }).join('\n')
      } else {
        // LLM 不可用，拼接原文
        summaryContent = allLogs.map((l: any) => {
          let text = `【${l.log_date}】\n${l.content}`
          const sups = supplementMap.get(l.id)
          if (sups && sups.length > 0) text += '\n' + sups.map((c, i) => `[补充${i + 1}] ${c}`).join('\n')
          return text
        }).join('\n\n')
      }

      // upsert 周报
      const existing = await db.get<any>(
        `SELECT id FROM weekly_summaries WHERE user_id = ? AND week_start = ?`,
        user_id, weekStart,
      )

      if (existing) {
        await db.run(
          `UPDATE weekly_summaries SET summary_content = ?, generated_at = ? WHERE id = ?`,
          summaryContent, nowStr, existing.id,
        )
      } else {
        const id = nanoid()
        await db.run(
          `INSERT INTO weekly_summaries (id, user_id, week_start, week_end, summary_content, generated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id, user_id, weekStart, weekEnd, summaryContent, nowStr,
        )
      }
      generated++
    }

    console.log(`✅ 周报自动生成：${weekStart} ~ ${weekEnd}，为 ${generated} 位用户生成周报`)
  } catch (err) {
    console.error('❌ 周报自动生成失败:', err)
  }
}

/**
 * 启动日志定时任务
 */
export function setupDailyLogScheduler() {
  // 每日 23:59 自动归档
  const scheduleArchive = () => {
    const now = new Date()
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0)
    let delay = target.getTime() - now.getTime()
    if (delay < 0) delay += 24 * 60 * 60 * 1000
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
      const target = new Date(lastWorkday + 'T20:00:00')
      let delay = target.getTime() - now.getTime()
      if (delay < 0) {
        // 本周已过，计算下周
        const nextWeekDay = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        const nextLastWorkday = await getLastWorkdayOfWeekFor(nextWeekDay)
        const nextTarget = new Date(nextLastWorkday + 'T20:00:00')
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

  // 启动时立即检查并补归档遗漏的历史草稿
  void catchUpArchive()

  console.log('✅ 日志定时任务已启动（每日 23:59 自动归档，每周最后工作日 20:00 自动生成周报，启动时补归档遗漏）')
}
