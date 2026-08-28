import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import sharp from "sharp";

import {
  extractContractFinancialPdfFirstPageTextLayer,
  getContractFinancialPdfPageCount,
  renderContractFinancialPdfFirstPage,
  type RenderedContractFinancialPdfPage,
} from "./contractFinancialEvidence.js";
import {
  extractInvoiceFromXml,
  extractInvoiceItemNameFromPositionedText,
  parseInvoiceText,
  type XmlInvoiceResult,
} from "./localOcr.js";
import { callPaddleOcrDetailed, type PaddleOcrLine } from "./ocrDaemon.js";
import {
  parsePaymentProofText,
  type PaymentProofOcrResult,
} from "./paymentProofOcr.js";
import {
  callTesseractOcrDetailed,
  type TesseractOcrLine,
} from "./tesseractOcrDaemon.js";

export type ContractFinancialDocumentKind = "invoice" | "bank_receipt";
export type ContractFinancialFileFormat = "pdf" | "jpeg" | "png";
export type ContractFinancialDocumentStatus =
  | "normal"
  | "void"
  | "red"
  | "unknown";
export type ContractInvoiceDirection =
  | "input"
  | "output"
  | "third_party"
  | "unknown";
export type ContractBankDirection = "receipt" | "payment" | "unknown";
export type ContractFinancialValidationStatus =
  | "verified"
  | "blocked"
  | "failed";

export interface ContractFinancialOcrContext {
  /**
   * 当前公司及历史公司主体的精确全称。方向判断只做规范化后的精确比较，
   * 不使用模糊相似度自动猜测。
   */
  companyNames?: readonly string[];
  /** 公司有效纳税人识别号；配置后发票方向必须同时匹配名称与税号。 */
  companyTaxIds?: readonly string[];
  /** 公司有效银行账号；仅保留为兼容输入，不参与回款／付款方向判断。 */
  companyBankAccounts?: readonly string[];
  /**
   * 结构化公司主体；多主体场景必须使用该配置绑定法定名称、税号和账号，
   * 防止不同历史主体之间发生名称与编号的交叉组合。
   */
  companySubjects?: readonly {
    name: string;
    taxId?: string;
    bankAccounts?: readonly string[];
  }[];
  /**
   * 当前合同唯一匹配的签约公司主体。凭证中的内部购销方或收付方必须与其一致，
   * 防止把其他我方公司的发票或付款误挂到工程咨询公司签署的合同（反之亦然）。
   */
  contractCompanySubject?: {
    name: string;
    taxId?: string;
  };
  /** 资产合同明确配置的集团内部资金划拨双方。 */
  internalFundingPair?: {
    payerName: string;
    payeeName: string;
  };
  /** 资产类房屋租赁合同要求逐条发票明细完整闭合。 */
  requireInvoiceLineItems?: boolean;
  /** 车辆租赁明确标注免税／不征税时允许票面税额为空。 */
  allowTaxExemptInvoice?: boolean;
  minimumAverageConfidence?: number;
}

export interface ContractFinancialBlockingReason {
  code: string;
  message: string;
  field?: string;
}

export interface ContractInvoiceOcrFields {
  /** 购买方名称。 */
  buyer: string;
  /** 销售方名称。 */
  seller: string;
  /** 票面开票名称，完整保留税收分类前缀，不使用文件名或备注推断。 */
  itemName: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  taxAmount: number | null;
  lineItems: ContractInvoiceLineItem[];
}

export type ContractInvoiceLineExpenseCategory =
  | "rent"
  | "property_management"
  | "electricity"
  | "system_maintenance"
  | "other_cost"
  | "pending_review";

export interface ContractInvoiceLineItem {
  itemName: string;
  netAmount: number | null;
  taxAmount: number | null;
  grossAmount: number | null;
  expenseCategory: ContractInvoiceLineExpenseCategory;
  includeInContractAccounting: boolean;
  recognitionStatus: "verified" | "pending_review";
}

export interface ContractBankReceiptOcrFields {
  /**
   * 原件上的付款日期，统一规范化为 YYYY-MM-DD，不保存时分秒。
   */
  paymentTime: string;
  amount: number;
  electronicReceiptNo: string;
  payer: string;
  payerAccount: string;
  payee: string;
  payeeAccount: string;
}

export interface ContractFinancialRecognitionMeta {
  method:
    | "paddle_ocr"
    | "paddle_and_tesseract"
    | "pdf_structured_and_paddle"
    | "pdf_structured_fast";
  averageConfidence: number | null;
  lineCount: number;
  /** 正文摘要只用于追踪识别版本，不暴露凭证全文。 */
  textSha256: string;
}

interface ContractFinancialOcrResultBase {
  kind: ContractFinancialDocumentKind;
  format: ContractFinancialFileFormat | null;
  failureKind?: "infrastructure" | "document" | "recognition";
  documentStatus: ContractFinancialDocumentStatus;
  validationStatus: ContractFinancialValidationStatus;
  canAutoPost: boolean;
  blockingReasons: ContractFinancialBlockingReason[];
  warnings: string[];
  recognition: ContractFinancialRecognitionMeta | null;
}

export interface ContractInvoiceOcrResult extends ContractFinancialOcrResultBase {
  kind: "invoice";
  direction: ContractInvoiceDirection;
  fields: ContractInvoiceOcrFields;
}

export interface ContractBankReceiptOcrResult extends ContractFinancialOcrResultBase {
  kind: "bank_receipt";
  direction: ContractBankDirection;
  fields: ContractBankReceiptOcrFields;
}

export type ContractFinancialOcrResult =
  | ContractInvoiceOcrResult
  | ContractBankReceiptOcrResult;

export interface ContractFinancialOcrInput {
  filePath: string;
  kind: ContractFinancialDocumentKind;
  context?: ContractFinancialOcrContext;
}

export interface ContractFinancialBatchResult {
  filePath: string;
  result: ContractFinancialOcrResult;
}

const DEFAULT_MINIMUM_CONFIDENCE = 90;
const SAFE_DATE_MIN_YEAR = 2000;
const SAFE_DATE_MAX_YEAR = 2100;

function isFinancialOcrInfrastructureError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
  };
  return (
    [
      "OCR_INFRASTRUCTURE_ERROR",
      "ENOENT",
      "EACCES",
      "EPERM",
      "ENOSPC",
      "EMFILE",
      "ENFILE",
      "ENOMEM",
      "ETIMEDOUT",
      "ECONNRESET",
      "EPIPE",
    ].includes(String(candidate.code || "")) ||
    candidate.killed === true ||
    Boolean(candidate.signal)
  );
}

function emptyInvoiceFields(): ContractInvoiceOcrFields {
  return {
    buyer: "",
    seller: "",
    itemName: "",
    invoiceNumber: "",
    invoiceDate: "",
    amount: 0,
    taxAmount: null,
    lineItems: [],
  };
}

export function classifyInvoiceLineExpense(
  itemName: string,
): Pick<
  ContractInvoiceLineItem,
  "expenseCategory" | "includeInContractAccounting" | "recognitionStatus"
> {
  const businessName = itemName
    .normalize("NFKC")
    .replace(/\*[^*]+\*/gu, "")
    .replace(/[\s,，;；]/gu, "")
    .trim();
  if (!businessName) {
    return {
      expenseCategory: "pending_review",
      includeInContractAccounting: false,
      recognitionStatus: "pending_review",
    };
  }
  if (/(?:房屋|不动产)?租赁|房租|租金/u.test(businessName)) {
    return {
      expenseCategory: "rent",
      includeInContractAccounting: true,
      recognitionStatus: "verified",
    };
  }
  if (/物业(?:管理|服务)?费/u.test(businessName)) {
    return {
      expenseCategory: "property_management",
      includeInContractAccounting: true,
      recognitionStatus: "verified",
    };
  }
  if (/电费|供电|电力/u.test(businessName)) {
    return {
      expenseCategory: "electricity",
      includeInContractAccounting: false,
      recognitionStatus: "verified",
    };
  }
  if (/系统(?:维护|运维)费|软件维护费/u.test(businessName)) {
    return {
      expenseCategory: "system_maintenance",
      includeInContractAccounting: false,
      recognitionStatus: "verified",
    };
  }
  return {
    expenseCategory: "other_cost",
    includeInContractAccounting: false,
    recognitionStatus: "verified",
  };
}

function normalizeStructuredInvoiceLineItems(
  structured: XmlInvoiceResult,
): ContractInvoiceLineItem[] {
  return (structured.lineItems || []).map((item) => {
    const classification = classifyInvoiceLineExpense(item.itemName);
    const amountsComplete =
      item.netAmount !== null &&
      item.taxAmount !== null &&
      item.grossAmount !== null;
    return {
      itemName: cleanInvoiceItemName(item.itemName || ""),
      netAmount: item.netAmount,
      taxAmount: item.taxAmount,
      grossAmount: item.grossAmount,
      expenseCategory: amountsComplete
        ? classification.expenseCategory
        : "pending_review",
      includeInContractAccounting:
        amountsComplete && classification.includeInContractAccounting,
      recognitionStatus:
        amountsComplete && classification.recognitionStatus === "verified"
          ? "verified"
          : "pending_review",
    };
  });
}

function emptyBankFields(): ContractBankReceiptOcrFields {
  return {
    paymentTime: "",
    amount: 0,
    electronicReceiptNo: "",
    payer: "",
    payerAccount: "",
    payee: "",
    payeeAccount: "",
  };
}

function blockingReason(
  code: string,
  message: string,
  field?: string,
): ContractFinancialBlockingReason {
  return { code, message, ...(field ? { field } : {}) };
}

function uniqueReasons(
  reasons: ContractFinancialBlockingReason[],
): ContractFinancialBlockingReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.code}:${reason.field || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·•,，.。()（）[\]【】'"“”‘’]/g, "")
    .trim();
}

function cleanPartyName(value: string | undefined | null): string {
  const cleaned = String(value || "")
    .replace(/^(?:户名|名称)[：:\s]*/, "")
    .replace(/(?:统一社会信用代码|纳税人识别号|税号|账号|开户行)[：:].*$/, "")
    .replace(/[|｜]/g, " ")
    .trim();
  if (
    !cleaned ||
    cleaned.length < 2 ||
    !/[\u3400-\u9fffA-Za-z]/.test(cleaned) ||
    /^(?:信息|名称|购买方|销售方|付款|收款|付款人|收款人|未识别|无法识别|未知)$/.test(
      cleaned,
    )
  ) {
    return "";
  }
  return cleaned.slice(0, 200);
}

function normalizeNumber(value: string | undefined | null): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9-]/g, "")
    .toUpperCase();
}

function normalizeTaxId(value: string | undefined | null): string {
  return (
    String(value || "")
      .normalize("NFKC")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      // 统一社会信用代码不使用字母 I、O、S、V、Z；OCR（光学字符识别）
      // 最常把数字 0 识别为 O。这里只修正规范中不可能出现的 O，不做模糊猜测。
      .replace(/O/g, "0")
  );
}

function normalizeAccount(value: string | undefined | null): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^0-9]/g, "");
}

function toMoney(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : 0;
}

function sameMoney(left: number, right: number): boolean {
  return Math.round(left * 100) === Math.round(right * 100);
}

