import fs from "node:fs";
import path from "node:path";

describe("租赁押金退回回单后端闭环", () => {
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const databaseSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/db/index.ts"),
    "utf8",
  );

  it("退款与实际退工程均通过隔离识别任务提交不可复用原件", () => {
    expect(databaseSource).toContain(
      "CREATE TABLE IF NOT EXISTS contract_deposit_settlement_receipts",
    );
    expect(databaseSource).toContain(
      "receipt_kind IN ('deposit_refund', 'engineering_return')",
    );
    expect(databaseSource).toContain(
      "file_hash TEXT NOT NULL UNIQUE CHECK(file_hash ~ '^[0-9a-f]{64}$')",
    );
    expect(databaseSource).toContain("uq_contract_deposit_refund_receipt");
    expect(databaseSource).toContain("business_purpose TEXT");
    expect(databaseSource).toContain("financial_ocr_job_id TEXT UNIQUE");
    expect(routeSource).toContain('"/:id/deposit/return-receipts/recognize"');
    expect(routeSource).toContain("CONTRACT_DEPOSIT_REFUND_OCR_JOB_REQUIRED");
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_ENGINEERING_RETURN_OCR_JOB_REQUIRED",
    );
    expect(routeSource).toContain(
      "insertContractDepositSettlementReceipt(client",
    );
    expect(routeSource).toContain('kind: "deposit_refund"');
    expect(routeSource).toContain('kind: "engineering_return"');
    expect(routeSource).toContain("storedUploadFromDepositReturnJob");
  });

  it("押金快照分别返回退款回单和分次退工程回单", () => {
    expect(routeSource).toContain("refundReceipt:");
    expect(routeSource).toContain("engineeringReturnReceipts:");
    expect(routeSource).toContain("transactionDate: receipt.transaction_date");
    expect(routeSource).toContain(
      "uploadedByName: receipt.uploaded_by_name || null",
    );
  });

  it("历史退款只补传原结算金额和日期对应的回单", () => {
    const routeStart = routeSource.indexOf(
      '"/:id/deposit/settlements/:settlementId/refund-receipt"',
    );
    const routeEnd = routeSource.indexOf(
      '"/:id/deposit/settlements/:settlementId/receipts/:receiptId"',
      routeStart,
    );
    const refundReceiptSource = routeSource.slice(routeStart, routeEnd);

    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(refundReceiptSource).toContain("requireFinance");
    expect(refundReceiptSource).not.toContain("uploadSingle");
    expect(refundReceiptSource).toContain(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_FIELDS_FORBIDDEN",
    );
    expect(refundReceiptSource).toContain(
      "CONTRACT_DEPOSIT_REFUND_OCR_JOB_REQUIRED",
    );
    expect(routeSource).toContain('settlement.settlement_type !== "refund"');
    expect(routeSource).toContain(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_ALREADY_EXISTS",
    );
    expect(refundReceiptSource).toContain("amount: Number(settlement.amount)");
    expect(refundReceiptSource).toContain(
      "transactionDate: settlement.settlement_date",
    );
    expect(refundReceiptSource).toContain(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_HISTORY_MISMATCH",
    );
    expect(refundReceiptSource).toContain(
      "contract_deposit_refund_receipt_attached",
    );
    expect(refundReceiptSource).toContain(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_COMMIT_OUTCOME_UNCERTAIN",
    );
    expect(refundReceiptSource).not.toContain("cleanupUploadedFile(req.file)");
    expect(refundReceiptSource).not.toContain("UPDATE contract_deposits");
    expect(refundReceiptSource).not.toContain(
      "UPDATE contract_deposit_settlements",
    );
  });

  it("删除回单时保护下游并按剩余退工程证据重算累计值", () => {
    const routeStart = routeSource.indexOf(
      '"/:id/deposit/settlements/:settlementId/receipts/:receiptId"',
    );
    const routeEnd = routeSource.indexOf(
      '"/:id/deposit/settlements/:settlementId/receipts/:receiptId/file"',
      routeStart,
    );
    const deleteSource = routeSource.slice(routeStart, routeEnd);

    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(deleteSource).toContain("requireFinance");
    expect(deleteSource.match(/FOR UPDATE/gu)).toHaveLength(4);
    expect(deleteSource).toContain(
      "CONTRACT_DEPOSIT_REFUND_RECEIPT_HAS_ENGINEERING_RETURN",
    );
    expect(deleteSource).toContain(
      "DELETE FROM contract_deposit_settlement_receipts",
    );
    expect(deleteSource).toContain("COALESCE(SUM(amount),0)");
    expect(deleteSource).toContain("ARRAY_AGG(transaction_date ORDER BY");
    expect(deleteSource).toContain("ARRAY_AGG(uploaded_by ORDER BY");
    expect(deleteSource).toContain("engineering_returned_amount=$2");
    expect(deleteSource).toContain("engineering_returned_at=$3");
    expect(deleteSource).toContain("engineering_returned_by=$4");
    expect(deleteSource).toContain("engineering_return_note=NULL");
    expect(deleteSource).toContain(
      "contract_deposit_settlement_receipt_deleted",
    );
    expect(deleteSource).toContain("engineeringReturnedAmountBefore");
    expect(deleteSource).toContain("engineeringReturnedAmountAfter");
    expect(deleteSource).toContain(
      "cleanupStoredFinancialFiles([result.removed.file_path]",
    );
    expect(deleteSource).toContain(
      "DELETE FROM contract_financial_file_hashes",
    );
    expect(deleteSource).toContain("DELETE FROM contract_financial_ocr_jobs");
    expect(deleteSource).toContain("DELETE FROM contract_files");
    expect(deleteSource).toContain(
      "CONTRACT_DEPOSIT_RECEIPT_DELETE_COMMIT_OUTCOME_UNCERTAIN",
    );
    expect(deleteSource.indexOf("committed = true")).toBeLessThan(
      deleteSource.indexOf(
        "cleanupStoredFinancialFiles([result.removed.file_path]",
      ),
    );
  });

  it("受控预览按回单、结算和合同三个编号精确绑定并写审计", () => {
    const previewStart = routeSource.indexOf(
      '"/:id/deposit/settlements/:settlementId/receipts/:receiptId/file"',
    );
    const previewEnd = routeSource.indexOf(
      "function purposeDetailsRecordColumn",
      previewStart,
    );
    const previewSource = routeSource.slice(previewStart, previewEnd);
    const query = previewSource.match(
      /await db\.get<ContractDepositSettlementReceiptRow>\(\s*`([\s\S]*?)`,([\s\S]*?)\n\s*\);/u,
    );

    expect(previewStart).toBeGreaterThanOrEqual(0);
    expect(query).not.toBeNull();
    expect(query?.[1].match(/\?/gu)).toHaveLength(3);
    expect(query?.[2].match(/req\.params\./gu)).toHaveLength(3);
    expect(previewSource).toContain("requireFinance");
    expect(previewSource).toContain("validateFilePath(receipt.file_path)");
    expect(previewSource).toContain('"X-Content-Type-Options", "nosniff"');
    expect(previewSource).toContain(
      "contract_deposit_settlement_receipt_previewed",
    );
  });
});
