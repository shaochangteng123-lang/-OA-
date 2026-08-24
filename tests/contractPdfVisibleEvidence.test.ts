/** @jest-environment node */

jest.mock("child_process", () => ({
  execFile: jest.fn(),
}));

jest.mock("../server/services/ocrDaemon", () => ({
  callPaddleOcrDetailed: jest.fn(),
}));
jest.mock("nanoid", () => ({ nanoid: () => "pdf-visible-evidence-id" }));
jest.mock("../server/db/index", () => ({ db: {} }));

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { callPaddleOcrDetailed } from "../server/services/ocrDaemon";
import {
  getContractAmountAutomaticAdoptionContext,
  getContractOcrCandidateFunnelIsolationProof,
  getContractOcrCandidateFunnelTrace,
  getContractOcrAutomaticAdoptionSafetyContext,
  recognizeContractFile,
} from "../server/services/contractOcr";
import { decideContractAutomaticOcrAdoption } from "../server/services/contractService";

const execFileMock = execFile as unknown as jest.Mock;
const callPaddleOcrDetailedMock = jest.mocked(callPaddleOcrDetailed);

type ExecFileCallback = (
  error: Error | null,
  result?: { stdout: string; stderr: string },
) => void;

const contractText = [
  "工程咨询服务合同",
  "项目名称：东城更新项目",
  "甲方：北京建设有限公司",
  "乙方：北京咨询有限公司",
  "合同金额：100000元",
  "合同签订日期：2026年8月5日",
].join("\n");

const ocrLines = contractText.split("\n").map((text) => ({
  text,
  confidence: 0.99,
  box: [] as number[][],
}));

