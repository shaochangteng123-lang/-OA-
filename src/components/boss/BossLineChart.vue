<template>
  <section
    class="boss-line-chart"
    :class="{ 'is-interacting': activePoint, 'is-live': live }"
    :aria-label="title"
  >
    <header class="chart-header">
      <div class="title-wrap">
        <div>
          <h3 class="chart-title">{{ title }}</h3>
          <p v-if="subtitle" class="chart-subtitle">{{ subtitle }}</p>
        </div>
      </div>

      <div class="chart-status">
        <span class="chart-live-label">
          <i v-if="live" aria-hidden="true"></i>
          {{
            syncing
              ? "正在同步"
              : live && refreshCountdown !== null
                ? `上下动态 · ${refreshCountdown}秒同步`
                : live
                  ? "上下动态"
                  : "最新数据"
          }}
          · {{ displayPeriod }}
        </span>
        <strong v-if="headlineValue" :style="{ color: headlineValue.color }">
          {{ headlineValue.name }}
          <b>{{ formatValue(headlineValue.value) }}</b>
        </strong>
        <strong v-else>当前暂无有效数据</strong>
      </div>
    </header>

    <div class="chart-legend" aria-label="图表指标">
      <button
        v-for="item in series"
        :key="item.key"
        type="button"
        class="legend-item"
        :class="{ 'is-hidden': !isSeriesVisible(item.key) }"
        :aria-pressed="isSeriesVisible(item.key)"
        :title="
          isSeriesVisible(item.key) ? `隐藏${item.name}` : `显示${item.name}`
        "
        @click="toggleSeries(item.key)"
      >
        <i :style="{ background: item.color }" aria-hidden="true"></i>
        <span>
          {{ item.name }}
          <small>{{ getSeriesDisplayValue(item) }}</small>
        </span>
      </button>

      <span v-if="hasMissingValue" class="missing-hint">
        <i class="missing-line" aria-hidden="true"></i>
        缺失月份保持断点
      </span>
    </div>

    <div ref="canvasRef" class="chart-canvas">
      <svg
        v-if="hasData"
        class="chart-svg"
        :viewBox="`0 0 ${viewWidth} ${viewHeight}`"
        role="img"
        :aria-label="`${title}经营趋势折线图，可通过图例切换指标，通过数据点查看明细`"
        preserveAspectRatio="xMidYMid meet"
        @mouseleave="clearActivePoint"
      >
        <g class="grid-lines">
          <template v-for="tick in yTicks" :key="tick.value">
            <line
              :class="{ 'zero-line': isZeroTick(tick.value) }"
              :x1="plotLeft"
              :x2="plotRight"
              :y1="tick.y"
              :y2="tick.y"
            />
            <text :x="plotLeft - 12" :y="tick.y + 4" text-anchor="end">
              {{ formatAxisValue(tick.value) }}
            </text>
          </template>
        </g>

        <g class="x-labels">
          <template
            v-for="item in visibleXLabels"
            :key="`${item.label}-${item.index}`"
          >
            <text
              :x="getX(item.index)"
              :y="plotBottom + 23"
              text-anchor="middle"
            >
              {{ formatMonthLabel(item.label, item.index) }}
            </text>
          </template>
        </g>

        <g class="series-areas" aria-hidden="true">
          <template v-for="line in chartLines" :key="`area-${line.key}`">
            <template v-if="line.isPrimary">
              <path
                v-for="(area, areaIndex) in line.areas"
                :key="`${line.key}-area-${areaIndex}`"
                class="series-area"
                :d="area"
                :fill="line.color"
                fill-opacity="0.08"
                pointer-events="none"
              />
            </template>
          </template>
        </g>

        <g class="hover-bands" aria-hidden="true">
          <rect
            v-for="band in hoverBands"
            :key="`band-${band.index}`"
            :x="band.x"
            :y="plotTop"
            :width="band.width"
            :height="plotBottom - plotTop"
            fill="transparent"
            fill-opacity="0"
            pointer-events="all"
            @mouseenter="setActiveIndex(band.index)"
            @mousemove="setActiveIndex(band.index)"
          />
        </g>

        <g v-if="activePoint" class="active-guide" aria-hidden="true">
          <line
            class="active-guide-vertical"
            :x1="activePoint.x"
            :x2="activePoint.x"
            :y1="plotTop"
            :y2="plotBottom"
          />
          <line
            class="active-guide-horizontal"
            :x1="plotLeft"
            :x2="plotRight"
            :y1="activePoint.y"
            :y2="activePoint.y"
          />
          <rect
            class="active-month-tag"
            :x="activePoint.x - 23"
            :y="plotBottom + 8"
            width="46"
            height="21"
            rx="7"
            fill="#1c666f"
          />
          <text :x="activePoint.x" :y="plotBottom + 22" text-anchor="middle">
            {{ shortMonthLabel(activePoint.label) }}
          </text>
          <rect
            class="active-value-tag"
            :x="plotLeft - 66"
            :y="activePoint.y - 10"
            width="60"
            height="20"
            rx="6"
            fill="#1c666f"
          />
          <text
            class="active-value-text"
            :x="plotLeft - 36"
            :y="activePoint.y + 3.5"
            text-anchor="middle"
          >
            {{ formatQuoteValue(activePoint.value) }}
          </text>
        </g>

        <g
          v-for="(line, lineIndex) in chartLines"
          :key="line.key"
          class="series-group"
          :style="{
            '--wave-duration': `${line.isPrimary ? 4 : 4.8 + lineIndex * 0.4}s`,
            '--wave-delay': `${-lineIndex * 0.72}s`,
            '--wave-up': line.isPrimary ? '-2.2px' : '-1.1px',
            '--wave-down': line.isPrimary ? '1.6px' : '0.8px',
          }"
        >
          <path
            v-for="(segment, segmentIndex) in line.segments"
            :key="`${line.key}-${segmentIndex}`"
            class="series-line"
            :class="{ 'is-primary': line.isPrimary }"
            :d="segment"
            :stroke="line.color"
            :stroke-width="line.isPrimary ? 3 : 1.8"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />

          <g
            v-for="point in line.points"
            :key="`${line.key}-${point.index}`"
            class="point-group"
            :class="{
              'is-active':
                activePoint?.seriesId === line.key &&
                activePoint.index === point.index,
              'is-latest': line.isPrimary && point.index === line.latestIndex,
            }"
            :tabindex="point.index === line.latestIndex ? 0 : -1"
            role="button"
            :aria-label="`${labels[point.index]}，${line.name}${formatValue(point.value)}，按回车查看明细`"
            @mouseenter="
              setActivePoint(
                point.index,
                point.value,
                line.key,
                line.name,
                line.color,
              )
            "
            @focus="
              setActivePoint(
                point.index,
                point.value,
                line.key,
                line.name,
                line.color,
              )
            "
            @blur="clearActivePoint"
            @click="selectPoint(point, line)"
            @keydown.enter.prevent="selectPoint(point, line)"
            @keydown.space.prevent="selectPoint(point, line)"
          >
            <circle
              v-if="
                activePoint?.seriesId === line.key &&
                activePoint.index === point.index
              "
              class="point-halo"
              :cx="point.x"
              :cy="point.y"
              r="10"
              :fill="line.color"
            />
            <circle
              class="point-hit-area"
              :cx="point.x"
              :cy="point.y"
              r="13"
              fill="transparent"
              fill-opacity="0"
            />
            <circle
              class="series-point"
              :cx="point.x"
              :cy="point.y"
              r="4"
              :fill="line.color"
            >
              <title>
                {{ labels[point.index] }}，{{ line.name }}：{{
                  formatValue(point.value)
                }}
              </title>
            </circle>
          </g>
        </g>

        <g
          v-if="live && latestQuote"
          class="latest-quote"
          :class="[
            `is-${latestQuote.direction}`,
            {
              'is-muted': activePoint,
            },
          ]"
          aria-hidden="true"
        >
          <line
            class="latest-quote-now"
            :x1="latestQuote.x"
            :x2="latestQuote.x"
            :y1="plotTop"
            :y2="plotBottom"
            :stroke="latestQuote.color"
          />
          <line
            class="latest-quote-guide"
            :x1="latestQuote.x"
            :x2="latestQuote.tagX"
            :y1="latestQuote.y"
            :y2="latestQuote.y"
            :stroke="latestQuote.color"
          />
          <circle
            class="latest-quote-halo"
            :cx="latestQuote.x"
            :cy="latestQuote.y"
            r="8"
            fill="none"
            :stroke="latestQuote.color"
          />
          <circle
            class="latest-quote-point"
            :cx="latestQuote.x"
            :cy="latestQuote.y"
            r="4.5"
            :fill="latestQuote.color"
          />
          <g
            class="latest-quote-tag"
            :transform="`translate(${latestQuote.tagX}, ${latestQuote.tagY})`"
          >
            <rect
              :width="quoteTagWidth"
              :height="quoteTagHeight"
              rx="7"
              :fill="latestQuote.color"
            />
            <text
              class="latest-quote-value"
              :x="quoteTagWidth / 2"
              y="13"
              text-anchor="middle"
              fill="#ffffff"
            >
              {{ latestQuote.valueText }}
            </text>
            <text
              class="latest-quote-change"
              :x="quoteTagWidth / 2"
              y="26"
              text-anchor="middle"
              fill="#ffffff"
            >
              {{ latestQuote.changeText }}
            </text>
          </g>
        </g>
      </svg>

      <div v-else class="chart-empty">
        <div class="empty-illustration" aria-hidden="true">
          <span class="empty-grid"></span>
          <svg viewBox="0 0 156 58">
            <path d="M4 48 C25 43 33 20 55 29 S82 44 102 20 S130 14 152 5" />
            <circle cx="55" cy="29" r="3" />
            <circle cx="102" cy="20" r="3" />
            <circle cx="152" cy="5" r="3" />
          </svg>
        </div>
        <strong>{{ resolvedEmptyText }}</strong>
        <span>{{
          hasSourceData
            ? "请从上方图例重新选择需要分析的指标"
            : "有真实业务数据后将自动生成经营趋势"
        }}</span>
      </div>
    </div>

    <footer class="chart-footer">
      <span class="data-state">
        <i></i>
        {{ live ? "真实业务数据 · 自动同步" : "真实业务数据" }}
      </span>
      <span>{{
        activePoint
          ? "点击当前节点查看月度构成"
          : live
            ? "折线仅做轻微上下跳动"
            : "悬停趋势查看当月数值"
      }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

export interface BossChartSeries {
  key: string;
  name: string;
  color: string;
  values: Array<number | null>;
}

export interface BossChartPointClickPayload {
  seriesId: string;
  seriesLabel: string;
  index: number;
  label: string;
  value: number;
}

interface ChartPoint {
  index: number;
  value: number;
  x: number;
  y: number;
}

interface ChartLine {
  key: string;
  name: string;
  color: string;
  isPrimary: boolean;
  latestIndex: number;
  points: ChartPoint[];
  segments: string[];
  areas: string[];
}

interface ActivePoint {
  index: number;
  label: string;
  seriesId: string;
  seriesName: string;
  color: string;
  value: number;
  x: number;
  y: number;
}

type QuoteDirection = "up" | "down" | "flat";

interface LatestQuote {
  x: number;
  y: number;
  tagX: number;
  tagY: number;
  color: string;
  direction: QuoteDirection;
  valueText: string;
  changeText: string;
}

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    labels: string[];
    series: BossChartSeries[];
    unit?: string;
    currency?: boolean;
    emptyText?: string;
    live?: boolean;
    syncing?: boolean;
    refreshCountdown?: number | null;
  }>(),
  {
    subtitle: "",
    unit: "元",
    currency: true,
    emptyText: "当前数据尚未接入",
    live: true,
    syncing: false,
    refreshCountdown: null,
  },
);

