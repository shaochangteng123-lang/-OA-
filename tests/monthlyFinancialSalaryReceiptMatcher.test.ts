import fs from "fs";
import path from "path";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("月报工资回单逐人挂载", () => {
  const matcherSource = source(
    "server/services/monthlyFinancialSalaryReceiptMatcher.ts",
  );
  const monthlyRouteSource = source(
    "server/routes/monthly-financial-reports.ts",
  );
  const payrollRouteSource = source("server/routes/payroll.ts");
  const fileRouteSource = source("server/routes/files.ts");
  const panelSource = source("src/components/payroll/HumanCostPanel.vue");
  const payrollApiSource = source("src/utils/payrollApi.ts");

  it("按唯一员工和银行事实逐笔挂载，不以系统实发工资差异阻断", () => {
    expect(matcherSource).toContain("reconcileMonthlySalaryReceiptMonth");
    expect(matcherSource).toContain('transaction.account_code !== "basic"');
    expect(matcherSource).toContain('transaction.category !== "salary"');
    expect(matcherSource).toContain("工资回单付款账号不是基本账户完整账号");
    expect(matcherSource).toContain("工资回单交易日期与工资月份不一致");
    expect(matcherSource).not.toContain("calculatePayrollBreakdown");
    expect(matcherSource).not.toContain("FROM payroll_records");
    expect(matcherSource).not.toContain("系统实发工资不一致");
    expect(matcherSource).not.toContain("transaction.include_in_report");
  });

  it("上传完成与同步自动数据都在整月粒度重跑挂载", () => {
    expect(monthlyRouteSource).not.toContain(
      "reconcileMonthlySalaryReceiptTransaction",
    );
    expect(
      monthlyRouteSource.match(/reconcileMonthlySalaryReceiptMonth\(/gu),
    ).toHaveLength(2);
    expect(monthlyRouteSource).toContain(
      "salaryReconciliation.some((result) => result.changed)",
    );
    expect(matcherSource).toContain("stableJsonStringify");
  });

  it("旧工资回单只在严格一致时替换且继续保留审计入口", () => {
    for (const evidence of [
      "normalizedElectronicReceiptNo",
      "payerAccount",
      "payeeName",
      "payeeAccount",
      "previousEvidence",
      "filePath",
      "fileHash",
      "pageNo",
      "position",
      "payrollMonth",
    ]) {
      expect(matcherSource).toContain(evidence);
    }
    expect(payrollRouteSource).toContain("HUMAN_COST_RECEIPT_AUDIT_LOCKED");
    expect(panelSource).toContain("查看替换前原回单");
    expect(panelSource).toContain("审计留存");
    expect(matcherSource).not.toContain("原工资回单月份不一致");
    expect(matcherSource).not.toContain("employeeCandidates");
    expect(matcherSource).toContain("proofCandidates.length === 0");
  });

  it("逐人明细与实发工资凭证位置都展示月报基本账户证据", () => {
    expect(payrollRouteSource).toContain("monthlyBankSalaryReceiptRows");
    expect(payrollRouteSource).toContain("monthly_salary_bank");
    expect(panelSource).toContain("月报基本账户回单");
    expect(panelSource).toContain("月报基本账户");
    expect(payrollApiSource).toContain("/api/files/monthly-salary-receipts/");
    expect(payrollApiSource).toContain("/api/files/monthly-salary-files/");
    expect(payrollApiSource).toContain("/api/files/human-cost-receipt-items/");
  });

  it("工资裁片和原文件预览均为管理员权限并校验真实路径", () => {
    const salaryPreviewSection = fileRouteSource.slice(
      fileRouteSource.indexOf('"/monthly-salary-receipts/:transactionId"'),
      fileRouteSource.indexOf("// 预览人力成本银行回单"),
    );
    expect(salaryPreviewSection).toContain("requireAdmin");
    expect(salaryPreviewSection).toContain(
      "resolveMonthlySalaryBankEvidencePath",
    );
    expect(fileRouteSource).toContain("fs.promises.realpath");
    expect(salaryPreviewSection).toContain("transaction.category = 'salary'");
    expect(salaryPreviewSection).toContain(
      "evidence_link.match_status = 'active'",
    );
  });

  it("银行证据只更新回单汇总展示，不覆盖工资表计算结果", () => {
    const loadPayrollRowsSection = payrollRouteSource.slice(
      payrollRouteSource.indexOf("async function loadPayrollRows"),
      payrollRouteSource.indexOf('router.get("/receipts"'),
    );
    expect(loadPayrollRowsSection).toContain("salary_receipts");
    expect(loadPayrollRowsSection).not.toContain("totals.net_salary =");
    expect(payrollRouteSource).toContain(
      "totals.net_salary = effectiveSalaryReceiptTotal.amount",
    );
  });
});
