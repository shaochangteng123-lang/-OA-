/** @jest-environment node */

import {
  buildProbationApprovalStages,
  findGeneralManagerApprovalTask,
  probationApprovalActorLabel,
  probationApprovalTimelineActorLabel,
  probationDecisionLabel,
  sortProbationApprovalHistory,
  type ProbationApprovalRecord,
} from "../src/utils/probationApproval";

function createRecord(
  overrides: Partial<ProbationApprovalRecord>,
): ProbationApprovalRecord {
  return {
    id: "record-1",
    form_version: 1,
    stage: "employee",
    signer_name: "测试员工",
    opinion: null,
    decision: "submit",
    signed_at: "2026-07-24T09:00:00+08:00",
    ...overrides,
  };
}

describe("转正审批流程与历史记录", () => {
  it("只用当前版本计算流程状态并明确标记驳回节点", () => {
    const records = [
      createRecord({
        id: "v1-final",
        form_version: 1,
        stage: "general_manager",
        decision: "approve",
      }),
      createRecord({
        id: "v2-employee",
        form_version: 2,
        stage: "employee",
      }),
      createRecord({
        id: "v2-supervisor",
        form_version: 2,
        stage: "supervisor",
        signer_name: "总经理",
        decision: "reject",
        opinion: "试用期工作总结不完整",
      }),
    ];

    const stages = buildProbationApprovalStages(
      records,
      2,
      "employee",
      "rejected",
    );

    expect(stages.map((stage) => stage.state)).toEqual([
      "completed",
      "rejected",
      "pending",
      "pending",
    ]);
    expect(stages[1].record?.opinion).toBe("试用期工作总结不完整");
  });

  it("待审批环节显示当前处理人，其余未开始", () => {
    const records = [
      createRecord({ id: "employee", form_version: 3 }),
      createRecord({
        id: "supervisor",
        form_version: 3,
        stage: "supervisor",
        signer_name: "总经理",
        decision: "approve",
      }),
    ];

    const stages = buildProbationApprovalStages(records, 3, "hr", "submitted");

    expect(stages.map((stage) => stage.state)).toEqual([
      "completed",
      "completed",
      "current",
      "pending",
    ]);
  });

  it("历史记录按版本倒序，同版本按处理时间倒序", () => {
    const records = [
      createRecord({ id: "v1", form_version: 1 }),
      createRecord({
        id: "v2-early",
        form_version: 2,
        signed_at: "2026-07-24T09:00:00+08:00",
      }),
      createRecord({
        id: "v2-late",
        form_version: 2,
        stage: "supervisor",
        decision: "approve",
        signed_at: "2026-07-24T10:00:00+08:00",
      }),
    ];

    expect(
      sortProbationApprovalHistory(records).map((record) => record.id),
    ).toEqual(["v2-late", "v2-early", "v1"]);
  });

  it("统一显示审批结果文案", () => {
    expect(probationDecisionLabel("submit")).toBe("已提交");
    expect(probationDecisionLabel("approve")).toBe("已同意");
    expect(probationDecisionLabel("reject")).toBe("已驳回");
  });

  it("代签环节显示实际管理员姓名并标记代签", () => {
    expect(
      probationApprovalActorLabel(
        createRecord({
          stage: "general_manager",
          signer_name: "系统管理员",
          signature_owner_name: "公司总经理",
          decision: "approve",
        }),
      ),
    ).toBe("系统管理员（代）");
    expect(
      probationApprovalActorLabel(
        createRecord({
          stage: "hr",
          signer_name: "人事管理员",
          signature_owner_name: "人事管理员",
          decision: "approve",
        }),
      ),
    ).toBe("人事管理员");
  });

  it("审批时间线的最终总经理环节显示实际管理员代签", () => {
    expect(
      probationApprovalTimelineActorLabel({
        action: "approve",
        step: 3,
        approver_name: "吴静雯",
      }),
    ).toBe("吴静雯（代）");
    expect(
      probationApprovalTimelineActorLabel({
        action: "approve",
        step: 2,
        approver_name: "吴静雯",
      }),
    ).toBe("吴静雯");
  });

  it("管理员签完人事部意见后定位同一申请的总经理审批任务", () => {
    const tasks = [
      { id: "confirmation-1", review_stage: "hr" as const },
      { id: "confirmation-2", review_stage: "general_manager" as const },
      { id: "confirmation-1", review_stage: "general_manager" as const },
    ];

    expect(findGeneralManagerApprovalTask(tasks, "confirmation-1")).toEqual({
      id: "confirmation-1",
      review_stage: "general_manager",
    });
    expect(findGeneralManagerApprovalTask(tasks, "missing")).toBeNull();
  });
});
