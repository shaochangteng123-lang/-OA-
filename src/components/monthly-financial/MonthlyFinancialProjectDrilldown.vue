<template>
  <section
    class="project-drilldown"
    :data-mode="mode"
    :data-metric="amountKey"
    :aria-label="title"
  >
    <header class="project-drilldown-heading">
      <div>
        <h4>{{ title }}</h4>
        <p class="project-drilldown-scope">{{ scopeLabel }}</p>
      </div>
      <div class="project-drilldown-total">
        <span class="project-drilldown-total-label">{{
          isPeriodMode ? periodLabel : "期末累计已回款"
        }}</span
        ><strong class="project-drilldown-total-amount">{{
          formatDrilldownAmount(total)
        }}</strong>
      </div>
    </header>
    <p class="project-drilldown-note">
      <template v-if="isPeriodMode"
        >仅显示所选期间回款金额大于0的项目；合同金额、已回款和未回款为所列项目的同期期末值。</template
      >
      {{
        note ||
        (isPeriodMode
          ? "按行政区查看项目所选期间实际回款；未知金额不按零处理，不使用累计值推算。"
          : "按行政区查看项目期末累计回款；未知金额不按零处理，不跨期间累加。")
      }}
    </p>
    <p v-if="deduplicated" class="project-drilldown-warning" role="status">
      同一来源编号的重复项目已去重；如金额或行政区冲突，冲突字段保持未知。
    </p>
    <p
      v-if="periodExclusions"
      class="project-drilldown-warning project-period-exclusions"
      role="status"
    >
      {{ periodExclusions }}顶部总额保留原始期间金额，不由可见项目重新计算。
    </p>
    <p v-if="!regions.length" class="project-drilldown-empty" role="status">
      {{
        isPeriodMode
          ? "该统计期间暂无可展示的正向回款项目，不使用累计回款或其他期间记录代替。"
          : "该截止期间没有可展示的项目明细，不使用其他期间记录代替。"
      }}
    </p>
    <details
      v-for="region in regions"
      :key="mode + ':' + scopeLabel + ':' + region.region"
      class="project-region"
      :data-region="region.region"
      open
    >
      <summary>
        <span class="project-region-name"
          >{{ region.region
          }}<small>{{ region.rows.length }} 个项目</small></span
        >
        <span
          class="project-region-received"
          :class="{ 'project-region-period-received': isPeriodMode }"
          ><span>{{ isPeriodMode ? periodLabel + "小计" : "已回款小计" }}</span
          ><strong>{{ formatDrilldownAmount(region[amountKey]) }}</strong></span
        >
      </summary>
      <div class="project-region-subtotals">
        <span
          >合同金额小计
          <strong data-subtotal="contract">{{
            formatDrilldownAmount(region.contract)
          }}</strong></span
        >
        <span v-if="isPeriodMode"
          >已回款小计
          <strong data-subtotal="received">{{
            formatDrilldownAmount(region.received)
          }}</strong></span
        >
        <span
          >未回款小计
          <strong data-subtotal="outstanding">{{
            formatDrilldownAmount(region.outstanding)
          }}</strong></span
        >
      </div>
      <ul class="project-detail-list">
        <li
          v-for="row in region.rows"
          :key="row.sourceId || row.id"
          class="project-detail"
          :data-source-id="row.sourceId || row.id"
        >
          <div class="project-detail-layout">
            <div class="project-detail-information">
              <div class="project-detail-heading">
                <strong class="project-name">{{
                  row.project || "未记录项目名称"
                }}</strong
                ><span class="project-party-a"
                  >甲方：{{ row.partyA || "未记录甲方" }}</span
                >
              </div>
              <dl
                class="project-amounts"
                :class="{ 'is-period-mode': isPeriodMode }"
              >
                <div
                  v-if="isPeriodMode"
                  class="project-period-received is-highlight"
                  data-metric="periodReceived"
                >
                  <dt>{{ periodLabel }} · 项目小计</dt>
                  <dd>{{ formatDrilldownAmount(row.periodReceived) }}</dd>
                </div>
                <div
                  v-else
                  class="project-received is-highlight"
                  data-metric="received"
                >
                  <dt>已回款 · 项目小计</dt>
                  <dd>{{ formatDrilldownAmount(row.received) }}</dd>
                </div>
                <div class="project-contract" data-metric="contract">
                  <dt>合同金额</dt>
                  <dd>{{ formatDrilldownAmount(row.contract) }}</dd>
                </div>
                <div
                  v-if="isPeriodMode"
                  class="project-received"
                  data-metric="received"
                >
                  <dt>已回款</dt>
                  <dd>{{ formatDrilldownAmount(row.received) }}</dd>
                </div>
                <div class="project-outstanding" data-metric="outstanding">
                  <dt>未回款</dt>
                  <dd>{{ formatDrilldownAmount(row.outstanding) }}</dd>
                </div>
              </dl>
              <div class="project-detail-footer">
                <div class="project-identifiers">
                  <p v-if="isPeriodMode" class="project-number">
                    项目编号：{{ projectNumberFor(row) }}
                  </p>
                  <p v-else class="project-contract-number">
                    合同编号：{{ projectNumberFor(row) }}
                  </p>
                  <p v-if="isPeriodMode" class="project-bank-receipt-numbers">
                    银行回单号：{{ bankReceiptNumbersFor(row) }}
                  </p>
                  <p
                    v-if="isPeriodMode && transactionSerialsFor(row)"
                    class="project-bank-transaction-serials"
                  >
                    银行流水号：{{ transactionSerialsFor(row) }}
                  </p>
                </div>
                <button
                  v-if="isPeriodMode"
                  type="button"
                  class="project-bank-receipt-link project-receipt-trigger"
                  :aria-label="`${row.project || '项目'}：银行回单预览`"
                  @click="openReceiptPreview(row, $event)"
                >
                  银行回单预览
                </button>
              </div>
            </div>
          </div>
          <p class="project-source-state">
            {{
              isPeriodMode
                ? row.periodReceivedSourceState || "未记录本期回款来源说明"
                : row.sourceState || "未记录来源状态"
            }}
          </p>
        </li>
      </ul>
    </details>
    <MonthlyFinancialProjectReceiptDialog
      v-if="selectedPreviewRow"
      :visible="true"
      :receipts="receiptEvidenceFor(selectedPreviewRow)"
      :root-contract-id="receiptScopeFor(selectedPreviewRow).rootContractId"
      :period-key="receiptScopeFor(selectedPreviewRow).periodKey"
      :from="receiptScopeFor(selectedPreviewRow).from"
      :to="receiptScopeFor(selectedPreviewRow).to"
      :project-name="selectedPreviewRow.project || '项目'"
      :append-to="dialogAppendTo"
      :return-focus="receiptReturnFocus"
      @close="closeReceiptPreview"
      @visibility-change="emit('receipt-dialog-change', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type {
  FinancialAnalysisDetail,
  FinancialAnalysisProjectReceipt,
} from "@/types/monthlyFinancialAnalysis";
import {
  scopedProjectReceiptEvidence,
  type ProjectReceiptScope,
} from "@/components/monthly-financial/MonthlyFinancialProjectReceiptPreview.vue";
import MonthlyFinancialProjectReceiptDialog from "@/components/monthly-financial/MonthlyFinancialProjectReceiptDialog.vue";
import {
  formatDrilldownAmount,
  groupProjectDrilldownRows,
  knownDrilldownAmount,
  uniqueProjectDrilldownRows,
} from "@/utils/monthlyFinancialAnalysisDrilldown";

