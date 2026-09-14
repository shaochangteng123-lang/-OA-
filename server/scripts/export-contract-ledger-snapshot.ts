import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { Pool, type PoolClient } from "pg";

import {
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
  sha256Text,
  type ContractLedgerSnapshotExclusion,
  type ContractLedgerSnapshotManifest,
  type ContractLedgerSnapshotSummary,
  type JsonValue,
  type SnapshotAccountMappingEntry,
  type SnapshotAmountSummary,
  type SnapshotConstraintSchema,
  type SnapshotFileEntry,
  type SnapshotIndexSchema,
  type SnapshotReference,
  type SnapshotRow,
  type SnapshotSchema,
  type SnapshotSequence,
  type SnapshotTableDataEntry,
  type SnapshotTableSchema,
} from "./contract-ledger-snapshot-format.js";

interface ExportArguments {
  outputDirectory: string;
  sourceFilesRoot: string;
  snapshotKey: string;
}

interface RawColumnSchema {
  table_name: string;
  column_name: string;
  ordinal_position: number;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
  column_default: string | null;
  identity_generation: string | null;
  generation_expression: string | null;
}

interface RawConstraintSchema {
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  definition: string;
  referenced_table_name: string | null;
  local_columns: string[];
  referenced_columns: string[];
}

interface RawIndexSchema {
  table_name: string;
  index_name: string;
  definition: string;
}

interface ReferencedFilePlan {
  storedPath: string;
  declaredHashes: Set<string>;
  declaredSizes: Set<number>;
  references: SnapshotReference[];
}

interface DatabaseSnapshot {
  contractIds: string[];
  rootContractIds: string[];
  schema: SnapshotSchema;
  rowsByTable: Map<string, SnapshotRow[]>;
  accounts: SnapshotAccountMappingEntry[];
  sequences: SnapshotSequence[];
  exclusions: ContractLedgerSnapshotExclusion[];
}

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CONTRACT_RELATED_TABLE_PATTERN = /^(contract|invoice_application)/u;

function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`数据库标识符不安全：${identifier}`);
  }
  return `"${identifier}"`;
}

function optionValue(
  argv: readonly string[],
  optionName: string,
): string | null {
  const index = argv.indexOf(optionName);
  const inline = argv.find((value) => value.startsWith(`${optionName}=`));
  if (index >= 0) {
    const next = argv[index + 1];
    return next && !next.startsWith("--") ? next : null;
  }
  return inline?.slice(optionName.length + 1) || null;
}

export function parseExportArguments(
  argv: readonly string[],
  cwd = process.cwd(),
): ExportArguments {
  const supportedOptions = new Set([
    "--output",
    "--source-files-root",
    "--snapshot-key",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (!value.startsWith("--")) continue;
    const name = value.split("=", 1)[0]!;
    if (!supportedOptions.has(name)) {
      throw new Error(`不支持的参数：${name}`);
    }
    if (!value.includes("=")) index += 1;
  }

  const output = optionValue(argv, "--output");
  if (!output) {
    throw new Error("必须通过 --output 指定全新的迁移包输出目录");
  }
  const sourceFilesRoot = optionValue(argv, "--source-files-root") || cwd;
  const snapshotKey =
    optionValue(argv, "--snapshot-key") || CONTRACT_LEDGER_SNAPSHOT_KEY;
  if (!/^[a-z0-9][a-z0-9._-]{7,119}$/u.test(snapshotKey)) {
    throw new Error("迁移包标识只能包含小写字母、数字、点、下划线和短横线");
  }
  return {
    outputDirectory: path.resolve(cwd, output),
    sourceFilesRoot: path.resolve(cwd, sourceFilesRoot),
    snapshotKey,
  };
}

export function assertDevelopmentExportEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV !== "development") {
    throw new Error("合同台账导出只允许在 NODE_ENV=development 的开发环境执行");
  }
}

export function normalizeStoredUploadPath(storedPath: string): string {
  const text = String(storedPath || "")
    .normalize("NFC")
    .replace(/\\/gu, "/")
    .trim();
  if (!text || text.includes("\0") || path.posix.isAbsolute(text)) {
    throw new Error(`附件路径不是安全的 uploads 相对路径：${storedPath}`);
  }
  const normalized = path.posix.normalize(text).replace(/^\.\//u, "");
  if (
    normalized === "uploads" ||
    !normalized.startsWith("uploads/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`附件路径越界：${storedPath}`);
  }
  return normalized;
}

function toJsonValue(value: unknown, location: string): JsonValue {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) {
    throw new Error(`${location} 包含不支持直接导出的二进制字段`);
  }
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      toJsonValue(child, `${location}[${index}]`),
    );
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        toJsonValue(child, `${location}.${key}`),
      ]),
    );
  }
  throw new Error(`${location} 包含无法序列化的字段类型`);
}

