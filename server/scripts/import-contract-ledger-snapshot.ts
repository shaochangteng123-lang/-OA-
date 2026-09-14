import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { PoolClient } from "pg";

import {
  CONTRACT_LEDGER_EXCLUDED_TABLES,
  CONTRACT_LEDGER_HISTORICAL_IMPORT_BATCH_KEY,
  CONTRACT_LEDGER_SEQUENCE_NAMES,
  CONTRACT_LEDGER_SNAPSHOT_FORMAT_VERSION,
  CONTRACT_LEDGER_SNAPSHOT_KEY,
  CONTRACT_LEDGER_SNAPSHOT_KIND,
  CONTRACT_LEDGER_SNAPSHOT_TABLES,
  calculateManifestSha256,
  calculateSchemaFingerprint,
  calculateSnapshotContentSha256,
  canonicalJsonStringify,
  normalizeIndexDefinition,
  normalizeSchemaDefinition,
  type ContractLedgerSnapshotManifest,
  type JsonValue,
  type SnapshotAccountMappingEntry,
  type SnapshotColumnSchema,
  type SnapshotConstraintSchema,
  type SnapshotFileEntry,
  type SnapshotIndexSchema,
  type SnapshotReference,
  type SnapshotRow,
  type SnapshotTableDataFile,
  type SnapshotTableSchema,
} from "./contract-ledger-snapshot-format.js";

export const CONTRACT_LEDGER_PRODUCTION_CONFIRMATION =
  "IMPORT_CONTRACT_LEDGER_TO_PRODUCTION";

const MANIFEST_FILE_NAME = "manifest.json";
const IMPORT_ADVISORY_LOCK_KEY =
  "contract-ledger-finalized-snapshot-production-import-v1";
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/u;
const SAFE_STORED_PATH_PREFIXES = [
  "uploads/contracts/",
  "uploads/contract-auxiliary/",
] as const;

const TABLE_INSERT_ORDER = [
  "contracts",
  "contract_files",
  "contract_auxiliary_packages",
  "contract_auxiliary_files",
  "contract_ocr_jobs",
  "contract_ocr_fields",
  "contract_ocr_lines",
  "contract_financial_ocr_jobs",
  "contract_financial_file_hashes",
  "contract_approval_rounds",
  "contract_approval_records",
  "contract_seal_applications",
  "contract_seal_verifications",
  "contract_seal_verification_fields",
  "contract_download_requests",
  "contract_download_request_files",
  "contract_download_request_audit_logs",
  "contract_invoices",
  "contract_receipts",
  "contract_payments",
  "contract_external_payments",
  "contract_invoice_line_items",
  "contract_payment_purpose_details",
  "contract_deposits",
  "contract_deposit_settlements",
  "contract_deposit_settlement_receipts",
  "contract_payment_deposit_receipts",
  "contract_financial_registrations",
  "contract_financial_registration_items",
  "contract_financial_registration_matches",
  "invoice_applications",
  "invoice_application_generated_files",
  "invoice_application_materials",
  "invoice_application_invoice_allocations",
  "invoice_application_audit_logs",
  "contract_audit_logs",
] as const;

const SEQUENCE_DEPENDENCY_TABLE: Readonly<Record<string, string>> = {
  contract_no_sequence: "contracts",
  contract_download_request_no_sequence: "contract_download_requests",
  invoice_application_no_sequence: "invoice_applications",
};

interface QueryClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface ContractLedgerImportArguments {
  mode: "dry-run" | "commit";
  bundleRoot: string;
  storageRoot: string;
  confirmation: string | null;
  manifestSha256: string | null;
}

interface LoadedSnapshotBundle {
  bundleRoot: string;
  manifestPath: string;
  manifest: ContractLedgerSnapshotManifest;
  tables: Map<string, SnapshotRow[]>;
  tableFiles: Map<string, string>;
  blobFiles: Map<string, string>;
}

interface ForeignKeyMetadata {
  tableName: string;
  constraintName: string;
  localColumns: string[];
  referencedTableName: string;
  referencedColumns: string[];
}

interface ResolvedAccountMapping {
  sourceUserId: string;
  targetUserId: string;
  entry: SnapshotAccountMappingEntry;
}

interface FilePreflightResult {
  createCount: number;
  reuseCount: number;
  totalBytes: number;
}

interface DatabaseStateResult {
  state: "empty" | "exact" | "conflict";
  nonEmptyTables: Array<{ tableName: string; rowCount: number }>;
  differences: string[];
}

export interface ContractLedgerImportInspection {
  snapshotKey: string;
  manifestSha256: string;
  contentSha256: string;
  tableCount: number;
  rowCount: number;
  storedFileCount: number;
  uniqueBlobCount: number;
  accountMappingCount: number;
  databaseState: DatabaseStateResult["state"];
  sequenceAdvanceRequired: boolean;
  files: FilePreflightResult;
  blockers: string[];
  warnings: string[];
}

interface StagedFiles {
  stagingRoot: string;
  stagedByHash: Map<string, string>;
}

interface PromotedFiles {
  createdPaths: string[];
  reusedPaths: string[];
}

function optionValue(argv: readonly string[], name: string): string | null {
  const exactIndex = argv.indexOf(name);
  if (exactIndex >= 0) return argv[exactIndex + 1] || null;
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) || null : null;
}

export function parseContractLedgerImportArguments(
  argv: readonly string[],
): ContractLedgerImportArguments {
  const dryRun = argv.includes("--dry-run");
  const commit = argv.includes("--commit");
  if (Number(dryRun) + Number(commit) !== 1) {
    throw new Error("必须且只能指定 --dry-run 或 --commit");
  }
  const bundleRoot = optionValue(argv, "--bundle");
  if (!bundleRoot) throw new Error("必须通过 --bundle 指定合同台账迁移包目录");
  const storageRoot = optionValue(argv, "--storage-root") || process.cwd();
  const confirmation = optionValue(argv, "--confirm-production");
  const manifestSha256 = optionValue(argv, "--manifest-sha256");
  const valueOptions = new Set([
    "--bundle",
    "--storage-root",
    "--confirm-production",
    "--manifest-sha256",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "--dry-run" || value === "--commit") continue;
    if ([...valueOptions].some((option) => value.startsWith(`${option}=`))) {
      continue;
    }
    if (valueOptions.has(value)) {
      index += 1;
      continue;
    }
    throw new Error(`不支持的命令行参数：${value}`);
  }
  return {
    mode: commit ? "commit" : "dry-run",
    bundleRoot: path.resolve(bundleRoot),
    storageRoot: path.resolve(storageRoot),
    confirmation,
    manifestSha256: manifestSha256?.toLowerCase() || null,
  };
}

export function assertProductionCommitAuthorization(
  args: ContractLedgerImportArguments,
  manifest: Pick<ContractLedgerSnapshotManifest, "manifestSha256">,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (args.mode !== "commit") return;
  if (environment.NODE_ENV !== "production") {
    throw new Error(
      "提交模式只允许在 NODE_ENV=production 的生产运行环境执行；演练库也必须显式使用生产运行配置",
    );
  }
  if (args.confirmation !== CONTRACT_LEDGER_PRODUCTION_CONFIRMATION) {
    throw new Error(
      `提交模式必须显式指定 --confirm-production=${CONTRACT_LEDGER_PRODUCTION_CONFIRMATION}`,
    );
  }
  if (!args.manifestSha256 || !HASH_PATTERN.test(args.manifestSha256)) {
    throw new Error("提交模式必须显式指定64位 --manifest-sha256");
  }
  if (args.manifestSha256 !== manifest.manifestSha256) {
    throw new Error("命令行清单摘要与迁移包清单摘要不一致，拒绝提交");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label}必须是非空字符串`);
  }
}

function quoteIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`不安全的数据库标识符：${value}`);
  }
  return `"${value}"`;
}

function resolveBundleFile(bundleRoot: string, relativePath: string): string {
  assertString(relativePath, "迁移包相对路径");
  if (
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => segment === ".." || !segment)
  ) {
    throw new Error(`迁移包包含不安全路径：${relativePath}`);
  }
  const resolved = path.resolve(bundleRoot, relativePath);
  const prefix = `${path.resolve(bundleRoot)}${path.sep}`;
  if (!resolved.startsWith(prefix)) {
    throw new Error(`迁移包路径越界：${relativePath}`);
  }
  return resolved;
}

export function resolveStoredFilePath(
  storageRoot: string,
  storedPath: string,
): string {
  assertString(storedPath, "附件保存路径");
  if (
    path.isAbsolute(storedPath) ||
    storedPath.includes("\\") ||
    storedPath.split("/").some((segment) => segment === ".." || !segment) ||
    !SAFE_STORED_PATH_PREFIXES.some((prefix) => storedPath.startsWith(prefix))
  ) {
    throw new Error(`附件保存路径不安全：${storedPath}`);
  }
  const resolvedRoot = path.resolve(storageRoot);
  const resolved = path.resolve(resolvedRoot, storedPath);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`附件保存路径越界：${storedPath}`);
  }
  return resolved;
}

async function assertRegularFileInsideRoot(
  root: string,
  filePath: string,
  label: string,
): Promise<fs.Stats> {
  const stat = await fs.promises.lstat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}不存在、不是普通文件或是符号链接：${filePath}`);
  }
  const [realRoot, realFile] = await Promise.all([
    fs.promises.realpath(root),
    fs.promises.realpath(filePath),
  ]);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`${label}真实路径越界：${filePath}`);
  }
  return stat;
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function assertFileDigest(
  root: string,
  filePath: string,
  expectedBytes: number,
  expectedHash: string,
  label: string,
): Promise<void> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error(`${label}字节数不合法`);
  }
  if (!HASH_PATTERN.test(expectedHash)) throw new Error(`${label}摘要不合法`);
  const stat = await assertRegularFileInsideRoot(root, filePath, label);
  if (stat.size !== expectedBytes) {
    throw new Error(
      `${label}大小不一致：预期${expectedBytes}，实际${stat.size}`,
    );
  }
  const actualHash = await sha256File(filePath);
  if (actualHash !== expectedHash) throw new Error(`${label}摘要校验失败`);
}

