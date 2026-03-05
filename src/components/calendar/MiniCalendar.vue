<template>
  <div class="mini-calendar">
    <!-- 优化模块26：月份导航（参照Notion Calendar样式） -->
    <div class="calendar-header">
      <span class="current-month">{{ currentMonthText }}</span>
      <!-- 优化模块27：按钮顺序 返回-<-> -->
      <div class="header-buttons">
        <!-- 返回今天按钮（非本月时显示） -->
        <el-button
          v-if="!isCurrentMonth"
          circle
          size="small"
          class="back-today-btn"
          title="返回本月"
          @click="backToToday"
        >
          <el-icon><Aim /></el-icon>
        </el-button>
        <el-button text :icon="ArrowLeft" size="small" @click="prevMonth" />
        <el-button text :icon="ArrowRight" size="small" @click="nextMonth" />
      </div>
    </div>

    <!-- 星期标题 -->
    <div class="weekdays">
      <div v-for="day in weekdays" :key="day" class="weekday">{{ day }}</div>
    </div>

    <!-- 日期网格 -->
    <div class="days-grid">
      <div
        v-for="(date, index) in calendarDays"
        :key="index"
        class="day-cell"
        :class="{
          today: date.isToday,
          selected: isSelectedShowing(date.date) && !isSelectedFading(date.date) && !date.isToday,
          'selected-fading': isSelectedFading(date.date) && !date.isToday,
          'selected-faded': isSelectedFaded(date.date) && !date.isToday,
          'click-highlight': isClickHighlighted(date.date) && !date.isToday,
          'click-fading': isClickFading(date.date) && !date.isToday,
          'click-faded': isClickFaded(date.date) && !date.isToday,
          'other-month': !date.isCurrentMonth,
          weekend: date.isWeekend,
          'week-selected': date.isWeekSelected,
          'has-events': date.hasEvents,
        }"
        @click="handleDateClick(date.date)"
      >
        <span class="day-number">{{ date.day }}</span>
        <!-- 优化模块24：有事件时显示小圆点（今天红色背景或选中蓝色背景时圆点为白色） -->
        <span v-if="date.hasEvents" class="event-dot" :class="{ 'white-dot': date.isToday || isSelectedShowing(date.date) }"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, type Ref } from 'vue'
import { ArrowLeft, ArrowRight, Aim } from '@element-plus/icons-vue'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  addMonths,
  isWithinInterval,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { isToday as checkIsToday, isWeekend as checkIsWeekend } from '@/utils/calendar'
import type { ViewMode, CalendarEvent } from '@/types/calendar'

// Inject 父组件状态
const selectedDate = inject<Ref<Date>>('selectedDate')!
const viewMode = inject<Ref<ViewMode>>('viewMode')!
const events = inject<Ref<CalendarEvent[]>>('events')!
const clearSelectionSignal = inject<Ref<number>>('clearSelectionSignal', ref(0))

// 当前显示的月份
const displayMonth = ref(new Date(selectedDate.value))

// 点击高亮状态
const clickedDate = ref<Date | null>(null)
const fadingDate = ref<Date | null>(null)
const fadedDate = ref<Date | null>(null)

// 优化模块24：是否显示选中状态（点击后3秒显示，然后淡化消失）
const showSelectedDate = ref<Date | null>(null)
const selectedFadingDate = ref<Date | null>(null)
// 优化模块34：已完成选中状态淡化的日期（保持白色背景）
const selectedFadedDate = ref<Date | null>(null)

// 优化模块27：记录上一次触发高亮的日期，避免重复触发
let lastHighlightedDate: Date | null = null

// 优化模块27：监听选择日期变化（双击月视图时也触发蓝色高亮淡化效果）
watch(selectedDate, (newDate, oldDate) => {
  displayMonth.value = new Date(newDate)

  // 如果是同一天，不处理
  if (oldDate && isSameDay(newDate, oldDate)) return

  // 优化模块27：如果这个日期已经处于淡化完成状态，不再重新触发高亮
  if (lastHighlightedDate && isSameDay(newDate, lastHighlightedDate)) {
    // 检查是否已经淡化完成（showSelectedDate和selectedFadingDate都为null）
    if (!showSelectedDate.value && !selectedFadingDate.value) {
      return
    }
  }

  // 清除之前的定时器
  if (clickTimer) clearTimeout(clickTimer)
  if (clickFadeTimer) clearTimeout(clickFadeTimer)
  if (selectedTimer) clearTimeout(selectedTimer)
  if (selectedFadeTimer) clearTimeout(selectedFadeTimer)

  // 清除之前的淡化状态
  fadedDate.value = null
  fadingDate.value = null
  selectedFadingDate.value = null
  selectedFadedDate.value = null
  clickedDate.value = null

  // 设置选中状态（深蓝色）
  showSelectedDate.value = newDate
  lastHighlightedDate = newDate

  // 3秒后选中状态开始淡化
  selectedTimer = setTimeout(() => {
    if (showSelectedDate.value && isSameDay(showSelectedDate.value, newDate)) {
      selectedFadingDate.value = newDate
      showSelectedDate.value = null

      // 1.5秒淡化动画后完成
      selectedFadeTimer = setTimeout(() => {
        if (selectedFadingDate.value && isSameDay(selectedFadingDate.value, newDate)) {
          // 优化模块34：记录淡化完成的日期，保持白色背景
          selectedFadedDate.value = newDate
          selectedFadingDate.value = null
          // 优化模块27：淡化完成后，lastHighlightedDate保持不变
          // 这样当selectedDate再次变化到同一天时，不会重新触发高亮
        }
      }, 1500)
    }
  }, 3000)
})

