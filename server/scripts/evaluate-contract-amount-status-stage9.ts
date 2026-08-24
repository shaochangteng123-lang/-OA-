import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getContractAmountBreakdown,
  getContractAmountStatus,
  parseContractText,
  recognizeContractFile,
  type ContractAmountStatus,
  type ContractRecognitionResult,
} from "../services/contractOcr.js";

const EXPECTED_DIAGNOSTIC_STATUSES: Record<string, ContractAmountStatus> = {
  D01: "payment_only",
  D02: "payment_only",
  D03: "calculated_amount",
  D04: "payment_only",
  D05: "payment_only",
  D06: "missing_amount",
  D07: "payment_only",
};
const ALL_STATUSES: ContractAmountStatus[] = [
  "confirmed_amount",
  "calculated_amount",
  "payment_only",
  "missing_amount",
];
const EXPECTED_MODEL = "v6_medium";

interface Stage8DiagnosticRecord {
  diagnosticId?: string;
  fixedConfiguration?: {
    ocrModel?: string;
    relationType?: "main" | "supplement" | "termination";
  };
  recognition?: {
    rawText?: string;
  };
}

interface Stage7AuditRecord {
  recordType?: string;
  ocrModel?: string;
  category?: string;
  extension?: string;
  size?: number;
  sha256?: string;
  relativePath?: string;
  error?: string;
  result?: {
    fields?: Array<{
      field?: string;
      normalizedValue?: unknown;
      candidates?: unknown[];
      warnings?: unknown[];
    }>;
  };
}

