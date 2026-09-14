import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";

import {
  SECOND_HISTORICAL_IMPORT_AUXILIARY_UPLOAD_ROOT,
  SECOND_HISTORICAL_IMPORT_BATCH_KEY,
  SECOND_HISTORICAL_IMPORT_DEFAULT_SOURCE_ROOT,
  SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
  SECOND_HISTORICAL_IMPORT_UPLOAD_ROOT,
  SECOND_HISTORICAL_PRODUCTION_CONFIRMATION,
  SECOND_HISTORICAL_RECEIPT_OCR_SHA256,
  SECOND_HISTORICAL_SEMANTIC_SHA256,
} from "./second-historical-import-config.js";
import {
  buildSecondHistoricalImportPlan,
  type SecondHistoricalFinancialPlan,
  type SecondHistoricalImportPlan,
  type SecondHistoricalRootPlan,
  type SecondHistoricalSourceFile,
} from "./second-historical-import-plan.js";
import type { SecondHistoricalFinancialRepairResult } from "./repair-second-historical-financial-links.js";
import {
  lockCrossModuleInvoiceNumbers,
  normalizeCrossModuleInvoiceNumber,
} from "../services/invoiceCrossModuleDeduplication.js";
import {
  calculateSecondHistoricalSemanticSha256,
  calculateSecondHistoricalTargetDatabaseSha256,
  secondHistoricalStableId as stableId,
} from "./second-historical-production-guard.js";

export interface ScriptArguments {
  mode: "dry-run" | "commit";
  target: "development" | "production";
  sourceRoot: string;
  receiptOcrPath: string | null;
  manifestSha256: string | null;
  semanticSha256: string | null;
  targetDatabaseSha256: string | null;
  productionConfirmation: string | null;
}

interface ReceiptEvidence {
  relativePath: string;
  payer?: string | null;
  payerAccount?: string | null;
  payee?: string | null;
  payeeAccount?: string | null;
  electronicReceiptNo?: string | null;
  transactionSerialNo?: string | null;
  transactionDate?: string | null;
  amount?: number | null;
  success?: boolean;
  error?: string | null;
  rawTextSha256?: string | null;
  conflicts?: string[];
}

interface CopiedFile {
  absolutePath: string;
  storedPath: string;
  created: boolean;
}

interface StoredMapping {
  contractId: string;
  contractFileId: string | null;
  auxiliaryFileId: string | null;
  targetKind: string;
  accountingIncluded: boolean;
}

interface ExistingContractSnapshot {
  id: string;
  snapshot: Record<string, unknown>;
}

interface HistoricalFileLocation {
  absoluteDirectory: string;
  absolutePath: string;
  storedPath: string;
}

interface ImportExecutionOptions {
  mode: "dry-run" | "commit";
  target: "development" | "production";
  semanticSha256: string | null;
  targetDatabaseSha256: string | null;
}

interface ImportCounts {
  contracts: number;
  contract_files: number;
  contract_auxiliary_packages: number;
  contract_auxiliary_files: number;
  contract_financial_file_hashes: number;
  contract_financial_ocr_jobs: number;
  contract_invoices: number;
  contract_receipts: number;
  contract_payments: number;
  contract_financial_registrations: number;
  contract_financial_registration_items: number;
  contract_financial_registration_matches: number;
  contract_target_amount_changes: number;
  contract_audit_logs: number;
  contract_historical_import_batches: number;
  contract_historical_import_files: number;
}

const DRAGON_CONTRACT_ID = "sdylIKVZJDN8jYQ342rOL";
const DRAGON_CONTRACT_NO = "HT-20260826-000032";
const DRAGON_REUSED_FILE_IDS = new Set([
  "ZGKPZnc8qqeG0tp04-_oM",
  "iHvxuMRbgdhCbE1tIXKi4",
]);
const DRAGON_REUSED_SOURCE_HASHES = new Set([
  "138b0537d8b37845a76500bfa63922cf32b37b815e68b2a079b9e5dee1ec5dad",
  "538c4b38b4c5312e9cb11336bdd8a0357bacc6ba9d5958dfb9d5801ae628560f",
]);
const DRAGON_LEGACY_AUXILIARY_FILES = [
  {
    id: "1wUDji9suakQ-rbnIf_hi",
    hash: "7c7b7614da23f8ff5c9cef0b9ac25d691167793f06d4658e33cb454d60155f28",
  },
  {
    id: "fQHpEgtNaTwlvdDK70tmc",
    hash: "c91afa2d6234b82fc765677fd8096404bd4461d1cae60790e24c52265c940ce6",
  },
] as const;
const DRAGON_STALE_VOID_INVOICE_HASH =
  "c91afa2d6234b82fc765677fd8096404bd4461d1cae60790e24c52265c940ce6";
const DRAGON_BASELINE_FILE_ID_BY_HASH = new Map<string, string>([
  [
    "138b0537d8b37845a76500bfa63922cf32b37b815e68b2a079b9e5dee1ec5dad",
    "iHvxuMRbgdhCbE1tIXKi4",
  ],
  [
    "538c4b38b4c5312e9cb11336bdd8a0357bacc6ba9d5958dfb9d5801ae628560f",
    "ZGKPZnc8qqeG0tp04-_oM",
  ],
  ...DRAGON_LEGACY_AUXILIARY_FILES.map(
    (file) => [file.hash, file.id] as [string, string],
  ),
]);
const DRAGON_EXISTING_INVOICE_ID = "OIS9KCPaeWfh3VPdgWIfv";
const DRAGON_EXISTING_OCR_JOB_ID = "histocr_960eec5635278a16a07b5e";
const DRAGON_EXISTING_REGISTRATION_ID = "histreg_295e8e11b78fb6d1a0c428";
const DRAGON_EXISTING_ITEM_ID = "histitem_960eec5635278a16a07b5e";
const EXPECTED_PRODUCTION_INCREMENTS: Readonly<ImportCounts> = {
  contracts: 46,
  // 新增267份合同档案，同时移除龙潭湖2份误归档附件，净增265份。
  contract_files: 265,
  contract_auxiliary_packages: 27,
  contract_auxiliary_files: 115,
  // 新增其余218条财务摘要，并移除龙潭湖作废票的1条陈旧摘要。
  contract_financial_file_hashes: 217,
  contract_financial_ocr_jobs: 218,
  contract_invoices: 121,
  contract_receipts: 36,
  contract_payments: 61,
  contract_financial_registrations: 40,
  contract_financial_registration_items: 218,
  contract_financial_registration_matches: 156,
  contract_target_amount_changes: 1,
  contract_audit_logs: 157,
  contract_historical_import_batches: 1,
  contract_historical_import_files: 384,
};

const APPLICATION_ROOT = path.resolve("/app");
const UPLOAD_BOUNDARY = path.resolve(APPLICATION_ROOT, "uploads");

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const VALUE_OPTIONS = new Set([
  "--source-root",
  "--receipt-ocr",
  "--target",
  "--manifest-sha256",
  "--semantic-sha256",
  "--target-database-sha256",
  "--confirm-production",
]);

export function parseSecondHistoricalImportArguments(
  argv: readonly string[],
): ScriptArguments {
  let dryRun = false;
  let commit = false;
  const options = new Map<string, string>();
  const seenFlags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "--dry-run" || value === "--commit") {
      if (seenFlags.has(value)) {
        throw new Error(`命令行参数重复：${value}`);
      }
      seenFlags.add(value);
      if (value === "--dry-run") dryRun = true;
      else commit = true;
      continue;
    }
    const separator = value.indexOf("=");
    const option = separator >= 0 ? value.slice(0, separator) : value;
    if (!VALUE_OPTIONS.has(option)) {
      throw new Error(`不支持的命令行参数：${value}`);
    }
    if (options.has(option)) {
      throw new Error(`命令行参数重复：${option}`);
    }
    const inlineValue = separator >= 0 ? value.slice(separator + 1) : null;
    const nextValue = inlineValue ?? argv[index + 1] ?? "";
    if (!nextValue || (inlineValue === null && nextValue.startsWith("--"))) {
      throw new Error(`命令行参数缺少值：${option}`);
    }
    options.set(option, nextValue);
    if (inlineValue === null) index += 1;
  }
  if (dryRun === commit) {
    throw new Error("必须且只能指定 --dry-run 或 --commit");
  }
  const target = options.get("--target") || "development";
  if (target !== "development" && target !== "production") {
    throw new Error("--target 只允许 development 或 production");
  }
  if (
    target === "development" &&
    (options.has("--manifest-sha256") ||
      options.has("--semantic-sha256") ||
      options.has("--target-database-sha256") ||
      options.has("--confirm-production"))
  ) {
    throw new Error("开发目标不得携带生产确认参数");
  }
  return {
    mode: commit ? "commit" : "dry-run",
    target,
    sourceRoot: path.resolve(
      options.get("--source-root") ||
        SECOND_HISTORICAL_IMPORT_DEFAULT_SOURCE_ROOT,
    ),
    receiptOcrPath: options.get("--receipt-ocr") || null,
    manifestSha256: options.get("--manifest-sha256")?.toLowerCase() || null,
    semanticSha256: options.get("--semantic-sha256")?.toLowerCase() || null,
    targetDatabaseSha256:
      options.get("--target-database-sha256")?.toLowerCase() || null,
    productionConfirmation: options.get("--confirm-production") || null,
  };
}

export function assertSecondHistoricalProductionAuthorization(
  args: ScriptArguments,
  plan: Pick<SecondHistoricalImportPlan, "manifestHash">,
  receiptOcrSha256: string | null,
  semanticSha256: string | null,
  environment: NodeJS.ProcessEnv = process.env,
  currentWorkingDirectory = process.cwd(),
): void {
  if (args.target !== "production") return;
  if (environment.NODE_ENV !== "production") {
    throw new Error("生产目标只允许在 NODE_ENV=production 的运行环境执行");
  }
  if (environment.VITE_ENABLE_WORKLOG === "true") {
    throw new Error("生产目标检测到开发容器标记，拒绝执行");
  }
  if (path.resolve(currentWorkingDirectory) !== "/app") {
    throw new Error("生产目标必须在容器 /app 工作目录执行");
  }
  if (!args.manifestSha256 || !HASH_PATTERN.test(args.manifestSha256)) {
    throw new Error("生产目标必须显式指定64位 --manifest-sha256");
  }
  if (
    args.manifestSha256 !== SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH ||
    args.manifestSha256 !== plan.manifestHash
  ) {
    throw new Error("命令行清单摘要与冻结源文件清单不一致，拒绝执行");
  }
  if (!args.semanticSha256 || !HASH_PATTERN.test(args.semanticSha256)) {
    throw new Error("生产目标必须显式指定64位 --semantic-sha256");
  }
  if (
    args.semanticSha256 !== SECOND_HISTORICAL_SEMANTIC_SHA256 ||
    args.semanticSha256 !== semanticSha256
  ) {
    throw new Error("命令行业务语义摘要与冻结语义计划不一致，拒绝执行");
  }
  if (
    !args.targetDatabaseSha256 ||
    !HASH_PATTERN.test(args.targetDatabaseSha256)
  ) {
    throw new Error("生产目标必须显式指定64位 --target-database-sha256");
  }
  if (!args.receiptOcrPath) {
    throw new Error("生产预演和提交都必须显式指定 --receipt-ocr");
  }
  if (args.mode === "commit") {
    if (
      args.productionConfirmation !== SECOND_HISTORICAL_PRODUCTION_CONFIRMATION
    ) {
      throw new Error(
        `生产提交必须显式指定 --confirm-production=${SECOND_HISTORICAL_PRODUCTION_CONFIRMATION}`,
      );
    }
  }
  if (receiptOcrSha256 !== SECOND_HISTORICAL_RECEIPT_OCR_SHA256) {
    throw new Error("回单复核文件摘要与生产冻结值不一致，拒绝执行");
  }
}

function assertFrozenProductionPlan(plan: SecondHistoricalImportPlan): void {
  const expected = {
    sourceFileCount: 384,
    rootContractCount: 41,
    restoredContractCount: 1,
    supplementCount: 6,
    terminationCount: 0,
    invoiceCount: 122,
    receiptCount: 36,
    paymentCount: 61,
    auxiliaryFileCount: 115,
    archiveFileCount: 3,
  } as const;
  for (const [key, value] of Object.entries(expected) as Array<
    [keyof typeof expected, number]
  >) {
    if (plan.summary[key] !== value) {
      throw new Error(
        `生产冻结计划计数不一致：${key}应为${value}，实际${plan.summary[key]}`,
      );
    }
  }
  if (
    plan.assignments.length !== plan.sourceFiles.length ||
    plan.manifestHash !== SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH
  ) {
    throw new Error("生产冻结计划映射或摘要不完整");
  }
}

function normalizedIdentity(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\s（）()·•,，。；;:：'"“”‘’]/gu, "")
    .replace(/有限责任公司$/u, "有限公司")
    .toLowerCase();
}

function moneyCents(value: unknown): number {
  return Math.round(Number(value || 0) * 100);
}

function expectedRootStatus(root: SecondHistoricalRootPlan): string {
  const settled = root.financialFacts
    .filter((fact) => fact.kind !== "invoice")
    .reduce((sum, fact) => sum + moneyCents(fact.amount), 0);
  if (root.agreements.some((item) => item.relationType === "termination")) {
    return "terminated";
  }
  if (root.currentAmount > 0 && settled >= moneyCents(root.currentAmount)) {
    return "completed";
  }
  return settled > 0 ? "executing" : "effective";
}

