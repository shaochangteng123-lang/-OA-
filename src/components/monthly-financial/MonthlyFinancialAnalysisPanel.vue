<template>
  <section
    ref="analysisPanelElement"
    class="financial-analysis-panel"
    :class="{ 'is-fullscreen': fullscreenActive }"
    aria-label="七模块财务分析"
    :aria-busy="loading"
    :role="fullscreenActive ? 'dialog' : undefined"
    :aria-modal="fullscreenActive ? true : undefined"
    tabindex="-1"
  >
    <header v-if="fullscreenActive" class="panel-fullscreen-header">
      <div>
        <strong>财务趋势分析</strong><small>全屏内可切换查看 7 个模块</small>
      </div>
      <button
        type="button"
        class="panel-fullscreen-exit"
        :disabled="fullscreenBusy"
        aria-label="退出七模块财务分析全屏"
        @click="exitModuleFullscreen()"
      >
        <svg
          class="fullscreen-icon"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M 3 7 H 7 V 3 M 13 3 V 7 H 17 M 17 13 H 13 V 17 M 7 17 V 13 H 3"
          />
        </svg>
        退出全屏
      </button>
    </header>
    <p v-if="fullscreenMessage" class="fullscreen-message" role="status">
      {{ fullscreenMessage }}
    </p>
    <header class="analysis-header">
      <div>
        <h2>财务趋势分析</h2>
        <p>选择一个模块查看趋势、结构与明细；实线为本期，虚线为对比期。</p>
      </div>
      <button
        class="primary-button"
        type="button"
        :disabled="!data || !!exporting"
        @click="exportModule('all')"
      >
        {{ exporting === "all" ? "正在导出…" : "导出统计与明细" }}
      </button>
    </header>

    <form
      class="analysis-filters"
      aria-label="财务分析查询条件"
      @submit.prevent="submitQuery"
    >
      <MonthlyFinancialDateRange
        ref="analysisDatePicker"
        v-model="analysisDateRange"
        class="date-range-field"
        :popper-append-to="
          fullscreenActive ? analysisPanelElement || undefined : undefined
        "
      />
      <label
        >统计周期
        <select v-model="filters.granularity" aria-label="分析统计周期">
          <option value="month">月度</option>
          <option value="quarter">季度</option>
          <option value="year">年度</option>
        </select>
      </label>
      <label>
        往年对比
        <select v-model="filters.comparisonYear" aria-label="分析对比年份">
          <option value="">不对比</option>
          <option
            v-for="year in comparisonYearOptions"
            :key="year"
            :value="String(year)"
          >
            {{ year }}年同期
          </option>
        </select>
      </label>
      <label
        v-show="['inflow', 'projects'].includes(activeModule)"
        class="business-filter"
        >甲方
        <select v-model="filters.partyA" aria-label="分析甲方">
          <option value="">全部甲方</option>
          <option
            v-for="party in data?.filterOptions.parties || []"
            :key="party"
            :value="party"
          >
            {{ party }}
          </option>
        </select>
      </label>
      <label
        v-show="['inflow', 'projects'].includes(activeModule)"
        class="business-filter"
        >合同区域
        <select v-model="filters.contractRegion" aria-label="分析合同区域">
          <option value="">全部合同区域</option>
          <option
            v-for="region in data?.filterOptions.contractRegions || []"
            :key="region"
            :value="region"
          >
            {{ region }}
          </option>
        </select>
      </label>
      <label v-show="activeModule === 'business'" class="business-filter"
        >商务报销范围
        <el-cascader
          v-model="filters.reimbursementScope"
          :options="businessScopeOptions"
          :props="{ emitPath: false, checkStrictly: true }"
          clearable
          filterable
          :teleported="false"
          placeholder="全部报销范围"
          aria-label="分析商务报销范围"
        />
      </label>
      <label v-show="activeModule === 'personnel'" class="business-filter"
        >人员
        <select v-model="filters.personId" aria-label="分析人员">
          <option value="">全部有历史数据的人员</option>
          <option
            v-for="person in data?.filterOptions.people || []"
            :key="person.id"
            :value="person.id"
          >
            {{ person.name }}
          </option>
        </select>
      </label>
      <button class="primary-button query-button" type="submit">
        {{ loading ? "查询中，可重新查询" : "查询分析" }}
      </button>
    </form>

    <div v-if="error" class="analysis-alert is-error" role="alert">
      <span>{{ error }}</span
      ><button type="button" @click="submitQuery">重新查询</button>
    </div>
    <div v-if="exportError" class="analysis-alert is-error" role="alert">
      {{ exportError }}
    </div>
    <p v-if="exportFile?.module === 'all'" class="export-ready" role="status">
      导出文件已生成。若未自动下载，请
      <a :href="exportFile.url" :download="exportFile.fileName"
        >保存全部分析文件</a
      >。
    </p>
    <p v-if="loading" class="analysis-loading" role="status">
      {{ refreshing ? "正在只读刷新当前分析…" : "正在查询财务分析…" }}
    </p>
    <p v-if="!data && !loading && !error" class="analysis-empty">
      暂无分析结果，请选择期间后查询。
    </p>

    <template v-if="data">
      <div class="displayed-query" aria-live="polite">
        <strong>当前已显示：{{ displayedQueryLabel }}</strong>
        <span>查询时间：{{ formatTime(data.generatedAt) }}</span>
        <p v-if="hasPendingFilters" class="pending-filter-note">
          查询条件已修改，当前仍显示上一组结果。点击“查询分析”后生效；导出仍使用当前已显示的条件。
        </p>
      </div>
      <details
        v-if="data.warnings.length || data.comparison?.warnings.length"
        class="analysis-notes global-notes"
      >
        <summary>
          数据校验提示（{{
            data.warnings.length + (data.comparison?.warnings.length || 0)
          }}条）<span>缺失数据不按零处理，点击查看</span>
        </summary>
        <ul class="analysis-alert global-warnings" aria-label="分析数据提示">
          <li v-for="warning in data.warnings" :key="warning">{{ warning }}</li>
          <li
            v-for="warning in data.comparison?.warnings || []"
            :key="`comparison:${warning}`"
          >
            对比期：{{ warning }}
          </li>
        </ul>
      </details>
      <nav class="analysis-navigation" aria-label="业务模块导航" role="tablist">
        <button
          v-for="module in modules"
          :id="`analysis-tab-${module.key}`"
          :key="module.key"
          type="button"
          role="tab"
          :aria-selected="activeModule === module.key"
          :aria-controls="`financial-analysis-${module.key}`"
          :class="{ 'is-active': activeModule === module.key }"
          @click="selectAnalysisModule(module.key)"
        >
          {{ moduleLabels[module.key] }}
        </button>
      </nav>

      <article
        v-for="module in modules"
        v-show="activeModule === module.key"
        :id="`financial-analysis-${module.key}`"
        :key="module.key"
        class="analysis-module"
        :data-module="module.key"
        role="tabpanel"
        :aria-labelledby="`analysis-tab-${module.key}`"
      >
        <header class="module-heading">
          <div>
            <h3>{{ module.title }}</h3>
            <p>{{ module.description }}</p>
          </div>
          <button
            type="button"
            :disabled="!!exporting"
            :aria-label="`导出${module.title}`"
            @click="exportModule(module.key)"
          >
            {{ exporting === module.key ? "正在导出…" : "导出本模块" }}
          </button>
        </header>
        <p
          v-if="exportFile?.module === module.key"
          class="export-ready"
          role="status"
        >
          导出文件已生成。若未自动下载，请
          <a :href="exportFile.url" :download="exportFile.fileName"
            >保存{{ module.title }}文件</a
          >。
        </p>
        <div class="analysis-summaries">
          <div
            v-for="summary in displayedModuleSummaries(module)"
            :key="summary.key"
            class="analysis-summary"
          >
            <span>{{ summary.label }}</span>
            <strong :class="{ 'is-unknown': summary.amount === null }">{{
              displaySummary(summary)
            }}</strong>
            <small v-if="summary.note">{{ summary.note }}</small>
            <small
              v-if="isKnownPartialAnalysisValue(summary)"
              class="summary-partial-note"
              >已知部分 · 不代表完整总额</small
            >
            <small
              v-if="
                !(module.key === 'business' && businessPointSelection) &&
                comparisonSummary(module, summary.key)
              "
              >对比期：{{
                displaySummary(comparisonSummary(module, summary.key)!)
              }}</small
            >
          </div>
        </div>

        <div
          class="module-visualization"
          :data-visualization-module="module.key"
          :class="{
            'balance-visualization': module.key === 'balances',
          }"
          :aria-label="`${module.title}图表`"
          :tabindex="-1"
        >
          <div class="module-main-charts">
            <div class="window-toolbar">
              <div>
                <strong>{{
                  isMonthlyChart
                    ? "图表固定显示连续 12 个月"
                    : isQuarterlyChart
                      ? "图表连续浏览历史季度（每屏最多 12 季）"
                      : `图表按${chartGranularityLabel}展示所选期间`
                }}</strong>
                <small>{{
                  isHistoryChart
                    ? "鼠标滑动只浏览历史；统计汇总和导出仍按上方统计期间，点选明细对应所选期间。"
                    : "图表按上方已查询的统计范围展示；横向滑动仅浏览这些期间。"
                }}</small>
              </div>
              <div class="visualization-actions">
                <button
                  type="button"
                  class="module-comparison-toggle"
                  :class="{
                    'balance-comparison-toggle': module.key === 'balances',
                  }"
                  :aria-pressed="moduleComparisonActive(module.key)"
                  :aria-label="`${module.title}：${moduleComparisonActive(module.key) ? '关闭年度对比' : '开启年度对比'}`"
                  :disabled="!hasModuleComparison(module.key) || chartLoading"
                  :title="
                    hasModuleComparison(module.key)
                      ? '仅切换当前模块的年度对比显示，不改变统计或导出'
                      : '请先在往年对比中选择年份并查询'
                  "
                  @click="toggleModuleComparison(module.key)"
                >
                  {{
                    moduleComparisonActive(module.key)
                      ? "关闭年度对比"
                      : "开启年度对比"
                  }}
                </button>
                <button
                  v-if="isHistoryChart"
                  type="button"
                  class="apply-window-statistics"
                  :disabled="
                    loading || chartLoading || hasPendingFilters || !chartRange
                  "
                  @click="applyWindowToStatistics"
                >
                  用当前窗口统计
                </button>
                <button
                  type="button"
                  class="module-fullscreen-toggle"
                  :class="{
                    'balance-fullscreen-toggle': module.key === 'balances',
                  }"
                  :aria-pressed="fullscreenActive"
                  :aria-label="`${module.title}入口：${fullscreenActive ? '退出全屏' : '全屏查看七模块'}`"
                  :disabled="fullscreenBusy"
                  :title="
                    fullscreenActive ? '退出全屏' : '全屏内可切换查看7个模块'
                  "
                  @click="toggleModuleFullscreen()"
                >
                  <svg
                    class="fullscreen-icon"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      :d="
                        fullscreenActive
                          ? 'M 3 7 H 7 V 3 M 13 3 V 7 H 17 M 17 13 H 13 V 17 M 7 17 V 13 H 3'
                          : 'M 7 3 H 3 V 7 M 13 3 H 17 V 7 M 17 13 V 17 H 13 M 7 17 H 3 V 13'
                      "
                    />
                  </svg>
                  <span>{{ fullscreenActive ? "退出全屏" : "全屏查看" }}</span>
                </button>
              </div>
            </div>
            <MonthlyFinancialAnalysisChart
              v-if="
                chartModuleFor(module).series.length &&
                (!isHistoryChart || chartRange)
              "
              type="line"
              :title="`${module.title} · ${chartGranularityLabel}趋势`"
              :periods="chartModuleFor(module).periods"
              :series="
                visibleFinancialChartModule(chartModuleFor(module)).series
              "
              :preferred-metric-keys="
                module.key === 'personnel'
                  ? personnelPreferredMetrics
                  : module.key === 'outflow'
                    ? outflowPreferredMetrics
                    : undefined
              "
              :comparison-series="
                chartComparisonFor(module)
                  ? visibleFinancialChartModule(chartComparisonFor(module)!)
                      .series
                  : emptyChartSeries
              "
              :comparison-periods="
                chartComparisonFor(module)?.periods || emptyChartPeriods
              "
              :comparison-label="displayedChartData?.comparison?.label || ''"
              :comparison-visible="moduleComparisonVisible(module.key)"
              :fixed-month-window="isMonthlyChart"
              :continuous-history="isMonthlyChart"
              :quarter-history="isQuarterlyChart"
              :period-view="!isHistoryChart"
              :window-end="chartRange?.to || ''"
              :min-month="chartMinMonth"
              :max-month="chartMaxMonth"
              :history-loading="isHistoryChart && chartLoading"
              :history-error="isHistoryChart ? chartError : ''"
              :show-current-month-shortcut="true"
              :current-month-disabled="
                !props.active || activeModule !== module.key
              "
              @current-month="returnToCurrentMonth(module.key)"
              @window-change="handleChartWindowChange"
              @point-select="handleAnalysisPointSelection(module.key, $event)"
              @metric-change="handleChartMetricChange(module.key)"
              @metric-selected="handleChartMetricSelected(module.key, $event)"
            />
          </div>
          <div v-if="module.key === 'projects'" class="project-point-details">
            <p class="chart-linkage-hint">
              在“查看指标”中选择“{{
                projectPeriodReceiptLabel
              }}”查看该期间实际回款，
              选择“已回款”查看期末累计；选择“主营项目签订合同数量”按行政区和服务单位（合同甲方）查看当期新签趋势。回款指标可点击点位或金额，按行政区展开对应的项目明细。
              签订数量可点击点位或数值，直接查看该分组当期签订的项目名称。
            </p>
            <template v-if="projectPointSelection">
              <button
                type="button"
                class="clear-project-drilldown"
                :class="{
                  'clear-project-period-drilldown': projectSelectionIsPeriod,
                }"
                @click="projectPointSelection = null"
              >
                收起{{
                  projectSelectionIsPeriod
                    ? projectPeriodReceiptLabel
                    : "项目回款"
                }}明细
              </button>
              <MonthlyFinancialProjectDrilldown
                :mode="projectSelectionIsPeriod ? 'period' : 'cumulative'"
                :period-label="projectPeriodReceiptLabel"
                :title="
                  projectSelectionIsPeriod
                    ? `${projectPeriodReceiptLabel}明细（按行政区）`
                    : '项目回款明细（按行政区）'
                "
                :rows="projectDrilldown.rows"
                :receipts="projectDrilldown.receipts"
                :total="projectDrilldown.total"
                :scope-label="projectDrilldown.scopeLabel"
                :note="projectDrilldown.note"
                :active="props.active && activeModule === module.key"
                :dialog-append-to="
                  fullscreenActive ? analysisPanelElement : null
                "
                @receipt-dialog-change="receiptDialogOpen = $event"
              />
            </template>
          </div>
          <p
            v-if="
              module.key === 'personnel' &&
              module.payrollDetailsVisible === false
            "
            class="analysis-alert payroll-permission-note"
            role="status"
          >
            工资、社保、公积金分项仅向具备工资查看权限的管理员开放；当前展示已授权成本合计和费用明细
          </p>
          <div
            v-if="module.key === 'business'"
            class="business-linkage-toolbar"
          >
            <p class="business-selection-scope">
              {{
                businessPointSelection
                  ? businessPointView.scopeLabel
                  : "点击折线点位或金额，查看对应期间的商务分类与占比。"
              }}
            </p>
            <button
              v-if="businessPointSelection"
              type="button"
              class="business-structure-reset"
              @click="businessPointSelection = null"
            >
              返回统计期间
            </button>
          </div>
          <div
            v-if="
              displayedComparisonItems(module).length || showStructure(module)
            "
            class="module-chart-row"
            :class="{
              'has-both-charts':
                displayedComparisonItems(module).length &&
                showStructure(module),
            }"
          >
            <MonthlyFinancialAnalysisChart
              v-if="displayedComparisonItems(module).length"
              type="bar"
              :title="
                module.key === 'personnel'
                  ? module.comparison.some((item) =>
                      item.note?.includes('已知部分'),
                    )
                    ? '人员期间成本比较（已知部分）'
                    : '人员期间成本比较'
                  : '报销范围／区域明细比较'
              "
              :items="displayedComparisonItems(module)"
            />
            <div v-if="showStructure(module)" class="structure-panel">
              <template v-if="module.key === 'balances'">
                <div class="balance-structure-toolbar">
                  <p v-if="isMonthlyChart">
                    {{
                      balancePointSelection
                        ? "已按点击月份展示四账户构成"
                        : "默认展示年度内最新时点的四账户构成"
                    }}；点击折线金额可查看对应月份。
                  </p>
                  <p v-else>
                    当前折线按{{
                      chartGranularityLabel
                    }}显示各期末余额；下方保留年度资金占比，切回月度可点选单月四账户构成。
                  </p>
                  <button
                    v-if="balancePointSelection"
                    type="button"
                    class="balance-year-reset"
                    @click="balancePointSelection = null"
                  >
                    返回年度资金占比
                  </button>
                </div>
                <p
                  v-if="!balancePointSelection && balanceYearLoading"
                  class="analysis-loading"
                  role="status"
                >
                  正在读取年度账户余额…
                </p>
                <div
                  v-if="!balancePointSelection && balanceYearError"
                  class="analysis-alert is-error"
                  role="alert"
                >
                  <span>{{ balanceYearError }}</span
                  ><button type="button" @click="loadBalanceYear">
                    重新读取年度余额
                  </button>
                </div>
                <MonthlyFinancialBalanceStructure
                  :title="
                    balancePointSelection
                      ? '当月四账户资金占比'
                      : '本年度资金占比'
                  "
                  :items="balanceStructure.items"
                  :total="balanceStructure.total"
                  :scope-label="balanceStructure.scopeLabel"
                  :note="balanceStructure.note"
                />
              </template>
              <template v-else-if="module.key === 'outflow'">
                <div class="balance-structure-toolbar">
                  <p>
                    点击总金额或任一分类的折线点位，查看同期间五类支出明细占比；圆心为分类精确合计，未知分类不按零计算。银行实际支出保留在上方摘要单独核对。
                  </p>
                  <button
                    v-if="outflowPointSelection"
                    type="button"
                    class="outflow-structure-reset"
                    @click="outflowPointSelection = null"
                  >
                    返回统计期间构成
                  </button>
                </div>
                <MonthlyFinancialOutflowStructure
                  :title="
                    outflowPointSelection
                      ? isMonthlyChart
                        ? '当月一般账户支出占比'
                        : '所选期间一般账户支出占比'
                      : '一般账户支出占比'
                  "
                  :items="outflowStructure.items"
                  :total="outflowStructure.total"
                  :total-label="outflowStructure.totalLabel"
                  :comparable-to-total="outflowStructure.comparableToTotal"
                  :scope-label="outflowStructure.scopeLabel"
                  :note="outflowStructure.note"
                />
              </template>
              <template
                v-else-if="module.key === 'business' && businessPointSelection"
              >
                <p class="structure-scope">
                  {{ businessPointView.scopeLabel }}
                </p>
                <MonthlyFinancialAnalysisChart
                  type="donut"
                  title="所选期间商务占比"
                  :items="businessPointView.items"
                  :structure-mode="
                    businessPointView.complete ? 'strict' : 'known-positive'
                  "
                />
                <p v-if="businessPointView.note" class="structure-note">
                  {{ businessPointView.note }}
                </p>
              </template>
              <template v-else>
                <div
                  v-if="module.key === 'personnel'"
                  class="balance-structure-toolbar personnel-structure-toolbar"
                >
                  <p>
                    点击折线点位或金额，查看对应月份的成本构成；未筛选人员时显示全部人员。
                  </p>
                  <button
                    v-if="personnelPointSelection"
                    type="button"
                    class="personnel-structure-reset"
                    @click="personnelPointSelection = null"
                  >
                    返回统计期间构成
                  </button>
                </div>
                <p class="structure-scope">
                  {{ displayedStructure(module).scopeLabel }}
                </p>
                <p
                  v-if="module.key === 'personnel' && personnelPointSelection"
                  class="personnel-selected-total"
                >
                  {{
                    personnelPointView.totalIsPartial
                      ? "该期间已知成本合计"
                      : "该期间成本合计"
                  }}：<strong>{{
                    personnelPointView.total === null
                      ? "未知／未核算"
                      : formatMonthlyFinancialAmount(personnelPointView.total)
                  }}</strong>
                </p>
                <MonthlyFinancialAnalysisChart
                  type="donut"
                  :title="
                    module.key === 'personnel'
                      ? personnelPointSelection
                        ? '所选期间人力成本构成'
                        : '所选人员成本结构'
                      : '金额结构'
                  "
                  :items="displayedStructure(module).items"
                  structure-mode="known-positive"
                  :cost-structure="module.key === 'personnel'"
                  :disabled-reason="
                    displayedStructure(module).disabledReason || ''
                  "
                />
                <p
                  v-if="displayedStructure(module).note"
                  class="structure-note"
                >
                  {{ displayedStructure(module).note }}
                </p>
              </template>
            </div>
          </div>
        </div>
        <MonthlyFinancialPersonnelDetails
          v-if="module.key === 'personnel' && data"
          :module="module"
          :query="data.query"
          :active="props.active && activeModule === 'personnel' && !loading"
          @select-person="selectPersonnel"
          @clear-person="clearPersonnelSelection"
        />
      </article>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ElCascader, type CascaderOption } from "element-plus";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from "vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import MonthlyFinancialBalanceStructure from "@/components/monthly-financial/MonthlyFinancialBalanceStructure.vue";
