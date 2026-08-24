jest.mock("@/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));
jest.mock(
  "@/components/contracts/ContractDownloadApplicationApprovalPreview.vue",
  () => ({
    __esModule: true,
    default: { template: '<div class="approval-preview" />' },
  }),
);
jest.mock(
  "@/components/contracts/ContractDownloadRequestReadonlyDetails.vue",
  () => ({
    __esModule: true,
    default: { template: '<div class="readonly-details">只读详情</div>' },
  }),
);
jest.mock("@/components/contracts/ContractReadOnlyPreview.vue", () => ({
  __esModule: true,
  default: { template: '<div class="readonly-preview" />' },
}));

import { nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { ElTable, ElTableColumn } from "element-plus";
import { api } from "@/utils/api";
import ContractDownloadRequestCenter from "@/views/ContractDownloadRequestCenter.vue";

const { flushPromises, mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

function request(id: string, index: number) {
  return {
    id,
    chainId: `chain-${id}`,
    previousRequestId: null,
    attemptNo: index,
    requestNo: `HTXZ-20260819-00000${index}`,
    contractId: `contract-${id}`,
    contractNo: `HT-${index}`,
    contractName: `第${index}份合同`,
    contractArea: "朝阳区",
    contractStatus: "effective",
    purpose: `用途${index}`,
    status: "approved",
    applicant: {
      id: `employee-${index}`,
      name: `员工${index}`,
      position: "员工",
      label: `员工 员工${index}`,
    },
    approver: {
      id: "manager-1",
      name: "总经理",
      position: "总经理",
      label: "总经理 总经理",
      decidedAt: `2026-08-19T0${index}:00:00.000Z`,
      comment: `批准意见${index}`,
    },
    executor: {
      id: "admin-1",
      name: "管理员",
      position: "管理员",
      label: "管理员 管理员",
      completedAt: null,
      note: null,
    },
    files: [],
    applicationFileName: `申请单${index}.pdf`,
    nextStep: "管理员执行下载",
    workflow: [],
    auditLogs: [],
    chainHistory: [],
    canWithdraw: false,
    canResubmit: false,
    createdAt: `2026-08-19T0${index}:00:00.000Z`,
    updatedAt: `2026-08-19T0${index}:00:00.000Z`,
    version: 1,
  };
}

const elementStubs = {
  ContractDownloadApplicationApprovalPreview: true,
  ContractDownloadRequestReadonlyDetails: {
    template: '<div class="readonly-details">只读详情</div>',
  },
  ContractReadOnlyPreview: true,
  ElAlert: { template: "<div><slot /></div>" },
  ElButton: { template: "<button @click=\"$emit('click')\"><slot /></button>" },
  ElDialog: { template: "<div><slot /><slot name='footer' /></div>" },
  ElEmpty: { template: "<div><slot /></div>" },
  ElForm: { template: "<form><slot /></form>" },
  ElFormItem: { template: "<label><slot /></label>" },
  ElInput: { template: "<input />" },
  ElPagination: { template: "<div />" },
  ElTabs: { template: "<div><slot /></div>" },
  ElTabPane: { template: "<div />" },
  ElTag: { template: "<span><slot /></span>" },
};

describe("合同下载历史紧凑表格", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [request("a", 1), request("b", 2)],
          total: 12,
          page: 1,
          pageSize: 10,
        },
      },
    });
  });

  it("历史两行默认收起，展开另一行时只保留新行且分页序号连续", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/contract-download-requests/approval",
          name: "ContractDownloadRequestApproval",
          component: ContractDownloadRequestCenter,
        },
      ],
    });
    await router.push("/contract-download-requests/approval?view=history");
    await router.isReady();

    const wrapper = mount(ContractDownloadRequestCenter, {
      global: {
        plugins: [router],
        components: { ElTable, ElTableColumn },
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();
    await nextTick();

    const rows = wrapper.findAll("tr.el-table__row");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.findAll("td")[1].text())).toEqual(["1", "2"]);
    expect(wrapper.findAll(".el-table__expanded-cell")).toHaveLength(0);

    let expandButtons = wrapper.findAll(".el-table__expand-icon");
    expect(expandButtons).toHaveLength(2);
    await expandButtons[0].trigger("click");
    await nextTick();
    expect(wrapper.findAll(".el-table__expanded-cell")).toHaveLength(1);
    expect(
      wrapper.findAll('.el-table__expand-icon[aria-expanded="true"]'),
    ).toHaveLength(1);

    expandButtons = wrapper.findAll(".el-table__expand-icon");
    await expandButtons[1].trigger("click");
    await nextTick();
    expect(wrapper.findAll(".el-table__expanded-cell")).toHaveLength(1);
    expect(
      wrapper.findAll('.el-table__expand-icon[aria-expanded="true"]'),
    ).toHaveLength(1);
    expect(
      (wrapper.vm as unknown as { expandedHistoryRequestId: string })
        .expandedHistoryRequestId,
    ).toBe("b");
    expect(expandButtons[0].attributes("aria-expanded")).toBe("false");

    (
      wrapper.vm as unknown as { handlePageChange: (page: number) => void }
    ).handlePageChange(2);
    await flushPromises();
    await nextTick();
    expect(
      (
        wrapper.vm as unknown as { historyIndex: (index: number) => number }
      ).historyIndex(0),
    ).toBe(11);
    expect(
      wrapper
        .findAll("tr.el-table__row")
        .map((row) => row.findAll("td")[1].text()),
    ).toEqual(["11", "12"]);

    wrapper.unmount();
  });

  it("员工历史申请复用展开表格并请求员工历史范围", async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [request("a", 1), request("b", 2)].map((item, index) => ({
            ...item,
            status: "completed",
            executor: {
              ...item.executor,
              completedAt: `2026-08-19T1${index}:00:00.000Z`,
            },
            nextStep: null,
          })),
          total: 2,
          page: 1,
          pageSize: 10,
        },
      },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/contract-download-requests/mine",
          name: "ContractDownloadRequestMine",
          component: ContractDownloadRequestCenter,
        },
      ],
    });
    await router.push("/contract-download-requests/mine?view=history");
    await router.isReady();

    const wrapper = mount(ContractDownloadRequestCenter, {
      global: {
        plugins: [router],
        components: { ElTable, ElTableColumn },
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    });
    await flushPromises();
    await nextTick();

    expect(api.get).toHaveBeenCalledWith(
      "/api/contract-download-requests",
      expect.objectContaining({
        params: expect.objectContaining({ scope: "employee_history" }),
      }),
    );
    expect(wrapper.findAll("tr.el-table__row")).toHaveLength(2);
    expect(
      wrapper
        .findAll("tr.el-table__row")
        .map((row) => row.findAll("td")[1].text()),
    ).toEqual(["1", "2"]);
    expect(wrapper.text()).toContain("历史申请");
    expect(wrapper.text()).toContain("申请状态");

    wrapper.unmount();
  });

  it("下载列表返回前切走页签时不得把未展示结果标记已读", async () => {
    let resolveRequest:
      | ((value: {
          data: {
            success: boolean;
            data: {
              items: ReturnType<typeof request>[];
              total: number;
              page: number;
              pageSize: number;
            };
          };
        }) => void)
      | null = null;
    (api.get as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/contract-applications/mine",
          component: ContractDownloadRequestCenter,
        },
      ],
    });
    await router.push("/contract-applications/mine?tab=download");
    await router.isReady();
    const wrapper = mount(ContractDownloadRequestCenter, {
      props: { embedded: true },
      global: {
        plugins: [router],
        components: { ElTable, ElTableColumn },
        stubs: elementStubs,
        directives: { loading: () => undefined },
      },
    });
    wrapper.unmount();
    resolveRequest?.({
      data: {
        success: true,
        data: {
          items: [{ ...request("late", 1), status: "completed" }],
          total: 1,
          page: 1,
          pageSize: 10,
        },
      },
    });
    await flushPromises();
    expect(api.post).not.toHaveBeenCalledWith(
      "/api/contract-download-requests/notifications/acknowledge",
      expect.anything(),
    );
  });
});
