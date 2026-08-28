import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import {
  analyzePageXml,
  recognizeBankReceiptImage,
  splitImage,
  type BankReceiptOcrResult,
} from "./bankReceiptProcessor.js";
import { extractPaymentProofPartyAccounts } from "./paymentProofOcr.js";

const execFileAsync = promisify(execFile);
const MAX_MONTHLY_BANK_PAGES = 120;
const MAX_MONTHLY_BANK_PAGE_EDGE_POINTS = 2_000;

export type MonthlyBankAccountCode = "basic" | "general" | "business";
export type MonthlyBankDirection = "inflow" | "outflow" | "unknown";
export type MonthlyBankTransactionCategory =
  | "interest"
  | "bank_fee"
  | "basic_reimbursement"
  | "large_reimbursement"
  | "business_reimbursement"
  | "salary"
  | "main_income"
  | "asset_expense"
  | "internal_transfer"
  | "ignored"
  | "unclassified";

export const MONTHLY_BANK_ACCOUNTS: Record<
  MonthlyBankAccountCode,
  { label: string; accountNumber: string }
> = {
  business: {
    label: "商务账户",
    accountNumber: "321240100100245908",
  },
  general: {
    label: "一般账户",
    accountNumber: "0200303519000018418",
  },
  basic: {
    label: "基本账户",
    accountNumber: "0200049609201258271",
  },
};

export interface MonthlyBankRecognizedTransaction {
  pageNo: number;
  position: "full" | "top" | "bottom";
  previewPath: string;
  electronicReceiptNo: string;
  normalizedElectronicReceiptNo: string;
  transactionDate: string;
  transactionMonth: string;
  amount: number;
  payer: string;
  payerAccount: string;
  payee: string;
  payeeAccount: string;
  remark: string;
  direction: MonthlyBankDirection;
  category: MonthlyBankTransactionCategory;
  isInternalTransfer: boolean;
  includeInReport: boolean;
  recognitionStatus: "recognized" | "review_required" | "ignored";
  warnings: string[];
  rawTextHash: string;
}

export interface MonthlyBankFileAnalysis {
  originalName: string;
  fileHash: string;
  accountCode: MonthlyBankAccountCode | null;
  accountNumber: string | null;
  filenameAccountHint: MonthlyBankAccountCode | null;
  pageCount: number;
  skippedBlankPages: number[];
  transactionMonths: string[];
  requiresMixedMonthConfirmation: boolean;
  warnings: string[];
  transactions: MonthlyBankRecognizedTransaction[];
}

export interface AnalyzeMonthlyBankFileInput {
  filePath: string;
  originalName: string;
  reportMonth: string;
  outputDir: string;
  maxPageCount?: number;
}

interface ReceiptEvidence {
  pageNo: number;
  position: "full" | "top" | "bottom";
  previewPath: string;
  payer: string;
  payerAccount: string;
  payee: string;
  payeeAccount: string;
  amount: number;
  remark: string;
  proofNo: string;
  transactionDate: string;
  transactionDateCandidates: string[];
  rawText: string;
  sourceSide: "payer" | "payee" | "unknown";
}

export function normalizeMonthlyBankAccount(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^0-9]/g, "");
}