const emit = defineEmits<{
  (event: "point-click", payload: BossChartPointClickPayload): void;
}>();

const viewWidth = ref(760);
const viewHeight = 292;
const plotLeft = 72;
const quoteTagWidth = 76;
const quoteTagHeight = 32;
const plotRight = computed(() =>
  Math.max(viewWidth.value - quoteTagWidth - 14, plotLeft + 110),
);
const plotTop = 22;
const plotBottom = 242;
const tickCount = 4;
const canvasRef = ref<HTMLElement | null>(null);
const activePoint = ref<ActivePoint | null>(null);
const hiddenSeriesKeys = ref<Set<string>>(new Set());
const renderedSeries = ref<BossChartSeries[]>(cloneSeries(props.series));
const prefersReducedMotion = ref(false);
let resizeObserver: {
  observe: (target: Element) => void;
  disconnect: () => void;
} | null = null;
let animationFrame: number | null = null;
let motionMediaQuery: ReturnType<typeof window.matchMedia> | null = null;
let motionPreferenceHandler: (() => void) | null = null;

const visibleSeries = computed(() =>
  renderedSeries.value.filter((item) => !hiddenSeriesKeys.value.has(item.key)),
);

const sourceNumericValues = computed(() =>
  props.series.flatMap((item) =>
    item.values.filter((value): value is number => Number.isFinite(value)),
  ),
);

