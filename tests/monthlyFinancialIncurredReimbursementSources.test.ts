/** @jest-environment node */
jest.mock("../server/services/monthlyFinancialHousingCostSources", () => ({
  loadMonthlyFinancialHousingCostInvoices: jest.fn(async () => []),
}));
import { loadFinancialAnalysisSources } from "../server/services/monthlyFinancialAnalysisSources";
import type {
  AnalysisPersonnelIncurredReimbursement,
  AnalysisReimbursement,
} from "../server/services/monthlyFinancialAnalysis";
import type { FinancialReimbursementScopeNode } from "../server/services/monthlyFinancialReimbursementScope";

const nodes: FinancialReimbursementScopeNode[] = [
  { id: "hd", parentId: null, name: "海淀区", value: "hd" },
  { id: "cy", parentId: null, name: "朝阳区", value: "cy" },
  { id: "hd-business", parentId: "hd", name: "商务", value: "hd-business" },
  {
    id: "hd-leaf",
    parentId: "hd-business",
    name: "接待",
    value: "hd-reception",
  },
  { id: "cy-leaf", parentId: "cy", name: "接待", value: "cy-reception" },
  { id: "company", parentId: null, name: "公司内部", value: "company" },
];
function expense(
  overrides: Partial<AnalysisPersonnelIncurredReimbursement> = {},
): AnalysisPersonnelIncurredReimbursement {
  return {
    id: "expense-one",
    type: "business",
    month: "2026-04",
    amount: "100.100000000001",
    status: "approved",
    employeeId: "employee-one",
    userId: "user-one",
    personName: "测试人员",
    title: "商务活动",
    category: "reception",
    scope: "hd-reception",
    serviceTarget: "服务对象文字提及朝阳区",
    updatedAt: "2026-04-09T01:00:00Z",
    ...overrides,
  };
}
async function read(
  rows: AnalysisPersonnelIncurredReimbursement[],
  scopes = nodes,
  cash: AnalysisReimbursement[] = [],
) {
  const client = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes("FROM reimbursements personnel_reimbursement"))
        return { rows };
      if (sql.includes("FROM reimbursements reimbursement\n"))
        return { rows: cash };
      if (sql.includes("FROM reimbursement_scopes ORDER BY"))
        return { rows: scopes };
      return { rows: [] };
    }),
  };
  const source = await loadFinancialAnalysisSources(
    { from: "2026-01", to: "2026-09", granularity: "month" },
    {
      queryClient: client as never,
      loadReport: jest.fn(),
      now: new Date("2026-09-08T00:00:00Z"),
    },
  );
  return { source, client };
}

