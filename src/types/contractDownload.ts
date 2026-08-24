import type { ContractStatus } from "@/types/contract";

export type ContractDownloadRequestStatus =
  | "pending_approval"
  | "approved"
  | "processing"
  | "completed"
  | "rejected"
  | "withdrawn";

export type ContractDownloadHistoryAction =
  | "submit"
  | "approve"
  | "reject"
  | "withdraw"
  | "resubmit"
  | "download_file"
  | "complete";

export interface ContractDownloadAuditEntry {
  id: string;
  action: ContractDownloadHistoryAction;
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

export interface ContractDownloadHistoryEntry extends ContractDownloadAuditEntry {
  requestId: string;
  requestNo: string;
  attemptNo: number;
}

export interface ContractDownloadRequestFile {
  id: string;
  contractFileId: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  downloadedBy?: string | null;
  downloadedAt?: string | null;
}

export interface ContractDownloadWorkflowPerson {
  id: string | null;
  name: string | null;
  position: string;
  label: string;
}

export interface ContractDownloadWorkflowNode {
  key: "applicant" | "general_manager" | "administrator";
  label: string;
  status: "completed" | "current" | "waiting" | "rejected" | "withdrawn";
  time?: string | null;
  comment?: string | null;
}

export interface ContractDownloadRequest {
  id: string;
  chainId: string;
  previousRequestId: string | null;
  attemptNo: number;
  requestNo: string;
  contractId: string;
  contractNo: string;
  contractName: string;
  contractArea: string;
  contractStatus: ContractStatus;
  purpose: string;
  status: ContractDownloadRequestStatus;
  applicant: ContractDownloadWorkflowPerson;
  approver: ContractDownloadWorkflowPerson & {
    decidedAt?: string | null;
    comment?: string | null;
  };
  executor: ContractDownloadWorkflowPerson & {
    completedAt?: string | null;
    note?: string | null;
  };
  files: ContractDownloadRequestFile[];
  applicationFileName: string;
  nextStep?: string | null;
  workflow: ContractDownloadWorkflowNode[];
  auditLogs: ContractDownloadAuditEntry[];
  chainHistory: ContractDownloadHistoryEntry[];
  canWithdraw: boolean;
  canResubmit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ContractDownloadRequestListResponse {
  items: ContractDownloadRequest[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateContractDownloadRequestPayload {
  contractId: string;
  fileIds: string[];
  purpose: string;
}

export interface AvailableContractDownloadFiles {
  contract: {
    id: string;
    contractNo: string;
    contractName: string;
    area: string;
    status: ContractStatus;
  };
  files: Array<{
    id: string;
    fileType: string;
    fileTypeLabel: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    createdAt: string;
  }>;
}

export interface ContractDownloadPendingCounts {
  unreadResults: number;
  managerPending: number;
  executorPending: number;
  total: number;
}

export const CONTRACT_DOWNLOAD_REQUEST_STATUS_LABELS: Record<
  ContractDownloadRequestStatus,
  string
> = {
  pending_approval: "等待总经理审批",
  approved: "等待管理员执行下载",
  processing: "管理员处理中",
  completed: "下载申请已完成",
  rejected: "总经理已驳回",
  withdrawn: "员工已撤回",
};
