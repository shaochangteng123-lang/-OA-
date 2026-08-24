import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  getContractAmountAutomaticAdoptionContext,
  getContractOcrAutomaticAdoptionSafetyContext,
  getContractAmountBreakdown,
  recognizeContractFile,
} from "../services/contractOcr.js";
import {
  CONTRACT_OCR_AUTOMATIC_POLICY_VERSION,
  decideContractAutomaticOcrAdoption,
} from "../services/contractService.js";

const DIAGNOSTIC_SCHEMA_VERSION = 1;
const EXPECTED_DIAGNOSTIC_COUNT = 7;
const EXPECTED_OCR_MODEL = "v6_medium";

interface Stage7Record {
  recordType?: string;
  ocrModel?: string;
  category?: string;
  extension?: string;
  size?: number;
  sha256?: string;
  relativePath?: string;
  error?: string;
  result?: {
    automaticReady?: boolean;
    automaticAdoption?: {
      blockers?: string[];
    };
    fields?: Array<{
      field?: string;
      normalizedValue?: unknown;
      candidates?: unknown[];
    }>;
  };
}

function optionValue(name: string): string | undefined {
  const directIndex = process.argv.indexOf(name);
  if (directIndex >= 0) return process.argv[directIndex + 1];
  const prefix = `${name}=`;
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function integerOption(name: string, fallback: number): number {
  const value = optionValue(name);
  if (value == null) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} 必须是非负整数`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} 超出安全范围`);
  return parsed;
}

function defaultRawPaths(projectRoot: string): string[] {
  return Array.from({ length: 4 }, (_, index) =>
    path.join(
      projectRoot,
      `debug/contract-ocr-v6-holdout-50-stage7-shard${index}.jsonl`,
    ),
  );
}

function readJsonLines(filePath: string): Stage7Record[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as Stage7Record;
      } catch {
        throw new Error(
          `${path.basename(filePath)} 第 ${index + 1} 行不是合法 JSON`,
        );
      }
    });
}

function selectDiagnosticRecords(rawPaths: readonly string[]): Stage7Record[] {
  const selected = rawPaths
    .flatMap(readJsonLines)
    .filter((record) => record.result?.automaticReady === false)
    .sort((left, right) =>
      String(left.sha256).localeCompare(String(right.sha256)),
    );

  if (selected.length !== EXPECTED_DIAGNOSTIC_COUNT) {
    throw new Error(
      `第七阶段失败诊断样本必须恰好为 ${EXPECTED_DIAGNOSTIC_COUNT} 份，实际为 ${selected.length} 份`,
    );
  }
  const sha256Values = new Set<string>();
  for (const record of selected) {
    if (record.recordType !== "recognition_result" || record.error) {
      throw new Error("诊断样本必须来自无外层错误的识别结果");
    }
    if (record.ocrModel !== EXPECTED_OCR_MODEL) {
      throw new Error("诊断样本 OCR 模型不是固定的 v6_medium");
    }
    if (
      !record.category ||
      !record.extension ||
      !record.relativePath ||
      !Number.isSafeInteger(record.size) ||
      !/^[a-f0-9]{64}$/i.test(record.sha256 || "")
    ) {
      throw new Error("诊断样本元数据不完整");
    }
    if (
      path.isAbsolute(record.relativePath) ||
      record.relativePath.split(/[\\/]/).includes("..") ||
      record.relativePath.includes("\u0000")
    ) {
      throw new Error("诊断样本包含越界相对路径");
    }
    if (sha256Values.has(record.sha256!)) {
      throw new Error("诊断样本存在重复 SHA-256");
    }
    sha256Values.add(record.sha256!);
  }
  return selected;
}

function relationTypeForCategory(
  category: string,
): "main" | "supplement" | "termination" {
  return category === "补充协议"
    ? "supplement"
    : category === "解除或终止协议"
      ? "termination"
      : "main";
}

function mimeTypeFor(extension: string): string {
  const types: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  return types[extension.toLowerCase()] || "application/octet-stream";
}

async function sha256File(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => digest.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return digest.digest("hex");
}

function safeSourcePath(inputRoot: string, relativePath: string): string {
  const resolvedRoot = path.resolve(inputRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("诊断源文件越过输入目录");
  }
  return resolvedPath;
}

function compactStage7Baseline(record: Stage7Record) {
  return {
    automaticReady: record.result?.automaticReady === true,
    blockers: record.result?.automaticAdoption?.blockers || [],
    fields: (record.result?.fields || []).map((field) => ({
      field: field.field,
      hasSelectedValue:
        field.normalizedValue != null && field.normalizedValue !== "",
      candidateCount: field.candidates?.length || 0,
    })),
  };
}

