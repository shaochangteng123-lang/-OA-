import { nextTick } from "vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { financialLineAxisRange } from "@/utils/monthlyFinancialAnalysisAxis";
import {
  financialMonthOffset,
  financialQuarterRange,
} from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisPeriod,
  FinancialAnalysisSeries,
} from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
type Wrapper = ReturnType<typeof mount>;
const mounted = new Set<Wrapper>();
const originalObserver = globalThis.ResizeObserver;
let resize: ResizeObserverCallback | undefined;
function months(from = "2025-01", count = 24): FinancialAnalysisPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const month = financialMonthOffset(from, index);
    return { key: month, label: month, from: month, to: month };
  });
}
function quarters(): FinancialAnalysisPeriod[] {
  return Array.from({ length: 16 }, (_, index) => {
    const month = financialMonthOffset("2023-01", index * 3);
    const range = financialQuarterRange(month);
    const key = month.slice(0, 4) + "-Q" + ((index % 4) + 1);
    return { key, label: key, ...range };
  });
}
function years(): FinancialAnalysisPeriod[] {
  return Array.from({ length: 12 }, (_, index) => {
    const year = String(2015 + index);
    return {
      key: year,
      label: year + "年",
      from: year + "-01",
      to: year + "-12",
    };
  });
}
function metric(values: Array<string | null>): FinancialAnalysisSeries[] {
  return [{ key: "total", label: "合同金额", values }];
}
function mountChart(props: Record<string, unknown> = {}) {
  const periods = months();
  const wrapper = mount(MonthlyFinancialAnalysisChart, {
    props: {
      title: "零基线纵轴",
      type: "line",
      fixedMonthWindow: true,
      continuousHistory: true,
      minMonth: "2025-01",
      maxMonth: "2026-12",
      windowEnd: "2026-12",
      periods,
      series: metric(
        periods.map((_period, index) =>
          index < 12 ? "100000000" : String(12000000 + (index - 12) * 10000),
        ),
      ),
      ...props,
    },
  });
  mounted.add(wrapper);
  return wrapper;
}
async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
function setWidth(element: HTMLElement, width: number) {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: width,
  });
}
async function prepare(wrapper: Wrapper, width = 960) {
  const element = wrapper.get(".line-scroll").element as HTMLElement;
  setWidth(element, width);
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    get: () =>
      Number(wrapper.get(".line-svg").attributes("viewBox").split(" ")[2]),
  });
  await settle();
  resize?.([], {} as ResizeObserver);
  await settle();
  return element;
}
function range(wrapper: Wrapper) {
  const svg = wrapper.get(".line-svg");
  return {
    min: Number(svg.attributes("data-axis-min")),
    max: Number(svg.attributes("data-axis-max")),
  };
}
function labels(wrapper: Wrapper) {
  return wrapper.findAll(".amount-label-value").map((label) =>
    label
      .findAll("tspan")
      .map((line) => line.text())
      .join(""),
  );
}
function historyStep(wrapper: Wrapper) {
  const grid = wrapper.findAll(".history-month-grid");
  return Number(grid[1].attributes("x1")) - Number(grid[0].attributes("x1"));
}
function wheel(element: HTMLElement, delta: number) {
  element.dispatchEvent(
    new WheelEvent("wheel", { deltaY: delta, bubbles: true, cancelable: true }),
  );
}
function pointer(element: HTMLElement, type: string, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 19, clientX: x, clientY: 100, button: 0 });
  element.dispatchEvent(event);
}
function expectNoAxisControls(wrapper: Wrapper) {
  for (const selector of [
    ".axis-scale-controls",
    ".axis-scale-note",
    ".axis-zero-toggle",
    '[aria-label="从零显示纵轴"]',
  ])
    expect(wrapper.find(selector).exists()).toBe(false);
  for (const text of [
    "从零显示纵轴",
    "纵轴按可见金额自适应",
    "未从零起算",
    "最小跨度",
  ])
    expect(wrapper.text()).not.toContain(text);
}

