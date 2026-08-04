import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";
import type { PaddleOcrLine } from "./ocrDaemon.js";

const execFileAsync = promisify(execFile);

const PDF_POINTS_PER_INCH = 72;
const EMPLOYEE_DOCUMENT_TITLE_REGION_RATIO = 0.55;
const EMPLOYEE_DOCUMENT_FOCUSED_HEADING_LEFT_RATIO = 0.12;
const EMPLOYEE_DOCUMENT_FOCUSED_HEADING_TOP_RATIO = 0.07;
const EMPLOYEE_DOCUMENT_FOCUSED_HEADING_WIDTH_RATIO = 0.76;
const EMPLOYEE_DOCUMENT_FOCUSED_HEADING_HEIGHT_RATIO = 0.25;
const EMPLOYEE_DOCUMENT_FOCUSED_HEADING_TARGET_WIDTH_RATIO = 1.52;
const EMPLOYEE_DOCUMENT_FOCUSED_HEADING_MAX_WIDTH = 3800;
// 为裁剪边缘保留少量像素，再由图像处理步骤精确裁到旧逻辑的高度，
// 避免渲染器在裁剪边界处的抗锯齿影响送入识别引擎的最后一行像素。
const EMPLOYEE_DOCUMENT_TITLE_RENDER_GUARD_PIXELS = 2;

export function isEmployeeDocumentOcrInfrastructureError(
  error: unknown,
): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "OCR_INFRASTRUCTURE_ERROR",
  );
}

function rethrowOcrInfrastructureError(error: unknown): void {
  if (isEmployeeDocumentOcrInfrastructureError(error)) throw error;
}

export interface EmployeeDocumentTitleRegionRenderGeometry {
  fullWidth: number;
  fullHeight: number;
  titleHeight: number;
  renderHeight: number;
}

export interface EmployeeDocumentFocusedHeadingGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  targetWidth: number;
}

export function calculateEmployeeDocumentFocusedHeadingGeometry(
  fullWidth: number,
  fullHeight: number,
  availableWidth = fullWidth,
  availableHeight = fullHeight,
): EmployeeDocumentFocusedHeadingGeometry {
  if (
    !Number.isFinite(fullWidth) ||
    fullWidth <= 0 ||
    !Number.isFinite(fullHeight) ||
    fullHeight <= 0 ||
    !Number.isFinite(availableWidth) ||
    availableWidth <= 0 ||
    !Number.isFinite(availableHeight) ||
    availableHeight <= 0
  ) {
    throw new Error("档案标题聚焦区域尺寸无效");
  }

  const left = Math.min(
    availableWidth - 1,
    Math.max(
      0,
      Math.floor(fullWidth * EMPLOYEE_DOCUMENT_FOCUSED_HEADING_LEFT_RATIO),
    ),
  );
  const top = Math.min(
    availableHeight - 1,
    Math.max(
      0,
      Math.floor(fullHeight * EMPLOYEE_DOCUMENT_FOCUSED_HEADING_TOP_RATIO),
    ),
  );
  const width = Math.max(
    1,
    Math.min(
      availableWidth - left,
      Math.floor(fullWidth * EMPLOYEE_DOCUMENT_FOCUSED_HEADING_WIDTH_RATIO),
    ),
  );
  const height = Math.max(
    1,
    Math.min(
      availableHeight - top,
      Math.floor(fullHeight * EMPLOYEE_DOCUMENT_FOCUSED_HEADING_HEIGHT_RATIO),
    ),
  );

  return {
    left,
    top,
    width,
    height,
    targetWidth: Math.min(
      EMPLOYEE_DOCUMENT_FOCUSED_HEADING_MAX_WIDTH,
      Math.max(
        width,
        Math.floor(
          fullWidth * EMPLOYEE_DOCUMENT_FOCUSED_HEADING_TARGET_WIDTH_RATIO,
        ),
      ),
    ),
  };
}

export function calculateEmployeeDocumentTitleRegionRenderGeometry(
  pageWidthPoints: number,
  pageHeightPoints: number,
  pageRotation: number,
  dpi: number,
): EmployeeDocumentTitleRegionRenderGeometry {
  if (
    !Number.isFinite(pageWidthPoints) ||
    pageWidthPoints <= 0 ||
    !Number.isFinite(pageHeightPoints) ||
    pageHeightPoints <= 0 ||
    !Number.isFinite(dpi) ||
    dpi <= 0
  ) {
    throw new Error("PDF 页面尺寸或渲染分辨率无效");
  }

  const normalizedRotation = ((pageRotation % 360) + 360) % 360;
  const swapsDimensions =
    normalizedRotation === 90 || normalizedRotation === 270;
  const renderedWidthPoints = swapsDimensions
    ? pageHeightPoints
    : pageWidthPoints;
  const renderedHeightPoints = swapsDimensions
    ? pageWidthPoints
    : pageHeightPoints;
  const fullWidth = Math.max(
    1,
    Math.ceil((renderedWidthPoints * dpi) / PDF_POINTS_PER_INCH),
  );
  const fullHeight = Math.max(
    1,
    Math.ceil((renderedHeightPoints * dpi) / PDF_POINTS_PER_INCH),
  );
  const titleHeight = Math.max(
    1,
    Math.floor(fullHeight * EMPLOYEE_DOCUMENT_TITLE_REGION_RATIO),
  );

  return {
    fullWidth,
    fullHeight,
    titleHeight,
    renderHeight: Math.min(
      fullHeight,
      titleHeight + EMPLOYEE_DOCUMENT_TITLE_RENDER_GUARD_PIXELS,
    ),
  };
}

