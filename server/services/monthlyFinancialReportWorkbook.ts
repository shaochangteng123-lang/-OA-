import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  addFinancialAmounts,
  previousFinancialMonth,
} from "./monthlyFinancialReport.js";
import type {
  FinancialAccountCode,
  MonthlyFinancialAutomaticSnapshot,
} from "../types/monthly-financial-report.js";

const TEMPLATE_FILE_NAME = "monthly-financial-report-template.xlsx";
const SUMMARY_SHEET_PATH = "xl/worksheets/sheet1.xml";
const MANUAL_DETAIL_SHEET_PATH = "xl/worksheets/sheet2.xml";
const AUTOMATIC_DETAIL_SHEET_PATH = "xl/worksheets/sheet3.xml";
const VALIDATION_SHEET_PATH = "xl/worksheets/sheet4.xml";
const PERSON_COLUMN_COUNT = 7;

interface WorkbookAccount {
  code: FinancialAccountCode;
  name: string;
  opening: string;
  inflow: string;
  outflow: string;
  closing: string;
}

interface WorkbookManualItem {
  categoryLabel: string;
  accountCode: FinancialAccountCode;
  direction: string;
  occurredOn: string;
  amount: string;
  description?: string | null;
  voucherReference?: string | null;
}

export interface MonthlyFinancialWorkbookReport {
  month: string;
  status: string;
  version: number;
  accounts: WorkbookAccount[];
  income: Record<string, string>;
  expenses: Record<string, string>;
  manualItems: WorkbookManualItem[];
  validations: {
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
}

interface PersonAmounts {
  key: string;
  name: string;
  administrative: string;
  business: string;
}

interface XmlCellValue {
  type: "text" | "amount";
  value: string;
}

function locateTemplate(): string {
  const candidates = [
    path.resolve(process.cwd(), "dist/server/assets", TEMPLATE_FILE_NAME),
    path.resolve(process.cwd(), "server/assets", TEMPLATE_FILE_NAME),
  ];
  const templatePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!templatePath) {
    throw new Error("月度财务报表导出模板缺失，请联系系统管理员");
  }
  return templatePath;
}

function escapeXml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function amountXmlValue(value: string | undefined): string {
  const amount = String(value || "0").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(amount)) {
    throw new Error("月度财务报表导出金额无效");
  }
  return amount;
}

