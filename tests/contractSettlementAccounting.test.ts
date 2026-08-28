jest.mock("nanoid", () => ({ nanoid: () => "settlement-audit-id" }));
jest.mock("../server/db/index", () => ({ db: {} }));

import fs from "fs";
import path from "path";
import {
  contractCostSettlementAmountSql,
  contractCostSettlementLastDateSql,
  prorateContractSettlementCents,
} from "../server/services/contractSettlementAccounting";
import { recalculateContractExecutionStatus } from "../server/services/contractService";

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: "contract-root",
    root_contract_id: "contract-root",
    relation_type: "main",
    status: "effective",
    category: "asset",
    declared_category: "asset",
    declared_subtype: "house_rental",
    asset_category: "house_rental",
    asset_funding_mode: "engineering_direct",
    financial_direction: "cost",
    current_effective_amount: 100,
    original_contract_amount: 100,
    amount_delta: 100,
    project_id: null,
    version: 1,
    ...overrides,
  };
}

function statusClient(input: {
  contract: ReturnType<typeof contract>;
  rawPayment: number;
  rawExternalPayment?: number;
  fulfillmentSettlement: number;
}) {
  return {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (
        sql.includes("SELECT * FROM contracts") &&
        sql.includes("FOR UPDATE")
      ) {
        return { rows: [input.contract] };
      }
      if (sql.includes("relation_type = 'termination'")) return { rows: [] };
      if (sql.includes("AS contract_total")) {
        return {
          rows: [
            {
              contract_total: "100.00",
              invoice_count: 1,
              invoice_total: "100.00",
              receipt_total: "0.00",
              payment_total: input.rawPayment.toFixed(2),
              external_payment_total: (input.rawExternalPayment || 0).toFixed(
                2,
              ),
              cost_settlement_total: input.fulfillmentSettlement.toFixed(2),
            },
          ],
        };
      }
      if (sql.includes("UPDATE contracts SET status = $2")) {
        return {
          rows: [{ ...input.contract, status: String(params?.[1] || "") }],
        };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe("资产合同履约结算统一口径", () => {
  it("混合发票按含税金额比例精确分配到整数分且不发生大金额溢出", () => {
    expect(prorateContractSettlementCents(5_000, 6_000, 10_000)).toBe(3_000);
    expect(prorateContractSettlementCents(1, 1, 2)).toBe(1);
    expect(
      prorateContractSettlementCents(
        90_000_000_000_000,
        60_000_000_000_000,
        90_000_000_000_000,
      ),
    ).toBe(60_000_000_000_000);
  });

  it("数据库表达式只累计已匹配且明确计入合同核算的房租发票分配额", () => {
    const sql = contractCostSettlementAmountSql({
      rootAlias: "root",
      rootIdExpression: "root.id",
    });

    expect(sql).toContain("contract_financial_registration_matches");
    expect(sql).toContain("financial_match.allocated_amount");
    expect(sql).toContain("contract_invoice_line_items");
    expect(sql).toContain("line.include_in_contract_accounting = TRUE");
    expect(sql).toContain("line.recognition_status = 'verified'");
    expect(sql).toContain("settlement_payment.status = 'confirmed'");
    expect(sql).toContain("matched_invoice.status = 'confirmed'");
    expect(sql).toContain("accounting_invoice.status <> 'reversed'");
    expect(sql).toContain("root.declared_subtype = 'house_rental'");
    expect(sql).toContain("settlement_item.item_kind = 'external_payment'");
    expect(sql.indexOf("WHEN EXISTS (")).toBeLessThan(
      sql.lastIndexOf(
        "WHEN root.asset_funding_mode = 'engineering_to_technology'",
      ),
    );
  });

  it("履约截止日期与金额使用同一发票明细及内部划拨边界", () => {
    const sql = contractCostSettlementLastDateSql({
      rootAlias: "root",
      rootIdExpression: "root.id",
    });

    expect(sql).toContain("MAX(settlement_payment.payment_date)");
    expect(sql).toContain(
      "accounting_line.include_in_contract_accounting = TRUE",
    );
    expect(sql).toContain("contract_external_payments settlement_payment");
    expect(sql).toContain("root.declared_subtype = 'house_rental'");
  });

  it("房租现金付款虽已满额，核算分配额未满时状态仍为执行中", async () => {
    const root = contract();
    const client = statusClient({
      contract: root,
      rawPayment: 100,
      fulfillmentSettlement: 80,
    });

    await expect(
      recalculateContractExecutionStatus(
        client as never,
        root.id,
        "admin-1",
        "admin",
      ),
    ).resolves.toMatchObject({ status: "executing" });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("cost_settlement_total"),
      [root.id],
    );
  });

  it("非房租资产无行项目时继续按已确认付款全额完成履约", async () => {
    const root = contract({
      declared_subtype: "procurement",
      asset_category: "procurement",
    });
    const client = statusClient({
      contract: root,
      rawPayment: 100,
      fulfillmentSettlement: 100,
    });

    await expect(
      recalculateContractExecutionStatus(
        client as never,
        root.id,
        "admin-1",
        "admin",
      ),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("内部划拨房租即使外付含保证金和电费，也只用明细匹配后的租金物业完成履约", async () => {
    const root = contract({
      asset_funding_mode: "engineering_to_technology",
    });
    const client = statusClient({
      contract: root,
      rawPayment: 0,
      rawExternalPayment: 132,
      fulfillmentSettlement: 100,
    });

    await expect(
      recalculateContractExecutionStatus(
        client as never,
        root.id,
        "admin-1",
        "admin",
      ),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("无发票行项目的停车等内部划拨费用继续按外部付款全额统计", async () => {
    const root = contract({
      declared_subtype: "parking_space",
      asset_category: "parking_space",
      asset_funding_mode: "engineering_to_technology",
    });
    const client = statusClient({
      contract: root,
      rawPayment: 0,
      rawExternalPayment: 100,
      fulfillmentSettlement: 100,
    });

    await expect(
      recalculateContractExecutionStatus(
        client as never,
        root.id,
        "admin-1",
        "admin",
      ),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("合同 API 的台账、详情、经营看板均复用统一口径，同时保留原始付款字段", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const usages = source.match(/contractCostSettlementAmountSql\(\{/g) || [];

    expect(usages.length).toBeGreaterThanOrEqual(6);
    expect(source).toContain("AS cost_settled_amount");
    expect(source).toContain("costSettledAmount");
    expect(source).toContain("paidAmount");
    expect(source).toContain(
      "THEN financial.cost_settled_amount ELSE financial.received_amount",
    );
  });
});
