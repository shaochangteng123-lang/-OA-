import type { QueryResultRow } from "pg";
import { pool } from "../db/index.js";

const INVOICE_RECEIPT_TASK_ROLES = [
  "admin",
  "super_admin",
  "chairman",
] as const;

export class InvoiceReceiptTaskError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = "INVOICE_RECEIPT_TASK_INVALID",
  ) {
    super(message);
    this.name = "InvoiceReceiptTaskError";
  }
}

export interface InvoiceReceiptTaskInvoice {
  id: string;
  invoiceNo: string;
  invoiceDate: string;
  amount: number;
  applicationAmount: number;
  matchedReceiptAmount: number;
  pendingReceiptAmount: number;
  itemName: string;
}

export interface InvoiceReceiptTask {
  registrationId: string;
  contractId: string;
  contractNo: string;
  businessContractNo: string;
  contractTitle: string;
  projectName: string;
  partyA: string;
  area: string;
  applicationCount: number;
  applicationNumbers: string[];
  invoiceCount: number;
  invoiceAmount: number;
  matchedReceiptAmount: number;
  pendingReceiptAmount: number;
  earliestInvoiceDate: string;
  waitingDays: number;
  receiptStatus: "awaiting" | "partial";
  invoices: InvoiceReceiptTaskInvoice[];
}

interface PendingReceiptTaskRow extends QueryResultRow {
  registration_id: string;
  contract_id: string;
  contract_no: string | null;
  business_contract_no: string | null;
  contract_title: string | null;
  project_name: string | null;
  party_a: string | null;
  area: string | null;
  application_count: number;
  application_numbers: string[] | null;
  invoice_count: number;
  invoice_amount: number;
  matched_receipt_amount: number;
  pending_receipt_amount: number;
  earliest_invoice_date: string;
  waiting_days: number;
  invoices: unknown;
  total_count: number;
}

