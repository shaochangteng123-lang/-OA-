import crypto from "crypto";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import * as XLSX from "xlsx";
import { normalizeUploadFileName } from "../utils/upload-file-name.js";

const execFileAsync = promisify(execFile);

export const MAIN_TRIPLICATE_SHEET_NAME = "其他费用";
export const INVOICE_APPLICATION_MATERIAL_MAX_BYTES = 30 * 1024 * 1024;

const MAX_XLSX_ENTRIES = 5_000;
const MAX_XLSX_UNCOMPRESSED_BYTES = 120 * 1024 * 1024;
const MAX_WORKSHEETS = 64;
const MAX_WORKSHEET_CELLS = 1_000_000;
const PREVIEW_MAX_ROWS = 200;
const PREVIEW_MAX_COLUMNS = 50;
const MAX_IMAGE_PIXELS = 40_000_000;

export type InvoiceApplicationContractCategory = "main" | "non_main" | "asset";

export type InvoiceApplicationMaterialMode =
  | "material_need_seal"
  | "material_no_seal"
  | "no_material";

export type InvoiceApplicationMaterialKind =
  | "xlsx"
  | "xls"
  | "pdf"
  | "jpeg"
  | "png";

export interface InvoiceApplicationMaterialFile {
  buffer: Buffer;
  originalName: string;
}

export interface InvoiceApplicationWorksheetPreview {
  sheetName: string;
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  rowsTruncated: boolean;
  columnsTruncated: boolean;
}

export interface InvoiceApplicationMaterialInspection {
  hasMaterial: boolean;
  materialMode: InvoiceApplicationMaterialMode;
  requiresAdminSealTask: boolean;
  originalName: string | null;
  kind: InvoiceApplicationMaterialKind | null;
  mimeType: string | null;
  fileSize: number;
  sha256: string | null;
  worksheetNames: string[];
  preview: InvoiceApplicationWorksheetPreview | null;
  recognizedApplicationAmount: number | null;
  recognizedAmountLabelCell: string | null;
  recognizedAmountValueCell: string | null;
  recognizedAmountDetailRange: string | null;
}

export interface MainTriplicatePaymentAmount {
  amount: number;
  labelCell: string;
  valueCell: string;
  detailRange: string;
}

interface InspectInvoiceApplicationMaterialInput {
  contractCategory: InvoiceApplicationContractCategory;
  materialMode: InvoiceApplicationMaterialMode;
  file?: InvoiceApplicationMaterialFile | null;
}

export interface InvoiceApplicationPrintableFile {
  buffer: Buffer;
  fileName: string;
  mimeType:
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  format: "pdf" | "xlsx";
  sourceSha256: string;
  usedCompatibilityFallback: boolean;
}

export interface InvoiceApplicationPrintableExportOptions {
  /** 仅用于测试或运行环境注入；生产默认调用 LibreOffice。 */
  pdfConverter?: (derivedWorkbook: Buffer) => Promise<Buffer>;
}

const MIME_BY_KIND: Record<InvoiceApplicationMaterialKind, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
};

const EXTENSIONS_BY_KIND: Record<InvoiceApplicationMaterialKind, string[]> = {
  xlsx: [".xlsx"],
  xls: [".xls"],
  pdf: [".pdf"],
  jpeg: [".jpg", ".jpeg"],
  png: [".png"],
};

function domainError(message: string): Error {
  return new Error(message);
}

function assertDecision(
  contractCategory: InvoiceApplicationContractCategory,
  materialMode: InvoiceApplicationMaterialMode,
  hasFile: boolean,
): { requiresAdminSealTask: boolean; requiresMaterial: boolean } {
  if (contractCategory === "asset") {
    throw domainError("资产类合同不允许发起开票申请");
  }

  if (contractCategory === "main") {
    if (materialMode !== "material_need_seal") {
      throw domainError("主营项目合同必须使用固定三联单流程");
    }
    if (!hasFile) throw domainError("主营项目合同必须上传三联单 Excel 原件");
    return { requiresAdminSealTask: true, requiresMaterial: true };
  }

  if (materialMode === "no_material") {
    if (hasFile) throw domainError("已选择不需要材料，不应同时上传文件");
    return { requiresAdminSealTask: false, requiresMaterial: false };
  }
  if (!hasFile) {
    throw domainError(
      materialMode === "material_need_seal"
        ? "已选择材料需要盖章，请先上传材料"
        : "已选择有材料，请先上传材料",
    );
  }
  return {
    requiresAdminSealTask: materialMode === "material_need_seal",
    requiresMaterial: true,
  };
}

