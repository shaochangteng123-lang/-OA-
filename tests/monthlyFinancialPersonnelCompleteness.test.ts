import {
  buildMonthlyFinancialAnalysis,
  type AnalysisOverheadAllocation,
  type AnalysisPayroll,
  type AnalysisReimbursement,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";
import { financialOverheadScopeEvidence } from "../server/services/monthlyFinancialOverheadScope";

const generatedAt = "2026-09-04T08:00:00.000Z";
function wage(
  id = "a",
  month = "2026-08",
  overrides: Partial<AnalysisPayroll> = {},
): AnalysisPayroll {
  return {
    id: `pay:${id}:${month}`,
    employeeId: id,
    userId: `user:${id}`,
    personName: `合成员工${id}`,
    month,
    salary: "1000",
    housingBase: "0",
    contributionBase: "0",
    tax: "0",
    withheldActual: "100",
    netActual: "900",
    updatedAt: generatedAt,
    ...overrides,
  };
}
function reimbursement(
  type: AnalysisReimbursement["type"],
  amount = "20",
  date = "2026-08-15",
): AnalysisReimbursement {
  return {
    id: `${type}:${date}`,
    userId: "user:a",
    employeeId: "a",
    personName: "合成员工a",
    type,
    date,
    amount,
    title: "合成费用",
    category: "other",
    scope: null,
    serviceTarget: null,
    updatedAt: generatedAt,
  };
}
function allocation(
  overrides: Partial<AnalysisOverheadAllocation> = {},
): AnalysisOverheadAllocation {
  return {
    id: "match",
    paymentId: "payment",
    paymentKind: "payment",
    date: "2026-08-15",
    currency: "CNY",
    paymentAmount: "300",
    amount: "300",
    invoiceId: "invoice",
    invoiceAmount: "300",
    title: "合成公共费用",
    updatedAt: generatedAt,
    lines: [{ id: "rent", category: "rent", amount: "300", verified: true }],
    ...overrides,
  };
}
function input(
  overrides: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2026-08", to: "2026-08", granularity: "month" },
    generatedAt,
    reports: [],
    receipts: [],
    contracts: [],
    payroll: [wage()],
    reimbursements: [],
    reimbursementDatesComplete: { basic: true, large: true, business: true },
    overheadAllocations: [],
    overheadCandidates: [],
    ...overrides,
  };
}
function report(
  overrides: Partial<FinancialAnalysisReport> = {},
): FinancialAnalysisReport {
  return {
    month: "2026-08",
    status: "closed",
    generatedAt,
    savedAt: generatedAt,
    closedAt: generatedAt,
    accounts: [],
    income: { mainReceipt: "0", generalInterest: "0" },
    manualItems: [],
    sources: [
      { key: "payroll", status: "ready", amount: "1000", recordCount: 1 },
    ],
    automaticDetails: [
      {
        sourceType: "payroll",
        sourceId: "pay:a:2026-08",
        occurredOn: "2026-08-01",
        accountCode: "general",
        metric: "human_cost",
        amount: "1000",
        description: "工资成本",
        personId: "a",
        personName: "合成员工a",
      },
    ],
    ...overrides,
  };
}
function personnel(source: MonthlyFinancialAnalysisInput) {
  return buildMonthlyFinancialAnalysis(source).modules.find(
    (row) => row.key === "personnel",
  )!;
}
function point(source: MonthlyFinancialAnalysisInput, key: string) {
  return personnel(source).series.find((row) => row.key === key)!.values[0];
}