describe("财务金额几何轴范围", () => {
  it("聚集在一千二百万附近的金额保持零基线，轴上限为可见最大值两倍", () => {
    const axis = financialLineAxisRange([12000000, 12100000, 12200000]);
    expect(axis).toMatchObject({ min: 0, max: 24400000 });
  });
  it("极小变化不裁掉零点或夸大一分钱，仍使用两倍最大金额上限", () => {
    const axis = financialLineAxisRange([12000000, 12000000.01]);
    expect(axis.min).toBe(0);
    expect(axis.max).toBe(12000000.01 * 2);
  });
  it.each([
    [12000000, 12200000],
    [-12000000, -11800000],
    [-12, 20],
    [0, 0],
  ])("固定零基线完整包含正负数与零：%j", (...values: number[]) => {
    const axis = financialLineAxisRange(values);
    expect(axis.min).toBeLessThanOrEqual(0);
    expect(axis.max).toBeGreaterThanOrEqual(0);
    expect(axis.min).toBeLessThanOrEqual(Math.min(...values));
    expect(axis.max).toBeGreaterThanOrEqual(Math.max(...values));
    expect(axis.nonZeroOrigin).toBe(false);
  });
  it("纯负值下限取最小金额两倍、上限为零，跨零则对称展开", () => {
    const negative = financialLineAxisRange([-120, -118]);
    expect(negative).toMatchObject({ min: -240, max: 0 });
    const crossing = financialLineAxisRange([-12, 0, 20]);
    expect(crossing).toMatchObject({ min: -40, max: 40 });
  });
  it("同值有稳定留白，全零与全部未知分别保留可靠零基线", () => {
    const same = financialLineAxisRange([100, 100]);
    expect(same).toMatchObject({ min: 0, max: 200 });
    expect(financialLineAxisRange([0, 0])).toMatchObject({ min: 0, max: 1 });
    expect(
      financialLineAxisRange([null, undefined, NaN, Infinity]),
    ).toMatchObject({ min: 0, max: 1 });
  });
  it.each([
    [Number.MAX_VALUE, -Number.MAX_VALUE],
    [Number.MIN_VALUE],
    [-Number.MIN_VALUE],
    [1e-200, 2e-200],
  ])("极大或极小几何值仍生成有限且有跨度的轴：%j", (...values: number[]) => {
    const axis = financialLineAxisRange(values);
    expect(Number.isFinite(axis.min)).toBe(true);
    expect(Number.isFinite(axis.max)).toBe(true);
    expect(axis.max).toBeGreaterThan(axis.min);
    expect(axis.min).toBeLessThanOrEqual(Math.min(...values));
    expect(axis.max).toBeGreaterThanOrEqual(Math.max(...values));
  });
});

