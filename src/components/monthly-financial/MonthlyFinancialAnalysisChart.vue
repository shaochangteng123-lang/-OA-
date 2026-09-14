<template>
  <section class="analysis-chart" :data-chart-type="type">
    <header class="chart-heading">
      <h4>{{ title }}</h4>
      <div
        v-if="
          type === 'line' && (series.length > 1 || showCurrentMonthShortcut)
        "
        class="metric-controls"
      >
        <label v-if="series.length > 1 && !multipleMetrics">
          <span>查看指标</span>
          <select
            v-model="activeMetricKey"
            aria-label="选择折线指标"
            @change="handleMetricChange"
          >
            <option
              v-for="metric in series"
              :key="metric.key"
              :value="metric.key"
            >
              {{ metric.label }}
            </option>
          </select>
        </label>
        <div class="metric-button-group">
          <button
            v-if="series.length > 1"
            type="button"
            :aria-pressed="multipleMetrics"
            :disabled="activeMetricHasSegments"
            :title="
              activeMetricHasSegments
                ? '签订合同数量按行政区和服务单位独立展示，不与金额共用纵轴'
                : undefined
            "
            @click="toggleMultipleMetrics"
          >
            {{ multipleMetrics ? "返回单指标" : "多指标比较" }}
          </button>
          <button
            v-if="showCurrentMonthShortcut"
            type="button"
            class="chart-current-month"
            title="恢复截至本月的近12个月，切回月度并立即查询"
            :disabled="currentMonthDisabled"
            @click="requestCurrentMonth"
          >
            回到本月
          </button>
        </div>
      </div>
    </header>
    <fieldset
      v-if="type === 'line' && multipleMetrics"
      class="metric-checklist"
    >
      <legend>选择需要比较的指标</legend>
      <label v-for="metric in series" :key="metric.key">
        <input
          type="checkbox"
          :checked="selectedMetricKeys.includes(metric.key)"
          :disabled="
            Boolean(metric.segments?.length) ||
            metric.unit === '个' ||
            metric.unit === '组'
          "
          @change="toggleMetric(metric.key)"
        />
        {{ metric.label }}
      </label>
    </fieldset>

    <template v-if="type === 'donut'">
      <p
        v-if="structureMode === 'known-positive'"
        class="structure-scope-note"
        role="status"
      >
        {{
          costStructure
            ? "已核验的正成本计算占比；零成本显示 0.00%，待确认费用另列。"
            : "仅已知正金额，不代表净额或完整总额"
        }}
      </p>
      <div v-if="donutUnavailable" class="empty-structure">
        <svg
          class="empty-donut-svg"
          viewBox="0 0 200 200"
          role="img"
          aria-label="暂无可绘制占比的中性空环"
        >
          <circle
            cx="100"
            cy="100"
            r="66"
            fill="none"
            stroke="#e6ecef"
            stroke-width="25"
          />
          <text x="100" y="98" text-anchor="middle">暂无占比</text>
          <text x="100" y="119" text-anchor="middle" class="empty-ring-note">
            保留真实金额
          </text>
        </svg>
        <p class="chart-unavailable" role="status">{{ donutUnavailable }}</p>
      </div>
      <div v-else class="donut-layout">
        <svg
          viewBox="0 0 250 250"
          class="donut-svg"
          role="img"
          :aria-label="title"
        >
          <circle
            cx="125"
            cy="125"
            r="88"
            fill="none"
            stroke="#edf2f4"
            stroke-width="36"
          />
          <circle
            v-for="slice in slices"
            :key="slice.key"
            class="chart-interactive donut-slice"
            cx="125"
            cy="125"
            r="88"
            fill="none"
            :stroke="slice.color"
            stroke-width="36"
            :stroke-dasharray="
              slice.length + ' ' + (circumference - slice.length)
            "
            :stroke-dashoffset="-slice.offset"
            transform="rotate(-90 125 125)"
            tabindex="0"
            role="button"
            :data-key="slice.key"
            :aria-label="
              slice.label +
              '，' +
              displayValue(slice) +
              '，占比 ' +
              slice.percentage +
              '%'
            "
            @click="selectValue(slice.label, slice.amount, slice.unit)"
            @focus="selectValue(slice.label, slice.amount, slice.unit)"
            @keydown.enter.prevent="
              selectValue(slice.label, slice.amount, slice.unit)
            "
            @keydown.space.prevent="
              selectValue(slice.label, slice.amount, slice.unit)
            "
          >
            <title>
              {{ slice.label }}：{{ displayValue(slice) }}（{{
                slice.percentage
              }}%）
            </title>
          </circle>
          <text x="125" y="120" text-anchor="middle" class="donut-caption">
            {{ structureMode === "known-positive" ? "已知正金额" : "金额构成" }}
          </text>
          <text
            x="125"
            y="144"
            text-anchor="middle"
            class="donut-caption-small"
          >
            占比保留两位小数
          </text>
        </svg>
        <ul class="breakdown-legend">
          <li v-for="slice in structureLegendItems" :key="slice.key">
            <i :style="{ background: slice.color }" aria-hidden="true"></i>
            <span>{{ slice.label }}</span>
            <strong>{{ displayValue(slice) }}</strong>
            <small>{{ slice.percentage }}%</small>
          </li>
        </ul>
      </div>
      <ul
        v-if="donutUnavailable && costStructure && structureLegendItems.length"
        class="breakdown-legend zero-cost-legend"
      >
        <li v-for="item in structureLegendItems" :key="item.key">
          <i :style="{ background: item.color }" aria-hidden="true"></i
          ><span>{{ item.label }}</span
          ><strong>{{ displayValue(item) }}</strong
          ><small>{{ item.percentage }}%</small>
        </li>
      </ul>
      <div
        v-if="
          structureMode === 'known-positive' && excludedStructureItems.length
        "
        class="excluded-structure"
      >
        <h5>{{ costStructure ? costPendingHeading : "未参与占比的金额" }}</h5>
        <ul class="unavailable-values">
          <li v-for="item in excludedStructureItems" :key="item.key">
            <span>{{ item.label }}</span
            ><strong>{{ displayValue(item) }}</strong>
          </li>
        </ul>
        <p>
          {{
            costStructure
              ? "待确认费用没有可核验的完整金额，不能计算占比；成本冲减保留负号，不按正支出绘制，均可在人员明细中核对。"
              : "负金额、零金额和未知金额不进入正金额占比，未从业务数据中删除。"
          }}
        </p>
      </div>
      <ul
        v-else-if="
          donutUnavailable &&
          items.length &&
          !(costStructure && structureLegendItems.length)
        "
        class="unavailable-values"
      >
        <li v-for="item in items" :key="item.key">
          <span>{{ item.label }}</span
          ><strong>{{ displayValue(item) }}</strong>
        </li>
      </ul>
    </template>

    <template v-else-if="type === 'bar'">
      <p v-if="!items.length" class="chart-unavailable">
        所选范围暂无可比较的记录。
      </p>
      <div v-else class="bar-scroll">
        <svg
          :viewBox="'0 0 900 ' + barHeight"
          class="bar-svg"
          :style="{ minHeight: barHeight + 'px' }"
          role="img"
          :aria-label="title"
        >
          <line
            :x1="barZeroX"
            :x2="barZeroX"
            y1="15"
            :y2="barHeight - 15"
            class="chart-axis"
          />
          <g
            v-for="(item, index) in bars"
            :key="item.key"
            class="chart-interactive"
            tabindex="0"
            role="button"
            :aria-label="item.label + '，' + displayValue(item)"
            @click="selectValue(item.label, item.amount, item.unit)"
            @focus="selectValue(item.label, item.amount, item.unit)"
            @keydown.enter.prevent="
              selectValue(item.label, item.amount, item.unit)
            "
            @keydown.space.prevent="
              selectValue(item.label, item.amount, item.unit)
            "
          >
            <title>{{ item.label }}：{{ displayValue(item) }}</title>
            <text x="8" :y="index * 48 + 37" class="bar-name">
              {{ shortLabel(item.label) }}
            </text>
            <rect
              v-if="item.numeric !== null"
              :x="Math.min(barZeroX, item.x)"
              :y="index * 48 + 19"
              :width="Math.abs(item.x - barZeroX)"
              height="25"
              rx="3"
              :fill="colorAt(index)"
            />
            <text
              x="892"
              :y="index * 48 + 37"
              text-anchor="end"
              class="bar-value"
            >
              {{ displayValue(item) }}
            </text>
          </g>
        </svg>
      </div>
    </template>

    <template v-else>
      <div class="line-legend" aria-label="折线图图例">
        <span v-for="line in visibleLines" :key="line.key">
          <i
            :class="{ 'is-comparison': line.comparison }"
            :style="{ borderColor: line.color }"
            aria-hidden="true"
          ></i>
          {{ line.label }} ·
          {{ line.comparison ? visibleComparisonLabel : "当期" }}
          <small>{{
            line.comparison
              ? compactLineMode
                ? "虚线／方形点"
                : "虚线／菱形点"
              : "实线／圆点"
          }}</small>
        </span>
      </div>
      <div
        v-if="historyWindowMode"
        class="fixed-window-controls"
        :aria-label="
          quarterHistoryMode ? '连续十二个季度浏览窗口' : '连续十二个月浏览窗口'
        "
      >
        <button
          type="button"
          :aria-label="
            quarterHistoryMode ? '查看更早一个季度' : '查看更早一个月'
          "
          :disabled="visibleWindow.to <= minimumWindowEnd"
          @click="shiftWindow(-1)"
        >
          {{ quarterHistoryMode ? "← 上季度" : "← 上月" }}
        </button>
        <div>
          <strong class="visible-window-range"
            >{{ visibleWindow.from }} 至 {{ visibleWindow.to }}</strong
          >
          <span>{{
            quarterHistoryMode
              ? `连续 ${historyVisibleCount} 个季度 · 滚轮或拖动平滑浏览，停止后按季对齐${historyVisibleCount < 12 ? "（已到可用历史边界）" : ""}`
              : historyMode
                ? "固定连续 12 个月 · 滚轮或拖动平滑浏览，停止后按月对齐"
                : "固定连续 12 个月 · 滚轮、拖动或左右键逐月浏览"
          }}</span>
          <small v-if="hasComparison"
            >对比：{{ displayComparisonPeriods[0]?.from || "月份未知" }} 至
            {{ displayComparisonPeriods.at(-1)?.to || "月份未知" }}</small
          >
        </div>
        <button
          type="button"
          :aria-label="
            quarterHistoryMode ? '查看更晚一个季度' : '查看更晚一个月'
          "
          :disabled="visibleWindow.to >= maximumWindowEnd"
          @click="shiftWindow(1)"
        >
          {{ quarterHistoryMode ? "下季度 →" : "下月 →" }}
        </button>
      </div>
      <p
        v-if="historyWindowMode && historyLoading"
        class="window-loading"
        role="status"
      >
        正在加载 {{ visibleWindow.from }} 至
        {{ visibleWindow.to }}；尚未返回的{{
          quarterHistoryMode ? "季度" : "月份"
        }}保持未知。
      </p>
      <div
        v-if="historyWindowMode && historyError"
        class="window-error"
        role="alert"
      >
        <span>{{ historyError }}</span>
        <button
          type="button"
          @click="emit('window-change', { ...visibleWindow })"
        >
          重试当前窗口
        </button>
      </div>
      <p v-if="!hasLineData" class="chart-unavailable" role="status">
        所选范围暂无已知数据；未知数据不会按零连线。
      </p>
      <p
        v-if="periodViewMode && displayPeriods.length"
        class="period-range-note"
      >
        <strong
          >{{ displayPeriods[0].label }} 至
          {{ displayPeriods.at(-1)?.label }}</strong
        >
        <span
          >共
          {{ displayPeriods.length }}
          期，仅展示所选统计范围；滚轮、拖动或左右键浏览。</span
        >
      </p>
      <template
        v-if="
          hasLineData ||
          historyWindowMode ||
          (periodViewMode && displayPeriods.length)
        "
      >
        <div :class="{ 'history-chart-shell': compactLineMode }">
          <div v-if="compactLineMode" class="history-y-axis" aria-hidden="true">
            <span
              v-for="tick in ticks"
              :key="tick.y"
              :style="{ top: tick.y - 8 + 'px' }"
              >{{ tick.label }}</span
            >
          </div>
          <div
            ref="lineScrollRef"
            class="line-scroll"
            :class="{
              'is-fixed-window': historyWindowMode,
              'is-window-dragging': windowDragging,
              'is-continuous-history': historyMode,
              'is-period-view': periodViewMode,
              'is-quarter-history': quarterHistoryMode,
            }"
            role="region"
            tabindex="0"
            :aria-label="
              quarterHistoryMode
                ? '连续十二个季度趋势，可滚轮、拖动或左右键逐季浏览'
                : periodViewMode
                  ? '所选季度或年度趋势，可滚轮、拖动或左右键浏览，不改变统计范围'
                  : monthWindowMode
                    ? '连续十二个月趋势，可滚轮、拖动或左右键逐月浏览'
                    : '精准金额趋势横向浏览区'
            "
            @wheel="handleWindowWheel"
            @scroll="handleHistoryScroll"
            @pointerdown="handleWindowPointerDown"
            @pointermove="handleWindowPointerMove"
            @pointerup="finishWindowPointer"
            @pointercancel="finishWindowPointer"
            @keydown="handleWindowKeydown"
          >
            <svg
              :viewBox="'0 0 ' + lineWidth + ' ' + labelLayout.height"
              class="line-svg"
              :data-axis-min="lineRange.min"
              :data-axis-max="lineRange.max"
              data-axis-mode="raised-zero"
              :style="{
                minWidth:
                  monthWindowMode && !historyMode ? '0' : lineWidth + 'px',
                width: compactLineMode ? lineWidth + 'px' : undefined,
                height: labelLayout.height + 'px',
              }"
              role="img"
              :aria-label="title"
            >
              <g v-for="tick in ticks" :key="tick.y" aria-hidden="true">
                <line
                  :x1="compactLineMode ? 20 : axisWidth"
                  :x2="lineWidth - 14"
                  :y1="tick.y"
                  :y2="tick.y"
                  class="chart-grid"
                  :class="{ 'is-zero': tick.zero }"
                />
                <text
                  v-if="!compactLineMode"
                  :x="axisWidth - 10"
                  :y="tick.y + 4"
                  text-anchor="end"
                  class="axis-label"
                >
                  {{ tick.label }}
                </text>
              </g>
              <g
                v-for="(period, index) in displayPeriods"
                :key="period.key"
                :class="
                  quarterHistoryMode
                    ? 'chart-quarter-slot chart-period-slot'
                    : periodViewMode
                      ? 'chart-period-slot'
                      : 'chart-month-slot'
                "
                :data-month="groupedPeriodMode ? undefined : period.from"
                :data-period="groupedPeriodMode ? period.key : undefined"
                :data-from="groupedPeriodMode ? period.from : undefined"
                :data-to="groupedPeriodMode ? period.to : undefined"
                aria-hidden="true"
              >
                <line
                  v-if="compactLineMode"
                  :x1="lineX(index)"
                  :x2="lineX(index)"
                  :y1="plotTop"
                  :y2="plotBottom"
                  class="history-month-grid"
                  :class="{
                    'is-year-boundary':
                      !periodViewMode && period.from.endsWith('-01'),
                  }"
                />
                <text
                  :x="lineX(index)"
                  :y="plotBottom + 27"
                  :text-anchor="
                    quarterHistoryMode && displayPeriods.length > 1
                      ? index === 0
                        ? 'start'
                        : index === displayPeriods.length - 1
                          ? 'end'
                          : 'middle'
                      : 'middle'
                  "
                  class="axis-label"
                >
                  {{ monthAxisLabel(period) }}
                </text>
                <text
                  v-if="hasComparison && !compactLineMode"
                  :x="lineX(index)"
                  :y="plotBottom + 44"
                  text-anchor="middle"
                  class="comparison-axis-label"
                >
                  {{ monthAxisLabel(displayComparisonPeriods[index]) }}
                </text>
                <text
                  v-if="
                    (historyWindowMode || periodViewMode) &&
                    !monthHasPlottedValue(index)
                  "
                  :x="lineX(index)"
                  :y="plotTop - 18"
                  text-anchor="middle"
                  class="unknown-month-marker"
                >
                  未知
                </text>
              </g>
              <g class="label-leaders" aria-hidden="true">
                <line
                  v-for="label in labelLayout.labels"
                  :key="label.key"
                  class="amount-label-leader"
                  :x1="label.pointX"
                  :y1="label.pointY"
                  :x2="label.anchorX"
                  :y2="label.anchorY"
                  :stroke="label.color"
                />
              </g>
              <g
                v-for="line in plottedLines"
                :key="line.key"
                class="analysis-line-series"
                :data-series="line.comparison ? 'comparison' : 'current'"
                :data-metric="line.metricKey"
                :data-segment="line.segmentKey"
              >
                <line
                  v-for="edge in line.edges"
                  :key="edge.key"
                  class="analysis-line-edge"
                  :data-from-month="edge.fromMonth"
                  :data-to-month="edge.toMonth"
                  :data-from-period="
                    groupedPeriodMode ? edge.fromPeriod : undefined
                  "
                  :data-to-period="
                    groupedPeriodMode ? edge.toPeriod : undefined
                  "
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                  :stroke="line.color"
                  :stroke-dasharray="line.comparison ? '7 5' : undefined"
                  :stroke-width="
                    compactLineMode
                      ? 2.2
                      : line.comparison && !multipleMetrics
                        ? 3.6
                        : 2.1
                  "
                />
                <g
                  v-for="point in line.points"
                  :key="point.index"
                  class="chart-interactive analysis-line-point"
                  :data-index="point.index"
                  :data-month="point.month"
                  :data-source-month="point.sourceMonth"
                  :data-period="groupedPeriodMode ? point.periodKey : undefined"
                  :data-source-period="
                    groupedPeriodMode ? point.sourcePeriodKey : undefined
                  "
                  :data-point-x="point.x"
                  :data-point-y="point.y"
                  role="button"
                  tabindex="0"
                  :aria-label="point.description"
                  @click="
                    selectLineValue(
                      point.description,
                      point.amount,
                      point.index,
                      line.comparison,
                      line.metricKey,
                      point.projectNames,
                    )
                  "
                  @focus="
                    selectValue(
                      point.description,
                      point.amount,
                      line.unit,
                      point.projectNames,
                    )
                  "
                  @keydown.enter.prevent="
                    selectLineValue(
                      point.description,
                      point.amount,
                      point.index,
                      line.comparison,
                      line.metricKey,
                      point.projectNames,
                    )
                  "
                  @keydown.space.prevent="
                    selectLineValue(
                      point.description,
                      point.amount,
                      point.index,
                      line.comparison,
                      line.metricKey,
                      point.projectNames,
                    )
                  "
                >
                  <title>
                    {{ point.description }}：{{
                      formatLineValue(point.amount, line.unit)
                    }}
                  </title>
                  <circle
                    :cx="point.x"
                    :cy="point.y"
                    r="12"
                    fill="transparent"
                  />
                  <rect
                    v-if="line.comparison && compactLineMode"
                    class="comparison-point"
                    :x="point.x - 4.5"
                    :y="point.y - 4.5"
                    width="9"
                    height="9"
                    rx="2"
                    :fill="line.color"
                  />
                  <path
                    v-else-if="line.comparison"
                    class="comparison-point"
                    :d="diamondPath(point.x, point.y)"
                    fill="white"
                    :stroke="line.color"
                    stroke-width="1.8"
                  />
                  <circle
                    v-else
                    class="current-point"
                    :cx="point.x"
                    :cy="point.y"
                    r="4.5"
                    :fill="compactLineMode ? 'white' : line.color"
                    :stroke="compactLineMode ? line.color : 'white'"
                    :stroke-width="compactLineMode ? 2 : 1.3"
                  />
                </g>
              </g>
              <g class="amount-label-layer">
                <g
                  v-for="label in labelLayout.labels"
                  :key="label.key"
                  class="chart-value-label"
                  :data-series="label.comparison ? 'comparison' : 'current'"
                  :data-metric="label.metricKey"
                  :data-segment="label.segmentKey"
                  :data-index="label.index"
                  :data-month="displayPeriods[label.index]?.from"
                  :data-period="
                    groupedPeriodMode
                      ? displayPeriods[label.index]?.key
                      : undefined
                  "
                  :data-point-x="label.pointX"
                  :data-point-y="label.pointY"
                  role="button"
                  tabindex="0"
                  :aria-label="label.description + '，' + label.text"
                  @click="
                    selectLineValue(
                      label.description,
                      label.amount,
                      label.index,
                      label.comparison,
                      label.metricKey,
                      label.projectNames,
                    )
                  "
                  @focus="
                    selectValue(
                      label.description,
                      label.amount,
                      label.unit,
                      label.projectNames,
                    )
                  "
                  @keydown.enter.prevent="
                    selectLineValue(
                      label.description,
                      label.amount,
                      label.index,
                      label.comparison,
                      label.metricKey,
                      label.projectNames,
                    )
                  "
                  @keydown.space.prevent="
                    selectLineValue(
                      label.description,
                      label.amount,
                      label.index,
                      label.comparison,
                      label.metricKey,
                      label.projectNames,
                    )
                  "
                >
                  <rect
                    class="amount-label-background"
                    :x="label.x"
                    :y="label.y"
                    :width="label.width"
                    :height="label.height"
                    :rx="compactLineMode ? 3 : 5"
                    fill="white"
                    :stroke="compactLineMode ? '#dce5e9' : label.color"
                    :stroke-dasharray="
                      label.comparison && !compactLineMode ? '3 2' : undefined
                    "
                  />
                  <text
                    v-if="!compactLineMode"
                    :x="label.x + 9"
                    :y="label.y + 12"
                    class="amount-label-caption"
                    :fill="label.color"
                  >
                    {{ label.caption }}
                  </text>
                  <text
                    :x="label.x + (compactLineMode ? 6 : 9)"
                    :y="label.y + (compactLineMode ? 14 : 28)"
                    class="amount-label-value"
                    :fill="label.color"
                  >
                    <tspan
                      v-for="(amountLine, lineIndex) in label.amountLines"
                      :key="lineIndex"
                      :x="label.x + (compactLineMode ? 6 : 9)"
                      :dy="lineIndex === 0 ? 0 : 16"
                    >
                      {{ amountLine }}
                    </tspan>
                  </text>
                </g>
              </g>
            </svg>
          </div>
        </div>
        <p class="line-scroll-hint">
          {{
            quarterHistoryMode
              ? lineQuantityUnit
                ? `横轴连续浏览最多 12 个自然季度；按行政区与服务单位显示签订数量，零值显示 0${lineQuantityUnit}并连线，未知季度断开。`
                : "横轴连续浏览最多 12 个自然季度；不足十二期时尊重历史边界，未完季度只到统计截止月。精准金额逐点标注，零值连线、未知季度断开。"
              : periodViewMode
                ? lineQuantityUnit
                  ? `横轴只使用已返回的季度或年度，不补造月份。每条服务单位折线均标签订数量，零值显示 0${lineQuantityUnit}并连线，未知期间保留断点。`
                  : "横轴只使用已返回的季度或年度，不补造月份。每个有效点均标完整金额，真实零值连线，未知期间保留断点。"
                : monthWindowMode
                  ? lineQuantityUnit
                    ? `横轴始终保留连续 12 个月；滚轮或拖动直接浏览历史。每个行政区与服务单位均标签订数量，真实零值连线并显示 0${lineQuantityUnit}，未知月份保留断点。`
                    : "横轴始终保留连续 12 个月；滚轮或拖动直接浏览历史。每个有效点均标完整金额，真实零值连线并显示 ¥0.00，未知月份保留断点。"
                  : "每个有效点均标注完整金额；可横向滚动查看。标签自动分层避让，不改变真实数据点位置。"
          }}
        </p>
      </template>
    </template>

    <div v-if="selection" class="chart-inspector" aria-live="polite">
      <span>{{ selection.label }}</span
      ><strong>{{ formatLineValue(selection.amount, selection.unit) }}</strong>
      <div
        v-if="selection.projectNames !== undefined"
        class="chart-inspector-projects"
      >
        <template v-if="selection.projectNames.length">
          <span>本点签订项目（{{ selection.projectNames.length }}个）</span>
          <ul>
            <li
              v-for="(projectName, index) in selection.projectNames"
              :key="index + ':' + projectName"
            >
              {{ projectName }}
            </li>
          </ul>
        </template>
        <span v-else>该期间该分组无新签项目</span>
      </div>
    </div>
    <p class="chart-footnote">
      金额与数量直接使用原始精确值；仅图形坐标与占比使用近似比例。未知值不作为零值。
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { formatMonthlyFinancialAmount } from "@/utils/monthlyFinancialReportPresentation";
import {
  financialLineAxisRange,
  type FinancialLineAxisRange,
} from "@/utils/monthlyFinancialAnalysisAxis";
import {
  FINANCIAL_WINDOW_MONTHS,
  FINANCIAL_WINDOW_QUARTERS,
  financialMonthOffset,
  financialQuarterRange,
  financialTwelveMonthRange,
  financialTwelveQuarterRange,
  type FinancialMonthRange,
} from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisPeriod,
  FinancialAnalysisSeries,
  FinancialAnalysisValue,
} from "@/types/monthlyFinancialAnalysis";
import type { FinancialAnalysisPointSelection } from "@/types/monthlyFinancialAnalysisChart";

