/** @jest-environment node */
import {
  buildMonthlyFinancialAnalysis,
  type AnalysisContract,
  type AnalysisReimbursement,
  type FinancialAnalysisMetadata,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { loadFinancialAnalysisSources } from "../server/services/monthlyFinancialAnalysisSources";
import {
  buildFinancialReimbursementScopeMap,
  type FinancialReimbursementScopeNode,
} from "../server/services/monthlyFinancialReimbursementScope";
import {
  addFinancialAmounts,
  isValidFinancialAnalysisMetadata,
} from "../server/services/monthlyFinancialReport";
import type {
  FinancialAnalysisModuleKey,
  FinancialAnalysisQuery,
} from "../server/types/monthly-financial-analysis";

const query: FinancialAnalysisQuery = {
  from: "2026-08",
  to: "2026-08",
  granularity: "month",
};
const generatedAt = "2026-09-02T01:00:00Z";
const nodes: FinancialReimbursementScopeNode[] = [
  {
    id: "internal",
    parentId: null,
    name: "公司内部",
    value: "company_internal",
  },
  { id: "haidian", parentId: null, name: "海淀区", value: "haidian" },
  { id: "chaoyang", parentId: null, name: "朝阳区", value: "chaoyang" },
  {
    id: "haidian-gjdw",
    parentId: "haidian",
    name: "GJDW",
    value: "haidian_gjdw",
  },
  {
    id: "chaoyang-gjdw",
    parentId: "chaoyang",
    name: "GJDW",
    value: "chaoyang_gjdw",
  },
  {
    id: "haidian-wfah",
    parentId: "haidian",
    name: "WFAH",
    value: "haidian_wfah",
  },
];
function report(month: string, outflow = "0"): FinancialAnalysisReport {
  return {
    month,
    status: "closed",
    generatedAt,
    savedAt: generatedAt,
    closedAt: generatedAt,
    accounts: ["general", "business", "welfare_one", "welfare_two"].map(
      (code) => ({
        code,
        name: code,
        opening: "0",
        inflow: "0",
        outflow: code === "general" ? outflow : "0",
        closing: "0",
      }),
    ),
    income: { mainReceipt: "0", generalInterest: "0" },
    automaticDetails: [
      {
        sourceType: "payroll",
        sourceId: `pay:${month}`,
        occurredOn: `${month}-01`,
        accountCode: "general",
        metric: "human_cost",
        amount: outflow,
        description: "工资成本",
      },
    ],
    manualItems: [],
  };
}
function reimbursement(
  id: string,
  scope: string,
  amount = "20",
): AnalysisReimbursement {
  return {
    id,
    scope,
    amount,
    userId: "user",
    employeeId: "employee",
    personName: "人员",
    type: "business",
    date: "2026-08-10",
    title: "不能据事项名称猜行政区",
    category: "reception",
    serviceTarget: "不能据服务对象猜行政区",
    updatedAt: generatedAt,
  };
}
function input(
  overrides: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return { query, generatedAt, reports: [], ...overrides };
}
function moduleFor(
  source: MonthlyFinancialAnalysisInput,
  key: FinancialAnalysisModuleKey,
) {
  return buildMonthlyFinancialAnalysis(source).modules.find(
    (module) => module.key === key,
  )!;
}
function frozenReport(metadata?: FinancialAnalysisMetadata) {
  const result = report("2026-08");
  result.automaticDetails = [
    {
      sourceType: "reimbursement",
      sourceId: "business",
      occurredOn: "2026-08-10",
      accountCode: "business",
      metric: "business_reimbursement",
      amount: "20",
      description: "商务报销",
      analysis: metadata,
    },
  ];
  return result;
}
async function sourceFixture(
  scopeNodes = nodes,
  rows = [
    reimbursement("haidian", "haidian_gjdw", "100.100000000001"),
    reimbursement("chaoyang", "chaoyang_gjdw", "200.2"),
    reimbursement("internal", "company_internal", "0"),
  ],
) {
  const client = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes("FROM reimbursements personnel_reimbursement"))
        return {
          rows: rows.map((row) => ({
            ...row,
            month: row.date.slice(0, 7),
            status: "completed",
          })),
        };
      if (sql.includes("FROM reimbursements reimbursement")) return { rows };
      if (sql.includes("FROM reimbursement_scopes"))
        return { rows: scopeNodes };
      if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
      return { rows: [] };
    }),
  };
  const sources = await loadFinancialAnalysisSources(query, {
    queryClient: client as never,
    loadReport: async (month) => report(month),
  });
  return { sources, client };
}

