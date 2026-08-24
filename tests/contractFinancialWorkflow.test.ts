import type { ContractFinancialOcrResult } from "../server/services/contractFinancialOcr";
import {
  buildSafeContractFinancialSnapshot,
  decideContractFinancialOcr,
  decideStoredContractFinancialOcrReuse,
  findContractFinancialClientMismatches,
  incomeReceiptPartiesMatch,
  contractFinancialOcrEngineVersion,
  contractFinancialOcrParserVersion,
  allocateAdditionalContractFinancialAmounts,
  allocateContractFinancialAmounts,
  allocatePartialContractFinancialAmounts,
  CONTRACT_COMPANY_SUBJECTS,
  resolveContractFinancialCompanySubject,
} from "../server/services/contractFinancialWorkflow";

function verifiedInvoice(
  direction: "input" | "output" = "output",
): ContractFinancialOcrResult {
  return {
    kind: "invoice",
    format: "pdf",
    documentStatus: "normal",
    validationStatus: "verified",
    canAutoPost: true,
    direction,
    fields: {
      buyer: "国网北京市电力公司",
      seller: "北京羽隶工程咨询有限公司",
      itemName: "技术咨询费",
      invoiceNumber: "25112000000000000001",
      invoiceDate: "2025-12-16",
      amount: 141550,
      taxAmount: 8012.26,
    },
    blockingReasons: [],
    warnings: [],
    recognition: {
      method: "pdf_structured_and_paddle",
      averageConfidence: 99,
      lineCount: 20,
      textSha256: "a".repeat(64),
    },
  };
}

