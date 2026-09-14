const mockRead = jest.fn();
const mockWindow = jest.fn();
const mockDownload = jest.fn();
jest.mock("@/utils/monthlyFinancialAnalysisApi", () => ({
  getMonthlyFinancialAnalysis: (...args: unknown[]) => mockRead(...args),
  getMonthlyFinancialAnalysisWindow: (...args: unknown[]) =>
    mockWindow(...args),
  downloadMonthlyFinancialAnalysis: (...args: unknown[]) =>
    mockDownload(...args),
}));
jest.mock(
  "@/components/monthly-financial/MonthlyFinancialDateRange.vue",
  () => ({
    __esModule: true,
    default: {
      props: ["modelValue", "popperAppendTo"],
      emits: ["update:modelValue"],
      methods: { close: jest.fn() },
      template: `<div><input aria-label="测试开始月" :value="modelValue[0]" @input="$emit('update:modelValue', [$event.target.value, modelValue[1]])" /><input aria-label="测试结束月" :value="modelValue[1]" @input="$emit('update:modelValue', [modelValue[0], $event.target.value])" /></div>`,
    },
  }),
);
// 此处只验证面板加载调度，像素滑动、刻度及金额坐标由真实图表专项覆盖。
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
        "comparisonVisible",
        "fixedMonthWindow",
        "continuousHistory",
        "quarterHistory",
        "periodView",
        "windowEnd",
        "historyLoading",
        "historyError",
        "items",
      ],
      emits: ["window-change", "point-select"],
      template: `<section :data-chart-type="type"><h4>{{ title }}</h4></section>`,
    },
  }),
);

