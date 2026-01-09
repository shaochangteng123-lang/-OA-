import { Node, mergeAttributes, type ChainedCommands } from '@tiptap/core'

export interface NotionParagraphOptions {
  HTMLAttributes: Record<string, unknown>
}

/**
 * NotionParagraph - 用于 NotionEditor 的自定义段落扩展
 * 支持段落类型、项目关联和行号追踪
 */
export const NotionParagraph = Node.create<NotionParagraphOptions>({
  name: 'notionParagraph',

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
      // 行号（由 LineNumberGutter 动态计算，不存储）
      lineNumber: {
        default: null,
        parseHTML: (element) => {
          const lineNum = element.getAttribute('data-line-number')
          return lineNum ? parseInt(lineNum, 10) : null
        },
        renderHTML: (attributes) => {
          if (!attributes.lineNumber) return {}
          return { 'data-line-number': attributes.lineNumber.toString() }
        },
      },
    }
  },

  addCommands() {
    return {
      // 插入项目段落
      insertProjectParagraph:
        (project: { id: string; name: string; currentTask?: string }) =>
        ({ chain }) => {
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

      // 插入总体段落
      insertOverallParagraph:
        () =>
        ({ chain }: { chain: () => ChainedCommands }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: {
                segmentType: 'overall',
              },
            })
            .focus()
            .run()
        },
    }
  },

  // 键盘快捷键
  addKeyboardShortcuts() {
    return {
      // Enter键创建新段落，保持当前段落类型和颜色
      Enter: () => {
        const { state } = this.editor
        const { $from } = state.selection
        const currentNode = $from.parent

        if (currentNode.type.name === this.name) {
          const attrs = currentNode.attrs
          const segmentType = attrs.segmentType || 'overall'

          // 确定颜色：总体工作用深褐色，项目工作用深蓝色
          const color = segmentType === 'project' ? '#2c5aa0' : '#8B4513'

          // 创建新段落并设置颜色
          this.editor
            .chain()
            .insertContent({
              type: this.name,
              attrs: {
                segmentType,
                projectId: attrs.projectId || null,
                projectName: attrs.projectName || null,
                currentTask: attrs.currentTask || null,
              },
            })
            .focus()
            .run()

          // 设置文本颜色
          this.editor.chain().setColor(color).run()

          return true
        }

        return false
      },
    }
  },
})
