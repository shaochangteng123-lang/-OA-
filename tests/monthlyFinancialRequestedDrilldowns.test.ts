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
      props: ["modelValue"],
      emits: ["update:modelValue"],
      methods: { close: jest.fn() },
      template:
        '<div><input aria-label="测试开始月" :value="modelValue[0]" @input="$emit(\'update:modelValue\', [$event.target.value, modelValue[1]])" /><input aria-label="测试结束月" :value="modelValue[1]" @input="$emit(\'update:modelValue\', [modelValue[0], $event.target.value])" /></div>',
    },
  }),
);
import { nextTick } from "vue";
import Panel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import Chart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import BusinessDetails from "@/components/monthly-financial/MonthlyFinancialBusinessDetails.vue";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import { addFinancialAmountTexts } from "@/utils/monthlyFinancialReportPresentation";
import type {
  FinancialAnalysisModule,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";
const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
function months(from: string, to: string) {
  const result: string[] = [];
  for (let m = from; m <= to; m = financialMonthOffset(m, 1)) {
    result.push(m);
    if (m === to) break;
  }
  return result;
}
function periods(query: FinancialAnalysisQuery) {
  const result = new Map<string, FinancialAnalysisPeriod>();
  for (const month of months(query.from, query.to)) {
    const year = month.slice(0, 4),
      q = Math.ceil(Number(month.slice(5)) / 3);
    const key =
      query.granularity === "month"
        ? month
        : query.granularity === "quarter"
          ? `${year}-Q${q}`
          : year;
    const label =
      query.granularity === "month"
        ? month
        : query.granularity === "quarter"
          ? `${year}年第${q}季度`
          : `${year}年`;
    const old = result.get(key);
    if (old) old.to = month;
    else result.set(key, { key, label, from: month, to: month });
  }
  return Array.from(result.values());
}
function sum(values: Array<string | null>) {
  return values.some((value) => value === null)
    ? null
    : values.reduce<string>(
        (total, value) => addFinancialAmountTexts(total, value!),
        "0",
      );
}
const categories = [
  "administration",
  "salary",
  "other",
  "tax",
  "business",
  "asset",
];
function expense(month: string, category: string) {
  if (month.endsWith("-02")) return "0";
  if (category === "tax" && month.endsWith("-06")) return null;
  return category === "administration"
    ? "0.1"
    : category === "salary"
      ? "0.2"
      : "0";
}
function modules(query: FinancialAnalysisQuery): FinancialAnalysisModule[] {
  const periodsList = periods(query);
  const base = {
    periods: periodsList,
    description: "合成验收",
    sourceLabel: "合成来源",
    updatedAt: null,
    warnings: [],
    appliedFilters: [],
    columns: [],
    comparison: [],
    details: [],
  };
  const outflowSeries = categories.map((key) => ({
    key,
    label: key,
    values: periodsList.map((period) =>
      sum(months(period.from, period.to).map((month) => expense(month, key))),
    ),
  }));
  outflowSeries.push({
    key: "total",
    label: "一般账户总支出",
    values: periodsList.map((period) =>
      sum(
        months(period.from, period.to).map((month) =>
          month.endsWith("-02") ? "0" : "0.3",
        ),
      ),
    ),
  });
  const outflow: FinancialAnalysisModule = {
    ...base,
    key: "outflow",
    title: "一般账户出账统计",
    series: outflowSeries,
    summaries: [
      {
        key: "total",
        label: "总支出",
        amount: sum(outflowSeries.at(-1)!.values),
      },
    ],
    breakdown: outflowSeries
      .filter((item) => item.key !== "total")
      .map((item) => ({
        key: item.key,
        label: item.label,
        amount: sum(item.values),
      })),
  };
  const projectRows = periodsList.flatMap((period) =>
    [1, 2].map((index) => {
      const ordinal = BigInt(
        (Number(period.to.slice(0, 4)) - 2020) * 12 +
          Number(period.to.slice(5)),
      );
      const received = ordinal * BigInt(index) * 100n,
        contract = BigInt(index) * 100000n;
      return {
        id: period.key + ":p" + index,
        sourceId: "p" + index,
        period: period.label,
        periodKey: period.key,
        from: period.from,
        to: period.to,
        project: "项目" + index,
        partyA: "甲方" + index,
        region: index === 1 ? "海淀区" : "朝阳区",
        received: String(received),
        periodReceived: sum(
          months(period.from, period.to).map((month) =>
            month.endsWith("-02")
              ? "0"
              : month.endsWith("-04")
                ? null
                : index === 1
                  ? "0.1"
                  : "0.2",
          ),
        ),
        periodReceivedSourceState: "按回款业务日期统计当前已确认未冲正记录",
        periodReceivedSourceIds: "回款凭证" + index,
        contract: String(contract),
        outstanding: String(contract - received),
        sourceState: "合成已确认项目事实",
      };
    }),
  );
  const projects: FinancialAnalysisModule = {
    ...base,
    key: "projects",
    title: "项目分析",
    summaries: [],
    breakdown: [],
    details: projectRows,
    series: ["contract", "received", "outstanding", "periodReceived"].map(
      (key) => ({
        key,
        label:
          key === "periodReceived"
            ? query.granularity === "month"
              ? "本月回款"
              : query.granularity === "quarter"
                ? "本季回款"
                : "本年回款"
            : key === "received"
              ? "已回款"
              : key === "contract"
                ? "合同金额"
                : "未回款",
        values: periodsList.map((period) =>
          sum(
            projectRows
              .filter((row) => row.periodKey === period.key)
              .map(
                (row) =>
                  row[
                    key as
                      | "received"
                      | "contract"
                      | "outstanding"
                      | "periodReceived"
                  ],
              ),
          ),
        ),
      }),
    ),
  };
  const business: FinancialAnalysisModule = {
    ...base,
    key: "business",
    title: "商务统计",
    summaries: [],
    breakdown: [],
    series: [
      {
        key: "business",
        label: "商务报销",
        values: periodsList.map(() => "0.3"),
      },
    ],
    columns: [
      { key: "scope", label: "报销范围／区域", format: "text" },
      { key: "region", label: "行政区", format: "text" },
      { key: "amount", label: "金额", format: "amount" },
      { key: "regionSource", label: "区域来源", format: "text" },
    ],
    details: [
      {
        id: "b1",
        scope: "海淀区 / GJDW",
        region: "海淀区",
        amount: "0.1",
        regionSource: "财务区报销范围配置",
      },
      {
        id: "b2",
        scope: "朝阳区 / GJDW",
        region: "朝阳区",
        amount: "0.2",
        regionSource: "财务区报销范围配置",
      },
    ],
  };
  return [outflow, projects, business];
}
function response(query: FinancialAnalysisQuery): MonthlyFinancialAnalysisData {
  const offset = query.comparisonYear
    ? (Number(query.from.slice(0, 4)) - query.comparisonYear) * 12
    : 0;
  const comparison = offset
    ? {
        from: financialMonthOffset(query.from, -offset),
        to: financialMonthOffset(query.to, -offset),
        granularity: query.granularity,
      }
    : null;
  return {
    query,
    dataVersion: "合成版本",
    generatedAt: "2026-09-03T00:00:00Z",
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    modules: modules(query),
    warnings: [],
    ...(comparison
      ? {
          comparison: {
            query: comparison,
            label: query.comparisonYear + "年同期",
            modules: modules(comparison),
            warnings: [],
          },
        }
      : {}),
  };
}
async function settle() {
  for (let i = 0; i < 7; i++) {
    await Promise.resolve();
    await nextTick();
  }
}
function chart(wrapper: ReturnType<typeof mount>, key: string) {
  return wrapper
    .get('[data-module="' + key + '"]')
    .findAllComponents(Chart)
    .find((item) => item.props("type") === "line")!;
}
describe("季度历史与出账项目商务联动接入", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRead.mockReset().mockImplementation(async (query) => response(query));
    mockWindow.mockReset().mockImplementation(async (query) => response(query));
  });
  afterEach(() => {
    jest.useRealTimers();
  });
  it("出账点选当月权威总额和六分类，零月也显示0，关闭同期清理对应点选", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get("#analysis-tab-outflow").trigger("click");
    const outflowSeriesBeforeSelection = chart(wrapper, "outflow").props(
      "series",
    );
    chart(wrapper, "outflow").vm.$emit("point-select", {
      month: "2026-08",
      comparison: false,
      metricKey: "administration",
    });
    await settle();
    const area = wrapper.get('[data-module="outflow"]');
    expect(area.get(".outflow-total-amount").text()).toBe("¥0.30");
    expect(area.findAll(".outflow-category-list li")).toHaveLength(6);
    expect(area.text()).toContain("2026-08");
    expect(chart(wrapper, "outflow").props("series")).toBe(
      outflowSeriesBeforeSelection,
    );
    chart(wrapper, "outflow").vm.$emit("point-select", {
      month: "2026-02",
      comparison: false,
      metricKey: "total",
    });
    await settle();
    expect(area.get(".outflow-total-amount").text()).toBe("¥0.00");
    chart(wrapper, "outflow").vm.$emit("point-select", {
      month: "2025-08",
      comparison: true,
      metricKey: "total",
    });
    await settle();
    expect(area.text()).toContain("对比期");
    await area.get(".module-comparison-toggle").trigger("click");
    expect(area.find(".outflow-structure-reset").exists()).toBe(false);
    expect(mockRead).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it("项目已回款点显示同一期各项目，按行政区分组，非回款点不冒充回款明细", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const area = wrapper.get('[data-module="projects"]');
    chart(wrapper, "projects").vm.$emit("point-select", {
      month: "2026-08",
      comparison: false,
      metricKey: "received",
    });
    await settle();
    expect(area.findAll(".project-region")).toHaveLength(2);
    expect(area.findAll(".project-detail")).toHaveLength(2);
    expect(area.get(".project-drilldown-total-amount").text()).toBe(
      "¥24,000.00",
    );
    expect(area.get('[data-region="海淀区"]').text()).toContain("项目1");
    chart(wrapper, "projects").vm.$emit("point-select", {
      month: "2026-08",
      comparison: false,
      metricKey: "contract",
    });
    await settle();
    expect(area.find(".project-drilldown").exists()).toBe(false);
    wrapper.unmount();
  });
  it("季度发起12季独立查询，项目按季度期末下钻，季度出账不标当月，浏览不改统计", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(mockWindow).toHaveBeenLastCalledWith(
      {
        from: "2023-10",
        to: "2026-09",
        granularity: "quarter",
        comparisonYear: 2022,
      },
      expect.any(AbortSignal),
    );
    expect(chart(wrapper, "projects").props("quarterHistory")).toBe(true);
    expect(chart(wrapper, "projects").props("periods")).toHaveLength(12);
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const point = {
      month: "2026-09",
      from: "2026-07",
      to: "2026-09",
      periodKey: "2026-Q3",
      comparison: false,
      metricKey: "received",
    };
    chart(wrapper, "projects").vm.$emit("point-select", point);
    await settle();
    expect(wrapper.get(".project-drilldown-total-amount").text()).toBe(
      "¥24,300.00",
    );
    expect(wrapper.get(".project-drilldown").text()).toContain("2026年第3季度");
    await wrapper.get("#analysis-tab-outflow").trigger("click");
    chart(wrapper, "outflow").vm.$emit("point-select", {
      ...point,
      metricKey: "total",
    });
    await settle();
    expect(wrapper.get(".outflow-total-amount").text()).toBe("¥0.90");
    expect(wrapper.get(".outflow-structure").text()).toContain("2026年第3季度");
    chart(wrapper, "outflow").vm.$emit("window-change", {
      from: "2023-07",
      to: "2026-06",
    });
    jest.advanceTimersByTime(180);
    await settle();
    expect(wrapper.find(".outflow-structure-reset").exists()).toBe(false);
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09",
    );
    expect(mockRead).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it("商务旧来源明细不再挂载，主图与既有分析数据保持可用", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get("#analysis-tab-business").trigger("click");
    const area = wrapper.get('[data-module="business"]');
    expect(area.findComponent(BusinessDetails).exists()).toBe(false);
    expect(area.find(".business-region-details").exists()).toBe(false);
    expect(area.find(".analysis-details").exists()).toBe(false);
    const line = chart(wrapper, "business");
    expect(line.props("type")).toBe("line");
    expect(line.props("series")[0].key).toBe("business");
    expect(
      line
        .props("series")[0]
        .values.every((amount: string) => amount === "0.3"),
    ).toBe(true);
    expect(mockRead).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
  it("项目仅一张图，查看指标含本月回款，累计与期间点选互斥且引用稳定", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const area = wrapper.get('[data-module="projects"]');
    const line = chart(wrapper, "projects");
    expect(
      area
        .findAllComponents(Chart)
        .filter((item) => item.props("type") === "line"),
    ).toHaveLength(1);
    expect(area.find(".project-period-receipts").exists()).toBe(false);
    const selector = line.get('[aria-label="选择折线指标"]');
    expect(
      selector.findAll("option").map((option) => ({
        value: option.attributes("value"),
        label: option.text(),
      })),
    ).toEqual([
      { value: "contract", label: "合同金额" },
      { value: "received", label: "已回款" },
      { value: "outstanding", label: "未回款" },
      { value: "periodReceived", label: "本月回款" },
    ]);
    const originalSeries = line.props("series");
    const originalComparison = line.props("comparisonSeries");
    const originalPeriods = line.props("periods");
    await selector.setValue("periodReceived");
    await line
      .get('.chart-value-label[data-series="current"][data-month="2026-03"]')
      .trigger("click");
    await settle();
    expect(area.findAll(".project-drilldown")).toHaveLength(1);
    expect(area.get(".project-drilldown").attributes("data-mode")).toBe(
      "period",
    );
    expect(area.get(".project-drilldown-total-amount").text()).toBe("¥0.30");
    expect(area.get(".project-drilldown-total-label").text()).toBe("本月回款");
    expect(area.findAll(".project-region")).toHaveLength(2);
    expect(area.get('[data-region="海淀区"]').text()).toContain("¥0.10");
    expect(area.get('[data-region="朝阳区"]').text()).toContain("¥0.20");
    const periodCards = area
      .get('.project-detail[data-source-id="p1"] .project-amounts')
      .findAll("[data-metric]");
    expect(periodCards.map((card) => card.attributes("data-metric"))).toEqual([
      "periodReceived",
      "contract",
      "received",
      "outstanding",
    ]);
    expect(periodCards.map((card) => card.get("dd").text())).toEqual([
      "¥0.10",
      "¥100,000.00",
      "¥7,500.00",
      "¥92,500.00",
    ]);
    expect(area.findAll(".project-bank-receipt-link")).toHaveLength(2);
    expect(area.find(".project-receipt-preview").exists()).toBe(false);
    expect(area.find("[data-financial-receipt-dialog]").exists()).toBe(false);
    expect(line.get(".chart-inspector").text()).toContain("¥0.30");
    expect(line.props("series")).toBe(originalSeries);
    expect(line.props("comparisonSeries")).toBe(originalComparison);
    expect(line.props("periods")).toBe(originalPeriods);
    await selector.setValue("received");
    await settle();
    expect(area.find(".project-drilldown").exists()).toBe(false);
    expect(line.find(".chart-inspector").exists()).toBe(false);
    await line
      .get('.chart-value-label[data-series="current"][data-month="2026-03"]')
      .trigger("click");
    await settle();
    expect(area.get(".project-drilldown").attributes("data-mode")).toBe(
      "cumulative",
    );
    expect(area.get(".project-drilldown-total-amount").text()).toBe(
      "¥22,500.00",
    );
    expect(area.get(".project-drilldown").text()).toContain("期末累计已回款");
    const cumulativeCards = area
      .get('.project-detail[data-source-id="p1"] .project-amounts')
      .findAll("[data-metric]");
    expect(
      cumulativeCards.map((card) => card.attributes("data-metric")),
    ).toEqual(["received", "contract", "outstanding"]);
    expect(cumulativeCards.map((card) => card.get("dd").text())).toEqual([
      "¥7,500.00",
      "¥100,000.00",
      "¥92,500.00",
    ]);
    expect(area.find(".project-bank-receipt-link").exists()).toBe(false);
    await selector.setValue("periodReceived");
    expect(area.find(".project-drilldown").exists()).toBe(false);
    await line
      .get('.chart-value-label[data-series="current"][data-month="2026-02"]')
      .trigger("click");
    await settle();
    expect(area.get(".project-drilldown-total-amount").text()).toBe("¥0.00");
    expect(area.findAll(".project-detail")).toHaveLength(0);
    expect(area.findAll(".project-region")).toHaveLength(0);
    expect(area.get(".project-drilldown-empty").text()).toContain(
      "暂无可展示的正向回款项目",
    );
    expect(
      line
        .get(
          '.chart-value-label[data-series="current"][data-month="2026-02"] .amount-label-value',
        )
        .text(),
    ).toBe("¥0.00");
    expect(
      line
        .find('.chart-value-label[data-series="current"][data-month="2026-04"]')
        .exists(),
    ).toBe(false);
    line.vm.$emit("point-select", {
      month: "2026-04",
      metricKey: "periodReceived",
      comparison: false,
    });
    await settle();
    expect(area.get(".project-drilldown-total-amount").text()).toBe("¥0.00");
    expect(area.get(".project-drilldown").text()).toContain("2026-02");
    const windowReads = mockWindow.mock.calls.length;
    line.vm.$emit("window-change", { from: "2025-10", to: "2026-09" });
    jest.advanceTimersByTime(200);
    await settle();
    expect(mockWindow).toHaveBeenCalledTimes(windowReads);
    expect(area.get(".project-drilldown-total-amount").text()).toBe("¥0.00");
    expect(line.get(".chart-inspector").text()).toContain("¥0.00");
    expect(line.props("series")).toBe(originalSeries);
    expect(mockRead).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("同一指标下拉按季度年度显示本季本年回款，窗口与粒度变化清旧明细", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
    await wrapper.get("form").trigger("submit");
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const area = wrapper.get('[data-module="projects"]');
    const line = chart(wrapper, "projects");
    expect(
      area
        .findAllComponents(Chart)
        .filter((item) => item.props("type") === "line"),
    ).toHaveLength(1);
    expect(line.props("quarterHistory")).toBe(true);
    expect(line.findAll(".chart-quarter-slot")).toHaveLength(12);
    expect(line.get('option[value="periodReceived"]').text()).toBe("本季回款");
    await line.get('[aria-label="选择折线指标"]').setValue("periodReceived");
    await line
      .get('.chart-value-label[data-series="current"][data-period="2026-Q1"]')
      .trigger("click");
    await settle();
    expect(area.get(".project-drilldown-total-amount").text()).toBe("¥0.60");
    expect(area.get(".project-drilldown").text()).toContain("2026年第1季度");
    expect(area.get(".project-drilldown").text()).not.toContain("本月回款");
    await line.get(".line-scroll").trigger("keydown", { key: "ArrowLeft" });
    jest.advanceTimersByTime(180);
    await settle();
    expect(area.find(".project-drilldown").exists()).toBe(false);
    expect(line.props("windowEnd")).toBe("2026-06");
    expect(
      (line.get('[aria-label="选择折线指标"]').element as HTMLSelectElement)
        .value,
    ).toBe("periodReceived");
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09",
    );
    expect(mockRead).toHaveBeenCalledTimes(2);
    await wrapper.get('[aria-label="测试开始月"]').setValue("2026-07");
    await wrapper.get('[aria-label="分析统计周期"]').setValue("year");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(line.props("periodView")).toBe(true);
    expect(line.get('option[value="periodReceived"]').text()).toBe("本年回款");
    expect(line.findAll(".chart-period-slot")).toHaveLength(1);
    expect(area.find(".project-drilldown").exists()).toBe(false);
    await line
      .get('.chart-value-label[data-series="current"][data-period="2026"]')
      .trigger("click");
    await settle();
    expect(area.get(".project-drilldown-total-amount").text()).toBe("¥0.90");
    expect(area.get(".project-drilldown").text()).toContain(
      "2026-07 至 2026-09",
    );
    expect(area.get(".project-drilldown").text()).toContain("本年回款");
    expect(line.emitted("point-select")?.at(-1)).toEqual([
      {
        month: "2026-09",
        from: "2026-07",
        to: "2026-09",
        periodKey: "2026",
        comparison: false,
        metricKey: "periodReceived",
      },
    ]);
    wrapper.unmount();
  });

  it("单图年度对比隐藏时清理同期明细，当前明细及隐藏模块事件边界保持", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const area = wrapper.get('[data-module="projects"]');
    const line = chart(wrapper, "projects");
    await line.get('[aria-label="选择折线指标"]').setValue("periodReceived");
    await line
      .get('.chart-value-label[data-series="comparison"][data-month="2026-03"]')
      .trigger("click");
    await settle();
    expect(area.get(".project-drilldown").text()).toContain("对比期");
    expect(area.get(".project-drilldown").text()).toContain("2025-03");
    await area.get(".module-comparison-toggle").trigger("click");
    expect(area.find(".project-drilldown").exists()).toBe(false);
    expect(line.props("comparisonVisible")).toBe(false);
    expect(
      line.find('.analysis-line-series[data-series="comparison"]').exists(),
    ).toBe(false);
    await line
      .get('.chart-value-label[data-series="current"][data-month="2026-03"]')
      .trigger("click");
    await settle();
    expect(area.get(".project-drilldown").text()).toContain("2026-03");
    await wrapper.get("#analysis-tab-business").trigger("click");
    line.vm.$emit("metric-change");
    line.vm.$emit("point-select", {
      month: "2026-02",
      comparison: false,
      metricKey: "periodReceived",
    });
    await settle();
    expect(area.get(".project-drilldown").text()).toContain("2026-03");
    await wrapper.get("#analysis-tab-projects").trigger("click");
    await area.get(".module-comparison-toggle").trigger("click");
    expect(area.get(".project-drilldown").text()).toContain("2026-03");
    expect(
      line.find('.analysis-line-series[data-series="comparison"]').exists(),
    ).toBe(true);
    expect(mockRead).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("选择主营项目签订合同数量时自动恢复已有往年对比", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const area = wrapper.get('[data-module="projects"]');
    const line = chart(wrapper, "projects");

    await area.get(".module-comparison-toggle").trigger("click");
    expect(line.props("comparisonVisible")).toBe(false);
    expect(
      line.find('.analysis-line-series[data-series="comparison"]').exists(),
    ).toBe(false);

    line.vm.$emit("metric-selected", "signedContractCount");
    await settle();

    expect(line.props("comparisonVisible")).toBe(true);
    expect(
      line.find('.analysis-line-series[data-series="comparison"]').exists(),
    ).toBe(true);
    wrapper.unmount();
  });

  it("无同期数据的单图点选保持系列与空比较引用，图内精准金额提示不被重绘清掉", async () => {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get('[aria-label="分析对比年份"]').setValue("");
    await wrapper.get("form").trigger("submit");
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const area = wrapper.get('[data-module="projects"]');
    const line = chart(wrapper, "projects");
    const emptySeries = line.props("comparisonSeries");
    const emptyPeriods = line.props("comparisonPeriods");
    const series = line.props("series");
    await line.get('[aria-label="选择折线指标"]').setValue("periodReceived");
    await line
      .get('.chart-value-label[data-series="current"][data-month="2026-03"]')
      .trigger("click");
    await settle();
    expect(line.props("comparisonSeries")).toBe(emptySeries);
    expect(line.props("comparisonPeriods")).toBe(emptyPeriods);
    expect(line.props("series")).toBe(series);
    expect(area.get(".project-drilldown-total-amount").text()).toBe("¥0.30");
    expect(line.get(".chart-inspector").text()).toContain("¥0.30");
    expect(
      area
        .findAllComponents(Chart)
        .filter((item) => item.props("type") === "line"),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it("默认指标因新数据自动变化时清理旧项目明细，同指标普通刷新不误清", async () => {
    let contractKnown = false;
    mockWindow.mockImplementation(async (query: FinancialAnalysisQuery) => {
      const result = response(query);
      if (!contractKnown) {
        for (const list of [result.modules, result.comparison?.modules || []]) {
          const contract = list
            .find((module) => module.key === "projects")
            ?.series.find((series) => series.key === "contract");
          if (contract) contract.values = contract.values.map(() => null);
        }
      }
      return result;
    });
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const area = wrapper.get('[data-module="projects"]');
    const line = chart(wrapper, "projects");
    const selector = line.get('[aria-label="选择折线指标"]');
    expect((selector.element as HTMLSelectElement).value).toBe("received");
    await line
      .get('.chart-value-label[data-series="current"][data-month="2026-03"]')
      .trigger("click");
    await settle();
    expect(area.get(".project-drilldown-total-amount").text()).toBe(
      "¥22,500.00",
    );
    const originalChanges = line.emitted("metric-change")?.length || 0;
    await wrapper.setProps({ refreshKey: 1 });
    await settle();
    expect((selector.element as HTMLSelectElement).value).toBe("received");
    expect(area.get(".project-drilldown-total-amount").text()).toBe(
      "¥22,500.00",
    );
    expect(line.emitted("metric-change")?.length || 0).toBe(originalChanges);
    contractKnown = true;
    await wrapper.setProps({ refreshKey: 2 });
    await settle();
    expect((selector.element as HTMLSelectElement).value).toBe("contract");
    expect(area.find(".project-drilldown").exists()).toBe(false);
    expect(line.find(".chart-inspector").exists()).toBe(false);
    expect(line.emitted("metric-change")?.length || 0).toBe(
      originalChanges + 1,
    );
    wrapper.unmount();
  });

  it("根全屏内单图下拉和多指标变化清理旧明细，不增加查询或第二张图", async () => {
    const originalRequest = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "requestFullscreen",
    );
    const originalExit = Object.getOwnPropertyDescriptor(
      document,
      "exitFullscreen",
    );
    const originalElement = Object.getOwnPropertyDescriptor(
      document,
      "fullscreenElement",
    );
    let fullscreenElement: Element | null = null;
    const request = jest.fn(async () => {
      fullscreenElement = request.mock.contexts.at(-1) as HTMLElement;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exit = jest.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: request,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exit,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    const wrapper = mount(Panel, {
      props: { selectedMonth: "2026-09" },
      attachTo: document.body,
    });
    try {
      await settle();
      await wrapper.get("#analysis-tab-projects").trigger("click");
      const area = wrapper.get('[data-module="projects"]');
      const line = chart(wrapper, "projects");
      const series = line.props("series");
      const requests = mockRead.mock.calls.length;
      const windows = mockWindow.mock.calls.length;
      const visibleWindow = line.get(".visible-window-range").text();
      await area.get(".module-fullscreen-toggle").trigger("click");
      await settle();
      const root = wrapper.get("section.financial-analysis-panel");
      expect(document.fullscreenElement).toBe(root.element);
      expect(
        root.element.contains(line.get('[aria-label="选择折线指标"]').element),
      ).toBe(true);
      await line.get('[aria-label="选择折线指标"]').setValue("periodReceived");
      await line
        .get('.chart-value-label[data-series="current"][data-month="2026-03"]')
        .trigger("click");
      await settle();
      expect(area.get(".project-drilldown-total-amount").text()).toBe("¥0.30");
      await line.get(".metric-controls button").trigger("click");
      await settle();
      expect(area.find(".project-drilldown").exists()).toBe(false);
      expect(line.find(".chart-inspector").exists()).toBe(false);
      await line
        .get(
          '.chart-value-label[data-series="current"][data-metric="periodReceived"][data-month="2026-03"]',
        )
        .trigger("click");
      await settle();
      expect(area.get(".project-drilldown-total-amount").text()).toBe("¥0.30");
      const contractToggle = line
        .findAll(".metric-checklist label")
        .find((label) => label.text() === "合同金额")!
        .get("input");
      await contractToggle.setValue(false);
      await settle();
      expect(area.find(".project-drilldown").exists()).toBe(false);
      expect(line.find(".chart-inspector").exists()).toBe(false);
      await line.get(".metric-controls button").trigger("click");
      expect(
        (line.get('[aria-label="选择折线指标"]').element as HTMLSelectElement)
          .value,
      ).toBe("periodReceived");
      expect(line.props("series")).toBe(series);
      expect(line.get(".visible-window-range").text()).toBe(visibleWindow);
      expect(
        area
          .findAllComponents(Chart)
          .filter((item) => item.props("type") === "line"),
      ).toHaveLength(1);
      expect(root.classes()).toContain("is-fullscreen");
      expect(request).toHaveBeenCalledTimes(1);
      expect(mockRead).toHaveBeenCalledTimes(requests);
      expect(mockWindow).toHaveBeenCalledTimes(windows);
      await root.get(".panel-fullscreen-exit").trigger("click");
      await settle();
      expect(exit).toHaveBeenCalledTimes(1);
      expect(root.classes()).not.toContain("is-fullscreen");
    } finally {
      wrapper.unmount();
      await settle();
      for (const [target, key, descriptor] of [
        [HTMLElement.prototype, "requestFullscreen", originalRequest],
        [document, "exitFullscreen", originalExit],
        [document, "fullscreenElement", originalElement],
      ] as const) {
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else Reflect.deleteProperty(target, key);
      }
      document.body.replaceChildren();
    }
  });
});
