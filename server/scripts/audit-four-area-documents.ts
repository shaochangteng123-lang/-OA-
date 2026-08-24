import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { recognizeContractFinancialDocument } from "../services/contractFinancialOcr.js";
import {
  getContractAmountAutomaticAdoptionContext,
  getContractOcrAutomaticAdoptionSafetyContext,
  recognizeContractFile,
} from "../services/contractOcr.js";
import {
  CONTRACT_OCR_AUTOMATIC_POLICY_VERSION,
  decideContractAutomaticOcrAdoption,
  type ContractCategory,
} from "../services/contractService.js";
import {
  resolvePaddleOcrModel,
  type PaddleOcrModel,
} from "../services/ocrDaemon.js";

type AuditKind = "contract" | "invoice" | "receipt";
const AUDIT_SCHEMA_VERSION = 4;
const AUDIT_POLICY_VERSION = "automatic-risk-review-2026-08-07-v12";
const FOUR_AREA_REGIONS = [
  "国网丰台",
  "国网海淀",
  "国网朝阳",
  "国网门头沟",
] as const;

interface InventoryRow {
  region: string;
  category: string;
  sourceStatus: string;
  extension: string;
  size: number;
  sha256: string;
  relativePath: string;
  kind: AuditKind | null;
}

interface AuditOptions {
  manifestPath: string;
  inputRoot: string;
  outputPath: string;
  kind: AuditKind;
  ocrModel: PaddleOcrModel;
  declaredCategory: ContractCategory | null;
  limit: number | null;
  concurrency: 1 | 2;
  shardIndex: number;
  shardCount: number;
  companyNames: string[];
  companyTaxIds: string[];
  companyBankAccounts: string[];
  requiredRegions: string[];
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseOptions(): AuditOptions {
  const kind = optionValue("--kind") || "contract";
  if (
    !(["contract", "invoice", "receipt"] as const).includes(kind as AuditKind)
  ) {
    throw new Error("--kind 仅支持 contract、invoice 或 receipt");
  }
  const limitText = optionValue("--limit");
  const parsedLimit = limitText ? Number.parseInt(limitText, 10) : null;
  if (
    parsedLimit != null &&
    (!Number.isFinite(parsedLimit) || parsedLimit <= 0)
  ) {
    throw new Error("--limit 必须是正整数");
  }
  const concurrencyText = optionValue("--concurrency") || "1";
  if (!/^[12]$/.test(concurrencyText)) {
    throw new Error("--concurrency 仅支持 1 或 2，默认值为 1");
  }
  const concurrency = Number.parseInt(concurrencyText, 10);
  const shardCount = Number.parseInt(optionValue("--shard-count") || "1", 10);
  const shardIndex = Number.parseInt(optionValue("--shard-index") || "0", 10);
  if (!Number.isInteger(shardCount) || shardCount < 1 || shardCount > 4) {
    throw new Error("--shard-count 必须是 1 至 4 的整数");
  }
  if (
    !Number.isInteger(shardIndex) ||
    shardIndex < 0 ||
    shardIndex >= shardCount
  ) {
    throw new Error("--shard-index 必须从 0 开始且小于 --shard-count");
  }
  const ocrModel = resolvePaddleOcrModel(optionValue("--ocr-model"));
  const declaredCategoryValue = String(
    optionValue("--declared-category") || "",
  ).trim();
  const allowedDeclaredCategories = new Set<ContractCategory>([
    "main_business",
    "non_main",
    "asset",
  ]);
  if (
    declaredCategoryValue &&
    !allowedDeclaredCategories.has(declaredCategoryValue as ContractCategory)
  ) {
    throw new Error(
      "--declared-category 仅支持 main_business、non_main 或 asset",
    );
  }
  if (kind !== "contract" && declaredCategoryValue) {
    throw new Error("--declared-category 仅适用于 contract 审计");
  }
  const requiredRegions = [
    ...new Set(
      (optionValue("--required-regions") || FOUR_AREA_REGIONS.join(","))
        .split(/[，,]/)
        .map((region) => region.trim())
        .filter(Boolean),
    ),
  ].sort();
  if (
    requiredRegions.length === 0 ||
    requiredRegions.some(
      (region) =>
        !FOUR_AREA_REGIONS.includes(
          region as (typeof FOUR_AREA_REGIONS)[number],
        ),
    )
  ) {
    throw new Error(
      "--required-regions 必须是丰台、海淀、朝阳、门头沟对应行政区的非空子集",
    );
  }
  const declaredCategory = declaredCategoryValue
    ? (declaredCategoryValue as ContractCategory)
    : null;
  return {
    manifestPath: optionValue("--manifest") || "/tmp/合同四区盘点清单.tsv",
    inputRoot: optionValue("--input") || "/tmp/contract-audit-input",
    outputPath:
      optionValue("--output") || "/app/debug/contract-four-area-audit.jsonl",
    kind: kind as AuditKind,
    ocrModel,
    declaredCategory,
    limit: parsedLimit,
    concurrency: concurrency as 1 | 2,
    shardIndex,
    shardCount,
    companyNames: (optionValue("--company-names") || "北京羽隶工程咨询有限公司")
      .split(/[，,]/)
      .map((name) => name.trim())
      .filter(Boolean),
    companyTaxIds: (optionValue("--company-tax-ids") || "91110116MA01G3U20C")
      .split(/[，,]/)
      .map((taxId) => taxId.trim())
      .filter(Boolean),
    companyBankAccounts: (optionValue("--company-bank-accounts") || "")
      .split(/[，,]/)
      .map((account) => account.trim())
      .filter(Boolean),
    requiredRegions,
  };
}

function inventoryKind(category: string): AuditKind | null {
  if (["主合同或其他合同", "补充协议", "解除或终止协议"].includes(category)) {
    return "contract";
  }
  if (category === "发票源文件") return "invoice";
  if (category === "银行回单") return "receipt";
  return null;
}

function readInventory(manifestPath: string): InventoryRow[] {
  const text = fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "");
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line, index) => {
      const columns = line.split("\t");
      if (columns.length !== 7) {
        throw new Error(`盘点清单第 ${index + 2} 行不是 7 列`);
      }
      const [
        region,
        category,
        sourceStatus,
        extension,
        size,
        sha256,
        relativePath,
      ] = columns;
      return {
        region,
        category,
        sourceStatus,
        extension: extension.toLowerCase(),
        size: Number.parseInt(size, 10),
        sha256,
        relativePath,
        kind: inventoryKind(category),
      };
    });
}

