export type ProbationReviewStage =
  | "employee"
  | "supervisor"
  | "hr"
  | "general_manager"
  | "completed";

export type ProbationDecision = "submit" | "approve" | "reject";

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
  key: Exclude<ProbationReviewStage, "completed">;
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
    label: "总经理审批",
    handler: "管理员",
    order: 4,
  },
] as const;

export function buildProbationApprovalStages(
  records: ProbationApprovalRecord[],
  currentVersion: number,
  reviewStage: ProbationReviewStage,
  status: string,
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

    return {
      ...stage,
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
  const operatorName = record.signer_name?.trim() || "未知操作人";
  const signatureOwnerName = record.signature_owner_name?.trim();
  if (
    record.stage !== "employee" &&
    signatureOwnerName &&
    signatureOwnerName !== operatorName
  ) {
    return `${operatorName}（代）`;
  }
  return operatorName;
}

export function probationApprovalTimelineActorLabel(record: {
  action: string;
  step?: number | null;
  approver_name?: string | null;
}): string {
  const operatorName = record.approver_name?.trim() || "未知操作人";
  const isFinalManagerReview =
    record.step === 3 &&
    (record.action === "approve" || record.action === "reject");
  if (isFinalManagerReview && !operatorName.endsWith("（代）")) {
    return `${operatorName}（代）`;
  }
  return operatorName;
}

export function findGeneralManagerApprovalTask<
  T extends { id: string; review_stage: ProbationReviewStage },
>(tasks: T[], confirmationId: string): T | null {
  return (
    tasks.find(
      (task) =>
        task.id === confirmationId && task.review_stage === "general_manager",
    ) || null
  );
}
