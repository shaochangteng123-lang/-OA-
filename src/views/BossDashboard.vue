<template>
  <div ref="dashboardRef" class="boss-dashboard">
    <section class="dashboard-hero" aria-labelledby="boss-dashboard-title">
      <div class="hero-glow hero-glow-one" aria-hidden="true"></div>
      <div class="hero-glow hero-glow-two" aria-hidden="true"></div>

      <div class="hero-copy">
        <div class="hero-eyebrow">
          <span class="live-indicator"></span>
          公司经营驾驶舱 · 实时同步
        </div>
        <h1 id="boss-dashboard-title">
          羽隶经营看板
          <small>{{ periodLabel }}</small>
        </h1>
        <div class="hero-meta">
          <span>
            <el-icon><Calendar /></el-icon>
            所选财务周期：{{ periodLabel }}
          </span>
          <span>
            <el-icon><DataAnalysis /></el-icon>
            {{ qualitySummary }}
          </span>
          <span>
            <i class="status-dot"></i>
            {{
              loading && !summary
                ? "正在连接业务数据"
                : refreshing
                  ? "正在同步最新数据"
                  : summary?.generatedAt
                    ? `更新于 ${formatDateTime(summary.generatedAt)} · ${autoRefreshCountdown}秒后自动同步`
                    : "等待数据更新"
            }}
          </span>
        </div>
      </div>

      <aside class="hero-pulse" aria-label="经营脉搏">
        <div class="pulse-heading">
          <span>当前状态摘要</span>
          <small>{{
            isSummaryBusy ? "正在同步" : `${autoRefreshCountdown}秒后更新`
          }}</small>
        </div>
        <div class="pulse-grid">
          <div v-for="item in heroPulseStats" :key="item.label">
            <span>{{ item.label }}</span>
            <strong :class="{ 'is-alert': item.alert }">{{
              item.value
            }}</strong>
            <small>{{ item.note }}</small>
          </div>
        </div>
      </aside>
    </section>

    <section class="control-deck" aria-label="经营周期控制">
      <div class="control-title">
        <span class="control-icon">
          <el-icon><Calendar /></el-icon>
        </span>
        <div>
          <strong>财务统计周期</strong>
          <small>精确选择一个自然月或自然年，财务指标与报销明细同步切换</small>
        </div>
      </div>

      <div class="control-actions">
        <div class="preset-switch" aria-label="选择统计周期类型">
          <button
            v-for="mode in periodModes"
            :key="mode.key"
            type="button"
            :class="{ 'is-active': periodMode === mode.key }"
            @click="setPeriodMode(mode.key)"
          >
            {{ mode.label }}
          </button>
        </div>

        <el-date-picker
          v-if="periodMode === 'month'"
          v-model="selectedMonth"
          class="period-picker"
          type="month"
          value-format="YYYY-MM"
          placeholder="选择月份"
          :clearable="false"
          @change="handlePeriodValueChange"
        />
        <el-date-picker
          v-else
          v-model="selectedYear"
          class="period-picker"
          type="year"
          value-format="YYYY"
          placeholder="选择年份"
          :clearable="false"
          @change="handlePeriodValueChange"
        />

        <el-tooltip content="全屏查看经营看板" placement="top">
          <el-button
            class="icon-action"
            :icon="FullScreen"
            aria-label="全屏查看经营看板"
            @click="toggleFullscreen"
          />
        </el-tooltip>
        <el-button
          class="refresh-action"
          type="primary"
          :icon="Refresh"
          :loading="isSummaryBusy"
          @click="loadSummary"
        >
          刷新数据
        </el-button>
      </div>
    </section>

    <nav class="dashboard-sections" aria-label="经营看板分区">
      <button
        v-for="section in dashboardSections"
        :key="section.key"
        type="button"
        :class="{ 'is-active': activeSection === section.key }"
        :aria-current="activeSection === section.key ? 'page' : undefined"
        @click="activeSection = section.key"
      >
        <span class="section-tab-icon">
          <el-icon><component :is="section.icon" /></el-icon>
        </span>
        <span>
          <strong>{{ section.label }}</strong>
          <small>{{ section.description }}</small>
        </span>
      </button>
    </nav>

    <el-alert
      v-if="loadError"
      class="load-alert"
      type="error"
      :closable="false"
      show-icon
      title="经营数据加载失败"
      :description="loadError"
    >
      <template #default>
        <el-button type="danger" link @click="loadSummary">重新加载</el-button>
      </template>
    </el-alert>

    <section
      v-if="activeSection === 'overview'"
      class="metric-section section-panel"
      aria-labelledby="metric-section-title"
    >
      <div class="section-heading metric-heading">
        <div>
          <span class="section-kicker">经营核心</span>
          <h2 id="metric-section-title">{{ periodLabel }}核心指标</h2>
        </div>
        <p>财务数据按所选周期汇总；右上角人员与项目为当前实时状态。</p>
      </div>

      <div class="metric-grid">
        <article
          v-for="(card, index) in overviewMetricCards"
          :key="card.key"
          class="metric-card"
          :class="[
            `tone-${card.tone}`,
            { 'is-unavailable': !card.available, 'is-clickable': card.route },
          ]"
          :tabindex="card.route ? 0 : undefined"
          @click="goToDetail(card.route)"
          @keydown.enter="goToDetail(card.route)"
        >
          <div class="metric-accent"></div>
          <div class="metric-top">
            <span class="metric-icon">
              <el-icon :size="20"><component :is="card.icon" /></el-icon>
            </span>
            <span class="metric-index">{{
              String(index + 1).padStart(2, "0")
            }}</span>
          </div>
          <div class="metric-label">{{ card.label }}</div>
          <el-skeleton v-if="loading && !summary" animated>
            <template #template>
              <el-skeleton-item class="metric-skeleton" variant="text" />
            </template>
          </el-skeleton>
          <div
            v-else
            class="metric-value"
            :title="
              card.available ? `${card.displayValue}${card.unit}` : card.reason
            "
          >
            {{ card.displayValue }}
            <small v-if="card.available && card.unit">{{ card.unit }}</small>
          </div>
          <div class="metric-footer">
            <span class="metric-state">
              <i :class="card.available ? 'is-ready' : 'is-missing'"></i>
              {{ card.reason }}
            </span>
            <span v-if="card.available" class="metric-period">
              {{ periodLabel }}
            </span>
            <el-icon v-else-if="card.route" :size="14"><ArrowRight /></el-icon>
          </div>
        </article>
      </div>

      <details v-if="additionalMetricCards.length" class="additional-metrics">
        <summary>
          <span>更多已接入经营指标</span>
          <small>{{ additionalMetricCards.length }}项</small>
        </summary>
        <div class="additional-metric-grid">
          <article v-for="card in additionalMetricCards" :key="card.key">
            <span>{{ card.label }}</span>
            <strong>
              {{ card.displayValue }}
              <small v-if="card.available && card.unit">{{ card.unit }}</small>
            </strong>
            <p>{{ card.reason }}</p>
          </article>
        </div>
      </details>
    </section>

    <section
      v-if="activeSection === 'finance'"
      class="section-block section-panel"
    >
      <div class="section-heading">
        <div>
          <span class="section-kicker">财务洞察</span>
          <h2>{{ periodLabel }}财务分析</h2>
        </div>
        <div class="section-note">
          <span class="analysis-badge">
            <i></i>
            所选周期构成分析
          </span>
          <p>点击饼状图扇区，可查看所选周期公司级构成。</p>
        </div>
      </div>

      <div class="payroll-summary-strip" aria-label="所选周期薪资汇总">
        <div v-for="item in selectedPayrollSummary" :key="item.key">
          <span>{{ item.label }}</span>
          <strong
            :title="item.value === null ? '暂无数据' : formatMoney(item.value)"
          >
            {{ item.value === null ? "—" : formatMoney(item.value) }}
          </strong>
          <small>{{ item.note }}</small>
        </div>
      </div>

      <div class="finance-grid">
        <el-card
          v-loading="loading"
          shadow="never"
          class="chart-card chart-wide"
        >
          <BossPieChart
            title="公司已登记成本构成"
            subtitle="所选周期已登记总成本由人力成本与报销费用构成"
            :labels="totalCostPie.labels"
            :series="totalCostPie.series"
            :syncing="isSummaryBusy"
            :refresh-countdown="autoRefreshCountdown"
            unit=""
            empty-text="总成本构成数据待录入"
            @slice-click="openPieInsight('total', $event)"
          />
        </el-card>

        <el-card v-loading="loading" shadow="never" class="chart-card">
          <BossPieChart
            title="人力成本构成"
            subtitle="仅展示计入公司成本的工资总额、单位社保和单位公积金；代扣项目见上方汇总"
            :labels="humanCostPie.labels"
            :series="humanCostPie.series"
            :syncing="isSummaryBusy"
            :refresh-countdown="autoRefreshCountdown"
            unit=""
            empty-text="人力成本构成数据待录入"
            @slice-click="openPieInsight('human', $event)"
          />
        </el-card>

        <el-card v-loading="loading" shadow="never" class="chart-card">
          <BossPieChart
            title="报销费用构成"
            subtitle="所选周期按基础报销、大额报销和商务报销三类统计"
            :labels="reimbursementPie.labels"
            :series="reimbursementPie.series"
            :syncing="isSummaryBusy"
            :refresh-countdown="autoRefreshCountdown"
            unit=""
            empty-text="报销构成数据待接入"
            @slice-click="openPieInsight('reimbursement', $event)"
          />
        </el-card>
      </div>

      <BossReimbursementBreakdown
        v-if="summary?.reimbursements"
        :summary="summary.reimbursements"
        :period-label="periodLabel"
      />
    </section>

    <section
      v-if="activeSection === 'people' || activeSection === 'projects'"
      class="management-grid section-panel"
    >
      <div class="snapshot-banner">
        <el-icon><DataAnalysis /></el-icon>
        <span>
          <strong>当前实时状态</strong>
          人员、日志、项目与风险展示当前业务状态，不受上方财务周期影响。
        </span>
      </div>

      <el-card
        v-if="activeSection === 'people'"
        shadow="never"
        class="management-card people-card"
      >
        <template #header>
          <div class="card-heading">
            <div>
              <span class="section-kicker">人员结构</span>
              <h2>人力概况</h2>
            </div>
            <el-button
              v-if="canOpenBusinessDetails"
              link
              type="primary"
              @click="goToDetail('/employee-data')"
            >
              查看员工数据
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
        </template>

        <div v-if="peopleAvailable" class="management-content">
          <div class="summary-number-grid">
            <div v-for="item in peopleStats" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ formatNullableCount(item.value) }}</strong>
            </div>
          </div>

          <div class="distribution-block">
            <h3>部门人数分布</h3>
            <div v-if="departmentDistribution.length" class="bar-list">
              <div
                v-for="item in departmentDistribution"
                :key="item.name"
                class="bar-row"
              >
                <span class="bar-label" :title="item.name">{{
                  item.name
                }}</span>
                <div class="bar-track">
                  <i
                    :style="{
                      width: `${getDistributionWidth(
                        item.count,
                        departmentMaximum,
                      )}%`,
                    }"
                  ></i>
                </div>
                <strong>{{ item.count }}人</strong>
              </div>
            </div>
            <div v-else class="inline-empty">部门归属数据待补充</div>
          </div>
        </div>

        <div v-else class="panel-empty">
          <el-icon :size="34"><UserFilled /></el-icon>
          <strong>人员数据尚未接入</strong>
          <span>{{ peopleUnavailableReason }}</span>
        </div>
      </el-card>

      <el-card
        v-if="activeSection === 'projects'"
        shadow="never"
        class="management-card project-card"
      >
        <template #header>
          <div class="card-heading">
            <div>
              <span class="section-kicker">项目运营</span>
              <h2>当前项目概况</h2>
            </div>
            <el-button
              v-if="canOpenBusinessDetails"
              link
              type="primary"
              @click="goToDetail('/worklog-projects')"
            >
              查看项目动态
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
        </template>

        <div v-if="projectsAvailable" class="management-content">
          <div class="summary-number-grid project-numbers">
            <div v-for="item in projectStats" :key="item.label">
              <span>{{ item.label }}</span>
              <strong :class="{ 'danger-value': item.danger }">
                {{ formatNullableCount(item.value) }}
              </strong>
            </div>
          </div>

          <div class="distribution-block">
            <h3>项目区域与类型分布</h3>
            <div v-if="projectDistribution.length" class="stage-list">
              <div
                v-for="item in projectDistribution"
                :key="`${item.category}-${item.name}`"
                class="stage-item"
              >
                <span>
                  <small>{{ item.category }}</small>
                  {{ item.name }}
                </span>
                <strong>{{ item.count }}</strong>
              </div>
            </div>
            <div v-else class="inline-empty">项目区域与类型数据待完善</div>
          </div>
        </div>

        <div v-else class="panel-empty">
          <el-icon :size="34"><Briefcase /></el-icon>
          <strong>项目数据尚未接入</strong>
          <span>{{ projectsUnavailableReason }}</span>
        </div>
      </el-card>
    </section>

    <BossWorklogOverview
      v-if="activeSection === 'people' && summary?.workLogs"
      :summary="summary.workLogs"
      :refresh-countdown="autoRefreshCountdown"
    />

    <section
      v-if="activeSection === 'overview' || activeSection === 'projects'"
      class="bottom-grid section-panel"
      :class="{
        'overview-quality-grid': activeSection === 'overview',
        'project-risk-grid': activeSection === 'projects',
      }"
    >
      <el-card
        v-if="activeSection === 'projects'"
        shadow="never"
        class="risk-card"
      >
        <template #header>
          <div class="card-heading">
            <div>
              <span class="section-kicker">经营关注</span>
              <h2>风险提示</h2>
            </div>
            <el-tag :type="riskHeaderType" effect="plain">
              {{
                !risksAvailable
                  ? "风险数据待接入"
                  : normalizedRisks.length
                    ? `${normalizedRisks.length}项需关注`
                    : "当前无已识别风险"
              }}
            </el-tag>
          </div>
        </template>

        <div v-if="normalizedRisks.length" class="risk-list">
          <article
            v-for="risk in normalizedRisks"
            :key="risk.id"
            class="risk-item"
            :class="{ 'is-clickable': risk.route }"
            @click="goToDetail(risk.route)"
          >
            <span class="risk-icon" :class="`risk-${risk.levelClass}`">
              <el-icon><WarningFilled /></el-icon>
            </span>
            <div class="risk-copy">
              <div class="risk-title-row">
                <strong>{{ risk.title }}</strong>
                <el-tag :type="risk.tagType" size="small" effect="light">
                  {{ risk.levelLabel }}
                </el-tag>
              </div>
              <p>{{ risk.description }}</p>
              <small>
                <span v-if="risk.relatedName">{{ risk.relatedName }}</span>
                <span v-if="risk.occurredAt">
                  {{ formatDateTime(risk.occurredAt) }}
                </span>
              </small>
            </div>
            <el-icon v-if="risk.route" class="risk-arrow"
              ><ArrowRight
            /></el-icon>
          </article>
        </div>

        <div v-else class="panel-empty compact-empty">
          <el-icon :size="34">
            <CircleCheck v-if="risksAvailable" />
            <WarningFilled v-else />
          </el-icon>
          <strong>
            {{ risksAvailable ? "暂无已识别的经营风险" : "风险数据尚未接入" }}
          </strong>
          <span>
            {{
              risksAvailable
                ? "风险规则将随业务模块接入持续完善"
                : "建立结构化项目与事项后将自动识别风险"
            }}
          </span>
        </div>
      </el-card>

      <el-card
        v-if="activeSection === 'overview'"
        shadow="never"
        class="quality-card"
      >
        <template #header>
          <div class="card-heading">
            <div>
              <span class="section-kicker">数据可信度</span>
              <h2>数据质量</h2>
            </div>
            <span class="quality-summary">{{ qualitySummary }}</span>
          </div>
        </template>

        <div v-if="qualityIssues.length" class="quality-issues">
          <div
            v-for="issue in qualityIssues"
            :key="issue.code"
            :class="`issue-${issue.level}`"
          >
            <el-icon><WarningFilled /></el-icon>
            <span>{{ issue.message }}</span>
          </div>
        </div>

        <div v-if="qualitySources.length" class="quality-list">
          <div
            v-for="source in qualitySources"
            :key="source.code"
            class="quality-item"
          >
            <span
              class="quality-dot"
              :class="source.available ? 'is-ready' : 'is-missing'"
            ></span>
            <div>
              <strong>{{ source.name }}</strong>
              <small>
                {{
                  source.message ||
                  (source.available ? "数据已接入" : "等待业务数据接入")
                }}
              </small>
            </div>
            <div class="quality-state">
              <el-tag
                :type="source.available ? 'success' : 'info'"
                size="small"
                effect="plain"
              >
                {{ source.available ? "已接入" : "待接入" }}
              </el-tag>
              <small v-if="source.lastUpdatedAt">
                {{ formatDateTime(source.lastUpdatedAt) }}
              </small>
            </div>
          </div>
        </div>

        <div v-else class="panel-empty compact-empty">
          <el-icon :size="34"><DataAnalysis /></el-icon>
          <strong>数据质量清单待生成</strong>
          <span>接入数据源后将在此展示完整性状态</span>
        </div>
      </el-card>
    </section>

    <el-drawer
      v-model="insightVisible"
      class="boss-insight-drawer"
      direction="rtl"
      size="min(460px, 92vw)"
      :show-close="false"
    >
      <template #header="{ close }">
        <div class="insight-drawer-header">
          <div>
            <span class="section-kicker">构成明细</span>
            <h2>{{ selectedInsight?.title || "所选周期经营分析" }}</h2>
            <p v-if="selectedInsight">
              {{ selectedInsight.period }}
            </p>
          </div>
          <button type="button" aria-label="关闭构成分析" @click="close">
            ×
          </button>
        </div>
      </template>

      <div v-if="selectedInsight" class="insight-content">
        <div class="insight-summary">
          <span>当前选中指标</span>
          <strong :style="{ color: selectedInsight.activeColor }">
            {{ selectedInsight.activeLabel }}
          </strong>
          <b>{{ formatMoney(selectedInsight.activeValue) }}</b>
        </div>

        <div class="insight-list">
          <div
            v-for="item in selectedInsight.items"
            :key="item.key"
            class="insight-item"
          >
            <div class="insight-item-copy">
              <span>
                <i :style="{ background: item.color }"></i>
                {{ item.name }}
              </span>
              <strong>
                {{ item.value === null ? "数据缺失" : formatMoney(item.value) }}
              </strong>
            </div>
            <div class="insight-bar">
              <i
                :style="{
                  width: `${getInsightWidth(item.value, selectedInsight.maximum)}%`,
                  background: item.color,
                }"
              ></i>
            </div>
          </div>
        </div>

        <div class="insight-footnote">
          <el-icon><DataAnalysis /></el-icon>
          <p>
            此处展示所选周期公司级构成数据。缺失数据保持空值，不按零金额参与构成分析。
          </p>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import {
  ArrowRight,
  Briefcase,
  Calendar,
  CircleCheck,
  Coin,
  DataAnalysis,
  FullScreen,
  Money,
  OfficeBuilding,
  PieChart,
  Refresh,
  TrendCharts,
  User,
  UserFilled,
  WarningFilled,
} from "@element-plus/icons-vue";
import BossPieChart, {
  type BossPieChartSeries,
  type BossPieSliceClickPayload,
} from "@/components/boss/BossPieChart.vue";
import BossReimbursementBreakdown from "@/components/boss/BossReimbursementBreakdown.vue";
import BossWorklogOverview from "@/components/boss/BossWorklogOverview.vue";
import {
  getBossDashboardSummary,
  type BossDashboardMetric,
  type BossDashboardQuery,
  type BossDashboardSummary,
  type BossDepartmentPeopleItem,
  type BossHumanCostTrend,
  type BossProjectDistributionItem,
} from "@/utils/bossDashboardApi";

