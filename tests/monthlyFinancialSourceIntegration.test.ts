/** @jest-environment node */
import {
  buildMonthlyFinancialAnalysis,
  type MonthlyFinancialAnalysisInput,
  type AnalysisContract,
  type AnalysisReceipt,
  type AnalysisReimbursement,
} from "../server/services/monthlyFinancialAnalysis";
import {
  LEGACY_REVIEWED_CNY_RECEIPT_FILE_HASHES,
  loadFinancialAnalysisSources,
} from "../server/services/monthlyFinancialAnalysisSources";
const contract: AnalysisContract = {
  id: "p",
  rootId: "p",
  relationType: "main",
  title: "历史项目",
  partyA: "甲方",
  region: "朝阳",
  status: "completed",
  effectiveAt: "2021-01-01",
  contractDate: "2021-01-01",
  contractDateSource: "manual",
  originalAmount: "1000000",
  amountDelta: "1000000",
  amountBefore: null,
  amountAfter: null,
  supplementSequence: null,
  changeType: null,
  updatedAt: null,
};
const receipt: AnalysisReceipt = {
  id: "r",
  rootId: "p",
  date: "2025-06-16",
  amount: "218500.00",
  currency: null,
  status: "confirmed",
  reversedAt: null,
  updatedAt: null,
};
function source(
  extra: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2025-05", to: "2025-07", granularity: "month" },
    generatedAt: "2026-09-07T02:00:00Z",
    reports: [],
    contracts: [contract],
    receipts: [],
    ...extra,
  };
}
const moduleOf = (input: MonthlyFinancialAnalysisInput, key: string) =>
  buildMonthlyFinancialAnalysis(input).modules.find((row) => row.key === key)!;
