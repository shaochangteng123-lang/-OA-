import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  parseContractOcrInventory,
  type ContractOcrInventoryRow,
} from "./contractOcrHoldout.js";
import { CONTRACT_OCR_FAMILY_ISOLATION_POLICY_VERSION } from "./contractOcrFamilyIsolation.js";

export const CONTRACT_OCR_STAGE10_FREEZE_SCHEMA_VERSION = 1;
export const CONTRACT_OCR_STAGE10_MODEL = "v6_medium";
export const CONTRACT_OCR_STAGE10_PADDLEOCR_VERSION = "3.5.0";
export const CONTRACT_OCR_STAGE10_EXPECTED_COUNT = 100;
export const CONTRACT_OCR_STAGE10_CANDIDATE_MINIMUM = 120;
export const CONTRACT_OCR_STAGE10_CANDIDATE_MAXIMUM = 140;

export const CONTRACT_OCR_STAGE10_REQUIRED_TAGS = [
  "main_contract",
  "supplement_agreement",
  "change_agreement",
  "reduction_agreement",
  "scanned_document",
  "electronic_pdf",
  "stamp_occlusion",
  "handwritten_date",
  "multiple_amounts",
  "no_explicit_amount",
] as const;

export type ContractOcrStage10CoverageTag =
  (typeof CONTRACT_OCR_STAGE10_REQUIRED_TAGS)[number];

export type ContractOcrStage10RelationType =
  | "main"
  | "supplement"
  | "change"
  | "reduction"
  | "termination"
  | "other";

export type ContractOcrStage10AmountStatus =
  | "confirmed_amount"
  | "calculated_amount"
  | "payment_only"
  | "missing_amount";

const ALL_AMOUNT_STATUSES: readonly ContractOcrStage10AmountStatus[] = [
  "confirmed_amount",
  "calculated_amount",
  "payment_only",
  "missing_amount",
];

const IMPLEMENTATION_FILES = [
  { role: "field_rules", relativePath: "server/services/contractOcr.ts" },
  {
    role: "automatic_policy",
    relativePath: "server/services/contractService.ts",
  },
  { role: "persistence", relativePath: "server/routes/contracts.ts" },
  { role: "model_runtime", relativePath: "server/services/ocrDaemon.ts" },
  {
    role: "model_worker",
    relativePath: "server/scripts/paddle_ocr_worker.py",
  },
  {
    role: "model_configuration",
    relativePath: "server/config/ocr-v6-medium.json",
  },
  {
    role: "evaluation_freeze",
    relativePath: "server/services/contractOcrStage10Blind.ts",
  },
  {
    role: "evaluation_metrics",
    relativePath: "server/services/contractOcrStage10Metrics.ts",
  },
  {
    role: "evaluation_freeze_cli",
    relativePath: "server/scripts/freeze-contract-ocr-stage10.ts",
  },
  {
    role: "evaluation_e2e_runner",
    relativePath: "server/scripts/replay-contract-ocr-http-e2e.ts",
  },
  {
    role: "evaluation_summary_cli",
    relativePath: "server/scripts/summarize-contract-ocr-stage10.ts",
  },
  {
    role: "selection_family_isolation",
    relativePath: "server/services/contractOcrFamilyIsolation.ts",
  },
  {
    role: "selection_family_isolation_cli",
    relativePath: "server/scripts/build-contract-ocr-family-holdout.ts",
  },
  {
    role: "selection_manifest_parser",
    relativePath: "server/services/contractOcrHoldout.ts",
  },
  {
    role: "model_preparation",
    relativePath: "server/scripts/prepare_ocr_v6_medium_models.py",
  },
  { role: "runtime_image", relativePath: "Dockerfile" },
  { role: "runtime_compose", relativePath: "docker-compose.yml" },
  {
    role: "runtime_compose_production",
    relativePath: "docker-compose.prod.yml",
  },
  {
    role: "upload_validation",
    relativePath: "server/services/contractFileValidation.ts",
  },
  { role: "database_runtime", relativePath: "server/db/index.ts" },
  { role: "authentication_route", relativePath: "server/routes/auth.ts" },
  {
    role: "authentication_middleware",
    relativePath: "server/middleware/auth.ts",
  },
  { role: "authentication_password", relativePath: "server/utils/password.ts" },
  { role: "node_manifest", relativePath: "package.json" },
  { role: "node_lockfile", relativePath: "package-lock.json" },
] as const;

const MAPPING_HEADERS = [
  "匿名样本编号",
  "合同族编号",
  "关系类型",
  "选择状态",
  "族依据",
  "行政区",
  "分类",
  "状态",
  "扩展名",
  "字节数",
  "SHA256",
  "相对路径",
] as const;

