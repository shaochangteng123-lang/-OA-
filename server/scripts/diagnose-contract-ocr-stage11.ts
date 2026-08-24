import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getContractAmountAutomaticAdoptionContext,
  getContractOcrAutomaticAdoptionSafetyContext,
  getContractAmountBreakdown,
  getContractAmountStatus,
  getContractOcrCandidateFunnelIsolationProof,
  getContractOcrCandidateFunnelTrace,
  recognizeContractFile,
  type ContractRecognitionResult,
} from "../services/contractOcr.js";
import {
  CONTRACT_OCR_FUNNEL_DIAGNOSTIC_SCHEMA_VERSION,
  contractOcrDocumentFailureStage,
  diagnoseContractOcrCandidateFunnel,
  earliestContractOcrFunnelFailureStage,
  summarizeContractOcrCandidateFunnel,
  type ContractOcrFieldFunnelDiagnostic,
  type ContractOcrFunnelGroundTruth,
} from "../services/contractOcrCandidateFunnel.js";
import { shutdownOcrDaemon } from "../services/ocrDaemon.js";
import {
  CONTRACT_OCR_AUTOMATIC_POLICY_VERSION,
  decideContractAutomaticOcrAdoption,
} from "../services/contractService.js";

const FIXED_OCR_MODEL = "v6_medium" as const;
const LOCKED_DIAGNOSTIC_DATASET_VERSION =
  "company-contract-preliminary-2026-08-10";
const LOCKED_DIAGNOSTIC_GROUND_TRUTH_VERSION =
  "company-contract-preliminary-ground-truth-v1";
const LOCKED_DIAGNOSTIC_GROUND_TRUTH_SHA256 =
  "695e950c47a4932eb119c9d9520633d5f92930d58da156c01e4472ffa8b20451";
const LOCKED_DIAGNOSTIC_SAMPLE_COUNT = 12;
const PRIVATE_OUTPUT_ROOT = path.resolve(
  process.cwd(),
  "debug/contract-ocr-stage11-private",
);

type DeclaredCategory = "main_business" | "non_main" | "asset";
type RelationType = "main" | "supplement" | "termination";

interface GroundTruthSample {
  id: string;
  familyId?: string;
  relativePath: string;
  sha256: string;
  relationType: RelationType;
  declaredCategory?: DeclaredCategory;
  eligibility?: string;
  replayEligible?: boolean;
  expected: ContractOcrFunnelGroundTruth & Record<string, unknown>;
}

interface GroundTruthDocument {
  datasetVersion?: string;
  version?: string;
  samples: GroundTruthSample[];
}

interface ScriptOptions {
  groundTruthPath: string;
  inputRoot: string;
  outputPath: string;
  runId: string;
  sampleIds: Set<string>;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function repeatedOptionValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function parseOptions(): ScriptOptions {
  const groundTruthPath = optionValue("--ground-truth");
  const inputRoot = optionValue("--input");
  const outputPath = optionValue("--output");
  const runId = optionValue("--run-id");
  if (!groundTruthPath || !inputRoot || !outputPath || !runId) {
    throw new Error("必须提供 --ground-truth、--input、--output 和 --run-id");
  }
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/u.test(runId)) {
    throw new Error("--run-id 只能包含小写字母、数字和连字符");
  }
  const resolvedOutput = path.resolve(outputPath);
  if (!resolvedOutput.startsWith(`${PRIVATE_OUTPUT_ROOT}${path.sep}`)) {
    throw new Error(
      "第十一阶段候选漏斗明细只能写入 debug/contract-ocr-stage11-private 目录",
    );
  }
  if (fs.existsSync(resolvedOutput)) {
    throw new Error("诊断输出已存在，禁止覆盖历史证据");
  }
  return {
    groundTruthPath: path.resolve(groundTruthPath),
    inputRoot: path.resolve(inputRoot),
    outputPath: resolvedOutput,
    runId,
    sampleIds: new Set(repeatedOptionValues("--sample-id")),
  };
}

function readGroundTruth(filePath: string): GroundTruthDocument {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("人工真值文件不是有效对象");
  }
  const document = parsed as GroundTruthDocument;
  if (!Array.isArray(document.samples) || document.samples.length === 0) {
    throw new Error("人工真值文件没有样本");
  }
  return document;
}

function isValidGroundTruthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function validateSamples(
  document: GroundTruthDocument,
  options: ScriptOptions,
): GroundTruthSample[] {
  if (
    document.datasetVersion !== LOCKED_DIAGNOSTIC_DATASET_VERSION ||
    document.version !== LOCKED_DIAGNOSTIC_GROUND_TRUTH_VERSION ||
    document.samples.length !== LOCKED_DIAGNOSTIC_SAMPLE_COUNT
  ) {
    throw new Error("人工真值不是冻结的第十一阶段12份公司合同诊断集");
  }
  const allFamilyIds = document.samples.map((sample) => sample.familyId);
  if (
    allFamilyIds.some((familyId) => !familyId) ||
    new Set(allFamilyIds).size !== LOCKED_DIAGNOSTIC_SAMPLE_COUNT
  ) {
    throw new Error("第十一阶段诊断集必须包含12个互不重复的合同族");
  }
  const selected = document.samples.filter(
    (sample) =>
      options.sampleIds.size === 0 || options.sampleIds.has(sample.id),
  );
  if (selected.length === 0) throw new Error("没有选中任何诊断样本");
  const ids = new Set<string>();
  const digests = new Set<string>();
  for (const sample of selected) {
    const expectedKeys = [
      "party_a",
      "party_b",
      "project_name",
      "amount",
      "contract_date",
    ] as const;
    if (
      !sample.id ||
      !sample.relativePath ||
      !/^[a-f0-9]{64}$/iu.test(sample.sha256 || "") ||
      !new Set(["main", "supplement", "termination"]).has(
        sample.relationType,
      ) ||
      !sample.expected ||
      typeof sample.expected !== "object"
    ) {
      throw new Error("诊断样本缺少编号、路径、摘要、合同层级或人工真值");
    }
    if (
      expectedKeys.some(
        (field) =>
          !Object.prototype.hasOwnProperty.call(sample.expected, field) ||
          (sample.expected[field] !== null &&
            (typeof sample.expected[field] !== "string" ||
              !sample.expected[field]?.trim())),
      )
    ) {
      throw new Error(`${sample.id} 的五个字段人工真值不完整或类型不正确`);
    }
    if (
      (sample.expected.amount != null &&
        !/^[+-]?\d+(?:\.\d{1,2})?$/u.test(sample.expected.amount)) ||
      (sample.expected.contract_date != null &&
        !isValidGroundTruthDate(sample.expected.contract_date))
    ) {
      throw new Error(`${sample.id} 的金额或日期人工真值格式不正确`);
    }
    if (
      !new Set([
        "confirmed_amount",
        "calculated_amount",
        "payment_only",
        "missing_amount",
      ]).has(String(sample.expected.amountStatus || ""))
    ) {
      throw new Error(`${sample.id} 缺少有效的金额状态人工真值`);
    }
    const breakdown = sample.expected.amountBreakdown;
    if (
      !breakdown ||
      typeof breakdown !== "object" ||
      (["originalAmount", "changeAmount", "finalAmount"] as const).some(
        (field) => {
          const value = breakdown[field];
          return (
            value !== null &&
            !(typeof value === "number" && Number.isFinite(value))
          );
        },
      )
    ) {
      throw new Error(`${sample.id} 缺少完整的金额拆分人工真值`);
    }
    // 旧真值文件的准入结论由上方固定文件摘要整体锁定；若记录中显式提供
    // 准入字段，则任何非合同或不可回放标记仍立即失败。
    if (sample.eligibility && sample.eligibility !== "contract") {
      throw new Error(`${sample.id} 不是合同，不得进入合同候选漏斗诊断`);
    }
    if (sample.replayEligible === false) {
      throw new Error(`${sample.id} 已标记为不可回放`);
    }
    if (ids.has(sample.id) || digests.has(sample.sha256)) {
      throw new Error("诊断样本存在重复编号或重复文件摘要");
    }
    declaredCategoryForSample(sample);
    ids.add(sample.id);
    digests.add(sample.sha256);
  }
  if (
    options.sampleIds.size > 0 &&
    [...options.sampleIds].some((id) => !ids.has(id))
  ) {
    throw new Error("--sample-id 包含人工真值中不存在的编号");
  }
  return selected;
}

function declaredCategoryForSample(
  sample: GroundTruthSample,
): DeclaredCategory {
  if (sample.declaredCategory) {
    if (
      !new Set(["main_business", "non_main", "asset"]).has(
        sample.declaredCategory,
      )
    ) {
      throw new Error(`${sample.id} 的 declaredCategory 不合法`);
    }
    return sample.declaredCategory;
  }
  const topFolder = sample.relativePath.split(/[\\/]/u)[0];
  const categoriesByFolder: Record<string, DeclaredCategory> = {
    项目合同: "main_business",
    非主营项目合同: "non_main",
    资产类合同: "asset",
    租房合同: "non_main",
    网费: "non_main",
    车位费: "non_main",
  };
  const derived = categoriesByFolder[topFolder];
  if (!derived) {
    throw new Error(`${sample.id} 无法从冻结目录分类推导声明分类`);
  }
  return derived;
}

