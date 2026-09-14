const mockGetAnalysis = jest.fn();
const mockGetWindowAnalysis = jest.fn();
jest.mock("@/utils/monthlyFinancialAnalysisApi", () => ({
  getMonthlyFinancialAnalysis: (...args: unknown[]) => mockGetAnalysis(...args),
  getMonthlyFinancialAnalysisWindow: (...args: unknown[]) =>
    mockGetWindowAnalysis(...args),
  downloadMonthlyFinancialAnalysis: jest.fn(),
}));
jest.mock(
  "@/components/monthly-financial/MonthlyFinancialDateRange.vue",
  () => ({
    __esModule: true,
    default: {
      props: ["modelValue", "popperAppendTo"],
      methods: { close: jest.fn() },
      template: "<div>日期范围</div>",
    },
  }),
);

import { nextTick } from "vue";
import MonthlyFinancialAnalysisPanel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisModule,
  FinancialAnalysisModuleKey,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
const moduleCases: Array<{ key: FinancialAnalysisModuleKey; label: string }> = [
  { key: "balances", label: "账户余额资金台帐" },
  { key: "inflow", label: "一般账户入账统计" },
  { key: "outflow", label: "一般账户出账统计" },
  { key: "projects", label: "项目分析" },
  { key: "settlement", label: "收支结余" },
  { key: "business", label: "商务统计" },
  { key: "personnel", label: "人力成本分析" },
];
function periods(query: FinancialAnalysisQuery) {
  const list: FinancialAnalysisPeriod[] = [];
  let month = query.from;
  while (month <= query.to) {
    list.push({ key: month, label: month, from: month, to: month });
    if (month === query.to) break;
    month = financialMonthOffset(month, 1);
  }
  return list;
}
function amountFor(month: string, historical: boolean): string | null {
  if (month.endsWith("-02")) return "0";
  if (month.endsWith("-04")) return null;
  return historical ? "1024.56789" : "2053235.4";
}
function response(
  query: FinancialAnalysisQuery,
  historical = false,
): MonthlyFinancialAnalysisData {
  const monthRows = periods(query);
  const values = monthRows.map((period) => amountFor(period.from, historical));
  const modules: FinancialAnalysisModule[] = moduleCases.map(
    ({ key, label }) => ({
      key,
      title: label,
      description: "七模块连续历史测试合成数据",
      sourceLabel: "合成数据",
      updatedAt: "2026-09-03T00:00:00Z",
      periods: monthRows,
      series:
        key === "balances"
          ? [
              { key: "general", label: "一般账户", values },
              {
                key: "business",
                label: "商务账户",
                values: values.map(() => "0"),
              },
              {
                key: "welfare_one",
                label: "福利金账户一",
                values: values.map(() => "0"),
              },
              {
                key: "welfare_two",
                label: "福利金账户二",
                values: values.map(() => "0"),
              },
              { key: "total", label: "四账户合计", values },
            ]
          : [{ key: "total", label: "金额合计", values }],
      summaries: [
        { key: "total", label: "合计", amount: values.at(-1) ?? null },
      ],
      breakdown: [],
      comparison: [],
      columns: [],
      details: [],
      warnings: [],
      appliedFilters: ["时间"],
    }),
  );
  const data: MonthlyFinancialAnalysisData = {
    query: { ...query },
    generatedAt: "2026-09-03T00:00:00Z",
    dataVersion: "连续历史合成版本",
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    modules,
    warnings: [],
  };
  if (query.comparisonYear !== undefined) {
    const offset = (query.comparisonYear - Number(query.from.slice(0, 4))) * 12;
    const previous: FinancialAnalysisQuery = {
      ...query,
      from: financialMonthOffset(query.from, offset),
      to: financialMonthOffset(query.to, offset),
    };
    delete previous.comparisonYear;
    data.comparison = {
      label: query.comparisonYear + "年同期",
      query: previous,
      modules: response(previous, true).modules,
      warnings: [],
    };
  }
  return data;
}
async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
function wheel(element: HTMLElement, deltaY: number) {
  element.dispatchEvent(
    new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
  );
}
function pointer(element: HTMLElement, type: string, x: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 8, clientX: x, clientY: 80, button: 0 });
  element.dispatchEvent(event);
}