export async function resolveEmployeeDocumentTitleRegionRenderGeometry(
  pdfPath: string,
  pageNumber: number,
  dpi: number,
): Promise<EmployeeDocumentTitleRegionRenderGeometry> {
  const result = (await execFileAsync(
    "pdfinfo",
    ["-f", String(pageNumber), "-l", String(pageNumber), pdfPath],
    { timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
  )) as { stdout: string };
  const escapedPageNumber = String(pageNumber).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const sizeMatch =
    result.stdout.match(
      new RegExp(
        `Page\\s+${escapedPageNumber}\\s+size:\\s*([0-9.]+)\\s+x\\s+([0-9.]+)\\s+pts`,
        "i",
      ),
    ) || result.stdout.match(/Page size:\s*([0-9.]+)\s+x\s+([0-9.]+)\s+pts/i);
  if (!sizeMatch) throw new Error("无法读取 PDF 页面尺寸");

  const rotationMatch =
    result.stdout.match(
      new RegExp(`Page\\s+${escapedPageNumber}\\s+rot:\\s*(-?[0-9]+)`, "i"),
    ) || result.stdout.match(/Page rot:\s*(-?[0-9]+)/i);

  return calculateEmployeeDocumentTitleRegionRenderGeometry(
    Number(sizeMatch[1]),
    Number(sizeMatch[2]),
    Number(rotationMatch?.[1] || 0),
    dpi,
  );
}

export const EMPLOYEE_DOCUMENT_TYPE_LABELS = {
  invitation: "入职邀请函",
  application: "新员工入职申请表",
  contract: "劳动合同书",
  nda: "保密协议",
  declaration: "个人声明",
  asset_handover: "2025年度公司电脑管理办法",
  id_card: "身份证复印件",
  health_report: "入职体检报告",
  diploma: "学历证书复印件",
  bank_card: "工资卡复印件（中国工商银行）",
  other: "其他",
} as const;

export type EmployeeDocumentType = keyof typeof EMPLOYEE_DOCUMENT_TYPE_LABELS;
export type EmployeeDocumentClassificationSource =
  | "filename"
  | "text"
  | "image";
export type EmployeeDocumentClassificationUncertaintyReason =
  | "no_match"
  | "ambiguous";

export interface EmployeeDocumentClassification {
  status: "success" | "uncertain";
  documentType: EmployeeDocumentType | null;
  label: string | null;
  source: EmployeeDocumentClassificationSource | null;
  message: string;
  uncertaintyReason?: EmployeeDocumentClassificationUncertaintyReason;
  candidateTypes?: EmployeeDocumentType[];
  pageStartEvidence?: "heading" | "composite";
  headingIndex?: number;
}

export interface EmployeeDocumentPageBoundary {
  kind: "document" | "unsupported" | "uncertain" | "none";
  documentType: EmployeeDocumentType | null;
  label: string | null;
  source: "text" | "image" | null;
  candidateTypes?: EmployeeDocumentType[];
  unsupportedEvidence?: "explicit" | "generic";
  pageStartEvidence?: "heading" | "composite";
  headingIndex?: number;
}

export interface EmployeeDocumentPageBoundaryDetectionOptions {
  onPageRecognized?: (recognizedTextCandidates: string[]) => void;
}

interface ClassificationRule {
  type: EmployeeDocumentType;
  filenamePatterns: RegExp[];
  pageStartPatterns: RegExp[];
  contentPatterns: Array<{ pattern: RegExp; score: number }>;
}

interface ScoredRule {
  type: EmployeeDocumentType;
  filenameScore: number;
  contentScore: number;
  totalScore: number;
}

interface PositionedEmployeeDocumentOcrLine {
  text: string;
  left: number;
  right: number;
  top: number;
  centerY: number;
  height: number;
}

interface EmployeeDocumentImageRecognition {
  textCandidates: string[];
  lines: PaddleOcrLine[];
}

export type EmployeeDocumentImageRotation = 90 | 180 | 270;

const EMPLOYEE_DOCUMENT_ROTATION_COMPOSITE_TYPES =
  new Set<EmployeeDocumentType>(["diploma", "id_card", "bank_card"]);

function getEmployeeDocumentOcrLineGeometry(line: PaddleOcrLine): {
  width: number;
  height: number;
  weight: number;
} | null {
  const text = String(line.text || "").trim();
  const points = Array.isArray(line.box)
    ? line.box.filter(
        (point) =>
          Array.isArray(point) &&
          Number.isFinite(point[0]) &&
          Number.isFinite(point[1]),
      )
    : [];
  if (!text || Number(line.confidence) < 0.6 || points.length < 2) return null;

  const xValues = points.map((point) => Number(point[0]));
  const yValues = points.map((point) => Number(point[1]));
  const width = Math.max(...xValues) - Math.min(...xValues);
  const height = Math.max(...yValues) - Math.min(...yValues);
  if (width <= 0 || height <= 0) return null;

  return {
    width,
    height,
    weight: Math.max(1, Array.from(text).length),
  };
}

export function isEmployeeDocumentOcrMostlyVertical(
  lines: PaddleOcrLine[],
): boolean {
  let verticalWeight = 0;
  let horizontalWeight = 0;
  let validLineCount = 0;

  for (const line of lines) {
    const geometry = getEmployeeDocumentOcrLineGeometry(line);
    if (!geometry) continue;
    validLineCount += 1;
    if (geometry.height >= geometry.width * 1.35) {
      verticalWeight += geometry.weight;
    } else if (geometry.width >= geometry.height * 1.35) {
      horizontalWeight += geometry.weight;
    }
  }

  return (
    validLineCount >= 4 &&
    verticalWeight >= 20 &&
    verticalWeight >= horizontalWeight * 1.5
  );
}

export function resolveEmployeeDocumentRotationReviewAngles(
  lineGroups: PaddleOcrLine[][],
): EmployeeDocumentImageRotation[] {
  if (lineGroups.some((lines) => isEmployeeDocumentOcrMostlyVertical(lines))) {
    return [90, 270];
  }
  return [];
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    type: "invitation",
    filenamePatterns: [/入职邀请函|邀请函/],
    pageStartPatterns: [/^入职邀请函$/],
    contentPatterns: [
      { pattern: /入职邀请函/, score: 60 },
      { pattern: /年保障薪酬/, score: 12 },
      { pattern: /月保障薪酬|月度税前工资/, score: 12 },
      { pattern: /原则每月发放/, score: 8 },
    ],
  },
  {
    type: "application",
    filenamePatterns: [/新员工入职申请表|入职申请表|员工入职申请/],
    pageStartPatterns: [/^(?:新员工)?入职申请表$/],
    contentPatterns: [
      { pattern: /新员工入职申请表|入职申请表/, score: 60 },
      { pattern: /入职部门|拟入职部门/, score: 8 },
      { pattern: /紧急联系人/, score: 8 },
      { pattern: /个人基本信息/, score: 8 },
    ],
  },
  {
    type: "contract",
    filenamePatterns: [/劳动合同书|劳动合同/],
    pageStartPatterns: [/^(?:中华人民共和国)?劳动合同书?$/],
    contentPatterns: [
      { pattern: /劳动合同书|劳动合同/, score: 60 },
      { pattern: /合同期限/, score: 8 },
      { pattern: /甲方.{0,30}乙方|乙方.{0,30}甲方/, score: 8 },
      { pattern: /劳动合同法/, score: 8 },
    ],
  },
  {
    type: "nda",
    filenamePatterns: [/保密协议|保密及竞业|竞业限制协议/],
    pageStartPatterns: [
      /^(?:员工)?保密协议$/,
      /^保密及竞业(?:限制)?协议$/,
      /^竞业限制协议$/,
    ],
    contentPatterns: [
      { pattern: /保密协议|保密及竞业|竞业限制协议/, score: 60 },
      { pattern: /保密义务/, score: 10 },
      { pattern: /商业秘密/, score: 10 },
      { pattern: /竞业限制/, score: 10 },
    ],
  },
  {
    type: "declaration",
    filenamePatterns: [/个人声明|员工声明书|个人承诺书/],
    pageStartPatterns: [
      /^(?:员工)?个人(?:声明|申明)$/,
      /^员工声明书$/,
      /^个人承诺书$/,
    ],
    contentPatterns: [
      { pattern: /个人声明|个人申明|员工声明书|个人承诺书/, score: 60 },
      { pattern: /本人(?:郑重|谨此)?声明|本人承诺/, score: 18 },
      { pattern: /特此声明/, score: 12 },
      { pattern: /声明人|姓名/, score: 10 },
      {
        pattern: /个人资料(?:信息)?(?:真实|属实|真实有效)|公司规章制度/,
        score: 10,
      },
    ],
  },
  {
    type: "asset_handover",
    filenamePatterns: [
      /2025年度公司电脑管理办法|公司电脑管理办法|电脑管理办法|固定资产交接单/,
    ],
    pageStartPatterns: [
      /^2025年度公司电脑管理办法$/,
      /^公司电脑管理办法$/,
      /^固定资产交接单$/,
      /^笔记本电脑协议书$/,
      /^笔记本电脑交接单$/,
      /^笔记本电脑验收单$/,
    ],
    contentPatterns: [
      {
        pattern: /2025年度公司电脑管理办法|公司电脑管理办法|固定资产交接单/,
        score: 60,
      },
      { pattern: /电脑领用|办公电脑/, score: 12 },
      { pattern: /设备编号|资产编号/, score: 10 },
    ],
  },
  {
    type: "id_card",
    filenamePatterns: [/身份证复印件|身份证/],
    pageStartPatterns: [/^中华人民共和国居民身份证$/],
    contentPatterns: [
      { pattern: /中华人民共和国居民身份证/, score: 60 },
      { pattern: /公民身份号码/, score: 30 },
      { pattern: /签发机关/, score: 8 },
    ],
  },
  {
    type: "health_report",
    filenamePatterns: [/入职体检报告|健康体检报告|健康检查报告|体检报告/],
    pageStartPatterns: [/^(?:入职|健康)?体检报告$/, /^健康检查报告$/],
    contentPatterns: [
      { pattern: /入职体检报告|健康体检报告|健康检查报告|体检报告/, score: 60 },
      { pattern: /体检结论|检查结论/, score: 12 },
      { pattern: /主检医师/, score: 10 },
    ],
  },
  {
    type: "diploma",
    filenamePatterns: [/学历证书|毕业证书|毕业证|学位证书|学位证/],
    pageStartPatterns: [/^毕业证书$/, /^学位证书$/, /^普通高等学校毕业证书$/],
    contentPatterns: [
      { pattern: /学历证书|毕业证书|学位证书/, score: 60 },
      { pattern: /普通高等学校/, score: 18 },
      { pattern: /授予.{0,12}学位/, score: 18 },
      { pattern: /修完.{0,20}课程.{0,12}毕业/, score: 18 },
    ],
  },
  {
    type: "bank_card",
    filenamePatterns: [/工资卡|银行卡|工商银行|工行/],
    pageStartPatterns: [/^中国工商银行(?:股份有限公司)?$|^ICBC$/i],
    contentPatterns: [
      {
        pattern: /中国工商银行|中[国回]工商银行|中国工商|ICBC/i,
        score: 18,
      },
      {
        pattern:
          /借记卡|储蓄卡|持卡人(?:签名|签字)(?:处)?|authorizedsignature|本卡不得.{0,16}(?:出租|出借|转借|转让)|如拾获本卡|month.?[yn]ear|val(?:id|ed)(?:thru)?|银联|unionpay/i,
        score: 18,
      },
      { pattern: /卡号/, score: 8 },
    ],
  },
];

function toHalfWidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, " ");
}

function normalizeFilename(value: string): string {
  return toHalfWidth(value)
    .replace(/\.pdf$/i, "")
    .replace(/[\s._\-—（）()【】[\]]+/g, "")
    .toLowerCase();
}

function normalizeContent(value: string): string {
  return toHalfWidth(value).replace(/\s+/g, "").toLowerCase();
}

function isBankTransactionDocumentContent(normalizedContent: string): boolean {
  return /电子银行回单|银行回单|电子回单|账户交易流水|交易流水|银行流水|交易明细|对账单|银联交易凭证|商户编号|借方发生额|贷方发生额/.test(
    normalizedContent,
  );
}

