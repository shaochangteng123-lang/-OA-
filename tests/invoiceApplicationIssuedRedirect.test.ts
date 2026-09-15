jest.mock("@/utils/invoiceApplicationApi", () => ({
  decideInvoiceApplication: jest.fn(),
  deleteInvoiceApplicationDraft: jest.fn(),
  deliverInvoiceApplication: jest.fn(),
  getInvoiceApplication: jest.fn(),
  getInvoiceApplicationFinancialProgress: jest.fn(),
  getInvoiceApplicationErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
  getInvoiceApplicationMaterialDownloadUrl: jest.fn(() => ""),
  getInvoiceApplicationMaterialPrintUrl: jest.fn(() => ""),
  getInvoiceApplicationMaterialPreviewUrl: jest.fn(() => ""),
  getInvoiceApplicationPendingCounts: jest.fn(),
  getInvoiceApplicationPreviewUrl: jest.fn(() => ""),
  getInvoiceApplications: jest.fn(),
  markInvoiceApplicationIssued: jest.fn(),
  withdrawInvoiceApplication: jest.fn(),
}));
jest.mock("@/components/contracts/ContractReadOnlyPreview.vue", () => ({
  __esModule: true,
  default: { template: "<div />" },
}));
jest.mock("@/utils/contractApi", () => ({ uploadContractFile: jest.fn() }));
jest.mock("@/utils/contractDownloadApi", () => ({
  requestContractDownloadBadgeRefresh: jest.fn(),
}));
jest.mock("@/utils/personalSignature", () => ({
  loadPersonalSignature: jest.fn(),
}));

import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  getInvoiceApplication,
  getInvoiceApplicationFinancialProgress,
  getInvoiceApplications,
  markInvoiceApplicationIssued,
} from "@/utils/invoiceApplicationApi";
import InvoiceApplicationCenter from "@/views/InvoiceApplicationCenter.vue";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const application = {
  id: "application-1",
  applicationNo: "KP-001",
  contractId: "contract-1",
  contractTitle: "测试合同",
  contractNo: "HT-001",
  category: "main_business" as const,
  area: "海淀区",
  partyA: "测试甲方",
  requiresTriplicate: true,
  contractAmount: 100,
  amount: 100,
  invoiceContent: "",
  invoiceType: "增值税普通发票",
  description: "",
  materialMode: "material_need_seal" as const,
  billingInfo: {
    name: "测试甲方",
    taxNumber: "TEST",
    address: "",
    phone: "",
    bankName: "",
    bankAccount: "",
    remark: "",
  },
  confirmedBillingIdentity: true,
  status: "pending_invoice" as const,
  version: 1,
  materials: [],
  auditLogs: [],
  applicant: { id: "admin-1", name: "管理员" },
  approver: { id: "manager-1", name: "总经理" },
  issuedAt: null,
};

const slotStub = { template: "<div><slot /></div>" };
const elementStubs = {
  ContractReadOnlyPreview: true,
  ElAlert: {
    props: ["title", "description"],
    template: "<div>{{ title }} {{ description }}<slot /></div>",
  },
  ElButton: { template: "<button><slot /></button>" },
  ElDescriptions: slotStub,
  ElDescriptionsItem: slotStub,
  ElDrawer: slotStub,
  ElEmpty: slotStub,
  ElIcon: slotStub,
  ElInput: { template: "<textarea />" },
  ElOption: slotStub,
  ElPagination: slotStub,
  ElSelect: slotStub,
  ElStep: slotStub,
  ElSteps: slotStub,
  ElTabPane: slotStub,
  ElTabs: slotStub,
  ElTag: { template: "<span><slot /></span>" },
  ElUpload: slotStub,
};

describe("管理员登记已开具后的跳转", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getInvoiceApplications as jest.Mock).mockResolvedValue({
      items: [application],
      total: 1,
    });
    (getInvoiceApplication as jest.Mock).mockResolvedValue(application);
  });

  it("正式发票已提前足额上传时直接显示完成，不再进入发票上传页", async () => {
    (getInvoiceApplications as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({ items: [application], total: 1 })
      .mockResolvedValueOnce({ items: [], total: 0 });
    (markInvoiceApplicationIssued as jest.Mock).mockResolvedValue({
      ...application,
      status: "completed",
      issuedAt: "2026-09-15T00:00:00.000Z",
    });
    (getInvoiceApplicationFinancialProgress as jest.Mock).mockResolvedValue({
      id: application.id,
      contractId: application.contractId,
      status: "completed",
      applicationAmount: 100,
      allocatedInvoiceAmount: 100,
      invoiceCompleted: true,
      requiresReceiptUpload: false,
      pendingReceiptAmount: 0,
      registrationId: null,
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/contract-tasks", component: InvoiceApplicationCenter },
        { path: "/contracts/:id", component: { template: "<div />" } },
      ],
    });
    await router.push("/contract-tasks?tab=invoice");
    await router.isReady();
    const wrapper = mount(InvoiceApplicationCenter, {
      props: { embedded: true, centerMode: "admin" },
      global: {
        plugins: [createPinia(), router],
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    const openButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("登记已开具"));
    expect(openButton).toBeDefined();
    await openButton!.trigger("click");
    await flushPromises();
    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("确认已开具并上传正式发票"));
    expect(confirmButton).toBeDefined();
    await confirmButton!.trigger("click");
    await flushPromises();

    expect(markInvoiceApplicationIssued).toHaveBeenCalledWith(
      application.id,
      "",
      1,
    );
    expect(router.currentRoute.value.path).toBe("/contract-tasks");
    expect(router.currentRoute.value.query).toMatchObject({
      tab: "invoice",
      view: "pending",
      result: "invoice-completed",
    });
    expect(router.currentRoute.value.path).not.toBe("/contracts/contract-1");
    expect(wrapper.text()).toContain("开票流程已完成");
    expect(getInvoiceApplications).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
