import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createCanvas, loadImage } from "canvas";
import { nanoid } from "nanoid";
import { PDFDocument } from "pdf-lib";
import type { PoolClient, QueryResultRow } from "pg";
import { db, pool } from "../db/index.js";
import type {
  InvoiceApplicationActor,
  InvoiceApplicationAmounts,
  InvoiceApplicationBillingInfo,
  InvoiceApplicationDraftInput,
  InvoiceApplicationEmployeeListView,
  InvoiceApplicationEligibility,
  GenerateMainTriplicateInput,
  InvoiceApplicationListScope,
  InvoiceApplicationMaterialMode,
  InvoiceApplicationStatus,
  InvoiceApplicationView,
} from "../types/invoice-application.js";
import { normalizeSignaturePng } from "../utils/electronic-signature.js";
import { validateFilePath } from "../utils/file-validation.js";
import {
  ensureDatedUploadDirectory,
  toStoredUploadPath,
} from "../utils/upload-date.js";
import { inspectInvoiceApplicationMaterial } from "./invoiceApplicationMaterial.js";
import { renderMainBusinessTriplicatePdf } from "./invoiceTriplicate.js";

export const INVOICE_APPLICATION_ADMIN_ROLES = [
  "admin",
  "super_admin",
  "chairman",
] as const;
export const INVOICE_APPLICATION_MAX_MATERIALS = 20;

type Queryable = Pick<PoolClient, "query"> | typeof pool;

interface ActorSnapshot {
  id: string;
  name: string;
  role: string;
  department: string;
  position: string;
}

interface ContractSnapshotRow {
  id: string;
  contract_no: string | null;
  business_contract_no: string | null;
  title: string | null;
  project_name: string | null;
  category: "main_business" | "non_main" | "asset" | null;
  area: string;
  party_a: string | null;
  status: string;
  relation_type: string;
  current_effective_amount: number | null;
  original_contract_amount: number | null;
  amount_delta: number | null;
  is_deleted: boolean;
  has_archived_sealed: boolean;
}

interface InvoiceApplicationRow extends QueryResultRow {
  id: string;
  application_no: string;
  contract_id: string;
  applicant_id: string;
  applicant_name_snapshot: string;
  applicant_department_snapshot: string;
  applicant_position_snapshot: string;
  contract_no_snapshot: string;
  contract_title_snapshot: string;
  contract_category_snapshot: "main_business" | "non_main";
  contract_area_snapshot: string;
  party_a_snapshot: string;
  contract_amount_snapshot: number;
  amount: number;
  triplicate_project_name: string | null;
  triplicate_previous_payment_snapshot: number | null;
  triplicate_cumulative_payment_snapshot: number | null;
  invoice_content: string;
  invoice_type: string;
  description: string | null;
  material_mode: InvoiceApplicationMaterialMode;
  billing_name: string;
  billing_tax_number: string;
  billing_address: string | null;
  billing_phone: string | null;
  billing_bank_name: string | null;
  billing_bank_account: string | null;
  billing_remark: string | null;
  billing_confirmed: boolean;
  billing_prefill_source_application_id: string | null;
  billing_original_json: unknown;
  status: InvoiceApplicationStatus;
  target_approver_id: string | null;
  target_approver_name_snapshot: string | null;
  target_approver_position_snapshot: string | null;
  applicant_signature_snapshot_path: string | null;
  applicant_signature_snapshot_hash: string | null;
  applicant_signed_at: string | null;
  applicant_signed_file_id: string | null;
  approver_id: string | null;
  approver_name_snapshot: string | null;
  approver_position_snapshot: string | null;
  approver_signature_snapshot_path: string | null;
  approver_signature_snapshot_hash: string | null;
  approved_file_id: string | null;
  decision_comment: string | null;
  submitted_invoiced_amount_snapshot: number | null;
  submitted_pending_amount_snapshot: number | null;
  submitted_remaining_amount_snapshot: number | null;
  submitted_at: string | null;
  decided_at: string | null;
  delivered_by: string | null;
  delivered_by_name_snapshot: string | null;
  delivery_note: string | null;
  delivered_at: string | null;
  issued_by: string | null;
  issued_by_name_snapshot: string | null;
  issue_note: string | null;
  issued_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

interface MaterialRow extends QueryResultRow {
  id: string;
  application_id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  file_hash: string;
  requires_seal: boolean;
  has_other_expense_sheet: boolean;
  is_system_generated_triplicate: boolean;
  created_at: string;
}

export interface StoredInvoiceApplicationMaterial {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  fileHash: string;
  requiresSeal: boolean;
  hasOtherExpenseSheet: boolean;
  recognizedApplicationAmount: number | null;
  recognizedAmountLabelCell: string | null;
  recognizedAmountValueCell: string | null;
  recognizedAmountDetailRange: string | null;
}

export class InvoiceApplicationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly code = "INVOICE_APPLICATION_INVALID",
  ) {
    super(message);
    this.name = "InvoiceApplicationError";
  }
}

