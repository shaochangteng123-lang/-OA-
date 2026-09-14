const mockWarning = jest.fn();
const mockSuccess = jest.fn();
const mockGetReport = jest.fn();
const mockGetTrend = jest.fn();
const mockSaveManualItems = jest.fn();
let mockRole = "admin";

jest.mock("@/utils/api", () => ({ api: {} }));

jest.mock("vue-router", () => ({
  useRoute: () => ({ query: { month: "2026-09" } }),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  onBeforeRouteLeave: jest.fn(),
  onBeforeRouteUpdate: jest.fn(),
}));
jest.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ user: { role: mockRole } }),
}));
jest.mock("element-plus", () => ({
  ElMessage: {
    warning: (...args: unknown[]) => mockWarning(...args),
    success: (...args: unknown[]) => mockSuccess(...args),
    error: jest.fn(),
    info: jest.fn(),
  },
  ElMessageBox: { confirm: jest.fn() },
}));
jest.mock("@/utils/monthlyFinancialReportApi", () => ({
  getMonthlyFinancialReport: (...args: unknown[]) => mockGetReport(...args),
  getMonthlyFinancialReportTrend: (...args: unknown[]) => mockGetTrend(...args),
  saveMonthlyFinancialManualItems: (...args: unknown[]) =>
    mockSaveManualItems(...args),
  refreshMonthlyFinancialReport: jest.fn(),
  closeMonthlyFinancialReport: jest.fn(),
  reopenMonthlyFinancialReport: jest.fn(),
  downloadMonthlyFinancialReport: jest.fn(),
  getMonthlyFinancialReportErrorMessage: (_error: unknown, fallback: string) =>
    fallback,
  isMonthlyFinancialReportNotFound: () => false,
  isMonthlyFinancialReportVersionConflict: () => false,
}));

