/** @jest-environment node */

import fs from "fs";
import path from "path";

const readSource = (relativePath: string) =>
  fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("补充协议金额链持久化与兼容迁移", () => {
  const databaseSource = readSource("server/db/index.ts");
  const serviceSource = readSource("server/services/contractService.ts");
  const routeSource = readSource("server/routes/contracts.ts");

  it("先补齐序号字段和历史数据，再创建唯一索引", () => {
    const addColumnPosition = databaseSource.indexOf(
      "ALTER TABLE contracts ADD COLUMN IF NOT EXISTS supplement_sequence",
    );
    const uniqueIndexPosition = databaseSource.indexOf(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_supplement_sequence_unique",
    );

    expect(addColumnPosition).toBeGreaterThan(-1);
    expect(uniqueIndexPosition).toBeGreaterThan(addColumnPosition);
    expect(
      databaseSource.match(
        /CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_supplement_sequence_unique/gu,
      ),
    ).toHaveLength(1);
    expect(databaseSource).toContain("duplicate_sequences AS");
    expect(databaseSource).toContain("duplicate.duplicate_rank > 1");
  });

  it("数据库约束绑定补充协议序号和完整金额快照", () => {
    expect(databaseSource).toContain(
      "relation_type = 'supplement' AND\n          supplement_sequence IS NOT NULL AND supplement_sequence > 0",
    );
    expect(databaseSource).toContain(
      "relation_type <> 'supplement' AND supplement_sequence IS NULL",
    );
    expect(databaseSource).toContain(
      "amount_after_change = amount_before_change + amount_delta",
    );
    expect(databaseSource).toContain(
      "supplement_change_type IS DISTINCT FROM 'payment_terms_only'",
    );
    expect(databaseSource).toContain("amount_delta = 0");
  });

  it("历史有效协议按顺序生成快照且明确最终总额优先", () => {
    expect(databaseSource).toContain("effective_ordered AS");
    expect(databaseSource).toContain("effective_segmented AS");
    expect(databaseSource).toContain("effective_accumulated AS");
    expect(databaseSource).toContain("child.recognized_final_amount");
    expect(databaseSource).toContain("AS authoritative_after");
    expect(databaseSource).toContain(
      "amount_delta = snapshot.calculated_after - snapshot.calculated_before",
    );
    expect(databaseSource).not.toContain("SUM(child.amount_delta)");
  });

  it("运行时统一读取根合同当前有效金额而不重新累加协议增减额", () => {
    const runtimeSource = `${serviceSource}\n${routeSource}`;
    expect(runtimeSource).toContain("root.current_effective_amount");
    expect(runtimeSource).toContain("root.original_contract_amount");
    expect(runtimeSource).not.toContain("SUM(amount_delta)");
    expect(runtimeSource).not.toContain("SUM(child.amount_delta)");
    expect(runtimeSource).not.toContain("SUM(chain.amount_delta)");
    expect(runtimeSource).not.toContain("THEN child.amount_delta ELSE 0 END");
  });

  it("合同详情关系查询显式选择编号、分类和金额链字段", () => {
    expect(routeSource).toContain(
      "SELECT id, contract_no, business_contract_no, title, project_name",
    );
    expect(routeSource).toContain(
      "declared_category, category, relation_type, status",
    );
    expect(routeSource).toContain(
      "recognized_final_amount, amount_before_change, amount_after_change",
    );
    expect(routeSource).toContain(
      "current_effective_amount, supplement_change_type",
    );
    expect(routeSource).toContain("supplement_sequence, effective_at");
  });
});
