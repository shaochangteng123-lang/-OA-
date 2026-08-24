import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";

export const CONTRACT_OCR_HOLDOUT_POLICY_VERSION =
  "deterministic-stratified-sha256-v1";

const INVENTORY_HEADERS = [
  "行政区",
  "分类",
  "状态",
  "扩展名",
  "字节数",
  "SHA256",
  "相对路径",
] as const;

const CONTRACT_CATEGORIES = new Set([
  "主合同或其他合同",
  "补充协议",
  "解除或终止协议",
]);

export type ContractOcrPageBucket =
  | "1页"
  | "2-5页"
  | "6-10页"
  | "11-20页"
  | "21页以上"
  | "页数不可用";

export interface ContractOcrInventoryRow {
  region: string;
  category: string;
  sourceStatus: string;
  extension: string;
  size: number;
  sha256: string;
  relativePath: string;
}

interface PreparedCandidate extends ContractOcrInventoryRow {
  pageCount: number | null;
  pageBucket: ContractOcrPageBucket;
  stratumKey: string;
}

export interface ContractOcrHoldoutBuildOptions {
  inventoryPath: string;
  frozenManifestPath: string;
  inputRoot: string;
  outputManifestPath: string;
  outputMetadataPath: string;
  targetSize: number;
  seed: string;
  datasetVersion: string;
  expectedCandidateCount?: number;
}

export interface ContractOcrHoldoutBuildResult {
  candidateCount: number;
  selectedCount: number;
  frozenCount: number;
  sourceContractCount: number;
  sourceUniqueContractCount: number;
  exactDuplicateRowsExcluded: number;
  manifestSha256: string;
  selectedSha256: string[];
}

interface AnonymousSample {
  sampleId: string;
  sha256: string;
  region: string;
  category: string;
  sourceStatus: string;
  format: string;
  sizeBytes: number;
  pageCount: number | null;
  pageBucket: ContractOcrPageBucket;
}

function sha256Text(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const digest = createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("data", (chunk) => digest.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(digest.digest("hex")));
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableRank(seed: string, scope: string, value: string): string {
  return sha256Text(`${seed}\u0000${scope}\u0000${value}`);
}

export function pageBucketFor(pageCount: number | null): ContractOcrPageBucket {
  if (pageCount == null) return "页数不可用";
  if (pageCount === 1) return "1页";
  if (pageCount <= 5) return "2-5页";
  if (pageCount <= 10) return "6-10页";
  if (pageCount <= 20) return "11-20页";
  return "21页以上";
}

export function parseContractOcrInventory(
  content: string,
  sourceLabel: string,
): ContractOcrInventoryRow[] {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`${sourceLabel} 为空`);
  }

  const headers = lines[0].split("\t");
  if (
    headers.length !== INVENTORY_HEADERS.length ||
    headers.some((header, index) => header !== INVENTORY_HEADERS[index])
  ) {
    throw new Error(
      `${sourceLabel} 必须使用四区审计兼容的 7 列表头：${INVENTORY_HEADERS.join("、")}`,
    );
  }

  return lines.slice(1).map((line, index) => {
    const columns = line.split("\t");
    if (columns.length !== INVENTORY_HEADERS.length) {
      throw new Error(`${sourceLabel} 第 ${index + 2} 行不是 7 列`);
    }
    const [
      region,
      category,
      sourceStatus,
      extensionValue,
      sizeValue,
      sha256Value,
      relativePath,
    ] = columns;
    const extension = extensionValue.toLowerCase();
    const size = Number.parseInt(sizeValue, 10);
    const sha256 = sha256Value.toLowerCase();
    if (!region || !category || !sourceStatus || !extension || !relativePath) {
      throw new Error(`${sourceLabel} 第 ${index + 2} 行存在空字段`);
    }
    if (!/^\d+$/.test(sizeValue) || !Number.isSafeInteger(size) || size <= 0) {
      throw new Error(`${sourceLabel} 第 ${index + 2} 行字节数无效`);
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`${sourceLabel} 第 ${index + 2} 行 SHA-256 无效`);
    }
    if (
      path.isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).includes("..") ||
      relativePath.includes("\t") ||
      relativePath.includes("\u0000")
    ) {
      throw new Error(`${sourceLabel} 第 ${index + 2} 行相对路径无效`);
    }
    return {
      region,
      category,
      sourceStatus,
      extension,
      size,
      sha256,
      relativePath,
    };
  });
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

