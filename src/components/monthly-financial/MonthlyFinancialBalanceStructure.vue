<template>
  <section class="balance-structure" data-chart-type="donut" :aria-label="title">
    <header class="balance-structure-heading">
      <h4>{{ title }}</h4>
      <p class="balance-structure-scope">{{ scopeLabel }}</p>
    </header>

    <p
      v-if="!completeShare && hasPositiveAmount"
      class="balance-structure-warning"
      role="status"
    >
      仅已知正金额占比；负数、未知金额不参与计算，不代表净额或完整总额。
      <span v-if="totalMismatch"
        >传入总金额与四账户明细合计不一致，请核对来源。</span
      >
    </p>

    <div class="balance-structure-content">
      <div class="balance-ring-zone">
        <svg
          class="balance-ring"
          :class="{ 'is-neutral': !slices.length }"
          viewBox="0 0 240 240"
          role="img"
          :aria-label="ringDescription"
        >
          <circle
            class="balance-ring-track"
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
            class="balance-ring-slice"
            :data-account="slice.key"
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
              {{ slice.label }}：{{ slice.amountText }}，占比
              {{ slice.percentage }}
            </title>
          </circle>
        </svg>
        <div
          class="balance-ring-center"
          :aria-label="totalLabel + '：' + totalText"
        >
          <span class="balance-total-label">{{ totalLabel }}</span>
          <strong
            class="balance-total-amount"
            :class="{ 'is-unknown': normalizedTotal === null }"
            >{{ totalText }}</strong
          >
          <small v-if="!completeShare && hasPositiveAmount"
            >占比仅含已知正金额</small
          >
        </div>
      </div>

      <div class="balance-account-list">
        <div class="balance-account-heading" aria-hidden="true">
          <span>账户</span><span>金额</span><span>占比</span>
        </div>
        <ul aria-label="四账户金额与占比">
          <li
            v-for="account in accounts"
            :key="account.key"
            :data-account="account.key"
            :aria-label="
              account.label +
              '，' +
              account.amountText +
              '，占比' +
              account.percentage
            "
          >
            <span class="balance-account-name"
              ><i :style="{ background: account.color }" aria-hidden="true"></i
              >{{ account.label }}</span
            >
            <strong
              class="balance-account-amount"
              :class="{
                'is-negative': account.negative,
                'is-unknown': account.normalized === null,
              }"
              >{{ account.amountText }}</strong
            >
            <span class="balance-account-percentage">{{
              account.percentage
            }}</span>
          </li>
        </ul>
      </div>
    </div>

    <p v-if="emptyReason" class="balance-structure-empty" role="status">
      {{ emptyReason }}
    </p>
    <p v-if="note" class="balance-structure-note">{{ note }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  addFinancialAmountTexts,
  formatMonthlyFinancialAmount,
} from "@/utils/monthlyFinancialReportPresentation";
import type { FinancialAnalysisValue } from "@/types/monthlyFinancialAnalysis";

const props = withDefaults(
  defineProps<{
    items: FinancialAnalysisValue[];
    title: string;
    scopeLabel: string;
    note?: string;
    total: string | null;
    totalLabel?: string;
  }>(),
  { note: "", totalLabel: "总金额" },
);

const defaults = [
  { key: "general", label: "一般账户", color: "#20848a" },
  { key: "business", label: "商务账户", color: "#637bc1" },
  { key: "welfare_one", label: "福利金账户一", color: "#c59243" },
  { key: "welfare_two", label: "福利金账户二", color: "#a277aa" },
];
const circumference = 2 * Math.PI * 88;

function normalizeAmount(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !/^[+-]?\d+(?:\.\d+)?$/u.test(value.trim()))
    return null;
  return addFinancialAmountTexts(value.trim(), "0");
}
function amountText(
  raw: string | null | undefined,
  normalized: string | null,
): string {
  if (normalized === null) return "未知";
  return formatMonthlyFinancialAmount(normalized === "0" ? "0" : raw);
}
const rawAccounts = computed(() =>
  defaults.map((fallback, index) => {
    const source = props.items[index];
    const normalized = normalizeAmount(source?.amount);
    return {
      key: source?.key || fallback.key,
      label: source?.label || fallback.label,
      color: fallback.color,
      normalized,
      negative: normalized !== null && normalized.startsWith("-"),
      positive:
        normalized !== null &&
        normalized !== "0" &&
        !normalized.startsWith("-"),
      amountText: amountText(source?.amount, normalized),
    };
  }),
);
const normalizedTotal = computed(() => normalizeAmount(props.total));
const totalText = computed(() =>
  amountText(props.total, normalizedTotal.value),
);
const allAccountAmountsKnown = computed(
  () =>
    props.items.length === 4 &&
    rawAccounts.value.every((account) => account.normalized !== null),
);
const exactAccountTotal = computed(() =>
  allAccountAmountsKnown.value
    ? rawAccounts.value.reduce(
        (sum, account) => addFinancialAmountTexts(sum, account.normalized!),
        "0",
      )
    : null,
);
const exactPositiveTotal = computed(() =>
  rawAccounts.value.reduce(
    (sum, account) =>
      account.positive
        ? addFinancialAmountTexts(sum, account.normalized!)
        : sum,
    "0",
  ),
);
const totalMismatch = computed(
  () =>
    normalizedTotal.value !== null &&
    exactAccountTotal.value !== null &&
    normalizedTotal.value !== exactAccountTotal.value,
);
const completeShare = computed(
  () =>
    allAccountAmountsKnown.value &&
    !rawAccounts.value.some((account) => account.negative) &&
    normalizedTotal.value !== null &&
    !totalMismatch.value,
);
const denominator = computed(() =>
  completeShare.value ? exactAccountTotal.value! : exactPositiveTotal.value,
);
const hasPositiveAmount = computed(() =>
  rawAccounts.value.some((account) => account.positive),
);

