/** @jest-environment node */
import {
  buildMonthlyFinancialAnalysis,
  type FinancialAnalysisReport,
  type MonthlyFinancialAnalysisInput,
} from "../server/services/monthlyFinancialAnalysis";
import { visibleFinancialChartModule } from "@/utils/monthlyFinancialOutflowMetrics";
import { buildMonthlyOutflowStructure } from "@/utils/monthlyFinancialAnalysisDrilldown";

function source(): MonthlyFinancialAnalysisInput {
  const report: FinancialAnalysisReport = {
    month: "2026-08",
    status: "draft",
    generatedAt: "2026-09-08T00:00:00Z",
    savedAt: null,
    closedAt: null,
    income: { mainReceipt: "0", generalInterest: "0" },
    accounts: [
      {
        code: "general",
        name: "一般账户",
        opening: "1000",
        inflow: "0",
        outflow: "999",
        closing: "1",
      },
    ],
    sources: [{ key: "contract_receipts", status: "missing" }],
    automaticDetails: [
      {
        sourceType: "reimbursement",
        sourceId: "基础",
        metric: "basic_reimbursement",
        amount: "10.01",
        accountCode: "general",
        occurredOn: "2026-08-01",
        description: "无当前报销维度的历史基础报销",
      },
      {
        sourceType: "reimbursement",
        sourceId: "大额",
        metric: "large_reimbursement",
        amount: "20.02",
        accountCode: "general",
        occurredOn: "2026-08-01",
        description: "业务用途大额报销",
      },
      {
        sourceType: "reimbursement",
        sourceId: "商务",
        metric: "business_reimbursement",
        amount: "500",
        accountCode: "business",
        occurredOn: "2026-08-01",
        description: "商务报销",
      },
    ],
    manualItems: [
      {
        id: "银行费",
        category: "general_bank_fee",
        amount: "9",
        accountCode: "general",
        direction: "expense",
        occurredOn: "2026-08-01",
        sourceType: "monthly_bank_transaction",
        effective: true,
      },
      {
        id: "旧费",
        category: "general_bank_fee",
        amount: "999",
        accountCode: "general",
        direction: "expense",
        occurredOn: "2026-08-01",
        effective: false,
      },
      {
        id: "商务银行费",
        category: "business_bank_fee",
        amount: "12",
        accountCode: "business",
        direction: "expense",
        occurredOn: "2026-08-01",
      },
      {
        id: "杂项",
        category: "general_other",
        amount: "300",
        accountCode: "general",
        direction: "expense",
        occurredOn: "2026-08-01",
      },
    ],
  };
  return {
    query: { from: "2026-08", to: "2026-08", granularity: "month" },
    generatedAt: "2026-09-08T00:00:00Z",
    reports: [report],
  };
}
function outflow(input = source()) {
  return buildMonthlyFinancialAnalysis(input).modules.find(
    (m) => m.key === "outflow",
  )!;
}
test("行政只合并基础大额，手续费只取一般账户有效手续费；无关缺源及总额差异不抹去已核验数据", () => {
  const result = outflow();
  expect(result.series.find((s) => s.key === "administration")!.values).toEqual(
    ["30.03"],
  );
  expect(result.series.find((s) => s.key === "other")).toMatchObject({
    label: "一般账户跨行手续费",
    values: ["9"],
  });
  expect(result.series.some((s) => s.key === "business")).toBe(false);
  expect(
    result.details
      .filter((r) => r.category === "一般账户跨行手续费")
      .map((r) => r.amount),
  ).toEqual(["9"]);
  expect(
    result.details.some(
      (r) =>
        r.category === "未纳入指标的其他一般账户支出" && r.amount === "300",
    ),
  ).toBe(true);
  expect(result.summaries[0].amount).toBeNull();
  expect(result.warnings.some((w) => w.includes("不一致"))).toBe(true);
});
test("查看指标默认总金额加五类；稳定引用不重置点选，饼图使用同分类合计", () => {
  const input = source();
  input.reports[0].sources = [];
  const raw = outflow(input);
  const before = JSON.stringify(raw);
  const visible = visibleFinancialChartModule(raw);
  expect(visible.series.map((s) => s.key)).toEqual([
    "categoryTotal",
    "administration",
    "salary",
    "other",
    "tax",
    "asset",
  ]);
  expect(visibleFinancialChartModule(raw).series).toBe(visible.series);
  expect(JSON.stringify(raw)).toBe(before);
  const structure = buildMonthlyOutflowStructure(raw, "2026-08");
  expect(raw.series.find((s) => s.key === "categoryTotal")).toMatchObject({
    label: "总金额",
    values: ["39.03"],
    partial: [true],
  });
  expect(structure.total).toBe("39.03");
  expect(structure.totalLabel).toBe("已知分类总金额");
  expect(structure.items).toHaveLength(5);
  expect(structure.items.find((i) => i.key === "other")?.amount).toBe("9");
});
test("本身缺少银行来源保留未知；报销未归期明确标已知部分，不使用其他来源补零", () => {
  const input = source();
  input.reports[0].sources = [
    { key: "monthly_bank_receipts", status: "error" },
  ];
  input.reimbursementDatesComplete = { basic: false, large: false };
  const result = outflow(input);
  expect(result.series.find((s) => s.key === "other")!.values).toEqual([null]);
  expect(result.series.find((s) => s.key === "administration")).toMatchObject({
    label: "行政支出（已归期部分）",
    values: ["30.03"],
  });
  expect(result.warnings.some((w) => w.includes("付款日期缺失"))).toBe(true);
});
test.each(["quarter", "year"] as const)(
  "%s与月度使用相同分类与精确金额",
  (granularity) => {
    const input = source();
    input.query.granularity = granularity;
    const result = outflow(input);
    expect(
      result.breakdown.find((v) => v.key === "administration")?.amount,
    ).toBe("30.03");
    expect(result.breakdown.find((v) => v.key === "other")?.amount).toBe("9");
    expect(
      result.series.find((v) => v.key === "categoryTotal")?.values,
    ).toEqual(["39.03"]);
  },
);
test("季度总金额先累计各月已知分类，不因手续费部分月份未知而漏掉8月9元", () => {
  const input = source();
  const august = input.reports[0];
  const shifted = (month: string, bankKnown: boolean) => ({
    ...august,
    month,
    sources: bankKnown
      ? []
      : [{ key: "monthly_bank_receipts", status: "missing" }],
    automaticDetails: august.automaticDetails.map((row) => ({
      ...row,
      occurredOn: `${month}-01`,
    })),
    manualItems: bankKnown
      ? august.manualItems.map((row) => ({ ...row, occurredOn: `${month}-01` }))
      : august.manualItems.filter((row) => row.category !== "general_bank_fee"),
  });
  input.query = { from: "2026-07", to: "2026-09", granularity: "quarter" };
  input.reports = [
    shifted("2026-07", false),
    shifted("2026-08", true),
    shifted("2026-09", false),
  ];
  const result = outflow(input);
  expect(result.series.find((row) => row.key === "other")).toMatchObject({
    values: [null],
    knownValues: ["9"],
    partial: [true],
  });
  expect(
    result.series.find((row) => row.key === "categoryTotal"),
  ).toMatchObject({ values: ["99.09"], partial: [true] });
  expect(result.breakdown.find((row) => row.key === "other")).toMatchObject({
    amount: "9",
    note: expect.stringContaining("已知"),
  });
  const structure = buildMonthlyOutflowStructure(result);
  expect(structure.total).toBe("99.09");
  expect(structure.totalLabel).toBe("已知分类总金额");
  expect(structure.items.find((row) => row.key === "other")).toMatchObject({
    label: "一般账户跨行手续费（已知部分）",
    amount: "9",
  });
});
test("总金额不重复加入银行总额，保留十二位小数、大金额、真实零和全未知", () => {
  const precise = source();
  precise.reports[0].sources = [];
  precise.reports[0].automaticDetails = [
    {
      ...precise.reports[0].automaticDetails[0],
      sourceId: "大额精确值",
      metric: "basic_reimbursement",
      amount: "999999999999999999.123456789012",
    },
    {
      ...precise.reports[0].automaticDetails[0],
      sourceId: "最小精度值",
      metric: "large_reimbursement",
      amount: "0.000000000001",
    },
  ];
  expect(
    outflow(precise).series.find((row) => row.key === "categoryTotal")?.values,
  ).toEqual(["1000000000000000008.123456789013"]);

  const zero = source();
  zero.reports[0].sources = [];
  zero.reports[0].automaticDetails = [];
  zero.reports[0].manualItems = [];
  expect(
    outflow(zero).series.find((row) => row.key === "categoryTotal")?.values,
  ).toEqual(["0"]);

  const unknown = source();
  unknown.reports[0].automaticDetails = [];
  unknown.reports[0].manualItems = [];
  unknown.reports[0].sources = [
    { key: "reimbursements", status: "missing" },
    { key: "payroll", status: "missing" },
    { key: "monthly_bank_receipts", status: "missing" },
    { key: "general_tax_payment", status: "missing" },
    { key: "asset_payments", status: "missing" },
  ];
  expect(
    outflow(unknown).series.find((row) => row.key === "categoryTotal"),
  ).toMatchObject({ values: [null], partial: [true] });
});