type PeriodMode = "month" | "year";
type DashboardSectionKey = "overview" | "finance" | "people" | "projects";
type PieInsightKind = "total" | "human" | "reimbursement";

interface ChartInsight {
  title: string;
  period: string;
  activeLabel: string;
  activeValue: number;
  activeColor: string;
  maximum: number;
  items: Array<{
    key: string;
    name: string;
    color: string;
    value: number | null;
  }>;
}

type MetricTone =
  | "navy"
  | "blue"
  | "cyan"
  | "violet"
  | "green"
  | "amber"
  | "red";

interface MetricDefinition {
  key: string;
  aliases: string[];
  label: string;
  icon: Component;
  tone: MetricTone;
  route?: string;
  fallbackUnit: string;
  valueType: "money" | "percent" | "count";
}

interface MetricCard extends MetricDefinition {
  available: boolean;
  displayValue: string;
  unit: string;
  reason: string;
  month: string;
}

interface QualitySourceView {
  code: string;
  name: string;
  available: boolean;
  message: string;
  lastUpdatedAt: string | null;
}

const metricDefinitions: MetricDefinition[] = [
  {
    key: "registeredTotalCost",
    aliases: ["registeredTotalCost", "totalCost", "registered_total_cost"],
    label: "所选周期已登记总成本",
    icon: Coin,
    tone: "navy",
    fallbackUnit: "",
    valueType: "money",
  },
  {
    key: "humanCost",
    aliases: ["humanCost", "human_cost"],
    label: "所选周期人力成本",
    icon: UserFilled,
    tone: "blue",
    route: "/employee-data?tab=human-cost",
    fallbackUnit: "",
    valueType: "money",
  },
  {
    key: "reimbursementCost",
    aliases: [
      "reimbursementCost",
      "reimbursementExpense",
      "reimbursement_cost",
    ],
    label: "所选周期报销费用",
    icon: Money,
    tone: "cyan",
    route: "/reimbursement-statistics",
    fallbackUnit: "",
    valueType: "money",
  },
  {
    key: "humanCostRatio",
    aliases: ["humanCostRatio", "human_cost_ratio"],
    label: "所选周期人力成本占比",
    icon: PieChart,
    tone: "violet",
    fallbackUnit: "%",
    valueType: "percent",
  },
  {
    key: "averageHumanCost",
    aliases: ["averageHumanCost", "average_human_cost"],
    label: "所选周期人均／人月均成本",
    icon: TrendCharts,
    tone: "green",
    route: "/employee-data?tab=human-cost",
    fallbackUnit: "",
    valueType: "money",
  },
  {
    key: "activeEmployees",
    aliases: ["activeEmployees", "activeEmployeeCount", "active_employees"],
    label: "当前在职人数",
    icon: User,
    tone: "blue",
    route: "/employee-data",
    fallbackUnit: "人",
    valueType: "count",
  },
  {
    key: "activeProjects",
    aliases: ["activeProjects", "activeProjectCount", "active_projects"],
    label: "当前在办项目",
    icon: OfficeBuilding,
    tone: "amber",
    route: "/worklog-projects",
    fallbackUnit: "个",
    valueType: "count",
  },
  {
    key: "riskProjects",
    aliases: ["riskProjects", "riskProjectCount", "risk_projects"],
    label: "当前风险项目",
    icon: WarningFilled,
    tone: "red",
    route: "/worklog-projects",
    fallbackUnit: "个",
    valueType: "count",
  },
];

