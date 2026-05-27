import axios from 'axios'
import { db } from '../db/index.js'

/**
 * 独立 Linux 服务器上的大模型，使用 OpenAI 兼容 API（vLLM / Ollama / LM Studio 均可）
 * 所有 LLM 调用都带容错：网络不可达或超时时返回 null，由调用方决定回退策略
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434/v1'
const LLM_API_KEY = process.env.LLM_API_KEY || 'EMPTY'
const LLM_MODEL = process.env.LLM_MODEL || 'qwen2.5:14b'
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 120000

export function isLLMConfigured(): boolean {
  return !!process.env.LLM_BASE_URL
}

export async function chat(messages: ChatMessage[], opts?: { model?: string; temperature?: number }): Promise<string | null> {
  try {
    const resp = await axios.post(
      `${LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
      {
        model: opts?.model || LLM_MODEL,
        messages,
        temperature: opts?.temperature ?? 0.3,
        stream: false,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LLM_API_KEY}`,
        },
        timeout: LLM_TIMEOUT_MS,
      },
    )
    const content = resp.data?.choices?.[0]?.message?.content
    return typeof content === 'string' ? content : null
  } catch (err: any) {
    console.error('❌ LLM 调用失败:', err?.message || err)
    return null
  }
}

/**
 * 查询项目 + 指定时间段内全部日志作为上下文
 */
async function loadProjectContext(projectId: string, startDate?: string, endDate?: string) {
  const project = await db.get<any>(`SELECT * FROM worklog_projects WHERE id = ?`, projectId)
  if (!project) throw new Error('项目不存在')

  const where: string[] = ['project_id = ?']
  const params: any[] = [projectId]
  if (startDate) { where.push('log_date >= ?'); params.push(startDate) }
  if (endDate) { where.push('log_date <= ?'); params.push(endDate) }
  const entries = await db.all<any>(
    `SELECT * FROM worklog_entries WHERE ${where.join(' AND ')} ORDER BY log_date ASC, created_at ASC`,
    ...params,
  )

  const entryIds = entries.map(e => e.id)
  const attachments = entryIds.length > 0
    ? await db.all<any>(
        `SELECT entry_id, file_name, file_kind FROM worklog_attachments WHERE entry_id IN (${entryIds.map(() => '?').join(',')}) ORDER BY created_at ASC`,
        ...entryIds,
      )
    : []
  const attachMap = new Map<string, string[]>()
  for (const a of attachments) {
    if (!attachMap.has(a.entry_id)) attachMap.set(a.entry_id, [])
    attachMap.get(a.entry_id)!.push(`${a.file_kind === 'image' ? '[图]' : '[文档]'} ${a.file_name}`)
  }

  return { project, entries, attachMap }
}

/**
 * 把日志序列化成适合喂给 LLM 的紧凑文本
 */
function formatEntries(entries: any[], attachMap: Map<string, string[]>): string {
  return entries.map(e => {
    const atts = attachMap.get(e.id) || []
    const attText = atts.length > 0 ? `\n  附件: ${atts.join('、')}` : ''
    return [
      `[${e.log_date}] ${e.matter}（填写人：${e.user_name}${e.user_position ? '/' + e.user_position : ''}，负责人：${e.owner_name}）`,
      e.contract_status ? `  合同付款：${e.contract_status}${e.contract_note ? ' - ' + e.contract_note : ''}` : '',
      e.work_note ? `  工作备注：${e.work_note}` : '',
      e.is_finalized ? '  状态：✓ 已办结' : '  状态：○ 进行中',
      attText,
    ].filter(Boolean).join('\n')
  }).join('\n\n')
}

export async function generateWeeklyReportMarkdown(projectId: string, startDate: string, endDate: string): Promise<string | null> {
  const { project, entries, attachMap } = await loadProjectContext(projectId, startDate, endDate)
  if (entries.length === 0) return null // 空区间直接返回，由 Word 层给出"本周无日志"模板

  const system: ChatMessage = {
    role: 'system',
    content: [
      '你是工程咨询行业的资深项目经理，擅长撰写标准周报。',
      '请根据给定的项目信息和本周工作日志，输出一份结构化的周报 Markdown。',
      '格式要求：',
      '# 项目周报',
      '## 基本信息（项目名、甲方、行政区、负责人、时间段）',
      '## 本周工作进展（按办理事项分段，突出关键节点）',
      '## 合同与付款情况',
      '## 存在问题与风险',
      '## 下周工作计划',
      '语言要简洁、客观、专业，避免套话。',
    ].join('\n'),
  }
  const user: ChatMessage = {
    role: 'user',
    content: [
      `项目信息：`,
      `  名称：${project.name}`,
      `  甲方：${project.client_name}`,
      `  行政区：${project.district}`,
      `  项目类型：${project.project_type}`,
      `  负责人：${project.owner_name}${project.owner_position ? '/' + project.owner_position : ''}`,
      `  报告周期：${startDate} ~ ${endDate}`,
      ``,
      `本周日志（共 ${entries.length} 条）：`,
      formatEntries(entries, attachMap),
    ].join('\n'),
  }

  return await chat([system, user])
}

