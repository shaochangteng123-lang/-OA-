<template>
  <div ref="canvasRef" class="time-grid-canvas">
    <!-- 天列容器 -->
    <div class="days-container">
      <div
        v-for="(day, index) in displayDays"
        :key="index"
        class="day-column"
        :class="{ today: day.isToday, weekend: day.isWeekend }"
        :style="{ height: `${totalHeight}px` }"
        @mousedown="handleMouseDown($event, index)"
      >
        <!-- 半小时分隔线 -->
        <div
          v-for="hour in hours"
          :key="hour"
          class="hour-block"
          :style="{ height: `${pixelsPerHour}px` }"
        >
          <div class="half-hour-line" />
        </div>

        <!-- 该天的事件卡片 -->
        <EventCard
          v-for="layout in day.eventLayouts"
          :key="layout.event.id"
          :event="layout.event"
          :layout="layout"
          @click="handleEventClick(layout.event)"
        />

        <!-- 框选高亮（仅在当前拖拽列显示） -->
        <SelectionBox v-if="selectionBox && currentColumn === index" :selection="selectionBox" />
      </div>
    </div>

    <!-- 当前时间红线（贯穿所有列） -->
    <div
      v-if="showCurrentTimeLine"
      class="current-time-line"
      :class="{ 'bold-line': hasTodayColumn }"
      :style="{ top: `${currentTimePosition}px` }"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, onUnmounted, watch, type Ref } from 'vue'
import { addDays } from 'date-fns'
import {
  pixelsToTime,
  snapToGrid,
  calculateEventLayouts,
  isToday,
  isWeekend,
  timeToPixels,
} from '@/utils/calendar'
import type { CalendarEvent, SelectionBox as SelectionBoxType } from '@/types/calendar'
import EventCard from './EventCard.vue'
import SelectionBox from './SelectionBox.vue'

// Props
interface Props {
  pixelsPerHour?: number
  startHour?: number
  endHour?: number
  gridMinutes?: number
}

const props = withDefaults(defineProps<Props>(), {
  pixelsPerHour: 60,
  startHour: 0,
  endHour: 24,
  gridMinutes: 15,
})

// Inject 父组件状态
const currentDate = inject<Ref<Date>>('currentDate')!
const events = inject<Ref<CalendarEvent[]>>('events')!
const weekDisplayDays = inject<Ref<number>>('weekDisplayDays')!
const clearSelectionSignal = inject<Ref<number>>('clearSelectionSignal', ref(0))

// Refs
const canvasRef = ref<HTMLElement | null>(null)
const isDragging = ref(false) // 正在拖拽中
const hasSelection = ref(false) // 有选择框要显示
const currentColumn = ref<number | null>(null)
const selectionBox = ref<SelectionBoxType | null>(null)

// 计算属性
const hours = computed(() => {
  const result: number[] = []
  for (let i = props.startHour; i < props.endHour; i++) {
    result.push(i)
  }
  return result
})

const totalHeight = computed(() => {
  return (props.endHour - props.startHour) * props.pixelsPerHour
})

// 生成显示的天数组
const displayDays = computed(() => {
  const startDate = getWeekStart(currentDate.value)
  const days = []

  for (let i = 0; i < weekDisplayDays.value; i++) {
    const date = addDays(startDate, i)
    const dayEvents = getDayEvents(date)
    const eventLayouts = calculateEventLayouts(dayEvents, props.pixelsPerHour)

    days.push({
      date,
      isToday: isToday(date),
      isWeekend: isWeekend(date),
      eventLayouts,
    })
  }

  return days
})

// 获取周起始日期（周一）
function getWeekStart(date: Date): Date {
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const result = new Date(date)
  result.setDate(date.getDate() + diff)
  result.setHours(0, 0, 0, 0)
  return result
}

// 获取某一天的事件
function getDayEvents(date: Date): CalendarEvent[] {
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(23, 59, 59, 999)

  return events.value.filter((event) => {
    const eventStart = new Date(event.startTime)
    const eventEnd = new Date(event.endTime)
    return eventStart <= dayEnd && eventEnd >= dayStart
  })
}

// Emit
const emit = defineEmits<{
  createEvent: [startTime: Date, endTime: Date]
  editEvent: [event: CalendarEvent]
}>()

