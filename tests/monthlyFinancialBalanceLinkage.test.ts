const mockGetBalanceAnalysis = jest.fn();
const mockGetBalanceWindow = jest.fn();
const mockDownloadBalance = jest.fn();

jest.mock("@/utils/monthlyFinancialAnalysisApi", () => ({
  getMonthlyFinancialAnalysis: (...args: unknown[]) =>
    mockGetBalanceAnalysis(...args),
  getMonthlyFinancialAnalysisWindow: (...args: unknown[]) =>
    mockGetBalanceWindow(...args),
  downloadMonthlyFinancialAnalysis: (...args: unknown[]) =>
    mockDownloadBalance(...args),
}));
jest.mock(
  "@/components/monthly-financial/MonthlyFinancialDateRange.vue",
  () => ({
    __esModule: true,
    default: {
      props: ["modelValue"],
      emits: ["update:modelValue"],
      template: "<div />",
    },
  }),
);

import { nextTick } from "vue";
import Panel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import Chart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import DateRange from "@/components/monthly-financial/MonthlyFinancialDateRange.vue";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import { addFinancialAmountTexts } from "@/utils/monthlyFinancialReportPresentation";
import type {
  FinancialAnalysisModule,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
const accountNames = {
  general: "一般账户",
  business: "商务账户",
  welfare_one: "福利金账户一",
  welfare_two: "福利金账户二",
};
const precise = "999999999999999999.123456789012";
function valuesFor(month: string): Array<string | null> {
  if (month.endsWith("-01")) return [precise, "0", "0", "0"];
  if (month.endsWith("-02")) return ["0", "0", "0", "0"];
  if (month.endsWith("-03")) return ["0", "100", "100", "100"];
  if (month.endsWith("-04")) return [null, null, null, null];
  if (month.endsWith("-08")) return ["0.1", "0.2", "1", "2"];
  return ["1000", "600", "300", "100"];
}
function total(values: Array<string | null>) {
  return values.some((value) => value === null)
    ? null
    : values.reduce<string>(
        (sum, value) => addFinancialAmountTexts(sum, value!),
        "0",
      );
}
function balances(query: FinancialAnalysisQuery): FinancialAnalysisModule {
  const periods = [];
  for (
    let month = query.from;
    month <= query.to;
    month = financialMonthOffset(month, 1)
  )
    periods.push({ key: month, label: month, from: month, to: month });
  const keys = Object.keys(accountNames);
  const items = keys.map((key, index) => ({
    key,
    label: accountNames[key as keyof typeof accountNames],
    amount: valuesFor(query.to)[index],
  }));
  return {
    key: "balances",
    title: "账户余额资金台帐",
    description: "合成余额",
    sourceLabel: "合成来源",
    updatedAt: null,
    periods,
    series: [
      ...keys.map((key, index) => ({
        key,
        label: items[index].label,
        values: periods.map((period) => valuesFor(period.from)[index]),
      })),
      {
        key: "total",
        label: "四账户合计",
        values: periods.map((period) => total(valuesFor(period.from))),
      },
    ],
    summaries: [
      { key: "total", label: "合计", amount: total(valuesFor(query.to)) },
    ],
    breakdown: items,
    comparison: [],
    warnings: [],
    appliedFilters: [],
    columns: [],
    details: periods.flatMap((period) =>
      keys.map((key, index) => ({
        id: period.from + ":" + key,
        month: period.from,
        account: items[index].label,
        closing: valuesFor(period.from)[index],
      })),
    ),
  };
}
function dataset(query: FinancialAnalysisQuery): MonthlyFinancialAnalysisData {
  const previousQuery = query.comparisonYear
    ? {
        from: String(query.comparisonYear) + query.from.slice(4),
        to:
          String(
            query.comparisonYear +
              Number(query.to.slice(0, 4)) -
              Number(query.from.slice(0, 4)),
          ) + query.to.slice(4),
        granularity: query.granularity,
      }
    : null;
  return {
    query,
    dataVersion: "固定合成版本",
    generatedAt: "2026-09-03T00:00:00Z",
    modules: [balances(query)],
    warnings: [],
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    ...(previousQuery
      ? {
          comparison: {
            query: previousQuery,
            modules: [balances(previousQuery)],
            label: query.comparisonYear + "年同期",
            warnings: [],
          },
        }
      : {}),
  };
}
async function settle() {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
    await nextTick();
  }
}
function line(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAllComponents(Chart)
    .find((chart) => chart.props("type") === "line")!;
}
function ringTotal(wrapper: ReturnType<typeof mount>) {
  return wrapper.get(".balance-total-amount").text();
}
function scope(wrapper: ReturnType<typeof mount>) {
  return wrapper.get(".balance-structure-scope").text();
}

