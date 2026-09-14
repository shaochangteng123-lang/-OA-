import * as XLSX from "xlsx";
import {
  buildMonthlyFinancialAnalysis,
  loadMonthlyFinancialAnalysis,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import {
  buildMonthlyFinancialComparisonQuery,
  parseMonthlyFinancialAnalysisQuery,
} from "../server/services/monthlyFinancialAnalysisQuery";
import {
  buildMonthlyFinancialAnalysisWorkbook,
  monthlyFinancialAnalysisVersion,
} from "../server/services/monthlyFinancialAnalysisWorkbook";
import { protectMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysisPermissions";
import {
  addFinancialAmounts,
  subtractFinancialAmounts,
} from "../server/services/monthlyFinancialReport";
import type { FinancialAnalysisModuleKey } from "../server/types/monthly-financial-analysis";

const generatedAt = "2026-09-02T01:00:00.000Z";
function report(
  month: string,
  incoming: string,
  closing: string,
  parts = { salary: "30", social: "5", housing: "2", adjustment: "3" },
): FinancialAnalysisReport {
  const payrollTotal = addFinancialAmounts(...Object.values(parts));
  const outflow = addFinancialAmounts(payrollTotal, "10");
  return {
    month,
    status: "closed",
    generatedAt: `${month}-28T01:00:00.000Z`,
    savedAt: `${month}-28T01:00:00.000Z`,
    closedAt: `${month}-28T01:00:00.000Z`,
    accounts: [
      {
        code: "general",
        name: "一般账户",
        opening: subtractFinancialAmounts(
          addFinancialAmounts(closing, outflow),
          incoming,
        ),
        inflow: incoming,
        outflow,
        closing,
      },
      ...["business", "welfare_one", "welfare_two"].map((code) => ({
        code,
        name: code,
        opening: "0",
        inflow: "0",
        outflow: "0",
        closing: "0",
      })),
    ],
    income: { mainReceipt: incoming, generalInterest: "0" },
    automaticDetails: [
      {
        sourceType: "contract_receipt",
        sourceId: `receipt-${month}`,
        occurredOn: `${month}-01`,
        accountCode: "general",
        metric: "main_receipt",
        amount: incoming,
        description: "主营回款",
        analysis: {
          schemaVersion: 1,
          contractRootId: "contract",
          partyA: "同一甲方",
          contractRegion: "朝阳区",
        },
      },
      {
        sourceType: "payroll",
        sourceId: `payroll-${month}`,
        occurredOn: `${month}-01`,
        accountCode: "general",
        metric: "human_cost",
        amount: payrollTotal,
        description: "人力成本",
        personId: "employee",
        personName: "同一人员",
        analysis: {
          schemaVersion: 1,
          canonicalPersonId: "employee",
          payrollParts: parts,
        },
      },
    ],
    manualItems: [
      {
        id: `tax-${month}`,
        category: "general_tax_payment",
        accountCode: "general",
        direction: "expense",
        occurredOn: `${month}-01`,
        amount: "10",
        description: "实际税费付款",
        voucherReference: `税凭-${month}`,
      },
    ],
  };
}
function fixture(
  overrides: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: {
      from: "2026-08",
      to: "2026-08",
      granularity: "month",
      comparisonYear: 2025,
    },
    generatedAt,
    reports: [report("2026-08", "150", "90"), report("2025-08", "100", "70")],
    ...overrides,
  };
}
function moduleFor(
  data: ReturnType<typeof buildMonthlyFinancialAnalysis>,
  key: FinancialAnalysisModuleKey,
  comparison = false,
) {
  return (comparison ? data.comparison!.modules : data.modules).find(
    (row) => row.key === key,
  )!;
}

describe("往年对比查询与期间平移", () => {
  it("跨年区间按同一年差平移，保留全部业务筛选且子查询不递归", () => {
    const query = parseMonthlyFinancialAnalysisQuery({
      from: "2026-11",
      to: "2027-02",
      granularity: "quarter",
      comparisonYear: "2024",
      partyA: "甲方",
      contractRegion: "朝阳区",
      reimbursementScope: "范围",
      personId: "employee",
    });
    expect(query.comparisonYear).toBe(2024);
    expect(buildMonthlyFinancialComparisonQuery(query)).toEqual({
      from: "2024-11",
      to: "2025-02",
      granularity: "quarter",
      partyA: "甲方",
      contractRegion: "朝阳区",
      reimbursementScope: "范围",
      personId: "employee",
    });
  });
  it("允许最早1900年并保持月季年粒度", () => {
    expect(
      buildMonthlyFinancialComparisonQuery({
        from: "2026-01",
        to: "2026-12",
        granularity: "year",
        comparisonYear: 1900,
      }),
    ).toEqual({ from: "1900-01", to: "1900-12", granularity: "year" });
    expect(
      buildMonthlyFinancialComparisonQuery({
        from: "2099-01",
        to: "2099-12",
        granularity: "month",
        comparisonYear: 2098,
      })?.from,
    ).toBe("2098-01");
  });
  it.each([1899, 2099, 2026, 2027, 2025.5, "20xx", "2e03", ["2025"], {}, null])(
    "拒绝无效或不是往年的对比年份 %j",
    (comparisonYear) => {
      expect(() =>
        parseMonthlyFinancialAnalysisQuery({
          from: "2026-01",
          to: "2026-12",
          comparisonYear,
        }),
      ).toThrow();
    },
  );
  it("未启用对比保持旧查询与响应结构", () => {
    expect(
      parseMonthlyFinancialAnalysisQuery({ from: "2026-01", to: "2026-02" }),
    ).toEqual({ from: "2026-01", to: "2026-02", granularity: "month" });
    const data = buildMonthlyFinancialAnalysis(
      fixture({
        query: { from: "2026-08", to: "2026-08", granularity: "month" },
      }),
    );
    expect(data.comparison).toBeUndefined();
    expect(buildMonthlyFinancialComparisonQuery(data.query)).toBeNull();
  });
  it("直接调用纯计算同样拒绝无效对比区间", () => {
    expect(() =>
      buildMonthlyFinancialAnalysis(
        fixture({
          query: {
            from: "2026-08",
            to: "2026-08",
            granularity: "month",
            comparisonYear: 2026,
          },
        }),
      ),
    ).toThrow("早于");
    expect(() =>
      buildMonthlyFinancialComparisonQuery({
        from: "2100-01",
        to: "2100-12",
        granularity: "year",
        comparisonYear: 2098,
      }),
    ).toThrow("1900至2099");
  });
});

describe("七模块完整往年结果", () => {
  it("人员工资及房租告警和更新时间只来自各期所涉自然年，全年离职成本不丢失", () => {
    const current = report("2026-08", "150", "90");
    const earlier = report("2025-08", "100", "70");
    for (const item of [current, earlier]) {
      const salary = item.automaticDetails.find(
        (row) => row.sourceType === "payroll",
      )!;
      delete salary.analysis;
    }
    const retired = report("2025-01", "100", "70");
    const retiredSalary = retired.automaticDetails.find(
      (row) => row.sourceType === "payroll",
    )!;
    retiredSalary.personId = "retired-2025";
    retiredSalary.personName = "历史离职人员";
    retiredSalary.analysis!.canonicalPersonId = "retired-2025";
    const payroll = ["2025", "2026"].map((year) => ({
      id: `payroll-${year}-08`,
      employeeId: "employee",
      userId: "user",
      personName: "同一人员",
      month: `${year}-08`,
      salary: "40",
      housingBase: "0",
      contributionBase: "0",
      tax: "0",
      withheldActual: null,
      netActual: null,
      updatedAt: `${year}-08-29T01:00:00Z`,
    }));
    const overheadAllocations = ["2025", "2026"].map((year) => ({
      id: `foreign-${year}`,
      paymentId: `payment-${year}`,
      paymentKind: "payment",
      currency: "USD",
      date: `${year}-05-01`,
      paymentAmount: "10",
      amount: "10",
      invoiceId: `invoice-${year}`,
      invoiceAmount: "10",
      title: "模拟房租",
      updatedAt: `${year}-08-30T01:00:00Z`,
      lines: [
        { id: `line-${year}`, category: "rent", amount: "10", verified: true },
      ],
    }));
    const overheadCandidates = ["2025", "2026"].map((year) => ({
      id: `unmatched-${year}`,
      kind: "payment",
      date: `${year}-03-01`,
      amount: "10",
      title: "未匹配房租",
      scopeCoverage: "included" as const,
    }));
    const source = fixture({
      reports: [current, earlier, retired],
      payroll,
      overheadAllocations,
      overheadCandidates,
    });
    const before = JSON.stringify(source);
    const data = buildMonthlyFinancialAnalysis(source);
    const currentPersonnel = moduleFor(data, "personnel");
    const earlierPersonnel = moduleFor(data, "personnel", true);
    expect(currentPersonnel.updatedAt).toBe("2026-08-30T01:00:00.000Z");
    expect(earlierPersonnel.updatedAt).toBe("2025-08-30T01:00:00.000Z");
    expect(currentPersonnel.warnings.join()).toContain("2026-08部分工资快照");
    expect(currentPersonnel.warnings.join()).toContain("2026-05房租付款");
    expect(currentPersonnel.warnings.join()).toContain("2026-03资产付款");
    expect(currentPersonnel.warnings.join()).not.toContain("2025-");
    expect(earlierPersonnel.warnings.join()).toContain("2025-08部分工资快照");
    expect(earlierPersonnel.warnings.join()).toContain("2025-05房租付款");
    expect(earlierPersonnel.warnings.join()).toContain("2025-03资产付款");
    expect(earlierPersonnel.warnings.join()).not.toContain("2026-");
    expect(currentPersonnel.summaries[0].amount).toBe("40");
    expect(earlierPersonnel.summaries[0].amount).toBe("40");
    expect(
      earlierPersonnel.details.find((row) => row.personId === "retired-2025"),
    ).toMatchObject({ total: "0", annualTotal: "40" });
    expect(
      currentPersonnel.details.some((row) => row.personId === "retired-2025"),
    ).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("两期通用模块各取本期保存及来源时间，不借用区间外最新报告，全年成本仍保留", () => {
    const current = report("2026-08", "150", "90");
    current.savedAt = "2026-08-30T01:00:00.000Z";
    current.sources = [
      {
        key: "payroll",
        status: "ready",
        lastUpdatedAt: "2026-08-31T02:00:00.000Z",
      },
    ];
    const earlier = report("2025-08", "100", "70");
    earlier.savedAt = "2025-09-01T01:00:00.000Z";
    earlier.sources = [
      {
        key: "payroll",
        status: "ready",
        lastUpdatedAt: "2025-09-02T03:00:00.000Z",
      },
    ];
    const outsideCurrent = report("2026-09", "160", "100");
    outsideCurrent.savedAt = "2026-09-02T08:00:00.000Z";
    const outsideEarlier = report("2025-09", "110", "80");
    outsideEarlier.savedAt = "2026-09-02T08:30:00.000Z";
    const data = buildMonthlyFinancialAnalysis(
      fixture({ reports: [current, earlier, outsideCurrent, outsideEarlier] }),
    );
    for (const key of [
      "balances",
      "inflow",
      "outflow",
      "settlement",
      "business",
    ] as const) {
      expect(moduleFor(data, key).updatedAt).toBe("2026-08-31T02:00:00.000Z");
      expect(moduleFor(data, key, true).updatedAt).toBe(
        "2025-09-02T03:00:00.000Z",
      );
    }
    expect(moduleFor(data, "personnel").details[0].annualTotal).toBe("80");
    expect(moduleFor(data, "personnel", true).details[0].annualTotal).toBe(
      "80",
    );
    expect(moduleFor(data, "balances", true).summaries.at(-1)?.amount).toBe(
      "70",
    );
  });

  it("两期各返回七个模块、真实时期与准确金额，输入不被修改", () => {
    const source = fixture({
      query: {
        ...fixture().query,
        partyA: "同一甲方",
        contractRegion: "朝阳区",
        personId: "employee",
      },
    });
    const before = JSON.stringify(source);
    const data = buildMonthlyFinancialAnalysis(source);
    expect(data.modules).toHaveLength(7);
    expect(data.comparison?.modules).toHaveLength(7);
    const expectedTitles = {
      balances: "账户余额资金台帐",
      inflow: "一般账户入账统计",
      outflow: "一般账户出账统计",
      projects: "项目分析",
      settlement: "收支结余汇总",
      business: "商务统计",
      personnel: "人力成本分析",
    };
    for (const modules of [data.modules, data.comparison!.modules]) {
      expect(
        Object.fromEntries(modules.map(({ key, title }) => [key, title])),
      ).toEqual(expectedTitles);
    }
    expect(data.comparison?.query).toEqual({
      from: "2025-08",
      to: "2025-08",
      granularity: "month",
      partyA: "同一甲方",
      contractRegion: "朝阳区",
      personId: "employee",
    });
    expect(data.comparison?.label).toContain("2025年同期");
    expect(moduleFor(data, "balances").summaries.at(-1)?.amount).toBe("90");
    expect(moduleFor(data, "balances", true).summaries.at(-1)?.amount).toBe(
      "70",
    );
    expect(moduleFor(data, "inflow").series[0].values).toEqual(["150"]);
    expect(moduleFor(data, "inflow", true).series[0].values).toEqual(["100"]);
    expect(moduleFor(data, "personnel", true).details[0].personId).toBe(
      "employee",
    );
    expect(JSON.stringify(source)).toBe(before);
    expect(data.comparison).not.toHaveProperty("generatedAt");
    expect(data.comparison).not.toHaveProperty("comparison");
  });
  it("季度两期均累计期间收支，仅取各自期间末余额", () => {
    const data = buildMonthlyFinancialAnalysis(
      fixture({
        query: {
          from: "2026-07",
          to: "2026-08",
          granularity: "quarter",
          comparisonYear: 2025,
        },
        reports: [
          report("2026-07", "50", "20"),
          report("2026-08", "150", "90"),
          report("2025-07", "20", "10"),
          report("2025-08", "100", "70"),
        ],
      }),
    );
    expect(moduleFor(data, "balances").series.at(-1)?.values).toEqual(["90"]);
    expect(moduleFor(data, "balances", true).series.at(-1)?.values).toEqual([
      "70",
    ]);
    expect(moduleFor(data, "settlement").series[0].values).toEqual(["200"]);
    expect(moduleFor(data, "settlement", true).series[0].values).toEqual([
      "120",
    ]);
    expect(moduleFor(data, "settlement", true).periods[0]).toMatchObject({
      from: "2025-07",
      to: "2025-08",
    });
  });
  it("对比期缺失月份保留空值，不使用本期数值或零补齐", () => {
    const data = buildMonthlyFinancialAnalysis(
      fixture({
        query: {
          from: "2026-08",
          to: "2026-09",
          granularity: "month",
          comparisonYear: 2025,
        },
        reports: [
          report("2026-08", "150", "90"),
          report("2026-09", "160", "100"),
          report("2025-08", "100", "70"),
        ],
      }),
    );
    expect(moduleFor(data, "balances", true).series.at(-1)?.values).toEqual([
      "70",
      null,
    ]);
    expect(moduleFor(data, "balances").series.at(-1)?.values).toEqual([
      "90",
      "100",
    ]);
    expect(data.comparison?.warnings.join()).toContain("2025-09");
  });
  it("年度对比中每期只用其对应自然年的成本，不重复合并另一年", () => {
    const data = buildMonthlyFinancialAnalysis(fixture());
    expect(moduleFor(data, "personnel").details[0].annualTotal).toBe("40");
    expect(moduleFor(data, "personnel", true).details[0].annualTotal).toBe(
      "40",
    );
    expect(moduleFor(data, "personnel", true).details[0].sourceId).toContain(
      "2025-08",
    );
    expect(
      moduleFor(data, "personnel", true).details[0].sourceId,
    ).not.toContain("2026-08");
  });
});

describe("往年数据同事务加载", () => {
  it("相隔多年的两期仍分别查询，并复用同一个只读连接", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes("FROM monthly_financial_reports"))
          return { rows: [{ month: `${String(params?.[0]).slice(0, 4)}-08` }] };
        if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
        return { rows: [] };
      }),
    };
    const loadReport = jest.fn(async (month: string, connection: unknown) => {
      expect(connection).toBe(client);
      return report(month, "100", "70");
    });
    const data = await loadMonthlyFinancialAnalysis(
      {
        from: "2026-08",
        to: "2026-08",
        granularity: "month",
        comparisonYear: 1900,
      },
      { queryClient: client as never, loadReport, now: new Date(generatedAt) },
    );
    expect(
      queries
        .filter((row) => row.sql.includes("FROM monthly_financial_reports"))
        .map((row) => row.params),
    ).toEqual([
      ["2026-01", "2026-12"],
      ["1900-01", "1900-12"],
    ]);
    expect(queries.every((row) => /^\s*SELECT/.test(row.sql))).toBe(true);
    expect(loadReport).toHaveBeenCalledTimes(2);
    expect(data.comparison?.modules).toHaveLength(7);
    expect(data.generatedAt).toBe(generatedAt);
  });
  it("当前和对比区间重叠时同一个月报仅加载一次", async () => {
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM monthly_financial_reports"))
          return {
            rows: String(params?.[0]).startsWith("2025")
              ? [{ month: "2025-08" }, { month: "2026-08" }]
              : [{ month: "2024-08" }, { month: "2025-08" }],
          };
        if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
        return { rows: [] };
      }),
    };
    const loadReport = jest.fn(async (month: string) =>
      report(month, "100", "70"),
    );
    await loadMonthlyFinancialAnalysis(
      {
        from: "2025-08",
        to: "2026-08",
        granularity: "month",
        comparisonYear: 2024,
      },
      { queryClient: client as never, loadReport, now: new Date(generatedAt) },
    );
    expect(
      loadReport.mock.calls.filter(([month]) => month === "2025-08"),
    ).toHaveLength(1);
    expect(loadReport).toHaveBeenCalledTimes(3);
  });
});

