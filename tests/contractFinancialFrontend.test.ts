jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock("@/components/contracts/ContractApprovalWorkspace.vue", () => ({
  __esModule: true,
  default: { name: "ContractApprovalWorkspace" },
}));

import fs from "fs";
import path from "path";
import { api } from "@/utils/api";
import ContractFinancialRegistrationPanel from "@/components/contracts/ContractFinancialRegistrationPanel.vue";
import ContractDetail from "@/views/ContractDetail.vue";
import {
  confirmContractFinancialRegistration,
  confirmContractRecord,
  createContractExternalPaymentRegistration,
  createContractFinancialRegistration,
  deleteContractFinancialRegistration,
  deleteContractRecordDraft,
  getContract,
  getContractErrorCode,
  getPendingContractFinancialOcrUploads,
  recognizeContractFinancialFile,
  retryContractFinancialOcrUpload,
  reverseContractFinancialRegistration,
} from "@/utils/contractApi";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const interactiveUploadStub = {
  name: "InteractiveUploadStub",
  props: {
    disabled: Boolean,
    onChange: Function,
  },
  methods: {
    clearFiles() {},
    select(file: File) {
      return (
        this as unknown as { onChange?: (value: unknown) => unknown }
      ).onChange?.({ raw: file });
    },
  },
  template:
    '<div class="upload-stub" :data-disabled="String(disabled)"><slot /></div>',
};