function detectKind(buffer: Buffer): InvoiceApplicationMaterialKind | null {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  const signature = buffer.subarray(0, 8).toString("hex").toLowerCase();
  if (signature.startsWith("ffd8ff")) return "jpeg";
  if (signature === "89504e470d0a1a0a") return "png";
  if (signature === "d0cf11e0a1b11ae1") return "xls";
  if (signature.startsWith("504b0304")) return "xlsx";
  return null;
}

function assertExtensionMatches(
  originalName: string,
  kind: InvoiceApplicationMaterialKind,
): void {
  const extension = path.extname(originalName).toLowerCase();
  if (!EXTENSIONS_BY_KIND[kind].includes(extension)) {
    throw domainError("材料扩展名与真实文件格式不一致");
  }
}

async function assertXlsxContainer(buffer: Buffer): Promise<void> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(buffer, {
      // 先读取中央目录并根据未压缩大小做上限判定，
      // 不在安全限制前为 CRC32（循环冗余校验）解压整个容器。
      checkCRC32: false,
      createFolders: false,
    });
  } catch {
    throw domainError("XLSX 文档容器已损坏");
  }
  const entries = Object.values(archive.files);
  if (entries.length > MAX_XLSX_ENTRIES) {
    throw domainError("XLSX 文档条目数量异常");
  }
  if (
    !archive.file("[Content_Types].xml") ||
    !archive.file("xl/workbook.xml")
  ) {
    throw domainError("XLSX 文档缺少必要工作簿结构");
  }
  const forbiddenEntry = entries.find((entry) => {
    const name = entry.name.replace(/\\/gu, "/").toLowerCase();
    return (
      name === "xl/vbaproject.bin" ||
      name.startsWith("xl/externallinks/") ||
      name.startsWith("xl/activex/")
    );
  });
  if (forbiddenEntry) {
    throw domainError("XLSX 三联单不得包含宏、外部链接或 ActiveX");
  }
  let uncompressedBytes = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const data = (
      entry as unknown as {
        _data?: { uncompressedSize?: number };
      }
    )._data;
    const entryBytes = Number(data?.uncompressedSize || 0);
    if (!Number.isFinite(entryBytes) || entryBytes < 0) {
      throw domainError("XLSX 文档条目大小异常");
    }
    uncompressedBytes += entryBytes;
    if (uncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES) {
      throw domainError("XLSX 文档解压后超过安全限制");
    }
  }
  for (const entry of entries) {
    if (entry.dir) continue;
    const name = entry.name.replace(/\\/gu, "/").toLowerCase();
    if (name.endsWith(".rels")) {
      const relationshipXml = await entry.async("string");
      if (/TargetMode\s*=\s*["']External["']/iu.test(relationshipXml)) {
        throw domainError("XLSX 三联单不得包含外部资源关系");
      }
    }
    if (name.startsWith("xl/worksheets/") && name.endsWith(".xml")) {
      const worksheetXml = await entry.async("string");
      if (
        /<f(?:\s[^>]*)?>[^<]*(?:WEBSERVICE|RTD|DDE|EXEC|CALL)\s*\(/iu.test(
          worksheetXml,
        )
      ) {
        throw domainError("XLSX 三联单不得包含外部调用公式");
      }
    }
  }
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function replaceXmlAttribute(
  tag: string,
  attribute: string,
  value: string | null,
): string {
  const expression = new RegExp(`\\s${attribute}\\s*=\\s*(["'])[^"']*\\1`, "u");
  const withoutExisting = tag.replace(expression, "");
  if (value === null) return withoutExisting;
  return withoutExisting.replace(/\s*\/?\s*>$/u, (ending) => {
    const selfClosing = ending.includes("/");
    return ` ${attribute}="${value}"${selfClosing ? "/" : ""}>`;
  });
}

/**
 * 历史兼容工具：仅调整工作簿可见性。当前管理员打印流程不调用此方法，
 * 避免原件中的内嵌对象进入无人值守转换。
 */
export async function createPrintableXlsxCopy(
  sourceBuffer: Buffer,
): Promise<Buffer> {
  const archive = await JSZip.loadAsync(sourceBuffer, {
    checkCRC32: false,
    createFolders: false,
  });
  const workbookEntry = archive.file("xl/workbook.xml");
  if (!workbookEntry) throw domainError("XLSX 文档缺少工作簿定义");
  const workbookXml = await workbookEntry.async("string");
  let targetIndex = -1;
  let sheetIndex = -1;
  const sheetExpression = /<(?:[\w.-]+:)?sheet\b[^>]*\/?\s*>/gu;
  const updatedSheets = workbookXml.replace(sheetExpression, (tag) => {
    sheetIndex += 1;
    const nameMatch = tag.match(/\sname\s*=\s*(["'])(.*?)\1/u);
    const sheetName = nameMatch ? decodeXmlAttribute(nameMatch[2]) : "";
    if (sheetName === MAIN_TRIPLICATE_SHEET_NAME) {
      targetIndex = sheetIndex;
      return replaceXmlAttribute(tag, "state", null);
    }
    return replaceXmlAttribute(tag, "state", "hidden");
  });
  if (targetIndex < 0) {
    throw domainError(`三联单缺少工作表“${MAIN_TRIPLICATE_SHEET_NAME}”`);
  }
  const workbookViewExpression = /<(?:[\w.-]+:)?workbookView\b[^>]*\/?\s*>/u;
  const updatedWorkbook = updatedSheets.replace(workbookViewExpression, (tag) =>
    replaceXmlAttribute(
      replaceXmlAttribute(tag, "firstSheet", String(targetIndex)),
      "activeTab",
      String(targetIndex),
    ),
  );
  archive.file("xl/workbook.xml", updatedWorkbook);
  return archive.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function parseWorkbook(buffer: Buffer, kind: "xlsx" | "xls"): XLSX.WorkBook {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: false,
      cellFormula: true,
      cellHTML: false,
      cellNF: true,
      cellStyles: true,
      dense: false,
    });
  } catch {
    throw domainError(`${kind.toUpperCase()} 工作簿损坏或无法解析`);
  }
  if (
    workbook.SheetNames.length < 1 ||
    workbook.SheetNames.length > MAX_WORKSHEETS
  ) {
    throw domainError(`Excel 工作表数量必须在 1 至 ${MAX_WORKSHEETS} 之间`);
  }
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) continue;
    let range: XLSX.Range;
    try {
      range = XLSX.utils.decode_range(sheet["!ref"]);
    } catch {
      throw domainError(`Excel 工作表“${sheetName}”的单元格范围异常`);
    }
    const rows = range.e.r - range.s.r + 1;
    const columns = range.e.c - range.s.c + 1;
    if (rows <= 0 || columns <= 0 || rows * columns > MAX_WORKSHEET_CELLS) {
      throw domainError(`Excel 工作表“${sheetName}”的单元格数量超过安全限制`);
    }
  }
  return workbook;
}

function worksheetPreview(
  worksheet: XLSX.WorkSheet,
  sheetName: string,
): InvoiceApplicationWorksheetPreview {
  if (!worksheet["!ref"]) {
    return {
      sheetName,
      rows: [],
      totalRows: 0,
      totalColumns: 0,
      rowsTruncated: false,
      columnsTruncated: false,
    };
  }
  const sourceRange = XLSX.utils.decode_range(worksheet["!ref"]);
  const totalRows = sourceRange.e.r - sourceRange.s.r + 1;
  const totalColumns = sourceRange.e.c - sourceRange.s.c + 1;
  const previewRange: XLSX.Range = {
    s: { ...sourceRange.s },
    e: {
      r: Math.min(sourceRange.e.r, sourceRange.s.r + PREVIEW_MAX_ROWS - 1),
      c: Math.min(sourceRange.e.c, sourceRange.s.c + PREVIEW_MAX_COLUMNS - 1),
    },
  };
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
    range: previewRange,
  });
  const rows = rawRows.map((row) =>
    row.map((value) =>
      String(value ?? "")
        .split("\u0000")
        .join(""),
    ),
  );
  return {
    sheetName,
    rows,
    totalRows,
    totalColumns,
    rowsTruncated: totalRows > PREVIEW_MAX_ROWS,
    columnsTruncated: totalColumns > PREVIEW_MAX_COLUMNS,
  };
}

