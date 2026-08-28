import { api } from "@/utils/api";
import type {
  MonthlyFinancialBankReceiptDuplicateFile,
  MonthlyFinancialBankReceiptState,
  MonthlyFinancialClosePayload,
  MonthlyFinancialManualItemInput,
  MonthlyFinancialOpeningBalances,
  MonthlyFinancialReport,
  MonthlyFinancialTrendData,
} from "@/types/monthlyFinancialReport";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface MonthlyFinancialReportDownload {
  blob: Blob;
  fileName: string;
}

export interface MonthlyFinancialMutationResult {
  report: MonthlyFinancialReport;
  affectedMonths: string[];
  message?: string;
}

export interface MonthlyFinancialBankReceiptUploadResult {
  report: MonthlyFinancialReport;
  bankStatements: MonthlyFinancialBankReceiptState;
  duplicateFiles: MonthlyFinancialBankReceiptDuplicateFile[];
  affectedMonths: string[];
  message?: string;
}

const BASE_PATH = "/api/monthly-financial-reports";
export const MONTHLY_FINANCE_VERSION_CONFLICT =
  "MONTHLY_FINANCE_VERSION_CONFLICT";
export const MONTHLY_BANK_MIXED_MONTH_CONFIRMATION_REQUIRED =
  "MONTHLY_BANK_MIXED_MONTH_CONFIRMATION_REQUIRED";

function unwrap<T>(response: { data: ApiEnvelope<T> }): T {
  if (!response.data.success) {
    throw new Error(response.data.message || "月度财务报表操作失败");
  }
  return response.data.data;
}

function unwrapMutation(response: {
  data: ApiEnvelope<MonthlyFinancialReport> & { affectedMonths?: string[] };
}): MonthlyFinancialMutationResult {
  return {
    report: unwrap(response),
    affectedMonths: Array.isArray(response.data.affectedMonths)
      ? response.data.affectedMonths.filter((month) =>
          /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
        )
      : [],
    message: response.data.message,
  };
}

function monthPath(month: string): string {
  return `${BASE_PATH}/${encodeURIComponent(month)}`;
}

export async function getMonthlyFinancialReport(
  month: string,
): Promise<MonthlyFinancialReport> {
  return unwrap(
    await api.get<ApiEnvelope<MonthlyFinancialReport>>(monthPath(month)),
  );
}

export async function getMonthlyFinancialReportTrend(
  from: string,
  to: string,
): Promise<MonthlyFinancialTrendData> {
  return unwrap(
    await api.get<ApiEnvelope<MonthlyFinancialTrendData>>(
      `${BASE_PATH}/trend`,
      { params: { from, to } },
    ),
  );
}

export async function getMonthlyFinancialBankReceipts(
  month: string,
): Promise<MonthlyFinancialBankReceiptState> {
  return unwrap(
    await api.get<ApiEnvelope<MonthlyFinancialBankReceiptState>>(
      `${monthPath(month)}/bank-receipts`,
    ),
  );
}

export async function uploadMonthlyFinancialBankReceipts(
  month: string,
  expectedVersion: number,
  files: File[],
  mixedMonthConfirmed = false,
  signal?: AbortSignal,
): Promise<MonthlyFinancialBankReceiptUploadResult> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file, file.name);
  formData.append("expectedVersion", String(expectedVersion));
  formData.append("mixedMonthConfirmed", String(mixedMonthConfirmed));

  const response = await api.post<
    ApiEnvelope<Omit<MonthlyFinancialBankReceiptUploadResult, "message">>
  >(`${monthPath(month)}/bank-receipts`, formData, {
    timeout: 30 * 60 * 1000,
    signal,
    headers: { "X-Silent-Error": "true" },
  });
  const data = unwrap(response);
  return {
    ...data,
    affectedMonths: Array.isArray(data.affectedMonths)
      ? data.affectedMonths.filter((item) =>
          /^\d{4}-(0[1-9]|1[0-2])$/.test(item),
        )
      : [],
    duplicateFiles: Array.isArray(data.duplicateFiles)
      ? data.duplicateFiles
      : [],
    message: response.data.message,
  };
}

