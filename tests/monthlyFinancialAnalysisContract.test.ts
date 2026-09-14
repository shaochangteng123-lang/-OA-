/** @jest-environment node */
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import {
  parseMonthlyFinancialAnalysisModule,
  parseMonthlyFinancialAnalysisQuery,
  parseMonthlyFinancialAnalysisVersion,
} from "../server/services/monthlyFinancialAnalysisQuery";
import {
  buildMonthlyFinancialAnalysisWorkbook,
  monthlyFinancialAnalysisVersion,
} from "../server/services/monthlyFinancialAnalysisWorkbook";
import { subtractFinancialAmounts } from "../server/services/monthlyFinancialReport";
import type { MonthlyFinancialAnalysisData } from "../server/types/monthly-financial-analysis";

function fixture(): MonthlyFinancialAnalysisData {
  return {
    query: {
      from: "2026-01",
      to: "2026-08",
      granularity: "quarter",
      partyA: "甲方一",
      personId: "person-1",
    },
    generatedAt: "2026-09-02T08:00:00Z",
    filterOptions: {
      parties: ["甲方一"],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    warnings: [],
    modules: [
      {
        key: "balances",
        title: "账户余额资金台帐",
        description: "期末取值",
        sourceLabel: "月结快照",
        updatedAt: "2026-08-31",
        periods: [
          {
            key: "2026-Q1",
            label: "2026年一季度",
            from: "2026-01",
            to: "2026-03",
          },
        ],
        series: [
          {
            key: "balance",
            label: "账户余额",
            values: ["999999999999999999.123456789012"],
          },
        ],
        summaries: [{ key: "total", label: "期末合计", amount: "2053235.4" }],
        breakdown: [{ key: "general", label: "一般账户", amount: null }],
        comparison: [],
        columns: [
          { key: "description", label: "说明", format: "text" },
          { key: "amount", label: "金额", format: "amount" },
        ],
        details: [
          {
            id: "1",
            description: '=HYPERLINK("危险文本")',
            amount: "999999999999999999.123456789012",
          },
          { id: "2", description: "未知", amount: null },
          { id: "3", description: "整数", amount: "0" },
        ],
        warnings: ["缺少部分月份"],
        appliedFilters: ["时间"],
      },
    ],
  };
}

describe("财务分析查询和导出契约", () => {
  it("接受月季年和独立维度，不混用合同区域与报销范围", () => {
    expect(
      parseMonthlyFinancialAnalysisQuery({
        from: "2026-01",
        to: "2026-12",
        granularity: "year",
        partyA: "甲方",
        contractRegion: "朝阳",
        reimbursementScope: "接待",
        personId: "person-1",
      }),
    ).toEqual({
      from: "2026-01",
      to: "2026-12",
      granularity: "year",
      partyA: "甲方",
      contractRegion: "朝阳",
      reimbursementScope: "接待",
      personId: "person-1",
    });
  });

  it.each([
    { from: "2026-13", to: "2026-12" },
    { from: "2026-02", to: "2026-01" },
    { from: "1900-01", to: "2099-12" },
    { from: "0000-01", to: "2026-12" },
    { from: ["2026-01"], to: "2026-12" },
    { from: "2026-01", to: "2026-12", granularity: "week" },
    { from: "2026-01", to: "2026-12", partyA: { name: "甲方" } },
    { from: "2026-01", to: "2026-12", personId: "x".repeat(151) },
    { from: "2026-01", to: "2026-12", partyA: "甲\n方" },
  ])("拒绝无效或超大查询 %j", (query) => {
    expect(() => parseMonthlyFinancialAnalysisQuery(query)).toThrow();
  });

  it("导出模块与版本均严格校验", () => {
    expect(parseMonthlyFinancialAnalysisModule(undefined)).toBe("all");
    expect(parseMonthlyFinancialAnalysisModule("personnel")).toBe("personnel");
    expect(() => parseMonthlyFinancialAnalysisModule("unknown")).toThrow();
    expect(() => parseMonthlyFinancialAnalysisVersion("bad")).toThrow();
    expect(parseMonthlyFinancialAnalysisVersion("a".repeat(64))).toBe(
      "a".repeat(64),
    );
  });

  it("金额减法支持负期初及负调整额，保持大金额精度", () => {
    expect(subtractFinancialAmounts("5", "-2")).toBe("7");
    expect(subtractFinancialAmounts("-5", "-2")).toBe("-3");
    expect(subtractFinancialAmounts("-0.000000000001", "-0.000000000002")).toBe(
      "0.000000000001",
    );
    expect(subtractFinancialAmounts("999999999999999999.12", "-0.01")).toBe(
      "999999999999999999.13",
    );
  });

  it("版本忽略生成时间但对金额和筛选变化敏感", () => {
    const data = fixture();
    const version = monthlyFinancialAnalysisVersion(data);
    expect(
      monthlyFinancialAnalysisVersion({
        ...data,
        generatedAt: "2026-09-03",
        dataVersion: "other",
      }),
    ).toBe(version);
    expect(
      monthlyFinancialAnalysisVersion({
        ...data,
        query: { ...data.query, personId: "person-2" },
      }),
    ).not.toBe(version);
    data.modules[0].summaries[0].amount = "2053235.41";
    expect(monthlyFinancialAnalysisVersion(data)).not.toBe(version);
  });

  it("导出真实工作簿保留高精度、未知值、筛选及文本公式安全", () => {
    const data = fixture();
    const workbook = XLSX.read(buildMonthlyFinancialAnalysisWorkbook(data), {
      type: "buffer",
    });
    expect(workbook.SheetNames).toEqual([
      "查询说明",
      "账户余额资金台帐-统计",
      "账户余额资金台帐-明细",
    ]);
    const detail = workbook.Sheets["账户余额资金台帐-明细"];
    expect(detail.B2).toMatchObject({
      t: "s",
      v: "999999999999999999.123456789012",
    });
    expect(detail.A2.t).toBe("s");
    expect(detail.A2.f).toBeUndefined();
    expect(detail.B3.v).toBe("未取得数据");
    expect(detail.B4.v).toBe("0.00");
    const summary = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets["账户余额资金台帐-统计"],
      { header: 1 },
    );
    expect(summary).toContainEqual(["期末合计", "2053235.40", ""]);
    const metadata = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets["查询说明"],
      { header: 1 },
    );
    expect(metadata).toContainEqual(["合同甲方", "甲方一"]);
    expect(metadata).toContainEqual(["人员编号", "person-1"]);
  });

  it("前后端分析类型保持同一字段定义", () => {
    const server = fs.readFileSync(
      path.resolve("server/types/monthly-financial-analysis.ts"),
      "utf8",
    );
    const client = fs.readFileSync(
      path.resolve("src/types/monthlyFinancialAnalysis.ts"),
      "utf8",
    );
    expect(client).toBe(server);
  });
});
