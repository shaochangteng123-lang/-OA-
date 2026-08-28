/**
 * 本地 OCR 服务
 * 使用 pdf-parse 提取 PDF 文本，然后使用正则表达式识别发票信息
 * 当 pdf-parse 提取文本不完整时，自动回退到 PDF 转图片 + PaddleOCR
 * 数据完全在本地处理，保证数据安全
 */

import fs from "fs";
import { callPaddleOcr } from "./ocrDaemon.js";

// ==================== PaddleOCR（发票 OCR 专用） ====================
// PaddleOCR 通过 ocrDaemon.ts 管理，无需额外初始化

/**
 * 发票识别结果接口
 */
export interface InvoiceOcrResult {
  amount: number;
  amountFromPriceTax?: boolean; // 金额是否来自"价税合计"字段（高置信度）
  date: string;
  invoiceNumber?: string;
  seller?: string;
  sellerTaxId?: string;
  buyer?: string;
  buyerTaxId?: string;
  taxAmount?: number;
  invoiceCode?: string;
  type?: string; // 报销类型（从项目名称提取）
  isValidInvoice: boolean;
}

export interface XmlInvoiceResult {
  amount?: number;
  taxAmount?: number;
  date?: string;
  invoiceNumber?: string;
  type?: string;
  itemName?: string;
  seller?: string;
  sellerTaxId?: string;
  buyer?: string;
  buyerTaxId?: string;
  rawText?: string;
  positionedTextNodes?: InvoicePositionedTextNode[];
  lineItems?: XmlInvoiceLineItem[];
}

export interface XmlInvoiceLineItem {
  itemName: string;
  netAmount: number | null;
  taxAmount: number | null;
  grossAmount: number | null;
}

export interface ExtractInvoiceFromXmlOptions {
  pageScope?: "first" | "all";
}

export function buildInvoiceXmlArgs(
  pdfPath: string,
  options: ExtractInvoiceFromXmlOptions = {},
): string[] {
  const args = ["-xml", "-stdout", "-nodrm", "-i"];
  if ((options.pageScope || "first") === "first") {
    args.push("-f", "1", "-l", "1");
  }
  args.push(pdfPath);
  return args;
}

const TRANSPORT_PREPAID_CARD_PATTERN =
  /(市政交通一卡通|交通一卡通|交通卡|一卡通|公交卡|地铁卡|乘车卡)(?:充值|储值|加值)?/;

function extractTransportPrepaidCardType(text: string): string | null {
  const compactText = text.replace(/\s+/g, "");
  if (!compactText.includes("*预付卡销售*")) return null;

  const prepaidProject = compactText.match(/\*预付卡销售\*([^*；;，,。]*)/);
  const projectDetail = prepaidProject?.[1] || compactText;
  const transportCardMatch = projectDetail.match(
    TRANSPORT_PREPAID_CARD_PATTERN,
  );

  return transportCardMatch?.[0] || null;
}

interface InvoicePartyFields {
  seller: string;
  sellerTaxId: string;
  buyer: string;
  buyerTaxId: string;
}

export interface InvoicePositionedTextNode {
  page?: number;
  top: number;
  left: number;
  width: number;
  height?: number;
  text: string;
}

const INVOICE_TAX_LABEL_SOURCE = String.raw`(?:统一\s*社会\s*信用\s*代码\s*[／/]\s*纳税人\s*识别\s*号|统一\s*社会\s*信用\s*代码|纳税人\s*识别\s*号|税\s*号)`;
const INVOICE_TAX_ID_SOURCE = String.raw`(?:[A-Za-z0-9][ \t]*){18}`;

function cleanInvoicePartyName(value?: string): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(
      /(?:统一\s*社会\s*信用\s*代码|纳税人\s*识别\s*号|税\s*号|地\s*址|电\s*话|开\s*户\s*行|账\s*号)[\s\S]*$/i,
      "",
    )
    .replace(/\s+/g, "")
    .trim();
}

function normalizeInvoiceTaxId(value?: string): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
}

function findInvoicePartySection(
  text: string,
  startPattern: RegExp,
  endPattern?: RegExp,
): string {
  const start = startPattern.exec(text);
  if (!start) return "";

  const remaining = text.slice(start.index + start[0].length);
  const end = endPattern?.exec(remaining);
  return remaining.slice(0, end ? end.index : 600);
}

function extractPartyNameFromSection(section: string): string {
  const match = section.match(
    /(?:^|[\n\r|｜])\s*名\s*称\s*[：:]\s*([^\n\r|｜]{2,200})/m,
  );
  return cleanInvoicePartyName(match?.[1]);
}

function extractPartyTaxIdFromSection(section: string): string {
  const match = section.match(
    new RegExp(
      `${INVOICE_TAX_LABEL_SOURCE}[ \\t]*[：:]?[ \\t]*(?:\\r?\\n[ \\t]*)?(${INVOICE_TAX_ID_SOURCE})(?![ \\t]*[A-Za-z0-9])`,
      "i",
    ),
  );
  return normalizeInvoiceTaxId(match?.[1]);
}

/**
 * 提取发票购销双方名称与纳税人识别号。
 * 优先按购买方、销售方分区提取；分区标签识别失败时，再按票面上下顺序兜底。
 */
export function extractInvoicePartyFields(text: string): InvoicePartyFields {
  const buyerSection = findInvoicePartySection(
    text,
    /购\s*买\s*方(?:\s*信\s*息)?/,
    /销\s*售\s*方(?:\s*信\s*息)?/,
  );
  const sellerSection = findInvoicePartySection(
    text,
    /销\s*售\s*方(?:\s*信\s*息)?/,
  );

  const allNames = Array.from(
    text.matchAll(/(?:^|[\n\r|｜])\s*名\s*称\s*[：:]\s*([^\n\r|｜]{2,200})/gm),
  )
    .map((match) => cleanInvoicePartyName(match[1]))
    .filter(Boolean);

  const allTaxIds = Array.from(
    text.matchAll(
      new RegExp(
        `${INVOICE_TAX_LABEL_SOURCE}[ \\t]*[：:]?[ \\t]*(?:\\r?\\n[ \\t]*)?(${INVOICE_TAX_ID_SOURCE})(?![ \\t]*[A-Za-z0-9])`,
        "gi",
      ),
    ),
  )
    .map((match) => normalizeInvoiceTaxId(match[1]))
    .filter(Boolean);

  return {
    buyer: extractPartyNameFromSection(buyerSection) || allNames[0] || "",
    buyerTaxId:
      extractPartyTaxIdFromSection(buyerSection) || allTaxIds[0] || "",
    seller:
      extractPartyNameFromSection(sellerSection) ||
      allNames[allNames.length - 1] ||
      "",
    sellerTaxId:
      extractPartyTaxIdFromSection(sellerSection) ||
      allTaxIds[allTaxIds.length - 1] ||
      "",
  };
}

