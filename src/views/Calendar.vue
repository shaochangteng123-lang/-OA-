<template>
  <div class="calendar-container" :style="{ background: mainBackground }">
    <!-- 左栏：可折叠侧边栏 -->
    <div class="calendar-sidebar" :class="{ collapsed: leftCollapsed }">
      <!-- 优化模块19：顶部折叠按钮区域，仅显示 < 符号，整个区域可点击 -->
      <div class="sidebar-header" @click="leftCollapsed = !leftCollapsed">
        <span class="collapse-arrow">&lt;</span>
      </div>

      <!-- 侧边栏内容 -->
      <div class="sidebar-content">
        <!-- 迷你日历 -->
        <MiniCalendar @date-click="handleMiniCalendarDateClick" />

        <!-- 颜色标签面板 -->
        <ColorLabelPanel />
      </div>
    </div>

    <!-- 优化模块19：左栏折叠状态下的展开按钮，仅显示 > 符号 -->
    <div v-if="leftCollapsed" class="sidebar-collapsed" @click="leftCollapsed = false">
      <div class="collapsed-header">
        <span class="collapse-arrow">&gt;</span>
      </div>
    </div>

    <!-- 中栏：主日历视图 -->
    <div class="calendar-main" :style="{ background: mainBackground }">
      <!-- 工具栏（与左栏、右栏顶部高度一致：60px） -->
      <div class="calendar-toolbar" :class="{ 'fixed-width': viewMode === 'month' }">
        <!-- 左侧:导航按钮 + 提示标签 + 日期信息 -->
        <div class="toolbar-left">
          <!-- 导航按钮 -->
          <el-button-group class="nav-buttons">
            <el-button :icon="ArrowLeft" @click="navigatePrev" size="small" />
            <el-button :icon="ArrowRight" @click="navigateNext" size="small" />
          </el-button-group>

          <!-- 提示标签 -->
          <el-tag v-if="monthHintText" :type="monthHintType" size="small" class="hint-tag">
            {{ monthHintText }}
          </el-tag>

          <!-- 日期信息 -->
          <span class="current-period">{{ currentPeriodText }}</span>
        </div>

        <!-- 右侧:今日按钮 + 视图切换 -->
        <div class="toolbar-right">
          <el-button @click="goToToday" size="small">今日</el-button>
          <el-radio-group v-model="viewMode" size="small">
            <el-radio-button value="month">月</el-radio-button>
            <el-radio-button value="week">周</el-radio-button>
            <el-radio-button value="day">日</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <!-- 视图内容 -->
      <div class="calendar-views">
        <component
          :is="currentViewComponent"
          :is-past-date="isPastDate"
          @day-double-click="handleDayDoubleClick"
          @create-event="handleCreateEvent"
          @event-click="handleEventClick"
          @edit-event="handleEventClick"
          @update-display-days="handleUpdateDisplayDays"
        />
      </div>
    </div>

    <!-- 右栏：事件编辑面板（始终占位） -->
    <div class="calendar-right-panel">
      <!-- 优化模块19：右栏顶部标题区域，过去日期显示警告标签 -->
      <div class="right-panel-header">
        <div class="panel-title-wrapper">
          <span class="panel-title">{{ rightPanelTitle }}</span>
          <el-tag v-if="showEditPanel && isPastDate && !editingEvent?.id" type="warning" size="small" class="past-date-tag">
            历史
          </el-tag>
        </div>
        <el-button v-if="showEditPanel" text :icon="Close" size="small" @click="handleCloseEditPanel" />
      </div>

      <!-- 右栏内容 -->
      <div class="right-panel-body">
        <EventEditPanel
          v-if="showEditPanel"
          :event="editingEvent"
          :is-past-date="isPastDate"
          @save="handleSaveEvent"
          @delete="handleDeleteEvent"
          @close="handleCloseEditPanel"
          @all-day-change="handleAllDayChange"
          @time-period-change="handleTimePeriodChange"
        />
        <div v-else class="right-panel-placeholder">
          <div class="placeholder-content">
            <el-icon :size="48" class="placeholder-icon"><Calendar /></el-icon>
            <p class="placeholder-text">选择或创建日程</p>
            <p class="placeholder-hint">双击日期或在周/日视图中拖拽选择时间段</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, provide, onMounted, watch } from 'vue'