function deduplicateBySha256(
  rows: ContractOcrInventoryRow[],
): ContractOcrInventoryRow[] {
  const sorted = [...rows].sort((left, right) =>
    compareText(canonicalRowKey(left), canonicalRowKey(right)),
  );
  const unique = new Map<string, ContractOcrInventoryRow>();
  for (const row of sorted) {
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
      throw new Error("相同 SHA-256 的合同记录存在分层元数据冲突");
    }
  }
  return [...unique.values()];
}

function resolveSourcePath(inputRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error("源清单必须使用相对路径");
  }
  const resolvedRoot = path.resolve(inputRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const rootPrefix = `${resolvedRoot}${path.sep}`;
  if (!resolvedPath.startsWith(rootPrefix)) {
    throw new Error("源清单包含越界路径");
  }
  return resolvedPath;
}

async function readPdfPageCount(filePath: string): Promise<number> {
  const pdf = await PDFDocument.load(await fs.promises.readFile(filePath), {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const pageCount = pdf.getPageCount();
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0) {
    throw new Error("PDF 页数无效");
  }
  return pageCount;
}

async function prepareCandidate(
  row: ContractOcrInventoryRow,
  inputRoot: string,
): Promise<PreparedCandidate> {
  if (!new Set(["pdf", "doc", "docx"]).has(row.extension)) {
    throw new Error(`合同候选存在不支持的扩展名：${row.extension}`);
  }
  const sourcePath = resolveSourcePath(inputRoot, row.relativePath);
  const stat = await fs.promises.stat(sourcePath);
  if (!stat.isFile()) throw new Error("合同候选源路径不是普通文件");
  if (stat.size !== row.size) throw new Error("合同候选源文件大小与清单不一致");
  const actualSha256 = await sha256File(sourcePath);
  if (actualSha256 !== row.sha256) {
    throw new Error("合同候选源文件 SHA-256 与清单不一致");
  }
  const pageCount =
    row.extension === "pdf" ? await readPdfPageCount(sourcePath) : null;
  const pageBucket = pageBucketFor(pageCount);
  return {
    ...row,
    pageCount,
    pageBucket,
    stratumKey: JSON.stringify([
      row.category,
      row.region,
      row.extension,
      pageBucket,
    ]),
  };
}

function allocateStratumQuotas(
  groups: Map<string, PreparedCandidate[]>,
  targetSize: number,
  seed: string,
): Map<string, number> {
  const entries = [...groups.entries()].sort(([left], [right]) =>
    compareText(left, right),
  );
  const quotas = new Map(entries.map(([key]) => [key, 0]));
  if (targetSize >= entries.length) {
    for (const [key] of entries) quotas.set(key, 1);
  }

  let remaining =
    targetSize -
    [...quotas.values()].reduce((total, value) => total + value, 0);
  if (remaining === 0) return quotas;

  const capacities = entries.map(([key, rows]) => ({
    key,
    capacity: rows.length - (quotas.get(key) || 0),
  }));
  const totalCapacity = capacities.reduce(
    (total, item) => total + item.capacity,
    0,
  );
  if (remaining > totalCapacity) {
    throw new Error("分层容量不足，无法完成留出集抽样");
  }

  const proportionalTarget = remaining;
  const allocations = capacities.map((item) => {
    const ideal = (item.capacity * proportionalTarget) / totalCapacity;
    const floor = Math.floor(ideal);
    quotas.set(item.key, (quotas.get(item.key) || 0) + floor);
    return {
      ...item,
      remainder: ideal - floor,
    };
  });
  const allocatedTotal = [...quotas.values()].reduce(
    (total, value) => total + value,
    0,
  );
  remaining = targetSize - allocatedTotal;
  allocations.sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return right.remainder - left.remainder;
    }
    return compareText(
      stableRank(seed, "quota", left.key),
      stableRank(seed, "quota", right.key),
    );
  });
  for (const allocation of allocations) {
    if (remaining === 0) break;
    if (
      (quotas.get(allocation.key) || 0) >= groups.get(allocation.key)!.length
    ) {
      continue;
    }
    quotas.set(allocation.key, (quotas.get(allocation.key) || 0) + 1);
    remaining -= 1;
  }
  if (remaining !== 0) {
    throw new Error("分层最大余数分配未完成");
  }
  return quotas;
}

