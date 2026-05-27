import { Router } from 'express'
import { db } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import { chatAboutProject, analyzeProjectRisk, isLLMConfigured } from '../services/llm.js'

const router = Router()

router.get('/status', requireAuth, (_req, res) => {
  res.json({ success: true, data: { configured: isLLMConfigured() } })
})

/**
 * 项目问答。body: { message, projectId? }
 * LLM 不可用返回 503 让前端给友好提示
 */
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message, projectId } = req.body as { message?: string; projectId?: string }
    if (!message || !message.trim()) return res.status(400).json({ success: false, message: '消息不能为空' })
    const answer = await chatAboutProject(projectId, message.trim())
    if (answer === null) {
      return res.status(503).json({ success: false, message: 'AI 服务暂不可用，请稍后重试或联系管理员' })
    }
    res.json({ success: true, data: { answer } })
  } catch (err: any) {
    console.error('AI 问答失败:', err)
    res.status(500).json({ success: false, message: err?.message || 'AI 问答失败' })
  }
})

router.post('/complete', async (req, res) => {
  try {
    const { text, userId: bodyUserId } = req.body as { text?: string; userId?: string }
    if (!text || text.trim().length < 2) {
      return res.json({ success: true, data: { suggestions: [] } })
    }
    const fullText = text.trim()
    const userId = req.session?.userId || req.session?.user?.id || bodyUserId
    if (!userId) {
      return res.json({ success: true, data: { suggestions: [] } })
    }

    // 取最后一个标点之后的文本作为补全上下文
    const tail = fullText.replace(/^.*[，。；！？、,.\s]/s, '') || fullText
    if (tail.length < 2) {
      return res.json({ success: true, data: { suggestions: [] } })
    }

    // 从尾部提取搜索关键词
    const keywords: string[] = []
    const addKw = (k: string) => { if (k.length >= 2 && !keywords.includes(k)) keywords.push(k) }
    addKw(tail)
    // 英文/数字片段
    const alphaMatches = tail.match(/[a-zA-Z0-9]+/g)
    if (alphaMatches) for (const m of alphaMatches) addKw(m)
    // 中文片段（最后2~4字）
    const cnChars = tail.replace(/[^一-鿿]/g, '')
    if (cnChars.length >= 2) addKw(cnChars.slice(-4))
    if (cnChars.length >= 2) addKw(cnChars.slice(-2))

    const seen = new Set<string>()
    const suggestions: string[] = []

    for (const keyword of keywords) {
      const rows = await db.all<{ content: string }>(
        `SELECT content FROM daily_log_submissions
         WHERE user_id = ? AND content LIKE ?
         ORDER BY submitted_at DESC LIMIT 50`,
        userId, `%${keyword}%`,
      )

      for (const row of rows) {
        const lines = row.content
          .replace(/<\/?(p|div|li|h[1-6]|br)[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length >= 4 && l.includes(keyword) && l !== fullText)

        for (const line of lines) {
          if (!seen.has(line)) {
            seen.add(line)
            suggestions.push(line)
          }
          if (suggestions.length >= 6) break
        }
        if (suggestions.length >= 6) break
      }
      if (suggestions.length >= 6) break
    }

    res.json({ success: true, data: { suggestions } })
  } catch (err: any) {
    console.error('补全失败:', err)
    res.json({ success: true, data: { suggestions: [] } })
  }
})



router.post('/analyze-risk/:projectId', requireAuth, async (req, res) => {
  try {
    const result = await analyzeProjectRisk(req.params.projectId)
    if (result === null) {
      return res.status(503).json({ success: false, message: 'AI 服务暂不可用' })
    }
    res.json({ success: true, data: result })
  } catch (err: any) {
    console.error('项目风险分析失败:', err)
    res.status(500).json({ success: false, message: err?.message || '风险分析失败' })
  }
})

/**
 * 规则预警（不调 LLM）：返回所有超期 / 临近超期的 project+matter
 * 判定逻辑：
 *   - 该 matter 在项目下所有日志都未办结
 *   - 首次日志距今天的天数 > standard_days  → high（超期）
 *   - 达到 standard_days 的 80%            → medium（临近）
 */
router.get('/gantt-alerts', requireAuth, async (_req, res) => {
  try {
    const rows = await db.all<{
      project_id: string
      project_name: string
      district: string
      owner_name: string
      matter: string
      first_date: string
      total_count: number
      finalized_count: number
      standard_days: number | null
    }>(
      `SELECT p.id AS project_id, p.name AS project_name, p.district, p.owner_name,
              e.matter,
              MIN(e.log_date) AS first_date,
              COUNT(*)::int AS total_count,
              SUM(CASE WHEN e.is_finalized THEN 1 ELSE 0 END)::int AS finalized_count,
              m.standard_days
       FROM worklog_entries e
       JOIN worklog_projects p ON p.id = e.project_id
       LEFT JOIN worklog_matters m ON m.name = e.matter
       WHERE p.is_completed = FALSE
       GROUP BY p.id, p.name, p.district, p.owner_name, e.matter, m.standard_days`,
    )

    const today = new Date()
    const alerts = rows
      .filter(r => r.total_count > r.finalized_count && r.standard_days !== null)
      .map(r => {
        const days = Math.floor((today.getTime() - new Date(r.first_date).getTime()) / (24 * 60 * 60 * 1000)) + 1
        const ratio = days / (r.standard_days || 1)
        let level: 'high' | 'medium' | null = null
        if (days > (r.standard_days || 0)) level = 'high'
        else if (ratio >= 0.8) level = 'medium'
        if (!level) return null
        return {
          projectId: r.project_id,
          projectName: r.project_name,
          district: r.district,
          ownerName: r.owner_name,
          matter: r.matter,
          firstDate: r.first_date,
          daysElapsed: days,
          standardDays: r.standard_days,
          level,
          message: level === 'high'
            ? `${r.matter} 已进行 ${days} 天，超出标准 ${r.standard_days} 天 ${days - (r.standard_days || 0)} 天`
            : `${r.matter} 已进行 ${days} 天，接近标准 ${r.standard_days} 天`,
        }
      })
      .filter(Boolean)

    res.json({ success: true, data: alerts })
  } catch (err) {
    console.error('获取甘特图预警失败:', err)
    res.status(500).json({ success: false, message: '获取预警失败' })
  }
})

export default router
