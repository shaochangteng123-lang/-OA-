import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const CN_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十']

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']

function buildLabel(depth: number, index: number): string {
  const n = index + 1
  if (depth === 1) return (CN_NUMBERS[index] ?? n) + '、'
  if (depth === 2) return n + '.'
  if (depth === 3) return '（' + n + '）'
  if (depth === 4) return CIRCLED[index] ?? n + ')'
  // 五级及以上自动加长横线，不显示编号
  return '— '
}

export const ChineseOrderedList = Extension.create({
  name: 'chineseOrderedList',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('chineseOrderedList'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const { doc } = state

            doc.descendants((node, pos) => {
              if (node.type.name !== 'listItem') return

              const resolvedPos = state.doc.resolve(pos)
              let depth = 0
              for (let i = resolvedPos.depth; i >= 0; i--) {
                if (resolvedPos.node(i).type.name === 'orderedList') depth++
              }
              if (depth === 0) return

              const parent = resolvedPos.parent
              let index = 0
              parent.forEach((child, _, i) => {
                if (child === node) index = i
              })

              const label = buildLabel(depth, index)
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  'data-list-label': label,
                })
              )
            })

            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})
