const mockRead = jest.fn();
const mockWindow = jest.fn();
jest.mock("@/utils/monthlyFinancialAnalysisApi", () => ({
  getMonthlyFinancialAnalysis: (...args: unknown[]) => mockRead(...args),
  getMonthlyFinancialAnalysisWindow: (...args: unknown[]) =>
    mockWindow(...args),
  downloadMonthlyFinancialAnalysis: jest.fn(),
}));
jest.mock(
  "@/components/monthly-financial/MonthlyFinancialDateRange.vue",
  () => ({
    __esModule: true,
    default: {
      props: ["modelValue", "popperAppendTo"],
      emits: ["update:modelValue"],
      methods: { close: jest.fn() },
      template: `<div class="date-range-test"><input aria-label="测试开始月" :value="modelValue[0]" @input="$emit('update:modelValue', [$event.target.value, modelValue[1]])" /><input aria-label="测试结束月" :value="modelValue[1]" @input="$emit('update:modelValue', [modelValue[0], $event.target.value])" /></div>`,
    },
  }),
);
// 本组验证真实面板的图表入口协调；按钮几何位置由图表组件专项验证。
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
        "windowEnd",
        "historyLoading",
        "periodView",
        "fixedMonthWindow",
        "continuousHistory",
        "quarterHistory",
        "showCurrentMonthShortcut",
        "currentMonthDisabled",
      ],
      emits: ["window-change", "point-select", "current-month"],
      template: `<section :data-chart-type="type"><h4>{{ title }}</h4><div v-if="type === 'line'" class="line-selection"><span>多指标比较</span><button v-if="showCurrentMonthShortcut" type="button" class="chart-current-month" :disabled="currentMonthDisabled" @click="$emit('current-month')">回到本月</button></div></section>`,
    },
  }),
);

import { nextTick } from "vue";
import Panel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import Chart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import DateRange from "@/components/monthly-financial/MonthlyFinancialDateRange.vue";
import {
  financialMonthOffset,
  financialTwelveMonthRange,
} from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisModuleKey,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";
const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
type PanelWrapper = ReturnType<typeof mount<typeof Panel>>;
const keys: FinancialAnalysisModuleKey[] = [
  "balances",
  "inflow",
  "outflow",
  "projects",
  "settlement",
  "business",
  "personnel",
];
const septemberQuery: FinancialAnalysisQuery = {
  from: "2025-10",
  to: "2026-09",
  granularity: "month",
  comparisonYear: 2024,
};
const wrappers: PanelWrapper[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
function periodsFor(query: FinancialAnalysisQuery) {
  const periods = new Map<string, FinancialAnalysisPeriod>();
  for (
    let month = query.from;
    month <= query.to;
    month = financialMonthOffset(month, 1)
  ) {
    const key =
      query.granularity === "year"
        ? month.slice(0, 4)
        : query.granularity === "quarter"
          ? `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5)) / 3)}`
          : month;
    const previous = periods.get(key);
    if (previous) previous.to = month;
    else periods.set(key, { key, label: key, from: month, to: month });
  }
  return [...periods.values()];
}
function response(
  query: FinancialAnalysisQuery,
  amount = "2053235.4",
): MonthlyFinancialAnalysisData {
  const periods = periodsFor(query);
  const result: MonthlyFinancialAnalysisData = {
    query: { ...query },
    generatedAt: "2026-09-04T00:00:00Z",
    dataVersion: "固定合成版本",
    filterOptions: {
      parties: ["合成甲方乙"],
      contractRegions: ["朝阳区"],
      reimbursementScopes: ["朝阳区/商务"],
      people: [{ id: "person-b", name: "合成人员乙" }],
    },
    modules: keys.map((key) => ({
      key,
      title: key,
      description: "图表回到本月合成验证",
      sourceLabel: "合成来源",
      updatedAt: "2026-09-04T00:00:00Z",
      periods,
      series: [
        { key: "total", label: "合计", values: periods.map(() => amount) },
      ],
      summaries: [{ key: "total", label: "合计", amount }],
      breakdown: [],
      comparison: [],
      columns: [],
      details: [],
      warnings: [],
      appliedFilters: [],
    })),
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
      label: "合成同期",
      query: previous,
      modules: response(previous, amount).modules,
      warnings: [],
    };
  }
  return result;
}
async function settle() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
async function renderPanel(
  props: { selectedMonth?: string; active?: boolean } = {},
) {
  const wrapper = mount(Panel, {
    props: { selectedMonth: "2026-09", ...props },
  });
  wrappers.push(wrapper);
  await settle();
  return wrapper;
}
function lineFor(
  wrapper: PanelWrapper,
  key: FinancialAnalysisModuleKey = "balances",
) {
  return wrapper
    .get(`[data-module="${key}"]`)
    .findAllComponents(Chart)
    .find((chart) => chart.props("type") === "line")!;
}
async function returnToCurrentMonth(
  wrapper: PanelWrapper,
  key: FinancialAnalysisModuleKey = "balances",
) {
  await wrapper.get(`#analysis-tab-${key}`).trigger("click");
  const line = lineFor(wrapper, key);
  expect(line.props("showCurrentMonthShortcut")).toBe(true);
  expect(line.props("currentMonthDisabled")).toBe(false);
  expect(line.get(".chart-current-month").text()).toBe("回到本月");
  await line.get(".chart-current-month").trigger("click");
  await settle();
}
function expectCurrentMonth(
  wrapper: PanelWrapper,
  query = septemberQuery,
  amount = "2053235.4",
) {
  expect(wrapper.getComponent(DateRange).props("modelValue")).toEqual([
    query.from,
    query.to,
  ]);
  expect(wrapper.get('[aria-label="分析统计周期"]').element).toHaveProperty(
    "value",
    "month",
  );
  expect(wrapper.get(".displayed-query").text()).toContain(
    `${query.from} 至 ${query.to} · 月度`,
  );
  for (const key of keys) {
    const line = lineFor(wrapper, key);
    expect(line.props("windowEnd")).toBe(query.to);
    expect(line.props("fixedMonthWindow")).toBe(true);
    expect(line.props("continuousHistory")).toBe(true);
    expect(line.props("series")[0].values).toEqual(Array(12).fill(amount));
    expect(line.props("periods")).toEqual(periodsFor(query));
  }
}

