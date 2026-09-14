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
      template: `<div><input aria-label="分析开始月份" :value="modelValue[0]" @input="$emit('update:modelValue', [$event.target.value, modelValue[1]])" /><input aria-label="分析结束月份" :value="modelValue[1]" @input="$emit('update:modelValue', [modelValue[0], $event.target.value])" /></div>`,
    },
  }),
);

import { nextTick } from "vue";
import MonthlyFinancialAnalysisPanel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import type {
  FinancialAnalysisModule,
  FinancialAnalysisModuleKey,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";
import {
  financialTwelveMonthRange,
  financialTwelveQuarterRange,
  financialWindowQuery,
} from "@/utils/monthlyFinancialAnalysisWindow";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const titles: Record<FinancialAnalysisModuleKey, string> = {
  balances: "账户余额资金台帐",
  inflow: "一般账户入账统计",
  outflow: "一般账户出账统计",
  projects: "项目分析",
  settlement: "收支结余汇总",
  business: "商务统计",
  personnel: "人力成本分析",
};
const defaultQuery: FinancialAnalysisQuery = {
  from: "2026-01",
  to: "2026-09",
  granularity: "month",
  comparisonYear: 2025,
};
const periods = [
  { key: "2026-08", label: "2026年8月", from: "2026-08", to: "2026-08" },
  { key: "2026-09", label: "2026年9月", from: "2026-09", to: "2026-09" },
];

function moduleData(key: FinancialAnalysisModuleKey): FinancialAnalysisModule {
  return {
    key,
    title: titles[key],
    description: "仅统计可核验业务事实，未知数据不按零处理。",
    sourceLabel: "已月结快照／当前业务台账",
    updatedAt: "2026-09-02T04:00:00.000Z",
    periods,
    summaries: [{ key: "amount", label: "统计金额", amount: "2053235.4" }],
    series: [{ key: "amount", label: "统计金额", values: ["0", "2053235.4"] }],
    breakdown: ["balances", "outflow", "business", "personnel"].includes(key)
      ? [
          { key: "one", label: "第一分类", amount: "0.1" },
          { key: "two", label: "第二分类", amount: "0.2" },
        ]
      : [],
    comparison: ["business", "personnel"].includes(key)
      ? [{ key: "one", label: "历史离职人员甲", amount: "2053235.4" }]
      : [],
    columns: [
      { key: "description", label: "来源说明", format: "text" },
      { key: "amount", label: "金额", format: "amount" },
      { key: "sourceId", label: "业务来源编号", format: "text" },
    ],
    details: [
      {
        id: `${key}-1`,
        description: "已核验历史记录",
        amount: "2053235.4",
        sourceId: "来源-1",
      },
    ],
    warnings: ["历史缺月保留未知值。"],
    appliedFilters: ["时间：2026-01 至 2026-09"],
  };
}

function response(
  query: FinancialAnalysisQuery = defaultQuery,
): MonthlyFinancialAnalysisData {
  return {
    query: { ...query },
    generatedAt: "2026-09-02T04:10:00.000Z",
    dataVersion: "精确数据版本-1",
    filterOptions: {
      parties: ["甲方甲", "甲方乙"],
      contractRegions: ["朝阳区", "海淀区"],
      reimbursementScopes: ["区域商务", "项目商务"],
      people: [{ id: "person-a", name: "历史离职人员甲" }],
    },
    modules: (Object.keys(titles) as FinancialAnalysisModuleKey[]).map(
      moduleData,
    ),
    warnings: ["来源缺失时不会伪造完整数据。"],
  };
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
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

describe("财务七模块分析面板", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAnalysis.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(response(query)),
    );
    mockGetWindowAnalysis.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(response(query)),
    );
    mockDownloadAnalysis.mockResolvedValue({
      blob: new Blob(["已导出"]),
      fileName: "财务分析.xlsx",
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("月度图表单独加载12个月，滑动不改变统计与导出", async () => {
    jest.useFakeTimers();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:窗口验收"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09", comparisonYears: [2021, 2025, 2026] },
    });
    await settle();
    expect(mockGetWindowAnalysis).toHaveBeenCalledWith(
      {
        from: "2025-10",
        to: "2026-09",
        granularity: "month",
        comparisonYear: 2024,
      },
      expect.any(AbortSignal),
    );
    const line = wrapper
      .get('[data-module="balances"]')
      .findAllComponents(MonthlyFinancialAnalysisChart)
      .find((item) => item.props("type") === "line")!;
    expect(line.props("fixedMonthWindow")).toBe(true);
    expect(line.props("continuousHistory")).toBe(true);
    expect(wrapper.get("#analysis-tab-balances").text()).toBe(
      "账户余额资金台帐",
    );
    const otherLines = wrapper
      .findAllComponents(MonthlyFinancialAnalysisChart)
      .filter(
        (chart) =>
          chart.props("type") === "line" &&
          chart !== line &&
          chart.props("title") !== line.props("title"),
      );
    expect(otherLines.length).toBe(6);
    expect(
      otherLines.filter(
        (chart) => chart.props("title") === "本月回款 · 月度趋势",
      ).length,
    ).toBe(0);
    expect(
      wrapper
        .get('[data-module="projects"]')
        .findAllComponents(MonthlyFinancialAnalysisChart)
        .filter((chart) => chart.props("type") === "line"),
    ).toHaveLength(1);
    expect(
      otherLines.every((chart) => chart.props("continuousHistory") === true),
    ).toBe(true);
    line.vm.$emit("window-change", { from: "2024-10", to: "2025-09" });
    jest.advanceTimersByTime(180);
    await settle();
    expect(mockGetWindowAnalysis).toHaveBeenLastCalledWith(
      {
        from: "2023-10",
        to: "2026-09",
        granularity: "month",
        comparisonYear: 2022,
      },
      expect.any(AbortSignal),
    );
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09 · 月度",
    );
    expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
      defaultQuery,
      "all",
      "精确数据版本-1",
    );
    wrapper.unmount();
  });

  it("点击用当前窗口统计才更新卡片明细范围并同步对比年差", async () => {
    jest.useFakeTimers();
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    const line = wrapper
      .get('[data-module="balances"]')
      .findAllComponents(MonthlyFinancialAnalysisChart)
      .find((item) => item.props("type") === "line")!;
    line.vm.$emit("window-change", { from: "2024-10", to: "2025-09" });
    jest.advanceTimersByTime(180);
    await settle();
    await wrapper.get(".apply-window-statistics").trigger("click");
    await settle();
    expect(mockGetAnalysis).toHaveBeenLastCalledWith(
      {
        from: "2024-10",
        to: "2025-09",
        granularity: "month",
        comparisonYear: 2023,
      },
      expect.any(AbortSignal),
    );
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2024-10 至 2025-09",
    );
    wrapper.unmount();
  });

  it("历史窗口迟到响应不能覆盖后滑到的窗口，卸载终止请求", async () => {
    jest.useFakeTimers();
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    const first = deferred<MonthlyFinancialAnalysisData>();
    const second = deferred<MonthlyFinancialAnalysisData>();
    mockGetWindowAnalysis
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const line = wrapper
      .get('[data-module="balances"]')
      .findAllComponents(MonthlyFinancialAnalysisChart)
      .find((item) => item.props("type") === "line")!;
    line.vm.$emit("window-change", { from: "2024-10", to: "2025-09" });
    jest.advanceTimersByTime(180);
    await settle();
    const firstSignal = mockGetWindowAnalysis.mock.calls.at(
      -1,
    )![1] as AbortSignal;
    const firstQuery = mockGetWindowAnalysis.mock.calls.at(
      -1,
    )![0] as FinancialAnalysisQuery;
    // 必须真正跳出第一份缓冲，覆盖内的相邻滑动按新约定复用请求而不取消。
    line.vm.$emit("window-change", { from: "2021-10", to: "2022-09" });
    jest.advanceTimersByTime(180);
    await settle();
    const latestQuery = mockGetWindowAnalysis.mock.calls.at(
      -1,
    )![0] as FinancialAnalysisQuery;
    const latest = response(latestQuery);
    latest.modules[0].series[0].values = ["333", "444"];
    second.resolve(latest);
    await settle();
    first.resolve(response(firstQuery));
    await settle();
    expect(firstSignal.aborted).toBe(true);
    expect(line.props("series")[0].values).toEqual(["333", "444"]);
    expect(line.props("windowEnd")).toBe("2022-09");
    const last = deferred<MonthlyFinancialAnalysisData>();
    mockGetWindowAnalysis.mockReturnValueOnce(last.promise);
    line.vm.$emit("window-change", { from: "2018-10", to: "2019-09" });
    jest.advanceTimersByTime(180);
    await settle();
    const lastSignal = mockGetWindowAnalysis.mock.calls.at(
      -1,
    )![1] as AbortSignal;
    wrapper.unmount();
    expect(lastSignal.aborted).toBe(true);
    last.resolve(response());
    await settle();
  });

  it.each(["加载中", "读取失败"])(
    "从季度切回月度后窗口%s时不把旧季度合计画成首月金额",
    async (state) => {
      const wrapper = mount(MonthlyFinancialAnalysisPanel, {
        props: { selectedMonth: "2026-09" },
      });
      await settle();
      const quarterly = response({ ...defaultQuery, granularity: "quarter" });
      quarterly.modules = quarterly.modules.map((module) => ({
        ...module,
        periods: [
          {
            key: "2026-Q3",
            label: "2026年第3季度",
            from: "2026-07",
            to: "2026-09",
          },
        ],
        series: module.series.map((series) => ({
          ...series,
          values: ["987654.32"],
        })),
      }));
      mockGetAnalysis.mockResolvedValueOnce(quarterly);
      await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
      await wrapper.get("form").trigger("submit");
      await settle();
      const pending = deferred<MonthlyFinancialAnalysisData>();
      if (state === "读取失败")
        mockGetWindowAnalysis.mockRejectedValueOnce(
          new Error("月度窗口读取失败"),
        );
      else mockGetWindowAnalysis.mockReturnValueOnce(pending.promise);
      await wrapper.get('[aria-label="分析统计周期"]').setValue("month");
      await wrapper.get("form").trigger("submit");
      await settle();
      const line = wrapper
        .get('[data-module="balances"]')
        .findAllComponents(MonthlyFinancialAnalysisChart)
        .find((item) => item.props("type") === "line")!;
      expect(line.props("periods")).toHaveLength(12);
      expect(
        line
          .props("series")
          .every(
            (series: { values: Array<string | null> }) =>
              series.values.length === 12 &&
              series.values.every((value) => value === null),
          ),
      ).toBe(true);
      expect(wrapper.get(".displayed-query").text()).toContain("月度");
      if (state === "读取失败")
        expect(line.props("historyError")).toContain("读取失败");
      wrapper.unmount();
      pending.resolve(response());
      await settle();
    },
  );

  it.each([401, 403])(
    "历史窗口返回%d时清理统计、图表和下载缓存",
    async (status) => {
      jest.useFakeTimers();
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: jest.fn(() => "blob:窗口权限"),
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: jest.fn(),
      });
      jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      const wrapper = mount(MonthlyFinancialAnalysisPanel, {
        props: { selectedMonth: "2026-09" },
      });
      await settle();
      await wrapper.get(".analysis-header button").trigger("click");
      await settle();
      expect(wrapper.find(".export-ready").exists()).toBe(true);
      mockGetWindowAnalysis.mockRejectedValueOnce({ response: { status } });
      const line = wrapper
        .get('[data-module="balances"]')
        .findAllComponents(MonthlyFinancialAnalysisChart)
        .find((item) => item.props("type") === "line")!;
      line.vm.$emit("window-change", { from: "2024-10", to: "2025-09" });
      jest.advanceTimersByTime(180);
      await settle();
      expect(wrapper.findAll(".analysis-module")).toHaveLength(0);
      expect(wrapper.find(".export-ready").exists()).toBe(false);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:窗口权限");
      expect(wrapper.text()).toContain("登录或查看权限已失效");
      wrapper.unmount();
    },
  );

  it("默认上年对比且一次只展示一个模块，校验说明默认折叠", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09", comparisonYears: [2021, 2025, 2026] },
    });
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledWith(
      defaultQuery,
      expect.any(AbortSignal),
    );
    expect(wrapper.get('[aria-label="分析对比年份"]').element).toHaveProperty(
      "value",
      "2025",
    );
    expect(wrapper.findAll('.analysis-navigation [role="tab"]')).toHaveLength(
      7,
    );
    expect(
      wrapper.findAll(".analysis-module").filter((card) => card.isVisible()),
    ).toHaveLength(1);
    expect(wrapper.get('[data-module="balances"]').isVisible()).toBe(true);
    expect(wrapper.get(".global-notes").attributes("open")).toBeUndefined();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    expect(wrapper.get('[data-module="balances"]').isVisible()).toBe(false);
    expect(wrapper.get('[data-module="projects"]').isVisible()).toBe(true);
    expect(wrapper.get('[aria-label="分析甲方"]').isVisible()).toBe(true);
    expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("对比数据和精准金额仍传入主图，但不再挂载对比期金额表", async () => {
    const result = response();
    const previous = moduleData("balances");
    previous.periods = periods.map((period) => ({
      ...period,
      key: period.key.replace("2026", "2025"),
      label: period.label.replace("2026", "2025"),
      from: period.from.replace("2026", "2025"),
      to: period.to.replace("2026", "2025"),
    }));
    previous.series[0].values = ["0", "1234.56789"];
    result.comparison = {
      label: "2025年同期",
      query: { from: "2025-01", to: "2025-09", granularity: "month" },
      modules: [previous],
      warnings: [],
    };
    mockGetAnalysis.mockResolvedValueOnce(result);
    mockGetWindowAnalysis.mockResolvedValueOnce({
      ...result,
      query: financialWindowQuery(
        result.query,
        financialTwelveMonthRange(result.query.to),
      ),
    });
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    const current = wrapper.get('[data-module="balances"]');
    const line = current
      .findAllComponents(MonthlyFinancialAnalysisChart)
      .find((chart) => chart.props("type") === "line")!;
    expect(line.props("comparisonSeries")).toEqual(previous.series);
    expect(line.props("comparisonPeriods")).toEqual(previous.periods);
    expect(current.find(".analysis-period-table").exists()).toBe(false);
    expect(line.text()).toContain("¥1,234.56789");
    await wrapper.get('[aria-label="分析对比年份"]').setValue("");
    await wrapper.get("form").trigger("submit");
    await settle();
    const withoutComparison = { ...defaultQuery };
    delete withoutComparison.comparisonYear;
    expect(mockGetAnalysis).toHaveBeenLastCalledWith(
      withoutComparison,
      expect.any(AbortSignal),
    );
    wrapper.unmount();
  });

  it("七模块不挂载旧四折叠区，图表、统计卡和精准金额仍保留", async () => {
    const result = response();
    result.modules[0].summaries.push({
      key: "exact",
      label: "大金额原值",
      amount: "999999999999999999.123456789012",
    });
    result.modules[0].summaries.push({
      key: "unknown",
      label: "未核算余额",
      amount: null,
    });
    result.comparison = {
      label: "2025年同期",
      query: { from: "2025-01", to: "2025-09", granularity: "month" },
      modules: result.modules.map((module) => ({
        ...module,
        periods: module.periods.map((period) => ({
          ...period,
          key: period.key.replace("2026", "2025"),
          label: period.label.replace("2026", "2025"),
          from: period.from.replace("2026", "2025"),
          to: period.to.replace("2026", "2025"),
        })),
      })),
      warnings: ["同期校验提示仍可查看。"],
    };
    mockGetAnalysis.mockResolvedValueOnce(result);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledWith(
      defaultQuery,
      expect.any(AbortSignal),
    );
    expect(wrapper.findAll(".analysis-module")).toHaveLength(7);
    for (const key of Object.keys(titles) as FinancialAnalysisModuleKey[]) {
      await wrapper.get(`#analysis-tab-${key}`).trigger("click");
      const card = wrapper.get(`[data-module="${key}"]`);
      expect(card.get("h3").text()).toBe(titles[key]);
      expect(card.isVisible()).toBe(true);
      expect(card.find('[data-chart-type="line"]').exists()).toBe(true);
      expect(card.find(".analysis-summaries").exists()).toBe(true);
      expect(card.find(`[aria-label="导出${titles[key]}"]`).exists()).toBe(
        true,
      );
      expect(card.find(".module-source").exists()).toBe(false);
      expect(card.findAll(".analysis-period-table")).toHaveLength(0);
      expect(card.find(".analysis-details").exists()).toBe(false);
      expect(card.find(".detail-pagination").exists()).toBe(false);
    }
    expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".global-notes").text()).toContain(
      "来源缺失时不会伪造完整数据。",
    );
    expect(wrapper.get(".global-notes").text()).toContain(
      "同期校验提示仍可查看。",
    );
    expect(wrapper.text()).toContain("¥2,053,235.40");
    expect(wrapper.text()).toContain("¥999,999,999,999,999,999.123456789012");
    expect(wrapper.text()).toContain("未知／未核算");
    expect(wrapper.text()).toContain("请先选择一位人员并查询");
    expect(wrapper.get('[aria-label="分析人员"]').text()).toContain(
      "历史离职人员甲",
    );
    wrapper.unmount();
  });

  it("来源元数据不再挂载，查询时间仍拒绝把用户名当作日期", async () => {
    const result = response();
    result.modules[0].updatedAt = "admin";
    result.modules[0].sourceLabel = "旧来源元数据不应单独渲染";
    result.generatedAt = "admin";
    mockGetAnalysis.mockResolvedValueOnce(result);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    const card = wrapper.get('[data-module="balances"]');
    expect(card.find(".module-source").exists()).toBe(false);
    expect(card.text()).not.toContain("旧来源元数据不应单独渲染");
    expect(card.text()).not.toContain("admin");
    expect(wrapper.get(".displayed-query").text()).toContain(
      "查询时间：未提供／未核算",
    );
    wrapper.unmount();
  });

  it("项目签订合同数量摘要使用个而不是货币格式", async () => {
    const result = response();
    const projects = result.modules.find(
      (module) => module.key === "projects",
    )!;
    projects.summaries.push({
      key: "signedContractCount",
      label: "所选期间新签主营项目合同数量",
      amount: "6",
      unit: "个",
    });
    mockGetAnalysis.mockResolvedValueOnce(result);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");

    const card = wrapper.get('[data-module="projects"]');
    expect(card.get(".analysis-summaries").text()).toContain("6个");
    expect(card.get(".analysis-summaries").text()).not.toContain("¥6.00");
    wrapper.unmount();
  });

  it("季度和组合筛选按独立字段查询，统计保留原范围且季度图单独查询十二季", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
    await wrapper.get('[aria-label="分析甲方"]').setValue("甲方甲");
    await wrapper.get('[aria-label="分析合同区域"]').setValue("朝阳区");
    wrapper
      .findComponent({ name: "ElCascader" })
      .vm.$emit("update:modelValue", "项目商务");
    await nextTick();
    await wrapper.get('[aria-label="分析人员"]').setValue("person-a");
    expect(wrapper.get(".pending-filter-note").text()).toContain("上一组结果");
    await wrapper.get("form").trigger("submit");
    await settle();
    const query: FinancialAnalysisQuery = {
      ...defaultQuery,
      granularity: "quarter",
      partyA: "甲方甲",
      contractRegion: "朝阳区",
      reimbursementScope: "项目商务",
      personId: "person-a",
    };
    expect(mockGetAnalysis).toHaveBeenLastCalledWith(
      query,
      expect.any(AbortSignal),
    );
    expect(mockGetWindowAnalysis).toHaveBeenLastCalledWith(
      financialWindowQuery(
        query,
        financialTwelveQuarterRange(query.to, query.to),
        "quarter",
      ),
      expect.any(AbortSignal),
    );
    expect(wrapper.get(".displayed-query").text()).toContain("季度");
    expect(wrapper.find(".pending-filter-note").exists()).toBe(false);
    expect(wrapper.get('[data-module="personnel"]').text()).not.toContain(
      "请先选择一位人员并查询",
    );
    expect(wrapper.get('[data-module="balances"] h4').text()).toContain(
      "季度趋势",
    );
    wrapper.unmount();
  });

  it("项目分析从具体甲方切回全部甲方时不发送空甲方参数，历史窗口保持同一范围", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    await wrapper.get('[aria-label="分析甲方"]').setValue("甲方甲");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(mockGetAnalysis).toHaveBeenLastCalledWith(
      { ...defaultQuery, partyA: "甲方甲" },
      expect.any(AbortSignal),
    );

    await wrapper.get('[aria-label="分析甲方"]').setValue("");
    await wrapper.get("form").trigger("submit");
    await settle();
    const submitted = mockGetAnalysis.mock.calls.at(-1)?.[0] as
      | FinancialAnalysisQuery
      | undefined;
    const windowQuery = mockGetWindowAnalysis.mock.calls.at(-1)?.[0] as
      | FinancialAnalysisQuery
      | undefined;
    expect(submitted).toEqual(defaultQuery);
    expect(submitted).not.toHaveProperty("partyA");
    expect(windowQuery).toEqual(
      financialWindowQuery(
        defaultQuery,
        financialTwelveMonthRange(defaultQuery.to),
      ),
    );
    expect(windowQuery).not.toHaveProperty("partyA");
    wrapper.unmount();
  });

  it("无工资分项权限时不绘制个人成本构成环图，保留授权总成本与比较", async () => {
    const result = response({ ...defaultQuery, personId: "person-a" });
    const personnel = result.modules.find(
      (module) => module.key === "personnel",
    )!;
    personnel.payrollDetailsVisible = false;
    mockGetAnalysis.mockResolvedValueOnce(result);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    const card = wrapper.get('[data-module="personnel"]');
    expect(card.find('[data-chart-type="donut"]').exists()).toBe(false);
    expect(card.find('[data-chart-type="bar"]').exists()).toBe(true);
    expect(card.find('[data-chart-type="line"]').exists()).toBe(true);
    expect(card.get(".payroll-permission-note").text()).toBe(
      "工资、社保、公积金分项仅向具备工资查看权限的管理员开放；当前展示已授权成本合计和费用明细",
    );
    expect(card.get(".analysis-summaries").text()).toContain("¥2,053,235.40");
    expect(card.find(".analysis-details").exists()).toBe(false);
    expect(
      wrapper
        .get('[data-module="balances"] [data-chart-type="donut"]')
        .exists(),
    ).toBe(true);
    wrapper.unmount();
  });

  it("后发筛选响应优先，迟到响应不能覆盖已显示的新结果", async () => {
    const first = deferred<MonthlyFinancialAnalysisData>();
    const second = deferred<MonthlyFinancialAnalysisData>();
    mockGetAnalysis
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await wrapper.get('[aria-label="分析结束月份"]').setValue("2026-08");
    await wrapper.get("form").trigger("submit");
    const newQuery = { ...defaultQuery, to: "2026-08" };
    second.resolve(response(newQuery));
    await settle();
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-08",
    );
    first.resolve(response());
    await settle();
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-08",
    );
    expect((mockGetAnalysis.mock.calls[0][1] as AbortSignal).aborted).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("自动刷新仅在可见活动页签运行，不打断在途查询且卸载后停止", async () => {
    jest.useFakeTimers();
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    // 先完成合法的邻窗预取，再推进到一分钟轮询时点。
    jest.advanceTimersByTime(350);
    await settle();
    jest.advanceTimersByTime(59_650);
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const pending = deferred<MonthlyFinancialAnalysisData>();
    mockGetAnalysis.mockReturnValueOnce(pending.promise);
    await wrapper.get("form").trigger("submit");
    jest.advanceTimersByTime(120_000);
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledTimes(3);
    const activeSignal = mockGetAnalysis.mock.calls[2][1] as AbortSignal;
    wrapper.unmount();
    expect(activeSignal.aborted).toBe(true);
    pending.resolve(response());
    jest.advanceTimersByTime(120_000);
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledTimes(3);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("页签停用时不查询，激活时查询；未提交筛选会暂停定时刷新", async () => {
    jest.useFakeTimers();
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09", active: false },
    });
    jest.advanceTimersByTime(60_000);
    expect(mockGetAnalysis).not.toHaveBeenCalled();
    await wrapper.setProps({ active: true });
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
    await wrapper.get('[aria-label="分析统计周期"]').setValue("year");
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ active: false });
    jest.advanceTimersByTime(60_000);
    expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("刷新标记重查已显示条件，不提交用户尚未确认的过滤项", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09", refreshKey: 0 },
    });
    await settle();
    await wrapper.get('[aria-label="分析甲方"]').setValue("甲方甲");
    await wrapper.setProps({ refreshKey: 1 });
    await settle();
    expect(mockGetAnalysis).toHaveBeenLastCalledWith(
      defaultQuery,
      expect.any(AbortSignal),
    );
    expect(wrapper.get(".pending-filter-note").exists()).toBe(true);
    wrapper.unmount();
  });

  it("月报刷新发生在用户查询途中时，先完成用户查询再更新同一范围", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09", refreshKey: 0 },
    });
    await settle();
    const pending = deferred<MonthlyFinancialAnalysisData>();
    mockGetAnalysis.mockReturnValueOnce(pending.promise);
    await wrapper.get('[aria-label="分析统计周期"]').setValue("year");
    await wrapper.get("form").trigger("submit");
    await wrapper.setProps({ refreshKey: 1 });
    expect(mockGetAnalysis).toHaveBeenCalledTimes(2);
    expect((mockGetAnalysis.mock.calls[1][1] as AbortSignal).aborted).toBe(
      false,
    );
    const yearQuery: FinancialAnalysisQuery = {
      ...defaultQuery,
      granularity: "year",
    };
    pending.resolve(response(yearQuery));
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledTimes(3);
    expect(mockGetAnalysis).toHaveBeenLastCalledWith(
      yearQuery,
      expect.any(AbortSignal),
    );
    expect(wrapper.get(".displayed-query").text()).toContain("年度");
    wrapper.unmount();
  });

  it("返回页签不自动应用尚未提交的筛选草稿", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get('[aria-label="分析甲方"]').setValue("甲方乙");
    await wrapper.setProps({ active: false });
    await wrapper.setProps({ active: true });
    await settle();
    expect(mockGetAnalysis).toHaveBeenLastCalledWith(
      defaultQuery,
      expect.any(AbortSignal),
    );
    expect(wrapper.get(".pending-filter-note").exists()).toBe(true);
    wrapper.unmount();
  });

  it("导出固定为已显示条件与数据版本，不使用尚未提交的新条件", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:财务分析"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get('[aria-label="分析甲方"]').setValue("甲方乙");
    await wrapper.get('[aria-label="导出人力成本分析"]').trigger("click");
    await settle();
    expect(mockDownloadAnalysis).toHaveBeenCalledWith(
      defaultQuery,
      "personnel",
      "精确数据版本-1",
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const saveLink = wrapper.get(".export-ready a");
    expect(saveLink.text()).toBe("保存人力成本分析文件");
    expect(saveLink.attributes("href")).toBe("blob:财务分析");
    expect(saveLink.attributes("download")).toBe("财务分析.xlsx");
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
      defaultQuery,
      "all",
      "精确数据版本-1",
    );
    expect(wrapper.get(".export-ready a").text()).toBe("保存全部分析文件");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("更换已显示查询后清理旧导出链接，避免保存过期筛选文件", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:旧分析"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(wrapper.find(".export-ready").exists()).toBe(true);
    await wrapper.get('[aria-label="分析甲方"]').setValue("甲方乙");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(wrapper.find(".export-ready").exists()).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:旧分析");
    wrapper.unmount();
  });

  it("数据版本变化造成导出失败时展示服务端提示，不声称导出成功", async () => {
    mockDownloadAnalysis.mockRejectedValueOnce(
      new Error("数据已经变化，请先刷新分析后再导出。"),
    );
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(wrapper.text()).toContain("数据已经变化，请先刷新分析后再导出。");
    expect(
      wrapper.get(".analysis-header button").attributes("disabled"),
    ).toBeUndefined();
    wrapper.unmount();
  });

  it("导出途中切换已显示查询时，不提供旧查询文件的保存入口", async () => {
    const pending = deferred<{ blob: Blob; fileName: string }>();
    mockDownloadAnalysis.mockReturnValueOnce(pending.promise);
    const createUrl = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createUrl,
    });
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get(".analysis-header button").trigger("click");
    await wrapper.get('[aria-label="分析甲方"]').setValue("甲方乙");
    await wrapper.get("form").trigger("submit");
    await settle();
    pending.resolve({ blob: new Blob(["旧查询"]), fileName: "旧查询.xlsx" });
    await settle();
    expect(wrapper.text()).toContain("分析已变化，请按当前已显示结果重新导出");
    expect(wrapper.find(".export-ready").exists()).toBe(false);
    expect(createUrl).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("同一筛选的来源版本变化后回收已生成文件链接", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:旧版本"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    const changed = response();
    changed.dataVersion = "精确数据版本-2";
    mockGetAnalysis.mockResolvedValueOnce(changed);
    await wrapper.setProps({ refreshKey: 1 });
    await settle();
    expect(wrapper.find(".export-ready").exists()).toBe(false);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:旧版本");
    wrapper.unmount();
  });

  it("浏览器拒绝自动点击时仍保留保存入口，不误报文件生成失败", async () => {
    const createUrl = jest.fn(() => "blob:等待手动保存");
    const revokeUrl = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeUrl,
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {
        throw new Error("浏览器拒绝自动下载");
      });
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(click).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).not.toHaveBeenCalled();
    const link = wrapper.get(".export-ready a");
    expect(link.attributes("href")).toBe("blob:等待手动保存");
    expect(link.attributes("download")).toBe("财务分析.xlsx");
    expect(link.text()).toBe("保存全部分析文件");
    expect(wrapper.get(".export-ready").text()).toContain("导出文件已生成");
    expect(wrapper.find(".is-error").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("导出失败");
    expect(
      wrapper.get(".analysis-header button").attributes("disabled"),
    ).toBeUndefined();
    expect(document.querySelector('a[download="财务分析.xlsx"]')).toBeNull();
    wrapper.unmount();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: 401, message: "登录状态失效，请重新登录" },
    { status: 403, message: "当前账号无权读取财务分析" },
  ])(
    "查询明确返回$status时清除旧数据及保存链接",
    async ({ status, message }) => {
      const revokeUrl = jest.fn();
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: jest.fn(() => "blob:原有授权文件"),
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: revokeUrl,
      });
      jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      const wrapper = mount(MonthlyFinancialAnalysisPanel, {
        props: { selectedMonth: "2026-09" },
      });
      await settle();
      await wrapper.get(".analysis-header button").trigger("click");
      await settle();
      expect(wrapper.findAll(".analysis-module")).toHaveLength(7);
      expect(wrapper.find(".export-ready a").exists()).toBe(true);
      mockGetAnalysis.mockRejectedValueOnce({
        response: { status, data: { message } },
      });
      await wrapper.get("form").trigger("submit");
      await settle();
      expect(wrapper.findAll(".analysis-module")).toHaveLength(0);
      expect(wrapper.find(".displayed-query").exists()).toBe(false);
      expect(wrapper.find(".export-ready").exists()).toBe(false);
      expect(wrapper.get(".is-error").text()).toContain(message);
      expect(wrapper.text()).not.toContain("¥2,053,235.40");
      expect(
        wrapper.get(".analysis-header button").attributes("disabled"),
      ).toBeDefined();
      expect(revokeUrl).toHaveBeenCalledTimes(1);
      expect(revokeUrl).toHaveBeenCalledWith("blob:原有授权文件");
      wrapper.unmount();
      expect(revokeUrl).toHaveBeenCalledTimes(1);
    },
  );

  it("卸载后导出响应迟到时不创建文件链接也不尝试下载", async () => {
    const pending = deferred<{ blob: Blob; fileName: string }>();
    mockDownloadAnalysis.mockReturnValueOnce(pending.promise);
    const createUrl = jest.fn();
    const revokeUrl = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeUrl,
    });
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get(".analysis-header button").trigger("click");
    expect(mockDownloadAnalysis).toHaveBeenCalledTimes(1);
    expect(wrapper.get(".analysis-header button").text()).toBe("正在导出…");
    wrapper.unmount();
    pending.resolve({
      blob: new Blob(["迟到文件"]),
      fileName: "迟到文件.xlsx",
    });
    await settle();
    expect(createUrl).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(revokeUrl).not.toHaveBeenCalled();
    expect(document.querySelector('a[download="迟到文件.xlsx"]')).toBeNull();
  });

  it("同查询同内容版本的定时刷新保留已生成文件链接", async () => {
    jest.useFakeTimers();
    const createUrl = jest.fn(() => "blob:同版本文件");
    const revokeUrl = jest.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeUrl,
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    const nextResponse = response();
    nextResponse.generatedAt = "2026-09-02T04:11:00.000Z";
    mockGetAnalysis.mockResolvedValueOnce(nextResponse);
    jest.advanceTimersByTime(350);
    await settle();
    jest.advanceTimersByTime(59_650);
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledTimes(2);
    expect(mockGetAnalysis).toHaveBeenLastCalledWith(
      defaultQuery,
      expect.any(AbortSignal),
    );
    expect(wrapper.get(".export-ready a").attributes("href")).toBe(
      "blob:同版本文件",
    );
    expect(wrapper.get(".export-ready a").attributes("download")).toBe(
      "财务分析.xlsx",
    );
    expect(wrapper.get(".export-ready a").text()).toBe("保存全部分析文件");
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith("blob:同版本文件");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("非法期间阻止请求，加载失败可重试且保留旧结果", async () => {
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    await wrapper.get('[aria-label="分析开始月份"]').setValue("2026-10");
    await wrapper.get("form").trigger("submit");
    expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("开始月份不能晚于结束月份");
    await wrapper.get('[aria-label="分析开始月份"]').setValue("2026-01");
    mockGetAnalysis.mockRejectedValueOnce(new Error("来源数据暂时不可用"));
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(wrapper.text()).toContain("来源数据暂时不可用");
    expect(wrapper.findAll(".analysis-module")).toHaveLength(7);
    await wrapper.get(".is-error button").trigger("click");
    await settle();
    expect(mockGetAnalysis).toHaveBeenCalledTimes(3);
    expect(wrapper.find(".is-error").exists()).toBe(false);
    wrapper.unmount();
  });

  it("大量来源不挂载旧表和分页，七模块及全部导出仍使用当前统计查询", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:移除旧明细区验收"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const result = response();
    result.modules[0].details = Array.from({ length: 51 }, (_, index) => ({
      id: String(index),
      description: `业务明细-${index + 1}`,
      amount: "0.01",
      sourceId: String(index),
    }));
    const originalDetails = JSON.stringify(result.modules[0].details);
    mockGetAnalysis.mockResolvedValueOnce(result);
    const wrapper = mount(MonthlyFinancialAnalysisPanel, {
      props: { selectedMonth: "2026-09" },
    });
    await settle();
    expect(
      wrapper.findAll(".analysis-details,.detail-pagination"),
    ).toHaveLength(0);
    expect(wrapper.text()).not.toContain("业务明细-51");
    expect(JSON.stringify(result.modules[0].details)).toBe(originalDetails);
    for (const key of Object.keys(titles) as FinancialAnalysisModuleKey[]) {
      await wrapper.get(`#analysis-tab-${key}`).trigger("click");
      await wrapper.get(`[aria-label="导出${titles[key]}"]`).trigger("click");
      await settle();
      expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
        defaultQuery,
        key,
        result.dataVersion,
      );
    }
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
      defaultQuery,
      "all",
      result.dataVersion,
    );
    await wrapper.get('[aria-label="分析结束月份"]').setValue("2026-08");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(
      wrapper.findAll(".analysis-details,.detail-pagination"),
    ).toHaveLength(0);
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
      { ...defaultQuery, to: "2026-08" },
      "all",
      result.dataVersion,
    );
    wrapper.unmount();
  });
});

