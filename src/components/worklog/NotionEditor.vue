<template>
  <div class="notion-editor-wrapper">
    <!-- 左侧：行号和括号连线区域 -->
    <LineNumberGutter
      v-if="showLineNumbers"
      :paragraphs="paragraphsInfo"
      :active-paragraph-index="activeParagraphIndex"
      :bracket-range="bracketRange"
    />

    <!-- 右侧：编辑器区域 -->
    <div class="editor-container" @click="handleEditorClick">
      <!-- 段落高亮层 -->
      <div
        v-if="activeParagraphIndex !== null && paragraphsInfo[activeParagraphIndex]"
        class="paragraph-highlight"
        :class="{
          'is-overall': isOverallParagraph(activeParagraphIndex),
        }"
        :style="{
          top: paragraphsInfo[activeParagraphIndex].top + 'px',
          height: paragraphsInfo[activeParagraphIndex].height + 'px',
          borderLeftColor: isOverallParagraph(activeParagraphIndex)
            ? '#8b4513'
            : 'var(--yl-primary)',
        }"
      />

      <!-- 项目删除按钮层 -->
      <div
        v-for="para in projectHeadings"
        :key="para.projectId || para.index"
        class="project-delete-btn"
        :style="{
          top: para.top + 'px',
          left: (para.element.offsetWidth + 24) + 'px',
          height: para.height + 'px',
        }"
        @click.stop="handleDeleteProject(para.projectId)"
      >
        <el-icon><Close /></el-icon>
      </div>

      <!-- Tiptap 编辑器 -->
      <editor-content :editor="editor" class="tiptap-editor" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { NotionParagraph } from '@/extensions/NotionParagraph'
import { CustomHeading } from '@/extensions/CustomHeading'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import LineNumberGutter from './LineNumberGutter.vue'
import { Close } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'

interface ParagraphInfo {
  index: number
  type: 'overall' | 'project' | 'heading'
  projectId?: string | null
  top: number
  height: number
  element: HTMLElement
}

interface Props {
  modelValue: string // HTML 字符串
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
  'selection-change': []
  'update:addedProjectIds': [ids: string[]]
}>()

// 编辑器实例
const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: false, // 禁用默认 heading，使用 CustomHeading
      paragraph: false, // 禁用默认 paragraph，使用 NotionParagraph
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      // 启用 Markdown 快捷键（使用默认配置而非布尔 true，避免类型不匹配）
      bold: {},
      italic: {},
      strike: {},
      code: {},
    }),
    CustomHeading.configure({
      levels: [3],
    }),
    NotionParagraph,
    TextStyle,
    Color,
  ],
  content:
    props.modelValue ||
    '<h3 data-heading-type="overall" style="color: #8B4513">总体工作</h3><p data-segment-type="overall" style="color: #8B4513"></p>',
  editorProps: {
    attributes: {
      class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl focus:outline-none',
      spellcheck: 'false',
    },
    handleDOMEvents: {
      compositionstart: () => false,
      compositionupdate: () => false,
      compositionend: () => false,
    },
  },
  onCreate: () => {
    // 编辑器创建后，延迟更新段落信息
    setTimeout(() => {
      fixParagraphAttributes()
      updateParagraphPositions()
      updateAddedProjectIdsFromContent()
    }, 50)
  },
  onUpdate: () => {
    if (!editor.value) return
    const html = editor.value.getHTML()
    emit('update:modelValue', html)
    emit('change')

    // 更新段落信息和活跃段落索引
    nextTick(() => {
      updateParagraphPositions()
      updateActiveParagraph()
    })
  },
  onSelectionUpdate: () => {
    updateActiveParagraph()
    emit('selection-change')
  },
})

// 段落信息
const paragraphsInfo = ref<ParagraphInfo[]>([])
const activeParagraphIndex = ref<number | null>(1) // 默认高亮第2段（索引1）
const showLineNumbers = ref(true)

// 已添加的项目 ID 列表
const addedProjectIds = ref<string[]>([])

// 项目标题列表（用于显示删除按钮）
const projectHeadings = computed(() => {
  return paragraphsInfo.value.filter((p) => p.type === 'heading' && p.projectId)
})