type AmountCellResult =
  | { status: "empty" }
  | { status: "invalid" | "formula_without_cache" }
  | { status: "value"; cents: number };

function semanticCellText(cell: XLSX.CellObject | undefined): string {
  return String(cell?.w ?? cell?.v ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "")
    .replace(/\s+/gu, "")
    .replace(/[：:（）()]/gu, "");
}

function isDateNumberFormat(format: string): boolean {
  const normalized = format
    .replace(/"[^"]*"/gu, "")
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/\\./gu, "")
    .replace(/[_*]./gu, "");
  return /(^|[^a-z])[ymdhs]{1,4}([^a-z]|$)/iu.test(normalized);
}

function strictMoneyTextCents(value: unknown): number | null {
  const text = String(value ?? "").trim();
  const match = text.match(
    /^(?:人民币)?\s*[¥￥]?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*元?$/u,
  );
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return null;
  const cents = Math.round(amount * 100);
  return Math.abs(amount * 100 - cents) <= 0.000001 ? cents : null;
}

function isInsideMultiCellMerge(
  worksheet: XLSX.WorkSheet,
  coordinate: XLSX.CellAddress,
): boolean {
  return (worksheet["!merges"] || []).some(
    (range) =>
      (range.s.r !== range.e.r || range.s.c !== range.e.c) &&
      coordinate.r >= range.s.r &&
      coordinate.r <= range.e.r &&
      coordinate.c >= range.s.c &&
      coordinate.c <= range.e.c,
  );
}

