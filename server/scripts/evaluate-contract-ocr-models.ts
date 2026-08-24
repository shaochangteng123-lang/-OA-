import fs from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import {
  recognizeContractFile,
  type ContractOcrField,
  type ContractOcrFieldName,
} from "../services/contractOcr.js";
import {
  PADDLE_OCR_MODELS,
  shutdownOcrDaemon,
  type PaddleOcrRequestModel,
} from "../services/ocrDaemon.js";

interface EvaluationSample {
  id: string;
  label: string;
  filePath: string;
  mimeType?: string;
  expectedCategory?: "main_business" | "non_main" | "asset";
  relationType?: "main" | "supplement" | "termination";
  focus?: string[];
  expected?: Partial<Record<EvaluationFieldName, string | null>>;
}

type EvaluationFieldName = Extract<
  ContractOcrFieldName,
  "party_a" | "party_b" | "project_name" | "amount" | "contract_date"
>;

const EVALUATION_FIELDS: readonly EvaluationFieldName[] = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "contract_date",
];
const ALL_EVALUATION_MODELS: readonly PaddleOcrRequestModel[] = [
  ...PADDLE_OCR_MODELS,
];

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function resolveModels(): PaddleOcrRequestModel[] {
  const requested = (optionValue("--models") || ALL_EVALUATION_MODELS.join(","))
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  const invalid = requested.filter(
    (model) => !(ALL_EVALUATION_MODELS as readonly string[]).includes(model),
  );
  if (invalid.length > 0) {
    throw new Error(`不支持的评测模型: ${invalid.join(", ")}`);
  }
  return [...new Set(requested)] as PaddleOcrRequestModel[];
}

function loadSamples(): EvaluationSample[] {
  const manifestArgument = optionValue("--manifest");
  if (!manifestArgument) {
    throw new Error("缺少 --manifest=/绝对路径/样本清单.json");
  }
  const manifestPath = path.resolve(manifestArgument);
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("样本清单必须是非空数组");
  }
  return parsed.map((sample, index) => {
    if (!sample || typeof sample !== "object") {
      throw new Error(`第 ${index + 1} 个样本格式无效`);
    }
    const candidate = sample as Partial<EvaluationSample>;
    if (!candidate.id || !candidate.label || !candidate.filePath) {
      throw new Error(`第 ${index + 1} 个样本缺少 id、label 或 filePath`);
    }
    if (!path.isAbsolute(candidate.filePath)) {
      throw new Error(`样本路径必须是绝对路径: ${candidate.filePath}`);
    }
    if (!fs.existsSync(candidate.filePath)) {
      throw new Error(`样本文件不存在: ${candidate.filePath}`);
    }
    return candidate as EvaluationSample;
  });
}

function fieldMatchesExpected(
  fieldName: EvaluationFieldName,
  actualValue: string,
  expectedValue: string | null | undefined,
): boolean | null {
  if (expectedValue === undefined || expectedValue === null) return null;
  if (fieldName === "amount") {
    const actualAmount = Number(actualValue.replace(/,/g, ""));
    const expectedAmount = Number(expectedValue.replace(/,/g, ""));
    return (
      Number.isFinite(actualAmount) &&
      Number.isFinite(expectedAmount) &&
      actualAmount === expectedAmount
    );
  }
  if (fieldName === "project_name") {
    return actualValue.includes(expectedValue);
  }
  return actualValue === expectedValue;
}

