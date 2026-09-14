/** @jest-environment node */
import { loadFinancialAnalysisSources } from "../server/services/monthlyFinancialAnalysisSources";
import { buildMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysis";

describe("公共费用缺失日期在真实来源层保留", () => {
  it("付款及分配查询保留空或无效日期，不在SQL中静默排除后伪造零费用", async () => {
    const statements: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
        return { rows: [] };
      }),
    };
    await loadFinancialAnalysisSources(
      { from: "2026-01", to: "2026-07", granularity: "month" },
      { queryClient: client as never, loadReport: jest.fn() },
    );
    const allocations = statements.find((sql) =>
      sql.includes("financial_match.allocated_amount::text AS amount"),
    )!;
    const candidates = statements.find((sql) =>
      sql.includes('AS "rawMatchCount"'),
    )!;
    for (const sql of [allocations, candidates]) {
      expect(sql).toContain("COALESCE(payment.payment_date, '') AS date");
      expect(sql).toContain(
        "OR NOT COALESCE(monthly_financial_date_is_valid(payment.payment_date), FALSE)",
      );
    }
  });

  it("空日期候选到达主计算后，公共费用及完整总额未知，不能进入已知分摊", () => {
    const data = buildMonthlyFinancialAnalysis({
      query: { from: "2026-01", to: "2026-01", granularity: "month" },
      generatedAt: "2026-09-04T08:00:00Z",
      reports: [],
      payroll: [
        {
          id: "salary",
          employeeId: "person",
          userId: "user",
          personName: "测试人员",
          month: "2026-01",
          salary: "1000",
          housingBase: "0",
          contributionBase: "0",
          tax: "0",
          withheldActual: "0",
          netActual: "1000",
          updatedAt: "2026-01-31",
        },
      ],
      reimbursements: [],
      reimbursementDatesComplete: { basic: true, large: true, business: true },
      overheadAllocations: [],
      overheadCandidates: [
        {
          id: "missing-date",
          kind: "payment",
          date: "",
          amount: "300",
          title: "来源日期缺失",
          scopeCoverage: "unknown",
          scopeConflict: true,
        },
      ],
    });
    const personnel = data.modules.find(
      (module) => module.key === "personnel",
    )!;
    const amount = (key: string) =>
      personnel.series.find((series) => series.key === key)!.values[0];
    expect(amount("payrollCost")).toBe("1000");
    expect(amount("knownTotal")).toBe("1000");
    expect(amount("overhead")).toBeNull();
    expect(amount("total")).toBeNull();
  });
});
