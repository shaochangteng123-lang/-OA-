<template>
  <div class="today-log-container">
    <!-- 左侧：项目面板 -->
    <ProjectPanel
      :collapsed="leftCollapsed"
      :projects="projects"
      :added-project-ids="addedProjectIds"
      :active-project-id="activeProjectId"
      @toggle="leftCollapsed = !leftCollapsed"
      @add-project="handleAddProject"
    />

    <!-- 中间：Notion风格编辑区 -->
    <main class="editor-main">
      <el-scrollbar class="editor-scrollbar">
        <div class="editor-container">
          <!-- 页面标题栏 -->
          <div class="page-header">
            <div class="date-info">
              <div class="date-primary">{{ formattedDate }}</div>
              <div class="date-secondary">{{ weekday }}</div>
            </div>
          </div>

          <!-- 日志标题 -->
          <div class="title-section">
            <el-input
              v-model="title"
              placeholder="无标题（选填，保存时自动生成）"
              size="large"
              class="title-input"
              @input="hasUnsavedChanges = true"
              @keydown.enter="handleTitleEnter"
            />
          </div>

          <!-- Notion风格编辑器 -->
          <NotionEditor
            ref="editorRef"
            v-model="editorData"
            @change="handleEditorChange"
            @selection-change="handleSelectionChange"
            @update:added-project-ids="addedProjectIds = $event"
          />
        </div>
      </el-scrollbar>
    </main>

    <!-- 右侧：工具面板 -->
    <SidePanel
      :collapsed="rightCollapsed"
      :clipboard-text="clipboardText"
      :recent-logs="recentLogs"
      @toggle="rightCollapsed = !rightCollapsed"
      @paste="handlePasteFromClipboard"
      @log-click="handleLogClick"
    />

    <!-- 底部：浮动操作栏 -->
    <FloatingActionBar
      :has-unsaved-changes="hasUnsavedChanges"
      :last-saved="lastSaved"
      :is-saving="isSaving"
      @clear="handleClear"
      @save="handleSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '@/utils/api'
import { format, parse, isValid } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { Project, WorkLog } from '@/types'

import ProjectPanel from '@/components/worklog/ProjectPanel.vue'
import SidePanel from '@/components/worklog/SidePanel.vue'
import NotionEditor from '@/components/worklog/NotionEditor.vue'
import FloatingActionBar from '@/components/worklog/FloatingActionBar.vue'

const route = useRoute()

// 面板折叠状态
const leftCollapsed = ref(false)
const rightCollapsed = ref(false)

// 日期信息 - 支持从 URL 参数读取
function getDateFromQuery(): Date {
  const dateParam = route.query.date as string
  if (dateParam) {
    const parsedDate = parse(dateParam, 'yyyy-MM-dd', new Date())
    if (isValid(parsedDate)) {
      return parsedDate
    }
  }
  return new Date()
}

const currentDate = ref(getDateFromQuery())
const todayDate = computed(() => format(currentDate.value, 'yyyy-MM-dd'))
const formattedDate = computed(() => format(currentDate.value, 'yyyy年MM月dd日', { locale: zhCN }))
const weekday = computed(() => format(currentDate.value, 'EEEE', { locale: zhCN }))

// 日志数据
const title = ref('')
const editorData = ref<string>('')

// 编辑状态
const editorRef = ref<InstanceType<typeof NotionEditor> | null>(null)
const hasUnsavedChanges = ref(false)
const lastSaved = ref<string | null>(null)
const isSaving = ref(false)

// 项目数据
const projects = ref<Project[]>([])
const addedProjectIds = ref<string[]>([]) // 暂时保留空数组以满足 ProjectPanel 的 prop 要求
const activeProjectId = ref<string | null>(null) // 当前光标所在的项目ID

// 剪切板和历史
const clipboardText = ref('')
const recentLogs = ref<WorkLog[]>([])

// 自动保存定时器
let autoSaveTimer: number | null = null
// 日期检查定时器
let dateCheckTimer: number | null = null
// 最后检查的日期（用于检测跨日）
let lastCheckedDate = format(new Date(), 'yyyy-MM-dd')

