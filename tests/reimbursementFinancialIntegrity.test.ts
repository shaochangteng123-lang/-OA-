import fs from "node:fs";
import path from "node:path";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("报销付款事实与月报数据库完整性", () => {
  const reimbursementRouteSource = source("server/routes/reimbursement.ts");
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
