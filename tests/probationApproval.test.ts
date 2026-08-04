/** @jest-environment node */

import {
  buildProbationApprovalStages,
  probationApprovalStageDefinitions,
  probationApprovalActorLabel,
  probationApprovalTimelineActorLabel,
  probationApprovalTimelineRoleNameLabel,
  probationDecisionLabel,
  sortProbationApprovalHistory,
  type ProbationApprovalRecord,
} from "../src/utils/probationApproval";
import { formatBeijingDateTimeMinute } from "../src/utils/date";

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

  it("角色后显示姓名且已签署姓名不受当前审批人变更影响", () => {
    const records = [
      createRecord({
        id: "employee",
        form_version: 4,
        signer_name: "测试员工",
      }),
      createRecord({
        id: "supervisor",
        form_version: 4,
        stage: "supervisor",
        signer_name: "原总经理",
        decision: "approve",
      }),
    ];

    const stages = buildProbationApprovalStages(records, 4, "hr", "submitted", {
      employee: "新员工姓名",
      supervisor: "新总经理",
      hr: "人事管理员",
      general_manager: "董事长姓名",
    });

    expect(stages.map((stage) => stage.handler)).toEqual([
      "员工本人 测试员工",
      "总经理 原总经理",
      "管理员 人事管理员",
      "董事长 董事长姓名",
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

  it("电子签署记录只显示实际操作人", () => {
    expect(
      probationApprovalActorLabel(
        createRecord({
          stage: "general_manager",
          signer_name: "系统管理员",
          signature_owner_name: "公司总经理",
          decision: "approve",
        }),
      ),
    ).toBe("系统管理员");
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
    expect(
      probationApprovalActorLabel(
        createRecord({
          stage: "general_manager",
          signer_name: "窦美雪",
          signer_role: "chairman",
          signature_owner_name: "窦美雪",
          decision: "approve",
        }),
      ),
    ).toBe("窦美雪");
  });

  it("审批处理时间统一转换为北京时间", () => {
    expect(formatBeijingDateTimeMinute("2026-07-30T10:40:01.393Z")).toBe(
      "2026-07-30 18:40",
    );
    expect(formatBeijingDateTimeMinute("2026-07-30 18:40:01")).toBe(
      "2026-07-30 18:40",
    );
  });

  it("审批时间线只显示实际操作人", () => {
    expect(
      probationApprovalTimelineActorLabel({
        action: "approve",
        step: 3,
        approver_name: "吴静雯",
      }),
    ).toBe("吴静雯");
    expect(
      probationApprovalTimelineActorLabel({
        action: "approve",
        step: 2,
        approver_name: "吴静雯",
      }),
    ).toBe("吴静雯");
  });

  it("审批流程按角色和实际操作人组合显示", () => {
    expect(
      probationApprovalTimelineRoleNameLabel({
        action: "approve",
        approver_role: "general_manager",
        approver_name: "刘行",
      }),
    ).toBe("总经理 刘行");
    expect(
      probationApprovalTimelineRoleNameLabel({
        action: "approve",
        approver_role: "admin",
        approver_name: "吴静雯",
      }),
    ).toBe("管理员 吴静雯");
    expect(
      probationApprovalTimelineRoleNameLabel({
        action: "approve",
        approver_role: "chairman",
        approver_name: "窦美雪",
      }),
    ).toBe("董事长 窦美雪");
  });

  it("最终节点由董事长本人审批", () => {
    expect(probationApprovalStageDefinitions.at(-1)).toMatchObject({
      key: "general_manager",
      label: "董事长审批",
      handler: "董事长",
    });
  });
});
