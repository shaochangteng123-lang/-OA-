<template>
  <div class="week-view">
    <!-- 周视图头部（优化模块8、13：固定高度60px，头部样式优化） -->
    <div class="week-header">
      <!-- 左上角全天占位 -->
      <div class="time-axis-placeholder">
        <span class="all-day-label">全天</span>
      </div>

      <!-- 日期列（优化模块17：周一15格式，当日红色矩形圆角背景） -->
      <div
        v-for="day in weekDays"
        :key="day.date.toISOString()"
        class="day-header"
        :class="{ today: day.isToday, weekend: day.isWeekend }"
      >
        <div class="day-label-combined">
          <span v-if="!day.isToday" class="combined-text">
            周{{ day.weekday }}<span class="day-num">{{ day.date.getDate() }}</span>
          </span>
          <span v-else class="combined-text">
            周{{ day.weekday }}<span class="day-num today-badge-num">{{ day.date.getDate() }}</span>
          </span>
          <!-- 节假日/补班标签 -->
          <span
            v-if="day.holidayLabel"
            class="holiday-label"
            :class="{
              'holiday-rest': day.holidayType === 'holiday',
              'holiday-work': day.holidayType === 'workday'
            }"
          >
            {{ day.holidayLabel }}
          </span>
        </div>
      </div>

    </div>

    <!-- 优化模块19：浮动的 ± 按钮，弹窗格式为 "+天数-" -->
    <div class="floating-days-btn">
      <el-popover placement="bottom" :width="140" trigger="click">
        <template #reference>
          <el-button circle size="small" class="days-toggle-btn">±</el-button>
        </template>
        <div class="days-adjuster">
          <el-button
            text
            size="small"
            class="adjust-btn"
            :disabled="displayDays >= 14"
            @click="adjustDays(1)"
          >
            +
          </el-button>
          <span class="days-count">{{ displayDays }}天</span>
          <el-button
            text
            size="small"
            class="adjust-btn"
            :disabled="displayDays <= 1"
            @click="adjustDays(-1)"
          >
            −
          </el-button>
        </div>
      </el-popover>
    </div>

    <!-- 优化模块19：周视图内容，时间轴与表格一起滚动 -->
    <div class="week-content" ref="contentRef" :class="{ 'content-ready': isContentReady }">
      <!-- 优化模块19：统一滚动容器，时间轴和网格一起滚动 -->
      <div class="week-scroll-container" ref="gridContainerRef">
        <!-- 左侧时间轴 -->
        <TimeAxis
          :pixels-per-hour="pixelsPerHour"
          :start-hour="startHour"
          :end-hour="endHour"
          :show-current-time="true"
          :date="currentDate"
        />

        <!-- 时间网格容器 -->
        <div class="week-grid-container">
          <div
            v-for="day in weekDays"
            :key="day.date.toISOString()"
            ref="columnRefs"
            class="day-column"
            :class="{ today: day.isToday, weekend: day.isWeekend }"
            :style="{ height: `${totalHeight}px` }"
            @mousedown="(e) => handleMouseDown(e, day)"
          >
            <!-- 小时网格线（仅整点线，无半小时线） -->
            <div
              v-for="hour in hours"
              :key="hour"
              class="hour-block"
              :style="{ height: `${pixelsPerHour}px` }"
            ></div>

            <!-- 事件卡片（优化模块21：不显示时间，只显示内容） -->
            <EventCard
              v-for="layout in getDayEventLayouts(day.date)"
              :key="layout.event.id"
              :event="layout.event"
              :layout="layout"
              :show-time="false"
              :is-past="isEventPast(layout.event)"
              @click="$emit('eventClick', layout.event)"
            />
          </div>

          <!-- 框选高亮（优化模块12、14、17：持续显示直到保存或取消） -->
          <SelectionBox v-if="hasSelection && selectionBox" :selection="selectionBox" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick, type Ref } from 'vue'
// Plus, Minus 图标已不再使用，改用纯文字 + 和 −
import { startOfWeek, addDays } from 'date-fns'
import {
  pixelsToTime,
  timeToPixels,
  snapToGrid,
  calculateEventLayouts,
  isToday as checkIsToday,
  isWeekend as checkIsWeekend,
  getWeekdayShort,
  isEventPast,
} from '@/utils/calendar'
import { getHolidayInfoSync, getHolidayLabel } from '@/utils/holidays'
import type { CalendarEvent, EventLayout, SelectionBox as SelectionBoxType } from '@/types/calendar'
import TimeAxis from './TimeAxis.vue'
import EventCard from './EventCard.vue'
import SelectionBox from './SelectionBox.vue'

