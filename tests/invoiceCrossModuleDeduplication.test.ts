import fs from "fs";
import path from "path";

import {
  findContractFinancialInvoiceUsage,
  findReimbursementInvoiceUsage,
  lockCrossModuleInvoiceNumbers,
  normalizeCrossModuleInvoiceNumber,
} from "../server/services/invoiceCrossModuleDeduplication";

describe("报销发票与合同财务发票跨模块查重", () => {
  it("发票号码按 NFKC 规范化并去除空白", () => {
    expect(normalizeCrossModuleInvoiceNumber(" ＡＢ-123 \n")).toBe("AB123");
  });

  it("多发票号码去重后按字典序取得全局咨询锁", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const client = { query } as any;

    await expect(
      lockCrossModuleInvoiceNumbers(client, ["FP-002", "FP-001", "FP-002"]),
    ).resolves.toEqual(["FP001", "FP002"]);
    expect(query.mock.calls.map((call) => call[1])).toEqual([
      ["FP001"],
      ["FP002"],
    ]);
    expect(query.mock.calls[0][0]).toContain("global-invoice-number:");
  });

  it("同时查询合同事实与已验证任务", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          source: "contract_financial",
          record_id: "contract-invoice-1",
          owner_id: "contract-1",
        },
      ],
    });

    await expect(
      findContractFinancialInvoiceUsage({ query } as any, "fp-001"),
    ).resolves.toEqual({
      source: "contract_financial",
      recordId: "contract-invoice-1",
      ownerId: "contract-1",
    });
    expect(query.mock.calls[0][0]).toContain("contract_invoices");
    expect(query.mock.calls[0][0]).toContain("contract_financial_ocr_jobs");
  });

  it("同时查询报销普通发票与独立核减发票", async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          source: "reimbursement",
          usage_kind: "deduction",
          record_id: "reimbursement-invoice-1",
          owner_id: "reimbursement-1",
          applicant_name: "刘行",
        },
      ],
    });

    await expect(
      findReimbursementInvoiceUsage({ query } as any, "fp-001"),
    ).resolves.toEqual({
      source: "reimbursement",
      usageKind: "deduction",
      recordId: "reimbursement-invoice-1",
      ownerId: "reimbursement-1",
      applicantName: "刘行",
    });
    expect(query.mock.calls[0][0]).toContain("reimbursement_invoices");
    expect(query.mock.calls[0][0]).toContain(
      "reimbursement_deduction_invoices",
    );
    expect(query.mock.calls[0][0]).toContain("NOT LIKE 'receipt-%'");
    expect(query.mock.calls[0][0]).toContain(
      "COALESCE(invoice.is_deduction, 0) = 1",
    );
    expect(query.mock.calls[0][0]).toContain("AS usage_kind");
    expect(query.mock.calls[0][0]).toContain(
      "reimbursement.applicant_name",
    );
  });

  it("报销预查、上传、创建、编辑、恢复和核减写入共用跨模块门禁", () => {
    const reimbursementSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/reimbursement.ts"),
      "utf8",
    );
    const contractSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(
      reimbursementSource.match(/assertInvoicesNotUsedInContractFinancial/g)
        ?.length,
    ).toBeGreaterThanOrEqual(5);
    expect(reimbursementSource).toContain(
      "contractFinancialInvoiceUsageExists(ocrResult.invoiceNumber)",
    );
    expect(reimbursementSource).toContain(
      "CROSS_MODULE_INVOICE_DUPLICATE_CODE",
    );
    expect(reimbursementSource).toContain(
      "reimbursementInvoiceNumbersForCrossModule",
    );
    expect(reimbursementSource).toContain("verifiedInvoiceNumber");
    expect(contractSource).toContain("findReimbursementInvoiceUsage");
    expect(contractSource).toContain("lockCrossModuleInvoiceNumbers");
    expect(contractSource).toContain("INVOICE_ALREADY_USED_IN_OTHER_MODULE");
  });
});
