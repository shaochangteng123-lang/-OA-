import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { db, pool } from "../db/index.js";
import {
  extractContractBusinessNumber,
  parseContractText,
  type ContractOcrField,
  type ContractRawOcrLine,
} from "../services/contractOcr.js";
import {
  callPaddleOcrDetailed,
  shutdownOcrDaemon,
} from "../services/ocrDaemon.js";

const execFileAsync = promisify(execFile);
const BATCH_KEY = "historical-import-2026-08-26-confirmed-v1";
const DEFAULT_OUTPUT = path.resolve(
  process.cwd(),
  "debug/historical-import-run-2026-08-26/recovered-main-first-page-fields.json",
);

interface SourceRow {
  sequence: number;
  contract_id: string;
  contract_no: string;
  title: string;
  file_id: string;
  file_name: string;
  file_path: string;
  mime_type: string;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function uploadAbsolutePath(storedPath: string): string {
  const normalized = storedPath.replace(/^\/+/, "");
  if (!normalized.startsWith("uploads/")) {
    throw new Error(`历史文件路径不在 uploads 目录：${storedPath}`);
  }
  return path.resolve(process.cwd(), normalized);
}

function fieldMap(fields: ContractOcrField[]) {
  return Object.fromEntries(
    fields.map((field) => [
      field.field,
      {
        value: field.normalizedValue || null,
        originalValue: field.originalValue || null,
        fieldScore: field.fieldScore,
        ocrConfidence: field.ocrConfidence,
        source: field.source,
        pageNumber: field.pageNumber || null,
        warnings: field.warnings || [],
      },
    ]),
  );
}

async function main() {
  const outputPath = path.resolve(argument("--output") || DEFAULT_OUTPUT);
  const rows = await db.all<SourceRow>(
    `WITH imported_roots AS (
       SELECT audit.contract_id,
         (audit.changes_json->>'sequence')::int AS sequence
       FROM contract_audit_logs audit
       WHERE audit.action='historical_contract_imported'
         AND audit.changes_json->>'batchKey'=?
     )
     SELECT imported.sequence, contract.id AS contract_id,
       contract.contract_no, contract.title, file.id AS file_id,
       file.file_name, file.file_path, file.mime_type
     FROM imported_roots imported
     JOIN contracts contract ON contract.id=imported.contract_id
      AND contract.category='main_business'
     JOIN contract_files file ON file.contract_id=contract.id
      AND file.is_current=TRUE AND file.file_type='sealed_contract'
     ORDER BY imported.sequence`,
    BATCH_KEY,
  );
  const output: Record<string, unknown> = {
    batchKey: BATCH_KEY,
    generatedAt: new Date().toISOString(),
    model: "PP-OCRv6_medium",
    page: 1,
    contracts: [] as unknown[],
  };
  const contracts = output.contracts as unknown[];
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "historical-main-first-page-"),
  );
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    for (const [index, row] of rows.entries()) {
      process.stdout.write(
        `[${index + 1}/${rows.length}] 识别主营合同首页：${row.file_name}\n`,
      );
      const sourcePath = uploadAbsolutePath(row.file_path);
      const prefix = path.join(temporaryDirectory, row.file_id);
      await execFileAsync(
        "pdftoppm",
        ["-f", "1", "-singlefile", "-png", "-r", "300", sourcePath, prefix],
        { maxBuffer: 2 * 1024 * 1024 },
      );
      const recognition = await callPaddleOcrDetailed(
        `${prefix}.png`,
        "v6_medium",
      );
      const rawLines: ContractRawOcrLine[] = recognition.lines.map((line) => ({
        page: 1,
        text: line.text,
        bbox: line.box,
        confidence: line.confidence,
        modelVersion: recognition.modelVersion,
      }));
      for (const qrCode of recognition.qrCodes || []) {
        rawLines.push({
          page: 1,
          text: `二维码合同编号：${qrCode}`,
          bbox: [],
          confidence: 1,
          modelVersion: recognition.modelVersion,
        });
      }
      const averageConfidence = recognition.lines.length
        ? recognition.lines.reduce((sum, line) => sum + line.confidence, 0) /
          recognition.lines.length
        : 0;
      const text = [
        recognition.fullText,
        ...(recognition.qrCodes || []).map(
          (qrCode) => `二维码合同编号：${qrCode}`,
        ),
      ]
        .filter(Boolean)
        .join("\n");
      const parsed = parseContractText("", {
        sources: [
          {
            text,
            source: "ocr_300",
            pageNumber: 1,
            confidence: averageConfidence,
            lineConfidences: recognition.lines.map((line) => line.confidence),
            recognitionEngine: "paddleocr",
            modelVersion: recognition.modelVersion,
            ocrLines: rawLines,
          },
        ],
        expectedCategory: "main_business",
        relationType: "main",
      });
      contracts.push({
        sequence: row.sequence,
        contractId: row.contract_id,
        contractNo: row.contract_no,
        title: row.title,
        fileId: row.file_id,
        fileName: row.file_name,
        filePath: row.file_path,
        status: parsed.status,
        method: "first_page_ocr",
        modelVersion: recognition.modelVersion,
        qrCodes: recognition.qrCodes || [],
        businessContractNumber: extractContractBusinessNumber(rawLines),
        fields: fieldMap(parsed.fields),
        evidenceLines: rawLines.map((line) => ({
          page: line.page,
          text: line.text,
          confidence: line.confidence,
        })),
        warnings: parsed.warnings,
      });
      await fs.promises.writeFile(
        outputPath,
        `${JSON.stringify(output, null, 2)}\n`,
        "utf8",
      );
    }
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
  process.stdout.write(`主营合同首页恢复结果已写入：${outputPath}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    shutdownOcrDaemon();
    await pool.end();
  });