function withoutManifestHash(
  manifest: ContractLedgerSnapshotManifest,
): Omit<ContractLedgerSnapshotManifest, "manifestSha256"> {
  const { manifestSha256: _manifestSha256, ...rest } = manifest;
  void _manifestSha256;
  return rest;
}

function withoutContentHashes(
  manifest: ContractLedgerSnapshotManifest,
): Omit<ContractLedgerSnapshotManifest, "contentSha256" | "manifestSha256"> {
  const {
    contentSha256: _contentSha256,
    manifestSha256: _manifestSha256,
    ...rest
  } = manifest;
  void _contentSha256;
  void _manifestSha256;
  return rest;
}

function validateManifestShape(manifest: ContractLedgerSnapshotManifest): void {
  if (manifest.formatVersion !== CONTRACT_LEDGER_SNAPSHOT_FORMAT_VERSION) {
    throw new Error(`不支持的迁移包格式版本：${manifest.formatVersion}`);
  }
  if (manifest.kind !== CONTRACT_LEDGER_SNAPSHOT_KIND) {
    throw new Error(`迁移包类型不正确：${String(manifest.kind)}`);
  }
  if (manifest.snapshotKey !== CONTRACT_LEDGER_SNAPSHOT_KEY) {
    throw new Error(`迁移包批次不正确：${manifest.snapshotKey}`);
  }
  if (manifest.source?.environment !== "development") {
    throw new Error("迁移包必须来自开发环境");
  }
  if (
    manifest.source.historicalImportBatchKey !==
    CONTRACT_LEDGER_HISTORICAL_IMPORT_BATCH_KEY
  ) {
    throw new Error("迁移包历史导入批次与已确认批次不一致");
  }
  if (!HASH_PATTERN.test(manifest.contentSha256 || "")) {
    throw new Error("迁移包内容摘要不合法");
  }
  if (!HASH_PATTERN.test(manifest.manifestSha256 || "")) {
    throw new Error("迁移包清单摘要不合法");
  }
  const actualContentHash = calculateSnapshotContentSha256(
    withoutContentHashes(manifest),
  );
  if (actualContentHash !== manifest.contentSha256) {
    throw new Error("迁移包内容摘要不一致");
  }
  const actualManifestHash = calculateManifestSha256(
    withoutManifestHash(manifest),
  );
  if (actualManifestHash !== manifest.manifestSha256) {
    throw new Error("迁移包清单摘要不一致");
  }
  if (
    calculateSchemaFingerprint(manifest.schema.tables) !==
    manifest.schema.fingerprint
  ) {
    throw new Error("迁移包数据库结构摘要不一致");
  }
  const expectedTables = CONTRACT_LEDGER_SNAPSHOT_TABLES.map(
    (definition) => definition.tableName,
  ).sort();
  const actualTables = manifest.tables.map((entry) => entry.tableName).sort();
  if (
    canonicalJsonStringify(actualTables) !==
    canonicalJsonStringify(expectedTables)
  ) {
    throw new Error("迁移包数据表范围不完整或包含未授权数据表");
  }
  const schemaTables = manifest.schema.tables
    .map((table) => table.tableName)
    .sort();
  if (
    canonicalJsonStringify(schemaTables) !==
    canonicalJsonStringify(expectedTables)
  ) {
    throw new Error("迁移包数据库结构范围与数据表范围不一致");
  }
  const exclusionNames = new Set(
    manifest.exclusions.map((entry) => entry.tableName),
  );
  for (const tableName of CONTRACT_LEDGER_EXCLUDED_TABLES) {
    if (!exclusionNames.has(tableName)) {
      throw new Error(`迁移包没有声明排除数据表：${tableName}`);
    }
  }
  const sequenceNames = manifest.sequences
    .map((entry) => entry.sequenceName)
    .sort();
  if (
    canonicalJsonStringify(sequenceNames) !==
    canonicalJsonStringify([...CONTRACT_LEDGER_SEQUENCE_NAMES].sort())
  ) {
    throw new Error("迁移包序列范围不完整或包含未授权序列");
  }
}

function validateReferences(
  bundle: LoadedSnapshotBundle,
  references: readonly SnapshotReference[],
  expectedValue: string,
  label: string,
): void {
  for (const reference of references) {
    const rows = bundle.tables.get(reference.tableName);
    if (!rows) throw new Error(`${label}引用了未授权数据表`);
    const row = rows.find((candidate) => candidate.id === reference.rowId);
    if (!row) throw new Error(`${label}引用的数据行不存在`);
    if (row[reference.columnName] !== expectedValue) {
      throw new Error(`${label}引用列的值与清单不一致`);
    }
  }
}

function metadataColumnName(
  row: SnapshotRow,
  pathColumn: string,
  replacement: "hash" | "size",
): string | null {
  const candidate = pathColumn.replace("path", replacement);
  if (candidate in row) return candidate;
  const fallback = replacement === "hash" ? "file_hash" : "file_size";
  return fallback in row ? fallback : null;
}

function validateCompleteFileReferenceGraph(
  bundle: LoadedSnapshotBundle,
): void {
  const observed = new Map<
    string,
    {
      references: SnapshotReference[];
      hashes: Set<string>;
      sizes: Set<number>;
    }
  >();
  for (const table of bundle.manifest.schema.tables) {
    const pathColumns = table.columns
      .map((column) => column.columnName)
      .filter((columnName) => /(^|_)path($|_)/u.test(columnName));
    for (const row of bundle.tables.get(table.tableName) || []) {
      for (const columnName of pathColumns) {
        const rawPath = row[columnName];
        if (typeof rawPath !== "string" || !rawPath.trim()) continue;
        const storedPath = rawPath.normalize("NFC").trim();
        resolveStoredFilePath(process.cwd(), storedPath);
        assertString(row.id, `${table.tableName}附件引用行主键`);
        const value = observed.get(storedPath) || {
          references: [],
          hashes: new Set<string>(),
          sizes: new Set<number>(),
        };
        value.references.push({
          tableName: table.tableName,
          rowId: row.id,
          columnName,
        });
        const hashColumn = metadataColumnName(row, columnName, "hash");
        const declaredHash = hashColumn ? row[hashColumn] : null;
        if (typeof declaredHash === "string" && declaredHash.trim()) {
          const normalizedHash = declaredHash.trim().toLowerCase();
          if (!HASH_PATTERN.test(normalizedHash)) {
            throw new Error(
              `${table.tableName}.${hashColumn}不是有效的附件摘要`,
            );
          }
          value.hashes.add(normalizedHash);
        }
        const sizeColumn = metadataColumnName(row, columnName, "size");
        const declaredSize = sizeColumn ? Number(row[sizeColumn]) : NaN;
        if (Number.isSafeInteger(declaredSize) && declaredSize >= 0) {
          value.sizes.add(declaredSize);
        }
        observed.set(storedPath, value);
      }
    }
  }
  const manifestFiles = new Map(
    bundle.manifest.files.map((entry) => [entry.storedPath, entry]),
  );
  if (manifestFiles.size !== bundle.manifest.files.length) {
    throw new Error("迁移包包含重复附件保存路径");
  }
  if (manifestFiles.size !== observed.size) {
    throw new Error("附件清单与数据表全部路径的数量不一致");
  }
  for (const [storedPath, value] of observed) {
    const entry = manifestFiles.get(storedPath);
    if (!entry) throw new Error(`附件清单遗漏数据表路径：${storedPath}`);
    if (
      canonicalReferences(value.references) !==
      canonicalReferences(entry.references)
    ) {
      throw new Error(`附件清单引用不完整：${storedPath}`);
    }
    if (value.hashes.size > 1 || value.sizes.size > 1) {
      throw new Error(
        `数据表对同一附件路径登记了冲突的摘要或大小：${storedPath}`,
      );
    }
    if (value.hashes.size === 1 && !value.hashes.has(entry.sha256)) {
      throw new Error(`附件清单摘要与数据表不一致：${storedPath}`);
    }
    if (value.sizes.size === 1 && !value.sizes.has(entry.bytes)) {
      throw new Error(`附件清单大小与数据表不一致：${storedPath}`);
    }
  }
}

