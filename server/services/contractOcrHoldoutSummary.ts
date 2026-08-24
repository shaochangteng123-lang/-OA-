import fs from "node:fs";
import { createHash } from "node:crypto";

export const CONTRACT_OCR_HOLDOUT_SCHEMA_VERSION = 4;
export const CONTRACT_OCR_HOLDOUT_AUDIT_POLICY_VERSION =
  "automatic-risk-review-2026-08-07-v12";
export const CONTRACT_OCR_HOLDOUT_AUTOMATIC_POLICY_VERSION =
  "highest-qualified-candidate-v1";
export const CONTRACT_OCR_HOLDOUT_MODEL = "v6_medium";

const CORE_FIELDS = [
  "party_a",
  "party_b",
  "project_name",
  "amount",
  "category",
  "contract_date",
] as const;

type CoreField = (typeof CORE_FIELDS)[number];
type CountMap = Record<string, number>;

interface SummaryOptions {
  inputPaths: string[];
  expectedCount?: number;
}

interface AuditRecord {
  schemaVersion?: unknown;
  auditPolicyVersion?: unknown;
  auditConfigurationHash?: unknown;
  ocrModel?: unknown;
  automaticPolicyVersion?: unknown;
  kind?: unknown;
  recordType?: unknown;
  sha256?: unknown;
  actualSha256?: unknown;
  durationMs?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
  result?: unknown;
}

interface ContractResult {
  status?: unknown;
  automaticReady?: unknown;
  automaticAdoption?: unknown;
  fields?: unknown;
  warnings?: unknown;
  modelVersion?: unknown;
}

interface ContractField {
  field?: unknown;
  normalizedValue?: unknown;
  warnings?: unknown;
  candidates?: unknown;
  modelVersion?: unknown;
}

interface AutomaticAdoption {
  policyVersion?: unknown;
  accepted?: unknown;
  blockers?: unknown;
  warnings?: unknown;
}

export interface ContractOcrHoldoutSummary {
  summaryVersion: 1;
  generatedAt: string;
  validation: {
    expectedCount: number;
    recordCount: number;
    uniqueSha256Count: number;
    sourceShardCount: number;
    schemaVersion: number;
    auditPolicyVersion: string;
    automaticPolicyVersion: string;
    ocrModel: string;
    auditConfigurationHash: string;
    inputSetDigest: string;
  };
  totals: {
    documents: number;
    outerErrors: number;
  };
  statusCounts: CountMap;
  automaticReadyCounts: {
    ready: number;
    notReady: number;
    unavailable: number;
  };
  modelCounts: CountMap;
  durationMs: {
    measurement: string;
    total: number;
    average: number;
    minimum: number;
    p50: number;
    p95: number;
    maximum: number;
    parallelWallClock: number;
  };
  fieldMissingCounts: {
    documentsWithAnyMissingFieldRecord: number;
    documentsWithAnyMissingSelectedValue: number;
    missingFieldRecords: Record<CoreField, number>;
    missingSelectedValues: Record<CoreField, number>;
  };
  automaticAdoption: {
    blockerOccurrences: number;
    blockerDocuments: number;
    blockerCategories: CountMap;
    warningOccurrences: number;
    warningDocuments: number;
    warningCategories: CountMap;
  };
  candidateConflicts: {
    documents: number;
    occurrences: number;
    byField: Record<CoreField | "other", number>;
  };
  limitations: string[];
  privacy: {
    aggregatedOnly: true;
    includesDocumentPaths: false;
    includesDocumentSha256Values: false;
    includesFieldValues: false;
    includesRawReasons: false;
  };
}

function emptyFieldCounts(): Record<CoreField, number> {
  return Object.fromEntries(CORE_FIELDS.map((field) => [field, 0])) as Record<
    CoreField,
    number
  >;
}

function emptyConflictCounts(): Record<CoreField | "other", number> {
  return {
    ...emptyFieldCounts(),
    other: 0,
  };
}