function isWorksheetRowHidden(worksheet: XLSX.WorkSheet, row: number): boolean {
  return Boolean(worksheet["!rows"]?.[row]?.hidden);
}

function isWorksheetColumnHidden(
  worksheet: XLSX.WorkSheet,
  column: number,
): boolean {
  const info = worksheet["!cols"]?.[column];
  return Boolean(
    info?.hidden || info?.width === 0 || info?.wpx === 0 || info?.wch === 0,
  );
}

function amountCellResult(cell: XLSX.CellObject | undefined): AmountCellResult {
  if (!cell || (cell.v == null && !cell.f && !cell.F)) {
    return { status: "empty" };
  }
  if ((cell.f || cell.F) && cell.v == null) {
    return { status: "formula_without_cache" };
  }
  if (cell.t === "d") return { status: "invalid" };
  const numberFormat = cell.z == null ? "" : String(cell.z);
  if (
    numberFormat &&
    (numberFormat.includes("%") || isDateNumberFormat(numberFormat))
  ) {
    return { status: "invalid" };
  }

  let amount: number | null = null;
  if (cell.t === "n" && typeof cell.v === "number") {
    amount = cell.v;
  } else if (cell.t === "s" || String(cell.t) === "str") {
    const text = String(cell.w ?? cell.v ?? "").trim();
    if (!text) return { status: "empty" };
    const textCents = strictMoneyTextCents(text);
    if (textCents != null) amount = textCents / 100;
  } else {
    return { status: "invalid" };
  }
  if (!Number.isFinite(amount) || Number(amount) < 0) {
    return { status: "invalid" };
  }
  const cents = Math.round(Number(amount) * 100);
  if (
    Math.abs(Number(amount) * 100 - cents) > 0.000001 ||
    cents > 99_999_999_999_999
  ) {
    return { status: "invalid" };
  }
  if (cents > 0) {
    const displayText =
      cell.w === undefined
        ? String(cell.v ?? "").trim()
        : String(cell.w).trim();
    if (!displayText) return { status: "invalid" };
    const displayedCents = strictMoneyTextCents(displayText);
    if (displayedCents == null || displayedCents !== cents) {
      return { status: "invalid" };
    }
  }
  return { status: "value", cents };
}