describe("比较期导出与敏感权限", () => {
  it("默认16表含人力年度，完整对比31表，非人力单模块对比5表且名称清楚", () => {
    const data = buildMonthlyFinancialAnalysis(fixture());
    const all = XLSX.read(buildMonthlyFinancialAnalysisWorkbook(data), {
      type: "buffer",
    });
    expect(all.SheetNames).toHaveLength(31);
    expect(new Set(all.SheetNames).size).toBe(31);
    expect(all.SheetNames).toEqual(
      expect.arrayContaining(
        [
          "账户余额资金台帐",
          "一般账户入账统计",
          "一般账户出账统计",
          "项目分析",
          "收支结余汇总",
          "商务统计",
          "人力成本分析",
        ].flatMap((title) => [
          `${title}-统计`,
          `${title}-明细`,
          `对比期-${title}-统计`,
          `对比期-${title}-明细`,
        ]),
      ),
    );
    expect(
      all.SheetNames.filter((name) => name.startsWith("对比期-")),
    ).toHaveLength(15);
    expect(all.SheetNames.every((name) => name.length <= 31)).toBe(true);
    const one = XLSX.read(
      buildMonthlyFinancialAnalysisWorkbook(data, "balances"),
      { type: "buffer" },
    );
    expect(one.SheetNames).toHaveLength(5);
    const noComparison = buildMonthlyFinancialAnalysis(
      fixture({
        query: { from: "2026-08", to: "2026-08", granularity: "month" },
      }),
    );
    expect(
      XLSX.read(buildMonthlyFinancialAnalysisWorkbook(noComparison), {
        type: "buffer",
      }).SheetNames,
    ).toHaveLength(16);
    const metadata = XLSX.utils.sheet_to_json<string[]>(
      all.Sheets["查询说明"],
      { header: 1 },
    );
    expect(metadata).toContainEqual(["对比开始月份", "2025-08"]);
    expect(metadata).toContainEqual(["对比结束月份", "2025-08"]);
  });
  it("对比期大金额仍为完整文本，比较金额变化影响版本而时钟不影响", () => {
    const data = buildMonthlyFinancialAnalysis(
      fixture({
        reports: [
          report("2026-08", "150", "90"),
          report("2025-08", "100", "999999999999999999.123456789012"),
        ],
      }),
    );
    const version = monthlyFinancialAnalysisVersion(data);
    expect(
      monthlyFinancialAnalysisVersion({
        ...data,
        generatedAt: "2026-09-02T06:00:00Z",
      }),
    ).toBe(version);
    const workbook = XLSX.read(
      buildMonthlyFinancialAnalysisWorkbook(data, "balances"),
      { type: "buffer" },
    );
    const sheet = workbook.Sheets["对比期-账户余额资金台帐-明细"];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    const column = rows[0].indexOf("期末余额");
    const address = XLSX.utils.encode_cell({ r: 1, c: column });
    expect(sheet[address]).toMatchObject({
      t: "s",
      v: "999999999999999999.123456789012",
    });
    data.comparison!.modules[0].summaries[0].amount = "2";
    expect(monthlyFinancialAnalysisVersion(data)).not.toBe(version);
  });
  it("总经理两期响应和导出均去除工资分项，管理员保留且不改原对象", () => {
    const data = buildMonthlyFinancialAnalysis(
      fixture({
        reports: [
          report("2026-08", "3000", "1000", {
            salary: "1234.56",
            social: "500",
            housing: "100",
            adjustment: "165.44",
          }),
          report("2025-08", "2000", "800", {
            salary: "987.654321",
            social: "150",
            housing: "20",
            adjustment: "42.345679",
          }),
        ],
      }),
    );
    const original = JSON.stringify(data);
    const safe = protectMonthlyFinancialAnalysis(data, "general_manager");
    expect(moduleFor(safe, "personnel").details[0].salary).toBeUndefined();
    expect(
      moduleFor(safe, "personnel", true).details[0].salary,
    ).toBeUndefined();
    expect(moduleFor(safe, "personnel", true).details[0].total).toBe("1200");
    expect(JSON.stringify(safe)).not.toContain("1234.56");
    expect(JSON.stringify(safe)).not.toContain("987.654321");
    const workbook = XLSX.read(
      buildMonthlyFinancialAnalysisWorkbook(safe, "personnel"),
      { type: "buffer" },
    );
    for (const name of workbook.SheetNames) {
      const text = JSON.stringify(
        XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }),
      );
      expect(text).not.toContain("1234.56");
      expect(text).not.toContain("987.654321");
    }
    const visible = protectMonthlyFinancialAnalysis(data, "admin");
    expect(moduleFor(visible, "personnel", true).details[0].salary).toBe(
      "987.654321",
    );
    expect(moduleFor(visible, "personnel", true).payrollDetailsVisible).toBe(
      true,
    );
    expect(JSON.stringify(data)).toBe(original);
  });
});
