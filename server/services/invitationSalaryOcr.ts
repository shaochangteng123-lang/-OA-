import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { callPaddleOcr } from "./ocrDaemon.js";
import {
  comparePayrollAmounts,
  multiplyPayrollAmountByInteger,
  normalizePayrollAmount,
} from "./payrollCalculator.js";

const execFileAsync = promisify(execFile);

export interface InvitationSalaryRecognition {
  status: "success" | "failed";
  monthlySalary: string | null;
  message: string;
  method?: "text" | "image";
}

interface ParsedInvitationSalary {
  monthlySalary: string | null;
  annualSalary: string | null;
  message: string;
}

function toHalfWidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, " ");
}

function normalizeRecognizedAmount(value: string): string | null {
  const normalized = toHalfWidth(value)
    .replace(/[Oo]/g, "0")
    .replace(/[，,]/g, "")
    .trim();

  try {
    const amount = normalizePayrollAmount(normalized);
    if (
      comparePayrollAmounts(amount, "0") <= 0 ||
      comparePayrollAmounts(amount, "1000000") > 0
    ) {
      return null;
    }
    return amount;
  } catch {
    return null;
  }
}

function matchAmount(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const matched = pattern.exec(text);
    if (!matched?.[1]) continue;
    const amount = normalizeRecognizedAmount(matched[1]);
    if (amount) return amount;
  }
  return null;
}

export function parseInvitationSalaryText(
  rawText: string,
): ParsedInvitationSalary {
  const compactText = toHalfWidth(rawText).replace(/\s+/g, "");
  const amountPattern = "([0-9Oo][0-9Oo,，.]{0,19})";

  const monthlySalary = matchAmount(compactText, [
    new RegExp(`原则每月发放(?:人民币)?${amountPattern}元`),
    new RegExp(`月度税前工资(?:为|[:：])?(?:人民币)?${amountPattern}元`),
    new RegExp(`每月税前工资(?:为|[:：])?(?:人民币)?${amountPattern}元`),
    new RegExp(`税前月工资(?:为|[:：])?(?:人民币)?${amountPattern}元`),
    new RegExp(`月保障薪酬(?:为|[:：])(?:人民币)?${amountPattern}元`),
  ]);
  const annualSalary = matchAmount(compactText, [
    new RegExp(`年保障薪酬(?:为|[:：])(?:人民币)?${amountPattern}元`),
    new RegExp(`年度税前工资(?:为|[:：])?(?:人民币)?${amountPattern}元`),
  ]);

  if (!monthlySalary) {
    return {
      monthlySalary: null,
      annualSalary,
      message: "未识别到月度税前工资",
    };
  }

  if (annualSalary) {
    const expectedAnnualSalary = multiplyPayrollAmountByInteger(
      monthlySalary,
      12,
    );
    if (comparePayrollAmounts(expectedAnnualSalary, annualSalary) !== 0) {
      return {
        monthlySalary: null,
        annualSalary,
        message: "识别到的月保障薪酬与年保障薪酬不一致",
      };
    }
  }

  return { monthlySalary, annualSalary, message: "入职邀请函月保障薪酬识别成功" };
}

async function extractFirstPageText(pdfPath: string): Promise<string> {
  const result = (await execFileAsync(
    "pdftotext",
    ["-f", "1", "-l", "1", "-layout", pdfPath, "-"],
    { timeout: 30000, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
  )) as { stdout: string };
  return result.stdout || "";
}

async function recognizeFirstPageImage(
  pdfPath: string,
  dpi: number,
): Promise<string> {
  const outputPrefix = `${pdfPath}-invitation-${process.pid}-${Date.now()}-${dpi}`;
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
        "1",
        "-l",
        "1",
        pdfPath,
        outputPrefix,
      ],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
    );
    if (!fs.existsSync(imagePath)) throw new Error("入职邀请函第一页转图片失败");
    return await callPaddleOcr(imagePath);
  } finally {
    try {
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    } catch {
      /* 忽略临时文件清理失败 */
    }
  }
}

export async function recognizeInvitationMonthlySalary(
  pdfPath: string,
): Promise<InvitationSalaryRecognition> {
  try {
    if (!fs.existsSync(pdfPath)) {
      return {
        status: "failed",
        monthlySalary: null,
        message: "入职邀请函文件不存在",
      };
    }

    const header = Buffer.alloc(5);
    const fileDescriptor = fs.openSync(pdfPath, "r");
    try {
      fs.readSync(fileDescriptor, header, 0, 5, 0);
    } finally {
      fs.closeSync(fileDescriptor);
    }
    if (header.toString("ascii") !== "%PDF-") {
      return {
        status: "failed",
        monthlySalary: null,
        message: "入职邀请函不是有效的PDF文件",
      };
    }

    try {
      const text = await extractFirstPageText(pdfPath);
      const parsed = parseInvitationSalaryText(text);
      if (parsed.monthlySalary) {
        return {
          status: "success",
          monthlySalary: parsed.monthlySalary,
          message: parsed.message,
          method: "text",
        };
      }
    } catch (error) {
      console.warn("入职邀请函文字层提取失败，改用图片识别:", error);
    }

    let lastMessage = "未识别到入职邀请函月保障薪酬";
    for (const dpi of [300, 600]) {
      try {
        const text = await recognizeFirstPageImage(pdfPath, dpi);
        const parsed = parseInvitationSalaryText(text);
        lastMessage = parsed.message;
        if (parsed.monthlySalary) {
          return {
            status: "success",
            monthlySalary: parsed.monthlySalary,
            message: parsed.message,
            method: "image",
          };
        }
      } catch (error) {
        lastMessage =
          error instanceof Error ? error.message : "入职邀请函图片识别失败";
      }
    }

    return { status: "failed", monthlySalary: null, message: lastMessage };
  } catch (error) {
    return {
      status: "failed",
      monthlySalary: null,
      message: error instanceof Error ? error.message : "入职邀请函识别失败",
    };
  }
}
