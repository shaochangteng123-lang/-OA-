import { performance } from "node:perf_hooks";
import {
  recognizeContractFile,
  type ContractRecognitionOptions,
} from "./contractOcr.js";
import { type PaddleOcrModel } from "./ocrDaemon.js";

const CONTRACT_OCR_COMPARISON_MODELS = [
  "v4_mobile",
  "v5_server",
] as const satisfies readonly PaddleOcrModel[];

export interface ContractOcrModelComparisonField {
  field: string;
  originalValue: string;
  normalizedValue: string;
  confidence: number;
  source: string;
  pageNumber?: number;
  warnings: string[];
}

export interface ContractOcrModelComparisonResult {
  modelVersion: PaddleOcrModel;
  durationMs: number;
  status: "succeeded" | "partial" | "failed";
  method: string;
  fields: ContractOcrModelComparisonField[];
  ocrLineCount: number;
  warnings: string[];
}

/**
 * 对同一份合同串行运行两套模型，只返回诊断结果，不创建识别任务、
 * 不写入合同字段，也不改变现有自动采用规则。
 */
export async function compareContractOcrModels(
  filePath: string,
  mimeType: string,
  options: Pick<
    ContractRecognitionOptions,
    "expectedCategory" | "relationType" | "renewalMain"
  > = {},
): Promise<ContractOcrModelComparisonResult[]> {
  const results: ContractOcrModelComparisonResult[] = [];
  for (const modelVersion of CONTRACT_OCR_COMPARISON_MODELS) {
    const startedAt = performance.now();
    const recognition = await recognizeContractFile(filePath, mimeType, {
      ...options,
      ocrModel: modelVersion,
      diagnosticOcrOnly: true,
    });
    results.push({
      modelVersion,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      status: recognition.status,
      method: recognition.method,
      fields: recognition.fields.map((field) => ({
        field: field.field,
        originalValue: field.originalValue,
        normalizedValue: field.normalizedValue,
        // 现有接口字段名保持不变，值明确映射自字段规则评分。
        confidence: field.fieldScore ?? field.confidence,
        source: field.source,
        pageNumber: field.pageNumber,
        warnings: field.warnings || [],
      })),
      ocrLineCount: recognition.ocrLines.length,
      warnings: recognition.warnings,
    });
  }
  return results;
}