function validDate(year: number, month: number, day: number): string {
  if (
    year < SAFE_DATE_MIN_YEAR ||
    year > SAFE_DATE_MAX_YEAR ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return "";
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDateValue(value: string | undefined | null): string {
  const match = String(value || "").match(
    /(20\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/,
  );
  if (!match) return "";
  return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function calculateAverageConfidence(lines: PaddleOcrLine[]): number | null {
  const scores = lines
    .filter((line) => line.text.trim())
    .map((line) => Number(line.confidence))
    .filter((score) => Number.isFinite(score) && score >= 0);
  if (scores.length === 0) return null;
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const normalized = average <= 1 ? average * 100 : average;
  return Math.round(Math.min(100, normalized) * 100) / 100;
}

interface OcrLineBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
}

function lineBounds(line: PaddleOcrLine): OcrLineBounds | null {
  const points = Array.isArray(line.box) ? line.box : [];
  const xs = points.map((point) => Number(point?.[0])).filter(Number.isFinite);
  const ys = points.map((point) => Number(point?.[1])).filter(Number.isFinite);
  if (xs.length === 0 || ys.length === 0) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function sortLinesByPosition(lines: PaddleOcrLine[]): PaddleOcrLine[] {
  return [...lines].sort((left, right) => {
    const leftBounds = lineBounds(left);
    const rightBounds = lineBounds(right);
    if (!leftBounds || !rightBounds) return 0;
    const rowDifference = leftBounds.centerY - rightBounds.centerY;
    return Math.abs(rowDifference) <= 6
      ? leftBounds.centerX - rightBounds.centerX
      : rowDifference;
  });
}

function extractInvoiceLayoutParties(lines: PaddleOcrLine[]): {
  buyer: string;
  buyerTaxId: string;
  seller: string;
  sellerTaxId: string;
} {
  const positioned = sortLinesByPosition(lines);
  const names = positioned
    .map(
      (line) =>
        line.text.match(
          /^(?:\s*[购销买售方信息]\s*)*名\s*称\s*[：:]\s*(.+)$/,
        )?.[1],
    )
    .map(cleanPartyName)
    .filter(Boolean);
  const taxIds = positioned
    .map(
      (line) =>
        line.text.match(
          /^(?:\s*统一社会信用代码\s*\/\s*)?\s*纳税人识别号\s*[：:]\s*([A-Za-z0-9\s]{8,30})/,
        )?.[1],
    )
    .map(normalizeTaxId)
    .filter(Boolean);
  return {
    buyer: names.length >= 2 ? names[0] : "",
    seller: names.length >= 2 ? names[names.length - 1] : "",
    buyerTaxId: taxIds.length >= 2 ? taxIds[0] : "",
    sellerTaxId: taxIds.length >= 2 ? taxIds[taxIds.length - 1] : "",
  };
}

function cleanInvoiceItemName(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[|｜]/g, " ")
    .replace(/\s+(?=[¥￥]?\d[\d,]*(?:\.\d+)?(?:\s|$))[\s\S]*$/, "")
    .replace(/\s+/g, "")
    .replace(/^项目名称[：:]?/, "")
    .trim();
  if (!normalized) return "";
  // 开票名称按票面原文完整保留，包括“*生产生活服务*”等税收分类前缀，
  // 避免页面只显示明细简称而丢失票面内容。
  const itemName = normalized;
  if (
    !/[\u3400-\u9fffA-Za-z]/.test(itemName) ||
    /^(?:规格型号|单位|数量|单价|金额|税率(?:\/征收率)?|征收率|税额|合计)$/.test(
      itemName,
    )
  ) {
    return "";
  }
  return itemName.slice(0, 200);
}

function cleanInvoiceItemContinuation(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[|｜]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (
    !normalized ||
    /^[*＊]/u.test(normalized) ||
    /^(?:免税|不征税|零税率|合|计|合计|价税合计|规格型号|单位|数量|单价|金额|税率(?:\/征收率)?|征收率|税额|备注)$/u.test(
      normalized,
    ) ||
    /^(?:[¥￥]?[-+]?\d[\d,，]*(?:\.\d+)?%?|\*+)$/u.test(normalized) ||
    !/[\u3400-\u9fffA-Za-z]/u.test(normalized)
  ) {
    return "";
  }
  return normalized.slice(0, 200);
}

/**
 * 开票名称既可能以票面“项目名称：值”出现，也可能位于表格标题的下一行。
 * 表格值被换成多行时跳过金额、税率和税额占位符，只拼接明确名称续行，
 * 绝不从备注或文件名补值。
 */
function extractInvoiceItemName(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const explicit = line.match(/项目\s*名称\s*[：:]\s*(.+)$/)?.[1];
    const value = cleanInvoiceItemName(explicit || "");
    if (value) return value;
  }

  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /项目\s*名称/.test(line));
  if (headerIndex >= 0) {
    for (
      let index = headerIndex + 1;
      index < Math.min(lines.length, headerIndex + 16);
      index += 1
    ) {
      const line = lines[index].trim();
      if (!line) continue;
      if (/^(?:合\s*计|价\s*税\s*合\s*计)/.test(line)) break;
      let itemName = cleanInvoiceItemName(line);
      if (!itemName) continue;
      for (
        let continuationIndex = index + 1;
        continuationIndex < Math.min(lines.length, index + 12);
        continuationIndex += 1
      ) {
        const compactContinuation = lines[continuationIndex]
          .normalize("NFKC")
          .replace(/\s+/g, "")
          .trim();
        if (/^(?:合|计|合计|价税合计)$/.test(compactContinuation)) break;
        const continuation = cleanInvoiceItemContinuation(
          lines[continuationIndex],
        );
        if (continuation) {
          itemName += continuation;
          break;
        }
      }
      return itemName.slice(0, 200);
    }
  }

  const compactText = text.normalize("NFKC").replace(/\s+/g, "");
  const embedded = compactText.match(
    /\*[^*]{1,80}\*([\u3400-\u9fffA-Za-z]{2,80}?)(?=(?:\d+(?:\.\d+)?|¥|￥|合计|价税合计))/,
  )?.[1];
  return cleanInvoiceItemName(embedded || "");
}

function parseMoneyLine(value: string): number | null {
  const normalized = value
    .normalize("NFKC")
    .replace(/[¥￥,，\s]/g, "")
    .trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function extractInvoiceTaxAmountFromText(text: string): number | null {
  const match = text.match(
    /税\s*额\s*[：:]\s*[¥￥]?\s*([\d,，]+(?:\.\d{1,2})?)/,
  );
  if (match) return parseMoneyLine(match[1]);

  // 数电发票文字层的合计行通常只保留两列金额，不再重复“税额：”标签；
  // 该行最后一个带币种符号的金额就是税额。
  const totalLine = text
    .split(/\r?\n/)
    .find((line) => /合\s*计/.test(line) && !/价\s*税\s*合\s*计/.test(line));
  const amounts = totalLine
    ? [...totalLine.matchAll(/[¥￥]\s*([\d,，]+(?:\.\d{1,2})?)/g)]
        .map((amountMatch) => parseMoneyLine(amountMatch[1]))
        .filter((value): value is number => value !== null)
    : [];
  return amounts.length >= 2 ? amounts[amounts.length - 1] : null;
}

function extractInvoiceTaxAmountFromLayout(
  lines: PaddleOcrLine[],
): number | null {
  const taxHeader = lines.find((line) => /^\s*税\s*额\s*$/.test(line.text));
  const headerBounds = taxHeader ? lineBounds(taxHeader) : null;
  if (!headerBounds) return null;
  const totalLabel = lines.find((line) => /价\s*税\s*合\s*计/.test(line.text));
  const totalBounds = totalLabel ? lineBounds(totalLabel) : null;
  const candidates = lines
    .map((line) => ({
      value: parseMoneyLine(line.text),
      bounds: lineBounds(line),
    }))
    .filter(
      (candidate): candidate is { value: number; bounds: OcrLineBounds } =>
        candidate.value !== null && candidate.bounds !== null,
    )
    .filter(
      (candidate) =>
        candidate.bounds.centerY > headerBounds.maxY &&
        (!totalBounds || candidate.bounds.centerY < totalBounds.centerY) &&
        Math.abs(candidate.bounds.centerX - headerBounds.centerX) <= 180,
    )
    .sort((left, right) => right.bounds.centerY - left.bounds.centerY);
  return candidates[0]?.value ?? null;
}

function findRightColumnValue(
  labels: PaddleOcrLine[],
  candidates: PaddleOcrLine[],
  index: number,
): string {
  const labelBounds = lineBounds(labels[index]);
  if (!labelBounds) return "";
  const nextLabelBounds = labels[index + 1]
    ? lineBounds(labels[index + 1])
    : null;
  const upperX = nextLabelBounds?.centerX ?? Number.POSITIVE_INFINITY;
  const matches = candidates
    .map((line) => ({ line, bounds: lineBounds(line) }))
    .filter(
      (
        candidate,
      ): candidate is {
        line: PaddleOcrLine;
        bounds: OcrLineBounds;
      } => candidate.bounds !== null,
    )
    .filter(
      (candidate) =>
        candidate.bounds.centerX > labelBounds.centerX &&
        candidate.bounds.centerX < upperX &&
        Math.abs(candidate.bounds.centerY - labelBounds.centerY) <= 60,
    )
    .sort(
      (left, right) =>
        Math.abs(left.bounds.centerY - labelBounds.centerY) -
          Math.abs(right.bounds.centerY - labelBounds.centerY) ||
        left.bounds.centerX - right.bounds.centerX,
    );
  return matches[0]?.line.text || "";
}

function extractBankLayoutParties(lines: PaddleOcrLine[]): {
  payer: string;
  payerAccount: string;
  payee: string;
  payeeAccount: string;
} {
  const nameLabels = lines
    .filter((line) => /^\s*户\s*名\s*$/.test(line.text))
    .sort(
      (left, right) =>
        (lineBounds(left)?.centerX || 0) - (lineBounds(right)?.centerX || 0),
    );
  const accountLabels = lines
    .filter((line) => /^\s*(?:账号|账户)\s*$/.test(line.text))
    .sort(
      (left, right) =>
        (lineBounds(left)?.centerX || 0) - (lineBounds(right)?.centerX || 0),
    );
  const nameCandidates = lines.filter((line) => {
    const value = cleanPartyName(line.text);
    return (
      !!value &&
      /[\u3400-\u9fff]/.test(value) &&
      !/^(?:户名|付款|收款|账号|账户|开户银行)$/.test(value)
    );
  });
  const accountCandidates = lines.filter((line) => {
    const normalized = line.text.normalize("NFKC").replace(/\s+/g, "");
    return /^\d{6,25}$/.test(normalized);
  });
  if (nameLabels.length < 2 || accountLabels.length < 2) {
    return { payer: "", payerAccount: "", payee: "", payeeAccount: "" };
  }
  return {
    payer: cleanPartyName(findRightColumnValue(nameLabels, nameCandidates, 0)),
    payee: cleanPartyName(findRightColumnValue(nameLabels, nameCandidates, 1)),
    payerAccount: normalizeAccount(
      findRightColumnValue(accountLabels, accountCandidates, 0),
    ),
    payeeAccount: normalizeAccount(
      findRightColumnValue(accountLabels, accountCandidates, 1),
    ),
  };
}

function extractBankRoleLayoutParties(lines: PaddleOcrLine[]): {
  payer: string;
  payerAccount: string;
  payee: string;
  payeeAccount: string;
} {
  const nameCandidates = lines.filter((line) => {
    const value = cleanPartyName(line.text);
    return (
      !!value &&
      /[\u3400-\u9fff]/u.test(value) &&
      !/^(?:付款人|付款方|收款人|收款方|付款账号|收款账号|开户银行)$/u.test(
        value,
      )
    );
  });
  const accountCandidates = lines.filter((line) => {
    const normalized = line.text.normalize("NFKC").replace(/\s+/gu, "");
    return /^\d{6,25}$/u.test(normalized);
  });
  const findLabel = (pattern: RegExp): PaddleOcrLine | undefined =>
    lines.find((line) => pattern.test(line.text.normalize("NFKC")));
  const extractName = (pattern: RegExp): string => {
    const label = findLabel(pattern);
    return label
      ? cleanPartyName(findRightColumnValue([label], nameCandidates, 0))
      : "";
  };
  const extractAccount = (pattern: RegExp): string => {
    const label = findLabel(pattern);
    return label
      ? normalizeAccount(findRightColumnValue([label], accountCandidates, 0))
      : "";
  };
  return {
    payer: extractName(/^\s*(?:付款人|付款方)\s*[：:]?\s*$/u),
    payee: extractName(/^\s*(?:收款人|收款方)\s*[：:]?\s*$/u),
    payerAccount: extractAccount(/^\s*付款(?:账号|账户)\s*[：:]?\s*$/u),
    payeeAccount: extractAccount(/^\s*收款(?:账号|账户)\s*[：:]?\s*$/u),
  };
}

interface InvoiceChannelRecognition {
  fields: ContractInvoiceOcrFields;
  /**
   * 税号和金额符号只用于服务端主体方向、红字及双通道安全校验，
   * 不进入页面字段或可持久化业务快照。
   */
  internalEvidence: {
    buyerTaxId: string;
    sellerTaxId: string;
    amountSign: "positive" | "negative" | "unknown";
    taxExempt: boolean;
  };
  status: ReturnType<typeof classifyInvoiceStatus>;
  isValidInvoice: boolean;
  conflicts: ContractFinancialBlockingReason[];
}

function parseInvoiceRecognitionChannel(
  text: string,
  lines: PaddleOcrLine[],
): InvoiceChannelRecognition {
  const parsed = parseInvoiceText(text);
  const section = extractInvoiceSectionFields(text);
  const layout = extractInvoiceLayoutParties(lines);
  const status = classifyInvoiceStatus(text);
  const conflicts: ContractFinancialBlockingReason[] = [];
  // 区块标签和坐标列比通用全文解析具备更明确的角色含义。只在两种强证据
  // 都缺失时才使用通用解析，避免左右并列表格把销售方误写成购买方。
  const seller =
    layout.seller || section.seller || cleanPartyName(parsed.seller);
  const buyer = layout.buyer || section.buyer || cleanPartyName(parsed.buyer);
  const textTaxAmount = extractInvoiceTaxAmountFromText(text);
  const layoutTaxAmount = extractInvoiceTaxAmountFromLayout(lines);
  if (
    textTaxAmount !== null &&
    layoutTaxAmount !== null &&
    !sameMoney(textTaxAmount, layoutTaxAmount)
  ) {
    conflicts.push(
      blockingReason(
        "FIELD_CONFLICT_TAXAMOUNT",
        "税额的正文标签与表格列识别结果不一致",
        "taxAmount",
      ),
    );
  }
  const parsedTaxAmount = Number(parsed.taxAmount);
  const taxAmount =
    textTaxAmount ??
    layoutTaxAmount ??
    (Number.isFinite(parsedTaxAmount) && parsedTaxAmount > 0
      ? Math.round(parsedTaxAmount * 100) / 100
      : null);
  const sellerTaxId = layout.sellerTaxId || section.sellerTaxId;
  const buyerTaxId = layout.buyerTaxId || section.buyerTaxId;

  return {
    fields: {
      buyer,
      seller,
      itemName:
        extractInvoiceItemName(text) || String(parsed.type || "").trim(),
      invoiceNumber: normalizeNumber(parsed.invoiceNumber),
      invoiceDate: normalizeDateValue(parsed.date),
      amount: toMoney(parsed.amount) || extractSignedInvoiceAmount(text),
      taxAmount,
      lineItems: [],
    },
    internalEvidence: {
      sellerTaxId,
      buyerTaxId,
      amountSign: status.amountSign,
      taxExempt: /免\s*税|不\s*征\s*税/u.test(text),
    },
    status,
    isValidInvoice: parsed.isValidInvoice,
    conflicts,
  };
}

interface BankChannelRecognition {
  fields: ContractBankReceiptOcrFields;
  status: ContractFinancialDocumentStatus;
  conflicts: ContractFinancialBlockingReason[];
}

type BankRoleFieldCode = "payer" | "payerAccount" | "payee" | "payeeAccount";

interface BankRoleEvidence {
  values: Pick<
    ContractBankReceiptOcrFields,
    "payer" | "payerAccount" | "payee" | "payeeAccount"
  >;
  explicitFields: Set<BankRoleFieldCode>;
  conflicts: ContractFinancialBlockingReason[];
}

const ENHANCED_BANK_ROLE_MINIMUM_CONFIDENCE = 0.9;

function bankRoleFieldLabel(field: BankRoleFieldCode): string {
  return {
    payer: "付款方",
    payerAccount: "付款账号",
    payee: "收款方",
    payeeAccount: "收款账号",
  }[field];
}

/** 只读取明确角色标签同行值，或标签右侧同水平带坐标值。 */
function extractExplicitBankRoleEvidence(
  lines: readonly PaddleOcrLine[],
): BankRoleEvidence {
  const values = {
    payer: "",
    payerAccount: "",
    payee: "",
    payeeAccount: "",
  };
  const explicitFields = new Set<BankRoleFieldCode>();
  const conflicts: ContractFinancialBlockingReason[] = [];
  const candidates = new Map<BankRoleFieldCode, string[]>();
  const addCandidate = (field: BankRoleFieldCode, rawValue: string) => {
    const value = field.endsWith("Account")
      ? normalizeAccount(rawValue)
      : cleanPartyName(rawValue);
    if (!value) return;
    const fieldCandidates = candidates.get(field) || [];
    if (!fieldCandidates.includes(value)) fieldCandidates.push(value);
    candidates.set(field, fieldCandidates);
  };

  for (const line of lines) {
    if (Number(line.confidence) < ENHANCED_BANK_ROLE_MINIMUM_CONFIDENCE) {
      continue;
    }
    const text = line.text.normalize("NFKC").trim();
    const matches: Array<[BankRoleFieldCode, string | undefined]> = [
      ["payer", text.match(/^付款(?:人|方)\s*[：:]\s*(.{2,100})$/u)?.[1]],
      ["payee", text.match(/^收款(?:人|方)\s*[：:]\s*(.{2,100})$/u)?.[1]],
      [
        "payerAccount",
        text.match(/^付款(?:账号|账户)\s*[：:]\s*([0-9\s]{6,30})$/u)?.[1],
      ],
      [
        "payeeAccount",
        text.match(/^收款(?:账号|账户)\s*[：:]\s*([0-9\s]{6,30})$/u)?.[1],
      ],
    ];
    for (const [field, value] of matches) {
      if (value) addCandidate(field, value);
    }
  }

  const positionedLines = lines.filter(
    (line) =>
      Number(line.confidence) >= ENHANCED_BANK_ROLE_MINIMUM_CONFIDENCE &&
      lineBounds(line) !== null,
  );
  const addCoordinateCandidate = (
    field: BankRoleFieldCode,
    labelPattern: RegExp,
    candidatePattern: RegExp,
  ) => {
    const labels = positionedLines.filter((line) =>
      labelPattern.test(line.text.normalize("NFKC").replace(/\s+/gu, "")),
    );
    const valueLines = positionedLines.filter((line) =>
      candidatePattern.test(line.text.normalize("NFKC").replace(/\s+/gu, "")),
    );
    for (const label of labels) {
      const value = findRightColumnValue([label], valueLines, 0);
      if (value) addCandidate(field, value);
    }
  };
  addCoordinateCandidate(
    "payer",
    /^付款(?:人|方)[：:]?$/u,
    /^[\u3400-\u9fff]{2,100}$/u,
  );
  addCoordinateCandidate(
    "payee",
    /^收款(?:人|方)[：:]?$/u,
    /^[\u3400-\u9fff]{2,100}$/u,
  );
  addCoordinateCandidate(
    "payerAccount",
    /^付款(?:账号|账户)[：:]?$/u,
    /^\d{6,25}$/u,
  );
  addCoordinateCandidate(
    "payeeAccount",
    /^收款(?:账号|账户)[：:]?$/u,
    /^\d{6,25}$/u,
  );

  for (const field of [
    "payer",
    "payerAccount",
    "payee",
    "payeeAccount",
  ] as const) {
    const fieldCandidates = candidates.get(field) || [];
    if (fieldCandidates.length > 1) {
      conflicts.push(
        blockingReason(
          "BANK_ENHANCED_ROLE_CONFLICT",
          `增强复扫识别到多个不同的${bankRoleFieldLabel(field)}，禁止自动采用`,
          field,
        ),
      );
      continue;
    }
    if (!fieldCandidates[0]) continue;
    values[field] = fieldCandidates[0];
    explicitFields.add(field);
  }
  return { values, explicitFields, conflicts };
}

function mergeEnhancedBankRoleEvidence(
  primaryFields: ContractBankReceiptOcrFields,
  originalEvidence: BankRoleEvidence,
  enhancedEvidence: BankRoleEvidence,
): {
  fields: ContractBankReceiptOcrFields;
  conflicts: ContractFinancialBlockingReason[];
  recoveredFields: BankRoleFieldCode[];
} {
  const fields = { ...primaryFields };
  const conflicts = [...enhancedEvidence.conflicts];
  const recoveredFields: BankRoleFieldCode[] = [];
  for (const field of [
    "payer",
    "payerAccount",
    "payee",
    "payeeAccount",
  ] as const) {
    if (!enhancedEvidence.explicitFields.has(field)) continue;
    const enhancedValue = enhancedEvidence.values[field];
    const originalValue = originalEvidence.explicitFields.has(field)
      ? originalEvidence.values[field]
      : "";
    const valuesEqual = field.endsWith("Account")
      ? normalizeAccount(originalValue) === normalizeAccount(enhancedValue)
      : normalizeIdentity(originalValue) === normalizeIdentity(enhancedValue);
    if (originalValue && !valuesEqual) {
      conflicts.push(
        blockingReason(
          "BANK_ENHANCED_ORIGINAL_CONFLICT",
          `原图与增强复扫的${bankRoleFieldLabel(field)}不一致，禁止自动采用增强值`,
          field,
        ),
      );
      continue;
    }
    if (!originalValue || !fields[field]) {
      fields[field] = enhancedValue;
      recoveredFields.push(field);
    }
  }
  return { fields, conflicts, recoveredFields };
}

/** 根据首扫角色、账号、开户行和金额坐标动态裁出收付主体信息带。 */
async function createEnhancedBankRoleRegion(
  imagePath: string,
  lines: readonly PaddleOcrLine[],
): Promise<{ filePath: string; cleanup: () => Promise<void> } | null> {
  let temporaryDirectory = "";
  try {
    const metadata = await sharp(imagePath).metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    if (width < 500 || height < 300) return null;
    const roleBounds = lines
      .filter((line) =>
        /(?:付款|收款).*(?:人|方|账号|账户|开户行)/u.test(
          line.text.normalize("NFKC").replace(/\s+/gu, ""),
        ),
      )
      .map(lineBounds)
      .filter((bounds): bounds is OcrLineBounds => bounds !== null);
    if (roleBounds.length < 2) return null;
    const amountBounds = lines
      .filter((line) =>
        /(?:交易|转账|付款)?金额/u.test(
          line.text.normalize("NFKC").replace(/\s+/gu, ""),
        ),
      )
      .map(lineBounds)
      .filter((bounds): bounds is OcrLineBounds => bounds !== null)
      .sort((leftBounds, rightBounds) => leftBounds.minY - rightBounds.minY)[0];
    const minimumX = Math.min(...roleBounds.map((bounds) => bounds.minX));
    const maximumX = Math.max(...roleBounds.map((bounds) => bounds.maxX));
    const minimumY = Math.min(...roleBounds.map((bounds) => bounds.minY));
    const maximumY = Math.max(...roleBounds.map((bounds) => bounds.maxY));
    const left = Math.max(0, Math.floor(minimumX - width * 0.04));
    const right = Math.min(
      width,
      Math.ceil(Math.max(maximumX + width * 0.2, width * 0.82)),
    );
    const top = Math.max(0, Math.floor(minimumY - height * 0.07));
    const inferredBottom = Math.ceil(maximumY + height * 0.05);
    const bottom = Math.min(
      height,
      amountBounds && amountBounds.minY > minimumY
        ? Math.max(
            maximumY + 1,
            Math.min(inferredBottom, amountBounds.minY + 20),
          )
        : inferredBottom,
    );
    const cropWidth = right - left;
    const cropHeight = bottom - top;
    if (cropWidth < 300 || cropHeight < 100) return null;
    temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "contract-bank-role-"),
    );
    const enhancedPath = path.join(temporaryDirectory, "enhanced.png");
    await sharp(imagePath)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1.1 })
      .resize({
        width: Math.min(5000, Math.round(cropWidth * 2.5)),
        kernel: "lanczos3",
      })
      .png()
      .toFile(enhancedPath);
    return {
      filePath: enhancedPath,
      cleanup: () =>
        fs.promises.rm(temporaryDirectory, { recursive: true, force: true }),
    };
  } catch {
    if (temporaryDirectory) {
      await fs.promises.rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    }
    return null;
  }
}