export function normalizeSnapshotRow(
  row: Record<string, unknown>,
  tableName: string,
): SnapshotRow {
  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => [
      columnName,
      toJsonValue(value, `${tableName}.${columnName}`),
    ]),
  );
}

function decimalToCents(value: JsonValue): bigint {
  const text = String(value ?? "0").trim();
  const matched = text.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/u);
  if (!matched) throw new Error(`金额不是两位小数以内的十进制数：${text}`);
  const cents =
    BigInt(matched[2]!) * 100n + BigInt((matched[3] || "").padEnd(2, "0"));
  return matched[1] ? -cents : cents;
}

function centsToAmount(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function summarizeAmountRows(
  rows: readonly SnapshotRow[],
  amountColumn: string,
  predicate: (row: SnapshotRow) => boolean = () => true,
): SnapshotAmountSummary {
  const included = rows.filter(predicate);
  const cents = included.reduce(
    (total, row) => total + decimalToCents(row[amountColumn] ?? null),
    0n,
  );
  return {
    rowCount: included.length,
    amount: centsToAmount(cents),
    cents: cents.toString(),
  };
}

async function captureSchema(
  client: PoolClient,
  tableNames: readonly string[],
): Promise<SnapshotSchema> {
  const columnResult = await client.query<RawColumnSchema>(
    `SELECT table_name, column_name, ordinal_position, data_type, udt_name,
       is_nullable, column_default, identity_generation,
       generation_expression
     FROM information_schema.columns
     WHERE table_schema=current_schema()
       AND table_name=ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
    [tableNames],
  );
  const constraintResult = await client.query<RawConstraintSchema>(
    `SELECT child.relname AS table_name,
       constraint_row.conname AS constraint_name,
       constraint_row.contype::text AS constraint_type,
       pg_get_constraintdef(constraint_row.oid, TRUE) AS definition,
       parent.relname AS referenced_table_name,
       COALESCE((
         SELECT ARRAY_AGG(attribute.attname::text ORDER BY key_column.ordinality)
         FROM UNNEST(constraint_row.conkey) WITH ORDINALITY
           AS key_column(attnum, ordinality)
         JOIN pg_attribute attribute
           ON attribute.attrelid=constraint_row.conrelid
          AND attribute.attnum=key_column.attnum
       ), ARRAY[]::text[]) AS local_columns,
       COALESCE((
         SELECT ARRAY_AGG(attribute.attname::text ORDER BY key_column.ordinality)
         FROM UNNEST(constraint_row.confkey) WITH ORDINALITY
           AS key_column(attnum, ordinality)
         JOIN pg_attribute attribute
           ON attribute.attrelid=constraint_row.confrelid
          AND attribute.attnum=key_column.attnum
       ), ARRAY[]::text[]) AS referenced_columns
     FROM pg_constraint constraint_row
     JOIN pg_class child ON child.oid=constraint_row.conrelid
     JOIN pg_namespace namespace_row ON namespace_row.oid=child.relnamespace
     LEFT JOIN pg_class parent ON parent.oid=constraint_row.confrelid
     WHERE namespace_row.nspname=current_schema()
       AND child.relname=ANY($1::text[])
       AND constraint_row.contype IN ('p','f','u','c','x')
     ORDER BY child.relname, constraint_row.conname`,
    [tableNames],
  );
  const indexResult = await client.query<RawIndexSchema>(
    `SELECT tablename AS table_name,indexname AS index_name,
       indexdef AS definition
     FROM pg_indexes
     WHERE schemaname=current_schema()
       AND tablename=ANY($1::text[])
     ORDER BY tablename,indexname`,
    [tableNames],
  );

  const tables: SnapshotTableSchema[] = tableNames
    .map((tableName) => {
      const columns = columnResult.rows
        .filter((column) => column.table_name === tableName)
        .map((column) => ({
          columnName: column.column_name,
          ordinalPosition: Number(column.ordinal_position),
          dataType: column.data_type,
          udtName: column.udt_name,
          nullable: column.is_nullable === "YES",
          defaultExpression: column.column_default,
          identity: column.identity_generation,
          generated: column.generation_expression,
        }));
      if (!columns.length) throw new Error(`开发库缺少迁移表：${tableName}`);
      const constraints = constraintResult.rows
        .filter((constraint) => constraint.table_name === tableName)
        .map(
          (constraint): SnapshotConstraintSchema => ({
            constraintName: constraint.constraint_name,
            constraintType:
              constraint.constraint_type as SnapshotConstraintSchema["constraintType"],
            definition: constraint.definition,
            referencedTableName: constraint.referenced_table_name,
            localColumns: constraint.local_columns,
            referencedColumns: constraint.referenced_columns,
          }),
        );
      const indexes = indexResult.rows
        .filter((index) => index.table_name === tableName)
        .map(
          (index): SnapshotIndexSchema => ({
            indexName: index.index_name,
            definition: index.definition,
          }),
        );
      return { tableName, columns, constraints, indexes };
    })
    .sort((left, right) => left.tableName.localeCompare(right.tableName));
  return { fingerprint: calculateSchemaFingerprint(tables), tables };
}

async function selectContractIds(client: PoolClient): Promise<{
  contractIds: string[];
  rootContractIds: string[];
}> {
  const rootResult = await client.query<{ id: string }>(
    `SELECT DISTINCT audit.contract_id AS id
     FROM contract_audit_logs audit
     JOIN contracts contract ON contract.id=audit.contract_id
     WHERE audit.action='historical_contract_imported'
       AND audit.changes_json->>'batchKey'=$1
       AND contract.relation_type='main'
     ORDER BY audit.contract_id`,
    [CONTRACT_LEDGER_HISTORICAL_IMPORT_BATCH_KEY],
  );
  if (!rootResult.rows.length) {
    throw new Error("开发库没有找到已确认历史导入批次的根合同");
  }
  const rootContractIds = rootResult.rows.map((row) => row.id);
  const selectedResult = await client.query<{ id: string }>(
    `WITH RECURSIVE selected_contracts(id) AS (
       SELECT UNNEST($1::text[])
       UNION
       SELECT child.id
       FROM contracts child
       JOIN selected_contracts selected ON
         child.parent_contract_id=selected.id OR
         child.root_contract_id=selected.id OR
         child.termination_target_contract_id=selected.id OR
         child.renewed_from_contract_id=selected.id
     )
     SELECT DISTINCT id FROM selected_contracts ORDER BY id`,
    [rootContractIds],
  );
  const contractIds = selectedResult.rows.map((row) => row.id);
  const totalResult = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM contracts`,
  );
  if (Number(totalResult.rows[0]?.count || 0) !== contractIds.length) {
    throw new Error(
      "开发库存在已确认历史导入批次之外的合同，拒绝混入最终台账迁移包",
    );
  }
  return { contractIds, rootContractIds };
}

async function assertTrackedContractTables(client: PoolClient): Promise<void> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema=current_schema()
       AND table_type='BASE TABLE'
       AND (table_name LIKE 'contract%' OR table_name LIKE 'invoice_application%')
     ORDER BY table_name`,
  );
  const tracked = new Set<string>(
    CONTRACT_LEDGER_SNAPSHOT_TABLES.map((table) => table.tableName),
  );
  tracked.add("contract_rate_configs");
  const untracked = result.rows
    .map((row) => row.table_name)
    .filter(
      (tableName) =>
        CONTRACT_RELATED_TABLE_PATTERN.test(tableName) &&
        !tracked.has(tableName),
    );
  if (untracked.length) {
    throw new Error(`存在尚未纳入迁移格式的合同表：${untracked.join("、")}`);
  }
}

async function selectTableRows(
  client: PoolClient,
  contractIds: readonly string[],
): Promise<Map<string, SnapshotRow[]>> {
  const rowsByTable = new Map<string, SnapshotRow[]>();
  for (const definition of CONTRACT_LEDGER_SNAPSHOT_TABLES) {
    const tableName = definition.tableName;
    let selectedIds: readonly string[];
    let columnName: string;
    if (definition.scope.kind === "contracts") {
      selectedIds = contractIds;
      columnName = "id";
    } else if (definition.scope.kind === "contract-column") {
      selectedIds = contractIds;
      columnName = definition.scope.columnName;
    } else {
      const parentRows = rowsByTable.get(definition.scope.parentTableName);
      if (!parentRows) {
        throw new Error(
          `迁移表顺序错误：${tableName} 依赖 ${definition.scope.parentTableName}`,
        );
      }
      selectedIds = parentRows.map((row) => String(row.id));
      columnName = definition.scope.columnName;
    }
    const orderColumn =
      tableName === "contract_financial_file_hashes" ? "file_hash" : "id";
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(tableName)}
       WHERE ${quoteIdentifier(columnName)}=ANY($1::text[])
       ORDER BY ${quoteIdentifier(orderColumn)}`,
      [selectedIds],
    );
    rowsByTable.set(
      tableName,
      result.rows.map((row) => normalizeSnapshotRow(row, tableName)),
    );
  }
  return rowsByTable;
}