function mimeTypeFor(filePath: string): string {
  const types: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
  };
  const mimeType = types[path.extname(filePath).toLowerCase()];
  if (!mimeType) throw new Error("诊断样本文件格式不受支持");
  return mimeType;
}

async function sha256File(filePath: string): Promise<string> {
  const digest = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => digest.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return digest.digest("hex");
}

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function safeSourcePath(
  inputRoot: string,
  relativePath: string,
): Promise<string> {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\u0000") ||
    relativePath.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("诊断样本相对路径不安全");
  }
  const realRoot = await fs.promises.realpath(inputRoot);
  const resolvedPath = path.resolve(realRoot, relativePath);
  const sourceStat = await fs.promises.lstat(resolvedPath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("诊断源必须是普通文件且不能是符号链接");
  }
  const realSource = await fs.promises.realpath(resolvedPath);
  if (!realSource.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error("诊断源文件越过输入目录");
  }
  return realSource;
}

async function preparePrivateOutput(outputPath: string): Promise<void> {
  const privateOutputParent = path.dirname(PRIVATE_OUTPUT_ROOT);
  if (fs.existsSync(privateOutputParent)) {
    const privateParentStat = await fs.promises.lstat(privateOutputParent);
    if (
      privateParentStat.isSymbolicLink() ||
      !privateParentStat.isDirectory()
    ) {
      throw new Error("第十一阶段私有输出上级目录不能是符号链接或普通文件");
    }
  }
  if (fs.existsSync(PRIVATE_OUTPUT_ROOT)) {
    const privateRootStat = await fs.promises.lstat(PRIVATE_OUTPUT_ROOT);
    if (privateRootStat.isSymbolicLink() || !privateRootStat.isDirectory()) {
      throw new Error("第十一阶段私有输出根目录不能是符号链接或普通文件");
    }
  }
  await fs.promises.mkdir(PRIVATE_OUTPUT_ROOT, {
    recursive: true,
    mode: 0o700,
  });
  await fs.promises.chmod(PRIVATE_OUTPUT_ROOT, 0o700);
  const realPrivateRoot = await fs.promises.realpath(PRIVATE_OUTPUT_ROOT);
  const realWorkspaceRoot = await fs.promises.realpath(process.cwd());
  if (!realPrivateRoot.startsWith(`${realWorkspaceRoot}${path.sep}`)) {
    throw new Error("第十一阶段私有输出目录越过当前仓库");
  }
  const realPrivateParent = await fs.promises.realpath(
    path.dirname(PRIVATE_OUTPUT_ROOT),
  );
  const expectedRealPrivateRoot = path.join(
    realPrivateParent,
    path.basename(PRIVATE_OUTPUT_ROOT),
  );
  if (realPrivateRoot !== expectedRealPrivateRoot) {
    throw new Error("第十一阶段私有输出根目录越过仓库固定位置");
  }
  const outputDirectory = path.dirname(outputPath);
  await fs.promises.mkdir(outputDirectory, {
    recursive: true,
    mode: 0o700,
  });
  const realOutputDirectory = await fs.promises.realpath(outputDirectory);
  if (
    realOutputDirectory !== realPrivateRoot &&
    !realOutputDirectory.startsWith(`${realPrivateRoot}${path.sep}`)
  ) {
    throw new Error("诊断输出目录通过符号链接越过私有目录");
  }
  await fs.promises.chmod(realOutputDirectory, 0o700);
}

function stableBusinessProjection(
  result: ContractRecognitionResult,
  decision: ReturnType<typeof decideContractAutomaticOcrAdoption>,
): string {
  return JSON.stringify({
    result,
    amountBreakdown: getContractAmountBreakdown(result),
    amountStatus: getContractAmountStatus(result),
    amountContext: getContractAmountAutomaticAdoptionContext(result),
    safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
    automaticDecision: decision,
  });
}

function appendRecord(fileDescriptor: number, record: unknown): void {
  fs.writeSync(
    fileDescriptor,
    `${JSON.stringify(record)}\n`,
    undefined,
    "utf8",
  );
}

async function implementationDigests() {
  const files = [
    "server/services/contractOcr.ts",
    "server/services/contractOcrCandidateFunnel.ts",
    "server/services/contractService.ts",
    "server/services/ocrDaemon.ts",
    "server/scripts/diagnose-contract-ocr-stage11.ts",
    "server/scripts/paddle_ocr_worker.py",
    "server/scripts/prepare_ocr_v6_medium_models.py",
    "server/config/ocr-v6-medium.json",
    "package.json",
    "package-lock.json",
  ];
  return Object.fromEntries(
    await Promise.all(
      files.map(async (relativePath) => [
        relativePath,
        await sha256File(path.resolve(process.cwd(), relativePath)),
      ]),
    ),
  );
}