export function buildEmployeeDocumentOcrLayoutText(
  lines: PaddleOcrLine[],
): string {
  const positionedLines: PositionedEmployeeDocumentOcrLine[] = lines.flatMap(
    (line) => {
      const text = String(line.text || "").trim();
      const points = Array.isArray(line.box)
        ? line.box.filter(
            (point) =>
              Array.isArray(point) &&
              Number.isFinite(point[0]) &&
              Number.isFinite(point[1]),
          )
        : [];
      if (!text || Number(line.confidence) < 0.35 || points.length === 0) {
        return [];
      }

      const xValues = points.map((point) => Number(point[0]));
      const yValues = points.map((point) => Number(point[1]));
      const left = Math.min(...xValues);
      const right = Math.max(...xValues);
      const top = Math.min(...yValues);
      const bottom = Math.max(...yValues);
      const height = Math.max(1, bottom - top);
      return [
        {
          text,
          left,
          right,
          top,
          centerY: (top + bottom) / 2,
          height,
        },
      ];
    },
  );

  const rows: Array<{
    items: PositionedEmployeeDocumentOcrLine[];
    centerY: number;
    averageHeight: number;
  }> = [];
  for (const line of positionedLines.sort(
    (left, right) => left.centerY - right.centerY || left.left - right.left,
  )) {
    const row = rows
      .map((candidate) => ({
        candidate,
        distance: Math.abs(candidate.centerY - line.centerY),
        tolerance: Math.max(candidate.averageHeight, line.height) * 0.55,
      }))
      .filter((candidate) => candidate.distance <= candidate.tolerance)
      .sort((left, right) => left.distance - right.distance)[0]?.candidate;

    if (!row) {
      rows.push({
        items: [line],
        centerY: line.centerY,
        averageHeight: line.height,
      });
      continue;
    }

    row.items.push(line);
    row.centerY =
      row.items.reduce((sum, item) => sum + item.centerY, 0) / row.items.length;
    row.averageHeight =
      row.items.reduce((sum, item) => sum + item.height, 0) / row.items.length;
  }

  return rows
    .sort((left, right) => left.centerY - right.centerY)
    .flatMap((row) => {
      const segments: PositionedEmployeeDocumentOcrLine[][] = [];
      for (const item of row.items.sort(
        (left, right) => left.left - right.left || left.top - right.top,
      )) {
        const currentSegment = segments.at(-1);
        const previousItem = currentSegment?.at(-1);
        const maximumJoinGap = previousItem
          ? Math.max(previousItem.height, item.height) * 1.5
          : 0;
        if (
          !currentSegment ||
          !previousItem ||
          item.left - previousItem.right > maximumJoinGap
        ) {
          segments.push([item]);
        } else {
          currentSegment.push(item);
        }
      }
      return segments.map((segment) =>
        segment.map((item) => item.text).join(" "),
      );
    })
    .join("\n");
}

function hasReadablePageText(value: string): boolean {
  const meaningfulLines = toHalfWidth(value)
    .split(/\r?\n/)
    .map((line) =>
      normalizeContent(line)
        .replace(/poweredbytechnology\.?/gi, "")
        .replace(/striveforsurvivalbyquality\.?/gi, "")
        .replace(/以科技为动力/g, "")
        .replace(/以质量求生存/g, "")
        .replace(/^(?:第)?\d+页(?:共\d+页)?$/, "")
        .replace(/^\d+\/\d+$/, ""),
    )
    .filter((line) => (line.match(/[\u3400-\u9fff]/g) || []).length >= 4);
  const chineseCharacterCount = meaningfulLines.reduce(
    (count, line) => count + (line.match(/[\u3400-\u9fff]/g) || []).length,
    0,
  );
  return meaningfulLines.length >= 2 && chineseCharacterCount >= 30;
}

export function hasReliableEmployeeDocumentTitleRecognition(
  recognizedTextCandidates: string[],
  lines: PaddleOcrLine[],
): boolean {
  if (isEmployeeDocumentOcrMostlyVertical(lines)) return false;
  const meaningfulLines = lines.filter(
    (line) => String(line.text || "").trim() && Number(line.confidence) >= 0.35,
  );
  if (meaningfulLines.length < 8) return false;
  const averageConfidence =
    meaningfulLines.reduce(
      (sum, line) => sum + Number(line.confidence || 0),
      0,
    ) / meaningfulLines.length;
  return (
    averageConfidence >= 0.88 &&
    recognizedTextCandidates.some(hasReadablePageText)
  );
}

export function resolveEmployeeDocumentPageNoBoundary(
  extractedText: string,
  recognizedTexts: string[],
): EmployeeDocumentPageBoundary {
  if (recognizedTexts.some(hasReadablePageText)) {
    return {
      kind: "none",
      documentType: null,
      label: null,
      source: "image",
    };
  }
  if (hasReadablePageText(extractedText)) {
    return {
      kind: "none",
      documentType: null,
      label: null,
      source: "text",
    };
  }
  return {
    kind: "uncertain",
    documentType: null,
    label: "本页文字识别结果不足，无法确认是上一份材料的续页还是新材料",
    source: null,
    candidateTypes: [],
  };
}

function normalizePageHeadingLines(value: string): string[] {
  return toHalfWidth(value)
    .split(/\r?\n/)
    .map((line) => normalizeContent(line).replace(/[：:，,。；;（）()]/g, ""))
    .filter(Boolean)
    .slice(0, 16);
}

function buildPageHeadingCandidates(
  headingLines: string[],
): Array<{ text: string; lineIndex: number }> {
  const candidates: Array<{ text: string; lineIndex: number }> = [];
  for (let lineIndex = 0; lineIndex < headingLines.length; lineIndex += 1) {
    let combined = "";
    for (
      let offset = 0;
      offset <= 2 && lineIndex + offset < headingLines.length;
      offset += 1
    ) {
      combined += headingLines[lineIndex + offset];
      if (combined.length <= 40) {
        candidates.push({ text: combined, lineIndex });
      }
    }
  }
  return candidates;
}

function findPageHeadingIndex(
  rule: ClassificationRule,
  headingLines: string[],
): number | null {
  const match = buildPageHeadingCandidates(headingLines).find((candidate) =>
    rule.pageStartPatterns.some((pattern) => pattern.test(candidate.text)),
  );
  return match?.lineIndex ?? null;
}

function matchesEmployeeDocumentCompositePageStart(
  type: EmployeeDocumentType,
  normalizedContent: string,
): boolean {
  if (type === "invitation") {
    return (
      /年保障薪酬/.test(normalizedContent) &&
      /月保障薪酬|月度税前工资/.test(normalizedContent)
    );
  }
  if (type === "application") {
    return (
      /紧急联系人/.test(normalizedContent) &&
      /个人基本信息/.test(normalizedContent) &&
      /入职部门|拟入职部门/.test(normalizedContent)
    );
  }
  if (type === "contract") {
    const hasContractOpening =
      /合同期限/.test(normalizedContent) ||
      (/签订日期/.test(normalizedContent) &&
        /本合同所列条款/.test(normalizedContent));
    return (
      hasContractOpening &&
      /甲方/.test(normalizedContent) &&
      /乙方/.test(normalizedContent) &&
      /劳动合同法|劳动关系/.test(normalizedContent)
    );
  }
  if (type === "nda") {
    const looksLikeContractContinuation =
      /本合同|劳动合同/.test(normalizedContent) &&
      /第.{0,4}条|合同约定|继续履行/.test(normalizedContent);
    if (looksLikeContractContinuation) return false;

    const hasConfidentialityCore =
      /保密内容/.test(normalizedContent) &&
      /商业秘密|保密事项|保密义务/.test(normalizedContent);
    const hasConfidentialityScope = /保密范围/.test(normalizedContent);
    const hasAgreementParties =
      /甲方/.test(normalizedContent) &&
      /乙方/.test(normalizedContent) &&
      /(?:达成|签订|订立).{0,8}协议/.test(normalizedContent);
    return (
      hasConfidentialityCore && (hasConfidentialityScope || hasAgreementParties)
    );
  }
  if (type === "declaration") {
    const hasDeclarationLead = /本人(?:郑重|谨此)?声明|本人承诺/.test(
      normalizedContent,
    );
    const hasDeclarationClose = /特此声明/.test(normalizedContent);
    const hasSigner = /声明人|姓名/.test(normalizedContent);
    const hasDeclarationDetails =
      /个人资料(?:信息)?(?:真实|属实|真实有效)|公司规章制度/.test(
        normalizedContent,
      );
    return (
      hasSigner &&
      hasDeclarationClose &&
      (hasDeclarationLead || hasDeclarationDetails)
    );
  }
  if (type === "asset_handover") {
    return (
      /电脑领用|办公电脑|笔记本电脑/.test(normalizedContent) &&
      /设备编号|资产编号|管理办法/.test(normalizedContent)
    );
  }
  if (type === "id_card") {
    const hasCompleteIdentityCardTitle =
      /居民身份证/.test(normalizedContent) &&
      /公民身份号码|签发机关/.test(normalizedContent);
    const hasIdentityCardFrontFields =
      /姓名/.test(normalizedContent) &&
      /公民身份号码.{0,8}\d{17}[\dx]/.test(normalizedContent);
    return hasCompleteIdentityCardTitle || hasIdentityCardFrontFields;
  }
  if (type === "bank_card") {
    if (isBankTransactionDocumentContent(normalizedContent)) return false;

    const hasBankBrand = /中国工商银行|中[国回]工商银行|中国工商|icbc/.test(
      normalizedContent,
    );
    const hasPhysicalCardEvidence =
      /借记卡|储蓄卡|持卡人(?:签名|签字)(?:处)?|authorizedsignature|本卡不得.{0,16}(?:出租|出借|转借|转让)|如拾获本卡|month.?[yn]ear|val(?:id|ed)(?:thru)?/.test(
        normalizedContent,
      );
    return hasBankBrand && hasPhysicalCardEvidence;
  }
  if (type === "diploma") {
    return (
      /普通高等学校/.test(normalizedContent) &&
      /证书编号|准予毕业|学历证书查询网址|修完.{0,30}课程/.test(
        normalizedContent,
      )
    );
  }
  if (type === "health_report") {
    return (
      /体检结论|检查结论/.test(normalizedContent) &&
      /主检医师|体检机构|检查项目/.test(normalizedContent)
    );
  }
  return false;
}

