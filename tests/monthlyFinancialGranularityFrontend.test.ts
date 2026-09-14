const mockGetAnalysis = jest.fn();
const mockGetWindowAnalysis = jest.fn();
const mockDownloadAnalysis = jest.fn();

jest.mock("@/utils/monthlyFinancialAnalysisApi", () => ({
  getMonthlyFinancialAnalysis: (...args: unknown[]) => mockGetAnalysis(...args),
  getMonthlyFinancialAnalysisWindow: (...args: unknown[]) =>
    mockGetWindowAnalysis(...args),
  downloadMonthlyFinancialAnalysis: (...args: unknown[]) =>
    mockDownloadAnalysis(...args),
}));
jest.mock(
  "@/components/monthly-financial/MonthlyFinancialDateRange.vue",
  () => ({
    __esModule: true,
    default: {
      props: ["modelValue"],
      emits: ["update:modelValue"],
      methods: { close: jest.fn() },
      template: `<div><input aria-label="分析开始月份" :value="modelValue[0]" @input="$emit('update:modelValue', [$event.target.value, modelValue[1]])" /><input aria-label="分析结束月份" :value="modelValue[1]" @input="$emit('update:modelValue', [modelValue[0], $event.target.value])" /></div>`,
    },
  }),
);
// 本组核对真实面板的数据选择和参数；绘图坐标、标签布局由图表独立行为测试覆盖。
jest.mock(
  "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue",
  () => ({
    __esModule: true,
    default: {
      props: [
        "type",
        "title",
        "periods",
        "series",
        "comparisonPeriods",
        "comparisonSeries",
        "comparisonLabel",
        "comparisonVisible",
        "fixedMonthWindow",
        "continuousHistory",
        "quarterHistory",
        "periodView",
        "windowEnd",
        "items",
        "historyLoading",
        "historyError",
      ],
      emits: ["window-change", "point-select"],
      template: `<section :data-chart-type="type"><h4>{{ title }}</h4></section>`,
    },
  }),
);

import { nextTick } from "vue";
import MonthlyFinancialAnalysisPanel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { addFinancialAmountTexts } from "@/utils/monthlyFinancialReportPresentation";
import {
  financialMonthOffset,
  financialTwelveQuarterRange,
  financialWindowQuery,
} from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisGranularity,
  FinancialAnalysisModule,
  FinancialAnalysisModuleKey,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
type PanelWrapper = ReturnType<
  typeof mount<typeof MonthlyFinancialAnalysisPanel>
>;
const titles: Record<FinancialAnalysisModuleKey, string> = {
  balances: "账户余额资金台帐",
  inflow: "一般账户入账统计",
  outflow: "一般账户出账统计",
  projects: "项目分析",
  settlement: "收支结余汇总",
  business: "商务统计",
  personnel: "人力成本分析",
};
const keys = Object.keys(titles) as FinancialAnalysisModuleKey[];
const defaultQuery: FinancialAnalysisQuery = {
  from: "2026-01",
  to: "2026-09",
  granularity: "month",
  comparisonYear: 2025,
};
const metricLabels: Record<
  FinancialAnalysisModuleKey,
  Array<[string, string]>