const numericValues = computed(() =>
  visibleSeries.value.flatMap((item) =>
    item.values.filter((value): value is number => Number.isFinite(value)),
  ),
);

const hasSourceData = computed(() => sourceNumericValues.value.length > 0);
const hasData = computed(() => numericValues.value.length > 0);

const resolvedEmptyText = computed(() =>
  hasSourceData.value ? "当前未选择分析指标" : props.emptyText,
);

const hasMissingValue = computed(
  () =>
    props.labels.length > 0 &&
    visibleSeries.value.some((item) =>
      props.labels.some(
        (_label, index) => !Number.isFinite(item.values[index]),
      ),
    ),
);

watch(
  () => props.series.map((item) => item.key),
  (keys) => {
    const availableKeys = new Set(keys);
    hiddenSeriesKeys.value = new Set(
      [...hiddenSeriesKeys.value].filter((key) => availableKeys.has(key)),
    );
    if (
      activePoint.value &&
      (!availableKeys.has(activePoint.value.seriesId) ||
        hiddenSeriesKeys.value.has(activePoint.value.seriesId))
    ) {
      clearActivePoint();
    }
  },
);

watch(
  () => ({
    labels: [...props.labels],
    series: cloneSeries(props.series),
  }),
  (nextState, previousState) => {
    const dataChanged =
      !previousState ||
      !isSeriesDataEqual(previousState.series, nextState.series) ||
      !isStringArrayEqual(previousState.labels, nextState.labels);

    if (!dataChanged) {
      return;
    }

    clearActivePoint();
    stopValueAnimation();

    const canInterpolate =
      Boolean(previousState) &&
      isStringArrayEqual(previousState.labels, nextState.labels) &&
      hasMatchingSeriesShape(renderedSeries.value, nextState.series);

    if (
      !canInterpolate ||
      prefersReducedMotion.value ||
      typeof window === "undefined" ||
      document.hidden
    ) {
      renderedSeries.value = cloneSeries(nextState.series);
      return;
    }

    animateSeriesValues(renderedSeries.value, nextState.series);
  },
  { deep: true },
);

