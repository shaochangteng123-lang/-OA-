/** @jest-environment node */

import type { PoolClient } from "pg";

jest.mock("nanoid", () => ({ nanoid: () => "monthly-bridge-atomic-test-id" }));

jest.mock("../server/services/monthlyFinancialContractBridge", () => ({
  bridgeMonthlyBankTransactionGroupsToContractRegistrations: jest.fn(
    async () => [],
  ),
  bridgeMonthlyBankTransactionToContractRegistration: jest.fn(async () => ({
    status: "created",
    changed: true,
    transactionId: "bank-transaction-1",
    contractId: "contract-1",
    registrationId: "registration-1",
    receiptRecordId: "receipt-1",
    registrationConfirmed: true,
    warnings: [],
  })),
  cleanupMonthlyContractBridgeGroupFiles: jest.fn(async () => undefined),
}));

import { bridgeMonthlyBankTransactionToContractRegistration } from "../server/services/monthlyFinancialContractBridge";
import {
  bridgeMonthlyBankTransactionGroupsToContractRegistrations,
  cleanupMonthlyContractBridgeGroupFiles,
} from "../server/services/monthlyFinancialContractBridge";
import { reconcileMonthlyContractBankTransactions } from "../server/services/monthlyFinancialBankLinker";

describe("月报合同桥接与重新挂载原子性", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (
      bridgeMonthlyBankTransactionGroupsToContractRegistrations as jest.Mock
    ).mockResolvedValue([]);
  });

  it("桥接写入后若完整字段重链仍失败则抛错，使外层事务整体回滚", async () => {
    const sqlHistory: string[] = [];
    const query = jest.fn(async (sqlValue: string) => {
      const sql = String(sqlValue);
      sqlHistory.push(sql);
      if (
        sql.includes("FROM monthly_financial_bank_transactions transaction") &&
        sql.includes("transaction.report_month = $1")
      ) {
        return {
          rows: [
            {
              id: "bank-transaction-1",
              category: "main_income",
              direction: "inflow",
              recognition_status: "review_required",
              include_in_report: false,
              warnings_json: [],
              current_file_id: "bank-file-1",
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.includes("FROM monthly_financial_bank_transactions") &&
        sql.includes("WHERE id = $1")
      ) {
        return {
          rows: [
            {
              id: "bank-transaction-1",
              account_code: "general",
              electronic_receipt_no: "AB-001",
              normalized_electronic_receipt_no: "AB001",
              transaction_date: "2026-06-08",
              amount: "50000.00",
              direction: "inflow",
              payer_account: "212300490",
              payee_account: "0200303519000018418",
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.includes("FROM contract_receipts record") ||
        sql.includes("FROM contract_payments record") ||
        sql.includes("FROM contract_external_payments record") ||
        sql.includes("FROM payment_proof_hashes proof") ||
        sql.includes("FROM human_cost_receipt_items item")
      ) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`测试未处理的数据库语句：${sql.slice(0, 120)}`);
    });
    const client = { query } as unknown as PoolClient;

    await expect(
      reconcileMonthlyContractBankTransactions(
        client,
        "2026-06",
        "admin-1",
        "2026-08-25T12:00:00.000Z",
        "admin",
      ),
    ).rejects.toThrow("完整字段复核未能建立唯一挂载");

    expect(
      bridgeMonthlyBankTransactionToContractRegistration,
    ).toHaveBeenCalledTimes(1);
    expect(cleanupMonthlyContractBridgeGroupFiles).toHaveBeenCalledWith(
      expect.objectContaining({ receiptRecordId: "receipt-1" }),
    );
    expect(
      sqlHistory.some((sql) =>
        sql.includes("UPDATE monthly_financial_bank_transactions"),
      ),
    ).toBe(false);
  });

  it("多张回单桥接后任一逐张重链失败时清理组文件并抛错回滚", async () => {
    const groupResult = {
      status: "created" as const,
      changed: true,
      transactionIds: ["bank-transaction-1", "bank-transaction-2"],
      contractId: "contract-1",
      registrationId: "registration-1",
      receipts: [
        {
          transactionId: "bank-transaction-1",
          receiptRecordId: "receipt-1",
        },
        {
          transactionId: "bank-transaction-2",
          receiptRecordId: "receipt-2",
        },
      ],
      registrationConfirmed: true,
      warnings: [],
      createdEvidencePaths: ["/tmp/group-receipt-1.jpg"],
    };
    (
      bridgeMonthlyBankTransactionGroupsToContractRegistrations as jest.Mock
    ).mockResolvedValueOnce([groupResult]);
    const query = jest.fn(async (sqlValue: string, params: unknown[] = []) => {
      const sql = String(sqlValue);
      if (
        sql.includes("FROM monthly_financial_bank_transactions transaction") &&
        sql.includes("transaction.report_month = $1")
      ) {
        return {
          rows: [
            {
              id: "bank-transaction-1",
              category: "main_income",
              direction: "inflow",
              recognition_status: "review_required",
              include_in_report: false,
              warnings_json: [],
              current_file_id: "bank-file-1",
            },
            {
              id: "bank-transaction-2",
              category: "main_income",
              direction: "inflow",
              recognition_status: "review_required",
              include_in_report: false,
              warnings_json: [],
              current_file_id: "bank-file-1",
            },
          ],
          rowCount: 2,
        };
      }
      if (
        sql.includes("FROM monthly_financial_bank_transactions") &&
        sql.includes("WHERE id = $1")
      ) {
        const suffix = params[0] === "bank-transaction-1" ? "001" : "002";
        return {
          rows: [
            {
              id: params[0],
              account_code: "general",
              electronic_receipt_no: `AB-${suffix}`,
              normalized_electronic_receipt_no: `AB${suffix}`,
              transaction_date: "2026-06-08",
              amount: "50000.00",
              direction: "inflow",
              payer_account: "212300490",
              payee_account: "0200303519000018418",
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.includes("FROM contract_receipts record") ||
        sql.includes("FROM contract_payments record") ||
        sql.includes("FROM contract_external_payments record") ||
        sql.includes("FROM payment_proof_hashes proof") ||
        sql.includes("FROM human_cost_receipt_items item")
      ) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`测试未处理的数据库语句：${sql.slice(0, 120)}`);
    });
    const client = { query } as unknown as PoolClient;

    await expect(
      reconcileMonthlyContractBankTransactions(
        client,
        "2026-06",
        "admin-1",
        "2026-08-26T12:00:00.000Z",
        "admin",
      ),
    ).rejects.toThrow("其中一张未能按完整字段建立唯一挂载");

    expect(cleanupMonthlyContractBridgeGroupFiles).toHaveBeenCalledWith(
      groupResult,
    );
    expect(
      bridgeMonthlyBankTransactionToContractRegistration,
    ).not.toHaveBeenCalled();
  });

  it("组桥接及逐张重链成功后后续交易更新失败仍清理全部组文件", async () => {
    const groupResult = {
      status: "created" as const,
      changed: true,
      transactionIds: ["bank-transaction-1", "bank-transaction-2"],
      contractId: "contract-1",
      registrationId: "registration-1",
      receipts: [
        {
          transactionId: "bank-transaction-1",
          receiptRecordId: "receipt-1",
        },
        {
          transactionId: "bank-transaction-2",
          receiptRecordId: "receipt-2",
        },
      ],
      registrationConfirmed: true,
      warnings: [],
      createdEvidencePaths: [
        "/tmp/group-receipt-1.jpg",
        "/tmp/group-receipt-2.jpg",
      ],
    };
    (
      bridgeMonthlyBankTransactionGroupsToContractRegistrations as jest.Mock
    ).mockResolvedValueOnce([groupResult]);
    const receiptQueryCount = new Map<string, number>();
    const query = jest.fn(async (sqlValue: string, params: unknown[] = []) => {
      const sql = String(sqlValue);
      if (
        sql.includes("FROM monthly_financial_bank_transactions transaction") &&
        sql.includes("transaction.report_month = $1")
      ) {
        return {
          rows: [1, 2].map((index) => ({
            id: `bank-transaction-${index}`,
            category: "main_income",
            direction: "inflow",
            recognition_status: "review_required",
            include_in_report: false,
            warnings_json: [],
            current_file_id: "bank-file-1",
          })),
          rowCount: 2,
        };
      }
      if (
        sql.includes("FROM monthly_financial_bank_transactions") &&
        sql.includes("WHERE id = $1")
      ) {
        const index = params[0] === "bank-transaction-1" ? 1 : 2;
        return {
          rows: [
            {
              id: params[0],
              account_code: "general",
              electronic_receipt_no: `AB-00${index}`,
              normalized_electronic_receipt_no: `AB00${index}`,
              transaction_date: "2026-06-08",
              amount: "50000.00",
              direction: "inflow",
              payer_account: "212300490",
              payee_account: "0200303519000018418",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM contract_receipts record")) {
        const receiptNo = String(params[0]);
        const count = (receiptQueryCount.get(receiptNo) || 0) + 1;
        receiptQueryCount.set(receiptNo, count);
        if (count === 1) return { rows: [], rowCount: 0 };
        const index = receiptNo.endsWith("1") ? 1 : 2;
        return {
          rows: [
            {
              id: `receipt-${index}`,
              file_id: `file-${index}`,
              electronic_receipt_no: `AB-00${index}`,
              transaction_date: "2026-06-08",
              amount: "50000.00",
              payer_account: "212300490",
              payee_account: "0200303519000018418",
              status: "confirmed",
              contract_category: "main_business",
              financial_recognition_method: "monthly_bank_transaction",
            },
          ],
          rowCount: 1,
        };
      }
      if (
        sql.includes("FROM contract_payments record") ||
        sql.includes("FROM contract_external_payments record") ||
        sql.includes("FROM payment_proof_hashes proof") ||
        sql.includes("FROM human_cost_receipt_items item")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM monthly_financial_bank_transaction_links")) {
        return { rows: [], rowCount: 0 };
      }
      if (
        sql.includes("INSERT INTO monthly_financial_bank_transaction_links")
      ) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE monthly_financial_bank_transactions")) {
        throw new Error("模拟月报交易更新失败");
      }
      throw new Error(`测试未处理的数据库语句：${sql.slice(0, 120)}`);
    });
    const client = { query } as unknown as PoolClient;

    await expect(
      reconcileMonthlyContractBankTransactions(
        client,
        "2026-06",
        "admin-1",
        "2026-08-26T12:00:00.000Z",
        "admin",
      ),
    ).rejects.toThrow("模拟月报交易更新失败");

    expect(cleanupMonthlyContractBridgeGroupFiles).toHaveBeenCalledWith(
      groupResult,
    );
  });
});