export function extractMainTriplicatePaymentAmount(
  worksheet: XLSX.WorkSheet,
): MainTriplicatePaymentAmount {
  const cellEntries = Object.keys(worksheet)
    .filter((address) => !address.startsWith("!"))
    .map((address) => ({
      address,
      coordinate: XLSX.utils.decode_cell(address),
      text: semanticCellText(worksheet[address]),
      hasFormula: Boolean(worksheet[address]?.f || worksheet[address]?.F),
    }));
  const protectedLabels = new Set([
    "其他费用项目",
    "实际金额",
    "累计付款",
    "本次付款",
    "本次付款金额",
    "本次付款金额元",
    "合计",
    "总计",
  ]);
  if (
    cellEntries.some(
      (entry) =>
        entry.hasFormula &&
        (protectedLabels.has(entry.text) ||
          /^(?:(?:金额)?单位|币种)/u.test(entry.text)),
    )
  ) {
    throw domainError("“其他费用”工作表的结构标签不能使用公式");
  }
  const plainEntries = cellEntries.filter((entry) => !entry.hasFormula);
  const semanticTexts = new Set(plainEntries.map((entry) => entry.text));
  if (
    !semanticTexts.has("其他费用项目") ||
    !semanticTexts.has("实际金额") ||
    !semanticTexts.has("累计付款")
  ) {
    throw domainError(
      `“${MAIN_TRIPLICATE_SHEET_NAME}”工作表结构不完整，缺少固定表头`,
    );
  }
  const unitEntries = plainEntries.filter((entry) =>
    /^(?:(?:金额)?单位|币种)/u.test(entry.text),
  );
  if (
    unitEntries.length !== 1 ||
    !/^(?:(?:金额)?单位|币种)(?:人民币)?元$/u.test(unitEntries[0].text)
  ) {
    throw domainError("“其他费用”工作表必须唯一明确使用“元”为金额单位");
  }

  const headers = plainEntries.filter((entry) =>
    ["本次付款", "本次付款金额", "本次付款金额元"].includes(entry.text),
  );
  if (headers.length === 0) {
    throw domainError(
      `“${MAIN_TRIPLICATE_SHEET_NAME}”工作表未找到“本次付款”列`,
    );
  }
  const totalRows = [
    ...new Set(
      plainEntries
        .filter((entry) => entry.text === "合计" || entry.text === "总计")
        .map((entry) => entry.coordinate.r),
    ),
  ];
  if (totalRows.length === 0) {
    throw domainError(`“${MAIN_TRIPLICATE_SHEET_NAME}”工作表未找到“合计”行`);
  }

  const candidates: MainTriplicatePaymentAmount[] = [];
  for (const header of headers) {
    if (isInsideMultiCellMerge(worksheet, header.coordinate)) {
      throw domainError("“其他费用”工作表的本次付款列头不能使用合并单元格");
    }
    if (
      isWorksheetColumnHidden(worksheet, header.coordinate.c) ||
      isWorksheetRowHidden(worksheet, header.coordinate.r) ||
      isWorksheetRowHidden(worksheet, unitEntries[0].coordinate.r) ||
      isWorksheetColumnHidden(worksheet, unitEntries[0].coordinate.c)
    ) {
      throw domainError(
        "“其他费用”工作表的本次付款列头、合计和金额单位必须可见",
      );
    }
    const hasActualAmountAnchor = plainEntries.some(
      (entry) =>
        entry.text === "实际金额" &&
        entry.coordinate.c === header.coordinate.c &&
        entry.coordinate.r < header.coordinate.r &&
        header.coordinate.r - entry.coordinate.r <= 2,
    );
    const hasCumulativePaymentAnchor = plainEntries.some(
      (entry) =>
        entry.text === "累计付款" &&
        entry.coordinate.r === header.coordinate.r &&
        entry.coordinate.c > header.coordinate.c &&
        entry.coordinate.c - header.coordinate.c <= 2,
    );
    const hasExpenseItemAnchor = plainEntries.some(
      (entry) =>
        entry.text === "其他费用项目" &&
        entry.coordinate.r < header.coordinate.r &&
        header.coordinate.r - entry.coordinate.r <= 2,
    );
    if (
      unitEntries[0].coordinate.r >= header.coordinate.r ||
      !hasActualAmountAnchor ||
      !hasCumulativePaymentAnchor ||
      !hasExpenseItemAnchor
    ) {
      throw domainError("“其他费用”工作表的本次付款列结构不完整");
    }
    const followingTotals = totalRows.filter(
      (row) => row > header.coordinate.r,
    );
    if (followingTotals.length !== 1) {
      throw domainError(
        `“${MAIN_TRIPLICATE_SHEET_NAME}”工作表的“本次付款”合计位置不唯一`,
      );
    }
    const totalRow = followingTotals[0];
    if (isWorksheetRowHidden(worksheet, totalRow)) {
      throw domainError(
        "“其他费用”工作表的本次付款列头、合计和金额单位必须可见",
      );
    }
    let detailCents = 0;
    let hasPositiveDetail = false;
    for (let row = header.coordinate.r + 1; row < totalRow; row += 1) {
      const detailAddress = XLSX.utils.encode_cell({
        r: row,
        c: header.coordinate.c,
      });
      if (
        isInsideMultiCellMerge(worksheet, {
          r: row,
          c: header.coordinate.c,
        })
      ) {
        throw domainError("“其他费用”工作表的本次付款明细不能位于合并单元格");
      }
      const detailCell = worksheet[detailAddress];
      if (detailCell?.f || detailCell?.F) {
        throw domainError("“其他费用”工作表的本次付款明细不能使用公式");
      }
      const detail = amountCellResult(detailCell);
      if (detail.status === "empty") continue;
      if (detail.status !== "value") {
        throw domainError(
          `“${MAIN_TRIPLICATE_SHEET_NAME}”工作表${detailAddress}的本次付款明细不是有效金额`,
        );
      }
      detailCents += detail.cents;
      if (detail.cents > 0) hasPositiveDetail = true;
    }
    if (!hasPositiveDetail || detailCents <= 0) {
      throw domainError(
        `“${MAIN_TRIPLICATE_SHEET_NAME}”工作表的本次付款明细合计必须大于0`,
      );
    }

    const totalAddress = XLSX.utils.encode_cell({
      r: totalRow,
      c: header.coordinate.c,
    });
    if (
      isInsideMultiCellMerge(worksheet, {
        r: totalRow,
        c: header.coordinate.c,
      })
    ) {
      throw domainError("“其他费用”工作表的本次付款合计不能位于合并单元格");
    }
    const totalCell = worksheet[totalAddress];
    const expectedDetailRange =
      XLSX.utils.encode_cell({
        r: header.coordinate.r + 1,
        c: header.coordinate.c,
      }) +
      ":" +
      XLSX.utils.encode_cell({
        r: totalRow - 1,
        c: header.coordinate.c,
      });
    if (totalCell?.F) {
      throw domainError("“其他费用”工作表的本次付款合计不能使用数组或共享公式");
    }
    if (totalCell?.f) {
      const normalizedFormula = String(totalCell.f)
        .normalize("NFKC")
        .replace(/\s+/gu, "")
        .replace(/\$/gu, "")
        .replace(/^=/u, "")
        .toUpperCase();
      if (normalizedFormula !== "SUM(" + expectedDetailRange + ")") {
        throw domainError("“其他费用”工作表的本次付款合计公式不符合固定模板");
      }
    }
    const total = amountCellResult(totalCell);
    if (
      total.status === "invalid" ||
      total.status === "empty" ||
      total.status === "formula_without_cache"
    ) {
      throw domainError(
        `“${MAIN_TRIPLICATE_SHEET_NAME}”工作表${totalAddress}的合计金额无效`,
      );
    }
    if (total.status === "value" && total.cents !== detailCents) {
      throw domainError(
        `“${MAIN_TRIPLICATE_SHEET_NAME}”工作表的本次付款明细与合计金额不一致`,
      );
    }
    candidates.push({
      amount: detailCents / 100,
      labelCell: header.address,
      valueCell: totalAddress,
      detailRange: `${XLSX.utils.encode_cell({
        r: header.coordinate.r + 1,
        c: header.coordinate.c,
      })}:${XLSX.utils.encode_cell({
        r: totalRow - 1,
        c: header.coordinate.c,
      })}`,
    });
  }

  const uniqueAmounts = [...new Set(candidates.map((item) => item.amount))];
  if (uniqueAmounts.length > 1) {
    throw domainError(
      `“${MAIN_TRIPLICATE_SHEET_NAME}”工作表存在多个不同的“本次付款金额”，请核对三联单`,
    );
  }
  return candidates.find((item) => item.amount === uniqueAmounts[0])!;
}

