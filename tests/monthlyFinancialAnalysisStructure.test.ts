import { buildFinancialAnalysisStructure } from "@/utils/monthlyFinancialAnalysisStructure";
import type {
  FinancialAnalysisModule,
  FinancialAnalysisQuery,
} from "@/types/monthlyFinancialAnalysis";

const query: FinancialAnalysisQuery = {
  from: "2026-01",
  to: "2026-09",
  granularity: "month",
};
function moduleData(
  overrides: Partial<FinancialAnalysisModule> = {},
): FinancialAnalysisModule {
  return {
    key: "outflow",
    title: "支出分析",
    description: "合成测试",
    sourceLabel: "合成来源",
    updatedAt: null,
    periods: [],
    series: [],
    summaries: [{ key: "total", label: "总额", amount: null }],
    breakdown: [],
    comparison: [],
    columns: [],
    details: [],
    warnings: [],
    appliedFilters: [],
    ...overrides,
  };
}

describe("财务结构图的可靠口径与部分明细补充", () => {
  it("可靠分类直接使用，不重新计算摘要且不修改输入", () => {
    const data = moduleData({
      breakdown: [
        { key: "admin", label: "行政", amount: "2053235.4" },
        { key: "other", label: "其他", amount: "0" },
      ],
    });
    const before = JSON.stringify(data);
    const result = buildFinancialAnalysisStructure(data, query);
    expect(result.items).toEqual(data.breakdown);
    expect(result.isPartial).toBe(false);
    expect(result.scopeLabel).toContain("2026-01 至 2026-09");
    expect(JSON.stringify(data)).toBe(before);
  });

  it("已有部分分类不从明细覆盖，保留负数和未知且标注正金额分母", () => {
    const data = moduleData({
      breakdown: [
        { key: "admin", label: "行政", amount: "10" },
        { key: "refund", label: "冲回", amount: "-2" },
        { key: "tax", label: "税费", amount: null },
      ],
      details: [
        {
          id: "one",
          sourceId: "one",
          month: "2026-08",
          category: "税费",
          amount: "999",
        },
      ],
    });
    const result = buildFinancialAnalysisStructure(data, query);
    expect(result.items).toEqual(data.breakdown);
    expect(result.isPartial).toBe(true);
    expect(result.note).toContain("已知正金额为分母");
  });

  it("余额仅回看所选范围内最近同一时点四账户，排除合计并保留零负未知", () => {
    const data = moduleData({
      key: "balances",
      periods: [
        { key: "old", label: "范围外", from: "2025-12", to: "2025-12" },
        { key: "aug", label: "八月", from: "2026-08", to: "2026-08" },
        { key: "sep", label: "九月", from: "2026-09", to: "2026-09" },
        { key: "jul", label: "七月", from: "2026-07", to: "2026-07" },
      ],
      series: [
        {
          key: "general",
          label: "一般账户",
          values: ["999", "2053235.4", null, "100"],
        },
        {
          key: "business",
          label: "商务账户",
          values: ["999", "0", null, "200"],
        },
        {
          key: "welfare_one",
          label: "福利一",
          values: ["999", "-12.34", null, "300"],
        },
        {
          key: "welfare_two",
          label: "福利二",
          values: ["999", null, null, "400"],
        },
        {
          key: "total",
          label: "合计",
          values: ["3996", "2053223.06", "123", "1000"],
        },
      ],
      breakdown: ["general", "business", "welfare_one", "welfare_two"].map(
        (key) => ({ key, label: key, amount: null }),
      ),
    });
    const before = JSON.stringify(data);
    const result = buildFinancialAnalysisStructure(data, query);
    expect(result.items.map((item) => item.amount)).toEqual([
      "2053235.4",
      "0",
      "-12.34",
      null,
    ]);
    expect(result.items.map((item) => item.key)).not.toContain("total");
    expect(result.scopeLabel).toContain("2026-08");
    expect(result.scopeLabel).toContain("非所选期末 2026-09");
    expect(result.isPartial).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("余额不借范围外期间，不将部分重叠季度或单独已知合计作为账户构成", () => {
    const data = moduleData({
      key: "balances",
      periods: [
        { key: "old", label: "旧月", from: "2025-12", to: "2025-12" },
        { key: "overlap", label: "交叉季度", from: "2025-12", to: "2026-02" },
        { key: "end", label: "期末", from: "2026-09", to: "2026-09" },
      ],
      series: [
        { key: "general", label: "一般", values: ["20", "30", null] },
        { key: "total", label: "合计", values: ["20", "30", "40"] },
      ],
      breakdown: [{ key: "general", label: "一般", amount: null }],
    });
    const result = buildFinancialAnalysisStructure(data, query);
    expect(result.items[0].amount).toBeNull();
    expect(result.disabledReason).toContain("所选范围内");
  });

  it("支出已知明细按分类有符号精确汇总，保留无记录分类和同类未知明细", () => {
    const data = moduleData({
      breakdown: [
        { key: "administration", label: "行政支出", amount: null },
        { key: "salary", label: "薪资", amount: null },
        { key: "tax", label: "实际税费", amount: null },
      ],
      details: [
        {
          id: "a",
          sourceId: "a",
          date: "2026-08-01",
          category: "行政支出",
          amount: "999999999999999999.123456789012",
        },
        {
          id: "b",
          sourceId: "b",
          month: "2026-08",
          category: "行政支出",
          amount: "0.000000000001",
        },
        {
          id: "c",
          sourceId: "c",
          month: "2026-08",
          category: "行政支出",
          amount: null,
        },
        {
          id: "d",
          sourceId: "d",
          month: "2026-08",
          category: "薪资",
          amount: "-5.000000000001",
        },
        {
          id: "e",
          sourceId: "e",
          month: "2026-08",
          category: "薪资",
          amount: "2",
        },
        {
          id: "outside",
          sourceId: "outside",
          month: "2025-12",
          category: "行政支出",
          amount: "999",
        },
        {
          id: "no-source",
          month: "2026-08",
          category: "行政支出",
          amount: "999",
        },
        {
          id: "no-date",
          sourceId: "no-date",
          category: "行政支出",
          amount: "999",
        },
      ],
    });
    const before = JSON.stringify(data);
    const result = buildFinancialAnalysisStructure(data, query);
    expect(
      result.items.find((item) => item.key === "administration")?.amount,
    ).toBe("999999999999999999.123456789013");
    expect(result.items.find((item) => item.key === "salary")?.amount).toBe(
      "-3.000000000001",
    );
    expect(result.items.find((item) => item.key === "tax")?.amount).toBeNull();
    expect(
      result.items.find((item) => item.key === "administration:unknown-details")
        ?.amount,
    ).toBeNull();
    expect(result.scopeLabel).toContain("已知明细构成（部分口径）");
    expect(result.note).toContain("不替代原摘要");
    expect(result.isPartial).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("商务按真实范围分组，已知金额可以归入未标注范围但不伪造区域", () => {
    const data = moduleData({
      key: "business",
      details: [
        {
          id: "a",
          sourceId: "a",
          month: "2026-08",
          scope: "朝阳",
          amount: "0.1",
        },
        {
          id: "b",
          sourceId: "b",
          month: "2026-08",
          scope: "朝阳",
          amount: "0.2",
        },
        { id: "c", sourceId: "c", month: "2026-08", scope: null, amount: "5" },
        {
          id: "d",
          sourceId: "d",
          month: "2026-08",
          scope: "海淀",
          amount: "-2",
        },
      ],
    });
    const result = buildFinancialAnalysisStructure(data, query);
    expect(result.items.map((item) => [item.label, item.amount])).toEqual([
      ["朝阳", "0.3"],
      ["未标注／历史范围未知", "5"],
      ["海淀", "-2"],
    ]);
    const filtered = buildFinancialAnalysisStructure(data, {
      ...query,
      reimbursementScope: "朝阳",
    });
    expect(filtered.items.map((item) => item.amount)).toEqual(["0.3"]);
    expect(filtered.isPartial).toBe(true);
  });

  it("人员必须先选择，不用全部人员构成冒充个人构成", () => {
    const data = moduleData({
      key: "personnel",
      breakdown: [{ key: "salary", label: "工资", amount: "100" }],
    });
    const result = buildFinancialAnalysisStructure(data, query);
    expect(result.items).toEqual([]);
    expect(result.disabledReason).toContain("选择一位人员");
  });

  it("人员仅汇总选中编号的授权成本列，不使用总额年度额或未分摊公共费用", () => {
    const data = moduleData({
      key: "personnel",
      payrollDetailsVisible: true,
      periods: [
        { key: "aug", label: "八月", from: "2026-08", to: "2026-08" },
        { key: "sep", label: "九月", from: "2026-09", to: "2026-09" },
      ],
      columns: [
        { key: "salary", label: "应发工资", format: "amount" },
        { key: "social", label: "公司社保", format: "amount" },
        { key: "adjustment", label: "实际发生调整", format: "amount" },
        { key: "basic", label: "基础报销", format: "amount" },
        { key: "overhead", label: "公共费用分摊", format: "amount" },
        { key: "total", label: "总成本", format: "amount" },
        { key: "knownTotal", label: "已知总成本", format: "amount" },
        { key: "annualTotal", label: "年度总成本", format: "amount" },
      ],
      breakdown: [
        { key: "salary", label: "应发工资", amount: null },
        { key: "social", label: "公司社保", amount: null },
      ],
      details: [
        {
          id: "a",
          sourceId: "pay-a",
          personId: "person-a",
          period: "八月",
          salary: "100.1",
          social: null,
          adjustment: "-5",
          basic: "10",
          overhead: "3.34",
          total: "9999",
          knownTotal: "9999",
          annualTotal: "999999",
        },
        {
          id: "b",
          sourceId: "pay-b",
          personId: "person-a",
          period: "九月",
          salary: "200.2",
          social: "26.7",
          adjustment: "0",
          basic: "0",
          overhead: "3.33",
        },
        {
          id: "other",
          sourceId: "other",
          personId: "person-b",
          month: "2026-08",
          salary: "9999",
        },
        {
          id: "unallocated",
          sourceId: "rent",
          month: "2026-08",
          overhead: "9999",
        },
      ],
    });
    const result = buildFinancialAnalysisStructure(data, {
      ...query,
      personId: "person-a",
    });
    expect(result.items.find((item) => item.key === "salary")?.amount).toBe(
      "300.3",
    );
    expect(result.items.find((item) => item.key === "social")?.amount).toBe(
      "26.7",
    );
    expect(
      result.items.find((item) => item.key === "social:unknown-details")
        ?.amount,
    ).toBeNull();
    expect(result.items.find((item) => item.key === "adjustment")?.amount).toBe(
      "-5",
    );
    expect(result.items.find((item) => item.key === "overhead")?.amount).toBe(
      "6.67",
    );
    expect(
      result.items.some((item) =>
        ["total", "knownTotal", "annualTotal"].includes(item.key),
      ),
    ).toBe(false);
    expect(result.isPartial).toBe(true);
  });

  it("无工资权限即使收到分项也不输出，不从总额反推", () => {
    const data = moduleData({
      key: "personnel",
      payrollDetailsVisible: false,
      breakdown: [{ key: "salary", label: "工资", amount: "100" }],
      columns: [{ key: "salary", label: "工资", format: "amount" }],
      details: [
        {
          id: "a",
          sourceId: "a",
          personId: "a",
          month: "2026-08",
          salary: "100",
          total: "200",
        },
      ],
    });
    const result = buildFinancialAnalysisStructure(data, {
      ...query,
      personId: "a",
    });
    expect(result.items).toEqual([]);
    expect(result.disabledReason).toContain("无工资分项查看权限");
  });

  it("人员分项全未知或缺列时不利用已知总成本反算", () => {
    const result = buildFinancialAnalysisStructure(
      moduleData({
        key: "personnel",
        columns: [
          { key: "salary", label: "工资", format: "amount" },
          { key: "knownTotal", label: "已知总成本", format: "amount" },
        ],
        details: [
          {
            id: "a",
            sourceId: "a",
            personId: "a",
            month: "2026-08",
            salary: null,
            knownTotal: "999",
          },
        ],
      }),
      { ...query, personId: "a" },
    );
    expect(result.items).toEqual([]);
    expect(result.disabledReason).toBeDefined();
    expect(result.note).toContain("不从总额反推");
  });

  it("非法金额不进入精确求和，已知零额仍可作为部分明细事实", () => {
    const result = buildFinancialAnalysisStructure(
      moduleData({
        details: [
          {
            id: "a",
            sourceId: "a",
            month: "2026-08",
            category: "行政",
            amount: "1e3",
          },
          {
            id: "b",
            sourceId: "b",
            month: "2026-08",
            category: "行政",
            amount: "0",
          },
        ],
      }),
      query,
    );
    expect(result.items.map((item) => item.amount)).toEqual(["0", null]);
    expect(result.isPartial).toBe(true);
  });

  it("未定义分类映射的模块不把合同额或收支总额拼成饼图", () => {
    const result = buildFinancialAnalysisStructure(
      moduleData({
        key: "projects",
        details: [{ id: "a", sourceId: "a", month: "2026-08", amount: "999" }],
      }),
      query,
    );
    expect(result.items).toEqual([]);
    expect(result.disabledReason).toBeDefined();
  });
});