// 响应式检测
onMounted(() => {
  const handleResize = () => {
    const width = window.innerWidth
    if (width < 1440 && width >= 1024) {
      rightCollapsed.value = true
    }
    if (width < 1024) {
      leftCollapsed.value = true
      rightCollapsed.value = true
    }
  }
  handleResize()
  window.addEventListener('resize', handleResize)

  // 加载数据
  loadProjects()
  loadTodayWorklog()
  loadRecentLogs()

  // 启动自动保存
  startAutoSave()

  // 启动日期检查
  startDateCheck()

  // 键盘快捷键
  document.addEventListener('keydown', handleKeyDown)

  return () => {
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('keydown', handleKeyDown)
  }
})

onUnmounted(() => {
  stopAutoSave()
  stopDateCheck()
  // 组件卸载时，如果有未保存的更改，立即保存草稿
  if (hasUnsavedChanges.value) {
    saveDraft()
  }
})

// 键盘快捷键
function handleKeyDown(e: KeyboardEvent) {
  // Ctrl+S 保存
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    handleSave()
  }
}

// 加载项目
async function loadProjects() {
  try {
    const response = await api.get('/api/projects')
    if (response.data.success) {
      projects.value = response.data.data
    }
  } catch (error) {
    console.error('加载项目失败:', error)
  }
}

// 加载今日日志
async function loadTodayWorklog() {
  try {
    const response = await api.get('/api/worklogs', {
      params: { date: todayDate.value },
    })
    if (response.data.success && response.data.data.length > 0) {
      const worklog = response.data.data[0]
      title.value = worklog.title
      editorData.value = worklog.content || ''
      lastSaved.value = worklog.updatedAt
    } else {
      // 加载草稿
      await loadDraft()
    }
  } catch (error) {
    console.error('加载今日日志失败:', error)
  }
}

// 加载草稿
async function loadDraft() {
  try {
    const response = await api.get('/api/drafts', {
      params: { date: todayDate.value },
    })
    if (response.data.success && response.data.data) {
      const draft = response.data.data
      title.value = draft.title || ''
      if (draft.pagesJson) {
        const draftData = JSON.parse(draft.pagesJson)
        if (draftData.content) {
          editorData.value = draftData.content
        }
      }
    }
  } catch (error) {
    console.error('加载草稿失败:', error)
  }
}

// 加载最近日志
async function loadRecentLogs() {
  try {
    const response = await api.get('/api/worklogs', {
      params: { limit: 5 },
    })
    if (response.data.success) {
      recentLogs.value = response.data.data
    }
  } catch (error) {
    console.error('加载最近日志失败:', error)
  }
}

// 编辑器内容变化时的处理
function handleEditorChange() {
  hasUnsavedChanges.value = true
  updateActiveProject()
}

// 编辑器选区变化时的处理
function handleSelectionChange() {
  updateActiveProject()
}

// 更新当前活动的项目ID
function updateActiveProject() {
  if (editorRef.value) {
    activeProjectId.value = editorRef.value.getCurrentProjectId()
  }
}

// 标题按下回车键时，跳转到总体工作区域
function handleTitleEnter(event: Event | KeyboardEvent) {
  event.preventDefault()
  if (!editorRef.value) return

  // 调用编辑器的方法，将光标移到总体工作段落的末尾
  editorRef.value.focusOverallEnd()
}

// 添加项目
function handleAddProject(project: Project) {
  if (!editorRef.value) return

  // 调用编辑器的添加项目方法
  editorRef.value.addProject({
    id: project.id,
    name: project.name,
  })

  hasUnsavedChanges.value = true
  ElMessage.success(`已添加项目：${project.name}`)
}

// 清空（浮动按钮已有确认弹窗，这里直接执行清空）
function handleClear() {
  title.value = ''
  editorData.value = '<h3 data-heading-type="overall" style="color: #8B4513">总体工作</h3><p data-segment-type="overall" style="color: #8B4513"></p>'
  hasUnsavedChanges.value = false
  ElMessage.success('已清空')
}

// 从剪切板粘贴
async function handlePasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    clipboardText.value = text
    ElMessage.success('剪切板内容已更新')
  } catch {
    ElMessage.error('无法读取剪切板')
  }
}

// 点击历史日志
function handleLogClick(_log: unknown) {
  ElMessage.info('查看历史日志功能开发中...')
}

