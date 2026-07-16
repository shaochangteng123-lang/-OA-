import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const execFileAsync = promisify(execFile);

export type NumberedOnboardingDocumentType =
  | "invitation"
  | "application"
  | "contract";

export const NUMBERED_ONBOARDING_TEMPLATE_TYPES = new Set<string>([
  "invitation",
  "application",
  "contract",
]);

export function isNumberedOnboardingDocumentType(
  value: unknown,
): value is NumberedOnboardingDocumentType {
  return (
    typeof value === "string" && NUMBERED_ONBOARDING_TEMPLATE_TYPES.has(value)
  );
}

interface PdfRgbColor {
  red: number;
  green: number;
  blue: number;
}

interface PdfHtmlBox {
  top: number;
  left: number;
  width: number;
  height: number;
  fontSize: number;
}

interface PdfHtmlTextNode extends PdfHtmlBox {
  text: string;
  color: PdfRgbColor;
}

interface PdfHtmlPage {
  pageIndex: number;
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  textNodes: PdfHtmlTextNode[];
}

export interface EmployeeNumberFieldAnchor {
  pageIndex?: number;
  pageWidth: number;
  pageHeight: number;
  hasSeparator: boolean;
  label: PdfHtmlBox;
  value: PdfHtmlBox | null;
  cover?: PdfHtmlBox;
  drawLeft?: number;
  textColor?: PdfRgbColor;
}

const BLACK: PdfRgbColor = { red: 0, green: 0, blue: 0 };

export class EmployeeNumberFieldNotFoundError extends Error {
  constructor(message = "未识别到员工编号位置") {
    super(message);
    this.name = "EmployeeNumberFieldNotFoundError";
  }
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([\w:-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    attributes[match[1]] = match[2];
  }
  return attributes;
}

function decodeXmlText(source: string): string {
  return source
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, "");
}

function textWidthWeight(value: string): number {
  return Array.from(value).reduce((total, character) => {
    return total + (/^[\x20-\x7e]$/.test(character) ? 0.55 : 1);
  }, 0);
}

function parseHexColor(value: string | undefined): PdfRgbColor {
  const normalized = String(value || "").trim();
  const shortMatch = normalized.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (shortMatch) {
    return {
      red: parseInt(`${shortMatch[1]}${shortMatch[1]}`, 16) / 255,
      green: parseInt(`${shortMatch[2]}${shortMatch[2]}`, 16) / 255,
      blue: parseInt(`${shortMatch[3]}${shortMatch[3]}`, 16) / 255,
    };
  }

  const fullMatch = normalized.match(
    /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i,
  );
  if (!fullMatch) return BLACK;
  return {
    red: parseInt(fullMatch[1], 16) / 255,
    green: parseInt(fullMatch[2], 16) / 255,
    blue: parseInt(fullMatch[3], 16) / 255,
  };
}

function isPotentialEmployeeNumberValue(value: string): boolean {
  const compact = compactText(value).toUpperCase();
  return (
    /^(?:[：:]?)(?:YULI-CS\d{3,6}|\d{1,6}|[_＿-]{2,})$/.test(compact) ||
    /^[：:]$/.test(compact)
  );
}

function mergeBoxes(boxes: PdfHtmlTextNode[]): PdfHtmlBox {
  const left = Math.min(...boxes.map((box) => box.left));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    fontSize: Math.max(...boxes.map((box) => box.fontSize)),
  };
}

function parsePdfHtmlPages(xml: string): PdfHtmlPage[] {
  const fontSpecs = new Map<string, { size: number; color: PdfRgbColor }>();
  const fontPattern = /<fontspec\b([^>]*)\/?\s*>/g;
  let fontMatch: RegExpExecArray | null;
  while ((fontMatch = fontPattern.exec(xml)) !== null) {
    const attributes = parseAttributes(fontMatch[1]);
    const size = Number(attributes.size);
    if (!attributes.id || !(size > 0)) continue;
    fontSpecs.set(attributes.id, {
      size,
      color: parseHexColor(attributes.color),
    });
  }

  const pages: PdfHtmlPage[] = [];
  const pagePattern = /<page\b([^>]*)>([\s\S]*?)<\/page>/g;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pagePattern.exec(xml)) !== null) {
    const pageAttributes = parseAttributes(pageMatch[1]);
    const pageWidth = Number(pageAttributes.width);
    const pageHeight = Number(pageAttributes.height);
    if (!(pageWidth > 0) || !(pageHeight > 0)) continue;

    const textNodes: PdfHtmlTextNode[] = [];
    const textPattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textPattern.exec(pageMatch[2])) !== null) {
      const attributes = parseAttributes(textMatch[1]);
      const text = decodeXmlText(textMatch[2]);
      const top = Number(attributes.top);
      const left = Number(attributes.left);
      const width = Number(attributes.width);
      const height = Number(attributes.height);
      if (!text || ![top, left, width, height].every(Number.isFinite)) continue;
      const font = fontSpecs.get(attributes.font);
      textNodes.push({
        text,
        top,
        left,
        width,
        height,
        fontSize: font?.size || Math.max(height * 0.7, 1),
        color: font?.color || BLACK,
      });
    }

    pages.push({
      pageIndex: pages.length,
      pageNumber: Number(pageAttributes.number) || pages.length + 1,
      pageWidth,
      pageHeight,
      textNodes,
    });
  }
  return pages;
}