import { ArrowLeft, ArrowRight, Close, Calendar } from '@element-plus/icons-vue' // ArrowLeft/Right用于导航按钮
import { ElMessage } from 'element-plus'
import { format, addMonths, addWeeks, addDays, isBefore, startOfDay } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { getWeekNumber } from '@/utils/calendar'
import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'
import type { CalendarEvent, ColorLabel, ViewMode } from '@/types/calendar'
import { DEFAULT_COLOR_LABELS } from '@/types/calendar'

import MiniCalendar from '@/components/calendar/MiniCalendar.vue'
import ColorLabelPanel from '@/components/calendar/ColorLabelPanel.vue'
import MonthView from '@/components/calendar/MonthView.vue'
import WeekView from '@/components/calendar/WeekView.vue'
import DayView from '@/components/calendar/DayView.vue'
import EventEditPanel from '@/components/calendar/EventEditPanel.vue'

const authStore = useAuthStore()

// 面板状态
const leftCollapsed = ref(false)
const showEditPanel = ref(false)
const isPastDate = ref(false) // 是否选中的是过去的日期

// 日期和视图状态
const selectedDate = ref(new Date()) // 左栏迷你日历选中的日期
const currentDate = ref(new Date()) // 中栏主视图显示的日期
const viewMode = ref<ViewMode>('month')
const weekDisplayDays = ref(7)

// 事件数据
const events = ref<CalendarEvent[]>([])
const editingEvent = ref<CalendarEvent | null>(null)

// 颜色标签
const colorLabels = ref<ColorLabel[]>(JSON.parse(JSON.stringify(DEFAULT_COLOR_LABELS)))

// 框选清除信号
const clearSelectionSignal = ref(0)

// 优化模块19：全天状态变化信号，用于更新框选范围
const allDaySignal = ref<{ allDay: boolean; date: string } | null>(null)

// 优化模块36：时间段变化信号，用于更新框选范围（上午/下午/晚上）
const timePeriodSignal = ref<{ startTime: string; endTime: string } | null>(null)

// 主背景色
const mainBackground = '#fafbfc'

// Provide 给子组件
provide('selectedDate', selectedDate)
provide('currentDate', currentDate)
provide('events', events)
provide('viewMode', viewMode)
provide('colorLabels', colorLabels)
provide('weekDisplayDays', weekDisplayDays)
provide('clearSelectionSignal', clearSelectionSignal)
provide('allDaySignal', allDaySignal)
provide('timePeriodSignal', timePeriodSignal)

// 监听视图模式切换（优化模块23：切换到周/日视图时重置为当天）
// 优化模块36：从周视图切换到日视图时，日视图默认显示当日
watch(viewMode, (newMode, oldMode) => {
  if (newMode === 'day') {
    // 切换到日视图时，始终重置为今天
    currentDate.value = new Date()
    selectedDate.value = new Date()
  } else if (newMode === 'week' && oldMode === 'month') {
    // 仅从月视图切换到周视图时重置为今天
    currentDate.value = new Date()
    selectedDate.value = new Date()
  }
})

// 当前视图组件
const currentViewComponent = computed(() => {
  switch (viewMode.value) {
    case 'month':
      return MonthView
    case 'week':
      return WeekView
    case 'day':
      return DayView
    default:
      return MonthView
  }
})

// 右栏标题
const rightPanelTitle = computed(() => {
  if (!showEditPanel.value) return '日程详情'
  if (editingEvent.value?.id) return '编辑日程'
  if (isPastDate.value) return '新建日程（历史日期）'
  return '新建日程'
})