function isContractAttachmentDeclarationReference(
  normalizedContent: string,
): boolean {
  const hasAttachmentReference =
    /附件[一二三四五六七八九十百0-9]+[:：]?个人(?:声明|申明)/.test(
      normalizedContent,
    );
  if (!hasAttachmentReference) return false;

  const hasContractNumber = /合同编号/.test(normalizedContent);
  const hasContractStructure =
    /第[一二三四五六七八九十百0-9]{1,8}条/.test(normalizedContent) ||
    /本合同一式(?:两|二|[0-9]+)份/.test(normalizedContent) ||
    (/甲方/.test(normalizedContent) &&
      /乙方/.test(normalizedContent) &&
      /签字|签署|盖章/.test(normalizedContent));
  const hasRealDeclarationBody =
    matchesEmployeeDocumentCompositePageStart(
      "declaration",
      normalizedContent,
    );

  return hasContractNumber && hasContractStructure && !hasRealDeclarationBody;
}

function uncertainClassification(
  uncertaintyReason: EmployeeDocumentClassificationUncertaintyReason = "no_match",
  candidateTypes: EmployeeDocumentType[] = [],
): EmployeeDocumentClassification {
  const candidateLabels = candidateTypes.map(
    (type) => EMPLOYEE_DOCUMENT_TYPE_LABELS[type],
  );
  return {
    status: "uncertain",
    documentType: null,
    label: null,
    source: null,
    message:
      uncertaintyReason === "ambiguous" && candidateLabels.length > 0
        ? `同时匹配${candidateLabels.join("、")}，为避免错误归档，请拆分文件或使用对应文档行手动上传`
        : "无法确定文件类型，请使用对应文档行的上传入口手动归档",
    uncertaintyReason,
    candidateTypes,
  };
}

export function classifyEmployeeDocumentText(
  originalFileName: string,
  firstPageText = "",
): EmployeeDocumentClassification {
  const pageStartClassification = classifyEmployeeDocumentPageStartText(
    originalFileName,
    firstPageText,
  );
  if (
    pageStartClassification.status === "success" ||
    pageStartClassification.uncertaintyReason === "ambiguous"
  ) {
    return pageStartClassification;
  }

  const normalizedFilename = normalizeFilename(originalFileName);
  const normalizedContent = normalizeContent(firstPageText);

  const scoredRules: ScoredRule[] = CLASSIFICATION_RULES.map((rule) => {
    const isExcludedBankCard =
      rule.type === "bank_card" &&
      isBankTransactionDocumentContent(normalizedContent);
    const filenameScore =
      rule.filenamePatterns.some((pattern) =>
        pattern.test(normalizedFilename),
      ) && !isExcludedBankCard
        ? 40
        : 0;
    const contentScore = isExcludedBankCard
      ? 0
      : rule.contentPatterns.reduce(
          (score, item) =>
            score + (item.pattern.test(normalizedContent) ? item.score : 0),
          0,
        );
    return {
      type: rule.type,
      filenameScore,
      contentScore,
      totalScore: filenameScore + contentScore,
    };
  }).sort((left, right) => right.totalScore - left.totalScore);

  const best = scoredRules[0];
  const second = scoredRules[1];
  if (!best || best.totalScore === 0) return uncertainClassification();

  const hasUniqueFilenameMatch =
    best.filenameScore > 0 &&
    scoredRules.filter((item) => item.filenameScore > 0).length === 1;
  const hasStrongContentMatch = best.contentScore >= 30;
  const hasClearLead = best.totalScore - (second?.totalScore ?? 0) >= 10;

  if (
    (!hasUniqueFilenameMatch && !hasStrongContentMatch) ||
    (!hasClearLead && !hasUniqueFilenameMatch)
  ) {
    return uncertainClassification(
      !hasClearLead && hasStrongContentMatch ? "ambiguous" : "no_match",
      !hasClearLead && hasStrongContentMatch
        ? scoredRules
            .filter(
              (item) =>
                best.totalScore - item.totalScore < 10 && item.totalScore > 0,
            )
            .map((item) => item.type)
        : [],
    );
  }

  const source: EmployeeDocumentClassificationSource =
    best.contentScore >= 60 || best.filenameScore === 0 ? "text" : "filename";
  const label = EMPLOYEE_DOCUMENT_TYPE_LABELS[best.type];
  return {
    status: "success",
    documentType: best.type,
    label,
    source,
    message: `已识别为${label}`,
  };
}

export function classifyEmployeeDocumentPageStartText(
  _originalFileName: string,
  pageText: string,
): EmployeeDocumentClassification {
  const normalizedContent = normalizeContent(pageText);
  const headingLines = normalizePageHeadingLines(pageText);

  const scoredRules = CLASSIFICATION_RULES.map((rule) => {
    const isExcludedBankCard =
      rule.type === "bank_card" &&
      isBankTransactionDocumentContent(normalizedContent);
    const isContractAttachmentReference =
      rule.type === "declaration" &&
      isContractAttachmentDeclarationReference(normalizedContent);
    const headingIndex = isExcludedBankCard || isContractAttachmentReference
      ? null
      : findPageHeadingIndex(rule, headingLines);
    const compositeMatched =
      !isExcludedBankCard &&
      !isContractAttachmentReference &&
      matchesEmployeeDocumentCompositePageStart(rule.type, normalizedContent);
    const contentScore = isExcludedBankCard
      ? 0
      : Math.min(
          40,
          rule.contentPatterns.reduce(
            (score, item) =>
              score + (item.pattern.test(normalizedContent) ? item.score : 0),
            0,
          ),
        );
    return {
      type: rule.type,
      headingIndex,
      compositeMatched,
      contentScore,
    };
  });

  const headingMatches = scoredRules
    .filter((item) => item.headingIndex !== null)
    .sort(
      (left, right) =>
        (left.headingIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.headingIndex ?? Number.MAX_SAFE_INTEGER) ||
        right.contentScore - left.contentScore,
    );
  const earliestHeadingIndex = headingMatches[0]?.headingIndex;
  const earliestHeadingMatches = headingMatches.filter(
    (item) => item.headingIndex === earliestHeadingIndex,
  );
  if (earliestHeadingMatches.length === 1) {
    const best = earliestHeadingMatches[0];
    const conflictingCompositeTypes = scoredRules
      .filter(
        (item) =>
          item.type !== best.type &&
          item.compositeMatched &&
          (best.headingIndex ?? 0) > 2,
      )
      .map((item) => item.type);
    if (conflictingCompositeTypes.length > 0) {
      return uncertainClassification("ambiguous", [
        best.type,
        ...conflictingCompositeTypes,
      ]);
    }
    const label = EMPLOYEE_DOCUMENT_TYPE_LABELS[best.type];
    return {
      status: "success",
      documentType: best.type,
      label,
      source: "text",
      message: `已识别为${label}`,
      pageStartEvidence: "heading",
      headingIndex: best.headingIndex ?? undefined,
    };
  }
  if (earliestHeadingMatches.length > 1) {
    return uncertainClassification(
      "ambiguous",
      earliestHeadingMatches.map((item) => item.type),
    );
  }

  const compositeMatches = scoredRules
    .filter((item) => item.compositeMatched)
    .sort((left, right) => right.contentScore - left.contentScore);
  const best = compositeMatches[0];
  if (!best) return uncertainClassification();
  if (compositeMatches.length > 1) {
    return uncertainClassification(
      "ambiguous",
      compositeMatches.map((item) => item.type),
    );
  }

  const label = EMPLOYEE_DOCUMENT_TYPE_LABELS[best.type];
  return {
    status: "success",
    documentType: best.type,
    label,
    source: "text",
    message: `已识别为${label}`,
    pageStartEvidence: "composite",
  };
}

