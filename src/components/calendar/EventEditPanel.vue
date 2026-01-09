<template>
  <div class="event-edit-panel">
    <!-- 标题（无分割线） -->
    <div class="panel-header">
      <span class="panel-title">{{ isNew ? '新建日程' : '编辑日程' }}</span>
      <el-button text :icon="Close" @click="handleClose" />
    </div>

    <!-- 优化模块31：表单（标签与输入框同行，描述除外） -->
    <div class="panel-body">
      <el-form ref="formRef" :model="formData" label-position="left" label-width="50px" @submit.prevent>
        <!-- 标题 -->
        <el-form-item label="标题">
          <el-input
            v-model="formData.title"
            placeholder="请输入日程标题"
            maxlength="100"
          />
        </el-form-item>

        <!-- 优化模块33：时间段选项（全天、上午、下午、晚上）同行显示 -->
        <el-form-item label="" class="time-period-item">
          <div class="time-period-options">
            <div class="time-period-option">
              <input
                id="period-allday"
                type="checkbox"
                :checked="formData.allDay"
                @change="handleTimePeriodChange('allDay')"
              />
              <label for="period-allday">全天</label>
            </div>
            <div class="time-period-option">
              <input
                id="period-morning"
                type="checkbox"
                :checked="timePeriod === 'morning'"
                @change="handleTimePeriodChange('morning')"
              />
              <label for="period-morning">上午</label>
            </div>
            <div class="time-period-option">
              <input
                id="period-afternoon"
                type="checkbox"
                :checked="timePeriod === 'afternoon'"
                @change="handleTimePeriodChange('afternoon')"
              />
              <label for="period-afternoon">下午</label>
            </div>
            <div class="time-period-option">
              <input
                id="period-evening"
                type="checkbox"
                :checked="timePeriod === 'evening'"
                @change="handleTimePeriodChange('evening')"
              />
              <label for="period-evening">晚上</label>
            </div>
          </div>
        </el-form-item>

        <!-- 优化模块19：开始时间，日期+时间分离，时间仅显示15分钟刻度 -->
        <el-form-item label="开始">
          <div class="datetime-picker-row">
            <el-date-picker
              v-model="startDate"
              type="date"
              placeholder="选择日期"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              :clearable="false"
              style="flex: 1"
            />
            <el-time-select
              v-if="!formData.allDay"
              v-model="startTime"
              start="00:00"
              end="23:45"
              step="00:15"
              placeholder="时间"
              style="width: 100px; margin-left: 8px"
            />
          </div>
        </el-form-item>

        <!-- 优化模块19：结束时间，日期+时间分离，时间仅显示15分钟刻度 -->
        <el-form-item label="结束">
          <div class="datetime-picker-row">
            <el-date-picker
              v-model="endDate"
              type="date"
              placeholder="选择日期"
              format="YYYY-MM-DD"
              value-format="YYYY-MM-DD"
              :clearable="false"
              style="flex: 1"
            />
            <el-time-select
              v-if="!formData.allDay"
              v-model="endTime"
              start="00:00"
              end="23:45"
              step="00:15"
              placeholder="时间"
              style="width: 100px; margin-left: 8px"
            />
          </div>
        </el-form-item>

        <!-- 优化模块32：重复（一次性显示所有选项，不滚动） -->
        <el-form-item label="重复">
          <el-select
            v-model="formData.recurrence"
            placeholder="不重复"
            style="width: 100%"
            :popper-options="{ modifiers: [{ name: 'computeStyles', options: { adaptive: false } }] }"
            popper-class="recurrence-select-popper"
          >
            <el-option label="不重复" value="none" />
            <el-option label="每天" value="daily" />
            <el-option label="每工作日（周一至周五）" value="weekdays" />
            <el-option label="每周" value="weekly" />
            <el-option label="每两周" value="biweekly" />
            <el-option label="每月（按日期）" value="monthly" />
            <el-option label="每月最后一天" value="monthly_last" />
            <el-option label="每季度" value="quarterly" />
            <el-option label="每年" value="yearly" />
          </el-select>
        </el-form-item>

        <!-- 颜色 -->
        <el-form-item label="颜色">
          <div class="color-options-inline">
            <div
              v-for="label in displayColorLabels"
              :key="label.id"
              class="color-dot"
              :class="{ active: formData.colorLabel === label.id }"
              :style="{ background: label.color }"
              :title="label.name"
              @click="formData.colorLabel = label.id"
            />
          </div>
        </el-form-item>

        <!-- 描述（保持原样：标签在上方） -->
        <el-form-item label="描述" label-position="top" class="description-item">
          <el-input
            v-model="formData.description"
            type="textarea"
            :rows="3"
            placeholder="添加描述..."
            maxlength="500"
            show-word-limit
            :autosize="false"
            resize="none"
          />
        </el-form-item>
      </el-form>
    </div>

    <!-- 底部按钮 -->
    <div class="panel-footer">
      <el-button v-if="!isNew" type="danger" @click="handleDelete">删除</el-button>
      <div style="flex: 1"></div>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject, type Ref } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { format } from 'date-fns'