function parseBankRecognitionChannel(
  text: string,
  lines: PaddleOcrLine[],
): BankChannelRecognition {
  const parsed: PaymentProofOcrResult = parsePaymentProofText(text);
  const layout = extractBankLayoutParties(lines);
  const roleLayout = extractBankRoleLayoutParties(lines);
  const accounts = extractAllAccounts(text);
  const conflicts: ContractFinancialBlockingReason[] = [];
  const parsedPayer =
    cleanPartyName(parsed.payer) || extractRoleName(text, "付款");
  const parsedPayee =
    cleanPartyName(parsed.payee) || extractRoleName(text, "收款");
  const rolePayerAccount =
    extractRoleAccount(text, "付款") || accounts[0] || "";
  const rolePayeeAccount =
    extractRoleAccount(text, "收款") ||
    normalizeAccount(parsed.payeeAccount) ||
    accounts.find((account) => account !== rolePayerAccount) ||
    "";

  return {
    fields: {
      paymentTime: extractPaymentTime(text),
      amount: toMoney(parsed.amount),
      electronicReceiptNo: normalizeNumber(parsed.electronicReceiptNo),
      // 银行电子回单通常是左右并列表格。坐标定位已经明确付款／收款列时，
      // 直接采用对应单元格；全文顺序解析仅作缺值兜底。同一 OCR（光学字符
      // 识别）结果的两种内部解析不是独立证据，不能因顺序解析串列而误拦截。
      payer: layout.payer || roleLayout.payer || parsedPayer,
      payerAccount:
        layout.payerAccount || roleLayout.payerAccount || rolePayerAccount,
      payee: layout.payee || roleLayout.payee || parsedPayee,
      payeeAccount:
        layout.payeeAccount || roleLayout.payeeAccount || rolePayeeAccount,
    },
    status: classifyBankStatus(text),
    conflicts,
  };
}