const router = useRouter();
const authStore = useAuthStore();
const dashboardRef = ref<HTMLElement | null>(null);
const loading = ref(false);
const refreshing = ref(false);
const loadError = ref("");
const summary = ref<BossDashboardSummary | null>(null);
const periodMode = ref<PeriodMode>("year");
const selectedMonth = ref(formatMonthKey(new Date()));
const selectedYear = ref(String(new Date().getFullYear()));
const activeSection = ref<DashboardSectionKey>("overview");
const appliedTrendQuery = ref<BossDashboardQuery>({});
const insightVisible = ref(false);
const selectedInsight = ref<ChartInsight | null>(null);
const periodModes: Array<{ key: PeriodMode; label: string }> = [
  { key: "month", label: "按月" },
  { key: "year", label: "按年" },
];
const dashboardSections: Array<{
  key: DashboardSectionKey;
  label: string;
  description: string;
  icon: Component;
}> = [
  {
    key: "overview",
    label: "经营概览",
    description: "核心指标与数据质量",
    icon: DataAnalysis,
  },
  {
    key: "finance",
    label: "财务分析",
    description: "成本、薪资与报销",
    icon: Money,
  },
  {
    key: "people",
    label: "人员与日志",
    description: "人员结构与工作记录",
    icon: UserFilled,
  },
  {
    key: "projects",
    label: "项目与风险",
    description: "项目状态与经营风险",
    icon: Briefcase,
  },
];
const AUTO_REFRESH_SECONDS = 30;
const autoRefreshCountdown = ref(AUTO_REFRESH_SECONDS);
let refreshTimer: number | null = null;
let latestRequestId = 0;
let lastSuccessfulRefreshAt = 0;
const isSummaryBusy = computed(() => loading.value || refreshing.value);
const canOpenBusinessDetails = computed(() =>
  ["super_admin", "chairman", "admin"].includes(
    authStore.user?.role || "",
  ),
);

const periodLabel = computed(() => {
  const period = summary.value?.period;
  if (period?.label) {
    return period.label;
  }
  if (!period) {
    return periodMode.value === "month"
      ? formatMonth(selectedMonth.value)
      : `${selectedYear.value}年`;
  }
  if (period.startMonth && period.endMonth) {
    if (
      period.startMonth === `${selectedYear.value}-01` &&
      period.endMonth === `${selectedYear.value}-12`
    ) {
      return `${selectedYear.value}年`;
    }
    if (period.startMonth === period.endMonth) {
      return formatMonth(period.startMonth);
    }
    return `${formatMonth(period.startMonth)} 至 ${formatMonth(period.endMonth)}`;
  }
  return "所选周期";
});

const extraMetricTones: MetricTone[] = [
  "navy",
  "blue",
  "cyan",
  "violet",
  "green",
  "amber",
  "red",
];

const metricCards = computed<MetricCard[]>(() => {
  const metrics = summary.value?.metrics || {};
  const knownCards = metricDefinitions.map((definition) =>
    createMetricCard(definition, findMetric(definition)),
  );

  const extraCards = Object.entries(metrics)
    .filter(
      ([key, metric]) =>
        !metricDefinitions.some(
          (definition) =>
            definition.key === key ||
            definition.aliases.includes(key) ||
            definition.aliases.includes(metric.code),
        ),
    )
    .map(([key, metric], index) => {
      const valueType: MetricDefinition["valueType"] =
        metric.unit === "元"
          ? "money"
          : metric.unit === "%"
            ? "percent"
            : "count";
      const definition: MetricDefinition = {
        key,
        aliases: [key, metric.code],
        label: metric.name,
        icon:
          valueType === "money"
            ? Coin
            : valueType === "percent"
              ? PieChart
              : DataAnalysis,
        tone: extraMetricTones[index % extraMetricTones.length],
        fallbackUnit: metric.unit,
        valueType,
      };
      return createMetricCard(definition, metric);
    });

  return [...knownCards, ...extraCards];
});

const overviewMetricCards = computed(() =>
  metricCards.value.filter((card) =>
    [
      "registeredTotalCost",
      "humanCost",
      "reimbursementCost",
      "humanCostRatio",
      "averageHumanCost",
    ].includes(card.key),
  ),
);

const additionalMetricCards = computed(() =>
  metricCards.value.filter(
    (card) =>
      !metricDefinitions.some((definition) => definition.key === card.key),
  ),
);

function createMetricCard(
  definition: MetricDefinition,
  metric?: BossDashboardMetric,
): MetricCard {
  const available =
    Boolean(metric?.available) && Number.isFinite(metric?.value);
  const route = canOpenBusinessDetails.value ? definition.route : undefined;
  const averageBasis = summary.value?.period.humanCostAverageBasis;
  const averageDenominator =
    summary.value?.period.humanCostAverageDenominator || 0;
  const label =
    definition.key === "averageHumanCost"
      ? averageBasis === "payrollRecordCount"
        ? "所选月份人均人力成本"
        : "所选年度人月均成本"
      : definition.label;
  const availableReason =
    definition.key === "averageHumanCost" && averageDenominator > 0
      ? `按${averageDenominator}条工资记录计算`
      : route
        ? "查看明细"
        : "基于已接入数据统计";

  return {
    ...definition,
    label,
    route,
    available,
    displayValue: available
      ? formatMetricValue(metric?.value as number, definition.valueType)
      : "—",
    unit:
      available && definition.valueType !== "money"
        ? metric?.unit || definition.fallbackUnit
        : "",
    reason: available ? availableReason : metric?.reason || "指标尚未接入",
    month: metric?.month || "",
  };
}

