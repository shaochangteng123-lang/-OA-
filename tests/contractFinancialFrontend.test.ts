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
  reverseContractFinancialRegistration,
} from "@/utils/contractApi";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

describe("合同财务双凭证登记前端闭环", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it("没有发票时可先保存科技对外付款登记", async () => {
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
    expect(panelSource).toContain("回单合计");
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

    expect(wrapper.text()).toContain("部分回款，待补 ¥380,000.00");
    expect(wrapper.text()).toContain("当前累计回款 ¥220,000.00");
    expect(wrapper.text()).toContain("尚待回款 ¥380,000.00");
    expect(wrapper.text()).toContain("请继续上传新的回款回单");
    expect(wrapper.text()).toContain("保存本次部分回款");
    expect(wrapper.text()).toContain("保存后立即计入已回款");

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
    expect(detailSource).toContain("内部资金划拨");
    expect(detailSource).toContain("按工程回单日期计入支出");
    expect(detailSource).toContain("只用于履约核销");
    expect(detailSource).toContain("automaticFundingModeLabel");
    expect(detailSource).toContain("系统自动判断");
    expect(detailSource).not.toContain("handleFundingModeChange");
    expect(detailSource).not.toContain("funding-mode-select");
    expect(panelSource).toContain("工程咨询→科技划拨回单");
    expect(panelSource).toContain("科技→合同对方付款回单");
    expect(panelSource).toContain("contractCounterparty");
    expect(detailSource).toContain(
      ':contract-counterparty="assetContractCounterparty"',
    );
    expect(panelSource).toContain("registeredExternalPayments");
    expect(panelSource).toContain("accountingSettlementTotal");
    expect(panelSource).toContain(
      "requiresExternalPayment.value ? externalTotal.value : bankTotal.value",
    );
    expect(panelSource).toContain("保存发票和科技对外付款");
    expect(panelSource).toContain("保存补充发票");
    expect(panelSource).toContain("发票已补充，合同核算明细和待补差额已更新");
    expect(panelSource).toContain("已进入合同核算");
    expect(panelSource).toContain("canSaveExternalPaymentOnly");
    expect(panelSource).toContain("先保存科技对外付款");
    expect(panelSource).toContain("createContractExternalPaymentRegistration");
    expect(panelSource).toContain("后续补充发票核算明细");
    expect(panelSource).not.toContain("支持先付款、后补发票");
    expect(panelSource).not.toContain("当前发票金额无需与付款金额一致");
    expect(panelSource).toContain(
      "appendContractFinancialRegistrationExternalPayments",
    );
    expect(detailSource).toContain("经营管理归集");
    expect(detailSource).not.toContain("科技公司自行承担");
    expect(detailSource).not.toContain("资金承担方式尚未确认");
    expect(detailSource).toContain("assetSubjectChainMode === 'technology'");
    expect(detailSource).toContain("assetSubjectChainMode === 'accounting'");
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
    expect(source).toContain('"待回款发票登记"');
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
