/** @jest-environment node */

const mockDbGet = jest.fn();
const mockDbTransaction = jest.fn();
const mockRecalculateContractExecutionStatus = jest.fn();
let mockSequence = 0;

jest.mock("nanoid", () => ({
  nanoid: () => `invoice-append-${++mockSequence}`,
}));
jest.mock("../server/db/index", () => ({
  db: { get: mockDbGet, transaction: mockDbTransaction },
}));
jest.mock("../server/services/invoiceApplication", () => ({
  lockInvoiceApplicationRootByFinancialSource: jest.fn(),
  reconcileInvoiceApplicationAllocations: jest.fn(),
}));
jest.mock("../server/services/contractService", () => ({
  ...jest.requireActual("../server/services/contractService"),
  recalculateContractExecutionStatus: mockRecalculateContractExecutionStatus,
}));

import type { Request, Response } from "express";
import router from "../server/routes/contracts";
import * as financialWorkflow from "../server/services/contractFinancialWorkflow";

const MemoryDatabase = require("better-sqlite3");

const contractId = "rental-contract";
const registrationId = "rental-registration";
const companyName = "北京羽隶科技有限公司";
const sellerName = "房屋出租测试公司";

interface InvoiceFixture {
  item_id: string;
  record_id: string;
  amount: number;
  buyer: string;
  seller: string;
  status: string;
}

interface MatchFixture {
  invoice_item_id: string;
  settlement_item_id: string;
  allocated_amount: number;
}

