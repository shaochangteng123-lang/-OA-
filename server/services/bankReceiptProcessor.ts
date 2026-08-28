/**
 * 工行付款回单 PDF 自动化处理服务
 * 流程：PDF → 图片 → 用XML分割线坐标切割单笔 → OCR识别备注+金额 → 匹配报销单
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import sharp from "sharp";
import type { PoolClient } from "pg";
import { callPaddleOcr } from "./ocrDaemon.js";
import {
  extractPaymentProofPartyAccounts,
  parsePaymentProofText,
} from "./paymentProofOcr.js";
import { nanoid } from "nanoid";
import {
  accountMatches,
  nameMatches,
  recipientMatches,
} from "../utils/bank-receipt-match.js";
import { isValidBankBusinessDate } from "../utils/bank-business-date.js";
import {
  findExistingPaymentProofIdentity,
  lockPaymentProofIdentities,
  normalizePaymentProofNo,
} from "../utils/payment-proof-identity.js";

export { isValidBankBusinessDate } from "../utils/bank-business-date.js";

export interface BankReceiptOcrResult {
  payer: string; // 付款人
  payerAccount: string; // 付款账号
  payee: string; // 收款人
  payeeAccount: string; // 收款账号
  amount: number; // 金额
  remark: string; // 备注原文
  proofNo: string; // 电子回单号
  transactionDate: string; // 银行实际交易日期（YYYY-MM-DD）
  transactionDateCandidates: string[]; // 回单内全部交易日期候选
  rawText: string;
}

export interface ParsedRemark {
  type: "basic" | "large" | "business" | null;
  name: string;
  month: string; // 格式 YYYY-MM
}

export interface ReceiptMatchResult {
  receiptId: string;
  imagePath: string;
  ocrResult: BankReceiptOcrResult;
  parsed: ParsedRemark;
  matchStatus: "matched" | "unmatched";
  matchedReimbursementId?: string; // 单笔匹配时使用（兼容旧逻辑）
  matchedReimbursementIds?: string[]; // 多笔合并匹配时使用
}

function bankAmountToCents(value: unknown): number {
  const amount = Number(value || 0);
  const rawCents = amount * 100;
  const cents = Math.round(rawCents);
  if (
    !Number.isFinite(amount) ||
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    Math.abs(rawCents - cents) > 1e-6
  ) {
    throw new Error("银行回单金额无效");
  }
  return cents;
}

function bankAmountToExactCents(value: unknown): bigint {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[,，￥¥\s]/gu, "");
  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/u);
  if (!match) throw new Error("银行回单金额必须精确到分");
  const cents =
    BigInt(match[1]) * 100n + BigInt((match[2] || "").padEnd(2, "0"));
  if (cents <= 0n) throw new Error("银行回单金额无效");
  return cents;
}

async function loadBankReceiptDb() {
  return (await import("../db/index.js")).db;
}

// ==================== PDF 处理 ====================

/**
 * 解析单页 XML，返回：
 *   hasContent: 该页是否有内容（有图片嵌入）
 *   splitY: 双笔分割线的 Y 坐标（null 表示单笔）
 */
