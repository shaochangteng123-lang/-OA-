<template>
  <el-date-picker
    :model-value="modelValue"
    type="date"
    :placeholder="placeholder"
    format="YYYY-MM-DD"
    value-format="YYYY-MM-DD"
    :disabled-date="disabledDate"
    class="leave-date-picker"
    popper-class="leave-date-picker-popper"
    @update:model-value="handleModelValueUpdate"
    @change="handleChange"
    @panel-change="handlePanelChange"
    @visible-change="handleVisibleChange"
  >
    <template #default="cell">
      <div class="el-date-table-cell">
        <span class="el-date-table-cell__text leave-date-cell" :class="getMarkerClass(cell.date)">
          <span class="leave-date-cell__day">{{ cell.date.getDate() }}</span>
          <span
            v-if="getMarker(cell.date)?.name"
            class="leave-date-cell__name"
            :title="getMarker(cell.date)?.title"
          >
            {{ getMarker(cell.date)?.name }}
          </span>
          <span
            v-if="getMarker(cell.date)?.type === 'workday'"
            class="leave-date-cell__tag leave-date-cell__tag--workday"
            :title="getMarker(cell.date)?.title"
            :aria-label="getMarker(cell.date)?.title"
          >
            班
          </span>
          <span
            v-else-if="getMarker(cell.date)"
            class="leave-date-cell__tag"
            :class="`leave-date-cell__tag--${getMarker(cell.date)?.type}`"
          >
            {{ getMarker(cell.date)?.tag }}
          </span>
        </span>
      </div>
    </template>
  </el-date-picker>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { HolidayInfo } from '@/utils/holidays'
import { getHolidaysByYear, getHolidaysByYearSync } from '@/utils/holidays'
import { formatLocalDateValue } from '@/utils/leaveDate'
import { getLeaveDateMarker, type LeaveDateMarker } from '@/utils/leaveHolidayDisplay'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    placeholder?: string
    disabledDate?: (date: Date) => boolean
  }>(),
  {
    modelValue: '',
    placeholder: '选择日期',
    disabledDate: undefined,
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}>()

const holidayMap = ref<Map<string, HolidayInfo>>(new Map())
const loadedYears = new Set<number>()
const loadingYears = new Map<number, Promise<void>>()

function mergeHolidayData(year: number, holidays: HolidayInfo[]) {
  const yearPrefix = `${year}-`
  const nextMap = new Map(holidayMap.value)

  for (const date of nextMap.keys()) {
    if (date.startsWith(yearPrefix)) nextMap.delete(date)
  }
  for (const holiday of holidays) {
    nextMap.set(holiday.date, holiday)
  }

  holidayMap.value = nextMap
}

function loadFallbackData(year: number) {
  if (loadedYears.has(year)) return
  const holidays = getHolidaysByYearSync(year)
  if (holidays.length > 0) mergeHolidayData(year, holidays)
}

async function loadHolidayYear(year: number) {
  if (loadedYears.has(year)) return
  const pending = loadingYears.get(year)
  if (pending) return pending

  const request = getHolidaysByYear(year)
    .then((holidays) => {
      if (holidays.length === 0) return
      mergeHolidayData(year, holidays)
      loadedYears.add(year)
    })
    .finally(() => {
      loadingYears.delete(year)
    })

  loadingYears.set(year, request)
  return request
}

async function loadHolidayWindow(year: number) {
  const years = [year - 1, year, year + 1]
  years.forEach(loadFallbackData)
  for (const targetYear of years) {
    await loadHolidayYear(targetYear)
  }
}

function getModelYear(value = props.modelValue): number {
  const match = /^(\d{4})-/.exec(value)
  return match ? Number(match[1]) : new Date().getFullYear()
}

function getPanelYear(value: unknown): number | null {
  const date = Array.isArray(value) ? value[0] : value
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getFullYear() : null
}

function getMarker(date: Date): LeaveDateMarker | null {
  const holidayInfo = holidayMap.value.get(formatLocalDateValue(date)) || null
  return getLeaveDateMarker(date, holidayInfo)
}

