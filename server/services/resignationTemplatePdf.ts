import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { pathToFileURL } from "url";
import { createCanvas } from "canvas";
import JSZip from "jszip";
import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import type { ResignationArchiveType } from "./resignationArchive.js";

const execFileAsync = promisify(execFile);
const TEMPLATE_WIDTH = 595.3;
const TEMPLATE_HEIGHT = 841.9;
const RASTER_SCALE = 4;
const BODY_FONT_FAMILY =
  '"FangSong_GB2312", "STFangsong", "FangSong SC", "Noto Serif CJK SC", serif';
const NUMBER_FONT_FAMILY =
  '"Noto Sans CJK SC", "PingFang SC", "Arial", sans-serif';
const AUTO_FILL_FONT_SIZE = 16;
const AUTO_FILL_MIN_HEIGHT = 25;
const AUTO_FILL_HORIZONTAL_MARGIN = 2.5;
const AUTO_FILL_GLYPH_SAFETY_MARGIN = 1.5;
const AUTO_FILL_VERTICAL_MARGIN = 2.5;
const AUTO_FILL_TEMPLATE_BASELINE_GAP = 2.5;
const MIN_TEMPLATE_FONT_SIZE = 7;
const MAX_TEMPLATE_FONT_SIZE = 36;
const MIN_EDITABLE_UNDERLINE_WIDTH = 12;
const MIN_EDITABLE_UNDERLINE_STROKE_WIDTH = 0.4;
const MAX_EDITABLE_UNDERLINE_STROKE_WIDTH = 2.4;
const UNDERLINE_FIELD_BOTTOM_OVERFLOW = 2;
const UNDERLINE_FIELD_MATCH_TOLERANCE = 6;
const MAX_CUSTOM_ITEMS = 120;
const MAX_FIELD_VALUE_LENGTH = 2_000;

const TEMPLATE_SUFFIX: Record<ResignationArchiveType, number> = {
  termination_agreement: 1,
  employee_handover_form: 2,
  settlement_confirmation: 3,
  compensation_agreement: 4,
  resignation_certificate: 5,
};

export interface ResignationTemplateContext {
  employeeName: string;
  employeeNo: string;
  idNumber: string;
  department: string;
  position: string;
  hireDate: string;
  firstContractStartDate: string;
  resignDate: string;
}

export type ResignationTemplateTextAlign = "left" | "center" | "right";

export interface ResignationTemplateField {
  key: string;
  label: string;
  page: number;
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  align: ResignationTemplateTextAlign;
  fontFamily?: string;
  color?: string;
  paddingX?: number;
  replaceSourceText?: boolean;
  sourceText?: string;
  value: string;
}

export interface ResignationCustomTextItem {
  id: string;
  page: number;
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  align: ResignationTemplateTextAlign;
  color: "#000000" | "#C80000";
  value: string;
}

export interface ResignationTemplateOverlayDraft {
  version: 1;
  fieldOverrides: Record<string, string>;
  fieldAlignments: Record<string, ResignationTemplateTextAlign>;
  customItems: ResignationCustomTextItem[];
}

export interface ResignationTemplateEditorState {
  documentNumber: string;
  documentNumberBoxes: ResignationDocumentNumberBox[];
  fields: ResignationTemplateField[];
  warnings: string[];
}

export interface ResignationDocumentNumberBox {
  page: number;
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  color?: string;
}

export interface ResignationPdfTextWord {
  page: number;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  text: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
}

export interface ResignationPdfUnderlineSegment {
  page: number;
  x: number;
  top: number;
  width: number;
  strokeWidth: number;
}

interface ResignationPdfTextStyleSpan {
  page: number;
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  color: string;
}

interface TextBox {
  x: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  align: "left" | "center" | "right";
  color?: string;
  background?: string;
  fontFamily?: string;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  maxLines?: number;
  preserveFontHeight?: boolean;
  fitProportionally?: boolean;
  glyphSafetyX?: number;
}

interface DateParts {
  year: string;
  month: string;
  day: string;
}

let conversionQueue: Promise<unknown> = Promise.resolve();
const pdfCache = new Map<string, Buffer>();
const pdfTextLayoutCache = new Map<string, ResignationPdfTextWord[]>();
const pdfJsTextLayoutCache = new Map<string, ResignationPdfTextWord[]>();
const pdfUnderlineCache = new Map<string, ResignationPdfUnderlineSegment[]>();

