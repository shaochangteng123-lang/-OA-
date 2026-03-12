<template>
  <div class="month-view">
    <!-- 星期标题（优化模块8：头部样式优化） -->
    <div class="month-header">
      <div class="week-number-col"></div>
      <div
        v-for="(day, index) in weekdayHeaders"
        :key="index"
        class="weekday-header"
        :class="{ weekend: index >= 5 }"
      >
        <div class="weekday-label">
          <span class="weekday-name">周{{ day.weekday }}</span>
          <span
            v-if="day.isToday"
            class="weekday-date today-badge"
          >
            {{ day.date }}
          </span>
          <span v-else class="weekday-date">{{ day.date }}</span>
        </div>
      </div>
    </div>

    <!-- 月份网格 -->
    <div class="month-grid">
      <div v-for="week in weeks" :key="week.weekNumber" class="week-row">
        <!-- 周数（优化模块22：当周显示红色文字） -->
        <div class="week-number" :class="{ 'current-week': week.isCurrentWeek }">第{{ week.weekNumber }}周</div>

        <!-- 日期单元格 -->
        <div
          v-for="day in week.days"
          :key="day.date.toISOString()"
          class="day-cell"
          :class="{
            weekend: day.isWeekend,
            'other-month': !day.isCurrentMonth,
            today: day.isToday,
            selected: day.isSelected,
            'double-click-active': day.isDoubleClickActive,
            'past-date': day.isPast && !day.isToday,
            'double-click-past': day.isDoubleClickActive && day.isPast,
            'double-click-future': day.isDoubleClickActive && !day.isPast && !day.isToday,
            'mini-click-highlight': day.isMiniCalendarClick,
            'mini-click-fading': day.isMiniCalendarFading,
            'mini-click-faded': day.isMiniCalendarFaded,
          }"
          @dblclick="handleDayDoubleClick(day)"
        >
          <!-- 日期内容容器 -->
          <div class="day-content-wrapper">
            <!-- 日期数字和节假日标签 -->
            <div class="day-header">
              <div class="day-number">{{ day.date.getDate() }}</div>
              <!-- 节假日/补班标签 -->
              <div
                v-if="day.holidayLabel"
                class="holiday-label"
                :class="{
                  'holiday-rest': day.holidayType === 'holiday',
                  'holiday-work': day.holidayType === 'workday'
                }"
              >
                {{ day.holidayLabel }}
              </div>
            </div>

            <!-- 事件列表 -->
            <div class="day-events">
              <EventCard
                v-for="event in day.visibleEvents"
                :key="event.id"
                :event="event"
                :show-time="false"
                :is-past="isEventPast(event)"
                @click="$emit('eventClick', event)"
              />
              <!-- 更多事件提示（优化模块8：显示"…"） -->
              <div v-if="day.moreEventsCount > 0" class="more-events">
                …
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, type Ref } from 'vue'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachWeekOfInterval,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isBefore,
  startOfDay,
} from 'date-fns'
import { getWeekNumber, isToday as checkIsToday, isWeekend as checkIsWeekend, isEventPast } from '@/utils/calendar'
import { getHolidayInfoSync, getHolidayLabel } from '@/utils/holidays'
import type { CalendarEvent } from '@/types/calendar'
import EventCard from './EventCard.vue'

// Inject 父组件状态
const currentDate = inject<Ref<Date>>('currentDate')!
const selectedDate = inject<Ref<Date>>('selectedDate')!
const events = inject<Ref<CalendarEvent[]>>('events')!
const clearSelectionSignal = inject<Ref<number>>('clearSelectionSignal', ref(0))

// 判断日期是否是过去
function isPastDate(date: Date): boolean {
  const today = startOfDay(new Date())
  return isBefore(startOfDay(date), today)
}

// 双击激活状态
const doubleClickActiveDate = ref<Date | null>(null)

// 双击选中的日期（优化模块23：用于区分是否有被双击选中的日期）
const doubleClickSelectedDate = ref<Date | null>(null)

// 优化模块24：小日历点击高亮状态（暗橙色淡化效果）
const miniCalendarClickDate = ref<Date | null>(null)
const miniCalendarFadingDate = ref<Date | null>(null)
// 优化模块34：记录已完成淡化的日期（背景应保持白色）
const miniCalendarFadedDate = ref<Date | null>(null)