function findMetric(
  definition: MetricDefinition,
): BossDashboardMetric | undefined {
  const metrics = summary.value?.metrics;
  if (!metrics) {
    return undefined;
  }

  for (const alias of definition.aliases) {
    if (metrics[alias]) {
      return metrics[alias];
    }
  }

  return Object.values(metrics).find((metric) =>
    definition.aliases.includes(metric.code),
  );
}

function sumPeriodValues<T>(
  rows: T[],
  selector: (row: T) => number | null,
): number | null {
  let hasValue = false;
  const total = rows.reduce((sum, row) => {
    const value = selector(row);
    if (value === null || !Number.isFinite(value)) {
      return sum;
    }
    hasValue = true;
    return sum + value;
  }, 0);
  return hasValue ? Number(total.toFixed(2)) : null;
}

const totalCostPie = computed(() => {
  const rows = summary.value?.financialTrends.totalCost || [];
  return {
    labels: [periodLabel.value],
    series: [
      createPieSeries("human", "人力成本", "#3d78b6", [
        sumPeriodValues(rows, (item) => item.humanCost),
      ]),
      createPieSeries("reimbursement", "报销费用", "#24a6a8", [
        sumPeriodValues(rows, (item) => item.reimbursementCost),
      ]),
    ],
  };
});

const humanCostPie = computed(() => {
  const rows = summary.value?.financialTrends.humanCostBreakdown || [];
  return {
    labels: [periodLabel.value],
    series: [
      createPieSeries("salary", "工资总额", "#3d78b6", [
        sumPeriodValues(rows, (item) => item.salary),
      ]),
      createPieSeries("company-social", "单位缴纳社保", "#7257b6", [
        sumPeriodValues(rows, (item) => item.companySocial),
      ]),
      createPieSeries("company-housing", "单位缴纳公积金", "#d1893d", [
        sumPeriodValues(rows, (item) => item.companyHousingFund),
      ]),
    ],
  };
});

type PayrollSummaryField =
  | "salary"
  | "individualIncomeTax"
  | "companySocial"
  | "personalSocial"
  | "companyHousingFund"
  | "personalHousingFund";

function sumPayrollField(
  rows: BossHumanCostTrend[],
  field: PayrollSummaryField,
): number | null {
  let hasValue = false;
  const total = rows.reduce((sum, row) => {
    const value = row[field];
    if (!row.available || value === null || !Number.isFinite(value)) {
      return sum;
    }
    hasValue = true;
    return sum + value;
  }, 0);
  return hasValue ? Number(total.toFixed(2)) : null;
}

const selectedPayrollSummary = computed(() => {
  const rows = summary.value?.financialTrends.humanCostBreakdown || [];
  return [
    {
      key: "salary",
      label: "工资总额",
      value: sumPayrollField(rows, "salary"),
      note: "所选周期工资记录汇总",
    },
    {
      key: "company-social",
      label: "单位缴纳社保",
      value: sumPayrollField(rows, "companySocial"),
      note: "计入公司人力成本",
    },
    {
      key: "company-housing",
      label: "单位缴纳公积金",
      value: sumPayrollField(rows, "companyHousingFund"),
      note: "计入公司人力成本",
    },
    {
      key: "personal-social",
      label: "个人缴纳社保",
      value: sumPayrollField(rows, "personalSocial"),
      note: "从员工工资中代扣，不增加公司成本",
    },
    {
      key: "personal-housing",
      label: "个人缴纳公积金",
      value: sumPayrollField(rows, "personalHousingFund"),
      note: "从员工工资中代扣，不增加公司成本",
    },
    {
      key: "individual-income-tax",
      label: "个税代扣汇总",
      value: sumPayrollField(rows, "individualIncomeTax"),
      note: "从员工工资中代扣，不增加公司成本",
    },
  ];
});

const reimbursementPie = computed(() => {
  const rows = summary.value?.financialTrends.reimbursement || [];
  return {
    labels: [periodLabel.value],
    series: [
      createPieSeries("basic", "基础报销", "#3d78b6", [
        sumPeriodValues(rows, (item) => item.basic),
      ]),
      createPieSeries("large", "大额报销", "#b97731", [
        sumPeriodValues(rows, (item) => item.large),
      ]),
      createPieSeries("business", "商务报销", "#7257b6", [
        sumPeriodValues(rows, (item) => item.business),
      ]),
    ],
  };
});

function createPieSeries(
  key: string,
  name: string,
  color: string,
  values: Array<number | null>,
): BossPieChartSeries {
  return { key, name, color, values };
}

const peopleAvailable = computed(() => {
  const people = summary.value?.people;
  return Boolean(people?.available);
});

const peopleUnavailableReason = computed(() => "录入员工资料后将自动生成概况");

const peopleStats = computed(() => {
  const people = summary.value?.people;
  return [
    {
      label: "员工总数",
      value: people?.total ?? null,
    },
    {
      label: "试用期",
      value: people?.probation ?? null,
    },
    {
      label: "本月入职",
      value: people?.newHiresThisMonth ?? null,
    },
    {
      label: "离职记录",
      value: people?.resigned ?? null,
    },
    {
      label: "请假中",
      value: people?.onLeave ?? null,
    },
    {
      label: "部门数量",
      value: people?.departments.length ?? null,
    },
  ];
});

const departmentDistribution = computed<BossDepartmentPeopleItem[]>(() => {
  const candidate = summary.value?.people.departments;
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate
    .map((item) => ({
      name: String(item.name || "未分配部门"),
      count: Number(item.count),
    }))
    .filter((item) => Number.isFinite(item.count))
    .sort((left, right) => right.count - left.count);
});

const departmentMaximum = computed(() =>
  Math.max(...departmentDistribution.value.map((item) => item.count), 1),
);

const projectsAvailable = computed(() => {
  return Boolean(summary.value?.projects.available);
});

const projectsUnavailableReason = computed(
  () => "建立结构化项目后将自动生成概况",
);

const projectStats = computed(() => {
  const projects = summary.value?.projects;
  const risks = summary.value?.risks;
  return [
    {
      label: "项目总数",
      value: projects?.total ?? null,
      danger: false,
    },
    {
      label: "已完成",
      value: projects?.completed ?? null,
      danger: false,
    },
    {
      label: "风险项目",
      value: risks?.totalRiskProjects ?? null,
      danger: true,
    },
    {
      label: "逾期事项",
      value: risks?.overdueMatters ?? null,
      danger: true,
    },
    {
      label: "跟进到期",
      value: risks?.dueFollowUps ?? null,
      danger: true,
    },
    {
      label: "长期未更新",
      value: risks?.staleProjects ?? projects?.stale ?? null,
      danger: true,
    },
  ];
});

const projectDistribution = computed<
  Array<BossProjectDistributionItem & { category: string }>
>(() => {
  const projects = summary.value?.projects;
  const districts = (projects?.districts || []).map((item) => ({
    name: String(item.name || "未设置区域"),
    count: Number(item.count),
    category: "区域",
  }));
  const types = (projects?.types || []).map((item) => ({
    name: String(item.name || "未设置类型"),
    count: Number(item.count),
    category: "类型",
  }));

  return [...districts, ...types]
    .filter((item) => Number.isFinite(item.count))
    .sort((left, right) => right.count - left.count)
    .slice(0, 9);
});

const risksAvailable = computed(() => Boolean(summary.value?.risks.available));

const riskHeaderType = computed(() => {
  if (!risksAvailable.value) {
    return "info";
  }
  return normalizedRisks.value.length ? "danger" : "success";
});

const normalizedRisks = computed(() =>
  (summary.value?.risks.items || []).map((risk) => {
    const level = normalizeRiskLevel(risk.level);
    return {
      id: `${risk.projectId}-${risk.type}-${risk.occurredAt}`,
      title: getRiskTitle(risk.type, risk.projectName),
      description: risk.description,
      relatedName: risk.ownerName ? `负责人：${risk.ownerName}` : "",
      occurredAt: risk.occurredAt,
      route:
        canOpenBusinessDetails.value && risk.projectId
          ? `/worklog-projects?projectId=${encodeURIComponent(risk.projectId)}`
          : null,
      levelClass: level.className,
      levelLabel: level.label,
      tagType: level.tagType,
    };
  }),
);

const qualitySources = computed<QualitySourceView[]>(() => {
  const sources = summary.value?.dataQuality.sources;
  if (!sources) {
    return [];
  }

  const definitions = [
    { code: "payroll", name: "工资与人力成本", source: sources.payroll },
    {
      code: "reimbursements",
      name: "报销费用",
      source: sources.reimbursements,
    },
    { code: "employees", name: "员工资料", source: sources.employees },
    { code: "projects", name: "结构化项目", source: sources.projects },
    { code: "workLogs", name: "日报与周报", source: sources.workLogs },
  ];

  return definitions.map((item) => ({
    code: item.code,
    name: item.name,
    available: item.source.available,
    message: item.source.available
      ? `${item.source.recordCount}条有效记录${
          item.source.latestMonth
            ? `，最新月份${formatMonth(item.source.latestMonth)}`
            : ""
        }`
      : "暂无有效业务记录",
    lastUpdatedAt: item.source.lastUpdatedAt,
  }));
});

const qualityIssues = computed(() => summary.value?.dataQuality.issues || []);

