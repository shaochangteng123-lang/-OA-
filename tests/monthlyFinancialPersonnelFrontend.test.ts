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
      methods: { close: jest.fn() },
      template: "<div>统计期间</div>",
    },
  }),
);
import { nextTick } from "vue";
import Panel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import Chart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { protectMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysisPermissions";
import { financialAnalysisNoticeKind } from "@/utils/monthlyFinancialAnalysisNotices";
import { buildFinancialAnalysisStructure } from "@/utils/monthlyFinancialAnalysisStructure";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisModuleKey,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  FinancialAnalysisSeries,
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
const metricLabels: Array<[string, string]> = [
  ["payrollCost", "工资总成本（含公司缴费）"],
  ["salary", "应发工资"],
  ["social", "公司社保"],
  ["housing", "公司公积金"],
  ["adjustment", "实际发生调整"],
  ["basic", "基础报销"],
  ["large", "大额报销"],
  ["business", "商务报销"],
  ["overhead", "公共费用分摊"],
  ["knownTotal", "期间已录入部分合计"],
  ["total", "完整总成本"],
];
const sensitive = ["salary", "social", "housing", "adjustment"];
const secret = "98765.123456789012";
const precise = "123456789012345678.123456789012";
const permissionNote =
  "工资、公司社保、公积金及实际调整分项沿用工资模块管理员权限；当前账号仅查看已授权的成本合计与费用明细。";
const information = [
  "公共费用仅按已核验票款分配和明确手工电费计算；没有可靠来源的费用不猜测。",
  "年度总额按自然年已录入费用汇总；来源缺失或未建立月报的月份不表示费用真实为零。",
];
let role = "admin";
let payrollUnknown = false;
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
          ? `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5)) / 3)}`
          : month;
    const group = groups.get(key);
    if (group) group.to = month;
    else groups.set(key, { key, label: key, from: month, to: month });
  }
  return [...groups.values()];
}
function fixture(query: FinancialAnalysisQuery): MonthlyFinancialAnalysisData {
  const periods = periodsFor(query);
  const valueFor = (
    key: string,
    period: FinancialAnalysisPeriod,
  ): string | null => {
    if (key === "total") return null;
    if (key === "payrollCost" && payrollUnknown) return null;
    if (key === "knownTotal") return precise;
    if (period.to.endsWith("-02")) return "0";
    if (period.to.endsWith("-04")) return null;
    if (sensitive.includes(key)) return secret;
    return key === "payrollCost" ? precise : "2053235.4";
  };
  const data: MonthlyFinancialAnalysisData = {
    query: { ...query },
    generatedAt: "2026-09-04T00:00:00Z",
    dataVersion: "合成人力指标" + role,
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [{ id: "employee-a", name: "合成员工" }],
    },
    warnings: [],
    modules: keys.map((key) => ({
      key,
      title: key === "personnel" ? "人力成本分析" : key,
      description: "合成人力指标验证",
      sourceLabel: "合成来源",
      updatedAt: null,
      periods,
      series:
        key === "personnel"
          ? metricLabels.map(([key, label]) => ({
              key,
              label,
              values: periods.map((period) => valueFor(key, period)),
            }))
          : [{ key: "total", label: "合计", values: periods.map(() => "100") }],
      summaries:
        key === "personnel"
          ? [
              { key: "total", label: "完整总成本", amount: null },
              {
                key: "knownTotal",
                label: "期间已录入部分合计",
                amount: precise,
              },
              {
                key: "payrollCost",
                label: "工资总成本（含公司缴费）",
                amount: payrollUnknown ? null : precise,
              },
            ]
          : [{ key: "total", label: "合计", amount: "100" }],
      breakdown:
        key === "personnel"
          ? sensitive.map((key) => ({ key, label: key, amount: secret }))
          : [],
      comparison: [],
      columns:
        key === "personnel"
          ? metricLabels.map(([key, label]) => ({
              key,
              label,
              format: "amount" as const,
            }))
          : [],
      details:
        key === "personnel"
          ? periods.map((period) => ({
              id: period.key,
              ...Object.fromEntries(
                metricLabels.map(([key]) => [key, valueFor(key, period)]),
              ),
            }))
          : [],
      warnings: key === "personnel" ? information : [],
      appliedFilters: [],
    })),
  };
  if (query.comparisonYear !== undefined) {
    const offset = (query.comparisonYear - Number(query.from.slice(0, 4))) * 12;
    const previous = {
      ...query,
      from: financialMonthOffset(query.from, offset),
      to: financialMonthOffset(query.to, offset),
    };
    delete previous.comparisonYear;
    data.comparison = {
      label: `${query.comparisonYear}年同期`,
      query: previous,
      modules: fixture(previous).modules,
      warnings: [],
    };
  }
  return protectMonthlyFinancialAnalysis(data, role);
}
async function settle() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
function lineFor(
  wrapper: PanelWrapper,
  key: FinancialAnalysisModuleKey = "personnel",
) {
  return wrapper
    .get(`[data-module="${key}"]`)
    .findAllComponents(Chart)
    .find((chart) => chart.props("type") === "line")!;
}
const selector = '[aria-label="选择折线指标"]';
const selectedMetric = (line: ReturnType<typeof lineFor>) =>
  (line.get(selector).element as HTMLSelectElement).value;