// 监听清除信号（优化模块23：清除双击选中状态）
watch(clearSelectionSignal, () => {
  doubleClickActiveDate.value = null
  doubleClickSelectedDate.value = null
  miniCalendarClickDate.value = null
  miniCalendarFadingDate.value = null
  miniCalendarFadedDate.value = null
})

// 优化模块24：监听selectedDate变化，触发小日历点击高亮效果
let miniCalendarClickTimer: ReturnType<typeof setTimeout> | null = null
let miniCalendarFadeTimer: ReturnType<typeof setTimeout> | null = null

watch(selectedDate, (newDate, _oldDate) => {
  // 如果是双击触发的变化，不处理（双击有自己的高亮逻辑）
  if (doubleClickSelectedDate.value) return

  // 清除之前的定时器
  if (miniCalendarClickTimer) clearTimeout(miniCalendarClickTimer)
  if (miniCalendarFadeTimer) clearTimeout(miniCalendarFadeTimer)

  // 设置点击高亮
  miniCalendarClickDate.value = newDate
  miniCalendarFadingDate.value = null

  // 优化模块34：新日期点击时，清除之前的淡化完成状态
  miniCalendarFadedDate.value = null

  // 3秒后开始淡化
  miniCalendarClickTimer = setTimeout(() => {
    if (miniCalendarClickDate.value && isSameDay(miniCalendarClickDate.value, newDate)) {
      miniCalendarFadingDate.value = newDate
      miniCalendarClickDate.value = null

      // 1.5秒淡化动画后完成
      miniCalendarFadeTimer = setTimeout(() => {
        if (miniCalendarFadingDate.value && isSameDay(miniCalendarFadingDate.value, newDate)) {
          // 优化模块34：记录淡化完成的日期，使其保持白色背景
          miniCalendarFadedDate.value = newDate
          miniCalendarFadingDate.value = null
        }
      }, 1500)
    }
  }, 3000)
})

// Emit
const emit = defineEmits<{
  dayDoubleClick: [date: Date]
  eventClick: [event: CalendarEvent]
}>()

// 星期标题（优化模块22：使用当前月份第一周计算表头，避免双击时表头变化）
const weekdayHeaders = computed(() => {
  // 使用当前显示月份的第一天所在周
  const monthStart = startOfMonth(currentDate.value)
  const weekStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const days = eachDayOfInterval({
    start: weekStart,
    end: endOfWeek(weekStart, { weekStartsOn: 1 }),
  })

  return days.map((date, index) => ({
    name: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index],
    date: date.getDate(),
    weekday: ['一', '二', '三', '四', '五', '六', '日'][index],
    // 判断是否是今天：需要检查实际日期（不受currentDate影响）
    isToday: checkIsToday(date) && isSameMonth(date, currentDate.value),
  }))
})

// 周数据
const weeks = computed(() => {
  const monthStart = startOfMonth(currentDate.value)
  const monthEnd = endOfMonth(currentDate.value)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

  // 获取当前周的周数（优化模块22）
  const today = new Date()
  const currentWeekNumber = getWeekNumber(today)

  const weeksInMonth = eachWeekOfInterval(
    { start: calendarStart, end: calendarEnd },
    { weekStartsOn: 1 }
  )

  return weeksInMonth.map((weekStart) => {
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })
    const days = eachDayOfInterval({ start: weekStart, end: weekEnd })
    const weekNumber = getWeekNumber(weekStart)

    return {
      weekNumber,
      isCurrentWeek: weekNumber === currentWeekNumber, // 优化模块22：判断是否是当前周
      days: days.map((date) => {
        const dayEvents = getDayEvents(date)
        const maxVisible = 3 // 最多显示3个事件
        const visibleEvents = dayEvents.slice(0, maxVisible)
        const moreEventsCount = Math.max(0, dayEvents.length - maxVisible)

        // 获取节假日信息（使用同步版本，因为computed不能是异步的）
        const holidayInfo = getHolidayInfoSync(date)
        const holidayLabel = getHolidayLabel(date)

        return {
          date,
          isToday: checkIsToday(date),
          isWeekend: checkIsWeekend(date),
          isCurrentMonth: isSameMonth(date, currentDate.value),
          // 优化模块23：只有双击选中的日期才显示选中状态，关闭面板后恢复白色背景
          isSelected: doubleClickSelectedDate.value && isSameDay(date, doubleClickSelectedDate.value),
          isDoubleClickActive: doubleClickActiveDate.value && isSameDay(date, doubleClickActiveDate.value),
          isPast: isPastDate(date),
          // 优化模块24：小日历点击高亮状态
          isMiniCalendarClick: miniCalendarClickDate.value && isSameDay(date, miniCalendarClickDate.value),
          isMiniCalendarFading: miniCalendarFadingDate.value && isSameDay(date, miniCalendarFadingDate.value),
          // 优化模块34：已完成淡化的日期（保持白色背景）
          isMiniCalendarFaded: miniCalendarFadedDate.value && isSameDay(date, miniCalendarFadedDate.value),
          // 节假日信息
          holidayLabel,
          holidayType: holidayInfo?.type || null,
          events: dayEvents,
          visibleEvents,
          moreEventsCount,
        }
      }),
    }
  })
})

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
  }).sort((a, b) => {
    // 按开始时间排序
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  })
}

