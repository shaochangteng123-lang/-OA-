import type {
  FinancialAnalysisModule,
  FinancialAnalysisProjectReceipt,
} from "@/types/monthlyFinancialAnalysis";
import {
  buildMonthlyOutflowStructure,
  buildPeriodOutflowStructure,
  buildProjectPeriodDetails,
  groupProjectDrilldownRows,
  sumDrilldownAmounts,
} from "@/utils/monthlyFinancialAnalysisDrilldown";

function moduleFixture(
  key: "outflow" | "projects" = "outflow",
): FinancialAnalysisModule {
  return {
    key,
    title: "合成测试模块",
    description: "合成口径",
    sourceLabel: "合成来源",
    updatedAt: null,
    periods: [
      { key: "2026-01", label: "2026年01月", from: "2026-01", to: "2026-01" },
      { key: "2026-02", label: "2026年02月", from: "2026-02", to: "2026-02" },
    ],
    series: [
      { key: "administration", label: "行政支出", values: ["0.1", "0"] },
      { key: "salary", label: "薪资支出", values: ["0.2", "0"] },
      { key: "other", label: "其他支出", values: ["0", "0"] },
      { key: "tax", label: "实际税费支出", values: [null, "0"] },
      { key: "business", label: "业务支出", values: ["-0.1", "0"] },
      { key: "asset", label: "资产类合同支出", values: ["0", "0"] },
      { key: "total", label: "一般账户总支出", values: ["2053235.4", "0"] },
    ],
    summaries: [{ key: "total", label: "总支出", amount: "2053235.4" }],
    breakdown: [
      { key: "administration", label: "行政支出", amount: "0.1" },
      { key: "total", label: "不得重复的总额", amount: "2053235.4" },
    ],
    comparison: [],
    columns: [],
    details: [],
    warnings: [],
    appliedFilters: [],
  };
}

