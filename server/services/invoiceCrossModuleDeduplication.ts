import type { PoolClient } from "pg";

export interface CrossModuleInvoiceUsage {
  source: "contract_financial" | "reimbursement";
  recordId: string;
  ownerId: string;
}

export function normalizeCrossModuleInvoiceNumber(value: unknown): string {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]/gu, "")
    .toUpperCase();
}

/**
 * 报销与合同财务必须按同一顺序取得同一命名空间的咨询锁，确保两个模块
 * 并发写入相同发票号码时只有先提交的一方成功。
 */
export async function lockCrossModuleInvoiceNumbers(
  client: PoolClient,
  invoiceNumbers: readonly unknown[],
): Promise<string[]> {
  const normalizedNumbers = [
    ...new Set(
      invoiceNumbers.map(normalizeCrossModuleInvoiceNumber).filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
  for (const invoiceNumber of normalizedNumbers) {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended('global-invoice-number:' || $1, 0)
       )`,
      [invoiceNumber],
    );
  }
  return normalizedNumbers;
}

export async function findContractFinancialInvoiceUsage(
  client: PoolClient,
  normalizedInvoiceNumber: string,
  excludeOcrJobId: string | null = null,
): Promise<CrossModuleInvoiceUsage | null> {
  const result = await client.query<{
    source: "contract_financial";
    record_id: string;
    owner_id: string;
  }>(
    `SELECT 'contract_financial'::text AS source,
       invoice.id AS record_id, invoice.contract_id AS owner_id
     FROM contract_invoices invoice
     WHERE invoice.invoice_no IS NOT NULL
       AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(invoice.invoice_no), NFKC), '[^A-Za-z0-9]', '', 'g')) = $1
     UNION ALL
     SELECT 'contract_financial'::text AS source,
       job.id AS record_id, job.contract_id AS owner_id
     FROM contract_financial_ocr_jobs job
     WHERE job.record_kind = 'invoice'
       AND job.status IN ('verified', 'consumed')
       AND job.validation_status = 'verified'
       AND job.document_status = 'normal'
       AND ($2::text IS NULL OR job.id <> $2)
       AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(job.snapshot_json #>> '{fields,invoiceNumber}'), NFKC), '[^A-Za-z0-9]', '', 'g')) = $1
     LIMIT 1`,
    [normalizedInvoiceNumber, excludeOcrJobId],
  );
  const row = result.rows[0];
  return row
    ? { source: row.source, recordId: row.record_id, ownerId: row.owner_id }
    : null;
}

export async function findReimbursementInvoiceUsage(
  client: PoolClient,
  normalizedInvoiceNumber: string,
  excludeReimbursementId: string | null = null,
): Promise<CrossModuleInvoiceUsage | null> {
  const result = await client.query<{
    source: "reimbursement";
    record_id: string;
    owner_id: string;
  }>(
    `SELECT 'reimbursement'::text AS source,
       invoice.id AS record_id, reimbursement.id AS owner_id
     FROM reimbursement_invoices invoice
     JOIN reimbursements reimbursement
       ON reimbursement.id = invoice.reimbursement_id
     WHERE invoice.invoice_number IS NOT NULL
       AND SPLIT_PART(invoice.file_path, '/', -1) NOT LIKE 'receipt-%'
       AND UPPER(invoice.invoice_number) NOT LIKE 'RECEIPT-%'
       AND ($2::text IS NULL OR reimbursement.id <> $2)
       AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(invoice.invoice_number), NFKC), '[^A-Za-z0-9]', '', 'g')) = $1
     UNION ALL
     SELECT 'reimbursement'::text AS source,
       deduction.id AS record_id, reimbursement.id AS owner_id
     FROM reimbursement_deduction_invoices deduction
     JOIN reimbursements reimbursement
       ON reimbursement.id = deduction.reimbursement_id
     WHERE deduction.invoice_number IS NOT NULL
       AND ($2::text IS NULL OR reimbursement.id <> $2)
       AND UPPER(REGEXP_REPLACE(NORMALIZE(BTRIM(deduction.invoice_number), NFKC), '[^A-Za-z0-9]', '', 'g')) = $1
     LIMIT 1`,
    [normalizedInvoiceNumber, excludeReimbursementId],
  );
  const row = result.rows[0];
  return row
    ? { source: row.source, recordId: row.record_id, ownerId: row.owner_id }
    : null;
}
