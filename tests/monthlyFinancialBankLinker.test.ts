/** @jest-environment node */

import fs from "fs";
import path from "path";
import type { PoolClient } from "pg";

jest.mock("nanoid", () => ({ nanoid: () => "monthly-bank-link-test-id" }));

import {
  linkMonthlyFinancialBankTransaction,
  reconcileMonthlyContractBankTransactions,
} from "../server/services/monthlyFinancialBankLinker";

interface LinkWrite {
  businessObjectType: string;
  businessObjectId: string;
  linkKind: string;
  matchStatus: string;
  allocatedAmount: string | null;
  warnings: string[];
  matchKey: Record<string, unknown>;
}

interface LinkerFixture {
  transaction?: Record<string, unknown>;
  contractReceipt?: Record<string, unknown> | null;
  contractPayment?: Record<string, unknown> | null;
  contractExternalPayment?: Record<string, unknown> | null;
  reimbursements?: Array<Record<string, unknown>>;
  humanCostItems?: Array<Record<string, unknown>>;
  monthTransactions?: Array<Record<string, unknown>>;
  bankFile?: Record<string, unknown>;
  bankFileSummary?: Record<string, unknown>;
}

function contractFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "contract-receipt-1",
    file_id: "contract-file-1",
    electronic_receipt_no: "AB-001",
    transaction_date: "2026-06-18",
    amount: "100.00",
    payer_account: "0200303519000018418",
    payee_account: "6222000000000000001",
    status: "confirmed",
    contract_category: "main_business",
    ...overrides,
  };
}