// 当前时期文本（优化模块7：参照Notion Calendar格式）
const currentPeriodText = computed(() => {
  const monthYear = format(currentDate.value, 'M月 yyyy', { locale: zhCN })
  const weekNum = `第${getWeekNumber(currentDate.value)}周`

  if (viewMode.value === 'month') {
    return `${monthYear} · ${weekNum}`
  } else if (viewMode.value === 'week') {
    return `${monthYear} · ${weekNum}`
  } else {
    return format(currentDate.value, 'yyyy年M月d日', { locale: zhCN })
  }
})

// 月份提示文本
const monthHintText = computed(() => {
  const now = new Date()
  const monthDiff =
    currentDate.value.getMonth() -
    now.getMonth() +
    (currentDate.value.getFullYear() - now.getFullYear()) * 12

  if (viewMode.value === 'month') {
    if (monthDiff === 0) return '本月'
    if (monthDiff === 1) return '下月'
    if (monthDiff >= 2 && monthDiff <= 7) return `${monthDiff}月后`
    if (monthDiff >= 8) return '远期'
    if (monthDiff === -1) return '上月'
    if (monthDiff <= -2 && monthDiff >= -7) return `${-monthDiff}月前`
    if (monthDiff <= -8) return '远期'
  } else if (viewMode.value === 'week') {
    const weekDiff = getWeekNumber(currentDate.value) - getWeekNumber(now)
    if (weekDiff === 0) return '本周'
    if (weekDiff === 1) return '下周'
    if (weekDiff === -1) return '上周'
    if (weekDiff > 1) return `${weekDiff}周后`
    if (weekDiff < -1) return `${-weekDiff}周前`
  } else {
    // 日视图
    const dayDiff = Math.floor(
      (currentDate.value.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )
    if (dayDiff === 0) return '今日'
    if (dayDiff === 1) return '明日'
    if (dayDiff === -1) return '昨日'
    if (dayDiff > 1) return `${dayDiff}天后`
    if (dayDiff < -1) return `${-dayDiff}天前`
  }

  return ''
})

// 月份提示类型（颜色）
const monthHintType = computed(() => {
  const now = new Date()
  const monthDiff =
    currentDate.value.getMonth() -
    now.getMonth() +
    (currentDate.value.getFullYear() - now.getFullYear()) * 12

  if (monthDiff === 0) return 'success' // 本月 - 浅绿色
  if (monthDiff === 1 || monthDiff === -1) return 'warning' // 下月/上月 - 浅黄色
  if ((monthDiff >= 2 && monthDiff <= 7) || (monthDiff <= -2 && monthDiff >= -7)) return 'info' // 2-7月 - 浅紫色
  return 'danger' // 8个月及以上 - 红色
})

// 加载事件
async function loadEvents() {
  try {
    const response = await api.get('/api/calendar/events')
    if (response.data.success) {
      events.value = response.data.data || []
    }
  } catch (error) {
    console.error('加载日历事件失败:', error)
    ElMessage.error('加载日历事件失败')
  }
}

// 加载用户偏好设置
async function loadUserPreferences() {
  try {
    const response = await api.get('/api/user-preferences')
    if (response.data.success) {
      const prefs = response.data.data
      if (prefs.colorLabels) {
        colorLabels.value = prefs.colorLabels
      }
      // 默认视图模式为月视图，只有在用户明确保存了其他视图时才使用
      if (prefs.calendarViewMode && prefs.calendarViewMode !== 'week') {
        viewMode.value = prefs.calendarViewMode
      } else {
        // 确保默认是月视图
        viewMode.value = 'month'
      }
      if (prefs.weekDisplayDays) {
        weekDisplayDays.value = prefs.weekDisplayDays
      }
    }
  } catch (error) {
    console.error('加载用户偏好失败:', error)
  }
}

// 保存用户偏好设置
async function saveUserPreferences(updates: any) {
  try {
    await api.put('/api/user-preferences', updates)
  } catch (error) {
    console.error('保存用户偏好失败:', error)
  }
}

// 导航
function goToToday() {
  currentDate.value = new Date()
  selectedDate.value = new Date()
}

function navigatePrev() {
  if (viewMode.value === 'month') {
    currentDate.value = addMonths(currentDate.value, -1)
  } else if (viewMode.value === 'week') {
    currentDate.value = addWeeks(currentDate.value, -1)
  } else {
    currentDate.value = addDays(currentDate.value, -1)
  }
}

function navigateNext() {
  if (viewMode.value === 'month') {
    currentDate.value = addMonths(currentDate.value, 1)
  } else if (viewMode.value === 'week') {
    currentDate.value = addWeeks(currentDate.value, 1)
  } else {
    currentDate.value = addDays(currentDate.value, 1)
  }
}

// 迷你日历日期点击
function handleMiniCalendarDateClick(date: Date) {
  selectedDate.value = date
  currentDate.value = date

  // 如果是周视图，点击日期时更新到该日期所在的周
  if (viewMode.value === 'week') {
    // 周视图已经通过currentDate更新了，无需额外处理
  }
}

// 月视图双击日期（优化模块22：不更新currentDate，避免表格晃动）
function handleDayDoubleClick(date: Date) {
  // 只更新selectedDate，不更新currentDate，避免月视图表头重新计算导致晃动
  selectedDate.value = date

  // 检测是否是过去的日期
  const today = startOfDay(new Date())
  isPastDate.value = isBefore(startOfDay(date), today)

  // 创建新事件，开始时间为选中日期的09:00（早上9点整）
  const startTime = new Date(date)
  startTime.setHours(9, 0, 0, 0)
  const endTime = new Date(startTime)
  endTime.setHours(10, 0, 0, 0) // 结束时间为10:00

  handleCreateEvent(startTime, endTime)
}

// 创建事件
function handleCreateEvent(startTime: Date, endTime: Date) {
  editingEvent.value = {
    id: '',
    title: '',
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    allDay: false,
    color: colorLabels.value[0]?.color || '#3b82f6',
    colorLabel: colorLabels.value[0]?.id || '',
    userId: authStore.user?.id || '',
  }
  showEditPanel.value = true
}

// 事件点击
function handleEventClick(event: CalendarEvent) {
  editingEvent.value = event
  showEditPanel.value = true
}

// 保存事件
async function handleSaveEvent(eventData: Partial<CalendarEvent>) {
  try {
    if (eventData.id) {
      // 更新事件
      const response = await api.put(`/api/calendar/events/${eventData.id}`, eventData)
      if (response.data.success) {
        ElMessage.success('日程已更新')
        await loadEvents()
        handleCloseEditPanel()
      }
    } else {
      // 创建新事件
      const response = await api.post('/api/calendar/events', eventData)
      if (response.data.success) {
        ElMessage.success('日程已创建')
        await loadEvents()
        handleCloseEditPanel()
      }
    }
  } catch (error) {
    console.error('保存事件失败:', error)
    ElMessage.error('保存事件失败')
  }
}

// 删除事件
async function handleDeleteEvent(eventId: string) {
  try {
    const response = await api.delete(`/api/calendar/events/${eventId}`)
    if (response.data.success) {
      ElMessage.success('日程已删除')
      await loadEvents()
      handleCloseEditPanel()
    }
  } catch (error) {
    console.error('删除事件失败:', error)
    ElMessage.error('删除事件失败')
  }
}

// 关闭编辑面板（优化模块23：清除选中状态但不改变日期背景色）
function handleCloseEditPanel() {
  showEditPanel.value = false
  editingEvent.value = null
  // 触发清除选择框信号（清除框选高亮和双击选中状态）
  clearSelectionSignal.value++
}

// 更新周显示天数
function handleUpdateDisplayDays(days: number) {
  weekDisplayDays.value = days
  saveUserPreferences({ weekDisplayDays: days })
}

// 优化模块19：处理全天状态变化，更新框选范围
function handleAllDayChange(allDay: boolean, startDate: string, _endDate: string) {
  allDaySignal.value = { allDay, date: startDate }
}

// 优化模块36：处理时间段变化（上午/下午/晚上），更新框选范围
function handleTimePeriodChange(startTime: string, endTime: string) {
  timePeriodSignal.value = { startTime, endTime }
}

// 初始化
onMounted(async () => {
  await loadUserPreferences()
  await loadEvents()
})
</script>

<style scoped>
/* 日历容器高度填满可用空间
   计算：100vh - 60px(顶栏) = 100vh - 60px
   使用负 margin 抵消 MainLayout 的 padding */
.calendar-container {
  display: flex;
  height: calc(100vh - 60px);
  overflow: hidden;
  position: relative;
  margin: calc(-1 * var(--yl-main-padding-y, 24px)) calc(-1 * var(--yl-main-padding-x, 45px));
}

/* 左栏侧边栏（优化模块22：背景改为白色） */
.calendar-sidebar {
  width: 280px;
  min-width: 220px;
  border-right: 1px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  position: relative;
  background: #ffffff;
  flex-shrink: 0;
}

@media (max-width: 1366px) {
  .calendar-sidebar {
    width: 240px;
    min-width: 200px;
  }
}

.calendar-sidebar.collapsed {
  width: 0;
  overflow: hidden;
  border-right: none;
}

/* 左栏顶部折叠按钮区域（优化模块23：高度60px，背景白色） */
.sidebar-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 16px;
  border-bottom: 1px solid #e5e7eb;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
  background: #ffffff;
}

