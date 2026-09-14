/** @jest-environment node */
import {
  buildMonthlyFinancialAnalysis,
  loadMonthlyFinancialAnalysis,
  type AnalysisPayroll,
  type AnalysisPersonnelIncurredReimbursement,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { loadFinancialAnalysisSources } from "../server/services/monthlyFinancialAnalysisSources";
import { protectMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysisPermissions";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";

const generatedAt = "2026-09-07T02:00:00Z";
function wages(month = "2026-04"): AnalysisPayroll[] {
  return ["a", "b"].map((id) => ({
    id: `工资:${month}:${id}`,
    employeeId: id,
    userId: `用户:${id}`,
    personName: "同名人员",
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
function expense(
  changes: Partial<AnalysisPersonnelIncurredReimbursement> = {},
): AnalysisPersonnelIncurredReimbursement {
  return {
    id: "报销a",
    employeeId: "a",
    userId: "用户:a",
    personName: "同名人员",
    type: "basic",
    month: "2026-04",
    amount: "10",
    status: "completed",
    updatedAt: generatedAt,
    ...changes,
  };
}
function fixture(
  changes: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2026-04", to: "2026-04", granularity: "month" },
    generatedAt,
    reports: [],
    contracts: [],
    receipts: [],
    reimbursements: [],
    undatedReimbursements: [],
    reimbursementDatesComplete: { basic: true, large: true, business: true },
    personnelIncurredReimbursements: [],
    payroll: wages(),
    overheadCandidates: [],
    overheadAllocations: [],
    rentAccrualContracts: [],
    rentCurrentMonthMode: "daily",
    ...changes,
  };
}
function personnel(input = fixture()) {
  return buildMonthlyFinancialAnalysis(input).modules.find(
    (row) => row.key === "personnel",
  )!;
}
function missingCashDates(rows: AnalysisPersonnelIncurredReimbursement[]) {
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    employeeId: row.employeeId,
    userId: row.userId,
    personName: row.personName,
    amount: row.amount,
    date: null,
    status: "completed",
  }));
}

describe("人力报销按系统确认报销月份独立计算", () => {
  it("行政、商务与人力共用报销月份并逐月闭合，跨月付款和回单上传不改归月", () => {
    const rows = [
      expense({ id: "基础", type: "basic", month: "2026-04", amount: "10.01" }),
      expense({
        id: "大额",
        type: "large",
        month: "2026-04",
        amount: "20.02",
        status: "approved",
      }),
      expense({
        id: "商务",
        type: "business",
        month: "2026-04",
        amount: "30.03",
        scope: "朝阳客户",
        scopePath: "朝阳区 / 客户",
        region: "朝阳区",
        regionSource: "测试范围",
        serviceTarget: "客户",
      }),
    ];
    const data = buildMonthlyFinancialAnalysis(
      fixture({
        query: { from: "2026-04", to: "2026-05", granularity: "month" },
        personnelIncurredReimbursements: rows,
        reimbursements: rows.map((row) => ({
          id: row.id,
          type: row.type,
          date: "2026-05-20",
          amount: row.amount,
          employeeId: row.employeeId,
          userId: row.userId,
          personName: row.personName,
          title: row.title || row.id,
          category: row.category || null,
          scope: row.scope || null,
          scopePath: row.scopePath || null,
          region: row.region || null,
          regionSource: row.regionSource || null,
          serviceTarget: row.serviceTarget || null,
          updatedAt: row.updatedAt,
        })),
      }),
    );
    const outflow = data.modules.find((row) => row.key === "outflow")!;
    const business = data.modules.find((row) => row.key === "business")!;
    const human = data.modules.find((row) => row.key === "personnel")!;
    expect(outflow.outflowReimbursementBasis).toBe("reimbursement-month");
    expect(business.businessReimbursementBasis).toBe("reimbursement-month");
    expect(
      outflow.series.find((row) => row.key === "administration")!.values,
    ).toEqual(["30.03", "0"]);
    expect(business.series[0].values).toEqual(["30.03", "0"]);
    expect(business.breakdown).toEqual([
      expect.objectContaining({ key: "朝阳区 / 客户", amount: "30.03" }),
    ]);
    expect(business.details[0]).toMatchObject({
      month: "2026-04",
      date: null,
      sourceId: "商务",
      amount: "30.03",
    });
    const april = human.details.find((row) => row.from === "2026-04")!;
    expect(april).toMatchObject({
      basic: "10.01",
      large: "20.02",
      business: "30.03",
    });
    expect(addFinancialAmounts(april.basic!, april.large!)).toBe(
      outflow.series[0].values[0],
    );
    expect(april.business).toBe(business.series[0].values[0]);
    expect(
      addFinancialAmounts(april.basic!, april.large!, april.business!),
    ).toBe("60.06");
  });

  it("30笔缺付款日期但报销月份有效的记录全部归月，不再作为人力未归期或串到其他人员", () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      expense({
        id: `原报销:${index}`,
        employeeId: index < 26 ? "a" : "b",
        userId: index < 26 ? "用户:a" : "用户:b",
        type: index < 26 ? "basic" : "large",
        amount: index < 26 ? "10" : "2700",
      }),
    );
    const input = fixture({
      personnelIncurredReimbursements: rows,
      undatedReimbursements: missingCashDates(rows),
      reimbursementDatesComplete: {
        basic: false,
        large: false,
        business: true,
      },
    });
    const original = JSON.stringify(input);
    const result = personnel(input);
    expect(result.personnelReimbursementBasis).toBe("reimbursement-month");
    expect(result.personnelUnassignedReimbursements).toEqual([]);
    expect(result.details.find((row) => row.personId === "a")).toMatchObject({
      basic: "260",
      large: "0",
      total: "1260",
    });
    expect(result.details.find((row) => row.personId === "b")).toMatchObject({
      basic: "0",
      large: "10800",
      total: "11800",
    });
    expect(result.summaries.find((row) => row.key === "total")!.amount).toBe(
      "13060",
    );
    expect(
      result.details
        .flatMap((row) => row.sourceId!.split("、"))
        .filter((id) => id.startsWith("原报销:")),
    ).toHaveLength(30);
    expect(result.personnelAnnualDetails!.map((row) => row.knownTotal)).toEqual(
      ["1260", "11800"],
    );
    expect(JSON.stringify(input)).toBe(original);
  });

  it("三处报销归报销月，账户权威总额仍归付款月；现金月报不重复增加人员费用", () => {
    const report: FinancialAnalysisReport = {
      month: "2026-04",
      status: "closed",
      generatedAt,
      savedAt: generatedAt,
      closedAt: generatedAt,
      accounts: [],
      income: { mainReceipt: "0", generalInterest: "0" },
      manualItems: [],
      sources: [
        { key: "payroll", status: "ready", amount: "1000" },
        { key: "reimbursements", status: "missing" },
      ],
      automaticDetails: [
        {
          sourceType: "payroll",
          sourceId: "冻结工资",
          occurredOn: "2026-04-01",
          accountCode: "general",
          metric: "human_cost",
          amount: "1000",
          description: "原工资",
          personId: "a",
          personName: "同名人员",
        },
        {
          sourceType: "reimbursement",
          sourceId: "报销a",
          occurredOn: "2026-04-20",
          accountCode: "general",
          metric: "basic_reimbursement",
          amount: "99",
          description: "原现金报销快照",
          personId: "a",
          personName: "同名人员",
        },
      ],
    };
    const input = fixture({
      query: { from: "2026-04", to: "2026-06", granularity: "month" },
      reports: [report],
      payroll: wages().map((row) => ({
        ...row,
        salary: "9000",
        netActual: "9000",
      })),
      personnelIncurredReimbursements: [expense({ amount: "50.100000000001" })],
      reimbursements: [
        {
          id: "报销a",
          type: "basic",
          date: "2026-06-15",
          employeeId: "a",
          userId: "用户:a",
          personName: "同名人员",
          amount: "50.100000000001",
          title: "六月付款",
          category: "other",
          scope: null,
          serviceTarget: null,
          updatedAt: generatedAt,
        },
      ],
    });
    const current = buildMonthlyFinancialAnalysis(input);
    const legacy = buildMonthlyFinancialAnalysis({
      ...input,
      personnelIncurredReimbursements: undefined,
    });
    expect(
      current.modules.filter(
        (row) => !["personnel", "outflow", "business"].includes(row.key),
      ),
    ).toEqual(
      legacy.modules.filter(
        (row) => !["personnel", "outflow", "business"].includes(row.key),
      ),
    );
    const currentOutflow = current.modules.find(
      (row) => row.key === "outflow",
    )!;
    const legacyOutflow = legacy.modules.find((row) => row.key === "outflow")!;
    expect(
      currentOutflow.series.find((row) => row.key === "administration")!.values,
    ).toEqual(["50.100000000001", "0", "0"]);
    expect(
      currentOutflow.series.find((row) => row.key === "total")!.values,
    ).toEqual(legacyOutflow.series.find((row) => row.key === "total")!.values);
    const result = current.modules.find((row) => row.key === "personnel")!;
    expect(result.series.find((row) => row.key === "basic")!.values).toEqual([
      "50.100000000001",
      "0",
      "0",
    ]);
    expect(
      result.details.find(
        (row) => row.from === "2026-04" && row.personId === "a",
      ),
    ).toMatchObject({
      payrollCost: "1000",
      basic: "50.100000000001",
      knownTotal: "1050.100000000001",
    });
    expect(
      currentOutflow.details.filter((row) => row.sourceId === "报销a"),
    ).toEqual([
      expect.objectContaining({
        month: "2026-04",
        date: null,
        amount: "50.100000000001",
      }),
    ]);
  });

  it("只接收已审批/已付款/已完成，不把待审批或驳回月份作为实际成本", () => {
    const statuses = [
      "approved",
      "paid",
      "payment_uploaded",
      "completed",
      "draft",
      "pending",
      "pending_first",
      "pending_second",
      "pending_final",
      "rejected",
    ];
    const result = personnel(
      fixture({
        personnelIncurredReimbursements: statuses.map((status) =>
          expense({
            id: status,
            status,
            month: status === "rejected" ? null : "2026-04",
          }),
        ),
      }),
    );
    expect(result.details.find((row) => row.personId === "a")!.basic).toBe(
      "40",
    );
    expect(result.personnelUnassignedReimbursements).toEqual([]);
  });

  it("报销月缺失只影响本人同类费用，人员无法确认则仍影响全员，原因与原月份独立展示", () => {
    const result = personnel(
      fixture({
        personnelIncurredReimbursements: [
          expense({ type: "large", month: "2026-13" }),
        ],
      }),
    );
    expect(
      result.details.find((row) => row.personId === "a")!.large,
    ).toBeNull();
    expect(result.details.find((row) => row.personId === "b")!.large).toBe("0");
    expect(result.personnelUnassignedReimbursements).toEqual([
      {
        sourceId: "报销a",
        type: "large",
        amount: "10",
        date: null,
        month: "2026-13",
        reason: "报销月份缺失或无效",
        status: "completed",
        personId: "a",
        personName: "同名人员",
      },
    ]);
    const unknown = personnel(
      fixture({
        personnelIncurredReimbursements: [
          expense({
            type: "large",
            month: null,
            employeeId: null,
            userId: null,
          }),
        ],
      }),
    );
    expect(unknown.details.every((row) => row.large === null)).toBe(true);
    const unknownPersonInApril = personnel(
      fixture({
        personnelIncurredReimbursements: [
          expense({ type: "large", employeeId: null, userId: null }),
        ],
      }),
    );
    expect(
      unknownPersonInApril.details
        .filter((row) => ["a", "b"].includes(row.personId!))
        .every((row) => row.large === null),
    ).toBe(true);
    expect(
      unknownPersonInApril.details.find((row) =>
        row.personId?.startsWith("unknown:"),
      )!.known_large,
    ).toBe("10");
  });

  it("未来报销月份不进入已发生和年度；完整年外月份不偷加到当前年", () => {
    const result = personnel(
      fixture({
        personnelIncurredReimbursements: [
          expense({ id: "历史年", month: "2025-04", amount: "30" }),
          expense({ id: "本年已发生", month: "2026-04", amount: "20" }),
          expense({ id: "未来月份", month: "2026-10", amount: "9999" }),
        ],
      }),
    );
    expect(
      result.personnelAnnualDetails!.find((row) => row.personId === "a")!
        .known_basic,
    ).toBe("20");
    expect(result.details.find((row) => row.personId === "a")!.basic).toBe(
      "20",
    );
    expect(result.personnelUnassignedReimbursements).toEqual([]);
    expect(
      result.details.every((row) => !row.sourceId?.includes("未来月份")),
    ).toBe(true);
  });

  it("工资、逐月房租与三类报销按月季年合计闭合，筛选人员不改变房租分母", () => {
    for (const granularity of ["month", "quarter", "year"] as const) {
      const input = fixture({
        query: { from: "2026-04", to: "2026-06", granularity },
        payroll: ["2026-04", "2026-05", "2026-06"].flatMap(wages),
        rentAccrualContracts: [
          {
            id: "租约",
            title: "房租",
            status: "executing",
            effectiveAt: "2026-01-01",
            leaseStartDate: "2026-01-01",
            leaseEndDate: "2026-12-31",
            monthlyRent: "120",
          },
        ],
        personnelIncurredReimbursements: [
          expense({ amount: "0.100000000001" }),
          expense({
            id: "大额b",
            employeeId: "b",
            userId: "用户:b",
            type: "large",
            month: "2026-05",
            amount: "0.2",
          }),
          expense({
            id: "商务a",
            type: "business",
            month: "2026-06",
            amount: "0.3",
          }),
        ],
      });
      const result = personnel(input);
      expect(result.summaries.find((row) => row.key === "total")!.amount).toBe(
        "6360.600000000001",
      );
      expect(
        addFinancialAmounts(...result.details.map((row) => row.total!)),
      ).toBe("6360.600000000001");
      const selected = personnel({
        ...input,
        query: { ...input.query, personId: "a" },
      });
      expect(
        addFinancialAmounts(...selected.details.map((row) => row.overhead!)),
      ).toBe("180");
      expect(selected.personnelUnassignedReimbursements).toEqual([]);
    }
  });

  it("重复记录不能重复累计，矛盾月份或金额拒绝响应，敏感工资字段不随报销清单输出", () => {
    const row = expense();
    expect(
      personnel(
        fixture({ personnelIncurredReimbursements: [row, { ...row }] }),
      ).details.find((item) => item.personId === "a")!.basic,
    ).toBe("10");
    expect(() =>
      personnel(
        fixture({
          personnelIncurredReimbursements: [row, { ...row, month: "2026-05" }],
        }),
      ),
    ).toThrow("同编号");
    expect(() =>
      personnel(
        fixture({
          personnelIncurredReimbursements: [row, { ...row, amount: "11" }],
        }),
      ),
    ).toThrow("同编号");
    const original = buildMonthlyFinancialAnalysis(
      fixture({
        personnelIncurredReimbursements: [
          {
            ...expense({ month: null }),
            salary: "99999.123456789012",
          } as AnalysisPersonnelIncurredReimbursement,
        ],
      }),
    );
    const protectedData = protectMonthlyFinancialAnalysis(
      original,
      "general_manager",
    );
    expect(JSON.stringify(protectedData)).not.toContain("99999.123456789012");
    expect(
      protectedData.modules
        .find((module) => module.key === "personnel")!
        .details.every(
          (detail) =>
            detail.salary === undefined && detail.known_salary === undefined,
        ),
    ).toBe(true);
  });
});