describe("支出及项目纯前端期间取数", () => {
  it("单月六分类与权威总额独立，缺分类保持未知且不会重复 total", () => {
    const source = moduleFixture();
    const before = JSON.stringify(source);
    const result = buildMonthlyOutflowStructure(source, "2026-01");
    expect(result.items).toHaveLength(6);
    expect(result.items.map((item) => item.amount)).toEqual([
      "0.1",
      "0.2",
      "0",
      null,
      "-0.1",
      "0",
    ]);
    expect(result.total).toBe("2053235.4");
    expect(result.items.some((item) => item.key === "total")).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("缺少权威总额序列时即使所有分类已知也不相加猜总额", () => {
    const source = moduleFixture();
    source.series = source.series.filter((series) => series.key !== "total");
    expect(buildMonthlyOutflowStructure(source, "2026-02").total).toBeNull();
    expect(
      buildMonthlyOutflowStructure(source, "2026-02").items.every(
        (item) => item.amount === "0",
      ),
    ).toBe(true);
  });

  it("默认期间使用 breakdown 及 summaries.total，缺分类不从月序列补齐", () => {
    const result = buildMonthlyOutflowStructure(moduleFixture());
    expect(result.total).toBe("2053235.4");
    expect(result.items.map((item) => item.amount)).toEqual([
      "0.1",
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(result.scopeLabel).toContain("2026-01 至 2026-02");
  });

  it("无对应月份、非法月份及非支出模块返回未知，不回退到其他期间", () => {
    for (const month of ["2026-03", "1899-01", "2026-13", "2026-Q1"])
      expect(
        buildMonthlyOutflowStructure(moduleFixture(), month).items.every(
          (item) => item.amount === null,
        ),
      ).toBe(true);
    expect(
      buildMonthlyOutflowStructure(moduleFixture("projects"), "2026-01").total,
    ).toBeNull();
  });

  it("季度点选精确使用 periodKey，标注实际季度并不误称当月", () => {
    const source = moduleFixture();
    source.periods = [
      {
        key: "2026-Q1",
        label: "2026年第1季度",
        from: "2026-01",
        to: "2026-03",
      },
      {
        key: "2026-Q2",
        label: "2026年第2季度",
        from: "2026-04",
        to: "2026-06",
      },
    ];
    const options = {
      from: "2026-01",
      to: "2026-06",
      periodKey: "2026-Q2",
      comparison: true,
    };
    const result = buildPeriodOutflowStructure(source, options);
    expect(result.total).toBe("0");
    expect(result.month).toBeNull();
    expect(result.scopeLabel).toContain(
      "对比期 · 2026年第2季度（2026-04 至 2026-06）",
    );
    expect(result.scopeLabel).not.toContain("当月");
    expect(
      buildPeriodOutflowStructure(source, { ...options, periodKey: "不存在" })
        .total,
    ).toBeNull();
    expect(buildMonthlyOutflowStructure(source, "2026-03").total).toBeNull();
  });

  it("年度按精确范围选择并保留十八位整数及十二位小数", () => {
    const source = moduleFixture();
    source.periods = [
      { key: "2026", label: "2026年", from: "2026-01", to: "2026-12" },
    ];
    source.series.find((series) => series.key === "total")!.values = [
      "123456789012345678.123456789012",
    ];
    const result = buildPeriodOutflowStructure(source, {
      from: "2026-01",
      to: "2026-12",
    });
    expect(result.total).toBe("123456789012345678.123456789012");
    expect(result.scopeLabel).toContain("2026年（2026-01 至 2026-12）");
  });

  it("项目默认只选查询截止一期，累计回款不把前期叠加", () => {
    const source = projectFixture();
    const result = buildProjectPeriodDetails(source, {
      from: "2026-01",
      to: "2026-02",
    });
    expect(result.total).toBe("0.3");
    expect(result.rows.map((row) => row.id)).toEqual(["feb-a", "feb-b"]);
    expect(result.rows.map((row) => row.received)).toEqual(["0.1", "0.2"]);
    expect(result.note).toContain("不跨月份、季度或年度相加");
  });

  it("项目明确 periodKey 不存在时返回空与未知，不能回退截止期", () => {
    const source = projectFixture();
    const missing = buildProjectPeriodDetails(source, {
      from: "2026-01",
      to: "2026-02",
      periodKey: "2026-03",
    });
    expect(missing.rows).toEqual([]);
    expect(missing.total).toBeNull();
    const january = buildProjectPeriodDetails(source, {
      from: "2026-01",
      to: "2026-02",
      periodKey: "2026-01",
      comparison: true,
    });
    expect(january.total).toBe("100");
    expect(january.rows).toHaveLength(1);
    expect(january.scopeLabel).toContain("对比期");
  });

  it("项目支持明确定义的期间编号及范围，排除错误范围和无期间来源", () => {
    const source = projectFixture();
    source.details.push(
      {
        id: "explicit",
        periodKey: "2026-02",
        from: "2026-02",
        to: "2026-02",
        received: "0",
        sourceId: "zero",
        region: null,
      },
      {
        id: "wrong-range",
        periodKey: "2026-02",
        from: "2026-01",
        received: "999",
      },
      { id: "unscoped", received: "999" },
    );
    const result = buildProjectPeriodDetails(source, {
      from: "2026-02",
      to: "2026-02",
    });
    expect(result.rows.map((row) => row.id)).toEqual([
      "feb-a",
      "feb-b",
      "explicit",
    ]);
    expect(result.rows.at(-1)?.received).toBe("0");
  });

  it("地区小计精确求和、来源去重并保留未知行政区与零项目", () => {
    const rows = projectFixture().details.filter((row) =>
      row.id.startsWith("feb"),
    );
    const groups = groupProjectDrilldownRows([
      ...rows,
      { ...rows[0], id: "duplicate" },
      {
        id: "zero",
        sourceId: "zero",
        region: null,
        received: "0",
        contract: "0",
        outstanding: "0",
      },
    ]);
    expect(groups[0].received).toBe("0.3");
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].region).toBe("未标注行政区");
    expect(groups[1].received).toBe("0");
  });

  it("重复来源冲突保守未知且不修改输入，未知项目使区域小计未知", () => {
    const rows = [
      {
        id: "a",
        sourceId: "same",
        region: "海淀区",
        received: "1",
        contract: "2",
        outstanding: "1",
      },
      {
        id: "b",
        sourceId: "same",
        region: "海淀区",
        received: null,
        contract: "2.0",
        outstanding: "1",
      },
    ];
    const before = JSON.stringify(rows);
    const groups = groupProjectDrilldownRows(rows);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].received).toBeNull();
    expect(groups[0].contract).toBe("2");
    expect(groups[0].rows[0].sourceState).toContain("冲突");
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("精确合计保留大数和十二位小数，负值不取绝对值，未知不当零", () => {
    expect(
      sumDrilldownAmounts([
        "123456789012345678.123456789012",
        "0.000000000001",
        "-0.1",
      ]),
    ).toBe("123456789012345678.023456789013");
    expect(sumDrilldownAmounts(["0", null])).toBeNull();
    expect(sumDrilldownAmounts(["0.1", "0.2"])).toBe("0.3");
  });

  it("本月回款读取独立期间序列与明细，不用累计回款或其差额替代", () => {
    const source = projectFixture();
    source.series.push({
      key: "periodReceived",
      label: "本期回款",
      values: ["0.01", "0.05"],
    });
    source.details = source.details.map((row) => ({
      ...row,
      periodReceived:
        row.id === "feb-a" ? "0.02" : row.id === "feb-b" ? "0.03" : "0.01",
    }));
    const before = JSON.stringify(source);
    const result = buildProjectPeriodDetails(source, {
      from: "2026-02",
      to: "2026-02",
      metricKey: "periodReceived",
    });
    expect(result.total).toBe("0.05");
    expect(result.rows.map((row) => row.periodReceived)).toEqual([
      "0.02",
      "0.03",
    ]);
    expect(result.rows.map((row) => row.received)).toEqual(["0.1", "0.2"]);
    expect(result.scopeLabel).toContain("本月回款");
    expect(result.scopeLabel).not.toContain("期末");
    expect(result.note).toContain("不使用累计回款、合同金额或未回款推算");
    expect(
      buildProjectPeriodDetails(source, { from: "2026-02", to: "2026-02" })
        .total,
    ).toBe("0.3");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("本期模式没有期间序列时权威总额未知，即使累计与明细金额已知也不反推", () => {
    const source = projectFixture();
    source.details = source.details.map((row) => ({
      ...row,
      periodReceived: "0",
    }));
    const result = buildProjectPeriodDetails(source, {
      from: "2026-02",
      to: "2026-02",
      metricKey: "periodReceived",
    });
    expect(result.total).toBeNull();
    expect(result.rows.map((row) => row.periodReceived)).toEqual(["0", "0"]);
    source.series.push({
      key: "periodReceived",
      label: "本期回款",
      values: ["0", null],
    });
    expect(
      buildProjectPeriodDetails(source, {
        from: "2026-02",
        to: "2026-02",
        metricKey: "periodReceived",
      }).total,
    ).toBeNull();
  });

  it("本期模式按完整 from/to 或明确 key 精确匹配，不能把多个月范围偷换成末月", () => {
    const source = projectFixture();
    source.series.push({
      key: "periodReceived",
      label: "本期回款",
      values: ["1", "2"],
    });
    const missing = buildProjectPeriodDetails(source, {
      from: "2026-01",
      to: "2026-02",
      metricKey: "periodReceived",
    });
    expect(missing.rows).toEqual([]);
    expect(missing.total).toBeNull();
    const selected = buildProjectPeriodDetails(source, {
      from: "2026-01",
      to: "2026-02",
      periodKey: "2026-02",
      metricKey: "periodReceived",
    });
    expect(selected.total).toBe("2");
    expect(selected.rows).toHaveLength(2);
    expect(
      buildProjectPeriodDetails(source, {
        from: "2026-02",
        to: "2026-02",
        periodKey: "不存在",
        metricKey: "periodReceived",
      }).rows,
    ).toEqual([]);
  });

  it.each([
    { key: "2025-Q1", label: "2025年第1季度", from: "2025-01", to: "2025-03" },
    { key: "2025", label: "2025年", from: "2025-01", to: "2025-12" },
  ])(
    "本期季度与年度及同期都使用真实期间 $key，不冒充单月或期末累计",
    (period) => {
      const source = projectFixture();
      source.periods = [period];
      source.series = [
        { key: "received", label: "累计回款", values: ["500"] },
        { key: "periodReceived", label: "本期回款", values: ["0"] },
      ];
      source.details = [
        {
          id: "period-zero",
          sourceId: "project-zero",
          periodKey: period.key,
          from: period.from,
          to: period.to,
          periodReceived: "0",
          received: "500",
          project: "零回款项目",
        },
      ];
      const result = buildProjectPeriodDetails(source, {
        ...period,
        periodKey: period.key,
        comparison: true,
        metricKey: "periodReceived",
      });
      expect(result.total).toBe("0");
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].periodReceived).toBe("0");
      expect(result.scopeLabel).toContain("对比期 · " + period.label);
      expect(result.scopeLabel).toContain(period.from + " 至 " + period.to);
      expect(result.scopeLabel).toContain("本期回款");
      expect(result.scopeLabel).not.toMatch(/本月|期末/u);
    },
  );

  it("本期回款按来源去重、冲突留未知，大额小计使用精确字符串", () => {
    const amount = "123456789012345678.123456789012";
    const rows = [
      {
        id: "a",
        sourceId: "a",
        region: "海淀区",
        project: "同名项目",
        periodReceived: amount,
        received: "1",
      },
      {
        id: "a-duplicate",
        sourceId: "a",
        region: "海淀区",
        project: "同名项目",
        periodReceived: amount,
        received: "1",
      },
      {
        id: "b",
        sourceId: "b",
        region: "海淀区",
        project: "另一个项目",
        periodReceived: "0.000000000001",
        received: "1",
      },
      {
        id: "c",
        sourceId: "c",
        region: "朝阳区",
        project: "同名项目",
        periodReceived: "0",
        received: "500",
      },
    ];
    const groups = groupProjectDrilldownRows(rows);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].periodReceived).toBe("123456789012345678.123456789013");
    expect(groups[0].received).toBe("2");
    expect(groups[1].rows[0].project).toBe("同名项目");
    expect(groups[1].periodReceived).toBe("0");
    const conflict = groupProjectDrilldownRows([
      ...rows,
      { ...rows[0], id: "conflict", periodReceived: "2" },
    ]);
    expect(conflict[0].periodReceived).toBeNull();
    expect(conflict[0].rows[0].periodReceived).toBeNull();
    expect(conflict[0].rows[0].sourceState).toContain("冲突");
  });

  it("仅期间流量行供本期模式使用，旧累计下钻排除并保持原小计", () => {
    const source = projectFixture();
    source.series.push({
      key: "periodReceived",
      label: "本期回款",
      values: ["0", "0.6"],
    });
    source.details = source.details.map((row) => ({
      ...row,
      detailKind: "project_period",
      periodReceived: "0.1",
    }));
    source.details.push({
      id: "flow-only",
      sourceId: "advance-payment",
      periodKey: "2026-02",
      from: "2026-02",
      to: "2026-02",
      detailKind: "period_receipt_only",
      received: null,
      contract: null,
      outstanding: null,
      periodReceived: "0.4",
      region: "海淀区",
      project: "合法预收或终止尾款",
      periodReceivedSourceState: "当前已确认未冲正回款，按业务日期归期",
      periodReceivedSourceIds: "receipt-a、receipt-b",
    });
    const cumulative = buildProjectPeriodDetails(source, {
      from: "2026-02",
      to: "2026-02",
    });
    expect(cumulative.rows).toHaveLength(2);
    expect(groupProjectDrilldownRows(cumulative.rows)[0].received).toBe("0.3");
    const period = buildProjectPeriodDetails(source, {
      from: "2026-02",
      to: "2026-02",
      metricKey: "periodReceived",
    });
    expect(period.rows).toHaveLength(3);
    expect(period.total).toBe("0.6");
    expect(groupProjectDrilldownRows(period.rows)[0].periodReceived).toBe(
      "0.6",
    );
    expect(period.rows.at(-1)?.periodReceivedSourceIds).toBe(
      "receipt-a、receipt-b",
    );
    expect(period.note).toContain("可能与历史冻结入账不同");
  });

  it("重复项目保留独立期间来源说明与去重凭证编号，金额冲突可追溯", () => {
    const rows = [
      {
        id: "a",
        sourceId: "same",
        region: "海淀区",
        periodReceived: "1",
        periodReceivedSourceState: "本期已确认回款",
        periodReceivedSourceIds: "receipt-a、receipt-b",
      },
      {
        id: "b",
        sourceId: "same",
        region: "海淀区",
        periodReceived: "2",
        periodReceivedSourceState: "本期已确认回款",
        periodReceivedSourceIds: "receipt-b、receipt-c",
      },
    ];
    const original = JSON.stringify(rows);
    const groups = groupProjectDrilldownRows(rows);
    expect(groups[0].periodReceived).toBeNull();
    expect(groups[0].rows[0].periodReceivedSourceState).toContain(
      "期间回款或行政区存在冲突",
    );
    expect(groups[0].rows[0].periodReceivedSourceIds).toBe(
      "receipt-a、receipt-b、receipt-c",
    );
    expect(JSON.stringify(rows)).toBe(original);
  });
});

