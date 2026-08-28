import {
  findExistingPaymentProofIdentity,
  hasDuplicatePaymentProofIdentities,
  lockPaymentProofIdentities,
  normalizePaymentProofFileHash,
  normalizePaymentProofNo,
} from "../server/utils/payment-proof-identity";

describe("付款回单身份规范与事务锁", () => {
  it("电子回单号统一执行NFKC、去非字母数字并大写", () => {
    expect(normalizePaymentProofNo(" ａｂ－１２ / cd_34 ")).toBe("AB12CD34");
    expect(normalizePaymentProofNo("回单-Ａ01")).toBe("A01");
    expect(normalizePaymentProofNo(null)).toBe("");
    expect(normalizePaymentProofFileHash(" AAbb00 ")).toBe("aabb00");
  });

  it("文件摘要和规范回单号使用排序后的同一组事务咨询锁", async () => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    await lockPaymentProofIdentities(client, [
      { fileHash: "BB", proofNo: " no-2 " },
      { fileHash: "aa", proofNo: "ＮＯ－１" },
      { fileHash: "AA", proofNo: "no-1" },
    ]);

    expect(client.query.mock.calls.map((call) => call[1][0])).toEqual([
      "reimbursement-proof-file:aa",
      "reimbursement-proof-file:bb",
      "reimbursement-proof-no:NO1",
      "reimbursement-proof-no:NO2",
    ]);
  });

  it("事务内重复查询与数据库表达式索引使用相同规范", async () => {
    const client = {
      query: jest.fn().mockResolvedValue({
        rows: [{ id: "proof-1", file_hash: "aa", proof_no: "NO1" }],
      }),
    };
    const existing = await findExistingPaymentProofIdentity(client, [
      { fileHash: " AA ", proofNo: "ｎｏ－１" },
    ]);

    expect(existing?.id).toBe("proof-1");
    expect(client.query.mock.calls[0][0]).toContain(
      "NORMALIZE(BTRIM(proof_no), NFKC)",
    );
    expect(client.query.mock.calls[0][0]).toContain("'[^A-Za-z0-9]+'");
    expect(client.query.mock.calls[0][1]).toEqual([["aa"], ["NO1"]]);
  });

  it("同一请求内拒绝重复摘要、重复规范回单号和空摘要", () => {
    expect(
      hasDuplicatePaymentProofIdentities([
        { fileHash: "aa", proofNo: "NO-1" },
        { fileHash: "AA", proofNo: "NO-2" },
      ]),
    ).toBe(true);
    expect(
      hasDuplicatePaymentProofIdentities([
        { fileHash: "aa", proofNo: "ＮＯ－１" },
        { fileHash: "bb", proofNo: "NO1" },
      ]),
    ).toBe(true);
    expect(
      hasDuplicatePaymentProofIdentities([{ fileHash: "", proofNo: "NO1" }]),
    ).toBe(true);
  });
});