describe("七模块全部复用连续历史呈现", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetAnalysis.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(response(query)),
    );
    mockGetWindowAnalysis.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(response(query)),
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(moduleCases)(
    "$label具有紧凑点旁金额、像素滑动及十二月吸附，切换后的隐藏滚动不换窗",
    async ({ key, label }) => {
      const wrapper = mount(MonthlyFinancialAnalysisPanel, {
        props: {
          selectedMonth: "2026-09",
          comparisonYears: [2024, 2025, 2026],
        },
      });
      try {
        await settle();
        await wrapper.get("#analysis-tab-" + key).trigger("click");
        await settle();
        expect(wrapper.get("#analysis-tab-" + key).text()).toBe(label);
        const module = wrapper.get('[data-module="' + key + '"]');
        const chart = module
          .findAllComponents(MonthlyFinancialAnalysisChart)
          .find((child) => child.props("type") === "line")!;
        expect(chart.props("continuousHistory")).toBe(true);
        expect(chart.props("fixedMonthWindow")).toBe(true);
        const scroll = chart.get(".line-scroll").element as HTMLElement;
        Object.defineProperty(scroll, "clientWidth", {
          configurable: true,
          value: 920,
        });
        scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
        await settle();
        expect(scroll.classList.contains("is-continuous-history")).toBe(true);
        expect(
          chart.get(".history-y-axis").element.closest(".line-scroll"),
        ).toBeNull();
        expect(chart.findAll(".chart-month-slot")).toHaveLength(12);
        expect(chart.findAll(".amount-label-caption")).toHaveLength(0);
        expect(chart.findAll(".chart-value-label")).toHaveLength(
          chart.findAll(".analysis-line-point").length,
        );
        expect(
          chart
            .findAll(".amount-label-value")
            .every((value) => value.findAll("tspan").length === 1),
        ).toBe(true);
        const zeroY = Number(chart.get(".chart-grid.is-zero").attributes("y1"));
        for (const background of chart.findAll(".amount-label-background")) {
          expect(Number(background.attributes("height"))).toBe(20);
          expect(
            Number(background.attributes("y")) +
              Number(background.attributes("height")),
          ).toBeLessThanOrEqual(zeroY);
        }
        const current = chart.get(
          '.analysis-line-series[data-series="current"]',
        );
        const zero = current.get('.analysis-line-point[data-month="2026-02"]');
        expect(
          chart
            .get(
              '.chart-value-label[data-series="current"][data-index="' +
                zero.attributes("data-index") +
                '"] .amount-label-value',
            )
            .text(),
        ).toBe("¥0.00");
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
        const priorZero = chart.get(
          '.analysis-line-series[data-series="comparison"] .analysis-line-point[data-month="2026-02"]',
        );
        expect(priorZero.attributes("data-source-month")).toBe("2025-02");
        expect(priorZero.attributes("data-point-x")).toBe(
          zero.attributes("data-point-x"),
        );

        const beforeRange = chart.get(".visible-window-range").text();
        const beforePosition = scroll.scrollLeft;
        const beforeQuery = wrapper.get(".displayed-query").text();
        const callsBefore = mockGetWindowAnalysis.mock.calls.length;
        const slots = chart.findAll(".history-month-grid");
        const step =
          Number(slots[1].attributes("x1")) - Number(slots[0].attributes("x1"));
        pointer(scroll, "pointerdown", 400);
        pointer(scroll, "pointermove", 420);
        await settle();
        expect(scroll.scrollLeft).toBeCloseTo(beforePosition - 20, 4);
        pointer(scroll, "pointerup", 420);
        await settle();
        expect(scroll.scrollLeft).toBeCloseTo(beforePosition, 4);
        wheel(scroll, -20);
        await settle();
        expect(scroll.scrollLeft).toBeCloseTo(beforePosition - 20, 4);
        jest.advanceTimersByTime(139);
        await settle();
        expect(scroll.scrollLeft).toBeCloseTo(beforePosition - 20, 4);
        jest.advanceTimersByTime(1);
        await settle();
        expect(scroll.scrollLeft).toBeCloseTo(beforePosition, 4);
        expect(chart.get(".visible-window-range").text()).toBe(beforeRange);
        expect(mockGetWindowAnalysis).toHaveBeenCalledTimes(callsBefore);

        wheel(scroll, -step * 1.2);
        await settle();
        expect(scroll.scrollLeft).toBeCloseTo(beforePosition - step * 1.2, 4);
        jest.advanceTimersByTime(140);
        await settle();
        expect(scroll.scrollLeft).toBeCloseTo(beforePosition - step, 4);
        jest.advanceTimersByTime(40);
        await settle();
        expect(chart.get(".visible-window-range").text()).toBe(
          "2025-09 至 2026-08",
        );
        expect(chart.findAll(".chart-month-slot")).toHaveLength(12);
        expect(mockGetWindowAnalysis).toHaveBeenCalledTimes(callsBefore + 1);
        expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
        expect(wrapper.get(".displayed-query").text()).toBe(beforeQuery);

        const next =
          moduleCases[
            (moduleCases.findIndex((item) => item.key === key) + 1) %
              moduleCases.length
          ].key;
        Object.defineProperty(scroll, "clientWidth", {
          configurable: true,
          value: 0,
        });
        await wrapper.get("#analysis-tab-" + next).trigger("click");
        scroll.scrollLeft = 0;
        scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
        jest.advanceTimersByTime(220);
        await settle();
        expect(chart.get(".visible-window-range").text()).toBe(
          "2025-09 至 2026-08",
        );
        expect(
          wrapper
            .get('[data-module="' + next + '"] .visible-window-range')
            .text(),
        ).toBe("2025-09 至 2026-08");
        expect(mockGetWindowAnalysis).toHaveBeenCalledTimes(callsBefore + 1);
        expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
        expect(wrapper.get(".displayed-query").text()).toBe(beforeQuery);
      } finally {
        wrapper.unmount();
      }
      expect(jest.getTimerCount()).toBe(0);
    },
  );
});
