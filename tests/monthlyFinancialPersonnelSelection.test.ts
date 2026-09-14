import { buildFinancialPersonnelSelection } from "@/utils/monthlyFinancialPersonnelSelection";
import type { FinancialAnalysisModule } from "@/types/monthlyFinancialAnalysis";
const keys = [
  "salary",
  "social",
  "housing",
  "adjustment",
  "payrollCost",
  "basic",
  "large",
  "business",
  "overhead",
];
function fixture(): FinancialAnalysisModule {
  const months = ["2026-03", "2026-04", "2026-05"];
  return {
    key: "personnel",
    title: "人力成本分析",
    description: "",
    sourceLabel: "",
    updatedAt: null,
    periods: months.map((month) => ({
      key: month,
      label: month,
      from: month,
      to: month,
    })),
    series: [
      { key: "payrollCost", label: "工资总成本", values: ["300", "0", "900"] },
      { key: "total", label: "总成本", values: ["320", "0", null] },
      { key: "knownTotal", label: "已知成本", values: ["320", "0", "920"] },
    ],
    summaries: [],
    breakdown: [
      { key: "overhead", label: "错误的整个查询范围", amount: "999999" },
    ],
    comparison: [],
    warnings: [],
    appliedFilters: [],
    columns: keys.map((key) => ({
      key,
      label: key === "overhead" ? "房租分摊" : key,
      format: "amount" as const,
    })),
    details: months.flatMap((month, index) =>
      ["p1", "p2"].map((personId, p) => {
        const salary = index === 1 ? "0" : String((index + 1) * 100 * (p + 1));
        return {
          id: `${month}:${personId}`,
          personId,
          person: personId,
          period: month,
          month,
          from: month,
          to: month,
          sourceId: `source-${month}-${personId}`,
          salary,
          social: "0",
          housing: "0",
          adjustment: "0",
          payrollCost: salary,
          known_payrollCost: salary,
          known_salary: salary,
          known_social: "0",
          known_housing: "0",
          known_adjustment: "0",
          basic: "0",
          large: "0",
          business: "0",
          overhead: index === 1 ? "0" : "10",
          known_overhead: index === 1 ? "0" : "10",
        };
      }),
    ),
  };
}
const selection = {
  month: "2026-03",
  comparison: false,
  metricKey: "payrollCost",
};
describe("人力点位只读取对应期间成本构成", () => {
  test("异常分项与原始合计不闭合时保留原金额但禁止绘制比例", () => {
    const module = fixture();
    module.series.find((series) => series.key === "knownTotal")!.values[2] =
      "660";
    const view = buildFinancialPersonnelSelection(module, {
      ...selection,
      month: "2026-05",
    });
    expect(view.total).toBe("660");
    expect(view.items.find((item) => item.key === "salary")?.amount).toBe(
      "900",
    );
    expect(view.disabledReason).toContain("不一致");
  });
  test("全部人员点选只合计所选月，不使用整个范围breakdown", () => {
    const result = buildFinancialPersonnelSelection(fixture(), selection);
    expect(result.total).toBe("320");
    expect(result.scopeLabel).toBe("2026-03 · 全部人员");
    expect(result.items.find((i) => i.key === "salary")?.amount).toBe("300");
    expect(result.items.find((i) => i.key === "overhead")?.amount).toBe("20");
    expect(result.items.some((i) => i.amount === "999999")).toBe(false);
    expect(result.totalIsPartial).toBe(false);
  });
  test("已筛选人员只显示该人员且总额采用同查询的原始序列", () => {
    const module = fixture();
    module.series.find((i) => i.key === "total")!.values[0] = "110";
    const result = buildFinancialPersonnelSelection(
      module,
      selection,
      "p1",
      "人员甲",
    );
    expect(result.items.find((i) => i.key === "salary")?.amount).toBe("100");
    expect(result.items.find((i) => i.key === "overhead")?.amount).toBe("10");
    expect(result.total).toBe("110");
    expect(result.scopeLabel).toContain("人员甲");
  });
  test("真实零月份清掉上一月份构成，不把未知点当零", () => {
    const module = fixture();
    const zero = buildFinancialPersonnelSelection(module, {
      ...selection,
      month: "2026-04",
    });
    expect(zero.total).toBe("0");
    expect(zero.items.every((i) => i.amount === "0")).toBe(true);
    module.series[0].values[1] = null;
    expect(
      buildFinancialPersonnelSelection(module, {
        ...selection,
        month: "2026-04",
      }).items,
    ).toEqual([]);
  });
  test("同期真实年月不重复移年，季度用准确from/to选择", () => {
    const module = fixture();
    const past = buildFinancialPersonnelSelection(module, {
      ...selection,
      comparison: true,
    });
    expect(past.scopeLabel).toBe("对比期 · 2026-03 · 全部人员");
    module.periods = [
      {
        key: "2026-Q1",
        label: "2026年第1季度",
        from: "2026-01",
        to: "2026-03",
      },
    ];
    module.details = module.details.slice(0, 2).map((row) => ({
      ...row,
      period: "2026年第1季度",
      from: "2026-01",
      to: "2026-03",
    }));
    const quarterly = buildFinancialPersonnelSelection(module, {
      ...selection,
      month: "2026-01",
      from: "2026-01",
      to: "2026-03",
      periodKey: "2026-Q1",
    });
    expect(quarterly.items.find((i) => i.key === "salary")?.amount).toBe("300");
    expect(quarterly.scopeLabel).toContain("2026-01 至 2026-03");
  });
  test("未知完整总额明确用已知合计，错误期与无权限不能泄漏数据", () => {
    const module = fixture();
    const partial = buildFinancialPersonnelSelection(module, {
      ...selection,
      month: "2026-05",
    });
    expect(partial.total).toBe("920");
    expect(partial.totalIsPartial).toBe(true);
    expect(
      buildFinancialPersonnelSelection(module, {
        ...selection,
        from: "2026-03",
        to: "2026-06",
      }).items,
    ).toEqual([]);
    module.payrollDetailsVisible = false;
    expect(buildFinancialPersonnelSelection(module, selection).items).toEqual(
      [],
    );
    expect(
      buildFinancialPersonnelSelection(module, selection).total,
    ).toBeNull();
  });
});
