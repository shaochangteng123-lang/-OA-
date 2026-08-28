import fs from "fs";
import path from "path";
import {
  extractContractBusinessNumber,
  extractContractLeaseTerms,
  recognizeContractFile,
  type ContractOcrField,
} from "../services/contractOcr.js";
import { db, pool } from "../db/index.js";
import { shutdownOcrDaemon } from "../services/ocrDaemon.js";

const BATCH_KEY = "historical-import-2026-08-26-confirmed-v1";
const DEFAULT_OUTPUT = path.resolve(
  process.cwd(),
  "debug/historical-import-run-2026-08-26/recovered-asset-structured-fields.json",
);

interface SourceRow {
  sequence: number;
  contract_id: string;
  contract_no: string;
  title: string;
  declared_subtype: string | null;
  file_name: string;
  file_path: string;
  mime_type: string;
  file_type: string;
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

function evidenceLines(
  lines: Array<{ text: string; page: number; confidence: number }>,
) {
  const anchor =
    /合同编号|甲方|乙方|委托方|受托方|出租方|承租方|租赁期限|租期|月租|租金|物业|停车|车位|服务期限|合同期限/u;
  return lines
    .filter((line) => anchor.test(String(line.text || "")))
    .slice(0, 160)
    .map((line) => ({
      page: Number(line.page) || 1,
      text: String(line.text || ""),
      confidence: Number(line.confidence || 0),
    }));
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
       contract.contract_no, contract.title, contract.declared_subtype,
       file.file_name, file.file_path, file.mime_type, file.file_type
     FROM imported_roots imported
     JOIN contracts contract ON contract.id=imported.contract_id
     JOIN LATERAL (
       SELECT current_file.* FROM contract_files current_file
       WHERE current_file.contract_id=contract.id
         AND current_file.is_current=TRUE
         AND current_file.file_type IN ('sealed_contract','other')
       ORDER BY CASE current_file.file_type WHEN 'sealed_contract' THEN 0 ELSE 1 END,
         current_file.created_at, current_file.id
       LIMIT 1
     ) file ON TRUE
     WHERE contract.category='asset'
     ORDER BY imported.sequence`,
    BATCH_KEY,
  );

  const output: Record<string, unknown> = {
    batchKey: BATCH_KEY,
    generatedAt: new Date().toISOString(),
    model: "PP-OCRv6_medium",
    contracts: [] as unknown[],
  };
  const contracts = output.contracts as unknown[];
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  for (const [index, row] of rows.entries()) {
    const absolutePath = uploadAbsolutePath(row.file_path);
    process.stdout.write(
      `[${index + 1}/${rows.length}] 识别历史资产合同序号 ${row.sequence}：${row.file_name}\n`,
    );
    const result = await recognizeContractFile(absolutePath, row.mime_type, {
      expectedCategory: "asset",
      relationType: "main",
      ocrModel: "v6_medium",
    });
    const businessNumber = extractContractBusinessNumber(result.ocrLines);
    const leaseTerms = extractContractLeaseTerms(result.rawText, "asset");
    contracts.push({
      sequence: row.sequence,
      contractId: row.contract_id,
      contractNo: row.contract_no,
      title: row.title,
      declaredSubtype: row.declared_subtype,
      fileName: row.file_name,
      filePath: row.file_path,
      fileType: row.file_type,
      recognition: {
        status: result.status,
        failureKind: result.failureKind || null,
        method: result.method,
        modelVersion: result.modelVersion || null,
        warnings: result.warnings,
      },
      fields: fieldMap(result.fields),
      businessContractNumber: businessNumber,
      leaseTerms,
      evidenceLines: evidenceLines(result.ocrLines),
    });
    await fs.promises.writeFile(
      outputPath,
      `${JSON.stringify(output, null, 2)}\n`,
      "utf8",
    );
  }

  process.stdout.write(`结构化字段恢复结果已写入：${outputPath}\n`);
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