async function assertPdf(buffer: Buffer): Promise<void> {
  try {
    const document = await PDFDocument.load(buffer, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    if (document.getPageCount() < 1 || document.getPageCount() > 100) {
      throw new Error("invalid page count");
    }
  } catch {
    throw domainError("PDF 材料损坏、已加密或页数异常");
  }
}

async function assertImage(
  buffer: Buffer,
  kind: "jpeg" | "png",
): Promise<void> {
  try {
    const image = sharp(buffer, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    });
    const metadata = await image.metadata();
    await image.clone().resize(1, 1, { fit: "fill" }).toBuffer();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    if (
      metadata.format !== kind ||
      width < 1 ||
      height < 1 ||
      width * height > MAX_IMAGE_PIXELS
    ) {
      throw new Error("invalid image");
    }
  } catch {
    throw domainError("图片材料损坏或像素尺寸超过安全限制");
  }
}

async function readWorkbook(
  buffer: Buffer,
  kind: "xlsx" | "xls",
): Promise<XLSX.WorkBook> {
  if (kind === "xlsx") await assertXlsxContainer(buffer);
  return parseWorkbook(buffer, kind);
}

export async function inspectInvoiceApplicationMaterial(
  input: InspectInvoiceApplicationMaterialInput,
): Promise<InvoiceApplicationMaterialInspection> {
  const file = input.file || null;
  const decision = assertDecision(
    input.contractCategory,
    input.materialMode,
    Boolean(file),
  );
  if (!file) {
    return {
      hasMaterial: false,
      materialMode: input.materialMode,
      requiresAdminSealTask: decision.requiresAdminSealTask,
      originalName: null,
      kind: null,
      mimeType: null,
      fileSize: 0,
      sha256: null,
      worksheetNames: [],
      preview: null,
      recognizedApplicationAmount: null,
      recognizedAmountLabelCell: null,
      recognizedAmountValueCell: null,
      recognizedAmountDetailRange: null,
    };
  }

  if (
    file.buffer.length < 1 ||
    file.buffer.length > INVOICE_APPLICATION_MATERIAL_MAX_BYTES
  ) {
    throw domainError("开票材料必须大于 0 字节且不超过 30MB");
  }
  const originalName = normalizeUploadFileName(file.originalName);
  const kind = detectKind(file.buffer);
  if (!kind) {
    throw domainError(
      input.contractCategory === "main"
        ? "主营三联单仅支持真实 XLS 或 XLSX 文件"
        : "非主营材料仅支持真实 Excel、PDF、JPG 或 PNG 文件",
    );
  }
  assertExtensionMatches(originalName, kind);

  if (input.contractCategory === "main" && !["xls", "xlsx"].includes(kind)) {
    throw domainError("主营三联单仅支持真实 XLS 或 XLSX 文件");
  }

  let workbook: XLSX.WorkBook | null = null;
  if (kind === "xls" || kind === "xlsx") {
    workbook = await readWorkbook(file.buffer, kind);
  } else if (kind === "pdf") {
    await assertPdf(file.buffer);
  } else {
    await assertImage(file.buffer, kind);
  }

  let preview: InvoiceApplicationWorksheetPreview | null = null;
  let recognizedPayment: MainTriplicatePaymentAmount | null = null;
  if (input.contractCategory === "main") {
    if (!workbook?.SheetNames.includes(MAIN_TRIPLICATE_SHEET_NAME)) {
      throw domainError(
        `三联单缺少固定工作表“${MAIN_TRIPLICATE_SHEET_NAME}”，不能提交审批`,
      );
    }
    preview = worksheetPreview(
      workbook.Sheets[MAIN_TRIPLICATE_SHEET_NAME],
      MAIN_TRIPLICATE_SHEET_NAME,
    );
    recognizedPayment = extractMainTriplicatePaymentAmount(
      workbook.Sheets[MAIN_TRIPLICATE_SHEET_NAME],
    );
  }

  return {
    hasMaterial: true,
    materialMode: input.materialMode,
    requiresAdminSealTask: decision.requiresAdminSealTask,
    originalName,
    kind,
    mimeType: MIME_BY_KIND[kind],
    fileSize: file.buffer.length,
    sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
    worksheetNames: workbook ? [...workbook.SheetNames] : [],
    preview,
    recognizedApplicationAmount: recognizedPayment?.amount ?? null,
    recognizedAmountLabelCell: recognizedPayment?.labelCell ?? null,
    recognizedAmountValueCell: recognizedPayment?.valueCell ?? null,
    recognizedAmountDetailRange: recognizedPayment?.detailRange ?? null,
  };
}