const INVOICE_RECEIPT_TASK_CTE = `WITH receipt_totals AS (
  SELECT registration.id AS registration_id,
    invoice_item.id AS invoice_item_id,
    invoice_item.record_id AS invoice_id,
    SUM(match.allocated_amount) AS matched_receipt_amount
  FROM contract_financial_registrations registration
  JOIN contract_financial_registration_matches match
    ON match.registration_id = registration.id
  JOIN contract_financial_registration_items invoice_item
    ON invoice_item.id = match.invoice_item_id
   AND invoice_item.item_kind = 'invoice'
  JOIN contract_financial_registration_items receipt_item
    ON receipt_item.id = match.settlement_item_id
   AND receipt_item.item_kind = 'receipt'
  JOIN contract_receipts receipt
    ON receipt.id = receipt_item.record_id
   AND receipt.status = 'confirmed'
  WHERE registration.status = 'draft'
    AND registration.financial_direction = 'income'
    AND registration.settlement_kind = 'receipt'
  GROUP BY registration.id, invoice_item.id, invoice_item.record_id
), ordered_allocations AS (
  SELECT registration.id AS registration_id,
    registration.contract_id,
    invoice_item.id AS invoice_item_id,
    invoice.id AS invoice_id,
    COALESCE(invoice.invoice_no, '') AS invoice_no,
    invoice.invoice_date,
    invoice.amount AS invoice_face_amount,
    COALESCE(invoice.item_name, '') AS item_name,
    application.id AS application_id,
    application.application_no,
    application.status AS application_status,
    application.issued_at,
    application.submitted_at,
    application_allocation.allocated_amount,
    COALESCE(receipt_totals.matched_receipt_amount, 0)
      AS invoice_matched_receipt_amount,
    COALESCE(SUM(application_allocation.allocated_amount) OVER (
      PARTITION BY application_allocation.invoice_id
      ORDER BY application.submitted_at, application.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ), 0) AS prior_application_amount
  FROM contract_financial_registrations registration
  JOIN contracts contract ON contract.id = registration.contract_id
  JOIN contract_financial_registration_items invoice_item
    ON invoice_item.registration_id = registration.id
   AND invoice_item.item_kind = 'invoice'
  JOIN contract_invoices invoice
    ON invoice.id = invoice_item.record_id
   AND invoice.status IN ('draft', 'confirmed')
  JOIN invoice_application_invoice_allocations application_allocation
    ON application_allocation.invoice_id = invoice.id
  JOIN invoice_applications application
    ON application.id = application_allocation.application_id
   AND application.contract_id = registration.contract_id
  LEFT JOIN receipt_totals
    ON receipt_totals.registration_id = registration.id
   AND receipt_totals.invoice_item_id = invoice_item.id
  WHERE registration.status = 'draft'
    AND registration.financial_direction = 'income'
    AND registration.settlement_kind = 'receipt'
    AND contract.is_deleted = FALSE
    AND contract.relation_type = 'main'
), completed_application_gaps AS (
  SELECT ordered.*,
    GREATEST(
      LEAST(
        ordered.allocated_amount,
        ordered.invoice_matched_receipt_amount
          - ordered.prior_application_amount
      ),
      0
    ) AS matched_receipt_amount,
    ordered.allocated_amount - GREATEST(
      LEAST(
        ordered.allocated_amount,
        ordered.invoice_matched_receipt_amount
          - ordered.prior_application_amount
      ),
      0
    ) AS pending_receipt_amount
  FROM ordered_allocations ordered
  WHERE ordered.application_status = 'completed'
    AND ordered.issued_at IS NOT NULL
), pending_applications AS (
  SELECT completed.registration_id,
    completed.application_id,
    completed.application_no
  FROM completed_application_gaps completed
  GROUP BY completed.registration_id, completed.application_id,
    completed.application_no
  HAVING SUM(completed.pending_receipt_amount) > 0
), invoice_task_amounts AS (
  SELECT completed.registration_id,
    completed.contract_id,
    completed.invoice_id AS id,
    completed.invoice_no,
    completed.invoice_date,
    MAX(completed.invoice_face_amount) AS amount,
    MAX(completed.item_name) AS item_name,
    SUM(completed.allocated_amount) AS application_amount,
    SUM(completed.matched_receipt_amount) AS matched_receipt_amount,
    SUM(completed.pending_receipt_amount) AS pending_receipt_amount
  FROM completed_application_gaps completed
  JOIN pending_applications pending_application
    ON pending_application.registration_id = completed.registration_id
   AND pending_application.application_id = completed.application_id
  GROUP BY completed.registration_id, completed.contract_id,
    completed.invoice_id, completed.invoice_no, completed.invoice_date
), registration_application_metrics AS (
  SELECT pending_application.registration_id,
    COUNT(*)::int AS application_count,
    ARRAY_AGG(
      pending_application.application_no
      ORDER BY pending_application.application_no
    )
      AS application_numbers
  FROM pending_applications pending_application
  GROUP BY pending_application.registration_id
), pending_receipt_tasks AS (
  SELECT registration.id AS registration_id,
    registration.contract_id,
    contract.contract_no,
    contract.business_contract_no,
    COALESCE(NULLIF(contract.title, ''), NULLIF(contract.project_name, ''),
      contract.contract_no, '未命名合同') AS contract_title,
    COALESCE(NULLIF(project.name, ''), NULLIF(contract.project_name, ''),
      NULLIF(contract.title, ''), contract.contract_no, '未命名项目')
      AS project_name,
    COALESCE(contract.party_a, '') AS party_a,
    COALESCE(contract.area, '') AS area,
    application_metrics.application_count,
    application_metrics.application_numbers,
    COUNT(*)::int AS invoice_count,
    SUM(invoice_task.application_amount) AS invoice_amount,
    SUM(invoice_task.matched_receipt_amount) AS matched_receipt_amount,
    SUM(
      invoice_task.application_amount - invoice_task.matched_receipt_amount
    ) AS pending_receipt_amount,
    MIN(invoice_task.invoice_date) FILTER (
      WHERE invoice_task.pending_receipt_amount > 0
    ) AS earliest_invoice_date,
    GREATEST(
      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
        - (MIN(invoice_task.invoice_date) FILTER (
          WHERE invoice_task.pending_receipt_amount > 0
        ))::date,
      0
    )::int
      AS waiting_days,
    JSONB_AGG(
      JSONB_BUILD_OBJECT(
        'id', invoice_task.id,
        'invoiceNo', invoice_task.invoice_no,
        'invoiceDate', invoice_task.invoice_date,
        'amount', invoice_task.amount,
        'applicationAmount', invoice_task.application_amount,
        'matchedReceiptAmount', invoice_task.matched_receipt_amount,
        'pendingReceiptAmount', invoice_task.pending_receipt_amount,
        'itemName', invoice_task.item_name
      ) ORDER BY invoice_task.invoice_date, invoice_task.id
    ) AS invoices,
    registration.created_at AS registration_created_at
  FROM invoice_task_amounts invoice_task
  JOIN contract_financial_registrations registration
    ON registration.id = invoice_task.registration_id
  JOIN contracts contract ON contract.id = registration.contract_id
  LEFT JOIN worklog_projects project ON project.id = contract.project_id
  JOIN registration_application_metrics application_metrics
    ON application_metrics.registration_id = registration.id
  GROUP BY registration.id, registration.contract_id, contract.contract_no,
    contract.business_contract_no, contract.title, contract.project_name,
    project.name, contract.party_a, contract.area,
    application_metrics.application_count,
    application_metrics.application_numbers, registration.created_at
  HAVING SUM(invoice_task.pending_receipt_amount) > 0
)`;

