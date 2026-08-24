jest.mock("@/views/ContractDownloadRequestCenter.vue", () => ({
  __esModule: true,
  default: {
    name: "ContractDownloadRequestCenter",
    props: { embedded: Boolean },
    template: '<div class="download-center">下载申请</div>',
  },
}));
jest.mock("@/views/InvoiceApplicationCenter.vue", () => ({
  __esModule: true,
  default: {
    name: "InvoiceApplicationCenter",
    props: { embedded: Boolean },
    template: '<div class="invoice-center">开票及用印申请</div>',
  },
}));

import { nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { ElTabPane, ElTabs } from "element-plus";
import MyContractApplications from "@/views/MyContractApplications.vue";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

describe("员工我的申请聚合页", () => {
  it("使用顶部文字页签和蓝色下划线，不展示大标题卡或大块分段按钮", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(
        process.cwd(),
        "src/views/MyContractApplications.vue",
      ),
      "utf8",
    );
    expect(source).not.toContain('class="page-heading"');
    expect(source).toContain("<el-tabs");
    expect(source).toContain(".el-tabs__active-bar");
    expect(source).toContain("transform 0.3s");
    expect(source).toContain("background: #409eff");
    expect(source).not.toContain("button.active::after");
  });

  it("默认只挂载下载申请，切换后只挂载开票及用印申请", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/contract-applications/mine",
          component: MyContractApplications,
        },
        { path: "/contracts", component: { template: "<div />" } },
      ],
    });
    await router.push("/contract-applications/mine");
    await router.isReady();
    const wrapper = mount(MyContractApplications, {
      global: {
        plugins: [router],
        components: { ElTabs, ElTabPane },
      },
    });
    expect(wrapper.find(".download-center").exists()).toBe(true);
    expect(wrapper.find(".invoice-center").exists()).toBe(false);

    await wrapper.findAll(".el-tabs__item")[1].trigger("click");
    await flushPromises();
    await nextTick();
    expect(router.currentRoute.value.query.tab).toBe("invoice");
    expect(wrapper.find(".download-center").exists()).toBe(false);
    expect(wrapper.find(".invoice-center").exists()).toBe(true);
    wrapper.unmount();
  });

  it("直接进入开票页签时不挂载下载申请组件", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/contract-applications/mine",
          component: MyContractApplications,
        },
        { path: "/contracts", component: { template: "<div />" } },
      ],
    });
    await router.push("/contract-applications/mine?tab=invoice");
    await router.isReady();
    const wrapper = mount(MyContractApplications, {
      global: {
        plugins: [router],
        components: { ElTabs, ElTabPane },
      },
    });
    expect(wrapper.find(".download-center").exists()).toBe(false);
    expect(wrapper.find(".invoice-center").exists()).toBe(true);
    wrapper.unmount();
  });
});
