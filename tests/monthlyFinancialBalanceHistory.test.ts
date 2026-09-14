import { nextTick } from "vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisPeriod,
  FinancialAnalysisSeries,
} from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

function months(from: string, count = 33): FinancialAnalysisPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const month = financialMonthOffset(from, index);
    return { key: month, label: month, from: month, to: month };
  });
}
function series(values: Array<string | null>): FinancialAnalysisSeries {
  return { key: "total", label: "资金余额", values };
}
const base = {
  title: "账户余额资金台帐",
  type: "line" as const,
  fixedMonthWindow: true,
  continuousHistory: true,
  minMonth: "2024-01",
  maxMonth: "2026-09",
  windowEnd: "2026-09",
  periods: months("2024-01"),
};
async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
async function prepare(wrapper: ReturnType<typeof mount>, width = 920) {
  const scroll = wrapper.get(".line-scroll").element as HTMLElement;
  Object.defineProperty(scroll, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(scroll, "scrollWidth", {
    configurable: true,
    get: () =>
      Number(wrapper.get(".line-svg").attributes("viewBox").split(" ")[2]),
  });
  await settle();
  return scroll;
}
function monthWidth(wrapper: ReturnType<typeof mount>): number {
  const slots = wrapper.findAll(".chart-month-slot .history-month-grid");
  return Number(slots[1].attributes("x1")) - Number(slots[0].attributes("x1"));
}
function wheel(element: HTMLElement, delta: number) {
  element.dispatchEvent(
    new WheelEvent("wheel", { deltaY: delta, bubbles: true, cancelable: true }),
  );
}
function pointer(element: HTMLElement, type: string, x: number, id = 8) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: id, clientX: x, clientY: 100, button: 0 });
  element.dispatchEvent(event);
}
function currentRange(wrapper: ReturnType<typeof mount>) {
  return wrapper.get(".visible-window-range").text();
}
function labelAmount(
  wrapper: ReturnType<typeof mount>,
  kind: "current" | "comparison",
  index: string,
) {
  return wrapper
    .get(
      '.chart-value-label[data-series="' +
        kind +
        '"][data-index="' +
        index +
        '"] .amount-label-value',
    )
    .findAll("tspan")
    .map((line) => line.text())
    .join("");
}
function expectStableTwelveMonths(
  wrapper: ReturnType<typeof mount>,
  scroll: HTMLElement,
) {
  const slots = wrapper.findAll(".chart-month-slot");
  expect(slots).toHaveLength(12);
  const range = slots.map((slot) => slot.attributes("data-month"));
  expect(range).toEqual(months(range[0], 12).map((period) => period.from));
  const firstX =
    Number(slots[0].get(".history-month-grid").attributes("x1")) -
    scroll.scrollLeft;
  const lastX =
    Number(slots[11].get(".history-month-grid").attributes("x1")) -
    scroll.scrollLeft;
  expect(firstX).toBeCloseTo(20, 4);
  expect(lastX).toBeCloseTo(scroll.clientWidth - 34, 4);
}

