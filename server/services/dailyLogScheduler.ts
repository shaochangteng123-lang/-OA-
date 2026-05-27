import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { chat, isLLMConfigured } from './llm.js'

/**
 * 每日 23:59 自动归档：将当天非空草稿转为正式日志
 */
async function archiveDailyLogs() {
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()

  try {
    const drafts = await db.all<any>(
      `SELECT * FROM daily_logs WHERE log_date = ? AND status = 'draft' AND content != '' AND content IS NOT NULL`,
      today,
    )

    if (drafts.length === 0) {
      console.log(`📋 日志自动归档：${today} 无需归档（无非空草稿）`)
      return
    }

    let archived = 0
    for (const draft of drafts) {
      // 检查是否已有提交记录（避免重复）
      const existing = await db.get<any>(
        `SELECT id FROM daily_log_submissions WHERE user_id = ? AND log_date = ?`,
        draft.user_id, today,
      )

      if (existing) {
        // 已有提交记录，更新内容
        await db.run(
          `UPDATE daily_log_submissions SET content = ?, submitted_at = ? WHERE id = ?`,
          draft.content, now, existing.id,
        )
      } else {
        // 新建提交记录
        const submissionId = nanoid()
        await db.run(
          `INSERT INTO daily_log_submissions (id, user_id, log_date, content, submitted_at)
           VALUES (?, ?, ?, ?, ?)`,
          submissionId, draft.user_id, today, draft.content, now,
        )
      }

      // 清空草稿内容，标记为已提交
      await db.run(
        `UPDATE daily_logs SET content = '', status = 'submitted', updated_at = ? WHERE id = ?`,
        now, draft.id,
      )
      archived++
    }

    console.log(`✅ 日志自动归档：${today} 归档 ${archived} 条日志`)
  } catch (err) {
    console.error('❌ 日志自动归档失败:', err)
  }
}

/**
 * 每周日 23:59 自动生成周报并锁定本周日志
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

  try {
    // 查找本周有提交记录的所有用户
    const users = await db.all<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM daily_log_submissions WHERE log_date >= ? AND log_date <= ?`,
      weekStart, weekEnd,
    )

    if (users.length === 0) {
      console.log(`📋 周报自动生成：第 ${weekStart} 周无日志提交`)
      return
    }

    let generated = 0
    for (const { user_id } of users) {
      // 获取本周所有日志
      const logs = await db.all<any>(
        `SELECT id, log_date, content FROM daily_log_submissions
         WHERE user_id = ? AND log_date >= ? AND log_date <= ?
         ORDER BY log_date ASC`,
        user_id, weekStart, weekEnd,
      )

      if (logs.length === 0) continue

      // 获取补充记录
      const logIds = logs.map((l: any) => l.id)
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
        const logsText = logs.map((l: any) => {
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
        summaryContent = logs.map((l: any) => {
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
          `UPDATE weekly_summaries SET summary_content = ?, generated_at = ?, locked_at = ? WHERE id = ?`,
          summaryContent, nowStr, nowStr, existing.id,
        )
      } else {
        const id = nanoid()
        await db.run(
          `INSERT INTO weekly_summaries (id, user_id, week_start, week_end, summary_content, generated_at, locked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          id, user_id, weekStart, weekEnd, summaryContent, nowStr, nowStr,
        )
      }
      generated++
    }

    console.log(`✅ 周报自动生成：${weekStart} ~ ${weekEnd}，为 ${generated} 位用户生成周报并锁定`)
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

  // 每周日 23:59 自动生成周报
  const scheduleWeekly = () => {
    const now = new Date()
    const dayOfWeek = now.getDay()
    // 计算到下一个周日 23:59 的延迟
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilSunday, 23, 59, 0)
    let delay = target.getTime() - now.getTime()
    if (delay < 0) delay += 7 * 24 * 60 * 60 * 1000
    setTimeout(() => {
      void generateWeeklySummaries()
      setInterval(() => {
        void generateWeeklySummaries()
      }, 7 * 24 * 60 * 60 * 1000)
    }, delay)
  }

  scheduleArchive()
  scheduleWeekly()
  console.log('✅ 日志定时任务已启动（每日 23:59 自动归档，每周日 23:59 自动生成周报）')
}
