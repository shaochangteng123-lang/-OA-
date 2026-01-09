// 日历相关类型定义

// 视图模式
export type ViewMode = 'month' | 'week' | 'day'

// 日历事件
export interface CalendarEvent {
  id: string
  title: string
  description?: string
  startTime: string // ISO 8601 格式
  endTime: string // ISO 8601 格式
  allDay: boolean
  color: string
  colorLabel?: string
  location?: string
  userId: string
  createdAt?: string
  updatedAt?: string

  // 重复规则
  recurrenceRule?: string // RRule 格式
  recurrenceException?: string[] // 例外日期

  // 虚拟实例标记（用于重复事件的实例）
  isRecurringInstance?: boolean
  originalEventId?: string
}

// 颜色标签
export interface ColorLabel {
  id: string
  name: string
  color: string
  order: number
  showColorPicker?: boolean // 临时属性，用于UI控制
}

// 默认颜色标签 (优化模块9：调整默认颜色为蓝、黄、红、绿、紫)
export const DEFAULT_COLOR_LABELS: ColorLabel[] = [
  { id: 'label-1', name: '工作', color: '#3b82f6', order: 0 }, // 第1，蓝色-工作
  { id: 'label-2', name: '重要', color: '#f59e0b', order: 1 }, // 第2，黄色-重要
  { id: 'label-3', name: '警示', color: '#ef4444', order: 2 }, // 第3，红色-警示
  { id: 'label-4', name: '个人', color: '#10b981', order: 3 }, // 第4，绿色-个人
  { id: 'label-5', name: '生日', color: '#8b5cf6', order: 4 }, // 第5，紫色-生日
]

// 时间范围
export interface TimeRange {
  start: Date
  end: Date
}

// 日期状态
export interface DateStatus {
  isToday: boolean
  isWeekend: boolean
  isCurrentMonth: boolean
  isPast: boolean
}

// 事件布局（用于重叠事件的定位）
export interface EventLayout {
  event: CalendarEvent
  column: number // 所在列
  totalColumns: number // 总列数
  width: string // CSS宽度（百分比）
  left: string // CSS左偏移（百分比）
  top: number // CSS顶部位置（像素）
  height: number // CSS高度（像素）
}

// 选择框
export interface SelectionBox {
  top: number
  height: number
  start: Date
  end: Date
  column?: number // 用于周视图，指定在哪一列
}

// 重复规则选项
export interface RecurrenceOptions {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  byweekday?: number[] // 0-6, 周日到周六
  bymonthday?: number // 1-31
  count?: number // 重复次数
  until?: Date // 结束日期
}

// 用户偏好设置
export interface CalendarPreferences {
  colorLabels?: ColorLabel[]
  calendarViewMode?: ViewMode
  weekDisplayDays?: number
  defaultEventDuration?: number // 分钟
  workingHoursStart?: number // 0-23
  workingHoursEnd?: number // 0-23
}

// 月份相对位置提示类型
export type MonthHintType = 'current' | 'next' | 'near' | 'far'