export interface ContractOcrStage10AmountBreakdown {
  originalAmount: number | null;
  changeAmount: number | null;
  finalAmount: number | null;
}

export interface ContractOcrStage10GroundTruthSample {
  id: string;
  familyId: string;
  sha256: string;
  relativePath: string;
  relationType: ContractOcrStage10RelationType;
  tags: ContractOcrStage10CoverageTag[];
  expected: {
    party_a: string | null;
    party_b: string | null;
    project_name: string | null;
    amount: string | null;
    contract_date: string | null;
    amountStatus: ContractOcrStage10AmountStatus;
    amountBreakdown: ContractOcrStage10AmountBreakdown;
  };
}

export interface ContractOcrStage10GroundTruth {
  schemaVersion: 1;
  datasetVersion: string;
  samples: ContractOcrStage10GroundTruthSample[];
}

interface SelectedMappingRow {
  sampleId: string;
  familyId: string;
  relationType: ContractOcrStage10RelationType;
  sha256: string;
  relativePath: string;
}

export interface ContractOcrStage10FreezeOptions {
  projectRoot: string;
  baselinePath: string;
  inventoryPath: string;
  candidateManifestPath: string;
  finalManifestPath: string;
  mappingPath: string;
  groundTruthPath: string;
  familyIsolationMetadataPath: string;
  familyIsolationLineagePath: string;
  familyRegistryPath: string;
  exclusionManifestPaths: string[];
  consumedAuditPaths: string[];
  datasetVersion: string;
  automaticPolicyVersion: string;
  configuredOcrModel: string;
}

interface FrozenFileFingerprint {
  role: string;
  relativePath: string;
  sha256: string;
}

export interface ContractOcrStage10Freeze {
  schemaVersion: 1;
  baselineId: string;
  freezeId: string;
  frozenAt: string;
  immutable: true;
  datasetVersion: string;
  versions: {
    ocrModel: "v6_medium";
    paddleOcrVersion: "3.5.0";
    rulesVersion: string;
    automaticPolicyVersion: string;
    implementationDigest: string;
    evaluationDigest: string;
  };
  implementation: {
    files: FrozenFileFingerprint[];
  };
  selectionProvenance: {
    policyVersion: string;
    metadataSha256: string;
    lineageSha256: string;
    inventorySha256: string;
    familyRegistrySha256: string;
    exclusionManifestSha256: string[];
    consumedAuditSha256: string[];
  };
  candidateSet: {
    count: number;
    manifestSha256: string;
    inputSetDigest: string;
  };
  blindSet: {
    count: 100;
    uniqueFamilyCount: 100;
    manifestSha256: string;
    mappingSha256: string;
    groundTruthSha256: string;
    inputSetDigest: string;
    samples: Array<{
      sampleId: string;
      familyId: string;
      sha256: string;
    }>;
  };
  coverage: {
    byRelationType: Record<string, number>;
    byAmountStatus: Record<ContractOcrStage10AmountStatus, number>;
    byTag: Record<ContractOcrStage10CoverageTag, number>;
  };
  guardrails: {
    rulesMayChangeAfterFreeze: false;
    automaticPolicyMayChangeAfterFreeze: false;
    modelMayChangeAfterFreeze: false;
    persistenceMayChangeAfterFreeze: false;
    blindSamplesMayBeUsedForTuning: false;
  };
}

export interface ContractOcrStage10Baseline {
  schemaVersion: 1;
  baselineId: string;
  frozenAt: string;
  immutable: true;
  versions: ContractOcrStage10Freeze["versions"];
  implementation: ContractOcrStage10Freeze["implementation"];
  guardrails: {
    dataIndependent: true;
    rulesMayChangeAfterBaseline: false;
    automaticPolicyMayChangeAfterBaseline: false;
    modelMayChangeAfterBaseline: false;
    persistenceMayChangeAfterBaseline: false;
    evaluationMayChangeAfterBaseline: false;
  };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

function stableObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableObject(item)]),
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableObject(value));
}

function inputSetDigest(rows: readonly ContractOcrInventoryRow[]): string {
  return sha256(
    [...rows]
      .map((row) => row.sha256)
      .sort((left, right) => left.localeCompare(right))
      .join("\n"),
  );
}

function assertUniqueInventory(
  rows: ContractOcrInventoryRow[],
  label: string,
): void {
  if (new Set(rows.map((row) => row.sha256)).size !== rows.length) {
    throw new Error(`${label}包含重复 SHA-256（安全散列算法）摘要`);
  }
  if (new Set(rows.map((row) => row.relativePath)).size !== rows.length) {
    throw new Error(`${label}包含重复相对路径`);
  }
}