interface UnsupportedEmployeeDocumentMatch {
  label: string;
  evidence: "explicit" | "generic";
  headingIndex: number;
}

function detectUnsupportedEmployeeDocumentPageStartMatch(
  pageText: string,
): UnsupportedEmployeeDocumentMatch | null {
  const headingLines = normalizePageHeadingLines(pageText);
  const rules: Array<{ label: string; patterns: RegExp[] }> = [
    {
      label: "劳动关系其他协议",
      patterns: [
        /^解除劳动合同协议(?:书)?$/,
        /^解除劳动合同书$/,
        /^终止劳动合同协议(?:书)?$/,
        /^终止劳动合同书$/,
        /^劳动合同变更协议(?:书)?$/,
        /^劳动合同续订书$/,
      ],
    },
    {
      label: "员工离职证明",
      patterns: [
        /^员工离职证明(?:员工联|单位联)?$/,
        /^离职证明$/,
        /^解除劳动关系证明$/,
      ],
    },
    {
      label: "职业资格材料",
      patterns: [
        /^(?:一级|二级)?建造师$/,
        /^(?:中华人民共和国)?(?:一级|二级)?建造师注册证书$/,
        /^(?:一级|二级)?建造师执业资格证书$/,
        /^执业资格证书$/,
        /^专业技术资格证书$/,
        /^岗位证书$/,
        /^职称证书$/,
      ],
    },
    {
      label: "银行交易材料",
      patterns: [
        /^电子银行回单$/,
        /^银行回单$/,
        /^账户交易流水$/,
        /^银行流水$/,
        /^银联交易凭证$/,
      ],
    },
  ];

  for (const rule of rules) {
    const headingIndex = headingLines.findIndex((line) =>
      rule.patterns.some((pattern) => pattern.test(line)),
    );
    if (headingIndex >= 0) {
      return { label: rule.label, evidence: "explicit", headingIndex };
    }
  }

  const genericTitle = headingLines.find(
    (line, index) =>
      index < 10 &&
      line.length >= 2 &&
      line.length <= 40 &&
      !/^附件/.test(line) &&
      !/(?:达成|成|签订|订立|签署|履行|遵守|执行|违反|解除|终止|适用|约定)(?:本|该|如下)?协议书?$/.test(
        line,
      ) &&
      /(?:证明|证书|报告|登记表|申请表|协议书?|确认书|承诺书|通知书|情况说明|复印件|回执|凭证|记录)$/.test(
        line,
      ),
  );
  if (genericTitle) {
    return {
      label: `其他资料：${genericTitle}`,
      evidence: "generic",
      headingIndex: headingLines.indexOf(genericTitle),
    };
  }

  return null;
}

export function detectUnsupportedEmployeeDocumentPageStartText(
  pageText: string,
): string | null {
  return (
    detectUnsupportedEmployeeDocumentPageStartMatch(pageText)?.label || null
  );
}

export function canSkipEmployeeDocumentTitleRegionReview(
  recognizedTextCandidates: string[],
  provisionalBoundary: EmployeeDocumentPageBoundary | null = null,
): boolean {
  if (provisionalBoundary || recognizedTextCandidates.length < 2) return false;

  let expectedType: EmployeeDocumentType | null = null;
  for (const recognizedText of recognizedTextCandidates) {
    const classification = classifyEmployeeDocumentPageStartText(
      "",
      recognizedText,
    );
    if (classification.status !== "success" || !classification.documentType) {
      return false;
    }

    const documentType = classification.documentType;
    if (["contract", "nda", "declaration"].includes(documentType)) {
      return false;
    }
    if (expectedType && expectedType !== documentType) return false;
    expectedType = documentType;

    const normalizedContent = normalizeContent(recognizedText);
    const headingLines = normalizePageHeadingLines(recognizedText);
    const rule = CLASSIFICATION_RULES.find(
      (candidate) => candidate.type === documentType,
    );
    const headingIndex = rule ? findPageHeadingIndex(rule, headingLines) : null;
    if (headingIndex === null || headingIndex > 2) return false;
    if (
      !matchesEmployeeDocumentCompositePageStart(
        documentType,
        normalizedContent,
      )
    ) {
      return false;
    }

    const hasCompetingComposite = CLASSIFICATION_RULES.some(
      (candidate) =>
        candidate.type !== documentType &&
        matchesEmployeeDocumentCompositePageStart(
          candidate.type,
          normalizedContent,
        ),
    );
    if (hasCompetingComposite) return false;

    const unsupportedMatch =
      detectUnsupportedEmployeeDocumentPageStartMatch(recognizedText);
    if (unsupportedMatch?.evidence === "explicit") return false;
  }

  return expectedType !== null;
}

export function inspectEmployeeDocumentPageBoundaryText(
  originalFileName: string,
  text: string,
  source: "text" | "image",
): EmployeeDocumentPageBoundary | null {
  const unsupportedMatch =
    detectUnsupportedEmployeeDocumentPageStartMatch(text);
  const classification = classifyEmployeeDocumentPageStartText(
    originalFileName,
    text,
  );
  if (classification.status === "success" && classification.documentType) {
    if (
      unsupportedMatch?.evidence === "explicit" &&
      (classification.pageStartEvidence !== "heading" ||
        unsupportedMatch.headingIndex < (classification.headingIndex ?? 0))
    ) {
      return {
        kind: "unsupported",
        documentType: null,
        label: unsupportedMatch.label,
        source,
        unsupportedEvidence: unsupportedMatch.evidence,
      };
    }
    return {
      kind: "document",
      documentType: classification.documentType,
      label: classification.label,
      source,
      pageStartEvidence: classification.pageStartEvidence,
      headingIndex: classification.headingIndex,
    };
  }
  if (classification.uncertaintyReason === "ambiguous") {
    return {
      kind: "uncertain",
      documentType: null,
      label: classification.message,
      source,
      candidateTypes: classification.candidateTypes,
    };
  }
  if (unsupportedMatch) {
    return {
      kind: "unsupported",
      documentType: null,
      label: unsupportedMatch.label,
      source,
      unsupportedEvidence: unsupportedMatch.evidence,
    };
  }
  return null;
}

