/** @jest-environment node */
import {
  buildMonthlyFinancialAnalysis,
  loadMonthlyFinancialAnalysis,
  type AnalysisPayroll,
  type AnalysisReimbursement,
  type AnalysisUndatedReimbursement,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { loadFinancialAnalysisSources } from "../server/services/monthlyFinancialAnalysisSources";
import { protectMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysisPermissions";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";

const generatedAt = "2026-09-07T02:00:00Z";
function wage(employeeId = "a", month = "2026-08"): AnalysisPayroll {
  return {
    id: `工资:${employeeId}:${month}`,
    employeeId,
    userId: `用户:${employeeId}`,
    personName: "相同姓名不用于关联",
    month,
    salary: "1000",
    housingBase: "0",
    contributionBase: "0",
    tax: "0",
    withheldActual: "0",
    netActual: "1000",
    updatedAt: generatedAt,
  };
}
function pending(
  changes: Partial<AnalysisUndatedReimbursement> = {},
): AnalysisUndatedReimbursement {
  return {
    id: "未归期大额",
    type: "large",
    amount: "10800",
    date: null,
    status: "paid",
    employeeId: "b",
    userId: "用户:b",
    personName: "相同姓名不用于关联",
    ...changes,
  };
}
function reimbursement(
  changes: Partial<AnalysisReimbursement> = {},
): AnalysisReimbursement {
  return {
    id: "已归期大额",
    type: "large",
    amount: "500.100000000001",
    date: "2026-08-03",
    employeeId: "a",
    userId: "用户:a",
    personName: "相同姓名不用于关联",
    title: "已付款费用",
    category: "other",
    scope: null,
    serviceTarget: null,
    updatedAt: generatedAt,
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
    contracts: [],
    receipts: [],
    reimbursements: [],
    undatedReimbursements: [pending()],
    reimbursementDatesComplete: { basic: true, large: false, business: true },
    payroll: [wage("a"), wage("b")],
    overheadCandidates: [],
    overheadAllocations: [],
    ...changes,
  };
}
function personnel(input = fixture()) {
  return buildMonthlyFinancialAnalysis(input).modules.find(
    (row) => row.key === "personnel",
  )!;
}

describe("人员报销完整性按稳定身份独立判断", () => {
  it("乙的未归期大额不抹掉甲的真实零，全员及乙的完整金额仍未知，原数据不变", () => {
    const source = fixture();
    const before = JSON.stringify(source);
    const result = personnel(source);
    expect(result.details.find((row) => row.personId === "a")).toMatchObject({
      large: "0",
      known_large: "0",
      total: "1000",
    });
    expect(result.details.find((row) => row.personId === "b")).toMatchObject({
      large: null,
      known_large: null,
      total: null,
      knownTotal: "1000",
    });
    expect(result.series.find((row) => row.key === "large")!.values).toEqual([
      null,
    ]);
    expect(
      result.summaries.find((row) => row.key === "total")!.amount,
    ).toBeNull();
    expect(result.personnelUnassignedReimbursements).toEqual([
      {
        sourceId: "未归期大额",
        type: "large",
        amount: "10800",
        date: null,
        status: "paid",
        personId: "b",
        personName: "相同姓名不用于关联",
      },
    ]);
    expect(
      result.details.every((row) => !row.sourceId?.includes("未归期大额")),
    ).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("已归期多笔按实际付款月份精确统计，未归期本人记录仅独立展示而不塞进任意月", () => {
    const source = fixture({
      reimbursements: [
        reimbursement(),
        reimbursement({ id: "第二笔", amount: "0.2" }),
        reimbursement({
          id: "乙已归期",
          employeeId: "b",
          userId: "用户:b",
          amount: "30",
        }),
      ],
      undatedReimbursements: [pending({ amount: "10800.123456789012" })],
    });
    const result = personnel(source);
    expect(result.details.find((row) => row.personId === "a")).toMatchObject({
      large: "500.300000000001",
      known_large: "500.300000000001",
      total: "1500.300000000001",
    });
    expect(result.details.find((row) => row.personId === "b")).toMatchObject({
      large: null,
      known_large: "30",
      knownTotal: "1030",
    });
    expect(
      addFinancialAmounts(...result.details.map((row) => row.knownTotal!)),
    ).toBe("2530.300000000001");
    expect(result.personnelUnassignedReimbursements![0].amount).toBe(
      "10800.123456789012",
    );
    const selected = personnel({
      ...source,
      query: { ...source.query, personId: "a" },
    });
    expect(selected.series.find((row) => row.key === "large")!.values).toEqual([
      "500.300000000001",
    ]);
    expect(selected.personnelUnassignedReimbursements).toEqual([]);
  });

  it("人员未知的未归期记录仍影响每个人，姓名相同不视为同一人员", () => {
    const result = personnel(
      fixture({
        undatedReimbursements: [
          pending({
            employeeId: null,
            userId: null,
            personName: "相同姓名不用于关联",
          }),
        ],
      }),
    );
    expect(
      result.details.every(
        (row) => row.large === null && row.known_large === null,
      ),
    ).toBe(true);
    expect(result.personnelUnassignedReimbursements![0].personId).toBeNull();
    const selected = personnel(
      fixture({
        query: {
          from: "2026-08",
          to: "2026-08",
          granularity: "month",
          personId: "a",
        },
        undatedReimbursements: [pending({ employeeId: null, userId: null })],
      }),
    );
    expect(selected.personnelUnassignedReimbursements).toHaveLength(1);
    expect(selected.details[0].large).toBeNull();
  });

  it("只提供账号编号时使用工资来源员工映射，历史无工资人员保持稳定账号身份", () => {
    const result = personnel(
      fixture({
        undatedReimbursements: [
          pending({ employeeId: null }),
          pending({
            id: "历史账号记录",
            employeeId: null,
            userId: "历史账号",
            type: "basic",
            amount: "10",
          }),
        ],
      }),
    );
    expect(
      result.personnelUnassignedReimbursements!.map((row) => row.personId),
    ).toEqual(["b", "user:历史账号"]);
    expect(result.details.find((row) => row.personId === "a")!.large).toBe("0");
    expect(
      result.details.find((row) => row.personId === "user:历史账号")!.basic,
    ).toBeNull();
    expect(
      result.personnelAnnualDetails!.some(
        (row) => row.personId === "user:历史账号",
      ),
    ).toBe(true);
  });

  it("年度、季度和同比都隔离本人缺口，未归期金额不重复加进年度", () => {
    for (const granularity of ["month", "quarter", "year"] as const) {
      const data = buildMonthlyFinancialAnalysis(
        fixture({
          query: {
            from: "2026-07",
            to: "2026-09",
            granularity,
            comparisonYear: 2025,
          },
          payroll: [
            "2025-07",
            "2025-08",
            "2025-09",
            "2026-07",
            "2026-08",
            "2026-09",
          ].flatMap((month) => [wage("a", month), wage("b", month)]),
        }),
      );
      for (const result of [data.modules, data.comparison!.modules].map(
        (rows) => rows.find((row) => row.key === "personnel")!,
      )) {
        expect(
          result.details
            .filter((row) => row.personId === "a")
            .every((row) => row.large === "0"),
        ).toBe(true);
        expect(
          result.details
            .filter((row) => row.personId === "b")
            .every((row) => row.large === null),
        ).toBe(true);
        expect(
          result.personnelAnnualDetails!.find((row) => row.personId === "a"),
        ).toMatchObject({ large: "0", knownTotal: "3000" });
        expect(
          result.personnelAnnualDetails!.find((row) => row.personId === "b"),
        ).toMatchObject({ large: null, knownTotal: "3000" });
        expect(result.personnelUnassignedReimbursements).toHaveLength(1);
      }
    }
  });

  it("已月结快照仍优先，不以当前未归期清单推翻已冻结零", () => {
    const report: FinancialAnalysisReport = {
      month: "2026-08",
      status: "closed",
      generatedAt,
      savedAt: generatedAt,
      closedAt: generatedAt,
      accounts: [],
      income: { mainReceipt: "0", generalInterest: "0" },
      manualItems: [],
      sources: [{ key: "payroll", status: "ready", amount: "1000" }],
      automaticDetails: [
        {
          sourceType: "payroll",
          sourceId: "冻结工资a",
          metric: "human_cost",
          accountCode: "general",
          occurredOn: "2026-08-01",
          amount: "1000",
          description: "冻结工资",
          personId: "a",
          personName: "甲",
        },
      ],
    };
    const result = personnel(fixture({ reports: [report] }));
    expect(result.details.find((row) => row.personId === "b")!.large).toBe("0");
    expect(result.personnelUnassignedReimbursements).toHaveLength(1);
  });

  it("未加载人员清单或全类型缺口与空清单矛盾时保持保守，未知不变成零", () => {
    for (const undatedReimbursements of [undefined, []]) {
      const result = personnel(fixture({ undatedReimbursements }));
      expect(result.details.every((row) => row.large === null)).toBe(true);
    }
    const result = personnel(
      fixture({
        undatedReimbursements: [],
        reimbursementDatesComplete: {
          basic: true,
          large: true,
          business: true,
        },
      }),
    );
    expect(result.details.every((row) => row.large === "0")).toBe(true);
  });

  it("无效业务日期的直接来源也按实际人员诊断，不误进入月份或影响无关人员", () => {
    const result = personnel(
      fixture({
        undatedReimbursements: [],
        reimbursementDatesComplete: {
          basic: true,
          large: true,
          business: true,
        },
        reimbursements: [
          reimbursement({
            employeeId: "b",
            userId: "用户:b",
            date: "2026-08-32",
          }),
        ],
      }),
    );
    expect(result.details.find((row) => row.personId === "a")!.large).toBe("0");
    expect(
      result.details.find((row) => row.personId === "b")!.large,
    ).toBeNull();
    expect(result.personnelUnassignedReimbursements![0].date).toBe(
      "2026-08-32",
    );
    expect(result.details.every((row) => row.knownTotal === "1000")).toBe(true);
  });

  it("重复来源不重复列示，人员关联冲突保持无主，金额冲突阻止响应", () => {
    const same = pending();
    expect(
      personnel(fixture({ undatedReimbursements: [same, { ...same }] }))
        .personnelUnassignedReimbursements,
    ).toHaveLength(1);
    const conflict = personnel(
      fixture({
        undatedReimbursements: [
          same,
          { ...same, employeeId: "a", userId: "用户:a" },
        ],
      }),
    );
    expect(conflict.personnelUnassignedReimbursements).toHaveLength(1);
    expect(conflict.personnelUnassignedReimbursements![0].personId).toBeNull();
    expect(conflict.details.every((row) => row.large === null)).toBe(true);
    expect(() =>
      personnel(
        fixture({ undatedReimbursements: [same, { ...same, amount: "20" }] }),
      ),
    ).toThrow("同编号");
    const ambiguousAccount = personnel(
      fixture({
        undatedReimbursements: [pending({ userId: "用户:a", employeeId: "b" })],
      }),
    );
    expect(
      ambiguousAccount.personnelUnassignedReimbursements![0].personId,
    ).toBeNull();
    expect(ambiguousAccount.details.every((row) => row.large === null)).toBe(
      true,
    );
  });

  it("未归期清单只输出明确字段，不携带工资数据且沿用既有财务权限", () => {
    const raw = { ...pending(), salary: "99999.123456789012" };
    const data = buildMonthlyFinancialAnalysis(
      fixture({ undatedReimbursements: [raw] }),
    );
    const safe = protectMonthlyFinancialAnalysis(
      data,
      "general_manager",
    ).modules.find((row) => row.key === "personnel")!;
    expect(safe.payrollDetailsVisible).toBe(false);
    expect(
      Object.keys(safe.personnelUnassignedReimbursements![0]).sort(),
    ).toEqual(
      [
        "sourceId",
        "type",
        "amount",
        "date",
        "status",
        "personId",
        "personName",
      ].sort(),
    );
    expect(JSON.stringify(safe)).not.toContain("99999.123456789012");
    expect(
      safe.details.every(
        (row) => row.salary === undefined && row.known_salary === undefined,
      ),
    ).toBe(true);
  });
});

describe("未归期人员清单只读来源与双期合并", () => {
  function client() {
    const rows = [0, 1, 2, 3].map((index) =>
      pending({ id: `未归期${index}`, amount: "2700" }),
    );
    const query = jest.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM reimbursements undated_reimbursement"))
        return { rows };
      if (sql.includes("FROM reimbursements personnel_reimbursement"))
        return {
          rows: rows.map((row) => ({
            ...row,
            month: null,
            updatedAt: generatedAt,
          })),
        };
      if (sql.includes("GROUP BY type ORDER BY type"))
        return { rows: [{ type: "large", count: "4", amount: "10800" }] };
      if (sql.includes("FROM payroll_records payroll"))
        return {
          rows: [
            wage("a", `${String(values[0]).slice(0, 4)}-08`),
            wage("b", `${String(values[0]).slice(0, 4)}-08`),
          ],
        };
      return { rows: [] };
    });
    return { query };
  }
  it("全历史清单按员工账号关联，保留付款状态/删除边界，不用姓名与任意月份补日期", async () => {
    const database = client();
    const source = await loadFinancialAnalysisSources(
      { from: "2026-08", to: "2026-08", granularity: "month", personId: "a" },
      { queryClient: database as never, loadReport: jest.fn() },
    );
    expect(source.undatedReimbursements).toHaveLength(4);
    expect(source.reimbursementDatesComplete!.large).toBe(false);
    const sql = database.query.mock.calls
      .map(([statement]) => statement)
      .find((statement) =>
        statement.includes("FROM reimbursements undated_reimbursement"),
      )!;
    expect(sql).toContain("employee.user_id = undated_reimbursement.user_id");
    expect(sql).toContain(
      "undated_reimbursement.payment_business_date IS NULL",
    );
    expect(sql).toContain("undated_reimbursement.is_deleted = FALSE");
    expect(sql).toContain("('paid', 'payment_uploaded', 'completed')");
    expect(sql).not.toContain("BETWEEN");
    expect(sql).not.toContain("applicant_name =");
    expect(
      database.query.mock.calls.every(([statement]) =>
        /^\s*SELECT\b/u.test(statement),
      ),
    ).toBe(true);
  });
  it("本期、同比及窗口反复加载同一未归期清单不重复金额或污染甲的大额零", async () => {
    const database = client();
    const data = await loadMonthlyFinancialAnalysis(
      {
        from: "2026-08",
        to: "2026-08",
        granularity: "month",
        comparisonYear: 2025,
      },
      {
        queryClient: database as never,
        loadReport: jest.fn(),
        now: new Date(generatedAt),
      },
    );
    for (const result of [data.modules, data.comparison!.modules].map(
      (rows) => rows.find((row) => row.key === "personnel")!,
    )) {
      expect(result.personnelUnassignedReimbursements).toHaveLength(4);
      expect(
        addFinancialAmounts(
          ...result.personnelUnassignedReimbursements!.map((row) => row.amount),
        ),
      ).toBe("10800");
      expect(result.details.find((row) => row.personId === "a")!.large).toBe(
        "0",
      );
      expect(
        result.details.find((row) => row.personId === "b")!.large,
      ).toBeNull();
    }
    const window = await loadMonthlyFinancialAnalysis(
      { from: "2026-01", to: "2026-09", granularity: "quarter", personId: "a" },
      {
        queryClient: database as never,
        loadReport: jest.fn(),
        now: new Date(generatedAt),
      },
    );
    const result = window.modules.find((row) => row.key === "personnel")!;
    expect(result.personnelUnassignedReimbursements).toEqual([]);
    expect(result.details.every((row) => row.large === "0")).toBe(true);
  });
});
