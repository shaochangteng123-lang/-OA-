<template>
  <section class="boss-pie-chart" :aria-label="title">
    <header class="chart-header">
      <div>
        <h3>{{ title }}</h3>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <div class="chart-status">
        <span>
          <i aria-hidden="true"></i>
          {{
            syncing
              ? "正在同步"
              : refreshCountdown !== null
                ? `${refreshCountdown}秒后同步`
                : "实时数据"
          }}
        </span>
        <strong>{{ displayPeriod }}</strong>
      </div>
    </header>

    <div v-if="hasSourceData" class="chart-layout">
      <div
        class="pie-stage"
        @mouseleave="hoveredSeriesKey = null"
        @focusout="hoveredSeriesKey = null"
      >
        <svg
          v-if="hasData"
          class="pie-svg"
          viewBox="0 0 520 320"
          role="img"
          :aria-label="`${title}饼状图，展示${displayPeriod}各项目金额及占比`"
        >
          <desc>{{ pieDescription }}</desc>
          <circle
            class="pie-track"
            :cx="PIE_CENTER_X"
            :cy="PIE_CENTER_Y"
            :r="PIE_TRACK_RADIUS"
            fill="none"
            stroke="#edf2f5"
            :stroke-width="PIE_RING_WIDTH"
          />
          <g class="pie-slices">
            <path
              v-for="(slice, index) in slices"
              :key="slice.key"
              class="pie-slice"
              :class="{
                'is-active': activeSlice?.key === slice.key,
                'is-muted': activeSlice && activeSlice.key !== slice.key,
              }"
              :d="slice.path"
              :fill="slice.color"
              :style="{ '--slice-index': index }"
              tabindex="0"
              role="button"
              :aria-label="`${slice.name}，${formatValue(slice.value)}，占比${formatPercentage(slice.percentage)}`"
              @mouseenter="hoveredSeriesKey = slice.key"
              @focus="hoveredSeriesKey = slice.key"
              @click="selectSlice(slice)"
              @keydown.enter.prevent="selectSlice(slice)"
              @keydown.space.prevent="selectSlice(slice)"
            >
              <title>
                {{ slice.name }}：{{ formatValue(slice.value) }}（{{
                  formatPercentage(slice.percentage)
                }}）
              </title>
            </path>
          </g>
          <g class="pie-callouts" aria-hidden="true">
            <g
              v-for="callout in callouts"
              :key="`callout-${callout.key}`"
              :class="{
                'is-active': activeSlice?.key === callout.key,
                'is-muted': activeSlice && activeSlice.key !== callout.key,
              }"
            >
              <polyline
                :points="callout.linePoints"
                fill="none"
                :stroke="callout.color"
              />
              <circle
                :cx="callout.anchorX"
                :cy="callout.anchorY"
                r="2.7"
                :fill="callout.color"
              />
              <text
                :x="callout.labelX"
                :y="callout.labelY - 4"
                :text-anchor="callout.textAnchor"
              >
                <tspan
                  class="callout-name"
                  :x="callout.labelX"
                  :y="callout.labelY - 4"
                >
                  {{ callout.name }}
                </tspan>
                <tspan
                  class="callout-value"
                  :x="callout.labelX"
                  :y="callout.labelY + 12"
                >
                  {{ formatValue(callout.value) }} ·
                  {{ formatPercentage(callout.percentage) }}
                </tspan>
              </text>
            </g>
          </g>
          <circle
            class="pie-center"
            :cx="PIE_CENTER_X"
            :cy="PIE_CENTER_Y"
            :r="PIE_INNER_RADIUS - 7"
            fill="#ffffff"
          />
        </svg>

        <div v-if="hasData" class="pie-center-copy" aria-live="polite">
          <span>{{ activeSlice?.name || "构成合计" }}</span>
          <strong>{{ formatValue(activeSlice?.value ?? visibleTotal) }}</strong>
          <small v-if="activeSlice">
            占比 {{ formatPercentage(activeSlice.percentage) }}
          </small>
          <small v-else>{{ visibleSlices.length }}项构成</small>
        </div>

        <div v-else class="pie-empty">
          <span class="empty-ring" aria-hidden="true"></span>
          <strong>所选项目合计为0</strong>
          <small>可通过右侧图例重新选择需要分析的项目</small>
        </div>
      </div>

      <div class="pie-legend" aria-label="饼状图图例">
        <button
          v-for="item in aggregatedSeries"
          :key="item.key"
          type="button"
          :class="{
            'is-hidden': !isSeriesVisible(item.key),
            'is-active': activeSlice?.key === item.key,
          }"
          :aria-pressed="isSeriesVisible(item.key)"
          :title="
            isSeriesVisible(item.key) ? `隐藏${item.name}` : `显示${item.name}`
          "
          @mouseenter="setLegendHover(item)"
          @mouseleave="hoveredSeriesKey = null"
          @focus="setLegendHover(item)"
          @blur="hoveredSeriesKey = null"
          @click="toggleSeries(item.key)"
        >
          <i :style="{ background: item.color }" aria-hidden="true"></i>
          <span>
            <b>{{ item.name }}</b>
            <small>
              {{ item.value === null ? "数据缺失" : formatValue(item.value) }}
            </small>
          </span>
          <em>
            {{
              !isSeriesVisible(item.key)
                ? "已隐藏"
                : item.value !== null && visibleTotal > 0
                  ? formatPercentage((item.value / visibleTotal) * 100)
                  : "—"
            }}
          </em>
        </button>
      </div>
    </div>

    <div v-else class="chart-empty">
      <span class="empty-ring" aria-hidden="true"></span>
      <strong>{{ emptyText }}</strong>
      <small>录入真实业务数据后将自动生成经营构成</small>
    </div>

    <footer>
      <span><i aria-hidden="true"></i>真实业务数据 · 自动同步</span>
      <span>点击图例可显隐，点击扇区查看构成明细</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