function safeFileName(file: SecondHistoricalSourceFile): string {
  const extension = file.extension.toLowerCase();
  const stem = path
    .basename(file.name, file.extension)
    .normalize("NFKC")
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/[\\/:*?"<>|]/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  return `${stem || "历史文件"}-${file.hash.slice(0, 12)}${extension}`;
}

function mimeType(file: SecondHistoricalSourceFile): string {
  const values: Record<string, string> = {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".zip": "application/zip",
  };
  const value = values[file.extension.toLowerCase()];
  if (!value) throw new Error(`无法确定文件媒体类型：${file.relativePath}`);
  return value;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function historicalFileLocation(
  file: SecondHistoricalSourceFile,
  rootKey: string,
  bucket: string,
  auxiliary: boolean,
): HistoricalFileLocation {
  const uploadRoot = path.resolve(
    auxiliary
      ? SECOND_HISTORICAL_IMPORT_AUXILIARY_UPLOAD_ROOT
      : SECOND_HISTORICAL_IMPORT_UPLOAD_ROOT,
  );
  if (!isPathInside(UPLOAD_BOUNDARY, uploadRoot)) {
    throw new Error(`历史导入上传根目录越过 /app/uploads：${uploadRoot}`);
  }
  const rootSegment = stableId("file-root", rootKey).slice(3, 13);
  const absoluteDirectory = path.resolve(
    uploadRoot,
    SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    rootSegment,
    bucket,
  );
  const absolutePath = path.resolve(absoluteDirectory, safeFileName(file));
  if (
    !isPathInside(UPLOAD_BOUNDARY, absoluteDirectory) ||
    !isPathInside(UPLOAD_BOUNDARY, absolutePath) ||
    !isPathInside(absoluteDirectory, absolutePath)
  ) {
    throw new Error(`历史导入附件目标越过 /app/uploads：${file.relativePath}`);
  }
  const storedPath = path
    .relative(APPLICATION_ROOT, absolutePath)
    .split(path.sep)
    .join("/");
  if (!storedPath.startsWith("uploads/") || storedPath.includes("../")) {
    throw new Error(`历史导入附件保存路径不安全：${file.relativePath}`);
  }
  return { absoluteDirectory, absolutePath, storedPath };
}

function storedUploadAbsolutePath(storedPath: string): string {
  const normalized = String(storedPath || "").trim();
  if (
    !normalized.startsWith("uploads/") ||
    path.isAbsolute(normalized) ||
    normalized.includes("\\") ||
    normalized.split("/").some((segment) => !segment || segment === "..")
  ) {
    throw new Error(`数据库附件保存路径不安全：${storedPath}`);
  }
  const absolutePath = path.resolve(APPLICATION_ROOT, normalized);
  if (!isPathInside(UPLOAD_BOUNDARY, absolutePath)) {
    throw new Error(`数据库附件保存路径越过 /app/uploads：${storedPath}`);
  }
  return absolutePath;
}

async function assertNoSymlinkComponents(
  root: string,
  destination: string,
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedDestination = path.resolve(destination);
  if (!isPathInside(resolvedRoot, resolvedDestination)) {
    throw new Error(`历史导入附件路径越界：${destination}`);
  }
  const rootStat = await fs.promises.lstat(resolvedRoot).catch(() => null);
  if (rootStat?.isSymbolicLink()) {
    throw new Error(`历史导入附件根目录不允许符号链接：${resolvedRoot}`);
  }
  let current = resolvedRoot;
  for (const segment of path
    .relative(resolvedRoot, resolvedDestination)
    .split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fs.promises.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) {
      throw new Error(`历史导入附件路径不允许符号链接：${current}`);
    }
  }
}

async function sha256File(filePath: string): Promise<string> {
  const digest = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return digest.digest("hex");
}

async function copyHistoricalFile(
  file: SecondHistoricalSourceFile,
  rootKey: string,
  bucket: string,
  auxiliary: boolean,
): Promise<CopiedFile> {
  const location = historicalFileLocation(file, rootKey, bucket, auxiliary);
  await assertNoSymlinkComponents(UPLOAD_BOUNDARY, location.absoluteDirectory);
  const { absoluteDirectory, absolutePath, storedPath } = location;
  await fs.promises.mkdir(absoluteDirectory, { recursive: true });
  await assertNoSymlinkComponents(UPLOAD_BOUNDARY, absoluteDirectory);
  await assertNoSymlinkComponents(UPLOAD_BOUNDARY, absolutePath);
  let created = false;
  try {
    await fs.promises.copyFile(
      file.absolutePath,
      absolutePath,
      fs.constants.COPYFILE_EXCL,
    );
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await fs.promises.lstat(absolutePath).catch(() => null);
    if (!existing?.isFile() || existing.isSymbolicLink()) {
      throw new Error(`目标附件不是普通文件：${absolutePath}`);
    }
    const existingHash = await sha256File(absolutePath);
    if (existing.size !== file.bytes || existingHash !== file.hash) {
      throw new Error(`目标文件已经存在但摘要不一致：${absolutePath}`);
    }
  }
  return { absolutePath, storedPath, created };
}

async function cleanupCopiedFiles(
  copied: readonly CopiedFile[],
): Promise<void> {
  const failures: string[] = [];
  for (const file of [...copied].reverse()) {
    if (!file.created) continue;
    await fs.promises.rm(file.absolutePath, { force: true }).catch(() => {
      failures.push(file.absolutePath);
    });
  }
  if (failures.length) {
    throw new Error(
      `本轮新建附件有${failures.length}份清理失败，必须人工核对：${failures.join("、")}`,
    );
  }
}

function readReceiptEvidence(
  filePath: string | null,
): Map<string, ReceiptEvidence> {
  if (!filePath) return new Map();
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved))
    throw new Error(`回单复核结果不存在：${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (
    parsed?.sourceManifestHash &&
    parsed.sourceManifestHash !==
      SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH
  ) {
    throw new Error("回单复核结果与当前冻结源文件清单不一致");
  }
  const records: Array<Record<string, unknown>> = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed?.records)
        ? parsed.records
        : [];
  const output = new Map<string, ReceiptEvidence>();
  for (const record of records) {
    const relativePath = String(
      record.relativePath || record.relative || "",
    ).trim();
    if (!relativePath) continue;
    if (output.has(relativePath)) {
      throw new Error(`回单复核结果存在重复路径：${relativePath}`);
    }
    const recognition =
      record.recognition && typeof record.recognition === "object"
        ? (record.recognition as Record<string, unknown>)
        : record;
    const consistency =
      record.consistency && typeof record.consistency === "object"
        ? (record.consistency as Record<string, unknown>)
        : {};
    output.set(relativePath, {
      relativePath,
      payer: String(recognition.payer || "") || null,
      payerAccount: String(recognition.payerAccount || "") || null,
      payee: String(recognition.payee || "") || null,
      payeeAccount: String(recognition.payeeAccount || "") || null,
      electronicReceiptNo:
        String(recognition.electronicReceiptNo || "") || null,
      transactionSerialNo:
        String(recognition.transactionSerialNo || "") || null,
      transactionDate: String(recognition.transactionDate || "") || null,
      amount: recognition.amount == null ? null : Number(recognition.amount),
      success:
        recognition.status === undefined ||
        recognition.status === "recognized" ||
        recognition.status === "verified",
      error: String(recognition.error || "") || null,
      rawTextSha256: String(recognition.rawTextSha256 || "") || null,
      conflicts: Array.isArray(consistency.conflicts)
        ? consistency.conflicts.map(String)
        : [],
    });
  }
  if (output.size !== 97) {
    throw new Error(`回单复核结果应为97份，实际${output.size}份`);
  }
  return output;
}

function validateReceiptEvidence(
  fact: SecondHistoricalFinancialPlan,
  evidence: ReceiptEvidence | undefined,
): void {
  if (!evidence || evidence.success === false) return;
  if (
    evidence.amount != null &&
    Number.isFinite(Number(evidence.amount)) &&
    Math.round(Number(evidence.amount) * 100) !== Math.round(fact.amount * 100)
  ) {
    throw new Error(
      `回单识别金额与已核验文件名不一致：${fact.source.relativePath}`,
    );
  }
  if (
    evidence.transactionDate &&
    evidence.transactionDate !== fact.businessDate
  ) {
    throw new Error(
      `回单识别日期与已核验日期不一致：${fact.source.relativePath}`,
    );
  }
}

async function resolveActor(
  client: PoolClient,
): Promise<{ id: string; role: string; name: string }> {
  const result = await client.query<{ id: string; role: string; name: string }>(
    `SELECT id,role,name FROM users
     WHERE name='吴静雯' AND status='active'
       AND role IN ('admin','super_admin','chairman')
     ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'super_admin' THEN 1 ELSE 2 END,
       id LIMIT 2`,
  );
  if (result.rows.length !== 1) {
    throw new Error("目标库必须且只能有一个名为吴静雯的活动管理员账号");
  }
  return result.rows[0]!;
}

async function assertTargetDatabase(
  client: PoolClient,
  target: ScriptArguments["target"],
): Promise<void> {
  if (path.resolve(process.cwd()) !== "/app") {
    throw new Error("第二批导入必须在容器 /app 工作目录执行");
  }
  if (target === "development") {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("开发目标只允许在开发运行环境执行");
    }
    if (process.env.VITE_ENABLE_WORKLOG !== "true") {
      throw new Error("开发目标缺少开发容器专用环境标记");
    }
    if (/prod(?:uction)?/iu.test(process.env.DATABASE_URL || "")) {
      throw new Error("数据库连接字符串疑似生产环境，拒绝执行开发导入");
    }
  } else {
    if (process.env.NODE_ENV !== "production") {
      throw new Error("生产目标只允许在生产运行环境执行");
    }
    if (process.env.VITE_ENABLE_WORKLOG === "true") {
      throw new Error("生产目标检测到开发容器标记，拒绝执行");
    }
  }
  const identity = await client.query<{
    database_name: string;
    user_name: string;
  }>(`SELECT current_database() AS database_name, current_user AS user_name`);
  if (identity.rows[0]?.database_name !== "yulilog_worklog") {
    throw new Error(
      `目标数据库名称不正确：${identity.rows[0]?.database_name || "未知"}`,
    );
  }
  const requiredColumns = [
    ["contracts", "party_c"],
    ["contracts", "pricing_mode"],
    ["contracts", "target_amount"],
    ["contracts", "target_quantity"],
    ["contracts", "unit_price"],
    ["contracts", "confirmed_quantity"],
    ["contracts", "confirmed_contract_amount"],
    ["contract_historical_import_batches", "manifest_hash"],
    ["contract_historical_import_files", "source_hash"],
  ];
  for (const [tableName, columnName] of requiredColumns) {
    const present = await client.query<{ present: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 AND column_name=$2
       ) AS present`,
      [tableName, columnName],
    );
    if (!present.rows[0]?.present) {
      throw new Error(`目标库尚未升级字段：${tableName}.${columnName}`);
    }
  }
}

async function snapshotExistingContracts(
  client: PoolClient,
): Promise<ExistingContractSnapshot[]> {
  const result = await client.query<ExistingContractSnapshot>(
    `SELECT id,to_jsonb(contracts.*) AS snapshot
     FROM contracts ORDER BY id`,
  );
  return result.rows;
}

function assertExistingContractsUnchanged(
  before: readonly ExistingContractSnapshot[],
  after: readonly ExistingContractSnapshot[],
  allowedContractId: string,
): void {
  const afterById = new Map(after.map((row) => [row.id, row.snapshot]));
  for (const row of before) {
    if (row.id === allowedContractId) continue;
    const current = afterById.get(row.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(row.snapshot)) {
      throw new Error(`发现本批范围外合同被改动，已回滚：${row.id}`);
    }
  }
}

async function generateContractNumber(
  client: PoolClient,
  stableKey: string,
  advanceSequence: boolean,
): Promise<string> {
  if (!advanceSequence) {
    return `HT-DRYRUN-${stableId("contract-number", stableKey).slice(3, 19)}`;
  }
  const result = await client.query<{ contract_no: string }>(
    `SELECT 'HT-' ||
       TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai','YYYYMMDD') ||
       '-' || LPAD(nextval('contract_no_sequence')::text,6,'0') AS contract_no`,
  );
  if (!result.rows[0]?.contract_no) throw new Error("生成合同系统编号失败");
  return result.rows[0].contract_no;
}

