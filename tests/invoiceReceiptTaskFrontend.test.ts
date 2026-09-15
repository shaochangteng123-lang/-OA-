jest.mock("@/utils/api", () => ({
  api: { get: jest.fn() },
}));

import fs from "fs";
import path from "path";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { api } from "@/utils/api";
import InvoiceReceiptTaskCenter from "@/views/InvoiceReceiptTaskCenter.vue";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const elementStubs = {
  ElAlert: {
    props: ["title", "description"],
    template: "<div>{{ title }} {{ description }}<slot /></div>",
  },
  ElButton: { template: "<button><slot /></button>" },
  ElEmpty: {
    props: ["description"],
    template: "<div>{{ description }}<slot /></div>",
  },
  ElInput: { template: "<input />" },
  ElPagination: { template: "<div />" },
  ElTag: { template: "<span><slot /></span>" },
};

describe("管理员待上传回单页面", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            {
              registrationId: "registration-1",
              contractId: "contract-1",
              contractNo: "HT-001",
              businessContractNo: "YW-001",
              contractTitle: "测试合同",
              projectName: "测试项目",
              partyA: "测试甲方",
              area: "海淀区",
              applicationCount: 1,
              applicationNumbers: ["KP-001"],
              invoiceCount: 2,
              invoiceAmount: 100,
              matchedReceiptAmount: 30,
              pendingReceiptAmount: 70,
              earliestInvoiceDate: "2026-09-01",
              waitingDays: 14,
              receiptStatus: "partial",
              invoices: [
                {
                  id: "invoice-1",
                  invoiceNo: "FP-001",
                  invoiceDate: "2026-09-01",
                  amount: 100,
                  applicationAmount: 100,
                  matchedReceiptAmount: 30,
                  pendingReceiptAmount: 70,
                  itemName: "咨询服务",
                },
              ],
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
        },
      },
    });
  });

  it("展示当前登记差额并携带精确登记编号进入回单上传", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/receipt-test", component: InvoiceReceiptTaskCenter },
        { path: "/contracts/:id", component: { template: "<div />" } },
      ],
    });
    await router.push("/receipt-test");
    await router.isReady();
    const wrapper = mount(InvoiceReceiptTaskCenter, {
      global: {
        plugins: [createPinia(), router],
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("测试项目");
    expect(wrapper.text()).toContain("当前登记部分回款");
    expect(wrapper.text()).toContain("¥100.00");
    expect(wrapper.text()).toContain("¥30.00");
    expect(wrapper.text()).toContain("¥70.00");
    expect(wrapper.text()).toContain("FP-001");

    const action = wrapper
      .findAll("button")
      .find((button) => button.text().includes("前往本合同财务登记上传回单"));
    expect(action).toBeDefined();
    await action!.trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/contracts/contract-1");
    expect(router.currentRoute.value.query).toMatchObject({
      tab: "finance",
      action: "record",
      recordType: "receipt",
      registrationId: "registration-1",
      from: "contract-tasks",
      fromTab: "receipt",
    });
    wrapper.unmount();
  });

  it("窄屏下将金额和操作区收为单列", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/views/InvoiceReceiptTaskCenter.vue"),
      "utf8",
    );
    expect(source).toContain("@media (max-width: 800px)");
    expect(source).toContain("@media (max-width: 480px)");
    expect(source).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.amount-grid\s*\{[\s\S]*?grid-template-columns: 1fr;/,
    );
    expect(source).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.receipt-task footer \.el-button\s*\{[\s\S]*?width: 100%;/,
    );
  });

  it("加载失败时保留错误状态且不显示假空结果", async () => {
    (api.get as jest.Mock).mockRejectedValueOnce(new Error("接口不可用"));
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/receipt-test", component: InvoiceReceiptTaskCenter }],
    });
    await router.push("/receipt-test");
    await router.isReady();
    const wrapper = mount(InvoiceReceiptTaskCenter, {
      global: {
        plugins: [createPinia(), router],
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();

    expect(wrapper.find(".load-error").exists()).toBe(true);
    expect(wrapper.text()).toContain("接口不可用");
    expect(wrapper.text()).not.toContain("当前没有待上传回单的合同");
    wrapper.unmount();
  });
});