function runSerializedConversion<T>(task: () => Promise<T>): Promise<T> {
  const result = conversionQueue.then(task, task);
  conversionQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function parseDateParts(value: string | null | undefined): DateParts {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { year: "", month: "", day: "" };
  return {
    year: match[1],
    month: String(Number(match[2])),
    day: String(Number(match[3])),
  };
}

function formatChineseDate(value: string | null | undefined): string {
  const parts = parseDateParts(value);
  if (!parts.year) return "";
  return `${parts.year}年${parts.month}月${parts.day}日`;
}

function field(
  key: string,
  label: string,
  page: number,
  x: number,
  top: number,
  width: number,
  value: string,
  options: Partial<
    Pick<
      ResignationTemplateField,
      "height" | "fontSize" | "align" | "fontFamily" | "color"
    >
  > = {},
): ResignationTemplateField {
  return {
    key,
    label,
    page,
    x,
    top,
    width,
    height: options.height ?? 21,
    fontSize: options.fontSize ?? AUTO_FILL_FONT_SIZE,
    align: options.align ?? "center",
    fontFamily: options.fontFamily ?? BODY_FONT_FAMILY,
    color: options.color ?? "#000000",
    value,
  };
}

export function extractResignationEmployeeNumberDigits(
  employeeNo: string,
): string {
  const groups = String(employeeNo || "").match(/\d+/g);
  const digits = groups?.at(-1) || "";
  if (!digits) return "";
  return digits.length < 3 ? digits.padStart(3, "0") : digits;
}

export function buildResignationDocumentNumber(
  templateType: ResignationArchiveType,
  employeeNo: string,
): string {
  const digits = extractResignationEmployeeNumberDigits(employeeNo) || "XXX";
  return `编号： YULI-CS${digits}-LZ${TEMPLATE_SUFFIX[templateType]}`;
}

export function calculateResignationTenure(
  startDate: string,
  endDate: string,
): { years: number; months: number } | null {
  const start = parseDateParts(startDate);
  const end = parseDateParts(endDate);
  if (!start.year || !end.year) return null;

  const startYear = Number(start.year);
  const startMonth = Number(start.month);
  const startDay = Number(start.day);
  const endYear = Number(end.year);
  const endMonth = Number(end.month);
  const endDay = Number(end.day);
  let totalMonths = (endYear - startYear) * 12 + endMonth - startMonth;
  if (endDay < startDay) totalMonths -= 1;
  if (totalMonths < 0) return null;
  return {
    years: Math.floor(totalMonths / 12),
    months: totalMonths % 12,
  };
}

export function buildResignationTemplateEditorState(
  templateType: ResignationArchiveType,
  context: ResignationTemplateContext,
  fieldOverrides: Record<string, string> = {},
  fieldAlignments: Record<string, ResignationTemplateTextAlign> = {},
): ResignationTemplateEditorState {
  const contractDate = parseDateParts(context.firstContractStartDate);
  const resignDate = parseDateParts(context.resignDate);
  const hireDate = parseDateParts(
    context.hireDate || context.firstContractStartDate,
  );
  const tenure = calculateResignationTenure(
    context.firstContractStartDate,
    context.resignDate,
  );
  const warnings: string[] = [];

  if (!extractResignationEmployeeNumberDigits(context.employeeNo)) {
    warnings.push("员工编号中没有可用于离职文件编号的数字");
  }
  if (
    ["termination_agreement", "compensation_agreement"].includes(
      templateType,
    ) &&
    !contractDate.year
  ) {
    warnings.push("尚未识别到该员工第一份劳动合同的开始日期，请核对人事档案");
  }
  if (templateType === "compensation_agreement" && !tenure) {
    warnings.push("任职起止日期不完整或顺序不正确，工作年限暂未自动计算");
  }

  let fields: ResignationTemplateField[] = [];
  if (templateType === "termination_agreement") {
    fields = [
      field("employeeName", "乙方姓名", 1, 138, 198, 89, context.employeeName),
      field("idNumber", "身份证号", 1, 309, 198, 151, context.idNumber),
      field("contractYear", "首次合同年份", 1, 141, 247, 49, contractDate.year),
      field(
        "contractMonth",
        "首次合同月份",
        1,
        205,
        247,
        25,
        contractDate.month,
      ),
      field("contractDay", "首次合同日期", 1, 245, 247, 16, contractDate.day),
      field("resignYear", "解除年份", 1, 165, 295, 41, resignDate.year),
      field("resignMonth", "解除月份", 1, 221, 295, 25, resignDate.month),
      field("resignDay", "解除日期", 1, 261, 295, 25, resignDate.day),
    ];
  } else if (templateType === "employee_handover_form") {
    fields = [
      field("employeeName", "员工姓名", 1, 160, 153, 68, context.employeeName),
      field("department", "所属部门", 1, 320, 153, 68, context.department, {
        fontSize: 10.5,
      }),
      field("position", "岗位", 1, 448, 153, 64, context.position, {
        fontSize: 10.5,
      }),
      field("lastWorkDate", "最后工作日", 1, 176, 177, 80, ""),
      field(
        "terminationDate",
        "劳动关系解除日期",
        1,
        416,
        177,
        96,
        formatChineseDate(context.resignDate),
        { fontSize: 9.5 },
      ),
      field(
        "projectHandoverEmployeeName",
        "附件一员工姓名",
        3,
        160,
        177,
        68,
        context.employeeName,
      ),
      field(
        "customerHandoverEmployeeName",
        "附件二员工姓名",
        4,
        160,
        225,
        68,
        context.employeeName,
      ),
      field(
        "assetHandoverEmployeeName",
        "附件三员工姓名",
        5,
        160,
        249,
        68,
        context.employeeName,
      ),
    ];
  } else if (templateType === "settlement_confirmation") {
    fields = [
      field("employeeName", "员工姓名", 1, 181, 159, 48, context.employeeName),
      field("idNumber", "身份证号", 1, 333, 159, 152, context.idNumber, {
        fontSize: 10.5,
      }),
    ];
  } else if (templateType === "compensation_agreement") {
    fields = [
      field("employeeName", "员工姓名", 1, 181, 159, 48, context.employeeName),
      field("idNumber", "身份证号", 1, 333, 159, 152, context.idNumber, {
        fontSize: 10.5,
      }),
      field("startYear", "任职开始年份", 1, 165, 234, 32, contractDate.year),
      field("startMonth", "任职开始月份", 1, 221, 234, 16, contractDate.month),
      field("startDay", "任职开始日期", 1, 261, 234, 16, contractDate.day),
      field("endYear", "任职结束年份", 1, 317, 234, 32, resignDate.year),
      field("endMonth", "任职结束月份", 1, 373, 234, 16, resignDate.month),
      field("endDay", "任职结束日期", 1, 413, 234, 16, resignDate.day),
      field(
        "tenureYears",
        "工作年限年数",
        1,
        224,
        259,
        16,
        tenure ? String(tenure.years) : "",
      ),
      field(
        "tenureMonths",
        "工作年限月数",
        1,
        280,
        259,
        16,
        tenure ? String(tenure.months) : "",
      ),
    ];
  } else if (templateType === "resignation_certificate") {
    fields = [
      field("employeeName", "员工姓名", 1, 197, 159, 48, context.employeeName),
      field("idNumber", "身份证号", 1, 346, 159, 167, context.idNumber, {
        fontSize: 10.5,
      }),
      field("hireYear", "入职年份", 1, 128, 183, 32, hireDate.year),
      field("hireMonth", "入职月份", 1, 184, 183, 16, hireDate.month),
      field("hireDay", "入职日期", 1, 224, 183, 16, hireDate.day),
      field("position", "任职岗位", 1, 408, 183, 80, context.position, {
        fontSize: 10.5,
      }),
      field("resignYear", "解除年份", 1, 229, 231, 32, resignDate.year),
      field("resignMonth", "解除月份", 1, 285, 231, 16, resignDate.month),
      field("resignDay", "解除日期", 1, 325, 231, 16, resignDate.day),
    ];
  }

  fields = fields.map((item) => ({
    ...item,
    height: Math.max(AUTO_FILL_MIN_HEIGHT, item.height),
    align: fieldAlignments[item.key] || item.align,
    value: Object.prototype.hasOwnProperty.call(fieldOverrides, item.key)
      ? fieldOverrides[item.key]
      : item.value,
  }));

  return {
    documentNumber: buildResignationDocumentNumber(
      templateType,
      context.employeeNo,
    ),
    documentNumberBoxes: [],
    fields,
    warnings,
  };
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readNumericAttribute(attributes: string, name: string): number | null {
  const match = attributes.match(new RegExp(`${name}="([^"]+)"`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function readStringAttribute(attributes: string, name: string): string {
  return attributes.match(new RegExp(`${name}="([^"]*)"`))?.[1] || "";
}

function normalizePdfFontFamily(value: string): string {
  const family = value.replace(/^[A-Z]{6}\+/i, "").replace(/"/g, "");
  if (/^(?:monospace|sans-serif|serif)$/i.test(family)) {
    return BODY_FONT_FAMILY;
  }
  if (/FangSong|仿宋/i.test(family)) return BODY_FONT_FAMILY;
  if (/NotoSansCJK|MicrosoftYaHei|微软雅黑|兰亭/i.test(family)) {
    return `"${family}", "Noto Sans CJK SC", "PingFang SC", sans-serif`;
  }
  if (/NotoSerifCJK|Song|宋/i.test(family)) {
    return `"${family}", "Noto Serif CJK SC", "Songti SC", serif`;
  }
  return family
    ? `"${family}", "Noto Serif CJK SC", "PingFang SC", sans-serif`
    : BODY_FONT_FAMILY;
}

function parsePdfTextStyleSpans(xml: string): ResignationPdfTextStyleSpan[] {
  const fonts = new Map<
    string,
    {
      fontSize: number;
      fontFamily: string;
      color: string;
    }
  >();
  const fontPattern = /<fontspec\b([^>]*)\/>/gi;
  let fontMatch: RegExpExecArray | null;
  while ((fontMatch = fontPattern.exec(xml))) {
    const id = readStringAttribute(fontMatch[1], "id");
    const fontSize = readNumericAttribute(fontMatch[1], "size");
    if (!id || fontSize === null) continue;
    fonts.set(id, {
      fontSize,
      fontFamily: normalizePdfFontFamily(
        readStringAttribute(fontMatch[1], "family"),
      ),
      color: readStringAttribute(fontMatch[1], "color") || "#000000",
    });
  }

  const spans: ResignationPdfTextStyleSpan[] = [];
  const pagePattern = /<page\b[^>]*>([\s\S]*?)<\/page>/gi;
  let pageMatch: RegExpExecArray | null;
  let pageNumber = 0;
  while ((pageMatch = pagePattern.exec(xml))) {
    pageNumber += 1;
    const textPattern = /<text\b([^>]*)>[\s\S]*?<\/text>/gi;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textPattern.exec(pageMatch[1]))) {
      const x = readNumericAttribute(textMatch[1], "left");
      const top = readNumericAttribute(textMatch[1], "top");
      const width = readNumericAttribute(textMatch[1], "width");
      const height = readNumericAttribute(textMatch[1], "height");
      const font = fonts.get(readStringAttribute(textMatch[1], "font"));
      if (
        x === null ||
        top === null ||
        width === null ||
        height === null ||
        !font
      ) {
        continue;
      }
      spans.push({
        page: pageNumber,
        x,
        top,
        width,
        height,
        fontSize: font.fontSize,
        fontFamily: font.fontFamily,
        color: font.color,
      });
    }
  }
  return spans;
}

function applyPdfTextStyles(
  words: ResignationPdfTextWord[],
  spans: ResignationPdfTextStyleSpan[],
): void {
  for (const word of words) {
    const centerX = (word.xMin + word.xMax) / 2;
    const centerY = (word.yMin + word.yMax) / 2;
    const span = spans
      .filter(
        (item) =>
          item.page === word.page &&
          centerX >= item.x - 1 &&
          centerX <= item.x + item.width + 1 &&
          centerY >= item.top - 1 &&
          centerY <= item.top + item.height + 1,
      )
      .sort((left, right) => left.width - right.width)[0];
    if (!span) continue;
    word.fontSize = span.fontSize;
    word.fontFamily = span.fontFamily;
    word.color = span.color;
  }
}

async function extractResignationPdfJsTextWords(
  sourcePdf: Buffer,
): Promise<ResignationPdfTextWord[]> {
  const cacheKey = createHash("sha1").update(sourcePdf).digest("hex");
  const cached = pdfJsTextLayoutCache.get(cacheKey);
  if (cached) return cached.map((item) => ({ ...item }));

  const pdfJs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfJs.getDocument({
    data: new Uint8Array(sourcePdf),
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;
  const words: ResignationPdfTextWord[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({
        disableNormalization: false,
      });
      for (const rawItem of content.items) {
        if (!("str" in rawItem)) continue;
        const text = rawItem.str.trim();
        if (!text) continue;
        const width = Math.abs(rawItem.width);
        const height =
          Math.abs(rawItem.height) ||
          Math.hypot(rawItem.transform[2], rawItem.transform[3]);
        const x = rawItem.transform[4];
        const top = viewport.height - rawItem.transform[5] - height;
        const style = content.styles[rawItem.fontName];
        words.push({
          page: pageNumber,
          xMin: x,
          yMin: top,
          xMax: x + width,
          yMax: top + height,
          text,
          fontSize: height,
          fontFamily: normalizePdfFontFamily(style?.fontFamily || ""),
          color: "#000000",
        });
      }
    }
  } finally {
    await document.destroy();
  }

  if (pdfJsTextLayoutCache.size >= 30) pdfJsTextLayoutCache.clear();
  pdfJsTextLayoutCache.set(
    cacheKey,
    words.map((item) => ({ ...item })),
  );
  return words;
}

async function extractResignationPdfTextWords(
  sourcePdf: Buffer,
): Promise<ResignationPdfTextWord[]> {
  const cacheKey = createHash("sha1").update(sourcePdf).digest("hex");
  const cached = pdfTextLayoutCache.get(cacheKey);
  if (cached) return cached.map((item) => ({ ...item }));

  const workDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "resignation-pdf-layout-"),
  );
  const pdfPath = path.join(workDir, "template.pdf");
  const htmlPath = path.join(workDir, "template.html");
  const xmlPath = path.join(workDir, "template-layout.xml");
  try {
    fs.writeFileSync(pdfPath, sourcePdf);
    try {
      await execFileAsync(
        "pdftotext",
        ["-bbox", "-enc", "UTF-8", pdfPath, htmlPath],
        { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      );
    } catch (error) {
      console.warn(
        "系统文字定位工具无法读取离职模板，改用 PDF.js:",
        error instanceof Error ? error.message : error,
      );
      const fallbackWords = await extractResignationPdfJsTextWords(sourcePdf);
      if (pdfTextLayoutCache.size >= 30) pdfTextLayoutCache.clear();
      pdfTextLayoutCache.set(
        cacheKey,
        fallbackWords.map((item) => ({ ...item })),
      );
      return fallbackWords;
    }
    const html = fs.readFileSync(htmlPath, "utf8");
    const words: ResignationPdfTextWord[] = [];
    const pagePattern = /<page\b[^>]*>([\s\S]*?)<\/page>/gi;
    let pageMatch: RegExpExecArray | null;
    let pageNumber = 0;
    while ((pageMatch = pagePattern.exec(html))) {
      pageNumber += 1;
      const wordPattern = /<word\b([^>]*)>([\s\S]*?)<\/word>/gi;
      let wordMatch: RegExpExecArray | null;
      while ((wordMatch = wordPattern.exec(pageMatch[1]))) {
        const xMin = readNumericAttribute(wordMatch[1], "xMin");
        const yMin = readNumericAttribute(wordMatch[1], "yMin");
        const xMax = readNumericAttribute(wordMatch[1], "xMax");
        const yMax = readNumericAttribute(wordMatch[1], "yMax");
        if (xMin === null || yMin === null || xMax === null || yMax === null)
          continue;
        words.push({
          page: pageNumber,
          xMin,
          yMin,
          xMax,
          yMax,
          text: decodeXmlText(wordMatch[2]).trim(),
        });
      }
    }
    try {
      await execFileAsync(
        "pdftohtml",
        ["-xml", "-hidden", "-i", "-noframes", "-zoom", "1", pdfPath, xmlPath],
        { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      );
      if (fs.existsSync(xmlPath)) {
        applyPdfTextStyles(
          words,
          parsePdfTextStyleSpans(fs.readFileSync(xmlPath, "utf8")),
        );
      }
    } catch (error) {
      console.warn("读取离职模板字体信息失败，继续使用默认字体:", error);
    }
    if (pdfTextLayoutCache.size >= 30) pdfTextLayoutCache.clear();
    pdfTextLayoutCache.set(
      cacheKey,
      words.map((item) => ({ ...item })),
    );
    return words;
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // 忽略临时文件清理失败
    }
  }
}

function normalizeAnchorText(value: string): string {
  return value.replace(/\s+/g, "");
}

function findLayoutWord(
  words: ResignationPdfTextWord[],
  candidates: string[],
  page?: number,
): ResignationPdfTextWord | undefined {
  const normalizedCandidates = candidates.map(normalizeAnchorText);
  return words.find((item) => {
    if (page !== undefined && item.page !== page) return false;
    const text = normalizeAnchorText(item.text);
    return normalizedCandidates.some((candidate) => text.includes(candidate));
  });
}

function wordsOnSameLine(
  words: ResignationPdfTextWord[],
  anchor: ResignationPdfTextWord,
): ResignationPdfTextWord[] {
  return words
    .filter(
      (item) =>
        item.page === anchor.page && Math.abs(item.yMin - anchor.yMin) <= 2.5,
    )
    .sort((left, right) => left.xMin - right.xMin);
}

function layoutTextLines(
  words: ResignationPdfTextWord[],
  page?: number,
): ResignationPdfTextWord[][] {
  const lines: ResignationPdfTextWord[][] = [];
  const sorted = words
    .filter((item) => page === undefined || item.page === page)
    .sort(
      (left, right) =>
        left.page - right.page ||
        left.yMin - right.yMin ||
        left.xMin - right.xMin,
    );

  for (const word of sorted) {
    const line = lines.find(
      (candidate) =>
        candidate[0]?.page === word.page &&
        Math.abs(candidate[0].yMin - word.yMin) <= 2.5,
    );
    if (line) {
      line.push(word);
      line.sort((left, right) => left.xMin - right.xMin);
    } else {
      lines.push([word]);
    }
  }
  return lines;
}

function findLayoutLine(
  words: ResignationPdfTextWord[],
  candidates: string[],
  page?: number,
): ResignationPdfTextWord[] | undefined {
  const normalizedCandidates = candidates.map(normalizeAnchorText);
  return layoutTextLines(words, page).find((line) => {
    const lineText = line
      .map((item) => normalizeAnchorText(item.text))
      .join("");
    return normalizedCandidates.some((candidate) =>
      lineText.includes(candidate),
    );
  });
}

export function buildDocumentNumberBoxes(
  words: ResignationPdfTextWord[],
  styleWords: ResignationPdfTextWord[] = words,
): ResignationDocumentNumberBox[] {
  const boxes = layoutTextLines(words)
    .map<ResignationDocumentNumberBox | null>((line) => {
      const segments = line.map((item) => ({
        item,
        text: normalizeAnchorText(item.text),
      }));
      const lineText = segments.map((item) => item.text).join("");
      const match = /YULI-CSXXX-LZ\d+/i.exec(lineText);
      if (!match || match.index === undefined) return null;

      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      let cursor = 0;
      const matchedParts: Array<{
        item: ResignationPdfTextWord;
        xMin: number;
        xMax: number;
      }> = [];

      for (const segment of segments) {
        const segmentStart = cursor;
        const segmentEnd = cursor + segment.text.length;
        cursor = segmentEnd;
        const overlapStart = Math.max(matchStart, segmentStart);
        const overlapEnd = Math.min(matchEnd, segmentEnd);
        if (overlapStart >= overlapEnd || !segment.text) continue;

        const fontSize =
          segment.item.fontSize ??
          Math.max(7, Math.min(12, segment.item.yMax - segment.item.yMin));
        const detectedFontFamily =
          segment.item.fontFamily || NUMBER_FONT_FAMILY;
        const fontFamily = /^"?(?:sans-serif|serif|monospace)"?/i.test(
          detectedFontFamily,
        )
          ? NUMBER_FONT_FAMILY
          : detectedFontFamily;
        const context = createCanvas(1, 1).getContext("2d");
        context.font = `${fontSize}px ${fontFamily}`;
        const localStart = overlapStart - segmentStart;
        const localEnd = overlapEnd - segmentStart;
        const totalMeasuredWidth = context.measureText(segment.text).width;
        const actualWidth = segment.item.xMax - segment.item.xMin;
        const widthScale =
          totalMeasuredWidth > 0 ? actualWidth / totalMeasuredWidth : 1;
        matchedParts.push({
          item: segment.item,
          xMin:
            segment.item.xMin +
            context.measureText(segment.text.slice(0, localStart)).width *
              widthScale,
          xMax:
            segment.item.xMin +
            context.measureText(segment.text.slice(0, localEnd)).width *
              widthScale,
        });
      }

      if (matchedParts.length === 0) return null;
      const reference = matchedParts[0].item;
      const styleReference = styleWords.find(
        (candidate) =>
          candidate.page === reference.page &&
          Math.abs(candidate.yMin - reference.yMin) <= 3 &&
          /(?:YULI-|CSXXX|-LZ\d+)/i.test(normalizeAnchorText(candidate.text)),
      );
      const top = Math.min(...matchedParts.map((part) => part.item.yMin));
      const bottom = Math.max(...matchedParts.map((part) => part.item.yMax));
      const textHeight = bottom - top;
      const fontSize =
        styleReference?.fontSize ??
        reference.fontSize ??
        Math.max(7, Math.min(12, textHeight));
      const detectedFontFamily =
        styleReference?.fontFamily ||
        reference.fontFamily ||
        NUMBER_FONT_FAMILY;
      const fontFamily = /^"?(?:sans-serif|serif|monospace)"?/i.test(
        detectedFontFamily,
      )
        ? NUMBER_FONT_FAMILY
        : detectedFontFamily;

      return {
        page: reference.page,
        x: Math.max(0, Math.min(...matchedParts.map((part) => part.xMin))),
        top: Math.max(0, top),
        width: Math.max(
          8,
          Math.max(...matchedParts.map((part) => part.xMax)) -
            Math.min(...matchedParts.map((part) => part.xMin)),
        ),
        height: Math.max(8, textHeight),
        fontSize,
        fontFamily,
        color:
          styleReference?.color &&
          styleReference.color.toUpperCase() !== "#000000"
            ? styleReference.color
            : "#C80000",
      } satisfies ResignationDocumentNumberBox;
    })
    .filter((item): item is ResignationDocumentNumberBox => Boolean(item))
    .sort((left, right) => left.page - right.page);

  return Array.from(new Map(boxes.map((item) => [item.page, item])).values());
}

interface ResignationPdfGlyphPosition {
  text: string;
  x: number;
  top: number;
  width: number;
  height: number;
}

function readOperatorNumbers(value: unknown): number[] {
  if (!value || typeof value !== "object") return [];
  return Array.from(value as ArrayLike<unknown>)
    .map((item) => Number(item))
    .filter(Number.isFinite);
}

async function extractResignationPdfUnderlineSegments(
  sourcePdf: Buffer,
): Promise<ResignationPdfUnderlineSegment[]> {
  const cacheKey = createHash("sha1").update(sourcePdf).digest("hex");
  const cached = pdfUnderlineCache.get(cacheKey);
  if (cached) return cached.map((item) => ({ ...item }));

  const pdfJs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfJs.getDocument({
    data: new Uint8Array(sourcePdf),
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;
  const segments: ResignationPdfUnderlineSegment[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const operatorList = await page.getOperatorList();
      const lineWidthStack: number[] = [];
      let lineWidth = 1;
      let pendingSegments: ResignationPdfUnderlineSegment[] = [];

      const commitPendingSegments = () => {
        for (const segment of pendingSegments) {
          if (
            segment.width < MIN_EDITABLE_UNDERLINE_WIDTH ||
            segment.strokeWidth < MIN_EDITABLE_UNDERLINE_STROKE_WIDTH ||
            segment.strokeWidth > MAX_EDITABLE_UNDERLINE_STROKE_WIDTH
          ) {
            continue;
          }
          const duplicate = segments.some(
            (item) =>
              item.page === segment.page &&
              Math.abs(item.x - segment.x) < 0.5 &&
              Math.abs(item.top - segment.top) < 0.5 &&
              Math.abs(item.width - segment.width) < 0.5,
          );
          if (!duplicate) segments.push(segment);
        }
        pendingSegments = [];
      };

      for (let index = 0; index < operatorList.fnArray.length; index += 1) {
        const operator = operatorList.fnArray[index];
        const rawArguments = operatorList.argsArray[index] as unknown;
        const args = Array.isArray(rawArguments)
          ? rawArguments
          : readOperatorNumbers(rawArguments);

        if (operator === pdfJs.OPS.save) {
          lineWidthStack.push(lineWidth);
          continue;
        }
        if (operator === pdfJs.OPS.restore) {
          lineWidth = lineWidthStack.pop() ?? lineWidth;
          continue;
        }
        if (operator === pdfJs.OPS.setLineWidth) {
          lineWidth = Number(args[0]) || lineWidth;
          continue;
        }
        if (operator === pdfJs.OPS.constructPath) {
          const pathOperations = readOperatorNumbers(args[0]);
          const coordinates = readOperatorNumbers(args[1]);
          if (
            pathOperations.length === 2 &&
            pathOperations[0] === pdfJs.OPS.moveTo &&
            pathOperations[1] === pdfJs.OPS.lineTo &&
            coordinates.length === 4
          ) {
            const [startX, startY, endX, endY] = coordinates;
            if (Math.abs(startY - endY) < 0.5) {
              pendingSegments.push({
                page: pageNumber,
                x: Math.min(startX, endX),
                top: (startY + endY) / 2,
                width: Math.abs(endX - startX),
                strokeWidth: Math.abs(lineWidth),
              });
            }
          }
          continue;
        }
        if (
          operator === pdfJs.OPS.stroke ||
          operator === pdfJs.OPS.closeStroke ||
          operator === pdfJs.OPS.fillStroke ||
          operator === pdfJs.OPS.eoFillStroke
        ) {
          commitPendingSegments();
          continue;
        }
        if (
          operator === pdfJs.OPS.fill ||
          operator === pdfJs.OPS.eoFill ||
          operator === pdfJs.OPS.endPath
        ) {
          pendingSegments = [];
        }
      }
    }
  } finally {
    await document.destroy();
  }

  segments.sort(
    (left, right) =>
      left.page - right.page || left.top - right.top || left.x - right.x,
  );
  if (pdfUnderlineCache.size >= 30) pdfUnderlineCache.clear();
  pdfUnderlineCache.set(
    cacheKey,
    segments.map((item) => ({ ...item })),
  );
  return segments;
}

async function extractDocumentNumberBoxesFromOperators(
  sourcePdf: Buffer,
): Promise<ResignationDocumentNumberBox[]> {
  const pdfJs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfJs.getDocument({
    data: new Uint8Array(sourcePdf),
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;
  const boxes: ResignationDocumentNumberBox[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const operatorList = await page.getOperatorList();
      const glyphs: ResignationPdfGlyphPosition[] = [];
      let fontSize = 0;
      let textMatrix = [1, 0, 0, 1, 0, 0];
      let lineMatrix = [...textMatrix];

      const moveText = (tx: number, ty: number) => {
        const [a, b, c, d] = lineMatrix;
        lineMatrix = [
          a,
          b,
          c,
          d,
          lineMatrix[4] + tx * a + ty * c,
          lineMatrix[5] + tx * b + ty * d,
        ];
        textMatrix = [...lineMatrix];
      };
      const advanceText = (distance: number) => {
        textMatrix[4] += distance * textMatrix[0];
        textMatrix[5] += distance * textMatrix[1];
      };

      for (let index = 0; index < operatorList.fnArray.length; index += 1) {
        const operator = operatorList.fnArray[index];
        const rawArguments = operatorList.argsArray[index] as unknown;
        const args = Array.isArray(rawArguments)
          ? rawArguments
          : readOperatorNumbers(rawArguments);

        if (operator === pdfJs.OPS.beginText) {
          textMatrix = [1, 0, 0, 1, 0, 0];
          lineMatrix = [...textMatrix];
          continue;
        }
        if (operator === pdfJs.OPS.setFont) {
          fontSize = Number(args[1]) || 0;
          continue;
        }
        if (operator === pdfJs.OPS.setTextMatrix) {
          const matrix = args.slice(0, 6).map(Number);
          if (matrix.length === 6 && matrix.every(Number.isFinite)) {
            textMatrix = matrix;
            lineMatrix = [...matrix];
          }
          continue;
        }
        if (
          operator === pdfJs.OPS.moveText ||
          operator === pdfJs.OPS.setLeadingMoveText
        ) {
          moveText(Number(args[0]) || 0, Number(args[1]) || 0);
          continue;
        }
        if (operator !== pdfJs.OPS.showText || !Array.isArray(args[0])) {
          continue;
        }

        for (const rawGlyph of args[0] as unknown[]) {
          if (typeof rawGlyph === "number") {
            advanceText((-rawGlyph / 1_000) * fontSize);
            continue;
          }
          if (!rawGlyph || typeof rawGlyph !== "object") continue;
          const glyph = rawGlyph as { unicode?: unknown; width?: unknown };
          const unicode = String(glyph.unicode || "");
          const glyphWidth = ((Number(glyph.width) || 0) * fontSize) / 1_000;
          const displayWidth = Math.abs(glyphWidth * textMatrix[0]);
          const displayHeight =
            Math.abs(fontSize) * Math.hypot(textMatrix[2], textMatrix[3]);
          const characters = Array.from(unicode);
          const characterWidth =
            characters.length > 0 ? displayWidth / characters.length : 0;
          characters.forEach((character, characterIndex) => {
            glyphs.push({
              text: character,
              x: textMatrix[4] + characterWidth * characterIndex,
              top: textMatrix[5] - displayHeight,
              width: characterWidth,
              height: displayHeight,
            });
          });
          advanceText(glyphWidth);
        }
      }

      const pageText = glyphs.map((item) => item.text).join("");
      const match = /YULI-CSXXX-LZ\d+/i.exec(pageText);
      if (!match || match.index === undefined) continue;
      const documentNumberGlyphs = glyphs.slice(
        match.index,
        match.index + Array.from(match[0]).length,
      );
      if (
        documentNumberGlyphs.length !== Array.from(match[0]).length ||
        documentNumberGlyphs
          .map((item) => item.text)
          .join("")
          .toUpperCase() !== match[0].toUpperCase()
      ) {
        continue;
      }
      const first = documentNumberGlyphs[0];
      const last = documentNumberGlyphs[documentNumberGlyphs.length - 1];
      boxes.push({
        page: pageNumber,
        x: first.x,
        top: Math.min(...documentNumberGlyphs.map((item) => item.top)),
        width: last.x + last.width - first.x,
        height: Math.max(...documentNumberGlyphs.map((item) => item.height)),
        fontSize: Math.max(...documentNumberGlyphs.map((item) => item.height)),
        fontFamily: NUMBER_FONT_FAMILY,
        color: "#C80000",
      });
    }
  } finally {
    await document.destroy();
  }
  return boxes;
}

async function extractResignationDocumentNumberBoxes(
  sourcePdf: Buffer,
  styleWords: ResignationPdfTextWord[],
): Promise<ResignationDocumentNumberBox[]> {
  try {
    const operatorBoxes =
      await extractDocumentNumberBoxesFromOperators(sourcePdf);
    if (operatorBoxes.length > 0) return operatorBoxes;
  } catch (error) {
    console.warn("读取离职模板编号逐字位置失败，使用文字坐标后备:", error);
  }
  try {
    const pdfJsWords = await extractResignationPdfJsTextWords(sourcePdf);
    const boxes = buildDocumentNumberBoxes(pdfJsWords, styleWords);
    if (boxes.length > 0) return boxes;
  } catch (error) {
    console.warn("读取离职模板编号精确位置失败，使用文字坐标后备:", error);
  }
  return buildDocumentNumberBoxes(styleWords);
}

function horizontalOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): number {
  return Math.max(
    0,
    Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart),
  );
}

function horizontalDistanceToUnderline(
  word: ResignationPdfTextWord,
  segment: ResignationPdfUnderlineSegment,
): number {
  const segmentEnd = segment.x + segment.width;
  if (word.xMax < segment.x) return segment.x - word.xMax;
  if (word.xMin > segmentEnd) return word.xMin - segmentEnd;
  return 0;
}

function fieldCoversUnderline(
  fieldItem: ResignationTemplateField,
  segment: ResignationPdfUnderlineSegment,
): boolean {
  if (fieldItem.page !== segment.page) return false;
  const expectedUnderlineTop =
    fieldItem.top + fieldItem.height - UNDERLINE_FIELD_BOTTOM_OVERFLOW;
  if (
    Math.abs(segment.top - expectedUnderlineTop) >
    UNDERLINE_FIELD_MATCH_TOLERANCE
  ) {
    return false;
  }
  const overlap = horizontalOverlap(
    fieldItem.x,
    fieldItem.x + fieldItem.width,
    segment.x,
    segment.x + segment.width,
  );
  return overlap >= Math.min(10, segment.width * 0.2);
}

function wordOccupiesUnderline(
  word: ResignationPdfTextWord,
  segment: ResignationPdfUnderlineSegment,
): boolean {
  if (word.page !== segment.page) return false;
  const baselineGap = segment.top - word.yMax;
  if (baselineGap < -2 || baselineGap > 8) return false;
  return (
    horizontalOverlap(
      word.xMin,
      word.xMax,
      segment.x,
      segment.x + segment.width,
    ) > 2
  );
}

function meaningfulUnderlineText(
  words: ResignationPdfTextWord[],
  segment: ResignationPdfUnderlineSegment,
): string {
  return normalizeAnchorText(
    words
      .filter((word) => wordOccupiesUnderline(word, segment))
      .map((word) => word.text)
      .join(""),
  ).replace(/[：:（）()，,。.;；、]/g, "");
}

function nearestUnderlineTextReference(
  words: ResignationPdfTextWord[],
  segment: ResignationPdfUnderlineSegment,
): ResignationPdfTextWord | undefined {
  const pageWords = words.filter((word) => word.page === segment.page);
  const sameLineWords = pageWords.filter(
    (word) => Math.abs(segment.top - word.yMax) <= 10,
  );
  const candidates = sameLineWords.length > 0 ? sameLineWords : pageWords;
  return candidates.sort((left, right) => {
    const leftVerticalDistance = Math.abs(segment.top - left.yMax);
    const rightVerticalDistance = Math.abs(segment.top - right.yMax);
    if (leftVerticalDistance !== rightVerticalDistance) {
      return leftVerticalDistance - rightVerticalDistance;
    }
    return (
      horizontalDistanceToUnderline(left, segment) -
      horizontalDistanceToUnderline(right, segment)
    );
  })[0];
}

function buildUnderlineFieldKey(
  segment: ResignationPdfUnderlineSegment,
): string {
  return [
    "underline",
    `p${segment.page}`,
    `x${Math.round(segment.x * 10)}`,
    `y${Math.round(segment.top * 10)}`,
    `w${Math.round(segment.width * 10)}`,
  ].join("_");
}

export function buildResignationBlankUnderlineFields(
  segments: ResignationPdfUnderlineSegment[],
  words: ResignationPdfTextWord[],
  sourceFields: ResignationTemplateField[],
  fieldOverrides: Record<string, string> = {},
): ResignationTemplateField[] {
  const fields: ResignationTemplateField[] = [];
  for (const segment of segments) {
    const sourceText = meaningfulUnderlineText(words, segment);
    if (
      segment.x < 0 ||
      segment.top < 0 ||
      segment.top > TEMPLATE_HEIGHT ||
      segment.x + segment.width > TEMPLATE_WIDTH + 5 ||
      sourceFields.some((fieldItem) => fieldCoversUnderline(fieldItem, segment))
    ) {
      continue;
    }

    const reference = nearestUnderlineTextReference(words, segment);
    const referenceHeight = reference
      ? Math.max(0, reference.yMax - reference.yMin)
      : AUTO_FILL_FONT_SIZE;
    const fontSize = Math.max(
      MIN_TEMPLATE_FONT_SIZE,
      Math.min(
        MAX_TEMPLATE_FONT_SIZE,
        Number(reference?.fontSize) || referenceHeight || AUTO_FILL_FONT_SIZE,
      ),
    );
    const height = Math.max(
      AUTO_FILL_MIN_HEIGHT,
      fontSize + AUTO_FILL_VERTICAL_MARGIN * 2,
    );
    const key = buildUnderlineFieldKey(segment);
    fields.push({
      key,
      label: sourceText
        ? `第${segment.page}页原有下划线内容`
        : `第${segment.page}页空白下划线`,
      page: segment.page,
      x: segment.x,
      top: Math.max(0, segment.top - height + UNDERLINE_FIELD_BOTTOM_OVERFLOW),
      width: segment.width,
      height,
      fontSize,
      align: sourceText ? "left" : "center",
      fontFamily: reference?.fontFamily || BODY_FONT_FAMILY,
      color: reference?.color || "#000000",
      paddingX: sourceText ? 0 : AUTO_FILL_HORIZONTAL_MARGIN,
      replaceSourceText: Boolean(sourceText),
      sourceText: sourceText || undefined,
      value: Object.prototype.hasOwnProperty.call(fieldOverrides, key)
        ? fieldOverrides[key]
        : sourceText,
    });
  }
  return fields;
}

export function alignResignationTemplateFieldsToTextWords(
  words: ResignationPdfTextWord[],
  templateType: ResignationArchiveType,
  sourceFields: ResignationTemplateField[],
): ResignationTemplateField[] {
  const fields = sourceFields.map((item) => ({ ...item }));
  if (words.length === 0) return fields;
  const fieldByKey = new Map(fields.map((item) => [item.key, item]));
  const updateField = (
    key: string,
    patch: Partial<
      Pick<
        ResignationTemplateField,
        | "page"
        | "x"
        | "top"
        | "width"
        | "height"
        | "fontSize"
        | "fontFamily"
        | "color"
      >
    >,
  ) => {
    const item = fieldByKey.get(key);
    if (item) Object.assign(item, patch);
  };
  const styleFromReference = (reference: ResignationPdfTextWord) => {
    const textHeight = reference.yMax - reference.yMin;
    const referenceFontSize = Number(reference.fontSize) || textHeight;
    return {
      top: Math.max(
        0,
        reference.yMin -
          AUTO_FILL_VERTICAL_MARGIN -
          AUTO_FILL_TEMPLATE_BASELINE_GAP,
      ),
      height: Math.max(
        AUTO_FILL_MIN_HEIGHT,
        textHeight + AUTO_FILL_VERTICAL_MARGIN * 2,
      ),
      fontSize: Math.max(
        MIN_TEMPLATE_FONT_SIZE,
        Math.min(MAX_TEMPLATE_FONT_SIZE, referenceFontSize),
      ),
      fontFamily: reference.fontFamily || BODY_FONT_FAMILY,
      color: reference.color || "#000000",
    };
  };
  const placeAfterLabel = (
    key: string,
    label: ResignationPdfTextWord | undefined,
    rightBoundary?: ResignationPdfTextWord,
  ) => {
    if (!label) return;
    const horizontalGap = 1.5;
    const x = label.xMax + horizontalGap;
    updateField(key, {
      page: label.page,
      x,
      ...styleFromReference(label),
      ...(rightBoundary
        ? { width: Math.max(12, rightBoundary.xMin - x - horizontalGap) }
        : {}),
    });
  };
  const placeInSlot = (
    key: string,
    leftBoundary: ResignationPdfTextWord | undefined,
    rightBoundary: ResignationPdfTextWord | undefined,
  ) => {
    if (!leftBoundary || !rightBoundary) return;
    placeAfterLabel(key, leftBoundary, rightBoundary);
  };
  const exactOnLine = (
    line: ResignationPdfTextWord[],
    value: string,
    occurrence = 0,
  ) =>
    line.filter((item) => normalizeAnchorText(item.text) === value)[occurrence];
  const containingOnLine = (
    line: ResignationPdfTextWord[],
    value: string,
    occurrence = 0,
  ) =>
    line.filter((item) => normalizeAnchorText(item.text).includes(value))[
      occurrence
    ];

  if (templateType === "termination_agreement") {
    const employeeLine = findLayoutLine(words, ["身份证号"]);
    if (employeeLine) {
      const employeeLabel = containingOnLine(employeeLine, "乙方");
      const idLabel = containingOnLine(employeeLine, "身份证号");
      const openParenthesis =
        exactOnLine(employeeLine, "（") ||
        containingOnLine(employeeLine, "（身份证号");
      const idSeparator =
        exactOnLine(employeeLine, "：", 1) ||
        exactOnLine(employeeLine, "：") ||
        idLabel;
      const closeParenthesis =
        exactOnLine(employeeLine, "）") || containingOnLine(employeeLine, "）");
      placeInSlot("employeeName", employeeLabel, openParenthesis || idLabel);
      if (closeParenthesis) {
        placeInSlot("idNumber", idSeparator, closeParenthesis);
      } else {
        placeAfterLabel("idNumber", idSeparator);
      }
    }

    const contractLine = findLayoutLine(words, ["甲乙双方于"]);
    if (contractLine) {
      const contractAnchor = containingOnLine(contractLine, "甲乙双方于");
      const year = exactOnLine(contractLine, "年");
      const month = exactOnLine(contractLine, "月");
      const day = containingOnLine(contractLine, "日签订");
      placeInSlot("contractYear", contractAnchor, year);
      placeInSlot("contractMonth", year, month);
      placeInSlot("contractDay", month, day);
    }

    const resignLine = findLayoutLine(words, ["甲方与乙方自"]);
    if (resignLine) {
      const resignAnchor = containingOnLine(resignLine, "甲方与乙方自");
      const year = exactOnLine(resignLine, "年");
      const month = exactOnLine(resignLine, "月");
      const day = containingOnLine(resignLine, "日起");
      placeInSlot("resignYear", resignAnchor, year);
      placeInSlot("resignMonth", year, month);
      placeInSlot("resignDay", month, day);
    }
  } else if (templateType === "employee_handover_form") {
    const mainTitle = findLayoutWord(words, ["员工离职交接单"]);
    const mainPage = mainTitle?.page;
    const mainLabels: Array<[string, string]> = [
      ["employeeName", "员工姓名"],
      ["department", "所属部门"],
      ["position", "岗位："],
      ["lastWorkDate", "最后工作日"],
    ];
    for (const [key, label] of mainLabels) {
      placeAfterLabel(key, findLayoutWord(words, [label], mainPage));
    }
    const terminationLabel = findLayoutWord(
      words,
      ["劳动关系解除日期"],
      mainPage,
    );
    if (terminationLabel) {
      const separator = wordsOnSameLine(words, terminationLabel).find(
        (item) =>
          item.xMin >= terminationLabel.xMax - 1 &&
          normalizeAnchorText(item.text) === "：",
      );
      placeAfterLabel("terminationDate", separator || terminationLabel);
    }

    const attachmentFields: Array<[string, string]> = [
      ["projectHandoverEmployeeName", "项目交接表"],
      ["customerHandoverEmployeeName", "客户交接表"],
      ["assetHandoverEmployeeName", "固定资产交接表"],
    ];
    for (const [key, title] of attachmentFields) {
      const exactTitles = new Set(
        [`《${title}》`, title].map(normalizeAnchorText),
      );
      const attachmentTitle = words
        .filter(
          (item) =>
            item.page !== mainPage &&
            exactTitles.has(normalizeAnchorText(item.text)),
        )
        .sort(
          (left, right) =>
            (right.fontSize || 0) - (left.fontSize || 0) ||
            left.page - right.page,
        )[0];
      if (!attachmentTitle) continue;
      placeAfterLabel(
        key,
        findLayoutWord(words, ["员工姓名"], attachmentTitle.page),
      );
    }
  } else if (
    templateType === "settlement_confirmation" ||
    templateType === "compensation_agreement"
  ) {
    const employeeLine = findLayoutLine(words, ["本公司经与"]);
    if (employeeLine) {
      const employeeAnchor = containingOnLine(employeeLine, "本公司经与");
      const idLabel = containingOnLine(employeeLine, "身份证号");
      const openParenthesis =
        exactOnLine(employeeLine, "（") ||
        containingOnLine(employeeLine, "（身份证号");
      const idSeparator = exactOnLine(employeeLine, "：") || idLabel;
      const closeParenthesis =
        exactOnLine(employeeLine, "）") || containingOnLine(employeeLine, "）");
      placeInSlot("employeeName", employeeAnchor, openParenthesis || idLabel);
      if (closeParenthesis) {
        placeInSlot("idNumber", idSeparator, closeParenthesis);
      } else {
        placeAfterLabel("idNumber", idSeparator);
      }
    }

    if (templateType === "compensation_agreement") {
      const tenureDateLine = findLayoutLine(words, ["该员工自"]);
      if (tenureDateLine) {
        const tenureDateAnchor =
          containingOnLine(tenureDateLine, "员工自") ||
          containingOnLine(tenureDateLine, "该");
        const years = tenureDateLine.filter(
          (item) => normalizeAnchorText(item.text) === "年",
        );
        const months = tenureDateLine.filter(
          (item) => normalizeAnchorText(item.text) === "月",
        );
        const startDay = containingOnLine(tenureDateLine, "日至");
        const endDay = containingOnLine(tenureDateLine, "日在本");
        placeInSlot("startYear", tenureDateAnchor, years[0]);
        placeInSlot("startMonth", years[0], months[0]);
        placeInSlot("startDay", months[0], startDay);
        placeInSlot("endYear", startDay, years[1]);
        placeInSlot("endMonth", years[1], months[1]);
        placeInSlot("endDay", months[1], endDay);
      }

      const tenureLine = findLayoutLine(words, ["工作年限共计"]);
      if (tenureLine) {
        const tenureAnchor = containingOnLine(tenureLine, "工作年限共计");
        const yearLabel = containingOnLine(tenureLine, "年零");
        const monthLabel = containingOnLine(tenureLine, "个月");
        placeInSlot("tenureYears", tenureAnchor, yearLabel);
        placeInSlot("tenureMonths", yearLabel, monthLabel);
      }
    }
  } else if (templateType === "resignation_certificate") {
    const employeeLine = findLayoutLine(words, ["兹有我司员工"]);
    if (employeeLine) {
      const employeeAnchor = containingOnLine(employeeLine, "员工");
      const idLabel = containingOnLine(employeeLine, "身份证号");
      const openParenthesis =
        exactOnLine(employeeLine, "（") ||
        containingOnLine(employeeLine, "（身份证号");
      const idSeparator = exactOnLine(employeeLine, "：") || idLabel;
      const closeParenthesis =
        exactOnLine(employeeLine, "）") || containingOnLine(employeeLine, "）");
      placeInSlot("employeeName", employeeAnchor, openParenthesis || idLabel);
      if (closeParenthesis) {
        placeInSlot("idNumber", idSeparator, closeParenthesis);
      } else {
        placeAfterLabel("idNumber", idSeparator);
      }
    }

    const hireLine = findLayoutLine(words, ["正式入职我司"]);
    if (hireLine) {
      const hireAnchor =
        exactOnLine(hireLine, "于") || containingOnLine(hireLine, "于");
      const year = exactOnLine(hireLine, "年");
      const month = exactOnLine(hireLine, "月");
      const day =
        exactOnLine(hireLine, "日") ||
        containingOnLine(hireLine, "日正式入职我司");
      const positionStart = containingOnLine(hireLine, "任职");
      const positionEnd = containingOnLine(hireLine, "岗位");
      placeInSlot("hireYear", hireAnchor, year);
      placeInSlot("hireMonth", year, month);
      placeInSlot("hireDay", month, day);
      placeInSlot("position", positionStart, positionEnd);
    }

    const resignLine = findLayoutLine(words, ["双方劳动关系已于", "正式解除"]);
    if (resignLine) {
      const resignAnchor =
        exactOnLine(resignLine, "于") || containingOnLine(resignLine, "已于");
      const year = exactOnLine(resignLine, "年");
      const month = exactOnLine(resignLine, "月");
      const day =
        exactOnLine(resignLine, "日") ||
        containingOnLine(resignLine, "日正式解除");
      placeInSlot("resignYear", resignAnchor, year);
      placeInSlot("resignMonth", year, month);
      placeInSlot("resignDay", month, day);
    }
  }

  return fields;
}

export async function alignResignationTemplateEditorStateToPdf(
  sourcePdf: Buffer,
  templateType: ResignationArchiveType,
  editorState: ResignationTemplateEditorState,
  fieldOverrides: Record<string, string> = {},
  fieldAlignments: Record<string, ResignationTemplateTextAlign> = {},
): Promise<ResignationTemplateEditorState> {
  let words: ResignationPdfTextWord[] = [];
  try {
    words = await extractResignationPdfTextWords(sourcePdf);
  } catch (error) {
    console.warn("读取离职模板文字位置失败，使用默认位置:", error);
  }

  const alignedFields =
    words.length > 0
      ? alignResignationTemplateFieldsToTextWords(
          words,
          templateType,
          editorState.fields,
        )
      : editorState.fields;
  let underlineSegments: ResignationPdfUnderlineSegment[] = [];
  try {
    underlineSegments = await extractResignationPdfUnderlineSegments(sourcePdf);
  } catch (error) {
    console.warn("读取离职模板空白下划线失败，继续使用预设字段:", error);
  }
  const blankUnderlineFields = buildResignationBlankUnderlineFields(
    underlineSegments,
    words,
    alignedFields,
    fieldOverrides,
  );
  const fields = [...alignedFields, ...blankUnderlineFields].map((item) => ({
    ...item,
    align: fieldAlignments[item.key] || item.align,
    value: Object.prototype.hasOwnProperty.call(fieldOverrides, item.key)
      ? fieldOverrides[item.key]
      : item.value,
  }));
  const documentNumberBoxes = await extractResignationDocumentNumberBoxes(
    sourcePdf,
    words,
  );
  const finalDocumentNumber = normalizeAnchorText(
    editorState.documentNumber,
  ).replace(/^编号[:：]?/i, "");
  const documentNumberAlreadyEmbedded = words.some((item) =>
    normalizeAnchorText(item.text)
      .toUpperCase()
      .includes(finalDocumentNumber.toUpperCase()),
  );
  return {
    ...editorState,
    documentNumberBoxes: documentNumberAlreadyEmbedded
      ? []
      : documentNumberBoxes.length > 0
        ? documentNumberBoxes
        : editorState.documentNumberBoxes,
    fields,
  };
}

export function parseResignationOverlayDraft(
  value: string | null | undefined,
): ResignationTemplateOverlayDraft {
  if (!value) {
    return {
      version: 1,
      fieldOverrides: {},
      fieldAlignments: {},
      customItems: [],
    };
  }
  try {
    const parsed = JSON.parse(
      value,
    ) as Partial<ResignationTemplateOverlayDraft>;
    return normalizeResignationOverlayDraft(parsed);
  } catch {
    return {
      version: 1,
      fieldOverrides: {},
      fieldAlignments: {},
      customItems: [],
    };
  }
}

export function normalizeResignationOverlayDraft(
  value: Partial<ResignationTemplateOverlayDraft> | null | undefined,
): ResignationTemplateOverlayDraft {
  const rawOverrides = value?.fieldOverrides;
  const fieldOverrides: Record<string, string> = {};
  if (
    rawOverrides &&
    typeof rawOverrides === "object" &&
    !Array.isArray(rawOverrides)
  ) {
    for (const [key, rawValue] of Object.entries(rawOverrides)) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) continue;
      const text = String(rawValue ?? "");
      if (text.length > MAX_FIELD_VALUE_LENGTH) {
        throw new Error("模板字段内容过长");
      }
      fieldOverrides[key] = text;
    }
  }

  const rawAlignments = value?.fieldAlignments;
  const fieldAlignments: Record<string, ResignationTemplateTextAlign> = {};
  if (
    rawAlignments &&
    typeof rawAlignments === "object" &&
    !Array.isArray(rawAlignments)
  ) {
    for (const [key, rawValue] of Object.entries(rawAlignments)) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(key)) continue;
      if (
        rawValue === "left" ||
        rawValue === "center" ||
        rawValue === "right"
      ) {
        fieldAlignments[key] = rawValue;
      }
    }
  }

  const rawItems = Array.isArray(value?.customItems) ? value.customItems : [];
  if (rawItems.length > MAX_CUSTOM_ITEMS)
    throw new Error("自定义填写项数量过多");
  const customItems: ResignationCustomTextItem[] = rawItems.map(
    (rawItem, index) => {
      const item = rawItem as Partial<ResignationCustomTextItem>;
      const number = (candidate: unknown, fallback: number) => {
        const parsed = Number(candidate);
        return Number.isFinite(parsed) ? parsed : fallback;
      };
      const text = String(item.value ?? "");
      if (text.length > MAX_FIELD_VALUE_LENGTH)
        throw new Error("自定义填写内容过长");
      const align: ResignationCustomTextItem["align"] =
        item.align === "left" || item.align === "right" ? item.align : "center";
      return {
        id: /^[A-Za-z0-9_-]{1,100}$/.test(String(item.id || ""))
          ? String(item.id)
          : `custom-${index + 1}`,
        page: Math.max(1, Math.min(100, Math.round(number(item.page, 1)))),
        x: Math.max(0, Math.min(TEMPLATE_WIDTH - 12, number(item.x, 80))),
        top: Math.max(0, Math.min(TEMPLATE_HEIGHT - 12, number(item.top, 120))),
        width: Math.max(18, Math.min(TEMPLATE_WIDTH, number(item.width, 120))),
        height: Math.max(
          14,
          Math.min(TEMPLATE_HEIGHT, number(item.height, 26)),
        ),
        fontSize: Math.max(
          MIN_TEMPLATE_FONT_SIZE,
          Math.min(
            MAX_TEMPLATE_FONT_SIZE,
            number(item.fontSize, AUTO_FILL_FONT_SIZE),
          ),
        ),
        align,
        color:
          item.color === "#C80000"
            ? ("#C80000" as const)
            : ("#000000" as const),
        value: text,
      };
    },
  );
  return { version: 1, fieldOverrides, fieldAlignments, customItems };
}