function buildAnchorFromCandidate(
  page: PdfHtmlPage,
  node: PdfHtmlTextNode,
  match: RegExpMatchArray,
): EmployeeNumberFieldAnchor {
  const labelCompact = `${match[1] || ""}编号${match[2] || ""}`;
  const inlineValue = match[3] || "";
  const totalWeight = textWidthWeight(compactText(node.text)) || 1;
  const labelWidth = inlineValue
    ? node.width * (textWidthWeight(labelCompact) / totalWeight)
    : node.width;
  const label: PdfHtmlBox = {
    top: node.top,
    left: node.left,
    width: labelWidth,
    height: node.height,
    fontSize: node.fontSize,
  };

  let value: PdfHtmlBox | null = null;
  let textColor = node.color;
  if (inlineValue) {
    value = {
      top: node.top,
      left: node.left + labelWidth,
      width: Math.max(node.width - labelWidth, 1),
      height: node.height,
      fontSize: node.fontSize,
    };
  } else {
    const labelRight = label.left + label.width;
    const labelCenter = label.top + label.height / 2;
    const sameLineNodes = page.textNodes
      .filter((candidate) => candidate !== node)
      .filter((candidate) => candidate.left >= labelRight - 3)
      .filter((candidate) => {
        const candidateCenter = candidate.top + candidate.height / 2;
        return (
          Math.abs(candidateCenter - labelCenter) <=
          Math.max(label.height, candidate.height) * 0.7
        );
      })
      .sort((left, right) => left.left - right.left);

    const firstValueNode = sameLineNodes.find((candidate) =>
      isPotentialEmployeeNumberValue(candidate.text),
    );
    if (firstValueNode) {
      const valueNodes = [firstValueNode];
      if (/^[：:]$/.test(compactText(firstValueNode.text))) {
        const followingNode = sameLineNodes.find((candidate) => {
          return (
            candidate.left >= firstValueNode.left + firstValueNode.width - 3 &&
            candidate !== firstValueNode &&
            isPotentialEmployeeNumberValue(candidate.text)
          );
        });
        if (followingNode) valueNodes.push(followingNode);
      }
      value = mergeBoxes(valueNodes);
      textColor = firstValueNode.color;
    }
  }

  return {
    pageIndex: page.pageIndex,
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    hasSeparator: Boolean(match[2]),
    label,
    value,
    textColor,
  };
}

function findEmployeeNumberFieldOnPage(
  page: PdfHtmlPage,
  documentType: NumberedOnboardingDocumentType,
): EmployeeNumberFieldAnchor | null {
  const continuationContractPage =
    documentType === "contract" && page.pageIndex > 0;
  const candidates = page.textNodes.flatMap((node) => {
    const compact = compactText(node.text);
    const match = compact.match(/^(合同|员工)?编号([：:]?)(.*)$/);
    if (!match) return [];

    const prefix = match[1] || "";
    if (continuationContractPage) {
      if (prefix !== "合同") return [];
      if (node.top > page.pageHeight * 0.25 || node.left > page.pageWidth * 0.5)
        return [];
    } else {
      if (documentType !== "contract" && prefix === "合同") return [];
      if (node.top > page.pageHeight * 0.45 || node.left < page.pageWidth * 0.4)
        return [];
    }
    return [{ node, match }];
  });

  candidates.sort((left, right) => {
    if (continuationContractPage) {
      return left.node.top - right.node.top || left.node.left - right.node.left;
    }
    return left.node.top - right.node.top || right.node.left - left.node.left;
  });
  const selected = candidates[0];
  return selected
    ? buildAnchorFromCandidate(page, selected.node, selected.match)
    : null;
}

export function parseEmployeeNumberFieldsXml(
  xml: string,
  documentType: NumberedOnboardingDocumentType,
): EmployeeNumberFieldAnchor[] {
  return parsePdfHtmlPages(xml)
    .map((page) => findEmployeeNumberFieldOnPage(page, documentType))
    .filter((anchor): anchor is EmployeeNumberFieldAnchor => Boolean(anchor));
}

export function parseEmployeeNumberFieldXml(
  xml: string,
): EmployeeNumberFieldAnchor | null {
  const firstPage = parsePdfHtmlPages(xml)[0];
  return firstPage
    ? findEmployeeNumberFieldOnPage(firstPage, "application")
    : null;
}