import MonthlyFinancialOutflowStructure from "@/components/monthly-financial/MonthlyFinancialOutflowStructure.vue";
import MonthlyFinancialProjectDrilldown from "@/components/monthly-financial/MonthlyFinancialProjectDrilldown.vue";
import MonthlyFinancialPersonnelDetails from "@/components/monthly-financial/MonthlyFinancialPersonnelDetails.vue";
import { sortPersonnelComparisonDescending } from "@/utils/monthlyFinancialPersonnelComparison";
import { visibleFinancialChartModule } from "@/utils/monthlyFinancialOutflowMetrics";
import {
  buildMonthlyOutflowStructure,
  buildPeriodOutflowStructure,
  buildProjectPeriodDetails,
} from "@/utils/monthlyFinancialAnalysisDrilldown";
import MonthlyFinancialDateRange from "@/components/monthly-financial/MonthlyFinancialDateRange.vue";
import {
  downloadMonthlyFinancialAnalysis,
  getMonthlyFinancialAnalysis,
  getMonthlyFinancialAnalysisWindow,
} from "@/utils/monthlyFinancialAnalysisApi";
import { formatMonthlyFinancialAmount } from "@/utils/monthlyFinancialReportPresentation";
import { buildFinancialAnalysisStructure } from "@/utils/monthlyFinancialAnalysisStructure";
import { isKnownPartialAnalysisValue } from "@/utils/monthlyFinancialAnalysisNotices";
import { buildFinancialBusinessSelection } from "@/utils/monthlyFinancialBusinessSelection";
import { buildFinancialPersonnelSelection } from "@/utils/monthlyFinancialPersonnelSelection";
import {
  buildMonthlyBalanceStructure,
  buildAnnualBalanceStructure,
} from "@/utils/monthlyFinancialBalanceStructure";
import {
  financialMonthOffset,
  financialTwelveMonthRange,
  financialTwelveQuarterRange,
  financialQuarterRange,
  financialWindowQuery,
} from "@/utils/monthlyFinancialAnalysisWindow";
import {
  financialHistoryBufferRange,
  financialHistoryRangeCovered,
} from "@/utils/monthlyFinancialHistoryBuffer";
import type {
  FinancialAnalysisGranularity,
  FinancialAnalysisModule,
  FinancialAnalysisModuleKey,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  FinancialAnalysisSeries,
  FinancialAnalysisValue,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";
import type { FinancialAnalysisPointSelection } from "@/types/monthlyFinancialAnalysisChart";

const props = withDefaults(
  defineProps<{
    selectedMonth: string;
    active?: boolean;
    refreshKey?: number;
    comparisonYears?: number[];
  }>(),
  { active: true, refreshKey: 0, comparisonYears: () => [] },
);
const data = ref<MonthlyFinancialAnalysisData | null>(null);
const isMonthlyChart = computed(
  () => data.value?.query.granularity === "month",
);
const isQuarterlyChart = computed(
  () => data.value?.query.granularity === "quarter",
);
const isHistoryChart = computed(
  () => isMonthlyChart.value || isQuarterlyChart.value,
);
const chartGranularityLabel = computed(() =>
  granularityLabel(data.value?.query.granularity || "month"),
);
type MonthWindow = { from: string; to: string };
const chartRange = ref<MonthWindow | null>(null);
const chartData = ref<MonthlyFinancialAnalysisData | null>(null);
const displayedChartData = computed(() =>
  isHistoryChart.value ? chartData.value : data.value,
);
const chartLoading = ref(false);
const chartError = ref("");
const balancePointSelection = ref<FinancialAnalysisPointSelection | null>(null);
const outflowPointSelection = ref<FinancialAnalysisPointSelection | null>(null);
const projectPointSelection = ref<FinancialAnalysisPointSelection | null>(null);
const businessPointSelection = ref<FinancialAnalysisPointSelection | null>(
  null,
);
const personnelPointSelection = ref<FinancialAnalysisPointSelection | null>(
  null,
);
const projectSelectionIsPeriod = computed(
  () => projectPointSelection.value?.metricKey === "periodReceived",
);
const projectPeriodReceiptLabel = computed(() =>
  isMonthlyChart.value
    ? "本月回款"
    : isQuarterlyChart.value
      ? "本季回款"
      : "本年回款",
);
const balanceYearModule = ref<FinancialAnalysisModule | undefined>();
const balanceYearLoading = ref(false);
const balanceYearError = ref("");
const loading = ref(false);
const refreshing = ref(false);
const error = ref("");
const exportError = ref("");
const exporting = ref<FinancialAnalysisModuleKey | "all" | "">("");
const activeModule = ref<FinancialAnalysisModuleKey>("balances");
const analysisPanelElement = shallowRef<HTMLElement | null>(null);
const analysisDatePicker = ref<{ close: () => void } | null>(null);
const fullscreenElement = shallowRef<HTMLElement | null>(null);
const fullscreenActive = ref(false);
const fullscreenFallback = ref(false);
const fullscreenBusy = ref(false);
const fullscreenMessage = ref("");
const receiptDialogOpen = ref(false);
const moduleComparisonVisibility = reactive<
  Partial<Record<FinancialAnalysisModuleKey, boolean>>
>({});
function moduleComparisonVisible(key: FinancialAnalysisModuleKey) {
  return moduleComparisonVisibility[key] !== false;
}
function hasModuleComparison(key: FinancialAnalysisModuleKey) {
  return !!displayedChartData.value?.comparison?.modules.find(
    (module) => module.key === key,
  )?.series.length;
}
function moduleComparisonActive(key: FinancialAnalysisModuleKey) {
  return moduleComparisonVisible(key) && hasModuleComparison(key);
}
let fullscreenSequence = 0;
let fullscreenOperationCount = 0;
let savedBodyOverflow: string | null = null;
let savedFullscreenFocus: HTMLElement | null = null;

function selectAnalysisModule(key: FinancialAnalysisModuleKey) {
  activeModule.value = key;
  // 全屏内只切业务模块，不更换全屏元素；滚动到该模块首部，保留横向月份和筛选草稿。
  void nextTick(() => {
    const panel = analysisPanelElement.value;
    if (!fullscreenActive.value || !panel || activeModule.value !== key) return;
    const article = panel.querySelector<HTMLElement>(`[data-module="${key}"]`);
    if (!article) return;
    const headerHeight =
      panel.querySelector(".panel-fullscreen-header")?.getBoundingClientRect()
        .height || 0;
    const navigationHeight =
      panel.querySelector(".analysis-navigation")?.getBoundingClientRect()
        .height || 0;
    panel.scrollTop = Math.max(
      0,
      panel.scrollTop +
        article.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        headerHeight -
        navigationHeight -
        12,
    );
  });
}
function toggleModuleComparison(key: FinancialAnalysisModuleKey) {
  if (
    disposed ||
    !props.active ||
    activeModule.value !== key ||
    !hasModuleComparison(key) ||
    chartLoading.value
  )
    return;
  moduleComparisonVisibility[key] = !moduleComparisonVisible(key);
  if (
    key === "balances" &&
    !moduleComparisonVisible(key) &&
    balancePointSelection.value?.comparison
  )
    balancePointSelection.value = null;
  if (!moduleComparisonVisible(key)) {
    if (key === "outflow" && outflowPointSelection.value?.comparison)
      outflowPointSelection.value = null;
    if (key === "projects" && projectPointSelection.value?.comparison)
      projectPointSelection.value = null;
    if (key === "business" && businessPointSelection.value?.comparison)
      businessPointSelection.value = null;
    if (key === "personnel" && personnelPointSelection.value?.comparison)
      personnelPointSelection.value = null;
  }
}
function restoreFullscreenPage() {
  if (savedBodyOverflow !== null) {
    if (document.body.style.overflow === "hidden")
      document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = null;
  }
}
function fullscreenAllowed(element: HTMLElement) {
  return (
    !disposed &&
    props.active &&
    !!data.value &&
    analysisPanelElement.value === element
  );
}
function focusAfterFullscreen() {
  if (receiptDialogOpen.value) return;
  void nextTick(() => {
    if (disposed || receiptDialogOpen.value) return;
    const originalModule =
      savedFullscreenFocus?.closest<HTMLElement>(".analysis-module")?.dataset
        .module;
    const returnTarget =
      originalModule && originalModule !== activeModule.value
        ? analysisPanelElement.value?.querySelector<HTMLElement>(
            `[data-module="${activeModule.value}"] .module-fullscreen-toggle`,
          )
        : savedFullscreenFocus;
    const focusTarget = fullscreenActive.value
      ? fullscreenElement.value?.querySelector<HTMLElement>(
          ".panel-fullscreen-exit",
        )
      : returnTarget;
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
  });
}
function handleModuleFullscreenChange() {
  const own =
    !!fullscreenElement.value &&
    document.fullscreenElement === fullscreenElement.value;
  const wasNative = fullscreenActive.value && !fullscreenFallback.value;
  // 其他图表的全屏事件不能把焦点抢回本模块。
  if (!own && !wasNative) return;
  analysisDatePicker.value?.close?.();
  if (own) {
    if (!fullscreenAllowed(fullscreenElement.value!)) {
      void exitModuleFullscreen(false);
      return;
    }
    fullscreenActive.value = true;
    fullscreenFallback.value = false;
    restoreFullscreenPage();
  } else {
    fullscreenActive.value = false;
    fullscreenMessage.value = "";
  }
  focusAfterFullscreen();
}
async function exitModuleFullscreen(restoreFocus = true) {
  const sequence = ++fullscreenSequence;
  const element = fullscreenElement.value;
  analysisDatePicker.value?.close?.();
  fullscreenActive.value = false;
  fullscreenFallback.value = false;
  fullscreenBusy.value = fullscreenOperationCount > 0;
  fullscreenMessage.value = "";
  restoreFullscreenPage();
  if (
    element &&
    document.fullscreenElement === element &&
    document.exitFullscreen
  ) {
    fullscreenOperationCount += 1;
    fullscreenBusy.value = true;
    try {
      await document.exitFullscreen();
    } catch {
      if (
        fullscreenAllowed(element) &&
        document.fullscreenElement === element
      ) {
        fullscreenActive.value = true;
        fullscreenMessage.value =
          "退出全屏未成功，请按退出键或再次点击退出全屏。";
      }
    } finally {
      fullscreenOperationCount -= 1;
      fullscreenBusy.value = fullscreenOperationCount > 0;
    }
  }
  if (restoreFocus && sequence === fullscreenSequence) focusAfterFullscreen();
}
async function toggleModuleFullscreen() {
  if (fullscreenBusy.value) return;
  if (fullscreenActive.value) {
    await exitModuleFullscreen();
    return;
  }
  const element = analysisPanelElement.value;
  if (!element || !fullscreenAllowed(element)) return;
  fullscreenElement.value = element;
  analysisDatePicker.value?.close?.();
  if (document.fullscreenElement && document.fullscreenElement !== element) {
    fullscreenMessage.value = "请先退出其他内容的全屏，再打开财务分析全屏。";
    return;
  }
  const sequence = ++fullscreenSequence;
  fullscreenOperationCount += 1;
  fullscreenBusy.value = true;
  fullscreenMessage.value = "";
  savedFullscreenFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  try {
    if (!element.requestFullscreen) throw new Error("当前环境未提供原生全屏");
    await element.requestFullscreen();
    if (sequence !== fullscreenSequence || !fullscreenAllowed(element)) {
      if (document.fullscreenElement === element && document.exitFullscreen)
        await document.exitFullscreen().catch(() => undefined);
      return;
    }
    handleModuleFullscreenChange();
  } catch {
    if (sequence !== fullscreenSequence || !fullscreenAllowed(element)) return;
    fullscreenFallback.value = true;
    fullscreenActive.value = true;
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    fullscreenMessage.value =
      "已铺满应用页面；可按退出键或点击“退出全屏”返回。";
    focusAfterFullscreen();
  } finally {
    fullscreenOperationCount -= 1;
    fullscreenBusy.value = fullscreenOperationCount > 0;
    if (sequence === fullscreenSequence) {
      focusAfterFullscreen();
    }
  }
}
function handleModuleFullscreenKey(event: KeyboardEvent) {
  if (event.defaultPrevented || receiptDialogOpen.value) return;
  if (!fullscreenActive.value && !fullscreenBusy.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    void exitModuleFullscreen();
    return;
  }
  if (event.key !== "Tab" || !fullscreenActive.value) return;
  const controls = Array.from(
    fullscreenElement.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
    ) || [],
  ).filter((element) => element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      !fullscreenElement.value?.contains(document.activeElement))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last ||
      !fullscreenElement.value?.contains(document.activeElement))
  ) {
    event.preventDefault();
    first.focus();
  }
}
const moduleLabels: Record<FinancialAnalysisModuleKey, string> = {
  balances: "账户余额资金台帐",
  inflow: "一般账户入账统计",
  outflow: "一般账户出账统计",
  projects: "项目分析",
  settlement: "收支结余",
  business: "商务统计",
  personnel: "人力成本分析",
};
const exportFile = ref<{
  module: FinancialAnalysisModuleKey | "all";
  url: string;
  fileName: string;
} | null>(null);
const filters = reactive({
  from: "",
  to: "",
  granularity: "month" as FinancialAnalysisGranularity,
  partyA: "",
  contractRegion: "",
  reimbursementScope: "",
  personId: "",
  comparisonYear: "",
});
const analysisDateRange = computed<[string, string]>({
  get: (): [string, string] => [filters.from, filters.to],
  set: (range: [string, string]) => {
    if (!Array.isArray(range) || range.length !== 2) return;
    filters.from = range[0];
    filters.to = range[1];
  },
});
const moduleOrder: FinancialAnalysisModuleKey[] = [
  "balances",
  "inflow",
  "outflow",
  "projects",
  "settlement",
  "business",
  "personnel",
];
const modules = computed(() =>
  [...(data.value?.modules || [])].sort(
    (left, right) =>
      moduleOrder.indexOf(left.key) - moduleOrder.indexOf(right.key),
  ),
);
const comparisonYearOptions = computed(() => {
  const firstYear = Number(filters.from.slice(0, 4));
  if (!Number.isInteger(firstYear) || firstYear <= 1900) return [];
  return Array.from(
    new Set([
      ...props.comparisonYears,
      ...Array.from(
        { length: firstYear - 1900 },
        (_, index) => firstYear - index - 1,
      ),
    ]),
  )
    .filter((year) => year >= 1900 && year < firstYear)
    .sort((left, right) => right - left);
});
const structureViews = computed(
  () =>
    Object.fromEntries(
      modules.value.map((module) => [
        module.key,
        buildFinancialAnalysisStructure(module, data.value!.query),
      ]),
    ) as Record<
      FinancialAnalysisModuleKey,
      ReturnType<typeof buildFinancialAnalysisStructure>
    >,
);
const balanceStructure = computed(() => {
  const selected = balancePointSelection.value;
  if (selected) {
    const source = (
      selected.comparison
        ? chartData.value?.comparison?.modules
        : chartData.value?.modules
    )?.find((module) => module.key === "balances");
    return buildMonthlyBalanceStructure(
      source,
      selected.month,
      selected.comparison,
    );
  }
  return buildAnnualBalanceStructure(
    balanceYearModule.value,
    data.value?.query.to || props.selectedMonth,
  );
});
function pointModule(
  key: FinancialAnalysisModuleKey,
  selected: FinancialAnalysisPointSelection,
) {
  return (
    selected.comparison
      ? displayedChartData.value?.comparison?.modules
      : displayedChartData.value?.modules
  )?.find((module) => module.key === key);
}
function pointPeriod(selected: FinancialAnalysisPointSelection) {
  return {
    from: selected.from || selected.month,
    to: selected.to || selected.month,
    periodKey: selected.periodKey,
    comparison: selected.comparison,
  };
}
const outflowStructure = computed(() =>
  outflowPointSelection.value
    ? buildPeriodOutflowStructure(
        pointModule("outflow", outflowPointSelection.value),
        pointPeriod(outflowPointSelection.value),
      )
    : buildMonthlyOutflowStructure(
        data.value?.modules.find((module) => module.key === "outflow"),
      ),
);
const projectDrilldown = computed(() =>
  buildProjectPeriodDetails(
    projectPointSelection.value
      ? pointModule("projects", projectPointSelection.value)
      : undefined,
    {
      ...(projectPointSelection.value
        ? pointPeriod(projectPointSelection.value)
        : { from: "", to: "" }),
      metricKey: projectSelectionIsPeriod.value ? "periodReceived" : "received",
    },
  ),
);
const businessPointView = computed(() =>
  buildFinancialBusinessSelection(
    businessPointSelection.value
      ? pointModule("business", businessPointSelection.value)
      : undefined,
    businessPointSelection.value || {
      month: "",
      comparison: false,
      metricKey: "business",
    },
  ),
);
function displayedModuleSummaries(module: FinancialAnalysisModule) {
  return module.key === "business" && businessPointSelection.value
    ? [
        {
          key: "selectedBusiness",
          label: businessPointView.value.scopeLabel,
          amount: businessPointView.value.total,
        },
      ]
    : module.summaries;
}
const personnelPointView = computed(() =>
  buildFinancialPersonnelSelection(
    personnelPointSelection.value
      ? pointModule("personnel", personnelPointSelection.value)
      : undefined,
    personnelPointSelection.value,
    data.value?.query.personId,
    data.value?.filterOptions.people.find(
      (person) => person.id === data.value?.query.personId,
    )?.name,
  ),
);
function displayedStructure(module: FinancialAnalysisModule) {
  return module.key === "personnel" && personnelPointSelection.value
    ? personnelPointView.value
    : structureViews.value[module.key];
}
const personnelComparisonItems = computed(() =>
  sortPersonnelComparisonDescending(
    modules.value.find((module) => module.key === "personnel")?.comparison ||
      [],
  ),
);
function displayedComparisonItems(module: FinancialAnalysisModule) {
  if (module.key === "personnel") return personnelComparisonItems.value;
  return module.key === "business" && businessPointSelection.value
    ? businessPointView.value.items
    : module.comparison;
}
function clearChartSelections() {
  balancePointSelection.value = null;
  outflowPointSelection.value = null;
  projectPointSelection.value = null;
  businessPointSelection.value = null;
  personnelPointSelection.value = null;
}
function handleChartMetricChange(key: FinancialAnalysisModuleKey) {
  if (!props.active || disposed || activeModule.value !== key) return;
  if (key === "projects") projectPointSelection.value = null;
  if (key === "business") businessPointSelection.value = null;
  if (key === "personnel") personnelPointSelection.value = null;
}
function handleChartMetricSelected(
  key: FinancialAnalysisModuleKey,
  metricKey: string,
) {
  if (!props.active || disposed || activeModule.value !== key) return;
  if (
    key === "projects" &&
    metricKey === "signedContractCount" &&
    hasModuleComparison(key)
  )
    moduleComparisonVisibility[key] = true;
}
function handleAnalysisPointSelection(
  key: FinancialAnalysisModuleKey,
  selected: FinancialAnalysisPointSelection,
) {
  if (
    !props.active ||
    disposed ||
    activeModule.value !== key ||
    chartLoading.value ||
    (selected.comparison && !moduleComparisonActive(key))
  )
    return;
  const module = pointModule(key, selected);
  if (!module) return;
  const period = pointPeriod(selected);
  const matches = module.periods
    .map((value, index) => ({ value, index }))
    .filter(
      ({ value }) =>
        value.from === period.from &&
        value.to === period.to &&
        (!period.periodKey || value.key === period.periodKey),
    );
  if (matches.length !== 1) return;
  const amount = module.series.find(
    (series) => series.key === selected.metricKey,
  )?.values[matches[0].index];
  if (typeof amount !== "string" || !/^[+-]?\d+(?:\.\d+)?$/u.test(amount))
    return;
  if (key === "balances" && isMonthlyChart.value)
    handleBalancePointSelection(key, selected);
  if (key === "outflow") outflowPointSelection.value = { ...selected };
  if (key === "business" && selected.metricKey === "business")
    businessPointSelection.value = { ...selected };
  if (key === "personnel" && module.payrollDetailsVisible !== false)
    personnelPointSelection.value = { ...selected };
  if (key === "projects") {
    projectPointSelection.value = ["received", "periodReceived"].includes(
      selected.metricKey,
    )
      ? { ...selected }
      : null;
  }
}