// 双击日期（优化模块8、16、23：双击时变换背景色，不抖动，设置选中状态）
function handleDayDoubleClick(day: any) {
  // 设置双击激活状态（短暂高亮）
  doubleClickActiveDate.value = day.date

  // 设置双击选中状态（持续显示，直到关闭面板）
  doubleClickSelectedDate.value = day.date

  // 300ms后清除激活状态（高亮效果消失，但选中状态保持）
  setTimeout(() => {
    doubleClickActiveDate.value = null
  }, 300)

  emit('dayDoubleClick', day.date)
}
</script>

<style scoped>
/* 优化模块31：月视图自适应宽度，日期之间无间隙 */
.month-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #fff;
  overflow: hidden;
  transition: none !important; /* 防止切换时抖动 */
}

/* 星期标题（固定高度60px） */
.month-header {
  display: grid;
  grid-template-columns: 40px repeat(7, 1fr); /* 周数列40px，其余7列自适应 */
  border-bottom: 1px solid #e1e4e8;
  flex-shrink: 0;
  height: 60px;
}

/* 优化模块21：周数列背景白色 */
.week-number-col {
  border-right: 1px solid #e1e4e8;
  background: #ffffff;
}

.weekday-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background: #ffffff;
  gap: 6px;
}

.weekday-header.weekend {
  background: #ffffff; /* 统一使用白色背景 */
}

.weekday-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.weekday-name {
  font-size: 12px;
  font-weight: 500;
  color: #606266;
}