function findValueToRight(
  label: InvoicePositionedTextNode,
  textNodes: InvoicePositionedTextNode[],
  normalize: (value?: string) => string,
  isValid: (value: string) => boolean,
): string {
  const labelRight = label.left + label.width;
  const candidates = textNodes
    .filter(
      (node) =>
        node !== label &&
        Math.abs(node.top - label.top) <= 10 &&
        // 不同 PDF 字体的文字边界会有少量重叠，值节点可能比标签右边界左移十余像素。
        node.left >= labelRight - 20,
    )
    .map((node) => ({ ...node, normalized: normalize(node.text) }))
    .filter((node) => isValid(node.normalized))
    .sort((left, right) => left.left - right.left);

  return candidates[0]?.normalized || "";
}

/**
 * 根据 PDF 文字坐标提取购销双方字段，避免左右两栏在纯文本排序后互相串行。
 */
export function extractInvoicePartyFieldsFromPositionedText(
  textNodes: InvoicePositionedTextNode[],
): InvoicePartyFields {
  const layoutText = [...textNodes]
    .sort((left, right) => left.top - right.top || left.left - right.left)
    .map((node) => node.text)
    .join("\n");
  const fallback = extractInvoicePartyFields(layoutText);

  const nameLabels = textNodes
    .filter((node) => /^名\s*称\s*[：:]?$/i.test(node.text))
    .sort((left, right) => left.left - right.left);
  const taxLabels = textNodes
    .filter((node) =>
      new RegExp(`^${INVOICE_TAX_LABEL_SOURCE}[：:]?$`, "i").test(
        node.text.replace(/\s+/g, ""),
      ),
    )
    .sort((left, right) => left.left - right.left);

  const names = nameLabels.map((label) =>
    findValueToRight(
      label,
      textNodes,
      cleanInvoicePartyName,
      (value) => value.length >= 4 && !/^名称[：:]?$/i.test(value),
    ),
  );
  const taxIds = taxLabels.map((label) =>
    findValueToRight(label, textNodes, normalizeInvoiceTaxId, (value) =>
      /^[A-Z0-9]{18}$/.test(value),
    ),
  );

  return {
    buyer: names.length >= 2 ? names[0] || fallback.buyer : fallback.buyer,
    buyerTaxId:
      taxIds.length >= 2
        ? taxIds[0] || fallback.buyerTaxId
        : fallback.buyerTaxId,
    seller:
      names.length >= 2
        ? names[names.length - 1] || fallback.seller
        : fallback.seller,
    sellerTaxId:
      taxIds.length >= 2
        ? taxIds[taxIds.length - 1] || fallback.sellerTaxId
        : fallback.sellerTaxId,
  };
}

/**
 * 只读取发票“项目名称”列；规格型号及其右侧列永不拼入开票名称。
 */
export function extractInvoiceItemNameFromPositionedText(
  textNodes: InvoicePositionedTextNode[],
): string {
  const projectHeader = textNodes.find((node) =>
    /^项目\s*名称$/.test(node.text),
  );
  if (!projectHeader) {
    return "";
  }
  // 数电票的第二列会随票种变化：普通票是“规格型号”，
  // 不动产租赁票则是“产权证书/不动产权证号”。取同一表头行右侧最近节点作为列边界，
  // 不依赖某一固定文案，也不会用异行文字误建边界。
  const nextColumnHeader = textNodes
    .filter(
      (node) =>
        node !== projectHeader &&
        Math.abs(node.top - projectHeader.top) <= 6 &&
        node.left >= projectHeader.left + projectHeader.width,
    )
    .sort((left, right) => left.left - right.left)[0];
  if (!nextColumnHeader) return "";
  const totalTop = invoiceTotalRowTop(textNodes, projectHeader.top);
  const itemNodes = textNodes
    .filter((node) => node.top > projectHeader.top + 5 && node.top < totalTop)
    .filter((node) => node.left < nextColumnHeader.left)
    .filter((node) => node.left + node.width <= nextColumnHeader.left + 2)
    .map((node) => ({
      ...node,
      text: node.text.normalize("NFKC").replace(/\s+/g, "").trim(),
    }))
    .filter(
      (node) =>
        node.text &&
        !/^(?:项目名称|规格型号|单位|数量|单价|金额|税率|税额)$/.test(
          node.text,
        ),
    )
    .sort((left, right) => left.top - right.top || left.left - right.left);
  const items: string[] = [];
  for (const node of itemNodes) {
    if (/^\*[^*]+\*/.test(node.text) || items.length === 0) {
      items.push(node.text);
      continue;
    }
    if (/^[\u3400-\u9fffA-Za-z]{1,12}$/.test(node.text)) {
      items[items.length - 1] = `${items[items.length - 1]}${node.text}`;
    }
  }
  return [
    ...new Set(items.map((item) => item.slice(0, 200)).filter(Boolean)),
  ].join("、");
}

function invoiceColumnBounds(
  headers: InvoicePositionedTextNode[],
  target: InvoicePositionedTextNode,
): { left: number; right: number } {
  const ordered = [...headers].sort(
    (left, right) =>
      left.left + left.width / 2 - (right.left + right.width / 2),
  );
  const index = ordered.indexOf(target);
  const center = target.left + target.width / 2;
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  return {
    left: previous
      ? (previous.left + previous.width / 2 + center) / 2
      : Number.NEGATIVE_INFINITY,
    right: next
      ? (next.left + next.width / 2 + center) / 2
      : Number.POSITIVE_INFINITY,
  };
}

function invoiceNodeMoney(node: InvoicePositionedTextNode): number | null {
  const matched = node.text
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .match(/^[¥￥]?(-?[\d,]+(?:\.\d{1,2})?)$/u)?.[1];
  if (!matched) return null;
  const amount = Number(matched.replace(/,/gu, ""));
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100) / 100
    : null;
}