export interface BossPieChartSeries {
  key: string;
  name: string;
  color: string;
  values: Array<number | null>;
}

export interface BossPieSliceClickPayload {
  seriesId: string;
  seriesLabel: string;
  index: number;
  label: string;
  value: number;
}

interface AggregatedSeries {
  key: string;
  name: string;
  color: string;
  value: number | null;
}

interface PieSlice extends AggregatedSeries {
  value: number;
  percentage: number;
  path: string;
  middleAngle: number;
}

interface PieCallout extends PieSlice {
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
  linePoints: string;
  textAnchor: "start" | "end";
}

const PIE_CENTER_X = 260;
const PIE_CENTER_Y = 160;
const PIE_OUTER_RADIUS = 98;
const PIE_INNER_RADIUS = 70;
const PIE_TRACK_RADIUS = (PIE_OUTER_RADIUS + PIE_INNER_RADIUS) / 2;
const PIE_RING_WIDTH = PIE_OUTER_RADIUS - PIE_INNER_RADIUS;
const CALLOUT_MIN_Y = 30;
const CALLOUT_MAX_Y = 290;
const CALLOUT_GAP = 40;

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    labels: string[];
    series: BossPieChartSeries[];
    unit?: string;
    currency?: boolean;
    emptyText?: string;
    syncing?: boolean;
    refreshCountdown?: number | null;
  }>(),
  {
    subtitle: "",
    unit: "元",
    currency: true,
    emptyText: "当前数据尚未接入",
    syncing: false,
    refreshCountdown: null,
  },
);

const emit = defineEmits<{
  (event: "slice-click", payload: BossPieSliceClickPayload): void;
}>();

const hiddenSeriesKeys = ref<Set<string>>(new Set());
const selectedSeriesKey = ref<string | null>(null);
const hoveredSeriesKey = ref<string | null>(null);

const displayPeriod = computed(() => props.labels[0] || "所选周期");

const aggregatedSeries = computed<AggregatedSeries[]>(() =>
  props.series.map((item) => {
    const validValues = item.values.filter(
      (value): value is number =>
        Number.isFinite(value) && (value as number) >= 0,
    );
    return {
      key: item.key,
      name: item.name,
      color: item.color,
      value:
        validValues.length > 0
          ? Number(
              validValues.reduce((total, value) => total + value, 0).toFixed(2),
            )
          : null,
    };
  }),
);

const hasSourceData = computed(() =>
  aggregatedSeries.value.some((item) => item.value !== null),
);

