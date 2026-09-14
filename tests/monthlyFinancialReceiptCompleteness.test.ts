import {
  buildMonthlyFinancialAnalysis,
  type AnalysisContract,
  type AnalysisReceipt,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";

const generatedAt = "2026-09-04T02:00:00.000Z";
function contract(id = "project"): AnalysisContract {
  return {
    id,
    rootId: id,
    relationType: "main",
    title: `测试项目${id}`,
    partyA: id,
    region: "测试区",
    status: "effective",
    effectiveAt: "2025-01-01",
    contractDate: "2025-01-01",
    contractDateSource: "manual",
    originalAmount: "1000",
    amountDelta: "1000",
    amountBefore: null,
    amountAfter: null,
    supplementSequence: null,
    changeType: null,
    updatedAt: generatedAt,
  };
}
function receipt(
  id: string,
  overrides: Partial<AnalysisReceipt> = {},
): AnalysisReceipt {
  return {
    id,
    rootId: "project",
    date: "2026-02-10",
    amount: "0.1",
    currency: "CNY",
    status: "confirmed",
    reversedAt: null,
    updatedAt: generatedAt,
    ...overrides,
  };
}
function input(
  overrides: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2026-01", to: "2026-03", granularity: "month" },
    generatedAt,
    reports: [],
    contracts: [contract()],
    receipts: [],
    ...overrides,
  };
}
function report(
  status: FinancialAnalysisReport["status"] = "closed",
): FinancialAnalysisReport {
  return {
    month: "2026-02",
    status,
    generatedAt,
    savedAt: generatedAt,
    closedAt: status === "closed" ? generatedAt : null,
    income: { mainReceipt: "0.1", generalInterest: "0" },
    accounts: [],
    manualItems: [],
    automaticDetails: [
      {
        sourceId: "old",
        sourceType: "contract_receipt",
        metric: "main_receipt",
        occurredOn: "2026-02-10",
        amount: "0.1",
        description: "原回款",
        accountCode: "general",
      },
    ],
  };
}
function moduleOf(source: MonthlyFinancialAnalysisInput, key: string) {
  return buildMonthlyFinancialAnalysis(source).modules.find(
    (row) => row.key === key,
  )!;
}
function values(
  source: MonthlyFinancialAnalysisInput,
  moduleKey: string,
  seriesKey: string,
) {
  return moduleOf(source, moduleKey).series.find(
    (row) => row.key === seriesKey,
  )!.values;
}