function getMarkerClass(date: Date): string {
  const marker = getMarker(date)
  return marker ? `leave-date-cell--${marker.type}` : 'leave-date-cell--plain'
}

function normalizeDateValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function handleModelValueUpdate(value: unknown) {
  emit('update:modelValue', normalizeDateValue(value))
}

function handleChange(value: unknown) {
  emit('change', normalizeDateValue(value))
}

function handlePanelChange(value: unknown) {
  const year = getPanelYear(value)
  if (year) void loadHolidayWindow(year)
}

function handleVisibleChange(visible: boolean) {
  if (visible) void loadHolidayWindow(getModelYear())
}

watch(
  () => props.modelValue,
  (value) => {
    if (value) void loadHolidayWindow(getModelYear(value))
  }
)

onMounted(() => {
  void loadHolidayWindow(getModelYear())
})
</script>

<style scoped>
.leave-date-picker {
  width: 160px !important;
}
</style>

<style>
.leave-date-picker-popper {
  max-width: calc(100vw - 16px);
}

.leave-date-picker-popper .el-date-picker {
  width: 358px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
}

.leave-date-picker-popper .el-date-picker .el-picker-panel__content {
  width: calc(100% - 20px);
  margin: 8px 10px 10px;
}

.leave-date-picker-popper .el-date-table td {
  height: 44px;
  padding: 2px 0;
}

.leave-date-picker-popper .el-date-table-cell {
  height: 40px;
  padding: 0;
}

.leave-date-picker-popper
  .el-date-table
  td
  .el-date-table-cell
  .el-date-table-cell__text.leave-date-cell {
  top: 0;
  left: 2px;
  width: calc(100% - 4px);
  height: 40px;
  padding: 4px 2px 2px;
  transform: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  box-sizing: border-box;
  border-radius: 4px;
  line-height: 1;
  letter-spacing: 0;
}

.leave-date-picker-popper .leave-date-cell--plain {
  justify-content: center;
}

.leave-date-picker-popper .leave-date-cell__day {
  align-self: flex-start;
  min-height: 16px;
  padding-left: 3px;
  font-size: 12px;
  line-height: 16px;
}

.leave-date-picker-popper .leave-date-cell--plain .leave-date-cell__day {
  align-self: center;
  padding-left: 0;
}

.leave-date-picker-popper .leave-date-cell__name {
  display: block;
  width: 100%;
  overflow: hidden;
  color: #c45656;
  font-size: 9px;
  line-height: 12px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leave-date-picker-popper .leave-date-cell--workday .leave-date-cell__name {
  color: #9a6400;
}

.leave-date-picker-popper .leave-date-cell--weekend .leave-date-cell__name {
  color: #909399;
}

.leave-date-picker-popper .leave-date-cell__tag {
  position: absolute;
  top: 3px;
  right: 3px;
  color: #d94f4f;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
}

.leave-date-picker-popper .leave-date-cell__tag--workday {
  color: #a66800;
}

.leave-date-picker-popper td.current:not(.disabled) .leave-date-cell__name,
.leave-date-picker-popper td.current:not(.disabled) .leave-date-cell__tag,
.leave-date-picker-popper td.start-date:not(.disabled) .leave-date-cell__name,
.leave-date-picker-popper td.start-date:not(.disabled) .leave-date-cell__tag,
.leave-date-picker-popper td.end-date:not(.disabled) .leave-date-cell__name,
.leave-date-picker-popper td.end-date:not(.disabled) .leave-date-cell__tag {
  color: #ffffff;
}

.leave-date-picker-popper td.disabled .leave-date-cell__name,
.leave-date-picker-popper td.disabled .leave-date-cell__tag,
.leave-date-picker-popper td.prev-month .leave-date-cell__name,
.leave-date-picker-popper td.prev-month .leave-date-cell__tag,
.leave-date-picker-popper td.next-month .leave-date-cell__name,
.leave-date-picker-popper td.next-month .leave-date-cell__tag {
  color: var(--el-text-color-placeholder);
}
</style>
