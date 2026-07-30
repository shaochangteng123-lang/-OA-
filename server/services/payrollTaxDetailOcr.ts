import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import { callPaddleOcrDetailed, type PaddleOcrLine } from "./ocrDaemon.js";

export interface PayrollTaxEmployee {
  employeeId: string;
  employeeName: string;
}

export interface PayrollTaxRecognitionItem extends PayrollTaxEmployee {
  amount: string;
  pageNo: number;
}

export interface PayrollTaxPageRecognition {
  hasTaxHeader: boolean;
  items: PayrollTaxRecognitionItem[];
  unreadableEmployeeNames: string[];
}

export interface PayrollTaxDetailRecognition {
  items: PayrollTaxRecognitionItem[];
  missingEmployeeNames: string[];
  unreadableEmployeeNames: string[];
  pageCount: number;
}

interface PositionedLine {
  source: PaddleOcrLine;
  text: string;
  centerX: number;
  centerY: number;
  minX: number;
  maxX: number;
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/[\s·•・]/g, "");
}

function getLinePosition(line: PaddleOcrLine): PositionedLine | null {
  const points = Array.isArray(line.box) ? line.box : [];
  const xs = points
    .map((point) => Number(point?.[0]))
    .filter((value) => Number.isFinite(value));
  const ys = points
    .map((point) => Number(point?.[1]))
    .filter((value) => Number.isFinite(value));
  if (xs.length === 0 || ys.length === 0) return null;

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    source: line,
    text: normalizeText(line.text),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    minX,
    maxX,
  };
}

function getKeywordCenterX(line: PositionedLine, keyword: string): number {
  const index = line.text.indexOf(keyword);
  if (index < 0 || line.text.length === 0) return line.centerX;
  const keywordCenterRatio = (index + keyword.length / 2) / line.text.length;
  return line.minX + (line.maxX - line.minX) * keywordCenterRatio;
}

