export type EmployeeDocumentUploadIssueType =
  | "success"
  | "error"
  | "warning"
  | "info";

export interface EmployeeDocumentUploadIssue {
  id: string;
  employeeId: string;
  employeeName: string;
  type: EmployeeDocumentUploadIssueType;
  message: string;
}

interface EmployeeDocumentUploadRequestError {
  code?: string;
  request?: unknown;
  response?: {
    status?: number;
    data?: unknown;
  };
}

export interface EmployeeDocumentUploadErrorResolution {
  type: EmployeeDocumentUploadIssueType;
  message: string;
  outcomeUnknown: boolean;
}

interface EmployeeDocumentUnsupportedSegmentSummary {
  label?: unknown;
  pageNumbers?: unknown;
}

export interface EmployeeDocumentRecognitionCompletionResolution {
  type: "success" | "warning";
  warningSummary: string;
}

let employeeDocumentUploadIssueSequence = 0;

export function createEmployeeDocumentUploadIssue(
  issue: Omit<EmployeeDocumentUploadIssue, "id">,
): EmployeeDocumentUploadIssue {
  employeeDocumentUploadIssueSequence += 1;
  return {
    id: `employee-document-upload-issue-${employeeDocumentUploadIssueSequence}`,
    ...issue,
  };
}

export function resolveEmployeeDocumentRecognitionCompletion(input: {
  missingLabels?: readonly string[];
  unsupportedSegments?: readonly EmployeeDocumentUnsupportedSegmentSummary[];
  failedCount?: unknown;
  failedSubItems?: readonly string[];
}): EmployeeDocumentRecognitionCompletionResolution {
  const warningSummaries: string[] = [];
  const missingLabels = Array.from(
    new Set(
      (input.missingLabels || []).map((label) => label.trim()).filter(Boolean),
    ),
  );
  if (missingLabels.length > 0) {
    warningSummaries.push(`未识别到：${missingLabels.join("、")}`);
  }

  const unsupportedSummaries = (input.unsupportedSegments || []).map(
    (segment) => {
      const label =
        typeof segment.label === "string" && segment.label.trim()
          ? segment.label.trim()
          : "未识别材料";
      const pageNumbers = Array.isArray(segment.pageNumbers)
        ? segment.pageNumbers.filter(
            (pageNumber): pageNumber is number =>
              Number.isInteger(pageNumber) && pageNumber > 0,
          )
        : [];
      return `${label}${pageNumbers.length > 0 ? `（第${pageNumbers.join("、")}页）` : ""}`;
    },
  );
  if (unsupportedSummaries.length > 0) {
    warningSummaries.push(`已归档至“其他”：${unsupportedSummaries.join("、")}`);
  }

  const failedSubItems = Array.from(
    new Set(
      (input.failedSubItems || []).map((item) => item.trim()).filter(Boolean),
    ),
  );
  const parsedFailedCount = Number(input.failedCount);
  const failedCount = Number.isFinite(parsedFailedCount)
    ? Math.max(0, Math.floor(parsedFailedCount))
    : 0;
  if (failedSubItems.length > 0) {
    const displayCount = Math.max(failedCount, failedSubItems.length);
    warningSummaries.push(
      `失败子项${displayCount > 1 ? `（${displayCount}个）` : ""}：${failedSubItems.join("、")}`,
    );
  } else if (failedCount > 0) {
    warningSummaries.push(`有${failedCount}个子项处理失败`);
  }

  return {
    type: warningSummaries.length > 0 ? "warning" : "success",
    warningSummary: warningSummaries.join("；"),
  };
}

export function resolveEmployeeDocumentUploadError(
  error: unknown,
): EmployeeDocumentUploadErrorResolution {
  const requestError =
    error && typeof error === "object"
      ? (error as EmployeeDocumentUploadRequestError)
      : {};
  const status = requestError.response?.status;
  const responseData = requestError.response?.data;
  const responseMessage =
    responseData &&
    typeof responseData === "object" &&
    "message" in responseData &&
    typeof responseData.message === "string" &&
    responseData.message.trim()
      ? responseData.message.trim()
      : null;

  if (status === 422) {
    return {
      type: "warning",
      message: responseMessage || "文件内容无法可靠分类，请检查后手动归档",
      outcomeUnknown: false,
    };
  }

  if (status === 503) {
    return {
      type: "warning",
      message:
        responseMessage ||
        "档案文字识别服务本次未能完整处理文件，为避免错误归档，本次未上传任何文件，请稍后重新上传",
      outcomeUnknown: false,
    };
  }

  if (status === 504) {
    return {
      type: "warning",
      message:
        "等待服务器响应超时，识别任务可能仍在后台继续。请勿重复上传；稍后刷新该员工档案，确认未归档后再重新上传",
      outcomeUnknown: true,
    };
  }

  if (status === 500 && !responseMessage) {
    return {
      type: "warning",
      message:
        "服务器连接在识别过程中中断，识别结果暂时无法确认。请勿重复上传；请先刷新该员工档案，确认未归档后再重新上传",
      outcomeUnknown: true,
    };
  }

  if (
    requestError.code === "ECONNABORTED" ||
    requestError.code === "ETIMEDOUT" ||
    (!requestError.response && Boolean(requestError.request))
  ) {
    return {
      type: "warning",
      message:
        "连接中断或等待超时，识别结果暂时无法确认。请勿重复上传；稍后刷新该员工档案，确认未归档后再重新上传",
      outcomeUnknown: true,
    };
  }

  return {
    type: "error",
    message:
      responseMessage || (status ? `服务器返回异常（${status}）` : "上传失败"),
    outcomeUnknown: false,
  };
}