const props = withDefaults(
  defineProps<{
    title: string;
    type: "line" | "bar" | "donut";
    periods?: FinancialAnalysisPeriod[];
    series?: FinancialAnalysisSeries[];
    comparisonSeries?: FinancialAnalysisSeries[];
    comparisonPeriods?: FinancialAnalysisPeriod[];
    comparisonLabel?: string;
    comparisonVisible?: boolean;
    items?: FinancialAnalysisValue[];
    disabledReason?: string;
    structureMode?: "strict" | "known-positive";
    /** 人员成本的真实零值仍在图例显示百分之零，不混入待确认费用。 */
    costStructure?: boolean;
    fixedMonthWindow?: boolean;
    continuousHistory?: boolean;
    periodView?: boolean;
    quarterHistory?: boolean;
    windowEnd?: string;
    maxMonth?: string;
    minMonth?: string;
    historyLoading?: boolean;
    historyError?: string;
    showCurrentMonthShortcut?: boolean;
    currentMonthDisabled?: boolean;
    preferredMetricKeys?: string[];
  }>(),
  {
    periods: () => [],
    series: () => [],
    comparisonSeries: () => [],
    comparisonPeriods: () => [],
    comparisonLabel: "对比期",
    comparisonVisible: true,
    items: () => [],
    disabledReason: "",
    structureMode: "strict",
    costStructure: false,
    fixedMonthWindow: false,
    continuousHistory: false,
    periodView: false,
    quarterHistory: false,
    windowEnd: "",
    maxMonth: "",
    minMonth: "",
    historyLoading: false,
    historyError: "",
    showCurrentMonthShortcut: false,
    currentMonthDisabled: false,
    preferredMetricKeys: () => [],
  },
);
const emit = defineEmits<{
  "window-change": [range: FinancialMonthRange];
  "point-select": [selection: FinancialAnalysisPointSelection];
  "metric-change": [];
  "metric-selected": [key: string];
  "current-month": [];
}>();
function requestCurrentMonth() {
  if (
    props.type !== "line" ||
    !props.showCurrentMonthShortcut ||
    props.currentMonthDisabled
  )
    return;
  emit("current-month");
}