describe("图表多指标比较旁回到本月", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-04T04:00:00Z"));
    mockRead
      .mockReset()
      .mockImplementation((query: FinancialAnalysisQuery) =>
        Promise.resolve(response(query)),
      );
    mockWindow
      .mockReset()
      .mockImplementation((query: FinancialAnalysisQuery) =>
        Promise.resolve(response(query)),
      );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("不依赖月报选中月份，点击图表按钮立即按上海本月最近十二月查询", async () => {
    const wrapper = await renderPanel({ selectedMonth: "2024-03" });
    expect(mockRead).toHaveBeenCalledTimes(1);
    await returnToCurrentMonth(wrapper);
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(mockRead).toHaveBeenLastCalledWith(
      septemberQuery,
      expect.any(AbortSignal),
    );
    expectCurrentMonth(wrapper);
    expect(wrapper.find(".pending-filter-note").exists()).toBe(false);
  });

  it.each(keys)(
    "%s活动模块都有图表入口并能立即查询，日期筛选区不再配置此按钮",
    async (key) => {
      const wrapper = await renderPanel();
      expect(
        wrapper
          .getComponent(DateRange)
          .attributes("show-current-month-shortcut"),
      ).toBeUndefined();
      expect(wrapper.get(".analysis-filters").text()).not.toContain("回到本月");
      expect(
        wrapper.get(".analysis-filters").find(".chart-current-month").exists(),
      ).toBe(false);
      expect(wrapper.findAll(".chart-current-month")).toHaveLength(7);
      await returnToCurrentMonth(wrapper, key);
      expect(mockRead).toHaveBeenCalledTimes(2);
      expect(mockRead).toHaveBeenLastCalledWith(
        septemberQuery,
        expect.any(AbortSignal),
      );
      expect(
        wrapper.get(`#analysis-tab-${key}`).attributes("aria-selected"),
      ).toBe("true");
      expectCurrentMonth(wrapper);
    },
  );

  it("保留未提交业务筛选与三年同比年差，但强制月度并立即查询", async () => {
    const wrapper = await renderPanel();
    await wrapper.get('[aria-label="测试开始月"]').setValue("2023-01");
    await wrapper.get('[aria-label="测试结束月"]').setValue("2023-12");
    await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
    await wrapper.get('[aria-label="分析对比年份"]').setValue("2020");
    const filters = {
      partyA: "合成甲方乙",
      contractRegion: "朝阳区",
      reimbursementScope: "朝阳区/商务",
      personId: "person-b",
    };
    await wrapper.get('[aria-label="分析甲方"]').setValue(filters.partyA);
    await wrapper
      .get('[aria-label="分析合同区域"]')
      .setValue(filters.contractRegion);
    wrapper
      .findComponent({ name: "ElCascader" })
      .vm.$emit("update:modelValue", filters.reimbursementScope);
    await settle();
    await wrapper.get('[aria-label="分析人员"]').setValue(filters.personId);
    expect(mockRead).toHaveBeenCalledTimes(1);
    await returnToCurrentMonth(wrapper, "projects");
    const expected = { ...septemberQuery, ...filters, comparisonYear: 2022 };
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(mockRead).toHaveBeenLastCalledWith(
      expected,
      expect.any(AbortSignal),
    );
    expectCurrentMonth(wrapper, expected);
    expect(wrapper.get('[aria-label="分析对比年份"]').element).toHaveProperty(
      "value",
      "2022",
    );
    expect(wrapper.get('[aria-label="分析甲方"]').element).toHaveProperty(
      "value",
      filters.partyA,
    );
    expect(wrapper.get('[aria-label="分析合同区域"]').element).toHaveProperty(
      "value",
      filters.contractRegion,
    );
    expect(
      wrapper.findComponent({ name: "ElCascader" }).props("modelValue"),
    ).toBe(filters.reimbursementScope);
    expect(wrapper.get('[aria-label="分析人员"]').element).toHaveProperty(
      "value",
      filters.personId,
    );
  });

  it("不对比保持为空，不擅自重新开启年度对比", async () => {
    const wrapper = await renderPanel();
    await wrapper.get('[aria-label="分析对比年份"]').setValue("");
    await wrapper.get('[aria-label="分析统计周期"]').setValue("year");
    await returnToCurrentMonth(wrapper);
    const expected: FinancialAnalysisQuery = {
      from: "2025-10",
      to: "2026-09",
      granularity: "month",
    };
    expect(mockRead).toHaveBeenLastCalledWith(
      expected,
      expect.any(AbortSignal),
    );
    expect(wrapper.get('[aria-label="分析对比年份"]').element).toHaveProperty(
      "value",
      "",
    );
    expectCurrentMonth(wrapper, expected);
    expect(lineFor(wrapper).props("comparisonSeries")).toEqual([]);
  });

  it.each([
    ["2026-09-30T15:59:59Z", "2025-10", "2026-09"],
    ["2026-09-30T16:00:00Z", "2025-11", "2026-10"],
    ["2026-12-31T16:00:00Z", "2026-02", "2027-01"],
  ])(
    "时刻%s以上海月份决定范围，不使用协调世界时月份",
    async (instant, from, to) => {
      jest.setSystemTime(new Date(instant));
      const wrapper = await renderPanel();
      await returnToCurrentMonth(wrapper);
      const expected: FinancialAnalysisQuery = {
        from,
        to,
        granularity: "month",
        comparisonYear: Number(from.slice(0, 4)) - 1,
      };
      expect(mockRead).toHaveBeenLastCalledWith(
        expected,
        expect.any(AbortSignal),
      );
      expectCurrentMonth(wrapper, expected);
    },
  );

  it("主查询已为最近十二月但图已滑到历史时，仍强制回本月不因同查询同版本跳过", async () => {
    const wrapper = await renderPanel();
    await returnToCurrentMonth(wrapper);
    lineFor(wrapper).vm.$emit(
      "window-change",
      financialTwelveMonthRange("2023-09"),
    );
    await settle();
    expect(lineFor(wrapper).props("windowEnd")).toBe("2023-09");
    expect(mockRead).toHaveBeenCalledTimes(2);
    await returnToCurrentMonth(wrapper);
    expect(mockRead).toHaveBeenCalledTimes(3);
    expect(mockRead.mock.calls[2][0]).toEqual(mockRead.mock.calls[1][0]);
    expectCurrentMonth(wrapper);
  });

  it.each(["成功", "权限拒绝"])(
    "回本月取消旧主请求，旧%s迟到不能覆盖新月份或清空授权结果",
    async (lateState) => {
      const wrapper = await renderPanel();
      const old = deferred<MonthlyFinancialAnalysisData>();
      mockRead.mockReturnValueOnce(old.promise);
      await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
      await wrapper.get("form").trigger("submit");
      await settle();
      const [oldQuery, oldSignal] = mockRead.mock.calls[1] as [
        FinancialAnalysisQuery,
        AbortSignal,
      ];
      await returnToCurrentMonth(wrapper);
      expect(oldSignal.aborted).toBe(true);
      expectCurrentMonth(wrapper);
      if (lateState === "成功") old.resolve(response(oldQuery, "999"));
      else old.reject({ response: { status: 403 } });
      await settle();
      expectCurrentMonth(wrapper);
      expect(wrapper.findAll(".analysis-module")).toHaveLength(7);
      expect(mockRead).toHaveBeenCalledTimes(3);
    },
  );

  it("回本月取消旧慢历史窗口，迟到金额不能覆盖主响应复用的十二月", async () => {
    const wrapper = await renderPanel();
    const old = deferred<MonthlyFinancialAnalysisData>();
    mockWindow.mockReturnValueOnce(old.promise);
    lineFor(wrapper).vm.$emit(
      "window-change",
      financialTwelveMonthRange("2023-09"),
    );
    await settle();
    const [oldQuery, oldSignal] = mockWindow.mock.calls.at(-1)! as [
      FinancialAnalysisQuery,
      AbortSignal,
    ];
    expect(oldSignal.aborted).toBe(false);
    await returnToCurrentMonth(wrapper);
    expect(oldSignal.aborted).toBe(true);
    expectCurrentMonth(wrapper);
    old.resolve(response(oldQuery, "999"));
    await settle();
    expectCurrentMonth(wrapper);
  });

  it("回本月同时取消独立年度余额请求，旧年度结果迟到不覆盖当前统计", async () => {
    const wrapper = await renderPanel();
    const oldYear = deferred<MonthlyFinancialAnalysisData>();
    mockWindow.mockImplementation((query: FinancialAnalysisQuery) =>
      query.from === "2026-01" &&
      query.to === "2026-09" &&
      query.comparisonYear === undefined
        ? oldYear.promise
        : Promise.resolve(response(query)),
    );
    await wrapper.get('[aria-label="测试开始月"]').setValue("2026-07");
    await wrapper.get("form").trigger("submit");
    await settle();
    const annual = mockWindow.mock.calls.find(
      ([query]) =>
        query.from === "2026-01" && query.comparisonYear === undefined,
    )!;
    expect(annual).toBeDefined();
    expect((annual[1] as AbortSignal).aborted).toBe(false);
    await returnToCurrentMonth(wrapper);
    expect((annual[1] as AbortSignal).aborted).toBe(true);
    oldYear.resolve(response(annual[0], "999"));
    await settle();
    expectCurrentMonth(wrapper);
    expect(
      wrapper.get('[data-module="balances"] .analysis-summaries').text(),
    ).toContain("¥2,053,235.40");
  });

  it("隐藏模块发出的回本月事件不查询，也不重置当前历史位置", async () => {
    const wrapper = await renderPanel();
    await wrapper.get("#analysis-tab-inflow").trigger("click");
    lineFor(wrapper, "inflow").vm.$emit(
      "window-change",
      financialTwelveMonthRange("2023-09"),
    );
    await settle();
    const calls = mockRead.mock.calls.length;
    const windowCalls = mockWindow.mock.calls.length;
    lineFor(wrapper, "projects").vm.$emit("current-month");
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(calls);
    expect(mockWindow).toHaveBeenCalledTimes(windowCalls);
    expect(lineFor(wrapper, "inflow").props("windowEnd")).toBe("2023-09");
    expect(
      wrapper.get("#analysis-tab-inflow").attributes("aria-selected"),
    ).toBe("true");
  });

  it("失活时图表快捷禁用，直接发事件也不能查询且卸载清理全部定时器", async () => {
    const wrapper = await renderPanel();
    await wrapper.setProps({ active: false });
    const line = lineFor(wrapper);
    expect(line.props("currentMonthDisabled")).toBe(true);
    const calls = mockRead.mock.calls.length;
    const windowCalls = mockWindow.mock.calls.length;
    line.vm.$emit("current-month");
    await settle();
    jest.advanceTimersByTime(1000);
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(calls);
    expect(mockWindow).toHaveBeenCalledTimes(windowCalls);
  });
});
