import { nextTick } from "vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
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
const disconnect = jest.fn();
function quarters(
  from = "2020-01",
  count = 27,
  maximum = "2026-08",
): FinancialAnalysisPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const month = financialMonthOffset(from, index * 3);
    const range = financialQuarterRange(month, maximum);
    const quarter = Math.ceil(Number(month.slice(5)) / 3);
    return {
      key: month.slice(0, 4) + "-Q" + quarter,
      label: month.slice(0, 4) + "年第" + quarter + "季度",
      ...range,
    };
  });
}
function series(
  periods: FinancialAnalysisPeriod[],
  amount: (period: FinancialAnalysisPeriod) => string | null = () =>
    "2053235.4",
): FinancialAnalysisSeries[] {
  return [{ key: "total", label: "金额合计", values: periods.map(amount) }];
}
function mountChart(extra: Record<string, unknown> = {}) {
  const periods = quarters();
  const wrapper = mount(MonthlyFinancialAnalysisChart, {
    props: {
      title: "季度连续历史",
      type: "line",
      quarterHistory: true,
      fixedMonthWindow: false,
      continuousHistory: false,
      periodView: false,
      windowEnd: "2026-08",
      minMonth: "2020-01",
      maxMonth: "2026-08",
      periods,
      series: series(periods),
      ...extra,
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
function step(wrapper: Wrapper) {
  const slots = wrapper.findAll(".chart-quarter-slot .history-month-grid");
  return Number(slots[1].attributes("x1")) - Number(slots[0].attributes("x1"));
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
  Object.assign(event, { pointerId: 7, clientX: x, clientY: 100, button: 0 });
  element.dispatchEvent(event);
}
function amount(wrapper: Wrapper, key: string, comparison = false) {
  return wrapper
    .get(
      '.chart-value-label[data-period="' +
        key +
        '"][data-series="' +
        (comparison ? "comparison" : "current") +
        '"] .amount-label-value',
    )
    .findAll("tspan")
    .map((line) => line.text())
    .join("");
}
function expectTwelveQuarters(wrapper: Wrapper, scroll: HTMLElement) {
  const slots = wrapper.findAll(".chart-quarter-slot");
  expect(slots).toHaveLength(12);
  const from = slots[0].attributes("data-from");
  for (let index = 0; index < slots.length; index += 1)
    expect(slots[index].attributes("data-from")).toBe(
      financialMonthOffset(from, index * 3),
    );
  expect(
    Number(slots[0].get(".history-month-grid").attributes("x1")) -
      scroll.scrollLeft,
  ).toBeCloseTo(20, 5);
  expect(
    Number(slots[11].get(".history-month-grid").attributes("x1")) -
      scroll.scrollLeft,
  ).toBeCloseTo(scroll.clientWidth - 34, 5);
}
describe("财务连续十二季度历史浏览", () => {
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

  it("季度模式固定十二个自然季度槽位，当前未完季度严格截止到八月", async () => {
    const wrapper = mountChart();
    const scroll = await prepare(wrapper);
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2023-10 至 2026-08",
    );
    expect(scroll.classList.contains("is-quarter-history")).toBe(true);
    expect(scroll.classList.contains("is-continuous-history")).toBe(true);
    expect(wrapper.findAll(".chart-month-slot")).toHaveLength(0);
    expect(wrapper.get(".fixed-window-controls").text()).toContain("12 个季度");
    expect(
      wrapper.get(".history-y-axis").element.closest(".line-scroll"),
    ).toBeNull();
    expectTwelveQuarters(wrapper, scroll);
    const last = wrapper.get('.chart-quarter-slot[data-period="2026-Q3"]');
    expect(last.attributes("data-from")).toBe("2026-07");
    expect(last.attributes("data-to")).toBe("2026-08");
    expect(last.get(".axis-label").text()).toBe("Q3");
    expect(
      wrapper
        .get('.chart-quarter-slot[data-period="2024-Q1"] .axis-label')
        .text(),
    ).toBe("2024/Q1");
    expect(wrapper.findAll(".chart-value-label")).toHaveLength(12);
    expect(amount(wrapper, "2026-Q3")).toBe("¥2,053,235.40");
    expect(wrapper.find(".amount-label-caption").exists()).toBe(false);
  });

  it("小幅滚轮立即平滑移动，停一百四十毫秒才吸附整季并以三个月为窗口步长", async () => {
    const wrapper = mountChart();
    const scroll = await prepare(wrapper);
    const initial = scroll.scrollLeft;
    const width = step(wrapper);
    wheel(scroll, -20);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - 20);
    expect(wrapper.emitted("window-change")).toBeUndefined();
    jest.advanceTimersByTime(139);
    expect(scroll.scrollLeft).toBeCloseTo(initial - 20);
    jest.advanceTimersByTime(1);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial);
    wheel(scroll, -width * 1.4);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - width * 1.4);
    jest.advanceTimersByTime(140);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - width);
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2023-07", to: "2026-06" },
    ]);
    expectTwelveQuarters(wrapper, scroll);
  });

  it("鼠标拖动、季度按钮和左右键保持十二季度，最晚窗口永不超过未完季截止月", async () => {
    const wrapper = mountChart();
    const scroll = await prepare(wrapper);
    const initial = scroll.scrollLeft;
    pointer(scroll, "pointerdown", 400);
    pointer(scroll, "pointermove", 420);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - 20);
    pointer(scroll, "pointerup", 420);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial);
    await wrapper.get('[aria-label="查看更早一个季度"]').trigger("click");
    await settle();
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2023-07 至 2026-06",
    );
    await wrapper.get(".line-scroll").trigger("keydown", { key: "Home" });
    await settle();
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2020-01 至 2022-12",
    );
    expectTwelveQuarters(wrapper, scroll);
    await wrapper.get(".line-scroll").trigger("keydown", { key: "End" });
    await settle();
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2023-10 至 2026-08",
    );
    const count = wrapper.emitted("window-change")?.length;
    await wrapper.get(".line-scroll").trigger("keydown", { key: "ArrowRight" });
    expect(wheel(scroll, 1000).defaultPrevented).toBe(false);
    expect(wrapper.emitted("window-change")).toHaveLength(count!);
    for (const [event] of wrapper.emitted("window-change") || [])
      expect((event as { to: string }).to <= "2026-08").toBe(true);
  });

  it("金额按真实季度键关联而非数组序号，零值两侧有线且未知季度断开", async () => {
    const periods = quarters().reverse();
    const value = (period: FinancialAnalysisPeriod) =>
      period.key === "2025-Q1"
        ? "0"
        : period.key === "2025-Q3"
          ? null
          : "99999999999999.123456789";
    const wrapper = mountChart({ periods, series: series(periods, value) });
    await prepare(wrapper, 1100);
    const current = wrapper.get('.analysis-line-series[data-series="current"]');
    expect(amount(wrapper, "2025-Q1")).toBe("¥0.00");
    expect(amount(wrapper, "2026-Q1")).toBe("¥99,999,999,999,999.123456789");
    expect(
      current
        .find('[data-from-period="2024-Q4"][data-to-period="2025-Q1"]')
        .exists(),
    ).toBe(true);
    expect(
      current
        .find('[data-from-period="2025-Q1"][data-to-period="2025-Q2"]')
        .exists(),
    ).toBe(true);
    expect(current.find('[data-period="2025-Q3"]').exists()).toBe(false);
    expect(
      current
        .find('[data-from-period="2025-Q2"][data-to-period="2025-Q4"]')
        .exists(),
    ).toBe(false);
    expect(
      wrapper
        .get('.chart-quarter-slot[data-period="2025-Q3"] .unknown-month-marker')
        .text(),
    ).toBe("未知");
  });

  it("两年差同期跨年滑动仍按真实季度匹配，缺失源季度绝不拿邻季金额代替", async () => {
    const periods = quarters();
    const comparisonPeriods = quarters("2018-01", 27, "2024-08").filter(
      (period) => period.key !== "2023-Q1",
    );
    const wrapper = mountChart({
      periods,
      series: series(periods, (period) => period.from.replace("-", "") + ".01"),
      comparisonPeriods,
      comparisonSeries: series(
        comparisonPeriods,
        (period) => period.from.replace("-", "") + ".02",
      ),
      comparisonLabel: "2018年同期",
    });
    const scroll = await prepare(wrapper);
    const comparison = wrapper.get(
      '.analysis-line-series[data-series="comparison"]',
    );
    expect(comparison.find('[data-period="2025-Q1"]').exists()).toBe(false);
    expect(
      comparison
        .get('[data-period="2026-Q3"]')
        .attributes("data-source-period"),
    ).toBe("2024-Q3");
    expect(amount(wrapper, "2026-Q3", true)).toBe("¥202,407.02");
    wheel(scroll, -step(wrapper) * 3);
    jest.advanceTimersByTime(140);
    await settle();
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2023-01 至 2025-12",
    );
    expect(
      comparison
        .get('[data-period="2023-Q1"]')
        .attributes("data-source-period"),
    ).toBe("2021-Q1");
    expect(amount(wrapper, "2023-Q1", true)).toBe("¥202,101.02");
    expectTwelveQuarters(wrapper, scroll);
  });

  it("同季度旧响应若多含未来月份，不展示为当前未完季度金额", async () => {
    const periods = quarters("2020-01", 27, "2026-09");
    const wrapper = mountChart({ periods, series: series(periods) });
    await prepare(wrapper);
    expect(
      wrapper.find('.chart-value-label[data-period="2026-Q3"]').exists(),
    ).toBe(false);
    expect(
      wrapper
        .get('.chart-quarter-slot[data-period="2026-Q3"] .unknown-month-marker')
        .text(),
    ).toBe("未知");
    await wrapper.setProps({ periods: quarters(), series: series(quarters()) });
    await settle();
    expect(amount(wrapper, "2026-Q3")).toBe("¥2,053,235.40");
  });

  it("当前与同期季度点选发送真实季度范围及截止月，不伪装成季度首月", async () => {
    const comparisonPeriods = quarters("2018-01", 27, "2024-08");
    const wrapper = mountChart({
      comparisonPeriods,
      comparisonSeries: series(comparisonPeriods),
      comparisonLabel: "2018年同期",
    });
    await prepare(wrapper);
    await wrapper
      .get('.chart-value-label[data-series="current"][data-period="2026-Q3"]')
      .trigger("click");
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      {
        month: "2026-08",
        comparison: false,
        metricKey: "total",
        periodKey: "2026-Q3",
        from: "2026-07",
        to: "2026-08",
      },
    ]);
    await wrapper
      .get(
        '.analysis-line-series[data-series="comparison"] .analysis-line-point[data-period="2026-Q3"]',
      )
      .trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      {
        month: "2024-08",
        comparison: true,
        metricKey: "total",
        periodKey: "2024-Q3",
        from: "2024-07",
        to: "2024-08",
      },
    ]);
  });

  it("普通数据刷新和对比显示切换不把已浏览季度跳回最新", async () => {
    const comparisonPeriods = quarters("2018-01", 27, "2024-08");
    const wrapper = mountChart({
      comparisonPeriods,
      comparisonSeries: series(comparisonPeriods),
      comparisonLabel: "2018年同期",
    });
    const scroll = await prepare(wrapper);
    wheel(scroll, -step(wrapper) * 2);
    jest.advanceTimersByTime(140);
    await settle();
    const range = wrapper.get(".visible-window-range").text();
    const position = scroll.scrollLeft;
    const events = wrapper.emitted("window-change")?.length;
    await wrapper.setProps({
      windowEnd: "2026-03",
      periods: quarters(),
      series: series(quarters(), () => "110.00001"),
      comparisonVisible: false,
    });
    await settle();
    expect(wrapper.get(".visible-window-range").text()).toBe(range);
    expect(scroll.scrollLeft).toBeCloseTo(position);
    expect(
      wrapper.find('.analysis-line-series[data-series="comparison"]').exists(),
    ).toBe(false);
    await wrapper.setProps({ comparisonVisible: true });
    await settle();
    expect(
      wrapper.findAll('.chart-value-label[data-series="comparison"]'),
    ).toHaveLength(12);
    expect(wrapper.emitted("window-change")).toHaveLength(events!);
    expectTwelveQuarters(wrapper, scroll);
  });

  it("隐藏、尺寸裁剪及全屏恢复都按原季度重定位，不把滚动归零解释为1900年", async () => {
    const wrapper = mountChart({ minMonth: "1900-01" });
    const scroll = await prepare(wrapper, 390);
    wheel(scroll, -step(wrapper) * 3);
    jest.advanceTimersByTime(140);
    await settle();
    const range = wrapper.get(".visible-window-range").text();
    const beforeEvents = wrapper.emitted("window-change")?.length;
    setWidth(scroll, 0);
    scroll.scrollLeft = 0;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    resize?.([], {} as ResizeObserver);
    await settle();
    setWidth(scroll, 1440);
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    await settle();
    expect(wrapper.get(".visible-window-range").text()).toBe(range);
    expect(wrapper.emitted("window-change")).toHaveLength(beforeEvents!);
    expectTwelveQuarters(wrapper, scroll);
    await wrapper.setProps({ minMonth: "2020-01", windowEnd: "2025-12" });
    await settle();
    expect(wrapper.get(".visible-window-range").text()).toBe(range);
    expectTwelveQuarters(wrapper, scroll);
    expect(wrapper.emitted("window-change")).toHaveLength(beforeEvents!);
  });

  it.each([
    { end: "1900-01", count: 1, from: "1900-01" },
    { end: "1901-06", count: 6, from: "1900-01" },
    { end: "2099-12", count: 12, from: "2097-01" },
  ])(
    "$end边界仅展示合法的$count季，不补1899或2100",
    async ({ end, count, from }) => {
      const wrapper = mountChart({
        minMonth: "1900-01",
        maxMonth: end,
        windowEnd: end,
        periods: [],
        series: [{ key: "total", label: "金额合计", values: [] }],
      });
      const scroll = await prepare(wrapper);
      expect(wrapper.findAll(".chart-quarter-slot")).toHaveLength(count);
      expect(wrapper.get(".visible-window-range").text()).toBe(
        from + " 至 " + end,
      );
      expect(wrapper.findAll(".analysis-line-point")).toHaveLength(0);
      expect(wrapper.findAll(".unknown-month-marker")).toHaveLength(count);
      if (count < 12)
        expect(wrapper.get(".fixed-window-controls").text()).toContain(
          "已到可用历史边界",
        );
      if (count === 1)
        expect(
          Number(wrapper.get(".history-month-grid").attributes("x1")),
        ).toBe(scroll.clientWidth / 2);
      for (const slot of wrapper.findAll(".chart-quarter-slot")) {
        expect(slot.attributes("data-from") >= "1900-01").toBe(true);
        expect(slot.attributes("data-to") <= end).toBe(true);
      }
      expect(wrapper.emitted("window-change")).toBeUndefined();
      if (end === "1900-01") {
        const year = {
          key: "1900",
          label: "1900年",
          from: "1900-01",
          to: "1900-01",
        };
        await wrapper.setProps({
          quarterHistory: false,
          periodView: true,
          periods: [year],
          series: series([year], () => "100"),
        });
        await settle();
        expect(wrapper.findAll(".chart-period-slot")).toHaveLength(1);
        expect(wrapper.findAll(".chart-quarter-slot")).toHaveLength(0);
        await wrapper.get(".chart-value-label").trigger("click");
        expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
          {
            month: "1900-01",
            comparison: false,
            metricKey: "total",
            periodKey: "1900",
            from: "1900-01",
            to: "1900-01",
          },
        ]);
      }
    },
  );

  it("季度滚轮待吸附时切到年度或月度会清理旧事件，原月度点选保持旧格式", async () => {
    const wrapper = mountChart();
    const scroll = await prepare(wrapper);
    wheel(scroll, -20);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    const year = {
      key: "2026",
      label: "2026年",
      from: "2026-01",
      to: "2026-08",
    };
    await wrapper.setProps({
      quarterHistory: false,
      periodView: true,
      periods: [year],
      series: series([year]),
    });
    await settle();
    expect(jest.getTimerCount()).toBe(0);
    expect(wrapper.findAll(".chart-period-slot")).toHaveLength(1);
    expect(wrapper.findAll(".chart-quarter-slot")).toHaveLength(0);
    jest.advanceTimersByTime(200);
    expect(wrapper.emitted("window-change")).toBeUndefined();
    await wrapper.get(".chart-value-label").trigger("click");
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      {
        month: "2026-08",
        comparison: false,
        metricKey: "total",
        periodKey: "2026",
        from: "2026-01",
        to: "2026-08",
      },
    ]);
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = financialMonthOffset("2025-09", index);
      return { key: month, label: month, from: month, to: month };
    });
    await wrapper.setProps({
      periodView: false,
      fixedMonthWindow: true,
      continuousHistory: true,
      periods: months,
      series: series(months),
      windowEnd: "2026-08",
    });
    await settle();
    expect(wrapper.findAll(".chart-month-slot")).toHaveLength(12);
    await wrapper
      .get('.chart-value-label[data-month="2026-08"]')
      .trigger("click");
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      { month: "2026-08", comparison: false, metricKey: "total" },
    ]);
  });

  it("季度卸载清理吸附计时器和观察器，不补发查询", async () => {
    const wrapper = mountChart();
    const scroll = await prepare(wrapper);
    wheel(scroll, -20);
    wrapper.unmount();
    mounted.delete(wrapper);
    expect(jest.getTimerCount()).toBe(0);
    expect(disconnect).toHaveBeenCalled();
    expect(wrapper.emitted("window-change")).toBeUndefined();
  });
});