const colors = [
  "#167d86",
  "#6872b8",
  "#b87c37",
  "#92709d",
  "#4e86a3",
  "#7a8c4b",
  "#b6675e",
  "#677e8c",
];
const circumference = 2 * Math.PI * 88;
const quarterHistoryMode = computed(() => props.quarterHistory);
const periodViewMode = computed(
  () => props.periodView && !quarterHistoryMode.value,
);
const groupedPeriodMode = computed(
  () => periodViewMode.value || quarterHistoryMode.value,
);
const monthWindowMode = computed(
  () =>
    props.fixedMonthWindow &&
    !periodViewMode.value &&
    !quarterHistoryMode.value,
);
const historyWindowMode = computed(
  () => monthWindowMode.value || quarterHistoryMode.value,
);
const historyMode = computed(
  () =>
    quarterHistoryMode.value ||
    (props.continuousHistory && !periodViewMode.value),
);
const compactLineMode = computed(
  () => historyMode.value || periodViewMode.value,
);
const availableLineWidth = ref(900);
const axisWidth = computed(() =>
  monthWindowMode.value && availableLineWidth.value < 520 ? 48 : 80,
);
const plotTop = computed(() => (compactLineMode.value ? 30 : 66));
const plotBottom = computed(() =>
  compactLineMode.value ? 442 : monthWindowMode.value ? 420 : 330,
);
const selection = ref<{
  label: string;
  amount: string | null;
  unit?: FinancialAnalysisSeries["unit"];
  projectNames?: string[];
} | null>(null);
const activeMetricKey = ref("");
const metricSelectionTouched = ref(false);
const multipleMetrics = ref(false);
const selectedMetricKeys = ref<string[]>([]);
const lineScrollRef = ref<HTMLElement | null>(null);
let needsLatestPosition = true;
let chartDisposed = false;
let scrollResizeObserver: globalThis.ResizeObserver | null = null;
const localWindowEnd = ref("");
const windowDragging = ref(false);
let windowPointerId: number | null = null;
let pointerStartX = 0;
let pointerStartEnd = "";
let pointerMoved = false;
let suppressWindowClick = false;
let windowClickTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let wheelDistance = 0;
let historySnapTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let pointerStartScrollLeft = 0;
// 分期模式只在传入期间内本地浏览，以期序号保留尺寸变化前的位置。
const periodScrollPosition = ref(0);
let periodPositionInitialized = false;
const periodVisibleCount = computed(() =>
  Math.max(
    1,
    Math.min(
      props.periods.length,
      Math.max(3, Math.floor(availableLineWidth.value / 160)),
    ),
  ),
);
const periodSlotWidth = computed(
  () => Math.max(220, availableLineWidth.value) / periodVisibleCount.value,
);
const periodMaximumStart = computed(() =>
  Math.max(0, props.periods.length - periodVisibleCount.value),
);
const periodMaximumScroll = computed(
  () => periodMaximumStart.value * periodSlotWidth.value,
);

function validMonth(month: string | undefined): month is string {
  return (
    typeof month === "string" && /^(19|20)\d{2}-(0[1-9]|1[0-2])$/u.test(month)
  );
}
function currentMonth() {
  const now = new Date();
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}
const maximumWindowEnd = computed(() =>
  validMonth(props.maxMonth) ? props.maxMonth : currentMonth(),
);
const historyStepMonths = computed(() => (quarterHistoryMode.value ? 3 : 1));
const firstQuarterMonth = computed(() => {
  const minimum = validMonth(props.minMonth) ? props.minMonth : "1900-01";
  const quarter = financialQuarterRange(minimum);
  let first = quarter.from;
  if (first < minimum) {
    try {
      first = financialMonthOffset(first, 3);
    } catch {
      first = quarter.from;
    }
  }
  const latest = financialQuarterRange(maximumWindowEnd.value).from;
  return first > latest ? latest : first;
});
const minimumWindowEnd = computed(() => {
  if (quarterHistoryMode.value) {
    let firstEnd = "2099-12";
    try {
      firstEnd = financialMonthOffset(
        firstQuarterMonth.value,
        FINANCIAL_WINDOW_QUARTERS * 3 - 1,
      );
    } catch {
      /* 接近2099年底时只保留有效边界内的季度。 */
    }
    return firstEnd > maximumWindowEnd.value
      ? maximumWindowEnd.value
      : firstEnd;
  }
  const firstMonth = validMonth(props.minMonth) ? props.minMonth : "1900-01";
  let firstEnd = "2099-12";
  try {
    firstEnd = financialMonthOffset(firstMonth, FINANCIAL_WINDOW_MONTHS - 1);
  } catch {
    /* 超出完整窗口边界时停止继续向前浏览。 */
  }
  return firstEnd > maximumWindowEnd.value ? maximumWindowEnd.value : firstEnd;
});
function clampWindowEnd(month: string) {
  const valid = validMonth(month) ? month : maximumWindowEnd.value;
  const bounded =
    valid < minimumWindowEnd.value
      ? minimumWindowEnd.value
      : valid > maximumWindowEnd.value
        ? maximumWindowEnd.value
        : valid;
  return quarterHistoryMode.value
    ? financialQuarterRange(bounded, maximumWindowEnd.value).to
    : bounded;
}
watch(
  () => [
    historyWindowMode.value,
    quarterHistoryMode.value,
    props.windowEnd || props.periods.at(-1)?.to || "",
    props.minMonth,
    props.maxMonth,
  ],
  () => {
    if (!historyWindowMode.value) return;
    const next = clampWindowEnd(
      props.windowEnd || props.periods.at(-1)?.to || maximumWindowEnd.value,
    );
    if (localWindowEnd.value !== next) {
      localWindowEnd.value = next;
      void nextTick().then(syncHistoryPosition);
    }
  },
  { immediate: true },
);
const visibleWindow = computed(() => {
  const end = clampWindowEnd(localWindowEnd.value || maximumWindowEnd.value);
  if (quarterHistoryMode.value) {
    const range = financialTwelveQuarterRange(end, maximumWindowEnd.value);
    return {
      from:
        range.from < firstQuarterMonth.value
          ? firstQuarterMonth.value
          : range.from,
      to: range.to,
    };
  }
  return financialTwelveMonthRange(end);
});
const displayPeriods = computed<FinancialAnalysisPeriod[]>(() =>
  quarterHistoryMode.value
    ? Array.from({ length: historyVisibleCount.value }, (_, index) => {
        const month = financialMonthOffset(visibleWindow.value.from, index * 3);
        const range = financialQuarterRange(month, maximumWindowEnd.value);
        const key =
          month.slice(0, 4) + "-Q" + Math.ceil(Number(month.slice(5)) / 3);
        return {
          key,
          label: month.slice(0, 4) + "年第" + key.at(-1) + "季度",
          ...range,
        };
      })
    : historyWindowMode.value
      ? Array.from({ length: FINANCIAL_WINDOW_MONTHS }, (_, index) => {
          const month = financialMonthOffset(visibleWindow.value.from, index);
          return { key: month, label: month, from: month, to: month };
        })
      : props.periods,
);
function monthNumber(month: string) {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
}
const historyFirstMonth = computed(() =>
  quarterHistoryMode.value
    ? firstQuarterMonth.value
    : !monthWindowMode.value
      ? validMonth(props.minMonth)
        ? props.minMonth
        : "1900-01"
      : financialMonthOffset(minimumWindowEnd.value, -11),
);
const historyMonthCount = computed(
  () =>
    Math.floor(
      (monthNumber(maximumWindowEnd.value) -
        monthNumber(historyFirstMonth.value)) /
        historyStepMonths.value,
    ) + 1,
);
const historyVisibleCount = computed(() =>
  quarterHistoryMode.value
    ? Math.min(FINANCIAL_WINDOW_QUARTERS, historyMonthCount.value)
    : FINANCIAL_WINDOW_MONTHS,
);
const historyMonthWidth = computed(
  () =>
    (Math.max(220, availableLineWidth.value) - 54) /
    Math.max(1, historyVisibleCount.value - 1),
);
const historyCanvasWidth = computed(() =>
  Math.max(
    Math.max(220, availableLineWidth.value),
    54 + (historyMonthCount.value - 1) * historyMonthWidth.value,
  ),
);
const historyMaximumScroll = computed(() =>
  Math.max(
    0,
    (historyMonthCount.value - historyVisibleCount.value) *
      historyMonthWidth.value,
  ),
);
const historyWindowLeft = computed(
  () =>
    ((monthNumber(visibleWindow.value.from) -
      monthNumber(historyFirstMonth.value)) /
      historyStepMonths.value) *
    historyMonthWidth.value,
);
const comparisonMonthDifference = computed(() => {
  const current = props.periods
    .map((period) => period.from)
    .filter(validMonth)
    .sort()[0];
  const comparison = props.comparisonPeriods
    .map((period) => period.from)
    .filter(validMonth)
    .sort()[0];
  return current && comparison
    ? monthNumber(comparison) - monthNumber(current)
    : null;
});
const comparisonYearDifference = computed(() => {
  const current = props.periods
    .map((period) => period.from)
    .filter(validMonth)
    .sort()[0];
  const previous = props.comparisonPeriods
    .map((period) => period.from)
    .filter(validMonth)
    .sort()[0];
  if (!current || !previous) return null;
  const year = Number(current.slice(0, 4));
  const labelYear = Number(props.comparisonLabel.match(/(?:19|20)\d{2}/u)?.[0]);
  return (
    (Number.isFinite(labelYear) && labelYear >= 1900 && labelYear < year
      ? labelYear
      : Number(previous.slice(0, 4))) - year
  );
});
const currentPeriodIndices = computed(
  () => new Map(props.periods.map((period, index) => [period.key, index])),
);
const comparisonPeriodIndices = computed(
  () =>
    new Map(
      props.comparisonPeriods.map((period, index) => [period.key, index]),
    ),
);
function comparisonPeriodKey(period: FinancialAnalysisPeriod) {
  const difference = comparisonYearDifference.value;
  if (difference === null) return null;
  const year = Number(period.key.slice(0, 4)) + difference;
  return year < 1900 || year > 2099 ? null : String(year) + period.key.slice(4);
}
const periodComparisonIndices = computed(() => {
  return props.periods.map((period, index) => {
    // 真实季度或年度按期键及同一年差对齐，缺少一期时不挪用后一期金额。
    if (/^\d{4}(?:-Q[1-4])?$/u.test(period.key)) {
      const key = comparisonPeriodKey(period);
      return key ? comparisonPeriodIndices.value.get(key) : undefined;
    }
    return props.comparisonPeriods[index] ? index : undefined;
  });
});
const displayComparisonPeriods = computed<
  Array<FinancialAnalysisPeriod | undefined>