export function selectContractOcrHoldout(
  candidates: PreparedCandidate[],
  targetSize: number,
  seed: string,
): PreparedCandidate[] {
  if (!Number.isSafeInteger(targetSize) || targetSize <= 0) {
    throw new Error("留出集数量必须是正整数");
  }
  if (!seed.trim()) throw new Error("固定随机种子不能为空");
  if (targetSize > candidates.length) {
    throw new Error(
      `未进入冻结集的唯一候选只有 ${candidates.length} 份，不能生成 ${targetSize} 份严格留出集`,
    );
  }

  const groups = new Map<string, PreparedCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.stratumKey) || [];
    group.push(candidate);
    groups.set(candidate.stratumKey, group);
  }
  const quotas = allocateStratumQuotas(groups, targetSize, seed);
  const selected: PreparedCandidate[] = [];
  for (const [key, rows] of groups) {
    const sorted = [...rows].sort((left, right) => {
      const rankComparison = compareText(
        stableRank(seed, "sample", left.sha256),
        stableRank(seed, "sample", right.sha256),
      );
      return rankComparison || compareText(left.sha256, right.sha256);
    });
    selected.push(...sorted.slice(0, quotas.get(key) || 0));
  }
  return selected.sort((left, right) => {
    const rankComparison = compareText(
      stableRank(seed, "output", left.sha256),
      stableRank(seed, "output", right.sha256),
    );
    return rankComparison || compareText(left.sha256, right.sha256);
  });
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

function canonicalInventoryDigest(rows: ContractOcrInventoryRow[]): string {
  const content = `${INVENTORY_HEADERS.join("\t")}\n${[...rows]
    .sort((left, right) => {
      const hashComparison = compareText(left.sha256, right.sha256);
      return (
        hashComparison ||
        compareText(canonicalRowKey(left), canonicalRowKey(right))
      );
    })
    .map(inventoryLine)
    .join("\n")}\n`;
  return sha256Text(content);
}

function countBy<T>(
  rows: T[],
  value: (row: T) => string,
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

function summarize(rows: PreparedCandidate[]) {
  return {
    total: rows.length,
    byCategory: countBy(rows, (row) => row.category),
    byRegion: countBy(rows, (row) => row.region),
    byFormat: countBy(rows, (row) => row.extension),
    byPageBucket: countBy(rows, (row) => row.pageBucket),
  };
}

function writeDeterministicFile(
  filePath: string,
  content: string,
  mode: number,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { encoding: "utf8", mode });
  fs.chmodSync(filePath, mode);
}

