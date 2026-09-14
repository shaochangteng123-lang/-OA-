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
      props: ["modelValue", "popperAppendTo"],
      methods: { close: jest.fn() },
      template: '<div class="date-range-test-stub">日期范围</div>',
    },
  }),
);

import { nextTick } from "vue";
import MonthlyFinancialAnalysisPanel from "@/components/monthly-financial/MonthlyFinancialAnalysisPanel.vue";
import MonthlyFinancialAnalysisChart from "@/components/monthly-financial/MonthlyFinancialAnalysisChart.vue";
import { financialMonthOffset } from "@/utils/monthlyFinancialAnalysisWindow";
import type {
  FinancialAnalysisModule,
  FinancialAnalysisModuleKey,
  FinancialAnalysisPeriod,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";

const { mount, flushPromises } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");
type PanelWrapper = ReturnType<typeof mount>;
const mounted = new Set<PanelWrapper>();
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
const originalCreateUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL",
);
const originalRevokeUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL",
);
let nativeElement: Element | null = null;
let comparisonAvailable = true;
const moduleCases: Array<{ key: FinancialAnalysisModuleKey; label: string }> = [
  { key: "balances", label: "账户余额资金台帐" },
  { key: "inflow", label: "一般账户入账统计" },
  { key: "outflow", label: "一般账户出账统计" },
  { key: "projects", label: "项目分析" },
  { key: "settlement", label: "收支结余" },
  { key: "business", label: "商务统计" },
  { key: "personnel", label: "人力成本分析" },
];

function periodRows(query: FinancialAnalysisQuery): FinancialAnalysisPeriod[] {
  const result: FinancialAnalysisPeriod[] = [];
  let month = query.from;
  while (month <= query.to) {
    result.push({ key: month, label: month, from: month, to: month });
    if (month === query.to) break;
    month = financialMonthOffset(month, 1);
  }
  return result;
}
function modules(
  query: FinancialAnalysisQuery,
  historical = false,
): FinancialAnalysisModule[] {
  const periods = periodRows(query);
  const entries = [
    { key: "general", label: "一般账户", amount: historical ? "50" : "100" },
    { key: "business", label: "商务账户", amount: historical ? "70" : "200" },
    {
      key: "welfare_one",
      label: "福利金账户一",
      amount: historical ? "30" : "30",
    },
    {
      key: "welfare_two",
      label: "福利金账户二",
      amount: historical ? "50" : "70",
    },
  ];
  const total = historical ? "200" : "400";
  const balances: FinancialAnalysisModule = {
    key: "balances",
    title: "账户余额资金台帐",
    description: "余额显示测试数据",
    sourceLabel: "合成数据",
    updatedAt: "2026-09-03T01:00:00Z",
    periods,
    series: [
      ...entries,
      { key: "total", label: "四账户合计", amount: total },
    ].map((entry) => ({
      key: entry.key,
      label: entry.label,
      values: periods.map(() => entry.amount),
    })),
    summaries: [{ key: "total", label: "四账户合计", amount: total }],
    breakdown: entries,
    comparison: [],
    columns: [
      { key: "month", label: "月份", format: "text" },
      { key: "account", label: "账户", format: "text" },
      { key: "closing", label: "余额", format: "amount" },
    ],
    details: periods.flatMap((period) =>
      entries.map((entry) => ({
        id: period.from + ":" + entry.key,
        month: period.from,
        account: entry.label,
        closing: entry.amount,
      })),
    ),
    warnings: [],
    appliedFilters: ["时间"],
  };
  return [
    balances,
    ...moduleCases
      .filter(({ key }) => key !== "balances")
      .map(({ key, label }) => ({
        ...balances,
        key,
        title: label,
        breakdown: [],
        details: [],
        summaries: [{ key: "total", label: "金额合计", amount: "100" }],
        series: [
          {
            key: "total",
            label: "分析金额",
            values: periods.map(() => "100"),
          },
        ],
      })),
  ];
}
function response(query: FinancialAnalysisQuery): MonthlyFinancialAnalysisData {
  let comparison: MonthlyFinancialAnalysisData["comparison"];
  if (comparisonAvailable && query.comparisonYear !== undefined) {
    const offset = (query.comparisonYear - Number(query.from.slice(0, 4))) * 12;
    const previous: FinancialAnalysisQuery = {
      ...query,
      from: financialMonthOffset(query.from, offset),
      to: financialMonthOffset(query.to, offset),
    };
    delete previous.comparisonYear;
    comparison = {
      label: query.comparisonYear + "年同期",
      query: previous,
      modules: modules(previous, true),
      warnings: [],
    };
  }
  return {
    query: { ...query },
    generatedAt: "2026-09-03T01:00:00Z",
    dataVersion: "显示测试版本",
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    modules: modules(query),
    warnings: [],
    ...(comparison ? { comparison } : {}),
  };
}
async function settle() {
  for (let index = 0; index < 9; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}
async function mountPanel(realDateRange = false) {
  const dateRange = realDateRange
    ? (
        jest.requireActual(
          "@/components/monthly-financial/MonthlyFinancialDateRange.vue",
        ) as typeof import("@/components/monthly-financial/MonthlyFinancialDateRange.vue")
      ).default
    : undefined;
  const wrapper = mount(MonthlyFinancialAnalysisPanel, {
    props: {
      selectedMonth: "2026-09",
      active: true,
      comparisonYears: [2024, 2025, 2026],
    },
    global: {
      stubs: dateRange ? { MonthlyFinancialDateRange: dateRange } : {},
    },
    attachTo: document.body,
  });
  mounted.add(wrapper);
  await settle();
  return wrapper;
}
function fullscreenRoot(wrapper: PanelWrapper) {
  return wrapper.get("section.financial-analysis-panel");
}
async function unmountPanel(wrapper: PanelWrapper) {
  wrapper.unmount();
  mounted.delete(wrapper);
  await settle();
}
function installFullscreen(
  mode: "native" | "rejected" | "unsupported" = "native",
) {
  const request: jest.Mock<Promise<void>, []> = jest.fn(() => {
    if (mode === "rejected")
      return Promise.reject(new Error("浏览器未允许全屏"));
    nativeElement = request.mock.contexts.at(-1) as HTMLElement;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });
  const exit = jest.fn(async () => {
    nativeElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    writable: true,
    value: mode === "unsupported" ? undefined : request,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    writable: true,
    value: exit,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => nativeElement,
  });
  return { request, exit };
}
function restoreProperty(
  object: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) Object.defineProperty(object, key, descriptor);
  else Reflect.deleteProperty(object, key);
}
function requestCounts() {
  return {
    statistics: mockGetAnalysis.mock.calls.length,
    window: mockGetWindowAnalysis.mock.calls.length,
  };
}
function moduleArea(wrapper: PanelWrapper, key: FinancialAnalysisModuleKey) {
  return wrapper.get("#financial-analysis-" + key + " .module-visualization");
}
function comparisonStates(wrapper: PanelWrapper) {
  return Object.fromEntries(
    moduleCases.map(({ key }) => [
      key,
      moduleArea(wrapper, key)
        .get(".module-comparison-toggle")
        .attributes("aria-pressed"),
    ]),
  );
}

