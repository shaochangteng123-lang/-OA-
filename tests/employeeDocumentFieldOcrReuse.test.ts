/** @jest-environment node */

jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcr: jest.fn(),
}));

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { callPaddleOcr } from "../server/services/ocrDaemon";
import { recognizeEmploymentContractTerm } from "../server/services/employmentContractOcr";
import { recognizeInvitationMonthlySalary } from "../server/services/invitationSalaryOcr";

const execFileMock = execFile as unknown as jest.Mock;
const callPaddleOcrMock = jest.mocked(callPaddleOcr);

type ExecFileCallback = (
  error: Error | null,
  result?: { stdout: string; stderr: string },
) => void;

async function withTestPdf<T>(
  pageCount: number,
  callback: (pdfPath: string) => Promise<T>,
): Promise<T> {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "employee-document-field-ocr-"),
  );
  const pdfPath = path.join(tempDirectory, "测试档案.pdf");

  try {
    const document = await PDFDocument.create();
    for (let index = 0; index < pageCount; index += 1) {
      document.addPage([595, 842]);
    }
    fs.writeFileSync(pdfPath, await document.save());
    return await callback(pdfPath);
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

function mockPdfCommands(extractedText: string): void {
  execFileMock.mockImplementation(
    (
      command: string,
      args: string[],
      _options: unknown,
      callback: ExecFileCallback,
    ) => {
      if (command === "pdftotext") {
        callback(null, { stdout: extractedText, stderr: "" });
        return undefined;
      }

      if (command === "pdftoppm") {
        const outputPrefix = args.at(-1);
        if (!outputPrefix) throw new Error("缺少图片输出路径");
        fs.writeFileSync(`${outputPrefix}.png`, "测试图片");
        callback(null, { stdout: "", stderr: "" });
        return undefined;
      }

      throw new Error(`未处理的测试命令：${command}`);
    },
  );
}

describe("员工档案字段预识别文字复用", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    callPaddleOcrMock.mockReset();
  });

  it("入职邀请函文字层为空且预识别候选一致时不再图片识别", async () => {
    mockPdfCommands("");
    await withTestPdf(1, async (pdfPath) => {
      const result = await recognizeInvitationMonthlySalary(pdfPath, {
        preRecognizedPageTextCandidates: [
          "月保障薪酬为8000元，年保障薪酬为96000元",
          "年保障薪酬为96000元\n月保障薪酬为8000元",
        ],
      });

      expect(result).toEqual({
        status: "success",
        monthlySalary: "8000",
        message: "入职邀请函月保障薪酬识别成功",
        method: "image",
      });
      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(callPaddleOcrMock).not.toHaveBeenCalled();
    });
  });

  it("入职邀请函预识别文字未命中时完整保留300和600分辨率回退", async () => {
    mockPdfCommands("");
    callPaddleOcrMock
      .mockResolvedValueOnce("未识别到工资金额")
      .mockResolvedValueOnce("原则每月发放人民币8000元");

    await withTestPdf(1, async (pdfPath) => {
      const result = await recognizeInvitationMonthlySalary(pdfPath, {
        preRecognizedPageTextCandidates: ["未识别到工资金额"],
      });

      expect(result).toMatchObject({
        status: "success",
        monthlySalary: "8000",
        method: "image",
      });
      expect(callPaddleOcrMock).toHaveBeenCalledTimes(2);
      const renderedDpis = execFileMock.mock.calls
        .filter(([command]) => command === "pdftoppm")
        .map(([, args]: [string, string[]]) => {
          const dpiIndex = args.indexOf("-r");
          return args[dpiIndex + 1];
        });
      expect(renderedDpis).toEqual(["300", "600"]);
    });
  });

  it("入职邀请函不传复用参数时保持原文字层路径", async () => {
    mockPdfCommands("原则每月发放人民币9000元");

    await withTestPdf(1, async (pdfPath) => {
      const result = await recognizeInvitationMonthlySalary(pdfPath);

      expect(result).toMatchObject({
        status: "success",
        monthlySalary: "9000",
        method: "text",
      });
      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(callPaddleOcrMock).not.toHaveBeenCalled();
    });
  });

  it("入职邀请函优先使用准确文字层并忽略冲突的预识别候选", async () => {
    mockPdfCommands("原则每月发放人民币9000元");

    await withTestPdf(1, async (pdfPath) => {
      const result = await recognizeInvitationMonthlySalary(pdfPath, {
        preRecognizedPageTextCandidates: [
          "月保障薪酬为8000元",
          "月保障薪酬为7000元",
        ],
      });

      expect(result).toMatchObject({
        status: "success",
        monthlySalary: "9000",
        method: "text",
      });
      expect(callPaddleOcrMock).not.toHaveBeenCalled();
    });
  });

  it("劳动合同按原优先页序使用预识别文字", async () => {
    mockPdfCommands("");
    await withTestPdf(2, async (pdfPath) => {
      const result = await recognizeEmploymentContractTerm(pdfPath, {
        preRecognizedPageTextCandidates: new Map([
          [1, ["劳动合同期限，自2025年1月1日起至2026年1月1日。"]],
          [
            2,
            [
              "劳动合同期限，自2026年1月1日起至2029年1月1日。",
              "劳动合同期限\n自2026年1月1日起至2029年1月1日。",
            ],
          ],
        ]),
      });

      expect(result).toMatchObject({
        status: "success",
        contractStartDate: "2026-01-01",
        contractEndDate: "2029-01-01",
        method: "image",
        pageNumber: 2,
      });
      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(callPaddleOcrMock).not.toHaveBeenCalled();
    });
  });

  it("劳动合同预识别文字未命中时完整保留300和600分辨率回退", async () => {
    mockPdfCommands("");
    callPaddleOcrMock
      .mockResolvedValueOnce("未识别到合同期限")
      .mockResolvedValueOnce(
        "劳动合同期限，自2025年6月16日起至2026年6月15日。",
      );

    await withTestPdf(1, async (pdfPath) => {
      const result = await recognizeEmploymentContractTerm(pdfPath, {
        preRecognizedPageTextCandidates: new Map([[1, ["未识别到合同期限"]]]),
      });

      expect(result).toMatchObject({
        status: "success",
        contractStartDate: "2025-06-16",
        contractEndDate: "2026-06-15",
        method: "image",
        pageNumber: 1,
      });
      expect(callPaddleOcrMock).toHaveBeenCalledTimes(2);
      const renderedDpis = execFileMock.mock.calls
        .filter(([command]) => command === "pdftoppm")
        .map(([, args]: [string, string[]]) => {
          const dpiIndex = args.indexOf("-r");
          return args[dpiIndex + 1];
        });
      expect(renderedDpis).toEqual(["300", "600"]);
    });
  });

  it("劳动合同不传复用参数时保持原文字层路径", async () => {
    mockPdfCommands("劳动合同期限，自2024年1月1日起至2027年12月31日。");

    await withTestPdf(1, async (pdfPath) => {
      const result = await recognizeEmploymentContractTerm(pdfPath);

      expect(result).toMatchObject({
        status: "success",
        contractStartDate: "2024-01-01",
        contractEndDate: "2027-12-31",
        method: "text",
      });
      expect(execFileMock).toHaveBeenCalledTimes(1);
      expect(callPaddleOcrMock).not.toHaveBeenCalled();
    });
  });
});