// 优化模块27：监听清除信号（同时清除所有定时器和状态）
watch(clearSelectionSignal, () => {
  // 清除所有定时器
  if (clickTimer) clearTimeout(clickTimer)
  if (clickFadeTimer) clearTimeout(clickFadeTimer)
  if (selectedTimer) clearTimeout(selectedTimer)
  if (selectedFadeTimer) clearTimeout(selectedFadeTimer)

  // 清除所有状态
  clickedDate.value = null
  fadingDate.value = null
  fadedDate.value = null
  showSelectedDate.value = null
  selectedFadingDate.value = null
  selectedFadedDate.value = null
  lastHighlightedDate = null // 优化模块27：清除上次高亮日期，允许再次触发高亮
})

// 星期标题
const weekdays = ['一', '二', '三', '四', '五', '六', '日']

// 当前月份文本
const currentMonthText = computed(() => {
  return format(displayMonth.value, 'yyyy年M月', { locale: zhCN })
})

// 是否是当前月份
const isCurrentMonth = computed(() => {
  const now = new Date()
  return isSameMonth(displayMonth.value, now)
})

// 检查某一天是否有事件
function hasEventsOnDate(date: Date): boolean {
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(23, 59, 59, 999)

  return events.value.some((event) => {
    const eventStart = new Date(event.startTime)
    const eventEnd = new Date(event.endTime)
    return eventStart <= dayEnd && eventEnd >= dayStart
  })
}

// 日历天数
const calendarDays = computed(() => {
  const monthStart = startOfMonth(displayMonth.value)
  const monthEnd = endOfMonth(displayMonth.value)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  // 获取选中的周范围
  let weekStart: Date | null = null
  let weekEnd: Date | null = null
  if (viewMode.value === 'week') {
    weekStart = startOfWeek(selectedDate.value, { weekStartsOn: 1 })
    weekEnd = endOfWeek(selectedDate.value, { weekStartsOn: 1 })
  }

  return days.map((date) => ({
    date,
    day: date.getDate(),
    isToday: checkIsToday(date),
    isSelected: isSameDay(date, selectedDate.value),
    isCurrentMonth: isSameMonth(date, displayMonth.value),
    isWeekend: checkIsWeekend(date),
    hasEvents: hasEventsOnDate(date),
    isWeekSelected:
      viewMode.value === 'week' &&
      weekStart &&
      weekEnd &&
      isWithinInterval(date, { start: weekStart, end: weekEnd }),
  }))
})

// Emit
const emit = defineEmits<{
  dateClick: [date: Date]
}>()

// 上个月
function prevMonth() {
  displayMonth.value = addMonths(displayMonth.value, -1)
}

// 下个月
function nextMonth() {
  displayMonth.value = addMonths(displayMonth.value, 1)
}

// 返回今天
function backToToday() {
  displayMonth.value = new Date()
}

// 检查是否是点击高亮状态
function isClickHighlighted(date: Date): boolean {
  return clickedDate.value !== null && isSameDay(date, clickedDate.value)
}

// 检查是否是淡化状态
function isClickFading(date: Date): boolean {
  return fadingDate.value !== null && isSameDay(date, fadingDate.value)
}

// 优化模块24：检查是否显示选中状态
function isSelectedShowing(date: Date): boolean {
  return showSelectedDate.value !== null && isSameDay(date, showSelectedDate.value)
}

// 优化模块24：检查选中状态是否正在淡化
function isSelectedFading(date: Date): boolean {
  return selectedFadingDate.value !== null && isSameDay(date, selectedFadingDate.value)
}

// 优化模块34：检查选中状态是否已完成淡化（保持白色背景）
function isSelectedFaded(date: Date): boolean {
  return selectedFadedDate.value !== null && isSameDay(date, selectedFadedDate.value)
}

// 优化模块34：检查点击状态是否已完成淡化（保持白色背景）
function isClickFaded(date: Date): boolean {
  return fadedDate.value !== null && isSameDay(date, fadedDate.value)
}

// 优化模块24：点击高亮定时器
let clickTimer: ReturnType<typeof setTimeout> | null = null
let clickFadeTimer: ReturnType<typeof setTimeout> | null = null
let selectedTimer: ReturnType<typeof setTimeout> | null = null
let selectedFadeTimer: ReturnType<typeof setTimeout> | null = null