function handleBalancePointSelection(
  module: FinancialAnalysisModuleKey,
  selected: FinancialAnalysisPointSelection,
) {
  if (
    module !== "balances" ||
    (selected.comparison && !moduleComparisonActive("balances")) ||
    chartLoading.value ||
    !chartData.value ||
    chartData.value.query.granularity !== "month"
  )
    return;
  const source = (
    selected.comparison
      ? chartData.value.comparison?.modules
      : chartData.value.modules
  )?.find((item) => item.key === "balances");
  const index =
    source?.periods.findIndex(
      (period) =>
        period.from === selected.month && period.to === selected.month,
    ) ?? -1;
  const amount = source?.series.find(
    (series) => series.key === selected.metricKey,
  )?.values[index];
  if (
    index < 0 ||
    typeof amount !== "string" ||
    !/^[+-]?\d+(?:\.\d+)?$/u.test(amount)
  )
    return;
  balancePointSelection.value = { ...selected };
}
const chartMaxMonth = computed(() => {
  const selected = data.value?.query.to || props.selectedMonth;
  return isQuarterlyChart.value
    ? selected
    : selected < "1900-12"
      ? "1900-12"
      : selected;
});
const chartMinMonth = computed(() => {
  const years = props.comparisonYears.filter(
    (year) => year >= 1900 && year <= 2099,
  );
  const earliest = years.length ? `${Math.min(...years)}-01` : "1900-01";
  return chartRange.value && chartRange.value.from < earliest
    ? chartRange.value.from
    : earliest;
});