function foreignKeyValue(
  row: SnapshotRow,
  columns: readonly string[],
): string | null {
  const values = columns.map((column) => row[column]);
  if (values.every((value) => value === null || value === undefined)) {
    return null;
  }
  if (values.some((value) => value === null || value === undefined)) {
    throw new Error(`复合外键只有部分字段为空：${columns.join("、")}`);
  }
  return canonicalJsonStringify(values);
}

function validateForeignKeyClosure(
  schema: SnapshotSchema,
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
): void {
  const selectedTables = new Set(rowsByTable.keys());
  for (const table of schema.tables) {
    const rows = rowsByTable.get(table.tableName) || [];
    for (const constraint of table.constraints) {
      if (
        constraint.constraintType !== "f" ||
        !constraint.referencedTableName
      ) {
        continue;
      }
      const values = rows
        .map((row) => ({
          row,
          key: foreignKeyValue(row, constraint.localColumns),
        }))
        .filter((entry) => entry.key !== null);
      if (!values.length || constraint.referencedTableName === "users") {
        continue;
      }
      if (constraint.referencedTableName === "worklog_projects") {
        throw new Error(
          `${table.tableName}.${constraint.localColumns.join("+")} 仍关联开发项目，项目已明确排除，无法生成闭合迁移包`,
        );
      }
      if (!selectedTables.has(constraint.referencedTableName)) {
        throw new Error(
          `${table.tableName} 存在指向迁移范围外表 ${constraint.referencedTableName} 的非空外键`,
        );
      }
      const parentRows = rowsByTable.get(constraint.referencedTableName) || [];
      const parentKeys = new Set(
        parentRows
          .map((row) => foreignKeyValue(row, constraint.referencedColumns))
          .filter((key): key is string => key !== null),
      );
      const missing = values.find((entry) => !parentKeys.has(entry.key!));
      if (missing) {
        throw new Error(
          `${table.tableName} 的记录 ${String(missing.row.id)} 存在未纳入迁移包的外键 ${constraint.constraintName}`,
        );
      }
    }
  }
}

