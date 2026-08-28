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
        inflow: "75583.09",
        outflow: "26",
        closing: "75657.09",
      },
      {
        code: "business",
        name: "商务账户",
        opening: "20",
        inflow: "12837.25",
        outflow: "16",
        closing: "12841.25",
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
      generalInterest: "103.69",
      businessInterest: "36.65",
      welfareOneSupplement: "0",
      welfareTwoSupplement: "0",
    },
    expenses: {
      humanCost: "0",
      basicReimbursement: "8",
      largeReimbursement: "0",
      assetAdministration: "0",
      generalBankFee: "18",
      generalOther: "0",
      businessReimbursement: "16",
      businessBankFee: "0",
      welfareOne407: "0",
      welfareOneDrinkingWater: "11",
      welfareOneOffice: "12",
      welfareOneElectricity: "13",
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
  details.push(
    {
      sourceType: "monthly_bank_transaction",
      sourceId: "general-interest",
      occurredOn: "2026-06-21",
      accountCode: "general",
      metric: "general_interest",
      amount: "103.69",
      description: "一般账户利息",
      bankAccountCode: "general",
      electronicReceiptNo: "GENERAL-INTEREST",
      previewUrl:
        "/api/monthly-financial-reports/bank-transactions/general-interest/preview",
    },
    {
      sourceType: "monthly_bank_transaction",
      sourceId: "general-bank-fee",
      occurredOn: "2026-06-26",
      accountCode: "general",
      metric: "general_bank_fee",
      amount: "18",
      description: "一般账户跨行手续费",
      bankAccountCode: "general",
      electronicReceiptNo: "GENERAL-FEE",
      previewUrl:
        "/api/monthly-financial-reports/bank-transactions/general-bank-fee/preview",
    },
    {
      sourceType: "monthly_bank_transaction",
      sourceId: "business-interest",
      occurredOn: "2026-06-21",
      accountCode: "business",
      metric: "business_interest",
      amount: "36.65",
      description: "商务账户利息",
      bankAccountCode: "business",
      electronicReceiptNo: "BUSINESS-INTEREST",
      previewUrl:
        "/api/monthly-financial-reports/bank-transactions/business-interest/preview",
    },
  );
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
    expect(summary["G11"]?.v).toBe(103.69);
    expect(summary["H11"]?.v).toBe(36.65);
    expect(summary["F15"]?.v).toBe(18);
    expect(summary["B14"]?.f).toBe("ROUND(D15+E15+F15+A17,2)");
    expect(summary["B14"]?.v).toBe(26);
    expect(summary["B15"]?.f).toBeUndefined();
    expect(summary["A17"]?.f).toBe("ROUND(SUM(B17:H17),2)");
    expect(summary["A17"]?.v).toBe(8);
    expect(summary["A19"]?.f).toBe("ROUND(SUM(B19:H19),2)");
    expect(summary["A19"]?.v).toBe(16);
    expect(summary["C23"]?.v).toBe(11);
    expect(summary["D23"]?.v).toBe(12);
    expect(summary["E23"]?.v).toBe(13);
    expect(summary["B23"]?.f).toBe("ROUND(SUM(C23:G23),2)");
    expect(summary["A23"]?.f).toBe("ROUND(B23+B25,2)");
    expect(summary["B22"]?.v).toBe("账户一");
    expect(summary["B24"]?.v).toBe("账户二");
    expect(summary["H22"]?.v).toBe("");
    expect(summary["F24"]?.v).toBe("");
    expect(summary["H16"]?.v).toBe("其他2人");
    expect(summary["H17"]?.v).toBe(2);
    expect(summary["H19"]?.v).toBe(4);
    expect(summary["D29"]?.v).toBe(12841.25);
    expect(summary["F29"]?.f).toBe("ROUND(H29+H30,2)");
    expect(summary["H29"]?.v).toBe(3);
    expect(summary["H30"]?.v).toBe(4);
    expect(summary["C28"]?.f).toBe("ROUND(B29+D29+F29,2)");
    expect(summary["C28"]?.v).toBe(88505.34);
    const summaryMerges = (summary["!merges"] || []).map((range) =>
      XLSX.utils.encode_range(range),
    );
    expect(summaryMerges).toEqual(
      expect.arrayContaining([
        "A23:A25",
        "A29:A30",
        "B29:B30",
        "C29:C30",
        "D29:D30",
        "E29:E30",
        "F29:F30",
      ]),
    );
    expect(summaryMerges).not.toEqual(
      expect.arrayContaining(["G29:H30", "G31:H31", "G32:H32"]),
    );
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
    expect(workbookXml).toContain("$A$1:$H$30");

    const automaticRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets["自动来源明细"]!,
    );
    expect(automaticRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          来源类型: "monthly_bank_transaction",
          账户: "general",
          指标: "general_bank_fee",
          金额: 18,
        }),
      ]),
    );
  });

  it("手工明细表只导出当前生效的银行利息手续费行", async () => {
    const report = reportFixture();
    report.manualItems = [
      {
        categoryLabel: "一般账户利息",
        accountCode: "general",
        direction: "income",
        occurredOn: "2026-06-21",
        amount: "999",
        description: "已由银行回单接管的旧手工记录",
        voucherReference: "OLD",
        sourceType: "manual",
        readOnly: false,
        effective: false,
      },
      {
        categoryLabel: "一般账户利息",
        accountCode: "general",
        direction: "income",
        occurredOn: "2026-06-21",
        amount: "103.69",
        description: "一般账户利息",
        voucherReference: "GENERAL-INTEREST",
        sourceType: "monthly_bank_transaction",
        readOnly: true,
        effective: true,
      },
    ];
    const buffer = await buildMonthlyFinancialWorkbook(
      report,
      automaticFixture(),
    );
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets["手工项目明细"]!,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        分类: "一般账户利息",
        金额: 103.69,
        凭证引用: "GENERAL-INTEREST",
      }),
    );
  });
});
