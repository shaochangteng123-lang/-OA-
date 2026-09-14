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
  FinancialAnalysisDetail,
  FinancialAnalysisModule,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";
const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const scopeA = "北京市 / 海淀区 / 电力 / 业务一";
const scopeB = "北京市 / 海淀区 / 电力 / 业务二";
let unknownMonth = "";
function months(from: string, to: string) {
  const result: string[] = [];
  for (let month = from; month <= to; month = financialMonthOffset(month, 1))
    result.push(month);
  return result;
}
function sum(amounts: string[]) {
  return amounts.reduce(
    (total, amount) => addFinancialAmountTexts(total, amount),
    "0",
  );
}
function periods(query: FinancialAnalysisQuery) {
  const values = new Map<string, FinancialAnalysisPeriod>();
  for (const month of months(query.from, query.to)) {
    const year = month.slice(0, 4),
      quarter = Math.ceil(Number(month.slice(5)) / 3);
    const key =
      query.granularity === "month"
        ? month
        : query.granularity === "quarter"
          ? `${year}-Q${quarter}`
          : year;
    const label =
      query.granularity === "month"
        ? month
        : query.granularity === "quarter"
          ? `${year}年第${quarter}季度`
          : `${year}年`;
    const existing = values.get(key);
    if (existing) existing.to = month;
    else values.set(key, { key, label, from: month, to: month });
  }
  return [...values.values()];
}
function businessModule(
  query: FinancialAnalysisQuery,
): FinancialAnalysisModule {
  const details: FinancialAnalysisDetail[] = months(
    query.from,
    query.to,
  ).flatMap((month) => {
    if (month.endsWith("-02")) return [];
    const current = month.startsWith("2026-");
    const rows = [{ scope: scopeA, amount: current ? "100.10" : "10.10" }];
    const second = current
      ? month.endsWith("-08")
        ? "20.20"
        : month.endsWith("-09")
          ? "30.30"
          : "0"
      : "2.20";
    if (second !== "0") rows.push({ scope: scopeB, amount: second });
    return rows.map((row, index) => ({
      id: `${month}:${index}`,
      sourceId: `${month}:${index}`,
      month,
      date: `${month}-12`,
      amount: row.amount,
      scope: row.scope,
      scopePath: row.scope,
      region: "海淀区",
      sourceState: "已核验付款",
    }));
  });
  const periodList = periods(query);
  const categories = [scopeA, scopeB].map((scope) => ({
    key: scope,
    label: scope,
    amount: sum(
      details
        .filter((row) => row.scopePath === scope)
        .map((row) => row.amount!),
    ),
  }));
  return {
    key: "business",
    title: "商务统计",
    description: "按付款月及完整级联路径统计",
    sourceLabel: "合成核验来源",
    updatedAt: null,
    periods: periodList,
    series: [
      {
        key: "business",
        label: "商务报销",
        values: periodList.map((period) =>
          unknownMonth &&
          unknownMonth >= period.from &&
          unknownMonth <= period.to
            ? null
            : sum(
                details
                  .filter(
                    (row) =>
                      row.month! >= period.from && row.month! <= period.to,
                  )
                  .map((row) => row.amount!),
              ),
        ),
      },
    ],
    summaries: [
      {
        key: "total",
        label: "期间商务报销",
        amount: sum(details.map((row) => row.amount!)),
      },
    ],
    breakdown: categories,
    comparison: categories,
    columns: [],
    details,
    warnings: [],
    appliedFilters: [],
  };
}
function response(query: FinancialAnalysisQuery): MonthlyFinancialAnalysisData {
  const business = businessModule(query);
  const buildModules = (target: FinancialAnalysisQuery) => [
    {
      ...businessModule(target),
      key: "inflow" as const,
      title: "一般账户入账统计",
      breakdown: [],
      comparison: [],
    },
    businessModule(target),
  ];
  const offset = query.comparisonYear
    ? (Number(query.from.slice(0, 4)) - query.comparisonYear) * 12
    : 0;
  const previous = offset
    ? {
        ...query,
        from: financialMonthOffset(query.from, -offset),
        to: financialMonthOffset(query.to, -offset),
        comparisonYear: undefined,
      }
    : null;
  return {
    query,
    dataVersion: "商务联动合成版本",
    generatedAt: "2026-09-07T00:00:00Z",
    warnings: [],
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [scopeA, scopeB],
      people: [],
    },
    modules: [
      {
        ...business,
        key: "inflow",
        title: "一般账户入账统计",
        breakdown: [],
        comparison: [],
      },
      business,
    ],
    ...(previous
      ? {
          comparison: {
            query: previous,
            label: `${query.comparisonYear}年同期`,
            modules: buildModules(previous),
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
type Wrapper = ReturnType<typeof mount>;
function area(wrapper: Wrapper) {
  return wrapper.get('[data-module="business"]');
}
function chart(wrapper: Wrapper, type: string) {
  return area(wrapper)
    .findAllComponents(Chart)
    .find((item) => item.props("type") === type)!;
}
function summary(wrapper: Wrapper) {
  return area(wrapper).get(".analysis-summary strong").text();
}
function amounts(wrapper: Wrapper, type: string) {
  return chart(wrapper, type)
    .props("items")
    .map((item: { label: string; amount: string | null }) => [
      item.label,
      item.amount,
    ]);
}
async function open() {
  const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
  await settle();
  await wrapper.get("#analysis-tab-business").trigger("click");
  return wrapper;
}
async function selectLabel(
  wrapper: Wrapper,
  month: string,
  comparison = false,
  keyboard = false,
) {
  const label = chart(wrapper, "line").get(
    `.chart-value-label[data-series="${comparison ? "comparison" : "current"}"][data-month="${month}"]`,
  );
  await label.trigger(
    keyboard ? "keydown" : "click",
    keyboard ? { key: "Enter" } : undefined,
  );
  await settle();
}

describe("商务折线点与分类占比真实联动", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    unknownMonth = "";
    mockRead.mockReset().mockImplementation(async (query) => response(query));
    mockWindow.mockReset().mockImplementation(async (query) => response(query));
    mockDownload.mockReset().mockImplementation(() => new Promise(() => {}));
  });
  afterEach(() => jest.useRealTimers());

  it("金额标签和点位同步摘要、完整分类与饼图，不改变折线引用或请求", async () => {
    const wrapper = await open();
    const line = chart(wrapper, "line"),
      originalSeries = line.props("series"),
      originalPeriods = line.props("periods"),
      originalComparison = line.props("comparisonSeries");
    const reads = mockRead.mock.calls.length,
      windows = mockWindow.mock.calls.length;
    await selectLabel(wrapper, "2026-08");
    expect(summary(wrapper)).toBe("¥120.30");
    expect(area(wrapper).get(".business-selection-scope").text()).toContain(
      "2026-08",
    );
    expect(amounts(wrapper, "bar")).toEqual([
      [scopeA, "100.1"],
      [scopeB, "20.2"],
    ]);
    expect(amounts(wrapper, "donut")).toEqual(amounts(wrapper, "bar"));
    await line
      .get('.analysis-line-point[data-source-month="2026-09"]')
      .trigger("click");
    await settle();
    expect(summary(wrapper)).toBe("¥130.40");
    expect(amounts(wrapper, "donut")).toEqual([
      [scopeA, "100.1"],
      [scopeB, "30.3"],
    ]);
    expect(line.props("series")).toBe(originalSeries);
    expect(line.props("periods")).toBe(originalPeriods);
    expect(line.props("comparisonSeries")).toBe(originalComparison);
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09",
    );
    expect(mockRead).toHaveBeenCalledTimes(reads);
    expect(mockWindow).toHaveBeenCalledTimes(windows);
    expect(area(wrapper).findComponent(BusinessDetails).exists()).toBe(false);
    expect(area(wrapper).find(".module-source-notice").exists()).toBe(false);
    await area(wrapper).get('[aria-label="导出商务统计"]').trigger("click");
    expect(mockDownload).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-01", to: "2026-09" }),
      "business",
      "商务联动合成版本",
    );
    wrapper.unmount();
  });

  it("键盘选择同期金额使用真实同比月，关闭同比清除，零月保留精确零和空分类", async () => {
    const wrapper = await open();
    await selectLabel(wrapper, "2026-08", true, true);
    expect(summary(wrapper)).toBe("¥12.30");
    expect(area(wrapper).get(".business-selection-scope").text()).toContain(
      "对比期 · 2025-08",
    );
    expect(amounts(wrapper, "donut")).toEqual([
      [scopeA, "10.1"],
      [scopeB, "2.2"],
    ]);
    await area(wrapper).get(".module-comparison-toggle").trigger("click");
    expect(area(wrapper).find(".business-structure-reset").exists()).toBe(
      false,
    );
    expect(summary(wrapper)).toBe("¥851.30");
    await selectLabel(wrapper, "2026-02");
    expect(summary(wrapper)).toBe("¥0.00");
    expect(amounts(wrapper, "donut")).toEqual([]);
    expect(area(wrapper).get(".business-selection-scope").text()).toContain(
      "2026-02",
    );
    await area(wrapper).get(".business-structure-reset").trigger("click");
    expect(summary(wrapper)).toBe("¥851.30");
    expect(amounts(wrapper, "donut")).toEqual([
      [scopeA, "800.8"],
      [scopeB, "50.5"],
    ]);
    wrapper.unmount();
  });

  it("季度及年度点只聚合对应真实范围，年度同比不借用当年金额", async () => {
    const wrapper = await open();
    await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
    await wrapper.get("form").trigger("submit");
    await settle();
    await chart(wrapper, "line")
      .get('.chart-value-label[data-series="current"][data-period="2026-Q3"]')
      .trigger("click");
    await settle();
    expect(summary(wrapper)).toBe("¥350.80");
    expect(area(wrapper).get(".business-selection-scope").text()).toContain(
      "2026-07 至 2026-09",
    );
    expect(amounts(wrapper, "bar")).toEqual([
      [scopeA, "300.3"],
      [scopeB, "50.5"],
    ]);
    await chart(wrapper, "line")
      .get(
        '.chart-value-label[data-series="comparison"][data-period="2026-Q3"]',
      )
      .trigger("keydown", { key: " " });
    await settle();
    expect(summary(wrapper)).toBe("¥36.90");
    expect(area(wrapper).get(".business-selection-scope").text()).toContain(
      "2025-07 至 2025-09",
    );
    await wrapper.get('[aria-label="分析统计周期"]').setValue("year");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(area(wrapper).find(".business-structure-reset").exists()).toBe(
      false,
    );
    await chart(wrapper, "line")
      .get('.chart-value-label[data-series="current"][data-period="2026"]')
      .trigger("click");
    await settle();
    expect(summary(wrapper)).toBe("¥851.30");
    expect(area(wrapper).get(".business-selection-scope").text()).toContain(
      "2026-01 至 2026-09",
    );
    await chart(wrapper, "line")
      .get('.chart-value-label[data-series="comparison"][data-period="2026"]')
      .trigger("click");
    await settle();
    expect(summary(wrapper)).toBe("¥98.40");
    expect(area(wrapper).get(".business-selection-scope").text()).toContain(
      "2025-01 至 2025-09",
    );
    wrapper.unmount();
  });

  it("重复窗口保留选中，移动窗口清理，历史缓冲明细只取所选月", async () => {
    const wrapper = await open();
    await selectLabel(wrapper, "2026-08");
    chart(wrapper, "line").vm.$emit("window-change", {
      from: "2025-10",
      to: "2026-09",
    });
    await settle();
    expect(summary(wrapper)).toBe("¥120.30");
    chart(wrapper, "line").vm.$emit("window-change", {
      from: "2025-09",
      to: "2026-08",
    });
    await settle();
    expect(area(wrapper).find(".business-structure-reset").exists()).toBe(
      false,
    );
    await selectLabel(wrapper, "2025-09");
    expect(summary(wrapper)).toBe("¥12.30");
    expect(amounts(wrapper, "bar")).toEqual([
      [scopeA, "10.1"],
      [scopeB, "2.2"],
    ]);
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09",
    );
    wrapper.unmount();
  });

  it("隐藏模块、未知点与错期事件不覆盖已选数据，关闭的同比不可选", async () => {
    unknownMonth = "2026-06";
    const wrapper = await open();
    await selectLabel(wrapper, "2026-08");
    const line = chart(wrapper, "line");
    expect(
      line
        .find('.chart-value-label[data-series="current"][data-month="2026-06"]')
        .exists(),
    ).toBe(false);
    line.vm.$emit("point-select", {
      month: "2026-06",
      metricKey: "business",
      comparison: false,
    });
    line.vm.$emit("point-select", {
      month: "2026-09",
      from: "2026-08",
      to: "2026-09",
      metricKey: "business",
      comparison: false,
    });
    await settle();
    expect(summary(wrapper)).toBe("¥120.30");
    await wrapper.get("#analysis-tab-inflow").trigger("click");
    line.vm.$emit("point-select", {
      month: "2026-09",
      metricKey: "business",
      comparison: false,
    });
    await settle();
    expect(summary(wrapper)).toBe("¥120.30");
    await wrapper.get("#analysis-tab-business").trigger("click");
    await area(wrapper).get(".module-comparison-toggle").trigger("click");
    line.vm.$emit("point-select", {
      month: "2025-09",
      metricKey: "business",
      comparison: true,
    });
    await settle();
    expect(summary(wrapper)).toBe("¥120.30");
    wrapper.unmount();
  });

  it("筛选草稿不混入当前点，提交与面板失活清理旧选中", async () => {
    const wrapper = await open();
    await selectLabel(wrapper, "2026-08");
    await wrapper.get('[aria-label="测试结束月"]').setValue("2026-08");
    expect(summary(wrapper)).toBe("¥120.30");
    expect(wrapper.get(".pending-filter-note").text()).toContain("上一组结果");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(area(wrapper).find(".business-structure-reset").exists()).toBe(
      false,
    );
    expect(summary(wrapper)).toBe("¥720.90");
    await selectLabel(wrapper, "2026-08");
    await wrapper.setProps({ active: false });
    await settle();
    expect(area(wrapper).find(".business-structure-reset").exists()).toBe(
      false,
    );
    await wrapper.setProps({ active: true });
    await settle();
    expect(area(wrapper).find(".business-structure-reset").exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it.each([401, 403])(
    "历史接口返回%s后清除财务数据，重新读取不恢复旧商务选中",
    async (status) => {
      const wrapper = await open();
      await selectLabel(wrapper, "2026-08");
      mockWindow.mockRejectedValueOnce({ response: { status } });
      chart(wrapper, "line").vm.$emit("window-change", {
        from: "2023-10",
        to: "2024-09",
      });
      await settle();
      expect(wrapper.find('[data-module="business"]').exists()).toBe(false);
      await wrapper.get("form").trigger("submit");
      await settle();
      expect(area(wrapper).find(".business-structure-reset").exists()).toBe(
        false,
      );
      expect(summary(wrapper)).toBe("¥851.30");
      wrapper.unmount();
    },
  );
});
