import fs from "node:fs";
import path from "node:path";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("董事长福利1报销后端契约", () => {
  const databaseSource = source("server/db/index.ts");
  const reimbursementSource = source("server/routes/reimbursement.ts");
  const approvalSource = source("server/routes/approval.ts");
  const scopeSource = source("server/routes/reimbursement-scope.ts");
  const userSource = source("server/routes/users.ts");
  const bankReceiptSource = source("server/routes/bank-receipts.ts");

  it("数据库增加福利报销类型、共享分类和历史名称快照", () => {
    expect(databaseSource).toContain("CREATE TABLE IF NOT EXISTS welfare_one_expense_categories");
    expect(databaseSource).toContain(
      "type IN ('basic', 'large', 'business', 'welfare_one', 'welfare_two')",
    );
    expect(databaseSource).toContain("ADD COLUMN IF NOT EXISTS welfare_category_id TEXT");
    expect(databaseSource).toContain("welfare_category_name_snapshot");
    expect(databaseSource).toContain("reimbursements_welfare_category_check");
    expect(databaseSource).toContain("'welfare_one_expense'");
    expect(databaseSource).toContain("monthly_financial_manual_welfare_category_check");
  });

  it("福利范围使用独立接口且仅允许删除未引用分类", () => {
    const welfareRoutes = scopeSource.slice(
      scopeSource.indexOf("router.get('/welfare-one/list'"),
      scopeSource.indexOf("router.get('/welfare-two/list'"),
    );
    expect(welfareRoutes).toContain("router.get('/welfare-one/admin/list'");
    expect(welfareRoutes).toContain("router.post('/welfare-one/create'");
    expect(welfareRoutes).toContain("router.put('/welfare-one/sort'");
    expect(welfareRoutes).toContain("router.put('/welfare-one/:id'");
    expect(welfareRoutes).toContain("router.delete('/welfare-one/:id'");
    expect(welfareRoutes).toContain("WELFARE_ONE_CATEGORY_IN_USE");
    expect(welfareRoutes).toContain("DELETE FROM welfare_one_expense_categories");
    expect(welfareRoutes).toContain("welfare_expense_category_tombstones");
    expect(scopeSource).toContain("value: row.id");
    expect(scopeSource).toContain("children: []");
  });

  it("董事长提交由服务端生成免审批审计并直达待付款", () => {
    const createStart = reimbursementSource.indexOf("router.post('/create'");
    const listStart = reimbursementSource.indexOf("router.get('/list'", createStart);
    const createRoute = reimbursementSource.slice(createStart, listStart);
    expect(createRoute).toContain("userRole === 'chairman'");
    expect(createRoute).toContain("? 'approved'");
    expect(createRoute).toContain("'auto_approved'");
    expect(createRoute).toContain("complete_time");
    expect(createRoute).toContain("welfare_category_name_snapshot");
    expect(reimbursementSource).toContain("FOR SHARE");
    expect(createRoute).toContain("approvalSkipped");
  });

  it("管理员审批中心接收福利待付款且人工审批接口拒绝福利类型", () => {
    expect(approvalSource).toContain("reimbursement_welfare_one");
    expect(approvalSource).toContain("r.type = 'welfare_one'");
    expect(approvalSource).toContain("welfareOneStats");
    expect(approvalSource).toContain("福利报销按规则免审批，不能执行人工审批");
    expect(approvalSource).toContain("approvalSkipped: records.some");
  });

  it("付款写接口和整包银行回单仅允许精确管理员角色", () => {
    expect(reimbursementSource).toContain(
      "const requirePaymentAdmin = requireExactRole(['super_admin', 'admin'])",
    );
    expect(reimbursementSource).toContain(
      "router.post('/:id/confirm-payment', requirePaymentAdmin",
    );
    expect(reimbursementSource).toContain(
      "router.post('/payment-batch/create', requirePaymentAdmin",
    );
    expect(bankReceiptSource).toContain(
      "const requirePaymentAdmin = requireExactRole(['super_admin', 'admin'])",
    );
    expect(bankReceiptSource).toContain("router.post('/upload', requirePaymentAdmin");
    expect(bankReceiptSource).toContain("router.post('/:id/match', requirePaymentAdmin");
  });

  it("本人可独立维护收款资料且董事长账号不会被通用更新清空", () => {
    expect(userSource).toContain("router.get('/me/payment-profile', requireAuth");
    expect(userSource).toContain("router.put('/me/payment-profile', requireAuth");
    expect(userSource).toContain("const storesPaymentProfile = needsEmployeeProfile || isChairmanRole(role)");
    expect(userSource).toContain("storesPaymentProfile\n          ? bankAccountName");
  });
});