function chartModuleFor(module: FinancialAnalysisModule) {
  if (!isHistoryChart.value) return module;
  const source = chartData.value;
  const monthly =
    source && source.query.granularity === data.value?.query.granularity
      ? source.modules.find((item) => item.key === module.key)
      : undefined;
  if (monthly) return monthly;
  const periods =
    isQuarterlyChart.value && chartRange.value
      ? (() => {
          const values = [];
          let month = chartRange.value!.from;
          while (month <= chartRange.value!.to) {
            const range = financialQuarterRange(month, chartRange.value!.to);
            const key =
              month.slice(0, 4) + "-Q" + Math.ceil(Number(month.slice(5)) / 3);
            values.push({
              key,
              label: `${month.slice(0, 4)}年第${Math.ceil(Number(month.slice(5)) / 3)}季度`,
              ...range,
            });
            if (range.to >= chartRange.value!.to) break;
            month = financialMonthOffset(range.from, 3);
          }
          return values;
        })()
      : chartRange.value
        ? Array.from({ length: 12 }, (_, index) => {
            const month = financialMonthOffset(chartRange.value!.from, index);
            return {
              key: month,
              label: `${month.slice(0, 4)}年${Number(month.slice(5))}月`,
              from: month,
              to: month,
            };
          })
        : [];
  // 季度/年度统计额不能借用为某个月的图点；月度窗口就绪前只显示明确的未知占位。
  return {
    ...module,
    periods,
    series: module.series.map((series) => ({
      ...series,
      values: periods.map(() => null),
      ...(series.knownValues ? { knownValues: periods.map(() => null) } : {}),
      ...(series.partial ? { partial: periods.map(() => true) } : {}),
      ...(series.segments
        ? {
            segments: series.segments.map((segment) => ({
              ...segment,
              values: periods.map(() => null),
              ...(segment.projectNames
                ? { projectNames: periods.map(() => null) }
                : {}),
            })),
          }
        : {}),
    })),
  };
}
function chartComparisonFor(module: FinancialAnalysisModule) {
  return displayedChartData.value?.comparison?.modules.find(
    (item) => item.key === module.key,
  );
}