function parseSelectedMapping(content: string): SelectedMappingRow[] {
  const lines = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.trim());
  if (lines.length === 0) throw new Error("合同族私有映射为空");
  const headers = lines[0].split("\t");
  if (
    headers.length !== MAPPING_HEADERS.length ||
    headers.some((header, index) => header !== MAPPING_HEADERS[index])
  ) {
    throw new Error(
      `合同族私有映射必须使用 ${MAPPING_HEADERS.length} 列固定表头`,
    );
  }
  const selected = lines.slice(1).flatMap((line, index) => {
    const columns = line.split("\t");
    if (columns.length !== MAPPING_HEADERS.length) {
      throw new Error(`合同族私有映射第 ${index + 2} 行列数不正确`);
    }
    if (columns[3] !== "已选择") return [];
    const [
      sampleId,
      familyId,
      relationType,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      digest,
      relativePath,
    ] = columns;
    if (!sampleId || !familyId) {
      throw new Error(
        `合同族私有映射第 ${index + 2} 行缺少匿名编号或合同族编号`,
      );
    }
    if (
      !(
        [
          "main",
          "supplement",
          "change",
          "reduction",
          "termination",
          "other",
        ] as const
      ).includes(relationType as ContractOcrStage10RelationType)
    ) {
      throw new Error(`合同族私有映射第 ${index + 2} 行关系类型无效`);
    }
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`合同族私有映射第 ${index + 2} 行文件摘要无效`);
    }
    return [
      {
        sampleId,
        familyId,
        relationType: relationType as ContractOcrStage10RelationType,
        sha256: digest,
        relativePath,
      },
    ];
  });
  return selected;
}

function parseNullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label}必须是非空文本或 null（空值）`);
  }
  return value.normalize("NFKC").trim();
}

function parseNullableAmount(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label}必须是有限数值或 null（空值）`);
  }
  return value;
}

function parseGroundTruth(content: string): ContractOcrStage10GroundTruth {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("第十阶段人工真值不是合法 JSON（JavaScript 对象表示法）");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("第十阶段人工真值必须是对象");
  }
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1) {
    throw new Error("第十阶段人工真值结构版本必须为 1");
  }
  if (
    typeof document.datasetVersion !== "string" ||
    !document.datasetVersion.trim()
  ) {
    throw new Error("第十阶段人工真值缺少数据集版本");
  }
  if (!Array.isArray(document.samples)) {
    throw new Error("第十阶段人工真值样本必须是数组");
  }
  const samples = document.samples.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`第十阶段人工真值第 ${index + 1} 个样本不是对象`);
    }
    const sample = item as Record<string, unknown>;
    const expected = sample.expected;
    if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
      throw new Error(
        `第十阶段人工真值第 ${index + 1} 个样本缺少 expected（预期值）`,
      );
    }
    const expectedRecord = expected as Record<string, unknown>;
    const breakdown = expectedRecord.amountBreakdown;
    if (
      !breakdown ||
      typeof breakdown !== "object" ||
      Array.isArray(breakdown)
    ) {
      throw new Error(`第十阶段人工真值第 ${index + 1} 个样本缺少金额拆分`);
    }
    const breakdownRecord = breakdown as Record<string, unknown>;
    const tags = sample.tags;
    if (!Array.isArray(tags) || tags.length === 0) {
      throw new Error(`第十阶段人工真值第 ${index + 1} 个样本缺少覆盖标签`);
    }
    const parsedTags = tags.map((tag) => {
      if (
        typeof tag !== "string" ||
        !(CONTRACT_OCR_STAGE10_REQUIRED_TAGS as readonly string[]).includes(tag)
      ) {
        throw new Error(
          `第十阶段人工真值第 ${index + 1} 个样本存在无效覆盖标签`,
        );
      }
      return tag as ContractOcrStage10CoverageTag;
    });
    if (new Set(parsedTags).size !== parsedTags.length) {
      throw new Error(`第十阶段人工真值第 ${index + 1} 个样本覆盖标签重复`);
    }
    const relationType = sample.relationType;
    if (
      typeof relationType !== "string" ||
      ![
        "main",
        "supplement",
        "change",
        "reduction",
        "termination",
        "other",
      ].includes(relationType)
    ) {
      throw new Error(`第十阶段人工真值第 ${index + 1} 个样本关系类型无效`);
    }
    const amountStatus = expectedRecord.amountStatus;
    if (
      typeof amountStatus !== "string" ||
      !(ALL_AMOUNT_STATUSES as readonly string[]).includes(amountStatus)
    ) {
      throw new Error(`第十阶段人工真值第 ${index + 1} 个样本金额状态无效`);
    }
    const parsedSample: ContractOcrStage10GroundTruthSample = {
      id: String(sample.id || "").trim(),
      familyId: String(sample.familyId || "").trim(),
      sha256: String(sample.sha256 || "")
        .trim()
        .toLowerCase(),
      relativePath: String(sample.relativePath || "").trim(),
      relationType: relationType as ContractOcrStage10RelationType,
      tags: parsedTags,
      expected: {
        party_a: parseNullableText(
          expectedRecord.party_a,
          `第 ${index + 1} 个样本甲方真值`,
        ),
        party_b: parseNullableText(
          expectedRecord.party_b,
          `第 ${index + 1} 个样本乙方真值`,
        ),
        project_name: parseNullableText(
          expectedRecord.project_name,
          `第 ${index + 1} 个样本项目名称真值`,
        ),
        amount: parseNullableText(
          expectedRecord.amount,
          `第 ${index + 1} 个样本金额真值`,
        ),
        contract_date: parseNullableText(
          expectedRecord.contract_date,
          `第 ${index + 1} 个样本日期真值`,
        ),
        amountStatus: amountStatus as ContractOcrStage10AmountStatus,
        amountBreakdown: {
          originalAmount: parseNullableAmount(
            breakdownRecord.originalAmount,
            `第 ${index + 1} 个样本原合同金额`,
          ),
          changeAmount: parseNullableAmount(
            breakdownRecord.changeAmount,
            `第 ${index + 1} 个样本变化金额`,
          ),
          finalAmount: parseNullableAmount(
            breakdownRecord.finalAmount,
            `第 ${index + 1} 个样本最终金额`,
          ),
        },
      },
    };
    if (
      !parsedSample.id ||
      !parsedSample.familyId ||
      !/^[a-f0-9]{64}$/u.test(parsedSample.sha256) ||
      !parsedSample.relativePath
    ) {
      throw new Error(`第十阶段人工真值第 ${index + 1} 个样本身份字段无效`);
    }
    return parsedSample;
  });
  return {
    schemaVersion: 1,
    datasetVersion: document.datasetVersion.trim(),
    samples,
  };
}