describe("一般账户总支出是独立权威序列", () => {
  it("全部为零时总额仍为真实零，税费未知且五分类不重复包含总额", () => {
    const result = moduleFor(
      input({ reports: [report("2026-08")] }),
      "outflow",
    );
    expect(result.series.find((row) => row.key === "total")?.values).toEqual([
      "0",
    ]);
    expect(result.series.find((row) => row.key === "tax")?.values).toEqual([
      null,
    ]);
    expect(result.breakdown).toHaveLength(5);
    expect(result.breakdown.some((row) => row.key === "total")).toBe(false);
    expect(
      result.breakdown
        .filter((row) => row.key !== "tax")
        .every((row) => row.amount === "0"),
    ).toBe(true);
  });
  it.each(["month", "quarter", "year"] as const)(
    "%s按权威月报精确聚合，不因税费未知改成空值或分类猜值",
    (granularity) => {
      const result = moduleFor(
        input({
          query: { from: "2025-01", to: "2025-03", granularity },
          reports: [
            report("2025-01", "999999999999999999.123456789012"),
            report("2025-02", "0.1"),
            report("2025-03", "0.2"),
          ],
        }),
        "outflow",
      );
      expect(result.series.find((row) => row.key === "total")?.values).toEqual(
        granularity === "month"
          ? ["999999999999999999.123456789012", "0.1", "0.2"]
          : ["999999999999999999.423456789012"],
      );
      expect(result.summaries[0].amount).toBe(
        "999999999999999999.423456789012",
      );
      expect(result.breakdown).toHaveLength(5);
      expect(result.breakdown.some((row) => row.key === "total")).toBe(false);
    },
  );
  it("分类明细不闭合时保留权威总额，真正缺月时总额仍为未知", () => {
    const baseline = report("2026-08", "100");
    baseline.automaticDetails[0].amount = "60";
    const known = moduleFor(input({ reports: [baseline] }), "outflow");
    expect(known.series.find((row) => row.key === "total")?.values).toEqual([
      "100",
    ]);
    expect(known.breakdown.find((row) => row.key === "salary")?.amount).toBe(
      "60",
    );
    expect(known.breakdown.find((row) => row.key === "tax")?.amount).toBeNull();
    expect(known.warnings.join()).toContain("不一致");
    const missing = moduleFor(
      input({
        query: { from: "2026-07", to: "2026-08", granularity: "quarter" },
        reports: [baseline],
      }),
      "outflow",
    );
    expect(missing.series.find((row) => row.key === "total")?.values).toEqual([
      null,
    ]);
  });
});

describe("项目回款明细按明确期间和合同根行政区分组", () => {
  it.each(["month", "quarter", "year"] as const)(
    "%s每期逐项目金额严格等于该期序列，不跨期间重复累加",
    (granularity) => {
      const contracts: AnalysisContract[] = ["first", "second"].map(
        (id, index) => ({
          id,
          rootId: id,
          relationType: "main",
          title: "项目名中的朝阳区不是行政区来源",
          partyA: "甲方",
          region: index === 0 ? "海淀区" : null,
          status: "effective",
          effectiveAt: "2026-01-01",
          contractDate: "2025-01-01",
          contractDateSource: "manual",
          originalAmount: "1000.1",
          amountDelta: "1000.1",
          amountBefore: null,
          amountAfter: null,
          supplementSequence: null,
          changeType: null,
          updatedAt: generatedAt,
        }),
      );
      const result = moduleFor(
        input({
          query: { from: "2025-01", to: "2026-08", granularity },
          contracts,
          receipts: [
            {
              id: "receipt-1",
              rootId: "first",
              date: "2025-03-01",
              amount: "0.1",
              currency: "CNY",
              status: "confirmed",
              reversedAt: null,
              updatedAt: generatedAt,
            },
            {
              id: "receipt-2",
              rootId: "second",
              date: "2026-02-01",
              amount: "0.2",
              currency: "CNY",
              status: "confirmed",
              reversedAt: null,
              updatedAt: generatedAt,
            },
          ],
        }),
        "projects",
      );
      for (const [index, period] of result.periods.entries()) {
        const rows = result.details.filter(
          (row) => row.periodKey === period.key,
        );
        expect(rows).toHaveLength(2);
        expect(new Set(rows.map((row) => row.sourceId)).size).toBe(2);
        expect(
          rows.every((row) => row.from === period.from && row.to === period.to),
        ).toBe(true);
        for (const key of ["contract", "received", "outstanding"])
          expect(addFinancialAmounts(...rows.map((row) => row[key]!))).toBe(
            result.series.find((series) => series.key === key)!.values[index],
          );
        expect(rows.find((row) => row.sourceId === "first")?.region).toBe(
          "海淀区",
        );
        expect(
          rows.find((row) => row.sourceId === "second")?.region,
        ).toBeNull();
      }
      expect(result.columns.map((row) => row.key)).toEqual(
        expect.arrayContaining(["periodKey", "from", "to", "region"]),
      );
    },
  );
});