function createInvoiceAppendFixture(
  newInvoiceAmounts: number[],
  options: {
    firstPaymentAmount?: number;
    depositAmount?: number;
    otherSettlementAmount?: number;
  } = {},
) {
  const contract = {
    id: contractId,
    root_contract_id: contractId,
    relation_type: "main",
    category: "asset",
    declared_subtype: "house_rental",
    asset_funding_mode: "engineering_to_technology",
    financial_direction: "cost",
    status: "executing",
    party_a: sellerName,
    party_b: companyName,
    lease_start_date: "2025-06-16",
    lease_end_date: "2027-06-15",
    is_deleted: false,
  };
  const invoices: InvoiceFixture[] = [
    {
      item_id: "old-invoice-item",
      record_id: "old-invoice",
      amount: 381162.52,
      buyer: companyName,
      seller: sellerName,
      status: "confirmed",
    },
  ];
  const payments = [
    {
      id: "old-external-payment",
      record_id: "old-external-payment",
      item_id: "old-payment-item",
      contract_id: contractId,
      amount: options.firstPaymentAmount ?? 460656.52,
      deposit_amount: options.depositAmount ?? 79494,
      payment_date: "2026-06-01",
    },
    {
      id: "new-external-payment",
      record_id: "new-external-payment",
      item_id: "new-payment-item",
      contract_id: contractId,
      amount: 79967.06,
      deposit_amount: 0,
      payment_date: "2026-08-31",
    },
  ];
  const otherSettlementAmount = options.otherSettlementAmount || 0;
  const otherSettlements = [
    { item_id: "other-payment-item", record_id: "other-payment" },
  ];
  let matches: MatchFixture[] = [
    {
      invoice_item_id: "old-invoice-item",
      settlement_item_id: "old-payment-item",
      allocated_amount: 381162.52 - otherSettlementAmount,
    },
    ...(otherSettlementAmount
      ? [
          {
            invoice_item_id: "old-invoice-item",
            settlement_item_id: "other-payment-item",
            allocated_amount: otherSettlementAmount,
          },
        ]
      : []),
  ];
  const jobs = newInvoiceAmounts.map((amount, index) => ({
    id: `new-invoice-job-${index}`,
    file_id: `new-invoice-file-${index}`,
    record_kind: "invoice",
    record_id: null,
    status: "verified",
    validation_status: "verified",
    can_auto_post: true,
    document_status: "normal",
    direction: "input",
    parser_version:
      financialWorkflow.contractFinancialOcrParserVersion("invoice"),
    snapshot_json: {
      fields: {
        invoiceNumber: `20260902000000000${index}`,
        itemName: "房屋租赁费",
        seller: sellerName,
        buyer: companyName,
        invoiceDate: "2026-09-02",
        amount,
        taxAmount: 0,
        lineItems: [
          {
            itemName: "房屋租赁费",
            netAmount: amount,
            taxAmount: 0,
            grossAmount: amount,
            expenseCategory: "rent",
            recognitionStatus: "verified",
          },
        ],
      },
    },
  }));
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      const statement = sql.replace(/\s+/gu, " ").trim();
      if (statement.includes("FROM contract_financial_registrations WHERE")) {
        return {
          rows: [
            {
              id: registrationId,
              contract_id: contractId,
              status: "draft",
              settlement_kind: "payment",
              financial_direction: "cost",
              direction_invoice_record_id: "old-invoice",
            },
          ],
        };
      }
      if (
        statement.startsWith("SELECT * FROM contracts") ||
        statement.startsWith(
          "SELECT id, relation_type, category FROM contracts",
        )
      ) {
        return { rows: [contract] };
      }
      if (statement.includes("FROM contracts termination")) return { rows: [] };
      if (statement.includes("FROM contract_financial_ocr_jobs")) {
        return { rows: jobs };
      }
      if (statement.includes("GROUP BY invoice_item_id")) {
        return {
          rows: invoices.map((invoice) => ({
            invoice_item_id: invoice.item_id,
            allocated_amount: matches
              .filter((match) => match.invoice_item_id === invoice.item_id)
              .reduce((sum, match) => sum + match.allocated_amount, 0),
          })),
        };
      }
      if (
        statement.startsWith(
          "SELECT invoice_item.record_id AS invoice_record_id",
        )
      ) {
        return {
          rows: matches.map((match) => ({
            invoice_record_id: invoices.find(
              (invoice) => invoice.item_id === match.invoice_item_id,
            )!.record_id,
            settlement_record_id: [...payments, ...otherSettlements].find(
              (payment) => payment.item_id === match.settlement_item_id,
            )!.record_id,
            allocated_amount: match.allocated_amount,
          })),
        };
      }
      if (
        statement.includes("FROM contract_financial_registration_items item") &&
        statement.includes("JOIN contract_invoices invoice")
      ) {
        return {
          rows: invoices.map((invoice) => ({
            ...invoice,
            allocated_amount: matches
              .filter((match) => match.invoice_item_id === invoice.item_id)
              .reduce((sum, match) => sum + match.allocated_amount, 0),
          })),
        };
      }
      if (
        statement.includes("JOIN contract_payments record") ||
        statement.includes("FROM contract_payments payment")
      ) {
        return { rows: [] };
      }
      if (statement.includes("FROM contract_external_payments payment")) {
        return { rows: payments.filter((payment) => payment.id === params[0]) };
      }
      if (statement.includes("JOIN contract_external_payments payment")) {
        return { rows: payments };
      }
      if (statement.startsWith("SELECT item.registration_id")) {
        return { rows: [{ registration_id: registrationId }] };
      }
      if (
        statement.startsWith(
          "SELECT record_id FROM contract_financial_registration_items",
        )
      ) {
        return { rows: payments.slice(0, 1) };
      }
      if (
        statement.startsWith("SELECT pg_advisory_xact_lock") ||
        statement.startsWith("SELECT id FROM contract_invoices")
      ) {
        return { rows: [] };
      }
      if (statement.startsWith("INSERT INTO contract_invoices")) {
        invoices.push({
          item_id: "",
          record_id: String(params[0]),
          amount: Number(params[6]),
          seller: String(params[8]),
          buyer: String(params[9]),
          status: "draft",
        });
        return { rows: [], rowCount: 1 };
      }
      if (
        statement.startsWith(
          "INSERT INTO contract_financial_registration_items",
        )
      ) {
        const invoice = invoices.find((item) => item.record_id === params[4]);
        if (!invoice) throw new Error("测试中新增发票登记条目没有对应发票");
        invoice.item_id = String(params[0]);
        return { rows: [], rowCount: 1 };
      }
      if (statement.startsWith("UPDATE contract_invoices")) {
        for (const invoice of invoices) {
          if ((params[0] as string[]).includes(invoice.record_id)) {
            invoice.status = "confirmed";
          }
        }
        return { rows: [], rowCount: 1 };
      }
      if (
        statement.startsWith(
          "DELETE FROM contract_financial_registration_matches",
        )
      ) {
        const kind = /settlement\.item_kind\s*=\s*\$2/u.test(statement)
          ? params[1]
          : statement.includes("settlement.item_kind = 'external_payment'")
            ? "external_payment"
            : null;
        matches = matches.filter((match) => {
          const matchKind = payments.some(
            (payment) => payment.item_id === match.settlement_item_id,
          )
            ? "external_payment"
            : "payment";
          return kind !== null && matchKind !== kind;
        });
        return { rows: [], rowCount: 1 };
      }
      if (
        statement.startsWith(
          "INSERT INTO contract_financial_registration_matches",
        )
      ) {
        matches.push({
          invoice_item_id: String(params[3]),
          settlement_item_id: String(params[4]),
          allocated_amount: Number(params[5]),
        });
        return { rows: [], rowCount: 1 };
      }
      if (
        statement.startsWith("INSERT INTO contract_invoice_line_items") ||
        statement.startsWith("UPDATE contract_financial_ocr_jobs") ||
        statement.startsWith("UPDATE contract_financial_registrations") ||
        statement.startsWith("INSERT INTO contract_audit_logs")
      ) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`测试未模拟的数据库语句：${statement}`);
    }),
  };
  mockDbGet.mockResolvedValue(contract);
  mockDbTransaction.mockImplementation(async (callback) => callback(client));
  mockRecalculateContractExecutionStatus.mockResolvedValue(contract);
  return {
    client,
    invoices,
    payments,
    invoiceJobIds: jobs.map((job) => job.id),
    getMatches: () => matches,
  };
}