// Inject 父组件状态
const currentDate = inject<Ref<Date>>('currentDate')!
const events = inject<Ref<CalendarEvent[]>>('events')!
const weekDisplayDays = inject<Ref<number>>('weekDisplayDays', ref(7))
const clearSelectionSignal = inject<Ref<number>>('clearSelectionSignal', ref(0))
// 优化模块19：监听全天状态变化
const allDaySignal = inject<Ref<{ allDay: boolean; date: string } | null>>('allDaySignal', ref(null))
// 优化模块36：监听时间段变化（上午/下午/晚上）
const timePeriodSignal = inject<Ref<{ startTime: string; endTime: string } | null>>('timePeriodSignal', ref(null))

// Refs
const contentRef = ref<HTMLElement | null>(null)
const gridContainerRef = ref<HTMLElement | null>(null)
const columnRefs = ref<HTMLElement[]>([])
const isDragging = ref(false)
const hasSelection = ref(false)
const selectionBox = ref<SelectionBoxType | null>(null)
const displayDays = ref(weekDisplayDays.value)

// 优化模块31：标记是否已滚动到当前时间（仅首次进入时居中）
const hasScrolledToCurrentTime = ref(false)
// 优化模块35：控制内容可见性，防止滚动前闪动
const isContentReady = ref(false)

// 配置常量（优化模块8：从0AM开始）
const pixelsPerHour = 60
const startHour = 0
const endHour = 24
const gridMinutes = 15

// Emit
const emit = defineEmits<{
  createEvent: [startTime: Date, endTime: Date]
  eventClick: [event: CalendarEvent]
  updateDisplayDays: [days: number]
}>()

// 计算属性
const weekDays = computed(() => {
  const weekStart = startOfWeek(currentDate.value, { weekStartsOn: 1 })
  const days = []

  for (let i = 0; i < displayDays.value; i++) {
    const date = addDays(weekStart, i)
    const holidayInfo = getHolidayInfoSync(date)
    const holidayLabel = getHolidayLabel(date)

    days.push({
      date,
      dayName: `周${getWeekdayShort(date)}`,
      weekday: getWeekdayShort(date),
      isToday: checkIsToday(date),
      isWeekend: checkIsWeekend(date),
      holidayLabel,
      holidayType: holidayInfo?.type || null,
    })
  }

  return days
})

const hours = computed(() => {
  const result: number[] = []
  for (let i = startHour; i < endHour; i++) {
    result.push(i)
  }
  return result
})

const totalHeight = computed(() => {
  return (endHour - startHour) * pixelsPerHour
})

// 获取某一天的事件布局
function getDayEventLayouts(date: Date): EventLayout[] {
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(23, 59, 59, 999)

  const dayEvents = events.value.filter((event) => {
    const eventStart = new Date(event.startTime)
    const eventEnd = new Date(event.endTime)
    return eventStart <= dayEnd && eventEnd >= dayStart
  })

  return calculateEventLayouts(dayEvents, pixelsPerHour)
}

// 调整显示天数（优化模块21：允许大于7天，最多14天）
function adjustDays(delta: number) {
  const newDays = Math.max(1, Math.min(14, displayDays.value + delta))
  displayDays.value = newDays
  weekDisplayDays.value = newDays
  emit('updateDisplayDays', newDays)
}

// 鼠标按下开始框选（优化模块17：开始新框选时清除旧框选）
function handleMouseDown(event: MouseEvent, day: any) {
  const columnIndex = weekDays.value.findIndex((d) => d.date.getTime() === day.date.getTime())
  if (columnIndex === -1 || !gridContainerRef.value) return

  // 如果已经有选择框，先清除（开始新的选择）
  if (hasSelection.value) {
    clearSelection()
  }

  const rect = gridContainerRef.value.getBoundingClientRect()
  const y = event.clientY - rect.top + gridContainerRef.value.scrollTop

  const startTime = pixelsToTime(y, day.date, pixelsPerHour)
  const snappedStart = snapToGrid(startTime, gridMinutes)

  isDragging.value = true
  hasSelection.value = false // 拖拽时暂不显示

  selectionBox.value = {
    top: y,
    height: 0,
    start: snappedStart,
    end: snappedStart,
    column: columnIndex,
  }

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)

  event.preventDefault()
  event.stopPropagation() // 阻止事件冒泡
}