// 括号连线范围
const bracketRange = computed(() => {
  if (activeParagraphIndex.value === null) return null

  const activePara = paragraphsInfo.value[activeParagraphIndex.value]
  if (!activePara) return null

  if (activePara.type === 'overall' || (activePara.type === 'heading' && !activePara.projectId)) {
    // 编辑总体工作：从行0（总体工作标题）到总体工作的最后一行
    // 找到第一个项目标题之前的最后一个段落
    const firstProjectHeadingIndex = paragraphsInfo.value.findIndex(
      (p) => p.type === 'heading' && p.projectId
    )

    if (firstProjectHeadingIndex !== -1) {
      // 有项目，找到第一个项目标题之前的最后一个段落
      const overallEndIndex = firstProjectHeadingIndex - 1
      return { start: 0, end: overallEndIndex }
    } else {
      // 没有项目，找到最后一个总体工作段落
      const lastOverallIndex = paragraphsInfo.value.findLastIndex(
        (p: ParagraphInfo) => p.type === 'overall' && p.element.tagName === 'P'
      )
      return {
        start: 0,
        end: lastOverallIndex !== -1 ? lastOverallIndex : activeParagraphIndex.value,
      }
    }
  } else {
    // 编辑项目：找到项目标题所在行，到项目的最后一行
    const projectHeadingIndex = findProjectHeadingIndex(activePara.projectId)
    if (projectHeadingIndex !== -1) {
      // 找到当前项目的最后一行
      const nextProjectHeadingIndex = paragraphsInfo.value.findIndex(
        (p, idx) =>
          idx > projectHeadingIndex && p.type === 'heading' && p.projectId !== activePara.projectId
      )

      if (nextProjectHeadingIndex !== -1) {
        // 有下一个项目，到下一个项目之前
        return { start: projectHeadingIndex, end: nextProjectHeadingIndex - 1 }
      } else {
        // 没有下一个项目，到当前项目的最后一行
        const lastProjectParagraphIndex = paragraphsInfo.value.findLastIndex(
          (p: ParagraphInfo) => p.projectId === activePara.projectId
        )
        return {
          start: projectHeadingIndex,
          end:
            lastProjectParagraphIndex !== -1
              ? lastProjectParagraphIndex
              : activeParagraphIndex.value,
        }
      }
    }
  }

  return { start: 0, end: activeParagraphIndex.value }
})

// Helper function to determine if a paragraph is overall work type
function isOverallParagraph(index: number): boolean {
  if (index === null || index === undefined || !paragraphsInfo.value[index]) return false

  const para = paragraphsInfo.value[index]

  // Heading without project ID is overall
  if (para.type === 'heading' && !para.projectId) {
    return true
  }

  // Explicitly typed as overall
  if (para.type === 'overall') {
    return true
  }

  // Everything else (including inherited project paragraphs) is not overall
  return false
}

// 监听 modelValue 变化
watch(
  () => props.modelValue,
  (newValue) => {
    if (editor.value && newValue !== editor.value.getHTML()) {
      editor.value.commands.setContent(newValue)
      nextTick(() => {
        updateParagraphPositions()
        updateAddedProjectIdsFromContent()
      })
    }
  },
  { immediate: true }
)

// 从编辑器内容中更新已添加项目ID列表
function updateAddedProjectIdsFromContent() {
  if (!editor.value) return

  const projectIds: string[] = []
  editor.value.state.doc.descendants((node) => {
    if (node.type.name === 'customHeading' && node.attrs.projectId) {
      const pid = String(node.attrs.projectId)
      if (!projectIds.includes(pid)) {
        projectIds.push(pid)
      }
    }
  })

  addedProjectIds.value = projectIds
  emit('update:addedProjectIds', projectIds)
}

// 修复段落属性（通过 Tiptap Transaction 更新文档）
function fixParagraphAttributes() {
  if (!editor.value) return

  const { state } = editor.value
  const { tr } = state
  let modified = false

  // 用于跟踪当前活跃的项目ID
  let currentActiveProjectId: string | null = null

  state.doc.descendants((node, pos) => {
    // 跟踪项目标题
    if (node.type.name === 'customHeading') {
      const headingType = node.attrs.headingType
      const projectId = node.attrs.projectId
      if (headingType === 'project' && projectId) {
        currentActiveProjectId = projectId
      } else if (headingType === 'overall') {
        currentActiveProjectId = null
      }
    }

    // 修复段落属性
    if (node.type.name === 'notionParagraph') {
      const segmentType = node.attrs.segmentType
      const projectId = node.attrs.projectId

      // 如果段落没有明确类型，但当前在项目区域内，则继承项目ID
      if (currentActiveProjectId && !projectId && segmentType !== 'overall') {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          segmentType: 'project',
          projectId: currentActiveProjectId,
        })
        modified = true
      }
    }
  })

  // 如果有修改，提交事务
  if (modified) {
    editor.value.view.dispatch(tr)
  }
}

