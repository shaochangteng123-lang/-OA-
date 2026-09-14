import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import type { PoolClient } from "pg";
import type { AnalysisHousingCostInvoice } from "./monthlyFinancialAnalysis.js";
import {
  addFinancialAmounts,
  isValidFinancialDate,
} from "./monthlyFinancialReport.js";
import {
  getContractFinancialPdfPageCount,
  extractContractFinancialPdfFirstPageTextLayer,
} from "./contractFinancialEvidence.js";

const MAX_BYTES = 8 * 1024 * 1024;
const EVIDENCE_VERSION = "housing-cost-invoice-v1";
type ParsedPeriod = { billingMonth: string | null; periodReason: string };
type InvoiceIdentity = {
  invoiceDate: string | null;
  invoiceNumber: string | null;
  invoiceAmount: string;
};
type InvoiceSource = InvoiceIdentity & {
  id: string;
  rootId: string;
  updatedAt: string | null;
  fileId: string | null;
  filePath: string | null;
  fileType: string | null;
  mimeType: string | null;
  fileRootId: string | null;
  fileOwnerDeleted: boolean | null;
  lines: AnalysisHousingCostInvoice["lines"];
};
type Extracted =
  | { text: string; reason?: never }
  | { text?: never; reason: string };
const extractedByHash = new Map<string, Promise<Extracted>>();
let activeReads = 0;
const readWaiters: Array<() => void> = [];
async function limited<T>(operation: () => Promise<T>): Promise<T> {
  if (activeReads >= 2)
    await new Promise<void>((resolve) => readWaiters.push(resolve));
  else activeReads += 1;
  try {
    return await operation();
  } finally {
    const next = readWaiters.shift();
    if (next) next();
    else activeReads -= 1;
  }
}
function amount(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value.trim()))
    return null;
  const normalized = addFinancialAmounts(value.trim());
  return normalized === "0" ? null : normalized;
}

/** 只认原票明确收费月份，且先核对发票号码和小写价税总额；开票日仅消除两位年份的世纪歧义。 */
export function parseHousingCostInvoicePeriod(
  text: string,
  identity: InvoiceIdentity,
): ParsedPeriod {
  const unknown = (periodReason: string): ParsedPeriod => ({
    billingMonth: null,
    periodReason,
  });
  if (!identity.invoiceDate || !isValidFinancialDate(identity.invoiceDate))
    return unknown("发票日期无效，收费月份待核验");
  const expectedNumber = identity.invoiceNumber?.trim();
  const expectedAmount = amount(identity.invoiceAmount);
  if (!expectedNumber || !/^\d{8,30}$/u.test(expectedNumber) || !expectedAmount)
    return unknown("发票号码或价税总额字段无效");
  if (!text || text.length > 2_000_000)
    return unknown("原票没有可用文本层，收费月份待核验");
  const compact = text.normalize("NFKC").replace(/\s+/gu, "");
  const numbers = [...compact.matchAll(/发票号码[:：]?(\d{8,30})(?!\d)/gu)].map(
    (match) => match[1],
  );
  if (!numbers.length || numbers.some((number) => number !== expectedNumber))
    return unknown("原票发票号码与已确认记录不一致或未能唯一核验");
  const totals = [
    ...compact.matchAll(
      /\(小写\)[:：]?[¥￥]?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?![\d.,])/gu,
    ),
  ].map((match) => amount(match[1].replace(/,/gu, "")));
  if (!totals.length || totals.some((total) => total !== expectedAmount))
    return unknown("原票小写价税总额与已确认金额不一致或未能唯一核验");
  const explicit = [
    ...compact.matchAll(/明细详见(\d{4}|\d{2})年(\d{1,2})月收费单/gu),
  ];
  if (!explicit.length)
    return unknown("原票未提供唯一明确的明细详见年月收费单说明");
  const mentions = [...compact.matchAll(/(\d{4}|\d{2})年(\d{1,2})月收费单/gu)];
  const invoiceYear = Number(identity.invoiceDate.slice(0, 4));
  const found = new Set<string>();
  for (const match of mentions) {
    let year = Number(match[1]);
    const month = Number(match[2]);
    if (match[1].length === 2) {
      const century = Math.floor(invoiceYear / 100) * 100;
      const candidates = [
        century - 100 + year,
        century + year,
        century + 100 + year,
      ].filter((candidate) => Math.abs(candidate - invoiceYear) <= 1);
      if (candidates.length !== 1)
        return unknown("原票两位收费年份与发票日期无法合理对应");
      year = candidates[0];
    }
    if (year < 1900 || year > 2099 || month < 1 || month > 12)
      return unknown("原票收费年月无效");
    found.add(`${year}-${String(month).padStart(2, "0")}`);
  }
  if (found.size !== 1)
    return unknown("原票存在多个不同收费月份，不能自动归期");
  return {
    billingMonth: [...found][0],
    periodReason:
      "原票文本层明确收费月份，发票号码及小写价税总额均与已确认记录一致",
  };
}

