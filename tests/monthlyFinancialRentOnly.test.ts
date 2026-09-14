/** @jest-environment node */
import {
  buildMonthlyFinancialAnalysis,
  type AnalysisOverheadAllocation,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import {
  financialOverheadScopeEvidence,
  type FinancialOverheadScopeSource,
} from "../server/services/monthlyFinancialOverheadScope";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";

const generatedAt = "2026-09-07T02:00:00Z";
function allocation(
  changes: Partial<AnalysisOverheadAllocation> = {},
): AnalysisOverheadAllocation {
  return {
    id: "租金匹配",
    paymentId: "房租付款",
    paymentKind: "payment",
    date: "2026-08-01",
    paymentAmount: "100",
    amount: "100",
    currency: "CNY",
    invoiceId: "发票",
    invoiceAmount: "100",
    title: "标题不用于判断房租",
    updatedAt: generatedAt,
    lines: [{ id: "租金行", category: "rent", amount: "100", verified: true }],
    ...changes,
  };
}
function candidate(
  changes: Partial<FinancialOverheadScopeSource> = {},
): FinancialOverheadScopeSource {
  return {
    id: "房租付款",
    kind: "payment",
    date: "2026-08-01",
    amount: "100",
    title: "不推断标题",
    expenseCategory: "rent",
    rawMatchCount: "1",
    ...changes,
  };
}
function fixture(
  changes: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2026-08", to: "2026-08", granularity: "month" },
    generatedAt,
    reports: [],
    receipts: [],
    contracts: [],
    payroll: ["a", "b", "c"].map((id) => ({
      id: `工资:${id}`,
      employeeId: id,
      userId: `用户:${id}`,
      personName: `测试人员${id}`,
      month: "2026-08",
      salary: "1000",
      housingBase: "0",
      contributionBase: "0",
      tax: "0",
      withheldActual: "0",
      netActual: "1000",
      updatedAt: generatedAt,
    })),
    reimbursements: [],
    reimbursementDatesComplete: { basic: true, large: true, business: true },
    overheadAllocations: [],
    overheadCandidates: [],
    generalPayments: [],
    ...changes,
  };
}
function inputWithSources(
  raw: FinancialOverheadScopeSource[],
  allocations: AnalysisOverheadAllocation[],
  changes: Partial<MonthlyFinancialAnalysisInput> = {},
) {
  return fixture({
    overheadAllocations: allocations,
    overheadCandidates: raw.map((row) => ({
      ...row,
      ...financialOverheadScopeEvidence(row, allocations),
    })),
    ...changes,
  });
}
function personnel(input: MonthlyFinancialAnalysisInput) {
  return buildMonthlyFinancialAnalysis(input).modules.find(
    (row) => row.key === "personnel",
  )!;
}