describe("余额金额点击与四账户结构联动", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockGetBalanceAnalysis
      .mockReset()
      .mockImplementation(async (query) => dataset(query));
    mockGetBalanceWindow
      .mockReset()
      .mockImplementation(async (query) => dataset(query));
    mockDownloadBalance.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("年度默认取最近同一月四账户余额，点击精准金额切换该月并可返回年度", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    expect(ringTotal(wrapper)).toBe("¥2,000.00");
    expect(scope(wrapper)).toContain("2026");
    expect(scope(wrapper)).toContain("2026-09");
    expect(wrapper.findAll(".balance-account-list li")).toHaveLength(4);
    await line(wrapper)
      .get('.chart-value-label[data-series="current"][data-month="2026-08"]')
      .trigger("click");
    expect(scope(wrapper)).toContain("2026-08");
    expect(ringTotal(wrapper)).toBe("¥3.30");
    expect(
      wrapper
        .get(
          '.balance-account-list li[data-account="general"] .balance-account-amount',
        )
        .text(),
    ).toBe("¥0.10");
    expect(
      wrapper
        .get(
          '.balance-account-list li[data-account="business"] .balance-account-amount',
        )
        .text(),
    ).toBe("¥0.20");
    expect(mockGetBalanceAnalysis).toHaveBeenCalledTimes(1);
    await wrapper.get(".balance-year-reset").trigger("click");
    expect(ringTotal(wrapper)).toBe("¥2,000.00");
    wrapper.unmount();
  });

  it("当月全零可点击、中心与四账户均显示零且相邻零值仍连线", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    const chart = line(wrapper);
    expect(
      chart
        .get(
          '.analysis-line-series[data-series="current"] .analysis-line-edge[data-from-month="2026-01"][data-to-month="2026-02"]',
        )
        .exists(),
    ).toBe(true);
    expect(
      chart
        .get(
          '.analysis-line-series[data-series="current"] .analysis-line-edge[data-from-month="2026-02"][data-to-month="2026-03"]',
        )
        .exists(),
    ).toBe(true);
    await chart
      .get(
        '.analysis-line-series[data-series="current"] .analysis-line-point[data-month="2026-02"]',
      )
      .trigger("click");
    expect(scope(wrapper)).toContain("2026-02");
    expect(ringTotal(wrapper)).toBe("¥0.00");
    expect(
      wrapper.findAll(".balance-account-amount").map((item) => item.text()),
    ).toEqual(Array(4).fill("¥0.00"));
    expect(
      wrapper.findAll(".balance-account-percentage").map((item) => item.text()),
    ).toEqual(Array(4).fill("0.00%"));
    expect(wrapper.findAll(".balance-ring-slice")).toHaveLength(0);
    expect(
      chart.find('.analysis-line-point[data-month="2026-04"]').exists(),
    ).toBe(false);
    expect(
      chart
        .find(
          '.analysis-line-edge[data-from-month="2026-03"][data-to-month="2026-05"]',
        )
        .exists(),
    ).toBe(false);
    wrapper.unmount();
  });

  it("点击同期金额按历史实际月份联动，不误用当期横轴月份，超长总额完整保留", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await line(wrapper)
      .get('.chart-value-label[data-series="comparison"][data-month="2026-01"]')
      .trigger("keydown", { key: "Enter" });
    expect(scope(wrapper)).toContain("2025-01");
    expect(scope(wrapper)).toContain("对比");
    expect(ringTotal(wrapper)).toBe("¥999,999,999,999,999,999.123456789012");
    wrapper.unmount();
  });

  it("只查询部分月份时独立读取年度余额，点击和年度饼图不改统计范围", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    wrapper
      .findComponent(DateRange)
      .vm.$emit("update:modelValue", ["2026-07", "2026-09"]);
    await settle();
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(mockGetBalanceWindow).toHaveBeenCalledWith(
      { from: "2026-01", to: "2026-09", granularity: "month" },
      expect.any(AbortSignal),
    );
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-07 至 2026-09",
    );
    await line(wrapper)
      .get('.chart-value-label[data-series="current"][data-month="2026-08"]')
      .trigger("click");
    expect(ringTotal(wrapper)).toBe("¥3.30");
    line(wrapper).vm.$emit("window-change", { from: "2024-10", to: "2025-09" });
    await settle();
    expect(wrapper.find(".balance-year-reset").exists()).toBe(false);
    expect(ringTotal(wrapper)).toBe("¥2,000.00");
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-07 至 2026-09",
    );
    wrapper.unmount();
  });

  it("年度补查在页签停用时取消，迟到响应不能重新填充余额", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    let finish!: (data: MonthlyFinancialAnalysisData) => void;
    let annualSignal: AbortSignal | undefined;
    mockGetBalanceWindow.mockImplementation(
      (query: FinancialAnalysisQuery, signal: AbortSignal) => {
        if (query.from === "2026-01" && !query.comparisonYear) {
          annualSignal = signal;
          return new Promise<MonthlyFinancialAnalysisData>((resolve) => {
            finish = resolve;
          });
        }
        return Promise.resolve(dataset(query));
      },
    );
    wrapper
      .findComponent(DateRange)
      .vm.$emit("update:modelValue", ["2026-07", "2026-09"]);
    await settle();
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(annualSignal?.aborted).toBe(false);
    expect(ringTotal(wrapper)).toBe("未知");
    await wrapper.setProps({ active: false });
    expect(annualSignal?.aborted).toBe(true);
    finish(dataset({ from: "2026-01", to: "2026-09", granularity: "month" }));
    await settle();
    expect(ringTotal(wrapper)).toBe("未知");
    wrapper.unmount();
  });

  it.each([401, 403])(
    "年度补查返回%s时清理图形和统计，不遗留财务数据",
    async (status) => {
      const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
      await settle();
      mockGetBalanceWindow.mockImplementation(
        (query: FinancialAnalysisQuery) => {
          if (query.from === "2026-01" && !query.comparisonYear)
            return Promise.reject({ response: { status } });
          return Promise.resolve(dataset(query));
        },
      );
      wrapper
        .findComponent(DateRange)
        .vm.$emit("update:modelValue", ["2026-07", "2026-09"]);
      await settle();
      await wrapper.get("form").trigger("submit");
      await settle();
      expect(wrapper.find(".balance-structure").exists()).toBe(false);
      expect(wrapper.find(".displayed-query").exists()).toBe(false);
      expect(wrapper.find(".analysis-module").exists()).toBe(false);
      expect(wrapper.text()).toContain("登录或查看权限已失效");
      wrapper.unmount();
    },
  );

  it("真实点击按下不捕获指针，移动成为拖动后才捕获并抑制拖动误点", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    const chart = line(wrapper);
    const region = chart.get(".line-scroll").element as HTMLElement;
    const capture = jest.fn();
    region.setPointerCapture = capture;
    const point = chart.get(
      '.chart-value-label[data-series="current"][data-month="2026-08"]',
    );
    const pointer = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 8, clientX: x, button: 0 });
      point.element.dispatchEvent(event);
    };
    pointer("pointerdown", 100);
    pointer("pointermove", 103);
    expect(capture).not.toHaveBeenCalled();
    pointer("pointerup", 103);
    await point.trigger("click");
    expect(scope(wrapper)).toContain("2026-08");
    expect(chart.emitted("point-select")).toHaveLength(1);
    pointer("pointerdown", 100);
    pointer("pointermove", 130);
    expect(capture).toHaveBeenCalledWith(8);
    pointer("pointerup", 130);
    await point.trigger("click");
    expect(chart.emitted("point-select")).toHaveLength(1);
    wrapper.unmount();
  });

  it("年度请求超过一分钟时不会被后台定时刷新反复取消重启", async () => {
    jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    let finish!: (data: MonthlyFinancialAnalysisData) => void;
    let annualSignal: AbortSignal | undefined;
    mockGetBalanceWindow.mockImplementation(
      (query: FinancialAnalysisQuery, signal: AbortSignal) => {
        if (query.from === "2026-01" && !query.comparisonYear) {
          annualSignal = signal;
          return new Promise<MonthlyFinancialAnalysisData>((resolve) => {
            finish = resolve;
          });
        }
        return Promise.resolve(dataset(query));
      },
    );
    wrapper
      .findComponent(DateRange)
      .vm.$emit("update:modelValue", ["2026-07", "2026-09"]);
    await settle();
    await wrapper.get("form").trigger("submit");
    await settle();
    const queryCount = mockGetBalanceAnalysis.mock.calls.length;
    jest.advanceTimersByTime(75_000);
    await settle();
    expect(mockGetBalanceAnalysis).toHaveBeenCalledTimes(queryCount);
    expect(annualSignal?.aborted).toBe(false);
    finish(dataset({ from: "2026-01", to: "2026-09", granularity: "month" }));
    await settle();
    expect(ringTotal(wrapper)).toBe("¥2,000.00");
    wrapper.unmount();
  });
});
