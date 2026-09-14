/** @jest-environment node */
import {
  buildMonthlyFinancialAnalysis,
  loadMonthlyFinancialAnalysis,
  type AnalysisContract,
  type AnalysisReceipt,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { addFinancialAmounts } from "../server/services/monthlyFinancialReport";
import type { FinancialAnalysisQuery } from "../server/types/monthly-financial-analysis";

const generatedAt = "2026-09-02T01:00:00Z";
function contract(overrides: Partial<AnalysisContract> = {}): AnalysisContract {
  return {
    id: "root",
    rootId: "root",
    relationType: "main",
    title: "项目名称中的朝阳区不作为行政区来源",
    partyA: "甲方甲",
    region: "海淀区",
    status: "effective",
    effectiveAt: "2024-01-01",
    contractDate: "2024-01-01",
    contractDateSource: "manual",
    originalAmount: "1000",
    amountDelta: "1000",
    amountBefore: null,
    amountAfter: null,
    supplementSequence: null,
    changeType: null,
    updatedAt: "2026-01-01",
    ...overrides,
  };
}
function receipt(
  id: string,
  date: string,
  amount: string,
  overrides: Partial<AnalysisReceipt> = {},
): AnalysisReceipt {
  return {
    id,
    date,
    amount,
    rootId: "root",
    currency: "CNY",
    status: "confirmed",
    reversedAt: null,
    updatedAt: generatedAt,
    ...overrides,
  };
}
function source(
  overrides: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2025-01", to: "2025-06", granularity: "month" },
    generatedAt,
    contracts: [contract()],
    reports: [],
    receipts: [],
    ...overrides,
  };
}
function project(input: MonthlyFinancialAnalysisInput) {
  return buildMonthlyFinancialAnalysis(input).modules.find(
    (row) => row.key === "projects",
  )!;
}
function amounts(input: MonthlyFinancialAnalysisInput) {
  return project(input).series.find((row) => row.key === "periodReceived")!
    .values;
}
function frozenReport(): FinancialAnalysisReport {
  return {
    month: "2025-01",
    status: "closed",
    generatedAt: "2025-02-01",
    savedAt: "2025-02-01",
    closedAt: "2025-02-01",
    accounts: ["general", "business", "welfare_one", "welfare_two"].map(
      (code) => ({
        code,
        name: code,
        opening: "0",
        inflow: code === "general" ? "20" : "0",
        outflow: "0",
        closing: code === "general" ? "20" : "0",
      }),
    ),
    income: { mainReceipt: "20", generalInterest: "0" },
    automaticDetails: [
      {
        sourceType: "contract_receipt",
        sourceId: "reversed",
        occurredOn: "2025-01-10",
        accountCode: "general",
        metric: "main_receipt",
        amount: "20",
        description: "当时已确认回款",
      },
    ],
    manualItems: [],
  };
}