// 鼠标移动更新框选
function handleMouseMove(event: MouseEvent) {
  if (!isDragging.value || !selectionBox.value || !gridContainerRef.value) return

  const rect = gridContainerRef.value.getBoundingClientRect()
  const y = event.clientY - rect.top + gridContainerRef.value.scrollTop
  const startY = selectionBox.value.top

  const column = selectionBox.value.column || 0
  const dayDate = weekDays.value[column]?.date || currentDate.value

  const endTime = pixelsToTime(y, dayDate, pixelsPerHour)
  const snappedEnd = snapToGrid(endTime, gridMinutes)

  if (y > startY) {
    selectionBox.value = {
      ...selectionBox.value,
      height: y - startY,
      end: snappedEnd,
    }
  } else {
    const newStart = pixelsToTime(y, dayDate, pixelsPerHour)
    const snappedNewStart = snapToGrid(newStart, gridMinutes)

    selectionBox.value = {
      top: y,
      height: startY - y,
      start: snappedNewStart,
      end: selectionBox.value.start,
      column: column,
    }
  }

  hasSelection.value = true
}

// 鼠标松开完成框选（优化模块12、14、17：框不立即消失）
function handleMouseUp() {
  if (!isDragging.value || !selectionBox.value) return

  isDragging.value = false

  const { start, end } = selectionBox.value

  const minDuration = gridMinutes * 60 * 1000
  if (end.getTime() - start.getTime() >= minDuration) {
    hasSelection.value = true // 保持选择框显示
    emit('createEvent', start, end)
    // 选择框会在事件保存或取消时由父组件触发清除（通过 clearSelectionSignal）
  } else {
    clearSelection()
  }

  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

// 清除选择框
function clearSelection() {
  isDragging.value = false
  hasSelection.value = false
  selectionBox.value = null
}

// 监听父组件的清除信号
watch(clearSelectionSignal, () => {
  clearSelection()
})

// 优化模块19：监听全天状态变化，更新框选范围
watch(allDaySignal, (signal) => {
  if (!signal || !selectionBox.value) return

  if (signal.allDay) {
    // 勾选全天：框选范围变为整天（0:00 - 24:00）
    const dateStr = signal.date
    const startTime = new Date(`${dateStr}T00:00:00`)
    const endTime = new Date(`${dateStr}T23:59:59`)

    selectionBox.value = {
      ...selectionBox.value,
      top: 0,
      height: totalHeight.value,
      start: startTime,
      end: endTime,
    }
  } else {
    // 取消全天：恢复默认时间段（9:00 - 10:00）
    const dateStr = signal.date
    const startTime = new Date(`${dateStr}T09:00:00`)
    const endTime = new Date(`${dateStr}T10:00:00`)

    const startY = timeToPixels(startTime, pixelsPerHour)
    const endY = timeToPixels(endTime, pixelsPerHour)

    selectionBox.value = {
      ...selectionBox.value,
      top: startY,
      height: endY - startY,
      start: startTime,
      end: endTime,
    }
  }
}, { deep: true })

// 优化模块36：监听时间段变化（上午/下午/晚上），更新框选范围
watch(timePeriodSignal, (signal) => {
  if (!signal || !selectionBox.value) return

  // 解析时间字符串（格式：YYYY-MM-DD HH:mm:ss）
  const startTime = new Date(signal.startTime.replace(' ', 'T'))
  const endTime = new Date(signal.endTime.replace(' ', 'T'))

  const startY = timeToPixels(startTime, pixelsPerHour)
  const endY = timeToPixels(endTime, pixelsPerHour)

  selectionBox.value = {
    ...selectionBox.value,
    top: startY,
    height: endY - startY,
    start: startTime,
    end: endTime,
  }
}, { deep: true })

// 优化模块35：滚动到当前时间（优化：先隐藏内容，滚动后再显示，避免闪动）
function scrollToCurrentTime() {
  // 如果已经滚动过，不再自动滚动
  if (hasScrolledToCurrentTime.value) {
    isContentReady.value = true
    return
  }

  if (gridContainerRef.value) {
    const now = new Date()
    const position = timeToPixels(now, pixelsPerHour)
    const containerHeight = gridContainerRef.value.clientHeight

    // 确保容器有有效高度
    if (containerHeight > 0) {
      // 滚动到当前时间位置，让红线显示在中间
      gridContainerRef.value.scrollTop = Math.max(0, position - containerHeight / 2)
      // 标记已滚动
      hasScrolledToCurrentTime.value = true
      // 优化模块35：滚动完成后显示内容
      isContentReady.value = true
    }
  }
}

onMounted(() => {
  // 优化模块35：立即计算滚动位置并设置，避免闪动
  // 先在 DOM 准备好之前就预计算位置
  nextTick(() => {
    // 立即尝试滚动
    scrollToCurrentTime()
    // 如果第一次没成功（容器高度还是0），用 requestAnimationFrame 重试
    if (!hasScrolledToCurrentTime.value) {
      requestAnimationFrame(() => {
        scrollToCurrentTime()
        // 最后保底：即使滚动失败也要显示内容
        if (!isContentReady.value) {
          isContentReady.value = true
        }
      })
    }
  })
})

onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
})
</script>