const emptyChartSeries: FinancialAnalysisSeries[] = [];
const emptyChartPeriods: FinancialAnalysisPeriod[] = [];
const personnelPreferredMetrics = ["payrollCost", "knownTotal"];
const outflowPreferredMetrics = ["categoryTotal"];
type ScopeOption = CascaderOption;
const businessScopeOptions = computed(() => {
  const options: ScopeOption[] = [];
  for (const full of data.value?.filterOptions.reimbursementScopes || []) {
    let current = options;
    const segments = full.split(" / ");
    for (let index = 0; index < segments.length; index += 1) {
      const value = segments.slice(0, index + 1).join(" / ");
      let node = current.find((node) => node.value === value);
      if (!node) {
        node = { value, label: segments[index] };
        current.push(node);
      }
      if (index < segments.length - 1) {
        node.children ||= [];
        current = node.children;
      }
    }
  }
  return options;
});

function comparisonFor(module: FinancialAnalysisModule) {
  return data.value?.comparison?.modules.find(
    (item) => item.key === module.key,
  );
}
function comparisonSummary(module: FinancialAnalysisModule, key: string) {
  return comparisonFor(module)?.summaries.find((item) => item.key === key);
}
let requestSequence = 0;
let controller: AbortController | null = null;
let timer: ReturnType<typeof globalThis.setInterval> | null = null;
let disposed = false;
let needsRefresh = false;
let requestedQuery: FinancialAnalysisQuery | null = null;
let chartRequestSequence = 0;
let chartController: AbortController | null = null;
let chartDelay: ReturnType<typeof globalThis.setTimeout> | null = null;
let chartRequestQuery: FinancialAnalysisQuery | null = null;
let chartWindowCache: MonthlyFinancialAnalysisData[] = [];
let balanceYearController: AbortController | null = null;
let balanceYearSequence = 0;

function cancelBalanceYear() {
  balanceYearSequence += 1;
  balanceYearController?.abort();
  balanceYearController = null;
  balanceYearLoading.value = false;
}

async function loadBalanceYear() {
  if (disposed || !props.active || !data.value) return;
  cancelBalanceYear();
  balanceYearModule.value = undefined;
  balanceYearError.value = "";
  const source = data.value;
  const firstMonth = source.query.to.slice(0, 4) + "-01";
  // 服务端余额模块始终附带逐月明细，覆盖当年时直接复用，季度/年度余额不能逐月累加。
  if (source.query.from <= firstMonth) {
    balanceYearModule.value = source.modules.find(
      (module) => module.key === "balances",
    );
    return;
  }
  const query: FinancialAnalysisQuery = {
    from: firstMonth,
    to: source.query.to,
    granularity: "month",
  };
  const sequence = balanceYearSequence;
  const request = new AbortController();
  balanceYearController = request;
  balanceYearLoading.value = true;
  try {
    const result = await getMonthlyFinancialAnalysisWindow(
      query,
      request.signal,
    );
    if (
      disposed ||
      request.signal.aborted ||
      sequence !== balanceYearSequence ||
      data.value !== source
    )
      return;
    if (querySignature(result.query) !== querySignature(query))
      throw new Error("年度余额返回的期间与查询不一致，请重试。");
    balanceYearModule.value = result.modules.find(
      (module) => module.key === "balances",
    );
  } catch (caught) {
    if (disposed || request.signal.aborted || sequence !== balanceYearSequence)
      return;
    const status = (caught as { response?: { status?: number } })?.response
      ?.status;
    if (status === 401 || status === 403) {
      requestSequence += 1;
      controller?.abort();
      controller = null;
      loading.value = false;
      refreshing.value = false;
      clearChartHistory();
      chartData.value = null;
      chartLoading.value = false;
      data.value = null;
      clearChartSelections();
      clearExportFile();
      error.value = "登录或查看权限已失效，已清除之前显示的财务数据。";
    }
    balanceYearError.value = messageFromError(
      caught,
      "年度账户余额读取失败，请重试；未知数据不会按零处理。",
    );
  } finally {
    if (sequence === balanceYearSequence) {
      balanceYearLoading.value = false;
      balanceYearController = null;
    }
  }
}

function cancelChartRequest() {
  chartRequestSequence += 1;
  chartController?.abort();
  chartController = null;
  chartRequestQuery = null;
  if (chartDelay !== null) globalThis.clearTimeout(chartDelay);
  chartDelay = null;
}

function clearChartHistory() {
  cancelChartRequest();
  chartWindowCache = [];
}

function historyQuery(range: MonthWindow, padding?: number) {
  const source = data.value!.query;
  const granularity = isQuarterlyChart.value ? "quarter" : "month";
  const requestedRange =
    padding === undefined
      ? range
      : financialHistoryBufferRange(
          range,
          granularity,
          chartMinMonth.value,
          chartMaxMonth.value,
          source,
          padding,
        );
  return financialWindowQuery(source, requestedRange, granularity);
}

function cachedChartWindow(query: FinancialAnalysisQuery) {
  return chartWindowCache.find((entry) =>
    financialHistoryRangeCovered(entry.query, query),
  );
}

function rememberChartWindow(result: MonthlyFinancialAnalysisData) {
  const signature = querySignature(result.query);
  chartWindowCache = [
    result,
    ...chartWindowCache.filter(
      (entry) => querySignature(entry.query) !== signature,
    ),
  ].slice(0, 4);
}

function historyPermissionsNarrowed(result: MonthlyFinancialAnalysisData) {
  const personnel = (entry: MonthlyFinancialAnalysisData) =>
    [entry.modules, entry.comparison?.modules || []]
      .flat()
      .filter((module) => module.key === "personnel");
  if (
    !personnel(result).some((module) => module.payrollDetailsVisible === false)
  )
    return false;
  return [data.value, chartData.value, ...chartWindowCache].some(
    (entry) =>
      entry &&
      personnel(entry).some((module) => module.payrollDetailsVisible !== false),
  );
}