/** 按电子发票表格坐标逐行提取项目、不含税金额和税额。 */
export function extractInvoiceLineItemsFromPositionedText(
  textNodes: InvoicePositionedTextNode[],
): XmlInvoiceLineItem[] {
  const compact = (value: string) =>
    value.normalize("NFKC").replace(/\s+/gu, "");
  const projectHeader = textNodes.find(
    (node) => compact(node.text) === "项目名称",
  );
  const amountHeader = textNodes.find((node) =>
    /^(?:金额|金额税率\/征收率)$/u.test(compact(node.text)),
  );
  const taxHeader = textNodes.find((node) => compact(node.text) === "税额");
  if (!projectHeader || !amountHeader || !taxHeader) return [];
  const headers = textNodes.filter(
    (node) =>
      Math.abs(node.top - projectHeader.top) <= 6 &&
      /^(?:项目名称|规格型号|单位|数量|单价|金额|金额税率\/征收率|税率\/征收率|税率|税额)$/u.test(
        compact(node.text),
      ),
  );
  const nextProjectHeader = textNodes
    .filter(
      (node) =>
        node !== projectHeader &&
        Math.abs(node.top - projectHeader.top) <= 6 &&
        node.left >= projectHeader.left + projectHeader.width,
    )
    .sort((left, right) => left.left - right.left)[0];
  if (!nextProjectHeader) return [];
  const amountBounds = invoiceColumnBounds(headers, amountHeader);
  const taxBounds = invoiceColumnBounds(headers, taxHeader);
  const totalTop = invoiceTotalRowTop(textNodes, projectHeader.top);
  const netNodes = textNodes
    .filter(
      (node) =>
        node.top > projectHeader.top + 5 &&
        node.top < totalTop - 10 &&
        node.left + node.width / 2 >= amountBounds.left &&
        node.left + node.width / 2 < amountBounds.right,
    )
    .map((node) => ({ node, amount: invoiceNodeMoney(node) }))
    .filter(
      (entry): entry is { node: InvoicePositionedTextNode; amount: number } =>
        entry.amount !== null,
    )
    .sort((left, right) => left.node.top - right.node.top);
  return netNodes.map((entry, index) => {
    const nextTop = netNodes[index + 1]?.node.top ?? totalTop;
    const itemName = textNodes
      .filter(
        (node) =>
          node.top >= entry.node.top - 5 &&
          node.top < nextTop - 5 &&
          node.left < nextProjectHeader.left &&
          node.left + node.width <= nextProjectHeader.left + 2,
      )
      .sort((left, right) => left.top - right.top || left.left - right.left)
      .map((node) => compact(node.text))
      .filter(Boolean)
      .join("")
      .slice(0, 200);
    const taxEntry = textNodes
      .filter(
        (node) =>
          Math.abs(node.top - entry.node.top) <= 8 &&
          node.left + node.width / 2 >= taxBounds.left &&
          node.left + node.width / 2 < taxBounds.right,
      )
      .map((node) => invoiceNodeMoney(node))
      .find((amount): amount is number => amount !== null);
    const taxAmount = taxEntry ?? null;
    return {
      itemName,
      netAmount: entry.amount,
      taxAmount,
      grossAmount:
        taxAmount === null
          ? null
          : (Math.round(entry.amount * 100) + Math.round(taxAmount * 100)) /
            100,
    };
  });
}

function invoiceTotalRowTop(
  textNodes: InvoicePositionedTextNode[],
  minimumTop = 0,
): number {
  const candidateTops = textNodes
    .filter(
      (node) =>
        node.top > minimumTop &&
        /^(?:合计|价税合计)/.test(node.text.replace(/\s+/g, "")),
    )
    .map((node) => node.top);
  const splitLabels = textNodes.filter(
    (node) => node.top > minimumTop && /^[合计]$/.test(node.text.trim()),
  );
  for (const label of splitLabels) {
    if (
      splitLabels.some(
        (candidate) =>
          candidate !== label &&
          candidate.text.trim() !== label.text.trim() &&
          Math.abs(candidate.top - label.top) <= 5,
      )
    ) {
      candidateTops.push(label.top);
    }
  }
  return candidateTops.length > 0
    ? Math.min(...candidateTops)
    : Number.POSITIVE_INFINITY;
}