export function buildResignationFieldOverrides(
  fields: ResignationTemplateField[],
  submittedValues: Record<string, unknown>,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const item of fields) {
    if (!Object.prototype.hasOwnProperty.call(submittedValues, item.key))
      continue;
    const submitted = String(submittedValues[item.key] ?? "");
    if (submitted.length > MAX_FIELD_VALUE_LENGTH)
      throw new Error("模板字段内容过长");
    if (submitted !== item.value) overrides[item.key] = submitted;
  }
  return overrides;
}

export function buildResignationFieldAlignments(
  fields: ResignationTemplateField[],
  submittedValues: Record<string, unknown>,
): Record<string, ResignationTemplateTextAlign> {
  const alignments: Record<string, ResignationTemplateTextAlign> = {};
  for (const item of fields) {
    if (!Object.prototype.hasOwnProperty.call(submittedValues, item.key))
      continue;
    const submitted = submittedValues[item.key];
    if (
      submitted !== "left" &&
      submitted !== "center" &&
      submitted !== "right"
    ) {
      throw new Error("模板字段文字方向不正确");
    }
    if (submitted !== item.align) alignments[item.key] = submitted;
  }
  return alignments;
}

async function readDeclaredDocxPageCount(
  sourcePath: string,
): Promise<number | null> {
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(sourcePath));
    const appProperties = zip.file("docProps/app.xml");
    if (!appProperties) return null;
    const xml = await appProperties.async("string");
    const pageCount = Number(xml.match(/<Pages>(\d+)<\/Pages>/i)?.[1] || 0);
    return Number.isInteger(pageCount) && pageCount > 0 && pageCount <= 100
      ? pageCount
      : null;
  } catch {
    return null;
  }
}