// 更新段落位置信息
function updateParagraphPositions() {
  if (!editor.value) return

  const editorElement = document.querySelector('.ProseMirror') as HTMLElement
  if (!editorElement) return

  const elements = Array.from(editorElement.querySelectorAll('h3, p')) as HTMLElement[]

  // 获取编辑器容器的边界，用于计算正确的相对位置
  const containerElement = editorElement.parentElement

  // 用于跟踪当前活跃的项目ID（用于自动继承）
  let currentActiveProjectId: string | null = null

  paragraphsInfo.value = elements.map((el, index) => {
    const segmentType = el.getAttribute('data-segment-type')
    let projectId = el.getAttribute('data-project-id')

    let type: 'overall' | 'project' | 'heading' = 'overall'
    if (el.tagName === 'H3') {
      type = 'heading'
      const headingType = el.getAttribute('data-heading-type')
      // 更新当前活跃项目ID
      if (headingType === 'project' && projectId) {
        currentActiveProjectId = projectId
      } else if (headingType === 'overall') {
        currentActiveProjectId = null
      }
    } else if (el.tagName === 'P') {
      // 段落类型判断：优先使用 projectId，其次使用 segmentType
      if (projectId) {
        type = 'project'
        // 确保 DOM 元素有正确的 data-segment-type 属性
        if (segmentType !== 'project') {
          el.setAttribute('data-segment-type', 'project')
        }
      } else if (segmentType === 'project') {
        type = 'project'
        // 如果段落没有 projectId 但标记为 project 类型，且有活跃项目，则继承
        if (!projectId && currentActiveProjectId) {
          projectId = currentActiveProjectId
          // 同步更新 DOM 元素的 data-project-id 属性
          el.setAttribute('data-project-id', currentActiveProjectId)
        }
      } else if (currentActiveProjectId && segmentType !== 'overall') {
        // 如果当前有活跃项目，且段落不是明确标记为 overall，则视为项目段落
        type = 'project'
        projectId = currentActiveProjectId
        // 同步更新 DOM 元素的属性
        el.setAttribute('data-segment-type', 'project')
        el.setAttribute('data-project-id', currentActiveProjectId)
      } else {
        type = 'overall'
        // 确保 DOM 元素有正确的 data-segment-type 属性
        if (segmentType !== 'overall') {
          el.setAttribute('data-segment-type', 'overall')
        }
      }
    }

    // 使用 getBoundingClientRect 获取相对于视口的位置，然后转换为相对于编辑器容器的位置
    const elRect = el.getBoundingClientRect()
    const containerRect = containerElement?.getBoundingClientRect()

    // 计算元素相对于容器的顶部位置
    const top = containerRect ? elRect.top - containerRect.top : el.offsetTop

    return {
      index,
      type,
      projectId,
      top: top,
      height: el.offsetHeight,
      element: el,
    }
  })
}

// 更新活跃段落索引
function updateActiveParagraph() {
  if (!editor.value) return

  const { $anchor } = editor.value.state.selection
  const cursorPos = $anchor.pos

  // 计算光标所在的段落索引
  let paragraphIndex = -1
  let currentIndex = 0

  editor.value.state.doc.descendants((node, pos) => {
    if (node.type.name === 'customHeading' || node.type.name === 'notionParagraph') {
      // 检查光标是否在当前段落内
      // pos 是段落开始位置，pos + node.nodeSize 是段落结束位置
      if (cursorPos >= pos && cursorPos <= pos + node.nodeSize) {
        paragraphIndex = currentIndex
        return false // 找到后停止遍历
      }
      currentIndex++
    }
  })

  // 如果找到了有效的段落索引，更新它
  if (paragraphIndex !== -1) {
    activeParagraphIndex.value = paragraphIndex
  }
}

// 查找项目标题索引
function findProjectHeadingIndex(projectId: string | null | undefined): number {
  if (!projectId) return -1

  return paragraphsInfo.value.findIndex(
    (p) => p.type === 'heading' && String(p.projectId) === String(projectId)
  )
}

// 获取当前光标所在的项目ID
function getCurrentProjectId(): string | null {
  if (activeParagraphIndex.value === null) return null

  const activePara = paragraphsInfo.value[activeParagraphIndex.value]
  if (!activePara) return null

  if (activePara.type === 'project') {
    return activePara.projectId || null
  } else if (activePara.type === 'heading' && activePara.projectId) {
    return activePara.projectId
  }

  return null
}

