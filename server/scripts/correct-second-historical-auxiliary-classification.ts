import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";

import { toCents } from "../services/contractAccounting.js";

/**
 * 第二批历史合同导入后的定向归类更正。
 *
 * 该脚本只处理三份已经冻结摘要的文件：
 * 1. 龙潭湖合同原“合同附件”中的两份文件改为一个辅助材料包；
 * 2. 2024-10-31 护套线、屏蔽线采购合同改为 2024-11-06 合同的辅助材料。
 *
 * 默认只做事务预演。旧物理文件永不删除，目标文件先复制并复核 SHA-256
 * 摘要，数据库提交成功后也保留旧文件作为可追溯底稿。
 */

export const SECOND_AUXILIARY_CORRECTION_KEY =
  "second-historical-auxiliary-classification-correction-v1";
export const SECOND_AUXILIARY_CORRECTION_BATCH_KEY =
  "historical-import-2026-09-10-second-batch-v1";
export const SECOND_AUXILIARY_CORRECTION_MANIFEST_SHA256 =
  "f7cf305f2ff3b17ddbc0837a5069f040d98ee79c3dea68ceb6e0691f5f844fc3";
export const SECOND_AUXILIARY_CORRECTION_OLD_SEMANTIC_SHA256 =
  "c570919035963548c2e5a88af67081aa09270c3733600ea5672fc0c701ee6a02";
export const SECOND_AUXILIARY_CORRECTION_NEW_SEMANTIC_SHA256 =
  "2b5f2fd6d73bb668caef2d117767eb1ddc67f13f60a61a51c7d5de4be9c09936";
export const SECOND_AUXILIARY_CORRECTION_DEVELOPMENT_CONFIRMATION =
  "CORRECT_SECOND_HISTORICAL_AUXILIARY_IN_DEVELOPMENT";
export const SECOND_AUXILIARY_CORRECTION_PRODUCTION_CONFIRMATION =
  "CORRECT_SECOND_HISTORICAL_AUXILIARY_IN_PRODUCTION";

const APPLICATION_ROOT = path.resolve("/app");
const UPLOAD_BOUNDARY = path.resolve(APPLICATION_ROOT, "uploads");
const CORRECTION_UPLOAD_ROOT =
  "uploads/contract-auxiliary/historical/2026/09/13/second-historical-auxiliary-correction-v1";

const DRAGON_CONTRACT_ID = "sdylIKVZJDN8jYQ342rOL";
const WIRE_OBSOLETE_CONTRACT_ID = "h2_GW6LvU2BsZInN6QYJQUz";
const WIRE_TARGET_CONTRACT_ID = "h2_qHOQnKiOJUvgVW6uKoHf";
const WIRE_SUPPLEMENT_ID = "h2_xfLTuWhrasuoy_o-XvDV";
const ACTOR_NAME = "吴静雯";

interface FrozenSourceFile {
  bucket: "dragon" | "wire";
  oldFileId: string;
  oldContractId: string;
  fileKind: "contract" | "invoice" | "other";
  fileName: string;
  oldStoredPath: string;
  size: number;
  sha256: string;
  sourcePath: string;
  familyKey: "second-018" | "second-022";
  oldTargetKind: "existing_contract_archive" | "sealed_contract";
  newContractId: string;
}

export const SECOND_AUXILIARY_CORRECTION_FILES: readonly FrozenSourceFile[] = [
  {
    bucket: "dragon",
    oldFileId: "fQHpEgtNaTwlvdDK70tmc",
    oldContractId: DRAGON_CONTRACT_ID,
    fileKind: "invoice",
    fileName: "2-发票03024844（作废）.pdf",
    oldStoredPath:
      "uploads/contracts/historical/2026/08/26/historical-import-2026-08-26-confirmed-v1/019/root/2-发票03024844_作废_-c91afa2d6234.pdf",
    size: 195_459,
    sha256: "c91afa2d6234b82fc765677fd8096404bd4461d1cae60790e24c52265c940ce6",
    sourcePath:
      "主营项目合同/朝阳区/龙潭湖-弘善110kv线路工程建设项目/附件/2-发票03024844（作废）.pdf",
    familyKey: "second-022",
    oldTargetKind: "existing_contract_archive",
    newContractId: DRAGON_CONTRACT_ID,
  },
  {
    bucket: "dragon",
    oldFileId: "1wUDji9suakQ-rbnIf_hi",
    oldContractId: DRAGON_CONTRACT_ID,
    fileKind: "other",
    fileName: "开票信息2021（最新-含开票要求-无备注）.docx",
    oldStoredPath:
      "uploads/contracts/historical/2026/08/26/historical-import-2026-08-26-confirmed-v1/019/root/开票信息2021_最新-含开票要求-无备注_-7c7b7614da23.docx",
    size: 15_587,
    sha256: "7c7b7614da23f8ff5c9cef0b9ac25d691167793f06d4658e33cb454d60155f28",
    sourcePath:
      "主营项目合同/朝阳区/龙潭湖-弘善110kv线路工程建设项目/附件/开票信息2021（最新-含开票要求-无备注）.docx",
    familyKey: "second-022",
    oldTargetKind: "existing_contract_archive",
    newContractId: DRAGON_CONTRACT_ID,
  },
  {
    bucket: "wire",
    oldFileId: "h2_UYhoLA3ZIWMOwzLSUuxy",
    oldContractId: WIRE_OBSOLETE_CONTRACT_ID,
    fileKind: "contract",
    fileName: "1-产品购销合同-20241031￥157527.78.pdf",
    oldStoredPath:
      "uploads/contracts/historical/2026/09/10/historical-import-2026-09-10-second-batch-v1/kL5Y6A8BaH/root/1-产品购销合同-20241031¥157527.78-b4023cce6f10.pdf",
    size: 529_591,
    sha256: "b4023cce6f10201c76a102b8d62cb8f0115d354589d13df87585d547dd4b266a",
    sourcePath:
      "非主营项目合同/非主营支出/工程→北京中冀天泽科技有限公司/1-产品购销合同-20241031￥157527.78.pdf",
    familyKey: "second-018",
    oldTargetKind: "sealed_contract",
    newContractId: WIRE_TARGET_CONTRACT_ID,
  },
] as const;

export interface SecondAuxiliaryCorrectionArguments {
  mode: "dry-run" | "commit";
  target: "development" | "production";
  confirmationToken: string | null;
  targetDatabaseSha256: string | null;
}

interface ActorRow {
  id: string;
  role: string;
  name: string;
}

interface ContractRow {
  id: string;
  contract_no: string;
  title: string;
  project_name: string;
  category: string;
  declared_subtype: string;
  relation_type: string;
  status: string;
  area: string;
  parent_contract_id: string | null;
  root_contract_id: string;
  party_a: string;
  party_b: string;
  contract_date: string;
  business_contract_no: string | null;
  amount_delta: string | number;
  current_effective_amount: string | number;
  supplement_change_type: string | null;
  supplement_sequence: string | number | null;
  requires_auxiliary_materials: boolean;
  snapshot: Record<string, unknown>;
}

interface ContractFileRow {
  id: string;
  contract_id: string;
  file_type: string;
  file_name: string;
  file_path: string;
  file_size: string | number;
  mime_type: string;
  file_hash: string;
  version: string | number;
  is_current: boolean;
  snapshot: Record<string, unknown>;
}

interface MappingRow {
  source_path: string;
  source_hash: string;
  source_bytes: string | number;
  family_key: string;
  contract_id: string;
  target_kind: string;
  accounting_included: boolean;
  contract_file_id: string | null;
  auxiliary_file_id: string | null;
  snapshot: Record<string, unknown>;
}

interface PackageRow {
  id: string;
  parent_contract_id: string;
  note: string | null;
  status: string;
  accounting_included: boolean;
  created_by: string;
  updated_by: string;
  version: string | number;
}

interface AuxiliaryFileRow {
  id: string;
  package_id: string;
  file_kind: string;
  file_name: string;
  file_path: string;
  file_size: string | number;
  mime_type: string;
  file_hash: string;
  version: string | number;
  is_current: boolean;
  uploaded_by: string;
}

interface AuditRow {
  id: string;
  contract_id: string;
  action: string;
  actor_id: string;
  changes_json: Record<string, unknown>;
  snapshot: Record<string, unknown>;
}

interface FinancialHashRow {
  file_hash: string;
  file_id: string;
  contract_id: string;
  snapshot: Record<string, unknown>;
}

interface BatchRow {
  batch_key: string;
  manifest_hash: string;
  source_file_count: string | number;
  source_total_bytes: string | number;
  status: string;
  imported_contract_count: string | number;
  restored_contract_count: string | number;
  summary_json: Record<string, unknown>;
}

interface RawCorrectionState {
  contracts: ContractRow[];
  oldFiles: ContractFileRow[];
  mappings: MappingRow[];
  packages: PackageRow[];
  auxiliaryFiles: AuxiliaryFileRow[];
  financialHashes: FinancialHashRow[];
  correctionAudits: AuditRow[];
  obsoleteAudits: AuditRow[];
  batch: BatchRow;
}

interface CopiedFile {
  source: FrozenSourceFile;
  absolutePath: string;
  storedPath: string;
  created: boolean;
}

interface CorrectionQueryClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/u;