export function removeTrailingEmptyDocxParagraphs(xml: string): string {
  const sectionIndex = xml.lastIndexOf("<w:sectPr");
  if (sectionIndex < 0) return xml;

  let body = xml.slice(0, sectionIndex);
  const section = xml.slice(sectionIndex);
  let changed = false;
  while (true) {
    const paragraphStarts = Array.from(body.matchAll(/<w:p(?:\s[^>]*)?>/gi));
    const paragraphStart = paragraphStarts.at(-1)?.index;
    if (paragraphStart === undefined) break;
    const paragraph = body
      .slice(paragraphStart)
      .match(/^<w:p\b[^>]*>([\s\S]*?)<\/w:p>\s*$/i);
    if (!paragraph) break;
    const content = paragraph[1];
    const text = Array.from(content.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi))
      .map((match) => decodeXmlText(match[1]))
      .join("")
      .replace(/[\s\u3000]+/g, "");
    const hasNonTextContent =
      /<w:(?:br|drawing|object|pict|fldChar|instrText|sym|tab)\b/i.test(
        content,
      );
    if (text || hasNonTextContent) break;
    body = body.slice(0, paragraphStart);
    changed = true;
  }
  return changed ? `${body}${section}` : xml;
}

async function buildLayoutStableResignationDocx(
  sourcePath: string,
): Promise<Buffer> {
  const source = fs.readFileSync(sourcePath);
  try {
    const zip = await JSZip.loadAsync(source);
    const documentEntry = zip.file("word/document.xml");
    if (!documentEntry) return source;
    const originalXml = await documentEntry.async("string");
    const normalizedXml = removeTrailingEmptyDocxParagraphs(originalXml);
    if (normalizedXml === originalXml) return source;
    zip.file("word/document.xml", normalizedXml);
    return await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
  } catch {
    return source;
  }
}