function auditConfigurationHash(options: AuditOptions): string {
  const configuration = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    auditPolicyVersion: AUDIT_POLICY_VERSION,
    kind: options.kind,
    ocrModel: options.ocrModel,
    declaredCategory: options.declaredCategory,
    automaticPolicyVersion:
      options.kind === "contract"
        ? CONTRACT_OCR_AUTOMATIC_POLICY_VERSION
        : null,
    companyNames: [...options.companyNames].sort(),
    companyTaxIds: [...options.companyTaxIds].sort(),
    companyBankAccounts: [...options.companyBankAccounts].sort(),
    requiredRegions: [...options.requiredRegions].sort(),
  };
  return createHash("sha256")
    .update(JSON.stringify(configuration))
    .digest("hex");
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

function recognitionContextKey(row: InventoryRow, kind: AuditKind): string {
  const sourceFormat = row.extension.toLowerCase();
  return kind === "contract"
    ? `contract:${relationTypeForCategory(row.category)}:${sourceFormat}`
    : `${kind}:${sourceFormat}`;
}

function completedPathKey(
  row: Pick<InventoryRow, "relativePath" | "sha256">,
  contextKey: string,
): string {
  return `${row.relativePath}\u0000${row.sha256}\u0000${contextKey}`;
}

function resultCacheKey(sha256: string, contextKey: string): string {
  return `${sha256}\u0000${contextKey}`;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("hex");
}

