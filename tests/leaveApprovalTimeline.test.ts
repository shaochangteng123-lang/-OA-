jest.mock("../src/utils/leaveApi", () => ({
  getAttachmentUrl: (attachmentId: string) =>
    `/api/leave/attachments/${attachmentId}/download`,
}));

import LeaveApprovalTimeline from "../src/components/leave/LeaveApprovalTimeline.vue";
import { formatBeijingDateTime } from "../src/utils/date";
import type { LeaveRequestDetail } from "../src/utils/leaveApi";

const { mount } =
  require("../node_modules/@vue/test-utils/dist/vue-test-utils.cjs.js") as typeof import("@vue/test-utils");

const globalStubs = {
  "el-descriptions": { template: "<section><slot /></section>" },
  "el-descriptions-item": { template: "<div><slot /></div>" },
  "el-alert": { template: "<div><slot /></div>" },
  "el-tag": { template: "<span><slot /></span>" },
  "el-timeline": { template: '<div class="timeline"><slot /></div>' },
  "el-timeline-item": {
    props: ["timestamp"],
    template:
      '<section class="timeline-item"><time>{{ timestamp }}</time><slot /></section>',
  },
  "el-icon": { template: "<span><slot /></span>" },
  "el-button": {
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  "el-tooltip": { template: "<span><slot /></span>" },
};

function buildRequest(): LeaveRequestDetail {
  return {
    id: "request-v2",
    request_no: "QJ-2026-00002",
    root_request_no: "QJ-2026-00001",
    version_count: 2,
    user_id: "applicant-1",
    applicant_name: "申请人",
    applicant_department: "项目部",
    leave_type_code: "annual",
    leave_type_name: "年假",
    start_date: "2026-07-20",
    start_half: "morning",
    end_date: "2026-07-24",
    end_half: "afternoon",
    total_days: 5,
    reason: "申请年假",
    status: "approved",
    approver_id: "approver-1",
    approver_name: "刘行",
    approver_real_name: "刘行",
    approver_position: "总经理",
    cc_recipient_role: "管理员",
    cc_recipient_name: "档案管理员",
    reject_reason: null,
    approved_at: "2026-07-17T08:40:00.000Z",
    rejected_at: null,
    cancelled_at: null,
    submitted_at: "2026-07-17T08:34:38.431Z",
    version: 2,
    original_id: "request-v1",
    created_at: "2026-07-17T08:34:38.431Z",
    updated_at: "2026-07-17T08:40:00.000Z",
    attachments: [
      {
        id: "attachment-v1",
        leave_request_id: "request-v1",
        file_name: "首次提交附件.pdf",
        file_size: 1024,
        mime_type: "application/pdf",
        created_at: "2026-07-17T07:38:32.944Z",
        version: 1,
        request_no: "QJ-2026-00001",
      },
      {
        id: "attachment-v2",
        leave_request_id: "request-v2",
        file_name: "重新提交附件.pdf",
        file_size: 2048,
        mime_type: "application/pdf",
        created_at: "2026-07-17T08:34:38.431Z",
        version: 2,
        request_no: "QJ-2026-00002",
      },
    ],
    logs: [
      {
        id: "log-submit",
        leave_request_id: "request-v1",
        operator_id: "applicant-1",
        operator_name: "申请人",
        action: "submit",
        comment: null,
        created_at: "2026-07-17T07:38:32.944Z",
      },
      {
        id: "log-reject",
        leave_request_id: "request-v1",
        operator_id: "approver-1",
        operator_name: "刘行",
        operator_position: "总经理",
        action: "reject",
        comment: "资料不完整",
        created_at: "2026-07-17T07:40:12.403Z",
      },
      {
        id: "log-resubmit",
        leave_request_id: "request-v2",
        operator_id: "applicant-1",
        operator_name: "申请人",
        action: "resubmit",
        comment: "重新提交",
        created_at: "2026-07-17T08:34:38.431Z",
      },
    ],
  };
}

describe("请假审批流程附件与时间", () => {
  it("附件只显示在所属申请版本的提交节点", () => {
    const wrapper = mount(LeaveApprovalTimeline, {
      props: { request: buildRequest(), isOwner: true },
      global: { stubs: globalStubs },
    });

    const timelineItems = wrapper.findAll(".timeline-item");
    expect(timelineItems).toHaveLength(3);
    expect(timelineItems[0].text()).toContain("首次提交附件.pdf");
    expect(timelineItems[0].text()).not.toContain("重新提交附件.pdf");
    expect(timelineItems[1].find(".leave-file-cards").exists()).toBe(false);
    expect(timelineItems[2].text()).toContain("重新提交附件.pdf");
    expect(timelineItems[2].text()).not.toContain("首次提交附件.pdf");
  });

  it("审批时间转换为北京时间并精确到秒", () => {
    const wrapper = mount(LeaveApprovalTimeline, {
      props: { request: buildRequest(), isOwner: true },
      global: { stubs: globalStubs },
    });

    const timelineItems = wrapper.findAll(".timeline-item");
    expect(timelineItems[0].get("time").text()).toBe("2026-07-17 15:38:32");
    expect(timelineItems[2].get("time").text()).toBe("2026-07-17 16:34:38");
  });

  it("不带时区的历史北京时间不会被重复增加八小时", () => {
    expect(formatBeijingDateTime("2026-07-17 16:34:38")).toBe(
      "2026-07-17 16:34:38",
    );
  });

  it("抄送对象显示具体角色和姓名", () => {
    const wrapper = mount(LeaveApprovalTimeline, {
      props: { request: buildRequest(), isOwner: false },
      global: { stubs: globalStubs },
    });

    expect(wrapper.text()).toContain("管理员 档案管理员");
  });

  it("审批人按请假流程角色显示总经理姓名", () => {
    const wrapper = mount(LeaveApprovalTimeline, {
      props: { request: buildRequest(), isOwner: true },
      global: { stubs: globalStubs },
    });

    expect(wrapper.text()).toContain("总经理 刘行");
    expect(wrapper.text()).not.toContain("项目经理 刘行");
  });

  it("续假审批直接展示原请假类型、时间、天数和事由", () => {
    const request = buildRequest();
    request.application_kind = "extension";
    request.parent_request_id = "parent-request";
    request.parent_request = {
      id: "parent-request",
      request_no: "QJ-2026-00001",
      leave_type_name: "年假",
      start_date: "2026-07-13",
      start_half: "morning",
      end_date: "2026-07-17",
      end_half: "afternoon",
      total_days: 5,
      reason: "家庭安排",
      status: "approved",
      application_kind: "normal",
    };
    request.related_requests = [];
    request.combination_requests = [];

    const wrapper = mount(LeaveApprovalTimeline, {
      props: { request, isOwner: false },
      global: { stubs: globalStubs },
    });

    expect(wrapper.text()).toContain("原请假信息");
    expect(wrapper.text()).toContain("年假");
    expect(wrapper.text()).toContain("2026-07-13上午 至 2026-07-17下午");
    expect(wrapper.text()).toContain("5 个工作日");
    expect(wrapper.text()).toContain("家庭安排");
  });

  it("组合续假在审批详情中显示明确业务类型", () => {
    const request = buildRequest();
    request.application_kind = "extension";
    request.combination_group_id = "extension-group";
    request.parent_request_id = "parent-request";
    request.parent_request = {
      id: "parent-request",
      request_no: "QJ-2026-00001",
      leave_type_name: "年假",
      start_date: "2026-07-13",
      start_half: "morning",
      end_date: "2026-07-17",
      end_half: "afternoon",
      total_days: 5,
      reason: "家庭安排",
      status: "approved",
      application_kind: "normal",
      combination_group_id: null,
    };
    request.related_requests = [];
    request.combination_requests = [];

    const wrapper = mount(LeaveApprovalTimeline, {
      props: { request, isOwner: false },
      global: { stubs: globalStubs },
    });

    expect(wrapper.text()).toContain("组合续假");
  });

  it("点击原申请入口时通知详情抽屉加载关联申请", async () => {
    const request = buildRequest();
    request.application_kind = "extension";
    request.parent_request_id = "parent-request";
    request.parent_request = {
      id: "parent-request",
      request_no: "QJ-2026-00001",
      leave_type_name: "年假",
      start_date: "2026-07-13",
      start_half: "morning",
      end_date: "2026-07-17",
      end_half: "afternoon",
      total_days: 5,
      reason: "家庭安排",
      status: "approved",
      application_kind: "normal",
    };
    request.related_requests = [];
    request.combination_requests = [];

    const wrapper = mount(LeaveApprovalTimeline, {
      props: { request, isOwner: false },
      global: { stubs: globalStubs },
    });
    const viewOriginalButton = wrapper
      .findAll("button")
      .find((button) => button.text().includes("查看原申请"));

    expect(viewOriginalButton).toBeDefined();
    await viewOriginalButton!.trigger("click");
    expect(wrapper.emitted("view-request")).toEqual([["parent-request"]]);
  });
});