// 优化模块26：点击日期（只emit，让watch处理高亮淡化逻辑）
function handleDateClick(date: Date) {
  // 设置点击高亮（浅蓝色）- 只有点击时才有这个浅蓝色高亮
  clickedDate.value = date

  // 清除之前的点击高亮定时器
  if (clickTimer) clearTimeout(clickTimer)
  if (clickFadeTimer) clearTimeout(clickFadeTimer)

  // 3秒后点击高亮开始淡化
  clickTimer = setTimeout(() => {
    if (clickedDate.value && isSameDay(clickedDate.value, date)) {
      fadingDate.value = date
      clickedDate.value = null

      // 1.5秒淡化动画后完成
      clickFadeTimer = setTimeout(() => {
        if (fadingDate.value && isSameDay(fadingDate.value, date)) {
          fadedDate.value = date
          fadingDate.value = null
        }
      }, 1500)
    }
  }, 3000)

  // emit后，selectedDate变化会触发watch，自动处理蓝色选中状态的淡化
  emit('dateClick', date)
}
</script>

<style scoped>
.mini-calendar {
  padding: 16px;
  background: #fff;
  user-select: none;
}

/* 月份导航 */
.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.current-month {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.header-buttons {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 优化模块26：返回今天按钮（Notion Calendar风格） */
.back-today-btn {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  padding: 0 !important;
  background: #f3f4f6 !important;
  border: none !important;
  color: #374151 !important;
}

.back-today-btn:hover {
  background: #e5e7eb !important;
  color: #111827 !important;
}

/* 星期标题 */
.weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  margin-bottom: 8px;
}

.weekday {
  text-align: center;
  font-size: 12px;
  color: #909399;
  padding: 4px 0;
  font-weight: 500;
}

/* 日期网格 */
.days-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.day-cell {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: #303133;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
}

.day-number {
  line-height: 1;
}

.day-cell:hover {
  background: #f5f6f8;
}

/* 今天 - 红色 */
.day-cell.today {
  background: #e74c3c;
  color: #fff;
  font-weight: 600;
}

.day-cell.today:hover {
  background: #c0392b;
}

/* 选中日期 */
.day-cell.selected {
  background: #3b82f6;
  color: #fff;
  font-weight: 600;
}

.day-cell.selected:hover {
  background: #2563eb;
}

/* 今天被选中时，优先显示今天的红色 */
.day-cell.today.selected {
  background: #e74c3c;
}

.day-cell.today.selected:hover {
  background: #c0392b;
}

/* 点击高亮 - 蓝色背景 */
.day-cell.click-highlight {
  background: #dbeafe !important;
  color: #1d4ed8;
}

/* 点击淡化动画 - 优化模块34：淡化后恢复白色背景 */
.day-cell.click-fading {
  animation: fadeHighlight 1.5s ease-out forwards;
}

@keyframes fadeHighlight {
  from {
    background: #dbeafe;
    color: #1d4ed8;
  }
  to {
    background: #ffffff;
    color: #303133;
  }
}

/* 优化模块24：选中状态淡化动画 - 优化模块34：淡化后恢复白色背景 */
.day-cell.selected-fading {
  animation: fadeSelectedHighlight 1.5s ease-out forwards;
}

@keyframes fadeSelectedHighlight {
  from {
    background: #3b82f6;
    color: #fff;
    font-weight: 600;
  }
  to {
    background: #ffffff;
    color: #303133;
    font-weight: normal;
  }
}

/* 优化模块35：淡化完成后强制保持白色背景
   注意：必须覆盖 .week-selected 的背景色 #eff6ff
   使用多个选择器组合确保最高优先级 */
.day-cell.selected-faded,
.day-cell.click-faded {
  background: #ffffff !important;
  color: #303133 !important;
  font-weight: normal !important;
}

/* 优化模块35：周视图中淡化完成的日期也必须保持白色 */
.day-cell.week-selected.selected-faded,
.day-cell.week-selected.click-faded,
.days-grid .day-cell.week-selected.selected-faded,
.days-grid .day-cell.week-selected.click-faded {
  background: #ffffff !important;
  color: #303133 !important;
  font-weight: normal !important;
}

/* 优化模块36：今天始终保持红色背景，不受淡化影响
   在模板中通过 && !date.isToday 条件控制，今天不会添加淡化相关的class */

/* 其他月份的日期 */
.day-cell.other-month {
  color: #c0c4cc;
}

/* 周末 */
.day-cell.weekend {
  /* 周末不需要特殊颜色，因为已经在主视图中区分 */
}

/* 选中的周高亮 */
.day-cell.week-selected {
  background: #eff6ff;
}

.day-cell.week-selected:hover {
  background: #dbeafe;
}

/* 优化模块21：确保今天红色背景在周视图中也保持显示 */
.day-cell.week-selected.today {
  background: #e74c3c;
  color: #fff;
  font-weight: 600;
}

.day-cell.week-selected.today:hover {
  background: #c0392b;
}

.day-cell.week-selected.selected {
  background: #3b82f6;
  color: #fff;
  font-weight: 600;
}

/* 今天被选中且在选中周内时，优先显示今天的红色 */
.day-cell.week-selected.today.selected {
  background: #e74c3c;
}

/* 事件小圆点 */
.event-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #3b82f6;
  margin-top: 2px;
}

/* 今天的圆点为白色 */
.event-dot.white-dot {
  background: #fff;
}
</style>