// 保存草稿
async function saveDraft() {
  try {
    await api.post('/api/drafts', {
      date: todayDate.value,
      title: title.value,
      pages: { content: editorData.value },
    })
  } catch (error) {
    console.error('保存草稿失败:', error)
  }
}

// 自动保存
function startAutoSave() {
  autoSaveTimer = window.setInterval(() => {
    if (hasUnsavedChanges.value) {
      saveDraft()
    }
  }, 10000) // 10秒自动保存一次
}

function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer)
    autoSaveTimer = null
  }
}

// 日期检查 - 检测跨日并自动保存
function startDateCheck() {
  dateCheckTimer = window.setInterval(() => {
    checkDateChange()
  }, 60000) // 每分钟检查一次
}

function stopDateCheck() {
  if (dateCheckTimer) {
    clearInterval(dateCheckTimer)
    dateCheckTimer = null
  }
}

async function checkDateChange() {
  const newDate = format(new Date(), 'yyyy-MM-dd')

  if (newDate !== lastCheckedDate) {
    // 日期发生变化，保存昨日内容
    const oldDate = lastCheckedDate
    lastCheckedDate = newDate

    // 如果有内容，保存为昨日日志（无论是否有未保存的更改）
    const hasContent =
      editorData.value &&
      editorData.value.trim() &&
      editorData.value !==
        '<h3 data-heading-type="overall" style="color: #8B4513">总体工作</h3><p></p>'

    if (hasContent) {
      try {
        // 生成标题
        let finalTitle = title.value.trim()
        if (!finalTitle) {
          finalTitle = generateTitleFromContent(editorData.value)
        }

        // 保存为昨日日志
        await api.post('/api/worklogs', {
          date: oldDate,
          title: finalTitle,
          content: editorData.value,
        })

        ElMessage.success(`已自动保存 ${oldDate} 的日志`)

        // 删除昨日草稿
        await api.delete('/api/drafts', {
          params: { date: oldDate },
        })
      } catch (error) {
        console.error('保存昨日日志失败:', error)
        ElMessage.error('保存昨日日志失败')
      }
    }

    // 清空编辑器，加载新日期的日志
    title.value = ''
    editorData.value = '<h3 data-heading-type="overall" style="color: #8B4513">总体工作</h3><p data-segment-type="overall" style="color: #8B4513"></p>'
    hasUnsavedChanges.value = false
    lastSaved.value = null

    // 重新加载今日日志
    await loadTodayWorklog()
    await loadRecentLogs()
  }
}

// 从内容中提取项目名称生成标题
function generateTitleFromContent(content: string): string {
  // 创建临时DOM元素来解析HTML
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = content

  // 查找所有h3标题
  const headings = tempDiv.querySelectorAll('h3')
  const projectNames: string[] = []

  headings.forEach((h3) => {
    const headingType = h3.getAttribute('data-heading-type')
    const text = h3.textContent?.trim() || ''
    // 排除"总体工作"（headingType === 'overall'）
    if (text && headingType !== 'overall') {
      projectNames.push(text)
    }
  })

  if (projectNames.length === 0) {
    return '工作日志'
  }

  // 拼接项目名称
  let generatedTitle = projectNames.join('、')

  // 限制长度为10个字符，确保第10个字符是"…"
  if (generatedTitle.length > 10) {
    generatedTitle = generatedTitle.substring(0, 9) + '…'
  }

  return generatedTitle
}

// 从内容中提取项目信息
function extractProjectsFromContent(content: string): Array<{
  projectId: string
  projectName: string
  content: string
}> {
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = content

  const projects: Array<{ projectId: string; projectName: string; content: string }> = []
  const elements = Array.from(tempDiv.children) as HTMLElement[]

  let currentProjectId: string | null = null
  let currentProjectName: string | null = null
  let currentProjectContent: string[] = []

  elements.forEach((el) => {
    if (el.tagName === 'H3' && el.getAttribute('data-heading-type') === 'project') {
      // 保存上一个项目
      if (currentProjectId && currentProjectName) {
        projects.push({
          projectId: currentProjectId,
          projectName: currentProjectName,
          content: currentProjectContent.join('\n'),
        })
      }

      // 开始新项目
      currentProjectId = el.getAttribute('data-project-id')
      currentProjectName = el.textContent?.trim() || ''
      currentProjectContent = []
    } else if (
      el.tagName === 'P' &&
      el.getAttribute('data-segment-type') === 'project' &&
      currentProjectId
    ) {
      // 收集项目段落内容
      const textContent = el.textContent?.trim() || ''
      if (textContent) {
        currentProjectContent.push(textContent)
      }
    }
  })

  // 保存最后一个项目
  if (currentProjectId && currentProjectName) {
    projects.push({
      projectId: currentProjectId,
      projectName: currentProjectName,
      content: currentProjectContent.join('\n'),
    })
  }

  return projects
}

