import fs from "fs";
import path from "path";

describe("合同经营看板与台账后端契约", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/contracts.ts"),
    "utf8",
  );

  it("严格校验看板起止月份、三年范围、分类和项目参数", () => {
    expect(source).toContain("validateDashboardFilters");
    expect(source).toContain("开始月份格式必须为 YYYY-MM");
    expect(source).toContain("结束月份格式必须为 YYYY-MM");
    expect(source).toContain("开始月份不能晚于结束月份");
    expect(source).toContain("统计范围最多支持连续 36 个月");
    expect(source).toContain("合同分类不正确");
    expect(source).toContain("filters.project_id IS NULL");
  });

  it("终止审批期间仍按原状态计入当前合同金额", () => {
    expect(source).toContain("function contributesToCurrentAmount");
    expect(source).toContain("pending_action = 'termination'");
    expect(source).toContain(
      "previous_status IN ('effective', 'executing', 'completed')",
    );
    expect(source).toContain('contributesToCurrentAmount("root")');
    expect(source).toContain("root.current_effective_amount");
    expect(source).toContain("root.original_contract_amount");
    expect(source).not.toContain('contributesToCurrentAmount("child")');
  });

  it("全历史合同快照不受期间限制并另行返回严格期间合同额", () => {
    const pendingStart = source.indexOf(
      "function pendingSignatureContractPredicate",
    );
    const pendingEnd = source.indexOf("/** 无固定金额合同", pendingStart);
    const pendingPredicate = source.slice(pendingStart, pendingEnd);
    expect(source).toContain("function pendingSignatureContractPredicate");
    expect(pendingPredicate).toContain("'draft', 'pending_seal'");
    expect(pendingPredicate).toContain("AND NOT");
    expect(pendingPredicate).toContain("pending_action = 'termination'");
    expect(pendingPredicate).toContain(
      "previous_status IN ('effective', 'executing', 'completed')",
    );
    expect(source).toContain("is_pending_signature");
    expect(source).toContain("all_contract_amount");
    expect(source).toContain("effective_contract_amount");
    expect(source).toContain("pending_signature_amount");
    expect(source).toContain("period_contract_amount");
    expect(source).toContain("period_contract_count");
    expect(source).toContain(
      "contract_month BETWEEN filters.start_month AND filters.end_month",
    );
    expect(source).toContain(
      "FROM root_groups roots CROSS JOIN filter_parameters filters",
    );
    expect(source).toContain("roots.category IN ('main_business', 'non_main')");
    expect(source).toContain("allContractAmount");
    expect(source).toContain("effectiveContractAmount");
    expect(source).toContain("effectiveIncomeContractAmount");
    expect(source).toContain("effectiveExpenseContractAmount");
    expect(source).toContain("pendingSignatureAmount");
    expect(source).toContain("COALESCE(root.category, root.declared_category)");
  });

  it("只聚合已确认财务流水并返回期间及项目指标", () => {
    expect(source).toContain(
      'const CONFIRMED_FINANCIAL_STATUSES = ["confirmed"]',
    );
    expect(source).toContain("periodAccountingIncome");
    expect(source).toContain("unreceivedAmount");
    expect(source).toContain("projectRanking");
    expect(source).toContain("paidAmount");
    expect(source).toContain("settledAmount");
    expect(source).toContain("completionRate");
    expect(source).toContain('r.rate_snapshot_json AS "rateSnapshot"');
    expect(source).toContain("resolveRecordRates(row, rateHistory)");
    expect(source).toContain("safeContractOutputAmount");
    expect(source).toContain("sumSafeContractOutputAmounts");
    expect(source).toContain("CONTRACT_AGGREGATE_SAFE_RANGE_EXCEEDED");
    expect(source).toContain("root.status <> 'rejected'");
    expect(source).toContain(
      "root.status IN ('rejected', 'terminated') THEN 0",
    );
  });

  it("分类汇总按合同分类确定收支方向并区分无固定金额", () => {
    expect(source).toContain("function contractCategoryDirectionExpression");
    expect(source).toContain("function currentFixedContractAmountExpression");
    expect(source).toContain("fixed_amount_contract_count");
    expect(source).toContain("unfixed_amount_contract_count");
    expect(source).toContain("cumulative_settled_amount");
    expect(source).toContain("outstanding_amount");
    expect(source).toContain("completionRate");
    expect(source).toContain("noFixedAmountCount");
  });

  it("合同结算状态只纳入已生效固定金额合同并支持台账下钻筛选", () => {
    expect(source).toContain(
      "root.status IN ('effective', 'executing', 'completed')",
    );
    expect(source).toContain("classifyContractSettlement");
    expect(source).toContain("settlementStatuses");
    expect(source).toContain("noFixedAmountContractCount");
    expect(source).toContain("req.query.settlementStatus");
    expect(source).toContain("合同结算状态不正确");
    expect(source).toContain("settlement.current_amount IS NOT NULL");
  });

  it("三期比较覆盖上一等长期间、上年同期、零分母和分类项目筛选", () => {
    expect(source).toContain("previousPeriodStart");
    expect(source).toContain("previousPeriodEnd");
    expect(source).toContain("previousYearStart");
    expect(source).toContain("previousYearEnd");
    expect(source).toContain("comparison_periods");
    expect(source).toContain("calculateContractAmountChange");
    expect(source).toContain("incomePreviousPeriod");
    expect(source).toContain("expensePreviousPeriod");
    expect(source).toContain("incomePreviousYear");
    expect(source).toContain("expensePreviousYear");
    expect(source).toContain("periodComparison");
  });

  it("台账支持组合筛选并使用正确的默认及待办排序", () => {
    expect(source).toContain(
      "COALESCE(c.category, c.declared_category) = ANY(?::text[])",
    );
    expect(source).toContain("c.status = ANY(?::text[])");
    expect(source).toContain("req.query.counterparty");
    expect(source).toContain("req.query.contractDateFrom");
    expect(source).toContain("req.query.contractDateTo");
    expect(source).toContain(
      "list_page.sort_updated DESC, list_page.root_id DESC",
    );
    expect(source).toContain(
      "list_page.sort_submitted ASC NULLS LAST, list_page.sort_updated ASC, list_page.root_id ASC",
    );
    expect(source).toContain("creator.name AS owner_name");
    expect(source).toContain("ownerName: row.owner_name");
  });

  it("合同截至日期在内部划拨模式同时覆盖只有划拨、只有外付和两者并存", () => {
    const cutoffStart = source.indexOf("END AS contract_cutoff_date");
    const cutoffSource = source.slice(
      source.lastIndexOf("CASE", cutoffStart),
      cutoffStart,
    );
    expect(cutoffSource).toContain("SELECT MAX(receipt.receipt_date)");
    expect(cutoffSource).toContain(
      "root_status NOT IN ('completed', 'terminated') THEN NULL",
    );
    expect(cutoffSource).toContain(
      "asset_funding_mode = 'engineering_to_technology' THEN GREATEST(",
    );
    expect(cutoffSource).toContain("FROM contract_payments payment");
    expect(cutoffSource).toContain("FROM contract_external_payments payment");
    expect(
      cutoffSource.match(/SELECT MAX\(payment\.payment_date\)/gu),
    ).toHaveLength(3);
    expect(
      cutoffSource.match(
        /confirmedFinancialPredicate\("(?:receipt|payment)"\)/gu,
      )?.length,
    ).toBeGreaterThanOrEqual(4);
    expect(cutoffSource).toContain("payment_contract.is_deleted = FALSE");
    expect(cutoffSource).toContain("payment_contract.status <> 'rejected'");
  });

  it("合同日期和资金发生日期均严格使用起止月份", () => {
    expect(source).toContain("function rootContractDateExpression");
    expect(source).toContain('rootContractDateExpression("c")');
    expect(source).not.toContain(
      'addFilter("c.contract_date >= ?", contractDateFrom)',
    );
    expect(source).not.toContain(
      'addFilter("c.contract_date <= ?", contractDateTo)',
    );
    expect(source).toContain("LEFT(root.contract_date, 7)");
    expect(source).toContain(
      "BETWEEN filters.start_month AND filters.end_month",
    );
    expect(source).toContain("LEFT(r.receipt_date, 7) BETWEEN ? AND ?");
    expect(source).toContain("LEFT(receipt.receipt_date, 7) = m.month");
    expect(source).toContain("LEFT(payment.payment_date, 7) = m.month");
    expect(source).toContain("(? || '-01')::date");
  });
});
