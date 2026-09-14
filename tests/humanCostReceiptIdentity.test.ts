import type { PoolClient } from "pg";
import {
  HumanCostReceiptIdentityError,
  reserveHumanCostReceiptNumbers,
} from "../server/services/humanCostReceiptIdentity";

function database(existing: unknown[] = [], processing = true) {
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("FROM human_cost_receipts WHERE"))
      return { rows: processing ? [{ id: "当前文件" }] : [] };
    if (sql.includes("FROM human_cost_receipt_numbers n"))
      return { rows: existing };
    return { rows: [] };
  });
  return { query, client: { query } as unknown as PoolClient };
}

describe("社保公积金电子回单号去重", () => {
  it("统一全角、横线、空格和大小写，同文件重复即拒绝且不写入新号码", async () => {
    const { client, query } = database();
    await expect(
      reserveHumanCostReceiptNumbers(client, "当前文件", [
        { electronicReceiptNo: "ＡＢ－１２３４", amount: 100 },
        { electronicReceiptNo: "ab 1234", amount: 100 },
      ]),
    ).rejects.toThrow("文件内电子回单号 AB1234 重复");
    expect(
      query.mock.calls.some(
        ([sql]) => sql.startsWith("INSERT") || sql.startsWith("DELETE"),
      ),
    ).toBe(false);
  });

  it("跨月份重复提示原文件，包含新号码的混合文件也不会部分抢占", async () => {
    const { client, query } = database([
      {
        electronic_receipt_no: "09190001",
        payroll_month: "2026-07",
        file_name: "原始社保回单.png",
      },
    ]);
    await expect(
      reserveHumanCostReceiptNumbers(client, "新文件", [
        { electronicReceiptNo: "新号码002", amount: 200 },
        { electronicReceiptNo: "0919-0001", amount: 100 },
      ]),
    ).rejects.toThrow("2026-07 的“原始社保回单.png”");
    expect(
      query.mock.calls.some(
        ([sql]) => sql.startsWith("INSERT") || sql.startsWith("DELETE"),
      ),
    ).toBe(false);
  });

  it("自身重识别排除自己并重建号码，同金额不同回单号可分别登记", async () => {
    const { client, query } = database();
    await expect(
      reserveHumanCostReceiptNumbers(client, "当前文件", [
        { electronicReceiptNo: "0919-0001", amount: 100.1 },
        { electronicReceiptNo: "0919-0002", amount: 100.1 },
      ]),
    ).resolves.toBe(true);
    expect(
      query.mock.calls
        .filter(([sql]) => sql.startsWith("INSERT"))
        .map(([, params]) => params),
    ).toEqual([
      ["09190001", "当前文件", "100.10"],
      ["09190002", "当前文件", "100.10"],
    ]);
    expect(
      query.mock.calls.find(([sql]) => sql.includes("ANY($1"))?.[1],
    ).toEqual([["09190001", "09190002"], "当前文件"]);
  });

  it("已删除或已完成的任务不能登记号码", async () => {
    const { client, query } = database([], false);
    await expect(
      reserveHumanCostReceiptNumbers(client, "已删除文件", [
        { electronicReceiptNo: "0919-0001", amount: 1 },
      ]),
    ).resolves.toBe(false);
    expect(
      query.mock.calls.some(
        ([sql]) => sql.startsWith("INSERT") || sql.startsWith("DELETE"),
      ),
    ).toBe(false);
  });

  it("缺电子回单号不以金额或交易流水替代，也不视为引擎故障", async () => {
    const { client } = database();
    await expect(
      reserveHumanCostReceiptNumbers(client, "当前文件", [
        { electronicReceiptNo: "", amount: 100 },
      ]),
    ).rejects.toBeInstanceOf(HumanCostReceiptIdentityError);
  });
});