async function snapshot(filePath: string): Promise<Buffer> {
  const allowed = path.resolve(process.cwd(), "uploads", "contracts");
  const selected = path.resolve(process.cwd(), filePath);
  if (!selected.startsWith(allowed + path.sep))
    throw new Error("附件不在合同受控目录内");
  const [realRoot, realFile] = await Promise.all([
    fs.promises.realpath(allowed),
    fs.promises.realpath(selected),
  ]);
  if (!realFile.startsWith(realRoot + path.sep))
    throw new Error("附件真实路径越出合同受控目录");
  const handle = await fs.promises.open(
    realFile,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_BYTES)
      throw new Error("附件为空或超过8MiB限制");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    if (
      length !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      (await fs.promises.realpath(selected)) !== realFile
    )
      throw new Error("附件读取期间发生变化");
    const result = bytes.subarray(0, length);
    if (result.subarray(0, 5).toString("ascii") !== "%PDF-")
      throw new Error("附件实际格式不是PDF");
    return result;
  } finally {
    await handle.close();
  }
}
async function extractSnapshot(bytes: Buffer): Promise<Extracted> {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "housing-cost-evidence-"),
  );
  try {
    const file = path.join(directory, "snapshot.pdf");
    await fs.promises.writeFile(file, bytes, { mode: 0o600 });
    if ((await getContractFinancialPdfPageCount(file)) !== 1)
      return { reason: "原票不是单页PDF，收费月份待核验" };
    return { text: await extractContractFinancialPdfFirstPageTextLayer(file) };
  } catch {
    return { reason: "原票文本层提取失败，收费月份待核验" };
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}
async function invoiceEvidence(
  row: InvoiceSource,
): Promise<AnalysisHousingCostInvoice> {
  const output: AnalysisHousingCostInvoice = {
    id: row.id,
    rootId: row.rootId,
    invoiceDate: row.invoiceDate,
    invoiceNumber: row.invoiceNumber,
    invoiceAmount: row.invoiceAmount,
    billingMonth: null,
    periodReason: "原票未完成核验",
    evidenceVersion: `${EVIDENCE_VERSION}:unavailable`,
    updatedAt: row.updatedAt,
    lines: row.lines,
  };
  if (!row.invoiceDate || !isValidFinancialDate(row.invoiceDate))
    return { ...output, periodReason: "发票日期无效，收费月份待核验" };
  if (
    !row.fileId ||
    !row.filePath ||
    row.fileRootId !== row.rootId ||
    row.fileOwnerDeleted !== false ||
    row.fileType !== "invoice"
  )
    return {
      ...output,
      periodReason: "发票原件缺失、合同归属不一致或原件所属合同已删除",
    };
  if (
    row.mimeType !== "application/pdf" ||
    path.extname(row.filePath).toLowerCase() !== ".pdf"
  )
    return {
      ...output,
      periodReason: "原票不是支持的PDF文本凭证，收费月份待核验",
    };
  try {
    const bytes = await snapshot(row.filePath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    output.evidenceVersion = `${EVIDENCE_VERSION}:sha256:${hash}`;
    let extracted = extractedByHash.get(hash);
    if (!extracted) {
      extracted = extractSnapshot(bytes);
      extractedByHash.set(hash, extracted);
      if (extractedByHash.size > 128)
        extractedByHash.delete(extractedByHash.keys().next().value!);
    } else {
      extractedByHash.delete(hash);
      extractedByHash.set(hash, extracted);
    }
    const evidence = await extracted;
    if (evidence.reason) {
      extractedByHash.delete(hash);
      return { ...output, periodReason: evidence.reason };
    }
    return {
      ...output,
      ...parseHousingCostInvoicePeriod(evidence.text || "", row),
    };
  } catch {
    return {
      ...output,
      periodReason: "原票路径、大小或读取状态未通过核验，收费月份待核验",
    };
  }
}

/** 新口径读取全部有效住房发票；默认参数仅兼容旧收费月算法，均不关联银行付款。 */
export async function loadMonthlyFinancialHousingCostInvoices(
  client: Pick<PoolClient, "query">,
  asOfDate: string,
  basis?: "invoice-lease",
): Promise<AnalysisHousingCostInvoice[]> {
  if (!isValidFinancialDate(asOfDate))
    throw new Error("住房费用查询截止日期无效");
  const result = await client.query<InvoiceSource>(
    `SELECT invoice.id, root.id AS "rootId", invoice.invoice_date AS "invoiceDate",
            invoice.invoice_no AS "invoiceNumber", invoice.amount::text AS "invoiceAmount",
            GREATEST(invoice.updated_at, invoice_lines.updated_at) AS "updatedAt",
            file.id AS "fileId", file.file_path AS "filePath", file.file_type AS "fileType", file.mime_type AS "mimeType",
            COALESCE(file_owner.root_contract_id, file_owner.id) AS "fileRootId", file_owner.is_deleted AS "fileOwnerDeleted",
            COALESCE(invoice_lines.lines, '[]'::jsonb) AS lines
       FROM contract_invoices invoice
       JOIN contracts contract ON contract.id = invoice.contract_id
       JOIN contracts root ON root.id = COALESCE(contract.root_contract_id, contract.id)
       LEFT JOIN contract_files file ON file.id = invoice.file_id
       LEFT JOIN contracts file_owner ON file_owner.id = file.contract_id
       LEFT JOIN LATERAL (
         SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id', line.id, 'category', line.expense_category,
                  'amount', line.gross_amount::text, 'verified', line.recognition_status = 'verified')
                  ORDER BY line.line_index, line.id) AS lines, MAX(line.updated_at) AS updated_at
           FROM contract_invoice_line_items line WHERE line.invoice_id = invoice.id
       ) invoice_lines ON TRUE
      WHERE invoice.status = 'confirmed' AND invoice.reversed_at IS NULL
        AND contract.is_deleted = FALSE AND root.is_deleted = FALSE
        AND contract.status <> 'rejected' AND root.relation_type = 'main'
        AND root.status IN ('effective', 'executing', 'completed', 'terminated')
        AND COALESCE(root.category, root.declared_category) = 'asset'
        AND COALESCE(root.asset_category, root.declared_subtype) = 'house_rental'
        AND root.financial_direction = 'cost'
        AND ($2::boolean OR NOT COALESCE(monthly_financial_date_is_valid(invoice.invoice_date), FALSE) OR invoice.invoice_date <= $1)
        AND ($2::boolean OR invoice_lines.lines IS NULL OR EXISTS (SELECT 1 FROM contract_invoice_line_items variable
          WHERE variable.invoice_id = invoice.id AND variable.expense_category NOT IN ('rent', 'property_management')))
      ORDER BY invoice.invoice_date, invoice.id`,
    [asOfDate, basis === "invoice-lease"],
  );
  // 新口径只读全部已确认有效发票登记，不再要求变量收费单月份，也不把开票日当分摊月份。
  if (basis === "invoice-lease")
    return result.rows.map((row) => ({
      id: row.id,
      rootId: row.rootId,
      invoiceDate: row.invoiceDate,
      invoiceNumber: row.invoiceNumber,
      invoiceAmount: row.invoiceAmount,
      billingMonth: null,
      periodReason: "全部已确认发票按所属合同实际租赁期间分摊",
      evidenceVersion: "confirmed-invoice-lease-v1",
      updatedAt: row.updatedAt,
      lines: row.lines,
    }));
  return Promise.all(
    result.rows
      .filter(
        (row) =>
          !row.invoiceDate ||
          !isValidFinancialDate(row.invoiceDate) ||
          row.invoiceDate <= asOfDate,
      )
      .map((row) => limited(() => invoiceEvidence(row))),
  );
}
