import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";

import {
  SECOND_HISTORICAL_IMPORT_BATCH_KEY,
  SECOND_HISTORICAL_IMPORT_DEFAULT_SOURCE_ROOT,
  SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH,
  SECOND_HISTORICAL_RECEIPT_OCR_SHA256,
  SECOND_HISTORICAL_SEMANTIC_SHA256,
} from "./second-historical-import-config.js";
import {
  buildSecondHistoricalImportPlan,
  type SecondHistoricalImportPlan,
  type SecondHistoricalFinancialPlan,
  type SecondHistoricalRootPlan,
  type SecondHistoricalSourceFile,
} from "./second-historical-import-plan.js";
import {
  calculateSecondHistoricalSemanticSha256,
  calculateSecondHistoricalTargetDatabaseSha256,
  secondHistoricalStableId,
} from "./second-historical-production-guard.js";

export const SECOND_HISTORICAL_VERIFICATION_RECEIPT_OCR_SHA256 =
  SECOND_HISTORICAL_RECEIPT_OCR_SHA256;

export type SecondHistoricalVerificationTarget = "development" | "production";

export interface SecondHistoricalVerificationArguments {
  target: SecondHistoricalVerificationTarget;
  sourceRoot: string;
  outputPath: string | null;
  manifestSha256: string | null;
  receiptOcrSha256: string | null;
  receiptOcrPath: string | null;
  semanticSha256: string | null;
  targetDatabaseSha256: string | null;
}

interface ReadOnlyVerificationDatabase {
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const VERIFICATION_VALUE_OPTIONS = new Set([
  "--target",
  "--source-root",
  "--output",
  "--manifest-sha256",
  "--receipt-ocr-sha256",
  "--receipt-ocr",
  "--semantic-sha256",
  "--target-database-sha256",
]);

function readStrictOptions(argv: readonly string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith("--")) {
      throw new Error(`不支持的位置参数：${raw}`);
    }
    const separator = raw.indexOf("=");
    const name = separator >= 0 ? raw.slice(0, separator) : raw;
    if (!VERIFICATION_VALUE_OPTIONS.has(name)) {
      throw new Error(`不支持的参数：${name}`);
    }
    if (options.has(name)) {
      throw new Error(`参数不能重复：${name}`);
    }
    const value =
      separator >= 0
        ? raw.slice(separator + 1)
        : (() => {
            const next = argv[index + 1];
            if (!next || next.startsWith("--")) return "";
            index += 1;
            return next;
          })();
    if (!value) throw new Error(`参数缺少值：${name}`);
    options.set(name, value);
  }
  return options;
}

export function parseSecondHistoricalVerificationArguments(
  argv: readonly string[],
  cwd = process.cwd(),
): SecondHistoricalVerificationArguments {
  const options = readStrictOptions(argv);
  const target = options.get("--target") || "development";
  if (target !== "development" && target !== "production") {
    throw new Error("--target 只能是 development 或 production");
  }
  const manifestSha256 = options.get("--manifest-sha256") || null;
  const receiptOcrSha256 = options.get("--receipt-ocr-sha256") || null;
  const semanticSha256 = options.get("--semantic-sha256") || null;
  const targetDatabaseSha256 = options.get("--target-database-sha256") || null;
  if (manifestSha256 && !SHA256_PATTERN.test(manifestSha256)) {
    throw new Error("--manifest-sha256 必须是64位小写十六进制摘要");
  }
  if (receiptOcrSha256 && !SHA256_PATTERN.test(receiptOcrSha256)) {
    throw new Error("--receipt-ocr-sha256 必须是64位小写十六进制摘要");
  }
  if (semanticSha256 && !SHA256_PATTERN.test(semanticSha256)) {
    throw new Error("--semantic-sha256 必须是64位小写十六进制摘要");
  }
  if (targetDatabaseSha256 && !SHA256_PATTERN.test(targetDatabaseSha256)) {
    throw new Error("--target-database-sha256 必须是64位小写十六进制摘要");
  }
  const output = options.get("--output") || null;
  const receiptOcr = options.get("--receipt-ocr") || null;
  if (target === "production" && output) {
    throw new Error("生产验收只允许控制台输出，禁止使用 --output");
  }
  return {
    target,
    sourceRoot: path.resolve(
      cwd,
      options.get("--source-root") ||
        SECOND_HISTORICAL_IMPORT_DEFAULT_SOURCE_ROOT,
    ),
    outputPath: output ? path.resolve(cwd, output) : null,
    manifestSha256,
    receiptOcrSha256,
    receiptOcrPath: receiptOcr ? path.resolve(cwd, receiptOcr) : null,
    semanticSha256,
    targetDatabaseSha256,
  };
}

export function assertSecondHistoricalVerificationEnvironment(
  args: SecondHistoricalVerificationArguments,
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): void {
  if (path.resolve(cwd) !== "/app") {
    throw new Error("第二批验收必须在容器 /app 工作目录执行");
  }
  if (args.target === "production") {
    if (environment.NODE_ENV !== "production") {
      throw new Error("生产验收必须使用 NODE_ENV=production");
    }
    if (
      args.manifestSha256 !== SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH
    ) {
      throw new Error("生产验收的冻结源文件清单摘要不一致");
    }
    if (
      args.receiptOcrSha256 !==
      SECOND_HISTORICAL_VERIFICATION_RECEIPT_OCR_SHA256
    ) {
      throw new Error("生产验收的回单复核文件摘要不一致");
    }
    if (!args.receiptOcrPath) {
      throw new Error("生产验收必须显式指定 --receipt-ocr");
    }
    if (args.semanticSha256 !== SECOND_HISTORICAL_SEMANTIC_SHA256) {
      throw new Error("生产验收的业务语义摘要不一致");
    }
    if (
      !args.targetDatabaseSha256 ||
      !SHA256_PATTERN.test(args.targetDatabaseSha256)
    ) {
      throw new Error("生产验收必须指定64位 --target-database-sha256");
    }
    if (args.outputPath) {
      throw new Error("生产验收只允许控制台输出，禁止使用 --output");
    }
    return;
  }
  if (environment.NODE_ENV !== "development") {
    throw new Error("开发验收必须使用 NODE_ENV=development");
  }
  if (/prod(?:uction)?/iu.test(environment.DATABASE_URL || "")) {
    throw new Error("数据库连接疑似生产环境，拒绝以开发模式验收");
  }
}

function convertPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/gu, () => `$${++index}`);
}

function createReadOnlyVerificationDatabase(
  client: PoolClient,
): ReadOnlyVerificationDatabase {
  return {
    async get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const result = await client.query(convertPlaceholders(sql), params);
      return result.rows[0] as T | undefined;
    },
    async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      const result = await client.query(convertPlaceholders(sql), params);
      return result.rows as T[];
    },
  };
}

function cents(value: unknown): number {
  return Math.round(Number(value || 0) * 100);
}

const DRAGON_CONTRACT_ID = "sdylIKVZJDN8jYQ342rOL";
const DRAGON_EXISTING_INVOICE_ID = "OIS9KCPaeWfh3VPdgWIfv";
const DRAGON_EXISTING_INVOICE_NO = "03024845";
const DRAGON_EXISTING_INVOICE_HASH =
  "538c4b38b4c5312e9cb11336bdd8a0357bacc6ba9d5958dfb9d5801ae628560f";
const DRAGON_EXISTING_OCR_JOB_ID = "histocr_960eec5635278a16a07b5e";
const DRAGON_LEGACY_REPAIR_BATCH_KEY =
  "historical-import-2026-08-26-system-boundary-repair-v1";
