import {
  allocateFinancialAmount,
  buildFinancialAnalysisPeriods,
  buildMonthlyFinancialAnalysis,
  financialAnalysisBusinessDate,
  loadMonthlyFinancialAnalysis,
  type AnalysisContract,
  type AnalysisOverheadAllocation,
  type AnalysisPayroll,
  type AnalysisReceipt,
  type AnalysisReimbursement,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";
import { buildMonthlyFinancialAnalysisWorkbook } from "../server/services/monthlyFinancialAnalysisWorkbook";
import * as XLSX from "xlsx";

const time = "2026-09-02T01:00:00.000Z";
function report(
  month = "2026-08",
  overrides: Partial<FinancialAnalysisReport> = {},
): FinancialAnalysisReport {
  return {
    month,
    status: "closed",
    generatedAt: time,
    savedAt: time,
    closedAt: time,
    accounts: [
      {
        code: "general",
        name: "一般",
        opening: "1000",
        inflow: "200",
        outflow: "100",
        closing: "1100",
      },
      {
        code: "business",
        name: "商务",
        opening: "100",
        inflow: "30",
        outflow: "20",
        closing: "110",
      },
      {
        code: "welfare_one",
        name: "福利一",
        opening: "10",
        inflow: "2",
        outflow: "1",
        closing: "11",
      },
      {
        code: "welfare_two",
        name: "福利二",
        opening: "5",
        inflow: "0",
        outflow: "1",
        closing: "4",
      },
    ],
    income: { mainReceipt: "500", generalInterest: "1" },
    automaticDetails: [],
    manualItems: [],
    ...overrides,
  };
}
function input(
  overrides: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2026-08", to: "2026-08", granularity: "month" },
    generatedAt: time,
    reports: [report()],
    ...overrides,
  };
}
function getModule(data: MonthlyFinancialAnalysisInput, key: string) {
  return buildMonthlyFinancialAnalysis(data).modules.find(
    (row) => row.key === key,
  )!;
}
function pay(
  employeeId: string,
  month = "2026-08",
  overrides: Partial<AnalysisPayroll> = {},
): AnalysisPayroll {
  return {
    id: `pay:${employeeId}:${month}`,
    employeeId,
    userId: `user:${employeeId}`,
    personName: `员工${employeeId}`,
    month,
    salary: "1000",
    housingBase: "1000",
    contributionBase: "1000",
    tax: "0",
    withheldActual: null,
    netActual: null,
    updatedAt: time,
    ...overrides,
  };
}
function reimbursement(
  id: string,
  overrides: Partial<AnalysisReimbursement> = {},
): AnalysisReimbursement {
  return {
    id,
    userId: "user:a",
    employeeId: "a",
    personName: "员工a",
    type: "business",
    date: "2026-08-20",
    amount: "20",
    title: "接待",
    category: "reception",
    scope: "朝阳区",
    serviceTarget: "服务对象",
    updatedAt: time,
    ...overrides,
  };
}
function root(overrides: Partial<AnalysisContract> = {}): AnalysisContract {
  return {
    id: "contract",
    rootId: "contract",
    relationType: "main",
    title: "项目",
    partyA: "甲公司",
    region: "朝阳区",
    status: "effective",
    effectiveAt: "2026-01-10T00:00:00+08:00",
    contractDate: Object.prototype.hasOwnProperty.call(overrides, "effectiveAt")
      ? financialAnalysisBusinessDate(overrides.effectiveAt ?? null)
      : "2026-01-10",
    contractDateSource: "manual",
    originalAmount: "1000",
    amountDelta: "1000",
    amountBefore: null,
    amountAfter: null,
    supplementSequence: null,
    changeType: null,
    updatedAt: time,
    ...overrides,
  };
}
function receipt(overrides: Partial<AnalysisReceipt> = {}): AnalysisReceipt {
  return {
    id: "receipt",
    rootId: "contract",
    date: "2026-08-10",
    amount: "500",
    currency: "CNY",
    status: "confirmed",
    reversedAt: null,
    updatedAt: time,
    ...overrides,
  };
}
function overhead(
  overrides: Partial<AnalysisOverheadAllocation> = {},
): AnalysisOverheadAllocation {
  return {
    id: "match",
    paymentId: "payment",
    paymentKind: "payment",
    date: "2026-08-02",
    paymentAmount: "100",
    amount: "100",
    invoiceId: "invoice",
    invoiceAmount: "100",
    title: "公共费用",
    updatedAt: time,
    lines: [{ id: "rent", category: "rent", amount: "100", verified: true }],
    ...overrides,
  };
}

describe("财务分析周期与精确分摊", () => {
  it("来源更新时间忽略无效文字和非法日期，按真实时刻而非字典序取最新", () => {
    const baseline = report("2026-08", {
      savedAt: "admin",
      generatedAt: "2026-09-02T01:00:00.000Z",
      sources: [
        { key: "a", status: "ok", lastUpdatedAt: "2026-09-02T08:30:00+08:00" },
        { key: "b", status: "ok", lastUpdatedAt: "2026-09-02T02:00:00Z" },
        { key: "c", status: "ok", lastUpdatedAt: "2026-09-02 12:00:00" },
        { key: "d", status: "ok", lastUpdatedAt: "2026-02-30T16:00:00Z" },
        { key: "e", status: "ok", lastUpdatedAt: "admin" },
      ],
    });
    const balances = getModule(input({ reports: [baseline] }), "balances");
    expect(balances.updatedAt).toBe("2026-09-02T04:00:00.000Z");
    expect(balances.details[0].updatedAt).toBe("2026-09-02T04:00:00.000Z");
    expect(balances.summaries.at(-1)?.amount).toBe("1225");
  });
  it("所有来源时间都无效时保持未知，不把用户名显示成更新时间", () => {
    const balances = getModule(
      input({
        reports: [
          report("2026-08", {
            savedAt: "admin",
            generatedAt: "invalid",
            closedAt: null,
            sources: [{ key: "a", status: "ok", lastUpdatedAt: "2026-02-30" }],
          }),
        ],
      }),
      "balances",
    );
    expect(balances.updatedAt).toBeNull();
    expect(balances.details[0].updatedAt).toBeNull();
  });
  it("查询生成时钟变化不改变来源更新时间及分析内容", () => {
    const first = report("2026-08", { generatedAt: "2026-09-02T01:00:00Z" });
    const second = { ...first, generatedAt: "2026-09-02T02:00:00Z" };
    const firstData = buildMonthlyFinancialAnalysis(
      input({ reports: [first] }),
    );
    const secondData = buildMonthlyFinancialAnalysis(
      input({ reports: [second] }),
    );
    expect(secondData.modules).toEqual(firstData.modules);
    expect(secondData.modules[0].details[0].updatedAt).toBe(time);
  });
  it("季度使用查询实际范围，跨年分别生成期间", () => {
    expect(
      buildFinancialAnalysisPeriods({
        from: "2025-11",
        to: "2026-02",
        granularity: "quarter",
      }),
    ).toEqual([
      {
        key: "2025-Q4",
        label: "2025年第4季度",
        from: "2025-11",
        to: "2025-12",
      },
      {
        key: "2026-Q1",
        label: "2026年第1季度",
        from: "2026-01",
        to: "2026-02",
      },
    ]);
  });
  it("拒绝不支持的粒度和非法月份", () => {
    expect(() =>
      buildFinancialAnalysisPeriods({
        from: "2026-01",
        to: "2026-02",
        granularity: "week" as never,
      }),
    ).toThrow("统计粒度");
    expect(() =>
      buildFinancialAnalysisPeriods({
        from: "2026-13",
        to: "2026-14",
        granularity: "month",
      }),
    ).toThrow("月份格式");
  });
  it("三人分摊十元，稳定编号分配尾差，人数顺序不影响结果", () => {
    expect(
      Object.fromEntries(
        allocateFinancialAmount("10", [
          { id: "c", amount: "1" },
          { id: "a", amount: "1" },
          { id: "b", amount: "1" },
        ]),
      ),
    ).toEqual({ a: "3.34", b: "3.33", c: "3.33" });
  });
  it("保留十二位原始精度并支持汇总超过十八位", () => {
    const total = "1999999999999999998.000000000001";
    const parts = allocateFinancialAmount(total, [
      { id: "a", amount: "1" },
      { id: "b", amount: "1" },
      { id: "c", amount: "1" },
    ]);
    expect(addFinancialAmounts(...parts.values())).toBe(total);
  });
  it("发票按权重拆分而非每行都计入全部付款", () => {
    expect(
      Object.fromEntries(
        allocateFinancialAmount("50", [
          { id: "rent", amount: "80" },
          { id: "electricity", amount: "20" },
        ]),
      ),
    ).toEqual({ electricity: "10", rent: "40" });
    expect(() =>
      allocateFinancialAmount("1", [
        { id: "same", amount: "1" },
        { id: "same", amount: "1" },
      ]),
    ).toThrow("编号重复");
    expect(() =>
      allocateFinancialAmount("1", [{ id: "a", amount: "0" }]),
    ).toThrow("大于零");
  });
});

