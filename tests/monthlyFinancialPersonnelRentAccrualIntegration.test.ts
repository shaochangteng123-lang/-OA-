/** @jest-environment node */
import {
  buildMonthlyFinancialAnalysis,
  loadMonthlyFinancialAnalysis,
  type AnalysisPayroll,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { loadFinancialAnalysisSources } from "../server/services/monthlyFinancialAnalysisSources";
import type { AnalysisRentAccrualContract } from "../server/services/monthlyFinancialRentAccrual";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";

const generatedAt = "2026-09-07T02:00:00Z";
const ids = ["a", "b", "c", "d", "e", "f"];
function lease(
  changes: Partial<AnalysisRentAccrualContract> = {},
): AnalysisRentAccrualContract {
  return {
    id: "房屋租赁",
    title: "办公房屋租赁",
    status: "executing",
    effectiveAt: "2025-06-01T00:00:00Z",
    leaseStartDate: "2025-06-16",
    leaseEndDate: "2027-06-15",
    monthlyRent: "20378",
    previousContractId: null,
    actualEndDate: null,
    hasUnresolvedChange: false,
    updatedAt: "2026-09-01T00:00:00Z",
    ...changes,
  };
}
function wages(month: string): AnalysisPayroll[] {
  return ids.map((id) => ({
    id: `工资:${month}:${id}`,
    employeeId: id,
    userId: `用户:${id}`,
    personName: `合成员工${id}`,
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
function fixture(
  changes: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2026-01", to: "2026-09", granularity: "month" },
    generatedAt,
    reports: [],
    contracts: [],
    receipts: [],
    reimbursements: [],
    undatedReimbursements: [],
    reimbursementDatesComplete: { basic: true, large: true, business: true },
    payroll: Array.from({ length: 9 }, (_, index) =>
      wages(`2026-${String(index + 1).padStart(2, "0")}`),
    ).flat(),
    overheadAllocations: [],
    overheadCandidates: [],
    rentAccrualContracts: [lease()],
    rentCurrentMonthMode: "daily",
    generalPayments: [],
    ...changes,
  };
}
function personnel(input = fixture()) {
  return buildMonthlyFinancialAnalysis(input).modules.find(
    (row) => row.key === "personnel",
  )!;
}
function rentTotal(rows: ReturnType<typeof personnel>["details"]) {
  return addFinancialAmounts(
    ...rows.map((row) => row.known_overhead!).filter((value) => value !== null),
  );
}
function frozenAugust(): FinancialAnalysisReport {
  return {
    month: "2026-08",
    status: "closed",
    generatedAt,
    savedAt: generatedAt,
    closedAt: generatedAt,
    income: { mainReceipt: "0", generalInterest: "0" },
    accounts: [],
    manualItems: [],
    sources: [
      { key: "payroll", status: "ready", amount: "6000" },
      { key: "asset_payments", status: "missing" },
    ],
    automaticDetails: [
      ...wages("2026-08").map((row) => ({
        sourceType: "payroll" as const,
        sourceId: row.id,
        occurredOn: "2026-08-01",
        accountCode: "general",
        metric: "human_cost",
        amount: "1000",
        description: "冻结工资",
        personId: row.employeeId,
        personName: row.personName,
      })),
      {
        sourceType: "asset_payment",
        sourceId: "旧划拨付款",
        occurredOn: "2026-08-31",
        accountCode: "general",
        metric: "asset_administration",
        amount: "79967.06",
        description: "旧月报划拨来源",
      },
    ],
  };
}

describe("租期发生额接入人力分摊，不改现金支出", () => {
  it("1至8月每月房租20378，本月按实际发生天数，六人每月尾差与年度精确闭合", () => {
    const source = fixture();
    const before = JSON.stringify(source);
    const result = personnel(source);
    expect(result.series.find((row) => row.key === "overhead")).toMatchObject({
      label: "房租分摊（按发生期间）",
      values: [...Array(8).fill("20378"), "4754.87"],
    });
    expect(result.details).toHaveLength(54);
    expect(
      result.details
        .filter((row) => row.from === "2026-08")
        .map((row) => row.overhead),
    ).toEqual([
      "3396.33",
      "3396.33",
      "3396.34",
      "3396.34",
      "3396.33",
      "3396.33",
    ]);
    expect(
      result.details
        .filter((row) => row.from === "2026-09")
        .map((row) => row.overhead),
    ).toEqual(["792.48", "792.48", "792.48", "792.47", "792.48", "792.48"]);
    expect(result.personnelAnnualDetails).toHaveLength(6);
    expect(rentTotal(result.personnelAnnualDetails!)).toBe("167778.87");
    expect(
      result.personnelAnnualDetails!.map((row) => row.known_overhead),
    ).toEqual([
      "27963.15",
      "27963.15",
      "27963.15",
      "27963.14",
      "27963.14",
      "27963.14",
    ]);
    expect(result.details[0].sourceState).toContain("仅房租，不含物业、押金");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("只查一个月或一个人仍读取同年累计分摊，不随筛选和粒度重新发尾差", () => {
    const base = fixture();
    const full = personnel(base);
    for (const granularity of ["month", "quarter", "year"] as const) {
      const single = personnel({
        ...base,
        query: { from: "2026-08", to: "2026-08", granularity, personId: "c" },
      });
      expect(single.details[0].overhead).toBe(
        full.details.find(
          (row) => row.personId === "c" && row.from === "2026-08",
        )!.overhead,
      );
      expect(single.personnelAnnualDetails![0].known_overhead).toBe("27963.15");
    }
    expect(full.warnings.join()).toContain("累计应摊与已摊差额");
  });

  it("月季年使用相同发生额，当前月整月模式不预估未来月份", () => {
    for (const granularity of ["month", "quarter", "year"] as const) {
      const result = personnel(
        fixture({
          query: { from: "2026-01", to: "2026-09", granularity },
          rentCurrentMonthMode: "full-month",
        }),
      );
      expect(rentTotal(result.details)).toBe("183402");
      expect(rentTotal(result.personnelAnnualDetails!)).toBe("183402");
      expect(result.details).toHaveLength(
        granularity === "month" ? 54 : granularity === "quarter" ? 18 : 6,
      );
      expect(result.personnelAnnualDetails).toHaveLength(6);
    }
    const future = personnel(
      fixture({
        query: { from: "2026-09", to: "2026-10", granularity: "month" },
        payroll: [...wages("2026-09"), ...wages("2026-10")],
        rentCurrentMonthMode: "full-month",
      }),
    );
    expect(future.series.find((row) => row.key === "overhead")!.values).toEqual(
      ["20378", null],
    );
    expect(
      future.details
        .filter((row) => row.from === "2026-10")
        .every((row) => row.known_overhead === null),
    ).toBe(true);
  });

  it("8月旧资产付款编号错配或资产来源缺失不阻断租期发生额，工资仍沿用原快照", () => {
    const result = personnel(
      fixture({
        query: { from: "2026-08", to: "2026-08", granularity: "month" },
        reports: [frozenAugust()],
        payroll: wages("2026-08").map((row) => ({
          ...row,
          salary: "9000",
          netActual: "9000",
        })),
        overheadCandidates: [
          {
            id: "真实对外付款",
            kind: "external_payment",
            date: "2026-08-31",
            amount: "79967.06",
            title: "不作为发生额依据",
            scopeCoverage: "unknown",
            scopeConflict: true,
          },
        ],
      }),
    );
    expect(result.series.find((row) => row.key === "overhead")!.values).toEqual(
      ["20378"],
    );
    expect(
      result.series.find((row) => row.key === "payrollCost")!.values,
    ).toEqual(["6000"]);
    expect(
      result.details.every(
        (row) =>
          row.sourceId!.includes("rent-accrual:") &&
          !row.sourceId!.includes("真实对外付款"),
      ),
    ).toBe(true);
    expect(result.warnings.join()).not.toContain(
      "未能与月报同编号同金额来源核对",
    );
  });

  it("缺月租、租期或未确认变更保持未知，不按合同总额或付款猜测；无当月工资名单不任意分摊", () => {
    for (const missing of [
      lease({ monthlyRent: null }),
      lease({ leaseStartDate: null }),
      lease({ hasUnresolvedChange: true }),
      lease({ status: "terminated", actualEndDate: null }),
    ]) {
      const result = personnel(
        fixture({
          query: { from: "2026-08", to: "2026-08", granularity: "month" },
          rentAccrualContracts: [missing],
        }),
      );
      expect(
        result.series.find((row) => row.key === "overhead")!.values,
      ).toEqual([null]);
      expect(
        result.details.every(
          (row) => row.known_overhead === null && row.knownTotal === "1000",
        ),
      ).toBe(true);
    }
    const emptyRoster = personnel(
      fixture({
        query: { from: "2026-08", to: "2026-08", granularity: "month" },
        payroll: wages("2026-07"),
      }),
    );
    expect(
      emptyRoster.details.find((row) => row.sourceState === "未分摊费用")
        ?.overhead,
    ).toBe("20378");
    expect(
      emptyRoster.series.find((row) => row.key === "overhead")!.values,
    ).toEqual([null]);
  });

  it("仅改变人力成本，不变更其他六模块原始公司支出，也不把押金物业或现金付款当月租", () => {
    const source = fixture({
      generalPayments: [
        {
          id: "真实资产付款",
          date: "2026-08-31",
          amount: "79967.06",
          currency: "CNY",
          title: "含物业押金等现金支出",
          updatedAt: generatedAt,
        },
      ],
    });
    const old = buildMonthlyFinancialAnalysis({
      ...source,
      rentAccrualContracts: undefined,
    });
    const accrued = buildMonthlyFinancialAnalysis(source);
    expect(accrued.modules.filter((row) => row.key !== "personnel")).toEqual(
      old.modules.filter((row) => row.key !== "personnel"),
    );
    const noLease = personnel({ ...source, rentAccrualContracts: [] });
    expect(
      noLease.series.find((row) => row.key === "overhead")!.values,
    ).toEqual(Array(9).fill("0"));
    expect(rentTotal(noLease.personnelAnnualDetails!)).toBe("0");
  });

  it("本人筛选不改变当月六人分母，同期自然年按原租期且离职人员不丢失", () => {
    const data = buildMonthlyFinancialAnalysis(
      fixture({
        query: {
          from: "2026-08",
          to: "2026-08",
          granularity: "month",
          comparisonYear: 2025,
          personId: "a",
        },
        payroll: [
          ...wages("2026-08"),
          ...[
            "2025-06",
            "2025-07",
            "2025-08",
            "2025-09",
            "2025-10",
            "2025-11",
            "2025-12",
          ].flatMap(wages),
        ],
      }),
    );
    for (const modules of [data.modules, data.comparison!.modules]) {
      const result = modules.find((row) => row.key === "personnel")!;
      expect(result.details).toHaveLength(1);
      expect(result.details[0]).toMatchObject({
        personId: "a",
        overhead: "3396.34",
      });
    }
    const past = data.comparison!.modules.find(
      (row) => row.key === "personnel",
    )!;
    expect(past.personnelAnnualDetails![0].known_overhead).toBe("22076.17");
  });
});

describe("租期来源读取与跨年版本合并", () => {
  it("只读加载全量有效房屋租赁根合同，保留明确独立月租与续租链，不推断退租日", async () => {
    const query = jest.fn(async (sql: string) => ({
      rows: sql.includes("FROM contracts rental\n") ? [lease()] : [],
    }));
    const source = await loadFinancialAnalysisSources(
      { from: "2026-08", to: "2026-08", granularity: "month" },
      {
        queryClient: { query } as never,
        loadReport: jest.fn(),
        now: new Date(generatedAt),
      },
    );
    expect(source.rentAccrualContracts).toEqual([lease()]);
    expect(source.rentCurrentMonthMode).toBe("daily");
    const sql = query.mock.calls
      .map(([statement]) => statement)
      .find((statement) => statement.includes("FROM contracts rental\n"))!;
    expect(sql).toContain("rental.lease_monthly_rent::text");
    expect(sql).toContain("rental.relation_type = 'main'");
    expect(sql).toContain("= 'house_rental'");
    expect(sql).toContain("rental.financial_direction = 'cost'");
    expect(sql).toContain("rental.renewed_from_contract_id");
    expect(sql).toContain('NULL::text AS "actualEndDate"');
    expect(sql).toContain("rental.version::text AS version");
    expect(sql).toContain('AS "hasUnresolvedChange"');
    expect(sql).toContain("LEFT(rental_change.effective_at, 10) <= $1");
    expect(sql).not.toContain("effective_at <= $1::timestamptz");
    expect(sql).not.toContain("terminated_at");
    expect(sql).not.toContain("payment_date");
    expect(sql).not.toContain("BETWEEN");
    expect(
      query.mock.calls.every(([statement]) => /^\s*SELECT\b/u.test(statement)),
    ).toBe(true);
  });

  it("两期加载同一租赁不重复计提，冲突版本不被按编号后写覆盖", async () => {
    for (const conflicting of [false, true]) {
      let rentReads = 0;
      const query = jest.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM contracts rental\n"))
          return {
            rows: [
              { ...lease(), version: String(conflicting ? ++rentReads : 1) },
            ],
          };
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
      for (const modules of [data.modules, data.comparison!.modules]) {
        const result = modules.find((row) => row.key === "personnel")!;
        expect(
          result.series.find((row) => row.key === "overhead")!.values,
          // 新读取口径没有已确认发票时不再用合同月租产生费用；冲突版本仍未知。
        ).toEqual([conflicting ? null : "0"]);
      }
    }
  });
});
