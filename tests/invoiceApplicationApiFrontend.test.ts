jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import { api } from "@/utils/api";
import {
  getInvoiceApplicationEligibility,
  getInvoiceApplicationMaterialPrintUrl,
  getInvoiceApplicationPendingCounts,
  getInvoiceApplicationPreviewUrl,
  getInvoiceApplications,
  inspectMainTriplicate,
  markInvoiceApplicationIssued,
  uploadInvoiceApplicationMaterials,
} from "@/utils/invoiceApplicationApi";

const application = {
  id: "invoice-application-1",
  applicationNo: "KP-202608-0001",
  contractId: "contract-1",
  contractTitle: "示例收入合同",
  contractNo: "HT-001",
  category: "main_business",
  area: "海淀区",
  partyA: "客户公司",
  contractAmount: 100000,
  amount: 20000,
  invoiceContent: "咨询服务费",
  invoiceType: "增值税专用发票",
  description: "",
  materialMode: "material_need_seal",
  billingInfo: {
    name: "客户公司",
    taxNumber: "91110000123456789X",
    address: "北京市",
    phone: "010-12345678",
    bankName: "示例银行",
    bankAccount: "123456",
    remark: "",
  },
  confirmedBillingIdentity: true,
  status: "pending_approval",
  version: 2,
  applicant: {
    id: "user-1",
    name: "员工甲",
    department: "项目部",
    position: "报批报建专员",
  },
  approver: { id: "gm-1", name: "总经理", position: "总经理" },
  applicantSignedAt: "2026-08-19T10:00:00.000Z",
  approverSignedAt: null,
  submittedAmounts: {
    currentEffectiveAmount: 100000,
    invoicedAmount: 10000,
    pendingAmount: 20000,
    remainingAmount: 70000,
  },
  currentAmounts: {
    currentEffectiveAmount: 100000,
    invoicedAmount: 10000,
    pendingAmount: 20000,
    remainingAmount: 70000,
  },
  allocatedInvoiceAmount: 0,
  materials: [
    {
      id: "material-1",
      fileName: "三联单.xlsx",
      fileSize: 100,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      requiresSeal: true,
      hasOtherExpenseSheet: true,
      createdAt: "2026-08-19T09:00:00.000Z",
    },
  ],
  auditLogs: [],
  createdAt: "2026-08-19T09:00:00.000Z",
  updatedAt: "2026-08-19T10:00:00.000Z",
};