>(() => {
  if (quarterHistoryMode.value)
    return displayPeriods.value.map((period) => {
      const key = comparisonPeriodKey(period);
      const index = key ? comparisonPeriodIndices.value.get(key) : undefined;
      return index === undefined ? undefined : props.comparisonPeriods[index];
    });
  if (periodViewMode.value)
    return periodComparisonIndices.value.map((index) =>
      index === undefined ? undefined : props.comparisonPeriods[index],
    );
  if (!historyWindowMode.value) return props.comparisonPeriods;
  const difference = comparisonMonthDifference.value;
  if (difference === null) return [];
  try {
    return displayPeriods.value.map((period) => {
      const month = financialMonthOffset(period.from, difference);
      return { key: month, label: month, from: month, to: month };
    });
  } catch {
    return [];
  }
});
// 只修正可见范围的说明文字；原始标签仍供季度同比年差解析，不能替换计算输入。
const visibleComparisonLabel = computed(() => {
  if (!historyWindowMode.value) return props.comparisonLabel;
  const from = displayComparisonPeriods.value[0]?.from;
  const to = displayComparisonPeriods.value.at(-1)?.to;
  return validMonth(from) && validMonth(to) && from <= to
    ? `同期（${from}至${to}）`
    : "同期（可见范围月份未知）";
});
const currentMonthIndices = computed(
  () => new Map(props.periods.map((period, index) => [period.from, index])),
);
const comparisonMonthIndices = computed(
  () =>
    new Map(
      props.comparisonPeriods.map((period, index) => [period.from, index]),
    ),
);
function plottedSourceIndex(
  line: VisibleLine,
  index: number,
): number | undefined {
  if (quarterHistoryMode.value) {
    const period = line.comparison
      ? displayComparisonPeriods.value[index]
      : displayPeriods.value[index];
    const sourceIndex = period
      ? (line.comparison
          ? comparisonPeriodIndices.value
          : currentPeriodIndices.value
        ).get(period.key)
      : undefined;
    if (sourceIndex === undefined) return undefined;
    const source = (line.comparison ? props.comparisonPeriods : props.periods)[
      sourceIndex
    ];
    const expected = displayPeriods.value[index];
    try {
      const difference = line.comparison
        ? (comparisonYearDifference.value ?? 0) * 12
        : 0;
      // 同一季度在截止月份变化后可能仍保留旧响应，不能拿完整季金额代替未完季。
      if (
        source.from !== financialMonthOffset(expected.from, difference) ||
        source.to !== financialMonthOffset(expected.to, difference)
      )
        return undefined;
    } catch {
      return undefined;
    }
    return sourceIndex;
  }
  if (periodViewMode.value && line.comparison) {
    return periodComparisonIndices.value[index];
  }
  if (!historyWindowMode.value)
    return index >= 0 && index < line.values.length ? index : undefined;
  const month = line.comparison
    ? displayComparisonPeriods.value[index]?.from
    : displayPeriods.value[index]?.from;
  const sourceIndex =
    month === undefined
      ? undefined
      : (line.comparison
          ? comparisonMonthIndices.value
          : currentMonthIndices.value
        ).get(month);
  return sourceIndex;
}
function plottedValue(line: VisibleLine, index: number): string | null {
  const sourceIndex = plottedSourceIndex(line, index);
  return sourceIndex === undefined ? null : (line.values[sourceIndex] ?? null);
}
function plottedProjectNames(
  line: VisibleLine,
  index: number,
): string[] | undefined {
  const sourceIndex = plottedSourceIndex(line, index);
  if (sourceIndex === undefined) return undefined;
  const names = line.projectNames?.[sourceIndex];
  return Array.isArray(names) ? names : undefined;
}
function plottedPartial(line: VisibleLine, index: number): boolean {
  const sourceIndex = plottedSourceIndex(line, index);
  return sourceIndex !== undefined && line.partial?.[sourceIndex] === true;
}

watch(
  () => [
    props.series,
    props.comparisonSeries,
    props.preferredMetricKeys,
    props.preferredMetricKeys.length ? props.windowEnd : "",
  ],
  () => {
    const keys = props.series.map((item) => item.key);
    const hasAmount = (metric: FinancialAnalysisSeries, nonzero: boolean) =>
      [
        ...metric.values,
        ...(props.comparisonSeries.find((item) => item.key === metric.key)
          ?.values || []),
      ].some((value) => {
        const number = coordinateValue(value);
        return number !== null && (!nonzero || number !== 0);
      });
    const nonzeroMetric =
      props.series.find(
        (item) => item.key === "total" && hasAmount(item, true),
      ) || props.series.find((item) => hasAmount(item, true));
    // 指定业务默认口径时，真实零也算已知；无已知值仍保留该口径，不借完整总额冒充。
    const preferredMetrics = props.preferredMetricKeys.flatMap((key) => {
      const metric = props.series.find((item) => item.key === key);
      return metric ? [metric] : [];
    });
    const hasPreferredKnownAmount = (metric: FinancialAnalysisSeries) => {
      const previous = props.comparisonSeries.find(
        (item) => item.key === metric.key,
      );
      const candidates: VisibleLine[] = [
        { ...metric, metricKey: metric.key, comparison: false, color: "" },
        ...(previous
          ? [
              {
                ...previous,
                metricKey: metric.key,
                comparison: true,
                color: "",
              },
            ]
          : []),
      ];
      // 缓冲中的其他月份不代表当前窗口已知，避免又默认到一条可见范围全空的曲线。
      return candidates.some((line) =>
        displayPeriods.value.some(
          (_period, index) =>
            coordinateValue(plottedValue(line, index)) !== null,
        ),
      );
    };
    const businessDefault =
      preferredMetrics.find(hasPreferredKnownAmount) || preferredMetrics[0];
    if (!keys.includes(activeMetricKey.value)) {
      metricSelectionTouched.value = false;
      const preferred =
        businessDefault ||
        nonzeroMetric ||
        props.series.find(
          (item) => item.key === "total" && hasAmount(item, false),
        ) ||
        props.series.find((item) => hasAmount(item, false)) ||
        props.series[0];
      activeMetricKey.value = preferred?.key || "";
    } else if (
      !metricSelectionTouched.value &&
      (businessDefault || nonzeroMetric)
    ) {
      activeMetricKey.value = (businessDefault || nonzeroMetric)!.key;
    }
    selectedMetricKeys.value = selectedMetricKeys.value.filter((key) =>
      keys.includes(key),
    );
    if (!selectedMetricKeys.value.length) {
      const companion = keys.find((key) => key !== activeMetricKey.value);
      selectedMetricKeys.value = activeMetricKey.value
        ? [activeMetricKey.value, ...(companion ? [companion] : [])]
        : [];
    }
  },
  { immediate: true },
);
watch(
  () => [
    props.periods,
    props.series,
    props.comparisonSeries,
    props.comparisonPeriods,
    props.items,
    periodViewMode.value,
    quarterHistoryMode.value,
    historyWindowMode.value,
  ],
  () => {
    selection.value = null;
  },
);

