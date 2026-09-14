const mockGetReport = jest.fn();
const mockGetTrend = jest.fn();
const mockGetAnalysis = jest.fn();
const mockGetWindow = jest.fn();
let mockRoute = { query: { month: "2026-09" } };

jest.mock("@/utils/api", () => ({ api: {} }));
jest.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  onBeforeRouteLeave: jest.fn(),
  onBeforeRouteUpdate: jest.fn(),
}));
jest.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ user: { role: "admin" } }),
}));
jest.mock("element-plus", () => ({
  ElMessage: {
    warning: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
  ElMessageBox: { confirm: jest.fn() },
}));
jest.mock("@/utils/monthlyFinancialReportApi", () => ({
  getMonthlyFinancialReport: (...args: unknown[]) => mockGetReport(...args),
  getMonthlyFinancialReportTrend: (...args: unknown[]) => mockGetTrend(...args),
  saveMonthlyFinancialManualItems: jest.fn(),
  refreshMonthlyFinancialReport: jest.fn(),
  closeMonthlyFinancialReport: jest.fn(),
  reopenMonthlyFinancialReport: jest.fn(),
  downloadMonthlyFinancialReport: jest.fn(),
  getMonthlyFinancialReportErrorMessage: (_error: unknown, fallback: string) =>
    fallback,
  isMonthlyFinancialReportNotFound: (error: {
    response?: { status?: number };
  }) => error.response?.status === 404,
  isMonthlyFinancialReportVersionConflict: () => false,
}));
jest.mock("@/utils/monthlyFinancialAnalysisApi", () => ({
  getMonthlyFinancialAnalysis: (...args: unknown[]) => mockGetAnalysis(...args),
  getMonthlyFinancialAnalysisWindow: (...args: unknown[]) =>
    mockGetWindow(...args),
  downloadMonthlyFinancialAnalysis: jest.fn(),
}));

import { nextTick, reactive } from "vue";
import MonthlyFinancialReportPage from "@/views/MonthlyFinancialReport.vue";
import MonthlyFinancialAnalysisPanel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  MonthlyFinancialAccountCode,
  MonthlyFinancialReport,
} from "@/types/monthlyFinancialReport";
import type {
  FinancialAnalysisModuleKey,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
type PageWrapper = ReturnType<typeof mount>;
const mounted = new Set<PageWrapper>();
const moduleCases: Array<{ key: FinancialAnalysisModuleKey; label: string }> = [
  { key: "balances", label: "账户余额资金台帐" },
  { key: "inflow", label: "一般账户入账统计" },
  { key: "outflow", label: "一般账户出账统计" },
  { key: "projects", label: "项目分析" },
  { key: "settlement", label: "收支结余" },
  { key: "business", label: "商务统计" },
  { key: "personnel", label: "人力成本分析" },
];
function report(month: string, version = 3): MonthlyFinancialReport {
  const accounts: Array<{ code: MonthlyFinancialAccountCode; name: string }> = [
    { code: "general", name: "一般账户" },
    { code: "business", name: "商务账户" },
    { code: "welfare_one", name: "福利金账户一" },
    { code: "welfare_two", name: "福利金账户二" },
  ];
  return {
    month,
    status: "draft",
    version,
    snapshotVersion: null,
    isFirstMonth: false,
    generatedAt: "2026-09-03T00:00:00Z",
    savedAt: "2026-09-03T00:00:00Z",
    closedAt: null,
    closedByName: null,
    reopenedAt: null,
    accounts: accounts.map((account) => ({
      ...account,
      opening: "0",
      inflow: "0",
      outflow: "0",
      closing: "0",
    })),
    income: {
      mainReceipt: "0",
      tax: "0",
      marketingReserve: "0",
      businessCost: "0",
      accountingBase: "0",
      generalInterest: "0",
      businessInterest: "0",
      welfareOneSupplement: "0",
      welfareTwoSupplement: "0",
    },
    expenses: {
      humanCost: "0",
      basicReimbursement: "0",
      largeReimbursement: "0",
      assetAdministration: "0",
      generalBankFee: "0",
      generalTaxPayment: "0",
      generalOther: "0",
      businessReimbursement: "0",
      businessBankFee: "0",
      welfareOne407: "0",
      welfareOneDrinkingWater: "0",
      welfareOneOffice: "0",
      welfareOneElectricity: "0",
      welfareOne407Ai: "0",
      welfareOne8hAi: "0",
      welfareTwoRefreshment: "0",
      welfareTwoTeamBuilding: "0",
      welfareTwoPhysicalExam: "0",
    },
    totals: {
      opening: "0",
      income: "0",
      expense: "0",
      closing: "0",
      netChange: "0",
    },
    automaticDetails: [],
    manualItems: [],
    sources: [],
    validations: { canClose: true, blockers: [], warnings: [] },
    permissions: {
      canEdit: true,
      canRefresh: true,
      canSubmitReview: true,
      canClose: true,
      canReopen: true,
      canDownload: true,
    },
  };
}
function analysis(query: FinancialAnalysisQuery): MonthlyFinancialAnalysisData {
  const periods = [];
  let month = query.from;
  while (month <= query.to) {
    periods.push({ key: month, label: month, from: month, to: month });
    if (month === query.to) break;
    month = financialMonthOffset(month, 1);
  }
  return {
    query: { ...query },
    generatedAt: "2026-09-03T00:00:00Z",
    dataVersion: "新分析视图测试",
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    warnings: [],
    modules: moduleCases.map(({ key, label }) => ({
      key,
      title: label,
      description: "合成挂载数据",
      sourceLabel: "合成数据",
      updatedAt: null,
      periods,
      series: [
        {
          key: "total",
          label: "金额合计",
          values: periods.map(() => "100.01"),
        },
      ],
      summaries: [{ key: "total", label: "金额合计", amount: "100.01" }],
      breakdown: [],
      comparison: [],
      columns: [],
      details: [],
      warnings: [],
      appliedFilters: [],
    })),
  };
}
const componentStubs = {
  ElAlert: { template: "<div><slot /></div>" },
  ElButton: {
    props: ["disabled", "loading"],
    emits: ["click"],
    template:
      '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
  },
  ElCard: { template: '<section><slot name="header" /><slot /></section>' },
  ElCollapse: { template: "<div><slot /></div>" },
  ElCollapseItem: {
    template: '<div class="old-history-collapse"><slot /></div>',
  },
  ElDatePicker: {
    props: ["modelValue"],
    template: '<input class="report-month-input" :value="modelValue" />',
  },
  ElDescriptions: { template: "<div><slot /></div>" },
  ElDescriptionsItem: { template: "<div><slot /></div>" },
  ElEmpty: {
    props: ["description"],
    template: '<div class="empty-report-state">{{ description }}<slot /></div>',
  },
  ElIcon: { template: "<i><slot /></i>" },
  ElInput: { props: ["modelValue"], template: '<input :value="modelValue" />' },
  ElLink: { template: "<a><slot /></a>" },
  ElSkeleton: { template: "<div />" },
  ElTabPane: {
    props: ["name"],
    template: '<section :data-report-tab="name"><slot /></section>',
  },
  ElTabs: { template: "<div><slot /></div>" },
  ElTag: { template: "<span><slot /></span>" },
  MonthlyBankReceiptPanel: {
    name: "MonthlyBankReceiptPanel",
    emits: ["report-refreshed"],
    template: '<div class="bank-receipt-test-panel" />',
  },
  MonthlyFinancialDateRange: {
    props: ["modelValue", "popperAppendTo"],
    methods: { close: jest.fn() },
    template: "<div>统计日期范围</div>",
  },
  MonthlyFinancialTrendChart: {
    template:
      '<div class="legacy-trend-test-marker">旧版连续历史趋势与同期对比</div>',
  },
};
async function settle() {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
async function mountPage() {
  const wrapper = mount(MonthlyFinancialReportPage, {
    global: { stubs: componentStubs, directives: { loading: {} } },
  });
  mounted.add(wrapper);
  await settle();
  return wrapper;
}
function expectOnlyNewAnalysis(wrapper: PageWrapper) {
  expect(wrapper.findAllComponents(MonthlyFinancialAnalysisPanel)).toHaveLength(
    1,
  );
  expect(wrapper.find(".analysis-history").exists()).toBe(false);
  expect(wrapper.find(".legacy-trend-test-marker").exists()).toBe(false);
  expect(wrapper.text()).not.toContain("连续历史趋势与同期对比");
  expect(wrapper.findAll('.analysis-navigation [role="tab"]')).toHaveLength(7);
  expect(wrapper.findAll(".module-visualization")).toHaveLength(7);
  for (const { key, label } of moduleCases)
    expect(wrapper.get("#analysis-tab-" + key).text()).toBe(label);
  expect(mockGetTrend).not.toHaveBeenCalled();
}

describe("月报移除旧趋势区后仅展示七模块分析", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRoute = reactive({ query: { month: "2026-09" } });
    mockGetReport.mockImplementation((month: string) =>
      Promise.resolve(report(month)),
    );
    mockGetAnalysis.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(analysis(query)),
    );
    mockGetWindow.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(analysis(query)),
    );
  });
  afterEach(async () => {
    for (const wrapper of mounted) wrapper.unmount();
    mounted.clear();
    await settle();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    { missing: false, label: "已有月报" },
    { missing: true, label: "当前月份缺少月报" },
  ])(
    "$label时均无旧区，仅挂新七模块且切月份不再读取旧趋势",
    async ({ missing }) => {
      if (missing)
        mockGetReport.mockRejectedValue({ response: { status: 404 } });
      const wrapper = await mountPage();
      expectOnlyNewAnalysis(wrapper);
      expect(wrapper.find(".empty-month-shell").exists()).toBe(missing);
      expect(
        wrapper
          .getComponent(MonthlyFinancialAnalysisPanel)
          .props("selectedMonth"),
      ).toBe("2026-09");
      expect(mockGetAnalysis).toHaveBeenCalled();
      expect(mockGetWindow).toHaveBeenCalled();
      mockRoute.query.month = "2026-10";
      await settle();
      expectOnlyNewAnalysis(wrapper);
      expect(mockGetReport).toHaveBeenLastCalledWith("2026-10");
      expect(
        wrapper
          .getComponent(MonthlyFinancialAnalysisPanel)
          .props("selectedMonth"),
      ).toBe("2026-10");
    },
  );

  it("移除旧年份发现请求后2026统计仍可选择2015和1900等更早年份", async () => {
    const wrapper = await mountPage();
    const years = wrapper
      .get('[aria-label="分析对比年份"]')
      .findAll("option")
      .map((option) => option.attributes("value"));
    expect(years).toContain("2025");
    expect(years).toContain("2015");
    expect(years).toContain("1900");
    expect(years).not.toContain("1899");
    expect(years).not.toContain("2026");
    expect(new Set(years).size).toBe(years.length);
    await wrapper.get('[aria-label="分析对比年份"]').setValue("2015");
    await wrapper.get(".analysis-filters").trigger("submit");
    await settle();
    expect(mockGetAnalysis.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ comparisonYear: 2015 }),
    );
    expectOnlyNewAnalysis(wrapper);
  });

  it("1900统计起点没有非法更早年度选项且新七模块仍正常挂载", async () => {
    mockRoute.query.month = "1900-01";
    const wrapper = await mountPage();
    expectOnlyNewAnalysis(wrapper);
    const years = wrapper
      .get('[aria-label="分析对比年份"]')
      .findAll("option")
      .map((option) => option.attributes("value"));
    expect(years).toEqual([""]);
    expect(mockGetAnalysis.mock.calls[0][0]).not.toHaveProperty(
      "comparisonYear",
    );
  });

  it("回单更新月报版本仍触发新分析刷新，不再回调旧趋势加载", async () => {
    const wrapper = await mountPage();
    const before = mockGetAnalysis.mock.calls.length;
    const nextReport = report("2026-09", 4);
    wrapper
      .getComponent({ name: "MonthlyBankReceiptPanel" })
      .vm.$emit("report-refreshed", nextReport);
    await settle();
    expect(
      wrapper.getComponent(MonthlyFinancialAnalysisPanel).props("refreshKey"),
    ).toBe(4);
    expect(mockGetAnalysis).toHaveBeenCalledTimes(before + 1);
    expectOnlyNewAnalysis(wrapper);
  });
});