describe("主营回款来源完整性与真实零", () => {
  it("完整回款来源无需保存月报，空月为零，已知小数精确聚合且利息仍未知", () => {
    const source = input({
      receipts: [receipt("one"), receipt("two", { amount: "0.200000000001" })],
    });
    expect(values(source, "inflow", "receipt")).toEqual([
      "0",
      "0.300000000001",
      "0",
    ]);
    expect(values(source, "inflow", "interest")).toEqual([null, null, null]);
    expect(values(source, "projects", "periodReceived")).toEqual([
      "0",
      "0.300000000001",
      "0",
    ]);
    expect(values(source, "projects", "received")).toEqual([
      "0",
      "0.300000000001",
      "0.300000000001",
    ]);
    for (const granularity of ["quarter", "year"] as const) {
      const aggregated = { ...source, query: { ...source.query, granularity } };
      expect(values(aggregated, "inflow", "receipt")).toEqual([
        "0.300000000001",
      ]);
      expect(values(aggregated, "projects", "periodReceived")).toEqual([
        "0.300000000001",
      ]);
    }
  });

  it("未提供回款来源不等于完整查询空数组，不补零", () => {
    const source = input({ receipts: undefined });
    expect(values(source, "inflow", "receipt")).toEqual([null, null, null]);
    expect(values(source, "projects", "received")).toEqual([null, null, null]);
    expect(values(source, "projects", "periodReceived")).toEqual([
      null,
      null,
      null,
    ]);
    expect(moduleOf(source, "inflow").warnings.join()).toContain(
      "未提供完整回款来源",
    );
    expect(values(input(), "inflow", "receipt")).toEqual(["0", "0", "0"]);
  });

  it.each([null, "", " ", "USD"])(
    "同月含币种%j时三类回款均保留未知，不能把人民币片段当总额",
    (currency) => {
      const source = input({
        receipts: [receipt("known"), receipt("unknown", { currency })],
      });
      expect(values(source, "inflow", "receipt")).toEqual(["0", null, "0"]);
      expect(values(source, "projects", "periodReceived")).toEqual([
        "0",
        null,
        "0",
      ]);
      expect(values(source, "projects", "received")).toEqual(["0", null, null]);
      expect(values(source, "projects", "outstanding")).toEqual([
        "1000",
        null,
        null,
      ]);
      expect(moduleOf(source, "inflow").warnings.join()).toContain(
        "币种缺失或非人民币",
      );
      expect(moduleOf(source, "projects").warnings.join()).toContain(
        "币种缺失或非人民币",
      );
      expect(
        moduleOf(source, "inflow").details.map((row) => row.amount),
      ).toEqual(["0.1"]);
    },
  );

  it.each(["", "日期缺失", "2026-02-30", "2026-02-10T00:00:00Z"])(
    "坏业务日期%s不会被累计静默丢弃，也不会补成空月零",
    (date) => {
      const source = input({
        receipts: [receipt("known"), receipt("bad", { date })],
      });
      for (const [moduleKey, seriesKey] of [
        ["inflow", "receipt"],
        ["projects", "received"],
        ["projects", "periodReceived"],
      ])
        expect(values(source, moduleKey, seriesKey)).toEqual([
          null,
          null,
          null,
        ]);
      expect(moduleOf(source, "inflow").warnings.join()).toContain(
        "业务日期缺失或无效",
      );
      expect(moduleOf(source, "projects").warnings.join()).toContain(
        "业务日期缺失或无效",
      );
    },
  );

  it.each([
    "id",
    "electronicReceiptNo",
    "transactionSerialNo",
    "proofNo",
  ] as const)("重复%s统一阻止重复计款，不会只让项目未知而入账多算", (key) => {
    const first = receipt("one", { bankName: "测试 银行", [key]: "A-001" });
    const second = receipt("two", {
      bankName: "测试银行",
      [key]: key === "id" ? "A-001" : "a001",
    });
    const source = input({ receipts: [first, second, receipt("known")] });
    expect(values(source, "inflow", "receipt")).toEqual(["0", null, "0"]);
    expect(values(source, "projects", "periodReceived")).toEqual([
      "0",
      null,
      "0",
    ]);
    expect(values(source, "projects", "received")).toEqual(["0", null, null]);
    expect(moduleOf(source, "inflow").warnings.join()).toContain("证据重复");
  });

  it("旧proof号只是自身流水号别名时不跨种类错误判重", () => {
    const source = input({
      receipts: [
        receipt("one", {
          bankName: "测试银行",
          transactionSerialNo: "001",
          proofNo: "001",
        }),
        receipt("two", {
          bankName: "测试银行",
          transactionSerialNo: "002",
          proofNo: "001",
        }),
      ],
    });
    expect(values(source, "inflow", "receipt")).toEqual(["0", "0.2", "0"]);
    expect(values(source, "projects", "periodReceived")).toEqual([
      "0",
      "0.2",
      "0",
    ]);
  });

  it("空来源编号同样不能作为可核验金额", () => {
    const source = input({ receipts: [receipt("")] });
    expect(values(source, "inflow", "receipt")).toEqual(["0", null, "0"]);
    expect(values(source, "projects", "received")).toEqual(["0", null, null]);
    expect(values(source, "projects", "periodReceived")).toEqual([
      "0",
      null,
      "0",
    ]);
  });

  it("当前已冲正回款不计当期流量，缺冲正日期时历史累计仍未知", () => {
    const source = input({
      receipts: [receipt("reversed", { status: "reversed", reversedAt: null })],
    });
    expect(values(source, "inflow", "receipt")).toEqual(["0", "0", "0"]);
    expect(values(source, "projects", "periodReceived")).toEqual([
      "0",
      "0",
      "0",
    ]);
    expect(values(source, "projects", "received")).toEqual(["0", null, null]);
    expect(moduleOf(source, "projects").warnings.join()).toContain(
      "缺少可靠冲正业务日期",
    );
  });

  it.each(["draft", "pending_review", "reopened", "closed"] as const)(
    "%s月报与同源业务不重复相加",
    (status) => {
      const source = input({
        reports: [report(status)],
        receipts: [receipt("old")],
      });
      expect(values(source, "inflow", "receipt")).toEqual(["0", "0.1", "0"]);
      expect(
        moduleOf(source, "inflow").details.filter(
          (row) => row.sourceId === "old",
        ),
      ).toHaveLength(1);
    },
  );

  it("旧月结不被后来新增坏日期、空币种或重复凭证污染，开放月仍需诊断新异常", () => {
    const rows = [
      receipt("old", { bankName: "测试银行", electronicReceiptNo: "SAME" }),
      receipt("new", {
        date: "",
        currency: null,
        bankName: "测试银行",
        electronicReceiptNo: "SAME",
      }),
    ];
    expect(
      values(
        input({ reports: [report()], receipts: rows }),
        "inflow",
        "receipt",
      ),
    ).toEqual([null, "0.1", null]);
    expect(
      values(
        input({ reports: [report("draft")], receipts: rows }),
        "inflow",
        "receipt",
      ),
    ).toEqual([null, null, null]);
  });

  it("开放月引用的空币种不能默认人民币，保留原金额说明但汇总与该明细金额未知", () => {
    const baseline = report("draft");
    const source = input({
      reports: [baseline],
      receipts: [receipt("old", { currency: null })],
    });
    const result = moduleOf(source, "inflow");
    expect(result.series[0].values).toEqual(["0", null, "0"]);
    expect(result.details[0].amount).toBeNull();
    expect(result.details[0].sourceState).toContain("原币未标注金额0.1");
    expect(baseline.income.mainReceipt).toBe("0.1");
    expect(baseline.automaticDetails[0].amount).toBe("0.1");
  });

  it.each([
    { date: "" },
    { date: "2026-01-15" },
    { currency: null },
    { currency: "USD" },
    { amount: "999.123456789012" },
  ])("同一来源后来变更%j不改写已月结日期、币种口径或金额", (changes) => {
    const baseline = report();
    const before = JSON.stringify(baseline);
    const result = moduleOf(
      input({
        query: { from: "2026-02", to: "2026-02", granularity: "month" },
        reports: [baseline],
        receipts: [receipt("old", changes)],
      }),
      "inflow",
    );
    expect(result.series[0].values).toEqual(["0.1"]);
    expect(result.details[0].date).toBe("2026-02-10");
    expect(result.details[0].amount).toBe("0.1");
    expect(result.warnings).toEqual([]);
    expect(JSON.stringify(baseline)).toBe(before);
  });

  it.each([undefined, []] as Array<AnalysisReceipt[] | undefined>)(
    "实时来源为%j仍保留已月结自身金额，不补造实时币种证据",
    (receipts) => {
      const result = moduleOf(
        input({
          query: { from: "2026-02", to: "2026-02", granularity: "month" },
          reports: [report()],
          receipts,
        }),
        "inflow",
      );
      expect(result.series[0].values).toEqual(["0.1"]);
      expect(result.details[0].amount).toBe("0.1");
      expect(result.warnings).toEqual([]);
    },
  );

  it.each(["", "2026-02-30", "2026-01-15"])(
    "冻结日期自身为%s时必须阻断，不用实时正确日期代替",
    (occurredOn) => {
      const baseline = report();
      baseline.automaticDetails[0].occurredOn = occurredOn;
      const result = moduleOf(
        input({ reports: [baseline], receipts: [receipt("old")] }),
        "inflow",
      );
      expect(result.series[0].values).toEqual(["0", null, "0"]);
      expect(result.details[0].amount).toBeNull();
      expect(result.warnings.join()).toContain("快照的业务日期");
      expect(baseline.automaticDetails[0].occurredOn).toBe(occurredOn);
    },
  );

  it("冻结明细重复来源编号时仍未知，不用当前单条记录替代或任意去重", () => {
    const baseline = report();
    baseline.automaticDetails.push({ ...baseline.automaticDetails[0] });
    baseline.income.mainReceipt = "0.2";
    const result = moduleOf(
      input({ reports: [baseline], receipts: [receipt("old")] }),
      "inflow",
    );
    expect(result.series[0].values).toEqual(["0", null, "0"]);
    expect(result.details.every((row) => row.amount === null)).toBe(true);
    expect(result.warnings.join()).toContain("快照存在重复来源编号");
  });

  it("冻结汇总与明细不闭合沿用差额核对边界，筛选时不伪造缺失维度", () => {
    const baseline = report();
    baseline.income.mainReceipt = "0.3";
    const source = input({ reports: [baseline], receipts: [receipt("old")] });
    const result = moduleOf(source, "inflow");
    expect(result.series[0].values).toEqual(["0", "0.3", "0"]);
    expect(
      result.details.find((row) => row.name?.includes("差额"))?.amount,
    ).toBe("0.2");
    expect(result.warnings.join()).toContain("汇总与可追溯明细存在差额");
    const filtered = moduleOf(
      { ...source, query: { ...source.query, partyA: "project" } },
      "inflow",
    );
    expect(filtered.series[0].values).toEqual(["0", null, "0"]);
    expect(baseline.income.mainReceipt).toBe("0.3");
  });

  it("来源缺失标记优先于空数组，正常empty状态不把已核算零值变未知", () => {
    const missing = report();
    missing.sources = [{ key: "contract_receipts", status: "missing" }];
    expect(values(input({ reports: [missing] }), "inflow", "receipt")).toEqual([
      "0",
      null,
      "0",
    ]);
    const empty = {
      ...report(),
      income: { mainReceipt: "0", generalInterest: "0" },
      automaticDetails: [],
      sources: [{ key: "contract_receipts", status: "empty" }],
    };
    expect(values(input({ reports: [empty] }), "inflow", "receipt")).toEqual([
      "0",
      "0",
      "0",
    ]);
  });

  it("来源已核实的范围外异常不污染所选项目的真实零", () => {
    const source = input({
      query: {
        from: "2026-01",
        to: "2026-03",
        granularity: "month",
        partyA: "project",
      },
      contracts: [contract(), contract("other")],
      receipts: [
        receipt("other", { rootId: "other", date: "", currency: null }),
      ],
    });
    expect(values(source, "inflow", "receipt")).toEqual(["0", "0", "0"]);
    expect(values(source, "projects", "periodReceived")).toEqual([
      "0",
      "0",
      "0",
    ]);
  });

  it("未来月不能因完整空来源变零，同期也使用自身年度的真实零与精确金额", () => {
    const future = input({
      query: { from: "2026-09", to: "2026-10", granularity: "month" },
    });
    expect(values(future, "inflow", "receipt")).toEqual(["0", null]);
    const compared = buildMonthlyFinancialAnalysis(
      input({
        query: {
          from: "2026-01",
          to: "2026-03",
          granularity: "month",
          comparisonYear: 2025,
        },
        receipts: [
          receipt("last", { date: "2025-02-10", amount: "0.100000000001" }),
        ],
      }),
    );
    expect(
      compared.modules.find((row) => row.key === "inflow")!.series[0].values,
    ).toEqual(["0", "0", "0"]);
    expect(
      compared.comparison!.modules.find((row) => row.key === "inflow")!
        .series[0].values,
    ).toEqual(["0", "0.100000000001", "0"]);
  });
});