describe("人员成本按分项独立完整性", () => {
  it("整月没有可核验记录时已知部分折线也未知，真实零记录或完整冻结零值仍为零", () => {
    const empty = input({ payroll: [] });
    expect(point(empty, "payrollCost")).toBeNull();
    expect(point(empty, "knownTotal")).toBeNull();
    expect(
      personnel(empty).summaries.find((row) => row.key === "knownTotal")!
        .amount,
    ).toBeNull();
    const zeroRecord = input({
      payroll: [
        wage("a", "2026-08", {
          salary: "0",
          withheldActual: "0",
          netActual: "0",
        }),
      ],
    });
    expect(point(zeroRecord, "knownTotal")).toBe("0");
    const frozenZero = input({
      payroll: [],
      reports: [
        report({
          automaticDetails: [],
          sources: [
            { key: "payroll", status: "empty", amount: "0", recordCount: 0 },
          ],
        }),
      ],
    });
    expect(point(frozenZero, "knownTotal")).toBe("0");
    expect(point(frozenZero, "total")).toBe("0");
  });

  it("本期与同期分别使用本年度工资，不因另一年的人员记录改变各月值", () => {
    const result = buildMonthlyFinancialAnalysis(
      input({
        query: {
          from: "2026-08",
          to: "2026-08",
          granularity: "month",
          comparisonYear: 2025,
        },
        payroll: [
          wage(),
          wage("a", "2025-08", { salary: "2000", netActual: "1900" }),
        ],
      }),
    );
    expect(
      result.modules
        .find((row) => row.key === "personnel")!
        .series.find((row) => row.key === "payrollCost")!.values,
    ).toEqual(["1000"]);
    expect(
      result
        .comparison!.modules.find((row) => row.key === "personnel")!
        .series.find((row) => row.key === "payrollCost")!.values,
    ).toEqual(["2000"]);
  });

  it("可靠工资不受三类未归期报销和未知公共费用连带抹除", () => {
    const source = input({
      reimbursementDatesComplete: {
        basic: false,
        large: false,
        business: false,
      },
      overheadCandidates: [
        {
          id: "unknown",
          kind: "payment",
          date: "2026-08-15",
          amount: "300",
          title: "合成费用",
          scopeCoverage: "unknown",
        },
      ],
    });
    const result = personnel(source);
    expect(result.series.map((row) => row.key)).toEqual([
      "payrollCost",
      "salary",
      "social",
      "housing",
      "adjustment",
      "basic",
      "large",
      "business",
      "overhead",
      "knownTotal",
      "total",
    ]);
    expect(point(source, "payrollCost")).toBe("1000");
    expect(point(source, "salary")).toBe("1000");
    for (const key of ["social", "housing", "adjustment"])
      expect(point(source, key)).toBe("0");
    for (const key of ["basic", "large", "business", "overhead", "total"])
      expect(point(source, key)).toBeNull();
    expect(point(source, "knownTotal")).toBe("1000");
    expect(
      result.series.find((row) => row.key === "knownTotal")!.label,
    ).toContain("已知部分");
    expect(result.details[0].salary).toBe("1000");
    expect(result.details[0].overhead).toBeNull();
    expect(
      result.summaries.find((row) => row.key === "total")!.amount,
    ).toBeNull();
  });

  it.each(["basic", "large", "business"] as const)(
    "%s缺日期仅阻断自身分项与完整总额，不猜测已归期部分是完整额",
    (type) => {
      const source = input({
        reimbursementDatesComplete: {
          basic: true,
          large: true,
          business: true,
          [type]: false,
        },
        reimbursements: [reimbursement(type)],
      });
      expect(point(source, type)).toBeNull();
      expect(point(source, "payrollCost")).toBe("1000");
      for (const other of ["basic", "large", "business"].filter(
        (key) => key !== type,
      ))
        expect(point(source, other)).toBe("0");
      expect(point(source, "overhead")).toBe("0");
      expect(point(source, "total")).toBeNull();
      expect(point(source, "knownTotal")).toBe("1020");
      expect(personnel(source).details[0][type]).toBeNull();
    },
  );

  it("无效报销日期即使错误标记完整，也不计入已知成本或变成真实零", () => {
    const source = input({
      reimbursements: [reimbursement("business", "50", "2026-08-32")],
    });
    expect(point(source, "business")).toBeNull();
    expect(point(source, "salary")).toBe("1000");
    expect(point(source, "knownTotal")).toBe("1000");
  });

  it("工资未提供或目标月未建立名单不能从报销记录推断工资为零", () => {
    for (const payroll of [undefined, [], [wage("a", "2026-07")]]) {
      const source = input({
        payroll,
        reimbursements: [reimbursement("basic")],
      });
      expect(point(source, "payrollCost")).toBeNull();
      expect(point(source, "salary")).toBeNull();
      expect(point(source, "basic")).toBe("20");
      expect(point(source, "overhead")).toBe("0");
      expect(point(source, "total")).toBeNull();
      expect(point(source, "knownTotal")).toBe("20");
    }
  });

  it("完整当月工资名单中没有所选人员时为零，仍保留该年离职人员年度实际成本", () => {
    const source = input({
      query: {
        from: "2026-08",
        to: "2026-08",
        granularity: "month",
        personId: "b",
      },
      payroll: [
        wage("a"),
        wage("b", "2026-07", { salary: "2000", netActual: "1900" }),
      ],
    });
    const result = personnel(source);
    expect(point(source, "payrollCost")).toBe("0");
    expect(point(source, "total")).toBe("0");
    expect(result.details).toHaveLength(1);
    expect(result.details[0].personId).toBe("b");
    expect(result.details[0].payrollCost).toBe("0");
    expect(result.details[0].annualTotal).toBe("2000");
  });

  it("来源未加载不能补零，其他已提供且完整的分项继续显示", () => {
    const source = input({
      reimbursements: undefined,
      overheadAllocations: undefined,
      overheadCandidates: undefined,
    });
    expect(point(source, "salary")).toBe("1000");
    expect(point(source, "business")).toBeNull();
    expect(point(source, "overhead")).toBeNull();
    expect(point(source, "total")).toBeNull();
  });

  it("公共费用来源缺失不影响工资；工资来源缺失也不影响已冻结报销", () => {
    const bill = report();
    bill.sources!.push({ key: "asset_payments", status: "missing" });
    const source = input({
      reports: [bill],
      overheadCandidates: [
        {
          id: "已确认租金",
          kind: "payment",
          date: "2026-08-15",
          amount: "300",
          title: "已确认租金",
          scopeCoverage: "included",
        },
      ],
    });
    expect(point(source, "payrollCost")).toBe("1000");
    expect(point(source, "overhead")).toBeNull();
    expect(point(source, "total")).toBeNull();
    const absentWages = report({
      sources: [{ key: "payroll", status: "missing" }],
    });
    absentWages.automaticDetails.push({
      sourceType: "reimbursement",
      sourceId: "frozen",
      occurredOn: "2026-08-15",
      accountCode: "general",
      metric: "basic_reimbursement",
      amount: "20",
      description: "冻结报销",
      personId: "a",
    });
    const noWages = input({ reports: [absentWages] });
    expect(point(noWages, "payrollCost")).toBeNull();
    expect(point(noWages, "basic")).toBe("20");
  });

  it("旧月结无工资分项保留工资总成本，不用当前工资组成或未归期报销覆盖历史", () => {
    const source = input({
      reports: [report()],
      payroll: [wage("a", "2026-08", { salary: "9000", netActual: "8900" })],
      reimbursementDatesComplete: {
        basic: false,
        large: false,
        business: false,
      },
    });
    expect(point(source, "payrollCost")).toBe("1000");
    for (const key of ["salary", "social", "housing", "adjustment"])
      expect(point(source, key)).toBeNull();
    expect(point(source, "basic")).toBe("0");
    expect(point(source, "total")).toBe("1000");
    expect(personnel(source).details[0].payrollCost).toBe("1000");
  });

  it("新月结已冻结分项保持原值，当前工资变化不回写历史", () => {
    const bill = report();
    bill.automaticDetails[0].analysis = {
      schemaVersion: 1,
      canonicalPersonId: "a",
      payrollParts: {
        salary: "900",
        social: "60",
        housing: "40",
        adjustment: "0",
      },
    };
    const source = input({
      reports: [bill],
      payroll: [wage("a", "2026-08", { salary: "7000", netActual: "6900" })],
    });
    expect(point(source, "salary")).toBe("900");
    expect(point(source, "social")).toBe("60");
    expect(point(source, "housing")).toBe("40");
    expect(point(source, "payrollCost")).toBe("1000");
    expect(point(source, "total")).toBe("1000");
  });

  it("工资快照明细与原来源汇总不闭合时，不用当前工资表补差或给零", () => {
    const source = input({
      reports: [
        report({
          sources: [{ key: "payroll", status: "ready", amount: "1100" }],
        }),
      ],
    });
    expect(point(source, "payrollCost")).toBeNull();
    expect(point(source, "total")).toBeNull();
    expect(point(source, "knownTotal")).toBe("1000");
  });

  it("未来期间所有分项与总额保持未知，预生成工资不作为已知实际额", () => {
    const source = input({
      query: { from: "2026-09", to: "2026-10", granularity: "month" },
      payroll: [wage("a", "2026-09"), wage("a", "2026-10")],
    });
    const result = personnel(source);
    for (const series of result.series) expect(series.values[1]).toBeNull();
    expect(
      result.series.find((row) => row.key === "payrollCost")!.values,
    ).toEqual(["1000", null]);
    expect(
      result.details.find((row) => row.month === "2026-10")!.knownTotal,
    ).toBeNull();
    expect(
      result.summaries.find((row) => row.key === "knownTotal")!.amount,
    ).toBe("1000");
  });

  it("月季年、明细和结构使用同一精确口径，工资汇总不在总成本中重复相加", () => {
    for (const granularity of ["month", "quarter", "year"] as const) {
      const source = input({
        query: { from: "2026-01", to: "2026-03", granularity },
        payroll: [
          wage("a", "2026-01"),
          wage("a", "2026-02"),
          wage("a", "2026-03"),
        ],
        reimbursements: [
          reimbursement("basic", "0.100000000001", "2026-01-10"),
          reimbursement("business", "0.2", "2026-02-10"),
        ],
        overheadAllocations: [allocation({ date: "2026-03-15" })],
        overheadCandidates: [
          {
            id: "payment",
            kind: "payment",
            date: "2026-03-15",
            amount: "300",
            title: "合成租金",
            scopeCoverage: "included",
          },
        ],
      });
      const result = personnel(source);
      expect(result.summaries.find((row) => row.key === "total")!.amount).toBe(
        "3300.300000000001",
      );
      expect(
        result.summaries.find((row) => row.key === "payrollCost")!.amount,
      ).toBe("3000");
      expect(result.breakdown).toHaveLength(8);
      expect(result.breakdown.some((row) => row.key === "payrollCost")).toBe(
        false,
      );
      for (const key of [
        "payrollCost",
        "salary",
        "social",
        "housing",
        "adjustment",
        "basic",
        "large",
        "business",
        "overhead",
        "total",
      ]) {
        const series = result.series.find((row) => row.key === key)!;
        series.values.forEach((value, index) => {
          const details = result.details.filter(
            (row) => row.month === result.periods[index].from,
          );
          expect(value).toBe(
            addFinancialAmounts(...details.map((row) => row[key] as string)),
          );
        });
      }
    }
  });

  it("工资已有精确实际覆盖额保持十二位精度，不通过浮点聚合", () => {
    const source = input({
      payroll: [
        wage("a", "2026-08", {
          withheldActual: "100.100000000001",
          netActual: "900.200000000002",
        }),
      ],
    });
    expect(point(source, "payrollCost")).toBe("1000.300000000003");
    expect(point(source, "adjustment")).toBe("0.300000000003");
    expect(point(source, "total")).toBe("1000.300000000003");
  });
});