import type { CalendarEvent, ColorLabel } from '@/types/calendar'

interface Props {
  event?: CalendarEvent | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  save: [event: Partial<CalendarEvent>]
  delete: [eventId: string]
  close: []
  focusInput: []
  allDayChange: [allDay: boolean, startDate: string, endDate: string]
  timePeriodChange: [startTime: string, endTime: string]
}>()

// Inject 颜色标签
const colorLabels = inject<Ref<ColorLabel[]>>('colorLabels')!

// 优化模块19：将时间对齐到15分钟刻度（0/15/30/45）
function alignMinutesTo15(timeStr: string): string {
  if (!timeStr || timeStr.length < 5) return timeStr
  const [hours, minutes] = timeStr.split(':').map(Number)
  // 对齐到最近的15分钟
  const alignedMinutes = Math.round(minutes / 15) * 15
  const finalHours = alignedMinutes >= 60 ? (hours + 1) % 24 : hours
  const finalMinutes = alignedMinutes % 60
  return `${String(finalHours).padStart(2, '0')}:${String(finalMinutes).padStart(2, '0')}`
}

// 优化模块19：日期和时间分离的计算属性
// 开始日期
const startDate = computed({
  get: () => {
    if (!formData.value.startTime) return ''
    return formData.value.startTime.split(' ')[0]
  },
  set: (val: string) => {
    const time = startTime.value || '09:00'
    formData.value.startTime = formData.value.allDay ? `${val} 00:00:00` : `${val} ${time}:00`
  }
})

// 开始时间（HH:mm格式，自动对齐到15分钟）
const startTime = computed({
  get: () => {
    if (!formData.value.startTime) return '09:00'
    const parts = formData.value.startTime.split(' ')
    if (parts.length < 2) return '09:00'
    const rawTime = parts[1].substring(0, 5) // 取 HH:mm
    return alignMinutesTo15(rawTime)
  },
  set: (val: string) => {
    const date = startDate.value || format(new Date(), 'yyyy-MM-dd')
    formData.value.startTime = `${date} ${val}:00`
  }
})

// 结束日期
const endDate = computed({
  get: () => {
    if (!formData.value.endTime) return ''
    return formData.value.endTime.split(' ')[0]
  },
  set: (val: string) => {
    const time = endTime.value || '10:00'
    formData.value.endTime = formData.value.allDay ? `${val} 23:59:00` : `${val} ${time}:00`
  }
})

// 结束时间（HH:mm格式，自动对齐到15分钟）
const endTime = computed({
  get: () => {
    if (!formData.value.endTime) return '10:00'
    const parts = formData.value.endTime.split(' ')
    if (parts.length < 2) return '10:00'
    const rawTime = parts[1].substring(0, 5) // 取 HH:mm
    return alignMinutesTo15(rawTime)
  },
  set: (val: string) => {
    const date = endDate.value || format(new Date(), 'yyyy-MM-dd')
    formData.value.endTime = `${date} ${val}:00`
  }
})

// 优化模块22：显示所有颜色标签，与左栏颜色标签面板一致
const displayColorLabels = computed(() => {
  return colorLabels.value
})

// 表单数据
const formData = ref({
  title: '',
  startTime: '',
  endTime: '',
  allDay: false,
  recurrence: 'none',
  colorLabel: '',
  description: '',
  location: '',
})

// 优化模块33：时间段选项
const timePeriod = ref<'morning' | 'afternoon' | 'evening' | null>(null)

// 时间段预设
const TIME_PERIODS = {
  morning: { start: '09:00:00', end: '12:00:00' },
  afternoon: { start: '14:00:00', end: '18:00:00' },
  evening: { start: '19:00:00', end: '22:00:00' },
}

