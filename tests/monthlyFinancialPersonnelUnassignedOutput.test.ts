/** @jest-environment node */
import * as XLSX from "xlsx";
import { buildMonthlyFinancialAnalysisWorkbook } from "../server/services/monthlyFinancialAnalysisWorkbook";
import type { MonthlyFinancialAnalysisData } from "../server/types/monthly-financial-analysis";

test("未归期报销使用独立导出表，不写入任何月份或年度总额", () => {
  const data: MonthlyFinancialAnalysisData = {
    query: { from: "2026-01", to: "2026-09", granularity: "month" },
    generatedAt: "2026-09-07T00:00:00Z",
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
        description: "测试",
        sourceLabel: "测试",
        updatedAt: null,
        periods: [],
        series: [],
        summaries: [{ key: "knownTotal", label: "期间合计", amount: "100" }],
        breakdown: [],
        comparison: [],
        columns: [{ key: "total", label: "总额", format: "amount" }],
        details: [{ id: "month1", total: "100" }],
        personnelAnnualDetails: [{ id: "year1", total: "100" }],
        warnings: [],
        appliedFilters: [],
        housingCostBreakdown: [
          { key: "rent", label: "租金", amount: "10.01", knownAmount: "10.01" },
          {
            key: "electricity",
            label: "电费",
            amount: null,
            knownAmount: "0.000000000001",
          },
        ],
        personnelUnassignedReimbursements: [
          {
            sourceId: "pending1",
            type: "large",
            amount: "10800.000000000001",
            date: null,
            status: "completed",
            personId: "p1",
            personName: "测试人员",
          },
        ],
      },
    ],
  };
  const result = XLSX.read(
    buildMonthlyFinancialAnalysisWorkbook(data, "personnel"),
    { type: "buffer" },
  );
  const annual = XLSX.utils.sheet_to_json<string[]>(
    result.Sheets["人力成本分析-年度"],
    { header: 1, raw: true },
  );
  expect(annual).toEqual([["总额"], ["100.00"]]);
  const housing = XLSX.utils.sheet_to_json<string[]>(
    result.Sheets["人力成本分析-住房构成"],
    { header: 1, raw: true },
  );
  expect(housing[0][1]).toContain("不与个人费用重复相加");
  expect(housing[0][1]).toContain("跨合同保留旧址历史费用");
  expect(housing[1]).toEqual(["开始月份", "2026-01", "结束月份", "2026-09"]);
  expect(housing[3]).toEqual(["租金", "10.01", "10.01", ""]);
  expect(housing[4]).toEqual(["电费", "未取得数据", "0.000000000001", ""]);
  expect(
    Object.entries(result.Sheets["人力成本分析-住房构成"])
      .filter(([key]) => !key.startsWith("!"))
      .every(([, cell]) => cell.t === "s"),
  ).toBe(true);
  const pending = XLSX.utils.sheet_to_json<string[]>(
    result.Sheets["人力成本分析-未归期报销"],
    { header: 1, raw: true },
  );
  expect(pending[0][1]).toContain("未计入期间或年度成本");
  expect(pending[2]).toEqual([
    "测试人员",
    "大额报销",
    "10800.000000000001",
    "已完成",
    "缺少有效付款日期",
    "pending1",
  ]);
  expect(
    Object.entries(result.Sheets["人力成本分析-未归期报销"])
      .filter(([key]) => !key.startsWith("!"))
      .every(([, cell]) => cell.t === "s"),
  ).toBe(true);
});