function projectFixture(): FinancialAnalysisModule {
  const source = moduleFixture("projects");
  source.series = [
    { key: "received", label: "已回款", values: ["100", "0.3"] },
  ];
  source.details = [
    {
      id: "jan-a",
      period: "2026年01月",
      project: "前期项目",
      sourceId: "a",
      region: "海淀区",
      received: "100",
      contract: "200",
      outstanding: "100",
    },
    {
      id: "feb-a",
      period: "2026年02月",
      project: "项目甲",
      sourceId: "a",
      region: "海淀区",
      received: "0.1",
      contract: "1",
      outstanding: "0.9",
    },
    {
      id: "feb-b",
      period: "2026-02",
      project: "项目乙",
      sourceId: "b",
      region: "海淀区",
      received: "0.2",
      contract: "1",
      outstanding: "0.8",
    },
  ];
  return source;
}

function projectReceiptFixture(
  changes: Partial<FinancialAnalysisProjectReceipt> = {},
): FinancialAnalysisProjectReceipt {
  return {
    rootContractId: "a",
    receiptId: "receipt-a",
    periodKey: "2026-02",
    from: "2026-02",
    to: "2026-02",
    projectNumber: "项目原件编号甲",
    projectNumberSource: "主营合同原件业务编号",
    receiptDate: "2026-02-15",
    amount: "0.1",
    receiptNumber: "银行回单甲",
    receiptNumberSource: "electronic_receipt_no",
    transactionSerialNo: "流水甲",
    bankName: "合成银行",
    fileName: "合成回单.pdf",
    mimeType: "application/pdf",
    previewUrl:
      "/api/monthly-financial-reports/analysis/projects/a/receipts/receipt-a/preview?from=2026-02&to=2026-02",
    previewUnavailableReason: null,
    ...changes,
  };
}