const visibleSeries = computed(() =>
  aggregatedSeries.value.filter(
    (item) => !hiddenSeriesKeys.value.has(item.key),
  ),
);

const visibleSlices = computed(() =>
  visibleSeries.value.filter(
    (item): item is AggregatedSeries & { value: number } =>
      item.value !== null && item.value > 0,
  ),
);

const visibleTotal = computed(() =>
  Number(
    visibleSlices.value
      .reduce((total, item) => total + item.value, 0)
      .toFixed(2),
  ),
);

const hasData = computed(() => visibleTotal.value > 0);

const slices = computed<PieSlice[]>(() => {
  if (!hasData.value) {
    return [];
  }

  let cursor = -90;
  return visibleSlices.value.map((item) => {
    const percentage = (item.value / visibleTotal.value) * 100;
    const sweep = (item.value / visibleTotal.value) * 360;
    const gap =
      visibleSlices.value.length === 1 ? 0 : Math.min(1.4, sweep * 0.18);
    const startAngle = cursor + gap / 2;
    const endAngle = cursor + sweep - gap / 2;
    cursor += sweep;
    return {
      ...item,
      percentage,
      path: describeDonutSlice(startAngle, endAngle),
      middleAngle: startAngle + (endAngle - startAngle) / 2,
    };
  });
});

const callouts = computed<PieCallout[]>(() => {
  const candidates = slices.value.map((slice) => {
    const anchor = polarPoint(slice.middleAngle, PIE_OUTER_RADIUS + 2);
    const elbow = polarPoint(slice.middleAngle, PIE_OUTER_RADIUS + 19);
    return {
      slice,
      anchor,
      elbow,
      side:
        Math.cos((slice.middleAngle * Math.PI) / 180) >= 0
          ? ("right" as const)
          : ("left" as const),
    };
  });

  return [
    ...arrangeCalloutSide(
      candidates.filter((item) => item.side === "left"),
      "left",
    ),
    ...arrangeCalloutSide(
      candidates.filter((item) => item.side === "right"),
      "right",
    ),
  ];
});

const pieDescription = computed(() =>
  slices.value
    .map(
      (slice) =>
        `${slice.name}${formatValue(slice.value)}，占比${formatPercentage(slice.percentage)}`,
    )
    .join("；"),
);

const activeSlice = computed<PieSlice | null>(() => {
  const activeKey = hoveredSeriesKey.value || selectedSeriesKey.value;
  const selected = slices.value.find((item) => item.key === activeKey);
  if (selected) {
    return selected;
  }
  return null;
});

watch(
  () => props.series.map((item) => item.key),
  (keys) => {
    const availableKeys = new Set(keys);
    hiddenSeriesKeys.value = new Set(
      [...hiddenSeriesKeys.value].filter((key) => availableKeys.has(key)),
    );
    if (
      selectedSeriesKey.value &&
      !availableKeys.has(selectedSeriesKey.value)
    ) {
      selectedSeriesKey.value = null;
    }
  },
);

function polarPoint(angle: number, radius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: PIE_CENTER_X + radius * Math.cos(radians),
    y: PIE_CENTER_Y + radius * Math.sin(radians),
  };
}