async function buildAccountMappings(
  client: PoolClient,
  schema: SnapshotSchema,
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
): Promise<SnapshotAccountMappingEntry[]> {
  const referencesByUser = new Map<string, SnapshotReference[]>();
  for (const table of schema.tables) {
    const rows = rowsByTable.get(table.tableName) || [];
    for (const constraint of table.constraints) {
      if (
        constraint.constraintType !== "f" ||
        constraint.referencedTableName !== "users" ||
        constraint.localColumns.length !== 1
      ) {
        continue;
      }
      const columnName = constraint.localColumns[0]!;
      for (const row of rows) {
        const sourceUserId = row[columnName];
        if (typeof sourceUserId !== "string" || !sourceUserId) continue;
        const references = referencesByUser.get(sourceUserId) || [];
        references.push({
          tableName: table.tableName,
          rowId: String(row.id),
          columnName,
        });
        referencesByUser.set(sourceUserId, references);
      }
    }
  }
  const sourceUserIds = Array.from(referencesByUser.keys()).sort();
  if (!sourceUserIds.length) {
    throw new Error("合同台账没有发现任何创建人或操作人账号引用");
  }
  const userResult = await client.query<{
    id: string;
    username: string | null;
    name: string;
    role: string;
    status: string;
    department: string | null;
    position: string | null;
    employee_no: string | null;
  }>(
    `SELECT id,username,name,role,status,department,position,employee_no
     FROM users WHERE id=ANY($1::text[]) ORDER BY id`,
    [sourceUserIds],
  );
  if (userResult.rows.length !== sourceUserIds.length) {
    throw new Error("部分合同账号引用在开发库中不存在");
  }
  return userResult.rows.map((user) => {
    if (!user.username?.trim()) {
      throw new Error(`账号 ${user.id} 缺少可用于生产映射的用户名`);
    }
    const references = (referencesByUser.get(user.id) || []).sort(
      (left, right) =>
        `${left.tableName}\0${left.rowId}\0${left.columnName}`.localeCompare(
          `${right.tableName}\0${right.rowId}\0${right.columnName}`,
        ),
    );
    return {
      sourceUserId: user.id,
      stableKey: {
        username: user.username.trim(),
        name: user.name,
        role: user.role,
        status: user.status,
        department: user.department,
        position: user.position,
        employeeNo: user.employee_no,
      },
      matchFields: ["username", "name", "role"] as const,
      references,
    };
  });
}

async function captureSequences(
  client: PoolClient,
): Promise<SnapshotSequence[]> {
  const sequences: SnapshotSequence[] = [];
  for (const sequenceName of CONTRACT_LEDGER_SEQUENCE_NAMES) {
    const result = await client.query<{
      last_value: string;
      is_called: boolean;
    }>(
      `SELECT last_value::text AS last_value,is_called
       FROM ${quoteIdentifier(sequenceName)}`,
    );
    if (!result.rows[0]) throw new Error(`开发库缺少序列：${sequenceName}`);
    const lastValue = BigInt(result.rows[0].last_value);
    sequences.push({
      sequenceName,
      lastValue: lastValue.toString(),
      isCalled: result.rows[0].is_called,
      nextValue: (result.rows[0].is_called
        ? lastValue + 1n
        : lastValue
      ).toString(),
    });
  }
  return sequences;
}

