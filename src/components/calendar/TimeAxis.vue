<template>
  <div class="time-axis">
    <!-- 优化模块26：时间标签列，文字相对于整点线居中 -->
    <div class="time-labels">
      <div
        v-for="hour in hours"
        :key="hour"
        class="time-label"
        :style="{ height: `${pixelsPerHour}px` }"
      >
        <span class="time-text">{{ formatHour(hour) }}</span>
      </div>
    </div>

    <!-- 当前时间红线（优化模块11：全局显示，不管选择哪个日期） -->
    <div
      v-if="showCurrentTime && shouldShowTimeLine"
      class="current-time-indicator"
      :class="{ 'is-today': isToday, 'week-view': viewMode === 'week' }"
      :style="{ top: `${currentTimePosition}px` }"
    >
      <span class="current-time-label">{{ currentTimeText }}</span>
      <div class="current-time-line"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, inject, type Ref } from 'vue'
import { formatTimeAMPM, timeToPixels, isToday as checkIsToday } from '@/utils/calendar'
import type { ViewMode } from '@/types/calendar'

// Props
interface Props {
  pixelsPerHour?: number
  startHour?: number
  endHour?: number
  showCurrentTime?: boolean
  date?: Date // 用于判断是否是今天
}

const props = withDefaults(defineProps<Props>(), {
  pixelsPerHour: 60,
  startHour: 0,
  endHour: 24,
  showCurrentTime: true,
  date: () => new Date(),
})

// Inject 视图模式
const viewMode = inject<Ref<ViewMode>>('viewMode', ref('week'))

// 小时数组
const hours = computed(() => {
  const result: number[] = []
  for (let i = props.startHour; i < props.endHour; i++) {
    result.push(i)
  }
  return result
})

// 是否是今天
const isToday = computed(() => {
  return checkIsToday(props.date)
})

// 是否应该显示时间线（优化模块11：全局显示）
const shouldShowTimeLine = computed(() => {
  return true // 始终显示时间线
})

// 当前时间位置（像素）
const currentTimePosition = ref(0)
const currentTimeText = ref('')

// 格式化小时（优化模块8：AM/PM 格式）
function formatHour(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}

// 更新当前时间位置
function updateCurrentTime() {
  const now = new Date()
  currentTimePosition.value = timeToPixels(now, props.pixelsPerHour)
  currentTimeText.value = formatTimeAMPM(now)
}

// 定时器
let timer: NodeJS.Timeout | null = null

onMounted(() => {
  updateCurrentTime()
  // 每30秒更新一次
  timer = setInterval(updateCurrentTime, 30000)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<style scoped>
.time-axis {
  position: relative;
  display: flex;
  flex-direction: column;
}

/* 时间标签列（优化模块21：宽度40px，背景白色） */
.time-labels {
  width: 40px;
  flex-shrink: 0;
  background: #ffffff;
  position: relative;
  z-index: 2;
  min-height: 1440px; /* 确保足够高度显示24小时时间标签 */
}

/* 优化模块19：时间标签相对于整点横线上下居中
   每个时间块高度为 pixelsPerHour，文字放在块的顶部，向上偏移一半行高
   这样文字就会相对于整点线（块的顶部边界）居中 */
.time-label {
  font-size: 10px;
  color: #909399;
  text-align: right;
  padding-right: 4px;
  box-sizing: border-box;
  user-select: none;
  display: flex;
  align-items: flex-start; /* 顶部对齐，与整点线位置一致 */
  justify-content: flex-end;
  position: relative;
}

/* 优化模块19：时间文字相对于整点线居中
   文字向上偏移自身高度的一半，使得文字中心与整点线对齐 */
.time-text {
  transform: translateY(-50%);
  background: #ffffff;
  line-height: 1;
  padding: 0 2px;
}

/* 优化模块35：当前时间指示器容器
   top 值由 JS 设置为 currentTimePosition，表示当前时间的精确像素位置
   容器高度为 0，子元素通过 transform 向上偏移自身高度一半来实现垂直居中 */
.current-time-indicator {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 100;
  pointer-events: none;
  height: 0;
}

/* 优化模块35：当前时间标签（红色背景）
   固定高度 16px，通过 transform 向上移动 8px（自身高度一半）
   使得标签的垂直中心与 currentTimePosition 对齐 */
.current-time-label {
  position: absolute;
  left: 2px;
  top: 0;
  /* 优化模块35：向上偏移自身高度的一半（16px / 2 = 8px） */
  transform: translateY(-50%);
  font-size: 10px;
  color: #fff;
  font-weight: 600;
  background: #e74c3c;
  padding: 0 4px;
  border-radius: 3px;
  white-space: nowrap;
  z-index: 200;
  /* 优化模块35：使用固定高度和行高确保文字垂直居中 */
  height: 16px;
  line-height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

/* 优化模块35：当前时间红线
   高度 2px，通过 transform 向上移动 1px（自身高度一半）
   使得红线的垂直中心与 currentTimePosition 对齐，与标签完全一致 */
.current-time-line {
  position: absolute;
  left: 40px;
  right: 0;
  width: calc(100vw - 40px);
  max-width: none;
  top: 0;
  /* 优化模块35：向上偏移自身高度的一半（2px / 2 = 1px） */
  transform: translateY(-50%);
  height: 2px;
  background: #e74c3c;
  z-index: 100;
  pointer-events: none;
}

/* 周视图中加粗（优化模块10：当日加粗） */
.current-time-indicator.is-today.week-view .current-time-line {
  height: 3px;
}

/* 优化模块35：当前时间圆点（红线左侧的圆形标记） */
.current-time-line::before {
  content: '';
  position: absolute;
  left: -4px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  background: #e74c3c;
  border-radius: 50%;
  box-shadow: 0 0 0 2px #fff;
}
</style>