function assertAmountTruthSemantics(
  sample: ContractOcrStage10GroundTruthSample,
): void {
  const { amount, amountStatus, amountBreakdown } = sample.expected;
  const allBreakdownEmpty = Object.values(amountBreakdown).every(
    (value) => value === null,
  );
  if (
    ["payment_only", "missing_amount"].includes(amountStatus) &&
    (amount !== null || !allBreakdownEmpty)
  ) {
    throw new Error(
      `${sample.id} 的 ${amountStatus}（金额状态）必须保持金额和金额拆分为空，不能写入 0`,
    );
  }
  if (amountStatus === "confirmed_amount" && amount === null) {
    throw new Error(
      `${sample.id} 的 confirmed_amount（已确认金额）缺少金额真值`,
    );
  }
  if (amountStatus === "calculated_amount") {
    const { originalAmount, changeAmount, finalAmount } = amountBreakdown;
    if (
      amount === null ||
      originalAmount === null ||
      changeAmount === null ||
      finalAmount === null ||
      Math.round((originalAmount + changeAmount) * 100) !==
        Math.round(finalAmount * 100) ||
      Number(amount) !== changeAmount
    ) {
      throw new Error(
        `${sample.id} 的 calculated_amount（计算金额）必须满足最终金额=原金额+变化金额，且 amount（金额）保存本次变化量`,
      );
    }
  }
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function fingerprintImplementation(
  projectRoot: string,
): FrozenFileFingerprint[] {
  return IMPLEMENTATION_FILES.map((item) => {
    const absolutePath = path.resolve(projectRoot, item.relativePath);
    if (!absolutePath.startsWith(`${path.resolve(projectRoot)}${path.sep}`)) {
      throw new Error("版本冻结实现文件路径越界");
    }
    if (!fs.statSync(absolutePath).isFile()) {
      throw new Error(`版本冻结实现文件不存在：${item.relativePath}`);
    }
    return {
      role: item.role,
      relativePath: item.relativePath,
      sha256: sha256File(absolutePath),
    };
  });
}

function frozenVersions(
  implementationFiles: FrozenFileFingerprint[],
  automaticPolicyVersion: string,
): ContractOcrStage10Freeze["versions"] {
  const implementationDigest = sha256(stableJson(implementationFiles));
  const evaluationDigest = sha256(
    stableJson(
      implementationFiles.filter((item) => item.role.startsWith("evaluation_")),
    ),
  );
  const fieldRules = implementationFiles.find(
    (item) => item.role === "field_rules",
  );
  if (!fieldRules) throw new Error("冻结实现摘要缺少字段规则文件");
  return {
    ocrModel: CONTRACT_OCR_STAGE10_MODEL,
    paddleOcrVersion: CONTRACT_OCR_STAGE10_PADDLEOCR_VERSION,
    rulesVersion: `contract-rules-sha256-${fieldRules.sha256.slice(0, 16)}`,
    automaticPolicyVersion,
    implementationDigest,
    evaluationDigest,
  };
}

export function createContractOcrStage10Baseline(
  options: {
    projectRoot: string;
    automaticPolicyVersion: string;
    configuredOcrModel: string;
  },
  frozenAt = new Date().toISOString(),
): ContractOcrStage10Baseline {
  if (options.configuredOcrModel !== CONTRACT_OCR_STAGE10_MODEL) {
    throw new Error(
      `版本基线必须显式配置 OCR_MODEL=${CONTRACT_OCR_STAGE10_MODEL}`,
    );
  }
  if (!options.automaticPolicyVersion.trim()) {
    throw new Error("版本基线自动采用策略版本不能为空");
  }
  if (!Number.isFinite(Date.parse(frozenAt)))
    throw new Error("版本基线时间无效");
  const files = fingerprintImplementation(options.projectRoot);
  const versions = frozenVersions(files, options.automaticPolicyVersion);
  const basis = {
    schemaVersion: 1 as const,
    frozenAt,
    versions,
    implementation: { files },
  };
  return {
    ...basis,
    baselineId: `contract-ocr-stage10-baseline-${sha256(stableJson(basis)).slice(0, 20)}`,
    immutable: true,
    guardrails: {
      dataIndependent: true,
      rulesMayChangeAfterBaseline: false,
      automaticPolicyMayChangeAfterBaseline: false,
      modelMayChangeAfterBaseline: false,
      persistenceMayChangeAfterBaseline: false,
      evaluationMayChangeAfterBaseline: false,
    },
  };
}

export function verifyContractOcrStage10Baseline(
  baseline: ContractOcrStage10Baseline,
  options: {
    projectRoot: string;
    automaticPolicyVersion: string;
    configuredOcrModel: string;
  },
): void {
  const current = createContractOcrStage10Baseline(options, baseline.frozenAt);
  if (
    baseline.schemaVersion !== 1 ||
    baseline.immutable !== true ||
    stableJson(baseline) !== stableJson(current)
  ) {
    throw new Error(
      "第十阶段版本基线校验失败：规则、模型、自动策略、落库链路或评测口径已变化",
    );
  }
}

export function readContractOcrStage10Baseline(
  filePath: string,
): ContractOcrStage10Baseline {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("第十阶段版本基线不是合法 JSON（JavaScript 对象表示法）");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("第十阶段版本基线必须是对象");
  }
  return value as ContractOcrStage10Baseline;
}