async function extractEmployeeNumberLayout(pdfPath: string): Promise<{
  pages: PdfHtmlPage[];
  xml: string;
}> {
  const { stdout } = await execFileAsync(
    "pdftohtml",
    ["-xml", "-stdout", "-nodrm", "-i", pdfPath],
    {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  return { pages: parsePdfHtmlPages(stdout), xml: stdout };
}

function requiredPageIndexes(
  documentType: NumberedOnboardingDocumentType,
  pageCount: number,
): number[] {
  if (pageCount <= 0) return [];
  return documentType === "application"
    ? [0]
    : Array.from({ length: pageCount }, (_, index) => index);
}

function documentTypeLabel(
  documentType: NumberedOnboardingDocumentType,
): string {
  if (documentType === "invitation") return "入职邀请函";
  if (documentType === "application") return "新员工入职申请表";
  return "劳动合同书";
}

export async function writeEmployeeNumberToPdfBytes(
  sourceBytes: Uint8Array,
  employeeNo: string,
  anchors: EmployeeNumberFieldAnchor | EmployeeNumberFieldAnchor[],
): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
  });
  const pages = pdfDocument.getPages();
  if (pages.length === 0) throw new Error("文件没有可用页面");

  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);
  const normalizedAnchors = Array.isArray(anchors) ? anchors : [anchors];
  for (const anchor of normalizedAnchors) {
    const pageIndex = anchor.pageIndex ?? 0;
    const page = pages[pageIndex];
    if (!page) throw new Error(`文件不存在第 ${pageIndex + 1} 页`);
    if (page.getRotation().angle % 360 !== 0) {
      throw new Error(
        `文件第 ${pageIndex + 1} 页存在旋转，无法准确写入员工编号`,
      );
    }

    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    const scaleX = pageWidth / anchor.pageWidth;
    const scaleY = pageHeight / anchor.pageHeight;
    const reference = anchor.value || anchor.label;
    const text = anchor.hasSeparator ? employeeNo : `: ${employeeNo}`;
    const drawLeft =
      anchor.drawLeft ??
      anchor.value?.left ??
      anchor.label.left + anchor.label.width;
    const drawX = drawLeft * scaleX + (anchor.value ? 0 : 2);
    const maxWidth = Math.max(pageWidth - drawX - 8, 1);
    let fontSize = Math.min(Math.max(reference.fontSize * scaleY, 8), 18);
    while (font.widthOfTextAtSize(text, fontSize) > maxWidth && fontSize > 7) {
      fontSize -= 0.5;
    }
    if (font.widthOfTextAtSize(text, fontSize) > maxWidth) {
      throw new Error(`员工编号过长，无法写入文件第 ${pageIndex + 1} 页`);
    }

    const cover = anchor.cover || anchor.value;
    if (cover) {
      const coverX = cover.left * scaleX - 1;
      const coverY = pageHeight - (cover.top + cover.height) * scaleY - 1;
      page.drawRectangle({
        x: coverX,
        y: coverY,
        width: cover.width * scaleX + 3,
        height: cover.height * scaleY + 2,
        color: rgb(1, 1, 1),
      });
    }

    const drawY = pageHeight - (reference.top + reference.fontSize) * scaleY;
    const textColor = anchor.textColor || BLACK;
    page.drawText(text, {
      x: drawX,
      y: drawY,
      size: fontSize,
      font,
      color: rgb(textColor.red, textColor.green, textColor.blue),
    });
  }

  return pdfDocument.save();
}

export async function writeEmployeeNumberToOnboardingTemplate(
  pdfPath: string,
  employeeNo: string,
  documentType: NumberedOnboardingDocumentType,
): Promise<Uint8Array> {
  const sourceBytes = fs.readFileSync(pdfPath);
  const sourceDocument = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
  });
  const pageCount = sourceDocument.getPageCount();
  if (pageCount === 0) throw new Error("文件没有可用页面");

  const layout = await extractEmployeeNumberLayout(pdfPath);
  const parsedAnchors = layout.pages
    .map((page) => findEmployeeNumberFieldOnPage(page, documentType))
    .filter((anchor): anchor is EmployeeNumberFieldAnchor => Boolean(anchor));

  const anchorsByPage = new Map(
    parsedAnchors.map((anchor) => [anchor.pageIndex ?? 0, anchor]),
  );
  const requiredIndexes = requiredPageIndexes(documentType, pageCount);
  const missingIndexes = requiredIndexes.filter(
    (pageIndex) => !anchorsByPage.has(pageIndex),
  );
  if (missingIndexes.length > 0) {
    const pages = missingIndexes.map((pageIndex) => pageIndex + 1).join("、");
    throw new EmployeeNumberFieldNotFoundError(
      `${documentTypeLabel(documentType)}第 ${pages} 页未识别到编号位置`,
    );
  }

  const anchors = requiredIndexes.map(
    (pageIndex) => anchorsByPage.get(pageIndex)!,
  );
  return writeEmployeeNumberToPdfBytes(sourceBytes, employeeNo, anchors);
}