const props = withDefaults(
  defineProps<{
    rows: FinancialAnalysisDetail[];
    title: string;
    scopeLabel: string;
    total: string | null;
    note?: string;
    mode?: "cumulative" | "period";
    periodLabel?: string;
    receipts?: FinancialAnalysisProjectReceipt[];
    active?: boolean;
    dialogAppendTo?: HTMLElement | null;
  }>(),
  {
    note: "",
    mode: "cumulative",
    periodLabel: "本期回款",
    receipts: () => [],
    active: true,
    dialogAppendTo: null,
  },
);
const emit = defineEmits<{ "receipt-dialog-change": [open: boolean] }>();
const isPeriodMode = computed(() => props.mode === "period");
const amountKey = computed(() =>
  isPeriodMode.value ? "periodReceived" : "received",
);
const applicableRows = computed(() =>
  isPeriodMode.value
    ? props.rows
    : props.rows.filter((row) => row.detailKind !== "period_receipt_only"),
);
const uniqueRows = computed(() =>
  uniqueProjectDrilldownRows(applicableRows.value),
);
// 先核对重复来源再筛选，以免移除零行或未知行后将冲突项目误当成有效回款。
const visibleRows = computed(() =>
  isPeriodMode.value
    ? uniqueRows.value.filter((row) => {
        const amount = knownDrilldownAmount(row.periodReceived);
        return (
          amount !== null && !amount.startsWith("-") && /[1-9]/u.test(amount)
        );
      })
    : uniqueRows.value,
);
const periodExclusions = computed(() => {
  if (!isPeriodMode.value) return "";
  const amounts = uniqueRows.value.map((row) =>
    knownDrilldownAmount(row.periodReceived),
  );
  const messages = [];
  if (amounts.some((amount) => amount === null))
    messages.push(
      "部分项目本期金额未知或待核对，未列入正向回款清单，不按零处理。",
    );
  if (
    amounts.some((amount) => amount?.startsWith("-") && /[1-9]/u.test(amount))
  )
    messages.push("存在负向金额，未列入正向回款项目清单。");
  return messages.join("");
});
const regions = computed(() => groupProjectDrilldownRows(visibleRows.value));
const deduplicated = computed(
  () => uniqueRows.value.length < applicableRows.value.length,
);
const receiptPreviewKey = ref("");
const receiptReturnFocus = shallowRef<HTMLElement | null>(null);
const selectedPreviewRow = computed(() =>
  props.active && isPeriodMode.value && receiptPreviewKey.value
    ? visibleRows.value.find(
        (row) => receiptScopeKey(row) === receiptPreviewKey.value,
      ) || null
    : null,
);
function openReceiptPreview(row: FinancialAnalysisDetail, event: Event) {
  if (!props.active || !isPeriodMode.value) return;
  receiptReturnFocus.value =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  receiptPreviewKey.value = receiptScopeKey(row);
}
function closeReceiptPreview() {
  receiptPreviewKey.value = "";
}
watch(
  [
    () => props.active,
    () => props.mode,
    () => props.scopeLabel,
    selectedPreviewRow,
  ],
  ([active, mode, label, row], previous) => {
    if (!receiptPreviewKey.value) return;
    if (
      !active ||
      mode !== "period" ||
      !row ||
      (previous.length && label !== previous[2])
    )
      closeReceiptPreview();
  },
);
onBeforeUnmount(() => emit("receipt-dialog-change", false));
function receiptScopeFor(row: FinancialAnalysisDetail): ProjectReceiptScope {
  return {
    rootContractId: row.sourceId?.trim() || "",
    periodKey: row.periodKey || "",
    from: row.from || row.periodFrom || "",
    to: row.to || row.periodTo || "",
  };
}
function receiptScopeKey(row: FinancialAnalysisDetail) {
  const scope = receiptScopeFor(row);
  return JSON.stringify([
    scope.rootContractId,
    scope.periodKey,
    scope.from,
    scope.to,
  ]);
}
function receiptEvidenceFor(row: FinancialAnalysisDetail) {
  return scopedProjectReceiptEvidence(props.receipts, receiptScopeFor(row));
}
function projectNumberFor(row: FinancialAnalysisDetail) {
  const scope = receiptScopeKey(row);
  const numbers = new Set(
    props.rows
      .filter((candidate) => receiptScopeKey(candidate) === scope)
      .map((candidate) => candidate.projectNumber?.trim() || ""),
  );
  return numbers.size === 1 ? Array.from(numbers)[0] || "未提供" : "未提供";
}
function bankReceiptNumbersFor(row: FinancialAnalysisDetail) {
  const numbers = receiptEvidenceFor(row).map(
    (receipt) => receipt.receiptNumber?.trim() || "未提供",
  );
  return Array.from(new Set(numbers)).join("、") || "未提供";
}
function transactionSerialsFor(row: FinancialAnalysisDetail) {
  return Array.from(
    new Set(
      receiptEvidenceFor(row).flatMap((receipt) =>
        receipt.transactionSerialNo?.trim()
          ? [receipt.transactionSerialNo.trim()]
          : [],
      ),
    ),
  ).join("、");
}
</script>

