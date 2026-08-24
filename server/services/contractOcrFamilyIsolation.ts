import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  parseContractOcrInventory,
  type ContractOcrInventoryRow,
} from "./contractOcrHoldout.js";

export const CONTRACT_OCR_FAMILY_ISOLATION_POLICY_VERSION =
  "deterministic-private-registry-path-filename-family-v2";

const PRIVATE_FAMILY_REGISTRY_HEADER = "SHA256\t外部合同族编号\t关系类型";
const FAMILY_RELATION_TYPES = new Set([
  "main",
  "supplement",
  "change",
  "reduction",
  "termination",
  "other",
]);

const INVENTORY_HEADER = "行政区\t分类\t状态\t扩展名\t字节数\tSHA256\t相对路径";
const CONTRACT_CATEGORIES = new Set([
  "主合同或其他合同",
  "补充协议",
  "解除或终止协议",
]);
const GENERIC_FAMILY_CORES = new Set([
  "合同",
  "服务合同",
  "技术服务合同",
  "咨询服务合同",
  "补充协议",
  "变更协议",
  "追加协议",
  "核减协议",
  "解除协议",
  "终止协议",
  "协议书",
]);

export type ContractOcrFamilyKeyKind =
  | "private_family_registry"
  | "project_directory"
  | "normalized_file_name";

export type ContractOcrFamilyRelationType =
  | "main"
  | "supplement"
  | "change"
  | "reduction"
  | "termination"
  | "other";

export interface ContractOcrBlindFreezeOptions {
  outputCandidateManifestPath: string;
  outputLineagePath: string;
  minimumCandidateDocuments: number;
  maximumCandidateDocuments: number;
}

export interface ContractOcrFamilyKey {
  kind: ContractOcrFamilyKeyKind;
  key: string;
}

export interface ContractOcrFamilyIsolationOptions {
  inventoryPath: string;
  exclusionManifestPaths: string[];
  consumedAuditPaths?: string[];
  privateFamilyRegistryPath?: string;
  outputManifestPath: string;
  outputMappingPath: string;
  outputMetadataPath: string;
  targetSize: number;
  seed: string;
  datasetVersion: string;
  sampleIdPrefix?: string;
  blindFreeze?: ContractOcrBlindFreezeOptions;
  overwrite?: boolean;
}

export interface ContractOcrFamilyIsolationMetadata {
  schemaVersion: 1;
  datasetVersion: string;
  selectionPolicyVersion: string;
  seed: string;
  requestedSize: number;
  source: {
    inventoryRows: number;
    uniqueDocuments: number;
    exactDuplicateRows: number;
    exclusionManifestCount: number;
    consumedAuditFileCount: number;
    consumedAuditUniqueDocuments: number;
    directlyExcludedDocuments: number;
    privateFamilyRegistryDocuments: number;
    privateFamilyRegistryFamilies: number;
    privateFamilyRegistryComplete: boolean;
  };
  familyIsolation: {
    method:
      | "path_filename_exact_heuristic"
      | "private_registry_plus_path_filename_exact_heuristic";
    buildOrder: "build_families_before_exclusion";
    wholeFamilyExclusion: true;
    maximumSelectedPerFamily: 1;
    privateFamilyRegistryRequired: boolean;
    privateFamilyRegistryUsed: boolean;
    visualNearDuplicateIsolation: false;
    textNearDuplicateIsolation: false;
    strictVisualNearDuplicateClaim: false;
    claim: string;
    limitations: string[];
  };
  capacity: {
    totalFamilies: number;
    multiDocumentFamilies: number;
    maximumFamilySize: number;
    contaminatedFamilies: number;
    additionallyExcludedByFamily: number;
    eligibleDocuments: number;
    eligibleFamilies: number;
    selectedDocuments: number;
    sufficient: boolean;
    shortfall: number;
    notice: string;
  };
  blindFreeze?: {
    status: "frozen";
    exactTargetRequired: true;
    minimumCandidateDocuments: number;
    maximumCandidateDocuments: number;
    candidateDocuments: number;
    candidateFamilies: number;
    frozenDocuments: number;
  };
  selectedDistribution: {
    byCategory: Record<string, number>;
    byRegion: Record<string, number>;
    byFormat: Record<string, number>;
  };
  samples: Array<{
    sampleId: string;
    region: string;
    category: string;
    sourceStatus: string;
    format: string;
  }>;
  privacy: {
    includesDocumentDigests: false;
    includesDocumentPaths: false;
    includesContractFieldValues: false;
    privateCandidateManifestMode?: "0600";
    privateLineageMode?: "0600";
    privateManifestMode: "0600";
    privateMappingMode: "0600";
  };
}

