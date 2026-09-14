import { nextTick } from "vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisPeriod,
  FinancialAnalysisSeries,
} from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
type ChartWrapper = ReturnType<typeof mount>;
const mounted = new Set<ChartWrapper>();
const originalObserver = globalThis.ResizeObserver;
let resize: ResizeObserverCallback | undefined;
const disconnect = jest.fn();

function quarters(year = 2026, count = 3): FinancialAnalysisPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const periodYear = year + Math.floor(index / 4);
    const quarter = (index % 4) + 1;
    return {
      key: periodYear + "-Q" + quarter,
      label: periodYear + "年第" + quarter + "季度",
      from: periodYear + "-" + String(quarter * 3 - 2).padStart(2, "0"),
      to: periodYear + "-" + String(quarter * 3).padStart(2, "0"),
    };
  });
}
function years(from = 2026, count = 1): FinancialAnalysisPeriod[] {
  return Array.from({ length: count }, (_, index) => ({
    key: String(from + index),
    label: from + index + "年",
    from: from + index + "-01",
    to: from + index + "-12",
  }));
}
function series(values: Array<string | null>): FinancialAnalysisSeries[] {
  return [{ key: "total", label: "金额合计", values }];
}
async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
function mountChart(props: Record<string, unknown> = {}) {
  const wrapper = mount(MonthlyFinancialAnalysisChart, {
    props: {
      title: "真实季度趋势",
      type: "line",
      periodView: true,
      periods: quarters(),
      series: series(["2053235.4", "0", "9999999999999.123456789"]),
      ...props,
    },
  });
  mounted.add(wrapper);
  return wrapper;
}
function setWidth(element: HTMLElement, width: number) {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: width,
  });
}
async function prepare(wrapper: ChartWrapper, width = 960) {
  const element = wrapper.get(".line-scroll").element as HTMLElement;
  setWidth(element, width);
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    get: () => canvasWidth(wrapper),
  });
  await settle();
  resize?.([], {} as ResizeObserver);
  await settle();
  return element;
}
function canvasWidth(wrapper: ChartWrapper) {
  return Number(wrapper.get(".line-svg").attributes("viewBox").split(" ")[2]);
}
function slotWidth(wrapper: ChartWrapper) {
  const slots = wrapper.findAll(".chart-period-slot .history-month-grid");
  return Number(slots[1].attributes("x1")) - Number(slots[0].attributes("x1"));
}
function amount(wrapper: ChartWrapper, period: string, comparison = false) {
  return wrapper
    .get(
      '.chart-value-label[data-period="' +
        period +
        '"][data-series="' +
        (comparison ? "comparison" : "current") +
        '"] .amount-label-value',
    )
    .findAll("tspan")
    .map((line) => line.text())
    .join("");
}
function wheel(element: HTMLElement, delta: number) {
  const event = new WheelEvent("wheel", {
    deltaY: delta,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return event;
}
function pointer(element: HTMLElement, type: string, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 11, clientX: x, clientY: 100, button: 0 });
  element.dispatchEvent(event);
}
function noMonthlyEvents(wrapper: ChartWrapper) {
  expect(wrapper.emitted("window-change")).toBeUndefined();
  for (const [event] of wrapper.emitted("point-select") || []) {
    const point = event as {
      month: string;
      periodKey?: string;
      from?: string;
      to?: string;
    };
    expect(point.periodKey).toBeDefined();
    expect(point.from).toBeDefined();
    expect(point.month).toBe(point.to);
  }
}