function scheduleChartPrefetch() {
  if (chartDelay !== null) globalThis.clearTimeout(chartDelay);
  chartDelay = null;
  if (
    disposed ||
    !props.active ||
    !data.value ||
    !isHistoryChart.value ||
    !chartRange.value ||
    chartController
  )
    return;
  // 仍有三期余量时不重复扩窗；到边缘才在后台提前读取前后十二期。
  const nearby = historyQuery(chartRange.value, 3);
  if (cachedChartWindow(nearby)) return;
  chartDelay = globalThis.setTimeout(() => {
    chartDelay = null;
    if (chartRange.value) void loadChartWindow(chartRange.value, true, true);
  }, 350);
}

async function loadChartWindow(
  range: MonthWindow,
  buffered = false,
  prefetch = false,
) {
  if (disposed || !props.active || !data.value || !isHistoryChart.value) return;
  const targetQuery = historyQuery(range);
  const windowQuery = buffered ? historyQuery(range, 12) : targetQuery;
  const cached = cachedChartWindow(prefetch ? windowQuery : targetQuery);
  if (cached) {
    if (!prefetch) {
      chartData.value = cached;
      chartLoading.value = false;
      chartError.value = "";
      scheduleChartPrefetch();
    }
    return;
  }
  // 连续滑动仍落在同一缓冲区时复用在途请求，不能每越过一个月就取消重来。
  if (
    chartRequestQuery &&
    financialHistoryRangeCovered(chartRequestQuery, targetQuery)
  ) {
    if (!prefetch) {
      chartLoading.value = true;
      chartError.value = "";
    }
    return;
  }
  if (prefetch && chartController) return;
  cancelChartRequest();
  const sequence = chartRequestSequence;
  const sourceSignature = querySignature(data.value.query);
  if (querySignature(windowQuery) === sourceSignature) {
    chartData.value = data.value;
    rememberChartWindow(data.value);
    chartLoading.value = false;
    chartError.value = "";
    scheduleChartPrefetch();
    return;
  }
  const request = new AbortController();
  chartController = request;
  chartRequestQuery = windowQuery;
  if (!prefetch) {
    chartLoading.value = true;
    chartError.value = "";
  }
  let succeeded = false;
  try {
    const result = await getMonthlyFinancialAnalysisWindow(
      windowQuery,
      request.signal,
    );
    if (
      disposed ||
      request.signal.aborted ||
      sequence !== chartRequestSequence ||
      !data.value ||
      sourceSignature !== querySignature(data.value.query)
    )
      return;
    if (querySignature(result.query) !== querySignature(windowQuery))
      throw new Error("历史窗口返回的期间与查询不一致，请重试。");
    // 账号降权仍可能合法返回200；已得知工资权限收窄时必须立即丢弃旧高权限快照。
    if (historyPermissionsNarrowed(result)) {
      const authorizedQuery = { ...data.value.query };
      clearChartHistory();
      cancelBalanceYear();
      clearChartSelections();
      clearExportFile();
      balanceYearModule.value = undefined;
      data.value = null;
      chartData.value = null;
      chartLoading.value = false;
      chartError.value = "";
      void loadAnalysis(authorizedQuery);
      return;
    }
    rememberChartWindow(result);
    succeeded = true;
    // 纯预取只入缓存，不能无故替换可见序列、默认指标或刚点开的金额提示。
    if (
      (!prefetch || chartLoading.value) &&
      chartRange.value &&
      financialHistoryRangeCovered(result.query, historyQuery(chartRange.value))
    ) {
      chartData.value = result;
      chartError.value = "";
    }
  } catch (caught) {
    if (disposed || request.signal.aborted || sequence !== chartRequestSequence)
      return;
    const status = (caught as { response?: { status?: number } })?.response
      ?.status;
    if (status === 401 || status === 403) {
      requestSequence += 1;
      controller?.abort();
      controller = null;
      loading.value = false;
      refreshing.value = false;
      clearExportFile();
      data.value = null;
      chartData.value = null;
      chartWindowCache = [];
      cancelBalanceYear();
      balanceYearModule.value = undefined;
      clearChartSelections();
      error.value = "登录或查看权限已失效，已清除之前显示的财务数据。";
    }
    if (
      !prefetch ||
      !data.value ||
      (chartRange.value && !cachedChartWindow(historyQuery(chartRange.value)))
    )
      chartError.value = messageFromError(
        caught,
        "历史月份读取失败，请稍后重新滑动或查询；未知数据不按零处理。",
      );
  } finally {
    if (!disposed && sequence === chartRequestSequence) {
      chartLoading.value = false;
      chartController = null;
      chartRequestQuery = null;
      if (succeeded) scheduleChartPrefetch();
    }
  }
}

function handleChartWindowChange(range: MonthWindow) {
  if (!data.value || !props.active || disposed || !isHistoryChart.value) return;
  let expected: MonthWindow;
  try {
    expected = isQuarterlyChart.value
      ? financialTwelveQuarterRange(range.to, chartMaxMonth.value)
      : financialTwelveMonthRange(range.to);
  } catch {
    return;
  }
  if (
    expected.from !== range.from ||
    expected.to !== range.to ||
    range.from < chartMinMonth.value ||
    range.to > chartMaxMonth.value
  )
    return;
  // 相同受控窗口不重复清理点选或取消读取，错误态仍允许原窗重试。
  if (
    chartRange.value?.from === range.from &&
    chartRange.value.to === range.to &&
    !chartError.value
  )
    return;
  chartRange.value = { ...range };
  clearChartSelections();
  void loadChartWindow(range, true);
}

function refreshChartWindow(
  source: MonthlyFinancialAnalysisData,
  queryChanged: boolean,
) {
  // 新统计响应开启新的缓存代次；旧筛选、权限或业务版本的历史不能沿用。
  clearChartHistory();
  rememberChartWindow(source);
  if (source.query.granularity === "year") {
    // 分期图直接使用同一统计响应，不再发送月度窗口查询或把累计金额放进月份槽位。
    chartRange.value = null;
    chartData.value = source;
    chartLoading.value = false;
    chartError.value = "";
    return;
  }
  if (queryChanged || !chartRange.value) {
    chartData.value = null;
    const end =
      source.query.to < "1900-12" && source.query.granularity === "month"
        ? "1900-12"
        : source.query.to;
    chartRange.value =
      source.query.granularity === "quarter"
        ? financialTwelveQuarterRange(end, source.query.to)
        : financialTwelveMonthRange(end);
  }
  void loadChartWindow(chartRange.value!);
}

function applyWindowToStatistics() {
  if (
    !isHistoryChart.value ||
    !data.value ||
    !chartRange.value ||
    loading.value ||
    chartLoading.value ||
    hasPendingFilters.value
  )
    return;
  const query = financialWindowQuery(
    data.value.query,
    chartRange.value,
    isQuarterlyChart.value ? "quarter" : "month",
  );
  filters.from = query.from;
  filters.to = query.to;
  filters.comparisonYear = query.comparisonYear
    ? String(query.comparisonYear)
    : "";
  submitQuery();
}

function readQuery(): FinancialAnalysisQuery {
  return {
    from: filters.from,
    to: filters.to,
    granularity: filters.granularity,
    ...(filters.partyA ? { partyA: filters.partyA } : {}),
    ...(filters.contractRegion
      ? { contractRegion: filters.contractRegion }
      : {}),
    ...(filters.reimbursementScope
      ? { reimbursementScope: filters.reimbursementScope }
      : {}),
    ...(filters.personId ? { personId: filters.personId } : {}),
    ...(filters.comparisonYear
      ? { comparisonYear: Number(filters.comparisonYear) }
      : {}),
  };
}

function querySignature(query: FinancialAnalysisQuery): string {
  return [
    query.from,
    query.to,
    query.granularity,
    query.partyA || "",
    query.contractRegion || "",
    query.reimbursementScope || "",
    query.personId || "",
    query.comparisonYear || "",
  ].join("\u001f");
}
const hasPendingFilters = computed(
  () =>
    !!data.value &&
    querySignature(readQuery()) !== querySignature(data.value.query),
);
const displayedQueryLabel = computed(() => {
  if (!data.value) return "";
  const query = data.value.query;
  const personName =
    data.value.filterOptions.people.find(
      (person) => person.id === query.personId,
    )?.name || query.personId;
  return [
    `${query.from} 至 ${query.to} · ${granularityLabel(query.granularity)}`,
    query.partyA && `甲方：${query.partyA}`,
    query.contractRegion && `合同区域：${query.contractRegion}`,
    query.reimbursementScope && `商务报销范围：${query.reimbursementScope}`,
    query.personId && `人员：${personName}`,
    data.value.comparison?.label ||
      (query.comparisonYear ? `对比：${query.comparisonYear}年同期` : ""),
  ]
    .filter(Boolean)
    .join("；");
});

function granularityLabel(value: FinancialAnalysisGranularity) {
  return { month: "月度", quarter: "季度", year: "年度" }[value];
}
function formatAmount(value: string | null) {
  return value === null ? "未知／未核算" : formatMonthlyFinancialAmount(value);
}
function displaySummary(value: FinancialAnalysisValue) {
  return value.amount === null
    ? "未知／未核算"
    : value.unit === "个" || value.unit === "组"
      ? `${value.amount}${value.unit}`
      : formatAmount(value.amount);
}
function formatTime(value: string | null) {
  if (!value) return "未提供／未核算";
  const time = new Date(value);
  return Number.isFinite(time.getTime())
    ? time.toLocaleString("zh-CN", { hour12: false })
    : "未提供／未核算";
}
function showStructure(module: FinancialAnalysisModule) {
  if (module.key === "personnel" && module.payrollDetailsVisible === false)
    return false;
  return (
    ["balances", "outflow", "business", "personnel"].includes(module.key) ||
    module.breakdown.length > 0
  );
}

