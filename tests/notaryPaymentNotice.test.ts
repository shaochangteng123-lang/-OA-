/** @jest-environment node */
jest.mock("nanoid", () => ({ nanoid: () => "测试编号" }));
jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcrDetailed: jest.fn(),
}));
import type { PoolClient } from "pg";
import {
  parseNotaryPaymentNotice,
  activateNotaryPaymentNotice,
  NOTARY_NOTICE_PAYER,
} from "../server/services/notaryPaymentNotice";

const text = `公证费付款通知
国网北京市电力公司：
我处已受理你司申请办理的保全证据公证，公证费用合
计：10000元，详见清单：
申请日期 2026年8月20日 数量2 公证费10000.00
请将上述费用打入以下账户：
单位名称：北京市国信公证处；
开户行：招商银行北京分行清河支行；
账号：110904592810801。
北京市国信公证处
2026年9月4日`;

describe("公证费付款通知", () => {
  it("金额取合计不乘份数，日期取通知落款不取申请日期，对方取公证处", () => {
    expect(parseNotaryPaymentNotice(text)).toEqual({
      title: "公证费付款通知",
      amount: "10000.00",
      counterparty: "北京市国信公证处",
      noticeDate: "2026-09-04",
    });
    expect(NOTARY_NOTICE_PAYER).toBe("北京羽隶工程咨询有限公司");
  });

  it.each([
    text.replace("2026年9月4日", ""),
    text.replace("2026年9月4日", "2026年2月30日"),
    text.replace("公证费付款通知", "付款申请单"),
    text.replace("单位名称：北京市国信公证处；", ""),
    text.replace("10000元", "0元"),
    text + "\n公证费用合计：20000元",
    text + "\n2026年9月5日",
  ])("字段缺失或冲突不直接生效", (raw) => {
    expect(() => parseNotaryPaymentNotice(raw)).toThrow();
  });

  it("直接生效保存付款主体来源、盖章原件和审计，不创建审批轮次", async () => {
    const query = jest.fn(async (sql: string) => ({
      rows: sql.includes("SELECT c.created_by")
        ? [{ created_by: "操作人", role: "admin" }]
        : sql.includes("SELECT j.id")
          ? [{ id: "任务" }]
          : [],
    }));
    await activateNotaryPaymentNotice(
      { query } as unknown as PoolClient,
      {
        contractId: "通知",
        jobId: "任务",
        fileId: "原件",
        workerToken: "令牌",
      },
      { values: parseNotaryPaymentNotice(text), rawText: text, lines: [] },
    );
    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(
      calls.find(([sql]) => sql.startsWith("UPDATE contracts"))?.[1],
    ).toContain(NOTARY_NOTICE_PAYER);
    expect(
      calls.find(([sql]) => sql.startsWith("UPDATE contracts"))?.[1],
    ).not.toContain("国网北京市电力公司");
    expect(calls.some(([sql]) => sql.includes("status='effective'"))).toBe(
      true,
    );
    expect(
      calls.some(([sql]) => sql.includes("file_type='sealed_contract'")),
    ).toBe(true);
    expect(
      calls.some(([sql]) => sql.includes("INSERT INTO contract_approval")),
    ).toBe(false);
    const payer = calls.find(
      ([sql, args]) =>
        sql.includes("INSERT INTO contract_ocr_fields") &&
        args[3] === "party_a",
    );
    expect(payer?.[1][7]).toBe("business_rule");
  });

  it("普通合同、已生效合同或失效任务不能利用通知单规则绕过审批", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    await expect(
      activateNotaryPaymentNotice(
        { query } as unknown as PoolClient,
        {
          contractId: "普通合同",
          jobId: "任务",
          fileId: "原件",
          workerToken: "旧令牌",
        },
        { values: parseNotaryPaymentNotice(text), rawText: text, lines: [] },
      ),
    ).rejects.toThrow("状态或分类已变化");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
