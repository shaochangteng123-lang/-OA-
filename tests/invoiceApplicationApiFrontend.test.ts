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
  deleteInvoiceApplicationDraft,
  getInvoiceApplicationEligibility,
  getInvoiceApplication,
  getInvoiceApplicationFinancialProgress,
  getInvoiceApplicationMaterialPrintUrl,
  getInvoiceApplicationPendingCounts,
  getInvoiceReceiptTask,
  getInvoiceReceiptTasks,
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
  deliveryHandler: {
    id: "admin-a",
    name: "管理员甲",
    processedAt: "2026-08-20T09:00:00.000Z",
    note: "已交付",
  },
  invoiceHandler: {
    id: "admin-b",
    name: "管理员乙",
    processedAt: "2026-08-21T09:00:00.000Z",
    note: "已开具",
  },
  adminProcessing: {
    delivered: true,
    issued: false,
    processedAt: "2026-08-20T09:00:00.000Z",
  },
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

  it.each([true, false])(
    "保留服务端三联单要求，不按主营分类重新推断：%s",
    async (requiresTriplicate) => {
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            eligible: true,
            contract: {
              id: "contract-1",
              category: "main_business",
              requiresTriplicate,
            },
          },
        },
      });
      const eligibility = await getInvoiceApplicationEligibility("contract-1");
      expect(eligibility.contract?.requiresTriplicate).toBe(requiresTriplicate);
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: { success: true, data: { ...application, requiresTriplicate } },
      });
      const detail = await getInvoiceApplication(application.id);
      expect(detail.requiresTriplicate).toBe(requiresTriplicate);
    },
  );

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
      deliveryHandler: { id: "admin-a", name: "管理员甲" },
      invoiceHandler: { id: "admin-b", name: "管理员乙" },
      adminProcessing: {
        delivered: true,
        issued: false,
        processedAt: "2026-08-20T09:00:00.000Z",
      },
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

  it("员工删除开票草稿时传递申请版本", async () => {
    (api.delete as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: { id: "invoice-application-1", deleted: true },
      },
    });

    await deleteInvoiceApplicationDraft("invoice-application-1", 3);

    expect(api.delete).toHaveBeenCalledWith(
      "/api/invoice-applications/invoice-application-1",
      { params: { expectedVersion: 3 } },
    );
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

  it.each(["admin_pending", "admin_processed"] as const)(
    "管理员列表查询传递独立范围和服务端搜索词：%s",
    async (scope) => {
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: { success: true, data: { items: [], total: 0 } },
      });

      await getInvoiceApplications({
        scope,
        keyword: "客户公司",
        page: 2,
        pageSize: 10,
      });

      expect(api.get).toHaveBeenCalledWith("/api/invoice-applications", {
        params: {
          scope,
          keyword: "客户公司",
          page: 2,
          pageSize: 10,
        },
      });
    },
  );

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
          pending_receipt: 2,
          admin_pending: 14,
          total: 15,
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
      pendingReceipt: 2,
      adminPending: 14,
      total: 15,
    });
    expect(api.get).toHaveBeenCalledWith(
      "/api/invoice-applications/pending-counts",
    );
  });

  it("归一化待上传回单列表和开票财务进度", async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            registrationId: "registration-1",
            contractId: "contract-1",
            pendingReceiptAmount: 70,
            receiptStatus: "partial",
            invoices: [],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            items: [
              {
                registration_id: "registration-1",
                contract_id: "contract-1",
                contract_no: "HT-001",
                business_contract_no: "YW-001",
                contract_title: "测试合同",
                project_name: "测试项目",
                party_a: "甲方公司",
                area: "海淀区",
                application_count: 1,
                application_numbers: ["KP-001"],
                invoice_count: 1,
                invoice_amount: "100",
                matched_receipt_amount: "30",
                pending_receipt_amount: "70",
                earliest_invoice_date: "2026-09-01",
                waiting_days: 14,
                receipt_status: "partial",
                invoices: [
                  {
                    id: "invoice-1",
                    invoice_no: "FP-001",
                    invoice_date: "2026-09-01",
                    amount: "100",
                    application_amount: "100",
                    matched_receipt_amount: "30",
                    pending_receipt_amount: "70",
                    item_name: "咨询服务",
                  },
                ],
              },
            ],
            total: 1,
            page: 1,
            page_size: 10,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "application-1",
            contract_id: "contract-1",
            status: "completed",
            application_amount: "100",
            allocated_invoice_amount: "100",
            invoice_completed: true,
            requires_receipt_upload: true,
            pending_receipt_amount: "70",
            registration_id: "registration-1",
          },
        },
      });

    await expect(
      getInvoiceReceiptTask("registration-1"),
    ).resolves.toMatchObject({
      registrationId: "registration-1",
      pendingReceiptAmount: 70,
      receiptStatus: "partial",
    });
    await expect(
      getInvoiceReceiptTasks({ page: 1, pageSize: 10, keyword: "FP-001" }),
    ).resolves.toMatchObject({
      total: 1,
      items: [
        {
          registrationId: "registration-1",
          pendingReceiptAmount: 70,
          receiptStatus: "partial",
          invoices: [
            {
              invoiceNo: "FP-001",
              applicationAmount: 100,
              matchedReceiptAmount: 30,
              pendingReceiptAmount: 70,
            },
          ],
        },
      ],
    });
    await expect(
      getInvoiceApplicationFinancialProgress("application-1"),
    ).resolves.toMatchObject({
      contractId: "contract-1",
      invoiceCompleted: true,
      requiresReceiptUpload: true,
      pendingReceiptAmount: 70,
      registrationId: "registration-1",
    });
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