const axisRange = computed(() => {
  if (!hasData.value) {
    return { min: 0, max: 1 };
  }

  const rawMin = Math.min(...numericValues.value, 0);
  const rawMax = Math.max(...numericValues.value, 0);
  const rawSpan = rawMax - rawMin;
  const safeSpan =
    rawSpan === 0 ? Math.max(Math.abs(rawMax), Math.abs(rawMin), 1) : rawSpan;
  const step = niceNumber((safeSpan * 1.08) / (tickCount - 1));

  if (rawMin >= 0) {
    return {
      min: 0,
      max: step * (tickCount - 1),
    };
  }
  if (rawMax <= 0) {
    return {
      min: -step * (tickCount - 1),
      max: 0,
    };
  }

  let min = Math.floor(rawMin / step) * step;
  let max = min + step * (tickCount - 1);
  if (max < rawMax) {
    max = Math.ceil(rawMax / step) * step;
    min = max - step * (tickCount - 1);
  }

  return { min, max };
});

const yTicks = computed(() => {
  const { min, max } = axisRange.value;
  return Array.from({ length: tickCount }, (_item, index) => {
    const ratio = index / (tickCount - 1);
    const value = max - (max - min) * ratio;
    return {
      value,
      y: plotTop + (plotBottom - plotTop) * ratio,
    };
  });
});

const axisDisplay = computed(() => {
  const maximum = Math.max(
    Math.abs(axisRange.value.min),
    Math.abs(axisRange.value.max),
  );
  if (maximum >= 100000000) {
    return { divisor: 100000000, suffix: "亿" };
  }
  if (maximum >= 10000) {
    return { divisor: 10000, suffix: "万" };
  }
  return { divisor: 1, suffix: "" };
});

const visibleXLabels = computed(() => {
  const count = props.labels.length;
  const maximumLabels =
    viewWidth.value < 460 ? 5 : viewWidth.value < 720 ? 7 : 11;
  if (count <= maximumLabels) {
    return props.labels.map((label, index) => ({ label, index }));
  }

  const step = Math.ceil((count - 1) / Math.max(maximumLabels - 1, 1));
  const candidates = props.labels
    .map((label, index) => ({ label, index }))
    .filter(
      ({ index }) => index === 0 || index === count - 1 || index % step === 0,
    );
  return candidates.slice(0, maximumLabels);
});

const hoverBands = computed(() =>
  props.labels.map((_label, index) => {
    const currentX = getX(index);
    const previousX = index === 0 ? plotLeft : getX(index - 1);
    const nextX =
      index === props.labels.length - 1 ? plotRight.value : getX(index + 1);
    const start = index === 0 ? plotLeft : (previousX + currentX) / 2;
    const end =
      index === props.labels.length - 1
        ? plotRight.value
        : (currentX + nextX) / 2;
    return {
      index,
      x: start,
      width: Math.max(end - start, 1),
    };
  }),
);

function getX(index: number) {
  if (props.labels.length <= 1) {
    return (plotLeft + plotRight.value) / 2;
  }
  return (
    plotLeft +
    ((plotRight.value - plotLeft) * index) /
      Math.max(props.labels.length - 1, 1)
  );
}

function getY(value: number) {
  const { min, max } = axisRange.value;
  const ratio = (value - min) / Math.max(max - min, 1);
  return plotBottom - ratio * (plotBottom - plotTop);
}

const chartLines = computed<ChartLine[]>(() =>
  visibleSeries.value.map((item, seriesIndex) => {
    const pointSegments: ChartPoint[][] = [];
    let currentSegment: ChartPoint[] = [];

    item.values.forEach((value, index) => {
      if (!Number.isFinite(value) || index >= props.labels.length) {
        if (currentSegment.length > 0) {
          pointSegments.push(currentSegment);
          currentSegment = [];
        }
        return;
      }

      currentSegment.push({
        index,
        value: value as number,
        x: getX(index),
        y: getY(value as number),
      });
    });

    if (currentSegment.length > 0) {
      pointSegments.push(currentSegment);
    }

    return {
      key: item.key,
      name: item.name,
      color: item.color,
      isPrimary: seriesIndex === 0,
      latestIndex:
        [...item.values]
          .slice(0, props.labels.length)
          .map((value, index) => ({ value, index }))
          .filter(({ value }) => Number.isFinite(value))
          .at(-1)?.index ?? -1,
      points: pointSegments.flat(),
      segments: pointSegments.map(buildSmoothPath),
      areas: pointSegments.map(buildAreaPath),
    };
  }),
);

