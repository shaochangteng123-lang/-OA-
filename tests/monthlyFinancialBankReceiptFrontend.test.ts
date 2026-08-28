import { createHash } from "crypto";

const mockGetBankReceipts = jest.fn();
const mockGetReport = jest.fn();
const mockUploadBankReceipts = jest.fn();
const mockReviewBankTransaction = jest.fn();

jest.mock("@/utils/monthlyFinancialReportApi", () => ({
  getMonthlyFinancialBankReceipts: (...args: unknown[]) =>
    mockGetBankReceipts(...args),
  getMonthlyFinancialReport: (...args: unknown[]) => mockGetReport(...args),
  uploadMonthlyFinancialBankReceipts: (...args: unknown[]) =>
    mockUploadBankReceipts(...args),
  reviewMonthlyFinancialBankTransaction: (...args: unknown[]) =>
    mockReviewBankTransaction(...args),
  getMonthlyFinancialReportErrorCode: (error: {
    response?: { data?: { code?: string } };
  }) => String(error?.response?.data?.code || ""),
  getMonthlyFinancialReportErrorMessage: (
    error: {
      response?: { data?: { message?: string } };
      message?: string;
      code?: string;
    },
    fallback: string,
  ) => {
    if (error?.response?.data?.message) return error.response.data.message;
    if (error?.code === "ERR_NETWORK") {
      return "网络连接失败，请检查网络后先刷新回单状态，避免重复提交";
    }
    return error?.message || fallback;
  },
  isMonthlyFinancialBankMixedMonthConfirmationRequired: (error: {
    response?: { data?: { code?: string } };
  }) =>
    error?.response?.data?.code ===
    "MONTHLY_BANK_MIXED_MONTH_CONFIRMATION_REQUIRED",
  isMonthlyFinancialReportVersionConflict: (error: {
    response?: { status?: number; data?: { code?: string } };
  }) =>
    error?.response?.status === 409 &&
    error?.response?.data?.code === "MONTHLY_FINANCE_VERSION_CONFLICT",
}));