> = {
  balances: [
    ["general", "一般账户"],
    ["business", "商务账户"],
    ["welfare_one", "福利金账户一"],
    ["welfare_two", "福利金账户二"],
    ["total", "四账户合计"],
  ],
  inflow: [
    ["receipt", "主营实际回款"],
    ["interest", "一般账户利息"],
  ],
  outflow: [
    ["salary", "薪资支出"],
    ["administration", "行政支出"],
  ],
  projects: [
    ["contract", "合同金额"],
    ["received", "已回款"],
    ["outstanding", "未回款"],
  ],
  settlement: [
    ["income", "结算收入"],
    ["expense", "结算支出"],
    ["surplus", "当期结余"],
  ],
  business: [["business", "商务报销"]],
  personnel: [["total", "已授权人员总成本"]],
};
function sum(values: string[]) {
  return values.reduce(
    (total, amount) => addFinancialAmountTexts(total, amount),
    "0",
  );
}
function cents(value: bigint) {
  return addFinancialAmountTexts(
    "0",
    `${value / 100n}.${String(value % 100n).padStart(2, "0")}`,
  );
}
function months(from: string, to: string) {
  const result: string[] = [];
  for (
    let current = from;
    current <= to;
    current = financialMonthOffset(current, 1)
  )
    result.push(current);
  return result;
}
/** 使用逐月样本真正分组，不能只把月度标签改成季度或年度。 */
function periodsFor(query: FinancialAnalysisQuery): FinancialAnalysisPeriod[] {
  const groups = new Map<string, FinancialAnalysisPeriod>();
  for (const month of months(query.from, query.to)) {
    const year = month.slice(0, 4);
    const quarter = Math.ceil(Number(month.slice(5)) / 3);
    const key =
      query.granularity === "year"
        ? year
        : query.granularity === "quarter"
          ? `${year}-Q${quarter}`
          : month;
    const label =
      query.granularity === "year"
        ? `${year}年`
        : query.granularity === "quarter"
          ? `${year}年第${quarter}季度`
          : month;
    const existing = groups.get(key);
    if (existing) existing.to = month;
    else groups.set(key, { key, label, from: month, to: month });
  }
  return [...groups.values()];
}
function monthlyAmount(
  module: FinancialAnalysisModuleKey,
  metric: string,
  month: string,
): string {
  const number = BigInt(month.slice(5));
  if (module === "balances") {
    const accounts: Record<string, bigint> = {
      general: 100_000n + number * 1_000n,
      business: 1_000n + number * 100n,
      welfare_one: number * 100n,
      welfare_two: number * 200n,
    };
    return metric === "total"
      ? cents(Object.values(accounts).reduce((left, right) => left + right, 0n))
      : cents(accounts[metric]);
  }
  if (module === "projects")
    return cents(
      metric === "contract"
        ? 300_000n
        : metric === "received"
          ? number * 10_000n
          : 300_000n - number * 10_000n,
    );
  const rate: Record<string, bigint> = {
    "inflow:receipt": 10n,
    "inflow:interest": 2n,
    "outflow:salary": 20n,
    "outflow:administration": 6n,
    "settlement:income": 100n,
    "settlement:expense": 60n,
    "settlement:surplus": 40n,
    "business:business": 6n,
    "personnel:total": 30n,
  };
  if (module === "inflow" && metric === "receipt" && month === "2026-01")
    return "0.100000000001";
  return cents(
    (number * rate[`${module}:${metric}`]) /
      (month.startsWith("2025") ? 2n : 1n),
  );
}
function modulesFor(query: FinancialAnalysisQuery): FinancialAnalysisModule[] {
  const periods = periodsFor(query);
  return keys.map((key) => {
    const endpoint = key === "balances" || key === "projects";
    const series = metricLabels[key].map(([metric, label]) => ({
      key: metric,
      label,
      values: periods.map((period) =>
        endpoint
          ? monthlyAmount(key, metric, period.to)
          : sum(
              months(period.from, period.to).map((month) =>
                monthlyAmount(key, metric, month),
              ),
            ),
      ),
    }));
    const summaries = series.map((row) => ({
      key: row.key,
      label: row.label,
      amount: endpoint ? row.values.at(-1)! : sum(row.values),
    }));
    return {
      key,
      title: titles[key],
      description: endpoint
        ? "按期间末月取值，不累计月末余额。"
        : "按所选期间内真实月份累计。",
      sourceLabel: "独立测试中的逐月精确来源",
      updatedAt: "2026-09-02T01:00:00Z",
      payrollDetailsVisible: key === "personnel" ? false : undefined,
      periods,
      series,
      summaries,
      breakdown:
        key === "balances"
          ? summaries.filter((row) => row.key !== "total")
          : [],
      comparison: [],
      columns: [
        { key: "period", label: "期间", format: "text" },
        { key: "amount", label: "授权金额", format: "amount" },
        { key: "sourceId", label: "来源编号", format: "text" },
      ],
      details: periods.map((period, index) => ({
        id: `${key}:${period.key}`,
        period: period.label,
        amount: series[0].values[index],
        sourceId: `来源:${key}:${period.key}`,
      })),
      warnings: [],
      appliedFilters: ["时间"],
    };
  });
}
function response(query: FinancialAnalysisQuery): MonthlyFinancialAnalysisData {
  const result: MonthlyFinancialAnalysisData = {
    query: { ...query },
    generatedAt: "2026-09-02T01:00:00Z",
    dataVersion: `精确版本:${query.from}:${query.to}:${query.granularity}`,
    filterOptions: {
      parties: ["甲方甲"],
      contractRegions: [],
      reimbursementScopes: [],
      people: [{ id: "employee", name: "历史人员" }],
    },
    modules: modulesFor(query),
    warnings: [],
  };
  if (query.comparisonYear !== undefined) {
    const offset = (query.comparisonYear - Number(query.from.slice(0, 4))) * 12;
    const previous = {
      ...query,
      from: financialMonthOffset(query.from, offset),
      to: financialMonthOffset(query.to, offset),
    };
    delete previous.comparisonYear;
    result.comparison = {
      label: `${query.comparisonYear}年同期`,
      query: previous,
      modules: modulesFor(previous),
      warnings: [],
    };
  }
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
async function settle() {
  for (let index = 0; index < 7; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
function lineFor(
  wrapper: PanelWrapper,
  key: FinancialAnalysisModuleKey = "balances",
) {
  return wrapper
    .get(`[data-module="${key}"]`)
    .findAllComponents(MonthlyFinancialAnalysisChart)
    .find((chart) => chart.props("type") === "line")!;
}
async function submitGranularity(
  wrapper: PanelWrapper,
  granularity: FinancialAnalysisGranularity,
) {
  await wrapper.get('[aria-label="分析统计周期"]').setValue(granularity);
  await wrapper.get("form").trigger("submit");
  await settle();
}

describe("分析面板按已提交月季年响应显示图表", () => {
  const wrappers: PanelWrapper[] = [];
  async function mountPanel() {
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: {
        selectedMonth: "2026-09",
        comparisonYears: [2021, 2024, 2025, 2026],
      },
    });
    wrappers.push(wrapper);
    await settle();
    return wrapper;
  }
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetAnalysis.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(response(query)),
    );
    mockGetWindowAnalysis.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(response(query)),
    );
    mockDownloadAnalysis.mockResolvedValue({
      blob: new Blob(["精确导出"]),
      fileName: "期间分析.xlsx",
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:粒度导出"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each(["quarter", "year"] as const)(
    "%s保留真实七模块及同期分组，季度独立十二季而年度直接统计响应，统计日期不变",
    async (granularity) => {
      const wrapper = await mountPanel();
      const windowCalls = mockGetWindowAnalysis.mock.calls.length;
      await submitGranularity(wrapper, granularity);
      const query = { ...defaultQuery, granularity };
      const expected = response(query);
      const chartQuery =
        granularity === "quarter"
          ? financialWindowQuery(
              query,
              financialTwelveQuarterRange(query.to, query.to),
              "quarter",
            )
          : query;
      const expectedChart = response(chartQuery);
      expect(mockGetAnalysis).toHaveBeenLastCalledWith(
        query,
        expect.any(AbortSignal),
      );
      expect(mockGetWindowAnalysis).toHaveBeenCalledTimes(
        windowCalls + (granularity === "quarter" ? 1 : 0),
      );
      if (granularity === "quarter")
        expect(mockGetWindowAnalysis).toHaveBeenLastCalledWith(
          chartQuery,
          expect.any(AbortSignal),
        );
      expect(wrapper.get('[aria-label="分析开始月份"]').element).toHaveProperty(
        "value",
        defaultQuery.from,
      );
      expect(wrapper.get('[aria-label="分析结束月份"]').element).toHaveProperty(
        "value",
        defaultQuery.to,
      );
      expect(wrapper.find(".apply-window-statistics").exists()).toBe(
        granularity === "quarter",
      );
      for (const [index, key] of keys.entries()) {
        const line = lineFor(wrapper, key);
        expect(line.props("periods")).toEqual(
          expectedChart.modules[index].periods,
        );
        expect(line.props("series")).toEqual(
          expectedChart.modules[index].series,
        );
        expect(line.props("comparisonPeriods")).toEqual(
          expectedChart.comparison!.modules[index].periods,
        );
        expect(line.props("comparisonSeries")).toEqual(
          expectedChart.comparison!.modules[index].series,
        );
        expect(line.props("fixedMonthWindow")).toBe(false);
        expect(line.props("continuousHistory")).toBe(false);
        expect(line.props("quarterHistory")).toBe(granularity === "quarter");
        expect(line.props("periodView")).toBe(granularity === "year");
        expect(line.props("title")).toContain(
          granularity === "quarter" ? "季度趋势" : "年度趋势",
        );
        // 月度十二月范围不是合法十二季窗口，也不能覆盖年度图。
        line.vm.$emit("window-change", { from: "2024-10", to: "2025-09" });
      }
      jest.advanceTimersByTime(180);
      await settle();
      expect(mockGetWindowAnalysis).toHaveBeenCalledTimes(
        windowCalls + (granularity === "quarter" ? 1 : 0),
      );
      expect(
        lineFor(wrapper, "inflow").props("series")[0].values.slice(-3),
      ).toEqual(
        granularity === "quarter"
          ? ["0.600000000001", "1.5", "2.4"]
          : ["4.500000000001"],
      );
      expect(
        lineFor(wrapper)
          .props("series")
          .find((row: { key: string }) => row.key === "total")
          .values.slice(-3),
      ).toEqual(
        granularity === "quarter" ? ["1052", "1094", "1136"] : ["1136"],
      );
      expect(
        lineFor(wrapper, "projects").props("series")[2].values.slice(-3),
      ).toEqual(
        granularity === "quarter" ? ["2700", "2400", "2100"] : ["2100"],
      );
      expect(
        lineFor(wrapper, "personnel").props("series")[0].values.slice(-3),
      ).toEqual(granularity === "quarter" ? ["1.8", "4.5", "7.2"] : ["13.5"]);
      expect(wrapper.findAll(".analysis-period-table")).toHaveLength(0);
      expect(wrapper.get(".displayed-query").text()).toContain(
        `${query.from} 至 ${query.to}`,
      );
      expect(
        wrapper.get('[data-module="personnel"] .analysis-summaries').text(),
      ).toContain("¥13.50");
      await wrapper.get(".analysis-header button").trigger("click");
      await settle();
      expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
        query,
        "all",
        expected.dataVersion,
      );
    },
  );

  it.each(["quarter", "year"] as const)(
    "%s跨年时统计保留原起止月份，季度图独立包含此前完整季度且只截断最新季",
    async (granularity) => {
      const wrapper = await mountPanel();
      await wrapper.get('[aria-label="分析开始月份"]').setValue("2025-11");
      await wrapper.get('[aria-label="分析结束月份"]').setValue("2026-02");
      await submitGranularity(wrapper, granularity);
      expect(mockGetAnalysis).toHaveBeenLastCalledWith(
        { from: "2025-11", to: "2026-02", granularity, comparisonYear: 2024 },
        expect.any(AbortSignal),
      );
      const periods = lineFor(wrapper).props(
        "periods",
      ) as FinancialAnalysisPeriod[];
      expect(
        periods.slice(-2).map(({ key, from, to }) => ({ key, from, to })),
      ).toEqual([
        {
          key: granularity === "quarter" ? "2025-Q4" : "2025",
          from: granularity === "quarter" ? "2025-10" : "2025-11",
          to: "2025-12",
        },
        {
          key: granularity === "quarter" ? "2026-Q1" : "2026",
          from: "2026-01",
          to: "2026-02",
        },
      ]);
      expect(
        lineFor(wrapper, "inflow").props("series")[0].values.slice(-2),
      ).toEqual([
        granularity === "quarter" ? "1.65" : "1.15",
        "0.300000000001",
      ]);
      expect(
        lineFor(wrapper)
          .props("series")
          .find((row: { key: string }) => row.key === "total")
          .values.slice(-2),
      ).toEqual(["1178", "1038"]);
      expect(
        lineFor(wrapper)
          .props("comparisonPeriods")
          .slice(-2)
          .map((period: FinancialAnalysisPeriod) => [period.from, period.to]),
      ).toEqual([
        [granularity === "quarter" ? "2024-10" : "2024-11", "2024-12"],
        ["2025-01", "2025-02"],
      ]);
      expect(wrapper.get(".displayed-query").text()).toContain(
        "2025-11 至 2026-02",
      );
      expect(wrapper.find(".analysis-period-table").exists()).toBe(false);
    },
  );

  it("未提交粒度草稿和未完成查询不提前切图；成功后才同步已显示期间", async () => {
    const wrapper = await mountPanel();
    const before = lineFor(wrapper).props("periods");
    const calls = mockGetWindowAnalysis.mock.calls.length;
    await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
    expect(lineFor(wrapper).props("fixedMonthWindow")).toBe(true);
    expect(lineFor(wrapper).props("periods")).toEqual(before);
    expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
    const pending = deferred<MonthlyFinancialAnalysisData>();
    mockGetAnalysis.mockReturnValueOnce(pending.promise);
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(lineFor(wrapper).props("fixedMonthWindow")).toBe(true);
    expect(mockGetWindowAnalysis).toHaveBeenCalledTimes(calls);
    pending.resolve(response({ ...defaultQuery, granularity: "quarter" }));
    await settle();
    await wrapper.get('[aria-label="分析统计周期"]').setValue("year");
    expect(lineFor(wrapper).props("quarterHistory")).toBe(true);
    expect(lineFor(wrapper).props("periodView")).toBe(false);
    expect(lineFor(wrapper).props("periods")).toHaveLength(12);
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
      { ...defaultQuery, granularity: "quarter" },
      "all",
      "精确版本:2026-01:2026-09:quarter",
    );
  });

  it("季度与年度保留各模块独立的对比显隐，原同期金额和导出不被删除", async () => {
    const wrapper = await mountPanel();
    await submitGranularity(wrapper, "quarter");
    const originalComparison = lineFor(wrapper, "inflow").props(
      "comparisonSeries",
    );
    const originalComparisonText = JSON.stringify(originalComparison);
    const calls = [
      mockGetAnalysis.mock.calls.length,
      mockGetWindowAnalysis.mock.calls.length,
    ];
    await wrapper.get("#analysis-tab-inflow").trigger("click");
    await wrapper
      .get('[data-module="inflow"] .module-comparison-toggle')
      .trigger("click");
    expect(lineFor(wrapper, "inflow").props("comparisonVisible")).toBe(false);
    expect(lineFor(wrapper, "inflow").props("comparisonSeries")).toEqual(
      originalComparison,
    );
    expect(
      JSON.stringify(lineFor(wrapper, "inflow").props("comparisonSeries")),
    ).toBe(originalComparisonText);
    for (const key of keys.filter((key) => key !== "inflow"))
      expect(lineFor(wrapper, key).props("comparisonVisible")).toBe(true);
    expect([
      mockGetAnalysis.mock.calls.length,
      mockGetWindowAnalysis.mock.calls.length,
    ]).toEqual(calls);
    await submitGranularity(wrapper, "year");
    expect(lineFor(wrapper, "inflow").props("comparisonVisible")).toBe(false);
    expect(lineFor(wrapper, "outflow").props("comparisonVisible")).toBe(true);
    expect(lineFor(wrapper, "inflow").props("comparisonPeriods")).toEqual([
      { key: "2025", label: "2025年", from: "2025-01", to: "2025-09" },
    ]);
    await wrapper
      .get('[data-module="inflow"] .module-comparison-toggle')
      .trigger("click");
    expect(lineFor(wrapper, "inflow").props("comparisonVisible")).toBe(true);
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
      { ...defaultQuery, granularity: "year" },
      "all",
      "精确版本:2026-01:2026-09:year",
    );
  });

  it.each(["成功", "权限拒绝"])(
    "季度成功后忽略旧月窗口迟到的%s，切回月度恢复独立十二个月查询",
    async (lateState) => {
      const oldWindow = deferred<MonthlyFinancialAnalysisData>();
      mockGetWindowAnalysis.mockReturnValueOnce(oldWindow.promise);
      const wrapper = await mountPanel();
      const oldQuery = mockGetWindowAnalysis.mock
        .calls[0][0] as FinancialAnalysisQuery;
      const oldSignal = mockGetWindowAnalysis.mock.calls[0][1] as AbortSignal;
      await submitGranularity(wrapper, "quarter");
      expect(oldSignal.aborted).toBe(true);
      if (lateState === "成功") oldWindow.resolve(response(oldQuery));
      else oldWindow.reject({ response: { status: 403 } });
      await settle();
      expect(lineFor(wrapper).props("periods")).toHaveLength(12);
      expect(lineFor(wrapper).props("quarterHistory")).toBe(true);
      expect(lineFor(wrapper).props("periodView")).toBe(false);
      const lateYear = deferred<MonthlyFinancialAnalysisData>();
      mockGetAnalysis.mockReturnValueOnce(lateYear.promise);
      await submitGranularity(wrapper, "year");
      const lateSignal = mockGetAnalysis.mock.calls.at(-1)![1] as AbortSignal;
      await submitGranularity(wrapper, "month");
      expect(lateSignal.aborted).toBe(true);
      expect(mockGetWindowAnalysis).toHaveBeenLastCalledWith(
        {
          from: "2025-10",
          to: "2026-09",
          granularity: "month",
          comparisonYear: 2024,
        },
        expect.any(AbortSignal),
      );
      expect(lineFor(wrapper).props("fixedMonthWindow")).toBe(true);
      expect(lineFor(wrapper).props("continuousHistory")).toBe(true);
      expect(lineFor(wrapper).props("periodView")).toBe(false);
      expect(lineFor(wrapper).props("periods")).toHaveLength(12);
      expect(wrapper.findAll(".apply-window-statistics")).toHaveLength(7);
      lateYear.resolve(response({ ...defaultQuery, granularity: "year" }));
      await settle();
      expect(lineFor(wrapper).props("periods")).toHaveLength(12);
      expect(wrapper.get(".displayed-query").text()).toContain("月度");
    },
  );

  it("季度窗口按自然季移动；非法截尾和月窗口事件忽略，统计与导出仅在明确应用后改变", async () => {
    const wrapper = await mountPanel();
    await submitGranularity(wrapper, "quarter");
    expect(mockGetWindowAnalysis).toHaveBeenLastCalledWith(
      {
        from: "2023-10",
        to: "2026-09",
        granularity: "quarter",
        comparisonYear: 2022,
      },
      expect.any(AbortSignal),
    );
    // 先让合法的后台邻季预取完成，随后非法事件不能产生任何额外请求。
    jest.advanceTimersByTime(350);
    await settle();
    const bufferQuery: FinancialAnalysisQuery = {
      from: "2021-01",
      to: "2026-09",
      granularity: "quarter",
      comparisonYear: 2020,
    };
    expect(mockGetWindowAnalysis).toHaveBeenLastCalledWith(
      bufferQuery,
      expect.any(AbortSignal),
    );
    const windowCalls = mockGetWindowAnalysis.mock.calls.length;
    const line = lineFor(wrapper);
    for (const invalid of [
      { from: "2024-10", to: "2025-09" },
      { from: "2023-04", to: "2026-02" },
      { from: "2023-08", to: "2026-06" },
      { from: "2024-01", to: "2026-12" },
    ]) {
      line.vm.$emit("window-change", invalid);
      jest.advanceTimersByTime(180);
      await settle();
    }
    expect(mockGetWindowAnalysis).toHaveBeenCalledTimes(windowCalls);
    line.vm.$emit("window-change", { from: "2023-07", to: "2026-06" });
    jest.advanceTimersByTime(180);
    await settle();
    const windowQuery: FinancialAnalysisQuery = {
      from: "2023-07",
      to: "2026-06",
      granularity: "quarter",
      comparisonYear: 2022,
    };
    expect(mockGetWindowAnalysis).toHaveBeenCalledTimes(windowCalls);
    expect(line.props("windowEnd")).toBe("2026-06");
    expect(line.props("periods")).toEqual(
      response(bufferQuery).modules[0].periods,
    );
    expect(line.props("comparisonPeriods")).toEqual(
      response(bufferQuery).comparison!.modules[0].periods,
    );
    const visibleIndexes = (
      line.props("periods") as FinancialAnalysisPeriod[]
    ).flatMap((period, index) =>
      period.from >= windowQuery.from && period.to <= windowQuery.to
        ? [index]
        : [],
    );
    expect(visibleIndexes).toHaveLength(12);
    expect(
      line
        .props("series")
        .map((series: { values: Array<string | null> }) =>
          visibleIndexes.map((index) => series.values[index]),
        ),
    ).toEqual(
      response(windowQuery).modules[0].series.map((series) => series.values),
    );
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09 · 季度",
    );
    expect(mockGetAnalysis).toHaveBeenCalledTimes(2);
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
      { ...defaultQuery, granularity: "quarter" },
      "all",
      "精确版本:2026-01:2026-09:quarter",
    );
    await wrapper.get(".apply-window-statistics").trigger("click");
    await settle();
    expect(mockGetAnalysis).toHaveBeenLastCalledWith(
      windowQuery,
      expect.any(AbortSignal),
    );
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2023-07 至 2026-06 · 季度",
    );
  });

  it.each(["成功", "权限拒绝"])(
    "切换年度后取消季度窗口，季度迟到的%s不覆盖年度或清空授权结果",
    async (lateState) => {
      const wrapper = await mountPanel();
      const lateQuarter = deferred<MonthlyFinancialAnalysisData>();
      mockGetWindowAnalysis.mockReturnValueOnce(lateQuarter.promise);
      await submitGranularity(wrapper, "quarter");
      const [quarterQuery, signal] = mockGetWindowAnalysis.mock.calls.at(
        -1,
      )! as [FinancialAnalysisQuery, AbortSignal];
      expect(quarterQuery.granularity).toBe("quarter");
      expect(lineFor(wrapper).props("quarterHistory")).toBe(true);
      expect(lineFor(wrapper).props("historyLoading")).toBe(true);
      expect(
        lineFor(wrapper)
          .props("series")
          .every(
            (series: { values: Array<string | null> }) =>
              series.values.length === 12 &&
              series.values.every((amount) => amount === null),
          ),
      ).toBe(true);
      await submitGranularity(wrapper, "year");
      expect(signal.aborted).toBe(true);
      if (lateState === "成功") lateQuarter.resolve(response(quarterQuery));
      else lateQuarter.reject({ response: { status: 403 } });
      await settle();
      expect(wrapper.findAll(".analysis-module")).toHaveLength(7);
      expect(lineFor(wrapper).props("periods")).toEqual(
        response({ ...defaultQuery, granularity: "year" }).modules[0].periods,
      );
      expect(lineFor(wrapper).props("periodView")).toBe(true);
      expect(lineFor(wrapper).props("quarterHistory")).toBe(false);
      expect(lineFor(wrapper).props("historyLoading")).toBe(false);
      expect(wrapper.find(".apply-window-statistics").exists()).toBe(false);
      expect(wrapper.get(".displayed-query").text()).toContain("年度");
    },
  );

  it.each(["quarter", "year"] as const)(
    "%s仍只显示已授权人力总成本，不从同比恢复工资分项",
    async (granularity) => {
      const wrapper = await mountPanel();
      await wrapper.get('[aria-label="分析人员"]').setValue("employee");
      await submitGranularity(wrapper, granularity);
      await wrapper.get("#analysis-tab-personnel").trigger("click");
      const card = wrapper.get('[data-module="personnel"]');
      expect(card.find('[data-chart-type="donut"]').exists()).toBe(false);
      expect(card.get(".payroll-permission-note").text()).toContain(
        "仅向具备工资查看权限的管理员开放",
      );
      expect(
        lineFor(wrapper, "personnel")
          .props("series")
          .map((row: { key: string }) => row.key),
      ).toEqual(["total"]);
      expect(
        lineFor(wrapper, "personnel")
          .props("comparisonSeries")
          .map((row: { key: string }) => row.key),
      ).toEqual(["total"]);
      expect(card.find(".analysis-details").exists()).toBe(false);
      expect(card.get(".analysis-summaries").text()).toContain("¥13.50");
    },
  );

  it.each([401, 403])(
    "期间模式收到权限错误%d时清空七模块和旧下载，不恢复月图",
    async (status) => {
      const wrapper = await mountPanel();
      await submitGranularity(wrapper, "quarter");
      await wrapper.get(".analysis-header button").trigger("click");
      await settle();
      expect(wrapper.find(".export-ready").exists()).toBe(true);
      const calls = mockGetWindowAnalysis.mock.calls.length;
      mockGetAnalysis.mockRejectedValueOnce({
        response: { status, data: { message: "当前财务查看权限已失效" } },
      });
      await submitGranularity(wrapper, "year");
      expect(wrapper.findAll(".analysis-module")).toHaveLength(0);
      expect(wrapper.find(".export-ready").exists()).toBe(false);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:粒度导出");
      expect(mockGetWindowAnalysis).toHaveBeenCalledTimes(calls);
      expect(wrapper.text()).toContain("当前财务查看权限已失效");
    },
  );
});