function canonicalize(value: unknown): unknown {
  if (value == null || ["boolean", "number", "string"].includes(typeof value)) {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new Error("更正摘要包含不支持的数据类型");
}

function digest(value: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function secondAuxiliaryCorrectionStableId(
  scope: string,
  key: string,
): string {
  const value = crypto
    .createHash("sha256")
    .update(`${SECOND_AUXILIARY_CORRECTION_KEY}\0${scope}\0${key}`)
    .digest("base64url")
    .slice(0, 20);
  return `h2c_${value}`;
}

function packageId(bucket: FrozenSourceFile["bucket"]): string {
  return secondAuxiliaryCorrectionStableId("package", bucket);
}

function packageNote(bucket: FrozenSourceFile["bucket"]): string {
  return bucket === "dragon"
    ? "第二批历史导入归类更正：原合同附件中的2份文件改归辅助材料"
    : "第二批历史导入归类更正：2024-10-31合同作为2024-11-06合同的辅助材料";
}

function auxiliaryFileId(source: FrozenSourceFile): string {
  return secondAuxiliaryCorrectionStableId("file", source.sha256);
}

function auditId(contractId: string): string {
  return secondAuxiliaryCorrectionStableId("audit", contractId);
}

function targetMimeType(source: FrozenSourceFile): string {
  const extension = path.extname(source.fileName).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  throw new Error(`冻结文件媒体类型未知：${source.fileName}`);
}

function safeTargetFileName(source: FrozenSourceFile): string {
  const extension = path.extname(source.fileName).toLowerCase();
  const stem = path
    .basename(source.fileName, extension)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  return `${stem}-${source.sha256.slice(0, 12)}${extension}`;
}

export function secondAuxiliaryCorrectionStoredPath(
  source: FrozenSourceFile,
): string {
  return `${CORRECTION_UPLOAD_ROOT}/${source.bucket}/${safeTargetFileName(source)}`;
}

export function parseSecondAuxiliaryCorrectionArguments(
  argv: readonly string[],
): SecondAuxiliaryCorrectionArguments {
  let mode: "dry-run" | "commit" = "dry-run";
  let modeSpecified = false;
  const options = new Map<string, string>();
  const valueOptions = new Set([
    "--target",
    "--confirm-target",
    "--target-database-sha256",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "--dry-run" || value === "--commit") {
      if (modeSpecified) throw new Error("只能指定一个执行模式");
      modeSpecified = true;
      mode = value === "--commit" ? "commit" : "dry-run";
      continue;
    }
    const separator = value.indexOf("=");
    const name = separator >= 0 ? value.slice(0, separator) : value;
    if (!valueOptions.has(name))
      throw new Error(`不支持的命令行参数：${value}`);
    if (options.has(name)) throw new Error(`命令行参数重复：${name}`);
    const inline = separator >= 0 ? value.slice(separator + 1) : null;
    const optionValue = inline ?? argv[index + 1] ?? "";
    if (!optionValue || (inline == null && optionValue.startsWith("--"))) {
      throw new Error(`命令行参数缺少值：${name}`);
    }
    options.set(name, optionValue);
    if (inline == null) index += 1;
  }
  const target = options.get("--target") || "development";
  if (target !== "development" && target !== "production") {
    throw new Error("--target 只允许 development 或 production");
  }
  const confirmationToken = options.get("--confirm-target") || null;
  const targetDatabaseSha256 =
    options.get("--target-database-sha256")?.toLowerCase() || null;
  if (mode === "dry-run" && confirmationToken) {
    throw new Error("事务预演不得携带提交确认令牌");
  }
  if (target === "development" && targetDatabaseSha256) {
    throw new Error("开发目标不得携带生产数据库身份摘要");
  }
  if (
    target === "production" &&
    (!targetDatabaseSha256 || !HASH_PATTERN.test(targetDatabaseSha256))
  ) {
    throw new Error("生产目标必须显式指定64位 --target-database-sha256");
  }
  return { mode, target, confirmationToken, targetDatabaseSha256 };
}

export function assertSecondAuxiliaryCorrectionAuthorization(
  args: SecondAuxiliaryCorrectionArguments,
  environment: NodeJS.ProcessEnv = process.env,
  currentWorkingDirectory = process.cwd(),
): void {
  if (path.resolve(currentWorkingDirectory) !== APPLICATION_ROOT) {
    throw new Error("归类更正只能在容器 /app 工作目录执行");
  }
  if (!environment.DATABASE_URL) {
    throw new Error("目标容器缺少 DATABASE_URL，拒绝执行");
  }
  if (args.target === "development") {
    if (
      environment.NODE_ENV !== "development" ||
      environment.VITE_ENABLE_WORKLOG !== "true"
    ) {
      throw new Error("开发目标缺少开发容器双重环境标记");
    }
  } else if (
    environment.NODE_ENV !== "production" ||
    environment.VITE_ENABLE_WORKLOG === "true"
  ) {
    throw new Error("生产目标环境标记不正确");
  }
  if (args.target === "development" && args.targetDatabaseSha256) {
    throw new Error("开发目标不得携带生产数据库身份摘要");
  }
  if (
    args.target === "production" &&
    (!args.targetDatabaseSha256 ||
      !HASH_PATTERN.test(args.targetDatabaseSha256))
  ) {
    throw new Error("生产目标必须显式指定64位 --target-database-sha256");
  }
  if (args.mode === "commit") {
    const expected =
      args.target === "production"
        ? SECOND_AUXILIARY_CORRECTION_PRODUCTION_CONFIRMATION
        : SECOND_AUXILIARY_CORRECTION_DEVELOPMENT_CONFIRMATION;
    if (args.confirmationToken !== expected) {
      throw new Error(`提交必须显式指定 --confirm-target=${expected}`);
    }
  }
}

function importedRootIds(summary: Record<string, unknown>): string[] {
  if (!Array.isArray(summary.importedRootIds)) {
    throw new Error("第二批摘要缺少 importedRootIds");
  }
  return summary.importedRootIds.map((value) => String(value));
}

function financialLinkResults(
  summary: Record<string, unknown>,
): Array<Record<string, unknown>> | null {
  if (!("financialLinkResults" in summary)) return null;
  if (!Array.isArray(summary.financialLinkResults)) {
    throw new Error("第二批摘要的 financialLinkResults 不是数组");
  }
  return summary.financialLinkResults.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("第二批摘要包含无效财务关系结果");
    }
    return value as Record<string, unknown>;
  });
}

function assertProductionFinancialLinkResults(
  summary: Record<string, unknown>,
  state: "old" | "post",
): void {
  const results = financialLinkResults(summary);
  const expectedCount = state === "old" ? 42 : 41;
  const obsoleteCount =
    results?.filter(
      (result) => String(result.rootId || "") === WIRE_OBSOLETE_CONTRACT_ID,
    ).length || 0;
  if (
    !results ||
    results.length !== expectedCount ||
    obsoleteCount !== (state === "old" ? 1 : 0)
  ) {
    throw new Error(
      `生产第二批摘要的财务关系结果不是${state === "old" ? "冻结旧态42条" : "更正后41条"}`,
    );
  }
}

export function classifySecondAuxiliaryCorrectionBatch(
  importedContractCount: number,
  summary: Record<string, unknown>,
): "old" | "post" {
  const roots = importedRootIds(summary);
  const correction = summary.auxiliaryClassificationCorrectionV1;
  const oldSemantic = summary.semanticSha256;
  const common =
    Number(summary.sourceFileCount) === 384 &&
    String(summary.manifestHash) ===
      SECOND_AUXILIARY_CORRECTION_MANIFEST_SHA256;
  if (
    common &&
    importedContractCount === 41 &&
    Number(summary.rootContractCount) === 42 &&
    Number(summary.costContractCount) === 22 &&
    Number(summary.auxiliaryFileCount) === 114 &&
    roots.filter((id) => id === WIRE_OBSOLETE_CONTRACT_ID).length === 1 &&
    correction == null &&
    (oldSemantic == null ||
      oldSemantic === SECOND_AUXILIARY_CORRECTION_OLD_SEMANTIC_SHA256)
  ) {
    return "old";
  }
  if (
    common &&
    importedContractCount === 40 &&
    Number(summary.rootContractCount) === 41 &&
    Number(summary.costContractCount) === 21 &&
    Number(summary.auxiliaryFileCount) === 115 &&
    !roots.includes(WIRE_OBSOLETE_CONTRACT_ID) &&
    oldSemantic === SECOND_AUXILIARY_CORRECTION_NEW_SEMANTIC_SHA256 &&
    typeof correction === "object" &&
    correction !== null &&
    (correction as Record<string, unknown>).correctionKey ===
      SECOND_AUXILIARY_CORRECTION_KEY
  ) {
    return "post";
  }
  throw new Error("第二批导入摘要既不是冻结旧态，也不是完整更正态");
}