function roundCurrencyAmount(value: string): string {
  const match = amountXmlValue(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("月度财务报表导出金额无效");
  const negative = match[1] === "-";
  const fraction = match[3] || "";
  let cents = BigInt(match[2]) * 100n + BigInt(`${fraction}00`.slice(0, 2));
  if (Number(fraction[2] || "0") >= 5) cents += 1n;
  const absoluteText = cents.toString().padStart(3, "0");
  const integerPart = absoluteText.slice(0, -2);
  const fractionPart = absoluteText.slice(-2);
  return `${negative && cents !== 0n ? "-" : ""}${integerPart}.${fractionPart}`;
}

function cellPattern(address: string): RegExp {
  return new RegExp(
    `<(?:[A-Za-z0-9_]+:)?c\\b[^>]*\\br="${address}"[^>]*>[\\s\\S]*?<\\/(?:[A-Za-z0-9_]+:)?c>`,
  );
}

function replaceCell(
  xml: string,
  address: string,
  content: (prefix: string) => string,
): string {
  const pattern = cellPattern(address);
  const current = xml.match(pattern)?.[0];
  if (!current) throw new Error(`月度财务报表模板缺少单元格 ${address}`);
  const opening = current.match(/^<([A-Za-z0-9_]+:)?c\b([^>]*)>/);
  if (!opening) throw new Error(`月度财务报表模板单元格 ${address} 无效`);
  const prefix = opening[1] || "";
  const attributes = opening[2].replace(/\s+t="[^"]*"/g, "");
  return xml.replace(
    pattern,
    `<${prefix}c${attributes}${content(prefix)}</${prefix}c>`,
  );
}

function setText(xml: string, address: string, value: unknown): string {
  return replaceCell(
    xml,
    address,
    (prefix) =>
      ` t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${escapeXml(value)}</${prefix}t></${prefix}is>`,
  );
}

function setAmount(
  xml: string,
  address: string,
  value: string | undefined,
): string {
  return replaceCell(
    xml,
    address,
    (prefix) => ` t="n"><${prefix}v>${amountXmlValue(value)}</${prefix}v>`,
  );
}

function setFormula(
  xml: string,
  address: string,
  formula: string,
  cachedValue: string,
): string {
  return replaceCell(
    xml,
    address,
    (prefix) =>
      ` t="n"><${prefix}f>${escapeXml(formula)}</${prefix}f><${prefix}v>${roundCurrencyAmount(cachedValue)}</${prefix}v>`,
  );
}

function accountByCode(
  report: MonthlyFinancialWorkbookReport,
  code: FinancialAccountCode,
): WorkbookAccount {
  const account = report.accounts.find((item) => item.code === code);
  if (!account) throw new Error(`月度财务报表缺少${code}账户数据`);
  return account;
}

function addAmount(left: string, right: string): string {
  return addFinancialAmounts(left || "0", right || "0");
}

function buildPersonAmounts(
  details: MonthlyFinancialAutomaticSnapshot["details"],
): PersonAmounts[] {
  const relevantMetrics = new Set([
    "basic_reimbursement",
    "large_reimbursement",
    "business_reimbursement",
  ]);
  const people = new Map<string, PersonAmounts>();
  for (const detail of details) {
    if (!relevantMetrics.has(detail.metric)) continue;
    const name =
      String(detail.personName || "未归属人员").trim() || "未归属人员";
    const key = detail.personId
      ? `person:${detail.personId}`
      : detail.personName
        ? `legacy-name:${name}`
        : `legacy-source:${detail.sourceId}`;
    const person = people.get(key) || {
      key,
      name,
      administrative: "0",
      business: "0",
    };
    if (
      detail.metric === "basic_reimbursement" ||
      detail.metric === "large_reimbursement"
    ) {
      person.administrative = addAmount(person.administrative, detail.amount);
    } else {
      person.business = addAmount(person.business, detail.amount);
    }
    people.set(key, person);
  }
  return [...people.values()];
}

function compactPersonAmounts(people: PersonAmounts[]): PersonAmounts[] {
  if (people.length <= PERSON_COLUMN_COUNT) return people;
  const visible = people.slice(0, PERSON_COLUMN_COUNT - 1);
  const overflow = people.slice(PERSON_COLUMN_COUNT - 1);
  visible.push({
    key: "overflow",
    name: `其他${overflow.length}人`,
    administrative: addFinancialAmounts(
      ...overflow.map((item) => item.administrative),
    ),
    business: addFinancialAmounts(...overflow.map((item) => item.business)),
  });
  return visible;
}

function populateSummaryXml(
  originalXml: string,
  report: MonthlyFinancialWorkbookReport,
  automatic: MonthlyFinancialAutomaticSnapshot,
): string {
  let xml = originalXml;
  const [year, monthNumber] = report.month.split("-").map(Number);
  const previousMonth = previousFinancialMonth(report.month);
  const previousMonthNumber = Number(previousMonth.slice(5, 7));
  const general = accountByCode(report, "general");
  const business = accountByCode(report, "business");
  const welfareOne = accountByCode(report, "welfare_one");
  const welfareTwo = accountByCode(report, "welfare_two");
  const openingTotal = addFinancialAmounts(
    general.opening,
    business.opening,
    welfareOne.opening,
    welfareTwo.opening,
  );
  const welfareOpening = addFinancialAmounts(
    welfareOne.opening,
    welfareTwo.opening,
  );
  const closingTotal = addFinancialAmounts(
    general.closing,
    business.closing,
    welfareOne.closing,
    welfareTwo.closing,
  );
  const welfareClosing = addFinancialAmounts(
    welfareOne.closing,
    welfareTwo.closing,
  );
  const administrativeExpense = addFinancialAmounts(
    report.expenses.humanCost || "0",
    report.expenses.basicReimbursement || "0",
    report.expenses.largeReimbursement || "0",
    report.expenses.generalBankFee || "0",
    report.expenses.generalOther || "0",
  );
  const administrativeReimbursement = addFinancialAmounts(
    report.expenses.basicReimbursement || "0",
    report.expenses.largeReimbursement || "0",
  );
  const welfareOneExpense = addFinancialAmounts(
    report.expenses.welfareOne407 || "0",
    report.expenses.welfareOne407Ai || "0",
    report.expenses.welfareOne8hAi || "0",
  );
  const welfareTwoExpense = addFinancialAmounts(
    report.expenses.welfareTwoRefreshment || "0",
    report.expenses.welfareTwoTeamBuilding || "0",
    report.expenses.welfareTwoPhysicalExam || "0",
  );
  const welfareExpense = addFinancialAmounts(
    welfareOneExpense,
    welfareTwoExpense,
  );

  for (const [address, value] of [
    ["A1", "月度结算"],
    ["A2", `${year}年${String(monthNumber).padStart(2, "0")}月`],
    ["A4", `上月度（${previousMonthNumber}月）-结算`],
    ["A9", `${monthNumber}月-收入汇总`],
    ["A13", `${monthNumber}月-支出汇总`],
    ["A21", `${monthNumber}月-福利金支出`],
    ["A27", `${monthNumber}月-结算`],
  ]) {
    xml = setText(xml, address, value);
  }

  for (const [address, value] of [
    ["A7", general.opening],
    ["C7", business.opening],
    ["G7", welfareOne.opening],
    ["H7", welfareTwo.opening],
    ["A11", report.income.mainReceipt],
    ["C11", report.income.tax],
    ["D11", report.income.marketingReserve],
    ["E11", report.income.businessCost],
    ["F11", report.income.accountingBase],
    ["G11", report.income.generalInterest],
    ["H11", report.income.businessInterest],
    ["D15", report.expenses.humanCost],
    ["E15", report.expenses.generalOther],
    ["F15", report.expenses.generalBankFee],
    ["G15", report.expenses.businessBankFee],
    ["H15", report.expenses.assetAdministration],
    ["C23", report.expenses.welfareOne407],
    ["D23", report.expenses.welfareOne407Ai],
    ["E23", report.expenses.welfareOne8hAi],
    ["F23", report.income.welfareOneSupplement],
    ["C25", report.expenses.welfareTwoRefreshment],
    ["D25", report.expenses.welfareTwoTeamBuilding],
    ["E25", report.expenses.welfareTwoPhysicalExam],
    ["F25", report.income.welfareTwoSupplement],
  ] as Array<[string, string | undefined]>) {
    xml = setAmount(xml, address, value);
  }

  const people = compactPersonAmounts(buildPersonAmounts(automatic.details));
  const columns = ["B", "C", "D", "E", "F", "G", "H"];
  columns.forEach((column, index) => {
    const person = people[index];
    xml = setText(xml, `${column}16`, person?.name || "-");
    xml = setAmount(xml, `${column}17`, person?.administrative || "0");
    xml = setText(xml, `${column}18`, person?.name || "-");
    xml = setAmount(xml, `${column}19`, person?.business || "0");
  });

  for (const [address, formula, cachedValue] of [
    ["C5", "ROUND(A7+C7+G7+H7,2)", openingTotal],
    ["E7", "ROUND(G7+H7,2)", welfareOpening],
    ["A17", "ROUND(SUM(B17:H17),2)", administrativeReimbursement],
    [
      "A19",
      "ROUND(SUM(B19:H19),2)",
      report.expenses.businessReimbursement || "0",
    ],
    ["B14", "ROUND(D15+E15+F15+A17,2)", administrativeExpense],
    ["A23", "ROUND(SUM(C23:E23)+SUM(C25:E25),2)", welfareExpense],
    ["B23", "ROUND(SUM(C23:E23),2)", welfareOneExpense],
    ["B25", "ROUND(SUM(C25:E25),2)", welfareTwoExpense],
    ["B29", "ROUND(A7+F11+G11-D15-E15-F15-H15-A17,2)", general.closing],
    ["E29", "ROUND(C7+D11+E11+H11-G15-A19,2)", business.closing],
    ["G31", "ROUND(G7+F23-C23-D23-E23,2)", welfareOne.closing],
    ["G32", "ROUND(H7+F25-C25-D25-E25,2)", welfareTwo.closing],
    ["G29", "ROUND(G31+G32,2)", welfareClosing],
    ["C28", "ROUND(B29+E29+G31+G32,2)", closingTotal],
  ]) {
    xml = setFormula(xml, address, formula, cachedValue);
  }

  if (!/<(?:[A-Za-z0-9_]+:)?pageSetup\b/.test(xml)) {
    xml = xml.replace(
      /(<(?:[A-Za-z0-9_]+:)?pageMargins\b[^>]*\/>)/,
      '$1<x:pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/>',
    );
  }
  return xml;
}

function extractStyleId(xml: string, address: string): string {
  const current = xml.match(cellPattern(address))?.[0];
  const styleId = current?.match(/\bs="([^"]+)"/)?.[1];
  if (!styleId) throw new Error(`月度财务报表模板缺少 ${address} 样式`);
  return styleId;
}