export function extractInvoiceTaxAmountFromPositionedText(
  textNodes: InvoicePositionedTextNode[],
): number | undefined {
  const totalTop = invoiceTotalRowTop(textNodes);
  if (!Number.isFinite(totalTop)) return undefined;
  const amounts = textNodes
    .filter((node) => Math.abs(node.top - totalTop) <= 10)
    .map((node) => ({
      left: node.left,
      value: node.text
        .normalize("NFKC")
        .match(/^[¥￥]?\s*([\d,]+\.\d{2})$/)?.[1],
    }))
    .filter((item): item is { left: number; value: string } =>
      Boolean(item.value),
    )
    .map((item) => ({
      left: item.left,
      value: Number(item.value.replace(/,/g, "")),
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((left, right) => left.left - right.left);
  return amounts.length >= 2 ? amounts[amounts.length - 1]!.value : undefined;
}

/**
 * 通过 pdftohtml -xml 坐标方案提取发票所有关键字段
 * 返回 null 表示 pdftohtml 不可用或 PDF 无文字层（扫描件）
 */
export async function extractInvoiceFromXml(
  pdfPath: string,
  options: ExtractInvoiceFromXmlOptions = {},
): Promise<XmlInvoiceResult | null> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    // 这里只读取文字坐标；忽略内嵌图片，避免 pdftohtml 在上传临时目录旁生成残留图片。
    const { stdout } = await promisify(execFile)(
      "pdftohtml",
      buildInvoiceXmlArgs(pdfPath, options),
      {
        timeout: 15000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
      },
    );
    const xml = String(stdout || "");

    // 解析所有 <text> 元素，提取 top/left 坐标和文本内容
    const textNodes: InvoicePositionedTextNode[] = [];
    const pageBlocks = Array.from(
      xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g),
      (match) => match[1],
    );
    const pageSources = pageBlocks.length > 0 ? pageBlocks : [xml];
    for (const [pageIndex, pageXml] of pageSources.entries()) {
      const nodeRe =
        /<text[^>]+top="(\d+)"[^>]+left="(\d+)"[^>]+width="(\d+)"[^>]*>([\s\S]*?)<\/text>/g;
      let m: RegExpExecArray | null;
      while ((m = nodeRe.exec(pageXml)) !== null) {
        const raw = m[4]
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&#(\d+);/g, (_, code) =>
            String.fromCharCode(parseInt(code)),
          )
          .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
            String.fromCharCode(parseInt(code, 16)),
          )
          .trim();
        const heightMatch = m[0].match(/height="(\d+)"/);
        if (raw)
          textNodes.push({
            page: pageIndex + 1,
            top: parseInt(m[1]),
            left: parseInt(m[2]),
            width: parseInt(m[3]),
            height: heightMatch ? parseInt(heightMatch[1]) : undefined,
            text: raw,
          });
      }
    }

    if (textNodes.length === 0) return null;

    const result: XmlInvoiceResult = {};

    // ── 1. 提取金额（价税合计小写）──
    const amountLabelNodes = textNodes.filter((n) =>
      /[（(]\s*小\s*写\s*[）)]/.test(n.text),
    );
    const labelNode =
      options.pageScope === "all"
        ? amountLabelNodes[amountLabelNodes.length - 1]
        : amountLabelNodes[0];
    if (labelNode) {
      const sameLine = textNodes.filter(
        (n) =>
          n.page === labelNode.page && Math.abs(n.top - labelNode.top) <= 10,
      );
      const yenNode = sameLine.find((n) => /^[¥￥]$/.test(n.text));
      if (yenNode) {
        const numNode = sameLine
          .filter(
            (n) => n.left > yenNode.left && /^[\d,]+\.\d{2}$/.test(n.text),
          )
          .sort((a, b) => a.left - b.left)[0];
        if (numNode) {
          result.amount = parseFloat(numNode.text.replace(/,/g, ""));
          console.log("💰 XML金额(¥右侧):", result.amount);
        }
      }
      if (!result.amount) {
        // 备用1：同行有 ¥35.73 或 ¥ 35.73（¥和数字之间可能有空格）
        const mergedYenNode = sameLine.find((n) =>
          /^[¥￥]\s*([\d,]+\.\d{2})$/.test(n.text),
        );
        if (mergedYenNode) {
          const m3 = mergedYenNode.text.match(/^[¥￥]\s*([\d,]+\.\d{2})$/);
          if (m3) {
            result.amount = parseFloat(m3[1].replace(/,/g, ""));
            console.log("💰 XML金额(¥合并节点):", result.amount);
          }
        }
      }
      if (!result.amount) {
        // 备用2：同行最大纯数字
        const numNodes = sameLine.filter((n) => /^[\d,]+\.\d{2}$/.test(n.text));
        if (numNodes.length > 0) {
          result.amount = Math.max(
            ...numNodes.map((n) => parseFloat(n.text.replace(/,/g, ""))),
          );
          console.log("💰 XML金额(同行最大):", result.amount);
        }
      }
    }

    // 多页报销只跨页查找最终价税合计；抬头、购销双方和项目类型以第1页为准，
    // 防止不同页面相同坐标的文字被错误拼接。
    const headerTextNodes =
      options.pageScope === "all"
        ? textNodes.filter((node) => node.page === 1)
        : textNodes;

    // ── 2. 提取发票号码 ──
    // 模板A：标签和值在同一节点，如 "发票号码:26119..."
    const invoiceNodeA = headerTextNodes.find((n) =>
      /发票号码[：:]\s*(\d{15,25})/.test(n.text),
    );
    if (invoiceNodeA) {
      const match = invoiceNodeA.text.match(/发票号码[：:]\s*(\d{15,25})/);
      if (match) result.invoiceNumber = match[1];
    }
    // 模板B：标签和值分开，找"发票号码："标签右侧的数字节点
    if (!result.invoiceNumber) {
      const labelInv = headerTextNodes.find((n) =>
        /^发票号码[：:]?\s*$/.test(n.text),
      );
      if (labelInv) {
        const sameLine = headerTextNodes.filter(
          (n) => Math.abs(n.top - labelInv.top) <= 8 && n.left > labelInv.left,
        );
        const numNode = sameLine
          .sort((a, b) => a.left - b.left)
          .find((n) => /^\d{15,25}$/.test(n.text));
        if (numNode) result.invoiceNumber = numNode.text;
      }
    }
    // 模板C：发票号码单独一行（20位数字）
    if (!result.invoiceNumber) {
      const numNode = headerTextNodes.find((n) => /^\d{20}$/.test(n.text));
      if (numNode) result.invoiceNumber = numNode.text;
    }
    if (result.invoiceNumber)
      console.log("🔢 XML发票号码:", result.invoiceNumber);

    // ── 3. 提取开票日期 ──
    // 模板A：标签和值在同一节点，如 "开票日期:2026年04月07日"
    const dateNodeA = headerTextNodes.find((n) =>
      /开票日期[：:]\s*(\d{4}年\d{2}月\d{2}日)/.test(n.text),
    );
    if (dateNodeA) {
      const match = dateNodeA.text.match(
        /开票日期[：:]\s*(\d{4}年\d{2}月\d{2}日)/,
      );
      if (match) result.date = match[1];
    }
    // 模板B：标签和值分开
    if (!result.date) {
      const labelDate = headerTextNodes.find((n) =>
        /^开票日期[：:]?\s*$/.test(n.text),
      );
      if (labelDate) {
        const sameLine = headerTextNodes.filter(
          (n) =>
            Math.abs(n.top - labelDate.top) <= 8 && n.left > labelDate.left,
        );
        const dateNode = sameLine
          .sort((a, b) => a.left - b.left)
          .find((n) => /^\d{4}年\d{2}月\d{2}日$/.test(n.text));
        if (dateNode) result.date = dateNode.text;
      }
    }
    // 模板C：日期单独一行
    if (!result.date) {
      const dateNode = headerTextNodes.find((n) =>
        /^\d{4}年\d{2}月\d{2}日$/.test(n.text),
      );
      if (dateNode) result.date = dateNode.text;
    }
    if (result.date) console.log("📅 XML开票日期:", result.date);

    // ── 4. 提取购销双方名称和纳税人识别号 ──
    const partyFields =
      extractInvoicePartyFieldsFromPositionedText(headerTextNodes);
    result.buyer = partyFields.buyer;
    result.buyerTaxId = partyFields.buyerTaxId;
    result.seller = partyFields.seller;
    result.sellerTaxId = partyFields.sellerTaxId;
    result.itemName = extractInvoiceItemNameFromPositionedText(headerTextNodes);
    result.lineItems =
      extractInvoiceLineItemsFromPositionedText(headerTextNodes);
    result.taxAmount =
      extractInvoiceTaxAmountFromPositionedText(headerTextNodes);
    result.rawText = [...textNodes]
      .sort((left, right) => left.top - right.top || left.left - right.left)
      .map((node) => node.text)
      .join("\n");
    result.positionedTextNodes = textNodes;

    // ── 5. 提取报销类型（项目名称 *...*格式）──
    // 预付卡销售需要继续看后面的具体名称，交通卡充值应进入交通额度
    const allNodeText = headerTextNodes.map((n) => n.text).join("");
    const transportPrepaidCardType =
      extractTransportPrepaidCardType(allNodeText);
    if (transportPrepaidCardType) {
      result.type = transportPrepaidCardType;
    } else {
      // 先找通行费（高速费需特殊处理）
      const tollNode = headerTextNodes.find((n) =>
        /\*[^*]+\*\s*通行费/.test(n.text),
      );
      if (tollNode) {
        result.type = "通行费";
      } else {
        const typeNode = headerTextNodes.find((n) => /\*[^*]+\*/.test(n.text));
        if (typeNode) {
          const m2 = typeNode.text.match(/\*([^*]+)\*/);
          if (m2) result.type = m2[1].trim();
        }
      }
    }
    if (result.type) console.log("📋 XML报销类型:", result.type);

    console.log(
      "📐 XML提取结果:",
      JSON.stringify({
        amount: result.amount,
        taxAmount: result.taxAmount,
        invoiceNumber: result.invoiceNumber,
        date: result.date,
        seller: result.seller,
        sellerTaxId: result.sellerTaxId,
        buyer: result.buyer,
        buyerTaxId: result.buyerTaxId,
        itemName: result.itemName,
        type: result.type,
      }),
    );
    return result.amount || result.invoiceNumber || result.date ? result : null;
  } catch (e) {
    console.log("📐 XML提取异常:", e);
    return null;
  }
}