describe("四账户余额、结算与缺月", () => {
  it("来源缺失和待复核提示透传，不将默认零值当完整月报", () => {
    const baseline = report("2026-08", {
      sources: [
        { key: "reimbursements", status: "missing", message: "报销来源不可用" },
      ],
      validations: {
        blockers: [
          { code: "MONTHLY_BANK_REVIEW_REQUIRED", message: "银行交易仍待复核" },
        ],
        warnings: [],
      },
    });
    const result = buildMonthlyFinancialAnalysis(
      input({ reports: [baseline] }),
    );
    expect(result.warnings.join()).toContain("报销来源不可用");
    expect(result.warnings.join()).toContain("银行交易仍待复核");
    expect(
      result.modules.find((row) => row.key === "business")?.summaries[0].amount,
    ).toBeNull();
    expect(
      result.modules.find((row) => row.key === "settlement")?.summaries[0]
        .amount,
    ).toBeNull();
    expect(
      result.modules.find((row) => row.key === "balances")?.summaries[0].amount,
    ).toBeNull();
    expect(
      result.modules.find((row) => row.key === "inflow")?.summaries[0].amount,
    ).toBe("500");
  });
  it("仅未月结门禁不抹去当前工作金额", () => {
    const baseline = report("2026-08", {
      status: "reopened",
      validations: {
        blockers: [
          { code: "PREVIOUS_MONTH_NOT_CLOSED", message: "上月未月结" },
        ],
        warnings: [],
      },
    });
    expect(
      getModule(input({ reports: [baseline] }), "balances").summaries.at(-1)
        ?.amount,
    ).toBe("1225");
  });
  it("返回完整七个模块，四账户单列，余额不按月相加", () => {
    const data = input({
      query: { from: "2026-08", to: "2026-09", granularity: "quarter" },
      reports: [report(), report("2026-09")],
    });
    expect(
      buildMonthlyFinancialAnalysis(data).modules.map((row) => row.key),
    ).toEqual([
      "balances",
      "inflow",
      "outflow",
      "projects",
      "settlement",
      "business",
      "personnel",
    ]);
    const balances = getModule(data, "balances");
    expect(balances.title).toBe("账户余额资金台帐");
    expect(balances.summaries.at(-1)?.amount).toBe("1225");
    expect(balances.series.at(-1)?.values).toEqual(["1225"]);
    const settlement = getModule(data, "settlement");
    expect(settlement.summaries.map((row) => row.amount)).toEqual([
      "464",
      "244",
      "220",
    ]);
  });
  it("末月缺失不回填更早余额，季度收支也保持未知", () => {
    const data = input({
      query: { from: "2026-08", to: "2026-09", granularity: "quarter" },
    });
    expect(
      getModule(data, "balances").summaries.every((row) => row.amount === null),
    ).toBe(true);
    expect(
      getModule(data, "settlement").summaries.every(
        (row) => row.amount === null,
      ),
    ).toBe(true);
    expect(getModule(data, "personnel").series[0].values).toEqual([null]);
  });
  it("全年收支逐月累计，年度账户余额只取十二月", () => {
    const reports = Array.from({ length: 12 }, (_, index) =>
      report(`2025-${String(index + 1).padStart(2, "0")}`),
    );
    reports[11].accounts[0].closing = "2100.123456789012";
    const data = input({
      query: { from: "2025-01", to: "2025-12", granularity: "year" },
      reports,
    });
    const balances = getModule(data, "balances");
    expect(balances.series.at(-1)?.values).toEqual(["2225.123456789012"]);
    expect(balances.summaries.at(-1)?.amount).toBe("2225.123456789012");
    const settlement = getModule(data, "settlement");
    expect(settlement.series.map((row) => row.values)).toEqual([
      ["2784"],
      ["1464"],
      ["1320"],
    ]);
    expect(settlement.summaries.map((row) => row.amount)).toEqual([
      "2784",
      "1464",
      "1320",
    ]);
  });
  it("年度中间月份缺失使期间收支未知，但不抹去可信年末余额", () => {
    const reports = Array.from({ length: 12 }, (_, index) =>
      report(`2025-${String(index + 1).padStart(2, "0")}`),
    ).filter((row) => row.month !== "2025-06");
    const data = input({
      query: { from: "2025-01", to: "2025-12", granularity: "year" },
      reports,
    });
    expect(getModule(data, "balances").series.at(-1)?.values).toEqual(["1225"]);
    expect(
      getModule(data, "settlement").series.every(
        (row) => row.values[0] === null,
      ),
    ).toBe(true);
    expect(
      getModule(data, "settlement").summaries.every(
        (row) => row.amount === null,
      ),
    ).toBe(true);
  });
  it("空来源不是人员真实零值", () => {
    const personnel = getModule(input({ reports: [] }), "personnel");
    expect(personnel.series[0].values).toEqual([null]);
    expect(personnel.summaries[0].amount).toBeNull();
  });
  it("负余额和零余额合计提示饼图不适用", () => {
    const baseline = report();
    baseline.accounts[0].closing = "-1";
    expect(
      getModule(input({ reports: [baseline] }), "balances").warnings.join(),
    ).toContain("负数");
  });
  it("大金额精确跨过单笔录入上限，不经浮点重算", () => {
    const baseline = report();
    baseline.accounts[0].closing = "999999999999999999.123456789012";
    baseline.accounts[1].closing = "999999999999999999.000000000001";
    expect(
      getModule(input({ reports: [baseline] }), "balances").summaries.at(-1)
        ?.amount,
    ).toBe("2000000000000000013.123456789013");
  });
});