function mapTesseractLines(
  lines: readonly TesseractOcrLine[],
): PaddleOcrLine[] {
  return lines.map((line) => ({
    text: line.text,
    confidence: line.confidence,
    box: line.box,
  }));
}

export async function detectContractFinancialFileFormat(
  filePath: string,
): Promise<ContractFinancialFileFormat | null> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    if (header.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
    if (header.subarray(0, 3).toString("hex") === "ffd8ff") return "jpeg";
    if (header.toString("hex") === "89504e470d0a1a0a") return "png";
    return null;
  } finally {
    await handle.close();
  }
}

function classifyInvoiceStatus(text: string): {
  status: ContractFinancialDocumentStatus;
  amountSign: "positive" | "negative" | "unknown";
  conflict: boolean;
} {
  const normalized = removeNegativeStatusPhrases(text.normalize("NFKC"));
  const compact = normalized.replace(/\s+/g, "");
  const hasVoid = /(?:已)?作废|作廢/.test(compact);
  const hasRedWord = /红字|紅字|红冲|紅沖|冲红|沖紅|负数发票|負數發票/.test(
    compact,
  );
  // 负号必须与币种符号直接相邻，或位于价税合计/小写金额的同一行。
  // 禁止跨行扫描，否则备注中的电话号码（如 010-63232956）会被误判红字。
  const hasNegativeAmount =
    /[¥￥]\s*[-－−]\s*\d+(?:\.\d{1,2})?/.test(normalized) ||
    /(?:价\s*税\s*合\s*计|價\s*稅\s*合\s*計|小\s*写|小\s*寫)[^\n\r]{0,120}?[-－−]\s*\d/.test(
      normalized,
    );
  const hasInvoiceKeyword = /发票|發票/.test(compact);
  if (hasVoid && (hasRedWord || hasNegativeAmount)) {
    return { status: "unknown", amountSign: "negative", conflict: true };
  }
  if (hasVoid) {
    return { status: "void", amountSign: "unknown", conflict: false };
  }
  if (hasRedWord || hasNegativeAmount) {
    return { status: "red", amountSign: "negative", conflict: false };
  }
  return {
    status: hasInvoiceKeyword ? "normal" : "unknown",
    amountSign: hasInvoiceKeyword ? "positive" : "unknown",
    conflict: false,
  };
}

function classifyBankStatus(text: string): ContractFinancialDocumentStatus {
  const compact = removeNegativeStatusPhrases(
    text.normalize("NFKC").replace(/\s+/g, ""),
  );
  if (/(?:已)?作废|作廢/.test(compact)) return "void";
  return compact.includes("银行") && compact.includes("回单")
    ? "normal"
    : "unknown";
}

/**
 * 普通 PDF（便携式文档格式）与图片的文件类型只采用可见首页 OCR
 * （光学字符识别）顶部证据。全文自然阅读顺序用于无坐标扫描件；存在坐标
 * 时同时截取页面顶部区域。完整结构化电子发票另走可信票面布局例外。
 */
function visibleDocumentTopText(
  text: string,
  lines: readonly PaddleOcrLine[],
): string {
  const orderedTextLines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstVisibleLines = orderedTextLines.slice(
    0,
    Math.min(10, Math.max(3, Math.ceil(orderedTextLines.length * 0.25))),
  );
  const positioned = lines
    .map((line) => ({
      text: line.text.trim(),
      top: Math.min(...(line.box || []).map((point) => Number(point?.[1]))),
      bottom: Math.max(...(line.box || []).map((point) => Number(point?.[1]))),
    }))
    .filter(
      (line) =>
        line.text && Number.isFinite(line.top) && Number.isFinite(line.bottom),
    );
  if (positioned.length === 0) return firstVisibleLines.join("\n");
  const pageTop = Math.min(...positioned.map((line) => line.top));
  const pageBottom = Math.max(...positioned.map((line) => line.bottom));
  const topBoundary = pageTop + Math.max(160, (pageBottom - pageTop) * 0.3);
  const positionedTopLines = positioned
    .filter((line) => line.top <= topBoundary)
    .sort((left, right) => left.top - right.top)
    .map((line) => line.text);
  return [...new Set([...positionedTopLines, ...firstVisibleLines])].join("\n");
}

function hasInvoiceTitleInTopRegion(
  text: string,
  lines: readonly PaddleOcrLine[],
): boolean {
  return visibleDocumentTopText(text, lines)
    .split(/\r?\n/u)
    .map((line) => line.normalize("NFKC").replace(/\s+/gu, ""))
    .some(
      (line) =>
        /(?:^发票$|电子发票|数电发票|数字化电子发票|增值税(?:电子)?(?:专用|普通)?发票|机动车销售统一发票|二手车销售统一发票|通用机打发票|定额发票|发票[（(])/u.test(
          line,
        ) &&
        !/^(?:发票号码|发票代码|发票类型|发票抬头|发票日期)[：:]/u.test(line),
    );
}

function hasVisibleOcrInvoiceTitleEvidence(
  text: string,
  lines: readonly PaddleOcrLine[],
): boolean {
  return hasInvoiceTitleInTopRegion(text, lines);
}

function hasTrustedStructuredInvoiceLayoutEvidence(
  structured: XmlInvoiceResult,
  allowTaxExemptInvoice: boolean,
): boolean {
  return (
    completeStructuredInvoice(structured, allowTaxExemptInvoice) &&
    hasInvoiceTitleInTopRegion("", structuredInvoiceLines(structured))
  );
}

function hasVisibleBankReceiptTitleEvidence(
  text: string,
  lines: readonly PaddleOcrLine[],
): boolean {
  const compactTop = visibleDocumentTopText(text, lines)
    .normalize("NFKC")
    .replace(/\s+/gu, "");
  return /银行/u.test(compactTop) && /回单/u.test(compactTop);
}

/**
 * “未作废”“红字标志：否”等否定描述本身也包含风险关键词，必须先移除，
 * 否则会把明确正常的凭证误判为作废或红字。若正文其他位置仍有独立的
 * “作废”或“红字”标记，移除否定短语后仍会被正常识别并阻断。
 */
function removeNegativeStatusPhrases(compactText: string): string {
  return compactText
    .replace(/作废(?:标志|状态)?[：:]?(?:否|无|未作废|正常|0|false)/gi, "")
    .replace(/(?:未|非|没有|并未)(?:被)?作废/g, "")
    .replace(/红字(?:标志|状态)?[：:]?(?:否|无|非红字|正常|0|false)/gi, "")
    .replace(/(?:非|不是|并非)红字/g, "");
}

function findSection(
  text: string,
  startPattern: RegExp,
  endPattern?: RegExp,
): string {
  const start = startPattern.exec(text);
  if (!start) return "";
  const from = start.index + start[0].length;
  const remaining = text.slice(from);
  const end = endPattern?.exec(remaining);
  return remaining.slice(0, end ? end.index : 600);
}

function extractSectionName(section: string): string {
  const match = section.match(/名\s*称\s*[：:]\s*([^\n\r|｜]{2,200})/);
  return cleanPartyName(match?.[1]);
}

function extractSectionTaxId(section: string): string {
  const match = section.match(
    /(?:统一社会信用代码\s*\/\s*纳税人识别号|统一社会信用代码|纳税人识别号|税号)\s*[：:]\s*([A-Za-z0-9\s]{8,30})/,
  );
  return normalizeTaxId(match?.[1]);
}

function valuesFollowingLabels(text: string, label: RegExp): string[] {
  const values: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const matches = [...line.matchAll(label)];
    for (let index = 0; index < matches.length; index += 1) {
      const current = matches[index];
      const from = (current.index || 0) + current[0].length;
      const to = matches[index + 1]?.index ?? line.length;
      const value = line
        .slice(from, to)
        .replace(/^\s*[购销买售方信息]{1,6}\s*/, "")
        .replace(/\s*[购销买售方信息]{1,6}\s*$/, "")
        .trim();
      if (value) values.push(value);
    }
  }
  return values;
}

