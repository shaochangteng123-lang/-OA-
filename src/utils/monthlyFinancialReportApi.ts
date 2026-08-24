import { api } from "@/utils/api";
import type {
  MonthlyFinancialClosePayload,
  MonthlyFinancialManualItemInput,
  MonthlyFinancialOpeningBalances,
  MonthlyFinancialReport,
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

const BASE_PATH = "/api/monthly-financial-reports";
export const MONTHLY_FINANCE_VERSION_CONFLICT =
  "MONTHLY_FINANCE_VERSION_CONFLICT";

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
  };
  return candidate.response?.data?.message || candidate.message || fallback;
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
