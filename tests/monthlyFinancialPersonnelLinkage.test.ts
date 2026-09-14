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
import PersonnelDetails from "@/components/monthly-financial/MonthlyFinancialPersonnelDetails.vue";
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

const parts = [
  "salary",
  "social",
  "housing",
  "adjustment",
  "basic",
  "large",
  "business",
  "overhead",
];
const labels: Record<string, string> = {
  salary: "工资",
  social: "公司社保",
  housing: "公司公积金",
  adjustment: "调整",
  basic: "基础报销",
  large: "大额报销",
  business: "商务报销",
  overhead: "房租",
  payrollCost: "工资成本",
};
let unknownMonth = "",
  partialMonth = "",
  payrollAllowed = true;
function sum(values: string[]) {
  return values.reduce(
    (total, amount) => addFinancialAmountTexts(total, amount),
    "0",
  );
}
function months(from: string, to: string) {
  const result: string[] = [];
  for (let month = from; month <= to; month = financialMonthOffset(month, 1))
    result.push(month);
  return result;
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
    const previous = values.get(key);
    if (previous) previous.to = month;
    else values.set(key, { key, label, from: month, to: month });
  }
  return [...values.values()];
}
function personnelModule(
  query: FinancialAnalysisQuery,
): FinancialAnalysisModule {
  const details: FinancialAnalysisDetail[] = months(
    query.from,
    query.to,
  ).flatMap((month) =>
    [1, 2]
      .filter((person) => !query.personId || query.personId === `p${person}`)
      .map((person) => {
        const current = month.startsWith("2026-"),
          first = person === 1;
        const amounts = month.endsWith("-02")
          ? parts.map(() => "0")
          : [
              current
                ? first
                  ? "100.10"
                  : "200.20"
                : first
                  ? "10.10"
                  : "20.20",
              current ? (first ? "10.10" : "20.20") : first ? "1.10" : "2.20",
              current ? (first ? "1.10" : "2.20") : first ? "0.10" : "0.20",
              "0",
              first ? "0.10" : "0.20",
              "0",
              current ? "5.10" : "1.10",
              current
                ? first
                  ? month.endsWith("-09")
                    ? "20.20"
                    : "10.10"
                  : month.endsWith("-09")
                    ? "40.40"
                    : "20.20"
                : first
                  ? "1.10"
                  : "2.20",
            ];
        const row: FinancialAnalysisDetail = {
          id: `${month}:p${person}`,
          sourceId: `${month}:p${person}`,
          personId: `p${person}`,
          person: `员工${person}`,
          month,
          date: `${month}-12`,
          payrollCost: sum(amounts.slice(0, 4)),
          known_payrollCost: sum(amounts.slice(0, 4)),
          total: sum(amounts),
          knownTotal: sum(amounts),
        };
        for (let index = 0; index < parts.length; index++) {
          row[parts[index]] = amounts[index];
          row[`known_${parts[index]}`] = amounts[index];
        }
        if (month === partialMonth) {
          row.overhead = null;
          row.total = null;
        }
        return row;
      }),
  );
  const periodList = periods(query);
  const periodRows = (period: FinancialAnalysisPeriod) =>
    details.filter(
      (row) => row.month! >= period.from && row.month! <= period.to,
    );
  return {
    key: "personnel",
    title: "人力成本分析",
    description: "工资报销房租按真实月份统计",
    sourceLabel: "合成核验来源",
    updatedAt: null,
    payrollDetailsVisible: payrollAllowed,
    periods: periodList,
    series: ["payrollCost", "knownTotal", "total"].map((key) => ({
      key,
      label: labels[key] || key,
      values: periodList.map((period) =>
        key === "payrollCost" &&
        unknownMonth >= period.from &&
        unknownMonth <= period.to
          ? null
          : key === "total" &&
              periodRows(period).some((row) => row.total === null)
            ? null
            : sum(periodRows(period).map((row) => row[key]!)),
      ),
    })),
    summaries: [
      {
        key: "total",
        label: "期间人力成本",
        amount: sum(details.map((row) => row.knownTotal!)),
      },
    ],
    breakdown: [],
    comparison: [1, 2].map((person) => ({
      key: `p${person}`,
      label: `员工${person}`,
      amount: sum(
        details
          .filter((row) => row.personId === `p${person}`)
          .map((row) => row.knownTotal!),
      ),
    })),
    columns: [...parts, "payrollCost"].map((key) => ({
      key,
      label: labels[key],
      format: "amount" as const,
    })),
    details,
    warnings: [],
    appliedFilters: [],
  };
}
function response(query: FinancialAnalysisQuery): MonthlyFinancialAnalysisData {
  const buildModules = (target: FinancialAnalysisQuery) => [
    {
      ...personnelModule(target),
      key: "inflow" as const,
      title: "一般账户入账统计",
      breakdown: [],
      comparison: [],
    },
    personnelModule(target),
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
    dataVersion: "人力联动合成版本",
    generatedAt: "2026-09-07T00:00:00Z",
    warnings: [],
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [
        { id: "p1", name: "员工1" },
        { id: "p2", name: "员工2" },
      ],
    },
    modules: buildModules(query),
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
  return wrapper.get('[data-module="personnel"]');
}
function chart(wrapper: Wrapper, type: string) {
  return area(wrapper)
    .findAllComponents(Chart)
    .find((item) => item.props("type") === type)!;
}
function amounts(wrapper: Wrapper) {
  return Object.fromEntries(
    chart(wrapper, "donut")
      .props("items")
      .map((item: { key: string; amount: string | null }) => [
        item.key,
        item.amount,
      ]),
  );
}
function total(wrapper: Wrapper) {
  return area(wrapper).get(".personnel-selected-total strong").text();
}
async function open() {
  const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
  await settle();
  await wrapper.get("#analysis-tab-personnel").trigger("click");
  return wrapper;
}
async function selectMonth(
  wrapper: Wrapper,
  month: string,
  comparison = false,
  keyboard = false,
) {
  await chart(wrapper, "line")
    .get(
      `.chart-value-label[data-series="${comparison ? "comparison" : "current"}"][data-month="${month}"]`,
    )
    .trigger(
      keyboard ? "keydown" : "click",
      keyboard ? { key: "Enter" } : undefined,
    );
  await settle();
}

