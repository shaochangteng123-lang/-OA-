import { api } from "@/utils/api";
import type {
  InvoiceApplication,
  InvoiceApplicationBillingInfo,
  InvoiceApplicationDraftPayload,
  InvoiceApplicationEligibility,
  InvoiceApplicationEmployeeView,
  InvoiceApplicationFinancialProgress,
  InvoiceApplicationListResponse,
  InvoiceReceiptTask,
  InvoiceReceiptTaskListResponse,
  MainTriplicateInspection,
  InvoiceApplicationStatus,
} from "@/types/invoiceApplication";

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

function unwrap<T>(response: { data: ApiEnvelope<T> }): T {
  return response.data.data;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  const valueText = text(value).trim();
  return valueText || null;
}

function money(value: unknown): string | number {
  return typeof value === "number" || typeof value === "string" ? value : 0;
}

function normalizeBillingInfo(value: unknown): InvoiceApplicationBillingInfo {
  const source = record(value);
  return {
    name: text(source.name),
    taxNumber: text(source.taxNumber ?? source.tax_number),
    address: text(source.address),
    phone: text(source.phone),
    bankName: text(source.bankName ?? source.bank_name),
    bankAccount: text(source.bankAccount ?? source.bank_account),
    remark: text(source.remark),
  };
}

function normalizeAmounts(
  value: unknown,
): InvoiceApplicationEligibility["amounts"] {
  const source = record(value);
  return {
    currentEffectiveAmount: money(
      source.currentEffectiveAmount ?? source.current_effective_amount,
    ),
    invoicedAmount: money(source.invoicedAmount ?? source.invoiced_amount),
    pendingAmount: money(source.pendingAmount ?? source.pending_amount),
    remainingAmount: money(source.remainingAmount ?? source.remaining_amount),
  };
}

function normalizeEligibility(value: unknown): InvoiceApplicationEligibility {
  const source = record(value);
  const contract = record(source.contract);
  const billingPrefill = record(
    source.billingPrefill ?? source.billing_prefill,
  );
  const category = text(contract.category);
  return {
    eligible: Boolean(source.eligible),
    reasonCode: nullableText(source.reasonCode ?? source.reason_code),
    reason: nullableText(source.reason),
    contract: Object.keys(contract).length
      ? {
          id: text(contract.id),
          title: text(contract.title),
          contractNo: nullableText(contract.contractNo ?? contract.contract_no),
          category: (["main_business", "non_main", "asset"] as const).includes(
            category as "main_business" | "non_main" | "asset",
          )
            ? (category as "main_business" | "non_main" | "asset")
            : null,
          area: nullableText(contract.area),
          requiresTriplicate: contract.requiresTriplicate === true,
          partyA: nullableText(contract.partyA ?? contract.party_a),
          status: text(contract.status) as NonNullable<
            InvoiceApplicationEligibility["contract"]
          >["status"],
        }
      : null,
    amounts: normalizeAmounts(source.amounts),
    triplicatePreviousPaymentAmount: money(
      source.triplicatePreviousPaymentAmount ??
        source.triplicate_previous_payment_amount,
    ),
    billingPrefill: Object.keys(billingPrefill).length
      ? {
          ...normalizeBillingInfo(billingPrefill),
          sourceApplicationId: nullableText(
            billingPrefill.sourceApplicationId ??
              billingPrefill.source_application_id,
          ),
        }
      : null,
  };
}

function normalizeActor(value: unknown) {
  const source = record(value);
  if (!Object.keys(source).length) return null;
  return {
    id: nullableText(source.id),
    name: nullableText(source.name),
    role: nullableText(source.role),
    department: nullableText(source.department),
    position: nullableText(source.position),
    decidedAt: nullableText(source.decidedAt ?? source.decided_at),
    comment: nullableText(source.comment),
  };
}

