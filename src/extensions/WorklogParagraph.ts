import { Node, mergeAttributes, type ChainedCommands } from '@tiptap/core'

export interface WorklogParagraphOptions {
  HTMLAttributes: Record<string, unknown>
}

export const WorklogParagraph = Node.create<WorklogParagraphOptions>({
  name: 'worklogParagraph',

  priority: 1000,

  group: 'block',

  content: 'inline*',

  parseHTML() {
    return [{ tag: 'p' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  addAttributes() {
    return {
      // 段落类型: 'overall' | 'project'
      segmentType: {
        default: 'overall',
        parseHTML: (element) => element.getAttribute('data-segment-type') || 'overall',
        renderHTML: (attributes) => {
          if (!attributes.segmentType) return {}
          return { 'data-segment-type': attributes.segmentType }
        },
      },
      // 项目ID (仅project类型)
      projectId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-project-id'),
        renderHTML: (attributes) => {
          if (!attributes.projectId) return {}
          return { 'data-project-id': attributes.projectId }
        },
      },
      // 项目名称
      projectName: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-project-name'),
        renderHTML: (attributes) => {
          if (!attributes.projectName) return {}
          return { 'data-project-name': attributes.projectName }
        },
      },
      // 当前任务
      currentTask: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-current-task'),
        renderHTML: (attributes) => {
          if (!attributes.currentTask) return {}
          return { 'data-current-task': attributes.currentTask }
        },
      },
    }
  },

  addCommands() {
    return {
      // 插入项目段落
      insertProjectParagraph:
        (project: { id: string; name: string; currentTask?: string }) =>
        ({ chain }: { chain: () => ChainedCommands }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: {
                segmentType: 'project',
                projectId: project.id,
                projectName: project.name,
                currentTask: project.currentTask || '',
              },
            })
            .focus()
            .run()
        },
    }
  },
})