import { nextTick } from "vue";
import MonthlyFinancialReportPage from "@/views/MonthlyFinancialReport.vue";
import type { MonthlyFinancialReport } from "@/types/monthlyFinancialReport";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const zeroIncome = {
  mainReceipt: "0",
  tax: "0",
  marketingReserve: "0",
  businessCost: "0",
  accountingBase: "0",
  generalInterest: "0",
  businessInterest: "0",
  welfareOneSupplement: "0",
  welfareTwoSupplement: "0",
};
const zeroExpenses = {
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
};
const reportFixture: MonthlyFinancialReport = {
  month: "2026-09",
  status: "draft",
  version: 3,
  snapshotVersion: null,
  isFirstMonth: false,
  generatedAt: "2026-09-02T01:00:00.000Z",
  savedAt: "2026-09-02T01:00:00.000Z",
  closedAt: null,
  closedByName: null,
  reopenedAt: null,
  accounts: [
    {
      code: "general",
      name: "一般账户",
      opening: "0",
      inflow: "0",
      outflow: "0",
      closing: "0",
    },
    {
      code: "business",
      name: "商务账户",
      opening: "0",
      inflow: "0",
      outflow: "0",
      closing: "0",
    },
    {
      code: "welfare_one",
      name: "福利金账户一",
      opening: "0",
      inflow: "0",
      outflow: "0",
      closing: "0",
    },
    {
      code: "welfare_two",
      name: "福利金账户二",
      opening: "0",
      inflow: "0",
      outflow: "0",
      closing: "0",
    },
  ],
  income: zeroIncome,
  expenses: zeroExpenses,
  automaticDetails: [],
  totals: {
    opening: "0",
    income: "0",
    expense: "0",
    closing: "0",
    netChange: "0",
  },
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

const componentStubs = {
  ElAlert: { template: "<div><slot /></div>" },
  ElButton: {
    name: "ElButton",
    props: ["disabled", "loading"],
    emits: ["click"],
    template:
      '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
  },
  ElCard: { template: '<section><slot name="header" /><slot /></section>' },
  ElCollapse: { template: "<div><slot /></div>" },
  ElCollapseItem: { template: "<div><slot /></div>" },
  ElDatePicker: {
    props: ["modelValue"],
    emits: ["update:modelValue", "change"],
    template:
      '<input class="date-stub" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)" />',
  },
  ElDescriptions: { template: "<div><slot /></div>" },
  ElDescriptionsItem: { template: "<div><slot /></div>" },
  ElEmpty: { template: "<div><slot /></div>" },
  ElIcon: { template: "<i><slot /></i>" },
  ElInput: {
    props: ["modelValue", "placeholder"],
    emits: ["update:modelValue", "input"],
    template:
      '<input :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'input\', $event.target.value)" />',
  },
  ElLink: { template: "<a><slot /></a>" },
  ElSkeleton: { template: "<div />" },
  ElTabPane: { template: "<section><slot /></section>" },
  ElTabs: { template: "<div><slot /></div>" },
  ElTag: { template: "<span><slot /></span>" },
  MonthlyBankReceiptPanel: { template: "<div />" },
  MonthlyFinancialAnalysisPanel: { template: "<div />" },
  MonthlyFinancialTrendChart: { template: "<div />" },
};

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe("一般账户实际税费支付手工录入", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = "admin";
    mockGetReport.mockResolvedValue(reportFixture);
    mockGetTrend.mockResolvedValue({
      from: "2026-01",
      to: "2026-09",
      availableYears: [2026],
      points: [],
      mainBusinessRegions: [],
      mainBusinessPoints: [],
      warnings: [],
    });
    mockSaveManualItems.mockResolvedValue({
      report: reportFixture,
      affectedMonths: [],
    });
  });

  it("真实挂载后仅在一般账户流出项添加，并依次校验金额、说明和凭证号", async () => {
    const wrapper = mount(MonthlyFinancialReportPage, {
      global: { stubs: componentStubs },
    });
    await settle();
    const generalSection = wrapper
      .findAll(".manual-sheet-section")
      .find((section) => section.get("h3").text() === "一般账户")!;
    const taxRow = generalSection
      .findAll(".manual-category-row")
      .find((row) => row.text().includes("一般账户实际税费支付"))!;
    expect(taxRow.exists()).toBe(true);
    expect(taxRow.text()).toContain("流出");
    expect(
      wrapper
        .findAll(".manual-sheet-section")
        .filter((section) => section.get("h3").text() !== "一般账户")
        .some((section) => section.text().includes("一般账户实际税费支付")),
    ).toBe(false);
    await taxRow.get("button").trigger("click");
    await nextTick();
    const amountInput = wrapper.get('input[placeholder="请输入金额"]');
    const descriptionInput = wrapper.get('input[placeholder="必填：业务说明"]');
    const voucherInput = wrapper.get('input[placeholder="必填：凭证号"]');
    const saveButton = wrapper
      .get(".manual-actions")
      .findAll("button")
      .find((button) => button.text().includes("保存维护数据"))!;

    expect(saveButton.attributes("disabled")).toBeUndefined();
    await saveButton.trigger("click");
    expect(mockWarning).toHaveBeenLastCalledWith(
      "一般账户实际税费支付请输入大于零的十进制金额，整数最多18位、小数最多12位",
    );
    expect(mockSaveManualItems).not.toHaveBeenCalled();
    await amountInput.setValue("100.5");
    await descriptionInput.setValue("   ");
    await saveButton.trigger("click");
    expect(mockWarning).toHaveBeenLastCalledWith(
      "一般账户实际税费支付必须填写业务说明",
    );
    await descriptionInput.setValue("九月实际缴纳增值税");
    await voucherInput.setValue("   ");
    await saveButton.trigger("click");
    expect(mockWarning).toHaveBeenLastCalledWith(
      "一般账户实际税费支付必须填写凭证号",
    );
    await voucherInput.setValue("税费凭证-2026-09-001");
    await saveButton.trigger("click");
    await settle();
    expect(mockSaveManualItems).toHaveBeenCalledWith(
      "2026-09",
      3,
      [
        {
          id: undefined,
          category: "general_tax_payment",
          occurredOn: "2026-09-01",
          amount: "100.5",
          description: "九月实际缴纳增值税",
          voucherReference: "税费凭证-2026-09-001",
        },
      ],
      undefined,
    );
    wrapper.unmount();
  });

  it("只读角色可核对实际税费金额及凭证，但不能添加或保存", async () => {
    mockRole = "general_manager";
    const paidReport: MonthlyFinancialReport = {
      ...reportFixture,
      accounts: reportFixture.accounts.map((account) =>
        account.code === "general"
          ? { ...account, outflow: "100.5", closing: "-100.5" }
          : account,
      ),
      expenses: { ...zeroExpenses, generalTaxPayment: "100.5" },
      manualItems: [
        {
          id: "tax-paid",
          category: "general_tax_payment",
          categoryLabel: "一般账户实际税费支付",
          accountCode: "general",
          direction: "expense",
          occurredOn: "2026-09-01",
          amount: "100.5",
          description: "九月实际缴纳增值税",
          voucherReference: "税费凭证-2026-09-001",
          sourceType: "manual",
        },
      ],
    };
    mockGetReport.mockResolvedValueOnce(paidReport);
    const wrapper = mount(MonthlyFinancialReportPage, {
      global: { stubs: componentStubs },
    });
    await settle();
    const manual = wrapper.get(".manual-card");
    expect(manual.text()).toContain("一般账户实际税费支付");
    expect(manual.text()).toContain("¥100.50");
    expect(manual.text()).toContain("税费凭证-2026-09-001");
    expect(manual.find('input[placeholder="必填：凭证号"]').exists()).toBe(
      false,
    );
    expect(manual.findAll("button")).toHaveLength(0);
    const generalAccount = wrapper
      .findAll(".account-card")
      .find((card) => card.get("h2").text() === "一般账户")!;
    await generalAccount.get(".account-detail-toggle").trigger("click");
    const taxFlow = generalAccount
      .findAll(".flow-row")
      .find((row) => row.text().includes("一般账户实际税费支付"))!;
    expect(taxFlow.text()).toContain("¥100.50");
    expect(taxFlow.text()).toContain("实际税费支付凭证");
    expect(mockSaveManualItems).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("福利双账户动态分类", () => {
  const category = (
    id: string,
    code: string,
    name: string,
    amounts: Partial<{
      automaticAmount: string;
      manualAmount: string;
      totalAmount: string;
      isActive: boolean;
      isFixed: boolean;
    }> = {},
  ) => ({
    id,
    code,
    name,
    sortOrder: 1,
    isActive: amounts.isActive ?? true,
    automaticAmount: amounts.automaticAmount || "0",
    manualAmount: amounts.manualAmount || "0",
    totalAmount: amounts.totalAmount || "0",
    isFixed: amounts.isFixed ?? false,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = "admin";
    mockSaveManualItems.mockResolvedValue({
      report: reportFixture,
      affectedMonths: [],
    });
  });

  it("删除或停用且无金额的分类不显示，福利2手工项与自动报销各显示一次且自动行只读", async () => {
    const dynamicReport: MonthlyFinancialReport = {
      ...reportFixture,
      welfareOneExpenseCategories: [
        category("welfare-one-office", "office", "办公", {
          isFixed: true,
        }),
        category("welfare-one-deleted", "deleted", "已删除分类", {
          isActive: false,
        }),
      ],
      welfareTwoExpenseCategories: [
        category("welfare-two-tea", "refreshment", "茶歇", {
          isFixed: true,
        }),
        category("welfare-two-team", "team_building", "团建", {
          automaticAmount: "30",
          manualAmount: "20",
          totalAmount: "50",
          isFixed: true,
        }),
        category("welfare-two-exam", "physical_exam", "体检", {
          manualAmount: "5",
          totalAmount: "5",
          isFixed: true,
        }),
        category("welfare-two-travel", "travel", "交通补贴"),
        category("welfare-two-deleted", "deleted", "福利2已删除分类", {
          isActive: false,
        }),
      ],
      manualItems: [
        {
          id: "manual-team",
          category: "welfare_two_expense",
          categoryLabel: "团建",
          accountCode: "welfare_two",
          direction: "expense",
          occurredOn: "2026-09-05",
          amount: "20",
          description: "团队活动",
          voucherReference: null,
          sourceType: "manual",
          welfareCategoryId: "welfare-two-team",
          welfareCategoryNameSnapshot: "团建",
        },
        {
          id: "reimbursement-team",
          category: "welfare_two_expense",
          categoryLabel: "团建",
          accountCode: "welfare_two",
          direction: "expense",
          occurredOn: "2026-09-06",
          amount: "30",
          description: "福利2自动报销",
          voucherReference: "reimbursement-team",
          sourceType: "reimbursement",
          welfareCategoryId: "welfare-two-team",
          welfareCategoryNameSnapshot: "团建",
        },
        {
          id: "legacy-exam",
          category: "welfare_two_physical_exam",
          categoryLabel: "体检",
          accountCode: "welfare_two",
          direction: "expense",
          occurredOn: "2026-09-07",
          amount: "5",
          description: null,
          voucherReference: null,
          sourceType: "manual",
        },
      ],
    };
    mockGetReport.mockResolvedValue(dynamicReport);

    const wrapper = mount(MonthlyFinancialReportPage, {
      global: { stubs: componentStubs },
    });
    await settle();
    const welfareOneSection = wrapper
      .findAll(".manual-sheet-section")
      .find((section) => section.get("h3").text() === "福利账户一")!;
    const welfareTwoSection = wrapper
      .findAll(".manual-sheet-section")
      .find((section) => section.get("h3").text() === "福利账户二")!;

    expect(welfareOneSection.text()).not.toContain("饮用水");
    expect(welfareOneSection.text()).not.toContain("已删除分类");
    expect(welfareTwoSection.text()).not.toContain("福利2已删除分类");
    const teamCategory = welfareTwoSection
      .findAll(".manual-category-row")
      .find((row) => row.text().includes("团建"))!;
    expect(teamCategory.text()).toContain("已添加 2 条明细");
    expect(
      welfareTwoSection
        .findAll(".manual-entry-row")
        .filter((row) => row.text().includes("自动报销")),
    ).toHaveLength(1);
    const automaticRow = welfareTwoSection
      .findAll(".manual-entry-row")
      .find((row) => row.text().includes("自动报销"))!;
    expect(automaticRow.find("input").exists()).toBe(false);
    expect(automaticRow.find("button").exists()).toBe(false);
    expect(welfareTwoSection.text()).toContain("¥50.00");
    expect(welfareTwoSection.text()).toContain("¥5.00");
    const welfareTwoAccount = wrapper
      .findAll(".account-card")
      .find((card) => card.get("h2").text() === "福利金账户二")!;
    await welfareTwoAccount.get(".account-detail-toggle").trigger("click");
    const welfareTwoFlows = welfareTwoAccount
      .findAll(".flow-row")
      .map((row) => row.text());
    expect(welfareTwoFlows.some((row) => row.includes("团建") && row.includes("¥50.00"))).toBe(true);
    expect(welfareTwoFlows.some((row) => row.includes("体检") && row.includes("¥5.00"))).toBe(true);
    expect(welfareTwoAccount.text()).not.toContain("福利2已删除分类");
    wrapper.unmount();
  });

  it("默认与自定义福利2分类均可新增手工明细并保存分类编号与名称快照", async () => {
    const dynamicReport: MonthlyFinancialReport = {
      ...reportFixture,
      welfareOneExpenseCategories: [],
      welfareTwoExpenseCategories: [
        category("welfare-two-tea", "refreshment", "茶歇", {
          isFixed: true,
        }),
        category("welfare-two-travel", "travel", "交通补贴"),
      ],
      manualItems: [],
    };
    mockGetReport.mockResolvedValue(dynamicReport);
    const wrapper = mount(MonthlyFinancialReportPage, {
      global: { stubs: componentStubs },
    });
    await settle();
    const welfareTwoSection = wrapper
      .findAll(".manual-sheet-section")
      .find((section) => section.get("h3").text() === "福利账户二")!;
    const defaultRow = welfareTwoSection
      .findAll(".manual-category-row")
      .find((row) => row.text().includes("茶歇"))!;
    await defaultRow.get("button").trigger("click");
    await nextTick();
    const customRow = wrapper
      .findAll(".manual-sheet-section")
      .find((section) => section.get("h3").text() === "福利账户二")!
      .findAll(".manual-category-row")
      .find((row) => row.text().includes("交通补贴"))!;
    await customRow.get("button").trigger("click");
    await nextTick();
    const amountInputs = wrapper.findAll('input[placeholder="请输入金额"]');
    expect(amountInputs).toHaveLength(2);
    await amountInputs[0].setValue("3");
    await amountInputs[1].setValue("12.5");
    const saveButton = wrapper
      .get(".manual-actions")
      .findAll("button")
      .find((button) => button.text().includes("保存维护数据"))!;
    await saveButton.trigger("click");
    await settle();
    expect(mockSaveManualItems).toHaveBeenCalledWith(
      "2026-09",
      3,
      [
        {
          id: undefined,
          category: "welfare_two_expense",
          occurredOn: "2026-09-01",
          amount: "3",
          description: null,
          voucherReference: null,
          welfareCategoryId: "welfare-two-tea",
          welfareCategoryNameSnapshot: "茶歇",
        },
        {
          id: undefined,
          category: "welfare_two_expense",
          occurredOn: "2026-09-01",
          amount: "12.5",
          description: null,
          voucherReference: null,
          welfareCategoryId: "welfare-two-travel",
          welfareCategoryNameSnapshot: "交通补贴",
        },
      ],
      undefined,
    );
    wrapper.unmount();
  });

  it("缺少动态目录的旧月报继续展示福利一与福利二静态手工分类", async () => {
    const legacyReport: MonthlyFinancialReport = {
      ...reportFixture,
      welfareOneExpenseCategories: undefined,
      welfareTwoExpenseCategories: undefined,
      manualItems: [
        {
          id: "legacy-office",
          category: "welfare_one_office",
          categoryLabel: "办公",
          accountCode: "welfare_one",
          direction: "expense",
          occurredOn: "2026-09-03",
          amount: "8",
          description: null,
          voucherReference: null,
          sourceType: "manual",
        },
        {
          id: "legacy-tea",
          category: "welfare_two_refreshment",
          categoryLabel: "茶歇",
          accountCode: "welfare_two",
          direction: "expense",
          occurredOn: "2026-09-04",
          amount: "6",
          description: null,
          voucherReference: null,
          sourceType: "manual",
        },
      ],
    };
    mockGetReport.mockResolvedValue(legacyReport);
    const wrapper = mount(MonthlyFinancialReportPage, {
      global: { stubs: componentStubs },
    });
    await settle();
    const manual = wrapper.get(".manual-card");
    expect(manual.text()).toContain("办公");
    expect(manual.text()).toContain("¥8.00");
    expect(manual.text()).toContain("茶歇");
    expect(manual.text()).toContain("¥6.00");
    wrapper.unmount();
  });
});
