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
const wrappers = new Set<Wrapper>();
const originalObserver = globalThis.ResizeObserver;
let resize: ResizeObserverCallback | undefined;
const preciseAmount = "123456789012345678.000000000001";
const preciseDisplay = "¥123,456,789,012,345,678.000000000001";

function months(from: string, count: number): FinancialAnalysisPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const month = financialMonthOffset(from, index);
    return { key: month, label: month, from: month, to: month };
  });
}
function quarters(from: string, maximum: string): FinancialAnalysisPeriod[] {
  return Array.from({ length: 27 }, (_, index) => {
    const month = financialMonthOffset(from, index * 3);
    const quarter = Math.ceil(Number(month.slice(5)) / 3);
    return {
      key: month.slice(0, 4) + "-Q" + quarter,
      label: month.slice(0, 4) + "年第" + quarter + "季度",
      ...financialQuarterRange(month, maximum),
    };
  });
}
function series(
  periods: FinancialAnalysisPeriod[],
  amount: (period: FinancialAnalysisPeriod) => string | null = () => "10.25",
): FinancialAnalysisSeries[] {
  return [{ key: "total", label: "金额合计", values: periods.map(amount) }];
}
function mountChart(extra: Record<string, unknown> = {}): Wrapper {
  const periods = months("2023-12", 34);
  const comparisonPeriods = months("2022-12", 34);
  const wrapper = mount(MonthlyFinancialAnalysisChart, {
    props: {
      type: "line",
      title: "可见同期文案",
      fixedMonthWindow: true,
      continuousHistory: true,
      minMonth: "2020-01",
      maxMonth: "2026-09",
      windowEnd: "2026-09",
      periods,
      series: series(periods),
      comparisonPeriods,
      comparisonSeries: series(comparisonPeriods, () => preciseAmount),
      comparisonLabel: "2022年同期（2022-12至2025-09）",
      ...extra,
    },
  });
  wrappers.add(wrapper);
  return wrapper;
}
async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
async function prepare(wrapper: Wrapper) {
  const scroll = wrapper.get(".line-scroll").element as HTMLElement;
  Object.defineProperty(scroll, "clientWidth", {
    configurable: true,
    value: 960,
  });
  Object.defineProperty(scroll, "scrollWidth", {
    configurable: true,
    get: () =>
      Number(wrapper.get(".line-svg").attributes("viewBox").split(" ")[2]),
  });
  await settle();
  resize?.([], {} as ResizeObserver);
  await settle();
  return scroll;
}
function legend(wrapper: Wrapper) {
  return wrapper.get(".line-legend").text();
}
function comparison(wrapper: Wrapper) {
  return wrapper.get('.analysis-line-series[data-series="comparison"]');
}
function amount(wrapper: Wrapper, period: string) {
  return wrapper
    .get(
      '.chart-value-label[data-series="comparison"][data-period="' +
        period +
        '"] .amount-label-value',
    )
    .findAll("tspan")
    .map((part) => part.text())
    .join("");
}

