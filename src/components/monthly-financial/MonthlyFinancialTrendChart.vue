<template>
  <section
    ref="cardRef"
    class="financial-trend-card"
    :class="{ 'is-fullscreen': isFullscreen }"
    aria-labelledby="financial-trend-title"
  >
    <header class="trend-heading">
      <div>
        <span class="trend-kicker">年度资金趋势</span>
        <h2 id="financial-trend-title">月度财务趋势</h2>
        <p>按自然月对比选定年度与历史年度，缺失月份保留断点。</p>
      </div>

      <div class="trend-heading-actions">
        <div class="trend-selectors">
          <label class="view-month-select">
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

          <label class="history-year-select">
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
          {{ selectedYear }}年（选定年度）
        </span>
        <span v-if="comparisonYear !== null">
          <i class="legend-line legend-line--history" aria-hidden="true"></i>
          {{ comparisonYear }}年（历史对比）
        </span>
        <span class="current-value-legend">
          <i aria-hidden="true"></i>
          空心点表示当前值（未月结）
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
      <p>生成并保存月度财务报表后，系统将在对应月份显示趋势点。</p>
    </div>

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
                {{ formatAxisAmount(tick.value) }}
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
              <circle
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

      <div v-if="activeMonthDetail" class="month-inspector" aria-live="polite">
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
          <strong>{{ formatExactAmount(detail.value) }}</strong>
          <small :class="`is-${detail.state}`">{{ detail.stateLabel }}</small>
        </article>
      </div>
    </template>

    <footer class="trend-footer">
      <span>金额明细来自服务端精确金额字符串，前端不做估算。</span>
      <span>有效月份已在折线点旁标注精准金额，点选月份可查看完整状态。</span>
      <span>缺失月份不按零金额参与连线。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { FullScreen } from "@element-plus/icons-vue";
import type {
  MonthlyFinancialAmount,
  MonthlyFinancialTrendPoint,
  MonthlyFinancialTrendWarning,
} from "@/types/monthlyFinancialReport";

type TrendMetricKey =
  | "closingTotal"
  | "actualReceipt"
  | "settlementInflow"
  | "totalOutflow"
  | "netChange";

interface TrendMetricOption {
  key: TrendMetricKey;
  label: string;
  note: string;
}

interface RawSeriesPoint {
  index: number;
  value: MonthlyFinancialAmount;
  numericValue: number;
  source: MonthlyFinancialTrendPoint;
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
}

const props = withDefaults(
  defineProps<{
    selectedYear: number;
    selectedMonth?: string;
    comparisonYear?: number | null;
    availableYears?: number[];
    points?: MonthlyFinancialTrendPoint[];
    warnings?: MonthlyFinancialTrendWarning[];
    loading?: boolean;
    error?: string;
  }>(),
  {
    selectedMonth: "",
    comparisonYear: null,
    availableYears: () => [],
    points: () => [],
    warnings: () => [],
    loading: false,
    error: "",
  },
);

const emit = defineEmits<{
  "comparison-year-change": [year: number | null];
  retry: [];
}>();

const metricOptions: TrendMetricOption[] = [
  {
    key: "closingTotal",
    label: "期末资金",
    note: "四账户期末余额合计；已月结月份显示月结值，未月结月份显示当前值（未月结）。",
  },
  {
    key: "actualReceipt",
    label: "主营实际到账",
    note: "仅统计已确认的主营业务银行实际回款，不等同于四账户结算流入。",
  },
  {
    key: "settlementInflow",
    label: "四账户结算流入",
    note: "一般、商务及两个福利账户的当月结算流入合计。",
  },
  {
    key: "totalOutflow",
    label: "四账户结算流出",
    note: "一般、商务及两个福利账户的当月结算流出合计。",
  },
  {
    key: "netChange",
    label: "四账户净变化",
    note: "四账户结算流入－四账户结算流出＝期末资金－期初资金；不等于主营实际到账－结算流出，也不代表利润。",
  },
];

