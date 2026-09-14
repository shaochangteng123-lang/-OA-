import { api } from "@/utils/api";
import type {
  FinancialAnalysisModuleKey,
  FinancialAnalysisQuery,
  MonthlyFinancialAnalysisData,
} from "@/types/monthlyFinancialAnalysis";

const BASE_PATH = "/api/monthly-financial-reports/analysis";

/** 仅供已完成项目、期间和地址校验的回单预览调用，保留状态码供界面清理失效文件。 */
export function getMonthlyFinancialProjectReceiptPreview(
  url: string,
  signal?: AbortSignal,
) {
  return api.get<Blob>(url, {
    responseType: "blob",
    signal,
    withCredentials: true,
    timeout: 60_000,
    headers: { "X-Silent-Error": "true" },
  });
}

export async function getMonthlyFinancialAnalysis(
  query: FinancialAnalysisQuery,
  signal?: AbortSignal,
): Promise<MonthlyFinancialAnalysisData> {
  const response = await api.get<{
    success: boolean;
    data: MonthlyFinancialAnalysisData;
    message?: string;
  }>(BASE_PATH, {
    params: { ...query },
    signal,
    timeout: 120_000,
    headers: { "X-Silent-Error": "true" },
  });
  if (!response.data.success) {
    throw new Error(response.data.message || "财务分析加载失败");
  }
  return response.data.data;
}

/** 历史浏览只读查询；月度与季度各按自身粒度读取，不改变页面统计范围。 */
export function getMonthlyFinancialAnalysisWindow(
  query: FinancialAnalysisQuery,
  signal?: AbortSignal,
): Promise<MonthlyFinancialAnalysisData> {
  return getMonthlyFinancialAnalysis(
    {
      ...query,
      granularity: query.granularity === "quarter" ? "quarter" : "month",
    },
    signal,
  );
}

export async function downloadMonthlyFinancialAnalysis(
  query: FinancialAnalysisQuery,
  module: FinancialAnalysisModuleKey | "all" = "all",
  dataVersion?: string,
): Promise<{ blob: Blob; fileName: string }> {
  const response = await api
    .get<Blob>(`${BASE_PATH}/export`, {
      params: { ...query, module, ...(dataVersion ? { dataVersion } : {}) },
      responseType: "blob",
      timeout: 120_000,
      headers: { "X-Silent-Error": "true" },
    })
    .catch(async (caught: unknown) => {
      const body = (caught as { response?: { data?: Blob } })?.response?.data;
      if (body instanceof Blob && typeof body.text === "function") {
        let message: string | undefined;
        try {
          message = JSON.parse(await body.text()).message;
        } catch {
          /* 非文本错误交给调用处统一提示。 */
        }
        if (message) throw new Error(message);
      }
      throw caught;
    });
  const disposition = String(response.headers["content-disposition"] || "");
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "";
  if (encoded) {
    try {
      fileName = decodeURIComponent(encoded);
    } catch {
      fileName = "";
    }
  }
  return {
    blob: response.data,
    fileName:
      fileName || `月度财务趋势分析-${query.from}至${query.to}-${module}.xlsx`,
  };
}