function messageFromError(caught: unknown, fallback: string): string {
  const candidate = caught as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  const message = candidate?.response?.data?.message || candidate?.message;
  return message && /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

async function loadAnalysis(
  query: FinancialAnalysisQuery,
  background = false,
  resetHistoryWindow = false,
) {
  if (disposed || !props.active || (background && loading.value)) return;
  const sequence = ++requestSequence;
  controller?.abort();
  const requestController = new AbortController();
  controller = requestController;
  loading.value = true;
  refreshing.value = background;
  error.value = "";
  needsRefresh = false;
  try {
    const result = await getMonthlyFinancialAnalysis(
      { ...query },
      requestController.signal,
    );
    if (
      disposed ||
      sequence !== requestSequence ||
      requestController.signal.aborted
    )
      return;
    if (historyPermissionsNarrowed(result)) {
      clearChartHistory();
      chartData.value = null;
      clearChartSelections();
      clearExportFile();
      cancelBalanceYear();
      balanceYearModule.value = undefined;
    }
    const previousQuery = data.value?.query;
    if (
      data.value &&
      (querySignature(data.value.query) !== querySignature(result.query) ||
        data.value.dataVersion !== result.dataVersion)
    )
      clearExportFile();
    data.value = result;
    exportError.value = "";
    const queryChanged =
      !previousQuery ||
      querySignature(previousQuery) !== querySignature(result.query);
    if (queryChanged || resetHistoryWindow) {
      clearChartSelections();
    }
    refreshChartWindow(result, queryChanged || resetHistoryWindow);
    void loadBalanceYear();
  } catch (caught) {
    if (
      disposed ||
      sequence !== requestSequence ||
      requestController.signal.aborted
    )
      return;
    const responseStatus = (caught as { response?: { status?: number } })
      ?.response?.status;
    if (responseStatus === 401 || responseStatus === 403) {
      clearExportFile();
      data.value = null;
      clearChartHistory();
      chartData.value = null;
      chartLoading.value = false;
      cancelBalanceYear();
      balanceYearModule.value = undefined;
      clearChartSelections();
    }
    error.value = messageFromError(
      caught,
      background && responseStatus !== 401 && responseStatus !== 403
        ? "当前分析刷新失败，已保留上次结果，请稍后重新查询。"
        : "财务分析加载失败，请检查网络或稍后重试。",
    );
  } finally {
    if (!disposed && sequence === requestSequence) {
      loading.value = false;
      refreshing.value = false;
      controller = null;
      if (needsRefresh && props.active) {
        void loadAnalysis(
          data.value ? { ...data.value.query } : requestedQuery || query,
        );
      }
    }
  }
}

function returnToCurrentMonth(module: FinancialAnalysisModuleKey) {
  if (disposed || !props.active || module !== activeModule.value) return;
  analysisDatePicker.value?.close();
  try {
    // 使用上海业务时区的真实本月，不采用当前选中的历史报表月份。
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    const month = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
    const query = financialWindowQuery(
      readQuery(),
      financialTwelveMonthRange(month),
      "month",
    );
    filters.from = query.from;
    filters.to = query.to;
    filters.granularity = "month";
    filters.comparisonYear =
      query.comparisonYear === undefined ? "" : String(query.comparisonYear);
    requestedQuery = { ...query };
    clearChartHistory();
    cancelBalanceYear();
    chartLoading.value = false;
    chartError.value = "";
    clearChartSelections();
    // 同一统计范围内滑去历史后，也必须把图表窗口强制恢复到本月。
    void loadAnalysis(query, false, true);
  } catch (caught) {
    error.value = messageFromError(
      caught,
      "无法恢复本月范围，请核对日期后重试。",
    );
  }
}

function submitQuery() {
  const query = readQuery();
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/u.test(query.from) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/u.test(query.to)
  ) {
    error.value = "请选择有效的开始和结束月份。";
    return;
  }
  if (query.from > query.to) {
    error.value = "开始月份不能晚于结束月份。";
    return;
  }
  requestedQuery = { ...query };
  void loadAnalysis(query);
}

function selectPersonnel(personId: string) {
  if (
    !props.active ||
    disposed ||
    loading.value ||
    activeModule.value !== "personnel" ||
    !data.value
  )
    return;
  if (!data.value.filterOptions.people.some((person) => person.id === personId))
    return;
  // 点击表格姓名只切换人员，保持当前已显示的统计期间，不顺带提交未查询的日期草稿。
  const query = { ...data.value.query, personId };
  filters.personId = personId;
  requestedQuery = { ...query };
  void loadAnalysis(query);
}

function clearPersonnelSelection() {
  if (
    !props.active ||
    disposed ||
    loading.value ||
    activeModule.value !== "personnel" ||
    !data.value?.query.personId
  )
    return;
  // 仅移除已提交查询的人员条件，保留期间和其他筛选，不顺带提交表单草稿。
  const query = { ...data.value.query };
  delete query.personId;
  filters.personId = "";
  requestedQuery = { ...query };
  void loadAnalysis(query);
}

function clearExportFile() {
  if (exportFile.value) URL.revokeObjectURL(exportFile.value.url);
  exportFile.value = null;
}

async function exportModule(module: FinancialAnalysisModuleKey | "all") {
  if (!data.value || exporting.value) return;
  // 只使用已经显示的响应条件，避免表单新条件与旧图表导出错位。
  const query = { ...data.value.query };
  const dataVersion = data.value.dataVersion;
  exporting.value = module;
  exportError.value = "";
  try {
    const file = await downloadMonthlyFinancialAnalysis(
      query,
      module,
      dataVersion,
    );
    if (disposed) return;
    if (
      !data.value ||
      data.value.dataVersion !== dataVersion ||
      querySignature(data.value.query) !== querySignature(query)
    )
      throw new Error("分析已变化，请按当前已显示结果重新导出。");
    clearExportFile();
    const url = URL.createObjectURL(file.blob);
    // 保留一个可重试的文件链接；立即回收会早于部分浏览器实际接收下载。
    exportFile.value = { module, url, fileName: file.fileName };
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.fileName;
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } catch {
      // 文件已经生成；浏览器拒绝自动点击时保留显式保存入口，不误报文件生成失败。
    } finally {
      anchor.remove();
    }
  } catch (caught) {
    if (!disposed)
      exportError.value = messageFromError(
        caught,
        "财务分析导出失败，请检查访问权限或稍后重试。",
      );
  } finally {
    if (!disposed) exporting.value = "";
  }
}

function refreshIfAvailable() {
  if (
    disposed ||
    !props.active ||
    document.visibilityState !== "visible" ||
    loading.value ||
    chartLoading.value ||
    chartController !== null ||
    balanceYearLoading.value ||
    hasPendingFilters.value
  )
    return;
  if (data.value || requestedQuery) {
    void loadAnalysis(
      data.value ? { ...data.value.query } : requestedQuery!,
      true,
    );
  }
}

watch(
  () => (data.value ? querySignature(data.value.query) : ""),
  () => clearChartSelections(),
);
watch(
  () => props.selectedMonth,
  (month) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) return;
    filters.from = `${month.slice(0, 4)}-01`;
    filters.to = month;
    const reportYear = Number(month.slice(0, 4));
    filters.comparisonYear = reportYear > 1900 ? String(reportYear - 1) : "";
    requestedQuery = readQuery();
    needsRefresh = true;
    if (props.active) submitQuery();
  },
  { immediate: true },
);

watch(
  () => filters.from,
  (month) => {
    const year = Number(month.slice(0, 4));
    if (filters.comparisonYear && Number(filters.comparisonYear) >= year) {
      filters.comparisonYear = year > 1900 ? String(year - 1) : "";
    }
  },
);

watch(
  () => props.active,
  (active) => {
    if (!active) {
      controller?.abort();
      requestSequence += 1;
      controller = null;
      loading.value = false;
      refreshing.value = false;
      needsRefresh = true;
      clearChartSelections();
      clearChartHistory();
      chartLoading.value = false;
      cancelBalanceYear();
      return;
    }
    if (needsRefresh || !data.value) {
      void loadAnalysis(requestedQuery || readQuery());
    }
  },
);
watch(
  () => props.refreshKey,
  () => {
    needsRefresh = true;
    if (props.active && !loading.value) {
      // 月报写操作完成后更新正在展示的范围，不提交尚未确认的新筛选。
      void loadAnalysis(
        data.value ? { ...data.value.query } : requestedQuery || readQuery(),
      );
    }
  },
);
watch([() => props.active, () => !!data.value, analysisPanelElement], () => {
  if (
    (fullscreenActive.value || fullscreenBusy.value) &&
    (!fullscreenElement.value || !fullscreenAllowed(fullscreenElement.value))
  )
    void exitModuleFullscreen(false);
});

onMounted(() => {
  timer = globalThis.setInterval(refreshIfAvailable, 60_000);
  document.addEventListener("fullscreenchange", handleModuleFullscreenChange);
  document.addEventListener("keydown", handleModuleFullscreenKey);
});
onBeforeUnmount(() => {
  disposed = true;
  void exitModuleFullscreen(false);
  document.removeEventListener(
    "fullscreenchange",
    handleModuleFullscreenChange,
  );
  document.removeEventListener("keydown", handleModuleFullscreenKey);
  requestSequence += 1;
  controller?.abort();
  if (timer !== null) globalThis.clearInterval(timer);
  clearChartHistory();
  cancelBalanceYear();
  clearExportFile();
});
</script>

