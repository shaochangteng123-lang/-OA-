jest.mock("nanoid", () => ({ nanoid: () => "审计编号" }));
jest.mock("../server/db/index", () => ({ db: {} }));
import type { PoolClient } from "pg";
import { refreshPendingAssetFundingMode } from "../server/services/contractService";

describe("资产合同资金方式自动补齐", () => {
  it.each([
    ["北京羽隶工程咨询有限公司", "engineering_direct"],
    ["北京羽隶科技有限公司", "engineering_to_technology"],
  ])("依据%s补齐主合同方式并保存审计", async (partyA, expected) => {
    const query = jest.fn(async (sql: string, _values?: unknown[]) => ({
      rows: sql.startsWith("SELECT root")
        ? [
            {
              id: "主合同",
              party_a: partyA,
              party_b: "北京市国信公证处",
              status: "effective",
              asset_funding_mode: null,
            },
          ]
        : [],
    }));
    await refreshPendingAssetFundingMode(
      { query } as unknown as PoolClient,
      "当前合同",
      "用户",
      "admin",
    );
    expect(
      query.mock.calls.find(([sql]) =>
        sql.startsWith("UPDATE contracts"),
      )?.[1]?.[1],
    ).toBe(expected);
    expect(
      query.mock.calls.find(([sql]) =>
        sql.startsWith("INSERT INTO contract_audit_logs"),
      )?.[1]?.[1],
    ).toBe("主合同");
  });
  it("主体未知时不猜测或自动放开付款", async () => {
    const query = jest
      .fn()
      .mockResolvedValue({
        rows: [
          {
            id: "主合同",
            party_a: "国网北京市电力公司",
            party_b: "北京市国信公证处",
            asset_funding_mode: "pending_review",
          },
        ],
      });
    await refreshPendingAssetFundingMode(
      { query } as unknown as PoolClient,
      "当前合同",
      "用户",
      "admin",
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("没有待补齐记录时不改已确定模式和版本", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    await refreshPendingAssetFundingMode(
      { query } as unknown as PoolClient,
      "当前合同",
      "用户",
      "admin",
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});