function extractPartyTaxIds(text: string): string[] {
  const candidates = [
    ...valuesFollowingLabels(
      text,
      /(?:统一\s*社会\s*信用\s*代码\s*[／/]\s*)?纳税人\s*识别\s*号\s*[：:]/g,
    ),
    ...text.matchAll(/\b(?:91|92)[A-Za-z0-9]{16}\b/g),
  ];
  return [
    ...new Set(
      candidates
        .map((candidate) =>
          normalizeTaxId(
            typeof candidate === "string" ? candidate : candidate[0],
          ),
        )
        .filter((candidate) => candidate.length === 18),
    ),
  ];
}

function extractInvoiceSectionFields(text: string): {
  buyer: string;
  buyerTaxId: string;
  seller: string;
  sellerTaxId: string;
} {
  // 数电发票的 PDF（便携式文档格式）文字层经常把购销双方排在同一行，
  // 且“购买方/销售方”被拆成竖排字符。此时按两个“名称/税号”标签的
  // 文档顺序取第一组为购买方、最后一组为销售方。
  const partyNameText = text
    .split(/\r?\n/)
    .filter((line) => {
      const labels = [...line.matchAll(/名\s*称\s*[：:]/g)];
      if (labels.length >= 2) return true;
      if (labels.length !== 1) return false;
      const prefix = line.slice(0, labels[0].index || 0).replace(/\s+/g, "");
      return /^[购销买售方信息]*$/.test(prefix);
    })
    .join("\n");
  const labeledNames = valuesFollowingLabels(partyNameText, /名\s*称\s*[：:]/g)
    .map(cleanPartyName)
    .filter(Boolean);
  const labeledTaxIds = extractPartyTaxIds(text);
  const buyerSection = findSection(
    text,
    /购\s*买\s*方(?:\s*信\s*息)?/,
    /销\s*售\s*方(?:\s*信\s*息)?/,
  );
  const sellerSection = findSection(text, /销\s*售\s*方(?:\s*信\s*息)?/);
  return {
    buyer:
      labeledNames.length >= 2
        ? labeledNames[0]
        : extractSectionName(buyerSection),
    buyerTaxId:
      labeledTaxIds.length >= 2
        ? labeledTaxIds[0]
        : extractSectionTaxId(buyerSection),
    seller:
      labeledNames.length >= 2
        ? labeledNames[labeledNames.length - 1]
        : extractSectionName(sellerSection),
    sellerTaxId:
      labeledTaxIds.length >= 2
        ? labeledTaxIds[labeledTaxIds.length - 1]
        : extractSectionTaxId(sellerSection),
  };
}

function extractSignedInvoiceAmount(text: string): number {
  const match = text
    .normalize("NFKC")
    .match(
      /(?:价\s*税\s*合\s*计|價\s*稅\s*合\s*計|小\s*写|小\s*寫)[\s\S]{0,100}?[¥￥]?\s*[-－−]\s*([\d,，]+(?:\.\d{1,2})?)/,
    );
  return toMoney(match?.[1]?.replace(/[,，]/g, ""));
}

function extractRoleName(text: string, role: "付款" | "收款"): string {
  const patterns = [
    new RegExp(
      `${role}(?:人|方)?(?:\\s*户\\s*名|\\s*名称)?[：:\\s]+([^\\n\\r|｜]{2,200})`,
    ),
    new RegExp(`${role}户名[：:\\s]+([^\\n\\r|｜]{2,200})`),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanPartyName(match?.[1]);
    if (value) return value;
  }
  return "";
}

function extractRoleAccount(text: string, role: "付款" | "收款"): string {
  const patterns = [
    new RegExp(
      `${role}(?:人|方)?[\\s\\S]{0,100}?(?:账号|账户)[：:\\s]*([0-9\\s]{6,30})`,
    ),
    new RegExp(`${role}(?:账号|账户)[：:\\s]*([0-9\\s]{6,30})`),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = normalizeAccount(match?.[1]);
    if (value.length >= 6 && value.length <= 25) return value;
  }
  return "";
}

function extractAllAccounts(text: string): string[] {
  const accounts = [...text.matchAll(/(?:账号|账户)[：:\s]*([0-9\s]{12,30})/g)]
    .map((match) => normalizeAccount(match[1]))
    .filter((account) => account.length >= 13 && account.length <= 25);
  return [...new Set(accounts)];
}

function extractPaymentTime(text: string): string {
  const labels = [
    "付款时间",
    "交易日期时间",
    "交易时间",
    "交易日期",
    "转账时间",
    "转账日期",
    "时间戳",
  ];
  for (const label of labels) {
    const timeMatch = text.match(
      new RegExp(
        `${label}[：:\\s]*(20\\d{2})\\s*[年./-]\\s*(\\d{1,2})\\s*[月./-]\\s*(\\d{1,2})[ \\t]*日?(?:[ T\\t]+|-(?=\\d{1,2}[：:.]))(\\d{1,2})[：:.](\\d{1,2})(?:[：:.](\\d{1,2}))?(?:[.](\\d{1,6}))?`,
      ),
    );
    const match =
      timeMatch ||
      text.match(
        new RegExp(
          `${label}[：:\\s]*(20\\d{2})\\s*[年./-]\\s*(\\d{1,2})\\s*[月./-]\\s*(\\d{1,2})\\s*日?`,
        ),
      );
    if (!match) continue;
    const date = validDate(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    );
    if (!date) continue;
    if (match[4] === undefined) return date;
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const hasSecond = match[6] !== undefined;
    const second = hasSecond ? Number(match[6]) : 0;
    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      !Number.isInteger(second) ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      continue;
    }
    return date;
  }
  return "";
}

function companyIdentitySet(context: ContractFinancialOcrContext): Set<string> {
  return new Set(
    [
      ...(context.companyNames || []),
      ...(context.companySubjects || []).map((subject) => subject.name),
    ]
      .map((name) => normalizeIdentity(name))
      .filter(Boolean),
  );
}

function companyTaxIdSet(context: ContractFinancialOcrContext): Set<string> {
  return new Set(
    [
      ...(context.companyTaxIds || []),
      ...(context.companySubjects || []).map((subject) => subject.taxId || ""),
    ]
      .map(normalizeTaxId)
      .filter(Boolean),
  );
}

function companyBankAccountSet(
  context: ContractFinancialOcrContext,
): Set<string> {
  return new Set(
    [
      ...(context.companyBankAccounts || []),
      ...(context.companySubjects || []).flatMap(
        (subject) => subject.bankAccounts || [],
      ),
    ]
      .map(normalizeAccount)
      .filter(Boolean),
  );
}

interface NormalizedCompanySubject {
  name: string;
  taxId: string;
  bankAccounts: Set<string>;
}

function normalizedCompanySubjects(
  context: ContractFinancialOcrContext,
): NormalizedCompanySubject[] {
  const explicit = (context.companySubjects || [])
    .map((subject) => ({
      name: normalizeIdentity(subject.name),
      taxId: normalizeTaxId(subject.taxId),
      bankAccounts: new Set(
        (subject.bankAccounts || []).map(normalizeAccount).filter(Boolean),
      ),
    }))
    .filter((subject) => subject.name);
  if (explicit.length > 0) return explicit;

  const names = [...companyIdentitySet(context)];
  const taxIds = [...companyTaxIdSet(context)];
  if (names.length !== 1 || taxIds.length > 1) return [];
  return [
    {
      name: names[0],
      taxId: taxIds[0] || "",
      bankAccounts: companyBankAccountSet(context),
    },
  ];
}

function invoiceDirection(
  seller: string,
  sellerTaxId: string,
  buyer: string,
  buyerTaxId: string,
  context: ContractFinancialOcrContext,
): ContractInvoiceDirection {
  if (!seller || !buyer) return "unknown";
  const subjects = normalizedCompanySubjects(context).filter(
    (subject) => subject.taxId,
  );
  if (subjects.length === 0) return "unknown";
  const matchedSubject = (name: string, taxId: string) =>
    subjects.find(
      (subject) =>
        subject.name === normalizeIdentity(name) &&
        subject.taxId === normalizeTaxId(taxId),
    );
  const sellerSubject = matchedSubject(seller, sellerTaxId);
  const buyerSubject = matchedSubject(buyer, buyerTaxId);
  const sellerIsCompany = Boolean(sellerSubject);
  const buyerIsCompany = Boolean(buyerSubject);
  const configuredNames = new Set(subjects.map((subject) => subject.name));
  const configuredTaxIds = new Set(subjects.map((subject) => subject.taxId));
  const hasSubjectConflict = (name: string, taxId: string, exact: boolean) =>
    !exact &&
    (configuredNames.has(normalizeIdentity(name)) ||
      configuredTaxIds.has(normalizeTaxId(taxId)));
  if (
    hasSubjectConflict(seller, sellerTaxId, sellerIsCompany) ||
    hasSubjectConflict(buyer, buyerTaxId, buyerIsCompany)
  ) {
    return "unknown";
  }
  if (sellerIsCompany === buyerIsCompany) {
    return sellerIsCompany ? "unknown" : "third_party";
  }
  const expectedSubjectName = context.contractCompanySubject
    ? normalizeIdentity(context.contractCompanySubject.name)
    : "";
  const invoiceCompanySubject = sellerSubject || buyerSubject;
  if (
    expectedSubjectName &&
    invoiceCompanySubject?.name !== expectedSubjectName
  ) {
    return "unknown";
  }
  return sellerIsCompany ? "output" : "input";
}

function bankDirection(
  payer: string,
  payee: string,
  context: ContractFinancialOcrContext,
): ContractBankDirection {
  if (!payer || !payee) return "unknown";
  const companyNames = companyIdentitySet(context);
  if (companyNames.size === 0) return "unknown";
  const payerIsCompany = companyNames.has(normalizeIdentity(payer));
  const payeeIsCompany = companyNames.has(normalizeIdentity(payee));
  if (payerIsCompany && payeeIsCompany) {
    const pair = context.internalFundingPair;
    return pair &&
      normalizeIdentity(payer) === normalizeIdentity(pair.payerName) &&
      normalizeIdentity(payee) === normalizeIdentity(pair.payeeName)
      ? "payment"
      : "unknown";
  }
  if (!payerIsCompany && !payeeIsCompany) return "unknown";
  const expectedSubjectName = context.contractCompanySubject
    ? normalizeIdentity(context.contractCompanySubject.name)
    : "";
  const bankCompanySubjectName = normalizeIdentity(
    payerIsCompany ? payer : payee,
  );
  if (expectedSubjectName && bankCompanySubjectName !== expectedSubjectName) {
    return "unknown";
  }
  return payeeIsCompany ? "receipt" : "payment";
}