async function insertAudit(
  client: PoolClient,
  input: {
    contractId: string;
    action: string;
    actorId: string;
    actorRole: string;
    fromStatus: string | null;
    toStatus: string | null;
    changes: Record<string, unknown>;
    comment: string | null;
    now: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO contract_audit_logs(
       id,contract_id,action,actor_id,actor_role,from_status,to_status,
       changes_json,comment,created_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
    [
      stableId(
        "audit",
        `${input.contractId}:${input.action}:${input.now}:${JSON.stringify(input.changes)}`,
      ),
      input.contractId,
      input.action,
      input.actorId,
      input.actorRole,
      input.fromStatus,
      input.toStatus,
      JSON.stringify(input.changes),
      input.comment,
      input.now,
    ],
  );
}

async function insertContractFile(
  client: PoolClient,
  input: {
    contractId: string;
    fileType: string;
    source: SecondHistoricalSourceFile;
    copied: CopiedFile;
    actorId: string;
    now: string;
  },
): Promise<string> {
  const fileId = stableId(
    "contract-file",
    `${input.contractId}:${input.source.relativePath}`,
  );
  await client.query(
    `INSERT INTO contract_files(
       id,contract_id,file_type,file_name,file_path,file_size,mime_type,
       file_hash,version,is_current,uploaded_by,created_at
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,TRUE,$9,$10)`,
    [
      fileId,
      input.contractId,
      input.fileType,
      input.source.name,
      input.copied.storedPath,
      input.source.bytes,
      mimeType(input.source),
      input.source.hash,
      input.actorId,
      input.now,
    ],
  );
  return fileId;
}

async function registerFinancialHash(
  client: PoolClient,
  input: {
    source: SecondHistoricalSourceFile;
    fileId: string;
    contractId: string;
    now: string;
  },
): Promise<void> {
  const result = await client.query<{ file_id: string; contract_id: string }>(
    `SELECT file_id,contract_id FROM contract_financial_file_hashes
     WHERE file_hash=$1`,
    [input.source.hash],
  );
  if (result.rows[0]) {
    if (
      result.rows[0].file_id !== input.fileId ||
      result.rows[0].contract_id !== input.contractId
    ) {
      throw new Error(
        `财务原件摘要已被其他记录占用：${input.source.relativePath}`,
      );
    }
    return;
  }
  await client.query(
    `INSERT INTO contract_financial_file_hashes(
       file_hash,file_id,contract_id,created_at
     ) VALUES($1,$2,$3,$4)`,
    [input.source.hash, input.fileId, input.contractId, input.now],
  );
}

function companyAndCounterparty(root: SecondHistoricalRootPlan): {
  company: string;
  counterparty: string;
} {
  const parties = [
    root.family.partyA,
    root.family.partyB,
    root.family.partyC,
  ].filter((value): value is string => Boolean(value));
  const company =
    parties.find((party) => /北京羽隶(?:工程咨询|科技)有限公司/u.test(party)) ||
    root.family.partyB;
  const counterparty =
    parties.find(
      (party) => normalizedIdentity(party) !== normalizedIdentity(company),
    ) || root.family.partyA;
  return { company, counterparty };
}

function canonicalReceiptParty(
  root: SecondHistoricalRootPlan,
  recognizedValue: string | null | undefined,
  fallback: string,
): string {
  const recognized = String(recognizedValue || "").trim();
  if (!recognized) return fallback;
  const normalizedRecognized = normalizedIdentity(recognized);
  const parties = [
    root.family.partyA,
    root.family.partyB,
    root.family.partyC,
  ].filter((value): value is string => Boolean(value));
  const matched = parties.find((party) => {
    const normalizedParty = normalizedIdentity(party);
    return (
      normalizedParty === normalizedRecognized ||
      normalizedParty.startsWith(normalizedRecognized) ||
      normalizedRecognized.startsWith(normalizedParty)
    );
  });
  return matched || recognized;
}

async function insertFinancialFact(
  client: PoolClient,
  input: {
    root: SecondHistoricalRootPlan;
    fact: SecondHistoricalFinancialPlan;
    fileId: string;
    evidence: ReceiptEvidence | undefined;
    actorId: string;
    now: string;
  },
): Promise<void> {
  const { company, counterparty } = companyAndCounterparty(input.root);
  const id = stableId("financial", input.fact.source.relativePath);
  if (input.fact.kind === "invoice") {
    const seller =
      input.root.financialDirection === "income" ? company : counterparty;
    const buyer =
      input.root.financialDirection === "income" ? counterparty : company;
    await client.query(
      `INSERT INTO contract_invoices(
         id,contract_id,file_id,invoice_no,item_name,invoice_date,amount,
         tax_amount,seller,buyer,financial_ocr_job_id,deduplication_exempt,
         status,created_by,confirmed_by,confirmed_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,NULL,FALSE,'confirmed',
         $10,$10,$11,$11,$11)`,
      [
        id,
        input.root.restoreContractId || stableId("contract", input.root.key),
        input.fileId,
        input.fact.invoiceNo,
        input.root.projectName,
        input.fact.businessDate,
        input.fact.amount,
        seller,
        buyer,
        input.actorId,
        input.now,
      ],
    );
    return;
  }
  validateReceiptEvidence(input.fact, input.evidence);
  const defaultPayer =
    input.root.financialDirection === "income" ? counterparty : company;
  const defaultPayee =
    input.root.financialDirection === "income" ? company : counterparty;
  const payer = canonicalReceiptParty(
    input.root,
    input.evidence?.payer,
    defaultPayer,
  );
  const payee = canonicalReceiptParty(
    input.root,
    input.evidence?.payee,
    defaultPayee,
  );
  const rootId =
    input.root.restoreContractId || stableId("contract", input.root.key);
  const note = `第二批历史合同导入：${input.fact.source.relativePath}`;
  if (input.fact.kind === "receipt") {
    await client.query(
      `INSERT INTO contract_receipts(
         id,contract_id,file_id,receipt_date,payment_time,amount,payer,
         payer_account,payee,payee_account,currency,electronic_receipt_no,
         transaction_serial_no,note,financial_ocr_job_id,rate_snapshot_json,
         status,created_by,confirmed_by,confirmed_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'CNY',$10,$11,$12,NULL,$13::jsonb,
         'confirmed',$14,$14,$15,$15,$15)`,
      [
        id,
        rootId,
        input.fileId,
        input.fact.businessDate,
        input.fact.amount,
        payer,
        input.evidence?.payerAccount || null,
        payee,
        input.evidence?.payeeAccount || null,
        input.evidence?.electronicReceiptNo || null,
        input.evidence?.transactionSerialNo || null,
        note,
        JSON.stringify({
          tax: 0.1172,
          marketing: 0.05,
          business: 0.1,
          financial: 0.0028,
        }),
        input.actorId,
        input.now,
      ],
    );
    return;
  }
  await client.query(
    `INSERT INTO contract_payments(
       id,contract_id,file_id,payment_date,payment_time,amount,
       expense_category,payer,payer_account,payee,payee_account,
       electronic_receipt_no,transaction_serial_no,note,financial_ocr_job_id,
       status,created_by,confirmed_by,confirmed_at,created_at,updated_at
     ) VALUES($1,$2,$3,$4,$4,$5,'other',$6,$7,$8,$9,$10,$11,$12,NULL,
       'confirmed',$13,$13,$14,$14,$14)`,
    [
      id,
      rootId,
      input.fileId,
      input.fact.businessDate,
      input.fact.amount,
      payer,
      input.evidence?.payerAccount || null,
      payee,
      input.evidence?.payeeAccount || null,
      input.evidence?.electronicReceiptNo || null,
      input.evidence?.transactionSerialNo || null,
      note,
      input.actorId,
      input.now,
    ],
  );
}

async function attachHistoricalFinancialRecognition(
  client: PoolClient,
  input: {
    root: SecondHistoricalRootPlan;
    fact: SecondHistoricalFinancialPlan;
    fileId: string;
    evidence: ReceiptEvidence | undefined;
    actorId: string;
    now: string;
  },
): Promise<void> {
  const rootId =
    input.root.restoreContractId || stableId("contract", input.root.key);
  const table =
    input.fact.kind === "invoice"
      ? "contract_invoices"
      : input.fact.kind === "receipt"
        ? "contract_receipts"
        : "contract_payments";
  const record = await client.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE contract_id=$1 AND file_id=$2 LIMIT 1`,
    [rootId, input.fileId],
  );
  if (!record.rows[0]) {
    throw new Error(
      `历史财务记录未成功建立：${input.fact.source.relativePath}`,
    );
  }
  const existing = await client.query<{
    id: string;
    contract_id: string;
    file_id: string;
    record_id: string | null;
  }>(
    `SELECT id,contract_id,file_id,record_id
     FROM contract_financial_ocr_jobs WHERE file_hash=$1 LIMIT 1`,
    [input.fact.source.hash],
  );
  let jobId = existing.rows[0]?.id || null;
  if (existing.rows[0]) {
    if (
      existing.rows[0].contract_id !== rootId ||
      existing.rows[0].file_id !== input.fileId ||
      (existing.rows[0].record_id &&
        existing.rows[0].record_id !== record.rows[0].id)
    ) {
      throw new Error(
        `历史财务识别摘要已被其他记录占用：${input.fact.source.relativePath}`,
      );
    }
  } else {
    jobId = stableId("financial-ocr", input.fact.source.relativePath);
    await client.query(
      `INSERT INTO contract_financial_ocr_jobs(
         id,contract_id,file_id,file_hash,record_kind,document_kind,status,
         validation_status,retry_count,recognition_method,engine_version,
         parser_version,evidence_text_hash,direction,document_status,
         can_auto_post,snapshot_json,blocking_reasons_json,warnings_json,
         requested_by,record_id,started_at,finished_at,consumed_at,created_at,
         updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,'consumed','verified',0,
         'historical_confirmed_import','historical-source-review',
         'historical-confirmed-v1',$4,$7,'normal',TRUE,$8::jsonb,
         '[]'::jsonb,'[]'::jsonb,$9,$10,$11,$11,$11,$11,$11)`,
      [
        jobId,
        rootId,
        input.fileId,
        input.fact.source.hash,
        input.fact.kind,
        input.fact.kind === "invoice" ? "invoice" : "bank_receipt",
        input.fact.kind === "invoice"
          ? input.root.financialDirection === "income"
            ? "output"
            : "input"
          : input.fact.kind,
        JSON.stringify({
          historicalConfirmed: true,
          sourcePath: input.fact.source.relativePath,
          sourceHash: input.fact.source.hash,
          amount: input.fact.amount,
          businessDate: input.fact.businessDate,
          invoiceNo: input.fact.invoiceNo,
          receiptEvidence: input.evidence || null,
        }),
        input.actorId,
        record.rows[0].id,
        input.now,
      ],
    );
  }
  await client.query(
    `UPDATE ${table} SET financial_ocr_job_id=$2,updated_at=$3 WHERE id=$1`,
    [record.rows[0].id, jobId, input.now],
  );
}

async function insertRootContract(
  client: PoolClient,
  root: SecondHistoricalRootPlan,
  actorId: string,
  now: string,
  advanceSequence: boolean,
): Promise<string> {
  const id = stableId("contract", root.key);
  const contractNo = await generateContractNumber(
    client,
    `root:${root.key}`,
    advanceSequence,
  );
  const target = root.family.target;
  await client.query(
    `INSERT INTO contracts(
       id,contract_no,business_contract_no,title,description,
       requires_auxiliary_materials,declared_category,declared_subtype,
       category,asset_category,relation_type,status,area,project_id,
       parent_contract_id,root_contract_id,party_a,party_b,party_c,project_name,
       amount_delta,original_contract_amount,current_effective_amount,
       pricing_mode,target_amount,target_quantity,unit_price,
       confirmed_quantity,confirmed_contract_amount,quantity_unit,
       contract_date,contract_date_source,financial_direction,
       financial_direction_source,financial_direction_version,
       asset_funding_mode,version,created_by,updated_by,sealed_at,effective_at,
       created_at,updated_at,is_deleted
     ) VALUES(
       $1,$2,$3,$4,$5,$6,$7,$8,$7,$9,'main','effective',$10,NULL,
       NULL,$1,$11,$12,$13,$4,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
       $24,'manual',$25,'contract_category',1,$26,1,$27,$27,$28,$28,$28,$28,FALSE
     )`,
    [
      id,
      contractNo,
      root.businessContractNo,
      root.projectName,
      `第二批历史合同导入；源目录：${root.family.directory}`,
      root.auxiliaryFiles.length > 0,
      root.family.category,
      root.family.declaredSubtype,
      root.family.category === "asset" ? "procurement" : null,
      root.family.area,
      root.family.partyA,
      root.family.partyB,
      root.family.partyC || null,
      root.currentAmount,
      root.originalAmount,
      root.currentAmount,
      target ? "target" : "fixed",
      target?.amount || null,
      target?.quantity || null,
      target?.unitPrice || null,
      target?.confirmedQuantity || null,
      target?.confirmedAmount || null,
      target?.quantityUnit || null,
      root.contractDate,
      root.financialDirection,
      root.family.category === "asset" ? "engineering_direct" : null,
      actorId,
      now,
    ],
  );
  if (target) {
    await client.query(
      `INSERT INTO contract_target_amount_changes(
         id,contract_id,change_no,change_type,old_target_amount,
         new_target_amount,old_target_quantity,new_target_quantity,
         old_unit_price,new_unit_price,reason,changed_by,changed_at
       ) VALUES($1,$2,0,'initial',NULL,$3,NULL,$4,NULL,$5,$6,$7,$8)`,
      [
        stableId("target-change", root.key),
        id,
        target.amount,
        target.quantity,
        target.unitPrice,
        "第二批历史合同导入：合同约定按实际办理数量结算，初始目标996套",
        actorId,
        now,
      ],
    );
  }
  return id;
}

async function restoreDragonContract(
  client: PoolClient,
  root: SecondHistoricalRootPlan,
  actor: { id: string; role: string },
  now: string,
): Promise<string> {
  const id = root.restoreContractId!;
  const locked = await client.query<Record<string, unknown>>(
    `SELECT * FROM contracts WHERE id=$1 FOR UPDATE`,
    [id],
  );
  const current = locked.rows[0];
  if (!current) throw new Error("目标库中未找到需要恢复的龙潭湖合同");
  if (
    normalizedIdentity(current.project_name) !==
      normalizedIdentity(root.projectName) ||
    normalizedIdentity(current.party_a) !==
      normalizedIdentity(root.family.partyA) ||
    normalizedIdentity(current.party_b) !==
      normalizedIdentity(root.family.partyB) ||
    Number(current.current_effective_amount) !== root.currentAmount ||
    String(current.contract_date || "") !== root.contractDate
  ) {
    throw new Error("龙潭湖原记录与本批确认信息不一致，拒绝覆盖恢复");
  }
  const fromDeleted = Boolean(current.is_deleted);
  await client.query(
    `UPDATE contracts SET is_deleted=FALSE,deleted_at=NULL,status='effective',
       requires_auxiliary_materials=TRUE,
       updated_by=$2,updated_at=$3,version=version+1
     WHERE id=$1`,
    [id, actor.id, now],
  );
  await insertAudit(client, {
    contractId: id,
    action: "historical_contract_restored",
    actorId: actor.id,
    actorRole: actor.role,
    fromStatus: String(current.status || "executing"),
    toStatus: "effective",
    changes: {
      batchKey: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
      familyId: root.family.id,
      restoredFromDeleted: fromDeleted,
      sourceFolder: root.family.directory,
    },
    comment: "按用户指示恢复龙潭湖-弘善110kv线路工程建设项目合同",
    now,
  });
  return id;
}

async function insertAgreement(
  client: PoolClient,
  input: {
    root: SecondHistoricalRootPlan;
    rootId: string;
    agreement: SecondHistoricalRootPlan["agreements"][number];
    actorId: string;
    actorRole: string;
    now: string;
    advanceSequence: boolean;
  },
): Promise<string> {
  const agreement = input.agreement;
  const id = stableId("agreement", agreement.source.relativePath);
  const contractNo = await generateContractNumber(
    client,
    `agreement:${agreement.source.relativePath}`,
    input.advanceSequence,
  );
  const title =
    agreement.relationType === "supplement"
      ? `${input.root.projectName}补充协议（${agreement.sequence}）`
      : `${input.root.projectName.replace(/(?:合同|协议书?)$/u, "")}解除协议书`;
  await client.query(
    `INSERT INTO contracts(
       id,contract_no,business_contract_no,title,description,
       requires_auxiliary_materials,declared_category,declared_subtype,
       category,asset_category,relation_type,status,area,project_id,
       parent_contract_id,root_contract_id,termination_target_contract_id,
       party_a,party_b,party_c,project_name,amount_delta,amount_before_change,
       amount_after_change,supplement_change_type,supplement_sequence,
       contract_date,contract_date_source,financial_direction,
       financial_direction_source,financial_direction_version,
       asset_funding_mode,pricing_mode,version,created_by,updated_by,
       sealed_at,effective_at,created_at,updated_at,is_deleted
     ) SELECT
       $1,$2,NULL,$3,$4,FALSE,root.declared_category,root.declared_subtype,
       root.category,root.asset_category,$5,'effective',root.area,NULL,
       root.id,root.id,$6,root.party_a,root.party_b,root.party_c,$3,$7,$8,$9,
       $10,$11,$12,'manual',root.financial_direction,'contract_category',1,
       root.asset_funding_mode,'fixed',1,$13,$13,$14,$14,$14,$14,FALSE
     FROM contracts root WHERE root.id=$15`,
    [
      id,
      contractNo,
      title,
      `第二批历史合同导入；源文件：${agreement.source.relativePath}`,
      agreement.relationType,
      agreement.relationType === "termination" ? input.rootId : null,
      agreement.amountDelta,
      agreement.amountBefore,
      agreement.amountAfter,
      agreement.relationType === "supplement" ? "amount_adjustment" : null,
      agreement.sequence,
      agreement.contractDate,
      input.actorId,
      input.now,
      input.rootId,
    ],
  );
  await insertAudit(client, {
    contractId: id,
    action:
      agreement.relationType === "supplement"
        ? "historical_supplement_imported"
        : "historical_termination_imported",
    actorId: input.actorId,
    actorRole: input.actorRole,
    fromStatus: null,
    toStatus: "effective",
    changes: {
      batchKey: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
      familyId: input.root.family.id,
      rootId: input.rootId,
      sequence: agreement.sequence,
      amountBefore: agreement.amountBefore,
      amountDelta: agreement.amountDelta,
      amountAfter: agreement.amountAfter,
      sourcePath: agreement.source.relativePath,
    },
    comment: "第二批历史关联协议导入",
    now: input.now,
  });
  return id;
}

async function existingDragonFile(
  client: PoolClient,
  contractId: string,
  file: SecondHistoricalSourceFile,
): Promise<{ id: string } | null> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM contract_files WHERE contract_id=$1 AND file_hash=$2 LIMIT 1`,
    [contractId, file.hash],
  );
  return result.rows[0] || null;
}

async function ensureContractFile(
  client: PoolClient,
  input: {
    root: SecondHistoricalRootPlan;
    contractId: string;
    fileType: string;
    source: SecondHistoricalSourceFile;
    bucket: string;
    actorId: string;
    now: string;
    copiedFiles: CopiedFile[];
  },
): Promise<string> {
  if (input.root.restoreContractId) {
    const existing = await existingDragonFile(
      client,
      input.contractId,
      input.source,
    );
    if (existing) return existing.id;
  }
  const copied = await copyHistoricalFile(
    input.source,
    input.root.key,
    input.bucket,
    false,
  );
  input.copiedFiles.push(copied);
  return insertContractFile(client, {
    contractId: input.contractId,
    fileType: input.fileType,
    source: input.source,
    copied,
    actorId: input.actorId,
    now: input.now,
  });
}

function auxiliaryKind(
  file: SecondHistoricalSourceFile,
): "contract" | "invoice" | "receipt" | "other" {
  if (
    file.kind === "main" ||
    file.kind === "supplement" ||
    file.kind === "termination"
  )
    return "contract";
  if (file.kind === "invoice" || file.kind === "void_invoice") return "invoice";
  if (file.kind === "settlement") return "receipt";
  return "other";
}

