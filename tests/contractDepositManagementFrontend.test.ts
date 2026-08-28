jest.mock("@/utils/api", () => ({
  api: {
    delete: jest.fn(),
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

import fs from "fs";
import path from "path";
import { api } from "@/utils/api";
import ContractDepositManagementInline from "@/components/contracts/ContractDepositManagementInline.vue";
import {
  deleteContractDepositReturnReceiptRecognition,
  deleteContractDepositSettlementReceipt,
  getContractDeposit,
  getContractErrorMessage,
  recognizeContractDepositReturnReceipt,
  registerContractDepositEngineeringReturn,
  settleContractDeposit,
  updateContractDeposit,
  uploadContractDepositRefundReceipt,
} from "@/utils/contractApi";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

describe("租赁合同押金管理前端", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("上传回单失败时优先展示服务端业务原因", () => {
    const error = Object.assign(
      new Error("Request failed with status code 409"),
      {
        response: {
          data: {
            message: "该回单已作为付款凭证入账，不能重复用于押金结算",
          },
        },
      },
    );

    expect(getContractErrorMessage(error, "回单上传失败")).toBe(
      "该回单已作为付款凭证入账，不能重复用于押金结算",
    );
  });

  it("已完成租赁主合同没有押金记录时隐藏整个押金管理区", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          eligibility: {
            likely: true,
            reason: "rental_subtype",
            subtype: "parking_space",
          },
          deposit: null,
        },
      },
    });

    const wrapper = mount(ContractDepositManagementInline, {
      props: {
        contractId: "completed-parking-contract",
        subtypeLabel: "车位租赁",
        canManage: false,
        hideEmptyReadonly: true,
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: { template: "<button><slot /></button>" },
          ElFormItem: { template: "<div><slot /></div>" },
          ElIcon: true,
          ElInput: true,
          ElOption: true,
          ElSelect: true,
          ElSkeleton: true,
          ElTag: { template: "<span><slot /></span>" },
        },
      },
    });
    await flushPromises();

    expect(wrapper.find(".contract-deposit-management").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("尚未建立押金记录");
    wrapper.unmount();
  });

  it("已完成租赁主合同已有押金记录时仅展示只读摘要", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          eligibility: {
            likely: true,
            reason: "rental_subtype",
            subtype: "parking_space",
          },
          deposit: {
            id: "completed-deposit",
            contract_id: "completed-parking-contract",
            amount: 5000,
            funding_source: "technology_self_funded",
            engineering_allocation_amount: 0,
            technology_self_funded_amount: 5000,
            pending_engineering_return: 0,
            status: "active",
            settled_amount: 0,
            remaining_amount: 5000,
            settlement_records: [],
          },
        },
      },
    });

    const wrapper = mount(ContractDepositManagementInline, {
      props: {
        contractId: "completed-parking-contract",
        subtypeLabel: "车位租赁",
        canManage: false,
        hideEmptyReadonly: true,
      },
      global: {
        stubs: {
          ElAlert: {
            props: ["title", "description"],
            template: "<div>{{ title }}{{ description }}<slot /></div>",
          },
          ElButton: { template: "<button><slot /></button>" },
          ElIcon: true,
          ElTag: { template: "<span><slot /></span>" },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("押金金额");
    expect(wrapper.text()).toContain("¥5,000.00");
    expect(wrapper.text()).not.toContain("修改登记");
    expect(wrapper.text()).not.toContain("押金结算");
    wrapper.unmount();
  });

  it("兼容服务端下划线字段并回读混合资金及待退工程金额", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          eligibility: {
            likely: true,
            reason: "rental_subtype",
            subtype: "house_rental",
          },
          deposit: {
            id: "deposit-1",
            contract_id: "contract-1",
            amount: "79494.00",
            clause_text: "押金为三个月租金及物业费",
            basis: "三个月租金及物业费",
            funding_source: "mixed",
            engineering_allocation_amount: "50000.00",
            technology_self_funded_amount: "29494.00",
            pending_engineering_return: "12000.00",
            payment_record_id: "external-payment-1",
            payment_record_kind: "external_payment",
            status: "partially_settled",
            settled_amount: "30000.00",
            remaining_amount: "49494.00",
            settlement_records: [
              {
                id: "settlement-1",
                settlement_type: "refund",
                amount: "20000.00",
                settlement_date: "2026-08-27",
                refund_receipt: {
                  id: "receipt-refund-1",
                  file_name: "押金退回银行回单.pdf",
                  file_size: 2048,
                  mime_type: "application/pdf",
                  amount: "20000.00",
                  transaction_date: "2026-08-27",
                  file_url:
                    "/api/contracts/contract-1/deposit/settlements/settlement-1/receipts/receipt-refund-1/file",
                  uploaded_by_name: "财务管理员",
                },
                engineering_return_receipts: [
                  {
                    id: "receipt-engineering-1",
                    file_name: "退工程回单.png",
                    file_size: 1024,
                    mime_type: "image/png",
                    amount: "12000.00",
                    transaction_date: "2026-08-27",
                    file_url:
                      "/api/contracts/contract-1/deposit/settlements/settlement-1/engineering-return-receipts/receipt-engineering-1/file",
                  },
                ],
                engineering_return_required_amount: "12000.00",
                engineering_returned_amount: "0.00",
                engineering_return_status: "pending",
              },
            ],
          },
        },
      },
    });

    const result = await getContractDeposit("contract-1");

    expect(api.get).toHaveBeenCalledWith("/api/contracts/contract-1/deposit");
    expect(result.deposit).toMatchObject({
      fundingSource: "mixed",
      engineeringAllocationAmount: "50000.00",
      technologySelfFundedAmount: "29494.00",
      pendingEngineeringReturn: "12000.00",
      paymentRecordKind: "external_payment",
      remainingAmount: "49494.00",
    });
    expect(result.deposit?.settlements[0]).toMatchObject({
      type: "refund",
      amount: "20000.00",
      engineeringReturnRequiredAmount: "12000.00",
      engineeringReturnedAmount: "0.00",
      engineeringReturnStatus: "pending",
      refundReceipt: expect.objectContaining({
        id: "receipt-refund-1",
        fileName: "押金退回银行回单.pdf",
        transactionDate: "2026-08-27",
      }),
      engineeringReturnReceipts: [
        expect.objectContaining({
          id: "receipt-engineering-1",
          fileName: "退工程回单.png",
          fileUrl: expect.stringContaining("receipt-engineering-1/file"),
        }),
      ],
    });
  });

  it("先识别退款与退工程回单，再仅用识别任务确认金额动作", async () => {
    const snapshot = {
      eligibility: { likely: true, reason: "rental_subtype" },
      deposit: {
        id: "deposit-2",
        contractId: "contract-2",
        amount: 30000,
        fundingSource: "mixed",
        engineeringAllocationAmount: 20000,
        technologySelfFundedAmount: 10000,
        pendingEngineeringReturn: 0,
        status: "active",
        settledAmount: 0,
        remainingAmount: 30000,
        settlements: [],
      },
    };
    (api.put as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: snapshot },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          jobId: "ocr-refund",
          fileId: "file-refund",
          receiptKind: "deposit_refund",
          targetId: "contract-2",
          status: "verified",
          validationStatus: "verified",
          canConfirm: true,
          fields: {
            paymentTime: "2026-08-27",
            amount: 12000,
            electronicReceiptNo: "REFUND-001",
            payer: "出租方",
            payerAccount: "62220001",
            payee: "北京羽隶科技有限公司",
            payeeAccount: "62220002",
          },
          blockingReasons: [],
          warnings: [],
          engineVersion: "engine-v1",
          parserVersion: "parser-v1",
        },
      },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          ...snapshot,
          deposit: {
            ...snapshot.deposit,
            status: "partially_settled",
            settledAmount: 12000,
            remainingAmount: 18000,
          },
        },
      },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          jobId: "ocr-engineering",
          fileId: "file-engineering",
          receiptKind: "engineering_return",
          targetId: "settlement-2",
          status: "verified",
          validationStatus: "verified",
          canConfirm: true,
          fields: {
            paymentTime: "2026-08-27",
            amount: 8000,
            electronicReceiptNo: "ENGINEERING-001",
            payer: "北京羽隶科技有限公司",
            payerAccount: "62220002",
            payee: "北京羽隶工程咨询有限公司",
            payeeAccount: "62220003",
          },
          blockingReasons: [],
          warnings: [],
          engineVersion: "engine-v1",
          parserVersion: "parser-v1",
        },
      },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: snapshot },
    });

    await updateContractDeposit("contract-2", {
      amount: 30000,
      paymentPurpose: "lease_deposit",
      fundingSource: "mixed",
      engineeringAllocationAmount: 20000,
      technologySelfFundedAmount: 10000,
      clauseText: "押金三万元",
    });
    const refundReceipt = new File(["refund"], "押金退回回单.pdf", {
      type: "application/pdf",
    });
    const engineeringReturnReceipt = new File(
      ["engineering-return"],
      "退工程回单.png",
      { type: "image/png" },
    );

    const refundRecognition = await recognizeContractDepositReturnReceipt(
      "contract-2",
      "deposit_refund",
      refundReceipt,
    );
    await settleContractDeposit("contract-2", {
      type: "refund",
      ocrJobId: refundRecognition.jobId,
      note: "部分退回",
    });
    const engineeringRecognition = await recognizeContractDepositReturnReceipt(
      "contract-2",
      "engineering_return",
      engineeringReturnReceipt,
      "settlement-2",
    );
    await registerContractDepositEngineeringReturn(
      "contract-2",
      "settlement-2",
      {
        ocrJobId: engineeringRecognition.jobId,
        note: "退回工程咨询公司",
      },
    );

    expect(api.put).toHaveBeenCalledWith(
      "/api/contracts/contract-2/deposit",
      expect.objectContaining({
        paymentPurpose: "lease_deposit",
        fundingSource: "mixed",
        engineeringAllocationAmount: 20000,
        technologySelfFundedAmount: 10000,
      }),
    );
    const refundRecognitionCall = (api.post as jest.Mock).mock.calls[0];
    expect(refundRecognitionCall[0]).toBe(
      "/api/contracts/contract-2/deposit/return-receipts/recognize",
    );
    expect(refundRecognitionCall[1]).toBeInstanceOf(FormData);
    expect((refundRecognitionCall[1] as FormData).get("receiptKind")).toBe(
      "deposit_refund",
    );
    expect((refundRecognitionCall[1] as FormData).has("settlementId")).toBe(
      false,
    );
    expect((refundRecognitionCall[1] as FormData).get("file")).toBe(
      refundReceipt,
    );

    const settlementCall = (api.post as jest.Mock).mock.calls[1];
    expect(settlementCall[0]).toBe(
      "/api/contracts/contract-2/deposit/settlements",
    );
    expect(settlementCall[1]).toEqual({
      type: "refund",
      ocrJobId: "ocr-refund",
      note: "部分退回",
    });

    const engineeringRecognitionCall = (api.post as jest.Mock).mock.calls[2];
    expect(engineeringRecognitionCall[0]).toBe(
      "/api/contracts/contract-2/deposit/return-receipts/recognize",
    );
    expect((engineeringRecognitionCall[1] as FormData).get("receiptKind")).toBe(
      "engineering_return",
    );
    expect(
      (engineeringRecognitionCall[1] as FormData).get("settlementId"),
    ).toBe("settlement-2");
    expect((engineeringRecognitionCall[1] as FormData).get("file")).toBe(
      engineeringReturnReceipt,
    );

    const engineeringReturnCall = (api.post as jest.Mock).mock.calls[3];
    expect(engineeringReturnCall[0]).toBe(
      "/api/contracts/contract-2/deposit/settlements/settlement-2/engineering-return",
    );
    expect(engineeringReturnCall[1]).toEqual({
      ocrJobId: "ocr-engineering",
      note: "退回工程咨询公司",
    });
  });

  it("扣款与抵租金只提交必填说明且不上传回单", async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        success: true,
        data: {
          eligibility: { likely: true, reason: "rental_subtype" },
          deposit: null,
        },
      },
    });

    await settleContractDeposit("contract-deduction", {
      type: "deduction",
      amount: 3000,
      settlementDate: "2026-08-27",
      note: "按退租验收单扣除维修费",
    });

    expect((api.post as jest.Mock).mock.calls[0][1]).toEqual({
      type: "deduction",
      amount: 3000,
      settlementDate: "2026-08-27",
      note: "按退租验收单扣除维修费",
    });
  });

  it("历史退款可通过结算级资源地址补传退回回单", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          jobId: "ocr-legacy",
          fileId: "file-legacy",
          receiptKind: "deposit_refund",
          targetId: "settlement-legacy",
          status: "verified",
          validationStatus: "verified",
          canConfirm: true,
          fields: {
            paymentTime: "2026-08-27",
            amount: 12000,
            electronicReceiptNo: "LEGACY-001",
            payer: "出租方",
            payerAccount: "62220001",
            payee: "北京羽隶科技有限公司",
            payeeAccount: "62220002",
          },
          blockingReasons: [],
          warnings: [],
        },
      },
    });
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          eligibility: { likely: true, reason: "rental_subtype" },
          deposit: null,
        },
      },
    });
    const file = new File(["legacy-refund"], "历史押金退回回单.jpg", {
      type: "image/jpeg",
    });

    const recognition = await recognizeContractDepositReturnReceipt(
      "contract-legacy",
      "deposit_refund",
      file,
      "settlement-legacy",
    );
    await uploadContractDepositRefundReceipt(
      "contract-legacy",
      "settlement-legacy",
      recognition.jobId,
    );

    const recognitionCall = (api.post as jest.Mock).mock.calls[0];
    expect(recognitionCall[0]).toBe(
      "/api/contracts/contract-legacy/deposit/return-receipts/recognize",
    );
    expect((recognitionCall[1] as FormData).get("settlementId")).toBe(
      "settlement-legacy",
    );
    expect((recognitionCall[1] as FormData).get("file")).toBe(file);

    const confirmCall = (api.post as jest.Mock).mock.calls[1];
    expect(confirmCall[0]).toBe(
      "/api/contracts/contract-legacy/deposit/settlements/settlement-legacy/refund-receipt",
    );
    expect(confirmCall[1]).toEqual({ ocrJobId: "ocr-legacy" });
  });

  it("已保存的退款与退工程回单使用统一结算级删除地址", async () => {
    (api.delete as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          eligibility: { likely: true, reason: "rental_subtype" },
          deposit: null,
        },
      },
    });

    await deleteContractDepositSettlementReceipt(
      "contract-delete",
      "settlement-delete",
      "receipt-delete",
    );

    expect(api.delete).toHaveBeenCalledWith(
      "/api/contracts/contract-delete/deposit/settlements/settlement-delete/receipts/receipt-delete",
    );
  });

  it("移除未消费回单时删除对应识别任务", async () => {
    (api.delete as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: { deleted: true } },
    });

    await deleteContractDepositReturnReceiptRecognition(
      "contract-recognition",
      "ocr-return-1",
    );

    expect(api.delete).toHaveBeenCalledWith(
      "/api/contracts/contract-recognition/deposit/return-receipts/ocr-return-1",
    );
  });

  it("详情页只对明确的租赁资产二级分类接入内联组件", () => {
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    const componentSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractDepositManagementInline.vue",
      ),
      "utf8",
    );

    expect(ContractDepositManagementInline).toBeTruthy();
    expect(detailSource).toContain("<ContractDepositManagementInline");
    expect(detailSource).toContain(':can-manage="canManageFinancials"');
    expect(detailSource).toContain(
      ":hide-empty-readonly=\"detail.contract.status === 'completed'\"",
    );
    expect(detailSource).toContain("canManageFinancials ||");
    expect(detailSource).toContain("查看押金留痕");
    expect(componentSource).toContain("panelVisible");
    expect(componentSource).toContain("hideEmptyReadonly?: boolean");
    expect(detailSource).toContain(
      '["house_rental", "vehicle_rental", "parking_space"].includes',
    );
    expect(componentSource).not.toContain("<el-dialog");
    expect(componentSource).toContain("支持部分退回、扣款和抵租金组合");
    expect(componentSource).not.toContain("退回必须一次性结清");
    expect(componentSource).toContain("pendingEngineeringReturn");
    expect(componentSource).toContain("minmax(180px, 0.7fr)");
    expect(componentSource).toContain(".el-form-item__label");
    expect(componentSource).toContain("登记退工程");
    expect(componentSource).toContain("engineering-return");
    expect(componentSource).toContain("押金退回银行回单（必填）");
    expect(componentSource).toContain("请选择押金退回银行回单");
    expect(componentSource).toContain("扣款或抵租金必须填写结算说明");
    expect(componentSource).toContain("退工程回单（必填）");
    expect(componentSource).toContain("engineeringReturnReceiptFile.value");
    expect(componentSource).toContain("补充退回回单");
    expect(componentSource).toContain("handleMissingRefundReceiptChange");
    expect(componentSource).toContain(
      "押金退回银行回单上传失败，请重新选择后再试",
    );
    expect(componentSource).toContain('target="_blank"');
    expect(componentSource).toContain("在线预览");
    expect(componentSource).toContain("URL.createObjectURL");
    expect(componentSource).toContain("URL.revokeObjectURL");
    expect(componentSource).toContain("onBeforeUnmount");
    expect(componentSource).toContain("删除回单");
    expect(componentSource).toContain("receipt-delete-confirmation");
    expect(componentSource).toContain("回单删除失败，原记录已保留，请稍后重试");
    expect(componentSource).toContain("回单校验通过");
    expect(componentSource).toContain("上传回单后自动识别");
    expect(componentSource).toContain("选择后自动识别，识别通过后才能确认结算");
    expect(componentSource).toContain("选择后自动识别，识别通过后才能确认退回");
    expect(componentSource).toContain("ocrJobId: recognition.jobId");
    expect(componentSource).toContain("removeSettlementReceipt()");
    expect(componentSource).toContain("getContractErrorMessage");
    expect(componentSource).not.toContain("function errorMessage");
    expect(componentSource.match(/const editing = ref/g)).toHaveLength(1);
    expect(componentSource.match(/editing\.value = true;/g)).toHaveLength(1);
  });
});
