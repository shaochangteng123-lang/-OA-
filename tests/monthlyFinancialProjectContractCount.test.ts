/** @jest-environment node */
import * as XLSX from "xlsx";
import {
  buildMonthlyFinancialAnalysis,
  type AnalysisContract,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { buildMonthlyFinancialAnalysisWorkbook } from "../server/services/monthlyFinancialAnalysisWorkbook";

const generatedAt = "2026-09-07T00:00:00Z";

function contract(
  id: string,
  date: string | null,
  region: string,
  partyA: string,
  overrides: Partial<AnalysisContract> = {},
): AnalysisContract {
  return {
    id,
    rootId: id,
    relationType: "main",
    title: `项目${id}`,
    partyA,
    region,
    status: "effective",
    effectiveAt: date ? `${date}T00:00:00+08:00` : generatedAt,
    contractDate: date,
    contractDateSource: "manual",
    originalAmount: "100",
    amountDelta: "100",
    amountBefore: null,
    amountAfter: null,
    supplementSequence: null,
    changeType: null,
    updatedAt: generatedAt,
    ...overrides,
  };
}

function input(
  contracts: AnalysisContract[],
  overrides: Partial<MonthlyFinancialAnalysisInput> = {},
): MonthlyFinancialAnalysisInput {
  return {
    query: { from: "2025-01", to: "2025-03", granularity: "month" },
    generatedAt,
    reports: [],
    contracts,
    receipts: [],
    ...overrides,
  };
}

function project(data: MonthlyFinancialAnalysisInput) {
  return buildMonthlyFinancialAnalysis(data).modules.find(
    (module) => module.key === "projects",
  )!;
}

function signedSeries(data: MonthlyFinancialAnalysisInput) {
  return project(data).series.find(
    (series) => series.key === "signedContractCount",
  )!;
}

describe("项目分析主营合同签订数量", () => {
  const rootsAndChanges = () => [
    contract("root-a1", "2025-01-10", "朝阳区", "甲方一"),
    contract("root-a2", "2025-01-20", "朝阳区", "甲方一"),
    contract("supplement", "2025-02-01", "朝阳区", "甲方一", {
      rootId: "root-a1",
      relationType: "supplement",
      supplementSequence: 1,
      amountDelta: "20",
      amountBefore: "100",
      amountAfter: "120",
    }),
    contract("termination", "2025-03-01", "朝阳区", "甲方一", {
      rootId: "root-a1",
      relationType: "termination",
      amountDelta: "-120",
      amountBefore: "120",
      amountAfter: "0",
    }),
    contract("root-b", "2025-02-05", "海淀区", "甲方一", {
      status: "completed",
    }),
    contract("root-c", "2025-02-06", "海淀区", "甲方二", {
      status: "terminated",
    }),
    contract("root-draft", "2025-03-01", "海淀区", "甲方二", {
      status: "draft",
      effectiveAt: null,
    }),
  ];

  it("按当期新签主合同链计数，并按行政区和合同甲方分段", () => {
    const module = project(input(rootsAndChanges()));
    const series = module.series.find(
      (item) => item.key === "signedContractCount",
    )!;

    expect(series).toMatchObject({
      label: "主营项目签订合同数量",
      unit: "个",
      values: ["2", "2", "0"],
    });
    expect(series.segments).toHaveLength(3);
    expect(
      Object.fromEntries(
        series.segments!.map((segment) => [segment.label, segment.values]),
      ),
    ).toEqual({
      "朝阳区 · 甲方一": ["2", "0", "0"],
      "海淀区 · 甲方一": ["0", "1", "0"],
      "海淀区 · 甲方二": ["0", "1", "0"],
    });
    expect(
      Object.fromEntries(
        series.segments!.map((segment) => [
          segment.label,
          segment.projectNames,
        ]),
      ),
    ).toEqual({
      "朝阳区 · 甲方一": [["项目root-a1", "项目root-a2"], [], []],
      "海淀区 · 甲方一": [[], ["项目root-b"], []],
      "海淀区 · 甲方二": [[], ["项目root-c"], []],
    });
    for (const segment of series.segments!) {
      segment.values.forEach((count, index) => {
        const names = segment.projectNames?.[index];
        if (count === null) expect(names).toBeNull();
        else expect(names).toHaveLength(Number(count));
      });
    }
    expect(
      series.segments!.flatMap((segment) => segment.projectNames!.flat()),
    ).not.toEqual(
      expect.arrayContaining([
        "项目supplement",
        "项目termination",
        "项目root-draft",
      ]),
    );
    expect(new Set(series.segments!.map((segment) => segment.key)).size).toBe(
      3,
    );
    expect(
      module.summaries.find((item) => item.key === "signedContractCount"),
    ).toMatchObject({ amount: "4", unit: "个" });
  });

  it("往年同期保持相同指标键和分组键，只按对应期间分别计数", () => {
    const data = buildMonthlyFinancialAnalysis(
      input(
        [
          contract("previous", "2025-01-10", "朝阳区", "甲方一"),
          contract("current-one", "2026-02-10", "朝阳区", "甲方一"),
          contract("current-two", "2026-02-11", "朝阳区", "甲方一"),
        ],
        {
          query: {
            from: "2026-01",
            to: "2026-03",
            granularity: "month",
            comparisonYear: 2025,
          },
        },
      ),
    );
    const current = data.modules
      .find((module) => module.key === "projects")!
      .series.find((series) => series.key === "signedContractCount")!;
    const previous = data
      .comparison!.modules.find((module) => module.key === "projects")!
      .series.find((series) => series.key === "signedContractCount")!;

    expect(current.values).toEqual(["0", "2", "0"]);
    expect(previous.values).toEqual(["1", "0", "0"]);
    expect(current.unit).toBe("个");
    expect(previous.unit).toBe("个");
    expect(current.segments![0].key).toBe(previous.segments![0].key);
    expect(current.segments![0].projectNames).toEqual([
      [],
      ["项目current-one", "项目current-two"],
      [],
    ]);
    expect(previous.segments![0].projectNames).toEqual([
      ["项目previous"],
      [],
      [],
    ]);
  });

  it.each([
    {
      granularity: "quarter" as const,
      periods: [
        { key: "2025-Q1", from: "2025-02", to: "2025-03" },
        { key: "2025-Q2", from: "2025-04", to: "2025-06" },
        { key: "2025-Q3", from: "2025-07", to: "2025-09" },
      ],
      values: ["2", "1", "0"],
      projectNames: [["项目early", "项目late"], ["项目second-quarter"], []],
    },
    {
      granularity: "year" as const,
      periods: [{ key: "2025", from: "2025-02", to: "2025-09" }],
      values: ["3"],
      projectNames: [["项目early", "项目late", "项目second-quarter"]],
    },
  ])(
    "$granularity按真实期间索引聚合项目名称并尊重部分首尾边界",
    ({ granularity, periods, values, projectNames }) => {
      const module = project(
        input(
          [
            contract("late", "2025-03-31", "朝阳区", "甲方一"),
            contract("early", "2025-02-01", "朝阳区", "甲方一"),
            contract("before-range", "2025-01-31", "朝阳区", "甲方一"),
            contract("second-quarter", "2025-04-01", "朝阳区", "甲方一"),
          ],
          {
            query: { from: "2025-02", to: "2025-09", granularity },
          },
        ),
      );
      const series = module.series.find(
        (item) => item.key === "signedContractCount",
      )!;

      expect(
        module.periods.map(({ key, from, to }) => ({ key, from, to })),
      ).toEqual(periods);
      expect(series.values).toEqual(values);
      expect(series.segments![0].projectNames).toEqual(projectNames);
      expect(series.segments![0].projectNames!.flat()).not.toContain(
        "项目before-range",
      );
    },
  );

  it("合同区域和甲方筛选同时限制数量总计及服务单位折线", () => {
    const series = signedSeries(
      input(rootsAndChanges(), {
        query: {
          from: "2025-01",
          to: "2025-03",
          granularity: "month",
          partyA: "甲方一",
          contractRegion: "海淀区",
        },
      }),
    );

    expect(series.values).toEqual(["0", "1", "0"]);
    expect(series.segments).toEqual([
      expect.objectContaining({
        label: "海淀区 · 甲方一",
        region: "海淀区",
        serviceUnit: "甲方一",
        values: ["0", "1", "0"],
      }),
    ]);
  });

  it("当前业务日后不提前计数，已发生空期为零，未来期间保持未知", () => {
    const series = signedSeries(
      input(
        [
          contract("occurred", "2026-09-05", "朝阳区", "甲方一", {
            contractDateSource: "ocr",
          }),
          contract("not-occurred", "2026-09-08", "朝阳区", "甲方一"),
        ],
        {
          query: { from: "2026-08", to: "2026-10", granularity: "month" },
        },
      ),
    );

    expect(series.values).toEqual(["0", "1", null]);
    expect(series.segments![0].values).toEqual(["0", "1", null]);
    expect(series.segments![0].projectNames).toEqual([
      [],
      ["项目occurred"],
      null,
    ]);
  });

  it("非人工或文字识别确认日期不猜测归期，数量保持未知并给出提示", () => {
    const module = project(
      input([
        contract("upload-date", "2025-02-01", "朝阳区", "甲方一", {
          contractDateSource: "upload_date",
        }),
      ]),
    );
    const series = module.series.find(
      (item) => item.key === "signedContractCount",
    )!;

    expect(series.values).toEqual([null, null, null]);
    expect(series.segments![0].values).toEqual([null, null, null]);
    expect(series.segments![0].projectNames).toEqual([null, null, null]);
    expect(module.warnings.join("；")).toContain(
      "缺少人工确认或文字识别确认的有效签订日期",
    );
  });

  it("完整来源中的空期为零，未提供合同来源时保持未知", () => {
    expect(signedSeries(input([])).values).toEqual(["0", "0", "0"]);
    const missing = signedSeries({
      query: { from: "2025-01", to: "2025-03", granularity: "month" },
      generatedAt,
      reports: [],
      receipts: [],
    });
    expect(missing.values).toEqual([null, null, null]);
  });

  it("导出父序列与分段序列时保留整数和个数，不补成金额小数", () => {
    const data = buildMonthlyFinancialAnalysis(input(rootsAndChanges()));
    const workbook = XLSX.read(
      buildMonthlyFinancialAnalysisWorkbook(data, "projects"),
      { type: "buffer" },
    );
    const rows = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets["项目分析-统计"],
      { header: 1 },
    );
    const headerIndex = rows.findIndex((row) => row[0] === "统计期间");
    const header = rows[headerIndex];
    const january = rows[headerIndex + 1];

    expect(rows).toContainEqual([
      "所选期间新签主营项目合同数量",
      "4",
      expect.stringContaining("主合同签订日期"),
    ]);
    expect(january[header.indexOf("主营项目签订合同数量")]).toBe("2");
    expect(
      january[header.indexOf("主营项目签订合同数量 · 朝阳区 · 甲方一")],
    ).toBe("2");
  });
});