describe("人力新增指标的真实面板与图表", () => {
  const wrappers: PanelWrapper[] = [];
  const hosts: HTMLElement[] = [];
  const fullscreenDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "fullscreenElement",
  );
  const requestDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "requestFullscreen",
  );
  const exitDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "exitFullscreen",
  );
  beforeEach(() => {
    jest.useFakeTimers();
    role = "admin";
    payrollUnknown = false;
    mockRead
      .mockReset()
      .mockImplementation((query: FinancialAnalysisQuery) =>
        Promise.resolve(fixture(query)),
      );
    mockWindow
      .mockReset()
      .mockImplementation((query: FinancialAnalysisQuery) =>
        Promise.resolve(fixture(query)),
      );
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: jest.fn(function (this: HTMLElement) {
        Object.defineProperty(document, "fullscreenElement", {
          configurable: true,
          value: this,
        });
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: jest.fn(() => {
        Object.defineProperty(document, "fullscreenElement", {
          configurable: true,
          value: null,
        });
        document.dispatchEvent(new Event("fullscreenchange"));
        return Promise.resolve();
      }),
    });
  });
  afterEach(async () => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    await settle();
    hosts.splice(0).forEach((host) => host.remove());
    for (const [target, key, descriptor] of [
      [document, "fullscreenElement", fullscreenDescriptor],
      [HTMLElement.prototype, "requestFullscreen", requestDescriptor],
      [document, "exitFullscreen", exitDescriptor],
    ] as const) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  async function render() {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    const wrapper = mount(Panel, {
      attachTo: host,
      props: { selectedMonth: "2026-09" },
    });
    wrappers.push(wrapper);
    await settle();
    await wrapper.get("#analysis-tab-personnel").trigger("click");
    await settle();
    return wrapper;
  }

  it("管理员获得全部11指标，默认工资总成本，金额十二位与真实零连线保持", async () => {
    const wrapper = await render();
    const line = lineFor(wrapper);
    expect(
      line
        .get(selector)
        .findAll("option")
        .map((option) => option.attributes("value")),
    ).toEqual(metricLabels.map(([key]) => key));
    expect(selectedMetric(line)).toBe("payrollCost");
    expect(line.props("preferredMetricKeys")).toEqual([
      "payrollCost",
      "knownTotal",
    ]);
    expect(line.findAll(".chart-month-slot")).toHaveLength(12);
    expect(
      line
        .get(
          '.chart-value-label[data-series="current"][data-month="2026-03"] .amount-label-value',
        )
        .text(),
    ).toBe("¥123,456,789,012,345,678.123456789012");
    expect(
      line
        .get(
          '.chart-value-label[data-series="current"][data-month="2026-02"] .amount-label-value',
        )
        .text(),
    ).toBe("¥0.00");
    expect(
      line
        .find(
          '[data-series="current"] [data-from-month="2026-01"][data-to-month="2026-02"]',
        )
        .exists(),
    ).toBe(true);
    expect(
      line
        .find(
          '[data-series="current"] [data-from-month="2026-02"][data-to-month="2026-03"]',
        )
        .exists(),
    ).toBe(true);
    expect(
      line
        .find(
          '[data-series="current"] .analysis-line-point[data-month="2026-04"]',
        )
        .exists(),
    ).toBe(false);
    expect(
      line
        .find(
          '[data-series="current"] [data-from-month="2026-03"][data-to-month="2026-05"]',
        )
        .exists(),
    ).toBe(false);
    const area = wrapper.get('[data-module="personnel"]');
    expect(area.get(".summary-partial-note").text()).toContain(
      "不代表完整总额",
    );
    expect(area.find(".module-source-notice").exists()).toBe(false);
    for (const key of keys.filter((key) => key !== "personnel"))
      expect(lineFor(wrapper, key).props("preferredMetricKeys")).toEqual(
        key === "outflow" ? ["categoryTotal"] : [],
      );
  });

  it("工资成本全未知时选择已知部分而非完整总成本，完整摘要仍未知", async () => {
    payrollUnknown = true;
    const wrapper = await render();
    const line = lineFor(wrapper);
    expect(selectedMetric(line)).toBe("knownTotal");
    expect(line.get('option[value="knownTotal"]').text()).toContain("部分");
    expect(
      wrapper.get('[data-module="personnel"] .analysis-summary strong').text(),
    ).toBe("未知／未核算");
    expect(
      line
        .get(
          '.chart-value-label[data-series="current"][data-month="2026-03"] .amount-label-value',
        )
        .text(),
    ).toBe("¥123,456,789,012,345,678.123456789012");
  });

  it("总经理本期同期仅七个获准指标，历史滑动不恢复工资四分项或抢回手选", async () => {
    role = "general_manager";
    const wrapper = await render();
    const line = lineFor(wrapper);
    const safeKeys = metricLabels
      .map(([key]) => key)
      .filter((key) => !sensitive.includes(key));
    expect(
      line
        .get(selector)
        .findAll("option")
        .map((option) => option.attributes("value")),
    ).toEqual(safeKeys);
    expect(
      line
        .props("comparisonSeries")
        .map((series: FinancialAnalysisSeries) => series.key),
    ).toEqual(safeKeys);
    expect(wrapper.get('[data-module="personnel"]').text()).not.toContain(
      secret,
    );
    expect(selectedMetric(line)).toBe("payrollCost");
    await line.get(selector).setValue("basic");
    line.vm.$emit("window-change", { from: "2024-10", to: "2025-09" });
    await settle();
    expect(selectedMetric(line)).toBe("basic");
    expect(line.props("windowEnd")).toBe("2025-09");
    expect(
      line.props("series").map((series: FinancialAnalysisSeries) => series.key),
    ).toEqual(safeKeys);
    expect(
      line
        .props("comparisonSeries")
        .map((series: FinancialAnalysisSeries) => series.key),
    ).toEqual(safeKeys);
    expect(
      line
        .get(
          '.analysis-line-series[data-series="comparison"] .analysis-line-point[data-month="2025-02"]',
        )
        .attributes("data-source-month"),
    ).toBe("2024-02");
    expect(line.findAll(".chart-month-slot")).toHaveLength(12);
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09",
    );
    expect(
      wrapper.findAll(
        ".module-source,.analysis-period-table,.analysis-details,.detail-pagination",
      ),
    ).toHaveLength(0);
  });

  it("全屏中降权移除已选工资指标与同期金额，安全回退到获准工资成本", async () => {
    const wrapper = await render();
    const line = lineFor(wrapper);
    await line.get(selector).setValue("salary");
    expect(selectedMetric(line)).toBe("salary");
    await wrapper
      .get('[data-module="personnel"] .module-fullscreen-toggle')
      .trigger("click");
    await settle();
    expect(document.fullscreenElement).toBe(wrapper.element);
    expect(wrapper.classes()).toContain("is-fullscreen");
    expect(
      line
        .get(
          '.chart-value-label[data-series="current"][data-month="2026-03"] .amount-label-value',
        )
        .text(),
    ).toBe("¥98,765.123456789012");
    role = "general_manager";
    await wrapper.setProps({ refreshKey: 1 });
    await settle();
    const safeLine = lineFor(wrapper);
    expect(selectedMetric(safeLine)).toBe("payrollCost");
    for (const key of sensitive) {
      expect(safeLine.find(`option[value="${key}"]`).exists()).toBe(false);
      expect(
        safeLine.find(`.analysis-line-series[data-metric="${key}"]`).exists(),
      ).toBe(false);
    }
    expect(wrapper.get('[data-module="personnel"]').text()).not.toContain(
      "98,765.123456789012",
    );
    expect(wrapper.get(".payroll-permission-note").text()).toContain(
      "已授权成本合计",
    );
  });

  it("手动选完整总成本后同条件刷新不抢回默认，未知总成本不被填充", async () => {
    const wrapper = await render();
    await lineFor(wrapper).get(selector).setValue("total");
    await wrapper.setProps({ refreshKey: 1 });
    await settle();
    const line = lineFor(wrapper);
    expect(selectedMetric(line)).toBe("total");
    expect(line.findAll(".analysis-line-point")).toHaveLength(0);
    expect(line.text()).toContain("未知数据不会按零连线");
  });

  it("季度年度返回的新分项仍可选择，切同期显示开关不恢复被保护分项", async () => {
    role = "general_manager";
    const wrapper = await render();
    for (const granularity of ["quarter", "year"]) {
      await wrapper.get('[aria-label="分析统计周期"]').setValue(granularity);
      await wrapper.get("form").trigger("submit");
      await settle();
      const line = lineFor(wrapper);
      expect(line.props("quarterHistory")).toBe(granularity === "quarter");
      expect(line.props("periodView")).toBe(granularity === "year");
      expect(
        line
          .props("series")
          .map((series: FinancialAnalysisSeries) => series.key),
      ).not.toEqual(expect.arrayContaining(sensitive));
      await line.get(selector).setValue("overhead");
      await wrapper
        .get('[data-module="personnel"] .module-comparison-toggle')
        .trigger("click");
      await settle();
      expect(selectedMetric(line)).toBe("overhead");
      expect(
        line.find('.analysis-line-series[data-series="comparison"]').exists(),
      ).toBe(false);
      await wrapper
        .get('[data-module="personnel"] .module-comparison-toggle')
        .trigger("click");
    }
  });
});