const qualitySummary = computed(() => {
  const available = qualitySources.value.filter(
    (item) => item.available,
  ).length;
  const total = qualitySources.value.length;
  if (total === 0) {
    return "等待检查";
  }
  return `${available}/${total} 个数据源已接入`;
});

const heroPulseStats = computed(() => {
  const availableSources = qualitySources.value.filter(
    (item) => item.available,
  ).length;
  const totalSources = qualitySources.value.length;
  const activeProjects = summary.value?.projects.active;
  const activeEmployees =
    summary.value?.metrics.activeEmployees?.value ??
    summary.value?.people.active ??
    null;
  const riskCount = summary.value?.risks.totalRiskProjects;

  return [
    {
      label: "数据覆盖",
      value: totalSources ? `${availableSources}/${totalSources}` : "—",
      note: "核心数据源",
      alert: false,
    },
    {
      label: "在办项目",
      value:
        activeProjects === null || activeProjects === undefined
          ? "—"
          : `${activeProjects}`,
      note: "结构化项目",
      alert: false,
    },
    {
      label: "在职人员",
      value: activeEmployees === null ? "—" : `${activeEmployees}`,
      note: "当前人员口径",
      alert: false,
    },
    {
      label: "风险项目",
      value:
        riskCount === null || riskCount === undefined ? "—" : `${riskCount}`,
      note: riskCount ? "需要关注" : "当前平稳",
      alert: Boolean(riskCount),
    },
  ];
});

function getRiskTitle(type: string, projectName: string) {
  const prefix: Record<string, string> = {
    overdue_matter: "项目事项逾期",
    due_follow_up: "项目跟进到期",
    stale_project: "项目长期未更新",
  };
  return `${prefix[type] || "项目风险"} · ${projectName}`;
}

function formatMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function setAppliedPeriodRange(range: [string, string]) {
  appliedTrendQuery.value = {
    startMonth: range[0],
    endMonth: range[1],
  };
}

function applySelectedPeriod() {
  if (periodMode.value === "month") {
    setAppliedPeriodRange([selectedMonth.value, selectedMonth.value]);
  } else {
    setAppliedPeriodRange([
      `${selectedYear.value}-01`,
      `${selectedYear.value}-12`,
    ]);
  }
  void loadSummary();
}

function setPeriodMode(mode: PeriodMode) {
  if (periodMode.value === mode) {
    return;
  }
  periodMode.value = mode;
  applySelectedPeriod();
}

function handlePeriodValueChange(value: string | null) {
  if (!value) {
    return;
  }
  applySelectedPeriod();
}

function getPieByKind(kind: PieInsightKind) {
  if (kind === "human") {
    return {
      title: "人力成本构成",
      chart: humanCostPie.value,
    };
  }
  if (kind === "reimbursement") {
    return {
      title: "报销费用构成",
      chart: reimbursementPie.value,
    };
  }
  return {
    title: "公司已登记成本构成",
    chart: totalCostPie.value,
  };
}

function openPieInsight(kind: PieInsightKind, point: BossPieSliceClickPayload) {
  const { title, chart } = getPieByKind(kind);
  if (!Number.isInteger(point.index) || point.index < 0) {
    return;
  }

  const items = chart.series.map((series) => {
    const value = series.values[point.index];
    return {
      key: series.key,
      name: series.name,
      color: series.color,
      value: Number.isFinite(value) ? (value as number) : null,
    };
  });
  const activeSeries =
    items.find((item) => item.key === point.seriesId) ||
    items.find((item) => item.name === point.seriesLabel) ||
    items[0];
  const availableValues = items
    .map((item) => item.value)
    .filter((value): value is number => value !== null);

  selectedInsight.value = {
    title,
    period: point.label || chart.labels[point.index] || periodLabel.value,
    activeLabel: activeSeries?.name || point.seriesLabel || "当前指标",
    activeValue: Number.isFinite(point.value)
      ? point.value
      : activeSeries?.value || 0,
    activeColor: activeSeries?.color || "#3d78b6",
    maximum: Math.max(...availableValues.map((value) => Math.abs(value)), 1),
    items,
  };
  insightVisible.value = true;
}

function getInsightWidth(value: number | null, maximum: number) {
  if (value === null || value === 0) {
    return 0;
  }
  return Math.max((Math.abs(value) / maximum) * 100, 4);
}

function formatMoney(value: number) {
  return `¥${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await dashboardRef.value?.requestFullscreen();
      return;
    }
    await document.exitFullscreen();
  } catch {
    loadError.value = "当前浏览器暂不支持全屏查看。";
  }
}

async function loadSummary() {
  const requestId = ++latestRequestId;
  const isInitialLoad = !summary.value;
  loading.value = isInitialLoad;
  refreshing.value = !isInitialLoad;
  loadError.value = "";
  try {
    const nextSummary = await getBossDashboardSummary(appliedTrendQuery.value);
    if (requestId !== latestRequestId) {
      return;
    }
    summary.value = nextSummary;
    lastSuccessfulRefreshAt = Date.now();
  } catch {
    if (requestId === latestRequestId) {
      loadError.value = "暂时无法获取经营汇总，请稍后重新加载。";
    }
  } finally {
    if (requestId === latestRequestId) {
      loading.value = false;
      refreshing.value = false;
      autoRefreshCountdown.value = AUTO_REFRESH_SECONDS;
    }
  }
}

function handleDashboardVisibilityChange() {
  if (document.hidden || isSummaryBusy.value || lastSuccessfulRefreshAt === 0) {
    return;
  }

  const elapsed = Date.now() - lastSuccessfulRefreshAt;
  if (elapsed >= AUTO_REFRESH_SECONDS * 1000) {
    autoRefreshCountdown.value = 0;
    void loadSummary();
  }
}

function goToDetail(route?: string | null) {
  if (!route) {
    return;
  }
  void router.push(route);
}

function getDistributionWidth(value: number, maximum: number) {
  if (value <= 0) {
    return 0;
  }
  return Math.max((value / maximum) * 100, 6);
}

function formatMetricValue(
  value: number,
  valueType: MetricDefinition["valueType"],
) {
  if (valueType === "money") {
    return `¥${new Intl.NumberFormat("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)}`;
  }

  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: valueType === "percent" ? 2 : 0,
    maximumFractionDigits: valueType === "percent" ? 2 : 0,
  }).format(value);
}

function formatNullableCount(value: number | null) {
  return value === null ? "待录入" : `${value}`;
}

function formatMonth(value: string) {
  const match = value.match(/^(\d{4})-(\d{1,2})/);
  if (!match) {
    return value;
  }
  return `${match[1]}年${Number(match[2])}月`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function normalizeRiskLevel(level: string) {
  const normalized = level.toLowerCase();
  if (["critical", "severe", "danger"].includes(normalized)) {
    return {
      className: "critical",
      label: "严重",
      tagType: "danger" as const,
    };
  }
  if (["high", "error"].includes(normalized)) {
    return {
      className: "high",
      label: "高风险",
      tagType: "danger" as const,
    };
  }
  if (["medium", "warning"].includes(normalized)) {
    return {
      className: "medium",
      label: "需关注",
      tagType: "warning" as const,
    };
  }
  return {
    className: "low",
    label: "提醒",
    tagType: "info" as const,
  };
}

onMounted(() => {
  setAppliedPeriodRange([
    `${selectedYear.value}-01`,
    `${selectedYear.value}-12`,
  ]);
  void loadSummary();
  document.addEventListener(
    "visibilitychange",
    handleDashboardVisibilityChange,
  );
  refreshTimer = window.setInterval(() => {
    if (document.hidden || isSummaryBusy.value) {
      return;
    }

    autoRefreshCountdown.value = Math.max(autoRefreshCountdown.value - 1, 0);
    if (autoRefreshCountdown.value === 0) {
      void loadSummary();
    }
  }, 1_000);
});

onBeforeUnmount(() => {
  latestRequestId += 1;
  document.removeEventListener(
    "visibilitychange",
    handleDashboardVisibilityChange,
  );
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
});
</script>

<style scoped>
.boss-dashboard {
  min-height: 100%;
  padding: 20px 24px 40px;
  background:
    radial-gradient(circle at 8% 4%, rgb(78 130 180 / 7%), transparent 22%),
    radial-gradient(circle at 92% 8%, rgb(30 167 164 / 5%), transparent 20%),
    #f5f7fa;
  color: #172a3d;
}

.boss-dashboard:fullscreen {
  overflow-y: auto;
}

.dashboard-hero {
  position: relative;
  display: grid;
  min-height: 178px;
  grid-template-columns: minmax(0, 1.35fr) minmax(330px, 0.65fr);
  align-items: center;
  gap: 30px;
  overflow: hidden;
  padding: 25px 30px;
  border: 1px solid #dfe7ee;
  border-radius: 20px;
  background:
    radial-gradient(circle at 94% 8%, rgb(63 178 165 / 11%), transparent 30%),
    linear-gradient(135deg, #ffffff, #f6f9fc);
  box-shadow:
    0 14px 36px rgb(31 55 78 / 8%),
    inset 0 1px 0 #ffffff;
  color: #1c3349;
}

.dashboard-hero::before {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgb(41 93 133 / 3.5%) 1px, transparent 1px),
    linear-gradient(90deg, rgb(41 93 133 / 3.5%) 1px, transparent 1px);
  background-size: 42px 42px;
  content: "";
  mask-image: linear-gradient(90deg, #000, transparent 72%);
  pointer-events: none;
}

.hero-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(3px);
  pointer-events: none;
}

.hero-glow-one {
  top: -190px;
  right: -120px;
  width: 450px;
  height: 450px;
  background: radial-gradient(circle, rgb(54 217 199 / 14%), transparent 67%);
}

.hero-glow-two {
  bottom: -220px;
  left: 28%;
  width: 420px;
  height: 420px;
  background: radial-gradient(circle, rgb(78 137 229 / 10%), transparent 68%);
}

.hero-copy,
.hero-pulse {
  position: relative;
  z-index: 1;
}

.hero-copy {
  min-width: 0;
}

.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: #238478;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.live-indicator {
  position: relative;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5de0c5;
  box-shadow: 0 0 0 5px rgb(93 224 197 / 11%);
}

