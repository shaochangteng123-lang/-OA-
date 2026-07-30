<template>
  <section
    class="reimbursement-breakdown"
    aria-labelledby="reimbursement-title"
  >
    <header class="breakdown-header">
      <div>
        <span class="section-kicker">费用结构</span>
        <h2 id="reimbursement-title">报销费用构成与明细</h2>
        <p>
          按基础报销、大额报销、商务报销拆分，并展示已采集的区域和服务单位。
        </p>
      </div>
      <div class="period-summary">
        <span>{{ periodLabel }}</span>
        <strong>{{ formatMoney(summary.totalAmount) }}</strong>
        <small>{{ summary.totalCount }}笔有效报销</small>
      </div>
    </header>

    <template v-if="summary.available">
      <div class="type-grid">
        <article
          v-for="item in normalizedTypes"
          :key="item.key"
          class="type-card"
          :class="`type-${item.key}`"
        >
          <div class="type-card-heading">
            <span class="type-icon">{{ getTypeShortName(item.key) }}</span>
            <span>{{ item.count }}笔</span>
          </div>
          <strong>{{ item.name }}</strong>
          <b>{{ formatMoney(item.amount) }}</b>
          <div class="share-track" aria-hidden="true">
            <i :style="{ width: `${getShare(item.amount)}%` }"></i>
          </div>
          <small>占报销总额 {{ formatPercent(getShare(item.amount)) }}</small>
        </article>
      </div>

      <div class="distribution-grid">
        <article class="distribution-panel">
          <div class="panel-heading">
            <div>
              <span>区域维度</span>
              <h3>行政区 / 报销范围</h3>
            </div>
            <small>来源于报销范围配置</small>
          </div>
          <div v-if="summary.byDistrict.length" class="amount-ranking">
            <div
              v-for="item in summary.byDistrict"
              :key="item.name"
              class="ranking-row"
            >
              <span :title="item.name">{{ item.name }}</span>
              <div class="ranking-track">
                <i
                  :style="{
                    width: `${getRankingWidth(item.amount, districtMaximum)}%`,
                  }"
                ></i>
              </div>
              <strong>{{ formatMoney(item.amount) }}</strong>
              <small>{{ item.count }}笔</small>
            </div>
          </div>
          <div v-else class="inline-empty">
            当前周期的大额、商务报销暂无区域数据
          </div>
        </article>

        <article class="distribution-panel service-panel">
          <div class="panel-heading">
            <div>
              <span>服务维度</span>
              <h3>服务单位 / 对象</h3>
            </div>
            <small>来源于商务报销</small>
          </div>
          <div v-if="summary.byServiceUnit.length" class="amount-ranking">
            <div
              v-for="item in summary.byServiceUnit"
              :key="item.name"
              class="ranking-row"
            >
              <span :title="item.name">{{ item.name }}</span>
              <div class="ranking-track">
                <i
                  :style="{
                    width: `${getRankingWidth(item.amount, serviceMaximum)}%`,
                  }"
                ></i>
              </div>
              <strong>{{ formatMoney(item.amount) }}</strong>
              <small>{{ item.count }}笔</small>
            </div>
          </div>
          <div v-else class="inline-empty">当前周期暂无商务服务单位数据</div>
        </article>
      </div>

      <article class="detail-panel">
        <div class="panel-heading detail-heading">
          <div>
            <span>费用明细</span>
            <h3>最近报销记录</h3>
          </div>
          <small>最多展示当前周期最近12笔</small>
        </div>

        <div v-if="summary.recentItems.length" class="detail-list">
          <div
            v-for="item in summary.recentItems"
            :key="item.id"
            class="detail-row"
          >
            <div class="detail-main">
              <span class="type-pill" :class="`type-${item.type}`">
                {{ getTypeName(item.type) }}
              </span>
              <div>
                <strong :title="item.title">{{ item.title }}</strong>
                <small
                  >{{ item.applicantName }} ·
                  {{ formatMonth(item.reimbursementMonth) }}</small
                >
              </div>
            </div>
            <div class="detail-dimension">
              <span>行政区 / 范围</span>
              <strong>{{ getDistrictLabel(item) }}</strong>
            </div>
            <div class="detail-dimension">
              <span>服务单位</span>
              <strong>{{ getServiceUnitLabel(item) }}</strong>
            </div>
            <div class="detail-amount">
              <strong>{{ formatMoney(item.amount) }}</strong>
              <small>{{ getStatusName(item.status) }}</small>
            </div>
          </div>
        </div>
        <div v-else class="inline-empty">当前周期暂无报销明细</div>
      </article>
    </template>

    <div v-else class="panel-empty">
      <span class="empty-icon">¥</span>
      <strong>当前周期暂无报销数据</strong>
      <small>{{ summary.reason || "业务数据录入后将自动展示" }}</small>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type {
  BossReimbursementDetailItem,
  BossReimbursementSummary,
  BossReimbursementType,
} from "@/utils/bossDashboardApi";