function colorAt(index: number) {
  return colors[index % colors.length];
}
function formatAmount(amount: string | null) {
  return amount === null
    ? "未知／未核算"
    : formatMonthlyFinancialAmount(amount);
}
function formatLineValue(
  amount: string | null,
  unit?: FinancialAnalysisSeries["unit"],
) {
  if (amount === null) return "未知／未核算";
  return unit === "个" || unit === "组"
    ? `${amount}${unit}`
    : formatAmount(amount);
}
function displayValue(item: FinancialAnalysisValue) {
  return item.amount === null
    ? "未知／未核算"
    : item.unit === "个" || item.unit === "组"
      ? item.amount + item.unit
      : formatAmount(item.amount);
}
function selectValue(
  label: string,
  amount: string | null,
  unit?: FinancialAnalysisSeries["unit"],
  projectNames?: string[],
) {
  if ((historyWindowMode.value || periodViewMode.value) && suppressWindowClick)
    return;
  selection.value = { label, amount, unit, projectNames };
}
function selectLineValue(
  label: string,
  amount: string | null,
  index: number,
  comparison: boolean,
  metricKey: string,
  projectNames?: string[],
) {
  if ((historyWindowMode.value || periodViewMode.value) && suppressWindowClick)
    return;
  selectValue(
    label,
    amount,
    props.series.find((series) => series.key === metricKey)?.unit,
    projectNames,
  );
  let period = comparison
    ? displayComparisonPeriods.value[index]
    : displayPeriods.value[index];
  if (quarterHistoryMode.value && !comparison && period) {
    const sourceIndex = currentPeriodIndices.value.get(period.key);
    period = sourceIndex === undefined ? undefined : props.periods[sourceIndex];
  }
  if (
    coordinateValue(amount) === null ||
    !period ||
    !validMonth(period.from) ||
    !validMonth(period.to) ||
    period.from > period.to
  )
    return;
  if (groupedPeriodMode.value) {
    emit("point-select", {
      month: period.to,
      comparison,
      metricKey,
      periodKey: period.key,
      from: period.from,
      to: period.to,
    });
    return;
  }
  if (period.from !== period.to) return;
  emit("point-select", { month: period.from, comparison, metricKey });
}
function shortLabel(label: string) {
  return label.length > 16 ? label.slice(0, 15) + "…" : label;
}
function handleMetricChange() {
  metricSelectionTouched.value = true;
  emit("metric-selected", activeMetricKey.value);
}
function toggleMetric(key: string) {
  const metric = props.series.find((item) => item.key === key);
  if (
    metric?.segments?.length ||
    metric?.unit === "个" ||
    metric?.unit === "组"
  )
    return;
  metricSelectionTouched.value = true;
  if (selectedMetricKeys.value.includes(key)) {
    if (selectedMetricKeys.value.length > 1)
      selectedMetricKeys.value = selectedMetricKeys.value.filter(
        (item) => item !== key,
      );
  } else selectedMetricKeys.value = [...selectedMetricKeys.value, key];
}
function toggleMultipleMetrics() {
  if (activeMetricHasSegments.value) return;
  metricSelectionTouched.value = true;
  if (
    !multipleMetrics.value &&
    !selectedMetricKeys.value.includes(activeMetricKey.value)
  ) {
    const companion = props.series.find(
      (item) => item.key !== activeMetricKey.value,
    )?.key;
    selectedMetricKeys.value = [
      activeMetricKey.value,
      ...(companion ? [companion] : []),
    ];
  }
  multipleMetrics.value = !multipleMetrics.value;
}

// 只响应显示指标或模式的真实变化；同一指标的数据刷新不能误清项目明细。
watch(
  () =>
    JSON.stringify([
      multipleMetrics.value,
      multipleMetrics.value
        ? [...selectedMetricKeys.value].sort()
        : [activeMetricKey.value],
    ]),
  () => {
    selection.value = null;
    emit("metric-change");
  },
);

// 仅图形坐标及比例使用浮点数，绝不据此生成金额合计、提示或标签。
function coordinateValue(amount: string | null | undefined): number | null {
  if (typeof amount !== "string" || !/^[+-]?\d+(?:\.\d+)?$/u.test(amount))
    return null;
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric : null;
}
const positiveStructureItems = computed(() =>
  props.items.filter((item) => (coordinateValue(item.amount) ?? 0) > 0),
);
const excludedStructureItems = computed(() =>
  props.items.filter((item) => {
    const number = coordinateValue(item.amount);
    return number === null || (props.costStructure ? number < 0 : number <= 0);
  }),
);
const costPendingHeading = computed(() => {
  const unknown = excludedStructureItems.value.some(
    (item) => coordinateValue(item.amount) === null,
  );
  const negative = excludedStructureItems.value.some(
    (item) => (coordinateValue(item.amount) ?? 0) < 0,
  );
  return unknown && negative
    ? "待确认费用与成本冲减"
    : unknown
      ? "待确认费用"
      : "成本冲减说明";
});
const structureItems = computed(() =>
  props.structureMode === "known-positive"
    ? positiveStructureItems.value
    : props.items,
);
const donutUnavailable = computed(() => {
  if (props.disabledReason) return props.disabledReason;
  if (!props.items.length) return "所选范围暂无金额记录，暂不显示占比。";
  const values = props.items.map((item) => coordinateValue(item.amount));
  if (props.structureMode === "known-positive") {
    if (positiveStructureItems.value.length) return "";
    if (values.every((number) => number === null))
      return "全部金额未知，取得可靠数据后才能展示正金额占比。";
    if (values.every((number) => number === 0))
      return "金额均为零，不显示无意义的占比。";
    return "当前没有已知正金额；负金额、零金额及未知值保留在下方。";
  }
  if (values.some((number) => number === null))
    return "含未知或未核算金额，暂不计算占比；请先核对来源。";
  if (values.some((number) => number !== null && number < 0))
    return "含负金额，结构占比不适用；下方保留真实金额。";
  if (values.every((number) => number === 0))
    return "金额均为零，不显示无意义的占比。";
  return "";
});
const slices = computed(() => {
  if (donutUnavailable.value) return [];
  const geometricTotal = structureItems.value.reduce(
    (sum, item) => sum + (coordinateValue(item.amount) || 0),
    0,
  );
  let offset = 0;
  return structureItems.value.map((item) => {
    const ratio = (coordinateValue(item.amount) || 0) / geometricTotal;
    const length = ratio * circumference;
    const result = {
      ...item,
      color: colorAt(
        props.items.findIndex((original) => original.key === item.key),
      ),
      offset,
      length,
      percentage: (ratio * 100).toFixed(2),
    };
    offset += length;
    return result;
  });
});

const structureLegendItems = computed(() => {
  if (donutUnavailable.value && positiveStructureItems.value.length) return [];
  if (!props.costStructure || props.structureMode !== "known-positive")
    return slices.value;
  return props.items.flatMap((item, index) => {
    const slice = slices.value.find((entry) => entry.key === item.key);
    if (slice) return [slice];
    if (coordinateValue(item.amount) === 0)
      return [
        {
          ...item,
          color: colorAt(index),
          offset: 0,
          length: 0,
          percentage: "0.00",
        },
      ];
    return [];
  });
});

const barRange = computed(() => {
  const values = props.items
    .map((item) => coordinateValue(item.amount))
    .filter((number): number is number => number !== null);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  return { min, max: min === max ? 1 : max };
});
const barHeight = computed(() => Math.max(110, props.items.length * 48 + 20));
function barX(number: number) {
  return (
    176 +
    ((number - barRange.value.min) /
      (barRange.value.max - barRange.value.min || 1)) *
      350
  );
}
const barZeroX = computed(() => barX(0));
const bars = computed(() =>
  props.items.map((item) => ({
    ...item,
    numeric: coordinateValue(item.amount),
    x: barX(coordinateValue(item.amount) || 0),
  })),
);

