/** @jest-environment node */
import * as XLSX from "xlsx";
import { protectMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysisPermissions";
import { buildMonthlyFinancialAnalysisWorkbook } from "../server/services/monthlyFinancialAnalysisWorkbook";
import { canReadMonthlyFinancialReport } from "../server/utils/monthly-financial-permissions";
import type {
  FinancialAnalysisModule,
  MonthlyFinancialAnalysisData,
} from "../server/types/monthly-financial-analysis";

const secretAmounts = [
  "98765.123456789012",
  "87654.234567890123",
  "76543.345678901234",
  "-65432.456789012345",
];
const sensitiveKeys = ["salary", "social", "housing", "adjustment"];
const safeKeys = [
  "payrollCost",
  "basic",
  "large",
  "business",
  "overhead",
  "knownTotal",
  "total",
];
const precise = "123456789012345678.123456789012";
const labels: Record<string, string> = {
  payrollCost: "工资总成本（含公司缴费）",
  salary: "应发工资",
  social: "公司社保",
  housing: "公司公积金",
  adjustment: "实际发生调整",
  basic: "基础报销",
  large: "大额报销",
  business: "商务报销",
  overhead: "公共费用分摊",
  knownTotal: "已知部分成本",
  total: "完整总成本",
};
function personnel(year: number): FinancialAnalysisModule {
  const amounts = Object.fromEntries([
    ...safeKeys.map((key) => [key, key === "total" ? null : precise]),
    ...sensitiveKeys.map((key, index) => [key, secretAmounts[index]]),
  ]);
  const keys = ["payrollCost", ...sensitiveKeys, ...safeKeys.slice(1)];
  return {
    key: "personnel",
    title: "人力成本分析",
    description: "合成人员成本",
    sourceLabel: "合成来源",
    updatedAt: null,
    periods: [
      {
        key: `${year}-08`,
        label: `${year}-08`,
        from: `${year}-08`,
        to: `${year}-08`,
      },
    ],
    series: keys.map((key) => ({
      key,
      label: labels[key],
      values: [amounts[key]],
    })),
    // 即使以后误把敏感分项加入摘要或指标比较，也必须先裁剪再导出。
    summaries: keys.map((key) => ({
      key,
      label: labels[key],
      amount: amounts[key],
    })),
    comparison: [
      ...sensitiveKeys.map((key) => ({
        key,
        label: labels[key],
        amount: amounts[key],
      })),
      { key: "employee-a", label: "合成员工", amount: precise },
    ],
    breakdown: keys.map((key) => ({
      key,
      label: labels[key],
      amount: amounts[key],
    })),
    columns: [
      { key: "person", label: "人员", format: "text" },
      ...keys.map((key) => ({
        key,
        label: labels[key],
        format: "amount" as const,
      })),
    ],
    details: [{ id: "detail-a", person: "合成员工", ...amounts }],
    warnings: [],
    appliedFilters: [],
  };
}
function fixture(): MonthlyFinancialAnalysisData {
  return {
    query: {
      from: "2026-08",
      to: "2026-08",
      granularity: "month",
      comparisonYear: 2025,
    },
    generatedAt: "2026-09-04T00:00:00Z",
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    warnings: [],
    modules: [personnel(2026)],
    comparison: {
      label: "2025年同期",
      query: { from: "2025-08", to: "2025-08", granularity: "month" },
      modules: [personnel(2025)],
      warnings: [],
    },
  };
}

describe("新增人力指标响应与导出的双期敏感权限", () => {
  it("总经理本期与同期所有输出位置都裁四分项，保留原授权工资成本和已知合计", () => {
    const original = fixture();
    const before = JSON.stringify(original);
    const safe = protectMonthlyFinancialAnalysis(original, "general_manager");
    for (const module of [...safe.modules, ...safe.comparison!.modules]) {
      expect(module.payrollDetailsVisible).toBe(false);
      expect(module.series.map((item) => item.key)).toEqual(safeKeys);
      expect(module.summaries.map((item) => item.key)).toEqual(safeKeys);
      expect(module.comparison.map((item) => item.key)).toEqual(["employee-a"]);
      expect(module.breakdown).toEqual([]);
      for (const key of sensitiveKeys) {
        expect(module.columns.some((column) => column.key === key)).toBe(false);
        expect(module.details[0][key]).toBeUndefined();
      }
      expect(module.details[0].payrollCost).toBe(precise);
      expect(
        module.series.find((item) => item.key === "total")!.values,
      ).toEqual([null]);
    }
    for (const secret of secretAmounts)
      expect(JSON.stringify(safe)).not.toContain(secret);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("受保护工作簿本期同期均无工资四分项，工资总成本以完整十进制文本导出", () => {
    const safe = protectMonthlyFinancialAnalysis(fixture(), "general_manager");
    const workbook = XLSX.read(
      buildMonthlyFinancialAnalysisWorkbook(safe, "personnel"),
      { type: "buffer" },
    );
    expect(workbook.SheetNames).toHaveLength(5);
    for (const name of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[name], {
        header: 1,
      });
      const contents = JSON.stringify(rows);
      for (const secret of secretAmounts)
        expect(contents).not.toContain(secret);
      for (const key of sensitiveKeys)
        expect(rows.flat()).not.toContain(labels[key]);
      if (name.endsWith("-统计") || name.endsWith("-明细")) {
        expect(rows.flat()).toContain(precise);
        expect(rows.flat()).toContain("工资总成本（含公司缴费）");
        expect(rows.flat()).toContain("未取得数据");
      }
    }
  });

  it.each(["admin", "super_admin"])(
    "%s保留双期全部已授权分项，不改变源金额或总额",
    (role) => {
      const original = fixture();
      const safe = protectMonthlyFinancialAnalysis(original, role);
      for (const module of [...safe.modules, ...safe.comparison!.modules]) {
        expect(module.payrollDetailsVisible).toBe(true);
        for (const [index, key] of sensitiveKeys.entries()) {
          expect(
            module.series.find((item) => item.key === key)?.values,
          ).toEqual([secretAmounts[index]]);
          expect(module.details[0][key]).toBe(secretAmounts[index]);
        }
      }
    },
  );

  it.each(["user", "chairman", "boss", "business_manager", ""])(
    "普通无权角色%s不会因为新增汇总获得财务读取权限",
    (role) => {
      expect(canReadMonthlyFinancialReport(role)).toBe(false);
      const sanitized = protectMonthlyFinancialAnalysis(fixture(), role);
      for (const secret of secretAmounts)
        expect(JSON.stringify(sanitized)).not.toContain(secret);
    },
  );

  it("不误删其他模块原已授权的支出分类", () => {
    const data = fixture();
    const outflow: FinancialAnalysisModule = {
      ...personnel(2026),
      key: "outflow",
      title: "一般账户出账统计",
    };
    data.modules.push(outflow);
    expect(
      protectMonthlyFinancialAnalysis(data, "general_manager").modules[1],
    ).toBe(outflow);
  });
});