async function buildExclusions(
  client: PoolClient,
  accounts: readonly SnapshotAccountMappingEntry[],
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
): Promise<ContractLedgerSnapshotExclusion[]> {
  const rateResult = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM contract_rate_configs`,
  );
  const rateBusinessResult = await client.query<{
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
  const rateBusinessFingerprint = sha256Text(
    canonicalJsonStringify(rateBusinessResult.rows),
  );
  const linkTypeToTable = new Map([
    ["contract_receipt", "contract_receipts"],
    ["contract_payment", "contract_payments"],
    ["contract_external_payment", "contract_external_payments"],
  ]);
  let relatedMonthlyLinkCount = 0;
  const relatedTransactionIds = new Set<string>();
  for (const [businessObjectType, tableName] of linkTypeToTable) {
    const objectIds = (rowsByTable.get(tableName) || []).map((row) =>
      String(row.id),
    );
    if (!objectIds.length) continue;
    const result = await client.query<{ transaction_id: string }>(
      `SELECT transaction_id
       FROM monthly_financial_bank_transaction_links
       WHERE business_object_type=$1
         AND business_object_id=ANY($2::text[])`,
      [businessObjectType, objectIds],
    );
    relatedMonthlyLinkCount += result.rows.length;
    result.rows.forEach((row) => relatedTransactionIds.add(row.transaction_id));
  }
  let relatedBankFileCount = 0;
  if (relatedTransactionIds.size) {
    const result = await client.query<{ count: number }>(
      `SELECT COUNT(DISTINCT current_file_id)::int AS count
       FROM monthly_financial_bank_transactions
       WHERE id=ANY($1::text[])`,
      [Array.from(relatedTransactionIds)],
    );
    relatedBankFileCount = Number(result.rows[0]?.count || 0);
  }
  return [
    {
      tableName: "users",
      reason: "仅输出稳定账号映射键，不复制开发账号",
      rowCount: accounts.length,
    },
    {
      tableName: "worklog_projects",
      reason: "最终合同台账没有项目外键，项目数据不进入迁移包",
      rowCount: 0,
    },
    {
      tableName: "contract_rate_configs",
      reason: "生产保留自身费率配置，开发费率配置不迁移",
      rowCount: Number(rateResult.rows[0]?.count || 0),
      sourceFingerprint: rateBusinessFingerprint,
    },
    {
      tableName: "monthly_financial_bank_transaction_links",
      reason: "月报银行回单关联引用开发月报主键，生产需重新识别同步",
      rowCount: relatedMonthlyLinkCount,
    },
    {
      tableName: "monthly_financial_bank_transactions",
      reason: "开发月报银行交易不迁移",
      rowCount: relatedTransactionIds.size,
    },
    {
      tableName: "monthly_financial_bank_files",
      reason: "开发月报银行文件不迁移",
      rowCount: relatedBankFileCount,
    },
    {
      tableName: "monthly_financial_reports",
      reason: "生产月报数据保持原状",
    },
  ];
}

async function readDatabaseSnapshot(
  client: PoolClient,
): Promise<DatabaseSnapshot> {
  await assertTrackedContractTables(client);
  const { contractIds, rootContractIds } = await selectContractIds(client);
  const tableNames = CONTRACT_LEDGER_SNAPSHOT_TABLES.map(
    (table) => table.tableName,
  );
  const schema = await captureSchema(client, tableNames);
  const rowsByTable = await selectTableRows(client, contractIds);
  validateForeignKeyClosure(schema, rowsByTable);
  const accounts = await buildAccountMappings(client, schema, rowsByTable);
  const sequences = await captureSequences(client);
  const exclusions = await buildExclusions(client, accounts, rowsByTable);
  return {
    contractIds,
    rootContractIds,
    schema,
    rowsByTable,
    accounts,
    sequences,
    exclusions,
  };
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

function collectReferencedFiles(
  schema: SnapshotSchema,
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
): ReferencedFilePlan[] {
  const plansByPath = new Map<string, ReferencedFilePlan>();
  for (const table of schema.tables) {
    const pathColumns = table.columns
      .map((column) => column.columnName)
      .filter((columnName) => /(^|_)path($|_)/u.test(columnName));
    for (const row of rowsByTable.get(table.tableName) || []) {
      for (const columnName of pathColumns) {
        const rawPath = row[columnName];
        if (typeof rawPath !== "string" || !rawPath.trim()) continue;
        const storedPath = normalizeStoredUploadPath(rawPath);
        const plan = plansByPath.get(storedPath) || {
          storedPath,
          declaredHashes: new Set<string>(),
          declaredSizes: new Set<number>(),
          references: [],
        };
        const hashColumn = metadataColumnName(row, columnName, "hash");
        const declaredHash = hashColumn ? row[hashColumn] : null;
        if (typeof declaredHash === "string" && declaredHash.trim()) {
          const normalizedHash = declaredHash.trim().toLowerCase();
          if (!SHA256_PATTERN.test(normalizedHash)) {
            throw new Error(
              `${table.tableName}.${hashColumn} 不是有效的 SHA-256 摘要`,
            );
          }
          plan.declaredHashes.add(normalizedHash);
        }
        const sizeColumn = metadataColumnName(row, columnName, "size");
        const declaredSize = sizeColumn ? Number(row[sizeColumn]) : NaN;
        if (Number.isSafeInteger(declaredSize) && declaredSize >= 0) {
          plan.declaredSizes.add(declaredSize);
        }
        plan.references.push({
          tableName: table.tableName,
          rowId: String(row.id),
          columnName,
        });
        plansByPath.set(storedPath, plan);
      }
    }
  }
  return Array.from(plansByPath.values())
    .map((plan) => {
      if (plan.declaredHashes.size > 1) {
        throw new Error(`同一路径登记了不同文件摘要：${plan.storedPath}`);
      }
      if (plan.declaredSizes.size > 1) {
        throw new Error(`同一路径登记了不同文件大小：${plan.storedPath}`);
      }
      plan.references.sort((left, right) =>
        `${left.tableName}\0${left.rowId}\0${left.columnName}`.localeCompare(
          `${right.tableName}\0${right.rowId}\0${right.columnName}`,
        ),
      );
      return plan;
    })
    .sort((left, right) => left.storedPath.localeCompare(right.storedPath));
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

async function copyFileToContentAddressedBlob(input: {
  sourcePath: string;
  temporaryPath: string;
  blobRoot: string;
  expectedHashes: ReadonlySet<string>;
  expectedSizes: ReadonlySet<number>;
}): Promise<{
  bundlePath: string;
  bytes: number;
  sha256: string;
  newBlob: boolean;
}> {
  const sourceStat = await fs.promises.stat(input.sourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`附件不是普通文件：${input.sourcePath}`);
  }
  await fs.promises.mkdir(path.dirname(input.temporaryPath), {
    recursive: true,
  });
  const hash = crypto.createHash("sha256");
  let streamedBytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      streamedBytes += chunk.length;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    fs.createReadStream(input.sourcePath),
    meter,
    fs.createWriteStream(input.temporaryPath, { flags: "wx", mode: 0o600 }),
  );
  const sha256 = hash.digest("hex");
  if (streamedBytes !== sourceStat.size) {
    throw new Error(`附件复制期间大小发生变化：${input.sourcePath}`);
  }
  if (input.expectedHashes.size && !input.expectedHashes.has(sha256)) {
    throw new Error(`附件内容与数据库摘要不一致：${input.sourcePath}`);
  }
  if (input.expectedSizes.size && !input.expectedSizes.has(streamedBytes)) {
    throw new Error(`附件内容与数据库大小不一致：${input.sourcePath}`);
  }
  const bundlePath = path.posix.join("files", sha256.slice(0, 2), sha256);
  const finalBlobPath = path.join(input.blobRoot, sha256.slice(0, 2), sha256);
  await fs.promises.mkdir(path.dirname(finalBlobPath), { recursive: true });
  let newBlob = false;
  try {
    await fs.promises.link(input.temporaryPath, finalBlobPath);
    newBlob = true;
  } catch (error) {
    const code = String((error as NodeJS.ErrnoException).code || "");
    if (code !== "EEXIST") throw error;
    const existing = await fs.promises.stat(finalBlobPath);
    if (existing.size !== streamedBytes) {
      throw new Error(`内容寻址附件大小冲突：${bundlePath}`);
    }
    const existingHash = await hashFile(finalBlobPath);
    if (existingHash !== sha256) {
      throw new Error(`内容寻址附件摘要冲突：${bundlePath}`);
    }
  }
  await fs.promises.unlink(input.temporaryPath);
  return { bundlePath, bytes: streamedBytes, sha256, newBlob };
}

async function writeTableDataFiles(
  stageDirectory: string,
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>,
): Promise<SnapshotTableDataEntry[]> {
  const tableDirectory = path.join(stageDirectory, "tables");
  await fs.promises.mkdir(tableDirectory, { recursive: true });
  const entries: SnapshotTableDataEntry[] = [];
  for (const definition of CONTRACT_LEDGER_SNAPSHOT_TABLES) {
    const tableName = definition.tableName;
    const rows = rowsByTable.get(tableName) || [];
    const relativePath = path.posix.join("tables", `${tableName}.json`);
    const content = `${canonicalJsonStringify({ tableName, rows })}\n`;
    await fs.promises.writeFile(
      path.join(stageDirectory, relativePath),
      content,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    entries.push({
      tableName,
      relativePath,
      rowCount: rows.length,
      bytes: Buffer.byteLength(content),
      sha256: sha256Text(content),
    });
  }
  return entries;
}

async function writeReferencedFiles(
  stageDirectory: string,
  sourceFilesRoot: string,
  plans: readonly ReferencedFilePlan[],
): Promise<SnapshotFileEntry[]> {
  const realSourceRoot = await fs.promises.realpath(sourceFilesRoot);
  const temporaryRoot = path.join(stageDirectory, ".file-copy-work");
  const blobRoot = path.join(stageDirectory, "files");
  const entries: SnapshotFileEntry[] = [];
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]!;
    const joinedSourcePath = path.resolve(
      realSourceRoot,
      ...plan.storedPath.split("/"),
    );
    const realSourcePath = await fs.promises.realpath(joinedSourcePath);
    if (!isPathInside(realSourceRoot, realSourcePath)) {
      throw new Error(`附件物理路径越界：${plan.storedPath}`);
    }
    const copied = await copyFileToContentAddressedBlob({
      sourcePath: realSourcePath,
      temporaryPath: path.join(
        temporaryRoot,
        `copy-${String(index).padStart(6, "0")}`,
      ),
      blobRoot,
      expectedHashes: plan.declaredHashes,
      expectedSizes: plan.declaredSizes,
    });
    entries.push({
      storedPath: plan.storedPath,
      bundlePath: copied.bundlePath,
      bytes: copied.bytes,
      sha256: copied.sha256,
      references: plan.references,
    });
  }
  await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
  return entries;
}

function buildSummary(input: {
  rowsByTable: ReadonlyMap<string, SnapshotRow[]>;
  accounts: readonly SnapshotAccountMappingEntry[];
  tables: readonly SnapshotTableDataEntry[];
  files: readonly SnapshotFileEntry[];
}): ContractLedgerSnapshotSummary {
  const contracts = input.rowsByTable.get("contracts") || [];
  const filesByHash = new Map<string, number>();
  input.files.forEach((file) => filesByHash.set(file.sha256, file.bytes));
  const confirmed = (row: SnapshotRow) => row.status === "confirmed";
  return {
    tableRowCounts: Object.fromEntries(
      input.tables.map((table) => [table.tableName, table.rowCount]),
    ),
    contractCounts: {
      total: contracts.length,
      roots: contracts.filter((row) => row.relation_type === "main").length,
      supplements: contracts.filter((row) => row.relation_type === "supplement")
        .length,
      terminations: contracts.filter(
        (row) => row.relation_type === "termination",
      ).length,
      active: contracts.filter((row) => row.is_deleted !== true).length,
      softDeleted: contracts.filter((row) => row.is_deleted === true).length,
    },
    financialAmounts: {
      confirmedInvoices: summarizeAmountRows(
        input.rowsByTable.get("contract_invoices") || [],
        "amount",
        confirmed,
      ),
      confirmedReceipts: summarizeAmountRows(
        input.rowsByTable.get("contract_receipts") || [],
        "amount",
        confirmed,
      ),
      confirmedPayments: summarizeAmountRows(
        input.rowsByTable.get("contract_payments") || [],
        "amount",
        confirmed,
      ),
      confirmedExternalPayments: summarizeAmountRows(
        input.rowsByTable.get("contract_external_payments") || [],
        "amount",
        confirmed,
      ),
      deposits: summarizeAmountRows(
        input.rowsByTable.get("contract_deposits") || [],
        "amount",
      ),
      settledDeposits: summarizeAmountRows(
        input.rowsByTable.get("contract_deposits") || [],
        "settled_amount",
      ),
    },
    financialCounts: {
      registrations: (
        input.rowsByTable.get("contract_financial_registrations") || []
      ).length,
      registrationItems: (
        input.rowsByTable.get("contract_financial_registration_items") || []
      ).length,
      registrationMatches: (
        input.rowsByTable.get("contract_financial_registration_matches") || []
      ).length,
      purposeDetails: (
        input.rowsByTable.get("contract_payment_purpose_details") || []
      ).length,
      depositReceipts: (
        input.rowsByTable.get("contract_payment_deposit_receipts") || []
      ).length,
    },
    accountCount: input.accounts.length,
    accountReferenceCount: input.accounts.reduce(
      (total, account) => total + account.references.length,
      0,
    ),
    storedFileCount: input.files.length,
    uniqueBlobCount: filesByHash.size,
    storedFileBytes: input.files.reduce((total, file) => total + file.bytes, 0),
    uniqueBlobBytes: Array.from(filesByHash.values()).reduce(
      (total, bytes) => total + bytes,
      0,
    ),
  };
}

function validateOutputDirectory(outputDirectory: string): void {
  const parsed = path.parse(outputDirectory);
  if (outputDirectory === parsed.root || outputDirectory === process.cwd()) {
    throw new Error("迁移包输出目录不能是文件系统根目录或当前工作目录");
  }
  if (fs.existsSync(outputDirectory)) {
    throw new Error(`迁移包输出目录已经存在，拒绝覆盖：${outputDirectory}`);
  }
}

export async function exportContractLedgerSnapshot(
  args: ExportArguments,
  pool: Pool,
): Promise<{
  outputDirectory: string;
  manifest: ContractLedgerSnapshotManifest;
}> {
  assertDevelopmentExportEnvironment();
  validateOutputDirectory(args.outputDirectory);
  const stageDirectory = `${args.outputDirectory}.building-${process.pid}-${Date.now()}`;
  if (fs.existsSync(stageDirectory)) {
    throw new Error(`临时输出目录已经存在：${stageDirectory}`);
  }
  await fs.promises.mkdir(path.dirname(args.outputDirectory), {
    recursive: true,
  });
  await fs.promises.mkdir(stageDirectory, { recursive: false, mode: 0o700 });

  try {
    const client = await pool.connect();
    let snapshot: DatabaseSnapshot;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      snapshot = await readDatabaseSnapshot(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const tableEntries = await writeTableDataFiles(
      stageDirectory,
      snapshot.rowsByTable,
    );
    const referencedFiles = collectReferencedFiles(
      snapshot.schema,
      snapshot.rowsByTable,
    );
    const fileEntries = await writeReferencedFiles(
      stageDirectory,
      args.sourceFilesRoot,
      referencedFiles,
    );
    const summary = buildSummary({
      rowsByTable: snapshot.rowsByTable,
      accounts: snapshot.accounts,
      tables: tableEntries,
      files: fileEntries,
    });
    const exportedAt = new Date().toISOString();
    const manifestWithoutHashes = {
      formatVersion: CONTRACT_LEDGER_SNAPSHOT_FORMAT_VERSION,
      kind: CONTRACT_LEDGER_SNAPSHOT_KIND,
      snapshotKey: args.snapshotKey,
      exportedAt,
      source: {
        environment: "development" as const,
        historicalImportBatchKey: CONTRACT_LEDGER_HISTORICAL_IMPORT_BATCH_KEY,
        contractCount: snapshot.contractIds.length,
        rootContractCount: snapshot.rootContractIds.length,
      },
      schema: snapshot.schema,
      accounts: snapshot.accounts,
      sequences: snapshot.sequences,
      tables: tableEntries,
      files: fileEntries,
      summary,
      exclusions: snapshot.exclusions,
    };
    const contentSha256 = calculateSnapshotContentSha256(manifestWithoutHashes);
    const manifestWithoutFinalHash = {
      ...manifestWithoutHashes,
      contentSha256,
    };
    const manifest: ContractLedgerSnapshotManifest = {
      ...manifestWithoutFinalHash,
      manifestSha256: calculateManifestSha256(manifestWithoutFinalHash),
    };
    await fs.promises.writeFile(
      path.join(stageDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    await fs.promises.rename(stageDirectory, args.outputDirectory);
    return { outputDirectory: args.outputDirectory, manifest };
  } catch (error) {
    await fs.promises.rm(stageDirectory, { recursive: true, force: true });
    throw error;
  }
}

function connectionStringFromEnvironment(): string {
  return (
    process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || "5432"}/${process.env.DB_NAME || "yulilog_worklog"}`
  );
}

