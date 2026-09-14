/** @jest-environment node */
import {
  buildMonthlyFinancialAnalysis,
  loadMonthlyFinancialAnalysis,
  type AnalysisReimbursement,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";

const generatedAt = "2026-09-04T08:00:00.000Z";
function reimbursement(
  id: string,
  date: string,
  amount: string,
): AnalysisReimbursement {
  return {
    id,
    date,
    amount,
    type: "business",
    userId: "u",
    employeeId: null,
    personName: "核验人员",
    title: "商务报销",
    category: "reception",
    scope: "haidian",
    scopePath: "海淀区 / 接待",
    region: "海淀区",
    serviceTarget: null,
    updatedAt: generatedAt,
  };
}
function source(
  overrides: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2026-01", to: "2026-09", granularity: "month" },
    generatedAt,
    reports: [],
    reimbursements: [],
    reimbursementDatesComplete: { business: true },
    ...overrides,
  };
}
function business(input: MonthlyFinancialAnalysisInput) {
  return buildMonthlyFinancialAnalysis(input).modules.find(
    (module) => module.key === "business",
  )!;
}
function closedReport(): FinancialAnalysisReport {
  return {
    month: "2026-08",
    status: "closed",
    generatedAt,
    savedAt: generatedAt,
    closedAt: generatedAt,
    accounts: [],
    income: { mainReceipt: "0", generalInterest: "0" },
    manualItems: [],
    automaticDetails: [
      {
        sourceType: "reimbursement",
        sourceId: "frozen",
        occurredOn: "2026-08-10",
        accountCode: "business",
        metric: "business_reimbursement",
        amount: "12.34",
        description: "已月结商务报销",
      },
    ],
  };
}

describe("商务趋势的完整性与真实零值", () => {
  it("未来月份不因完整来源的空数组而冒充真实零", () => {
    const result = business(
      source({
        query: { from: "2026-09", to: "2026-10", granularity: "month" },
      }),
    );
    expect(result.series[0].values).toEqual(["0", null]);
    expect(result.summaries[0].amount).toBeNull();
  });
  it("付款日期来源确认完整时，无月报且无报销的月份为真实零", () => {
    const result = business(source());
    expect(result.series[0].values).toEqual(Array(9).fill("0"));
    expect(result.summaries[0].amount).toBe("0");
    expect(result.series[0].label).toBe("商务报销");
  });

  it("月季年按实际付款月份精确聚合，空期为零，保留十二位精度", () => {
    for (const granularity of ["month", "quarter", "year"] as const) {
      const result = business(
        source({
          query: { from: "2026-01", to: "2026-09", granularity },
          reimbursements: [
            reimbursement("a", "2026-04-22", "0.100000000001"),
            reimbursement("b", "2026-04-27", "0.2"),
          ],
        }),
      );
      expect(result.summaries[0].amount).toBe("0.300000000001");
      expect(result.series[0].values.filter((value) => value !== "0")).toEqual([
        "0.300000000001",
      ]);
      expect(result.breakdown[0].amount).toBe("0.300000000001");
    }
  });

  it("仍有未归期付款时不补零；已归期折线明确为部分，不能作为完整总额", () => {
    const result = business(
      source({
        reimbursementDatesComplete: { business: false },
        reimbursements: [
          reimbursement("a", "2026-08-10", "17593.70"),
          reimbursement("b", "2026-09-01", "20600.00"),
        ],
      }),
    );
    expect(result.series[0].values).toEqual([
      ...Array(7).fill(null),
      "17593.7",
      "20600",
    ]);
    expect(result.series[0].label).toContain("已归期部分");
    expect(result.summaries[0].amount).toBeNull();
    expect(
      result.summaries.find((row) => row.key === "knownTotal")?.amount,
    ).toBe("38193.7");
    expect(
      result.summaries.find((row) => row.key === "knownTotal")?.label,
    ).toContain("部分");
    expect(result.breakdown.every((row) => row.amount === null)).toBe(true);
    expect(result.comparison.every((row) => row.amount === null)).toBe(true);
  });

  it("即使每月都有已归期数据，未归期付款仍阻止伪造完整总额", () => {
    const result = business(
      source({
        query: { from: "2026-08", to: "2026-09", granularity: "month" },
        reimbursementDatesComplete: { business: false },
        reimbursements: [
          reimbursement("a", "2026-08-10", "10"),
          reimbursement("b", "2026-09-01", "20"),
        ],
      }),
    );
    expect(result.series[0].values).toEqual(["10", "20"]);
    expect(result.summaries[0].amount).toBeNull();
    expect(
      result.summaries.find((row) => row.key === "knownTotal")?.amount,
    ).toBe("30");
  });

  it("没有显式完整性确认、来源未提供或提供坏日期时，缺月不得补零", () => {
    const cases: Partial<MonthlyFinancialAnalysisInput>[] = [
      { reimbursementDatesComplete: undefined },
      { reimbursements: undefined },
      { reimbursements: [reimbursement("bad", "2026-02-30", "10")] },
    ];
    for (const overrides of cases)
      expect(business(source(overrides)).series[0].values[0]).toBeNull();
    const invalid = business(
      source({ reimbursements: [reimbursement("bad", "2026-02-30", "10")] }),
    );
    expect(invalid.details).toEqual([]);
    expect(
      invalid.summaries.find((row) => row.key === "knownTotal")?.amount,
    ).toBe("0");
  });

  it("其他历史缺日期不覆盖已月结快照或重复加当前台账", () => {
    const result = business(
      source({
        query: { from: "2026-08", to: "2026-08", granularity: "month" },
        reports: [closedReport()],
        reimbursementDatesComplete: { business: false },
        reimbursements: [reimbursement("live", "2026-08-15", "999")],
      }),
    );
    expect(result.series[0].values).toEqual(["12.34"]);
    expect(result.summaries[0].amount).toBe("12.34");
    expect(result.summaries).toHaveLength(1);
  });

  it("全历史付款日期完整标记在跨年同期合并后仍生效", async () => {
    const client = { query: jest.fn(async () => ({ rows: [] })) };
    const result = await loadMonthlyFinancialAnalysis(
      {
        from: "2026-01",
        to: "2026-09",
        granularity: "month",
        comparisonYear: 2025,
      },
      {
        queryClient: client as never,
        loadReport: jest.fn(),
        now: new Date(generatedAt),
      },
    );
    expect(
      result.modules.find((row) => row.key === "business")?.series[0].values,
    ).toEqual(Array(9).fill("0"));
    expect(
      result.comparison?.modules.find((row) => row.key === "business")
        ?.series[0].values,
    ).toEqual(Array(9).fill("0"));
  });
});
