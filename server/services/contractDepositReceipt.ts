import crypto from "crypto";

import { renderContractFinancialPdfFirstPage } from "./contractFinancialEvidence.js";
import { parseChineseUppercaseAmount } from "./contractOcr.js";
import {
  callPaddleOcrDetailed,
  normalizePaddleOcrModelVersion,
  resolvePaddleOcrModel,
} from "./ocrDaemon.js";
import { centsToAmount, toCents } from "./contractAccounting.js";

export type ContractDepositReceiptOcrStatus =
  | "recognized"
  | "unrecognized"
  | "failed";

export interface ContractDepositReceiptRecognition {
  status: ContractDepositReceiptOcrStatus;
  amount: number | null;
  engineVersion: string | null;
  textSha256: string | null;
  evidence: string[];
  failureMessage: string | null;
}

export function canConfirmContractDepositAmount(
  paymentAmount: number,
  otherConfirmedDepositAmount: number,
  requestedDepositAmount: number,
): boolean {
  return (
    toCents(String(otherConfirmedDepositAmount)) +
      toCents(String(requestedDepositAmount)) <=
    toCents(String(paymentAmount))
  );
}

export function calculatePaymentInvoiceRequiredAmount(
  paymentAmount: number,
  confirmedDepositAmount: number,
): number {
  return centsToAmount(
    Math.max(
      0,
      toCents(String(paymentAmount)) - toCents(String(confirmedDepositAmount)),
    ),
  );
}

const DEPOSIT_LABEL_PATTERN =
  /(?:租赁|房屋|车辆|车位|履约|质量)?(?:押金|保证金|质保金)/u;
const DOCUMENT_LABEL_PATTERN = /(?:押金条|押金收据|保证金收据|保证金凭证)/u;
const ARABIC_AMOUNT_PATTERN =
  /(?:人民币\s*)?[￥¥]?\s*(\d{1,3}(?:[,，]\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(万)?\s*元?/gu;
const CHINESE_AMOUNT_PATTERN =
  /(?:人民币\s*)?[零〇一二三四五六七八九壹贰貳两兩参叁參肆伍陆陸柒捌玖十拾百佰千仟任万萬亿億兆元圆圓角分整正]+/gu;

function validAmount(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

function amountsInText(value: string): number[] {
  const amounts: number[] = [];
  const normalized = value.normalize("NFKC");
  for (const match of normalized.matchAll(ARABIC_AMOUNT_PATTERN)) {
    const parsed = Number(String(match[1] || "").replace(/[,，]/g, ""));
    const amount = validAmount(parsed * (match[2] ? 10_000 : 1));
    if (amount !== null) amounts.push(amount);
  }
  for (const match of normalized.matchAll(CHINESE_AMOUNT_PATTERN)) {
    const amount = validAmount(parseChineseUppercaseAmount(match[0]) || 0);
    if (amount !== null) amounts.push(amount);
  }
  return [...new Set(amounts)];
}

/**
 * 只从押金语义附近提取金额。若存在多个不同候选则保持待人工确认，
 * 禁止使用“付款金额减发票金额”的差额反推押金。
 */
export function extractContractDepositAmount(text: string): {
  amount: number | null;
  evidence: string[];
} {
  const lines = String(text || "")
    .normalize("NFKC")
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const candidates = new Map<number, string[]>();
  const addEvidence = (amount: number, evidence: string): void => {
    const current = candidates.get(amount) || [];
    if (!current.includes(evidence)) current.push(evidence);
    candidates.set(amount, current);
  };

  lines.forEach((line, index) => {
    if (!DEPOSIT_LABEL_PATTERN.test(line)) return;
    const window = [line, lines[index + 1] || ""].filter(Boolean).join(" ");
    for (const amount of amountsInText(window)) addEvidence(amount, window);
  });

  if (
    candidates.size === 0 &&
    lines.some((line) => DOCUMENT_LABEL_PATTERN.test(line))
  ) {
    const genericAmountLines = lines.filter((line) =>
      /(?:金额|人民币|￥|¥)/u.test(line),
    );
    for (const line of genericAmountLines) {
      for (const amount of amountsInText(line)) addEvidence(amount, line);
    }
  }

  if (candidates.size !== 1) {
    return {
      amount: null,
      evidence: [...candidates.values()].flat().slice(0, 8),
    };
  }
  const [amount, evidence] = [...candidates.entries()][0]!;
  return { amount, evidence: evidence.slice(0, 4) };
}

export async function recognizeContractDepositReceipt(
  filePath: string,
  mimeType: string,
): Promise<ContractDepositReceiptRecognition> {
  let rendered:
    | Awaited<ReturnType<typeof renderContractFinancialPdfFirstPage>>
    | undefined;
  try {
    const imagePath =
      mimeType === "application/pdf"
        ? (rendered = await renderContractFinancialPdfFirstPage(filePath))
            .imagePath
        : filePath;
    const requestedModel = resolvePaddleOcrModel();
    const result = await callPaddleOcrDetailed(imagePath, requestedModel);
    const parsed = extractContractDepositAmount(result.fullText);
    return {
      status: parsed.amount === null ? "unrecognized" : "recognized",
      amount: parsed.amount,
      engineVersion: normalizePaddleOcrModelVersion(
        result.modelVersion,
        requestedModel,
      ),
      textSha256: crypto
        .createHash("sha256")
        .update(result.fullText)
        .digest("hex"),
      evidence: parsed.evidence,
      failureMessage:
        parsed.amount === null ? "未能从押金条中唯一识别押金金额" : null,
    };
  } catch (error) {
    return {
      status: "failed",
      amount: null,
      engineVersion: null,
      textSha256: null,
      evidence: [],
      failureMessage: error instanceof Error ? error.message : "押金条识别失败",
    };
  } finally {
    await rendered?.cleanup();
  }
}
