jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

import fs from "fs";
import path from "path";
import { api } from "@/utils/api";
import ContractCompletedInternalFundingPanel from "@/components/contracts/ContractCompletedInternalFundingPanel.vue";
import {
  confirmCompletedInternalFunding,
  deleteCompletedInternalFundingRecognition,
  getCompletedInternalFundingSummary,
  recognizeCompletedInternalFundingFile,
} from "@/utils/contractApi";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const interactiveUploadStub = {
  name: "InteractiveUploadStub",
  props: { disabled: Boolean, onChange: Function },
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

function verifiedRecognition(id: string, amount: number) {
  return {
    jobId: id,
    fileId: `file-${id}`,
    status: "verified",
    validationStatus: "verified",
    canConfirm: true,
    fields: {
      paymentTime: "2026-08-27",
      amount,
      electronicReceiptNo: `NO-${id}`,
      payer: "北京羽隶工程咨询有限公司",
      payerAccount: "1111",
      payee: "北京羽隶科技有限公司",
      payeeAccount: "2222",
    },
    blockingReasons: [],
    warnings: [],
  };
}

describe("已完成合同内部划拨专项补录前端", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:completed-internal-funding"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
  });

  it("兼容汇总下划线字段并恢复未确认识别任务", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          can_append_after_completion: true,
          contract_company_subject_name: "北京羽隶科技有限公司",
          required_amount: "100000.00",
          confirmed_amount: "30000.00",
          pending_amount: "20000.00",
          remaining_amount: "70000.00",
          confirmed_receipts: [
            {
              id: "confirmed-1",
              file_name: "已确认划拨回单.pdf",
              amount: "30000.00",
              payment_date: "2026-07-31",
            },
          ],
          pending_recognitions: [verifiedRecognition("pending-1", 20000)],
        },
      },
    });

    const result = await getCompletedInternalFundingSummary("contract-1");

    expect(result).toMatchObject({
      canAppendAfterCompletion: true,
      contractCompanySubjectName: "北京羽隶科技有限公司",
      requiredAmount: "100000.00",
      confirmedAmount: "30000.00",
      pendingAmount: "20000.00",
      remainingAmount: "70000.00",
    });
    expect(result.pendingRecognitions[0]?.jobId).toBe("pending-1");
    expect(result.receipts[0]?.paymentTime).toBe("2026-07-31");
  });

  it("使用独立识别、移除和确认资源地址", async () => {
    const recognition = verifiedRecognition("job-1", 10000);
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { success: true, data: recognition } })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            canAppendAfterCompletion: false,
            contractCompanySubjectName: "北京羽隶科技有限公司",
            requiredAmount: 10000,
            confirmedAmount: 10000,
            pendingAmount: 0,
            remainingAmount: 0,
            receipts: [],
            pendingRecognitions: [],
          },
        },
      });
    (api.delete as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: { deleted: true } },
    });
    const file = new File(["receipt"], "划拨回单.pdf", {
      type: "application/pdf",
    });

    const normalizedRecognition = await recognizeCompletedInternalFundingFile(
      "contract-1",
      file,
    );
    await deleteCompletedInternalFundingRecognition("contract-1", "job-1");
    await confirmCompletedInternalFunding("contract-1", ["job-1"]);

    const recognitionCall = (api.post as jest.Mock).mock.calls[0];
    expect(recognitionCall[0]).toBe(
      "/api/contracts/contract-1/completed-internal-funding/recognize",
    );
    expect((recognitionCall[1] as FormData).get("file")).toBe(file);
    expect(normalizedRecognition).toMatchObject({
      jobId: "job-1",
      fileId: "file-job-1",
      canConfirm: true,
      fields: { amount: 10000, paymentTime: "2026-08-27" },
    });
    expect(api.delete).toHaveBeenCalledWith(
      "/api/contracts/contract-1/completed-internal-funding/recognitions/job-1",
    );
    expect((api.post as jest.Mock).mock.calls[1]).toEqual([
      "/api/contracts/contract-1/completed-internal-funding/confirm",
      { ocrJobIds: ["job-1"] },
    ]);
  });

  it("只在允许补录时展示，并用剩余额度扣除待确认金额限制上传", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          canAppendAfterCompletion: false,
          contractCompanySubjectName: "北京羽隶科技有限公司",
          requiredAmount: 100000,
          confirmedAmount: 0,
          pendingAmount: 100000,
          remainingAmount: 100000,
          receipts: [],
          pendingRecognitions: [verifiedRecognition("pending-full", 100000)],
        },
      },
    });
    const wrapper = mount(ContractCompletedInternalFundingPanel, {
      props: { contractId: "completed-contract" },
      global: {
        stubs: {
          ElAlert: true,
          ElButton: {
            props: ["disabled"],
            template: '<button :disabled="disabled"><slot /></button>',
          },
          ElIcon: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: {
            props: ["disabled"],
            template:
              '<div class="upload-stub" :data-disabled="String(disabled)"><slot /></div>',
          },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("补齐工程咨询内部划拨");
    expect(wrapper.text()).toContain("工程咨询→北京羽隶科技有限公司划拨回单");
    expect(wrapper.text()).toContain("待确认");
    expect(wrapper.text()).toContain("¥100,000.00");
    expect(wrapper.find(".upload-stub").attributes("data-disabled")).toBe(
      "true",
    );
    expect(wrapper.text()).toContain(
      "待确认识别任务已占满尚待划拨金额，请先确认或移除",
    );
    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("确认保存内部划拨"));
    expect(confirmButton?.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("拖拽上传框选择文件后立即识别并逐张展示结构化字段", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          canAppendAfterCompletion: true,
          contractCompanySubjectName: "北京羽隶科技有限公司",
          requiredAmount: 100000,
          confirmedAmount: 0,
          pendingAmount: 0,
          remainingAmount: 100000,
          availableRecognitionAmount: 100000,
          receipts: [],
          pendingRecognitions: [],
        },
      },
    });
    let resolveRecognition!: (value: unknown) => void;
    (api.post as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRecognition = resolve;
      }),
    );
    const wrapper = mount(ContractCompletedInternalFundingPanel, {
      props: { contractId: "completed-contract" },
      global: {
        stubs: {
          ElAlert: true,
          ElButton: {
            props: ["disabled", "loading"],
            template:
              '<button :disabled="disabled || loading"><slot /></button>',
          },
          ElIcon: true,
          ElTable: true,
          ElTableColumn: true,
          ElTag: { template: "<span><slot /></span>" },
          ElUpload: interactiveUploadStub,
        },
      },
    });
    await flushPromises();
    const file = new File(["transfer"], "工程划拨回单.pdf", {
      type: "application/pdf",
    });

    (
      wrapper.findComponent(interactiveUploadStub).vm as unknown as {
        select: (file: File) => void;
      }
    ).select(file);
    await flushPromises();

    expect(wrapper.text()).toContain("识别中");
    resolveRecognition({
      data: {
        success: true,
        data: verifiedRecognition("new-transfer", 40000),
      },
    });
    await flushPromises();

    const recognitionCall = (api.post as jest.Mock).mock.calls[0];
    expect(recognitionCall[0]).toBe(
      "/api/contracts/completed-contract/completed-internal-funding/recognize",
    );
    expect((recognitionCall[1] as FormData).get("file")).toBe(file);
    expect(wrapper.find(".sequence-cell").text()).toBe("1");
    expect(wrapper.text()).not.toContain("工程划拨回单.pdf");
    expect(wrapper.text()).toContain("北京羽隶工程咨询有限公司");
    expect(wrapper.text()).toContain("1111");
    expect(wrapper.text()).toContain("北京羽隶科技有限公司");
    expect(wrapper.text()).toContain("2222");
    expect(wrapper.text()).toContain("NO-new-transfer");
    expect(wrapper.text()).toContain("2026-08-27");
    expect(wrapper.text()).toContain("¥40,000.00");
    expect(wrapper.text()).toContain("校验通过");
    expect(wrapper.text()).not.toContain("识别中");
    expect(
      wrapper.find('a[href="blob:completed-internal-funding"]').exists(),
    ).toBe(true);
    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("确认保存内部划拨"));
    expect(confirmButton?.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("详情页仅在已完成内部划拨模式检查专项权限且不放开完整财务面板", () => {
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    const panelSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractCompletedInternalFundingPanel.vue",
      ),
      "utf8",
    );

    expect(detailSource).toContain("<ContractCompletedInternalFundingPanel");
    expect(detailSource).toContain("shouldCheckCompletedInternalFunding");
    expect(detailSource).toContain(
      'detail.value.contract.status === "completed"',
    );
    expect(detailSource).toContain(
      'detail.value.contract.assetFundingMode === "engineering_to_technology"',
    );
    expect(detailSource).toContain(
      'v-if="canManageFinancials && detail.contract.category"',
    );
    expect(panelSource).not.toContain("ContractFinancialRegistrationPanel");
    expect(panelSource).not.toContain("ContractDepositReceiptInline");
    expect(panelSource).toContain("drag");
    expect(panelSource).toContain("multiple");
    expect(panelSource).toContain("拖拽或点击上传工程划拨回单");
    expect(panelSource).toContain('type="index"');
    expect(panelSource).toContain("<span>序号</span>");
    expect(panelSource).not.toContain('label="文件"');
    expect(panelSource).toContain('v-for="(item, index) in credentials"');
    expect(panelSource).toContain("{{ index + 1 }}");
    expect(panelSource).toContain("付款方／账号");
    expect(panelSource).toContain("核验状态");
    expect(panelSource).toContain("justify-items: center");
    expect(panelSource).toContain("text-align: center");
  });
});
