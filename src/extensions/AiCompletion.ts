import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { reactive } from 'vue'
import { api } from '@/utils/api'

export interface AiCompletionState {
  suggestions: string[]
  loading: boolean
  visible: boolean
  position: { top: number; left: number }
  selectedIndex: number
  triggerText: string
}

export const aiCompletionState = reactive<AiCompletionState>({
  suggestions: [],
  loading: false,
  visible: false,
  position: { top: 0, left: 0 },
  selectedIndex: 0,
  triggerText: '',
})

const AI_COMPLETION_KEY = new PluginKey('aiCompletion')

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let abortController: AbortController | null = null
let activeView: EditorView | null = null

function setState(partial: Partial<AiCompletionState>) {
  Object.assign(aiCompletionState, partial)
}

function getCursorCoords(view: EditorView): { top: number; left: number } {
  const { from } = view.state.selection
  const coords = view.coordsAtPos(from)
  const editorRect = view.dom.closest('.tiptap-wrapper')?.getBoundingClientRect()
    || view.dom.getBoundingClientRect()
  return {
    top: coords.bottom - editorRect.top + 4,
    left: coords.left - editorRect.left,
  }
}

function getCurrentParagraphText(view: EditorView): string {
  const { $from } = view.state.selection
  return $from.parent.textContent
}

async function fetchCompletions(text: string, view: EditorView) {
  if (abortController) abortController.abort()
  abortController = new AbortController()

  setState({ loading: true, visible: false })

  try {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    const resp = await api.post('/api/worklog-ai/complete', { text, userId: authStore.user?.id }, {
      signal: abortController.signal,
    })
    if (resp.data.success && resp.data.data.suggestions.length > 0) {
      setState({
        suggestions: resp.data.data.suggestions,
        loading: false,
        visible: true,
        position: getCursorCoords(view),
        selectedIndex: 0,
        triggerText: text,
      })
    } else {
      setState({ visible: false, loading: false, suggestions: [] })
    }
  } catch (err: any) {
    if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
      setState({ visible: false, loading: false, suggestions: [] })
    }
  }
}

export function insertCompletion(suggestion: string) {
  if (!activeView) return
  const { from } = activeView.state.selection
  const currentText = getCurrentParagraphText(activeView)

  // 找到当前文本末尾与建议开头的最长重叠
  let overlap = 0
  for (let i = 1; i <= Math.min(currentText.length, suggestion.length); i++) {
    if (currentText.endsWith(suggestion.slice(0, i))) {
      overlap = i
    }
  }

  // 只插入建议中非重叠的部分，追加到光标位置
  const appendText = suggestion.slice(overlap)
  if (appendText) {
    const tr = activeView.state.tr.insertText(appendText, from)
    activeView.dispatch(tr)
  }
  setState({ visible: false, suggestions: [], loading: false })
  activeView.focus()
}

export function dismissCompletion() {
  setState({ visible: false, suggestions: [], loading: false })
}

export const AiCompletion = Extension.create({
  name: 'aiCompletion',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: AI_COMPLETION_KEY,

        props: {
          handleKeyDown(_view, event) {
            if (!aiCompletionState.visible || aiCompletionState.loading) return false

            if (event.key === 'ArrowDown') {
              event.preventDefault()
              const next = (aiCompletionState.selectedIndex + 1) % aiCompletionState.suggestions.length
              setState({ selectedIndex: next })
              return true
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              const prev = (aiCompletionState.selectedIndex - 1 + aiCompletionState.suggestions.length) % aiCompletionState.suggestions.length
              setState({ selectedIndex: prev })
              return true
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              const suggestion = aiCompletionState.suggestions[aiCompletionState.selectedIndex]
              if (suggestion) insertCompletion(suggestion)
              return true
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              dismissCompletion()
              return true
            }
            return false
          },

          handleDOMEvents: {
            blur(_view) {
              setTimeout(() => dismissCompletion(), 200)
              return false
            },
          },
        },

        view(editorView) {
          activeView = editorView
          return {
            update(view, prevState) {
              activeView = view
              if (view.state.doc.eq(prevState.doc)) return

              if (aiCompletionState.visible && !aiCompletionState.loading) {
                dismissCompletion()
              }

              if (debounceTimer) clearTimeout(debounceTimer)

              debounceTimer = setTimeout(() => {
                const text = getCurrentParagraphText(view)
                if (text.length < 2) return
                fetchCompletions(text, view)
              }, 800)
            },
            destroy() {
              if (debounceTimer) clearTimeout(debounceTimer)
              if (abortController) abortController.abort()
              activeView = null
            },
          }
        },
      }),
    ]
  },
})