interface VisibleLine extends FinancialAnalysisSeries {
  metricKey: string;
  comparison: boolean;
  color: string;
  segmentKey?: string;
  projectNames?: Array<string[] | null>;
}
const activeMetric = computed(() =>
  props.series.find((item) => item.key === activeMetricKey.value),
);
const activeMetricHasSegments = computed(() =>
  Boolean(activeMetric.value?.segments?.length),
);
const activeMetrics = computed(() =>
  multipleMetrics.value
    ? props.series.filter((item) => selectedMetricKeys.value.includes(item.key))
    : props.series.filter((item) => item.key === activeMetricKey.value),
);
const visibleLines = computed<VisibleLine[]>(() =>
  activeMetrics.value.flatMap((metric) => {
    const segmented =
      !multipleMetrics.value && Boolean(metric.segments?.length);
    const sources = segmented
      ? metric.segments!.map((segment) => ({
          ...segment,
          unit: metric.unit,
          segmentKey: segment.key,
        }))
      : [{ ...metric, segmentKey: undefined }];
    const comparisonMetric = props.comparisonSeries.find(
      (item) => item.key === metric.key,
    );
    return sources.flatMap((source, sourceIndex) => {
      const color = segmented
        ? colorAt(sourceIndex)
        : compactLineMode.value && !multipleMetrics.value
          ? "#167c84"
          : colorAt(props.series.findIndex((item) => item.key === metric.key));
      const current: VisibleLine = {
        ...source,
        key: `current:${metric.key}:${source.segmentKey || metric.key}`,
        metricKey: metric.key,
        comparison: false,
        color,
      };
      const comparisonSource = source.segmentKey
        ? comparisonMetric?.segments?.find(
            (segment) => segment.key === source.segmentKey,
          )
        : comparisonMetric;
      if (!comparisonSource || !props.comparisonVisible) return [current];
      return [
        current,
        {
          ...comparisonSource,
          unit: metric.unit,
          segmentKey: source.segmentKey,
          label: source.label,
          key: `comparison:${metric.key}:${source.segmentKey || metric.key}`,
          metricKey: metric.key,
          comparison: true,
          color: segmented
            ? color
            : multipleMetrics.value
              ? color
              : compactLineMode.value
                ? "#7686a1"
                : "#766c8f",
        },
      ];
    });
  }),
);
watch(activeMetricHasSegments, (segmented) => {
  if (!segmented || !multipleMetrics.value) return;
  multipleMetrics.value = false;
  selectedMetricKeys.value = activeMetricKey.value
    ? [activeMetricKey.value]
    : [];
});
const hasComparison = computed(() =>
  visibleLines.value.some((line) => line.comparison),
);
watch(
  () => props.comparisonVisible,
  () => {
    selection.value = null;
  },
);
const lineValues = computed(() =>
  visibleLines.value.flatMap((line) =>
    displayPeriods.value.flatMap((_period, index) => {
      const number = coordinateValue(plottedValue(line, index));
      return number === null ? [] : [number];
    }),
  ),
);
const hasLineData = computed(
  () => displayPeriods.value.length > 0 && lineValues.value.length > 0,
);
function monthHasPlottedValue(index: number) {
  return visibleLines.value.some(
    (line) => coordinateValue(plottedValue(line, index)) !== null,
  );
}
function monthAxisLabel(period: FinancialAnalysisPeriod | undefined) {
  if (!period) return "—";
  if (quarterHistoryMode.value) {
    const quarter = period.key.slice(-2);
    return quarter === "Q1" || period.key === displayPeriods.value[0]?.key
      ? period.key.slice(0, 4) + "/" + quarter
      : quarter;
  }
  if (periodViewMode.value)
    return period.label.replace(/年第([1-4])季度$/u, "年$1季度");
  if (!historyWindowMode.value) return period.label;
  if (historyMode.value)
    return period.from.endsWith("-01")
      ? period.from.replace("-", "/")
      : Number(period.from.slice(5)) + "月";
  return availableLineWidth.value < 700
    ? period.from.slice(5)
    : period.from.replace("-", "/");
}
function measureText(text: string, size = 12): number {
  return Array.from(text).reduce(
    (width, character) =>
      width + (/[\u3400-\u9fff]/u.test(character) ? size : size * 0.64),
    0,
  );
}
function labelCaption(line: VisibleLine, index = 0) {
  if (historyWindowMode.value) {
    const month = line.comparison
      ? displayComparisonPeriods.value[index]?.from
      : displayPeriods.value[index]?.from;
    return (month || "月份未知") + (line.comparison ? " · 同期" : " · 当期");
  }
  if (!line.comparison) return "当期";
  const year =
    props.comparisonPeriods[0]?.from.match(/^\d{4}/u)?.[0] ||
    props.comparisonLabel.match(/(?:19|20)\d{2}/u)?.[0];
  return year ? year + "年同期" : "对比期";
}
const maximumLabelWidth = computed(() =>
  Math.max(
    105,
    ...visibleLines.value.flatMap((line) =>
      displayPeriods.value.flatMap((_period, index) => {
        const text = plottedValue(line, index);
        return coordinateValue(text) === null
          ? []
          : [
              Math.max(
                measureText(formatLineValue(text!, line.unit), 12),
                measureText(labelCaption(line, index), 9),
              ) + 22,
            ];
      }),
    ),
  ),
);
const lineWidth = computed(() =>
  periodViewMode.value
    ? Math.max(
        220,
        availableLineWidth.value,
        props.periods.length * periodSlotWidth.value,
      )
    : historyMode.value
      ? historyCanvasWidth.value
      : historyWindowMode.value
        ? Math.max(220, Math.floor(availableLineWidth.value))
        : Math.ceil(
            Math.max(
              760,
              axisWidth.value +
                maximumLabelWidth.value +
                28 +
                Math.max(0, displayPeriods.value.length - 1) *
                  (maximumLabelWidth.value > 240
                    ? Math.max(108, maximumLabelWidth.value * 0.65)
                    : 108),
            ),
          ),
);
function lineX(index: number) {
  if (periodViewMode.value) return (index + 0.5) * periodSlotWidth.value;
  if (quarterHistoryMode.value && historyVisibleCount.value === 1)
    return availableLineWidth.value / 2;
  if (historyMode.value)
    return (
      20 +
      ((monthNumber(displayPeriods.value[index].from) -
        monthNumber(historyFirstMonth.value)) /
        historyStepMonths.value) *
        historyMonthWidth.value
    );
  if (historyWindowMode.value)
    return (
      axisWidth.value +
      ((index + 0.5) * (lineWidth.value - axisWidth.value - 20)) /
        FINANCIAL_WINDOW_MONTHS
    );
  if (displayPeriods.value.length < 2)
    return (axisWidth.value + lineWidth.value) / 2;
  const padding = maximumLabelWidth.value / 2 + 14;
  return (
    axisWidth.value +
    padding +
    (index * (lineWidth.value - axisWidth.value - padding * 2)) /
      (displayPeriods.value.length - 1)
  );
}
const axisValues = computed(() => {
  if (!periodViewMode.value) return lineValues.value;
  const start = Math.min(periodMaximumStart.value, periodScrollPosition.value);
  const first = Math.floor(start);
  const end = Math.ceil(start + periodVisibleCount.value);
  return visibleLines.value.flatMap((line) =>
    displayPeriods.value.slice(first, end).flatMap((_period, offset) => {
      const value = coordinateValue(plottedValue(line, first + offset));
      return value === null ? [] : [value];
    }),
  );
});
const lineQuantityUnit = computed<"个" | "组" | null>(() => {
  if (multipleMetrics.value) return null;
  const unit = activeMetric.value?.unit;
  return unit === "个" || unit === "组" ? unit : null;
});
const lockedHistoryRange = ref<FinancialLineAxisRange | null>(null);
const lineRange = computed(() => {
  if (lockedHistoryRange.value) return lockedHistoryRange.value;
  if (lineQuantityUnit.value) {
    const maximum = Math.max(0, ...axisValues.value);
    const step = Math.max(1, Math.ceil((maximum * 2) / 4));
    return {
      min: 0,
      max: step * 4,
      hasValues: axisValues.value.length > 0,
      nonZeroOrigin: false,
    };
  }
  return financialLineAxisRange(axisValues.value);
});
function lockAxisRange() {
  if (!lockedHistoryRange.value)
    lockedHistoryRange.value = { ...lineRange.value };
}
watch(
  [
    activeMetricKey,
    multipleMetrics,
    selectedMetricKeys,
    () => props.comparisonVisible,
  ],
  () => {
    lockedHistoryRange.value = null;
  },
);
function lineY(number: number) {
  const magnitude =
    Math.max(Math.abs(lineRange.value.min), Math.abs(lineRange.value.max)) || 1;
  return (
    plotBottom.value -
    ((number / magnitude - lineRange.value.min / magnitude) /
      (lineRange.value.max / magnitude - lineRange.value.min / magnitude ||
        1)) *
      (plotBottom.value - plotTop.value)
  );
}
function axisLabel(number: number) {
  if (lineQuantityUnit.value)
    return `${Number(number.toPrecision(4))}${lineQuantityUnit.value}`;
  const magnitude = Math.abs(number);
  if (magnitude >= 100_000_000)
    return String(Number((number / 100_000_000).toPrecision(4))) + "亿";
  if (magnitude >= 10_000)
    return String(Number((number / 10_000).toPrecision(4))) + "万";
  return String(Number(number.toPrecision(4)));
}
const ticks = computed(() => {
  const magnitude =
    Math.max(Math.abs(lineRange.value.min), Math.abs(lineRange.value.max)) || 1;
  const low = lineRange.value.min / magnitude;
  const high = lineRange.value.max / magnitude;
  const numbers = Array.from(
    { length: 5 },
    (_, index) => (low * (1 - index / 4) + high * (index / 4)) * magnitude,
  );
  if (
    lineRange.value.min < 0 &&
    lineRange.value.max > 0 &&
    !numbers.includes(0)
  )
    numbers.push(0);
  return numbers
    .sort((left, right) => left - right)
    .map((number) => ({
      y: lineY(number),
      label: axisLabel(number),
      zero: number === 0,
    }));
});
function diamondPath(x: number, y: number) {
  return (
    "M " +
    x +
    " " +
    (y - 6.5) +
    " L " +
    (x + 6.5) +
    " " +
    y +
    " L " +
    x +
    " " +
    (y + 6.5) +
    " L " +
    (x - 6.5) +
    " " +
    y +
    " Z"
  );
}
const plottedLines = computed(() =>
  visibleLines.value
    .map((line) => {
      const points = displayPeriods.value.flatMap((period, index) => {
        const amount = plottedValue(line, index);
        const number = coordinateValue(amount);
        const pointPeriod = line.comparison
          ? displayComparisonPeriods.value[index]?.label ||
            (historyWindowMode.value ? "对比月份未知" : props.comparisonLabel)
          : period.label;
        return number === null
          ? []
          : [
              {
                index,
                month: period.from,
                periodKey: period.key,
                sourcePeriodKey: line.comparison
                  ? displayComparisonPeriods.value[index]?.key || null
                  : period.key,
                sourceMonth: line.comparison
                  ? displayComparisonPeriods.value[index]?.from || null
                  : period.from,
                amount: amount as string,
                projectNames: plottedProjectNames(line, index),
                x: lineX(index),
                y: lineY(number),
                description:
                  pointPeriod +
                  " · " +
                  line.label +
                  (plottedPartial(line, index) ? "（已知部分）" : "") +
                  " · " +
                  (line.comparison ? visibleComparisonLabel.value : "当期"),
              },
            ];
      });
      const edges = points.flatMap((point, index) => {
        const previous = points[index - 1];
        return !previous || previous.index !== point.index - 1
          ? []
          : [
              {
                key: previous.index + "-" + point.index,
                fromMonth: previous.month,
                toMonth: point.month,
                fromPeriod: previous.periodKey,
                toPeriod: point.periodKey,
                x1: previous.x,
                y1: previous.y,
                x2: point.x,
                y2: point.y,
              },
            ];
      });
      return { ...line, points, edges };
    })
    .sort((left, right) => Number(right.comparison) - Number(left.comparison)),
);

interface AmountLabel {
  key: string;
  metricKey: string;
  segmentKey?: string;
  comparison: boolean;
  index: number;
  amount: string;
  unit?: FinancialAnalysisSeries["unit"];
  projectNames?: string[];
  text: string;
  amountLines: string[];
  caption: string;
  description: string;
  color: string;
  pointX: number;
  pointY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}
function rectanglesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
  gap = 0,
) {
  return (
    left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y
  );
}
const labelLayout = computed(() => {
  const labels: AmountLabel[] = [];
  let canvasHeight =
    historyWindowMode.value || periodViewMode.value
      ? Math.max(480, plotBottom.value + (compactLineMode.value ? 58 : 66))
      : 394;
  const lines = [...plottedLines.value].sort(
    (left, right) => Number(left.comparison) - Number(right.comparison),
  );
  const allPoints = lines.flatMap((line) => line.points);
  for (let index = 0; index < displayPeriods.value.length; index += 1) {
    const seeds = lines.flatMap((line) => {
      const point = line.points.find((item) => item.index === index);
      return point ? [{ line, point }] : [];
    });
    for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
      const { line, point } = seeds[seedIndex];
      const text = formatLineValue(point.amount, line.unit);
      const caption = labelCaption(line, index);
      const idealWidth = Math.ceil(
        compactLineMode.value
          ? Math.max(48, measureText(text, 11) + 12)
          : Math.max(
              105,
              measureText(text, 12) + 22,
              measureText(caption, 9) + 22,
            ),
      );
      const width =
        historyWindowMode.value || periodViewMode.value
          ? Math.min(
              idealWidth,
              Math.max(
                80,
                (compactLineMode.value
                  ? availableLineWidth.value
                  : lineWidth.value) - 20,
              ),
            )
          : idealWidth;
      const amountLines =
        historyWindowMode.value || periodViewMode.value
          ? wrapAmount(
              text,
              width - (compactLineMode.value ? 12 : 18),
              compactLineMode.value ? 11 : 12,
            )
          : [text];
      const height = (compactLineMode.value ? 4 : 20) + amountLines.length * 16;
      const x = periodViewMode.value
        ? Math.max(
            4,
            Math.min(point.x - width / 2, lineWidth.value - width - 4),
          )
        : historyMode.value
          ? Math.max(
              historyWindowLeft.value + 4,
              Math.min(
                point.x - width / 2,
                historyWindowLeft.value + availableLineWidth.value - width - 4,
              ),
            )
          : historyWindowMode.value
            ? Math.max(
                10,
                Math.min(point.x - width / 2, lineWidth.value - width - 10),
              )
            : point.x - width / 2;
      const nearbyLabels = labels.filter(
        (label) => label.x < x + width + 6 && label.x + label.width + 6 > x,
      );
      const nearbyPoints = allPoints.filter(
        (other) => other.x + 11 > x && other.x - 11 < x + width,
      );
      const desiredY = point.y + (line.comparison ? 13 : -height - 13);
      const candidates = Array.from(
        { length: Math.floor((plotBottom.value - height - 10) / 2) + 1 },
        (_, candidate) => 10 + candidate * 2,
      ).sort(
        (left, right) =>
          Math.abs(left - desiredY) - Math.abs(right - desiredY) ||
          left - right,
      );
      let y =
        historyWindowMode.value && !historyMode.value
          ? undefined
          : candidates.find((top) => {
              const box = { x, y: top, width, height };
              return (
                !nearbyLabels.some((existing) =>
                  rectanglesOverlap(box, existing, 6),
                ) &&
                !nearbyPoints.some((other) =>
                  rectanglesOverlap(
                    box,
                    { x: other.x - 8, y: other.y - 8, width: 16, height: 16 },
                    3,
                  ),
                )
              );
            });
      if (y === undefined) {
        y =
          historyWindowMode.value || periodViewMode.value
            ? plotBottom.value + 72
            : 396;
        while (
          nearbyLabels.some((existing) =>
            rectanglesOverlap({ x, y: y!, width, height }, existing, 6),
          )
        )
          y += height + 8;
      }
      const label: AmountLabel = {
        key: line.key + ":" + index,
        metricKey: line.metricKey,
        segmentKey: line.segmentKey,
        comparison: line.comparison,
        index,
        amount: point.amount,
        unit: line.unit,
        projectNames: point.projectNames,
        text,
        amountLines,
        caption,
        description: point.description,
        color: line.color,
        pointX: point.x,
        pointY: point.y,
        x,
        y,
        width,
        height,
        anchorX: point.x,
        anchorY: point.y < y ? y : y + height,
      };
      labels.push(label);
      canvasHeight = Math.max(canvasHeight, y + height + 14);
    }
  }
  return { labels, height: canvasHeight };
});

