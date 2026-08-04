export type ProbationReviewStage =
  | "employee"
  | "supervisor"
  | "hr"
  | "general_manager"
  | "completed";

export type ProbationDecision = "submit" | "approve" | "reject";
export type ProbationApprovalStageKey = Exclude<
  ProbationReviewStage,
  "completed"
>;
export type ProbationApproverNames = Partial<
  Record<ProbationApprovalStageKey, string | null>
>;

export interface ProbationApprovalRecord {
  id: string;
  form_version: number;
  stage: Exclude<ProbationReviewStage, "completed">;
  signer_name: string;
  signer_role?: string;
  signature_owner_name?: string;
  opinion: string | null;
  decision: ProbationDecision;
  signed_at: string;
}

export interface ProbationApprovalStageView {
  key: ProbationApprovalStageKey;
  label: string;
  handler: string;
  order: number;
  state: "completed" | "current" | "rejected" | "pending";
  record: ProbationApprovalRecord | null;
}

export const probationApprovalStageDefinitions = [
  {
    key: "employee",
    label: "员工提交",
    handler: "员工本人",
    order: 1,
  },
  {
    key: "supervisor",
    label: "主管领导意见",
    handler: "总经理",
    order: 2,
  },
  {
    key: "hr",
    label: "人事部意见",
    handler: "管理员",
    order: 3,
  },
  {
    key: "general_manager",
    label: "董事长审批",
    handler: "董事长",
    order: 4,
  },
] as const;

export function buildProbationApprovalStages(
  records: ProbationApprovalRecord[],
  currentVersion: number,
  reviewStage: ProbationReviewStage,
  status: string,
  approverNames: ProbationApproverNames = {},
): ProbationApprovalStageView[] {
  const currentRecords = records.filter(
    (record) => record.form_version === currentVersion,
  );

  return probationApprovalStageDefinitions.map((stage) => {
    const record =
      currentRecords.find((item) => item.stage === stage.key) || null;
    let state: ProbationApprovalStageView["state"] = "pending";
    if (record?.decision === "reject") {
      state = "rejected";
    } else if (record) {
      state = "completed";
    } else if (status === "submitted" && reviewStage === stage.key) {
      state = "current";
    }
    const approverName =
      record?.signer_name?.trim() || approverNames[stage.key]?.trim();

    return {
      ...stage,
      handler: approverName
        ? `${stage.handler} ${approverName}`
        : stage.handler,
      state,
      record,
    };
  });
}

export function sortProbationApprovalHistory(
  records: ProbationApprovalRecord[],
): ProbationApprovalRecord[] {
  return [...records].sort((left, right) => {
    if (left.form_version !== right.form_version) {
      return right.form_version - left.form_version;
    }
    return (
      new Date(right.signed_at).getTime() - new Date(left.signed_at).getTime()
    );
  });
}

export function probationDecisionLabel(decision: ProbationDecision): string {
  const labels: Record<ProbationDecision, string> = {
    submit: "已提交",
    approve: "已同意",
    reject: "已驳回",
  };
  return labels[decision];
}

export function probationApprovalActorLabel(
  record: ProbationApprovalRecord,
): string {
  return record.signer_name?.trim() || "未知操作人";
}

export function probationApprovalTimelineActorLabel(record: {
  action: string;
  step?: number | null;
  approver_name?: string | null;
}): string {
  return record.approver_name?.trim() || "未知操作人";
}

export function probationApprovalTimelineRoleNameLabel(record: {
  action: string;
  approver_name?: string | null;
  approver_role?: string | null;
}): string {
  const actorName = probationApprovalTimelineActorLabel(record);
  const roleLabels: Record<string, string> = {
    user: "员工本人",
    general_manager: "总经理",
    admin: "管理员",
    super_admin: "管理员",
    chairman: "董事长",
  };
  const roleLabel = roleLabels[record.approver_role || ""];
  return roleLabel ? `${roleLabel} ${actorName}` : actorName;
}