function parseTaxAmount(text: string): string | null {
  const normalized = text
    .normalize("NFKC")
    .replace(/[,\s，￥¥元]/g, "")
    .replace(/[。．]/g, ".");
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }
  const [integerPart, fractionPart = ""] = normalized.split(".");
  return `${integerPart}.${fractionPart.padEnd(2, "0")}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function extractPayrollTaxItems(
  ocrLines: PaddleOcrLine[],
  employees: PayrollTaxEmployee[],
  pageNo = 1,
): PayrollTaxPageRecognition {
  const lines = ocrLines
    .map(getLinePosition)
    .filter((line): line is PositionedLine => line !== null && !!line.text);
  const taxHeader = lines.find((line) => line.text.includes("应纳个税"));
  if (!taxHeader) {
    return {
      hasTaxHeader: false,
      items: [],
      unreadableEmployeeNames: [],
    };
  }

  const pageWidth = Math.max(...lines.map((line) => line.maxX), 1);
  const taxColumnCenter = getKeywordCenterX(taxHeader, "应纳个税");
  const taxColumnTolerance = Math.max(24, pageWidth * 0.035);
  const employeeNameCounts = new Map<string, number>();
  for (const employee of employees) {
    const name = normalizeText(employee.employeeName);
    employeeNameCounts.set(name, (employeeNameCounts.get(name) || 0) + 1);
  }

  const employeeRows = employees
    .filter(
      (employee) =>
        employeeNameCounts.get(normalizeText(employee.employeeName)) === 1,
    )
    .map((employee) => {
      const normalizedName = normalizeText(employee.employeeName);
      const nameLine = lines
        .filter(
          (line) =>
            line.text === normalizedName ||
            (line.text.length <= normalizedName.length + 2 &&
              line.text.includes(normalizedName)),
        )
        .sort(
          (left, right) => right.source.confidence - left.source.confidence,
        )[0];
      return nameLine ? { employee, nameLine } : null;
    })
    .filter(
      (
        item,
      ): item is {
        employee: PayrollTaxEmployee;
        nameLine: PositionedLine;
      } => item !== null,
    )
    .sort((left, right) => left.nameLine.centerY - right.nameLine.centerY);

  const rowGaps = employeeRows
    .slice(1)
    .map(
      (item, index) =>
        item.nameLine.centerY - employeeRows[index].nameLine.centerY,
    )
    .filter((gap) => gap > 0);
  const typicalRowGap = median(rowGaps) || Math.max(40, pageWidth * 0.05);
  const items: PayrollTaxRecognitionItem[] = [];
  const unreadableEmployeeNames: string[] = [];

  employeeRows.forEach((row, index) => {
    const previous = employeeRows[index - 1];
    const next = employeeRows[index + 1];
    const upperGap = previous
      ? row.nameLine.centerY - previous.nameLine.centerY
      : typicalRowGap;
    const lowerGap = next
      ? next.nameLine.centerY - row.nameLine.centerY
      : typicalRowGap;
    const minY = row.nameLine.centerY - upperGap * 0.43;
    const maxY = row.nameLine.centerY + lowerGap * 0.43;

    const columnLines = lines
      .filter(
        (line) =>
          line.centerY >= minY &&
          line.centerY <= maxY &&
          Math.abs(line.centerX - taxColumnCenter) <= taxColumnTolerance,
      )
      .sort(
        (left, right) =>
          Math.abs(left.centerX - taxColumnCenter) -
            Math.abs(right.centerX - taxColumnCenter) ||
          Math.abs(left.centerY - row.nameLine.centerY) -
            Math.abs(right.centerY - row.nameLine.centerY),
      );

    if (columnLines.length === 0) {
      items.push({
        ...row.employee,
        amount: "0.00",
        pageNo,
      });
      return;
    }

    const amount = columnLines
      .map((line) => parseTaxAmount(line.source.text))
      .find((value): value is string => value !== null);
    if (amount === undefined) {
      unreadableEmployeeNames.push(row.employee.employeeName);
      return;
    }
    items.push({
      ...row.employee,
      amount,
      pageNo,
    });
  });

  return {
    hasTaxHeader: true,
    items,
    unreadableEmployeeNames,
  };
}

async function convertTaxPdfToImages(
  filePath: string,
  outputDirectory: string,
): Promise<string[]> {
  const document = await PDFDocument.load(fs.readFileSync(filePath));
  const pageCount = document.getPageCount();
  if (pageCount < 1) throw new Error("个税明细文件没有可识别页面");
  if (pageCount > 30) throw new Error("个税明细最多支持 30 页");

  const outputPrefix = path.join(outputDirectory, "page");
  execFileSync("pdftoppm", ["-r", "180", "-png", filePath, outputPrefix], {
    timeout: 180_000,
  });
  return fs
    .readdirSync(outputDirectory)
    .map((fileName) => {
      const match = fileName.match(/^page-(\d+)\.png$/);
      return match
        ? {
            pageNo: Number(match[1]),
            filePath: path.join(outputDirectory, fileName),
          }
        : null;
    })
    .filter(
      (
        item,
      ): item is {
        pageNo: number;
        filePath: string;
      } => item !== null,
    )
    .sort((left, right) => left.pageNo - right.pageNo)
    .map((item) => item.filePath);
}

export async function recognizePayrollTaxDetail(
  filePath: string,
  mimeType: string,
  employees: PayrollTaxEmployee[],
): Promise<PayrollTaxDetailRecognition> {
  const outputDirectory = path.join(
    process.cwd(),
    "uploads",
    "temp",
    `payroll-tax-${randomUUID()}`,
  );
  let imagePaths = [filePath];

  try {
    if (mimeType === "application/pdf") {
      fs.mkdirSync(outputDirectory, { recursive: true });
      imagePaths = await convertTaxPdfToImages(filePath, outputDirectory);
    }
    if (imagePaths.length === 0) {
      throw new Error("个税明细文件没有可识别页面");
    }

    const recognizedByEmployee = new Map<string, PayrollTaxRecognitionItem>();
    const unreadableEmployeeNames = new Set<string>();
    let hasTaxHeader = false;

    for (const [index, imagePath] of imagePaths.entries()) {
      const ocrResult = await callPaddleOcrDetailed(imagePath);
      const pageResult = extractPayrollTaxItems(
        ocrResult.lines,
        employees,
        index + 1,
      );
      hasTaxHeader ||= pageResult.hasTaxHeader;
      for (const name of pageResult.unreadableEmployeeNames) {
        unreadableEmployeeNames.add(name);
      }
      for (const item of pageResult.items) {
        const existing = recognizedByEmployee.get(item.employeeId);
        if (existing && existing.amount !== item.amount) {
          throw new Error(
            `${item.employeeName}在个税明细中出现多个不同的应纳个税金额`,
          );
        }
        recognizedByEmployee.set(item.employeeId, item);
        unreadableEmployeeNames.delete(item.employeeName);
      }
    }

    if (!hasTaxHeader) {
      throw new Error("未识别到“应纳个税”列，请上传包含该列的工资表");
    }
    if (recognizedByEmployee.size === 0) {
      throw new Error("未识别到本月工资表中的员工姓名和应纳个税");
    }

    const items = [...recognizedByEmployee.values()];
    const recognizedIds = new Set(items.map((item) => item.employeeId));
    return {
      items,
      missingEmployeeNames: employees
        .filter((employee) => !recognizedIds.has(employee.employeeId))
        .map((employee) => employee.employeeName),
      unreadableEmployeeNames: [...unreadableEmployeeNames],
      pageCount: imagePaths.length,
    };
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
}
