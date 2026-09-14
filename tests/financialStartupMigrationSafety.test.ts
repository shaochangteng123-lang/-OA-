/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";

interface Statement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
}
interface MemoryDatabase {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  function(name: string, callback: () => string): void;
  close(): void;
}
const Database = require("better-sqlite3") as new (
  name: string,
) => MemoryDatabase;
const schemaSource = fs.readFileSync(
  path.resolve(process.cwd(), "server/db/index.ts"),
  "utf8",
);
function extract(pattern: RegExp): string {
  const matches = [...schemaSource.matchAll(pattern)];
  if (matches.length !== 1)
    throw new Error("启动保护语句必须在实际初始化源码中唯一存在");
  return matches[0][0];
}
const registrationSql = extract(
  /UPDATE\s+contract_financial_registrations\s+(?:AS\s+)?registration\b[\s\S]*?;/giu,
);
const accountSql = extract(/INSERT\s+INTO\s+financial_accounts\b[\s\S]*?;/giu);

// 不加载数据库模块、不读取连接配置。只在内存数据库执行实际源码SQL，
// 方言转换仅补目标表别名的AS，以及把NOW()::text替换为可控时钟；不改写任何条件。
const executableRegistration = registrationSql.replace(
  /UPDATE\s+contract_financial_registrations\s+(?!AS\b)(registration)\b/iu,
  "UPDATE contract_financial_registrations AS $1",
);
const executableAccounts = accountSql.replace(/NOW\(\)::text/giu, "test_now()");
let database: MemoryDatabase;
let clock = "本次启动时间";
beforeEach(() => {
  clock = "本次启动时间";
  database = new Database(":memory:");
  database.function("test_now", () => clock);
  database.exec(`
    CREATE TABLE contract_financial_registrations (
      id TEXT PRIMARY KEY, invoice_record_id TEXT, invoice_ocr_job_id TEXT,
      financial_direction TEXT, direction_invoice_record_id TEXT
    );
    CREATE TABLE contract_financial_ocr_jobs (id TEXT PRIMARY KEY, direction TEXT);
    CREATE TABLE contract_financial_registration_items (id TEXT PRIMARY KEY, registration_id TEXT, item_kind TEXT, ocr_job_id TEXT);
    CREATE TABLE financial_accounts (code TEXT PRIMARY KEY, name TEXT, sort_order INTEGER, is_active INTEGER, created_at TEXT, updated_at TEXT);
  `);
});
afterEach(() => database.close());
function addRegistration(
  options: {
    associated?: string | null;
    primary?: string | null;
    direction?: string | null;
    recognized?: string | null;
  } = {},
) {
  database
    .prepare("INSERT INTO contract_financial_ocr_jobs VALUES (?,?)")
    .run(
      "main-job",
      options.recognized === undefined ? "output" : options.recognized,
    );
  database
    .prepare("INSERT INTO contract_financial_registrations VALUES (?,?,?,?,?)")
    .run(
      "registration",
      options.primary === undefined ? "invoice-B" : options.primary,
      "main-job",
      options.direction ?? null,
      options.associated ?? null,
    );
}
function current() {
  return database
    .prepare("SELECT * FROM contract_financial_registrations WHERE id=?")
    .get("registration");
}
function migrateRegistration() {
  return database.prepare(executableRegistration).run().changes;
}
function addItem(direction: string | null, kind = "invoice") {
  database
    .prepare("INSERT INTO contract_financial_ocr_jobs VALUES (?,?)")
    .run("item-job", direction);
  database
    .prepare(
      "INSERT INTO contract_financial_registration_items VALUES (?,?,?,?)",
    )
    .run("item", "registration", kind, "item-job");
}

