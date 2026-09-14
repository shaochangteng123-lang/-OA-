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
import { ElCascader } from "element-plus";
import Panel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import Details from "@/components/monthly-financial/MonthlyFinancialPersonnelDetails.vue";
import Chart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisDetail,
  FinancialAnalysisGranularity,
  FinancialAnalysisModule,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";
const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

let includeUnknown = false;
const people = [
  { id: "p1", name: "员工甲" },
  { id: "p2", name: "员工乙" },
];
function periods(query: FinancialAnalysisQuery) {
  const values = new Map<string, FinancialAnalysisPeriod>();
  for (
    let month = query.from;
    month <= query.to;
    month = financialMonthOffset(month, 1)
  ) {
    const year = month.slice(0, 4),
      quarter = Math.ceil(Number(month.slice(5)) / 3);
    const key =
      query.granularity === "month"
        ? month
        : query.granularity === "quarter"
          ? `${year}-Q${quarter}`
          : year;
    const previous = values.get(key);
    if (previous) previous.to = month;
    else values.set(key, { key, label: key, from: month, to: month });
  }
  return [...values.values()];
}
function personnelModule(
  query: FinancialAnalysisQuery,
): FinancialAnalysisModule {
  const selected = [
    ...people,
    ...(includeUnknown ? [{ id: "unknown:legacy", name: "人员未确认" }] : []),
  ].filter((person) => !query.personId || person.id === query.personId);
  const periodList = periods(query);
  const row = (
    person: (typeof people)[number],
    period: FinancialAnalysisPeriod,
  ): FinancialAnalysisDetail => ({
    id: `${person.id}:${period.key}`,
    sourceId: `${person.id}:${period.key}`,
    personId: person.id,
    person: person.name,
    period: period.key,
    month: period.from,
    from: period.from,
    to: period.to,
    year: period.from.slice(0, 4),
    salary: person.id === "p2" ? "200" : "100",
    social: person.id === "p2" ? "20" : "10",
    housing: person.id === "p2" ? "10" : "5",
    adjustment: "0",
    payrollCost: person.id === "p2" ? "230" : "115",
    basic: "0",
    large: "0",
    business: "0",
    overhead: person.id === "p2" ? "10" : "5",
    total: person.id === "p2" ? "240" : "120",
    knownTotal: person.id === "p2" ? "240" : "120",
    known_payrollCost: person.id === "p2" ? "230" : "115",
    known_salary: person.id === "p2" ? "200" : "100",
    known_social: person.id === "p2" ? "20" : "10",
    known_housing: person.id === "p2" ? "10" : "5",
    known_adjustment: "0",
  });
  const annual = {
    key: query.from.slice(0, 4),
    label: query.from.slice(0, 4),
    from: query.from,
    to: query.to,
  };
  return {
    key: "personnel",
    title: "人力成本分析",
    description: "合成测试",
    sourceLabel: "合成来源",
    updatedAt: null,
    payrollDetailsVisible: true,
    periods: periodList,
    series: ["payrollCost", "knownTotal", "total"].map((key) => ({
      key,
      label: key,
      values: periodList.map(() =>
        String(
          selected.reduce(
            (sum, person) => sum + (person.id === "p2" ? 2 : 1),
            0,
          ) * (key === "payrollCost" ? 115 : 120),
        ),
      ),
    })),
    summaries: [
      {
        key: "total",
        label: "期间费用",
        amount: String(
          selected.reduce(
            (sum, person) => sum + (person.id === "p2" ? 240 : 120),
            0,
          ),
        ),
      },
    ],
    breakdown: [],
    comparison: selected.map((person) => ({
      key: person.id,
      label: person.name,
      amount: person.id === "p2" ? "240" : "120",
    })),
    columns: [
      "salary",
      "social",
      "housing",
      "adjustment",
      "payrollCost",
      "basic",
      "large",
      "business",
      "overhead",
      "total",
    ].map((key) => ({ key, label: key, format: "amount" as const })),
    details: periodList.flatMap((period) =>
      selected.map((person) => row(person, period)),
    ),
    personnelAnnualDetails: selected.map((person) => row(person, annual)),
    warnings: [],
    appliedFilters: [],
  };
}
function response(query: FinancialAnalysisQuery): MonthlyFinancialAnalysisData {
  const modules = (target: FinancialAnalysisQuery) => [
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
    generatedAt: "2026-09-08T00:00:00Z",
    dataVersion: "人员返回合成版本",
    filterOptions: {
      parties: ["甲方一"],
      contractRegions: ["海淀区"],
      reimbursementScopes: ["北京市 / 海淀区", "北京市 / 朝阳区"],
      people,
    },
    modules: modules(query),
    warnings: [],
    ...(previous
      ? {
          comparison: {
            query: previous,
            label: `${query.comparisonYear}年同期`,
            modules: modules(previous),
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
function detail(wrapper: Wrapper) {
  return wrapper.get('[data-module="personnel"]').getComponent(Details);
}
function back(wrapper: Wrapper) {
  return detail(wrapper)
    .findAll("button")
    .find((button) => button.text() === "返回全部人员");
}
function personIds(wrapper: Wrapper) {
  return detail(wrapper)
    .findAll(".personnel-cost-table tbody tr[data-person-id]")
    .map((row) => row.attributes("data-person-id"));
}
async function choose(wrapper: Wrapper, name: string) {
  await detail(wrapper)
    .get(`[aria-label="查看${name}成本构成"]`)
    .trigger("click");
  await settle();
}
async function open() {
  const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
  await settle();
  await wrapper.get("#analysis-tab-personnel").trigger("click");
  return wrapper;
}
function latestQuery(): FinancialAnalysisQuery {
  return mockRead.mock.calls.at(-1)![0];
}

describe("人员费用表返回全部人员", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    includeUnknown = false;
    mockRead.mockReset().mockImplementation(async (query) => response(query));
    mockWindow.mockReset().mockImplementation(async (query) => response(query));
  });
  afterEach(() => jest.useRealTimers());

  it("点击姓名后可返回全部人员，再点击另一人；成功返回清理旧点位", async () => {
    const wrapper = await open();
    expect(back(wrapper)).toBeUndefined();
    expect(personIds(wrapper)).toEqual(["p1", "p2"]);
    await choose(wrapper, "员工甲");
    expect(latestQuery().personId).toBe("p1");
    expect(personIds(wrapper)).toEqual(["p1"]);
    const line = wrapper
      .get('[data-module="personnel"]')
      .findAllComponents(Chart)
      .find((chart) => chart.props("type") === "line")!;
    await line
      .get('.chart-value-label[data-series="current"][data-month="2026-08"]')
      .trigger("click");
    await settle();
    expect(wrapper.find(".personnel-selected-total").exists()).toBe(true);
    await back(wrapper)!.trigger("click");
    await settle();
    expect(latestQuery()).not.toHaveProperty("personId");
    expect(
      (wrapper.get('[aria-label="分析人员"]').element as HTMLSelectElement)
        .value,
    ).toBe("");
    expect(personIds(wrapper)).toEqual(["p1", "p2"]);
    expect(back(wrapper)).toBeUndefined();
    const comparison = wrapper
      .get('[data-module="personnel"]')
      .findAllComponents(Chart)
      .find((item) => item.props("type") === "bar")!;
    expect(
      comparison.props("items").map((item: { key: string }) => item.key),
    ).toEqual(["p2", "p1"]);
    expect(
      detail(wrapper)
        .props("module")
        .comparison.map((item) => item.key),
    ).toEqual(["p1", "p2"]);
    expect(wrapper.find(".personnel-selected-total").exists()).toBe(false);
    await choose(wrapper, "员工乙");
    expect(latestQuery().personId).toBe("p2");
    expect(personIds(wrapper)).toEqual(["p2"]);
    wrapper.unmount();
  });

  it.each<FinancialAnalysisGranularity>(["month", "quarter", "year"])(
    "返回全部保留已提交%s期间、同比和所有业务筛选",
    async (granularity) => {
      const wrapper = await open();
      await wrapper.get('[aria-label="分析统计周期"]').setValue(granularity);
      await wrapper.get('[aria-label="分析甲方"]').setValue("甲方一");
      await wrapper.get('[aria-label="分析合同区域"]').setValue("海淀区");
      await wrapper.get('[aria-label="分析对比年份"]').setValue("2024");
      wrapper
        .getComponent(ElCascader)
        .vm.$emit("update:modelValue", "北京市 / 海淀区");
      await settle();
      await wrapper.get("form").trigger("submit");
      await settle();
      const submitted = { ...latestQuery() };
      await choose(wrapper, "员工甲");
      expect(latestQuery()).toEqual({ ...submitted, personId: "p1" });
      await back(wrapper)!.trigger("click");
      await settle();
      expect(latestQuery()).toEqual(submitted);
      expect(detail(wrapper).props("query")).toEqual(submitted);
      expect(personIds(wrapper)).toEqual(["p1", "p2"]);
      wrapper.unmount();
    },
  );

  it("返回只清人员，不提交日期、粒度、范围及同比草稿", async () => {
    const wrapper = await open();
    await choose(wrapper, "员工甲");
    const submitted = { ...latestQuery() };
    delete submitted.personId;
    await wrapper.get('[aria-label="测试开始月"]').setValue("2025-03");
    await wrapper.get('[aria-label="测试结束月"]').setValue("2025-11");
    await wrapper.get('[aria-label="分析统计周期"]').setValue("quarter");
    await wrapper.get('[aria-label="分析对比年份"]').setValue("2023");
    wrapper
      .getComponent(ElCascader)
      .vm.$emit("update:modelValue", "北京市 / 朝阳区");
    await settle();
    await back(wrapper)!.trigger("click");
    await settle();
    expect(latestQuery()).toEqual(submitted);
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09",
    );
    expect(wrapper.get(".pending-filter-note").text()).toContain("上一组结果");
    expect(
      (wrapper.get('[aria-label="测试开始月"]').element as HTMLInputElement)
        .value,
    ).toBe("2025-03");
    expect(
      (wrapper.get('[aria-label="分析统计周期"]').element as HTMLSelectElement)
        .value,
    ).toBe("quarter");
    expect(wrapper.getComponent(ElCascader).props("modelValue")).toBe(
      "北京市 / 朝阳区",
    );
    wrapper.unmount();
  });

  it("返回加载中禁用按钮并拒绝重复事件，成功响应后恢复全部人员", async () => {
    const wrapper = await open();
    await choose(wrapper, "员工甲");
    let resolve!: (result: MonthlyFinancialAnalysisData) => void;
    mockRead.mockImplementationOnce(
      () =>
        new Promise<MonthlyFinancialAnalysisData>((done) => {
          resolve = done;
        }),
    );
    const reads = mockRead.mock.calls.length;
    await back(wrapper)!.trigger("click");
    await settle();
    expect(back(wrapper)!.attributes("disabled")).toBeDefined();
    await back(wrapper)!.trigger("click");
    detail(wrapper).vm.$emit("clear-person");
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(reads + 1);
    resolve(response(latestQuery()));
    await settle();
    expect(personIds(wrapper)).toEqual(["p1", "p2"]);
    expect(back(wrapper)).toBeUndefined();
    wrapper.unmount();
  });

  it("未知人员不可点击或触发查询，隐藏模块与失活面板不能返回", async () => {
    includeUnknown = true;
    const wrapper = await open(),
      reads = mockRead.mock.calls.length;
    expect(
      detail(wrapper)
        .get('[data-person-id="unknown:legacy"]')
        .find("button")
        .exists(),
    ).toBe(false);
    detail(wrapper).vm.$emit("select-person", "missing-person");
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(reads);
    await choose(wrapper, "员工甲");
    const selectedReads = mockRead.mock.calls.length;
    await wrapper.get("#analysis-tab-inflow").trigger("click");
    detail(wrapper).vm.$emit("clear-person");
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(selectedReads);
    await wrapper.get("#analysis-tab-personnel").trigger("click");
    await wrapper.setProps({ active: false });
    await settle();
    expect(back(wrapper)!.attributes("disabled")).toBeDefined();
    detail(wrapper).vm.$emit("clear-person");
    await settle();
    expect(mockRead).toHaveBeenCalledTimes(selectedReads);
    expect(personIds(wrapper)).toEqual(["p1"]);
    wrapper.unmount();
  });

  it("返回请求遇401清除已显示数据，重新查询不能恢复旧人员点位", async () => {
    const wrapper = await open();
    await choose(wrapper, "员工甲");
    mockRead.mockRejectedValueOnce({ response: { status: 401 } });
    await back(wrapper)!.trigger("click");
    await settle();
    expect(wrapper.find('[data-module="personnel"]').exists()).toBe(false);
    expect(wrapper.find(".personnel-selected-total").exists()).toBe(false);
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(latestQuery()).not.toHaveProperty("personId");
    expect(personIds(wrapper)).toEqual(["p1", "p2"]);
    expect(back(wrapper)).toBeUndefined();
    wrapper.unmount();
  });
});