const activeMetricKey = ref<TrendMetricKey>("closingTotal");
const activeMonthIndex = ref<number | null>(null);
const monthNumbers = Array.from({ length: 12 }, (_item, index) => index + 1);
const cardRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLElement | null>(null);
const isFullscreen = ref(false);
const fullscreenError = ref("");
const viewWidth = ref(900);
const viewHeight = ref(500);
const plotTop = 30;
const plotBottom = computed(() => viewHeight.value - 58);
const tickCount = 5;
let resizeObserver: InstanceType<typeof globalThis.ResizeObserver> | null =
  null;

const plotLeft = computed(() => (viewWidth.value < 520 ? 58 : 78));
const plotRight = computed(() => Math.max(viewWidth.value - 24, 220));

const activeMetric = computed(
  () =>
    metricOptions.find((metric) => metric.key === activeMetricKey.value) ||
    metricOptions[0],
);

const historyYearOptions = computed(() =>
  [...new Set(props.availableYears)]
    .filter((year) => Number.isInteger(year) && year < props.selectedYear)
    .sort((left, right) => right - left),
);

const pointsByMonth = computed(
  () => new Map(props.points.map((point) => [point.month, point])),
);

function yearPoint(year: number, monthIndex: number) {
  return pointsByMonth.value.get(
    `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
  );
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
    const value = source[activeMetricKey.value];
    if (value === null || value === undefined || !isAmountText(value)) continue;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) continue;
    points.push({ index, value, numericValue, source });
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

const numericValues = computed(() =>
  rawSeries.value.flatMap((series) =>
    series.points.map((point) => point.numericValue),
  ),
);

const hasData = computed(() => numericValues.value.length > 0);

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
      isCurrent: point.source.valueState === "current",
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
    const text = formatExactAmount(point.value);
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

const availableMonthIndexes = computed(
  () =>
    new Set(
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
    if (monthIndex !== null) activeMonthIndex.value = monthIndex;
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
    const value = point?.[activeMetricKey.value] ?? null;
    const available = value !== null && value !== undefined;
    const valueState = available ? point?.valueState : null;
    return {
      ...series,
      value,
      state:
        valueState === "closed"
          ? "closed"
          : valueState === "current"
            ? "current"
            : "missing",
      stateLabel:
        valueState === "closed"
          ? "月结值"
          : valueState === "current"
            ? "当前值（未月结）"
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
    ...new Set(props.warnings.map((warning) => warning.message)),
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

function selectMonth(index: number) {
  if (!Number.isInteger(index) || index < 0 || index > 11) return;
  activeMonthIndex.value = index;
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

function pointAriaLabel(series: PlottedSeries, point: PlottedSeriesPoint) {
  return `${series.year}年${point.index + 1}月，${activeMetric.value.label}${formatExactAmount(point.value)}，${point.isCurrent ? "当前值（未月结）" : "月结值"}`;
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
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value).trim();
  const match = text.match(/^([+-]?)(\d+)(\.\d+)?$/);
  if (!match) return text;
  const integer = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `¥${match[1]}${integer}${match[3] || ""}`;
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

function trimAxisValue(value: number) {
  return Number(value.toFixed(1)).toString();
}

function isZero(value: number) {
  return Math.abs(value) < Number.EPSILON * 100;
}

function updateCanvasSize(width: number) {
  const normalizedWidth = Math.max(Math.round(width), 280);
  viewWidth.value = normalizedWidth;
  if (isFullscreen.value && typeof window !== "undefined") {
    viewHeight.value = Math.max(
      500,
      Math.min(Math.round(window.innerHeight - 420), 680),
    );
    return;
  }
  viewHeight.value =
    normalizedWidth < 520
      ? 340
      : normalizedWidth < 800
        ? 390
        : normalizedWidth < 1280
          ? 440
          : 500;
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

.view-month-select,
.history-year-select {
  display: grid;
  width: 150px;
  gap: 6px;
  color: #60717d;
  font-size: 12px;
}

.view-month-select :deep(.el-select),
.history-year-select :deep(.el-select) {
  width: 100%;
}

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

.fullscreen-toggle:hover {
  border-color: #167c84;
  background: #eef8f8;
  color: #125f66;
}

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

  .view-month-select,
  .history-year-select {
    width: 100%;
  }

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
