import fs from "node:fs";
import path from "node:path";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("报销付款事实与月报数据库完整性", () => {
  const reimbursementRouteSource = source("server/routes/reimbursement.ts");
  const fileRouteSource = source("server/routes/files.ts");
  const fileUrlSource = source("src/utils/file.ts");
  const bankReceiptRouteSource = source("server/routes/bank-receipts.ts");
  const bankReceiptProcessorSource = source(
    "server/services/bankReceiptProcessor.ts",
  );
  const paymentProofIdentitySource = source(
    "server/utils/payment-proof-identity.ts",
  );
  const databaseSource = source("server/db/index.ts");

  it("仅允许本人删除草稿或已驳回报销，并在事务内锁定状态", () => {
    const deleteStart = reimbursementRouteSource.indexOf(
      "router.delete('/:id', requireAuth",
    );
    const restoreStart = reimbursementRouteSource.indexOf(
      "router.post('/:id/restore'",
      deleteStart,
    );
    const deleteHandler = reimbursementRouteSource.slice(
      deleteStart,
      restoreStart,
    );

    expect(deleteStart).toBeGreaterThan(-1);
    expect(restoreStart).toBeGreaterThan(deleteStart);
    expect(deleteHandler).toContain("await db.transaction(async (client)");
    expect(deleteHandler).toContain("AND user_id = ?");
    expect(deleteHandler).toContain("FOR UPDATE");
    expect(deleteHandler).toContain("['draft', 'rejected']");
    expect(deleteHandler).toContain("REIMBURSEMENT_STATUS_NOT_DELETABLE");
    expect(deleteHandler).toContain("new RouteError(\n          409");
    expect(deleteHandler).not.toContain("SET is_deleted = TRUE");
  });

  it("确认付款不提前定归属日，单笔和批量提交均写入回单交易日期", () => {
    const confirmPaymentStart = reimbursementRouteSource.indexOf(
      "router.post('/:id/confirm-payment'",
    );
    const singleProofStart = reimbursementRouteSource.indexOf(
      "router.post('/:id/complete-with-proof'",
    );
    const batchProofStart = reimbursementRouteSource.indexOf(
      "'/payment-batch/:batchId/complete'",
    );

    expect(
      reimbursementRouteSource.slice(confirmPaymentStart, singleProofStart),
    ).toContain("payment_business_date = NULL");
    expect(
      reimbursementRouteSource.slice(singleProofStart, batchProofStart),
    ).toContain("resolveConsistentPaymentProofTransactionDate");
    expect(
      reimbursementRouteSource.slice(singleProofStart, batchProofStart),
    ).toContain("payment_business_date = ?");
    expect(batchProofStart).toBeGreaterThan(singleProofStart);
    expect(reimbursementRouteSource.slice(batchProofStart)).toContain(
      "resolveConsistentPaymentProofTransactionDate",
    );
    expect(reimbursementRouteSource.slice(batchProofStart)).not.toContain(
      "payment_business_date = COALESCE(payment_business_date, ?)",
    );
  });

  it("审批中心整包回单自动匹配和手工认领共用原子事务并写真实交易日期", () => {
    expect(bankReceiptProcessorSource).toContain(
      "isValidBankBusinessDate(ocr.transactionDate)",
    );
    expect(bankReceiptProcessorSource).toContain(
      "payment_business_date = $4::date",
    );
    expect(bankReceiptProcessorSource).toContain(
      "transactionDate: ocr.transactionDate",
    );
    expect(bankReceiptProcessorSource).toContain(
      "return db.transaction(async (client)",
    );
    expect(bankReceiptProcessorSource).toContain("FOR UPDATE OF r");
    expect(bankReceiptProcessorSource).toContain(
      "INSERT INTO payment_proof_hashes",
    );
    expect(bankReceiptProcessorSource).toContain("INSERT INTO payment_batches");
    expect(bankReceiptRouteSource).toContain("persistBankReceiptTransaction({");
    expect(bankReceiptRouteSource).toContain("mode: 'claim'");
    expect(bankReceiptRouteSource).not.toContain(
      "UPDATE reimbursements SET status = 'payment_uploaded'",
    );
  });

  it("三条付款路径共用规范化回单身份锁并执行条件状态更新", () => {
    const singleStart = reimbursementRouteSource.indexOf(
      "router.post('/:id/complete-with-proof'",
    );
    const batchCreateStart = reimbursementRouteSource.indexOf(
      "router.post('/payment-batch/create'",
      singleStart,
    );
    const batchCompleteStart = reimbursementRouteSource.indexOf(
      "'/payment-batch/:batchId/complete'",
      batchCreateStart,
    );
    const singleSection = reimbursementRouteSource.slice(
      singleStart,
      batchCreateStart,
    );
    const batchCreateSection = reimbursementRouteSource.slice(
      batchCreateStart,
      batchCompleteStart,
    );
    const batchCompleteSection =
      reimbursementRouteSource.slice(batchCompleteStart);

    expect(paymentProofIdentitySource).toContain(
      "normalizePaymentProofNo(value: unknown)",
    );
    expect(paymentProofIdentitySource).toContain("lockPaymentProofIdentities");
    expect(paymentProofIdentitySource).toContain("reimbursement-proof-file:");
    expect(paymentProofIdentitySource).toContain("reimbursement-proof-no:");
    expect(bankReceiptProcessorSource).toContain(
      'from "../utils/payment-proof-identity.js"',
    );
    expect(bankReceiptProcessorSource).not.toContain(
      "function normalizeBankProofNo",
    );
    expect(bankReceiptProcessorSource).toContain(
      "payment_batch_id IS NOT DISTINCT FROM $7::text",
    );

    for (const section of [singleSection, batchCompleteSection]) {
      expect(section).toContain("lockPaymentProofIdentities(");
      expect(section).toContain("findExistingPaymentProofIdentity(");
      expect(section).toContain("FOR UPDATE");
      expect(section).toContain("movedPaymentProofPaths");
      expect(section).toContain("fs.rmSync(movedPath, { force: true })");
      expect(section).toContain("commitOutcomeUncertain");
    }
    expect(singleSection).toContain("AND status = 'paid'");
    expect(singleSection).toContain("AND payment_batch_id IS NULL");
    expect(batchCompleteSection).toContain(
      "WHERE id = ? AND status = 'pending'",
    );
    expect(batchCompleteSection).toContain("AND status = 'approved'");
    expect(batchCompleteSection).toContain("AND payment_batch_id = ?");
    expect(batchCreateSection).toContain("FOR UPDATE");
    expect(batchCreateSection).toContain(
      "payment_batch_id IS NOT DISTINCT FROM ?",
    );
  });

  it("数据库规范化旧回单号并以同口径唯一索引失败关闭冲突", () => {
    expect(databaseSource).toContain("PAYMENT_PROOF_NORMALIZED_CONFLICT");
    expect(databaseSource).toContain("throw error");
    expect(databaseSource).toContain("uq_payment_proof_no_normalized");
    expect(databaseSource).toContain("NORMALIZE(BTRIM(proof_no), NFKC)");
    expect(databaseSource).toContain("'[^A-Za-z0-9]+'");
    expect(databaseSource).toContain("HAVING COUNT(*) > 1");
  });

  it("月底银行裁片自动挂载后可由报销申请人受控预览", () => {
    expect(fileRouteSource).toContain('router.get("/monthly-bank-proofs/*"');
    expect(fileRouteSource).toContain("payment_proof_path LIKE ?");
    expect(fileRouteSource).toContain("proof.user_id !== userId");
    expect(fileRouteSource).toContain("uploads/monthly-financial-bank");
    expect(fileUrlSource).toContain("uploads\\/monthly-financial-bank");
    expect(fileUrlSource).toContain("/api/files/monthly-bank-proofs/");
  });

  it("历史付款日期不按管理员时间臆测，新付款由约束要求回单交易日期", () => {
    expect(databaseSource).toContain(
      "ADD COLUMN IF NOT EXISTS payment_business_date DATE",
    );
    expect(databaseSource).not.toContain(
      "CREATE OR REPLACE FUNCTION reimbursement_business_date_in_shanghai",
    );
    expect(databaseSource).toContain(
      "DROP TRIGGER IF EXISTS trg_reimbursements_payment_business_date",
    );
    expect(databaseSource).toContain(
      "DROP TRIGGER IF EXISTS trg_payment_batches_business_date",
    );
    expect(databaseSource).not.toContain(
      "SET payment_business_date = reimbursement_business_date_in_shanghai",
    );
    expect(databaseSource).toContain(
      "reimbursements_payment_business_date_check",
    );
    expect(databaseSource).toContain(
      "status NOT IN ('payment_uploaded', 'completed')",
    );
    expect(databaseSource).toContain(
      "VALIDATE CONSTRAINT reimbursements_payment_business_date_check",
    );
    expect(databaseSource).toContain(
      "idx_reimbursements_payment_business_date",
    );
  });

  it("数据库约束真实日期、四账户结构和分类账户方向组合", () => {
    expect(databaseSource).toContain(
      "monthly_financial_date_is_valid(value TEXT)",
    );
    expect(databaseSource).toContain("value::DATE::TEXT = value");
    expect(databaseSource).toContain(
      "monthly_financial_account_amounts_are_valid(value JSONB)",
    );
    expect(databaseSource).toContain(
      "value - 'general' - 'business' - 'welfare_one' - 'welfare_two'",
    );
    expect(databaseSource).toContain(
      "monthly_financial_manual_rule_is_valid(category, account_code, direction)",
    );
    expect(databaseSource).toContain(
      "monthly_financial_reports_opening_balances_check",
    );
    expect(databaseSource).toContain(
      "monthly_financial_reports_closing_balances_check",
    );
    expect(databaseSource).toContain(
      "VALIDATE CONSTRAINT monthly_financial_manual_items_date_check",
    );
    expect(databaseSource).toContain(
      "idx_contract_receipts_monthly_confirmed_date",
    );
    expect(databaseSource).toContain(
      "idx_contract_payments_monthly_confirmed_date",
    );
  });
});