describe("历史图例仅描述可见同期，不改变数据映射", () => {
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
    for (const wrapper of wrappers) wrapper.unmount();
    wrappers.clear();
    await settle();
    jest.useRealTimers();
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: originalObserver,
    });
  });

  it("多年完整缓冲只显示可见十二个月对应的同期范围", async () => {
    const wrapper = mountChart();
    await prepare(wrapper);
    expect(wrapper.findAll(".chart-month-slot")).toHaveLength(12);
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2025-10 至 2026-09",
    );
    expect(legend(wrapper)).toContain("同期（2024-10至2025-09）");
    expect(legend(wrapper)).not.toContain("2022年同期");
    expect(wrapper.props("comparisonLabel")).toBe(
      "2022年同期（2022-12至2025-09）",
    );
  });

  it("真实滚轮移动整月后图例跟随可见范围，不显示缓冲起年", async () => {
    const wrapper = mountChart();
    const scroll = await prepare(wrapper);
    const grids = wrapper.findAll(".chart-month-slot .history-month-grid");
    const step =
      Number(grids[1].attributes("x1")) - Number(grids[0].attributes("x1"));
    scroll.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -step * 2,
        bubbles: true,
        cancelable: true,
      }),
    );
    jest.advanceTimersByTime(140);
    await settle();
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2025-08 至 2026-07",
    );
    expect(legend(wrapper)).toContain("同期（2024-08至2025-07）");
    expect(wrapper.emitted("window-change")?.at(-1)).toEqual([
      { from: "2025-08", to: "2026-07" },
    ]);
  });

  it("仅向前扩充缓冲并改变原始标签时，可见标签及月份仍保持", async () => {
    const wrapper = mountChart();
    await prepare(wrapper);
    const previous = legend(wrapper);
    const periods = months("2021-12", 58);
    const comparisonPeriods = months("2020-12", 58);
    await wrapper.setProps({
      periods,
      series: series(periods),
      comparisonPeriods,
      comparisonSeries: series(comparisonPeriods, () => preciseAmount),
      comparisonLabel: "2020年同期（2020-12至2025-09）",
    });
    await settle();
    expect(legend(wrapper)).toBe(previous);
    expect(wrapper.get(".visible-window-range").text()).toBe(
      "2025-10 至 2026-09",
    );
    expect(
      comparison(wrapper)
        .get('[data-month="2026-09"]')
        .attributes("data-source-month"),
    ).toBe("2025-09");
    expect(wrapper.emitted("window-change")).toBeUndefined();
  });

  it("点的无障碍描述改用可见同期，但精确金额和真实点选月份不变", async () => {
    const wrapper = mountChart();
    await prepare(wrapper);
    const point = comparison(wrapper).get('[data-month="2026-09"]');
    expect(point.attributes("aria-label")).toContain("2025-09");
    expect(point.attributes("aria-label")).toContain(
      "同期（2024-10至2025-09）",
    );
    expect(point.attributes("aria-label")).not.toContain("2022年同期");
    await point.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      { month: "2025-09", comparison: true, metricKey: "total" },
    ]);
    expect(wrapper.get(".chart-inspector").text()).toContain(preciseDisplay);
    await wrapper
      .get(
        '.analysis-line-series[data-series="current"] [data-month="2026-09"]',
      )
      .trigger("click");
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      { month: "2026-09", comparison: false, metricKey: "total" },
    ]);
    expect(wrapper.get(".chart-inspector").text()).toContain("¥10.25");
  });

  it("五年季度同比仍按真实期键匹配，缺期和未知不挪用，零值保留", async () => {
    const periods = quarters("2020-01", "2026-08");
    const comparisonPeriods = quarters("2015-01", "2021-08").filter(
      (period) => period.key !== "2020-Q1",
    );
    const wrapper = mountChart({
      fixedMonthWindow: false,
      continuousHistory: false,
      quarterHistory: true,
      windowEnd: "2026-08",
      maxMonth: "2026-08",
      periods,
      series: series(periods),
      comparisonPeriods,
      comparisonSeries: series(comparisonPeriods, (period) =>
        period.key === "2020-Q2"
          ? "0"
          : period.key === "2020-Q3"
            ? null
            : preciseAmount,
      ),
      comparisonLabel: "2015年同期（2015-01至2021-08）",
    });
    await prepare(wrapper);
    expect(wrapper.findAll(".chart-quarter-slot")).toHaveLength(12);
    expect(legend(wrapper)).toContain("同期（2018-10至2021-08）");
    const points = comparison(wrapper);
    expect(points.find('[data-period="2025-Q1"]').exists()).toBe(false);
    expect(points.find('[data-period="2025-Q3"]').exists()).toBe(false);
    expect(amount(wrapper, "2025-Q2")).toBe("¥0.00");
    expect(amount(wrapper, "2026-Q3")).toBe(preciseDisplay);
    const selected = points.get('[data-period="2026-Q3"]');
    expect(selected.attributes("data-source-period")).toBe("2021-Q3");
    expect(selected.attributes("aria-label")).toContain(
      "同期（2018-10至2021-08）",
    );
    await selected.trigger("click");
    expect(wrapper.emitted("point-select")?.at(-1)).toEqual([
      {
        month: "2021-08",
        comparison: true,
        metricKey: "total",
        periodKey: "2021-Q3",
        from: "2021-07",
        to: "2021-08",
      },
    ]);
  });

  it("可见季度首尾缺失时明确未知，不借内部已知期伪造完整范围", async () => {
    const periods = quarters("2020-01", "2026-08");
    const complete = quarters("2015-01", "2021-08");
    const comparisonPeriods = complete.filter(
      (period) => period.key !== "2018-Q4",
    );
    const wrapper = mountChart({
      fixedMonthWindow: false,
      continuousHistory: false,
      quarterHistory: true,
      windowEnd: "2026-08",
      maxMonth: "2026-08",
      periods,
      series: series(periods),
      comparisonPeriods,
      comparisonSeries: series(comparisonPeriods),
      comparisonLabel: "2015年同期（2015-01至2021-08）",
    });
    await prepare(wrapper);
    expect(legend(wrapper)).toContain("同期（可见范围月份未知）");
    const missingEnd = complete.filter((period) => period.key !== "2021-Q3");
    await wrapper.setProps({
      comparisonPeriods: missingEnd,
      comparisonSeries: series(missingEnd),
    });
    await settle();
    expect(legend(wrapper)).toContain("同期（可见范围月份未知）");
    expect(comparison(wrapper).find('[data-period="2026-Q3"]').exists()).toBe(
      false,
    );
  });

  it("非历史年度图保留原始对比说明", async () => {
    const periods = [
      { key: "2026", label: "2026年", from: "2026-01", to: "2026-09" },
    ];
    const comparisonPeriods = [
      { key: "2025", label: "2025年", from: "2025-01", to: "2025-09" },
    ];
    const raw = "2025年同期（2025-01至2025-09）";
    const wrapper = mountChart({
      fixedMonthWindow: false,
      continuousHistory: false,
      periodView: true,
      periods,
      series: series(periods),
      comparisonPeriods,
      comparisonSeries: series(comparisonPeriods),
      comparisonLabel: raw,
    });
    await prepare(wrapper);
    expect(legend(wrapper)).toContain(raw);
    expect(
      comparison(wrapper).get('[data-period="2026"]').attributes("aria-label"),
    ).toContain(raw);
  });
});
