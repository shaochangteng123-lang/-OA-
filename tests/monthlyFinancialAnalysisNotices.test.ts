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
import {
  buildMonthlyFinancialAnalysisNotices,
  financialAnalysisNoticeKind,
  isKnownPartialAnalysisValue,
} from "@/utils/monthlyFinancialAnalysisNotices";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
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
const query: FinancialAnalysisQuery = {
  from: "2026-01",
  to: "2026-09",
  granularity: "month",
  comparisonYear: 2025,
};
const diagnostic =
  "全历史日期诊断，25笔商务报销缺少付款业务日期，无法归入任何月度统计；请核对实际付款凭证。";
function fixture(request = query): MonthlyFinancialAnalysisData {
  const periods: FinancialAnalysisPeriod[] = [];
  for (
    let month = request.from;
    month <= request.to;
    month = financialMonthOffset(month, 1)
  )
    periods.push({ key: month, label: month, from: month, to: month });
  return {
    query: { ...request },
    generatedAt: "2026-09-04T00:00:00Z",
    dataVersion: "合成来源提示版本",
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    warnings: [],
    modules: keys.map((key) => ({
      key,
      title: key,
      description: "合成来源提示验证",
      sourceLabel: "原来源说明不恢复旧区域",
      updatedAt: null,
      periods,
      series: [
        {
          key: "total",
          label: "合计",
          values: periods.map((period) =>
            period.to.endsWith("-02")
              ? "0"
              : period.to.endsWith("-04")
                ? null
                : "2053235.4",
          ),
        },
      ],
      summaries: [{ key: "total", label: "完整期间合计", amount: null }],
      breakdown: [],
      comparison: [],
      columns: [],
      details: [],
      warnings: [],
      appliedFilters: [],
    })),
  };
}
function moduleFor(
  data: MonthlyFinancialAnalysisData,
  key: FinancialAnalysisModuleKey = "business",
) {
  return data.modules.find((module) => module.key === key)!;
}
async function settle() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe("来源提示口径归类与范围", () => {
  it.each([
    "全历史日期诊断，25笔商务报销缺少付款业务日期。",
    "项目甲：币种为空，无法确认人民币金额。",
    "历史缺月保留未知值。",
    "金额不一致，需核对来源。",
  ])("真实来源问题标为待核对：%s", (message) => {
    expect(financialAnalysisNoticeKind(message)).toBe("review");
  });
  it.each([
    "缺失数据不按零处理。",
    "未知金额不补零。",
    "公共费用仅成本归属，不重复增加公司支出。",
    "工资分项仅向管理员开放，当前账号沿用既有权限。",
    "商务报销不使用甲方／合同区域筛选，服务对象文本不视为合同甲方。",
  ])("一般口径不标成数据错误：%s", (message) => {
    expect(financialAnalysisNoticeKind(message)).toBe("information");
  });
  it("全历史诊断按原文透传动态数量并去重，不谎称当前期间笔数", () => {
    const data = fixture();
    data.warnings = [diagnostic, diagnostic];
    data.comparison = {
      label: "同期",
      query: { from: "2025-01", to: "2025-09", granularity: "month" },
      modules: [],
      warnings: [diagnostic],
    };
    const history = fixture({
      from: "2024-10",
      to: "2026-09",
      granularity: "month",
    });
    history.warnings = [diagnostic];
    const before = JSON.stringify({ data, history });
    const view = buildMonthlyFinancialAnalysisNotices(
      data,
      moduleFor(data),
      history,
      { from: "2025-10", to: "2026-09" },
    );
    expect(view.items).toHaveLength(1);
    expect(view.primary?.message).toBe(diagnostic);
    expect(view.primary?.scopeLabel).toContain("全历史来源诊断");
    expect(view.primary?.scopeLabel).toContain("不代表当前期间笔数");
    expect(view.undatedBusinessNote).toBe("");
    data.warnings = [diagnostic.replace("25笔", "31笔")];
    expect(
      buildMonthlyFinancialAnalysisNotices(data, moduleFor(data)).primary
        ?.message,
    ).toContain("31笔");
    data.warnings = [diagnostic, diagnostic];
    expect(JSON.stringify({ data, history })).toBe(before);
  });
  it("模块、对比及历史缓冲各标真实响应范围，不把缓冲外沿当可见月份", () => {
    const data = fixture();
    moduleFor(data, "projects").warnings = ["本期项目甲缺少币种"];
    const earlier = fixture({
      from: "2025-01",
      to: "2025-09",
      granularity: "month",
    });
    moduleFor(earlier, "projects").warnings = ["同期项目乙缺少币种"];
    data.comparison = {
      label: "同期",
      query: earlier.query,
      modules: earlier.modules,
      warnings: [],
    };
    const history = fixture({
      from: "2023-10",
      to: "2026-09",
      granularity: "month",
    });
    moduleFor(history, "projects").warnings = ["缓冲项目丙缺少币种"];
    const view = buildMonthlyFinancialAnalysisNotices(
      data,
      moduleFor(data, "projects"),
      history,
      { from: "2024-10", to: "2025-09" },
    );
    expect(
      view.items.find((item) => item.message.startsWith("本期"))?.scopeLabel,
    ).toBe("统计响应 · 2026-01 至 2026-09");
    expect(
      view.items.find((item) => item.message.startsWith("同期"))?.scopeLabel,
    ).toBe("对比统计响应 · 2025-01 至 2025-09");
    expect(
      view.items.find((item) => item.message.startsWith("缓冲"))?.scopeLabel,
    ).toBe(
      "图表加载数据 · 2023-10 至 2026-09（含缓冲；当前可见 2024-10 至 2025-09）",
    );
  });
  it("只标服务端明确的已知部分，不重新定义权威总额或期末余额", () => {
    expect(
      isKnownPartialAnalysisValue({
        key: "knownTotal",
        label: "已录入合计",
        amount: "0",
      }),
    ).toBe(true);
    expect(
      isKnownPartialAnalysisValue({
        key: "partial",
        label: "期间已录入部分合计",
        amount: "2053235.4",
      }),
    ).toBe(true);
    expect(
      isKnownPartialAnalysisValue({
        key: "total",
        label: "完整期间合计",
        amount: null,
      }),
    ).toBe(false);
    expect(
      isKnownPartialAnalysisValue({
        key: "closing",
        label: "期末余额",
        amount: "0",
      }),
    ).toBe(false);
  });

  it("明确商务全历史定量诊断优先于模块泛化警告和其他类型日期诊断", () => {
    const data = fixture();
    const business = moduleFor(data);
    business.warnings = [
      "存在已付款商务报销缺少有效实际付款日期，折线仅显示已归期部分；完整期间总额待核对。",
    ];
    data.warnings = [
      "存在3笔已付款基础报销缺少有效实际付款日期，金额¥30.00；此为全历史日期诊断，不代表当前月份。",
      "存在25笔已付款商务报销缺少有效实际付款日期，金额¥38,193.70；此为全历史日期诊断，不代表当前月份。",
    ];
    const view = buildMonthlyFinancialAnalysisNotices(data, business);
    expect(view.primary?.message).toBe(data.warnings[1]);
    expect(view.items[1].message).toBe(business.warnings[0]);
    expect(view.items[2].message).toBe(data.warnings[0]);
    expect(view.primary?.scopeLabel).toContain("不代表当前期间笔数");
  });

  it.each(["基础报销", "大额报销"])(
    "只有%s缺日期不能推断当前商务为未归期部分",
    (type) => {
      const data = fixture();
      const business = moduleFor(data);
      business.summaries[0].amount = "0";
      data.warnings = [
        `存在3笔已付款${type}缺少有效实际付款日期，金额¥30.00；此为全历史日期诊断，不代表当前月份。`,
      ];
      const view = buildMonthlyFinancialAnalysisNotices(data, business);
      expect(view.undatedBusinessNote).toBe("");
      expect(view.primary?.message).toContain(type);
      expect(view.primary?.scopeLabel).toContain("全历史来源诊断");
      expect(business.summaries[0].amount).toBe("0");
    },
  );

  it("已闭合期间即使全历史商务有缺日期，仍不把当前冻结金额标成部分", () => {
    const data = fixture({
      from: "2026-08",
      to: "2026-08",
      granularity: "month",
    });
    const business = moduleFor(data);
    business.summaries[0].amount = "12.34";
    business.series[0].label = "商务报销";
    business.series[0].values = ["12.34"];
    data.warnings = [diagnostic];
    const before = JSON.stringify(business);
    const view = buildMonthlyFinancialAnalysisNotices(data, business);
    expect(view.primary?.message).toBe(diagnostic);
    expect(view.undatedBusinessNote).toBe("");
    expect(isKnownPartialAnalysisValue(business.summaries[0])).toBe(false);
    expect(JSON.stringify(business)).toBe(before);
  });

  it.each(["历史缓冲", "对比期"])(
    "只有%s有部分口径不使当前商务统计被标成部分",
    (source) => {
      const data = fixture();
      const business = moduleFor(data);
      business.summaries[0].amount = "12.34";
      const other = fixture({
        from: "2024-10",
        to: "2026-09",
        granularity: "month",
      });
      const otherBusiness = moduleFor(other);
      otherBusiness.summaries.push({
        key: "knownTotal",
        label: "期间已归期部分合计",
        amount: "30",
      });
      otherBusiness.series[0].label = "商务报销（已归期部分）";
      otherBusiness.warnings = [
        "存在已付款商务报销缺少有效实际付款日期，折线仅显示已归期部分。",
      ];
      if (source === "对比期")
        data.comparison = {
          label: "同期",
          query: other.query,
          modules: other.modules,
          warnings: [],
        };
      const view = buildMonthlyFinancialAnalysisNotices(
        data,
        business,
        source === "历史缓冲" ? other : null,
        { from: "2025-10", to: "2026-09" },
      );
      expect(view.hasReview).toBe(true);
      expect(view.undatedBusinessNote).toBe("");
      expect(view.primary?.scopeLabel).toContain(
        source === "历史缓冲" ? "图表加载数据" : "对比统计响应",
      );
    },
  );

  it.each(["knownTotal", "已归期部分序列"])(
    "当前模块明确提供%s时才保留当前部分提示",
    (basis) => {
      const data = fixture();
      const business = moduleFor(data);
      if (basis === "knownTotal")
        business.summaries.push({
          key: "knownTotal",
          label: "期间已归期部分合计",
          amount: "0",
        });
      else business.series[0].label = "商务报销（已归期部分）";
      const view = buildMonthlyFinancialAnalysisNotices(data, business);
      expect(view.undatedBusinessNote).toContain(
        "本次商务统计采用已归期部分口径",
      );
      expect(view.undatedBusinessNote).toContain("已月结快照仍按原冻结值展示");
      expect(business.summaries[0].amount).toBeNull();
    },
  );
});