export function buildSecondAuxiliaryCorrectedBatchSummary(
  summary: Record<string, unknown>,
  input: {
    now: string;
    actorId: string;
    actorName: string;
    target: "development" | "production";
  },
): Record<string, unknown> {
  if (classifySecondAuxiliaryCorrectionBatch(41, summary) !== "old") {
    throw new Error("只允许从冻结旧摘要生成更正摘要");
  }
  const oldFinancialLinkResults = financialLinkResults(summary);
  return {
    ...summary,
    ...(oldFinancialLinkResults
      ? {
          financialLinkResults: oldFinancialLinkResults.filter(
            (result) =>
              String(result.rootId || "") !== WIRE_OBSOLETE_CONTRACT_ID,
          ),
        }
      : {}),
    semanticSha256: SECOND_AUXILIARY_CORRECTION_NEW_SEMANTIC_SHA256,
    importedRootIds: importedRootIds(summary).filter(
      (id) => id !== WIRE_OBSOLETE_CONTRACT_ID,
    ),
    rootContractCount: 41,
    costContractCount: 21,
    auxiliaryFileCount: 115,
    auxiliaryClassificationCorrectionV1: {
      correctionKey: SECOND_AUXILIARY_CORRECTION_KEY,
      correctedAt: input.now,
      correctedBy: input.actorId,
      correctedByName: input.actorName,
      target: input.target,
      dragonAuxiliaryFileCount: 2,
      wireAuxiliaryFileCount: 1,
      removedRootContractId: WIRE_OBSOLETE_CONTRACT_ID,
      wireTargetContractId: WIRE_TARGET_CONTRACT_ID,
      physicalSourceFilesPreserved: true,
    },
  };
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function absoluteStoredPath(storedPath: string): string {
  const normalized = String(storedPath || "").trim();
  if (
    !normalized.startsWith("uploads/") ||
    normalized.includes("\\") ||
    path.isAbsolute(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "..")
  ) {
    throw new Error(`附件保存路径不安全：${storedPath}`);
  }
  const absolutePath = path.resolve(APPLICATION_ROOT, normalized);
  if (!isPathInside(UPLOAD_BOUNDARY, absolutePath)) {
    throw new Error(`附件路径越过 /app/uploads：${storedPath}`);
  }
  return absolutePath;
}

async function assertNoSymlinkComponents(
  root: string,
  candidate: string,
): Promise<void> {
  if (!isPathInside(root, candidate))
    throw new Error(`附件路径越界：${candidate}`);
  let current = path.resolve(root);
  const rootStat = await fs.promises.lstat(current).catch(() => null);
  if (rootStat?.isSymbolicLink())
    throw new Error(`附件根目录为符号链接：${root}`);
  for (const segment of path.relative(current, candidate).split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fs.promises.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink())
      throw new Error(`附件路径含符号链接：${current}`);
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function verifyPhysicalFile(
  absolutePath: string,
  source: FrozenSourceFile,
  label: string,
): Promise<void> {
  await assertNoSymlinkComponents(UPLOAD_BOUNDARY, absolutePath);
  const stat = await fs.promises.lstat(absolutePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}不是普通文件：${absolutePath}`);
  }
  if (
    stat.size !== source.size ||
    (await sha256File(absolutePath)) !== source.sha256
  ) {
    throw new Error(`${label}大小或 SHA-256 摘要不一致：${source.fileName}`);
  }
}

async function copyToCanonicalAuxiliaryPath(
  source: FrozenSourceFile,
): Promise<CopiedFile> {
  const sourceAbsolutePath = absoluteStoredPath(source.oldStoredPath);
  const storedPath = secondAuxiliaryCorrectionStoredPath(source);
  const targetAbsolutePath = absoluteStoredPath(storedPath);
  await verifyPhysicalFile(sourceAbsolutePath, source, "原合同附件");
  await fs.promises.mkdir(path.dirname(targetAbsolutePath), {
    recursive: true,
  });
  await assertNoSymlinkComponents(
    UPLOAD_BOUNDARY,
    path.dirname(targetAbsolutePath),
  );
  let created = false;
  try {
    await fs.promises.copyFile(
      sourceAbsolutePath,
      targetAbsolutePath,
      fs.constants.COPYFILE_EXCL,
    );
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await verifyPhysicalFile(targetAbsolutePath, source, "辅助材料副本");
  return { source, absolutePath: targetAbsolutePath, storedPath, created };
}

async function cleanupNewCopies(
  copiedFiles: readonly CopiedFile[],
): Promise<void> {
  const failures: string[] = [];
  for (const copied of [...copiedFiles].reverse()) {
    if (!copied.created) continue;
    await fs.promises.rm(copied.absolutePath, { force: true }).catch(() => {
      failures.push(copied.absolutePath);
    });
  }
  if (failures.length) {
    throw new Error(
      `回滚后有${failures.length}份新副本清理失败：${failures.join("、")}`,
    );
  }
}

function expectedContractNumbers(
  target: SecondAuxiliaryCorrectionArguments["target"],
): Record<string, string> {
  return target === "production"
    ? {
        [WIRE_OBSOLETE_CONTRACT_ID]: "HT-20260911-000138",
        [WIRE_TARGET_CONTRACT_ID]: "HT-20260911-000139",
      }
    : {
        [WIRE_OBSOLETE_CONTRACT_ID]: "HT-20260910-000131",
        [WIRE_TARGET_CONTRACT_ID]: "HT-20260910-000132",
      };
}

/** 将数据库返回的数值按整数分比较，避免依赖 NUMERIC 的字符串格式。 */
export function secondAuxiliaryCorrectionAmountMatches(
  value: string | number,
  expectedCents: number,
): boolean {
  return toCents(value) === expectedCents;
}

function assertContractIdentity(
  contract: ContractRow | undefined,
  target: SecondAuxiliaryCorrectionArguments["target"],
  kind: "dragon" | "obsolete-wire" | "target-wire",
): void {
  if (!contract) throw new Error(`冻结合同不存在：${kind}`);
  const numberById = expectedContractNumbers(target);
  const commonWire =
    contract.project_name === "护套线、屏蔽线采购" &&
    contract.title === "护套线、屏蔽线采购" &&
    contract.category === "non_main" &&
    contract.declared_subtype === "non_main_expense" &&
    contract.relation_type === "main" &&
    contract.area === "全部" &&
    contract.root_contract_id === contract.id &&
    contract.party_a === "北京羽隶工程咨询有限公司" &&
    contract.party_b === "北京中冀天泽科技有限公司";
  if (kind === "dragon") {
    if (
      contract.id !== DRAGON_CONTRACT_ID ||
      contract.contract_no !== "HT-20260826-000032" ||
      contract.project_name !== "龙潭湖-弘善110kv线路工程建设项目" ||
      contract.contract_date !== "2023-08-25" ||
      !secondAuxiliaryCorrectionAmountMatches(
        contract.current_effective_amount,
        1_584_000,
      ) ||
      contract.status !== "completed"
    ) {
      throw new Error("龙潭湖合同身份或金额状态与冻结基线不一致");
    }
    return;
  }
  if (!commonWire || contract.contract_no !== numberById[contract.id]) {
    throw new Error(`护套线合同身份与${target}冻结基线不一致：${contract.id}`);
  }
  if (
    kind === "obsolete-wire" &&
    (contract.id !== WIRE_OBSOLETE_CONTRACT_ID ||
      contract.contract_date !== "2024-10-31" ||
      contract.business_contract_no !== "SHIP-ZJTZ-20241030005" ||
      !secondAuxiliaryCorrectionAmountMatches(
        contract.current_effective_amount,
        15_752_778,
      ) ||
      contract.status !== "effective")
  ) {
    throw new Error("2024-10-31 护套线错误根合同与冻结基线不一致");
  }
  if (
    kind === "target-wire" &&
    (contract.id !== WIRE_TARGET_CONTRACT_ID ||
      contract.contract_date !== "2024-11-06" ||
      contract.business_contract_no !== "SHIP-ZJTZ-202410110003" ||
      !secondAuxiliaryCorrectionAmountMatches(
        contract.current_effective_amount,
        23_609_200,
      ) ||
      contract.status !== "completed")
  ) {
    throw new Error("2024-11-06 护套线目标合同与冻结基线不一致");
  }
}

function assertWireSupplementIdentity(contract: ContractRow | undefined): void {
  if (
    !contract ||
    contract.id !== WIRE_SUPPLEMENT_ID ||
    contract.title !== "护套线、屏蔽线采购补充协议（1）" ||
    contract.project_name !== "护套线、屏蔽线采购补充协议（1）" ||
    contract.category !== "non_main" ||
    contract.declared_subtype !== "non_main_expense" ||
    contract.relation_type !== "supplement" ||
    contract.status !== "effective" ||
    contract.area !== "全部" ||
    contract.parent_contract_id !== WIRE_TARGET_CONTRACT_ID ||
    contract.root_contract_id !== WIRE_TARGET_CONTRACT_ID ||
    contract.party_a !== "北京羽隶工程咨询有限公司" ||
    contract.party_b !== "北京中冀天泽科技有限公司" ||
    contract.contract_date !== "2025-07-14" ||
    Number(contract.amount_delta) !== 78_564.22 ||
    contract.supplement_change_type !== "amount_adjustment" ||
    Number(contract.supplement_sequence) !== 1
  ) {
    throw new Error("2024-11-06 护套线目标合同的补充协议不完整");
  }
}

function assertFrozenOldFile(
  row: ContractFileRow | undefined,
  source: FrozenSourceFile,
): void {
  if (
    !row ||
    row.id !== source.oldFileId ||
    row.contract_id !== source.oldContractId ||
    row.file_name !== source.fileName ||
    row.file_path !== source.oldStoredPath ||
    Number(row.file_size) !== source.size ||
    row.mime_type !== targetMimeType(source) ||
    row.file_hash !== source.sha256 ||
    Number(row.version) !== 1 ||
    row.is_current !== true
  ) {
    throw new Error(`旧合同文件记录与冻结值不一致：${source.fileName}`);
  }
}

function assertFrozenOldMapping(
  row: MappingRow | undefined,
  source: FrozenSourceFile,
): void {
  if (
    !row ||
    row.source_path !== source.sourcePath ||
    row.source_hash !== source.sha256 ||
    Number(row.source_bytes) !== source.size ||
    row.family_key !== source.familyKey ||
    row.contract_id !== source.oldContractId ||
    row.target_kind !== source.oldTargetKind ||
    row.accounting_included !== false ||
    row.contract_file_id !== source.oldFileId ||
    row.auxiliary_file_id !== null
  ) {
    throw new Error(`旧源文件映射与冻结值不一致：${source.sourcePath}`);
  }
}

function assertCorrectedMapping(
  row: MappingRow | undefined,
  source: FrozenSourceFile,
): void {
  if (
    !row ||
    row.source_hash !== source.sha256 ||
    Number(row.source_bytes) !== source.size ||
    row.family_key !== source.familyKey ||
    row.contract_id !== source.newContractId ||
    row.target_kind !== "auxiliary" ||
    row.accounting_included !== false ||
    row.contract_file_id !== null ||
    row.auxiliary_file_id !== auxiliaryFileId(source)
  ) {
    throw new Error(`更正后源文件映射不完整：${source.sourcePath}`);
  }
}

export async function readCorrectionState(
  client: PoolClient,
): Promise<RawCorrectionState> {
  const contractIds = [
    DRAGON_CONTRACT_ID,
    WIRE_OBSOLETE_CONTRACT_ID,
    WIRE_TARGET_CONTRACT_ID,
    WIRE_SUPPLEMENT_ID,
  ];
  const packageIds = [packageId("dragon"), packageId("wire")];
  const correctionAuditIds = [
    auditId(DRAGON_CONTRACT_ID),
    auditId(WIRE_TARGET_CONTRACT_ID),
  ];
  // 同一事务连接必须顺序发出查询，避免 pg PoolClient 并发排队造成预演阻塞。
  const contracts = await client.query<ContractRow>(
    `SELECT id,contract_no,title,project_name,category,declared_subtype,
         relation_type,status,area,parent_contract_id,root_contract_id,
         party_a,party_b,contract_date,business_contract_no,amount_delta,
         current_effective_amount,supplement_change_type,supplement_sequence,
         requires_auxiliary_materials,to_jsonb(contracts.*) AS snapshot
       FROM contracts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [contractIds],
  );
  const oldFiles = await client.query<ContractFileRow>(
    `SELECT id,contract_id,file_type,file_name,file_path,file_size,mime_type,
         file_hash,version,is_current,to_jsonb(file_row.*) AS snapshot
       FROM contract_files file_row
       WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [SECOND_AUXILIARY_CORRECTION_FILES.map((file) => file.oldFileId)],
  );
  const mappings = await client.query<MappingRow>(
    `SELECT source_path,source_hash,source_bytes,family_key,contract_id,
         target_kind,accounting_included,contract_file_id,auxiliary_file_id,
         to_jsonb(mapping_row.*) AS snapshot
       FROM contract_historical_import_files mapping_row
       WHERE batch_key=$1 AND source_path=ANY($2::text[])
       ORDER BY source_path FOR UPDATE`,
    [
      SECOND_AUXILIARY_CORRECTION_BATCH_KEY,
      SECOND_AUXILIARY_CORRECTION_FILES.map((file) => file.sourcePath),
    ],
  );
  const packages = await client.query<PackageRow>(
    `SELECT id,parent_contract_id,note,status,accounting_included,created_by,
         updated_by,version FROM contract_auxiliary_packages
       WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [packageIds],
  );
  const auxiliaryFiles = await client.query<AuxiliaryFileRow>(
    `SELECT id,package_id,file_kind,file_name,file_path,file_size,mime_type,
         file_hash,version,is_current,uploaded_by
       FROM contract_auxiliary_files
       WHERE id=ANY($1::text[]) OR file_hash=ANY($2::text[])
       ORDER BY id FOR UPDATE`,
    [
      SECOND_AUXILIARY_CORRECTION_FILES.map(auxiliaryFileId),
      SECOND_AUXILIARY_CORRECTION_FILES.map((file) => file.sha256),
    ],
  );
  const financialHashes = await client.query<FinancialHashRow>(
    `SELECT file_hash,file_id,contract_id,
         to_jsonb(hash_row.*) AS snapshot
       FROM contract_financial_file_hashes hash_row
       WHERE file_hash=$1 FOR UPDATE`,
    [SECOND_AUXILIARY_CORRECTION_FILES[0]!.sha256],
  );
  const correctionAudits = await client.query<AuditRow>(
    `SELECT id,contract_id,action,actor_id,changes_json,
         to_jsonb(contract_audit_logs.*) AS snapshot
       FROM contract_audit_logs WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [correctionAuditIds],
  );
  const obsoleteAudits = await client.query<AuditRow>(
    `SELECT id,contract_id,action,actor_id,changes_json,
         to_jsonb(contract_audit_logs.*) AS snapshot
       FROM contract_audit_logs WHERE contract_id=$1 ORDER BY id FOR UPDATE`,
    [WIRE_OBSOLETE_CONTRACT_ID],
  );
  const batch = await client.query<BatchRow>(
    `SELECT batch_key,manifest_hash,source_file_count,source_total_bytes,
         status,imported_contract_count,restored_contract_count,summary_json
       FROM contract_historical_import_batches WHERE batch_key=$1 FOR UPDATE`,
    [SECOND_AUXILIARY_CORRECTION_BATCH_KEY],
  );
  if (batch.rows.length !== 1) throw new Error("第二批导入批次不存在或不唯一");
  return {
    contracts: contracts.rows,
    oldFiles: oldFiles.rows,
    mappings: mappings.rows,
    packages: packages.rows,
    auxiliaryFiles: auxiliaryFiles.rows,
    financialHashes: financialHashes.rows,
    correctionAudits: correctionAudits.rows,
    obsoleteAudits: obsoleteAudits.rows,
    batch: batch.rows[0]!,
  };
}

function assertBatchEnvelope(batch: BatchRow): void {
  if (
    batch.batch_key !== SECOND_AUXILIARY_CORRECTION_BATCH_KEY ||
    batch.manifest_hash !== SECOND_AUXILIARY_CORRECTION_MANIFEST_SHA256 ||
    Number(batch.source_file_count) !== 384 ||
    Number(batch.source_total_bytes) !== 100_769_730 ||
    batch.status !== "completed" ||
    Number(batch.restored_contract_count) !== 1
  ) {
    throw new Error("第二批导入批次外壳与冻结基线不一致");
  }
}

function expectedObsoleteAuditId(
  target: SecondAuxiliaryCorrectionArguments["target"],
): string {
  return target === "production"
    ? "h2_A7UFrtQuImBvAZ2MiWHp"
    : "h2_nQoyJafzhrh5Th1ubO2f";
}

function assertOldState(
  state: RawCorrectionState,
  target: SecondAuxiliaryCorrectionArguments["target"],
): void {
  assertBatchEnvelope(state.batch);
  if (
    classifySecondAuxiliaryCorrectionBatch(
      Number(state.batch.imported_contract_count),
      state.batch.summary_json,
    ) !== "old"
  ) {
    throw new Error("第二批批次不是待更正旧态");
  }
  if (target === "production") {
    assertProductionFinancialLinkResults(state.batch.summary_json, "old");
  }
  assertContractIdentity(
    state.contracts.find((row) => row.id === DRAGON_CONTRACT_ID),
    target,
    "dragon",
  );
  assertContractIdentity(
    state.contracts.find((row) => row.id === WIRE_OBSOLETE_CONTRACT_ID),
    target,
    "obsolete-wire",
  );
  assertContractIdentity(
    state.contracts.find((row) => row.id === WIRE_TARGET_CONTRACT_ID),
    target,
    "target-wire",
  );
  assertWireSupplementIdentity(
    state.contracts.find((row) => row.id === WIRE_SUPPLEMENT_ID),
  );
  if (
    state.contracts
      .filter((row) =>
        [DRAGON_CONTRACT_ID, WIRE_TARGET_CONTRACT_ID].includes(row.id),
      )
      .some((row) => row.requires_auxiliary_materials)
  ) {
    throw new Error("冻结旧态的两个目标合同不应已启用辅助材料");
  }
  if (state.oldFiles.length !== 3 || state.mappings.length !== 3) {
    throw new Error("待更正旧文件或源映射数量不是3");
  }
  for (const source of SECOND_AUXILIARY_CORRECTION_FILES) {
    assertFrozenOldFile(
      state.oldFiles.find((row) => row.id === source.oldFileId),
      source,
    );
    assertFrozenOldMapping(
      state.mappings.find((row) => row.source_path === source.sourcePath),
      source,
    );
  }
  const voidFile = SECOND_AUXILIARY_CORRECTION_FILES[0]!;
  if (
    state.financialHashes.length !== 1 ||
    state.financialHashes[0]?.file_hash !== voidFile.sha256 ||
    state.financialHashes[0]?.file_id !== voidFile.oldFileId ||
    state.financialHashes[0]?.contract_id !== DRAGON_CONTRACT_ID
  ) {
    throw new Error("龙潭湖作废发票的财务摘要占位与冻结值不一致");
  }
  if (
    state.packages.length !== 0 ||
    state.auxiliaryFiles.length !== 0 ||
    state.correctionAudits.length !== 0
  ) {
    throw new Error("发现归类更正的部分落库状态，拒绝继续");
  }
  const obsoleteAudit = state.obsoleteAudits[0];
  if (
    state.obsoleteAudits.length !== 1 ||
    !obsoleteAudit ||
    obsoleteAudit.id !== expectedObsoleteAuditId(target) ||
    obsoleteAudit.action !== "historical_contract_imported" ||
    obsoleteAudit.changes_json?.sourceHash !==
      SECOND_AUXILIARY_CORRECTION_FILES[2]!.sha256 ||
    obsoleteAudit.changes_json?.batchKey !==
      SECOND_AUXILIARY_CORRECTION_BATCH_KEY
  ) {
    throw new Error("2024-10-31 错误根合同不是唯一的冻结导入审计态");
  }
}

function assertSnapshotKeys(
  snapshot: Record<string, unknown>,
  expectedKeys: readonly string[],
  label: string,
): void {
  if (
    digest(Object.keys(snapshot).sort()) !== digest([...expectedKeys].sort())
  ) {
    throw new Error(`${label}不是删除前完整数据库行快照`);
  }
}

function recordArray(value: unknown, label: string): Record<string, unknown>[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  ) {
    throw new Error(`${label}不是完整对象数组`);
  }
  return value as Record<string, unknown>[];
}

function assertProductionAuditSnapshots(
  changes: Record<string, unknown>,
  sources: readonly FrozenSourceFile[],
): void {
  const before = changes.databaseRowsBeforeCorrection;
  if (!before || typeof before !== "object" || Array.isArray(before)) {
    throw new Error("生产更正审计缺少删除前数据库行快照");
  }
  const beforeRows = before as Record<string, unknown>;
  const fileRows = recordArray(beforeRows.contractFiles, "删除前合同文件快照");
  const mappingRows = recordArray(
    beforeRows.historicalImportMappings,
    "更正前源映射快照",
  );
  const financialRows = recordArray(
    beforeRows.financialFileHashes,
    "删除前财务文件摘要快照",
  );
  if (
    fileRows.length !== sources.length ||
    mappingRows.length !== sources.length
  ) {
    throw new Error("生产更正审计中的文件或映射快照数量不完整");
  }
  for (const source of sources) {
    const file = fileRows.find((row) => row.id === source.oldFileId);
    if (!file)
      throw new Error(`生产更正审计缺少旧文件快照：${source.fileName}`);
    assertSnapshotKeys(
      file,
      [
        "id",
        "contract_id",
        "file_type",
        "file_name",
        "file_path",
        "file_size",
        "mime_type",
        "file_hash",
        "version",
        "is_current",
        "uploaded_by",
        "created_at",
      ],
      `旧文件${source.oldFileId}`,
    );
    const expectedFileType =
      source.oldTargetKind === "sealed_contract"
        ? "sealed_contract"
        : source.fileKind;
    if (
      file.contract_id !== source.oldContractId ||
      file.file_type !== expectedFileType ||
      file.file_name !== source.fileName ||
      file.file_path !== source.oldStoredPath ||
      Number(file.file_size) !== source.size ||
      file.mime_type !== targetMimeType(source) ||
      file.file_hash !== source.sha256 ||
      Number(file.version) !== 1 ||
      file.is_current !== true ||
      typeof file.uploaded_by !== "string" ||
      !file.uploaded_by ||
      typeof file.created_at !== "string" ||
      !file.created_at
    ) {
      throw new Error(`生产更正审计的旧文件快照不匹配：${source.fileName}`);
    }

    const mapping = mappingRows.find(
      (row) => row.source_path === source.sourcePath,
    );
    if (!mapping) {
      throw new Error(`生产更正审计缺少源映射快照：${source.sourcePath}`);
    }
    assertSnapshotKeys(
      mapping,
      [
        "batch_key",
        "source_path",
        "source_hash",
        "source_bytes",
        "family_key",
        "contract_id",
        "target_kind",
        "accounting_included",
        "contract_file_id",
        "auxiliary_file_id",
        "created_at",
      ],
      `源映射${source.sourcePath}`,
    );
    if (
      mapping.batch_key !== SECOND_AUXILIARY_CORRECTION_BATCH_KEY ||
      mapping.source_hash !== source.sha256 ||
      Number(mapping.source_bytes) !== source.size ||
      mapping.family_key !== source.familyKey ||
      mapping.contract_id !== source.oldContractId ||
      mapping.target_kind !== source.oldTargetKind ||
      mapping.accounting_included !== false ||
      mapping.contract_file_id !== source.oldFileId ||
      mapping.auxiliary_file_id !== null ||
      typeof mapping.created_at !== "string" ||
      !mapping.created_at
    ) {
      throw new Error(`生产更正审计的源映射快照不匹配：${source.sourcePath}`);
    }
  }

  const isDragon = sources[0]?.bucket === "dragon";
  if (financialRows.length !== (isDragon ? 1 : 0)) {
    throw new Error("生产更正审计的龙潭湖财务摘要快照数量不完整");
  }
  if (isDragon) {
    const voidFile = SECOND_AUXILIARY_CORRECTION_FILES[0]!;
    const financial = financialRows[0]!;
    assertSnapshotKeys(
      financial,
      ["file_hash", "file_id", "contract_id", "created_at"],
      "龙潭湖财务文件摘要",
    );
    if (
      financial.file_hash !== voidFile.sha256 ||
      financial.file_id !== voidFile.oldFileId ||
      financial.contract_id !== DRAGON_CONTRACT_ID ||
      typeof financial.created_at !== "string" ||
      !financial.created_at
    ) {
      throw new Error("生产更正审计的龙潭湖财务摘要快照不匹配");
    }
  }
}

function assertProductionCorrectionAudit(
  audit: AuditRow,
  contractId: string,
): void {
  const bucket = contractId === DRAGON_CONTRACT_ID ? "dragon" : "wire";
  const sources = SECOND_AUXILIARY_CORRECTION_FILES.filter(
    (source) => source.bucket === bucket,
  );
  const changes = audit.changes_json;
  const expectedRelocations = sources.map((source) => ({
    oldContractFileId: source.oldFileId,
    auxiliaryFileId: auxiliaryFileId(source),
    fileName: source.fileName,
    sourcePath: source.sourcePath,
    oldStoredPath: source.oldStoredPath,
    newStoredPath: secondAuxiliaryCorrectionStoredPath(source),
    sha256: source.sha256,
    bytes: source.size,
    oldPhysicalFilePreserved: true,
    newPhysicalFileVerified: true,
  }));
  if (
    changes.batchKey !== SECOND_AUXILIARY_CORRECTION_BATCH_KEY ||
    changes.packageId !== packageId(bucket) ||
    digest(changes.auxiliaryFileIds) !== digest(sources.map(auxiliaryFileId)) ||
    digest(changes.sourcePaths) !==
      digest(sources.map((source) => source.sourcePath)) ||
    digest(changes.sourceHashes) !==
      digest(sources.map((source) => source.sha256)) ||
    changes.removedContractId !==
      (bucket === "wire" ? WIRE_OBSOLETE_CONTRACT_ID : null) ||
    changes.physicalSourceFilesPreserved !== true ||
    digest(changes.fileRelocations) !== digest(expectedRelocations)
  ) {
    throw new Error(`生产${bucket}更正审计的包、文件或物理留痕不完整`);
  }
  assertProductionAuditSnapshots(changes, sources);
}

function assertPostState(
  state: RawCorrectionState,
  target: SecondAuxiliaryCorrectionArguments["target"],
  actor: ActorRow,
): void {
  assertBatchEnvelope(state.batch);
  if (
    classifySecondAuxiliaryCorrectionBatch(
      Number(state.batch.imported_contract_count),
      state.batch.summary_json,
    ) !== "post"
  ) {
    throw new Error("第二批批次未形成完整更正摘要");
  }
  if (target === "production") {
    assertProductionFinancialLinkResults(state.batch.summary_json, "post");
  }
  if (state.contracts.some((row) => row.id === WIRE_OBSOLETE_CONTRACT_ID)) {
    throw new Error("2024-10-31 错误根合同仍然存在");
  }
  const dragon = state.contracts.find((row) => row.id === DRAGON_CONTRACT_ID);
  const wire = state.contracts.find(
    (row) => row.id === WIRE_TARGET_CONTRACT_ID,
  );
  assertContractIdentity(dragon, target, "dragon");
  assertContractIdentity(wire, target, "target-wire");
  assertWireSupplementIdentity(
    state.contracts.find((row) => row.id === WIRE_SUPPLEMENT_ID),
  );
  if (
    !dragon?.requires_auxiliary_materials ||
    !wire?.requires_auxiliary_materials
  ) {
    throw new Error("更正后两个目标合同未启用辅助材料");
  }
  if (
    state.oldFiles.length !== 0 ||
    state.financialHashes.length !== 0 ||
    state.obsoleteAudits.length !== 0
  ) {
    throw new Error("更正后旧数据库记录没有精确清除");
  }
  if (
    state.packages.length !== 2 ||
    state.auxiliaryFiles.length !== 3 ||
    state.mappings.length !== 3 ||
    state.correctionAudits.length !== 2
  ) {
    throw new Error("更正后的辅助包、文件、映射或审计数量不完整");
  }
  for (const bucket of ["dragon", "wire"] as const) {
    const packageRow = state.packages.find(
      (row) => row.id === packageId(bucket),
    );
    const expectedParent =
      bucket === "dragon" ? DRAGON_CONTRACT_ID : WIRE_TARGET_CONTRACT_ID;
    if (
      !packageRow ||
      packageRow.parent_contract_id !== expectedParent ||
      packageRow.note !== packageNote(bucket) ||
      packageRow.status !== "succeeded" ||
      packageRow.accounting_included !== false ||
      packageRow.created_by !== actor.id ||
      packageRow.updated_by !== actor.id ||
      Number(packageRow.version) !== 1
    ) {
      throw new Error(`更正后的${bucket}辅助包不完整`);
    }
  }
  for (const source of SECOND_AUXILIARY_CORRECTION_FILES) {
    assertCorrectedMapping(
      state.mappings.find((row) => row.source_path === source.sourcePath),
      source,
    );
    const file = state.auxiliaryFiles.find(
      (row) => row.id === auxiliaryFileId(source),
    );
    if (
      !file ||
      file.package_id !== packageId(source.bucket) ||
      file.file_kind !== source.fileKind ||
      file.file_name !== source.fileName ||
      file.file_path !== secondAuxiliaryCorrectionStoredPath(source) ||
      Number(file.file_size) !== source.size ||
      file.mime_type !== targetMimeType(source) ||
      file.file_hash !== source.sha256 ||
      Number(file.version) !== 1 ||
      file.is_current !== true ||
      file.uploaded_by !== actor.id
    ) {
      throw new Error(`更正后的辅助文件不完整：${source.fileName}`);
    }
  }
  for (const contractId of [DRAGON_CONTRACT_ID, WIRE_TARGET_CONTRACT_ID]) {
    const audit = state.correctionAudits.find(
      (row) => row.id === auditId(contractId),
    );
    if (
      !audit ||
      audit.contract_id !== contractId ||
      audit.action !== "historical_auxiliary_classification_corrected" ||
      audit.actor_id !== actor.id ||
      audit.changes_json?.correctionKey !== SECOND_AUXILIARY_CORRECTION_KEY
    ) {
      throw new Error(`目标合同缺少唯一归类更正审计：${contractId}`);
    }
    if (target === "production") {
      assertProductionCorrectionAudit(audit, contractId);
    }
    if (contractId === WIRE_TARGET_CONTRACT_ID) {
      const snapshot = audit.changes_json?.removedContractSnapshot as
        | Record<string, unknown>
        | undefined;
      if (
        snapshot?.id !== WIRE_OBSOLETE_CONTRACT_ID ||
        snapshot.contractNo !==
          expectedContractNumbers(target)[WIRE_OBSOLETE_CONTRACT_ID] ||
        snapshot.businessContractNo !== "SHIP-ZJTZ-20241030005" ||
        snapshot.contractDate !== "2024-10-31" ||
        Number(snapshot.currentAmount) !== 157_527.78 ||
        snapshot.status !== "effective" ||
        snapshot.oldFileId !==
          SECOND_AUXILIARY_CORRECTION_FILES[2]!.oldFileId ||
        snapshot.oldFileHash !== SECOND_AUXILIARY_CORRECTION_FILES[2]!.sha256 ||
        snapshot.deletedAuditId !== expectedObsoleteAuditId(target)
      ) {
        throw new Error("护套线更正审计未完整冻结被硬删合同和文件信息");
      }
    }
  }
}

async function currentActor(client: PoolClient): Promise<ActorRow> {
  const result = await client.query<ActorRow>(
    `SELECT id,role,name FROM users
     WHERE name=$1 AND status='active'
       AND role IN ('admin','super_admin','chairman')
     ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'super_admin' THEN 1 ELSE 2 END,
       id LIMIT 2`,
    [ACTOR_NAME],
  );
  if (result.rows.length !== 1) {
    throw new Error(`目标库必须且只能有一个名为${ACTOR_NAME}的活动管理员账号`);
  }
  return result.rows[0]!;
}

/**
 * 冻结生产数据库物理身份，以及本次更正会读取或改写的合同和批次完整状态。
 * 开发目标不使用该摘要，以兼容已经完成 v1 更正的开发库。
 */
export async function calculateSecondAuxiliaryCorrectionTargetDatabaseSha256(
  client: CorrectionQueryClient,
): Promise<string> {
  const identity = await client.query<{
    database_name: string;
    database_oid: string;
    database_user: string;
    system_identifier: string;
  }>(
    `SELECT current_database() AS database_name,
       (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
       current_user AS database_user,
       (pg_control_system()).system_identifier::text AS system_identifier`,
  );
  if (
    identity.rows.length !== 1 ||
    !identity.rows[0]?.database_name ||
    !identity.rows[0]?.database_oid ||
    !identity.rows[0]?.database_user ||
    !identity.rows[0]?.system_identifier
  ) {
    throw new Error("无法读取生产数据库完整系统身份");
  }
  const contracts = await client.query<{
    id: string;
    snapshot: Record<string, unknown>;
  }>(
    `SELECT id,to_jsonb(contract_row.*) AS snapshot
       FROM contracts contract_row
      WHERE id=ANY($1::text[]) ORDER BY id`,
    [
      [
        DRAGON_CONTRACT_ID,
        WIRE_OBSOLETE_CONTRACT_ID,
        WIRE_TARGET_CONTRACT_ID,
        WIRE_SUPPLEMENT_ID,
      ],
    ],
  );
  const batch = await client.query<{
    batch_key: string;
    snapshot: Record<string, unknown>;
  }>(
    `SELECT batch_key,to_jsonb(batch_row.*) AS snapshot
       FROM contract_historical_import_batches batch_row
      WHERE batch_key=$1`,
    [SECOND_AUXILIARY_CORRECTION_BATCH_KEY],
  );
  if (batch.rows.length !== 1) {
    throw new Error("无法冻结第二批历史导入批次状态");
  }
  return digest({
    version: "second-historical-auxiliary-correction-target-v1",
    identity: identity.rows[0],
    frozenContracts: contracts.rows,
    frozenBatch: batch.rows[0],
  });
}

export function assertSecondAuxiliaryCorrectionTargetDatabaseSha256(
  args: SecondAuxiliaryCorrectionArguments,
  actualSha256: string,
): void {
  if (args.target === "development") return;
  if (
    !args.targetDatabaseSha256 ||
    !HASH_PATTERN.test(args.targetDatabaseSha256) ||
    !HASH_PATTERN.test(actualSha256) ||
    args.targetDatabaseSha256 !== actualSha256
  ) {
    throw new Error("生产目标数据库身份、冻结合同或批次状态摘要不一致");
  }
}

async function assertTargetDatabase(
  client: PoolClient,
  target: SecondAuxiliaryCorrectionArguments["target"],
): Promise<void> {
  const identity = await client.query<{
    database_name: string;
    user_name: string;
  }>(`SELECT current_database() AS database_name,current_user AS user_name`);
  if (identity.rows[0]?.database_name !== "yulilog_worklog") {
    throw new Error(
      `目标数据库名称不正确：${identity.rows[0]?.database_name || "未知"}`,
    );
  }
  const expectedNumbers = Object.values(expectedContractNumbers(target));
  const markers = await client.query<{ id: string; contract_no: string }>(
    `SELECT id,contract_no FROM contracts
     WHERE id=ANY($1::text[]) ORDER BY id`,
    [[WIRE_OBSOLETE_CONTRACT_ID, WIRE_TARGET_CONTRACT_ID]],
  );
  if (
    markers.rows.length === 2 &&
    !markers.rows.every((row) => expectedNumbers.includes(row.contract_no))
  ) {
    throw new Error(`合同编号环境指纹与${target}不一致`);
  }
  if (
    markers.rows.length === 1 &&
    markers.rows[0]?.id === WIRE_TARGET_CONTRACT_ID &&
    !expectedNumbers.includes(markers.rows[0].contract_no)
  ) {
    throw new Error(`更正后合同编号环境指纹与${target}不一致`);
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error(`数据库标识符不安全：${value}`);
  }
  return `"${value}"`;
}

async function foreignReferenceCounts(
  client: PoolClient,
  targetTable: "contracts" | "contract_files",
  targetId: string,
): Promise<Map<string, number>> {
  const references = await client.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT source.relname AS table_name,source_column.attname AS column_name
     FROM pg_constraint constraint_row
     JOIN pg_class source ON source.oid=constraint_row.conrelid
     JOIN pg_namespace source_schema ON source_schema.oid=source.relnamespace
     JOIN pg_class target ON target.oid=constraint_row.confrelid
     JOIN pg_namespace target_schema ON target_schema.oid=target.relnamespace
     JOIN pg_attribute source_column
       ON source_column.attrelid=source.oid
      AND source_column.attnum=constraint_row.conkey[1]
     WHERE constraint_row.contype='f'
       AND cardinality(constraint_row.conkey)=1
       AND source_schema.nspname='public' AND target_schema.nspname='public'
       AND target.relname=$1
     ORDER BY source.relname,source_column.attname`,
    [targetTable],
  );
  const counts = new Map<string, number>();
  for (const reference of references.rows) {
    const result = await client.query<{ count: string | number }>(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(reference.table_name)}
       WHERE ${quoteIdentifier(reference.column_name)}=$1`,
      [targetId],
    );
    counts.set(
      `${reference.table_name}.${reference.column_name}`,
      Number(result.rows[0]?.count || 0),
    );
  }
  return counts;
}

function assertExactReferences(
  actual: ReadonlyMap<string, number>,
  expected: Readonly<Record<string, number>>,
  label: string,
): void {
  for (const [key, count] of actual) {
    if (count !== (expected[key] || 0)) {
      throw new Error(`${label}存在未授权依赖：${key}=${count}`);
    }
  }
  for (const [key, count] of Object.entries(expected)) {
    if (actual.get(key) !== count) {
      throw new Error(`${label}缺少冻结依赖：${key}应为${count}`);
    }
  }
}

async function assertOldDependencies(client: PoolClient): Promise<void> {
  for (const source of SECOND_AUXILIARY_CORRECTION_FILES) {
    const expected: Record<string, number> = {
      "contract_historical_import_files.contract_file_id": 1,
    };
    if (source.oldFileId === SECOND_AUXILIARY_CORRECTION_FILES[0]!.oldFileId) {
      expected["contract_financial_file_hashes.file_id"] = 1;
    }
    assertExactReferences(
      await foreignReferenceCounts(client, "contract_files", source.oldFileId),
      expected,
      `旧文件${source.oldFileId}`,
    );
  }
  assertExactReferences(
    await foreignReferenceCounts(
      client,
      "contracts",
      WIRE_OBSOLETE_CONTRACT_ID,
    ),
    {
      "contracts.root_contract_id": 1,
      "contract_files.contract_id": 1,
      "contract_historical_import_files.contract_id": 1,
      "contract_audit_logs.contract_id": 1,
    },
    "2024-10-31 错误根合同",
  );
}

async function captureProtectedState(client: PoolClient): Promise<string> {
  const protectedContractIds = [
    DRAGON_CONTRACT_ID,
    WIRE_TARGET_CONTRACT_ID,
    WIRE_SUPPLEMENT_ID,
  ];
  const intendedSourcePaths = SECOND_AUXILIARY_CORRECTION_FILES.map(
    (file) => file.sourcePath,
  );
  const correctionIds = [
    auditId(DRAGON_CONTRACT_ID),
    auditId(WIRE_TARGET_CONTRACT_ID),
  ];
  const queries: Array<[string, readonly unknown[]]> = [
    [
      `SELECT id,to_jsonb(contract_row.*)
       -'requires_auxiliary_materials'-'version'-'updated_by'-'updated_at' AS row
       FROM contracts contract_row WHERE id=ANY($1::text[]) ORDER BY id`,
      [protectedContractIds],
    ],
    [
      `SELECT id,to_jsonb(file_row.*) AS row FROM contract_files file_row
       WHERE contract_id=ANY($1::text[]) AND NOT (id=ANY($2::text[])) ORDER BY id`,
      [
        protectedContractIds,
        SECOND_AUXILIARY_CORRECTION_FILES.map((file) => file.oldFileId),
      ],
    ],
    [
      `SELECT source_path,to_jsonb(mapping_row.*) AS row
       FROM contract_historical_import_files mapping_row
       WHERE contract_id=ANY($1::text[]) AND NOT (source_path=ANY($2::text[]))
       ORDER BY source_path`,
      [protectedContractIds, intendedSourcePaths],
    ],
    [
      `SELECT id,to_jsonb(audit_row.*) AS row FROM contract_audit_logs audit_row
       WHERE contract_id=ANY($1::text[]) AND NOT (id=ANY($2::text[])) ORDER BY id`,
      [protectedContractIds, correctionIds],
    ],
    [
      `SELECT id,to_jsonb(job_row.*) AS row FROM contract_financial_ocr_jobs job_row
       WHERE contract_id=ANY($1::text[]) ORDER BY id`,
      [protectedContractIds],
    ],
    [
      `SELECT id,to_jsonb(invoice_row.*) AS row FROM contract_invoices invoice_row
       WHERE contract_id=ANY($1::text[]) ORDER BY id`,
      [protectedContractIds],
    ],
    [
      `SELECT id,to_jsonb(receipt_row.*) AS row FROM contract_receipts receipt_row
       WHERE contract_id=ANY($1::text[]) ORDER BY id`,
      [protectedContractIds],
    ],
    [
      `SELECT id,to_jsonb(payment_row.*) AS row FROM contract_payments payment_row
       WHERE contract_id=ANY($1::text[]) ORDER BY id`,
      [protectedContractIds],
    ],
    [
      `SELECT id,to_jsonb(registration_row.*) AS row
       FROM contract_financial_registrations registration_row
       WHERE contract_id=ANY($1::text[]) ORDER BY id`,
      [protectedContractIds],
    ],
    [
      `SELECT id,to_jsonb(item_row.*) AS row
       FROM contract_financial_registration_items item_row
       WHERE contract_id=ANY($1::text[]) ORDER BY id`,
      [protectedContractIds],
    ],
    [
      `SELECT id,to_jsonb(match_row.*) AS row
       FROM contract_financial_registration_matches match_row
       WHERE contract_id=ANY($1::text[]) ORDER BY id`,
      [protectedContractIds],
    ],
  ];
  const result: unknown[] = [];
  for (const [sql, parameters] of queries) {
    result.push((await client.query(sql, [...parameters])).rows);
  }
  return digest(result);
}

async function insertAuxiliaryPackage(
  client: PoolClient,
  input: {
    bucket: "dragon" | "wire";
    parentContractId: string;
    files: readonly CopiedFile[];
    actor: ActorRow;
    now: string;
  },
): Promise<void> {
  const insertedPackage = await client.query(
    `INSERT INTO contract_auxiliary_packages(
       id,parent_contract_id,party_a,party_b,recognized_amount,note,status,
       raw_text,ocr_fields_json,ocr_lines_json,warnings_json,error_message,
       model_version,parser_version,retry_count,version,accounting_included,
       created_by,updated_by,created_at,updated_at
     ) VALUES($1,$2,NULL,NULL,NULL,$3,'succeeded',NULL,'[]'::jsonb,
       '[]'::jsonb,'[]'::jsonb,NULL,NULL,NULL,0,1,FALSE,$4,$4,$5,$5)`,
    [
      packageId(input.bucket),
      input.parentContractId,
      packageNote(input.bucket),
      input.actor.id,
      input.now,
    ],
  );
  if (insertedPackage.rowCount !== 1) throw new Error("辅助材料包写入失败");
  for (const copied of input.files) {
    const source = copied.source;
    const insertedFile = await client.query(
      `INSERT INTO contract_auxiliary_files(
         id,package_id,file_kind,file_name,file_path,file_size,mime_type,
         file_hash,version,is_current,uploaded_by,created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,TRUE,$9,$10)`,
      [
        auxiliaryFileId(source),
        packageId(input.bucket),
        source.fileKind,
        source.fileName,
        copied.storedPath,
        source.size,
        targetMimeType(source),
        source.sha256,
        input.actor.id,
        input.now,
      ],
    );
    if (insertedFile.rowCount !== 1)
      throw new Error(`辅助文件写入失败：${source.fileName}`);
  }
}

async function applyDatabaseCorrection(
  client: PoolClient,
  input: {
    copiedFiles: readonly CopiedFile[];
    actor: ActorRow;
    target: SecondAuxiliaryCorrectionArguments["target"];
    now: string;
    oldBatchSummary: Record<string, unknown>;
    obsoleteContract: ContractRow;
    obsoleteAudit: AuditRow;
    oldFiles: readonly ContractFileRow[];
    oldMappings: readonly MappingRow[];
    oldFinancialHashes: readonly FinancialHashRow[];
  },
): Promise<void> {
  const dragonCopies = input.copiedFiles.filter(
    (file) => file.source.bucket === "dragon",
  );
  const wireCopies = input.copiedFiles.filter(
    (file) => file.source.bucket === "wire",
  );
  await insertAuxiliaryPackage(client, {
    bucket: "dragon",
    parentContractId: DRAGON_CONTRACT_ID,
    files: dragonCopies,
    actor: input.actor,
    now: input.now,
  });
  await insertAuxiliaryPackage(client, {
    bucket: "wire",
    parentContractId: WIRE_TARGET_CONTRACT_ID,
    files: wireCopies,
    actor: input.actor,
    now: input.now,
  });

  const voidFile = SECOND_AUXILIARY_CORRECTION_FILES[0]!;
  const deletedHash = await client.query(
    `DELETE FROM contract_financial_file_hashes
     WHERE file_hash=$1 AND file_id=$2 AND contract_id=$3`,
    [voidFile.sha256, voidFile.oldFileId, DRAGON_CONTRACT_ID],
  );
  if (deletedHash.rowCount !== 1)
    throw new Error("龙潭湖作废发票财务摘要删除失败");

  for (const copied of input.copiedFiles) {
    const source = copied.source;
    const updatedMapping = await client.query(
      `UPDATE contract_historical_import_files SET
         contract_id=$4,target_kind='auxiliary',accounting_included=FALSE,
         contract_file_id=NULL,auxiliary_file_id=$5
       WHERE batch_key=$1 AND source_path=$2 AND source_hash=$3
         AND contract_id=$6 AND target_kind=$7 AND accounting_included=FALSE
         AND contract_file_id=$8 AND auxiliary_file_id IS NULL`,
      [
        SECOND_AUXILIARY_CORRECTION_BATCH_KEY,
        source.sourcePath,
        source.sha256,
        source.newContractId,
        auxiliaryFileId(source),
        source.oldContractId,
        source.oldTargetKind,
        source.oldFileId,
      ],
    );
    if (updatedMapping.rowCount !== 1) {
      throw new Error(`源文件映射并发变化：${source.sourcePath}`);
    }
    const deletedFile = await client.query(
      `DELETE FROM contract_files
       WHERE id=$1 AND contract_id=$2 AND file_hash=$3 AND file_path=$4`,
      [
        source.oldFileId,
        source.oldContractId,
        source.sha256,
        source.oldStoredPath,
      ],
    );
    if (deletedFile.rowCount !== 1)
      throw new Error(`旧文件记录删除失败：${source.fileName}`);
  }

  const deletedAudit = await client.query(
    `DELETE FROM contract_audit_logs
     WHERE id=$1 AND contract_id=$2 AND action='historical_contract_imported'
       AND changes_json->>'sourceHash'=$3 AND changes_json->>'batchKey'=$4`,
    [
      expectedObsoleteAuditId(input.target),
      WIRE_OBSOLETE_CONTRACT_ID,
      SECOND_AUXILIARY_CORRECTION_FILES[2]!.sha256,
      SECOND_AUXILIARY_CORRECTION_BATCH_KEY,
    ],
  );
  if (deletedAudit.rowCount !== 1)
    throw new Error("错误根合同导入审计硬删除失败");
  const deletedContract = await client.query(
    `DELETE FROM contracts
     WHERE id=$1 AND root_contract_id=$1 AND relation_type='main'
       AND contract_date='2024-10-31' AND current_effective_amount=157527.78`,
    [WIRE_OBSOLETE_CONTRACT_ID],
  );
  if (deletedContract.rowCount !== 1)
    throw new Error("2024-10-31 错误根合同硬删除失败");

  for (const contractId of [DRAGON_CONTRACT_ID, WIRE_TARGET_CONTRACT_ID]) {
    const updated = await client.query<{ status: string }>(
      `UPDATE contracts SET requires_auxiliary_materials=TRUE,
         version=version+1,updated_by=$2,updated_at=$3
       WHERE id=$1 AND requires_auxiliary_materials=FALSE RETURNING status`,
      [contractId, input.actor.id, input.now],
    );
    if (updated.rowCount !== 1)
      throw new Error(`目标合同辅助材料开关更新失败：${contractId}`);
    const bucket = contractId === DRAGON_CONTRACT_ID ? "dragon" : "wire";
    const sources = SECOND_AUXILIARY_CORRECTION_FILES.filter(
      (source) => source.bucket === bucket,
    );
    const oldFileSnapshots = sources.map((source) => {
      const row = input.oldFiles.find((item) => item.id === source.oldFileId);
      if (!row) throw new Error(`删除前旧文件快照消失：${source.fileName}`);
      return row.snapshot;
    });
    const oldMappingSnapshots = sources.map((source) => {
      const row = input.oldMappings.find(
        (item) => item.source_path === source.sourcePath,
      );
      if (!row) throw new Error(`更正前源映射快照消失：${source.sourcePath}`);
      return row.snapshot;
    });
    const oldFinancialHashSnapshots =
      bucket === "dragon"
        ? input.oldFinancialHashes.map((row) => row.snapshot)
        : [];
    await client.query(
      `INSERT INTO contract_audit_logs(
         id,contract_id,action,actor_id,actor_role,from_status,to_status,
         changes_json,comment,created_at
       ) VALUES($1,$2,'historical_auxiliary_classification_corrected',$3,$4,
         $5,$5,$6::jsonb,$7,$8)`,
      [
        auditId(contractId),
        contractId,
        input.actor.id,
        input.actor.role,
        updated.rows[0]!.status,
        JSON.stringify({
          correctionKey: SECOND_AUXILIARY_CORRECTION_KEY,
          batchKey: SECOND_AUXILIARY_CORRECTION_BATCH_KEY,
          packageId: packageId(bucket),
          auxiliaryFileIds: sources.map(auxiliaryFileId),
          sourcePaths: sources.map((source) => source.sourcePath),
          sourceHashes: sources.map((source) => source.sha256),
          fileRelocations: sources.map((source) => ({
            oldContractFileId: source.oldFileId,
            auxiliaryFileId: auxiliaryFileId(source),
            fileName: source.fileName,
            sourcePath: source.sourcePath,
            oldStoredPath: source.oldStoredPath,
            newStoredPath: secondAuxiliaryCorrectionStoredPath(source),
            sha256: source.sha256,
            bytes: source.size,
            oldPhysicalFilePreserved: true,
            newPhysicalFileVerified: true,
          })),
          databaseRowsBeforeCorrection: {
            contractFiles: oldFileSnapshots,
            historicalImportMappings: oldMappingSnapshots,
            financialFileHashes: oldFinancialHashSnapshots,
          },
          removedContractId:
            bucket === "wire" ? WIRE_OBSOLETE_CONTRACT_ID : null,
          ...(bucket === "wire"
            ? {
                removedContractSnapshot: {
                  id: input.obsoleteContract.id,
                  contractNo: input.obsoleteContract.contract_no,
                  businessContractNo:
                    input.obsoleteContract.business_contract_no,
                  contractDate: input.obsoleteContract.contract_date,
                  currentAmount: Number(
                    input.obsoleteContract.current_effective_amount,
                  ),
                  status: input.obsoleteContract.status,
                  oldFileId: SECOND_AUXILIARY_CORRECTION_FILES[2]!.oldFileId,
                  oldFileHash: SECOND_AUXILIARY_CORRECTION_FILES[2]!.sha256,
                  deletedAuditId: input.obsoleteAudit.id,
                  completeContractRow: input.obsoleteContract.snapshot,
                  completeImportAuditRow: input.obsoleteAudit.snapshot,
                },
              }
            : {}),
          physicalSourceFilesPreserved: true,
        }),
        bucket === "dragon"
          ? "按用户确认将龙潭湖合同中的两份附件更正为辅助材料"
          : "按用户确认将2024-10-31合同归入2024-11-06合同辅助材料",
        input.now,
      ],
    );
  }

  const correctedSummary = buildSecondAuxiliaryCorrectedBatchSummary(
    input.oldBatchSummary,
    {
      now: input.now,
      actorId: input.actor.id,
      actorName: input.actor.name,
      target: input.target,
    },
  );
  const updatedBatch = await client.query(
    `UPDATE contract_historical_import_batches SET
       imported_contract_count=40,summary_json=$2::jsonb
     WHERE batch_key=$1 AND manifest_hash=$3 AND status='completed'
       AND imported_contract_count=41`,
    [
      SECOND_AUXILIARY_CORRECTION_BATCH_KEY,
      JSON.stringify(correctedSummary),
      SECOND_AUXILIARY_CORRECTION_MANIFEST_SHA256,
    ],
  );
  if (updatedBatch.rowCount !== 1)
    throw new Error("第二批导入摘要并发变化，已拒绝更正");
}

async function lockCorrectionScope(client: PoolClient): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `second-historical-correction:${SECOND_AUXILIARY_CORRECTION_KEY}`,
  ]);
  await client.query(
    `LOCK TABLE contracts,contract_files,contract_auxiliary_packages,
       contract_auxiliary_files,contract_financial_file_hashes,
       contract_historical_import_files,contract_historical_import_batches,
       contract_audit_logs IN SHARE ROW EXCLUSIVE MODE`,
  );
}

async function runCorrection(
  args: SecondAuxiliaryCorrectionArguments,
): Promise<Record<string, unknown>> {
  const { pool } = await import("../db/index.js");
  const client = await pool.connect();
  const copiedFiles: CopiedFile[] = [];
  let transactionFinished = false;
  let commitOutcomeUncertain = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await lockCorrectionScope(client);
    await assertTargetDatabase(client, args.target);
    const targetDatabaseSha256 =
      args.target === "production"
        ? await calculateSecondAuxiliaryCorrectionTargetDatabaseSha256(client)
        : null;
    if (targetDatabaseSha256) {
      assertSecondAuxiliaryCorrectionTargetDatabaseSha256(
        args,
        targetDatabaseSha256,
      );
    }
    const actor = await currentActor(client);
    const initialState = await readCorrectionState(client);
    let initialKind: "old" | "post";
    try {
      assertPostState(initialState, args.target, actor);
      initialKind = "post";
    } catch {
      assertOldState(initialState, args.target);
      initialKind = "old";
    }
    if (initialKind === "post") {
      for (const source of SECOND_AUXILIARY_CORRECTION_FILES) {
        await verifyPhysicalFile(
          absoluteStoredPath(secondAuxiliaryCorrectionStoredPath(source)),
          source,
          "幂等态辅助材料",
        );
      }
      await client.query("ROLLBACK");
      transactionFinished = true;
      return {
        correctionKey: SECOND_AUXILIARY_CORRECTION_KEY,
        target: args.target,
        ...(targetDatabaseSha256 ? { targetDatabaseSha256 } : {}),
        skipped: true,
        reason: "目标库已经处于完整更正态",
        physicalSourceFilesPreserved: true,
      };
    }

    await assertOldDependencies(client);
    const protectedStateBefore = await captureProtectedState(client);
    for (const source of SECOND_AUXILIARY_CORRECTION_FILES) {
      copiedFiles.push(await copyToCanonicalAuxiliaryPath(source));
    }
    const now = new Date().toISOString();
    const obsoleteContract = initialState.contracts.find(
      (row) => row.id === WIRE_OBSOLETE_CONTRACT_ID,
    );
    const obsoleteAudit = initialState.obsoleteAudits[0];
    if (!obsoleteContract || !obsoleteAudit) {
      throw new Error("错误根合同或唯一导入审计在提交前消失");
    }
    await applyDatabaseCorrection(client, {
      copiedFiles,
      actor,
      target: args.target,
      now,
      oldBatchSummary: initialState.batch.summary_json,
      obsoleteContract,
      obsoleteAudit,
      oldFiles: initialState.oldFiles,
      oldMappings: initialState.mappings,
      oldFinancialHashes: initialState.financialHashes,
    });
    const finalState = await readCorrectionState(client);
    assertPostState(finalState, args.target, actor);
    const protectedStateAfter = await captureProtectedState(client);
    if (protectedStateAfter !== protectedStateBefore) {
      throw new Error("目标合同财务、补充协议或非目标档案发生变化，已拒绝更正");
    }
    for (const copied of copiedFiles) {
      await verifyPhysicalFile(
        copied.absolutePath,
        copied.source,
        "提交前辅助材料",
      );
    }
    const result = {
      correctionKey: SECOND_AUXILIARY_CORRECTION_KEY,
      target: args.target,
      ...(targetDatabaseSha256 ? { targetDatabaseSha256 } : {}),
      dragon: { packageCount: 1, fileCount: 2 },
      wire: {
        removedRootContractId: WIRE_OBSOLETE_CONTRACT_ID,
        targetContractId: WIRE_TARGET_CONTRACT_ID,
        packageCount: 1,
        fileCount: 1,
        supplementPreserved: WIRE_SUPPLEMENT_ID,
      },
      importedContractCount: 40,
      rootContractCount: 41,
      auxiliaryFileCount: 115,
      semanticSha256: SECOND_AUXILIARY_CORRECTION_NEW_SEMANTIC_SHA256,
      physicalSourceFilesPreserved: true,
    };
    if (args.mode === "dry-run") {
      await client.query("ROLLBACK");
      transactionFinished = true;
      await cleanupNewCopies(copiedFiles);
      return { ...result, dryRunRolledBack: true };
    }
    try {
      await client.query("COMMIT");
      transactionFinished = true;
    } catch (error) {
      const code = String((error as Error & { code?: unknown }).code || "");
      if (!["40001", "40P01"].includes(code)) commitOutcomeUncertain = true;
      throw error;
    }
    return { ...result, dryRunRolledBack: false };
  } catch (error) {
    if (!transactionFinished && !commitOutcomeUncertain) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    if (!commitOutcomeUncertain) await cleanupNewCopies(copiedFiles);
    if (commitOutcomeUncertain) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}；数据库提交结果无法确认，新辅助副本已保留。禁止重试，必须先只读核验更正审计、3份映射及物理摘要`,
      );
    }
    throw error;
  } finally {
    client.release(commitOutcomeUncertain);
    await pool.end();
  }
}