function toCents(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function fromCents(value: number): number {
  return Math.round(value) / 100;
}

export interface FifoApplicationFact {
  id: string;
  amount: number;
  submittedAt: string;
}

export interface FifoInvoiceFact {
  id: string;
  amount: number;
  createdAt: string;
}

export interface InvoiceApplicationFifoAllocation {
  applicationId: string;
  invoiceId: string;
  allocatedAmount: number;
}

/**
 * 发票事实只覆盖在其建档前已经提交且已进入待开票环节的申请，避免历史发票
 * 错误覆盖新申请。申请、发票均按时间和编号稳定排序，尾差全程按分计算。
 */
export function allocateInvoiceApplicationFacts(
  rawApplications: FifoApplicationFact[],
  rawInvoices: FifoInvoiceFact[],
): InvoiceApplicationFifoAllocation[] {
  const applications = rawApplications
    .map((item) => ({ ...item, remaining: toCents(item.amount) }))
    .filter((item) => item.remaining > 0)
    .sort(
      (left, right) =>
        left.submittedAt.localeCompare(right.submittedAt) ||
        left.id.localeCompare(right.id),
    );
  const invoices = rawInvoices
    .map((item) => ({ ...item, remaining: toCents(item.amount) }))
    .filter((item) => item.remaining > 0)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  const allocations: InvoiceApplicationFifoAllocation[] = [];
  for (const invoice of invoices) {
    for (const application of applications) {
      if (invoice.remaining <= 0) break;
      if (application.remaining <= 0) continue;
      if (application.submittedAt > invoice.createdAt) continue;
      const allocated = Math.min(invoice.remaining, application.remaining);
      invoice.remaining -= allocated;
      application.remaining -= allocated;
      allocations.push({
        applicationId: application.id,
        invoiceId: invoice.id,
        allocatedAmount: fromCents(allocated),
      });
    }
  }
  return allocations;
}

export function calculateInvoiceApplicationCapacity(input: {
  currentEffectiveAmount: number;
  invoicedAmount: number;
  activeReservations: Array<{ amount: number; allocatedAmount: number }>;
}): InvoiceApplicationAmounts {
  const currentCents = Math.max(0, toCents(input.currentEffectiveAmount));
  const invoicedCents = Math.max(0, toCents(input.invoicedAmount));
  const pendingCents = input.activeReservations.reduce(
    (sum, item) =>
      sum + Math.max(0, toCents(item.amount) - toCents(item.allocatedAmount)),
    0,
  );
  return {
    currentEffectiveAmount: fromCents(currentCents),
    invoicedAmount: fromCents(invoicedCents),
    pendingAmount: fromCents(pendingCents),
    remainingAmount: fromCents(
      Math.max(0, currentCents - invoicedCents - pendingCents),
    ),
  };
}

export function approvedInvoiceApplicationStatus(
  materialMode: InvoiceApplicationMaterialMode,
): Extract<InvoiceApplicationStatus, "pending_seal" | "pending_invoice"> {
  return materialMode === "material_need_seal"
    ? "pending_seal"
    : "pending_invoice";
}

export function statusAfterInvoiceAllocation(input: {
  currentStatus: Extract<
    InvoiceApplicationStatus,
    "pending_invoice" | "completed"
  >;
  applicationAmount: number;
  allocatedAmount: number;
  issuedAt?: string | null;
}): Extract<InvoiceApplicationStatus, "pending_invoice" | "completed"> {
  return input.issuedAt &&
    toCents(input.allocatedAmount) >= toCents(input.applicationAmount)
    ? "completed"
    : "pending_invoice";
}

export function assertInvoiceApplicationMaterialPolicy(input: {
  category: "main_business" | "non_main";
  materialMode: InvoiceApplicationMaterialMode;
  materials: Array<{
    requiresSeal: boolean;
    hasOtherExpenseSheet: boolean;
  }>;
}): void {
  if (input.materials.length > INVOICE_APPLICATION_MAX_MATERIALS)
    throw new InvoiceApplicationError(
      `单份开票申请最多上传${INVOICE_APPLICATION_MAX_MATERIALS}份材料`,
    );
  if (input.category === "main_business") {
    if (
      input.materialMode !== "material_need_seal" ||
      input.materials.length !== 1 ||
      !input.materials[0].requiresSeal ||
      !input.materials[0].hasOtherExpenseSheet
    )
      throw new InvoiceApplicationError(
        "主营项目合同必须且只能上传一份含“其他费用”工作表的三联单，并选择盖章",
        409,
        "MAIN_BUSINESS_TRIPLICATE_REQUIRED",
      );
    return;
  }
  if (input.materialMode === "no_material" && input.materials.length > 0)
    throw new InvoiceApplicationError("已选择不需要材料，请先删除已上传材料");
  if (
    input.materialMode === "material_no_seal" &&
    input.materials.some((item) => item.requiresSeal)
  )
    throw new InvoiceApplicationError(
      "已选择材料无需盖章，材料不能标记为需盖章",
    );
  if (
    input.materialMode === "material_need_seal" &&
    !input.materials.some((item) => item.requiresSeal)
  )
    throw new InvoiceApplicationError(
      "已选择材料需要盖章，请至少选择一份需盖章附件",
    );
  if (input.materialMode !== "no_material" && input.materials.length === 0)
    throw new InvoiceApplicationError("请先上传甲方材料");
}

function rolePosition(role: string, position: string | null): string {
  if (role === "general_manager") return "总经理";
  if ((INVOICE_APPLICATION_ADMIN_ROLES as readonly string[]).includes(role))
    return "管理员";
  return position?.trim() || "员工";
}

async function actorSnapshot(
  client: Queryable,
  actorId: string,
): Promise<ActorSnapshot> {
  const result = await client.query<{
    id: string;
    name: string;
    role: string;
    department: string | null;
    position: string | null;
  }>(
    `SELECT user_account.id, user_account.name, user_account.role,
            employee.department, employee.position
       FROM users user_account
       LEFT JOIN employee_profiles employee ON employee.user_id = user_account.id
      WHERE user_account.id = $1 AND user_account.status = 'active'
      LIMIT 1`,
    [actorId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new InvoiceApplicationError(
      "当前账号不存在或已停用",
      401,
      "INVOICE_APPLICATION_ACTOR_UNAVAILABLE",
    );
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    department: row.department?.trim() || "",
    position: rolePosition(row.role, row.position),
  };
}

async function uniqueGeneralManager(client: Queryable): Promise<ActorSnapshot> {
  const result = await client.query<{ id: string; name: string; role: string }>(
    `SELECT id, name, role FROM users
      WHERE role = 'general_manager' AND status = 'active'
      ORDER BY created_at, id FOR SHARE`,
  );
  if (result.rows.length !== 1) {
    throw new InvoiceApplicationError(
      "系统必须且只能配置一个启用中的总经理账号，暂时无法提交开票申请",
      409,
      "UNIQUE_GENERAL_MANAGER_REQUIRED",
    );
  }
  return {
    id: result.rows[0].id,
    name: result.rows[0].name,
    role: result.rows[0].role,
    department: "",
    position: "总经理",
  };
}

function requiredText(value: unknown, label: string, maximum: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new InvoiceApplicationError(`${label}不能为空`);
  if (text.length > maximum)
    throw new InvoiceApplicationError(`${label}不能超过${maximum}个字符`);
  return text;
}

function optionalText(value: unknown, label: string, maximum: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > maximum)
    throw new InvoiceApplicationError(`${label}不能超过${maximum}个字符`);
  return text;
}

export function normalizeInvoiceApplicationType(value: unknown): string {
  const invoiceType = requiredText(value, "发票类型", 100);
  if (!["增值税专用发票", "增值税普通发票"].includes(invoiceType)) {
    throw new InvoiceApplicationError("发票类型只允许增值税专用发票或普通发票");
  }
  return invoiceType;
}

function parseAmount(value: unknown): number {
  const cents = toCents(value);
  if (cents <= 0)
    throw new InvoiceApplicationError("本次申请开票金额必须大于0");
  if (cents > 99_999_999_999_999)
    throw new InvoiceApplicationError("本次申请开票金额超过系统限制");
  return fromCents(cents);
}

function normalizeBillingInfo(
  raw: InvoiceApplicationDraftInput["billingInfo"],
): InvoiceApplicationBillingInfo {
  return {
    name: optionalText(raw?.name, "开票名称", 300),
    taxNumber: optionalText(raw?.taxNumber, "税号", 100),
    address: optionalText(raw?.address, "开票地址", 500),
    phone: optionalText(raw?.phone, "开票电话", 100),
    bankName: optionalText(raw?.bankName, "开户行", 300),
    bankAccount: optionalText(raw?.bankAccount, "银行账号", 100),
    remark: optionalText(raw?.remark, "开票备注", 1000),
  };
}

export function resolveInvoiceApplicationBillingInfo(
  rawBilling: InvoiceApplicationDraftInput["billingInfo"] | null | undefined,
  normalizedBilling: InvoiceApplicationBillingInfo,
  prefill: InvoiceApplicationBillingInfo | null | undefined,
): InvoiceApplicationBillingInfo {
  const source = rawBilling || {};
  const value = (key: keyof InvoiceApplicationBillingInfo): string =>
    Object.prototype.hasOwnProperty.call(source, key)
      ? normalizedBilling[key]
      : prefill?.[key] || "";
  return {
    name: value("name"),
    taxNumber: value("taxNumber"),
    address: value("address"),
    phone: value("phone"),
    bankName: value("bankName"),
    bankAccount: value("bankAccount"),
    remark: value("remark"),
  };
}

function normalizeDraftInput(
  raw: InvoiceApplicationDraftInput,
  category: ContractSnapshotRow["category"],
): Omit<InvoiceApplicationDraftInput, "billingInfo"> & {
  contractId: string;
  amount: number;
  invoiceContent: string;
  invoiceType: string;
  description: string;
  materialMode: InvoiceApplicationMaterialMode;
  billingInfo: InvoiceApplicationBillingInfo;
  confirmedBillingIdentity: boolean;
} {
  const mode = requiredText(raw.materialMode, "材料方式", 50);
  if (
    !["material_need_seal", "material_no_seal", "no_material"].includes(mode)
  ) {
    throw new InvoiceApplicationError("材料方式不正确");
  }
  const invoiceType = normalizeInvoiceApplicationType(raw.invoiceType);
  return {
    ...raw,
    contractId: requiredText(raw.contractId, "合同编号", 100),
    amount: parseAmount(raw.amount),
    invoiceContent: "",
    invoiceType,
    description: optionalText(raw.description, "开票说明", 2000),
    materialMode:
      category === "main_business"
        ? "material_need_seal"
        : (mode as InvoiceApplicationMaterialMode),
    billingInfo: normalizeBillingInfo(raw.billingInfo || {}),
    confirmedBillingIdentity: raw.confirmedBillingIdentity === true,
  };
}

async function loadContract(
  client: Queryable,
  contractId: string,
  lock = false,
): Promise<ContractSnapshotRow | null> {
  const result = await client.query<ContractSnapshotRow>(
    `SELECT contract.id, contract.contract_no, contract.business_contract_no,
            contract.title, contract.project_name,
            COALESCE(contract.category, contract.declared_category) AS category,
            contract.area, contract.party_a, contract.status,
            contract.relation_type, contract.current_effective_amount,
            contract.original_contract_amount, contract.amount_delta,
            contract.is_deleted,
            EXISTS (
              SELECT 1
                FROM contract_files sealed_file
                JOIN contract_seal_verifications verification
                  ON verification.file_id = sealed_file.id
                 AND verification.contract_id = contract.id
                 AND verification.status = 'archived'
               WHERE sealed_file.contract_id = contract.id
                 AND sealed_file.file_type = 'sealed_contract'
                 AND sealed_file.is_current = TRUE
            ) AS has_archived_sealed
       FROM contracts contract
      WHERE contract.id = $1 AND contract.is_deleted = FALSE
      LIMIT 1${lock ? " FOR SHARE OF contract" : ""}`,
    [contractId],
  );
  return result.rows[0] || null;
}

function currentContractAmount(contract: ContractSnapshotRow): number {
  return Number(
    contract.current_effective_amount ??
      contract.original_contract_amount ??
      contract.amount_delta ??
      0,
  );
}

function contractDisplay(contract: ContractSnapshotRow) {
  return {
    contractNo:
      contract.business_contract_no || contract.contract_no || contract.id,
    title: contract.title || contract.project_name || "未命名合同",
    partyA: contract.party_a?.trim() || "未填写",
  };
}

function assertReadScope(
  actor: InvoiceApplicationActor,
  contract: ContractSnapshotRow,
): void {
  const fullReadRoles = new Set([
    "admin",
    "super_admin",
    "chairman",
    "general_manager",
  ]);
  const canRead =
    fullReadRoles.has(actor.role) ||
    (["user", "boss"].includes(actor.role) && contract.area !== "全部");
  if (!canRead) {
    throw new InvoiceApplicationError(
      "无权查看该合同的开票申请",
      403,
      "INVOICE_APPLICATION_CONTRACT_FORBIDDEN",
    );
  }
}

function eligibilityReason(contract: ContractSnapshotRow): {
  code: string | null;
  reason: string | null;
} {
  if (contract.relation_type !== "main")
    return {
      code: "INVOICE_APPLICATION_ROOT_CONTRACT_ONLY",
      reason: "补充协议和解除协议不单独申请开票",
    };
  if (
    !(["main_business", "non_main"] as const).includes(
      contract.category as never,
    )
  )
    return {
      code: "INVOICE_APPLICATION_INCOME_CONTRACT_ONLY",
      reason: "资产类合同属于支出合同，不允许申请开票",
    };
  if (!["effective", "executing", "completed"].includes(contract.status))
    return {
      code: "INVOICE_APPLICATION_CONTRACT_STATUS_INELIGIBLE",
      reason: "合同尚未生效或已经终止，不能申请开票",
    };
  if (!contract.has_archived_sealed)
    return {
      code: "INVOICE_APPLICATION_SEALED_ARCHIVE_REQUIRED",
      reason: "盖章版合同完成核验归档后才能申请开票",
    };
  if (toCents(currentContractAmount(contract)) <= 0)
    return {
      code: "INVOICE_APPLICATION_CONTRACT_AMOUNT_REQUIRED",
      reason: "合同当前有效金额不足，不能申请开票",
    };
  return { code: null, reason: null };
}

async function capacityForContract(
  client: Queryable,
  contractId: string,
): Promise<InvoiceApplicationAmounts> {
  const result = await client.query<{
    current_effective_amount: number;
    invoiced_amount: number;
    pending_amount: number;
  }>(
    `SELECT
       COALESCE(root.current_effective_amount, root.original_contract_amount,
                root.amount_delta, 0) AS current_effective_amount,
       COALESCE((
         SELECT SUM(invoice.amount)
           FROM contract_invoices invoice
           JOIN contracts invoice_contract ON invoice_contract.id = invoice.contract_id
          WHERE COALESCE(invoice_contract.root_contract_id, invoice_contract.id) = root.id
            AND invoice_contract.is_deleted = FALSE
            AND invoice.status IN ('draft', 'confirmed')
       ), 0) AS invoiced_amount,
       COALESCE((
         SELECT SUM(GREATEST(application.amount - COALESCE(allocation.amount, 0), 0))
           FROM invoice_applications application
           LEFT JOIN (
             SELECT application_id, SUM(allocated_amount) AS amount
               FROM invoice_application_invoice_allocations
              GROUP BY application_id
           ) allocation ON allocation.application_id = application.id
          WHERE application.contract_id = root.id
            AND application.status IN (
              'pending_approval', 'pending_seal', 'pending_invoice', 'completed'
            )
       ), 0) AS pending_amount
      FROM contracts root WHERE root.id = $1 AND root.is_deleted = FALSE`,
    [contractId],
  );
  const row = result.rows[0];
  if (!row)
    return calculateInvoiceApplicationCapacity({
      currentEffectiveAmount: 0,
      invoicedAmount: 0,
      activeReservations: [],
    });
  const current = Number(row.current_effective_amount || 0);
  const invoiced = Number(row.invoiced_amount || 0);
  const pending = Number(row.pending_amount || 0);
  return {
    currentEffectiveAmount: fromCents(Math.max(0, toCents(current))),
    invoicedAmount: fromCents(Math.max(0, toCents(invoiced))),
    pendingAmount: fromCents(Math.max(0, toCents(pending))),
    remainingAmount: fromCents(
      Math.max(0, toCents(current) - toCents(invoiced) - toCents(pending)),
    ),
  };
}

async function previousTriplicatePaymentAmount(
  client: Queryable,
  contractId: string,
  excludedApplicationId?: string,
): Promise<number> {
  const result = await client.query<{ amount: number }>(
    `SELECT COALESCE(SUM(amount),0) AS amount
       FROM invoice_applications
      WHERE contract_id=$1
        AND status IN (
          'pending_approval','pending_seal','pending_invoice','completed'
        )
        AND ($2::text IS NULL OR id <> $2)`,
    [contractId, excludedApplicationId || null],
  );
  return fromCents(Math.max(0, toCents(Number(result.rows[0]?.amount || 0))));
}

async function billingPrefill(
  client: Queryable,
  partyA: string,
): Promise<InvoiceApplicationEligibility["billingPrefill"]> {
  if (!partyA.trim()) return null;
  const result = await client.query<{
    id: string;
    billing_name: string;
    billing_tax_number: string;
    billing_address: string | null;
    billing_phone: string | null;
    billing_bank_name: string | null;
    billing_bank_account: string | null;
    billing_remark: string | null;
  }>(
    `SELECT application.id, application.billing_name,
            application.billing_tax_number, application.billing_address,
            application.billing_phone, application.billing_bank_name,
            application.billing_bank_account, application.billing_remark
      FROM invoice_applications application
      WHERE BTRIM(application.party_a_snapshot) = BTRIM($1)
        AND application.status NOT IN ('draft', 'rejected')
        AND application.billing_name <> ''
        AND application.billing_tax_number <> ''
      ORDER BY COALESCE(application.submitted_at, application.created_at) DESC,
               application.id DESC LIMIT 1`,
    [partyA],
  );
  const row = result.rows[0];
  return row
    ? {
        name: row.billing_name,
        taxNumber: row.billing_tax_number,
        address: row.billing_address || "",
        phone: row.billing_phone || "",
        bankName: row.billing_bank_name || "",
        bankAccount: row.billing_bank_account || "",
        remark: row.billing_remark || "",
        sourceApplicationId: row.id,
      }
    : null;
}

async function lockRoot(
  client: Queryable,
  contractId: string,
): Promise<string> {
  const rootResult = await client.query<{ root_id: string }>(
    `SELECT COALESCE(root_contract_id, id) AS root_id
       FROM contracts WHERE id = $1 AND is_deleted = FALSE`,
    [contractId],
  );
  const rootId = rootResult.rows[0]?.root_id;
  if (!rootId)
    throw new InvoiceApplicationError("合同不存在", 404, "CONTRACT_NOT_FOUND");
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('invoice-application:' || $1, 0)
     )`,
    [rootId],
  );
  return rootId;
}

export async function lockInvoiceApplicationRoot(
  client: Queryable,
  contractId: string,
): Promise<string> {
  return lockRoot(client, contractId);
}

export async function lockInvoiceApplicationRootByFinancialSource(
  client: Queryable,
  source: "invoice" | "registration",
  sourceId: string,
): Promise<void> {
  const table =
    source === "invoice"
      ? "contract_invoices"
      : "contract_financial_registrations";
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended(
         'invoice-application:' || COALESCE(contract.root_contract_id, contract.id),
         0
       )
     )
       FROM ${table} source
       JOIN contracts contract ON contract.id = source.contract_id
      WHERE source.id = $1`,
    [sourceId],
  );
}