export function normalizeMonthlyBankReceiptNo(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export async function calculateMonthlyBankFileHash(
  filePath: string,
): Promise<string> {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function inferFilenameAccountHint(
  originalName: string,
): MonthlyBankAccountCode | null {
  const name = originalName.normalize("NFKC").replace(/\s+/g, "");
  if (name.includes("商务")) return "business";
  if (name.includes("一般")) return "general";
  if (name.includes("基本")) return "basic";
  return null;
}

function normalizeDate(
  yearText: string,
  monthText: string,
  dayText: string,
): string {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractStructuredTransactionDate(text: string): string {
  const match = text.match(
    /^\s*交易日期\s*[：:]\s*((?:19|20)\d{2})\s*(?:年|[-/.])?\s*(\d{1,2})\s*(?:月|[-/.])?\s*(\d{1,2})/mu,
  );
  return match ? normalizeDate(match[1], match[2], match[3]) : "";
}

function extractStructuredValue(text: string, pattern: RegExp): string {
  return String(text.match(pattern)?.[1] || "")
    .normalize("NFKC")
    .trim();
}

function extractStructuredAccount(text: string, label: string): string {
  const line = text.match(
    new RegExp(`${label}\\s*[：:]\\s*([^\\n\\r]+)`, "u"),
  )?.[1];
  const account = line?.match(/\d(?:[ \t]*\d){11,24}/u)?.[0] || "";
  return normalizeMonthlyBankAccount(account);
}

function inferReceiptSourceSide(text: string): ReceiptEvidence["sourceSide"] {
  const compactText = String(text || "")
    .normalize("NFKC")
    .replace(/\s+/gu, "");
  const payerSide = /付款(?:电子)?回单|付款凭证|借方回单|借记通知/u.test(
    compactText,
  );
  const payeeSide =
    /收款(?:电子)?回单|收款凭证|贷方回单|入账回单|入账通知/u.test(compactText);
  if (payerSide === payeeSide) return "unknown";
  return payerSide ? "payer" : "payee";
}

function structuredReceiptSections(text: string): Array<{
  text: string;
  sourceSide: ReceiptEvidence["sourceSide"];
}> {
  const matches = [...text.matchAll(/回单编号\s*[：:]\s*[A-Za-z0-9-]+/gu)];
  if (!matches.length) {
    return text.trim()
      ? [{ text: text.trim(), sourceSide: inferReceiptSourceSide(text) }]
      : [];
  }
  const pageSide = inferReceiptSourceSide(text);
  return matches.map((match, index) => {
    const contextStart =
      index === 0
        ? 0
        : (matches[index - 1]!.index || 0) + matches[index - 1]![0].length;
    const headerContext = text.slice(contextStart, match.index);
    const sectionSide = inferReceiptSourceSide(headerContext);
    return {
      text: text
        .slice(match.index, matches[index + 1]?.index ?? text.length)
        .trim(),
      sourceSide: sectionSide === "unknown" ? pageSide : sectionSide,
    };
  });
}

function parseStructuredReceipt(
  text: string,
  pageNo: number,
  position: "full" | "top" | "bottom",
  previewPath: string,
  sourceSide: ReceiptEvidence["sourceSide"],
): ReceiptEvidence {
  const payerAccount = extractStructuredAccount(text, "付款账号");
  const payeeAccount = extractStructuredAccount(text, "收款账号");
  const amountText = extractStructuredValue(
    text,
    /金额\s*[（(]小写[）)]\s*[：:]\s*(?:CNY|RMB|[¥￥])?\s*([\d,，]+(?:\.\d{1,2})?)/u,
  );
  const purpose = extractStructuredValue(text, /用途\s*[：:]\s*([^\n\r]+)/u);
  const note = extractStructuredValue(text, /附注\s*[：:]\s*([^\n\r]+)/u);
  const rawDate = extractStructuredTransactionDate(text);
  return {
    pageNo,
    position,
    previewPath,
    payer:
      extractStructuredValue(text, /付款名称\s*[：:]\s*([^\n\r]+)/u) ||
      extractStructuredValue(text, /付款银行\s*[：:]\s*([^\n\r]+)/u),
    payerAccount,
    payee:
      extractStructuredValue(text, /收款名称\s*[：:]\s*([^\n\r]+)/u) ||
      extractStructuredValue(text, /收款单位\s*[：:]\s*([^\n\r]+)/u),
    payeeAccount,
    amount: Number(amountText.replace(/[,，]/g, "")) || 0,
    remark: [purpose, note].filter(Boolean).join("；"),
    proofNo: extractStructuredValue(
      text,
      /回单编号\s*[：:]\s*([A-Za-z0-9-]+)/u,
    ),
    transactionDate: rawDate,
    transactionDateCandidates: rawDate ? [rawDate] : [],
    rawText: text,
    sourceSide,
  };
}

async function extractPageText(
  filePath: string,
  pageNo: number,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "pdftotext",
      [
        "-f",
        String(pageNo),
        "-l",
        String(pageNo),
        "-layout",
        "-enc",
        "UTF-8",
        filePath,
        "-",
      ],
      {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    return String(stdout || "").trim();
  } catch {
    return "";
  }
}

async function isVisuallyBlank(imagePath: string): Promise<boolean> {
  const { data, info } = await sharp(imagePath)
    .greyscale()
    .resize({ width: 360, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let nonWhitePixels = 0;
  for (const value of data) {
    if (value < 244) nonWhitePixels += 1;
  }
  return nonWhitePixels / Math.max(1, info.width * info.height) < 0.0015;
}

async function renderPdfPages(
  filePath: string,
  outputDir: string,
): Promise<Map<number, string>> {
  fs.mkdirSync(outputDir, { recursive: true });
  const prefix = path.join(outputDir, "page");
  try {
    await execFileAsync("pdftoppm", ["-r", "160", "-jpeg", filePath, prefix], {
      timeout: 300_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch {
    throw new Error("银行回单页面转换失败，文件可能损坏或加密");
  }
  const result = new Map<number, string>();
  for (const fileName of fs.readdirSync(outputDir)) {
    const match = fileName.match(/^page-(\d+)\.jpg$/u);
    if (match) result.set(Number(match[1]), path.join(outputDir, fileName));
  }
  return result;
}

function toReceiptEvidence(
  result: BankReceiptOcrResult,
  pageNo: number,
  position: "full" | "top" | "bottom",
  previewPath: string,
): ReceiptEvidence {
  const transactionDateCandidates = extractMonthlyBankTransactionDates(
    result.rawText,
  );
  const structuredAccounts = extractPaymentProofPartyAccounts(result.rawText);
  const ticketAmount = extractUniqueCurrencyTicketAmount(result.rawText);
  return {
    pageNo,
    position,
    previewPath,
    payer: result.payer,
    payerAccount: normalizeMonthlyBankAccount(
      structuredAccounts.payerAccount || result.payerAccount,
    ),
    payee: result.payee,
    payeeAccount: normalizeMonthlyBankAccount(
      structuredAccounts.payeeAccount || result.payeeAccount,
    ),
    amount: ticketAmount ?? result.amount,
    remark: result.remark,
    proofNo: result.proofNo,
    transactionDate: transactionDateCandidates[0] || "",
    transactionDateCandidates,
    rawText: result.rawText,
    sourceSide: inferReceiptSourceSide(result.rawText),
  };
}

function extractUniqueCurrencyTicketAmount(text: string): number | null {
  const normalized = text.normalize("NFKC");
  const compact = normalized.replace(/\s+/g, "");
  const hasCompleteSmallAmountLabel =
    /金额[（(]?小写[）)]?[：:]?(?:(?:CNY|RMB|¥)|\d)/iu.test(compact) ||
    /金额(?![（(]?大写)[：:](?:(?:CNY|RMB|¥)|\d)/iu.test(compact);
  const hasBrokenAmountLabel =
    /(?:^|[\r\n])\s*额\s*[：:]?\s*(?=¥|$|[\r\n])/mu.test(normalized);
  const hasStandaloneAmountLabel =
    /(?:^|[\r\n])\s*金额\s*[：:]?\s*(?:[\r\n]|$)/mu.test(normalized);
  if (
    hasCompleteSmallAmountLabel ||
    (!hasBrokenAmountLabel && !hasStandaloneAmountLabel)
  ) {
    return null;
  }

  const matches = [
    ...normalized.matchAll(
      /¥\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s*元(?![\d.])/gu,
    ),
  ];
  if (matches.length !== 1 || !matches[0]?.[1]) return null;

  const [yuanText, centText] = matches[0][1].replace(/,/g, "").split(".");
  if (!yuanText || !centText || yuanText.length > 14) return null;
  const cents = BigInt(yuanText) * 100n + BigInt(centText);
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(cents) / 100;
}

export function extractMonthlyBankTransactionDates(text: string): string[] {
  const label =
    "(?:(?:交\\s*易|付\\s*款|转\\s*账)\\s*(?:日\\s*期\\s*(?:(?:和|及|/)\\s*时\\s*间)?|时\\s*间|日)|时\\s*间\\s*戳)";
  const separatedPattern = new RegExp(
    `^\\s*${label}\\s*[：:]?\\s*((?:19|20)\\d{2})\\s*(?:年|[-/.])\\s*(\\d{1,2})\\s*(?:月|[-/.])\\s*(\\d{1,2})(?:\\s*日)?`,
    "gmu",
  );
  const compactPattern = new RegExp(
    `^\\s*${label}\\s*[：:]?\\s*((?:19|20)\\d{2})(\\d{2})(\\d{2})(?:\\d{6})?(?!\\d)`,
    "gmu",
  );
  const candidates = new Set<string>();
  for (const pattern of [separatedPattern, compactPattern]) {
    for (const match of text.normalize("NFKC").matchAll(pattern)) {
      const date = normalizeDate(match[1], match[2], match[3]);
      if (date) candidates.add(date);
    }
  }
  return [...candidates].sort();
}

function accountCodesInEvidence(
  evidence: ReceiptEvidence,
): MonthlyBankAccountCode[] {
  const accounts = new Set([
    normalizeMonthlyBankAccount(evidence.payerAccount),
    normalizeMonthlyBankAccount(evidence.payeeAccount),
  ]);
  return (
    Object.keys(MONTHLY_BANK_ACCOUNTS) as MonthlyBankAccountCode[]
  ).filter((code) => accounts.has(MONTHLY_BANK_ACCOUNTS[code].accountNumber));
}

function accountCodeForNumber(value: unknown): MonthlyBankAccountCode | null {
  const account = normalizeMonthlyBankAccount(value);
  return (
    (Object.keys(MONTHLY_BANK_ACCOUNTS) as MonthlyBankAccountCode[]).find(
      (code) => MONTHLY_BANK_ACCOUNTS[code].accountNumber === account,
    ) || null
  );
}

function directionalAccountCode(
  evidence: ReceiptEvidence,
): MonthlyBankAccountCode | null {
  const sourceSide =
    evidence.sourceSide || inferReceiptSourceSide(evidence.rawText);
  if (sourceSide === "payer") {
    return accountCodeForNumber(evidence.payerAccount);
  }
  if (sourceSide === "payee") {
    return accountCodeForNumber(evidence.payeeAccount);
  }
  return null;
}

export function detectMonthlyBankFileAccount(
  evidence: readonly ReceiptEvidence[],
  filenameHint: MonthlyBankAccountCode | null,
): MonthlyBankAccountCode | null {
  const counts = new Map<MonthlyBankAccountCode, number>([
    ["basic", 0],
    ["general", 0],
    ["business", 0],
  ]);
  for (const receipt of evidence) {
    const directionalCode = directionalAccountCode(receipt);
    if (directionalCode) {
      // 内部划转会同时出现两个系统账号；付款／收款回单标题能够证明
      // 本文件实际操作的一侧，只给该侧投票以解除纯出现次数平局。
      counts.set(directionalCode, (counts.get(directionalCode) || 0) + 1);
      continue;
    }
    for (const code of accountCodesInEvidence(receipt)) {
      counts.set(code, (counts.get(code) || 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort(
    (left, right) => right[1] - left[1],
  );
  if (!ranked[0] || ranked[0][1] === 0) return null;
  const leaders = ranked.filter((item) => item[1] === ranked[0]![1]);
  if (leaders.length === 1) return leaders[0]![0];
  if (filenameHint && leaders.some(([code]) => code === filenameHint)) {
    return filenameHint;
  }
  return null;
}

function remarkMonth(value: string): string {
  const match = value.match(
    /((?:19|20)\d{2})\s*(?:年|[-/.])\s*(\d{1,2})(?:\s*月)?/u,
  );
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : "";
}

export function classifyMonthlyBankTransaction(
  accountCode: MonthlyBankAccountCode,
  direction: MonthlyBankDirection,
  isInternalTransfer: boolean,
  evidenceText: string,
): MonthlyBankTransactionCategory {
  if (isInternalTransfer) return "internal_transfer";
  const normalized = evidenceText.normalize("NFKC").replace(/\s+/g, "");
  const isInterestPosting =
    normalized.includes("利息入账") &&
    /起息日|止息日|计息账户|利率/u.test(normalized);
  const isInterest =
    /活期(?:存款)?利息|定期(?:存款)?利息|存款利息|结息/u.test(normalized) ||
    isInterestPosting;
  const isExcludedFee = /半年费|跨行收报/u.test(normalized);
  const isExplicitFee =
    !isExcludedFee &&
    /跨行(?:汇款)?手续费|银行手续费|银行收费凭证|对公收费/u.test(normalized);

  if (accountCode === "business") {
    if (isInterest && direction === "inflow") return "interest";
    if (isExplicitFee && direction === "outflow") return "bank_fee";
    return "ignored";
  }
  if (accountCode === "general") {
    if (direction === "outflow" && normalized.includes("基础报销")) {
      return "basic_reimbursement";
    }
    if (direction === "outflow" && normalized.includes("大额报销")) {
      return "large_reimbursement";
    }
    if (isInterest && direction === "inflow") return "interest";
    if (isExplicitFee && direction === "outflow") return "bank_fee";
    if (
      direction === "inflow" &&
      /(?:付羽隶|咨询服务|项目款|工程款|服务首款|服务尾款|合同回款|主营回款)/u.test(
        normalized,
      )
    ) {
      return "main_income";
    }
    if (
      direction === "outflow" &&
      /(?:北京羽隶科技有限公司|采购款|汽车租赁|房租|租金|物业|电费|车位|设备|软件|公证)/u.test(
        normalized,
      )
    ) {
      return "asset_expense";
    }
    return "unclassified";
  }
  if (direction === "outflow" && normalized.includes("薪资")) return "salary";
  if (direction === "outflow" && normalized.includes("商务报销")) {
    return "business_reimbursement";
  }
  return "ignored";
}

function buildTransaction(
  evidence: ReceiptEvidence,
  accountCode: MonthlyBankAccountCode,
  reportMonth: string,
  outputDir: string,
): MonthlyBankRecognizedTransaction {
  const warnings: string[] = [];
  const payerAccount = normalizeMonthlyBankAccount(evidence.payerAccount);
  const payeeAccount = normalizeMonthlyBankAccount(evidence.payeeAccount);
  const ownAccount = MONTHLY_BANK_ACCOUNTS[accountCode].accountNumber;
  const payerCode = (
    Object.keys(MONTHLY_BANK_ACCOUNTS) as MonthlyBankAccountCode[]
  ).find((code) => MONTHLY_BANK_ACCOUNTS[code].accountNumber === payerAccount);
  const payeeCode = (
    Object.keys(MONTHLY_BANK_ACCOUNTS) as MonthlyBankAccountCode[]
  ).find((code) => MONTHLY_BANK_ACCOUNTS[code].accountNumber === payeeAccount);
  const direction: MonthlyBankDirection =
    payerAccount === ownAccount
      ? "outflow"
      : payeeAccount === ownAccount
        ? "inflow"
        : "unknown";
  const isInternalTransfer = Boolean(
    payerCode && payeeCode && payerCode !== payeeCode,
  );
  const normalizedReceiptNo = normalizeMonthlyBankReceiptNo(evidence.proofNo);
  const transactionMonth = evidence.transactionDate.slice(0, 7);
  const amountCents = Math.round(evidence.amount * 100);
  const hasSafeAmount =
    Number.isFinite(evidence.amount) &&
    evidence.amount > 0 &&
    Number.isSafeInteger(amountCents);
  const evidenceText = `${evidence.remark}\n${evidence.rawText}`;
  const category = classifyMonthlyBankTransaction(
    accountCode,
    direction,
    isInternalTransfer,
    evidenceText,
  );

  if (direction === "unknown")
    warnings.push("该回单未出现当前文件对应的完整账号");
  if (!normalizedReceiptNo) warnings.push("未识别到电子回单号码，不能自动入账");
  if (!evidence.transactionDate) warnings.push("未识别到银行实际交易日期");
  if (evidence.transactionDateCandidates.length > 1) {
    warnings.push(
      `同一回单识别到多个交易日期：${evidence.transactionDateCandidates.join("、")}`,
    );
  }
  if (!hasSafeAmount) warnings.push("回单金额缺失或超出安全计算范围");
  if (transactionMonth && transactionMonth !== reportMonth) {
    warnings.push(
      `银行交易日期归属 ${transactionMonth}，与当前报表 ${reportMonth} 不一致`,
    );
  }
  const statedMonth = remarkMonth(evidence.remark);
  if (statedMonth && transactionMonth && statedMonth !== transactionMonth) {
    warnings.push(
      `备注月份 ${statedMonth} 与银行交易月份 ${transactionMonth} 不一致，以银行交易日期为准`,
    );
  }
  if (category === "unclassified") {
    warnings.push("该回单无法安全归入主营收入或资产支出，需管理员核对");
  }

  // 银行回单只直接贡献一般／商务账户的利息和手续费金额；
  // 主营、资产、报销和薪资仅作为系统业务凭证，不覆盖业务统计。
  const autoIncluded = ["interest", "bank_fee"].includes(category);
  const ignored = category === "ignored" || category === "internal_transfer";
  const categoryRequiresReview = category === "unclassified";
  const blockingWarning = warnings.some(
    (warning) =>
      warning.includes("不能自动入账") ||
      warning.includes("未识别到银行实际交易日期") ||
      warning.includes("回单金额缺失或超出安全计算范围") ||
      warning.includes("未出现当前文件对应的完整账号") ||
      warning.includes("识别到多个交易日期") ||
      warning.includes("与当前报表"),
  );
  return {
    pageNo: evidence.pageNo,
    position: evidence.position,
    previewPath: path.relative(
      process.cwd(),
      path.resolve(outputDir, evidence.previewPath),
    ),
    electronicReceiptNo: evidence.proofNo,
    normalizedElectronicReceiptNo: normalizedReceiptNo,
    transactionDate: evidence.transactionDate,
    transactionMonth,
    amount: evidence.amount,
    payer: evidence.payer,
    payerAccount,
    payee: evidence.payee,
    payeeAccount,
    remark: evidence.remark,
    direction,
    category,
    isInternalTransfer,
    includeInReport:
      autoIncluded &&
      warnings.every(
        (warning) =>
          !warning.includes("不能自动入账") &&
          !warning.includes("未识别到银行实际交易日期") &&
          !warning.includes("回单金额缺失或超出安全计算范围") &&
          !warning.includes("与当前报表"),
      ),
    recognitionStatus:
      blockingWarning || categoryRequiresReview
        ? "review_required"
        : ignored
          ? "ignored"
          : "recognized",
    warnings,
    rawTextHash: crypto
      .createHash("sha256")
      .update(evidence.rawText)
      .digest("hex"),
  };
}

export async function analyzeMonthlyFinancialBankFile(
  input: AnalyzeMonthlyBankFileInput,
): Promise<MonthlyBankFileAnalysis> {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(input.reportMonth)) {
    throw new Error("月度财务报表月份格式必须为 YYYY-MM");
  }
  const source = await fs.promises.readFile(input.filePath);
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(source, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch {
    throw new Error("银行回单 PDF 无法打开，文件可能损坏或加密");
  }
  const pageCount = document.getPageCount();
  if (pageCount < 1) throw new Error("银行回单文件没有可识别页面");
  const allowedPageCount = Math.min(
    MAX_MONTHLY_BANK_PAGES,
    input.maxPageCount ?? MAX_MONTHLY_BANK_PAGES,
  );
  if (pageCount > allowedPageCount) {
    throw new Error(
      input.maxPageCount !== undefined &&
        allowedPageCount < MAX_MONTHLY_BANK_PAGES
        ? "本次银行回单合计不能超过 200 页"
        : `单份银行回单不能超过 ${MAX_MONTHLY_BANK_PAGES} 页`,
    );
  }
  for (const [index, page] of document.getPages().entries()) {
    const { width, height } = page.getSize();
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width > MAX_MONTHLY_BANK_PAGE_EDGE_POINTS ||
      height > MAX_MONTHLY_BANK_PAGE_EDGE_POINTS
    ) {
      throw new Error(`第 ${index + 1} 页尺寸异常，已停止识别`);
    }
  }

  fs.mkdirSync(input.outputDir, { recursive: true });
  const pageImages = await renderPdfPages(input.filePath, input.outputDir);
  const evidence: ReceiptEvidence[] = [];
  const skippedBlankPages: number[] = [];
  const warnings: string[] = [];

  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
    const pageImagePath = pageImages.get(pageNo);
    if (!pageImagePath) {
      warnings.push(`第 ${pageNo} 页转换失败`);
      continue;
    }
    const pageText = await extractPageText(input.filePath, pageNo);
    if (!pageText && (await isVisuallyBlank(pageImagePath))) {
      skippedBlankPages.push(pageNo);
      continue;
    }

    const structuredSections = structuredReceiptSections(pageText).filter(
      (section) => /回单|利息单/u.test(section.text),
    );
    if (structuredSections.length > 0 && pageText.length >= 40) {
      let previewPaths: Array<{
        position: "full" | "top" | "bottom";
        imagePath: string;
      }> = [{ position: "full", imagePath: pageImagePath }];
      if (structuredSections.length >= 2) {
        const split = await splitImage(
          pageImagePath,
          500,
          1000,
          input.outputDir,
          `page${pageNo}`,
          {
            detectWhitespaceBoundary: true,
            trimWhitespace: true,
          },
        );
        previewPaths = [
          { position: "top", imagePath: split.top },
          { position: "bottom", imagePath: split.bottom },
        ];
      }
      for (const [index, section] of structuredSections.slice(0, 2).entries()) {
        const preview = previewPaths[index] || previewPaths[0]!;
        evidence.push(
          parseStructuredReceipt(
            section.text,
            pageNo,
            preview.position,
            preview.imagePath,
            section.sourceSide,
          ),
        );
      }
      if (structuredSections.length > 2) {
        warnings.push(`第 ${pageNo} 页识别到超过两张回单，请管理员核对`);
      }
      continue;
    }

    const { splitY } = analyzePageXml(input.filePath, pageNo);
    const imageItems: Array<{
      position: "full" | "top" | "bottom";
      imagePath: string;
    }> = [];
    if (splitY) {
      const split = await splitImage(
        pageImagePath,
        splitY,
        1262,
        input.outputDir,
        `page${pageNo}`,
        {
          detectWhitespaceBoundary: true,
          trimWhitespace: true,
        },
      );
      imageItems.push(
        { position: "top", imagePath: split.top },
        { position: "bottom", imagePath: split.bottom },
      );
    } else {
      imageItems.push({ position: "full", imagePath: pageImagePath });
    }

    for (const imageItem of imageItems) {
      try {
        const recognized = await recognizeBankReceiptImage(imageItem.imagePath);
        if (!recognized.rawText || recognized.rawText.trim().length < 10) {
          warnings.push(
            `第 ${pageNo} 页${imageItem.position === "top" ? "上半张" : imageItem.position === "bottom" ? "下半张" : "回单"}未识别到有效回单文本`,
          );
          continue;
        }
        const receiptMarkers =
          recognized.rawText.match(/电子回单(?:号码|号)|回单编号/gu) || [];
        if (receiptMarkers.length > 1) {
          warnings.push(
            `第 ${pageNo} 页${imageItem.position === "top" ? "上半张" : imageItem.position === "bottom" ? "下半张" : ""}仍包含多张回单但未成功拆分，已阻止接管月报`,
          );
        }
        evidence.push(
          toReceiptEvidence(
            recognized,
            pageNo,
            imageItem.position,
            imageItem.imagePath,
          ),
        );
      } catch (error) {
        warnings.push(
          `第 ${pageNo} 页${imageItem.position === "top" ? "上半张" : imageItem.position === "bottom" ? "下半张" : "回单"}识别失败：${error instanceof Error ? error.message : "识别服务异常"}`,
        );
      }
    }
  }

  const filenameAccountHint = inferFilenameAccountHint(input.originalName);
  const accountCode = detectMonthlyBankFileAccount(
    evidence,
    filenameAccountHint,
  );
  if (!accountCode) {
    warnings.push("文件内无法精确确定唯一的基本、一般或商务账户完整账号");
  } else if (filenameAccountHint && filenameAccountHint !== accountCode) {
    warnings.push(
      `文件名提示为${MONTHLY_BANK_ACCOUNTS[filenameAccountHint].label}，完整账号识别为${MONTHLY_BANK_ACCOUNTS[accountCode].label}，已按完整账号处理`,
    );
  }

  const recognizedTransactions = accountCode
    ? evidence.map((item) =>
        buildTransaction(item, accountCode, input.reportMonth, input.outputDir),
      )
    : [];
  const seenReceiptNumbers = new Map<
    string,
    MonthlyBankRecognizedTransaction
  >();
  const transactions = recognizedTransactions.filter((transaction) => {
    if (!transaction.normalizedElectronicReceiptNo) return true;
    const existing = seenReceiptNumbers.get(
      transaction.normalizedElectronicReceiptNo,
    );
    if (existing) {
      const sameContent =
        existing.transactionDate === transaction.transactionDate &&
        Math.round(existing.amount * 100) ===
          Math.round(transaction.amount * 100) &&
        existing.payerAccount === transaction.payerAccount &&
        existing.payeeAccount === transaction.payeeAccount;
      warnings.push(
        sameContent
          ? `电子回单号${transaction.electronicReceiptNo}在同一文件中重复且内容一致，已保留第一张`
          : `同一文件电子回单号${transaction.electronicReceiptNo}对应的完整账号、日期或金额不一致，已停止自动入账`,
      );
      return false;
    }
    seenReceiptNumbers.set(
      transaction.normalizedElectronicReceiptNo,
      transaction,
    );
    return true;
  });
  const transactionMonths = [
    ...new Set(
      transactions.map((item) => item.transactionMonth).filter(Boolean),
    ),
  ].sort();
  const requiresMixedMonthConfirmation =
    transactionMonths.length > 1 ||
    (transactionMonths.length === 1 &&
      transactionMonths[0] !== input.reportMonth);
  if (requiresMixedMonthConfirmation) {
    warnings.push(
      `文件交易日期涉及 ${transactionMonths.join("、")}，需管理员确认后才能更新月报`,
    );
  }

  return {
    originalName: input.originalName,
    fileHash: await calculateMonthlyBankFileHash(input.filePath),
    accountCode,
    accountNumber: accountCode
      ? MONTHLY_BANK_ACCOUNTS[accountCode].accountNumber
      : null,
    filenameAccountHint,
    pageCount,
    skippedBlankPages,
    transactionMonths,
    requiresMixedMonthConfirmation,
    warnings,
    transactions,
  };
}