function wrapAmount(text: string, maximumWidth: number, size = 12): string[] {
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index += 1) {
    const next = current + text[index];
    if (current && measureText(next, size) > maximumWidth) {
      lines.push(current);
      current = text[index];
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function positionLatestPeriod() {
  const element = lineScrollRef.value;
  if (
    chartDisposed ||
    historyWindowMode.value ||
    periodViewMode.value ||
    !needsLatestPosition ||
    !element ||
    element.clientWidth <= 0
  )
    return;
  element.scrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  needsLatestPosition = false;
}
function updateLineViewport() {
  const element = lineScrollRef.value;
  if (chartDisposed || !element) return;
  const width = element.clientWidth || element.getBoundingClientRect().width;
  if (compactLineMode.value && width <= 0) {
    needsLatestPosition = true;
    return;
  }
  const changed = width > 0 && availableLineWidth.value !== width;
  if (width > 0) availableLineWidth.value = width;
  if (periodViewMode.value) {
    if (changed || needsLatestPosition || !periodPositionInitialized)
      void nextTick().then(syncPeriodPosition);
  } else if (historyMode.value) {
    if (changed || needsLatestPosition) {
      needsLatestPosition = false;
      void nextTick().then(syncHistoryPosition);
    }
  } else if (historyWindowMode.value) element.scrollLeft = 0;
  else positionLatestPeriod();
}

function setWindowEnd(month: string, preserveScroll = false) {
  if (!historyWindowMode.value) return;
  const next = clampWindowEnd(month);
  if (next === visibleWindow.value.to) return;
  localWindowEnd.value = next;
  selection.value = null;
  emit("window-change", { ...visibleWindow.value });
  if (historyMode.value && !preserveScroll)
    void nextTick().then(syncHistoryPosition);
}
function syncHistoryPosition() {
  if (!historyMode.value || !lineScrollRef.value || chartDisposed) return;
  if (lineScrollRef.value.clientWidth <= 0) {
    needsLatestPosition = true;
    return;
  }
  lineScrollRef.value.scrollLeft = historyWindowLeft.value;
}
function syncPeriodPosition() {
  const element = lineScrollRef.value;
  if (
    !periodViewMode.value ||
    !element ||
    chartDisposed ||
    element.clientWidth <= 0
  )
    return;
  periodScrollPosition.value = periodPositionInitialized
    ? Math.max(
        0,
        Math.min(
          Math.max(0, props.periods.length - 1),
          periodScrollPosition.value,
        ),
      )
    : periodMaximumStart.value;
  periodPositionInitialized = true;
  needsLatestPosition = false;
  // 全屏可能一次容纳全部期间；只裁剪当前像素位置，保留退出全屏后要恢复的期序。
  element.scrollLeft =
    Math.min(periodMaximumStart.value, periodScrollPosition.value) *
    periodSlotWidth.value;
}
function handlePeriodScroll() {
  const element = lineScrollRef.value;
  if (!periodViewMode.value || !element || element.clientWidth <= 0) return;
  // 尺寸变化可能先引发浏览器裁剪滚动位置，必须先按原期序恢复新像素位置。
  if (Math.abs(element.clientWidth - availableLineWidth.value) > 1) {
    updateLineViewport();
    return;
  }
  const expectedLeft =
    Math.min(periodMaximumStart.value, periodScrollPosition.value) *
    periodSlotWidth.value;
  if (
    periodPositionInitialized &&
    Math.abs(element.scrollLeft - expectedLeft) < 0.5
  )
    return;
  lockAxisRange();
  periodPositionInitialized = true;
  periodScrollPosition.value = Math.max(
    0,
    Math.min(
      periodMaximumStart.value,
      element.scrollLeft / periodSlotWidth.value,
    ),
  );
  if (
    windowPointerId === null &&
    (Math.abs(
      periodScrollPosition.value - Math.round(periodScrollPosition.value),
    ) > 0.001 ||
      lockedHistoryRange.value !== null)
  ) {
    clearHistorySnap();
    historySnapTimer = globalThis.setTimeout(snapHistoryScroll, 140);
  }
}
function handleHistoryScroll() {
  if (periodViewMode.value) {
    handlePeriodScroll();
    return;
  }
  if (!historyMode.value || !lineScrollRef.value) return;
  // 隐藏模块时浏览器可能将滚动位置归零，不能据此提交历史月份查询。
  if (lineScrollRef.value.clientWidth <= 0) return;
  // 布局改变产生的滚动事件可能早于尺寸观察回调，先按原月份恢复，不能按旧月宽反推月份。
  if (
    Math.abs(lineScrollRef.value.clientWidth - availableLineWidth.value) > 1
  ) {
    updateLineViewport();
    return;
  }
  if (Math.abs(lineScrollRef.value.scrollLeft - historyWindowLeft.value) > 0.5)
    lockAxisRange();
  const start = Math.max(
    0,
    Math.min(
      historyMonthCount.value - historyVisibleCount.value,
      Math.round(lineScrollRef.value.scrollLeft / historyMonthWidth.value),
    ),
  );
  setWindowEnd(
    financialMonthOffset(
      historyFirstMonth.value,
      (start + historyVisibleCount.value - 1) * historyStepMonths.value,
    ),
    true,
  );
  if (
    windowPointerId === null &&
    (Math.abs(lineScrollRef.value.scrollLeft - historyWindowLeft.value) > 0.5 ||
      lockedHistoryRange.value !== null)
  ) {
    clearHistorySnap();
    historySnapTimer = globalThis.setTimeout(() => {
      historySnapTimer = null;
      snapHistoryScroll();
    }, 140);
  }
}
function snapHistoryScroll() {
  if (chartDisposed) return;
  if (periodViewMode.value) {
    handlePeriodScroll();
    periodScrollPosition.value = Math.round(periodScrollPosition.value);
    syncPeriodPosition();
    clearHistorySnap();
    lockedHistoryRange.value = null;
    return;
  }
  handleHistoryScroll();
  syncHistoryPosition();
  clearHistorySnap();
  lockedHistoryRange.value = null;
}
function clearHistorySnap() {
  if (historySnapTimer !== null) globalThis.clearTimeout(historySnapTimer);
  historySnapTimer = null;
}
function shiftWindow(offset: number, startingEnd = visibleWindow.value.to) {
  if (!historyWindowMode.value || !Number.isInteger(offset) || offset === 0)
    return;
  clearHistorySnap();
  lockedHistoryRange.value = null;
  let shifted: string;
  try {
    shifted = financialMonthOffset(
      startingEnd,
      offset * historyStepMonths.value,
    );
  } catch {
    shifted = offset < 0 ? minimumWindowEnd.value : maximumWindowEnd.value;
  }
  setWindowEnd(shifted);
}
function handleWindowWheel(event: globalThis.WheelEvent) {
  if (
    (!historyWindowMode.value && !periodViewMode.value) ||
    event.ctrlKey ||
    event.metaKey
  )
    return;
  const delta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
  if (!delta) return;
  const direction = Math.sign(delta);
  if (historyMode.value || periodViewMode.value) {
    const element = lineScrollRef.value;
    const maximumScroll = periodViewMode.value
      ? periodMaximumScroll.value
      : historyMaximumScroll.value;
    if (
      !element ||
      element.clientWidth <= 0 ||
      (direction < 0 && element.scrollLeft <= 0) ||
      (direction > 0 && element.scrollLeft >= maximumScroll)
    )
      return;
    event.preventDefault();
    lockAxisRange();
    const pixels =
      event.deltaMode === 1
        ? delta * 20
        : event.deltaMode === 2
          ? delta * availableLineWidth.value
          : delta;
    element.scrollLeft = Math.max(
      0,
      Math.min(maximumScroll, element.scrollLeft + pixels),
    );
    handleHistoryScroll();
    clearHistorySnap();
    historySnapTimer = globalThis.setTimeout(() => {
      historySnapTimer = null;
      snapHistoryScroll();
    }, 140);
    return;
  }
  if (
    (direction < 0 && visibleWindow.value.to <= minimumWindowEnd.value) ||
    (direction > 0 && visibleWindow.value.to >= maximumWindowEnd.value)
  ) {
    wheelDistance = 0;
    return;
  }
  event.preventDefault();
  if (Math.sign(wheelDistance) !== direction) wheelDistance = 0;
  wheelDistance += event.deltaMode === 0 ? delta : delta * 20;
  if (Math.abs(wheelDistance) < 48) return;
  wheelDistance = 0;
  shiftWindow(direction);
}
function handleWindowPointerDown(event: globalThis.PointerEvent) {
  if ((!historyWindowMode.value && !periodViewMode.value) || event.button !== 0)
    return;
  windowPointerId = event.pointerId;
  pointerStartX = event.clientX;
  if (historyWindowMode.value) pointerStartEnd = visibleWindow.value.to;
  if (historyMode.value || periodViewMode.value) {
    clearHistorySnap();
    pointerStartScrollLeft = lineScrollRef.value?.scrollLeft || 0;
    lockAxisRange();
  }
  pointerMoved = false;
  suppressWindowClick = false;
}
function handleWindowPointerMove(event: globalThis.PointerEvent) {
  if (
    (!historyWindowMode.value && !periodViewMode.value) ||
    windowPointerId !== event.pointerId
  )
    return;
  const distance = pointerStartX - event.clientX;
  if (!pointerMoved && Math.abs(distance) < 6) return;
  // 仅在确定拖动后捕获指针；按下即捕获会将真实点击改派到滚动容器，金额点无法触发联动。
  if (!pointerMoved) lineScrollRef.value?.setPointerCapture?.(event.pointerId);
  pointerMoved = true;
  windowDragging.value = true;
  event.preventDefault();
  if ((historyMode.value || periodViewMode.value) && lineScrollRef.value) {
    lineScrollRef.value.scrollLeft = Math.max(
      0,
      Math.min(
        periodViewMode.value
          ? periodMaximumScroll.value
          : historyMaximumScroll.value,
        pointerStartScrollLeft + distance,
      ),
    );
    handleHistoryScroll();
    return;
  }
  const slotWidth = Math.max(
    18,
    (lineWidth.value - axisWidth.value - 20) / FINANCIAL_WINDOW_MONTHS,
  );
  const offset = Math.trunc(distance / slotWidth);
  if (offset === 0) setWindowEnd(pointerStartEnd);
  else shiftWindow(offset, pointerStartEnd);
}
function finishWindowPointer(event: globalThis.PointerEvent) {
  if (windowPointerId !== event.pointerId) return;
  const element = lineScrollRef.value;
  if (element?.hasPointerCapture?.(event.pointerId))
    element.releasePointerCapture?.(event.pointerId);
  windowPointerId = null;
  windowDragging.value = false;
  if (historyMode.value || periodViewMode.value) snapHistoryScroll();
  if (pointerMoved) {
    suppressWindowClick = true;
    if (windowClickTimer !== null) globalThis.clearTimeout(windowClickTimer);
    windowClickTimer = globalThis.setTimeout(() => {
      suppressWindowClick = false;
      windowClickTimer = null;
    }, 0);
  }
}
function handleWindowKeydown(event: KeyboardEvent) {
  if (periodViewMode.value) {
    let next: number;
    if (event.key === "ArrowLeft")
      next = Math.round(periodScrollPosition.value) - 1;
    else if (event.key === "ArrowRight")
      next = Math.round(periodScrollPosition.value) + 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = periodMaximumStart.value;
    else return;
    event.preventDefault();
    clearHistorySnap();
    lockedHistoryRange.value = null;
    periodPositionInitialized = true;
    periodScrollPosition.value = Math.max(
      0,
      Math.min(periodMaximumStart.value, next),
    );
    syncPeriodPosition();
    return;
  }
  if (!historyWindowMode.value) return;
  if (event.key === "ArrowLeft") shiftWindow(-1);
  else if (event.key === "ArrowRight") shiftWindow(1);
  else if (event.key === "Home") setWindowEnd(minimumWindowEnd.value);
  else if (event.key === "End") setWindowEnd(maximumWindowEnd.value);
  else return;
  clearHistorySnap();
  lockedHistoryRange.value = null;
  event.preventDefault();
}
watch([historyFirstMonth, maximumWindowEnd], () => {
  void nextTick().then(syncHistoryPosition);
});
watch(
  () =>
    String(periodViewMode.value) +
    ":" +
    String(quarterHistoryMode.value) +
    ":" +
    (historyWindowMode.value ? [] : props.periods)
      .map((period) => period.key + ":" + period.from + ":" + period.to)
      .join("|"),
  () => {
    needsLatestPosition = true;
    periodPositionInitialized = false;
    clearHistorySnap();
    lockedHistoryRange.value = null;
    if (
      windowPointerId !== null &&
      lineScrollRef.value?.hasPointerCapture?.(windowPointerId)
    )
      lineScrollRef.value.releasePointerCapture?.(windowPointerId);
    windowPointerId = null;
    windowDragging.value = false;
    pointerMoved = false;
    wheelDistance = 0;
    suppressWindowClick = false;
    if (windowClickTimer !== null) globalThis.clearTimeout(windowClickTimer);
    windowClickTimer = null;
    void nextTick().then(updateLineViewport);
  },
  { immediate: true, flush: "post" },
);
watch(
  lineScrollRef,
  (element) => {
    scrollResizeObserver?.disconnect();
    scrollResizeObserver = null;
    if (element && typeof globalThis.ResizeObserver === "function") {
      scrollResizeObserver = new globalThis.ResizeObserver(updateLineViewport);
      scrollResizeObserver.observe(element);
    }
    void nextTick().then(updateLineViewport);
  },
  { flush: "post" },
);
onBeforeUnmount(() => {
  chartDisposed = true;
  scrollResizeObserver?.disconnect();
  if (windowClickTimer !== null) globalThis.clearTimeout(windowClickTimer);
  clearHistorySnap();
  windowPointerId = null;
});
</script>

<style scoped>
.analysis-chart {
  min-width: 0;
  padding: 18px;
  border: 1px solid #e1e8ed;
  border-radius: 10px;
  background: #fff;
  color: #294859;
}
.chart-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}
h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}
.metric-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
}
.metric-button-group {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  flex-shrink: 0;
  gap: 8px;
}
.metric-controls label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #6c808f;
  font-size: 12px;
}
.metric-controls select,
.metric-controls button {
  min-height: 31px;
  padding: 5px 10px;
  border: 1px solid #d5e1e7;
  border-radius: 5px;
  background: #fff;
  color: #355e70;
  font: inherit;
  font-size: 12px;
}
.metric-controls button {
  cursor: pointer;
  white-space: nowrap;
}
.chart-current-month:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.metric-controls button[aria-pressed="true"] {
  border-color: #5c9da3;
  background: #eef8f7;
}
.metric-checklist {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid #dfe9ed;
  border-radius: 6px;
}
.metric-checklist legend {
  padding: 0 6px;
  color: #718897;
  font-size: 11px;
}
.metric-checklist label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #506e7f;
  font-size: 12px;
}
.line-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 19px;
  margin-bottom: 6px;
  color: #546f7f;
  font-size: 12px;
}
.line-legend span {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.line-legend i {
  width: 21px;
  height: 0;
  border-top: 2px solid;
}
.line-legend i.is-comparison {
  border-top-style: dashed;
}
.line-legend small {
  color: #899ba6;
  font-size: 10px;
}
.line-scroll,
.bar-scroll {
  overflow: auto;
}
.line-scroll {
  border-radius: 6px;
  scrollbar-width: thin;
  scrollbar-color: #b6cdd4 #f4f8fa;
}
.line-scroll.is-fixed-window {
  width: 100%;
  overflow-x: hidden;
  touch-action: pan-y;
  user-select: none;
  cursor: grab;
}
.line-scroll.is-window-dragging {
  cursor: grabbing;
}
.history-chart-shell {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  min-width: 0;
}
.history-y-axis {
  position: relative;
  color: #708693;
  font-size: 11px;
}
.history-y-axis span {
  position: absolute;
  right: 10px;
  white-space: nowrap;
}
.line-scroll.is-continuous-history,
.line-scroll.is-period-view {
  overflow-x: auto;
  overscroll-behavior-x: contain;
  border-left: 1px solid #e8eef1;
  border-radius: 0;
  scrollbar-color: #a5c8cb #f0f5f5;
}
.line-scroll.is-period-view {
  touch-action: pan-y;
  user-select: none;
  cursor: grab;
}
.line-scroll.is-period-view.is-window-dragging {
  cursor: grabbing;
}
.is-continuous-history .amount-label-value,
.is-period-view .amount-label-value {
  font-family: inherit;
  font-size: 11px;
}
.is-continuous-history .amount-label-background,
.is-period-view .amount-label-background {
  stroke-width: 1;
  stroke-opacity: 0.7;
  fill-opacity: 0.94;
}
.is-continuous-history .amount-label-leader,
.is-period-view .amount-label-leader {
  opacity: 0.15;
}
.history-month-grid {
  stroke: #f0f3f4;
  stroke-width: 1;
}
.history-month-grid.is-year-boundary {
  stroke: #d8e2e7;
}
@media (max-width: 600px) {
  .history-chart-shell {
    grid-template-columns: 44px minmax(0, 1fr);
  }
  .history-y-axis {
    font-size: 10px;
  }
  .history-y-axis span {
    right: 6px;
  }
}
.is-fixed-window .amount-label-leader {
  opacity: 0.19;
}
.fixed-window-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 15px 0 10px;
  padding: 12px;
  border: 1px solid #dae6ea;
  border-radius: 8px;
  background: #f5f9fa;
}
.period-range-note {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 14px 0;
  color: #547581;
  font-size: 12px;
}
.period-range-note span {
  color: #7b909d;
  font-size: 11px;
}
.fixed-window-controls > div {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  text-align: center;
}
.fixed-window-controls strong {
  color: #294f65;
  font-size: 14px;
}
.fixed-window-controls span,
.fixed-window-controls small {
  color: #7b909d;
  font-size: 11px;
  line-height: 1.6;
}
.fixed-window-controls button,
.window-error button {
  flex-shrink: 0;
  border: 1px solid #c7dce3;
  border-radius: 5px;
  background: #fff;
  color: #3d697b;
  padding: 7px 10px;
  font-size: 12px;
  cursor: pointer;
}
.fixed-window-controls button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.window-loading {
  margin: 8px 0;
  color: #56858d;
  font-size: 12px;
}
.window-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  margin: 8px 0;
  background: #fff2ed;
  border-radius: 6px;
  color: #aa5747;
  font-size: 12px;
}
.unknown-month-marker {
  fill: #a0afb8;
  font-size: 9px;
}
.line-scroll:focus-visible {
  outline: 2px solid #5d9ba3;
  outline-offset: 2px;
}
.line-svg {
  display: block;
  width: 100%;
}
.bar-scroll {
  max-height: 490px;
}
.bar-svg {
  display: block;
  width: 100%;
  min-width: 800px;
}
.chart-grid {
  stroke: #e8eef1;
  stroke-width: 1;
}
.chart-grid.is-zero,
.chart-axis {
  stroke: #b8cad2;
  stroke-width: 1;
}
.axis-label,
.bar-name {
  fill: #708693;
  font-size: 11px;
}
.comparison-axis-label {
  fill: #91a0aa;
  font-size: 10px;
}
.bar-value {
  fill: #345163;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.chart-interactive,
.chart-value-label {
  cursor: pointer;
  outline: none;
}
.chart-interactive:focus-visible,
.chart-value-label:focus-visible {
  filter: drop-shadow(0 0 3px #406976);
}
.amount-label-leader {
  stroke-width: 0.8;
  opacity: 0.38;
}
.amount-label-background {
  stroke-width: 0.7;
  stroke-opacity: 0.48;
}
.amount-label-caption {
  font-size: 9px;
  opacity: 0.8;
}
.amount-label-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.chart-unavailable {
  margin: 0;
  padding: 24px 14px;
  border-radius: 8px;
  background: #f7f9fa;
  color: #748693;
  text-align: center;
  line-height: 1.8;
  font-size: 13px;
}
.line-scroll-hint,
.chart-footnote {
  margin: 11px 0 0;
  color: #8a9aa4;
  font-size: 11px;
  line-height: 1.7;
}
.chart-inspector {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: #edf7f6;
  color: #416976;
  font-size: 12px;
}
.chart-inspector strong {
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.chart-inspector-projects {
  flex: 1 0 100%;
  display: grid;
  gap: 7px;
  padding-top: 9px;
  border-top: 1px solid #d7e8e6;
}
.chart-inspector-projects > span {
  color: #62808a;
}
.chart-inspector-projects ul {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 6px 22px;
  margin: 0;
  padding-left: 18px;
}
.chart-inspector-projects li {
  min-width: 0;
  color: #315966;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.structure-scope-note {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid #e8dab9;
  border-radius: 6px;
  background: #fff9eb;
  color: #906b2a;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
}
.donut-layout {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
}
.donut-svg {
  flex-shrink: 0;
  width: 245px;
  max-width: 100%;
}
.donut-caption {
  fill: #436071;
  font-size: 15px;
  font-weight: 600;
}
.donut-caption-small {
  fill: #8798a3;
  font-size: 10px;
}
.breakdown-legend {
  flex: 1;
  min-width: 230px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.breakdown-legend li {
  display: grid;
  grid-template-columns: 8px minmax(72px, 1fr) auto;
  align-items: center;
  gap: 5px 9px;
  padding: 10px 0;
  border-bottom: 1px solid #edf2f4;
  color: #637c8b;
  font-size: 12px;
}
.breakdown-legend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.breakdown-legend strong {
  color: #365668;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.breakdown-legend small {
  grid-column: 3;
  text-align: right;
  color: #8195a2;
}
.empty-structure {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  min-height: 200px;
}
.empty-donut-svg {
  width: 178px;
  height: 178px;
  flex-shrink: 0;
}
.empty-donut-svg text {
  fill: #83949f;
  font-size: 13px;
}
.empty-donut-svg .empty-ring-note {
  font-size: 10px;
  fill: #9dabb3;
}
.empty-structure .chart-unavailable {
  max-width: 380px;
  background: transparent;
  text-align: left;
}
.excluded-structure {
  margin-top: 14px;
  padding: 12px 14px;
  border: 1px solid #e5ebef;
  border-radius: 7px;
  background: #fafcfd;
}
.excluded-structure h5 {
  margin: 0 0 9px;
  color: #677e8d;
  font-size: 12px;
}
.excluded-structure p {
  margin: 9px 0 0;
  color: #91a0aa;
  font-size: 10px;
  line-height: 1.6;
}
.unavailable-values {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 12px;
}
.unavailable-values li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding: 5px 0;
  color: #6d8290;
}
.unavailable-values strong {
  color: #496678;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
button:focus-visible,
select:focus-visible,
input:focus-visible {
  outline: 2px solid #4e929b;
  outline-offset: 2px;
}
@media (max-width: 720px) {
  .analysis-chart {
    padding: 13px;
  }
  .chart-heading {
    align-items: flex-start;
  }
  .donut-layout {
    justify-content: center;
  }
  .breakdown-legend {
    min-width: 100%;
  }
  .empty-structure .chart-unavailable {
    text-align: center;
  }
  .fixed-window-controls {
    gap: 6px;
    padding: 9px 6px;
  }
  .fixed-window-controls strong {
    font-size: 12px;
  }
  .fixed-window-controls button {
    padding: 6px;
    font-size: 11px;
  }
  .is-fixed-window .axis-label,
  .is-fixed-window .comparison-axis-label {
    font-size: 9px;
  }
}
</style>