const DRAGON_LEGACY_AUXILIARY_CONTRACT_FILE_IDS = [
  "1wUDji9suakQ-rbnIf_hi",
  "fQHpEgtNaTwlvdDK70tmc",
] as const;
const DRAGON_STALE_VOID_INVOICE_HASH =
  "c91afa2d6234b82fc765677fd8096404bd4461d1cae60790e24c52265c940ce6";
export const SECOND_HISTORICAL_AUXILIARY_CORRECTION_KEY =
  "second-historical-auxiliary-classification-correction-v1";
export const SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID = "h2_GW6LvU2BsZInN6QYJQUz";
export const SECOND_HISTORICAL_OBSOLETE_CONTRACT_FILE_IDS = [
  ...DRAGON_LEGACY_AUXILIARY_CONTRACT_FILE_IDS,
  "h2_UYhoLA3ZIWMOwzLSUuxy",
] as const;

interface ActiveFinancialRegistrationRow {
  id: string;
  contract_id: string;
  settlement_kind: "receipt" | "payment";
  status: "draft" | "confirmed";
  item_count: number;
  invoice_total: string;
  settlement_total: string;
  allocated_total: string;
}

interface FinancialRegistrationItemRow {
  id: string;
  registration_id: string;
  contract_id: string;
  item_kind: "invoice" | "receipt" | "payment";
  record_id: string;
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

export function resolveSecondHistoricalStoredPath(
  storedPath: string,
  applicationRoot = "/app",
): string {
  const text = String(storedPath || "")
    .normalize("NFC")
    .trim();
  if (
    !text ||
    text.includes("\0") ||
    text.includes("\\") ||
    path.isAbsolute(text)
  ) {
    throw new Error(`数据库文件路径越过上传目录：${storedPath}`);
  }
  const segments = text.split("/");
  if (
    segments.length < 2 ||
    segments[0] !== "uploads" ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`数据库文件路径越过上传目录：${storedPath}`);
  }
  const root = path.resolve(applicationRoot);
  const uploadRoot = path.resolve(root, "uploads");
  const resolved = path.resolve(root, ...segments);
  const relative = path.relative(uploadRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`数据库文件路径越过上传目录：${storedPath}`);
  }
  return resolved;
}