function worksheetPrefix(xml: string): string {
  return xml.match(/<([A-Za-z0-9_]+:)?worksheet\b/)?.[1] || "";
}

function buildDetailCellXml(
  prefix: string,
  address: string,
  cell: XmlCellValue,
  styleId: string,
): string {
  if (cell.type === "amount") {
    return `<${prefix}c r="${address}" s="${styleId}" t="n"><${prefix}v>${amountXmlValue(cell.value)}</${prefix}v></${prefix}c>`;
  }
  return `<${prefix}c r="${address}" s="${styleId}" t="inlineStr"><${prefix}is><${prefix}t xml:space="preserve">${escapeXml(cell.value)}</${prefix}t></${prefix}is></${prefix}c>`;
}

function replaceDetailSheetData(input: {
  xml: string;
  rows: XmlCellValue[][];
  columnCount: number;
  textStyleId: string;
  amountStyleId: string;
}): string {
  let { xml } = input;
  const prefix = worksheetPrefix(xml);
  const headerRow = xml.match(
    /<(?:[A-Za-z0-9_]+:)?row\b[^>]*\br="1"[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?row>/,
  )?.[0];
  if (!headerRow) throw new Error("月度财务报表明细模板缺少标题行");
  const dataRows = input.rows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const cells = row
        .map((cell, columnIndex) =>
          buildDetailCellXml(
            prefix,
            `${String.fromCharCode(65 + columnIndex)}${rowNumber}`,
            cell,
            cell.type === "amount" ? input.amountStyleId : input.textStyleId,
          ),
        )
        .join("");
      return `<${prefix}row r="${rowNumber}">${cells}</${prefix}row>`;
    })
    .join("");
  xml = xml.replace(
    /<(?:[A-Za-z0-9_]+:)?sheetData\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?sheetData>/,
    `<${prefix}sheetData>${headerRow}${dataRows}</${prefix}sheetData>`,
  );
  const lastColumn = String.fromCharCode(64 + input.columnCount);
  const lastRow = Math.max(1, input.rows.length + 1);
  const range = `A1:${lastColumn}${lastRow}`;
  if (/<(?:[A-Za-z0-9_]+:)?dimension\b/.test(xml)) {
    xml = xml.replace(
      /<(?:[A-Za-z0-9_]+:)?dimension\b[^>]*\/>/,
      `<${prefix}dimension ref="${range}"/>`,
    );
  } else {
    xml = xml.replace(
      /(<(?:[A-Za-z0-9_]+:)?worksheet\b[^>]*>)/,
      `$1<${prefix}dimension ref="${range}"/>`,
    );
  }
  if (/<(?:[A-Za-z0-9_]+:)?autoFilter\b/.test(xml)) {
    xml = xml.replace(
      /<(?:[A-Za-z0-9_]+:)?autoFilter\b[^>]*\/>/,
      `<${prefix}autoFilter ref="${range}"/>`,
    );
  } else {
    xml = xml.replace(
      /(<\/(?:[A-Za-z0-9_]+:)?sheetData>)/,
      `$1<${prefix}autoFilter ref="${range}"/>`,
    );
  }
  return xml;
}

