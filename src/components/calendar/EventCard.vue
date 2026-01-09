<template>
  <div
    class="event-card"
    :class="{ past: isPast, 'all-day': event.allDay }"
    :style="cardStyle"
    @click="$emit('click', event)"
  >
    <div class="event-time" v-if="!event.allDay && showTime">
      {{ formatTime(event.startTime) }}
    </div>
    <div class="event-title">{{ event.title || '(无标题)' }}</div>
    <div class="event-location" v-if="event.location">
      <el-icon><Location /></el-icon>
      {{ event.location }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Location } from '@element-plus/icons-vue'
import { formatTimeAMPM, isEventPast } from '@/utils/calendar'
import type { CalendarEvent, EventLayout } from '@/types/calendar'

interface Props {
  event: CalendarEvent
  layout?: EventLayout
  showTime?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  showTime: true,
})

defineEmits<{
  click: [event: CalendarEvent]
}>()

// 是否已过期
const isPast = computed(() => isEventPast(props.event))

// 卡片样式
const cardStyle = computed(() => {
  const baseColor = props.event.color || '#3b82f6'

  // 如果已过期，使用更浅更暗的颜色
  const opacity = isPast.value ? 0.5 : 1
  const backgroundColor = isPast.value
    ? `${baseColor}20` // 更浅的背景
    : `${baseColor}30`

  const style: any = {
    borderLeft: `3px solid ${baseColor}`,
    background: backgroundColor,
    opacity: opacity,
  }

  // 如果有布局信息（周视图/日视图）
  if (props.layout) {
    style.position = 'absolute'
    style.left = props.layout.left
    style.width = props.layout.width
    style.top = `${props.layout.top}px`
    style.height = `${props.layout.height}px`
    style.minHeight = 'auto'
  }

  return style
})

// 格式化时间
function formatTime(timeStr: string): string {
  return formatTimeAMPM(new Date(timeStr))
}
</script>

<style scoped>
/* 优化模块22：事件卡片文字基于卡片上下居中 */
.event-card {
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  min-height: 20px;
  overflow: hidden;
  user-select: none;
  display: flex;
  flex-direction: column;
  justify-content: center; /* 内容垂直居中 */
}

.event-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 10;
}

.event-card.past {
  opacity: 0.6;
}

.event-card.all-day {
  min-height: 20px;
  padding: 2px 6px;
}

.event-time {
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 2px;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-title {
  font-size: 12px;
  font-weight: 500;
  color: #303133;
  line-height: 1.4;
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.event-card.all-day .event-title {
  font-size: 11px;
  -webkit-line-clamp: 1;
}

.event-location {
  font-size: 10px;
  color: #606266;
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-location .el-icon {
  font-size: 10px;
}
</style>