function increment(counts: CountMap, key: string): void {
  counts[key] = (counts[key] || 0) + 1;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isMissingValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function safeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label}必须是文本数组`);
  }
  return value as string[];
}

function blockerCategory(reason: string): string {
  if (/基础设施/u.test(reason)) return "OCR（光学字符识别）基础设施";
  if (/文件或声明的合同层级/u.test(reason)) return "合同文件或层级校验";
  if (/缺少核心字段记录/u.test(reason)) return "核心字段记录缺失";
  if (/缺少上传时锁定的声明分类/u.test(reason)) return "声明分类缺失";
  if (/分类.*不一致/u.test(reason)) return "分类不一致";
  if (/甲方单位.*没有可采用候选/u.test(reason)) return "甲方候选缺失";
  if (/乙方单位.*没有可采用候选/u.test(reason)) return "乙方候选缺失";
  if (/项目名称.*没有可采用候选/u.test(reason)) return "项目名称候选缺失";
  if (/合同金额.*没有可采用候选/u.test(reason)) return "合同金额候选缺失";
  if (/合同类型.*没有可采用候选/u.test(reason)) return "合同类型候选缺失";
  if (/合同签订日期.*没有可采用候选/u.test(reason)) {
    return "签订日期候选缺失";
  }
  if (/甲方单位与乙方单位/u.test(reason)) return "甲乙方同名";
  if (/金额/u.test(reason)) return "合同金额校验";
  if (/日期/u.test(reason)) return "签订日期校验";
  return "其他";
}

function warningCategory(reason: string): string {
  if (/^自动采用策略：/u.test(reason)) return "自动采用策略标记";
  if (/声明分类作为业务事实/u.test(reason)) return "声明分类回退";
  if (/甲方单位自动采用合法空值/u.test(reason)) return "甲方合法空值";
  if (/乙方单位自动采用合法空值/u.test(reason)) return "乙方合法空值";
  if (/项目名称自动采用合法空值/u.test(reason)) return "项目名称合法空值";
  if (/合同金额自动采用合法空值/u.test(reason)) return "合同金额合法空值";
  if (/合同类型自动采用合法空值/u.test(reason)) return "合同类型合法空值";
  if (/合同签订日期自动采用合法空值/u.test(reason)) {
    return "签订日期合法空值";
  }
  return "其他";
}

function isCandidateConflict(reason: string): boolean {
  return /候选冲突|金额格式冲突|金额角色冲突|同一增减动作.*冲突|金额计算结果.*不一致|大写.*不一致/u.test(
    reason,
  );
}

function conflictFieldFromReason(
  reason: string,
  fallback: CoreField | null,
): CoreField | "other" {
  if (fallback) return fallback;
  if (/甲方/u.test(reason)) return "party_a";
  if (/乙方/u.test(reason)) return "party_b";
  if (/项目名称|工程名称|合同名称/u.test(reason)) return "project_name";
  if (/金额|价款|总价/u.test(reason)) return "amount";
  if (/合同类型|分类/u.test(reason)) return "category";
  if (/日期|签订时间/u.test(reason)) return "contract_date";
  return "other";
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const index = Math.max(0, Math.ceil(values.length * fraction) - 1);
  return values[index];
}

function readStableJsonl(inputPath: string, shardIndex: number): AuditRecord[] {
  const before = fs.statSync(inputPath);
  const text = fs.readFileSync(inputPath, "utf8");
  const after = fs.statSync(inputPath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`第 ${shardIndex + 1} 个输入分片在读取期间发生变化`);
  }
  const records: AuditRecord[] = [];
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(
        `第 ${shardIndex + 1} 个输入分片第 ${lineIndex + 1} 行不是合法 JSON（JavaScript 对象表示法）`,
      );
    }
    const record = asObject(parsed);
    if (!record) {
      throw new Error(
        `第 ${shardIndex + 1} 个输入分片第 ${lineIndex + 1} 行不是对象`,
      );
    }
    records.push(record as AuditRecord);
  }
  return records;
}

function validateRecord(
  record: AuditRecord,
  configurationHash: string | null,
): string {
  if (record.schemaVersion !== CONTRACT_OCR_HOLDOUT_SCHEMA_VERSION) {
    throw new Error("留出集结构版本不是固定的第 4 版");
  }
  if (record.auditPolicyVersion !== CONTRACT_OCR_HOLDOUT_AUDIT_POLICY_VERSION) {
    throw new Error("留出集审计策略不是固定的第十二版");
  }
  if (
    record.automaticPolicyVersion !==
    CONTRACT_OCR_HOLDOUT_AUTOMATIC_POLICY_VERSION
  ) {
    throw new Error("留出集自动采用策略版本不一致");
  }
  if (record.ocrModel !== CONTRACT_OCR_HOLDOUT_MODEL) {
    throw new Error("留出集识别模型不是固定的第六版中型模型");
  }
  if (record.kind !== "contract") {
    throw new Error("留出集包含非合同审计记录");
  }
  if (record.recordType !== "recognition_result") {
    throw new Error("留出集包含非识别结果记录");
  }
  if (
    typeof record.auditConfigurationHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.auditConfigurationHash)
  ) {
    throw new Error("留出集配置摘要格式不正确");
  }
  if (
    configurationHash !== null &&
    record.auditConfigurationHash !== configurationHash
  ) {
    throw new Error("留出集分片的配置摘要不一致");
  }
  if (
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.sha256)
  ) {
    throw new Error("留出集文件摘要格式不正确");
  }
  if (record.actualSha256 !== record.sha256) {
    throw new Error("留出集清单摘要与识别前验源摘要不一致");
  }
  if (
    typeof record.durationMs !== "number" ||
    !Number.isFinite(record.durationMs) ||
    record.durationMs < 0
  ) {
    throw new Error("留出集识别耗时不是有效非负数");
  }
  if (
    typeof record.startedAt !== "string" ||
    !Number.isFinite(Date.parse(record.startedAt)) ||
    typeof record.finishedAt !== "string" ||
    !Number.isFinite(Date.parse(record.finishedAt)) ||
    Date.parse(record.finishedAt) < Date.parse(record.startedAt)
  ) {
    throw new Error("留出集开始或完成时间无效");
  }
  return record.auditConfigurationHash;
}

function calculateSequentialDurations(shardRecords: AuditRecord[][]): {
  durations: number[];
  parallelWallClock: number;
} {
  const durations: number[] = [];
  let earliestStartedAt = Number.POSITIVE_INFINITY;
  let latestFinishedAt = 0;
  for (const records of shardRecords) {
    let previousFinishedAt: number | null = null;
    for (const record of records) {
      const startedAt = Date.parse(record.startedAt as string);
      const finishedAt = Date.parse(record.finishedAt as string);
      const duration =
        previousFinishedAt === null
          ? finishedAt - startedAt
          : finishedAt - previousFinishedAt;
      if (!Number.isFinite(duration) || duration < 0) {
        throw new Error("留出集分片完成时间不是单调递增");
      }
      durations.push(duration);
      previousFinishedAt = finishedAt;
      earliestStartedAt = Math.min(earliestStartedAt, startedAt);
      latestFinishedAt = Math.max(latestFinishedAt, finishedAt);
    }
  }
  return {
    durations,
    parallelWallClock: latestFinishedAt - earliestStartedAt,
  };
}

function validateAndReadResult(record: AuditRecord): ContractResult | null {
  if (record.result === undefined || record.result === null) return null;
  const result = asObject(record.result) as ContractResult | null;
  if (!result) throw new Error("留出集识别结果结构不正确");
  if (
    !(["succeeded", "partial", "failed"] as readonly unknown[]).includes(
      result.status,
    )
  ) {
    throw new Error("留出集识别状态不在允许范围内");
  }
  if (typeof result.automaticReady !== "boolean") {
    throw new Error("留出集缺少自动采用结果");
  }
  const adoption = asObject(
    result.automaticAdoption,
  ) as AutomaticAdoption | null;
  if (!adoption) throw new Error("留出集缺少自动采用决策");
  if (
    adoption.policyVersion !== CONTRACT_OCR_HOLDOUT_AUTOMATIC_POLICY_VERSION
  ) {
    throw new Error("留出集决策中的自动采用策略版本不一致");
  }
  if (adoption.accepted !== result.automaticReady) {
    throw new Error("留出集自动采用状态与决策不一致");
  }
  safeStringArray(adoption.blockers, "自动采用阻断原因");
  safeStringArray(adoption.warnings, "自动采用警告");
  if (!Array.isArray(result.fields)) {
    throw new Error("留出集识别字段不是数组");
  }
  if (!Array.isArray(result.warnings)) {
    throw new Error("留出集识别警告不是数组");
  }
  if (
    result.modelVersion !== undefined &&
    result.modelVersion !== CONTRACT_OCR_HOLDOUT_MODEL
  ) {
    throw new Error("留出集识别结果中的模型版本不一致");
  }
  return result;
}

function coreField(value: unknown): CoreField | null {
  return (CORE_FIELDS as readonly unknown[]).includes(value)
    ? (value as CoreField)
    : null;
}

export function summarizeContractOcrHoldoutShards(
  options: SummaryOptions,
): ContractOcrHoldoutSummary {
  const expectedCount = options.expectedCount ?? 50;
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) {
    throw new Error("预期合同数量必须是正整数");
  }
  if (options.inputPaths.length === 0) {
    throw new Error("至少需要一个 JSONL（逐行 JSON）输入分片");
  }
  const shardRecords = options.inputPaths.map((inputPath, shardIndex) =>
    readStableJsonl(inputPath, shardIndex),
  );
  const records = shardRecords.flat();
  if (records.length !== expectedCount) {
    throw new Error(
      `留出集记录数必须为 ${expectedCount}，实际为 ${records.length}`,
    );
  }

  let configurationHash: string | null = null;
  const sha256Values = new Set<string>();
  for (const record of records) {
    configurationHash = validateRecord(record, configurationHash);
    sha256Values.add(record.sha256 as string);
  }
  if (sha256Values.size !== expectedCount) {
    throw new Error(
      `留出集必须包含 ${expectedCount} 个唯一 SHA-256（安全散列算法）摘要`,
    );
  }

  const statusCounts: CountMap = {};
  const modelCounts: CountMap = {};
  const missingFieldRecords = emptyFieldCounts();
  const missingSelectedValues = emptyFieldCounts();
  const blockerCategories: CountMap = {};
  const warningCategories: CountMap = {};
  const conflictByField = emptyConflictCounts();
  let outerErrors = 0;
  let ready = 0;
  let notReady = 0;
  let unavailable = 0;
  let documentsWithAnyMissingFieldRecord = 0;
  let documentsWithAnyMissingSelectedValue = 0;
  let blockerOccurrences = 0;
  let blockerDocuments = 0;
  let warningOccurrences = 0;
  let warningDocuments = 0;
  let conflictDocuments = 0;
  let conflictOccurrences = 0;

  for (const record of records) {
    increment(modelCounts, String(record.ocrModel));
    const result = validateAndReadResult(record);
    if (!result) {
      outerErrors += 1;
      increment(statusCounts, "outer_error");
      unavailable += 1;
      documentsWithAnyMissingFieldRecord += 1;
      documentsWithAnyMissingSelectedValue += 1;
      for (const field of CORE_FIELDS) {
        missingFieldRecords[field] += 1;
        missingSelectedValues[field] += 1;
      }
      continue;
    }

    increment(statusCounts, String(result.status));
    if (result.automaticReady) ready += 1;
    else notReady += 1;

    const adoption = result.automaticAdoption as AutomaticAdoption;
    const blockers = adoption.blockers as string[];
    const adoptionWarnings = adoption.warnings as string[];
    if (blockers.length > 0) blockerDocuments += 1;
    if (adoptionWarnings.length > 0) warningDocuments += 1;
    blockerOccurrences += blockers.length;
    warningOccurrences += adoptionWarnings.length;
    for (const reason of blockers)
      increment(blockerCategories, blockerCategory(reason));
    for (const reason of adoptionWarnings) {
      increment(warningCategories, warningCategory(reason));
    }

    const fieldsByCode = new Map<CoreField, ContractField>();
    const conflictReasons = new Map<string, CoreField | "other">();
    for (const value of result.fields as unknown[]) {
      const field = asObject(value) as ContractField | null;
      if (!field) throw new Error("留出集存在结构不正确的识别字段");
      const fieldCode = coreField(field.field);
      if (fieldCode) {
        if (fieldsByCode.has(fieldCode)) {
          throw new Error("留出集存在重复核心字段记录");
        }
        fieldsByCode.set(fieldCode, field);
      }
      if (
        field.modelVersion !== undefined &&
        field.modelVersion !== CONTRACT_OCR_HOLDOUT_MODEL
      ) {
        throw new Error("留出集字段中的模型版本不一致");
      }
      const fieldWarnings = safeStringArray(field.warnings, "字段警告");
      for (const reason of fieldWarnings) {
        if (!isCandidateConflict(reason)) continue;
        conflictReasons.set(reason, conflictFieldFromReason(reason, fieldCode));
      }
    }
    for (const reason of safeStringArray(result.warnings, "识别警告")) {
      if (!isCandidateConflict(reason) || conflictReasons.has(reason)) continue;
      conflictReasons.set(reason, conflictFieldFromReason(reason, null));
    }
    if (conflictReasons.size > 0) conflictDocuments += 1;
    conflictOccurrences += conflictReasons.size;
    for (const field of conflictReasons.values()) conflictByField[field] += 1;

    let missingRecord = false;
    let missingValue = false;
    for (const fieldCode of CORE_FIELDS) {
      const field = fieldsByCode.get(fieldCode);
      if (!field) {
        missingFieldRecords[fieldCode] += 1;
        missingSelectedValues[fieldCode] += 1;
        missingRecord = true;
        missingValue = true;
      } else if (isMissingValue(field.normalizedValue)) {
        missingSelectedValues[fieldCode] += 1;
        missingValue = true;
      }
    }
    if (missingRecord) documentsWithAnyMissingFieldRecord += 1;
    if (missingValue) documentsWithAnyMissingSelectedValue += 1;
  }

  const { durations, parallelWallClock } =
    calculateSequentialDurations(shardRecords);
  durations.sort((left, right) => left - right);
  const durationTotal = durations.reduce((sum, value) => sum + value, 0);
  const inputSetDigest = createHash("sha256")
    .update([...sha256Values].sort().join("\n"))
    .digest("hex");

  return {
    summaryVersion: 1,
    generatedAt: new Date().toISOString(),
    validation: {
      expectedCount,
      recordCount: records.length,
      uniqueSha256Count: sha256Values.size,
      sourceShardCount: options.inputPaths.length,
      schemaVersion: CONTRACT_OCR_HOLDOUT_SCHEMA_VERSION,
      auditPolicyVersion: CONTRACT_OCR_HOLDOUT_AUDIT_POLICY_VERSION,
      automaticPolicyVersion: CONTRACT_OCR_HOLDOUT_AUTOMATIC_POLICY_VERSION,
      ocrModel: CONTRACT_OCR_HOLDOUT_MODEL,
      auditConfigurationHash: configurationHash as string,
      inputSetDigest,
    },
    totals: {
      documents: records.length,
      outerErrors,
    },
    statusCounts,
    automaticReadyCounts: {
      ready,
      notReady,
      unavailable,
    },
    modelCounts,
    durationMs: {
      measurement:
        "每个并发分片内按相邻完成时间差计算单份端到端耗时；首份使用完成时间减该记录开始时间",
      total: durationTotal,
      average: Math.round((durationTotal / durations.length) * 100) / 100,
      minimum: durations[0] || 0,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      maximum: durations[durations.length - 1] || 0,
      parallelWallClock,
    },
    fieldMissingCounts: {
      documentsWithAnyMissingFieldRecord,
      documentsWithAnyMissingSelectedValue,
      missingFieldRecords,
      missingSelectedValues,
    },
    automaticAdoption: {
      blockerOccurrences,
      blockerDocuments,
      blockerCategories,
      warningOccurrences,
      warningDocuments,
      warningCategories,
    },
    candidateConflicts: {
      documents: conflictDocuments,
      occurrences: conflictOccurrences,
      byField: conflictByField,
    },
    limitations: [
      "模型统计只使用每条审计记录顶层的 ocrModel（识别模型）配置，不要求旧进程的压缩结果重复序列化字段级模型版本",
      "审计压缩产物不是生产完整 OCR（光学字符识别）逐行结构，不能替代 HTTP（超文本传输协议）上传与回读验证",
      "汇总不含人工真值，只能反映状态、缺失和风险分布，不能计算字段准确率",
      "留出集只按文件字节摘要精确隔离，不代表合同族或近重复严格隔离",
      "单份耗时包含文件副本、识别和字段解析；不使用原始累计 durationMs（耗时毫秒），避免重复计算分片排队时间",
    ],
    privacy: {
      aggregatedOnly: true,
      includesDocumentPaths: false,
      includesDocumentSha256Values: false,
      includesFieldValues: false,
      includesRawReasons: false,
    },
  };
}