describe("合同财务双凭证登记前端闭环", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:contract-financial-test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
  });

  it("合同详情单文件组件可以正常编译", () => {
    expect(ContractDetail).toBeTruthy();
  });

  it("规范化财务记录状态并保留发票及收付款主体字段", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          contract: {
            id: "contract-1",
            status: "executing",
            relation_type: "main",
            contract_company_subject_name: "北京羽隶设计有限公司",
          },
          invoices: [
            {
              id: "invoice-1",
              status: "active",
              amount: "100.00",
              invoice_no: "FP-001",
              invoice_item_name: "技术服务",
              tax_amount: "11.72",
              seller: "销方公司",
              buyer: "买方公司",
              financial_ocr_status: "consumed",
              financial_validation_status: "verified",
              financial_direction: "output",
              financial_document_status: "normal",
              financial_can_auto_post: true,
            },
          ],
          receipts: [
            {
              id: "receipt-1",
              status: "draft",
              amount: "50.00",
              proof_no: "LS-001",
              electronic_receipt_no: "HD-001",
              payment_time: "2026-08-12 09:30:45",
              payer: "付款方",
              payee: "收款方",
              financial_registration_id: "registration-1",
            },
          ],
          payments: [{ id: "payment-1", status: "reversed", amount: "20.00" }],
        },
      },
    });

    const detail = await getContract("contract-1");

    expect(detail.contract.contractCompanySubjectName).toBe(
      "北京羽隶设计有限公司",
    );

    expect(detail.invoices[0]).toMatchObject({
      status: "confirmed",
      invoiceNo: "FP-001",
      itemName: "技术服务",
      taxAmount: "11.72",
      seller: "销方公司",
      buyer: "买方公司",
      financialOcrStatus: "consumed",
      financialValidationStatus: "verified",
      financialDirection: "output",
      financialDocumentStatus: "normal",
      financialCanAutoPost: true,
    });
    expect(detail.receipts[0]).toMatchObject({
      status: "draft",
      bankReference: "LS-001",
      electronicReceiptNo: "HD-001",
      paymentTime: "2026-08-12 09:30:45",
      payer: "付款方",
      payee: "收款方",
      financialRegistrationId: "registration-1",
    });
    expect(detail.payments[0]).toMatchObject({
      status: "reversed",
      reversed: true,
    });
  });

  it("分别识别发票和银行回单后只提交两个服务端识别任务编号", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: { id: "invoice-job-1", canCreateDraft: true },
      },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: { id: "bank-job-1", canCreateDraft: true },
      },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          registrationId: "registration-1",
          invoiceRecordId: "invoice-1",
          settlementRecordId: "receipt-1",
          status: "draft",
        },
      },
    });
    const invoiceFile = new File(["invoice"], "invoice.pdf", {
      type: "application/pdf",
    });
    const bankFile = new File(["bank"], "receipt.pdf", {
      type: "application/pdf",
    });

    await recognizeContractFinancialFile("contract-1", "invoice", invoiceFile);
    await recognizeContractFinancialFile("contract-1", "receipt", bankFile);
    await createContractFinancialRegistration("contract-1", {
      invoiceOcrJobIds: ["invoice-job-1", "invoice-job-2"],
      bankOcrJobIds: ["bank-job-1"],
      note: "双凭证登记",
    });

    const invoiceRecognitionData = (api.post as jest.Mock).mock
      .calls[0][1] as FormData;
    expect(invoiceRecognitionData.get("kind")).toBe("invoice");
    expect(invoiceRecognitionData.get("file")).toBe(invoiceFile);
    const bankRecognitionData = (api.post as jest.Mock).mock
      .calls[1][1] as FormData;
    expect(bankRecognitionData.get("kind")).toBe("receipt");
    expect(bankRecognitionData.get("file")).toBe(bankFile);
    expect(api.post).toHaveBeenNthCalledWith(
      3,
      "/api/contracts/contract-1/financial-registrations",
      {
        invoiceOcrJobIds: ["invoice-job-1", "invoice-job-2"],
        bankOcrJobIds: ["bank-job-1"],
        note: "双凭证登记",
      },
      { timeout: 120_000 },
    );
  });

  it("恢复已识别但尚未登记的财务凭证", async () => {
    const pendingJobs = [
      { id: "invoice-job-pending", recordKind: "invoice" },
      { id: "receipt-job-pending", recordKind: "receipt" },
    ];
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: pendingJobs },
    });

    await expect(
      getPendingContractFinancialOcrUploads("contract-pending"),
    ).resolves.toEqual(pendingJobs);
    expect(api.get).toHaveBeenCalledWith(
      "/api/contracts/contract-pending/financial-ocr/pending",
    );
  });

  it("旧版待登记凭证重试接口使用空请求体并返回更新结果", async () => {
    const refreshed = {
      id: "bank-job-stale",
      requiresRefresh: false,
      parserVersion: "contract-bank-receipt-parser-v11",
    };
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: refreshed },
    });

    await expect(
      retryContractFinancialOcrUpload("contract-stale", "bank-job-stale"),
    ).resolves.toEqual(refreshed);
    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/contract-stale/financial-ocr/bank-job-stale/retry",
      {},
      { timeout: 180_000 },
    );
  });

  it("面板顺序刷新旧版待登记任务并以新结果恢复凭证", async () => {
    const staleJobs = [
      {
        id: "invoice-job-stale",
        contractId: "contract-stale-panel",
        fileId: "invoice-file-stale",
        recordKind: "invoice",
        status: "blocked",
        validationStatus: "blocked",
        recognitionMethod: "paddle_ocr",
        engineVersion: "old-engine",
        parserVersion: "old-invoice-parser",
        requiresRefresh: true,
        evidenceTextHash: null,
        direction: "unknown",
        expectedDirection: "input",
        documentStatus: "normal",
        canCreateDraft: false,
        diagnosticScore: 90,
        snapshot: { format: "pdf", fields: {} },
        blockingReasons: [{ code: "OLD_INVOICE", message: "旧版发票结果" }],
        warnings: [],
      },
      {
        id: "bank-job-stale",
        contractId: "contract-stale-panel",
        fileId: "bank-file-stale",
        recordKind: "payment",
        status: "blocked",
        validationStatus: "blocked",
        recognitionMethod: "paddle_ocr",
        engineVersion: "v6_medium",
        parserVersion: "old-bank-parser",
        requiresRefresh: true,
        evidenceTextHash: null,
        direction: "unknown",
        expectedDirection: "payment",
        documentStatus: "normal",
        canCreateDraft: false,
        diagnosticScore: 90,
        snapshot: { format: "png", fields: {} },
        blockingReasons: [{ code: "OLD_BANK", message: "旧版回单结果" }],
        warnings: [],
      },
    ];
    const refreshedById = new Map(
      staleJobs.map((job) => [
        job.id,
        {
          ...job,
          status: "verified",
          validationStatus: "verified",
          requiresRefresh: false,
          canCreateDraft: true,
          blockingReasons: [],
        },
      ]),
    );
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: staleJobs },
    });
    let activeRetries = 0;
    let maximumActiveRetries = 0;
    (api.post as jest.Mock).mockImplementation(
      async (url: string, payload: unknown) => {
        activeRetries += 1;
        maximumActiveRetries = Math.max(maximumActiveRetries, activeRetries);
        await Promise.resolve();
        activeRetries -= 1;
        const jobId = url.split("/").at(-2) || "";
        return {
          data: {
            success: true,
            data: { ...refreshedById.get(jobId), retryPayload: payload },
          },
        };
      },
    );

    const wrapper = mount(ContractFinancialRegistrationPanel, {
      props: {
        contractId: "contract-stale-panel",
        category: "asset",
        assetFundingMode: "technology_direct",
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: { template: "<button><slot /></button>" },
          ElForm: true,
          ElFormItem: true,
          ElIcon: true,
          ElInput: true,
          ElOption: true,
          ElSelect: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: interactiveUploadStub,
        },
      },
    });
    await flushPromises();

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/api/contracts/contract-stale-panel/financial-ocr/invoice-job-stale/retry",
      {},
      { timeout: 180_000 },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/api/contracts/contract-stale-panel/financial-ocr/bank-job-stale/retry",
      {},
      { timeout: 180_000 },
    );
    expect(maximumActiveRetries).toBe(1);
    expect(wrapper.text()).not.toContain("旧版发票结果");
    expect(wrapper.text()).not.toContain("旧版回单结果");
    wrapper.unmount();
  });

  it("旧版任务自动刷新失败时保留原任务并且同一面板不循环重试", async () => {
    const staleJob = {
      id: "bank-job-refresh-failed",
      contractId: "contract-refresh-failed",
      fileId: "bank-file-refresh-failed",
      recordKind: "payment",
      status: "blocked",
      validationStatus: "blocked",
      recognitionMethod: "paddle_ocr",
      engineVersion: "v6_medium",
      parserVersion: "old-bank-parser",
      requiresRefresh: true,
      evidenceTextHash: null,
      direction: "unknown",
      expectedDirection: "payment",
      documentStatus: "normal",
      canCreateDraft: false,
      diagnosticScore: 90,
      snapshot: { format: "png", fields: {} },
      blockingReasons: [{ code: "OLD_BANK", message: "原识别任务仍待核对" }],
      warnings: [],
    };
    (api.get as jest.Mock).mockResolvedValue({
      data: { success: true, data: [staleJob] },
    });
    (api.post as jest.Mock).mockRejectedValueOnce(new Error("识别服务繁忙"));

    const wrapper = mount(ContractFinancialRegistrationPanel, {
      props: {
        contractId: "contract-refresh-failed",
        category: "asset",
        assetFundingMode: "technology_direct",
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: { template: "<button><slot /></button>" },
          ElForm: true,
          ElFormItem: true,
          ElIcon: true,
          ElInput: true,
          ElOption: true,
          ElSelect: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: interactiveUploadStub,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain(
      "付款回单旧版识别结果自动更新失败，已保留原任务：识别服务繁忙",
    );
    expect(api.post).toHaveBeenCalledTimes(1);

    await (
      wrapper.vm as unknown as { reloadPendingUploads: () => Promise<void> }
    ).reloadPendingUploads();
    await flushPromises();
    expect(api.post).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("没有发票时可先保存签约主体对外付款登记", async () => {
    const result = {
      registrationId: "registration-external-first",
      invoiceRecordIds: [],
      settlementRecordIds: ["external-payment-1"],
      invoiceRecordId: null,
      settlementRecordId: "external-payment-1",
      matches: [],
      status: "draft",
    };
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: result },
    });

    await expect(
      createContractExternalPaymentRegistration("contract-external-first", {
        bankOcrJobIds: ["external-job-1"],
      }),
    ).resolves.toEqual(result);
    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/contract-external-first/financial-registrations/external-payments",
      { bankOcrJobIds: ["external-job-1"] },
    );
  });

  it.each([
    {
      title: "全新登记",
      registrationId: undefined,
      buttonLabel: "先保存北京羽隶设计有限公司对外付款",
      expectedUrl:
        "/api/contracts/contract-external-component/financial-registrations/external-payments",
      expectedConfig: undefined,
    },
    {
      title: "已有登记",
      registrationId: "registration-external-existing",
      buttonLabel: "保存北京羽隶设计有限公司最终对外付款",
      expectedUrl:
        "/api/contracts/contract-external-component/financial-registrations/registration-external-existing/external-payments",
      expectedConfig: { timeout: 120_000 },
    },
  ])(
    "自动刷新后的单独签约主体对外付款在$title时走专用接口",
    async ({ registrationId, buttonLabel, expectedUrl, expectedConfig }) => {
      const staleResult = {
        id: "external-job-refreshed",
        contractId: "contract-external-component",
        fileId: "external-file-refreshed",
        recordKind: "payment",
        status: "blocked",
        validationStatus: "blocked",
        recognitionMethod: "paddle_ocr",
        engineVersion: "v6_medium",
        parserVersion: "old-bank-parser",
        requiresRefresh: true,
        evidenceTextHash: null,
        direction: "unknown",
        expectedDirection: "payment",
        documentStatus: "normal",
        canCreateDraft: false,
        diagnosticScore: 90,
        snapshot: { format: "png", fields: {} },
        blockingReasons: [{ code: "OLD_BANK", message: "旧版结果" }],
        warnings: [],
      };
      const refreshedResult = {
        ...staleResult,
        status: "verified",
        validationStatus: "verified",
        parserVersion: "contract-bank-receipt-parser-v11",
        requiresRefresh: false,
        direction: "payment",
        canCreateDraft: true,
        blockingReasons: [],
        snapshot: {
          format: "png",
          fields: {
            payer: "北京羽隶设计有限公司",
            payerAccount: "110933697910902",
            payee: "合同对方有限公司",
            payeeAccount: "11001053000056004126",
            electronicReceiptNo: "EXTERNAL-ONLY-001",
            paymentTime: "2026-04-30",
            amount: 195.3,
          },
        },
      };
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: { success: true, data: [staleResult] },
      });
      (api.post as jest.Mock)
        .mockResolvedValueOnce({
          data: { success: true, data: refreshedResult },
        })
        .mockResolvedValueOnce({
          data: {
            success: true,
            data: {
              registrationId: registrationId || "registration-external-created",
              invoiceRecordIds: [],
              settlementRecordIds: ["external-payment-created"],
              invoiceRecordId: null,
              settlementRecordId: "external-payment-created",
              matches: [],
              status: "draft",
            },
          },
        });

      const wrapper = mount(ContractFinancialRegistrationPanel, {
        props: {
          contractId: "contract-external-component",
          category: "asset",
          assetFundingMode: "engineering_to_technology",
          contractCompanySubject: "北京羽隶设计有限公司",
          contractCounterparty: "合同对方有限公司",
          registrationId,
          registeredInvoices: [],
          registeredBankDocuments: [],
          registeredExternalPayments: [],
        },
        global: {
          stubs: {
            ElAlert: {
              props: ["title", "description"],
              template: "<div>{{ title }}{{ description }}<slot /></div>",
            },
            ElButton: {
              props: ["disabled", "loading"],
              emits: ["click"],
              template:
                '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
            },
            ElForm: true,
            ElFormItem: true,
            ElIcon: true,
            ElInput: true,
            ElOption: true,
            ElSelect: true,
            ElTable: true,
            ElTableColumn: true,
            ElTag: { template: "<span><slot /></span>" },
            ElUpload: interactiveUploadStub,
          },
        },
      });
      await flushPromises();

      expect(wrapper.text()).toContain(
        "北京羽隶设计有限公司对外付款可先保存，发票可后补；工程划拨回单按实际发生另行上传",
      );
      expect(wrapper.text()).toContain("工程咨询→北京羽隶设计有限公司划拨回单");
      expect(wrapper.text()).toContain("北京羽隶设计有限公司→合同对方付款回单");
      expect(wrapper.text()).not.toContain("科技");
      const submitButton = wrapper
        .findAll("button")
        .find((button) => button.text().includes(buttonLabel));
      expect(submitButton).toBeTruthy();
      expect(submitButton!.attributes("disabled")).toBeUndefined();
      await submitButton!.trigger("click");
      await flushPromises();

      const saveCall = (api.post as jest.Mock).mock.calls[1];
      expect(saveCall[0]).toBe(expectedUrl);
      expect(saveCall[1]).toEqual({
        bankOcrJobIds: ["external-job-refreshed"],
        note: undefined,
      });
      if (expectedConfig) expect(saveCall[2]).toEqual(expectedConfig);
      else expect(saveCall).toHaveLength(2);
      expect(
        (api.post as jest.Mock).mock.calls.some(
          ([url]) =>
            url ===
            "/api/contracts/contract-external-component/financial-registrations",
        ),
      ).toBe(false);
      wrapper.unmount();
    },
  );

  it("内部划拨金额对应预览使用签约主体最终对外付款而不是划拨回单", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: [] },
    });
    (api.post as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "invoice-job-design",
            contractId: "contract-design-allocation-preview",
            fileId: "invoice-file-design",
            recordKind: "invoice",
            direction: "input",
            canCreateDraft: true,
            blockingReasons: [],
            snapshot: {
              format: "pdf",
              fields: {
                buyer: "北京羽隶设计有限公司",
                seller: "合同对方有限公司",
                invoiceNumber: "INVOICE-DESIGN-001",
                invoiceDate: "2026-08-27",
                itemName: "设计服务",
                amount: 100,
                taxAmount: 0,
                lineItems: [],
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "allocation-job-design",
            contractId: "contract-design-allocation-preview",
            fileId: "allocation-file-design",
            recordKind: "payment",
            direction: "payment",
            canCreateDraft: true,
            blockingReasons: [],
            snapshot: {
              format: "pdf",
              fields: {
                payer: "北京羽隶工程咨询有限公司",
                payerAccount: "110000000001",
                payee: "北京羽隶设计有限公司",
                payeeAccount: "110000000002",
                electronicReceiptNo: "ALLOCATION-DESIGN-060",
                paymentTime: "2026-08-27",
                amount: 60,
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "external-job-design",
            contractId: "contract-design-allocation-preview",
            fileId: "external-file-design",
            recordKind: "payment",
            direction: "payment",
            canCreateDraft: true,
            blockingReasons: [],
            snapshot: {
              format: "pdf",
              fields: {
                payer: "北京羽隶设计有限公司",
                payerAccount: "110000000002",
                payee: "合同对方有限公司",
                payeeAccount: "110000000003",
                electronicReceiptNo: "FINAL-DESIGN-100",
                paymentTime: "2026-08-27",
                amount: 100,
              },
            },
          },
        },
      });

    const wrapper = mount(ContractFinancialRegistrationPanel, {
      props: {
        contractId: "contract-design-allocation-preview",
        category: "asset",
        assetFundingMode: "engineering_to_technology",
        contractCompanySubject: "北京羽隶设计有限公司",
        contractCounterparty: "合同对方有限公司",
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: {
            props: ["disabled", "loading"],
            emits: ["click"],
            template:
              '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
          },
          ElForm: true,
          ElFormItem: true,
          ElIcon: true,
          ElInput: true,
          ElOption: true,
          ElSelect: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: interactiveUploadStub,
        },
      },
    });
    await flushPromises();

    const uploads = wrapper.findAllComponents(interactiveUploadStub);
    expect(uploads).toHaveLength(3);
    const uploadFiles = [
      new File(["invoice"], "invoice-design.pdf", {
        type: "application/pdf",
      }),
      new File(["allocation"], "allocation-design.pdf", {
        type: "application/pdf",
      }),
      new File(["external"], "external-design.pdf", {
        type: "application/pdf",
      }),
    ];
    for (const [index, file] of uploadFiles.entries()) {
      await (
        uploads[index]!.vm as unknown as {
          select: (selectedFile: File) => Promise<void>;
        }
      ).select(file);
      await flushPromises();
    }

    const preview = wrapper.find(".allocation-preview");
    expect(preview.exists()).toBe(true);
    const previewText = preview.text();
    expect(previewText).toContain("北京羽隶设计有限公司→合同对方付款回单");
    expect(previewText).toContain("FINAL-DESIGN-100");
    expect(previewText).toContain("¥100.00");
    expect(previewText).not.toContain("ALLOCATION-DESIGN-060");
    expect(wrapper.text()).not.toContain("科技");
    wrapper.unmount();
  });

  it("已有外付登记自动刷新补充发票后只调用登记追加接口", async () => {
    const staleInvoice = {
      id: "invoice-job-after-external",
      contractId: "contract-invoice-after-external",
      fileId: "invoice-file-after-external",
      recordKind: "invoice",
      status: "blocked",
      validationStatus: "blocked",
      recognitionMethod: "paddle_ocr",
      engineVersion: "old-engine",
      parserVersion: "old-invoice-parser",
      requiresRefresh: true,
      evidenceTextHash: null,
      direction: "unknown",
      expectedDirection: "input",
      documentStatus: "normal",
      canCreateDraft: false,
      diagnosticScore: 90,
      snapshot: { format: "pdf", fields: {} },
      blockingReasons: [{ code: "OLD_INVOICE", message: "旧版发票结果" }],
      warnings: [],
    };
    const refreshedInvoice = {
      ...staleInvoice,
      status: "verified",
      validationStatus: "verified",
      engineVersion: "structured-fast-or-dual-channel-runtime",
      parserVersion: "contract-invoice-parser-v11",
      requiresRefresh: false,
      direction: "input",
      canCreateDraft: true,
      blockingReasons: [],
      snapshot: {
        format: "pdf",
        fields: {
          invoiceNumber: "INVOICE-AFTER-EXTERNAL-001",
          invoiceDate: "2026-04-30",
          itemName: "电费及系统维护费",
          amount: 195.3,
          taxAmount: 0,
          seller: "合同对方有限公司",
          buyer: "北京羽隶设计有限公司",
          lineItems: [],
        },
      },
    };
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: [staleInvoice] },
    });
    (api.post as jest.Mock)
      .mockResolvedValueOnce({
        data: { success: true, data: refreshedInvoice },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            registrationId: "registration-external-saved",
            invoiceRecordIds: ["invoice-record-added"],
            settlementRecordIds: ["external-payment-saved"],
            invoiceRecordId: "invoice-record-added",
            settlementRecordId: "external-payment-saved",
            matches: [],
            status: "draft",
          },
        },
      });

    const wrapper = mount(ContractFinancialRegistrationPanel, {
      props: {
        contractId: "contract-invoice-after-external",
        category: "asset",
        assetFundingMode: "engineering_to_technology",
        contractCompanySubject: "北京羽隶设计有限公司",
        contractCounterparty: "合同对方有限公司",
        registrationId: "registration-external-saved",
        registrationFinancialDirection: "cost",
        registeredInvoices: [],
        registeredBankDocuments: [],
        registeredExternalPayments: [
          {
            id: "external-payment-saved",
            label: "已保存签约主体对外付款",
            amount: 195.3,
          },
        ],
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: {
            props: ["disabled", "loading"],
            emits: ["click"],
            template:
              '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
          },
          ElForm: true,
          ElFormItem: true,
          ElIcon: true,
          ElInput: true,
          ElOption: true,
          ElSelect: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: interactiveUploadStub,
        },
      },
    });
    await flushPromises();

    const submitButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("保存补充发票"));
    expect(submitButton).toBeTruthy();
    expect(submitButton!.attributes("disabled")).toBeUndefined();
    await submitButton!.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/api/contracts/contract-invoice-after-external/financial-registrations/registration-external-saved/settlements",
      {
        invoiceOcrJobIds: ["invoice-job-after-external"],
        bankOcrJobIds: [],
        note: undefined,
      },
      { timeout: 120_000 },
    );
    expect(
      (api.post as jest.Mock).mock.calls.some(
        ([url]) =>
          url ===
            "/api/contracts/contract-invoice-after-external/financial-registrations" ||
          url.endsWith("/external-payments"),
      ),
    ).toBe(false);
    wrapper.unmount();
  });

  it("确认、删除和冲正使用整组登记接口，旧单条接口仍兼容历史记录", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: {} },
    });
    (api.delete as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: {} },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: {} },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: {} },
    });
    (api.delete as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: {} },
    });

    await confirmContractFinancialRegistration("contract-1", "registration-1");
    await deleteContractFinancialRegistration("contract-1", "registration-2");
    await reverseContractFinancialRegistration(
      "contract-1",
      "registration-3",
      "银行退回",
    );
    await confirmContractRecord("contract-1", "receipts", "receipt-1");
    await deleteContractRecordDraft("contract-1", "receipts", "receipt-2");

    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/contract-1/financial-registrations/registration-1/confirm",
    );
    expect(api.delete).toHaveBeenCalledWith(
      "/api/contracts/contract-1/financial-registrations/registration-2",
    );
    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/contract-1/financial-registrations/registration-3/reverse",
      { reason: "银行退回" },
    );
    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/contract-1/receipts/receipt-1/confirm",
    );
    expect(api.delete).toHaveBeenCalledWith(
      "/api/contracts/contract-1/receipts/receipt-2",
    );
    expect(
      getContractErrorCode({
        response: {
          data: { code: "CONTRACT_RECEIPT_DUPLICATE_WARNING" },
        },
      }),
    ).toBe("CONTRACT_RECEIPT_DUPLICATE_WARNING");
  });

  it("财务登记在详情页内嵌多凭证上传槽并支持先票后款", () => {
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    const panelSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractFinancialRegistrationPanel.vue",
      ),
      "utf8",
    );
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );

    expect(detailSource).toContain("<ContractFinancialRegistrationPanel");
    expect(detailSource).toContain(
      "v-if=\"detail.contract.relationType === 'main'\"",
    );
    expect(detailSource).toContain(
      'detail.value.contract.relationType === "main"',
    );
    expect(detailSource).toContain('name="finance"');
    expect(detailSource).toContain(
      "financialRegistrationPanelRef.value?.focus()",
    );
    expect(detailSource).not.toContain("recordDialogVisible");
    expect(panelSource).not.toContain("<el-dialog");
    expect(panelSource).toContain('ref="invoiceUploadRef"');
    expect(panelSource).toContain('ref="bankUploadRef"');
    expect(panelSource).toContain("invoiceCredential");
    expect(panelSource).toContain("bankCredential");
    expect(panelSource).toContain("state.sequence += 1");
    expect(panelSource).toContain("sequence !== state.sequence");
    expect(panelSource).toContain("allInvoiceCredentials");
    expect(panelSource).toContain("allBankCredentials");
    expect(panelSource).toContain("invoiceOcrJobIds:");
    expect(panelSource).toContain("bankOcrJobIds:");
    expect(panelSource).toContain("partialSettlement");
    expect(panelSource).toContain("settlementOverAmount");
    expect(panelSource).toContain("remainingSettlementAmount");
    expect(panelSource).toContain("canSaveRegistrationDraft");
    expect(panelSource).toContain("发票合计");
    expect(panelSource).toContain("工程咨询划拨累计");
    expect(panelSource).toContain("对外付款需发票覆盖累计");
    expect(panelSource).toContain("`${bankDocumentLabel}合计`");
    expect(panelSource).toContain("savesOnlyInternalFunding");
    expect(panelSource).toContain("保存工程咨询划拨回单");
    expect(panelSource).toContain("按真实回单计入工程支出");
    expect(panelSource).toContain("继续添加发票");
    expect(panelSource).toContain("multiple");
    expect(
      panelSource.match(/\n\s+multiple\n/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(panelSource).toContain("支持一次选择多张或分批追加");
    expect(panelSource).toContain("继续添加{{ externalPaymentLabel }}");
    expect(panelSource).toContain("allExternalCredentials.length");
    expect(panelSource).not.toContain(':limit="1"');
    expect(panelSource).toContain("credentialQueues");
    expect(panelSource).toContain("processCredentialFile");
    expect(panelSource).toContain("onMounted(loadPendingFinancialOcrUploads)");
    expect(panelSource).toContain("reloadPendingFinancialOcrUploads");
    expect(panelSource).toContain("reloadPendingUploads:");
    expect(panelSource).toContain(
      'status: canCreateDraft ? "verified" : "blocked"',
    );
    expect(panelSource).toContain("getPendingContractFinancialOcrUploads");
    expect(panelSource).toContain("getContractFileUrl(result.fileId)");
    expect(panelSource).toContain('state.previewUrl.startsWith("blob:")');
    expect(routeSource).toContain(
      'router.get("/:id/financial-ocr/pending", requireFinance',
    );
    expect(routeSource).toMatch(
      /job\.record_id IS NULL[\s\S]*?job\.status IN \('verified', 'blocked'\)[\s\S]*?job\.validation_status IN \('verified', 'blocked'\)[\s\S]*?NOT EXISTS \([\s\S]*?contract_financial_registration_items/,
    );
    expect(routeSource).toContain('job.status === "verified"');
    expect(detailSource).toContain(
      "financialRegistrationPanelRef.value?.reloadPendingUploads()",
    );
    expect(
      routeSource.match(/!incomeReceiptPartiesMatch\(invoice, bank\)/g)?.length,
    ).toBe(2);
    expect(routeSource).not.toContain(
      "发票购销双方与银行回单付款、收款双方不一致",
    );
    expect(panelSource).toContain("settlementActionLabel");
    expect(panelSource).toContain("invoiceBusinessDirection");
    expect(panelSource).toContain("发票购销方向与合同类型不一致，不能登记");
    expect(panelSource).toContain("categoryBusinessDirection");
    expect(panelSource).toContain("invoiceContextReady");
    expect(panelSource).toContain(
      "appendContractFinancialRegistrationSettlements",
    );
    expect(panelSource).toContain("registrationId");
    expect(panelSource).toContain('aria-label="已保存发票明细"');
    expect(panelSource).toContain("registeredBankDocuments");
    expect(panelSource).toContain("registeredBankTotal");
    expect(panelSource).toContain("openRegisteredBankPreview");
    expect(panelSource).toContain("openRegisteredInvoicePreview");
    expect(panelSource).toContain("已保存发票保持只读；仍可在下方继续添加发票");
    expect(panelSource).toContain('@click="clearWorkspace"');
    expect(panelSource).toContain("deleteContractFinancialOcrUpload");
    expect(panelSource).toContain("await removeCredentialByKey");
    expect(panelSource).toContain(':loading="clearing"');
    expect(panelSource).toContain(
      'if (props.registrationId) emit("cancelContinuation")',
    );
    expect(detailSource).toContain("financialRegistrationTargetInvoices");
    expect(detailSource).toMatch(
      /\.metric-grid\s*\{[\s\S]*?grid-auto-columns:\s*minmax\(190px, 1fr\);[\s\S]*?grid-auto-flow:\s*column;[\s\S]*?overflow-x:\s*auto;/,
    );
    expect(detailSource).not.toMatch(
      /@media \(max-width: 1366px\)[\s\S]*?\.metric-grid\s*\{/,
    );
    expect(detailSource).not.toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.metric-grid\s*\{/,
    );
    expect(detailSource).toContain("financialRegistrationTargetBankDocuments");
    expect(detailSource).toContain(
      "getContractFileUrl(document.record.fileId)",
    );
    expect(panelSource).toContain("openCredentialPreview");
    expect(panelSource).toContain('window.open(state.previewUrl, "_blank"');
    expect(panelSource).toContain('label="操作"');
    expect(panelSource).toContain('class="credential-table"');
    expect(panelSource).not.toContain('table-layout="auto"');
    expect(
      panelSource.match(/table-layout="fixed"/g)?.length,
    ).toBeGreaterThanOrEqual(6);
    expect(panelSource).toMatch(
      /\.credential-grid\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?overflow-x:\s*hidden;/,
    );
    expect(panelSource).toMatch(
      /\.funding-bank-card\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*1;/,
    );
    expect(panelSource).toMatch(
      /\.external-card\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*1;/,
    );
    expect(panelSource).toMatch(
      /\.internal-invoice-card\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?grid-row:\s*2;/,
    );
    expect(panelSource).toMatch(
      /\.credential-table-wrap\s*\{[\s\S]*?overflow:\s*hidden;/,
    );
    expect(panelSource).toMatch(
      /\.credential-table :deep\(\.cell\)\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?text-overflow:\s*clip;[\s\S]*?white-space:\s*normal;[\s\S]*?word-break:\s*break-word;/,
    );
    expect(panelSource).not.toContain("width: max-content !important");
    expect(
      panelSource.match(/label="销售方名称"[\s\S]{0,80}?min-width="150"/g)
        ?.length,
    ).toBe(2);
    expect(panelSource).toMatch(
      /td\.invoice-item-name-column \.cell\)\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;[\s\S]*?word-break:\s*break-word;/,
    );
    expect(panelSource).not.toContain("min-width: 1180px");
    expect(panelSource).not.toContain(".el-table__body-wrapper");
    expect(panelSource).not.toContain('fixed="right"');
    expect(
      panelSource.match(/label="操作"[\s\S]{0,80}?width="82"/g)?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      panelSource.match(/label="开票金额"[\s\S]{0,80}?width="105"/g)?.length,
    ).toBe(2);
    expect(panelSource).toMatch(
      /\.credential-table\s*\{[\s\S]*?font-size:\s*12px;/,
    );
    expect(panelSource).toContain(
      "发票共 {{ allInvoiceCredentials.length }} 张",
    );
    expect(panelSource).toContain("{{ allBankCredentials.length }} 张，总金额");
    expect(panelSource).not.toContain(
      "releasePreview(state);\n    const stored",
    );
    expect(panelSource).toContain("@media (max-width: 768px)");
  });

  it("内部划拨累计与签约公司对外付款对应金额保持独立展示", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: [] },
    });
    const wrapper = mount(ContractFinancialRegistrationPanel, {
      props: {
        contractId: "contract-internal-totals",
        category: "asset",
        assetFundingMode: "engineering_to_technology",
        registrationId: "registration-internal-totals",
        registrationFinancialDirection: "cost",
        contractCompanySubject: "北京羽隶科技有限公司",
        registeredInvoices: [
          {
            id: "invoice-internal-totals",
            label: "房租发票",
            amount: 381162.52,
            financialDirection: "input",
          },
        ],
        registeredBankDocuments: [
          {
            id: "engineering-transfer",
            label: "工程划拨回单",
            amount: 81641.84,
            invoiceRequiredAmount: 0,
          },
        ],
        registeredExternalPayments: [
          {
            id: "external-payment",
            label: "签约公司对外付款回单",
            amount: 460656.52,
            invoiceRequiredAmount: 381162.52,
          },
        ],
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: { template: "<button><slot /></button>" },
          ElForm: true,
          ElFormItem: true,
          ElIcon: true,
          ElInput: true,
          ElOption: true,
          ElSelect: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: true,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("工程咨询划拨累计");
    expect(wrapper.text()).toContain("¥81,641.84");
    expect(wrapper.text()).toContain(
      "北京羽隶科技有限公司对外付款需发票覆盖累计",
    );
    expect(wrapper.text()).toContain("¥381,162.52");
    expect(wrapper.text()).not.toContain("¥462,804.36");
    wrapper.unmount();
  });

  it("部分回款草稿展示累计回款与剩余金额并继续开放补充入口", () => {
    const wrapper = mount(ContractFinancialRegistrationPanel, {
      props: {
        contractId: "contract-partial",
        category: "main_business",
        registrationId: "registration-partial",
        registrationFinancialDirection: "income",
        registeredInvoices: [
          {
            id: "invoice-600000",
            label: "发票600000",
            amount: 600000,
            financialDirection: "output",
          },
        ],
        registeredBankDocuments: [
          {
            id: "receipt-220000",
            label: "回单220000",
            amount: 220000,
          },
        ],
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["description"],
            template: "<div>{{ description }}<slot /></div>",
          },
          ElButton: { template: "<button><slot /></button>" },
          ElForm: true,
          ElFormItem: true,
          ElIcon: true,
          ElInput: true,
          ElOption: true,
          ElSelect: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: true,
        },
      },
    });

    expect(wrapper.text()).toContain("待补回款 ¥380,000.00");
    expect(wrapper.text()).toContain("当前累计回款 ¥220,000.00");
    expect(wrapper.text()).toContain("尚待回款 ¥380,000.00");
    expect(wrapper.text()).toContain("请继续上传新的回款回单");
    expect(wrapper.text()).toContain("保存本次部分回款");
    expect(wrapper.text()).toContain("保存后立即计入已回款");

    wrapper.unmount();
  });

  it("收入合同无发票时可保存实际回款并进入待补发票", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: [] },
    });
    (api.post as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "receipt-job-first",
            fileId: "receipt-file-first",
            recordKind: "receipt",
            direction: "receipt",
            canCreateDraft: true,
            blockingReasons: [],
            snapshot: {
              fields: {
                payer: "项目客户",
                payerAccount: "621700001",
                payee: "北京羽隶工程咨询有限公司",
                payeeAccount: "0200303519000018418",
                electronicReceiptNo: "FIRST-RECEIPT-001",
                paymentTime: "2026-07-08",
                amount: 220000,
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            registrationId: "registration-receipt-first",
            invoiceRecordIds: [],
            settlementRecordIds: ["receipt-record-first"],
            invoiceRecordId: null,
            settlementRecordId: "receipt-record-first",
            matches: [],
            status: "draft",
          },
        },
      });

    const wrapper = mount(ContractFinancialRegistrationPanel, {
      props: {
        contractId: "contract-receipt-first",
        category: "main_business",
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: {
            props: ["disabled", "loading"],
            emits: ["click"],
            template:
              '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
          },
          ElForm: true,
          ElFormItem: true,
          ElIcon: true,
          ElInput: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: interactiveUploadStub,
        },
      },
    });
    await flushPromises();

    const uploads = wrapper.findAllComponents(interactiveUploadStub);
    expect(uploads).toHaveLength(2);
    expect(uploads[1]!.attributes("data-disabled")).toBe("false");
    await (
      uploads[1]!.vm as unknown as { select: (file: File) => Promise<void> }
    ).select(
      new File(["receipt"], "receipt-first.pdf", {
        type: "application/pdf",
      }),
    );
    await flushPromises();

    expect(wrapper.text()).toContain("待补发票 ¥220,000.00");
    const saveButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("保存实际回款并标记待补发票"));
    expect(saveButton).toBeTruthy();
    expect(saveButton!.attributes("disabled")).toBeUndefined();
    await saveButton!.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenLastCalledWith(
      "/api/contracts/contract-receipt-first/financial-registrations",
      {
        invoiceOcrJobIds: [],
        bankOcrJobIds: ["receipt-job-first"],
        note: undefined,
      },
      { timeout: 120_000 },
    );
    expect(wrapper.emitted("created")).toHaveLength(1);
    wrapper.unmount();
  });

  it("仅回款的既有登记展示待补发票并继续开放回单上传", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: [] },
    });
    const wrapper = mount(ContractFinancialRegistrationPanel, {
      props: {
        contractId: "contract-receipt-continuation",
        category: "main_business",
        registrationId: "registration-receipt-continuation",
        registrationFinancialDirection: "income",
        registeredInvoices: [],
        registeredBankDocuments: [
          {
            id: "receipt-existing",
            label: "回单一",
            amount: 220000,
          },
        ],
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: { template: "<button><slot /></button>" },
          ElForm: true,
          ElFormItem: true,
          ElIcon: true,
          ElInput: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: interactiveUploadStub,
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("正在补充待补发票登记");
    expect(wrapper.text()).toContain("待补发票 ¥220,000.00");
    expect(wrapper.text()).toContain("可继续添加发票或新的回款回单");
    expect(
      wrapper
        .findAllComponents(interactiveUploadStub)[1]!
        .attributes("data-disabled"),
    ).toBe("false");
    wrapper.unmount();
  });

  it("已有回款时允许分批补发票且回款领先不再视为错误", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: [] },
    });
    (api.post as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "invoice-job-partial",
            fileId: "invoice-file-partial",
            recordKind: "invoice",
            direction: "output",
            canCreateDraft: true,
            blockingReasons: [],
            snapshot: {
              fields: {
                buyer: "项目客户",
                seller: "北京羽隶工程咨询有限公司",
                invoiceNumber: "PARTIAL-INVOICE-001",
                invoiceDate: "2026-08-08",
                itemName: "咨询服务",
                amount: 100000,
                taxAmount: 0,
                lineItems: [],
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            registrationId: "registration-partial-invoice",
            invoiceRecordIds: ["invoice-record-partial"],
            settlementRecordIds: [],
            invoiceRecordId: "invoice-record-partial",
            settlementRecordId: null,
            matches: [],
            status: "draft",
          },
        },
      });

    const wrapper = mount(ContractFinancialRegistrationPanel, {
      props: {
        contractId: "contract-partial-invoice",
        category: "main_business",
        registrationId: "registration-partial-invoice",
        registrationFinancialDirection: "income",
        registeredInvoices: [],
        registeredBankDocuments: [
          {
            id: "receipt-existing-partial",
            label: "已到账回单",
            amount: 220000,
          },
        ],
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: {
            props: ["disabled", "loading"],
            emits: ["click"],
            template:
              '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
          },
          ElForm: true,
          ElFormItem: true,
          ElIcon: true,
          ElInput: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: interactiveUploadStub,
        },
      },
    });
    await flushPromises();

    await (
      wrapper.findAllComponents(interactiveUploadStub)[0]!.vm as unknown as {
        select: (file: File) => Promise<void>;
      }
    ).select(
      new File(["invoice"], "partial-invoice.pdf", {
        type: "application/pdf",
      }),
    );
    await flushPromises();

    expect(wrapper.text()).toContain("待补发票 ¥120,000.00");
    expect(wrapper.text()).not.toContain("回款合计超过发票合计");
    expect(wrapper.text()).not.toContain("可确认整笔配对");
    const saveButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("保存补充发票"));
    expect(saveButton).toBeTruthy();
    expect(saveButton!.attributes("disabled")).toBeUndefined();
    await saveButton!.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenLastCalledWith(
      "/api/contracts/contract-partial-invoice/financial-registrations/registration-partial-invoice/settlements",
      {
        invoiceOcrJobIds: ["invoice-job-partial"],
        bankOcrJobIds: [],
        note: undefined,
      },
      { timeout: 120_000 },
    );
    wrapper.unmount();
  });

  it("合同类型直接决定页面展示回款还是付款凭证", () => {
    const global = {
      stubs: {
        ElAlert: true,
        ElButton: { template: "<button><slot /></button>" },
        ElForm: true,
        ElFormItem: true,
        ElIcon: true,
        ElInput: true,
        ElOption: true,
        ElSelect: true,
        ElTable: true,
        ElTableColumn: true,
        ElTag: { template: "<span><slot /></span>" },
        ElUpload: true,
      },
    };
    const incomeWrapper = mount(ContractFinancialRegistrationPanel, {
      props: { contractId: "income-contract", category: "main_business" },
      global,
    });
    const costWrapper = mount(ContractFinancialRegistrationPanel, {
      props: { contractId: "cost-contract", category: "asset" },
      global,
    });

    expect(incomeWrapper.text()).toContain("回款回单");
    expect(costWrapper.text()).toContain("付款凭证");
    expect(costWrapper.text()).toContain("已付款");

    incomeWrapper.unmount();
    costWrapper.unmount();
  });

  it("银行回单新登记区只展示指定七项识别字段", () => {
    const panelSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractFinancialRegistrationPanel.vue",
      ),
      "utf8",
    );
    const labels = [
      "电子回单号码",
      "付款时间",
      "付款人户名",
      "付款人账号",
      "收款人户名",
      "收款人账号",
      "金额",
    ];
    for (const label of labels) {
      expect(panelSource).toContain(`label="${label}"`);
    }
    expect(panelSource).toContain("formatPaymentDate(");
    for (const removedLabel of [
      "交易流水号",
      "识别银行",
      "识别币种",
      "记账日期",
    ]) {
      expect(panelSource).not.toContain(removedLabel);
    }
    expect(panelSource).toContain("必传 · 选择后自动识别");
    expect(panelSource).not.toContain(
      "使用 PP-OCRv6_medium（第六版中型模型）识别",
    );
    expect(panelSource).not.toContain("Tesseract（开源文字识别）");
    expect(panelSource).toContain("识别完成 · 待核对收付方");
    expect(panelSource).toContain("收付方向需要核对");
    expect(panelSource).toContain("任一已配置公司主体");
    expect(panelSource).toContain("内部主体之间的划拨不计合同收支");
    expect(panelSource).toContain("BANK_BUSINESS_REVIEW_CODES");
    expect(panelSource).not.toContain("待配置公司账号");
    expect(panelSource).not.toContain('blocked: "需重新上传"');
  });

  it("无效发票或回单在字段登记前停止并显示明确提示", () => {
    const panelSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractFinancialRegistrationPanel.vue",
      ),
      "utf8",
    );
    const ocrSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractFinancialOcr.ts"),
      "utf8",
    );
    expect(ocrSource).toContain('"此不是有效发票"');
    expect(ocrSource).toContain('"此不是有效回单"');
    expect(panelSource).toContain("invalidFinancialDocumentMessage");
    expect(panelSource).toContain('"INVOICE_DOCUMENT_TYPE_MISMATCH"');
    expect(panelSource).toContain('"BANK_RECEIPT_DOCUMENT_TYPE_MISMATCH"');
    expect(panelSource).toContain("discardInvalidFinancialDocument");
    expect(panelSource).toContain("deleteContractFinancialOcrUpload");
    expect(panelSource).toContain("ElMessage.error(message)");
    const processingSource = panelSource.slice(
      panelSource.indexOf("async function processCredentialFile"),
      panelSource.indexOf("function openCredentialPreview"),
    );
    expect(processingSource.indexOf("invalidDocumentMessage")).toBeLessThan(
      processingSource.indexOf('if (kind === "invoice")'),
    );
  });

  it("发票新登记表格展示六项字段并完整展示发票号码", () => {
    const panelSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractFinancialRegistrationPanel.vue",
      ),
      "utf8",
    );
    const rentalDetailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const labels = [
      "购买方名称",
      "销售方名称",
      "开票名称",
      "发票号码",
      "开票日期",
      "开票金额",
    ];
    for (const label of labels) {
      expect(panelSource).toContain(`label="${label}"`);
    }
    expect(panelSource).toContain("invoiceFieldsFor(row)?.itemName");
    expect(panelSource).toContain('aria-label="发票逐条明细"');
    expect(panelSource).toContain('label="不含税金额"');
    expect(panelSource).toContain('label="税额"');
    expect(panelSource).toContain('label="自动支出分类"');
    expect(panelSource).toContain('label="计入合同核算"');
    expect(panelSource).toContain("newInvoiceLineItems");
    expect(panelSource).toContain("registeredInvoiceLineItems");
    expect(panelSource).toContain(
      "props.isRentalLease && newInvoiceLineItems.length",
    );
    expect(panelSource).toContain(
      "props.isRentalLease && registeredInvoiceLineItems.length",
    );
    expect(panelSource).not.toContain('label="支出分类"');
    expect(panelSource).not.toContain("请选择支出分类");
    expect(panelSource).not.toContain("CONTRACT_EXPENSE_CATEGORY_LABELS");
    expect(panelSource).not.toContain('v-model="expenseCategory"');
    expect(panelSource).not.toContain("expenseCategory: expenseCategory.value");
    expect(rentalDetailSource).toContain(
      ':is-rental-lease="isHouseRentalLease"',
    );
    expect(rentalDetailSource).toContain('v-if="isHouseRentalLease"');
    expect(rentalDetailSource).toContain('class="rental-cost-groups"');
    expect(rentalDetailSource).toContain('v-if="isVehicleRentalLease"');
    expect(rentalDetailSource).toContain("合同总金额");
    expect(rentalDetailSource).toContain("isVehicleRentalLease = computed");
    expect(rentalDetailSource).toContain("isHouseRentalLease = computed");
    expect(rentalDetailSource).toContain(
      'declaredSubtype === "vehicle_rental"',
    );
    expect(rentalDetailSource).toContain('declaredSubtype === "house_rental"');
    expect(routeSource).toContain("requiresHouseRentalInvoiceLines(contract)");
    expect(routeSource).toContain("isVehicleRentalContract(contract)");
    expect(routeSource).toContain("allowTaxExemptInvoice:");
    expect(routeSource).not.toContain('declared_subtype === "parking_space"');
    expect(rentalDetailSource).toContain("合同内核算");
    expect(rentalDetailSource).toContain("合同外成本");
    expect(rentalDetailSource).toContain("outsideContractCost");
    expect(rentalDetailSource).not.toContain("<span>其他成本</span");
    expect(rentalDetailSource).not.toContain("<span>发票价税合计</span");
    expect(rentalDetailSource).not.toContain("<span>实际付款金额</span");
    expect(rentalDetailSource).toContain(
      "!isRentalLease && relatedAccountingLines.length",
    );
    expect(rentalDetailSource).toContain(
      'v-if="isAssetContract && !isRentalLease"',
    );
    expect(rentalDetailSource).toContain("relatedAccountingLines");
    expect(rentalDetailSource).toContain("暂无本合同相关支出记录");
    expect(rentalDetailSource).toContain(
      "Math.abs(moneyToNumber(line.amount)) > 0",
    );
    expect(
      panelSource.match(/class-name="invoice-item-name-column"/g)?.length,
    ).toBe(2);
    expect(
      panelSource.match(/class-name="invoice-number-column"/g)?.length,
    ).toBe(2);
    expect(panelSource).not.toContain("show-overflow-tooltip");
    expect(panelSource).toMatch(
      /\.credential-table :deep\(\.cell\)\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/,
    );
    expect(panelSource).toMatch(
      /\.credential-table :deep\(\.el-scrollbar__bar\.is-horizontal\)\s*\{[\s\S]*?display:\s*none !important;/,
    );
    expect(panelSource).toMatch(
      /td\.invoice-number-column \.cell\)\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/,
    );
    expect(panelSource).toContain("findInvoiceDuplicateInWorkspace");
    expect(panelSource).toContain("DUPLICATE_CONTRACT_INVOICE");
    expect(panelSource).toContain("FINANCIAL_FILE_HASH_DUPLICATE");
    expect(panelSource).toContain("INVOICE_ALREADY_USED_IN_OTHER_MODULE");
    expect(panelSource).toContain("BANK_DUPLICATE_CODES");
    expect(panelSource).toContain("findBankDuplicateInWorkspace");
    expect(panelSource).toContain("normalizeBankReceiptNumber");
    expect(panelSource).toContain("discardDuplicateBankResult");
    expect(panelSource).toContain("DUPLICATE_CONTRACT_BANK_DOCUMENT");
    expect(panelSource).toContain("电子回单号码 ${");
    expect(panelSource).toContain("本次登记包含重复发票");
    expect(panelSource).not.toContain("@media (max-width: 1500px)");
    expect(panelSource).not.toContain("@media (max-width: 980px)");
    for (const removedLabel of [
      "销方名称",
      "买方名称",
      "开票类型",
      "发票项目名称",
      "税费",
      "发票金额",
    ]) {
      expect(panelSource).not.toMatch(
        new RegExp(`<span>\\s*${removedLabel}\\s*</span`),
      );
    }

    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    expect(detailSource).toContain("开票名称：${record.itemName}");
    expect(detailSource).not.toContain(
      "税费：${formatContractMoney(record.taxAmount)}",
    );
    expect(detailSource).toContain("资产合同资金与经营核算链条");
    expect(detailSource).toMatch(
      /v-if="\s*detail\.contract\.category === 'asset' && isInternalFundingMode\s*"/,
    );
    expect(detailSource).toContain(
      'assetFundingMode === "engineering_to_technology"',
    );
    expect(detailSource).toContain("内部资金划拨");
    expect(detailSource).toContain("按工程回单日期计入支出");
    expect(detailSource).toContain("只用于履约核销");
    expect(detailSource).toContain("automaticFundingModeLabel");
    expect(detailSource).toContain("系统自动判断");
    expect(detailSource).not.toContain("handleFundingModeChange");
    expect(detailSource).not.toContain("funding-mode-select");
    expect(panelSource).toContain("contractCompanyDisplayName");
    expect(panelSource).toContain(
      "工程咨询→${contractCompanyDisplayName.value}划拨回单",
    );
    expect(panelSource).toContain(
      "${contractCompanyDisplayName.value}→合同对方付款回单",
    );
    expect(panelSource).toContain("contractCounterparty");
    expect(panelSource).toContain("contractCompanySubject");
    expect(detailSource).toContain(
      ':contract-counterparty="assetContractCounterparty"',
    );
    expect(detailSource).toContain(
      ':contract-company-subject="assetSigningSubject || undefined"',
    );
    expect(panelSource).toContain("registeredExternalPayments");
    expect(panelSource).toContain("accountingSettlementTotal");
    expect(panelSource).toContain(
      "requiresExternalPayment.value ? externalTotal.value : bankTotal.value",
    );
    expect(panelSource).toContain(
      "保存发票和${contractCompanyDisplayName.value}对外付款",
    );
    expect(panelSource).toContain("保存补充发票");
    expect(panelSource).toContain("发票已补充，仍待补发票");
    expect(panelSource).toContain("发票与累计回款金额已全部对应");
    expect(panelSource).toContain("已进入合同核算");
    expect(panelSource).toContain("canSaveExternalPaymentOnly");
    expect(panelSource).toContain(
      "先保存${contractCompanyDisplayName.value}对外付款",
    );
    expect(panelSource).toContain(
      "${contractCompanyDisplayName}对外付款可先保存，发票可后补；工程划拨回单按实际发生另行上传",
    );
    expect(panelSource).toContain("createContractExternalPaymentRegistration");
    expect(panelSource).toContain("后续补充发票核算明细");
    expect(panelSource).not.toContain("支持先付款、后补发票");
    expect(panelSource).not.toContain("当前发票金额无需与付款金额一致");
    expect(panelSource).toContain(
      "appendContractFinancialRegistrationExternalPayments",
    );
    expect(detailSource).toContain("经营管理归集");
    expect(detailSource).not.toContain("科技公司自行承担");
    expect(detailSource).not.toContain("北京羽隶科技有限公司");
    expect(panelSource).not.toContain("科技");
    expect(detailSource).not.toContain("资金承担方式尚未确认");
    expect(detailSource).not.toContain("assetSubjectChainMode");
    expect(detailSource).toMatch(
      /\.document-summary small\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/,
    );
  });

  it("详情页按登记编号聚合双凭证并对新旧记录选择正确生命周期接口", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    expect(source).toContain("financialRegistrationCards");
    expect(source).toContain("发票与回单对应关系");
    expect(source).toContain("financialRegistrationMatches");
    expect(source).toContain("match.allocatedAmount");
    expect(source).toContain("document.record.financialRegistrationId || null");
    expect(source).toContain("isAwaitingSettlement(card)");
    expect(source).toContain(
      "financialRegistrationPanelRef.value?.reloadPendingUploads()",
    );
    expect(source).toContain("usesExternalSettlement");
    expect(source).toContain("externalCents !== invoiceCents");
    expect(source).toContain("financialCardInvoiceRemainingAmount");
    expect(source).toContain("financialCardInternalPendingLabel");
    expect(source).toContain("openRegistrations.length !== 1");
    expect(source).toContain("financialRegistrationTargetId.value");
    expect(source).toContain("补充发票／回单");
    expect(source).toContain('"待补发票"');
    expect(source).toContain('"待补对外付款"');
    expect(source).toContain('"工程咨询划拨"');
    expect(source).toContain("financialRegistrationAmountSummary(card)");
    expect(source).toContain("financialCardRemainingAmount(card)");
    expect(source).toContain("invoiceCents !== settlementCents");
    expect(source).toContain("invoiceCents !== matchedCents");
    expect(source).toContain('"发票与回款待闭环"');
    expect(source).toContain('"回款登记·待补发票"');
    expect(source).toContain('"发票与回单财务登记"');
    expect(source).toContain("补充发票／回单");
    expect(source).toContain("确认整笔登记");
    expect(source).toContain("删除整笔登记");
    expect(source).toContain("冲销整笔登记");
    expect(source).toContain("confirmContractFinancialRegistration(");
    expect(source).toContain("deleteContractFinancialRegistration(");
    expect(source).toContain("reverseContractFinancialRegistration(");
    expect(source).toContain("confirmContractRecord(");
    expect(source).toContain("deleteContractRecordDraft(");
    expect(source).toContain("reverseContractRecord(");
    expect(source).toContain("getContractFileUrl(fileId, true)");
  });

  it("部分回款保存后按已入账事实切换删除、冲销和最终确认入口", () => {
    const panelSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractFinancialRegistrationPanel.vue",
      ),
      "utf8",
    );
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );

    expect(panelSource).toContain(
      "保存后立即计入${postedSettlementLabel.value}",
    );
    expect(panelSource).toContain(
      "已保存并立即计入${postedSettlementLabel.value}",
    );
    expect(panelSource).not.toContain(
      "部分${settlementActionLabel.value}已保存为草稿",
    );
    expect(detailSource).toContain(
      "银行凭证保存后立即计入已回款或已付款，最终金额闭合后确认整笔配对",
    );
    expect(detailSource).toContain("function hasConfirmedSettlement");
    expect(detailSource).toContain("!hasConfirmedSettlement(card)");
    expect(detailSource).toContain(
      "冲销已${financialCardSettlementAction(card)}登记",
    );
    expect(detailSource).toContain(
      '["draft", "confirmed"].includes(document.record.status)',
    );
    expect(detailSource).toContain("invoiceCents !== settlementCents");
    expect(detailSource).toContain("invoiceCents !== matchedCents");
    expect(detailSource).toContain("reverseContractFinancialRegistration(");
  });
});