export async function reviewMonthlyFinancialBankTransaction(
  month: string,
  transactionId: string,
  expectedVersion: number,
  reason: string,
): Promise<MonthlyFinancialBankReceiptUploadResult> {
  const response = await api.post<
    ApiEnvelope<Omit<MonthlyFinancialBankReceiptUploadResult, "message">>
  >(
    `${monthPath(month)}/bank-transactions/${encodeURIComponent(transactionId)}/review`,
    { expectedVersion, action: "exclude", reason },
    { headers: { "X-Silent-Error": "true" } },
  );
  const data = unwrap(response);
  return {
    ...data,
    affectedMonths: Array.isArray(data.affectedMonths)
      ? data.affectedMonths.filter((item) =>
          /^\d{4}-(0[1-9]|1[0-2])$/.test(item),
        )
      : [],
    duplicateFiles: [],
    message: response.data.message,
  };
}

export async function saveMonthlyFinancialManualItems(
  month: string,
  expectedVersion: number,
  items: MonthlyFinancialManualItemInput[],
  openingBalances?: MonthlyFinancialOpeningBalances,
): Promise<MonthlyFinancialMutationResult> {
  return unwrapMutation(
    await api.put<ApiEnvelope<MonthlyFinancialReport>>(
      `${monthPath(month)}/manual-items`,
      { expectedVersion, openingBalances, items },
    ),
  );
}

export async function refreshMonthlyFinancialReport(
  month: string,
  expectedVersion: number,
): Promise<MonthlyFinancialMutationResult> {
  return unwrapMutation(
    await api.post<ApiEnvelope<MonthlyFinancialReport>>(
      `${monthPath(month)}/refresh`,
      { expectedVersion },
    ),
  );
}

export async function closeMonthlyFinancialReport(
  month: string,
  payload: MonthlyFinancialClosePayload,
): Promise<MonthlyFinancialReport> {
  return unwrap(
    await api.post<ApiEnvelope<MonthlyFinancialReport>>(
      `${monthPath(month)}/close`,
      payload,
    ),
  );
}

export async function reopenMonthlyFinancialReport(
  month: string,
  expectedVersion: number,
  reason: string,
): Promise<MonthlyFinancialMutationResult> {
  return unwrapMutation(
    await api.post<ApiEnvelope<MonthlyFinancialReport>>(
      `${monthPath(month)}/reopen`,
      { expectedVersion, reason },
    ),
  );
}

export async function downloadMonthlyFinancialReport(
  month: string,
): Promise<MonthlyFinancialReportDownload> {
  const response = await api.get<Blob>(`${monthPath(month)}/export`, {
    responseType: "blob",
    timeout: 120_000,
  });
  const disposition = String(response.headers["content-disposition"] || "");
  return {
    blob: response.data,
    fileName:
      extractDownloadFileName(disposition) || `月度财务报表-${month}.xlsx`,
  };
}

function extractDownloadFileName(disposition: string): string {
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || "";
}

export function getMonthlyFinancialReportErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const candidate = error as {
    response?: { data?: { message?: string }; status?: number };
    message?: string;
    code?: string;
  };
  if (candidate.response?.data?.message) {
    return candidate.response.data.message;
  }
  if (
    candidate.code === "ECONNABORTED" ||
    /timeout/i.test(candidate.message || "")
  ) {
    return "请求等待超时，服务端可能仍在处理，请先刷新当前页面状态再决定是否重试";
  }
  if (
    candidate.code === "ERR_NETWORK" ||
    /network error/i.test(candidate.message || "")
  ) {
    return "网络连接失败，请检查网络后先刷新当前页面状态，避免重复提交";
  }
  return candidate.message && /[\u3400-\u9fff]/u.test(candidate.message)
    ? candidate.message
    : fallback;
}

export function isMonthlyFinancialReportNotFound(error: unknown): boolean {
  const candidate = error as {
    response?: { status?: number; data?: { code?: string } };
  };
  return (
    candidate.response?.status === 404 ||
    candidate.response?.data?.code === "MONTHLY_FINANCE_NOT_FOUND"
  );
}

export function isMonthlyFinancialReportVersionConflict(
  error: unknown,
): boolean {
  const candidate = error as {
    response?: { status?: number; data?: { code?: string } };
  };
  return (
    candidate.response?.status === 409 &&
    candidate.response?.data?.code === MONTHLY_FINANCE_VERSION_CONFLICT
  );
}

export function getMonthlyFinancialReportErrorCode(error: unknown): string {
  const candidate = error as { response?: { data?: { code?: unknown } } };
  return String(candidate.response?.data?.code || "");
}

export function isMonthlyFinancialBankMixedMonthConfirmationRequired(
  error: unknown,
): boolean {
  return (
    getMonthlyFinancialReportErrorCode(error) ===
    MONTHLY_BANK_MIXED_MONTH_CONFIRMATION_REQUIRED
  );
}
