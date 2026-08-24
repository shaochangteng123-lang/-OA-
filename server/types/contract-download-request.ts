export const CONTRACT_DOWNLOAD_REQUEST_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "withdrawn",
  "processing",
  "completed",
] as const;

export type ContractDownloadRequestStatus =
  (typeof CONTRACT_DOWNLOAD_REQUEST_STATUSES)[number];

export type ContractDownloadDecision = "approve" | "reject";

/** 服务层使用的合同下载申请列表权限范围。 */
export type ContractDownloadRequestListScope =
  | "mine"
  | "mine_history"
  | "approval"
  | "approval_history"
  | "admin"
  | "admin_history";

export interface ContractDownloadPendingCounts {
  /** 普通员工尚未查看的总经理审批或管理员执行结果。 */
  unreadResults: number;
  /** 分配给当前总经理、尚未审批的申请。 */
  managerPending: number;
  /** 分配给当前管理员、尚未办结的下载任务。 */
  executorPending: number;
  /** 当前角色需要在合同管理菜单显示的提醒总数。 */
  total: number;
}

export interface ContractDownloadRequestCreateInput {
  contractId: string;
  purpose: string;
  fileIds: string[];
}

export interface ContractDownloadRequestFileSnapshot {
  id: string;
  contractFileId: string;
  fileType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  downloadedBy: string | null;
  downloadedAt: string | null;
}

export interface ContractDownloadWorkflowNode {
  key: "applicant" | "general_manager" | "administrator";
  label: string;
  status: "completed" | "current" | "waiting" | "rejected" | "withdrawn";
  time: string | null;
  comment: string | null;
}

export interface ContractDownloadRequestAuditEntry {
  id: string;
  action:
    | "submit"
    | "approve"
    | "reject"
    | "withdraw"
    | "resubmit"
    | "download_file"
    | "complete";
  actorId: string;
  actorName: string;
  actorPosition: string;
  actorLabel: string;
  fromStatus: string | null;
  toStatus: string;
  comment: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ContractDownloadRequestChainEntry extends ContractDownloadRequestAuditEntry {
  requestId: string;
  requestNo: string;
  attemptNo: number;
}

export interface ContractDownloadRequestApi {
  id: string;
  requestNo: string;
  contractId: string;
  contractNo: string;
  contractName: string;
  contractArea: string;
  contractStatus: string;
  purpose: string;
  status: ContractDownloadRequestStatus;
  chainId: string;
  previousRequestId: string | null;
  attemptNo: number;
  applicant: { id: string; name: string; position: string; label: string };
  approver: {
    id: string;
    name: string;
    position: string;
    label: string;
    decidedAt: string | null;
    comment: string | null;
  };
  executor: {
    id: string | null;
    name: string | null;
    position: string;
    label: string;
    completedAt: string | null;
    note: string | null;
  };
  files: ContractDownloadRequestFileSnapshot[];
  applicationFileName: string;
  nextStep: string | null;
  workflow: ContractDownloadWorkflowNode[];
  auditLogs: ContractDownloadRequestAuditEntry[];
  chainHistory: ContractDownloadRequestChainEntry[];
  canWithdraw: boolean;
  canResubmit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}
