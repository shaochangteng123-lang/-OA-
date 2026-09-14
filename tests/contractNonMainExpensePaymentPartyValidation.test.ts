/** @jest-environment node */

const mockDbTransaction = jest.fn();
const mockPostContractFinancialSettlements = jest.fn();
const mockLockInvoiceApplicationRoot = jest.fn();
const mockLockInvoiceApplicationRootByFinancialSource = jest.fn();
const mockReconcileInvoiceApplicationAllocations = jest.fn();
let mockIdSequence = 0;

jest.mock("nanoid", () => ({
  nanoid: () => `non-main-party-${++mockIdSequence}`,
}));
jest.mock("../server/db/index", () => ({
  db: {
    all: jest.fn(),
    get: jest.fn(),
    run: jest.fn(),
    transaction: mockDbTransaction,
  },
}));
jest.mock("../server/services/invoiceApplication", () => ({
  getInvoiceApplicationEligibilityBatch: jest.fn(),
  lockInvoiceApplicationRoot: mockLockInvoiceApplicationRoot,
  lockInvoiceApplicationRootByFinancialSource:
    mockLockInvoiceApplicationRootByFinancialSource,
  reconcileInvoiceApplicationAllocations:
    mockReconcileInvoiceApplicationAllocations,
}));
jest.mock("../server/services/contractService", () => ({
  ...jest.requireActual("../server/services/contractService"),
  postContractFinancialSettlements: mockPostContractFinancialSettlements,
}));

import {
  appendFinancialRegistrationSettlementJobs,
  createFinancialRegistrationFromJobs,
} from "../server/routes/contracts";
import { contractFinancialOcrParserVersion } from "../server/services/contractFinancialWorkflow";

const contractId = "non-main-expense-contract";
const registrationId = "non-main-expense-registration";
const companyName = "北京羽隶工程咨询有限公司";
const counterpartyName = "郑州一鸣不锈钢制品有限公司";

function createContract(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: contractId,
    root_contract_id: contractId,
    relation_type: "main",
    status: "effective",
    category: "non_main",
    declared_category: "non_main",
    declared_subtype: "non_main_expense",
    financial_direction: "cost",
    asset_funding_mode: null,
    party_a: companyName,
    party_b: counterpartyName,
    party_c: null,
    project_id: null,
    is_deleted: false,
    ...overrides,
  };
}

function createInvoiceJob(amount = 13_600) {
  return {
    id: "invoice-job",
    contract_id: contractId,
    file_id: "invoice-file",
    record_kind: "invoice",
    record_id: null,
    status: "verified",
    validation_status: "verified",
    can_auto_post: true,
    document_status: "normal",
    direction: "input",
    parser_version: contractFinancialOcrParserVersion("invoice"),
    snapshot_json: {
      fields: {
        invoiceNumber: "26412000003457200481",
        itemName: "金属制品",
        seller: counterpartyName,
        buyer: companyName,
        invoiceDate: "2026-09-11",
        amount,
        taxAmount: 0,
      },
    },
  };
}

function createPaymentJob(
  id: string,
  amount: number,
  receiptNo: string,
  fieldOverrides: Record<string, unknown> = {},
) {
  return {
    id,
    contract_id: contractId,
    file_id: `${id}-file`,
    record_kind: "payment",
    record_id: null,
    status: "verified",
    validation_status: "verified",
    can_auto_post: true,
    document_status: "normal",
    direction: "payment",
    parser_version: contractFinancialOcrParserVersion("payment"),
    snapshot_json: {
      fields: {
        currency: "CNY",
        currencyEvidence: "currency_label",
        payer: companyName,
        payerAccount: "0200049609201258271",
        payee: counterpartyName,
        payeeAccount: "257222029766",
        electronicReceiptNo: receiptNo,
        paymentTime: "2026-09-14",
        amount,
        ...fieldOverrides,
      },
    },
  };
}

