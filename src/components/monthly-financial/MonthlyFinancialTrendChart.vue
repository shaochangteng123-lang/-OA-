<template>
  <section
    ref="cardRef"
    class="financial-trend-card"
    :class="{ 'is-fullscreen': isFullscreen }"
    aria-labelledby="financial-trend-title"
  >
    <header class="trend-heading">
      <div>
        <span class="trend-kicker">{{
          yearComparison ? "年度同比趋势" : "完整历史趋势"
        }}</span>
        <h2 id="financial-trend-title">月度财务趋势</h2>
        <p>
          {{
            yearComparison
              ? "连续时间轴叠加上年同期，拖动或滚轮时两条线同步跨年移动。"
              : "按连续自然月展示完整历史，可拖动或滚轮查看更早月份。"
          }}
        </p>
      </div>

      <div class="trend-heading-actions">
        <div class="trend-selectors">
          <label v-if="!fullHistory" class="view-year-select">
            <span>查看年度</span>
            <el-select
              :model-value="selectedYear"
              :disabled="loading || selectedYearOptions.length === 0"
              :teleported="!isFullscreen"
              placeholder="选择年度"
              aria-label="选择查看年度"
              @change="handleSelectedYearChange"
            >
              <el-option
                v-for="year in selectedYearOptions"
                :key="year"
                :label="`${year}年`"
                :value="year"
              />
            </el-select>
          </label>

          <label v-if="isMainBusinessMetric" class="region-select">
            <span>行政区</span>
            <el-select
              :model-value="activeRegion"
              :teleported="!isFullscreen"
              placeholder="选择行政区"
              aria-label="选择主营业务行政区"
              @change="handleRegionChange"
            >
              <el-option label="全部区域" value="all" />
              <el-option
                v-for="region in regionOptions"
                :key="region"
                :label="region"
                :value="region"
              />
            </el-select>
          </label>

          <label v-if="!fullHistory" class="view-month-select">
            <span>查看月份</span>
            <el-select
              :model-value="
                activeMonthIndex === null ? null : activeMonthIndex + 1
              "
              :teleported="!isFullscreen"
              placeholder="选择月份"
              aria-label="选择查看月份"
              @change="handleViewMonthChange"
            >
              <el-option
                v-for="monthNumber in monthNumbers"
                :key="monthNumber"
                :label="`${monthNumber}月`"
                :value="monthNumber"
              />
            </el-select>
          </label>

          <label v-if="!fullHistory" class="history-year-select">
            <span>历史对比</span>
            <el-select
              :model-value="comparisonYear"
              :disabled="loading || historyYearOptions.length === 0"
              :teleported="!isFullscreen"
              placeholder="暂无历史年度"
              aria-label="选择历史对比年度"
              @change="handleComparisonYearChange"
            >
              <el-option
                v-for="year in historyYearOptions"
                :key="year"
                :label="`${year}年`"
                :value="year"
              />
            </el-select>
          </label>
        </div>

        <button
          type="button"
          class="history-mode-toggle"
          :class="{ 'is-active': yearComparison }"
          :aria-pressed="yearComparison"
          :aria-label="yearComparison ? '关闭年度对比' : '开启年度对比'"
          @click="emit('year-comparison-change', !yearComparison)"
        >
          {{ yearComparison ? "关闭年度对比" : "年度对比" }}
        </button>

        <button
          type="button"
          class="fullscreen-toggle"
          :aria-label="
            isFullscreen ? '退出月度财务趋势全屏' : '全屏查看月度财务趋势'
          "
          :aria-pressed="isFullscreen"
          :title="isFullscreen ? '退出全屏' : '全屏查看'"
          @click="toggleFullscreen"
        >
          <FullScreen aria-hidden="true" />
          <span>{{ isFullscreen ? "退出全屏" : "全屏查看" }}</span>
        </button>
      </div>
    </header>

    <div v-if="fullscreenError" class="fullscreen-error" role="alert">
      {{ fullscreenError }}
    </div>

    <div class="metric-switch" role="group" aria-label="选择趋势指标">
      <button
        v-for="metric in metricOptions"
        :key="metric.key"
        type="button"
        :class="{ 'is-active': activeMetricKey === metric.key }"
        :aria-pressed="activeMetricKey === metric.key"
        @click="activeMetricKey = metric.key"
      >
        {{ metric.label }}
      </button>
    </div>

    <div class="trend-context">
      <div class="trend-legend" aria-label="折线图图例">
        <span>
          <i class="legend-line legend-line--selected" aria-hidden="true"></i>
          {{ fullHistoryRangeLabel }}（实际月份）
        </span>
        <span v-if="yearComparison">
          <i class="legend-line legend-line--history" aria-hidden="true"></i>
          上年同期（随窗口同步移动）
        </span>
        <span class="current-value-legend">
          <i aria-hidden="true"></i>
          空心点表示当前值（未月结）
        </span>
        <span v-if="isMainBusinessMetric" class="confirmed-source-legend">
          <i aria-hidden="true"></i>
          {{ mainBusinessSourceLegend }}
        </span>
      </div>
      <p>{{ activeMetric.note }}</p>
    </div>

    <div v-if="warningText" class="trend-warning" role="status">
      {{ warningText }}
    </div>

    <div v-if="loading" class="trend-loading" aria-label="趋势数据加载中">
      <el-skeleton :rows="7" animated />
    </div>

    <div v-else-if="error" class="trend-state trend-state--error">
      <strong>趋势数据加载失败</strong>
      <p>{{ error }}</p>
      <el-button type="primary" plain @click="emit('retry')">
        重新加载趋势
      </el-button>
    </div>

    <div v-else-if="!hasData" class="trend-state">
      <div class="empty-chart-mark" aria-hidden="true">
        <i></i><i></i><i></i><i></i>
      </div>
      <strong>所选年度暂无{{ activeMetric.label }}数据</strong>
      <p>
        {{
          isMainBusinessMetric
            ? "系统将在合同台账出现对应主营业务数据后显示趋势点。"
            : "生成并保存月度财务报表后，系统将在对应月份显示趋势点。"
        }}
      </p>
    </div>

    <template v-else>
      <template v-if="fullHistory">
        <div ref="canvasRef" class="full-history-shell">
          <div
            class="full-history-y-axis"
            :style="{ height: `${viewHeight}px` }"
            aria-hidden="true"
          >
            <span
              v-for="tick in fullHistoryYTicks"
              :key="tick.value"
              :style="{ top: `${tick.y - 8}px` }"
            >
              {{ formatAxisValue(tick.value) }}
            </span>
          </div>
          <div
            ref="historyScrollRef"
            class="full-history-scroll"
            :class="{ 'is-dragging': historyDragging }"
            role="region"
            tabindex="0"
            aria-label="完整历史月份横向浏览区，可拖动、滚轮或使用方向键查看"
            @pointerdown="handleHistoryPointerDown"
            @pointermove="handleHistoryPointerMove"
            @pointerup="finishHistoryPointer"
            @pointercancel="finishHistoryPointer"
            @wheel="handleHistoryWheel"
            @scroll="handleHistoryScroll"
            @keydown="handleHistoryKeydown"
          >
            <svg
              class="trend-svg full-history-svg"
              :viewBox="`0 0 ${fullHistoryCanvasWidth} ${viewHeight}`"
              :style="{
                width: `${fullHistoryCanvasWidth}px`,
                height: `${viewHeight}px`,
              }"
              preserveAspectRatio="none"
              role="img"
              :aria-label="fullHistoryAriaLabel"
            >
              <g class="grid-lines" aria-hidden="true">
                <line
                  v-for="tick in fullHistoryYTicks"
                  :key="tick.value"
                  :class="{ 'is-zero': isZero(tick.value) }"
                  :x1="fullHistoryPlotLeft"
                  :x2="fullHistoryPlotRight"
                  :y1="tick.y"
                  :y2="tick.y"
                  vector-effect="non-scaling-stroke"
                />
              </g>

              <g class="full-history-month-grid" aria-hidden="true">
                <template v-for="point in fullHistoryAxis" :key="point.month">
                  <line
                    :class="{ 'is-year-boundary': point.month.endsWith('-01') }"
                    :x1="getFullHistoryX(point.index)"
                    :x2="getFullHistoryX(point.index)"
                    :y1="plotTop"
                    :y2="plotBottom"
                    vector-effect="non-scaling-stroke"
                  />
                  <text
                    :x="getFullHistoryX(point.index)"
                    :y="plotBottom + 28"
                    text-anchor="middle"
                  >
                    {{ formatFullHistoryMonth(point.month) }}
                  </text>
                </template>
              </g>

              <g class="month-hit-areas" aria-hidden="true">
                <rect
                  v-for="point in fullHistoryAxis"
                  :key="point.month"
                  :x="getFullHistoryX(point.index) - 37"
                  :y="plotTop"
                  width="74"
                  :height="plotBottom - plotTop"
                  @click="selectFullHistoryMonth(point.month)"
                />
              </g>

              <g v-if="fullHistoryActiveAxisPoint" class="active-month-guide">
                <line
                  :x1="getFullHistoryX(fullHistoryActiveAxisPoint.index)"
                  :x2="getFullHistoryX(fullHistoryActiveAxisPoint.index)"
                  :y1="plotTop"
                  :y2="plotBottom"
                  vector-effect="non-scaling-stroke"
                />
              </g>

              <g
                v-if="yearComparison"
                class="trend-series is-history year-comparison-series"
              >
                <line
                  v-for="edge in fullHistoryComparisonEdges"
                  :key="`comparison-${edge.fromMonth}-${edge.toMonth}`"
                  class="series-edge"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                  stroke="#7686a1"
                  vector-effect="non-scaling-stroke"
                />
                <g
                  v-for="point in fullHistoryComparisonPlottedPoints"
                  :key="`comparison-${point.month}`"
                  class="series-point-group is-history"
                  :class="{
                    'is-active':
                      fullHistoryActiveAxisPoint?.month === point.month,
                  }"
                  role="button"
                  tabindex="0"
                  :aria-label="fullHistoryComparisonPointAriaLabel(point)"
                  @click.stop="selectFullHistoryMonth(point.month)"
                  @focus="selectFullHistoryMonth(point.month)"
                  @keydown.enter.prevent="selectFullHistoryMonth(point.month)"
                  @keydown.space.prevent="selectFullHistoryMonth(point.month)"
                >
                  <circle
                    v-if="fullHistoryActiveAxisPoint?.month === point.month"
                    class="point-halo"
                    :cx="point.x"
                    :cy="point.y"
                    r="10"
                    fill="#7686a1"
                  />
                  <circle
                    class="point-hit-area"
                    :cx="point.x"
                    :cy="point.y"
                    r="14"
                  />
                  <rect
                    v-if="point.isConfirmedSource || point.isLedgerSource"
                    class="series-point series-point--confirmed-source"
                    :x="point.x - 4.5"
                    :y="point.y - 4.5"
                    width="9"
                    height="9"
                    rx="2"
                    fill="#7686a1"
                    stroke="#7686a1"
                    vector-effect="non-scaling-stroke"
                  />
                  <circle
                    v-else
                    class="series-point"
                    :cx="point.x"
                    :cy="point.y"
                    r="4.5"
                    :fill="point.isCurrent ? '#ffffff' : '#7686a1'"
                    stroke="#7686a1"
                    vector-effect="non-scaling-stroke"
                  />
                </g>
              </g>

              <g class="trend-series">
                <line
                  v-for="edge in fullHistoryEdges"
                  :key="`${edge.fromMonth}-${edge.toMonth}`"
                  class="series-edge"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                  stroke="#167c84"
                  vector-effect="non-scaling-stroke"
                />
                <g
                  v-for="point in fullHistoryPlottedPoints"
                  :key="point.month"
                  class="series-point-group"
                  :class="{
                    'is-active':
                      fullHistoryActiveAxisPoint?.month === point.month,
                    'is-current': point.isCurrent,
                    'is-confirmed-source': point.isConfirmedSource,
                    'is-ledger-source': point.isLedgerSource,
                  }"
                  role="button"
                  tabindex="0"
                  :aria-label="fullHistoryPointAriaLabel(point)"
                  @click.stop="selectFullHistoryMonth(point.month)"
                  @focus="selectFullHistoryMonth(point.month)"
                  @keydown.enter.prevent="selectFullHistoryMonth(point.month)"
                  @keydown.space.prevent="selectFullHistoryMonth(point.month)"
                >
                  <circle
                    v-if="fullHistoryActiveAxisPoint?.month === point.month"
                    class="point-halo"
                    :cx="point.x"
                    :cy="point.y"
                    r="10"
                    fill="#167c84"
                  />
                  <circle
                    class="point-hit-area"
                    :cx="point.x"
                    :cy="point.y"
                    r="14"
                  />
                  <rect
                    v-if="point.isConfirmedSource || point.isLedgerSource"
                    class="series-point series-point--confirmed-source"
                    :x="point.x - 4.5"
                    :y="point.y - 4.5"
                    width="9"
                    height="9"
                    rx="2"
                    fill="#167c84"
                    stroke="#167c84"
                    vector-effect="non-scaling-stroke"
                  />
                  <circle
                    v-else
                    class="series-point"
                    :cx="point.x"
                    :cy="point.y"
                    r="4.5"
                    :fill="point.isCurrent ? '#ffffff' : '#167c84'"
                    stroke="#167c84"
                    vector-effect="non-scaling-stroke"
                  />
                </g>
              </g>

              <g class="point-value-label-layer" aria-hidden="true">
                <g
                  v-for="label in fullHistoryPointValueLabels"
                  :key="label.key"
                  class="point-value-label-group full-history-point-value"
                  :data-month="label.month"
                  :data-series="label.series"
                >
                  <rect
                    class="point-value-label-bg"
                    :x="label.boxX"
                    :y="label.boxY"
                    :width="label.boxWidth"
                    :height="label.boxHeight"
                    :stroke="label.color"
                    rx="5"
                  />
                  <text
                    class="point-value-label"
                    :class="{ 'is-history': label.history }"
                    :x="label.x"
                    :y="label.y"
                    :text-anchor="label.anchor"
                    :fill="label.color"
                  >
                    {{ label.text }}
                  </text>
                </g>
              </g>
            </svg>
          </div>
        </div>

        <p class="full-history-hint">
          窗口始终显示连续 12
          个月；按住鼠标左右拖动或使用滚轮可直接跨年浏览，松手后自动吸附到整月；键盘方向键逐月查看，Home（首位）／End（末位）跳到首尾月份。
        </p>

        <div
          v-if="fullHistoryActiveAxisPoint"
          class="month-inspector full-history-inspector"
          :class="{ 'has-comparison': yearComparison }"
          aria-live="polite"
        >
          <div class="inspector-heading">
            <span>当前查看</span>
            <strong>{{ fullHistoryActiveAxisPoint.month }}</strong>
          </div>
          <article>
            <span>
              <i style="background: #167c84" aria-hidden="true"></i>
              本期 {{ fullHistoryActiveAxisPoint.month }} ·
              {{ activeMetric.label }}
            </span>
            <strong>
              {{ formatMetricValue(fullHistoryActiveAxisPoint.value) }}
            </strong>
            <small :class="fullHistoryActiveStateClass">
              {{ fullHistoryActiveStateLabel }}
            </small>
          </article>
          <article v-if="yearComparison" class="is-history">
            <span>
              <i style="background: #7686a1" aria-hidden="true"></i>
              上年同期 {{ fullHistoryComparisonActiveMonth }} ·
              {{ activeMetric.label }}
            </span>
            <strong>
              {{
                formatMetricValue(fullHistoryComparisonActiveAxisPoint?.value)
              }}
            </strong>
            <small :class="fullHistoryComparisonActiveStateClass">
              {{ fullHistoryComparisonActiveStateLabel }}
            </small>
          </article>
        </div>
      </template>

      <template v-else>
        <div ref="canvasRef" class="trend-canvas">
          <svg
            class="trend-svg"
            :viewBox="`0 0 ${viewWidth} ${viewHeight}`"
            :style="{ height: `${viewHeight}px` }"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            :aria-label="chartAriaLabel"
          >
            <g class="grid-lines" aria-hidden="true">
              <template v-for="tick in yTicks" :key="tick.value">
                <line
                  :class="{ 'is-zero': isZero(tick.value) }"
                  :x1="plotLeft"
                  :x2="plotRight"
                  :y1="tick.y"
                  :y2="tick.y"
                  vector-effect="non-scaling-stroke"
                />
                <text :x="plotLeft - 10" :y="tick.y + 4" text-anchor="end">
                  {{ formatAxisValue(tick.value) }}
                </text>
              </template>
            </g>

            <g class="month-labels" aria-hidden="true">
              <text
                v-for="monthIndex in visibleMonthIndexes"
                :key="monthIndex"
                :x="getX(monthIndex)"
                :y="plotBottom + 28"
                text-anchor="middle"
              >
                {{ monthIndex + 1 }}月
              </text>
            </g>

            <g class="month-hit-areas" aria-hidden="true">
              <rect
                v-for="band in hoverBands"
                :key="band.index"
                :x="band.x"
                :y="plotTop"
                :width="band.width"
                :height="plotBottom - plotTop"
                @mouseenter="selectMonth(band.index)"
                @click="selectMonth(band.index)"
              />
            </g>

            <g v-if="activeMonthIndex !== null" class="active-month-guide">
              <line
                :x1="getX(activeMonthIndex)"
                :x2="getX(activeMonthIndex)"
                :y1="plotTop"
                :y2="plotBottom"
                vector-effect="non-scaling-stroke"
              />
              <rect
                :x="getX(activeMonthIndex) - 22"
                :y="plotBottom + 10"
                width="44"
                height="22"
                rx="7"
              />
              <text
                :x="getX(activeMonthIndex)"
                :y="plotBottom + 25"
                text-anchor="middle"
              >
                {{ activeMonthIndex + 1 }}月
              </text>
            </g>

            <g
              v-for="series in plottedSeries"
              :key="series.key"
              class="trend-series"
              :class="{ 'is-history': series.history }"
            >
              <line
                v-for="edge in series.edges"
                :key="`${series.key}-${edge.fromIndex}-${edge.toIndex}`"
                class="series-edge"
                :x1="edge.x1"
                :y1="edge.y1"
                :x2="edge.x2"
                :y2="edge.y2"
                :stroke="series.color"
                vector-effect="non-scaling-stroke"
              />

              <g
                v-for="point in series.points"
                :key="`${series.key}-${point.index}`"
                class="series-point-group"
                :class="{
                  'is-active': activeMonthIndex === point.index,
                  'is-current': point.isCurrent,
                  'is-confirmed-source': point.isConfirmedSource,
                  'is-ledger-source': point.isLedgerSource,
                }"
                role="button"
                tabindex="0"
                :aria-label="pointAriaLabel(series, point)"
                @mouseenter="selectMonth(point.index)"
                @focus="selectMonth(point.index)"
                @click="selectMonth(point.index)"
                @keydown.enter.prevent="selectMonth(point.index)"
                @keydown.space.prevent="selectMonth(point.index)"
              >
                <circle
                  v-if="activeMonthIndex === point.index"
                  class="point-halo"
                  :cx="point.x"
                  :cy="point.y"
                  r="10"
                  :fill="series.color"
                />
                <circle
                  class="point-hit-area"
                  :cx="point.x"
                  :cy="point.y"
                  r="13"
                />
                <rect
                  v-if="point.isConfirmedSource || point.isLedgerSource"
                  class="series-point series-point--confirmed-source"
                  :x="point.x - (activeMonthIndex === point.index ? 5.5 : 4.5)"
                  :y="point.y - (activeMonthIndex === point.index ? 5.5 : 4.5)"
                  :width="activeMonthIndex === point.index ? 11 : 9"
                  :height="activeMonthIndex === point.index ? 11 : 9"
                  rx="2"
                  :fill="series.color"
                  :stroke="series.color"
                  vector-effect="non-scaling-stroke"
                >
                  <title>{{ pointAriaLabel(series, point) }}</title>
                </rect>
                <circle
                  v-else
                  class="series-point"
                  :cx="point.x"
                  :cy="point.y"
                  :r="activeMonthIndex === point.index ? 5.5 : 4.2"
                  :fill="point.isCurrent ? '#ffffff' : series.color"
                  :stroke="series.color"
                  vector-effect="non-scaling-stroke"
                >
                  <title>{{ pointAriaLabel(series, point) }}</title>
                </circle>
              </g>
            </g>

            <g class="point-value-label-layer" aria-hidden="true">
              <g
                v-for="label in pointValueLabels"
                :key="label.key"
                class="point-value-label-group"
              >
                <rect
                  class="point-value-label-bg"
                  :x="label.boxX"
                  :y="label.boxY"
                  :width="label.boxWidth"
                  :height="label.boxHeight"
                  :stroke="label.color"
                  rx="5"
                />
                <text
                  class="point-value-label"
                  :class="{ 'is-history': label.history }"
                  :x="label.x"
                  :y="label.y"
                  :text-anchor="label.anchor"
                  :fill="label.color"
                >
                  {{ label.text }}
                </text>
              </g>
            </g>
          </svg>
        </div>

        <div
          v-if="activeMonthDetail"
          class="month-inspector"
          aria-live="polite"
        >
          <div class="inspector-heading">
            <span>当前查看</span>
            <strong>{{ activeMonthDetail.label }}</strong>
          </div>
          <article
            v-for="detail in activeMonthDetail.years"
            :key="detail.year"
            :class="{ 'is-history': detail.history }"
          >
            <span>
              <i :style="{ background: detail.color }" aria-hidden="true"></i>
              {{ detail.year }}年
            </span>
            <strong>{{ formatMetricValue(detail.value) }}</strong>
            <small :class="`is-${detail.state}`">{{ detail.stateLabel }}</small>
          </article>
        </div>
      </template>
    </template>

    <footer class="trend-footer">
      <span>趋势值来自服务端精准数据，前端不做估算。</span>
      <span>当前窗口全部有效月份显示精准值，点选月份可查看完整状态。</span>
      <span>明确零值参与连线，只有未知值保持断点。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { FullScreen } from "@element-plus/icons-vue";