describe("项目期间实际回款直接归期且精确可加", () => {
  const receipts = [
    receipt("jan", "2025-01-15", "0.100000000001"),
    receipt("feb", "2025-02-20", "0.2"),
    receipt("may", "2025-05-10", "0.3"),
    receipt("jun", "2025-06-30", "5.4"),
  ];
  it.each(["month", "quarter", "year"] as const)(
    "%s逐项目明细、趋势和整个查询摘要闭合，原累计仍为期末存量",
    (granularity) => {
      const input = source({
        query: { from: "2025-01", to: "2025-06", granularity },
        receipts,
      });
      const data = buildMonthlyFinancialAnalysis(input);
      const result = data.modules.find((row) => row.key === "projects")!;
      const values = result.series.find(
        (row) => row.key === "periodReceived",
      )!.values;
      const expected =
        granularity === "month"
          ? ["0.100000000001", "0.2", "0", "0", "0.3", "5.4"]
          : granularity === "quarter"
            ? ["0.300000000001", "5.7"]
            : ["6.000000000001"];
      expect(values).toEqual(expected);
      expect(
        result.summaries.find((row) => row.key === "periodReceived")?.amount,
      ).toBe("6.000000000001");
      expect(
        result.summaries.find((row) => row.key === "received")?.amount,
      ).toBe("6.000000000001");
      expect(
        result.series.find((row) => row.key === "periodReceived")?.label,
      ).toBe(
        { month: "本月回款", quarter: "本季回款", year: "本年回款" }[
          granularity
        ],
      );
      const inflow = data.modules
        .find((row) => row.key === "inflow")!
        .series.find((row) => row.key === "receipt")!.values;
      inflow.forEach((amount, index) => {
        if (amount !== null) expect(amount).toBe(values[index]);
      });
      for (const [index, period] of result.periods.entries()) {
        const details = result.details.filter(
          (row) => row.periodKey === period.key,
        );
        expect(
          addFinancialAmounts(...details.map((row) => row.periodReceived!)),
        ).toBe(values[index]);
        expect(
          details.every(
            (row) =>
              row.from === period.from &&
              row.to === period.to &&
              row.region === "海淀区",
          ),
        ).toBe(true);
        expect(details[0].periodReceivedSourceState).toContain(
          "当前已确认未冲正",
        );
      }
    },
  );

  it.each(["quarter", "year"] as const)(
    "%s不把所选起始月之前或结束月之后的回款混入部分期间",
    (granularity) => {
      const result = project(
        source({
          query: { from: "2025-11", to: "2026-02", granularity },
          receipts: [
            receipt("before", "2025-10-01", "100"),
            receipt("nov", "2025-11-01", "5"),
            receipt("dec", "2025-12-01", "6"),
            receipt("jan", "2026-01-01", "7"),
            receipt("feb", "2026-02-01", "8"),
            receipt("after", "2026-03-01", "9"),
          ],
        }),
      );
      expect(
        result.series.find((row) => row.key === "periodReceived")?.values,
      ).toEqual(["11", "15"]);
      expect(
        result.series.find((row) => row.key === "received")?.values,
      ).toEqual(["111", "126"]);
      expect(
        result.summaries.find((row) => row.key === "periodReceived")?.amount,
      ).toBe("26");
      expect(result.details.map((row) => row.periodReceivedSourceIds)).toEqual([
        "dec、nov",
        "feb、jan",
      ]);
    },
  );

  it("本期和往年期各自保留同范围实际回款，不合并金额或改变源对象", () => {
    const input = source({
      query: {
        from: "2026-01",
        to: "2026-03",
        granularity: "quarter",
        comparisonYear: 2025,
      },
      receipts: [
        receipt("previous", "2025-02-01", "100.1"),
        receipt("current-first", "2026-01-02", "200.2"),
        receipt("current-last", "2026-03-03", "300.3"),
      ],
    });
    const before = JSON.stringify(input);
    const data = buildMonthlyFinancialAnalysis(input);
    const current = data.modules.find((row) => row.key === "projects")!;
    const previous = data.comparison!.modules.find(
      (row) => row.key === "projects",
    )!;
    expect(
      current.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual(["500.5"]);
    expect(
      previous.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual(["100.1"]);
    expect(
      current.summaries.find((row) => row.key === "periodReceived")?.amount,
    ).toBe("500.5");
    expect(
      previous.summaries.find((row) => row.key === "periodReceived")?.amount,
    ).toBe("100.1");
    expect(current.details[0].periodReceivedSourceIds).not.toContain(
      "previous",
    );
    expect(previous.details[0].periodReceivedSourceIds).toBe("previous");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("项目更新时间纳入真实回款更新时间，历史期间不借查询时钟改变内容", () => {
    const input = source({
      receipts: [
        receipt("updated", "2025-01-15", "10", {
          updatedAt: "2026-08-20T10:00:00+08:00",
        }),
      ],
    });
    const first = project(input);
    expect(first.updatedAt).toBe("2026-08-20T02:00:00.000Z");
    expect(project({ ...input, generatedAt: "2026-09-03T01:00:00Z" })).toEqual(
      first,
    );
  });

  it("只统计同甲方及根行政区，范围外外币不污染所选项目", () => {
    const result = project(
      source({
        query: {
          from: "2025-01",
          to: "2025-01",
          granularity: "month",
          partyA: "甲方甲",
          contractRegion: "海淀区",
        },
        contracts: [
          contract(),
          contract({
            id: "other",
            rootId: "other",
            partyA: "甲方乙",
            region: "朝阳区",
          }),
        ],
        receipts: [
          receipt("selected", "2025-01-10", "10"),
          receipt("excluded", "2025-01-10", "200", {
            rootId: "other",
            currency: "USD",
          }),
        ],
      }),
    );
    expect(
      result.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual(["10"]);
    expect(result.details).toHaveLength(1);
    expect(result.details[0].region).toBe("海淀区");
  });
});

describe("期间流量与原历史累计、冻结快照的边界", () => {
  it("后来冲正的回款不再进入当前流量，月季年保持可加而原历史累计不变", () => {
    const receipts = [
      receipt("reversed", "2025-01-10", "20", {
        status: "reversed",
        reversedAt: "2025-02-01T00:00:00+08:00",
      }),
      receipt("valid", "2025-03-01", "30"),
    ];
    const month = project(
      source({
        query: { from: "2025-01", to: "2025-03", granularity: "month" },
        receipts,
      }),
    );
    expect(month.series.find((row) => row.key === "received")?.values).toEqual([
      "20",
      "0",
      "30",
    ]);
    expect(
      month.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual(["0", "0", "30"]);
    for (const granularity of ["quarter", "year"] as const)
      expect(
        amounts(
          source({
            query: { from: "2025-01", to: "2025-03", granularity },
            receipts,
          }),
        ),
      ).toEqual(["30"]);
    const snapshot = frozenReport();
    const before = JSON.stringify(snapshot);
    const frozen = buildMonthlyFinancialAnalysis(
      source({
        query: { from: "2025-01", to: "2025-01", granularity: "month" },
        reports: [snapshot],
        receipts,
      }),
    );
    expect(
      frozen.modules.find((row) => row.key === "inflow")?.series[0].values,
    ).toEqual(["20"]);
    expect(
      frozen.modules
        .find((row) => row.key === "projects")
        ?.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual(["0"]);
    expect(
      frozen.modules.find((row) => row.key === "projects")?.sourceLabel,
    ).toContain("已月结入账快照可能不同");
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it.each(["completed", "terminated"])(
    "合同%s仍保留真实尾款，不以合同状态裁掉付款",
    (status) => {
      const result = project(
        source({
          query: { from: "2026-08", to: "2026-08", granularity: "month" },
          contracts: [contract({ status })],
          receipts: [receipt("tail", "2026-08-15", "120")],
        }),
      );
      expect(
        result.series.find((row) => row.key === "periodReceived")?.values,
      ).toEqual(["120"]);
    },
  );

  it("签订前预收增加仅流量明细，旧合同、累计与未回款三序列不被新行改变", () => {
    const input = source({
      query: { from: "2026-08", to: "2026-08", granularity: "month" },
      contracts: [contract({ contractDate: "2026-09-01" })],
      receipts: [receipt("advance", "2026-08-10", "100")],
    });
    const result = project(input);
    expect(
      result.series
        .filter(
          (row) =>
            row.key !== "periodReceived" && row.key !== "signedContractCount",
        )
        .map((row) => row.values),
    ).toEqual([["0"], ["0"], ["0"]]);
    expect(
      result.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual(["100"]);
    expect(result.details[0]).toMatchObject({
      detailKind: "period_receipt_only",
      contract: null,
      received: null,
      outstanding: null,
      periodReceived: "100",
      sourceId: "root",
      region: "海淀区",
    });
    expect(result.details[0].periodReceivedSourceIds).toBe("advance");
  });

  it("缺合同签订日期只使原存量未知，不抹去业务日期与币种已核验的收款", () => {
    const result = project(
      source({
        query: { from: "2025-01", to: "2025-01", granularity: "month" },
        contracts: [contract({ contractDate: null, contractDateSource: null })],
        receipts: [receipt("actual", "2025-01-10", "100")],
      }),
    );
    expect(result.series[0].values).toEqual([null]);
    expect(
      result.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual(["100"]);
  });

  it.each(["draft", "rejected"])("合同根%s不进入可读取项目范围", (status) => {
    const result = project(
      source({
        contracts: [contract({ status })],
        receipts: [receipt("invalid-scope", "2025-01-01", "100")],
      }),
    );
    expect(result.details).toHaveLength(0);
    expect(
      result.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual(["0", "0", "0", "0", "0", "0"]);
  });
});

describe("期间回款零值、未知和重复证据", () => {
  it("无当前有效收款时为真实零；未来月份与包含未来的摘要仍未知", () => {
    expect(amounts(source())).toEqual(["0", "0", "0", "0", "0", "0"]);
    const result = project(
      source({
        query: { from: "2026-09", to: "2026-10", granularity: "month" },
        receipts: [
          receipt("today", "2026-09-02", "10"),
          receipt("tomorrow", "2026-09-03", "50"),
        ],
      }),
    );
    expect(
      result.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual(["10", null]);
    expect(
      result.summaries.find((row) => row.key === "periodReceived")?.amount,
    ).toBeNull();
    expect(result.details[0].periodReceivedSourceIds).toBe("today");
    expect(
      amounts(
        source({
          query: { from: "2026-07", to: "2026-09", granularity: "quarter" },
          receipts: [
            receipt("today", "2026-09-02", "10"),
            receipt("tomorrow", "2026-09-03", "50"),
          ],
        }),
      ),
    ).toEqual(["10"]);
  });

  it.each(["", "日期缺失", "2025-02-30", "2025-01-01T00:00:00Z"])(
    "无可靠业务日期%s不能在过滤后变成零",
    (date) => {
      const result = project(
        source({
          query: { from: "2025-01", to: "2025-03", granularity: "quarter" },
          receipts: [receipt("invalid-date", date, "100")],
        }),
      );
      expect(
        result.series.find((row) => row.key === "periodReceived")?.values,
      ).toEqual([null]);
      expect(result.details[0].periodReceivedSourceState).toContain(
        "业务日期缺失或无效",
      );
    },
  );

  it.each([null, "", "USD"])(
    "同期间存在币种%j时不把人民币片段当完整值",
    (currency) => {
      const result = project(
        source({
          query: { from: "2025-01", to: "2025-01", granularity: "month" },
          receipts: [
            receipt("known", "2025-01-01", "20"),
            receipt("unknown", "2025-01-01", "30", { currency }),
          ],
        }),
      );
      expect(
        result.series.find((row) => row.key === "periodReceived")?.values,
      ).toEqual([null]);
      expect(result.details[0].periodReceivedSourceState).toContain(
        "币种缺失或非人民币",
      );
    },
  );

  it("相同来源编号重复时保持未知，不将其两次相加或任意去掉一条", () => {
    const row = receipt("same", "2025-01-01", "20");
    const result = project(
      source({
        query: { from: "2025-01", to: "2025-01", granularity: "month" },
        receipts: [row, { ...row }],
      }),
    );
    expect(
      result.series.find((item) => item.key === "periodReceived")?.values,
    ).toEqual([null]);
    expect(result.details[0].periodReceivedSourceState).toContain("证据重复");
    expect(result.details[0].periodReceivedSourceIds).toBe("same");
  });

  it.each(["electronicReceiptNo", "transactionSerialNo"] as const)(
    "同银行%s规范化后重复的两笔凭证不重复计款",
    (field) => {
      const result = project(
        source({
          query: { from: "2025-01", to: "2025-01", granularity: "month" },
          receipts: [
            receipt("first", "2025-01-01", "20", {
              bankName: "某 银行",
              [field]: "ＡＢ－１２",
            }),
            receipt("second", "2025-01-01", "20", {
              bankName: "某银行",
              [field]: "ab12",
            }),
          ],
        }),
      );
      expect(
        result.series.find((row) => row.key === "periodReceived")?.values,
      ).toEqual([null]);
    },
  );

  it("不同银行或没有共同凭证编号时不根据同日同金额猜成重复", () => {
    const query: FinancialAnalysisQuery = {
      from: "2025-01",
      to: "2025-01",
      granularity: "month",
    };
    expect(
      amounts(
        source({
          query,
          receipts: [
            receipt("first", "2025-01-01", "20", {
              bankName: "银行一",
              electronicReceiptNo: "123",
            }),
            receipt("second", "2025-01-01", "20", {
              bankName: "银行二",
              electronicReceiptNo: "123",
            }),
          ],
        }),
      ),
    ).toEqual(["40"]);
    expect(
      amounts(
        source({
          query,
          receipts: [
            receipt("first", "2025-01-01", "20"),
            receipt("second", "2025-01-01", "20"),
          ],
        }),
      ),
    ).toEqual(["40"]);
  });

  it("已冲正或草稿的重复凭证不污染当前有效事实；范围外外币也不影响本期", () => {
    const base = { bankName: "银行", electronicReceiptNo: "123" };
    expect(
      amounts(
        source({
          query: { from: "2025-01", to: "2025-01", granularity: "month" },
          receipts: [
            receipt("valid", "2025-01-01", "20", base),
            receipt("old", "2025-01-01", "20", {
              ...base,
              status: "reversed",
              reversedAt: null,
            }),
            receipt("draft", "2025-01-01", "20", { ...base, status: "draft" }),
            receipt("next", "2025-02-01", "100", { currency: "USD" }),
          ],
        }),
      ),
    ).toEqual(["20"]);
  });
});

describe("项目实际回款来源加载保持异常候选和只读边界", () => {
  it("无效日期在来源查询中保留诊断，合同删除和草稿边界不放宽", async () => {
    const queries: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes("FROM contract_receipts receipt"))
          return { rows: [receipt("invalid", "日期未核实", "20")] };
        if (sql.includes("FROM contracts contract"))
          return { rows: [contract()] };
        if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
        return { rows: [] };
      }),
    };
    const data = await loadMonthlyFinancialAnalysis(
      { from: "2025-01", to: "2025-03", granularity: "quarter" },
      {
        queryClient: client as never,
        loadReport: async () => frozenReport(),
        now: new Date(generatedAt),
      },
    );
    const sql = queries.find((query) =>
      query.includes("FROM contract_receipts receipt"),
    )!;
    expect(sql).toContain("OR NOT COALESCE(monthly_financial_date_is_valid");
    expect(sql).toContain(
      'receipt.electronic_receipt_no AS "electronicReceiptNo"',
    );
    expect(sql).toContain("root.is_deleted = FALSE");
    expect(sql).toContain("root.status NOT IN ('draft', 'rejected')");
    expect(queries.every((query) => /^\s*SELECT/u.test(query))).toBe(true);
    expect(
      data.modules
        .find((row) => row.key === "projects")
        ?.series.find((row) => row.key === "periodReceived")?.values,
    ).toEqual([null]);
  });
});
