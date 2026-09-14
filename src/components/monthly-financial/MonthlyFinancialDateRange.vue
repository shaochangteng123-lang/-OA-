<template>
  <section
    class="monthly-financial-date-range"
    :class="{ 'is-disabled': disabled }"
    role="group"
    :aria-labelledby="titleId"
  >
    <header class="range-heading">
      <span :id="titleId" class="range-title">
        <ElIcon class="range-calendar" aria-hidden="true"><Calendar /></ElIcon>
        统计期间
      </span>
      <button
        v-if="showShortcut"
        type="button"
        class="range-shortcut"
        :disabled="disabled || !recentRange"
        :title="
          recentRange
            ? '以当前结束月份为截止，选择包含该月的近12个月'
            : '仅支持1900至2099年，近12个月不能早于1900年1月'
        "
        @click="selectRecentRange"
      >
        近12个月
      </button>
    </header>
    <div class="range-control">
      <div class="range-endpoint-labels">
        <label :for="inputIds[0]"
          ><span class="visually-hidden">分析</span>开始月份</label
        >
        <span aria-hidden="true"></span>
        <label :for="inputIds[1]"
          ><span class="visually-hidden">分析</span>结束月份</label
        >
      </div>
      <ElConfigProvider :locale="zhCn">
        <ElDatePicker
          :id="inputIds"
          ref="pickerRef"
          v-model="pickerValue"
          class="month-range-picker"
          type="monthrange"
          format="YYYY年MM月"
          value-format="YYYY-MM"
          start-placeholder="开始月份"
          end-placeholder="结束月份"
          range-separator="至"
          :clearable="false"
          :editable="false"
          :disabled="disabled"
          :disabled-date="disabledDate"
          :teleported="true"
          :append-to="popperAppendTo"
          :unlink-panels="true"
          placement="bottom-start"
          popper-class="monthly-financial-date-range-popper"
          :popper-options="popperOptions"
        />
      </ElConfigProvider>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, ref, watch } from "vue";
import { ElConfigProvider, ElDatePicker, ElIcon } from "element-plus";
import { Calendar } from "@element-plus/icons-vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";

const props = withDefaults(
  defineProps<{
    modelValue: [string, string];
    disabled?: boolean;
    showShortcut?: boolean;
    popperAppendTo?: string | HTMLElement;
  }>(),
  { disabled: false, showShortcut: true, popperAppendTo: undefined },
);
const emit = defineEmits<{
  "update:modelValue": [value: [string, string]];
}>();
const pickerRef = ref<{ handleClose: () => void } | null>(null);
function close() {
  pickerRef.value?.handleClose?.();
}
watch(() => props.popperAppendTo, close);
defineExpose({ close });
const instanceId = getCurrentInstance()?.uid ?? 0;
const titleId = `monthly-financial-range-${instanceId}-title`;
const inputIds: [string, string] = [
  `monthly-financial-range-${instanceId}-from`,
  `monthly-financial-range-${instanceId}-to`,
];
const popperOptions = {
  modifiers: [
    {
      name: "preventOverflow",
      options: {
        padding: 12,
        rootBoundary: "viewport",
        altAxis: true,
        tether: false,
      },
    },
    { name: "flip", options: { padding: 12 } },
  ],
};
const MIN_YEAR = 1900;
const MAX_YEAR = 2099;
const validMonth = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(value))
    return false;
  const year = Number(value.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
};
function disabledDate(date: Date): boolean {
  const year = date.getFullYear();
  return !Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR;
}

function updateRange(value: unknown) {
  if (
    props.disabled ||
    !Array.isArray(value) ||
    value.length !== 2 ||
    !validMonth(value[0]) ||
    !validMonth(value[1]) ||
    value[0] > value[1]
  )
    return;
  if (value[0] === props.modelValue[0] && value[1] === props.modelValue[1])
    return;
  emit("update:modelValue", [value[0], value[1]]);
}