export async function loadContractLedgerSnapshotBundle(
  bundleRootInput: string,
): Promise<LoadedSnapshotBundle> {
  const bundleRoot = path.resolve(bundleRootInput);
  const rootStat = await fs.promises.lstat(bundleRoot).catch(() => null);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`迁移包目录不存在、不是目录或是符号链接：${bundleRoot}`);
  }
  const manifestPath = path.join(bundleRoot, MANIFEST_FILE_NAME);
  await assertRegularFileInsideRoot(bundleRoot, manifestPath, "迁移包清单");
  const parsed = JSON.parse(
    await fs.promises.readFile(manifestPath, "utf8"),
  ) as unknown;
  if (!isPlainObject(parsed)) throw new Error("迁移包清单不是对象");
  const manifest = parsed as unknown as ContractLedgerSnapshotManifest;
  validateManifestShape(manifest);

  const tables = new Map<string, SnapshotRow[]>();
  const tableFiles = new Map<string, string>();
  for (const entry of manifest.tables) {
    if (tables.has(entry.tableName)) {
      throw new Error(`迁移包数据表重复：${entry.tableName}`);
    }
    const filePath = resolveBundleFile(bundleRoot, entry.relativePath);
    await assertFileDigest(
      bundleRoot,
      filePath,
      entry.bytes,
      entry.sha256,
      `数据表${entry.tableName}`,
    );
    const data = JSON.parse(
      await fs.promises.readFile(filePath, "utf8"),
    ) as SnapshotTableDataFile;
    if (
      !isPlainObject(data) ||
      data.tableName !== entry.tableName ||
      !Array.isArray(data.rows)
    ) {
      throw new Error(`数据表文件内容不合法：${entry.tableName}`);
    }
    if (data.rows.length !== entry.rowCount) {
      throw new Error(`数据表${entry.tableName}行数与清单不一致`);
    }
    const ids = new Set<string>();
    for (const row of data.rows) {
      if (!isPlainObject(row))
        throw new Error(`数据表${entry.tableName}包含非对象行`);
      const primaryKey =
        entry.tableName === "contract_financial_file_hashes"
          ? row.file_hash
          : row.id;
      assertString(primaryKey, `数据表${entry.tableName}主键`);
      if (ids.has(primaryKey))
        throw new Error(`数据表${entry.tableName}包含重复主键`);
      ids.add(primaryKey);
    }
    tables.set(entry.tableName, data.rows);
    tableFiles.set(entry.tableName, filePath);
    if (manifest.summary.tableRowCounts[entry.tableName] !== data.rows.length) {
      throw new Error(`数据表${entry.tableName}行数与汇总不一致`);
    }
  }

  const blobFiles = new Map<string, string>();
  const blobBytes = new Map<string, number>();
  const seenStoredPaths = new Set<string>();
  for (const entry of manifest.files) {
    if (!HASH_PATTERN.test(entry.sha256)) throw new Error("附件摘要不合法");
    if (seenStoredPaths.has(entry.storedPath)) {
      throw new Error(`迁移包包含重复附件保存路径：${entry.storedPath}`);
    }
    seenStoredPaths.add(entry.storedPath);
    if (!entry.references.length) {
      throw new Error(`迁移包附件没有数据库引用：${entry.storedPath}`);
    }
    resolveStoredFilePath(process.cwd(), entry.storedPath);
    const sourcePath = resolveBundleFile(bundleRoot, entry.bundlePath);
    const existingBundlePath = blobFiles.get(entry.sha256);
    if (existingBundlePath && existingBundlePath !== sourcePath) {
      throw new Error(`同一附件摘要对应了不同迁移包文件：${entry.sha256}`);
    }
    if (existingBundlePath && blobBytes.get(entry.sha256) !== entry.bytes) {
      throw new Error(`同一附件摘要对应了不同字节数：${entry.sha256}`);
    }
    if (!existingBundlePath) {
      await assertFileDigest(
        bundleRoot,
        sourcePath,
        entry.bytes,
        entry.sha256,
        `附件${entry.storedPath}`,
      );
      blobFiles.set(entry.sha256, sourcePath);
      blobBytes.set(entry.sha256, entry.bytes);
    }
  }
  const loaded: LoadedSnapshotBundle = {
    bundleRoot,
    manifestPath,
    manifest,
    tables,
    tableFiles,
    blobFiles,
  };
  validateCompleteFileReferenceGraph(loaded);
  for (const file of manifest.files) {
    validateReferences(loaded, file.references, file.storedPath, "附件");
  }
  for (const account of manifest.accounts) {
    validateReferences(
      loaded,
      account.references,
      account.sourceUserId,
      "账号",
    );
  }
  if (manifest.summary.storedFileCount !== manifest.files.length) {
    throw new Error("迁移包附件数量与汇总不一致");
  }
  if (manifest.summary.uniqueBlobCount !== blobFiles.size) {
    throw new Error("迁移包唯一附件内容数量与汇总不一致");
  }
  return loaded;
}

function normalizeConstraintColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

export async function captureTargetSchema(
  client: QueryClient,
  tableNamesInput: readonly string[],
): Promise<SnapshotTableSchema[]> {
  const tableNames = [...tableNamesInput].sort();
  const columns = await client.query<{
    table_name: string;
    column_name: string;
    ordinal_position: number;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    is_identity: string;
    identity_generation: string | null;
    is_generated: string;
    generation_expression: string | null;
  }>(
    `SELECT table_name,column_name,ordinal_position,data_type,udt_name,
       is_nullable,column_default,is_identity,identity_generation,
       is_generated,generation_expression
     FROM information_schema.columns
     WHERE table_schema=current_schema() AND table_name=ANY($1::text[])
     ORDER BY table_name,ordinal_position`,
    [tableNames],
  );
  const constraints = await client.query<{
    table_name: string;
    constraint_name: string;
    constraint_type: SnapshotConstraintSchema["constraintType"];
    definition: string;
    referenced_table_name: string | null;
    local_columns: string[] | null;
    referenced_columns: string[] | null;
  }>(
    `SELECT relation.relname AS table_name,
       constraint_record.conname AS constraint_name,
       constraint_record.contype AS constraint_type,
       pg_get_constraintdef(constraint_record.oid, TRUE) AS definition,
       referenced_relation.relname AS referenced_table_name,
       ARRAY(
         SELECT attribute.attname::text
         FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key(attnum, ordinal)
         JOIN pg_attribute attribute
           ON attribute.attrelid=constraint_record.conrelid
          AND attribute.attnum=key.attnum
         ORDER BY key.ordinal
       ) AS local_columns,
       ARRAY(
         SELECT attribute.attname::text
         FROM unnest(constraint_record.confkey) WITH ORDINALITY AS key(attnum, ordinal)
         JOIN pg_attribute attribute
           ON attribute.attrelid=constraint_record.confrelid
          AND attribute.attnum=key.attnum
         ORDER BY key.ordinal
       ) AS referenced_columns
     FROM pg_constraint constraint_record
     JOIN pg_class relation ON relation.oid=constraint_record.conrelid
     JOIN pg_namespace namespace_record ON namespace_record.oid=relation.relnamespace
     LEFT JOIN pg_class referenced_relation
       ON referenced_relation.oid=constraint_record.confrelid
     WHERE namespace_record.nspname=current_schema()
       AND relation.relname=ANY($1::text[])
       AND constraint_record.contype IN ('p','f','u','c','x')
     ORDER BY relation.relname,constraint_record.conname`,
    [tableNames],
  );
  const indexes = await client.query<{
    table_name: string;
    index_name: string;
    definition: string;
  }>(
    `SELECT tablename AS table_name,indexname AS index_name,
       indexdef AS definition
     FROM pg_indexes
     WHERE schemaname=current_schema()
       AND tablename=ANY($1::text[])
     ORDER BY tablename,indexname`,
    [tableNames],
  );
  const result: SnapshotTableSchema[] = tableNames.map((tableName) => ({
    tableName,
    columns: columns.rows
      .filter((column) => column.table_name === tableName)
      .map<SnapshotColumnSchema>((column) => ({
        columnName: column.column_name,
        ordinalPosition: Number(column.ordinal_position),
        dataType: column.data_type,
        udtName: column.udt_name,
        nullable: column.is_nullable === "YES",
        defaultExpression: column.column_default,
        identity: column.identity_generation,
        generated: column.generation_expression,
      })),
    constraints: constraints.rows
      .filter((constraint) => constraint.table_name === tableName)
      .map<SnapshotConstraintSchema>((constraint) => ({
        constraintName: constraint.constraint_name,
        constraintType: constraint.constraint_type,
        definition: constraint.definition,
        referencedTableName: constraint.referenced_table_name,
        localColumns: normalizeConstraintColumns(constraint.local_columns),
        referencedColumns: normalizeConstraintColumns(
          constraint.referenced_columns,
        ),
      })),
    indexes: indexes.rows
      .filter((index) => index.table_name === tableName)
      .map<SnapshotIndexSchema>((index) => ({
        indexName: index.index_name,
        definition: index.definition,
      })),
  }));
  for (const table of result) {
    if (!table.columns.length)
      throw new Error(`生产数据库缺少数据表：${table.tableName}`);
  }
  return result;
}

