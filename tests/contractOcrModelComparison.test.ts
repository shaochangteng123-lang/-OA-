/** @jest-environment node */

import fs from "fs";
import path from "path";

jest.mock("../server/services/contractOcr", () => ({
  recognizeContractFile: jest.fn(async (_filePath, _mimeType, options) => ({
    status: "partial",
    method: "pdf_ocr",
    fields: [
      {
        field: "amount",
        originalValue: "100000元",
        normalizedValue: "100000.00",
        confidence: options.ocrModel === "v5_server" ? 98 : 94,
        source: "ocr_300",
        pageNumber: 3,
        warnings: [],
      },
    ],
    rawText: "合同金额：100000元",
    warnings: [],
    ocrLines: [
      {
        page: 3,
        text: "合同金额：100000元",
        bbox: [
          [10, 20],
          [180, 20],
          [180, 45],
          [10, 45],
        ],
        confidence: 0.98,
        modelVersion: options.ocrModel,
      },
    ],
    modelVersion: options.ocrModel,
  })),
}));

import { recognizeContractFile } from "../server/services/contractOcr";
import { compareContractOcrModels } from "../server/services/contractOcrComparison";

const recognizeContractFileMock = jest.mocked(recognizeContractFile);

describe("合同 OCR（光学字符识别）双模型诊断", () => {
  beforeEach(() => {
    recognizeContractFileMock.mockClear();
  });

  it("同一原件依次使用两套模型且返回耗时、字段和置信度", async () => {
    const results = await compareContractOcrModels(
      "/tmp/contract.pdf",
      "application/pdf",
      { expectedCategory: "main_business", relationType: "main" },
    );

    expect(recognizeContractFileMock).toHaveBeenCalledTimes(2);
    expect(recognizeContractFileMock.mock.calls.map((call) => call[2])).toEqual(
      [
        {
          expectedCategory: "main_business",
          relationType: "main",
          ocrModel: "v4_mobile",
          diagnosticOcrOnly: true,
        },
        {
          expectedCategory: "main_business",
          relationType: "main",
          ocrModel: "v5_server",
          diagnosticOcrOnly: true,
        },
      ],
    );
    expect(results.map((result) => result.modelVersion)).toEqual([
      "v4_mobile",
      "v5_server",
    ]);
    expect(results.every((result) => result.durationMs >= 0)).toBe(true);
    expect(results.map((result) => result.fields[0].confidence)).toEqual([
      94, 98,
    ]);
    expect(results.every((result) => result.ocrLineCount === 1)).toBe(true);
  });

  it("测试接口固定读取当前合同原件且不写入合同业务字段", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    const routeStart = routeSource.indexOf('"/:id/ocr-model-comparison"');
    const routeEnd = routeSource.indexOf(
      'router.patch("/:id/asset-funding-mode"',
      routeStart,
    );
    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(routeEnd).toBeGreaterThan(routeStart);
    const routeBlock = routeSource.slice(routeStart, routeEnd);
    expect(routeBlock).toContain("compareContractOcrModels");
    expect(routeBlock).toContain("file.file_type = 'draft_contract'");
    expect(routeBlock).not.toContain("UPDATE contracts");
    expect(routeBlock).not.toContain("contract_ocr_fields");
  });

  it("数据库保存完整逐行识别结果的必要字段", () => {
    const databaseSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    expect(databaseSource).toContain(
      "CREATE TABLE IF NOT EXISTS contract_ocr_lines",
    );
    expect(databaseSource).toContain("page_number INTEGER NOT NULL");
    expect(databaseSource).toContain("text TEXT NOT NULL");
    expect(databaseSource).toContain("bbox JSONB NOT NULL");
    expect(databaseSource).toContain("confidence NUMERIC(8,6) NOT NULL");
    expect(databaseSource).toContain("model_version TEXT NOT NULL");
  });
});