<style scoped>
.week-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  overflow: hidden;
  transition: none !important; /* 防止切换时抖动 */
  position: relative; /* 为浮动按钮定位 */
}

/* 周视图头部（优化模块8、11：固定高度60px） */
.week-header {
  display: flex;
  align-items: stretch;
  height: 60px;
  border-bottom: 1px solid #e1e4e8;
  flex-shrink: 0;
  background: #fff;
}

/* 时间轴占位（优化模块21：宽度40px，背景白色） */
.time-axis-placeholder {
  width: 40px;
  flex-shrink: 0;
  border-right: 1px solid #e1e4e8;
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
}

.all-day-label {
  font-size: 11px;
  color: #909399;
  font-weight: 500;
}

/* 日期头部（优化模块17：周一15格式，居中显示） */
.day-header {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-right: 1px solid #e1e4e8;
  padding: 8px;
  background: #fff;
}

.day-header.weekend {
  background: #f8f9fa;
}

/* 组合文本显示（周一15） */
.day-label-combined {
  display: flex;
  align-items: center;
  justify-content: center;
}

.combined-text {
  font-size: 14px;
  font-weight: 500;
  color: #606266;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.day-num {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  padding: 0 4px;
}

/* 当日红色矩形圆角背景（优化模块17：周一15格式，数字红色背景） */
.today-badge-num {
  background: #e74c3c;
  color: #fff;
  padding: 4px 10px;
  border-radius: 4px;
}

/* 浮动的 ± 按钮（优化模块20：与日期头部上下居中对齐，top=30px使其在60px头部内居中） */
.floating-days-btn {
  position: absolute;
  top: 18px; /* (60px头部高度 - 24px按钮高度) / 2 = 18px */
  right: 16px;
  z-index: 100;
}

.days-toggle-btn {
  font-size: 14px;
  font-weight: 600;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.days-toggle-btn:hover {
  background: #f3f4f6;
}

.days-adjuster {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px;
}

/* 优化模块19：调整按钮样式（+ 和 − 符号） */
.adjust-btn {
  font-size: 18px;
  font-weight: 600;
  min-width: 32px;
  padding: 4px 8px;
}

.days-count {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  min-width: 48px;
  text-align: center;
}

/* 周视图内容（优化模块10：固定高度）（优化模块35：防止切换闪动） */
.week-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  min-height: 0;
  /* 优化模块35：初始隐藏，滚动到位后再显示 */
  opacity: 0;
  transition: opacity 0.05s ease-out;
}

.week-content.content-ready {
  opacity: 1;
}

/* 优化模块19：统一滚动容器，时间轴和网格一起滚动 */
.week-scroll-container {
  flex: 1;
  display: flex;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE 10+ */
}

.week-scroll-container::-webkit-scrollbar {
  display: none; /* Chrome, Safari */
}

/* 时间网格容器 */
.week-grid-container {
  flex: 1;
  display: flex;
  position: relative;
}

/* 日列（优化模块20：框选时鼠标显示为小手pointer） */
.day-column {
  flex: 1;
  position: relative;
  cursor: pointer;
  user-select: none;
  border-right: 1px solid #e1e4e8;
}

.day-column:last-child {
  border-right: none;
}

.day-column.weekend {
  background: #f8f9fa;
}

.day-column.today {
  background: #fef5f5;
}

.day-column.weekend.today {
  background: #fef5f5; /* 今天优先级更高 */
}

/* 小时块（仅整点线，无半小时线） */
.hour-block {
  position: relative;
  border-bottom: 1px solid #e5e7eb;
  box-sizing: border-box;
}

/* 节假日/补班标签 */
.holiday-label {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 2px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  margin-left: 4px;
}

/* 节假日（休） - 绿色 */
.holiday-label.holiday-rest {
  background-color: #d1fae5;
  color: #065f46;
}

/* 补班日（班） - 橙色 */
.holiday-label.holiday-work {
  background-color: #ffedd5;
  color: #c2410c;
}
</style>