async function loadForeignKeys(
  client: QueryClient,
  tableNames: readonly string[],
): Promise<ForeignKeyMetadata[]> {
  const result = await client.query<{
    table_name: string;
    constraint_name: string;
    referenced_table_name: string;
    local_columns: string[];
    referenced_columns: string[];
  }>(
    `SELECT relation.relname AS table_name,
       constraint_record.conname AS constraint_name,
       referenced_relation.relname AS referenced_table_name,
       ARRAY(
         SELECT attribute.attname::text
         FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key(attnum, ordinal)
         JOIN pg_attribute attribute
           ON attribute.attrelid=constraint_record.conrelid
          AND attribute.attnum=key.attnum
         ORDER BY key.ordinal
       ) AS local_columns,
       ARRAY(
         SELECT attribute.attname::text
         FROM unnest(constraint_record.confkey) WITH ORDINALITY AS key(attnum, ordinal)
         JOIN pg_attribute attribute
           ON attribute.attrelid=constraint_record.confrelid
          AND attribute.attnum=key.attnum
         ORDER BY key.ordinal
       ) AS referenced_columns
     FROM pg_constraint constraint_record
     JOIN pg_class relation ON relation.oid=constraint_record.conrelid
     JOIN pg_namespace namespace_record ON namespace_record.oid=relation.relnamespace
     JOIN pg_class referenced_relation
       ON referenced_relation.oid=constraint_record.confrelid
     WHERE namespace_record.nspname=current_schema()
       AND relation.relname=ANY($1::text[])
       AND constraint_record.contype='f'
     ORDER BY relation.relname,constraint_record.conname`,
    [[...tableNames]],
  );
  return result.rows.map((row) => ({
    tableName: row.table_name,
    constraintName: row.constraint_name,
    localColumns: normalizeConstraintColumns(row.local_columns),
    referencedTableName: row.referenced_table_name,
    referencedColumns: normalizeConstraintColumns(row.referenced_columns),
  }));
}

async function inspectTrackedContractTableSet(
  client: QueryClient,
): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema=current_schema()
       AND table_type='BASE TABLE'
       AND (table_name LIKE 'contract%' OR table_name LIKE 'invoice_application%')
     ORDER BY table_name`,
  );
  const allowed = new Set([
    ...CONTRACT_LEDGER_SNAPSHOT_TABLES.map(
      (definition) => definition.tableName,
    ),
    "contract_rate_configs",
  ]);
  const untracked = result.rows
    .map((row) => row.table_name)
    .filter((tableName) => !allowed.has(tableName));
  return untracked.length
    ? [`生产数据库存在未纳入迁移格式的合同域数据表：${untracked.join("、")}`]
    : [];
}

function constraintSemanticKey(constraint: SnapshotConstraintSchema): string {
  return canonicalJsonStringify({
    constraintType: constraint.constraintType,
    definition: normalizeSchemaDefinition(constraint.definition),
    referencedTableName: constraint.referencedTableName,
    localColumns: constraint.localColumns,
    referencedColumns: constraint.referencedColumns,
  });
}

function inspectSchemaCompatibility(
  sourceTables: readonly SnapshotTableSchema[],
  targetTables: readonly SnapshotTableSchema[],
): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const targetByName = new Map(
    targetTables.map((table) => [table.tableName, table]),
  );
  for (const source of sourceTables) {
    const target = targetByName.get(source.tableName);
    if (!target) {
      blockers.push(`生产数据库缺少迁移表：${source.tableName}`);
      continue;
    }
    const comparableColumns = (table: SnapshotTableSchema) =>
      table.columns
        .map(({ ordinalPosition: _ordinalPosition, ...column }) => {
          void _ordinalPosition;
          return column;
        })
        .sort((left, right) => left.columnName.localeCompare(right.columnName));
    if (
      canonicalJsonStringify(comparableColumns(source)) !==
      canonicalJsonStringify(comparableColumns(target))
    ) {
      blockers.push(`生产数据表${source.tableName}的列结构与开发不一致`);
    }
    const targetStrongConstraints = new Set(
      target.constraints
        .filter((constraint) => constraint.constraintType !== "c")
        .map(constraintSemanticKey),
    );
    const missingStrongConstraints = source.constraints
      .filter((constraint) => constraint.constraintType !== "c")
      .filter(
        (constraint) =>
          !targetStrongConstraints.has(constraintSemanticKey(constraint)),
      );
    if (missingStrongConstraints.length) {
      blockers.push(
        `生产数据表${source.tableName}缺少${missingStrongConstraints.length}个开发必需主键、外键、唯一或排除约束`,
      );
    }
    const sourceChecks = new Set(
      source.constraints
        .filter((constraint) => constraint.constraintType === "c")
        .map(constraintSemanticKey),
    );
    const targetChecks = new Set(
      target.constraints
        .filter((constraint) => constraint.constraintType === "c")
        .map(constraintSemanticKey),
    );
    if (
      [...sourceChecks].some((key) => !targetChecks.has(key)) ||
      [...targetChecks].some((key) => !sourceChecks.has(key))
    ) {
      warnings.push(
        `数据表${source.tableName}的检查约束存在历史差异，将通过回滚式真实插入验证`,
      );
    }
    const targetIndexes = new Set(
      target.indexes.map((index) => normalizeIndexDefinition(index.definition)),
    );
    const missingIndexes = [
      ...new Set(
        source.indexes.map((index) =>
          normalizeIndexDefinition(index.definition),
        ),
      ),
    ].filter((definition) => !targetIndexes.has(definition));
    if (missingIndexes.length) {
      blockers.push(
        `生产数据表${source.tableName}缺少${missingIndexes.length}个开发必需语义索引`,
      );
    }
  }
  return { blockers, warnings };
}

function canonicalReferences(references: readonly SnapshotReference[]): string {
  return canonicalJsonStringify(
    [...references].sort((left, right) =>
      `${left.tableName}:${left.rowId}:${left.columnName}`.localeCompare(
        `${right.tableName}:${right.rowId}:${right.columnName}`,
      ),
    ),
  );
}

async function resolveAccountMappings(
  client: QueryClient,
  bundle: LoadedSnapshotBundle,
  foreignKeys: readonly ForeignKeyMetadata[],
): Promise<ResolvedAccountMapping[]> {
  const userForeignKeys = foreignKeys.filter(
    (foreignKey) => foreignKey.referencedTableName === "users",
  );
  const observed = new Map<string, SnapshotReference[]>();
  for (const foreignKey of userForeignKeys) {
    if (foreignKey.localColumns.length !== 1) {
      throw new Error(`不支持复合账号外键：${foreignKey.constraintName}`);
    }
    const columnName = foreignKey.localColumns[0]!;
    for (const row of bundle.tables.get(foreignKey.tableName) || []) {
      const value = row[columnName];
      if (value == null) continue;
      assertString(value, `${foreignKey.tableName}.${columnName}`);
      assertString(row.id, `${foreignKey.tableName}账号引用行主键`);
      const references = observed.get(value) || [];
      references.push({
        tableName: foreignKey.tableName,
        rowId: row.id,
        columnName,
      });
      observed.set(value, references);
    }
  }
  const entries = new Map(
    bundle.manifest.accounts.map((entry) => [entry.sourceUserId, entry]),
  );
  if (entries.size !== bundle.manifest.accounts.length) {
    throw new Error("迁移包账号映射包含重复源账号");
  }
  for (const [sourceUserId, references] of observed) {
    const entry = entries.get(sourceUserId);
    if (!entry) throw new Error("迁移包存在未声明映射的账号外键");
    if (
      canonicalReferences(references) !== canonicalReferences(entry.references)
    ) {
      throw new Error("迁移包账号引用清单与数据表实际引用不一致");
    }
  }
  for (const entry of bundle.manifest.accounts) {
    if (!observed.has(entry.sourceUserId)) {
      throw new Error("迁移包账号映射没有实际外键引用");
    }
    if (
      canonicalJsonStringify(entry.matchFields) !==
      canonicalJsonStringify(["username", "name", "role"])
    ) {
      throw new Error("账号稳定映射字段必须是用户名、姓名和角色");
    }
    if (entry.stableKey.status !== "active") {
      throw new Error("源合同账号不是启用状态，拒绝映射到生产账号");
    }
  }
  const resolved: ResolvedAccountMapping[] = [];
  for (const entry of bundle.manifest.accounts) {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM users
       WHERE username IS NOT DISTINCT FROM $1
         AND name IS NOT DISTINCT FROM $2
         AND role IS NOT DISTINCT FROM $3
         AND status='active'
       ORDER BY id`,
      [entry.stableKey.username, entry.stableKey.name, entry.stableKey.role],
    );
    if (result.rows.length !== 1) {
      throw new Error(
        `源账号无法唯一映射到生产账号（匹配数量：${result.rows.length}）`,
      );
    }
    resolved.push({
      sourceUserId: entry.sourceUserId,
      targetUserId: result.rows[0]!.id,
      entry,
    });
  }
  return resolved;
}