function isReusableAuditResult(
  result: unknown,
  kind: AuditKind,
): result is Record<string, unknown> {
  if (!result || typeof result !== "object") return false;
  const candidate = result as {
    failureKind?: unknown;
    status?: unknown;
    validationStatus?: unknown;
    kind?: unknown;
    fields?: unknown;
    warnings?: unknown;
    blockingReasons?: unknown;
    automaticReady?: unknown;
    automaticAdoption?: unknown;
  };
  if (candidate.failureKind === "infrastructure") return false;
  if (
    candidate.failureKind != null &&
    !["document", "recognition"].includes(String(candidate.failureKind))
  ) {
    return false;
  }
  if (kind === "contract") {
    const automaticAdoption = candidate.automaticAdoption as
      | { policyVersion?: unknown; accepted?: unknown }
      | null
      | undefined;
    return (
      ["succeeded", "partial", "failed"].includes(String(candidate.status)) &&
      Array.isArray(candidate.fields) &&
      Array.isArray(candidate.warnings) &&
      typeof candidate.automaticReady === "boolean" &&
      automaticAdoption?.policyVersion ===
        CONTRACT_OCR_AUTOMATIC_POLICY_VERSION &&
      automaticAdoption.accepted === candidate.automaticReady
    );
  }
  return (
    candidate.kind === (kind === "invoice" ? "invoice" : "bank_receipt") &&
    ["verified", "blocked", "failed"].includes(
      String(candidate.validationStatus),
    ) &&
    Boolean(candidate.fields) &&
    typeof candidate.fields === "object" &&
    Array.isArray(candidate.warnings) &&
    Array.isArray(candidate.blockingReasons)
  );
}

/**
 * 所有工作器均位于同一 Node（节点运行时）进程。集中使用同步单行追加，
 * 确保两个异步工作器不会把两个 JSONL（逐行 JSON）记录交错写入。
 */