.sidebar-header:hover {
  background: #f5f5f5;
}

/* 优化模块19：折叠箭头样式（仅显示 < 或 > 符号） */
.collapse-arrow {
  font-size: 16px;
  font-weight: 600;
  color: #6b7280;
  transition: color 0.2s;
  user-select: none;
}

.sidebar-header:hover .collapse-arrow,
.collapsed-header:hover .collapse-arrow {
  color: #374151;
}

/* 折叠状态下的展开按钮（优化模块22：背景改为白色） */
.sidebar-collapsed {
  width: 40px;
  border-right: 1px solid #e5e7eb;
  background: #ffffff;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.2s;
}

.sidebar-collapsed:hover {
  background: #f3f4f6;
}

.collapsed-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #e5e7eb;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

/* 中栏主视图 */
.calendar-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: #ffffff;
}

/* 中栏工具栏（高度60px，与左栏、右栏一致） */
.calendar-toolbar {
  height: 60px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
  background: #ffffff;
  gap: 16px;
}

/* 优化模块31：移除月视图工具栏固定宽度，改为自适应 */
.calendar-toolbar.fixed-width {
  width: 100%;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
}

.nav-buttons {
  flex-shrink: 0;
}

.current-period {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  white-space: nowrap;
  flex-shrink: 0;
}

.hint-tag {
  flex-shrink: 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.calendar-views {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #ffffff;
}

/* 右栏编辑面板 */
.calendar-right-panel {
  width: 380px;
  border-left: 1px solid #e5e7eb;
  background: #f9fafb;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

@media (max-width: 1366px) {
  .calendar-right-panel {
    width: 320px;
  }
}

/* 右栏顶部标题区域（高度60px，与左栏、中栏一致） */
.right-panel-header {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid #e5e7eb;
  background: #f9fafb;
  flex-shrink: 0;
}

/* 优化模块19：标题包装器，支持标题和标签并排 */
.panel-title-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

/* 优化模块19：过去日期警告标签 */
.past-date-tag {
  flex-shrink: 0;
}

.right-panel-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.right-panel-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

.placeholder-content {
  text-align: center;
}

.placeholder-icon {
  color: #d1d5db;
  margin-bottom: 16px;
}

.placeholder-text {
  font-size: 16px;
  font-weight: 500;
  color: #6b7280;
  margin: 0 0 8px 0;
}

.placeholder-hint {
  font-size: 13px;
  color: #9ca3af;
  margin: 0;
}
</style>