describe("人力折线点与当期成本饼图联动", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    unknownMonth = "";
    partialMonth = "";
    payrollAllowed = true;
    mockRead.mockReset().mockImplementation(async (query) => response(query));
    mockWindow.mockReset().mockImplementation(async (query) => response(query));
    mockDownload.mockReset().mockImplementation(() => new Promise(() => {}));
  });
  afterEach(() => jest.useRealTimers());

  it("金额与点位聚合所有人员当月分项，不改变主统计表、摘要、折线或导出范围", async () => {
    const wrapper = await open(),
      line = chart(wrapper, "line"),
      table = area(wrapper).getComponent(PersonnelDetails);
    const originalSeries = line.props("series"),
      originalPeriods = line.props("periods"),
      originalModule = table.props("module"),
      originalQuery = table.props("query"),
      originalComparison = chart(wrapper, "bar").props("items"),
      summary = area(wrapper).get(".analysis-summaries").text();
    const reads = mockRead.mock.calls.length,
      windows = mockWindow.mock.calls.length;
    await selectMonth(wrapper, "2026-08");
    expect(total(wrapper)).toBe("¥374.70");
    expect(area(wrapper).get(".structure-scope").text()).toContain(
      "2026-08 · 全部人员",
    );
    expect(amounts(wrapper)).toMatchObject({
      salary: "300.3",
      social: "30.3",
      housing: "3.3",
      basic: "0.3",
      business: "10.2",
      overhead: "30.3",
    });
    await line
      .get('.analysis-line-point[data-source-month="2026-09"]')
      .trigger("click");
    await settle();
    expect(total(wrapper)).toBe("¥405.00");
    expect(amounts(wrapper).overhead).toBe("60.6");
    expect(line.props("series")).toBe(originalSeries);
    expect(line.props("periods")).toBe(originalPeriods);
    expect(table.props("module")).toBe(originalModule);
    expect(table.props("query")).toBe(originalQuery);
    expect(chart(wrapper, "bar").props("items")).toBe(originalComparison);
    expect(area(wrapper).get(".analysis-summaries").text()).toBe(summary);
    expect(mockRead).toHaveBeenCalledTimes(reads);
    expect(mockWindow).toHaveBeenCalledTimes(windows);
    await area(wrapper).get('[aria-label="导出人力成本分析"]').trigger("click");
    expect(mockDownload).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-01", to: "2026-09" }),
      "personnel",
      "人力联动合成版本",
    );
    wrapper.unmount();
  });

  it("选中人员提交后只显示该人员，待确认分项保留已知金额，返回恢复统计期间", async () => {
    partialMonth = "2026-08";
    const wrapper = await open();
    await wrapper.get('[aria-label="分析人员"]').setValue("p1");
    await wrapper.get("form").trigger("submit");
    await settle();
    const defaultItems = chart(wrapper, "donut").props("items");
    await selectMonth(wrapper, "2026-08");
    expect(total(wrapper)).toBe("¥126.60");
    expect(area(wrapper).get(".personnel-selected-total").text()).toContain(
      "已知成本合计",
    );
    expect(area(wrapper).get(".structure-scope").text()).toContain(
      "2026-08 · 员工1",
    );
    expect(amounts(wrapper)).toMatchObject({
      salary: "100.10",
      social: "10.10",
      overhead: "10.10",
    });
    await area(wrapper).get(".personnel-structure-reset").trigger("click");
    expect(area(wrapper).find(".personnel-selected-total").exists()).toBe(
      false,
    );
    expect(chart(wrapper, "donut").props("items")).toEqual(defaultItems);
    wrapper.unmount();
  });

  it("键盘选择同期点使用实际同比月份，关闭同比清理，零月保持零成本", async () => {
    const wrapper = await open();
    await selectMonth(wrapper, "2026-08", true, true);
    expect(total(wrapper)).toBe("¥39.70");
    expect(area(wrapper).get(".structure-scope").text()).toContain(
      "对比期 · 2025-08",
    );
    expect(amounts(wrapper).salary).toBe("30.3");
    await area(wrapper).get(".module-comparison-toggle").trigger("click");
    expect(area(wrapper).find(".personnel-structure-reset").exists()).toBe(
      false,
    );
    await selectMonth(wrapper, "2026-02");
    expect(total(wrapper)).toBe("¥0.00");
    expect(
      Object.values(amounts(wrapper)).every((value) => value === "0"),
    ).toBe(true);
    wrapper.unmount();
  });

  it("季度和年度只取实际点选期间，不能使用截止月份或全历史代替", async () => {
    const wrapper = await open();
    await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
    await wrapper.get("form").trigger("submit");
    await settle();
    await chart(wrapper, "line")
      .get('.chart-value-label[data-series="current"][data-period="2026-Q3"]')
      .trigger("click");
    await settle();
    expect(total(wrapper)).toBe("¥1,154.40");
    expect(area(wrapper).get(".structure-scope").text()).toContain(
      "2026-07 至 2026-09",
    );
    expect(amounts(wrapper).salary).toBe("900.9");
    await chart(wrapper, "line")
      .get(
        '.chart-value-label[data-series="comparison"][data-period="2026-Q3"]',
      )
      .trigger("click");
    await settle();
    expect(total(wrapper)).toBe("¥119.10");
    expect(area(wrapper).get(".structure-scope").text()).toContain(
      "2025-07 至 2025-09",
    );
    await wrapper.get('[aria-label="分析统计周期"]').setValue("year");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(area(wrapper).find(".personnel-structure-reset").exists()).toBe(
      false,
    );
    await chart(wrapper, "line")
      .get('.chart-value-label[data-series="current"][data-period="2026"]')
      .trigger("click");
    await settle();
    expect(total(wrapper)).toBe("¥3,027.90");
    expect(area(wrapper).get(".structure-scope").text()).toContain(
      "2026-01 至 2026-09",
    );
    await chart(wrapper, "line")
      .get('.chart-value-label[data-series="comparison"][data-period="2026"]')
      .trigger("click");
    await settle();
    expect(total(wrapper)).toBe("¥317.60");
    expect(area(wrapper).get(".structure-scope").text()).toContain(
      "2025-01 至 2025-09",
    );
    wrapper.unmount();
  });

  it("相同窗口保留所选点，移动历史窗和查询或失活清理，草稿仍按已查询人员", async () => {
    const wrapper = await open();
    await selectMonth(wrapper, "2026-08");
    const line = chart(wrapper, "line");
    line.vm.$emit("window-change", { from: "2025-10", to: "2026-09" });
    await settle();
    expect(total(wrapper)).toBe("¥374.70");
    line.vm.$emit("window-change", { from: "2025-09", to: "2026-08" });
    await settle();
    expect(area(wrapper).find(".personnel-structure-reset").exists()).toBe(
      false,
    );
    await selectMonth(wrapper, "2025-09");
    expect(total(wrapper)).toBe("¥39.70");
    await wrapper.get('[aria-label="分析人员"]').setValue("p2");
    expect(area(wrapper).get(".structure-scope").text()).toContain("全部人员");
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(area(wrapper).find(".personnel-structure-reset").exists()).toBe(
      false,
    );
    await selectMonth(wrapper, "2026-08");
    expect(total(wrapper)).toBe("¥248.10");
    await wrapper.setProps({ active: false });
    await settle();
    expect(area(wrapper).find(".personnel-structure-reset").exists()).toBe(
      false,
    );
    await wrapper.setProps({ active: true });
    await settle();
    expect(area(wrapper).find(".personnel-structure-reset").exists()).toBe(
      false,
    );
    wrapper.unmount();
  });

  it("未知点、错误范围、隐藏模块及已关闭同比事件不覆盖合法选中", async () => {
    unknownMonth = "2026-06";
    const wrapper = await open();
    await selectMonth(wrapper, "2026-08");
    const line = chart(wrapper, "line");
    line.vm.$emit("point-select", {
      month: "2026-06",
      metricKey: "payrollCost",
      comparison: false,
    });
    line.vm.$emit("point-select", {
      month: "2026-09",
      from: "2026-08",
      to: "2026-09",
      metricKey: "payrollCost",
      comparison: false,
    });
    await settle();
    expect(total(wrapper)).toBe("¥374.70");
    await wrapper.get("#analysis-tab-inflow").trigger("click");
    line.vm.$emit("point-select", {
      month: "2026-09",
      metricKey: "payrollCost",
      comparison: false,
    });
    await settle();
    expect(total(wrapper)).toBe("¥374.70");
    await wrapper.get("#analysis-tab-personnel").trigger("click");
    await area(wrapper).get(".module-comparison-toggle").trigger("click");
    line.vm.$emit("point-select", {
      month: "2025-08",
      metricKey: "payrollCost",
      comparison: true,
    });
    await settle();
    expect(total(wrapper)).toBe("¥374.70");
    wrapper.unmount();
  });

  it("无工资分项权限的账号不能触发成本饼图", async () => {
    payrollAllowed = false;
    const wrapper = await open();
    chart(wrapper, "line").vm.$emit("point-select", {
      month: "2026-08",
      metricKey: "payrollCost",
      comparison: false,
    });
    await settle();
    expect(area(wrapper).find(".personnel-selected-total").exists()).toBe(
      false,
    );
    expect(area(wrapper).find(".personnel-structure-reset").exists()).toBe(
      false,
    );
    expect(chart(wrapper, "donut")).toBeUndefined();
    expect(area(wrapper).get(".payroll-permission-note").text()).toContain(
      "工资查看权限",
    );
    wrapper.unmount();
  });
});
