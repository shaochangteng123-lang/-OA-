import type { JSONContent } from '@tiptap/core'

// 项目数据接口
export interface ProjectData {
  id: string
  name: string
  currentTask?: string
  taskContent: string
}

// Tiptap JSON → API格式
export function tiptapToApiFormat(doc: JSONContent) {
  const paragraphs = doc.content || []

  const overallParas = paragraphs.filter((p) => p.attrs?.segmentType === 'overall')
  const projectParas = paragraphs.filter((p) => p.attrs?.segmentType === 'project')

  // 提取纯文本
  const overallContent = overallParas.map((p) => extractText(p)).join('\n\n')

  // 按projectId分组
  const projectGroups = new Map<string, JSONContent[]>()
  projectParas.forEach((p) => {
    const id = p.attrs?.projectId
    if (!id) return
    if (!projectGroups.has(id)) {
      projectGroups.set(id, [])
    }
    projectGroups.get(id)!.push(p)
  })

  const projects = Array.from(projectGroups.entries()).map(([id, paras]) => ({
    id,
    name: paras[0].attrs?.projectName || '',
    currentTask: paras[0].attrs?.currentTask || '',
    taskContent: paras.map((p) => extractText(p)).join('\n\n'),
  }))

  return { overallContent, projects }
}

// API格式 → Tiptap JSON
export function apiToTiptapFormat(data: {
  overallContent: string
  projects: ProjectData[]
}): JSONContent {
  const content: JSONContent[] = []

  // 总体工作段落
  if (data.overallContent) {
    content.push({
      type: 'worklogParagraph',
      attrs: { segmentType: 'overall' },
      content: [{ type: 'text', text: data.overallContent }],
    })
  }

  // 项目段落
  data.projects.forEach((proj: ProjectData) => {
    content.push({
      type: 'worklogParagraph',
      attrs: {
        segmentType: 'project',
        projectId: proj.id,
        projectName: proj.name,
        currentTask: proj.currentTask || '',
      },
      content: [{ type: 'text', text: proj.taskContent || '' }],
    })
  })

  return { type: 'doc', content }
}

// 提取纯文本辅助函数
function extractText(node: JSONContent): string {
  if (!node.content) return ''
  return node.content.map((n) => n.text || '').join('')
}