interface EvaluatedCase {
  sampleId: string;
  sourceKind: "frozen_private_snapshot" | "immutable_live_file";
  expectedStatus: ContractAmountStatus;
  actualStatus: ContractAmountStatus | null;
  amountValuePresent: boolean;
  recognitionFailed: boolean;
  emptyAmountPreserved: boolean;
  calculatedDeltaPreserved: boolean | null;
  passed: boolean;
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const prefix = `${name}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    } else if (argument.startsWith(prefix)) {
      values.push(argument.slice(prefix.length));
    }
  }
  return values;
}

function optionValue(name: string): string | undefined {
  return optionValues(name)[0];
}

function defaultStage8Paths(projectRoot: string): string[] {
  return Array.from({ length: 4 }, (_, index) =>
    path.join(
      projectRoot,
      `debug/contract-ocr-stage8-private/stage8-after-shard${index}.jsonl`,
    ),
  );
}

function defaultStage7Paths(projectRoot: string): string[] {
  return Array.from({ length: 4 }, (_, index) =>
    path.join(
      projectRoot,
      `debug/contract-ocr-v6-holdout-50-stage7-shard${index}.jsonl`,
    ),
  );
}

function readJsonLines<T>(filePath: string): T[] {
  return fs
    .readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        throw new Error(
          `${path.basename(filePath)} 第 ${index + 1} 行不是合法 JSON（JavaScript 对象表示法）`,
        );
      }
    });
}

function amountField(result: ContractRecognitionResult) {
  return result.fields.find((field) => field.field === "amount");
}

function evaluateResult(
  sampleId: string,
  sourceKind: EvaluatedCase["sourceKind"],
  expectedStatus: ContractAmountStatus,
  result: ContractRecognitionResult,
): EvaluatedCase {
  const actualStatus = getContractAmountStatus(result);
  const field = amountField(result);
  const breakdown = getContractAmountBreakdown(result);
  const amountValuePresent = Boolean(field?.normalizedValue);
  const recognitionFailed = result.status === "failed";
  const shouldBeEmpty =
    expectedStatus === "payment_only" || expectedStatus === "missing_amount";
  const emptyAmountPreserved =
    !shouldBeEmpty ||
    (!amountValuePresent &&
      breakdown?.originalAmount == null &&
      breakdown?.changeAmount == null &&
      breakdown?.finalAmount == null);
  const calculatedDeltaPreserved =
    expectedStatus !== "calculated_amount"
      ? null
      : Boolean(
          field?.normalizedValue &&
          breakdown?.changeAmount != null &&
          breakdown.originalAmount != null &&
          breakdown.finalAmount != null &&
          Number(field.normalizedValue) === breakdown.changeAmount &&
          Math.round(
            (breakdown.originalAmount + breakdown.changeAmount) * 100,
          ) /
            100 ===
            breakdown.finalAmount,
        );
  return {
    sampleId,
    sourceKind,
    expectedStatus,
    actualStatus,
    amountValuePresent,
    recognitionFailed,
    emptyAmountPreserved,
    calculatedDeltaPreserved,
    passed:
      !recognitionFailed &&
      actualStatus === expectedStatus &&
      emptyAmountPreserved &&
      calculatedDeltaPreserved !== false,
  };
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

function safeSourcePath(inputRoot: string, relativePath: string): string {
  const resolvedRoot = path.resolve(inputRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("离线金额状态样本越过输入目录");
  }
  return resolvedPath;
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

function selectConfirmedLiveRecord(
  records: Stage7AuditRecord[],
): Stage7AuditRecord {
  const candidates = records
    .filter((record) => {
      if (
        record.recordType !== "recognition_result" ||
        record.error ||
        record.ocrModel !== EXPECTED_MODEL ||
        record.category !== "主合同或其他合同" ||
        record.extension !== "docx" ||
        typeof record.relativePath !== "string" ||
        typeof record.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(record.sha256) ||
        !Number.isSafeInteger(record.size)
      ) {
        return false;
      }
      const field = record.result?.fields?.find(
        (item) => item.field === "amount",
      );
      return (
        typeof field?.normalizedValue === "string" &&
        field.normalizedValue.length > 0 &&
        field.candidates?.length === 1 &&
        !(field.warnings || []).some((warning) =>
          String(warning).includes("候选冲突"),
        )
      );
    })
    .sort((left, right) =>
      String(left.sha256).localeCompare(String(right.sha256)),
    );
  if (candidates.length === 0) {
    throw new Error("没有可用于明确金额离线复跑的真实 DOCX（文档格式）合同");
  }
  return candidates[0];
}

async function evaluateConfirmedLiveCase(
  record: Stage7AuditRecord,
  inputRoot: string,
): Promise<EvaluatedCase> {
  const relativePath = record.relativePath!;
  if (
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).includes("..") ||
    relativePath.includes("\u0000")
  ) {
    throw new Error("明确金额真实样本包含越界相对路径");
  }
  const sourcePath = safeSourcePath(inputRoot, relativePath);
  const stat = await fs.promises.stat(sourcePath);
  if (!stat.isFile() || stat.size !== record.size) {
    throw new Error("明确金额真实样本大小或类型与冻结记录不一致");
  }
  if ((await sha256File(sourcePath)) !== record.sha256) {
    throw new Error("明确金额真实样本摘要与冻结记录不一致");
  }

  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "contract-amount-status-stage9-"),
  );
  const copiedPath = path.join(temporaryDirectory, "source.docx");
  try {
    await fs.promises.copyFile(sourcePath, copiedPath);
    const result = await recognizeContractFile(
      copiedPath,
      mimeTypeFor(record.extension!),
      {
        relationType: relationTypeForCategory(record.category!),
        expectedCategory: "main_business",
        ocrModel: EXPECTED_MODEL,
      },
    );
    if ((await sha256File(sourcePath)) !== record.sha256) {
      throw new Error("明确金额真实样本在离线复跑后发生变化");
    }
    return evaluateResult(
      "CONFIRMED-REAL-001",
      "immutable_live_file",
      "confirmed_amount",
      result,
    );
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function statusCounts(cases: readonly EvaluatedCase[]) {
  return Object.fromEntries(
    ALL_STATUSES.map((status) => [
      status,
      cases.filter((item) => item.actualStatus === status).length,
    ]),
  ) as Record<ContractAmountStatus, number>;
}

function writePublicResult(filePath: string, value: unknown): void {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  if (fs.existsSync(resolvedPath)) {
    throw new Error("第九阶段金额状态离线结果已存在，拒绝覆盖");
  }
  const temporaryPath = `${resolvedPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o644,
      flag: "wx",
    });
    fs.renameSync(temporaryPath, resolvedPath);
    fs.chmodSync(resolvedPath, 0o644);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const stage8Paths = optionValues("--stage8-input").map((value) =>
    path.resolve(value),
  );
  const stage7Paths = optionValues("--stage7-input").map((value) =>
    path.resolve(value),
  );
  const diagnosticRecords = (
    stage8Paths.length > 0 ? stage8Paths : defaultStage8Paths(projectRoot)
  ).flatMap((filePath) => readJsonLines<Stage8DiagnosticRecord>(filePath));
  const diagnosticById = new Map(
    diagnosticRecords.map((record) => [record.diagnosticId, record]),
  );
  if (
    diagnosticRecords.length !== 7 ||
    diagnosticById.size !== 7 ||
    Object.keys(EXPECTED_DIAGNOSTIC_STATUSES).some(
      (diagnosticId) => !diagnosticById.has(diagnosticId),
    )
  ) {
    throw new Error("第九阶段必须读取完整且唯一的7份第八阶段真实诊断记录");
  }

  const cases: EvaluatedCase[] = [];
  for (const [diagnosticId, expectedStatus] of Object.entries(
    EXPECTED_DIAGNOSTIC_STATUSES,
  )) {
    const record = diagnosticById.get(diagnosticId)!;
    if (
      record.fixedConfiguration?.ocrModel !== EXPECTED_MODEL ||
      !record.fixedConfiguration.relationType ||
      typeof record.recognition?.rawText !== "string"
    ) {
      throw new Error(`${diagnosticId} 的模型、关系或识别全文不完整`);
    }
    const result = parseContractText(record.recognition.rawText, {
      relationType: record.fixedConfiguration.relationType,
    });
    cases.push(
      evaluateResult(
        diagnosticId,
        "frozen_private_snapshot",
        expectedStatus,
        result,
      ),
    );
  }

  const stage7Records = (
    stage7Paths.length > 0 ? stage7Paths : defaultStage7Paths(projectRoot)
  ).flatMap((filePath) => readJsonLines<Stage7AuditRecord>(filePath));
  cases.push(
    await evaluateConfirmedLiveCase(
      selectConfirmedLiveRecord(stage7Records),
      path.resolve(
        optionValue("--input-root") ||
          process.env.CONTRACT_AUDIT_INPUT_ROOT ||
          "/tmp/contract-audit-input",
      ),
    ),
  );

  const counts = statusCounts(cases);
  const expectedCounts = Object.fromEntries(
    ALL_STATUSES.map((status) => [
      status,
      cases.filter((item) => item.expectedStatus === status).length,
    ]),
  );
  const passed =
    cases.every((item) => item.passed) &&
    ALL_STATUSES.every((status) => counts[status] > 0);
  const output = {
    schemaVersion: 1,
    reportDate: new Date().toISOString().slice(0, 10),
    model: EXPECTED_MODEL,
    total: cases.length,
    passed,
    expectedStatusCounts: expectedCounts,
    actualStatusCounts: counts,
    cases,
    privacy: {
      includesDocumentPaths: false,
      includesDocumentDigests: false,
      includesAmountValues: false,
      includesRawText: false,
    },
    invariants: {
      databaseWritten: false,
      apiStructureChanged: false,
      emptyAmountConvertedToZero: false,
      paymentPromotedToContractAmount: false,
    },
  };
  writePublicResult(
    optionValue("--output") ||
      path.join(
        projectRoot,
        "debug/contract-ocr-stage9-amount-status-real-replay.json",
      ),
    output,
  );
  console.log(
    `第九阶段真实合同金额状态离线回放完成：${cases.filter((item) => item.passed).length}/${cases.length} 通过。`,
  );
  if (!passed) process.exitCode = 2;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
