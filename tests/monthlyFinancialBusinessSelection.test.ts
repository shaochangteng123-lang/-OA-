/** @jest-environment node */
import { buildFinancialBusinessSelection } from "../src/utils/monthlyFinancialBusinessSelection";
import type { FinancialAnalysisModule } from "../src/types/monthlyFinancialAnalysis";

function fixture(): FinancialAnalysisModule {
  return {
    key: "business",
    title: "商务统计",
    description: "",
    sourceLabel: "",
    updatedAt: null,
    periods: [
      { key: "2026-04", label: "2026-04", from: "2026-04", to: "2026-04" },
      { key: "2026-05", label: "2026-05", from: "2026-05", to: "2026-05" },
      { key: "2026-06", label: "2026-06", from: "2026-06", to: "2026-06" },
    ],
    series: [
      { key: "business", label: "商务报销", values: ["3358.7", "0", null] },
    ],
    summaries: [{ key: "total", label: "统计合计", amount: "99999" }],
    breakdown: [{ key: "whole", label: "整段不可借用", amount: "99999" }],
    comparison: [],
    columns: [],
    warnings: [],
    appliedFilters: [],
    details: [
      {
        id: "a",
        sourceId: "a",
        date: "2026-04-10",
        month: "2026-04",
        scopePath: "朝阳区 / GJDW",
        amount: "3258.70",
      },
      {
        id: "b",
        sourceId: "b",
        date: "2026-04-20",
        month: "2026-04",
        scopePath: "朝阳区 / WFAH",
        amount: "100.00",
      },
      {
        id: "buffer",
        sourceId: "buffer",
        date: "2026-03-10",
        month: "2026-03",
        scopePath: "不能来自缓冲",
        amount: "80000",
      },
    ],
  };
}
const selection = {
  month: "2026-04",
  comparison: false,
  metricKey: "business",
};
describe("商务点选期间精确分类", () => {
  it("使用真实点总额及所选月份完整路径，父级筛选的已返回子级不丢失", () => {
    const source = fixture();
    const original = JSON.stringify(source);
    const view = buildFinancialBusinessSelection(source, selection);
    expect(view.total).toBe("3358.7");
    expect(view.items).toEqual([
      { key: "朝阳区 / GJDW", label: "朝阳区 / GJDW", amount: "3258.7" },
      { key: "朝阳区 / WFAH", label: "朝阳区 / WFAH", amount: "100" },
    ]);
    expect(view.complete).toBe(true);
    expect(view.scopeLabel).toContain("2026-04");
    expect(JSON.stringify(source)).toBe(original);
  });
  it("零月显示零和空分类，不继续显示上一月份的构成", () => {
    const view = buildFinancialBusinessSelection(fixture(), {
      ...selection,
      month: "2026-05",
    });
    expect(view.total).toBe("0");
    expect(view.items).toEqual([]);
    expect(view.complete).toBe(true);
  });
  it("同期直接读取实际同比模块与月份，不根据当前横轴年份重复平移", () => {
    const source = fixture();
    source.periods[0] = {
      key: "2025-04",
      label: "2025-04",
      from: "2025-04",
      to: "2025-04",
    };
    source.details = source.details.slice(0, 2).map((row) => ({
      ...row,
      date: row.date!.replace("2026", "2025"),
      month: "2025-04",
    }));
    const view = buildFinancialBusinessSelection(source, {
      ...selection,
      month: "2025-04",
      comparison: true,
    });
    expect(view.scopeLabel).toContain("对比期 · 2025-04");
    expect(view.total).toBe("3358.7");
    expect(view.complete).toBe(true);
  });
  it.each([
    ["2026-Q2", "2026年第2季度"],
    ["2026", "2026年"],
  ])("季度或年度%s按明确起止期间分类", (key, label) => {
    const source = fixture();
    source.periods = [{ key, label, from: "2026-04", to: "2026-05" }];
    source.series[0].values = ["3358.7"];
    const view = buildFinancialBusinessSelection(source, {
      ...selection,
      month: "2026-05",
      from: "2026-04",
      to: "2026-05",
      periodKey: key,
    });
    expect(view.complete).toBe(true);
    expect(view.scopeLabel).toContain("2026-04 至 2026-05");
    expect(view.items).toHaveLength(2);
    expect(
      buildFinancialBusinessSelection(source, {
        ...selection,
        month: "2026-05",
        from: "2026-01",
        to: "2026-05",
        periodKey: key,
      }).total,
    ).toBeNull();
  });
  it("保留十二位小数及超大金额精度", () => {
    const source = fixture();
    source.series[0].values[0] = "123456789012345678.000000000003";
    source.details = [
      {
        id: "one",
        date: "2026-04-01",
        scopePath: "公司内部",
        amount: "123456789012345678.000000000001",
      },
      {
        id: "two",
        date: "2026-04-02",
        scopePath: "公司内部",
        amount: "0.000000000002",
      },
    ];
    const view = buildFinancialBusinessSelection(source, selection);
    expect(view.complete).toBe(true);
    expect(view.items[0].amount).toBe(source.series[0].values[0]);
  });
  it("明细不闭合时保留权威点金额并明确部分口径，不从分类改写总额", () => {
    const source = fixture();
    source.details.pop();
    source.details.pop();
    const view = buildFinancialBusinessSelection(source, selection);
    expect(view.total).toBe("3358.7");
    expect(view.complete).toBe(false);
    expect(view.note).toContain("未完全对应");
  });
  it("同一来源重复不重复累计，冲突金额使分类未知", () => {
    const source = fixture();
    source.details.push({ ...source.details[0], id: "duplicate" });
    expect(buildFinancialBusinessSelection(source, selection).complete).toBe(
      true,
    );
    source.details.at(-1)!.amount = "1";
    const conflict = buildFinancialBusinessSelection(source, selection);
    expect(conflict.complete).toBe(false);
    expect(conflict.items.every((item) => item.amount === null)).toBe(true);
    expect(conflict.total).toBe("3358.7");
  });
  it("未知点、错误模块、非商务指标与不存在的期间不能借其他数据", () => {
    const source = fixture();
    for (const value of [
      { ...selection, month: "2026-06" },
      { ...selection, month: "2020-01" },
      { ...selection, metricKey: "total" },
    ])
      expect(buildFinancialBusinessSelection(source, value).total).toBeNull();
    expect(
      buildFinancialBusinessSelection({ ...source, key: "inflow" }, selection)
        .total,
    ).toBeNull();
  });
});