describe("主营回款与一般支出分类", () => {
  it("无月报的同月人民币与外币回款不能只取人民币片段作为完整主营收入", () => {
    const result = getModule(
      input({
        reports: [],
        contracts: [root()],
        receipts: [
          receipt(),
          receipt({ id: "foreign", amount: "50", currency: "USD" }),
        ],
      }),
      "inflow",
    );
    expect(result.summaries[0].amount).toBeNull();
    expect(result.series[0].values).toEqual([null]);
    expect(result.details.map((row) => row.amount)).toEqual(["500"]);
    expect(result.warnings.join()).toContain("人民币明细仅为已知部分");
  });
  it("开放月报自身包含外币回款来源时不将混合总额当人民币", () => {
    const baseline = report("2026-08", {
      status: "draft",
      income: { mainReceipt: "550", generalInterest: "0" },
      automaticDetails: [
        {
          sourceType: "contract_receipt",
          sourceId: "receipt",
          occurredOn: "2026-08-10",
          accountCode: "general",
          metric: "main_receipt",
          amount: "500",
          description: "人民币回款",
        },
        {
          sourceType: "contract_receipt",
          sourceId: "foreign",
          occurredOn: "2026-08-10",
          accountCode: "general",
          metric: "main_receipt",
          amount: "50",
          description: "外币回款",
          analysis: {
            schemaVersion: 1,
            contractRootId: "contract",
            partyA: "甲公司",
            contractRegion: "朝阳区",
          },
        },
      ],
    });
    const result = getModule(
      input({
        reports: [baseline],
        contracts: [root()],
        receipts: [
          receipt(),
          receipt({ id: "foreign", amount: "50", currency: "USD" }),
        ],
      }),
      "inflow",
    );
    expect(result.summaries[0].amount).toBeNull();
    expect(result.summaries[1].amount).toBe("0");
    expect(
      result.details.find((row) => row.sourceId === "foreign")?.amount,
    ).toBeNull();
    expect(
      result.details.find((row) => row.sourceId === "foreign")?.sourceState,
    ).toContain("原币USD金额50");
    expect(result.warnings.join()).toContain("没有冻结汇率");
    expect(baseline.income.mainReceipt).toBe("550");
  });
  it("同月后来新增但不属于月结快照的外币来源不反向污染冻结回款", () => {
    const baseline = report("2026-08", {
      income: { mainReceipt: "500", generalInterest: "0" },
      automaticDetails: [
        {
          sourceType: "contract_receipt",
          sourceId: "receipt",
          occurredOn: "2026-08-10",
          accountCode: "general",
          metric: "main_receipt",
          amount: "500",
          description: "已冻结人民币回款",
          analysis: {
            schemaVersion: 1,
            contractRootId: "contract",
            partyA: "甲公司",
            contractRegion: "朝阳区",
          },
        },
      ],
    });
    const result = getModule(
      input({
        reports: [baseline],
        contracts: [root()],
        receipts: [
          receipt(),
          receipt({ id: "new-foreign", amount: "50", currency: "USD" }),
        ],
      }),
      "inflow",
    );
    expect(result.summaries[0].amount).toBe("500");
    expect(result.details.map((row) => row.sourceId)).toEqual(["receipt"]);
    expect(result.warnings.join()).not.toContain("非人民币");
  });
  it("新月结回款优先冻结甲方及区域，即使当前合同维度已变化", () => {
    const baseline = report("2026-08", {
      automaticDetails: [
        {
          sourceType: "contract_receipt",
          sourceId: "receipt",
          occurredOn: "2026-08-10",
          accountCode: "general",
          metric: "main_receipt",
          amount: "500",
          description: "原项目",
          analysis: {
            schemaVersion: 1,
            contractRootId: "contract",
            partyA: "原甲方",
            contractRegion: "原区域",
          },
        },
      ],
    });
    const data = buildMonthlyFinancialAnalysis(
      input({
        query: {
          from: "2026-08",
          to: "2026-08",
          granularity: "month",
          partyA: "原甲方",
          contractRegion: "原区域",
        },
        reports: [baseline],
        contracts: [root({ partyA: "新甲方", region: "新区域" })],
        receipts: [receipt()],
      }),
    );
    const result = data.modules.find((row) => row.key === "inflow")!;
    expect(result.summaries[0].amount).toBe("500");
    expect(result.details[0].partyA).toBe("原甲方");
    expect(result.details[0].sourceState).toContain("原报表冻结值");
    expect(data.filterOptions.parties).toContain("原甲方");
    expect(data.filterOptions.contractRegions).toContain("原区域");
  });
  it("历史汇总缺明细时显示差额追溯，甲方筛选不能产生假零", () => {
    const data = input({
      query: {
        from: "2026-08",
        to: "2026-08",
        granularity: "month",
        partyA: "甲公司",
      },
    });
    expect(getModule(data, "inflow").summaries[0].amount).toBeNull();
    const result = getModule(input(), "inflow");
    expect(
      addFinancialAmounts(...result.details.map((row) => row.amount!)),
    ).toBe("501");
    expect(
      result.details.every((row) => row.sourceState?.includes("差额")),
    ).toBe(true);
  });
  it("实际回款和利息不被账户拆分核算基数替代", () => {
    const result = getModule(input(), "inflow");
    expect(result.summaries.map((row) => row.amount)).toEqual(["500", "1"]);
  });
  it("甲方筛选只影响回款；没有归属的利息不作为零展示", () => {
    const data = input({
      query: {
        from: "2026-08",
        to: "2026-08",
        granularity: "month",
        partyA: "甲公司",
        contractRegion: "朝阳区",
      },
      contracts: [root()],
      receipts: [receipt()],
      reports: [
        report("2026-08", {
          automaticDetails: [
            {
              sourceType: "contract_receipt",
              sourceId: "receipt",
              occurredOn: "2026-08-10",
              accountCode: "general",
              metric: "main_receipt",
              amount: "500",
              description: "项目回款",
            },
          ],
        }),
      ],
    });
    expect(
      getModule(data, "inflow").summaries.map((row) => row.amount),
    ).toEqual(["500", null]);
    expect(getModule(data, "settlement").summaries[0].amount).toBe("232");
  });
  it("同编号金额已变更时，不将实时甲方套在历史回款上", () => {
    const data = input({
      query: {
        from: "2026-08",
        to: "2026-08",
        granularity: "month",
        partyA: "甲公司",
      },
      contracts: [root()],
      receipts: [receipt({ amount: "501" })],
      reports: [
        report("2026-08", {
          automaticDetails: [
            {
              sourceType: "contract_receipt",
              sourceId: "receipt",
              occurredOn: "2026-08-10",
              accountCode: "general",
              metric: "main_receipt",
              amount: "500",
              description: "项目回款",
            },
          ],
        }),
      ],
    });
    expect(getModule(data, "inflow").summaries[0].amount).toBeNull();
  });
  it("报销行政分类、资产和手续费不重复，税费不能取预留", () => {
    const baseline = report();
    baseline.automaticDetails = [
      {
        sourceType: "reimbursement",
        sourceId: "r",
        occurredOn: "2026-08-20",
        accountCode: "general",
        metric: "basic_reimbursement",
        amount: "60",
        description: "用品",
        personId: "user:a",
      },
      {
        sourceType: "asset_payment",
        sourceId: "asset",
        occurredOn: "2026-08-20",
        accountCode: "general",
        metric: "asset_administration",
        amount: "30",
        description: "设备",
      },
    ];
    baseline.manualItems = [
      {
        id: "old",
        category: "general_bank_fee",
        accountCode: "general",
        direction: "expense",
        occurredOn: "2026-08-20",
        amount: "100",
        effective: false,
      },
      {
        id: "active",
        category: "general_bank_fee",
        accountCode: "general",
        direction: "expense",
        occurredOn: "2026-08-20",
        amount: "10",
        effective: true,
      },
    ];
    const result = getModule(
      input({
        reports: [baseline],
        reimbursements: [
          reimbursement("r", {
            type: "basic",
            amount: "60",
            category: "office_supplies",
          }),
        ],
      }),
      "outflow",
    );
    expect(
      Object.fromEntries(result.breakdown.map((row) => [row.key, row.amount])),
    ).toEqual({
      administration: "60",
      salary: "0",
      other: "10",
      tax: null,
      asset: "30",
    });
    expect(result.series.find((row) => row.key === "tax")?.values).toEqual([
      null,
    ]);
    expect(result.details).toHaveLength(3);
    expect(result.summaries[0].amount).toBe("100");
  });
  it("仅凭说明和凭证号的税费付款归入税费且与一般账户支出闭合", () => {
    const baseline = report();
    baseline.accounts[0] = {
      ...baseline.accounts[0],
      outflow: "25.123",
      closing: "1174.877",
    };
    baseline.manualItems = [
      {
        id: "tax-1",
        category: "general_tax_payment",
        accountCode: "general",
        direction: "expense",
        occurredOn: "2026-08-15",
        amount: "25.123",
        description: "已实际缴纳企业所得税",
        voucherReference: "税收缴款凭证-20260815",
        sourceType: "manual",
        effective: true,
      },
    ];
    const result = getModule(input({ reports: [baseline] }), "outflow");
    expect(result.series.find((row) => row.key === "tax")?.values).toEqual([
      "25.123",
    ]);
    expect(result.breakdown.find((row) => row.key === "tax")?.amount).toBe(
      "25.123",
    );
    expect(result.details).toHaveLength(1);
    expect(result.details[0].category).toBe("实际税费支出");
    expect(result.details[0].voucherReference).toBe("税收缴款凭证-20260815");
    const workbook = XLSX.read(
      buildMonthlyFinancialAnalysisWorkbook(
        buildMonthlyFinancialAnalysis(input({ reports: [baseline] })),
        "outflow",
      ),
      { type: "buffer" },
    );
    const rows = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets["一般账户出账统计-明细"],
      { header: 1 },
    );
    expect(rows[1][rows[0].indexOf("凭证号")]).toBe("税收缴款凭证-20260815");
    expect(result.warnings.join()).not.toContain("部分月份没有填写");
  });

  it("没有实际税费付款凭证时税费保持未知，不以回款税费预留代替", () => {
    const result = getModule(input(), "outflow");
    expect(result.series.find((row) => row.key === "tax")?.values).toEqual([
      null,
    ]);
    expect(
      result.breakdown.find((row) => row.key === "tax")?.amount,
    ).toBeNull();
    expect(result.warnings.join()).toContain("不以主营回款税费预留替代");
  });

  it("季度内任一月份没有税费凭证时完整序列未知，结构保留已知税费小计", () => {
    const withTax = report("2026-08");
    withTax.accounts[0] = {
      ...withTax.accounts[0],
      outflow: "25",
      closing: "1175",
    };
    withTax.manualItems = [
      {
        id: "tax-quarter",
        category: "general_tax_payment",
        accountCode: "general",
        direction: "expense",
        occurredOn: "2026-08-20",
        amount: "25",
        description: "实际缴税",
        voucherReference: "税凭-季度",
      },
    ];
    const withoutTax = report("2026-09");
    const result = getModule(
      input({
        query: { from: "2026-08", to: "2026-09", granularity: "quarter" },
        reports: [withTax, withoutTax],
      }),
      "outflow",
    );
    expect(result.series.find((row) => row.key === "tax")?.values).toEqual([
      null,
    ]);
    expect(result.breakdown.find((row) => row.key === "tax")).toMatchObject({
      amount: "25",
      note: expect.stringContaining("已知"),
    });
    expect(
      result.series.find((row) => row.key === "categoryTotal"),
    ).toMatchObject({ partial: [true] });
    expect(
      result.details.some(
        (row) => row.category === "实际税费支出" && row.amount === "25",
      ),
    ).toBe(true);
  });
});