function printUsage(): void {
  console.log(`
用法：
  NODE_ENV=development npx tsx server/scripts/export-contract-ledger-snapshot.ts \\
    --output /app/debug/contract-ledger-final-snapshot

可选参数：
  --source-files-root /app       数据库 uploads 相对路径的物理根目录
  --snapshot-key <标识>          默认使用已确认最终台账标识

说明：
  工具只读取开发数据库和附件，不修改数据库；输出目录必须不存在。
`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    printUsage();
    return;
  }
  const args = parseExportArguments(process.argv.slice(2));
  const pool = new Pool({
    connectionString: connectionStringFromEnvironment(),
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const result = await exportContractLedgerSnapshot(args, pool);
    console.log(
      JSON.stringify(
        {
          结果: "合同台账迁移包导出完成",
          输出目录: result.outputDirectory,
          清单摘要: result.manifest.manifestSha256,
          内容摘要: result.manifest.contentSha256,
          合同数: result.manifest.summary.contractCounts.total,
          表记录数: Object.values(
            result.manifest.summary.tableRowCounts,
          ).reduce((total, count) => total + count, 0),
          附件路径数: result.manifest.summary.storedFileCount,
          附件内容数: result.manifest.summary.uniqueBlobCount,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}

const directEntry = /export-contract-ledger-snapshot\.(?:ts|js)$/u.test(
  path.basename(process.argv[1] || ""),
);
if (directEntry) {
  void main().catch((error) => {
    console.error(
      `合同台账迁移包导出失败：${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