<style scoped>
.project-drilldown {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e0e8ed;
  border-radius: 10px;
  background: #fff;
  color: #355565;
}
.project-drilldown-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.project-drilldown-heading > div {
  min-width: 0;
}
h4 {
  margin: 0;
  color: #284b60;
  font-size: 15px;
  line-height: 1.5;
}
.project-drilldown-scope,
.project-drilldown-note {
  margin: 5px 0 0;
  color: #80939f;
  font-size: 11px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.project-drilldown-total {
  display: grid;
  gap: 4px;
  max-width: 100%;
  text-align: right;
}
.project-drilldown-total > span {
  font-size: 11px;
  color: #7a8e9c;
}
.project-drilldown-total-amount {
  color: #187f88;
  font-size: 17px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.project-drilldown-note {
  margin-top: 12px;
}
.project-drilldown-warning {
  margin: 12px 0;
  padding: 9px 11px;
  background: #fffaef;
  border: 1px solid #eadfc7;
  border-radius: 6px;
  color: #967333;
  font-size: 11px;
  line-height: 1.7;
}
.project-drilldown-empty {
  padding: 24px 10px;
  color: #8a9ca7;
  font-size: 12px;
  text-align: center;
}
.project-region {
  margin-top: 14px;
  border: 1px solid #e0eaed;
  border-radius: 9px;
  min-width: 0;
  overflow: hidden;
}
.project-region summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 18px;
  padding: 13px 15px;
  background: #f2f8fa;
  cursor: pointer;
  list-style: none;
}
.project-region summary::-webkit-details-marker {
  display: none;
}
.project-region-name {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.project-region-name::before {
  content: "▸";
  color: #6a929b;
}
.project-region[open] .project-region-name::before {
  content: "▾";
}
.project-region-name small {
  color: #8198a4;
  font-size: 10px;
  font-weight: 400;
}
.project-region-received {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px 10px;
  font-size: 11px;
}
.project-region-received strong {
  color: #187f88;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.project-region-subtotals {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 24px;
  padding: 10px 15px;
  border-bottom: 1px solid #eaf0f3;
  font-size: 11px;
  color: #8194a0;
}
.project-region-subtotals strong {
  color: #5c788a;
  font-weight: 500;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.project-detail-list {
  list-style: none;
  padding: 0 15px;
  margin: 0;
}
.project-detail {
  padding: 16px 0;
  min-width: 0;
}
.project-detail + .project-detail {
  border-top: 1px solid #edf1f4;
}
.project-detail-layout {
  min-width: 0;
}
.project-detail-information {
  min-width: 0;
}
.project-detail-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 5px 16px;
}
.project-name {
  color: #365b6f;
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.project-party-a {
  color: #80939f;
  font-size: 11px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.project-amounts {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  margin: 11px 0;
}
.project-amounts > div {
  min-width: 0;
  padding: 9px 11px;
  border-radius: 6px;
  background: #f7f9fa;
}
.project-amounts dt {
  font-size: 10px;
  line-height: 1.6;
  color: #899ba5;
}
.project-amounts dd {
  margin: 4px 0 0;
  color: #456979;
  font-size: 12px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.project-amounts .is-highlight {
  background: #edf8f7;
  border: 1px solid #d2e8e6;
}
.project-amounts .is-highlight dd {
  color: #187f88;
  font-size: 14px;
  font-weight: 650;
}
.project-amounts.is-period-mode {
  grid-template-columns: minmax(0, 1.25fr) repeat(3, minmax(0, 1fr));
}
.project-detail-footer {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.project-identifiers {
  min-width: 0;
  flex: 1;
}
.project-bank-receipt-link {
  flex: none;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: #187f88;
  font: inherit;
  font-size: 12px;
  line-height: 1.7;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.project-bank-receipt-link:hover {
  color: #0f5f68;
}
.project-bank-receipt-link:focus-visible {
  outline: 2px solid #398e99;
  outline-offset: 3px;
  border-radius: 2px;
}
.project-contract-number,
.project-number,
.project-bank-receipt-numbers,
.project-bank-transaction-serials,
.project-source-state {
  margin: 4px 0 0;
  color: #8c9da7;
  font-size: 10px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .project-drilldown {
    padding: 13px;
  }
  .project-drilldown-total {
    text-align: left;
  }
  .project-amounts,
  .project-amounts.is-period-mode {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .project-amounts:not(.is-period-mode) .project-received {
    grid-column: 1 / -1;
  }
  .project-region summary {
    padding: 12px;
  }
  .project-region-subtotals {
    padding: 10px 12px;
  }
  .project-detail-list {
    padding-inline: 12px;
  }
}
</style>