describe("项目历史截止口径", () => {
  it("跨年项目已回款和未回款各取年末截止值，不累加月末余额", () => {
    const data = input({
      query: { from: "2025-01", to: "2026-08", granularity: "year" },
      reports: [],
      contracts: [root({ effectiveAt: "2025-01-01T00:00:00+08:00" })],
      receipts: [
        receipt({ id: "first", date: "2025-02-01", amount: "200" }),
        receipt({ id: "second", date: "2025-12-31", amount: "300" }),
        receipt({ id: "third", date: "2026-01-01", amount: "100" }),
      ],
    });
    const projects = getModule(data, "projects");
    expect(projects.series.map((row) => row.values)).toEqual([
      ["1000", "1000"],
      ["500", "600"],
      ["500", "400"],
      ["500", "100"],
      ["1", "0"],
    ]);
    expect(projects.summaries.map((row) => row.amount)).toEqual([
      "1000",
      "600",
      "400",
      "600",
      "1",
    ]);
  });
  it("历史合同按可信签订日期重建，不按多年后的系统归档日", () => {
    const contract = root({
      contractDate: "2021-03-10",
      contractDateSource: "manual",
      effectiveAt: "2026-08-20T00:00:00Z",
    });
    const data = input({
      reports: [],
      query: { from: "2025-01", to: "2025-12", granularity: "year" },
      contracts: [contract],
    });
    expect(getModule(data, "projects").summaries[0].amount).toBe("1000");
    expect(
      getModule(
        {
          ...data,
          contracts: [{ ...contract, contractDateSource: "upload_date" }],
        },
        "projects",
      ).summaries[0].amount,
    ).toBeNull();
  });
  it("生效和冲正时间戳按北京时间归日，不提前计入上月", () => {
    const contracts = [
      root(),
      root({
        id: "supplement",
        relationType: "supplement",
        effectiveAt: "2026-08-31T18:00:00Z",
        originalAmount: null,
        amountDelta: "200",
        amountBefore: "1000",
        amountAfter: "1200",
        supplementSequence: 1,
        changeType: "amount_adjustment",
      }),
    ];
    const result = getModule(
      input({
        query: { from: "2026-08", to: "2026-09", granularity: "month" },
        contracts,
        receipts: [
          receipt({ status: "reversed", reversedAt: "2026-08-31T18:00:00Z" }),
        ],
      }),
      "projects",
    );
    expect(result.series[0].values).toEqual(["1000", "1200"]);
    expect(result.series[1].values).toEqual(["500", "0"]);
    const newRoot = getModule(
      input({
        query: { from: "2026-08", to: "2026-09", granularity: "month" },
        contracts: [root({ effectiveAt: "2026-08-31T18:00:00Z" })],
      }),
      "projects",
    );
    expect(newRoot.series[0].values).toEqual(["0", "1000"]);
  });
  it("当前月份只统计截至今天，未来期末值不预测也不显示零", () => {
    const result = getModule(
      input({
        query: { from: "2026-09", to: "2026-12", granularity: "month" },
        contracts: [root()],
        receipts: [receipt({ date: "2026-09-15" })],
      }),
      "projects",
    );
    expect(result.series[1].values).toEqual(["0", null, null, null]);
    expect(result.summaries.every((row) => row.amount === null)).toBe(true);
    expect(result.warnings.join()).toContain("尚未发生");
    expect(
      getModule(
        input({
          reports: [],
          contracts: [],
          query: { from: "2026-12", to: "2026-12", granularity: "year" },
        }),
        "projects",
      ).series[0].values,
    ).toEqual([null]);
  });
  it("按生效月份应用补充协议，未回款取期末不是月余额之和", () => {
    const data = input({
      reports: [],
      query: { from: "2026-07", to: "2026-09", granularity: "month" },
      contracts: [
        root(),
        root({
          id: "supplement",
          relationType: "supplement",
          effectiveAt: "2026-09-01",
          originalAmount: null,
          amountDelta: "200",
          amountBefore: "1000",
          amountAfter: "1200",
          supplementSequence: 1,
          changeType: "amount_adjustment",
        }),
      ],
      receipts: [receipt()],
    });
    const result = getModule(data, "projects");
    expect(result.series.map((row) => row.values)).toEqual([
      ["1000", "1000", "1200"],
      ["0", "500", "500"],
      ["1000", "500", "700"],
      ["0", "500", "0"],
      ["0", "0", "0"],
    ]);
    expect(result.summaries.map((row) => row.amount)).toEqual([
      "1200",
      "500",
      "700",
      "500",
      "0",
    ]);
  });
  it("没有生效日期或断裂变更链时保留未知", () => {
    const noDate = getModule(
      // 已明确完整查询无回款；合同日期未知不影响真实期间零回款。
      input({ contracts: [root({ effectiveAt: null })], receipts: [] }),
      "projects",
    );
    expect(
      noDate.summaries
        .filter((row) => row.key !== "periodReceived")
        .every((row) => row.amount === null),
    ).toBe(true);
    expect(
      noDate.summaries.find((row) => row.key === "periodReceived")?.amount,
    ).toBe("0");
    const broken = getModule(
      input({
        contracts: [
          root(),
          root({
            id: "s",
            relationType: "supplement",
            amountDelta: "100",
            amountBefore: "900",
            amountAfter: "1000",
            changeType: "amount_adjustment",
          }),
        ],
      }),
      "projects",
    );
    expect(broken.summaries[0].amount).toBeNull();
  });
  it("冲正前历史期仍保留当时回款，冲正后不再计入", () => {
    const result = getModule(
      input({
        reports: [],
        query: { from: "2026-08", to: "2026-09", granularity: "month" },
        contracts: [root()],
        receipts: [
          receipt({ status: "reversed", reversedAt: "2026-09-01T00:00:00Z" }),
        ],
      }),
      "projects",
    );
    expect(result.series.find((row) => row.key === "received")?.values).toEqual(
      ["500", "0"],
    );
  });
  it("超额回款保留负差额，非人民币不混加", () => {
    expect(
      getModule(
        input({ contracts: [root()], receipts: [receipt({ amount: "1200" })] }),
        "projects",
      ).summaries[2].amount,
    ).toBe("-200");
    expect(
      getModule(
        input({
          contracts: [root()],
          receipts: [receipt({ currency: "USD" })],
        }),
        "projects",
      ).summaries[1].amount,
    ).toBeNull();
  });
});