export function analyzePageXml(
  pdfPath: string,
  pageNo: number,
): { hasContent: boolean; splitY: number | null } {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bank-receipt-xml-"),
  );
  try {
    const xmlPath = path.join(tempDirectory, `page-${pageNo}`);
    execSync(
      `pdftohtml -xml -f ${pageNo} -l ${pageNo} "${pdfPath}" "${xmlPath}" 2>/dev/null`,
      { timeout: 10000 },
    );
    const xmlFile = `${xmlPath}.xml`;
    if (!fs.existsSync(xmlFile)) return { hasContent: false, splitY: null };

    const xml = fs.readFileSync(xmlFile, "utf-8");

    // 简化：直接匹配所有 image 标签
    const allImages = [...xml.matchAll(/<image[^>]+>/g)];

    // 没有任何嵌入图片 → 空白页
    if (allImages.length === 0) return { hasContent: false, splitY: null };

    // 从 <page> 标签获取页面高度，避免误匹配 image 标签的 height
    const pageHeightMatch = xml.match(/<page[^>]+height="(\d+)"/);
    const pageHeight = pageHeightMatch ? parseInt(pageHeightMatch[1]) : 1262;

    // 找细线（height<=3），顶部那条(top≈81)是页眉线，中间那条(top≈660-690)是双笔分割线
    const thinLineMatches = [
      ...xml.matchAll(/<image[^>]+top="(\d+)"[^>]+height="(\d+)"/g),
    ];
    const thinLines = thinLineMatches
      .filter((m) => parseInt(m[2]) <= 3)
      .map((m) => parseInt(m[1]))
      .sort((a, b) => a - b);
    // 过滤掉顶部页眉线（top < 20% pageHeight），只保留中间分割线
    const midLines = thinLines.filter(
      (y) => y > pageHeight * 0.2 && y < pageHeight * 0.8,
    );

    return {
      hasContent: true,
      splitY: midLines.length > 0 ? midLines[0] : null,
    };
  } catch {
    return { hasContent: false, splitY: null };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

/**
 * 按 Y 坐标切割图片为上下两张
 * splitY 是 PDF 坐标系中的值，需要按比例换算到图片像素
 */
export async function splitImage(
  imagePath: string,
  splitY: number,
  pdfPageHeight: number,
  outputDir: string,
  baseName: string,
  options: {
    detectWhitespaceBoundary?: boolean;
    trimWhitespace?: boolean;
  } = {},
): Promise<{ top: string; bottom: string }> {
  const meta = await sharp(imagePath).metadata();
  const imgHeight = meta.height || 1754;
  const imgWidth = meta.width || 1240;

  // PDF坐标 → 图片像素
  const approximateSplitPixel = Math.round(
    (splitY / pdfPageHeight) * imgHeight,
  );
  const splitPixel = options.detectWhitespaceBoundary
    ? await detectReceiptWhitespaceSplitPixel(
        imagePath,
        approximateSplitPixel,
        imgWidth,
        imgHeight,
      )
    : Math.max(1, Math.min(imgHeight - 1, approximateSplitPixel));

  const topPath = path.join(outputDir, `${baseName}_top.jpg`);
  const bottomPath = path.join(outputDir, `${baseName}_bottom.jpg`);

  await writeReceiptCrop(
    imagePath,
    { left: 0, top: 0, width: imgWidth, height: splitPixel },
    topPath,
    Boolean(options.trimWhitespace),
  );
  await writeReceiptCrop(
    imagePath,
    {
      left: 0,
      top: splitPixel,
      width: imgWidth,
      height: imgHeight - splitPixel,
    },
    bottomPath,
    Boolean(options.trimWhitespace),
  );

  return { top: topPath, bottom: bottomPath };
}

export function findReceiptWhitespaceSplitPixel(
  rowInkCounts: readonly number[],
  imageWidth: number,
  approximateSplitPixel: number,
): number {
  const imageHeight = rowInkCounts.length;
  if (imageHeight < 2) return 1;
  const fallback = Math.max(
    1,
    Math.min(imageHeight - 1, Math.round(approximateSplitPixel)),
  );
  const searchRadius = Math.max(40, Math.round(imageHeight * 0.18));
  const searchStart = Math.max(1, fallback - searchRadius);
  const searchEnd = Math.min(imageHeight - 2, fallback + searchRadius);
  const maxBlankInk = Math.max(1, Math.floor(imageWidth * 0.001));
  const minimumGapHeight = Math.max(6, Math.round(imageHeight * 0.008));
  const gaps: Array<{ start: number; end: number }> = [];
  let gapStart = -1;

  for (let row = searchStart; row <= searchEnd + 1; row += 1) {
    const isBlank = row <= searchEnd && (rowInkCounts[row] || 0) <= maxBlankInk;
    if (isBlank && gapStart < 0) {
      gapStart = row;
    } else if (!isBlank && gapStart >= 0) {
      const gapEnd = row - 1;
      if (gapEnd - gapStart + 1 >= minimumGapHeight) {
        gaps.push({ start: gapStart, end: gapEnd });
      }
      gapStart = -1;
    }
  }

  const bestGap = gaps.sort((left, right) => {
    const heightDifference = right.end - right.start - (left.end - left.start);
    if (heightDifference !== 0) return heightDifference;
    const leftCenter = (left.start + left.end) / 2;
    const rightCenter = (right.start + right.end) / 2;
    return Math.abs(leftCenter - fallback) - Math.abs(rightCenter - fallback);
  })[0];

  return bestGap
    ? Math.max(
        1,
        Math.min(
          imageHeight - 1,
          Math.round((bestGap.start + bestGap.end) / 2),
        ),
      )
    : fallback;
}

async function detectReceiptWhitespaceSplitPixel(
  imagePath: string,
  approximateSplitPixel: number,
  imageWidth: number,
  imageHeight: number,
): Promise<number> {
  const { data, info } = await sharp(imagePath)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rowInkCounts = new Array<number>(info.height).fill(0);
  for (let row = 0; row < info.height; row += 1) {
    const rowOffset = row * info.width;
    let inkCount = 0;
    for (let column = 0; column < info.width; column += 1) {
      if (data[rowOffset + column]! < 230) inkCount += 1;
    }
    rowInkCounts[row] = inkCount;
  }
  return findReceiptWhitespaceSplitPixel(
    rowInkCounts,
    imageWidth,
    Math.round((approximateSplitPixel / imageHeight) * info.height),
  );
}

async function writeReceiptCrop(
  imagePath: string,
  region: { left: number; top: number; width: number; height: number },
  outputPath: string,
  trimWhitespace: boolean,
): Promise<void> {
  const extracted = await sharp(imagePath).extract(region).toBuffer();
  if (!trimWhitespace) {
    await sharp(extracted).jpeg({ quality: 92 }).toFile(outputPath);
    return;
  }
  try {
    const trimmed = await sharp(extracted)
      .trim({ background: "#fff", threshold: 8 })
      .toBuffer();
    const metadata = await sharp(trimmed).metadata();
    const padding = Math.max(
      12,
      Math.min(
        28,
        Math.round(
          Math.min(metadata.width || 600, metadata.height || 800) * 0.025,
        ),
      ),
    );
    await sharp(trimmed)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: "#fff",
      })
      .jpeg({ quality: 92 })
      .toFile(outputPath);
  } catch {
    await sharp(extracted).jpeg({ quality: 92 }).toFile(outputPath);
  }
}

// ==================== OCR 解析 ====================

function extractRemark(text: string): string {
  const noSpace = text.replace(/\s+/g, "");
  // 备注字段
  const patterns = [
    /备注[：:]\s*([^\n]{2,80})/,
    /用途[：:]\s*([^\n]{2,80})/,
    /摘要[：:]\s*([^\n]{2,80})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  // 去空格版本
  const noSpacePatterns = [
    /备注[：:](.{2,80}?)(?:用途|摘要|交易|记账|$)/,
    /用途[：:](.{2,80}?)(?:备注|摘要|交易|记账|$)/,
  ];
  for (const p of noSpacePatterns) {
    const m = noSpace.match(p);
    if (m?.[1]) return m[1];
  }
  return "";
}

function extractAmount(text: string): number {
  const noSpace = text.replace(/\s+/g, "");
  // 小写金额
  const patterns = [
    /金额[（(]?小写[）)]?[：:]?[¥￥]?([\d,，]+\.?\d*)/,
    /金额[：:][¥￥]?([\d,，]+\.?\d*)/,
    /金额[|｜]?[¥￥]?([\d,，]+\.?\d*)/,
  ];
  for (const p of patterns) {
    const m = noSpace.match(p);
    if (m?.[1]) {
      const v = parseFloat(m[1].replace(/[,，]/g, ""));
      if (!isNaN(v) && v > 0) return v;
    }
  }
  // 不从全文任意小数猜测金额，避免把余额、利率或手续费误作票面金额。
  return 0;
}

function extractRoleAccount(text: string, role: "付款" | "收款"): string {
  const lines = text
    .split("\n")
    .map((line) => line.normalize("NFKC").trim())
    .filter(Boolean);
  const roleIndex = lines.findIndex(
    (line) => line === role || line === `${role}人`,
  );
  if (roleIndex < 0) return "";
  const otherRole = role === "付款" ? "收款" : "付款";
  for (
    let index = roleIndex + 1;
    index < Math.min(lines.length, roleIndex + 8);
    index += 1
  ) {
    if (lines[index] === otherRole || lines[index] === `${otherRole}人`) break;
    const compact = lines[index].replace(/\s+/g, "");
    if (/^[0-9*]{6,25}$/u.test(compact) && /\d{6}/u.test(compact)) {
      return compact;
    }
  }
  return "";
}

function extractPayeeAccount(text: string): string {
  const roleAccount = extractRoleAccount(text, "收款");
  if (roleAccount) return roleAccount;
  const patterns = [/收款账号[：:]\s*([0-9\s]+)/, /收款账户[：:]\s*([0-9\s]+)/];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].replace(/\s+/g, "").trim();
  }
  // 提取所有长数字串，优先62开头的个人银行卡号
  const allNumbers = [...text.matchAll(/\b(\d[\d\s]{12,25})\b/g)]
    .map((m) => m[1].replace(/\s+/g, ""))
    .filter((n) => n.length >= 13 && n.length <= 25);
  const personalCard = allNumbers.find(
    (n) => n.startsWith("62") && n.length >= 16 && n.length <= 19,
  );
  if (personalCard) return personalCard;
  if (allNumbers.length >= 2) return allNumbers[1];
  if (allNumbers.length === 1) return allNumbers[0];
  return "";
}