function textCell(value: unknown): XmlCellValue {
  return { type: "text", value: String(value ?? "") };
}

function amountCell(value: string): XmlCellValue {
  return { type: "amount", value: amountXmlValue(value) };
}

function populateWorkbookMetadata(originalXml: string): string {
  let xml = originalXml;
  const prefix = xml.match(/<([A-Za-z0-9_]+:)?workbook\b/)?.[1] || "";
  if (!/<(?:[A-Za-z0-9_]+:)?definedNames\b/.test(xml)) {
    xml = xml.replace(
      /(<\/(?:[A-Za-z0-9_]+:)?workbook>)/,
      (closingTag) =>
        `<${prefix}definedNames><${prefix}definedName name="_xlnm.Print_Area" localSheetId="0">&apos;月度结算&apos;!$A$1:$H$32</${prefix}definedName></${prefix}definedNames><${prefix}calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>${closingTag}`,
    );
  }
  return xml;
}

async function readZipText(zip: JSZip, filePath: string): Promise<string> {
  const file = zip.file(filePath);
  if (!file) throw new Error(`月度财务报表模板缺少 ${filePath}`);
  return file.async("string");
}

export async function buildMonthlyFinancialWorkbook(
  report: MonthlyFinancialWorkbookReport,
  automatic: MonthlyFinancialAutomaticSnapshot,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(fs.readFileSync(locateTemplate()));
  const summaryXml = await readZipText(zip, SUMMARY_SHEET_PATH);
  const textStyleId = extractStyleId(summaryXml, "A17");
  const amountStyleId = extractStyleId(summaryXml, "B17");

  zip.file(
    SUMMARY_SHEET_PATH,
    populateSummaryXml(summaryXml, report, automatic),
  );

  zip.file(
    MANUAL_DETAIL_SHEET_PATH,
    replaceDetailSheetData({
      xml: await readZipText(zip, MANUAL_DETAIL_SHEET_PATH),
      textStyleId,
      amountStyleId,
      columnCount: 7,
      rows: report.manualItems.map((item) => [
        textCell(item.occurredOn),
        textCell(item.categoryLabel),
        textCell(item.accountCode),
        textCell(item.direction),
        amountCell(item.amount),
        textCell(item.description),
        textCell(item.voucherReference),
      ]),
    }),
  );

  zip.file(
    AUTOMATIC_DETAIL_SHEET_PATH,
    replaceDetailSheetData({
      xml: await readZipText(zip, AUTOMATIC_DETAIL_SHEET_PATH),
      textStyleId,
      amountStyleId,
      columnCount: 9,
      rows: automatic.details.map((item) => [
        textCell(item.sourceType),
        textCell(item.sourceId),
        textCell(item.occurredOn),
        textCell(item.accountCode),
        textCell(item.metric),
        amountCell(item.amount),
        textCell(item.personId),
        textCell(item.personName),
        textCell(item.description),
      ]),
    }),
  );

  zip.file(
    VALIDATION_SHEET_PATH,
    replaceDetailSheetData({
      xml: await readZipText(zip, VALIDATION_SHEET_PATH),
      textStyleId,
      amountStyleId,
      columnCount: 3,
      rows: [
        ...report.validations.blockers.map((issue) => [
          textCell("阻断"),
          textCell(issue.code),
          textCell(issue.message),
        ]),
        ...report.validations.warnings.map((issue) => [
          textCell("警告"),
          textCell(issue.code),
          textCell(issue.message),
        ]),
      ],
    }),
  );

  zip.file(
    "xl/workbook.xml",
    populateWorkbookMetadata(await readZipText(zip, "xl/workbook.xml")),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