// 账户合计只以十进制字符串计算；浮点数仅用于图形角度及两位小数的占比展示。
function ratioFor(normalized: string | null): number | null {
  if (normalized === null || normalized.startsWith("-")) return null;
  if (normalized === "0") return 0;
  const total = Number(denominator.value);
  const amount = Number(normalized);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(amount))
    return null;
  return amount / total;
}
const accounts = computed(() =>
  rawAccounts.value.map((account) => {
    const ratio = ratioFor(account.normalized);
    return {
      ...account,
      ratio,
      percentage: ratio === null ? "—" : (ratio * 100).toFixed(2) + "%",
    };
  }),
);
const slices = computed(() => {
  let offset = 0;
  return accounts.value.flatMap((account) => {
    if (!account.positive || account.ratio === null || account.ratio <= 0)
      return [];
    const arcLength = account.ratio * circumference;
    const slice = { ...account, arcLength, offset };
    offset += arcLength;
    return [slice];
  });
});
const emptyReason = computed(() => {
  if (slices.value.length) return "";
  if (rawAccounts.value.every((account) => account.normalized === null))
    return "四个账户金额均未知，暂不显示占比。";
  if (rawAccounts.value.every((account) => account.normalized === "0"))
    return "四个账户金额均为零，以中性环展示；各账户为 ¥0.00、0.00%。";
  if (hasPositiveAmount.value)
    return "金额超出图形比例可表示范围；精确金额仍完整保留，占比暂不显示。";
  return "暂无可用于占比的已知正金额；负数和未知金额保留在账户明细中。";
});
const ringDescription = computed(() =>
  [
    props.title,
    props.scopeLabel,
    props.totalLabel + "：" + totalText.value,
    slices.value.length
      ? completeShare.value
        ? "四账户完整金额占比"
        : "仅已知正金额占比，不代表完整总额"
      : "中性空环，暂无可展示占比",
  ]
    .filter(Boolean)
    .join("；"),
);
</script>

<style scoped>
.balance-structure {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e0e8ed;
  border-radius: 10px;
  background: #fff;
  color: #355565;
}
.balance-structure-heading h4 {
  margin: 0;
  color: #284b60;
  font-size: 15px;
  line-height: 1.5;
  font-weight: 650;
}
.balance-structure-scope {
  margin: 5px 0 0;
  color: #80939f;
  font-size: 11px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.balance-structure-content {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px 24px;
  margin-top: 16px;
  min-width: 0;
}
.balance-ring-zone {
  position: relative;
  flex: 0 1 250px;
  width: 250px;
  max-width: 100%;
  margin-inline: auto;
}
.balance-ring {
  display: block;
  width: 100%;
  overflow: visible;
}
.balance-ring-slice {
  outline: none;
}
.balance-ring-slice:focus-visible {
  filter: brightness(0.85);
  stroke-width: 35px;
}
.balance-ring-center {
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
.balance-total-label {
  color: #7a8e9c;
  font-size: 11px;
  line-height: 1.4;
}
.balance-total-amount {
  display: block;
  width: 100%;
  color: #2c5167;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: normal;
}
.balance-ring-center small {
  color: #9b875b;
  font-size: 9px;
  line-height: 1.5;
}
.balance-account-list {
  flex: 1 1 300px;
  min-width: 0;
}
.balance-account-heading,
.balance-account-list li {
  display: grid;
  grid-template-columns: minmax(92px, 0.85fr) minmax(0, 1.35fr) 54px;
  align-items: baseline;
  gap: 8px;
}
.balance-account-heading {
  padding-bottom: 8px;
  color: #91a0aa;
  font-size: 10px;
}
.balance-account-heading > span:not(:first-child) {
  text-align: right;
}
.balance-account-list ul {
  padding: 0;
  margin: 0;
  list-style: none;
}
.balance-account-list li {
  padding: 13px 0;
  border-top: 1px solid #edf1f4;
  font-size: 12px;
  line-height: 1.6;
}
.balance-account-name {
  display: flex;
  align-items: baseline;
  gap: 7px;
  color: #627e8e;
  min-width: 0;
}
.balance-account-name i {
  flex-shrink: 0;
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.balance-account-amount {
  min-width: 0;
  color: #3f6174;
  text-align: right;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.balance-account-percentage {
  color: #6d8493;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}
.balance-account-amount.is-negative {
  color: #ad6759;
}
.balance-account-amount.is-unknown,
.balance-total-amount.is-unknown {
  color: #9aa7af;
  font-weight: 500;
}
.balance-structure-warning {
  margin: 12px 0 0;
  padding: 9px 11px;
  border: 1px solid #eadfc7;
  border-radius: 6px;
  background: #fffaef;
  color: #967333;
  font-size: 11px;
  line-height: 1.7;
}
.balance-structure-empty {
  margin: 14px 0 0;
  color: #8a9ca7;
  font-size: 11px;
  line-height: 1.7;
  text-align: center;
}
.balance-structure-note {
  margin: 13px 0 0;
  color: #8b9da9;
  font-size: 11px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
@media (max-width: 480px) {
  .balance-structure {
    padding: 13px;
  }
  .balance-account-list {
    flex-basis: 100%;
  }
  .balance-account-heading,
  .balance-account-list li {
    grid-template-columns: minmax(85px, 0.95fr) minmax(0, 1.4fr) 49px;
    gap: 6px;
  }
  .balance-total-amount {
    font-size: 14px;
  }
}
</style>