describe("统一报销月份来源与完整级联范围", () => {
  it("按报销月份加载三类四种确认状态，携带事项分类范围服务对象且不依赖付款日期", async () => {
    const rows = [
      expense(),
      expense({ id: "basic", type: "basic", status: "paid" }),
      expense({ id: "large", type: "large", status: "payment_uploaded" }),
      expense({ id: "completed", status: "completed" }),
    ];
    const before = JSON.stringify(rows);
    const { source, client } = await read(rows);
    const sql = client.query.mock.calls.find(([statement]) =>
      statement.includes("FROM reimbursements personnel_reimbursement"),
    )![0];
    expect(sql).toContain(
      "personnel_reimbursement.reimbursement_month AS month",
    );
    expect(sql).toContain(
      "personnel_reimbursement.total_amount::text AS amount",
    );
    expect(sql).toContain(
      "personnel_reimbursement.status IN ('approved', 'paid', 'payment_uploaded', 'completed')",
    );
    expect(sql).toContain(
      "personnel_reimbursement.type IN ('basic', 'large', 'business')",
    );
    expect(sql).toContain("personnel_reimbursement.is_deleted = FALSE");
    expect(sql).toContain(
      "personnel_reimbursement.title, personnel_reimbursement.category",
    );
    expect(sql).toContain(
      "personnel_reimbursement.reimbursement_scope AS scope",
    );
    expect(sql).toContain(
      'personnel_reimbursement.service_target AS "serviceTarget"',
    );
    expect(sql).not.toMatch(
      /payment_business_date|payment_date|COALESCE\s*\(.*month|BETWEEN/iu,
    );
    expect(source.personnelIncurredReimbursements).toHaveLength(4);
    expect(source.personnelIncurredReimbursements![0]).toMatchObject({
      month: "2026-04",
      status: "approved",
      title: "商务活动",
      category: "reception",
      amount: "100.100000000001",
      scope: "hd-reception",
      scopePath: "海淀区 / 商务 / 接待",
      region: "海淀区",
      serviceTarget: "服务对象文字提及朝阳区",
    });
    expect(source.personnelIncurredReimbursements![0]).not.toHaveProperty(
      "date",
    );
    expect(
      client.query.mock.calls.every(([statement]) =>
        /^\s*SELECT\b/iu.test(statement),
      ),
    ).toBe(true);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("同叶名跨区按完整父链区分，公司内部单列，重复配置不增加报销笔数或金额", async () => {
    const rows = [
      expense(),
      expense({ id: "second", scope: "cy-reception", amount: "200.2" }),
      expense({ id: "internal", scope: "company", amount: "0.01" }),
    ];
    const { source } = await read(rows, [...nodes, ...nodes]);
    expect(
      source.personnelIncurredReimbursements!.map((row) => [
        row.scopePath,
        row.region,
        row.amount,
      ]),
    ).toEqual([
      ["海淀区 / 商务 / 接待", "海淀区", "100.100000000001"],
      ["朝阳区 / 接待", "朝阳区", "200.2"],
      ["公司内部", "公司内部", "0.01"],
    ]);
    expect(
      source.personnelIncurredReimbursements!.every((row) =>
        row.regionSource?.includes("完整父链"),
      ),
    ).toBe(true);
  });

  it("范围值冲突、缺父或缺范围不猜行政区，仍保留原金额和原报销月份", async () => {
    const scopes = [
      ...nodes,
      {
        id: "conflicting",
        parentId: "cy",
        name: "接待",
        value: "hd-reception",
      },
      { id: "orphan", parentId: "missing", name: "失去父级", value: "orphan" },
    ];
    const rows = [
      expense(),
      expense({ id: "orphan", scope: "orphan" }),
      expense({ id: "empty", scope: null }),
    ];
    const { source } = await read(rows, scopes);
    expect(
      source.personnelIncurredReimbursements!.every(
        (row) =>
          row.region === null &&
          row.scopePath === null &&
          row.month === "2026-04" &&
          row.amount === "100.100000000001",
      ),
    ).toBe(true);
    expect(source.personnelIncurredReimbursements![0].scope).toBe(
      "hd-reception",
    );
    expect(source.personnelIncurredReimbursements![0].regionSource).toContain(
      "不同父级区域或路径",
    );
    expect(source.warnings!.join()).toContain("行政区未知");
  });

  it("缺失或非法报销月份保留供业务层诊断，不能丢记录或改用其他时间", async () => {
    const { source } = await read([
      expense({ month: null }),
      expense({
        id: "invalid-month",
        month: "2026-13",
        amount: "999999999999.123456789012",
      }),
    ]);
    expect(
      source.personnelIncurredReimbursements!.map((row) => row.month),
    ).toEqual([null, "2026-13"]);
    expect(source.personnelIncurredReimbursements![1].amount).toBe(
      "999999999999.123456789012",
    );
    expect(
      source.personnelIncurredReimbursements!.every(
        (row) => row.scopePath === "海淀区 / 商务 / 接待",
      ),
    ).toBe(true);
  });

  it("同笔报销的付款日期源仍独立保留，不被新报销月和范围补全改写", async () => {
    const cash: AnalysisReimbursement = {
      id: "expense-one",
      type: "business",
      date: "2026-05-16",
      amount: "100.100000000001",
      title: "商务活动",
      category: "reception",
      scope: "hd-reception",
      serviceTarget: null,
      userId: "user-one",
      employeeId: "employee-one",
      personName: "测试人员",
      updatedAt: "2026-05-16T01:00:00Z",
    };
    const { source } = await read([expense()], nodes, [cash]);
    expect(source.reimbursements![0].date).toBe("2026-05-16");
    expect(source.personnelIncurredReimbursements![0].month).toBe("2026-04");
    expect(source.reimbursements![0].amount).toBe(
      source.personnelIncurredReimbursements![0].amount,
    );
    expect(source.reimbursements![0].scopePath).toBe(
      source.personnelIncurredReimbursements![0].scopePath,
    );
    expect(cash).not.toHaveProperty("scopePath");
  });
});
