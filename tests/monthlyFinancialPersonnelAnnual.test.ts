/** @jest-environment node */
import * as XLSX from "xlsx";
import {
  buildMonthlyFinancialAnalysis,
  type AnalysisPayroll,
  type AnalysisReimbursement,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { protectMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysisPermissions";
import { buildMonthlyFinancialAnalysisWorkbook } from "../server/services/monthlyFinancialAnalysisWorkbook";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";

const generatedAt = "2026-09-07T02:00:00.000Z";
function wage(
  month: string,
  employeeId = "a",
  salary = "1000",
): AnalysisPayroll {
  return {
    id: `工资:${month}:${employeeId}`,
    employeeId,
    userId: `用户:${employeeId}`,
    personName: `测试人员${employeeId}`,
    month,
    salary,
    housingBase: "0",
    contributionBase: "0",
    tax: "0",
    withheldActual: "0",
    netActual: salary,
    updatedAt: generatedAt,
  };
}
function reimbursement(
  date: string,
  type: AnalysisReimbursement["type"],
  amount: string,
  employeeId = "a",
): AnalysisReimbursement {
  return {
    id: `报销:${date}:${type}:${employeeId}`,
    date,
    type,
    amount,
    employeeId,
    userId: `用户:${employeeId}`,
    personName: `测试人员${employeeId}`,
    title: "合成报销",
    category: "other",
    scope: null,
    serviceTarget: null,
    updatedAt: generatedAt,
  };
}
function fixture(
  changes: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    generatedAt,
    query: { from: "2026-07", to: "2026-09", granularity: "month" },
    reports: [],
    receipts: [],
    contracts: [],
    payroll: [wage("2026-07"), wage("2026-08"), wage("2026-09")],
    reimbursements: [],
    reimbursementDatesComplete: { basic: true, large: true, business: true },
    overheadAllocations: [],
    overheadCandidates: [],
    ...changes,
  };
}
function personnel(source = fixture()) {
  return buildMonthlyFinancialAnalysis(source).modules.find(
    (module) => module.key === "personnel",
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
    sources: [{ key: "payroll", status: "ready", amount: "1200" }],
    automaticDetails: [
      {
        sourceType: "payroll",
        sourceId: "冻结工资",
        occurredOn: "2026-08-01",
        accountCode: "general",
        metric: "human_cost",
        amount: "1200",
        description: "历史冻结工资缺分项",
        personId: "a",
        personName: "测试人员a",
      },
    ],
  };
}

describe("人力成本逐人分项与独立自然年清单", () => {
  it("每月明细明确起止，独立年度只汇总一次并保留十二位精度", () => {
    const source = fixture({
      payroll: [
        { ...wage("2026-01"), netActual: "1000.123456789012" },
        wage("2026-08"),
      ],
      reimbursements: [
        reimbursement("2026-07-15", "basic", "0.100000000001"),
        reimbursement("2026-08-15", "business", "0.2"),
      ],
    });
    const result = personnel(source);
    expect(
      result.details.map(({ from, to, year }) => ({ from, to, year })),
    ).toEqual([
      { from: "2026-07", to: "2026-07", year: "2026" },
      { from: "2026-08", to: "2026-08", year: "2026" },
      { from: "2026-09", to: "2026-09", year: "2026" },
    ]);
    expect(result.personnelAnnualDetails).toHaveLength(1);
    expect(result.personnelAnnualDetails![0]).toMatchObject({
      from: "2026-01",
      to: "2026-09",
      year: "2026",
      personId: "a",
      salary: null,
      known_salary: "2000",
      known_adjustment: "0.123456789012",
      known_basic: "0.100000000001",
      known_business: "0.2",
      total: null,
      knownTotal: "2000.423456789013",
      annualTotal: "2000.423456789013",
    });
    expect(
      result.details.every((row) => row.annualTotal === "2000.423456789013"),
    ).toBe(true);
  });

  it("部分报销已归期金额不被完整性缺口抹去，空且未知不伪造零", () => {
    const result = personnel(
      fixture({
        reimbursementDatesComplete: {
          basic: false,
          large: false,
          business: false,
        },
        reimbursements: [reimbursement("2026-08-15", "business", "20.40")],
      }),
    );
    const august = result.details.find((row) => row.from === "2026-08")!;
    expect(august).toMatchObject({
      business: null,
      known_business: "20.4",
      basic: null,
      known_basic: null,
      large: null,
      known_large: null,
      overhead: "0",
      known_overhead: "0",
      total: null,
      knownTotal: "1020.4",
    });
    expect(result.personnelAnnualDetails![0]).toMatchObject({
      known_business: "20.4",
      known_basic: null,
      knownTotal: "3020.4",
      total: null,
    });
  });

  it("旧月结缺工资分项时保留工资汇总，年度成本不把汇总与分项重复相加", () => {
    const result = personnel(fixture({ reports: [closedReport()] }));
    const august = result.details.find((row) => row.from === "2026-08")!;
    expect(august).toMatchObject({
      payrollCost: "1200",
      known_payrollCost: "1200",
      salary: null,
      known_salary: null,
      knownTotal: "1200",
    });
    expect(result.personnelAnnualDetails![0]).toMatchObject({
      known_payrollCost: "3200",
      known_salary: "2000",
      knownTotal: "3200",
    });
  });

  it("季度分项与月度精确一致，年度不受当前季度窗口截断", () => {
    const source = fixture({
      payroll: [
        wage("2026-01"),
        wage("2026-07"),
        wage("2026-08"),
        wage("2026-09"),
      ],
      reimbursements: [reimbursement("2026-08-15", "business", "0.03")],
    });
    const months = personnel(source);
    const quarter = personnel({
      ...source,
      query: { ...source.query, granularity: "quarter" },
    });
    expect(quarter.details).toHaveLength(1);
    expect(quarter.details[0]).toMatchObject({
      from: "2026-07",
      to: "2026-09",
      year: "2026",
      total: "3000.03",
      knownTotal: "3000.03",
      annualTotal: "4000.03",
    });
    for (const key of [
      "salary",
      "business",
      "payrollCost",
      "known_salary",
      "known_business",
      "known_payrollCost",
      "knownTotal",
      "total",
    ])
      expect(quarter.details[0][key]).toBe(
        addFinancialAmounts(...months.details.map((row) => row[key]!)),
      );
    expect(quarter.personnelAnnualDetails).toEqual(
      months.personnelAnnualDetails,
    );
  });

  it("自然年涵盖离职人员，剔除年外来源、未来工资和当前月未来付款", () => {
    const result = personnel(
      fixture({
        payroll: [
          wage("2025-12", "年外人员"),
          wage("2026-01", "离职人员", "2000"),
          wage("2026-08"),
          wage("2026-10", "未来人员"),
        ],
        reimbursements: [
          reimbursement("2026-09-06", "business", "10"),
          reimbursement("2026-09-08", "business", "99999"),
        ],
      }),
    );
    const annual = result.personnelAnnualDetails!;
    expect(annual.map((row) => row.personId).sort()).toEqual(["a", "离职人员"]);
    expect(annual.find((row) => row.personId === "离职人员")).toMatchObject({
      knownTotal: "2000",
    });
    expect(annual.find((row) => row.personId === "a")).toMatchObject({
      knownTotal: "1010",
      to: "2026-09",
    });
    expect(JSON.stringify(annual)).not.toContain("99999");
    expect(
      personnel(
        fixture({
          query: { from: "2027-01", to: "2027-12", granularity: "year" },
          payroll: [wage("2027-01")],
        }),
      ).personnelAnnualDetails,
    ).toEqual([]);
  });

  it("同比年度使用完整历史自然年并独立选择人员，不把本年值搬入往年", () => {
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
          wage("2025-02", "a", "500"),
          wage("2025-12", "a", "700"),
          wage("2026-01", "a", "1100"),
          wage("2026-08", "a", "1300"),
          wage("2026-08", "b", "999"),
        ],
      }),
    );
    const current = data.modules.find((module) => module.key === "personnel")!;
    const prior = data.comparison!.modules.find(
      (module) => module.key === "personnel",
    )!;
    expect(current.personnelAnnualDetails).toHaveLength(1);
    expect(current.personnelAnnualDetails![0]).toMatchObject({
      personId: "a",
      year: "2026",
      from: "2026-01",
      to: "2026-09",
      knownTotal: "2400",
    });
    expect(prior.personnelAnnualDetails).toHaveLength(1);
    expect(prior.personnelAnnualDetails![0]).toMatchObject({
      personId: "a",
      year: "2025",
      from: "2025-01",
      to: "2025-12",
      knownTotal: "1200",
    });
  });

  it("完整自然年的十二个月汇总为一个年度行，工资总成本与拆分只计一次", () => {
    const result = personnel(
      fixture({
        query: { from: "2025-01", to: "2025-12", granularity: "year" },
        payroll: Array.from({ length: 12 }, (_, index) =>
          wage(`2025-${String(index + 1).padStart(2, "0")}`),
        ),
      }),
    );
    expect(result.personnelAnnualDetails).toHaveLength(1);
    expect(result.personnelAnnualDetails![0]).toMatchObject({
      from: "2025-01",
      to: "2025-12",
      salary: "12000",
      payrollCost: "12000",
      known_salary: "12000",
      known_payrollCost: "12000",
      total: "12000",
      knownTotal: "12000",
    });
    expect(result.details[0].knownTotal).toBe("12000");
  });

  it("公共费缺日期的完整性约束覆盖自然年，而非仅当前查询月份", () => {
    const result = personnel(
      fixture({
        query: { from: "2026-08", to: "2026-08", granularity: "month" },
        overheadCandidates: [
          {
            id: "缺失日期费用",
            kind: "payment",
            date: "",
            amount: "100",
            title: "缺失日期费用",
            scopeCoverage: "unknown",
          },
        ],
      }),
    );
    expect(result.details[0].known_overhead).toBeNull();
    expect(result.personnelAnnualDetails![0]).toMatchObject({
      overhead: null,
      known_overhead: null,
      total: null,
      knownTotal: "3000",
    });
  });
});