async function insertAudit(
  client: Queryable,
  input: {
    applicationId: string;
    action: string;
    actor?: ActorSnapshot | null;
    fromStatus: string | null;
    toStatus: string;
    comment?: string | null;
    metadata?: Record<string, unknown>;
    now?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO invoice_application_audit_logs (
       id, application_id, action, actor_id, actor_name_snapshot,
       actor_position_snapshot, from_status, to_status, comment,
       metadata_json, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
    [
      nanoid(),
      input.applicationId,
      input.action,
      input.actor?.id || null,
      input.actor?.name || "系统",
      input.actor
        ? [input.actor.department, input.actor.position]
            .filter(Boolean)
            .join(" ") || "员工"
        : "系统",
      input.fromStatus,
      input.toStatus,
      input.comment || null,
      JSON.stringify(input.metadata || {}),
      input.now || new Date().toISOString(),
    ],
  );
}

/**
 * 在同一根合同锁内重建发票事实的 FIFO（先进先出）分配。草稿和已确认发票
 * 均属于正式发票事实，冲正或硬删除后会自动解除分配并重新打开待开票申请。
 */
export async function reconcileInvoiceApplicationAllocations(
  client: Queryable,
  contractId: string,
): Promise<void> {
  const rootId = await lockRoot(client, contractId);
  const applicationResult = await client.query<{
    id: string;
    amount: number;
    status: InvoiceApplicationStatus;
    submitted_at: string;
    issued_at: string | null;
  }>(
    `SELECT id, amount, status, submitted_at, issued_at
       FROM invoice_applications
      WHERE contract_id = $1
        AND status IN ('pending_invoice', 'completed')
        AND submitted_at IS NOT NULL
      ORDER BY submitted_at, id FOR UPDATE`,
    [rootId],
  );
  const invoiceResult = await client.query<{
    id: string;
    amount: number;
    created_at: string;
  }>(
    `SELECT invoice.id, invoice.amount, invoice.created_at
       FROM contract_invoices invoice
       JOIN contracts contract ON contract.id = invoice.contract_id
      WHERE COALESCE(contract.root_contract_id, contract.id) = $1
        AND contract.is_deleted = FALSE
        AND invoice.status IN ('draft', 'confirmed')
      ORDER BY invoice.created_at, invoice.id FOR SHARE OF invoice`,
    [rootId],
  );
  const previousResult = await client.query<{
    application_id: string;
    allocated_amount: number;
  }>(
    `SELECT allocation.application_id, SUM(allocation.allocated_amount) AS allocated_amount
       FROM invoice_application_invoice_allocations allocation
       JOIN invoice_applications application ON application.id = allocation.application_id
      WHERE application.contract_id = $1
      GROUP BY allocation.application_id`,
    [rootId],
  );
  const previous = new Map(
    previousResult.rows.map((row) => [
      row.application_id,
      Number(row.allocated_amount || 0),
    ]),
  );
  const desired = allocateInvoiceApplicationFacts(
    applicationResult.rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      submittedAt: row.submitted_at,
    })),
    invoiceResult.rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount),
      createdAt: row.created_at,
    })),
  );
  await client.query(
    `DELETE FROM invoice_application_invoice_allocations allocation
      USING invoice_applications application
      WHERE allocation.application_id = application.id
        AND application.contract_id = $1`,
    [rootId],
  );
  const now = new Date().toISOString();
  for (const allocation of desired) {
    await client.query(
      `INSERT INTO invoice_application_invoice_allocations (
         id, application_id, invoice_id, allocated_amount, created_at
       ) VALUES ($1,$2,$3,$4,$5)`,
      [
        nanoid(),
        allocation.applicationId,
        allocation.invoiceId,
        allocation.allocatedAmount,
        now,
      ],
    );
  }
  const desiredTotals = new Map<string, number>();
  for (const allocation of desired) {
    desiredTotals.set(
      allocation.applicationId,
      fromCents(
        toCents(desiredTotals.get(allocation.applicationId) || 0) +
          toCents(allocation.allocatedAmount),
      ),
    );
  }
  for (const application of applicationResult.rows) {
    const before = previous.get(application.id) || 0;
    const after = desiredTotals.get(application.id) || 0;
    const nextStatus = statusAfterInvoiceAllocation({
      currentStatus: application.status as "pending_invoice" | "completed",
      applicationAmount: Number(application.amount),
      allocatedAmount: after,
      issuedAt: application.issued_at,
    });
    await client.query(
      `UPDATE invoice_applications SET status = $2,
         completed_at = CASE WHEN $2 = 'completed'
           THEN COALESCE(completed_at, $3) ELSE NULL END,
         updated_at = CASE WHEN status <> $2 THEN $3 ELSE updated_at END,
         version = CASE WHEN status <> $2 THEN version + 1 ELSE version END
       WHERE id = $1`,
      [application.id, nextStatus, now],
    );
    if (toCents(before) !== toCents(after)) {
      await insertAudit(client, {
        applicationId: application.id,
        action:
          toCents(after) > toCents(before)
            ? "invoice_allocated"
            : "invoice_allocation_reversed",
        fromStatus: application.status,
        toStatus: nextStatus,
        metadata: { beforeAllocatedAmount: before, allocatedAmount: after },
        now,
      });
    }
    if (application.status !== nextStatus) {
      await insertAudit(client, {
        applicationId: application.id,
        action: nextStatus === "completed" ? "auto_complete" : "auto_reopen",
        fromStatus: application.status,
        toStatus: nextStatus,
        metadata: {
          allocatedAmount: after,
          applicationAmount: application.amount,
        },
        now,
      });
    }
  }
}

async function reconcileInTransaction(contractId: string): Promise<void> {
  await db.transaction(async (client) => {
    await reconcileInvoiceApplicationAllocations(client, contractId);
  });
}

export async function getInvoiceApplicationEligibility(
  actor: InvoiceApplicationActor,
  contractId: string,
): Promise<InvoiceApplicationEligibility> {
  await reconcileInTransaction(contractId);
  const contract = await loadContract(pool, contractId);
  if (!contract) {
    throw new InvoiceApplicationError("合同不存在", 404, "CONTRACT_NOT_FOUND");
  }
  assertReadScope(actor, contract);
  const amounts = await capacityForContract(pool, contract.id);
  const blocked = eligibilityReason(contract);
  const noCapacity = amounts.remainingAmount <= 0;
  const display = contractDisplay(contract);
  return {
    eligible: !blocked.code && !noCapacity,
    reasonCode:
      blocked.code ||
      (noCapacity ? "INVOICE_APPLICATION_NO_REMAINING_AMOUNT" : null),
    reason:
      blocked.reason || (noCapacity ? "该合同已无剩余可申请开票额度" : null),
    contract: {
      id: contract.id,
      title: display.title,
      contractNo: display.contractNo,
      category: contract.category,
      area: contract.area,
      partyA: display.partyA,
      status: contract.status,
    },
    amounts,
    triplicatePreviousPaymentAmount:
      contract.category === "main_business"
        ? await previousTriplicatePaymentAmount(pool, contract.id)
        : 0,
    billingPrefill: await billingPrefill(pool, display.partyA),
  };
}

export async function getInvoiceApplicationEligibilityBatch(
  actor: InvoiceApplicationActor,
  contractIds: string[],
): Promise<Record<string, InvoiceApplicationEligibility>> {
  const ids = Array.from(
    new Set(contractIds.map((id) => id.trim()).filter(Boolean)),
  ).slice(0, 100);
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        return [id, await getInvoiceApplicationEligibility(actor, id)] as const;
      } catch (error) {
        if (
          error instanceof InvoiceApplicationError &&
          [403, 404].includes(error.statusCode)
        ) {
          return [
            id,
            {
              eligible: false,
              reasonCode: error.code,
              reason: error.message,
              contract: null,
              amounts: {
                currentEffectiveAmount: 0,
                invoicedAmount: 0,
                pendingAmount: 0,
                remainingAmount: 0,
              },
              triplicatePreviousPaymentAmount: 0,
              billingPrefill: null,
            } satisfies InvoiceApplicationEligibility,
          ] as const;
        }
        throw error;
      }
    }),
  );
  return Object.fromEntries(entries);
}

function applicationNumber(sequence: number, date: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/-/g, "");
  return `KP-${day}-${String(sequence).padStart(6, "0")}`;
}

export async function createInvoiceApplication(
  actor: InvoiceApplicationActor,
  rawInput: InvoiceApplicationDraftInput,
): Promise<InvoiceApplicationView> {
  if (actor.role !== "user")
    throw new InvoiceApplicationError(
      "仅普通员工可以发起开票申请",
      403,
      "INVOICE_APPLICATION_EMPLOYEE_ONLY",
    );
  const contractId = requiredText(rawInput.contractId, "合同编号", 100);
  const eligibility = await getInvoiceApplicationEligibility(actor, contractId);
  if (!eligibility.eligible)
    throw new InvoiceApplicationError(
      eligibility.reason || "当前合同不能申请开票",
      409,
      eligibility.reasonCode || "INVOICE_APPLICATION_NOT_ELIGIBLE",
    );
  const contract = await loadContract(pool, contractId);
  if (!contract || !eligibility.contract)
    throw new InvoiceApplicationError("合同不存在", 404, "CONTRACT_NOT_FOUND");
  const input = normalizeDraftInput(rawInput, contract.category);
  const applicant = await actorSnapshot(pool, actor.id);
  const prefill = eligibility.billingPrefill;
  const billing = resolveInvoiceApplicationBillingInfo(
    rawInput.billingInfo,
    input.billingInfo,
    prefill,
  );
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const id = nanoid();
  await db.transaction(async (client) => {
    const sequence = await client.query<{ value: number }>(
      `SELECT nextval('invoice_application_no_sequence')::bigint AS value`,
    );
    const display = contractDisplay(contract);
    await client.query(
      `INSERT INTO invoice_applications (
         id, application_no, contract_id, applicant_id,
         applicant_name_snapshot, applicant_position_snapshot,
         contract_no_snapshot, contract_title_snapshot,
         contract_category_snapshot, contract_area_snapshot, party_a_snapshot,
         contract_amount_snapshot, amount, invoice_content, invoice_type,
         description, material_mode, billing_name, billing_tax_number,
         billing_address, billing_phone, billing_bank_name,
         billing_bank_account, billing_remark, billing_confirmed,
         billing_prefill_source_application_id, billing_original_json,
         applicant_department_snapshot, status, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
         $18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28,'draft',$29,$29
       )`,
      [
        id,
        applicationNumber(Number(sequence.rows[0].value), nowDate),
        contract.id,
        applicant.id,
        applicant.name,
        applicant.position,
        display.contractNo,
        display.title,
        contract.category,
        contract.area,
        display.partyA,
        eligibility.amounts.currentEffectiveAmount,
        input.amount,
        input.invoiceContent,
        input.invoiceType,
        input.description || null,
        input.materialMode,
        billing.name,
        billing.taxNumber,
        billing.address || null,
        billing.phone || null,
        billing.bankName || null,
        billing.bankAccount || null,
        billing.remark || null,
        input.confirmedBillingIdentity,
        prefill?.sourceApplicationId || null,
        JSON.stringify(prefill || {}),
        applicant.department,
        now,
      ],
    );
    await insertAudit(client, {
      applicationId: id,
      action: "draft_created",
      actor: applicant,
      fromStatus: null,
      toStatus: "draft",
      metadata: {
        billingPrefillSourceApplicationId: prefill?.sourceApplicationId || null,
        billingOriginal: prefill || null,
        billingInfo: billing,
        billingModified: Boolean(
          prefill &&
          JSON.stringify({
            name: prefill.name,
            taxNumber: prefill.taxNumber,
            address: prefill.address,
            phone: prefill.phone,
            bankName: prefill.bankName,
            bankAccount: prefill.bankAccount,
            remark: prefill.remark,
          }) !== JSON.stringify(billing),
        ),
      },
      now,
    });
  });
  return getInvoiceApplication(actor, id);
}

async function loadApplication(
  client: Queryable,
  id: string,
  lock = false,
): Promise<InvoiceApplicationRow> {
  const result = await client.query<InvoiceApplicationRow>(
    `SELECT * FROM invoice_applications WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  const row = result.rows[0];
  if (!row)
    throw new InvoiceApplicationError(
      "开票申请不存在",
      404,
      "INVOICE_APPLICATION_NOT_FOUND",
    );
  return row;
}

async function lockApplicationAfterRoot(
  client: Queryable,
  applicationId: string,
): Promise<{ application: InvoiceApplicationRow; rootId: string }> {
  const initial = await loadApplication(client, applicationId);
  const rootId = await lockRoot(client, initial.contract_id);
  const application = await loadApplication(client, applicationId, true);
  return { application, rootId };
}

function assertApplicationAccess(
  actor: InvoiceApplicationActor,
  application: InvoiceApplicationRow,
): void {
  const managerCanReadPending =
    actor.role === "general_manager" &&
    application.status === "pending_approval" &&
    actor.id === application.target_approver_id;
  const managerCanReadProcessed =
    actor.role === "general_manager" &&
    actor.id === application.approver_id &&
    Boolean(application.decided_at);
  if (
    actor.id !== application.applicant_id &&
    !managerCanReadPending &&
    !managerCanReadProcessed &&
    !(INVOICE_APPLICATION_ADMIN_ROLES as readonly string[]).includes(actor.role)
  ) {
    throw new InvoiceApplicationError(
      "无权查看该开票申请",
      403,
      "INVOICE_APPLICATION_FORBIDDEN",
    );
  }
}

export async function updateInvoiceApplication(
  actor: InvoiceApplicationActor,
  applicationId: string,
  rawInput: InvoiceApplicationDraftInput,
  expectedVersion: number,
): Promise<InvoiceApplicationView> {
  await db.transaction(async (client) => {
    const application = await loadApplication(client, applicationId, true);
    if (application.applicant_id !== actor.id || actor.role !== "user")
      throw new InvoiceApplicationError("仅申请人可以修改草稿", 403);
    if (!(["draft", "rejected"] as const).includes(application.status as never))
      throw new InvoiceApplicationError("当前状态不能修改", 409);
    if (application.version !== expectedVersion)
      throw new InvoiceApplicationError(
        "申请已发生变化，请刷新后重试",
        409,
        "INVOICE_APPLICATION_VERSION_CONFLICT",
      );
    const contract = await loadContract(client, application.contract_id, true);
    if (!contract) throw new InvoiceApplicationError("合同不存在", 404);
    const input = normalizeDraftInput(rawInput, contract.category);
    if (input.contractId !== application.contract_id)
      throw new InvoiceApplicationError("草稿不能更换所属合同");
    if (
      application.contract_category_snapshot === "main_business" &&
      toCents(input.amount) !== toCents(application.amount)
    ) {
      const materials = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM invoice_application_materials
          WHERE application_id=$1`,
        [application.id],
      );
      if (Number(materials.rows[0]?.count || 0) > 0) {
        throw new InvoiceApplicationError(
          "主营开票金额由已上传三联单确定；如需变更，请先删除三联单并重新上传",
          409,
          "MAIN_TRIPLICATE_AMOUNT_LOCKED",
        );
      }
    }
    const actorRow = await actorSnapshot(client, actor.id);
    const beforeBilling = {
      name: application.billing_name,
      taxNumber: application.billing_tax_number,
      address: application.billing_address || "",
      phone: application.billing_phone || "",
      bankName: application.billing_bank_name || "",
      bankAccount: application.billing_bank_account || "",
      remark: application.billing_remark || "",
    };
    const now = new Date().toISOString();
    await client.query(
      `UPDATE invoice_application_generated_files SET is_current=FALSE
        WHERE application_id=$1 AND is_current=TRUE`,
      [application.id],
    );
    await client.query(
      `UPDATE invoice_applications SET amount=$2, invoice_content=$3,
         invoice_type=$4, description=$5, material_mode=$6,
         billing_name=$7, billing_tax_number=$8, billing_address=$9,
         billing_phone=$10, billing_bank_name=$11, billing_bank_account=$12,
         billing_remark=$13, billing_confirmed=$14, status='draft',
         target_approver_id=NULL, target_approver_name_snapshot=NULL,
         target_approver_position_snapshot=NULL,
         applicant_signature_snapshot_path=NULL,
         applicant_signature_snapshot_hash=NULL, applicant_signed_at=NULL,
         applicant_signed_file_id=NULL, approved_file_id=NULL,
         submitted_invoiced_amount_snapshot=NULL,
         submitted_pending_amount_snapshot=NULL,
         submitted_remaining_amount_snapshot=NULL, submitted_at=NULL,
         decision_comment=NULL, decided_at=NULL, approver_id=NULL,
         approver_name_snapshot=NULL, approver_position_snapshot=NULL,
         approver_signature_snapshot_path=NULL,
         approver_signature_snapshot_hash=NULL,
         delivered_by=NULL, delivered_by_name_snapshot=NULL,
         delivery_note=NULL, delivered_at=NULL,
         issued_by=NULL, issued_by_name_snapshot=NULL, issue_note=NULL,
         issued_at=NULL, completed_at=NULL,
         updated_at=$15, version=version+1 WHERE id=$1`,
      [
        application.id,
        input.amount,
        input.invoiceContent,
        input.invoiceType,
        input.description || null,
        input.materialMode,
        input.billingInfo.name,
        input.billingInfo.taxNumber,
        input.billingInfo.address || null,
        input.billingInfo.phone || null,
        input.billingInfo.bankName || null,
        input.billingInfo.bankAccount || null,
        input.billingInfo.remark || null,
        input.confirmedBillingIdentity,
        now,
      ],
    );
    await insertAudit(client, {
      applicationId: application.id,
      action: "draft_updated",
      actor: actorRow,
      fromStatus: application.status,
      toStatus: "draft",
      metadata: { beforeBilling, billingInfo: input.billingInfo },
      now,
    });
  });
  return getInvoiceApplication(actor, applicationId);
}