export function mergeEmployeeDocumentPageBoundaryEvidence(
  boundaries: Array<EmployeeDocumentPageBoundary | null>,
): EmployeeDocumentPageBoundary | null {
  const availableBoundaries = boundaries.filter(
    (boundary): boundary is EmployeeDocumentPageBoundary => boundary !== null,
  );
  if (availableBoundaries.length === 0) return null;
  const mergedSource = availableBoundaries.some(
    (boundary) => boundary.source === "image",
  )
    ? "image"
    : availableBoundaries[0].source;

  const explicitUnsupportedBoundaries = availableBoundaries.filter(
    (boundary) =>
      boundary.kind === "unsupported" &&
      boundary.unsupportedEvidence !== "generic",
  );
  const explicitUnsupportedLabels = Array.from(
    new Set(
      explicitUnsupportedBoundaries
        .map((boundary) => boundary.label)
        .filter((label): label is string => Boolean(label)),
    ),
  );
  const headingDocumentBoundaries = availableBoundaries.filter(
    (
      boundary,
    ): boundary is EmployeeDocumentPageBoundary & {
      documentType: EmployeeDocumentType;
    } =>
      boundary.kind === "document" &&
      Boolean(boundary.documentType) &&
      boundary.pageStartEvidence !== "composite",
  );
  const headingDocumentTypes = Array.from(
    new Set(headingDocumentBoundaries.map((boundary) => boundary.documentType)),
  );

  if (headingDocumentTypes.length > 1) {
    return {
      kind: "uncertain",
      documentType: null,
      label: `不同识别结果分别匹配${headingDocumentTypes
        .map((type) => EMPLOYEE_DOCUMENT_TYPE_LABELS[type])
        .join("、")}`,
      source: mergedSource,
      candidateTypes: headingDocumentTypes,
    };
  }
  if (
    headingDocumentTypes.length === 1 &&
    explicitUnsupportedBoundaries.length > 0
  ) {
    const documentType = headingDocumentTypes[0];
    return {
      kind: "uncertain",
      documentType: null,
      label: `固定档案${EMPLOYEE_DOCUMENT_TYPE_LABELS[documentType]}与${explicitUnsupportedLabels.join("、") || "其他资料"}的标题证据冲突`,
      source: mergedSource,
      candidateTypes: [documentType, "other"],
    };
  }
  if (headingDocumentTypes.length === 1) {
    return headingDocumentBoundaries
      .filter((boundary) => boundary.documentType === headingDocumentTypes[0])
      .sort(
        (left, right) =>
          (left.headingIndex ?? Number.MAX_SAFE_INTEGER) -
          (right.headingIndex ?? Number.MAX_SAFE_INTEGER),
      )[0];
  }

  const candidateTypes = Array.from(
    new Set(
      availableBoundaries.flatMap((boundary) => {
        if (boundary.kind === "document" && boundary.documentType) {
          return [boundary.documentType];
        }
        return boundary.kind === "uncertain"
          ? boundary.candidateTypes || []
          : [];
      }),
    ),
  );

  if (candidateTypes.length > 1) {
    const candidateLabels = candidateTypes.map(
      (type) => EMPLOYEE_DOCUMENT_TYPE_LABELS[type],
    );
    return {
      kind: "uncertain",
      documentType: null,
      label: `不同识别结果分别匹配${candidateLabels.join("、")}`,
      source: mergedSource,
      candidateTypes,
    };
  }

  if (candidateTypes.length > 0 && explicitUnsupportedBoundaries.length > 0) {
    const candidateLabels = candidateTypes.map(
      (type) => EMPLOYEE_DOCUMENT_TYPE_LABELS[type],
    );
    return {
      kind: "uncertain",
      documentType: null,
      label: `固定档案${candidateLabels.join("、")}与${explicitUnsupportedLabels.join("、") || "其他资料"}的标题证据冲突`,
      source: mergedSource,
      candidateTypes: [...candidateTypes, "other"],
    };
  }
  if (explicitUnsupportedLabels.length > 1) {
    return {
      kind: "uncertain",
      documentType: null,
      label: `不同识别结果分别匹配${explicitUnsupportedLabels.join("、")}`,
      source: mergedSource,
      candidateTypes: ["other"],
    };
  }

  const documentBoundary = availableBoundaries.find(
    (boundary) =>
      boundary.kind === "document" &&
      boundary.documentType === candidateTypes[0],
  );
  if (documentBoundary) return documentBoundary;

  const uncertainBoundary = availableBoundaries.find(
    (boundary) => boundary.kind === "uncertain",
  );
  if (uncertainBoundary) return uncertainBoundary;

  const explicitUnsupportedBoundary = explicitUnsupportedBoundaries[0];
  if (explicitUnsupportedBoundary) return explicitUnsupportedBoundary;

  const genericUnsupportedBoundaries = availableBoundaries.filter(
    (boundary) =>
      boundary.kind === "unsupported" &&
      boundary.unsupportedEvidence === "generic",
  );
  const genericLabels = Array.from(
    new Set(
      genericUnsupportedBoundaries
        .map((boundary) => boundary.label)
        .filter((label): label is string => Boolean(label)),
    ),
  );
  if (genericUnsupportedBoundaries.length >= 2 && genericLabels.length === 1) {
    return genericUnsupportedBoundaries[0];
  }
  if (genericUnsupportedBoundaries.length > 0) {
    return {
      kind: "uncertain",
      documentType: null,
      label:
        genericLabels.length === 1
          ? `仅一次识别到疑似其他资料标题“${genericLabels[0].replace(/^其他资料：/, "")}”，无法确认真实档案类型`
          : "不同识别结果得到不一致的其他资料标题，无法确认真实档案类型",
      source: mergedSource,
      candidateTypes: [],
    };
  }

  return null;
}