function auxiliaryGroups(
  files: readonly SecondHistoricalSourceFile[],
): SecondHistoricalSourceFile[][] {
  const byDirectory = new Map<string, SecondHistoricalSourceFile[]>();
  for (const file of files) {
    const current = byDirectory.get(file.directory) || [];
    current.push(file);
    byDirectory.set(file.directory, current);
  }
  const groups: SecondHistoricalSourceFile[][] = [];
  for (const filesInDirectory of [...byDirectory.values()].sort((left, right) =>
    left[0]!.directory.localeCompare(right[0]!.directory, "zh-CN"),
  )) {
    for (let offset = 0; offset < filesInDirectory.length; offset += 20) {
      groups.push(filesInDirectory.slice(offset, offset + 20));
    }
  }
  return groups;
}

async function insertAuxiliaryFiles(
  client: PoolClient,
  input: {
    root: SecondHistoricalRootPlan;
    rootId: string;
    actorId: string;
    actorRole: string;
    now: string;
    copiedFiles: CopiedFile[];
    mappings: Map<string, StoredMapping>;
  },
): Promise<void> {
  for (const [groupIndex, group] of auxiliaryGroups(
    input.root.auxiliaryFiles,
  ).entries()) {
    const packageId = stableId(
      "auxiliary-package",
      `${input.root.key}:${groupIndex}`,
    );
    await client.query(
      `INSERT INTO contract_auxiliary_packages(
         id,parent_contract_id,note,status,ocr_fields_json,ocr_lines_json,
         warnings_json,retry_count,version,accounting_included,created_by,
         updated_by,created_at,updated_at
       ) VALUES($1,$2,$3,'succeeded','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
         0,1,FALSE,$4,$4,$5,$5)`,
      [
        packageId,
        input.rootId,
        `第二批历史辅助材料：${group[0]!.directory}`,
        input.actorId,
        input.now,
      ],
    );
    for (const source of group) {
      const copied = await copyHistoricalFile(
        source,
        input.root.key,
        `package-${groupIndex + 1}`,
        true,
      );
      input.copiedFiles.push(copied);
      const fileId = stableId("auxiliary-file", source.relativePath);
      await client.query(
        `INSERT INTO contract_auxiliary_files(
           id,package_id,file_kind,file_name,file_path,file_size,mime_type,
           file_hash,version,is_current,uploaded_by,created_at
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,TRUE,$9,$10)`,
        [
          fileId,
          packageId,
          auxiliaryKind(source),
          source.name,
          copied.storedPath,
          source.bytes,
          mimeType(source),
          source.hash,
          input.actorId,
          input.now,
        ],
      );
      input.mappings.set(source.relativePath, {
        contractId: input.rootId,
        contractFileId: null,
        auxiliaryFileId: fileId,
        targetKind: "auxiliary",
        accountingIncluded: false,
      });
    }
    await insertAudit(client, {
      contractId: input.rootId,
      action: "auxiliary_package_created",
      actorId: input.actorId,
      actorRole: input.actorRole,
      fromStatus: "effective",
      toStatus: "effective",
      changes: {
        batchKey: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
        packageId,
        fileCount: group.length,
        sourceDirectory: group[0]!.directory,
        accountingIncluded: false,
      },
      comment: "第二批历史辅助材料归档",
      now: input.now,
    });
  }
}

interface PlannedFileWrite {
  source: SecondHistoricalSourceFile;
  rootKey: string;
  bucket: string;
  auxiliary: boolean;
  tableName: "contract_files" | "contract_auxiliary_files";
  recordId: string;
}

function plannedFileWrites(
  plan: SecondHistoricalImportPlan,
  reusedSourcePaths: ReadonlySet<string>,
): { files: PlannedFileWrite[]; auxiliaryPackageIds: string[] } {
  const files: PlannedFileWrite[] = [];
  const auxiliaryPackageIds: string[] = [];
  const addContractFile = (
    root: SecondHistoricalRootPlan,
    contractId: string,
    source: SecondHistoricalSourceFile,
    bucket: string,
  ) => {
    if (reusedSourcePaths.has(source.relativePath)) return;
    files.push({
      source,
      rootKey: root.key,
      bucket,
      auxiliary: false,
      tableName: "contract_files",
      recordId: stableId(
        "contract-file",
        `${contractId}:${source.relativePath}`,
      ),
    });
  };
  for (const root of plan.roots) {
    const rootId = root.restoreContractId || stableId("contract", root.key);
    addContractFile(root, rootId, root.source, "root");
    for (const agreement of root.agreements) {
      const agreementId = stableId("agreement", agreement.source.relativePath);
      addContractFile(
        root,
        agreementId,
        agreement.source,
        `agreement-${agreement.sequence || "termination"}`,
      );
    }
    for (const source of root.archiveFiles) {
      addContractFile(root, rootId, source, "archive");
    }
    for (const fact of root.financialFacts) {
      addContractFile(root, rootId, fact.source, "financial");
    }
    const pendingAuxiliary = root.auxiliaryFiles.filter(
      (source) => !reusedSourcePaths.has(source.relativePath),
    );
    for (const [groupIndex, group] of auxiliaryGroups(
      pendingAuxiliary,
    ).entries()) {
      auxiliaryPackageIds.push(
        stableId("auxiliary-package", `${root.key}:${groupIndex}`),
      );
      for (const source of group) {
        files.push({
          source,
          rootKey: root.key,
          bucket: `package-${groupIndex + 1}`,
          auxiliary: true,
          tableName: "contract_auxiliary_files",
          recordId: stableId("auxiliary-file", source.relativePath),
        });
      }
    }
  }
  return { files, auxiliaryPackageIds };
}

