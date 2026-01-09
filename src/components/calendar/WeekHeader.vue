<template>
  <div class="week-header">
    <!-- 左侧时间轴占位 - 添加"全天"标签 -->
    <div class="time-axis-placeholder">
      <span class="all-day-label">全天</span>
    </div>

    <!-- 日期列头部 -->
    <div class="days-header">
      <div
        v-for="(day, index) in weekDays"
        :key="index"
        class="day-header"
      >
        <div class="day-label" :class="{ today: day.isToday }">
          周{{ day.weekdayText }}{{ day.date.getDate() }}
        </div>
      </div>
    </div>

    <!-- 调整天数按钮 -->
    <div class="display-days-controls">
      <el-button-group size="small">
        <el-button
          :icon="Minus"
          :disabled="displayDays <= 5"
          @click="decreaseDays"
        />
        <el-button
          :icon="Plus"
          :disabled="displayDays >= 7"
          @click="increaseDays"
        />
      </el-button-group>
      <span class="days-text">{{ displayDays }}天</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, type Ref } from 'vue'
import { Plus, Minus } from '@element-plus/icons-vue'
import { addDays } from 'date-fns'
import { getWeekdayShort, isToday } from '@/utils/calendar'

// Inject 父组件状态
const currentDate = inject<Ref<Date>>('currentDate')!
const weekDisplayDays = inject<Ref<number>>('weekDisplayDays')!

// 计算属性
const displayDays = computed(() => weekDisplayDays.value)

// 生成周日期数组
const weekDays = computed(() => {
  const startDate = getWeekStart(currentDate.value)
  const days = []

  for (let i = 0; i < displayDays.value; i++) {
    const date = addDays(startDate, i)
    days.push({
      date,
      weekdayText: getWeekdayShort(date),
      isToday: isToday(date),
    })
  }

  return days
})

// 获取周起始日期（周一）
function getWeekStart(date: Date): Date {
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day // 周一为起始
  const result = new Date(date)
  result.setDate(date.getDate() + diff)
  result.setHours(0, 0, 0, 0)
  return result
}

// Emit
const emit = defineEmits<{
  changeDisplayDays: [days: number]
}>()

// 减少显示天数
function decreaseDays() {
  if (displayDays.value > 5) {
    const newDays = displayDays.value - 1
    weekDisplayDays.value = newDays
    emit('changeDisplayDays', newDays)
  }
}

// 增加显示天数
function increaseDays() {
  if (displayDays.value < 7) {
    const newDays = displayDays.value + 1
    weekDisplayDays.value = newDays
    emit('changeDisplayDays', newDays)
  }
}
</script>

<style scoped>
.week-header {
  display: flex;
  align-items: center;
  height: 60px;
  border-bottom: 1px solid #e1e4e8;
  background: #fff;
  position: sticky;
  top: 0;
  z-index: 5;
}

/* 左侧时间轴占位 */
.time-axis-placeholder {
  width: 60px;
  flex-shrink: 0;
  border-right: 1px solid #e1e4e8;
  background: #fafbfc;
  display: flex;
  align-items: center;
  justify-content: center;
}

.all-day-label {
  font-size: 11px;
  color: #909399;
  font-weight: 500;
}

/* 日期列头部 */
.days-header {
  flex: 1;
  display: flex;
}

.day-header {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  border-right: 1px solid #e1e4e8;
}

.day-header:last-child {
  border-right: none;
}

/* "周一15" 样式标签 */
.day-label {
  font-size: 14px;
  font-weight: 600;
  color: #606266;
  padding: 6px 12px;
  border-radius: 6px;
  transition: all 0.2s;
}

/* 当日红色矩形圆角背景 + 白色字体 */
.day-label.today {
  background: #e74c3c;
  color: #fff;
  padding: 6px 16px;
}

/* 调整天数控制 */
.display-days-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-left: 1px solid #e1e4e8;
}

.days-text {
  font-size: 12px;
  color: #606266;
  font-weight: 500;
  min-width: 32px;
  text-align: center;
}
</style>