function normalizeApplication(value: unknown): InvoiceApplication {
  const source = record(value);
  const category = text(source.category) as InvoiceApplication["category"];
  const status = text(source.status) as InvoiceApplicationStatus;
  const rawAuditLogs = source.auditLogs ?? source.audit_logs;
  const auditLogs = Array.isArray(rawAuditLogs) ? rawAuditLogs : [];
  return {
    id: text(source.id),
    applicationNo: nullableText(source.applicationNo ?? source.application_no),
    contractId: text(source.contractId ?? source.contract_id),
    contractTitle: text(source.contractTitle ?? source.contract_title),
    contractNo: nullableText(source.contractNo ?? source.contract_no),
    category,
    area: nullableText(source.area),
    requiresTriplicate: source.requiresTriplicate === true,
    partyA: nullableText(source.partyA ?? source.party_a),
    contractStatus: (nullableText(
      source.contractStatus ?? source.contract_status,
    ) || null) as InvoiceApplication["contractStatus"],
    contractAmount: money(source.contractAmount ?? source.contract_amount),
    amount: money(source.amount),
    triplicateProjectName: nullableText(
      source.triplicateProjectName ?? source.triplicate_project_name,
    ),
    triplicatePreviousPayment:
      source.triplicatePreviousPayment != null ||
      source.triplicate_previous_payment != null
        ? money(
            source.triplicatePreviousPayment ??
              source.triplicate_previous_payment,
          )
        : null,
    triplicateCumulativePayment:
      source.triplicateCumulativePayment != null ||
      source.triplicate_cumulative_payment != null
        ? money(
            source.triplicateCumulativePayment ??
              source.triplicate_cumulative_payment,
          )
        : null,
    invoiceContent: text(source.invoiceContent ?? source.invoice_content),
    invoiceType: text(source.invoiceType ?? source.invoice_type),
    description: text(source.description),
    materialMode: text(
      source.materialMode ?? source.material_mode,
    ) as InvoiceApplication["materialMode"],
    billingInfo: normalizeBillingInfo(
      source.billingInfo ?? source.billing_info,
    ),
    confirmedBillingIdentity: Boolean(
      source.confirmedBillingIdentity ?? source.confirmed_billing_identity,
    ),
    status,
    version: Number(source.version || 0),
    materials: (Array.isArray(source.materials) ? source.materials : []).map(
      (item) => {
        const material = record(item);
        return {
          id: text(material.id),
          fileName: text(material.fileName ?? material.file_name),
          mimeType: text(material.mimeType ?? material.mime_type),
          fileSize: Number(material.fileSize ?? material.file_size ?? 0),
          requiresSeal: Boolean(
            material.requiresSeal ?? material.requires_seal,
          ),
          hasOtherExpenseSheet: Boolean(
            material.hasOtherExpenseSheet ?? material.has_other_expense_sheet,
          ),
          isSystemGeneratedTriplicate: Boolean(
            material.isSystemGeneratedTriplicate ??
            material.is_system_generated_triplicate,
          ),
          createdAt: nullableText(material.createdAt ?? material.created_at),
          downloadedAt: nullableText(
            material.downloadedAt ?? material.downloaded_at,
          ),
        };
      },
    ),
    auditLogs: auditLogs.map((item) => {
      const log = record(item);
      return {
        id: text(log.id),
        action: text(log.action),
        actorName: nullableText(log.actorName ?? log.actor_name),
        actorPosition: nullableText(log.actorPosition ?? log.actor_position),
        fromStatus: nullableText(log.fromStatus ?? log.from_status),
        toStatus: nullableText(log.toStatus ?? log.to_status),
        comment: nullableText(log.comment),
        metadata: record(log.metadata),
        createdAt: text(log.createdAt ?? log.created_at),
      };
    }),
    applicant: normalizeActor(source.applicant),
    approver: normalizeActor(source.approver),
    executor: normalizeActor(source.executor),
    applicantSignedAt: nullableText(
      source.applicantSignedAt ?? source.applicant_signed_at,
    ),
    approverSignedAt: nullableText(
      source.approverSignedAt ?? source.approver_signed_at,
    ),
    deliveredAt: nullableText(source.deliveredAt ?? source.delivered_at),
    issuedAt: nullableText(source.issuedAt ?? source.issued_at),
    completedAt: nullableText(source.completedAt ?? source.completed_at),
    deliveryHandler: (() => {
      const handler = record(source.deliveryHandler ?? source.delivery_handler);
      if (!Object.keys(handler).length) return null;
      return {
        id: text(handler.id),
        name: text(handler.name),
        processedAt: text(handler.processedAt ?? handler.processed_at),
        note: text(handler.note),
      };
    })(),
    invoiceHandler: (() => {
      const handler = record(source.invoiceHandler ?? source.invoice_handler);
      if (!Object.keys(handler).length) return null;
      return {
        id: text(handler.id),
        name: text(handler.name),
        processedAt: text(handler.processedAt ?? handler.processed_at),
        note: text(handler.note),
      };
    })(),
    adminProcessing: (() => {
      const processing = record(
        source.adminProcessing ?? source.admin_processing,
      );
      if (!Object.keys(processing).length) return null;
      return {
        delivered: Boolean(processing.delivered),
        issued: Boolean(processing.issued),
        processedAt: text(processing.processedAt ?? processing.processed_at),
      };
    })(),
    applicantSignedFileId: nullableText(
      source.applicantSignedFileId ?? source.applicant_signed_file_id,
    ),
    approvedFileId: nullableText(
      source.approvedFileId ?? source.approved_file_id,
    ),
    applicationFileName: nullableText(
      source.applicationFileName ?? source.application_file_name,
    ),
    submittedAmounts:
      (source.submittedAmounts ?? source.submitted_amounts)
        ? normalizeAmounts(source.submittedAmounts ?? source.submitted_amounts)
        : null,
    currentAmounts:
      (source.currentAmounts ?? source.current_amounts)
        ? normalizeAmounts(source.currentAmounts ?? source.current_amounts)
        : null,
    allocatedInvoiceAmount: money(
      source.allocatedInvoiceAmount ?? source.allocated_invoice_amount,
    ),
    deliveryNote: nullableText(source.deliveryNote ?? source.delivery_note),
    invoiceNote: nullableText(source.invoiceNote ?? source.invoice_note),
    createdAt: nullableText(source.createdAt ?? source.created_at),
    updatedAt: nullableText(source.updatedAt ?? source.updated_at),
  };
}