const values = (
  input: MonthlyFinancialAnalysisInput,
  key: string,
  metric: string,
) => moduleOf(input, key).series.find((row) => row.key === metric)!.values;
function business(
  id: string,
  scope: string,
  amount: string,
): AnalysisReimbursement {
  return {
    id,
    userId: "u",
    employeeId: "e",
    personName: "人员",
    type: "business",
    date: "2025-06-20",
    amount,
    title: "商务",
    category: "reception",
    scope,
    scopePath: scope,
    region: scope.split(" / ")[0],
    serviceTarget: null,
    updatedAt: null,
  };
}
describe("财务五项生产取数衔接", () => {
  it("经独立导入快照核对的历史台账金额恢复流量和累计，空月连续零，原币种不写入", () => {
    const row = { ...receipt, historicalConfirmedAmount: true };
    const input = source({ receipts: [row] });
    expect(values(input, "inflow", "receipt")).toEqual(["0", "218500", "0"]);
    expect(values(input, "projects", "periodReceived")).toEqual([
      "0",
      "218500",
      "0",
    ]);
    expect(values(input, "projects", "received")).toEqual([
      "0",
      "218500",
      "218500",
    ]);
    expect(values(input, "projects", "outstanding")).toEqual([
      "1000000",
      "781500",
      "781500",
    ]);
    expect(row.currency).toBeNull();
  });
  it("旧版人民币回单逐项复核后恢复本月回款，普通空币种仍保持未知", () => {
    const verified = { ...receipt, verifiedLegacyCnyAmount: true };
    expect(
      values(source({ receipts: [verified] }), "inflow", "receipt"),
    ).toEqual(["0", "218500", "0"]);
    expect(
      values(source({ receipts: [verified] }), "projects", "periodReceived"),
    ).toEqual(["0", "218500", "0"]);
    expect(
      values(
        source({
          receipts: [{ ...verified, currency: "USD" }],
        }),
        "projects",
        "received",
      )[1],
    ).toBeNull();
    expect(
      values(source({ receipts: [receipt] }), "inflow", "receipt")[1],
    ).toBeNull();
  });
  it("普通缺币种和明确外币不借历史兼容规则计入", () => {
    expect(
      values(source({ receipts: [receipt] }), "inflow", "receipt")[1],
    ).toBeNull();
    expect(
      values(
        source({
          receipts: [
            { ...receipt, currency: "USD", historicalConfirmedAmount: true },
          ],
        }),
        "projects",
        "received",
      )[1],
    ).toBeNull();
  });
  it("真实来源历史标记必须同时验证确认状态、导入类型、原金额日期及编号", async () => {
    const calls: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        calls.push(sql);
        return { rows: [] };
      }),
    };
    await loadFinancialAnalysisSources(source().query, {
      queryClient: client as never,
      loadReport: jest.fn(),
    });
    const sql = calls.find((sql) =>
      sql.includes('AS "historicalConfirmedAmount"'),
    )!;
    for (const text of [
      "historical.status = 'consumed'",
      "historical.validation_status = 'verified'",
      "'confirmed_historical_import'",
      "= receipt.amount",
      "= receipt.id",
      "= receipt.receipt_date",
      "receipt.confirmed_at IS NOT NULL",
    ])
      expect(sql).toContain(text);
    for (const text of [
      "historical.engine_version = 'historical-source-review'",
      "historical.parser_version = 'historical-confirmed-v1'",
      "historical.snapshot_json->>'historicalConfirmed' = 'true'",
      "imported_file.contract_file_id = receipt.file_id",
      "imported_file.source_hash = historical.file_hash",
      "imported_file.accounting_included = TRUE",
      "imported_batch.status = 'completed'",
    ])
      expect(sql).toContain(text);
  });
  it("旧版正常上传回单只在逐项一致且文件摘要已经逐张复核时标记为人民币", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [] };
      }),
    };
    await loadFinancialAnalysisSources(source().query, {
      queryClient: client as never,
      loadReport: jest.fn(),
    });
    const receiptCall = calls.find((value) =>
      value.sql.includes('AS "verifiedLegacyCnyAmount"'),
    )!;
    const sql = receiptCall.sql;
    for (const text of [
      "legacy.status = 'consumed'",
      "legacy.validation_status = 'verified'",
      "legacy.document_status = 'normal'",
      "legacy.document_kind = 'bank_receipt'",
      "legacy.direction = 'receipt'",
      "legacy.record_id = receipt.id",
      "source_file.file_hash = legacy.file_hash",
      "legacy.engine_version = 'v6_medium'",
      "legacy.parser_version = 'contract-bank-receipt-parser-v11'",
      "source_file.file_hash = ANY($2::text[])",
      "'{fields,paymentTime}' = receipt.payment_time",
      "'{fields,amount}')::numeric = receipt.amount",
      "'{fields,electronicReceiptNo}' = receipt.electronic_receipt_no",
      "receipt.rate_snapshot_json IS NOT NULL",
    ])
      expect(sql).toContain(text);
    expect(receiptCall.params?.[1]).toEqual(
      LEGACY_REVIEWED_CNY_RECEIPT_FILE_HASHES,
    );
    expect(LEGACY_REVIEWED_CNY_RECEIPT_FILE_HASHES).toEqual([
      "ae0c6e5862cc3b3b99953c7617bcf5c13bbd9bc143d8e354af3f39041363d9b3",
      "11f5f5edd62391d7b9544e385f0d7d6830fa9e649b821148dc388e95c0b3f32e",
      "fc4683ac497c68e6af972033a3ba22a56556109e4b8a9c0843b1ff1d4d8a0251",
    ]);
  });
  it("带末尾零的报销正确关联完整级联路径，同区域不同下级细分不合并", () => {
    const input = source({
      reimbursements: [
        business("a", "朝阳区 / GJDW", "3258.70"),
        business("b", "朝阳区 / WFAH", "100.00"),
      ],
      reimbursementDatesComplete: { business: true },
    });
    const result = moduleOf(input, "business");
    expect(result.breakdown.map((row) => [row.label, row.amount])).toEqual([
      ["朝阳区 / GJDW", "3258.7"],
      ["朝阳区 / WFAH", "100"],
    ]);
    expect(result.details.every((row) => row.region === "朝阳区")).toBe(true);
    expect(
      moduleOf(
        { ...input, query: { ...input.query, reimbursementScope: "朝阳区" } },
        "business",
      ).summaries[0].amount,
    ).toBe("3358.7");
    expect(
      moduleOf(
        {
          ...input,
          query: { ...input.query, reimbursementScope: "朝阳区 / GJDW" },
        },
        "business",
      ).summaries[0].amount,
    ).toBe("3258.7");
  });
  it("无月报仍展示工资和资产付款已录入支出，但不伪造完整银行支出", () => {
    const input = source({
      payroll: [
        {
          id: "w",
          employeeId: "e",
          userId: "u",
          personName: "人员",
          month: "2025-06",
          salary: "1000",
          housingBase: "0",
          contributionBase: "0",
          tax: "0",
          withheldActual: "0",
          netActual: "1000",
          updatedAt: null,
        },
      ],
      generalPayments: [
        {
          id: "a",
          date: "2025-06-10",
          amount: "780.00",
          title: "租车",
          currency: "CNY",
          updatedAt: null,
        },
      ],
    });
    expect(values(input, "outflow", "knownTotal")).toEqual([
      null,
      "1780",
      null,
    ]);
    expect(values(input, "outflow", "salary")).toEqual([null, "1000", null]);
    expect(values(input, "outflow", "asset")).toEqual(["0", "780", "0"]);
    expect(values(input, "outflow", "total")).toEqual([null, null, null]);
    expect(moduleOf(input, "outflow").details).toHaveLength(2);
    const personnel = moduleOf(input, "personnel");
    expect(personnel.comparison[0].amount).toBe("1000");
    expect(personnel.comparison[0].note).toContain("已知部分");
  });
});