export interface ContractOcrFamilyIsolationResult {
  sourceRows: number;
  sourceUniqueDocuments: number;
  consumedAuditUniqueDocuments: number;
  directlyExcludedDocuments: number;
  additionallyExcludedByFamily: number;
  eligibleDocuments: number;
  eligibleFamilies: number;
  selectedDocuments: number;
  capacitySufficient: boolean;
  capacityShortfall: number;
  candidatePoolDocuments: number;
  metadata: ContractOcrFamilyIsolationMetadata;
}

interface PrivateFamilyRegistryEntry {
  externalFamilyId: string;
  relationType: ContractOcrFamilyRelationType;
}

interface FamilyEdge {
  left: string;
  right: string;
  kind: ContractOcrFamilyKeyKind;
}

interface FamilyGroup {
  id: string;
  rows: ContractOcrInventoryRow[];
  basis: string[];
  directlyExcluded: boolean;
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  constructor(values: readonly string[]) {
    for (const value of values) this.parent.set(value, value);
  }

  find(value: string): string {
    const parent = this.parent.get(value);
    if (!parent) throw new Error("合同族节点不存在");
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    // 固定使用字典序较小的根，避免库存行顺序影响合同族结果。
    if (leftRoot < rightRoot) this.parent.set(rightRoot, leftRoot);
    else this.parent.set(leftRoot, rightRoot);
  }
}

function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableRank(seed: string, scope: string, value: string): string {
  return digestText(`${seed}\u0000${scope}\u0000${value}`);
}

function simpleComparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_—–·,，。:：;；/\\（）()【】[\]{}-]+/gu, "");
}

/**
 * 只提取路径和文件名中的稳定业务核心。该函数不读取合同正文，也不声称
 * 能识别重新扫描、删页、盖章前后版本等视觉近重复。
 */
export function normalizeContractFamilyText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\.(?:pdf|docx?|jpe?g|png)$/giu, "")
    .replace(/^\s*\d+\s*[-_.、]\s*/u, "")
    .replace(
      /(?:19|20)\d{2}\s*[-_.年]\s*(?:19|20)?\d{2}(?:\s*[-_.年]\s*(?:19|20)?\d{2})*/gu,
      "",
    )
    .replace(/(?:19|20)\d{6}/gu, "")
    .replace(/(?:19|20)\d{2}\s*年?/gu, "")
    .replace(/(?:人民币)?\s*[￥¥]\s*[+-]?\s*[\d,.]+(?:\s*元)?/gu, "")
    .replace(
      /合同及补充协议书?|技术咨询服务合同|技术服务合同|咨询服务合同|补充协议书?|变更协议书?|追加协议书?|核减协议书?|解除协议书?|终止协议书?|(?:主|原)?合同书?|协议书?/gu,
      "",
    )
    .replace(/k\s*v/giu, "千伏")
    .replace(/[√✓]/gu, "")
    .replace(/[\s_—–·,，。:：;；/\\（）()【】[\]{}-]+/gu, "")
    .trim();
}

function usableFamilyCore(value: string): boolean {
  if (value.length < 3 || GENERIC_FAMILY_CORES.has(value)) return false;
  return /[\p{Script=Han}a-z0-9]/u.test(value);
}

function relativePathSegments(relativePath: string): string[] {
  return relativePath.split(/[\\/]/u).filter(Boolean);
}

/** 返回仅由行政区、项目目录和文件名派生的高精度精确匹配键。 */
export function contractOcrFamilyKeys(
  row: ContractOcrInventoryRow,
): ContractOcrFamilyKey[] {
  const segments = relativePathSegments(row.relativePath);
  const fileName = segments[segments.length - 1] || "";
  const directories = segments.slice(1, -1);
  const regionComparable = simpleComparable(row.region);
  while (
    directories.length > 0 &&
    simpleComparable(directories[0]) === regionComparable
  ) {
    directories.shift();
  }

  const scopedPrefix = `region:${regionComparable}\u0000`;
  const keys: ContractOcrFamilyKey[] = [];
  const projectDirectory = directories[0]
    ? normalizeContractFamilyText(directories[0])
    : "";
  if (usableFamilyCore(projectDirectory)) {
    keys.push({
      kind: "project_directory",
      key: `${scopedPrefix}directory:${projectDirectory}`,
    });
  }

  const normalizedFileName = normalizeContractFamilyText(fileName);
  if (usableFamilyCore(normalizedFileName)) {
    keys.push({
      kind: "normalized_file_name",
      key: `${scopedPrefix}file:${normalizedFileName}`,
    });
  }
  return keys;
}