.live-indicator::after {
  position: absolute;
  inset: -5px;
  border: 1px solid rgb(93 224 197 / 52%);
  border-radius: inherit;
  content: "";
  animation: live-pulse 2.4s ease-out infinite;
}

@keyframes live-pulse {
  0% {
    opacity: 0.75;
    transform: scale(0.7);
  }
  75%,
  100% {
    opacity: 0;
    transform: scale(1.7);
  }
}

.hero-copy h1 {
  display: flex;
  margin: 9px 0 6px;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 14px;
  color: #17354e;
  font-size: clamp(28px, 2.8vw, 40px);
  font-weight: 740;
  letter-spacing: -0.045em;
  line-height: 1.15;
}

.hero-copy h1 small {
  color: #7890a5;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.18em;
}

.hero-copy > p {
  max-width: 720px;
  margin: 0;
  color: rgb(222 235 245 / 76%);
  font-size: 14px;
  line-height: 1.75;
}

.hero-meta {
  display: flex;
  margin-top: 17px;
  flex-wrap: wrap;
  gap: 10px;
}

.hero-meta > span {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid #e2e9ef;
  border-radius: 9px;
  background: rgb(255 255 255 / 78%);
  color: #65798b;
  font-size: 11px;
  backdrop-filter: blur(10px);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5de0c5;
  box-shadow: 0 0 0 4px rgb(93 224 197 / 16%);
}

.hero-pulse {
  padding: 14px;
  border: 1px solid #dde7ed;
  border-radius: 15px;
  background: rgb(255 255 255 / 76%);
  box-shadow: 0 8px 24px rgb(36 69 94 / 6%);
  backdrop-filter: blur(12px);
}

.pulse-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #29465f;
}

.pulse-heading span {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.08em;
}

.pulse-heading small {
  color: #2c9588;
  font-size: 10px;
}

.pulse-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  margin-top: 10px;
  border: 1px solid #e4ebf0;
  border-radius: 12px;
  background: #e7edf2;
}

.pulse-grid > div {
  display: flex;
  min-height: 65px;
  flex-direction: column;
  justify-content: center;
  padding: 14px 15px;
  background: #ffffff;
}

.pulse-grid span {
  color: #8392a0;
  font-size: 10px;
}

.pulse-grid strong {
  margin-top: 3px;
  color: #203d56;
  font-size: 22px;
  font-weight: 720;
  letter-spacing: -0.035em;
}

.pulse-grid strong.is-alert {
  color: #c35a54;
}

.pulse-grid small {
  margin-top: 3px;
  color: #a1abb5;
  font-size: 9px;
}

.control-deck {
  position: relative;
  z-index: 3;
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin: 14px 0 0;
  padding: 13px 15px;
  border: 1px solid rgb(223 231 239 / 88%);
  border-radius: 17px;
  background: rgb(255 255 255 / 95%);
  box-shadow: 0 8px 24px rgb(28 49 70 / 6%);
  backdrop-filter: blur(18px);
}

.control-title {
  display: flex;
  min-width: 260px;
  align-items: center;
  gap: 12px;
}