const latestAvailableIndex = computed(() => {
  for (let index = props.labels.length - 1; index >= 0; index -= 1) {
    if (
      visibleSeries.value.some((item) => Number.isFinite(item.values[index]))
    ) {
      return index;
    }
  }
  return -1;
});

const displayIndex = computed(
  () => activePoint.value?.index ?? latestAvailableIndex.value,
);

const displayPeriod = computed(() => {
  const label = props.labels[latestAvailableIndex.value];
  return label ? displayPeriodLabel(label) : "当前周期";
});

const headlineValue = computed(() => {
  const index = latestAvailableIndex.value;
  const item = visibleSeries.value.find((series) =>
    Number.isFinite(series.values[index]),
  );
  const value = item?.values[index];
  if (!item || !Number.isFinite(value)) {
    return null;
  }

  return {
    name: item.name,
    value: value as number,
    color: item.color,
  };
});

const latestQuote = computed<LatestQuote | null>(() => {
  const primaryLine = chartLines.value.find((line) => line.isPrimary);
  if (!primaryLine || primaryLine.latestIndex < 0) {
    return null;
  }

  const latestPoint = primaryLine.points.find(
    (point) => point.index === primaryLine.latestIndex,
  );
  if (!latestPoint) {
    return null;
  }

  const previousPoint = [...primaryLine.points]
    .filter((point) => point.index < latestPoint.index)
    .at(-1);
  const delta = previousPoint ? latestPoint.value - previousPoint.value : null;
  const direction: QuoteDirection =
    delta === null || Math.abs(delta) < Number.EPSILON
      ? "flat"
      : delta > 0
        ? "up"
        : "down";
  const color =
    direction === "up"
      ? "#d65b66"
      : direction === "down"
        ? "#2b9d7b"
        : "#607184";
  const tagX = plotRight.value + 7;

  return {
    x: latestPoint.x,
    y: latestPoint.y,
    tagX,
    tagY: Math.min(
      Math.max(latestPoint.y - quoteTagHeight / 2, plotTop),
      plotBottom - quoteTagHeight,
    ),
    color,
    direction,
    valueText: formatQuoteValue(latestPoint.value),
    changeText: formatQuoteChange(delta, previousPoint?.value ?? null),
  };
});

function niceNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
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

function cloneSeries(series: BossChartSeries[]) {
  return series.map((item) => ({
    ...item,
    values: [...item.values],
  }));
}

function isStringArrayEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isSeriesDataEqual(left: BossChartSeries[], right: BossChartSeries[]) {
  return (
    hasMatchingSeriesShape(left, right) &&
    left.every((item, seriesIndex) =>
      item.values.every(
        (value, valueIndex) => value === right[seriesIndex].values[valueIndex],
      ),
    )
  );
}

function hasMatchingSeriesShape(
  left: BossChartSeries[],
  right: BossChartSeries[],
) {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.key === right[index].key &&
        item.values.length === right[index].values.length,
    )
  );
}