const props = defineProps<{
  summary: BossReimbursementSummary;
  periodLabel: string;
}>();

const typeDefinitions: Array<{
  key: BossReimbursementType;
  name: string;
}> = [
  { key: "basic", name: "基础报销" },
  { key: "large", name: "大额报销" },
  { key: "business", name: "商务报销" },
];

const normalizedTypes = computed(() =>
  typeDefinitions.map((definition) => {
    const source = props.summary.byType.find(
      (item) => item.key === definition.key,
    );
    return {
      ...definition,
      count: source?.count || 0,
      amount: source?.amount || 0,
    };
  }),
);

const districtMaximum = computed(() =>
  Math.max(...props.summary.byDistrict.map((item) => item.amount), 1),
);

const serviceMaximum = computed(() =>
  Math.max(...props.summary.byServiceUnit.map((item) => item.amount), 1),
);

function formatMoney(value: number) {
  return `¥${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0)}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function getShare(value: number) {
  if (!props.summary.totalAmount) {
    return 0;
  }
  return Number(((value / props.summary.totalAmount) * 100).toFixed(2));
}

function getRankingWidth(value: number, maximum: number) {
  if (value <= 0) {
    return 0;
  }
  return Math.max((value / maximum) * 100, 5);
}

function getTypeName(type: BossReimbursementType) {
  return typeDefinitions.find((item) => item.key === type)?.name || type;
}

function getTypeShortName(type: BossReimbursementType) {
  const labels: Record<BossReimbursementType, string> = {
    basic: "基",
    large: "额",
    business: "商",
  };
  return labels[type];
}

function getDistrictLabel(item: BossReimbursementDetailItem) {
  if (item.type === "basic" && !item.districtName) {
    return "基础报销未采集";
  }
  if (
    item.districtName &&
    item.scopeName &&
    item.districtName !== item.scopeName
  ) {
    return `${item.districtName} · ${item.scopeName}`;
  }
  return item.districtName || item.scopeName || "未填写";
}

function getServiceUnitLabel(item: BossReimbursementDetailItem) {
  if (item.serviceUnit) {
    return item.serviceUnit;
  }
  return item.type === "business" ? "未填写" : "该类型未采集";
}

function getStatusName(status: string) {
  const labels: Record<string, string> = {
    pending: "审批中",
    pending_first: "一级审批",
    pending_second: "二级审批",
    pending_final: "终审中",
    approved: "已审批",
    paid: "已付款",
    payment_uploaded: "回单已上传",
    completed: "已完成",
  };
  return labels[status] || status;
}

function formatMonth(value: string) {
  const match = value.match(/^(\d{4})-(\d{1,2})$/);
  return match ? `${match[1]}年${Number(match[2])}月` : value;
}
</script>

<style scoped>
.reimbursement-breakdown {
  margin-top: 18px;
  padding: 24px;
  border: 1px solid rgb(219 228 236 / 92%);
  border-radius: 20px;
  background:
    radial-gradient(circle at 100% 0%, rgb(37 163 157 / 7%), transparent 27%),
    linear-gradient(150deg, #ffffff, #f9fbfc);
  box-shadow:
    0 14px 36px rgb(27 48 70 / 7%),
    inset 0 1px 0 #ffffff;
}

.breakdown-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
}

.section-kicker,
.panel-heading span {
  color: #3d719e;
  font-size: 10px;
  font-weight: 720;
  letter-spacing: 0.15em;
}

.breakdown-header h2 {
  margin: 5px 0 0;
  color: #1d3248;
  font-size: 20px;
  letter-spacing: -0.025em;
}

.breakdown-header p {
  margin: 7px 0 0;
  color: #8895a3;
  font-size: 11px;
}

.period-summary {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: auto auto;
  align-items: baseline;
  gap: 2px 14px;
  text-align: right;
}

.period-summary span {
  grid-column: 1 / -1;
  color: #8c98a4;
  font-size: 10px;
}

.period-summary strong {
  color: #173c59;
  font-size: 23px;
  font-weight: 760;
  letter-spacing: -0.04em;
}

.period-summary small {
  color: #7d8995;
  font-size: 10px;
}

.type-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 22px;
}

.type-card {
  --type-color: #3d78b6;
  --type-soft: #eaf2fa;
  min-width: 0;
  padding: 17px;
  border: 1px solid color-mix(in srgb, var(--type-color) 14%, #e4eaf0);
  border-radius: 15px;
  background:
    radial-gradient(
      circle at 96% 4%,
      color-mix(in srgb, var(--type-soft) 85%, transparent),
      transparent 45%
    ),
    #ffffff;
}

.type-card.type-large {
  --type-color: #b97731;
  --type-soft: #fcf2e7;
}

.type-card.type-business {
  --type-color: #168f92;
  --type-soft: #e6f5f4;
}

.type-card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #8995a2;
  font-size: 10px;
}

.type-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: var(--type-soft);
  color: var(--type-color);
  font-size: 12px;
  font-weight: 750;
}

.type-card > strong {
  display: block;
  margin-top: 14px;
  color: #536272;
  font-size: 12px;
}

.type-card > b {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: #1c344a;
  font-size: clamp(17px, 1.7vw, 22px);
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.035em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-track,
.ranking-track {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #edf2f5;
}

.share-track {
  margin-top: 13px;
}

.share-track i,
.ranking-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--type-color) 72%, #ffffff),
    var(--type-color)
  );
}

.type-card > small {
  display: block;
  margin-top: 7px;
  color: #929da8;
  font-size: 9px;
}

.distribution-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 13px;
  margin-top: 14px;
}

.distribution-panel,
.detail-panel {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e4eaf0;
  border-radius: 15px;
  background: rgb(255 255 255 / 82%);
}

.panel-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.panel-heading h3 {
  margin: 3px 0 0;
  color: #31485e;
  font-size: 14px;
}

.panel-heading > small {
  color: #99a3ae;
  font-size: 9px;
}

.amount-ranking {
  display: flex;
  max-height: 176px;
  flex-direction: column;
  gap: 11px;
  overflow-y: auto;
  margin-top: 15px;
  padding-right: 3px;
}

.ranking-row {
  display: grid;
  grid-template-columns: 88px minmax(48px, 1fr) 104px 32px;
  align-items: center;
  gap: 9px;
  font-size: 10px;
}

.ranking-row > span {
  overflow: hidden;
  color: #516171;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ranking-row strong {
  color: #344d64;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.ranking-row small {
  color: #9aa4af;
  font-size: 9px;
  text-align: right;
}

.service-panel .ranking-track i {
  background: linear-gradient(90deg, #72c3bb, #168f92);
}

.detail-panel {
  margin-top: 14px;
}

.detail-list {
  display: flex;
  max-height: 386px;
  flex-direction: column;
  overflow-y: auto;
  margin-top: 12px;
}

.detail-row {
  display: grid;
  grid-template-columns:
    minmax(190px, 1.5fr) minmax(130px, 1fr) minmax(130px, 1fr)
    100px;
  align-items: center;
  gap: 14px;
  padding: 12px 4px;
  border-bottom: 1px solid #edf1f4;
}

.detail-row:last-child {
  border-bottom: 0;
}

.detail-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.type-pill {
  flex-shrink: 0;
  padding: 3px 7px;
  border-radius: 6px;
  background: #eaf2fa;
  color: #3d78b6;
  font-size: 9px;
  font-weight: 650;
}

.type-pill.type-large {
  background: #fcf2e7;
  color: #b97731;
}

.type-pill.type-business {
  background: #e6f5f4;
  color: #168f92;
}

.detail-main > div,
.detail-dimension,
.detail-amount {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.detail-main strong,
.detail-dimension strong {
  overflow: hidden;
  color: #354b60;
  font-size: 11px;
  font-weight: 630;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-main small,
.detail-dimension span,
.detail-amount small {
  margin-top: 3px;
  color: #99a3ad;
  font-size: 9px;
}

.detail-dimension span {
  margin-top: 0;
  margin-bottom: 3px;
}

.detail-amount {
  align-items: flex-end;
}

.detail-amount strong {
  color: #1f425f;
  font-size: 12px;
}

.inline-empty {
  display: flex;
  min-height: 86px;
  align-items: center;
  justify-content: center;
  margin-top: 12px;
  border: 1px dashed #dfe5ea;
  border-radius: 10px;
  color: #99a4ae;
  font-size: 10px;
}

.panel-empty {
  display: flex;
  min-height: 210px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #91a0ad;
}

.empty-icon {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: #edf4f8;
  color: #3d719e;
  font-size: 19px;
}

.panel-empty strong {
  margin-top: 12px;
  color: #526476;
  font-size: 13px;
}

.panel-empty small {
  margin-top: 5px;
  font-size: 10px;
}

@media (max-width: 900px) {
  .type-grid,
  .distribution-grid {
    grid-template-columns: 1fr;
  }

  .detail-row {
    grid-template-columns: minmax(0, 1fr) 100px;
  }

  .detail-dimension {
    display: none;
  }
}

@media (max-width: 620px) {
  .reimbursement-breakdown {
    padding: 18px;
  }

  .breakdown-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .period-summary {
    width: 100%;
    justify-content: start;
    text-align: left;
  }

  .ranking-row {
    gap: 6px;
    grid-template-columns: 72px minmax(30px, 1fr) 100px 28px;
  }
}
</style>