describe("账户余额资金台帐连续历史呈现", () => {
  const originalObserver = globalThis.ResizeObserver;
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: originalObserver,
    });
  });

  it("使用长画布与固定纵轴，稳定窗口恰好展示连续十二个月", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        series: [series(Array.from({ length: 33 }, () => "2053235.4"))],
      },
    });
    const scroll = await prepare(wrapper);
    expect(scroll.classList.contains("is-continuous-history")).toBe(true);
    expect(
      wrapper.get(".history-y-axis").element.closest(".line-scroll"),
    ).toBeNull();
    expect(
      Number(wrapper.get(".line-svg").attributes("viewBox").split(" ")[2]),
    ).toBeGreaterThan(scroll.clientWidth);
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    expect(currentRange(wrapper)).toBe("2025-10 至 2026-09");
    expectStableTwelveMonths(wrapper, scroll);
    wrapper.unmount();
  });

  it("小于月份宽度的滚轮也立即像素移动，停轮满一百四十毫秒才吸附", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        series: [series(Array.from({ length: 33 }, () => "1000"))],
      },
    });
    const scroll = await prepare(wrapper);
    const initial = scroll.scrollLeft;
    const step = monthWidth(wrapper);
    expect(step).toBeGreaterThan(40);
    wheel(scroll, -20);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - 20, 4);
    expect(wrapper.emitted("window-change")).toBeUndefined();
    jest.advanceTimersByTime(139);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - 20, 4);
    jest.advanceTimersByTime(1);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial, 4);
    wheel(scroll, -step * 1.4);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - step * 1.4, 4);
    jest.advanceTimersByTime(140);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - step, 4);
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2025-09", to: "2026-08" },
    ]);
    expectStableTwelveMonths(wrapper, scroll);
    wrapper.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("鼠标小幅拖动立即改变像素位置，松手后吸附整月且纵轴不进入滚动容器", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        series: [series(Array.from({ length: 33 }, () => "1000"))],
      },
    });
    const scroll = await prepare(wrapper);
    const initial = scroll.scrollLeft;
    const fixedAxis = wrapper.get(".history-y-axis").element;
    pointer(scroll, "pointerdown", 400);
    pointer(scroll, "pointermove", 420);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial - 20, 4);
    expect(wrapper.emitted("window-change")).toBeUndefined();
    expect(scroll.classList.contains("is-window-dragging")).toBe(true);
    pointer(scroll, "pointerup", 420);
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(initial, 4);
    expect(scroll.classList.contains("is-window-dragging")).toBe(false);
    expect(wrapper.get(".history-y-axis").element).toBe(fixedAxis);
    expectStableTwelveMonths(wrapper, scroll);
    wrapper.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("用户浏览历史后普通数据更新不归零、不跳回最新窗口", async () => {
    const values = Array.from({ length: 33 }, () => "1000");
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: { ...base, series: [series(values)] },
    });
    const scroll = await prepare(wrapper);
    wheel(scroll, -monthWidth(wrapper) * 2);
    jest.advanceTimersByTime(140);
    await settle();
    const historicalPosition = scroll.scrollLeft;
    const historicalRange = currentRange(wrapper);
    expect(historicalRange).toBe("2025-08 至 2026-07");
    await wrapper.setProps({
      windowEnd: "2026-07",
      periods: months("2024-01"),
      series: [series(values.map(() => "1100"))],
    });
    await settle();
    expect(scroll.scrollLeft).toBeCloseTo(historicalPosition, 4);
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    expect(currentRange(wrapper)).toBe(historicalRange);
    expectStableTwelveMonths(wrapper, scroll);
    wrapper.unmount();
  });

  it("两期同值仍有两套点旁单行浅底金额，完整精度不改成图下日期卡片", async () => {
    const exact = "999999999999999999.123456789012";
    const values = Array.from({ length: 33 }, () => exact);
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        series: [series(values)],
        comparisonSeries: [series(values)],
        comparisonPeriods: months("2023-01"),
        comparisonLabel: "2025年同期",
      },
    });
    const scroll = await prepare(wrapper, 1100);
    expect(wrapper.findAll(".chart-value-label")).toHaveLength(24);
    expect(wrapper.find(".amount-label-caption").exists()).toBe(false);
    const chartBottom = Math.max(
      ...wrapper
        .findAll(".chart-grid")
        .map((grid) => Number(grid.attributes("y1"))),
    );
    const rectangles = wrapper
      .findAll(".amount-label-background")
      .map((rect) => ({
        x: Number(rect.attributes("x")),
        y: Number(rect.attributes("y")),
        width: Number(rect.attributes("width")),
        height: Number(rect.attributes("height")),
      }));
    for (const label of wrapper.findAll(".amount-label-value")) {
      expect(label.findAll("tspan")).toHaveLength(1);
      expect(label.text()).toBe("¥999,999,999,999,999,999.123456789012");
    }
    for (let index = 0; index < rectangles.length; index += 1) {
      const rect = rectangles[index];
      expect(rect.height).toBe(20);
      expect(rect.y + rect.height).toBeLessThanOrEqual(chartBottom);
      expect(rect.x).toBeGreaterThanOrEqual(scroll.scrollLeft);
      expect(rect.x + rect.width).toBeLessThanOrEqual(
        scroll.scrollLeft + scroll.clientWidth,
      );
      for (let other = index + 1; other < rectangles.length; other += 1) {
        const next = rectangles[other];
        const overlap =
          rect.x < next.x + next.width &&
          rect.x + rect.width > next.x &&
          rect.y < next.y + next.height &&
          rect.y + rect.height > next.y;
        expect({ index, other, overlap }).toEqual({
          index,
          other,
          overlap: false,
        });
      }
    }
    wrapper.unmount();
  });

  it("真实零值保留两侧线段及零金额标签，未知月份不画点、不跨越连线", async () => {
    const timeline = months("2024-01");
    const values = timeline.map((period) =>
      period.from === "2026-02"
        ? "0"
        : period.from === "2026-04"
          ? null
          : "2053235.4",
    );
    const previous = months("2023-01");
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        series: [series(values)],
        comparisonPeriods: previous,
        comparisonSeries: [
          series(
            previous.map((period) => (period.from === "2025-02" ? "0" : "100")),
          ),
        ],
      },
    });
    await prepare(wrapper);
    const current = wrapper.get('.analysis-line-series[data-series="current"]');
    const zero = current.get('.analysis-line-point[data-month="2026-02"]');
    expect(labelAmount(wrapper, "current", zero.attributes("data-index"))).toBe(
      "¥0.00",
    );
    expect(
      current
        .find('[data-from-month="2026-01"][data-to-month="2026-02"]')
        .exists(),
    ).toBe(true);
    expect(
      current
        .find('[data-from-month="2026-02"][data-to-month="2026-03"]')
        .exists(),
    ).toBe(true);
    expect(
      current.find('.analysis-line-point[data-month="2026-04"]').exists(),
    ).toBe(false);
    expect(
      current
        .find('[data-from-month="2026-03"][data-to-month="2026-05"]')
        .exists(),
    ).toBe(false);
    const comparisonPoint = wrapper.get(
      '.analysis-line-series[data-series="comparison"] .analysis-line-point[data-month="2026-02"]',
    );
    expect(comparisonPoint.attributes("data-source-month")).toBe("2025-02");
    expect(
      labelAmount(
        wrapper,
        "comparison",
        comparisonPoint.attributes("data-index"),
      ),
    ).toBe("¥0.00");
    expect(comparisonPoint.attributes("data-point-x")).toBe(
      zero.attributes("data-point-x"),
    );
    wrapper.unmount();
  });

  it("窗口跨过年界后，同期金额仍按具体年份月份对齐", async () => {
    const timeline = months("2024-01");
    const previous = months("2023-01");
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        windowEnd: "2026-01",
        series: [
          series(
            timeline.map((period) => period.from.replace("-", "") + ".01"),
          ),
        ],
        comparisonPeriods: previous,
        comparisonSeries: [
          series(
            previous.map((period) => period.from.replace("-", "") + ".02"),
          ),
        ],
      },
    });
    const scroll = await prepare(wrapper);
    wheel(scroll, -monthWidth(wrapper) * 2);
    jest.advanceTimersByTime(140);
    await settle();
    expect(currentRange(wrapper)).toBe("2024-12 至 2025-11");
    const point = wrapper.get(
      '.analysis-line-series[data-series="current"] .analysis-line-point[data-month="2025-11"]',
    );
    const comparisonPoint = wrapper.get(
      '.analysis-line-series[data-series="comparison"] .analysis-line-point[data-month="2025-11"]',
    );
    expect(comparisonPoint.attributes("data-source-month")).toBe("2024-11");
    expect(
      labelAmount(wrapper, "current", point.attributes("data-index")),
    ).toBe("¥202,511.01");
    expect(
      labelAmount(
        wrapper,
        "comparison",
        comparisonPoint.attributes("data-index"),
      ),
    ).toBe("¥202,411.02");
    expectStableTwelveMonths(wrapper, scroll);
    wrapper.unmount();
  });

  it("隐藏模块滚动位置被归零时不提交换窗，重新显示后恢复原月份", async () => {
    let resize: ResizeObserverCallback | null = null;
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
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        series: [series(Array.from({ length: 33 }, () => "1000"))],
      },
    });
    const scroll = await prepare(wrapper);
    wheel(scroll, -monthWidth(wrapper) * 2);
    jest.advanceTimersByTime(140);
    await settle();
    const beforeRange = currentRange(wrapper);
    const beforePosition = scroll.scrollLeft;
    const beforeEvents = wrapper.emitted("window-change")!.length;
    Object.defineProperty(scroll, "clientWidth", {
      configurable: true,
      value: 0,
    });
    scroll.scrollLeft = 0;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(resize).not.toBeNull();
    (resize as unknown as ResizeObserverCallback)([], {} as ResizeObserver);
    jest.advanceTimersByTime(200);
    await settle();
    expect(currentRange(wrapper)).toBe(beforeRange);
    expect(wrapper.emitted("window-change")).toHaveLength(beforeEvents);
    Object.defineProperty(scroll, "clientWidth", {
      configurable: true,
      value: 920,
    });
    (resize as unknown as ResizeObserverCallback)([], {} as ResizeObserver);
    await settle();
    expect(currentRange(wrapper)).toBe(beforeRange);
    expect(scroll.scrollLeft).toBeCloseTo(beforePosition, 4);
    expect(wrapper.emitted("window-change")).toHaveLength(beforeEvents);
    expectStableTwelveMonths(wrapper, scroll);
    wrapper.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("最早历史月份变化时保留已浏览窗口，仅同步长画布像素原点", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        minMonth: "2023-01",
        series: [series(Array.from({ length: 33 }, () => "1000"))],
      },
    });
    const scroll = await prepare(wrapper);
    const step = monthWidth(wrapper);
    wheel(scroll, -step * 3);
    jest.advanceTimersByTime(140);
    await settle();
    expect(currentRange(wrapper)).toBe("2025-07 至 2026-06");
    await wrapper.setProps({ windowEnd: "2026-06" });
    await settle();
    const beforePosition = scroll.scrollLeft;
    const beforeEvents = wrapper.emitted("window-change")!.length;
    await wrapper.setProps({ minMonth: "2024-01" });
    await settle();
    expect(currentRange(wrapper)).toBe("2025-07 至 2026-06");
    expect(scroll.scrollLeft).toBeCloseTo(beforePosition - step * 12, 4);
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    expect(wrapper.emitted("window-change")).toHaveLength(beforeEvents);
    expectStableTwelveMonths(wrapper, scroll);
    wrapper.unmount();
  });

  it("窄屏恢复宽屏时滚动事件早于测宽回调，仍保留历史月份并按新月宽重定位", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        series: [series(Array.from({ length: 33 }, () => "1000"))],
      },
    });
    const scroll = await prepare(wrapper, 390);
    const oldMonthWidth = monthWidth(wrapper);
    wheel(scroll, -oldMonthWidth * 3);
    jest.advanceTimersByTime(140);
    await settle();
    const beforeRange = currentRange(wrapper);
    const beforePosition = scroll.scrollLeft;
    const beforeEvents = wrapper.emitted("window-change")!.length;
    expect(beforeRange).toBe("2025-07 至 2026-06");
    Object.defineProperty(scroll, "clientWidth", {
      configurable: true,
      value: 1440,
    });
    // 不调用尺寸观察器，模拟浏览器先裁剪旧滚动位置并派发滚动事件。
    scroll.scrollLeft = 0;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    await settle();
    expect(currentRange(wrapper)).toBe(beforeRange);
    expect(wrapper.emitted("window-change")).toHaveLength(beforeEvents);
    const newMonthWidth = monthWidth(wrapper);
    expect(newMonthWidth).toBeGreaterThan(oldMonthWidth);
    expect(scroll.scrollLeft).toBeCloseTo(
      (beforePosition / oldMonthWidth) * newMonthWidth,
      4,
    );
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    expectStableTwelveMonths(wrapper, scroll);
    wrapper.unmount();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("重新测量宽度保持正在查看的月份，并在卸载时清理观察器", async () => {
    let resize: ResizeObserverCallback | null = null;
    const disconnect = jest.fn();
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
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        ...base,
        series: [series(Array.from({ length: 33 }, () => "1000"))],
      },
    });
    const scroll = await prepare(wrapper);
    wheel(scroll, -monthWidth(wrapper) * 3);
    jest.advanceTimersByTime(140);
    await settle();
    const before = currentRange(wrapper);
    Object.defineProperty(scroll, "clientWidth", {
      configurable: true,
      value: 700,
    });
    expect(resize).not.toBeNull();
    (resize as unknown as ResizeObserverCallback)([], {} as ResizeObserver);
    await settle();
    expect(currentRange(wrapper)).toBe(before);
    expect(scroll.scrollLeft).toBeGreaterThan(0);
    expectStableTwelveMonths(wrapper, scroll);
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