import {
  addFinancialAmountTexts,
  formatMonthlyFinancialAmount,
} from "@/utils/monthlyFinancialReportPresentation";
import type {
  MonthlyFinancialAmount,
  MonthlyFinancialMainBusinessTrendPoint,
  MonthlyFinancialTrendPoint,
  MonthlyFinancialTrendWarning,
} from "@/types/monthlyFinancialReport";

type TrendMetricKey =
  | "closingTotal"
  | "actualReceipt"
  | "settlementInflow"
  | "totalOutflow"
  | "netChange"
  | "mainContractAmount"
  | "mainContractCount";

type TrendDisplayState =
  | "closed"
  | "current"
  | "confirmed_source"
  | "ledger_source"
  | null;

interface TrendMetricOption {
  key: TrendMetricKey;
  label: string;
  note: string;
  unit: "amount" | "count";
}

interface RawSeriesPoint {
  index: number;
  value: MonthlyFinancialAmount;
  numericValue: number;
  source: MonthlyFinancialTrendPoint;
  valueState: TrendDisplayState;
}

interface RawSeries {
  key: string;
  year: number;
  color: string;
  history: boolean;
  points: RawSeriesPoint[];
}

interface PlottedSeriesPoint extends RawSeriesPoint {
  x: number;
  y: number;
  isCurrent: boolean;
  isConfirmedSource: boolean;
  isLedgerSource: boolean;
}