function printHelp(): void {
  console.log(`第二批历史合同辅助材料归类更正

默认开发库事务预演：
  npm run contract:historical:second:correct-auxiliary

开发库提交：
  npm run contract:historical:second:correct-auxiliary -- --commit \\
    --target=development \\
    --confirm-target=${SECOND_AUXILIARY_CORRECTION_DEVELOPMENT_CONFIRMATION}

生产库事务预演：
  npm run contract:historical:second:correct-auxiliary -- \\
    --dry-run --target=production \\
    --target-database-sha256=<生产目标库身份与冻结状态摘要>

生产库提交：
  npm run contract:historical:second:correct-auxiliary -- --commit \\
    --target=production \\
    --target-database-sha256=<与预演相同的生产目标库摘要> \\
    --confirm-target=${SECOND_AUXILIARY_CORRECTION_PRODUCTION_CONFIRMATION}

安全边界：所有模式均使用 SERIALIZABLE（可串行化）事务和精确基线门禁；
生产预演和提交都必须匹配数据库系统身份、数据库 OID、用户、冻结合同及批次状态摘要；
提交前先复制到规范辅助材料目录并复核 SHA-256（安全散列算法）；
只删除3条旧数据库文件记录及错误根合同的唯一导入审计，不删除任何旧物理文件。`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    if (argv.length !== 1) throw new Error("帮助参数不能与其他参数同时使用");
    printHelp();
    return;
  }
  const args = parseSecondAuxiliaryCorrectionArguments(argv);
  assertSecondAuxiliaryCorrectionAuthorization(args);
  console.log(
    JSON.stringify(
      {
        mode: args.mode === "dry-run" ? "事务预演" : "正式提交",
        ...(await runCorrection(args)),
      },
      null,
      2,
    ),
  );
}

const invokedAsScript =
  /correct-second-historical-auxiliary-classification\.(?:ts|js)$/u.test(
    path.basename(process.argv[1] || ""),
  );
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
