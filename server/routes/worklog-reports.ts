import { Router } from 'express'
import archiver from 'archiver'
import { db } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import { checkWeeklyReportWhitelist, isAdminLike } from '../utils/worklog-auth.js'
import { generateWeeklyReportMarkdown, generateSummaryReportMarkdown } from '../services/llm.js'
import { renderWeeklyReport, renderSummaryReport } from '../services/docxGenerator.js'

const router = Router()

/**
 * 根据年+周号推算起止日期（ISO 周，周一开始）
 */
function isoWeekRange(year: number, week: number): { start: string; end: string } {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7))
  const dow = simple.getUTCDay() || 7
  const monday = new Date(simple)
  monday.setUTCDate(simple.getUTCDate() - dow + 1)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(monday), end: fmt(sunday) }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
}

/**
 * 单项目周报：仅白名单用户可下载
 */
router.post('/weekly', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    if (!(await checkWeeklyReportWhitelist(userId))) {
      return res.status(403).json({ success: false, message: '无权下载周报' })
    }

    const { projectId, year, week, startDate, endDate } = req.body as {
      projectId?: string; year?: number; week?: number; startDate?: string; endDate?: string
    }
    if (!projectId) return res.status(400).json({ success: false, message: '缺少 projectId' })

    let s = startDate, e = endDate
    if ((!s || !e) && year && week) {
      const r = isoWeekRange(Number(year), Number(week))
      s = r.start; e = r.end
    }
    if (!s || !e) return res.status(400).json({ success: false, message: '请提供 startDate+endDate 或 year+week' })

    const project = await db.get<{ name: string }>(`SELECT name FROM worklog_projects WHERE id = ?`, projectId)
    if (!project) return res.status(404).json({ success: false, message: '项目不存在' })

    // LLM 不可用则回退到基础模板
    const md = await generateWeeklyReportMarkdown(projectId, s, e).catch(() => null)
    const buf = await renderWeeklyReport(projectId, s, e, md)

    const filename = encodeURIComponent(`${sanitizeFilename(project.name)}_周报_${s}_${e}.docx`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`)
    res.send(buf)
  } catch (err) {
    console.error('生成周报失败:', err)
    res.status(500).json({ success: false, message: '生成周报失败' })
  }
})

/**
 * 批量周报：按日期范围为每个有日志的项目生成一份周报，打 ZIP
 */
router.post('/weekly/batch', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    if (!(await checkWeeklyReportWhitelist(userId))) {
      return res.status(403).json({ success: false, message: '无权下载周报' })
    }
    const { startDate, endDate } = req.body as { startDate?: string; endDate?: string }
    if (!startDate || !endDate) return res.status(400).json({ success: false, message: 'startDate/endDate 必填' })

    const projects = await db.all<{ id: string; name: string }>(
      `SELECT DISTINCT p.id, p.name
       FROM worklog_projects p
       JOIN worklog_entries e ON e.project_id = p.id
       WHERE e.log_date >= ? AND e.log_date <= ?
       ORDER BY p.name ASC`,
      startDate, endDate,
    )
    if (projects.length === 0) return res.status(404).json({ success: false, message: '该时间段内无项目日志' })

    const zipName = encodeURIComponent(`批量周报_${startDate}_${endDate}.zip`)
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"; filename*=UTF-8''${zipName}`)

    const archive = archiver('zip', { zlib: { level: 6 } })
    archive.on('error', (err) => {
      console.error('ZIP 打包失败:', err)
      try { res.status(500).end() } catch {}
    })
    archive.pipe(res)

    for (const p of projects) {
      const md = await generateWeeklyReportMarkdown(p.id, startDate, endDate).catch(() => null)
      const buf = await renderWeeklyReport(p.id, startDate, endDate, md)
      archive.append(buf, { name: `${sanitizeFilename(p.name)}_周报_${startDate}_${endDate}.docx` })
    }
    await archive.finalize()
  } catch (err) {
    console.error('批量生成周报失败:', err)
    if (!res.headersSent) res.status(500).json({ success: false, message: '批量生成周报失败' })
  }
})

/**
 * 项目结题报告：项目负责人 + admin/GM 可生成
 */
router.post('/summary', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!
    const { projectId } = req.body as { projectId?: string }
    if (!projectId) return res.status(400).json({ success: false, message: '缺少 projectId' })

    const project = await db.get<{ id: string; name: string; owner_user_id: string }>(
      `SELECT id, name, owner_user_id FROM worklog_projects WHERE id = ?`, projectId,
    )
    if (!project) return res.status(404).json({ success: false, message: '项目不存在' })

    if (project.owner_user_id !== userId && !(await isAdminLike(userId))) {
      return res.status(403).json({ success: false, message: '仅负责人或管理员可生成结题报告' })
    }

    const md = await generateSummaryReportMarkdown(projectId).catch(() => null)
    const buf = await renderSummaryReport(projectId, md)

    const filename = encodeURIComponent(`${sanitizeFilename(project.name)}_结题报告.docx`)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`)
    res.send(buf)
  } catch (err) {
    console.error('生成结题报告失败:', err)
    res.status(500).json({ success: false, message: '生成结题报告失败' })
  }
})

export default router