function addMissingReason(
  reasons: ContractFinancialBlockingReason[],
  present: boolean,
  code: string,
  field: string,
  label: string,
): void {
  if (!present) {
    reasons.push(blockingReason(code, `未识别到${label}`, field));
  }
}

function buildRecognitionMeta(
  text: string,
  lines: PaddleOcrLine[],
  method: ContractFinancialRecognitionMeta["method"] = "paddle_ocr",
): ContractFinancialRecognitionMeta {
  return {
    method,
    averageConfidence: calculateAverageConfidence(lines),
    lineCount: lines.filter((line) => line.text.trim()).length,
    textSha256: crypto.createHash("sha256").update(text).digest("hex"),
  };
}

function confidenceReasons(
  meta: ContractFinancialRecognitionMeta,
  context: ContractFinancialOcrContext,
): ContractFinancialBlockingReason[] {
  const threshold = Math.min(
    100,
    Math.max(0, context.minimumAverageConfidence ?? DEFAULT_MINIMUM_CONFIDENCE),
  );
  if (meta.averageConfidence === null) {
    return [
      blockingReason(
        "OCR_CONFIDENCE_MISSING",
        "识别引擎未返回可验证的行级置信度",
      ),
    ];
  }
  if (meta.averageConfidence < threshold) {
    return [
      blockingReason(
        "OCR_CONFIDENCE_LOW",
        `识别平均置信度 ${meta.averageConfidence} 低于自动入账阈值 ${threshold}`,
      ),
    ];
  }
  return [];
}

const INVOICE_INDEPENDENT_FIELD_LABELS = {
  buyer: "购买方名称",
  seller: "销售方名称",
  itemName: "开票名称",
  invoiceNumber: "发票号码",
  invoiceDate: "开票日期",
  amount: "开票金额",
  taxAmount: "税额",
} as const;

type InvoiceIndependentField = keyof typeof INVOICE_INDEPENDENT_FIELD_LABELS;

function invoiceEvidenceValuePresent(
  field: InvoiceIndependentField,
  value: ContractInvoiceOcrFields[InvoiceIndependentField],
): boolean {
  if (field === "amount") return Number(value) > 0;
  if (field === "taxAmount") return value !== null;
  return String(value || "").trim().length > 0;
}

function invoiceEvidenceValueMatches(
  field: InvoiceIndependentField,
  primary: ContractInvoiceOcrFields[InvoiceIndependentField],
  secondary: ContractInvoiceOcrFields[InvoiceIndependentField],
): boolean {
  if (field === "amount" || field === "taxAmount") {
    return sameMoney(Number(primary), Number(secondary));
  }
  if (field === "invoiceDate") return primary === secondary;
  if (field === "invoiceNumber") {
    return (
      normalizeNumber(String(primary)) === normalizeNumber(String(secondary))
    );
  }
  return (
    normalizeIdentity(String(primary)) === normalizeIdentity(String(secondary))
  );
}

function compareInvoiceIndependentEvidence(
  primary: InvoiceChannelRecognition,
  secondary: InvoiceChannelRecognition | null,
  sourceLabel: string,
  allowTaxExemptInvoice = false,
): ContractFinancialBlockingReason[] {
  if (!secondary) {
    return [
      blockingReason(
        "INDEPENDENT_EVIDENCE_MISSING",
        `${sourceLabel}不可用，全部核心字段缺少独立复核`,
        "independentEvidence",
      ),
    ];
  }

  const missing: string[] = [];
  const conflicts: string[] = [];
  for (const field of Object.keys(
    INVOICE_INDEPENDENT_FIELD_LABELS,
  ) as InvoiceIndependentField[]) {
    const primaryValue = primary.fields[field];
    const secondaryValue = secondary.fields[field];
    const mutuallyExemptWithoutTaxAmount =
      field === "taxAmount" &&
      allowTaxExemptInvoice &&
      primaryValue === null &&
      secondaryValue === null &&
      primary.internalEvidence.taxExempt &&
      secondary.internalEvidence.taxExempt;
    if (mutuallyExemptWithoutTaxAmount) continue;
    if (
      !invoiceEvidenceValuePresent(field, primaryValue) ||
      !invoiceEvidenceValuePresent(field, secondaryValue)
    ) {
      missing.push(INVOICE_INDEPENDENT_FIELD_LABELS[field]);
    } else if (
      !invoiceEvidenceValueMatches(field, primaryValue, secondaryValue)
    ) {
      conflicts.push(INVOICE_INDEPENDENT_FIELD_LABELS[field]);
    }
  }

  for (const [field, label] of [
    ["buyerTaxId", "购买方主体证据"],
    ["sellerTaxId", "销售方主体证据"],
  ] as const) {
    const primaryValue = primary.internalEvidence[field];
    const secondaryValue = secondary.internalEvidence[field];
    if (!primaryValue || !secondaryValue) {
      missing.push(label);
    } else if (
      normalizeTaxId(primaryValue) !== normalizeTaxId(secondaryValue)
    ) {
      conflicts.push(label);
    }
  }

  if (secondary.status.status === "unknown") {
    missing.push("凭证状态");
  } else if (primary.status.status !== secondary.status.status) {
    conflicts.push("凭证状态");
  }
  if (!secondary.isValidInvoice) missing.push("发票核心结构");
  if (secondary.conflicts.length > 0) conflicts.push("独立通道内部字段");

  const reasons: ContractFinancialBlockingReason[] = [];
  const uniqueMissing = [...new Set(missing)];
  const uniqueConflicts = [...new Set(conflicts)];
  if (uniqueMissing.length > 0) {
    reasons.push(
      blockingReason(
        "INDEPENDENT_EVIDENCE_MISSING",
        `${sourceLabel}未能完整复核：${uniqueMissing.join("、")}`,
        "independentEvidence",
      ),
    );
  }
  if (uniqueConflicts.length > 0) {
    reasons.push(
      blockingReason(
        "INDEPENDENT_EVIDENCE_CONFLICT",
        `${sourceLabel}与第一识别通道不一致：${uniqueConflicts.join("、")}`,
        "independentEvidence",
      ),
    );
  }
  return reasons;
}

function completeStructuredInvoice(
  structured: XmlInvoiceResult | null,
  allowTaxExemptInvoice = false,
): structured is XmlInvoiceResult & {
  amount: number;
  date: string;
  invoiceNumber: string;
  itemName: string;
  seller: string;
  sellerTaxId: string;
  buyer: string;
  buyerTaxId: string;
  rawText: string;
  positionedTextNodes: NonNullable<XmlInvoiceResult["positionedTextNodes"]>;
} {
  return Boolean(
    structured &&
    structured.amount &&
    (structured.taxAmount !== undefined ||
      (allowTaxExemptInvoice &&
        /免税|不征税/u.test(
          `${structured.itemName || ""} ${structured.rawText || ""}`,
        ))) &&
    structured.date &&
    structured.invoiceNumber &&
    structured.itemName &&
    structured.seller &&
    structured.sellerTaxId &&
    structured.buyer &&
    structured.buyerTaxId &&
    structured.rawText &&
    structured.positionedTextNodes?.length &&
    structuredInvoiceMatchesRawText(structured, allowTaxExemptInvoice),
  );
}

/**
 * 坐标字段必须能在同一份电子文字层正文中逐项复核。该校验不能替代可见页面
 * 的独立识别，但可以阻止坐标切列、节点顺序或测试桩不一致时误走快速分支。
 */