async function verifyPhysicalFile(
  absolutePath: string,
  source: SecondHistoricalSourceFile,
  label: string,
): Promise<void> {
  await assertNoSymlinkComponents(UPLOAD_BOUNDARY, absolutePath);
  const stat = await fs.promises.lstat(absolutePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}不是普通文件：${source.relativePath}`);
  }
  if (
    stat.size !== source.bytes ||
    (await sha256File(absolutePath)) !== source.hash
  ) {
    throw new Error(`${label}大小或摘要不一致：${source.relativePath}`);
  }
}

async function assertDragonLegacyAuxiliaryFilesCanMove(
  client: PoolClient,
  lock: "share" | "update",
): Promise<void> {
  const legacyIds = DRAGON_LEGACY_AUXILIARY_FILES.map((file) => file.id);
  const files = await client.query<{ id: string; file_hash: string }>(
    `SELECT id,file_hash FROM contract_files
      WHERE contract_id=$1 AND id=ANY($2::text[])
      ORDER BY id FOR ${lock === "update" ? "UPDATE" : "SHARE"}`,
    [DRAGON_CONTRACT_ID, legacyIds],
  );
  const expectedById = new Map<string, string>(
    DRAGON_LEGACY_AUXILIARY_FILES.map((file) => [file.id, file.hash]),
  );
  if (
    files.rows.length !== DRAGON_LEGACY_AUXILIARY_FILES.length ||
    files.rows.some((file) => expectedById.get(file.id) !== file.file_hash)
  ) {
    throw new Error("生产龙潭湖待迁辅助材料的既有档案编号或摘要不一致");
  }

  const staleRegistry = await client.query<{
    file_hash: string;
    file_id: string;
    contract_id: string;
  }>(
    `SELECT file_hash,file_id,contract_id
       FROM contract_financial_file_hashes
      WHERE file_id=ANY($1::text[])
      ORDER BY file_id FOR ${lock === "update" ? "UPDATE" : "SHARE"}`,
    [legacyIds],
  );
  const staleVoidFile = DRAGON_LEGACY_AUXILIARY_FILES.find(
    (file) => file.hash === DRAGON_STALE_VOID_INVOICE_HASH,
  )!;
  if (
    staleRegistry.rows.length !== 1 ||
    staleRegistry.rows[0]?.file_hash !== DRAGON_STALE_VOID_INVOICE_HASH ||
    staleRegistry.rows[0]?.file_id !== staleVoidFile.id ||
    staleRegistry.rows[0]?.contract_id !== DRAGON_CONTRACT_ID
  ) {
    throw new Error("生产龙潭湖作废票陈旧财务摘要基线不一致");
  }

  const references = await client.query<{ count: number }>(
    `SELECT (
       (SELECT COUNT(*) FROM contract_seal_applications
         WHERE signed_file_id=ANY($1::text[]) OR approved_file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_download_request_files
         WHERE contract_file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_historical_import_files
         WHERE contract_file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_ocr_jobs WHERE file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_financial_ocr_jobs
         WHERE file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_seal_verifications
         WHERE file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_invoices WHERE file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_receipts WHERE file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_payments WHERE file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_external_payments
         WHERE file_id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_deposit_settlement_receipts
         WHERE file_id=ANY($1::text[]))
     )::int AS count`,
    [legacyIds],
  );
  if (Number(references.rows[0]?.count || 0) !== 0) {
    throw new Error("生产龙潭湖待迁辅助材料仍被其他业务记录引用");
  }
}

async function removeDragonLegacyAuxiliaryContractFiles(
  client: PoolClient,
  plan: SecondHistoricalImportPlan,
): Promise<void> {
  const dragon = plan.roots.find(
    (root) => root.restoreContractId === DRAGON_CONTRACT_ID,
  );
  if (!dragon) throw new Error("冻结清单缺少龙潭湖恢复合同");
  const expectedAuxiliaryHashes = new Set<string>(
    DRAGON_LEGACY_AUXILIARY_FILES.map((file) => file.hash),
  );
  if (
    dragon.auxiliaryFiles.length !== DRAGON_LEGACY_AUXILIARY_FILES.length ||
    dragon.auxiliaryFiles.some(
      (file) => !expectedAuxiliaryHashes.has(file.hash),
    )
  ) {
    throw new Error("龙潭湖两份待迁文件未被完整规划为辅助材料");
  }
  await assertDragonLegacyAuxiliaryFilesCanMove(client, "update");
  const staleVoidFile = DRAGON_LEGACY_AUXILIARY_FILES.find(
    (file) => file.hash === DRAGON_STALE_VOID_INVOICE_HASH,
  )!;
  const removedRegistry = await client.query<{ file_hash: string }>(
    `DELETE FROM contract_financial_file_hashes
      WHERE file_hash=$1 AND file_id=$2 AND contract_id=$3
      RETURNING file_hash`,
    [DRAGON_STALE_VOID_INVOICE_HASH, staleVoidFile.id, DRAGON_CONTRACT_ID],
  );
  if (removedRegistry.rows.length !== 1) {
    throw new Error("龙潭湖作废票陈旧财务摘要没有被精确移除");
  }
  const removedFiles = await client.query<{ id: string }>(
    `DELETE FROM contract_files
      WHERE contract_id=$1 AND (
        (id=$2 AND file_hash=$3) OR (id=$4 AND file_hash=$5)
      ) RETURNING id`,
    [
      DRAGON_CONTRACT_ID,
      DRAGON_LEGACY_AUXILIARY_FILES[0].id,
      DRAGON_LEGACY_AUXILIARY_FILES[0].hash,
      DRAGON_LEGACY_AUXILIARY_FILES[1].id,
      DRAGON_LEGACY_AUXILIARY_FILES[1].hash,
    ],
  );
  const removedFileIds = new Set(removedFiles.rows.map((row) => row.id));
  if (
    removedFiles.rows.length !== DRAGON_LEGACY_AUXILIARY_FILES.length ||
    DRAGON_LEGACY_AUXILIARY_FILES.some((file) => !removedFileIds.has(file.id))
  ) {
    throw new Error("龙潭湖两份误归档合同附件没有被精确移除");
  }
}

async function assertDragonLegacyAuxiliaryMigrationCompleted(
  client: PoolClient,
): Promise<void> {
  const legacyIds = DRAGON_LEGACY_AUXILIARY_FILES.map((file) => file.id);
  const stale = await client.query<{ count: number }>(
    `SELECT (
       (SELECT COUNT(*) FROM contract_files WHERE id=ANY($1::text[])) +
       (SELECT COUNT(*) FROM contract_financial_file_hashes
         WHERE file_hash=$2 OR file_id=ANY($1::text[]))
     )::int AS count`,
    [legacyIds, DRAGON_STALE_VOID_INVOICE_HASH],
  );
  if (Number(stale.rows[0]?.count || 0) !== 0) {
    throw new Error("龙潭湖误归档附件或作废票陈旧财务摘要仍然存在");
  }
}

async function assertDragonProductionBaseline(
  client: PoolClient,
  plan: SecondHistoricalImportPlan,
): Promise<Set<string>> {
  const dragon = plan.roots.find(
    (root) => root.restoreContractId === DRAGON_CONTRACT_ID,
  );
  if (!dragon) throw new Error("冻结清单缺少龙潭湖恢复合同");
  const contract = await client.query<Record<string, unknown>>(
    `SELECT * FROM contracts WHERE id=$1 FOR SHARE`,
    [DRAGON_CONTRACT_ID],
  );
  const row = contract.rows[0];
  if (
    !row ||
    row.contract_no !== DRAGON_CONTRACT_NO ||
    row.relation_type !== "main" ||
    row.root_contract_id !== DRAGON_CONTRACT_ID ||
    normalizedIdentity(row.project_name) !==
      normalizedIdentity(dragon.projectName) ||
    normalizedIdentity(row.party_a) !==
      normalizedIdentity(dragon.family.partyA) ||
    normalizedIdentity(row.party_b) !==
      normalizedIdentity(dragon.family.partyB) ||
    Number(row.current_effective_amount) !== dragon.currentAmount ||
    String(row.contract_date || "") !== dragon.contractDate
  ) {
    throw new Error("生产龙潭湖基线合同与冻结值不一致，拒绝导入");
  }
  const sources = [
    dragon.source,
    ...dragon.financialFacts.map((fact) => fact.source),
    ...dragon.archiveFiles,
    ...dragon.auxiliaryFiles,
  ];
  const sourceByHash = new Map(sources.map((source) => [source.hash, source]));
  const files = await client.query<{
    id: string;
    file_hash: string;
    file_path: string;
    file_size: number | string;
  }>(
    `SELECT id,file_hash,file_path,file_size FROM contract_files
      WHERE contract_id=$1 AND file_hash=ANY($2::text[])
      ORDER BY id`,
    [DRAGON_CONTRACT_ID, [...sourceByHash.keys()]],
  );
  if (files.rows.length !== DRAGON_BASELINE_FILE_ID_BY_HASH.size) {
    throw new Error(
      `生产龙潭湖基线必须恰好定位4份既有文件，实际${files.rows.length}份`,
    );
  }
  if (
    files.rows.some(
      (file) => DRAGON_BASELINE_FILE_ID_BY_HASH.get(file.file_hash) !== file.id,
    ) ||
    new Set(files.rows.map((file) => file.id)).size !==
      DRAGON_BASELINE_FILE_ID_BY_HASH.size ||
    new Set(files.rows.map((file) => file.file_hash)).size !==
      DRAGON_BASELINE_FILE_ID_BY_HASH.size
  ) {
    throw new Error("生产龙潭湖4份既有文件编号或冻结摘要集合不一致");
  }
  const reused = new Set<string>();
  for (const file of files.rows) {
    const source = sourceByHash.get(file.file_hash);
    if (!source || Number(file.file_size) !== source.bytes) {
      throw new Error("生产龙潭湖复用文件的数据库摘要或大小不一致");
    }
    const absolutePath = storedUploadAbsolutePath(file.file_path);
    await verifyPhysicalFile(absolutePath, source, "生产龙潭湖复用文件");
    if (
      DRAGON_REUSED_FILE_IDS.has(file.id) &&
      DRAGON_REUSED_SOURCE_HASHES.has(file.file_hash)
    ) {
      reused.add(source.relativePath);
    }
  }
  if (reused.size !== 2) {
    throw new Error("生产龙潭湖主合同与有效发票没有一一对应冻结源文件");
  }
  await assertDragonLegacyAuxiliaryFilesCanMove(client, "share");
  const invoice = await client.query<{
    invoice_id: string;
    invoice_no: string;
    amount: string | number;
    ocr_job_id: string;
    file_hash: string;
    registry_contract_id: string | null;
  }>(
    `SELECT invoice.id AS invoice_id,invoice.invoice_no,invoice.amount,
       invoice.financial_ocr_job_id AS ocr_job_id,file.file_hash,
       registry.contract_id AS registry_contract_id
       FROM contract_invoices invoice
       JOIN contract_files file ON file.id=invoice.file_id
       LEFT JOIN contract_financial_file_hashes registry
         ON registry.file_hash=file.file_hash AND registry.file_id=file.id
      WHERE invoice.contract_id=$1 AND invoice.id=$2`,
    [DRAGON_CONTRACT_ID, DRAGON_EXISTING_INVOICE_ID],
  );
  const existingInvoice = invoice.rows[0];
  if (
    invoice.rows.length !== 1 ||
    existingInvoice?.invoice_no !== "03024845" ||
    moneyCents(existingInvoice?.amount) !== 1_584_000 ||
    existingInvoice?.ocr_job_id !== DRAGON_EXISTING_OCR_JOB_ID ||
    existingInvoice?.file_hash !==
      "538c4b38b4c5312e9cb11336bdd8a0357bacc6ba9d5958dfb9d5801ae628560f" ||
    existingInvoice?.registry_contract_id !== DRAGON_CONTRACT_ID
  ) {
    throw new Error("生产龙潭湖既有发票、识别任务或财务摘要基线不一致");
  }
  const registration = await client.query<{
    registration_id: string;
    item_id: string;
    record_id: string;
    item_kind: string;
  }>(
    `SELECT registration.id AS registration_id,item.id AS item_id,
       item.record_id,item.item_kind
       FROM contract_financial_registrations registration
       JOIN contract_financial_registration_items item
         ON item.registration_id=registration.id
      WHERE registration.contract_id=$1 AND registration.status<>'reversed'`,
    [DRAGON_CONTRACT_ID],
  );
  if (
    registration.rows.length !== 1 ||
    registration.rows[0]?.registration_id !== DRAGON_EXISTING_REGISTRATION_ID ||
    registration.rows[0]?.item_id !== DRAGON_EXISTING_ITEM_ID ||
    registration.rows[0]?.record_id !== DRAGON_EXISTING_INVOICE_ID ||
    registration.rows[0]?.item_kind !== "invoice"
  ) {
    throw new Error("生产龙潭湖既有财务登记或明细基线不一致");
  }
  return reused;
}

async function assertStableIdAvailability(
  client: PoolClient,
  plan: SecondHistoricalImportPlan,
  reusedSourcePaths: ReadonlySet<string>,
): Promise<void> {
  const planned = plannedFileWrites(plan, reusedSourcePaths);
  const idsByTable = new Map<string, Set<string>>([
    ["contracts", new Set<string>()],
    ["contract_files", new Set<string>()],
    ["contract_auxiliary_packages", new Set<string>()],
    ["contract_auxiliary_files", new Set<string>()],
    ["contract_invoices", new Set<string>()],
    ["contract_receipts", new Set<string>()],
    ["contract_payments", new Set<string>()],
    ["contract_financial_ocr_jobs", new Set<string>()],
    ["contract_financial_registrations", new Set<string>()],
    ["contract_financial_registration_items", new Set<string>()],
    ["contract_target_amount_changes", new Set<string>()],
  ]);
  for (const root of plan.roots) {
    const rootId = root.restoreContractId || stableId("contract", root.key);
    if (!root.restoreContractId) idsByTable.get("contracts")!.add(rootId);
    for (const agreement of root.agreements) {
      idsByTable
        .get("contracts")!
        .add(stableId("agreement", agreement.source.relativePath));
    }
    for (const fact of root.financialFacts) {
      const financialRecordId = stableId("financial", fact.source.relativePath);
      idsByTable
        .get(
          fact.kind === "invoice"
            ? "contract_invoices"
            : fact.kind === "receipt"
              ? "contract_receipts"
              : "contract_payments",
        )!
        .add(financialRecordId);
      idsByTable
        .get("contract_financial_ocr_jobs")!
        .add(stableId("financial-ocr", fact.source.relativePath));
      idsByTable
        .get("contract_financial_registration_items")!
        .add(
          stableId(
            "financial-registration-item",
            `${rootId}:${fact.kind}:${financialRecordId}`,
          ),
        );
    }
    if (root.financialFacts.length && !root.restoreContractId) {
      idsByTable
        .get("contract_financial_registrations")!
        .add(stableId("financial-registration", rootId));
    }
    if (root.family.target) {
      idsByTable
        .get("contract_target_amount_changes")!
        .add(stableId("target-change", root.key));
    }
  }
  for (const file of planned.files) {
    idsByTable.get(file.tableName)!.add(file.recordId);
  }
  for (const id of planned.auxiliaryPackageIds) {
    idsByTable.get("contract_auxiliary_packages")!.add(id);
  }
  for (const [tableName, ids] of idsByTable) {
    if (!ids.size) continue;
    const conflict = await client.query<{ id: string }>(
      `SELECT id FROM ${tableName} WHERE id=ANY($1::text[]) LIMIT 1`,
      [[...ids]],
    );
    if (conflict.rows[0]) {
      throw new Error(
        `生产目标存在第二批稳定编号冲突：${tableName}.${conflict.rows[0].id}`,
      );
    }
  }
}

async function assertPlannedFileTargets(
  client: PoolClient,
  plan: SecondHistoricalImportPlan,
  reusedSourcePaths: ReadonlySet<string>,
): Promise<void> {
  const planned = plannedFileWrites(plan, reusedSourcePaths);
  const byStoredPath = new Map<
    string,
    { source: SecondHistoricalSourceFile; absolutePath: string }
  >();
  for (const file of planned.files) {
    const location = historicalFileLocation(
      file.source,
      file.rootKey,
      file.bucket,
      file.auxiliary,
    );
    const existingPlan = byStoredPath.get(location.storedPath);
    if (existingPlan) {
      throw new Error(
        `第二批多份源文件生成相同附件路径：${existingPlan.source.relativePath}、${file.source.relativePath}`,
      );
    }
    byStoredPath.set(location.storedPath, {
      source: file.source,
      absolutePath: location.absolutePath,
    });
    await assertNoSymlinkComponents(UPLOAD_BOUNDARY, location.absolutePath);
    const existing = await fs.promises
      .lstat(location.absolutePath)
      .catch(() => null);
    if (existing) {
      await verifyPhysicalFile(
        location.absolutePath,
        file.source,
        "生产附件目标",
      );
    }
  }
  const storedPaths = [...byStoredPath.keys()];
  if (storedPaths.length) {
    const conflict = await client.query<{
      source: string;
      id: string;
      file_path: string;
    }>(
      `SELECT 'contract_files'::text AS source,id,file_path
         FROM contract_files WHERE file_path=ANY($1::text[])
       UNION ALL
       SELECT 'contract_auxiliary_files'::text AS source,id,file_path
         FROM contract_auxiliary_files WHERE file_path=ANY($1::text[])
       LIMIT 1`,
      [storedPaths],
    );
    if (conflict.rows[0]) {
      throw new Error(
        `生产附件保存路径已被数据库记录占用：${conflict.rows[0].source}.${conflict.rows[0].id}`,
      );
    }
  }
}

async function assertProductionCrossModuleConflicts(
  client: PoolClient,
  plan: SecondHistoricalImportPlan,
  receiptEvidence: ReadonlyMap<string, ReceiptEvidence>,
): Promise<void> {
  const invoiceNumbers = [
    ...new Set(
      plan.roots
        .flatMap((root) => root.financialFacts)
        .filter((fact) => fact.kind === "invoice")
        .map((fact) => normalizeCrossModuleInvoiceNumber(fact.invoiceNo))
        .filter(Boolean),
    ),
  ];
  await lockCrossModuleInvoiceNumbers(client, invoiceNumbers);
  if (invoiceNumbers.length) {
    const duplicate = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT invoice.id
           FROM reimbursement_invoices invoice
           JOIN reimbursements reimbursement
             ON reimbursement.id=invoice.reimbursement_id
          WHERE invoice.invoice_number IS NOT NULL
            AND SPLIT_PART(invoice.file_path,'/',-1) NOT LIKE 'receipt-%'
            AND UPPER(invoice.invoice_number) NOT LIKE 'RECEIPT-%'
            AND reimbursement.status<>'rejected'
            AND COALESCE(reimbursement.is_deleted,FALSE)=FALSE
            AND UPPER(REGEXP_REPLACE(
              NORMALIZE(BTRIM(invoice.invoice_number),NFKC),
              '[^A-Za-z0-9]','','g'
            ))=ANY($1::text[])
         UNION ALL
         SELECT deduction.id
           FROM reimbursement_deduction_invoices deduction
           JOIN reimbursements reimbursement
             ON reimbursement.id=deduction.reimbursement_id
          WHERE deduction.invoice_number IS NOT NULL
            AND reimbursement.status<>'rejected'
            AND COALESCE(reimbursement.is_deleted,FALSE)=FALSE
            AND UPPER(REGEXP_REPLACE(
              NORMALIZE(BTRIM(deduction.invoice_number),NFKC),
              '[^A-Za-z0-9]','','g'
            ))=ANY($1::text[])
       ) duplicate_invoice`,
      [invoiceNumbers],
    );
    if (Number(duplicate.rows[0]?.count || 0) > 0) {
      throw new Error("生产报销模块存在与第二批重复的发票号码");
    }
  }
  const sourceHashes = [...new Set(plan.sourceFiles.map((file) => file.hash))];
  const duplicateHash = await client.query<{ source: string }>(
    `SELECT 'reimbursement_invoice'::text AS source
       FROM reimbursement_invoices WHERE file_hash=ANY($1::text[])
     UNION ALL
     SELECT 'reimbursement_deduction_invoice'::text AS source
       FROM reimbursement_deduction_invoices WHERE file_hash=ANY($1::text[])
     UNION ALL
     SELECT 'payment_proof'::text AS source
       FROM payment_proof_hashes WHERE file_hash=ANY($1::text[])
     LIMIT 1`,
    [sourceHashes],
  );
  if (duplicateHash.rows[0]) {
    throw new Error("生产报销模块存在与第二批重复的文件摘要");
  }
  const receiptNumbers = [
    ...new Set(
      [...receiptEvidence.values()]
        .flatMap((evidence) => [
          evidence.electronicReceiptNo,
          evidence.transactionSerialNo,
        ])
        .map(normalizeCrossModuleInvoiceNumber)
        .filter(Boolean),
    ),
  ];
  if (receiptNumbers.length) {
    const duplicateReceipt = await client.query<{ source: string }>(
      `SELECT 'payment_proof'::text AS source FROM payment_proof_hashes
        WHERE proof_no IS NOT NULL AND UPPER(REGEXP_REPLACE(
          NORMALIZE(BTRIM(proof_no),NFKC),'[^A-Za-z0-9]','','g'
        ))=ANY($1::text[])
       UNION ALL
       SELECT 'contract_receipt'::text AS source FROM contract_receipts
        WHERE COALESCE(electronic_receipt_no,transaction_serial_no) IS NOT NULL
          AND (UPPER(REGEXP_REPLACE(
            NORMALIZE(BTRIM(electronic_receipt_no),NFKC),'[^A-Za-z0-9]','','g'
          ))=ANY($1::text[]) OR UPPER(REGEXP_REPLACE(
            NORMALIZE(BTRIM(transaction_serial_no),NFKC),'[^A-Za-z0-9]','','g'
          ))=ANY($1::text[]))
       UNION ALL
       SELECT 'contract_payment'::text AS source FROM contract_payments
        WHERE COALESCE(electronic_receipt_no,transaction_serial_no) IS NOT NULL
          AND (UPPER(REGEXP_REPLACE(
            NORMALIZE(BTRIM(electronic_receipt_no),NFKC),'[^A-Za-z0-9]','','g'
          ))=ANY($1::text[]) OR UPPER(REGEXP_REPLACE(
            NORMALIZE(BTRIM(transaction_serial_no),NFKC),'[^A-Za-z0-9]','','g'
          ))=ANY($1::text[]))
       UNION ALL
       SELECT 'contract_external_payment'::text AS source
         FROM contract_external_payments
        WHERE electronic_receipt_no IS NOT NULL
          AND UPPER(REGEXP_REPLACE(
            NORMALIZE(BTRIM(electronic_receipt_no),NFKC),'[^A-Za-z0-9]','','g'
          ))=ANY($1::text[])
       LIMIT 1`,
      [receiptNumbers],
    );
    if (duplicateReceipt.rows[0]) {
      throw new Error(
        `生产已有数据存在与第二批重复的电子回单号：${duplicateReceipt.rows[0].source}`,
      );
    }
  }
}

