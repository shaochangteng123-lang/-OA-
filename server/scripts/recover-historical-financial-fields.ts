import fs from "fs";
import path from "path";
import { db, pool } from "../db/index.js";
import { recognizeContractFinancialDocument } from "../services/contractFinancialOcr.js";
import { shutdownOcrDaemon } from "../services/ocrDaemon.js";
import {
  CONTRACT_COMPANY_LEGAL_NAMES,
  CONTRACT_COMPANY_SUBJECTS,
  CONTRACT_COMPANY_TAX_IDS,
} from "../services/contractFinancialWorkflow.js";

const BATCH_KEY = "historical-import-2026-08-26-confirmed-v1";
const ENGINEERING_ASSET_SEQUENCES = new Set([78, 79, 80, 81, 89]);
const DEFAULT_OUTPUT = path.resolve(
  process.cwd(),
  "debug/historical-import-run-2026-08-26/recovered-asset-financial-fields.json",
);

interface SourceRow {
  sequence: number;
  contract_id: string;
  contract_no: string;
  title: string;
  category: "main_business" | "asset";
  declared_subtype: string | null;
  file_id: string;
  file_name: string;
  file_path: string;
  file_type: "invoice" | "receipt" | "payment";
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

function contractCompanySubject(row: SourceRow) {
  const name =
    row.category === "main_business" ||
    ENGINEERING_ASSET_SEQUENCES.has(row.sequence)
      ? "北京羽隶工程咨询有限公司"
      : "北京羽隶科技有限公司";
  const subject = CONTRACT_COMPANY_SUBJECTS.find(
    (candidate) => candidate.name === name,
  );
  if (!subject) throw new Error(`未配置公司主体：${name}`);
  return { name: subject.name, taxId: subject.taxId };
}

async function main() {
  const scope = argument("--scope") || "asset";
  if (!["asset", "main_business", "all"].includes(scope)) {
    throw new Error("--scope 仅支持 asset、main_business 或 all");
  }
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
       contract.contract_no, contract.title, contract.category,
       contract.declared_subtype, file.id AS file_id, file.file_name,
       file.file_path, file.file_type
     FROM imported_roots imported
     JOIN contracts contract ON contract.id=imported.contract_id
     JOIN contract_files file ON file.contract_id=contract.id
       AND file.is_current=TRUE
       AND file.file_type IN ('invoice','receipt','payment')
     WHERE (?='all' OR contract.category=?)
     ORDER BY imported.sequence,
       CASE file.file_type WHEN 'invoice' THEN 0 ELSE 1 END,
       file.file_name, file.id`,
    BATCH_KEY,
    scope,
    scope,
  );
  const output: Record<string, unknown> = {
    batchKey: BATCH_KEY,
    scope,
    generatedAt: new Date().toISOString(),
    engine: "PP-OCRv6_medium",
    documents: [] as unknown[],
  };
  const documents = output.documents as unknown[];
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  for (const [index, row] of rows.entries()) {
    process.stdout.write(
      `[${index + 1}/${rows.length}] 识别序号 ${row.sequence}：${row.file_name}\n`,
    );
    const result = await recognizeContractFinancialDocument({
      filePath: uploadAbsolutePath(row.file_path),
      kind: row.file_type === "invoice" ? "invoice" : "bank_receipt",
      context: {
        companyNames: CONTRACT_COMPANY_LEGAL_NAMES,
        companyTaxIds: CONTRACT_COMPANY_TAX_IDS,
        companySubjects: CONTRACT_COMPANY_SUBJECTS,
        contractCompanySubject: contractCompanySubject(row),
        requireInvoiceLineItems:
          row.file_type === "invoice" &&
          row.declared_subtype === "house_rental",
        allowTaxExemptInvoice:
          row.file_type === "invoice" &&
          row.declared_subtype === "vehicle_rental",
        internalFundingPair:
          row.category === "asset" &&
          !ENGINEERING_ASSET_SEQUENCES.has(row.sequence)
            ? {
                payerName: "北京羽隶工程咨询有限公司",
                payeeName: "北京羽隶科技有限公司",
              }
            : undefined,
      },
    });
    documents.push({
      sequence: row.sequence,
      contractId: row.contract_id,
      contractNo: row.contract_no,
      title: row.title,
      category: row.category,
      declaredSubtype: row.declared_subtype,
      fileId: row.file_id,
      fileName: row.file_name,
      filePath: row.file_path,
      importedFileType: row.file_type,
      result,
    });
    await fs.promises.writeFile(
      outputPath,
      `${JSON.stringify(output, null, 2)}\n`,
      "utf8",
    );
  }

  process.stdout.write(`财务字段恢复结果已写入：${outputPath}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    shutdownOcrDaemon();
    await pool.end();
    process.exit(process.exitCode || 0);
  });