function structuredInvoiceMatchesRawText(
  structured: XmlInvoiceResult,
  allowTaxExemptInvoice = false,
): boolean {
  const rawText = String(structured.rawText || "");
  const normalizeEvidence = (value: unknown) =>
    normalizeIdentity(String(value || "")).replace(/[、,，;；]/g, "");
  const compactRawText = normalizeEvidence(rawText);
  const includesEvidence = (value: unknown) => {
    const normalized = normalizeEvidence(value);
    return Boolean(normalized) && compactRawText.includes(normalized);
  };
  const coordinateItemName = extractInvoiceItemNameFromPositionedText(
    structured.positionedTextNodes || [],
  );
  const includesItemEvidence =
    normalizeEvidence(coordinateItemName) ===
      normalizeEvidence(structured.itemName) ||
    (allowTaxExemptInvoice && includesEvidence(structured.itemName));
  const moneyValues = Array.from(
    rawText.normalize("NFKC").matchAll(/[-+]?[\d,]+\.\d{2}/g),
  )
    .map((match) => Number(match[0].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
  const includesMoney = (value: unknown) => {
    const amount = Number(value);
    return (
      Number.isFinite(amount) &&
      moneyValues.some((candidate) => sameMoney(candidate, amount))
    );
  };
  return (
    includesEvidence(structured.date) &&
    includesEvidence(structured.invoiceNumber) &&
    includesItemEvidence &&
    includesEvidence(structured.seller) &&
    includesEvidence(structured.sellerTaxId) &&
    includesEvidence(structured.buyer) &&
    includesEvidence(structured.buyerTaxId) &&
    includesMoney(structured.amount) &&
    (includesMoney(structured.taxAmount) ||
      (allowTaxExemptInvoice &&
        structured.taxAmount === undefined &&
        /免税|不征税/u.test(`${structured.itemName || ""} ${rawText}`)))
  );
}

function structuredInvoiceChannel(
  structured: XmlInvoiceResult,
  includeLineItems: boolean,
): InvoiceChannelRecognition {
  const rawText = structured.rawText || "";
  const status = classifyInvoiceStatus(rawText);
  return {
    fields: {
      buyer: cleanPartyName(structured.buyer),
      seller: cleanPartyName(structured.seller),
      itemName: cleanInvoiceItemName(structured.itemName || ""),
      invoiceNumber: normalizeNumber(structured.invoiceNumber),
      invoiceDate: normalizeDateValue(structured.date),
      amount: toMoney(structured.amount),
      taxAmount:
        structured.taxAmount === undefined
          ? null
          : Math.round(structured.taxAmount * 100) / 100,
      lineItems: includeLineItems
        ? normalizeStructuredInvoiceLineItems(structured)
        : [],
    },
    internalEvidence: {
      buyerTaxId: normalizeTaxId(structured.buyerTaxId),
      sellerTaxId: normalizeTaxId(structured.sellerTaxId),
      amountSign: status.amountSign,
      taxExempt: /免\s*税|不\s*征\s*税/u.test(rawText),
    },
    status,
    isValidInvoice: parseInvoiceText(rawText).isValidInvoice,
    conflicts: [],
  };
}

function structuredInvoiceLines(structured: XmlInvoiceResult): PaddleOcrLine[] {
  return (structured.positionedTextNodes || []).map((node) => ({
    text: node.text,
    confidence: 100,
    box: [
      [node.left, node.top],
      [node.left + node.width, node.top],
      [node.left + node.width, node.top + (node.height || 14)],
      [node.left, node.top + (node.height || 14)],
    ],
  }));
}

async function recognizeInvoiceDocument(
  filePath: string,
  format: ContractFinancialFileFormat,
  context: ContractFinancialOcrContext,
): Promise<ContractInvoiceOcrResult> {
  let renderedPage: RenderedContractFinancialPdfPage | null = null;
  try {
    if (format === "pdf") {
      const [pageCount, structured] = await Promise.all([
        getContractFinancialPdfPageCount(filePath),
        extractInvoiceFromXml(filePath),
      ]);
      if (
        pageCount === 1 &&
        structured &&
        hasTrustedStructuredInvoiceLayoutEvidence(
          structured,
          Boolean(context.allowTaxExemptInvoice),
        )
      ) {
        return await recognizePreparedInvoiceDocument(
          filePath,
          filePath,
          format,
          context,
          pageCount,
          structured,
        );
      }
      renderedPage = await renderContractFinancialPdfFirstPage(filePath);
    }
    return await recognizePreparedInvoiceDocument(
      filePath,
      renderedPage?.imagePath || filePath,
      format,
      context,
      renderedPage?.pageCount || 1,
    );
  } finally {
    await renderedPage?.cleanup();
  }
}

async function recognizePreparedInvoiceDocument(
  originalFilePath: string,
  ocrFilePath: string,
  format: ContractFinancialFileFormat,
  context: ContractFinancialOcrContext,
  pageCount: number,
  structuredFast?: XmlInvoiceResult,
): Promise<ContractInvoiceOcrResult> {
  const warnings: string[] = [];
  const detailed = structuredFast
    ? {
        fullText: structuredFast.rawText || "",
        lines: structuredInvoiceLines(structuredFast),
      }
    : await callPaddleOcrDetailed(ocrFilePath);
  const text =
    detailed.fullText || detailed.lines.map((line) => line.text).join("\n");
  const hasInvoiceDocumentTypeEvidence = structuredFast
    ? hasTrustedStructuredInvoiceLayoutEvidence(
        structuredFast,
        Boolean(context.allowTaxExemptInvoice),
      )
    : hasVisibleOcrInvoiceTitleEvidence(text, detailed.lines);
  if (!hasInvoiceDocumentTypeEvidence) {
    return failedResult(
      "invoice",
      format,
      blockingReason(
        "INVOICE_DOCUMENT_TYPE_MISMATCH",
        "此不是有效发票",
        "documentType",
      ),
      "document",
    );
  }
  const primary = structuredFast
    ? structuredInvoiceChannel(
        structuredFast,
        Boolean(context.requireInvoiceLineItems),
      )
    : parseInvoiceRecognitionChannel(text, detailed.lines);
  const fields = primary.fields;
  const internalEvidence = primary.internalEvidence;
  const statusResult = primary.status;

  let independent: InvoiceChannelRecognition | null = null;
  let independentSource = "Tesseract（开源文字识别）独立通道";
  if (format === "pdf" && !structuredFast) {
    independentSource = "PDF（便携式文档格式）电子文字层";
    try {
      const structuredText =
        await extractContractFinancialPdfFirstPageTextLayer(originalFilePath);
      if (structuredText.trim()) {
        independent = parseInvoiceRecognitionChannel(structuredText, []);
      }
    } catch (error) {
      if (isFinancialOcrInfrastructureError(error)) throw error;
      warnings.push(
        "PDF（便携式文档格式）电子文字层不可用，本次结果不得自动入账",
      );
    }
  } else if (!structuredFast) {
    try {
      const tesseract = await callTesseractOcrDetailed(ocrFilePath, {
        preserveInterwordSpaces: true,
      });
      const tesseractText =
        tesseract.fullText ||
        tesseract.lines.map((line) => line.text).join("\n");
      if (tesseractText.trim()) {
        independent = parseInvoiceRecognitionChannel(
          tesseractText,
          mapTesseractLines(tesseract.lines),
        );
      }
    } catch (error) {
      if (isFinancialOcrInfrastructureError(error)) throw error;
      warnings.push(
        "Tesseract（开源文字识别）独立通道不可用，本次结果不得自动入账",
      );
    }
  }

  const direction = invoiceDirection(
    fields.seller,
    internalEvidence.sellerTaxId,
    fields.buyer,
    internalEvidence.buyerTaxId,
    context,
  );
  const meta = buildRecognitionMeta(
    text,
    detailed.lines,
    structuredFast
      ? "pdf_structured_fast"
      : format === "pdf" && independent !== null
        ? "pdf_structured_and_paddle"
        : independent !== null
          ? "paddle_and_tesseract"
          : "paddle_ocr",
  );
  const reasons = [
    ...primary.conflicts,
    ...confidenceReasons(meta, context),
    ...(structuredFast
      ? []
      : compareInvoiceIndependentEvidence(
          primary,
          independent,
          independentSource,
          Boolean(context.allowTaxExemptInvoice),
        )),
  ];
  if (format === "pdf" && pageCount !== 1) {
    reasons.push(
      blockingReason(
        "INDEPENDENT_EVIDENCE_MISSING",
        "多页 PDF（便携式文档格式）发票当前仅复核第一页，禁止自动入账",
        "pageCount",
      ),
    );
  }

  if (!primary.isValidInvoice) {
    reasons.push(
      blockingReason(
        "INVOICE_NOT_RECOGNIZED",
        "正文未通过发票真实性与核心结构校验",
      ),
    );
  }
  if (statusResult.conflict) {
    reasons.push(
      blockingReason(
        "DOCUMENT_STATUS_CONFLICT",
        "正文同时出现作废与红字或负数特征，凭证状态冲突",
      ),
    );
  } else if (statusResult.status === "void") {
    reasons.push(blockingReason("INVOICE_VOID", "作废发票禁止自动入账"));
  } else if (statusResult.status === "red") {
    reasons.push(blockingReason("INVOICE_RED", "红字或负数发票禁止自动入账"));
  } else if (statusResult.status === "unknown") {
    reasons.push(
      blockingReason("DOCUMENT_STATUS_UNKNOWN", "无法确认发票凭证状态"),
    );
  }

  addMissingReason(
    reasons,
    !!fields.invoiceNumber,
    "INVOICE_NUMBER_MISSING",
    "invoiceNumber",
    "发票号码",
  );
  addMissingReason(
    reasons,
    !!fields.invoiceDate,
    "INVOICE_DATE_MISSING",
    "invoiceDate",
    "开票日期",
  );
  addMissingReason(
    reasons,
    !!fields.itemName,
    "INVOICE_ITEM_NAME_MISSING",
    "itemName",
    "开票名称",
  );
  addMissingReason(
    reasons,
    fields.amount > 0,
    "INVOICE_AMOUNT_MISSING",
    "amount",
    "价税合计金额",
  );
  addMissingReason(
    reasons,
    !!fields.seller,
    "INVOICE_SELLER_MISSING",
    "seller",
    "销方名称",
  );
  addMissingReason(
    reasons,
    !!internalEvidence.sellerTaxId,
    "INVOICE_SELLER_TAX_ID_MISSING",
    "direction",
    "销方纳税人识别号",
  );
  addMissingReason(
    reasons,
    !!fields.buyer,
    "INVOICE_BUYER_MISSING",
    "buyer",
    "购方名称",
  );
  addMissingReason(
    reasons,
    !!internalEvidence.buyerTaxId,
    "INVOICE_BUYER_TAX_ID_MISSING",
    "direction",
    "购方纳税人识别号",
  );
  const taxExemptInvoice = Boolean(
    context.allowTaxExemptInvoice &&
    fields.taxAmount === null &&
    /免税|不征税/u.test(`${fields.itemName} ${text}`),
  );
  addMissingReason(
    reasons,
    fields.taxAmount !== null || taxExemptInvoice,
    "INVOICE_TAX_AMOUNT_MISSING",
    "taxAmount",
    "税额",
  );
  if (fields.taxAmount !== null && fields.taxAmount > fields.amount) {
    reasons.push(
      blockingReason(
        "INVOICE_TAX_AMOUNT_INVALID",
        "税额大于价税合计金额",
        "taxAmount",
      ),
    );
  }
  if (context.requireInvoiceLineItems) {
    if (fields.lineItems.length === 0) {
      reasons.push(
        blockingReason(
          "INVOICE_LINE_ITEMS_MISSING",
          "未能可靠拆分房屋租赁发票明细，禁止自动入账",
          "lineItems",
        ),
      );
    } else {
      const incompleteLine = fields.lineItems.some(
        (item) =>
          item.recognitionStatus !== "verified" ||
          item.netAmount === null ||
          item.taxAmount === null ||
          item.grossAmount === null ||
          Math.round(item.netAmount * 100) +
            Math.round(item.taxAmount * 100) !==
            Math.round(item.grossAmount * 100),
      );
      if (incompleteLine) {
        reasons.push(
          blockingReason(
            "INVOICE_LINE_ITEM_REVIEW_REQUIRED",
            "发票明细名称、金额、税额或自动分类无法可靠确认，已标记待核对",
            "lineItems",
          ),
        );
      }
      const lineGrossTotalCents = fields.lineItems.reduce(
        (sum, item) => sum + Math.round(Number(item.grossAmount || 0) * 100),
        0,
      );
      if (lineGrossTotalCents !== Math.round(fields.amount * 100)) {
        reasons.push(
          blockingReason(
            "INVOICE_LINE_TOTAL_MISMATCH",
            "发票明细含税金额合计与价税合计不一致，禁止自动入账",
            "lineItems",
          ),
        );
      }
    }
  }
  const configuredCompanyNames = companyIdentitySet(context);
  const configuredCompanyTaxIds = companyTaxIdSet(context);
  if (configuredCompanyTaxIds.size === 0) {
    reasons.push(
      blockingReason(
        "COMPANY_TAX_ID_NOT_CONFIGURED",
        "未配置公司纳税人识别号，禁止自动判断发票方向",
        "direction",
      ),
    );
  }
  if (configuredCompanyTaxIds.size > 0) {
    for (const [name, taxId, label] of [
      [fields.seller, internalEvidence.sellerTaxId, "销方"],
      [fields.buyer, internalEvidence.buyerTaxId, "购方"],
    ] as const) {
      const nameMatches = configuredCompanyNames.has(normalizeIdentity(name));
      const taxIdMatches = configuredCompanyTaxIds.has(normalizeTaxId(taxId));
      if (nameMatches !== taxIdMatches) {
        reasons.push(
          blockingReason(
            "COMPANY_TAX_ID_MISMATCH",
            `${label}名称与纳税人识别号未共同匹配同一公司主体`,
            "direction",
          ),
        );
      }
    }
  }
  if (direction === "unknown") {
    reasons.push(
      blockingReason(
        "INVOICE_DIRECTION_UNKNOWN",
        "无法根据公司主体精确判断发票方向",
        "direction",
      ),
    );
  } else if (direction === "third_party") {
    reasons.push(
      blockingReason(
        "INVOICE_THIRD_PARTY",
        "发票购销双方均不是已配置公司主体，禁止自动入账",
        "direction",
      ),
    );
  }

  const finalReasons = uniqueReasons(reasons);
  return {
    kind: "invoice",
    format,
    documentStatus: statusResult.status,
    direction,
    validationStatus: finalReasons.length === 0 ? "verified" : "blocked",
    canAutoPost: finalReasons.length === 0,
    fields,
    blockingReasons: finalReasons,
    warnings,
    recognition: meta,
  };
}

async function recognizeBankReceiptDocument(
  filePath: string,
  format: ContractFinancialFileFormat,
  context: ContractFinancialOcrContext,
): Promise<ContractBankReceiptOcrResult> {
  let renderedPage: RenderedContractFinancialPdfPage | null = null;
  try {
    if (format === "pdf") {
      renderedPage = await renderContractFinancialPdfFirstPage(filePath);
    }
    return await recognizePreparedBankReceiptDocument(
      renderedPage?.imagePath || filePath,
      format,
      context,
      renderedPage?.pageCount || 1,
    );
  } finally {
    await renderedPage?.cleanup();
  }
}

async function recognizePreparedBankReceiptDocument(
  ocrFilePath: string,
  format: ContractFinancialFileFormat,
  context: ContractFinancialOcrContext,
  pageCount: number,
): Promise<ContractBankReceiptOcrResult> {
  const warnings: string[] = [];
  // 银行回单统一使用已固定部署的 PP-OCRv6_medium（第六版中型模型）。
  // 不再调用 Tesseract（开源文字识别）或把第二引擎结果作为放行依据。
  const detailed = await callPaddleOcrDetailed(ocrFilePath, "v6_medium");
  const text =
    detailed.fullText || detailed.lines.map((line) => line.text).join("\n");
  if (!hasVisibleBankReceiptTitleEvidence(text, detailed.lines)) {
    return failedResult(
      "bank_receipt",
      format,
      blockingReason(
        "BANK_RECEIPT_DOCUMENT_TYPE_MISMATCH",
        "此不是有效回单",
        "documentType",
      ),
      "document",
    );
  }
  const primary = parseBankRecognitionChannel(text, detailed.lines);
  let fields = primary.fields;
  const status = primary.status;
  const enhancedConflicts: ContractFinancialBlockingReason[] = [];
  const missingRoleFields = (
    ["payer", "payerAccount", "payee", "payeeAccount"] as const
  ).filter((field) => !fields[field]);
  if (status === "normal" && pageCount === 1 && missingRoleFields.length > 0) {
    const enhancedRegion = await createEnhancedBankRoleRegion(
      ocrFilePath,
      detailed.lines,
    );
    if (enhancedRegion) {
      try {
        const enhanced = await callPaddleOcrDetailed(
          enhancedRegion.filePath,
          "v6_medium",
        );
        const enhancedModelMatches =
          enhanced.modelVersion === "v6_medium" &&
          enhanced.lines.every(
            (line) => !line.modelVersion || line.modelVersion === "v6_medium",
          );
        if (!enhancedModelMatches) {
          enhancedConflicts.push(
            blockingReason(
              "BANK_ENHANCED_OCR_MODEL_MISMATCH",
              "回单主体增强复扫未完整使用PP-OCRv6_medium，禁止采用增强值",
              "recognitionModel",
            ),
          );
        } else {
          const originalEvidence = extractExplicitBankRoleEvidence(
            detailed.lines,
          );
          const enhancedEvidence = extractExplicitBankRoleEvidence(
            enhanced.lines,
          );
          const merged = mergeEnhancedBankRoleEvidence(
            fields,
            originalEvidence,
            enhancedEvidence,
          );
          fields = merged.fields;
          enhancedConflicts.push(...merged.conflicts);
          warnings.push(
            merged.recoveredFields.length > 0
              ? `回单主体区域已执行一次灰度对比度增强复扫，恢复字段：${merged.recoveredFields.map(bankRoleFieldLabel).join("、")}`
              : "回单主体区域已执行一次灰度对比度增强复扫，未形成可安全采用的新字段",
          );
        }
      } catch {
        warnings.push(
          "回单主体区域增强复扫暂不可用，保留整图识别结果并安全阻断",
        );
      } finally {
        await enhancedRegion.cleanup().catch(() => undefined);
      }
    } else {
      warnings.push(
        "回单主体区域无法生成受限增强图，保留整图识别结果并安全阻断",
      );
    }
  }

  const direction = bankDirection(fields.payer, fields.payee, context);
  const meta = buildRecognitionMeta(text, detailed.lines, "paddle_ocr");
  const modelVersionMatches =
    detailed.modelVersion === "v6_medium" &&
    detailed.lines.every(
      (line) => !line.modelVersion || line.modelVersion === "v6_medium",
    );
  const reasons = [
    ...primary.conflicts,
    ...enhancedConflicts,
    ...confidenceReasons(meta, context),
  ];
  if (!modelVersionMatches) {
    reasons.push(
      blockingReason(
        "BANK_OCR_MODEL_MISMATCH",
        "银行回单未由 PP-OCRv6_medium（第六版中型模型）完整识别，禁止自动入账",
        "recognitionModel",
      ),
    );
  }
  if (format === "pdf" && pageCount !== 1) {
    reasons.push(
      blockingReason(
        "BANK_RECEIPT_PAGE_COUNT_UNSUPPORTED",
        "多页 PDF（便携式文档格式）银行回单当前仅识别第一页，禁止自动入账",
        "pageCount",
      ),
    );
  }

  if (status === "void") {
    reasons.push(
      blockingReason("BANK_RECEIPT_VOID", "作废银行回单禁止自动入账"),
    );
  } else if (status === "unknown") {
    reasons.push(
      blockingReason(
        "BANK_RECEIPT_NOT_RECOGNIZED",
        "正文缺少银行电子回单真实性特征",
      ),
    );
  }
  addMissingReason(
    reasons,
    !!fields.paymentTime,
    "BANK_PAYMENT_TIME_MISSING",
    "paymentTime",
    "付款时间",
  );
  addMissingReason(
    reasons,
    fields.amount > 0,
    "BANK_AMOUNT_MISSING",
    "amount",
    "回单金额",
  );
  addMissingReason(
    reasons,
    !!fields.electronicReceiptNo,
    "BANK_ELECTRONIC_RECEIPT_NO_MISSING",
    "electronicReceiptNo",
    "电子回单号码",
  );
  addMissingReason(
    reasons,
    !!fields.payer,
    "BANK_PAYER_MISSING",
    "payer",
    "付款方",
  );
  addMissingReason(
    reasons,
    !!fields.payerAccount,
    "BANK_PAYER_ACCOUNT_MISSING",
    "payerAccount",
    "付款账号",
  );
  addMissingReason(
    reasons,
    !!fields.payee,
    "BANK_PAYEE_MISSING",
    "payee",
    "收款方",
  );
  addMissingReason(
    reasons,
    !!fields.payeeAccount,
    "BANK_PAYEE_ACCOUNT_MISSING",
    "payeeAccount",
    "收款账号",
  );
  if (
    fields.payerAccount &&
    fields.payeeAccount &&
    fields.payerAccount === fields.payeeAccount
  ) {
    reasons.push(
      blockingReason(
        "BANK_ACCOUNT_CONFLICT",
        "付款账号与收款账号相同，无法确认交易方向",
      ),
    );
  }
  if (direction === "unknown") {
    reasons.push(
      blockingReason(
        "BANK_DIRECTION_UNKNOWN",
        "付款人和收款人均未匹配或同时匹配本公司名称，无法判断回款或付款方向",
        "direction",
      ),
    );
  }

  const finalReasons = uniqueReasons(reasons);
  return {
    kind: "bank_receipt",
    format,
    documentStatus: status,
    direction,
    validationStatus: finalReasons.length === 0 ? "verified" : "blocked",
    canAutoPost: finalReasons.length === 0,
    fields,
    blockingReasons: finalReasons,
    warnings,
    recognition: meta,
  };
}

function failedResult(
  kind: "invoice",
  format: ContractFinancialFileFormat | null,
  reason: ContractFinancialBlockingReason,
  failureKind: "infrastructure" | "document" | "recognition",
): ContractInvoiceOcrResult;
function failedResult(
  kind: "bank_receipt",
  format: ContractFinancialFileFormat | null,
  reason: ContractFinancialBlockingReason,
  failureKind: "infrastructure" | "document" | "recognition",
): ContractBankReceiptOcrResult;
function failedResult(
  kind: ContractFinancialDocumentKind,
  format: ContractFinancialFileFormat | null,
  reason: ContractFinancialBlockingReason,
  failureKind: "infrastructure" | "document" | "recognition",
): ContractFinancialOcrResult;
function failedResult(
  kind: ContractFinancialDocumentKind,
  format: ContractFinancialFileFormat | null,
  reason: ContractFinancialBlockingReason,
  failureKind: "infrastructure" | "document" | "recognition",
): ContractFinancialOcrResult {
  if (kind === "invoice") {
    return {
      kind,
      format,
      failureKind,
      documentStatus: "unknown",
      direction: "unknown",
      validationStatus: "failed",
      canAutoPost: false,
      fields: emptyInvoiceFields(),
      blockingReasons: [reason],
      warnings: [],
      recognition: null,
    };
  }
  return {
    kind,
    format,
    failureKind,
    documentStatus: "unknown",
    direction: "unknown",
    validationStatus: "failed",
    canAutoPost: false,
    fields: emptyBankFields(),
    blockingReasons: [reason],
    warnings: [],
    recognition: null,
  };
}

/**
 * 识别单份合同财务凭证。
 *
 * 文件名只用于定位文件，任何日期、金额、号码、状态和方向均来自凭证正文。
 * 方法不写完整识别原文日志，识别异常统一返回不可自动入账结果。
 */
export async function recognizeContractFinancialDocument(
  input: ContractFinancialOcrInput,
): Promise<ContractFinancialOcrResult> {
  let format: ContractFinancialFileFormat | null = null;
  try {
    format = await detectContractFinancialFileFormat(input.filePath);
    if (!format) {
      return failedResult(
        input.kind,
        null,
        blockingReason(
          "UNSUPPORTED_FINANCIAL_FILE_FORMAT",
          "财务凭证真实格式必须为 PDF、JPG、JPEG 或 PNG",
        ),
        "document",
      );
    }
    const context = input.context || {};
    return input.kind === "invoice"
      ? await recognizeInvoiceDocument(input.filePath, format, context)
      : await recognizeBankReceiptDocument(input.filePath, format, context);
  } catch (error) {
    const infrastructureFailure = isFinancialOcrInfrastructureError(error);
    return failedResult(
      input.kind,
      format,
      blockingReason(
        infrastructureFailure
          ? "FINANCIAL_OCR_INFRASTRUCTURE_FAILED"
          : "FINANCIAL_OCR_FAILED",
        infrastructureFailure
          ? "财务凭证识别基础设施暂时不可用，可稍后重试"
          : "财务凭证识别失败，禁止自动入账",
      ),
      infrastructureFailure ? "infrastructure" : "recognition",
    );
  }
}

/**
 * 串行批量识别。共用 OCR 常驻进程一次只能安全处理一份文件，串行执行可避免
 * 调用方误以为并发会提高速度，也确保某一文件失败不会中断剩余文件。
 */
export async function recognizeContractFinancialDocuments(
  inputs: readonly ContractFinancialOcrInput[],
): Promise<ContractFinancialBatchResult[]> {
  const results: ContractFinancialBatchResult[] = [];
  for (const input of inputs) {
    results.push({
      filePath: input.filePath,
      result: await recognizeContractFinancialDocument(input),
    });
  }
  return results;
}
