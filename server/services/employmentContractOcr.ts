import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { PDFDocument } from "pdf-lib";

const execFileAsync = promisify(execFile);
const MAX_INSPECT_PAGES = 4;

export interface EmploymentContractTermRecognition {
  status: "success" | "failed";
  contractStartDate: string | null;
  contractEndDate: string | null;
  message: string;
  method?: "text" | "image";
  pageNumber?: number;
}

interface ParsedContractTerm {
  contractStartDate: string | null;
  contractEndDate: string | null;
  message: string;
}

function toHalfWidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, " ");
}

function normalizeDateNumber(value: string): number {
  return Number(value.replace(/[Oo]/g, "0"));
}

function buildDate(
  yearText: string,
  monthText: string,
  dayText: string,
): string | null {
  const year = normalizeDateNumber(yearText);
  const month = normalizeDateNumber(monthText);
  const day = normalizeDateNumber(dayText);
  if (
    year < 2000 ||
    year > 2200 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function parseEmploymentContractTermText(
  rawText: string,
): ParsedContractTerm {
  const compactText = toHalfWidth(rawText)
    .replace(/\s+/g, "")
    .replace(/[_＿]+/g, "");
  const sectionStart = compactText.search(/劳动合同期限|固定期限劳动合同/);
  if (sectionStart < 0) {
    return {
      contractStartDate: null,
      contractEndDate: null,
      message: "未识别到劳动合同期限条款",
    };
  }

  const contractSection = compactText.slice(sectionStart, sectionStart + 800);
  const datePattern =
    "(2[0Oo][0-9Oo]{2})年([0-9Oo]{1,2})月([0-9Oo]{1,2})[日曰]";
  const rangePattern = new RegExp(
    `(?:自)?${datePattern}(?:起|开始)?[，,。；;、]?(?:至|到)${datePattern}`,
    "g",
  );
  const ranges: Array<{
    contractStartDate: string;
    contractEndDate: string;
    duration: number;
  }> = [];

  for (const match of contractSection.matchAll(rangePattern)) {
    const contractStartDate = buildDate(match[1], match[2], match[3]);
    const contractEndDate = buildDate(match[4], match[5], match[6]);
    if (
      !contractStartDate ||
      !contractEndDate ||
      contractEndDate < contractStartDate
    ) {
      continue;
    }
    ranges.push({
      contractStartDate,
      contractEndDate,
      duration:
        new Date(`${contractEndDate}T00:00:00Z`).getTime() -
        new Date(`${contractStartDate}T00:00:00Z`).getTime(),
    });
  }

  const bestRange = ranges.sort(
    (left, right) => right.duration - left.duration,
  )[0];
  if (!bestRange) {
    return {
      contractStartDate: null,
      contractEndDate: null,
      message: "未识别到完整有效的劳动合同起止日期",
    };
  }

  return {
    contractStartDate: bestRange.contractStartDate,
    contractEndDate: bestRange.contractEndDate,
    message: "劳动合同期限识别成功",
  };
}

async function extractPdfText(
  pdfPath: string,
  pageCount: number,
): Promise<string> {
  const result = (await execFileAsync(
    "pdftotext",
    ["-f", "1", "-l", String(pageCount), "-layout", pdfPath, "-"],
    { timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
  )) as { stdout: string };
  return result.stdout || "";
}

async function recognizePdfPageImage(
  pdfPath: string,
  pageNumber: number,
  dpi: number,
): Promise<string> {
  const outputPrefix = `${pdfPath}-contract-term-${process.pid}-${Date.now()}-${pageNumber}-${dpi}`;
  const imagePath = `${outputPrefix}.png`;

  try {
    await execFileAsync(
      "pdftoppm",
      [
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
    if (!fs.existsSync(imagePath)) throw new Error("劳动合同页面转图片失败");
    const { callPaddleOcr } = await import("./ocrDaemon.js");
    return await callPaddleOcr(imagePath);
  } finally {
    try {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    } catch {
      // 忽略临时图片清理失败
    }
  }
}

export async function recognizeEmploymentContractTerm(
  pdfPath: string,
): Promise<EmploymentContractTermRecognition> {
  try {
    if (!fs.existsSync(pdfPath)) {
      return {
        status: "failed",
        contractStartDate: null,
        contractEndDate: null,
        message: "劳动合同文件不存在",
      };
    }

    const sourceDocument = await PDFDocument.load(fs.readFileSync(pdfPath), {
      ignoreEncryption: true,
    });
    const inspectPageCount = Math.min(
      sourceDocument.getPageCount(),
      MAX_INSPECT_PAGES,
    );
    if (inspectPageCount === 0) {
      return {
        status: "failed",
        contractStartDate: null,
        contractEndDate: null,
        message: "劳动合同没有可识别页面",
      };
    }

    try {
      const parsed = parseEmploymentContractTermText(
        await extractPdfText(pdfPath, inspectPageCount),
      );
      if (parsed.contractStartDate && parsed.contractEndDate) {
        return { status: "success", ...parsed, method: "text" };
      }
    } catch {
      // 扫描件没有文字层时继续执行图片识别
    }

    const preferredPages = [2, 1, 3, 4].filter(
      (pageNumber) => pageNumber <= inspectPageCount,
    );
    let lastMessage = "未识别到劳动合同起止日期";
    for (const dpi of [300, 600]) {
      for (const pageNumber of preferredPages) {
        try {
          const parsed = parseEmploymentContractTermText(
            await recognizePdfPageImage(pdfPath, pageNumber, dpi),
          );
          lastMessage = parsed.message;
          if (parsed.contractStartDate && parsed.contractEndDate) {
            return {
              status: "success",
              ...parsed,
              method: "image",
              pageNumber,
            };
          }
        } catch (error) {
          lastMessage =
            error instanceof Error ? error.message : "劳动合同图片识别失败";
        }
      }
    }

    return {
      status: "failed",
      contractStartDate: null,
      contractEndDate: null,
      message: lastMessage,
    };
  } catch (error) {
    return {
      status: "failed",
      contractStartDate: null,
      contractEndDate: null,
      message: error instanceof Error ? error.message : "劳动合同期限识别失败",
    };
  }
}