/**
 * 预处理 OCR 文本：修复常见 OCR 错误
 * 用于提高扫描件/副本发票的识别率
 */
function preprocessOcrText(text: string): string {
  let processed = text;

  // 修复 OCR 常见的数字间空格（如 "123 456 789" → 保留原文，但在金额匹配时处理）
  // 修复 OCR 将 "¥" 识别为其他字符的情况
  processed = processed.replace(/[＄﹩$]/g, "¥");

  // 修复 OCR 将中文冒号识别为其他字符
  processed = processed.replace(/[∶︰]/g, "：");

  return processed;
}

/**
 * 从文本中提取发票信息
 */
export function parseInvoiceText(text: string): InvoiceOcrResult {
  console.log("🔍 开始解析发票文本...");
  console.log("📝 文本长度:", text.length);

  // 预处理 OCR 文本
  text = preprocessOcrText(text);

  // 初始化结果
  const result: InvoiceOcrResult = {
    amount: 0,
    date: "",
    invoiceNumber: "",
    seller: "",
    sellerTaxId: "",
    buyer: "",
    buyerTaxId: "",
    taxAmount: 0,
    invoiceCode: "",
    type: "",
    isValidInvoice: false,
  };

  // 判断是否为铁路电子客票
  // "电子客票号"是铁路客票独有字段，普通发票不会有，单独出现即可确认
  // 另外兼容 pdf-parse 能完整提取文本的情况（同时有"铁路电子客票"标题）
  const textNoSpaceForRail = text.replace(/\s+/g, "");
  const isRailTicket =
    textNoSpaceForRail.includes("电子客票号") ||
    (textNoSpaceForRail.includes("铁路电子客票") &&
      textNoSpaceForRail.includes("12306"));

  // 1. 提取金额（价税合计）- 改进的匹配模式
  // 核心策略：价税合计的小写金额总是与大写金额（含"圆整/圆X角"）在同一行或相邻行
  // 优先匹配"大写金额附近的¥数字"，这是所有电子发票共同的结构
  const amountPatterns = [
    // 铁路电子客票专属：仅当确认是铁路客票时才匹配"票价"/"退票费"字段
    // 普通票用"票价"，改签差额退票用"退票费"，两者都只在铁路客票下启用
    ...(isRailTicket
      ? [
          /票\s*价[：:\s]*[¥￥？?]?\s*([\d,]+\.?\d{0,2})/,
          /退\s*票\s*费[：:\s]*[¥￥？?]?\s*([\d,]+\.?\d{0,2})/,
        ]
      : []),

    // 高置信度1：大写金额（圆整/圆X角X分）后面紧跟 ¥ 数字（同行或制表符分隔）
    // 如 "伍佰圆整\t¥500.00" 或 "叁佰陆拾壹圆整\t¥361.00"
    /[零壹贰叁参肆伍陆柒捌玖拾佰仟万亿]+圆[整零壹贰叁参肆伍陆柒捌玖拾角分]*[\s\t]*[¥￥?？]\s*([\d,]+\.\d{2})/,

    // 高置信度2：¥ 数字在前，大写金额在后（部分发票是倒序结构）
    // 如 "361.00\t(小写) ¥\t叁佰陆拾壹圆整" 需要反向匹配
    // 这个结构：数字 + (小写) + ¥ + 大写金额
    /([\d,]+\.\d{2})[\s\t]*[（(]\s*小\s*写\s*[）)][\s\t]*[¥￥?？][\s\t]*[零壹贰叁参肆伍陆柒捌玖拾佰仟万亿]+圆/,

    // 高置信度3：标准 "（小写）¥ 数字" 格式（金额紧跟标签）
    /[（(]\s*小\s*写\s*[）)][\s：:]*[¥￥?？]?\s*([\d,]+\.\d{2})/,

    // 高置信度4：价税合计区域内的小写金额（金额紧跟标签，200 字符范围）
    /价\s*税\s*合\s*计[\s\S]{0,200}?[（(]\s*小\s*写\s*[）)][\s：:]*[¥￥?？]?\s*([\d,]+\.\d{2})/,

    // 高置信度5：价税合计后面紧跟 ¥ 数字再跟大写金额
    /价\s*税\s*合\s*计[\s\S]{0,200}?[¥￥?？]\s*([\d,]+\.\d{2})\s*[零壹贰叁参肆伍陆柒捌玖拾佰仟万亿圆整角分]/,

    // --- 以下为低置信度兜底模式 ---

    // OCR 特殊情况："（小写)" 和金额分行，金额在下一行（无 ¥ 前缀）
    /[（(]\s*小\s*写\s*[）)]\s*\n\s*([\d,]+\.\d{2})/,

    // OCR 兼容：¥ 可能被识别为 "羊"、"¢"、"?" 等，匹配 "小写" 后面的金额
    /小\s*写\s*[）)]\s*[¥￥羊¢?？]?\s*([\d,]+\.\d{2})/,

    // OCR 兼容：匹配大写金额字符（含 OCR 误差）后面的数字金额（不要求"圆"字）
    /[零壹贰叁参肆伍陆柒捌玖拾佰仟万亿圆整角分炳歪]+[\s\t\n]*[¥￥羊¢?？]?\s*([\d,]+\.\d{2})/,

    // 匹配 "合计" 后面的金额（但排除价税合计）
    /(?<!价\s*税\s*)合\s*计[：:\s]*[¥￥]?\s*([\d,]+\.\d{2})/,

    // === 以下为副本/扫描件增强模式 ===

    // OCR 可能在数字间插入空格，如 "¥ 6 6 . 0 0" → 需先合并空格再匹配
    // 匹配 "价税合计" 或 "（小写）" 附近、¥ 后面的带空格数字
    /[（(]\s*小\s*写\s*[）)]\s*[¥￥?？]?\s*([\d][\d\s,]*\.[\d\s]{1,3})/,

    // 匹配独立的金额行：只有 ¥ 加数字的行（副本发票 OCR 经常把金额独立成一行）
    /^\s*[¥￥]\s*([\d,]+\.\d{2})\s*$/m,

    // 匹配 "金额" 后面的数字
    /金\s*额[：:\s]*[¥￥]?\s*([\d,]+\.\d{2})/,

    // 最宽松：匹配 ¥ 后面任何位置的两位小数金额（仅作为最后兜底）
    /[¥￥]\s*([\d,]+\.\d{2})/,
  ];

  // 高置信度模式的数量（价税合计/大写金额相关模式）
  // 铁路客票时前 2 个是票价/退票费（高置信度），再加 5 个通用高置信度
  const highConfidenceCount = isRailTicket ? 2 + 5 : 5;

  for (let i = 0; i < amountPatterns.length; i++) {
    const pattern = amountPatterns[i];
    const match = text.match(pattern);
    if (match && match[1]) {
      // 清理 OCR 产生的空格和逗号（如 "6 6 . 0 0" → "66.00"）
      const amountStr = match[1].replace(/[\s,]/g, "");
      const parsedAmount = parseFloat(amountStr);
      if (parsedAmount > 0) {
        result.amount = parsedAmount;
        result.amountFromPriceTax = i < highConfidenceCount;
        console.log(
          "💰 提取到金额:",
          result.amount,
          "高置信度:",
          result.amountFromPriceTax,
          "来源:",
          match[0].substring(0, 80),
        );
        console.log("💰 完整匹配内容:", match[0]);
        break;
      }
    }
  }

  // 2. 提取日期 - 改进的匹配模式
  const datePatterns = [
    // 最高优先级：匹配 "开票日期：" 后面的日期（可能有换行）
    /开票日期[：:\s]*([\r\n\s])*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /开票日期[：:\s]*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})/,
    // 匹配 "日期" 后面的日期
    /日期[：:\s]*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /日期[：:\s]*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})/,
    // 匹配独立的日期格式（带年月日）
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
    /(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})[日]?/,
    // === 副本/扫描件增强：OCR 可能在年月日数字间插入空格 ===
    // 如 "2 0 2 6 年 0 4 月 1 2 日"
    /(\d\s*\d\s*\d\s*\d)\s*年\s*(\d\s*\d?)\s*月\s*(\d\s*\d?)\s*日/,
    // 纯数字日期格式 YYYYMMDD（常见于扫描件 OCR）
    /(?:开票日期|日期)[：:\s]*(\d{4})(\d{2})(\d{2})/,
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      // 找到最后三个捕获组（跳过可能存在的前置捕获组）
      const groups = match.slice(1).filter((g) => g !== undefined);
      // 取最后三个有效捕获组作为 year/month/day
      let yearStr: string, monthStr: string, dayStr: string;
      if (groups.length >= 3) {
        yearStr = groups[groups.length - 3];
        monthStr = groups[groups.length - 2];
        dayStr = groups[groups.length - 1];
      } else {
        continue;
      }

      // 清理 OCR 空格（如 "2 0 2 6" → "2026"）
      const year = yearStr.replace(/\s/g, "");
      const month = monthStr.replace(/\s/g, "").padStart(2, "0");
      const day = dayStr.replace(/\s/g, "").padStart(2, "0");

      // 验证日期合理性
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      const dayNum = parseInt(day);

      if (
        yearNum >= 2000 &&
        yearNum <= 2030 &&
        monthNum >= 1 &&
        monthNum <= 12 &&
        dayNum >= 1 &&
        dayNum <= 31
      ) {
        result.date = `${year}-${month}-${day}`;
        console.log("📅 提取到日期:", result.date, "来源:", match[0]);
        break;
      }
    }
  }

  // 3. 提取发票号码 - 改进的匹配模式
  const invoiceNumberPatterns = [
    // 最高优先级：匹配 "发票号码：" 后面的数字（支持换行和空格，20位数字）
    /发票号码[：:\s]*[\r\n]*\s*(\d{20})/,
    // 匹配 "发票号码：" 后面的数字（支持换行和空格，8-24位数字）
    /发票号码[：:\s]*[\r\n]*\s*(\d{8,24})/,
    // === 副本/扫描件增强：OCR 可能在数字间插入空格 ===
    // 匹配 "发票号码" 后面带空格的数字序列
    /发票号码[：:\s]*[\r\n]*\s*([\d][\d\s]{17,28}\d)/,
    // 匹配 "票号码" 后面的数字（OCR 可能截断"发"字）
    /票\s*号\s*码[：:\s]*[\r\n]*\s*(\d{8,24})/,
    // 匹配 "开票人:" 前面的长数字（发票号码通常在这个位置）
    /开票人[：:][^\d]*(\d{20,24})/,
    // 匹配 "No." 后面的数字
    /No\.\s*(\d{8,24})/i,
  ];

  for (const pattern of invoiceNumberPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // 清理 OCR 空格（如 "2 6 1 1 7 0 ..." → "261170..."）
      result.invoiceNumber = match[1].replace(/\s/g, "");
      console.log(
        "🔢 提取到发票号码:",
        result.invoiceNumber,
        "来源:",
        match[0],
      );
      break;
    }
  }

  // 如果没有找到，尝试查找独立的20位数字（发票号码通常是20位）
  if (!result.invoiceNumber) {
    const longNumbers = text.match(/\b\d{20}\b/g);
    if (longNumbers && longNumbers.length > 0) {
      result.invoiceNumber = longNumbers[0];
      console.log("🔢 提取到发票号码（20位独立数字）:", result.invoiceNumber);
    }
  }

  // 如果还没有找到，尝试查找独立的8-12位数字（但要排除日期和金额）
  if (!result.invoiceNumber) {
    const allNumbers = text.match(/\b\d{8,12}\b/g);
    if (allNumbers) {
      for (const num of allNumbers) {
        // 排除日期格式（YYYYMMDD）
        if (num.length === 8) {
          const year = parseInt(num.substring(0, 4));
          const month = parseInt(num.substring(4, 6));
          const day = parseInt(num.substring(6, 8));
          if (
            year >= 2000 &&
            year <= 2030 &&
            month >= 1 &&
            month <= 12 &&
            day >= 1 &&
            day <= 31
          ) {
            continue; // 这是日期，跳过
          }
        }
        // 排除金额（包含小数点的数字）
        if (text.includes(num + ".")) {
          continue;
        }
        result.invoiceNumber = num;
        console.log("🔢 提取到发票号码（独立数字）:", result.invoiceNumber);
        break;
      }
    }
  }

  // 4. 提取发票代码
  const invoiceCodePatterns = [
    /发票代码[：:\s]*(\d{10,12})/,
    /代码[：:\s]*(\d{10,12})/,
  ];

  for (const pattern of invoiceCodePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      result.invoiceCode = match[1];
      console.log("🔢 提取到发票代码:", result.invoiceCode);
      break;
    }
  }

  // 5. 提取购销双方名称和纳税人识别号
  const partyFields = extractInvoicePartyFields(text);
  result.seller = partyFields.seller;
  result.sellerTaxId = partyFields.sellerTaxId;
  result.buyer = partyFields.buyer;
  result.buyerTaxId = partyFields.buyerTaxId;
  console.log("🏢 提取到销售方:", result.seller, result.sellerTaxId);
  console.log("👤 提取到购买方:", result.buyer, result.buyerTaxId);

  // 7. 提取税额
  const taxPatterns = [
    /税额[：:\s]*[¥￥]?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
    /税金[：:\s]*[¥￥]?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/,
  ];

  for (const pattern of taxPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const taxStr = match[1].replace(/,/g, "");
      result.taxAmount = parseFloat(taxStr);
      console.log("💵 提取到税额:", result.taxAmount);
      break;
    }
  }

  // 8. 提取报销类型（从项目名称中提取）
  // 铁路电子客票直接填充固定类型
  if (isRailTicket) {
    result.type = "铁路电子客票";
    console.log("📋 铁路电子客票，自动填充报销类型:", result.type);
  } else {
    // 预付卡销售需继续看后缀，避免交通卡充值被归为普通"预付卡销售"
    const transportPrepaidCardType = extractTransportPrepaidCardType(text);
    if (transportPrepaidCardType) {
      result.type = transportPrepaidCardType;
      console.log("📋 检测到交通预付卡发票，报销类型设为:", result.type);
    } else {
      // 特殊处理：*经营租赁*通行费 -> 提取 "通行费"（高速费电子发票需参与核减）
      // 精确匹配项目名称格式 *...*通行费，避免全文搜索误判
      const tollPattern = /\*([^*]+)\*\s*通行费/;
      const tollMatch = text.match(tollPattern);
      if (tollMatch) {
        result.type = "通行费";
        console.log(
          "📋 检测到通行费发票（项目名称: *" +
            tollMatch[1] +
            "*通行费），报销类型设为:",
          result.type,
        );
      } else {
        // 通用格式：*保险服务*附加公共场所 -> 提取 "保险服务"
        const typePattern = /\*([^*]+)\*/;
        const typeMatch = text.match(typePattern);
        if (typeMatch && typeMatch[1]) {
          result.type = typeMatch[1].trim();
          console.log("📋 提取到报销类型:", result.type);
        }
      }
    }
  }

  // 判断是否为有效发票（标准验证：必须同时满足所有条件）
  const textNoSpace = text.replace(/\s+/g, "");
  const hasInvoiceKeyword =
    textNoSpace.includes("发票") || textNoSpace.includes("電子發票");
  const hasAmount = result.amount > 0;
  const hasDate = !!result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date);

  // 铁路电子客票：发票号码 或 电子客票号 满足其一即可
  const hasInvoiceNumber =
    !!result.invoiceNumber && result.invoiceNumber.length >= 8;
  const hasRailTicketNo = isRailTicket && textNoSpace.includes("电子客票号");

  console.log("🔍 有效性验证:", {
    isRailTicket,
    hasInvoiceKeyword,
    hasAmount,
    hasDate,
    hasInvoiceNumber,
    hasRailTicketNo,
  });

  result.isValidInvoice =
    hasInvoiceKeyword &&
    hasAmount &&
    hasDate &&
    (hasInvoiceNumber || hasRailTicketNo);

  console.log("✅ 发票解析完成:", {
    amount: result.amount,
    date: result.date,
    invoiceNumber: result.invoiceNumber,
    type: result.type,
    isValid: result.isValidInvoice,
  });

  return result;
}