function absoluteStoredPath(storedPath: string, label: string): string {
  if (!validateFilePath(storedPath))
    throw new InvoiceApplicationError(
      `${label}路径不正确`,
      409,
      "INVOICE_APPLICATION_FILE_PATH_INVALID",
    );
  const absolutePath = path.resolve(
    process.cwd(),
    storedPath.replace(/^[/\\]+/, ""),
  );
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile())
    throw new InvoiceApplicationError(
      `${label}不存在`,
      409,
      "INVOICE_APPLICATION_FILE_MISSING",
    );
  return absolutePath;
}

async function snapshotSignature(
  client: Queryable,
  actor: ActorSnapshot,
  applicationId: string,
  stage: "applicant" | "approver",
): Promise<{ path: string; hash: string; buffer: Buffer }> {
  const signature = await client.query<{ signature_path: string }>(
    `SELECT signature_path FROM user_signatures WHERE user_id = $1 FOR SHARE`,
    [actor.id],
  );
  if (!signature.rows[0])
    throw new InvoiceApplicationError(
      "请先在个人设置上传并锁定本人电子签名",
      409,
      "PERSONAL_SIGNATURE_REQUIRED",
    );
  const source = absoluteStoredPath(
    signature.rows[0].signature_path,
    "个人电子签名",
  );
  const normalized = await normalizeSignaturePng(fs.readFileSync(source));
  const directory = ensureDatedUploadDirectory(
    "invoice-applications",
    new Date(),
    applicationId,
    "signatures",
  );
  const output = path.join(directory, `${stage}-${nanoid()}.png`);
  fs.writeFileSync(output, normalized, { flag: "wx" });
  return {
    path: toStoredUploadPath(output),
    hash: crypto.createHash("sha256").update(normalized).digest("hex"),
    buffer: normalized,
  };
}

function readSignatureSnapshot(
  storedPath: string,
  expectedHash: string,
): Buffer {
  const buffer = fs.readFileSync(
    absoluteStoredPath(storedPath, "电子签名快照"),
  );
  const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actualHash !== expectedHash)
    throw new InvoiceApplicationError(
      "电子签名快照内容发生变化，已阻止生成申请单",
      409,
      "INVOICE_APPLICATION_SIGNATURE_HASH_MISMATCH",
    );
  return buffer;
}

export interface InvoiceApplicationPdfData {
  applicationNo: string;
  contractNo: string;
  contractTitle: string;
  contractCategory: "main_business" | "non_main";
  contractArea: string;
  partyA: string;
  contractAmount: number;
  submittedAmounts: InvoiceApplicationAmounts;
  amount: number;
  invoiceContent: string;
  invoiceType: string;
  description: string;
  materialMode: InvoiceApplicationMaterialMode;
  materialNames: string[];
  sealedMaterialNames: string[];
  billingInfo: InvoiceApplicationBillingInfo;
  applicant: ActorSnapshot;
  applicantSignedAt: string;
  applicantSignature: Buffer;
  approver: ActorSnapshot;
  approverSignedAt?: string;
  approverSignature?: Buffer;
  decisionComment?: string;
}

function formatCurrency(value: number): string {
  return `¥${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function displayDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function wrapCanvasText(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  text: string,
  maximumWidth: number,
): string[] {
  const source = text || "—";
  const lines: string[] = [];
  let line = "";
  for (const character of Array.from(source)) {
    if (character === "\n") {
      lines.push(line || " ");
      line = "";
      continue;
    }
    const candidate = `${line}${character}`;
    if (line && context.measureText(candidate).width > maximumWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line || lines.length === 0) lines.push(line || "—");
  return lines;
}

function limitCanvasLines(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  lines: string[],
  maximumWidth: number,
  maximumLines: number,
): string[] {
  if (lines.length <= maximumLines) return lines;
  const visible = lines.slice(0, maximumLines);
  const characters = Array.from(visible[maximumLines - 1] || "");
  while (
    characters.length > 0 &&
    context.measureText(`${characters.join("")}…`).width > maximumWidth
  ) {
    characters.pop();
  }
  visible[maximumLines - 1] = `${characters.join("")}…`;
  return visible;
}

export async function renderInvoiceApplicationPdf(
  input: InvoiceApplicationPdfData,
): Promise<Buffer> {
  const width = 1240;
  const height = 1754;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#172a3a";
  context.textBaseline = "top";
  context.font = 'bold 42px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
  context.textAlign = "center";
  context.fillText("开票及用印申请单", width / 2, 55);
  context.font = '20px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
  context.fillStyle = "#607487";
  context.fillText(`申请编号：${input.applicationNo}`, width / 2, 112);
  context.textAlign = "left";

  const left = 78;
  const right = width - 78;
  let y = 155;
  const section = (title: string) => {
    context.fillStyle = "#e9f6f4";
    context.fillRect(left, y, right - left, 43);
    context.fillStyle = "#117e78";
    context.font =
      'bold 22px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
    context.fillText(title, left + 16, y + 8);
    y += 53;
  };
  const row = (
    label: string,
    value: string,
    options?: { small?: boolean; maxLines?: number },
  ) => {
    context.fillStyle = "#526679";
    context.font = '20px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
    context.fillText(label, left + 8, y + 5);
    context.fillStyle = "#172a3a";
    context.font = `${options?.small ? 15 : 19}px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
    const maximumWidth = right - left - 255;
    const lines = limitCanvasLines(
      context,
      wrapCanvasText(context, value || "—", maximumWidth),
      maximumWidth,
      options?.maxLines || 2,
    );
    lines.forEach((line, index) =>
      context.fillText(
        line,
        left + 230,
        y + 5 + index * (options?.small ? 20 : 25),
      ),
    );
    const rowHeight = Math.max(
      34,
      12 + lines.length * (options?.small ? 20 : 25),
    );
    context.strokeStyle = "#d8e2e9";
    context.beginPath();
    context.moveTo(left, y + rowHeight);
    context.lineTo(right, y + rowHeight);
    context.stroke();
    y += rowHeight;
  };

  section("一、合同及额度快照");
  row("合同名称", input.contractTitle);
  row("合同编号", input.contractNo);
  row(
    "分类／区域／甲方",
    `${input.contractCategory === "main_business" ? "主营项目合同" : "非主营项目合同"}／${input.contractArea}／${input.partyA}`,
    { small: true },
  );
  row(
    "提交时额度",
    `当前有效合同金额 ${formatCurrency(input.contractAmount)}；已开票 ${formatCurrency(input.submittedAmounts.invoicedAmount)}；审批及待开票占用 ${formatCurrency(input.submittedAmounts.pendingAmount)}；剩余可申请 ${formatCurrency(input.submittedAmounts.remainingAmount)}`,
    { small: true, maxLines: 3 },
  );

  section("二、本次开票申请");
  row("本次申请金额", formatCurrency(input.amount));
  row(
    "金额口径",
    "三联单中的“本次付款”表示客户本次拟支付、我公司据此申请开票的金额，不代表我公司对外付款。",
    { small: true },
  );
  row("发票类型", input.invoiceType);
  row("开票说明", input.description || "无", {
    small: true,
    maxLines: 3,
  });

  section("三、对方开票信息");
  row("名称", input.billingInfo.name);
  row("税号", input.billingInfo.taxNumber);
  row(
    "地址／电话",
    `${input.billingInfo.address || "—"}／${input.billingInfo.phone || "—"}`,
    { small: true },
  );
  row(
    "开户行／账号",
    `${input.billingInfo.bankName || "—"}／${input.billingInfo.bankAccount || "—"}`,
    { small: true },
  );
  row("备注", input.billingInfo.remark || "无", { small: true });

  section("四、材料及用印说明");
  const modeLabel =
    input.materialMode === "material_need_seal"
      ? "有材料，需要盖章"
      : input.materialMode === "material_no_seal"
        ? "有材料，不需要盖章"
        : "不需要材料";
  row("材料方式", modeLabel);
  row("全部材料", input.materialNames.join("、") || "无", {
    small: true,
    maxLines: 3,
  });
  row("需盖章附件", input.sealedMaterialNames.join("、") || "无", {
    small: true,
    maxLines: 3,
  });

  const signatureTop = height - 305;
  if (y > signatureTop - 20)
    throw new InvoiceApplicationError(
      "开票申请单内容超过单页安全范围，请精简说明后重试",
      409,
      "INVOICE_APPLICATION_PDF_CONTENT_OVERFLOW",
    );
  context.strokeStyle = "#b8c8d3";
  context.strokeRect(left, signatureTop, (right - left - 20) / 2, 220);
  context.strokeRect(
    left + (right - left + 20) / 2,
    signatureTop,
    (right - left - 20) / 2,
    220,
  );
  context.fillStyle = "#172a3a";
  context.font = 'bold 20px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
  context.fillText("申请人签字", left + 15, signatureTop + 12);
  context.fillText(
    "总经理审批签字",
    left + (right - left + 20) / 2 + 15,
    signatureTop + 12,
  );
  const applicantImage = await loadImage(input.applicantSignature);
  context.drawImage(applicantImage, left + 35, signatureTop + 50, 230, 105);
  context.font = '16px "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
  context.fillText(
    `${[
      input.applicant.department,
      input.applicant.position,
      input.applicant.name,
    ]
      .filter(Boolean)
      .join(" ")}  ${displayDateTime(input.applicantSignedAt)}`,
    left + 15,
    signatureTop + 178,
  );
  const approverLeft = left + (right - left + 20) / 2;
  if (input.approverSignature && input.approverSignedAt) {
    const approverImage = await loadImage(input.approverSignature);
    context.drawImage(
      approverImage,
      approverLeft + 35,
      signatureTop + 50,
      230,
      105,
    );
    context.fillText(
      `${input.approver.position} ${input.approver.name}  ${displayDateTime(input.approverSignedAt)}`,
      approverLeft + 15,
      signatureTop + 178,
    );
    if (input.decisionComment) {
      const opinionWidth = (right - left - 20) / 2 - 300;
      const opinionLines = limitCanvasLines(
        context,
        wrapCanvasText(context, `意见：${input.decisionComment}`, opinionWidth),
        opinionWidth,
        4,
      );
      opinionLines.forEach((line, index) =>
        context.fillText(
          line,
          approverLeft + 285,
          signatureTop + 55 + index * 20,
        ),
      );
    }
  } else {
    context.fillStyle = "#8a9aa8";
    context.fillText("待总经理审批签字", approverLeft + 35, signatureTop + 92);
  }

  const png = canvas.toBuffer("image/png");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const image = await pdf.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return Buffer.from(await pdf.save());
}

async function applicationMaterialsForPdf(
  client: Queryable,
  applicationId: string,
): Promise<{ materialNames: string[]; sealedMaterialNames: string[] }> {
  const result = await client.query<{
    file_name: string;
    requires_seal: boolean;
  }>(
    `SELECT file_name, requires_seal FROM invoice_application_materials
      WHERE application_id=$1 ORDER BY created_at,id`,
    [applicationId],
  );
  return {
    materialNames: result.rows.map((row) => row.file_name),
    sealedMaterialNames: result.rows
      .filter((row) => row.requires_seal)
      .map((row) => row.file_name),
  };
}

