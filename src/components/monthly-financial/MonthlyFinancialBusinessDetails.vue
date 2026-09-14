<template>
  <section
    class="business-region-details"
    aria-label="商务统计按行政区分组明细"
  >
    <p class="region-scope-note">
      按财务区商务报销的“报销范围／区域”配置分组；区域小计为可核验明细之和，不替代缺失数据情况下的完整期间合计。公司内部单列，无法可靠归属的记录保留在“行政区未知”。
    </p>
    <p v-if="!groups.length" class="region-empty">所选范围暂无商务报销明细。</p>
    <details
      v-for="group in groups"
      :key="group.region"
      class="business-region-group"
      :data-region="group.region"
      open
    >
      <summary>
        <strong>{{ group.region }}</strong
        ><span>{{ group.rows.length }}条</span
        ><span>明细小计：{{ money(group.total) }}</span>
      </summary>
      <div class="region-table-scroll">
        <table :aria-label="group.region + '商务报销明细'">
          <thead>
            <tr>
              <th
                v-for="column in visibleColumns"
                :key="column.key"
                scope="col"
              >
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in pageRows(group)"
              :key="row.id + ':' + index"
            >
              <td
                v-for="column in visibleColumns"
                :key="column.key"
                :class="{ 'region-amount': column.format === 'amount' }"
              >
                {{ cell(row[column.key], column.format) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="group.rows.length > 50" class="region-pagination">
        <span
          >第{{ currentPage(group.region) }}／{{
            Math.ceil(group.rows.length / 50)
          }}页</span
        ><button
          type="button"
          :disabled="currentPage(group.region) <= 1"
          @click="pages[group.region] = currentPage(group.region) - 1"
        >
          上一页</button
        ><button
          type="button"
          :disabled="
            currentPage(group.region) >= Math.ceil(group.rows.length / 50)
          "
          @click="pages[group.region] = currentPage(group.region) + 1"
        >
          下一页
        </button>
      </div>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import type {
  FinancialAnalysisColumn,
  FinancialAnalysisDetail,
} from "@/types/monthlyFinancialAnalysis";
import {
  addFinancialAmountTexts,
  formatMonthlyFinancialAmount,
} from "@/utils/monthlyFinancialReportPresentation";

const props = defineProps<{
  rows: FinancialAnalysisDetail[];
  columns: FinancialAnalysisColumn[];
}>();
const pages = reactive<Record<string, number>>(Object.create(null));
type RegionGroup = {
  region: string;
  rows: FinancialAnalysisDetail[];
  total: string | null;
};
const visibleColumns = computed(() =>
  props.columns.filter((column) => column.key !== "region"),
);
const groups = computed<RegionGroup[]>(() => {
  const byRegion = new Map<string, RegionGroup>();
  for (const row of props.rows) {
    const region = row.region?.trim() || "行政区未知";
    const group = byRegion.get(region) || { region, rows: [], total: "0" };
    group.rows.push(row);
    const amount = row.amount?.trim();
    group.total =
      group.total !== null && amount && /^[+-]?\d+(?:\.\d+)?$/u.test(amount)
        ? addFinancialAmountTexts(group.total, amount)
        : null;
    byRegion.set(region, group);
  }
  return Array.from(byRegion.values()).sort((a, b) =>
    a.region === "行政区未知"
      ? 1
      : b.region === "行政区未知"
        ? -1
        : a.region.localeCompare(b.region, "zh-CN"),
  );
});
function money(amount: string | null) {
  return amount === null
    ? "未知／未核算"
    : formatMonthlyFinancialAmount(amount);
}
function cell(
  value: string | null | undefined,
  format: FinancialAnalysisColumn["format"],
) {
  return format === "amount" ? money(value ?? null) : value || "—";
}
function currentPage(region: string) {
  return pages[region] || 1;
}
function pageRows(group: RegionGroup) {
  const start = (currentPage(group.region) - 1) * 50;
  return group.rows.slice(start, start + 50);
}
watch(
  () => props.rows,
  () => {
    for (const region of Object.keys(pages)) delete pages[region];
  },
);
</script>

<style scoped>
.region-scope-note,
.region-empty {
  margin: 12px;
  color: #728796;
  font-size: 12px;
  line-height: 1.8;
}
.business-region-group {
  margin: 12px 0;
  border: 1px solid #dce7ed;
  border-radius: 8px;
  overflow: hidden;
}
.business-region-group summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  padding: 12px;
  background: #f2f8f9;
  color: #3b6474;
  cursor: pointer;
  font-size: 12px;
}
.business-region-group summary strong {
  margin-right: auto;
}
.region-table-scroll {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  min-width: 900px;
  width: 100%;
  font-size: 12px;
}
th,
td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid #e5edf1;
  white-space: nowrap;
}
th {
  color: #6b8390;
  font-weight: 600;
  background: #fafcfd;
}
td {
  color: #365568;
}
.region-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.region-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 12px;
  font-size: 12px;
  color: #6b8390;
}
.region-pagination button {
  background: #fff;
  border: 1px solid #c7dae3;
  border-radius: 5px;
  padding: 5px 10px;
  color: #287483;
  cursor: pointer;
}
.region-pagination button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
