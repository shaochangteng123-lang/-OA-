jest.mock("@/views/ContractDownloadRequestCenter.vue", () => ({
  __esModule: true,
  default: {
    props: { embedded: Boolean, centerMode: String },
    template:
      '<div class="download-task-center">下载待办-{{ centerMode }}</div>',
  },
}));
jest.mock("@/views/InvoiceApplicationCenter.vue", () => ({
  __esModule: true,
  default: {
    props: { embedded: Boolean, centerMode: String },
    template:
      '<div class="invoice-task-center">开票待办-{{ centerMode }}</div>',
  },
}));
jest.mock("@/utils/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { ElBadge, ElTabPane, ElTabs } from "element-plus";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/utils/api";
import AdminContractTasks from "@/views/AdminContractTasks.vue";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

function user(role: "admin" | "chairman") {
  return {
    id: `${role}-id`,
    name: role === "admin" ? "管理员" : "董事长",
    email: null,
    avatarUrl: null,
    role,
    status: "active" as const,
  };
}

async function setup(role: "admin" | "chairman") {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = user(role);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/contract-tasks", component: AdminContractTasks }],
  });
  await router.push("/contract-tasks");
  await router.isReady();
  const wrapper = mount(AdminContractTasks, {
    global: {
      plugins: [pinia, router],
      components: { ElBadge, ElTabs, ElTabPane },
    },
  });
  return { wrapper, router };
}

describe("管理员合同待办聚合页", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({
        data: {
          success: true,
          data: url.includes("contract-download-requests")
            ? { executorPending: 2 }
            : { adminPending: 4 },
        },
      }),
    );
  });

  it("使用与员工我的申请一致的顶部文字页签和蓝色下划线", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(
        process.cwd(),
        "src/views/AdminContractTasks.vue",
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

  it("普通管理员按需切换合同下载与开票用印待办并强制管理员模式", async () => {
    const { wrapper, router } = await setup("admin");
    await flushPromises();
    expect(wrapper.findAll(".task-tab-label")[0].text()).toContain(
      "合同下载待办 2",
    );
    expect(wrapper.findAll(".task-tab-label")[1].text()).toContain(
      "开票与用印待办 4",
    );
    expect(wrapper.find(".download-task-center").text()).toContain("admin");
    expect(wrapper.find(".invoice-task-center").exists()).toBe(false);

    await wrapper.findAll(".el-tabs__item")[1].trigger("click");
    await flushPromises();
    await nextTick();
    expect(router.currentRoute.value.query.tab).toBe("invoice");
    expect(wrapper.find(".download-task-center").exists()).toBe(false);
    expect(wrapper.find(".invoice-task-center").text()).toContain("admin");
    wrapper.unmount();
  });

  it("董事长沿用原权限只显示开票与用印待办", async () => {
    const { wrapper } = await setup("chairman");
    expect(wrapper.find(".task-tabs").exists()).toBe(true);
    expect(wrapper.findAll(".el-tabs__item")).toHaveLength(1);
    await flushPromises();
    expect(wrapper.find(".el-tabs__item").text()).toContain("开票与用印待办 4");
    expect(wrapper.find(".download-task-center").exists()).toBe(false);
    expect(wrapper.find(".invoice-task-center").text()).toContain("admin");
    wrapper.unmount();
  });
});