function createClient(fixture: LinkerFixture = {}) {
  const linkWrites: LinkWrite[] = [];
  const sqlHistory: string[] = [];
  const transaction = {
    id: "bank-transaction-1",
    account_code: "general",
    electronic_receipt_no: "AB-001",
    normalized_electronic_receipt_no: "AB001",
    transaction_date: "2026-06-18",
    amount: "100.00",
    direction: "inflow",
    payer_account: "0200303519000018418",
    payee_account: "6222000000000000001",
    ...fixture.transaction,
  };

  const query = jest.fn(async (sqlValue: string, params: unknown[] = []) => {
    const sql = String(sqlValue);
    sqlHistory.push(sql);
    if (
      sql.includes("FROM monthly_financial_bank_transactions transaction") &&
      sql.includes("transaction.report_month = $1")
    ) {
      return {
        rows: fixture.monthTransactions || [],
        rowCount: fixture.monthTransactions?.length || 0,
      };
    }
    if (
      sql.includes("FROM monthly_financial_bank_transactions") &&
      sql.includes("WHERE id = $1")
    ) {
      return { rows: [transaction], rowCount: 1 };
    }
    if (sql.includes("FROM contract_receipts record")) {
      return {
        rows: fixture.contractReceipt ? [fixture.contractReceipt] : [],
        rowCount: fixture.contractReceipt ? 1 : 0,
      };
    }
    if (sql.includes("FROM contract_payments record")) {
      return {
        rows: fixture.contractPayment ? [fixture.contractPayment] : [],
        rowCount: fixture.contractPayment ? 1 : 0,
      };
    }
    if (sql.includes("FROM contract_external_payments record")) {
      return {
        rows: fixture.contractExternalPayment
          ? [fixture.contractExternalPayment]
          : [],
        rowCount: fixture.contractExternalPayment ? 1 : 0,
      };
    }
    if (sql.includes("FROM payment_proof_hashes proof")) {
      return {
        rows: fixture.reimbursements || [],
        rowCount: fixture.reimbursements?.length || 0,
      };
    }
    if (sql.includes("FROM human_cost_receipt_items item")) {
      return {
        rows: fixture.humanCostItems || [],
        rowCount: fixture.humanCostItems?.length || 0,
      };
    }
    if (sql.includes("FROM monthly_financial_bank_transaction_links")) {
      return { rows: [], rowCount: 0 };
    }
    if (
      sql.includes("FROM monthly_financial_bank_files") &&
      sql.includes("recognition_status, warnings_json")
    ) {
      return {
        rows: fixture.bankFile ? [fixture.bankFile] : [],
        rowCount: fixture.bankFile ? 1 : 0,
      };
    }
    if (
      sql.includes("COUNT(*) FILTER") &&
      sql.includes("WHERE current_file_id = $1")
    ) {
      return {
        rows: [
          fixture.bankFileSummary || {
            review_count: 0,
            included_count: 0,
          },
        ],
        rowCount: 1,
      };
    }
    if (
      sql.includes("UPDATE monthly_financial_bank_transactions") ||
      sql.includes("UPDATE monthly_financial_bank_files")
    ) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO monthly_financial_bank_transaction_links")) {
      linkWrites.push({
        businessObjectType: String(params[2]),
        businessObjectId: String(params[3]),
        linkKind: String(params[4]),
        matchStatus: String(params[5]),
        allocatedAmount:
          params[7] === null || params[7] === undefined
            ? null
            : String(params[7]),
        warnings: JSON.parse(String(params[8] || "[]")) as string[],
        matchKey: JSON.parse(String(params[6] || "{}")) as Record<
          string,
          unknown
        >,
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`测试未处理的数据库语句：${sql.slice(0, 120)}`);
  });

  return {
    client: { query } as unknown as PoolClient,
    linkWrites,
    sqlHistory,
  };
}

describe("月报银行回单严格替换链接", () => {
  it("合同电子回单号、双方完整账号、日期、金额、确认状态和分类全部一致才创建两类有效链接", async () => {
    const { client, linkWrites, sqlHistory } = createClient({
      contractReceipt: contractFixture(),
    });

    const result = await linkMonthlyFinancialBankTransaction(
      client,
      "bank-transaction-1",
      "admin-1",
      "2026-08-24T00:00:00.000Z",
    );

    expect(result.conflicts).toEqual([]);
    expect(result.matched).toEqual([
      expect.objectContaining({
        businessObjectType: "contract_receipt",
        businessObjectId: "contract-receipt-1",
        linkKinds: ["display_replacement", "classification_basis"],
      }),
    ]);
    expect(result.categoryOverride).toBe("main_income");
    expect(linkWrites).toEqual([
      expect.objectContaining({
        linkKind: "display_replacement",
        matchStatus: "active",
      }),
      expect.objectContaining({
        linkKind: "classification_basis",
        matchStatus: "active",
      }),
    ]);
    expect(linkWrites[0]?.matchKey).toEqual(
      expect.objectContaining({
        displayAction: "replaced",
        previousFileId: "contract-file-1",
      }),
    );
    expect(
      sqlHistory
        .filter((sql) => /FROM contract_.* record/u.test(sql))
        .every((sql) => sql.includes("FOR SHARE OF record")),
    ).toBe(true);
  });

  it("月报自动补入的合同回款标记为首次挂载而不是替换旧回单", async () => {
    const { client, linkWrites } = createClient({
      contractReceipt: contractFixture({
        financial_recognition_method: "monthly_bank_transaction",
      }),
    });

    await linkMonthlyFinancialBankTransaction(
      client,
      "bank-transaction-1",
      "admin-1",
      "2026-08-25T00:00:00.000Z",
    );

    expect(linkWrites[0]?.matchKey).toEqual(
      expect.objectContaining({
        displayAction: "attached",
        previousFileId: null,
      }),
    );
  });

  it.each([
    ["电子回单号", { electronic_receipt_no: "AB-002" }, "电子回单号不一致"],
    [
      "付款账号",
      { payer_account: "0200303519000018419" },
      "付款账号完整账号不一致",
    ],
    [
      "收款账号",
      { payee_account: "6222000000000000002" },
      "收款账号完整账号不一致",
    ],
    ["交易日期", { transaction_date: "2026-06-19" }, "交易日期不一致"],
    ["金额", { amount: "100.01" }, "交易金额不一致"],
    ["确认状态", { status: "pending" }, "合同财务凭证尚未确认"],
    [
      "合同分类",
      { contract_category: "asset" },
      "合同分类与月报自动分类规则不一致",
    ],
  ])("合同%s不一致时只生成冲突链接", async (_label, overrides, reason) => {
    const { client, linkWrites } = createClient({
      contractReceipt: contractFixture(overrides),
    });

    const result = await linkMonthlyFinancialBankTransaction(
      client,
      "bank-transaction-1",
      "admin-1",
      "2026-08-24T00:00:00.000Z",
    );

    expect(result.matched).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.categoryOverride).toBeUndefined();
    expect(result.conflicts[0]?.reasons).toContain(reason);
    expect(linkWrites).toHaveLength(2);
    expect(linkWrites.every((link) => link.matchStatus === "conflict")).toBe(
      true,
    );
  });

  it("资产付款只有完整匹配已确认资产合同时才返回资产支出分类", async () => {
    const { client, linkWrites } = createClient({
      transaction: { direction: "outflow" },
      contractPayment: contractFixture({
        id: "contract-payment-1",
        contract_category: "asset",
      }),
    });

    const result = await linkMonthlyFinancialBankTransaction(
      client,
      "bank-transaction-1",
      "admin-1",
      "2026-08-24T00:00:00.000Z",
    );

    expect(result.conflicts).toEqual([]);
    expect(result.matched).toEqual([
      expect.objectContaining({
        businessObjectType: "contract_payment",
        businessObjectId: "contract-payment-1",
      }),
    ]);
    expect(result.categoryOverride).toBe("asset_expense");
    expect(linkWrites).toHaveLength(2);
    expect(linkWrites.every((link) => link.matchStatus === "active")).toBe(
      true,
    );
  });

  it.each([
    [
      "账户",
      { account_code: "basic" },
      "主营回款和资产支出仅允许挂载一般账户回单",
    ],
    ["方向", { direction: "outflow" }, "主营回款必须是一般账户入账"],
  ])(
    "主营回款%s不符合月报归属时只生成冲突链接",
    async (_label, transaction, reason) => {
      const { client, linkWrites } = createClient({
        transaction,
        contractReceipt: contractFixture(),
      });

      const result = await linkMonthlyFinancialBankTransaction(
        client,
        "bank-transaction-1",
        "admin-1",
        "2026-08-24T00:00:00.000Z",
      );

      expect(result.matched).toEqual([]);
      expect(result.conflicts[0]?.reasons).toContain(reason);
      expect(linkWrites.every((link) => link.matchStatus === "conflict")).toBe(
        true,
      );
    },
  );

  it("报销与薪资因缺付款账号或精确日期只形成冲突，且不修改原业务表", async () => {
    const { client, linkWrites, sqlHistory } = createClient({
      reimbursements: [
        {
          reimbursement_id: "reimbursement-1",
          batch_id: "payment-batch-1",
          proof_no: "AB-001",
          batch_date: "2026-06-18",
          reimbursement_date: "2026-06-18",
          batch_amount: "100.00",
          allocated_total: "100.00",
          allocated_amount: "100.00",
          proof_count: 1,
          batch_status: "confirmed",
          reimbursement_status: "paid",
          reimbursement_type: "basic",
        },
      ],
      humanCostItems: [
        {
          id: "human-cost-item-1",
          proof_no: "AB-001",
          amount: "100.00",
          payee_account: "6222000000000000001",
          payroll_month: "2026-06",
          category: "net_salary",
          match_status: "matched",
        },
      ],
    });

    const result = await linkMonthlyFinancialBankTransaction(
      client,
      "bank-transaction-1",
      "admin-1",
      "2026-08-24T00:00:00.000Z",
    );

    expect(result.matched).toEqual([]);
    expect(result.conflicts).toHaveLength(2);
    expect(
      result.conflicts.find(
        (conflict) => conflict.businessObjectType === "reimbursement",
      )?.reasons,
    ).toEqual(
      expect.arrayContaining([
        "原报销回单未保存付款方完整账号",
        "原报销回单未保存收款方完整账号",
      ]),
    );
    expect(
      result.conflicts.find(
        (conflict) => conflict.businessObjectType === "human_cost_receipt_item",
      )?.reasons,
    ).toEqual(
      expect.arrayContaining([
        "原薪资回单未保存付款方完整账号",
        "原薪资回单未保存精确交易日期",
      ]),
    );
    expect(linkWrites).toHaveLength(2);
    expect(linkWrites.every((link) => link.matchStatus === "conflict")).toBe(
      true,
    );

    const originalBusinessMutations = sqlHistory.filter((sql) =>
      /^\s*(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?:contracts?|contract_receipts|contract_payments|contract_external_payments|reimbursements|payment_batches|payment_batch_items|human_cost_receipts|human_cost_receipt_items)\b/iu.test(
        sql,
      ),
    );
    expect(originalBusinessMutations).toEqual([]);
  });
});