export function canReadInvoiceReceiptTasks(role: string): boolean {
  return (INVOICE_RECEIPT_TASK_ROLES as readonly string[]).includes(role);
}

function assertInvoiceReceiptTaskAccess(role: string): void {
  if (!canReadInvoiceReceiptTasks(role)) {
    throw new InvoiceReceiptTaskError("仅管理员可以查看待上传回单", 403);
  }
}

function normalizeInvoices(value: unknown): InvoiceReceiptTaskInvoice[] {
  const raw = Array.isArray(value) ? value : [];
  return raw.map((item) => {
    const record =
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    return {
      id: String(record.id || ""),
      invoiceNo: String(record.invoiceNo || ""),
      invoiceDate: String(record.invoiceDate || ""),
      amount: Number(record.amount || 0),
      applicationAmount: Number(record.applicationAmount || 0),
      matchedReceiptAmount: Number(record.matchedReceiptAmount || 0),
      pendingReceiptAmount: Number(record.pendingReceiptAmount || 0),
      itemName: String(record.itemName || ""),
    };
  });
}

function toTask(row: PendingReceiptTaskRow): InvoiceReceiptTask {
  const invoiceAmount = Number(row.invoice_amount || 0);
  const matchedReceiptAmount = Number(row.matched_receipt_amount || 0);
  const pendingReceiptAmount = Math.max(
    0,
    Number(row.pending_receipt_amount || 0),
  );
  return {
    registrationId: row.registration_id,
    contractId: row.contract_id,
    contractNo: row.contract_no || "",
    businessContractNo: row.business_contract_no || "",
    contractTitle: row.contract_title || "未命名合同",
    projectName: row.project_name || row.contract_title || "未命名项目",
    partyA: row.party_a || "",
    area: row.area || "",
    applicationCount: Number(row.application_count || 0),
    applicationNumbers: Array.isArray(row.application_numbers)
      ? row.application_numbers.map(String)
      : [],
    invoiceCount: Number(row.invoice_count || 0),
    invoiceAmount,
    matchedReceiptAmount,
    pendingReceiptAmount,
    earliestInvoiceDate: row.earliest_invoice_date,
    waitingDays: Math.max(0, Number(row.waiting_days || 0)),
    receiptStatus: matchedReceiptAmount > 0 ? "partial" : "awaiting",
    invoices: normalizeInvoices(row.invoices),
  };
}

export async function countInvoiceReceiptTasks(role: string): Promise<number> {
  assertInvoiceReceiptTaskAccess(role);
  const result = await pool.query<{ count: number }>(
    `${INVOICE_RECEIPT_TASK_CTE}
     SELECT COUNT(*)::int AS count FROM pending_receipt_tasks`,
  );
  return Number(result.rows[0]?.count || 0);
}

export async function findInvoiceReceiptTask(
  role: string,
  contractId: string,
): Promise<InvoiceReceiptTask | null> {
  assertInvoiceReceiptTaskAccess(role);
  const result = await pool.query<PendingReceiptTaskRow>(
    `${INVOICE_RECEIPT_TASK_CTE}
     SELECT pending_receipt_tasks.*, 1::int AS total_count
     FROM pending_receipt_tasks
     WHERE pending_receipt_tasks.contract_id = $1
     LIMIT 1`,
    [contractId],
  );
  return result.rows[0] ? toTask(result.rows[0]) : null;
}

