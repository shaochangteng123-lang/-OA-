<template>
  <div class="day-view">
    <!-- 日期头部（优化模块20：样式与周视图一致） -->
    <div class="day-header">
      <div class="time-axis-placeholder">
        <span class="all-day-label">全天</span>
      </div>
      <div class="day-header-content">
        <div class="day-label-combined">
          <span v-if="!isToday" class="combined-text">
            {{ dayName }}<span class="day-num">{{ currentDate.getDate() }}</span>
          </span>
          <span v-else class="combined-text">
            {{ dayName }}<span class="day-num today-badge-num">{{ currentDate.getDate() }}</span>
          </span>
          <!-- 节假日/补班标签 -->
          <span
            v-if="holidayLabel"
            class="holiday-label"
            :class="{
              'holiday-rest': holidayType === 'holiday',
              'holiday-work': holidayType === 'workday'
            }"
          >
            {{ holidayLabel }}
          </span>
        </div>
      </div>
    </div>

    <!-- 优化模块19：内容区域，时间轴与网格一起滚动 -->
    <div class="day-content" :class="{ 'content-ready': isContentReady }">
      <!-- 优化模块19：统一滚动容器 -->
      <div class="day-scroll-container" ref="gridContainerRef">
        <!-- 左侧时间轴 -->
        <TimeAxis
          :pixels-per-hour="pixelsPerHour"
          :start-hour="startHour"
          :end-hour="endHour"
          :show-current-time="true"
          :date="currentDate"
        />

        <!-- 单日时间网格 -->
        <div class="day-grid-container">
          <div
            ref="canvasRef"
            class="day-column"
            :class="{ today: isToday }"
            :style="{ height: `${totalHeight}px` }"
            @mousedown="handleMouseDown"
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
              v-for="layout in eventLayouts"
              :key="layout.event.id"
              :event="layout.event"
              :layout="layout"
              :show-time="false"
              :is-past="isEventPast(layout.event)"
              @click="handleEventClick(layout.event)"
            />

            <!-- 框选高亮（优化模块12、14、17：持续显示） -->
            <SelectionBox v-if="hasSelection && selectionBox" :selection="selectionBox" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick, type Ref } from 'vue'
import {
  pixelsToTime,
  timeToPixels,
  snapToGrid,
  calculateEventLayouts,
  isToday as checkIsToday,
  getWeekdayShort,
  isEventPast,
} from '@/utils/calendar'
import { getHolidayInfoSync, getHolidayLabel } from '@/utils/holidays'
import type { CalendarEvent, SelectionBox as SelectionBoxType } from '@/types/calendar'
import TimeAxis from './TimeAxis.vue'
import EventCard from './EventCard.vue'
import SelectionBox from './SelectionBox.vue'

// Inject 父组件状态
const currentDate = inject<Ref<Date>>('currentDate')!
const events = inject<Ref<CalendarEvent[]>>('events')!
const clearSelectionSignal = inject<Ref<number>>('clearSelectionSignal', ref(0))
// 优化模块19：监听全天状态变化
const allDaySignal = inject<Ref<{ allDay: boolean; date: string } | null>>('allDaySignal', ref(null))
// 优化模块36：监听时间段变化（上午/下午/晚上）
const timePeriodSignal = inject<Ref<{ startTime: string; endTime: string } | null>>('timePeriodSignal', ref(null))

// Refs
const gridContainerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const hasSelection = ref(false)
const selectionBox = ref<SelectionBoxType | null>(null)

// 优化模块31：标记是否已滚动到当前时间（仅首次进入时居中）
const hasScrolledToCurrentTime = ref(false)
// 优化模块35：控制内容可见性，防止滚动前闪动
const isContentReady = ref(false)

// 配置常量
const pixelsPerHour = 60
const startHour = 0
const endHour = 24
const gridMinutes = 15

// 计算属性
const isToday = computed(() => checkIsToday(currentDate.value))

// 优化模块20：返回"周X"格式，与周视图一致
const dayName = computed(() => `周${getWeekdayShort(currentDate.value)}`)

// 节假日信息
const holidayLabel = computed(() => getHolidayLabel(currentDate.value))
const holidayType = computed(() => getHolidayInfoSync(currentDate.value)?.type || null)

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

// 获取当天的事件
const dayEvents = computed(() => {
  const dayStart = new Date(currentDate.value)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(currentDate.value)
  dayEnd.setHours(23, 59, 59, 999)

  return events.value.filter((event) => {
    const eventStart = new Date(event.startTime)
    const eventEnd = new Date(event.endTime)
    return eventStart <= dayEnd && eventEnd >= dayStart
  })
})

// 事件布局
const eventLayouts = computed(() => {
  return calculateEventLayouts(dayEvents.value, pixelsPerHour)
})

// Emit
const emit = defineEmits<{
  createEvent: [startTime: Date, endTime: Date]
  editEvent: [event: CalendarEvent]
}>()

