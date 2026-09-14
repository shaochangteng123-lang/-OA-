/** @jest-environment node */
jest.mock("../server/services/monthlyFinancialHousingCostSources", () => ({
  loadMonthlyFinancialHousingCostInvoices: jest.fn(),
}));
import { loadMonthlyFinancialHousingCostInvoices } from "../server/services/monthlyFinancialHousingCostSources";
import {
  buildMonthlyFinancialAnalysis,
  loadMonthlyFinancialAnalysis,
  type AnalysisHousingCostInvoice,
  type AnalysisPayroll,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";
import type { AnalysisRentAccrualContract } from "../server/services/monthlyFinancialRentAccrual";

const generatedAt = "2026-09-07T02:00:00Z";
const lease: AnalysisRentAccrualContract = {
  id: "房屋合同",
  title: "房屋租赁",
  status: "executing",
  effectiveAt: "2025-06-01",
  leaseStartDate: "2025-06-16",
  leaseEndDate: "2027-06-15",
  monthlyRent: "20378",
  monthlyPropertyFee: "6120",
};
function wages(
  month: string,
  ids = ["a", "b", "c", "d", "e", "f"],
): AnalysisPayroll[] {
  return ids.map((id) => ({
    id: `工资:${month}:${id}`,
    employeeId: id,
    userId: `用户:${id}`,
    personName: `测试人员${id}`,
    month,
    salary: "1000",
    housingBase: "0",
    contributionBase: "0",
    tax: "0",
    withheldActual: "0",
    netActual: "1000",
    updatedAt: generatedAt,
  }));
}
function invoice(
  changes: Partial<AnalysisHousingCostInvoice> = {},
): AnalysisHousingCostInvoice {
  return {
    id: "房屋发票",
    rootId: "房屋合同",
    invoiceDate: "2026-08-10",
    invoiceNumber: "发票号码1",
    invoiceAmount: "29307.78",
    billingMonth: "2026-04",
    periodReason: "原收费单明确2026年4月费用",
    evidenceVersion: "已核验原件摘要1",
    updatedAt: generatedAt,
    lines: [
      { id: "rent", category: "rent", amount: "20000", verified: true },
      {
        id: "property",
        category: "property_management",
        amount: "6000",
        verified: true,
      },
      {
        id: "electricity",
        category: "electricity",
        amount: "2714.98",
        verified: true,
      },
      {
        id: "maintenance",
        category: "system_maintenance",
        amount: "592.80",
        verified: true,
      },
    ],
    ...changes,
  };
}
function fixture(
  changes: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2026-01", to: "2026-09", granularity: "month" },
    generatedAt,
    reports: [],
    receipts: [],
    contracts: [],
    payroll: ["01", "02", "03", "04", "05", "06", "07", "08", "09"].flatMap(
      (m) => wages(`2026-${m}`),
    ),
    reimbursements: [],
    undatedReimbursements: [],
    reimbursementDatesComplete: { basic: true, large: true, business: true },
    personnelIncurredReimbursements: [],
    rentAccrualContracts: [lease],
    rentCurrentMonthMode: "daily",
    housingCostInvoices: [invoice()],
    overheadAllocations: [],
    overheadCandidates: [],
    generalPayments: [],
    ...changes,
  };
}
function personnel(input = fixture()) {
  return buildMonthlyFinancialAnalysis(input).modules.find(
    (row) => row.key === "personnel",
  )!;
}
function sum(values: Array<string | null>) {
  return addFinancialAmounts(
    ...values.filter((value): value is string => value !== null),
  );
}
function variableInvoice(
  amount = "10",
  changes: Partial<AnalysisHousingCostInvoice> = {},
) {
  return invoice({
    invoiceAmount: amount,
    lines: [{ id: "电费行", category: "electricity", amount, verified: true }],
    ...changes,
  });
}