async function saveGeneratedApplicationFile(
  client: Queryable,
  input: {
    applicationId: string;
    kind: "applicant_signed" | "approved";
    createdBy: string;
    pdf: Buffer;
    now: string;
  },
): Promise<string> {
  await client.query(
    `UPDATE invoice_application_generated_files SET is_current=FALSE
      WHERE application_id=$1 AND file_kind=$2 AND is_current=TRUE`,
    [input.applicationId, input.kind],
  );
  const versionResult = await client.query<{ version: number }>(
    `SELECT COALESCE(MAX(version),0)+1 AS version
       FROM invoice_application_generated_files
      WHERE application_id=$1 AND file_kind=$2`,
    [input.applicationId, input.kind],
  );
  const version = Number(versionResult.rows[0]?.version || 1);
  const directory = ensureDatedUploadDirectory(
    "invoice-applications",
    new Date(input.now),
    input.applicationId,
    "generated",
  );
  const label = input.kind === "applicant_signed" ? "员工单签" : "审批双签";
  const fileName = `${label}开票申请单-v${version}.pdf`;
  const absolutePath = path.join(
    directory,
    `${input.kind}-v${version}-${nanoid()}.pdf`,
  );
  fs.writeFileSync(absolutePath, input.pdf, { flag: "wx" });
  const id = nanoid();
  await client.query(
    `INSERT INTO invoice_application_generated_files (
       id,application_id,file_kind,file_name,file_path,file_hash,version,
       is_current,created_by,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8,$9)`,
    [
      id,
      input.applicationId,
      input.kind,
      fileName,
      toStoredUploadPath(absolutePath),
      crypto.createHash("sha256").update(input.pdf).digest("hex"),
      version,
      input.createdBy,
      input.now,
    ],
  );
  return id;
}

async function validateSubmitMaterials(
  client: Queryable,
  application: InvoiceApplicationRow,
): Promise<void> {
  const materials = await client.query<MaterialRow>(
    `SELECT * FROM invoice_application_materials
      WHERE application_id = $1 ORDER BY created_at, id FOR SHARE`,
    [application.id],
  );
  assertInvoiceApplicationMaterialPolicy({
    category: application.contract_category_snapshot,
    materialMode: application.material_mode,
    materials: materials.rows.map((item) => ({
      requiresSeal: item.requires_seal,
      hasOtherExpenseSheet: item.has_other_expense_sheet,
    })),
  });
  if (application.contract_category_snapshot === "main_business") {
    const material = materials.rows[0];
    const absolutePath = absoluteStoredPath(material.file_path, "主营三联单");
    const buffer = fs.readFileSync(absolutePath);
    const actualHash = crypto.createHash("sha256").update(buffer).digest("hex");
    if (actualHash !== material.file_hash)
      throw new InvoiceApplicationError(
        "主营三联单内容发生变化，已阻止提交审批",
        409,
        "INVOICE_APPLICATION_MATERIAL_HASH_MISMATCH",
      );
    if (material.is_system_generated_triplicate) {
      const previous = application.triplicate_previous_payment_snapshot;
      const cumulative = application.triplicate_cumulative_payment_snapshot;
      if (
        !application.triplicate_project_name ||
        previous == null ||
        cumulative == null ||
        toCents(cumulative) !== toCents(previous) + toCents(application.amount)
      )
        throw new InvoiceApplicationError(
          "在线三联单金额快照不完整，请重新生成",
          409,
          "MAIN_TRIPLICATE_SNAPSHOT_INVALID",
        );
      const contract = await loadContract(
        client,
        application.contract_id,
        false,
      );
      if (
        !contract ||
        toCents(currentContractAmount(contract)) !==
          toCents(application.contract_amount_snapshot)
      )
        throw new InvoiceApplicationError(
          "合同当前有效金额已发生变化，请重新生成三联单",
          409,
          "MAIN_TRIPLICATE_CONTRACT_AMOUNT_CHANGED",
        );
      const currentPreviousPayment = await previousTriplicatePaymentAmount(
        client,
        application.contract_id,
        application.id,
      );
      if (toCents(currentPreviousPayment) !== toCents(previous))
        throw new InvoiceApplicationError(
          "以前累计付款已发生变化，请重新生成三联单",
          409,
          "MAIN_TRIPLICATE_PREVIOUS_PAYMENT_CHANGED",
        );
      return;
    }
    const inspection = await inspectInvoiceApplicationMaterial({
      contractCategory: "main",
      materialMode: "material_need_seal",
      file: { buffer, originalName: material.file_name },
    });
    if (
      inspection.recognizedApplicationAmount == null ||
      toCents(inspection.recognizedApplicationAmount) !==
        toCents(application.amount)
    )
      throw new InvoiceApplicationError(
        "三联单“其他费用－本次付款”金额与申请开票金额不一致",
        409,
        "MAIN_TRIPLICATE_AMOUNT_MISMATCH",
      );
  }
}

export async function submitInvoiceApplication(
  actor: InvoiceApplicationActor,
  applicationId: string,
  expectedVersion: number,
): Promise<InvoiceApplicationView> {
  if (actor.role !== "user")
    throw new InvoiceApplicationError("仅申请人可以提交开票申请", 403);
  await db.transaction(async (client) => {
    const { application, rootId } = await lockApplicationAfterRoot(
      client,
      applicationId,
    );
    if (application.applicant_id !== actor.id)
      throw new InvoiceApplicationError("仅申请人可以提交开票申请", 403);
    if (!(["draft", "rejected"] as const).includes(application.status as never))
      throw new InvoiceApplicationError("当前状态不能提交审批", 409);
    if (application.version !== expectedVersion)
      throw new InvoiceApplicationError(
        "申请已发生变化，请刷新后重试",
        409,
        "INVOICE_APPLICATION_VERSION_CONFLICT",
      );
    await reconcileInvoiceApplicationAllocations(client, rootId);
    const contract = await loadContract(client, rootId, false);
    if (!contract) throw new InvoiceApplicationError("合同不存在", 404);
    const blocked = eligibilityReason(contract);
    if (blocked.code)
      throw new InvoiceApplicationError(
        blocked.reason || "合同不能申请开票",
        409,
        blocked.code,
      );
    if (!application.billing_confirmed)
      throw new InvoiceApplicationError("提交前必须确认开票名称和税号");
    if (
      !application.billing_name.trim() ||
      !application.billing_tax_number.trim()
    )
      throw new InvoiceApplicationError("开票名称和税号不能为空");
    await validateSubmitMaterials(client, application);
    const amounts = await capacityForContract(client, rootId);
    if (toCents(application.amount) > toCents(amounts.remainingAmount))
      throw new InvoiceApplicationError(
        `本次申请金额超过剩余可申请额度${amounts.remainingAmount.toFixed(2)}元`,
        409,
        "INVOICE_APPLICATION_AMOUNT_EXCEEDS_REMAINING",
      );
    const applicant = await actorSnapshot(client, actor.id);
    const approver = await uniqueGeneralManager(client);
    const signature = await snapshotSignature(
      client,
      applicant,
      application.id,
      "applicant",
    );
    const now = new Date().toISOString();
    const materialSummary = await applicationMaterialsForPdf(
      client,
      application.id,
    );
    await client.query(
      `UPDATE invoice_application_generated_files SET is_current=FALSE
        WHERE application_id=$1 AND is_current=TRUE`,
      [application.id],
    );
    const applicantSignedPdf = await renderInvoiceApplicationPdf({
      applicationNo: application.application_no,
      contractNo: application.contract_no_snapshot,
      contractTitle: application.contract_title_snapshot,
      contractCategory: application.contract_category_snapshot,
      contractArea: application.contract_area_snapshot,
      partyA: application.party_a_snapshot,
      contractAmount: amounts.currentEffectiveAmount,
      submittedAmounts: amounts,
      amount: Number(application.amount),
      invoiceContent: application.invoice_content,
      invoiceType: application.invoice_type,
      description: application.description || "",
      materialMode: application.material_mode,
      ...materialSummary,
      billingInfo: {
        name: application.billing_name,
        taxNumber: application.billing_tax_number,
        address: application.billing_address || "",
        phone: application.billing_phone || "",
        bankName: application.billing_bank_name || "",
        bankAccount: application.billing_bank_account || "",
        remark: application.billing_remark || "",
      },
      applicant,
      applicantSignedAt: now,
      applicantSignature: signature.buffer,
      approver,
    });
    const applicantSignedFileId = await saveGeneratedApplicationFile(client, {
      applicationId: application.id,
      kind: "applicant_signed",
      createdBy: applicant.id,
      pdf: applicantSignedPdf,
      now,
    });
    await client.query(
      `UPDATE invoice_applications SET status='pending_approval',
         target_approver_id=$2, target_approver_name_snapshot=$3,
         target_approver_position_snapshot=$4,
         applicant_signature_snapshot_path=$5,
         applicant_signature_snapshot_hash=$6, applicant_signed_at=$7,
         applicant_signed_file_id=$12,
         submitted_at=$7, contract_amount_snapshot=$8,
         submitted_invoiced_amount_snapshot=$9,
         submitted_pending_amount_snapshot=$10,
         submitted_remaining_amount_snapshot=$11,
         approver_id=NULL, approver_name_snapshot=NULL,
         approver_position_snapshot=NULL, approver_signature_snapshot_path=NULL,
         approver_signature_snapshot_hash=NULL, approved_file_id=NULL,
         decision_comment=NULL, decided_at=NULL, updated_at=$7,
         version=version+1 WHERE id=$1`,
      [
        application.id,
        approver.id,
        approver.name,
        approver.position,
        signature.path,
        signature.hash,
        now,
        amounts.currentEffectiveAmount,
        amounts.invoicedAmount,
        amounts.pendingAmount,
        amounts.remainingAmount,
        applicantSignedFileId,
      ],
    );
    await insertAudit(client, {
      applicationId: application.id,
      action: "submit",
      actor: applicant,
      fromStatus: application.status,
      toStatus: "pending_approval",
      metadata: { amounts },
      now,
    });
  });
  return getInvoiceApplication(actor, applicationId);
}

export async function withdrawInvoiceApplication(
  actor: InvoiceApplicationActor,
  applicationId: string,
  expectedVersion: number,
): Promise<InvoiceApplicationView> {
  if (actor.role !== "user")
    throw new InvoiceApplicationError(
      "仅申请人可以撤回开票申请",
      403,
      "INVOICE_APPLICATION_APPLICANT_ONLY",
    );
  let signatureSnapshotPath: string | null = null;
  await db.transaction(async (client) => {
    const { application } = await lockApplicationAfterRoot(
      client,
      applicationId,
    );
    if (application.applicant_id !== actor.id)
      throw new InvoiceApplicationError("仅申请人可以撤回开票申请", 403);
    if (application.status !== "pending_approval")
      throw new InvoiceApplicationError(
        "只有尚未审批的申请可以撤回",
        409,
        "INVOICE_APPLICATION_WITHDRAW_STATUS_INVALID",
      );
    if (application.version !== expectedVersion)
      throw new InvoiceApplicationError(
        "申请已发生变化，请刷新后重试",
        409,
        "INVOICE_APPLICATION_VERSION_CONFLICT",
      );
    signatureSnapshotPath = application.applicant_signature_snapshot_path;
    const applicant = await actorSnapshot(client, actor.id);
    const now = new Date().toISOString();
    await client.query(
      `UPDATE invoice_application_generated_files SET is_current=FALSE
        WHERE application_id=$1 AND is_current=TRUE`,
      [application.id],
    );
    await client.query(
      `UPDATE invoice_applications SET status='draft',
         target_approver_id=NULL,target_approver_name_snapshot=NULL,
         target_approver_position_snapshot=NULL,
         applicant_signature_snapshot_path=NULL,
         applicant_signature_snapshot_hash=NULL,applicant_signed_at=NULL,
         applicant_signed_file_id=NULL,
         submitted_invoiced_amount_snapshot=NULL,
         submitted_pending_amount_snapshot=NULL,
         submitted_remaining_amount_snapshot=NULL,submitted_at=NULL,
         updated_at=$2,version=version+1
       WHERE id=$1`,
      [application.id, now],
    );
    await insertAudit(client, {
      applicationId: application.id,
      action: "withdraw",
      actor: applicant,
      fromStatus: "pending_approval",
      toStatus: "draft",
      metadata: { reason: "申请人在总经理审批前主动撤回" },
      now,
    });
  });
  if (signatureSnapshotPath) {
    try {
      fs.unlinkSync(
        absoluteStoredPath(signatureSnapshotPath, "申请人签名快照"),
      );
    } catch {
      // 数据库撤回成功后，快照清理失败不回滚业务状态。
    }
  }
  return getInvoiceApplication(actor, applicationId);
}

