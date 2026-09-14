import fs from "fs";
import path from "path";

describe("合同经营看板非主营收支筛选", () => {
  const backendSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );
  const dashboardSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/views/ContractDashboard.vue"),
    "utf8",
  );
  const typeSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/types/contract.ts"),
    "utf8",
  );
  const apiSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/utils/contractApi.ts"),
    "utf8",
  );

  it("看板仅在非主营分类下展示收入和支出两项筛选", () => {
    expect(dashboardSource).toContain(`v-if="selectedCategory === 'non_main'"`);
    expect(dashboardSource).toContain('aria-label="筛选非主营收支类型"');
    expect(dashboardSource).toContain(
      '{ value: "non_main_income", label: "非主营业务收入合同" }',
    );
    expect(dashboardSource).toContain(
      '{ value: "non_main_expense", label: "非主营业务支出合同" }',
    );
    expect(dashboardSource).not.toContain(
      '{ value: "other_service", label: "其他服务合同" }',
    );
  });

  it("筛选值完整进入地址、请求、重置与返回恢复链路", () => {
    expect(typeSource).toContain(
      'declaredSubtype?: ContractDeclaredSubtype | "";',
    );
    expect(dashboardSource).toContain(
      "declaredSubtype: selectedDeclaredSubtype.value || undefined",
    );
    expect(dashboardSource).toContain(
      "queryText(route.query.declaredSubtype) === query.declaredSubtype",
    );
    expect(dashboardSource).toContain(
      "declaredSubtype: query.declaredSubtype || undefined",
    );
    expect(dashboardSource).toContain('selectedDeclaredSubtype.value = "";');
    expect(dashboardSource).toContain(
      "selectedDeclaredSubtype.value = query.declaredSubtype",
    );
  });

  it("后端拒绝越界二级分类并要求同时选择非主营分类", () => {
    expect(backendSource).toContain("DASHBOARD_NON_MAIN_SUBTYPES");
    expect(backendSource).toContain("非主营收支类型不正确");
    expect(backendSource).toContain(
      "筛选非主营收支类型时合同分类必须选择非主营项目合同",
    );
  });

  it("所有看板统计查询使用同一二级分类条件并兼容历史其他服务收入", () => {
    const filterUseCount = (
      backendSource.match(/\$\{DASHBOARD_DECLARED_SUBTYPE_FILTER\}/gu) || []
    ).length;
    expect(filterUseCount).toBeGreaterThanOrEqual(18);
    expect(backendSource).toContain(
      "root.declared_subtype IN ('non_main_income', 'other_service')",
    );
    expect(backendSource).toContain(
      "OR root.declared_subtype = filters.declared_subtype",
    );
  });

  it("合同结构卡将非主营收入和支出的数量及资金指标分栏展示", () => {
    expect(dashboardSource).toContain('class="non-main-structure"');
    expect(dashboardSource).toContain("item.incomeContractCount || 0");
    expect(dashboardSource).toContain("item.expenseContractCount || 0");
    for (const field of [
      "incomeContractAmount",
      "expenseContractAmount",
      "periodReceiptAmount",
      "periodPaymentAmount",
      "cumulativeReceiptAmount",
      "cumulativePaymentAmount",
      "unreceivedAmount",
      "unpaidAmount",
    ]) {
      expect(dashboardSource).toContain(`item.${field}`);
    }
    expect(backendSource).toContain("AS income_contract_count");
    expect(backendSource).toContain("AS expense_contract_count");
    expect(typeSource).toContain("incomeContractCount?: number;");
    expect(typeSource).toContain("expenseContractCount?: number;");
    expect(apiSource).toContain("category.income_contract_count");
    expect(apiSource).toContain("category.expense_contract_count");
  });

  it("混合看板使用中性结算术语，收入或支出筛选后切换对应术语", () => {
    expect(dashboardSource).toContain("settlementScopeDirection");
    expect(dashboardSource).toContain('settlementCompletedLabel }}</small');
    expect(dashboardSource).toContain('settlementOutstandingLabel }}</small');
    expect(dashboardSource).toContain('return "mixed"');
    expect(dashboardSource).toContain('const settlementCompletedLabel');
    expect(dashboardSource).toContain('const settlementOutstandingLabel');
    expect(dashboardSource).toContain("每月有效回款与有效付款对比");
    expect(dashboardSource).not.toContain("资产类有效付款");
    expect(dashboardSource).not.toContain("资产付款");
  });

  it("统计继续按锁定财务方向归集非主营收入和支出", () => {
    expect(backendSource).toContain(
      "declared_subtype = 'non_main_expense' THEN 'cost'",
    );
    expect(backendSource).toContain(
      "IN ('main_business', 'non_main') THEN 'income'",
    );
    expect(backendSource).toContain("roots.financial_direction = 'income'");
    expect(backendSource).toContain("roots.financial_direction = 'cost'");
  });
});