describe("面板简洁来源提示与原金额边界", () => {
  const wrappers: PanelWrapper[] = [];
  beforeEach(() => {
    jest.useFakeTimers();
    mockRead
      .mockReset()
      .mockImplementation((request: FinancialAnalysisQuery) =>
        Promise.resolve(fixture(request)),
      );
    mockWindow
      .mockReset()
      .mockImplementation((request: FinancialAnalysisQuery) =>
        Promise.resolve(fixture(request)),
      );
  });
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  async function render() {
    const wrapper = mount(Panel, { props: { selectedMonth: "2026-09" } });
    wrappers.push(wrapper);
    await settle();
    return wrapper;
  }
  it("七模块移除来源提示区域，查询与图表导出入口保留", async () => {
    const data = fixture();
    data.modules.forEach((module) => {
      module.warnings = [`${module.key}来源缺失，请核对凭证。`];
    });
    mockRead.mockResolvedValueOnce(data);
    const wrapper = await render();
    for (const key of keys) {
      await wrapper.get(`#analysis-tab-${key}`).trigger("click");
      const area = wrapper.get(`[data-module="${key}"]`);
      expect(area.find(".module-source-notice").exists()).toBe(false);
      expect(area.text()).not.toContain("查看全部来源提示");
      expect(
        area.findAll(
          ".module-source,.analysis-period-table,.analysis-details,.detail-pagination",
        ),
      ).toHaveLength(0);
      expect(area.find('[data-chart-type="line"]').exists()).toBe(true);
      expect(area.find('[aria-label="导出' + key + '"]').exists()).toBe(true);
    }
    expect(mockRead).toHaveBeenCalledTimes(1);
  });
  it("移除模块提示后，已知部分、真实零和未知断点保持", async () => {
    const data = fixture();
    data.warnings = [diagnostic];
    moduleFor(data).summaries.push({
      key: "knownTotal",
      label: "已录入部分合计",
      amount: "123456789012345678.123456789012",
    });
    mockRead.mockResolvedValueOnce(data);
    const wrapper = await render();
    await wrapper.get("#analysis-tab-business").trigger("click");
    const area = wrapper.get('[data-module="business"]');
    expect(area.find(".module-source-notice").exists()).toBe(false);
    expect(
      area.findAll(".analysis-summary strong").map((cell) => cell.text()),
    ).toEqual(["未知／未核算", "¥123,456,789,012,345,678.123456789012"]);
    expect(area.get(".summary-partial-note").text()).toBe(
      "已知部分 · 不代表完整总额",
    );
    const line = area
      .findAllComponents(Chart)
      .find((chart) => chart.props("type") === "line")!;
    expect(
      line
        .get(
          '.chart-value-label[data-series="current"][data-month="2026-02"] .amount-label-value',
        )
        .text(),
    ).toBe("¥0.00");
    expect(
      line
        .find('[data-from-month="2026-01"][data-to-month="2026-02"]')
        .exists(),
    ).toBe(true);
    expect(
      line
        .find('[data-from-month="2026-02"][data-to-month="2026-03"]')
        .exists(),
    ).toBe(true);
    expect(
      line.find('.analysis-line-point[data-month="2026-04"]').exists(),
    ).toBe(false);
    expect(
      line
        .find('[data-from-month="2026-03"][data-to-month="2026-05"]')
        .exists(),
    ).toBe(false);
  });
  it("普通口径和项目提示均不再挂载到模块中", async () => {
    const data = fixture();
    moduleFor(data, "inflow").warnings = [
      "未知数据不按零处理。",
      "公共费用仅成本归属，不重复增加公司支出。",
    ];
    moduleFor(data, "projects").warnings = [
      "项目缺少币种<img src=x onerror=alert(1)>",
    ];
    mockRead.mockResolvedValueOnce(data);
    const wrapper = await render();
    await wrapper.get("#analysis-tab-inflow").trigger("click");
    const area = wrapper.get('[data-module="inflow"]');
    expect(area.find(".module-source-notice").exists()).toBe(false);
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const project = wrapper.get('[data-module="projects"]');
    expect(project.find(".module-source-notice").exists()).toBe(false);
    expect(project.find(".module-source-notice img").exists()).toBe(false);
  });
  it("历史浏览不重新插入模块来源提示，原统计期间不变", async () => {
    mockWindow.mockImplementation((request: FinancialAnalysisQuery) => {
      const data = fixture(request);
      moduleFor(data, "projects").warnings = [
        "历史项目缺少币种，不猜测人民币。",
      ];
      return Promise.resolve(data);
    });
    const wrapper = await render();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    const area = wrapper.get('[data-module="projects"]');
    const line = area
      .findAllComponents(Chart)
      .find((chart) => chart.props("type") === "line")!;
    line.vm.$emit("window-change", { from: "2024-10", to: "2025-09" });
    await settle();
    expect(area.find(".module-source-notice").exists()).toBe(false);
    expect(wrapper.get(".displayed-query").text()).toContain(
      "2026-01 至 2026-09",
    );
    expect(mockRead).toHaveBeenCalledTimes(1);
  });
  it("权限失败清理来源提示，未授权工资仍只显示原授权成本而不恢复结构", async () => {
    const data = fixture();
    const personnel = moduleFor(data, "personnel");
    personnel.payrollDetailsVisible = false;
    personnel.warnings = ["工资分项仅向管理员开放，当前账号沿用既有权限。"];
    personnel.breakdown = [
      { key: "salary", label: "受保护工资", amount: "98765.4321" },
    ];
    mockRead.mockResolvedValueOnce(data);
    const wrapper = await render();
    await wrapper.get("#analysis-tab-personnel").trigger("click");
    const area = wrapper.get('[data-module="personnel"]');
    expect(area.get(".payroll-permission-note").text()).toContain(
      "已授权成本合计",
    );
    expect(area.find('[data-chart-type="donut"]').exists()).toBe(false);
    expect(area.text()).not.toContain("98765");
    mockRead.mockRejectedValueOnce({ response: { status: 403 } });
    await wrapper.get("form").trigger("submit");
    await settle();
    expect(wrapper.findAll(".module-source-notice")).toHaveLength(0);
    expect(wrapper.findAll(".analysis-module")).toHaveLength(0);
  });
});