describe("报销月份来源的读取与双期合并", () => {
  function database() {
    return {
      query: jest.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes("FROM reimbursements personnel_reimbursement"))
          return {
            rows: [
              expense(),
              expense({ id: "往年报销", month: "2025-04", amount: "20" }),
            ],
          };
        if (sql.includes("FROM payroll_records payroll"))
          return { rows: wages(`${String(values[0]).slice(0, 4)}-04`) };
        return { rows: [] };
      }),
    };
  }
  it("只读完整确认来源，明确用报销月份，不回填或引用付款日期，不按姓名联人", async () => {
    const db = database();
    const source = await loadFinancialAnalysisSources(
      { from: "2026-04", to: "2026-04", granularity: "month" },
      { queryClient: db as never, loadReport: jest.fn() },
    );
    expect(source.personnelIncurredReimbursements).toHaveLength(2);
    const sql = db.query.mock.calls
      .map(([statement]) => statement)
      .find((statement) =>
        statement.includes("FROM reimbursements personnel_reimbursement"),
      )!;
    expect(sql).toContain(
      "personnel_reimbursement.reimbursement_month AS month",
    );
    expect(sql).toContain(
      "('approved', 'paid', 'payment_uploaded', 'completed')",
    );
    expect(sql).toContain("personnel_reimbursement.is_deleted = FALSE");
    expect(sql).toContain("employee.user_id = personnel_reimbursement.user_id");
    expect(sql).not.toContain("payment_business_date");
    expect(sql).not.toContain("BETWEEN");
    expect(
      db.query.mock.calls.every(([statement]) =>
        /^\s*SELECT\b/u.test(statement),
      ),
    ).toBe(true);
  });
  it("本期同比读取完整报销历史后按稳定身份去重，各自月份和年度只计一次", async () => {
    const result = await loadMonthlyFinancialAnalysis(
      {
        from: "2026-04",
        to: "2026-04",
        granularity: "month",
        comparisonYear: 2025,
      },
      {
        queryClient: database() as never,
        loadReport: jest.fn(),
        now: new Date(generatedAt),
      },
    );
    const current = result.modules.find((row) => row.key === "personnel")!;
    const previous = result.comparison!.modules.find(
      (row) => row.key === "personnel",
    )!;
    expect(current.details.find((row) => row.personId === "a")!.basic).toBe(
      "10",
    );
    expect(previous.details.find((row) => row.personId === "a")!.basic).toBe(
      "20",
    );
    expect(
      current.personnelAnnualDetails!.find((row) => row.personId === "a")!
        .known_basic,
    ).toBe("10");
    expect(
      previous.personnelAnnualDetails!.find((row) => row.personId === "a")!
        .known_basic,
    ).toBe("20");
  });
});