describe("人员公共费用真实候选与范围边界", () => {
  it.each([
    { date: "2026-08-32", expenseCategory: "rent" },
    { date: "2026-08-15", expenseCategory: "internet" },
  ])(
    "真实范围证据%j有日期或分类冲突时不进入已知分摊",
    ({ date, expenseCategory }) => {
      const matched = allocation({ date });
      const candidate = {
        id: "payment",
        kind: "payment",
        date,
        amount: "300",
        title: "合成费用",
        expenseCategory,
        rawMatchCount: "1",
      };
      const evidence = financialOverheadScopeEvidence(candidate, [matched]);
      expect(evidence.scopeCoverage).toBe("unknown");
      expect(evidence.scopeConflict).toBe(true);
      const source = input({
        overheadAllocations: [matched],
        overheadCandidates: [{ ...candidate, ...evidence }],
      });
      expect(point(source, "payrollCost")).toBe("1000");
      expect(point(source, "overhead")).toBeNull();
      expect(point(source, "total")).toBeNull();
      expect(point(source, "knownTotal")).toBe("1000");
      expect(personnel(source).details[0].sourceState).not.toContain(
        "平均分摊",
      );
    },
  );

  it("付款未匹配的七百元仍未知，但同笔已核验三百元可保留为已知部分", () => {
    const matched = allocation({ paymentAmount: "1000" });
    const candidate = {
      id: "payment",
      kind: "payment",
      date: "2026-08-15",
      amount: "1000",
      title: "合成费用",
      expenseCategory: "rent",
      rawMatchCount: "1",
    };
    const evidence = financialOverheadScopeEvidence(candidate, [matched]);
    expect(evidence.scopeCoverage).toBe("unknown");
    expect(evidence.scopeConflict).not.toBe(true);
    const source = input({
      overheadAllocations: [matched],
      overheadCandidates: [{ ...candidate, ...evidence }],
    });
    expect(point(source, "payrollCost")).toBe("1000");
    expect(point(source, "overhead")).toBeNull();
    expect(point(source, "total")).toBeNull();
    expect(point(source, "knownTotal")).toBe("1300");
    expect(personnel(source).details[0].knownTotal).toBe("1300");
  });

  it.each(["-1", "无效金额"])(
    "分配金额%s无效时不能进入已知成本或打断工资展示",
    (amount) => {
      const source = input({
        overheadAllocations: [allocation({ amount })],
        overheadCandidates: [
          {
            id: "payment",
            kind: "payment",
            date: "2026-08-15",
            amount: "300",
            title: "合成费用",
            scopeCoverage: "unknown",
          },
        ],
      });
      expect(point(source, "payrollCost")).toBe("1000");
      expect(point(source, "knownTotal")).toBe("1000");
      expect(point(source, "overhead")).toBeNull();
    },
  );

  it("没有分配行的无效日期候选也不能因过滤而被当作公共费用零", () => {
    const source = input({
      overheadCandidates: [
        {
          id: "bad-date",
          kind: "payment",
          date: "无效日期",
          amount: "300",
          title: "合成费用",
          scopeCoverage: "unknown",
          scopeConflict: true,
        },
      ],
    });
    expect(point(source, "overhead")).toBeNull();
    expect(point(source, "payrollCost")).toBe("1000");
    expect(point(source, "knownTotal")).toBe("1000");
  });

  it("已证明范围外的付款不阻断公共费用真实零，也不增加人员成本", () => {
    const source = input({
      overheadCandidates: [
        {
          id: "car",
          kind: "payment",
          date: "2026-08-15",
          amount: "100",
          title: "标题不参与判断",
          scopeCoverage: "excluded",
          scopeReason: "结构化范围证据",
        },
      ],
    });
    expect(point(source, "overhead")).toBe("0");
    expect(point(source, "total")).toBe("1000");
    expect(point(source, "knownTotal")).toBe("1000");
  });

  it("范围外已核验票据即使没有对应旧月报来源，也不能牵连工资或公共费用", () => {
    const source = input({
      reports: [report()],
      overheadCandidates: [
        {
          id: "payment",
          kind: "payment",
          date: "2026-08-15",
          amount: "300",
          title: "其他费用",
          scopeCoverage: "excluded",
        },
      ],
      overheadAllocations: [
        allocation({
          lines: [
            {
              id: "other",
              category: "other_cost",
              amount: "300",
              verified: true,
            },
          ],
        }),
      ],
    });
    expect(point(source, "overhead")).toBe("0");
    expect(point(source, "total")).toBe("1000");
  });

  it("实际对外付款匹配月报时沿用external_payment，不制造同编号普通付款缺口", () => {
    const bill = report();
    bill.automaticDetails.push({
      sourceType: "asset_payment",
      sourceId: "payment",
      occurredOn: "2026-08-15",
      accountCode: "general",
      metric: "asset_administration",
      amount: "300",
      description: "真实对外付款",
    });
    const source = input({
      reports: [bill],
      overheadAllocations: [allocation({ paymentKind: "external_payment" })],
      overheadCandidates: [
        {
          id: "payment",
          kind: "external_payment",
          date: "2026-08-15",
          amount: "300",
          title: "合成费用",
          scopeCoverage: "included",
        },
      ],
    });
    expect(point(source, "overhead")).toBe("300");
    expect(point(source, "total")).toBe("1300");
    expect(personnel(source).warnings.join()).not.toContain(
      "未具备全额票款匹配",
    );
  });

  it("同编号两种真实付款不能合并到一笔旧月报，也不能重复灌入已知成本", () => {
    const bill = report();
    bill.automaticDetails.push({
      sourceType: "asset_payment",
      sourceId: "payment",
      occurredOn: "2026-08-15",
      accountCode: "general",
      metric: "asset_administration",
      amount: "300",
      description: "原月报付款",
    });
    const source = input({
      reports: [bill],
      overheadAllocations: [
        allocation(),
        allocation({
          id: "second",
          paymentKind: "external_payment",
          invoiceId: "second-invoice",
        }),
      ],
      overheadCandidates: ["payment", "external_payment"].map((kind) => ({
        id: "payment",
        kind,
        date: "2026-08-15",
        amount: "300",
        title: "合成费用",
        scopeCoverage: "included" as const,
      })),
    });
    expect(point(source, "payrollCost")).toBe("1000");
    expect(point(source, "overhead")).toBeNull();
    expect(point(source, "total")).toBeNull();
    expect(point(source, "knownTotal")).toBe("1000");
  });
});