export async function generateSummaryReportMarkdown(projectId: string): Promise<string | null> {
  const { project, entries, attachMap } = await loadProjectContext(projectId)
  if (entries.length === 0) return null

  const system: ChatMessage = {
    role: 'system',
    content: [
      '你是工程咨询行业专家，请根据项目全部日志生成标准项目结题报告 Markdown。',
      '结构：',
      '# 项目结题报告',
      '## 一、项目概况',
      '## 二、主要办理事项与办结情况（列表）',
      '## 三、关键里程碑时间线',
      '## 四、合同履行与付款情况',
      '## 五、成果交付清单（对应附件）',
      '## 六、项目经验与总结',
      '力求完整、客观、可交付给甲方。',
    ].join('\n'),
  }
  const user: ChatMessage = {
    role: 'user',
    content: [
      `项目信息：${project.name} / 甲方：${project.client_name} / 行政区：${project.district}`,
      `项目周期：${project.start_date} ~ ${project.is_completed ? project.completed_at?.slice(0, 10) : '至今'}`,
      `负责人：${project.owner_name}`,
      ``,
      `全部日志（共 ${entries.length} 条）：`,
      formatEntries(entries, attachMap),
    ].join('\n'),
  }
  return await chat([system, user])
}

export interface RiskAnalysisItem {
  matter: string
  level: 'high' | 'medium' | 'low'
  message: string
}

export async function analyzeProjectRisk(projectId: string): Promise<RiskAnalysisItem[] | null> {
  const { project, entries, attachMap } = await loadProjectContext(projectId)
  if (entries.length === 0) return []

  const system: ChatMessage = {
    role: 'system',
    content: [
      '你是工程咨询项目的风险分析助手。基于日志数据，找出需要关注的风险点。',
      '输出必须是 JSON 数组（不要任何额外解释文本），格式：',
      '[{"matter":"事项名","level":"high|medium|low","message":"一句话风险描述"}]',
      '若无明显风险，返回空数组 []。',
    ].join('\n'),
  }
  const user: ChatMessage = {
    role: 'user',
    content: [
      `项目：${project.name}（${project.district}，${project.project_type}）`,
      `日志：`,
      formatEntries(entries, attachMap),
    ].join('\n'),
  }

  const raw = await chat([system, user], { temperature: 0.1 })
  if (!raw) return null

  try {
    const jsonStr = (raw.match(/\[[\s\S]*\]/) || [raw])[0]
    const parsed = JSON.parse(jsonStr) as RiskAnalysisItem[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(x => x && x.matter && x.level && x.message).slice(0, 20)
  } catch (e) {
    console.warn('LLM 风险分析 JSON 解析失败:', e)
    return null
  }
}

/**
 * 项目相关问答：把项目日志作为上下文 + 用户问题 → 大模型回答
 */
export async function generateCompletions(text: string, context?: string): Promise<string[]> {
  if (!isLLMConfigured()) return []

  const system: ChatMessage = {
    role: 'system',
    content: [
      '你是工程咨询行业的项目管理文员，擅长撰写规范的工作日志。',
      '用户正在编辑工作日志，请根据用户输入的关键词或片段，生成 3~5 条可直接插入日志的规范工作描述。',
      '要求：',
      '- 使用正式办公用语，简洁专业',
      '- 每条建议为一个完整的句子或短段落',
      '- 涵盖不同角度（如进展汇报、问题记录、沟通协调、下一步计划等）',
      '- 适配基础设施工程咨询行业话术',
      '输出格式：每条建议占一行，不要编号，不要多余解释。',
    ].join('\n'),
  }

  const userContent = context
    ? `已有日志内容：\n${context}\n\n当前输入：${text}`
    : `当前输入：${text}`

  const raw = await chat([system, { role: 'user', content: userContent }], { temperature: 0.7 })
  if (!raw) return []

  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .slice(0, 5)
}

export async function chatAboutProject(projectId: string | undefined, question: string): Promise<string | null> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: '你是工程咨询项目管理助手，基于给定的项目日志回答用户问题。若信息不足以回答，请说明缺什么。',
    },
  ]
  if (projectId) {
    const { project, entries, attachMap } = await loadProjectContext(projectId)
    messages.push({
      role: 'user',
      content: [
        `项目：${project.name}（${project.district}，${project.project_type}）`,
        `甲方：${project.client_name}`,
        `日志（共 ${entries.length} 条）：`,
        formatEntries(entries, attachMap),
      ].join('\n'),
    })
  }
  messages.push({ role: 'user', content: question })
  return await chat(messages)
}