async function updateConvertedFooterPageCount(
  document: PDFDocument,
  words: ResignationPdfTextWord[],
  pageCount: number,
): Promise<void> {
  const pages = document.getPages();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const footerNumbers = words
      .filter(
        (item) =>
          item.page === pageIndex + 1 &&
          item.yMin >= TEMPLATE_HEIGHT - 100 &&
          /^\d+$/.test(item.text.trim()),
      )
      .sort((left, right) => left.xMin - right.xMin);
    const totalPageWord = footerNumbers.at(-1);
    if (!totalPageWord || totalPageWord.text.trim() === String(pageCount))
      continue;
    await drawText(document, pages[pageIndex], String(pageCount), {
      x: Math.max(0, totalPageWord.xMin - 1.5),
      top: Math.max(0, totalPageWord.yMin - 1.5),
      width: Math.max(9, totalPageWord.xMax - totalPageWord.xMin + 3),
      height: Math.max(12, totalPageWord.yMax - totalPageWord.yMin + 3),
      fontSize: totalPageWord.fontSize || 8,
      align: "center",
      color: totalPageWord.color || "#4472C4",
      background: "#FFFFFF",
      fontFamily: totalPageWord.fontFamily || BODY_FONT_FAMILY,
      padding: 0,
      maxLines: 1,
      preserveFontHeight: true,
    });
  }
}