function extractPayerAccount(text: string, payeeAccount: string): string {
  const roleAccount = extractRoleAccount(text, "付款");
  if (roleAccount) return roleAccount;
  const patterns = [
    /付款账号[：:]\s*([0-9\s]+)/,
    /付款账户[：:]\s*([0-9\s]+)/,
    /转出账号[：:]\s*([0-9\s]+)/,
    /转出账户[：:]\s*([0-9\s]+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, "").trim();
  }

  const accounts = [...text.matchAll(/(?<!\d)(\d[\d\s]{11,28}\d)(?!\d)/g)]
    .map((match) => match[1].replace(/\s+/g, ""))
    .filter((value) => value.length >= 13 && value.length <= 25);
  return accounts.find((value) => value !== payeeAccount) || "";
}

function extractPayee(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // 找第二个"户名"后面的内容（兼容OCR在"户"和"名"之间插入干扰字的情况，如"户中名"）
  const allMatches = [
    ...text.matchAll(/户\s*[一-鿿]?\s*名\s*[|｜]?\s*([^\n|]{2,20})/g),
  ];
  if (allMatches.length >= 2) {
    const name = allMatches[1][1].replace(/[|"]/g, "").trim();
    if (name.length >= 2) return name;
  }
  // 找2-4个汉字的人名行
  const firstHuIdx = lines.findIndex(
    (l) => /^户\s*名$/.test(l) || l === "户名",
  );
  if (firstHuIdx >= 2) {
    for (let i = firstHuIdx - 1; i >= 0; i--) {
      const line = lines[i];
      if (
        /^[\u4e00-\u9fff]{2,4}$/.test(line) &&
        !line.match(/公司|集团|银行|回单|付款|收款/)
      ) {
        return line;
      }
    }
  }
  return "";
}

function extractLayoutPartyNames(text: string): {
  payer: string;
  payee: string;
} {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/[|｜"“”]/g, "").trim())
    .filter(Boolean);
  const firstRoleIndex = lines.findIndex((line) =>
    /^(?:户|户名|付款|付款人)$/u.test(line),
  );
  const scope = firstRoleIndex > 0 ? lines.slice(0, firstRoleIndex) : lines;
  const candidates = scope.filter((line) => {
    if (line.length < 2 || line.length > 50 || !/[\u3400-\u9fff]/u.test(line)) {
      return false;
    }
    return !/(?:银行|回单|付款|收款|户名|账号|账户|开户|金额|摘要|用途|交易|人民币|补打|验证码|打印|记账)/u.test(
      line,
    );
  });
  const parties = candidates.slice(-2);
  return {
    payer: parties.length >= 2 ? parties[0]! : "",
    payee: parties.length >= 2 ? parties[1]! : parties[0] || "",
  };
}

function extractProofNo(text: string): string {
  const patterns = [
    /电子回单号码[：:\s]*([A-Za-z0-9][A-Za-z0-9-]{10,30})/,
    /电子回单号[：:\s]*([A-Za-z0-9][A-Za-z0-9-]{10,30})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

export async function recognizeBankReceiptImage(
  imagePath: string,
): Promise<BankReceiptOcrResult> {
  const text = await callPaddleOcr(imagePath);
  const parsed = parsePaymentProofText(text);
  const structuredAccounts = extractPaymentProofPartyAccounts(text);
  const payeeAccount =
    structuredAccounts.payeeAccount ||
    extractPayeeAccount(text) ||
    parsed.payeeAccount;
  const layoutParties = extractLayoutPartyNames(text);
  const parsedPayer = /^(?:付款|付款人|付款方)$/u.test(parsed.payer)
    ? ""
    : parsed.payer;
  return {
    payer: layoutParties.payer || parsedPayer,
    payerAccount:
      structuredAccounts.payerAccount ||
      extractPayerAccount(text, payeeAccount),
    payee: layoutParties.payee || parsed.payee || extractPayee(text),
    payeeAccount,
    amount: parsed.amount || extractAmount(text),
    remark: extractRemark(text),
    proofNo: parsed.electronicReceiptNo || extractProofNo(text),
    transactionDate: parsed.transactionDate,
    transactionDateCandidates: parsed.transactionDateCandidates,
    rawText: text,
  };
}

// ==================== 备注解析 ====================

/**
 * 解析备注字段，提取报销类型、姓名、月份
 * 格式：基础报销-丁禹滨-2026年1月
 */
export function parseRemark(remark: string): ParsedRemark {
  const result: ParsedRemark = { type: null, name: "", month: "" };
  if (!remark) return result;

  const typeMap: Record<string, ParsedRemark["type"]> = {
    基础报销: "basic",
    大额报销: "large",
    商务报销: "business",
  };

  for (const [key, val] of Object.entries(typeMap)) {
    if (remark.includes(key)) {
      result.type = val;
      break;
    }
  }

  // 提取姓名（2-4个汉字）
  const nameMatch = remark.match(/[-\s]+([\u4e00-\u9fff]{2,4})[-\s]/);
  if (nameMatch) result.name = nameMatch[1];

  // 提取月份，支持：2026年1月 / 2026-01 / 202601
  const monthPatterns = [/(\d{4})年(\d{1,2})月/, /(\d{4})[.-](\d{1,2})/];
  for (const p of monthPatterns) {
    const m = remark.match(p);
    if (m) {
      result.month = `${m[1]}-${m[2].padStart(2, "0")}`;
      break;
    }
  }

  return result;
}

// ==================== 匹配逻辑 ====================

/**
 * 回溯算法：从候选列表中找出金额之和等于 target 的子集（转为整数分避免浮点误差）
 * 约束：子集内所有报销单必须是同一报销类型（基础/大额/商务）
 * 返回匹配的 ID 列表，找不到返回 null
 */
function findSubsetByAmount(
  candidates: Array<{ id: string; total_amount: number; type: string }>,
  target: number,
): string[] | null {
  const targetCents = Math.round(target * 100);
  const items = candidates.map((c) => ({
    id: c.id,
    cents: Math.round(Number(c.total_amount) * 100),
    type: c.type,
  }));

  // 先尝试单笔精确匹配（最优先，不限类型约束）
  const single = items.find((item) => item.cents === targetCents);
  if (single) return [single.id];

  // 再尝试多笔组合（回溯，限制最多5笔，避免组合爆炸）
  // 约束：同一子集内所有报销单必须是同一类型
  const reimbursementTypes = ["basic", "large", "business"];
  for (const type of reimbursementTypes) {
    const sameTypeItems = items.filter((item) => item.type === type);
    if (sameTypeItems.length < 2) continue;

    const result: string[] = [];
    function backtrack(
      startIdx: number,
      remaining: number,
      chosen: string[],
    ): boolean {
      if (remaining === 0) {
        result.push(...chosen);
        return true;
      }
      if (
        remaining < 0 ||
        startIdx >= sameTypeItems.length ||
        chosen.length >= 5
      )
        return false;
      for (let i = startIdx; i < sameTypeItems.length; i++) {
        chosen.push(sameTypeItems[i].id);
        if (backtrack(i + 1, remaining - sameTypeItems[i].cents, chosen))
          return true;
        chosen.pop();
      }
      return false;
    }

    if (backtrack(0, targetCents, [])) return result;
  }

  return null;
}

async function matchReimbursement(
  ocr: BankReceiptOcrResult,
  parsed: ParsedRemark,
): Promise<string[] | null> {
  const db = await loadBankReceiptDb();
  const typeMap: Record<string, string> = {
    basic: "basic",
    large: "large",
    business: "business",
  };

  // ==================== 第1级：优先查 payment_batches 联动匹配 ====================
  // 财务在系统里"批量付款"时，已明确记录了哪几笔报销被合并付款
  // 回单金额 = payment_batches.total_amount，且批次内某笔报销的收款人匹配
  if (ocr.amount > 0) {
    const receiptAmountCents = bankAmountToCents(ocr.amount);
    const batches = await db.all<{ id: string; total_amount: number }>(
      `
      SELECT DISTINCT pb.id, pb.total_amount
      FROM payment_batches pb
      JOIN payment_batch_items pbi ON pbi.batch_id = pb.id
      JOIN reimbursements r ON r.id = pbi.reimbursement_id
      JOIN users u ON r.user_id = u.id
      LEFT JOIN employee_profiles ep ON ep.user_id = r.user_id
      WHERE pb.status = 'pending'
        AND r.status IN ('approved', 'paid')
        AND r.is_deleted = false
        AND ROUND(pb.total_amount * 100) = ?
    `,
      receiptAmountCents,
    );

    for (const batch of batches) {
      // 查出该批次内所有报销单及其收款人信息
      const batchItems = await db.all<{
        reimbursement_id: string;
        status: string;
        item_amount: number;
        bank_account_name: string | null;
        bank_account_number: string | null;
      }>(
        `
        SELECT pbi.reimbursement_id, r.status, pbi.amount AS item_amount,
               COALESCE(ep.bank_account_name, u.bank_account_name) as bank_account_name,
               COALESCE(ep.bank_account_number, u.bank_account_number) as bank_account_number
        FROM payment_batch_items pbi
        JOIN reimbursements r ON r.id = pbi.reimbursement_id
        JOIN users u ON r.user_id = u.id
        LEFT JOIN employee_profiles ep ON ep.user_id = r.user_id
        WHERE pbi.batch_id = ?
      `,
        batch.id,
      );

      const itemAmountCents = batchItems.reduce(
        (sum, item) => sum + bankAmountToCents(item.item_amount),
        0,
      );
      // 批次创建时限定同一收款人；这里仍逐笔复核，避免历史脏数据误匹配。
      const personMatched = batchItems.every((item) => {
        return recipientMatches(
          item.bank_account_name || "",
          item.bank_account_number || "",
          ocr.payee || "",
          ocr.payeeAccount || "",
        );
      });

      if (
        batchItems.length > 0 &&
        itemAmountCents === receiptAmountCents &&
        personMatched
      ) {
        const ids = batchItems.map((item) => item.reimbursement_id);
        console.log(`✅ 付款批次联动匹配成功：共 ${ids.length} 笔`);
        return ids;
      }
    }
  }

  // ==================== 第2/3级：单笔 + 回溯组合匹配（兜底） ====================
  // 构建候选报销单查询
  let sql = `
    SELECT r.id, r.total_amount, r.approve_time, r.user_id, r.type,
           COALESCE(ep.bank_account_name, u.bank_account_name) as bank_account_name,
           COALESCE(ep.bank_account_number, u.bank_account_number) as bank_account_number
    FROM reimbursements r
    JOIN users u ON r.user_id = u.id
    LEFT JOIN employee_profiles ep ON ep.user_id = r.user_id
    WHERE r.status = 'paid' AND r.is_deleted = false
  `;
  const params: string[] = [];

  if (parsed.type) {
    sql += ` AND r.type = ?`;
    params.push(typeMap[parsed.type]);
  }

  sql += ` ORDER BY r.approve_time ASC`;

  const candidates = await db.all<{
    id: string;
    total_amount: number;
    approve_time: string;
    type: string;
    user_id: string;
    bank_account_name: string | null;
    bank_account_number: string | null;
  }>(sql, ...params);

  if (candidates.length === 0) return null;

  // 过滤：收款账号或姓名匹配（确认是同一个人）
  const matched = candidates.filter((c) => {
    return recipientMatches(
      c.bank_account_name || "",
      c.bank_account_number || "",
      ocr.payee || "",
      ocr.payeeAccount || "",
    );
  });

  if (matched.length === 0) return null;

  // 在同一个人的报销单中，找出金额之和等于回单金额的子集（支持合并打款）
  if (ocr.amount > 0) {
    const ids = findSubsetByAmount(matched, ocr.amount);
    if (ids && ids.length > 0) {
      console.log(`✅ 回单金额匹配成功：共 ${ids.length} 笔`);
      return ids;
    }
  }

  // 金额匹配不上 → 人工认领
  return null;
}

export class BankReceiptPersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BankReceiptPersistenceError";
  }
}

interface BankReceiptInsertInput {
  mode: "insert";
  receiptId: string;
  sourceBatchId: string;
  imagePath: string;
  pageNo: number;
  position: "full" | "top" | "bottom";
  ocrResult: BankReceiptOcrResult;
  parsed: ParsedRemark;
  matchedReimbursementIds?: string[] | null;
  uploadedBy: string;
  now?: string;
}

interface BankReceiptClaimInput {
  mode: "claim";
  receiptId: string;
  matchedReimbursementIds: string[];
  uploadedBy: string;
  now?: string;
}

export type PersistBankReceiptTransactionInput =
  | BankReceiptInsertInput
  | BankReceiptClaimInput;

export interface PersistBankReceiptTransactionResult {
  receiptId: string;
  matchStatus: "matched" | "unmatched";
  matchedReimbursementIds: string[];
  paymentBatchId: string | null;
}

interface BankReceiptEvidence {
  receiptId: string;
  sourceBatchId: string;
  imagePath: string;
  pageNo: number;
  position: "full" | "top" | "bottom";
  ocrResult: BankReceiptOcrResult;
  parsed: ParsedRemark;
  fileHash: string;
  insertReceipt: boolean;
}

interface LockedReimbursement {
  id: string;
  status: string;
  total_amount: string;
  payment_batch_id: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
}

function formatBankCents(cents: bigint): string {
  const integer = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${integer}.${fraction}`;
}

function calculateBankReceiptFileHash(imagePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(imagePath))
    .digest("hex");
}

function serializeBankReceiptEvidence(
  evidence: BankReceiptEvidence,
  matchedReimbursementIds: string[],
): string {
  const ocr = evidence.ocrResult;
  return JSON.stringify({
    payer: ocr.payer,
    payerAccount: ocr.payerAccount,
    payee: ocr.payee,
    payeeAccount: ocr.payeeAccount,
    proofNo: ocr.proofNo,
    normalizedProofNo: normalizePaymentProofNo(ocr.proofNo),
    transactionDate: ocr.transactionDate,
    transactionDateCandidates: ocr.transactionDateCandidates,
    fileHash: evidence.fileHash,
    rawText: ocr.rawText.slice(0, 500),
    matchedIds: matchedReimbursementIds,
  });
}

async function loadClaimEvidence(
  client: PoolClient,
  receiptId: string,
): Promise<BankReceiptEvidence> {
  const result = await client.query<{
    id: string;
    batch_id: string;
    image_path: string;
    page_no: number;
    position: "full" | "top" | "bottom";
    ocr_payee: string | null;
    ocr_amount: string | null;
    ocr_remark: string | null;
    ocr_raw_json: string | null;
    parsed_type: ParsedRemark["type"];
    parsed_name: string | null;
    parsed_month: string | null;
    match_status: string;
  }>(
    `SELECT id, batch_id, image_path, page_no, position, ocr_payee,
            ocr_amount::text AS ocr_amount, ocr_remark, ocr_raw_json,
            parsed_type, parsed_name, parsed_month, match_status
       FROM bank_receipts
      WHERE id = $1
      FOR UPDATE`,
    [receiptId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new BankReceiptPersistenceError(
      "BANK_RECEIPT_NOT_FOUND",
      "银行回单不存在",
    );
  }
  if (row.match_status !== "unmatched") {
    throw new BankReceiptPersistenceError(
      "BANK_RECEIPT_ALREADY_MATCHED",
      "该银行回单已处理，不能重复认领",
    );
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(row.ocr_raw_json || "{}") as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const transactionDateCandidates = Array.isArray(raw.transactionDateCandidates)
    ? raw.transactionDateCandidates.map(String)
    : [];
  const payer = String(raw.payer || "");
  const payerAccount = String(raw.payerAccount || "");
  const payee = String(raw.payee || row.ocr_payee || "");
  const payeeAccount = String(raw.payeeAccount || "");
  const proofNo = String(raw.proofNo || "");
  const transactionDate = String(raw.transactionDate || "");
  if (
    !payee ||
    !payeeAccount ||
    !proofNo ||
    !transactionDate ||
    transactionDateCandidates.length !== 1
  ) {
    throw new BankReceiptPersistenceError(
      "BANK_RECEIPT_EVIDENCE_INCOMPLETE",
      "历史待认领回单缺少完整收款账号、电子回单号或唯一交易日期，请重新上传清晰原件",
    );
  }
  const imagePath = path.resolve(process.cwd(), row.image_path);
  if (!fs.existsSync(imagePath)) {
    throw new BankReceiptPersistenceError(
      "BANK_RECEIPT_FILE_MISSING",
      "银行回单裁片不存在，请重新上传原件",
    );
  }
  return {
    receiptId: row.id,
    sourceBatchId: row.batch_id,
    imagePath: row.image_path,
    pageNo: row.page_no,
    position: row.position,
    ocrResult: {
      payer,
      payerAccount,
      payee,
      payeeAccount,
      amount: Number(row.ocr_amount || 0),
      remark: row.ocr_remark || "",
      proofNo,
      transactionDate,
      transactionDateCandidates,
      rawText: String(raw.rawText || ""),
    },
    parsed: {
      type: row.parsed_type,
      name: row.parsed_name || "",
      month: row.parsed_month || "",
    },
    fileHash: calculateBankReceiptFileHash(imagePath),
    insertReceipt: false,
  };
}

async function insertBankReceiptRow(
  client: PoolClient,
  evidence: BankReceiptEvidence,
  matchedReimbursementIds: string[],
  paymentBatchId: string | null,
  uploadedBy: string,
  now: string,
): Promise<void> {
  const matched = matchedReimbursementIds.length > 0;
  await client.query(
    `INSERT INTO bank_receipts(
       id, batch_id, image_path, page_no, position, ocr_payee, ocr_amount,
       ocr_remark, ocr_raw_json, parsed_type, parsed_name, parsed_month,
       match_status, matched_reimbursement_id, payment_batch_id,
       matched_by, matched_at, created_at
     ) VALUES(
       $1,$2,$3,$4,$5,$6,$7::numeric,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
     )`,
    [
      evidence.receiptId,
      evidence.sourceBatchId,
      evidence.imagePath,
      evidence.pageNo,
      evidence.position,
      evidence.ocrResult.payee || null,
      evidence.ocrResult.amount > 0 ? evidence.ocrResult.amount : null,
      evidence.ocrResult.remark || null,
      serializeBankReceiptEvidence(evidence, matchedReimbursementIds),
      evidence.parsed.type,
      evidence.parsed.name || null,
      evidence.parsed.month || null,
      matched ? "matched" : "unmatched",
      matchedReimbursementIds[0] || null,
      paymentBatchId,
      matched ? uploadedBy : null,
      matched ? now : null,
      now,
    ],
  );
}

async function updateBankReceiptBatchStatistics(
  client: PoolClient,
  sourceBatchId: string,
  now: string,
): Promise<void> {
  await client.query(
    `UPDATE bank_receipt_batches
        SET matched_count = (
              SELECT COUNT(*) FROM bank_receipts
               WHERE batch_id = bank_receipt_batches.id
                 AND match_status = 'matched'
            ),
            unmatched_count = (
              SELECT COUNT(*) FROM bank_receipts
               WHERE batch_id = bank_receipt_batches.id
                 AND match_status = 'unmatched'
            ),
            updated_at = $2
      WHERE id = $1`,
    [sourceBatchId, now],
  );
}

/**
 * 将一张整包回单的识别、付款批次、报销状态、防重和审批记录原子落库。
 * `claim` 模式只接受回单编号和目标报销编号，权威 OCR 证据在事务内读取。
 */
export async function persistBankReceiptTransaction(
  input: PersistBankReceiptTransactionInput,
): Promise<PersistBankReceiptTransactionResult> {
  const db = await loadBankReceiptDb();
  const now = input.now || new Date().toISOString();
  const preliminaryEvidence =
    input.mode === "insert"
      ? {
          receiptId: input.receiptId,
          sourceBatchId: input.sourceBatchId,
          imagePath: input.imagePath,
          pageNo: input.pageNo,
          position: input.position,
          ocrResult: input.ocrResult,
          parsed: input.parsed,
          fileHash: calculateBankReceiptFileHash(
            path.resolve(process.cwd(), input.imagePath),
          ),
          insertReceipt: true,
        }
      : null;
  const requestedIds = [
    ...new Set(
      (input.matchedReimbursementIds || []).map(String).filter(Boolean),
    ),
  ].sort();

  return db.transaction(async (client) => {
    const evidence =
      preliminaryEvidence || (await loadClaimEvidence(client, input.receiptId));

    if (requestedIds.length === 0) {
      if (!evidence.insertReceipt) {
        throw new BankReceiptPersistenceError(
          "BANK_RECEIPT_TARGET_REQUIRED",
          "手工认领必须指定报销单",
        );
      }
      await insertBankReceiptRow(
        client,
        evidence,
        [],
        null,
        input.uploadedBy,
        now,
      );
      await updateBankReceiptBatchStatistics(
        client,
        evidence.sourceBatchId,
        now,
      );
      return {
        receiptId: evidence.receiptId,
        matchStatus: "unmatched",
        matchedReimbursementIds: [],
        paymentBatchId: null,
      };
    }

    const ocr = evidence.ocrResult;
    if (
      ocr.transactionDateCandidates.length !== 1 ||
      ocr.transactionDateCandidates[0] !== ocr.transactionDate ||
      !isValidBankBusinessDate(ocr.transactionDate)
    ) {
      throw new BankReceiptPersistenceError(
        "BANK_RECEIPT_TRANSACTION_DATE_INVALID",
        "银行回单必须具有唯一、有效的实际交易日期",
      );
    }
    const receiptAmountCents = bankAmountToExactCents(ocr.amount);
    const normalizedProofNo = normalizePaymentProofNo(ocr.proofNo);
    const proofIdentity = {
      fileHash: evidence.fileHash,
      proofNo: normalizedProofNo,
    };
    await lockPaymentProofIdentities(client, [proofIdentity]);
    if (await findExistingPaymentProofIdentity(client, [proofIdentity])) {
      throw new BankReceiptPersistenceError(
        "BANK_RECEIPT_DUPLICATE",
        "该付款回单文件或电子回单号已经使用",
      );
    }

    const lockedRows = await client.query<LockedReimbursement>(
      `SELECT r.id, r.status, r.total_amount::text, r.payment_batch_id,
              COALESCE(ep.bank_account_name, u.bank_account_name) AS bank_account_name,
              COALESCE(ep.bank_account_number, u.bank_account_number) AS bank_account_number
         FROM reimbursements r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN employee_profiles ep ON ep.user_id = r.user_id
        WHERE r.id = ANY($1::text[])
          AND r.is_deleted = FALSE
        ORDER BY r.id
        FOR UPDATE OF r`,
      [requestedIds],
    );
    if (lockedRows.rows.length !== requestedIds.length) {
      throw new BankReceiptPersistenceError(
        "BANK_RECEIPT_REIMBURSEMENT_NOT_FOUND",
        "部分报销单不存在或已删除",
      );
    }
    let reimbursementTotalCents = 0n;
    for (const row of lockedRows.rows) {
      reimbursementTotalCents += bankAmountToExactCents(row.total_amount);
      if (
        !row.bank_account_name ||
        !row.bank_account_number ||
        !ocr.payee ||
        !ocr.payeeAccount ||
        !accountMatches(row.bank_account_number, ocr.payeeAccount) ||
        !nameMatches(row.bank_account_name, ocr.payee)
      ) {
        throw new BankReceiptPersistenceError(
          "BANK_RECEIPT_PAYEE_MISMATCH",
          "回单收款人姓名或完整账号与报销申请人不一致",
        );
      }
    }
    if (reimbursementTotalCents !== receiptAmountCents) {
      throw new BankReceiptPersistenceError(
        "BANK_RECEIPT_AMOUNT_MISMATCH",
        "回单金额与目标报销单净额合计不一致",
      );
    }

    const batchIds = [
      ...new Set(
        lockedRows.rows
          .map((row) => row.payment_batch_id)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    if (
      batchIds.length > 1 ||
      (batchIds.length === 1 &&
        lockedRows.rows.some((row) => !row.payment_batch_id))
    ) {
      throw new BankReceiptPersistenceError(
        "BANK_RECEIPT_BATCH_AMBIGUOUS",
        "目标报销单分属于不同付款批次，不能使用同一张回单",
      );
    }

    let paymentBatchId: string;
    const amountText = formatBankCents(receiptAmountCents);
    if (batchIds.length === 1) {
      paymentBatchId = batchIds[0];
      const batchResult = await client.query<{
        id: string;
        status: string;
        total_amount: string;
      }>(
        `SELECT id, status, total_amount::text
           FROM payment_batches
          WHERE id = $1
          FOR UPDATE`,
        [paymentBatchId],
      );
      const paymentBatch = batchResult.rows[0];
      if (!paymentBatch || paymentBatch.status !== "pending") {
        throw new BankReceiptPersistenceError(
          "BANK_RECEIPT_BATCH_NOT_PENDING",
          "付款批次不存在或已处理",
        );
      }
      if (
        bankAmountToExactCents(paymentBatch.total_amount) !== receiptAmountCents
      ) {
        throw new BankReceiptPersistenceError(
          "BANK_RECEIPT_BATCH_AMOUNT_MISMATCH",
          "付款批次快照金额与回单金额不一致",
        );
      }
      const batchItems = await client.query<{
        reimbursement_id: string;
        amount: string;
      }>(
        `SELECT reimbursement_id, amount::text
           FROM payment_batch_items
          WHERE batch_id = $1
          ORDER BY reimbursement_id
          FOR UPDATE`,
        [paymentBatchId],
      );
      const batchItemIds = batchItems.rows.map((row) => row.reimbursement_id);
      const batchItemTotal = batchItems.rows.reduce(
        (sum, row) => sum + bankAmountToExactCents(row.amount),
        0n,
      );
      if (
        JSON.stringify(batchItemIds) !== JSON.stringify(requestedIds) ||
        batchItemTotal !== receiptAmountCents ||
        lockedRows.rows.some(
          (row) => !["approved", "paid"].includes(row.status),
        )
      ) {
        throw new BankReceiptPersistenceError(
          "BANK_RECEIPT_BATCH_MEMBERSHIP_MISMATCH",
          "付款批次成员、状态或明细金额已经变化",
        );
      }
    } else {
      if (lockedRows.rows.some((row) => row.status !== "paid")) {
        throw new BankReceiptPersistenceError(
          "BANK_RECEIPT_REIMBURSEMENT_NOT_PAID",
          "无付款批次的报销单必须先确认付款",
        );
      }
      paymentBatchId = `pb_${nanoid(16)}`;
      const dateText = now.slice(0, 10).replace(/-/gu, "");
      const batchNo = `PAY${dateText}${nanoid(6).toUpperCase()}`;
      await client.query(
        `INSERT INTO payment_batches(
           id, batch_no, total_amount, payer_id, payment_proof_path, pay_time,
           payment_business_date, status, created_at, updated_at
         ) VALUES($1,$2,$3::numeric,$4,$5,$6,$7::date,'uploaded',$6,$6)`,
        [
          paymentBatchId,
          batchNo,
          amountText,
          input.uploadedBy,
          evidence.imagePath,
          now,
          ocr.transactionDate,
        ],
      );
      for (const row of lockedRows.rows) {
        await client.query(
          `INSERT INTO payment_batch_items(
             id, batch_id, reimbursement_id, amount, created_at
           ) VALUES($1,$2,$3,$4::numeric,$5)`,
          [`pbi_${nanoid(16)}`, paymentBatchId, row.id, row.total_amount, now],
        );
      }
    }

    await client.query(
      `INSERT INTO payment_proof_hashes(
         id, file_hash, proof_no, batch_id, created_at
       ) VALUES($1,$2,$3,$4,$5)`,
      [
        `pph_${nanoid(16)}`,
        evidence.fileHash,
        normalizedProofNo || null,
        paymentBatchId,
        now,
      ],
    );

    const reimbursementUpdate = await client.query(
      `UPDATE reimbursements
          SET status = 'payment_uploaded', payment_proof_path = $2,
              payment_upload_time = $3, pay_time = $3,
              payment_business_date = $4::date,
              payment_batch_id = $5, updated_at = $3
        WHERE id = ANY($1::text[])
          AND status = ANY($6::text[])
          AND payment_batch_id IS NOT DISTINCT FROM $7::text
          AND is_deleted = FALSE`,
      [
        requestedIds,
        evidence.imagePath,
        now,
        ocr.transactionDate,
        paymentBatchId,
        batchIds.length === 1 ? ["approved", "paid"] : ["paid"],
        batchIds.length === 1 ? paymentBatchId : null,
      ],
    );
    if (reimbursementUpdate.rowCount !== requestedIds.length) {
      throw new BankReceiptPersistenceError(
        "BANK_RECEIPT_REIMBURSEMENT_STATE_CHANGED",
        "报销单状态已经变化，请重新识别回单",
      );
    }

    if (batchIds.length === 1) {
      const batchUpdate = await client.query(
        `UPDATE payment_batches
            SET status = 'uploaded', payment_proof_path = $2,
                pay_time = $3, payment_business_date = $4::date,
                updated_at = $3
          WHERE id = $1 AND status = 'pending'`,
        [paymentBatchId, evidence.imagePath, now, ocr.transactionDate],
      );
      if (batchUpdate.rowCount !== 1) {
        throw new BankReceiptPersistenceError(
          "BANK_RECEIPT_BATCH_STATE_CHANGED",
          "付款批次状态已经变化，请重新识别回单",
        );
      }
    }

    for (const reimbursementId of requestedIds) {
      const approvalInstance = await client.query<{ id: string }>(
        `SELECT id
           FROM approval_instances
          WHERE target_id = $1 AND target_type = 'reimbursement'
          ORDER BY created_at DESC
          LIMIT 1`,
        [reimbursementId],
      );
      if (approvalInstance.rows[0]) {
        await client.query(
          `INSERT INTO approval_records(
             id, instance_id, step, approver_id, action, comment, action_time
           ) VALUES($1,$2,99,$3,'payment_uploaded',$4,$5)`,
          [
            `ar_${nanoid(10)}`,
            approvalInstance.rows[0].id,
            input.uploadedBy,
            evidence.insertReceipt
              ? requestedIds.length > 1
                ? `系统自动上传付款回单（合并打款，共${requestedIds.length}笔）`
                : "系统自动上传付款回单"
              : "管理员手工认领付款回单",
            now,
          ],
        );
      }
    }

    if (evidence.insertReceipt) {
      await insertBankReceiptRow(
        client,
        evidence,
        requestedIds,
        paymentBatchId,
        input.uploadedBy,
        now,
      );
    } else {
      const receiptUpdate = await client.query(
        `UPDATE bank_receipts
            SET match_status = 'matched', matched_reimbursement_id = $2,
                payment_batch_id = $3, matched_by = $4, matched_at = $5,
                ocr_raw_json = $6
          WHERE id = $1 AND match_status = 'unmatched'`,
        [
          evidence.receiptId,
          requestedIds[0],
          paymentBatchId,
          input.uploadedBy,
          now,
          serializeBankReceiptEvidence(evidence, requestedIds),
        ],
      );
      if (receiptUpdate.rowCount !== 1) {
        throw new BankReceiptPersistenceError(
          "BANK_RECEIPT_STATE_CHANGED",
          "待认领回单状态已经变化，请刷新后重试",
        );
      }
    }
    await updateBankReceiptBatchStatistics(client, evidence.sourceBatchId, now);
    return {
      receiptId: evidence.receiptId,
      matchStatus: "matched",
      matchedReimbursementIds: requestedIds,
      paymentBatchId,
    };
  });
}

// ==================== 主流程 ====================

/**
 * 一次性将整份 PDF 转为图片，返回 pageNo → 图片路径 的映射
 */
function convertAllPagesToImages(
  pdfPath: string,
  outputDir: string,
  _totalPages: number,
): Map<number, string> {
  const prefix = path.join(outputDir, "page");
  try {
    execSync(`pdftoppm -r 120 -jpeg "${pdfPath}" "${prefix}"`, {
      timeout: 120000,
    });
  } catch (e) {
    console.error("❌ pdftoppm 批量转换失败:", e);
    return new Map();
  }

  const map = new Map<number, string>();
  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith("page-") && f.endsWith(".jpg"));
  for (const file of files) {
    // 文件名格式：page-01.jpg / page-001.jpg
    const m = file.match(/^page-(\d+)\.jpg$/);
    if (m) {
      const pageNo = parseInt(m[1]);
      map.set(pageNo, path.join(outputDir, file));
    }
  }
  console.log(`🖼️ 批量转图片完成，共 ${map.size} 页`);
  return map;
}

export async function processBankReceiptPdf(
  pdfPath: string,
  batchId: string,
  uploadedBy: string,
  outputDir: string,
): Promise<ReceiptMatchResult[]> {
  const results: ReceiptMatchResult[] = [];
  const now = new Date().toISOString();

  // 获取总页数
  let totalPages = 1;
  try {
    const info = execSync(`pdfinfo "${pdfPath}"`, {
      encoding: "utf-8",
      timeout: 10000,
    });
    const match = info.match(/Pages:\s*(\d+)/);
    if (match) totalPages = parseInt(match[1]);
  } catch (e) {
    console.error("❌ pdfinfo 失败:", e);
  }
  console.log(`📄 回单PDF共 ${totalPages} 页，开始处理...`);

  // 一次性转所有页为图片
  const pageImageMap = convertAllPagesToImages(pdfPath, outputDir, totalPages);

  // 并行分析所有页面 XML（过滤空白页，获取分割线坐标）
  console.log(`🔍 并行分析页面结构，跳过空白页...`);
  const pageAnalysis = new Map<number, { splitY: number | null }>();
  const CONCURRENCY = 4; // XML 分析并发数（CPU密集，不宜过高）
  const pageNos = Array.from({ length: totalPages }, (_, i) => i + 1);
  for (let i = 0; i < pageNos.length; i += CONCURRENCY) {
    const batch = pageNos.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (pageNo) => {
        const r = analyzePageXml(pdfPath, pageNo);
        return { pageNo, ...r };
      }),
    );
    for (const { pageNo, hasContent, splitY } of batchResults) {
      if (hasContent) pageAnalysis.set(pageNo, { splitY });
      else console.log(`⏭️ 第${pageNo}页为空白页，跳过`);
    }
  }
  console.log(
    `📋 有内容的页面：${pageAnalysis.size} 页，空白页：${totalPages - pageAnalysis.size} 页`,
  );

  // 准备所有待 OCR 的图片任务
  const ocrTasks: Array<{
    imagePath: string;
    position: "full" | "top" | "bottom";
    pageNo: number;
  }> = [];
  for (const [pageNo, { splitY }] of pageAnalysis) {
    const pageImagePath = pageImageMap.get(pageNo);
    if (!pageImagePath || !fs.existsSync(pageImagePath)) {
      console.warn(`⚠️ 第${pageNo}页无图片，跳过`);
      continue;
    }
    if (splitY) {
      try {
        const { top, bottom } = await splitImage(
          pageImagePath,
          splitY,
          1262,
          outputDir,
          `page${pageNo}`,
        );
        ocrTasks.push({ imagePath: top, position: "top", pageNo });
        ocrTasks.push({ imagePath: bottom, position: "bottom", pageNo });
      } catch {
        ocrTasks.push({ imagePath: pageImagePath, position: "full", pageNo });
      }
    } else {
      ocrTasks.push({ imagePath: pageImagePath, position: "full", pageNo });
    }
  }

  // 并行 OCR（常驻进程支持队列，最多同时发 3 个请求）
  const OCR_CONCURRENCY = 1;
  console.log(
    `🔍 开始并行 OCR，共 ${ocrTasks.length} 张图片（并发数: ${OCR_CONCURRENCY}）...`,
  );
  for (let i = 0; i < ocrTasks.length; i += OCR_CONCURRENCY) {
    const batch = ocrTasks.slice(i, i + OCR_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ imagePath, position, pageNo }) => {
        try {
          const ocr = await recognizeBankReceiptImage(imagePath);

          // 跳过空页（OCR识别不到任何内容）
          if (!ocr.rawText || ocr.rawText.trim().length < 10) return;

          const parsed = parseRemark(ocr.remark);
          const receiptId = `br_${nanoid(10)}`;
          const relativeImagePath = imagePath.replace(process.cwd() + "/", "");
          const hasUniqueBusinessDate =
            ocr.transactionDateCandidates.length === 1 &&
            ocr.transactionDateCandidates[0] === ocr.transactionDate &&
            isValidBankBusinessDate(ocr.transactionDate);
          const matchedIds = hasUniqueBusinessDate
            ? await matchReimbursement(ocr, parsed)
            : null;
          const persistenceInput: BankReceiptInsertInput = {
            mode: "insert",
            receiptId,
            sourceBatchId: batchId,
            imagePath: relativeImagePath,
            pageNo,
            position,
            ocrResult: ocr,
            parsed,
            matchedReimbursementIds: matchedIds,
            uploadedBy,
            now,
          };
          let persisted: PersistBankReceiptTransactionResult;
          try {
            persisted = await persistBankReceiptTransaction(persistenceInput);
          } catch (error) {
            if (
              matchedIds?.length &&
              error instanceof BankReceiptPersistenceError
            ) {
              console.warn(
                `⚠️ 第${pageNo}页自动匹配复验未通过，已回滚并转待认领：${error.message}`,
              );
              persisted = await persistBankReceiptTransaction({
                ...persistenceInput,
                matchedReimbursementIds: [],
              });
            } else {
              throw error;
            }
          }

          results.push({
            receiptId,
            imagePath: relativeImagePath,
            ocrResult: ocr,
            parsed,
            matchStatus: persisted.matchStatus,
            matchedReimbursementId:
              persisted.matchedReimbursementIds[0] || undefined,
            matchedReimbursementIds:
              persisted.matchedReimbursementIds.length > 0
                ? persisted.matchedReimbursementIds
                : undefined,
          });
        } catch (err) {
          console.error(`❌ 处理第${pageNo}页回单失败:`, err);
        }
      }),
    );
  }

  // 更新批次统计
  const matched = results.filter((r) => r.matchStatus === "matched").length;
  const unmatched = results.filter((r) => r.matchStatus === "unmatched").length;
  const db = await loadBankReceiptDb();
  await db.run(
    `UPDATE bank_receipt_batches
     SET total_pages = ?, total_receipts = ?, matched_count = ?, unmatched_count = ?,
         status = 'done', updated_at = ?
     WHERE id = ?`,
    totalPages,
    results.length,
    matched,
    unmatched,
    now,
    batchId,
  );

  return results;
}
