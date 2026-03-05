<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { WorklogParagraph } from '@/extensions/WorklogParagraph'
import type { Project } from '@/types'

interface Props {
  modelValue: string // Tiptap JSON字符串
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
}>()

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      // 只保留基础功能：文档、文本、加粗、历史记录
      heading: false,
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
    }),
    WorklogParagraph,
    TextAlign.configure({
      types: ['paragraph', 'worklogParagraph'],
      alignments: ['left', 'center', 'right'],
    }),
  ],
  content: props.modelValue
    ? JSON.parse(props.modelValue)
    : {
        type: 'doc',
        content: [
          {
            type: 'worklogParagraph',
            attrs: { segmentType: 'overall' },
            content: [],
          },
        ],
      },
  onUpdate: ({ editor }) => {
    const json = JSON.stringify(editor.getJSON())
    emit('update:modelValue', json)
    emit('change')
  },
})

// 插入项目段落
function insertProjectParagraph(project: Project) {
  if (!editor.value) return

  editor.value.commands.insertProjectParagraph({
    id: project.id,
    name: project.name,
    currentTask: project.currentTask,
  })
}

defineExpose({
  insertProjectParagraph,
  editor,
})
</script>

<template>
  <div class="tiptap-editor-wrapper">
    <!-- Tiptap编辑区 -->
    <editor-content :editor="editor" class="tiptap-editor-content" />
  </div>
</template>

<style scoped>
.tiptap-editor-wrapper {
  width: 100%;
}

/* Tiptap编辑器样式 */
:deep(.tiptap-editor-content) {
  outline: none;
}

:deep(.ProseMirror) {
  outline: none;
  min-height: 800px;
  line-height: 1.8;
  font-size: 14px;
  color: #303133;
}

/* 段落样式 */
:deep(.ProseMirror p) {
  margin: 0 0 16px 0;
  text-indent: 2em; /* 2字符缩进 */
}

/* 总体工作段落 - 深褐色主题 */
:deep(.ProseMirror p[data-segment-type='overall']) {
  border-left: 4px solid #8b4513;
  padding-left: 16px;
  background: rgba(139, 69, 19, 0.05);
  text-indent: 0; /* 标题段落不缩进 */
}

/* 项目段落 */
:deep(.ProseMirror p[data-segment-type='project']) {
  border-left: 4px solid var(--yl-success);
  padding-left: 16px;
  margin-top: 24px;
  background: rgba(103, 194, 58, 0.05);
  text-indent: 0;
}

/* 加粗样式 */
:deep(.ProseMirror strong) {
  font-weight: 700;
  color: var(--yl-primary);
}

/* 打印样式 */
@media print {
  .tiptap-editor-wrapper {
    box-shadow: none;
    page-break-after: always;
    margin: 0;
  }

  .page-header {
    border-bottom-color: #333;
  }

  :deep(.ProseMirror p[data-segment-type]) {
    page-break-inside: avoid;
  }
}
</style>
