/** @jest-environment node */
import {
  financialReimbursementDatesComplete,
  financialReimbursementDateWarnings,
  type FinancialReimbursementDateDiagnostic,
} from "../server/services/monthlyFinancialReimbursementDateDiagnostics";
import { loadFinancialAnalysisSources } from "../server/services/monthlyFinancialAnalysisSources";
import { loadMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysis";
import { protectMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysisPermissions";
import type { FinancialAnalysisQuery } from "../server/types/monthly-financial-analysis";

const query: FinancialAnalysisQuery = {
  from: "2026-08",
  to: "2026-08",
  granularity: "month",
};
const business: FinancialReimbursementDateDiagnostic = {
  type: "business",
  count: "25",
  amount: "68789.12",
};
function sourceClient(rows: FinancialReimbursementDateDiagnostic[]) {
  return {
    query: jest.fn(async (sql: string) => ({
      rows: sql.includes("COUNT(*)::text AS count") ? rows : [],
    })),
  };
}

describe("财务报销付款日期缺失的精确来源诊断", () => {
  it("显示商务报销确切笔数和金额，并明确全历史待核对不代表当期没有报销", () => {
    const warnings = financialReimbursementDateWarnings([business]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("25笔已付款商务报销缺少有效实际付款日期");
    expect(warnings[0]).toContain("金额¥68,789.12");
    expect(warnings[0]).toContain("尚未纳入按付款月份统计，不能理解为没有报销");
    expect(warnings[0]).toContain("全历史日期诊断");
    expect(warnings[0]).toContain("不代表当前月份、人员或报销范围筛选金额");
  });

  it("三类报销独立汇总且使用固定顺序，零笔不输出误导提示", () => {
    const warnings = financialReimbursementDateWarnings([
      business,
      { type: "large", count: "3", amount: "9000" },
      { type: "basic", count: "2", amount: "2053.4" },
    ]);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("2笔已付款基础报销");
    expect(warnings[0]).toContain("¥2,053.40");
    expect(warnings[1]).toContain("3笔已付款大额报销");
    expect(warnings[1]).toContain("¥9,000.00");
    expect(warnings[2]).toContain("25笔已付款商务报销");
    expect(
      financialReimbursementDateWarnings([
        { ...business, count: "0", amount: "0" },
      ]),
    ).toEqual([]);
  });

  it("合计和笔数超过浮点安全范围时仍逐位保留，小额零值也明确展示", () => {
    const warnings = financialReimbursementDateWarnings([
      {
        type: "basic",
        count: "9007199254740993",
        amount: "123456789012345678.000000000001",
      },
      { type: "large", count: "1", amount: "0.000000000001" },
      { type: "business", count: "2", amount: "0.00" },
    ]);
    expect(warnings[0]).toContain("9007199254740993笔");
    expect(warnings[0]).toContain("¥123,456,789,012,345,678.000000000001");
    expect(warnings[1]).toContain("¥0.000000000001");
    expect(warnings[2]).toContain("2笔");
    expect(warnings[2]).toContain("¥0.00");
  });

  it("未知业务类型和非法笔数不输出，异常金额不打印原文或伪造为零", () => {
    const warnings = financialReimbursementDateWarnings([
      { type: "payroll-secret-user", count: "1", amount: "999999" },
      { type: "basic", count: "1", amount: "敏感原文" },
      { type: "large", count: "-1", amount: "123" },
      { type: "business", count: "2", amount: null },
    ]);
    expect(warnings).toHaveLength(2);
    expect(
      warnings.every((warning) => warning.includes("金额未知（原始合计无效）")),
    ).toBe(true);
    expect(warnings.join("")).not.toMatch(
      /payroll-secret-user|999999|敏感原文|¥0/,
    );
  });

  it("仅成功完整分组查询后的空结果标记完整，已知类型缺日期或非法笔数保持不完整", async () => {
    expect(financialReimbursementDatesComplete([])).toEqual({
      basic: true,
      large: true,
      business: true,
    });
    expect(
      financialReimbursementDatesComplete([
        business,
        { type: "basic", count: "0", amount: "0" },
        { type: "large", count: "无效", amount: "10" },
        { type: "unexpected", count: "100", amount: "1000" },
      ]),
    ).toEqual({ basic: true, large: false, business: false });
    const client = sourceClient([]);
    const sources = await loadFinancialAnalysisSources(query, {
      queryClient: client as never,
      loadReport: jest.fn(),
    });
    expect(sources.reimbursementDatesComplete).toEqual({
      basic: true,
      large: true,
      business: true,
    });
  });

  it("诊断查询失败时拒绝来源加载，不把失败当成三类数据完整", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("COUNT(*)::text AS count"))
          throw new Error("诊断来源查询失败");
        return { rows: [] };
      }),
    };
    await expect(
      loadFinancialAnalysisSources(query, {
        queryClient: client as never,
        loadReport: jest.fn(),
      }),
    ).rejects.toThrow("诊断来源查询失败");
  });

  it("来源按类型用数据库精确数值汇总，包含空和无效日期且不关联人员表放大笔数", async () => {
    const client = sourceClient([business]);
    const loadReport = jest.fn();
    const sources = await loadFinancialAnalysisSources(query, {
      queryClient: client as never,
      loadReport,
      now: new Date("2026-09-04T01:00:00Z"),
    });
    const statement = client.query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes("COUNT(*)::text AS count"))!;
    expect(statement).toContain("SUM(total_amount)::text AS amount");
    expect(statement).toContain(
      "status IN ('paid', 'payment_uploaded', 'completed')",
    );
    expect(statement).toContain("is_deleted = FALSE");
    expect(statement).toContain("type IN ('basic', 'large', 'business')");
    expect(statement).toContain("payment_business_date IS NULL");
    expect(statement).toContain(
      "NOT COALESCE(monthly_financial_date_is_valid(payment_business_date::text), FALSE)",
    );
    expect(statement).toContain("GROUP BY type ORDER BY type");
    expect(statement).not.toMatch(
      /JOIN|pay_time|paid_time|created_at|reimbursement_month|\$\d/,
    );
    expect(
      client.query.mock.calls.every(([sql]) => /^\s*SELECT\b/u.test(sql)),
    ).toBe(true);
    expect(loadReport).not.toHaveBeenCalled();
    expect(sources.reimbursements).toEqual([]);
    expect(sources.reimbursementDatesComplete).toEqual({
      basic: true,
      large: true,
      business: false,
    });
    expect(sources.warnings).toEqual(
      financialReimbursementDateWarnings([business]),
    );
  });

  it("人员和范围筛选不把全历史诊断伪装成已归月事实，正常来源筛选保持原样", async () => {
    const client = sourceClient([business]);
    const sources = await loadFinancialAnalysisSources(
      {
        ...query,
        personId: "selected-person",
        reimbursementScope: "selected-scope",
      },
      { queryClient: client as never, loadReport: jest.fn() },
    );
    const ordinaryQuery = client.query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => sql.includes("FROM reimbursements reimbursement"))!;
    expect(ordinaryQuery).toContain(
      "reimbursement.payment_business_date >= $1::date",
    );
    expect(ordinaryQuery).toContain(
      "reimbursement.payment_business_date < ($2::date + INTERVAL '1 month')",
    );
    expect(ordinaryQuery).not.toMatch(
      /COALESCE\(reimbursement.payment_business_date|reimbursement_month|pay_time/,
    );
    expect(sources.warnings?.join("")).not.toMatch(
      /selected-person|selected-scope/,
    );
    expect(sources.reimbursements).toEqual([]);
  });

  it("两期加载相同全历史诊断只保留一份，授权总经理可读报销提示且不暴露工资类型", async () => {
    const client = sourceClient([
      business,
      { type: "salary", count: "1", amount: "隐藏工资原值" },
    ]);
    const result = await loadMonthlyFinancialAnalysis(
      { ...query, comparisonYear: 2025 },
      {
        queryClient: client as never,
        loadReport: jest.fn(),
        now: new Date("2026-09-04T01:00:00Z"),
      },
    );
    const visible = protectMonthlyFinancialAnalysis(result, "general_manager");
    const diagnostic = financialReimbursementDateWarnings([business])[0];
    expect(
      visible.warnings.filter((warning) => warning === diagnostic),
    ).toHaveLength(1);
    expect(
      visible.comparison?.warnings.filter((warning) => warning === diagnostic),
    ).toHaveLength(1);
    expect(JSON.stringify(visible)).not.toContain("隐藏工资原值");
    expect(
      visible.modules.find((module) => module.key === "personnel")
        ?.payrollDetailsVisible,
    ).toBe(false);
    expect(
      visible.modules.find((module) => module.key === "business")?.details,
    ).toEqual([]);
  });
});