describe("财务图表零基线与加高上限真实挂载", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resize = undefined;
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
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

  it("仅当前十二月参与轴上限，高位聚集点约在图中部，不存在开关或说明条", async () => {
    const wrapper = mountChart();
    const scroll = await prepare(wrapper);
    const originalRange = range(wrapper);
    const beforeLabels = labels(wrapper);
    const beforeWindow = wrapper.get(".visible-window-range").text();
    const beforeScroll = scroll.scrollLeft;
    expect(originalRange).toEqual({ min: 0, max: 24220000 });
    expect(wrapper.get(".line-svg").attributes("data-axis-mode")).toBe(
      "raised-zero",
    );
    expectNoAxisControls(wrapper);
    const positions = wrapper
      .findAll(
        '.analysis-line-series[data-series="current"] .analysis-line-point',
      )
      .map((point) => Number(point.attributes("data-point-y")));
    expect(Math.min(...positions)).toBeCloseTo(236, 6);
    expect(Math.max(...positions)).toBeLessThan(240);
    const tickLabels = wrapper
      .findAll(".history-y-axis span")
      .map((tick) => tick.text());
    expect(new Set(tickLabels).size).toBe(tickLabels.length);
    const currentPeriods = months();
    await wrapper.setProps({
      series: metric(
        currentPeriods.map((_period, index) =>
          index < 12 ? "100000000" : String(12000000 + (index - 12) * 10000),
        ),
      ),
    });
    await settle();
    expect(labels(wrapper)).toEqual(beforeLabels);
    expect(wrapper.get(".visible-window-range").text()).toBe(beforeWindow);
    expect(scroll.scrollLeft).toBe(beforeScroll);
    expect(wrapper.emitted("window-change")).toBeUndefined();
    expect(range(wrapper)).toEqual(originalRange);
    expectNoAxisControls(wrapper);
  });

  it("显示的同期参与两倍上限，隐藏同期后仅按本期最大值定轴且仍从零开始", async () => {
    const wrapper = mountChart({
      comparisonPeriods: months("2024-01"),
      comparisonSeries: metric(Array(24).fill("24000000")),
      comparisonLabel: "上年同期",
    });
    await prepare(wrapper);
    const originalLabels = labels(wrapper);
    const originalWindow = wrapper.get(".visible-window-range").text();
    expect(range(wrapper)).toEqual({ min: 0, max: 48000000 });
    await wrapper.setProps({ comparisonVisible: false });
    expect(range(wrapper)).toEqual({ min: 0, max: 24220000 });
    expect(
      wrapper.findAll('.analysis-line-series[data-series="comparison"]'),
    ).toHaveLength(0);
    await wrapper.setProps({ comparisonVisible: true });
    expect(range(wrapper)).toEqual({ min: 0, max: 48000000 });
    expect(labels(wrapper)).toEqual(originalLabels);
    expect(wrapper.get(".visible-window-range").text()).toBe(originalWindow);
    expect(wrapper.emitted("window-change")).toBeUndefined();
    expectNoAxisControls(wrapper);
  });

  it.each(["滚轮", "原生滚动条", "指针拖动"])(
    "%s浏览期间锁住旧轴，停止后按新十二月最大金额更新上限",
    async (operation) => {
      const wrapper = mountChart();
      const scroll = await prepare(wrapper);
      const before = range(wrapper);
      const distance = historyStep(wrapper);
      if (operation === "滚轮") wheel(scroll, -distance);
      else if (operation === "原生滚动条") {
        scroll.scrollLeft -= distance;
        scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
      } else {
        pointer(scroll, "pointerdown", 400);
        pointer(scroll, "pointermove", 400 + distance);
      }
      await settle();
      expect(range(wrapper)).toEqual(before);
      jest.advanceTimersByTime(139);
      await settle();
      expect(range(wrapper)).toEqual(before);
      if (operation === "指针拖动")
        pointer(scroll, "pointerup", 400 + distance);
      else jest.advanceTimersByTime(1);
      await settle();
      expect(range(wrapper)).toEqual({ min: 0, max: 200000000 });
      expect(wrapper.findAll(".chart-month-slot")).toHaveLength(12);
    },
  );

  it("十二季度仅当前可见季度定轴，季度像素滚动同样先锁定后更新", async () => {
    const periods = quarters();
    const wrapper = mountChart({
      fixedMonthWindow: false,
      continuousHistory: false,
      quarterHistory: true,
      minMonth: "2023-01",
      periods,
      series: metric(
        periods.map((_period, index) =>
          index < 4 ? "100000000" : String(12000000 + index * 1000),
        ),
      ),
    });
    const scroll = await prepare(wrapper);
    const before = range(wrapper);
    expect(before).toEqual({ min: 0, max: 24030000 });
    wheel(scroll, -historyStep(wrapper));
    await settle();
    expect(range(wrapper)).toEqual(before);
    jest.advanceTimersByTime(140);
    await settle();
    expect(range(wrapper)).toEqual({ min: 0, max: 200000000 });
    expect(wrapper.findAll(".chart-quarter-slot")).toHaveLength(12);
  });

  it("年度长范围只按可见期间定轴，滚轮锁轴结束后更新且不发月份请求", async () => {
    const periods = years();
    const wrapper = mountChart({
      fixedMonthWindow: false,
      continuousHistory: false,
      periodView: true,
      periods,
      series: metric(
        periods.map((_period, index) =>
          index < 8 ? "100000000" : String(12000000 + index * 1000),
        ),
      ),
    });
    const scroll = await prepare(wrapper, 640);
    const before = range(wrapper);
    expect(before).toEqual({ min: 0, max: 24022000 });
    wheel(scroll, -160);
    await settle();
    expect(range(wrapper)).toEqual(before);
    jest.advanceTimersByTime(140);
    await settle();
    expect(range(wrapper)).toEqual({ min: 0, max: 200000000 });
    expect(wrapper.emitted("window-change")).toBeUndefined();
    await wrapper.get(".line-scroll").trigger("keydown", { key: "End" });
    expect(range(wrapper)).toEqual(before);
  });

  it("零值位于实际轴内并有连线，未知点不被用于定轴或补零", async () => {
    const values = Array(24).fill("100");
    values[12] = "-50";
    values[13] = "0";
    values[14] = "100";
    values[15] = null;
    const wrapper = mountChart({ series: metric(values) });
    await prepare(wrapper);
    expect(range(wrapper)).toEqual({ min: -200, max: 200 });
    const zero = wrapper.get('.analysis-line-point[data-month="2026-02"]');
    expect(Number(zero.attributes("data-point-y"))).toBe(
      Number(wrapper.get(".chart-grid.is-zero").attributes("y1")),
    );
    expect(
      wrapper
        .get('.chart-value-label[data-month="2026-02"] .amount-label-value')
        .text(),
    ).toBe("¥0.00");
    expect(
      wrapper
        .find('[data-from-month="2026-01"][data-to-month="2026-02"]')
        .exists(),
    ).toBe(true);
    expect(
      wrapper
        .find('[data-from-month="2026-02"][data-to-month="2026-03"]')
        .exists(),
    ).toBe(true);
    expect(
      wrapper.find('.analysis-line-point[data-month="2026-04"]').exists(),
    ).toBe(false);
  });

  it.each([
    {
      label: "正值",
      value: "12000000",
      min: 0,
      max: 24000000,
      text: "¥12,000,000.00",
    },
    {
      label: "负值",
      value: "-12000000",
      min: -24000000,
      max: 0,
      text: "¥-12,000,000.00",
    },
  ])(
    "同一$label金额稳定落在图中部，并完整保留金额与零点",
    async ({ value, min, max, text }) => {
      const wrapper = mountChart({ series: metric(Array(24).fill(value)) });
      await prepare(wrapper);
      expect(range(wrapper)).toEqual({ min, max });
      for (const point of wrapper.findAll(".analysis-line-point"))
        expect(Number(point.attributes("data-point-y"))).toBeCloseTo(236, 6);
      expect(labels(wrapper)).toEqual(Array(12).fill(text));
      expect(wrapper.find(".chart-grid.is-zero").exists()).toBe(true);
      expectNoAxisControls(wrapper);
    },
  );

  it.each([
    { label: "全零", amount: "0" },
    { label: "全未知", amount: null },
  ])("$label保持稳定零基线且不出现开关或说明条", async ({ amount }) => {
    const wrapper = mountChart({ series: metric(Array(24).fill(amount)) });
    await prepare(wrapper);
    expect(range(wrapper)).toEqual({ min: 0, max: 1 });
    expectNoAxisControls(wrapper);
    expect(wrapper.findAll(".analysis-line-point")).toHaveLength(
      amount === null ? 0 : 12,
    );
  });

  it("极长金额仅几何近似，所有标签完整保留原值且坐标有限", async () => {
    const exact = "999999999999999999.123456789012";
    const wrapper = mountChart({ series: metric(Array(24).fill(exact)) });
    await prepare(wrapper);
    expect(labels(wrapper)).toEqual(
      Array(12).fill("¥999,999,999,999,999,999.123456789012"),
    );
    for (const point of wrapper.findAll(".analysis-line-point"))
      expect(Number.isFinite(Number(point.attributes("data-point-y")))).toBe(
        true,
      );
    expect(
      wrapper
        .findAll(".history-y-axis span")
        .map((tick) => tick.text())
        .every(
          (label) => !label.includes("Infinity") && !label.includes("NaN"),
        ),
    ).toBe(true);
    const ticks = wrapper
      .findAll(".history-y-axis span")
      .map((tick) => tick.text());
    expect(new Set(ticks).size).toBe(ticks.length);
  });

  it.each([
    { label: "极大正值", value: "1" + "0".repeat(308) },
    { label: "极小正值", value: "0." + "0".repeat(323) + "5" },
    { label: "极小负值", value: "-0." + "0".repeat(323) + "5" },
  ])(
    "$label的加高轴与真实点坐标保持有限，不把标签转成科学计数或截短",
    async ({ value }) => {
      const wrapper = mountChart({
        fixedMonthWindow: false,
        continuousHistory: false,
        periodView: true,
        periods: [
          { key: "2026", label: "2026年", from: "2026-01", to: "2026-12" },
        ],
        series: metric([value]),
      });
      await prepare(wrapper);
      const axis = range(wrapper);
      expect(Number.isFinite(axis.min)).toBe(true);
      expect(Number.isFinite(axis.max)).toBe(true);
      expect(axis.max).toBeGreaterThan(axis.min);
      expect(axis.min).toBeLessThanOrEqual(0);
      expect(axis.max).toBeGreaterThanOrEqual(0);
      const y = Number(
        wrapper.get(".analysis-line-point").attributes("data-point-y"),
      );
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(30);
      expect(y).toBeLessThanOrEqual(442);
      expect(labels(wrapper)[0].replace(/[¥,]/gu, "")).toBe(
        value.includes(".") ? value : value + ".00",
      );
      expectNoAxisControls(wrapper);
    },
  );

  it("刷新、隐藏及全屏宽度变化后仍是零基线两倍上限，月份和精确标签不跳回", async () => {
    const wrapper = mountChart();
    const scroll = await prepare(wrapper, 390);
    const rangeLabel = wrapper.get(".visible-window-range").text();
    await wrapper.setProps({ series: metric(Array(24).fill("12100000")) });
    setWidth(scroll, 0);
    scroll.scrollLeft = 0;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    resize?.([], {} as ResizeObserver);
    setWidth(scroll, 1440);
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    await settle();
    expect(range(wrapper)).toEqual({ min: 0, max: 24200000 });
    expectNoAxisControls(wrapper);
    expect(labels(wrapper)).toEqual(Array(12).fill("¥12,100,000.00"));
    expect(wrapper.get(".visible-window-range").text()).toBe(rangeLabel);
    expect(wrapper.emitted("window-change")).toBeUndefined();
    expect(scroll.scrollLeft).toBeGreaterThan(0);
  });
});