describe("人力年度清单权限与精确导出", () => {
  const sensitiveKeys = ["salary", "social", "housing", "adjustment"];
  it("本期与同比所有年度已知工资分项均按管理员权限裁剪，不改变原数据", () => {
    const data = buildMonthlyFinancialAnalysis(
      fixture({
        query: {
          from: "2026-08",
          to: "2026-08",
          granularity: "month",
          comparisonYear: 2025,
        },
        payroll: [wage("2026-08"), wage("2025-08")],
      }),
    );
    for (const module of [...data.modules, ...data.comparison!.modules].filter(
      (item) => item.key === "personnel",
    ))
      for (const key of sensitiveKeys) {
        module.series.push({
          key: `known_${key}`,
          label: "敏感已知工资分项",
          values: ["87654.123456789012"],
        });
        module.summaries.push({
          key: `known_${key}`,
          label: "敏感已知工资分项",
          amount: "87654.123456789012",
        });
        module.comparison.push({
          key: `known_${key}`,
          label: "敏感已知工资分项",
          amount: "87654.123456789012",
        });
      }
    const original = JSON.stringify(data);
    const protectedData = protectMonthlyFinancialAnalysis(
      data,
      "general_manager",
    );
    expect(JSON.stringify(protectedData)).not.toContain("87654.123456789012");
    for (const module of [
      ...protectedData.modules,
      ...protectedData.comparison!.modules,
    ].filter((item) => item.key === "personnel")) {
      for (const detail of [
        ...module.details,
        ...module.personnelAnnualDetails!,
      ]) {
        for (const key of sensitiveKeys) {
          expect(detail[key]).toBeUndefined();
          expect(detail[`known_${key}`]).toBeUndefined();
          expect(
            module.columns.some(
              (column) => column.key === key || column.key === `known_${key}`,
            ),
          ).toBe(false);
        }
        expect(detail.personId).toBe("a");
        expect(detail.known_payrollCost).toBe("1000");
      }
    }
    expect(JSON.stringify(data)).toBe(original);
    expect(
      protectMonthlyFinancialAnalysis(data, "admin").modules.find(
        (item) => item.key === "personnel",
      )!.personnelAnnualDetails![0].known_salary,
    ).toBe("1000");
  });

  it("年度及同比年度独立工作表保留完整金额和已知分项的十进制文本，并服从权限", () => {
    const precise = "123456789012345678.123456789012";
    const data = buildMonthlyFinancialAnalysis(
      fixture({
        query: {
          from: "2026-08",
          to: "2026-08",
          granularity: "month",
          comparisonYear: 2025,
        },
        payroll: [
          { ...wage("2026-08"), netActual: precise },
          { ...wage("2025-08"), netActual: precise },
        ],
        reimbursementDatesComplete: {
          basic: false,
          large: true,
          business: true,
        },
      }),
    );
    for (const role of ["admin", "general_manager"]) {
      const safe = protectMonthlyFinancialAnalysis(data, role);
      const workbook = XLSX.read(
        buildMonthlyFinancialAnalysisWorkbook(safe, "personnel"),
        { type: "buffer" },
      );
      expect(workbook.SheetNames).toHaveLength(7);
      for (const name of ["人力成本分析-年度", "对比期-人力成本分析-年度"]) {
        const sheet = workbook.Sheets[name];
        expect(sheet).toBeDefined();
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain("自然年");
        expect(rows[0]).toContain("期间已知来源合计");
        expect(rows[1]).toContain(precise);
        expect(rows[1]).toContain("未取得数据");
        expect(rows[0].includes("应发工资（已知部分）")).toBe(role === "admin");
        for (const cell of Object.values(sheet).filter(
          (value) =>
            value &&
            typeof value === "object" &&
            "v" in value &&
            value.v === precise,
        ))
          expect(cell).toMatchObject({ t: "s", v: precise });
      }
    }
  });
});