interface PlottedSeries extends Omit<RawSeries, "points"> {
  points: PlottedSeriesPoint[];
  edges: Array<{
    fromIndex: number;
    toIndex: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
}

interface PointValueLabelLayout {
  key: string;
  text: string;
  color: string;
  history: boolean;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  boxX: number;
  boxY: number;
  boxWidth: number;
  boxHeight: number;
  month?: string;
  series?: "current" | "comparison";
}

interface FullHistoryAxisPoint {
  month: string;
  index: number;
  source: MonthlyFinancialTrendPoint;
  value: MonthlyFinancialAmount | null;
  numericValue: number | null;
  valueState: TrendDisplayState;
}

interface FullHistoryPlottedPoint extends FullHistoryAxisPoint {
  value: MonthlyFinancialAmount;
  numericValue: number;
  x: number;
  y: number;
  isCurrent: boolean;
  isConfirmedSource: boolean;
  isLedgerSource: boolean;
}

interface FullHistoryComparisonAxisPoint extends FullHistoryAxisPoint {
  comparisonMonth: string;
}

interface FullHistoryComparisonPlottedPoint extends FullHistoryPlottedPoint {
  comparisonMonth: string;
}

const props = withDefaults(
  defineProps<{
    selectedYear: number;
    selectedMonth?: string;
    fullHistory?: boolean;
    yearComparison?: boolean;
    comparisonYear?: number | null;
    availableYears?: number[];
    points?: MonthlyFinancialTrendPoint[];
    warnings?: MonthlyFinancialTrendWarning[];
    mainBusinessRegions?: string[];
    mainBusinessPoints?: MonthlyFinancialMainBusinessTrendPoint[];
    loading?: boolean;
    error?: string;
  }>(),
  {
    selectedMonth: "",
    fullHistory: false,
    yearComparison: false,
    comparisonYear: null,
    availableYears: () => [],
    points: () => [],
    warnings: () => [],
    mainBusinessRegions: () => [],
    mainBusinessPoints: () => [],
    loading: false,
    error: "",
  },
);

const emit = defineEmits<{
  "comparison-year-change": [year: number | null];
  "selected-year-change": [year: number];
  "full-history-change": [enabled: boolean];
  "year-comparison-change": [enabled: boolean];
  retry: [];
}>();

const metricOptions: TrendMetricOption[] = [
  {
    key: "closingTotal",
    label: "期末资金",
    note: "四账户期末余额合计；已月结月份显示月结值，未月结月份显示当前值（未月结）。",
    unit: "amount",
  },
  {
    key: "actualReceipt",
    label: "主营实际到账",
    note: "仅统计已确认的主营业务银行实际回款；历史月份即使尚未建立月报，也直接显示合同已确认回款，不等同于四账户结算流入。",
    unit: "amount",
  },
  {
    key: "settlementInflow",
    label: "四账户结算流入",
    note: "一般、商务及两个福利账户的当月结算流入合计。",
    unit: "amount",
  },
  {
    key: "totalOutflow",
    label: "四账户结算流出",
    note: "一般、商务及两个福利账户的当月结算流出合计。",
    unit: "amount",
  },
  {
    key: "netChange",
    label: "四账户净变化",
    note: "四账户结算流入－四账户结算流出＝期末资金－期初资金；不等于主营实际到账－结算流出，也不代表利润。",
    unit: "amount",
  },
  {
    key: "mainContractAmount",
    label: "新增主营合同额",
    note: "按主合同签订月份汇总当前有效合同额；补充或终止会按当前合同台账重述历史月份。",
    unit: "amount",
  },
  {
    key: "mainContractCount",
    label: "新增主营合同数",
    note: "按主合同签订月份统计主合同链数量；补充及终止协议不重复计数。",
    unit: "count",
  },
];

const activeMetricKey = ref<TrendMetricKey>("closingTotal");
const activeMonthIndex = ref<number | null>(null);
const activeRegion = ref("all");
const monthNumbers = Array.from({ length: 12 }, (_item, index) => index + 1);
const cardRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLElement | null>(null);
const historyScrollRef = ref<HTMLElement | null>(null);
const isFullscreen = ref(false);
const fullscreenError = ref("");
const viewWidth = ref(900);
const viewHeight = ref(500);
const plotTop = 30;
const plotBottom = computed(() => viewHeight.value - 58);
const tickCount = 5;
let resizeObserver: InstanceType<typeof globalThis.ResizeObserver> | null =
  null;
const historyDragging = ref(false);
const historyFirstVisibleIndex = ref(0);
let historyPointerId: number | null = null;
let historyPointerStartX = 0;
let historyPointerStartScrollLeft = 0;
let historyPointerMoved = false;
let historySuppressClick = false;
let historyWheelSnapTimer: ReturnType<typeof globalThis.setTimeout> | null =
  null;
let historyFollowLatest = true;
let historyPendingInitialScroll = false;

const plotLeft = computed(() => (viewWidth.value < 520 ? 58 : 78));
const plotRight = computed(() => Math.max(viewWidth.value - 24, 220));

const activeMetric = computed(
  () =>
    metricOptions.find((metric) => metric.key === activeMetricKey.value) ||
    metricOptions[0],
);

const mainBusinessMetricKeys: TrendMetricKey[] = [
  "actualReceipt",
  "mainContractAmount",
  "mainContractCount",
];
const isMainBusinessMetric = computed(() =>
  mainBusinessMetricKeys.includes(activeMetricKey.value),
);
const mainBusinessSourceLegend = computed(() => {
  if (activeMetricKey.value === "actualReceipt") {
    return activeRegion.value === "all"
      ? "历史缺月仅取合同已确认回款"
      : `${activeRegion.value}合同已确认回款`;
  }
  return "合同额和数量按当前合同台账重述";
});
const regionOptions = computed(() => {
  const regions = props.mainBusinessRegions
    .map((region) =>
      String(region || "")
        .normalize("NFKC")
        .trim(),
    )
    .filter(Boolean);
  return regions
    .filter((region, index) => regions.indexOf(region) === index)
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
});

const historyYearOptions = computed(() =>
  [...new globalThis.Set(props.availableYears)]
    .filter((year) => Number.isInteger(year) && year < props.selectedYear)
    .sort((left, right) => right - left),
);

const selectedYearOptions = computed(() => {
  const years = [...props.availableYears, props.selectedYear];
  return years
    .filter(
      (year, index) =>
        Number.isInteger(year) &&
        year >= 1900 &&
        year <= 9999 &&
        years.indexOf(year) === index,
    )
    .sort((left, right) => right - left);
});

const pointsByMonth = computed(
  () => new Map(props.points.map((point) => [point.month, point])),
);

const mainBusinessPointsByMonth = computed(() => {
  const grouped = new Map<string, MonthlyFinancialMainBusinessTrendPoint[]>();
  for (const point of props.mainBusinessPoints) {
    const rows = grouped.get(point.month) || [];
    rows.push(point);
    grouped.set(point.month, rows);
  }
  return grouped;
});

function yearPoint(year: number, monthIndex: number) {
  return pointsByMonth.value.get(
    `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
  );
}

function trendPointValueState(
  point: MonthlyFinancialTrendPoint,
  metric: TrendMetricKey,
): TrendDisplayState {
  if (metric === "mainContractAmount" || metric === "mainContractCount") {
    return trendMetricValue(point, metric) === null ? null : "ledger_source";
  }
  if (metric === "actualReceipt" && activeRegion.value !== "all") {
    return trendMetricValue(point, metric) === null ? null : "confirmed_source";
  }
  return metric === "actualReceipt"
    ? point.actualReceiptState
    : point.valueState;
}

function selectedMainBusinessRows(month: string) {
  const rows = mainBusinessPointsByMonth.value.get(month) || [];
  return activeRegion.value === "all"
    ? rows
    : rows.filter((row) => row.region === activeRegion.value);
}

function aggregateMainBusinessAmount(
  rows: MonthlyFinancialMainBusinessTrendPoint[],
  field: "actualReceipt" | "contractAmount",
): MonthlyFinancialAmount | null {
  if (!rows.length || rows.some((row) => row[field] === null)) return null;
  return rows.reduce(
    (sum, row) => addFinancialAmountTexts(sum, String(row[field] || "0")),
    "0",
  );
}

function trendMetricValue(
  point: MonthlyFinancialTrendPoint,
  metric: TrendMetricKey,
): MonthlyFinancialAmount | null {
  if (metric === "actualReceipt") {
    if (activeRegion.value === "all") return point.actualReceipt;
    return aggregateMainBusinessAmount(
      selectedMainBusinessRows(point.month),
      "actualReceipt",
    );
  }
  if (metric === "mainContractAmount") {
    return aggregateMainBusinessAmount(
      selectedMainBusinessRows(point.month),
      "contractAmount",
    );
  }
  if (metric === "mainContractCount") {
    const rows = selectedMainBusinessRows(point.month);
    if (!rows.length || rows.some((row) => row.contractCount === null)) {
      return null;
    }
    return String(
      rows.reduce((sum, row) => sum + Number(row.contractCount || 0), 0),
    );
  }
  return point[metric];
}

function buildRawSeries(
  year: number,
  color: string,
  history: boolean,
): RawSeries {
  const points: RawSeriesPoint[] = [];
  for (let index = 0; index < 12; index += 1) {
    const source = yearPoint(year, index);
    if (!source) continue;
    const value = trendMetricValue(source, activeMetricKey.value);
    if (value === null || value === undefined || !isAmountText(value)) continue;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) continue;
    points.push({
      index,
      value,
      numericValue,
      source,
      valueState: trendPointValueState(source, activeMetricKey.value),
    });
  }
  return {
    key: history ? `history-${year}` : `selected-${year}`,
    year,
    color,
    history,
    points,
  };
}

const rawSeries = computed<RawSeries[]>(() => {
  const series = [buildRawSeries(props.selectedYear, "#167c84", false)];
  if (
    props.comparisonYear !== null &&
    Number.isInteger(props.comparisonYear) &&
    props.comparisonYear !== props.selectedYear
  ) {
    series.push(buildRawSeries(props.comparisonYear, "#7686a1", true));
  }
  return series;
});

const fullHistoryAxis = computed<FullHistoryAxisPoint[]>(() => {
  const sorted = [...props.points]
    .filter((point) => /^\d{4}-(0[1-9]|1[0-2])$/u.test(point.month))
    .sort((left, right) => left.month.localeCompare(right.month));
  const mapped = sorted.map((source) => {
    const value = trendMetricValue(source, activeMetricKey.value);
    const valid =
      value !== null &&
      value !== undefined &&
      isAmountText(String(value)) &&
      Number.isFinite(Number(value));
    return {
      month: source.month,
      index: 0,
      source,
      value: valid ? value : null,
      numericValue: valid ? Number(value) : null,
      valueState: trendPointValueState(source, activeMetricKey.value),
    };
  });
  const first = mapped.findIndex((point) => point.value !== null);
  const last = mapped.findLastIndex((point) => point.value !== null);
  if (first < 0 || last < first) return [];
  return mapped
    .slice(first, last + 1)
    .map((point, index) => ({ ...point, index }));
});

const fullHistoryRangeLabel = computed(() => {
  const firstMonth = fullHistoryAxis.value[0]?.month;
  const lastMonth = fullHistoryAxis.value.at(-1)?.month;
  if (!firstMonth || !lastMonth) return `${props.selectedYear}年`;
  const formatMonth = (month: string) => {
    const [year, monthNumber] = month.split("-");
    return `${year}年${Number(monthNumber)}月`;
  };
  return `${formatMonth(firstMonth)}—${formatMonth(lastMonth)}`;
});

const fullHistoryComparisonAxis = computed<FullHistoryComparisonAxisPoint[]>(
  () => {
    if (!props.yearComparison) return [];
    return fullHistoryAxis.value.flatMap((target) => {
      const comparisonMonth = shiftMonthKey(target.month, -12);
      const source = pointsByMonth.value.get(comparisonMonth);
      if (!source) return [];
      const value = trendMetricValue(source, activeMetricKey.value);
      const valid =
        value !== null &&
        value !== undefined &&
        isAmountText(String(value)) &&
        Number.isFinite(Number(value));
      return [
        {
          month: target.month,
          comparisonMonth,
          index: target.index,
          source,
          value: valid ? value : null,
          numericValue: valid ? Number(value) : null,
          valueState: valid
            ? trendPointValueState(source, activeMetricKey.value)
            : null,
        },
      ];
    });
  },
);

const fullHistoryViewportWidth = computed(() =>
  Math.max(viewWidth.value - 70, 280),
);
const fullHistoryMonthWidth = computed(() =>
  Math.max(48, (fullHistoryViewportWidth.value - 54) / 11),
);
const fullHistoryCanvasWidth = computed(() =>
  Math.max(
    fullHistoryViewportWidth.value,
    54 +
      Math.max(fullHistoryAxis.value.length - 1, 0) *
        fullHistoryMonthWidth.value,
  ),
);
const fullHistoryPlotLeft = 20;
const fullHistoryPlotRight = computed(() =>
  Math.max(fullHistoryCanvasWidth.value - 34, fullHistoryPlotLeft + 1),
);

function getFullHistoryX(index: number) {
  if (fullHistoryAxis.value.length <= 1) return fullHistoryPlotLeft;
  return (
    fullHistoryPlotLeft +
    ((fullHistoryPlotRight.value - fullHistoryPlotLeft) * index) /
      (fullHistoryAxis.value.length - 1)
  );
}

const fullHistoryNumericValues = computed(() => [
  ...fullHistoryAxis.value.flatMap((point) =>
    point.numericValue === null ? [] : [point.numericValue],
  ),
  ...fullHistoryComparisonAxis.value.flatMap((point) =>
    point.numericValue === null ? [] : [point.numericValue],
  ),
]);

const fullHistoryAxisRange = computed(() => {
  if (fullHistoryNumericValues.value.length === 0) return { min: 0, max: 1 };
  const rawMinimum = Math.min(...fullHistoryNumericValues.value, 0);
  const rawMaximum = Math.max(...fullHistoryNumericValues.value, 0);
  const rawSpan = rawMaximum - rawMinimum;
  const safeSpan =
    rawSpan === 0
      ? Math.max(Math.abs(rawMaximum), Math.abs(rawMinimum), 1)
      : rawSpan;
  const step = niceNumber((safeSpan * 1.08) / (tickCount - 1));
  if (rawMinimum >= 0) return { min: 0, max: step * (tickCount - 1) };
  if (rawMaximum <= 0) return { min: -step * (tickCount - 1), max: 0 };
  let minimum = Math.floor(rawMinimum / step) * step;
  let maximum = minimum + step * (tickCount - 1);
  if (maximum < rawMaximum) {
    maximum = Math.ceil(rawMaximum / step) * step;
    minimum = maximum - step * (tickCount - 1);
  }
  return { min: minimum, max: maximum };
});

function getFullHistoryY(value: number) {
  const { min, max } = fullHistoryAxisRange.value;
  const ratio = (value - min) / Math.max(max - min, 1);
  return plotBottom.value - ratio * (plotBottom.value - plotTop);
}

const fullHistoryYTicks = computed(() => {
  const { min, max } = fullHistoryAxisRange.value;
  return Array.from({ length: tickCount }, (_item, index) => {
    const ratio = index / (tickCount - 1);
    return {
      value: max - (max - min) * ratio,
      y: plotTop + (plotBottom.value - plotTop) * ratio,
    };
  });
});

const fullHistoryPlottedPoints = computed<FullHistoryPlottedPoint[]>(() =>
  fullHistoryAxis.value.flatMap((point) => {
    if (
      point.value === null ||
      point.numericValue === null ||
      point.valueState === null
    ) {
      return [];
    }
    return [
      {
        ...point,
        value: point.value,
        numericValue: point.numericValue,
        x: getFullHistoryX(point.index),
        y: getFullHistoryY(point.numericValue),
        isCurrent: point.valueState === "current",
        isConfirmedSource: point.valueState === "confirmed_source",
        isLedgerSource: point.valueState === "ledger_source",
      },
    ];
  }),
);

const fullHistoryComparisonPlottedPoints = computed<
  FullHistoryComparisonPlottedPoint[]
>(() =>
  fullHistoryComparisonAxis.value.flatMap((point) => {
    if (
      point.value === null ||
      point.numericValue === null ||
      point.valueState === null
    ) {
      return [];
    }
    return [
      {
        ...point,
        value: point.value,
        numericValue: point.numericValue,
        x: getFullHistoryX(point.index),
        y: getFullHistoryY(point.numericValue),
        isCurrent: point.valueState === "current",
        isConfirmedSource: point.valueState === "confirmed_source",
        isLedgerSource: point.valueState === "ledger_source",
      },
    ];
  }),
);

function buildFullHistoryEdges(points: FullHistoryPlottedPoint[]) {
  const edges: Array<{
    fromMonth: string;
    toMonth: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }> = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (current.index !== previous.index + 1) continue;
    edges.push({
      fromMonth: previous.month,
      toMonth: current.month,
      x1: previous.x,
      y1: previous.y,
      x2: current.x,
      y2: current.y,
    });
  }
  return edges;
}

const fullHistoryEdges = computed(() =>
  buildFullHistoryEdges(fullHistoryPlottedPoints.value),
);
const fullHistoryComparisonEdges = computed(() =>
  buildFullHistoryEdges(fullHistoryComparisonPlottedPoints.value),
);

const fullHistoryActiveMonth = ref<string | null>(null);
const fullHistoryActiveAxisPoint = computed(
  () =>
    fullHistoryAxis.value.find(
      (point) => point.month === fullHistoryActiveMonth.value,
    ) ||
    fullHistoryAxis.value.at(-1) ||
    null,
);
const fullHistoryComparisonActiveAxisPoint = computed(
  () =>
    fullHistoryComparisonAxis.value.find(
      (point) => point.month === fullHistoryActiveAxisPoint.value?.month,
    ) || null,
);
const fullHistoryComparisonActiveMonth = computed(() => {
  const month = fullHistoryActiveAxisPoint.value?.month;
  return month ? shiftMonthKey(month, -12) : "未知月份";
});

function trendStateLabel(state: TrendDisplayState) {
  if (state === "closed") return "月结值";
  if (state === "current") return "当前值（未月结）";
  if (state === "confirmed_source") return "合同已确认回款";
  if (state === "ledger_source") return "合同台账当前值";
  return "无数据";
}

function trendStateClass(state: TrendDisplayState) {
  if (state === "closed") return "is-closed";
  if (state === "current") return "is-current";
  if (state === "confirmed_source") return "is-confirmed-source";
  if (state === "ledger_source") return "is-ledger-source";
  return "is-missing";
}

const fullHistoryActiveStateLabel = computed(() =>
  trendStateLabel(fullHistoryActiveAxisPoint.value?.valueState || null),
);

const fullHistoryActiveStateClass = computed(() =>
  trendStateClass(fullHistoryActiveAxisPoint.value?.valueState || null),
);
const fullHistoryComparisonActiveStateLabel = computed(() =>
  trendStateLabel(
    fullHistoryComparisonActiveAxisPoint.value?.valueState || null,
  ),
);
const fullHistoryComparisonActiveStateClass = computed(() =>
  trendStateClass(
    fullHistoryComparisonActiveAxisPoint.value?.valueState || null,
  ),
);

const numericValues = computed(() =>
  rawSeries.value.flatMap((series) =>
    series.points.map((point) => point.numericValue),
  ),
);

const hasData = computed(() =>
  props.fullHistory
    ? fullHistoryNumericValues.value.length > 0
    : numericValues.value.length > 0,
);

const axisRange = computed(() => {
  if (!hasData.value) return { min: 0, max: 1 };
  const rawMinimum = Math.min(...numericValues.value, 0);
  const rawMaximum = Math.max(...numericValues.value, 0);
  const rawSpan = rawMaximum - rawMinimum;
  const safeSpan =
    rawSpan === 0
      ? Math.max(Math.abs(rawMaximum), Math.abs(rawMinimum), 1)
      : rawSpan;
  const step = niceNumber((safeSpan * 1.08) / (tickCount - 1));

  if (rawMinimum >= 0) {
    return { min: 0, max: step * (tickCount - 1) };
  }
  if (rawMaximum <= 0) {
    return { min: -step * (tickCount - 1), max: 0 };
  }

  let minimum = Math.floor(rawMinimum / step) * step;
  let maximum = minimum + step * (tickCount - 1);
  if (maximum < rawMaximum) {
    maximum = Math.ceil(rawMaximum / step) * step;
    minimum = maximum - step * (tickCount - 1);
  }
  return { min: minimum, max: maximum };
});

const yTicks = computed(() => {
  const { min, max } = axisRange.value;
  return Array.from({ length: tickCount }, (_item, index) => {
    const ratio = index / (tickCount - 1);
    return {
      value: max - (max - min) * ratio,
      y: plotTop + (plotBottom.value - plotTop) * ratio,
    };
  });
});

function getX(index: number) {
  return (
    plotLeft.value +
    ((plotRight.value - plotLeft.value) * index) / Math.max(12 - 1, 1)
  );
}

function getY(value: number) {
  const { min, max } = axisRange.value;
  const ratio = (value - min) / Math.max(max - min, 1);
  return plotBottom.value - ratio * (plotBottom.value - plotTop);
}

function shouldShowPointValueLabel(point: PlottedSeriesPoint) {
  return viewWidth.value >= 800 || activeMonthIndex.value === point.index;
}

function pointValueLabelAnchor(index: number) {
  if (index === 0) return "start";
  if (index === 11) return "end";
  return "middle";
}

const plottedSeries = computed<PlottedSeries[]>(() =>
  rawSeries.value.map((series) => {
    const points: PlottedSeriesPoint[] = series.points.map((point) => ({
      ...point,
      x: getX(point.index),
      y: getY(point.numericValue),
      isCurrent: point.valueState === "current",
      isConfirmedSource: point.valueState === "confirmed_source",
      isLedgerSource: point.valueState === "ledger_source",
    }));
    const edges: PlottedSeries["edges"] = [];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (current.index !== previous.index + 1) continue;
      edges.push({
        fromIndex: previous.index,
        toIndex: current.index,
        x1: previous.x,
        y1: previous.y,
        x2: current.x,
        y2: current.y,
      });
    }
    return { ...series, points, edges };
  }),
);

function pointValueLabelBoxX(
  x: number,
  width: number,
  anchor: PointValueLabelLayout["anchor"],
) {
  if (anchor === "start") return x - 6;
  if (anchor === "end") return x - width + 6;
  return x - width / 2;
}

function pointValueLabelBoxesOverlap(
  left: PointValueLabelLayout,
  right: PointValueLabelLayout,
) {
  const gap = 4;
  return (
    left.boxX < right.boxX + right.boxWidth + gap &&
    left.boxX + left.boxWidth + gap > right.boxX &&
    left.boxY < right.boxY + right.boxHeight + gap &&
    left.boxY + left.boxHeight + gap > right.boxY
  );
}

function pointValueLabelCoversPoint(
  label: PointValueLabelLayout,
  point: PlottedSeriesPoint,
) {
  const gap = 12;
  return (
    point.x >= label.boxX - gap &&
    point.x <= label.boxX + label.boxWidth + gap &&
    point.y >= label.boxY - gap &&
    point.y <= label.boxY + label.boxHeight + gap
  );
}

const pointValueLabels = computed<PointValueLabelLayout[]>(() => {
  const seeds = plottedSeries.value
    .flatMap((series) =>
      series.points
        .filter((point) => shouldShowPointValueLabel(point))
        .map((point) => ({ series, point })),
    )
    .sort((left, right) => {
      const leftActive = left.point.index === activeMonthIndex.value ? 0 : 1;
      const rightActive = right.point.index === activeMonthIndex.value ? 0 : 1;
      if (leftActive !== rightActive) return leftActive - rightActive;
      if (left.point.index !== right.point.index) {
        return left.point.index - right.point.index;
      }
      return Number(left.series.history) - Number(right.series.history);
    });
  const allPoints = plottedSeries.value.flatMap((series) => series.points);
  const placed: PointValueLabelLayout[] = [];
  const minimumY = 18;
  const maximumY = plotBottom.value - 14;

  for (const { series, point } of seeds) {
    const text = formatMetricValue(point.value);
    const anchor = pointValueLabelAnchor(point.index);
    const boxHeight = 20;
    const boxWidth = Math.max(48, text.length * 7 + 12);
    const counterpart = seeds.find(
      (candidate) =>
        candidate.series.key !== series.key &&
        candidate.point.index === point.index,
    )?.point;
    const preferredDirection =
      !counterpart || Math.abs(point.y - counterpart.y) < 1
        ? series.history
          ? 1
          : -1
        : point.y < counterpart.y
          ? -1
          : 1;
    const offsets = [30, 52, 74, 96];
    const preferredCandidates = [
      ...offsets.map((offset) => point.y + preferredDirection * offset),
      ...offsets.map((offset) => point.y - preferredDirection * offset),
    ];
    const scanCandidates = Array.from(
      { length: Math.floor((maximumY - minimumY) / 18) + 1 },
      (_item, index) => minimumY + index * 18,
    ).sort((left, right) => {
      const preferredY = point.y + preferredDirection * offsets[0];
      return Math.abs(left - preferredY) - Math.abs(right - preferredY);
    });
    const yCandidates = [...preferredCandidates, ...scanCandidates]
      .filter((value) => value >= minimumY && value <= maximumY)
      .filter((value, index, values) => values.indexOf(value) === index);
    const candidates = yCandidates.map<PointValueLabelLayout>((y) => ({
      key: `${series.key}-label-${point.index}`,
      text,
      color: series.color,
      history: series.history,
      x: point.x,
      y,
      anchor,
      boxX: pointValueLabelBoxX(point.x, boxWidth, anchor),
      boxY: y - 14,
      boxWidth,
      boxHeight,
    }));
    const cleanCandidate = candidates.find(
      (candidate) =>
        !placed.some((label) =>
          pointValueLabelBoxesOverlap(candidate, label),
        ) &&
        !allPoints.some((candidatePoint) =>
          pointValueLabelCoversPoint(candidate, candidatePoint),
        ),
    );
    if (cleanCandidate) placed.push(cleanCandidate);
  }

  return placed;
});

const fullHistoryVisibleStartIndex = computed(() =>
  Math.min(
    Math.max(fullHistoryAxis.value.length - 12, 0),
    Math.max(historyFirstVisibleIndex.value, 0),
  ),
);
const fullHistoryVisibleEndIndex = computed(() =>
  Math.min(
    fullHistoryAxis.value.length - 1,
    fullHistoryVisibleStartIndex.value + 11,
  ),
);

const fullHistoryPointValueLabels = computed<PointValueLabelLayout[]>(() => {
  const startIndex = fullHistoryVisibleStartIndex.value;
  const endIndex = fullHistoryVisibleEndIndex.value;
  const seeds = [
    ...fullHistoryPlottedPoints.value
      .filter((point) => point.index >= startIndex && point.index <= endIndex)
      .map((point) => ({ point, history: false, color: "#167c84" })),
    ...fullHistoryComparisonPlottedPoints.value
      .filter((point) => point.index >= startIndex && point.index <= endIndex)
      .map((point) => ({ point, history: true, color: "#7686a1" })),
  ].sort((left, right) => {
    const activeIndex = fullHistoryActiveAxisPoint.value?.index;
    const leftActive = left.point.index === activeIndex ? 0 : 1;
    const rightActive = right.point.index === activeIndex ? 0 : 1;
    if (leftActive !== rightActive) return leftActive - rightActive;
    if (left.point.index !== right.point.index) {
      return left.point.index - right.point.index;
    }
    return Number(left.history) - Number(right.history);
  });
  const allPoints = seeds.map((seed) => seed.point);
  const placed: PointValueLabelLayout[] = [];
  const minimumY = 18;
  const maximumY = plotBottom.value - 14;

  for (const { point, history, color } of seeds) {
    const text = formatMetricValue(point.value);
    const anchor =
      point.index === startIndex
        ? "start"
        : point.index === endIndex
          ? "end"
          : "middle";
    const boxHeight = 20;
    const boxWidth = Math.max(48, text.length * 7 + 12);
    const counterpart = seeds.find(
      (candidate) =>
        candidate.history !== history && candidate.point.index === point.index,
    )?.point;
    const preferredDirection =
      !counterpart || Math.abs(point.y - counterpart.y) < 1
        ? history
          ? 1
          : -1
        : point.y < counterpart.y
          ? -1
          : 1;
    const offsets = [24, 46, 68, 90, 112];
    const preferredCandidates = [
      ...offsets.map((offset) => point.y + preferredDirection * offset),
      ...offsets.map((offset) => point.y - preferredDirection * offset),
    ];
    const scanCandidates = Array.from(
      { length: Math.floor((maximumY - minimumY) / 18) + 1 },
      (_item, index) => minimumY + index * 18,
    ).sort((left, right) => {
      const preferredY = point.y + preferredDirection * offsets[0];
      return Math.abs(left - preferredY) - Math.abs(right - preferredY);
    });
    const yCandidates = [...preferredCandidates, ...scanCandidates]
      .filter((value) => value >= minimumY && value <= maximumY)
      .filter((value, index, values) => values.indexOf(value) === index);
    const candidates = yCandidates.map<PointValueLabelLayout>((y) => ({
      key: `full-${history ? "history" : "current"}-${point.month}`,
      text,
      color,
      history,
      x: point.x,
      y,
      anchor,
      boxX: pointValueLabelBoxX(point.x, boxWidth, anchor),
      boxY: y - 14,
      boxWidth,
      boxHeight,
      month: point.month,
      series: history ? "comparison" : "current",
    }));
    const cleanCandidate = candidates.find(
      (candidate) =>
        !placed.some((label) =>
          pointValueLabelBoxesOverlap(candidate, label),
        ) &&
        !allPoints.some((candidatePoint) =>
          pointValueLabelCoversPoint(candidate, candidatePoint),
        ),
    );
    const fallbackCandidate = candidates.find(
      (candidate) =>
        !placed.some((label) => pointValueLabelBoxesOverlap(candidate, label)),
    );
    const selectedCandidate =
      cleanCandidate || fallbackCandidate || candidates[0];
    if (selectedCandidate) placed.push(selectedCandidate);
  }

  return placed;
});

const availableMonthIndexes = computed(
  () =>
    new globalThis.Set(
      rawSeries.value.flatMap((series) =>
        series.points.map((point) => point.index),
      ),
    ),
);

watch(
  [() => props.selectedMonth, () => props.selectedYear],
  () => {
    const monthIndex = monthIndexForYear(
      props.selectedMonth,
      props.selectedYear,
    );
    activeMonthIndex.value = monthIndex;
  },
  { immediate: true },
);

watch(
  [() => props.points, () => props.comparisonYear, activeMetricKey],
  () => {
    if (activeMonthIndex.value !== null) return;
    const indexes = [...availableMonthIndexes.value];
    activeMonthIndex.value = indexes.length > 0 ? Math.max(...indexes) : 0;
  },
  { immediate: true, deep: true },
);

watch(
  [() => props.fullHistory, fullHistoryAxis, activeMetricKey],
  ([enabled]) => {
    if (!enabled) return;
    const availableMonths = new globalThis.Set(
      fullHistoryPlottedPoints.value.map((point) => point.month),
    );
    if (
      !fullHistoryActiveMonth.value ||
      !availableMonths.has(fullHistoryActiveMonth.value)
    ) {
      fullHistoryActiveMonth.value =
        fullHistoryPlottedPoints.value.at(-1)?.month || null;
    }
    if (historyPendingInitialScroll || historyFollowLatest) {
      scrollFullHistoryToLatest();
    }
  },
  { immediate: true, deep: true },
);

watch(
  () => props.fullHistory,
  (enabled) => {
    historyPendingInitialScroll = enabled;
    if (enabled) activeMetricKey.value = "actualReceipt";
  },
  { immediate: true },
);

watch(
  regionOptions,
  (regions) => {
    if (activeRegion.value !== "all" && !regions.includes(activeRegion.value)) {
      activeRegion.value = "all";
    }
  },
  { immediate: true },
);

const activeMonthDetail = computed(() => {
  if (activeMonthIndex.value === null) return null;
  const index = activeMonthIndex.value;
  const years = [
    {
      year: props.selectedYear,
      history: false,
      color: "#167c84",
    },
    ...(props.comparisonYear === null
      ? []
      : [
          {
            year: props.comparisonYear,
            history: true,
            color: "#7686a1",
          },
        ]),
  ].map((series) => {
    const point = yearPoint(series.year, index);
    const value = point ? trendMetricValue(point, activeMetricKey.value) : null;
    const available = value !== null && value !== undefined;
    const valueState = available
      ? point
        ? trendPointValueState(point, activeMetricKey.value)
        : null
      : null;
    return {
      ...series,
      value,
      state:
        valueState === "closed"
          ? "closed"
          : valueState === "current"
            ? "current"
            : valueState === "confirmed_source"
              ? "confirmed-source"
              : valueState === "ledger_source"
                ? "ledger-source"
                : "missing",
      stateLabel:
        valueState === "closed"
          ? "月结值"
          : valueState === "current"
            ? "当前值（未月结）"
            : valueState === "confirmed_source"
              ? "合同已确认回款"
              : valueState === "ledger_source"
                ? "合同台账当前值"
                : "无数据",
    };
  });
  return {
    label: `${props.selectedYear}年${index + 1}月`,
    years,
  };
});

const visibleMonthIndexes = computed(() => {
  if (viewWidth.value < 460) return [0, 2, 5, 8, 11];
  if (viewWidth.value < 700) return [0, 2, 4, 6, 8, 10, 11];
  return Array.from({ length: 12 }, (_item, index) => index);
});

const hoverBands = computed(() =>
  Array.from({ length: 12 }, (_item, index) => {
    const current = getX(index);
    const previous = index === 0 ? plotLeft.value : getX(index - 1);
    const next = index === 11 ? plotRight.value : getX(index + 1);
    const start = index === 0 ? plotLeft.value : (previous + current) / 2;
    const end = index === 11 ? plotRight.value : (current + next) / 2;
    return { index, x: start, width: Math.max(end - start, 1) };
  }),
);

const warningText = computed(() => {
  const messages = [
    ...new globalThis.Set(props.warnings.map((warning) => warning.message)),
  ];
  if (messages.length === 0) return "";
  return messages.length > 2
    ? `${messages.slice(0, 2).join("；")}；另有${messages.length - 2}项提示`
    : messages.join("；");
});

const chartAriaLabel = computed(() => {
  const history =
    props.comparisonYear === null
      ? "暂无历史对比年度"
      : `并与${props.comparisonYear}年对比`;
  return `${props.selectedYear}年${activeMetric.value.label}月度折线图，${history}；缺失月份保持断点`;
});

const fullHistoryAriaLabel = computed(() => {
  const first = fullHistoryAxis.value[0]?.month || "未知月份";
  const last = fullHistoryAxis.value.at(-1)?.month || "未知月份";
  const comparison = props.yearComparison ? "，并显示上年同期" : "";
  return `${first}至${last}${activeMetric.value.label}完整历史折线图${comparison}，可横向浏览`;
});

function selectMonth(index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 11) return;
  activeMonthIndex.value = index;
}

function selectFullHistoryMonth(month: string) {
  if (historySuppressClick) return;
  if (!fullHistoryAxis.value.some((point) => point.month === month)) return;
  fullHistoryActiveMonth.value = month;
}

function scrollFullHistoryToLatest() {
  void nextTick(() => {
    const element = historyScrollRef.value;
    if (!element) return;
    element.scrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    historyFollowLatest = true;
    historyPendingInitialScroll = false;
    handleHistoryScroll();
  });
}

function snapFullHistoryScroll() {
  const element = historyScrollRef.value;
  if (!element || fullHistoryMonthWidth.value <= 0) return;
  const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
  const snapped =
    Math.round(element.scrollLeft / fullHistoryMonthWidth.value) *
    fullHistoryMonthWidth.value;
  element.scrollLeft = Math.min(maximum, Math.max(0, snapped));
  handleHistoryScroll();
}

function handleHistoryScroll() {
  const element = historyScrollRef.value;
  if (!element) return;
  const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
  const maximumStartIndex = Math.max(fullHistoryAxis.value.length - 12, 0);
  historyFirstVisibleIndex.value = Math.min(
    maximumStartIndex,
    Math.max(0, Math.round(element.scrollLeft / fullHistoryMonthWidth.value)),
  );
  historyFollowLatest =
    maximum - element.scrollLeft <= fullHistoryMonthWidth.value / 2;
}

function handleHistoryPointerDown(event: globalThis.PointerEvent) {
  if (event.button !== 0) return;
  const element = historyScrollRef.value;
  if (!element) return;
  historyPointerId = event.pointerId;
  historyPointerStartX = event.clientX;
  historyPointerStartScrollLeft = element.scrollLeft;
  historyPointerMoved = false;
  element.setPointerCapture?.(event.pointerId);
}

function handleHistoryPointerMove(event: globalThis.PointerEvent) {
  if (historyPointerId !== event.pointerId) return;
  const element = historyScrollRef.value;
  if (!element) return;
  const distance = event.clientX - historyPointerStartX;
  if (!historyPointerMoved && Math.abs(distance) < 5) return;
  historyPointerMoved = true;
  historyDragging.value = true;
  element.scrollLeft = historyPointerStartScrollLeft - distance;
  handleHistoryScroll();
}

function finishHistoryPointer(event: globalThis.PointerEvent) {
  if (historyPointerId !== event.pointerId) return;
  const element = historyScrollRef.value;
  if (element?.hasPointerCapture?.(event.pointerId)) {
    element.releasePointerCapture(event.pointerId);
  }
  historyPointerId = null;
  historyDragging.value = false;
  if (historyPointerMoved) {
    historySuppressClick = true;
    globalThis.setTimeout(() => {
      historySuppressClick = false;
    }, 0);
  }
  snapFullHistoryScroll();
}

function handleHistoryWheel(event: globalThis.WheelEvent) {
  if (event.ctrlKey || event.metaKey) return;
  const element = historyScrollRef.value;
  if (!element) return;
  const delta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
  if (delta === 0) return;
  const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
  if (
    (delta < 0 && element.scrollLeft <= 0) ||
    (delta > 0 && element.scrollLeft >= maximum)
  ) {
    return;
  }
  event.preventDefault();
  element.scrollLeft = Math.min(
    maximum,
    Math.max(0, element.scrollLeft + delta),
  );
  handleHistoryScroll();
  if (historyWheelSnapTimer !== null) {
    globalThis.clearTimeout(historyWheelSnapTimer);
  }
  historyWheelSnapTimer = globalThis.setTimeout(() => {
    historyWheelSnapTimer = null;
    snapFullHistoryScroll();
  }, 140);
}

function handleHistoryKeydown(event: KeyboardEvent) {
  if (!fullHistoryAxis.value.length) return;
  const currentIndex = Math.max(
    0,
    fullHistoryAxis.value.findIndex(
      (point) => point.month === fullHistoryActiveAxisPoint.value?.month,
    ),
  );
  let nextIndex = currentIndex;
  if (event.key === "ArrowLeft") nextIndex -= 1;
  else if (event.key === "ArrowRight") nextIndex += 1;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = fullHistoryAxis.value.length - 1;
  else if (event.key === "PageUp") nextIndex -= 6;
  else if (event.key === "PageDown") nextIndex += 6;
  else return;
  event.preventDefault();
  nextIndex = Math.min(
    fullHistoryAxis.value.length - 1,
    Math.max(0, nextIndex),
  );
  fullHistoryActiveMonth.value = fullHistoryAxis.value[nextIndex]!.month;
  const element = historyScrollRef.value;
  if (element) {
    const x = getFullHistoryX(nextIndex);
    element.scrollLeft = Math.max(0, x - element.clientWidth / 2);
    handleHistoryScroll();
  }
}

function handleViewMonthChange(value: unknown) {
  const monthNumber = Number(value);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return;
  }
  selectMonth(monthNumber - 1);
}

function handleComparisonYearChange(value: unknown) {
  const year = Number(value);
  emit(
    "comparison-year-change",
    Number.isInteger(year) && year < props.selectedYear ? year : null,
  );
}

function handleSelectedYearChange(value: unknown) {
  const year = Number(value);
  if (!Number.isInteger(year) || !selectedYearOptions.value.includes(year)) {
    return;
  }
  emit("selected-year-change", year);
}

function handleRegionChange(value: unknown) {
  const region = String(value || "")
    .normalize("NFKC")
    .trim();
  if (region === "all" || regionOptions.value.includes(region)) {
    activeRegion.value = region;
  }
}

function pointAriaLabel(series: PlottedSeries, point: PlottedSeriesPoint) {
  const stateLabel = point.isConfirmedSource
    ? "合同已确认回款"
    : point.isLedgerSource
      ? "合同台账当前值"
      : point.isCurrent
        ? "当前值（未月结）"
        : "月结值";
  return `${series.year}年${point.index + 1}月，${activeMetric.value.label}${formatMetricValue(point.value)}，${stateLabel}`;
}

function fullHistoryPointAriaLabel(point: FullHistoryPlottedPoint) {
  const stateLabel = point.isConfirmedSource
    ? "合同已确认回款"
    : point.isLedgerSource
      ? "合同台账当前值"
      : point.isCurrent
        ? "当前值（未月结）"
        : "月结值";
  return `${point.month}，${activeMetric.value.label}${formatMetricValue(point.value)}，${stateLabel}`;
}

function fullHistoryComparisonPointAriaLabel(
  point: FullHistoryComparisonPlottedPoint,
) {
  const stateLabel = trendStateLabel(point.valueState);
  return `横轴${point.month}，上年同期${point.comparisonMonth}，${activeMetric.value.label}${formatMetricValue(point.value)}，${stateLabel}`;
}

function formatFullHistoryMonth(month: string) {
  const [year, monthNumber] = month.split("-");
  return monthNumber === "01" ? `${year}/01` : `${Number(monthNumber)}月`;
}

function shiftMonthKey(month: string, offset: number) {
  const [yearText, monthText] = month.split("-");
  const absoluteMonth = Number(yearText) * 12 + Number(monthText) - 1 + offset;
  const year = Math.floor(absoluteMonth / 12);
  const monthNumber = (absoluteMonth % 12) + 1;
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

function monthIndexForYear(month: string, year: number): number | null {
  const match = month.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match || Number(match[1]) !== year) return null;
  return Number(match[2]) - 1;
}

function isAmountText(value: string) {
  return /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim());
}

function formatExactAmount(value: MonthlyFinancialAmount | null | undefined) {
  return formatMonthlyFinancialAmount(value);
}

function formatMetricValue(value: MonthlyFinancialAmount | null | undefined) {
  if (activeMetric.value.unit === "count") {
    if (value === null || value === undefined || value === "") return "—";
    return `${Number(value).toLocaleString("zh-CN")}组`;
  }
  return formatExactAmount(value);
}

function niceNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const niceFraction =
    fraction <= 1
      ? 1
      : fraction <= 2
        ? 2
        : fraction <= 2.5
          ? 2.5
          : fraction <= 5
            ? 5
            : 10;
  return niceFraction * 10 ** exponent;
}

function formatAxisAmount(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 100000000) return `${trimAxisValue(value / 100000000)}亿`;
  if (absolute >= 10000) return `${trimAxisValue(value / 10000)}万`;
  return trimAxisValue(value);
}

function formatAxisValue(value: number) {
  return activeMetric.value.unit === "count"
    ? trimAxisValue(value)
    : formatAxisAmount(value);
}

function trimAxisValue(value: number) {
  return Number(value.toFixed(1)).toString();
}

function isZero(value: number) {
  return Math.abs(value) < Number.EPSILON * 100;
}

function updateCanvasSize(width: number) {
  const historyElement = historyScrollRef.value;
  const previousMonthWidth = fullHistoryMonthWidth.value;
  const firstVisibleMonthIndex =
    props.fullHistory && historyElement && previousMonthWidth > 0
      ? Math.round(historyElement.scrollLeft / previousMonthWidth)
      : null;
  const shouldFollowLatest = historyFollowLatest;
  const normalizedWidth = Math.max(Math.round(width), 280);
  viewWidth.value = normalizedWidth;
  if (isFullscreen.value && typeof window !== "undefined") {
    viewHeight.value = Math.max(
      500,
      Math.min(Math.round(window.innerHeight - 420), 680),
    );
  } else {
    viewHeight.value =
      normalizedWidth < 520
        ? 340
        : normalizedWidth < 800
          ? 390
          : normalizedWidth < 1280
            ? 440
            : 500;
  }
  if (props.fullHistory && firstVisibleMonthIndex !== null) {
    void nextTick(() => {
      const element = historyScrollRef.value;
      if (!element) return;
      if (shouldFollowLatest) {
        scrollFullHistoryToLatest();
        return;
      }
      element.scrollLeft = firstVisibleMonthIndex * fullHistoryMonthWidth.value;
      handleHistoryScroll();
    });
  }
}

function measureCanvas(element: HTMLElement) {
  const measuredWidth =
    element.getBoundingClientRect().width || element.clientWidth;
  updateCanvasSize(measuredWidth || viewWidth.value);
}

function observeCanvas(
  element: HTMLElement | null,
  previousElement?: HTMLElement | null,
) {
  if (previousElement) resizeObserver?.unobserve(previousElement);
  if (!element) return;
  measureCanvas(element);
  resizeObserver?.observe(element);
}

function refreshCanvasAfterFullscreenChange() {
  if (!canvasRef.value) return;
  measureCanvas(canvasRef.value);
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      if (canvasRef.value) measureCanvas(canvasRef.value);
    });
  }
}

function handleFullscreenChange() {
  isFullscreen.value = document.fullscreenElement === cardRef.value;
  fullscreenError.value = "";
  refreshCanvasAfterFullscreenChange();
}

async function toggleFullscreen() {
  fullscreenError.value = "";
  try {
    if (document.fullscreenElement === cardRef.value) {
      await document.exitFullscreen();
      return;
    }
    if (!cardRef.value?.requestFullscreen) {
      throw new Error("FULLSCREEN_UNSUPPORTED");
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    await cardRef.value.requestFullscreen();
  } catch {
    fullscreenError.value =
      "当前浏览器暂不支持趋势图全屏，请使用浏览器自带的全屏功能。";
  }
}

watch(
  canvasRef,
  (element, previousElement) => {
    observeCanvas(element, previousElement);
  },
  { flush: "post" },
);

onMounted(() => {
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  if (typeof window.ResizeObserver === "undefined") {
    if (canvasRef.value) measureCanvas(canvasRef.value);
    return;
  }
  resizeObserver = new window.ResizeObserver((entries) => {
    if (entries[0]) updateCanvasSize(entries[0].contentRect.width);
  });
  observeCanvas(canvasRef.value);
});

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  if (historyWheelSnapTimer !== null) {
    globalThis.clearTimeout(historyWheelSnapTimer);
    historyWheelSnapTimer = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.financial-trend-card {
  min-width: 0;
  padding: 26px 30px 22px;
  border: 1px solid var(--report-border, #dce8e8);
  border-radius: 16px;
  background:
    radial-gradient(circle at 92% 0%, rgb(24 132 139 / 8%), transparent 30%),
    #ffffff;
  box-shadow: 0 14px 36px rgb(31 68 76 / 7%);
  color: #172033;
}

.financial-trend-card:fullscreen,
.financial-trend-card.is-fullscreen {
  width: 100vw;
  height: 100vh;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 28px 36px 22px;
  border: 0;
  border-radius: 0;
  background:
    radial-gradient(circle at 92% 0%, rgb(24 132 139 / 9%), transparent 30%),
    #ffffff;
}

.trend-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.trend-heading-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-end;
  gap: 12px;
}

.trend-heading h2,
.trend-heading p {
  margin: 0;
}

.trend-heading h2 {
  margin-top: 5px;
  font-size: 22px;
  line-height: 1.3;
}

.trend-heading p {
  margin-top: 6px;
  color: #71808b;
  font-size: 13px;
  line-height: 1.6;
}

.trend-kicker {
  color: #167c84;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.trend-selectors {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  gap: 12px;
}

.view-year-select,
.view-month-select,
.region-select,
.history-year-select {
  display: grid;
  width: 150px;
  gap: 6px;
  color: #60717d;
  font-size: 12px;
}

.view-year-select :deep(.el-select),
.view-month-select :deep(.el-select),
.region-select :deep(.el-select),
.history-year-select :deep(.el-select) {
  width: 100%;
}

.history-mode-toggle,
.fullscreen-toggle {
  display: inline-flex;
  min-width: 104px;
  height: 32px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid #cfe0e2;
  border-radius: 8px;
  background: #ffffff;
  color: #276d74;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  transition:
    border-color 160ms ease,
    background 160ms ease,
    color 160ms ease;
}

.history-mode-toggle:hover,
.fullscreen-toggle:hover,
.history-mode-toggle.is-active {
  border-color: #167c84;
  background: #eef8f8;
  color: #125f66;
}

.history-mode-toggle:focus-visible,
.fullscreen-toggle:focus-visible {
  outline: 3px solid rgb(22 124 132 / 18%);
  outline-offset: 2px;
}

.fullscreen-toggle svg {
  width: 15px;
  height: 15px;
}

.fullscreen-error {
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px solid #f4c9c5;
  border-radius: 8px;
  background: #fff4f3;
  color: #b44740;
  font-size: 12px;
}

.metric-switch {
  display: flex;
  margin-top: 16px;
  flex-wrap: wrap;
  gap: 8px;
}

.metric-switch button {
  padding: 8px 13px;
  border: 1px solid #dbe7e8;
  border-radius: 999px;
  background: #f8fbfb;
  color: #52636f;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease;
}

.metric-switch button:hover,
.metric-switch button.is-active {
  border-color: #167c84;
  background: #167c84;
  color: #ffffff;
}

.metric-switch button:focus-visible {
  outline: 3px solid rgb(22 124 132 / 20%);
  outline-offset: 2px;
}

.trend-context {
  display: flex;
  min-width: 0;
  margin-top: 12px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #edf2f3;
}

.trend-context > p {
  max-width: 560px;
  margin: 0;
  color: #71808b;
  font-size: 12px;
  line-height: 1.6;
  text-align: right;
}

.trend-legend {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  color: #53636f;
  font-size: 12px;
}

.trend-legend span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.legend-line {
  width: 22px;
  height: 0;
  border-top: 3px solid #167c84;
  border-radius: 999px;
}

.legend-line--history {
  border-color: #7686a1;
  border-top-style: dashed;
}

.current-value-legend i {
  width: 9px;
  height: 9px;
  border: 2px solid #167c84;
  border-radius: 50%;
  background: #ffffff;
}

.confirmed-source-legend i {
  width: 9px;
  height: 9px;
  border: 2px solid #167c84;
  border-radius: 3px;
  background: #167c84;
}

.trend-warning {
  margin-top: 8px;
  padding: 9px 12px;
  border: 1px solid #f1dda9;
  border-radius: 9px;
  background: #fffaf0;
  color: #8a671f;
  font-size: 12px;
  line-height: 1.55;
}

.trend-loading,
.trend-state {
  min-height: 360px;
  margin-top: 14px;
}

.trend-loading {
  padding: 26px 12px;
}

.trend-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 13px;
  background: linear-gradient(180deg, #fbfdfd, #f6f9fa);
  color: #667783;
  text-align: center;
}

.trend-state strong {
  margin-top: 16px;
  color: #354551;
  font-size: 15px;
}

.trend-state p {
  max-width: 520px;
  margin: 7px 20px 0;
  font-size: 13px;
  line-height: 1.6;
}

.trend-state--error strong {
  color: #b94c48;
}

.trend-state :deep(.el-button) {
  margin-top: 16px;
}

.empty-chart-mark {
  display: flex;
  width: 150px;
  height: 58px;
  align-items: flex-end;
  justify-content: space-between;
  border-bottom: 1px solid #cddcde;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 18px,
    rgb(214 227 229 / 68%) 19px
  );
}

.empty-chart-mark i {
  width: 28px;
  border-radius: 5px 5px 0 0;
  background: #b8d3d6;
}

.empty-chart-mark i:nth-child(1) {
  height: 18px;
}

.empty-chart-mark i:nth-child(2) {
  height: 34px;
}

.empty-chart-mark i:nth-child(3) {
  height: 26px;
}

.empty-chart-mark i:nth-child(4) {
  height: 48px;
}

.trend-canvas {
  width: 100%;
  min-width: 0;
  margin-top: 8px;
}

.full-history-shell {
  display: grid;
  min-width: 0;
  margin-top: 8px;
  grid-template-columns: 70px minmax(0, 1fr);
}

.full-history-y-axis {
  position: relative;
  z-index: 2;
  border-right: 1px solid #dfe8e9;
  background: #ffffff;
}

.full-history-y-axis span {
  position: absolute;
  right: 10px;
  color: #81909a;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.full-history-scroll {
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  cursor: grab;
  overscroll-behavior-x: contain;
  scrollbar-color: #a9c5c8 #eef4f4;
  scrollbar-width: thin;
  touch-action: pan-y;
}

.full-history-scroll.is-dragging {
  cursor: grabbing;
  user-select: none;
}

.full-history-scroll:focus-visible {
  outline: 3px solid rgb(22 124 132 / 18%);
  outline-offset: 2px;
}

.full-history-svg {
  max-width: none;
  overflow: hidden;
}

.full-history-month-grid line {
  stroke: #eff4f4;
  stroke-width: 1;
}

.full-history-month-grid line.is-year-boundary {
  stroke: #cbdcde;
  stroke-width: 1.4;
}

.full-history-month-grid text {
  fill: #81909a;
  font-size: 11px;
  font-weight: 500;
}

.full-history-hint {
  margin: 8px 0 0 70px;
  color: #71808b;
  font-size: 12px;
}

.full-history-inspector {
  grid-template-columns: minmax(140px, 0.7fr) minmax(220px, 1fr);
}

.full-history-inspector.has-comparison {
  grid-template-columns: minmax(140px, 0.7fr) repeat(2, minmax(220px, 1fr));
}

.trend-svg {
  display: block;
  width: 100%;
  overflow: visible;
}

.grid-lines line {
  stroke: #e7eeef;
  stroke-width: 1;
}

.grid-lines line.is-zero {
  stroke: #c9d7d9;
}

.grid-lines text,
.month-labels text {
  fill: #81909a;
  font-size: 11px;
  font-weight: 500;
}

.month-hit-areas rect {
  fill: transparent;
  cursor: crosshair;
  pointer-events: all;
}

.active-month-guide line {
  stroke: #8cabad;
  stroke-dasharray: 3 4;
  stroke-width: 1;
}

.active-month-guide rect {
  fill: #215f66;
}

.active-month-guide text {
  fill: #ffffff;
  font-size: 10px;
  font-weight: 700;
}

.series-edge {
  stroke-width: 2.8;
  stroke-linecap: round;
}

.point-value-label-layer,
.point-value-label-group {
  pointer-events: none;
}

.point-value-label-bg {
  fill: #ffffff;
  stroke-width: 0.8px;
  stroke-opacity: 0.18;
}

.point-value-label {
  stroke: rgb(255 255 255 / 96%);
  stroke-width: 2px;
  stroke-linejoin: round;
  paint-order: stroke fill;
  pointer-events: none;
  font-size: 11px;
  font-weight: 700;
}

.point-value-label.is-history {
  font-weight: 600;
}

.trend-series.is-history .series-edge {
  stroke-dasharray: 7 6;
  stroke-width: 2.2;
}

.series-point-group {
  cursor: pointer;
  outline: none;
}

.point-hit-area {
  fill: transparent;
  stroke: none;
}

.series-point {
  stroke-width: 2.2;
  transition: r 140ms ease;
}

.point-halo {
  opacity: 0.14;
}

.series-point-group:focus-visible .series-point {
  stroke-width: 3.5;
}

.month-inspector {
  display: grid;
  margin-top: 10px;
  grid-template-columns: minmax(120px, 0.7fr) repeat(2, minmax(190px, 1fr));
  overflow: hidden;
  border: 1px solid #e1eaeb;
  border-radius: 12px;
  background: #fbfdfd;
}

.inspector-heading,
.month-inspector article {
  display: flex;
  min-width: 0;
  min-height: 68px;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
}

.inspector-heading {
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  background: #f2f8f8;
}

.inspector-heading span {
  color: #75858f;
  font-size: 11px;
}

.inspector-heading strong {
  font-size: 15px;
}

.month-inspector article {
  border-left: 1px solid #e1eaeb;
}

.month-inspector article > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #5e6f7a;
  font-size: 12px;
}

.month-inspector article > span i {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
}

.month-inspector article > strong {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: #243844;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.month-inspector article > small {
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  white-space: nowrap;
}

.month-inspector small.is-closed {
  background: #e9f7ef;
  color: #268453;
}

.month-inspector small.is-current {
  background: #fff4d8;
  color: #9a6a09;
}

.month-inspector small.is-confirmed-source {
  background: #e7f5f4;
  color: #167c84;
}

.month-inspector small.is-ledger-source {
  background: #eef0fb;
  color: #4f5f9d;
}

.month-inspector small.is-missing {
  background: #edf1f3;
  color: #7b8790;
}

.trend-footer {
  display: flex;
  margin-top: 14px;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  padding-top: 10px;
  border-top: 1px solid #edf2f3;
  color: #87949d;
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .trend-context {
    flex-direction: column;
    gap: 9px;
  }

  .trend-context > p {
    max-width: none;
    text-align: left;
  }

  .month-inspector {
    grid-template-columns: 1fr 1fr;
  }

  .inspector-heading {
    grid-column: 1 / -1;
  }

  .month-inspector article:first-of-type {
    border-left: 0;
  }
}

@media (max-width: 720px) {
  .financial-trend-card {
    padding: 18px;
  }

  .trend-heading {
    flex-direction: column;
    gap: 16px;
  }

  .trend-heading-actions {
    width: 100%;
    align-items: stretch;
    flex-direction: column;
  }

  .trend-selectors {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .view-year-select,
  .view-month-select,
  .region-select,
  .history-year-select {
    width: 100%;
  }

  .history-mode-toggle,
  .fullscreen-toggle {
    width: 100%;
  }

  .metric-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .metric-switch button {
    min-width: 0;
  }

  .month-inspector {
    grid-template-columns: 1fr;
  }

  .full-history-shell {
    grid-template-columns: 58px minmax(0, 1fr);
  }

  .full-history-hint {
    margin-left: 58px;
  }

  .inspector-heading {
    grid-column: auto;
  }

  .month-inspector article {
    border-top: 1px solid #e1eaeb;
    border-left: 0;
  }

  .trend-footer {
    flex-direction: column;
    gap: 3px;
  }
}

@media (max-width: 430px) {
  .trend-selectors {
    grid-template-columns: 1fr;
  }

  .metric-switch {
    grid-template-columns: 1fr;
  }

  .trend-legend {
    align-items: flex-start;
    flex-direction: column;
    gap: 9px;
  }

  .month-inspector article {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .month-inspector article > strong {
    width: 100%;
    order: 3;
    margin-left: 0;
  }
}
</style>