function createInitialRegistrationClient(
  contract: Record<string, unknown>,
  paymentFieldOverrides: Record<string, unknown> = {},
) {
  const jobs = [
    createInvoiceJob(),
    createPaymentJob(
      "first-payment-job",
      6_000,
      "0920-5140-7107-1100",
      paymentFieldOverrides,
    ),
  ];
  return {
    query: jest.fn(async (sql: string) => {
      const statement = sql.replace(/\s+/gu, " ").trim();
      if (statement.startsWith("SELECT * FROM contracts")) {
        return { rows: [contract], rowCount: 1 };
      }
      if (statement.startsWith("SELECT termination.id FROM contracts")) {
        return { rows: [], rowCount: 0 };
      }
      if (statement.startsWith("SELECT * FROM contract_financial_ocr_jobs")) {
        return { rows: jobs, rowCount: jobs.length };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

function createAppendRegistrationClient(contract: Record<string, unknown>) {
  const job = createPaymentJob(
    "additional-payment-job",
    4_000,
    "0920-5140-7108-1100",
  );
  return {
    query: jest.fn(async (sql: string) => {
      const statement = sql.replace(/\s+/gu, " ").trim();
      if (
        statement.startsWith(
          "SELECT id, contract_id, status, bank_ocr_job_id, settlement_kind",
        )
      ) {
        return {
          rows: [
            {
              id: registrationId,
              contract_id: contractId,
              status: "draft",
              bank_ocr_job_id: "first-payment-job",
              settlement_kind: "payment",
              financial_direction: "cost",
              direction_invoice_record_id: "invoice-record",
            },
          ],
          rowCount: 1,
        };
      }
      if (statement.startsWith("SELECT * FROM contracts")) {
        return { rows: [contract], rowCount: 1 };
      }
      if (statement.startsWith("SELECT termination.id FROM contracts")) {
        return { rows: [], rowCount: 0 };
      }
      if (statement.startsWith("SELECT item.id AS item_id, invoice.id")) {
        return {
          rows: [
            {
              item_id: "invoice-item",
              record_id: "invoice-record",
              amount: 13_600,
              buyer: companyName,
              seller: counterpartyName,
            },
          ],
          rowCount: 1,
        };
      }
      if (statement.includes("GROUP BY invoice_item_id")) {
        return {
          rows: [
            {
              invoice_item_id: "invoice-item",
              allocated_amount: "6000.00",
            },
          ],
          rowCount: 1,
        };
      }
      if (statement.startsWith("SELECT * FROM contract_financial_ocr_jobs")) {
        return { rows: [job], rowCount: 1 };
      }
      if (statement.startsWith("SELECT record.payer, record.payer_account")) {
        return {
          rows: [
            {
              payer: companyName,
              payer_account: "0200049609201258271",
              payee: counterpartyName,
              payee_account: "257222029766",
              amount: "6000.00",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
}

describe("非主营支出付款主体校验", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdSequence = 0;
  });

  it("资金方式为空时允许首次登记购销双方一致的部分付款", async () => {
    const contract = createContract();
    const client = createInitialRegistrationClient(contract);
    mockDbTransaction.mockImplementationOnce(
      async (callback: (value: typeof client) => Promise<unknown>) =>
        callback(client),
    );
    mockPostContractFinancialSettlements.mockResolvedValueOnce({
      ...contract,
      status: "executing",
    });

    const result = await createFinancialRegistrationFromJobs(
      contractId,
      ["invoice-job"],
      ["first-payment-job"],
      {},
      { id: "finance-user", role: "admin" },
    );

    expect(result).toMatchObject({ status: "draft" });
    expect(result.invoiceRecordIds).toHaveLength(1);
    expect(result.settlementRecordIds).toHaveLength(1);
    expect(result.matches).toHaveLength(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_payments"),
      expect.arrayContaining([6_000, companyName, counterpartyName]),
    );
    expect(mockPostContractFinancialSettlements).toHaveBeenCalledTimes(1);
  });

  it("资金方式为空时允许向已有登记追加购销双方一致的部分付款", async () => {
    const contract = createContract({ status: "executing" });
    const client = createAppendRegistrationClient(contract);
    mockDbTransaction.mockImplementationOnce(
      async (callback: (value: typeof client) => Promise<unknown>) =>
        callback(client),
    );
    mockPostContractFinancialSettlements.mockResolvedValueOnce(contract);

    const result = await appendFinancialRegistrationSettlementJobs(
      contractId,
      registrationId,
      [],
      ["additional-payment-job"],
      {},
      { id: "finance-user", role: "admin" },
    );

    expect(result).toMatchObject({
      registrationId,
      status: "draft",
    });
    expect(result.settlementRecordIds).toHaveLength(1);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.allocatedAmount).toBe(4_000);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_payments"),
      expect.arrayContaining([4_000, companyName, counterpartyName]),
    );
    expect(mockPostContractFinancialSettlements).toHaveBeenCalledTimes(1);
  });

  it("非主营支出仍阻断与发票购销双方不一致的付款回单", async () => {
    const contract = createContract();
    const client = createInitialRegistrationClient(contract, {
      payer: "北京羽隶科技有限公司",
    });
    mockDbTransaction.mockImplementationOnce(
      async (callback: (value: typeof client) => Promise<unknown>) =>
        callback(client),
    );

    await expect(
      createFinancialRegistrationFromJobs(
        contractId,
        ["invoice-job"],
        ["first-payment-job"],
        {},
        { id: "finance-user", role: "admin" },
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "FINANCIAL_REGISTRATION_PARTY_MISMATCH",
    });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_payments"),
      expect.anything(),
    );
    expect(mockPostContractFinancialSettlements).not.toHaveBeenCalled();
  });

  it("资产合同资金方式待确认时仍阻断付款登记", async () => {
    const contract = createContract({
      category: "asset",
      declared_category: "asset",
      declared_subtype: "equipment_purchase",
      asset_funding_mode: "pending_review",
    });
    const client = createInitialRegistrationClient(contract);
    mockDbTransaction.mockImplementationOnce(
      async (callback: (value: typeof client) => Promise<unknown>) =>
        callback(client),
    );

    await expect(
      createFinancialRegistrationFromJobs(
        contractId,
        ["invoice-job"],
        ["first-payment-job"],
        {},
        { id: "finance-user", role: "admin" },
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "ASSET_FUNDING_MODE_REQUIRED",
    });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_payments"),
      expect.anything(),
    );
    expect(mockPostContractFinancialSettlements).not.toHaveBeenCalled();
  });
});
