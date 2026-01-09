import { Heading } from '@tiptap/extension-heading'
// import { VueNodeViewRenderer } from '@tiptap/vue-3'
// import CustomHeadingView from '@/components/worklog/CustomHeadingView.vue'

/**
 * 自定义 Heading 扩展
 *
 * 支持三种类型的标题：
 * - overall: "总体工作"标题，不可编辑文字，不可删除
 * - project: 项目标题，不可编辑文字，可删除
 * - normal: 普通标题，可编辑可删除
 */
export const CustomHeading = Heading.extend({
  name: 'customHeading',

  addAttributes() {
    return {
      ...this.parent?.(),
      headingType: {
        default: 'normal',
        parseHTML: (element) => {
          // 优先读取 data-heading-type 属性
          const attrValue = element.getAttribute('data-heading-type')
          if (attrValue) {
            return attrValue
          }

          // 兼容性处理：如果没有属性，通过文本内容判断
          const text = element.textContent?.trim() || ''
          if (element.tagName === 'H3' && text === '总体工作') {
            return 'overall'
          }

          return 'normal'
        },
        renderHTML: (attributes) => {
          if (!attributes.headingType || attributes.headingType === 'normal') {
            return {}
          }
          return { 'data-heading-type': attributes.headingType }
        },
      },
      projectId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-project-id'),
        renderHTML: (attributes) => {
          if (!attributes.projectId) {
            return {}
          }
          return { 'data-project-id': attributes.projectId }
        },
      },
    }
  },

  // addNodeView() {
  //   return VueNodeViewRenderer(CustomHeadingView)
  // },

  addKeyboardShortcuts() {
    return {
      // 阻止删除受保护的标题
      Backspace: () => {
        const { $anchor } = this.editor.state.selection
        const node = $anchor.parent

        if (node.type.name === 'customHeading') {
          const headingType = node.attrs.headingType

          // 如果是受保护的标题（overall 或 project）且光标在开头，阻止删除
          if (
            (headingType === 'overall' || headingType === 'project') &&
            $anchor.parentOffset === 0
          ) {
            return true // 阻止默认行为
          }
        }

        return false
      },

      Delete: () => {
        const { $anchor } = this.editor.state.selection
        const node = $anchor.parent

        if (node.type.name === 'customHeading') {
          const headingType = node.attrs.headingType

          // 如果是受保护的标题且光标在末尾，阻止删除
          if (
            (headingType === 'overall' || headingType === 'project') &&
            $anchor.parentOffset === node.textContent.length
          ) {
            return true // 阻止默认行为
          }
        }

        return false
      },
    }
  },
})