async function removeConvertedTrailingBlankPages(
  convertedPdf: Buffer,
  declaredPageCount: number | null,
): Promise<Buffer> {
  if (!declaredPageCount) return convertedPdf;
  const document = await PDFDocument.load(convertedPdf, {
    ignoreEncryption: true,
  });
  if (document.getPageCount() <= declaredPageCount) return convertedPdf;

  let words: ResignationPdfTextWord[];
  try {
    words = await extractResignationPdfTextWords(convertedPdf);
  } catch {
    return convertedPdf;
  }

  let pageCount = document.getPageCount();
  let changed = false;
  while (
    pageCount > declaredPageCount &&
    !words.some(
      (item) =>
        item.page === pageCount &&
        item.text.trim() &&
        item.yMin >= 40 &&
        item.yMax <= TEMPLATE_HEIGHT - 100,
    )
  ) {
    document.removePage(pageCount - 1);
    pageCount -= 1;
    changed = true;
  }
  if (!changed) return convertedPdf;
  await updateConvertedFooterPageCount(document, words, pageCount);
  return Buffer.from(await document.save());
}

export async function loadResignationTemplatePdfBuffer(
  sourcePath: string,
): Promise<Buffer> {
  const stat = fs.statSync(sourcePath);
  const cacheKey = `${sourcePath}:${stat.size}:${stat.mtimeMs}`;
  const cached = pdfCache.get(cacheKey);
  if (cached) return Buffer.from(cached);

  let result: Buffer;
  if (path.extname(sourcePath).toLowerCase() === ".pdf") {
    result = fs.readFileSync(sourcePath);
  } else {
    result = await runSerializedConversion(async () => {
      const workDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "resignation-template-pdf-"),
      );
      const userInstallDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "soffice-resignation-pdf-"),
      );
      const copiedSource = path.join(workDir, "source.docx");
      const declaredPageCount = await readDeclaredDocxPageCount(sourcePath);
      fs.writeFileSync(
        copiedSource,
        await buildLayoutStableResignationDocx(sourcePath),
      );
      try {
        await execFileAsync(
          "soffice",
          [
            "--headless",
            "--nologo",
            "--nofirststartwizard",
            `-env:UserInstallation=${pathToFileURL(userInstallDir).href}`,
            "--convert-to",
            "pdf",
            "--outdir",
            workDir,
            copiedSource,
          ],
          { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 },
        );
        const outputPath = path.join(workDir, "source.pdf");
        if (!fs.existsSync(outputPath))
          throw new Error("离职模板未能转换为 PDF");
        return await removeConvertedTrailingBlankPages(
          fs.readFileSync(outputPath),
          declaredPageCount,
        );
      } finally {
        try {
          fs.rmSync(workDir, { recursive: true, force: true });
        } catch {
          // 忽略临时文件清理失败
        }
        try {
          fs.rmSync(userInstallDir, { recursive: true, force: true });
        } catch {
          // 忽略临时文件清理失败
        }
      }
    });
  }

  const document = await PDFDocument.load(result, { ignoreEncryption: true });
  if (document.getPageCount() === 0) throw new Error("离职模板没有可用页面");
  pdfCache.clear();
  pdfCache.set(cacheKey, Buffer.from(result));
  return result;
}

