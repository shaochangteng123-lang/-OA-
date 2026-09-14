import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const CURRENT_DATABASE = "yulilog_worklog";
const BEFORE_DATABASE = "yulilog_pre_second_verify_20260910";
const DRAGON_CONTRACT_ID = "sdylIKVZJDN8jYQ342rOL";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function connection(database: string): Client {
  const url = new URL(process.env.DATABASE_URL || "");
  if (/prod(?:uction)?/iu.test(url.toString())) {
    throw new Error("数据库连接疑似生产环境，拒绝差异审计");
  }
  url.pathname = `/${database}`;
  return new Client({ connectionString: url.toString() });
}

async function tableNames(client: Client): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND (table_name LIKE 'contract%' OR table_name IN ('users','worklog_projects'))
     ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

async function columns(client: Client, tableName: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [tableName],
  );
  return result.rows.map((row) => row.column_name);
}

async function primaryKey(
  client: Client,
  tableName: string,
): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `SELECT attribute.attname AS column_name
     FROM pg_index index_definition
     JOIN pg_class table_definition
       ON table_definition.oid=index_definition.indrelid
     JOIN pg_namespace namespace
       ON namespace.oid=table_definition.relnamespace
     JOIN unnest(index_definition.indkey) WITH ORDINALITY key(attnum,position)
       ON TRUE
     JOIN pg_attribute attribute
       ON attribute.attrelid=table_definition.oid
      AND attribute.attnum=key.attnum
     WHERE namespace.nspname='public' AND table_definition.relname=$1
       AND index_definition.indisprimary
     ORDER BY key.position`,
    [tableName],
  );
  return result.rows.map((row) => row.column_name);
}

function quoted(identifier: string): string {
  return `"${identifier.replace(/"/gu, '""')}"`;
}

function rowKey(row: Record<string, unknown>, keys: readonly string[]): string {
  return keys.map((key) => stable(row[key])).join("\0");
}

function allowedChangedColumns(
  tableName: string,
  row: Record<string, unknown>,
): ReadonlySet<string> | null {
  if (tableName === "contracts" && row.id === DRAGON_CONTRACT_ID) {
    return new Set([
      "is_deleted",
      "deleted_at",
      "status",
      "completed_at",
      "updated_by",
      "updated_at",
      "version",
    ]);
  }
  if (
    tableName === "contract_invoices" &&
    row.contract_id === DRAGON_CONTRACT_ID
  ) {
    return new Set(["financial_ocr_job_id", "updated_at"]);
  }
  if (
    tableName === "contract_financial_registrations" &&
    row.contract_id === DRAGON_CONTRACT_ID
  ) {
    return new Set([
      "financial_direction",
      "direction_invoice_record_id",
      "status",
      "confirmed_by",
      "confirmed_at",
      "reversed_by",
      "reversed_at",
      "reverse_reason",
      "updated_at",
    ]);
  }
  return null;
}