function isValidPdf(pdfPath: string): boolean {
  if (!fs.existsSync(pdfPath)) return false;
  const header = Buffer.alloc(5);
  const fileDescriptor = fs.openSync(pdfPath, "r");
  try {
    fs.readSync(fileDescriptor, header, 0, 5, 0);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return header.toString("ascii") === "%PDF-";
}

async function extractPdfPageText(
  pdfPath: string,
  pageNumber: number,
): Promise<string> {
  const result = (await execFileAsync(
    "pdftotext",
    [
      "-f",
      String(pageNumber),
      "-l",
      String(pageNumber),
      "-layout",
      pdfPath,
      "-",
    ],
    { timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
  )) as { stdout: string };
  return result.stdout || "";
}

async function recognizePdfPageImage(
  pdfPath: string,
  pageNumber: number,
  dpi: number,
  titleRegionOnly = false,
  focusedHeadingOnly = false,
): Promise<EmployeeDocumentImageRecognition> {
  const outputPrefix = `${pdfPath}-document-classify-${process.pid}-${Date.now()}-${pageNumber}-${dpi}-${focusedHeadingOnly ? "focus" : titleRegionOnly ? "title" : "full"}`;
  const imagePath = `${outputPrefix}.png`;
  const titleImagePath = `${outputPrefix}-title.png`;

  try {
    const renderPage = async (
      titleGeometry: EmployeeDocumentTitleRegionRenderGeometry | null,
    ): Promise<void> => {
      await execFileAsync(
        "pdftoppm",
        [
          ...(titleGeometry
            ? [
                "-x",
                "0",
                "-y",
                "0",
                "-W",
                String(titleGeometry.fullWidth),
                "-H",
                String(titleGeometry.renderHeight),
              ]
            : []),
          "-png",
          "-singlefile",
          "-r",
          String(dpi),
          "-f",
          String(pageNumber),
          "-l",
          String(pageNumber),
          pdfPath,
          outputPrefix,
        ],
        { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      );
    };

    let titleGeometry: EmployeeDocumentTitleRegionRenderGeometry | null = null;
    if (titleRegionOnly) {
      try {
        titleGeometry = await resolveEmployeeDocumentTitleRegionRenderGeometry(
          pdfPath,
          pageNumber,
          dpi,
        );
        await renderPage(titleGeometry);
        const croppedMetadata = await sharp(imagePath).metadata();
        if (
          croppedMetadata.width !== titleGeometry.fullWidth ||
          croppedMetadata.height !== titleGeometry.renderHeight
        ) {
          throw new Error("标题区直接渲染尺寸与预期不一致");
        }
      } catch (error) {
        titleGeometry = null;
        try {
          if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        } catch {
          /* 忽略直接裁剪回退前的临时文件清理错误 */
        }
        console.warn(
          `人事档案第${pageNumber}页标题区直接渲染失败，回退为整页渲染后裁剪`,
          error,
        );
        await renderPage(null);
      }
    } else {
      await renderPage(null);
    }

    if (!fs.existsSync(imagePath)) throw new Error("档案页面转图片失败");
    let recognitionPath = imagePath;
    if (titleRegionOnly) {
      const metadata = await sharp(imagePath).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      if (width > 0 && height > 0) {
        if (focusedHeadingOnly) {
          const focusedGeometry =
            calculateEmployeeDocumentFocusedHeadingGeometry(
              titleGeometry?.fullWidth || width,
              titleGeometry?.fullHeight || height,
              width,
              height,
            );
          await sharp(imagePath)
            .extract({
              left: focusedGeometry.left,
              top: focusedGeometry.top,
              width: focusedGeometry.width,
              height: focusedGeometry.height,
            })
            .grayscale()
            .normalize()
            .sharpen()
            .resize({ width: focusedGeometry.targetWidth })
            .png()
            .toFile(titleImagePath);
          recognitionPath = titleImagePath;
        } else {
          const titleHeight =
            titleGeometry?.titleHeight ||
            Math.max(
              1,
              Math.floor(height * EMPLOYEE_DOCUMENT_TITLE_REGION_RATIO),
            );
          if (height >= titleHeight) {
            await sharp(imagePath)
              .extract({
                left: 0,
                top: 0,
                width,
                height: titleHeight,
              })
              .grayscale()
              .normalize()
              .sharpen()
              .png()
              .toFile(titleImagePath);
            recognitionPath = titleImagePath;
          }
        }
      }
    }
    const { callPaddleOcrDetailed } = await import("./ocrDaemon.js");
    const recognition = await callPaddleOcrDetailed(recognitionPath);
    const layoutText = buildEmployeeDocumentOcrLayoutText(recognition.lines);
    return {
      textCandidates: Array.from(
        new Set(
          [layoutText, recognition.fullText]
            .map((text) => text.trim())
            .filter(Boolean),
        ),
      ),
      lines: recognition.lines,
    };
  } finally {
    try {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
      if (fs.existsSync(titleImagePath)) fs.unlinkSync(titleImagePath);
    } catch {
      /* 忽略临时文件清理失败 */
    }
  }
}

interface EmployeeDocumentRotatedRecognition {
  rotation: EmployeeDocumentImageRotation;
  recognition: EmployeeDocumentImageRecognition;
  boundary: EmployeeDocumentPageBoundary | null;
}

async function recognizeEmployeeDocumentRotatedPages(
  pdfPath: string,
  originalFileName: string,
  pageNumber: number,
  rotations: EmployeeDocumentImageRotation[],
): Promise<EmployeeDocumentRotatedRecognition[]> {
  if (rotations.length === 0) return [];

  const outputPrefix = `${pdfPath}-document-classify-${process.pid}-${Date.now()}-${pageNumber}-300-orientation`;
  const imagePath = `${outputPrefix}.png`;
  const rotatedImagePaths: string[] = [];

  try {
    await execFileAsync(
      "pdftoppm",
      [
        "-png",
        "-singlefile",
        "-r",
        "300",
        "-f",
        String(pageNumber),
        "-l",
        String(pageNumber),
        pdfPath,
        outputPrefix,
      ],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
    );
    if (!fs.existsSync(imagePath)) {
      throw new Error("档案方向复核页面转图片失败");
    }

    const { callPaddleOcrDetailed } = await import("./ocrDaemon.js");
    const results: EmployeeDocumentRotatedRecognition[] = [];
    for (const rotation of rotations) {
      const rotatedImagePath = `${outputPrefix}-${rotation}.png`;
      rotatedImagePaths.push(rotatedImagePath);
      await sharp(imagePath)
        .rotate(rotation, {
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        })
        .flatten({ background: "#ffffff" })
        .grayscale()
        .normalize()
        .sharpen()
        .png()
        .toFile(rotatedImagePath);

      const recognition = await callPaddleOcrDetailed(rotatedImagePath);
      const layoutText = buildEmployeeDocumentOcrLayoutText(recognition.lines);
      const textCandidates = Array.from(
        new Set(
          [layoutText, recognition.fullText]
            .map((text) => text.trim())
            .filter(Boolean),
        ),
      );
      const normalizedRecognition = {
        textCandidates,
        lines: recognition.lines,
      };
      results.push({
        rotation,
        recognition: normalizedRecognition,
        boundary: resolveEmployeeDocumentImagePassBoundary(
          originalFileName,
          textCandidates,
        ),
      });
    }
    return results;
  } finally {
    for (const temporaryPath of [imagePath, ...rotatedImagePaths]) {
      try {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      } catch {
        /* 忽略方向复核临时文件清理失败 */
      }
    }
  }
}

export function mergeEmployeeDocumentRotationBoundaryEvidence(
  boundaries: Array<EmployeeDocumentPageBoundary | null>,
): EmployeeDocumentPageBoundary | null {
  const strongBoundaries = boundaries.filter(
    (boundary): boundary is EmployeeDocumentPageBoundary =>
      Boolean(
        boundary &&
        ((boundary.kind === "document" &&
          boundary.pageStartEvidence !== "composite") ||
          (boundary.kind === "unsupported" &&
            boundary.unsupportedEvidence !== "generic")),
      ),
  );
  const strongBoundary =
    mergeEmployeeDocumentPageBoundaryEvidence(strongBoundaries);
  if (strongBoundary) return strongBoundary;

  const compositeBoundaries = boundaries.filter(
    (
      boundary,
    ): boundary is EmployeeDocumentPageBoundary & {
      documentType: EmployeeDocumentType;
    } =>
      boundary?.kind === "document" &&
      Boolean(boundary.documentType) &&
      boundary.pageStartEvidence === "composite" &&
      EMPLOYEE_DOCUMENT_ROTATION_COMPOSITE_TYPES.has(boundary.documentType!),
  );
  const compositeTypes = Array.from(
    new Set(compositeBoundaries.map((boundary) => boundary.documentType)),
  );
  if (compositeBoundaries.length >= 2 && compositeTypes.length === 1) {
    return compositeBoundaries[0];
  }
  return null;
}

function resolveEmployeeDocumentStrongRotatedBoundary(
  rotatedRecognitions: EmployeeDocumentRotatedRecognition[],
): EmployeeDocumentPageBoundary | null {
  return mergeEmployeeDocumentRotationBoundaryEvidence(
    rotatedRecognitions.map((result) => result.boundary),
  );
}

function findEmployeeDocumentRotatedRecognition(
  rotatedRecognitions: EmployeeDocumentRotatedRecognition[],
  boundary: EmployeeDocumentPageBoundary,
): EmployeeDocumentRotatedRecognition | undefined {
  if (boundary.kind !== "document" || !boundary.documentType) {
    return undefined;
  }
  return rotatedRecognitions.find(
    (result) =>
      result.boundary?.kind === "document" &&
      result.boundary.documentType === boundary.documentType,
  );
}

function resolveEmployeeDocumentImagePassBoundary(
  originalFileName: string,
  recognizedTextCandidates: string[],
): EmployeeDocumentPageBoundary | null {
  const candidateBoundaries = recognizedTextCandidates
    .map((recognizedText) =>
      inspectEmployeeDocumentPageBoundaryText(
        originalFileName,
        recognizedText,
        "image",
      ),
    )
    .filter(
      (boundary): boundary is EmployeeDocumentPageBoundary => boundary !== null,
    );
  const mergedBoundary =
    mergeEmployeeDocumentPageBoundaryEvidence(candidateBoundaries);
  if (
    mergedBoundary?.kind === "document" &&
    mergedBoundary.documentType === "declaration" &&
    recognizedTextCandidates.some((text) =>
      isContractAttachmentDeclarationReference(normalizeContent(text)),
    )
  ) {
    return null;
  }
  return mergedBoundary;
}

export function filterEmployeeDocumentFocusedHeadingBoundary(
  boundary: EmployeeDocumentPageBoundary | null,
): EmployeeDocumentPageBoundary | null {
  if (
    boundary?.kind === "document" &&
    boundary.documentType &&
    boundary.pageStartEvidence === "heading"
  ) {
    return boundary;
  }
  if (
    boundary?.kind === "uncertain" &&
    (boundary.candidateTypes?.length || 0) > 0
  ) {
    return boundary;
  }
  return null;
}

export async function detectEmployeeDocumentPageBoundary(
  pdfPath: string,
  originalFileName: string,
  pageNumber: number,
  options: EmployeeDocumentPageBoundaryDetectionOptions = {},
): Promise<EmployeeDocumentPageBoundary> {
  let provisionalBoundary: EmployeeDocumentPageBoundary | null = null;
  let extractedText = "";
  try {
    extractedText = await extractPdfPageText(pdfPath, pageNumber);
    if (extractedText.trim()) {
      const boundary = inspectEmployeeDocumentPageBoundaryText(
        originalFileName,
        extractedText,
        "text",
      );
      if (boundary) provisionalBoundary = boundary;
    }
  } catch {
    console.warn(`人事档案第${pageNumber}页文字层提取失败，改用图片识别`);
  }

  const recognizedTexts: string[] = [];
  let fastTitleRecognition: EmployeeDocumentImageRecognition | null = null;
  let fastTitleBoundary: EmployeeDocumentPageBoundary | null = null;
  let rotatedRecognitions: EmployeeDocumentRotatedRecognition[] | null = null;
  try {
    fastTitleRecognition = await recognizePdfPageImage(
      pdfPath,
      pageNumber,
      300,
      true,
    );
    recognizedTexts.push(...fastTitleRecognition.textCandidates);
    if (fastTitleRecognition.textCandidates.length > 0) {
      options.onPageRecognized?.([...fastTitleRecognition.textCandidates]);
    }
    fastTitleBoundary = resolveEmployeeDocumentImagePassBoundary(
      originalFileName,
      fastTitleRecognition.textCandidates,
    );
  } catch (error) {
    rethrowOcrInfrastructureError(error);
    console.warn(
      `人事档案第${pageNumber}页快速标题区图片识别失败，分辨率：300`,
    );
  }

  if (
    fastTitleRecognition &&
    isEmployeeDocumentOcrMostlyVertical(fastTitleRecognition.lines) &&
    !(
      fastTitleBoundary?.kind === "document" &&
      fastTitleBoundary.pageStartEvidence !== "composite"
    ) &&
    !(
      fastTitleBoundary?.kind === "unsupported" &&
      fastTitleBoundary.unsupportedEvidence !== "generic"
    )
  ) {
    try {
      rotatedRecognitions = await recognizeEmployeeDocumentRotatedPages(
        pdfPath,
        originalFileName,
        pageNumber,
        [90, 270],
      );
      const rotatedBoundary =
        resolveEmployeeDocumentStrongRotatedBoundary(rotatedRecognitions);
      if (rotatedBoundary) {
        const selectedRecognition = findEmployeeDocumentRotatedRecognition(
          rotatedRecognitions,
          rotatedBoundary,
        );
        if (selectedRecognition) {
          options.onPageRecognized?.(
            selectedRecognition.recognition.textCandidates,
          );
        }
        return rotatedBoundary;
      }
      const rotatedTextCandidates = Array.from(
        new Set(
          rotatedRecognitions.flatMap(
            (result) => result.recognition.textCandidates,
          ),
        ),
      );
      if (
        !provisionalBoundary &&
        rotatedTextCandidates.some(hasReadablePageText)
      ) {
        options.onPageRecognized?.(rotatedTextCandidates);
        return {
          kind: "none",
          documentType: null,
          label: null,
          source: "image",
        };
      }
    } catch (error) {
      rethrowOcrInfrastructureError(error);
      console.warn(`人事档案第${pageNumber}页快速方向复核失败`);
    }
  }

  if (
    fastTitleBoundary?.kind === "document" &&
    fastTitleRecognition &&
    canSkipEmployeeDocumentTitleRegionReview(
      fastTitleRecognition.textCandidates,
      provisionalBoundary,
    )
  ) {
    return fastTitleBoundary;
  }

  let focusedHeadingRecognition: EmployeeDocumentImageRecognition | null = null;
  let focusedHeadingBoundary: EmployeeDocumentPageBoundary | null = null;
  if (fastTitleBoundary?.kind !== "document" && fastTitleRecognition) {
    try {
      focusedHeadingRecognition = await recognizePdfPageImage(
        pdfPath,
        pageNumber,
        300,
        true,
        true,
      );
      recognizedTexts.push(...focusedHeadingRecognition.textCandidates);
      focusedHeadingBoundary = filterEmployeeDocumentFocusedHeadingBoundary(
        resolveEmployeeDocumentImagePassBoundary(
          originalFileName,
          focusedHeadingRecognition.textCandidates,
        ),
      );
    } catch (error) {
      rethrowOcrInfrastructureError(error);
      console.warn(
        `人事档案第${pageNumber}页聚焦标题图片识别失败，分辨率：300`,
      );
    }
  }

  if (
    focusedHeadingBoundary?.kind === "document" &&
    focusedHeadingRecognition &&
    canSkipEmployeeDocumentTitleRegionReview(
      focusedHeadingRecognition.textCandidates,
      provisionalBoundary,
    )
  ) {
    return focusedHeadingBoundary;
  }

  if (
    !provisionalBoundary &&
    !fastTitleBoundary &&
    !focusedHeadingBoundary &&
    fastTitleRecognition &&
    hasReliableEmployeeDocumentTitleRecognition(
      fastTitleRecognition.textCandidates,
      fastTitleRecognition.lines,
    )
  ) {
    return resolveEmployeeDocumentPageNoBoundary(
      extractedText,
      fastTitleRecognition.textCandidates,
    );
  }

  let detailedTitleRecognition: EmployeeDocumentImageRecognition | null = null;
  let detailedTitleBoundary: EmployeeDocumentPageBoundary | null = null;
  try {
    detailedTitleRecognition = await recognizePdfPageImage(
      pdfPath,
      pageNumber,
      480,
      true,
    );
    recognizedTexts.push(...detailedTitleRecognition.textCandidates);
    detailedTitleBoundary = resolveEmployeeDocumentImagePassBoundary(
      originalFileName,
      detailedTitleRecognition.textCandidates,
    );
  } catch (error) {
    rethrowOcrInfrastructureError(error);
    console.warn(
      `人事档案第${pageNumber}页高分辨率标题区图片识别失败，分辨率：480`,
    );
  }

  const titleBoundary = mergeEmployeeDocumentPageBoundaryEvidence([
    provisionalBoundary,
    fastTitleBoundary,
    focusedHeadingBoundary,
    detailedTitleBoundary,
  ]);
  if (titleBoundary?.kind === "document" && titleBoundary.documentType) {
    const matchingTitlePasses = [
      fastTitleBoundary,
      focusedHeadingBoundary,
      detailedTitleBoundary,
    ].filter(
      (boundary) =>
        boundary?.kind === "document" &&
        boundary.documentType === titleBoundary.documentType,
    ).length;
    if (
      matchingTitlePasses >= 2 &&
      titleBoundary.documentType !== "declaration"
    ) {
      return titleBoundary;
    }
  } else if (titleBoundary?.kind === "unsupported") {
    return titleBoundary;
  } else if (
    titleBoundary?.kind === "uncertain" &&
    (titleBoundary.candidateTypes?.length || 0) > 1
  ) {
    return titleBoundary;
  }

  if (
    !provisionalBoundary &&
    !fastTitleBoundary &&
    !focusedHeadingBoundary &&
    !detailedTitleBoundary &&
    detailedTitleRecognition &&
    hasReliableEmployeeDocumentTitleRecognition(
      detailedTitleRecognition.textCandidates,
      detailedTitleRecognition.lines,
    )
  ) {
    return resolveEmployeeDocumentPageNoBoundary(
      extractedText,
      recognizedTexts,
    );
  }

  let fullImageRecognition: EmployeeDocumentImageRecognition | null = null;
  let fullImageBoundary: EmployeeDocumentPageBoundary | null = null;
  try {
    fullImageRecognition = await recognizePdfPageImage(
      pdfPath,
      pageNumber,
      300,
      false,
    );
    recognizedTexts.push(...fullImageRecognition.textCandidates);
    if (fullImageRecognition.textCandidates.length > 0) {
      options.onPageRecognized?.([...fullImageRecognition.textCandidates]);
    }
    fullImageBoundary = resolveEmployeeDocumentImagePassBoundary(
      originalFileName,
      fullImageRecognition.textCandidates,
    );
  } catch (error) {
    rethrowOcrInfrastructureError(error);
    console.warn(`人事档案第${pageNumber}页整页图片识别失败，分辨率：300`);
  }

  const combinedBoundary = mergeEmployeeDocumentPageBoundaryEvidence([
    provisionalBoundary,
    fastTitleBoundary,
    focusedHeadingBoundary,
    detailedTitleBoundary,
    fullImageBoundary,
  ]);
  const isContractAttachmentReference = [extractedText, ...recognizedTexts]
    .filter(Boolean)
    .some((text) =>
      isContractAttachmentDeclarationReference(normalizeContent(text)),
    );

  if (
    combinedBoundary?.kind === "document" &&
    combinedBoundary.documentType === "declaration" &&
    isContractAttachmentReference
  ) {
    return {
      kind: "none",
      documentType: null,
      label: null,
      source: recognizedTexts.length > 0 ? "image" : "text",
    };
  }

  if (
    (combinedBoundary?.kind === "document" &&
      combinedBoundary.pageStartEvidence !== "composite") ||
    (combinedBoundary?.kind === "unsupported" &&
      combinedBoundary.unsupportedEvidence !== "generic")
  ) {
    return combinedBoundary;
  }

  const recognitionLineGroups = [
    fastTitleRecognition?.lines || [],
    focusedHeadingRecognition?.lines || [],
    detailedTitleRecognition?.lines || [],
    fullImageRecognition?.lines || [],
  ];
  const rotationReviewAngles = resolveEmployeeDocumentRotationReviewAngles(
    recognitionLineGroups,
  );
  if (rotationReviewAngles.length > 0 || rotatedRecognitions) {
    try {
      rotatedRecognitions ??= await recognizeEmployeeDocumentRotatedPages(
        pdfPath,
        originalFileName,
        pageNumber,
        rotationReviewAngles,
      );
      const rotatedBoundary =
        resolveEmployeeDocumentStrongRotatedBoundary(rotatedRecognitions);
      if (rotatedBoundary) {
        const selectedRecognition = findEmployeeDocumentRotatedRecognition(
          rotatedRecognitions,
          rotatedBoundary,
        );
        if (selectedRecognition) {
          options.onPageRecognized?.(
            selectedRecognition.recognition.textCandidates,
          );
        }
        return rotatedBoundary;
      }
    } catch (error) {
      rethrowOcrInfrastructureError(error);
      console.warn(`人事档案第${pageNumber}页方向复核失败`);
    }
  }

  if (combinedBoundary) return combinedBoundary;

  return resolveEmployeeDocumentPageNoBoundary(extractedText, recognizedTexts);
}

export async function classifyEmployeeDocument(
  pdfPath: string,
  originalFileName: string,
): Promise<EmployeeDocumentClassification> {
  if (!isValidPdf(pdfPath)) {
    return {
      ...uncertainClassification(),
      message: "上传文件不是有效的PDF文件",
    };
  }

  let extractedText = "";
  try {
    extractedText = await extractPdfPageText(pdfPath, 1);
    if (extractedText.trim()) {
      const classification = classifyEmployeeDocumentText(
        originalFileName,
        extractedText,
      );
      if (classification.status === "success") return classification;
    }
  } catch {
    console.warn("人事档案文字层提取失败，改用图片识别");
  }

  let imageClassification: EmployeeDocumentClassification | null = null;
  const imageCandidateTypes = new Set<EmployeeDocumentType>();
  for (const dpi of [300, 480]) {
    try {
      const recognition = await recognizePdfPageImage(pdfPath, 1, dpi);
      const classifications = recognition.textCandidates.map((recognizedText) =>
        classifyEmployeeDocumentText(
          originalFileName,
          `${extractedText}\n${recognizedText}`,
        ),
      );
      for (const classification of classifications) {
        if (
          classification.status === "success" &&
          classification.documentType
        ) {
          imageCandidateTypes.add(classification.documentType);
          imageClassification =
            classification.source === "text"
              ? { ...classification, source: "image" }
              : classification;
        } else if (classification.uncertaintyReason === "ambiguous") {
          for (const type of classification.candidateTypes || []) {
            imageCandidateTypes.add(type);
          }
        }
      }
      if (imageCandidateTypes.size > 1) {
        return uncertainClassification(
          "ambiguous",
          Array.from(imageCandidateTypes),
        );
      }
    } catch (error) {
      rethrowOcrInfrastructureError(error);
      console.warn(`人事档案图片识别失败，分辨率：${dpi}`);
    }
  }

  if (imageClassification) return imageClassification;

  return classifyEmployeeDocumentText(originalFileName, extractedText);
}