function remapRows(
  bundle: LoadedSnapshotBundle,
  foreignKeys: readonly ForeignKeyMetadata[],
  accountMappings: readonly ResolvedAccountMapping[],
): Map<string, SnapshotRow[]> {
  const targetBySource = new Map(
    accountMappings.map((mapping) => [
      mapping.sourceUserId,
      mapping.targetUserId,
    ]),
  );
  const userColumnsByTable = new Map<string, string[]>();
  for (const foreignKey of foreignKeys) {
    if (foreignKey.referencedTableName !== "users") continue;
    const columns = userColumnsByTable.get(foreignKey.tableName) || [];
    columns.push(...foreignKey.localColumns);
    userColumnsByTable.set(foreignKey.tableName, columns);
  }
  return new Map(
    [...bundle.tables.entries()].map(([tableName, rows]) => [
      tableName,
      rows.map((sourceRow) => {
        const row = { ...sourceRow };
        for (const columnName of userColumnsByTable.get(tableName) || []) {
          const value = row[columnName];
          if (value == null) continue;
          const target = targetBySource.get(String(value));
          if (!target) {
            throw new Error(`账号外键没有生产映射：${tableName}.${columnName}`);
          }
          row[columnName] = target;
        }
        return row;
      }),
    ]),
  );
}

function valueKey(value: JsonValue): string {
  return canonicalJsonStringify(value);
}

function validateClosedForeignKeyGraph(
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
  foreignKeys: readonly ForeignKeyMetadata[],
): void {
  for (const foreignKey of foreignKeys) {
    if (foreignKey.localColumns.length !== 1) {
      throw new Error(`不支持复合外键：${foreignKey.constraintName}`);
    }
    const localColumn = foreignKey.localColumns[0]!;
    const referencedColumn = foreignKey.referencedColumns[0]!;
    const rows = rowsByTable.get(foreignKey.tableName) || [];
    if (foreignKey.referencedTableName === "users") continue;
    if (foreignKey.referencedTableName === "worklog_projects") {
      if (rows.some((row) => row[localColumn] != null)) {
        throw new Error("合同快照包含项目关联，禁止把开发项目编号带入生产");
      }
      continue;
    }
    const referencedRows = rowsByTable.get(foreignKey.referencedTableName);
    if (!referencedRows) {
      if (rows.some((row) => row[localColumn] != null)) {
        throw new Error(
          `迁移包包含未授权外部引用：${foreignKey.tableName}.${localColumn}`,
        );
      }
      continue;
    }
    const allowed = new Set(
      referencedRows
        .map((row) => row[referencedColumn])
        .filter((value): value is JsonValue => value != null)
        .map(valueKey),
    );
    for (const row of rows) {
      const value = row[localColumn];
      if (value == null) continue;
      if (!allowed.has(valueKey(value))) {
        throw new Error(
          `迁移包外键不闭合：${foreignKey.tableName}.${localColumn}`,
        );
      }
    }
  }
}

function normalizeDecimalForComparison(value: unknown): string {
  const raw = String(value).trim().toLowerCase();
  const matched = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/u);
  if (!matched) return raw;
  const negative = matched[1] === "-";
  const integer = matched[2]!;
  const fraction = matched[3] || "";
  const exponent = Number(matched[4] || 0);
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + exponent;
  const expanded =
    decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : decimalIndex >= digits.length
        ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  const [expandedInteger, expandedFraction = ""] = expanded.split(".");
  const normalizedInteger = expandedInteger!.replace(/^0+(?=\d)/u, "") || "0";
  const normalizedFraction = expandedFraction.replace(/0+$/u, "");
  const absolute = normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
  return negative && absolute !== "0" ? `-${absolute}` : absolute;
}

function normalizeComparableRow(
  row: SnapshotRow,
  schema: SnapshotTableSchema,
): Record<string, unknown> {
  const columns = new Map(
    schema.columns.map((column) => [column.columnName, column]),
  );
  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => {
      if (value == null) return [columnName, null];
      const column = columns.get(columnName);
      if (!column) return [columnName, value];
      if (column.dataType === "numeric" || column.dataType === "decimal") {
        return [columnName, normalizeDecimalForComparison(value)];
      }
      if (["smallint", "integer", "bigint"].includes(column.dataType)) {
        return [columnName, String(value)];
      }
      if (value instanceof Date) return [columnName, value.toISOString()];
      return [columnName, value];
    }),
  );
}

function rowDigest(
  rows: readonly SnapshotRow[],
  schema: SnapshotTableSchema,
): string {
  const canonicalRows = rows
    .map((row) => canonicalJsonStringify(normalizeComparableRow(row, schema)))
    .sort((left, right) => left.localeCompare(right));
  return crypto
    .createHash("sha256")
    .update(canonicalJsonStringify(canonicalRows))
    .digest("hex");
}