function appendPrivateRecord(outputPath: string, value: unknown): void {
  fs.appendFileSync(outputPath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.chmodSync(outputPath, 0o600);
}

async function recognizeDiagnosticRecord(
  record: Stage7Record,
  diagnosticId: string,
  inputRoot: string,
  runLabel: string,
) {
  const sourcePath = safeSourcePath(inputRoot, record.relativePath!);
  const stat = await fs.promises.stat(sourcePath);
  if (!stat.isFile() || stat.size !== record.size) {
    throw new Error(`${diagnosticId} 源文件大小或类型与冻结记录不一致`);
  }
  if ((await sha256File(sourcePath)) !== record.sha256) {
    throw new Error(`${diagnosticId} 源文件摘要与冻结记录不一致`);
  }

  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "contract-ocr-stage8-diagnostic-"),
  );
  const safeExtension = record.extension!.replace(/[^a-z0-9]/gi, "") || "bin";
  const copiedPath = path.join(temporaryDirectory, `source.${safeExtension}`);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  try {
    await fs.promises.copyFile(sourcePath, copiedPath);
    if ((await sha256File(copiedPath)) !== record.sha256) {
      throw new Error(`${diagnosticId} 识别副本摘要不一致`);
    }
    const relationType = relationTypeForCategory(record.category!);
    const result = await recognizeContractFile(
      copiedPath,
      mimeTypeFor(record.extension!),
      {
        relationType,
        expectedCategory: "main_business",
        ocrModel: EXPECTED_OCR_MODEL,
      },
    );
    const automaticAdoption = decideContractAutomaticOcrAdoption({
      resultStatus: result.status,
      failureKind: result.failureKind,
      relationType,
      declaredCategory: "main_business",
      rawText: result.rawText,
      fields: result.fields,
      amountContext: getContractAmountAutomaticAdoptionContext(result),
      safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
    });
    if ((await sha256File(sourcePath)) !== record.sha256) {
      throw new Error(`${diagnosticId} 识别后源文件摘要发生变化`);
    }
    return {
      schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      runLabel,
      diagnosticId,
      source: {
        category: record.category,
        extension: record.extension,
        size: record.size,
        sha256: record.sha256,
        relativePath: record.relativePath,
      },
      fixedConfiguration: {
        ocrModel: EXPECTED_OCR_MODEL,
        expectedCategory: "main_business",
        relationType,
        automaticPolicyVersion: CONTRACT_OCR_AUTOMATIC_POLICY_VERSION,
      },
      stage7Baseline: compactStage7Baseline(record),
      recognition: {
        status: result.status,
        failureKind: result.failureKind,
        method: result.method,
        modelVersion: result.modelVersion,
        rawText: result.rawText,
        ocrLines: result.ocrLines,
        fields: result.fields,
        amountBreakdown: getContractAmountBreakdown(result),
        warnings: result.warnings,
      },
      automaticAdoption,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    };
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const inputRoot = path.resolve(
    optionValue("--input") ||
      process.env.CONTRACT_AUDIT_INPUT_ROOT ||
      "/tmp/contract-audit-input",
  );
  const rawPaths = (optionValue("--raw") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));
  const selected = selectDiagnosticRecords(
    rawPaths.length > 0 ? rawPaths : defaultRawPaths(projectRoot),
  );
  const shardCount = integerOption("--shard-count", 1);
  const shardIndex = integerOption("--shard-index", 0);
  if (shardCount < 1 || shardCount > 4) {
    throw new Error("--shard-count 必须是 1 至 4 的整数");
  }
  if (shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error("--shard-index 必须小于 --shard-count");
  }
  const runLabel = optionValue("--run-label") || "stage8-baseline";
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(runLabel)) {
    throw new Error("--run-label 格式无效");
  }
  const diagnosticIdFilter = optionValue("--diagnostic-id");
  if (diagnosticIdFilter != null && !/^D0[1-7]$/.test(diagnosticIdFilter)) {
    throw new Error("--diagnostic-id 仅支持 D01 至 D07");
  }

  const assigned = selected
    .map((record, index) => ({
      record,
      diagnosticId: `D${String(index + 1).padStart(2, "0")}`,
      index,
    }))
    .filter(
      ({ index, diagnosticId }) =>
        index % shardCount === shardIndex &&
        (diagnosticIdFilter == null || diagnosticId === diagnosticIdFilter),
    );
  if (assigned.length === 0) {
    throw new Error("当前分片没有匹配的诊断样本");
  }
  const outputPath = path.resolve(
    optionValue("--output") ||
      path.join(
        projectRoot,
        `debug/contract-ocr-stage8-private/${runLabel}-shard${shardIndex}.jsonl`,
      ),
  );
  await fs.promises.mkdir(path.dirname(outputPath), {
    recursive: true,
    mode: 0o700,
  });
  await fs.promises.chmod(path.dirname(outputPath), 0o700);
  const outputHandle = await fs.promises.open(outputPath, "wx", 0o600);
  await outputHandle.close();

  for (const { record, diagnosticId } of assigned) {
    console.log(`${diagnosticId} 开始诊断识别`);
    const result = await recognizeDiagnosticRecord(
      record,
      diagnosticId,
      inputRoot,
      runLabel,
    );
    appendPrivateRecord(outputPath, result);
    console.log(`${diagnosticId} 诊断识别完成`);
  }
  console.log(
    `分片 ${shardIndex + 1}/${shardCount} 完成，共 ${assigned.length} 份`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