describe("财务七模块全屏与独立年度对比显示", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    nativeElement = null;
    comparisonAvailable = true;
    document.body.style.overflow = "auto";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    mockGetAnalysis.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(response(query)),
    );
    mockGetWindowAnalysis.mockImplementation((query: FinancialAnalysisQuery) =>
      Promise.resolve(response(query)),
    );
    mockDownloadAnalysis.mockResolvedValue({
      blob: new Blob(["合成导出"]),
      fileName: "显示控制测试.xlsx",
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:显示控制测试"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
    jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
  });
  afterEach(async () => {
    for (const wrapper of mounted) wrapper.unmount();
    mounted.clear();
    await settle();
    jest.useRealTimers();
    jest.restoreAllMocks();
    restoreProperty(
      HTMLElement.prototype,
      "requestFullscreen",
      originalRequest,
    );
    restoreProperty(document, "exitFullscreen", originalExit);
    restoreProperty(document, "fullscreenElement", originalElement);
    restoreProperty(URL, "createObjectURL", originalCreateUrl);
    restoreProperty(URL, "revokeObjectURL", originalRevokeUrl);
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  it.each(moduleCases)(
    "$label的入口进入统一七模块原生全屏，数据及导出范围不变",
    async ({ key, label }) => {
      const native = installFullscreen();
      const wrapper = await mountPanel();
      await wrapper.get("#analysis-tab-" + key).trigger("click");
      await settle();
      const area = wrapper.get(
        "#financial-analysis-" + key + " .module-visualization",
      );
      const panel = fullscreenRoot(wrapper);
      const button = area.get(".module-fullscreen-toggle");
      expect(button.text()).toBe("全屏查看");
      expect(area.attributes("data-visualization-module")).toBe(key);
      expect(button.attributes("aria-label")).toBe(
        label + "入口：全屏查看七模块",
      );
      expect(button.find("svg.fullscreen-icon").exists()).toBe(true);
      expect(
        button.findAll("svg path, svg polyline, svg line").length,
      ).toBeGreaterThan(0);
      expect(area.find(".line-scroll").exists()).toBe(true);
      expect(wrapper.findAll(".module-visualization")).toHaveLength(7);
      expect(area.findAll(".module-comparison-toggle")).toHaveLength(1);
      expect(
        area.get(".module-comparison-toggle").attributes("aria-label"),
      ).toBe(label + "：关闭年度对比");
      if (key !== "balances")
        expect(area.find(".balance-comparison-toggle").exists()).toBe(false);
      else
        expect(area.get(".balance-comparison-toggle").element).toBe(
          area.get(".module-comparison-toggle").element,
        );
      const queryBefore = wrapper.get(".displayed-query").text();
      const rangeBefore = area.get(".visible-window-range").text();
      const callsBefore = requestCounts();
      await button.trigger("click");
      await settle();
      expect(native.request).toHaveBeenCalledTimes(1);
      expect(native.request.mock.contexts[0]).toBe(panel.element);
      expect(document.fullscreenElement).toBe(panel.element);
      expect(
        wrapper.findAll(".module-visualization.is-fullscreen"),
      ).toHaveLength(0);
      expect(panel.classes()).toContain("is-fullscreen");
      expect(panel.attributes("role")).toBe("dialog");
      expect(panel.attributes("aria-modal")).toBe("true");
      expect(
        wrapper
          .findAll(".module-visualization")
          .every((element) => element.attributes("role") !== "dialog"),
      ).toBe(true);
      expect(panel.find(".analysis-filters").exists()).toBe(true);
      expect(panel.findAll('.analysis-navigation [role="tab"]')).toHaveLength(
        7,
      );
      expect(panel.get(".panel-fullscreen-exit").text()).toContain("退出全屏");
      for (const other of moduleCases.filter((module) => module.key !== key)) {
        expect(
          wrapper
            .get("#financial-analysis-" + other.key + " .module-visualization")
            .classes(),
        ).not.toContain("is-fullscreen");
      }
      expect(button.text()).toBe("退出全屏");
      expect(button.attributes("aria-label")).toBe(label + "入口：退出全屏");
      await button.trigger("click");
      await settle();
      expect(native.exit).toHaveBeenCalledTimes(1);
      expect(document.fullscreenElement).toBeNull();
      expect(panel.classes()).not.toContain("is-fullscreen");
      expect(
        wrapper.findAll(".module-visualization.is-fullscreen"),
      ).toHaveLength(0);
      expect(button.text()).toBe("全屏查看");
      expect(area.get(".visible-window-range").text()).toBe(rangeBefore);
      expect(wrapper.get(".displayed-query").text()).toBe(queryBefore);
      expect(requestCounts()).toEqual(callsBefore);
      await wrapper.get('[aria-label="导出' + label + '"]').trigger("click");
      await settle();
      expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
        {
          from: "2026-01",
          to: "2026-09",
          granularity: "month",
          comparisonYear: 2025,
        },
        key,
        "显示测试版本",
      );
      expect(requestCounts()).toEqual(callsBefore);
    },
  );

  it.each(moduleCases)(
    "$label在原生全屏被拒绝时使用后备并完整退出",
    async ({ key }) => {
      const native = installFullscreen("rejected");
      const wrapper = await mountPanel();
      await wrapper.get("#analysis-tab-" + key).trigger("click");
      await settle();
      const area = wrapper.get(
        "#financial-analysis-" + key + " .module-visualization",
      );
      const button = area.get(".module-fullscreen-toggle");
      const callsBefore = requestCounts();
      const queryBefore = wrapper.get(".displayed-query").text();
      await button.trigger("click");
      await settle();
      expect(native.request.mock.contexts[0]).toBe(
        fullscreenRoot(wrapper).element,
      );
      expect(document.fullscreenElement).toBeNull();
      expect(fullscreenRoot(wrapper).classes()).toContain("is-fullscreen");
      expect(
        wrapper.findAll(".module-visualization.is-fullscreen"),
      ).toHaveLength(0);
      expect(
        fullscreenRoot(wrapper).get(".fullscreen-message").text(),
      ).toContain("已铺满应用页面");
      expect(document.body.style.overflow).toBe("hidden");
      await button.trigger("click");
      await settle();
      expect(
        wrapper.findAll(".module-visualization.is-fullscreen"),
      ).toHaveLength(0);
      expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
      expect(document.body.style.overflow).toBe("auto");
      expect(button.text()).toBe("全屏查看");
      expect(native.exit).not.toHaveBeenCalled();
      expect(wrapper.get(".displayed-query").text()).toBe(queryBefore);
      expect(requestCounts()).toEqual(callsBefore);
    },
  );

  it.each([
    { mode: "native" as const, label: "原生" },
    { mode: "rejected" as const, label: "后备" },
  ])(
    "$label全屏内可连续切换七模块，不退出或再次请求全屏，也不改变窗口和查询",
    async ({ mode }) => {
      const native = installFullscreen(mode);
      const wrapper = await mountPanel();
      await wrapper.get("#analysis-tab-projects").trigger("click");
      await settle();
      const projects = wrapper.get(
        "#financial-analysis-projects .module-visualization",
      );
      await projects.get(".module-fullscreen-toggle").trigger("click");
      await settle();
      const panel = fullscreenRoot(wrapper);
      expect(panel.classes()).toContain("is-fullscreen");
      const callsBefore = requestCounts();
      const rangeBefore = projects.get(".visible-window-range").text();
      const queryBefore = panel.get(".displayed-query").text();
      for (const { key } of moduleCases) {
        await panel.get("#analysis-tab-" + key).trigger("click");
        await settle();
        expect(panel.classes()).toContain("is-fullscreen");
        expect(
          panel.get("#analysis-tab-" + key).attributes("aria-selected"),
        ).toBe("true");
        expect(
          panel.findAll(".module-visualization.is-fullscreen"),
        ).toHaveLength(0);
        expect(
          panel
            .get("#financial-analysis-" + key + " .module-fullscreen-toggle")
            .text(),
        ).toBe("退出全屏");
        expect(
          panel
            .get("#financial-analysis-" + key + " .visible-window-range")
            .text(),
        ).toBe(rangeBefore);
        expect(panel.get(".displayed-query").text()).toBe(queryBefore);
        expect(
          panel.element.contains(panel.get(".analysis-filters").element),
        ).toBe(true);
        expect(
          panel.element.contains(panel.get(".analysis-navigation").element),
        ).toBe(true);
        expect(native.request).toHaveBeenCalledTimes(1);
        expect(native.exit).not.toHaveBeenCalled();
        expect(document.fullscreenElement).toBe(
          mode === "native" ? panel.element : null,
        );
        const area = moduleArea(wrapper, key);
        const comparisonToggle = area.get(".module-comparison-toggle");
        expect(panel.element.contains(comparisonToggle.element)).toBe(true);
        expect(comparisonToggle.attributes("disabled")).toBeUndefined();
        await comparisonToggle.trigger("click");
        await settle();
        expect(comparisonToggle.attributes("aria-pressed")).toBe("false");
        expect(
          area.find('.chart-value-label[data-series="comparison"]').exists(),
        ).toBe(false);
        expect(panel.classes()).toContain("is-fullscreen");
        await comparisonToggle.trigger("click");
        await settle();
        expect(comparisonToggle.attributes("aria-pressed")).toBe("true");
        expect(
          area.findAll('.chart-value-label[data-series="comparison"]'),
        ).toHaveLength(12);
        expect(native.request).toHaveBeenCalledTimes(1);
        expect(native.exit).not.toHaveBeenCalled();
        expect(area.get(".visible-window-range").text()).toBe(rangeBefore);
        expect(panel.get(".displayed-query").text()).toBe(queryBefore);
        expect(requestCounts()).toEqual(callsBefore);
      }
      await panel.get(".panel-fullscreen-exit").trigger("click");
      await settle();
      expect(panel.classes()).not.toContain("is-fullscreen");
      expect(native.request).toHaveBeenCalledTimes(1);
      expect(native.exit).toHaveBeenCalledTimes(mode === "native" ? 1 : 0);
      expect(document.fullscreenElement).toBeNull();
      expect(document.body.style.overflow).toBe("auto");
      expect(requestCounts()).toEqual(callsBefore);
    },
  );

  it("原生全屏包含同一容器内的折线和资金饼图，按钮可进入及退出且不发起数据查询", async () => {
    const native = installFullscreen();
    const wrapper = await mountPanel();
    const area = wrapper.get(".balance-visualization");
    const button = area.get(".balance-fullscreen-toggle");
    expect(area.find(".line-scroll").exists()).toBe(true);
    expect(area.find(".balance-structure").exists()).toBe(true);
    const before = requestCounts();
    await button.trigger("click");
    await settle();
    expect(native.request).toHaveBeenCalledTimes(1);
    expect(native.request.mock.contexts[0]).toBe(
      fullscreenRoot(wrapper).element,
    );
    expect(document.fullscreenElement).toBe(fullscreenRoot(wrapper).element);
    expect(fullscreenRoot(wrapper).classes()).toContain("is-fullscreen");
    expect(fullscreenRoot(wrapper).attributes("role")).toBe("dialog");
    expect(fullscreenRoot(wrapper).attributes("aria-modal")).toBe("true");
    expect(button.text()).toBe("退出全屏");
    await button.trigger("click");
    await settle();
    expect(native.exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
    expect(fullscreenRoot(wrapper).attributes("role")).toBeUndefined();
    expect(button.text()).toBe("全屏查看");
    expect(requestCounts()).toEqual(before);
  });

  it("浏览器外部退出全屏事件能恢复按钮与容器状态", async () => {
    installFullscreen();
    const wrapper = await mountPanel();
    const area = wrapper.get(".balance-visualization");
    await area.get(".balance-fullscreen-toggle").trigger("click");
    await settle();
    nativeElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    await settle();
    expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
    expect(area.get(".balance-fullscreen-toggle").text()).toBe("全屏查看");
    expect(fullscreenRoot(wrapper).attributes("aria-modal")).toBeUndefined();
    expect(document.body.style.overflow).toBe("auto");
  });

  it.each([
    { mode: "rejected" as const, label: "浏览器拒绝" },
    { mode: "unsupported" as const, label: "接口不支持" },
  ])("$label时后备铺满页面，退出键恢复原滚动设置", async ({ mode }) => {
    installFullscreen(mode);
    const wrapper = await mountPanel();
    const area = wrapper.get(".balance-visualization");
    await area.get(".balance-fullscreen-toggle").trigger("click");
    await settle();
    expect(fullscreenRoot(wrapper).classes()).toContain("is-fullscreen");
    expect(fullscreenRoot(wrapper).attributes("role")).toBe("dialog");
    expect(fullscreenRoot(wrapper).get(".fullscreen-message").text()).toContain(
      "已铺满应用页面",
    );
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.fullscreenElement).toBeNull();
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
    expect(area.get(".balance-fullscreen-toggle").text()).toBe("全屏查看");
    expect(document.body.style.overflow).toBe("auto");
  });

  it("关闭和恢复年度对比只切换曲线标签，不重新查询、不改窗口或导出参数", async () => {
    installFullscreen();
    const wrapper = await mountPanel();
    const area = wrapper.get(".balance-visualization");
    const toggle = area.get(".balance-comparison-toggle");
    const beforeRequests = requestCounts();
    const beforeRange = area.get(".visible-window-range").text();
    const beforeQuery = wrapper.get(".displayed-query").text();
    expect(
      area.findAll('.chart-value-label[data-series="comparison"]'),
    ).toHaveLength(12);
    expect(toggle.text()).toBe("关闭年度对比");
    await toggle.trigger("click");
    await settle();
    expect(toggle.text()).toBe("开启年度对比");
    expect(toggle.attributes("aria-pressed")).toBe("false");
    expect(
      area.find('.analysis-line-series[data-series="comparison"]').exists(),
    ).toBe(false);
    expect(
      area.find('.chart-value-label[data-series="comparison"]').exists(),
    ).toBe(false);
    expect(
      area.findAll('.chart-value-label[data-series="current"]'),
    ).toHaveLength(12);
    expect(area.get(".visible-window-range").text()).toBe(beforeRange);
    expect(wrapper.get(".displayed-query").text()).toBe(beforeQuery);
    expect(requestCounts()).toEqual(beforeRequests);
    await wrapper.get(".analysis-header button").trigger("click");
    await settle();
    expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
      {
        from: "2026-01",
        to: "2026-09",
        granularity: "month",
        comparisonYear: 2025,
      },
      "all",
      "显示测试版本",
    );
    await toggle.trigger("click");
    await settle();
    expect(toggle.text()).toBe("关闭年度对比");
    expect(
      area.findAll('.chart-value-label[data-series="comparison"]'),
    ).toHaveLength(12);
    expect(area.get(".visible-window-range").text()).toBe(beforeRange);
    expect(requestCounts()).toEqual(beforeRequests);
  });

  it.each(moduleCases)(
    "$label可独立关闭恢复年度对比，切换模块与刷新窗口后保留状态且统计导出不变",
    async ({ key, label }) => {
      const wrapper = await mountPanel();
      await wrapper.get("#analysis-tab-" + key).trigger("click");
      await settle();
      const area = moduleArea(wrapper, key);
      const toggle = area.get(".module-comparison-toggle");
      const beforeRequests = requestCounts();
      const beforeRange = area.get(".visible-window-range").text();
      const beforeQuery = wrapper.get(".displayed-query").text();
      const beforeStates = comparisonStates(wrapper);
      const currentLabels = area
        .findAll(
          '.chart-value-label[data-series="current"] .amount-label-value',
        )
        .map((element) => element.text());
      expect(Object.values(beforeStates)).toEqual(Array(7).fill("true"));
      expect(toggle.text()).toBe("关闭年度对比");
      expect(toggle.attributes("disabled")).toBeUndefined();
      expect(
        area.findAll('.chart-value-label[data-series="comparison"]'),
      ).toHaveLength(12);

      await toggle.trigger("click");
      await settle();
      const closedStates = { ...beforeStates, [key]: "false" };
      expect(comparisonStates(wrapper)).toEqual(closedStates);
      expect(toggle.text()).toBe("开启年度对比");
      expect(toggle.attributes("aria-label")).toBe(label + "：开启年度对比");
      expect(
        area.find('.analysis-line-series[data-series="comparison"]').exists(),
      ).toBe(false);
      expect(
        area.find('.chart-value-label[data-series="comparison"]').exists(),
      ).toBe(false);
      expect(
        area
          .findAll(
            '.chart-value-label[data-series="current"] .amount-label-value',
          )
          .map((element) => element.text()),
      ).toEqual(currentLabels);
      expect(area.get(".visible-window-range").text()).toBe(beforeRange);
      expect(wrapper.get(".displayed-query").text()).toBe(beforeQuery);
      expect(requestCounts()).toEqual(beforeRequests);

      const other = moduleCases.find((module) => module.key !== key)!;
      await wrapper.get("#analysis-tab-" + other.key).trigger("click");
      await settle();
      expect(
        moduleArea(wrapper, other.key).findAll(
          '.chart-value-label[data-series="comparison"]',
        ),
      ).toHaveLength(12);
      await wrapper.get("#analysis-tab-" + key).trigger("click");
      await settle();
      expect(comparisonStates(wrapper)).toEqual(closedStates);
      expect(requestCounts()).toEqual(beforeRequests);

      area
        .getComponent(MonthlyFinancialAnalysisChart)
        .vm.$emit("window-change", {
          from: "2025-09",
          to: "2026-08",
        });
      await settle();
      jest.advanceTimersByTime(180);
      await settle();
      expect(requestCounts()).toEqual({
        statistics: beforeRequests.statistics,
        window: beforeRequests.window + 1,
      });
      expect(comparisonStates(wrapper)).toEqual(closedStates);
      expect(area.get(".visible-window-range").text()).toContain("2025-09");
      expect(area.get(".visible-window-range").text()).toContain("2026-08");
      expect(
        area.findAll('.chart-value-label[data-series="current"]'),
      ).toHaveLength(12);
      expect(
        area.find('.chart-value-label[data-series="comparison"]').exists(),
      ).toBe(false);
      expect(wrapper.get(".displayed-query").text()).toBe(beforeQuery);

      await wrapper.get('[aria-label="导出' + label + '"]').trigger("click");
      await settle();
      expect(mockDownloadAnalysis).toHaveBeenLastCalledWith(
        {
          from: "2026-01",
          to: "2026-09",
          granularity: "month",
          comparisonYear: 2025,
        },
        key,
        "显示测试版本",
      );
      const refreshedRequests = requestCounts();
      const refreshedRange = area.get(".visible-window-range").text();
      await toggle.trigger("click");
      await settle();
      expect(comparisonStates(wrapper)).toEqual(beforeStates);
      expect(toggle.text()).toBe("关闭年度对比");
      expect(
        area.findAll('.chart-value-label[data-series="comparison"]'),
      ).toHaveLength(12);
      expect(area.get(".visible-window-range").text()).toBe(refreshedRange);
      expect(wrapper.get(".displayed-query").text()).toBe(beforeQuery);
      expect(requestCounts()).toEqual(refreshedRequests);
    },
  );

  it("没有已经加载的对比数据时七模块全部禁用按钮并提示先选年份查询", async () => {
    comparisonAvailable = false;
    installFullscreen();
    const wrapper = await mountPanel();
    expect(wrapper.findAll(".module-comparison-toggle")).toHaveLength(7);
    const before = requestCounts();
    for (const { key, label } of moduleCases) {
      await wrapper.get("#analysis-tab-" + key).trigger("click");
      const area = moduleArea(wrapper, key);
      const toggle = area.get(".module-comparison-toggle");
      expect(toggle.attributes("disabled")).toBeDefined();
      expect(toggle.attributes("aria-pressed")).toBe("false");
      expect(toggle.attributes("aria-label")).toBe(label + "：开启年度对比");
      expect(toggle.attributes("title")).toContain("选择年份并查询");
      await toggle.trigger("click");
      await settle();
      expect(toggle.attributes("aria-pressed")).toBe("false");
      expect(
        area.find('.analysis-line-series[data-series="comparison"]').exists(),
      ).toBe(false);
    }
    expect(requestCounts()).toEqual(before);
  });

  it("加载历史窗口期间七模块均不能切换年度对比，响应到达后保留各自状态", async () => {
    const wrapper = await mountPanel();
    await moduleArea(wrapper, "balances")
      .get(".module-comparison-toggle")
      .trigger("click");
    await settle();
    const beforeStates = comparisonStates(wrapper);
    const beforeRequests = requestCounts();
    let resolveWindow!: (value: MonthlyFinancialAnalysisData) => void;
    mockGetWindowAnalysis.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveWindow = resolve;
        }),
    );
    moduleArea(wrapper, "balances")
      .getComponent(MonthlyFinancialAnalysisChart)
      .vm.$emit("window-change", { from: "2025-09", to: "2026-08" });
    await settle();
    jest.advanceTimersByTime(180);
    await settle();
    for (const { key } of moduleCases) {
      await wrapper.get("#analysis-tab-" + key).trigger("click");
      const toggle = moduleArea(wrapper, key).get(".module-comparison-toggle");
      expect(toggle.attributes("disabled")).toBeDefined();
      await toggle.trigger("click");
      await settle();
      expect(comparisonStates(wrapper)).toEqual(beforeStates);
    }
    expect(requestCounts()).toEqual({
      statistics: beforeRequests.statistics,
      window: beforeRequests.window + 1,
    });
    resolveWindow(response(mockGetWindowAnalysis.mock.calls.at(-1)![0]));
    await settle();
    expect(comparisonStates(wrapper)).toEqual(beforeStates);
    for (const { key } of moduleCases)
      expect(
        moduleArea(wrapper, key)
          .get(".module-comparison-toggle")
          .attributes("disabled"),
      ).toBeUndefined();
  });

  it("普通同查询刷新保留多个模块不同的对比显示状态及当前历史月份", async () => {
    const wrapper = await mountPanel();
    for (const key of ["balances", "projects", "personnel"] as const) {
      await wrapper.get("#analysis-tab-" + key).trigger("click");
      await moduleArea(wrapper, key)
        .get(".module-comparison-toggle")
        .trigger("click");
    }
    await settle();
    const statesBefore = comparisonStates(wrapper);
    const queryBefore = wrapper.get(".displayed-query").text();
    const rangeBefore = moduleArea(wrapper, "personnel")
      .get(".visible-window-range")
      .text();
    const requestsBefore = requestCounts();
    await wrapper.setProps({ refreshKey: 1 });
    await settle();
    expect(requestCounts()).toEqual({
      statistics: requestsBefore.statistics + 1,
      window: requestsBefore.window + 1,
    });
    expect(comparisonStates(wrapper)).toEqual(statesBefore);
    expect(wrapper.get(".displayed-query").text()).toBe(queryBefore);
    for (const { key } of moduleCases) {
      const area = moduleArea(wrapper, key);
      expect(area.get(".visible-window-range").text()).toBe(rangeBefore);
      expect(
        area.findAll('.chart-value-label[data-series="comparison"]'),
      ).toHaveLength(statesBefore[key] === "true" ? 12 : 0);
    }
  });

  it("关闭其他模块对比不会清除余额选中的同期资金饼图", async () => {
    const wrapper = await mountPanel();
    const balances = moduleArea(wrapper, "balances");
    await balances
      .get('.chart-value-label[data-series="comparison"]')
      .trigger("click");
    await settle();
    const selectedScope = balances.get(".balance-structure-scope").text();
    expect(selectedScope).toContain("对比期");
    const beforeRequests = requestCounts();
    for (const { key } of moduleCases.filter(
      (module) => module.key !== "balances",
    )) {
      await wrapper.get("#analysis-tab-" + key).trigger("click");
      await moduleArea(wrapper, key)
        .get(".module-comparison-toggle")
        .trigger("click");
      await settle();
      expect(balances.get(".balance-structure-scope").text()).toBe(
        selectedScope,
      );
      expect(balances.find(".balance-year-reset").exists()).toBe(true);
      expect(
        balances.get(".module-comparison-toggle").attributes("aria-pressed"),
      ).toBe("true");
    }
    await wrapper.get("#analysis-tab-balances").trigger("click");
    await balances.get(".module-comparison-toggle").trigger("click");
    await settle();
    expect(balances.find(".balance-year-reset").exists()).toBe(false);
    expect(balances.get(".balance-structure-scope").text()).toContain(
      "2026年度资金占比",
    );
    expect(requestCounts()).toEqual(beforeRequests);
  });

  it("隐藏同期会把已选同期饼图恢复年度，但不清除已选当前期月份", async () => {
    installFullscreen();
    const wrapper = await mountPanel();
    const area = wrapper.get(".balance-visualization");
    const before = requestCounts();
    await area
      .get('.chart-value-label[data-series="comparison"]')
      .trigger("click");
    await settle();
    expect(area.get(".balance-structure-scope").text()).toContain("对比期");
    expect(area.find(".balance-year-reset").exists()).toBe(true);
    await area.get(".balance-comparison-toggle").trigger("click");
    await settle();
    expect(area.find(".balance-year-reset").exists()).toBe(false);
    expect(area.get(".balance-structure-scope").text()).toContain(
      "2026年度资金占比",
    );
    await area.get(".balance-comparison-toggle").trigger("click");
    await settle();
    await area
      .get('.chart-value-label[data-series="current"]')
      .trigger("click");
    await settle();
    const selectedCurrent = area.get(".balance-structure-scope").text();
    expect(area.find(".balance-year-reset").exists()).toBe(true);
    expect(selectedCurrent).not.toContain("对比期");
    await area.get(".balance-comparison-toggle").trigger("click");
    await settle();
    expect(area.find(".balance-year-reset").exists()).toBe(true);
    expect(area.get(".balance-structure-scope").text()).toBe(selectedCurrent);
    expect(requestCounts()).toEqual(before);
  });

  it("从余额切换到项目仍保持同一个根全屏，顶部退出按钮可结束会话", async () => {
    const native = installFullscreen();
    const wrapper = await mountPanel();
    await wrapper.get(".balance-fullscreen-toggle").trigger("click");
    await settle();
    await wrapper.get("#analysis-tab-projects").trigger("click");
    await settle();
    expect(native.exit).not.toHaveBeenCalled();
    expect(document.fullscreenElement).toBe(fullscreenRoot(wrapper).element);
    expect(fullscreenRoot(wrapper).classes()).toContain("is-fullscreen");
    expect(
      wrapper.get("#analysis-tab-projects").attributes("aria-selected"),
    ).toBe("true");
    await fullscreenRoot(wrapper)
      .get(".panel-fullscreen-exit")
      .trigger("click");
    await settle();
    expect(native.exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
  });

  it("从余额进入全屏后切到资金入账，顶部退出将焦点交回当前模块入口而非隐藏的原入口", async () => {
    const native = installFullscreen();
    const wrapper = await mountPanel();
    const originalEntry = wrapper.get(".balance-fullscreen-toggle");
    (originalEntry.element as HTMLElement).focus();
    expect(document.activeElement).toBe(originalEntry.element);
    await originalEntry.trigger("click");
    await settle();
    const panel = fullscreenRoot(wrapper);
    await panel.get("#analysis-tab-inflow").trigger("click");
    await settle();
    const currentEntry = panel.get(
      "#financial-analysis-inflow .module-fullscreen-toggle",
    );
    expect(panel.get("#analysis-tab-inflow").attributes("aria-selected")).toBe(
      "true",
    );
    await panel.get(".panel-fullscreen-exit").trigger("click");
    await settle();
    expect(native.exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(panel.classes()).not.toContain("is-fullscreen");
    expect(document.activeElement).toBe(currentEntry.element);
    expect(document.activeElement).not.toBe(originalEntry.element);
  });

  it("可在根全屏内操作筛选并提交查询，更新数据期间及完成后均不退出全屏", async () => {
    const native = installFullscreen();
    const wrapper = await mountPanel();
    const panel = fullscreenRoot(wrapper);
    await panel.get(".balance-fullscreen-toggle").trigger("click");
    await settle();
    const originalRoot = panel.element;
    expect(panel.element.contains(panel.get(".analysis-filters").element)).toBe(
      true,
    );
    expect(
      panel.element.contains(panel.get('[aria-label="分析统计周期"]').element),
    ).toBe(true);
    expect(
      panel.element.contains(panel.get('[aria-label="分析对比年份"]').element),
    ).toBe(true);
    expect(
      panel.element.contains(panel.get(".date-range-test-stub").element),
    ).toBe(true);
    let finish!: (value: MonthlyFinancialAnalysisData) => void;
    let requested!: FinancialAnalysisQuery;
    mockGetAnalysis.mockImplementationOnce((query: FinancialAnalysisQuery) => {
      requested = { ...query };
      return new Promise<MonthlyFinancialAnalysisData>((resolve) => {
        finish = resolve;
      });
    });
    await panel.get('[aria-label="分析统计周期"]').setValue("quarter");
    await panel.get(".query-button").trigger("click");
    await settle();
    expect(requested.granularity).toBe("quarter");
    expect(panel.attributes("aria-busy")).toBe("true");
    expect(panel.classes()).toContain("is-fullscreen");
    expect(document.fullscreenElement).toBe(originalRoot);
    finish({ ...response(requested), dataVersion: "显示更新版本" });
    await settle();
    expect(panel.get(".displayed-query").text()).toContain("季度");
    expect(panel.classes()).toContain("is-fullscreen");
    expect(fullscreenRoot(wrapper).element).toBe(originalRoot);
    expect(document.fullscreenElement).toBe(originalRoot);
    expect(native.request).toHaveBeenCalledTimes(1);
    expect(native.exit).not.toHaveBeenCalled();
  });

  it.each([
    { mode: "native" as const, label: "原生" },
    { mode: "rejected" as const, label: "后备" },
  ])(
    "$label根全屏中真实月份日历弹层挂到全屏根内而不是外部页面",
    async ({ mode }) => {
      jest.useRealTimers();
      installFullscreen(mode);
      const wrapper = await mountPanel(true);
      await flushPromises();
      const panel = fullscreenRoot(wrapper);
      expect(wrapper.find(".monthly-financial-date-range").exists()).toBe(true);
      expect(wrapper.find(".date-range-test-stub").exists()).toBe(false);
      await panel.get(".balance-fullscreen-toggle").trigger("click");
      await settle();
      await flushPromises();
      await panel.get(".month-range-picker").trigger("click");
      await nextTick();
      await flushPromises();
      await nextTick();
      const popup = document.querySelector(
        ".monthly-financial-date-range-popper",
      );
      expect(popup).not.toBeNull();
      expect(panel.element.contains(popup)).toBe(true);
      expect(
        wrapper.get(".monthly-financial-date-range").element.contains(popup),
      ).toBe(false);
      expect(popup?.querySelectorAll(".el-month-table")).toHaveLength(2);
      expect(popup?.textContent).toContain("一月");
      expect(panel.classes()).toContain("is-fullscreen");
    },
  );

  it.each([401, 403])(
    "查询返回%s表示登录或权限失效时，退出整个分析区全屏并清掉旧数据",
    async (status) => {
      const native = installFullscreen();
      const wrapper = await mountPanel();
      await wrapper.get(".balance-fullscreen-toggle").trigger("click");
      await settle();
      expect(fullscreenRoot(wrapper).classes()).toContain("is-fullscreen");
      mockGetAnalysis.mockRejectedValueOnce({
        response: { status, data: { message: "登录或查看权限已失效" } },
      });
      await wrapper.setProps({ refreshKey: 1 });
      await settle();
      expect(native.exit).toHaveBeenCalledTimes(1);
      expect(document.fullscreenElement).toBeNull();
      expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
      expect(fullscreenRoot(wrapper).findAll(".analysis-module")).toHaveLength(
        0,
      );
      expect(document.body.style.overflow).toBe("auto");
    },
  );

  it("面板停用时结束后备全屏，并恢复原页面滚动", async () => {
    installFullscreen("rejected");
    const wrapper = await mountPanel();
    await wrapper.get(".balance-fullscreen-toggle").trigger("click");
    await settle();
    expect(document.body.style.overflow).toBe("hidden");
    await wrapper.setProps({ active: false });
    await settle();
    expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
    expect(document.body.style.overflow).toBe("auto");
  });

  it("卸载时退出原生全屏，移除事件与定时器", async () => {
    const native = installFullscreen();
    const remove = jest.spyOn(document, "removeEventListener");
    const wrapper = await mountPanel();
    await wrapper.get(".balance-fullscreen-toggle").trigger("click");
    await settle();
    await unmountPanel(wrapper);
    expect(native.exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(remove).toHaveBeenCalledWith(
      "fullscreenchange",
      expect.any(Function),
    );
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(jest.getTimerCount()).toBe(0);
  });

  it("卸载时结束后备全屏并恢复进入前的页面滚动值", async () => {
    installFullscreen("unsupported");
    const wrapper = await mountPanel();
    await wrapper.get(".balance-fullscreen-toggle").trigger("click");
    await settle();
    expect(document.body.style.overflow).toBe("hidden");
    await unmountPanel(wrapper);
    expect(document.body.style.overflow).toBe("auto");
    expect(jest.getTimerCount()).toBe(0);
  });

  it("取消等待中的全屏请求后，迟到拒绝不能重新打开页面铺满后备", async () => {
    const native = installFullscreen();
    let reject!: (reason: Error) => void;
    native.request.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, decline) => {
          reject = decline;
        }),
    );
    const wrapper = await mountPanel();
    const button = wrapper.get(".balance-fullscreen-toggle");
    await button.trigger("click");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(button.attributes("disabled")).toBeDefined();
    expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
    reject(new Error("迟到的浏览器拒绝"));
    await settle();
    expect(button.attributes("disabled")).toBeUndefined();
    expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
    expect(wrapper.find(".fullscreen-message").exists()).toBe(false);
    expect(document.body.style.overflow).toBe("auto");
    expect(native.exit).not.toHaveBeenCalled();
  });

  it("取消等待中的进入操作后禁止重入，旧请求结算清理自身后才允许新会话", async () => {
    const native = installFullscreen();
    let complete!: () => void;
    let requestedElement: HTMLElement | null = null;
    native.request.mockImplementationOnce(() => {
      requestedElement = native.request.mock.contexts.at(-1) as HTMLElement;
      return new Promise<void>((resolve) => {
        complete = resolve;
      });
    });
    const wrapper = await mountPanel();
    const button = wrapper.get(".balance-fullscreen-toggle");
    await button.trigger("click");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(button.attributes("disabled")).toBeDefined();
    await button.trigger("click");
    expect(native.request).toHaveBeenCalledTimes(1);
    nativeElement = requestedElement;
    complete();
    await settle();
    expect(native.exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(button.attributes("disabled")).toBeUndefined();
    await button.trigger("click");
    await settle();
    expect(native.request).toHaveBeenCalledTimes(2);
    expect(native.exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBe(fullscreenRoot(wrapper).element);
    expect(fullscreenRoot(wrapper).classes()).toContain("is-fullscreen");
  });

  it("取消后的迟到成功不退出其他容器已经进入的全屏", async () => {
    const native = installFullscreen();
    let complete!: () => void;
    native.request.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const wrapper = await mountPanel();
    await wrapper.get(".balance-fullscreen-toggle").trigger("click");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    const other = document.createElement("section");
    document.body.appendChild(other);
    nativeElement = other;
    document.dispatchEvent(new Event("fullscreenchange"));
    complete();
    await settle();
    expect(native.exit).not.toHaveBeenCalled();
    expect(document.fullscreenElement).toBe(other);
    expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
    expect(
      wrapper.get(".balance-fullscreen-toggle").attributes("disabled"),
    ).toBeUndefined();
  });

  it("其他容器的全屏变化不会把焦点抢回账户余额按钮", async () => {
    const native = installFullscreen();
    const wrapper = await mountPanel();
    const button = wrapper.get(".balance-fullscreen-toggle");
    (button.element as HTMLElement).focus();
    await button.trigger("click");
    await settle();
    await button.trigger("click");
    await settle();
    const other = document.createElement("button");
    other.textContent = "其他内容控制";
    document.body.appendChild(other);
    other.focus();
    expect(document.activeElement).toBe(other);
    nativeElement = other;
    document.dispatchEvent(new Event("fullscreenchange"));
    await settle();
    expect(document.activeElement).toBe(other);
    nativeElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
    await settle();
    expect(document.activeElement).toBe(other);
    expect(fullscreenRoot(wrapper).classes()).not.toContain("is-fullscreen");
    expect(native.exit).toHaveBeenCalledTimes(1);
  });

  it("全屏请求在卸载后迟到时不会重新打开视觉区或留下原生全屏", async () => {
    const native = installFullscreen();
    let complete!: () => void;
    let requestedElement: HTMLElement | null = null;
    native.request.mockImplementationOnce(() => {
      requestedElement = native.request.mock.contexts.at(-1) as HTMLElement;
      return new Promise<void>((resolve) => {
        complete = resolve;
      });
    });
    const wrapper = await mountPanel();
    await wrapper.get(".balance-fullscreen-toggle").trigger("click");
    expect(
      wrapper.get(".balance-fullscreen-toggle").attributes("disabled"),
    ).toBeDefined();
    await unmountPanel(wrapper);
    nativeElement = requestedElement;
    complete();
    await settle();
    expect(native.exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
    expect(jest.getTimerCount()).toBe(0);
  });
});