// 返回独立元组，日期控件或调用方都不能原位改写父组件的查询草稿。
const pickerValue = computed({
  get: (): [string, string] => [...props.modelValue],
  set: updateRange,
});
const recentRange = computed<[string, string] | null>(() => {
  const end = props.modelValue[1];
  if (!validMonth(end)) return null;
  const [year, month] = end.split("-").map(Number);
  const startIndex = year * 12 + month - 1 - 11;
  // 快捷区间必须完整落在系统允许范围内，不截短为不足十二个月，也不生成1899年。
  if (startIndex < MIN_YEAR * 12) return null;
  const start = `${String(Math.floor(startIndex / 12)).padStart(4, "0")}-${String((startIndex % 12) + 1).padStart(2, "0")}`;
  return [start, end];
});
function selectRecentRange() {
  // 只在显式点击后改变统计范围，不因挂载、月份更新或窗口尺寸自动截成十二个月。
  if (recentRange.value) updateRange(recentRange.value);
}
</script>

<style scoped>
.monthly-financial-date-range {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  color: #294d63;
}
.range-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 24px;
  margin-bottom: 7px;
}
.range-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 650;
}
.range-calendar {
  color: #18818a;
  font-size: 16px;
}
.range-shortcut {
  border: 0;
  border-radius: 4px;
  padding: 3px 7px;
  background: #e9f4f4;
  color: #28747b;
  font: inherit;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.range-shortcut:hover:not(:disabled) {
  background: #dcefee;
}
.range-shortcut:focus-visible {
  outline: 2px solid #16848a;
  outline-offset: 3px;
}
.range-shortcut:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.range-control {
  min-width: 0;
  height: var(--financial-filter-control-height, 56px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  justify-content: center;
  border: 1px solid #cfdfe6;
  border-radius: 9px;
  padding: 8px 9px 2px;
  background: #fff;
  box-shadow: 0 1px 3px rgb(23 62 84 / 3%);
  transition:
    border-color 0.15s,
    box-shadow 0.15s,
    background 0.15s;
}
.range-control:hover {
  border-color: #70aeb4;
  background: #fcfefe;
}
.range-control:focus-within {
  border-color: #16848a;
  box-shadow: 0 0 0 3px rgb(22 132 138 / 12%);
}
.range-endpoint-labels {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px minmax(0, 1fr);
  align-items: center;
  padding: 0 3px;
}
.range-endpoint-labels label {
  display: block;
  min-width: 0;
  margin: 0;
  color: #7a8f9c;
  font-size: 10px;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
}
.range-control :deep(.el-date-editor.el-input__wrapper) {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  height: 32px;
  padding: 0 3px;
  box-sizing: border-box;
  border: 0;
  background: transparent;
  box-shadow: none !important;
}
.range-control :deep(.el-range-input) {
  flex: 1 1 0;
  width: 0;
  min-width: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #294d63;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
}
.range-control :deep(.el-range-separator) {
  flex: 0 0 28px;
  width: 28px;
  padding: 0;
  color: #8ca3af;
  font-size: 11px;
}
.range-control :deep(.el-range__icon),
.range-control :deep(.el-range__close-icon) {
  display: none;
}
.is-disabled .range-control {
  background: #f5f7f8;
  border-color: #e0e7eb;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
@media (max-width: 420px) {
  .range-control {
    padding-right: 5px;
    padding-left: 5px;
  }
  .range-control :deep(.el-range-input) {
    font-size: 12px;
  }
}
</style>

<style>
/* 弹层挂到页面根节点，专用类只影响此控件，避免被筛选卡片或横向滚动容器裁剪。 */
.monthly-financial-date-range-popper {
  max-width: calc(100vw - 24px);
}
.monthly-financial-date-range-popper .el-date-range-picker {
  width: min(600px, calc(100vw - 24px));
  max-width: 100%;
  border-radius: 10px;
}
.monthly-financial-date-range-popper .el-picker-panel__body {
  min-width: 0;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}
@media (max-width: 620px) {
  .monthly-financial-date-range-popper .el-date-range-picker__content {
    display: block;
    float: none;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 12px;
    box-sizing: border-box;
  }
  .monthly-financial-date-range-popper .el-date-range-picker__content.is-left {
    border-right: 0;
    border-bottom: 1px solid #e6edef;
  }
}
</style>