/**
 * 将 PDF 转为图片并用 PaddleOCR 识别文本
 * @param pdfPath PDF 文件路径
 * @param dpi 转换 DPI，默认 300，扫描件/副本可用 600
 */
async function extractTextFromPdfViaImage(
  pdfPath: string,
  dpi: number = 300,
): Promise<string> {
  console.log(`🖼️ 开始 PDF 转图片 OCR 识别... (DPI: ${dpi})`);

  const { execFileSync } = await import("child_process");

  // 使用 pdftoppm 将 PDF 第一页转为 PNG
  const tmpPngPath = pdfPath + `-page-${dpi}`;
  execFileSync(
    "pdftoppm",
    ["-png", "-r", String(dpi), "-f", "1", "-l", "1", pdfPath, tmpPngPath],
    { timeout: 30000 },
  );

  // pdftoppm 输出文件名格式为 xxx-page-1.png 或 xxx-page-01.png
  const possibleFiles = [
    `${tmpPngPath}-1.png`,
    `${tmpPngPath}-01.png`,
    `${tmpPngPath}-001.png`,
  ];
  let pngFilePath = "";
  for (const f of possibleFiles) {
    if (fs.existsSync(f)) {
      pngFilePath = f;
      break;
    }
  }

  if (!pngFilePath) {
    throw new Error("PDF 转图片失败：未找到输出文件");
  }

  console.log("🖼️ PDF 转图片完成，路径:", pngFilePath);

  try {
    // 用 PaddleOCR 识别
    const text = await callPaddleOcr(pngFilePath);

    console.log("🖼️ PaddleOCR 识别完成，文本长度:", text.length);

    return text;
  } finally {
    // 清理临时图片文件
    try {
      fs.unlinkSync(pngFilePath);
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * 合并两次 OCR 识别结果，取各字段的最佳值
 * 用于将 pdf-parse 结果与 PaddleOCR 结果合并，提高识别完整度
 */
function mergeOcrResults(
  primary: InvoiceOcrResult | null,
  secondary: InvoiceOcrResult | null,
): InvoiceOcrResult | null {
  if (!primary && !secondary) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;

  const merged: InvoiceOcrResult = {
    // 金额：优先取高置信度（价税合计）来源，否则取较大的有效值
    amount:
      primary.amountFromPriceTax && primary.amount > 0
        ? primary.amount
        : secondary?.amountFromPriceTax && (secondary?.amount ?? 0) > 0
          ? secondary.amount
          : primary.amount > 0
            ? primary.amount
            : (secondary?.amount ?? 0),
    amountFromPriceTax:
      primary.amountFromPriceTax || secondary?.amountFromPriceTax,
    // 日期：优先取有效的
    date:
      primary.date && /^\d{4}-\d{2}-\d{2}$/.test(primary.date)
        ? primary.date
        : secondary.date,
    // 发票号码：优先取较长的（更完整）
    invoiceNumber:
      primary.invoiceNumber &&
      primary.invoiceNumber.length >= (secondary.invoiceNumber?.length || 0)
        ? primary.invoiceNumber
        : secondary.invoiceNumber || primary.invoiceNumber,
    // 其他字段：取非空的
    seller: primary.seller || secondary.seller,
    sellerTaxId: primary.sellerTaxId || secondary.sellerTaxId,
    buyer: primary.buyer || secondary.buyer,
    buyerTaxId: primary.buyerTaxId || secondary.buyerTaxId,
    taxAmount: primary.taxAmount || secondary.taxAmount,
    invoiceCode: primary.invoiceCode || secondary.invoiceCode,
    type: primary.type || secondary.type,
    // 有效性：任一通过即可
    isValidInvoice: primary.isValidInvoice || secondary.isValidInvoice,
  };

  console.log("🔀 合并 OCR 结果:", {
    primaryAmount: primary.amount,
    secondaryAmount: secondary.amount,
    mergedAmount: merged.amount,
    primaryDate: primary.date,
    secondaryDate: secondary.date,
    mergedDate: merged.date,
    primaryInvNo: primary.invoiceNumber,
    secondaryInvNo: secondary.invoiceNumber,
    mergedInvNo: merged.invoiceNumber,
    primaryValid: primary.isValidInvoice,
    secondaryValid: secondary.isValidInvoice,
    mergedValid: merged.isValidInvoice,
  });

  return merged;
}

/**
 * 本地 OCR 识别发票
 * 策略：
 *   1. 先用 pdf-parse 提取文本
 *   2. 如果关键字段缺失，回退到 PDF 转图片 + PaddleOCR (300 DPI)
 *   3. 合并两次 OCR 结果，取最佳字段
 *   4. 如果合并后仍不完整，用更高 DPI (600) 再试一次
 *   5. 最终采用分层验证：标准验证 + 宽松验证（副本/扫描件模式）
 * @param filePath PDF 文件路径
 * @returns 发票识别结果
 */
export async function recognizeInvoiceLocally(
  filePath: string,
): Promise<InvoiceOcrResult> {
  console.log("🔍 开始本地 OCR 识别...");
  console.log("📄 文件路径:", filePath);

  try {
    if (!fs.existsSync(filePath)) {
      throw new Error("文件不存在");
    }

    // 验证文件格式：通过文件头魔术字节判断是否为 PDF（临时文件可能没有扩展名）
    const headerBuf = Buffer.alloc(5);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, headerBuf, 0, 5, 0);
    fs.closeSync(fd);
    const isPdf = headerBuf.toString("ascii") === "%PDF-";
    if (!isPdf) {
      throw new Error("此不是PDF文件，请重新上传");
    }

    // 第一步：用 pdftohtml XML 坐标方案提取所有关键字段（有文字层的 PDF）
    console.log("📐 尝试 XML 坐标方案提取发票信息...");
    // 报销发票允许多页，最终价税合计可能只出现在末页；合同财务识别继续使用默认首
    // 页范围，并由其独立的页数门禁决定后续复核路径。
    const xmlResult = await extractInvoiceFromXml(filePath, {
      pageScope: "all",
    });
    const xmlHasAllFields =
      xmlResult &&
      xmlResult.amount &&
      xmlResult.date &&
      xmlResult.invoiceNumber &&
      xmlResult.buyer &&
      xmlResult.buyerTaxId;
    console.log(
      "📐 xmlHasAllFields:",
      xmlHasAllFields,
      "| amount:",
      xmlResult?.amount,
      "| date:",
      xmlResult?.date,
      "| invoiceNumber:",
      xmlResult?.invoiceNumber,
    );

    let result: InvoiceOcrResult | null = null;

    if (xmlHasAllFields) {
      // XML 提取完整，直接构建结果，无需 pdf-parse 或 PaddleOCR
      console.log("✅ XML方案提取完整，跳过 pdf-parse 和图片 OCR");
      result = {
        amount: xmlResult!.amount!,
        amountFromPriceTax: true,
        date: xmlResult!.date!.replace(
          /(\d{4})年(\d{2})月(\d{2})日/,
          "$1-$2-$3",
        ),
        invoiceNumber: xmlResult!.invoiceNumber!,
        type: xmlResult!.type || "",
        seller: xmlResult!.seller || "",
        sellerTaxId: xmlResult!.sellerTaxId || "",
        buyer: xmlResult!.buyer || "",
        buyerTaxId: xmlResult!.buyerTaxId || "",
        taxAmount: 0,
        invoiceCode: "",
        isValidInvoice: true,
      };
    } else {
      // 第二步：XML 提取不完整（扫描件无文字层），回退到 PaddleOCR 图片路线
      console.log(
        "⚠️ XML未完整提取（可能是扫描件），回退到 PDF 转图片 + PaddleOCR (300 DPI)...",
      );

      let imageOcrResult: InvoiceOcrResult | null = null;
      try {
        const imageText = await extractTextFromPdfViaImage(filePath, 300);
        if (imageText && imageText.trim().length > 0) {
          imageOcrResult = parseInvoiceText(imageText);
        }
      } catch (imageOcrError) {
        console.error("⚠️ 图片 OCR 回退失败 (300 DPI):", imageOcrError);
      }

      result = imageOcrResult;

      // 第三步：300 DPI 不完整，尝试 600 DPI
      if (!result || !result.isValidInvoice) {
        console.log("⚠️ 300 DPI 识别不完整，尝试 600 DPI 高清识别...");
        try {
          const hdImageText = await extractTextFromPdfViaImage(filePath, 600);
          if (hdImageText && hdImageText.trim().length > 0) {
            const hdResult = parseInvoiceText(hdImageText);
            result = mergeOcrResults(result, hdResult);
          }
        } catch (hdOcrError) {
          console.error("⚠️ 高清图片 OCR 也失败 (600 DPI):", hdOcrError);
        }
      }
    }

    // 最终判断：必须同时满足 isValidInvoice 和三个关键字段齐全
    if (
      !result ||
      !result.isValidInvoice ||
      !result.amount ||
      !result.date ||
      !result.invoiceNumber
    ) {
      console.log("❌ 最终验证失败:", {
        hasResult: !!result,
        isValid: result?.isValidInvoice,
        amount: result?.amount,
        date: result?.date,
        invoiceNumber: result?.invoiceNumber,
      });
      throw new Error("此不是有效发票，请重新上传");
    }

    return result;
  } catch (error) {
    console.error("❌ 本地 OCR 识别失败:", error);
    throw error;
  }
}
