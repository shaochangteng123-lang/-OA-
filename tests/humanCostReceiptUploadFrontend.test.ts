const mockGetReceipts = jest.fn();
const mockUploadReceipts = jest.fn();
jest.mock("@/utils/payrollApi", () => ({
  getPayroll: jest.fn().mockResolvedValue({ list: [], totals: {} }),
  getHumanCostReceipts: (...args: unknown[]) => mockGetReceipts(...args),
  uploadHumanCostReceipts: (...args: unknown[]) => mockUploadReceipts(...args),
  getHumanCostReceiptPreviewUrl: (id: string) => `/测试回单/${id}`,
}));
jest.mock("element-plus", () => ({
  ElMessage: {
    info: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
  ElMessageBox: {},
}));

import HumanCostPanel from "@/components/payroll/HumanCostPanel.vue";
const { shallowMount, flushPromises } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

function summary(category: string, amounts: string[]) {
  return {
    list: amounts.map((amount, index) => ({
      id: `回单${index}`,
      category,
      file_name: `回单${index}.png`,
      recognized_amount: amount,
      recognition_status: "recognized",
      recognized_item_count: 1,
      total_item_count: 1,
    })),
    totals: {
      social_security: "0.00",
      housing_fund: "0.00",
      income_tax: "0.00",
      net_salary: "0.00",
      [category]: (
        amounts.reduce(
          (sum, amount) => sum + Math.round(Number(amount) * 100),
          0,
        ) / 100
      ).toFixed(2),
    },
    processing_count: 0,
    monthly_salary_bank: null,
    tax_detail: null,
  };
}

describe("社保、公积金多张回单上传", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(["social_security", "housing_fund"])(
    "%s 已有回单仍能一次追加两张，并显示累计总额",
    async (category) => {
      mockGetReceipts.mockResolvedValue(summary(category, ["100.10"]));
      mockUploadReceipts.mockResolvedValue(
        summary(category, ["100.10", "200.20", "300.30"]),
      );
      const wrapper = shallowMount(HumanCostPanel, {
        global: {
          directives: { loading: {} },
          stubs: { ElTable: true, ElTableColumn: true, ElDialog: true },
        },
      });
      try {
        await flushPromises();
        const card = wrapper.get(`.receipt-category-card--${category}`);
        const input = card.get('input[type="file"]');
        expect(input.attributes("disabled")).toBeUndefined();
        expect(input.attributes("multiple")).toBeDefined();
        const files = [
          new File(["图片一"], "追加一.png", { type: "image/png" }),
          new File(["图片二"], "追加二.png", { type: "image/png" }),
        ];
        Object.defineProperty(input.element, "files", {
          configurable: true,
          value: files,
        });
        await input.trigger("change");
        await flushPromises();
        expect(mockUploadReceipts).toHaveBeenCalledWith(
          expect.any(String),
          category,
          files,
        );
        expect(card.text()).toContain("600.60");
        expect(card.findAll(".receipt-file-item")).toHaveLength(3);
        expect(input.attributes("disabled")).toBeUndefined();
      } finally {
        wrapper.unmount();
      }
    },
  );

  it.each(["income_tax", "net_salary"])(
    "%s 保持现有上传锁定规则",
    async (category) => {
      mockGetReceipts.mockResolvedValue(summary(category, ["100.10"]));
      const wrapper = shallowMount(HumanCostPanel, {
        global: {
          directives: { loading: {} },
          stubs: { ElTable: true, ElTableColumn: true, ElDialog: true },
        },
      });
      try {
        await flushPromises();
        expect(
          wrapper
            .get(`.receipt-category-card--${category} input[type="file"]`)
            .attributes("disabled"),
        ).toBeDefined();
      } finally {
        wrapper.unmount();
      }
    },
  );
});
