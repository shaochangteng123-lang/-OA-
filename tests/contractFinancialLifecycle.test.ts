jest.mock("nanoid", () => ({ nanoid: () => "audit-id" }));
jest.mock("../server/db/index", () => ({
  db: { all: jest.fn(), transaction: jest.fn() },
}));

import fs from "fs";
import path from "path";
import {
  backfillLegacyPostedContractFinancialSettlements,
  confirmContractFinancialRegistration,
  confirmContractFinancialRecord,
  deleteContractFinancialOcrUpload,
  deleteContractFinancialRegistrationDraft,
  deleteContractFinancialDraft,
  financialDirectionFromContractCategory,
  postContractFinancialSettlements,
  reverseContractFinancialRegistration,
  reverseContractFinancialRecord,
} from "../server/services/contractService";
import { db } from "../server/db/index";

function createRegistrationConfirmationClient(options: {
  invoiceAmount: number;
  receiptAmount: number;
  allocatedAmounts: number[];
}) {
  const registration = {
    id: "registration-closure",
    contract_id: "contract-closure",
    settlement_kind: "receipt",
    invoice_ocr_job_id: "invoice-job-closure",
    bank_ocr_job_id: "receipt-job-closure",
    invoice_record_id: "invoice-closure",
    receipt_record_id: "receipt-closure",
    payment_record_id: null,
    financial_direction: "income",
    direction_invoice_record_id: "invoice-closure",
    status: "draft",
  };
  const items = [
    {
      item_kind: "invoice",
      ocr_job_id: "invoice-job-closure",
      record_id: "invoice-closure",
    },
    {
      item_kind: "receipt",
      ocr_job_id: "receipt-job-closure",
      record_id: "receipt-closure",
    },
  ];
  const verifiedRecord = (direction: "output" | "receipt", amount: number) => ({
    contract_id: "contract-closure",
    file_id: `file-${direction}`,
    amount,
    status: "draft",
    financial_ocr_job_id: `job-${direction}`,
    financial_ocr_status: "consumed",
    financial_validation_status: "verified",
    financial_document_status: "normal",
    financial_direction: direction,
    financial_can_auto_post: true,
  });
  return {
    query: jest.fn(async (sql: string) => {
      if (
        sql.includes("FROM contract_financial_registrations") &&
        sql.includes("FOR UPDATE")
      )
        return { rows: [registration] };
      if (sql.includes("FROM contract_financial_registration_items"))
        return { rows: items };
      if (sql.includes("COALESCE(root_contract_id, id) AS root_id"))
        return {
          rows: [{ id: "contract-closure", root_id: "contract-closure" }],
        };
      if (sql.includes("FROM contract_invoices AS record"))
        return {
          rows: [verifiedRecord("output", options.invoiceAmount)],
        };
      if (sql.includes("FROM contract_receipts AS record"))
        return {
          rows: [verifiedRecord("receipt", options.receiptAmount)],
        };
      if (sql.includes("FROM contract_financial_registration_matches"))
        return {
          rows: options.allocatedAmounts.map((amount) => ({
            allocated_amount: amount.toFixed(2),
            settlement_kind: "receipt",
          })),
        };
      if (sql.includes("SELECT * FROM contracts"))
        return {
          rows: [
            {
              id: "contract-closure",
              root_contract_id: "contract-closure",
              status: "effective",
              category: "main_business",
              asset_funding_mode: null,
              financial_direction: "income",
              project_id: null,
            },
          ],
        };
      return { rows: [] };
    }),
  };
}