.weekday-date {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

/* 优化模块36：当日日期红色背景改为正方形居中 */
.weekday-date.today-badge {
  background: #e74c3c;
  color: #fff;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 16px;
}

/* 优化模块31：月份网格自适应，无间隙 */
.month-grid {
  display: grid;
  grid-template-rows: repeat(6, 1fr); /* 6行自适应 */
  flex: 1;
  overflow: hidden;
  gap: 0;
  margin: 0;
  padding: 0;
}

.week-row {
  display: grid;
  grid-template-columns: 40px repeat(7, 1fr); /* 周数列40px，其余7列自适应 */
  gap: 0;
  margin: 0;
  padding: 0;
}

/* 优化模块21：周数列背景白色 */
.week-number {
  border-right: 1px solid #e1e4e8;
  background: #ffffff;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8px;
  font-size: 11px;
  color: #57606a;
  font-weight: 500;
  white-space: nowrap;
  writing-mode: horizontal-tb;
}

/* 优化模块22：当周红色文字显示 */
.week-number.current-week {
  color: #e74c3c;
  font-weight: 600;
}

/* 优化模块31：日期单元格自适应，无间隙（使用border-collapse效果） */
.day-cell {
  border-right: 1px solid #e1e4e8;
  border-bottom: 1px solid #e1e4e8;
  overflow: hidden;
  cursor: pointer;
  transition: none !important;
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* 日期内容包装器 */
.day-content-wrapper {
  width: 100%;
  height: 100%;
  padding: 4px; /* 保留内边距，用于内容布局 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  margin: 0; /* 确保没有外边距 */
}

.day-cell:last-child {
  border-right: none;
}

/* 默认背景色 - 工作日纯白 */
.day-cell {
  background: #ffffff;
}

/* 周末背景色 - 使用统一白色，通过边框区分 */
.day-cell.weekend {
  background: #ffffff;
}

/* 悬停效果 - 工作日 */
.day-cell:not(.weekend):hover {
  background: #f6f8fa;
}

/* 悬停效果 - 周末 */
.day-cell.weekend:hover {
  background: #f6f8fa;
}

/* 非当前月日期 - 降低透明度 */
.day-cell.other-month {
  opacity: 0.35;
}

/* 今天 - 浅蓝色背景（当前日期特殊标识） */
/* 优化模块34：当正在高亮、淡化或已淡化完成时，不应用今天的蓝色背景 */
.day-cell.today:not(.mini-click-highlight):not(.mini-click-fading):not(.mini-click-faded) {
  background: #dbeafe;
}

.day-cell.today:not(.mini-click-highlight):not(.mini-click-fading):not(.mini-click-faded):hover {
  background: #bfdbfe;
}

/* 优化模块35：淡化完成后强制白色背景（覆盖所有其他样式） */
.day-cell.mini-click-faded,
.day-cell.today.mini-click-faded,
.month-grid .day-cell.mini-click-faded,
.month-grid .day-cell.today.mini-click-faded {
  background: #ffffff !important;
}

/* 选中日期 - 浅蓝色（优化模块22：双击选中后保持高亮） */
.day-cell.selected:not(.today):not(.double-click-active) {
  background: #eff6ff;
}

/* 优化模块22：双击选中未来日期 - 浅紫色（与今日蓝色区分） */
.day-cell.double-click-future {
  background: #e9d5ff !important;
}

/* 双击选中过去日期 - 浅黄色 */
.day-cell.double-click-past {
  background: #fef3c7 !important;
}

/* 优化模块22：双击选中今天 - 浅红色（与今天蓝色明显区分） */
.day-cell.today.double-click-active {
  background: #fecaca !important;
}

/* 优化模块24：小日历点击高亮 - 暗橙色（参照Notion Calendar） */
.day-cell.mini-click-highlight {
  background: #fed7aa !important; /* 暗橙色背景 */
}

/* 优化模块26：小日历点击淡化动画（确保动画不被transition覆盖）- 优化模块34：淡化后恢复白色 */
.day-cell.mini-click-fading {
  animation: fadeMiniClickHighlight 1.5s ease-out forwards !important;
  transition: none !important;
}

/* 优化模块34：淡化完成后强制保持白色背景 */
.day-cell.mini-click-fading:not(.today) {
  animation: fadeMiniClickHighlight 1.5s ease-out forwards !important;
}

@keyframes fadeMiniClickHighlight {
  0% {
    background-color: #fed7aa;
  }
  100% {
    background-color: #ffffff;
  }
}

/* 优化模块26：今天被小日历点击时使用特殊淡化 - 优化模块34：淡化后恢复白色而非蓝色 */
.day-cell.today.mini-click-highlight {
  background: #fdba74 !important; /* 更深的橙色，与今天蓝色区分 */
}

.day-cell.today.mini-click-fading {
  animation: fadeMiniClickHighlightToday 1.5s ease-out forwards !important;
  transition: none !important;
}

/* 优化模块34：今天的日期淡化后也恢复白色背景，而非蓝色 */
@keyframes fadeMiniClickHighlightToday {
  0% {
    background-color: #fdba74;
  }
  100% {
    background-color: #ffffff; /* 优化模块34：淡化回白色背景 */
  }
}

.day-number {
  font-size: 13px;
  color: #303133;
  font-weight: 500;
  flex-shrink: 0;
  line-height: 1; /* 消除行高产生的额外空间 */
}

.day-cell.today .day-number {
  color: #e74c3c;
  font-weight: 600;
}

/* 日期头部：包含日期数字和节假日标签 */
.day-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  flex-shrink: 0;
}

/* 节假日/补班标签 */
.holiday-label {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 2px;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
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

.day-events {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  min-height: 0;
  margin: 0; /* 确保没有外边距 */
  padding: 0; /* 确保没有内边距 */
}

/* 更多事件提示（优化模块8：显示"…"） */
.more-events {
  font-size: 11px;
  color: #909399;
  text-align: center;
  padding: 2px 0;
  cursor: pointer;
}

.more-events:hover {
  color: #606266;
}
</style>
