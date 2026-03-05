// 日历工具函数

import {
  getWeek,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addDays,
  isSameDay,
  isWithinInterval,
  format,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { RRule } from 'rrule'
import type { CalendarEvent, EventLayout, TimeRange, DateStatus } from '@/types/calendar'

/**
 * 获取ISO 8601周数
 */
export function getWeekNumber(date: Date): number {
  return getWeek(date, {
    weekStartsOn: 1, // 周一为起始
    firstWeekContainsDate: 4, // ISO 8601
    locale: zhCN,
  })
}

/**
 * 获取一周的日期范围（周一到周日）
 */
export function getWeekRange(date: Date): TimeRange {
  return {
    start: startOfWeek(date, { weekStartsOn: 1 }),
    end: endOfWeek(date, { weekStartsOn: 1 }),
  }
}

/**
 * 获取一个月的日期范围
 */
export function getMonthRange(date: Date): TimeRange {
  return {
    start: startOfMonth(date),
    end: endOfMonth(date),
  }
}

/**
 * 格式化时间为 AM/PM 格式
 */
export function formatTimeAMPM(date: Date): string {
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const displayHours = hours % 12 || 12
  return `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`
}

/**
 * 格式化时间为24小时格式
 */
export function formatTime24(date: Date): string {
  return format(date, 'HH:mm', { locale: zhCN })
}

/**
 * 格式化日期
 */
export function formatDate(date: Date, formatStr: string = 'yyyy-MM-dd'): string {
  return format(date, formatStr, { locale: zhCN })
}

/**
 * 判断是否为周末
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/**
 * 判断是否为今天
 */
export function isToday(date: Date): boolean {
  return isSameDay(date, new Date())
}

/**
 * 获取日期状态
 */
export function getDateStatus(date: Date, currentMonth: Date): DateStatus {
  const now = new Date()
  return {
    isToday: isSameDay(date, now),
    isWeekend: isWeekend(date),
    isCurrentMonth: date.getMonth() === currentMonth.getMonth(),
    isPast: date < now && !isSameDay(date, now),
  }
}

/**
 * 将Y坐标转换为时间（像素 → 时间）
 */
export function pixelsToTime(pixels: number, date: Date, pixelsPerHour: number = 60): Date {
  const totalMinutes = (pixels / pixelsPerHour) * 60
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  const result = new Date(date)
  result.setHours(hours, minutes, 0, 0)
  return result
}

/**
 * 将时间转换为Y坐标（时间 → 像素）
 */
export function timeToPixels(date: Date, pixelsPerHour: number = 60): number {
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const totalMinutes = hours * 60 + minutes
  return (totalMinutes / 60) * pixelsPerHour
}

/**
 * 吸附到时间网格（15分钟刻度）
 */
export function snapToGrid(date: Date, gridMinutes: number = 15): Date {
  const result = new Date(date)
  const minutes = result.getMinutes()
  const snappedMinutes = Math.round(minutes / gridMinutes) * gridMinutes
  result.setMinutes(snappedMinutes, 0, 0)
  return result
}

/**
 * 检查两个事件时间是否重合
 */
export function eventsOverlap(event1: CalendarEvent, event2: CalendarEvent): boolean {
  const start1 = new Date(event1.startTime)
  const end1 = new Date(event1.endTime)
  const start2 = new Date(event2.startTime)
  const end2 = new Date(event2.endTime)

  return start1 < end2 && start2 < end1
}

/**
 * 使用贪心算法计算时间重合日程的布局
 */
export function calculateEventLayouts(
  events: CalendarEvent[],
  pixelsPerHour: number = 60
): EventLayout[] {
  if (events.length === 0) return []

  // 1. 按开始时间排序
  const sorted = [...events].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  )

  // 2. 分组重合事件 - 修复：检查与组内所有事件的重合
  const groups: CalendarEvent[][] = []
  let currentGroup: CalendarEvent[] = []

  for (const event of sorted) {
    if (currentGroup.length === 0) {
      currentGroup.push(event)
    } else {
      // 检查是否与当前组的任一事件重合
      const overlapsWithGroup = currentGroup.some((groupEvent) => eventsOverlap(event, groupEvent))

      if (overlapsWithGroup) {
        currentGroup.push(event)
      } else {
        // 检查是否与上一组的最后事件仍有连续性
        const lastGroupEndTime = Math.max(...currentGroup.map((e) => new Date(e.endTime).getTime()))
        const eventStartTime = new Date(event.startTime).getTime()

        if (eventStartTime < lastGroupEndTime) {
          // 仍然在上一组的时间范围内，继续在当前组
          currentGroup.push(event)
        } else {
          // 完全独立，开始新组
          groups.push(currentGroup)
          currentGroup = [event]
        }
      }
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup)

  // 调试日志（优化模块17：诊断重合显示问题）
  console.log(
    '[calculateEventLayouts] 分组结果:',
    groups.map((g) => g.map((e) => e.title))
  )

  // 3. 为每组分配列
  const layouts: EventLayout[] = []

  for (const group of groups) {
    const columnEndTimes: Date[] = []
    const eventColumns: number[] = []

    for (const event of group) {
      const startTime = new Date(event.startTime)

      // 查找可用列
      let column = columnEndTimes.findIndex((endTime) => endTime <= startTime)

      if (column === -1) {
        column = columnEndTimes.length
        columnEndTimes.push(new Date(event.endTime))
      } else {
        columnEndTimes[column] = new Date(event.endTime)
      }
      eventColumns.push(column)
    }

    const maxColumn = Math.max(...eventColumns)
    const totalColumns = maxColumn + 1

    // 调试日志（优化模块17：输出列分配结果）
    console.log(
      `[calculateEventLayouts] 组内列分配:`,
      group.map((e, i) => ({
        title: e.title,
        column: eventColumns[i],
        totalColumns,
      }))
    )

    // 计算布局
    for (let i = 0; i < group.length; i++) {
      const event = group[i]
      const column = eventColumns[i]

      const top = timeToPixels(new Date(event.startTime), pixelsPerHour)
      const height = timeToPixels(new Date(event.endTime), pixelsPerHour) - top

      const layout = {
        event,
        column,
        totalColumns,
        width: `${100 / totalColumns}%`,
        left: `${(100 / totalColumns) * column}%`,
        top,
        height,
      }

      // 调试日志（优化模块17：输出最终布局数据）
      console.log(`[calculateEventLayouts] 布局:`, {
        title: event.title,
        width: layout.width,
        left: layout.left,
        top: layout.top,
        height: layout.height,
      })

      layouts.push(layout)
    }
  }

  return layouts
}

/**
 * 展开重复日程
 */
export function expandRecurringEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): CalendarEvent[] {
  const expanded: CalendarEvent[] = []

  for (const event of events) {
    if (!event.recurrenceRule) {
      // 非重复日程直接添加
      const eventStart = new Date(event.startTime)
      if (isWithinInterval(eventStart, { start: rangeStart, end: rangeEnd })) {
        expanded.push(event)
      }
      continue
    }

    try {
      // 解析重复规则
      const rule = RRule.fromString(event.recurrenceRule)
      const instances = rule.between(rangeStart, rangeEnd, true)

      // 为每个实例创建虚拟事件
      const eventStart = new Date(event.startTime)
      const eventEnd = new Date(event.endTime)
      const duration = eventEnd.getTime() - eventStart.getTime()

      for (const instanceDate of instances) {
        const instanceEnd = new Date(instanceDate.getTime() + duration)

        expanded.push({
          ...event,
          id: `${event.id}-${instanceDate.toISOString()}`,
          startTime: instanceDate.toISOString(),
          endTime: instanceEnd.toISOString(),
          isRecurringInstance: true,
          originalEventId: event.id,
        })
      }
    } catch (error) {
      console.error('解析重复规则失败:', error)
      // 解析失败时，当作普通事件处理
      expanded.push(event)
    }
  }

  return expanded
}