describe("合同财务记录三态闭环", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("合同分类唯一决定收入或支出方向", () => {
    expect(financialDirectionFromContractCategory("main_business")).toBe(
      "income",
    );
    expect(financialDirectionFromContractCategory("non_main")).toBe("income");
    expect(financialDirectionFromContractCategory("asset")).toBe("cost");
  });

  it("部分回款保存后立即确认结算事实、冻结费率并重算合同状态", async () => {
    let rootFinancialDirection: "income" | null = null;
    let rootStatus = "effective";
    const registration = {
      id: "registration-posted",
      contract_id: "contract-posted",
      settlement_kind: "receipt",
      financial_direction: "income",
      direction_invoice_record_id: "invoice-posted",
      status: "draft",
    };
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        )
          return { rows: [registration] };
        if (sql.includes("FROM contract_financial_registration_items"))
          return {
            rows: [
              {
                record_id: "receipt-posted",
                amount: "220.00",
                allocated_amount: "220.00",
              },
            ],
          };
        if (sql.includes("SELECT * FROM contracts"))
          return {
            rows: [
              {
                id: "contract-posted",
                root_contract_id: "contract-posted",
                status: rootStatus,
                category: "main_business",
                financial_direction: rootFinancialDirection,
                project_id: null,
              },
            ],
          };
        if (sql.includes("UPDATE contracts SET financial_direction")) {
          rootFinancialDirection = "income";
          return { rows: [] };
        }
        if (sql.includes("UPDATE contract_receipts AS receipt"))
          return { rows: [{ id: "receipt-posted" }] };
        if (sql.includes("AS contract_total"))
          return {
            rows: [
              {
                contract_total: 600,
                invoice_count: 0,
                invoice_total: 0,
                receipt_total: 220,
                payment_total: 0,
              },
            ],
          };
        if (sql.includes("UPDATE contracts SET status = $2")) {
          rootStatus = String(params?.[1] || "executing");
          return {
            rows: [
              {
                id: "contract-posted",
                root_contract_id: "contract-posted",
                status: rootStatus,
                category: "main_business",
                financial_direction: rootFinancialDirection,
                project_id: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    await expect(
      postContractFinancialSettlements(client as never, {
        contractId: "contract-posted",
        registrationId: "registration-posted",
        settlementKind: "receipt",
        settlementRecordIds: ["receipt-posted"],
        financialDirection: "income",
        directionInvoiceRecordId: "invoice-posted",
        actorId: "finance-1",
        actorRole: "admin",
        now: "2026-08-17T01:00:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "executing" });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET financial_direction"),
      expect.arrayContaining(["contract-posted", "income", "finance-1"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("rate_snapshot_json = COALESCE"),
      expect.arrayContaining([
        ["receipt-posted"],
        "contract-posted",
        "finance-1",
      ]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["financial_settlements_posted"]),
    );
  });

  it("银行凭证未完整分配到发票时不得即时入账", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                id: "registration-unallocated",
                contract_id: "contract-unallocated",
                settlement_kind: "receipt",
                financial_direction: "income",
                direction_invoice_record_id: "invoice-unallocated",
                status: "draft",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_financial_registration_items")) {
          return {
            rows: [
              {
                record_id: "receipt-unallocated",
                amount: "220.00",
                allocated_amount: "100.00",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    await expect(
      postContractFinancialSettlements(client as never, {
        contractId: "contract-unallocated",
        registrationId: "registration-unallocated",
        settlementKind: "receipt",
        settlementRecordIds: ["receipt-unallocated"],
        financialDirection: "income",
        directionInvoiceRecordId: "invoice-unallocated",
        actorId: "finance-1",
        actorRole: "admin",
        now: "2026-08-17T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "FINANCIAL_REGISTRATION_MATCH_AMOUNT_MISMATCH",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE contract_receipts"),
      ),
    ).toBe(false);
  });

  it("启动补处理将旧部分回款登记按验证链安全转为即时入账", async () => {
    (db.all as jest.Mock).mockResolvedValueOnce([
      {
        registration_id: "registration-legacy-partial",
        contract_id: "contract-legacy-partial",
        settlement_kind: "receipt",
        financial_direction: "income",
        direction_invoice_record_id: "invoice-legacy-partial",
        actor_id: "finance-legacy",
        actor_role: "admin",
      },
    ]);
    let rootDirection: "income" | null = null;
    let rootStatus = "effective";
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("JOIN contract_financial_ocr_jobs job")) {
          return {
            rows: [
              {
                record_id: "receipt-legacy-partial",
                record_status: "draft",
                job_status: "consumed",
                validation_status: "verified",
                document_status: "normal",
                direction: "receipt",
                can_auto_post: true,
              },
            ],
          };
        }
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                id: "registration-legacy-partial",
                contract_id: "contract-legacy-partial",
                settlement_kind: "receipt",
                financial_direction: "income",
                direction_invoice_record_id: "invoice-legacy-partial",
                status: "draft",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_financial_registration_items item")) {
          return {
            rows: [
              {
                record_id: "receipt-legacy-partial",
                amount: "220.00",
                allocated_amount: "220.00",
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-legacy-partial",
                root_contract_id: "contract-legacy-partial",
                status: rootStatus,
                category: "main_business",
                financial_direction: rootDirection,
                project_id: null,
              },
            ],
          };
        }
        if (sql.includes("UPDATE contracts SET financial_direction")) {
          rootDirection = "income";
          return { rows: [] };
        }
        if (sql.includes("UPDATE contract_receipts AS receipt")) {
          return { rows: [{ id: "receipt-legacy-partial" }] };
        }
        if (sql.includes("AS contract_total")) {
          return {
            rows: [
              {
                contract_total: 600,
                invoice_count: 0,
                invoice_total: 0,
                receipt_total: 220,
                payment_total: 0,
              },
            ],
          };
        }
        if (sql.includes("UPDATE contracts SET status = $2")) {
          rootStatus = String(params?.[1] || "executing");
          return {
            rows: [
              {
                id: "contract-legacy-partial",
                root_contract_id: "contract-legacy-partial",
                status: rootStatus,
                category: "main_business",
                financial_direction: rootDirection,
                project_id: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback(client),
    );

    await expect(
      backfillLegacyPostedContractFinancialSettlements(),
    ).resolves.toEqual({
      postedRegistrationCount: 1,
      postedSettlementCount: 1,
      skippedRegistrationIds: [],
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_receipts AS receipt"),
      expect.arrayContaining([
        ["receipt-legacy-partial"],
        "contract-legacy-partial",
      ]),
    );
  });

  it("确认草稿后写确认人并以 confirmed 记录重算合同状态", async () => {
    const contract = {
      id: "contract-1",
      root_contract_id: "contract-1",
      status: "effective",
      category: "main_business",
      financial_direction: "income",
      project_id: null,
    };
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes("FROM contract_receipts") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                contract_id: "contract-1",
                file_id: "file-1",
                status: "draft",
                financial_ocr_job_id: "financial-ocr-1",
                financial_ocr_status: "consumed",
                financial_validation_status: "verified",
                financial_document_status: "normal",
                financial_direction: "receipt",
                financial_can_auto_post: true,
              },
            ],
          };
        }
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id")) {
          return { rows: [{ id: "contract-1", root_id: "contract-1" }] };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("AS contract_total")) {
          return {
            rows: [
              {
                contract_total: 100,
                invoice_count: 0,
                receipt_total: 60,
                payment_total: 0,
              },
            ],
          };
        }
        if (sql.includes("UPDATE contracts SET status = $2")) {
          return { rows: [{ ...contract, status: params?.[1] }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      confirmContractFinancialRecord(
        "receipt",
        "receipt-1",
        "finance-1",
        "admin",
        "contract-1",
      ),
    ).resolves.toMatchObject({ status: "executing" });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'confirmed', confirmed_by = $2"),
      expect.arrayContaining(["receipt-1", "finance-1"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("rate_snapshot_json = COALESCE"),
      expect.arrayContaining(["receipt-1", "finance-1"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("r.status = 'confirmed'"),
      ["contract-1"],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["receipt_confirmed"]),
    );
  });

  it("只有草稿可以删除且删除不会触发合同状态重算", async () => {
    const contract = {
      id: "contract-2",
      root_contract_id: "contract-2",
      status: "executing",
      category: "main_business",
      project_id: null,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("FROM contract_invoices") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                contract_id: "contract-2",
                file_id: "file-2",
                file_path: "uploads/development/contracts/invoice-2.pdf",
                status: "draft",
                financial_ocr_job_id: "job-2",
              },
            ],
          };
        }
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id")) {
          return { rows: [{ id: "contract-2", root_id: "contract-2" }] };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    const result = await deleteContractFinancialDraft(
      "invoice",
      "invoice-1",
      "finance-1",
      "admin",
      "contract-2",
    );

    expect(client.query).toHaveBeenCalledWith(
      "DELETE FROM contract_invoices WHERE id = $1",
      ["invoice-1"],
    );
    expect(result.removedFilePath).toBe(
      "uploads/development/contracts/invoice-2.pdf",
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_financial_file_hashes"),
      [["file-2"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_financial_ocr_jobs"),
      [["job-2"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_files"),
      [["file-2"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["invoice_draft_deleted"]),
    );
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("AS contract_total"),
      ),
    ).toBe(false);
  });

  it("未消费的财务识别上传可硬删除并释放全局重复占用", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM contract_financial_ocr_jobs AS job")) {
          return {
            rows: [
              {
                id: "ocr-upload-1",
                contract_id: "contract-2",
                file_id: "upload-file-1",
                file_path: "uploads/development/contracts/upload-1.pdf",
                file_hash: "hash-1",
                record_kind: "invoice",
                status: "verified",
                record_id: null,
              },
            ],
          };
        }
        if (sql.includes(") AS used")) return { rows: [{ used: false }] };
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      deleteContractFinancialOcrUpload(
        "contract-2",
        "ocr-upload-1",
        "finance-1",
        "admin",
      ),
    ).resolves.toEqual({
      removedFilePath: "uploads/development/contracts/upload-1.pdf",
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_financial_file_hashes"),
      [["upload-file-1"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_financial_ocr_jobs"),
      [["ocr-upload-1"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_files"),
      [["upload-file-1"]],
    );
  });

  it("草稿财务记录不能冲正", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("FROM contract_payments") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                contract_id: "contract-3",
                file_id: "file-3",
                status: "draft",
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      reverseContractFinancialRecord(
        "payment",
        "payment-1",
        "finance-1",
        "admin",
        "录入错误",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "FINANCIAL_RECORD_NOT_CONFIRMED",
    });
  });

  it("缺少服务端验证链的财务草稿不能确认", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("FROM contract_invoices") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                contract_id: "contract-4",
                file_id: "file-4",
                status: "draft",
                financial_ocr_job_id: "financial-ocr-4",
                financial_ocr_status: "blocked",
                financial_validation_status: "blocked",
                financial_document_status: "unknown",
                financial_direction: "unknown",
                financial_can_auto_post: false,
              },
            ],
          };
        }
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id")) {
          return { rows: [{ id: "contract-4", root_id: "contract-4" }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      confirmContractFinancialRecord(
        "invoice",
        "invoice-4",
        "finance-1",
        "admin",
        "contract-4",
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "FINANCIAL_DRAFT_OCR_NOT_VERIFIED",
    });
  });

  it("服务端验证方向与合同业务不一致时仍禁止确认", async () => {
    const contract = {
      id: "contract-5",
      root_contract_id: "contract-5",
      status: "effective",
      category: "main_business",
      financial_direction: "income",
      project_id: null,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("FROM contract_receipts") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                contract_id: "contract-5",
                file_id: "file-5",
                status: "draft",
                financial_ocr_job_id: "financial-ocr-5",
                financial_ocr_status: "consumed",
                financial_validation_status: "verified",
                financial_document_status: "normal",
                financial_direction: "payment",
                financial_can_auto_post: true,
              },
            ],
          };
        }
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id")) {
          return { rows: [{ id: "contract-5", root_id: "contract-5" }] };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      confirmContractFinancialRecord(
        "receipt",
        "receipt-5",
        "finance-1",
        "admin",
        "contract-5",
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "FINANCIAL_DRAFT_DIRECTION_MISMATCH",
    });
  });

  it("发票、回单与对应金额均为100时整组确认并只让结算金额驱动执行状态", async () => {
    const contract = {
      id: "contract-6",
      root_contract_id: "contract-6",
      status: "effective",
      category: "main_business",
      financial_direction: "income",
      project_id: null,
    };
    const registration = {
      id: "registration-6",
      contract_id: "contract-6",
      settlement_kind: "receipt",
      invoice_ocr_job_id: "invoice-job-6",
      bank_ocr_job_id: "bank-job-6",
      invoice_record_id: "invoice-6",
      receipt_record_id: "receipt-6",
      payment_record_id: null,
      financial_direction: "income",
      direction_invoice_record_id: "invoice-6",
      status: "draft",
    };
    const verifiedRecord = (
      direction: "output" | "receipt",
      amount: number,
    ) => ({
      contract_id: "contract-6",
      file_id: `file-${direction}`,
      amount,
      status: direction === "receipt" ? "confirmed" : "draft",
      financial_ocr_job_id: `job-${direction}`,
      financial_ocr_status: "consumed",
      financial_validation_status: "verified",
      financial_document_status: "normal",
      financial_direction: direction,
      financial_can_auto_post: true,
    });
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        ) {
          return { rows: [registration] };
        }
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id")) {
          return { rows: [{ id: "contract-6", root_id: "contract-6" }] };
        }
        if (sql.includes("FROM contract_invoices AS record")) {
          return { rows: [verifiedRecord("output", 100)] };
        }
        if (sql.includes("FROM contract_receipts AS record")) {
          return { rows: [verifiedRecord("receipt", 100)] };
        }
        if (sql.includes("FROM contract_financial_registration_matches")) {
          return {
            rows: [{ allocated_amount: "100.00", settlement_kind: "receipt" }],
          };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("AS contract_total")) {
          return {
            rows: [
              {
                contract_total: 200,
                invoice_count: 1,
                invoice_total: 100,
                receipt_total: 100,
                payment_total: 0,
              },
            ],
          };
        }
        if (sql.includes("UPDATE contracts SET status = $2")) {
          return { rows: [{ ...contract, status: params?.[1] }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      confirmContractFinancialRegistration(
        "registration-6",
        "finance-1",
        "admin",
        "contract-6",
      ),
    ).resolves.toMatchObject({ status: "executing" });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_invoices"),
      expect.arrayContaining([["invoice-6"], "finance-1"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_receipts AS receipt"),
      expect.arrayContaining([["receipt-6"], "finance-1"]),
    );
    expect(
      client.query.mock.calls.some(
        ([sql]) =>
          String(sql).includes(
            "confirmed_at = COALESCE(receipt.confirmed_at, $3)",
          ) &&
          String(sql).includes(
            "rate_snapshot_json = COALESCE(receipt.rate_snapshot_json",
          ),
      ),
    ).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_financial_registrations"),
      expect.arrayContaining(["registration-6", "finance-1"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("r.status = 'confirmed'"),
      ["contract-6"],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["financial_registration_confirmed"]),
    );
  });

  it("发票100但仅回款40时阻断确认且不写入确认状态或核算", async () => {
    const client = createRegistrationConfirmationClient({
      invoiceAmount: 100,
      receiptAmount: 40,
      allocatedAmounts: [40],
    });
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback(client),
    );

    await expect(
      confirmContractFinancialRegistration(
        "registration-closure",
        "finance-1",
        "admin",
        "contract-closure",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "FINANCIAL_REGISTRATION_AMOUNT_MISMATCH",
    });

    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE contract_invoices"),
      ),
    ).toBe(false);
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("SET status = 'confirmed'"),
      ),
    ).toBe(false);
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE contracts SET financial_direction"),
      ),
    ).toBe(false);
  });

  it("发票与回单均为100但对应金额仅40时阻断确认", async () => {
    const client = createRegistrationConfirmationClient({
      invoiceAmount: 100,
      receiptAmount: 100,
      allocatedAmounts: [40],
    });
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback(client),
    );

    await expect(
      confirmContractFinancialRegistration(
        "registration-closure",
        "finance-1",
        "admin",
        "contract-closure",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "FINANCIAL_REGISTRATION_MATCH_AMOUNT_MISMATCH",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE contract_receipts"),
      ),
    ).toBe(false);
  });

  it("仅保存发票的待回款草稿不能确认或进入核算", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        ) {
          return {
            rows: [
              {
                id: "registration-awaiting",
                contract_id: "contract-awaiting",
                settlement_kind: "receipt",
                invoice_ocr_job_id: "invoice-job-awaiting",
                bank_ocr_job_id: null,
                invoice_record_id: "invoice-awaiting",
                receipt_record_id: null,
                payment_record_id: null,
                status: "draft",
              },
            ],
          };
        }
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id")) {
          return {
            rows: [
              {
                id: "contract-awaiting",
                root_id: "contract-awaiting",
              },
            ],
          };
        }
        if (sql.includes("FROM contract_financial_registration_items")) {
          return {
            rows: [
              {
                item_kind: "invoice",
                ocr_job_id: "invoice-job-awaiting",
                record_id: "invoice-awaiting",
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return {
            rows: [
              {
                id: "contract-awaiting",
                root_contract_id: "contract-awaiting",
                status: "effective",
                category: "main_business",
                financial_direction: "income",
                asset_funding_mode: null,
                project_id: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback(client),
    );

    await expect(
      confirmContractFinancialRegistration(
        "registration-awaiting",
        "finance-1",
        "admin",
        "contract-awaiting",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "FINANCIAL_REGISTRATION_SETTLEMENT_REQUIRED",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE contract_invoices"),
      ),
    ).toBe(false);
  });

  it("多发票与多回单按同一登记批次原子确认", async () => {
    const registration = {
      id: "registration-many",
      contract_id: "contract-many",
      settlement_kind: "receipt",
      invoice_ocr_job_id: "invoice-job-1",
      bank_ocr_job_id: "bank-job-1",
      invoice_record_id: "invoice-1",
      receipt_record_id: "receipt-1",
      payment_record_id: null,
      financial_direction: "income",
      direction_invoice_record_id: "invoice-1",
      status: "draft",
    };
    const items = [
      {
        item_kind: "invoice",
        ocr_job_id: "invoice-job-1",
        record_id: "invoice-1",
      },
      {
        item_kind: "invoice",
        ocr_job_id: "invoice-job-2",
        record_id: "invoice-2",
      },
      {
        item_kind: "receipt",
        ocr_job_id: "bank-job-1",
        record_id: "receipt-1",
      },
      {
        item_kind: "receipt",
        ocr_job_id: "bank-job-2",
        record_id: "receipt-2",
      },
    ];
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        )
          return { rows: [registration] };
        if (sql.includes("FROM contract_financial_registration_items"))
          return { rows: items };
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id"))
          return { rows: [{ id: "contract-many", root_id: "contract-many" }] };
        if (sql.includes("FROM contract_invoices AS record"))
          return {
            rows: [
              {
                contract_id: "contract-many",
                amount: 50,
                status: "draft",
                financial_ocr_job_id: "job",
                financial_ocr_status: "consumed",
                financial_validation_status: "verified",
                financial_document_status: "normal",
                financial_direction: "output",
                financial_can_auto_post: true,
              },
            ],
          };
        if (sql.includes("FROM contract_receipts AS record"))
          return {
            rows: [
              {
                contract_id: "contract-many",
                amount: 50,
                status: "draft",
                financial_ocr_job_id: "job",
                financial_ocr_status: "consumed",
                financial_validation_status: "verified",
                financial_document_status: "normal",
                financial_direction: "receipt",
                financial_can_auto_post: true,
              },
            ],
          };
        if (sql.includes("FROM contract_financial_registration_matches"))
          return {
            rows: [
              { allocated_amount: "50.00", settlement_kind: "receipt" },
              { allocated_amount: "50.00", settlement_kind: "receipt" },
            ],
          };
        if (sql.includes("SELECT * FROM contracts"))
          return {
            rows: [
              {
                id: "contract-many",
                root_contract_id: "contract-many",
                status: "executing",
                category: "main_business",
                financial_direction: "income",
                project_id: null,
              },
            ],
          };
        if (sql.includes("AS contract_total"))
          return {
            rows: [
              {
                contract_total: 100,
                invoice_count: 2,
                invoice_total: 100,
                receipt_total: 100,
                payment_total: 0,
              },
            ],
          };
        if (sql.includes("UPDATE contracts SET status = $2"))
          return {
            rows: [
              { id: "contract-many", status: params?.[1], project_id: null },
            ],
          };
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback(client),
    );

    await confirmContractFinancialRegistration(
      "registration-many",
      "finance-1",
      "admin",
      "contract-many",
    );

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_invoices"),
      [["invoice-1", "invoice-2"], "finance-1", expect.any(String)],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_receipts AS receipt"),
      [["receipt-1", "receipt-2"], "finance-1", expect.any(String)],
    );
  });

  it("开放登记已有确认回款时禁止硬删除并要求冲销", async () => {
    const registration = {
      id: "registration-posted-delete",
      contract_id: "contract-posted-delete",
      settlement_kind: "receipt",
      invoice_ocr_job_id: "invoice-job-posted-delete",
      bank_ocr_job_id: "receipt-job-posted-delete",
      invoice_record_id: "invoice-posted-delete",
      receipt_record_id: "receipt-posted-delete",
      payment_record_id: null,
      financial_direction: "income",
      direction_invoice_record_id: "invoice-posted-delete",
      status: "draft",
    };
    const items = [
      {
        item_kind: "invoice",
        ocr_job_id: "invoice-job-posted-delete",
        record_id: "invoice-posted-delete",
      },
      {
        item_kind: "receipt",
        ocr_job_id: "receipt-job-posted-delete",
        record_id: "receipt-posted-delete",
      },
    ];
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        )
          return { rows: [registration] };
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id"))
          return {
            rows: [
              {
                id: "contract-posted-delete",
                root_id: "contract-posted-delete",
              },
            ],
          };
        if (sql.includes("FROM contract_financial_registration_items"))
          return { rows: items };
        if (sql.includes("FROM contract_invoices AS record"))
          return {
            rows: [
              {
                contract_id: "contract-posted-delete",
                amount: 100,
                status: "draft",
              },
            ],
          };
        if (sql.includes("FROM contract_receipts AS record"))
          return {
            rows: [
              {
                contract_id: "contract-posted-delete",
                amount: 40,
                status: "confirmed",
              },
            ],
          };
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback(client),
    );

    await expect(
      deleteContractFinancialRegistrationDraft(
        "registration-posted-delete",
        "finance-1",
        "admin",
        "contract-posted-delete",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "FINANCIAL_REGISTRATION_POSTED_SETTLEMENT_DELETE_FORBIDDEN",
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).startsWith("DELETE FROM contract_financial_"),
      ),
    ).toBe(false);
  });

  it("双凭证登记草稿整组硬删除财务记录与原始上传证据", async () => {
    const registration = {
      id: "registration-7",
      contract_id: "contract-7",
      settlement_kind: "payment",
      invoice_ocr_job_id: "invoice-job-7",
      bank_ocr_job_id: "bank-job-7",
      invoice_record_id: "invoice-7",
      receipt_record_id: null,
      payment_record_id: "payment-7",
      status: "draft",
    };
    const contract = {
      id: "contract-7",
      root_contract_id: "contract-7",
      status: "executing",
      category: "asset",
      project_id: null,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        ) {
          return { rows: [registration] };
        }
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id")) {
          return { rows: [{ id: "contract-7", root_id: "contract-7" }] };
        }
        if (
          sql.includes("FROM contract_invoices AS record") ||
          sql.includes("FROM contract_payments AS record")
        ) {
          return {
            rows: [
              {
                contract_id: "contract-7",
                file_id: sql.includes("contract_invoices")
                  ? "invoice-file-7"
                  : "bank-file-7",
                file_path: sql.includes("contract_invoices")
                  ? "uploads/development/contracts/invoice-7.pdf"
                  : "uploads/development/contracts/payment-7.png",
                status: "draft",
                financial_ocr_job_id: sql.includes("contract_invoices")
                  ? "invoice-job-7"
                  : "bank-job-7",
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      deleteContractFinancialRegistrationDraft(
        "registration-7",
        "finance-1",
        "admin",
        "contract-7",
      ),
    ).resolves.toMatchObject({
      contract: { id: "contract-7" },
      removedFilePaths: [
        "uploads/development/contracts/invoice-7.pdf",
        "uploads/development/contracts/payment-7.png",
      ],
    });

    expect(client.query).toHaveBeenCalledWith(
      "DELETE FROM contract_financial_registrations WHERE id = $1",
      ["registration-7"],
    );
    expect(client.query).toHaveBeenCalledWith(
      "DELETE FROM contract_invoices WHERE id = ANY($1::text[])",
      [["invoice-7"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      "DELETE FROM contract_payments WHERE id = ANY($1::text[])",
      [["payment-7"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ANY($1::text[])"),
      expect.arrayContaining([["invoice-job-7", "bank-job-7"]]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_financial_file_hashes"),
      [["invoice-file-7", "bank-file-7"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_financial_ocr_jobs"),
      [["invoice-job-7", "bank-job-7"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM contract_files"),
      [["invoice-file-7", "bank-file-7"]],
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["financial_registration_draft_deleted"]),
    );
  });

  it("已确认双凭证登记整组冲正并保留同一原因", async () => {
    const registration = {
      id: "registration-8",
      contract_id: "contract-8",
      settlement_kind: "receipt",
      invoice_ocr_job_id: "invoice-job-8",
      bank_ocr_job_id: "bank-job-8",
      invoice_record_id: "invoice-8",
      receipt_record_id: "receipt-8",
      payment_record_id: null,
      status: "confirmed",
    };
    const contract = {
      id: "contract-8",
      root_contract_id: "contract-8",
      status: "completed",
      category: "main_business",
      financial_direction: "income",
      project_id: null,
    };
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        ) {
          return { rows: [registration] };
        }
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id")) {
          return { rows: [{ id: "contract-8", root_id: "contract-8" }] };
        }
        if (
          sql.includes("FROM contract_invoices AS record") ||
          sql.includes("FROM contract_receipts AS record")
        ) {
          return {
            rows: [
              {
                contract_id: "contract-8",
                file_id: "file-8",
                status: "confirmed",
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM contracts")) {
          return { rows: [contract] };
        }
        if (sql.includes("AS contract_total")) {
          return {
            rows: [
              {
                contract_total: 100,
                invoice_count: 0,
                invoice_total: 0,
                receipt_total: 0,
                payment_total: 0,
              },
            ],
          };
        }
        if (sql.includes("UPDATE contracts SET status = $2")) {
          return { rows: [{ ...contract, status: params?.[1] }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      reverseContractFinancialRegistration(
        "registration-8",
        "finance-1",
        "admin",
        "银行退回",
        "contract-8",
      ),
    ).resolves.toMatchObject({ status: "executing" });

    for (const table of [
      "contract_invoices",
      "contract_receipts",
      "contract_financial_registrations",
    ]) {
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining(`UPDATE ${table}`),
        expect.arrayContaining(["finance-1", "银行退回"]),
      );
    }
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO contract_audit_logs"),
      expect.arrayContaining(["financial_registration_reversed", "银行退回"]),
    );
  });

  it("登记未闭合但已有确认回款时允许整组冲销并重算", async () => {
    const registration = {
      id: "registration-open-reverse",
      contract_id: "contract-open-reverse",
      settlement_kind: "receipt",
      invoice_ocr_job_id: "invoice-job-open-reverse",
      bank_ocr_job_id: "receipt-job-open-reverse",
      invoice_record_id: "invoice-open-reverse",
      receipt_record_id: "receipt-open-reverse",
      payment_record_id: null,
      financial_direction: "income",
      direction_invoice_record_id: "invoice-open-reverse",
      status: "draft",
    };
    const items = [
      {
        item_kind: "invoice",
        ocr_job_id: "invoice-job-open-reverse",
        record_id: "invoice-open-reverse",
      },
      {
        item_kind: "receipt",
        ocr_job_id: "receipt-job-open-reverse",
        record_id: "receipt-open-reverse",
      },
    ];
    const contract = {
      id: "contract-open-reverse",
      root_contract_id: "contract-open-reverse",
      status: "executing",
      category: "main_business",
      financial_direction: "income",
      project_id: null,
    };
    const client = {
      query: jest.fn(async (sql: string) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        )
          return { rows: [registration] };
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id"))
          return {
            rows: [
              {
                id: "contract-open-reverse",
                root_id: "contract-open-reverse",
              },
            ],
          };
        if (sql.includes("FROM contract_financial_registration_items"))
          return { rows: items };
        if (sql.includes("FROM contract_invoices AS record"))
          return {
            rows: [
              {
                contract_id: "contract-open-reverse",
                amount: 100,
                status: "draft",
              },
            ],
          };
        if (sql.includes("FROM contract_receipts AS record"))
          return {
            rows: [
              {
                contract_id: "contract-open-reverse",
                amount: 40,
                status: "confirmed",
              },
            ],
          };
        if (sql.includes("SELECT * FROM contracts"))
          return { rows: [contract] };
        if (sql.includes("AS contract_total"))
          return {
            rows: [
              {
                contract_total: 100,
                invoice_count: 0,
                invoice_total: 0,
                receipt_total: 0,
                payment_total: 0,
              },
            ],
          };
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback(client),
    );

    await expect(
      reverseContractFinancialRegistration(
        "registration-open-reverse",
        "finance-1",
        "admin",
        "部分回款退回",
        "contract-open-reverse",
      ),
    ).resolves.toMatchObject({ status: "executing" });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "UPDATE contract_invoices SET status = 'reversed'",
      ),
      expect.arrayContaining([["invoice-open-reverse"], "finance-1"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_receipts"),
      expect.arrayContaining([["receipt-open-reverse"], "finance-1"]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_financial_registrations"),
      expect.arrayContaining(["registration-open-reverse", "finance-1"]),
    );
  });

  it("双凭证登记不能绕过登记编号调用旧单条生命周期接口", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM contract_financial_registrations")) {
          return { rows: [{ id: "registration-9" }] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(
      async (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      confirmContractFinancialRecord(
        "invoice",
        "invoice-9",
        "finance-1",
        "admin",
        "contract-9",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "FINANCIAL_REGISTRATION_GROUP_REQUIRED",
    });
  });

  it("数据库安全迁移 active 并建立发票规范化硬去重索引", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    expect(source).toContain(
      "DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed', 'reversed'))",
    );
    expect(source).toContain("confirmed_by TEXT REFERENCES users(id)");
    expect(source).toContain("confirmed_at TEXT");
    expect(source).toContain("WHERE status IN ('active', 'confirmed')");
    expect(source).toContain(
      "confirmed_by = COALESCE(confirmed_by, created_by)",
    );
    expect(source).toContain("idx_contract_invoice_seller_number_unique");
    expect(source).toContain("NORMALIZE(BTRIM(seller), NFKC)");
    const invoiceUniqueIndexStart = source.indexOf(
      "CREATE UNIQUE INDEX idx_contract_invoice_seller_number_unique",
    );
    const invoiceUniqueIndexEnd = source.indexOf(
      "UPDATE contract_rate_configs",
      invoiceUniqueIndexStart,
    );
    const invoiceUniqueIndexSql = source.slice(
      invoiceUniqueIndexStart,
      invoiceUniqueIndexEnd,
    );
    expect(invoiceUniqueIndexSql).toContain("deduplication_exempt = FALSE");
    expect(invoiceUniqueIndexSql).not.toContain("status IN");
    expect(source).toContain("rate_snapshot_json JSONB");
    expect(source).toContain("receipt.rate_snapshot_json IS NULL");
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS contract_financial_ocr_jobs",
    );
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS contract_financial_file_hashes",
    );
    expect(source).toContain("evidence_text_hash TEXT");
    expect(source).toContain("blocking_reasons_json JSONB");
    expect(source).toContain("snapshot_json JSONB");
    expect(source).toContain("failure_kind TEXT");
    expect(source).toContain("retry_count INTEGER NOT NULL DEFAULT 0");
    expect(source).toContain("worker_token TEXT");
    expect(source).toContain("lease_expires_at TEXT");
    expect(source).toContain("electronic_receipt_no TEXT");
    expect(source).toContain("payment_time TEXT");
    expect(source).toContain("transaction_serial_no TEXT");
    expect(source).toContain("payer_account TEXT");
    expect(source).toContain("payee_account TEXT");
    expect(source).toContain("booking_date TEXT");
    expect(source).not.toContain(
      "contract_financial_ocr_jobs (\n      raw_text",
    );
    expect(source).toContain("financial_ocr_job_id TEXT UNIQUE");
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS contract_financial_registrations",
    );
    expect(source).toContain("asset_funding_mode TEXT");
    expect(source).toContain(
      "CREATE TABLE IF NOT EXISTS contract_external_payments",
    );
    expect(source).toContain("'engineering_to_technology'");
    expect(source).toContain("'external_payment'");
    expect(source).toContain("invoice_ocr_job_id TEXT UNIQUE");
    expect(source).toContain("ALTER COLUMN invoice_ocr_job_id DROP NOT NULL");
    expect(source).toContain("ALTER COLUMN invoice_record_id DROP NOT NULL");
    expect(source).toContain(
      "idx_contract_financial_registration_one_draft_per_contract",
    );
    expect(source).toContain("bank_ocr_job_id TEXT UNIQUE");
    expect(source).toContain("bank_business_key_hash TEXT UNIQUE");
    expect(source).toContain("bank_ocr_job_id IS NULL");
    expect(source).toContain("DROP NOT NULL");
    expect(source).toContain("settlement_kind = 'receipt'");
    expect(source).toContain("settlement_kind = 'payment'");
    expect(source).toContain(
      "financial_direction_source = 'contract_category'",
    );
    expect(source).toContain(
      "WHEN COALESCE(contract.declared_category, contract.category) = 'asset'",
    );
    expect(source).toContain(
      "financial_direction_source IN ('contract_category', 'invoice')",
    );
  });

  it("服务启动时幂等补处理旧版已分配部分结算", () => {
    const serverSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/index.ts"),
      "utf8",
    );
    const serviceSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    expect(serverSource).toContain(
      "await backfillLegacyPostedContractFinancialSettlements()",
    );
    expect(serviceSource).toContain(
      "export async function backfillLegacyPostedContractFinancialSettlements",
    );
    expect(serviceSource).toContain('item.job_status !== "consumed"');
    expect(serviceSource).toContain('item.validation_status !== "verified"');
    expect(serviceSource).toContain(
      "COALESCE(receipt.status, payment.status) = 'draft'",
    );
  });

  it("内部划拨模式分离经营支出与最终履约付款", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/services/contractService.ts"),
      "utf8",
    );
    expect(source).toContain("external_payment_total");
    expect(source).toContain("contract_external_payments");
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(routeSource).toContain("contract_invoice_line_items");
    expect(routeSource).toContain(
      "settlement_item.item_kind IN ('payment', 'external_payment')",
    );
    expect(routeSource).toContain(
      "COALESCE(payment.status, external_payment.status) = 'confirmed'",
    );
    expect(routeSource).toContain("insertContractInvoiceLineItems");
    expect(routeSource).toContain("parseContractInvoiceLineItems");
    expect(routeSource).toContain("invoice.status <> 'reversed'");
    expect(routeSource).toContain(
      "Math.floor((allocatedCents * grossCents) / invoiceTotalCents)",
    );
    expect(routeSource).toContain("rentalInvoiceSummary");
    expect(routeSource).not.toContain("INTERNAL_FUNDING_REQUIRED");
    expect(routeSource).not.toContain(
      "existingExternalCents + newExternalCents > fundingTotalCents",
    );
    expect(routeSource).not.toContain("累计科技对外付款不能超过发票合计");
    expect(routeSource).toContain("createExternalPaymentRegistrationShell");
    expect(routeSource).toContain("findOpenFinancialRegistrationId");
    expect(routeSource).toContain("openRegistrationId");
    expect(routeSource).toContain("必须至少提交一张发票或银行回单");
    expect(routeSource).not.toContain("必须至少提交一张银行回单");
    expect(routeSource).toContain("partyValidationInvoices");
    expect(routeSource).toContain("invoiceRows.rows.length");
    expect(routeSource).toContain("external_payment_registration_created");
    expect(routeSource).toContain("remainingInvoiceCents");
    expect(routeSource).toContain("allocatableBankDocuments");
    expect(source).toContain("EXTERNAL_PAYMENT_NOT_CLOSED");
    expect(source).toContain(
      "accountingSettlementKind: FinancialStoredRecordKind",
    );
    expect(source).toContain("item.item_kind === accountingSettlementKind");
    expect(source).toContain(
      'asset_funding_mode === "engineering_to_technology"',
    );
  });

  it("内部划拨模式仅凭发票与科技对外付款即可确认合同核算", async () => {
    const contract = {
      id: "contract-external-accounting",
      root_contract_id: "contract-external-accounting",
      status: "effective",
      category: "asset",
      declared_category: "asset",
      asset_funding_mode: "engineering_to_technology",
      financial_direction: "cost",
      project_id: null,
    };
    const registration = {
      id: "registration-external-accounting",
      contract_id: contract.id,
      settlement_kind: "payment",
      financial_direction: "cost",
      direction_invoice_record_id: "invoice-external-accounting",
      status: "draft",
    };
    const items = [
      {
        item_kind: "invoice",
        ocr_job_id: "invoice-job-external-accounting",
        record_id: "invoice-external-accounting",
      },
      {
        item_kind: "external_payment",
        ocr_job_id: "external-job-external-accounting",
        record_id: "external-external-accounting",
      },
    ];
    const verifiedRecord = (
      direction: "input" | "payment",
      status: "draft" | "confirmed",
    ) => ({
      contract_id: contract.id,
      file_id: `file-${direction}`,
      amount: 100,
      status,
      financial_ocr_job_id: `job-${direction}`,
      financial_ocr_status: "consumed",
      financial_validation_status: "verified",
      financial_document_status: "normal",
      financial_direction: direction,
      financial_can_auto_post: true,
    });
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (
          sql.includes("FROM contract_financial_registrations") &&
          sql.includes("FOR UPDATE")
        )
          return { rows: [registration] };
        if (sql.includes("FROM contract_financial_registration_items"))
          return { rows: items };
        if (sql.includes("COALESCE(root_contract_id, id) AS root_id"))
          return { rows: [{ id: contract.id, root_id: contract.id }] };
        if (sql.includes("SELECT * FROM contracts"))
          return { rows: [contract] };
        if (sql.includes("FROM contract_invoices AS record"))
          return { rows: [verifiedRecord("input", "draft")] };
        if (sql.includes("FROM contract_external_payments AS record"))
          return { rows: [verifiedRecord("payment", "confirmed")] };
        if (sql.includes("FROM contract_financial_registration_matches"))
          return {
            rows: [
              {
                allocated_amount: "100.00",
                settlement_kind: "external_payment",
              },
            ],
          };
        if (sql.includes("AS contract_total"))
          return {
            rows: [
              {
                contract_total: "200",
                invoice_count: 1,
                invoice_total: "100",
                receipt_total: "0",
                payment_total: "0",
                external_payment_total: "100",
              },
            ],
          };
        if (sql.includes("UPDATE contracts SET status = $2"))
          return { rows: [{ ...contract, status: params?.[1] }] };
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementationOnce(async (callback) =>
      callback(client),
    );

    await expect(
      confirmContractFinancialRegistration(
        registration.id,
        "finance-1",
        "admin",
        contract.id,
      ),
    ).resolves.toMatchObject({ status: "executing" });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contract_external_payments"),
      expect.any(Array),
    );
  });

  it("科技对外付款未保存明细同时提供在线预览和删除", () => {
    const source = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "src/components/contracts/ContractFinancialRegistrationPanel.vue",
      ),
      "utf8",
    );
    const externalTableStart = source.indexOf(
      '<div v-if="allExternalCredentials.length"',
    );
    const externalTableEnd = source.indexOf(
      '<div class="table-total">',
      externalTableStart,
    );
    const externalTable = source.slice(externalTableStart, externalTableEnd);

    expect(externalTable).toContain("thumbnail-actions");
    expect(externalTable).toContain("在线预览");
    expect(externalTable).toContain('@click="openCredentialPreview(row)"');
    expect(externalTable).toContain(
      "removeCredentialByKey('external', row.key)",
    );
  });

  it("后端只按服务端验证任务创建草稿并禁用客户端重复绕过", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(source).toContain("recognizeContractFinancialDocument");
    expect(source).toContain("CONTRACT_COMPANY_LEGAL_NAMES");
    expect(source).toContain("contract_financial_file_hashes");
    expect(source).toContain("contract_financial_ocr_jobs");
    expect(source).toContain("FINANCIAL_FILE_HASH_DUPLICATE");
    expect(source).toContain(
      "工程咨询划拨回单必须由北京羽隶工程咨询有限公司付款、北京羽隶科技有限公司收款",
    );
    expect(source).toContain("existing.record_id === null");
    expect(source).toContain("FINANCIAL_CLIENT_VALUE_MISMATCH");
    expect(source).toContain("normalizedTransactionSerialNo");
    expect(source).toContain("normalizedElectronicReceiptNo");
    expect(source).toContain("receipt.transaction_serial_no");
    expect(source).toContain("payment.electronic_receipt_no");
    expect(source).toContain("FINANCIAL_OCR_NOT_VERIFIED");
    expect(source).toContain("markFinancialOcrJobFailed");
    expect(source).toContain("FINANCIAL_OCR_INFRASTRUCTURE_FAILED");
    expect(source).toContain("decideStoredContractFinancialOcrReuse");
    expect(source).toContain('reuseDecision === "retry_strategy_upgrade"');
    expect(source).toContain('"recognition_strategy_upgrade"');
    expect(source).not.toContain("companyBankAccountConfigurationCompleted");
    expect(source).not.toContain(
      '"company_bank_account_configuration_completed"',
    );
    expect(source).toContain("financial_ocr.engine_version");
    expect(source).toContain("financial_ocr.parser_version");
    expect(source).toContain("contractFinancialOcrEngineVersion(kind)");
    expect(source).toContain("FINANCIAL_OCR_IN_PROGRESS");
    expect(source).toContain("retryReason:");
    expect(source).toContain("AND worker_token = $17");
    expect(source).toContain(
      "SET status = 'failed', validation_status = 'failed'",
    );
    expect(source).toContain("blockingReasonCodes: [failureReason.code]");
    expect(source).toContain("DUPLICATE_CONTRACT_INVOICE");
    expect(source).toContain("submittedInvoiceJobIds");
    expect(source).toContain("orderedIdentities");
    expect(source).toContain("snapshot_json #>> '{fields,seller}'");
    expect(source).toContain("已在合同财务登记中上传或登记，请勿重复上传");
    expect(source).toContain("idx_contract_invoice_seller_number_unique");
    expect(source).toContain("status IN ('draft', 'confirmed', 'reversed')");
    expect(source).toContain("DUPLICATE_CONTRACT_BANK_DOCUMENT");
    expect(source).toContain("findContractBankReceiptNumberDuplicate");
    expect(source).toContain("contract-bank-receipt-no:");
    expect(source).toContain(
      "snapshot_json #>> '{fields,electronicReceiptNo}'",
    );
    expect(source).toContain("bankReceiptNumberKeys");
    expect(source).toContain("已上传或登记，禁止重复录入");
    expect(source).toContain("appendExternalPaymentJobs");
    expect(source).toContain("contract_external_payments");
    expect(source).toContain("ASSET_FUNDING_MODE_REQUIRED");
    expect(source).toContain('"FINANCIAL_REGISTRATION_PAIR_REQUIRED"');
    expect(source).toContain("assertMainContractFinancialTarget");
    expect(source).toContain(
      "CASE WHEN $5 = 'asset' THEN 'cost' ELSE 'income' END",
    );
    expect(source).toContain('"FINANCIAL_REGISTRATION_MAIN_CONTRACT_ONLY"');
    expect(source).toContain("财务登记统一归集至主合同，请在所属主合同中操作");
    expect(source).toContain('"FINANCIAL_REGISTRATION_PARTY_MISMATCH"');
    expect(source).toContain("bankBusinessHashes");
    expect(source).toContain("uniqueInvoiceJobIds.some");
    expect(source).toContain('"FINANCIAL_REGISTRATION_AMOUNT_MISMATCH"');
    expect(source).toContain("bankTotalCents > invoiceTotalCents");
    expect(source).toContain("contract_financial_registration_items");
    expect(source).toContain("contract_financial_registration_matches");
    expect(source).toContain("allocatePartialContractFinancialAmounts");
    expect(source).toContain("existingAllocatedByInvoiceItemId");
    expect(source).toContain("allocateAdditionalContractFinancialAmounts");
    expect(source).toContain(
      "existingAllocatedTotalCents + bankTotalCents > invoiceTotalCents",
    );
    expect(source).toContain("bank_ocr_job_id = COALESCE(bank_ocr_job_id, $2)");
    expect(source).not.toContain(
      'registration.status !== "draft" || registration.bank_ocr_job_id',
    );
    expect(source).toContain("invoice_item_id");
    expect(source).toContain("settlement_item_id");
    expect(source).toContain("allocated_amount");
    expect(source).toContain("return db.transaction(async (client) => {");
    expect(source).toContain("WHERE id = ANY($1::text[])");
    expect(source).toContain("INSERT INTO contract_financial_registrations");
    expect(source).toContain(
      "SET status = 'consumed', record_id = $2, consumed_at = $3",
    );
    expect(source).toContain('"/:id/financial-registrations"');
    expect(source).toContain(
      '"/:id/financial-registrations/:registrationId/confirm"',
    );
    expect(source).toContain(
      '"/:id/financial-registrations/:registrationId/reverse"',
    );
    expect(source).toContain("rejectUnpairedFinancialRecord");
    expect(source).toContain("FINANCIAL_RECORD_CONTRACT_STATUS_FORBIDDEN");
    expect(source).not.toContain("confirmDuplicate");
    expect(source).not.toContain(
      "req.body[dateField] || req.body.recordDate || currentShanghaiDate()",
    );
    expect(source).toContain('source: "server_verified_financial_ocr"');
    expect(source).toContain("/:recordId/confirm");
    expect(source).toContain("deleteFinancialDraft(kind)");
  });

  it("车辆租赁已验证免税发票允许空税额贯穿全部登记路径", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const databaseSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );

    expect(routeSource).toContain("function parseVerifiedInvoiceTaxAmount");
    expect(routeSource).toContain("if (allowEmptyTaxAmount) return null");
    expect(routeSource.match(/parseVerifiedInvoiceTaxAmount\(/g)).toHaveLength(
      4,
    );
    expect(
      routeSource.match(/isVehicleRentalContract\(target\)/g),
    ).toHaveLength(3);
    expect(routeSource).toMatch(
      /document\.taxAmount !== null &&\s*document\.taxAmount > document\.amount/u,
    );
    expect(databaseSource).toContain(
      "tax_amount NUMERIC(18,2) CHECK(tax_amount IS NULL OR tax_amount >= 0)",
    );
    expect(databaseSource).toContain(
      "ALTER TABLE contract_invoices ALTER COLUMN tax_amount DROP NOT NULL",
    );
    expect(databaseSource).toContain(
      "ALTER TABLE contract_invoices ALTER COLUMN tax_amount DROP DEFAULT",
    );
  });
});