describe("月报银行回单替换链接调用与合同预览契约", () => {
  const monthlyBankLinkerSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "server/services/monthlyFinancialBankLinker.ts",
    ),
    "utf8",
  );
  const monthlyRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/monthly-financial-reports.ts"),
    "utf8",
  );
  const contractRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const contractDetailSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/views/ContractDetail.vue"),
    "utf8",
  );
  const contractApiSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/utils/contractApi.ts"),
    "utf8",
  );
  const monthlyBankPanelSource = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "src/components/monthly-financial/MonthlyBankReceiptPanel.vue",
    ),
    "utf8",
  );

  it("一般账户未分类完整回单也进入合同严格匹配，商务账户及排除分类不进入", () => {
    const callIndex = monthlyRouteSource.indexOf(
      "const linkResult = await linkMonthlyFinancialBankTransaction",
    );
    const guardIndex = monthlyRouteSource.lastIndexOf(
      "const shouldTryContractMatch",
      callIndex,
    );
    const guard = monthlyRouteSource.slice(guardIndex, callIndex);

    expect(callIndex).toBeGreaterThan(-1);
    expect(guard).toContain('accountCode === "general"');
    expect(guard).toContain('"main_income"');
    expect(guard).toContain('"asset_expense"');
    expect(guard).toContain('"unclassified"');
    expect(guard).toContain('accountCode !== "business"');
    expect(guard).toContain('"salary"');
    expect(guard).not.toContain('"ignored"');
    expect(guard).not.toContain('"internal_transfer"');
  });

  it("同月回单合计尚未闭合时仍逐笔挂载，不等待整组金额凑齐", () => {
    expect(monthlyBankLinkerSource).toContain(
      '(!groupResult || groupResult.status === "pending")',
    );
    expect(monthlyBankLinkerSource).toContain(
      "bridgeMonthlyBankTransactionToContractRegistration",
    );
  });

  it("上传预检仅放行字段完整的一般账户未分类回单，并在业务命中后清理旧告警", () => {
    expect(monthlyRouteSource).toContain(
      'analysis.accountCode === "general" &&\n              transaction.category === "unclassified"',
    );
    expect(monthlyRouteSource).toContain(
      "Boolean(transaction.normalizedElectronicReceiptNo)",
    );
    expect(monthlyRouteSource).toContain(
      "warnings_json = COALESCE(warnings_json, '[]'::jsonb) -",
    );
    expect(monthlyRouteSource).toContain(
      "该回单无法安全归入主营收入或资产支出，需管理员核对",
    );
    expect(
      monthlyRouteSource.match(
        /'main_income', 'asset_expense', 'unclassified'/gu,
      ),
    ).toHaveLength(3);
  });

  it("合同与资产回单只作为已挂载证据，不把银行金额写成月报统计来源", () => {
    const matchedUpdateStart = monthlyRouteSource.indexOf(
      "SET category = $2, recognition_status = 'recognized'",
    );
    const matchedUpdateEnd = monthlyRouteSource.indexOf(
      "[persistedTransactionId, linkResult.categoryOverride, now]",
      matchedUpdateStart,
    );
    const matchedUpdate = monthlyRouteSource.slice(
      matchedUpdateStart,
      matchedUpdateEnd,
    );

    expect(matchedUpdate).toContain("include_in_report = FALSE");
    expect(matchedUpdate).not.toContain("include_in_report = TRUE");
    expect(monthlyBankPanelSource).toContain('row.linkStatus === "matched"');
    expect(monthlyBankPanelSource).toContain("已挂载，金额取系统记录");
  });

  it("合同接口只选 active display_replacement 的当前银行事实", () => {
    expect(contractRouteSource).toContain(
      "link.link_kind = 'display_replacement'",
    );
    expect(contractRouteSource).toContain("link.match_status = 'active'");
    expect(contractRouteSource).toContain("link.is_active = TRUE");
    expect(contractRouteSource).toContain("bank_transaction.is_current = TRUE");
    expect(contractRouteSource).toContain("AS canonical_bank_transaction_id");
    expect(contractRouteSource).toContain("canonicalReceiptPreviewUrl");
    expect(contractRouteSource).toContain(
      '["admin", "general_manager"].includes(',
    );
    expect(monthlyRouteSource).toContain(
      '"/bank-transactions/:transactionId/preview"',
    );
    expect(monthlyRouteSource).toContain(
      "const canReadMonthlyReport = READ_ROLES.includes(actor.role)",
    );
  });

  it("合同详情在线预览优先使用 canonicalReceiptPreviewUrl", () => {
    expect(contractApiSource).toContain(
      "canonicalReceiptPreviewUrl: (record.canonicalReceiptPreviewUrl ??",
    );
    expect(contractApiSource).toContain(
      "record.canonical_receipt_preview_url ??",
    );
    expect(contractDetailSource).toContain(
      "document.record.canonicalReceiptPreviewUrl ||",
    );

    const functionStart = contractDetailSource.indexOf(
      "function openFinancialRecordFile",
    );
    const functionEnd = contractDetailSource.indexOf(
      "function closeReadonlyPreview",
      functionStart,
    );
    const functionBody = contractDetailSource.slice(functionStart, functionEnd);
    expect(
      functionBody.indexOf("record.canonicalReceiptPreviewUrl"),
    ).toBeLessThan(functionBody.indexOf("record.fileId"));
    expect(functionBody).toContain("已打开月底银行原件中的对应回单");
    expect(functionBody).toContain("return;");
  });

  it("后补合同财务记录后整月同步可完成挂载并恢复文件状态", async () => {
    const { client, sqlHistory } = createClient({
      contractReceipt: contractFixture(),
      monthTransactions: [
        {
          id: "bank-transaction-1",
          category: "unclassified",
          recognition_status: "review_required",
          include_in_report: false,
          warnings_json: ["该回单无法安全归入主营收入或资产支出，需管理员核对"],
          current_file_id: "bank-file-1",
        },
      ],
      bankFile: {
        recognition_status: "partial",
        warnings_json: [
          "存在未关联的合同收付款回单，已确认的利息和跨行手续费仍计入月报",
        ],
        included_receipt_count: 0,
      },
      bankFileSummary: { review_count: 0, included_count: 2 },
    });

    const result = await reconcileMonthlyContractBankTransactions(
      client,
      "2026-06",
      "admin-1",
      "2026-08-25T00:00:00.000Z",
    );

    expect(result).toEqual([
      expect.objectContaining({
        transactionId: "bank-transaction-1",
        status: "matched",
        category: "main_income",
        changed: true,
      }),
    ]);
    expect(
      sqlHistory.some(
        (sql) =>
          sql.includes("UPDATE monthly_financial_bank_transactions") &&
          sql.includes("include_in_report = FALSE"),
      ),
    ).toBe(true);
    expect(
      sqlHistory.some(
        (sql) =>
          sql.includes("UPDATE monthly_financial_bank_files") &&
          sql.includes("included_receipt_count"),
      ),
    ).toBe(true);
  });
});