describe("财务季度年度真实分期趋势", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resize = undefined;
    disconnect.mockClear();
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = disconnect;
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    });
  });
  afterEach(async () => {
    for (const wrapper of mounted) wrapper.unmount();
    mounted.clear();
    await settle();
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: originalObserver,
    });
  });

  it("三季度恰好三槽并铺满可用宽度，尊重真实起止范围且不生成十二个月", async () => {
    const periods = quarters();
    periods[0].from = "2026-02";
    const wrapper = mountChart({
      periods,
      fixedMonthWindow: true,
      continuousHistory: true,
    });
    const scroll = await prepare(wrapper);
    expect(canvasWidth(wrapper)).toBe(960);
    expect(scroll.scrollLeft).toBe(0);
    expect(scroll.classList.contains("is-period-view")).toBe(true);
    expect(scroll.classList.contains("is-continuous-history")).toBe(false);
    expect(wrapper.find(".fixed-window-controls").exists()).toBe(false);
    expect(wrapper.findAll(".chart-month-slot")).toHaveLength(0);
    expect(wrapper.findAll(".chart-period-slot")).toHaveLength(3);
    expect(
      wrapper
        .findAll(".chart-period-slot")
        .map((slot) => slot.attributes("data-period")),
    ).toEqual(["2026-Q1", "2026-Q2", "2026-Q3"]);
    expect(
      wrapper
        .get('.chart-period-slot[data-period="2026-Q1"]')
        .attributes("data-from"),
    ).toBe("2026-02");
    expect(
      wrapper
        .findAll(".chart-period-slot .axis-label")
        .map((label) => label.text()),
    ).toEqual(["2026年1季度", "2026年2季度", "2026年3季度"]);
    expect(
      wrapper
        .findAll(".chart-period-slot .history-month-grid")
        .map((grid) => Number(grid.attributes("x1"))),
    ).toEqual([160, 480, 800]);
    expect(
      wrapper.get(".history-y-axis").element.closest(".line-scroll"),
    ).toBeNull();
    expect(wrapper.get(".period-range-note").text()).toContain("共 3 期");
    expect(amount(wrapper, "2026-Q1")).toBe("¥2,053,235.40");
    expect(amount(wrapper, "2026-Q2")).toBe("¥0.00");
    noMonthlyEvents(wrapper);
  });

  it("单年度仅一个居中槽位并保留原始超长金额，不回退图下日期卡片", async () => {
    const value = "999999999999999999.123456789012";
    const wrapper = mountChart({ periods: years(), series: series([value]) });
    const scroll = await prepare(wrapper, 520);
    expect(canvasWidth(wrapper)).toBe(scroll.clientWidth);
    expect(wrapper.findAll(".chart-period-slot")).toHaveLength(1);
    expect(
      Number(wrapper.get(".analysis-line-point").attributes("data-point-x")),
    ).toBe(260);
    expect(amount(wrapper, "2026")).toBe(
      "¥999,999,999,999,999,999.123456789012",
    );
    expect(wrapper.findAll(".amount-label-value tspan")).toHaveLength(1);
    expect(wrapper.find(".amount-label-caption").exists()).toBe(false);
    const background = wrapper.get(".amount-label-background");
    expect(Number(background.attributes("height"))).toBe(20);
    expect(Number(background.attributes("y")) + 20).toBeLessThanOrEqual(442);
    noMonthlyEvents(wrapper);
  });

  it("同期同值仍保留绿色实线圆点与灰色虚线方点及两套不重叠精准标签", async () => {
    const value = "999999999999999.123456789";
    const wrapper = mountChart({
      series: series([value, value, value]),
      comparisonPeriods: quarters(2025),
      comparisonSeries: series([value, value, value]),
      comparisonLabel: "2025年同期",
    });
    await prepare(wrapper);
    expect(wrapper.findAll(".chart-value-label")).toHaveLength(6);
    expect(wrapper.find(".amount-label-caption").exists()).toBe(false);
    const current = wrapper.get('.analysis-line-series[data-series="current"]');
    const comparison = wrapper.get(
      '.analysis-line-series[data-series="comparison"]',
    );
    expect(current.get(".analysis-line-edge").attributes("stroke")).toBe(
      "#167c84",
    );
    expect(comparison.get(".analysis-line-edge").attributes("stroke")).toBe(
      "#7686a1",
    );
    expect(
      comparison.get(".analysis-line-edge").attributes("stroke-dasharray"),
    ).toBe("7 5");
    expect(comparison.findAll("rect.comparison-point")).toHaveLength(3);
    expect(current.findAll("circle.current-point")).toHaveLength(3);
    for (const period of quarters()) {
      expect(amount(wrapper, period.key)).toBe(
        "¥999,999,999,999,999.123456789",
      );
      expect(amount(wrapper, period.key, true)).toBe(
        amount(wrapper, period.key),
      );
      expect(
        current
          .get('[data-period="' + period.key + '"]')
          .attributes("data-point-x"),
      ).toBe(
        comparison
          .get('[data-period="' + period.key + '"]')
          .attributes("data-point-x"),
      );
    }
    const boxes = wrapper.findAll(".amount-label-background").map((rect) => ({
      x: Number(rect.attributes("x")),
      y: Number(rect.attributes("y")),
      width: Number(rect.attributes("width")),
      height: Number(rect.attributes("height")),
    }));
    for (let index = 0; index < boxes.length; index += 1) {
      expect(boxes[index].height).toBe(20);
      expect(boxes[index].y + boxes[index].height).toBeLessThanOrEqual(442);
      for (const other of boxes.slice(index + 1)) {
        const box = boxes[index];
        expect(
          box.x < other.x + other.width &&
            box.x + box.width > other.x &&
            box.y < other.y + other.height &&
            box.y + box.height > other.y,
        ).toBe(false);
      }
    }
  });

  it("对比缺少中间季度时按真实期键对齐，不挪用下季度金额或跨未知期连线", async () => {
    const previous = quarters(2025);
    const wrapper = mountChart({
      comparisonPeriods: [previous[0], previous[2]],
      comparisonSeries: series(["10.01", "30.03"]),
    });
    await prepare(wrapper);
    const comparison = wrapper.get(
      '.analysis-line-series[data-series="comparison"]',
    );
    expect(comparison.findAll(".analysis-line-point")).toHaveLength(2);
    expect(comparison.find('[data-period="2026-Q2"]').exists()).toBe(false);
    expect(
      comparison
        .get('[data-period="2026-Q3"]')
        .attributes("data-source-period"),
    ).toBe("2025-Q3");
    expect(amount(wrapper, "2026-Q3", true)).toBe("¥30.03");
    expect(comparison.findAll(".analysis-line-edge")).toHaveLength(0);
    await wrapper
      .get(
        '.chart-value-label[data-series="comparison"][data-period="2026-Q3"]',
      )
      .trigger("click");
    expect(wrapper.get(".chart-inspector").text()).toContain("2025年第3季度");
    expect(wrapper.get(".chart-inspector").text()).toContain("¥30.03");
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      {
        month: "2025-09",
        comparison: true,
        metricKey: "total",
        periodKey: "2025-Q3",
        from: "2025-07",
        to: "2025-09",
      },
    ]);
    noMonthlyEvents(wrapper);
  });

  it("零金额保留两侧真实线段与零标签，未知季度断点不被填零", async () => {
    const wrapper = mountChart({
      periods: quarters(2025, 5),
      series: series(["100", "0", "50", null, "200"]),
    });
    await prepare(wrapper);
    const current = wrapper.get('.analysis-line-series[data-series="current"]');
    expect(amount(wrapper, "2025-Q2")).toBe("¥0.00");
    expect(
      current
        .find('[data-from-period="2025-Q1"][data-to-period="2025-Q2"]')
        .exists(),
    ).toBe(true);
    expect(
      current
        .find('[data-from-period="2025-Q2"][data-to-period="2025-Q3"]')
        .exists(),
    ).toBe(true);
    expect(current.find('[data-period="2025-Q4"]').exists()).toBe(false);
    expect(
      current
        .find('[data-from-period="2025-Q3"][data-to-period="2026-Q1"]')
        .exists(),
    ).toBe(false);
    expect(
      wrapper
        .get('.chart-period-slot[data-period="2025-Q4"] .unknown-month-marker')
        .text(),
    ).toBe("未知");
    noMonthlyEvents(wrapper);
  });

  it.each([
    { label: "全零", values: ["0", "0", "0"] },
    { label: "全未知", values: [null, null, null] },
  ])(
    "$label仍保留真实三季度槽位，全未知无金额点而零金额有完整连线",
    async ({ values }) => {
      const wrapper = mountChart({ series: series(values) });
      await prepare(wrapper);
      expect(wrapper.findAll(".chart-period-slot")).toHaveLength(3);
      expect(wrapper.findAll(".analysis-line-point")).toHaveLength(
        values[0] === null ? 0 : 3,
      );
      expect(wrapper.findAll(".analysis-line-edge")).toHaveLength(
        values[0] === null ? 0 : 2,
      );
      if (values[0] === null) {
        expect(wrapper.findAll(".unknown-month-marker")).toHaveLength(3);
        expect(wrapper.get(".chart-unavailable").text()).toContain(
          "未知数据不会按零连线",
        );
      } else
        expect(
          wrapper.findAll(".amount-label-value").map((label) => label.text()),
        ).toEqual(["¥0.00", "¥0.00", "¥0.00"]);
      noMonthlyEvents(wrapper);
    },
  );

  it("长分期范围可像素滚动，停轮一百四十毫秒后整期吸附且不请求月份窗口", async () => {
    const periods = quarters(2024, 12);
    const wrapper = mountChart({
      periods,
      series: series(periods.map(() => "2053235.4")),
    });
    const scroll = await prepare(wrapper, 640);
    const step = slotWidth(wrapper);
    const initial = scroll.scrollLeft;
    expect(step).toBe(160);
    expect(initial).toBe(1280);
    expect(canvasWidth(wrapper)).toBe(1920);
    wheel(scroll, -20);
    await settle();
    expect(scroll.scrollLeft).toBe(initial - 20);
    jest.advanceTimersByTime(139);
    expect(scroll.scrollLeft).toBe(initial - 20);
    jest.advanceTimersByTime(1);
    await settle();
    expect(scroll.scrollLeft).toBe(initial);
    wheel(scroll, -step * 1.4);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - step * 1.4);
    jest.advanceTimersByTime(140);
    await settle();
    expect(scroll.scrollLeft).toBe(initial - step);
    expect(
      wrapper
        .findAll(".chart-period-slot")
        .map((slot) => slot.attributes("data-period")),
    ).toEqual(periods.map((period) => period.key));
    noMonthlyEvents(wrapper);
  });

  it("分期鼠标拖动、原生滚动条与键盘均限定已传范围并整期对齐", async () => {
    const periods = years(2015, 12);
    const wrapper = mountChart({
      periods,
      series: series(periods.map(() => "100")),
    });
    const scroll = await prepare(wrapper, 640);
    const step = slotWidth(wrapper);
    const initial = scroll.scrollLeft;
    pointer(scroll, "pointerdown", 400);
    pointer(scroll, "pointermove", 420);
    await settle();
    expect(scroll.scrollLeft).toBe(initial - 20);
    expect(scroll.classList.contains("is-window-dragging")).toBe(true);
    pointer(scroll, "pointerup", 420);
    await settle();
    expect(scroll.scrollLeft).toBe(initial);
    expect(scroll.classList.contains("is-window-dragging")).toBe(false);
    await wrapper.get(".line-scroll").trigger("keydown", { key: "Home" });
    expect(scroll.scrollLeft).toBe(0);
    expect(wheel(scroll, -20).defaultPrevented).toBe(false);
    await wrapper.get(".line-scroll").trigger("keydown", { key: "ArrowRight" });
    expect(scroll.scrollLeft).toBe(step);
    scroll.scrollLeft = step * 2.4;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    jest.advanceTimersByTime(140);
    await settle();
    expect(scroll.scrollLeft).toBe(step * 2);
    await wrapper.get(".line-scroll").trigger("keydown", { key: "End" });
    expect(scroll.scrollLeft).toBe(initial);
    expect(wheel(scroll, 20).defaultPrevented).toBe(false);
    await wrapper.get(".line-scroll").trigger("keydown", { key: "ArrowRight" });
    expect(scroll.scrollLeft).toBe(initial);
    noMonthlyEvents(wrapper);
  });

  it("同分期数据刷新保留浏览位置，清除旧金额查看并展示新精确值", async () => {
    const periods = quarters(2024, 12);
    const wrapper = mountChart({
      periods,
      series: series(periods.map(() => "100")),
    });
    const scroll = await prepare(wrapper, 640);
    await wrapper.get(".line-scroll").trigger("keydown", { key: "Home" });
    await wrapper.get(".line-scroll").trigger("keydown", { key: "ArrowRight" });
    const position = scroll.scrollLeft;
    await wrapper
      .get('.chart-value-label[data-period="2024-Q2"]')
      .trigger("click");
    expect(wrapper.find(".chart-inspector").exists()).toBe(true);
    await wrapper.setProps({
      periods: quarters(2024, 12),
      series: series(periods.map(() => "2053235.40123456")),
    });
    await settle();
    expect(scroll.scrollLeft).toBe(position);
    expect(wrapper.find(".chart-inspector").exists()).toBe(false);
    expect(amount(wrapper, "2024-Q2")).toBe("¥2,053,235.40123456");
    noMonthlyEvents(wrapper);
  });

  it("尺寸及全屏布局变化先触发滚动裁剪时按原期序恢复，不跳到最早或最新期间", async () => {
    const periods = quarters(2024, 12);
    const wrapper = mountChart({
      periods,
      series: series(periods.map(() => "100")),
    });
    const scroll = await prepare(wrapper, 640);
    await wrapper.get(".line-scroll").trigger("keydown", { key: "Home" });
    for (let index = 0; index < 3; index += 1)
      await wrapper
        .get(".line-scroll")
        .trigger("keydown", { key: "ArrowRight" });
    const originalIndex = scroll.scrollLeft / slotWidth(wrapper);
    expect(originalIndex).toBe(3);
    setWidth(scroll, 1100);
    scroll.scrollLeft = 0;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(originalIndex * slotWidth(wrapper));
    setWidth(scroll, 1280);
    resize?.([], {} as ResizeObserver);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(originalIndex * slotWidth(wrapper));
    setWidth(scroll, 2000);
    resize?.([], {} as ResizeObserver);
    await settle();
    expect(scroll.scrollLeft).toBe(0);
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    await settle();
    setWidth(scroll, 640);
    resize?.([], {} as ResizeObserver);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(originalIndex * slotWidth(wrapper));
    noMonthlyEvents(wrapper);
  });

  it("隐藏分期图被浏览器归零时不遗失原位置，重新显示及普通刷新仍保留", async () => {
    const periods = quarters(2024, 12);
    const wrapper = mountChart({
      periods,
      series: series(periods.map(() => "100")),
    });
    const scroll = await prepare(wrapper, 640);
    await wrapper.get(".line-scroll").trigger("keydown", { key: "Home" });
    await wrapper.get(".line-scroll").trigger("keydown", { key: "ArrowRight" });
    const before = scroll.scrollLeft;
    setWidth(scroll, 0);
    scroll.scrollLeft = 0;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    resize?.([], {} as ResizeObserver);
    await wrapper.setProps({ series: series(periods.map(() => "110")) });
    setWidth(scroll, 640);
    resize?.([], {} as ResizeObserver);
    await settle();
    expect(scroll.scrollLeft).toBe(before);
    noMonthlyEvents(wrapper);
  });

  it.each(["滚轮吸附", "指针拖动"])(
    "月度%s过程中切到分期会清理旧状态，切回月度仍能连续浏览",
    async (operation) => {
      const months = Array.from({ length: 33 }, (_, index) => {
        const month = financialMonthOffset("2024-01", index);
        return { key: month, label: month, from: month, to: month };
      });
      const wrapper = mountChart({
        periodView: false,
        fixedMonthWindow: true,
        continuousHistory: true,
        periods: months,
        series: series(months.map(() => "999999999")),
        minMonth: "2024-01",
        maxMonth: "2026-09",
        windowEnd: "2026-09",
      });
      const scroll = await prepare(wrapper, 960);
      await wrapper.get(".chart-value-label").trigger("focus");
      expect(wrapper.find(".chart-inspector").exists()).toBe(true);
      if (operation === "滚轮吸附") wheel(scroll, -20);
      else {
        pointer(scroll, "pointerdown", 400);
        pointer(scroll, "pointermove", 420);
        await settle();
        expect(scroll.classList.contains("is-window-dragging")).toBe(true);
      }
      await settle();
      await wrapper.setProps({
        periodView: true,
        fixedMonthWindow: false,
        continuousHistory: false,
        periods: quarters(),
        series: series(["100", "100", "100"]),
      });
      await settle();
      expect(wrapper.findAll(".chart-period-slot")).toHaveLength(3);
      expect(scroll.classList.contains("is-window-dragging")).toBe(false);
      expect(wrapper.find(".chart-inspector").exists()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      expect(
        Number(wrapper.get(".analysis-line-point").attributes("data-point-y")),
      ).toBeCloseTo(236, 6);
      pointer(scroll, "pointerup", 420);
      jest.advanceTimersByTime(200);
      await settle();
      expect(scroll.scrollLeft).toBe(0);
      expect(wrapper.emitted("window-change")).toBeUndefined();
      await wrapper.setProps({
        periodView: false,
        fixedMonthWindow: true,
        continuousHistory: true,
        periods: months,
        series: series(months.map(() => "500")),
        windowEnd: "2026-08",
      });
      await settle();
      expect(wrapper.findAll(".chart-month-slot")).toHaveLength(12);
      expect(wrapper.get(".visible-window-range").text()).toBe(
        "2025-09 至 2026-08",
      );
      await wrapper
        .get(".line-scroll")
        .trigger("keydown", { key: "ArrowLeft" });
      await settle();
      expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
        { from: "2025-08", to: "2026-07" },
      ]);
    },
  );

  it("分期金额点击或键盘发真实期间，不伪装单月，粒度切换后清旧查看", async () => {
    const wrapper = mountChart();
    await prepare(wrapper);
    await wrapper
      .get('.chart-value-label[data-period="2026-Q1"]')
      .trigger("click");
    expect(wrapper.get(".chart-inspector").text()).toContain("2026年第1季度");
    expect(wrapper.get(".chart-inspector").text()).toContain("¥2,053,235.40");
    await wrapper
      .get('.analysis-line-point[data-period="2026-Q2"]')
      .trigger("keydown", { key: "Enter" });
    expect(wrapper.get(".chart-inspector").text()).toContain("¥0.00");
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      {
        month: "2026-06",
        comparison: false,
        metricKey: "total",
        periodKey: "2026-Q2",
        from: "2026-04",
        to: "2026-06",
      },
    ]);
    noMonthlyEvents(wrapper);
    await wrapper.setProps({ periods: years(), series: series(["500"]) });
    await settle();
    expect(wrapper.find(".chart-inspector").exists()).toBe(false);
    expect(wrapper.findAll(".chart-period-slot")).toHaveLength(1);
    await wrapper.get(".chart-value-label").trigger("click");
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      {
        month: "2026-12",
        comparison: false,
        metricKey: "total",
        periodKey: "2026",
        from: "2026-01",
        to: "2026-12",
      },
    ]);
  });

  it("卸载时清理分期吸附定时器与尺寸观察器，不留下月份事件", async () => {
    const periods = years(2015, 12);
    const wrapper = mountChart({
      periods,
      series: series(periods.map(() => "100")),
    });
    const scroll = await prepare(wrapper, 640);
    wheel(scroll, -20);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    wrapper.unmount();
    mounted.delete(wrapper);
    expect(jest.getTimerCount()).toBe(0);
    expect(disconnect).toHaveBeenCalled();
    noMonthlyEvents(wrapper);
  });
});