export async function findInvoiceReceiptTaskByRegistration(
  role: string,
  registrationId: string,
): Promise<InvoiceReceiptTask | null> {
  assertInvoiceReceiptTaskAccess(role);
  const result = await pool.query<PendingReceiptTaskRow>(
    `${INVOICE_RECEIPT_TASK_CTE}
     SELECT pending_receipt_tasks.*, 1::int AS total_count
     FROM pending_receipt_tasks
     WHERE pending_receipt_tasks.registration_id = $1
     LIMIT 1`,
    [registrationId],
  );
  return result.rows[0] ? toTask(result.rows[0]) : null;
}

export async function listInvoiceReceiptTasksForApplication(
  role: string,
  applicationId: string,
): Promise<InvoiceReceiptTask[]> {
  assertInvoiceReceiptTaskAccess(role);
  const result = await pool.query<PendingReceiptTaskRow>(
    `${INVOICE_RECEIPT_TASK_CTE}
     SELECT pending_receipt_tasks.*, 1::int AS total_count
     FROM pending_receipt_tasks
     WHERE EXISTS (
       SELECT 1
       FROM pending_applications pending_application
       WHERE pending_application.registration_id
         = pending_receipt_tasks.registration_id
         AND pending_application.application_id = $1
     )
     ORDER BY pending_receipt_tasks.earliest_invoice_date,
       pending_receipt_tasks.registration_created_at,
       pending_receipt_tasks.registration_id`,
    [applicationId],
  );
  return result.rows.map(toTask);
}

export async function listInvoiceReceiptTasks(
  role: string,
  rawPage = 1,
  rawPageSize = 20,
  rawKeyword = "",
): Promise<{
  items: InvoiceReceiptTask[];
  total: number;
  page: number;
  pageSize: number;
}> {
  assertInvoiceReceiptTaskAccess(role);
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize =
    Number.isInteger(rawPageSize) && rawPageSize > 0 && rawPageSize <= 100
      ? rawPageSize
      : 20;
  const keyword = rawKeyword.trim();
  const keywordPattern = keyword ? `%${keyword}%` : null;
  const result = await pool.query<PendingReceiptTaskRow>(
    `${INVOICE_RECEIPT_TASK_CTE}, filtered_receipt_tasks AS (
     SELECT pending_receipt_tasks.*
     FROM pending_receipt_tasks
     WHERE $1::text IS NULL
       OR pending_receipt_tasks.contract_title ILIKE $1
       OR pending_receipt_tasks.project_name ILIKE $1
       OR pending_receipt_tasks.contract_no ILIKE $1
       OR pending_receipt_tasks.business_contract_no ILIKE $1
       OR pending_receipt_tasks.party_a ILIKE $1
       OR pending_receipt_tasks.invoice_amount::text ILIKE $1
       OR pending_receipt_tasks.matched_receipt_amount::text ILIKE $1
       OR pending_receipt_tasks.pending_receipt_amount::text ILIKE $1
       OR ARRAY_TO_STRING(
         pending_receipt_tasks.application_numbers,
         '、'
       ) ILIKE $1
       OR EXISTS (
         SELECT 1
         FROM JSONB_ARRAY_ELEMENTS(pending_receipt_tasks.invoices) invoice
         WHERE invoice->>'invoiceNo' ILIKE $1
           OR invoice->>'amount' ILIKE $1
           OR invoice->>'applicationAmount' ILIKE $1
           OR invoice->>'matchedReceiptAmount' ILIKE $1
           OR invoice->>'pendingReceiptAmount' ILIKE $1
       )
     ), paged_receipt_tasks AS (
       SELECT filtered_receipt_tasks.*
       FROM filtered_receipt_tasks
       ORDER BY filtered_receipt_tasks.earliest_invoice_date ASC,
         filtered_receipt_tasks.registration_created_at ASC,
         filtered_receipt_tasks.registration_id ASC
       LIMIT $2 OFFSET $3
     ), receipt_task_total AS (
       SELECT COUNT(*)::int AS total_count FROM filtered_receipt_tasks
     )
     SELECT paged_receipt_tasks.*, receipt_task_total.total_count
     FROM receipt_task_total
     LEFT JOIN paged_receipt_tasks ON TRUE
     ORDER BY paged_receipt_tasks.earliest_invoice_date ASC,
       paged_receipt_tasks.registration_created_at ASC,
       paged_receipt_tasks.registration_id ASC`,
    [keywordPattern, pageSize, (page - 1) * pageSize],
  );
  return {
    items: result.rows
      .filter((row) => Boolean(row.registration_id))
      .map(toTask),
    total: Number(result.rows[0]?.total_count || 0),
    page,
    pageSize,
  };
}