// 处理时间段变化
// 优化模块36：选择上午/下午/晚上时，也需要更新框选范围
function handleTimePeriodChange(period: 'allDay' | 'morning' | 'afternoon' | 'evening') {
  if (period === 'allDay') {
    // 切换全天
    formData.value.allDay = !formData.value.allDay
    if (formData.value.allDay) {
      timePeriod.value = null
      // 优化模块19：通知父组件更新框选范围为全天
      const dateStr = formData.value.startTime.split(' ')[0] || format(new Date(), 'yyyy-MM-dd')
      emit('allDayChange', true, dateStr, dateStr)
    } else {
      // 取消全天，恢复默认时间段
      const dateStr = formData.value.startTime.split(' ')[0] || format(new Date(), 'yyyy-MM-dd')
      formData.value.startTime = `${dateStr} 09:00:00`
      formData.value.endTime = `${dateStr} 10:00:00`
      emit('allDayChange', false, dateStr, dateStr)
      // 同时发送时间段变化事件
      emit('timePeriodChange', `${dateStr} 09:00:00`, `${dateStr} 10:00:00`)
    }
  } else {
    // 切换时间段
    if (timePeriod.value === period) {
      // 取消选中
      timePeriod.value = null
    } else {
      // 选中新时间段
      timePeriod.value = period
      formData.value.allDay = false

      // 设置对应时间
      const dateStr = formData.value.startTime.split(' ')[0] || format(new Date(), 'yyyy-MM-dd')
      formData.value.startTime = `${dateStr} ${TIME_PERIODS[period].start}`
      formData.value.endTime = `${dateStr} ${TIME_PERIODS[period].end}`
      // 优化模块36：通知父组件更新框选范围为对应时间段
      emit('timePeriodChange', `${dateStr} ${TIME_PERIODS[period].start}`, `${dateStr} ${TIME_PERIODS[period].end}`)
    }
  }
}

// 是否是新建
const isNew = computed(() => !props.event?.id)

// 监听event变化，初始化表单
watch(
  () => props.event,
  (newEvent) => {
    if (newEvent) {
      // 编辑现有事件
      formData.value = {
        title: newEvent.title || '',
        startTime: formatDateTime(newEvent.startTime),
        endTime: formatDateTime(newEvent.endTime),
        allDay: newEvent.allDay || false,
        recurrence: 'none', // 简化处理
        colorLabel: newEvent.colorLabel || colorLabels.value[0]?.id || '',
        description: newEvent.description || '',
        location: newEvent.location || '',
      }
    } else {
      // 重置表单
      resetForm()
    }
  },
  { immediate: true, deep: true }
)

// 格式化日期时间（精确到分钟，不包含秒）
function formatDateTime(dateStr: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  return format(date, 'yyyy-MM-dd HH:mm:00')
}

// 重置表单
function resetForm() {
  const now = new Date()
  const start = new Date(now)
  start.setMinutes(0, 0, 0)
  const end = new Date(start)
  end.setHours(end.getHours() + 1)

  formData.value = {
    title: '',
    startTime: format(start, 'yyyy-MM-dd HH:mm:00'),
    endTime: format(end, 'yyyy-MM-dd HH:mm:00'),
    allDay: false,
    recurrence: 'none',
    colorLabel: colorLabels.value[0]?.id || '',
    description: '',
    location: '',
  }
}

// 关闭面板
function handleClose() {
  emit('close')
}

// 保存事件
function handleSave() {
  // 验证
  if (!formData.value.title.trim()) {
    ElMessage.warning('请输入日程标题')
    return
  }

  if (!formData.value.startTime || !formData.value.endTime) {
    ElMessage.warning('请选择开始时间和结束时间')
    return
  }

  const start = new Date(formData.value.startTime)
  const end = new Date(formData.value.endTime)

  if (end <= start) {
    ElMessage.warning('结束时间必须晚于开始时间')
    return
  }

  // 获取颜色
  const selectedLabel = colorLabels.value.find((l) => l.id === formData.value.colorLabel)
  const color = selectedLabel?.color || '#3b82f6'

  // 构建事件数据
  const eventData: Partial<CalendarEvent> = {
    ...props.event,
    title: formData.value.title.trim(),
    startTime: new Date(formData.value.startTime).toISOString(),
    endTime: new Date(formData.value.endTime).toISOString(),
    allDay: formData.value.allDay,
    color: color,
    colorLabel: formData.value.colorLabel,
    description: formData.value.description.trim(),
    location: formData.value.location.trim(),
  }

  emit('save', eventData)
}