export async function decideInvoiceApplication(
  actor: InvoiceApplicationActor,
  applicationId: string,
  decision: "approve" | "reject",
  rawComment: unknown,
  expectedVersion: number,
): Promise<InvoiceApplicationView> {
  if (actor.role !== "general_manager")
    throw new InvoiceApplicationError(
      "仅总经理可以审批开票申请",
      403,
      "INVOICE_APPLICATION_APPROVER_ONLY",
    );
  if (!(["approve", "reject"] as const).includes(decision))
    throw new InvoiceApplicationError("请选择批准或驳回");
  const comment = optionalText(rawComment, "审批意见", 1000);
  if (decision === "reject" && !comment)
    throw new InvoiceApplicationError("驳回时必须填写审批意见");
  await db.transaction(async (client) => {
    const { application } = await lockApplicationAfterRoot(
      client,
      applicationId,
    );
    if (application.status !== "pending_approval")
      throw new InvoiceApplicationError("此申请已处理，不能重复审批", 409);
    if (application.version !== expectedVersion)
      throw new InvoiceApplicationError(
        "申请已发生变化，请刷新后重试",
        409,
        "INVOICE_APPLICATION_VERSION_CONFLICT",
      );
    if (application.target_approver_id !== actor.id)
      throw new InvoiceApplicationError("此申请未分配给当前总经理", 403);
    const approver = await actorSnapshot(client, actor.id);
    const now = new Date().toISOString();
    let nextStatus: InvoiceApplicationStatus = "rejected";
    let signature: { path: string; hash: string; buffer: Buffer } | null = null;
    let approvedFileId: string | null = null;
    if (decision === "approve") {
      const contract = await loadContract(
        client,
        application.contract_id,
        true,
      );
      if (!contract || ["terminated", "rejected"].includes(contract.status))
        throw new InvoiceApplicationError(
          "合同已经终止或驳回，不能批准新的开票申请",
          409,
          "INVOICE_APPLICATION_CONTRACT_ENDED",
        );
      signature = await snapshotSignature(
        client,
        approver,
        application.id,
        "approver",
      );
      nextStatus = approvedInvoiceApplicationStatus(application.material_mode);
      if (
        !application.applicant_signature_snapshot_path ||
        !application.applicant_signature_snapshot_hash ||
        !application.applicant_signed_at
      )
        throw new InvoiceApplicationError(
          "申请人签名快照缺失，不能批准",
          409,
          "INVOICE_APPLICATION_APPLICANT_SIGNATURE_REQUIRED",
        );
      const materialSummary = await applicationMaterialsForPdf(
        client,
        application.id,
      );
      const submittedAmounts: InvoiceApplicationAmounts = {
        currentEffectiveAmount: Number(application.contract_amount_snapshot),
        invoicedAmount: Number(
          application.submitted_invoiced_amount_snapshot || 0,
        ),
        pendingAmount: Number(
          application.submitted_pending_amount_snapshot || 0,
        ),
        remainingAmount: Number(
          application.submitted_remaining_amount_snapshot || 0,
        ),
      };
      const approvedPdf = await renderInvoiceApplicationPdf({
        applicationNo: application.application_no,
        contractNo: application.contract_no_snapshot,
        contractTitle: application.contract_title_snapshot,
        contractCategory: application.contract_category_snapshot,
        contractArea: application.contract_area_snapshot,
        partyA: application.party_a_snapshot,
        contractAmount: Number(application.contract_amount_snapshot),
        submittedAmounts,
        amount: Number(application.amount),
        invoiceContent: application.invoice_content,
        invoiceType: application.invoice_type,
        description: application.description || "",
        materialMode: application.material_mode,
        ...materialSummary,
        billingInfo: {
          name: application.billing_name,
          taxNumber: application.billing_tax_number,
          address: application.billing_address || "",
          phone: application.billing_phone || "",
          bankName: application.billing_bank_name || "",
          bankAccount: application.billing_bank_account || "",
          remark: application.billing_remark || "",
        },
        applicant: {
          id: application.applicant_id,
          name: application.applicant_name_snapshot,
          role: "user",
          department: application.applicant_department_snapshot || "",
          position: application.applicant_position_snapshot,
        },
        applicantSignedAt: application.applicant_signed_at,
        applicantSignature: readSignatureSnapshot(
          application.applicant_signature_snapshot_path,
          application.applicant_signature_snapshot_hash,
        ),
        approver,
        approverSignedAt: now,
        approverSignature: signature.buffer,
        decisionComment: comment || "同意",
      });
      approvedFileId = await saveGeneratedApplicationFile(client, {
        applicationId: application.id,
        kind: "approved",
        createdBy: approver.id,
        pdf: approvedPdf,
        now,
      });
    }
    await client.query(
      `UPDATE invoice_applications SET status=$2, approver_id=$3,
         approver_name_snapshot=$4, approver_position_snapshot=$5,
         approver_signature_snapshot_path=$6,
         approver_signature_snapshot_hash=$7, approved_file_id=$10,
         decision_comment=$8, decided_at=$9, updated_at=$9,
         version=version+1 WHERE id=$1`,
      [
        application.id,
        nextStatus,
        approver.id,
        approver.name,
        approver.position,
        signature?.path || null,
        signature?.hash || null,
        comment || null,
        now,
        approvedFileId,
      ],
    );
    await insertAudit(client, {
      applicationId: application.id,
      action: decision,
      actor: approver,
      fromStatus: application.status,
      toStatus: nextStatus,
      comment: comment || null,
      now,
    });
    if (nextStatus === "pending_invoice")
      await reconcileInvoiceApplicationAllocations(
        client,
        application.contract_id,
      );
  });
  return getInvoiceApplication(actor, applicationId);
}

export async function deliverInvoiceApplicationMaterials(
  actor: InvoiceApplicationActor,
  applicationId: string,
  rawNote: unknown,
  expectedVersion: number,
  rawSealedTriplicateFileId: unknown,
): Promise<InvoiceApplicationView> {
  if (
    !(INVOICE_APPLICATION_ADMIN_ROLES as readonly string[]).includes(actor.role)
  )
    throw new InvoiceApplicationError("仅管理员可以登记盖章材料交付", 403);
  const note = optionalText(rawNote, "交付说明", 1000);
  const sealedTriplicateFileId = requiredText(
    rawSealedTriplicateFileId,
    "盖章后三联单文件",
    100,
  );
  await db.transaction(async (client) => {
    const { application } = await lockApplicationAfterRoot(
      client,
      applicationId,
    );
    if (application.status !== "pending_seal")
      throw new InvoiceApplicationError("当前申请不在待盖章状态", 409);
    if (application.version !== expectedVersion)
      throw new InvoiceApplicationError(
        "申请已发生变化，请刷新后重试",
        409,
        "INVOICE_APPLICATION_VERSION_CONFLICT",
      );
    const sealedTriplicate = await client.query<{
      id: string;
      mime_type: string;
    }>(
      `SELECT id, mime_type FROM contract_files
       WHERE id = $1 AND contract_id = $2 AND file_type = 'triplicate'
         AND uploaded_by = $3 AND is_current = TRUE
       FOR UPDATE`,
      [sealedTriplicateFileId, application.contract_id, actor.id],
    );
    if (!sealedTriplicate.rows[0]) {
      throw new InvoiceApplicationError(
        "请先上传本次申请盖章后的三联单",
        409,
        "INVOICE_APPLICATION_SEALED_TRIPLICATE_REQUIRED",
      );
    }
    if (sealedTriplicate.rows[0].mime_type !== "application/pdf") {
      throw new InvoiceApplicationError(
        "盖章后三联单只允许上传 PDF 文件",
        409,
        "INVOICE_APPLICATION_SEALED_TRIPLICATE_PDF_REQUIRED",
      );
    }
    const administrator = await actorSnapshot(client, actor.id);
    const now = new Date().toISOString();
    await client.query(
      `UPDATE invoice_applications SET status='pending_invoice',
         delivered_by=$2, delivered_by_name_snapshot=$3,
         delivery_note=$4, delivered_at=$5, updated_at=$5,
         version=version+1 WHERE id=$1`,
      [application.id, administrator.id, administrator.name, note || null, now],
    );
    await insertAudit(client, {
      applicationId: application.id,
      action: "deliver",
      actor: administrator,
      fromStatus: "pending_seal",
      toStatus: "pending_invoice",
      comment: note || null,
      metadata: { sealedTriplicateFileId },
      now,
    });
    await reconcileInvoiceApplicationAllocations(
      client,
      application.contract_id,
    );
  });
  return getInvoiceApplication(actor, applicationId);
}