function optionNumber(
  args: string[],
  option: string,
  fallback: number,
): number {
  const index = args.indexOf(option);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

describe("合同 PDF 可见页面独立证据", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "contract-pdf-visible-evidence-"),
    );
    execFileMock.mockReset();
    callPaddleOcrDetailedMock.mockReset();
    callPaddleOcrDetailedMock.mockResolvedValue({
      lines: ocrLines,
      fullText: contractText,
      modelVersion: "v4_mobile",
    });
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("完整电子文字层仍渲染可见页面并经模拟图像识别一致后才成功", async () => {
    execFileMock.mockImplementation(
      (
        command: string,
        args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => {
        if (command === "pdftotext") {
          callback(null, { stdout: contractText, stderr: "" });
          return undefined;
        }
        if (command === "pdftoppm") {
          const outputPrefix = args.at(-1);
          if (!outputPrefix) throw new Error("缺少页面输出路径");
          const width = optionNumber(args, "-W", 2_480);
          const height = optionNumber(args, "-H", 840);
          void sharp({
            create: {
              width,
              height,
              channels: 3,
              background: "white",
            },
          })
            .png()
            .toFile(`${outputPrefix}.png`)
            .then(
              () => callback(null, { stdout: "", stderr: "" }),
              (error: Error) => callback(error),
            );
          return undefined;
        }
        throw new Error(`未处理的测试命令：${command}`);
      },
    );

    const document = await PDFDocument.create();
    document.addPage([595.28, 841.89]);
    const filePath = path.join(temporaryDirectory, "完整文字层合同.pdf");
    fs.writeFileSync(filePath, await document.save());

    const result = await recognizeContractFile(filePath, "application/pdf");
    const baselineOcrCalls = callPaddleOcrDetailedMock.mock.calls.length;
    const diagnostic = await recognizeContractFile(
      filePath,
      "application/pdf",
      { candidateFunnelDiagnostics: true },
    );

    expect(
      execFileMock.mock.calls.some(([command]) => command === "pdftotext"),
    ).toBe(true);
    expect(
      execFileMock.mock.calls.some(([command]) => command === "pdftoppm"),
    ).toBe(true);
    expect(callPaddleOcrDetailedMock).toHaveBeenCalled();
    expect(result.method).toBe("pdf_text_and_ocr");
    expect(result.status).toBe("succeeded");
    expect(result.fields.every((field) => field.confidence === 100)).toBe(true);
    const safety = getContractOcrAutomaticAdoptionSafetyContext(result)!;
    expect(safety.project.samePageVisibleOcrEvidence).toBe(true);
    expect(safety.amount.samePageVisibleOcrEvidence).toBe(true);
    expect(
      decideContractAutomaticOcrAdoption({
        resultStatus: result.status,
        failureKind: result.failureKind,
        relationType: "main",
        declaredCategory: "main_business",
        rawText: result.rawText,
        fields: result.fields,
        amountContext: getContractAmountAutomaticAdoptionContext(result),
        safetyContext: safety,
      }).accepted,
    ).toBe(true);
    expect(diagnostic).toEqual(result);
    expect(Object.keys(diagnostic)).toEqual(Object.keys(result));
    expect(getContractOcrCandidateFunnelIsolationProof(diagnostic)).toBe(true);
    expect(getContractOcrCandidateFunnelTrace(diagnostic)).not.toBeNull();
    expect(callPaddleOcrDetailedMock).toHaveBeenCalledTimes(
      baselineOcrCalls * 2,
    );
  });

  it("文字层字段未被可见页面识别同值时保留诊断但禁止自动采用", async () => {
    execFileMock.mockImplementation(
      (
        command: string,
        args: string[],
        _options: unknown,
        callback: ExecFileCallback,
      ) => {
        if (command === "pdftotext") {
          callback(null, { stdout: contractText, stderr: "" });
          return undefined;
        }
        if (command === "pdftoppm") {
          const outputPrefix = args.at(-1);
          if (!outputPrefix) throw new Error("缺少页面输出路径");
          const width = optionNumber(args, "-W", 2_480);
          const height = optionNumber(args, "-H", 840);
          void sharp({
            create: {
              width,
              height,
              channels: 3,
              background: "white",
            },
          })
            .png()
            .toFile(`${outputPrefix}.png`)
            .then(
              () => callback(null, { stdout: "", stderr: "" }),
              (error: Error) => callback(error),
            );
          return undefined;
        }
        throw new Error(`未处理的测试命令：${command}`);
      },
    );
    callPaddleOcrDetailedMock.mockResolvedValue({
      lines: [
        { text: "印章遮挡，未识别到项目和金额字段", confidence: 0.99, box: [] },
      ],
      fullText: "印章遮挡，未识别到项目和金额字段",
      modelVersion: "v4_mobile",
    });

    const document = await PDFDocument.create();
    document.addPage([595.28, 841.89]);
    const filePath = path.join(temporaryDirectory, "隐藏文字层风险合同.pdf");
    fs.writeFileSync(filePath, await document.save());

    const result = await recognizeContractFile(filePath, "application/pdf");
    const safety = getContractOcrAutomaticAdoptionSafetyContext(result)!;
    const decision = decideContractAutomaticOcrAdoption({
      resultStatus: result.status,
      failureKind: result.failureKind,
      relationType: "main",
      declaredCategory: "main_business",
      rawText: result.rawText,
      fields: result.fields,
      amountContext: getContractAmountAutomaticAdoptionContext(result),
      safetyContext: safety,
    });

    expect(callPaddleOcrDetailedMock).toHaveBeenCalled();
    expect(result.method).toBe("pdf_text_and_ocr");
    expect(
      result.fields.find((field) => field.field === "project_name"),
    ).toMatchObject({
      normalizedValue: "东城更新项目",
      source: "pdf_text",
    });
    expect(
      result.fields.find((field) => field.field === "amount"),
    ).toMatchObject({
      normalizedValue: "100000.00",
      source: "pdf_text",
    });
    expect(safety.project.samePageVisibleOcrEvidence).toBe(false);
    expect(safety.amount.samePageVisibleOcrEvidence).toBe(false);
    expect(decision.accepted).toBe(false);
    expect(decision.status).toBe("partial");
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        "项目名称PDF文字层候选缺少同页可见OCR同值佐证",
        "合同金额PDF文字层候选缺少同页可见OCR同值同角色佐证",
      ]),
    );
  });
});
