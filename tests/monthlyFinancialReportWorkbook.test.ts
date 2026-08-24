import JSZip from "jszip";
import * as XLSX from "xlsx";
import {
  buildMonthlyFinancialWorkbook,
  type MonthlyFinancialWorkbookReport,
} from "../server/services/monthlyFinancialReportWorkbook";
import type { MonthlyFinancialAutomaticSnapshot } from "../server/types/monthly-financial-report";

function reportFixture(): MonthlyFinancialWorkbookReport {
  return {
    month: "2026-08",
    status: "draft",
    version: 1,
    accounts: [
      {
        code: "general",
        name: "一般账户",
        opening: "100",
        inflow: "75479.4",
        outflow: "8",
        closing: "75571.4",
      },
      {
        code: "business",
        name: "商务账户",
        opening: "20",
        inflow: "12800.6",
        outflow: "16",
        closing: "12804.6",
      },
      {
        code: "welfare_one",
        name: "福利账户一",
        opening: "3",
        inflow: "0",
        outflow: "0",
        closing: "3",
      },
      {
        code: "welfare_two",
        name: "福利账户二",
        opening: "4",
        inflow: "0",
        outflow: "0",
        closing: "4",
      },
    ],
    income: {
      mainReceipt: "100000",
      tax: "11720",
      marketingReserve: "4414",
      businessCost: "8386.6",
      accountingBase: "75479.4",
      generalInterest: "0",
      businessInterest: "0",
      welfareOneSupplement: "0",
      welfareTwoSupplement: "0",
    },
    expenses: {
      humanCost: "0",
      basicReimbursement: "8",
      largeReimbursement: "0",
      assetAdministration: "0",
      generalBankFee: "0",
      generalOther: "0",
      businessReimbursement: "16",
      businessBankFee: "0",
      welfareOne407: "0",
      welfareOne407Ai: "0",
      welfareOne8hAi: "0",
      welfareTwoRefreshment: "0",
      welfareTwoTeamBuilding: "0",
      welfareTwoPhysicalExam: "0",
    },
    manualItems: [],
    validations: { blockers: [], warnings: [] },
  };
}

function automaticFixture(): MonthlyFinancialAutomaticSnapshot {
  const details: MonthlyFinancialAutomaticSnapshot["details"] = [];
  for (let index = 1; index <= 8; index += 1) {
    details.push(
      {
        sourceType: "reimbursement",
        sourceId: `basic-${index}`,
        occurredOn: "2026-08-05",
        accountCode: "general",
        metric: "basic_reimbursement",
        amount: "1",
        description: "基础报销",
        personId: `person-${index}`,
        personName: `人员${index}`,
      },
      {
        sourceType: "reimbursement",
        sourceId: `business-${index}`,
        occurredOn: "2026-08-05",
        accountCode: "business",
        metric: "business_reimbursement",
        amount: "2",
        description: "商务报销",
        personId: `person-${index}`,
        personName: `人员${index}`,
      },
    );
  }
  return {
    income: {
      mainBusinessReceipts: "100000",
      tax: "11720",
      marketingReserve: "4414",
      businessCost: "8386.6",
      accountingBase: "75479.4",
    },
    expenses: {
      humanCost: "0",
      basicReimbursement: "8",
      largeReimbursement: "0",
      businessReimbursement: "16",
      assetAdministration: "0",
    },
    sources: [],
    details,
    generatedAt: "2026-08-24T00:00:00.000Z",
  };
}

describe("月度财务报表模板工作簿", () => {
  it("实际到账保持十万元，超过七人的明细汇总到其他人员且公式可追溯", async () => {
    const buffer = await buildMonthlyFinancialWorkbook(
      reportFixture(),
      automaticFixture(),
    );
    const workbook = XLSX.read(buffer, { type: "buffer", cellStyles: true });
    const summary = workbook.Sheets["月度结算"]!;

    expect(summary["A11"]?.v).toBe(100000);
    expect(summary["B14"]?.f).toBe("ROUND(D15+E15+F15+A17,2)");
    expect(summary["B14"]?.v).toBe(8);
    expect(summary["B15"]?.f).toBeUndefined();
    expect(summary["A17"]?.f).toBe("ROUND(SUM(B17:H17),2)");
    expect(summary["A17"]?.v).toBe(8);
    expect(summary["A19"]?.f).toBe("ROUND(SUM(B19:H19),2)");
    expect(summary["A19"]?.v).toBe(16);
    expect(summary["H16"]?.v).toBe("其他2人");
    expect(summary["H17"]?.v).toBe(2);
    expect(summary["H19"]?.v).toBe(4);
    expect(summary["C28"]?.f).toBe("ROUND(B29+E29+G31+G32,2)");
    expect(summary["C28"]?.v).toBe(88383);
    expect(summary["A4"]?.s).toBeDefined();

    const zip = await JSZip.loadAsync(buffer);
    const summaryXml = await zip
      .file("xl/worksheets/sheet1.xml")!
      .async("string");
    const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
    expect(summaryXml).toContain(
      '<x:pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/>',
    );
    expect(workbookXml).toContain("_xlnm.Print_Area");
    expect(workbookXml).toContain("$A$1:$H$32");
  });
});
