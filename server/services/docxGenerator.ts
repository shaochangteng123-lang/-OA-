import { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType, PageNumber, Footer, Table, TableRow, TableCell, BorderStyle, WidthType } from 'docx'
import { db } from '../db/index.js'

/**
 * 把大模型产出的 Markdown 转换成 docx 段落
 * 仅支持常用语法：# 标题、**加粗**、- 列表、普通段落
 */
function markdownToDocxParagraphs(md: string): Paragraph[] {
  const lines = md.split(/\r?\n/)
  const paragraphs: Paragraph[] = []

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      paragraphs.push(new Paragraph({ text: '' }))
      continue
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      const text = h[2].trim()
      const levelMap = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]
      paragraphs.push(new Paragraph({
        text,
        heading: levelMap[level - 1],
      }))
      continue
    }

    // 列表项
    const li = line.match(/^\s*[-*]\s+(.+)$/)
    if (li) {
      paragraphs.push(new Paragraph({
        children: inlineToRuns(li[1]),
        bullet: { level: 0 },
      }))
      continue
    }

    // 有序列表
    const oli = line.match(/^\s*\d+\.\s+(.+)$/)
    if (oli) {
      paragraphs.push(new Paragraph({
        children: inlineToRuns(oli[1]),
        numbering: { reference: 'default-numbering', level: 0 },
      }))
      continue
    }

    paragraphs.push(new Paragraph({ children: inlineToRuns(line) }))
  }

  return paragraphs
}

function inlineToRuns(text: string): TextRun[] {
  // 拆分 **加粗** 片段
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.filter(Boolean).map(p => {
    const m = p.match(/^\*\*([^*]+)\*\*$/)
    if (m) return new TextRun({ text: m[1], bold: true })
    return new TextRun({ text: p })
  })
}

function fallbackWeeklyContent(project: any, entries: any[], startDate: string, endDate: string): (Paragraph | Table)[] {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: '一、项目基本信息', heading: HeadingLevel.HEADING_2 }),
  ]
  children.push(buildInfoTable(project, `${startDate} ~ ${endDate}`))

  children.push(new Paragraph({ text: '二、本周工作明细', heading: HeadingLevel.HEADING_2 }))
  if (entries.length === 0) {
    children.push(new Paragraph({ text: '本周无新增日志。' }))
  } else {
    for (const e of entries) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${e.log_date} · ${e.matter}`, bold: true }),
        ],
      }))
      if (e.contract_status) children.push(new Paragraph({ text: `合同付款：${e.contract_status}${e.contract_note ? ' - ' + e.contract_note : ''}` }))
      if (e.work_note) children.push(new Paragraph({ text: `工作备注：${e.work_note}` }))
      children.push(new Paragraph({
        children: [new TextRun({
          text: e.is_finalized ? '【已办结】' : '【进行中】',
          color: e.is_finalized ? '16A34A' : 'D97706',
        })],
      }))
      children.push(new Paragraph({ text: '' }))
    }
  }
  return children
}

function buildInfoTable(project: any, period: string): Table {
  const rows = [
    ['项目名称', project.name],
    ['甲方单位', project.client_name],
    ['行政区', project.district],
    ['项目类型', project.project_type],
    ['项目负责人', `${project.owner_name}${project.owner_position ? '（' + project.owner_position + '）' : ''}`],
    ['报告周期', period],
  ]
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v]) => new TableRow({
      children: [
        new TableCell({
          width: { size: 25, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: k, bold: true })] })],
          borders: thinBorders(),
        }),
        new TableCell({
          width: { size: 75, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ text: v || '' })],
          borders: thinBorders(),
        }),
      ],
    })),
  })
}

function thinBorders() {
  const b = { style: BorderStyle.SINGLE, size: 4, color: '999999' }
  return { top: b, bottom: b, left: b, right: b }
}

function buildFooter() {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ children: ['第 ', PageNumber.CURRENT, ' 页，共 ', PageNumber.TOTAL_PAGES, ' 页'] }),
      ],
    })],
  })
}

/**
 * 生成周报 docx。优先使用 LLM 的 Markdown；LLM 不可用时回退到基础模板
 */
export async function renderWeeklyReport(projectId: string, startDate: string, endDate: string, llmMarkdown: string | null): Promise<Buffer> {
  const project = await db.get<any>(`SELECT * FROM worklog_projects WHERE id = ?`, projectId)
  if (!project) throw new Error('项目不存在')

  const entries = await db.all<any>(
    `SELECT * FROM worklog_entries WHERE project_id = ? AND log_date >= ? AND log_date <= ? ORDER BY log_date ASC`,
    projectId, startDate, endDate,
  )

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `${project.name} 项目周报`, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${startDate} ~ ${endDate}`, color: '666666' })],
    }),
    new Paragraph({ text: '' }),
  ]

  if (llmMarkdown) {
    children.push(...markdownToDocxParagraphs(llmMarkdown))
  } else {
    children.push(...fallbackWeeklyContent(project, entries, startDate, endDate))
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children,
      footers: { default: buildFooter() },
    }],
  })
  return await Packer.toBuffer(doc)
}

export async function renderSummaryReport(projectId: string, llmMarkdown: string | null): Promise<Buffer> {
  const project = await db.get<any>(`SELECT * FROM worklog_projects WHERE id = ?`, projectId)
  if (!project) throw new Error('项目不存在')

  const entries = await db.all<any>(
    `SELECT * FROM worklog_entries WHERE project_id = ? ORDER BY log_date ASC`,
    projectId,
  )
  const attachments = await db.all<any>(
    `SELECT a.* FROM worklog_attachments a
     JOIN worklog_entries e ON e.id = a.entry_id
     WHERE e.project_id = ? ORDER BY a.created_at ASC`,
    projectId,
  )

  const periodEnd = project.is_completed && project.completed_at ? project.completed_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: `${project.name} 项目结题报告`, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `${project.start_date} ~ ${periodEnd}`, color: '666666' })],
    }),
    new Paragraph({ text: '' }),
  ]

  if (llmMarkdown) {
    children.push(...markdownToDocxParagraphs(llmMarkdown))
  } else {
    children.push(new Paragraph({ text: '一、项目概况', heading: HeadingLevel.HEADING_2 }))
    children.push(buildInfoTable(project, `${project.start_date} ~ ${periodEnd}`))
    children.push(new Paragraph({ text: '二、项目办理事项汇总', heading: HeadingLevel.HEADING_2 }))
    if (entries.length === 0) {
      children.push(new Paragraph({ text: '暂无日志记录。' }))
    } else {
      for (const e of entries) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `${e.log_date} · ${e.matter}（${e.user_name}）`, bold: true })],
        }))
        if (e.work_note) children.push(new Paragraph({ text: e.work_note }))
        children.push(new Paragraph({ text: '' }))
      }
    }
  }

  if (attachments.length > 0) {
    children.push(new Paragraph({ text: '附件清单', heading: HeadingLevel.HEADING_2 }))
    for (const a of attachments) {
      children.push(new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun({ text: `[${a.file_kind === 'image' ? '图片' : '文档'}] ${a.file_name}` })],
      }))
    }
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children,
      footers: { default: buildFooter() },
    }],
  })
  return await Packer.toBuffer(doc)
}