function cloneWorksheet(source: XLSX.WorkSheet): XLSX.WorkSheet {
  const clone: XLSX.WorkSheet = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || typeof value !== "object") {
      clone[key] = value;
      continue;
    }
    clone[key] = Array.isArray(value)
      ? value.map((entry) =>
          entry && typeof entry === "object" ? { ...entry } : entry,
        )
      : { ...value };
  }
  return clone;
}

/**
 * 仅产生供管理员打印盖章的派生工作簿。
 * 原始 Buffer 只读，完整三联单应由路由单独原样存档。
 */
export async function exportOtherExpensesWorksheet(
  sourceBuffer: Buffer,
  originalName: string,
): Promise<{
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  sourceSha256: string;
}> {
  const originalHash = crypto
    .createHash("sha256")
    .update(sourceBuffer)
    .digest("hex");
  const inspection = await inspectInvoiceApplicationMaterial({
    contractCategory: "main",
    materialMode: "material_need_seal",
    file: { buffer: sourceBuffer, originalName },
  });
  if (!inspection.kind || !["xls", "xlsx"].includes(inspection.kind)) {
    throw domainError("主营三联单必须是 Excel 文件");
  }
  const workbook = await readWorkbook(
    sourceBuffer,
    inspection.kind as "xls" | "xlsx",
  );
  const sourceSheet = workbook.Sheets[MAIN_TRIPLICATE_SHEET_NAME];
  if (!sourceSheet) {
    throw domainError(`三联单缺少工作表“${MAIN_TRIPLICATE_SHEET_NAME}”`);
  }
  const printableWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    printableWorkbook,
    cloneWorksheet(sourceSheet),
    MAIN_TRIPLICATE_SHEET_NAME,
  );
  const output = XLSX.write(printableWorkbook, {
    type: "buffer",
    bookType: "xlsx",
    bookSST: true,
    compression: true,
    cellStyles: true,
  });
  const outputBuffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  const baseName = path.basename(
    normalizeUploadFileName(originalName),
    path.extname(originalName),
  );
  return {
    buffer: outputBuffer,
    fileName: `${baseName || "三联单"}-其他费用.xlsx`,
    mimeType: MIME_BY_KIND.xlsx,
    sourceSha256: originalHash,
  };
}