export function getInvoiceApplicationErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const maybeError = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return maybeError.response?.data?.message || maybeError.message || fallback;
}

export async function getInvoiceApplicationEligibility(
  contractId: string,
): Promise<InvoiceApplicationEligibility> {
  return normalizeEligibility(
    unwrap(
      await api.get<ApiEnvelope<unknown>>(
        "/api/invoice-applications/eligibility",
        { params: { contractId } },
      ),
    ),
  );
}

export async function getInvoiceApplications(params: {
  scope:
    | "mine"
    | "approval"
    | "manager_pending"
    | "manager_processed"
    | "admin"
    | "admin_pending"
    | "admin_processed";
  view?: InvoiceApplicationEmployeeView;
  status?: InvoiceApplicationStatus | "";
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<InvoiceApplicationListResponse> {
  const result = record(
    unwrap(
      await api.get<ApiEnvelope<unknown>>("/api/invoice-applications", {
        params,
      }),
    ),
  );
  return {
    items: (Array.isArray(result.items) ? result.items : []).map(
      normalizeApplication,
    ),
    total: Number(result.total || 0),
  };
}

function normalizeInvoiceReceiptTask(value: unknown): InvoiceReceiptTask {
  const source = record(value);
  const rawInvoices = source.invoices;
  const rawApplicationNumbers =
    source.applicationNumbers ?? source.application_numbers;
  return {
    registrationId: text(source.registrationId ?? source.registration_id),
    contractId: text(source.contractId ?? source.contract_id),
    contractNo: text(source.contractNo ?? source.contract_no),
    businessContractNo: text(
      source.businessContractNo ?? source.business_contract_no,
    ),
    contractTitle: text(source.contractTitle ?? source.contract_title),
    projectName: text(source.projectName ?? source.project_name),
    partyA: text(source.partyA ?? source.party_a),
    area: text(source.area),
    applicationCount: Number(
      source.applicationCount ?? source.application_count ?? 0,
    ),
    applicationNumbers: Array.isArray(rawApplicationNumbers)
      ? rawApplicationNumbers.map(text)
      : [],
    invoiceCount: Number(source.invoiceCount ?? source.invoice_count ?? 0),
    invoiceAmount: Number(source.invoiceAmount ?? source.invoice_amount ?? 0),
    matchedReceiptAmount: Number(
      source.matchedReceiptAmount ?? source.matched_receipt_amount ?? 0,
    ),
    pendingReceiptAmount: Number(
      source.pendingReceiptAmount ?? source.pending_receipt_amount ?? 0,
    ),
    earliestInvoiceDate: text(
      source.earliestInvoiceDate ?? source.earliest_invoice_date,
    ),
    waitingDays: Number(source.waitingDays ?? source.waiting_days ?? 0),
    receiptStatus:
      (source.receiptStatus ?? source.receipt_status) === "partial"
        ? "partial"
        : "awaiting",
    invoices: (Array.isArray(rawInvoices) ? rawInvoices : []).map((item) => {
      const invoice = record(item);
      return {
        id: text(invoice.id),
        invoiceNo: text(invoice.invoiceNo ?? invoice.invoice_no),
        invoiceDate: text(invoice.invoiceDate ?? invoice.invoice_date),
        amount: Number(invoice.amount || 0),
        applicationAmount: Number(
          invoice.applicationAmount ?? invoice.application_amount ?? 0,
        ),
        matchedReceiptAmount: Number(
          invoice.matchedReceiptAmount ?? invoice.matched_receipt_amount ?? 0,
        ),
        pendingReceiptAmount: Number(
          invoice.pendingReceiptAmount ?? invoice.pending_receipt_amount ?? 0,
        ),
        itemName: text(invoice.itemName ?? invoice.item_name),
      };
    }),
  };
}

export async function getInvoiceReceiptTasks(
  params: {
    page?: number;
    pageSize?: number;
    keyword?: string;
  } = {},
): Promise<InvoiceReceiptTaskListResponse> {
  const result = record(
    unwrap(
      await api.get<ApiEnvelope<unknown>>(
        "/api/invoice-applications/pending-receipts",
        { params },
      ),
    ),
  );
  return {
    items: (Array.isArray(result.items) ? result.items : []).map(
      normalizeInvoiceReceiptTask,
    ),
    total: Number(result.total || 0),
    page: Number(result.page || params.page || 1),
    pageSize: Number(
      result.pageSize || result.page_size || params.pageSize || 20,
    ),
  };
}

export async function getInvoiceReceiptTask(
  registrationId: string,
): Promise<InvoiceReceiptTask | null> {
  const data = unwrap(
    await api.get<ApiEnvelope<unknown>>(
      `/api/invoice-applications/pending-receipts/${encodeURIComponent(registrationId)}`,
    ),
  );
  return data ? normalizeInvoiceReceiptTask(data) : null;
}

export async function getInvoiceApplicationFinancialProgress(
  id: string,
): Promise<InvoiceApplicationFinancialProgress> {
  const result = record(
    unwrap(
      await api.get<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${encodeURIComponent(id)}/financial-progress`,
      ),
    ),
  );
  return {
    id: text(result.id),
    contractId: text(result.contractId ?? result.contract_id),
    status: text(result.status) as InvoiceApplicationStatus,
    applicationAmount: Number(
      result.applicationAmount ?? result.application_amount ?? 0,
    ),
    allocatedInvoiceAmount: Number(
      result.allocatedInvoiceAmount ?? result.allocated_invoice_amount ?? 0,
    ),
    invoiceCompleted: Boolean(
      result.invoiceCompleted ?? result.invoice_completed,
    ),
    requiresReceiptUpload: Boolean(
      result.requiresReceiptUpload ?? result.requires_receipt_upload,
    ),
    pendingReceiptAmount: Number(
      result.pendingReceiptAmount ?? result.pending_receipt_amount ?? 0,
    ),
    registrationId: nullableText(
      result.registrationId ?? result.registration_id,
    ),
  };
}

export interface InvoiceApplicationPendingCounts {
  employeeActionPending: number;
  managerPending: number;
  pendingSeal: number;
  pendingIssue: number;
  pendingFinanceRegistration: number;
  pendingInvoice: number;
  pendingReceipt: number;
  adminPending: number;
  total: number;
}

export async function getInvoiceApplicationPendingCounts(): Promise<InvoiceApplicationPendingCounts> {
  const result = record(
    unwrap(
      await api.get<ApiEnvelope<unknown>>(
        "/api/invoice-applications/pending-counts",
      ),
    ),
  );
  const employeeActionPending = Number(
    result.employeeActionPending ?? result.employee_action_pending ?? 0,
  );
  const managerPending = Number(
    result.managerPending ?? result.manager_pending ?? 0,
  );
  const pendingSeal = Number(result.pendingSeal ?? result.pending_seal ?? 0);
  const pendingIssue = Number(result.pendingIssue ?? result.pending_issue ?? 0);
  const pendingFinanceRegistration = Number(
    result.pendingFinanceRegistration ??
      result.pending_finance_registration ??
      0,
  );
  const pendingInvoice = Number(
    result.pendingInvoice ?? result.pending_invoice ?? 0,
  );
  const pendingReceipt = Number(
    result.pendingReceipt ?? result.pending_receipt ?? 0,
  );
  const adminPending = Number(
    result.adminPending ??
      result.admin_pending ??
      pendingSeal + pendingInvoice + pendingReceipt,
  );
  return {
    employeeActionPending,
    managerPending,
    pendingSeal,
    pendingIssue,
    pendingFinanceRegistration,
    pendingInvoice,
    pendingReceipt,
    adminPending,
    total: Number(
      result.total ??
        employeeActionPending +
          managerPending +
          pendingSeal +
          pendingInvoice +
          pendingReceipt,
    ),
  };
}

export async function getInvoiceApplicationAdminPendingCounts(): Promise<{
  pendingSeal: number;
  pendingInvoice: number;
  pendingReceipt: number;
  adminPending: number;
}> {
  const counts = await getInvoiceApplicationPendingCounts();
  return {
    pendingSeal: counts.pendingSeal,
    pendingInvoice: counts.pendingInvoice,
    pendingReceipt: counts.pendingReceipt,
    adminPending: counts.adminPending,
  };
}

export async function getInvoiceApplication(
  id: string,
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.get<ApiEnvelope<unknown>>(`/api/invoice-applications/${id}`),
    ),
  );
}

export async function createInvoiceApplication(
  payload: InvoiceApplicationDraftPayload,
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.post<ApiEnvelope<unknown>>(
        "/api/invoice-applications",
        payload,
      ),
    ),
  );
}

export async function updateInvoiceApplication(
  id: string,
  payload: InvoiceApplicationDraftPayload & { expectedVersion: number },
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.patch<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${id}`,
        payload,
      ),
    ),
  );
}

export async function generateMainBusinessTriplicate(
  id: string,
  payload: {
    projectName: string;
    amount: string;
    expectedVersion: number;
  },
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.post<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${id}/triplicate`,
        payload,
        { timeout: 120_000 },
      ),
    ),
  );
}

export async function uploadInvoiceApplicationMaterials(
  id: string,
  files: File[],
  requiresSeal: boolean,
): Promise<InvoiceApplication> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  formData.append("requiresSeal", String(requiresSeal));
  return normalizeApplication(
    unwrap(
      await api.post<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${id}/materials`,
        formData,
        { timeout: 120_000 },
      ),
    ),
  );
}