/**
 * 过滤可见日期范围内的事件
 */
export function filterVisibleEvents(
  events: CalendarEvent[],
  viewMode: 'month' | 'week' | 'day',
  currentDate: Date
): CalendarEvent[] {
  let range: TimeRange

  switch (viewMode) {
    case 'month':
      range = getMonthRange(currentDate)
      break
    case 'week':
      range = getWeekRange(currentDate)
      break
    case 'day':
      range = { start: new Date(currentDate), end: addDays(currentDate, 1) }
      break
    default:
      return events
  }

  return events.filter((event) => {
    const eventStart = new Date(event.startTime)
    const eventEnd = new Date(event.endTime)
    return (
      isWithinInterval(eventStart, range) ||
      isWithinInterval(eventEnd, range) ||
      (eventStart <= range.start && eventEnd >= range.end)
    )
  })
}

/**
 * 获取星期显示文本（周一、周二...）
 */
export function getWeekdayText(date: Date): string {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[date.getDay()]
}

/**
 * 获取星期简写（一、二、三...）
 */
export function getWeekdayShort(date: Date): string {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return weekdays[date.getDay()]
}

/**
 * 获取月份相对提示颜色
 */
export function getMonthHintColor(date: Date, currentDate: Date): string {
  const monthDiff =
    date.getMonth() - currentDate.getMonth() + (date.getFullYear() - currentDate.getFullYear()) * 12

  if (monthDiff === 0) return 'success' // 本月 - 浅绿色
  if (monthDiff === 1) return 'warning' // 下月 - 浅黄色
  if (monthDiff >= 2 && monthDiff <= 7) return 'info' // 2-7月 - 浅紫色
  return 'danger' // 8个月及以上 - 红色
}

/**
 * 判断日程是否已过期
 */
export function isEventPast(event: CalendarEvent): boolean {
  return new Date(event.endTime) < new Date()
}

/**
 * 获取当前时间在一天中的百分比位置（0-100）
 */
export function getCurrentTimePercentage(): number {
  const now = new Date()
  const totalMinutes = now.getHours() * 60 + now.getMinutes()
  const dayMinutes = 24 * 60
  return (totalMinutes / dayMinutes) * 100
}
