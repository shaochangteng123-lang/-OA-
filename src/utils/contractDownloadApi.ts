import { api } from "@/utils/api";
import type { ApiEnvelope } from "@/types/contract";
import type {
  ContractDownloadRequest,
  ContractDownloadRequestListResponse,
  CreateContractDownloadRequestPayload,
  AvailableContractDownloadFiles,
  ContractDownloadPendingCounts,
} from "@/types/contractDownload";

export const CONTRACT_DOWNLOAD_BADGE_REFRESH_EVENT =
  "contract-download-badges-refresh";

function unwrap<T>(response: { data: ApiEnvelope<T> }): T {
  if (!response.data.success) {
    throw new Error(response.data.message || "合同下载申请操作失败");
  }
  return response.data.data;
}

export async function createContractDownloadRequest(
  payload: CreateContractDownloadRequestPayload,
) {
  return unwrap(
    await api.post<ApiEnvelope<ContractDownloadRequest>>(
      "/api/contract-download-requests",
      payload,
    ),
  );
}

export async function getContractDownloadRequests(params: {
  scope:
    | "mine"
    | "employee_history"
    | "manager_pending"
    | "manager_processed"
    | "admin_pending"
    | "admin_processed";
  page?: number;
  pageSize?: number;
  status?: string;
  keyword?: string;
}) {
  return unwrap(
    await api.get<ApiEnvelope<ContractDownloadRequestListResponse>>(
      "/api/contract-download-requests",
      { params },
    ),
  );
}

export async function getContractDownloadRequest(id: string) {
  return unwrap(
    await api.get<ApiEnvelope<ContractDownloadRequest>>(
      `/api/contract-download-requests/${encodeURIComponent(id)}`,
    ),
  );
}

export async function withdrawContractDownloadRequest(
  id: string,
  expectedVersion: number,
  reason = "",
) {
  return unwrap(
    await api.post<ApiEnvelope<ContractDownloadRequest>>(
      `/api/contract-download-requests/${encodeURIComponent(id)}/withdraw`,
      { expectedVersion, reason: reason.trim() || undefined },
    ),
  );
}

export async function deleteWithdrawnContractDownloadRequest(
  id: string,
  expectedVersion: number,
) {
  await unwrap(
    await api.delete<ApiEnvelope<{ deleted: true }>>(
      `/api/contract-download-requests/${encodeURIComponent(id)}`,
      { params: { expectedVersion } },
    ),
  );
}

export async function resubmitContractDownloadRequest(
  id: string,
  payload: {
    purpose: string;
    fileIds: string[];
    expectedVersion: number;
  },
) {
  return unwrap(
    await api.post<ApiEnvelope<ContractDownloadRequest>>(
      `/api/contract-download-requests/${encodeURIComponent(id)}/resubmit`,
      payload,
    ),
  );
}

export async function getAvailableContractDownloadFiles(contractId: string) {
  return unwrap(
    await api.get<ApiEnvelope<AvailableContractDownloadFiles>>(
      `/api/contract-download-requests/available/${encodeURIComponent(contractId)}`,
    ),
  );
}

export async function getContractDownloadPendingCounts(): Promise<ContractDownloadPendingCounts> {
  const data = unwrap(
    await api.get<ApiEnvelope<Record<string, unknown>>>(
      "/api/contract-download-requests/pending-counts",
    ),
  );
  const count = (...keys: string[]) => {
    const value = keys.map((key) => data[key]).find((item) => item != null);
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  };
  const unreadResults = count("unreadResults", "unreadResultCount");
  const managerPending = count("managerPending", "managerPendingCount");
  const executorPending = count(
    "executorPending",
    "executorPendingCount",
    "adminPendingCount",
    "pendingExecutionCount",
  );
  return {
    unreadResults,
    managerPending,
    executorPending,
    total: count("total") || unreadResults + managerPending + executorPending,
  };
}

export async function acknowledgeContractDownloadResults(requestIds: string[]) {
  await api.post("/api/contract-download-requests/notifications/acknowledge", {
    requestIds,
  });
}

export function requestContractDownloadBadgeRefresh() {
  window.dispatchEvent(new Event(CONTRACT_DOWNLOAD_BADGE_REFRESH_EVENT));
}

export async function approveContractDownloadRequest(
  id: string,
  opinion: string,
  expectedVersion: number,
) {
  return unwrap(
    await api.post<ApiEnvelope<ContractDownloadRequest>>(
      `/api/contract-download-requests/${encodeURIComponent(id)}/decision`,
      { decision: "approve", comment: opinion, expectedVersion },
    ),
  );
}

export async function rejectContractDownloadRequest(
  id: string,
  opinion: string,
  expectedVersion: number,
) {
  return unwrap(
    await api.post<ApiEnvelope<ContractDownloadRequest>>(
      `/api/contract-download-requests/${encodeURIComponent(id)}/decision`,
      { decision: "reject", comment: opinion, expectedVersion },
    ),
  );
}

export async function completeContractDownloadRequest(
  id: string,
  processingNote: string,
  expectedVersion: number,
) {
  return unwrap(
    await api.post<ApiEnvelope<ContractDownloadRequest>>(
      `/api/contract-download-requests/${encodeURIComponent(id)}/complete`,
      { processingNote, expectedVersion },
    ),
  );
}

export function getApprovedContractDownloadFileUrl(
  requestId: string,
  fileId: string,
) {
  return `/api/contract-download-requests/${encodeURIComponent(requestId)}/files/${encodeURIComponent(fileId)}/download`;
}

export function getContractDownloadApplicationPreviewUrl(id: string) {
  return `/api/contract-download-requests/${encodeURIComponent(id)}/application-preview`;
}

export function getAdminContractDownloadHistoryExportUrl(keyword = "") {
  const params = new URLSearchParams();
  if (keyword.trim()) params.set("keyword", keyword.trim());
  const query = params.toString();
  return `/api/contract-download-requests/admin-processed/export${query ? `?${query}` : ""}`;
}

export function getManagerContractDownloadHistoryExportUrl(keyword = "") {
  const params = new URLSearchParams();
  if (keyword.trim()) params.set("keyword", keyword.trim());
  const query = params.toString();
  return `/api/contract-download-requests/manager-processed/export${query ? `?${query}` : ""}`;
}

export function getContractDownloadRequestFilePreviewUrl(
  requestId: string,
  requestFileId: string,
) {
  return `/api/contract-download-requests/${encodeURIComponent(requestId)}/files/${encodeURIComponent(requestFileId)}/preview`;
}

export function getContractDownloadRequestErrorMessage(
  error: unknown,
  fallback: string,
) {
  const candidate = error as {
    response?: { data?: { message?: string } };
  };
  return (
    candidate.response?.data?.message ||
    (error instanceof Error ? error.message : "") ||
    fallback
  );
}