async function inspectDatabaseState(
  client: QueryClient,
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
  schemaTables: readonly SnapshotTableSchema[],
): Promise<DatabaseStateResult> {
  const nonEmptyTables: Array<{ tableName: string; rowCount: number }> = [];
  const differences: string[] = [];
  for (const definition of CONTRACT_LEDGER_SNAPSHOT_TABLES) {
    const tableName = definition.tableName;
    const count = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(tableName)}`,
    );
    const rowCount = Number(count.rows[0]?.count || 0);
    if (rowCount > 0) nonEmptyTables.push({ tableName, rowCount });
  }
  if (!nonEmptyTables.length) {
    return { state: "empty", nonEmptyTables, differences };
  }
  for (const definition of CONTRACT_LEDGER_SNAPSHOT_TABLES) {
    const tableName = definition.tableName;
    const schema = schemaTables.find((table) => table.tableName === tableName);
    if (!schema) throw new Error(`迁移包缺少数据表结构：${tableName}`);
    const expected = rowsByTable.get(tableName) || [];
    const actual = await client.query<SnapshotRow>(
      `SELECT * FROM ${quoteIdentifier(tableName)}`,
    );
    if (actual.rows.length !== expected.length) {
      differences.push(
        `${tableName}行数应为${expected.length}，实际为${actual.rows.length}`,
      );
      continue;
    }
    if (rowDigest(actual.rows, schema) !== rowDigest(expected, schema)) {
      differences.push(`${tableName}内容与迁移包不一致`);
    }
  }
  return {
    state: differences.length ? "conflict" : "exact",
    nonEmptyTables,
    differences,
  };
}

function normalizeBusinessKey(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

async function inspectCrossModuleConflicts(
  client: QueryClient,
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
): Promise<string[]> {
  const blockers: string[] = [];
  const invoiceNumbers = [
    ...new Set(
      (rowsByTable.get("contract_invoices") || [])
        .map((row) => normalizeBusinessKey(row.invoice_no))
        .filter(Boolean),
    ),
  ];
  if (invoiceNumbers.length) {
    const result = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM (
         SELECT invoice.invoice_number
         FROM reimbursement_invoices invoice
         JOIN reimbursements reimbursement
           ON reimbursement.id=invoice.reimbursement_id
         WHERE invoice.invoice_number IS NOT NULL
           AND SPLIT_PART(invoice.file_path,'/',-1) NOT LIKE 'receipt-%'
           AND UPPER(invoice.invoice_number) NOT LIKE 'RECEIPT-%'
           AND reimbursement.status <> 'rejected'
           AND COALESCE(reimbursement.is_deleted,FALSE)=FALSE
           AND UPPER(REGEXP_REPLACE(
             NORMALIZE(BTRIM(invoice.invoice_number),NFKC),
             '[^A-Za-z0-9]','','g'
           ))=ANY($1::text[])
         UNION ALL
         SELECT deduction.invoice_number
         FROM reimbursement_deduction_invoices deduction
         JOIN reimbursements reimbursement
           ON reimbursement.id=deduction.reimbursement_id
         WHERE deduction.invoice_number IS NOT NULL
           AND reimbursement.status <> 'rejected'
           AND COALESCE(reimbursement.is_deleted,FALSE)=FALSE
           AND UPPER(REGEXP_REPLACE(
             NORMALIZE(BTRIM(deduction.invoice_number),NFKC),
             '[^A-Za-z0-9]','','g'
           ))=ANY($1::text[])
       ) duplicate_invoice`,
      [invoiceNumbers],
    );
    if (Number(result.rows[0]?.count || 0) > 0) {
      blockers.push("生产报销数据中存在与合同快照重复的发票号码");
    }
  }

  const hashes = [
    ...new Set(
      [...rowsByTable.values()]
        .flatMap((rows) => rows)
        .flatMap((row) =>
          Object.entries(row)
            .filter(
              ([column, value]) =>
                (column === "file_hash" || column.endsWith("_file_hash")) &&
                typeof value === "string" &&
                HASH_PATTERN.test(value),
            )
            .map(([, value]) => String(value)),
        ),
    ),
  ];
  if (hashes.length) {
    const result = await client.query<{ source: string }>(
      `SELECT 'reimbursement_invoice'::text AS source
       FROM reimbursement_invoices WHERE file_hash=ANY($1::text[])
       UNION ALL
       SELECT 'payment_proof'::text AS source
       FROM payment_proof_hashes WHERE file_hash=ANY($1::text[])
       LIMIT 1`,
      [hashes],
    );
    if (result.rows.length) {
      blockers.push("生产报销附件中存在与合同快照重复的文件摘要");
    }
  }

  const receiptNumbers = [
    ...new Set(
      [
        "contract_receipts",
        "contract_payments",
        "contract_external_payments",
        "contract_deposit_settlement_receipts",
      ].flatMap((tableName) =>
        (rowsByTable.get(tableName) || [])
          .map((row) => normalizeBusinessKey(row.electronic_receipt_no))
          .filter(Boolean),
      ),
    ),
  ];
  if (receiptNumbers.length) {
    const result = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM payment_proof_hashes
       WHERE proof_no IS NOT NULL
         AND UPPER(REGEXP_REPLACE(
           NORMALIZE(BTRIM(proof_no),NFKC),'[^A-Za-z0-9]','','g'
         ))=ANY($1::text[])`,
      [receiptNumbers],
    );
    if (Number(result.rows[0]?.count || 0) > 0) {
      blockers.push("生产报销付款凭证中存在与合同快照重复的电子回单号");
    }
  }
  return blockers;
}

async function inspectTargetFiles(
  storageRoot: string,
  files: readonly SnapshotFileEntry[],
): Promise<{ result: FilePreflightResult; blockers: string[] }> {
  let createCount = 0;
  let reuseCount = 0;
  let totalBytes = 0;
  const blockers: string[] = [];
  const seenStoredPaths = new Map<string, string>();
  for (const file of files) {
    const previousHash = seenStoredPaths.get(file.storedPath);
    if (previousHash && previousHash !== file.sha256) {
      blockers.push(`同一附件保存路径对应不同内容：${file.storedPath}`);
      continue;
    }
    if (previousHash) continue;
    seenStoredPaths.set(file.storedPath, file.sha256);
    totalBytes += file.bytes;
    const destination = resolveStoredFilePath(storageRoot, file.storedPath);
    const stat = await fs.promises.lstat(destination).catch(() => null);
    if (!stat) {
      createCount += 1;
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      blockers.push(`生产附件目标不是普通文件：${file.storedPath}`);
      continue;
    }
    if (
      stat.size !== file.bytes ||
      (await sha256File(destination)) !== file.sha256
    ) {
      blockers.push(`生产附件目标已存在但内容不同：${file.storedPath}`);
      continue;
    }
    reuseCount += 1;
  }
  return {
    result: { createCount, reuseCount, totalBytes },
    blockers,
  };
}

async function inspectSequenceAvailability(
  client: QueryClient,
  manifest: ContractLedgerSnapshotManifest,
  requireTargetAtLeastSnapshot: boolean,
): Promise<{ blockers: string[]; advanceRequired: boolean }> {
  const blockers: string[] = [];
  let advanceRequired = false;
  for (const sequence of manifest.sequences) {
    const tableName = SEQUENCE_DEPENDENCY_TABLE[sequence.sequenceName];
    if (!tableName || (manifest.summary.tableRowCounts[tableName] || 0) === 0) {
      continue;
    }
    if (
      !/^\d+$/u.test(sequence.lastValue) ||
      !/^\d+$/u.test(sequence.nextValue)
    ) {
      blockers.push(`序列${sequence.sequenceName}的数值不合法`);
      continue;
    }
    const snapshotLast = BigInt(sequence.lastValue);
    const snapshotNext = BigInt(sequence.nextValue);
    const calculatedNext = sequence.isCalled ? snapshotLast + 1n : snapshotLast;
    if (snapshotNext !== calculatedNext) {
      blockers.push(`序列${sequence.sequenceName}的下一号与状态不一致`);
      continue;
    }
    const exists = await client.query<{ exists: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS exists`,
      [sequence.sequenceName],
    );
    if (!exists.rows[0]?.exists) {
      blockers.push(`生产数据库缺少序列：${sequence.sequenceName}`);
      continue;
    }
    const current = await client.query<{
      last_value: string;
      is_called: boolean;
    }>(
      `SELECT last_value::text,is_called FROM ${quoteIdentifier(sequence.sequenceName)}`,
    );
    const currentLast = BigInt(current.rows[0]!.last_value);
    const currentNext = current.rows[0]!.is_called
      ? currentLast + 1n
      : currentLast;
    if (currentNext < snapshotNext) {
      advanceRequired = true;
      if (requireTargetAtLeastSnapshot) {
        blockers.push(
          `合同数据已存在，但序列${sequence.sequenceName}下一号仍落后于迁移包`,
        );
      }
    }
  }
  return { blockers, advanceRequired };
}

async function inspectExcludedRateConfiguration(
  client: QueryClient,
  manifest: ContractLedgerSnapshotManifest,
): Promise<string[]> {
  const exclusion = manifest.exclusions.find(
    (entry) => entry.tableName === "contract_rate_configs",
  );
  if (
    !exclusion ||
    !Number.isSafeInteger(exclusion.rowCount) ||
    !HASH_PATTERN.test(exclusion.sourceFingerprint || "")
  ) {
    return ["迁移包缺少开发费率配置的行数或业务值指纹"];
  }
  const result = await client.query<{
    rate_code: string;
    rate_value: string;
    effective_from: string;
    effective_to: string | null;
    is_active: boolean;
  }>(
    `SELECT rate_code,rate_value::text AS rate_value,effective_from,
       effective_to,is_active
     FROM contract_rate_configs
     ORDER BY rate_code,effective_from,COALESCE(effective_to,'')`,
  );
  const targetFingerprint = crypto
    .createHash("sha256")
    .update(canonicalJsonStringify(result.rows))
    .digest("hex");
  const blockers: string[] = [];
  if (result.rows.length !== exclusion.rowCount) {
    blockers.push(
      `生产费率配置行数与开发不一致（开发${exclusion.rowCount}，生产${result.rows.length}）`,
    );
  }
  if (targetFingerprint !== exclusion.sourceFingerprint) {
    blockers.push("生产费率配置业务值与开发不一致");
  }
  return blockers;
}

async function buildInspectionContext(
  client: QueryClient,
  bundle: LoadedSnapshotBundle,
  storageRoot: string,
): Promise<{
  inspection: ContractLedgerImportInspection;
  foreignKeys: ForeignKeyMetadata[];
  accountMappings: ResolvedAccountMapping[];
  remappedRows: Map<string, SnapshotRow[]>;
}> {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const tableNames = CONTRACT_LEDGER_SNAPSHOT_TABLES.map(
    (definition) => definition.tableName,
  );
  const targetSchema = await captureTargetSchema(client, tableNames);
  const schemaCompatibility = inspectSchemaCompatibility(
    bundle.manifest.schema.tables,
    targetSchema,
  );
  blockers.push(...schemaCompatibility.blockers);
  warnings.push(...schemaCompatibility.warnings);
  blockers.push(...(await inspectTrackedContractTableSet(client)));
  const foreignKeys = await loadForeignKeys(client, tableNames);
  const accountMappings = await resolveAccountMappings(
    client,
    bundle,
    foreignKeys,
  );
  const remappedRows = remapRows(bundle, foreignKeys, accountMappings);
  validateClosedForeignKeyGraph(remappedRows, foreignKeys);
  const database = await inspectDatabaseState(
    client,
    remappedRows,
    bundle.manifest.schema.tables,
  );
  if (database.state === "conflict") {
    blockers.push(
      `生产合同域不是空库且不等于当前迁移包：${database.differences.join("；")}`,
    );
  } else if (database.state === "exact") {
    warnings.push("相同迁移包已经完整导入，提交模式将幂等跳过");
  }
  const files = await inspectTargetFiles(storageRoot, bundle.manifest.files);
  blockers.push(...files.blockers);
  if (database.state === "exact" && files.result.createCount > 0) {
    blockers.push("合同数据已存在，但生产附件不完整，不能按幂等导入跳过");
  }
  if (database.state !== "exact") {
    blockers.push(...(await inspectCrossModuleConflicts(client, remappedRows)));
  }
  const sequences = await inspectSequenceAvailability(
    client,
    bundle.manifest,
    database.state === "exact",
  );
  blockers.push(...sequences.blockers);
  blockers.push(
    ...(await inspectExcludedRateConfiguration(client, bundle.manifest)),
  );
  const rowCount = [...bundle.tables.values()].reduce(
    (sum, rows) => sum + rows.length,
    0,
  );
  return {
    inspection: {
      snapshotKey: bundle.manifest.snapshotKey,
      manifestSha256: bundle.manifest.manifestSha256,
      contentSha256: bundle.manifest.contentSha256,
      tableCount: bundle.tables.size,
      rowCount,
      storedFileCount: bundle.manifest.files.length,
      uniqueBlobCount: bundle.blobFiles.size,
      accountMappingCount: accountMappings.length,
      databaseState: database.state,
      sequenceAdvanceRequired: sequences.advanceRequired,
      files: files.result,
      blockers,
      warnings,
    },
    foreignKeys,
    accountMappings,
    remappedRows,
  };
}