function stopValueAnimation() {
  if (animationFrame !== null) {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
}

function animateSeriesValues(
  fromSeries: BossChartSeries[],
  toSeries: BossChartSeries[],
) {
  const startedAt = window.performance.now();
  const duration = 720;
  const fromSnapshot = cloneSeries(fromSeries);
  const toSnapshot = cloneSeries(toSeries);

  const renderFrame = (timestamp: number) => {
    const progress = Math.min((timestamp - startedAt) / duration, 1);
    const easedProgress = 1 - (1 - progress) ** 3;

    renderedSeries.value = toSnapshot.map((targetSeries, seriesIndex) => ({
      ...targetSeries,
      values: targetSeries.values.map((targetValue, valueIndex) => {
        const sourceValue = fromSnapshot[seriesIndex].values[valueIndex];
        if (!Number.isFinite(sourceValue) || !Number.isFinite(targetValue)) {
          return targetValue;
        }
        return (
          (sourceValue as number) +
          ((targetValue as number) - (sourceValue as number)) * easedProgress
        );
      }),
    }));

    if (progress < 1) {
      animationFrame = window.requestAnimationFrame(renderFrame);
      return;
    }

    renderedSeries.value = toSnapshot;
    animationFrame = null;
  };

  animationFrame = window.requestAnimationFrame(renderFrame);
}

function buildSmoothPath(points: ChartPoint[]) {
  if (points.length === 0) {
    return "";
  }
  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x} ${point.y} L ${point.x + 0.01} ${point.y}`;
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middleX = (previous.x + current.x) / 2;
    commands.push(
      `C ${middleX} ${previous.y}, ${middleX} ${current.y}, ${current.x} ${current.y}`,
    );
  }
  return commands.join(" ");
}

function buildAreaPath(points: ChartPoint[]) {
  if (points.length === 0) {
    return "";
  }
  const first = points[0];
  const last = points[points.length - 1];
  return `${buildSmoothPath(points)} L ${last.x} ${plotBottom} L ${first.x} ${plotBottom} Z`;
}

function isSeriesVisible(key: string) {
  return !hiddenSeriesKeys.value.has(key);
}

function toggleSeries(key: string) {
  const nextKeys = new Set(hiddenSeriesKeys.value);
  if (nextKeys.has(key)) {
    nextKeys.delete(key);
  } else {
    nextKeys.add(key);
  }
  hiddenSeriesKeys.value = nextKeys;

  if (activePoint.value?.seriesId === key && nextKeys.has(key)) {
    setActiveIndex(activePoint.value.index);
  }
}

function getSeriesDisplayValue(item: BossChartSeries) {
  const renderedItem =
    renderedSeries.value.find((series) => series.key === item.key) || item;
  const value = renderedItem.values[displayIndex.value];
  return Number.isFinite(value) ? formatValue(value as number) : "数据缺失";
}

function setActiveIndex(index: number) {
  if (
    activePoint.value?.index === index &&
    isSeriesVisible(activePoint.value.seriesId)
  ) {
    return;
  }

  const firstAvailableSeries = visibleSeries.value.find((item) =>
    Number.isFinite(item.values[index]),
  );
  const value = firstAvailableSeries?.values[index];
  if (!firstAvailableSeries || !Number.isFinite(value)) {
    clearActivePoint();
    return;
  }

  setActivePoint(
    index,
    value as number,
    firstAvailableSeries.key,
    firstAvailableSeries.name,
    firstAvailableSeries.color,
  );
}

function setActivePoint(
  index: number,
  value: number,
  seriesId: string,
  seriesName: string,
  color: string,
) {
  activePoint.value = {
    index,
    label: props.labels[index] || "",
    seriesId,
    seriesName,
    color,
    value,
    x: getX(index),
    y: getY(value),
  };
}

function clearActivePoint() {
  activePoint.value = null;
}

function selectPoint(point: ChartPoint, line: ChartLine) {
  setActivePoint(point.index, point.value, line.key, line.name, line.color);
  emit("point-click", {
    seriesId: line.key,
    seriesLabel: line.name,
    index: point.index,
    label: props.labels[point.index] || "",
    value: point.value,
  });
}

function isZeroTick(value: number) {
  return Math.abs(value) < Number.EPSILON * 100;
}

function formatMonthLabel(value: string, index: number) {
  const match = value.match(/^(\d{4})-(\d{1,2})/);
  if (!match) {
    return value;
  }

  const year = match[1];
  const month = Number(match[2]);
  if (index === 0 || month === 1) {
    return `${year.slice(2)}年${month}月`;
  }
  return `${month}月`;
}

function shortMonthLabel(value: string) {
  const match = value.match(/^\d{4}-(\d{1,2})/);
  return match ? `${Number(match[1])}月` : value.slice(0, 6);
}

function displayPeriodLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{1,2})/);
  return match ? `${match[1]}年${Number(match[2])}月` : value;
}

function formatAxisValue(value: number) {
  const scaled = value / axisDisplay.value.divisor;
  return `${trimTrailingZero(scaled)}${axisDisplay.value.suffix}`;
}

function trimTrailingZero(value: number) {
  return Number(value.toFixed(1)).toString();
}

function formatValue(value: number) {
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
  return `${props.currency ? "¥" : ""}${formatted}${props.unit}`;
}

function formatQuoteValue(value: number) {
  const absolute = Math.abs(value);
  const prefix = props.currency ? "¥" : "";
  if (absolute >= 100000000) {
    return `${prefix}${trimTrailingZero(value / 100000000)}亿`;
  }
  if (absolute >= 10000) {
    return `${prefix}${trimTrailingZero(value / 10000)}万`;
  }
  return `${prefix}${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 0,
  }).format(value)}${props.unit}`;
}

function formatQuoteChange(delta: number | null, previousValue: number | null) {
  if (delta === null || previousValue === null) {
    return "最新";
  }
  if (Math.abs(delta) < Number.EPSILON) {
    return "— 持平";
  }
  if (Math.abs(previousValue) < Number.EPSILON) {
    return delta > 0 ? "▲ 新增" : "▼ 减少";
  }

  const percentage = Math.abs((delta / previousValue) * 100);
  return `${delta > 0 ? "▲" : "▼"} ${trimTrailingZero(percentage)}%`;
}

onMounted(() => {
  motionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const updateMotionPreference = () => {
    prefersReducedMotion.value = Boolean(motionMediaQuery?.matches);
    if (prefersReducedMotion.value) {
      stopValueAnimation();
      renderedSeries.value = cloneSeries(props.series);
    }
  };
  motionPreferenceHandler = updateMotionPreference;
  updateMotionPreference();
  motionMediaQuery.addEventListener?.("change", updateMotionPreference);

  const updateWidth = (width: number) => {
    const nextWidth = Math.max(Math.round(width), 280);
    if (nextWidth === viewWidth.value) {
      return;
    }
    viewWidth.value = nextWidth;
    if (activePoint.value) {
      activePoint.value = {
        ...activePoint.value,
        x: getX(activePoint.value.index),
      };
    }
  };

  if (typeof window.ResizeObserver === "undefined") {
    updateWidth(canvasRef.value?.clientWidth || viewWidth.value);
    return;
  }

  resizeObserver = new window.ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) {
      updateWidth(entry.contentRect.width);
    }
  });
  if (canvasRef.value) {
    resizeObserver.observe(canvasRef.value);
  }
});

onBeforeUnmount(() => {
  stopValueAnimation();
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (motionMediaQuery && motionPreferenceHandler) {
    motionMediaQuery.removeEventListener?.("change", motionPreferenceHandler);
  }
  motionPreferenceHandler = null;
  motionMediaQuery = null;
});
</script>

<style scoped>
.boss-line-chart {
  min-width: 0;
  color: var(--yl-text-primary, #172033);
}

.chart-header {
  display: flex;
  min-height: 66px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.title-wrap {
  display: flex;
  min-width: 0;
  align-items: center;
}

.chart-title {
  margin: 0;
  color: var(--yl-text-primary, #172033);
  font-size: 15px;
  font-weight: 720;
  letter-spacing: -0.01em;
  line-height: 1.45;
}

.chart-subtitle {
  max-width: 560px;
  margin: 3px 0 0;
  color: var(--yl-text-secondary, #7a8794);
  font-size: 11px;
  line-height: 1.45;
}

.chart-status {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  color: #8995a2;
  white-space: nowrap;
}

.chart-status > span {
  font-size: 10px;
}

.chart-live-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.chart-live-label i {
  position: relative;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2fb899;
  box-shadow: 0 0 0 4px rgb(47 184 153 / 10%);
}

.chart-status > strong {
  display: flex;
  margin-top: 3px;
  align-items: center;
  gap: 8px;
  color: #496073;
  font-size: 11px;
  font-weight: 600;
}

.chart-status b {
  font-size: 18px;
  font-weight: 740;
  letter-spacing: -0.035em;
}

.chart-legend {
  display: flex;
  min-height: 48px;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px;
  padding: 8px 0 10px;
  border-bottom: 1px solid #eef2f4;
  color: var(--yl-text-regular, #364155);
  font-size: 11px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  transition:
    color 160ms ease,
    opacity 160ms ease;
}

.legend-item:hover {
  color: #183c57;
}

.legend-item:focus-visible {
  border-radius: 5px;
  outline: 2px solid rgb(29 126 139 / 28%);
  outline-offset: 4px;
}

.legend-item.is-hidden {
  color: var(--yl-text-placeholder, #9aa4b5);
  opacity: 0.45;
}

.legend-item > i {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
}

.legend-item > span {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.legend-item small {
  margin-top: 1px;
  color: #9aa4ad;
  font-size: 9px;
  font-weight: 500;
}

.missing-hint {
  display: inline-flex;
  margin-left: auto;
  align-items: center;
  gap: 6px;
  color: var(--yl-text-placeholder, #9aa4ad);
  font-size: 10px;
}

.missing-line {
  width: 15px;
  height: 0;
  border-top: 1px dashed #b6c0c9;
}

.chart-canvas {
  position: relative;
  min-height: 292px;
  margin-top: 4px;
  background: transparent;
}

.chart-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.grid-lines line {
  stroke: var(--yl-border-lighter, #edf1f4);
  stroke-width: 1;
}

.grid-lines line:not(.zero-line) {
  stroke-dasharray: none;
}

.grid-lines .zero-line {
  stroke: #dce3e8;
}

.grid-lines text,
.x-labels text {
  fill: var(--yl-text-placeholder, #8c98a4);
  font-size: 11px;
  font-weight: 500;
}

.series-area {
  pointer-events: none;
  opacity: 0.08;
}

.series-group {
  animation: series-vertical-wave var(--wave-duration, 4s) ease-in-out infinite;
  animation-delay: var(--wave-delay, 0s);
  transform-box: fill-box;
  transform-origin: center;
  will-change: transform;
}

.boss-line-chart.is-interacting .series-group {
  animation: none;
  transform: translateY(0);
}

@keyframes series-vertical-wave {
  0%,
  100% {
    transform: translateY(0);
  }

  32% {
    transform: translateY(var(--wave-up, -2px));
  }

  68% {
    transform: translateY(var(--wave-down, 1.5px));
  }
}

.series-line {
  fill: none;
  pointer-events: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
  opacity: 0.72;
}

.series-line.is-primary {
  stroke-width: 3;
  opacity: 1;
}

.latest-quote {
  --wave-down: 1.6px;
  --wave-up: -2.2px;

  animation: series-vertical-wave 4s ease-in-out infinite;
  pointer-events: none;
  transform-box: fill-box;
  transform-origin: center;
  transition:
    opacity 180ms ease,
    transform 180ms ease;
  will-change: transform;
}

.latest-quote.is-muted {
  animation: none;
  opacity: 0.28;
  transform: translateY(0);
}

.latest-quote-now {
  opacity: 0.18;
  stroke-dasharray: 2 5;
  stroke-width: 1;
}

.latest-quote-guide {
  opacity: 0.46;
  stroke-dasharray: 3 3;
  stroke-width: 1;
}

.latest-quote-halo {
  opacity: 0.3;
  stroke-width: 1.5;
}

.latest-quote-point {
  stroke: #ffffff;
  stroke-width: 2;
}

.latest-quote-tag {
  filter: drop-shadow(0 5px 8px rgb(33 52 72 / 16%));
  transform-box: fill-box;
  transform-origin: center;
}

.latest-quote-value {
  font-size: 10px;
  font-weight: 720;
  letter-spacing: -0.02em;
}

.latest-quote-change {
  font-size: 8px;
  font-weight: 650;
  opacity: 0.88;
}

.hover-bands rect {
  fill: transparent;
  pointer-events: all;
}

.active-guide line {
  stroke: #84abae;
  stroke-width: 1;
}

.active-guide-vertical {
  stroke-dasharray: 2 4;
}

.active-guide-horizontal {
  opacity: 0.42;
  stroke-dasharray: 3 3;
}

.active-guide rect {
  fill: #1c666f;
}

.active-guide text {
  fill: #ffffff;
  font-size: 9px;
  font-weight: 650;
}

.active-value-text {
  font-size: 8px;
}

.series-point {
  opacity: 0;
  stroke: #ffffff;
  stroke-width: 2;
  transition:
    r 160ms ease,
    opacity 160ms ease;
}

.point-group {
  cursor: pointer;
  outline: none;
}

.point-hit-area {
  fill: transparent;
}

.point-halo {
  opacity: 0.12;
}

.point-group.is-latest .series-point,
.point-group:hover .series-point,
.point-group:focus .series-point,
.point-group.is-active .series-point {
  opacity: 1;
}

.point-group:hover .series-point,
.point-group:focus .series-point,
.point-group.is-active .series-point {
  r: 5.5;
}

.point-group:focus-visible .series-point {
  stroke-width: 3;
}

.chart-empty {
  display: flex;
  min-height: 290px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background:
    radial-gradient(circle at 50% 30%, rgb(63 111 222 / 7%), transparent 38%),
    linear-gradient(180deg, #fbfcfe, #f7f9fc);
  color: var(--yl-text-secondary, #687386);
}

.chart-empty strong {
  margin-top: 18px;
  color: var(--yl-text-regular, #374258);
  font-size: 14px;
  font-weight: 650;
}

.chart-empty > span {
  margin-top: 6px;
  color: var(--yl-text-placeholder, #929daf);
  font-size: 12px;
}

.empty-illustration {
  position: relative;
  width: 156px;
  height: 58px;
}

.empty-illustration svg {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.empty-illustration path {
  fill: none;
  stroke: #a9b9d6;
  stroke-linecap: round;
  stroke-width: 2;
}

.empty-illustration circle {
  fill: #7f9fd5;
  stroke: #ffffff;
  stroke-width: 2;
}

.empty-grid {
  position: absolute;
  inset: 0;
  border-bottom: 1px solid #dce3ee;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 18px,
    rgb(218 226 238 / 68%) 19px
  );
}

.chart-footer {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-top: 7px;
  border-top: 1px solid #f1f3f5;
  color: var(--yl-text-placeholder, #96a1ab);
  font-size: 10px;
  line-height: 1.5;
}

.chart-footer span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.chart-footer i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #49a884;
}

@media (max-width: 700px) {
  .chart-header {
    min-height: auto;
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }

  .chart-status {
    width: 100%;
    align-items: flex-start;
  }

  .missing-hint {
    width: 100%;
    margin-left: 0;
  }

  .chart-canvas {
    min-height: 250px;
  }

  .chart-svg {
    width: 100%;
  }

  .chart-footer {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }
}

:global(html.dark) .chart-canvas {
  background: transparent;
}

:global(html.dark) .chart-legend,
:global(html.dark) .chart-footer {
  border-color: rgb(129 151 190 / 12%);
}

:global(html.dark) .legend-item:hover {
  color: #d7e4ec;
}

:global(html.dark) .series-point {
  stroke: #202a3c;
}

:global(html.dark) .chart-empty {
  background:
    radial-gradient(circle at 50% 30%, rgb(66 112 222 / 11%), transparent 38%),
    linear-gradient(180deg, #202a3b, #1b2433);
}

:global(html.dark) .empty-illustration circle {
  stroke: #202a3b;
}

@media (prefers-reduced-motion: reduce) {
  .series-group,
  .latest-quote {
    animation: none;
  }

  .latest-quote-halo {
    opacity: 0.28;
  }

  .series-group,
  .latest-quote {
    transform: translateY(0);
  }

  .legend-item,
  .series-point {
    transition: none;
  }
}
</style>