function canonicalRowKey(row: ContractOcrInventoryRow): string {
  return [
    row.region,
    row.category,
    row.sourceStatus,
    row.extension,
    String(row.size),
    row.relativePath,
  ].join("\u0000");
}

function uniqueContractRows(
  rows: ContractOcrInventoryRow[],
  label: string,
): ContractOcrInventoryRow[] {
  const sorted = [...rows].sort((left, right) =>
    compareText(canonicalRowKey(left), canonicalRowKey(right)),
  );
  const unique = new Map<string, ContractOcrInventoryRow>();
  for (const row of sorted) {
    if (!CONTRACT_CATEGORIES.has(row.category)) {
      throw new Error(`${label}包含非合同记录`);
    }
    const previous = unique.get(row.sha256);
    if (!previous) {
      unique.set(row.sha256, row);
      continue;
    }
    const previousMetadata = [
      previous.region,
      previous.category,
      previous.sourceStatus,
      previous.extension,
      previous.size,
    ].join("\u0000");
    const currentMetadata = [
      row.region,
      row.category,
      row.sourceStatus,
      row.extension,
      row.size,
    ].join("\u0000");
    if (previousMetadata !== currentMetadata) {
      throw new Error(`${label}中相同文件摘要的分层元数据冲突`);
    }
  }
  return [...unique.values()];
}

function parseConsumedAuditDigests(
  content: string,
  sourceLabel: string,
): Set<string> {
  const digests = new Set<string>();
  const lines = content.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(
        `${sourceLabel} 第 ${index + 1} 行不是合法 JSON（JavaScript 对象表示法）`,
      );
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `${sourceLabel} 第 ${index + 1} 行必须是 JSON（JavaScript 对象表示法）对象`,
      );
    }
    const record = value as Record<string, unknown>;
    if (record.kind !== "contract") continue;
    if (
      typeof record.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/iu.test(record.sha256)
    ) {
      throw new Error(`${sourceLabel} 第 ${index + 1} 行合同记录 SHA-256 无效`);
    }
    digests.add(record.sha256.toLowerCase());
  }
  return digests;
}

function parsePrivateFamilyRegistry(
  content: string,
  sourceLabel: string,
): Map<string, PrivateFamilyRegistryEntry> {
  const lines = content
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
  if (lines.length === 0 || lines[0] !== PRIVATE_FAMILY_REGISTRY_HEADER) {
    throw new Error(
      `${sourceLabel} 必须使用 3 列表头：${PRIVATE_FAMILY_REGISTRY_HEADER.replace(/\t/gu, "、")}`,
    );
  }

  const registry = new Map<string, PrivateFamilyRegistryEntry>();
  for (let index = 1; index < lines.length; index += 1) {
    const columns = lines[index].split("\t");
    if (columns.length !== 3) {
      throw new Error(`${sourceLabel} 第 ${index + 1} 行不是 3 列`);
    }
    const [sha256Value, externalFamilyIdValue, relationTypeValue] = columns;
    const sha256 = sha256Value.toLowerCase();
    const externalFamilyId = externalFamilyIdValue.trim();
    if (!/^[a-f0-9]{64}$/u.test(sha256)) {
      throw new Error(`${sourceLabel} 第 ${index + 1} 行 SHA-256 无效`);
    }
    if (
      !externalFamilyId ||
      externalFamilyId.length > 160 ||
      externalFamilyId !== externalFamilyIdValue ||
      externalFamilyId.includes("\u0000")
    ) {
      throw new Error(`${sourceLabel} 第 ${index + 1} 行外部合同族编号无效`);
    }
    if (!FAMILY_RELATION_TYPES.has(relationTypeValue)) {
      throw new Error(`${sourceLabel} 第 ${index + 1} 行关系类型无效`);
    }
    if (registry.has(sha256)) {
      throw new Error(`${sourceLabel} 第 ${index + 1} 行文档摘要重复`);
    }
    registry.set(sha256, {
      externalFamilyId,
      relationType: relationTypeValue as ContractOcrFamilyRelationType,
    });
  }
  return registry;
}