jest.mock("element-plus", () => ({
  ElMessage: {
    success: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
  ElMessageBox: {
    prompt: jest.fn(),
  },
}));

import { nextTick } from "vue";
import MonthlyBankReceiptPanel from "@/components/monthly-financial/MonthlyBankReceiptPanel.vue";
import type {
  MonthlyFinancialBankReceiptState,
  MonthlyFinancialReport,
} from "@/types/monthlyFinancialReport";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const elementStubs = {
  ElAlert: {
    props: ["title", "description"],
    template:
      '<div class="el-alert-stub"><strong>{{ title }}</strong><span>{{ description }}</span><slot /></div>',
  },
  ElButton: {
    props: { disabled: Boolean, loading: Boolean },
    emits: ["click"],
    template:
      '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
  },
  ElDialog: {
    props: { modelValue: Boolean, title: String },
    emits: ["update:modelValue"],
    template:
      '<section v-if="modelValue" class="dialog-stub" :data-title="title"><slot /><slot name="footer" /></section>',
  },
  ElEmpty: { template: '<div class="empty-stub"><slot /></div>' },
  ElIcon: { template: "<i><slot /></i>" },
  ElLink: { props: ["href"], template: '<a :href="href"><slot /></a>' },
  ElSkeleton: { template: '<div class="skeleton-stub" />' },
  ElTable: { template: '<div class="table-stub"><slot /></div>' },
  ElTableColumn: { template: "<div><slot /></div>" },
  ElTag: { template: "<span><slot /></span>" },
  Delete: true,
  Document: true,
  Loading: true,
  Refresh: true,
  UploadFilled: true,
};

function emptyBankState(month = "2026-06"): MonthlyFinancialBankReceiptState {
  const totals = {
    inflow: "0",
    outflow: "0",
    included: "0",
    internalTransfer: "0",
    interest: "0",
    bankFee: "0",
  };
  return {
    month,
    knownFileHashes: [],
    accounts: [
      {
        accountCode: "basic",
        accountName: "基本账户",
        accountNumber: "0200049609201258271",
        file: null,
        totals: { ...totals },
        transactions: [],
      },
      {
        accountCode: "general",
        accountName: "一般账户",
        accountNumber: "0200303519000018418",
        file: null,
        totals: { ...totals },
        transactions: [],
      },
      {
        accountCode: "business",
        accountName: "商务账户",
        accountNumber: "321240100100245908",
        file: null,
        totals: { ...totals },
        transactions: [],
      },
    ],
  };
}

function bankStateWithInterestAndFees(): MonthlyFinancialBankReceiptState {
  const state = emptyBankState();
  const totalsByAccount = {
    basic: { interest: "1.11", bankFee: "0" },
    general: { interest: "0", bankFee: "2.22" },
    business: { interest: "3.33", bankFee: "4.44" },
  } as const;
  state.accounts = state.accounts.map((account, index) => ({
    ...account,
    file: {
      id: `bank-file-${account.accountCode}`,
      originalName: `2026年06月${account.accountName}.pdf`,
      fileHash: String(index + 1).repeat(64),
      version: 1,
      pageCount: 1,
      receiptCount: 0,
      includedReceiptCount: 0,
      status: "recognized",
      detectedMonths: ["2026-06"],
      warnings: [],
      anomalies: [],
      uploadedBy: "admin-1",
      uploaderName: "管理员",
      recognizedAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
    totals: {
      ...account.totals,
      ...totalsByAccount[account.accountCode],
    },
  }));
  return state;
}

function report(
  month = "2026-06",
  version = 1,
  status: MonthlyFinancialReport["status"] = "draft",
): MonthlyFinancialReport {
  return {
    month,
    version,
    status,
    snapshotVersion: null,
    isFirstMonth: false,
    generatedAt: "2026-06-30T00:00:00.000Z",
    savedAt: null,
    closedAt: null,
    closedByName: null,
    reopenedAt: null,
    accounts: [],
    income: {} as MonthlyFinancialReport["income"],
    expenses: {} as MonthlyFinancialReport["expenses"],
    automaticDetails: [],
    totals: {} as MonthlyFinancialReport["totals"],
    manualItems: [],
    sources: [],
    validations: { canClose: status !== "closed", blockers: [], warnings: [] },
    permissions: {
      canEdit: status !== "closed",
      canRefresh: status !== "closed",
      canSubmitReview: false,
      canClose: status !== "closed",
      canReopen: status === "closed",
      canDownload: true,
    },
  };
}

function mountPanel(
  props: Partial<{
    month: string;
    expectedVersion: number;
    canUpload: boolean;
    disabled: boolean;
  }> = {},
) {
  return mount(MonthlyBankReceiptPanel, {
    props: {
      month: "2026-06",
      expectedVersion: 1,
      canUpload: true,
      disabled: false,
      ...props,
    },
    global: { stubs: elementStubs },
  });
}

function openDialog(wrapper: ReturnType<typeof mountPanel>) {
  (
    wrapper.vm as unknown as {
      openUploadDialog: () => void;
    }
  ).openUploadDialog();
  return nextTick();
}

async function refreshPanelState(wrapper: ReturnType<typeof mountPanel>) {
  await (
    wrapper.vm as unknown as {
      refreshBankState: () => Promise<void>;
    }
  ).refreshBankState();
  await flushPromises();
}

async function selectFile(
  wrapper: ReturnType<typeof mountPanel>,
  name = "2026年06月一般账户.pdf",
  content = "%PDF-1.7 测试回单",
) {
  const file = new File([content], name, {
    type: "application/pdf",
    lastModified: 1_787_590_800_000,
  });
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [file],
  });
  await input.trigger("change");
  await nextTick();
  return file;
}

function buttonByText(wrapper: ReturnType<typeof mountPanel>, text: string) {
  const button = wrapper
    .findAll("button")
    .find((candidate) => candidate.text().includes(text));
  if (!button) throw new Error(`未找到按钮：${text}`);
  return button;
}

async function settleUploadWork() {
  await flushPromises();
  await new Promise((resolve) => window.setTimeout(resolve, 20));
  await flushPromises();
}

