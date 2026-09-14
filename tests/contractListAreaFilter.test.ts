/** @jest-environment node */

import { CONTRACT_LEDGER_ROOT_AREA_FILTER_SQL } from "../server/services/contractLedgerFilter";

const MemoryDatabase = require("better-sqlite3");

describe("合同台账根合同行政区筛选", () => {
  it("列表和合同族总数按根合同区域计算，不受子协议异常区域值影响", () => {
    const database = new MemoryDatabase(":memory:");
    try {
      database.exec(`
        CREATE TABLE contracts (
          id TEXT PRIMARY KEY,
          root_contract_id TEXT,
          relation_type TEXT NOT NULL,
          area TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO contracts VALUES
          ('root-all', NULL, 'main', '全部', 0),
          ('child-specific', 'root-all', 'supplement', '朝阳区', 0),
          ('root-specific', NULL, 'main', '朝阳区', 0),
          ('child-all', 'root-specific', 'supplement', '全部', 0);
      `);

      const list = database
        .prepare(
          `SELECT c.id
           FROM contracts c
           WHERE c.is_deleted = FALSE
             AND ${CONTRACT_LEDGER_ROOT_AREA_FILTER_SQL}
           ORDER BY c.id`,
        )
        .all("全部") as Array<{ id: string }>;
      const total = database
        .prepare(
          `SELECT COUNT(DISTINCT COALESCE(c.root_contract_id, c.id)) AS count
           FROM contracts c
           WHERE c.is_deleted = FALSE
             AND ${CONTRACT_LEDGER_ROOT_AREA_FILTER_SQL}`,
        )
        .get("全部") as { count: number };

      expect(list.map((row) => row.id)).toEqual(["child-specific", "root-all"]);
      expect(total.count).toBe(1);
      expect(list.map((row) => row.id)).not.toContain("child-all");
    } finally {
      database.close();
    }
  });
});