describe("启动迁移只补缺失发票关联", () => {
  it("实际语句保留已有方向且限定为空的关联，不回归为无条件覆盖", () => {
    expect(registrationSql).toMatch(
      /SET\s+financial_direction\s*=\s*COALESCE\(registration\.financial_direction/iu,
    );
    expect(registrationSql).toContain(
      "registration.direction_invoice_record_id IS NULL",
    );
    expect(registrationSql).toContain(
      "registration.invoice_record_id IS NOT NULL",
    );
    expect(registrationSql).toContain(
      "item_job.direction IS DISTINCT FROM invoice_job.direction",
    );
  });
  it.each([null, "income", "cost"])(
    "已选发票A不等于主发票B且方向为%j时均原样保留",
    (direction) => {
      addRegistration({ associated: "invoice-A", direction });
      const before = current();
      expect(migrateRegistration()).toBe(0);
      expect(current()).toEqual(before);
    },
  );
  it.each([
    ["output", "income"],
    ["input", "cost"],
  ])("关联为空时按%s补齐%s，第二次执行不再更新", (recognized, direction) => {
    addRegistration({ recognized });
    expect(migrateRegistration()).toBe(1);
    expect(current()).toMatchObject({
      financial_direction: direction,
      direction_invoice_record_id: "invoice-B",
    });
    const after = current();
    expect(migrateRegistration()).toBe(0);
    expect(current()).toEqual(after);
  });
  it("已有方向与识别方向一致时只补关联", () => {
    addRegistration({ direction: "income", recognized: "output" });
    expect(migrateRegistration()).toBe(1);
    expect(current()).toMatchObject({
      financial_direction: "income",
      direction_invoice_record_id: "invoice-B",
    });
  });
  it.each([
    ["income", "input"],
    ["cost", "output"],
  ])("已有方向%s与识别%s冲突时不补关联也不改方向", (direction, recognized) => {
    addRegistration({ direction, recognized });
    const before = current();
    expect(migrateRegistration()).toBe(0);
    expect(current()).toEqual(before);
  });
  it("缺主发票时不生成有方向无关联的记录", () => {
    addRegistration({ primary: null });
    expect(migrateRegistration()).toBe(0);
    expect(current()).toMatchObject({
      financial_direction: null,
      direction_invoice_record_id: null,
    });
  });
  it.each(["input", null, "unknown"])(
    "发票明细方向%j与主发票不同或未知时保持混合方向排除",
    (direction) => {
      addRegistration();
      addItem(direction);
      expect(migrateRegistration()).toBe(0);
      expect(current()).toMatchObject({
        financial_direction: null,
        direction_invoice_record_id: null,
      });
    },
  );
  it("同向发票可补齐，非发票明细不误触发混合方向排除", () => {
    addRegistration();
    addItem("input", "receipt");
    expect(migrateRegistration()).toBe(1);
  });
});

describe("资金账户种子只在业务属性变化时更新", () => {
  it("首次新增四账户，后续启动即使时钟改变也不更新任何行或时间", () => {
    expect(database.prepare(executableAccounts).run().changes).toBe(4);
    const before = database
      .prepare("SELECT * FROM financial_accounts ORDER BY code")
      .all();
    clock = "下一次启动时间";
    expect(database.prepare(executableAccounts).run().changes).toBe(0);
    expect(
      database.prepare("SELECT * FROM financial_accounts ORDER BY code").all(),
    ).toEqual(before);
  });
  it.each(["name", "sort_order", "is_active"])(
    "只有%s真正变化的账户被修复，其余账户与创建时间不动",
    (field) => {
      database.prepare(executableAccounts).run();
      const before = database
        .prepare("SELECT * FROM financial_accounts ORDER BY code")
        .all();
      const replacement =
        field === "name" ? "旧名称" : field === "sort_order" ? 99 : 0;
      database
        .prepare(
          `UPDATE financial_accounts SET ${field}=? WHERE code='general'`,
        )
        .run(replacement);
      clock = "修复属性的时间";
      expect(database.prepare(executableAccounts).run().changes).toBe(1);
      const after = database
        .prepare("SELECT * FROM financial_accounts ORDER BY code")
        .all();
      expect(after.filter((row) => row.code !== "general")).toEqual(
        before.filter((row) => row.code !== "general"),
      );
      expect(after.find((row) => row.code === "general")).toMatchObject({
        name: "一般账户",
        sort_order: 1,
        is_active: 1,
        created_at: "本次启动时间",
        updated_at: "修复属性的时间",
      });
      clock = "再次启动时间";
      expect(database.prepare(executableAccounts).run().changes).toBe(0);
      expect(
        database
          .prepare("SELECT * FROM financial_accounts ORDER BY code")
          .all(),
      ).toEqual(after);
    },
  );
});