export async function assertRegularFilePathWithoutSymlinks(
  filePath: string,
  label: string,
): Promise<fs.Stats> {
  const resolved = path.resolve(filePath);
  const parsed = path.parse(resolved);
  const relative = path.relative(parsed.root, resolved);
  const segments = relative ? relative.split(path.sep) : [];
  let current = parsed.root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const stat = await fs.promises.lstat(current).catch(() => null);
    if (!stat) throw new Error(`${label}不存在：${current}`);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label}路径包含符号链接：${current}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label}父路径不是目录：${current}`);
    }
    if (index === segments.length - 1 && !stat.isFile()) {
      throw new Error(`${label}不是普通文件：${current}`);
    }
    if (index === segments.length - 1) return stat;
  }
  throw new Error(`${label}不是普通文件：${resolved}`);
}

interface VerifiedReceiptEvidence {
  relativePath: string;
  familyId: string;
  sourceHash: string;
  payer: string | null;
  payerAccount: string | null;
  payee: string | null;
  payeeAccount: string | null;
  electronicReceiptNo: string | null;
  transactionSerialNo: string | null;
  transactionDate: string | null;
  amount: number | null;
  success: boolean;
  error: string | null;
  rawTextSha256: string | null;
  conflicts: string[];
}

interface LoadedReceiptEvidence {
  fileSha256: string;
  recordsByPath: Map<string, VerifiedReceiptEvidence>;
}

function optionalText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function assertSameUniqueIds(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (
    actualSet.size !== actual.length ||
    expectedSet.size !== expected.length ||
    actualSet.size !== expectedSet.size ||
    [...actualSet].some((id) => !expectedSet.has(id))
  ) {
    throw new Error(`${label}不一致或存在重复`);
  }
}

export interface SecondHistoricalCorrectedBatchState {
  summary: Record<string, unknown>;
  importedRootIds: string[];
  financialLinkRootIds: string[] | null;
}

/**
 * 更正后的批次摘要是生产验收边界，不能只依赖当前源文件重新生成的计划。
 */
export function assertSecondHistoricalCorrectedBatchState(
  batch: Record<string, unknown>,
  target: SecondHistoricalVerificationTarget,
): SecondHistoricalCorrectedBatchState {
  if (Number(batch.imported_contract_count) !== 40) {
    throw new Error(
      `第二批新增合同数应为40份，实际${Number(batch.imported_contract_count)}`,
    );
  }
  const summary = plainRecord(batch.summary_json);
  if (!summary) throw new Error("第二批导入摘要不存在或结构不正确");
  const correction = plainRecord(summary.auxiliaryClassificationCorrectionV1);
  if (
    Number(summary.rootContractCount) !== 41 ||
    Number(summary.costContractCount) !== 21 ||
    Number(summary.auxiliaryFileCount) !== 115 ||
    summary.semanticSha256 !== SECOND_HISTORICAL_SEMANTIC_SHA256 ||
    correction?.correctionKey !== SECOND_HISTORICAL_AUXILIARY_CORRECTION_KEY ||
    correction?.removedRootContractId !== SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID
  ) {
    throw new Error("第二批导入摘要不是完整的辅助材料归类更正态");
  }

  if (!Array.isArray(summary.importedRootIds)) {
    throw new Error("第二批导入摘要缺少 importedRootIds");
  }
  const importedRootIds = summary.importedRootIds.map((value) => String(value));
  if (
    importedRootIds.length !== 41 ||
    new Set(importedRootIds).size !== 41 ||
    importedRootIds.includes(SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID)
  ) {
    throw new Error("第二批导入摘要的 importedRootIds 应为41个唯一有效合同");
  }

  const financialLinkResultsValue = summary.financialLinkResults;
  let financialLinkRootIds: string[] | null = null;
  if (financialLinkResultsValue != null) {
    if (!Array.isArray(financialLinkResultsValue)) {
      throw new Error("第二批导入摘要的 financialLinkResults 结构不正确");
    }
    financialLinkRootIds = financialLinkResultsValue.map((value) => {
      const row = plainRecord(value);
      const rootId = optionalText(row?.rootId);
      if (!rootId) {
        throw new Error("第二批导入摘要的 financialLinkResults 缺少合同编号");
      }
      return rootId;
    });
    if (
      financialLinkRootIds.length !== 41 ||
      financialLinkRootIds.includes(SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID)
    ) {
      throw new Error("第二批导入摘要的 financialLinkResults 应为41个有效合同");
    }
    assertSameUniqueIds(
      financialLinkRootIds,
      importedRootIds,
      "第二批财务关系结果与导入合同集合",
    );
  } else if (target === "production") {
    throw new Error("第二批生产摘要缺少 financialLinkResults");
  }

  return { summary, importedRootIds, financialLinkRootIds };
}

export function isExactDragonLegacyInvoiceOcrSnapshot(
  actual: Record<string, unknown>,
  expectedContractId: string,
  fact: SecondHistoricalFinancialPlan,
): boolean {
  const snapshot = plainRecord(actual.ocr_snapshot);
  const expectedSnapshotKeys = [
    "amount",
    "businessDate",
    "recordId",
    "recordKind",
    "repairBatchKey",
    "source",
  ];
  return Boolean(
    snapshot &&
    expectedContractId === DRAGON_CONTRACT_ID &&
    fact.kind === "invoice" &&
    fact.invoiceNo === DRAGON_EXISTING_INVOICE_NO &&
    fact.source.hash === DRAGON_EXISTING_INVOICE_HASH &&
    fact.businessDate === "2023-09-05" &&
    cents(fact.amount) === 1_584_000 &&
    actual.contract_id === DRAGON_CONTRACT_ID &&
    actual.record_id === DRAGON_EXISTING_INVOICE_ID &&
    actual.invoice_no === DRAGON_EXISTING_INVOICE_NO &&
    actual.file_hash === DRAGON_EXISTING_INVOICE_HASH &&
    actual.ocr_job_id === DRAGON_EXISTING_OCR_JOB_ID &&
    actual.ocr_contract_id === DRAGON_CONTRACT_ID &&
    actual.ocr_file_hash === DRAGON_EXISTING_INVOICE_HASH &&
    actual.ocr_record_id === DRAGON_EXISTING_INVOICE_ID &&
    actual.ocr_record_kind === "invoice" &&
    JSON.stringify(Object.keys(snapshot).sort()) ===
      JSON.stringify(expectedSnapshotKeys) &&
    snapshot.source === "confirmed_historical_import" &&
    snapshot.repairBatchKey === DRAGON_LEGACY_REPAIR_BATCH_KEY &&
    snapshot.recordKind === "invoice" &&
    snapshot.recordId === DRAGON_EXISTING_INVOICE_ID &&
    snapshot.businessDate === "2023-09-05" &&
    cents(snapshot.amount) === 1_584_000,
  );
}

export async function loadSecondHistoricalReceiptEvidence(
  filePath: string,
  plan: SecondHistoricalImportPlan,
  expectedFileSha256: string | null,
): Promise<LoadedReceiptEvidence> {
  await assertRegularFilePathWithoutSymlinks(filePath, "回单复核文件");
  const fileBytes = await fs.promises.readFile(filePath);
  const fileSha256 = crypto
    .createHash("sha256")
    .update(fileBytes)
    .digest("hex");
  if (expectedFileSha256 && fileSha256 !== expectedFileSha256) {
    throw new Error("回单复核文件现场摘要与确认摘要不一致");
  }
  const document = plainRecord(JSON.parse(fileBytes.toString("utf8")));
  if (!document) throw new Error("回单复核文件结构不正确");
  if (document.sourceManifestHash !== plan.manifestHash) {
    throw new Error("回单复核文件与当前冻结源文件清单不一致");
  }
  const records = Array.isArray(document.records) ? document.records : [];
  if (Number(document.expectedReceiptCount) !== 97 || records.length !== 97) {
    throw new Error(`回单复核证据应为97份，实际${records.length}份`);
  }
  const settlementByPath = new Map(
    plan.roots.flatMap((root) =>
      root.financialFacts
        .filter((fact) => fact.kind !== "invoice")
        .map((fact) => [fact.source.relativePath, { root, fact }] as const),
    ),
  );
  if (settlementByPath.size !== 97) {
    throw new Error(
      `冻结计划回单或付款应为97份，实际${settlementByPath.size}份`,
    );
  }
  const recordsByPath = new Map<string, VerifiedReceiptEvidence>();
  for (const value of records) {
    const record = plainRecord(value);
    const recognition = plainRecord(record?.recognition);
    const consistency = plainRecord(record?.consistency);
    const relativePath = optionalText(record?.relativePath);
    if (!record || !recognition || !relativePath) {
      throw new Error("回单复核记录结构不完整");
    }
    if (recordsByPath.has(relativePath)) {
      throw new Error(`回单复核记录路径重复：${relativePath}`);
    }
    const expected = settlementByPath.get(relativePath);
    if (!expected)
      throw new Error(`回单复核文件出现计划外记录：${relativePath}`);
    const amount =
      recognition.amount == null ? null : Number(recognition.amount);
    const transactionDate = optionalText(recognition.transactionDate);
    if (
      recognition.status !== "recognized" ||
      !Number.isFinite(amount) ||
      cents(amount) !== cents(expected.fact.amount) ||
      transactionDate !== expected.fact.businessDate ||
      record.sha256 !== expected.fact.source.hash ||
      record.familyId !== expected.root.family.id
    ) {
      throw new Error(`回单复核记录与冻结计划不一致：${relativePath}`);
    }
    const conflicts = Array.isArray(consistency?.conflicts)
      ? consistency.conflicts.map(String)
      : [];
    recordsByPath.set(relativePath, {
      relativePath,
      familyId: String(record.familyId),
      sourceHash: String(record.sha256),
      payer: optionalText(recognition.payer),
      payerAccount: optionalText(recognition.payerAccount),
      payee: optionalText(recognition.payee),
      payeeAccount: optionalText(recognition.payeeAccount),
      electronicReceiptNo: optionalText(recognition.electronicReceiptNo),
      transactionSerialNo: optionalText(recognition.transactionSerialNo),
      transactionDate,
      amount,
      success: true,
      error: optionalText(recognition.error),
      rawTextSha256: optionalText(recognition.rawTextSha256),
      conflicts,
    });
  }
  for (const relativePath of settlementByPath.keys()) {
    if (!recordsByPath.has(relativePath)) {
      throw new Error(`回单复核文件遗漏冻结记录：${relativePath}`);
    }
  }
  return { fileSha256, recordsByPath };
}

function expectedStatus(root: SecondHistoricalRootPlan): string {
  const settlement = root.financialFacts
    .filter((fact) => fact.kind !== "invoice")
    .reduce((sum, fact) => sum + cents(fact.amount), 0);
  if (
    root.agreements.some(
      (agreement) => agreement.relationType === "termination",
    )
  ) {
    return "terminated";
  }
  if (settlement >= cents(root.currentAmount) && root.currentAmount > 0) {
    return "completed";
  }
  return settlement > 0 ? "executing" : "effective";
}

function sourceByPath(
  files: readonly SecondHistoricalSourceFile[],
): Map<string, SecondHistoricalSourceFile> {
  return new Map(files.map((file) => [file.relativePath, file]));
}

function financialExpectedByHash(
  roots: readonly SecondHistoricalRootPlan[],
): Map<
  string,
  { root: SecondHistoricalRootPlan; fact: SecondHistoricalFinancialPlan }
> {
  return new Map(
    roots.flatMap((root) =>
      root.financialFacts.map(
        (fact) => [fact.source.hash, { root, fact }] as const,
      ),
    ),
  );
}

function normalizedParty(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s（）()·•,，。；;:：'"“”‘’]/gu, "")
    .replace(/有限责任公司$/u, "有限公司")
    .toLowerCase();
}

function compatibleParty(actual: unknown, expected: string | null): boolean {
  const left = normalizedParty(actual);
  const right = normalizedParty(expected);
  return Boolean(
    left &&
    right &&
    (left === right || left.startsWith(right) || right.startsWith(left)),
  );
}

function assertReceiptEvidenceSnapshot(
  actual: Record<string, unknown>,
  expected: VerifiedReceiptEvidence,
  fact: SecondHistoricalFinancialPlan,
): void {
  const snapshot = plainRecord(actual.ocr_snapshot);
  const snapshotEvidence = plainRecord(snapshot?.receiptEvidence);
  if (
    !snapshot ||
    !snapshotEvidence ||
    snapshot.historicalConfirmed !== true ||
    snapshot.sourcePath !== fact.source.relativePath ||
    snapshot.sourceHash !== fact.source.hash ||
    cents(snapshot.amount) !== cents(fact.amount) ||
    snapshot.businessDate !== fact.businessDate
  ) {
    throw new Error(`财务OCR快照来源不一致：${fact.source.relativePath}`);
  }
  const textFields = [
    "relativePath",
    "payer",
    "payerAccount",
    "payee",
    "payeeAccount",
    "electronicReceiptNo",
    "transactionSerialNo",
    "transactionDate",
    "error",
    "rawTextSha256",
  ] as const;
  for (const field of textFields) {
    if (optionalText(snapshotEvidence[field]) !== expected[field]) {
      throw new Error(
        `回单复核证据${field}与数据库OCR快照不一致：${fact.source.relativePath}`,
      );
    }
  }
  const snapshotConflicts = Array.isArray(snapshotEvidence.conflicts)
    ? snapshotEvidence.conflicts.map(String)
    : [];
  if (
    cents(snapshotEvidence.amount) !== cents(expected.amount) ||
    snapshotEvidence.success !== expected.success ||
    JSON.stringify(snapshotConflicts) !== JSON.stringify(expected.conflicts)
  ) {
    throw new Error(
      `回单复核证据与数据库OCR快照不一致：${fact.source.relativePath}`,
    );
  }
  if (
    !compatibleParty(actual.settlement_payer, expected.payer) ||
    !compatibleParty(actual.settlement_payee, expected.payee) ||
    optionalText(actual.payer_account) !== expected.payerAccount ||
    optionalText(actual.payee_account) !== expected.payeeAccount ||
    optionalText(actual.electronic_receipt_no) !==
      expected.electronicReceiptNo ||
    optionalText(actual.transaction_serial_no) !== expected.transactionSerialNo
  ) {
    throw new Error(
      `回单业务字段与冻结复核证据不一致：${fact.source.relativePath}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseSecondHistoricalVerificationArguments(
    process.argv.slice(2),
  );
  assertSecondHistoricalVerificationEnvironment(args);
  const plan = await buildSecondHistoricalImportPlan(args.sourceRoot);
  const semanticSha256 = calculateSecondHistoricalSemanticSha256(plan);
  if (
    args.target === "production" &&
    (semanticSha256 !== SECOND_HISTORICAL_SEMANTIC_SHA256 ||
      args.semanticSha256 !== semanticSha256)
  ) {
    throw new Error("第二批生产语义摘要与冻结值不一致");
  }
  const receiptEvidence = args.receiptOcrPath
    ? await loadSecondHistoricalReceiptEvidence(
        args.receiptOcrPath,
        plan,
        args.receiptOcrSha256,
      )
    : null;
  if (
    args.target === "production" &&
    receiptEvidence?.fileSha256 !== SECOND_HISTORICAL_RECEIPT_OCR_SHA256
  ) {
    throw new Error("生产回单复核文件现场摘要与冻结值不一致");
  }
  const { pool } = await import("../db/index.js");
  const client = await pool.connect();
  let transactionOpen = false;
  let destroyClient = false;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const db = createReadOnlyVerificationDatabase(client);
    const database = await db.get<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    if (database?.database_name !== "yulilog_worklog") {
      throw new Error(
        `第二批验收数据库名称不正确：${database?.database_name || "未知"}`,
      );
    }
    const batch = await db.get<Record<string, unknown>>(
      `SELECT manifest_hash,status,imported_contract_count,summary_json
       FROM contract_historical_import_batches
       WHERE batch_key=? AND status='completed'`,
      SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    );
    if (!batch || batch.manifest_hash !== plan.manifestHash) {
      throw new Error("第二批导入批次不存在或清单摘要不一致");
    }
    const correctedBatch = assertSecondHistoricalCorrectedBatchState(
      batch,
      args.target,
    );
    const targetDatabaseSha256 =
      args.target === "production"
        ? await calculateSecondHistoricalTargetDatabaseSha256(client, plan)
        : null;
    if (args.target === "production") {
      if (
        args.targetDatabaseSha256 !== targetDatabaseSha256 ||
        correctedBatch.summary.semanticSha256 !== semanticSha256 ||
        correctedBatch.summary.targetDatabaseSha256 !== targetDatabaseSha256
      ) {
        throw new Error("第二批生产批次的语义摘要或目标数据库指纹不一致");
      }
    }

    const mappings = await db.all<Record<string, unknown>>(
      `SELECT mapping.*,
         contract_file.file_hash AS contract_file_hash,
         contract_file.file_size AS contract_file_size,
         contract_file.file_path AS contract_file_path,
         contract_file.contract_id AS contract_file_contract_id,
         auxiliary_file.file_hash AS auxiliary_file_hash,
         auxiliary_file.file_size AS auxiliary_file_size,
         auxiliary_file.file_path AS auxiliary_file_path,
         auxiliary_file.package_id AS auxiliary_file_package_id,
         auxiliary_package.parent_contract_id AS auxiliary_parent_contract_id,
         auxiliary_package.accounting_included AS auxiliary_accounting_included
       FROM contract_historical_import_files mapping
       LEFT JOIN contract_files contract_file
         ON contract_file.id=mapping.contract_file_id
       LEFT JOIN contract_auxiliary_files auxiliary_file
         ON auxiliary_file.id=mapping.auxiliary_file_id
       LEFT JOIN contract_auxiliary_packages auxiliary_package
         ON auxiliary_package.id=auxiliary_file.package_id
       WHERE mapping.batch_key=? ORDER BY mapping.source_path`,
      SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    );
    if (mappings.length !== plan.sourceFiles.length) {
      throw new Error(
        `源文件映射应为${plan.sourceFiles.length}份，实际${mappings.length}份`,
      );
    }
    const plannedSource = sourceByPath(plan.sourceFiles);
    const mappingByPath = new Map<string, Record<string, unknown>>();
    for (const mapping of mappings) {
      const relativePath = String(mapping.source_path);
      const expected = plannedSource.get(relativePath);
      if (!expected) throw new Error(`数据库出现清单外源文件：${relativePath}`);
      if (mappingByPath.has(relativePath)) {
        throw new Error(`数据库源文件映射路径重复：${relativePath}`);
      }
      mappingByPath.set(relativePath, mapping);
      if (
        mapping.source_hash !== expected.hash ||
        Number(mapping.source_bytes) !== expected.bytes
      ) {
        throw new Error(`源文件映射摘要或大小不一致：${relativePath}`);
      }
      const storedHash = String(
        mapping.contract_file_hash || mapping.auxiliary_file_hash || "",
      );
      const storedSize = Number(
        mapping.contract_file_size || mapping.auxiliary_file_size || 0,
      );
      const storedPath = String(
        mapping.contract_file_path || mapping.auxiliary_file_path || "",
      );
      if (storedHash !== expected.hash || storedSize !== expected.bytes) {
        throw new Error(`落库文件摘要或大小不一致：${relativePath}`);
      }
      if (
        mapping.auxiliary_file_id &&
        (mapping.accounting_included !== false ||
          mapping.auxiliary_accounting_included !== false)
      ) {
        throw new Error(`辅助材料错误进入核算：${relativePath}`);
      }
      const absolutePath = resolveSecondHistoricalStoredPath(storedPath);
      const stat = await assertRegularFilePathWithoutSymlinks(
        absolutePath,
        "落库物理文件",
      );
      if (stat.size !== expected.bytes) {
        throw new Error(`落库物理文件不存在或大小不一致：${relativePath}`);
      }
      if ((await sha256File(absolutePath)) !== expected.hash) {
        throw new Error(`落库物理文件摘要不一致：${relativePath}`);
      }
    }

    const obsoleteState = await db.get<Record<string, unknown>>(
      `SELECT
        (SELECT COUNT(*)::int FROM contracts
          WHERE id=?) AS obsolete_contract_count,
        (SELECT COUNT(*)::int FROM contract_files
          WHERE id=ANY(?::text[])) AS obsolete_file_count,
        (SELECT COUNT(*)::int FROM contract_financial_file_hashes
          WHERE file_id=ANY(?::text[])) AS obsolete_financial_registry_count,
        (SELECT COUNT(*)::int FROM contract_historical_import_files
          WHERE batch_key=? AND (
            contract_id=? OR contract_file_id=ANY(?::text[])
          )) AS obsolete_mapping_count,
        (SELECT COUNT(*)::int FROM contract_historical_import_files
          WHERE batch_key=?
            AND target_kind='existing_contract_archive')
          AS existing_archive_mapping_count`,
      SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID,
      [...SECOND_HISTORICAL_OBSOLETE_CONTRACT_FILE_IDS],
      [...SECOND_HISTORICAL_OBSOLETE_CONTRACT_FILE_IDS],
      SECOND_HISTORICAL_IMPORT_BATCH_KEY,
      SECOND_HISTORICAL_OBSOLETE_CONTRACT_ID,
      [...SECOND_HISTORICAL_OBSOLETE_CONTRACT_FILE_IDS],
      SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    );
    if (
      Number(obsoleteState?.obsolete_contract_count || 0) !== 0 ||
      Number(obsoleteState?.obsolete_file_count || 0) !== 0 ||
      Number(obsoleteState?.obsolete_financial_registry_count || 0) !== 0 ||
      Number(obsoleteState?.obsolete_mapping_count || 0) !== 0 ||
      Number(obsoleteState?.existing_archive_mapping_count || 0) !== 0
    ) {
      throw new Error("第二批更正后仍存在废弃合同、废弃合同文件或旧档案映射");
    }

    const importedAudits = await db.all<{ contract_id: string }>(
      `SELECT contract_id FROM contract_audit_logs
       WHERE action='historical_contract_imported'
         AND changes_json->>'batchKey'=?
       ORDER BY contract_id`,
      SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    );
    const rootIds = [...new Set(importedAudits.map((row) => row.contract_id))];
    if (
      importedAudits.length !== plan.roots.length ||
      rootIds.length !== plan.roots.length
    ) {
      throw new Error(
        `主合同审计应为${plan.roots.length}份且不得重复，实际${importedAudits.length}条／${rootIds.length}个合同`,
      );
    }
    assertSameUniqueIds(
      correctedBatch.importedRootIds,
      rootIds,
      "第二批摘要与主合同审计集合",
    );
    const roots = await db.all<Record<string, unknown>>(
      `SELECT * FROM contracts WHERE id=ANY(?::text[]) ORDER BY id`,
      rootIds,
    );
    const rootBySourceHash = new Map<string, Record<string, unknown>>();
    const rootIdByKey = new Map<string, string>();
    for (const row of roots) {
      const audit = await db.get<{ source_hash: string }>(
        `SELECT changes_json->>'sourceHash' AS source_hash
         FROM contract_audit_logs
         WHERE contract_id=? AND action='historical_contract_imported'
           AND changes_json->>'batchKey'=?
         ORDER BY created_at DESC,id DESC LIMIT 1`,
        row.id,
        SECOND_HISTORICAL_IMPORT_BATCH_KEY,
      );
      if (!audit?.source_hash)
        throw new Error(`主合同缺少源文件审计：${row.id}`);
      rootBySourceHash.set(audit.source_hash, row);
    }
    for (const expected of plan.roots) {
      const row = rootBySourceHash.get(expected.source.hash);
      if (!row)
        throw new Error(`主合同没有落库：${expected.source.relativePath}`);
      const expectedTarget = expected.family.target;
      const checks: Array<[boolean, string]> = [
        [row.project_name === expected.projectName, "项目名称"],
        [row.party_a === expected.family.partyA, "甲方"],
        [row.party_b === expected.family.partyB, "乙方"],
        [(row.party_c || null) === (expected.family.partyC || null), "丙方"],
        [row.declared_category === expected.family.category, "合同大类"],
        [row.declared_subtype === expected.family.declaredSubtype, "二级分类"],
        [row.financial_direction === expected.financialDirection, "财务方向"],
        [row.area === expected.family.area, "行政区"],
        [row.contract_date === expected.contractDate, "合同日期"],
        [
          cents(row.current_effective_amount) === cents(expected.currentAmount),
          "合同金额",
        ],
        [row.status === expectedStatus(expected), "合同状态"],
        [
          (row.business_contract_no || null) === expected.businessContractNo,
          "原件合同编号",
        ],
        [Boolean(row.is_deleted) === false, "删除状态"],
        [
          Boolean(row.requires_auxiliary_materials) ===
            expected.auxiliaryFiles.length > 0,
          "辅助材料要求",
        ],
        [
          (row.pricing_mode || "fixed") ===
            (expectedTarget ? "target" : "fixed"),
          "计价模式",
        ],
      ];
      const failed = checks.find(([ok]) => !ok);
      if (failed) {
        throw new Error(`${expected.source.relativePath}的${failed[1]}不一致`);
      }
      if (
        expectedTarget &&
        (cents(row.target_amount) !== cents(expectedTarget.amount) ||
          Number(row.target_quantity) !== expectedTarget.quantity ||
          cents(row.unit_price) !== cents(expectedTarget.unitPrice) ||
          Number(row.confirmed_quantity) !== expectedTarget.confirmedQuantity ||
          cents(row.confirmed_contract_amount) !==
            cents(expectedTarget.confirmedAmount) ||
          row.quantity_unit !== expectedTarget.quantityUnit)
      ) {
        throw new Error("裕和嘉园目标金额或当前确认值不一致");
      }
      rootIdByKey.set(expected.key, String(row.id));
    }

    const expectedAgreements = plan.roots.flatMap((root) =>
      root.agreements.map((agreement) => ({ root, agreement })),
    );
    if (expectedAgreements.length !== 6) {
      throw new Error(
        `冻结计划补充协议应为6份，实际${expectedAgreements.length}份`,
      );
    }
    const agreementRows = await db.all<Record<string, unknown>>(
      `SELECT agreement.id,agreement.parent_contract_id,
         agreement.root_contract_id,agreement.relation_type,
         agreement.status,agreement.amount_delta,
         agreement.amount_before_change,agreement.amount_after_change,
         agreement.supplement_sequence,agreement.contract_date,
         agreement.is_deleted,audit.action,audit.changes_json
       FROM contract_audit_logs audit
       JOIN contracts agreement ON agreement.id=audit.contract_id
       WHERE audit.action IN (
         'historical_supplement_imported','historical_termination_imported'
       ) AND audit.changes_json->>'batchKey'=?
       ORDER BY agreement.id,audit.id`,
      SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    );
    if (
      agreementRows.length !== 6 ||
      new Set(agreementRows.map((row) => String(row.id))).size !== 6
    ) {
      throw new Error(
        `本批关联协议应为6份且审计唯一，实际${agreementRows.length}条`,
      );
    }
    const agreementBySourcePath = new Map<string, Record<string, unknown>>();
    for (const row of agreementRows) {
      const changes = plainRecord(row.changes_json);
      const sourcePath = optionalText(changes?.sourcePath);
      if (!sourcePath || agreementBySourcePath.has(sourcePath)) {
        throw new Error("本批关联协议缺少唯一源文件路径审计");
      }
      agreementBySourcePath.set(sourcePath, row);
    }
    for (const { root, agreement } of expectedAgreements) {
      const row = agreementBySourcePath.get(agreement.source.relativePath);
      const expectedRootId = rootIdByKey.get(root.key);
      if (!row || !expectedRootId) {
        throw new Error(`补充协议没有落库：${agreement.source.relativePath}`);
      }
      if (
        row.id !==
          secondHistoricalStableId(
            "agreement",
            agreement.source.relativePath,
          ) ||
        row.parent_contract_id !== expectedRootId ||
        row.root_contract_id !== expectedRootId ||
        row.relation_type !== agreement.relationType ||
        row.status !== "effective" ||
        cents(row.amount_delta) !== cents(agreement.amountDelta) ||
        cents(row.amount_before_change) !== cents(agreement.amountBefore) ||
        cents(row.amount_after_change) !== cents(agreement.amountAfter) ||
        Number(row.supplement_sequence) !== Number(agreement.sequence) ||
        row.contract_date !== agreement.contractDate ||
        Boolean(row.is_deleted)
      ) {
        throw new Error(`补充协议字段不一致：${agreement.source.relativePath}`);
      }
    }

    if (
      plan.assignments.length !== plan.sourceFiles.length ||
      plan.assignments.length !== mappings.length
    ) {
      throw new Error("冻结源文件、计划归属和数据库映射数量不一致");
    }
    const expectedTargetKindCounts: Readonly<Record<string, number>> = {
      agreement: 6,
      archive: 2,
      auxiliary: 115,
      financial: 219,
      sealed_contract: 41,
      void_invoice: 1,
    };
    const actualTargetKindCounts = new Map<string, number>();
    for (const assignment of plan.assignments) {
      const mapping = mappingByPath.get(assignment.relativePath);
      const source = plannedSource.get(assignment.relativePath);
      const expectedRootId = rootIdByKey.get(assignment.rootKey);
      if (!mapping || !source || !expectedRootId) {
        throw new Error(`源文件归属缺失：${assignment.relativePath}`);
      }
      const expectedContractId =
        assignment.target === "agreement"
          ? String(agreementBySourcePath.get(assignment.relativePath)?.id || "")
          : expectedRootId;
      let expectedTargetKind: string = assignment.target;
      if (assignment.target === "archive" && source.kind === "void_invoice") {
        expectedTargetKind = "void_invoice";
      }
      if (
        mapping.contract_id !== expectedContractId ||
        mapping.family_key !== assignment.familyId ||
        mapping.target_kind !== expectedTargetKind ||
        mapping.accounting_included !== assignment.accountingIncluded
      ) {
        throw new Error(`源文件映射业务归属不一致：${assignment.relativePath}`);
      }
      if (expectedTargetKind === "auxiliary") {
        if (
          mapping.contract_file_id != null ||
          !mapping.auxiliary_file_id ||
          mapping.auxiliary_parent_contract_id !== expectedContractId ||
          !mapping.auxiliary_file_package_id
        ) {
          throw new Error(
            `辅助材料与父合同或档案包归属不一致：${assignment.relativePath}`,
          );
        }
      } else if (
        !mapping.contract_file_id ||
        mapping.auxiliary_file_id != null ||
        mapping.contract_file_contract_id !== expectedContractId
      ) {
        throw new Error(
          `合同档案文件与合同归属不一致：${assignment.relativePath}`,
        );
      }
      actualTargetKindCounts.set(
        expectedTargetKind,
        (actualTargetKindCounts.get(expectedTargetKind) || 0) + 1,
      );
    }
    for (const [targetKind, expectedCount] of Object.entries(
      expectedTargetKindCounts,
    )) {
      if (actualTargetKindCounts.get(targetKind) !== expectedCount) {
        throw new Error(
          `源文件映射类型${targetKind}应为${expectedCount}份，实际${actualTargetKindCounts.get(targetKind) || 0}份`,
        );
      }
    }
    if (actualTargetKindCounts.has("existing_contract_archive")) {
      throw new Error("龙潭湖辅助材料仍被错误映射为既有合同档案");
    }
    const staleDragonFiles = await db.get<{ count: number }>(
      `SELECT (
         (SELECT COUNT(*) FROM contract_files WHERE id=ANY(?::text[])) +
         (SELECT COUNT(*) FROM contract_financial_file_hashes
           WHERE file_hash=? OR file_id=ANY(?::text[]))
       )::int AS count`,
      [...DRAGON_LEGACY_AUXILIARY_CONTRACT_FILE_IDS],
      DRAGON_STALE_VOID_INVOICE_HASH,
      [...DRAGON_LEGACY_AUXILIARY_CONTRACT_FILE_IDS],
    );
    if (Number(staleDragonFiles?.count || 0) !== 0) {
      throw new Error("龙潭湖误归档附件或作废票陈旧财务摘要仍然存在");
    }

    const financialByHash = financialExpectedByHash(plan.roots);
    if (financialByHash.size !== 219) {
      throw new Error(
        `冻结计划财务原件应为219份，实际${financialByHash.size}份`,
      );
    }
    const actualFinancial = await db.all<Record<string, unknown>>(
      `SELECT registry.file_hash,registry.contract_id,
         COALESCE(invoice.id,receipt.id,payment.id) AS record_id,
         CASE WHEN invoice.id IS NOT NULL THEN 'invoice'
           WHEN receipt.id IS NOT NULL THEN 'receipt' ELSE 'payment' END AS kind,
         COALESCE(invoice.amount,receipt.amount,payment.amount) AS amount,
         COALESCE(invoice.invoice_date,receipt.receipt_date,payment.payment_date) AS business_date,
         invoice.invoice_no,
         COALESCE(receipt.payer,payment.payer) AS settlement_payer,
         COALESCE(receipt.payer_account,payment.payer_account) AS payer_account,
         COALESCE(receipt.payee,payment.payee) AS settlement_payee,
         COALESCE(receipt.payee_account,payment.payee_account) AS payee_account,
         COALESCE(receipt.electronic_receipt_no,payment.electronic_receipt_no) AS electronic_receipt_no,
         COALESCE(receipt.transaction_serial_no,payment.transaction_serial_no) AS transaction_serial_no,
         ocr.id AS ocr_job_id,ocr.contract_id AS ocr_contract_id,
         ocr.file_hash AS ocr_file_hash,ocr.record_id AS ocr_record_id,
         ocr.record_kind AS ocr_record_kind,
         ocr.recognition_method,ocr.status AS ocr_status,
         ocr.snapshot_json AS ocr_snapshot
       FROM contract_financial_file_hashes registry
       JOIN contract_historical_import_files mapping
         ON mapping.batch_key=? AND mapping.source_hash=registry.file_hash
           AND mapping.accounting_included=TRUE
       LEFT JOIN contract_invoices invoice ON invoice.file_id=registry.file_id
       LEFT JOIN contract_receipts receipt ON receipt.file_id=registry.file_id
       LEFT JOIN contract_payments payment ON payment.file_id=registry.file_id
       LEFT JOIN contract_financial_ocr_jobs ocr
         ON ocr.id=COALESCE(invoice.financial_ocr_job_id,
           receipt.financial_ocr_job_id,payment.financial_ocr_job_id)
       ORDER BY registry.file_hash`,
      SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    );
    if (actualFinancial.length !== financialByHash.size) {
      throw new Error(
        `财务记录应为${financialByHash.size}笔，实际${actualFinancial.length}笔`,
      );
    }
    for (const actual of actualFinancial) {
      const expected = financialByHash.get(String(actual.file_hash));
      if (!expected) throw new Error(`出现清单外财务记录：${actual.file_hash}`);
      const expectedContractId = rootIdByKey.get(expected.root.key);
      if (
        !expectedContractId ||
        actual.contract_id !== expectedContractId ||
        actual.kind !== expected.fact.kind ||
        cents(actual.amount) !== cents(expected.fact.amount) ||
        actual.business_date !== expected.fact.businessDate ||
        (expected.fact.kind === "invoice" &&
          actual.invoice_no !== expected.fact.invoiceNo) ||
        actual.ocr_contract_id !== expectedContractId ||
        actual.ocr_file_hash !== expected.fact.source.hash ||
        actual.ocr_record_id !== actual.record_id ||
        actual.ocr_record_kind !== expected.fact.kind ||
        actual.recognition_method !== "historical_confirmed_import" ||
        actual.ocr_status !== "consumed"
      ) {
        throw new Error(
          `财务记录字段不一致：${expected.fact.source.relativePath}`,
        );
      }
      const snapshot = plainRecord(actual.ocr_snapshot);
      const currentSnapshotMatches = Boolean(
        snapshot &&
        snapshot.sourcePath === expected.fact.source.relativePath &&
        snapshot.sourceHash === expected.fact.source.hash &&
        cents(snapshot.amount) === cents(expected.fact.amount) &&
        snapshot.businessDate === expected.fact.businessDate,
      );
      if (
        !currentSnapshotMatches &&
        !isExactDragonLegacyInvoiceOcrSnapshot(
          actual,
          expectedContractId,
          expected.fact,
        )
      ) {
        throw new Error(
          `财务OCR快照与冻结计划不一致：${expected.fact.source.relativePath}`,
        );
      }
      if (expected.fact.kind !== "invoice") {
        const evidence = receiptEvidence?.recordsByPath.get(
          expected.fact.source.relativePath,
        );
        if (args.target === "production" && !evidence) {
          throw new Error(
            `生产验收缺少回单复核证据：${expected.fact.source.relativePath}`,
          );
        }
        if (evidence) {
          assertReceiptEvidenceSnapshot(actual, evidence, expected.fact);
        }
      }
    }

    const expectedFinancialRoots = plan.roots.filter(
      (root) => root.financialFacts.length > 0,
    );
    const expectedNoFinancialRoots = plan.roots.filter(
      (root) => root.financialFacts.length === 0,
    );
    if (
      expectedFinancialRoots.length !== 41 ||
      expectedNoFinancialRoots.length !== 0
    ) {
      throw new Error(
        `导入计划财务根口径异常：有财务资料${expectedFinancialRoots.length}份、无财务资料${expectedNoFinancialRoots.length}份`,
      );
    }

    const registrations = await db.all<ActiveFinancialRegistrationRow>(
      `SELECT registration.id,registration.contract_id,
         registration.settlement_kind,registration.status,
         COALESCE(item_summary.item_count,0)::int AS item_count,
         COALESCE(item_summary.invoice_total,0)::text AS invoice_total,
         COALESCE(item_summary.settlement_total,0)::text AS settlement_total,
         COALESCE(match_summary.allocated_total,0)::text AS allocated_total
       FROM contract_financial_registrations registration
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS item_count,
           COALESCE(SUM(CASE WHEN item.item_kind='invoice'
             THEN invoice.amount ELSE 0 END),0) AS invoice_total,
           COALESCE(SUM(CASE WHEN item.item_kind IN ('receipt','payment')
             THEN COALESCE(receipt.amount,payment.amount,0) ELSE 0 END),0)
             AS settlement_total
         FROM contract_financial_registration_items item
         LEFT JOIN contract_invoices invoice
           ON item.item_kind='invoice' AND invoice.id=item.record_id
         LEFT JOIN contract_receipts receipt
           ON item.item_kind='receipt' AND receipt.id=item.record_id
         LEFT JOIN contract_payments payment
           ON item.item_kind='payment' AND payment.id=item.record_id
         WHERE item.registration_id=registration.id
       ) item_summary ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(match.allocated_amount),0) AS allocated_total
         FROM contract_financial_registration_matches match
         WHERE match.registration_id=registration.id
       ) match_summary ON TRUE
       WHERE registration.contract_id=ANY(?::text[])
         AND registration.status<>'reversed'
       ORDER BY registration.contract_id,registration.id`,
      rootIds,
    );
    const registrationByContract = new Map<
      string,
      ActiveFinancialRegistrationRow[]
    >();
    for (const registration of registrations) {
      const rows = registrationByContract.get(registration.contract_id) || [];
      rows.push(registration);
      registrationByContract.set(registration.contract_id, rows);
    }

    const financialItems = await db.all<FinancialRegistrationItemRow>(
      `SELECT item.id,item.registration_id,item.contract_id,
         item.item_kind,item.record_id
       FROM contract_financial_registration_items item
       JOIN contract_financial_registrations registration
         ON registration.id=item.registration_id
       WHERE registration.contract_id=ANY(?::text[])
         AND registration.status<>'reversed'
       ORDER BY item.registration_id,item.created_at,item.id`,
      rootIds,
    );
    if (financialItems.length !== 219) {
      throw new Error(
        `本批财务登记明细应为219条，实际${financialItems.length}条`,
      );
    }
    const actualFinancialByRecordId = new Map(
      actualFinancial.map((record) => [String(record.record_id), record]),
    );
    for (const item of financialItems) {
      const actual = actualFinancialByRecordId.get(item.record_id);
      if (!actual) {
        throw new Error(`财务登记混入本批清单外记录：${item.record_id}`);
      }
      if (
        item.contract_id !== actual.contract_id ||
        item.item_kind !== actual.kind
      ) {
        throw new Error(`财务登记明细归属或类型错误：${item.id}`);
      }
    }
    if (
      new Set(financialItems.map((item) => item.record_id)).size !==
      actualFinancial.length
    ) {
      throw new Error("本批财务记录与登记明细不是一一对应");
    }

    const financialMatches = await db.all<Record<string, unknown>>(
      `SELECT match.id,match.registration_id,match.contract_id,
         match.allocated_amount,invoice_item.item_kind AS invoice_kind,
         settlement_item.item_kind AS settlement_kind,
         invoice_item.registration_id AS invoice_registration_id,
         settlement_item.registration_id AS settlement_registration_id,
         invoice_item.contract_id AS invoice_contract_id,
         settlement_item.contract_id AS settlement_contract_id
       FROM contract_financial_registration_matches match
       JOIN contract_financial_registrations registration
         ON registration.id=match.registration_id
       JOIN contract_financial_registration_items invoice_item
         ON invoice_item.id=match.invoice_item_id
       JOIN contract_financial_registration_items settlement_item
         ON settlement_item.id=match.settlement_item_id
       WHERE registration.contract_id=ANY(?::text[])
         AND registration.status<>'reversed'
       ORDER BY match.registration_id,match.id`,
      rootIds,
    );
    if (financialMatches.length !== 156) {
      throw new Error(
        `本批财务匹配关系应为156条，实际${financialMatches.length}条`,
      );
    }
    for (const match of financialMatches) {
      if (
        match.invoice_kind !== "invoice" ||
        !["receipt", "payment"].includes(String(match.settlement_kind)) ||
        match.invoice_registration_id !== match.registration_id ||
        match.settlement_registration_id !== match.registration_id ||
        match.invoice_contract_id !== match.contract_id ||
        match.settlement_contract_id !== match.contract_id ||
        cents(match.allocated_amount) <= 0
      ) {
        throw new Error(`财务匹配关系不完整或跨合同：${match.id}`);
      }
    }

    let confirmedRegistrationCount = 0;
    let draftRegistrationCount = 0;
    let noFinancialRegistrationCount = 0;
    let targetRegistration: ActiveFinancialRegistrationRow | null = null;
    for (const expected of plan.roots) {
      const contract = rootBySourceHash.get(expected.source.hash);
      if (!contract) {
        throw new Error(
          `无法定位财务闭环所属合同：${expected.source.relativePath}`,
        );
      }
      const active = registrationByContract.get(String(contract.id)) || [];
      if (!expected.financialFacts.length) {
        if (active.length !== 0) {
          throw new Error(
            `无财务资料合同不应生成登记：${expected.projectName}`,
          );
        }
        noFinancialRegistrationCount += 1;
        continue;
      }
      if (active.length !== 1) {
        throw new Error(
          `${expected.projectName}应有且仅有一条未反冲登记，实际${active.length}条`,
        );
      }
      const registration = active[0]!;
      const expectedInvoiceCents = expected.financialFacts
        .filter((fact) => fact.kind === "invoice")
        .reduce((sum, fact) => sum + cents(fact.amount), 0);
      const expectedSettlementCents = expected.financialFacts
        .filter((fact) => fact.kind !== "invoice")
        .reduce((sum, fact) => sum + cents(fact.amount), 0);
      const expectedSettlementKind =
        expected.financialDirection === "income" ? "receipt" : "payment";
      const expectedAllocatedCents = Math.min(
        expectedInvoiceCents,
        expectedSettlementCents,
      );
      if (
        registration.settlement_kind !== expectedSettlementKind ||
        registration.item_count !== expected.financialFacts.length ||
        cents(registration.invoice_total) !== expectedInvoiceCents ||
        cents(registration.settlement_total) !== expectedSettlementCents ||
        cents(registration.allocated_total) !== expectedAllocatedCents
      ) {
        throw new Error(
          `财务登记金额、明细或方向不一致：${expected.projectName}`,
        );
      }
      const expectedRegistrationStatus =
        expectedInvoiceCents > 0 &&
        expectedInvoiceCents === expectedSettlementCents
          ? "confirmed"
          : "draft";
      if (registration.status !== expectedRegistrationStatus) {
        throw new Error(`财务登记闭环状态不一致：${expected.projectName}`);
      }
      if (registration.status === "confirmed") confirmedRegistrationCount += 1;
      else draftRegistrationCount += 1;
      if (expected.family.target) targetRegistration = registration;
    }
    if (
      registrations.length !== 41 ||
      confirmedRegistrationCount !== 39 ||
      draftRegistrationCount !== 2 ||
      noFinancialRegistrationCount !== 0
    ) {
      throw new Error(
        `财务登记总口径不一致：登记${registrations.length}条、已闭环${confirmedRegistrationCount}条、待补${draftRegistrationCount}条、无财务根${noFinancialRegistrationCount}条`,
      );
    }

    const totals = await db.get<Record<string, unknown>>(
      `SELECT
         COUNT(DISTINCT CASE WHEN mapping.accounting_included THEN mapping.source_path END)::int AS financial_file_count,
         COUNT(DISTINCT CASE WHEN mapping.auxiliary_file_id IS NOT NULL THEN mapping.source_path END)::int AS auxiliary_file_count,
         COALESCE(SUM(DISTINCT CASE WHEN invoice.id IS NOT NULL THEN invoice.amount END),0) AS unused
       FROM contract_historical_import_files mapping
       LEFT JOIN contract_invoices invoice ON invoice.file_id=mapping.contract_file_id
       WHERE mapping.batch_key=?`,
      SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    );
    if (Number(totals?.financial_file_count) !== 219) {
      throw new Error("发票与回单／付款原件总数不是219份");
    }
    if (Number(totals?.auxiliary_file_count) !== 115) {
      throw new Error("辅助材料原件总数不是115份");
    }
    const targetHistory = await db.all<Record<string, unknown>>(
      `SELECT history.* FROM contract_target_amount_changes history
       JOIN contract_historical_import_files mapping
         ON mapping.contract_id=history.contract_id
        AND mapping.batch_key=?
       WHERE history.change_no=0
       GROUP BY history.id ORDER BY history.id`,
      SECOND_HISTORICAL_IMPORT_BATCH_KEY,
    );
    if (
      targetHistory.length !== 1 ||
      cents(targetHistory[0]?.new_target_amount) !== 99_600_000 ||
      Number(targetHistory[0]?.new_target_quantity) !== 996 ||
      Number(targetHistory[0]?.new_unit_price) !== 1000
    ) {
      throw new Error("可变目标金额初始历史不完整");
    }
    const dragon = roots.find((row) => row.id === DRAGON_CONTRACT_ID);
    if (!dragon || dragon.status !== "completed" || dragon.is_deleted) {
      throw new Error("龙潭湖合同未按原编号恢复并完成闭环");
    }
    const dragonRegistration =
      registrationByContract.get(DRAGON_CONTRACT_ID)?.[0] || null;
    if (
      !dragonRegistration ||
      dragonRegistration.status !== "confirmed" ||
      cents(dragonRegistration.invoice_total) !== 1_584_000 ||
      cents(dragonRegistration.settlement_total) !== 1_584_000 ||
      cents(dragonRegistration.allocated_total) !== 1_584_000
    ) {
      throw new Error("龙潭湖发票与回单未完整匹配，仍存在待补差额");
    }
    if (
      !targetRegistration ||
      targetRegistration.status !== "confirmed" ||
      cents(targetRegistration.invoice_total) !== 84_500_000 ||
      cents(targetRegistration.settlement_total) !== 84_500_000 ||
      cents(targetRegistration.allocated_total) !== 84_500_000
    ) {
      throw new Error("裕和嘉园目标金额合同的当前财务资料未闭环");
    }

    const result = {
      verifiedAt: new Date().toISOString(),
      target: args.target,
      database: database.database_name,
      batchKey: SECOND_HISTORICAL_IMPORT_BATCH_KEY,
      manifestHash: plan.manifestHash,
      semanticSha256,
      targetDatabaseSha256,
      receiptOcrSha256: receiptEvidence?.fileSha256 || null,
      sourceFiles: `${mappings.length}/${plan.sourceFiles.length}`,
      physicalFilesVerified: mappings.length,
      rootContracts: `${roots.length}/${plan.roots.length}`,
      agreements: plan.summary.supplementCount + plan.summary.terminationCount,
      financialRecords: actualFinancial.length,
      financialRegistrations: {
        active: registrations.length,
        confirmed: confirmedRegistrationCount,
        draft: draftRegistrationCount,
        noFinancialRoots: noFinancialRegistrationCount,
        items: financialItems.length,
        matches: financialMatches.length,
      },
      receiptEvidence: `${plan.summary.receiptCount + plan.summary.paymentCount}/97`,
      correctedBatch: {
        importedContractCount: Number(batch.imported_contract_count),
        importedRootIds: correctedBatch.importedRootIds.length,
        financialLinkResults:
          correctedBatch.financialLinkRootIds?.length ?? null,
        obsoleteRecordsPresent: false,
        correctionKey: SECOND_HISTORICAL_AUXILIARY_CORRECTION_KEY,
      },
      targetAmountHistory: targetHistory.length,
      targetCurrentFinancialsClosed: true,
      dragonRestored: true,
      dragonFinancialPendingAmount: 0,
      summary: plan.summary,
    };
    await client.query("COMMIT");
    transactionOpen = false;
    if (args.outputPath) {
      await fs.promises.mkdir(path.dirname(args.outputPath), {
        recursive: true,
      });
      await fs.promises.writeFile(
        args.outputPath,
        `${JSON.stringify(result, null, 2)}\n`,
      );
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyClient = true;
      }
    }
    throw error;
  } finally {
    client.release(destroyClient);
    await pool.end();
  }
}

function printHelp(): void {
  console.log(`第二批历史合同只读验收

开发环境：
  npx tsx server/scripts/verify-second-historical-contracts.ts \\
    --target=development --source-root /tmp/second-historical-import-source

生产环境：
  NODE_ENV=production node dist/server/scripts/verify-second-historical-contracts.js \\
    --target=production --source-root /migration/source \\
    --receipt-ocr /migration/receipt-ocr.json \\
    --manifest-sha256=${SECOND_HISTORICAL_IMPORT_EXPECTED_MANIFEST_HASH} \\
    --receipt-ocr-sha256=${SECOND_HISTORICAL_VERIFICATION_RECEIPT_OCR_SHA256} \\
    --semantic-sha256=${SECOND_HISTORICAL_SEMANTIC_SHA256} \\
    --target-database-sha256=<生产预演输出的目标数据库指纹>

生产验收固定使用只读数据库事务，且只允许向控制台输出。`);
}

const invokedAsScript = /verify-second-historical-contracts\.(?:ts|js)$/u.test(
  path.basename(process.argv[1] || ""),
);
if (invokedAsScript) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
  } else {
    void main().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