export async function inspectContractLedgerSnapshotImport(
  client: QueryClient,
  bundle: LoadedSnapshotBundle,
  storageRoot: string,
): Promise<ContractLedgerImportInspection> {
  return (await buildInspectionContext(client, bundle, storageRoot)).inspection;
}

export async function verifyContractLedgerSnapshotImportWithRollback(
  client: PoolClient,
  bundle: LoadedSnapshotBundle,
  storageRoot: string,
): Promise<ContractLedgerImportInspection> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    IMPORT_ADVISORY_LOCK_KEY,
  ]);
  const context = await buildInspectionContext(client, bundle, storageRoot);
  if (
    context.inspection.blockers.length ||
    context.inspection.databaseState !== "empty"
  ) {
    return context.inspection;
  }
  await client.query("SAVEPOINT contract_ledger_snapshot_dry_run");
  let verificationError: unknown = null;
  try {
    await insertSnapshotRows(
      client,
      context.remappedRows,
      bundle.manifest.schema.tables,
    );
    await assertPostImportState(
      client,
      context.remappedRows,
      context.foreignKeys,
      bundle.manifest.schema.tables,
    );
  } catch (error) {
    verificationError = error;
  }
  try {
    await client.query(
      "ROLLBACK TO SAVEPOINT contract_ledger_snapshot_dry_run",
    );
    await client.query("RELEASE SAVEPOINT contract_ledger_snapshot_dry_run");
  } catch (rollbackError) {
    throw new Error(
      `预演保存点回滚失败，当前事务必须整体回滚：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
    );
  }
  if (verificationError) {
    return {
      ...context.inspection,
      blockers: [
        ...context.inspection.blockers,
        `生产约束真实写入回滚验证失败：${verificationError instanceof Error ? verificationError.message : String(verificationError)}`,
      ],
    };
  }
  return {
    ...context.inspection,
    warnings: [
      ...context.inspection.warnings,
      "已在事务保存点内完成全部数据真实插入和提交后校验，并已强制回滚",
    ],
  };
}

async function assertNoSymlinkComponents(
  root: string,
  destination: string,
): Promise<void> {
  const relative = path.relative(root, destination);
  let current = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    const stat = await fs.promises.lstat(current).catch(() => null);
    if (stat?.isSymbolicLink()) {
      throw new Error(`附件目录包含符号链接：${current}`);
    }
  }
}

async function stageSnapshotFiles(
  bundle: LoadedSnapshotBundle,
  storageRoot: string,
): Promise<StagedFiles> {
  await fs.promises.mkdir(storageRoot, { recursive: true });
  const stagingParent = path.join(
    storageRoot,
    ".contract-ledger-import-staging",
  );
  await fs.promises.mkdir(stagingParent, { recursive: true });
  const stagingRoot = await fs.promises.mkdtemp(
    path.join(stagingParent, `${bundle.manifest.manifestSha256.slice(0, 12)}-`),
  );
  const stagedByHash = new Map<string, string>();
  try {
    for (const [hash, sourcePath] of bundle.blobFiles) {
      const destination = path.join(stagingRoot, hash);
      await fs.promises.copyFile(
        sourcePath,
        destination,
        fs.constants.COPYFILE_EXCL,
      );
      const expected = bundle.manifest.files.find(
        (file) => file.sha256 === hash,
      )!;
      await assertFileDigest(
        stagingRoot,
        destination,
        expected.bytes,
        hash,
        "暂存附件",
      );
      stagedByHash.set(hash, destination);
    }
    return { stagingRoot, stagedByHash };
  } catch (error) {
    await fs.promises.rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

async function promoteSnapshotFiles(
  bundle: LoadedSnapshotBundle,
  staged: StagedFiles,
  storageRoot: string,
): Promise<PromotedFiles> {
  const createdPaths: string[] = [];
  const reusedPaths: string[] = [];
  const handledPaths = new Set<string>();
  try {
    for (const file of bundle.manifest.files) {
      if (handledPaths.has(file.storedPath)) continue;
      handledPaths.add(file.storedPath);
      const destination = resolveStoredFilePath(storageRoot, file.storedPath);
      await assertNoSymlinkComponents(storageRoot, destination);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await assertNoSymlinkComponents(storageRoot, destination);
      const existing = await fs.promises.lstat(destination).catch(() => null);
      if (existing) {
        if (
          existing.isFile() &&
          !existing.isSymbolicLink() &&
          existing.size === file.bytes &&
          (await sha256File(destination)) === file.sha256
        ) {
          reusedPaths.push(destination);
          continue;
        }
        throw new Error(`生产附件目标已存在且内容不同：${file.storedPath}`);
      }
      const source = staged.stagedByHash.get(file.sha256);
      if (!source) throw new Error(`暂存区缺少附件：${file.sha256}`);
      try {
        await fs.promises.link(source, destination);
      } catch (error) {
        const code = String((error as NodeJS.ErrnoException).code || "");
        if (code === "EEXIST") {
          throw new Error(`生产附件目标被并发创建：${file.storedPath}`);
        }
        if (!["EXDEV", "EPERM", "EOPNOTSUPP"].includes(code)) throw error;
        await fs.promises.copyFile(
          source,
          destination,
          fs.constants.COPYFILE_EXCL,
        );
      }
      createdPaths.push(destination);
    }
    return { createdPaths, reusedPaths };
  } catch (error) {
    const cleanupFailures = await cleanupCreatedFiles(createdPaths);
    if (cleanupFailures.length) {
      throw withCleanupFailure(error, cleanupFailures);
    }
    throw error;
  }
}

function contractRelationRank(row: SnapshotRow): number {
  if (row.relation_type === "main") return 0;
  if (row.relation_type === "supplement") return 1;
  if (row.relation_type === "termination") return 2;
  return 3;
}

function orderContractRows(rows: readonly SnapshotRow[]): SnapshotRow[] {
  const remaining = [...rows].sort(
    (left, right) => contractRelationRank(left) - contractRelationRank(right),
  );
  const result: SnapshotRow[] = [];
  const inserted = new Set<string>();
  while (remaining.length) {
    const index = remaining.findIndex((row) => {
      const id = String(row.id);
      return [
        row.parent_contract_id,
        row.root_contract_id,
        row.termination_target_contract_id,
        row.renewed_from_contract_id,
      ].every(
        (value) =>
          value == null || String(value) === id || inserted.has(String(value)),
      );
    });
    if (index < 0) throw new Error("合同自关联存在循环或前置合同缺失");
    const [row] = remaining.splice(index, 1);
    result.push(row!);
    inserted.add(String(row!.id));
  }
  return result;
}

async function insertRow(
  client: QueryClient,
  tableName: string,
  row: SnapshotRow,
  schema: SnapshotTableSchema,
): Promise<void> {
  const columns = Object.keys(row);
  if (!columns.length) throw new Error(`数据表${tableName}包含空行`);
  const sql = `INSERT INTO ${quoteIdentifier(tableName)} (
    ${columns.map(quoteIdentifier).join(",")}
  ) VALUES (${columns.map((_, index) => `$${index + 1}`).join(",")})`;
  await client.query(
    sql,
    columns.map((column) => {
      const value = row[column];
      const columnSchema = schema.columns.find(
        (candidate) => candidate.columnName === column,
      );
      return columnSchema && ["json", "jsonb"].includes(columnSchema.dataType)
        ? JSON.stringify(value)
        : value;
    }),
  );
}

async function insertSnapshotRows(
  client: QueryClient,
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
  schemaTables: readonly SnapshotTableSchema[],
): Promise<void> {
  const deferredDirectionInvoices: Array<{ id: string; invoiceId: string }> =
    [];
  for (const tableName of TABLE_INSERT_ORDER) {
    const schema = schemaTables.find((table) => table.tableName === tableName);
    if (!schema) throw new Error(`迁移包缺少数据表结构：${tableName}`);
    let rows = rowsByTable.get(tableName) || [];
    if (tableName === "contracts") rows = orderContractRows(rows);
    for (const sourceRow of rows) {
      const row = { ...sourceRow };
      if (
        tableName === "contracts" &&
        typeof row.financial_direction_invoice_id === "string"
      ) {
        deferredDirectionInvoices.push({
          id: String(row.id),
          invoiceId: row.financial_direction_invoice_id,
        });
        row.financial_direction_invoice_id = null;
      }
      await insertRow(client, tableName, row, schema);
    }
  }
  for (const deferred of deferredDirectionInvoices) {
    await client.query(
      `UPDATE contracts SET financial_direction_invoice_id=$2 WHERE id=$1`,
      [deferred.id, deferred.invoiceId],
    );
  }
}

async function advanceSequences(
  client: QueryClient,
  manifest: ContractLedgerSnapshotManifest,
): Promise<void> {
  for (const sequence of manifest.sequences) {
    const dependency = SEQUENCE_DEPENDENCY_TABLE[sequence.sequenceName];
    if (
      !dependency ||
      (manifest.summary.tableRowCounts[dependency] || 0) === 0
    ) {
      continue;
    }
    quoteIdentifier(sequence.sequenceName);
    const current = await client.query<{
      last_value: string;
      is_called: boolean;
    }>(
      `SELECT last_value::text,is_called FROM ${quoteIdentifier(sequence.sequenceName)}`,
    );
    const currentLast = BigInt(current.rows[0]!.last_value);
    const currentNext = current.rows[0]!.is_called
      ? currentLast + 1n
      : currentLast;
    const snapshotNext = BigInt(sequence.nextValue);
    if (snapshotNext <= currentNext) continue;
    await client.query(`SELECT setval($1::regclass,$2::bigint,$3::boolean)`, [
      sequence.sequenceName,
      sequence.lastValue,
      sequence.isCalled,
    ]);
  }
}

async function assertPostImportState(
  client: QueryClient,
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
  foreignKeys: readonly ForeignKeyMetadata[],
  schemaTables: readonly SnapshotTableSchema[],
): Promise<void> {
  const database = await inspectDatabaseState(
    client,
    rowsByTable,
    schemaTables,
  );
  if (database.state !== "exact") {
    throw new Error(
      `提交后合同数据校验失败：${database.differences.join("；")}`,
    );
  }
  for (const foreignKey of foreignKeys) {
    if (foreignKey.referencedTableName !== "users") continue;
    const columnName = foreignKey.localColumns[0]!;
    const result = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM ${quoteIdentifier(foreignKey.tableName)} source_row
       LEFT JOIN users target_user
         ON target_user.id=source_row.${quoteIdentifier(columnName)}
       WHERE source_row.${quoteIdentifier(columnName)} IS NOT NULL
         AND target_user.id IS NULL`,
    );
    if (Number(result.rows[0]?.count || 0) > 0) {
      throw new Error(
        `提交后账号外键校验失败：${foreignKey.tableName}.${columnName}`,
      );
    }
  }
}

