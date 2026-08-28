import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { db, pool } from "../db/index.js";

const execFileAsync = promisify(execFile);
const BATCH_KEY = "historical-import-2026-08-26-confirmed-v1";
const DEFAULT_OUTPUT = path.resolve(
  process.cwd(),
  "debug/historical-import-run-2026-08-26/recovered-contract-qrcodes.json",
);
const PYTHON_DECODE = String.raw`
import cv2, json, sys
image = cv2.imread(sys.argv[1])
if image is None:
    print("[]")
    raise SystemExit(0)
detector = cv2.QRCodeDetector()
decoded = []
try:
    ok, values, _, _ = detector.detectAndDecodeMulti(image)
    if ok:
        decoded.extend(str(value).strip() for value in values if str(value).strip())
except Exception:
    pass
if not decoded:
    try:
        value, _, _ = detector.detectAndDecode(image)
        if str(value).strip():
            decoded.append(str(value).strip())
    except Exception:
        pass
print(json.dumps(list(dict.fromkeys(decoded)), ensure_ascii=False))
`;

interface ContractFileRow {
  sequence: number;
  contract_id: string;
  contract_no: string;
  relation_type: "main" | "supplement" | "termination";
  supplement_sequence: number | null;
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

async function decodeImageQrCodes(imagePath: string): Promise<string[]> {
  const result = await execFileAsync(
    "python3",
    ["-c", PYTHON_DECODE, imagePath],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  const decoded = JSON.parse(result.stdout || "[]");
  return Array.isArray(decoded)
    ? decoded.map((value) => String(value).trim()).filter(Boolean)
    : [];
}

async function decodeQrCodes(
  row: ContractFileRow,
  temporaryDirectory: string,
  allPagesIfMissing: boolean,
): Promise<{ qrCodes: string[]; pageNumbers: number[] }> {
  const sourcePath = uploadAbsolutePath(row.file_path);
  let imagePath = sourcePath;
  if (row.mime_type === "application/pdf") {
    const prefix = path.join(temporaryDirectory, row.file_id);
    await execFileAsync(
      "pdftoppm",
      ["-f", "1", "-singlefile", "-png", "-r", "300", sourcePath, prefix],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    imagePath = `${prefix}.png`;
  }
  const firstPage = await decodeImageQrCodes(imagePath);
  if (
    firstPage.length > 0 ||
    !allPagesIfMissing ||
    row.mime_type !== "application/pdf"
  ) {
    return {
      qrCodes: firstPage,
      pageNumbers: firstPage.length ? [1] : [],
    };
  }

  const allPagesPrefix = path.join(temporaryDirectory, `${row.file_id}-all`);
  await execFileAsync(
    "pdftoppm",
    ["-png", "-r", "300", sourcePath, allPagesPrefix],
    { maxBuffer: 2 * 1024 * 1024 },
  );
  const pageFiles = (await fs.promises.readdir(temporaryDirectory))
    .filter(
      (fileName) =>
        fileName.startsWith(`${row.file_id}-all-`) && fileName.endsWith(".png"),
    )
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
  const values: string[] = [];
  const pages: number[] = [];
  for (const [index, fileName] of pageFiles.entries()) {
    const decoded = await decodeImageQrCodes(
      path.join(temporaryDirectory, fileName),
    );
    if (!decoded.length) continue;
    values.push(...decoded);
    pages.push(index + 1);
  }
  return {
    qrCodes: [...new Set(values)],
    pageNumbers: pages,
  };
}

async function main() {
  const outputPath = path.resolve(argument("--output") || DEFAULT_OUTPUT);
  const allPagesIfMissing = process.argv.includes("--all-pages-if-missing");
  const rows = await db.all<ContractFileRow>(
    `WITH imported_roots AS (
       SELECT audit.contract_id,
         (audit.changes_json->>'sequence')::int AS sequence
       FROM contract_audit_logs audit
       WHERE audit.action='historical_contract_imported'
         AND audit.changes_json->>'batchKey'=?
     )
     SELECT imported.sequence, contract.id AS contract_id,
       contract.contract_no, contract.relation_type,
       contract.supplement_sequence, contract.title,
       file.id AS file_id, file.file_name, file.file_path, file.mime_type
     FROM imported_roots imported
     JOIN contracts contract
       ON COALESCE(contract.root_contract_id,contract.id)=imported.contract_id
      AND contract.is_deleted=FALSE
     JOIN contract_files file ON file.contract_id=contract.id
      AND file.is_current=TRUE AND file.file_type='sealed_contract'
     ORDER BY imported.sequence,
       CASE contract.relation_type WHEN 'main' THEN 0 WHEN 'supplement' THEN 1 ELSE 2 END,
       contract.supplement_sequence NULLS FIRST, contract.id`,
    BATCH_KEY,
  );
  const output: Record<string, unknown> = {
    batchKey: BATCH_KEY,
    generatedAt: new Date().toISOString(),
    firstPageDpi: 300,
    allPagesIfMissing,
    contracts: [] as unknown[],
  };
  const contracts = output.contracts as unknown[];
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "historical-contract-qrcodes-"),
  );
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  try {
    for (const [index, row] of rows.entries()) {
      process.stdout.write(
        `[${index + 1}/${rows.length}] 读取二维码：${row.file_name}\n`,
      );
      let qrCodes: string[] = [];
      let qrCodePageNumbers: number[] = [];
      let error: string | null = null;
      try {
        const decoded = await decodeQrCodes(
          row,
          temporaryDirectory,
          allPagesIfMissing,
        );
        qrCodes = decoded.qrCodes;
        qrCodePageNumbers = decoded.pageNumbers;
      } catch (decodeError) {
        error =
          decodeError instanceof Error
            ? decodeError.message
            : String(decodeError);
      }
      contracts.push({ ...row, qrCodes, qrCodePageNumbers, error });
      await fs.promises.writeFile(
        outputPath,
        `${JSON.stringify(output, null, 2)}\n`,
        "utf8",
      );
    }
  } finally {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true });
  }
  process.stdout.write(`二维码恢复结果已写入：${outputPath}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