describe("合同财务凭证业务方向与客户端一致性门禁", () => {
  it("营收回款只要求发票销售方与回单收款人一致", () => {
    expect(
      incomeReceiptPartiesMatch(
        { seller: "北京羽隶工程咨询有限公司" },
        { payee: " 北京羽隶工程咨询有限公司 " },
      ),
    ).toBe(true);
    expect(
      incomeReceiptPartiesMatch(
        { seller: "北京羽隶工程咨询有限公司" },
        { payee: "北京羽隶科技有限公司" },
      ),
    ).toBe(false);
    expect(incomeReceiptPartiesMatch({ seller: "" }, { payee: "" })).toBe(
      false,
    );
  });

  it("公司主体名称与税号按同一结构绑定", () => {
    expect(CONTRACT_COMPANY_SUBJECTS).toEqual(
      expect.arrayContaining([
        {
          name: "北京羽隶工程咨询有限公司",
          taxId: "91110116MA01G3U20C",
        },
        {
          name: "北京羽隶科技有限公司",
          taxId: "91110116MA01BN342Y",
        },
      ]),
    );
  });

  it("合同双方必须唯一命中已配置公司主体", () => {
    expect(
      resolveContractFinancialCompanySubject([
        "国航物业酒店管理有限公司",
        "北京羽隶科技有限公司",
      ]),
    ).toEqual({
      name: "北京羽隶科技有限公司",
      taxId: "91110116MA01BN342Y",
    });
    expect(
      resolveContractFinancialCompanySubject([
        "北京羽隶工程咨询有限公司",
        "北京羽隶科技有限公司",
      ]),
    ).toBeNull();
    expect(
      resolveContractFinancialCompanySubject([
        "北京羽隶科技有限公司",
        "北京羽隶科技有限公司",
      ]),
    ).toBeNull();
    expect(
      resolveContractFinancialCompanySubject([
        "国航物业酒店管理有限公司",
        "北京外部公司",
      ]),
    ).toBeNull();
  });
  it("按上传顺序生成一对多、多对一和多对多金额对应关系", () => {
    expect(allocateContractFinancialAmounts([100000], [50000, 50000])).toEqual([
      { invoiceIndex: 0, settlementIndex: 0, allocatedAmount: 50000 },
      { invoiceIndex: 0, settlementIndex: 1, allocatedAmount: 50000 },
    ]);
    expect(allocateContractFinancialAmounts([50000, 50000], [100000])).toEqual([
      { invoiceIndex: 0, settlementIndex: 0, allocatedAmount: 50000 },
      { invoiceIndex: 1, settlementIndex: 0, allocatedAmount: 50000 },
    ]);
    expect(
      allocateContractFinancialAmounts([30000, 70000], [50000, 50000]),
    ).toEqual([
      { invoiceIndex: 0, settlementIndex: 0, allocatedAmount: 30000 },
      { invoiceIndex: 1, settlementIndex: 0, allocatedAmount: 20000 },
      { invoiceIndex: 1, settlementIndex: 1, allocatedAmount: 50000 },
    ]);
    expect(
      allocateContractFinancialAmounts([40000, 60000], [60000, 40000]),
    ).toEqual([
      { invoiceIndex: 0, settlementIndex: 1, allocatedAmount: 40000 },
      { invoiceIndex: 1, settlementIndex: 0, allocatedAmount: 60000 },
    ]);
  });

  it("金额无效或两侧合计不一致时拒绝生成对应关系", () => {
    expect(() => allocateContractFinancialAmounts([50000], [40000])).toThrow(
      "合计金额必须一致",
    );
    expect(() => allocateContractFinancialAmounts([0], [0])).toThrow("大于零");
  });

  it("部分结算完整分配到发票余额且保留未结算金额", () => {
    expect(allocatePartialContractFinancialAmounts([100], [40])).toEqual([
      { invoiceIndex: 0, settlementIndex: 0, allocatedAmount: 40 },
    ]);
    expect(allocatePartialContractFinancialAmounts([600], [220])).toEqual([
      { invoiceIndex: 0, settlementIndex: 0, allocatedAmount: 220 },
    ]);
  });

  it("部分结算按分精确分配多张回单", () => {
    const allocations = allocatePartialContractFinancialAmounts(
      [100.01],
      [40, 20.01],
    );
    expect(allocations).toEqual([
      { invoiceIndex: 0, settlementIndex: 0, allocatedAmount: 40 },
      { invoiceIndex: 0, settlementIndex: 1, allocatedAmount: 20.01 },
    ]);
    expect(
      Math.round(
        allocations.reduce((sum, item) => sum + item.allocatedAmount, 0) * 100,
      ),
    ).toBe(6001);
  });

  it("部分结算拒绝超额和无效金额", () => {
    expect(() =>
      allocatePartialContractFinancialAmounts([100], [100.01]),
    ).toThrow("不能超过发票可分配余额");
    expect(() => allocatePartialContractFinancialAmounts([100], [0])).toThrow(
      "大于零",
    );
    expect(() => allocatePartialContractFinancialAmounts([], [40])).toThrow(
      "大于零",
    );
  });

  it("分批补回单只占用发票剩余额度并保持原发票索引", () => {
    expect(
      allocateAdditionalContractFinancialAmounts([600], [220], [100]),
    ).toEqual([{ invoiceIndex: 0, settlementIndex: 0, allocatedAmount: 100 }]);
    expect(
      allocateAdditionalContractFinancialAmounts([600], [320], [280]),
    ).toEqual([{ invoiceIndex: 0, settlementIndex: 0, allocatedAmount: 280 }]);
    expect(
      allocateAdditionalContractFinancialAmounts([100, 500], [100, 120], [200]),
    ).toEqual([{ invoiceIndex: 1, settlementIndex: 0, allocatedAmount: 200 }]);
  });

  it("分批补回单累计超额或既有分配异常时拒绝", () => {
    expect(() =>
      allocateAdditionalContractFinancialAmounts([600], [590], [20]),
    ).toThrow("不能超过发票可分配余额");
    expect(() =>
      allocateAdditionalContractFinancialAmounts([600], [601], [1]),
    ).toThrow("既有分配金额无效");
    expect(() =>
      allocateAdditionalContractFinancialAmounts([600], [600], [1]),
    ).toThrow("已无可分配余额");
  });
  it("只有基础设施失败或租约过期的处理中任务可自动重试", () => {
    const now = Date.parse("2026-08-06T01:00:00.000Z");
    expect(
      decideStoredContractFinancialOcrReuse({
        status: "failed",
        failureKind: "infrastructure",
        leaseExpiresAt: null,
        now,
      }),
    ).toBe("retry_infrastructure");
    expect(
      decideStoredContractFinancialOcrReuse({
        status: "processing",
        failureKind: null,
        leaseExpiresAt: "2026-08-06T00:59:59.000Z",
        now,
      }),
    ).toBe("retry_expired_processing");
    expect(
      decideStoredContractFinancialOcrReuse({
        status: "processing",
        failureKind: null,
        leaseExpiresAt: null,
        now,
      }),
    ).toBe("retry_expired_processing");
    expect(
      decideStoredContractFinancialOcrReuse({
        status: "processing",
        failureKind: null,
        leaseExpiresAt: "2026-08-06T01:00:01.000Z",
        now,
      }),
    ).toBe("in_progress");
  });

  it("业务阻断、文件失败和普通识别失败不得自动重试", () => {
    for (const input of [
      { status: "blocked" as const, failureKind: null },
      { status: "failed" as const, failureKind: "document" as const },
      { status: "failed" as const, failureKind: "recognition" as const },
      { status: "verified" as const, failureKind: null },
    ]) {
      expect(
        decideStoredContractFinancialOcrReuse({
          ...input,
          leaseExpiresAt: null,
          now: Date.parse("2026-08-06T01:00:00.000Z"),
        }),
      ).toBe("reuse_terminal");
    }
  });

  it("旧版双通道银行回单未消费结果按新策略重算，已消费结果保持不变", () => {
    for (const status of ["blocked", "verified"] as const) {
      expect(
        decideStoredContractFinancialOcrReuse({
          status,
          failureKind: null,
          leaseExpiresAt: null,
          currentEngineVersion: "structured-fast-or-dual-channel-runtime",
          currentParserVersion: "contract-financial-parser-v2",
          expectedEngineVersion: contractFinancialOcrEngineVersion("receipt"),
          expectedParserVersion: contractFinancialOcrParserVersion("receipt"),
          allowStrategyUpgrade: true,
        }),
      ).toBe("retry_strategy_upgrade");
    }
    expect(
      decideStoredContractFinancialOcrReuse({
        status: "consumed",
        failureKind: null,
        leaseExpiresAt: null,
        currentEngineVersion: "structured-fast-or-dual-channel-runtime",
        currentParserVersion: "contract-financial-parser-v2",
        expectedEngineVersion: contractFinancialOcrEngineVersion("receipt"),
        expectedParserVersion: contractFinancialOcrParserVersion("receipt"),
        allowStrategyUpgrade: true,
      }),
    ).toBe("reuse_terminal");
    expect(contractFinancialOcrEngineVersion("receipt")).toBe("v6_medium");
    expect(contractFinancialOcrEngineVersion("payment")).toBe("v6_medium");
    expect(contractFinancialOcrParserVersion("receipt")).toBe(
      "contract-bank-receipt-parser-v10",
    );
  });

  it("销项发票通过识别并确定为收入方向", () => {
    const decision = decideContractFinancialOcr(
      verifiedInvoice("output"),
      "invoice",
    );

    expect(decision).toMatchObject({
      status: "verified",
      expectedDirection: "output",
      canCreateDraft: true,
      blockingReasons: [],
    });
  });

  it("发票安全快照严格只保留整票及逐条明细业务字段", () => {
    const snapshot = buildSafeContractFinancialSnapshot(verifiedInvoice());
    expect(Object.keys(snapshot.fields).sort()).toEqual(
      [
        "amount",
        "buyer",
        "invoiceDate",
        "invoiceNumber",
        "itemName",
        "lineItems",
        "seller",
        "taxAmount",
      ].sort(),
    );
    expect(snapshot.fields).not.toHaveProperty("invoiceCode");
    expect(snapshot.fields).not.toHaveProperty("buyerTaxId");
    expect(snapshot.fields).not.toHaveProperty("sellerTaxId");
    expect(snapshot.fields).not.toHaveProperty("amountSign");
    expect(contractFinancialOcrParserVersion("invoice")).toBe(
      "contract-invoice-parser-v10",
    );
  });

  it("未消费的旧发票解析任务允许在显式重新上传时升级重算", () => {
    expect(
      decideStoredContractFinancialOcrReuse({
        status: "blocked",
        failureKind: null,
        leaseExpiresAt: null,
        currentEngineVersion: contractFinancialOcrEngineVersion("invoice"),
        currentParserVersion: "contract-invoice-parser-v9",
        expectedEngineVersion: contractFinancialOcrEngineVersion("invoice"),
        expectedParserVersion: contractFinancialOcrParserVersion("invoice"),
        allowStrategyUpgrade: true,
      }),
    ).toBe("retry_strategy_upgrade");
    expect(
      decideStoredContractFinancialOcrReuse({
        status: "consumed",
        failureKind: null,
        leaseExpiresAt: null,
        currentEngineVersion: contractFinancialOcrEngineVersion("invoice"),
        currentParserVersion: "contract-financial-parser-v2",
        expectedEngineVersion: contractFinancialOcrEngineVersion("invoice"),
        expectedParserVersion: contractFinancialOcrParserVersion("invoice"),
        allowStrategyUpgrade: true,
      }),
    ).toBe("reuse_terminal");
  });

  it("进项发票同样可以通过并确定为成本方向", () => {
    const decision = decideContractFinancialOcr(
      verifiedInvoice("input"),
      "invoice",
    );

    expect(decision).toMatchObject({
      status: "verified",
      expectedDirection: "input",
      canCreateDraft: true,
      blockingReasons: [],
    });
  });

  it("旧客户端字段仅作一致性断言，任何金额或原文主体改写都被识别", () => {
    const snapshot = buildSafeContractFinancialSnapshot(verifiedInvoice());

    expect(
      findContractFinancialClientMismatches(
        "invoice",
        {
          amount: "141,550.00",
          invoiceDate: "2025-12-15",
          invoiceNo: "25112000000000000002",
          seller: "文件名里的错误公司",
        },
        snapshot,
      ),
    ).toEqual(
      expect.arrayContaining(["金额", "开票日期", "发票号码", "销方名称"]),
    );
  });

  it("未传旧字段时不会要求客户端重复提供识别值", () => {
    const snapshot = buildSafeContractFinancialSnapshot(verifiedInvoice());
    expect(
      findContractFinancialClientMismatches(
        "invoice",
        { ocrJobId: "job-1", note: "仅备注" },
        snapshot,
      ),
    ).toEqual([]);
  });
});