describe("商务和人员成本", () => {
  it("新月结读取冻结工资分项，实时台账改变也不影响历史组成", () => {
    const live = pay("a", "2026-08", {
      salary: "1200",
      contributionBase: "0",
      housingBase: "0",
      withheldActual: "600",
      netActual: "900",
    });
    const baseline = report("2026-08", {
      automaticDetails: [
        {
          sourceType: "payroll",
          sourceId: live.id,
          occurredOn: "2026-08-01",
          accountCode: "general",
          metric: "human_cost",
          amount: "1500",
          description: "人力成本",
          personId: "a",
          personName: "员工a",
          analysis: {
            schemaVersion: 1,
            canonicalPersonId: "a",
            payrollParts: {
              salary: "1000",
              social: "267",
              housing: "60",
              adjustment: "173",
            },
          },
        },
      ],
    });
    const result = getModule(
      input({ reports: [baseline], payroll: [live] }),
      "personnel",
    );
    expect([
      result.details[0].salary,
      result.details[0].social,
      result.details[0].housing,
      result.details[0].adjustment,
      result.details[0].total,
    ]).toEqual(["1000", "267", "60", "173", "1500"]);
    expect(result.details[0].sourceState).toContain("原报表冻结值");
    expect(
      getModule(input({ reports: [baseline], payroll: [] }), "personnel")
        .details[0].salary,
    ).toBe("1000");
  });
  it("冻结工资分项与原总额不闭合时保持未知，不回退可变工资", () => {
    const live = pay("a", "2026-08", {
      withheldActual: "600",
      netActual: "900",
    });
    const baseline = report("2026-08", {
      automaticDetails: [
        {
          sourceType: "payroll",
          sourceId: live.id,
          occurredOn: "2026-08-01",
          accountCode: "general",
          metric: "human_cost",
          amount: "1500",
          description: "人力成本",
          personId: "a",
          analysis: {
            schemaVersion: 1,
            payrollParts: {
              salary: "1000",
              social: "0",
              housing: "0",
              adjustment: "0",
            },
          },
        },
      ],
    });
    const data = buildMonthlyFinancialAnalysis(
      input({ reports: [baseline], payroll: [live] }),
    );
    const result = data.modules.find((row) => row.key === "personnel")!;
    expect(result.details[0].salary).toBeNull();
    expect(result.details[0].total).toBe("1500");
    expect(data.warnings.join()).toContain("未改用当前台账覆盖历史");
  });
  it("新月结报销使用冻结人员和范围，当前人员归属及范围变化不覆盖", () => {
    const baseline = report("2026-08", {
      automaticDetails: [
        {
          sourceType: "reimbursement",
          sourceId: "r",
          occurredOn: "2026-08-20",
          accountCode: "business",
          metric: "business_reimbursement",
          amount: "20",
          description: "商务报销",
          personId: "raw-user",
          personName: "旧姓名",
          analysis: {
            schemaVersion: 1,
            canonicalPersonId: "old-employee",
            reimbursementCategory: "reception",
            reimbursementScope: "旧范围",
            reimbursementServiceTarget: "旧对象",
          },
        },
      ],
    });
    const data = buildMonthlyFinancialAnalysis(
      input({
        query: {
          from: "2026-08",
          to: "2026-08",
          granularity: "month",
          reimbursementScope: "旧范围",
        },
        reports: [baseline],
        reimbursements: [
          reimbursement("r", {
            employeeId: "new-employee",
            scope: "新范围",
            serviceTarget: "新对象",
          }),
        ],
      }),
    );
    const result = data.modules.find((row) => row.key === "business")!;
    expect(result.summaries[0].amount).toBe("20");
    expect(result.details[0].scope).toBe("旧范围");
    expect(result.details[0].serviceTarget).toBe("旧对象");
    expect(data.filterOptions.reimbursementScopes).toContain("旧范围");
    expect(
      data.modules.find((row) => row.key === "personnel")?.details[0].personId,
    ).toBe("old-employee");
  });
  it("预生成未来工资和未来付款不计入当年实际成本及未来趋势", () => {
    const result = getModule(
      input({
        reports: [],
        query: { from: "2026-08", to: "2026-12", granularity: "month" },
        payroll: [pay("a"), pay("a", "2026-12", { salary: "5000" })],
        reimbursements: [
          reimbursement("future", { date: "2026-12-10", amount: "999" }),
        ],
      }),
      "personnel",
    );
    expect(result.series[0].values).toEqual(["1327", null, null, null, null]);
    expect(result.details.every((row) => row.annualTotal === "1327")).toBe(
      true,
    );
    expect(result.sourceLabel).toContain("未来预生成工资排除");
    expect(
      getModule(
        input({
          reports: [],
          query: { from: "2026-12", to: "2026-12", granularity: "month" },
          reimbursements: [reimbursement("future", { date: "2026-12-10" })],
        }),
        "business",
      ).summaries[0].amount,
    ).toBeNull();
  });
  it.each([
    { status: "draft" as const, label: "草稿" },
    { status: "closed" as const, label: "已月结" },
  ])(
    "当前月$label报表内部未来自动明细不能绕过实际发生过滤，原快照保持不变",
    ({ status }) => {
      const baseline = report("2026-09", {
        status,
        income: { mainReceipt: "510", generalInterest: "0" },
        automaticDetails: [
          ...[
            { id: "business-current", date: "2026-09-01", total: "20" },
            { id: "business-future", date: "2026-09-15", total: "999" },
          ].map((row) => ({
            sourceType: "reimbursement",
            sourceId: row.id,
            occurredOn: row.date,
            accountCode: "business",
            metric: "business_reimbursement",
            amount: row.total,
            description: row.id,
            personId: "a",
            personName: "员工a",
            analysis: {
              schemaVersion: 1 as const,
              canonicalPersonId: "a",
              reimbursementScope: "朝阳区",
            },
          })),
          ...[
            { id: "receipt-current", date: "2026-09-01", total: "10" },
            { id: "receipt-future", date: "2026-09-15", total: "500" },
          ].map((row) => ({
            sourceType: "contract_receipt",
            sourceId: row.id,
            occurredOn: row.date,
            accountCode: "general",
            metric: "main_receipt",
            amount: row.total,
            description: row.id,
            analysis: {
              schemaVersion: 1 as const,
              contractRootId: "contract",
              partyA: "甲方",
              contractRegion: "朝阳区",
            },
          })),
        ],
      });
      const original = JSON.stringify(baseline);
      const data = buildMonthlyFinancialAnalysis(
        input({
          query: { from: "2026-09", to: "2026-09", granularity: "month" },
          reports: [baseline],
        }),
      );
      const business = data.modules.find((row) => row.key === "business")!;
      expect(business.summaries[0].amount).toBeNull();
      expect(business.breakdown[0].amount).toBeNull();
      expect(business.details.map((row) => row.sourceId)).toEqual([
        "business-current",
      ]);
      expect(business.details[0].amount).toBe("20");
      const inflow = data.modules.find((row) => row.key === "inflow")!;
      expect(inflow.summaries[0].amount).toBeNull();
      expect(inflow.details.map((row) => row.sourceId)).toEqual([
        "receipt-current",
      ]);
      const personnel = data.modules.find((row) => row.key === "personnel")!;
      expect(personnel.summaries[0].amount).toBeNull();
      expect(personnel.summaries[1].amount).toBe("20");
      expect(personnel.details[0].annualTotal).toBe("20");
      expect(personnel.details[0].sourceId).toBe("business-current");
      expect(
        data.modules
          .find((row) => row.key === "balances")!
          .summaries.every((row) => row.amount === null),
      ).toBe(true);
      expect(
        data.modules
          .find((row) => row.key === "settlement")!
          .summaries.every((row) => row.amount === null),
      ).toBe(true);
      expect(data.warnings.join()).toContain("未来发生明细");
      expect(JSON.stringify(baseline)).toBe(original);
      expect(baseline.analysisFutureSources).toBeUndefined();
    },
  );
  it("当前月报内部未来手工利息和电费不进入实际明细或人员年度成本", () => {
    const baseline = report("2026-09", {
      status: "draft",
      income: { mainReceipt: "0", generalInterest: "42" },
      automaticDetails: [
        {
          sourceType: "payroll",
          sourceId: "pay-current",
          occurredOn: "2026-09-01",
          accountCode: "general",
          metric: "human_cost",
          amount: "1327",
          description: "工资",
          personId: "a",
          personName: "员工a",
          analysis: {
            schemaVersion: 1,
            canonicalPersonId: "a",
            payrollParts: {
              salary: "1000",
              social: "267",
              housing: "60",
              adjustment: "0",
            },
          },
        },
      ],
      manualItems: [
        {
          id: "interest-current",
          category: "general_interest",
          accountCode: "general",
          direction: "income",
          occurredOn: "2026-09-01",
          amount: "1",
        },
        {
          id: "interest-future",
          category: "general_interest",
          accountCode: "general",
          direction: "income",
          occurredOn: "2026-09-15",
          amount: "41",
        },
        {
          id: "electricity-current",
          category: "welfare_one_electricity",
          accountCode: "welfare_one",
          direction: "expense",
          occurredOn: "2026-09-01",
          amount: "10",
        },
        {
          id: "electricity-future",
          category: "welfare_one_electricity",
          accountCode: "welfare_one",
          direction: "expense",
          occurredOn: "2026-09-15",
          amount: "70",
        },
      ],
    });
    const original = JSON.stringify(baseline);
    const data = buildMonthlyFinancialAnalysis(
      input({
        query: { from: "2026-09", to: "2026-09", granularity: "month" },
        reports: [baseline],
      }),
    );
    const inflow = data.modules.find((row) => row.key === "inflow")!;
    expect(inflow.summaries[1].amount).toBeNull();
    expect(inflow.details.map((row) => row.sourceId)).toEqual([
      "interest-current",
    ]);
    const personnel = data.modules.find((row) => row.key === "personnel")!;
    expect(personnel.details[0].overhead).toBe("0");
    expect(personnel.details[0].total).toBeNull();
    expect(personnel.details[0].knownTotal).toBe("1327");
    expect(personnel.details[0].annualTotal).toBe("1327");
    expect(personnel.details[0].sourceId).not.toContain("electricity-current");
    expect(personnel.details[0].sourceId).not.toContain("future");
    expect(JSON.stringify(baseline)).toBe(original);
  });
  it("已被银行来源替代的不生效未来手工项不使有效汇总变为未知", () => {
    const baseline = report("2026-09", {
      income: { mainReceipt: "0", generalInterest: "1" },
      manualItems: [
        {
          id: "current",
          category: "general_interest",
          accountCode: "general",
          direction: "income",
          occurredOn: "2026-09-01",
          amount: "1",
          effective: true,
        },
        {
          id: "ignored",
          category: "general_interest",
          accountCode: "general",
          direction: "income",
          occurredOn: "2026-09-15",
          amount: "999",
          effective: false,
        },
      ],
    });
    const data = buildMonthlyFinancialAnalysis(
      input({
        query: { from: "2026-09", to: "2026-09", granularity: "month" },
        reports: [baseline],
      }),
    );
    const inflow = data.modules.find((row) => row.key === "inflow")!;
    expect(inflow.summaries[1].amount).toBe("1");
    expect(inflow.details.map((row) => row.sourceId)).toEqual(["current"]);
    expect(data.warnings.join()).not.toContain("未来发生明细");
  });
  it("已月结总额相同但组成不同也不回填当前工资分项", () => {
    const original = pay("a", "2026-08", {
      salary: "1200",
      contributionBase: "0",
      housingBase: "0",
      withheldActual: "600",
      netActual: "900",
    });
    const baseline = report("2026-08", {
      automaticDetails: [
        {
          sourceType: "payroll",
          sourceId: original.id,
          occurredOn: "2026-08-01",
          accountCode: "general",
          metric: "human_cost",
          amount: "1500",
          description: "人力成本",
          personId: "a",
          personName: "员工a",
        },
      ],
    });
    const result = getModule(
      input({ reports: [baseline], payroll: [original] }),
      "personnel",
    );
    expect(result.details[0].salary).toBeNull();
    expect(result.details[0].social).toBeNull();
    expect(result.details[0].total).toBe("1500");
  });
  it("同张发票分次付款不能重复吃分类尾差，跨年查询仍使用之前分配", () => {
    const lines = [
      { id: "a-rent", category: "rent", amount: "0.01", verified: true },
      { id: "z-other", category: "other_cost", amount: "0.01", verified: true },
    ];
    const first = overhead({
      id: "first",
      paymentId: "first-payment",
      date: "2025-12-31",
      amount: "0.01",
      paymentAmount: "0.01",
      invoiceAmount: "0.02",
      lines,
    });
    const second = overhead({
      id: "second",
      paymentId: "second-payment",
      date: "2026-01-02",
      amount: "0.01",
      paymentAmount: "0.01",
      invoiceAmount: "0.02",
      lines,
    });
    const data = input({
      reports: [],
      query: { from: "2026-01", to: "2026-01", granularity: "month" },
      payroll: [pay("a", "2026-01")],
      overheadAllocations: [second, first],
      overheadCandidates: [],
    });
    expect(getModule(data, "personnel").details[0].overhead).toBe("0");
    const both = getModule(
      {
        ...data,
        query: { from: "2025-12", to: "2026-01", granularity: "month" },
        payroll: [pay("a", "2025-12"), pay("a", "2026-01")],
      },
      "personnel",
    );
    expect(
      addFinancialAmounts(...both.details.map((row) => row.overhead!)),
    ).toBe("0.01");
  });
  it("房租付款没有票款对应或分类来源时公共费用未知，不显示完整零成本", () => {
    const result = getModule(
      input({
        reports: [],
        payroll: [pay("a")],
        overheadCandidates: [
          {
            id: "unmatched-rent",
            kind: "payment",
            date: "2026-08-01",
            amount: "100",
            title: "房租",
            scopeCoverage: "included",
          },
        ],
      }),
      "personnel",
    );
    expect(result.details[0].overhead).toBeNull();
    expect(result.details[0].total).toBeNull();
    expect(result.warnings.join()).toContain("不能按零处理");
  });
  it("不完整期间的商务构成和人员对比不把已知部分画成全部", () => {
    const data = input({
      query: { from: "2026-08", to: "2026-09", granularity: "quarter" },
      reports: [],
      reimbursements: [reimbursement("r")],
      payroll: [pay("a")],
    });
    const business = getModule(data, "business");
    expect(business.summaries[0].amount).toBeNull();
    expect(business.breakdown[0].amount).toBeNull();
    expect(business.comparison[0].amount).toBeNull();
    const personnel = getModule(data, "personnel");
    expect(personnel.summaries[0].amount).toBeNull();
    expect(personnel.comparison[0].amount).toBe("1347");
    expect(personnel.comparison[0].note).toContain("已知部分");
    expect(personnel.breakdown.every((row) => row.amount === null)).toBe(true);
    expect(personnel.summaries[1].label).toContain("部分");
  });
  it("商务只按付款业务月份及范围统计，不含其他类型或银行费用", () => {
    const result = getModule(
      input({
        reports: [],
        reimbursements: [
          reimbursement("business", {
            scopePath: "朝阳区 / 业务单位",
            region: "朝阳区",
            regionSource: "已核验完整范围父链",
          }),
          reimbursement("basic", { type: "basic", amount: "100" }),
          reimbursement("next", { date: "2026-09-01", amount: "999" }),
        ],
        scopeNames: { 朝阳区: "朝阳" },
      }),
      "business",
    );
    expect(result.summaries[0].amount).toBe("20");
    expect(result.breakdown[0].label).toBe("朝阳区 / 业务单位");
    expect(result.details[0].scope).toBe("朝阳区 / 业务单位");
    expect(result.details.map((row) => row.sourceId)).toEqual(["business"]);
  });
  it("薪资、公司社保、公积金和调整与原总成本完全相符", () => {
    const result = getModule(
      input({
        reports: [],
        payroll: [
          pay("a", "2026-08", { withheldActual: "600", netActual: "900" }),
        ],
        reimbursements: [reimbursement("r", { type: "basic", amount: "10" })],
        reimbursementDatesComplete: {
          basic: true,
          large: true,
          business: true,
        },
        overheadAllocations: [],
        overheadCandidates: [],
      }),
      "personnel",
    );
    expect(result.details).toHaveLength(1);
    const row = result.details[0];
    expect([
      row.salary,
      row.social,
      row.housing,
      row.adjustment,
      row.basic,
      row.total,
    ]).toEqual(["1000", "267", "60", "173", "10", "1510"]);
    expect(
      addFinancialAmounts(
        row.salary!,
        row.social!,
        row.housing!,
        row.adjustment!,
        row.basic!,
      ),
    ).toBe(row.total);
  });
  it("同名不同编号不合并，全年已离职人员保留", () => {
    const result = getModule(
      input({
        reports: [],
        payroll: [
          pay("a", "2026-01", { personName: "同名" }),
          pay("b", "2026-08", { personName: "同名" }),
        ],
        reimbursements: [],
        reimbursementDatesComplete: {
          basic: true,
          large: true,
          business: true,
        },
        overheadAllocations: [],
        overheadCandidates: [],
      }),
      "personnel",
    );
    expect(result.details.map((row) => row.personId).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(
      result.details.find((row) => row.personId === "a")?.annualTotal,
    ).toBe("1327");
    expect(result.details.find((row) => row.personId === "a")?.total).toBe("0");
  });
  it("无法核对实时工资分项时保留已月结总额，分项未知", () => {
    const baseline = report();
    baseline.automaticDetails = [
      {
        sourceType: "payroll",
        sourceId: "old",
        occurredOn: "2026-08-01",
        accountCode: "general",
        metric: "human_cost",
        amount: "1500",
        description: "工资",
        personId: "a",
        personName: "员工a",
      },
    ];
    const result = getModule(
      input({
        reports: [baseline],
        payroll: [pay("a", "2026-08", { id: "old" })],
      }),
      "personnel",
    );
    expect(result.details[0].salary).toBeNull();
    expect(result.details[0].total).toBe("1500");
  });
  it("八月七人、九月六人分别分摊并精确汇总季度", () => {
    const payroll = [
      ...Array.from({ length: 7 }, (_, n) => pay(String(n), "2026-08")),
      ...Array.from({ length: 6 }, (_, n) => pay(String(n), "2026-09")),
    ];
    const result = getModule(
      input({
        query: { from: "2026-08", to: "2026-09", granularity: "quarter" },
        reports: [],
        payroll,
        overheadCandidates: [],
        overheadAllocations: [
          overhead({ id: "aug" }),
          overhead({
            id: "sep",
            paymentId: "sep-payment",
            invoiceId: "sep-invoice",
            date: "2026-09-02",
            amount: "120",
            paymentAmount: "120",
            invoiceAmount: "120",
            lines: [
              {
                id: "sep-rent",
                category: "rent",
                amount: "120",
                verified: true,
              },
            ],
          }),
        ],
      }),
      "personnel",
    );
    expect(result.details).toHaveLength(7);
    expect(
      addFinancialAmounts(...result.details.map((row) => row.overhead!)),
    ).toBe("220");
    expect(result.details.find((row) => row.personId === "6")?.overhead).toBe(
      "14.28",
    );
    expect(result.details.find((row) => row.personId === "0")?.overhead).toBe(
      "34.29",
    );
  });
  it("混合发票全部明细参与付款分配，仅租金进入人员分摊", () => {
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
    const result = getModule(
      input({
        reports: [],
        payroll: [pay("a")],
        overheadAllocations: [
          overhead({ lines, amount: "50", paymentAmount: "50" }),
        ],
        overheadCandidates: [],
      }),
      "personnel",
    );
    expect(result.details[0].overhead).toBe("10");
  });
  it("无工资名单不除零、不向当前员工分摊", () => {
    const result = getModule(
      input({ reports: [], overheadAllocations: [overhead()] }),
      "personnel",
    );
    expect(result.details[0].overhead).toBe("100");
    expect(result.details[0].total).toBeNull();
    expect(result.warnings.join()).toContain("没有当月有效工资名单");
  });
  it("费用分类未核验或分配超额时不伪造公共费用", () => {
    const result = getModule(
      input({
        reports: [],
        payroll: [pay("a")],
        overheadAllocations: [overhead({ amount: "101" })],
      }),
      "personnel",
    );
    expect(result.details[0].overhead).toBeNull();
    expect(result.details[0].total).toBeNull();
    expect(result.warnings.join()).toContain("超过");
  });
});

describe("来源加载的只读事务约束", () => {
  it("全部查询复用传入连接，完整年度读取且不写入数据库", async () => {
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM monthly_financial_reports"))
          return { rows: [{ month: "2026-01" }, { month: "2026-08" }] };
        if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
        return { rows: [] };
      }),
    };
    const loadReport = jest.fn(async (month: string, passedClient: unknown) => {
      expect(passedClient).toBe(client);
      return report(month);
    });
    const data = await loadMonthlyFinancialAnalysis(
      { from: "2026-08", to: "2026-08", granularity: "month" },
      { queryClient: client as never, loadReport, now: new Date(time) },
    );
    expect(loadReport).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls[0][1]).toEqual(["2026-01", "2026-12"]);
    expect(queries.every((sql) => /^\s*SELECT/.test(sql))).toBe(true);
    expect(queries.join(" ")).not.toMatch(/employment_status\s*=/);
    expect(data.generatedAt).toBe(time);
    expect(
      data.modules[0].details.every((row) => row.month === "2026-08"),
    ).toBe(true);
  });
});
