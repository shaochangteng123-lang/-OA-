jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
  },
}));

import fs from "fs";
import path from "path";
import { api } from "@/utils/api";
import ContractDepositReceiptInline from "@/components/contracts/ContractDepositReceiptInline.vue";
import {
  deleteContractDepositReceipt,
  getContract,
  uploadContractDepositReceipt,
  verifyContractDepositReceipt,
  voidContractDepositReceipt,
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
  template: '<div class="upload-stub"><slot /></div>',
};

const componentStubs = {
  ElAlert: {
    props: ["title", "description"],
    template: "<div>{{ title }}{{ description }}<slot /></div>",
  },
  ElButton: {
    props: ["disabled", "loading"],
    emits: ["click"],
    template:
      '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  ElForm: { template: "<form><slot /></form>" },
  ElFormItem: {
    props: ["label"],
    template: "<label>{{ label }}<slot /></label>",
  },
  ElIcon: { template: "<i><slot /></i>" },
  ElInput: {
    props: ["modelValue", "disabled"],
    emits: ["update:modelValue"],
    template:
      '<input class="amount-input" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  ElTag: { template: "<span><slot /></span>" },
  ElUpload: interactiveUploadStub,
};

describe("资产合同押金条登记前端闭环", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: jest.fn(() => "blob:deposit-receipt-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: jest.fn(),
    });
  });

  it("详情接口兼容后端押金条字段并保留扣除押金后的发票覆盖金额", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          contract: {
            id: "contract-deposit",
            relation_type: "main",
            category: "asset",
            status: "executing",
          },
          payments: [
            {
              id: "payment-1",
              amount: "100000.00",
              confirmed_deposit_amount: "30000.00",
              invoice_required_amount: "70000.00",
            },
          ],
          deposit_receipts: [
            {
              id: "deposit-1",
              contractId: "contract-deposit",
              paymentRecordId: "payment-1",
              fileName: "押金条.jpg",
              fileUrl: "/api/deposit-1/file",
              mimeType: "image/jpeg",
              ocrStatus: "recognized",
              recognizedAmount: 30000,
              status: "confirmed",
              confirmedAmount: 30000,
              uploadedBy: "admin-upload",
              confirmedBy: "admin-confirm",
              confirmedAt: "2026-08-27T09:30:00.000Z",
              createdAt: "2026-08-27T09:00:00.000Z",
            },
          ],
        },
      },
    });

    const detail = await getContract("contract-deposit");

    expect(detail.payments[0]).toMatchObject({
      amount: "100000.00",
      confirmedDepositAmount: "30000.00",
      invoiceRequiredAmount: "70000.00",
    });
    expect(detail.depositReceipts[0]).toMatchObject({
      financialRecordId: "payment-1",
      previewUrl: "/api/deposit-1/file",
      ocrAmount: 30000,
      verifiedAmount: 30000,
      status: "verified",
      createdBy: "admin-upload",
      verifiedBy: "admin-confirm",
      verifiedAt: "2026-08-27T09:30:00.000Z",
    });
  });

  it("上传 JPEG（联合图像专家组）原件并在识别失败后由管理员手工验证", async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "deposit-manual",
            contractId: "contract-deposit",
            paymentRecordId: "payment-manual",
            fileName: "押金条.jpeg",
            fileUrl: "/api/deposit-manual/file",
            mimeType: "image/jpeg",
            ocrStatus: "unrecognized",
            recognizedAmount: null,
            ocrFailureMessage: "未找到明确金额",
            status: "pending",
            confirmedAmount: null,
            uploadedBy: "admin-upload",
            confirmedBy: null,
            confirmedAt: null,
            createdAt: "2026-08-27T09:00:00.000Z",
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "deposit-manual",
            contractId: "contract-deposit",
            paymentRecordId: "payment-manual",
            fileName: "押金条.jpeg",
            fileUrl: "/api/deposit-manual/file",
            mimeType: "image/jpeg",
            ocrStatus: "unrecognized",
            recognizedAmount: null,
            status: "confirmed",
            confirmedAmount: 30000,
            uploadedBy: "admin-upload",
            confirmedBy: "admin-confirm",
            confirmedAt: "2026-08-27T09:30:00.000Z",
            createdAt: "2026-08-27T09:00:00.000Z",
          },
        },
      });
    const wrapper = mount(ContractDepositReceiptInline, {
      props: {
        contractId: "contract-deposit",
        financialRecordId: "payment-manual",
        receiptAmount: 100000,
        canManage: true,
      },
      global: { stubs: componentStubs },
    });
    const file = new File(["deposit"], "押金条.jpeg", {
      type: "image/jpeg",
    });

    await (
      wrapper.findComponent(interactiveUploadStub).vm as unknown as {
        select: (file: File) => Promise<void>;
      }
    ).select(file);
    await flushPromises();

    const uploadData = (api.post as jest.Mock).mock.calls[0][1] as FormData;
    expect(uploadData.get("file")).toBe(file);
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      "/api/contracts/contract-deposit/financial-records/payment-manual/deposit-receipts",
      expect.any(FormData),
      { timeout: 180_000 },
    );
    expect(wrapper.text()).toContain(
      "未识别出押金金额，请管理员查看原件后手工填写并确认",
    );
    expect(wrapper.text()).toContain("admin-upload");

    await wrapper.find(".amount-input").setValue("30000");
    expect(wrapper.text()).toContain("70,000.00");
    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("确认验证"));
    expect(confirmButton).toBeTruthy();
    await confirmButton!.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenNthCalledWith(
      2,
      "/api/contracts/contract-deposit/financial-records/payment-manual/deposit-receipts/deposit-manual/verify",
      { amount: "30000.00" },
    );
    expect(wrapper.text()).toContain("已验证");
    expect(wrapper.text()).toContain("admin-confirm");
    wrapper.unmount();
  });

  it("押金条使用页面内展开预览且财务闭环按需发票金额匹配", async () => {
    const detailSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
      "utf8",
    );
    const componentSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractDepositReceiptInline.vue",
      ),
      "utf8",
    );

    expect(detailSource).toContain("登记押金");
    expect(detailSource).toContain("ContractDepositReceiptInline");
    expect(detailSource).toMatch(
      /Number\([\s\S]*?document\.record\.confirmedDepositAmount \|\| 0,[\s\S]*?\)\s*>\s*0/u,
    );
    expect(detailSource).toContain("financialRecordInvoiceRequiredCents");
    expect(detailSource).toContain(
      "record.invoiceRequiredAmount ?? record.amount",
    );
    expect(componentSource).toContain("deposit-original-preview");
    expect(componentSource).toContain("<iframe");
    expect(componentSource).not.toContain("el-dialog");
  });

  it("待验证押金条在页面内二次确认后删除并恢复上传入口", async () => {
    (api.delete as jest.Mock).mockResolvedValueOnce({
      data: { success: true, data: { deleted: true } },
    });
    const wrapper = mount(ContractDepositReceiptInline, {
      props: {
        contractId: "contract-delete",
        financialRecordId: "payment-delete",
        receiptAmount: 100000,
        canManage: true,
        depositReceipt: {
          id: "deposit-delete",
          contractId: "contract-delete",
          financialRecordId: "payment-delete",
          fileId: "file-delete",
          fileName: "误传押金条.jpg",
          mimeType: "image/jpeg",
          ocrAmount: 10000,
          status: "recognized",
        },
      },
      global: { stubs: componentStubs },
    });

    const deleteButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "删除押金条");
    await deleteButton!.trigger("click");
    expect(wrapper.text()).toContain("确认删除这张误上传的押金条");
    expect(wrapper.text()).not.toContain("el-dialog");

    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "确认删除");
    await confirmButton!.trigger("click");
    await flushPromises();

    expect(api.delete).toHaveBeenCalledWith(
      "/api/contracts/contract-delete/financial-records/payment-delete/deposit-receipts/deposit-delete",
    );
    expect(wrapper.find(".upload-stub").exists()).toBe(true);
    expect(wrapper.emitted("removed")?.[0]).toEqual(["deposit-delete"]);
  });

  it("已验证押金必须填写原因后撤销，保留行内留痕并恢复上传入口", async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: "deposit-void",
          paymentRecordId: "payment-void",
          fileName: "错误押金条.jpg",
          status: "voided",
          confirmedAmount: 30000,
          voidedBy: "admin-void",
          voidedByName: "财务管理员",
          voidedAt: "2026-08-27T10:00:00.000Z",
          voidReason: "押金条关联错付款回单",
        },
      },
    });
    const wrapper = mount(ContractDepositReceiptInline, {
      props: {
        contractId: "contract-void",
        financialRecordId: "payment-void",
        receiptAmount: 100000,
        canManage: true,
        depositReceipt: {
          id: "deposit-void",
          contractId: "contract-void",
          financialRecordId: "payment-void",
          fileId: "file-void",
          fileName: "错误押金条.jpg",
          mimeType: "image/jpeg",
          verifiedAmount: 30000,
          status: "verified",
        },
      },
      global: { stubs: componentStubs },
    });

    const voidButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "撤销押金登记");
    await voidButton!.trigger("click");
    const confirmButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "确认撤销");
    expect(confirmButton!.attributes("disabled")).toBeDefined();

    await wrapper.find(".void-reason-input").setValue("押金条关联错付款回单");
    await confirmButton!.trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith(
      "/api/contracts/contract-void/financial-records/payment-void/deposit-receipts/deposit-void/void",
      { reason: "押金条关联错付款回单" },
    );
    expect(wrapper.text()).toContain("已撤销押金登记留痕");
    expect(wrapper.text()).toContain("财务管理员");
    expect(wrapper.text()).toContain("押金条关联错付款回单");
    expect(wrapper.find(".upload-stub").exists()).toBe(true);
  });

  it("押金条接口方法使用回单级资源地址", async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "deposit-api",
            paymentRecordId: "payment-api",
            status: "pending",
            ocrStatus: "recognized",
            recognizedAmount: 1200,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "deposit-api",
            paymentRecordId: "payment-api",
            status: "confirmed",
            confirmedAmount: 1200,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            id: "deposit-api",
            paymentRecordId: "payment-api",
            status: "voided",
            confirmedAmount: 1200,
            voidReason: "关联错误",
          },
        },
      });

    await uploadContractDepositReceipt(
      "contract-api",
      "payment-api",
      new File(["deposit"], "deposit.png", { type: "image/png" }),
    );
    await verifyContractDepositReceipt(
      "contract-api",
      "payment-api",
      "deposit-api",
      1200,
    );
    await deleteContractDepositReceipt(
      "contract-api",
      "payment-api",
      "deposit-pending-api",
    );
    await voidContractDepositReceipt(
      "contract-api",
      "payment-api",
      "deposit-api",
      "关联错误",
    );

    expect((api.post as jest.Mock).mock.calls[0][0]).toBe(
      "/api/contracts/contract-api/financial-records/payment-api/deposit-receipts",
    );
    expect((api.post as jest.Mock).mock.calls[1]).toEqual([
      "/api/contracts/contract-api/financial-records/payment-api/deposit-receipts/deposit-api/verify",
      { amount: 1200 },
    ]);
    expect(api.delete).toHaveBeenCalledWith(
      "/api/contracts/contract-api/financial-records/payment-api/deposit-receipts/deposit-pending-api",
    );
    expect((api.post as jest.Mock).mock.calls[2]).toEqual([
      "/api/contracts/contract-api/financial-records/payment-api/deposit-receipts/deposit-api/void",
      { reason: "关联错误" },
    ]);
  });
});