export async function buildContractOcrHoldout(
  options: ContractOcrHoldoutBuildOptions,
): Promise<ContractOcrHoldoutBuildResult> {
  const inventoryContent = fs.readFileSync(options.inventoryPath, "utf8");
  const frozenContent = fs.readFileSync(options.frozenManifestPath, "utf8");
  const inventory = parseContractOcrInventory(inventoryContent, "源盘点清单");
  const frozenRows = parseContractOcrInventory(frozenContent, "冻结清单");
  if (frozenRows.some((row) => !CONTRACT_CATEGORIES.has(row.category))) {
    throw new Error("冻结清单包含非合同记录");
  }
  const sourceContracts = inventory.filter((row) =>
    CONTRACT_CATEGORIES.has(row.category),
  );
  const uniqueSourceContracts = deduplicateBySha256(sourceContracts);
  const uniqueFrozenContracts = deduplicateBySha256(frozenRows);
  const sourceSha256 = new Set(uniqueSourceContracts.map((row) => row.sha256));
  const missingFrozenRows = uniqueFrozenContracts.filter(
    (row) => !sourceSha256.has(row.sha256),
  );
  if (missingFrozenRows.length > 0) {
    throw new Error("冻结清单存在不属于当前源合同集合的文件摘要");
  }
  const frozenSha256 = new Set(uniqueFrozenContracts.map((row) => row.sha256));
  const candidateRows = uniqueSourceContracts.filter(
    (row) => !frozenSha256.has(row.sha256),
  );

  if (
    options.expectedCandidateCount != null &&
    candidateRows.length !== options.expectedCandidateCount
  ) {
    throw new Error(
      `候选数量已变化：期望 ${options.expectedCandidateCount} 份，实际 ${candidateRows.length} 份；请重新冻结数据版本`,
    );
  }
  if (candidateRows.length < 100 && options.targetSize >= 100) {
    throw new Error(
      `当前只有 ${candidateRows.length} 份未进入冻结集的唯一候选，不能声称已建立 100 份严格盲测集`,
    );
  }

  const prepared: PreparedCandidate[] = [];
  for (const row of candidateRows) {
    prepared.push(await prepareCandidate(row, options.inputRoot));
  }
  const selected = selectContractOcrHoldout(
    prepared,
    options.targetSize,
    options.seed,
  );

  const manifestContent = `${INVENTORY_HEADERS.join("\t")}\n${selected
    .map(inventoryLine)
    .join("\n")}\n`;
  const manifestSha256 = sha256Text(manifestContent);
  const anonymousSamples: AnonymousSample[] = selected.map((row, index) => ({
    sampleId: `CTR-HOLDOUT-${String(index + 1).padStart(3, "0")}`,
    sha256: row.sha256,
    region: row.region,
    category: row.category,
    sourceStatus: row.sourceStatus,
    format: row.extension,
    sizeBytes: row.size,
    pageCount: row.pageCount,
    pageBucket: row.pageBucket,
  }));
  const metadata = {
    schemaVersion: 1,
    datasetVersion: options.datasetVersion,
    selectionPolicyVersion: CONTRACT_OCR_HOLDOUT_POLICY_VERSION,
    seed: options.seed,
    requestedSize: options.targetSize,
    eligibleOutsideFrozenCount: prepared.length,
    strictBlindHundredAvailable: false,
    exactShaHoldoutHundredAvailable: prepared.length >= 100,
    selectionClaim:
      "仅声明样本文件摘要未进入冻结50份调优集，不声明合同族或近重复严格隔离，也不声明样本此前从未执行识别或被人工查看",
    capacityNotice:
      prepared.length >= 100
        ? "当前精确摘要候选容量达到100份，但仍不能声称完成合同族严格盲测"
        : `当前只有${prepared.length}份精确摘要候选，不能建立100份留出集，也不能声称完成合同族严格盲测`,
    selectionInputs: [
      "源盘点结构元数据",
      "冻结清单SHA-256",
      "源文件字节数与SHA-256",
      "PDF页数",
      "固定随机种子",
    ],
    selectionExcludedInputs: [
      "历史字段结果",
      "历史错误分类",
      "历史置信度",
      "人工真值",
    ],
    stratification: {
      dimensions: ["合同类型", "行政区", "格式", "页数区间"],
      allocation:
        "联合分层；容量允许时每层先保留一份，再按剩余容量使用最大余数法分配",
    },
    auditCompatibility: {
      manifestColumns: [...INVENTORY_HEADERS],
      requiredRegions: Object.keys(
        countBy(selected, (candidate) => candidate.region),
      ),
      regionCoverageNotice: `运行审计时必须显式使用本清单实际覆盖的行政区：${Object.keys(
        countBy(selected, (candidate) => candidate.region),
      ).join("、")}；不得用其他文档类型伪造区域覆盖`,
    },
    integrity: {
      sourceInventorySha256: canonicalInventoryDigest(inventory),
      frozenManifestSha256: canonicalInventoryDigest(frozenRows),
      auditManifestSha256: manifestSha256,
      sourceContractRows: sourceContracts.length,
      sourceUniqueContractSha256: uniqueSourceContracts.length,
      exactDuplicateRowsExcluded:
        sourceContracts.length - uniqueSourceContracts.length,
      frozenUniqueSha256: frozenSha256.size,
    },
    summary: {
      candidates: summarize(prepared),
      selected: summarize(selected),
    },
    samples: anonymousSamples,
  };
  const metadataContent = `${JSON.stringify(metadata, null, 2)}\n`;

  // 含真实相对路径的审计清单仅供本地运行，匿名元数据可用于安全汇总。
  writeDeterministicFile(options.outputManifestPath, manifestContent, 0o600);
  writeDeterministicFile(options.outputMetadataPath, metadataContent, 0o644);

  return {
    candidateCount: prepared.length,
    selectedCount: selected.length,
    frozenCount: frozenSha256.size,
    sourceContractCount: sourceContracts.length,
    sourceUniqueContractCount: uniqueSourceContracts.length,
    exactDuplicateRowsExcluded:
      sourceContracts.length - uniqueSourceContracts.length,
    manifestSha256,
    selectedSha256: selected.map((row) => row.sha256),
  };
}