function buildFamilies(
  rows: ContractOcrInventoryRow[],
  directlyExcluded: Set<string>,
  seed: string,
  privateFamilyRegistry: Map<string, PrivateFamilyRegistryEntry>,
): FamilyGroup[] {
  const disjointSet = new DisjointSet(rows.map((row) => row.sha256));
  const registryOwnerByFamily = new Map<string, string>();
  const ownerByKey = new Map<string, string>();
  const edges: FamilyEdge[] = [];

  for (const row of rows) {
    const registryEntry = privateFamilyRegistry.get(row.sha256);
    if (!registryEntry) continue;
    const owner = registryOwnerByFamily.get(registryEntry.externalFamilyId);
    if (!owner) {
      registryOwnerByFamily.set(registryEntry.externalFamilyId, row.sha256);
      continue;
    }
    disjointSet.union(owner, row.sha256);
    edges.push({
      left: owner,
      right: row.sha256,
      kind: "private_family_registry",
    });
  }

  for (const row of rows) {
    for (const familyKey of contractOcrFamilyKeys(row)) {
      const owner = ownerByKey.get(familyKey.key);
      if (!owner) {
        ownerByKey.set(familyKey.key, row.sha256);
        continue;
      }
      const ownerRegistry = privateFamilyRegistry.get(owner);
      const rowRegistry = privateFamilyRegistry.get(row.sha256);
      if (
        ownerRegistry &&
        rowRegistry &&
        ownerRegistry.externalFamilyId !== rowRegistry.externalFamilyId
      ) {
        throw new Error(
          "私有合同族注册表与路径／文件名合同族键冲突，拒绝冻结盲测集",
        );
      }
      disjointSet.union(owner, row.sha256);
      edges.push({ left: owner, right: row.sha256, kind: familyKey.kind });
    }
  }

  const membersByRoot = new Map<string, ContractOcrInventoryRow[]>();
  for (const row of rows) {
    const root = disjointSet.find(row.sha256);
    const members = membersByRoot.get(root) || [];
    members.push(row);
    membersByRoot.set(root, members);
  }
  const basisByRoot = new Map<string, Set<string>>();
  for (const edge of edges) {
    const root = disjointSet.find(edge.left);
    const basis = basisByRoot.get(root) || new Set<string>();
    basis.add(edge.kind);
    basisByRoot.set(root, basis);
  }

  return [...membersByRoot.values()]
    .map((members) => {
      const sortedMembers = [...members].sort((left, right) =>
        compareText(left.sha256, right.sha256),
      );
      const root = disjointSet.find(sortedMembers[0].sha256);
      const memberIdentity = sortedMembers
        .map((row) => row.sha256)
        .join("\u0000");
      return {
        id: `FAM-${stableRank(seed, "private-family-id", memberIdentity)
          .slice(0, 16)
          .toUpperCase()}`,
        rows: sortedMembers,
        basis: [...(basisByRoot.get(root) || new Set(["singleton"]))].sort(
          compareText,
        ),
        directlyExcluded: sortedMembers.some((row) =>
          directlyExcluded.has(row.sha256),
        ),
      };
    })
    .sort((left, right) => compareText(left.id, right.id));
}

function representativeForFamily(
  family: FamilyGroup,
  seed: string,
): ContractOcrInventoryRow {
  return [...family.rows].sort((left, right) => {
    const rank = compareText(
      stableRank(seed, "family-representative", left.sha256),
      stableRank(seed, "family-representative", right.sha256),
    );
    return rank || compareText(left.sha256, right.sha256);
  })[0];
}

function inventoryLine(row: ContractOcrInventoryRow): string {
  return [
    row.region,
    row.category,
    row.sourceStatus,
    row.extension,
    String(row.size),
    row.sha256,
    row.relativePath,
  ].join("\t");
}

function countBy(
  rows: ContractOcrInventoryRow[],
  value: (row: ContractOcrInventoryRow) => string,
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = value(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => compareText(left, right)),
  );
}

function assertOutputPaths(options: ContractOcrFamilyIsolationOptions): void {
  const outputs = [
    options.outputManifestPath,
    options.outputMappingPath,
    options.outputMetadataPath,
    ...(options.blindFreeze
      ? [
          options.blindFreeze.outputCandidateManifestPath,
          options.blindFreeze.outputLineagePath,
        ]
      : []),
  ].map((value) => path.resolve(value));
  const inputs = [
    options.inventoryPath,
    ...options.exclusionManifestPaths,
    ...(options.consumedAuditPaths || []),
    ...(options.privateFamilyRegistryPath
      ? [options.privateFamilyRegistryPath]
      : []),
  ].map((value) => path.resolve(value));
  if (new Set(outputs).size !== outputs.length) {
    throw new Error("合同族隔离的输出路径必须互不相同");
  }
  if (outputs.some((output) => inputs.includes(output))) {
    throw new Error("合同族隔离输出路径不能覆盖源库存或排除清单");
  }
  if (!options.overwrite) {
    const existing = outputs.find((output) => fs.existsSync(output));
    if (existing) throw new Error("合同族隔离输出已存在，拒绝覆盖");
  }
}

