<template>
  <section
    class="outflow-structure"
    data-chart-type="donut"
    :aria-label="title"
  >
    <header>
      <h4>{{ title }}</h4>
      <p class="outflow-structure-scope">{{ scopeLabel }}</p>
    </header>
    <p v-if="!completeShare" class="outflow-structure-warning" role="status">
      占比仅使用已知正分类；负数和未知不参与占比，未知不会按零计入圆心总金额。
      <span v-if="totalMismatch"
        >分类已知金额与圆心金额不一致，请核对来源。</span
      >
    </p>
    <div class="outflow-structure-content">
      <div class="outflow-ring-zone">
        <svg
          class="outflow-ring"
          :class="{ 'is-neutral': !slices.length }"
          viewBox="0 0 240 240"
          role="img"
          :aria-label="ringDescription"
        >
          <circle
            cx="120"
            cy="120"
            r="88"
            fill="none"
            stroke="#e8eef1"
            stroke-width="32"
          />
          <circle
            v-for="slice in slices"
            :key="slice.key"
            class="outflow-ring-slice"
            :data-category="slice.key"
            cx="120"
            cy="120"
            r="88"
            fill="none"
            stroke-width="32"
            :stroke="slice.color"
            :stroke-dasharray="
              slice.arcLength + ' ' + (circumference - slice.arcLength)
            "
            :stroke-dashoffset="-slice.offset"
            transform="rotate(-90 120 120)"
            tabindex="0"
            role="img"
            :aria-label="
              slice.label +
              '，' +
              slice.amountText +
              '，占比' +
              slice.percentage
            "
          >
            <title>
              {{ slice.label }}：{{ slice.amountText }}，{{ slice.percentage }}
            </title>
          </circle>
        </svg>
        <div
          class="outflow-ring-center"
          :aria-label="totalLabel + '：' + totalText"
        >
          <span class="outflow-total-label">{{ totalLabel }}</span>
          <strong
            class="outflow-total-amount"
            :class="{ 'is-unknown': normalizedTotal === null }"
            >{{ totalText }}</strong
          >
          <small v-if="!completeShare && slices.length"
            >占比仅含已知正分类</small
          >
        </div>
      </div>
      <div class="outflow-category-list">
        <div class="outflow-category-heading" aria-hidden="true">
          <span>支出分类</span><span>金额</span><span>占比</span>
        </div>
        <ul aria-label="支出分类金额与占比">
          <li
            v-for="item in categories"
            :key="item.key"
            :data-category="item.key"
          >
            <span class="outflow-category-name"
              ><i :style="{ background: item.color }" aria-hidden="true"></i
              >{{ item.label }}</span
            >
            <strong
              class="outflow-category-amount"
              :class="{
                'is-unknown': item.normalized === null,
                'is-negative': item.negative,
              }"
              >{{ item.amountText }}</strong
            >
            <span class="outflow-category-percentage">{{
              item.percentage
            }}</span>
          </li>
        </ul>
      </div>
    </div>
    <p v-if="emptyReason" class="outflow-structure-empty" role="status">
      {{ emptyReason }}
    </p>
    <p v-if="note" class="outflow-structure-note">{{ note }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { FinancialAnalysisValue } from "@/types/monthlyFinancialAnalysis";
import { addFinancialAmountTexts } from "@/utils/monthlyFinancialReportPresentation";
import {
  formatDrilldownAmount,
  knownDrilldownAmount,
  sumDrilldownAmounts,
} from "@/utils/monthlyFinancialAnalysisDrilldown";

const props = withDefaults(
  defineProps<{
    title: string;
    scopeLabel: string;
    items: FinancialAnalysisValue[];
    total: string | null;
    note?: string;
    totalLabel?: string;
    comparableToTotal?: boolean;
  }>(),
  { note: "", totalLabel: "总支出", comparableToTotal: true },
);
const colors = [
  "#20848a",
  "#637bc1",
  "#c59243",
  "#a277aa",
  "#63a287",
  "#cf8870",
];
const circumference = 2 * Math.PI * 88;
const normalize = (value: unknown) => {
  const known = knownDrilldownAmount(value);
  return known === null ? null : addFinancialAmountTexts(known, "0");
};
const rawCategories = computed(() =>
  props.items
    .filter((item) => item.key !== "total")
    .map((item, index) => {
      const normalized = normalize(item.amount);
      return {
        ...item,
        normalized,
        amountText: formatDrilldownAmount(item.amount),
        negative: normalized !== null && normalized.startsWith("-"),
        positive:
          normalized !== null &&
          normalized !== "0" &&
          !normalized.startsWith("-"),
        color: colors[index % colors.length],
      };
    }),
);
const normalizedTotal = computed(() => normalize(props.total));
const totalText = computed(() => formatDrilldownAmount(props.total));
const categoryTotal = computed(() =>
  sumDrilldownAmounts(rawCategories.value.map((item) => item.normalized)),
);
const totalMismatch = computed(
  () =>
    props.comparableToTotal &&
    normalizedTotal.value !== null &&
    categoryTotal.value !== null &&
    normalizedTotal.value !== categoryTotal.value,
);
const completeShare = computed(
  () =>
    props.comparableToTotal &&
    props.totalLabel !== "已知分类总金额" &&
    rawCategories.value.length > 0 &&
    rawCategories.value.every(
      (item) => item.normalized !== null && !item.negative,
    ) &&
    normalizedTotal.value !== null &&
    !totalMismatch.value,
);
const positiveTotal = computed(() =>
  rawCategories.value.reduce(
    (sum, item) =>
      item.positive ? addFinancialAmountTexts(sum, item.normalized!) : sum,
    "0",
  ),
);

// 金额及合计保持十进制字符串，浮点数仅用于图形角度和百分比显示。
const categories = computed(() =>
  rawCategories.value.map((item) => {
    const denominator = Number(positiveTotal.value);
    const numerator = Number(item.normalized);
    const ratio =
      item.normalized === "0"
        ? 0
        : item.positive &&
            Number.isFinite(numerator) &&
            Number.isFinite(denominator) &&
            denominator > 0
          ? numerator / denominator
          : null;
    return {
      ...item,
      ratio,
      percentage: ratio === null ? "—" : (ratio * 100).toFixed(2) + "%",
    };
  }),
);
const slices = computed(() => {
  let offset = 0;
  return categories.value.flatMap((item) => {
    if (!item.positive || item.ratio === null || item.ratio <= 0) return [];
    const arcLength = item.ratio * circumference;
    const slice = { ...item, arcLength, offset };
    offset += arcLength;
    return [slice];
  });
});
const emptyReason = computed(() => {
  if (slices.value.length) return "";
  if (
    rawCategories.value.length &&
    rawCategories.value.every((item) => item.normalized === "0")
  )
    return "各支出分类均为零，以中性环展示；真实零值保留为 ¥0.00、0.00%。";
  if (
    !rawCategories.value.length ||
    rawCategories.value.every((item) => item.normalized === null)
  )
    return "各支出分类均未知，以中性环展示，不将未知金额当作零。";
  return "暂无可用于占比的已知正分类；负数、未知及精确金额仍完整保留。";
});
const ringDescription = computed(
  () =>
    `${props.title}；${props.scopeLabel}；${props.totalLabel}：${totalText.value}；${slices.value.length ? (completeShare.value ? "完整分类占比" : "仅已知正分类占比，不代表完整总支出") : "中性环，暂无可展示占比"}`,
);
</script>

<style scoped>
.outflow-structure {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e0e8ed;
  border-radius: 10px;
  background: #fff;
  color: #355565;
}
h4 {
  margin: 0;
  color: #284b60;
  font-size: 15px;
  line-height: 1.5;
  font-weight: 650;
}
.outflow-structure-scope,
.outflow-structure-note {
  margin: 5px 0 0;
  color: #80939f;
  font-size: 11px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.outflow-structure-content {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px 24px;
  margin-top: 16px;
  min-width: 0;
}
.outflow-ring-zone {
  position: relative;
  flex: 0 1 250px;
  width: 250px;
  max-width: 100%;
  margin-inline: auto;
}
.outflow-ring {
  display: block;
  width: 100%;
  overflow: visible;
}
.outflow-ring-slice:focus-visible {
  outline: none;
  filter: brightness(0.85);
  stroke-width: 35px;
}
.outflow-ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;
  padding-inline: 23%;
  pointer-events: none;
  text-align: center;
}
.outflow-total-label {
  color: #7a8e9c;
  font-size: 11px;
}
.outflow-total-amount {
  display: block;
  width: 100%;
  color: #2c5167;
  font-size: 15px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.outflow-ring-center small {
  color: #9b875b;
  font-size: 9px;
  line-height: 1.5;
}
.outflow-category-list {
  flex: 1 1 320px;
  min-width: 0;
}
.outflow-category-heading,
.outflow-category-list li {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(0, 1.25fr) 56px;
  gap: 8px;
  align-items: baseline;
}
.outflow-category-heading {
  padding-bottom: 8px;
  color: #91a0aa;
  font-size: 10px;
}
.outflow-category-heading > :not(:first-child) {
  text-align: right;
}
.outflow-category-list ul {
  padding: 0;
  margin: 0;
  list-style: none;
}
.outflow-category-list li {
  padding: 11px 0;
  border-top: 1px solid #edf1f4;
  font-size: 12px;
  line-height: 1.6;
}
.outflow-category-name {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.outflow-category-name i {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.outflow-category-amount,
.outflow-category-percentage {
  text-align: right;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.outflow-category-percentage {
  font-size: 11px;
  color: #6d8493;
}
.is-negative {
  color: #ad6759;
}
.is-unknown {
  color: #9aa7af;
  font-weight: 500;
}
.outflow-structure-warning {
  margin: 12px 0 0;
  padding: 9px 11px;
  border: 1px solid #eadfc7;
  border-radius: 6px;
  background: #fffaef;
  color: #967333;
  font-size: 11px;
  line-height: 1.7;
}
.outflow-structure-empty {
  margin: 14px 0 0;
  color: #8a9ca7;
  font-size: 11px;
  line-height: 1.7;
  text-align: center;
}
.outflow-structure-note {
  margin-top: 13px;
}
@media (max-width: 480px) {
  .outflow-structure {
    padding: 13px;
  }
  .outflow-category-list {
    flex-basis: 100%;
  }
  .outflow-category-heading,
  .outflow-category-list li {
    grid-template-columns: minmax(82px, 0.95fr) minmax(0, 1.4fr) 49px;
    gap: 6px;
  }
  .outflow-total-amount {
    font-size: 14px;
  }
}
</style>