function inspectFreezeInputs(
  options: ContractOcrStage10FreezeOptions,
): Omit<
  ContractOcrStage10Freeze,
  "freezeId" | "frozenAt" | "immutable" | "guardrails"
> {
  if (options.configuredOcrModel !== CONTRACT_OCR_STAGE10_MODEL) {
    throw new Error(
      `第十阶段必须显式配置 OCR_MODEL=${CONTRACT_OCR_STAGE10_MODEL}，实际为 ${options.configuredOcrModel || "空"}`,
    );
  }
  if (!options.automaticPolicyVersion.trim()) {
    throw new Error("自动采用策略版本不能为空");
  }
  if (!options.datasetVersion.trim()) throw new Error("盲测数据集版本不能为空");

  const baseline = readContractOcrStage10Baseline(options.baselinePath);
  verifyContractOcrStage10Baseline(baseline, {
    projectRoot: options.projectRoot,
    automaticPolicyVersion: options.automaticPolicyVersion,
    configuredOcrModel: options.configuredOcrModel,
  });

  const candidateContent = fs.readFileSync(
    options.candidateManifestPath,
    "utf8",
  );
  const finalContent = fs.readFileSync(options.finalManifestPath, "utf8");
  const mappingContent = fs.readFileSync(options.mappingPath, "utf8");
  const groundTruthContent = fs.readFileSync(options.groundTruthPath, "utf8");
  const inventoryContent = fs.readFileSync(options.inventoryPath, "utf8");
  const familyIsolationMetadataContent = fs.readFileSync(
    options.familyIsolationMetadataPath,
    "utf8",
  );
  const familyIsolationLineageContent = fs.readFileSync(
    options.familyIsolationLineagePath,
    "utf8",
  );
  const familyRegistryContent = fs.readFileSync(
    options.familyRegistryPath,
    "utf8",
  );
  if (options.exclusionManifestPaths.length < 2) {
    throw new Error("第十阶段冻结至少需要两个历史排除清单");
  }
  if (options.consumedAuditPaths.length === 0) {
    throw new Error(
      "第十阶段冻结至少需要一个历史 consumed（已消耗）审计注册表",
    );
  }
  const candidateRows = parseContractOcrInventory(
    candidateContent,
    "第十阶段候选清单",
  );
  const finalRows = parseContractOcrInventory(
    finalContent,
    "第十阶段最终盲测清单",
  );
  let familyIsolationMetadata: Record<string, unknown>;
  let familyIsolationLineage: Record<string, unknown>;
  try {
    familyIsolationMetadata = JSON.parse(
      familyIsolationMetadataContent,
    ) as Record<string, unknown>;
  } catch {
    throw new Error(
      "合同族隔离公开元数据不是合法 JSON（JavaScript 对象表示法）",
    );
  }
  try {
    familyIsolationLineage = JSON.parse(
      familyIsolationLineageContent,
    ) as Record<string, unknown>;
  } catch {
    throw new Error("合同族隔离私有谱系不是合法 JSON（JavaScript 对象表示法）");
  }
  const familySource = familyIsolationMetadata.source as
    | Record<string, unknown>
    | undefined;
  const familyRules = familyIsolationMetadata.familyIsolation as
    | Record<string, unknown>
    | undefined;
  const blindFreeze = familyIsolationMetadata.blindFreeze as
    | Record<string, unknown>
    | undefined;
  const lineageInputs = familyIsolationLineage.inputs as
    | Record<string, unknown>
    | undefined;
  const lineageOutputs = familyIsolationLineage.outputs as
    | Record<string, unknown>
    | undefined;
  const exclusionSha256 = options.exclusionManifestPaths.map(sha256File);
  const consumedSha256 = options.consumedAuditPaths.map(sha256File);
  if (
    familyIsolationMetadata.schemaVersion !== 1 ||
    familyIsolationMetadata.datasetVersion !== options.datasetVersion ||
    familyIsolationMetadata.selectionPolicyVersion !==
      CONTRACT_OCR_FAMILY_ISOLATION_POLICY_VERSION ||
    familyIsolationMetadata.requestedSize !==
      CONTRACT_OCR_STAGE10_EXPECTED_COUNT ||
    familySource?.exclusionManifestCount !==
      options.exclusionManifestPaths.length ||
    familySource?.consumedAuditFileCount !==
      options.consumedAuditPaths.length ||
    familySource?.privateFamilyRegistryComplete !== true ||
    familyRules?.privateFamilyRegistryRequired !== true ||
    familyRules?.privateFamilyRegistryUsed !== true ||
    familyRules?.wholeFamilyExclusion !== true ||
    familyRules?.maximumSelectedPerFamily !== 1 ||
    blindFreeze?.status !== "frozen" ||
    blindFreeze?.exactTargetRequired !== true ||
    blindFreeze?.candidateDocuments !== candidateRows.length ||
    blindFreeze?.frozenDocuments !== CONTRACT_OCR_STAGE10_EXPECTED_COUNT ||
    familyIsolationLineage.schemaVersion !== 1 ||
    familyIsolationLineage.datasetVersion !== options.datasetVersion ||
    familyIsolationLineage.selectionPolicyVersion !==
      CONTRACT_OCR_FAMILY_ISOLATION_POLICY_VERSION ||
    lineageInputs?.inventorySha256 !== sha256(inventoryContent) ||
    lineageInputs?.familyRegistrySha256 !== sha256(familyRegistryContent) ||
    stableJson(lineageInputs?.exclusionManifestSha256) !==
      stableJson(exclusionSha256) ||
    stableJson(lineageInputs?.consumedAuditSha256) !==
      stableJson(consumedSha256) ||
    lineageOutputs?.candidateManifestSha256 !== sha256(candidateContent) ||
    lineageOutputs?.finalManifestSha256 !== sha256(finalContent) ||
    lineageOutputs?.mappingSha256 !== sha256(mappingContent)
  ) {
    throw new Error(
      "合同族隔离元数据未证明完整私有注册表、历史排除传播、120-140份候选和100族冻结",
    );
  }
  assertUniqueInventory(candidateRows, "第十阶段候选清单");
  assertUniqueInventory(finalRows, "第十阶段最终盲测清单");
  if (
    candidateRows.length < CONTRACT_OCR_STAGE10_CANDIDATE_MINIMUM ||
    candidateRows.length > CONTRACT_OCR_STAGE10_CANDIDATE_MAXIMUM
  ) {
    throw new Error(
      `第十阶段候选清单必须为 ${CONTRACT_OCR_STAGE10_CANDIDATE_MINIMUM}-${CONTRACT_OCR_STAGE10_CANDIDATE_MAXIMUM} 份，实际为 ${candidateRows.length} 份`,
    );
  }
  if (finalRows.length !== CONTRACT_OCR_STAGE10_EXPECTED_COUNT) {
    throw new Error(
      `第十阶段最终盲测清单必须为 ${CONTRACT_OCR_STAGE10_EXPECTED_COUNT} 份，实际为 ${finalRows.length} 份`,
    );
  }
  const unsupportedFinalFormat = finalRows.find(
    (row) => row.extension !== "pdf",
  );
  if (unsupportedFinalFormat) {
    throw new Error(
      "第十阶段最终盲测集只接受 PDF（便携式文档格式）；现有上传接口不接受图片，DOC/DOCX（文档格式）又不形成第六版模型逐行证据",
    );
  }
  const candidateDigests = new Set(candidateRows.map((row) => row.sha256));
  if (finalRows.some((row) => !candidateDigests.has(row.sha256))) {
    throw new Error("第十阶段最终盲测清单包含候选池之外的合同");
  }

  const selectedMapping = parseSelectedMapping(mappingContent);
  if (selectedMapping.length !== CONTRACT_OCR_STAGE10_EXPECTED_COUNT) {
    throw new Error("合同族私有映射必须恰好包含 100 个已选择样本");
  }
  if (
    new Set(selectedMapping.map((row) => row.sampleId)).size !==
      selectedMapping.length ||
    new Set(selectedMapping.map((row) => row.familyId)).size !==
      selectedMapping.length ||
    new Set(selectedMapping.map((row) => row.sha256)).size !==
      selectedMapping.length
  ) {
    throw new Error("最终盲测集必须具有 100 个唯一匿名编号、合同族和文件摘要");
  }
  const finalByDigest = new Map(finalRows.map((row) => [row.sha256, row]));
  for (const mapping of selectedMapping) {
    const manifest = finalByDigest.get(mapping.sha256);
    if (!manifest || manifest.relativePath !== mapping.relativePath) {
      throw new Error("合同族私有映射与最终盲测清单不一致");
    }
  }

  const groundTruth = parseGroundTruth(groundTruthContent);
  if (groundTruth.datasetVersion !== options.datasetVersion) {
    throw new Error("人工真值数据集版本与冻结参数不一致");
  }
  if (groundTruth.samples.length !== CONTRACT_OCR_STAGE10_EXPECTED_COUNT) {
    throw new Error("第十阶段人工真值必须恰好包含 100 份合同");
  }
  const truthById = new Map(
    groundTruth.samples.map((sample) => [sample.id, sample]),
  );
  if (truthById.size !== groundTruth.samples.length) {
    throw new Error("第十阶段人工真值包含重复匿名样本编号");
  }
  for (const mapping of selectedMapping) {
    const truth = truthById.get(mapping.sampleId);
    if (
      !truth ||
      truth.familyId !== mapping.familyId ||
      truth.sha256 !== mapping.sha256 ||
      truth.relativePath !== mapping.relativePath ||
      truth.relationType !== mapping.relationType
    ) {
      throw new Error("人工真值身份与合同族私有映射不一致");
    }
    assertAmountTruthSemantics(truth);
  }

  const byTag = Object.fromEntries(
    CONTRACT_OCR_STAGE10_REQUIRED_TAGS.map((tag) => [tag, 0]),
  ) as Record<ContractOcrStage10CoverageTag, number>;
  const byAmountStatus = Object.fromEntries(
    ALL_AMOUNT_STATUSES.map((status) => [status, 0]),
  ) as Record<ContractOcrStage10AmountStatus, number>;
  for (const sample of groundTruth.samples) {
    for (const tag of sample.tags) byTag[tag] += 1;
    byAmountStatus[sample.expected.amountStatus] += 1;
  }
  const missingTag = CONTRACT_OCR_STAGE10_REQUIRED_TAGS.find(
    (tag) => byTag[tag] === 0,
  );
  if (missingTag)
    throw new Error(`第十阶段盲测集未覆盖必要类型：${missingTag}`);
  const missingAmountStatus = ALL_AMOUNT_STATUSES.find(
    (status) => byAmountStatus[status] === 0,
  );
  if (missingAmountStatus) {
    throw new Error(`第十阶段盲测集未覆盖金额状态：${missingAmountStatus}`);
  }

  return {
    schemaVersion: CONTRACT_OCR_STAGE10_FREEZE_SCHEMA_VERSION,
    baselineId: baseline.baselineId,
    datasetVersion: options.datasetVersion,
    versions: baseline.versions,
    implementation: baseline.implementation,
    selectionProvenance: {
      policyVersion: CONTRACT_OCR_FAMILY_ISOLATION_POLICY_VERSION,
      metadataSha256: sha256(familyIsolationMetadataContent),
      lineageSha256: sha256(familyIsolationLineageContent),
      inventorySha256: sha256(inventoryContent),
      familyRegistrySha256: sha256(familyRegistryContent),
      exclusionManifestSha256: exclusionSha256,
      consumedAuditSha256: consumedSha256,
    },
    candidateSet: {
      count: candidateRows.length,
      manifestSha256: sha256(candidateContent),
      inputSetDigest: inputSetDigest(candidateRows),
    },
    blindSet: {
      count: CONTRACT_OCR_STAGE10_EXPECTED_COUNT,
      uniqueFamilyCount: CONTRACT_OCR_STAGE10_EXPECTED_COUNT,
      manifestSha256: sha256(finalContent),
      mappingSha256: sha256(mappingContent),
      groundTruthSha256: sha256(groundTruthContent),
      inputSetDigest: inputSetDigest(finalRows),
      samples: selectedMapping
        .map((row) => ({
          sampleId: row.sampleId,
          familyId: row.familyId,
          sha256: row.sha256,
        }))
        .sort((left, right) => left.sampleId.localeCompare(right.sampleId)),
    },
    coverage: {
      byRelationType: countBy(
        groundTruth.samples.map((sample) => sample.relationType),
      ),
      byAmountStatus,
      byTag,
    },
  };
}