describe("商务报销完整层级和行政区唯一归属", () => {
  it("相同叶名称跨区区分完整路径，公司内部独立，重复相同配置不复制业务", async () => {
    const { sources, client } = await sourceFixture([...nodes, ...nodes]);
    const result = moduleFor(input(sources), "business");
    expect(result.summaries[0].amount).toBe("300.300000000001");
    expect(
      Object.fromEntries(
        result.breakdown.map((row) => [row.label, row.amount]),
      ),
    ).toEqual({
      "海淀区 / GJDW": "100.100000000001",
      "朝阳区 / GJDW": "200.2",
      公司内部: "0",
    });
    expect(result.comparison).toEqual(result.breakdown);
    expect(result.details.map((row) => row.scope)).toEqual([
      "海淀区 / GJDW",
      "朝阳区 / GJDW",
      "公司内部",
    ]);
    expect(
      result.details.every((row) => row.regionSource?.includes("完整父链")),
    ).toBe(true);
    expect(
      client.query.mock.calls.find(([sql]) =>
        sql.includes("FROM reimbursements reimbursement"),
      )?.[0],
    ).not.toContain("reimbursement_scopes");
    const filtered = moduleFor(
      input({
        ...sources,
        query: { ...query, reimbursementScope: "海淀区 / GJDW" },
      }),
      "business",
    );
    expect(filtered.summaries[0].amount).toBe("100.100000000001");
    expect(filtered.breakdown.map((row) => row.label)).toEqual([
      "海淀区 / GJDW",
    ]);
  });
  it("同一个范围值跨行政区冲突时单列未知，不任意选区、不金额倍增", async () => {
    const { sources } = await sourceFixture(
      [
        ...nodes,
        {
          id: "conflict",
          parentId: "chaoyang",
          name: "GJDW",
          value: "haidian_gjdw",
        },
      ],
      [reimbursement("one", "haidian_gjdw", "100")],
    );
    const result = moduleFor(input(sources), "business");
    expect(result.summaries[0].amount).toBe("100");
    expect(result.breakdown).toEqual([
      { key: "行政区未知", label: "行政区未知", amount: "100" },
    ]);
    expect(result.details[0].region).toBeNull();
    expect(result.details[0].scopePath).toBeNull();
    expect(result.details[0].regionSource).toContain("不同父级区域或路径");
    expect(result.warnings.join()).toContain("行政区未知");
  });
  it("多层父链完整时归根级行政区，循环、缺父和重复编号冲突保持未知", () => {
    const scopes = buildFinancialReimbursementScopeMap([
      ...nodes,
      {
        id: "third",
        parentId: "haidian-gjdw",
        name: "下级事项",
        value: "third",
      },
      { id: "cycle", parentId: "cycle", name: "环", value: "cycle" },
      { id: "missing", parentId: "no-parent", name: "缺父", value: "missing" },
      { id: "bad", parentId: "haidian", name: "同编号", value: "bad" },
      { id: "bad", parentId: "chaoyang", name: "同编号", value: "bad" },
    ]);
    expect(scopes.get("third")).toMatchObject({
      path: "海淀区 / GJDW / 下级事项",
      region: "海淀区",
    });
    for (const key of ["cycle", "missing", "bad"])
      expect(scopes.get(key)).toMatchObject({ path: null, region: null });
  });
  it("旧来源重复编号直接拒绝，不让重复记录绕过维度去重后再次累计", () => {
    expect(() =>
      moduleFor(
        input({
          reimbursements: [
            reimbursement("one", "haidian_gjdw"),
            reimbursement("one", "haidian_gjdw"),
          ],
        }),
        "business",
      ),
    ).toThrow("重复编号");
  });
});