async function preflightConflicts(
  client: PoolClient,
  plan: SecondHistoricalImportPlan,
  options: ImportExecutionOptions,
  receiptEvidence: ReadonlyMap<string, ReceiptEvidence>,
): Promise<void> {
  if (options.target === "production") {
    const actualTargetDatabaseSha256 =
      await calculateSecondHistoricalTargetDatabaseSha256(client, plan);
    if (
      !options.targetDatabaseSha256 ||
      actualTargetDatabaseSha256 !== options.targetDatabaseSha256
    ) {
      throw new Error("生产目标数据库身份或既有合同语义基线摘要不一致");
    }
  }
  const existingBatch = await client.query<{
    manifest_hash: string;
    status: string;
    summary_json: Record<string, unknown>;
  }>(
    `SELECT manifest_hash,status,summary_json FROM contract_historical_import_batches
     WHERE batch_key=$1`,
    [SECOND_HISTORICAL_IMPORT_BATCH_KEY],
  );
  if (existingBatch.rows[0]) {
    if (
      existingBatch.rows[0].status === "completed" &&
      existingBatch.rows[0].manifest_hash === plan.manifestHash &&
      (options.target !== "production" ||
        (existingBatch.rows[0].summary_json?.semanticSha256 ===
          options.semanticSha256 &&
          existingBatch.rows[0].summary_json?.targetDatabaseSha256 ===
            options.targetDatabaseSha256))
    ) {
      return;
    }
    throw new Error("目标库存在同名但内容或状态不一致的第二批导入记录");
  }
  if (options.target === "production") {
    const dragonReusedSourcePaths = await assertDragonProductionBaseline(
      client,
      plan,
    );
    await assertStableIdAvailability(client, plan, dragonReusedSourcePaths);
    await assertPlannedFileTargets(client, plan, dragonReusedSourcePaths);
    await assertProductionCrossModuleConflicts(client, plan, receiptEvidence);
  }
  const businessNumbers = plan.roots
    .map((root) => root.businessContractNo)
    .filter((value): value is string => Boolean(value));
  if (businessNumbers.length) {
    const normalizedBusinessNumbers = new Set(
      businessNumbers.map(normalizedIdentity),
    );
    if (normalizedBusinessNumbers.size !== businessNumbers.length) {
      throw new Error("冻结清单内部存在重复原件合同编号");
    }
    const duplicates =
      options.target === "production"
        ? await client.query<{
            business_contract_no: string;
            id: string;
          }>(
            `SELECT business_contract_no,id FROM contracts
              WHERE is_deleted=FALSE AND business_contract_no IS NOT NULL
                AND BTRIM(business_contract_no)<>''`,
          )
        : await client.query<{
            business_contract_no: string;
            id: string;
          }>(
            `SELECT business_contract_no,id FROM contracts
              WHERE is_deleted=FALSE AND business_contract_no=ANY($1::text[])`,
            [businessNumbers],
          );
    const conflicts = duplicates.rows.filter((row) =>
      normalizedBusinessNumbers.has(
        normalizedIdentity(row.business_contract_no),
      ),
    );
    if (conflicts.length) {
      throw new Error(
        `目标库已有相同原件合同编号：${conflicts.map((row) => `${row.business_contract_no}(${row.id})`).join("、")}`,
      );
    }
  }
  for (const root of plan.roots) {
    for (const fact of root.financialFacts) {
      const hashConflict = await client.query<{ contract_id: string }>(
        `SELECT contract_id FROM contract_financial_file_hashes WHERE file_hash=$1`,
        [fact.source.hash],
      );
      const allowedDragonInvoice =
        root.restoreContractId === DRAGON_CONTRACT_ID &&
        fact.kind === "invoice" &&
        fact.source.hash ===
          "538c4b38b4c5312e9cb11336bdd8a0357bacc6ba9d5958dfb9d5801ae628560f";
      if (
        hashConflict.rows[0] &&
        (!allowedDragonInvoice ||
          hashConflict.rows[0].contract_id !== DRAGON_CONTRACT_ID)
      ) {
        throw new Error(`目标库已有相同财务原件：${fact.source.relativePath}`);
      }
      if (fact.kind === "invoice") {
        const { company, counterparty } = companyAndCounterparty(root);
        const seller =
          root.financialDirection === "income" ? company : counterparty;
        const invoiceConflict = await client.query<{ id: string }>(
          `SELECT id FROM contract_invoices
           WHERE LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(seller),NFKC),'[[:space:]]+','','g'))=
             LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM($1),NFKC),'[[:space:]]+','','g'))
             AND LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(invoice_no),NFKC),'[[:space:]]+','','g'))=
             LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM($2),NFKC),'[[:space:]]+','','g'))
             AND deduplication_exempt=FALSE`,
          [seller, fact.invoiceNo],
        );
        if (
          invoiceConflict.rows.some(
            (row) =>
              !allowedDragonInvoice || row.id !== DRAGON_EXISTING_INVOICE_ID,
          ) ||
          (allowedDragonInvoice &&
            !invoiceConflict.rows.some(
              (row) => row.id === DRAGON_EXISTING_INVOICE_ID,
            ))
        ) {
          throw new Error(
            `目标库已有相同销售方与发票号码：${fact.source.relativePath}`,
          );
        }
      }
    }
  }
}

async function assertCompletedImportIntegrity(
  client: PoolClient,
  plan: SecondHistoricalImportPlan,
  receiptEvidence: ReadonlyMap<string, ReceiptEvidence>,
): Promise<void> {
  const mapped = await client.query<{
    source_path: string;
    source_hash: string;
    source_bytes: string | number;
    family_key: string;
    contract_id: string;
    target_kind: string;
    accounting_included: boolean;
    contract_file_id: string | null;
    auxiliary_file_id: string | null;
    stored_hash: string | null;
    stored_bytes: string | number | null;
    stored_path: string | null;
    stored_contract_id: string | null;
    auxiliary_accounting_included: boolean | null;
  }>(
    `SELECT mapping.source_path,mapping.source_hash,mapping.source_bytes,
        mapping.family_key,mapping.contract_id,mapping.target_kind,
        mapping.accounting_included,mapping.contract_file_id,
        mapping.auxiliary_file_id,
        COALESCE(contract_file.file_hash,auxiliary_file.file_hash) AS stored_hash,
        COALESCE(contract_file.file_size,auxiliary_file.file_size) AS stored_bytes,
        COALESCE(contract_file.file_path,auxiliary_file.file_path) AS stored_path,
        COALESCE(contract_file.contract_id,auxiliary_package.parent_contract_id)
          AS stored_contract_id,
        auxiliary_package.accounting_included AS auxiliary_accounting_included
       FROM contract_historical_import_files mapping
       LEFT JOIN contract_files contract_file
         ON contract_file.id=mapping.contract_file_id
       LEFT JOIN contract_auxiliary_files auxiliary_file
         ON auxiliary_file.id=mapping.auxiliary_file_id
       LEFT JOIN contract_auxiliary_packages auxiliary_package
         ON auxiliary_package.id=auxiliary_file.package_id
      WHERE mapping.batch_key=$1 ORDER BY mapping.source_path`,
    [SECOND_HISTORICAL_IMPORT_BATCH_KEY],
  );
  if (mapped.rows.length !== plan.sourceFiles.length) {
    throw new Error("已完成第二批的源文件映射数量不完整，拒绝幂等跳过");
  }
  const sourceByPath = new Map(
    plan.sourceFiles.map((source) => [source.relativePath, source]),
  );
  const assignmentByPath = new Map(
    plan.assignments.map((assignment) => [assignment.relativePath, assignment]),
  );
  const expectedOwnerByPath = new Map<string, string>();
  for (const root of plan.roots) {
    const rootId = root.restoreContractId || stableId("contract", root.key);
    expectedOwnerByPath.set(root.source.relativePath, rootId);
    for (const agreement of root.agreements) {
      expectedOwnerByPath.set(
        agreement.source.relativePath,
        stableId("agreement", agreement.source.relativePath),
      );
    }
    for (const source of [
      ...root.financialFacts.map((fact) => fact.source),
      ...root.archiveFiles,
      ...root.auxiliaryFiles,
    ]) {
      expectedOwnerByPath.set(source.relativePath, rootId);
    }
  }
  const mappedTargetIds = new Set<string>();
  const mappedTargetKindCounts = new Map<string, number>();
  for (const row of mapped.rows) {
    const source = sourceByPath.get(row.source_path);
    const assignment = assignmentByPath.get(row.source_path);
    const expectedOwner = expectedOwnerByPath.get(row.source_path);
    const targetId = row.contract_file_id || row.auxiliary_file_id;
    const expectedTargetKind =
      assignment?.target === "archive" && source?.kind === "void_invoice"
        ? "void_invoice"
        : assignment?.target;
    if (
      !source ||
      !assignment ||
      source.hash !== row.source_hash ||
      source.bytes !== Number(row.source_bytes) ||
      source.familyId !== row.family_key ||
      !expectedOwner ||
      row.contract_id !== expectedOwner ||
      row.stored_contract_id !== expectedOwner ||
      row.stored_hash !== source.hash ||
      Number(row.stored_bytes) !== source.bytes ||
      !row.stored_path ||
      !targetId ||
      mappedTargetIds.has(targetId) ||
      Boolean(row.contract_file_id) === Boolean(row.auxiliary_file_id) ||
      row.target_kind !== expectedTargetKind ||
      row.accounting_included !== assignment.accountingIncluded ||
      (expectedTargetKind === "auxiliary" &&
        (!row.auxiliary_file_id ||
          row.contract_file_id !== null ||
          row.auxiliary_accounting_included !== false)) ||
      (expectedTargetKind !== "auxiliary" &&
        (!row.contract_file_id || row.auxiliary_file_id !== null))
    ) {
      throw new Error(
        `已完成第二批的源文件映射与冻结清单不一致：${row.source_path}`,
      );
    }
    mappedTargetIds.add(targetId);
    mappedTargetKindCounts.set(
      String(expectedTargetKind),
      (mappedTargetKindCounts.get(String(expectedTargetKind)) || 0) + 1,
    );
    const absolutePath = storedUploadAbsolutePath(row.stored_path);
    await verifyPhysicalFile(absolutePath, source, "已完成第二批归档文件");
  }
  const expectedTargetKindCounts: Readonly<Record<string, number>> = {
    sealed_contract: 41,
    agreement: 6,
    financial: 219,
    auxiliary: 115,
    archive: 2,
    void_invoice: 1,
  };
  if (
    mappedTargetKindCounts.size !==
      Object.keys(expectedTargetKindCounts).length ||
    Object.entries(expectedTargetKindCounts).some(
      ([kind, count]) => mappedTargetKindCounts.get(kind) !== count,
    )
  ) {
    throw new Error("已完成第二批的源文件映射分类总口径不一致");
  }
  await assertDragonLegacyAuxiliaryMigrationCompleted(client);

  const importedRoots = await client.query<{
    contract_id: string;
    count: number;
  }>(
    `SELECT contract_id,COUNT(*)::int AS count FROM contract_audit_logs
      WHERE action='historical_contract_imported'
        AND changes_json->>'batchKey'=$1
      GROUP BY contract_id ORDER BY contract_id`,
    [SECOND_HISTORICAL_IMPORT_BATCH_KEY],
  );
  const expectedRootIds = new Set(
    plan.roots.map(
      (root) => root.restoreContractId || stableId("contract", root.key),
    ),
  );
  if (
    importedRoots.rows.length !== expectedRootIds.size ||
    importedRoots.rows.some(
      (row) => row.count !== 1 || !expectedRootIds.has(row.contract_id),
    )
  ) {
    throw new Error("已完成第二批的主合同审计范围不完整，拒绝幂等跳过");
  }

  const roots = await client.query<Record<string, unknown>>(
    `SELECT * FROM contracts WHERE id=ANY($1::text[]) ORDER BY id`,
    [[...expectedRootIds]],
  );
  const rootById = new Map(roots.rows.map((row) => [String(row.id), row]));
  for (const expected of plan.roots) {
    const rootId =
      expected.restoreContractId || stableId("contract", expected.key);
    const row = rootById.get(rootId);
    const target = expected.family.target;
    if (
      !row ||
      row.relation_type !== "main" ||
      row.root_contract_id !== rootId ||
      Boolean(row.is_deleted) ||
      row.project_name !== expected.projectName ||
      row.party_a !== expected.family.partyA ||
      row.party_b !== expected.family.partyB ||
      (row.party_c || null) !== (expected.family.partyC || null) ||
      row.declared_category !== expected.family.category ||
      row.declared_subtype !== expected.family.declaredSubtype ||
      row.financial_direction !== expected.financialDirection ||
      row.area !== expected.family.area ||
      row.contract_date !== expected.contractDate ||
      moneyCents(row.current_effective_amount) !==
        moneyCents(expected.currentAmount) ||
      row.status !== expectedRootStatus(expected) ||
      (row.business_contract_no || null) !== expected.businessContractNo ||
      Boolean(row.requires_auxiliary_materials) !==
        expected.auxiliaryFiles.length > 0 ||
      row.pricing_mode !== (target ? "target" : "fixed") ||
      (target &&
        (moneyCents(row.target_amount) !== moneyCents(target.amount) ||
          Number(row.target_quantity) !== target.quantity ||
          moneyCents(row.unit_price) !== moneyCents(target.unitPrice) ||
          Number(row.confirmed_quantity) !== target.confirmedQuantity ||
          moneyCents(row.confirmed_contract_amount) !==
            moneyCents(target.confirmedAmount) ||
          row.quantity_unit !== target.quantityUnit))
    ) {
      throw new Error(`已完成第二批主合同字段不一致：${expected.projectName}`);
    }
  }

  const expectedAgreements = plan.roots.flatMap((root) =>
    root.agreements.map((agreement) => ({ root, agreement })),
  );
  const agreementIds = expectedAgreements.map(({ agreement }) =>
    stableId("agreement", agreement.source.relativePath),
  );
  const agreements = agreementIds.length
    ? await client.query<Record<string, unknown>>(
        `SELECT * FROM contracts WHERE id=ANY($1::text[]) ORDER BY id`,
        [agreementIds],
      )
    : { rows: [] };
  if (expectedAgreements.length !== 6 || agreements.rows.length !== 6) {
    throw new Error(
      `已完成第二批关联协议应为6份，实际${agreements.rows.length}份`,
    );
  }
  const agreementById = new Map(
    agreements.rows.map((row) => [String(row.id), row]),
  );
  for (const { root, agreement } of expectedAgreements) {
    const id = stableId("agreement", agreement.source.relativePath);
    const rootId = root.restoreContractId || stableId("contract", root.key);
    const row = agreementById.get(id);
    if (
      !row ||
      row.relation_type !== agreement.relationType ||
      row.parent_contract_id !== rootId ||
      row.root_contract_id !== rootId ||
      Boolean(row.is_deleted) ||
      row.contract_date !== agreement.contractDate ||
      Number(row.supplement_sequence || 0) !==
        Number(agreement.sequence || 0) ||
      moneyCents(row.amount_before_change) !==
        moneyCents(agreement.amountBefore) ||
      moneyCents(row.amount_delta) !== moneyCents(agreement.amountDelta) ||
      moneyCents(row.amount_after_change) !== moneyCents(agreement.amountAfter)
    ) {
      throw new Error(
        `已完成第二批关联协议不一致：${agreement.source.relativePath}`,
      );
    }
  }

  const expectedFinancialByHash = new Map(
    plan.roots.flatMap((root) =>
      root.financialFacts.map(
        (fact) => [fact.source.hash, { root, fact }] as const,
      ),
    ),
  );
  const financial = await client.query<Record<string, unknown>>(
    `SELECT registry.file_hash,registry.contract_id,
       COALESCE(invoice.id,receipt.id,payment.id) AS record_id,
       CASE WHEN invoice.id IS NOT NULL THEN 'invoice'
         WHEN receipt.id IS NOT NULL THEN 'receipt' ELSE 'payment' END AS kind,
       COALESCE(invoice.amount,receipt.amount,payment.amount) AS amount,
       COALESCE(invoice.invoice_date,receipt.receipt_date,payment.payment_date) AS business_date,
       COALESCE(receipt.payment_time,payment.payment_time) AS payment_time,
       invoice.invoice_no,COALESCE(receipt.payer,payment.payer) AS payer,
       COALESCE(receipt.payer_account,payment.payer_account) AS payer_account,
       COALESCE(receipt.payee,payment.payee) AS payee,
       COALESCE(receipt.payee_account,payment.payee_account) AS payee_account,
       COALESCE(receipt.electronic_receipt_no,payment.electronic_receipt_no)
         AS electronic_receipt_no,
       COALESCE(receipt.transaction_serial_no,payment.transaction_serial_no)
         AS transaction_serial_no,
       ocr.recognition_method,ocr.status AS ocr_status,
       ocr.validation_status,ocr.document_status,ocr.can_auto_post,
       ocr.direction,ocr.record_id AS ocr_record_id
     FROM contract_financial_file_hashes registry
     JOIN contract_historical_import_files mapping
       ON mapping.batch_key=$1 AND mapping.source_hash=registry.file_hash
         AND mapping.accounting_included=TRUE
     LEFT JOIN contract_invoices invoice ON invoice.file_id=registry.file_id
     LEFT JOIN contract_receipts receipt ON receipt.file_id=registry.file_id
     LEFT JOIN contract_payments payment ON payment.file_id=registry.file_id
     LEFT JOIN contract_financial_ocr_jobs ocr
       ON ocr.id=COALESCE(invoice.financial_ocr_job_id,
         receipt.financial_ocr_job_id,payment.financial_ocr_job_id)
     ORDER BY registry.file_hash`,
    [SECOND_HISTORICAL_IMPORT_BATCH_KEY],
  );
  if (financial.rows.length !== 219) {
    throw new Error(
      `已完成第二批财务记录应为219条，实际${financial.rows.length}条`,
    );
  }
  const actualFinancialRecordIds = new Set<string>();
  for (const row of financial.rows) {
    const expected = expectedFinancialByHash.get(String(row.file_hash));
    const rootId = expected
      ? expected.root.restoreContractId ||
        stableId("contract", expected.root.key)
      : null;
    const evidence = expected
      ? receiptEvidence.get(expected.fact.source.relativePath)
      : undefined;
    const parties = expected
      ? companyAndCounterparty(expected.root)
      : { company: "", counterparty: "" };
    const expectedPayer = expected
      ? canonicalReceiptParty(
          expected.root,
          evidence?.payer,
          expected.root.financialDirection === "income"
            ? parties.counterparty
            : parties.company,
        )
      : "";
    const expectedPayee = expected
      ? canonicalReceiptParty(
          expected.root,
          evidence?.payee,
          expected.root.financialDirection === "income"
            ? parties.company
            : parties.counterparty,
        )
      : "";
    const expectedDirection = expected
      ? expected.fact.kind === "invoice"
        ? expected.root.financialDirection === "income"
          ? "output"
          : "input"
        : expected.fact.kind
      : null;
    if (
      !expected ||
      row.contract_id !== rootId ||
      row.kind !== expected.fact.kind ||
      moneyCents(row.amount) !== moneyCents(expected.fact.amount) ||
      row.business_date !== expected.fact.businessDate ||
      (expected.fact.kind === "invoice" &&
        row.invoice_no !== expected.fact.invoiceNo) ||
      row.recognition_method !== "historical_confirmed_import" ||
      row.ocr_status !== "consumed" ||
      row.validation_status !== "verified" ||
      row.document_status !== "normal" ||
      row.can_auto_post !== true ||
      row.direction !== expectedDirection ||
      row.ocr_record_id !== row.record_id ||
      (expected.fact.kind !== "invoice" &&
        receiptEvidence.size > 0 &&
        (row.payment_time !== expected.fact.businessDate ||
          row.payer !== expectedPayer ||
          (row.payer_account || null) !== (evidence?.payerAccount || null) ||
          row.payee !== expectedPayee ||
          (row.payee_account || null) !== (evidence?.payeeAccount || null) ||
          (row.electronic_receipt_no || null) !==
            (evidence?.electronicReceiptNo || null) ||
          (row.transaction_serial_no || null) !==
            (evidence?.transactionSerialNo || null))) ||
      !row.record_id ||
      actualFinancialRecordIds.has(String(row.record_id))
    ) {
      throw new Error(
        `已完成第二批财务记录不一致：${expected?.fact.source.relativePath || row.file_hash}`,
      );
    }
    actualFinancialRecordIds.add(String(row.record_id));
  }

  const repairedRoots = await client.query<{
    contract_id: string;
    count: number;
  }>(
    `SELECT contract_id,COUNT(*)::int AS count FROM contract_audit_logs
      WHERE action='historical_financial_links_rebuilt'
        AND changes_json->>'batchKey'=$1
      GROUP BY contract_id ORDER BY contract_id`,
    [SECOND_HISTORICAL_IMPORT_BATCH_KEY],
  );
  const expectedFinancialRootIds = new Set(
    plan.roots
      .filter((root) => root.financialFacts.length > 0)
      .map((root) => root.restoreContractId || stableId("contract", root.key)),
  );
  if (
    repairedRoots.rows.length !== expectedFinancialRootIds.size ||
    repairedRoots.rows.some(
      (row) =>
        row.count !== 1 || !expectedFinancialRootIds.has(row.contract_id),
    )
  ) {
    throw new Error("已完成第二批的财务关系完成标记不完整，拒绝幂等跳过");
  }

  const registrations = await client.query<{
    id: string;
    contract_id: string;
    settlement_kind: "receipt" | "payment";
    status: "draft" | "confirmed";
    item_count: number;
    invoice_total: string | number;
    settlement_total: string | number;
    allocated_total: string | number;
  }>(
    `SELECT registration.id,registration.contract_id,
       registration.settlement_kind,registration.status,
       COUNT(DISTINCT item.id)::int AS item_count,
       COALESCE(SUM(CASE WHEN item.item_kind='invoice'
         THEN invoice.amount END),0) AS invoice_total,
       COALESCE(SUM(CASE WHEN item.item_kind='receipt'
         THEN receipt.amount WHEN item.item_kind='payment'
         THEN payment.amount END),0) AS settlement_total,
       COALESCE((SELECT SUM(match.allocated_amount)
         FROM contract_financial_registration_matches match
         WHERE match.registration_id=registration.id),0) AS allocated_total
     FROM contract_financial_registrations registration
     LEFT JOIN contract_financial_registration_items item
       ON item.registration_id=registration.id
     LEFT JOIN contract_invoices invoice
       ON item.item_kind='invoice' AND invoice.id=item.record_id
     LEFT JOIN contract_receipts receipt
       ON item.item_kind='receipt' AND receipt.id=item.record_id
     LEFT JOIN contract_payments payment
       ON item.item_kind='payment' AND payment.id=item.record_id
     WHERE registration.contract_id=ANY($1::text[])
       AND registration.status<>'reversed'
     GROUP BY registration.id ORDER BY registration.contract_id`,
    [[...expectedRootIds]],
  );
  const registrationByRoot = new Map(
    registrations.rows.map((row) => [row.contract_id, row]),
  );
  let confirmed = 0;
  let draft = 0;
  let noFinancial = 0;
  for (const root of plan.roots) {
    const rootId = root.restoreContractId || stableId("contract", root.key);
    const registration = registrationByRoot.get(rootId);
    if (!root.financialFacts.length) {
      if (registration)
        throw new Error(`无财务合同不应存在登记：${root.projectName}`);
      noFinancial += 1;
      continue;
    }
    const invoices = root.financialFacts.filter(
      (fact) => fact.kind === "invoice",
    );
    const settlements = root.financialFacts.filter(
      (fact) => fact.kind !== "invoice",
    );
    const invoiceCents = invoices.reduce(
      (sum, fact) => sum + moneyCents(fact.amount),
      0,
    );
    const settlementCents = settlements.reduce(
      (sum, fact) => sum + moneyCents(fact.amount),
      0,
    );
    const expectedStatus =
      invoiceCents > 0 && invoiceCents === settlementCents
        ? "confirmed"
        : "draft";
    if (
      !registration ||
      registration.settlement_kind !==
        (root.financialDirection === "income" ? "receipt" : "payment") ||
      registration.status !== expectedStatus ||
      registration.item_count !== root.financialFacts.length ||
      moneyCents(registration.invoice_total) !== invoiceCents ||
      moneyCents(registration.settlement_total) !== settlementCents ||
      moneyCents(registration.allocated_total) !==
        Math.min(invoiceCents, settlementCents)
    ) {
      throw new Error(`已完成第二批财务登记不一致：${root.projectName}`);
    }
    if (registration.status === "confirmed") confirmed += 1;
    else draft += 1;
  }
  if (
    registrations.rows.length !== 41 ||
    confirmed !== 39 ||
    draft !== 2 ||
    noFinancial !== 0
  ) {
    throw new Error("已完成第二批财务登记总口径不一致");
  }
  const registrationItems = await client.query<{
    record_id: string;
    contract_id: string;
    item_kind: string;
  }>(
    `SELECT item.record_id,item.contract_id,item.item_kind
       FROM contract_financial_registration_items item
       JOIN contract_financial_registrations registration
         ON registration.id=item.registration_id
      WHERE registration.contract_id=ANY($1::text[])
        AND registration.status<>'reversed'`,
    [[...expectedRootIds]],
  );
  if (
    registrationItems.rows.length !== 219 ||
    new Set(registrationItems.rows.map((row) => row.record_id)).size !== 219 ||
    registrationItems.rows.some(
      (row) => !actualFinancialRecordIds.has(row.record_id),
    )
  ) {
    throw new Error("已完成第二批219条财务登记明细不是一一对应");
  }
  const matches = await client.query<{
    count: number;
    invalid_count: number;
  }>(
    `SELECT COUNT(*)::int AS count,
       COUNT(*) FILTER (WHERE invoice_item.item_kind<>'invoice'
         OR settlement_item.item_kind NOT IN ('receipt','payment')
         OR invoice_item.contract_id<>match.contract_id
         OR settlement_item.contract_id<>match.contract_id
         OR invoice_item.registration_id<>match.registration_id
         OR settlement_item.registration_id<>match.registration_id)::int
           AS invalid_count
       FROM contract_financial_registration_matches match
       JOIN contract_financial_registrations registration
         ON registration.id=match.registration_id
       JOIN contract_financial_registration_items invoice_item
         ON invoice_item.id=match.invoice_item_id
       JOIN contract_financial_registration_items settlement_item
         ON settlement_item.id=match.settlement_item_id
      WHERE registration.contract_id=ANY($1::text[])
        AND registration.status<>'reversed'`,
    [[...expectedRootIds]],
  );
  if (
    Number(matches.rows[0]?.count || 0) !== 156 ||
    Number(matches.rows[0]?.invalid_count || 0) !== 0
  ) {
    throw new Error("已完成第二批156条财务匹配关系不完整");
  }
  const targetHistory = await client.query<Record<string, unknown>>(
    `SELECT history.* FROM contract_target_amount_changes history
       WHERE history.contract_id=ANY($1::text[])
       ORDER BY history.contract_id,history.change_no`,
    [[...expectedRootIds]],
  );
  if (
    targetHistory.rows.length !== 1 ||
    Number(targetHistory.rows[0]?.change_no) !== 0 ||
    moneyCents(targetHistory.rows[0]?.new_target_amount) !== 99_600_000 ||
    Number(targetHistory.rows[0]?.new_target_quantity) !== 996 ||
    moneyCents(targetHistory.rows[0]?.new_unit_price) !== 100_000
  ) {
    throw new Error("已完成第二批目标金额初始历史不完整");
  }
}