function allowedChangedValuesAreExpected(
  tableName: string,
  oldRow: Record<string, unknown>,
  currentRow: Record<string, unknown>,
): boolean {
  if (tableName === "contracts" && oldRow.id === DRAGON_CONTRACT_ID) {
    return (
      currentRow.status === "completed" &&
      currentRow.is_deleted === false &&
      currentRow.deleted_at == null &&
      Boolean(currentRow.completed_at) &&
      Number(currentRow.version) > Number(oldRow.version)
    );
  }
  if (
    tableName === "contract_invoices" &&
    oldRow.contract_id === DRAGON_CONTRACT_ID
  ) {
    return Boolean(currentRow.financial_ocr_job_id);
  }
  if (
    tableName === "contract_financial_registrations" &&
    oldRow.contract_id === DRAGON_CONTRACT_ID
  ) {
    return (
      currentRow.status === "confirmed" &&
      currentRow.settlement_kind === "receipt" &&
      currentRow.financial_direction === "income" &&
      Boolean(currentRow.direction_invoice_record_id) &&
      Boolean(currentRow.confirmed_by) &&
      Boolean(currentRow.confirmed_at) &&
      currentRow.reversed_by == null &&
      currentRow.reversed_at == null &&
      currentRow.reverse_reason == null
    );
  }
  return false;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("差异审计只允许开发环境执行");
  }
  const before = connection(BEFORE_DATABASE);
  const current = connection(CURRENT_DATABASE);
  await Promise.all([before.connect(), current.connect()]);
  try {
    const [beforeTables, currentTables] = await Promise.all([
      tableNames(before),
      tableNames(current),
    ]);
    const commonTables = beforeTables.filter((table) =>
      currentTables.includes(table),
    );
    const results: Array<Record<string, unknown>> = [];
    for (const tableName of commonTables) {
      const [beforeColumns, currentColumns, keys] = await Promise.all([
        columns(before, tableName),
        columns(current, tableName),
        primaryKey(before, tableName),
      ]);
      if (!keys.length) {
        results.push({ tableName, skipped: true, reason: "没有主键" });
        continue;
      }
      const commonColumns = beforeColumns.filter((column) =>
        currentColumns.includes(column),
      );
      const selection = commonColumns.map(quoted).join(",");
      const [beforeRows, currentRows] = await Promise.all([
        before.query<Record<string, unknown>>(
          `SELECT ${selection} FROM ${quoted(tableName)}`,
        ),
        current.query<Record<string, unknown>>(
          `SELECT ${selection} FROM ${quoted(tableName)}`,
        ),
      ]);
      if (
        ["users", "worklog_projects"].includes(tableName) &&
        currentRows.rows.length !== beforeRows.rows.length
      ) {
        throw new Error(
          `${tableName}不属于历史合同导入范围，记录总数不应变化：导入前${beforeRows.rows.length}条、当前${currentRows.rows.length}条`,
        );
      }
      const currentByKey = new Map(
        currentRows.rows.map((row) => [rowKey(row, keys), row]),
      );
      const differences: Array<Record<string, unknown>> = [];
      const allowedChanges: Array<Record<string, unknown>> = [];
      for (const oldRow of beforeRows.rows) {
        const key = rowKey(oldRow, keys);
        const nowRow = currentByKey.get(key);
        if (!nowRow) {
          differences.push({ key, kind: "missing" });
          continue;
        }
        const oldComparable = Object.fromEntries(
          commonColumns.map((column) => [column, oldRow[column]]),
        );
        const currentComparable = Object.fromEntries(
          commonColumns.map((column) => [column, nowRow[column]]),
        );
        if (stable(oldComparable) !== stable(currentComparable)) {
          const changedColumns = commonColumns.filter(
            (column) => stable(oldRow[column]) !== stable(nowRow[column]),
          );
          const permitted = allowedChangedColumns(tableName, oldRow);
          const unexpectedColumns = changedColumns.filter(
            (column) => !permitted?.has(column),
          );
          const allowedValuesExpected = Boolean(
            permitted &&
            allowedChangedValuesAreExpected(tableName, oldRow, nowRow),
          );
          if (
            permitted &&
            unexpectedColumns.length === 0 &&
            allowedValuesExpected
          ) {
            allowedChanges.push({ key, changedColumns });
          } else {
            differences.push({
              key,
              kind: "changed",
              changedColumns,
              unexpectedColumns,
              allowedValuesExpected,
            });
          }
        }
      }
      if (differences.length) {
        throw new Error(
          `${tableName}存在${differences.length}条本批范围外历史记录变化：${JSON.stringify(differences.slice(0, 5))}`,
        );
      }
      results.push({
        tableName,
        oldRowCount: beforeRows.rows.length,
        currentRowCount: currentRows.rows.length,
        oldRowsVerified: beforeRows.rows.length,
        allowedExistingChanges: allowedChanges,
      });
    }
    const report = {
      comparedAt: new Date().toISOString(),
      beforeDatabase: BEFORE_DATABASE,
      currentDatabase: CURRENT_DATABASE,
      comparedTableCount: results.length,
      allowedChangedExistingRows: {
        contracts: [DRAGON_CONTRACT_ID],
        contractInvoices: "龙潭湖既有发票只补历史识别任务引用",
        contractFinancialRegistrations:
          "龙潭湖既有登记仅补方向、主发票引用并由待补更新为已闭环",
      },
      tables: results,
      passed: true,
    };
    const output = argument("--output");
    if (output) {
      const resolved = path.resolve(output);
      await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
      await fs.promises.writeFile(
        resolved,
        `${JSON.stringify(report, null, 2)}\n`,
      );
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.all([before.end(), current.end()]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