// 删除事件
async function handleDelete() {
  try {
    await ElMessageBox.confirm('确定要删除这个日程吗？', '删除确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })

    if (props.event?.id) {
      emit('delete', props.event.id)
    }
  } catch {
    // 用户取消
  }
}
</script>

<style scoped>
/* 优化模块32：整体背景改为白色 */
.event-edit-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #ffffff;
}

/* 优化模块32：面板标题（增加下边距） */
.panel-header {
  padding: 20px 20px 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

/* 优化模块32：面板主体背景改为白色 */
.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 20px 20px;
  background: #ffffff;
}

/* 优化模块31：表单项样式调整 */
.panel-body :deep(.el-form-item) {
  margin-bottom: 16px;
}

.panel-body :deep(.el-form-item__label) {
  font-weight: 500;
  color: #303133;
  line-height: 32px;
}

/* 描述项单独处理：标签在上方 */
.panel-body :deep(.description-item) {
  display: flex;
  flex-direction: column;
}

.panel-body :deep(.description-item .el-form-item__label) {
  width: auto !important;
  margin-bottom: 8px;
}

/* 优化模块33：时间段选项样式 */
.time-period-item {
  margin-bottom: 12px !important;
}

.time-period-options {
  --_clr-primary: #666;
  --_clr-hover: #f33195;
  --_clr-checked: #127acf;
  display: flex;
  flex-direction: row;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.time-period-option {
  --_clr-current: var(--_clr-primary);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.time-period-option label {
  cursor: pointer;
  color: var(--_clr-current);
  transition: color 150ms ease-in-out;
  font-size: 13px;
  user-select: none;
}

/* 自定义复选框样式 */
.time-period-option input[type="checkbox"] {
  appearance: none;
  outline: none;
  width: 1.25rem;
  height: 1.25rem;
  aspect-ratio: 1;
  padding: 0.2rem;
  background: transparent;
  border: 1px solid var(--_clr-current);
  border-radius: 3px;
  display: grid;
  place-content: center;
  cursor: pointer;
  transition: border-color 150ms ease-in-out;
}

.time-period-option input[type="checkbox"]::after {
  content: "\2714";
  opacity: 0;
  transition: opacity 150ms ease-in-out;
  color: var(--_clr-checked);
  font-size: 0.75rem;
}

.time-period-option label:hover,
.time-period-option input[type="checkbox"]:focus-visible,
.time-period-option input[type="checkbox"]:focus-visible + label,
.time-period-option input[type="checkbox"]:hover,
.time-period-option input[type="checkbox"]:hover + label {
  --_clr-current: var(--_clr-hover);
}

.time-period-option input[type="checkbox"]:focus-visible::after,
.time-period-option input[type="checkbox"]:hover::after {
  opacity: 0.5;
  color: var(--_clr-hover);
}

.time-period-option input[type="checkbox"]:checked + label:not(:hover),
.time-period-option input[type="checkbox"]:checked:not(:hover) {
  --_clr-current: var(--_clr-checked);
}

.time-period-option input[type="checkbox"]:checked::after {
  opacity: 1;
}

/* 优化模块19：日期+时间选择器横向布局 */
.datetime-picker-row {
  display: flex;
  align-items: center;
  width: 100%;
}

/* 颜色选项（优化模块22：显示所有颜色标签，允许换行） */
.color-options-inline {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.color-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
  box-sizing: border-box;
}

.color-dot:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.color-dot.active {
  border-color: #303133;
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px currentColor;
}

/* 面板底部 */
.panel-footer {
  padding: 16px 20px;
  border-top: 1px solid #e1e4e8;
  display: flex;
  gap: 12px;
  background: #fff;
  flex-shrink: 0;
}

.panel-footer .el-button {
  min-width: 80px;
}
</style>

<!-- 优化模块32：重复选项下拉框全部显示（全局样式） -->
<style>
.recurrence-select-popper .el-select-dropdown__wrap {
  max-height: none !important;
}

.recurrence-select-popper .el-scrollbar__wrap {
  max-height: none !important;
}
</style>