export async function markInvoiceApplicationIssued(
  actor: InvoiceApplicationActor,
  applicationId: string,
  rawNote: unknown,
  expectedVersion: number,
): Promise<InvoiceApplicationView> {
  if (
    !(INVOICE_APPLICATION_ADMIN_ROLES as readonly string[]).includes(actor.role)
  )
    throw new InvoiceApplicationError("仅管理员可以登记已开具发票", 403);
  const note = optionalText(rawNote, "开票说明", 1000);
  await db.transaction(async (client) => {
    const { application } = await lockApplicationAfterRoot(
      client,
      applicationId,
    );
    if (application.status !== "pending_invoice")
      throw new InvoiceApplicationError("当前申请不在待开票状态", 409);
    if (application.issued_at)
      throw new InvoiceApplicationError(
        "该申请已登记正式发票开具，不能重复操作",
        409,
        "INVOICE_APPLICATION_ALREADY_ISSUED",
      );
    if (application.version !== expectedVersion)
      throw new InvoiceApplicationError(
        "申请已发生变化，请刷新后重试",
        409,
        "INVOICE_APPLICATION_VERSION_CONFLICT",
      );
    const administrator = await actorSnapshot(client, actor.id);
    const now = new Date().toISOString();
    await client.query(
      `UPDATE invoice_applications SET issued_by=$2,
         issued_by_name_snapshot=$3, issue_note=$4, issued_at=$5,
         updated_at=$5, version=version+1 WHERE id=$1`,
      [application.id, administrator.id, administrator.name, note || null, now],
    );
    await insertAudit(client, {
      applicationId: application.id,
      action: "mark_issued",
      actor: administrator,
      fromStatus: application.status,
      toStatus: application.status,
      comment: note || null,
      metadata: { capacityReleased: false },
      now,
    });
    await reconcileInvoiceApplicationAllocations(
      client,
      application.contract_id,
    );
  });
  return getInvoiceApplication(actor, applicationId);
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

async function toApplicationView(
  client: Queryable,
  application: InvoiceApplicationRow,
): Promise<InvoiceApplicationView> {
  const [
    materialsResult,
    auditResult,
    allocationResult,
    amounts,
    generatedFileResult,
    contractResult,
  ] = await Promise.all([
    client.query<MaterialRow>(
      `SELECT * FROM invoice_application_materials
          WHERE application_id=$1 ORDER BY created_at, id`,
      [application.id],
    ),
    client.query<{
      id: string;
      action: string;
      actor_name_snapshot: string;
      actor_position_snapshot: string;
      from_status: string | null;
      to_status: string;
      comment: string | null;
      metadata_json: unknown;
      created_at: string;
    }>(
      `SELECT * FROM invoice_application_audit_logs
          WHERE application_id=$1 ORDER BY created_at, id`,
      [application.id],
    ),
    client.query<{ amount: number }>(
      `SELECT COALESCE(SUM(allocated_amount),0) AS amount
           FROM invoice_application_invoice_allocations
          WHERE application_id=$1`,
      [application.id],
    ),
    capacityForContract(client, application.contract_id),
    application.approved_file_id || application.applicant_signed_file_id
      ? client.query<{ file_name: string }>(
          `SELECT file_name FROM invoice_application_generated_files
              WHERE id=$1 AND application_id=$2`,
          [
            application.approved_file_id ||
              application.applicant_signed_file_id,
            application.id,
          ],
        )
      : Promise.resolve({ rows: [] } as { rows: Array<{ file_name: string }> }),
    client.query<{ status: string }>(
      `SELECT status FROM contracts WHERE id=$1`,
      [application.contract_id],
    ),
  ]);
  const submittedAmounts =
    application.submitted_invoiced_amount_snapshot == null ||
    application.submitted_pending_amount_snapshot == null ||
    application.submitted_remaining_amount_snapshot == null
      ? null
      : {
          currentEffectiveAmount: Number(application.contract_amount_snapshot),
          invoicedAmount: Number(
            application.submitted_invoiced_amount_snapshot,
          ),
          pendingAmount: Number(application.submitted_pending_amount_snapshot),
          remainingAmount: Number(
            application.submitted_remaining_amount_snapshot,
          ),
        };
  return {
    id: application.id,
    applicationNo: application.application_no,
    contractId: application.contract_id,
    contractTitle: application.contract_title_snapshot,
    contractNo: application.contract_no_snapshot,
    category: application.contract_category_snapshot,
    area: application.contract_area_snapshot,
    partyA: application.party_a_snapshot,
    contractAmount: Number(application.contract_amount_snapshot),
    amount: Number(application.amount),
    triplicateProjectName: application.triplicate_project_name || "",
    triplicatePreviousPayment:
      application.triplicate_previous_payment_snapshot == null
        ? null
        : Number(application.triplicate_previous_payment_snapshot),
    triplicateCumulativePayment:
      application.triplicate_cumulative_payment_snapshot == null
        ? null
        : Number(application.triplicate_cumulative_payment_snapshot),
    invoiceContent: application.invoice_content,
    invoiceType: application.invoice_type,
    description: application.description || "",
    materialMode: application.material_mode,
    billingInfo: {
      name: application.billing_name,
      taxNumber: application.billing_tax_number,
      address: application.billing_address || "",
      phone: application.billing_phone || "",
      bankName: application.billing_bank_name || "",
      bankAccount: application.billing_bank_account || "",
      remark: application.billing_remark || "",
    },
    confirmedBillingIdentity: application.billing_confirmed,
    status: application.status,
    version: Number(application.version),
    applicant: {
      id: application.applicant_id,
      name: application.applicant_name_snapshot,
      department: application.applicant_department_snapshot || "",
      position: application.applicant_position_snapshot,
    },
    approver: application.target_approver_id
      ? {
          id: application.target_approver_id,
          name: application.target_approver_name_snapshot || "总经理",
          position: application.target_approver_position_snapshot || "总经理",
        }
      : null,
    applicantSignedAt: application.applicant_signed_at,
    approverSignedAt: application.approver_signature_snapshot_path
      ? application.decided_at
      : null,
    deliveredAt: application.delivered_at,
    deliveryNote: application.delivery_note || "",
    issuedAt: application.issued_at,
    invoiceNote: application.issue_note || "",
    completedAt: application.completed_at,
    applicantSignedFileId: application.applicant_signed_file_id,
    approvedFileId: application.approved_file_id,
    applicationFileName: generatedFileResult.rows[0]?.file_name || null,
    contractStatus: contractResult.rows[0]?.status || "",
    submittedAmounts,
    currentAmounts: amounts,
    allocatedInvoiceAmount: Number(allocationResult.rows[0]?.amount || 0),
    materials: materialsResult.rows.map((material) => ({
      id: material.id,
      fileName: material.file_name,
      fileSize: Number(material.file_size),
      mimeType: material.mime_type,
      requiresSeal: material.requires_seal,
      hasOtherExpenseSheet: material.has_other_expense_sheet,
      isSystemGeneratedTriplicate: material.is_system_generated_triplicate,
      createdAt: material.created_at,
    })),
    auditLogs: auditResult.rows.map((audit) => ({
      id: audit.id,
      action: audit.action,
      actorName: audit.actor_name_snapshot,
      actorPosition: audit.actor_position_snapshot,
      fromStatus: audit.from_status,
      toStatus: audit.to_status,
      comment: audit.comment,
      metadata: parseMetadata(audit.metadata_json),
      createdAt: audit.created_at,
    })),
    createdAt: application.created_at,
    updatedAt: application.updated_at,
  };
}

export async function getInvoiceApplication(
  actor: InvoiceApplicationActor,
  applicationId: string,
): Promise<InvoiceApplicationView> {
  const initial = await loadApplication(pool, applicationId);
  assertApplicationAccess(actor, initial);
  await reconcileInTransaction(initial.contract_id);
  const current = await loadApplication(pool, applicationId);
  return toApplicationView(pool, current);
}

async function reconcileApplicantInvoiceApplications(
  applicantId: string,
): Promise<void> {
  const contracts = await pool.query<{ contract_id: string }>(
    `SELECT DISTINCT COALESCE(contract.root_contract_id, contract.id) AS contract_id
       FROM invoice_applications application
       JOIN contracts contract ON contract.id = application.contract_id
      WHERE application.applicant_id = $1
        AND application.status IN ('pending_invoice', 'completed')
      ORDER BY contract_id`,
    [applicantId],
  );
  for (const contract of contracts.rows) {
    await reconcileInTransaction(contract.contract_id);
  }
}

export async function listInvoiceApplications(
  actor: InvoiceApplicationActor,
  scope: InvoiceApplicationListScope,
  rawStatus?: string,
  page = 1,
  pageSize = 20,
  employeeView: InvoiceApplicationEmployeeListView = "current",
  rawKeyword = "",
): Promise<{
  items: InvoiceApplicationView[];
  total: number;
  page: number;
  pageSize: number;
}> {
  if (
    rawStatus &&
    ![
      "draft",
      "pending_approval",
      "rejected",
      "pending_seal",
      "pending_invoice",
      "completed",
    ].includes(rawStatus)
  )
    throw new InvoiceApplicationError("开票申请状态不正确");
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safePageSize =
    Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 100
      ? pageSize
      : 20;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (scope === "mine") {
    if (actor.role !== "user")
      throw new InvoiceApplicationError("仅普通员工可以查看本人申请", 403);
    if (!("current,history".split(",") as string[]).includes(employeeView))
      throw new InvoiceApplicationError("员工开票申请列表视图不正确");
    await reconcileApplicantInvoiceApplications(actor.id);
    params.push(actor.id);
    conditions.push(`application.applicant_id=$${params.length}`);
    conditions.push(
      employeeView === "history"
        ? `application.status = 'completed'`
        : `application.status <> 'completed'`,
    );
  } else if (scope === "approval") {
    if (actor.role !== "general_manager")
      throw new InvoiceApplicationError("仅总经理可以查看审批列表", 403);
    params.push(actor.id);
    conditions.push(`application.target_approver_id=$${params.length}`);
    conditions.push(`application.status = 'pending_approval'`);
  } else if (scope === "approval_history") {
    if (actor.role !== "general_manager")
      throw new InvoiceApplicationError("仅总经理可以查看审批记录", 403);
    params.push(actor.id);
    conditions.push(`application.approver_id=$${params.length}`);
    conditions.push(
      `application.status IN ('rejected','pending_seal','pending_invoice','completed')`,
    );
  } else {
    if (
      !(INVOICE_APPLICATION_ADMIN_ROLES as readonly string[]).includes(
        actor.role,
      )
    )
      throw new InvoiceApplicationError("仅管理员可以查看开票执行列表", 403);
    conditions.push(
      `application.status IN ('pending_seal','pending_invoice','completed')`,
    );
  }
  if (rawStatus) {
    if (scope === "approval" && rawStatus !== "pending_approval")
      throw new InvoiceApplicationError("待我审批只能筛选待审批状态", 403);
    if (
      scope === "approval_history" &&
      !["rejected", "pending_seal", "pending_invoice", "completed"].includes(
        rawStatus,
      )
    )
      throw new InvoiceApplicationError("审批记录状态筛选值不正确", 403);
    params.push(rawStatus);
    conditions.push(`application.status=$${params.length}`);
  }
  const keyword = rawKeyword.trim();
  if (keyword) {
    params.push(`%${keyword}%`);
    conditions.push(`(
      application.contract_title_snapshot ILIKE $${params.length}
      OR application.contract_no_snapshot ILIKE $${params.length}
      OR application.party_a_snapshot ILIKE $${params.length}
      OR application.applicant_name_snapshot ILIKE $${params.length}
    )`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM invoice_applications application ${where}`,
    params,
  );
  params.push(safePageSize, (safePage - 1) * safePageSize);
  const orderBy =
    scope === "approval"
      ? "application.submitted_at ASC NULLS LAST, application.id ASC"
      : scope === "approval_history"
        ? "application.decided_at DESC NULLS LAST, application.updated_at DESC, application.id DESC"
        : "application.updated_at DESC, application.id DESC";
  const result = await pool.query<InvoiceApplicationRow>(
    `SELECT application.* FROM invoice_applications application ${where}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const items = await Promise.all(
    result.rows.map(async (row) => {
      if (scope === "mine") return toApplicationView(pool, row);
      await reconcileInTransaction(row.contract_id);
      return toApplicationView(pool, await loadApplication(pool, row.id));
    }),
  );
  return {
    items,
    total: Number(count.rows[0]?.count || 0),
    page: safePage,
    pageSize: safePageSize,
  };
}

export interface InvoiceApplicationPendingCounts {
  employeeActionPending: number;
  managerPending: number;
  pendingSeal: number;
  pendingIssue: number;
  pendingFinanceRegistration: number;
  pendingInvoice: number;
  adminPending: number;
  total: number;
}

export async function getInvoiceApplicationPendingCounts(
  actor: InvoiceApplicationActor,
): Promise<InvoiceApplicationPendingCounts> {
  const emptyCounts: InvoiceApplicationPendingCounts = {
    employeeActionPending: 0,
    managerPending: 0,
    pendingSeal: 0,
    pendingIssue: 0,
    pendingFinanceRegistration: 0,
    pendingInvoice: 0,
    adminPending: 0,
    total: 0,
  };
  if (actor.role === "user") {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM invoice_applications
        WHERE applicant_id = $1 AND status = 'rejected'`,
      [actor.id],
    );
    const employeeActionPending = Number(result.rows[0]?.count || 0);
    return {
      ...emptyCounts,
      employeeActionPending,
      total: employeeActionPending,
    };
  }
  if (actor.role === "general_manager") {
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM invoice_applications
        WHERE target_approver_id = $1 AND status = 'pending_approval'`,
      [actor.id],
    );
    const managerPending = Number(result.rows[0]?.count || 0);
    return {
      ...emptyCounts,
      managerPending,
      total: managerPending,
    };
  }
  if (
    !(INVOICE_APPLICATION_ADMIN_ROLES as readonly string[]).includes(actor.role)
  ) {
    throw new InvoiceApplicationError("当前账号不能读取合同开票待办数量", 403);
  }
  const result = await pool.query<{
    pending_seal: number;
    pending_issue: number;
    pending_finance_registration: number;
    pending_invoice: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending_seal')::int AS pending_seal,
       COUNT(*) FILTER (
         WHERE status = 'pending_invoice' AND issued_at IS NULL
       )::int AS pending_issue,
       COUNT(*) FILTER (
         WHERE status = 'pending_invoice' AND issued_at IS NOT NULL
       )::int AS pending_finance_registration,
       COUNT(*) FILTER (WHERE status = 'pending_invoice')::int AS pending_invoice
     FROM invoice_applications`,
  );
  const pendingSeal = Number(result.rows[0]?.pending_seal || 0);
  const pendingIssue = Number(result.rows[0]?.pending_issue || 0);
  const pendingFinanceRegistration = Number(
    result.rows[0]?.pending_finance_registration || 0,
  );
  const pendingInvoice = Number(result.rows[0]?.pending_invoice || 0);
  const adminPending = pendingSeal + pendingInvoice;
  return {
    ...emptyCounts,
    pendingSeal,
    pendingIssue,
    pendingFinanceRegistration,
    pendingInvoice,
    adminPending,
    total: adminPending,
  };
}

export async function getInvoiceApplicationAdminPendingCounts(
  actor: InvoiceApplicationActor,
): Promise<{
  pendingSeal: number;
  pendingInvoice: number;
  adminPending: number;
}> {
  if (
    !(INVOICE_APPLICATION_ADMIN_ROLES as readonly string[]).includes(actor.role)
  ) {
    throw new InvoiceApplicationError("仅管理员可以读取合同开票待办数量", 403);
  }
  const counts = await getInvoiceApplicationPendingCounts(actor);
  return {
    pendingSeal: counts.pendingSeal,
    pendingInvoice: counts.pendingInvoice,
    adminPending: counts.adminPending,
  };
}

export async function generateMainBusinessTriplicate(
  actor: InvoiceApplicationActor,
  applicationId: string,
  rawInput: GenerateMainTriplicateInput,
  expectedVersion: number,
): Promise<InvoiceApplicationView> {
  if (actor.role !== "user")
    throw new InvoiceApplicationError("仅申请人可以生成三联单", 403);
  const projectName = requiredText(rawInput.projectName, "工程项目名称", 300);
  const currentPayment = parseAmount(rawInput.amount);
  let generatedPath: string | null = null;
  const replacedPaths: string[] = [];
  try {
    await db.transaction(async (client) => {
      const { application, rootId } = await lockApplicationAfterRoot(
        client,
        applicationId,
      );
      if (application.applicant_id !== actor.id)
        throw new InvoiceApplicationError("仅申请人可以生成三联单", 403);
      if (
        !(application.status === "draft" || application.status === "rejected")
      )
        throw new InvoiceApplicationError("当前状态不能重新生成三联单", 409);
      if (application.version !== expectedVersion)
        throw new InvoiceApplicationError(
          "申请已发生变化，请刷新后重试",
          409,
          "INVOICE_APPLICATION_VERSION_CONFLICT",
        );
      if (application.contract_category_snapshot !== "main_business")
        throw new InvoiceApplicationError(
          "只有主营项目合同可以在线生成三联单",
          409,
        );
      const contract = await loadContract(client, rootId, false);
      if (!contract) throw new InvoiceApplicationError("合同不存在", 404);
      const contractAmount = currentContractAmount(contract);
      const capacity = await capacityForContract(client, rootId);
      if (toCents(currentPayment) > toCents(capacity.remainingAmount))
        throw new InvoiceApplicationError(
          "本次付款金额超过合同剩余可申请额度",
          409,
          "INVOICE_APPLICATION_AMOUNT_EXCEEDS_REMAINING",
        );
      const previousPayment = await previousTriplicatePaymentAmount(
        client,
        rootId,
        application.id,
      );
      const cumulativeCents =
        toCents(previousPayment) + toCents(currentPayment);
      if (cumulativeCents > toCents(contractAmount))
        throw new InvoiceApplicationError(
          "本次累计付款超过当前有效合同金额",
          409,
          "MAIN_TRIPLICATE_CUMULATIVE_EXCEEDS_CONTRACT",
        );
      const cumulativePayment = fromCents(cumulativeCents);
      const pdf = await renderMainBusinessTriplicatePdf({
        projectName,
        contractAmount,
        currentPayment,
        previousPayment,
        cumulativePayment,
      });
      const directory = ensureDatedUploadDirectory(
        "invoice-applications",
        new Date(),
        application.id,
        "materials",
      );
      const safeProjectName =
        projectName.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "主营项目";
      const fileName = `${safeProjectName}-其他费用结算审定表-三联单.pdf`;
      const absolutePath = path.join(
        directory,
        `generated-triplicate-${nanoid()}.pdf`,
      );
      fs.writeFileSync(absolutePath, pdf, { flag: "wx" });
      generatedPath = absolutePath;
      const existingMaterials = await client.query<MaterialRow>(
        `SELECT * FROM invoice_application_materials
          WHERE application_id=$1 FOR UPDATE`,
        [application.id],
      );
      replacedPaths.push(...existingMaterials.rows.map((row) => row.file_path));
      await client.query(
        `DELETE FROM invoice_application_materials WHERE application_id=$1`,
        [application.id],
      );
      const now = new Date().toISOString();
      const materialId = nanoid();
      await client.query(
        `INSERT INTO invoice_application_materials (
           id,application_id,file_name,file_path,file_size,mime_type,file_hash,
           requires_seal,has_other_expense_sheet,
           is_system_generated_triplicate,uploaded_by,created_at
         ) VALUES ($1,$2,$3,$4,$5,'application/pdf',$6,TRUE,TRUE,TRUE,$7,$8)`,
        [
          materialId,
          application.id,
          fileName,
          toStoredUploadPath(absolutePath),
          pdf.length,
          crypto.createHash("sha256").update(pdf).digest("hex"),
          actor.id,
          now,
        ],
      );
      await client.query(
        `UPDATE invoice_application_generated_files SET is_current=FALSE
          WHERE application_id=$1 AND is_current=TRUE`,
        [application.id],
      );
      await client.query(
        `UPDATE invoice_applications SET
           amount=$2, contract_amount_snapshot=$3,
           triplicate_project_name=$4,
           triplicate_previous_payment_snapshot=$5,
           triplicate_cumulative_payment_snapshot=$6,
           material_mode='material_need_seal', status='draft',
           target_approver_id=NULL,target_approver_name_snapshot=NULL,
           target_approver_position_snapshot=NULL,
           applicant_signature_snapshot_path=NULL,
           applicant_signature_snapshot_hash=NULL,applicant_signed_at=NULL,
           applicant_signed_file_id=NULL,approved_file_id=NULL,
           approver_id=NULL,approver_name_snapshot=NULL,
           approver_position_snapshot=NULL,
           approver_signature_snapshot_path=NULL,
           approver_signature_snapshot_hash=NULL,
           decision_comment=NULL,submitted_at=NULL,decided_at=NULL,
           submitted_invoiced_amount_snapshot=NULL,
           submitted_pending_amount_snapshot=NULL,
           submitted_remaining_amount_snapshot=NULL,
           delivered_by=NULL,delivered_by_name_snapshot=NULL,
           delivery_note=NULL,delivered_at=NULL,
           issued_by=NULL,issued_by_name_snapshot=NULL,
           issue_note=NULL,issued_at=NULL,completed_at=NULL,
           updated_at=$7,version=version+1
         WHERE id=$1`,
        [
          application.id,
          currentPayment,
          contractAmount,
          projectName,
          previousPayment,
          cumulativePayment,
          now,
        ],
      );
      const actorRow = await actorSnapshot(client, actor.id);
      await insertAudit(client, {
        applicationId: application.id,
        action: "material_uploaded",
        actor: actorRow,
        fromStatus: application.status,
        toStatus: "draft",
        metadata: {
          systemGeneratedTriplicate: true,
          materialId,
          fileName,
          projectName,
          contractAmount,
          previousPayment,
          currentPayment,
          cumulativePayment,
          copies: 3,
        },
        now,
      });
    });
  } catch (error) {
    if (generatedPath) {
      try {
        fs.unlinkSync(generatedPath);
      } catch {
        // 原业务异常优先返回。
      }
    }
    throw error;
  }
  for (const storedPath of replacedPaths) {
    try {
      fs.unlinkSync(absoluteStoredPath(storedPath, "旧三联单"));
    } catch {
      // 数据库已经替换成功，旧文件清理失败不回滚新三联单。
    }
  }
  return getInvoiceApplication(actor, applicationId);
}

export async function addInvoiceApplicationMaterials(
  actor: InvoiceApplicationActor,
  applicationId: string,
  files: StoredInvoiceApplicationMaterial[],
): Promise<InvoiceApplicationView> {
  if (!files.length) throw new InvoiceApplicationError("请选择要上传的材料");
  const writtenPaths: string[] = [];
  try {
    await db.transaction(async (client) => {
      const application = await loadApplication(client, applicationId, true);
      if (actor.role !== "user" || application.applicant_id !== actor.id)
        throw new InvoiceApplicationError("仅申请人可以上传材料", 403);
      if (
        !(["draft", "rejected"] as const).includes(application.status as never)
      )
        throw new InvoiceApplicationError("当前状态不能上传材料", 409);
      const existing = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM invoice_application_materials
          WHERE application_id=$1`,
        [application.id],
      );
      const materialCount = Number(existing.rows[0]?.count || 0) + files.length;
      if (materialCount > INVOICE_APPLICATION_MAX_MATERIALS)
        throw new InvoiceApplicationError(
          `单份开票申请最多上传${INVOICE_APPLICATION_MAX_MATERIALS}份材料`,
        );
      if (
        application.contract_category_snapshot === "main_business" &&
        materialCount !== 1
      )
        throw new InvoiceApplicationError("主营项目合同只能上传一份固定三联单");
      const actorRow = await actorSnapshot(client, actor.id);
      const now = new Date().toISOString();
      for (const file of files) {
        if (
          application.contract_category_snapshot === "main_business" &&
          (!file.requiresSeal || !file.hasOtherExpenseSheet)
        )
          throw new InvoiceApplicationError(
            "主营项目三联单必须包含“其他费用”工作表并选择盖章",
          );
        if (
          application.contract_category_snapshot === "main_business" &&
          (file.recognizedApplicationAmount == null ||
            toCents(file.recognizedApplicationAmount) !==
              toCents(application.amount))
        )
          throw new InvoiceApplicationError(
            "三联单“其他费用－本次付款”金额与申请开票金额不一致",
            409,
            "MAIN_TRIPLICATE_AMOUNT_MISMATCH",
          );
        if (
          application.material_mode === "material_no_seal" &&
          file.requiresSeal
        )
          throw new InvoiceApplicationError("当前材料方式不允许选择盖章");
        if (application.material_mode === "no_material")
          throw new InvoiceApplicationError("已选择不需要材料，不能上传文件");
        const directory = ensureDatedUploadDirectory(
          "invoice-applications",
          new Date(),
          application.id,
          "materials",
        );
        const extension = path.extname(file.fileName).toLowerCase();
        const absolutePath = path.join(directory, `${nanoid()}${extension}`);
        fs.writeFileSync(absolutePath, file.buffer, { flag: "wx" });
        writtenPaths.push(absolutePath);
        await client.query(
          `INSERT INTO invoice_application_materials (
             id, application_id, file_name, file_path, file_size, mime_type,
             file_hash, requires_seal, has_other_expense_sheet,
             uploaded_by, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            nanoid(),
            application.id,
            file.fileName,
            toStoredUploadPath(absolutePath),
            file.buffer.length,
            file.mimeType,
            file.fileHash,
            file.requiresSeal,
            file.hasOtherExpenseSheet,
            actor.id,
            now,
          ],
        );
      }
      await client.query(
        `UPDATE invoice_applications SET updated_at=$2, version=version+1 WHERE id=$1`,
        [application.id, now],
      );
      await insertAudit(client, {
        applicationId: application.id,
        action: "material_uploaded",
        actor: actorRow,
        fromStatus: application.status,
        toStatus: application.status,
        metadata: {
          files: files.map((file) => ({
            fileName: file.fileName,
            requiresSeal: file.requiresSeal,
            recognizedApplicationAmount: file.recognizedApplicationAmount,
            recognizedAmountLabelCell: file.recognizedAmountLabelCell,
            recognizedAmountValueCell: file.recognizedAmountValueCell,
            recognizedAmountDetailRange: file.recognizedAmountDetailRange,
          })),
        },
        now,
      });
    });
  } catch (error) {
    for (const filePath of writtenPaths) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // 原业务异常优先返回。
      }
    }
    throw error;
  }
  return getInvoiceApplication(actor, applicationId);
}

export async function deleteInvoiceApplicationMaterial(
  actor: InvoiceApplicationActor,
  applicationId: string,
  materialId: string,
  expectedVersion: number,
): Promise<InvoiceApplicationView> {
  let removedPath: string | null = null;
  await db.transaction(async (client) => {
    const application = await loadApplication(client, applicationId, true);
    if (actor.role !== "user" || application.applicant_id !== actor.id)
      throw new InvoiceApplicationError("仅申请人可以删除材料", 403);
    if (!(["draft", "rejected"] as const).includes(application.status as never))
      throw new InvoiceApplicationError("当前状态不能删除材料", 409);
    if (application.version !== expectedVersion)
      throw new InvoiceApplicationError(
        "申请已发生变化，请刷新后重试",
        409,
        "INVOICE_APPLICATION_VERSION_CONFLICT",
      );
    const result = await client.query<MaterialRow>(
      `DELETE FROM invoice_application_materials
        WHERE id=$1 AND application_id=$2 RETURNING *`,
      [materialId, application.id],
    );
    if (!result.rows[0]) throw new InvoiceApplicationError("材料不存在", 404);
    removedPath = result.rows[0].file_path;
    const actorRow = await actorSnapshot(client, actor.id);
    const now = new Date().toISOString();
    await client.query(
      `UPDATE invoice_applications SET
         triplicate_project_name=CASE WHEN $3::boolean THEN NULL ELSE triplicate_project_name END,
         triplicate_previous_payment_snapshot=CASE WHEN $3::boolean THEN NULL ELSE triplicate_previous_payment_snapshot END,
         triplicate_cumulative_payment_snapshot=CASE WHEN $3::boolean THEN NULL ELSE triplicate_cumulative_payment_snapshot END,
         updated_at=$2,version=version+1 WHERE id=$1`,
      [application.id, now, result.rows[0].is_system_generated_triplicate],
    );
    await insertAudit(client, {
      applicationId: application.id,
      action: "material_deleted",
      actor: actorRow,
      fromStatus: application.status,
      toStatus: application.status,
      metadata: { materialId, fileName: result.rows[0].file_name },
      now,
    });
  });
  if (removedPath) {
    try {
      fs.unlinkSync(absoluteStoredPath(removedPath, "材料"));
    } catch {
      // 数据删除成功后，文件清理失败不能回滚业务状态。
    }
  }
  return getInvoiceApplication(actor, applicationId);
}

export async function prepareInvoiceApplicationMaterial(
  actor: InvoiceApplicationActor,
  applicationId: string,
  materialId: string,
): Promise<{
  absolutePath: string;
  fileName: string;
  mimeType: string;
  requiresSeal: boolean;
  category: "main_business" | "non_main";
}> {
  const application = await loadApplication(pool, applicationId);
  assertApplicationAccess(actor, application);
  const result = await pool.query<MaterialRow>(
    `SELECT * FROM invoice_application_materials
      WHERE id=$1 AND application_id=$2`,
    [materialId, applicationId],
  );
  const material = result.rows[0];
  if (!material) throw new InvoiceApplicationError("材料不存在", 404);
  const absolutePath = absoluteStoredPath(material.file_path, "申请材料");
  const actualHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(absolutePath))
    .digest("hex");
  if (actualHash !== material.file_hash)
    throw new InvoiceApplicationError(
      "申请材料内容发生变化，已阻止预览和下载",
      409,
      "INVOICE_APPLICATION_MATERIAL_HASH_MISMATCH",
    );
  return {
    absolutePath,
    fileName: material.file_name,
    mimeType: material.mime_type,
    requiresSeal: material.requires_seal,
    category: application.contract_category_snapshot,
  };
}

export async function prepareInvoiceApplicationGeneratedFile(
  actor: InvoiceApplicationActor,
  applicationId: string,
  requestedFileId?: string,
): Promise<{
  absolutePath: string;
  fileName: string;
  mimeType: "application/pdf";
}> {
  const application = await loadApplication(pool, applicationId);
  assertApplicationAccess(actor, application);
  const currentFileIds = [
    application.applicant_signed_file_id,
    application.approved_file_id,
  ].filter((id): id is string => Boolean(id));
  const fileId =
    requestedFileId ||
    application.approved_file_id ||
    application.applicant_signed_file_id;
  if (!fileId)
    throw new InvoiceApplicationError(
      "申请单尚未完成电子签名",
      409,
      "INVOICE_APPLICATION_SIGNED_FILE_NOT_READY",
    );
  if (requestedFileId && !currentFileIds.includes(requestedFileId))
    throw new InvoiceApplicationError(
      "只能预览当前流程引用的签名申请单",
      403,
      "INVOICE_APPLICATION_GENERATED_FILE_FORBIDDEN",
    );
  const result = await pool.query<{
    file_name: string;
    file_path: string;
    file_hash: string;
  }>(
    `SELECT file_name,file_path,file_hash
       FROM invoice_application_generated_files
      WHERE id=$1 AND application_id=$2`,
    [fileId, applicationId],
  );
  const file = result.rows[0];
  if (!file) throw new InvoiceApplicationError("签名申请单不存在", 404);
  const absolutePath = absoluteStoredPath(file.file_path, "签名申请单");
  const actualHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(absolutePath))
    .digest("hex");
  if (actualHash !== file.file_hash)
    throw new InvoiceApplicationError(
      "签名申请单内容发生变化，已阻止预览",
      409,
      "INVOICE_APPLICATION_GENERATED_FILE_HASH_MISMATCH",
    );
  return {
    absolutePath,
    fileName: file.file_name,
    mimeType: "application/pdf",
  };
}