describe("财务精确金额图表", () => {
  it("多个系列保留零值点，但未知月份形成断点，并显示原始大金额", async () => {
    const chartPeriods = Array.from({ length: 4 }, (_, index) => ({
      key: `2026-0${index + 1}`,
      label: `${index + 1}月`,
      from: `2026-0${index + 1}`,
      to: `2026-0${index + 1}`,
    }));
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "精确趋势",
        type: "line",
        periods: chartPeriods,
        series: [
          {
            key: "cash",
            label: "资金",
            values: ["0.1", "0", null, "999999999999999999.123456789012"],
          },
          { key: "income", label: "收入", values: ["1", "2", "3", "4"] },
        ],
      },
    });
    const cashSeries = wrapper.findAll(".analysis-line-series")[0];
    expect(cashSeries.findAll(".analysis-line-point")).toHaveLength(3);
    expect(cashSeries.findAll(".analysis-line-edge")).toHaveLength(1);
    expect(cashSeries.text()).toContain("¥0.00");
    expect(cashSeries.text()).toContain(
      "¥999,999,999,999,999,999.123456789012",
    );
    await cashSeries.findAll(".analysis-line-point")[2].trigger("focus");
    expect(wrapper.get(".chart-inspector").text()).toContain(
      "¥999,999,999,999,999,999.123456789012",
    );
    wrapper.unmount();
  });

  it.each([
    { amount: null, message: "含未知或未核算金额" },
    { amount: "-0.01", message: "含负金额" },
    { amount: "0", message: "金额均为零" },
  ])("结构图金额 $amount 不生成误导性占比", ({ amount, message }) => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "余额构成",
        type: "donut",
        items: [{ key: "one", label: "一般账户", amount }],
      },
    });
    expect(wrapper.text()).toContain(message);
    expect(wrapper.find(".donut-svg").exists()).toBe(false);
    expect(wrapper.get(".unavailable-values").text()).toContain(
      amount === null ? "未知／未核算" : amount === "0" ? "¥0.00" : "¥-0.01",
    );
    wrapper.unmount();
  });

  it("比例可舍入，但环图与柱图金额不舍入也不转换为浮点金额", () => {
    const items = [
      { key: "one", label: "第一人员", amount: "0.100000000001" },
      { key: "two", label: "第二人员", amount: "0.2" },
    ];
    const donut = mount(MonthlyFinancialAnalysisChart, {
      props: { title: "结构", type: "donut", items },
    });
    expect(donut.text()).toContain("¥0.100000000001");
    expect(donut.text()).toContain("33.33%");
    expect(donut.text()).toContain("66.67%");
    const bar = mount(MonthlyFinancialAnalysisChart, {
      props: { title: "比较", type: "bar", items },
    });
    expect(bar.text()).toContain("¥0.100000000001");
    expect(bar.text()).toContain("¥0.20");
    donut.unmount();
    bar.unmount();
  });

  it("全部未知的折线显示缺失状态而非伪造零线", () => {
    const wrapper = mount(MonthlyFinancialAnalysisChart, {
      props: {
        title: "缺失趋势",
        type: "line",
        periods,
        series: [{ key: "unknown", label: "未知余额", values: [null, null] }],
      },
    });
    expect(wrapper.text()).toContain("未知数据不会按零连线");
    expect(wrapper.findAll(".analysis-line-point")).toHaveLength(0);
    wrapper.unmount();
  });
});