// 将光标移到"总体工作"段落末尾
function focusOverallEnd() {
  if (!editor.value) return

  // 查找第一个总体工作段落（P标签）
  let targetPos: number | null = null
  let targetNode: any = null

  editor.value.state.doc.descendants((node, pos) => {
    if (targetNode) return false  // 已找到，停止

    if (node.type.name === 'notionParagraph' && node.attrs.segmentType === 'overall') {
      targetPos = pos
      targetNode = node
      return false
    }
  })

  if (targetPos !== null && targetNode) {
    // 移动到段落末尾
    const endPos = (targetPos as number) + targetNode.nodeSize - 1
    editor.value.chain().setTextSelection(endPos).focus().run()
    activeParagraphIndex.value = 1  // 设置为第2段（索引1）

    // 更新段落位置以确保高亮层位置正确
    nextTick(() => {
      updateParagraphPositions()
    })
  }
}

// 添加项目
function addProject(project: { id: string; name: string; currentTask?: string }) {
  if (!editor.value) return

  // 检查项目是否已添加
  if (addedProjectIds.value.includes(project.id)) {
    return
  }

  // 插入项目标题和段落
  editor.value
    .chain()
    .focus()
    .insertContent({
      type: 'customHeading',
      attrs: {
        level: 3,
        headingType: 'project',
        projectId: project.id,
      },
      content: [{ type: 'text', text: project.name }],
    })
    .insertContent({
      type: 'notionParagraph',
      attrs: {
        segmentType: 'project',
        projectId: project.id,
        projectName: project.name,
        currentTask: project.currentTask || '',
      },
    })
    .setColor('#2c5aa0')  // 设置项目段落默认颜色为深蓝色
    .focus()
    .run()

  // 添加到已添加项目列表
  addedProjectIds.value.push(project.id)
  emit('update:addedProjectIds', addedProjectIds.value)

  // 更新段落信息 - 使用 setTimeout 确保 DOM 完全渲染后再更新
  nextTick(() => {
    setTimeout(() => {
      updateParagraphPositions()
      updateActiveParagraph()
    }, 50)
  })
}

// 删除项目
async function handleDeleteProject(projectId: string | null | undefined) {
  if (!editor.value || !projectId) return

  // 获取项目名称用于确认提示
  let projectName = ''
  const projectHeading = paragraphsInfo.value.find(
    (p) => p.type === 'heading' && p.projectId === projectId
  )
  if (projectHeading) {
    projectName = projectHeading.element.textContent || '该项目'
  }

  // 确认删除
  try {
    await ElMessageBox.confirm(
      `确定要删除 "${projectName}" 吗？\n\n此操作会一并删除该项目和相关日志内容，且不可恢复。`,
      '确认删除',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
        dangerouslyUseHTMLString: false,
      }
    )
  } catch {
    // 用户取消
    return
  }

  // 查找项目标题的位置
  let projectHeadingPos: number | null = null
  let projectParagraphs: Array<{ pos: number; size: number }> = []

  editor.value.state.doc.descendants((node, pos) => {
    // 找到项目标题
    if (node.type.name === 'customHeading' && node.attrs.projectId === projectId) {
      projectHeadingPos = pos
    }
    // 找到项目段落
    else if (node.type.name === 'notionParagraph' && node.attrs.projectId === projectId) {
      projectParagraphs.push({ pos, size: node.nodeSize })
    }
  })

  // 删除项目段落和标题（从后往前删，避免位置偏移）
  const tr = editor.value.state.tr
  const itemsToDelete = [...projectParagraphs]
  if (projectHeadingPos !== null) {
    // 找到标题节点的大小
    const headingNode = editor.value.state.doc.nodeAt(projectHeadingPos)
    if (headingNode) {
      itemsToDelete.push({ pos: projectHeadingPos, size: headingNode.nodeSize })
    }
  }

  // 按位置从大到小排序，从后往前删除
  itemsToDelete.sort((a, b) => b.pos - a.pos)

  itemsToDelete.forEach((item) => {
    tr.delete(item.pos, item.pos + item.size)
  })

  editor.value.view.dispatch(tr)

  // 从已添加项目列表中移除
  addedProjectIds.value = addedProjectIds.value.filter((id) => id !== projectId)
  emit('update:addedProjectIds', addedProjectIds.value)

  // 更新段落信息
  nextTick(() => {
    updateParagraphPositions()
    updateActiveParagraph()
  })
}

// 点击编辑器区域
function handleEditorClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('.ProseMirror')) {
    // 点击编辑器内部，不做处理
    return
  }
}