// 鼠标按下开始框选
function handleMouseDown(event: MouseEvent, columnIndex: number) {
  if (!canvasRef.value) return

  // 如果已经有选择框，先清除（开始新的选择）
  if (hasSelection.value) {
    clearSelection()
  }

  const rect = canvasRef.value.getBoundingClientRect()
  const y = event.clientY - rect.top

  const dayDate = displayDays.value[columnIndex].date
  const startTime = pixelsToTime(y, dayDate, props.pixelsPerHour)
  const snappedStart = snapToGrid(startTime, props.gridMinutes)

  isDragging.value = true
  hasSelection.value = false // 拖拽时暂不显示，等拖拽结束后再显示
  currentColumn.value = columnIndex
  selectionBox.value = {
    top: y,
    height: 0,
    start: snappedStart,
    end: snappedStart,
  }

  // 添加全局鼠标事件监听
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)

  event.preventDefault()
}

// 鼠标移动更新框选
function handleMouseMove(event: MouseEvent) {
  if (!isDragging.value || !canvasRef.value || currentColumn.value === null) return

  const rect = canvasRef.value.getBoundingClientRect()
  const y = event.clientY - rect.top
  const startY = selectionBox.value!.top

  const dayDate = displayDays.value[currentColumn.value].date
  const endTime = pixelsToTime(y, dayDate, props.pixelsPerHour)
  const snappedEnd = snapToGrid(endTime, props.gridMinutes)

  // 更新选择框
  if (y > startY) {
    // 向下拖拽
    selectionBox.value = {
      ...selectionBox.value!,
      height: y - startY,
      end: snappedEnd,
    }
  } else {
    // 向上拖拽
    const newStart = pixelsToTime(y, dayDate, props.pixelsPerHour)
    const snappedNewStart = snapToGrid(newStart, props.gridMinutes)

    selectionBox.value = {
      top: y,
      height: startY - y,
      start: snappedNewStart,
      end: selectionBox.value!.start,
    }
  }

  // 拖拽过程中也显示选择框
  hasSelection.value = true
}

// 鼠标松开完成框选
function handleMouseUp() {
  if (!isDragging.value || !selectionBox.value) return

  isDragging.value = false // 结束拖拽状态

  const { start, end } = selectionBox.value

  // 确保至少有15分钟的选择
  const minDuration = props.gridMinutes * 60 * 1000 // 转换为毫秒
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
  currentColumn.value = null
  selectionBox.value = null
}

// 监听父组件的清除信号
watch(clearSelectionSignal, () => {
  clearSelection()
})

// 点击事件卡片
function handleEventClick(event: CalendarEvent) {
  emit('editEvent', event)
}

// 当前时间红线相关
const currentTimePosition = ref(0)
const showCurrentTimeLine = ref(true) // 始终显示红线

// 检查是否有今天的列（用于判断是否加粗）
const hasTodayColumn = computed(() => {
  return displayDays.value.some((day) => day.isToday)
})

// 更新当前时间位置
function updateCurrentTimeLine() {
  const now = new Date()
  currentTimePosition.value = timeToPixels(now, props.pixelsPerHour)
}

// 定时器
let timer: NodeJS.Timeout | null = null

onMounted(() => {
  updateCurrentTimeLine()
  // 每30秒更新一次
  timer = setInterval(updateCurrentTimeLine, 30000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<style scoped>
.time-grid-canvas {
  position: relative;
  overflow-x: auto;
  overflow-y: auto;
  flex: 1;
  min-height: 1440px; /* 24小时 * 60像素/小时 = 1440px，确保显示完整24小时 */
}

/* 天列容器 */
.days-container {
  display: flex;
  min-width: 100%;
  min-height: 1440px; /* 确保容器足够高 */
}

.day-column {
  flex: 1;
  position: relative;
  border-right: 1px solid #e1e4e8;
  min-width: 120px;
  min-height: 1440px; /* 确保每列足够高显示完整24小时 */
  cursor: crosshair;
  user-select: none;
}

.day-column:last-child {
  border-right: none;
}

/* 今天高亮 */
.day-column.today {
  background: #fef5f5;
}

/* 周末背景 */
.day-column.weekend {
  background: #fafbfc;
}

.day-column.today.weekend {
  background: #fef5f5;
}

/* 小时块 */
.hour-block {
  position: relative;
  border-bottom: 1px solid #e1e4e8;
  box-sizing: border-box;
}

/* 半小时分隔线 */
.half-hour-line {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
  background: #f0f0f0;
}

/* 当前时间红线（贯穿所有列） */
.current-time-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: #e74c3c;
  z-index: 100;
  pointer-events: none;
  transition: top 0.3s ease;
}

/* 当天加粗显示 */
.current-time-line.bold-line {
  height: 3px;
}
</style>
