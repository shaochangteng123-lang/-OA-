import type { MonthlyFinancialAnalysisData } from "../types/monthly-financial-analysis.js";
import type { MonthlyFinancialAutomaticSnapshot } from "../types/monthly-financial-report.js";
import { canMaintainMonthlyFinancialReport } from "../utils/monthly-financial-permissions.js";

const PAYROLL_PART_KEYS = new Set([
  "salary",
  "social",
  "housing",
  "adjustment",
  "known_salary",
  "known_social",
  "known_housing",
  "known_adjustment",
]);

/** 沿用工资模块的管理员权限，新增分析不通过月报响应扩大工资分项可见范围。 */
export function protectMonthlyFinancialPayrollMetadata(
  details: MonthlyFinancialAutomaticSnapshot["details"],
  role: string,
): MonthlyFinancialAutomaticSnapshot["details"] {
  if (canMaintainMonthlyFinancialReport(role)) return details;
  return details.map((detail) => {
    if (!detail.analysis?.payrollParts) return detail;
    const analysis = { ...detail.analysis };
    delete analysis.payrollParts;
    return { ...detail, analysis };
  });
}

export function protectMonthlyFinancialAnalysis(
  data: MonthlyFinancialAnalysisData,
  role: string,
): MonthlyFinancialAnalysisData {
  const allowed = canMaintainMonthlyFinancialReport(role);
  const protectModules = (modules: MonthlyFinancialAnalysisData["modules"]) =>
    modules.map((module) => {
      if (module.key !== "personnel") return module;
      if (allowed) return { ...module, payrollDetailsVisible: true };
      const columns = module.columns.filter(
        (column) => !PAYROLL_PART_KEYS.has(column.key),
      );
      const visibleKeys = new Set([
        "id",
        ...columns.map((column) => column.key),
      ]);
      const protectDetails = (details: typeof module.details) =>
        details.map(
          (detail) =>
            Object.fromEntries(
              Object.entries(detail).filter(([key]) => visibleKeys.has(key)),
            ) as typeof detail,
        );
      return {
        ...module,
        payrollDetailsVisible: false,
        // 新折线和摘要同样属于响应与导出，不能只隐藏旧明细列及结构图。
        series: module.series.filter(
          (series) => !PAYROLL_PART_KEYS.has(series.key),
        ),
        summaries: module.summaries.filter(
          (summary) => !PAYROLL_PART_KEYS.has(summary.key),
        ),
        comparison: module.comparison.filter(
          (value) => !PAYROLL_PART_KEYS.has(value.key),
        ),
        columns,
        details: protectDetails(module.details),
        ...(module.personnelAnnualDetails
          ? {
              personnelAnnualDetails: protectDetails(
                module.personnelAnnualDetails,
              ),
            }
          : {}),
        breakdown: [],
        warnings: [
          ...module.warnings,
          "工资、公司社保、公积金及实际调整分项沿用工资模块管理员权限；当前账号仅查看已授权的成本合计与费用明细。",
        ],
      };
    });
  return {
    ...data,
    modules: protectModules(data.modules),
    ...(data.comparison
      ? {
          comparison: {
            ...data.comparison,
            modules: protectModules(data.comparison.modules),
          },
        }
      : {}),
  };
}