describe("房屋租赁全成本完整性与一次分摊", () => {
  it("旧址5月到期新址6月起租：跨合同汇总保留历史，不沿用旧址物业或维护费", () => {
    const source = fixture({
      generatedAt: "2026-09-30T02:00:00Z",
      rentAccrualContracts: [
        {
          ...lease,
          id: "旧址",
          title: "旧办公室",
          status: "completed",
          leaseStartDate: "2026-01-01",
          leaseEndDate: "2026-05-31",
          monthlyRent: "1000",
          monthlyPropertyFee: "100",
        },
        {
          ...lease,
          id: "新址",
          title: "新办公室",
          effectiveAt: "2026-06-20",
          leaseStartDate: "2026-06-01",
          leaseEndDate: "2027-05-31",
          monthlyRent: "2000",
          monthlyPropertyFee: "0",
        },
      ],
      housingCostInvoices: [
        variableInvoice("50", {
          id: "旧维护",
          rootId: "旧址",
          invoiceNumber: "旧维护票",
          invoiceDate: "2026-07-01",
          billingMonth: "2026-05",
          lines: [
            {
              id: "维护",
              category: "system_maintenance",
              amount: "50",
              verified: true,
            },
          ],
        }),
        variableInvoice("20", {
          id: "新电费",
          rootId: "新址",
          invoiceNumber: "新电费票",
          invoiceDate: "2026-07-01",
          billingMonth: "2026-06",
        }),
      ],
    });
    const before = JSON.stringify(source);
    const result = personnel(source);
    expect(result.series.find((s) => s.key === "overhead")!.values).toEqual([
      "1100",
      "1100",
      "1100",
      "1100",
      "1150",
      "2020",
      "2000",
      "2000",
      "2000",
    ]);
    expect(result.housingCostBreakdown!.map((v) => v.amount)).toEqual([
      "13000",
      "500",
      "20",
      "50",
      "0",
    ]);
    expect(sum(result.personnelAnnualDetails!.map((r) => r.overhead!))).toBe(
      "13570",
    );
    for (const granularity of ["quarter", "year"] as const) {
      const grouped = personnel({
        ...source,
        query: { ...source.query, granularity },
      });
      expect(
        sum(grouped.series.find((s) => s.key === "overhead")!.values),
      ).toBe("13570");
      expect(grouped.housingCostBreakdown).toEqual(result.housingCostBreakdown);
    }
    const june = personnel({
      ...source,
      query: {
        from: "2026-06",
        to: "2026-06",
        granularity: "month",
        personId: "a",
      },
    });
    expect(sum(june.housingCostBreakdown!.map((v) => v.amount))).toBe("2020");
    expect(
      june.housingCostBreakdown!.find((v) => v.key === "property_management")!
        .amount,
    ).toBe("0");
    expect(
      june.housingCostBreakdown!.find((v) => v.key === "system_maintenance")!
        .amount,
    ).toBe("0");
    expect(june.personnelAnnualDetails![0].overhead).toBe(
      result.personnelAnnualDetails!.find((r) => r.personId === "a")!.overhead,
    );
    expect(
      result.details.some((r) => r.sourceState?.includes("旧办公室")),
    ).toBe(true);
    expect(
      result.details.some((r) => r.sourceState?.includes("新办公室")),
    ).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("6月签订7月起租不提前收费；不同地址真实重叠分别计入且空物业不假定免收", () => {
    const old = {
      ...lease,
      id: "旧址",
      leaseEndDate: "2026-06-30",
      monthlyRent: "1000",
      monthlyPropertyFee: "100",
    };
    const fresh = {
      ...lease,
      id: "新址",
      effectiveAt: "2026-06-01",
      leaseStartDate: "2026-07-01",
      monthlyRent: "2000",
      monthlyPropertyFee: "0",
    };
    const source = fixture({
      rentAccrualContracts: [old, fresh],
      housingCostInvoices: [],
      generatedAt: "2026-09-30T02:00:00Z",
    });
    expect(
      personnel(source)
        .series.find((s) => s.key === "overhead")!
        .values.slice(5),
    ).toEqual(["1100", "2000", "2000", "2000"]);
    const overlap = personnel({
      ...source,
      rentAccrualContracts: [old, { ...fresh, leaseStartDate: "2026-06-01" }],
    });
    expect(overlap.series.find((s) => s.key === "overhead")!.values[5]).toBe(
      "3100",
    );
    const unknown = personnel({
      ...source,
      rentAccrualContracts: [old, { ...fresh, monthlyPropertyFee: null }],
    });
    expect(unknown.series.find((s) => s.key === "overhead")!.values[5]).toBe(
      "1100",
    );
    expect(
      unknown.series.find((s) => s.key === "overhead")!.values[6],
    ).toBeNull();
    expect(
      unknown.housingCostBreakdown!.find(
        (v) => v.key === "property_management",
      ),
    ).toMatchObject({ amount: null, knownAmount: "600" });
  });
  it("公司住房费用221474.65按收费月纳入，固定租金物业不重复累加发票，六人年末差不超过一分", () => {
    const source = fixture();
    const before = JSON.stringify(source);
    const result = personnel(source);
    expect(
      result.housingCostBreakdown?.map((row) => [row.key, row.amount]),
    ).toEqual([
      ["rent", "167778.87"],
      ["property_management", "50388"],
      ["electricity", "2714.98"],
      ["system_maintenance", "592.8"],
      ["other_cost", "0"],
    ]);
    expect(sum(result.housingCostBreakdown!.map((row) => row.amount))).toBe(
      "221474.65",
    );
    expect(sum(result.personnelAnnualDetails!.map((row) => row.overhead))).toBe(
      "221474.65",
    );
    expect(
      result.personnelAnnualDetails!.map((row) => row.overhead).sort(),
    ).toEqual([
      "36912.44",
      "36912.44",
      "36912.44",
      "36912.44",
      "36912.44",
      "36912.45",
    ]);
    expect(result.series.find((row) => row.key === "overhead")).toMatchObject({
      label: "房屋租赁成本分摊",
      values: [
        "26498",
        "26498",
        "26498",
        "29805.78",
        "26498",
        "26498",
        "26498",
        "26498",
        "6182.87",
      ],
    });
    expect(result.summaries.find((row) => row.key === "total")!.amount).toBe(
      "275474.65",
    );
    expect(JSON.stringify(source)).toBe(before);
  });
  it("四类小金额先合并再分一次尾差，个人筛选不改变全体名单分母", () => {
    const source = fixture({
      query: { from: "2026-04", to: "2026-04", granularity: "month" },
      payroll: wages("2026-04", ["a", "b", "c"]),
      rentAccrualContracts: [
        {
          ...lease,
          leaseStartDate: "2026-04-01",
          leaseEndDate: "2026-04-30",
          monthlyRent: "0.01",
          monthlyPropertyFee: "0.01",
        },
      ],
      housingCostInvoices: [
        invoice({
          invoiceAmount: "0.04",
          lines: [
            "rent",
            "property_management",
            "electricity",
            "system_maintenance",
          ].map((category) => ({
            id: category,
            category,
            amount: "0.01",
            verified: true,
          })),
        }),
      ],
    });
    const result = personnel(source);
    expect(result.details.map((row) => row.overhead)).toEqual([
      "0.02",
      "0.01",
      "0.01",
    ]);
    expect(sum(result.housingCostBreakdown!.map((row) => row.amount))).toBe(
      "0.04",
    );
    const selected = personnel({
      ...source,
      query: { ...source.query, personId: "a" },
    });
    expect(selected.details[0].overhead).toBe("0.02");
    expect(sum(selected.housingCostBreakdown!.map((row) => row.amount))).toBe(
      "0.04",
    );
  });
  it("月季年精确一致，住房公司构成不与个人总额重复相加，其他六模块完全不变", () => {
    const source = fixture({
      generalPayments: [
        {
          id: "现金房屋付款",
          date: "2026-08-30",
          amount: "79967.06",
          currency: "CNY",
          title: "现金不变",
          updatedAt: generatedAt,
        },
      ],
    });
    const current = buildMonthlyFinancialAnalysis(source);
    const old = buildMonthlyFinancialAnalysis({
      ...source,
      housingCostInvoices: undefined,
      rentAccrualContracts: [{ ...lease, monthlyPropertyFee: undefined }],
    });
    expect(current.modules.filter((row) => row.key !== "personnel")).toEqual(
      old.modules.filter((row) => row.key !== "personnel"),
    );
    for (const granularity of ["month", "quarter", "year"] as const) {
      const result = personnel({
        ...source,
        query: { ...source.query, granularity },
      });
      expect(sum(result.details.map((row) => row.overhead))).toBe("221474.65");
      expect(
        sum(result.personnelAnnualDetails!.map((row) => row.overhead)),
      ).toBe("221474.65");
    }
  });
  it("收费月份缺失不能用8月开票日补归月，未知变量不抹去固定及其他已核验费用", () => {
    const result = personnel(
      fixture({
        housingCostInvoices: [
          variableInvoice("10", {
            id: "有效电费",
            invoiceNumber: "有效号",
            billingMonth: "2026-05",
          }),
          variableInvoice("90", {
            id: "无月份",
            invoiceNumber: "无月号",
            billingMonth: null,
          }),
        ],
      }),
    );
    expect(
      result.housingCostBreakdown!.find((row) => row.key === "electricity"),
    ).toMatchObject({ amount: null, knownAmount: "10" });
    expect(
      result.housingCostBreakdown!.find((row) => row.key === "rent")!.amount,
    ).toBe("167778.87");
    expect(
      result.housingCostBreakdown!.find(
        (row) => row.key === "property_management",
      )!.amount,
    ).toBe("50388");
    expect(
      result.series
        .find((row) => row.key === "overhead")!
        .values.every((value) => value === null),
    ).toBe(true);
    expect(
      sum(result.personnelAnnualDetails!.map((row) => row.known_overhead)),
    ).toBe("218176.87");
    expect(result.details.some((row) => row.sourceId!.includes("无月份"))).toBe(
      false,
    );
    expect(result.warnings.join()).toContain("未用开票日、付款日");
  });
  it("未核验明细、待分类和票面不闭合保持未知，不伪造变量零", () => {
    for (const bad of [
      variableInvoice("10", { invoiceAmount: "11" }),
      variableInvoice("10", {
        lines: [
          {
            id: "电费行",
            category: "electricity",
            amount: "10",
            verified: false,
          },
        ],
      }),
      variableInvoice("10", {
        lines: [
          {
            id: "待分类",
            category: "pending_review",
            amount: "10",
            verified: true,
          },
        ],
      }),
      variableInvoice("10", { evidenceVersion: "" }),
    ]) {
      const result = personnel(fixture({ housingCostInvoices: [bad] }));
      expect(
        result.housingCostBreakdown!.find((row) => row.key === "electricity")!
          .amount,
      ).toBeNull();
      expect(
        result.series.find((row) => row.key === "overhead")!.values[3],
      ).toBeNull();
      expect(
        sum(result.personnelAnnualDetails!.map((row) => row.known_overhead)),
      ).toBe("218166.87");
    }
  });

  it("发票缺失明细字段或空明细保持未知，不抛错也不把缺口算零", () => {
    for (const lines of [[], undefined, null]) {
      const result = personnel(
        fixture({ housingCostInvoices: [invoice({ lines: lines as never })] }),
      );
      expect(
        result.housingCostBreakdown!.find((row) => row.key === "electricity"),
      ).toMatchObject({ amount: null, knownAmount: null });
      expect(
        result.series.find((row) => row.key === "overhead")!.values[3],
      ).toBeNull();
      expect(
        sum(result.personnelAnnualDetails!.map((row) => row.known_overhead)),
      ).toBe("218166.87");
    }
  });
  it("同发票编号或号码相同的等价证据只计一次，金额/月份/证据版本冲突均未知", () => {
    const same = variableInvoice();
    const equivalent = {
      ...same,
      id: "重复导入",
      lines: [{ ...same.lines[0], id: "重复行id" }],
    };
    expect(
      personnel(
        fixture({ housingCostInvoices: [same, { ...same }, equivalent] }),
      ).housingCostBreakdown!.find((row) => row.key === "electricity")!.amount,
    ).toBe("10");
    for (const different of [
      { ...same, evidenceVersion: "另一份原件证据" },
      variableInvoice("11"),
      { ...same, billingMonth: "2026-05" },
    ]) {
      const result = personnel(
        fixture({ housingCostInvoices: [same, different] }),
      );
      expect(
        result.housingCostBreakdown!.find((row) => row.key === "electricity")!
          .amount,
      ).toBeNull();
      expect(
        sum(result.personnelAnnualDetails!.map((row) => row.known_overhead)),
      ).toBe("218166.87");
    }
  });
  it("明确可退押金、其他资产合同及未来收费月不进入住房费用；已确认其他房屋费用可计入", () => {
    const result = personnel(
      fixture({
        housingCostInvoices: [
          invoice({
            id: "押金",
            invoiceNumber: "押金号",
            invoiceAmount: "79494",
            lines: [
              {
                id: "押金行",
                category: "lease_deposit",
                amount: "79494",
                verified: true,
              },
            ],
          }),
          variableInvoice("999", {
            id: "其他资产",
            rootId: "车辆合同",
            invoiceNumber: "资产号",
          }),
          variableInvoice("888", {
            id: "未来费用",
            invoiceNumber: "未来号",
            billingMonth: "2026-10",
          }),
          invoice({
            id: "其他房屋费用",
            invoiceNumber: "房屋其他号",
            invoiceAmount: "3.40",
            lines: [
              {
                id: "其他行",
                category: "other_cost",
                amount: "3.40",
                verified: true,
              },
            ],
          }),
        ],
      }),
    );
    expect(
      result.housingCostBreakdown!.find((row) => row.key === "electricity")!
        .amount,
    ).toBe("0");
    expect(
      result.housingCostBreakdown!.find((row) => row.key === "other_cost")!
        .amount,
    ).toBe("3.4");
    expect(sum(result.personnelAnnualDetails!.map((row) => row.overhead))).toBe(
      "218170.27",
    );
  });
  it("明确零物业合法、缺失物业仍未知，未加载变量来源不能假装变量为零", () => {
    const zero = personnel(
      fixture({
        rentAccrualContracts: [{ ...lease, monthlyPropertyFee: "0" }],
        housingCostInvoices: [],
      }),
    );
    expect(
      zero.housingCostBreakdown!.find(
        (row) => row.key === "property_management",
      )!.amount,
    ).toBe("0");
    const missing = personnel(
      fixture({
        rentAccrualContracts: [{ ...lease, monthlyPropertyFee: null }],
        housingCostInvoices: [],
      }),
    );
    expect(
      missing.housingCostBreakdown!.find(
        (row) => row.key === "property_management",
      ),
    ).toMatchObject({ amount: null, knownAmount: null });
    expect(
      sum(missing.personnelAnnualDetails!.map((row) => row.known_overhead)),
    ).toBe("167778.87");
    const unloaded = personnel(fixture({ housingCostInvoices: undefined }));
    expect(
      unloaded.housingCostBreakdown!.find((row) => row.key === "electricity")!
        .amount,
    ).toBeNull();
  });

  it("本期和同比加载全量发票去重后按相同完整租期摊销，不再按收费月份截断", async () => {
    jest.mocked(loadMonthlyFinancialHousingCostInvoices).mockResolvedValue([
      variableInvoice("10", {
        id: "本期电费",
        invoiceNumber: "本期号",
        billingMonth: "2026-08",
      }),
      variableInvoice("20", {
        id: "同期电费",
        invoiceNumber: "同期号",
        billingMonth: "2025-08",
        invoiceDate: "2025-09-01",
      }),
    ]);
    const query = jest.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM contracts rental\n")) return { rows: [lease] };
      if (sql.includes("FROM payroll_records payroll"))
        return { rows: wages(`${String(values[0]).slice(0, 4)}-08`) };
      return { rows: [] };
    });
    const data = await loadMonthlyFinancialAnalysis(
      {
        from: "2026-08",
        to: "2026-08",
        granularity: "month",
        comparisonYear: 2025,
      },
      {
        queryClient: { query } as never,
        loadReport: jest.fn(),
        now: new Date(generatedAt),
      },
    );
    const current = data.modules.find((row) => row.key === "personnel")!;
    const previous = data.comparison!.modules.find(
      (row) => row.key === "personnel",
    )!;
    expect(
      current.housingCostBreakdown!.find((row) => row.key === "electricity")!
        .amount,
    ).toBe("1.27");
    expect(
      previous.housingCostBreakdown!.find((row) => row.key === "electricity")!
        .amount,
    ).toBe("1.27");
    expect(current.housingCostBasis).toBe("invoice-lease");
    expect(previous.housingCostBasis).toBe("invoice-lease");
    expect(sum(current.details.map((row) => row.overhead))).toBe("1.27");
    expect(sum(previous.details.map((row) => row.overhead))).toBe("1.27");
  });
});