async function cleanupCreatedFiles(
  paths: readonly string[],
): Promise<string[]> {
  const failed: string[] = [];
  await Promise.all(
    [...new Set(paths)].map(async (filePath) => {
      try {
        await fs.promises.rm(filePath, { force: true });
      } catch {
        failed.push(filePath);
      }
    }),
  );
  return failed.sort();
}

function withCleanupFailure(
  error: unknown,
  failedPaths: readonly string[],
): Error {
  const original = error instanceof Error ? error.message : String(error);
  const combined = new Error(
    `${original}；数据库将回滚，但有${failedPaths.length}个本批附件清理失败，必须人工核对：${failedPaths.join("、")}`,
  );
  if (
    (error as Error & { commitOutcomeUncertain?: boolean })
      ?.commitOutcomeUncertain
  ) {
    (
      combined as Error & { commitOutcomeUncertain?: boolean }
    ).commitOutcomeUncertain = true;
  }
  return combined;
}

function removeTrackedPaths(
  tracker: string[],
  removed: readonly string[],
): void {
  const removedSet = new Set(removed);
  const retained = tracker.filter((filePath) => !removedSet.has(filePath));
  tracker.splice(0, tracker.length, ...retained);
}

export async function applyContractLedgerSnapshotImport(
  client: PoolClient,
  bundle: LoadedSnapshotBundle,
  storageRoot: string,
  staged: StagedFiles,
  createdPathTracker: string[] = [],
): Promise<{
  skipped: boolean;
  rowCount: number;
  promoted: PromotedFiles;
}> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    IMPORT_ADVISORY_LOCK_KEY,
  ]);
  const context = await buildInspectionContext(client, bundle, storageRoot);
  if (context.inspection.blockers.length) {
    throw new Error(
      `生产导入预检未通过：${context.inspection.blockers.join("；")}`,
    );
  }
  if (context.inspection.databaseState === "exact") {
    return {
      skipped: true,
      rowCount: context.inspection.rowCount,
      promoted: { createdPaths: [], reusedPaths: [] },
    };
  }
  const promoted = await promoteSnapshotFiles(bundle, staged, storageRoot);
  createdPathTracker.push(...promoted.createdPaths);
  try {
    await insertSnapshotRows(
      client,
      context.remappedRows,
      bundle.manifest.schema.tables,
    );
    await assertPostImportState(
      client,
      context.remappedRows,
      context.foreignKeys,
      bundle.manifest.schema.tables,
    );
    // setval 不受数据库事务回滚保护，因此只在全部可失败数据校验通过后执行，
    // 并且只允许向前推进。极端提交失败最多留下安全号段空洞，绝不倒退重号。
    await advanceSequences(client, bundle.manifest);
    const sequenceVerification = await inspectSequenceAvailability(
      client,
      bundle.manifest,
      true,
    );
    if (sequenceVerification.blockers.length) {
      throw new Error(
        `提交后序列校验失败：${sequenceVerification.blockers.join("；")}`,
      );
    }
    return {
      skipped: false,
      rowCount: context.inspection.rowCount,
      promoted,
    };
  } catch (error) {
    const cleanupFailures = await cleanupCreatedFiles(promoted.createdPaths);
    const cleaned = promoted.createdPaths.filter(
      (filePath) => !cleanupFailures.includes(filePath),
    );
    removeTrackedPaths(createdPathTracker, cleaned);
    if (cleanupFailures.length) {
      throw withCleanupFailure(error, cleanupFailures);
    }
    throw error;
  }
}

function helpText(): string {
  return `合同台账开发最终快照生产导入器

预演：
  node dist/server/scripts/import-contract-ledger-snapshot.js \\
    --dry-run --bundle /安全路径/contract-ledger-snapshot

生产提交：
  NODE_ENV=production node dist/server/scripts/import-contract-ledger-snapshot.js \\
    --commit --bundle /安全路径/contract-ledger-snapshot \\
    --confirm-production=${CONTRACT_LEDGER_PRODUCTION_CONFIRMATION} \\
    --manifest-sha256=<预演输出的64位清单摘要>

可选参数：
  --storage-root=/app   附件保存根目录，默认使用当前工作目录

安全边界：
  - 默认不提交，必须显式选择预演或提交；
  - 提交仅允许生产运行配置，并同时校验确认令牌和外部清单摘要；
  - 不导入账号、项目、费率和月度银行关联；
  - 数据库单事务写入，失败时清理本批次新建附件；
  - 业务序列只在数据校验完成后向前推进；极端提交失败可能留下安全号段空洞，但绝不倒退重号；
  - 相同快照完整存在时幂等跳过，任何部分差异均失败关闭。`;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(helpText());
    return;
  }
  const args = parseContractLedgerImportArguments(process.argv.slice(2));
  const bundle = await loadContractLedgerSnapshotBundle(args.bundleRoot);
  assertProductionCommitAuthorization(args, bundle.manifest);
  const { db, pool } = await import("../db/index.js");
  let staged: StagedFiles | null = null;
  const createdPaths: string[] = [];
  let commitOutcomeUncertain = false;
  try {
    const inspection = await db.transaction((client) =>
      args.mode === "dry-run"
        ? verifyContractLedgerSnapshotImportWithRollback(
            client,
            bundle,
            args.storageRoot,
          )
        : inspectContractLedgerSnapshotImport(client, bundle, args.storageRoot),
    );
    if (args.mode === "dry-run") {
      console.log(JSON.stringify({ mode: "预演", ...inspection }, null, 2));
      if (inspection.blockers.length) process.exitCode = 2;
      return;
    }
    if (inspection.blockers.length) {
      throw new Error(`生产导入预检未通过：${inspection.blockers.join("；")}`);
    }
    if (inspection.databaseState === "exact") {
      console.log(
        JSON.stringify(
          {
            mode: "提交",
            skipped: true,
            reason: "相同快照已完整导入",
            ...inspection,
          },
          null,
          2,
        ),
      );
      return;
    }
    staged = await stageSnapshotFiles(bundle, args.storageRoot);
    try {
      const result = await db.transaction(async (client) => {
        const applied = await applyContractLedgerSnapshotImport(
          client,
          bundle,
          args.storageRoot,
          staged!,
          createdPaths,
        );
        return applied;
      });
      console.log(
        JSON.stringify(
          {
            mode: "提交",
            snapshotKey: bundle.manifest.snapshotKey,
            manifestSha256: bundle.manifest.manifestSha256,
            skipped: result.skipped,
            importedRows: result.rowCount,
            createdFiles: result.promoted.createdPaths.length,
            reusedFiles: result.promoted.reusedPaths.length,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      commitOutcomeUncertain = Boolean(
        (error as Error & { commitOutcomeUncertain?: boolean })
          .commitOutcomeUncertain,
      );
      if (!commitOutcomeUncertain) {
        const cleanupFailures = await cleanupCreatedFiles(createdPaths);
        if (cleanupFailures.length) {
          throw withCleanupFailure(error, cleanupFailures);
        }
      }
      throw error;
    }
  } finally {
    if (staged) {
      await fs.promises
        .rm(staged.stagingRoot, { recursive: true, force: true })
        .catch(() => undefined);
    }
    await pool.end();
    if (commitOutcomeUncertain) {
      console.error(
        "数据库提交结果无法确认，已保留生产附件；禁止重试，请先核对数据库和附件状态",
      );
    }
  }
}

const directEntry = /import-contract-ledger-snapshot\.(?:ts|js)$/u.test(
  path.basename(process.argv[1] || ""),
);
if (directEntry) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