export function createContractOcrStage10Freeze(
  options: ContractOcrStage10FreezeOptions,
  frozenAt = new Date().toISOString(),
): ContractOcrStage10Freeze {
  const inspected = inspectFreezeInputs(options);
  if (!Number.isFinite(Date.parse(frozenAt))) {
    throw new Error("冻结时间不是有效时间");
  }
  const freezeBasis = {
    ...inspected,
    frozenAt,
  };
  return {
    ...inspected,
    freezeId: `contract-ocr-stage10-${sha256(stableJson(freezeBasis)).slice(0, 20)}`,
    frozenAt,
    immutable: true,
    guardrails: {
      rulesMayChangeAfterFreeze: false,
      automaticPolicyMayChangeAfterFreeze: false,
      modelMayChangeAfterFreeze: false,
      persistenceMayChangeAfterFreeze: false,
      blindSamplesMayBeUsedForTuning: false,
    },
  };
}

export function verifyContractOcrStage10Freeze(
  freeze: ContractOcrStage10Freeze,
  options: ContractOcrStage10FreezeOptions,
): void {
  if (
    freeze.schemaVersion !== CONTRACT_OCR_STAGE10_FREEZE_SCHEMA_VERSION ||
    freeze.immutable !== true
  ) {
    throw new Error("第十阶段冻结文件结构或不可变标记无效");
  }
  const current = inspectFreezeInputs(options);
  const comparableFreeze = {
    schemaVersion: freeze.schemaVersion,
    baselineId: freeze.baselineId,
    datasetVersion: freeze.datasetVersion,
    versions: freeze.versions,
    implementation: freeze.implementation,
    selectionProvenance: freeze.selectionProvenance,
    candidateSet: freeze.candidateSet,
    blindSet: freeze.blindSet,
    coverage: freeze.coverage,
  };
  if (stableJson(comparableFreeze) !== stableJson(current)) {
    throw new Error(
      "第十阶段冻结校验失败：模型、规则、自动策略、落库链路、清单、合同族映射或真值已发生变化",
    );
  }
  const expectedFreezeId = `contract-ocr-stage10-${sha256(
    stableJson({ ...current, frozenAt: freeze.frozenAt }),
  ).slice(0, 20)}`;
  if (freeze.freezeId !== expectedFreezeId) {
    throw new Error("第十阶段冻结编号与冻结内容不一致");
  }
}

export function readContractOcrStage10GroundTruth(
  filePath: string,
): ContractOcrStage10GroundTruth {
  return parseGroundTruth(fs.readFileSync(filePath, "utf8"));
}

export function readContractOcrStage10Freeze(
  filePath: string,
): ContractOcrStage10Freeze {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new Error("第十阶段冻结文件不是合法 JSON（JavaScript 对象表示法）");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("第十阶段冻结文件必须是对象");
  }
  return value as ContractOcrStage10Freeze;
}

export function writePrivateImmutableJson(
  outputPath: string,
  value: unknown,
): void {
  if (fs.existsSync(outputPath)) {
    throw new Error("私有冻结或评测输出已存在，拒绝覆盖");
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${sha256(outputPath).slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, outputPath);
    fs.chmodSync(outputPath, 0o600);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}
