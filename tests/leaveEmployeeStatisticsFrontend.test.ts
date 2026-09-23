jest.mock("../src/utils/api", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock("../src/utils/leaveApi", () => ({
  getPendingRequests: jest.fn().mockResolvedValue([]),
  getReviewedRequests: jest.fn().mockResolvedValue({
    list: [],
    total: 0,
    page: 1,
    pageSize: 10,
  }),
  getLeaveEmployeeStatistics: jest.fn(),
  approveRequest: jest.fn(),
  rejectRequest: jest.fn(),
  getRequestDetail: jest.fn(),
}));

jest.mock("../src/components/leave/LeaveApprovalTimeline.vue", () => ({
  __esModule: true,
  default: {
    name: "LeaveApprovalTimeline",
    template: "<div />",
  },
}));

import { createPinia, setActivePinia } from "pinia";
import fs from "fs";
import path from "path";
import LeavePendingList from "../src/components/leave/LeavePendingList.vue";
import { useAuthStore } from "../src/stores/auth";
import { getLeaveEmployeeStatistics, getReviewedRequests } from "../src/utils/leaveApi";
import { api } from "../src/utils/api";
import type {
  LeaveEmployeeStatisticsItem,
  LeaveEmployeeStatisticsResponse,
  LeaveReviewHistoryItem,
  LeaveReviewHistoryResponse,
} from "../src/utils/leaveApi";
import type { UserRole } from "../src/types";

const { mount, flushPromises } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const globalStubs = {
  "el-tabs": { template: "<div><slot /></div>" },
  "el-tab-pane": {
    props: ["name"],
    template:
      '<section :data-name="name"><slot name="label" /><slot /></section>',
  },
  "el-input": {
    props: ["modelValue"],
    emits: ["update:modelValue"],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  "el-option": true,
  "el-select": { template: "<div><slot /></div>" },
  "el-button": { template: "<button><slot /></button>" },
  "el-tooltip": { template: "<span><slot /></span>" },
  "el-icon": true,
  "el-avatar": true,
  "el-table": { template: '<div><slot name="empty" /></div>' },
  "el-table-column": true,
  "el-tag": { template: "<span><slot /></span>" },
  "el-empty": true,
  "el-pagination": true,
  "el-alert": { template: "<aside><slot /></aside>" },
  "el-dialog": true,
  "el-drawer": true,
  "el-skeleton": true,
};

function createUser(role: UserRole) {
  return {
    id: `${role}-id`,
    name: role === "general_manager" ? "总经理" : role === "super_admin" ? "超级管理员" : "其他角色",
    email: null,
    avatarUrl: null,
    role,
    status: "active" as const,
  };
}

function createMonthlyTrend(
  year: number,
  approvedRequestCount: number,
  approvedLeaveDays: number,
): LeaveEmployeeStatisticsItem["monthlyTrend"] {
  return Array.from({ length: 12 }, (_, index) => ({
    month: `${year}-${String(index + 1).padStart(2, "0")}`,
    approvedRequestCount: index === 2 ? approvedRequestCount : 0,
    approvedLeaveDays: index === 2 ? approvedLeaveDays : 0,
    typeSummaries:
      index === 2 && (approvedRequestCount > 0 || approvedLeaveDays > 0)
        ? [
            {
              leaveTypeCode: "annual",
              leaveTypeName: "年假",
              requestCount: approvedRequestCount,
              totalDays: approvedLeaveDays,
            },
          ]
        : [],
  }));
}

function createEmployee(
  overrides: Partial<LeaveEmployeeStatisticsItem>,
): LeaveEmployeeStatisticsItem {
  const currentYear = new Date().getFullYear();
  return {
    rank: 1,
    userId: "employee-1",
    name: "员工甲",
    department: "项目部",
    approvedRequestCount: 2,
    approvedLeaveDays: 4,
    paidLeaveTotalDays: 10,
    paidLeaveUsedDays: 4,
    paidLeavePendingDays: 1,
    paidLeaveRemainingDays: 5,
    annualTrend: [
      {
        year: currentYear - 1,
        approvedRequestCount: 1,
        approvedLeaveDays: 2,
      },
      {
        year: currentYear,
        approvedRequestCount: 2,
        approvedLeaveDays: 4,
      },
    ],
    monthlyTrend: createMonthlyTrend(currentYear, 2, 4),
    typeSummaries: [
      {
        leaveTypeCode: "annual",
        leaveTypeName: "年假",
        requestCount: 2,
        totalDays: 4,
      },
    ],
    balanceSummaries: [
      {
        leaveTypeCode: "annual",
        leaveTypeName: "年假",
        requiresBalanceCheck: true,
        unlimited: false,
        totalDays: 10,
        usedDays: 4,
        pendingDays: 1,
        remainingDays: 5,
      },
      {
        leaveTypeCode: "sick",
        leaveTypeName: "病假",
        requiresBalanceCheck: false,
        unlimited: true,
        totalDays: null,
        usedDays: null,
        pendingDays: null,
        remainingDays: null,
      },
    ],
    requests: [
      {
        id: "request-1",
        requestNo: "QJ-2026-00001",
        applicationKind: "normal",
        parentRequestId: null,
        status: "approved",
        startDate: "2026-03-02",
        startHalf: "morning",
        endDate: "2026-03-05",
        endHalf: "afternoon",
        totalDays: 4,
        reason: "年假",
        submittedAt: "2026-02-20T08:00:00.000Z",
        approvedAt: "2026-02-21T08:00:00.000Z",
        segments: [
          {
            id: "request-1",
            requestNo: "QJ-2026-00001",
            leaveTypeCode: "annual",
            leaveTypeName: "年假",
            startDate: "2026-03-02",
            startHalf: "morning",
            endDate: "2026-03-05",
            endHalf: "afternoon",
            totalDays: 4,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createStatisticsResponse(): LeaveEmployeeStatisticsResponse {
  const currentYear = new Date().getFullYear();
  return {
    year: currentYear,
    generatedAt: "2026-09-18T08:00:00.000Z",
    manager: {
      id: "general_manager-id",
      name: "王总经理",
      roleLabel: "总经理",
    },
    summary: {
      employeeCount: 3,
      approvedRequestCount: 8,
      approvedLeaveDays: 15,
    },
    annualComparison: [
      {
        year: currentYear - 4,
        employeeCount: 2,
        approvedRequestCount: 2,
        approvedLeaveDays: 4,
      },
      {
        year: currentYear - 3,
        employeeCount: 3,
        approvedRequestCount: 4,
        approvedLeaveDays: 7,
      },
      {
        year: currentYear - 2,
        employeeCount: 3,
        approvedRequestCount: 5,
        approvedLeaveDays: 9,
      },
      {
        year: currentYear - 1,
        employeeCount: 3,
        approvedRequestCount: 6,
        approvedLeaveDays: 11,
      },
      {
        year: currentYear,
        employeeCount: 3,
        approvedRequestCount: 8,
        approvedLeaveDays: 15,
      },
    ],
    monthlyComparison: Array.from({ length: 12 }, (_, index) => ({
      month: `${currentYear}-${String(index + 1).padStart(2, "0")}`,
      approvedRequestCount: index === 2 ? 8 : 0,
      approvedLeaveDays: index === 2 ? 15 : 0,
    })),
    employees: [
      createEmployee({
        userId: "employee-a",
        name: "员工甲",
        department: "项目部",
        approvedRequestCount: 2,
        approvedLeaveDays: 8,
        monthlyTrend: createMonthlyTrend(currentYear, 2, 8),
        annualTrend: [
          {
            year: currentYear - 1,
            approvedRequestCount: 1,
            approvedLeaveDays: 3,
          },
          {
            year: currentYear,
            approvedRequestCount: 2,
            approvedLeaveDays: 8,
          },
        ],
      }),
      createEmployee({
        userId: "employee-c",
        name: "员工丙",
        department: "综合部",
        approvedRequestCount: 3,
        approvedLeaveDays: 2,
        monthlyTrend: createMonthlyTrend(currentYear, 3, 2),
        annualTrend: [
          {
            year: currentYear - 1,
            approvedRequestCount: 2,
            approvedLeaveDays: 4,
          },
          {
            year: currentYear,
            approvedRequestCount: 3,
            approvedLeaveDays: 2,
          },
        ],
      }),
      createEmployee({
        userId: "employee-b",
        name: "员工乙",
        department: "项目部",
        approvedRequestCount: 3,
        approvedLeaveDays: 5,
        monthlyTrend: createMonthlyTrend(currentYear, 3, 5),
        annualTrend: [
          {
            year: currentYear - 1,
            approvedRequestCount: 3,
            approvedLeaveDays: 4,
          },
          {
            year: currentYear,
            approvedRequestCount: 3,
            approvedLeaveDays: 5,
          },
        ],
      }),
    ],
  };
}

function mountComponent(role: UserRole) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().user = createUser(role);
  return mount(LeavePendingList, {
    global: {
      plugins: [pinia],
      stubs: globalStubs,
      directives: { loading: () => undefined },
    },
  });
}

function createReviewHistoryRow(name: string): LeaveReviewHistoryItem {
  return {
    id: `history-${name}`, request_no: "QJ-2026-00002", user_id: `user-${name}`,
    applicant_name: name, applicant_department: "行政部",
    leave_type_code: "sick", leave_type_name: "病假",
    start_date: "2026-01-27", start_half: "morning",
    end_date: "2026-01-29", end_half: "afternoon", total_days: 3,
    reason: "历史请假记录导入", status: "approved",
    approver_id: "general_manager-id", approver_name: "总经理",
    reject_reason: null, approved_at: "2026-09-18T10:00:00.000Z",
    rejected_at: null, cancelled_at: null, submitted_at: "2026-09-18T10:00:00.000Z",
    version: 1, original_id: null, application_kind: "supplement",
    combination_group_id: null, parent_request_id: null,
    created_at: "2026-09-18T10:00:00.000Z", updated_at: "2026-09-18T10:00:00.000Z",
    review_action: "historical_import", review_comment: null,
    reviewed_at: "2026-09-18T10:00:00.000Z",
  };
}

describe("总经理审批记录搜索", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    (getReviewedRequests as jest.Mock).mockReset().mockResolvedValue({
      list: [], total: 0, page: 1, pageSize: 10,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("两个审批页签保留搜索和刷新，同时移除总经理概览区域", async () => {
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as { activeTab: string };
    expect(wrapper.find('.leave-toolbar input[aria-label="搜索待审批申请"]').exists()).toBe(true);
    expect(wrapper.find('.leave-toolbar button[aria-label="刷新当前列表"]').exists()).toBe(true);
    expect(wrapper.find(".toolbar-heading").exists()).toBe(false);
    expect(wrapper.find(".leave-metrics").exists()).toBe(false);
    vm.activeTab = "history";
    await flushPromises();
    expect(wrapper.find('.leave-toolbar input[aria-label="搜索审批记录"]').exists()).toBe(true);
    expect(wrapper.find(".toolbar-heading").exists()).toBe(false);
    expect(wrapper.find(".leave-metrics").exists()).toBe(false);
    wrapper.unmount();
  });

  it("搜索跨页调用服务端并回第一页，清空后恢复记录", async () => {
    const record = createReviewHistoryRow("吴静雯");
    (getReviewedRequests as jest.Mock)
      .mockResolvedValueOnce({ list: [record], total: 21, page: 3, pageSize: 10 })
      .mockResolvedValueOnce({ list: [record], total: 11, page: 1, pageSize: 10 })
      .mockResolvedValueOnce({ list: [record], total: 11, page: 2, pageSize: 10 })
      .mockResolvedValueOnce({ list: [record], total: 21, page: 1, pageSize: 10 });
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      activeTab: string; historyPage: number; historyTotal: number;
      historyList: LeaveReviewHistoryItem[]; fetchHistory: (page?: number) => Promise<void>;
    };
    vm.activeTab = "history";
    await vm.fetchHistory(3);
    await flushPromises();
    const input = wrapper.get('input[aria-label="搜索审批记录"]');
    await input.setValue("  吴静雯  ");
    expect(vm.historyPage).toBe(1);
    expect(vm.historyList).toEqual([]);
    jest.advanceTimersByTime(299);
    expect(getReviewedRequests).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(getReviewedRequests).toHaveBeenLastCalledWith({ page: 1, pageSize: 10, keyword: "吴静雯" });
    expect(vm.historyTotal).toBe(11);
    expect(vm.historyList[0].review_action).toBe("historical_import");
    await vm.fetchHistory(2);
    expect(getReviewedRequests).toHaveBeenLastCalledWith({ page: 2, pageSize: 10, keyword: "吴静雯" });
    await input.setValue("");
    await flushPromises();
    expect(getReviewedRequests).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 });
    expect(vm.historyTotal).toBe(21);
    wrapper.unmount();
  });

  it("回车立即搜索，较晚返回的旧查询不会覆盖新结果", async () => {
    let resolveOld!: (response: LeaveReviewHistoryResponse) => void;
    const latest = createReviewHistoryRow("曹鸿浩");
    (getReviewedRequests as jest.Mock)
      .mockImplementationOnce(() => new Promise<LeaveReviewHistoryResponse>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ list: [latest], total: 1, page: 1, pageSize: 10 });
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      activeTab: string; historyList: LeaveReviewHistoryItem[]; historyTotal: number;
      historyLoading: boolean;
    };
    vm.activeTab = "history";
    await flushPromises();
    const input = wrapper.get('input[aria-label="搜索审批记录"]');
    await input.setValue("吴静雯");
    jest.advanceTimersByTime(300);
    await input.setValue("曹鸿浩");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(vm.historyList).toEqual([latest]);
    resolveOld({ list: [createReviewHistoryRow("吴静雯")], total: 5, page: 1, pageSize: 10 });
    await flushPromises();
    jest.advanceTimersByTime(300);
    expect(getReviewedRequests).toHaveBeenCalledTimes(2);
    expect(vm.historyList).toEqual([latest]);
    expect(vm.historyTotal).toBe(1);
    expect(vm.historyLoading).toBe(false);
    wrapper.unmount();
  });

  it("接口调用保留审批记录关键词与分页参数", async () => {
    const response = { list: [], total: 0, page: 2, pageSize: 10 };
    (api.get as jest.Mock).mockResolvedValueOnce({ data: { data: response } });
    const actual = jest.requireActual("../src/utils/leaveApi") as typeof import("../src/utils/leaveApi");
    await expect(actual.getReviewedRequests({ keyword: "QJ-2026", page: 2, pageSize: 10 })).resolves.toEqual(response);
    expect(api.get).toHaveBeenCalledWith("/api/leave/reviewed", {
      params: { keyword: "QJ-2026", page: 2, pageSize: 10 },
    });
  });
});

describe("总经理员工请假统计页", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getLeaveEmployeeStatistics as jest.Mock).mockResolvedValue(
      createStatisticsResponse(),
    );
  });

  it.each(["general_manager", "super_admin"] as const)("%s 显示统计页签，且进入页签后才加载数据", async (role) => {
    const wrapper = mountComponent(role);
    await flushPromises();

    expect(wrapper.text()).toContain("员工请假统计");
    expect(getLeaveEmployeeStatistics).not.toHaveBeenCalled();

    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      canViewEmployeeStatistics: boolean;
    };
    expect(vm.canViewEmployeeStatistics).toBe(true);
    vm.handleTabChange("statistics");
    await flushPromises();

    expect(getLeaveEmployeeStatistics).toHaveBeenCalledWith(
      new Date().getFullYear(),
    );
    wrapper.unmount();
  });

  it.each(["chairman", "admin", "user", "boss", "guest"] as const)("%s 不获得员工统计查询能力", async (role) => {
    const chairmanWrapper = mountComponent(role);
    await flushPromises();
    expect(chairmanWrapper.text()).not.toContain("员工请假统计");

    const chairmanVm = chairmanWrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      canViewEmployeeStatistics: boolean;
    };
    expect(chairmanVm.canViewEmployeeStatistics).toBe(false);
    chairmanVm.handleTabChange("statistics");
    await flushPromises();
    expect(getLeaveEmployeeStatistics).not.toHaveBeenCalled();
    chairmanWrapper.unmount();
  });

  it("展示统计图表，顶部不展示负责人或请假次数最多摘要", async () => {
    const response = createStatisticsResponse();
    response.employees.push(
      createEmployee({
        userId: response.manager.id,
        name: response.manager.name,
        department: "管理层",
        approvedRequestCount: 1,
        approvedLeaveDays: 1,
      }),
    );
    (getLeaveEmployeeStatistics as jest.Mock).mockResolvedValueOnce(response);
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      activeTab: string;
      handleTabChange: (name: string) => void;
      filteredStatisticsEmployees: LeaveEmployeeStatisticsItem[];
      typeDistributionTotalDays: number;
      typeDistributionItems: Array<{ leaveTypeName: string }>;
    };

    vm.activeTab = "statistics";
    vm.handleTabChange("statistics");
    await flushPromises();

    expect(wrapper.find(".leave-toolbar").text()).not.toContain("王总经理");
    expect(wrapper.find(".leave-toolbar").text()).not.toContain("负责人");
    expect(wrapper.text()).not.toContain("总经理本人");
    expect(wrapper.text()).toContain("近五年请假趋势");
    expect(wrapper.text()).toContain("请假次数 / 天数");
    expect(wrapper.text()).not.toContain("展示筛选结果前");
    expect(wrapper.text()).toContain("假期类型分布");
    expect(wrapper.text()).not.toContain("请假次数最多");
    expect(wrapper.find(".annual-trend-chart svg").exists()).toBe(true);
    expect(wrapper.find(".employee-ranking-chart").exists()).toBe(true);
    expect(vm.filteredStatisticsEmployees[0]?.typeSummaries).toHaveLength(1);
    expect(vm.typeDistributionTotalDays).toBe(16);
    expect(vm.typeDistributionItems.map((item) => item.leaveTypeName)).toEqual([
      "年假",
    ]);
    expect(wrapper.find(".leave-type-donut svg").exists()).toBe(true);
    wrapper.unmount();
  });

  it("按批准次数、天数生成排名，并支持部门与员工关键词筛选", async () => {
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      rankedStatisticsEmployees: LeaveEmployeeStatisticsItem[];
      filteredStatisticsEmployees: LeaveEmployeeStatisticsItem[];
      statisticsDepartmentOptions: string[];
      statisticsDepartment: string;
      statisticsKeyword: string;
      statisticsSummary: {
        employeeCount: number;
        approvedRequestCount: number;
        approvedLeaveDays: number;
      };
      statisticsAnnualComparison: Array<{
        year: number;
        employeeCount: number;
        approvedRequestCount: number;
        approvedLeaveDays: number;
      }>;
    };

    vm.handleTabChange("statistics");
    await flushPromises();

    expect(vm.rankedStatisticsEmployees.map((item) => item.name)).toEqual([
      "员工乙",
      "员工丙",
      "员工甲",
    ]);
    expect(vm.rankedStatisticsEmployees.map((item) => item.rank)).toEqual([
      1, 2, 3,
    ]);
    expect(vm.statisticsDepartmentOptions).toEqual(["项目部", "综合部"]);
    expect(vm.statisticsSummary).toEqual({
      employeeCount: 3,
      approvedRequestCount: 8,
      approvedLeaveDays: 15,
    });

    vm.statisticsDepartment = "项目部";
    vm.statisticsKeyword = "甲";
    await flushPromises();
    expect(vm.filteredStatisticsEmployees.map((item) => item.name)).toEqual([
      "员工甲",
    ]);
    expect(vm.statisticsSummary).toEqual({
      employeeCount: 1,
      approvedRequestCount: 2,
      approvedLeaveDays: 8,
    });
    expect(vm.statisticsAnnualComparison.slice(-2)).toEqual([
      {
        year: new Date().getFullYear() - 1,
        employeeCount: 1,
        approvedRequestCount: 1,
        approvedLeaveDays: 3,
      },
      {
        year: new Date().getFullYear(),
        employeeCount: 1,
        approvedRequestCount: 2,
        approvedLeaveDays: 8,
      },
    ]);
    wrapper.unmount();
  });

  it("区分关联补假与独立返岗补假标签", async () => {
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      statisticsApplicationKindLabel: (
        request: LeaveEmployeeStatisticsItem["requests"][number],
      ) => string;
    };
    const request = createEmployee({}).requests[0];

    expect(
      vm.statisticsApplicationKindLabel({
        ...request,
        applicationKind: "supplement",
        parentRequestId: "parent-request",
      }),
    ).toBe("补假");
    expect(
      vm.statisticsApplicationKindLabel({
        ...request,
        applicationKind: "supplement",
        parentRequestId: null,
      }),
    ).toBe("返岗补假");
    wrapper.unmount();
  });

  it("审批记录将历史导入显示为中性状态", () => {
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      reviewActionLabel: (
        action: "approve" | "reject" | "historical_import",
      ) => string;
      reviewActionTagType: (
        action: "approve" | "reject" | "historical_import",
      ) => "success" | "danger" | "info";
    };

    expect(vm.reviewActionLabel("approve")).toBe("已通过");
    expect(vm.reviewActionLabel("reject")).toBe("已驳回");
    expect(vm.reviewActionLabel("historical_import")).toBe("历史导入");
    expect(vm.reviewActionTagType("historical_import")).toBe("info");
    wrapper.unmount();
  });

  it("加长年度趋势图，并支持鼠标与键盘打开当前年度明细", async () => {
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      annualTrendDetailYear: number | null;
      annualTrendDetailEmployees: LeaveEmployeeStatisticsItem[];
      closeAnnualTrendDetail: () => void;
    };

    vm.handleTabChange("statistics");
    await flushPromises();

    expect(wrapper.find(".annual-trend-chart svg").attributes("viewBox")).toBe(
      "0 0 1040 400",
    );
    const points = wrapper.findAll(".trend-point-action");
    expect(points).toHaveLength(10);
    expect(points.every((point) => point.attributes("role") === "button")).toBe(
      true,
    );
    expect(points.every((point) => point.attributes("tabindex") === "0")).toBe(
      true,
    );

    await points[points.length - 1].trigger("click");
    await flushPromises();
    expect(vm.annualTrendDetailYear).toBe(new Date().getFullYear());
    expect(vm.annualTrendDetailEmployees).toHaveLength(3);
    expect(getLeaveEmployeeStatistics).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".annual-trend-detail").text()).toContain(
      `${new Date().getFullYear()} 年员工请假明细`,
    );

    vm.closeAnnualTrendDetail();
    await points[points.length - 2].trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(vm.annualTrendDetailYear).toBe(new Date().getFullYear());
    expect(getLeaveEmployeeStatistics).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("顶部摘要区分加载状态与真实零值，筛选后同步汇总", async () => {
    let resolveStatistics!: (value: LeaveEmployeeStatisticsResponse) => void;
    (getLeaveEmployeeStatistics as jest.Mock).mockImplementationOnce(
      () => new Promise<LeaveEmployeeStatisticsResponse>((resolve) => {
        resolveStatistics = resolve;
      }),
    );
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      activeTab: string;
      statisticsKeyword: string;
      handleTabChange: (name: string) => void;
      fetchStatistics: () => Promise<void>;
    };
    vm.activeTab = "statistics";
    vm.handleTabChange("statistics");
    await flushPromises();
    const header = wrapper.find(".leave-toolbar");
    expect(header.text()).toContain("正在加载统计");
    expect(header.findAll(".statistics-inline-metric")).toHaveLength(0);

    resolveStatistics(createStatisticsResponse());
    await flushPromises();
    expect(header.findAll(".statistics-inline-metric strong").map((item) => item.text())).toEqual(["3", "8", "15"]);
    vm.statisticsKeyword = "甲";
    await flushPromises();
    expect(header.findAll(".statistics-inline-metric strong").map((item) => item.text())).toEqual(["1", "2", "8"]);
    vm.statisticsKeyword = "无匹配员工";
    await flushPromises();
    expect(header.findAll(".statistics-inline-metric strong").map((item) => item.text())).toEqual(["0", "0", "0"]);

    (getLeaveEmployeeStatistics as jest.Mock).mockRejectedValueOnce(new Error("统计不可用"));
    await vm.fetchStatistics();
    await flushPromises();
    expect(header.text()).toContain("统计数据加载失败");
    expect(header.findAll(".statistics-inline-metric")).toHaveLength(0);
    vm.activeTab = "history";
    await flushPromises();
    expect(header.find(".section-title").exists()).toBe(false);
    expect(header.find(".statistics-toolbar-summary").exists()).toBe(false);
    wrapper.unmount();
  });

  it("没有请假记录时年度与月度趋势仍显示完整零值图表", async () => {
    const response = createStatisticsResponse();
    response.summary = {
      employeeCount: response.employees.length,
      approvedRequestCount: 0,
      approvedLeaveDays: 0,
    };
    response.annualComparison = response.annualComparison.map((item) => ({
      ...item,
      approvedRequestCount: 0,
      approvedLeaveDays: 0,
    }));
    response.monthlyComparison = response.monthlyComparison.map((item) => ({
      ...item,
      approvedRequestCount: 0,
      approvedLeaveDays: 0,
    }));
    response.employees = response.employees.map((employee) => ({
      ...employee,
      approvedRequestCount: 0,
      approvedLeaveDays: 0,
      typeSummaries: [],
      requests: [],
      annualTrend: employee.annualTrend.map((item) => ({
        ...item,
        approvedRequestCount: 0,
        approvedLeaveDays: 0,
      })),
      monthlyTrend: employee.monthlyTrend.map((item) => ({
        ...item,
        approvedRequestCount: 0,
        approvedLeaveDays: 0,
        typeSummaries: [],
      })),
    }));
    (getLeaveEmployeeStatistics as jest.Mock).mockResolvedValueOnce(response);

    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      statisticsTrendMode: "annual" | "monthly";
      activeTrendChart: {
        points: Array<{
          approvedRequestCount: number;
          approvedLeaveDays: number;
        }>;
      };
      setStatisticsTrendMode: (mode: "annual" | "monthly") => void;
    };
    vm.handleTabChange("statistics");
    await flushPromises();

    expect(wrapper.find(".annual-trend-chart").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("暂无可对比的趋势数据");
    expect(vm.activeTrendChart.points).toHaveLength(5);
    expect(
      vm.activeTrendChart.points.every(
        (item) =>
          item.approvedRequestCount === 0 && item.approvedLeaveDays === 0,
      ),
    ).toBe(true);
    expect(wrapper.findAll(".trend-point-action")).toHaveLength(10);

    vm.setStatisticsTrendMode("monthly");
    await flushPromises();
    expect(vm.statisticsTrendMode).toBe("monthly");
    expect(vm.activeTrendChart.points).toHaveLength(12);
    expect(
      vm.activeTrendChart.points.every(
        (item) =>
          item.approvedRequestCount === 0 && item.approvedLeaveDays === 0,
      ),
    ).toBe(true);
    expect(wrapper.findAll(".trend-point-action")).toHaveLength(24);
    expect(wrapper.text()).not.toContain("暂无可对比的趋势数据");
    wrapper.unmount();
  });

  it("月度趋势展示十二个月并直接下钻员工与假期类型", async () => {
    const currentYear = new Date().getFullYear();
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      statisticsTrendMode: "annual" | "monthly";
      statisticsDepartment: string;
      statisticsKeyword: string;
      trendDetailMonth: string | null;
      activeTrendChart: {
        points: Array<{
          month: string | null;
          approvedRequestCount: number;
          approvedLeaveDays: number;
        }>;
      };
      annualTrendDetailEmployees: LeaveEmployeeStatisticsItem[];
      annualTrendDetailSummary: {
        employeeCount: number;
        approvedRequestCount: number;
        approvedLeaveDays: number;
      };
      setStatisticsTrendMode: (mode: "annual" | "monthly") => void;
    };
    vm.handleTabChange("statistics");
    await flushPromises();
    vm.statisticsDepartment = "项目部";
    vm.statisticsKeyword = "甲";
    vm.setStatisticsTrendMode("monthly");
    await flushPromises();

    expect(vm.statisticsTrendMode).toBe("monthly");
    expect(vm.activeTrendChart.points).toHaveLength(12);
    expect(wrapper.find(".statistics-chart-header h3").text()).toBe(
      `${currentYear} 年逐月请假趋势`,
    );
    expect(wrapper.findAll(".trend-point-action")).toHaveLength(24);
    const marchPoint = vm.activeTrendChart.points.find(
      (point) => point.month === `${currentYear}-03`,
    );
    expect(marchPoint).toMatchObject({
      approvedRequestCount: 2,
      approvedLeaveDays: 8,
    });

    await wrapper.findAll(".trend-point-action")[4].trigger("click");
    await flushPromises();
    expect(vm.trendDetailMonth).toBe(`${currentYear}-03`);
    expect(vm.annualTrendDetailEmployees.map((item) => item.name)).toEqual([
      "员工甲",
    ]);
    expect(vm.annualTrendDetailSummary).toEqual({
      employeeCount: 1,
      approvedRequestCount: 2,
      approvedLeaveDays: 8,
    });
    expect(wrapper.find(".annual-trend-detail").text()).toContain(
      `${currentYear} 年 3 月员工请假明细`,
    );
    const detailText = wrapper.find(".annual-trend-detail").text();
    expect(detailText).toContain("请假员工");
    expect(detailText).toContain("请假申请");
    expect(detailText).toContain("请假合计");
    expect(detailText).toContain("部门：项目部");
    expect(detailText).toContain("请假次数");
    expect(detailText).toContain("请假天数");
    expect(detailText).toContain("年假");
    expect(detailText).toContain("2 次，共 8 天");
    expect(getLeaveEmployeeStatistics).toHaveBeenCalledTimes(1);

    const componentSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/leave/LeavePendingList.vue"),
      "utf8",
    );
    expect(componentSource).toContain('v-for="tick in activeTrendChart.ticks"');
    wrapper.unmount();
  });

  it("员工次数与天数图展示全部筛选员工，不截断第十一名", async () => {
    const response = createStatisticsResponse();
    for (let index = 4; index <= 12; index += 1) {
      response.employees.push(
        createEmployee({
          userId: `employee-${index}`,
          name: `员工${String(index).padStart(2, "0")}`,
          department: "项目部",
          approvedRequestCount: 1,
          approvedLeaveDays: 1,
        }),
      );
    }
    (getLeaveEmployeeStatistics as jest.Mock).mockResolvedValueOnce(response);
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      employeeRankingChartItems: LeaveEmployeeStatisticsItem[];
    };
    vm.handleTabChange("statistics");
    await flushPromises();

    expect(vm.employeeRankingChartItems).toHaveLength(12);
    expect(wrapper.findAll(".employee-ranking-row")).toHaveLength(12);
    expect(wrapper.text()).toContain("员工11");
    wrapper.unmount();
  });

  it("员工年度统计明细的排名序号使用统一颜色", () => {
    const componentSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/leave/LeavePendingList.vue"),
      "utf8",
    );

    expect(componentSource).toContain('<span class="rank-badge">');
    expect(componentSource).not.toContain("`rank-${row.rank}`");
    expect(componentSource).not.toMatch(/\.rank-badge\.rank-[123]/);
  });

  it("历史年度明细按需加载并缓存，同时沿用筛选且排除零请假员工", async () => {
    const currentYear = new Date().getFullYear();
    const historicalYear = currentYear - 1;
    const currentResponse = createStatisticsResponse();
    currentResponse.employees.push(
      createEmployee({
        userId: "historical-zero",
        name: "员工甲零",
        department: "项目部",
        approvedRequestCount: 1,
        approvedLeaveDays: 1,
        annualTrend: [
          {
            year: historicalYear,
            approvedRequestCount: 0,
            approvedLeaveDays: 0,
          },
          {
            year: currentYear,
            approvedRequestCount: 1,
            approvedLeaveDays: 1,
          },
        ],
      }),
    );
    (getLeaveEmployeeStatistics as jest.Mock).mockResolvedValueOnce(
      currentResponse,
    );
    const historicalResponse: LeaveEmployeeStatisticsResponse = {
      ...createStatisticsResponse(),
      year: historicalYear,
      employees: [
        createEmployee({
          userId: "employee-a",
          name: "员工甲",
          department: "项目部",
          approvedRequestCount: 1,
          approvedLeaveDays: 3,
        }),
        createEmployee({
          userId: "employee-b",
          name: "员工乙",
          department: "项目部",
          approvedRequestCount: 2,
          approvedLeaveDays: 3,
        }),
        createEmployee({
          userId: "historical-only",
          name: "员工甲历史",
          department: "项目部",
          approvedRequestCount: 5,
          approvedLeaveDays: 8,
        }),
        createEmployee({
          userId: "historical-zero",
          name: "员工甲零",
          department: "项目部",
          approvedRequestCount: 0,
          approvedLeaveDays: 0,
          typeSummaries: [],
          requests: [],
        }),
      ],
    };
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      statisticsDepartment: string;
      statisticsKeyword: string;
      annualTrendDetailYear: number | null;
      annualTrendDetailEmployees: LeaveEmployeeStatisticsItem[];
      annualTrendDetailSummary: {
        employeeCount: number;
        approvedRequestCount: number;
        approvedLeaveDays: number;
      };
      openAnnualTrendDetail: (
        year: number,
        forceReload?: boolean,
      ) => Promise<void>;
      closeAnnualTrendDetail: () => void;
    };

    vm.handleTabChange("statistics");
    await flushPromises();
    (getLeaveEmployeeStatistics as jest.Mock).mockResolvedValueOnce(
      historicalResponse,
    );
    vm.statisticsDepartment = "项目部";
    vm.statisticsKeyword = "甲";

    await vm.openAnnualTrendDetail(historicalYear);
    await flushPromises();
    expect(getLeaveEmployeeStatistics).toHaveBeenLastCalledWith(historicalYear);
    expect(vm.annualTrendDetailEmployees.map((item) => item.name)).toEqual([
      "员工甲",
    ]);
    expect(vm.annualTrendDetailSummary).toEqual({
      employeeCount: 1,
      approvedRequestCount: 1,
      approvedLeaveDays: 3,
    });
    expect(wrapper.find(".annual-trend-detail").text()).toContain("年假");

    vm.closeAnnualTrendDetail();
    await vm.openAnnualTrendDetail(historicalYear);
    expect(getLeaveEmployeeStatistics).toHaveBeenCalledTimes(2);
    expect(vm.annualTrendDetailYear).toBe(historicalYear);
    wrapper.unmount();
  });

  it("年度下钻切换或关闭后不会被较早请求覆盖", async () => {
    const currentYear = new Date().getFullYear();
    let resolveOlder:
      | ((value: LeaveEmployeeStatisticsResponse) => void)
      | null = null;
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      annualTrendDetailYear: number | null;
      annualTrendDetailEmployees: LeaveEmployeeStatisticsItem[];
      openAnnualTrendDetail: (year: number) => Promise<void>;
      closeAnnualTrendDetail: () => void;
    };
    vm.handleTabChange("statistics");
    await flushPromises();

    (getLeaveEmployeeStatistics as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise<LeaveEmployeeStatisticsResponse>((resolve) => {
            resolveOlder = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...createStatisticsResponse(),
        year: currentYear - 2,
        employees: [createEmployee({ userId: "newer", name: "后选年度员工" })],
      });

    const olderRequest = vm.openAnnualTrendDetail(currentYear - 1, true);
    await vm.openAnnualTrendDetail(currentYear - 2, true);
    expect(vm.annualTrendDetailEmployees[0]?.name).toBe("后选年度员工");

    resolveOlder?.({
      ...createStatisticsResponse(),
      year: currentYear - 1,
      employees: [createEmployee({ userId: "older", name: "先选年度员工" })],
    });
    await olderRequest;
    expect(vm.annualTrendDetailYear).toBe(currentYear - 2);
    expect(vm.annualTrendDetailEmployees[0]?.name).toBe("后选年度员工");

    vm.closeAnnualTrendDetail();
    expect(vm.annualTrendDetailYear).toBeNull();
    expect(vm.annualTrendDetailEmployees).toEqual([]);
    wrapper.unmount();
  });

  it("年度下钻加载失败时可重试并恢复明细", async () => {
    const historicalYear = new Date().getFullYear() - 1;
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      annualTrendDetailData: LeaveEmployeeStatisticsResponse | null;
      annualTrendDetailLoading: boolean;
      annualTrendDetailError: string;
      openAnnualTrendDetail: (
        year: number,
        forceReload?: boolean,
      ) => Promise<void>;
      retryAnnualTrendDetail: () => void;
    };
    vm.handleTabChange("statistics");
    await flushPromises();

    (getLeaveEmployeeStatistics as jest.Mock).mockRejectedValueOnce({
      response: { data: { message: "历史数据暂不可用" } },
    });
    await vm.openAnnualTrendDetail(historicalYear, true);
    expect(vm.annualTrendDetailLoading).toBe(false);
    expect(vm.annualTrendDetailData).toBeNull();
    expect(vm.annualTrendDetailError).toBe("历史数据暂不可用");
    expect(wrapper.find(".annual-trend-detail-error").text()).toContain(
      "历史数据暂不可用",
    );

    (getLeaveEmployeeStatistics as jest.Mock).mockResolvedValueOnce({
      ...createStatisticsResponse(),
      year: historicalYear,
      employees: [
        createEmployee({ userId: "retry-success", name: "重试成功员工" }),
      ],
    });
    vm.retryAnnualTrendDetail();
    await flushPromises();
    expect(vm.annualTrendDetailError).toBe("");
    expect(vm.annualTrendDetailData?.year).toBe(historicalYear);
    expect(wrapper.find(".annual-trend-detail").text()).toContain(
      "重试成功员工",
    );
    wrapper.unmount();
  });

  it("工具栏与外层刷新都会清空缓存并同步刷新已展开的历史年度", async () => {
    const currentYear = new Date().getFullYear();
    const historicalYear = currentYear - 1;
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      activeTab: string;
      handleTabChange: (name: string) => void;
      annualTrendDetailEmployees: LeaveEmployeeStatisticsItem[];
      openAnnualTrendDetail: (year: number) => Promise<void>;
      refreshCurrent: () => Promise<void>;
      refreshAll: () => Promise<void>;
    };
    vm.handleTabChange("statistics");
    await flushPromises();

    (getLeaveEmployeeStatistics as jest.Mock).mockResolvedValueOnce({
      ...createStatisticsResponse(),
      year: historicalYear,
      employees: [
        createEmployee({ userId: "old-history", name: "刷新前员工" }),
      ],
    });
    await vm.openAnnualTrendDetail(historicalYear);
    expect(vm.annualTrendDetailEmployees[0]?.name).toBe("刷新前员工");

    (getLeaveEmployeeStatistics as jest.Mock)
      .mockResolvedValueOnce(createStatisticsResponse())
      .mockResolvedValueOnce({
        ...createStatisticsResponse(),
        year: historicalYear,
        employees: [
          createEmployee({ userId: "new-history", name: "刷新后员工" }),
        ],
      });
    vm.activeTab = "statistics";
    await vm.refreshCurrent();

    expect(
      (getLeaveEmployeeStatistics as jest.Mock).mock.calls.map(
        ([year]) => year,
      ),
    ).toEqual([currentYear, historicalYear, currentYear, historicalYear]);
    expect(vm.annualTrendDetailEmployees[0]?.name).toBe("刷新后员工");

    (getLeaveEmployeeStatistics as jest.Mock)
      .mockResolvedValueOnce(createStatisticsResponse())
      .mockResolvedValueOnce({
        ...createStatisticsResponse(),
        year: historicalYear,
        employees: [
          createEmployee({ userId: "outer-history", name: "外层刷新员工" }),
        ],
      });
    await vm.refreshAll();
    expect(
      (getLeaveEmployeeStatistics as jest.Mock).mock.calls.map(
        ([year]) => year,
      ),
    ).toEqual([
      currentYear,
      historicalYear,
      currentYear,
      historicalYear,
      currentYear,
      historicalYear,
    ]);
    expect(vm.annualTrendDetailEmployees[0]?.name).toBe("外层刷新员工");
    wrapper.unmount();
  });

  it("刷新等待期间关闭年度下钻后不会被旧刷新重新打开", async () => {
    const currentYear = new Date().getFullYear();
    const historicalYear = currentYear - 1;
    let resolveRefresh:
      | ((value: LeaveEmployeeStatisticsResponse) => void)
      | null = null;
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      activeTab: string;
      handleTabChange: (name: string) => void;
      annualTrendDetailYear: number | null;
      openAnnualTrendDetail: (year: number) => Promise<void>;
      closeAnnualTrendDetail: () => void;
      refreshCurrent: () => Promise<void>;
    };
    vm.handleTabChange("statistics");
    await flushPromises();
    (getLeaveEmployeeStatistics as jest.Mock).mockResolvedValueOnce({
      ...createStatisticsResponse(),
      year: historicalYear,
    });
    await vm.openAnnualTrendDetail(historicalYear);

    (getLeaveEmployeeStatistics as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<LeaveEmployeeStatisticsResponse>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    vm.activeTab = "statistics";
    const refreshPromise = vm.refreshCurrent();
    vm.closeAnnualTrendDetail();
    resolveRefresh?.(createStatisticsResponse());
    await refreshPromise;
    await flushPromises();

    expect(vm.annualTrendDetailYear).toBeNull();
    expect(
      (getLeaveEmployeeStatistics as jest.Mock).mock.calls.map(
        ([year]) => year,
      ),
    ).toEqual([currentYear, historicalYear, currentYear]);
    wrapper.unmount();
  });

  it("员工明细保留额度与不限额假期余额，并统一格式化额度天数", async () => {
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      rankedStatisticsEmployees: LeaveEmployeeStatisticsItem[];
      formatBalanceDays: (value: number | null) => string;
    };
    vm.handleTabChange("statistics");
    await flushPromises();

    expect(vm.rankedStatisticsEmployees[0]?.balanceSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          leaveTypeName: "年假",
          unlimited: false,
          totalDays: 10,
          usedDays: 4,
          pendingDays: 1,
          remainingDays: 5,
        }),
        expect.objectContaining({
          leaveTypeName: "病假",
          unlimited: true,
          totalDays: null,
        }),
      ]),
    );
    expect(vm.formatBalanceDays(10)).toBe("10 天");
    expect(vm.formatBalanceDays(null)).toBe("-");
    wrapper.unmount();
  });

  it("移动端年度下钻员工卡片改为单列且明细可换行", () => {
    const componentSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/leave/LeavePendingList.vue"),
      "utf8",
    );
    const mobileStyle = componentSource
      .split("@media (max-width: 760px)")[1]
      ?.split("@media (max-width: 520px)")[0];

    expect(mobileStyle).toMatch(
      /\.annual-trend-employee\s*\{[^}]*grid-template-columns: 1fr;/s,
    );
    expect(mobileStyle).toMatch(
      /\.annual-trend-employee-totals,[\s\S]*?\.annual-trend-type-list\s*\{[^}]*flex-wrap: wrap;/,
    );
  });

  it("快速切换年度时忽略先返回的旧年度响应", async () => {
    const firstYear = new Date().getFullYear();
    let resolveFirst:
      | ((value: LeaveEmployeeStatisticsResponse) => void)
      | null = null;
    (getLeaveEmployeeStatistics as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise<LeaveEmployeeStatisticsResponse>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...createStatisticsResponse(),
        year: firstYear - 1,
        employees: [createEmployee({ name: "新年度员工" })],
      });

    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      statisticsYear: number;
      handleStatisticsYearChange: () => void;
      rankedStatisticsEmployees: LeaveEmployeeStatisticsItem[];
    };

    vm.handleTabChange("statistics");
    vm.statisticsYear = firstYear - 1;
    vm.handleStatisticsYearChange();
    await flushPromises();
    expect(vm.rankedStatisticsEmployees[0]?.name).toBe("新年度员工");

    resolveFirst?.(createStatisticsResponse());
    await flushPromises();
    expect(vm.rankedStatisticsEmployees[0]?.name).toBe("新年度员工");
    wrapper.unmount();
  });

  it("切换年度后立即清空旧年度展示", async () => {
    const wrapper = mountComponent("general_manager");
    const vm = wrapper.vm as unknown as {
      handleTabChange: (name: string) => void;
      statisticsYear: number;
      handleStatisticsYearChange: () => void;
      rankedStatisticsEmployees: LeaveEmployeeStatisticsItem[];
    };

    vm.handleTabChange("statistics");
    await flushPromises();
    expect(vm.rankedStatisticsEmployees).toHaveLength(3);
    (getLeaveEmployeeStatistics as jest.Mock).mockImplementationOnce(
      () => new Promise<LeaveEmployeeStatisticsResponse>(() => undefined),
    );
    vm.statisticsYear -= 1;
    vm.handleStatisticsYearChange();
    await flushPromises();

    expect(vm.rankedStatisticsEmployees).toEqual([]);
    wrapper.unmount();
  });

  it("通过年度参数请求员工请假统计接口", async () => {
    const response = createStatisticsResponse();
    (api.get as jest.Mock).mockResolvedValue({ data: { data: response } });
    const actualLeaveApi = jest.requireActual(
      "../src/utils/leaveApi",
    ) as typeof import("../src/utils/leaveApi");

    await expect(
      actualLeaveApi.getLeaveEmployeeStatistics(2025),
    ).resolves.toEqual(response);
    expect(api.get).toHaveBeenCalledWith("/api/leave/employee-statistics", {
      params: { year: 2025 },
    });
  });
});