function writeFileWithMode(
  filePath: string,
  content: string,
  mode: number,
  overwrite: boolean,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!overwrite && fs.existsSync(filePath)) {
    throw new Error("合同族隔离输出已存在，拒绝覆盖");
  }
  const temporaryPath = `${filePath}.${process.pid}.${digestText(filePath).slice(0, 8)}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, {
      encoding: "utf8",
      mode,
      flag: "wx",
    });
    fs.chmodSync(temporaryPath, mode);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, mode);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function privateMappingContent(
  rows: ContractOcrInventoryRow[],
  families: FamilyGroup[],
  directlyExcluded: Set<string>,
  selectedSampleIds: Map<string, string>,
  privateFamilyRegistry: Map<string, PrivateFamilyRegistryEntry>,
): string {
  const familyByDocument = new Map<
    string,
    { family: FamilyGroup; representative: boolean }
  >();
  for (const family of families) {
    for (const row of family.rows) {
      familyByDocument.set(row.sha256, {
        family,
        representative: selectedSampleIds.has(row.sha256),
      });
    }
  }
  const header = [
    "匿名样本编号",
    "合同族编号",
    "关系类型",
    "选择状态",
    "族依据",
    INVENTORY_HEADER,
  ].join("\t");
  const lines = [...rows]
    .sort((left, right) => {
      const leftFamily = familyByDocument.get(left.sha256)?.family.id || "";
      const rightFamily = familyByDocument.get(right.sha256)?.family.id || "";
      return (
        compareText(leftFamily, rightFamily) ||
        compareText(left.sha256, right.sha256)
      );
    })
    .map((row) => {
      const entry = familyByDocument.get(row.sha256);
      if (!entry) throw new Error("合同族私有映射缺少文档");
      const selectionState = directlyExcluded.has(row.sha256)
        ? "直接排除"
        : entry.family.directlyExcluded
          ? "整族传播排除"
          : entry.representative
            ? "已选择"
            : "同族未选择";
      return [
        selectedSampleIds.get(row.sha256) || "",
        entry.family.id,
        privateFamilyRegistry.get(row.sha256)?.relationType || "",
        selectionState,
        entry.family.basis.join(","),
        inventoryLine(row),
      ].join("\t");
    });
  return `${header}\n${lines.join("\n")}\n`;
}

export async function buildContractOcrFamilyIsolation(
  options: ContractOcrFamilyIsolationOptions,
): Promise<ContractOcrFamilyIsolationResult> {
  if (!Number.isSafeInteger(options.targetSize) || options.targetSize <= 0) {
    throw new Error("合同族留出集目标数量必须是正整数");
  }
  if (!options.seed.trim()) throw new Error("合同族留出集固定种子不能为空");
  if (!options.datasetVersion.trim()) {
    throw new Error("合同族留出集数据版本不能为空");
  }
  const sampleIdPrefix = options.sampleIdPrefix?.trim() || "CTR-FAMILY-HOLDOUT";
  if (!/^[A-Z0-9][A-Z0-9-]{2,63}$/u.test(sampleIdPrefix)) {
    throw new Error("匿名样本编号前缀只能包含大写字母、数字和连字符");
  }
  if (options.exclusionManifestPaths.length < 2) {
    throw new Error("合同族隔离至少需要两个排除清单");
  }
  if (options.blindFreeze) {
    const { minimumCandidateDocuments, maximumCandidateDocuments } =
      options.blindFreeze;
    if (
      !Number.isSafeInteger(minimumCandidateDocuments) ||
      !Number.isSafeInteger(maximumCandidateDocuments) ||
      minimumCandidateDocuments <= 0 ||
      maximumCandidateDocuments < minimumCandidateDocuments
    ) {
      throw new Error("严格盲测候选池数量范围无效");
    }
    if (minimumCandidateDocuments < options.targetSize) {
      throw new Error("严格盲测候选池下限不能小于最终冻结数量");
    }
    if (!options.privateFamilyRegistryPath) {
      throw new Error("严格盲测冻结必须提供私有合同族注册表");
    }
    if ((options.consumedAuditPaths || []).length === 0) {
      throw new Error("严格盲测冻结必须提供至少一个历史已消费审计注册表");
    }
  }
  assertOutputPaths(options);

  const inventoryContent = fs.readFileSync(options.inventoryPath, "utf8");
  const inventoryRows = parseContractOcrInventory(
    inventoryContent,
    "合同族源库存",
  ).filter((row) => CONTRACT_CATEGORIES.has(row.category));
  const uniqueSourceRows = uniqueContractRows(inventoryRows, "合同族源库存");
  const sourceByDigest = new Map(
    uniqueSourceRows.map((row) => [row.sha256, row]),
  );
  const privateFamilyRegistryContent = options.privateFamilyRegistryPath
    ? fs.readFileSync(options.privateFamilyRegistryPath, "utf8")
    : "";
  const privateFamilyRegistry = options.privateFamilyRegistryPath
    ? parsePrivateFamilyRegistry(
        privateFamilyRegistryContent,
        "私有合同族注册表",
      )
    : new Map<string, PrivateFamilyRegistryEntry>();
  const registryOutsideSource = [...privateFamilyRegistry.keys()].filter(
    (sha256) => !sourceByDigest.has(sha256),
  );
  if (registryOutsideSource.length > 0) {
    throw new Error("私有合同族注册表包含不属于当前源库存的文档摘要");
  }
  const registryMissingSource = uniqueSourceRows.filter(
    (row) => !privateFamilyRegistry.has(row.sha256),
  );
  if (options.blindFreeze && registryMissingSource.length > 0) {
    throw new Error(
      `严格盲测私有合同族注册表未完整覆盖源库存，缺少 ${registryMissingSource.length} 份文档`,
    );
  }

  const exclusionManifestContents = options.exclusionManifestPaths.map(
    (manifestPath) => fs.readFileSync(manifestPath, "utf8"),
  );
  const exclusionRows = exclusionManifestContents.flatMap(
    (manifestContent, index) =>
      parseContractOcrInventory(
        manifestContent,
        `第 ${index + 1} 个合同族排除清单`,
      ),
  );
  const uniqueExclusionRows = uniqueContractRows(
    exclusionRows,
    "合同族排除清单",
  );
  const missingExclusions = uniqueExclusionRows.filter(
    (row) => !sourceByDigest.has(row.sha256),
  );
  if (missingExclusions.length > 0) {
    throw new Error("合同族排除清单包含不属于当前源库存的文档");
  }
  const consumedAuditPaths = options.consumedAuditPaths || [];
  const consumedAuditContents = consumedAuditPaths.map((auditPath) =>
    fs.readFileSync(auditPath, "utf8"),
  );
  const consumedAuditDigests = new Set(
    consumedAuditContents.flatMap((auditContent, index) => [
      ...parseConsumedAuditDigests(
        auditContent,
        `第 ${index + 1} 个历史 consumed（已消耗）审计注册表`,
      ),
    ]),
  );
  const missingConsumedAuditDigests = [...consumedAuditDigests].filter(
    (sha256) => !sourceByDigest.has(sha256),
  );
  if (missingConsumedAuditDigests.length > 0) {
    throw new Error(
      "历史 consumed（已消耗）审计注册表包含不属于当前源库存的文档摘要",
    );
  }
  const directlyExcluded = new Set([
    ...uniqueExclusionRows.map((row) => row.sha256),
    ...consumedAuditDigests,
  ]);

  // 必须先在完整源库存建立合同族，再传播排除状态。
  const families = buildFamilies(
    uniqueSourceRows,
    directlyExcluded,
    options.seed,
    privateFamilyRegistry,
  );
  const contaminatedFamilies = families.filter(
    (family) => family.directlyExcluded,
  );
  const eligibleFamilies = families.filter(
    (family) => !family.directlyExcluded,
  );
  const eligibleDocuments = eligibleFamilies.reduce(
    (total, family) => total + family.rows.length,
    0,
  );
  const additionallyExcludedByFamily = contaminatedFamilies.reduce(
    (total, family) =>
      total +
      family.rows.filter((row) => !directlyExcluded.has(row.sha256)).length,
    0,
  );

  const rankedEligibleFamilies = [...eligibleFamilies].sort((left, right) => {
    const leftIdentity = left.rows.map((row) => row.sha256).join("\u0000");
    const rightIdentity = right.rows.map((row) => row.sha256).join("\u0000");
    const rank = compareText(
      stableRank(options.seed, "family-selection", leftIdentity),
      stableRank(options.seed, "family-selection", rightIdentity),
    );
    return rank || compareText(left.id, right.id);
  });
  const selectedFamilies = rankedEligibleFamilies.slice(0, options.targetSize);
  const selectedRows = selectedFamilies.map((family) =>
    representativeForFamily(family, options.seed),
  );
  const candidateRows = rankedEligibleFamilies.flatMap((family) =>
    [...family.rows].sort((left, right) => {
      const rank = compareText(
        stableRank(options.seed, "candidate-document", left.sha256),
        stableRank(options.seed, "candidate-document", right.sha256),
      );
      return rank || compareText(left.sha256, right.sha256);
    }),
  );
  const selectedSampleIds = new Map(
    selectedRows.map((row, index) => [
      row.sha256,
      `${sampleIdPrefix}-${String(index + 1).padStart(3, "0")}`,
    ]),
  );

  const capacityShortfall = Math.max(
    0,
    options.targetSize - selectedRows.length,
  );
  const capacitySufficient = capacityShortfall === 0;
  if (options.blindFreeze) {
    if (
      candidateRows.length < options.blindFreeze.minimumCandidateDocuments ||
      candidateRows.length > options.blindFreeze.maximumCandidateDocuments
    ) {
      throw new Error(
        `严格盲测候选池必须为 ${options.blindFreeze.minimumCandidateDocuments}–${options.blindFreeze.maximumCandidateDocuments} 份，当前为 ${candidateRows.length} 份`,
      );
    }
    if (!capacitySufficient || selectedRows.length !== options.targetSize) {
      throw new Error(
        `严格盲测必须恰好冻结 ${options.targetSize} 份且每族最多一份，当前只有 ${selectedRows.length} 个可用合同族代表`,
      );
    }
  }
  const familySizes = families.map((family) => family.rows.length);
  const registeredFamilyCount = new Set(
    [...privateFamilyRegistry.values()].map((entry) => entry.externalFamilyId),
  ).size;
  const metadata: ContractOcrFamilyIsolationMetadata = {
    schemaVersion: 1,
    datasetVersion: options.datasetVersion,
    selectionPolicyVersion: CONTRACT_OCR_FAMILY_ISOLATION_POLICY_VERSION,
    seed: options.seed,
    requestedSize: options.targetSize,
    source: {
      inventoryRows: inventoryRows.length,
      uniqueDocuments: uniqueSourceRows.length,
      exactDuplicateRows: inventoryRows.length - uniqueSourceRows.length,
      exclusionManifestCount: options.exclusionManifestPaths.length,
      consumedAuditFileCount: consumedAuditPaths.length,
      consumedAuditUniqueDocuments: consumedAuditDigests.size,
      directlyExcludedDocuments: directlyExcluded.size,
      privateFamilyRegistryDocuments: privateFamilyRegistry.size,
      privateFamilyRegistryFamilies: registeredFamilyCount,
      privateFamilyRegistryComplete:
        privateFamilyRegistry.size > 0 && registryMissingSource.length === 0,
    },
    familyIsolation: {
      method:
        privateFamilyRegistry.size > 0
          ? "private_registry_plus_path_filename_exact_heuristic"
          : "path_filename_exact_heuristic",
      buildOrder: "build_families_before_exclusion",
      wholeFamilyExclusion: true,
      maximumSelectedPerFamily: 1,
      privateFamilyRegistryRequired: options.blindFreeze != null,
      privateFamilyRegistryUsed: privateFamilyRegistry.size > 0,
      visualNearDuplicateIsolation: false,
      textNearDuplicateIsolation: false,
      strictVisualNearDuplicateClaim: false,
      claim:
        privateFamilyRegistry.size > 0
          ? "使用私有合同族注册表显式归并同一项目协议，并以路径与文件名精确启发式补充；不声明视觉近重复、重新扫描、删页、格式转换或模板近重复已严格隔离"
          : "仅完成路径与文件名精确启发式合同族隔离，不声明视觉近重复、重新扫描、删页、格式转换或模板近重复已严格隔离",
      limitations: [
        "未读取合同正文或字段真值；私有合同族注册表仅提供族关系和协议类型",
        "未计算页面视觉感知指纹",
        "未计算正文文本相似度指纹",
        "同一合同被移动到不同目录且改名时可能无法归入同族",
      ],
    },
    capacity: {
      totalFamilies: families.length,
      multiDocumentFamilies: familySizes.filter((size) => size > 1).length,
      maximumFamilySize: Math.max(0, ...familySizes),
      contaminatedFamilies: contaminatedFamilies.length,
      additionallyExcludedByFamily,
      eligibleDocuments,
      eligibleFamilies: eligibleFamilies.length,
      selectedDocuments: selectedRows.length,
      sufficient: capacitySufficient,
      shortfall: capacityShortfall,
      notice: capacitySufficient
        ? `${privateFamilyRegistry.size > 0 ? "私有注册表及路径／文件名键" : "路径与文件名启发式"}隔离后可确定性选择 ${selectedRows.length} 个不同合同族；仍不代表视觉近重复严格隔离`
        : `${privateFamilyRegistry.size > 0 ? "私有注册表及路径／文件名键" : "路径与文件名启发式"}隔离后只有 ${eligibleFamilies.length} 个可用合同族，距离目标还缺 ${capacityShortfall} 个；禁止声称已建立 ${options.targetSize} 份严格盲测集`,
    },
    ...(options.blindFreeze
      ? {
          blindFreeze: {
            status: "frozen" as const,
            exactTargetRequired: true as const,
            minimumCandidateDocuments:
              options.blindFreeze.minimumCandidateDocuments,
            maximumCandidateDocuments:
              options.blindFreeze.maximumCandidateDocuments,
            candidateDocuments: candidateRows.length,
            candidateFamilies: eligibleFamilies.length,
            frozenDocuments: selectedRows.length,
          },
        }
      : {}),
    selectedDistribution: {
      byCategory: countBy(selectedRows, (row) => row.category),
      byRegion: countBy(selectedRows, (row) => row.region),
      byFormat: countBy(selectedRows, (row) => row.extension),
    },
    samples: selectedRows.map((row) => ({
      sampleId: selectedSampleIds.get(row.sha256)!,
      region: row.region,
      category: row.category,
      sourceStatus: row.sourceStatus,
      format: row.extension,
    })),
    privacy: {
      includesDocumentDigests: false,
      includesDocumentPaths: false,
      includesContractFieldValues: false,
      ...(options.blindFreeze
        ? {
            privateCandidateManifestMode: "0600" as const,
            privateLineageMode: "0600" as const,
          }
        : {}),
      privateManifestMode: "0600",
      privateMappingMode: "0600",
    },
  };

  const manifestContent = `${INVENTORY_HEADER}\n${selectedRows
    .map(inventoryLine)
    .join("\n")}\n`;
  const mappingContent = privateMappingContent(
    uniqueSourceRows,
    families,
    directlyExcluded,
    selectedSampleIds,
    privateFamilyRegistry,
  );
  const metadataContent = `${JSON.stringify(metadata, null, 2)}\n`;
  const candidateManifestContent = options.blindFreeze
    ? `${INVENTORY_HEADER}\n${candidateRows.map(inventoryLine).join("\n")}\n`
    : null;
  if (options.blindFreeze) {
    writeFileWithMode(
      options.blindFreeze.outputCandidateManifestPath,
      candidateManifestContent!,
      0o600,
      options.overwrite === true,
    );
    const lineageContent = `${JSON.stringify(
      {
        schemaVersion: 1,
        datasetVersion: options.datasetVersion,
        selectionPolicyVersion: CONTRACT_OCR_FAMILY_ISOLATION_POLICY_VERSION,
        inputs: {
          inventorySha256: digestText(inventoryContent),
          familyRegistrySha256: digestText(privateFamilyRegistryContent),
          exclusionManifestSha256: exclusionManifestContents.map(digestText),
          consumedAuditSha256: consumedAuditContents.map(digestText),
        },
        outputs: {
          candidateManifestSha256: digestText(candidateManifestContent!),
          finalManifestSha256: digestText(manifestContent),
          mappingSha256: digestText(mappingContent),
        },
      },
      null,
      2,
    )}\n`;
    writeFileWithMode(
      options.blindFreeze.outputLineagePath,
      lineageContent,
      0o600,
      options.overwrite === true,
    );
  }
  writeFileWithMode(
    options.outputManifestPath,
    manifestContent,
    0o600,
    options.overwrite === true,
  );
  writeFileWithMode(
    options.outputMappingPath,
    mappingContent,
    0o600,
    options.overwrite === true,
  );
  writeFileWithMode(
    options.outputMetadataPath,
    metadataContent,
    0o644,
    options.overwrite === true,
  );

  return {
    sourceRows: inventoryRows.length,
    sourceUniqueDocuments: uniqueSourceRows.length,
    consumedAuditUniqueDocuments: consumedAuditDigests.size,
    directlyExcludedDocuments: directlyExcluded.size,
    additionallyExcludedByFamily,
    eligibleDocuments,
    eligibleFamilies: eligibleFamilies.length,
    selectedDocuments: selectedRows.length,
    capacitySufficient,
    capacityShortfall,
    candidatePoolDocuments: candidateRows.length,
    metadata,
  };
}