describe("开票申请前端 API 适配", () => {
  beforeEach(() => jest.clearAllMocks());

  it("显式归一化合同资格及历史开票信息", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          eligible: true,
          reasonCode: null,
          reason: null,
          contract: {
            id: "contract-1",
            title: "示例收入合同",
            contractNo: "HT-001",
            category: "main_business",
            area: "海淀区",
            partyA: "客户公司",
            status: "effective",
          },
          amounts: {
            currentEffectiveAmount: 100000,
            invoicedAmount: 10000,
            pendingAmount: 20000,
            remainingAmount: 70000,
          },
          billingPrefill: {
            name: "客户公司",
            taxNumber: "91110000123456789X",
            address: "北京市",
            phone: "010-12345678",
            bankName: "示例银行",
            bankAccount: "123456",
            remark: "历史信息",
            sourceApplicationId: "old-application",
          },
        },
      },
    });

    const result = await getInvoiceApplicationEligibility("contract-1");
    expect(api.get).toHaveBeenCalledWith(
      "/api/invoice-applications/eligibility",
      { params: { contractId: "contract-1" } },
    );
    expect(result.amounts.remainingAmount).toBe(70000);
    expect(result.billingPrefill).toMatchObject({
      taxNumber: "91110000123456789X",
      sourceApplicationId: "old-application",
    });
  });

  it("归一化申请编号、额度快照、材料盖章标记和签字时间", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: { items: [application], total: 1 } },
    });

    const result = await getInvoiceApplications({
      scope: "approval",
      page: 1,
      pageSize: 10,
    });
    expect(result.items[0]).toMatchObject({
      applicationNo: "KP-202608-0001",
      applicantSignedAt: "2026-08-19T10:00:00.000Z",
      applicant: { department: "项目部", position: "报批报建专员" },
      allocatedInvoiceAmount: 0,
      materials: [{ id: "material-1", requiresSeal: true }],
      submittedAmounts: { remainingAmount: 70000 },
    });
  });

  it("员工历史申请查询向服务端传递视图和分页参数", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: { items: [], total: 0 } },
    });

    await getInvoiceApplications({
      scope: "mine",
      view: "history",
      page: 2,
      pageSize: 10,
    });

    expect(api.get).toHaveBeenCalledWith("/api/invoice-applications", {
      params: {
        scope: "mine",
        view: "history",
        page: 2,
        pageSize: 10,
      },
    });
  });

  it("总经理审批记录查询传递独立范围和服务端搜索词", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: { items: [], total: 0 } },
    });

    await getInvoiceApplications({
      scope: "manager_processed",
      keyword: "客户公司",
      page: 2,
      pageSize: 10,
    });

    expect(api.get).toHaveBeenCalledWith("/api/invoice-applications", {
      params: {
        scope: "manager_processed",
        keyword: "客户公司",
        page: 2,
        pageSize: 10,
      },
    });
  });

  it("统一归一化各角色合同开票待办数量", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          employee_action_pending: 1,
          manager_pending: 2,
          pending_seal: 3,
          pending_issue: 4,
          pending_finance_registration: 5,
          pending_invoice: 9,
          admin_pending: 12,
          total: 12,
        },
      },
    });

    await expect(getInvoiceApplicationPendingCounts()).resolves.toEqual({
      employeeActionPending: 1,
      managerPending: 2,
      pendingSeal: 3,
      pendingIssue: 4,
      pendingFinanceRegistration: 5,
      pendingInvoice: 9,
      adminPending: 12,
      total: 12,
    });
    expect(api.get).toHaveBeenCalledWith(
      "/api/invoice-applications/pending-counts",
    );
  });

  it("材料上传传递逐文件盖章分组且管理员使用专用打印地址", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: application },
    });
    const file = new File(["test"], "三联单.xlsx");
    await uploadInvoiceApplicationMaterials(
      "invoice-application-1",
      [file],
      true,
    );
    const [, formData] = (api.post as jest.Mock).mock.calls[0];
    expect(formData).toBeInstanceOf(FormData);
    expect((formData as FormData).get("requiresSeal")).toBe("true");
    expect(getInvoiceApplicationMaterialPrintUrl("a", "m")).toBe(
      "/api/invoice-applications/a/materials/m/print",
    );
  });

  it("主营三联单上传前检查按分返回本次付款金额", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          paymentAmountCents: 7_600_000,
          sourceSheet: "其他费用",
          headerCell: "D4",
          totalCell: "D29",
          detailRange: "D5:D28",
          fileName: "三联单.xlsx",
        },
      },
    });
    const file = new File(["test"], "三联单.xlsx");
    await expect(inspectMainTriplicate("contract-1", file)).resolves.toEqual({
      paymentAmountCents: 7_600_000,
      sourceSheet: "其他费用",
      headerCell: "D4",
      totalCell: "D29",
      detailRange: "D5:D28",
      fileName: "三联单.xlsx",
    });
    const [url, formData] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe("/api/invoice-applications/triplicate-inspection");
    expect((formData as FormData).get("contractId")).toBe("contract-1");
    expect((formData as FormData).get("file")).toBe(file);
  });

  it("申请单预览自动使用单签或双签文件且登记已开具不人工完成申请", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: { ...application, status: "pending_invoice" },
      },
    });
    await markInvoiceApplicationIssued("invoice-application-1", "已开具", 2);
    expect(api.post).toHaveBeenCalledWith(
      "/api/invoice-applications/invoice-application-1/mark-issued",
      { note: "已开具", expectedVersion: 2 },
    );
    expect(getInvoiceApplicationPreviewUrl("invoice-application-1")).toBe(
      "/api/invoice-applications/invoice-application-1/application-preview",
    );
  });
});