describe("业务默认指标的局部选择规则", () => {
  const periods = [
    { key: "2026-01", label: "一月", from: "2026-01", to: "2026-01" },
    { key: "2026-02", label: "二月", from: "2026-02", to: "2026-02" },
  ];
  const series = [
    { key: "payrollCost", label: "工资总成本", values: ["0", "0"] },
    { key: "knownTotal", label: "已知部分", values: ["10", "20"] },
    { key: "total", label: "完整总成本", values: ["10", "20"] },
  ];
  it("工资成本真实零仍是有效默认，不被非零已知部分或完整总额取代", () => {
    const wrapper = mount(Chart, {
      props: {
        type: "line",
        title: "人力",
        periods,
        series,
        preferredMetricKeys: ["payrollCost", "knownTotal"],
      },
    });
    expect((wrapper.get(selector).element as HTMLSelectElement).value).toBe(
      "payrollCost",
    );
    wrapper.unmount();
  });
  it("未指定业务优先级时保持原来的total默认，不影响其他六模块", () => {
    const wrapper = mount(Chart, {
      props: { type: "line", title: "其他模块", periods, series },
    });
    expect((wrapper.get(selector).element as HTMLSelectElement).value).toBe(
      "total",
    );
    wrapper.unmount();
  });
  it("缓冲外工资已知不代表可见十二月已知，缓存内换窗才自动调整未手选默认", async () => {
    const all = periodsFor({
      from: "2024-10",
      to: "2026-09",
      granularity: "month",
    });
    const wrapper = mount(Chart, {
      props: {
        type: "line",
        title: "人力",
        periods: all,
        series: [
          {
            key: "payrollCost",
            label: "工资总成本",
            values: all.map((period) =>
              period.from < "2025-10" ? "10" : null,
            ),
          },
          { key: "knownTotal", label: "已知部分", values: all.map(() => "20") },
        ],
        preferredMetricKeys: ["payrollCost", "knownTotal"],
        fixedMonthWindow: true,
        windowEnd: "2026-09",
      },
    });
    expect((wrapper.get(selector).element as HTMLSelectElement).value).toBe(
      "knownTotal",
    );
    await wrapper.setProps({ windowEnd: "2025-09" });
    await settle();
    expect((wrapper.get(selector).element as HTMLSelectElement).value).toBe(
      "payrollCost",
    );
    wrapper.unmount();
  });
  it("人力通用口径和权限提示不冒充来源异常，具体缺项仍醒目", () => {
    for (const message of [...information, permissionNote])
      expect(financialAnalysisNoticeKind(message)).toBe("information");
    expect(
      financialAnalysisNoticeKind(
        "2026-08公共费用缺少票款核验，不能按零处理。",
      ),
    ).toBe("review");
  });
  it("人员构成只汇总原八项，不重复加入工资总成本和已知合计，完整人员比较仍未知", () => {
    role = "admin";
    const query: FinancialAnalysisQuery = {
      from: "2026-08",
      to: "2026-08",
      granularity: "month",
      personId: "employee-a",
    };
    const module = fixture(query).modules.find(
      (item) => item.key === "personnel",
    )!;
    const parts = {
      salary: "100",
      social: "20",
      housing: "5",
      adjustment: "0",
      basic: "3",
      large: "4",
      business: "5",
      overhead: "6",
    };
    module.breakdown = Object.keys(parts).map((key) => ({
      key,
      label: key,
      amount: null,
    }));
    module.details = [
      {
        id: "one",
        sourceId: "source-one",
        month: "2026-08",
        personId: "employee-a",
        ...parts,
        payrollCost: "125",
        knownTotal: "143",
        total: null,
      },
    ];
    module.comparison = [
      { key: "employee-a", label: "合成员工", amount: null },
    ];
    const before = JSON.stringify(module);
    const result = buildFinancialAnalysisStructure(module, query);
    expect(
      Object.fromEntries(result.items.map((item) => [item.key, item.amount])),
    ).toEqual(parts);
    expect(result.items).toHaveLength(8);
    expect(result.isPartial).toBe(true);
    expect(result.note).toContain("不代表完整期间总额");
    expect(module.comparison[0].amount).toBeNull();
    expect(JSON.stringify(module)).toBe(before);
  });
});