describe("项目点选的回单归属与真实期间", () => {
  it("仅向本期明细传递同项目同期间的真实日期回单，不改输入或累计明细", () => {
    const source = projectFixture();
    source.projectReceipts = [
      projectReceiptFixture(),
      projectReceiptFixture({ rootContractId: "b", receiptId: "receipt-b" }),
      projectReceiptFixture({
        rootContractId: "outside",
        receiptId: "wrong-project",
      }),
      projectReceiptFixture({
        periodKey: "2026-01",
        receiptId: "wrong-period",
      }),
      projectReceiptFixture({ from: "2026-01", receiptId: "wrong-from" }),
      projectReceiptFixture({ to: "2026-03", receiptId: "wrong-to" }),
      projectReceiptFixture({
        receiptDate: "2026-03-01",
        receiptId: "outside-date",
      }),
      projectReceiptFixture({
        receiptDate: "2026-02-30",
        receiptId: "invalid-date",
      }),
      projectReceiptFixture({
        receiptDate: "2026-02-15T00:00:00Z",
        receiptId: "timestamp-date",
      }),
    ];
    const original = JSON.stringify(source);
    const selected = buildProjectPeriodDetails(source, {
      from: "2026-02",
      to: "2026-02",
      metricKey: "periodReceived",
    });
    expect(selected.receipts.map((item) => item.receiptId)).toEqual([
      "receipt-a",
      "receipt-b",
    ]);
    expect(selected.receipts[0].amount).toBe("0.1");
    expect(
      buildProjectPeriodDetails(source, { from: "2026-02", to: "2026-02" })
        .receipts,
    ).toEqual([]);
    expect(
      buildProjectPeriodDetails(source, {
        from: "2026-02",
        to: "2026-02",
        periodKey: "不存在",
        metricKey: "periodReceived",
      }).receipts,
    ).toEqual([]);
    expect(JSON.stringify(source)).toBe(original);
  });

  it("部分季度及同期回单必须匹配实际起止，不能借本期或季末文件", () => {
    const source = projectFixture();
    source.periods = [
      {
        key: "2025-Q1",
        label: "2025年第1季度",
        from: "2025-01",
        to: "2025-02",
      },
    ];
    source.details = [
      {
        id: "selected-project",
        sourceId: "a",
        periodKey: "2025-Q1",
        from: "2025-01",
        to: "2025-02",
        periodReceived: "0.1",
      },
    ];
    source.projectReceipts = [
      projectReceiptFixture({
        receiptId: "same-period",
        periodKey: "2025-Q1",
        from: "2025-01",
        to: "2025-02",
        receiptDate: "2025-02-28",
      }),
      projectReceiptFixture({
        receiptId: "full-quarter",
        periodKey: "2025-Q1",
        from: "2025-01",
        to: "2025-03",
        receiptDate: "2025-02-28",
      }),
      projectReceiptFixture({
        receiptId: "future-month",
        periodKey: "2025-Q1",
        from: "2025-01",
        to: "2025-02",
        receiptDate: "2025-03-01",
      }),
      projectReceiptFixture(),
    ];
    const result = buildProjectPeriodDetails(source, {
      from: "2025-01",
      to: "2025-02",
      periodKey: "2025-Q1",
      comparison: true,
      metricKey: "periodReceived",
    });
    expect(result.receipts.map((item) => item.receiptId)).toEqual([
      "same-period",
    ]);
    expect(result.scopeLabel).toContain("对比期");
  });

  it("旧响应没有回单清单时返回空，不用内部来源编号制造文件", () => {
    const source = projectFixture();
    source.details[1].periodReceivedSourceIds = "内部记录编号";
    expect(
      buildProjectPeriodDetails(source, {
        from: "2026-02",
        to: "2026-02",
        metricKey: "periodReceived",
      }).receipts,
    ).toEqual([]);
  });

  it("重复来源的真实项目编号不一致时保留金额而不任选一个编号", () => {
    const source = projectFixture();
    const originalRow = {
      ...source.details[1],
      projectNumber: "合同原件编号甲",
    };
    source.details = [
      originalRow,
      { ...originalRow, id: "duplicate", projectNumber: "合同原件编号乙" },
    ];
    const result = buildProjectPeriodDetails(source, {
      from: "2026-02",
      to: "2026-02",
      metricKey: "periodReceived",
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].projectNumber).toBeNull();
    expect(result.rows[0].projectNumberSource).toContain("待核对");
    expect(result.rows[0].received).toBe("0.1");
    expect(originalRow.projectNumber).toBe("合同原件编号甲");
  });
});