// 全局点击事件 - 点击非编辑区域时隐藏括号
function handleGlobalClick(event: MouseEvent) {
  const target = event.target as HTMLElement
  const isInsideEditor = target.closest('.notion-editor-wrapper')

  if (!isInsideEditor) {
    activeParagraphIndex.value = null
  }
}

// 组件挂载
onMounted(() => {
  // 初始化段落位置
  nextTick(() => {
    updateParagraphPositions()
    updateAddedProjectIdsFromContent()

    // 默认光标定位到第2段（第一个内容段落）
    if (editor.value) {
      setTimeout(() => {
        // 安全地设置光标位置，避免 TextSelection 错误
        try {
          focusOverallEnd()
        } catch (e) {
          console.warn('设置光标位置失败:', e)
          // 如果失败，使用安全的方式聚焦到文档开始
          try {
            editor.value?.chain().setTextSelection(1).run()
          } catch (err) {
            // 完全失败时才回退到简单聚焦
            editor.value?.commands.focus()
          }
        }
      }, 100)
    }
  })

  // 监听全局点击
  document.addEventListener('click', handleGlobalClick)

  // 监听窗口大小变化
  window.addEventListener('resize', updateParagraphPositions)
})

// 组件卸载
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  window.removeEventListener('resize', updateParagraphPositions)
  editor.value?.destroy()
})

// 暴露方法
defineExpose({
  getCurrentProjectId,
  focusOverallEnd,
  addProject,
  editor,
})
</script>

<style scoped>
.notion-editor-wrapper {
  display: flex;
  position: relative;
  width: 100%;
  min-height: 400px;
}

.editor-container {
  flex: 1;
  position: relative;
}

.tiptap-editor {
  width: 100%;
  min-height: 400px;
}

/* 段落高亮层 - 项目段落默认深蓝色 */
.paragraph-highlight {
  position: absolute;
  left: 0;
  right: 0;
  background: rgba(44, 90, 160, 0.05);
  border-left: 3px solid var(--yl-primary);
  pointer-events: none;
  transition: all 0.2s ease;
  z-index: 1;
}

/* 段落高亮层 - 总体工作段落深褐色 */
.paragraph-highlight.is-overall {
  background: rgba(139, 69, 19, 0.05);
}

/* 项目删除按钮 */
.project-delete-btn {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid var(--yl-border-light);
  cursor: pointer;
  opacity: 0;
  transition: all 0.2s ease;
  z-index: 10;
  color: #909399;
}

.project-delete-btn:hover {
  opacity: 1 !important;
  background: #f56c6c;
  color: white;
  border-color: #f56c6c;
}

/* 项目标题悬停时显示删除按钮 */
:deep(.ProseMirror h3[data-heading-type='project']:hover) {
  padding-right: 28px;
}

:deep(.ProseMirror h3[data-heading-type='project']:hover) + .project-delete-btn,
.editor-container:hover .project-delete-btn {
  opacity: 0.6;
}

/* Tiptap 编辑器样式 */
:deep(.ProseMirror) {
  outline: none;
  min-height: 400px;
  line-height: 1.8;
  font-size: 14px;
  color: #303133;
  padding: 16px;
}

/* 总体工作标题 - 固定18px，覆盖响应式 */
:deep(.ProseMirror h3[data-heading-type='overall']) {
  font-size: 18px !important;
  color: #8b4513;
  font-weight: 600;
  margin: 0 0 8px 0;
  line-height: 1.5;
}

/* 项目标题 */
:deep(.ProseMirror h3[data-heading-type='project']) {
  font-size: 16px;
  color: var(--yl-primary);
  font-weight: 600;
  margin: 16px 0 8px 0;
  line-height: 1.5;
  position: relative;
  display: inline-block;
  width: 100%;
}

/* 总体工作段落 - 深褐色 */
:deep(.ProseMirror p[data-segment-type='overall']) {
  color: #8b4513;
  line-height: 1.8;
  text-indent: 2em;
  margin-bottom: 8px;
}

/* 项目段落 - 深蓝色 */
:deep(.ProseMirror p[data-segment-type='project']) {
  color: var(--yl-primary);
  line-height: 1.8;
  text-indent: 2em;
  margin-bottom: 8px;
}

/* Markdown 样式 */
/* 加粗 */
:deep(.ProseMirror strong) {
  font-weight: 700;
  color: var(--yl-primary);
}

/* 斜体 */
:deep(.ProseMirror em) {
  font-style: italic;
  color: #606266;
}

/* 删除线 */
:deep(.ProseMirror s) {
  text-decoration: line-through;
  color: #909399;
}
</style>