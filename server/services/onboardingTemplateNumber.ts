import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createCanvas } from "canvas";

const execFileAsync = promisify(execFile);

export type NumberedOnboardingDocumentType =
  | "invitation"
  | "application"
  | "contract"
  | "asset";

export const NUMBERED_ONBOARDING_TEMPLATE_TYPES = new Set<string>([
  "invitation",
  "application",
  "contract",
  "asset",
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

interface PdfHtmlLine extends PdfHtmlBox {
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  nodes: PdfHtmlTextNode[];
  text: string;
  compact: string;
  color: PdfRgbColor;
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

export interface ContractTemplateDates {
  contractStartDate: string;
  contractEndDate: string;
  probationStartDate: string | null;
  probationEndDate: string | null;
}

export interface EmployeeContractTemplateData extends ContractTemplateDates {
  position: string;
}

export interface PdfDatePartsAnchor {
  year: PdfHtmlBox;
  month: PdfHtmlBox;
  day: PdfHtmlBox;
}

export interface PdfDateRangeAnchor {
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  start: PdfDatePartsAnchor;
  end: PdfDatePartsAnchor;
}

export interface ContractTemplateDateFields {
  contract: PdfDateRangeAnchor;
  probation: PdfDateRangeAnchor;
}

export interface ContractTemplatePositionField {
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  value: PdfHtmlBox;
}

export interface EmployeeAssetAgreementTemplateData {
  companyName?: string;
  employeeName: string;
  idNumber: string;
}

export interface PdfTextFieldAnchor {
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  value: PdfHtmlBox;
  cover?: PdfHtmlBox;
  underline?: boolean;
  textColor?: PdfRgbColor;
}

export interface AssetAgreementTemplateFields {
  employeeNumbers: EmployeeNumberFieldAnchor[];
  partyA: PdfTextFieldAnchor;
  partyB: PdfTextFieldAnchor;
  idNumber: PdfTextFieldAnchor;
}

const BLACK: PdfRgbColor = { red: 0, green: 0, blue: 0 };
const DEFAULT_ASSET_AGREEMENT_COMPANY_NAME = "北京羽隶工程咨询有限公司";

export class EmployeeNumberFieldNotFoundError extends Error {
  constructor(message = "未识别到员工编号位置") {
    super(message);
    this.name = "EmployeeNumberFieldNotFoundError";
  }
}

export class ContractTemplateDateFieldNotFoundError extends Error {
  constructor(message = "未识别到劳动合同期限或试用期日期位置") {
    super(message);
    this.name = "ContractTemplateDateFieldNotFoundError";
  }
}

export class ContractTemplatePositionFieldNotFoundError extends Error {
  constructor(message = "未识别到劳动合同第四条职位位置") {
    super(message);
    this.name = "ContractTemplatePositionFieldNotFoundError";
  }
}

export class AssetAgreementFieldNotFoundError extends Error {
  constructor(message = "未识别到电脑管理办法协议字段位置") {
    super(message);
    this.name = "AssetAgreementFieldNotFoundError";
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

function buildLineFromNodes(
  page: PdfHtmlPage,
  nodes: PdfHtmlTextNode[],
): PdfHtmlLine {
  const sortedNodes = [...nodes].sort((left, right) => left.left - right.left);
  const box = mergeBoxes(sortedNodes);
  const text = sortedNodes.map((node) => node.text).join("");
  return {
    ...box,
    pageIndex: page.pageIndex,
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    nodes: sortedNodes,
    text,
    compact: compactText(text),
    color: sortedNodes[0]?.color || BLACK,
  };
}

function buildPdfHtmlLines(page: PdfHtmlPage): PdfHtmlLine[] {
  const groups: PdfHtmlTextNode[][] = [];
  const nodes = [...page.textNodes].sort((left, right) => {
    return left.top - right.top || left.left - right.left;
  });

  for (const node of nodes) {
    const nodeCenter = node.top + node.height / 2;
    const group = groups.find((candidate) => {
      const box = mergeBoxes(candidate);
      const lineCenter = box.top + box.height / 2;
      return (
        Math.abs(nodeCenter - lineCenter) <=
        Math.max(box.height, node.height) * 0.65
      );
    });

    if (group) {
      group.push(node);
    } else {
      groups.push([node]);
    }
  }

  return groups
    .map((group) => buildLineFromNodes(page, group))
    .sort((left, right) => left.top - right.top || left.left - right.left);
}

function lineXAtCompactIndex(line: PdfHtmlLine, targetIndex: number): number {
  let index = 0;
  let right = line.left;

  for (const node of line.nodes) {
    const compact = compactText(node.text);
    if (!compact) continue;

    const start = index;
    const end = start + Array.from(compact).length;
    if (targetIndex <= start) return node.left;
    if (targetIndex <= end) {
      const prefix = Array.from(compact).slice(0, targetIndex - start).join("");
      const totalWeight = textWidthWeight(compact) || 1;
      return (
        node.left + node.width * (textWidthWeight(prefix) / totalWeight)
      );
    }

    index = end;
    right = node.left + node.width;
  }

  return right;
}

function lineXRangeAtCompactIndex(
  line: PdfHtmlLine,
  targetIndex: number,
): { left: number; right: number } | null {
  const candidates: number[] = [];
  let compactOffset = 0;

  for (const node of line.nodes) {
    const rawCharacters = Array.from(node.text);
    const compactLength = Array.from(compactText(node.text)).length;
    const relativeIndex = targetIndex - compactOffset;

    if (relativeIndex >= 0 && relativeIndex <= compactLength) {
      let consumedCompactCharacters = 0;
      const rawBoundaryIndexes: number[] = [];

      for (
        let rawBoundaryIndex = 0;
        rawBoundaryIndex <= rawCharacters.length;
        rawBoundaryIndex += 1
      ) {
        if (
          rawBoundaryIndex > 0 &&
          !/\s/u.test(rawCharacters[rawBoundaryIndex - 1])
        ) {
          consumedCompactCharacters += 1;
        }
        if (consumedCompactCharacters === relativeIndex) {
          rawBoundaryIndexes.push(rawBoundaryIndex);
        }
      }

      const totalWeight = textWidthWeight(node.text) || 1;
      for (const rawBoundaryIndex of rawBoundaryIndexes) {
        const prefix = rawCharacters.slice(0, rawBoundaryIndex).join("");
        candidates.push(
          node.left +
            node.width * (textWidthWeight(prefix) / totalWeight),
        );
      }
    }

    compactOffset += compactLength;
  }

  if (candidates.length === 0) return null;
  return {
    left: Math.min(...candidates),
    right: Math.max(...candidates),
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
    } else if (documentType === "asset") {
      if (prefix === "合同") return [];
      if (node.top > page.pageHeight * 0.5) return [];
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

function buildDateValueBox(
  leftMarker: PdfHtmlTextNode,
  rightMarker: PdfHtmlTextNode,
): PdfHtmlBox | null {
  const left = leftMarker.left + leftMarker.width;
  const width = rightMarker.left - left;
  if (width < 8) return null;
  return {
    top: Math.min(leftMarker.top, rightMarker.top),
    left,
    width,
    height: Math.max(leftMarker.height, rightMarker.height),
    fontSize: Math.max(leftMarker.fontSize, rightMarker.fontSize),
  };
}

function buildDateRangeAnchor(
  page: PdfHtmlPage,
  label: PdfHtmlTextNode,
): PdfDateRangeAnchor | null {
  const labelCenter = label.top + label.height / 2;
  const sameLineNodes = page.textNodes
    .filter((candidate) => candidate.left >= label.left - 2)
    .filter((candidate) => {
      const candidateCenter = candidate.top + candidate.height / 2;
      return (
        Math.abs(candidateCenter - labelCenter) <=
        Math.max(label.height, candidate.height) * 0.55
      );
    })
    .sort((left, right) => left.left - right.left);

  const years = sameLineNodes.filter((node) => compactText(node.text) === "年");
  const months = sameLineNodes.filter((node) => compactText(node.text) === "月");
  const separator = sameLineNodes.find((node) =>
    compactText(node.text).includes("日起至"),
  );
  if (years.length < 2 || months.length < 2 || !separator) return null;

  const ending = sameLineNodes.find((node) => {
    return (
      node.left > months[1].left &&
      compactText(node.text).startsWith("日")
    );
  });
  if (!ending) return null;

  const startYear = buildDateValueBox(label, years[0]);
  const startMonth = buildDateValueBox(years[0], months[0]);
  const startDay = buildDateValueBox(months[0], separator);
  const endYear = buildDateValueBox(separator, years[1]);
  const endMonth = buildDateValueBox(years[1], months[1]);
  const endDay = buildDateValueBox(months[1], ending);
  if (
    !startYear ||
    !startMonth ||
    !startDay ||
    !endYear ||
    !endMonth ||
    !endDay
  ) {
    return null;
  }

  return {
    pageIndex: page.pageIndex,
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    start: {
      year: startYear,
      month: startMonth,
      day: startDay,
    },
    end: {
      year: endYear,
      month: endMonth,
      day: endDay,
    },
  };
}

export function parseContractTemplateDateFieldsXml(
  xml: string,
): ContractTemplateDateFields | null {
  let contract: PdfDateRangeAnchor | null = null;
  let probation: PdfDateRangeAnchor | null = null;

  for (const page of parsePdfHtmlPages(xml)) {
    const labels = page.textNodes.filter((node) =>
      compactText(node.text).endsWith("自"),
    );
    for (const label of labels) {
      const anchor = buildDateRangeAnchor(page, label);
      if (!anchor) continue;
      if (compactText(label.text).includes("试用期")) {
        probation ||= anchor;
      } else {
        contract ||= anchor;
      }
    }
  }

  return contract && probation ? { contract, probation } : null;
}

export function parseContractTemplatePositionFieldXml(
  xml: string,
): ContractTemplatePositionField | null {
  for (const page of parsePdfHtmlPages(xml)) {
    const lines = buildPdfHtmlLines(page);
    const fourthArticle = lines.find(
      (line) => line.compact === "第四条" || line.compact.startsWith("第四条"),
    );
    if (!fourthArticle) continue;

    for (const positionLine of lines) {
      if (
        positionLine.top < fourthArticle.top ||
        positionLine.top - fourthArticle.top > 120
      ) {
        continue;
      }

      const text = positionLine.compact;
      const markerIndex = text.indexOf("担任");
      if (markerIndex < 0) continue;

      const startIndex = markerIndex + Array.from("担任").length;
      const endIndex = text.indexOf("岗位", startIndex);
      if (endIndex < startIndex) continue;

      const startBoundary = lineXRangeAtCompactIndex(
        positionLine,
        startIndex,
      );
      const endBoundary = lineXRangeAtCompactIndex(positionLine, endIndex);
      if (!startBoundary || !endBoundary) continue;

      // 空白下划线在 PDF 文字层中可能表现为连续空格，也可能完全不生成文字节点。
      // 取左标记后的最左边界和右标记前的最右边界，可同时兼容两种版式。
      const left = startBoundary.left;
      const right = endBoundary.right;
      const width = right - left;
      if (width < 16) continue;

      return {
        pageIndex: page.pageIndex,
        pageWidth: page.pageWidth,
        pageHeight: page.pageHeight,
        value: {
          top: positionLine.top,
          left,
          width,
          height: positionLine.height,
          fontSize: positionLine.fontSize,
        },
      };
    }
  }

  return null;
}

function buildTextFieldAnchorFromLine(
  line: PdfHtmlLine,
  match: RegExpMatchArray,
): PdfTextFieldAnchor | null {
  const matchStart = match.index ?? 0;
  const matchEnd = matchStart + Array.from(match[0]).length;
  const compactLength = Array.from(line.compact).length;
  if (compactLength < matchEnd) return null;

  const valueLeft = lineXAtCompactIndex(line, matchEnd) + 2;
  const inlineValue = Array.from(line.compact).slice(matchEnd).join("");
  const hasInlineValue = inlineValue.length > 0;
  const fallbackRight = line.pageWidth - Math.max(60, line.pageWidth * 0.08);
  const lineRight = line.left + line.width;
  const valueRight = hasInlineValue
    ? Math.max(lineRight, valueLeft + 12)
    : Math.max(fallbackRight, valueLeft + 48);
  const value: PdfHtmlBox = {
    top: line.top,
    left: valueLeft,
    width: Math.max(valueRight - valueLeft, 1),
    height: line.height,
    fontSize: line.fontSize,
  };

  const cover = hasInlineValue
    ? {
        top: line.top,
        left: valueLeft - 1,
        width: Math.max(lineRight - valueLeft + 2, 1),
        height: line.height,
        fontSize: line.fontSize,
      }
    : undefined;

  return {
    pageIndex: line.pageIndex,
    pageWidth: line.pageWidth,
    pageHeight: line.pageHeight,
    value,
    cover,
    underline: /[_＿\-—]{2,}/.test(inlineValue),
    textColor: line.color,
  };
}

function findTextFieldOnPage(
  page: PdfHtmlPage,
  labelPatterns: RegExp[],
): PdfTextFieldAnchor | null {
  for (const line of buildPdfHtmlLines(page)) {
    for (const pattern of labelPatterns) {
      const match = line.compact.match(pattern);
      if (!match) continue;
      const field = buildTextFieldAnchorFromLine(line, match);
      if (field) return field;
    }
  }

  return null;
}

function pageContainsAssetAgreementTitle(page: PdfHtmlPage): boolean {
  return page.textNodes.some((node) => {
    const text = compactText(node.text);
    return /附件[一1]笔记本电脑协议书/.test(text) || /笔记本电脑协议书/.test(text);
  });
}

function assetAgreementPageIndexes(pages: PdfHtmlPage[]): number[] {
  const indexes = new Set<number>();

  pages.forEach((page) => {
    if (pageContainsAssetAgreementTitle(page)) indexes.add(page.pageIndex);
  });
  pages.forEach((page) => {
    const partyB = findTextFieldOnPage(page, [
      /乙方[（(]员工[）)][：:]?/,
      /乙方[：:]?/,
    ]);
    const idNumber = findTextFieldOnPage(page, [
      /身份证(?:号码|号)[：:]?/,
    ]);
    if (partyB && idNumber) indexes.add(page.pageIndex);
  });
  pages.forEach((page) => indexes.add(page.pageIndex));

  return [...indexes];
}

export function parseAssetAgreementFieldsXml(
  xml: string,
): AssetAgreementTemplateFields | null {
  const pages = parsePdfHtmlPages(xml);
  if (pages.length === 0) return null;

  const employeeNumbers = pages
    .map((page) => findEmployeeNumberFieldOnPage(page, "asset"))
    .filter((anchor): anchor is EmployeeNumberFieldAnchor => Boolean(anchor));

  let partyA: PdfTextFieldAnchor | null = null;
  let partyB: PdfTextFieldAnchor | null = null;
  let idNumber: PdfTextFieldAnchor | null = null;
  const candidatePageIndexes = assetAgreementPageIndexes(pages);

  for (const pageIndex of candidatePageIndexes) {
    const page = pages[pageIndex];
    if (!page) continue;
    partyA ||= findTextFieldOnPage(page, [
      /甲方[（(]单位[）)][：:]?/,
      /甲方[：:]?/,
    ]);
    partyB ||= findTextFieldOnPage(page, [
      /乙方[（(]员工[）)][：:]?/,
      /乙方[：:]?/,
    ]);
    idNumber ||= findTextFieldOnPage(page, [
      /身份证(?:号码|号)[：:]?/,
    ]);
    if (partyA && partyB && idNumber) break;
  }

  if (employeeNumbers.length !== pages.length || !partyA || !partyB || !idNumber) {
    return null;
  }
  return {
    employeeNumbers,
    partyA,
    partyB,
    idNumber,
  };
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
  if (documentType === "asset") return "2025年度公司电脑管理办法";
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

function splitDateParts(value: string): [string, string, string] {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("合同模板日期格式不正确");
  return [match[1], String(Number(match[2])), String(Number(match[3]))];
}

function drawDateParts(
  page: ReturnType<PDFDocument["getPages"]>[number],
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  pageWidth: number,
  pageHeight: number,
  anchor: PdfDatePartsAnchor,
  value: string,
): void {
  const scaleX = page.getWidth() / pageWidth;
  const scaleY = page.getHeight() / pageHeight;
  const values = splitDateParts(value);
  const boxes = [anchor.year, anchor.month, anchor.day];

  boxes.forEach((box, index) => {
    const text = values[index];
    const availableWidth = Math.max(box.width * scaleX - 2, 1);
    let fontSize = Math.min(Math.max(box.fontSize * scaleY, 8), 16);
    while (
      font.widthOfTextAtSize(text, fontSize) > availableWidth &&
      fontSize > 7
    ) {
      fontSize -= 0.5;
    }
    if (font.widthOfTextAtSize(text, fontSize) > availableWidth) {
      throw new Error("合同模板日期空位宽度不足");
    }

    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const drawX = box.left * scaleX + (box.width * scaleX - textWidth) / 2;
    const baselineLift = Math.max(2.75, fontSize * 0.2);
    const drawY =
      page.getHeight() - (box.top + box.fontSize) * scaleY + baselineLift;
    page.drawText(text, {
      x: drawX,
      y: drawY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  });
}

export async function writeContractTemplateDatesToPdfBytes(
  sourceBytes: Uint8Array,
  dates: ContractTemplateDates,
  fields: ContractTemplateDateFields,
): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
  });
  const pages = pdfDocument.getPages();
  const font = await pdfDocument.embedFont(StandardFonts.Helvetica);

  const contractPage = pages[fields.contract.pageIndex];
  if (!contractPage) throw new Error("劳动合同期限所在页面不存在");
  drawDateParts(
    contractPage,
    font,
    fields.contract.pageWidth,
    fields.contract.pageHeight,
    fields.contract.start,
    dates.contractStartDate,
  );
  drawDateParts(
    contractPage,
    font,
    fields.contract.pageWidth,
    fields.contract.pageHeight,
    fields.contract.end,
    dates.contractEndDate,
  );

  if (dates.probationStartDate && dates.probationEndDate) {
    const probationPage = pages[fields.probation.pageIndex];
    if (!probationPage) throw new Error("试用期所在页面不存在");
    drawDateParts(
      probationPage,
      font,
      fields.probation.pageWidth,
      fields.probation.pageHeight,
      fields.probation.start,
      dates.probationStartDate,
    );
    drawDateParts(
      probationPage,
      font,
      fields.probation.pageWidth,
      fields.probation.pageHeight,
      fields.probation.end,
      dates.probationEndDate,
    );
  }

  return pdfDocument.save();
}

function rgbToCssColor(color: PdfRgbColor): string {
  const red = Math.round(color.red * 255);
  const green = Math.round(color.green * 255);
  const blue = Math.round(color.blue * 255);
  return `rgb(${red}, ${green}, ${blue})`;
}

function createTextRaster(
  value: string,
  availableWidth: number,
  preferredFontSize: number,
  color: PdfRgbColor = BLACK,
): {
  bytes: Buffer;
  width: number;
  height: number;
  baselineFromBottom: number;
} {
  const rasterScale = 6;
  const fontFamily =
    '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  const measureCanvas = createCanvas(1, 1);
  const measureContext = measureCanvas.getContext("2d");
  let fontSize = preferredFontSize;
  let metrics: ReturnType<typeof measureContext.measureText> | null = null;

  do {
    measureContext.font = `${fontSize * rasterScale}px ${fontFamily}`;
    metrics = measureContext.measureText(value);
    if (metrics.width / rasterScale <= availableWidth) break;
    fontSize -= 0.5;
  } while (fontSize >= 7);

  if (!metrics || metrics.width / rasterScale > availableWidth || fontSize < 7) {
    throw new Error("自动填充内容过长，无法写入模板");
  }

  const padding = rasterScale * 2;
  const ascent = metrics.actualBoundingBoxAscent || fontSize * rasterScale * 0.85;
  const descent = metrics.actualBoundingBoxDescent || fontSize * rasterScale * 0.15;
  const canvas = createCanvas(
    Math.max(1, Math.ceil(metrics.width + padding * 2)),
    Math.max(1, Math.ceil(ascent + descent + padding * 2)),
  );
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `${fontSize * rasterScale}px ${fontFamily}`;
  context.textBaseline = "alphabetic";
  context.fillStyle = rgbToCssColor(color);
  const baseline = padding + ascent;
  context.fillText(value, padding, baseline);

  return {
    bytes: canvas.toBuffer("image/png"),
    width: canvas.width / rasterScale,
    height: canvas.height / rasterScale,
    baselineFromBottom: (canvas.height - baseline) / rasterScale,
  };
}

function createPositionTextRaster(
  value: string,
  availableWidth: number,
  preferredFontSize: number,
): {
  bytes: Buffer;
  width: number;
  height: number;
  baselineFromBottom: number;
} {
  try {
    return createTextRaster(value, availableWidth, preferredFontSize);
  } catch (error) {
    if (error instanceof Error && error.message.includes("过长")) {
      throw new Error("职位名称过长，无法写入劳动合同第四条");
    }
    throw error;
  }
}

export async function writeContractTemplatePositionToPdfBytes(
  sourceBytes: Uint8Array,
  positionValue: string,
  field: ContractTemplatePositionField,
): Promise<Uint8Array> {
  const position = positionValue.trim();
  if (!position) throw new Error("员工职位不能为空");

  const pdfDocument = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
  });
  const page = pdfDocument.getPages()[field.pageIndex];
  if (!page) throw new Error("劳动合同第四条所在页面不存在");

  const scaleX = page.getWidth() / field.pageWidth;
  const scaleY = page.getHeight() / field.pageHeight;
  const box = field.value;
  const boxX = box.left * scaleX;
  const boxWidth = box.width * scaleX;
  const boxBottom = page.getHeight() - (box.top + box.height) * scaleY;
  const boxHeight = box.height * scaleY;
  const preferredFontSize = Math.min(Math.max(box.fontSize * scaleY, 8), 16);
  const raster = createPositionTextRaster(
    position,
    Math.max(boxWidth - 3, 1),
    preferredFontSize,
  );
  const image = await pdfDocument.embedPng(new Uint8Array(raster.bytes));
  const baseline =
    page.getHeight() - (box.top + box.fontSize) * scaleY + 0.75;
  const imageX = boxX + (boxWidth - raster.width) / 2;
  const imageY = baseline - raster.baselineFromBottom + 1.5;

  page.drawRectangle({
    x: boxX - 2,
    y: boxBottom - 1,
    width: boxWidth + 2.5,
    height: boxHeight + 2,
    color: rgb(1, 1, 1),
  });
  page.drawLine({
    start: { x: boxX, y: baseline - 1.5 },
    end: { x: boxX + boxWidth, y: baseline - 1.5 },
    thickness: 0.6,
    color: rgb(0, 0, 0),
  });
  page.drawImage(image, {
    x: imageX,
    y: imageY,
    width: raster.width,
    height: raster.height,
  });

  return pdfDocument.save();
}

async function drawTextFieldRaster(
  pdfDocument: PDFDocument,
  page: ReturnType<PDFDocument["getPages"]>[number],
  field: PdfTextFieldAnchor,
  value: string,
): Promise<void> {
  const text = value.trim();
  if (!text) return;

  const scaleX = page.getWidth() / field.pageWidth;
  const scaleY = page.getHeight() / field.pageHeight;
  const box = field.value;
  const boxX = box.left * scaleX;
  const boxWidth = box.width * scaleX;
  const boxBottom = page.getHeight() - (box.top + box.height) * scaleY;
  const preferredFontSize = Math.min(Math.max(box.fontSize * scaleY, 8), 16);
  const raster = createTextRaster(
    text,
    Math.max(boxWidth - 4, 1),
    preferredFontSize,
    field.textColor || BLACK,
  );
  const image = await pdfDocument.embedPng(new Uint8Array(raster.bytes));

  if (field.cover) {
    page.drawRectangle({
      x: field.cover.left * scaleX - 1,
      y:
        page.getHeight() -
        (field.cover.top + field.cover.height) * scaleY -
        1,
      width: field.cover.width * scaleX + 3,
      height: field.cover.height * scaleY + 2,
      color: rgb(1, 1, 1),
    });
  }

  const baseline = page.getHeight() - (box.top + box.fontSize) * scaleY + 0.75;
  if (field.underline) {
    page.drawLine({
      start: { x: boxX, y: baseline - 1.5 },
      end: { x: boxX + boxWidth, y: baseline - 1.5 },
      thickness: 0.6,
      color: rgb(0, 0, 0),
    });
  }

  page.drawImage(image, {
    x: boxX + 1.5,
    y: Math.max(boxBottom, baseline - raster.baselineFromBottom + 1.5),
    width: raster.width,
    height: raster.height,
  });
}

export async function writeAssetAgreementFieldsToPdfBytes(
  sourceBytes: Uint8Array,
  data: Required<EmployeeAssetAgreementTemplateData>,
  fields: AssetAgreementTemplateFields,
): Promise<Uint8Array> {
  const pdfDocument = await PDFDocument.load(sourceBytes, {
    ignoreEncryption: true,
  });
  const pages = pdfDocument.getPages();
  const targets: Array<[PdfTextFieldAnchor, string, string]> = [
    [fields.partyA, data.companyName, "甲方单位"],
    [fields.partyB, data.employeeName, "乙方员工"],
    [fields.idNumber, data.idNumber, "身份证号码"],
  ];

  for (const [field, value, label] of targets) {
    const page = pages[field.pageIndex];
    if (!page) throw new Error(`${label}所在页面不存在`);
    if (page.getRotation().angle % 360 !== 0) {
      throw new Error(`${label}所在页面存在旋转，无法准确写入`);
    }
    await drawTextFieldRaster(pdfDocument, page, field, value);
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

export async function writeEmployeeContractDataToOnboardingTemplate(
  pdfPath: string,
  employeeNo: string,
  data: EmployeeContractTemplateData,
): Promise<Uint8Array> {
  const numberedPdf = await writeEmployeeNumberToOnboardingTemplate(
    pdfPath,
    employeeNo,
    "contract",
  );
  const layout = await extractEmployeeNumberLayout(pdfPath);
  const dateFields = parseContractTemplateDateFieldsXml(layout.xml);
  if (!dateFields) {
    throw new ContractTemplateDateFieldNotFoundError();
  }
  const positionField = parseContractTemplatePositionFieldXml(layout.xml);
  if (!positionField) {
    throw new ContractTemplatePositionFieldNotFoundError();
  }
  const datedPdf = await writeContractTemplateDatesToPdfBytes(
    numberedPdf,
    data,
    dateFields,
  );
  return writeContractTemplatePositionToPdfBytes(
    datedPdf,
    data.position,
    positionField,
  );
}

export async function writeEmployeeContractPositionToOnboardingTemplate(
  pdfPath: string,
  employeeNo: string,
  position: string,
): Promise<Uint8Array> {
  const numberedPdf = await writeEmployeeNumberToOnboardingTemplate(
    pdfPath,
    employeeNo,
    "contract",
  );
  const layout = await extractEmployeeNumberLayout(pdfPath);
  const positionField = parseContractTemplatePositionFieldXml(layout.xml);
  if (!positionField) {
    throw new ContractTemplatePositionFieldNotFoundError();
  }
  return writeContractTemplatePositionToPdfBytes(
    numberedPdf,
    position,
    positionField,
  );
}

export async function writeEmployeeAssetAgreementToOnboardingTemplate(
  pdfPath: string,
  employeeNo: string,
  data: EmployeeAssetAgreementTemplateData,
): Promise<Uint8Array> {
  const sourceBytes = fs.readFileSync(pdfPath);
  const layout = await extractEmployeeNumberLayout(pdfPath);
  const fields = parseAssetAgreementFieldsXml(layout.xml);
  if (!fields) {
    throw new AssetAgreementFieldNotFoundError();
  }

  const employeeName = data.employeeName.trim();
  const idNumber = data.idNumber.trim();
  if (!employeeName || !idNumber) {
    throw new Error("员工姓名和身份证号码不能为空");
  }

  const numberedPdf = await writeEmployeeNumberToPdfBytes(
    sourceBytes,
    employeeNo,
    fields.employeeNumbers,
  );
  return writeAssetAgreementFieldsToPdfBytes(
    numberedPdf,
    {
      companyName:
        data.companyName?.trim() || DEFAULT_ASSET_AGREEMENT_COMPANY_NAME,
      employeeName,
      idNumber,
    },
    fields,
  );
}