function summarizeField(
  fieldName: EvaluationFieldName,
  fields: readonly ContractOcrField[],
  expectedValue: string | null | undefined,
) {
  const field = fields.find((candidate) => candidate.field === fieldName);
  const value = field?.normalizedValue || "";
  return {
    value,
    originalValue: field?.originalValue || "",
    ocrConfidence: field?.ocrConfidence ?? null,
    fieldScore: field?.fieldScore ?? field?.confidence ?? 0,
    // 兼容既有报告读取方；其语义与 fieldScore（字段规则评分）相同。
    confidence: field?.confidence || 0,
    correct: fieldMatchesExpected(fieldName, value, expectedValue),
    candidates: (field?.candidates || []).map((candidate) => ({
      value: candidate.normalizedValue,
      ocrConfidence: candidate.ocrConfidence,
      fieldScore: candidate.fieldScore,
      confidence: candidate.confidence,
      page: candidate.pageNumber,
    })),
    warnings: field?.warnings || [],
  };
}

async function evaluateSample(
  sample: EvaluationSample,
  model: PaddleOcrRequestModel,
) {
  const startedAt = performance.now();
  const recognition = await recognizeContractFile(
    sample.filePath,
    sample.mimeType || "application/pdf",
    {
      expectedCategory: sample.expectedCategory,
      relationType: sample.relationType,
      ocrModel: model,
      diagnosticOcrOnly: true,
    },
  );
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
  const confidenceTotal = recognition.ocrLines.reduce(
    (total, line) => total + line.confidence,
    0,
  );
  const conflictWarnings = [
    ...recognition.warnings,
    ...recognition.fields.flatMap((field) => field.warnings || []),
  ].filter((warning) => warning.includes("候选冲突"));
  const fields = Object.fromEntries(
    EVALUATION_FIELDS.map((fieldName) => [
      fieldName,
      summarizeField(
        fieldName,
        recognition.fields,
        sample.expected?.[fieldName],
      ),
    ]),
  );
  return {
    sampleId: sample.id,
    label: sample.label,
    focus: sample.focus || [],
    model,
    status: recognition.status,
    durationMs,
    characterCount: recognition.ocrLines.reduce(
      (total, line) => total + line.text.length,
      0,
    ),
    lineCount: recognition.ocrLines.length,
    averageConfidence:
      recognition.ocrLines.length > 0
        ? confidenceTotal / recognition.ocrLines.length
        : 0,
    fields,
    candidateConflictCount: new Set(conflictWarnings).size,
    candidateConflictWarnings: [...new Set(conflictWarnings)],
    warnings: recognition.warnings,
  };
}

async function main(): Promise<void> {
  const samples = loadSamples();
  const models = resolveModels();
  const results: Array<Awaited<ReturnType<typeof evaluateSample>>> = [];
  for (const sample of samples) {
    for (const model of models) {
      const result = await evaluateSample(sample, model);
      results.push(result);
      process.stderr.write(
        `已完成 ${sample.label} / ${model}: ${(result.durationMs / 1000).toFixed(1)} 秒\n`,
      );
    }
  }
  const summary = models.map((model) => {
    const modelResults = results.filter((result) => result.model === model);
    const total = (key: "durationMs" | "characterCount" | "lineCount") =>
      modelResults.reduce((sum, result) => sum + result[key], 0);
    return {
      model,
      sampleCount: modelResults.length,
      totalDurationMs: total("durationMs"),
      averageDurationMs: Math.round(total("durationMs") / modelResults.length),
      totalCharacterCount: total("characterCount"),
      totalLineCount: total("lineCount"),
      averageConfidence:
        modelResults.reduce(
          (sum, result) => sum + result.averageConfidence,
          0,
        ) / modelResults.length,
      candidateConflictCount: modelResults.reduce(
        (sum, result) => sum + result.candidateConflictCount,
        0,
      ),
    };
  });
  const serialized = `${JSON.stringify({ results, summary }, null, 2)}\n`;
  const outputArgument = optionValue("--output");
  if (outputArgument) {
    const outputPath = path.resolve(outputArgument);
    fs.writeFileSync(outputPath, serialized, { encoding: "utf8", mode: 0o600 });
    process.stderr.write(`评测结果已写入 ${outputPath}\n`);
  } else {
    process.stdout.write(serialized);
  }
}

main()
  .catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => {
    shutdownOcrDaemon();
  });