function appendAuditRecord(
  outputPath: string,
  record: Record<string, unknown>,
): void {
  fs.appendFileSync(outputPath, `${JSON.stringify(record)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function forEachWithConcurrency<T>(
  items: readonly T[],
  concurrency: 1 | 2,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index]);
      }
    }),
  );
}

function readAuditCheckpoint(
  outputPath: string,
  kind: AuditKind,
  expectedConfigurationHash: string,
  expectedOcrModel: PaddleOcrModel,
): {
  completedPaths: Set<string>;
  resultsByHash: Map<string, { relativePath: string; result: unknown }>;
} {
  const completedPaths = new Set<string>();
  const resultsByHash = new Map<
    string,
    { relativePath: string; result: unknown }
  >();
  if (!fs.existsSync(outputPath)) return { completedPaths, resultsByHash };
  for (const line of fs.readFileSync(outputPath, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    try {
      const record = JSON.parse(line) as {
        schemaVersion?: unknown;
        auditPolicyVersion?: unknown;
        auditConfigurationHash?: unknown;
        ocrModel?: unknown;
        recognitionContextKey?: unknown;
        kind?: unknown;
        recordType?: unknown;
        duplicateOfRelativePath?: unknown;
        sha256?: unknown;
        relativePath?: unknown;
        error?: unknown;
        result?: unknown;
      };
      const result = record.result as
        | { failureKind?: unknown }
        | null
        | undefined;
      const shouldRetry =
        Boolean(record.error) || result?.failureKind === "infrastructure";
      const isRecognitionResult =
        record.recordType === "recognition_result" &&
        isReusableAuditResult(record.result, kind);
      const isDuplicateReference =
        record.recordType === "duplicate_reference" &&
        typeof record.duplicateOfRelativePath === "string";
      const hasMatchingAuditContext =
        record.schemaVersion === AUDIT_SCHEMA_VERSION &&
        record.auditPolicyVersion === AUDIT_POLICY_VERSION &&
        record.auditConfigurationHash === expectedConfigurationHash &&
        record.ocrModel === expectedOcrModel &&
        record.kind === kind &&
        typeof record.sha256 === "string" &&
        typeof record.relativePath === "string" &&
        typeof record.recognitionContextKey === "string";
      if (hasMatchingAuditContext) {
        const recordSha256 = record.sha256 as string;
        const recordRelativePath = record.relativePath as string;
        const recordContextKey = record.recognitionContextKey as string;
        const pathKey = completedPathKey(
          { relativePath: recordRelativePath, sha256: recordSha256 },
          recordContextKey,
        );
        if (shouldRetry || (!isRecognitionResult && !isDuplicateReference)) {
          // 同一路径后写入的失败或无效记录必须撤销旧完成状态。
          completedPaths.delete(pathKey);
          continue;
        }
        const cacheKey = resultCacheKey(recordSha256, recordContextKey);
        if (isRecognitionResult && !resultsByHash.has(cacheKey)) {
          resultsByHash.set(cacheKey, {
            relativePath: recordRelativePath,
            result: record.result,
          });
        }
        if (isDuplicateReference) {
          const referencedResult = resultsByHash.get(cacheKey);
          if (
            !referencedResult ||
            referencedResult.relativePath !== record.duplicateOfRelativePath
          ) {
            // 孤立或指向非代表结果的重复引用不能单独构成完成检查点。
            completedPaths.delete(pathKey);
            continue;
          }
        }
        completedPaths.add(pathKey);
      }
    } catch {
      // 保留已完成的合法记录；损坏行会在后续汇总时单独报告。
    }
  }
  return { completedPaths, resultsByHash };
}

function contractMimeType(extension: string): string {
  const types: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  return types[extension] || "application/octet-stream";
}

function compactContractResult(
  result: Awaited<ReturnType<typeof recognizeContractFile>>,
  automaticAdoption: ReturnType<typeof decideContractAutomaticOcrAdoption>,
) {
  return {
    status: result.status,
    failureKind: result.failureKind,
    method: result.method,
    automaticReady: automaticAdoption.accepted,
    automaticAdoption: {
      policyVersion: CONTRACT_OCR_AUTOMATIC_POLICY_VERSION,
      accepted: automaticAdoption.accepted,
      status: automaticAdoption.status,
      legalEmptyFields: automaticAdoption.legalEmptyFields,
      blockers: automaticAdoption.blockers,
      warnings: automaticAdoption.warnings,
    },
    fields: result.fields.map((field) => ({
      field: field.field,
      originalValue: field.originalValue,
      normalizedValue: field.normalizedValue,
      confidence: field.confidence,
      ocrConfidence: field.ocrConfidence,
      fieldScore: field.fieldScore,
      source: field.source,
      pageNumber: field.pageNumber,
      modelVersion: result.modelVersion,
      warnings: field.warnings || [],
      candidates: (field.candidates || []).map((candidate) => ({
        originalValue: candidate.originalValue,
        normalizedValue: candidate.normalizedValue,
        confidence: candidate.confidence,
        ocrConfidence: candidate.ocrConfidence,
        fieldScore: candidate.fieldScore,
        source: candidate.source,
        pageNumber: candidate.pageNumber,
        recognitionEngine: candidate.recognitionEngine,
        modelVersion: result.modelVersion,
      })),
    })),
    warnings: result.warnings,
    modelVersion: result.modelVersion,
  };
}

async function auditContract(
  filePath: string,
  extension: string,
  category: string,
  ocrModel: PaddleOcrModel,
  declaredCategory: ContractCategory | null,
) {
  const relationType = relationTypeForCategory(category);
  const result = await recognizeContractFile(
    filePath,
    contractMimeType(extension),
    {
      relationType,
      ocrModel,
      expectedCategory: declaredCategory || undefined,
    },
  );
  const automaticAdoption = decideContractAutomaticOcrAdoption({
    resultStatus: result.status,
    failureKind: result.failureKind,
    relationType,
    declaredCategory,
    rawText: result.rawText,
    fields: result.fields,
    amountContext: getContractAmountAutomaticAdoptionContext(result),
    safetyContext: getContractOcrAutomaticAdoptionSafetyContext(result),
  });
  return compactContractResult(result, automaticAdoption);
}

async function auditFinancial(
  filePath: string,
  kind: "invoice" | "receipt",
  companyNames: readonly string[],
  companyTaxIds: readonly string[],
  companyBankAccounts: readonly string[],
) {
  return await recognizeContractFinancialDocument({
    filePath,
    kind: kind === "invoice" ? "invoice" : "bank_receipt",
    context: { companyNames, companyTaxIds, companyBankAccounts },
  });
}

interface SelectedPhysicalRow {
  row: InventoryRow;
  physicalIndex: number;
  contextKey: string;
  checkpointCompleted: boolean;
}

interface PreparedPhysicalRow extends SelectedPhysicalRow {
  filePath: string;
  startedAt: string;
  startedMs: number;
  actualSize?: number;
  actualSha256?: string;
  validationError?: string;
}

async function preparePhysicalRow(
  selected: SelectedPhysicalRow,
  inputRoot: string,
): Promise<PreparedPhysicalRow> {
  const filePath = path.join(inputRoot, selected.row.relativePath);
  const prepared: PreparedPhysicalRow = {
    ...selected,
    filePath,
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
  };
  try {
    const stat = await fs.promises.stat(filePath);
    prepared.actualSize = stat.size;
    prepared.actualSha256 = stat.isFile() ? await sha256File(filePath) : "";
    if (!stat.isFile()) {
      prepared.validationError = "源路径不是普通文件，须重新生成盘点清单";
    } else if (
      prepared.actualSize !== selected.row.size ||
      prepared.actualSha256 !== selected.row.sha256
    ) {
      prepared.validationError =
        "源文件与盘点清单的大小或摘要不一致，须重新生成盘点清单";
    }
  } catch (caught) {
    prepared.validationError =
      caught instanceof Error ? caught.message : String(caught);
  }
  return prepared;
}

async function validatePreparedSourceIsStillCurrent(
  prepared: PreparedPhysicalRow,
): Promise<string | undefined> {
  try {
    const stat = await fs.promises.stat(prepared.filePath);
    const currentSha256 = stat.isFile()
      ? await sha256File(prepared.filePath)
      : "";
    if (
      !stat.isFile() ||
      stat.size !== prepared.row.size ||
      currentSha256 !== prepared.row.sha256
    ) {
      return "源文件在验源后发生变化，本次识别结果作废且不得复用";
    }
    return undefined;
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    return `源文件在验源后无法再次核对：${detail}`;
  }
}

interface VerifiedRecognitionCopy {
  filePath: string;
  cleanup: () => Promise<void>;
}

async function createVerifiedRecognitionCopy(
  prepared: PreparedPhysicalRow,
): Promise<VerifiedRecognitionCopy> {
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "four-area-audit-source-"),
  );
  const safeExtension =
    prepared.row.extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const copiedPath = path.join(temporaryDirectory, `source.${safeExtension}`);
  const cleanup = async (): Promise<void> => {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  };
  try {
    await fs.promises.copyFile(prepared.filePath, copiedPath);
    const copiedStat = await fs.promises.stat(copiedPath);
    const copiedSha256 = copiedStat.isFile()
      ? await sha256File(copiedPath)
      : "";
    if (
      !copiedStat.isFile() ||
      copiedStat.size !== prepared.row.size ||
      copiedSha256 !== prepared.row.sha256
    ) {
      throw new Error(
        "源文件在验源与制作识别副本之间发生变化，本次不得识别或复用",
      );
    }
    return { filePath: copiedPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function auditRecordBase(
  prepared: PreparedPhysicalRow,
  options: AuditOptions,
  configurationHash: string,
): Record<string, unknown> {
  const { row } = prepared;
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    auditPolicyVersion: AUDIT_POLICY_VERSION,
    auditConfigurationHash: configurationHash,
    ocrModel: options.ocrModel,
    declaredCategory: options.declaredCategory,
    automaticPolicyVersion:
      options.kind === "contract"
        ? CONTRACT_OCR_AUTOMATIC_POLICY_VERSION
        : null,
    recognitionContextKey: prepared.contextKey,
    kind: options.kind,
    region: row.region,
    category: row.category,
    sourceStatus: row.sourceStatus,
    extension: row.extension,
    size: row.size,
    actualSize: prepared.actualSize,
    sha256: row.sha256,
    actualSha256: prepared.actualSha256,
    relativePath: row.relativePath,
    startedAt: prepared.startedAt,
  };
}

function appendDuplicateReference(
  prepared: PreparedPhysicalRow,
  duplicateOfRelativePath: string,
  options: AuditOptions,
  configurationHash: string,
): void {
  appendAuditRecord(options.outputPath, {
    ...auditRecordBase(prepared, options, configurationHash),
    recordType: "duplicate_reference",
    duplicateOfRelativePath,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - prepared.startedMs,
  });
}

function appendRecognitionResult(
  prepared: PreparedPhysicalRow,
  result: unknown,
  error: string | undefined,
  options: AuditOptions,
  configurationHash: string,
): void {
  appendAuditRecord(options.outputPath, {
    ...auditRecordBase(prepared, options, configurationHash),
    recordType: "recognition_result",
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - prepared.startedMs,
    result,
    error,
  });
}

async function appendDuplicateReferenceIfSourceCurrent(
  prepared: PreparedPhysicalRow,
  duplicateOfRelativePath: string,
  options: AuditOptions,
  configurationHash: string,
): Promise<boolean> {
  const sourceError = await validatePreparedSourceIsStillCurrent(prepared);
  if (sourceError) {
    appendRecognitionResult(
      prepared,
      undefined,
      sourceError,
      options,
      configurationHash,
    );
    return false;
  }
  appendDuplicateReference(
    prepared,
    duplicateOfRelativePath,
    options,
    configurationHash,
  );
  return true;
}

async function main() {
  const options = parseOptions();
  // 财务凭证识别沿用全局默认模型；审计启动时把已校验参数固定回本进程，
  // 确保合同、发票和银行回单实际收到同一个 OCR_MODEL（识别模型配置）。
  process.env.OCR_MODEL = options.ocrModel;
  const configurationHash = auditConfigurationHash(options);
  const inventory = readInventory(options.manifestPath);
  const inventoryForKind = inventory.filter((row) => row.kind === options.kind);
  const expectedRegions = new Set(options.requiredRegions);
  const actualRegions = new Set(inventoryForKind.map((row) => row.region));
  if (
    actualRegions.size !== expectedRegions.size ||
    [...expectedRegions].some((region) => !actualRegions.has(region))
  ) {
    throw new Error("盘点清单行政区与 --required-regions 不一致");
  }
  const checkpoint = readAuditCheckpoint(
    options.outputPath,
    options.kind,
    configurationHash,
    options.ocrModel,
  );
  let rows = inventoryForKind;
  const uniqueGroupIndexes = new Map<string, number>();
  for (const row of rows) {
    const groupKey = resultCacheKey(
      row.sha256,
      recognitionContextKey(row, options.kind),
    );
    if (!uniqueGroupIndexes.has(groupKey)) {
      uniqueGroupIndexes.set(groupKey, uniqueGroupIndexes.size);
    }
  }
  rows = rows.filter((row) => {
    const groupKey = resultCacheKey(
      row.sha256,
      recognitionContextKey(row, options.kind),
    );
    return (
      (uniqueGroupIndexes.get(groupKey) || 0) % options.shardCount ===
      options.shardIndex
    );
  });
  const isCheckpointCompleted = (row: InventoryRow): boolean =>
    checkpoint.completedPaths.has(
      completedPathKey(row, recognitionContextKey(row, options.kind)),
    );
  let pendingRows = rows.filter((row) => !isCheckpointCompleted(row));
  // --limit 始终裁切待处理的物理路径，再做摘要分组；不能把组数误当物理文件数。
  if (options.limit != null) pendingRows = pendingRows.slice(0, options.limit);
  const selectedPendingPathKeys = new Set(
    pendingRows.map((row) =>
      completedPathKey(row, recognitionContextKey(row, options.kind)),
    ),
  );
  // 已完成检查点也必须重新验源；有效且未变化时不重复识别或追加记录。
  rows = rows.filter(
    (row) =>
      isCheckpointCompleted(row) ||
      selectedPendingPathKeys.has(
        completedPathKey(row, recognitionContextKey(row, options.kind)),
      ),
  );

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  if (fs.existsSync(options.outputPath)) {
    fs.chmodSync(options.outputPath, 0o600);
  }
  const documentLabel =
    options.kind === "contract"
      ? "合同"
      : options.kind === "invoice"
        ? "发票"
        : "银行回单";
  console.log(
    `准备验源 ${rows.length} 条${documentLabel}物理路径，其中待识别 ${pendingRows.length} 条，模型 ${options.ocrModel}，并发 ${options.concurrency}，分片 ${options.shardIndex + 1}/${options.shardCount}，已有 ${checkpoint.completedPaths.size} 条路径检查点`,
  );

  const selectedRows: SelectedPhysicalRow[] = rows.map(
    (row, physicalIndex) => ({
      row,
      physicalIndex,
      contextKey: recognitionContextKey(row, options.kind),
      checkpointCompleted: isCheckpointCompleted(row),
    }),
  );
  const preparedRows: PreparedPhysicalRow[] = new Array(selectedRows.length);

  // 先对每个物理路径分别执行 stat（文件状态）、大小和 SHA-256（安全散列算法）核验，
  // 之后才允许按摘要分组；同摘要不能替代任一物理路径自身的来源核验。
  await forEachWithConcurrency(
    selectedRows,
    options.concurrency,
    async (selected) => {
      preparedRows[selected.physicalIndex] = await preparePhysicalRow(
        selected,
        options.inputRoot,
      );
    },
  );

  const validGroups = new Map<string, PreparedPhysicalRow[]>();
  for (const prepared of preparedRows) {
    if (prepared.validationError) {
      appendRecognitionResult(
        prepared,
        undefined,
        prepared.validationError,
        options,
        configurationHash,
      );
      console.log(
        `[${prepared.physicalIndex + 1}/${rows.length}] ${prepared.row.region} 异常：${prepared.validationError}`,
      );
      continue;
    }
    if (prepared.checkpointCompleted) {
      console.log(
        `[${prepared.physicalIndex + 1}/${rows.length}] ${prepared.row.region} 已复核检查点源文件未变化`,
      );
      continue;
    }
    const groupKey = resultCacheKey(prepared.row.sha256, prepared.contextKey);
    const group = validGroups.get(groupKey) || [];
    group.push(prepared);
    validGroups.set(groupKey, group);
  }

  await forEachWithConcurrency(
    [...validGroups.entries()],
    options.concurrency,
    async ([cacheKey, group]) => {
      const existingResult = checkpoint.resultsByHash.get(cacheKey);
      if (
        existingResult &&
        isReusableAuditResult(existingResult.result, options.kind)
      ) {
        for (const prepared of group) {
          const appended = await appendDuplicateReferenceIfSourceCurrent(
            prepared,
            existingResult.relativePath,
            options,
            configurationHash,
          );
          console.log(
            `[${prepared.physicalIndex + 1}/${rows.length}] ${prepared.row.region} ${appended ? "重复原件，复用同摘要及同识别上下文结果" : "源文件在验源后发生变化，未写入重复引用"}`,
          );
        }
        return;
      }

      const representative = group[0];
      let result: unknown;
      let error: string | undefined;
      let recognitionCopy: VerifiedRecognitionCopy | undefined;
      try {
        recognitionCopy = await createVerifiedRecognitionCopy(representative);
        result =
          options.kind === "contract"
            ? await auditContract(
                recognitionCopy.filePath,
                representative.row.extension,
                representative.row.category,
                options.ocrModel,
                options.declaredCategory,
              )
            : await auditFinancial(
                recognitionCopy.filePath,
                options.kind,
                options.companyNames,
                options.companyTaxIds,
                options.companyBankAccounts,
              );
        if (!result || typeof result !== "object") {
          error = "识别服务未返回结构化结果";
        }
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      } finally {
        if (recognitionCopy) {
          try {
            await recognitionCopy.cleanup();
          } catch (caught) {
            result = undefined;
            error = `临时识别副本清理失败：${caught instanceof Error ? caught.message : String(caught)}`;
          }
        }
      }
      const sourceChangedError =
        await validatePreparedSourceIsStillCurrent(representative);
      if (sourceChangedError) {
        result = undefined;
        error = sourceChangedError;
      }

      appendRecognitionResult(
        representative,
        result,
        error,
        options,
        configurationHash,
      );
      const outcome = error
        ? `异常：${error}`
        : (result as { status?: string; validationStatus?: string }).status ||
          (result as { validationStatus?: string }).validationStatus ||
          "未产生有效结果";
      console.log(
        `[${representative.physicalIndex + 1}/${rows.length}] ${representative.row.region} ${outcome}`,
      );

      // 只有组代表产生非基础设施失败的有效结果，才可为其余物理路径追加
      // duplicate_reference（重复原件引用）。外层异常与基础设施失败只记录代表，
      // 其他成员不写完成检查点，下一轮仍会单独进入来源核验和重试。
      if (!error && isReusableAuditResult(result, options.kind)) {
        checkpoint.resultsByHash.set(cacheKey, {
          relativePath: representative.row.relativePath,
          result,
        });
        for (const prepared of group.slice(1)) {
          const appended = await appendDuplicateReferenceIfSourceCurrent(
            prepared,
            representative.row.relativePath,
            options,
            configurationHash,
          );
          console.log(
            `[${prepared.physicalIndex + 1}/${rows.length}] ${prepared.row.region} ${appended ? "重复原件，复用本组代表识别结果" : "源文件在验源后发生变化，未写入重复引用"}`,
          );
        }
      } else {
        for (const prepared of group.slice(1)) {
          console.log(
            `[${prepared.physicalIndex + 1}/${rows.length}] ${prepared.row.region} 同组代表未产生有效结果，保留待重试`,
          );
        }
      }
    },
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