function describeDonutSlice(startAngle: number, endAngle: number) {
  const safeEndAngle =
    endAngle - startAngle >= 360 ? startAngle + 359.999 : endAngle;
  const outerStart = polarPoint(startAngle, PIE_OUTER_RADIUS);
  const outerEnd = polarPoint(safeEndAngle, PIE_OUTER_RADIUS);
  const innerEnd = polarPoint(safeEndAngle, PIE_INNER_RADIUS);
  const innerStart = polarPoint(startAngle, PIE_INNER_RADIUS);
  const largeArc = safeEndAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${PIE_OUTER_RADIUS} ${PIE_OUTER_RADIUS} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${PIE_INNER_RADIUS} ${PIE_INNER_RADIUS} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function arrangeCalloutSide(
  items: Array<{
    slice: PieSlice;
    anchor: { x: number; y: number };
    elbow: { x: number; y: number };
    side: "left" | "right";
  }>,
  side: "left" | "right",
): PieCallout[] {
  const sorted = [...items].sort((left, right) => left.elbow.y - right.elbow.y);
  const positions: number[] = [];

  sorted.forEach((item, index) => {
    const previous = positions[index - 1];
    positions.push(
      Math.max(
        item.elbow.y,
        index === 0 ? CALLOUT_MIN_Y : previous + CALLOUT_GAP,
      ),
    );
  });

  const overflow =
    positions.length > 0
      ? Math.max(positions[positions.length - 1] - CALLOUT_MAX_Y, 0)
      : 0;
  positions.forEach((_position, index) => {
    positions[index] -= overflow;
  });

  const underflow =
    positions.length > 0 ? Math.max(CALLOUT_MIN_Y - positions[0], 0) : 0;
  positions.forEach((_position, index) => {
    positions[index] += underflow;
  });

  const labelX = side === "right" ? 372 : 148;
  const lineEndX = side === "right" ? 366 : 154;

  return sorted.map((item, index) => ({
    ...item.slice,
    anchorX: item.anchor.x,
    anchorY: item.anchor.y,
    labelX,
    labelY: positions[index],
    linePoints: [
      `${item.anchor.x},${item.anchor.y}`,
      `${item.elbow.x},${item.elbow.y}`,
      `${lineEndX},${positions[index]}`,
    ].join(" "),
    textAnchor: side === "right" ? "start" : "end",
  }));
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
  if (nextKeys.has(key) && selectedSeriesKey.value === key) {
    selectedSeriesKey.value = null;
  }
  hoveredSeriesKey.value = null;
}

function setLegendHover(item: AggregatedSeries) {
  if (isSeriesVisible(item.key) && item.value !== null && item.value > 0) {
    hoveredSeriesKey.value = item.key;
  }
}

function selectSlice(slice: PieSlice) {
  selectedSeriesKey.value = slice.key;
  emit("slice-click", {
    seriesId: slice.key,
    seriesLabel: slice.name,
    index: 0,
    label: displayPeriod.value,
    value: slice.value,
  });
}

function formatPercentage(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatValue(value: number) {
  const amount = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${props.currency ? "¥" : ""}${amount}${props.unit}`;
}
</script>

<style scoped>
.boss-pie-chart {
  min-width: 0;
  color: var(--yl-text-primary, #172033);
}

.chart-header {
  display: flex;
  min-height: 66px;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
}

.chart-header > div:first-child {
  min-width: 0;
}

.chart-header h3 {
  margin: 0;
  color: #1b3148;
  font-size: 15px;
  font-weight: 720;
  letter-spacing: -0.01em;
  line-height: 1.45;
}

.chart-header p {
  max-width: 620px;
  margin: 3px 0 0;
  color: #7a8794;
  font-size: 11px;
  line-height: 1.5;
}

.chart-status {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-end;
  flex-direction: column;
  color: #8795a2;
  white-space: nowrap;
}

.chart-status span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
}

.chart-status span i,
footer span:first-child i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #2fae93;
  box-shadow: 0 0 0 4px rgb(47 174 147 / 10%);
}

.chart-status strong {
  margin-top: 4px;
  color: #52687a;
  font-size: 12px;
}

.chart-layout {
  display: grid;
  align-items: center;
  gap: 10px;
  grid-template-columns: 1fr;
}

.pie-stage {
  position: relative;
  display: grid;
  min-height: 342px;
  place-items: center;
}

.pie-stage::before {
  position: absolute;
  width: 228px;
  height: 228px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgb(255 255 255 / 0%) 52%,
    rgb(47 174 147 / 5%) 100%
  );
  content: "";
  filter: blur(5px);
  pointer-events: none;
}

.pie-svg {
  z-index: 1;
  width: min(100%, 520px);
  overflow: visible;
  filter: drop-shadow(0 14px 20px rgb(28 53 76 / 9%));
}

.pie-slice {
  transform-box: fill-box;
  transform-origin: center;
  transition:
    opacity 180ms ease,
    filter 180ms ease,
    transform 180ms ease;
  animation: slice-enter 560ms cubic-bezier(0.2, 0.75, 0.2, 1) both;
  animation-delay: calc(var(--slice-index) * 65ms);
  cursor: pointer;
  outline: none;
}

.pie-slice:hover,
.pie-slice:focus-visible,
.pie-slice.is-active {
  filter: brightness(1.04) drop-shadow(0 5px 7px rgb(32 60 84 / 18%));
  transform: scale(1.025);
}

.pie-slice.is-muted {
  opacity: 0.48;
}

.pie-slice:focus-visible {
  stroke: #ffffff;
  stroke-width: 3px;
}

.pie-callouts {
  pointer-events: none;
}

.pie-callouts g {
  transition: opacity 180ms ease;
}

.pie-callouts g.is-muted {
  opacity: 0.4;
}

.pie-callouts polyline {
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.25px;
  opacity: 0.72;
  vector-effect: non-scaling-stroke;
}

.pie-callouts circle {
  opacity: 0.9;
}

.pie-callouts text {
  fill: #42596d;
}

.pie-callouts .callout-name {
  font-size: 13px;
  font-weight: 720;
}

.pie-callouts .callout-value {
  fill: #7f8e9b;
  font-size: 11.5px;
  font-weight: 560;
}

.pie-callouts g.is-active .callout-name {
  fill: #183c56;
  font-weight: 780;
}

.pie-callouts g.is-active polyline {
  stroke-width: 1.8px;
  opacity: 1;
}

.pie-center {
  filter: drop-shadow(0 2px 6px rgb(28 53 76 / 6%));
  pointer-events: none;
}

.pie-center-copy {
  position: absolute;
  z-index: 2;
  display: flex;
  width: 136px;
  align-items: center;
  flex-direction: column;
  pointer-events: none;
  text-align: center;
}

.pie-center-copy span {
  overflow: hidden;
  width: 100%;
  color: #768696;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pie-center-copy strong {
  margin-top: 3px;
  color: #203b54;
  font-size: 14px;
  font-weight: 760;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.pie-center-copy small {
  margin-top: 3px;
  color: #91a0ad;
  font-size: 9px;
}

.pie-legend {
  display: grid;
  align-content: center;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(156px, 1fr));
}

.pie-legend button {
  display: grid;
  min-width: 0;
  min-height: 58px;
  align-items: center;
  padding: 9px 11px;
  border: 1px solid #e5ebf0;
  border-radius: 13px;
  background: #fbfcfd;
  color: inherit;
  cursor: pointer;
  gap: 9px;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  text-align: left;
  transition:
    border-color 180ms ease,
    background 180ms ease,
    box-shadow 180ms ease,
    opacity 180ms ease;
}

.pie-legend button:hover,
.pie-legend button:focus-visible,
.pie-legend button.is-active {
  border-color: #cbdce3;
  background: #ffffff;
  box-shadow: 0 8px 20px rgb(26 54 77 / 6%);
  outline: none;
}

.pie-legend button.is-hidden {
  opacity: 0.48;
}

.pie-legend button > i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.pie-legend button > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.pie-legend b {
  overflow: hidden;
  color: #40586d;
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pie-legend small {
  color: #8795a2;
  font-size: 10px;
}

.pie-legend em {
  color: #577184;
  font-size: 11px;
  font-style: normal;
  font-weight: 680;
}

.chart-empty,
.pie-empty {
  display: flex;
  min-height: 286px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  color: #91a0ad;
  text-align: center;
}

.pie-empty {
  position: relative;
  z-index: 1;
  min-height: auto;
}

.empty-ring {
  width: 112px;
  height: 112px;
  margin-bottom: 15px;
  border: 20px solid #edf2f5;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px #e5ecef;
}

.chart-empty strong,
.pie-empty strong {
  color: #6f8090;
  font-size: 12px;
}

.chart-empty small,
.pie-empty small {
  margin-top: 5px;
  color: #a0abb5;
  font-size: 10px;
}

footer {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-top: 1px solid #edf1f4;
  color: #93a0ab;
  font-size: 9px;
}

footer span:first-child {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

footer span:first-child i {
  width: 5px;
  height: 5px;
}

@keyframes slice-enter {
  from {
    opacity: 0;
    transform: scale(0.88);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 680px) {
  .chart-header {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .chart-status {
    align-items: flex-start;
  }

  .chart-layout {
    grid-template-columns: 1fr;
  }

  .pie-stage {
    min-height: 300px;
  }

  .pie-svg {
    width: min(100%, 400px);
  }

  .pie-legend {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .pie-slice {
    transition: none;
    animation: none;
  }
}
</style>