async function convertPrintableWorkbookWithLibreOffice(
  derivedWorkbook: Buffer,
): Promise<Buffer> {
  const workDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "invoice-triplicate-print-"),
  );
  const userInstallDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "invoice-triplicate-soffice-"),
  );
  const workbookPath = path.join(
    workDirectory,
    "triplicate-other-expenses.xlsx",
  );
  const pdfPath = path.join(workDirectory, "triplicate-other-expenses.pdf");
  try {
    fs.writeFileSync(workbookPath, derivedWorkbook, { flag: "wx" });
    await execFileAsync(
      "soffice",
      [
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        `-env:UserInstallation=file://${userInstallDirectory}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDirectory,
        workbookPath,
      ],
      { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 },
    );
    if (!fs.existsSync(pdfPath)) {
      throw domainError("LibreOffice 未生成三联单打印 PDF");
    }
    const pdfBuffer = fs.readFileSync(pdfPath);
    await assertPdf(pdfBuffer);
    return pdfBuffer;
  } finally {
    try {
      fs.rmSync(workDirectory, { recursive: true, force: true });
    } catch {
      // 临时文件清理失败不能覆盖主业务错误。
    }
    try {
      fs.rmSync(userInstallDirectory, { recursive: true, force: true });
    } catch {
      // 同上。
    }
  }
}

/**
 * 管理员下载“其他费用”打印件的统一入口。
 *
 * - XLSX／XLS：均重建为不含内嵌对象的独立“其他费用”工作表，再优先导出 PDF。
 * - PDF 转换不可用时：返回只含目标工作表的 XLSX，不回退为完整原件。
 *
 * 全程只读取 sourceAbsolutePath，不会覆盖原始 Excel。
 */
export async function exportOtherExpensesPrintableFileFromPath(
  sourceAbsolutePath: string,
  originalName = path.basename(sourceAbsolutePath),
  options: InvoiceApplicationPrintableExportOptions = {},
): Promise<InvoiceApplicationPrintableFile> {
  if (!path.isAbsolute(sourceAbsolutePath)) {
    throw domainError("三联单原件路径必须是绝对路径");
  }
  let sourceBuffer: Buffer;
  try {
    const stat = fs.statSync(sourceAbsolutePath);
    if (
      !stat.isFile() ||
      stat.size < 1 ||
      stat.size > INVOICE_APPLICATION_MATERIAL_MAX_BYTES
    ) {
      throw new Error("invalid source file");
    }
    sourceBuffer = fs.readFileSync(sourceAbsolutePath);
  } catch {
    throw domainError("三联单原件不存在、不可读或大小异常");
  }

  const sourceSha256 = crypto
    .createHash("sha256")
    .update(sourceBuffer)
    .digest("hex");
  const derivedWorkbook = (
    await exportOtherExpensesWorksheet(sourceBuffer, originalName)
  ).buffer;

  const normalizedName = normalizeUploadFileName(originalName);
  const baseName =
    path.basename(normalizedName, path.extname(normalizedName)) || "三联单";
  try {
    const pdfBuffer = options.pdfConverter
      ? await options.pdfConverter(derivedWorkbook)
      : await convertPrintableWorkbookWithLibreOffice(derivedWorkbook);
    await assertPdf(pdfBuffer);
    return {
      buffer: pdfBuffer,
      fileName: `${baseName}-其他费用.pdf`,
      mimeType: "application/pdf",
      format: "pdf",
      sourceSha256,
      usedCompatibilityFallback: false,
    };
  } catch (error) {
    console.warn(
      "三联单“其他费用”PDF 生成失败，回退为单工作表 XLSX:",
      error instanceof Error ? error.message : error,
    );
    const compatibilityWorkbook = await exportOtherExpensesWorksheet(
      sourceBuffer,
      originalName,
    );
    return {
      buffer: compatibilityWorkbook.buffer,
      fileName: `${baseName}-其他费用.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      format: "xlsx",
      sourceSha256,
      usedCompatibilityFallback: true,
    };
  }
}