// 保存日志
async function handleSave() {
  isSaving.value = true

  try {
    // 获取编辑器数据
    const content = editorData.value

    // 验证
    if (!content || content.length < 10) {
      ElMessage.warning('日志内容至少10个字符')
      isSaving.value = false
      return
    }

    // 如果标题为空，自动生成
    let finalTitle = title.value.trim()
    if (!finalTitle) {
      finalTitle = generateTitleFromContent(content)
      title.value = finalTitle // 更新显示的标题
    }

    // 提取项目信息
    const projects = extractProjectsFromContent(content)

    // 检查是否已有今日日志
    const existingRes = await api.get('/api/worklogs', {
      params: { date: todayDate.value },
    })

    const payload: Record<string, unknown> = {
      date: todayDate.value,
      title: finalTitle,
      content,
      projects, // 添加项目信息
    }

    // 如果存在，添加id字段触发更新
    if (existingRes.data.success && existingRes.data.data.length > 0) {
      payload.id = existingRes.data.data[0].id
    }

    await api.post('/api/worklogs', payload)

    ElMessage.success('保存成功')
    hasUnsavedChanges.value = false
    lastSaved.value = new Date().toISOString()

    // 删除草稿
    await api.delete('/api/drafts', {
      params: { date: todayDate.value },
    })
  } catch (error) {
    ElMessage.error('保存失败')
    console.error(error)
  } finally {
    isSaving.value = false
  }
}
</script>

<style scoped>
/* ========== 今日日志编辑器 - Notion风格 ========== */

/* 容器高度填满可用空间，使用负 margin 抵消 MainLayout 的 padding */
.today-log-container {
  display: flex;
  height: calc(100vh - 60px);
  background: #ffffff;
  overflow: hidden;
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
}

/* ========== 编辑器主区域 ========== */

.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #ffffff;
}

.editor-scrollbar {
  flex: 1;
  padding: 0 0 120px;
}

.editor-container {
  max-width: min(900px, 100%);
  margin: 0 auto;
  padding: 60px 96px;
  min-height: 100%;
}

/* ========== 页面头部 ========== */

.page-header {
  margin-bottom: 24px;
}

.date-info {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.date-primary {
  font-size: 14px;
  font-weight: 400;
  color: #6b7280;
}

.date-secondary {
  font-size: 13px;
  color: #9ca3af;
}

/* ========== 标题区域 ========== */

.title-section {
  margin-bottom: 32px;
}

.title-input {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

:deep(.title-input .el-input__wrapper) {
  border: none;
  background: transparent;
  box-shadow: none;
  padding: 0;
}

:deep(.title-input .el-input__inner) {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  line-height: 1.2;
}

:deep(.title-input .el-input__inner::placeholder) {
  color: #d1d5db;
}

/* ========== 响应式设计 ========== */

@media (max-width: 1366px) {
  .editor-container {
    padding: 40px 48px;
  }
}

@media (max-width: 1024px) {
  .editor-container {
    padding: 30px 24px;
  }
}

@media (max-width: 768px) {
  .editor-container {
    padding: 24px 32px;
  }

  .title-input {
    font-size: 22px;
  }

  :deep(.title-input .el-input__inner) {
    font-size: 22px;
  }

  .date-primary {
    font-size: 13px;
  }

  .date-secondary {
    font-size: 12px;
  }
}

/* ========== 打印样式 ========== */

@media print {
  .today-log-container {
    display: block;
    background: white;
  }

  .editor-main {
    background: white;
  }

  .editor-scrollbar {
    padding: 0;
  }

  .editor-container {
    max-width: none;
    padding: 20mm;
  }
}
</style>