export async function inspectMainTriplicate(
  contractId: string,
  file: File,
): Promise<MainTriplicateInspection> {
  const formData = new FormData();
  formData.append("contractId", contractId);
  formData.append("file", file);
  const source = record(
    unwrap(
      await api.post<ApiEnvelope<unknown>>(
        "/api/invoice-applications/triplicate-inspection",
        formData,
        { timeout: 120_000 },
      ),
    ),
  );
  return {
    paymentAmountCents: Number(source.paymentAmountCents || 0),
    sourceSheet: String(source.sourceSheet || ""),
    headerCell: String(source.headerCell || ""),
    totalCell: String(source.totalCell || ""),
    detailRange: String(source.detailRange || ""),
    fileName: String(source.fileName || file.name),
  };
}

export async function deleteInvoiceApplicationMaterial(
  id: string,
  materialId: string,
  expectedVersion: number,
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.delete<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${id}/materials/${materialId}`,
        { params: { expectedVersion } },
      ),
    ),
  );
}

export async function deleteInvoiceApplicationDraft(
  id: string,
  expectedVersion: number,
): Promise<void> {
  await api.delete<ApiEnvelope<{ id: string; deleted: true }>>(
    `/api/invoice-applications/${id}`,
    { params: { expectedVersion } },
  );
}

export async function submitInvoiceApplication(
  id: string,
  expectedVersion: number,
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.post<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${id}/submit`,
        { expectedVersion },
      ),
    ),
  );
}