describe("月报银行回单组件真实交互", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.sessionStorage.clear();
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        subtle: {
          digest: async (_algorithm: string, data: ArrayBuffer) => {
            const digest = createHash("sha256")
              .update(Buffer.from(data))
              .digest();
            return digest.buffer.slice(
              digest.byteOffset,
              digest.byteOffset + digest.byteLength,
            );
          },
        },
      },
    });
    mockGetBankReceipts.mockResolvedValue(emptyBankState());
  });

  it("一般和商务账户展示利息手续费，基本账户明确不纳入月报", async () => {
    mockGetBankReceipts.mockResolvedValueOnce(bankStateWithInterestAndFees());
    const wrapper = mountPanel();
    await flushPromises();

    const cards = wrapper.findAll(".bank-account-card");
    expect(cards).toHaveLength(3);
    expect(cards[0].text()).toContain("基本账户");
    expect(cards[0].text()).toContain("基本账户利息及手续费不纳入月报");
    expect(cards[0].text()).not.toContain("¥1.11");
    expect(cards[1].text()).toContain("一般账户");
    expect(cards[1].text()).toContain("利息¥0");
    expect(cards[1].text()).toContain("跨行手续费¥2.22");
    expect(cards[2].text()).toContain("商务账户");
    expect(cards[2].text()).toContain("利息¥3.33");
    expect(cards[2].text()).toContain("跨行手续费¥4.44");
    wrapper.unmount();
  });

  it("父页面同步完成后可主动刷新面板状态且不需要重建组件", async () => {
    mockGetBankReceipts
      .mockResolvedValueOnce(emptyBankState())
      .mockResolvedValueOnce(bankStateWithInterestAndFees());
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.text()).not.toContain("跨行手续费¥2.22");
    await refreshPanelState(wrapper);

    expect(mockGetBankReceipts).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("跨行手续费¥2.22");
    expect(wrapper.findAll(".bank-account-card")).toHaveLength(3);
    wrapper.unmount();
  });

  it("部分文件明确提示安全费用已计入且其他交易仍待核对", async () => {
    const state = bankStateWithInterestAndFees();
    const general = state.accounts.find(
      (account) => account.accountCode === "general",
    )!;
    general.file = {
      ...general.file!,
      status: "partial",
      warnings: ["存在未关联的合同收付款回单"],
    };
    general.transactions = [
      {
        id: "interest-safe",
        electronicReceiptNo: "INTEREST-001",
        transactionDate: "2026-06-21",
        amount: "103.69",
        direction: "inflow",
        payer: "银行",
        payerAccount: "bank",
        payee: "公司",
        payeeAccount: general.accountNumber,
        remark: "利息入账",
        pageNo: 1,
        position: "top",
        category: "interest",
        recognitionStatus: "recognized",
        includeInReport: true,
        warnings: [],
        linkStatus: "unmatched",
        previewUrl: null,
      },
      {
        id: "contract-review",
        electronicReceiptNo: "CONTRACT-001",
        transactionDate: "2026-06-20",
        amount: "1000",
        direction: "inflow",
        payer: "合同对方",
        payerAccount: "counterparty",
        payee: "公司",
        payeeAccount: general.accountNumber,
        remark: "项目款",
        pageNo: 2,
        position: "top",
        category: "main_income",
        recognitionStatus: "review_required",
        includeInReport: false,
        warnings: ["未找到对应的已确认合同收付款记录"],
        linkStatus: "unmatched",
        previewUrl: null,
      },
    ];
    mockGetBankReceipts.mockResolvedValueOnce(state);

    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("部分需复核");
    expect(wrapper.text()).toContain(
      "利息及跨行手续费已安全计入月报，其余交易仍待核对",
    );
    const alignedAlerts = wrapper
      .find(".bank-issue-list")
      .findAll(".el-alert-stub");
    expect(alignedAlerts).toHaveLength(2);
    expect(alignedAlerts[0]!.text()).toContain("存在未关联的合同收付款回单");
    expect(alignedAlerts[1]!.text()).toContain(
      "利息及跨行手续费已安全计入月报，其余交易仍待核对",
    );
    wrapper.unmount();
  });

  it("月份变化时清空已选文件并关闭上传弹窗", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await openDialog(wrapper);
    await selectFile(wrapper);
    expect(wrapper.findAll(".selected-bank-files article")).toHaveLength(1);
    expect(wrapper.find(".dialog-stub").exists()).toBe(true);

    mockGetBankReceipts.mockResolvedValueOnce(emptyBankState("2026-07"));
    await wrapper.setProps({ month: "2026-07" });
    await flushPromises();

    expect(wrapper.find(".dialog-stub").exists()).toBe(false);
    expect(wrapper.findAll(".selected-bank-files article")).toHaveLength(0);
    expect(wrapper.emitted("pending-change")?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it("上传成功后应用银行状态并清除此前的状态错误", async () => {
    mockGetBankReceipts.mockRejectedValueOnce(new Error("回单状态暂时不可用"));
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("银行回单状态加载失败");

    const nextReport = report("2026-06", 2);
    mockUploadBankReceipts.mockResolvedValue({
      report: nextReport,
      bankStatements: emptyBankState(),
      duplicateFiles: [],
      affectedMonths: [],
      message: "银行回单已更新",
    });
    await openDialog(wrapper);
    await selectFile(wrapper);
    await buttonByText(wrapper, "上传并识别").trigger("click");
    await settleUploadWork();

    expect(wrapper.text()).not.toContain("银行回单状态加载失败");
    expect(wrapper.find(".dialog-stub").exists()).toBe(false);
    expect(wrapper.emitted("uploaded")?.[0]?.[0]).toMatchObject({
      report: nextReport,
    });
    wrapper.unmount();
  });

  it("浏览器没有摘要接口时仍由服务端校验并完成上传", async () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });
    mockUploadBankReceipts.mockResolvedValue({
      report: report("2026-06", 2),
      bankStatements: emptyBankState(),
      duplicateFiles: [],
      affectedMonths: [],
      message: "银行回单已更新",
    });
    const wrapper = mountPanel();
    await flushPromises();
    await openDialog(wrapper);
    await selectFile(wrapper, "局域网回单.pdf");
    await buttonByText(wrapper, "上传并识别").trigger("click");
    await settleUploadWork();

    expect(mockUploadBankReceipts).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain("当前浏览器不支持");
    expect(wrapper.find(".dialog-stub").exists()).toBe(false);
    wrapper.unmount();
  });

  it("浏览器摘要计算异常时统一降级且不保留部分摘要", async () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        subtle: {
          digest: jest.fn().mockRejectedValue(new Error("摘要接口不可用")),
        },
      },
    });
    mockUploadBankReceipts.mockResolvedValue({
      report: report("2026-06", 2),
      bankStatements: emptyBankState(),
      duplicateFiles: [],
      affectedMonths: [],
      message: "银行回单已更新",
    });
    const wrapper = mountPanel();
    await flushPromises();
    await openDialog(wrapper);
    await selectFile(wrapper, "摘要异常回单.pdf");
    await buttonByText(wrapper, "上传并识别").trigger("click");
    await settleUploadWork();

    expect(mockUploadBankReceipts).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain("摘要接口不可用");
    wrapper.unmount();
  });

  it("无本地摘要的网络不确定状态可恢复并交由服务端安全重试", async () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {},
    });
    mockUploadBankReceipts.mockRejectedValue({
      code: "ERR_NETWORK",
      message: "Network Error",
    });
    const firstWrapper = mountPanel();
    await flushPromises();
    await openDialog(firstWrapper);
    await selectFile(firstWrapper, "无摘要原件.pdf");
    await buttonByText(firstWrapper, "上传并识别").trigger("click");
    await settleUploadWork();

    const stored = JSON.parse(
      window.sessionStorage.getItem("monthly-bank-upload-uncertain:2026-06") ||
        "{}",
    ) as { fileNames?: string[]; fileHashes?: string[] };
    expect(stored.fileNames).toEqual(["无摘要原件.pdf"]);
    expect(stored.fileHashes).toEqual([]);
    firstWrapper.unmount();

    const secondWrapper = mountPanel();
    await flushPromises();
    expect(secondWrapper.text()).toContain("处理结果仍待确认");
    expect(mockUploadBankReceipts).toHaveBeenCalledTimes(1);
    await buttonByText(secondWrapper, "确认未保存，重新上传").trigger("click");
    await nextTick();
    expect(secondWrapper.text()).not.toContain("处理结果仍待确认");
    expect(secondWrapper.find(".dialog-stub").exists()).toBe(true);
    expect(
      secondWrapper.get('input[type="file"]').attributes("disabled"),
    ).toBeUndefined();
    expect(
      window.sessionStorage.getItem("monthly-bank-upload-uncertain:2026-06"),
    ).toBeNull();
    secondWrapper.unmount();
  });

  it("版本冲突时刷新报表与回单状态但保留待上传文件", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const latestReport = report("2026-06", 2);
    mockGetReport.mockResolvedValue(latestReport);
    mockUploadBankReceipts.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: "MONTHLY_FINANCE_VERSION_CONFLICT",
          message: "月报版本已变化",
        },
      },
    });

    await openDialog(wrapper);
    await selectFile(wrapper);
    await buttonByText(wrapper, "上传并识别").trigger("click");
    await settleUploadWork();

    expect(wrapper.emitted("report-refreshed")?.[0]).toEqual([latestReport]);
    expect(wrapper.findAll(".selected-bank-files article")).toHaveLength(1);
    expect(wrapper.find(".dialog-stub").text()).toContain(
      "月报已刷新到最新版本",
    );
    wrapper.unmount();
  });

  it("结果不确定时取消弹窗后仍阻止重新上传", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    mockUploadBankReceipts.mockRejectedValue({
      code: "ERR_NETWORK",
      message: "Network Error",
    });

    await openDialog(wrapper);
    await selectFile(wrapper);
    await buttonByText(wrapper, "上传并识别").trigger("click");
    await settleUploadWork();
    expect(wrapper.find(".dialog-stub").text()).toContain("避免重复提交");

    await buttonByText(wrapper, "取消").trigger("click");
    await nextTick();
    expect(wrapper.find(".dialog-stub").exists()).toBe(false);
    await openDialog(wrapper);

    expect(wrapper.find(".dialog-stub").text()).toContain(
      "上一批上传结果仍待确认",
    );
    expect(
      wrapper.get('input[type="file"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      buttonByText(wrapper, "上传并识别").attributes("disabled"),
    ).toBeDefined();
    expect(mockUploadBankReceipts).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("结果不确定状态跨组件重建保留并按服务端文件摘要解除", async () => {
    mockUploadBankReceipts.mockRejectedValue({
      code: "ERR_NETWORK",
      message: "Network Error",
    });
    const firstWrapper = mountPanel();
    await flushPromises();
    await openDialog(firstWrapper);
    await selectFile(firstWrapper, "同名也必须按摘要确认.pdf");
    await buttonByText(firstWrapper, "上传并识别").trigger("click");
    await settleUploadWork();

    const stored = JSON.parse(
      window.sessionStorage.getItem("monthly-bank-upload-uncertain:2026-06") ||
        "{}",
    ) as { fileHashes?: string[] };
    expect(stored.fileHashes?.[0]).toMatch(/^[0-9a-f]{64}$/u);
    firstWrapper.unmount();

    const secondWrapper = mountPanel();
    await flushPromises();
    expect(secondWrapper.text()).toContain("处理结果仍待确认");
    expect(secondWrapper.emitted("uncertain-change")?.at(-1)).toEqual([true]);

    mockGetBankReceipts.mockResolvedValueOnce({
      ...emptyBankState(),
      knownFileHashes: [stored.fileHashes![0]!],
    });
    await buttonByText(secondWrapper, "刷新回单状态").trigger("click");
    await flushPromises();

    expect(secondWrapper.text()).not.toContain("处理结果仍待确认");
    expect(secondWrapper.emitted("uncertain-change")?.at(-1)).toEqual([false]);
    expect(
      window.sessionStorage.getItem("monthly-bank-upload-uncertain:2026-06"),
    ).toBeNull();
    secondWrapper.unmount();
  });

  it("安全重试只允许重新选择完全相同摘要的原件", async () => {
    mockUploadBankReceipts.mockRejectedValue({
      code: "ERR_NETWORK",
      message: "Network Error",
    });
    const firstWrapper = mountPanel();
    await flushPromises();
    await openDialog(firstWrapper);
    await selectFile(firstWrapper, "原批次一般账户.pdf");
    await buttonByText(firstWrapper, "上传并识别").trigger("click");
    await settleUploadWork();
    firstWrapper.unmount();

    const secondWrapper = mountPanel();
    await flushPromises();
    await buttonByText(secondWrapper, "重新选择同一批原件安全重试").trigger(
      "click",
    );
    await selectFile(secondWrapper, "不同文件.pdf", "%PDF-1.7 完全不同的回单");
    await buttonByText(secondWrapper, "上传并识别").trigger("click");
    await settleUploadWork();

    expect(secondWrapper.find(".dialog-stub").text()).toContain(
      "所选文件与上一批原件摘要不一致",
    );
    expect(mockUploadBankReceipts).toHaveBeenCalledTimes(1);
    secondWrapper.unmount();
  });

  it("版本冲突刷新为已月结后禁用上传并保留文件供核对", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    const closedReport = report("2026-06", 3, "closed");
    mockGetReport.mockResolvedValue(closedReport);
    mockUploadBankReceipts.mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: "MONTHLY_FINANCE_VERSION_CONFLICT",
          message: "月报版本已变化",
        },
      },
    });

    await openDialog(wrapper);
    await selectFile(wrapper);
    await buttonByText(wrapper, "上传并识别").trigger("click");
    await settleUploadWork();
    await wrapper.setProps({ canUpload: false, expectedVersion: 3 });

    expect(wrapper.find(".dialog-stub").text()).toContain("完成月结");
    expect(wrapper.findAll(".selected-bank-files article")).toHaveLength(1);
    expect(
      buttonByText(wrapper, "上传并识别").attributes("disabled"),
    ).toBeDefined();
    expect(wrapper.get(".bank-file-drop").attributes("aria-disabled")).toBe(
      "true",
    );
    wrapper.unmount();
  });
});