async function insertSourceMappings(
  client: PoolClient,
  plan: SecondHistoricalImportPlan,
  mappings: ReadonlyMap<string, StoredMapping>,
  now: string,
): Promise<void> {
  if (mappings.size !== plan.sourceFiles.length) {
    throw new Error(
      `落库映射数量不完整：应为${plan.sourceFiles.length}，实际${mappings.size}`,
    );
  }
  for (const source of plan.sourceFiles) {
    const mapping = mappings.get(source.relativePath);
    if (!mapping) throw new Error(`源文件没有落库映射：${source.relativePath}`);
    await client.query(
      `INSERT INTO contract_historical_import_files(
         batch_key,source_path,source_hash,source_bytes,family_key,
         contract_id,target_kind,accounting_included,contract_file_id,
         auxiliary_file_id,created_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        SECOND_HISTORICAL_IMPORT_BATCH_KEY,
        source.relativePath,
        source.hash,
        source.bytes,
        source.familyId,
        mapping.contractId,
        mapping.targetKind,
        mapping.accountingIncluded,
        mapping.contractFileId,
        mapping.auxiliaryFileId,
        now,
      ],
    );
  }
}

async function captureImportCounts(client: PoolClient): Promise<ImportCounts> {
  const result = await client.query<ImportCounts>(
    `SELECT
       (SELECT COUNT(*)::int FROM contracts) AS contracts,
       (SELECT COUNT(*)::int FROM contract_files) AS contract_files,
       (SELECT COUNT(*)::int FROM contract_auxiliary_packages) AS contract_auxiliary_packages,
       (SELECT COUNT(*)::int FROM contract_auxiliary_files) AS contract_auxiliary_files,
       (SELECT COUNT(*)::int FROM contract_financial_file_hashes) AS contract_financial_file_hashes,
       (SELECT COUNT(*)::int FROM contract_financial_ocr_jobs) AS contract_financial_ocr_jobs,
       (SELECT COUNT(*)::int FROM contract_invoices) AS contract_invoices,
       (SELECT COUNT(*)::int FROM contract_receipts) AS contract_receipts,
       (SELECT COUNT(*)::int FROM contract_payments) AS contract_payments,
       (SELECT COUNT(*)::int FROM contract_financial_registrations) AS contract_financial_registrations,
       (SELECT COUNT(*)::int FROM contract_financial_registration_items) AS contract_financial_registration_items,
       (SELECT COUNT(*)::int FROM contract_financial_registration_matches) AS contract_financial_registration_matches,
       (SELECT COUNT(*)::int FROM contract_target_amount_changes) AS contract_target_amount_changes,
       (SELECT COUNT(*)::int FROM contract_audit_logs) AS contract_audit_logs,
       (SELECT COUNT(*)::int FROM contract_historical_import_batches) AS contract_historical_import_batches,
       (SELECT COUNT(*)::int FROM contract_historical_import_files) AS contract_historical_import_files`,
  );
  if (!result.rows[0]) throw new Error("无法读取第二批导入计数基线");
  return result.rows[0];
}

function assertProductionIncrements(
  before: ImportCounts,
  after: ImportCounts,
): void {
  for (const key of Object.keys(EXPECTED_PRODUCTION_INCREMENTS) as Array<
    keyof ImportCounts
  >) {
    const actual = Number(after[key]) - Number(before[key]);
    const expected = EXPECTED_PRODUCTION_INCREMENTS[key];
    if (actual !== expected) {
      throw new Error(
        `生产增量断言失败：${key}应增加${expected}，实际增加${actual}`,
      );
    }
  }
}

async function assertProductionContractSequence(
  client: PoolClient,
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('contract_no_sequence:production-import',0)
     )`,
  );
  const result = await client.query<{
    last_value: string | number;
    is_called: boolean;
    max_used_value: string | number;
  }>(
    `SELECT sequence_state.last_value,sequence_state.is_called,
       COALESCE((
         SELECT MAX((REGEXP_MATCH(contract_no,'([0-9]{6})$'))[1]::bigint)
           FROM contracts
          WHERE contract_no ~ '^HT-[0-9]{8}-[0-9]{6}$'
       ),0)::text AS max_used_value
       FROM contract_no_sequence sequence_state`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("生产合同编号序列不存在");
  const nextValue = BigInt(String(row.last_value)) + (row.is_called ? 1n : 0n);
  const maxUsed = BigInt(String(row.max_used_value));
  if (nextValue <= maxUsed) {
    throw new Error(
      `生产合同编号序列落后：下一值${nextValue}，最大已用值${maxUsed}`,
    );
  }
}

async function applyImport(
  plan: SecondHistoricalImportPlan,
  receiptEvidence: ReadonlyMap<string, ReceiptEvidence>,
  options: ImportExecutionOptions,
): Promise<Record<string, unknown>> {
  const [
    { pool },
    { recalculateContractExecutionStatus },
    { repairSecondHistoricalFinancialRoot },
  ] = await Promise.all([
    import("../db/index.js"),
    import("../services/contractService.js"),
    import("./repair-second-historical-financial-links.js"),
  ]);
  const copiedFiles: CopiedFile[] = [];
  const client = await pool.connect();
  let transactionFinished = false;
  let commitOutcomeUncertain = false;
  let skipped = false;
  try {
    await client.query(
      options.target === "production"
        ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
        : "BEGIN",
    );
    if (options.target === "production") {
      await client.query("LOCK TABLE contracts IN SHARE ROW EXCLUSIVE MODE");
    }
    const result = await (async () => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [
          `second-historical-contract-import:${SECOND_HISTORICAL_IMPORT_BATCH_KEY}`,
        ],
      );
      await assertTargetDatabase(client, options.target);
      const actor = await resolveActor(client);
      await preflightConflicts(client, plan, options, receiptEvidence);
      const completed = await client.query<{
        summary_json: Record<string, unknown>;
      }>(
        `SELECT summary_json FROM contract_historical_import_batches
         WHERE batch_key=$1 AND status='completed' AND manifest_hash=$2`,
        [SECOND_HISTORICAL_IMPORT_BATCH_KEY, plan.manifestHash],
      );
      if (completed.rows[0]) {
        await assertCompletedImportIntegrity(client, plan, receiptEvidence);
        skipped = true;
        return completed.rows[0].summary_json;
      }

      const beforeContracts = await snapshotExistingContracts(client);
      const beforeCounts =
        options.target === "production"
          ? await captureImportCounts(client)
          : null;
      if (options.target === "production" && options.mode === "commit") {
        await assertProductionContractSequence(client);
      }
      const mappings = new Map<string, StoredMapping>();
      const importedRootIds: string[] = [];
      const importedAgreementIds: string[] = [];
      const financialLinkResults: SecondHistoricalFinancialRepairResult[] = [];
      const now = new Date().toISOString();
      await removeDragonLegacyAuxiliaryContractFiles(client, plan);

      for (const root of plan.roots) {
        const rootId = root.restoreContractId
          ? await restoreDragonContract(client, root, actor, now)
          : await insertRootContract(
              client,
              root,
              actor.id,
              now,
              !(options.target === "production" && options.mode === "dry-run"),
            );
        importedRootIds.push(rootId);
        const mainFileId = await ensureContractFile(client, {
          root,
          contractId: rootId,
          fileType: "sealed_contract",
          source: root.source,
          bucket: "root",
          actorId: actor.id,
          now,
          copiedFiles,
        });
        mappings.set(root.source.relativePath, {
          contractId: rootId,
          contractFileId: mainFileId,
          auxiliaryFileId: null,
          targetKind: "sealed_contract",
          accountingIncluded: false,
        });

        for (const agreement of root.agreements) {
          const agreementId = await insertAgreement(client, {
            root,
            rootId,
            agreement,
            actorId: actor.id,
            actorRole: actor.role,
            now,
            advanceSequence: !(
              options.target === "production" && options.mode === "dry-run"
            ),
          });
          importedAgreementIds.push(agreementId);
          const agreementFileId = await ensureContractFile(client, {
            root,
            contractId: agreementId,
            fileType: "sealed_contract",
            source: agreement.source,
            bucket: `agreement-${agreement.sequence || "termination"}`,
            actorId: actor.id,
            now,
            copiedFiles,
          });
          mappings.set(agreement.source.relativePath, {
            contractId: agreementId,
            contractFileId: agreementFileId,
            auxiliaryFileId: null,
            targetKind: "agreement",
            accountingIncluded: false,
          });
        }

        for (const source of root.archiveFiles) {
          const fileId = await ensureContractFile(client, {
            root,
            contractId: rootId,
            fileType: source.kind === "void_invoice" ? "invoice" : "other",
            source,
            bucket: "archive",
            actorId: actor.id,
            now,
            copiedFiles,
          });
          mappings.set(source.relativePath, {
            contractId: rootId,
            contractFileId: fileId,
            auxiliaryFileId: null,
            targetKind:
              source.kind === "void_invoice" ? "void_invoice" : "archive",
            accountingIncluded: false,
          });
        }

        for (const fact of root.financialFacts) {
          let fileId: string;
          let existingRecord = false;
          if (root.restoreContractId) {
            const existingFile = await existingDragonFile(
              client,
              rootId,
              fact.source,
            );
            if (existingFile) {
              fileId = existingFile.id;
              const table =
                fact.kind === "invoice"
                  ? "contract_invoices"
                  : fact.kind === "receipt"
                    ? "contract_receipts"
                    : "contract_payments";
              const record = await client.query<{ id: string }>(
                `SELECT id FROM ${table} WHERE contract_id=$1 AND file_id=$2 LIMIT 1`,
                [rootId, fileId],
              );
              existingRecord = Boolean(record.rows[0]);
            } else {
              fileId = await ensureContractFile(client, {
                root,
                contractId: rootId,
                fileType: fact.kind,
                source: fact.source,
                bucket: "financial",
                actorId: actor.id,
                now,
                copiedFiles,
              });
            }
          } else {
            fileId = await ensureContractFile(client, {
              root,
              contractId: rootId,
              fileType: fact.kind,
              source: fact.source,
              bucket: "financial",
              actorId: actor.id,
              now,
              copiedFiles,
            });
          }
          await registerFinancialHash(client, {
            source: fact.source,
            fileId,
            contractId: rootId,
            now,
          });
          if (!existingRecord) {
            await insertFinancialFact(client, {
              root,
              fact,
              fileId,
              evidence: receiptEvidence.get(fact.source.relativePath),
              actorId: actor.id,
              now,
            });
          }
          await attachHistoricalFinancialRecognition(client, {
            root,
            fact,
            fileId,
            evidence: receiptEvidence.get(fact.source.relativePath),
            actorId: actor.id,
            now,
          });
          mappings.set(fact.source.relativePath, {
            contractId: rootId,
            contractFileId: fileId,
            auxiliaryFileId: null,
            targetKind: "financial",
            accountingIncluded: true,
          });
        }

        await insertAuxiliaryFiles(client, {
          root,
          rootId,
          actorId: actor.id,
          actorRole: actor.role,
          now,
          copiedFiles,
          mappings,
        });

        const recalculated = await recalculateContractExecutionStatus(
          client,
          rootId,
          actor.id,
          actor.role,
        );
        await insertAudit(client, {
          contractId: rootId,
          action: "historical_contract_imported",
          actorId: actor.id,
          actorRole: actor.role,
          fromStatus: null,
          toStatus: recalculated.status,
          changes: {
            batchKey: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
            familyId: root.family.id,
            rootKey: root.key,
            sourceFolder: root.family.directory,
            sourcePath: root.source.relativePath,
            sourceHash: root.source.hash,
            restored: Boolean(root.restoreContractId),
            declaredCategory: root.family.category,
            declaredSubtype: root.family.declaredSubtype,
            financialDirection: root.financialDirection,
            projectName: root.projectName,
            partyA: root.family.partyA,
            partyB: root.family.partyB,
            partyC: root.family.partyC || null,
            originalAmount: root.originalAmount,
            currentAmount: root.currentAmount,
            target: root.family.target || null,
            agreementCount: root.agreements.length,
            financialFileCount: root.financialFacts.length,
            auxiliaryFileCount: root.auxiliaryFiles.length,
          },
          comment: "第二批历史合同正式导入目标库",
          now,
        });
        financialLinkResults.push(
          await repairSecondHistoricalFinancialRoot(
            client,
            rootId,
            actor,
            now,
            {
              allowedFinancialFileIds: root.financialFacts.map((fact) => {
                const mapping = mappings.get(fact.source.relativePath);
                if (!mapping?.contractFileId) {
                  throw new Error(
                    `第二批财务原件缺少合同文件映射：${fact.source.relativePath}`,
                  );
                }
                return mapping.contractFileId;
              }),
              idFactory: options.target === "production" ? stableId : undefined,
            },
          ),
        );
      }

      const summary = {
        ...plan.summary,
        batchKey: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
        manifestHash: plan.manifestHash,
        semanticSha256: options.semanticSha256,
        targetDatabaseSha256: options.targetDatabaseSha256,
        importedRootIds,
        importedAgreementIds,
        financialLinkResults,
        actorId: actor.id,
        actorName: actor.name,
        target: options.target,
        completedAt: now,
      };
      await client.query(
        `INSERT INTO contract_historical_import_batches(
           batch_key,manifest_hash,source_file_count,
           source_total_bytes,status,imported_contract_count,
           restored_contract_count,created_by,created_at,completed_at,summary_json
         ) VALUES($1,$2,$3,$4,'completed',$5,$6,$7,$8,$8,$9::jsonb)`,
        [
          SECOND_HISTORICAL_IMPORT_BATCH_KEY,
          plan.manifestHash,
          plan.sourceFiles.length,
          plan.totalBytes,
          plan.roots.length - plan.summary.restoredContractCount,
          plan.summary.restoredContractCount,
          actor.id,
          now,
          JSON.stringify(summary),
        ],
      );
      await insertSourceMappings(client, plan, mappings, now);

      const afterContracts = await snapshotExistingContracts(client);
      assertExistingContractsUnchanged(
        beforeContracts,
        afterContracts,
        "sdylIKVZJDN8jYQ342rOL",
      );
      const sourceMappingCheck = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM contract_historical_import_files
         WHERE batch_key=$1`,
        [SECOND_HISTORICAL_IMPORT_BATCH_KEY],
      );
      if (
        Number(sourceMappingCheck.rows[0]?.count || 0) !==
        plan.sourceFiles.length
      ) {
        throw new Error("数据库中的源文件映射数量不完整，已回滚");
      }
      await assertCompletedImportIntegrity(client, plan, receiptEvidence);
      if (beforeCounts) {
        const afterCounts = await captureImportCounts(client);
        assertProductionIncrements(beforeCounts, afterCounts);
      }
      return summary;
    })();
    if (options.mode === "dry-run") {
      await client.query("ROLLBACK");
      transactionFinished = true;
      await cleanupCopiedFiles(copiedFiles);
      return {
        ...result,
        skipped,
        dryRunRolledBack: true,
        sequenceAdvanced: false,
      };
    }
    try {
      await client.query("COMMIT");
      transactionFinished = true;
    } catch (error) {
      const code = String((error as Error & { code?: unknown }).code || "");
      if (!["40001", "40P01"].includes(code)) {
        commitOutcomeUncertain = true;
        (
          error as Error & { commitOutcomeUncertain?: boolean }
        ).commitOutcomeUncertain = true;
      }
      throw error;
    }
    return { ...result, skipped, dryRunRolledBack: false };
  } catch (error) {
    if (!transactionFinished && !commitOutcomeUncertain) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    if (!commitOutcomeUncertain) {
      await cleanupCopiedFiles(copiedFiles);
    }
    if (commitOutcomeUncertain) {
      const message = error instanceof Error ? error.message : String(error);
      const uncertain = new Error(
        `${message}；数据库提交结果无法确认，已保留本轮新文件；禁止重试，必须先只读核验批次、384份映射和物理文件`,
      ) as Error & { commitOutcomeUncertain?: boolean };
      uncertain.commitOutcomeUncertain = true;
      throw uncertain;
    }
    throw error;
  } finally {
    client.release(commitOutcomeUncertain);
    await pool.end();
  }
}

function printHelp(): void {
  console.log(`第二批历史合同增量导入

开发库：
  npx tsx server/scripts/import-second-historical-contracts.ts --dry-run --source-root <目录>
  npx tsx server/scripts/import-second-historical-contracts.ts --commit --source-root <目录> --receipt-ocr <JSON文件>

生产预演：
  NODE_ENV=production node dist/server/scripts/import-second-historical-contracts.js \\
    --dry-run --target=production --source-root <只读目录> \\
    --receipt-ocr <只读JSON文件> \\
    --manifest-sha256=${SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH} \\
    --semantic-sha256=${SECOND_HISTORICAL_SEMANTIC_SHA256} \\
    --target-database-sha256=<生产目标库基线摘要>

生产提交：
  NODE_ENV=production node dist/server/scripts/import-second-historical-contracts.js \\
    --commit --target=production --source-root <只读目录> \\
    --receipt-ocr <只读JSON文件> \\
    --manifest-sha256=${SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH} \\
    --semantic-sha256=${SECOND_HISTORICAL_SEMANTIC_SHA256} \\
    --target-database-sha256=<与预演相同的生产目标库基线摘要> \\
    --confirm-production=${SECOND_HISTORICAL_PRODUCTION_CONFIRMATION}

安全限制：生产预演在单一事务中真实执行完整导入并强制回滚，不推进合同编号序列；
生产预演和提交同时锁定源清单、业务语义、目标库身份与回单复核文件摘要。未知参数、跨模块重复、稳定编号冲突、
附件路径越界或符号链接、龙潭湖基线偏差及增量计数偏差都会失败关闭。`);
}

async function main(): Promise<void> {
  const commandArguments = process.argv.slice(2);
  if (commandArguments.includes("--help") || commandArguments.includes("-h")) {
    if (commandArguments.length !== 1) {
      throw new Error("帮助参数不能与其他命令行参数同时使用");
    }
    printHelp();
    return;
  }
  const args = parseSecondHistoricalImportArguments(commandArguments);
  const plan = await buildSecondHistoricalImportPlan(args.sourceRoot);
  if (args.target === "production") assertFrozenProductionPlan(plan);
  const semanticSha256 =
    args.target === "production"
      ? calculateSecondHistoricalSemanticSha256(plan)
      : null;
  const receiptOcrSha256 = args.receiptOcrPath
    ? await sha256File(path.resolve(args.receiptOcrPath))
    : null;
  assertSecondHistoricalProductionAuthorization(
    args,
    plan,
    receiptOcrSha256,
    semanticSha256,
  );
  const receiptEvidence = readReceiptEvidence(args.receiptOcrPath);
  const settlementFacts = plan.roots.flatMap((root) =>
    root.financialFacts.filter((fact) => fact.kind !== "invoice"),
  );
  for (const fact of settlementFacts) {
    validateReceiptEvidence(
      fact,
      receiptEvidence.get(fact.source.relativePath),
    );
  }
  if (args.receiptOcrPath && receiptEvidence.size !== settlementFacts.length) {
    throw new Error(
      `回单复核覆盖数量不一致：应为${settlementFacts.length}，实际${receiptEvidence.size}`,
    );
  }
  if (args.mode === "dry-run" && args.target === "development") {
    console.log(
      JSON.stringify(
        {
          模式: "只读预演",
          批次: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
          源目录: plan.sourceRoot,
          清单摘要: plan.manifestHash,
          摘要: plan.summary,
          完整映射: plan.assignments.length === plan.sourceFiles.length,
          回单复核覆盖: `${receiptEvidence.size}/${settlementFacts.length}`,
          生产库操作: "无",
        },
        null,
        2,
      ),
    );
    return;
  }
  const summary = await applyImport(plan, receiptEvidence, {
    mode: args.mode,
    target: args.target,
    semanticSha256,
    targetDatabaseSha256: args.targetDatabaseSha256,
  });
  console.log(
    JSON.stringify(
      {
        模式:
          args.target === "production"
            ? args.mode === "dry-run"
              ? "生产事务预演（已回滚）"
              : "生产增量提交"
            : "开发库提交",
        摘要: summary,
      },
      null,
      2,
    ),
  );
}

const invokedAsScript = /import-second-historical-contracts\.(?:ts|js)$/u.test(
  path.basename(process.argv[1] || ""),
);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