.control-icon {
  display: inline-flex;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: linear-gradient(145deg, #e8f4f6, #eef4fb);
  color: #177e82;
}

.control-title > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.control-title strong {
  color: #1c3349;
  font-size: 13px;
}

.control-title small {
  margin-top: 3px;
  color: #8a98a7;
  font-size: 10px;
  line-height: 1.4;
}

.control-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.preset-switch {
  display: inline-flex;
  flex-shrink: 0;
  padding: 3px;
  border: 1px solid #e6ebf0;
  border-radius: 10px;
  background: #f4f6f8;
}

.preset-switch button {
  min-height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #778493;
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  transition:
    color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.preset-switch button:hover {
  color: #284f74;
}

.preset-switch button.is-active {
  background: #ffffff;
  box-shadow: 0 2px 7px rgb(33 55 76 / 10%);
  color: #1c527d;
  font-weight: 650;
}

.period-picker {
  width: 150px;
}

.period-picker :deep(.el-input__wrapper) {
  border-radius: 10px;
  box-shadow: 0 0 0 1px #e4e9ef inset;
}

.icon-action,
.refresh-action {
  min-height: 36px;
  border-radius: 10px;
}

.dashboard-sections {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
  padding: 6px;
  border: 1px solid #e1e8ee;
  border-radius: 16px;
  background: rgb(255 255 255 / 82%);
  box-shadow: 0 8px 26px rgb(30 54 76 / 5%);
}

.dashboard-sections button {
  display: flex;
  min-width: 0;
  min-height: 58px;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: transparent;
  color: #788796;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}

.dashboard-sections button:hover {
  background: #f4f8fa;
  color: #315f83;
}

.dashboard-sections button.is-active {
  border-color: #d4e4e7;
  background: linear-gradient(135deg, #edf7f6, #f2f6fb);
  box-shadow: 0 4px 12px rgb(35 82 102 / 7%);
  color: #1d696e;
}

.section-tab-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  background: #edf2f6;
  color: #54718c;
}

.dashboard-sections button.is-active .section-tab-icon {
  background: #dcefed;
  color: #1b807d;
}

.dashboard-sections button > span:last-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.dashboard-sections strong {
  font-size: 12px;
  font-weight: 680;
}

.dashboard-sections small {
  margin-top: 2px;
  overflow: hidden;
  color: #9aa5af;
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-panel {
  animation: section-enter 220ms ease-out;
}

@keyframes section-enter {
  from {
    opacity: 0;
    transform: translateY(5px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.refresh-action {
  border-color: #1d6d8b;
  background: linear-gradient(135deg, #145f7c, #167f87);
  box-shadow: 0 8px 18px rgb(22 108 128 / 17%);
}

.eyebrow,
.section-kicker {
  color: #3d719e;
  font-size: 10px;
  font-weight: 720;
  letter-spacing: 0.16em;
}

.load-alert {
  margin: 18px 18px 0;
  border-radius: 12px;
}

.metric-section {
  margin-top: 30px;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 13px;
}

.metric-card {
  --metric-color: #315f8d;
  --metric-soft: #edf3f8;
  position: relative;
  min-width: 0;
  min-height: 150px;
  overflow: hidden;
  padding: 16px 16px 13px;
  border: 1px solid rgb(222 229 236 / 92%);
  border-radius: 16px;
  background: linear-gradient(
    145deg,
    rgb(255 255 255 / 100%),
    rgb(249 251 253 / 98%)
  );
  box-shadow:
    0 10px 28px rgb(31 49 68 / 6%),
    inset 0 1px 0 #ffffff;
  transition:
    transform 220ms ease,
    border-color 220ms ease,
    box-shadow 220ms ease;
}

.metric-card::after {
  position: absolute;
  top: -44px;
  right: -35px;
  width: 128px;
  height: 128px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--metric-soft), transparent 70%);
  content: "";
  opacity: 0.95;
}

.metric-accent {
  position: absolute;
  top: 0;
  left: 18px;
  width: 38px;
  height: 3px;
  border-radius: 0 0 8px 8px;
  background: var(--metric-color);
  box-shadow: 0 2px 9px color-mix(in srgb, var(--metric-color) 35%, transparent);
}

.metric-card.is-clickable {
  cursor: pointer;
}

.metric-card.is-clickable:hover,
.metric-card.is-clickable:focus-visible {
  border-color: color-mix(in srgb, var(--metric-color) 32%, #e5e9ef);
  box-shadow: 0 18px 38px rgb(28 45 65 / 11%);
  outline: none;
  transform: translateY(-4px);
}

.metric-card.is-unavailable {
  --metric-color: #87919e;
  --metric-soft: #f2f4f6;
}

.tone-navy {
  --metric-color: #24476f;
  --metric-soft: #e8eff6;
}

.tone-blue {
  --metric-color: #3d78b6;
  --metric-soft: #eaf2fa;
}

.tone-cyan {
  --metric-color: #168f92;
  --metric-soft: #e6f5f4;
}

.tone-violet {
  --metric-color: #7257b6;
  --metric-soft: #f0ecfa;
}

.tone-green {
  --metric-color: #4f8d64;
  --metric-soft: #eaf5ed;
}

.tone-amber {
  --metric-color: #b97731;
  --metric-soft: #fcf2e7;
}

.tone-red {
  --metric-color: #bd4b4b;
  --metric-soft: #faecec;
}

.metric-top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.metric-icon {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--metric-color) 8%, transparent);
  border-radius: 12px;
  background: var(--metric-soft);
  color: var(--metric-color);
}

.metric-index {
  position: relative;
  z-index: 2;
  color: color-mix(in srgb, var(--metric-color) 38%, #a9b3bd);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.metric-period {
  flex-shrink: 0;
  color: #8d99a6;
  font-size: 10px;
}

.metric-label {
  position: relative;
  z-index: 1;
  margin-top: 12px;
  overflow: hidden;
  color: #72808f;
  font-size: 12px;
  font-weight: 560;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-value {
  position: relative;
  z-index: 1;
  min-height: 40px;
  margin-top: 3px;
  color: #152a3e;
  font-size: clamp(16px, 1.45vw, 23px);
  font-weight: 735;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.025em;
  line-height: 1.3;
  white-space: nowrap;
}

.metric-value small {
  margin-left: 4px;
  color: var(--yl-text-secondary, #6b6b6b);
  font-size: 13px;
  font-weight: 500;
}

.metric-skeleton {
  width: 65%;
  height: 30px;
  margin: 5px 0;
}

.metric-footer {
  position: relative;
  z-index: 1;
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #98a3af;
  font-size: 10px;
}

.metric-footer > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metric-state {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.metric-state i {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: 50%;
}

.metric-state i.is-ready {
  background: #44a878;
  box-shadow: 0 0 0 3px rgb(68 168 120 / 10%);
}

.metric-state i.is-missing {
  background: #a5adb6;
}

.additional-metrics {
  overflow: hidden;
  margin-top: 14px;
  border: 1px solid #e2e9ef;
  border-radius: 14px;
  background: rgb(255 255 255 / 82%);
}

.additional-metrics > summary {
  display: flex;
  min-height: 45px;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  color: #53697d;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  list-style: none;
}

.additional-metrics > summary::-webkit-details-marker {
  display: none;
}

.additional-metrics > summary::after {
  margin-left: auto;
  color: #8998a6;
  content: "展开";
  font-size: 10px;
}

.additional-metrics[open] > summary::after {
  content: "收起";
}

.additional-metrics > summary small {
  margin-left: 9px;
  margin-right: 10px;
  padding: 2px 7px;
  border-radius: 999px;
  background: #eef5f5;
  color: #4a7c7b;
  font-size: 10px;
  font-weight: 650;
}

.additional-metric-grid {
  display: grid;
  padding: 0 14px 14px;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.additional-metric-grid article {
  min-width: 0;
  padding: 12px;
  border: 1px solid #e8edf1;
  border-radius: 12px;
  background: #fafcfd;
}

.additional-metric-grid article > span {
  display: block;
  color: #728293;
  font-size: 11px;
}

.additional-metric-grid article > strong {
  display: block;
  margin-top: 5px;
  color: #22394e;
  font-size: 19px;
}

.additional-metric-grid article > strong small {
  margin-left: 3px;
  color: #81909e;
  font-size: 10px;
  font-weight: 500;
}

.additional-metric-grid article > p {
  overflow: hidden;
  margin: 5px 0 0;
  color: #98a3ad;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-block {
  margin-top: 34px;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 15px;
}

.section-heading h2,
.card-heading h2 {
  margin: 4px 0 0;
  color: #1d3248;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.section-heading p {
  margin: 0;
  color: #8b98a6;
  font-size: 11px;
  line-height: 1.5;
}

.section-note {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
  gap: 5px;
}

.analysis-badge {
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  gap: 7px;
  padding: 4px 9px;
  border: 1px solid #cfe9e4;
  border-radius: 999px;
  background: #eef9f7;
  color: #287b74;
  font-size: 10px;
  font-weight: 650;
}

.analysis-badge i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #3db8a3;
  box-shadow: 0 0 0 4px rgb(61 184 163 / 10%);
}

.payroll-summary-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.payroll-summary-strip > div {
  display: flex;
  min-width: 0;
  min-height: 94px;
  flex-direction: column;
  justify-content: center;
  padding: 14px 16px;
  border: 1px solid #e0e8ee;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 8px 22px rgb(31 55 78 / 4%);
}

.payroll-summary-strip span {
  color: #758797;
  font-size: 11px;
}

.payroll-summary-strip strong {
  overflow: hidden;
  margin-top: 5px;
  color: #203d56;
  font-size: 20px;
  font-weight: 720;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.payroll-summary-strip small {
  margin-top: 4px;
  color: #9aa6b1;
  font-size: 9px;
  line-height: 1.4;
}

.finance-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.chart-card {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border-color: rgb(219 228 236 / 92%);
  border-radius: 18px;
  background: linear-gradient(
    150deg,
    rgb(255 255 255 / 100%),
    rgb(249 251 253 / 100%)
  );
  box-shadow:
    0 14px 34px rgb(27 48 70 / 7%),
    inset 0 1px 0 #ffffff;
}

.chart-card::before {
  position: absolute;
  z-index: 1;
  top: 0;
  right: 24px;
  left: 24px;
  height: 2px;
  border-radius: 0 0 4px 4px;
  background: linear-gradient(90deg, #265c89, #1da19d, transparent);
  content: "";
  opacity: 0.62;
}

.chart-card :deep(.el-card__body) {
  padding: 22px 23px 16px;
}

.chart-wide {
  grid-column: 1 / -1;
}

.management-grid,
.bottom-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.management-grid > .people-card,
.management-grid > .project-card {
  grid-column: 1 / -1;
}

.snapshot-banner {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 9px;
  padding: 10px 13px;
  border: 1px solid #dce9e8;
  border-radius: 11px;
  background: #f1f8f7;
  color: #66817f;
  font-size: 11px;
}

.snapshot-banner .el-icon {
  flex-shrink: 0;
  color: #27867f;
}

.snapshot-banner strong {
  margin-right: 6px;
  color: #315f5c;
}

.people-section,
.overview-quality-grid,
.project-risk-grid {
  grid-template-columns: 1fr;
}

.overview-quality-grid .quality-card {
  width: 100%;
}

.quality-grid {
  display: grid;
  max-height: none;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
}

.management-card,
.risk-card,
.quality-card {
  min-width: 0;
  overflow: hidden;
  border-color: rgb(219 228 236 / 92%);
  border-radius: 18px;
  background: linear-gradient(150deg, #ffffff 0%, #fbfcfd 78%, #f7fafc 100%);
  box-shadow:
    0 12px 30px rgb(27 48 70 / 6%),
    inset 0 1px 0 #ffffff;
}

.management-card :deep(.el-card__header),
.risk-card :deep(.el-card__header),
.quality-card :deep(.el-card__header) {
  padding: 19px 22px 16px;
  border-bottom-color: #edf1f4;
}

.management-card :deep(.el-card__body),
.risk-card :deep(.el-card__body),
.quality-card :deep(.el-card__body) {
  padding: 21px 22px;
}

.card-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.card-heading .el-button {
  gap: 3px;
}

.summary-number-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid #e5ebf0;
  border-radius: 13px;
  background: #e7ecf1;
}

.summary-number-grid > div {
  display: flex;
  min-height: 78px;
  flex-direction: column;
  justify-content: center;
  padding: 12px 15px;
  background: linear-gradient(145deg, #ffffff, #f8fafc);
}

.summary-number-grid span {
  color: var(--yl-text-secondary, #6b6b6b);
  font-size: 12px;
}

.summary-number-grid strong {
  margin-top: 4px;
  color: #233d57;
  font-size: 23px;
  font-weight: 720;
  letter-spacing: -0.035em;
}

.summary-number-grid .danger-value {
  color: #bd4b4b;
}

.distribution-block {
  margin-top: 20px;
}

.distribution-block h3 {
  margin: 0 0 12px;
  color: #435466;
  font-size: 13px;
  font-weight: 600;
}

.bar-list {
  display: flex;
  max-height: 168px;
  flex-direction: column;
  gap: 11px;
  overflow-y: auto;
  padding-right: 4px;
}

.bar-row {
  display: grid;
  grid-template-columns: 92px minmax(80px, 1fr) 42px;
  align-items: center;
  gap: 10px;
}

.bar-label {
  overflow: hidden;
  color: #435466;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 8px;
  background: #edf1f5;
}

.bar-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #286692, #39a5a3);
  box-shadow: 0 2px 8px rgb(45 126 145 / 19%);
}

.bar-row strong {
  color: #435466;
  font-size: 12px;
  font-weight: 600;
  text-align: right;
}

.stage-list {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.stage-item {
  display: flex;
  min-width: calc(33.333% - 6px);
  flex: 1 1 30%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #e7ebf0;
  border-radius: 10px;
  background: linear-gradient(145deg, #ffffff, #f7f9fb);
  color: #435466;
  font-size: 12px;
}

.stage-item strong {
  color: #315f8d;
  font-size: 16px;
}

.stage-item span {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage-item small {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: #eaf1f7;
  color: #527394;
  font-size: 10px;
}

.inline-empty {
  display: flex;
  min-height: 68px;
  align-items: center;
  justify-content: center;
  border: 1px dashed #dfe4eb;
  border-radius: 8px;
  color: var(--yl-text-placeholder, #a8a8a8);
  font-size: 12px;
}

.panel-empty {
  display: flex;
  min-height: 230px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #8e99a6;
}

.panel-empty strong {
  margin-top: 12px;
  color: #526173;
  font-size: 14px;
}

.panel-empty span {
  max-width: 320px;
  margin-top: 5px;
  color: #9da6b1;
  font-size: 12px;
  text-align: center;
}

.compact-empty {
  min-height: 190px;
}

.risk-list {
  display: flex;
  max-height: 350px;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.risk-item {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 10px;
  border-bottom: 1px solid #eef1f4;
  transition:
    background 160ms ease,
    transform 160ms ease;
}

.risk-item:last-child {
  border-bottom: 0;
}

.risk-item.is-clickable {
  cursor: pointer;
}

.risk-item.is-clickable:hover {
  border-radius: 10px;
  background: #f5f8fa;
  transform: translateX(2px);
}

.risk-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
}

.risk-critical,
.risk-high {
  background: #fbeaea;
  color: #bd4b4b;
}

.risk-medium {
  background: #fcf2e7;
  color: #b97731;
}

.risk-low {
  background: #edf3f8;
  color: #56738f;
}

.risk-copy {
  min-width: 0;
}

.risk-title-row {
  display: flex;
  align-items: center;
  gap: 9px;
}

.risk-title-row strong {
  overflow: hidden;
  color: #283d52;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.risk-copy p {
  display: -webkit-box;
  overflow: hidden;
  margin: 5px 0;
  color: var(--yl-text-secondary, #6b6b6b);
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.risk-copy small {
  display: flex;
  gap: 12px;
  color: var(--yl-text-placeholder, #a8a8a8);
  font-size: 11px;
}

.risk-arrow {
  align-self: center;
  color: #aab2bc;
}

.quality-summary {
  color: #6f7d8c;
  font-size: 12px;
}

.quality-issues {
  display: flex;
  margin-bottom: 10px;
  flex-direction: column;
  gap: 7px;
}

.quality-issues > div {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 8px 10px;
  border-radius: 7px;
  font-size: 11px;
  line-height: 1.5;
}

.quality-issues .issue-warning {
  background: #fcf5eb;
  color: #996329;
}

.quality-issues .issue-error {
  background: #faeeee;
  color: #aa4545;
}

.quality-issues .el-icon {
  margin-top: 2px;
  flex-shrink: 0;
}

.quality-list {
  display: flex;
  max-height: 350px;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
}

.quality-item {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 8px;
  border-bottom: 1px solid #eef1f4;
}

.quality-item:last-child {
  border-bottom: 0;
}

.quality-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.quality-dot.is-ready {
  background: #52a566;
  box-shadow: 0 0 0 4px #edf7ef;
}

.quality-dot.is-missing {
  background: #aab2bc;
  box-shadow: 0 0 0 4px #f1f3f5;
}

.quality-item > div:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.quality-item strong {
  color: #31475d;
  font-size: 13px;
  font-weight: 600;
}

.quality-item small {
  margin-top: 3px;
  overflow: hidden;
  color: #929ca8;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quality-state {
  display: flex;
  align-items: flex-end;
  flex-direction: column;
}

.quality-state small {
  margin-top: 4px;
}

.insight-drawer-header {
  display: flex;
  width: 100%;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  color: #ffffff;
}

.insight-drawer-header h2 {
  margin: 5px 0 0;
  color: #ffffff;
  font-size: 23px;
  font-weight: 720;
  letter-spacing: -0.035em;
}

.insight-drawer-header p {
  margin: 5px 0 0;
  color: rgb(221 234 244 / 64%);
  font-size: 12px;
}

.insight-drawer-header .section-kicker {
  color: #65d4c4;
}

.insight-drawer-header button {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 10px;
  background: rgb(255 255 255 / 7%);
  color: rgb(255 255 255 / 76%);
  cursor: pointer;
  font: inherit;
  font-size: 22px;
  line-height: 1;
  transition:
    background 160ms ease,
    color 160ms ease;
}

.insight-drawer-header button:hover,
.insight-drawer-header button:focus-visible {
  background: rgb(255 255 255 / 14%);
  color: #ffffff;
  outline: none;
}

:global(.boss-insight-drawer) {
  background:
    radial-gradient(circle at 100% 0%, rgb(37 163 157 / 13%), transparent 30%),
    #f4f7f9;
}

:global(.boss-insight-drawer .el-drawer__header) {
  min-height: 132px;
  margin: 0;
  padding: 28px 26px 25px;
  background:
    linear-gradient(135deg, rgb(8 31 51 / 98%), rgb(15 61 88 / 97%)), #0b2943;
}

:global(.boss-insight-drawer .el-drawer__body) {
  padding: 24px;
}

.insight-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.insight-summary {
  position: relative;
  display: flex;
  min-height: 154px;
  overflow: hidden;
  flex-direction: column;
  justify-content: flex-end;
  padding: 22px;
  border: 1px solid #dfe7ed;
  border-radius: 17px;
  background:
    radial-gradient(circle at 90% 10%, rgb(44 145 147 / 15%), transparent 38%),
    linear-gradient(145deg, #ffffff, #f8fbfc);
  box-shadow: 0 12px 30px rgb(28 50 71 / 7%);
}

.insight-summary::before {
  position: absolute;
  top: 18px;
  right: 20px;
  width: 38px;
  height: 38px;
  border: 8px solid rgb(40 123 116 / 8%);
  border-radius: 50%;
  content: "";
}

.insight-summary span {
  color: #8b98a6;
  font-size: 11px;
}

.insight-summary strong {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 650;
}

.insight-summary b {
  margin-top: 4px;
  color: #172e44;
  font-size: clamp(28px, 4vw, 38px);
  font-weight: 760;
  letter-spacing: -0.05em;
}

.insight-list {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 18px;
  border: 1px solid #e0e7ed;
  border-radius: 15px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgb(28 50 71 / 5%);
}

.insight-item {
  padding: 5px 0;
}

.insight-item-copy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: #5d6d7e;
  font-size: 12px;
}

.insight-item-copy span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.insight-item-copy span i {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
}

.insight-item-copy strong {
  flex-shrink: 0;
  color: #273f56;
  font-size: 12px;
  font-weight: 680;
}

.insight-bar {
  height: 6px;
  overflow: hidden;
  margin-top: 8px;
  border-radius: 999px;
  background: #eff3f6;
}

.insight-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  transition: width 360ms ease;
}

.insight-footnote {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid #dae8e6;
  border-radius: 12px;
  background: #eef7f6;
  color: #40817c;
}

.insight-footnote .el-icon {
  margin-top: 2px;
  flex-shrink: 0;
}

.insight-footnote p {
  margin: 0;
  font-size: 11px;
  line-height: 1.65;
}

@media (max-width: 1280px) {
  .metric-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1180px) {
  .additional-metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .payroll-summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .finance-grid {
    grid-template-columns: 1fr;
  }

  .chart-wide {
    grid-column: auto;
  }
}

@media (max-width: 1100px) {
  .dashboard-hero {
    min-height: auto;
    grid-template-columns: 1fr;
    gap: 28px;
  }

  .hero-pulse {
    max-width: 680px;
  }

  .control-deck {
    align-items: flex-start;
    flex-direction: column;
    gap: 14px;
  }

  .control-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}

@media (max-width: 980px) {
  .finance-grid,
  .management-grid,
  .bottom-grid {
    grid-template-columns: 1fr;
  }

  .chart-wide {
    grid-column: auto;
  }
}

@media (max-width: 700px) {
  .boss-dashboard {
    padding: 16px;
  }

  .dashboard-hero {
    gap: 24px;
    padding: 30px 24px 43px;
    border-radius: 19px;
  }

  .hero-copy h1 {
    gap: 9px;
    font-size: 30px;
  }

  .hero-meta {
    margin-top: 20px;
  }

  .hero-meta > span {
    min-height: 31px;
  }

  .hero-pulse {
    padding: 16px;
  }

  .control-deck {
    margin: 12px 0 0;
    padding: 15px;
    border-radius: 15px;
  }

  .dashboard-sections {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .control-title {
    min-width: 0;
  }

  .control-actions {
    gap: 8px;
  }

  .preset-switch {
    width: 100%;
    overflow-x: auto;
  }

  .preset-switch button {
    min-width: max-content;
    flex: 1;
  }

  .period-picker {
    width: 100%;
  }

  .payroll-summary-strip {
    grid-template-columns: 1fr;
  }

  .refresh-action {
    flex: 1;
  }

  .section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }

  .section-note {
    align-items: flex-start;
  }

  .metric-section {
    margin-top: 25px;
  }

  .metric-grid {
    grid-template-columns: 1fr;
  }

  .additional-metric-grid {
    grid-template-columns: 1fr;
  }

  .quality-grid {
    grid-template-columns: 1fr;
  }

  .metric-card {
    min-height: 148px;
  }

  .summary-number-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .card-heading .el-button {
    padding-right: 0;
    padding-left: 4px;
  }

  .bar-row {
    grid-template-columns: 72px minmax(60px, 1fr) 36px;
  }

  .stage-item {
    min-width: calc(50% - 5px);
    flex-basis: 45%;
  }
}

@media (max-width: 420px) {
  .boss-dashboard {
    padding: 12px;
  }

  .dashboard-hero {
    padding: 26px 19px 40px;
  }

  .hero-copy > p {
    font-size: 12px;
  }

  .hero-copy h1 small {
    width: 100%;
  }

  .pulse-grid > div {
    min-height: 82px;
    padding: 12px;
  }

  .pulse-grid strong {
    font-size: 22px;
  }

  .control-deck {
    margin-right: 6px;
    margin-left: 6px;
  }

  .control-title small {
    display: none;
  }

  .metric-card {
    padding-right: 16px;
    padding-left: 16px;
  }

  .management-card :deep(.el-card__header),
  .risk-card :deep(.el-card__header),
  .quality-card :deep(.el-card__header),
  .management-card :deep(.el-card__body),
  .risk-card :deep(.el-card__body),
  .quality-card :deep(.el-card__body) {
    padding: 15px;
  }

  .card-heading h2 {
    font-size: 16px;
  }

  .quality-summary {
    display: none;
  }

  :global(.boss-insight-drawer .el-drawer__header) {
    min-height: 118px;
    padding: 24px 20px 21px;
  }

  :global(.boss-insight-drawer .el-drawer__body) {
    padding: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-indicator::after {
    animation: none;
  }

  .metric-card,
  .risk-item,
  .insight-bar i {
    transition: none;
  }
}
</style>