// 鼠标按下开始框选（优化模块20：修复框选位置）
function handleMouseDown(event: MouseEvent) {
  if (!canvasRef.value || !gridContainerRef.value) return

  // 如果已经有选择框，先清除（开始新的选择）
  if (hasSelection.value) {
    clearSelection()
  }

  // 优化模块20：使用gridContainerRef计算相对位置，确保框选位置准确
  const rect = gridContainerRef.value.getBoundingClientRect()
  const y = event.clientY - rect.top + gridContainerRef.value.scrollTop

  const startTime = pixelsToTime(y, currentDate.value, pixelsPerHour)
  const snappedStart = snapToGrid(startTime, gridMinutes)
  // 计算对齐后的像素位置
  const snappedY = timeToPixels(snappedStart, pixelsPerHour)

  isDragging.value = true
  hasSelection.value = false // 拖拽时暂不显示，等拖拽结束后再显示
  selectionBox.value = {
    top: snappedY, // 使用对齐后的位置
    height: 0,
    start: snappedStart,
    end: snappedStart,
  }

  // 添加全局鼠标事件监听
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)

  event.preventDefault()
  event.stopPropagation() // 优化模块17：阻止事件冒泡，防止框选框意外消失
}

// 鼠标移动更新框选（优化模块20：修复框选位置）
function handleMouseMove(event: MouseEvent) {
  if (!isDragging.value || !gridContainerRef.value || !selectionBox.value) return

  const rect = gridContainerRef.value.getBoundingClientRect()
  const y = event.clientY - rect.top + gridContainerRef.value.scrollTop

  const endTime = pixelsToTime(y, currentDate.value, pixelsPerHour)
  const snappedEnd = snapToGrid(endTime, gridMinutes)
  const snappedEndY = timeToPixels(snappedEnd, pixelsPerHour)

  const startY = timeToPixels(selectionBox.value.start, pixelsPerHour)

  // 更新选择框（使用对齐后的像素位置）
  if (snappedEndY > startY) {
    // 向下拖拽
    selectionBox.value = {
      ...selectionBox.value,
      top: startY,
      height: snappedEndY - startY,
      end: snappedEnd,
    }
  } else {
    // 向上拖拽
    selectionBox.value = {
      ...selectionBox.value,
      top: snappedEndY,
      height: startY - snappedEndY,
      start: snappedEnd,
      end: selectionBox.value.start,
    }
  }

  // 拖拽过程中也显示选择框
  hasSelection.value = true
}

// 鼠标松开完成框选（优化模块12、14、17：框不立即消失）
function handleMouseUp() {
  if (!isDragging.value || !selectionBox.value) return

  isDragging.value = false // 结束拖拽状态

  const { start, end } = selectionBox.value

  // 确保至少有15分钟的选择
  const minDuration = gridMinutes * 60 * 1000
  if (end.getTime() - start.getTime() >= minDuration) {
    // 保持选择框显示，直到用户保存或取消
    hasSelection.value = true
    emit('createEvent', start, end)
    // 选择框会在事件保存或取消时由父组件触发清除（通过 clearSelectionSignal）
  } else {
    // 如果选择时间太短，清除选择框
    clearSelection()
  }

  // 移除全局监听
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

// 点击事件卡片
function handleEventClick(event: CalendarEvent) {
  emit('editEvent', event)
}

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
.day-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  transition: none !important; /* 移除所有过渡效果，防止视图切换时跳动 */
  overflow: hidden; /* 防止内容溢出 */
}

/* 日期头部（优化模块20：样式与周视图一致） */
.day-header {
  display: flex;
  align-items: stretch;
  height: 60px;
  border-bottom: 1px solid #e1e4e8;
  background: #fff;
  flex-shrink: 0;
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

.day-header-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px;
}

/* 组合文本显示（周一15）- 与周视图一致 */
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

/* 当日红色矩形圆角背景（与周视图一致） */
.today-badge-num {
  background: #e74c3c;
  color: #fff;
  padding: 4px 10px;
  border-radius: 4px;
}

/* 内容区域（优化模块35：防止切换闪动） */
.day-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
  min-height: 0;
  /* 优化模块35：初始隐藏，滚动到位后再显示 */
  opacity: 0;
  transition: opacity 0.05s ease-out;
}

.day-content.content-ready {
  opacity: 1;
}

/* 优化模块19：统一滚动容器，时间轴和网格一起滚动 */
.day-scroll-container {
  flex: 1;
  display: flex;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE 10+ */
}

.day-scroll-container::-webkit-scrollbar {
  display: none; /* Chrome, Safari */
}

/* 单日网格容器 */
.day-grid-container {
  flex: 1;
  position: relative; /* 优化模块20：为框选定位提供参考 */
}

/* 日列（优化模块20：框选时鼠标显示为小手pointer） */
.day-column {
  position: relative;
  cursor: pointer;
  user-select: none;
  min-height: 1440px; /* 确保足够高度显示完整24小时 */
}

/* 今天高亮 */
.day-column.today {
  background: #fef5f5;
}

/* 小时块 */
.hour-block {
  position: relative;
  border-bottom: 1px solid #e1e4e8;
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