describe("商务行政区的历史冻结兼容", () => {
  const metadata: FinancialAnalysisMetadata = {
    schemaVersion: 1,
    reimbursementScope: "海淀区 / GJDW",
    reimbursementScopeValue: "haidian_gjdw",
    reimbursementScopePath: "海淀区 / GJDW",
    reimbursementRegion: "海淀区",
    reimbursementRegionSource: "保存时完整父链核对",
  };
  const current = {
    ...reimbursement("business", "chaoyang_gjdw"),
    scopePath: "朝阳区 / GJDW",
    region: "朝阳区",
    regionSource: "当前完整父链核对",
  };
  it("新快照行政区与路径已冻结时，后来的范围移动不覆盖当时金额或区域", () => {
    const result = moduleFor(
      input({ reports: [frozenReport(metadata)], reimbursements: [current] }),
      "business",
    );
    expect(result.summaries[0].amount).toBe("20");
    expect(result.breakdown).toEqual([
      { key: "海淀区 / GJDW", label: "海淀区 / GJDW", amount: "20" },
    ]);
    expect(result.details[0]).toMatchObject({
      region: "海淀区",
      scope: "海淀区 / GJDW",
      scopePath: "海淀区 / GJDW",
    });
    expect(result.details[0].regionSource).toContain("原报表冻结行政区");
  });
  it.each([
    undefined,
    { schemaVersion: 1 as const, reimbursementScope: "GJDW" },
  ])("旧月结缺行政区冻结字段时不以当前配置补历史：%j", (legacy) => {
    const result = moduleFor(
      input({ reports: [frozenReport(legacy)], reimbursements: [current] }),
      "business",
    );
    expect(result.summaries[0].amount).toBe("20");
    expect(result.breakdown).toEqual([
      { key: "行政区未知", label: "行政区未知", amount: "20" },
    ]);
    expect(result.details[0].region).toBeNull();
    expect(result.details[0].scopePath).toBeNull();
    expect(result.details[0].regionSource).toContain("不替代历史");
  });
  it("旧冻结只有叶名称时，完整路径筛选不能误报该路径无支出", () => {
    const result = moduleFor(
      input({
        query: { ...query, reimbursementScope: "海淀区 / GJDW" },
        reports: [
          frozenReport({ schemaVersion: 1, reimbursementScope: "GJDW" }),
        ],
        reimbursements: [current],
      }),
      "business",
    );
    expect(result.summaries[0].amount).toBeNull();
    expect(result.warnings.join()).toContain("不能判断是否属于当前路径筛选");
  });
  it("新冻结区域要求完整来源证据，旧无字段元数据仍兼容", () => {
    expect(
      isValidFinancialAnalysisMetadata(metadata, "reimbursement", "20"),
    ).toBe(true);
    expect(
      isValidFinancialAnalysisMetadata(
        { schemaVersion: 1, reimbursementScope: "旧范围" },
        "reimbursement",
        "20",
      ),
    ).toBe(true);
    expect(isValidFinancialAnalysisMetadata(metadata, "payroll", "20")).toBe(
      false,
    );
    for (const key of [
      "reimbursementScopeValue",
      "reimbursementScopePath",
      "reimbursementRegionSource",
    ]) {
      expect(
        isValidFinancialAnalysisMetadata(
          { ...metadata, [key]: null },
          "reimbursement",
          "20",
        ),
      ).toBe(false);
      expect(
        isValidFinancialAnalysisMetadata(
          { ...metadata, [key]: 123 },
          "reimbursement",
          "20",
        ),
      ).toBe(false);
    }
  });
});