describe("人力成本严格仅分摊房租", () => {
  it("混合五类发票先按全行分配付款，仅租金份额按人数处理尾差，月季年一致且公司支出不重复增加", () => {
    const lines = [
      "rent",
      "property_management",
      "electricity",
      "system_maintenance",
      "other_cost",
    ].map((category) => ({
      id: category,
      category,
      amount: "20",
      verified: true,
    }));
    const matched = allocation({ amount: "50", paymentAmount: "50", lines });
    const source = inputWithSources([candidate({ amount: "50" })], [matched], {
      generalPayments: [
        {
          id: "房租付款",
          date: "2026-08-01",
          amount: "50",
          currency: "CNY",
          title: "混合付款",
          updatedAt: generatedAt,
        },
      ],
    });
    const before = JSON.stringify(source);
    for (const granularity of ["month", "quarter", "year"] as const) {
      const data = buildMonthlyFinancialAnalysis({
        ...source,
        query: { ...source.query, granularity },
      });
      const result = data.modules.find((module) => module.key === "personnel")!;
      expect(result.series.find((row) => row.key === "overhead")).toMatchObject(
        { label: "房租分摊", values: ["10"] },
      );
      expect(result.details.map((row) => row.overhead)).toEqual([
        "3.34",
        "3.33",
        "3.33",
      ]);
      expect(
        addFinancialAmounts(...result.details.map((row) => row.total!)),
      ).toBe("3010");
      expect(
        addFinancialAmounts(
          ...result.personnelAnnualDetails!.map((row) => row.known_overhead!),
        ),
      ).toBe("10");
      const outflow = data.modules.find((module) => module.key === "outflow")!;
      expect(
        outflow.summaries.find((row) => row.key === "knownTotal")?.amount,
      ).toBe("3050");
    }
    expect(JSON.stringify(source)).toBe(before);
  });

  it("没有租金证据的物业电费系统车辆网络停车与楼牌资产不分摊，也不因缺明细或缺日期阻断房租零", () => {
    const raw = [
      "property_management",
      "electricity",
      "system_maintenance",
      "car_rental",
      "internet",
      "parking",
      "other",
    ].map((expenseCategory, index) =>
      candidate({
        id: `其他付款:${index}`,
        expenseCategory,
        rawMatchCount: "3",
        title: index === 6 ? "设备楼牌仿铜牌以及房租字样不能推断" : "资产支出",
        date: index === 0 ? "" : "2026-08-01",
      }),
    );
    const source = inputWithSources(raw, []);
    expect(
      source.overheadCandidates!.every(
        (row) => row.scopeCoverage === "excluded",
      ),
    ).toBe(true);
    const result = personnel(source);
    expect(result.series.find((row) => row.key === "overhead")!.values).toEqual(
      ["0"],
    );
    expect(
      result.details.every(
        (row) => row.total === "1000" && row.overhead === "0",
      ),
    ).toBe(true);
    expect(
      result.personnelAnnualDetails!.every((row) => row.known_overhead === "0"),
    ).toBe(true);
  });

  it.each([
    "property_management",
    "electricity",
    "system_maintenance",
    "other_cost",
  ])("仅%s已核验票据完全排除，不改变人员工资成本", (category) => {
    const matched = allocation({
      lines: [{ id: "其他行", category, amount: "100", verified: true }],
    });
    const result = personnel(
      inputWithSources([candidate({ expenseCategory: "other" })], [matched]),
    );
    expect(result.series.find((row) => row.key === "overhead")!.values).toEqual(
      ["0"],
    );
    expect(result.summaries.find((row) => row.key === "total")!.amount).toBe(
      "3000",
    );
  });

  it("真实租金缺付款日期仍未知，不进入已知分摊也不按零处理", () => {
    const source = inputWithSources(
      [candidate({ date: "", rawMatchCount: "0" })],
      [],
    );
    expect(source.overheadCandidates![0]).toMatchObject({
      scopeCoverage: "unknown",
      scopeConflict: true,
    });
    const result = personnel(source);
    expect(
      result.details.every(
        (row) =>
          row.overhead === null &&
          row.known_overhead === null &&
          row.knownTotal === "1000",
      ),
    ).toBe(true);
    expect(
      result.personnelAnnualDetails!.every(
        (row) => row.overhead === null && row.known_overhead === null,
      ),
    ).toBe(true);
  });

  it("未来或当前手工电费不进入人力分摊，原账户电费明细保持", () => {
    const report: FinancialAnalysisReport = {
      month: "2026-08",
      status: "closed",
      generatedAt,
      savedAt: generatedAt,
      closedAt: generatedAt,
      accounts: [
        {
          code: "welfare_one",
          name: "福利金账户一",
          opening: "100",
          inflow: "0",
          outflow: "60",
          closing: "40",
        },
      ],
      income: { mainReceipt: "0", generalInterest: "0" },
      automaticDetails: [],
      sources: [{ key: "payroll", status: "ready", amount: "0" }],
      manualItems: [
        {
          id: "手工电费",
          category: "welfare_one_electricity",
          accountCode: "welfare_one",
          direction: "expense",
          occurredOn: "2026-08-02",
          amount: "60",
        },
      ],
    };
    const source = fixture({ reports: [report] });
    const before = JSON.stringify(source);
    const data = buildMonthlyFinancialAnalysis(source);
    const result = data.modules.find((row) => row.key === "personnel")!;
    expect(result.details).toEqual([]);
    expect(result.series.find((row) => row.key === "overhead")!.values).toEqual(
      ["0"],
    );
    expect(
      data.modules
        .find((row) => row.key === "settlement")!
        .details.some(
          (row) => row.id === "2026-08:welfare_one" && row.expense === "60",
        ),
    ).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("同额不同真实付款编号不能替换旧月报房租来源，保留未知门禁", () => {
    const matched = allocation({
      paymentKind: "external_payment",
      paymentId: "真实外部付款",
    });
    const report: FinancialAnalysisReport = {
      month: "2026-08",
      status: "draft",
      generatedAt,
      savedAt: generatedAt,
      closedAt: null,
      accounts: [],
      income: { mainReceipt: "0", generalInterest: "0" },
      sources: [],
      manualItems: [],
      automaticDetails: [
        {
          sourceType: "asset_payment",
          sourceId: "旧普通付款",
          occurredOn: "2026-08-01",
          accountCode: "general",
          metric: "asset_administration",
          amount: "100",
          description: "同额但不是同编号来源",
        },
      ],
    };
    const result = personnel(
      inputWithSources(
        [candidate({ kind: "external_payment", id: "真实外部付款" })],
        [matched],
        { reports: [report] },
      ),
    );
    expect(result.series.find((row) => row.key === "overhead")!.values).toEqual(
      [null],
    );
    expect(result.warnings.join()).toContain("未能与月报同编号同金额来源核对");
  });
});