import { nextTick } from "vue";
import Panel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import Chart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import {
  financialMonthOffset,
  financialTwelveMonthRange,
  financialTwelveQuarterRange,
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
const moduleKeys: FinancialAnalysisModuleKey[] = [
  "balances",
  "inflow",
  "outflow",
  "projects",
  "settlement",
  "business",
  "personnel",
];
const initialRange = { from: "2025-10", to: "2026-09" };

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
  const groups = new Map<string, FinancialAnalysisPeriod>();
  for (
    let month = query.from;
    month <= query.to;
    month = financialMonthOffset(month, 1)
  ) {
    const key =
      query.granularity === "year"
        ? month.slice(0, 4)
        : query.granularity === "quarter"
          ? month.slice(0, 4) + "-Q" + Math.ceil(Number(month.slice(5)) / 3)
          : month;
    const previous = groups.get(key);
    if (previous) previous.to = month;
    else groups.set(key, { key, label: key, from: month, to: month });
  }
  return [...groups.values()];
}
function amountFor(
  period: FinancialAnalysisPeriod,
  marker: string,
): string | null {
  if (period.to.endsWith("-02")) return "0";
  if (period.to.endsWith("-04")) return null;
  return marker + period.to.replace("-", "") + ".123456789012";
}
function response(
  query: FinancialAnalysisQuery,
  marker = "10",
): MonthlyFinancialAnalysisData {
  const periods = periodsFor(query);
  const values = periods.map((period) => amountFor(period, marker));
  const data: MonthlyFinancialAnalysisData = {
    query: { ...query },
    generatedAt: "2026-09-04T00:00:00Z",
    dataVersion: "合成版本" + marker,
    filterOptions: {
      parties: ["甲方乙"],
      contractRegions: ["朝阳区"],
      reimbursementScopes: ["朝阳区/商务"],
      people: [{ id: "person-b", name: "合成人员乙" }],
    },
    modules: moduleKeys.map((key) => ({
      key,
      title: key,
      description: "历史加载合成数据",
      sourceLabel: "合成来源",
      updatedAt: "2026-09-04T00:00:00Z",
      periods,
      series: [{ key: "total", label: "精确金额", values }],
      summaries: [{ key: "total", label: "统计总额", amount: "2053235.4" }],
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
    const delta = (query.comparisonYear - Number(query.from.slice(0, 4))) * 12;
    const previous = {
      ...query,
      from: financialMonthOffset(query.from, delta),
      to: financialMonthOffset(query.to, delta),
    };
    delete previous.comparisonYear;
    data.comparison = {
      label: "合成同期",
      query: previous,
      modules: response(previous, marker).modules,
      warnings: [],
    };
  }
  return data;
}
function payrollResponse(
  query: FinancialAnalysisQuery,
  visible: boolean,
  marker = "10",
) {
  const data = response(query, marker);
  for (const modules of [data.modules, data.comparison?.modules || []]) {
    const personnel = modules.find((module) => module.key === "personnel");
    if (!personnel) continue;
    personnel.payrollDetailsVisible = visible;
    if (visible)
      personnel.series.push({
        key: "salary",
        label: "受保护工资",
        values: personnel.periods.map(() => "98765.432109876543"),
      });
  }
  return data;
}
async function settle() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
const windows: Array<{
  query: FinancialAnalysisQuery;
  signal: AbortSignal;
  result: ReturnType<typeof deferred<MonthlyFinancialAnalysisData>>;
}> = [];
const wrappers: PanelWrapper[] = [];
function lineFor(
  wrapper: PanelWrapper,
  key: FinancialAnalysisModuleKey = "inflow",
) {
  return wrapper
    .get(`[data-module="${key}"]`)
    .findAllComponents(Chart)
    .find((item) => item.props("type") === "line")!;
}
async function renderPanel() {
  const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
  wrappers.push(wrapper);
  await settle();
  return wrapper;
}
async function complete(index: number, marker = "10") {
  windows[index].result.resolve(response(windows[index].query, marker));
  await settle();
}
async function move(wrapper: PanelWrapper, end: string, quarter = false) {
  const range = quarter
    ? financialTwelveQuarterRange(end, "2026-09")
    : financialTwelveMonthRange(end);
  lineFor(wrapper).vm.$emit("window-change", range);
  await settle();
  return range;
}
function visibleValues(
  wrapper: PanelWrapper,
  key: FinancialAnalysisModuleKey = "inflow",
) {
  const line = lineFor(wrapper, key);
  const periods = line.props("periods") as FinancialAnalysisPeriod[];
  const values = line.props("series")[0].values as Array<string | null>;
  const range = line.props("quarterHistory")
    ? financialTwelveQuarterRange(line.props("windowEnd"), "2026-09")
    : financialTwelveMonthRange(line.props("windowEnd"));
  // 面板可把整份缓存传给图表；只核对受控十二期窗口内的金额，不强迫复制切片。
  return periods.flatMap((period, index) =>
    period.from >= range.from && period.to <= range.to
      ? [{ period: period.key, amount: values[index] }]
      : [],
  );
}
function expectVisible(
  wrapper: PanelWrapper,
  range: { from: string; to: string },
  marker = "10",
  quarter = false,
) {
  const expectedPeriods = periodsFor({
    ...range,
    granularity: quarter ? "quarter" : "month",
  });
  for (const key of moduleKeys) {
    expect(visibleValues(wrapper, key)).toEqual(
      expectedPeriods.map((period) => ({
        period: period.key,
        amount: amountFor(period, marker),
      })),
    );
    expect(lineFor(wrapper, key).props("historyLoading")).toBe(false);
  }
}

describe("历史图表慢请求与有界缓存调度", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRead
      .mockReset()
      .mockImplementation((query: FinancialAnalysisQuery) =>
        Promise.resolve(response(query)),
      );
    mockWindow
      .mockReset()
      .mockImplementation(
        (query: FinancialAnalysisQuery, signal: AbortSignal) => {
          const result = deferred<MonthlyFinancialAnalysisData>();
          windows.push({ query: { ...query }, signal, result });
          return result.promise;
        },
      );
    mockDownload.mockReset();
    windows.length = 0;
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

  it("首屏仅请求精确十二月，成功后350毫秒预取邻窗且不遮挡已知金额", async () => {
    const wrapper = await renderPanel();
    expect(windows).toHaveLength(1);
    expect(windows[0].query).toMatchObject({
      ...initialRange,
      granularity: "month",
      comparisonYear: 2024,
    });
    jest.advanceTimersByTime(1000);
    await settle();
    expect(windows).toHaveLength(1);
    await complete(0);
    expectVisible(wrapper, initialRange);
    jest.advanceTimersByTime(349);
    await settle();
    expect(windows).toHaveLength(1);
    jest.advanceTimersByTime(1);
    await settle();
    expect(windows).toHaveLength(2);
    expect(windows[1].query).toMatchObject({
      from: "2024-10",
      to: "2026-09",
      comparisonYear: 2023,
    });
    expectVisible(wrapper, initialRange);
    const visibleReferences = moduleKeys.map((key) => ({
      series: lineFor(wrapper, key).props("series"),
      periods: lineFor(wrapper, key).props("periods"),
    }));
    await complete(1);
    expectVisible(wrapper, initialRange);
    moduleKeys.forEach((key, index) => {
      expect(lineFor(wrapper, key).props("series")).toBe(
        visibleReferences[index].series,
      );
      expect(lineFor(wrapper, key).props("periods")).toBe(
        visibleReferences[index].periods,
      );
    });
    jest.advanceTimersByTime(350);
    await settle();
    expect(windows).toHaveLength(2);
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09",
    );
    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it("新缺口立即请求缓冲，不等待180毫秒，连续滑入同个未完成缓冲不取消或重发", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    await move(wrapper, "2026-08");
    expect(windows).toHaveLength(2);
    expect(windows[1].query).toMatchObject({ from: "2024-09", to: "2026-09" });
    const request = windows[1];
    const finalRange = await move(wrapper, "2026-07");
    expect(windows).toHaveLength(2);
    expect(request.signal.aborted).toBe(false);
    expect(lineFor(wrapper).props("historyLoading")).toBe(true);
    await complete(1, "11");
    expectVisible(wrapper, finalRange, "11");
    expect(lineFor(wrapper).props("windowEnd")).toBe("2026-07");
  });

  it("滑入正在预取的缓冲直接等待该请求，成功时按最新窗口显示而不回跳", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    jest.advanceTimersByTime(350);
    await settle();
    const request = windows[1];
    await move(wrapper, "2026-08");
    const latest = await move(wrapper, "2026-06");
    expect(windows).toHaveLength(2);
    expect(request.signal.aborted).toBe(false);
    await complete(1);
    expectVisible(wrapper, latest);
  });

  it("已缓存窗口同步显示，无额外请求且真实零未知和高精度金额保持", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    jest.advanceTimersByTime(350);
    await settle();
    await complete(1);
    const before = windows.length;
    const range = await move(wrapper, "2026-03");
    expect(windows).toHaveLength(before);
    expectVisible(wrapper, range);
    expect(visibleValues(wrapper)).toContainEqual({
      period: "2026-02",
      amount: "0",
    });
    expect(visibleValues(wrapper)).toContainEqual({
      period: "2025-04",
      amount: null,
    });
    await move(wrapper, "2026-09");
    expect(windows).toHaveLength(before);
    expectVisible(wrapper, initialRange);
  });

  it("跳出在途缓冲取消旧请求，旧成功结果不得覆盖新窗口", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    await move(wrapper, "2026-08");
    const old = windows[1];
    const latest = await move(wrapper, "2023-09");
    expect(windows).toHaveLength(3);
    expect(old.signal.aborted).toBe(true);
    await complete(2, "22");
    expectVisible(wrapper, latest, "22");
    await complete(1, "99");
    expectVisible(wrapper, latest, "22");
  });

  it("后台预取网络失败保留可见数据，进入未缓存区域才重试并显示加载态", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    jest.advanceTimersByTime(350);
    await settle();
    windows[1].result.reject(new Error("合成网络暂时断开"));
    await settle();
    expectVisible(wrapper, initialRange);
    expect(lineFor(wrapper).props("historyError")).toBe("");
    await move(wrapper, "2026-08");
    expect(windows).toHaveLength(3);
    expect(lineFor(wrapper).props("historyLoading")).toBe(true);
    await complete(2);
    expectVisible(wrapper, { from: "2025-09", to: "2026-08" });
  });

  it("慢预取在途时一分钟轮询不重叠，预取完成后下一轮正常刷新", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    jest.advanceTimersByTime(350);
    await settle();
    const pending = windows[1];
    jest.advanceTimersByTime(59_650);
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(1);
    expect(pending.signal.aborted).toBe(false);
    expectVisible(wrapper, initialRange);
    await complete(1);
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it("历史缓存有界，四份新缓冲替换旧记录后返回首屏需要重新读取", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    for (const end of ["2023-09", "2020-09", "2017-09", "2014-09"]) {
      await move(wrapper, end);
      await complete(windows.length - 1);
    }
    expect(windows).toHaveLength(5);
    await move(wrapper, "2026-09");
    expect(windows).toHaveLength(6);
    expect(lineFor(wrapper).props("historyLoading")).toBe(true);
    await complete(5, "22");
    expectVisible(wrapper, initialRange, "22");
  });

  it.each([
    ["分析甲方", "甲方乙", "partyA"],
    ["分析合同区域", "朝阳区", "contractRegion"],
    ["分析商务报销范围", "朝阳区/商务", "reimbursementScope"],
    ["分析人员", "person-b", "personId"],
    ["分析对比年份", "2024", "comparisonYear"],
  ])("提交%s后不复用旧上下文缓存或迟到数据", async (label, value, field) => {
    const wrapper = await renderPanel();
    await complete(0);
    jest.advanceTimersByTime(350);
    await settle();
    const old = windows[1];
    if (label === "分析商务报销范围") {
      wrapper
        .findComponent({ name: "ElCascader" })
        .vm.$emit("update:modelValue", value);
      await settle();
    } else await wrapper.get(`[aria-label="${label}"]`).setValue(value);
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(old.signal.aborted).toBe(true);
    expect(windows).toHaveLength(3);
    expect(windows[2].query[field as keyof FinancialAnalysisQuery]).toBe(
      field === "comparisonYear" ? 2023 : value,
    );
    await complete(2, "22");
    await complete(1, "99");
    expectVisible(wrapper, initialRange, "22");
  });

  it("季度先精确十二季后预取十二季，切年度取消预取且不混入月季度缓存", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(windows).toHaveLength(2);
    expect(windows[1].query).toMatchObject({
      from: "2023-10",
      to: "2026-09",
      granularity: "quarter",
      comparisonYear: 2022,
    });
    await complete(1);
    expectVisible(wrapper, { from: "2023-10", to: "2026-09" }, "10", true);
    jest.advanceTimersByTime(350);
    await settle();
    expect(windows[2].query).toMatchObject({
      from: "2020-10",
      to: "2026-09",
      granularity: "quarter",
      comparisonYear: 2019,
    });
    await wrapper.get('[aria-label="分析统计周期"]').setValue("year");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(windows[2].signal.aborted).toBe(true);
    expect(lineFor(wrapper).props("periodView")).toBe(true);
    expect(lineFor(wrapper).props("periods")).toHaveLength(1);
    await complete(2, "99");
    expect(lineFor(wrapper).props("periods")).toHaveLength(1);
    expect(lineFor(wrapper).props("series")[0].values).toEqual([
      "10202609.123456789012",
    ]);
  });

  it("来源刷新清理缓存，在途旧权限错误不得清空新来源", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    jest.advanceTimersByTime(350);
    await settle();
    await wrapper.setProps({ refreshKey: 1 });
    await settle();
    expect(windows[1].signal.aborted).toBe(true);
    expect(windows).toHaveLength(3);
    await complete(2, "22");
    windows[1].result.reject({ response: { status: 403 } });
    await settle();
    expect(wrapper.findAll(".analysis-module")).toHaveLength(7);
    expectVisible(wrapper, initialRange, "22");
  });

  it.each([401, 403])(
    "预取收到%d权限错误也清空已显示数据及缓存，重新查询不得复用",
    async (status) => {
      const wrapper = await renderPanel();
      await complete(0);
      jest.advanceTimersByTime(350);
      await settle();
      windows[1].result.reject({ response: { status } });
      await settle();
      expect(wrapper.findAll(".analysis-module")).toHaveLength(0);
      expect(wrapper.text()).toContain("权限已失效");
      await wrapper.get("form").trigger("submit");
      await settle();
      expect(windows).toHaveLength(3);
      await complete(2, "22");
      expectVisible(wrapper, initialRange, "22");
    },
  );

  it("成功响应中工资权限降级也立即清空旧显示缓存，重读主查询且迟到高权限结果不恢复", async () => {
    const refreshed = deferred<MonthlyFinancialAnalysisData>();
    mockRead
      .mockImplementationOnce((query: FinancialAnalysisQuery) =>
        Promise.resolve(payrollResponse(query, true)),
      )
      .mockImplementationOnce(() => refreshed.promise);
    const wrapper = await renderPanel();
    // 留下一份会迟到的旧高权限响应，首次滑动确实越过它的覆盖区并取消。
    await move(wrapper, "2026-08");
    expect(windows[0].signal.aborted).toBe(true);
    windows[1].result.resolve(payrollResponse(windows[1].query, true));
    await settle();
    expect(
      lineFor(wrapper, "personnel")
        .props("series")
        .some((series: { key: string }) => series.key === "salary"),
    ).toBe(true);
    await move(wrapper, "2025-10");
    jest.advanceTimersByTime(350);
    await settle();
    expect(windows).toHaveLength(3);
    expect(lineFor(wrapper).props("historyLoading")).toBe(false);
    windows[2].result.resolve(payrollResponse(windows[2].query, false));
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(2);
    expect(mockRead.mock.calls[1][0]).toEqual({
      from: "2026-01",
      to: "2026-09",
      granularity: "month",
      comparisonYear: 2025,
    });
    expect(wrapper.findAll(".analysis-module")).toHaveLength(0);
    windows[0].result.resolve(payrollResponse(windows[0].query, true, "99"));
    await settle();
    expect(wrapper.findAll(".analysis-module")).toHaveLength(0);
    refreshed.resolve(payrollResponse(mockRead.mock.calls[1][0], false, "22"));
    await settle();
    expect(windows).toHaveLength(4);
    windows[3].result.resolve(payrollResponse(windows[3].query, false, "22"));
    await settle();
    expect(
      lineFor(wrapper, "personnel")
        .props("series")
        .map((series: { key: string }) => series.key),
    ).toEqual(["total"]);
    expect(
      lineFor(wrapper, "personnel")
        .props("comparisonSeries")
        .map((series: { key: string }) => series.key),
    ).toEqual(["total"]);
    await move(wrapper, "2025-10");
    expect(windows).toHaveLength(5);
    expect(
      lineFor(wrapper, "personnel")
        .props("series")
        .some((series: { key: string }) => series.key === "salary"),
    ).toBe(false);
  });

  it("主统计成功响应直接降权时立即移除旧工资图，不等待新的历史窗口完成", async () => {
    mockRead.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(payrollResponse(query, true)),
    );
    const wrapper = await renderPanel();
    windows[0].result.resolve(payrollResponse(windows[0].query, true));
    await settle();
    expect(
      lineFor(wrapper, "personnel")
        .props("series")
        .some((series: { key: string }) => series.key === "salary"),
    ).toBe(true);
    jest.advanceTimersByTime(350);
    await settle();
    mockRead.mockImplementationOnce((query: FinancialAnalysisQuery) =>
      Promise.resolve(payrollResponse(query, false, "22")),
    );
    await wrapper.setProps({ refreshKey: 1 });
    await settle();
    expect(windows[1].signal.aborted).toBe(true);
    expect(windows).toHaveLength(3);
    expect(mockRead.mock.calls[1][0]).toEqual(mockRead.mock.calls[0][0]);
    expect(
      lineFor(wrapper, "personnel")
        .props("series")
        .map((series: { key: string }) => series.key),
    ).toEqual(["total"]);
    expect(
      lineFor(wrapper, "personnel")
        .props("series")[0]
        .values.every((value: string | null) => value === null),
    ).toBe(true);
    expect(
      lineFor(wrapper, "personnel")
        .props("comparisonSeries")
        .some((series: { key: string }) => series.key === "salary"),
    ).toBe(false);
    windows[1].result.resolve(payrollResponse(windows[1].query, true, "99"));
    await settle();
    expect(
      lineFor(wrapper, "personnel")
        .props("series")
        .map((series: { key: string }) => series.key),
    ).toEqual(["total"]);
    windows[2].result.resolve(payrollResponse(windows[2].query, false, "22"));
    await settle();
    expectVisible(wrapper, initialRange, "22");
    expect(
      lineFor(wrapper, "personnel")
        .props("series")
        .map((series: { key: string }) => series.key),
    ).toEqual(["total"]);
  });

  it("失活取消定时预取及慢请求，重新激活会重查，迟到响应不恢复旧缓存", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    await wrapper.setProps({ active: false });
    jest.advanceTimersByTime(350);
    await settle();
    expect(windows).toHaveLength(1);
    await wrapper.setProps({ active: true });
    await settle();
    expect(windows).toHaveLength(2);
    await wrapper.setProps({ active: false });
    expect(windows[1].signal.aborted).toBe(true);
    await complete(1, "99");
    await wrapper.setProps({ active: true });
    await settle();
    expect(windows).toHaveLength(3);
    await complete(2, "22");
    expectVisible(wrapper, initialRange, "22");
  });

  it("卸载取消预取和所有定时器，迟到成功或错误均不得再发请求", async () => {
    const wrapper = await renderPanel();
    await complete(0);
    jest.advanceTimersByTime(350);
    await settle();
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(windows[1].signal.aborted).toBe(true);
    await complete(1, "99");
    jest.advanceTimersByTime(1000);
    await settle();
    expect(windows).toHaveLength(2);
    expect(jest.getTimerCount()).toBe(0);
  });
});