function splitTextLines(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of Array.from(paragraph)) {
      const candidate = `${line}${character}`;
      if (line && context.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function calculateResignationTextInkLayout(
  advanceWidth: number,
  actualBoundingBoxLeft: number,
  actualBoundingBoxRight: number,
): { inkLeft: number; width: number } {
  const safeAdvanceWidth = Number.isFinite(advanceWidth)
    ? Math.max(0, advanceWidth)
    : 0;
  const inkLeft = Number.isFinite(actualBoundingBoxLeft)
    ? Math.max(0, actualBoundingBoxLeft)
    : 0;
  const inkRight = Number.isFinite(actualBoundingBoxRight)
    ? Math.max(safeAdvanceWidth, actualBoundingBoxRight)
    : safeAdvanceWidth;
  return {
    inkLeft,
    width: Math.max(safeAdvanceWidth, inkLeft + inkRight),
  };
}

function renderTextPng(text: string, box: TextBox): Buffer {
  const canvas = createCanvas(
    Math.max(1, Math.ceil(box.width * RASTER_SCALE)),
    Math.max(1, Math.ceil(box.height * RASTER_SCALE)),
  );
  const context = canvas.getContext("2d");
  if (box.background) {
    context.fillStyle = box.background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const paddingX = (box.paddingX ?? box.padding ?? 2) * RASTER_SCALE;
  const paddingY = (box.paddingY ?? box.padding ?? 2) * RASTER_SCALE;
  const glyphSafetyX = Math.max(0, box.glyphSafetyX || 0) * RASTER_SCALE;
  const contentWidth = Math.max(1, canvas.width - paddingX * 2);
  const fitContentWidth = Math.max(1, contentWidth - glyphSafetyX * 2);
  const contentHeight = Math.max(1, canvas.height - paddingY * 2);
  let fontSize = box.fontSize * RASTER_SCALE;
  const applyFont = () => {
    context.font = `${fontSize}px ${box.fontFamily || BODY_FONT_FAMILY}`;
  };
  applyFont();
  while (
    (!box.preserveFontHeight || box.fitProportionally) &&
    fontSize > 7 * RASTER_SCALE &&
    !text.includes("\n") &&
    context.measureText(text).width > fitContentWidth
  ) {
    fontSize -= 0.35 * RASTER_SCALE;
    applyFont();
  }

  context.fillStyle = box.color || "#000000";
  context.textBaseline = "alphabetic";
  const lineHeight = Math.max(
    fontSize * 1.18,
    box.fontSize * 1.15 * RASTER_SCALE,
  );
  const lines = (
    box.preserveFontHeight
      ? text.replace(/\r\n/g, "\n").split("\n")
      : splitTextLines(context, text, fitContentWidth)
  ).slice(0, box.maxLines || 20);
  const fontMetrics = context.measureText("国Ag0123456789");
  const fontAscent = fontMetrics.actualBoundingBoxAscent || fontSize * 0.82;
  const fontDescent = fontMetrics.actualBoundingBoxDescent || fontSize * 0.18;
  const fontGlyphHeight = Math.max(fontSize, fontAscent + fontDescent);
  const totalHeight =
    lines.length > 0
      ? fontGlyphHeight + Math.max(0, lines.length - 1) * lineHeight
      : 0;
  const startY = paddingY + Math.max(0, (contentHeight - totalHeight) / 2);
  lines.forEach((line, index) => {
    const metrics = context.measureText(line);
    const inkLayout = calculateResignationTextInkLayout(
      metrics.width,
      metrics.actualBoundingBoxLeft,
      metrics.actualBoundingBoxRight,
    );
    const { inkLeft, width: measured } = inkLayout;
    const linePadding = paddingX === 0 ? 0 : RASTER_SCALE;
    const sourceWidth = measured + linePadding * 2;
    const horizontalScale =
      box.preserveFontHeight && sourceWidth > fitContentWidth
        ? fitContentWidth / sourceWidth
        : 1;
    const displayedWidth =
      horizontalScale < 1 ? sourceWidth * horizontalScale : measured;
    let x = paddingX + glyphSafetyX;
    if (box.align === "center") {
      x = paddingX + Math.max(0, (contentWidth - displayedWidth) / 2);
    }
    if (box.align === "right") {
      x =
        paddingX +
        Math.max(glyphSafetyX, contentWidth - displayedWidth - glyphSafetyX);
    }
    const baselineY = startY + index * lineHeight + fontAscent;
    if (horizontalScale < 1) {
      const lineCanvas = createCanvas(
        Math.max(1, Math.ceil(sourceWidth)),
        canvas.height,
      );
      const lineContext = lineCanvas.getContext("2d");
      lineContext.font = context.font;
      lineContext.fillStyle = context.fillStyle;
      lineContext.textBaseline = "alphabetic";
      lineContext.fillText(line, linePadding + inkLeft, baselineY);
      context.drawImage(
        lineCanvas,
        0,
        0,
        lineCanvas.width,
        lineCanvas.height,
        x,
        0,
        displayedWidth,
        canvas.height,
      );
      return;
    }
    context.fillText(line, x + inkLeft, baselineY);
  });
  return canvas.toBuffer("image/png");
}

async function drawText(
  document: PDFDocument,
  page: PDFPage,
  text: string,
  box: TextBox,
): Promise<void> {
  if (!text && !box.background) return;
  const image = await document.embedPng(renderTextPng(text, box));
  const scaleX = page.getWidth() / TEMPLATE_WIDTH;
  const scaleY = page.getHeight() / TEMPLATE_HEIGHT;
  page.drawImage(image, {
    x: box.x * scaleX,
    y: page.getHeight() - (box.top + box.height) * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  });
}

export async function renderResignationTemplatePdf(
  sourcePdf: Buffer,
  editorState: ResignationTemplateEditorState,
  customItems: ResignationCustomTextItem[],
): Promise<Buffer> {
  const document = await PDFDocument.load(sourcePdf, {
    ignoreEncryption: true,
  });
  const pages = document.getPages();
  const documentNumberCode =
    editorState.documentNumber.replace(/^编号[:：]?\s*/i, "").trim() ||
    "YULI-CSXXX-LZ1";
  const numberBoxesByPage = new Map(
    editorState.documentNumberBoxes.map((item) => [item.page, item]),
  );

  if (editorState.documentNumberBoxes.length > 0) {
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const page = pages[pageIndex];
      const numberBox = numberBoxesByPage.get(pageIndex + 1);
      if (!numberBox) continue;
      await drawText(document, page, documentNumberCode, {
        x: numberBox.x,
        top: numberBox.top,
        width: numberBox.width,
        height: numberBox.height,
        fontSize: numberBox.fontSize,
        align: "left",
        color: numberBox.color || "#C80000",
        background: "#FFFFFF",
        fontFamily: numberBox.fontFamily || NUMBER_FONT_FAMILY,
        padding: 0,
        maxLines: 1,
        preserveFontHeight: true,
      });
    }
  }

  for (const item of editorState.fields) {
    const page = pages[item.page - 1];
    if (!page) continue;
    if (item.replaceSourceText && item.value === item.sourceText) continue;
    if (item.replaceSourceText) {
      const scaleX = page.getWidth() / TEMPLATE_WIDTH;
      const scaleY = page.getHeight() / TEMPLATE_HEIGHT;
      const maskHeight = Math.max(
        1,
        item.height - UNDERLINE_FIELD_BOTTOM_OVERFLOW - 1,
      );
      page.drawRectangle({
        x: item.x * scaleX,
        y: page.getHeight() - (item.top + maskHeight) * scaleY,
        width: item.width * scaleX,
        height: maskHeight * scaleY,
        color: rgb(1, 1, 1),
      });
    }
    await drawText(document, page, item.value, {
      x: item.x,
      top: item.replaceSourceText ? Math.max(0, item.top - 2) : item.top,
      width: item.width,
      height: item.height,
      fontSize: item.fontSize,
      align: item.align,
      color: item.color,
      fontFamily: item.fontFamily || BODY_FONT_FAMILY,
      paddingX: item.paddingX ?? AUTO_FILL_HORIZONTAL_MARGIN,
      paddingY: 0,
      maxLines: 1,
      preserveFontHeight: true,
      fitProportionally: true,
      glyphSafetyX: AUTO_FILL_GLYPH_SAFETY_MARGIN,
    });
  }

  for (const item of customItems) {
    const page = pages[item.page - 1];
    if (!page) continue;
    await drawText(document, page, item.value, {
      x: item.x,
      top: item.top,
      width: item.width,
      height: item.height,
      fontSize: item.fontSize,
      align: item.align,
      color: item.color,
      padding: 2,
      maxLines: 20,
    });
  }

  return Buffer.from(await document.save());
}

export async function mergeResignationTemplatePdfs(
  pdfBuffers: Buffer[],
): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const buffer of pdfBuffers) {
    const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  if (merged.getPageCount() === 0) throw new Error("没有可打印的离职模板");
  return Buffer.from(await merged.save());
}
