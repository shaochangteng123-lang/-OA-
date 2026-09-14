/** @jest-environment node */
import {
  protectMonthlyFinancialAnalysis,
  protectMonthlyFinancialPayrollMetadata,
} from "../server/services/monthlyFinancialAnalysisPermissions";
import { buildMonthlyFinancialAnalysisWorkbook } from "../server/services/monthlyFinancialAnalysisWorkbook";
import type { MonthlyFinancialAutomaticSnapshot } from "../server/types/monthly-financial-report";
import type { MonthlyFinancialAnalysisData } from "../server/types/monthly-financial-analysis";
import * as XLSX from "xlsx";

describe("财务分析保持既有工资敏感权限", () => {
  const details: MonthlyFinancialAutomaticSnapshot["details"] = [
    {
      sourceType: "payroll",
      sourceId: "salary-1",
      metric: "human_cost",
      amount: "2000",
      occurredOn: "2026-08-01",
      accountCode: "general",
      description: "人员成本",
      personName: "人员一",
      personId: "person-1",
      analysis: {
        schemaVersion: 1,
        canonicalPersonId: "person-1",
        payrollParts: {
          salary: "1234.56",
          social: "500",
          housing: "100",
          adjustment: "165.44",
        },
      },
    },
  ];
  const data: MonthlyFinancialAnalysisData = {
    query: { from: "2026-08", to: "2026-08", granularity: "month" },
    generatedAt: "2026-09-02",
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    warnings: [],
    modules: [
      {
        key: "personnel",
        title: "人力成本分析",
        description: "成本分析",
        sourceLabel: "快照",
        updatedAt: null,
        periods: [],
        series: [],
        summaries: [{ key: "total", label: "总成本", amount: "2000" }],
        comparison: [{ key: "person-1", label: "人员一", amount: "2000" }],
        breakdown: [{ key: "salary", label: "工资", amount: "1234.56" }],
        columns: [
          { key: "person", label: "人员", format: "text" },
          { key: "salary", label: "工资", format: "amount" },
          { key: "social", label: "社保", format: "amount" },
          { key: "housing", label: "公积金", format: "amount" },
          { key: "adjustment", label: "调整", format: "amount" },
          { key: "total", label: "总成本", format: "amount" },
        ],
        details: [
          {
            id: "person-1",
            person: "人员一",
            salary: "1234.56",
            social: "500",
            housing: "100",
            adjustment: "165.44",
            total: "2000",
          },
        ],
        warnings: [],
        appliedFilters: [],
      },
    ],
  };

  it("管理员可读分项，总经理主月报响应不附带工资分项", () => {
    expect(protectMonthlyFinancialPayrollMetadata(details, "admin")).toBe(
      details,
    );
    expect(protectMonthlyFinancialPayrollMetadata(details, "super_admin")).toBe(
      details,
    );
    const safe = protectMonthlyFinancialPayrollMetadata(
      details,
      "general_manager",
    );
    expect(safe[0].amount).toBe("2000");
    expect(safe[0].analysis?.payrollParts).toBeUndefined();
    expect(details[0].analysis?.payrollParts?.salary).toBe("1234.56");
  });

  it("总经理分析数据与导出均无敏感四项，成本合计仍可见", () => {
    const safe = protectMonthlyFinancialAnalysis(data, "general_manager");
    expect(safe.modules[0].payrollDetailsVisible).toBe(false);
    expect(safe.modules[0].details[0]).toEqual({
      id: "person-1",
      person: "人员一",
      total: "2000",
    });
    expect(safe.modules[0].summaries[0].amount).toBe("2000");
    expect(JSON.stringify(safe)).not.toContain("1234.56");
    const workbook = XLSX.read(buildMonthlyFinancialAnalysisWorkbook(safe), {
      type: "buffer",
    });
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets["人力成本分析-明细"], { header: 1 }),
    ).toEqual([
      ["人员", "总成本"],
      ["人员一", "2000.00"],
    ]);
    expect(data.modules[0].details[0].salary).toBe("1234.56");
  });

  it("管理员分析保留全部已核对分项", () => {
    const visible = protectMonthlyFinancialAnalysis(data, "admin");
    expect(visible.modules[0].payrollDetailsVisible).toBe(true);
    expect(visible.modules[0].details[0].salary).toBe("1234.56");
  });
});