async function submitInvoiceAppend(invoiceJobIds: string[]) {
  const layer = router.stack.find(
    (item) =>
      item.route?.path ===
      "/:id/financial-registrations/:registrationId/settlements",
  );
  const handler = layer?.route.stack.at(-1)?.handle;
  if (!handler) throw new Error("补充发票路由不存在");
  const req = {
    params: { id: contractId, registrationId },
    body: { invoiceOcrJobIds: invoiceJobIds, bankOcrJobIds: [] },
    session: { userId: "finance-user", user: { role: "admin" } },
  } as unknown as Request;
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  await handler(req, res as unknown as Response, jest.fn());
  return res;
}

function getDepositAmountQuery(
  fixture: ReturnType<typeof createInvoiceAppendFixture>,
): string {
  const query = fixture.client.query.mock.calls.find(([sql]) =>
    sql.includes("AS deposit_amount"),
  )?.[0];
  if (!query) throw new Error("补票没有执行扣除押金的付款查询");
  return query;
}

function evaluateDepositAmountExpression(
  query: string,
  purposeDetails: Array<{ purpose: string; amount: number }>,
  receipts: Array<{ status: string; amount: number }>,
): number {
  const expression = query.match(
    /(COALESCE\(\(\s*SELECT SUM\(detail.amount\)[\s\S]*?\) AS deposit_amount)/u,
  )?.[1];
  if (!expression) throw new Error("未找到押金来源选择表达式");

  // 只在内存中执行原查询的金额表达式，不连接生产数据库，也不模拟其返回金额。
  // 内存引擎验证此通用表达式的聚合、条件和空值回退语义，不验证生产数据库的锁行为。
  const database = new MemoryDatabase(":memory:");
  try {
    database.exec(`
      CREATE TABLE contract_payment_purpose_details (
        external_payment_record_id TEXT, purpose TEXT, amount NUMERIC
      );
      CREATE TABLE contract_payment_deposit_receipts (
        external_payment_record_id TEXT, status TEXT, confirmed_amount NUMERIC
      );
    `);
    const insertPurpose = database.prepare(
      "INSERT INTO contract_payment_purpose_details VALUES (?, ?, ?)",
    );
    for (const detail of purposeDetails) {
      insertPurpose.run("payment-1", detail.purpose, detail.amount);
    }
    const insertReceipt = database.prepare(
      "INSERT INTO contract_payment_deposit_receipts VALUES (?, ?, ?)",
    );
    for (const receipt of receipts) {
      insertReceipt.run("payment-1", receipt.status, receipt.amount);
    }
    return Number(
      database
        .prepare(`SELECT ${expression} FROM (SELECT 'payment-1' AS id) payment`)
        .get().deposit_amount,
    );
  } finally {
    database.close();
  }
}

describe("资产合同补发票时扣除押金并重建对应金额", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSequence = 0;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("实际案例两张补票覆盖扣押金后的付款，不把 79494 元押金分摊给发票", async () => {
    const fixture = createInvoiceAppendFixture([61134, 18833.06]);
    const additionalAllocation = jest.spyOn(
      financialWorkflow,
      "allocateAdditionalContractFinancialAmounts",
    );
    const res = await submitInvoiceAppend(fixture.invoiceJobIds);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          settlementRecordIds: [],
          matches: [
            {
              registrationId,
              invoiceRecordId: fixture.invoices[1]!.record_id,
              settlementRecordId: "new-external-payment",
              allocatedAmount: 61134,
            },
            {
              registrationId,
              invoiceRecordId: fixture.invoices[2]!.record_id,
              settlementRecordId: "new-external-payment",
              allocatedAmount: 18833.06,
            },
          ],
        }),
      }),
    );
    expect(
      fixture.payments.reduce((sum, item) => sum + item.amount, 0),
    ).toBeCloseTo(540623.58, 2);
    expect(fixture.getMatches()).toEqual([
      {
        invoice_item_id: "old-invoice-item",
        settlement_item_id: "old-payment-item",
        allocated_amount: 381162.52,
      },
      {
        invoice_item_id: fixture.invoices[1]!.item_id,
        settlement_item_id: "new-payment-item",
        allocated_amount: 61134,
      },
      {
        invoice_item_id: fixture.invoices[2]!.item_id,
        settlement_item_id: "new-payment-item",
        allocated_amount: 18833.06,
      },
    ]);
    expect(
      fixture
        .getMatches()
        .reduce((sum, item) => sum + item.allocated_amount, 0),
    ).toBeCloseTo(461129.58, 2);
    expect(
      fixture.invoices.every((invoice) => invoice.status === "confirmed"),
    ).toBe(true);
    expect(additionalAllocation).not.toHaveBeenCalled();
    expect(fixture.client.query).toHaveBeenCalledWith(
      expect.stringContaining("receipt.status='confirmed'"),
      [registrationId, contractId, "external_payment"],
    );
    const audit = fixture.client.query.mock.calls.find(([sql]) =>
      sql.includes("financial_registration_settlements_added"),
    );
    expect(JSON.parse(String(audit?.[1]?.[6]))).toMatchObject({
      currentInvoiceAmount: 79967.06,
      currentSettlementAmount: 0,
      cumulativeInvoiceAmount: 461129.58,
      cumulativeSettlementAmount: 461129.58,
      immediateSettlementPosted: false,
    });
  });

  it("仅先补一张 61134 元发票时允许部分对应，剩余 18833.06 元付款继续待票", async () => {
    const fixture = createInvoiceAppendFixture([61134]);
    const additionalAllocation = jest.spyOn(
      financialWorkflow,
      "allocateAdditionalContractFinancialAmounts",
    );
    const res = await submitInvoiceAppend(fixture.invoiceJobIds);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
    expect(fixture.getMatches()).toHaveLength(2);
    expect(fixture.getMatches()[1]).toMatchObject({
      settlement_item_id: "new-payment-item",
      allocated_amount: 61134,
    });
    const matchedTotal = fixture
      .getMatches()
      .reduce((sum, item) => sum + item.allocated_amount, 0);
    expect(540623.58 - 79494 - matchedTotal).toBeCloseTo(18833.06, 2);
    expect(additionalAllocation).not.toHaveBeenCalled();
    expect(mockRecalculateContractExecutionStatus).toHaveBeenCalledWith(
      fixture.client,
      contractId,
      "finance-user",
      "admin",
    );
  });

  it("无押金的对外付款继续按原额匹配，不额外扣减", async () => {
    const fixture = createInvoiceAppendFixture([61134, 18833.06], {
      firstPaymentAmount: 381162.52,
      depositAmount: 0,
    });
    const res = await submitInvoiceAppend(fixture.invoiceJobIds);

    expect(res.status).not.toHaveBeenCalled();
    expect(fixture.getMatches()[0]).toMatchObject({
      settlement_item_id: "old-payment-item",
      allocated_amount: 381162.52,
    });
    expect(
      fixture
        .getMatches()
        .reduce((sum, match) => sum + match.allocated_amount, 0),
    ).toBeCloseTo(
      fixture.payments.reduce((sum, payment) => sum + payment.amount, 0),
      2,
    );
  });

  it("重建对外付款匹配保留其他结算类别，并从发票余额扣除已占用的 1000 元", async () => {
    const fixture = createInvoiceAppendFixture([61134, 18833.06], {
      otherSettlementAmount: 1000,
    });
    const res = await submitInvoiceAppend(fixture.invoiceJobIds);

    expect(res.status).not.toHaveBeenCalled();
    expect(fixture.getMatches()).toContainEqual({
      invoice_item_id: "old-invoice-item",
      settlement_item_id: "other-payment-item",
      allocated_amount: 1000,
    });
    expect(fixture.getMatches()).toContainEqual({
      invoice_item_id: "old-invoice-item",
      settlement_item_id: "old-payment-item",
      allocated_amount: 380162.52,
    });
    expect(
      fixture
        .getMatches()
        .reduce((sum, match) => sum + match.allocated_amount, 0),
    ).toBeCloseTo(461129.58, 2);
    for (const invoice of fixture.invoices) {
      expect(
        fixture
          .getMatches()
          .filter((match) => match.invoice_item_id === invoice.item_id)
          .reduce((sum, match) => sum + match.allocated_amount, 0),
      ).toBeCloseTo(invoice.amount, 2);
    }
    expect(fixture.client.query).toHaveBeenCalledWith(
      expect.stringContaining("AND settlement.item_kind=$2"),
      [registrationId, "external_payment"],
    );
    expect(fixture.client.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE match.invoice_item_id=item.id"),
      [registrationId, contractId],
    );
  });

  it.each([
    {
      name: "没有用途明细和押金条时押金为零",
      purposes: [],
      receipts: [],
      expected: 0,
    },
    {
      name: "用途明细押金优先，不能再扣同笔已确认押金条",
      purposes: [{ purpose: "lease_deposit", amount: 60000 }],
      receipts: [{ status: "confirmed", amount: 79494 }],
      expected: 60000,
    },
    {
      name: "已有用途明细且全部为合同款时不再回退历史押金条",
      purposes: [{ purpose: "contract_payment", amount: 460656.52 }],
      receipts: [{ status: "confirmed", amount: 79494 }],
      expected: 0,
    },
    {
      name: "没有用途明细时仅计入已确认押金条，忽略未确认和已冲销记录",
      purposes: [],
      receipts: [
        { status: "confirmed", amount: 79494 },
        { status: "draft", amount: 1000 },
        { status: "reversed", amount: 2000 },
      ],
      expected: 79494,
    },
  ])("押金来源查询表达式：$name", async ({ purposes, receipts, expected }) => {
    const fixture = createInvoiceAppendFixture([61134, 18833.06]);
    const res = await submitInvoiceAppend(fixture.invoiceJobIds);
    expect(res.status).not.toHaveBeenCalled();
    const query = getDepositAmountQuery(fixture);

    // 补充原查询的结构约束，避免把路由测试中的模拟金额误当成数据库来源优先级证明。
    const normalized = query.replace(/\s+/gu, " ");
    expect(normalized).toContain(
      "WHERE detail.external_payment_record_id=payment.id AND detail.purpose='lease_deposit'",
    );
    expect(normalized).toContain(
      "WHERE purpose.external_payment_record_id=payment.id ) THEN 0 ELSE",
    );
    expect(normalized).toContain(
      "WHERE receipt.external_payment_record_id=payment.id AND receipt.status='confirmed'",
    );
    expect(evaluateDepositAmountExpression(query, purposes, receipts)).toBe(
      expected,
    );
  });
});