<style scoped>
.financial-analysis-panel {
  min-width: 0;
  color: #213c4f;
}
.module-visualization {
  min-width: 0;
}
.chart-linkage-hint {
  margin: 12px 2px;
  color: #718593;
  font-size: 12px;
  line-height: 1.8;
}
.clear-project-drilldown,
.clear-project-period-drilldown,
.outflow-structure-reset,
.business-structure-reset {
  margin: 8px 0 12px;
  border: 1px solid #c9dde4;
  border-radius: 6px;
  padding: 7px 12px;
  background: #fff;
  color: #247986;
  cursor: pointer;
}
.business-linkage-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.business-selection-scope {
  margin: 0;
  font-size: 12px;
  color: #59717e;
}
.financial-analysis-panel.is-fullscreen,
.financial-analysis-panel:fullscreen {
  position: fixed;
  inset: 0;
  z-index: 4000;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  box-sizing: border-box;
  overflow: auto;
  padding: 22px 26px;
  background: #f5f9fb;
  color: #213c4f;
  overscroll-behavior: contain;
}
.panel-fullscreen-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  height: 60px;
  box-sizing: border-box;
  padding: 8px 0;
  margin-bottom: 14px;
  background: #f5f9fb;
  border-bottom: 1px solid #dce8ed;
}
.panel-fullscreen-header strong {
  display: block;
  font-size: 16px;
  color: #294f65;
}
.panel-fullscreen-header small {
  display: block;
  font-size: 11px;
  color: #708693;
  margin-top: 3px;
}
.financial-analysis-panel.is-fullscreen .analysis-navigation {
  position: sticky;
  top: 60px;
  z-index: 19;
  background: #f5f9fb;
  box-shadow: 0 3px 14px rgb(33 60 79 / 6%);
}
.visualization-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.visualization-actions button {
  min-height: 34px;
  border: 1px solid #c7dce3;
  border-radius: 6px;
  padding: 7px 12px;
  background: #fff;
  color: #356c7a;
  font-size: 12px;
  cursor: pointer;
}
.visualization-actions button[aria-pressed="true"] {
  border-color: #70a8ae;
  background: #edf7f6;
  color: #167d86;
}
.visualization-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.visualization-actions button:focus-visible {
  outline: 2px solid #167d86;
  outline-offset: 2px;
}
.visualization-actions .module-fullscreen-toggle,
.panel-fullscreen-exit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 40px;
  padding: 8px 18px;
  border: 1px solid #c7dfe5;
  border-radius: 10px;
  background: #fff;
  color: #137f8a;
  font-size: 14px;
  line-height: 22px;
  white-space: nowrap;
}
.visualization-actions .module-fullscreen-toggle:hover:not(:disabled) {
  border-color: #79b5be;
  background: #f3fafb;
}
.panel-fullscreen-exit {
  flex-shrink: 0;
  cursor: pointer;
}
.panel-fullscreen-exit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.panel-fullscreen-exit:focus-visible {
  outline: 2px solid #137f8a;
  outline-offset: 2px;
}
.visualization-actions .module-fullscreen-toggle[aria-pressed="true"] {
  border-color: #79b5be;
  background: #edf7f8;
}
.fullscreen-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.fullscreen-message {
  color: #567786;
  font-size: 12px;
  line-height: 1.7;
  margin: 0;
}
@media (max-width: 600px) {
  .financial-analysis-panel.is-fullscreen {
    padding: 12px;
  }
}
.balance-structure-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.balance-structure-toolbar p {
  color: #708693;
  font-size: 12px;
  line-height: 1.7;
  margin: 0;
}
.balance-year-reset {
  padding: 8px 12px;
  border: 1px solid #c7dce3;
  border-radius: 6px;
  background: #fff;
  color: #167d86;
  cursor: pointer;
}
.export-ready {
  padding: 10px 14px;
  border-radius: 6px;
  background: #edf8f4;
  color: #225e4a;
  font-size: 13px;
  line-height: 1.7;
}
.export-ready a {
  color: #12686e;
  text-decoration: underline;
  font-weight: 600;
}
.analysis-header,
.module-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 18px;
}
.analysis-header {
  margin-bottom: 14px;
}
.analysis-header h2 {
  margin: 3px 0 8px;
  font-size: 22px;
}
.analysis-header p,
.module-heading p {
  margin: 0;
  color: #6e808e;
  font-size: 13px;
  line-height: 1.7;
}
.analysis-header .analysis-kicker {
  color: #278a8e;
  font-size: 11px;
  font-weight: 650;
}
button,
input,
select {
  box-sizing: border-box;
  font: inherit;
}
button {
  cursor: pointer;
  padding: 8px 13px;
  border: 1px solid #d7e2e8;
  border-radius: 6px;
  background: #fff;
  color: #32627a;
  font-size: 12px;
  white-space: nowrap;
}
button:hover:not(:disabled) {
  border-color: #16848a;
  background: #eff8f8;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
summary:focus-visible {
  outline: 2px solid #16848a;
  outline-offset: 3px;
}
.primary-button {
  border-color: #147d85;
  background: #147d85;
  color: #fff;
}
.primary-button:hover:not(:disabled) {
  background: #106972;
  color: #fff;
}
.analysis-filters {
  --financial-filter-control-height: 56px;
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: 12px;
  padding: 14px;
  border-radius: 8px;
  border: 1px solid #dce8ed;
  background: #f6f9fb;
}
.date-range-field {
  flex: 2 1 320px;
  min-width: 236px;
}
.analysis-filters > label {
  display: flex;
  flex: 1 1 130px;
  min-width: 90px;
  flex-direction: column;
  gap: 7px;
  color: #536d7d;
  font-size: 12px;
  line-height: 24px;
}
.analysis-filters > .business-filter {
  flex-basis: 150px;
  min-width: 110px;
}
.analysis-filters input,
.analysis-filters select {
  width: 100%;
  min-width: 0;
  height: var(--financial-filter-control-height);
  line-height: normal;
  padding: 6px 8px;
  border: 1px solid #d1dfe6;
  border-radius: 5px;
  color: #294e63;
  background: #fff;
}
.analysis-filters > .business-filter :deep(.el-cascader) {
  --el-input-height: var(--financial-filter-control-height);
  width: 100%;
  min-width: 0;
  height: var(--financial-filter-control-height);
}
.analysis-filters > .business-filter :deep(.el-cascader .el-input),
.analysis-filters > .business-filter :deep(.el-cascader .el-input__wrapper) {
  width: 100%;
  min-height: var(--financial-filter-control-height);
  height: var(--financial-filter-control-height);
  box-sizing: border-box;
}
.query-button {
  flex: 0 0 auto;
  min-width: 80px;
  align-self: end;
  height: var(--financial-filter-control-height);
  display: flex;
  align-items: center;
  justify-content: center;
}
.filter-explanation {
  margin: 10px 0 18px;
  color: #80909c;
  font-size: 11px;
  line-height: 1.8;
}
.displayed-query {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 22px;
  padding: 10px 2px;
  background: transparent;
  font-size: 12px;
}
.displayed-query strong {
  font-weight: 600;
}
.displayed-query span,
.displayed-query small {
  color: #6e8593;
}
.pending-filter-note {
  margin: 2px 0 0;
  width: 100%;
  color: #996620;
}
.analysis-alert {
  margin: 12px 0;
  padding: 12px 15px 12px 29px;
  border-radius: 6px;
  background: #fff8e9;
  color: #8b672b;
  font-size: 12px;
  line-height: 1.8;
}
.analysis-alert.is-error {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-left: 15px;
  background: #fff0ee;
  color: #a8493a;
}
.analysis-navigation {
  display: flex;
  overflow-x: auto;
  gap: 6px;
  margin: 16px 0 0;
  padding-bottom: 2px;
  border-bottom: 1px solid #dce6eb;
}
.analysis-navigation button {
  flex: 1 0 auto;
  padding: 10px 13px;
  border: 0;
  border-radius: 6px 6px 0 0;
  color: #417287;
  text-decoration: none;
  background: #eff5f7;
  font-size: 12px;
}
.analysis-navigation button.is-active {
  color: #fff;
  background: #147d85;
  font-weight: 650;
}
.analysis-module {
  scroll-margin-top: 16px;
  margin-top: 14px;
  padding: 18px;
  border: 1px solid #dce6ec;
  border-radius: 12px;
  background: #fff;
  box-shadow: none;
}
.module-heading h3 {
  margin: 0 0 7px;
  font-size: 17px;
  color: #1f495f;
}
.analysis-summary .summary-partial-note {
  color: #856527;
}
.analysis-summaries {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin: 14px 0;
}
.analysis-summary {
  padding: 11px 13px;
  border-radius: 7px;
  background: #f4f8fa;
  min-width: 0;
}
.analysis-summary span {
  display: block;
  margin-bottom: 7px;
  color: #6b8291;
  font-size: 12px;
}
.analysis-summary strong {
  display: block;
  color: #294d63;
  font-size: 17px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.analysis-summary .is-unknown {
  color: #8c969e;
  font-size: 15px;
}
.analysis-summary small {
  display: block;
  margin-top: 7px;
  color: #8c9ba5;
  font-size: 10px;
  line-height: 1.5;
}
.analysis-module[data-module="balances"] .analysis-summaries {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
.module-chart-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  margin-top: 14px;
}
.module-chart-row.has-both-charts {
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
}
.module-main-charts {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.window-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #d9e8ee;
  border-radius: 8px;
  background: #f5fafc;
}
.window-toolbar strong {
  display: block;
  color: #31596d;
  font-size: 13px;
}
.window-toolbar small {
  display: block;
  margin-top: 5px;
  color: #6d8392;
  font-size: 11px;
  line-height: 1.65;
}
.structure-panel {
  min-width: 0;
}
.structure-scope {
  margin: 0 0 8px;
  color: #37576b;
  font-size: 12px;
  font-weight: 600;
}
.structure-note {
  margin: 9px 2px 0;
  color: #8b672b;
  font-size: 11px;
  line-height: 1.7;
}
.analysis-notes {
  margin-top: 12px;
  border: 1px solid #e3e9ed;
  border-radius: 6px;
  overflow: hidden;
}
.analysis-notes summary {
  padding: 9px 12px;
  background: #fafcfd;
}
.analysis-notes summary span {
  margin-left: 12px;
  color: #8a99a5;
  font-weight: 400;
  font-size: 11px;
}
.analysis-notes .analysis-alert {
  margin: 0;
  border-radius: 0;
}
.global-notes {
  margin-top: 0;
}
summary {
  cursor: pointer;
  padding: 12px 14px;
  color: #39677f;
  background: #f6f9fb;
  font-size: 12px;
}
.analysis-loading,
.analysis-empty {
  padding: 17px;
  color: #7c929f;
  text-align: center;
  font-size: 13px;
}
@media (max-width: 1100px) {
  .module-chart-row.has-both-charts {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 1000px) {
  .analysis-filters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .analysis-filters > label,
  .analysis-filters > .business-filter {
    min-width: 0;
  }
  .date-range-field {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .query-button {
    grid-column: 1 / -1;
  }
}
@media (max-width: 720px) {
  .analysis-header,
  .module-heading {
    flex-direction: column;
    gap: 13px;
  }
  .analysis-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 13px;
  }
  .query-button {
    grid-column: 1 / -1;
  }
  .analysis-module {
    padding: 14px;
  }
  .analysis-summaries {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .analysis-module[data-module="balances"] .analysis-summaries {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .analysis-module[data-module="balances"] .analysis-summary:last-child {
    grid-column: 1 / -1;
  }
  .analysis-summary strong {
    font-size: 15px;
  }
}
@media (max-width: 430px) {
  .analysis-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .analysis-summaries,
  .analysis-module[data-module="balances"] .analysis-summaries {
    grid-template-columns: 1fr;
  }
}
</style>