export async function withdrawInvoiceApplication(
  id: string,
  expectedVersion: number,
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.post<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${id}/withdraw`,
        { expectedVersion },
      ),
    ),
  );
}

export async function decideInvoiceApplication(
  id: string,
  payload: {
    decision: "approve" | "reject";
    comment: string;
    expectedVersion: number;
  },
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.post<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${id}/decision`,
        payload,
      ),
    ),
  );
}

export async function deliverInvoiceApplication(
  id: string,
  note: string,
  expectedVersion: number,
  sealedTriplicateFileId: string,
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.post<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${id}/deliver`,
        { note, expectedVersion, sealedTriplicateFileId },
      ),
    ),
  );
}

export async function markInvoiceApplicationIssued(
  id: string,
  note: string,
  expectedVersion: number,
): Promise<InvoiceApplication> {
  return normalizeApplication(
    unwrap(
      await api.post<ApiEnvelope<unknown>>(
        `/api/invoice-applications/${id}/mark-issued`,
        { note, expectedVersion },
      ),
    ),
  );
}

export function getInvoiceApplicationMaterialPreviewUrl(
  id: string,
  materialId: string,
): string {
  return `/api/invoice-applications/${id}/materials/${materialId}/preview`;
}

export function getInvoiceApplicationPreviewUrl(id: string): string {
  return `/api/invoice-applications/${id}/application-preview`;
}

export function getInvoiceApplicationMaterialDownloadUrl(
  id: string,
  materialId: string,
): string {
  return `/api/invoice-applications/${id}/materials/${materialId}/download`;
}

export function getInvoiceApplicationMaterialPrintUrl(
  id: string,
  materialId: string,
): string {
  return `/api/invoice-applications/${id}/materials/${materialId}/print`;
}