async function diagnoseSample(
  sample: GroundTruthSample,
  options: ScriptOptions,
) {
  const sourcePath = await safeSourcePath(
    options.inputRoot,
    sample.relativePath,
  );
  const beforeDigest = await sha256File(sourcePath);
  if (beforeDigest !== sample.sha256.toLowerCase()) {
    throw new Error(`${sample.id} 源文件摘要与人工真值不一致`);
  }
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "contract-ocr-stage11-"),
  );
  await fs.promises.chmod(temporaryDirectory, 0o700);
  const copiedPath = path.join(
    temporaryDirectory,
    `source${path.extname(sourcePath).toLowerCase()}`,
  );
  const startedMs = Date.now();
  try {
    await fs.promises.copyFile(sourcePath, copiedPath);
    if ((await sha256File(copiedPath)) !== beforeDigest) {
      throw new Error(`${sample.id} 诊断副本摘要不一致`);
    }
    const declaredCategory = declaredCategoryForSample(sample);
    const result = await recognizeContractFile(
      copiedPath,
      mimeTypeFor(copiedPath),
      {
        relationType: sample.relationType,
        expectedCategory: declaredCategory,
        ocrModel: FIXED_OCR_MODEL,
        candidateFunnelDiagnostics: true,
      },
    );
    if (
      result.ocrLines.some((line) => line.modelVersion !== FIXED_OCR_MODEL) ||
      (result.modelVersion && result.modelVersion !== FIXED_OCR_MODEL)
    ) {
      throw new Error(`${sample.id} 使用了非 v6_medium 的识别模型`);
    }
    const extension = path.extname(copiedPath).toLowerCase();
    if (
      [".pdf", ".jpg", ".jpeg", ".png"].includes(extension) &&
      (result.failureKind === "infrastructure" ||
        result.modelVersion !== FIXED_OCR_MODEL ||
        result.ocrLines.length === 0)
    ) {
      throw new Error(`${sample.id} 没有形成可核验的 v6_medium 逐行识别结果`);
    }
    const automaticDecision = decideContractAutomaticOcrAdoption({
      resultStatus: result.status,
      failureKind: result.failureKind,
      relationType: sample.relationType,
      declaredCategory,
      rawText: result.rawText,
      fields: result.fields,
      amountContext: getContractAmountAutomaticAdoptionContext(result),
      safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
    });
    const businessProjectionBefore = stableBusinessProjection(
      result,
      automaticDecision,
    );
    const trace = getContractOcrCandidateFunnelTrace(result);
    if (!getContractOcrCandidateFunnelIsolationProof(result)) {
      throw new Error(`${sample.id} 未形成诊断开关业务投影等价证明`);
    }
    const businessProjectionAfter = stableBusinessProjection(
      result,
      decideContractAutomaticOcrAdoption({
        resultStatus: result.status,
        failureKind: result.failureKind,
        relationType: sample.relationType,
        declaredCategory,
        rawText: result.rawText,
        fields: result.fields,
        amountContext: getContractAmountAutomaticAdoptionContext(result),
        safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
      }),
    );
    if (businessProjectionBefore !== businessProjectionAfter) {
      throw new Error(`${sample.id} 读取诊断轨迹改变了业务结果`);
    }
    const fieldDiagnostics = diagnoseContractOcrCandidateFunnel(
      result,
      trace,
      sample.expected,
      automaticDecision,
    );
    const fieldFirstFailureStage =
      earliestContractOcrFunnelFailureStage(fieldDiagnostics);
    const documentFirstFailureStage = contractOcrDocumentFailureStage(
      fieldDiagnostics,
      automaticDecision,
    );
    if ((await sha256File(sourcePath)) !== beforeDigest) {
      throw new Error(`${sample.id} 诊断后源文件摘要发生变化`);
    }
    return {
      recordType: "sample_diagnostic",
      schemaVersion: CONTRACT_OCR_FUNNEL_DIAGNOSTIC_SCHEMA_VERSION,
      sample: {
        id: sample.id,
        familyId: sample.familyId || null,
        relativePath: sample.relativePath,
        sha256: sample.sha256,
        relationType: sample.relationType,
        declaredCategory,
      },
      recognition: {
        status: result.status,
        failureKind: result.failureKind || null,
        method: result.method,
        modelVersion: result.modelVersion || null,
        rawText: result.rawText,
        ocrRawText: result.ocrLines.map((line) => line.text).join("\n"),
        ocrLines: result.ocrLines,
        fields: result.fields,
        warnings: result.warnings,
      },
      candidateFunnel: trace,
      automaticAdoption: automaticDecision,
      amount: {
        status: getContractAmountStatus(result),
        breakdown: getContractAmountBreakdown(result),
        automaticContext: getContractAmountAutomaticAdoptionContext(result),
      },
      fieldDiagnostics,
      fieldFirstFailureStage,
      firstFailureStage: documentFirstFailureStage,
      documentDiagnostic: {
        firstFailureStage: documentFirstFailureStage,
        automaticDecisionAccepted: automaticDecision.accepted,
        blockers: [...automaticDecision.blockers],
      },
      diagnosticIsolation: {
        parseProjectionEquivalent: true,
        traceReadMutationFree: true,
        businessProjectionSha256: sha256Text(businessProjectionBefore),
      },
      durationMs: Date.now() - startedMs,
    };
  } finally {
    await fs.promises.rm(temporaryDirectory, {
      recursive: true,
      force: true,
    });
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const groundTruthSha256 = await sha256File(options.groundTruthPath);
  if (groundTruthSha256 !== LOCKED_DIAGNOSTIC_GROUND_TRUTH_SHA256) {
    throw new Error("人工真值摘要不是冻结的第十一阶段12份公司合同诊断集");
  }
  const groundTruth = readGroundTruth(options.groundTruthPath);
  const samples = validateSamples(groundTruth, options);
  await preparePrivateOutput(options.outputPath);
  const output = fs.openSync(options.outputPath, "wx", 0o600);
  const allFieldDiagnostics: ContractOcrFieldFunnelDiagnostic[] = [];
  const errors: Array<{ sampleId: string; error: string }> = [];
  try {
    appendRecord(output, {
      recordType: "run_header",
      schemaVersion: CONTRACT_OCR_FUNNEL_DIAGNOSTIC_SCHEMA_VERSION,
      runId: options.runId,
      datasetVersion:
        groundTruth.datasetVersion || groundTruth.version || "unversioned",
      fixedConfiguration: {
        ocrModel: FIXED_OCR_MODEL,
        paddleOcrVersion: "3.5.0",
        automaticPolicyVersion: CONTRACT_OCR_AUTOMATIC_POLICY_VERSION,
        candidateFunnelDiagnostics: true,
        diagnosticDatasetLocked: true,
        expectedModelArchiveSha256: {
          detection:
            "144d0621e059566e5086e228829171591c144c2deb07b2dad4962214fbabfcf7",
          recognition:
            "4eecc1c6a4623765042e6fc15446da0da110b7d875b6b72b2d351d2b2dbd4da6",
        },
      },
      groundTruthSha256,
      implementationDigests: await implementationDigests(),
      startedAt: new Date().toISOString(),
      sampleCount: samples.length,
    });
    for (const sample of samples) {
      try {
        const diagnostic = await diagnoseSample(sample, options);
        allFieldDiagnostics.push(...diagnostic.fieldDiagnostics);
        appendRecord(output, diagnostic);
      } catch (error) {
        const message = error instanceof Error ? error.message : "未知诊断错误";
        errors.push({ sampleId: sample.id, error: message });
        appendRecord(output, {
          recordType: "sample_error",
          schemaVersion: CONTRACT_OCR_FUNNEL_DIAGNOSTIC_SCHEMA_VERSION,
          sampleId: sample.id,
          error: message,
        });
      }
    }
    appendRecord(output, {
      recordType: "run_summary",
      schemaVersion: CONTRACT_OCR_FUNNEL_DIAGNOSTIC_SCHEMA_VERSION,
      runId: options.runId,
      finishedAt: new Date().toISOString(),
      successfulSamples: samples.length - errors.length,
      failedSamples: errors.length,
      fieldSummary: summarizeContractOcrCandidateFunnel(allFieldDiagnostics),
      errors,
    });
  } finally {
    fs.closeSync(output);
    fs.chmodSync(options.outputPath, 0o600);
  }
  if (errors.length > 0) {
    throw new Error(`有 ${errors.length} 份样本未完成候选漏斗诊断`);
  }
  console.log(
    JSON.stringify({
      outputPath: options.outputPath,
      sampleCount: samples.length,
      fieldSummary: summarizeContractOcrCandidateFunnel(allFieldDiagnostics),
    }),
  );
}

async function run(): Promise<void> {
  try {
    await main();
  } finally {
    await shutdownOcrDaemon();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
