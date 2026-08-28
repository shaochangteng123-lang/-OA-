import { api } from "@/utils/api";
import type {
  ApiEnvelope,
  ContractApprovalAction,
  ContractAuxiliaryPackage,
  ContractAssetCategory,
  ContractCategory,
  ContractDeclaredSubtype,
  ContractDeclaredSubtypeOptions,
  ContractDepositFundingSource,
  ContractDepositEngineeringReturnPayload,
  ContractDepositMutationPayload,
  ContractDepositPaymentRecordKind,
  ContractDepositReceipt,
  ContractDepositReceiptStatus,
  ContractDepositReturnReceiptKind,
  ContractDepositReturnReceiptRecognition,
  ContractDepositSettlement,
  ContractDepositSettlementPayload,
  ContractDepositSettlementReceipt,
  ContractDepositSettlementType,
  ContractDepositSnapshot,
  ContractDepositStatus,
  ContractCompletedInternalFundingRecognition,
  ContractCompletedInternalFundingSummary,
  ContractDashboardQuery,
  ContractDashboardResponse,
  ContractDetailResponse,
  ContractDraftDeleteResult,
  ContractExpenseCategory,
  ContractFinancialBlockingReason,
  ContractFinancialRegistrationPayload,
  ContractFinancialRegistrationResult,
  ContractFinancialOcrResult,
  ContractFinancialOcrTaskStatus,
  ContractFinancialValidationStatus,
  ContractFinanceRecordStatus,
  ContractListItem,
  ContractListQuery,
  ContractListResponse,
  ContractMeta,
  ContractOcrField,
  ContractOcrFieldKey,
  ContractOcrJob,
  ContractPendingApprovalResponse,
  ContractPaymentPurposeDetail,
  ContractPaymentPurposeDetails,
  ContractProcessedApprovalResponse,
  ContractRateCode,
  ContractRateMutationPayload,
  ContractRatesResponse,
  ContractRentalRenewalUploadContext,
  ContractRecognitionUploadMetadata,
  ContractRelationType,
  ContractRecordPayload,
  ContractSealVerification,
  ContractSealApplication,
  ContractSealApplicationFields,
  ContractSealWorkflowResponse,
  ContractStatus,
  ContractSupplementChangeType,
  ContractSupplementUploadContext,
  ContractTerminationUploadContext,
  ContractUpdatePayload,
} from "@/types/contract";
import {
  CONTRACT_STATUS_LABELS,
  FALLBACK_CONTRACT_DECLARED_SUBTYPE_OPTIONS,
} from "@/utils/contractPresentation";

const TERMINAL_OCR_STATUSES = new Set(["succeeded", "partial", "failed"]);
const CONTRACT_RELATION_TYPES = [
  "main",
  "supplement",
  "termination",
] as const satisfies readonly ContractRelationType[];
const CONTRACT_SUPPLEMENT_CHANGE_TYPES = [
  "payment_terms_only",
  "amount_adjustment",
  "amount_and_payment",
  "legacy_unresolved",
] as const satisfies readonly ContractSupplementChangeType[];

function normalizeSupplementChangeType(
  value: unknown,
): ContractSupplementChangeType | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return CONTRACT_SUPPLEMENT_CHANGE_TYPES.includes(
    normalized as ContractSupplementChangeType,
  )
    ? (normalized as ContractSupplementChangeType)
    : null;
}

function isContractRelationType(value: string): value is ContractRelationType {
  return CONTRACT_RELATION_TYPES.some((relationType) => relationType === value);
}

function requireContractRelationType(
  source: Record<string, unknown>,
  context: string,
): ContractRelationType {
  const candidates = [source.relationType, source.relation_type].filter(
    (value) => value !== undefined && value !== null,
  );
  if (candidates.length === 0) {
    throw new Error(`${context}缺少合同关系，已阻止页面继续使用`);
  }

  const parsed: ContractRelationType[] = [];
  for (const value of candidates) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!isContractRelationType(normalized)) {
      throw new Error(`${context}包含非法合同关系，已阻止页面继续使用`);
    }
    parsed.push(normalized);
  }
  if (new Set(parsed).size > 1) {
    throw new Error(`${context}的合同关系字段互相冲突，已阻止页面继续使用`);
  }
  return parsed[0];
}

function unwrap<T>(response: { data: ApiEnvelope<T> }): T {
  if (!response.data.success) {
    throw new Error(response.data.message || "合同服务请求失败");
  }
  return response.data.data;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const CONTRACT_DEPOSIT_RECEIPT_STATUSES = new Set<ContractDepositReceiptStatus>(
  [
    "recognizing",
    "recognized",
    "manual_review",
    "verified",
    "failed",
    "voided",
  ],
);

function normalizeContractDepositReceipt(
  value: unknown,
): ContractDepositReceipt {
  const source = recordOrNull(value) || {};
  const rawStatus = String(source.status || "manual_review");
  const statusAlias: Record<string, ContractDepositReceiptStatus> = {
    pending: "manual_review",
    processing: "recognizing",
    pending_review: "manual_review",
    review_required: "manual_review",
    ocr_failed: "failed",
    confirmed: "verified",
  };
  const rawOcrStatus = String(source.ocrStatus ?? source.ocr_status ?? "");
  const pendingStatus: ContractDepositReceiptStatus =
    rawOcrStatus === "recognized"
      ? "recognized"
      : rawOcrStatus === "failed"
        ? "failed"
        : "manual_review";
  const status =
    rawStatus === "pending"
      ? pendingStatus
      : CONTRACT_DEPOSIT_RECEIPT_STATUSES.has(
            rawStatus as ContractDepositReceiptStatus,
          )
        ? (rawStatus as ContractDepositReceiptStatus)
        : statusAlias[rawStatus] || "manual_review";
  return {
    id: String(source.id || ""),
    contractId: String(source.contractId ?? source.contract_id ?? ""),
    financialRecordId: String(
      source.financialRecordId ??
        source.financial_record_id ??
        source.paymentRecordId ??
        source.payment_record_id ??
        "",
    ),
    fileId: String(source.fileId ?? source.file_id ?? ""),
    fileName: String(
      source.fileName ??
        source.file_name ??
        source.originalName ??
        "押金条原件",
    ),
    mimeType: (source.mimeType ?? source.mime_type ?? null) as string | null,
    previewUrl: (source.previewUrl ??
      source.preview_url ??
      source.fileUrl ??
      source.file_url ??
      null) as string | null,
    ocrAmount: (source.ocrAmount ??
      source.ocr_amount ??
      source.recognizedAmount ??
      source.recognized_amount ??
      null) as string | number | null,
    verifiedAmount: (source.verifiedAmount ??
      source.verified_amount ??
      source.confirmedAmount ??
      source.confirmed_amount ??
      null) as string | number | null,
    status,
    recognitionMessage: (source.recognitionMessage ??
      source.recognition_message ??
      source.ocrFailureMessage ??
      source.ocr_failure_message ??
      null) as string | null,
    createdBy: (source.createdBy ??
      source.created_by ??
      source.uploadedBy ??
      source.uploaded_by ??
      null) as string | null,
    createdByName: (source.createdByName ??
      source.created_by_name ??
      source.uploadedByName ??
      source.uploaded_by_name ??
      null) as string | null,
    createdAt: (source.createdAt ?? source.created_at ?? null) as string | null,
    verifiedBy: (source.verifiedBy ??
      source.verified_by ??
      source.confirmedBy ??
      source.confirmed_by ??
      null) as string | null,
    verifiedByName: (source.verifiedByName ??
      source.verified_by_name ??
      source.confirmedByName ??
      source.confirmed_by_name ??
      null) as string | null,
    verifiedAt: (source.verifiedAt ??
      source.verified_at ??
      source.confirmedAt ??
      source.confirmed_at ??
      null) as string | null,
    voidedBy: (source.voidedBy ?? source.voided_by ?? null) as string | null,
    voidedByName: (source.voidedByName ?? source.voided_by_name ?? null) as
      | string
      | null,
    voidedAt: (source.voidedAt ?? source.voided_at ?? null) as string | null,
    voidReason: (source.voidReason ?? source.void_reason ?? null) as
      | string
      | null,
  };
}

const CONTRACT_DEPOSIT_STATUSES = new Set<ContractDepositStatus>([
  "pending_payment",
  "active",
  "partially_settled",
  "settled",
]);
const CONTRACT_DEPOSIT_FUNDING_SOURCES = new Set<ContractDepositFundingSource>([
  "engineering_allocation",
  "technology_self_funded",
  "mixed",
  "pending_review",
]);
const CONTRACT_DEPOSIT_SETTLEMENT_TYPES =
  new Set<ContractDepositSettlementType>([
    "refund",
    "deduction",
    "rent_offset",
  ]);

function normalizeContractDepositFundingSource(
  value: unknown,
): ContractDepositFundingSource {
  const normalized = String(value || "pending_review");
  const aliases: Record<string, ContractDepositFundingSource> = {
    engineering_transfer: "engineering_allocation",
    technology_self: "technology_self_funded",
    pending: "pending_review",
  };
  return CONTRACT_DEPOSIT_FUNDING_SOURCES.has(
    normalized as ContractDepositFundingSource,
  )
    ? (normalized as ContractDepositFundingSource)
    : aliases[normalized] || "pending_review";
}

function normalizeContractDepositSettlement(
  value: unknown,
): ContractDepositSettlement {
  const source = recordOrNull(value) || {};
  const rawType = String(source.type ?? source.settlement_type ?? "refund");
  const typeAlias: Record<string, ContractDepositSettlementType> = {
    offset_rent: "rent_offset",
    offset: "rent_offset",
    withheld: "deduction",
  };
  const type = CONTRACT_DEPOSIT_SETTLEMENT_TYPES.has(
    rawType as ContractDepositSettlementType,
  )
    ? (rawType as ContractDepositSettlementType)
    : typeAlias[rawType] || "refund";
  const rawEngineeringReturnReceipts =
    source.engineeringReturnReceipts ?? source.engineering_return_receipts;
  return {
    id: String(source.id || ""),
    type,
    amount: (source.amount ?? 0) as string | number,
    settlementDate: String(
      source.settlementDate ?? source.settlement_date ?? "",
    ),
    note: (source.note ?? null) as string | null,
    refundReceipt: normalizeContractDepositSettlementReceipt(
      source.refundReceipt ?? source.refund_receipt,
    ),
    engineeringReturnReceipts: (Array.isArray(rawEngineeringReturnReceipts)
      ? rawEngineeringReturnReceipts
      : []
    )
      .map(normalizeContractDepositSettlementReceipt)
      .filter(
        (receipt): receipt is ContractDepositSettlementReceipt =>
          receipt !== null,
      ),
    engineeringReturnRequiredAmount: (source.engineeringReturnRequiredAmount ??
      source.engineering_return_required_amount ??
      0) as string | number,
    engineeringReturnedAmount: (source.engineeringReturnedAmount ??
      source.engineering_returned_amount ??
      0) as string | number,
    engineeringReturnStatus: (source.engineeringReturnStatus ??
      source.engineering_return_status ??
      null) as ContractDepositSettlement["engineeringReturnStatus"],
    createdBy: (source.createdBy ?? source.created_by ?? null) as string | null,
    createdByName: (source.createdByName ?? source.created_by_name ?? null) as
      | string
      | null,
    createdAt: (source.createdAt ?? source.created_at ?? null) as string | null,
  };
}

function normalizeContractDepositSettlementReceipt(
  value: unknown,
): ContractDepositSettlementReceipt | null {
  const source = recordOrNull(value);
  if (!source) return null;
  return {
    id: String(source.id || ""),
    fileName: String(source.fileName ?? source.file_name ?? "回单原件"),
    fileSize: Number(source.fileSize ?? source.file_size ?? 0),
    mimeType: (source.mimeType ?? source.mime_type ?? null) as string | null,
    amount: (source.amount ?? 0) as string | number,
    transactionDate: String(
      source.transactionDate ?? source.transaction_date ?? "",
    ),
    fileUrl: String(
      source.fileUrl ??
        source.file_url ??
        source.previewUrl ??
        source.preview_url ??
        "",
    ),
    uploadedBy: (source.uploadedBy ?? source.uploaded_by ?? null) as
      | string
      | null,
    uploadedByName: (source.uploadedByName ??
      source.uploaded_by_name ??
      null) as string | null,
    createdAt: (source.createdAt ?? source.created_at ?? null) as string | null,
  };
}

function normalizeContractDepositSnapshot(
  value: unknown,
): ContractDepositSnapshot {
  const source = recordOrNull(value) || {};
  const eligibility = recordOrNull(source.eligibility) || {};
  const rawDeposit =
    source.deposit === null
      ? null
      : recordOrNull(source.deposit) ||
        (source.id || source.amount !== undefined ? source : null);
  const deposit = rawDeposit
    ? (() => {
        const rawStatus = String(rawDeposit.status || "pending_payment");
        const statusAliases: Record<string, ContractDepositStatus> = {
          pending: "pending_payment",
          paid: "active",
          partial: "partially_settled",
          completed: "settled",
        };
        const status = CONTRACT_DEPOSIT_STATUSES.has(
          rawStatus as ContractDepositStatus,
        )
          ? (rawStatus as ContractDepositStatus)
          : statusAliases[rawStatus] || "pending_payment";
        const rawPaymentRecordKind = String(
          rawDeposit.paymentRecordKind ?? rawDeposit.payment_record_kind ?? "",
        );
        const paymentRecordKind = ["payment", "external_payment"].includes(
          rawPaymentRecordKind,
        )
          ? (rawPaymentRecordKind as ContractDepositPaymentRecordKind)
          : null;
        const rawSettlements =
          rawDeposit.settlements ?? rawDeposit.settlement_records;
        return {
          id: String(rawDeposit.id || ""),
          contractId: String(
            rawDeposit.contractId ?? rawDeposit.contract_id ?? "",
          ),
          amount: (rawDeposit.amount ?? 0) as string | number,
          clauseText: (rawDeposit.clauseText ??
            rawDeposit.clause_text ??
            null) as string | null,
          basis: (rawDeposit.basis ?? null) as string | null,
          paymentPurpose: "lease_deposit" as const,
          fundingSource: normalizeContractDepositFundingSource(
            rawDeposit.fundingSource ?? rawDeposit.funding_source,
          ),
          paymentRecordId: (rawDeposit.paymentRecordId ??
            rawDeposit.payment_record_id ??
            null) as string | null,
          paymentRecordKind,
          paidAt: (rawDeposit.paidAt ?? rawDeposit.paid_at ?? null) as
            | string
            | null,
          note: (rawDeposit.note ?? null) as string | null,
          engineeringAllocationAmount:
            (rawDeposit.engineeringAllocationAmount ??
              rawDeposit.engineering_allocation_amount ??
              0) as string | number,
          technologySelfFundedAmount: (rawDeposit.technologySelfFundedAmount ??
            rawDeposit.technology_self_funded_amount ??
            0) as string | number,
          pendingEngineeringReturn: (rawDeposit.pendingEngineeringReturn ??
            rawDeposit.pending_engineering_return ??
            0) as string | number,
          status,
          settledAmount: (rawDeposit.settledAmount ??
            rawDeposit.settled_amount ??
            0) as string | number,
          remainingAmount: (rawDeposit.remainingAmount ??
            rawDeposit.remaining_amount ??
            rawDeposit.amount ??
            0) as string | number,
          settlements: (Array.isArray(rawSettlements)
            ? rawSettlements
            : []
          ).map(normalizeContractDepositSettlement),
          createdBy: (rawDeposit.createdBy ?? rawDeposit.created_by ?? null) as
            | string
            | null,
          createdByName: (rawDeposit.createdByName ??
            rawDeposit.created_by_name ??
            null) as string | null,
          createdAt: (rawDeposit.createdAt ?? rawDeposit.created_at ?? null) as
            | string
            | null,
          updatedBy: (rawDeposit.updatedBy ?? rawDeposit.updated_by ?? null) as
            | string
            | null,
          updatedByName: (rawDeposit.updatedByName ??
            rawDeposit.updated_by_name ??
            null) as string | null,
          updatedAt: (rawDeposit.updatedAt ?? rawDeposit.updated_at ?? null) as
            | string
            | null,
        };
      })()
    : null;
  const rawReason = String(
    eligibility.reason ??
      source.eligibilityReason ??
      source.eligibility_reason ??
      "non_rental_subtype",
  );
  return {
    eligibility: {
      likely: Boolean(
        eligibility.likely ?? source.likely ?? rawReason === "rental_subtype",
      ),
      reason:
        rawReason === "rental_subtype"
          ? "rental_subtype"
          : "non_rental_subtype",
      subtype: (eligibility.subtype ?? source.subtype ?? null) as
        | ContractDepositSnapshot["eligibility"]["subtype"]
        | null,
    },
    deposit,
  };
}

function normalizeContractPaymentPurposeDetails(
  value: unknown,
  contractId: string,
  recordId: string,
): ContractPaymentPurposeDetails {
  const source = recordOrNull(value) || {};
  const rawDetails = Array.isArray(source.details)
    ? source.details
    : Array.isArray(value)
      ? value
      : [];
  const details = rawDetails.map((item): ContractPaymentPurposeDetail => {
    const detail = recordOrNull(item) || {};
    return {
      purpose:
        detail.purpose === "lease_deposit"
          ? "lease_deposit"
          : "contract_payment",
      amount: (detail.amount ?? 0) as string | number,
      fundingSource: normalizeContractDepositFundingSource(
        detail.fundingSource ?? detail.funding_source,
      ),
      engineeringAllocationAmount: (detail.engineeringAllocationAmount ??
        detail.engineering_allocation_amount ??
        null) as string | number | null,
      technologySelfFundedAmount: (detail.technologySelfFundedAmount ??
        detail.technology_self_funded_amount ??
        null) as string | number | null,
    };
  });
  return {
    contractId: String(source.contractId ?? source.contract_id ?? contractId),
    recordId: String(source.recordId ?? source.record_id ?? recordId),
    details,
  };
}

function firstDefined(
  source: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return null;
}

function dashboardMoney(
  source: Record<string, unknown>,
  keys: string[],
): string | number | null {
  const value = firstDefined(source, keys);
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function aggregateDashboardMoney(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") return value;
  const source = recordOrNull(value);
  return source
    ? dashboardMoney(source, [
        "total",
        "amount",
        "accountingIncome",
        "accounting_income",
      ])
    : null;
}

function normalizeConfidence(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" &&
          /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  const percentage = parsed <= 1 ? parsed * 100 : parsed;
  // 只有服务端显式返回的整数 100 才代表自动独立验证通过；比例值 1
  // 不得在前端规范化阶段被提升为自动采用值。
  if (parsed === 100 && percentage === 100) return 100;
  return Math.max(0, Math.min(99, Math.floor(percentage)));
}

function normalizeOcrEvidenceText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try {
      return normalizeOcrEvidenceText(JSON.parse(text));
    } catch {
      return text;
    }
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? normalizeOcrEvidenceText(value[0]) : null;
  }
  const record = recordOrNull(value);
  return record ? normalizeOcrEvidenceText(record.text) : null;
}

const FIELD_LABELS: Record<ContractOcrFieldKey, string> = {
  party_a: "甲方单位",
  party_b: "乙方单位",
  project_name: "项目名称",
  amount: "合同金额",
  category: "合同类型",
  contract_date: "合同签订日期",
};

const FIELD_KEYS = Object.keys(FIELD_LABELS) as ContractOcrFieldKey[];

export function normalizeOcrFields(input: unknown): ContractOcrField[] {
  const source = input as
    | Array<Record<string, unknown>>
    | Record<string, Record<string, unknown> | string | number | null>
    | null
    | undefined;

  const records: Array<Record<string, unknown>> = Array.isArray(source)
    ? source
    : FIELD_KEYS.map<Record<string, unknown>>((key) => {
        const value = source?.[key];
        return typeof value === "object" && value !== null
          ? { ...value, key }
          : { key, value };
      });

  const byKey = new Map<ContractOcrFieldKey, ContractOcrField>();
  for (const record of records) {
    const rawKey = String(
      record.key || record.field || record.fieldCode || record.name || "",
    );
    const key = (
      rawKey === "amount_delta" ? "amount" : rawKey
    ) as ContractOcrFieldKey;
    if (!FIELD_KEYS.includes(key)) continue;
    byKey.set(key, {
      key,
      label: String(record.label || FIELD_LABELS[key]),
      value: (record.finalValue ??
        record.final_value ??
        record.normalizedValue ??
        record.normalized_value ??
        record.value ??
        null) as string | number | null,
      rawText: (record.originalValue ??
        record.original_value ??
        record.rawText ??
        record.raw_text ??
        null) as string | null,
      evidenceText: normalizeOcrEvidenceText(
        record.evidence ?? record.evidenceText ?? record.evidence_text,
      ),
      confidence: normalizeConfidence(record.confidence ?? record.score),
      pageNumber: numberOrNull(
        record.pageNumber ?? record.page_number ?? record.page,
      ),
      required:
        key === "contract_date" || key === "category"
          ? false
          : record.required !== false,
      manuallyConfirmed: Boolean(
        record.manuallyConfirmed ?? record.manually_confirmed ?? false,
      ),
      manuallyEdited: Boolean(
        record.manuallyEdited ?? record.manually_edited ?? false,
      ),
      warning: (record.warning ?? null) as string | null,
    });
  }

  return FIELD_KEYS.map(
    (key) =>
      byKey.get(key) || {
        key,
        label: FIELD_LABELS[key],
        value: null,
        rawText: null,
        evidenceText: null,
        confidence: null,
        pageNumber: null,
        required: key !== "contract_date" && key !== "category",
        manuallyConfirmed: false,
      },
  );
}

function normalizeOcrJob(
  input: ContractOcrJob | Record<string, unknown>,
): ContractOcrJob {
  const record = input as Record<string, unknown>;
  return {
    id: String(record.id || ""),
    contractId: String(record.contractId || record.contract_id || ""),
    status: (record.status || "queued") as ContractOcrJob["status"],
    fields: normalizeOcrFields(record.fields),
    errorMessage: (record.errorMessage ?? record.error_message ?? null) as
      | string
      | null,
    warnings: Array.isArray(record.warnings) ? record.warnings.map(String) : [],
    createdAt: (record.createdAt ?? record.created_at ?? null) as string | null,
    finishedAt: (record.finishedAt ?? record.finished_at ?? null) as
      | string
      | null,
    contractVersion: numberOrNull(
      record.contractVersion ?? record.contract_version,
    ),
    engineVersion: (record.engineVersion ?? record.engine_version ?? null) as
      | string
      | null,
    parserVersion: (record.parserVersion ?? record.parser_version ?? null) as
      | string
      | null,
    requiresRefresh: Boolean(
      record.requiresRefresh ?? record.requires_refresh ?? false,
    ),
  };
}

export function isOcrTerminal(status: ContractOcrJob["status"]): boolean {
  return TERMINAL_OCR_STATUSES.has(status);
}

export async function getContractMeta(): Promise<ContractMeta> {
  const data = unwrap(
    await api.get<ApiEnvelope<Record<string, unknown>>>("/api/contracts/meta"),
  );
  const projects = (Array.isArray(data.projects) ? data.projects : [])
    .map((item) => {
      const project = item as Record<string, unknown>;
      return {
        id: String(project.id || ""),
        name: String(project.name || ""),
        clientName: (project.clientName ?? project.client_name ?? null) as
          | string
          | null,
        area: (project.area ?? null) as string | null,
        contractAmount: (project.contractAmount ??
          project.contract_amount ??
          null) as string | number | null,
      };
    })
    .filter((project) => project.id && project.name);
  const allowedAssetCategories = new Set<ContractAssetCategory>([
    "procurement",
    "software",
    "equipment",
    "house_rental",
    "vehicle_rental",
    "parking_space",
    "office_asset",
    "other",
  ]);
  const assetCategories = (
    Array.isArray(data.assetCategories) ? data.assetCategories : []
  )
    .map((item) =>
      typeof item === "string"
        ? item
        : String((item as Record<string, unknown>)?.value || ""),
    )
    .filter((value): value is ContractAssetCategory =>
      allowedAssetCategories.has(value as ContractAssetCategory),
    );
  const subtypeSource = recordOrNull(data.declaredSubtypeOptions);
  const subtypeValuesByCategory: Record<
    ContractCategory,
    ReadonlySet<ContractDeclaredSubtype>
  > = {
    main_business: new Set([
      "engineering_consulting",
      "preliminary_procedures",
      "technical_consulting",
    ]),
    non_main: new Set(["non_main_income", "other_service"]),
    asset: new Set([
      "procurement",
      "software",
      "equipment",
      "house_rental",
      "vehicle_rental",
      "parking_space",
      "office_asset",
    ]),
  };
  const declaredSubtypeOptions = Object.fromEntries(
    (Object.keys(subtypeValuesByCategory) as ContractCategory[]).map(
      (category) => {
        const options = Array.isArray(subtypeSource?.[category])
          ? (subtypeSource[category] as unknown[])
              .map(recordOrNull)
              .filter((option): option is Record<string, unknown> =>
                Boolean(option),
              )
              .map((option) => ({
                value: String(option.value || "") as ContractDeclaredSubtype,
                label: String(option.label || "").trim(),
              }))
              .filter(
                (option) =>
                  subtypeValuesByCategory[category].has(option.value) &&
                  Boolean(option.label),
              )
          : [];
        return [
          category,
          new Set(options.map((option) => option.value)).size ===
          subtypeValuesByCategory[category].size
            ? options
            : FALLBACK_CONTRACT_DECLARED_SUBTYPE_OPTIONS[category].map(
                (option) => ({ ...option }),
              ),
        ];
      },
    ),
  ) as ContractDeclaredSubtypeOptions;
  const allowedExpenseCategories = new Set<ContractExpenseCategory>([
    "rent",
    "electricity",
    "parking",
    "car_rental",
    "internet",
    "other",
  ]);
  const expenseCategories = (
    Array.isArray(data.expenseCategories) ? data.expenseCategories : []
  )
    .map((item) =>
      typeof item === "string"
        ? item
        : String((item as Record<string, unknown>)?.value || ""),
    )
    .filter((value): value is ContractExpenseCategory =>
      allowedExpenseCategories.has(value as ContractExpenseCategory),
    );
  const areas = (Array.isArray(data.areas) ? data.areas : [])
    .map(String)
    .filter(Boolean);
  const allowedStatuses = new Set<ContractStatus>([
    "draft",
    "approving",
    "pending_seal",
    "effective",
    "executing",
    "completed",
    "rejected",
    "terminated",
  ]);
  const parsedStatuses = (Array.isArray(data.statuses) ? data.statuses : [])
    .map(recordOrNull)
    .filter((option): option is Record<string, unknown> => Boolean(option))
    .map((option) => ({
      value: String(option.value || "") as ContractStatus,
      label: String(option.label || "").trim(),
    }))
    .filter(
      (option) => allowedStatuses.has(option.value) && Boolean(option.label),
    );
  const statuses =
    new Set(parsedStatuses.map((option) => option.value)).size ===
    allowedStatuses.size
      ? parsedStatuses
      : [...allowedStatuses].map((value) => ({
          value,
          label: CONTRACT_STATUS_LABELS[value],
        }));
  const defaultArea = String(data.defaultArea || "");
  return {
    projects,
    areas: areas.length ? areas : defaultArea ? [defaultArea] : [],
    assetCategories: assetCategories.length
      ? assetCategories
      : [
          "procurement",
          "software",
          "equipment",
          "house_rental",
          "vehicle_rental",
          "parking_space",
          "office_asset",
          "other",
        ],
    declaredSubtypeOptions,
    statuses,
    expenseCategories: expenseCategories.length
      ? expenseCategories
      : ["rent", "electricity", "parking", "car_rental", "internet", "other"],
    companyName: typeof data.companyName === "string" ? data.companyName : null,
  };
}

export async function getContracts(
  query: ContractListQuery = {},
): Promise<ContractListResponse> {
  const params = {
    ...query,
    category: Array.isArray(query.category)
      ? query.category.join(",")
      : query.category || undefined,
    status: Array.isArray(query.status)
      ? query.status.join(",")
      : query.status || undefined,
  };
  const data = unwrap(
    await api.get<ApiEnvelope<ContractListResponse>>("/api/contracts", {
      params,
    }),
  );
  const total = Number(data.total || 0);
  const items = (Array.isArray(data.items) ? data.items : []).map((item) => {
    const source = item as ContractListItem & {
      has_sealed_contract_file?: unknown;
      previous_lease_contract_id?: unknown;
      renewed_from_contract_id?: unknown;
      renewal_contract_id?: unknown;
      renewal_contract_name?: unknown;
      renewal_contract_status?: unknown;
      related_agreement_count?: unknown;
      supplement_agreement_count?: unknown;
      termination_agreement_count?: unknown;
      historical_imported?: unknown;
    };
    return {
      ...item,
      hasSealedContractFile: Boolean(
        source.hasSealedContractFile ?? source.has_sealed_contract_file,
      ),
      previousLeaseContractId: (source.previousLeaseContractId ??
        source.previous_lease_contract_id ??
        source.renewed_from_contract_id ??
        null) as string | null,
      renewalContractId: (source.renewalContractId ??
        source.renewal_contract_id ??
        null) as string | null,
      renewalContractName: (source.renewalContractName ??
        source.renewal_contract_name ??
        null) as string | null,
      renewalContractStatus: (source.renewalContractStatus ??
        source.renewal_contract_status ??
        null) as ContractStatus | null,
      relatedAgreementCount:
        numberOrNull(
          source.relatedAgreementCount ?? source.related_agreement_count,
        ) ?? 0,
      supplementAgreementCount:
        numberOrNull(
          source.supplementAgreementCount ?? source.supplement_agreement_count,
        ) ?? 0,
      terminationAgreementCount:
        numberOrNull(
          source.terminationAgreementCount ??
            source.termination_agreement_count,
        ) ?? 0,
      historicalImported: Boolean(
        source.historicalImported ?? source.historical_imported,
      ),
    };
  });
  const rawSummary = (data.summary || {}) as ContractListResponse["summary"] & {
    currentAmount?: string | number;
    pendingCount?: number;
  };
  return {
    items,
    total,
    summary: {
      ...rawSummary,
      totalCount: rawSummary.totalCount ?? total,
      totalAmount: rawSummary.totalAmount ?? rawSummary.currentAmount,
      pendingApprovalCount:
        rawSummary.pendingApprovalCount ?? rawSummary.pendingCount ?? 0,
    },
  };
}

export async function getCancelledContracts(query: {
  page: number;
  pageSize: number;
}): Promise<{
  items: import("@/types/contract").CancelledContractItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  return unwrap(
    await api.get<
      ApiEnvelope<{
        items: import("@/types/contract").CancelledContractItem[];
        total: number;
        page: number;
        pageSize: number;
      }>
    >("/api/contracts/cancelled", { params: query }),
  );
}

export async function getProcessedContractApprovals(
  query: { page?: number; pageSize?: number; keyword?: string } = {},
): Promise<ContractProcessedApprovalResponse> {
  return unwrap(
    await api.get<ApiEnvelope<ContractProcessedApprovalResponse>>(
      "/api/contracts/approvals/processed",
      { params: query },
    ),
  );
}

export async function getPendingContractApprovals(
  query: { page?: number; pageSize?: number; keyword?: string } = {},
): Promise<ContractPendingApprovalResponse> {
  return unwrap(
    await api.get<ApiEnvelope<ContractPendingApprovalResponse>>(
      "/api/contracts/approvals/pending",
      { params: query },
    ),
  );
}

export async function getContractDashboard(
  params: ContractDashboardQuery = {},
): Promise<ContractDashboardResponse> {
  const data = unwrap(
    await api.get<ApiEnvelope<Record<string, unknown>>>(
      "/api/contracts/dashboard",
      {
        params,
      },
    ),
  );
  const rawSummary = (data.summary || {}) as Record<string, unknown>;
  const summaryPeriodIncome = firstDefined(rawSummary, [
    "periodAccountingIncome",
    "period_accounting_income",
    "yearIncome",
    "year_income",
    "yearAccountingIncome",
    "year_accounting_income",
  ]);
  const summaryUnreceivedAmount = firstDefined(rawSummary, [
    "unreceivedAmount",
    "unreceived_amount",
  ]);
  const summary = {
    ...rawSummary,
    totalCount: Number(rawSummary.totalCount ?? rawSummary.contractCount ?? 0),
    totalAmount: (rawSummary.totalAmount ?? rawSummary.contractAmount ?? 0) as
      | string
      | number,
    allContractAmount: (rawSummary.allContractAmount ??
      rawSummary.all_contract_amount ??
      rawSummary.totalAmount ??
      rawSummary.contractAmount ??
      0) as string | number,
    effectiveContractAmount: (rawSummary.effectiveContractAmount ??
      rawSummary.effective_contract_amount ??
      0) as string | number,
    effectiveIncomeContractAmount: (rawSummary.effectiveIncomeContractAmount ??
      rawSummary.effective_income_contract_amount ??
      0) as string | number,
    effectiveExpenseContractAmount:
      (rawSummary.effectiveExpenseContractAmount ??
        rawSummary.effective_expense_contract_amount ??
        0) as string | number,
    pendingSignatureAmount: (rawSummary.pendingSignatureAmount ??
      rawSummary.pending_signature_amount ??
      0) as string | number,
    allContractCount: Number(
      rawSummary.allContractCount ??
        rawSummary.all_contract_count ??
        rawSummary.totalCount ??
        0,
    ),
    effectiveContractCount: Number(
      rawSummary.effectiveContractCount ??
        rawSummary.effective_contract_count ??
        rawSummary.contractCount ??
        0,
    ),
    effectiveIncomeContractCount: Number(
      rawSummary.effectiveIncomeContractCount ??
        rawSummary.effective_income_contract_count ??
        0,
    ),
    effectiveExpenseContractCount: Number(
      rawSummary.effectiveExpenseContractCount ??
        rawSummary.effective_expense_contract_count ??
        0,
    ),
    pendingSignatureContractCount: Number(
      rawSummary.pendingSignatureContractCount ??
        rawSummary.pending_signature_contract_count ??
        0,
    ),
    periodContractCount: Number(
      rawSummary.periodContractCount ?? rawSummary.period_contract_count ?? 0,
    ),
    periodContractAmount: (rawSummary.periodContractAmount ??
      rawSummary.period_contract_amount ??
      0) as string | number,
    receivedAmount: (rawSummary.receivedAmount ?? 0) as string | number,
    paidAmount: (rawSummary.paidAmount ?? 0) as string | number,
    invoiceAmount: (rawSummary.invoiceAmount ?? 0) as string | number,
    periodIncome: (rawSummary.periodIncome ??
      rawSummary.period_income ??
      rawSummary.receivedAmount ??
      0) as string | number,
    periodExpense: (rawSummary.periodExpense ??
      rawSummary.period_expense ??
      rawSummary.paidAmount ??
      0) as string | number,
    periodInvoiceAmount: (rawSummary.periodInvoiceAmount ??
      rawSummary.period_invoice_amount ??
      rawSummary.invoiceAmount ??
      0) as string | number,
    periodAccountingIncome:
      aggregateDashboardMoney(summaryPeriodIncome) ?? undefined,
    monthIncome: (rawSummary.monthIncome ?? rawSummary.receivedAmount ?? 0) as
      | string
      | number,
    monthExpense: (rawSummary.monthExpense ?? rawSummary.paidAmount ?? 0) as
      | string
      | number,
    yearIncome: aggregateDashboardMoney(summaryPeriodIncome) ?? undefined,
    unreceivedAmount:
      aggregateDashboardMoney(summaryUnreceivedAmount) ?? undefined,
  };
  const categories = (
    Array.isArray(data.categories) ? data.categories : []
  ).map((item) => {
    const category = item as Record<string, unknown>;
    return {
      ...category,
      category: String(category.category || "main_business"),
      contractCount: Number(
        category.contractCount ??
          category.contract_count ??
          category.count ??
          0,
      ),
      fixedAmountContractCount: Number(
        category.fixedAmountContractCount ??
          category.fixed_amount_contract_count ??
          0,
      ),
      noFixedAmountCount: Number(
        category.noFixedAmountCount ?? category.no_fixed_amount_count ?? 0,
      ),
      totalAmount: (category.totalAmount ??
        category.total_amount ??
        category.amount ??
        0) as string | number,
      periodAmount: dashboardMoney(category, [
        "periodAmount",
        "period_amount",
        "periodSettledAmount",
        "period_settled_amount",
        "monthAmount",
        "month_amount",
      ]),
      periodSettledAmount: dashboardMoney(category, [
        "periodSettledAmount",
        "period_settled_amount",
        "periodAmount",
        "period_amount",
        "monthSettledAmount",
        "month_settled_amount",
      ]),
      monthAmount: dashboardMoney(category, [
        "monthAmount",
        "month_amount",
        "monthSettledAmount",
        "month_settled_amount",
      ]),
      monthSettledAmount: dashboardMoney(category, [
        "monthSettledAmount",
        "month_settled_amount",
        "monthAmount",
        "month_amount",
      ]),
      cumulativeAmount: dashboardMoney(category, [
        "cumulativeAmount",
        "cumulative_amount",
        "cumulativeSettledAmount",
        "cumulative_settled_amount",
        "settledAmount",
        "settled_amount",
      ]),
      cumulativeSettledAmount: dashboardMoney(category, [
        "cumulativeSettledAmount",
        "cumulative_settled_amount",
        "cumulativeAmount",
        "cumulative_amount",
        "settledAmount",
        "settled_amount",
      ]),
      settledAmount: dashboardMoney(category, [
        "settledAmount",
        "settled_amount",
        "cumulativeSettledAmount",
        "cumulative_settled_amount",
      ]),
      outstandingAmount: dashboardMoney(category, [
        "outstandingAmount",
        "outstanding_amount",
        "unreceivedAmount",
        "unreceived_amount",
        "unpaidAmount",
        "unpaid_amount",
      ]),
      monthReceiptAmount: dashboardMoney(category, [
        "monthReceiptAmount",
        "month_receipt_amount",
      ]),
      periodReceiptAmount: dashboardMoney(category, [
        "periodReceiptAmount",
        "period_receipt_amount",
        "monthReceiptAmount",
        "month_receipt_amount",
      ]),
      cumulativeReceiptAmount: dashboardMoney(category, [
        "cumulativeReceiptAmount",
        "cumulative_receipt_amount",
      ]),
      unreceivedAmount: dashboardMoney(category, [
        "unreceivedAmount",
        "unreceived_amount",
      ]),
      monthPaymentAmount: dashboardMoney(category, [
        "monthPaymentAmount",
        "month_payment_amount",
      ]),
      periodPaymentAmount: dashboardMoney(category, [
        "periodPaymentAmount",
        "period_payment_amount",
        "monthPaymentAmount",
        "month_payment_amount",
      ]),
      cumulativePaymentAmount: dashboardMoney(category, [
        "cumulativePaymentAmount",
        "cumulative_payment_amount",
      ]),
      unpaidAmount: dashboardMoney(category, ["unpaidAmount", "unpaid_amount"]),
      completionRate: numberOrNull(
        category.completionRate ??
          category.completion_rate ??
          category.progress,
      ),
      progress: numberOrNull(
        category.progress ??
          category.completionRate ??
          category.completion_rate,
      ),
    };
  });
  const risks = (Array.isArray(data.risks) ? data.risks : []).map(
    (item, index) => {
      const risk = item as Record<string, unknown>;
      const type = String(risk.type || "warning");
      return {
        id: String(risk.id || risk.contractId || `risk-${index}`),
        contractId: (risk.contractId ?? risk.contract_id ?? null) as
          | string
          | null,
        contractName: (risk.contractName ?? risk.name ?? null) as string | null,
        level: (risk.level ||
          (type === "settlement_exceeded" ? "high" : "medium")) as
          | "high"
          | "medium"
          | "low",
        title: String(
          risk.title ||
            (type === "pending_approval" ? "合同等待审批" : "合同结算金额异常"),
        ),
        description: String(
          risk.description ||
            (type === "pending_approval"
              ? "合同处于审批中，请关注处理进度。"
              : "已结算金额超过合同金额，请财务复核。"),
        ),
        occurredAt: (risk.occurredAt ?? risk.occurred_at ?? null) as
          | string
          | null,
        projectId: (risk.projectId ?? risk.project_id ?? null) as string | null,
        category: (risk.category ??
          null) as ContractDashboardResponse["risks"][number]["category"],
        status: (risk.status ??
          null) as ContractDashboardResponse["risks"][number]["status"],
      };
    },
  );
  const monthlyTrend = (
    Array.isArray(data.monthlyTrend) ? data.monthlyTrend : []
  ).map((item) => {
    const trend = item as Record<string, unknown>;
    return {
      period: String(trend.period ?? trend.month ?? ""),
      income: (trend.income ?? trend.receivedAmount ?? 0) as string | number,
      expense: (trend.expense ?? trend.paidAmount ?? 0) as string | number,
    };
  });
  const rawSettlementStatuses =
    data.settlementStatuses ?? data.settlement_statuses;
  const settlementStatuses = (
    Array.isArray(rawSettlementStatuses) ? rawSettlementStatuses : []
  ).flatMap((item) => {
    const settlement = recordOrNull(item) || {};
    const status = String(settlement.status || "");
    if (!["unsettled", "partial", "settled"].includes(status)) return [];
    const rawContracts = settlement.contracts;
    const contracts = (Array.isArray(rawContracts) ? rawContracts : []).map(
      (contract) => {
        const record = recordOrNull(contract) || {};
        const rawCategory = String(record.category || "main_business");
        const category = ["main_business", "non_main", "asset"].includes(
          rawCategory,
        )
          ? (rawCategory as ContractCategory)
          : "main_business";
        return {
          contractId: String(record.contractId ?? record.contract_id ?? ""),
          contractName: String(
            record.contractName ?? record.contract_name ?? "未命名合同",
          ),
          projectId: (record.projectId ?? record.project_id ?? null) as
            | string
            | null,
          projectName: String(
            record.projectName ?? record.project_name ?? "未关联项目",
          ),
          category,
          contractAmount:
            dashboardMoney(record, ["contractAmount", "contract_amount"]) ?? 0,
          settledAmount:
            dashboardMoney(record, ["settledAmount", "settled_amount"]) ?? 0,
          outstandingAmount:
            dashboardMoney(record, [
              "outstandingAmount",
              "outstanding_amount",
            ]) ?? 0,
          completionRate:
            numberOrNull(record.completionRate ?? record.completion_rate) ?? 0,
        };
      },
    );
    return [
      {
        status: status as "unsettled" | "partial" | "settled",
        contractCount: Number(
          settlement.contractCount ?? settlement.contract_count ?? 0,
        ),
        contractAmount:
          dashboardMoney(settlement, ["contractAmount", "contract_amount"]) ??
          0,
        settledAmount:
          dashboardMoney(settlement, ["settledAmount", "settled_amount"]) ?? 0,
        outstandingAmount:
          dashboardMoney(settlement, [
            "outstandingAmount",
            "outstanding_amount",
          ]) ?? 0,
        contracts,
      },
    ];
  });
  const rawPeriodComparison = recordOrNull(
    data.periodComparison ?? data.period_comparison,
  );
  const periodComparison = rawPeriodComparison
    ? (() => {
        const rawPeriods = rawPeriodComparison.periods;
        const periods = (Array.isArray(rawPeriods) ? rawPeriods : []).flatMap(
          (item) => {
            const period = recordOrNull(item) || {};
            const rawKey = String(period.key || "");
            const key =
              rawKey === "previous_month" ? "previous_period" : rawKey;
            if (
              !["current", "previous_period", "previous_year"].includes(key)
            ) {
              return [];
            }
            return [
              {
                key: key as "current" | "previous_period" | "previous_year",
                period: String(period.period || ""),
                startMonth: String(
                  period.startMonth ??
                    period.start_month ??
                    period.period ??
                    "",
                ),
                endMonth: String(
                  period.endMonth ?? period.end_month ?? period.period ?? "",
                ),
                incomeAmount:
                  dashboardMoney(period, ["incomeAmount", "income_amount"]) ??
                  0,
                expenseAmount:
                  dashboardMoney(period, ["expenseAmount", "expense_amount"]) ??
                  0,
              },
            ];
          },
        );
        const rawChanges = recordOrNull(rawPeriodComparison.changes) || {};
        const parseChange = (...keys: string[]) => {
          const rawChange = recordOrNull(
            keys.map((key) => rawChanges[key]).find((value) => value != null),
          );
          const percentage = numberOrNull(rawChange?.percentage);
          return {
            amount: rawChange
              ? (dashboardMoney(rawChange, ["amount", "amount_difference"]) ??
                0)
              : 0,
            percentage,
            comparable:
              rawChange?.comparable === undefined
                ? percentage !== null
                : Boolean(rawChange.comparable),
          };
        };
        return {
          periods,
          changes: {
            incomePreviousPeriod: parseChange(
              "incomePreviousPeriod",
              "income_previous_period",
              "incomeMonthOverMonth",
              "income_month_over_month",
            ),
            expensePreviousPeriod: parseChange(
              "expensePreviousPeriod",
              "expense_previous_period",
              "expenseMonthOverMonth",
              "expense_month_over_month",
            ),
            incomePreviousYear: parseChange(
              "incomePreviousYear",
              "income_previous_year",
              "incomeYearOverYear",
              "income_year_over_year",
            ),
            expensePreviousYear: parseChange(
              "expensePreviousYear",
              "expense_previous_year",
              "expenseYearOverYear",
              "expense_year_over_year",
            ),
          },
        };
      })()
    : null;
  const rawMainBusiness = recordOrNull(data.mainBusiness ?? data.main_business);
  const mainBusiness = rawMainBusiness
    ? {
        contractAmount: dashboardMoney(rawMainBusiness, [
          "contractAmount",
          "contract_amount",
        ]),
        totalContractAmount: dashboardMoney(rawMainBusiness, [
          "totalContractAmount",
          "total_contract_amount",
        ]),
        monthReceiptAmount: dashboardMoney(rawMainBusiness, [
          "monthReceiptAmount",
          "month_receipt_amount",
          "contractAmount",
          "contract_amount",
        ]),
        periodReceiptAmount: dashboardMoney(rawMainBusiness, [
          "periodReceiptAmount",
          "period_receipt_amount",
          "monthReceiptAmount",
          "month_receipt_amount",
          "contractAmount",
          "contract_amount",
        ]),
        cumulativeReceiptAmount: dashboardMoney(rawMainBusiness, [
          "cumulativeReceiptAmount",
          "cumulative_receipt_amount",
        ]),
        unreceivedAmount: dashboardMoney(rawMainBusiness, [
          "unreceivedAmount",
          "unreceived_amount",
        ]),
        tax: dashboardMoney(rawMainBusiness, [
          "tax",
          "taxAmount",
          "tax_amount",
        ]),
        marketingReserve: dashboardMoney(rawMainBusiness, [
          "marketingReserve",
          "marketing_reserve",
        ]),
        businessCost: dashboardMoney(rawMainBusiness, [
          "businessCost",
          "business_cost",
        ]),
        accountingBase: dashboardMoney(rawMainBusiness, [
          "accountingBase",
          "accounting_base",
        ]),
      }
    : null;
  const rawNonMain = recordOrNull(data.nonMain ?? data.non_main);
  const nonMain = rawNonMain
    ? {
        contractAmount: dashboardMoney(rawNonMain, [
          "contractAmount",
          "contract_amount",
        ]),
        totalContractAmount: dashboardMoney(rawNonMain, [
          "totalContractAmount",
          "total_contract_amount",
        ]),
        monthReceiptAmount: dashboardMoney(rawNonMain, [
          "monthReceiptAmount",
          "month_receipt_amount",
          "contractAmount",
          "contract_amount",
        ]),
        periodReceiptAmount: dashboardMoney(rawNonMain, [
          "periodReceiptAmount",
          "period_receipt_amount",
          "monthReceiptAmount",
          "month_receipt_amount",
          "contractAmount",
          "contract_amount",
        ]),
        cumulativeReceiptAmount: dashboardMoney(rawNonMain, [
          "cumulativeReceiptAmount",
          "cumulative_receipt_amount",
        ]),
        unreceivedAmount: dashboardMoney(rawNonMain, [
          "unreceivedAmount",
          "unreceived_amount",
        ]),
        financialCost: dashboardMoney(rawNonMain, [
          "financialCost",
          "financial_cost",
        ]),
        tax: dashboardMoney(rawNonMain, ["tax", "taxAmount", "tax_amount"]),
        accountingBase: dashboardMoney(rawNonMain, [
          "accountingBase",
          "accounting_base",
        ]),
      }
    : null;
  const rawAsset = recordOrNull(data.asset);
  const asset = rawAsset
    ? {
        paymentAmount: dashboardMoney(rawAsset, [
          "paymentAmount",
          "payment_amount",
          "monthExpense",
          "month_expense",
        ]),
        totalContractAmount: dashboardMoney(rawAsset, [
          "totalContractAmount",
          "total_contract_amount",
        ]),
        monthPaymentAmount: dashboardMoney(rawAsset, [
          "monthPaymentAmount",
          "month_payment_amount",
          "paymentAmount",
          "payment_amount",
        ]),
        periodPaymentAmount: dashboardMoney(rawAsset, [
          "periodPaymentAmount",
          "period_payment_amount",
          "monthPaymentAmount",
          "month_payment_amount",
          "paymentAmount",
          "payment_amount",
        ]),
        cumulativePaymentAmount: dashboardMoney(rawAsset, [
          "cumulativePaymentAmount",
          "cumulative_payment_amount",
        ]),
        unpaidAmount: dashboardMoney(rawAsset, [
          "unpaidAmount",
          "unpaid_amount",
        ]),
        rent: dashboardMoney(rawAsset, ["rent"]),
        electricity: dashboardMoney(rawAsset, ["electricity"]),
        parking: dashboardMoney(rawAsset, ["parking"]),
        carRental: dashboardMoney(rawAsset, ["carRental", "car_rental"]),
        internet: dashboardMoney(rawAsset, ["internet"]),
        other: dashboardMoney(rawAsset, ["other"]),
      }
    : null;
  const rawRates = recordOrNull(data.rates);
  const rates = rawRates
    ? {
        tax: numberOrNull(rawRates.tax),
        marketing: numberOrNull(rawRates.marketing),
        business: numberOrNull(rawRates.business),
        financial: numberOrNull(rawRates.financial),
      }
    : null;
  const rawRanking = data.projectRanking ?? data.project_ranking;
  const projectRanking =
    rawRanking === undefined || rawRanking === null
      ? null
      : Array.isArray(rawRanking)
        ? rawRanking.map((item, index) => {
            const ranking = (recordOrNull(item) || {}) as Record<
              string,
              unknown
            >;
            const category = String(ranking.category || "");
            return {
              rank: numberOrNull(ranking.rank) ?? index + 1,
              projectId: (ranking.projectId ?? ranking.project_id ?? null) as
                | string
                | null,
              projectName: String(
                ranking.projectName ??
                  ranking.project_name ??
                  ranking.name ??
                  "未命名项目",
              ),
              contractId: (ranking.contractId ??
                ranking.contract_id ??
                null) as string | null,
              category: (
                ["main_business", "non_main", "asset"] as string[]
              ).includes(category)
                ? (category as ContractCategory)
                : null,
              contractCount: numberOrNull(
                ranking.contractCount ??
                  ranking.contract_count ??
                  ranking.count,
              ),
              contractAmount: dashboardMoney(ranking, [
                "contractAmount",
                "contract_amount",
                "totalAmount",
                "total_amount",
              ]),
              receivedAmount: dashboardMoney(ranking, [
                "receivedAmount",
                "received_amount",
              ]),
              paidAmount: dashboardMoney(ranking, [
                "paidAmount",
                "paid_amount",
              ]),
              settledAmount: dashboardMoney(ranking, [
                "settledAmount",
                "settled_amount",
              ]),
              accountingIncome: dashboardMoney(ranking, [
                "accountingIncome",
                "accounting_income",
                "yearAccountingIncome",
                "year_accounting_income",
              ]),
              unreceivedAmount: dashboardMoney(ranking, [
                "unreceivedAmount",
                "unreceived_amount",
              ]),
              unpaidAmount: dashboardMoney(ranking, [
                "unpaidAmount",
                "unpaid_amount",
              ]),
              completionRate: numberOrNull(
                ranking.completionRate ?? ranking.completion_rate,
              ),
            };
          })
        : null;
  const periodAccountingIncome = aggregateDashboardMoney(
    firstDefined(data, [
      "periodAccountingIncome",
      "period_accounting_income",
      "yearAccountingIncome",
      "year_accounting_income",
    ]) ?? summaryPeriodIncome,
  );
  const unreceivedAmount = aggregateDashboardMoney(
    firstDefined(data, ["unreceivedAmount", "unreceived_amount"]) ??
      summaryUnreceivedAmount,
  );
  return {
    generatedAt:
      typeof (data.generatedAt ?? data.generated_at) === "string"
        ? String(data.generatedAt ?? data.generated_at)
        : null,
    startMonth:
      typeof data.startMonth === "string"
        ? data.startMonth
        : typeof data.start_month === "string"
          ? data.start_month
          : params.startMonth || "",
    endMonth:
      typeof data.endMonth === "string"
        ? data.endMonth
        : typeof data.end_month === "string"
          ? data.end_month
          : params.endMonth || "",
    summary,
    categories: categories as ContractDashboardResponse["categories"],
    settlementStatuses,
    noFixedAmountContractCount: Number(
      data.noFixedAmountContractCount ??
        data.no_fixed_amount_contract_count ??
        0,
    ),
    periodComparison,
    risks,
    monthlyTrend,
    mainBusiness,
    nonMain,
    asset,
    rates,
    periodAccountingIncome,
    yearAccountingIncome: periodAccountingIncome,
    unreceivedAmount,
    projectRanking,
  };
}

export function contractRatePercentToDecimal(value: unknown): number {
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error("费率必须是 0% 至 100% 之间的有效数值");
  }
  const unroundedBasisPoints = percentage * 100;
  const basisPoints = Math.round(unroundedBasisPoints);
  if (Math.abs(unroundedBasisPoints - basisPoints) > 1e-8) {
    throw new Error("费率百分比最多保留两位小数（整数基点）");
  }
  return basisPoints / 10000;
}

export async function getContractRates(): Promise<ContractRatesResponse> {
  const data = unwrap(
    await api.get<ApiEnvelope<ContractRatesResponse>>("/api/contracts/rates"),
  );
  const current = data.current as
    | Partial<Record<ContractRateCode, unknown>>
    | undefined;
  const parsedCurrent = {} as Record<ContractRateCode, number>;
  for (const rateCode of [
    "tax",
    "marketing",
    "business",
    "financial",
  ] as const) {
    const value = current?.[rateCode];
    if (
      value === null ||
      value === undefined ||
      String(value).trim() === "" ||
      !Number.isFinite(Number(value))
    ) {
      throw new Error("合同费率数据不完整，请重新加载");
    }
    parsedCurrent[rateCode] = Number(value);
  }
  return {
    items: Array.isArray(data.items) ? data.items : [],
    current: parsedCurrent,
  };
}

export async function createContractRates(
  payload: ContractRateMutationPayload,
): Promise<ContractRatesResponse> {
  const normalizedPayload = {
    ...payload,
    items: payload.items.map((item) => {
      const decimal = Number(item.rateValue);
      const basisPoints = Math.round(decimal * 10000);
      if (
        !Number.isFinite(decimal) ||
        decimal < 0 ||
        decimal > 1 ||
        Math.abs(decimal * 10000 - basisPoints) > 1e-8
      ) {
        throw new Error("费率必须使用整数基点");
      }
      return { ...item, rateValue: basisPoints / 10000 };
    }),
  };
  return unwrap(
    await api.post<ApiEnvelope<ContractRatesResponse>>(
      "/api/contracts/rates",
      normalizedPayload,
    ),
  );
}

export async function getContractPendingCount(): Promise<number> {
  const data = unwrap(
    await api.get<ApiEnvelope<number | { count: number }>>(
      "/api/contracts/pending-count",
    ),
  );
  return typeof data === "number" ? data : Number(data?.count || 0);
}

export async function getContractPendingSealCount(): Promise<number> {
  const data = unwrap(
    await api.get<ApiEnvelope<number | { count: number }>>(
      "/api/contracts/pending-seal-count",
    ),
  );
  return typeof data === "number" ? data : Number(data?.count || 0);
}

export async function getContract(id: string): Promise<ContractDetailResponse> {
  const raw = unwrap(
    await api.get<ApiEnvelope<Record<string, unknown>>>(`/api/contracts/${id}`),
  );
  const source = (
    raw.contract && typeof raw.contract === "object" ? raw.contract : raw
  ) as Record<string, unknown>;
  const contract = {
    ...source,
    id: String(source.id || id),
    contractNo: (source.contractNo ?? source.contract_no ?? null) as
      | string
      | null,
    systemContractNo: (source.systemContractNo ??
      source.system_contract_no ??
      null) as string | null,
    businessContractNo: (source.businessContractNo ??
      source.business_contract_no ??
      null) as string | null,
    name: String(
      source.name ||
        source.title ||
        source.projectName ||
        source.project_name ||
        source.contractNo ||
        source.contract_no ||
        "未命名合同",
    ),
    partyA: String(source.partyA ?? source.party_a ?? ""),
    partyB: String(source.partyB ?? source.party_b ?? ""),
    projectName: String(source.projectName ?? source.project_name ?? ""),
    projectId: (source.projectId ?? source.project_id ?? null) as string | null,
    category: (source.category ?? null) as ContractCategory | null,
    contractCompanySubjectName: (source.contractCompanySubjectName ??
      source.contract_company_subject_name ??
      null) as string | null,
    financialDirection: (source.financialDirection ??
      source.financial_direction ??
      null) as ContractDetailResponse["contract"]["financialDirection"],
    financialDirectionSource: (source.financialDirectionSource ??
      source.financial_direction_source ??
      null) as ContractDetailResponse["contract"]["financialDirectionSource"],
    financialDirectionInvoiceId: (source.financialDirectionInvoiceId ??
      source.financial_direction_invoice_id ??
      null) as string | null,
    financialDirectionConfirmedBy: (source.financialDirectionConfirmedBy ??
      source.financial_direction_confirmed_by ??
      null) as string | null,
    financialDirectionConfirmedAt: (source.financialDirectionConfirmedAt ??
      source.financial_direction_confirmed_at ??
      null) as string | null,
    financialDirectionVersion: Number(
      source.financialDirectionVersion ??
        source.financial_direction_version ??
        0,
    ),
    declaredCategory: (source.declaredCategory ??
      source.declared_category ??
      null) as ContractCategory | null,
    requiresAuxiliaryMaterials: Boolean(
      source.requiresAuxiliaryMaterials ??
      source.requires_auxiliary_materials ??
      false,
    ),
    declaredSubtype: (source.declaredSubtype ??
      source.declared_subtype ??
      null) as ContractDetailResponse["contract"]["declaredSubtype"],
    relationType: requireContractRelationType(source, "合同主数据"),
    status: String(source.status || "draft"),
    version: Number(source.version || 1),
    pendingAction: (source.pendingAction ?? source.pending_action ?? null) as
      | "seal"
      | "termination"
      | null,
    previousStatus: (source.previousStatus ??
      source.previous_status ??
      null) as ContractDetailResponse["contract"]["status"] | null,
    approvalRoundId: (source.approvalRoundId ??
      source.approval_round_id ??
      null) as string | null,
    approvalTargetId: (source.approvalTargetId ??
      source.approval_target_id ??
      null) as string | null,
    approvalTargetName: (source.approvalTargetName ??
      source.approval_target_name ??
      null) as string | null,
    approvalTargetRole: (source.approvalTargetRole ??
      source.approval_target_role ??
      null) as string | null,
    approvalTargetPosition: (source.approvalTargetPosition ??
      source.approval_target_position ??
      null) as string | null,
    approvalTargetSource: (source.approvalTargetSource ??
      source.approval_target_source ??
      null) as ContractDetailResponse["contract"]["approvalTargetSource"],
    amount: (source.amount ??
      source.amountDelta ??
      source.amount_delta ??
      0) as string | number,
    supplementSequence: numberOrNull(
      source.supplementSequence ?? source.supplement_sequence,
    ),
    supplementChangeType: normalizeSupplementChangeType(
      source.supplementChangeType ?? source.supplement_change_type,
    ),
    originalContractAmount: (source.originalContractAmount ??
      source.original_contract_amount ??
      null) as string | number | null,
    recognizedOriginalAmount: (source.recognizedOriginalAmount ??
      source.recognized_original_amount ??
      null) as string | number | null,
    recognizedFinalAmount: (source.recognizedFinalAmount ??
      source.recognized_final_amount ??
      null) as string | number | null,
    currentAmount: (source.currentAmount ??
      source.current_amount ??
      source.amountDelta ??
      0) as string | number,
    currentEffectiveAmount: (source.currentEffectiveAmount ??
      source.current_effective_amount ??
      source.currentAmount ??
      source.current_amount ??
      null) as string | number | null,
    projectedAmount: (source.projectedAmount ??
      source.projected_amount ??
      null) as string | number | null,
    pendingSupplementCount: numberOrNull(
      source.pendingSupplementCount ?? source.pending_supplement_count,
    ),
    amountBeforeChange: (source.amountBeforeChange ??
      source.amount_before_change ??
      null) as string | number | null,
    amountAfterChange: (source.amountAfterChange ??
      source.amount_after_change ??
      null) as string | number | null,
    receivedAmount: (source.receivedAmount ??
      source.receiptAmount ??
      source.received_amount ??
      0) as string | number,
    paidAmount: (source.paidAmount ??
      source.paymentAmount ??
      source.paid_amount ??
      0) as string | number,
    externalPaidAmount: (source.externalPaidAmount ??
      source.external_paid_amount ??
      0) as string | number,
    costSettledAmount: (source.costSettledAmount ??
      source.cost_settled_amount ??
      0) as string | number,
    completionRate: numberOrNull(
      source.completionRate ?? source.completion_rate,
    ),
    assetCategory: (source.assetCategory ??
      source.asset_category ??
      null) as ContractAssetCategory | null,
    leaseStartDate: (source.leaseStartDate ??
      source.lease_start_date ??
      null) as string | null,
    leaseEndDate: (source.leaseEndDate ?? source.lease_end_date ?? null) as
      | string
      | null,
    contractCutoffDate: (source.contractCutoffDate ??
      source.contract_cutoff_date ??
      null) as string | null,
    leaseMonthlyRent: (source.leaseMonthlyRent ??
      source.lease_monthly_rent ??
      null) as string | number | null,
    leaseMonthlyPropertyManagementFee:
      (source.leaseMonthlyPropertyManagementFee ??
        source.lease_monthly_property_fee ??
        null) as string | number | null,
    leaseTermMonths: numberOrNull(
      source.leaseTermMonths ?? source.lease_term_months,
    ),
    leaseAmountSource: (source.leaseAmountSource ??
      source.lease_amount_source ??
      null) as
      | "contract_total"
      | "monthly_rent_calculated"
      | "monthly_rent_property_fee_calculated"
      | null,
    previousLeaseContractId: (source.previousLeaseContractId ??
      source.previous_lease_contract_id ??
      source.renewed_from_contract_id ??
      null) as string | null,
    renewalContractId: (source.renewalContractId ??
      source.renewal_contract_id ??
      null) as string | null,
    renewalContractName: (source.renewalContractName ??
      source.renewal_contract_name ??
      null) as string | null,
    renewalContractStatus: (source.renewalContractStatus ??
      source.renewal_contract_status ??
      null) as ContractStatus | null,
    leaseExpiringSoon: Boolean(
      source.leaseExpiringSoon ?? source.lease_expiring_soon,
    ),
    assetFundingMode: (source.assetFundingMode ??
      source.asset_funding_mode ??
      null) as ContractDetailResponse["contract"]["assetFundingMode"],
    parentContractId: (source.parentContractId ??
      source.parent_contract_id ??
      null) as string | null,
    rootContractId: (source.rootContractId ??
      source.root_contract_id ??
      null) as string | null,
    terminationTargetContractId: (source.terminationTargetContractId ??
      source.termination_target_contract_id ??
      null) as string | null,
    fulfilledAmount: (source.fulfilledAmount ??
      source.fulfilled_amount ??
      null) as string | number | null,
    unperformedAmount: (source.unperformedAmount ??
      source.unperformed_amount ??
      null) as string | number | null,
    terminationFinalAmount: (source.terminationFinalAmount ??
      source.termination_final_amount ??
      null) as string | number | null,
    effectiveAt: (source.effectiveAt ?? source.effective_at ?? null) as
      | string
      | null,
  } as ContractDetailResponse["contract"];
  const files = (Array.isArray(raw.files) ? raw.files : []).map((item) => {
    const file = item as Record<string, unknown>;
    const sourceContractId =
      file.sourceContractId ?? file.source_contract_id ?? null;
    const sourceRelationType = String(
      file.sourceRelationType ?? file.source_relation_type ?? "",
    );
    const sourceContractName =
      file.sourceContractName ?? file.source_contract_name ?? null;
    return {
      ...file,
      id: String(file.id || ""),
      sourceContractId:
        sourceContractId === null ? null : String(sourceContractId),
      sourceRelationType: isContractRelationType(sourceRelationType)
        ? sourceRelationType
        : null,
      sourceSupplementSequence: numberOrNull(
        file.sourceSupplementSequence ?? file.source_supplement_sequence,
      ),
      sourceContractName:
        sourceContractName === null ? null : String(sourceContractName),
      fileName: String(file.fileName ?? file.file_name ?? "未命名文件"),
      fileType: String(file.fileType ?? file.file_type ?? "other"),
      mimeType: (file.mimeType ?? file.mime_type ?? null) as string | null,
      fileSize: numberOrNull(file.fileSize ?? file.file_size),
      isCurrent: Boolean(file.isCurrent ?? file.is_current),
      createdAt: (file.createdAt ?? file.created_at ?? null) as string | null,
    };
  });
  const rawJobs = Array.isArray(raw.ocrJobs) ? raw.ocrJobs : [];
  let ocrJob = raw.ocrJob
    ? normalizeOcrJob(raw.ocrJob as Record<string, unknown>)
    : null;
  if (!ocrJob && rawJobs.length) {
    const latest = rawJobs[0] as Record<string, unknown>;
    try {
      ocrJob = await getContractOcrJob(String(latest.id || ""));
    } catch {
      ocrJob = normalizeOcrJob(latest);
    }
  }
  const normalizeRecord = (
    item: unknown,
    kind: "invoice" | "receipt" | "payment" | "external_payment",
  ) => {
    const record = item as Record<string, unknown>;
    const rawStatus = String(record.status || "");
    const status: ContractFinanceRecordStatus =
      rawStatus === "reversed" || record.reversed === true
        ? "reversed"
        : rawStatus === "draft"
          ? "draft"
          : "confirmed";
    const date =
      record.recordDate ??
      record.record_date ??
      record[`${kind}Date`] ??
      record[`${kind}_date`] ??
      null;
    return {
      ...record,
      id: String(record.id || ""),
      type: kind,
      status,
      amount: (record.amount ?? 0) as string | number,
      confirmedDepositAmount: (record.confirmedDepositAmount ??
        record.confirmed_deposit_amount ??
        null) as string | number | null,
      invoiceRequiredAmount: (record.invoiceRequiredAmount ??
        record.invoice_required_amount ??
        null) as string | number | null,
      recordDate: date as string | null,
      invoiceNo: (record.invoiceNo ?? record.invoice_no ?? null) as
        | string
        | null,
      itemName: (record.itemName ??
        record.item_name ??
        record.invoiceItemName ??
        record.invoice_item_name ??
        null) as string | null,
      taxAmount: (record.taxAmount ?? record.tax_amount ?? null) as
        | string
        | number
        | null,
      seller: (record.seller ?? null) as string | null,
      buyer: (record.buyer ?? null) as string | null,
      lineItems: (Array.isArray(record.lineItems)
        ? record.lineItems
        : Array.isArray(record.line_items)
          ? record.line_items
          : []) as ContractDetailResponse["invoices"][number]["lineItems"],
      bankReference: (record.bankReference ??
        record.proofNo ??
        record.proof_no ??
        null) as string | null,
      electronicReceiptNo: (record.electronicReceiptNo ??
        record.electronic_receipt_no ??
        null) as string | null,
      transactionSerialNo: (record.transactionSerialNo ??
        record.transaction_serial_no ??
        null) as string | null,
      bookingDate: (record.bookingDate ?? record.booking_date ?? null) as
        | string
        | null,
      bankName: (record.bankName ?? record.bank_name ?? null) as string | null,
      currency: (record.currency ?? null) as string | null,
      payer: (record.payer ?? null) as string | null,
      payerAccount: (record.payerAccount ?? record.payer_account ?? null) as
        | string
        | null,
      payee: (record.payee ?? null) as string | null,
      payeeAccount: (record.payeeAccount ?? record.payee_account ?? null) as
        | string
        | null,
      expenseCategory: (record.expenseCategory ??
        record.expense_category ??
        null) as ContractExpenseCategory | null,
      financialOcrJobId: (record.financialOcrJobId ??
        record.financial_ocr_job_id ??
        null) as string | null,
      financialOcrStatus: (record.financialOcrStatus ??
        record.financial_ocr_status ??
        null) as ContractDetailResponse["invoices"][number]["financialOcrStatus"],
      financialRecognitionMethod: (record.financialRecognitionMethod ??
        record.financial_recognition_method ??
        null) as string | null,
      financialEngineVersion: (record.financialEngineVersion ??
        record.financial_engine_version ??
        null) as string | null,
      historicalConfirmedImport: Boolean(
        record.historicalConfirmedImport ??
        record.historical_confirmed_import ??
        false,
      ),
      financialValidationStatus: (record.financialValidationStatus ??
        record.financial_validation_status ??
        null) as ContractDetailResponse["invoices"][number]["financialValidationStatus"],
      financialDirection: (record.financialDirection ??
        record.financial_direction ??
        null) as ContractDetailResponse["invoices"][number]["financialDirection"],
      financialDocumentStatus: (record.financialDocumentStatus ??
        record.financial_document_status ??
        null) as ContractDetailResponse["invoices"][number]["financialDocumentStatus"],
      financialCanAutoPost: Boolean(
        record.financialCanAutoPost ?? record.financial_can_auto_post ?? false,
      ),
      financialBlockingReasons: Array.isArray(
        record.financialBlockingReasons ?? record.financial_blocking_reasons,
      )
        ? ((record.financialBlockingReasons ??
            record.financial_blocking_reasons) as ContractFinancialBlockingReason[])
        : [],
      financialRegistrationId: (record.financialRegistrationId ??
        record.financial_registration_id ??
        null) as string | null,
      financialRegistrationStatus: (record.financialRegistrationStatus ??
        record.financial_registration_status ??
        null) as ContractDetailResponse["invoices"][number]["financialRegistrationStatus"],
      paymentTime: (record.paymentTime ?? record.payment_time ?? null) as
        | string
        | null,
      fileId: (record.fileId ?? record.file_id ?? null) as string | null,
      canonicalReceiptPreviewUrl: (record.canonicalReceiptPreviewUrl ??
        record.canonical_receipt_preview_url ??
        null) as string | null,
      reversed: status === "reversed",
      reversedAt: (record.reversedAt ?? record.reversed_at ?? null) as
        | string
        | null,
      confirmedBy: (record.confirmedBy ?? record.confirmed_by ?? null) as
        | string
        | null,
      confirmedAt: (record.confirmedAt ?? record.confirmed_at ?? null) as
        | string
        | null,
      createdAt: (record.createdAt ?? record.created_at ?? null) as
        | string
        | null,
    };
  };
  const approvals = (Array.isArray(raw.approvals) ? raw.approvals : []).map(
    (item) => {
      const approval = item as Record<string, unknown>;
      return {
        ...approval,
        id: String(approval.id || ""),
        action: String(approval.action || "submit"),
        approverName: (approval.approverName ??
          approval.approver_name ??
          null) as string | null,
        approverRole: (approval.approverRole ??
          approval.approver_role ??
          null) as string | null,
        approverPosition: (approval.approverPosition ??
          approval.approver_position ??
          null) as string | null,
        approvalRoundId: (approval.approvalRoundId ??
          approval.approval_round_id ??
          null) as string | null,
        approvalTargetId: (approval.approvalTargetId ??
          approval.target_approver_id ??
          null) as string | null,
        approvalTargetName: (approval.approvalTargetName ??
          approval.target_approver_name_snapshot ??
          null) as string | null,
        approvalTargetRole: (approval.approvalTargetRole ??
          approval.target_approver_role_snapshot ??
          null) as string | null,
        approvalTargetSource: (approval.approvalTargetSource ??
          approval.target_source ??
          null) as ContractDetailResponse["approvals"][number]["approvalTargetSource"],
        fromStatus: (approval.fromStatus ?? approval.from_status ?? null) as
          | ContractDetailResponse["approvals"][number]["fromStatus"]
          | null,
        toStatus: (approval.toStatus ?? approval.to_status ?? null) as
          | ContractDetailResponse["approvals"][number]["toStatus"]
          | null,
        comment: (approval.comment ?? null) as string | null,
        createdAt: (approval.createdAt ?? approval.created_at ?? null) as
          | string
          | null,
      };
    },
  );
  const relations = (Array.isArray(raw.relations) ? raw.relations : []).map(
    (item, index) => {
      const relation = item as Record<string, unknown>;
      const relationId = String(
        relation.contractId ?? relation.contract_id ?? relation.id ?? "",
      );
      return {
        id: String(relation.id || relationId),
        contractId: relationId,
        contractName: String(
          relation.contractName ??
            relation.contract_name ??
            relation.name ??
            relation.title ??
            relation.projectName ??
            relation.project_name ??
            "未命名合同",
        ),
        contractNo: (relation.contractNo ?? relation.contract_no ?? null) as
          | string
          | null,
        terminationTargetContractId: (relation.terminationTargetContractId ??
          relation.termination_target_contract_id ??
          null) as string | null,
        relationType: requireContractRelationType(
          relation,
          `第 ${index + 1} 条关联合同`,
        ),
        amount: (relation.amount ??
          relation.amountDelta ??
          relation.amount_delta ??
          0) as string | number,
        supplementSequence: numberOrNull(
          relation.supplementSequence ?? relation.supplement_sequence,
        ),
        supplementChangeType: normalizeSupplementChangeType(
          relation.supplementChangeType ?? relation.supplement_change_type,
        ),
        originalContractAmount: (relation.originalContractAmount ??
          relation.original_contract_amount ??
          null) as string | number | null,
        recognizedOriginalAmount: (relation.recognizedOriginalAmount ??
          relation.recognized_original_amount ??
          null) as string | number | null,
        recognizedFinalAmount: (relation.recognizedFinalAmount ??
          relation.recognized_final_amount ??
          null) as string | number | null,
        amountBeforeChange: (relation.amountBeforeChange ??
          relation.amount_before_change ??
          null) as string | number | null,
        amountAfterChange: (relation.amountAfterChange ??
          relation.amount_after_change ??
          null) as string | number | null,
        fulfilledAmount: (relation.fulfilledAmount ??
          relation.fulfilled_amount ??
          null) as string | number | null,
        unperformedAmount: (relation.unperformedAmount ??
          relation.unperformed_amount ??
          null) as string | number | null,
        terminationFinalAmount: (relation.terminationFinalAmount ??
          relation.termination_final_amount ??
          null) as string | number | null,
        currentEffectiveAmount: (relation.currentEffectiveAmount ??
          relation.current_effective_amount ??
          null) as string | number | null,
        effectiveAt: (relation.effectiveAt ?? relation.effective_at ?? null) as
          | string
          | null,
        status: (relation.status ?? null) as
          | ContractDetailResponse["contract"]["status"]
          | null,
      };
    },
  );
  const rawFinancialRegistrationMatches =
    raw.financialRegistrationMatches ?? raw.financial_registration_matches;
  const rawDepositReceipts = raw.depositReceipts ?? raw.deposit_receipts;
  return {
    contract,
    files,
    ocrJob,
    ocrFields: normalizeOcrFields(raw.ocrFields || ocrJob?.fields),
    approvals: approvals as ContractDetailResponse["approvals"],
    invoices: (Array.isArray(raw.invoices) ? raw.invoices : []).map((item) =>
      normalizeRecord(item, "invoice"),
    ),
    receipts: (Array.isArray(raw.receipts) ? raw.receipts : []).map((item) =>
      normalizeRecord(item, "receipt"),
    ),
    payments: (Array.isArray(raw.payments) ? raw.payments : []).map((item) =>
      normalizeRecord(item, "payment"),
    ),
    externalPayments: (Array.isArray(raw.externalPayments)
      ? raw.externalPayments
      : Array.isArray(raw.external_payments)
        ? raw.external_payments
        : []
    ).map((item) => normalizeRecord(item, "external_payment")),
    depositReceipts: (Array.isArray(rawDepositReceipts)
      ? rawDepositReceipts
      : []
    ).map(normalizeContractDepositReceipt),
    financialRegistrationMatches: (Array.isArray(
      rawFinancialRegistrationMatches,
    )
      ? rawFinancialRegistrationMatches
      : []
    ).map((item: unknown) => {
      const match = item as Record<string, unknown>;
      return {
        registrationId: String(
          match.registrationId ?? match.registration_id ?? "",
        ),
        invoiceRecordId: String(
          match.invoiceRecordId ?? match.invoice_record_id ?? "",
        ),
        settlementRecordId: String(
          match.settlementRecordId ?? match.settlement_record_id ?? "",
        ),
        settlementKind: (match.settlementKind ??
          match.settlement_kind ??
          undefined) as "receipt" | "payment" | "external_payment" | undefined,
        allocatedAmount: Number(
          match.allocatedAmount ?? match.allocated_amount ?? 0,
        ),
      };
    }),
    relations: relations as ContractDetailResponse["relations"],
    accounting: raw.accounting
      ? {
          ...(raw.accounting as ContractDetailResponse["accounting"]),
          lines:
            (raw.accounting as ContractDetailResponse["accounting"])?.lines ||
            [],
        }
      : null,
    rentalInvoiceSummary: (raw.rentalInvoiceSummary ??
      raw.rental_invoice_summary ?? {
        rent: 0,
        propertyManagement: 0,
        contractAccountingExpense: 0,
        outsideContractCost: 0,
        electricity: 0,
        systemMaintenance: 0,
      }) as ContractDetailResponse["rentalInvoiceSummary"],
  };
}

export async function recognizeContract(
  file: File,
  metadata: ContractRecognitionUploadMetadata,
): Promise<{
  contractId: string;
  jobId: string;
}> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("area", metadata.area);
  formData.append("declaredCategory", metadata.declaredCategory);
  formData.append("declaredSubtype", metadata.declaredSubtype);
  formData.append("relationType", metadata.relationType);
  formData.append(
    "requiresAuxiliaryMaterials",
    metadata.requiresAuxiliaryMaterials ? "true" : "false",
  );
  if (metadata.assetCategory) {
    formData.append("assetCategory", metadata.assetCategory);
  }
  if (metadata.parentContractId) {
    formData.append("parentContractId", metadata.parentContractId);
  }
  return unwrap(
    await api.post<ApiEnvelope<{ contractId: string; jobId: string }>>(
      "/api/contracts/recognize",
      formData,
      { timeout: 120_000 },
    ),
  );
}

export async function getContractSupplementUploadContext(
  parentContractId: string,
): Promise<ContractSupplementUploadContext> {
  const raw = unwrap(
    await api.get<ApiEnvelope<Record<string, unknown>>>(
      `/api/contracts/${parentContractId}/supplement-upload-context`,
    ),
  );
  return {
    parentContractId: String(
      raw.parentContractId ?? raw.parent_contract_id ?? parentContractId,
    ),
    rootContractId: String(
      raw.rootContractId ?? raw.root_contract_id ?? parentContractId,
    ),
    area: String(raw.area || ""),
    declaredCategory: String(
      raw.declaredCategory ?? raw.declared_category ?? "",
    ) as ContractCategory,
    declaredSubtype: String(
      raw.declaredSubtype ?? raw.declared_subtype ?? "",
    ) as ContractDeclaredSubtype,
    assetCategory: (raw.assetCategory ?? raw.asset_category ?? null) as
      | ContractSupplementUploadContext["assetCategory"]
      | null,
    projectId: (raw.projectId ?? raw.project_id ?? null) as string | null,
    projectName: String(raw.projectName ?? raw.project_name ?? ""),
    partyA: String(raw.partyA ?? raw.party_a ?? ""),
    partyB: String(raw.partyB ?? raw.party_b ?? ""),
    parentContractName: String(
      raw.parentContractName ?? raw.parent_contract_name ?? "",
    ),
    supplementSequence:
      numberOrNull(raw.supplementSequence ?? raw.supplement_sequence) ?? 0,
    generatedContractName: String(
      raw.generatedContractName ?? raw.generated_contract_name ?? "",
    ),
    originalContractAmount: (raw.originalContractAmount ??
      raw.original_contract_amount ??
      0) as string | number,
    currentEffectiveAmount: (raw.currentEffectiveAmount ??
      raw.current_effective_amount ??
      0) as string | number,
    canUpload: Boolean(raw.canUpload ?? raw.can_upload),
    blockingReason: (raw.blockingReason ?? raw.blocking_reason ?? null) as
      | string
      | null,
  };
}

export async function recognizeSupplementContract(
  parentContractId: string,
  file: File,
): Promise<{ contractId: string; jobId: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return unwrap(
    await api.post<ApiEnvelope<{ contractId: string; jobId: string }>>(
      `/api/contracts/${parentContractId}/supplements/recognize`,
      formData,
      { timeout: 120_000 },
    ),
  );
}

export async function getContractRentalRenewalUploadContext(
  sourceContractId: string,
): Promise<ContractRentalRenewalUploadContext> {
  const raw = unwrap(
    await api.get<ApiEnvelope<Record<string, unknown>>>(
      `/api/contracts/${sourceContractId}/renewal-upload-context`,
    ),
  );
  return {
    sourceContractId: String(
      raw.sourceContractId ?? raw.source_contract_id ?? sourceContractId,
    ),
    sourceContractName: String(
      raw.sourceContractName ?? raw.source_contract_name ?? "",
    ),
    area: String(raw.area || ""),
    declaredCategory: String(
      raw.declaredCategory ?? raw.declared_category ?? "",
    ) as ContractCategory,
    declaredSubtype: String(
      raw.declaredSubtype ?? raw.declared_subtype ?? "",
    ) as ContractDeclaredSubtype,
    assetCategory: (raw.assetCategory ?? raw.asset_category ?? null) as
      | ContractRentalRenewalUploadContext["assetCategory"]
      | null,
    projectId: (raw.projectId ?? raw.project_id ?? null) as string | null,
    projectName: String(raw.projectName ?? raw.project_name ?? ""),
    partyA: String(raw.partyA ?? raw.party_a ?? ""),
    partyB: String(raw.partyB ?? raw.party_b ?? ""),
    currentLeaseEndDate: String(
      raw.currentLeaseEndDate ?? raw.current_lease_end_date ?? "",
    ),
    canUpload: Boolean(raw.canUpload ?? raw.can_upload),
    blockingReason: (raw.blockingReason ?? raw.blocking_reason ?? null) as
      | string
      | null,
  };
}

export async function recognizeRentalRenewalContract(
  sourceContractId: string,
  file: File,
): Promise<{ contractId: string; jobId: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return unwrap(
    await api.post<ApiEnvelope<{ contractId: string; jobId: string }>>(
      `/api/contracts/${sourceContractId}/renewals/recognize`,
      formData,
      { timeout: 120_000 },
    ),
  );
}

export async function getContractTerminationUploadContext(
  sourceContractId: string,
  targetContractId = sourceContractId,
): Promise<ContractTerminationUploadContext> {
  const raw = unwrap(
    await api.get<ApiEnvelope<Record<string, unknown>>>(
      `/api/contracts/${sourceContractId}/termination-upload-context`,
      { params: { targetContractId } },
    ),
  );
  return {
    rootContractId: String(
      raw.rootContractId ?? raw.root_contract_id ?? sourceContractId,
    ),
    parentContractId: String(
      raw.parentContractId ??
        raw.parent_contract_id ??
        raw.rootContractId ??
        raw.root_contract_id ??
        sourceContractId,
    ),
    targetContractId: String(
      raw.targetContractId ?? raw.target_contract_id ?? targetContractId,
    ),
    targetRelationType: String(
      raw.targetRelationType ?? raw.target_relation_type ?? "main",
    ) as ContractRelationType,
    targetName: String(raw.targetName ?? raw.target_name ?? ""),
    generatedContractName: String(
      raw.generatedContractName ?? raw.generated_contract_name ?? "",
    ),
    area: String(raw.area || ""),
    declaredCategory: String(
      raw.declaredCategory ?? raw.declared_category ?? "",
    ) as ContractCategory,
    declaredSubtype: String(
      raw.declaredSubtype ?? raw.declared_subtype ?? "",
    ) as ContractDeclaredSubtype,
    assetCategory: (raw.assetCategory ?? raw.asset_category ?? null) as
      | ContractTerminationUploadContext["assetCategory"]
      | null,
    projectId: (raw.projectId ?? raw.project_id ?? null) as string | null,
    projectName: String(raw.projectName ?? raw.project_name ?? ""),
    partyA: String(raw.partyA ?? raw.party_a ?? ""),
    partyB: String(raw.partyB ?? raw.party_b ?? ""),
    currentEffectiveAmount: (raw.currentEffectiveAmount ??
      raw.current_effective_amount ??
      0) as string | number,
    settledAmount: (raw.settledAmount ?? raw.settled_amount ?? 0) as
      | string
      | number,
    unperformedAmount: (raw.unperformedAmount ??
      raw.unperformed_amount ??
      0) as string | number,
    canUpload: Boolean(raw.canUpload ?? raw.can_upload),
    blockingReason: (raw.blockingReason ?? raw.blocking_reason ?? null) as
      | string
      | null,
  };
}

export async function recognizeTerminationContract(
  sourceContractId: string,
  targetContractId: string,
  file: File,
): Promise<{ contractId: string; jobId: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("targetContractId", targetContractId);
  return unwrap(
    await api.post<ApiEnvelope<{ contractId: string; jobId: string }>>(
      `/api/contracts/${sourceContractId}/terminations/recognize`,
      formData,
      { timeout: 120_000 },
    ),
  );
}

export async function confirmCompletedRentalExit(
  contractId: string,
  expectedVersion: number,
): Promise<void> {
  unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${contractId}/rental-exit/confirm`,
      { expectedVersion },
    ),
  );
}

export async function getContractOcrJob(
  jobId: string,
): Promise<ContractOcrJob> {
  const data = unwrap(
    await api.get<ApiEnvelope<ContractOcrJob>>(
      `/api/contracts/ocr-jobs/${jobId}`,
    ),
  );
  return normalizeOcrJob(data);
}

export async function retryContractRecognition(
  id: string,
): Promise<ContractOcrJob> {
  const data = unwrap(
    await api.post<ApiEnvelope<ContractOcrJob>>(
      `/api/contracts/${id}/recognize/retry`,
    ),
  );
  return normalizeOcrJob(data);
}

export async function updateContract(
  id: string,
  payload: ContractUpdatePayload,
): Promise<ContractDetailResponse["contract"]> {
  return unwrap(
    await api.put<ApiEnvelope<ContractDetailResponse["contract"]>>(
      `/api/contracts/${id}`,
      payload,
    ),
  );
}

export async function updateContractAuxiliaryMaterialSetting(
  id: string,
  requiresAuxiliaryMaterials: boolean,
  expectedVersion: number,
): Promise<ContractDetailResponse["contract"]> {
  return unwrap(
    await api.patch<ApiEnvelope<ContractDetailResponse["contract"]>>(
      `/api/contracts/${id}/auxiliary-material-setting`,
      { requiresAuxiliaryMaterials, expectedVersion },
    ),
  );
}

export async function submitContract(id: string): Promise<unknown> {
  return unwrap(
    await api.post<ApiEnvelope<unknown>>(`/api/contracts/${id}/submit`),
  );
}

export async function deleteContractDraft(
  id: string,
  expectedVersion: number,
): Promise<ContractDraftDeleteResult> {
  return unwrap(
    await api.delete<ApiEnvelope<ContractDraftDeleteResult>>(
      `/api/contracts/${id}`,
      {
        data: { confirmed: true, expectedVersion },
      },
    ),
  );
}

export async function cancelContractBeforeSeal(
  id: string,
  expectedVersion: number,
  cancellationReason: string,
): Promise<unknown> {
  return unwrap(
    await api.post<ApiEnvelope<unknown>>(`/api/contracts/${id}/cancel`, {
      confirmed: true,
      expectedVersion,
      cancellationReason,
    }),
  );
}

export async function withdrawContractApproval(
  id: string,
  expectedVersion: number,
): Promise<unknown> {
  return unwrap(
    await api.post<ApiEnvelope<unknown>>(`/api/contracts/${id}/withdraw`, {
      expectedVersion,
    }),
  );
}

export async function approveContract(
  id: string,
  action: ContractApprovalAction,
  comment: string,
): Promise<unknown> {
  return unwrap(
    await api.post<ApiEnvelope<unknown>>(`/api/contracts/${id}/approve`, {
      action,
      comment,
    }),
  );
}

export async function uploadSealedContract(
  id: string,
  file: File,
  expectedVersion: number,
): Promise<ContractSealWorkflowResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("expectedVersion", String(expectedVersion));
  return unwrap(
    await api.post<ApiEnvelope<ContractSealWorkflowResponse>>(
      `/api/contracts/${id}/sealed`,
      formData,
      { timeout: 1_200_000 },
    ),
  );
}

export async function getLatestSealedContractVerification(
  id: string,
): Promise<ContractSealVerification> {
  return unwrap(
    await api.get<ApiEnvelope<ContractSealVerification>>(
      `/api/contracts/${id}/sealed-verifications/latest`,
    ),
  );
}

export async function retrySealedContractVerification(
  id: string,
  verificationId: string,
  expectedVersion: number,
): Promise<ContractSealWorkflowResponse> {
  return unwrap(
    await api.post<ApiEnvelope<ContractSealWorkflowResponse>>(
      `/api/contracts/${id}/sealed-verifications/${verificationId}/retry`,
      { expectedVersion },
      { timeout: 1_200_000 },
    ),
  );
}

export async function reapproveSealedContractDifference(
  id: string,
  verificationId: string,
  expectedVersion: number,
  explanation: string,
): Promise<ContractSealWorkflowResponse> {
  return unwrap(
    await api.post<ApiEnvelope<ContractSealWorkflowResponse>>(
      `/api/contracts/${id}/sealed-verifications/${verificationId}/reapprove`,
      { expectedVersion, explanation },
    ),
  );
}

export async function archiveSealedContractVerification(
  id: string,
  verificationId: string,
  expectedVersion: number,
): Promise<ContractSealWorkflowResponse> {
  return unwrap(
    await api.post<ApiEnvelope<ContractSealWorkflowResponse>>(
      `/api/contracts/${id}/sealed-verifications/${verificationId}/archive`,
      { expectedVersion },
    ),
  );
}

export async function uploadContractFile(
  id: string,
  file: File,
  fileType: string,
): Promise<{ fileId: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("fileType", fileType);
  return unwrap(
    await api.post<ApiEnvelope<{ fileId: string }>>(
      `/api/contracts/${id}/files`,
      formData,
      {
        timeout: 120_000,
      },
    ),
  );
}

export async function deleteContractFile(
  id: string,
  fileId: string,
): Promise<void> {
  await unwrap(
    await api.delete<ApiEnvelope<unknown>>(
      `/api/contracts/${id}/files/${fileId}`,
    ),
  );
}

export async function getContractSealApplication(
  id: string,
): Promise<ContractSealApplication> {
  return unwrap(
    await api.get<ApiEnvelope<ContractSealApplication>>(
      `/api/contracts/${id}/seal-application`,
    ),
  );
}

export async function saveContractSealApplication(
  id: string,
  expectedVersion: number,
  fields: ContractSealApplicationFields,
): Promise<ContractSealApplication> {
  return unwrap(
    await api.put<ApiEnvelope<ContractSealApplication>>(
      `/api/contracts/${id}/seal-application`,
      { expectedVersion, fields },
    ),
  );
}

export async function signContractSealApplication(
  id: string,
  expectedVersion: number,
  fields: ContractSealApplicationFields,
): Promise<ContractSealApplication> {
  return unwrap(
    await api.post<ApiEnvelope<ContractSealApplication>>(
      `/api/contracts/${id}/seal-application/sign`,
      { expectedVersion, fields },
      { timeout: 120_000 },
    ),
  );
}

export async function getContractAuxiliaryPackages(
  id: string,
): Promise<ContractAuxiliaryPackage[]> {
  return unwrap(
    await api.get<ApiEnvelope<ContractAuxiliaryPackage[]>>(
      `/api/contracts/${id}/auxiliary-packages`,
    ),
  );
}

export async function createContractAuxiliaryPackage(
  id: string,
  payload: {
    contract: File[];
    invoice?: File[];
    receipt?: File[];
    note?: string;
  },
): Promise<{ packageId: string; status: "succeeded"; version: number }> {
  const formData = new FormData();
  for (const contract of payload.contract) {
    formData.append("contract", contract);
  }
  for (const invoice of payload.invoice || []) {
    formData.append("invoice", invoice);
  }
  for (const receipt of payload.receipt || []) {
    formData.append("receipt", receipt);
  }
  if (payload.note) formData.append("note", payload.note);
  return unwrap(
    await api.post<
      ApiEnvelope<{ packageId: string; status: "succeeded"; version: number }>
    >(`/api/contracts/${id}/auxiliary-packages`, formData, {
      timeout: 120_000,
    }),
  );
}

export async function appendContractAuxiliaryFiles(
  id: string,
  packageId: string,
  expectedVersion: number,
  payload: {
    contract?: File[];
    invoice?: File[];
    receipt?: File[];
    note?: string;
  },
): Promise<{
  packageId: string;
  version: number;
  appendedFileCount: number;
}> {
  const formData = new FormData();
  for (const contract of payload.contract || []) {
    formData.append("contract", contract);
  }
  for (const invoice of payload.invoice || []) {
    formData.append("invoice", invoice);
  }
  for (const receipt of payload.receipt || []) {
    formData.append("receipt", receipt);
  }
  formData.append("expectedVersion", String(expectedVersion));
  if (payload.note) formData.append("note", payload.note);
  return unwrap(
    await api.post<
      ApiEnvelope<{
        packageId: string;
        version: number;
        appendedFileCount: number;
      }>
    >(`/api/contracts/${id}/auxiliary-packages/${packageId}/files`, formData, {
      timeout: 120_000,
    }),
  );
}

export async function updateContractAuxiliaryNote(
  id: string,
  packageId: string,
  expectedVersion: number,
  note: string,
): Promise<{ packageId: string; note: string | null; version: number }> {
  return unwrap(
    await api.patch<
      ApiEnvelope<{ packageId: string; note: string | null; version: number }>
    >(`/api/contracts/${id}/auxiliary-packages/${packageId}/note`, {
      expectedVersion,
      note,
    }),
  );
}

export async function deleteContractAuxiliaryPackage(
  id: string,
  packageId: string,
  expectedVersion: number,
): Promise<void> {
  await unwrap(
    await api.delete<ApiEnvelope<unknown>>(
      `/api/contracts/${id}/auxiliary-packages/${packageId}`,
      { params: { expectedVersion } },
    ),
  );
}

export function getContractAuxiliaryFileUrl(
  contractId: string,
  packageId: string,
  fileId: string,
  download = false,
): string {
  const url = `/api/contracts/${encodeURIComponent(contractId)}/auxiliary-packages/${encodeURIComponent(packageId)}/files/${encodeURIComponent(fileId)}`;
  return download ? `${url}?download=1` : url;
}

export async function createContractRecord(
  id: string,
  type: "invoices" | "receipts" | "payments",
  payload: ContractRecordPayload,
): Promise<unknown> {
  const formData = new FormData();
  if (payload.file) formData.append("file", payload.file);
  if (payload.ocrJobId) formData.append("ocrJobId", payload.ocrJobId);
  if (payload.amount !== undefined) formData.append("amount", payload.amount);
  if (payload.recordDate !== undefined) {
    formData.append("recordDate", payload.recordDate);
  }
  const dateField =
    type === "invoices"
      ? "invoiceDate"
      : type === "receipts"
        ? "receiptDate"
        : "paymentDate";
  if (payload.recordDate !== undefined) {
    formData.append(dateField, payload.recordDate);
  }
  if (payload.invoiceNo) formData.append("invoiceNo", payload.invoiceNo);
  if (payload.itemName) formData.append("itemName", payload.itemName);
  if (payload.taxAmount !== undefined && Number(payload.taxAmount) > 0) {
    formData.append("taxAmount", payload.taxAmount);
  }
  if (payload.seller) formData.append("seller", payload.seller);
  if (payload.buyer) formData.append("buyer", payload.buyer);
  if (payload.bankReference) {
    formData.append("proofNo", payload.bankReference);
    formData.append("bankReference", payload.bankReference);
  }
  if (payload.payer) formData.append("payer", payload.payer);
  if (payload.payee) formData.append("payee", payload.payee);
  if (payload.expenseCategory) {
    formData.append("expenseCategory", payload.expenseCategory);
  }
  if (payload.note) formData.append("note", payload.note);
  if (payload.confirmDuplicate) formData.append("confirmDuplicate", "true");
  return unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${id}/${type}`,
      formData,
      {
        timeout: 120_000,
      },
    ),
  );
}

export function getContractDepositReceiptFileUrl(
  contractId: string,
  financialRecordId: string,
  depositReceiptId: string,
): string {
  return `/api/contracts/${encodeURIComponent(contractId)}/financial-records/${encodeURIComponent(financialRecordId)}/deposit-receipts/${encodeURIComponent(depositReceiptId)}/file`;
}

export async function uploadContractDepositReceipt(
  contractId: string,
  financialRecordId: string,
  file: File,
): Promise<ContractDepositReceipt> {
  const formData = new FormData();
  formData.append("file", file);
  const result = unwrap(
    await api.post<ApiEnvelope<ContractDepositReceipt>>(
      `/api/contracts/${contractId}/financial-records/${financialRecordId}/deposit-receipts`,
      formData,
      { timeout: 180_000 },
    ),
  );
  return normalizeContractDepositReceipt(result);
}

export async function verifyContractDepositReceipt(
  contractId: string,
  financialRecordId: string,
  depositReceiptId: string,
  amount: string | number,
): Promise<ContractDepositReceipt> {
  const result = unwrap(
    await api.post<ApiEnvelope<ContractDepositReceipt>>(
      `/api/contracts/${contractId}/financial-records/${financialRecordId}/deposit-receipts/${depositReceiptId}/verify`,
      { amount },
    ),
  );
  return normalizeContractDepositReceipt(result);
}

export async function deleteContractDepositReceipt(
  contractId: string,
  financialRecordId: string,
  depositReceiptId: string,
): Promise<void> {
  await api.delete(
    `/api/contracts/${contractId}/financial-records/${financialRecordId}/deposit-receipts/${depositReceiptId}`,
  );
}

export async function voidContractDepositReceipt(
  contractId: string,
  financialRecordId: string,
  depositReceiptId: string,
  reason: string,
): Promise<ContractDepositReceipt> {
  const result = unwrap(
    await api.post<ApiEnvelope<ContractDepositReceipt>>(
      `/api/contracts/${contractId}/financial-records/${financialRecordId}/deposit-receipts/${depositReceiptId}/void`,
      { reason },
    ),
  );
  return normalizeContractDepositReceipt(result);
}

export async function getContractDeposit(
  id: string,
): Promise<ContractDepositSnapshot> {
  const result = unwrap(
    await api.get<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/deposit`,
    ),
  );
  return normalizeContractDepositSnapshot(result);
}

export async function updateContractDeposit(
  id: string,
  payload: ContractDepositMutationPayload,
): Promise<ContractDepositSnapshot> {
  const result = unwrap(
    await api.put<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/deposit`,
      payload,
    ),
  );
  return normalizeContractDepositSnapshot(result);
}

export async function settleContractDeposit(
  id: string,
  payload: ContractDepositSettlementPayload,
): Promise<ContractDepositSnapshot> {
  const result = unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/deposit/settlements`,
      payload,
    ),
  );
  return normalizeContractDepositSnapshot(result);
}

export async function recognizeContractDepositReturnReceipt(
  id: string,
  receiptKind: ContractDepositReturnReceiptKind,
  file: File,
  settlementId?: string,
): Promise<ContractDepositReturnReceiptRecognition> {
  const formData = new FormData();
  formData.append("receiptKind", receiptKind);
  if (settlementId) formData.append("settlementId", settlementId);
  formData.append("file", file);
  return unwrap(
    await api.post<ApiEnvelope<ContractDepositReturnReceiptRecognition>>(
      `/api/contracts/${encodeURIComponent(id)}/deposit/return-receipts/recognize`,
      formData,
      { timeout: 180_000 },
    ),
  );
}

export async function deleteContractDepositReturnReceiptRecognition(
  id: string,
  jobId: string,
): Promise<void> {
  await unwrap(
    await api.delete<ApiEnvelope<{ deleted: boolean }>>(
      `/api/contracts/${encodeURIComponent(id)}/deposit/return-receipts/${encodeURIComponent(jobId)}`,
    ),
  );
}

export async function uploadContractDepositRefundReceipt(
  id: string,
  settlementId: string,
  ocrJobId: string,
): Promise<ContractDepositSnapshot> {
  const result = unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/deposit/settlements/${encodeURIComponent(settlementId)}/refund-receipt`,
      { ocrJobId },
    ),
  );
  return normalizeContractDepositSnapshot(result);
}

export async function deleteContractDepositSettlementReceipt(
  id: string,
  settlementId: string,
  receiptId: string,
): Promise<ContractDepositSnapshot> {
  const result = unwrap(
    await api.delete<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/deposit/settlements/${encodeURIComponent(settlementId)}/receipts/${encodeURIComponent(receiptId)}`,
    ),
  );
  return normalizeContractDepositSnapshot(result);
}

export async function registerContractDepositEngineeringReturn(
  id: string,
  settlementId: string,
  payload: ContractDepositEngineeringReturnPayload,
): Promise<ContractDepositSnapshot> {
  const result = unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/deposit/settlements/${encodeURIComponent(settlementId)}/engineering-return`,
      payload,
    ),
  );
  return normalizeContractDepositSnapshot(result);
}

function normalizeCompletedInternalFundingSummary(
  value: unknown,
): ContractCompletedInternalFundingSummary {
  const source = recordOrNull(value) || {};
  const rawReceipts = source.receipts ?? source.confirmed_receipts;
  const rawPendingRecognitions =
    source.pendingRecognitions ?? source.pending_recognitions;
  return {
    canAppendAfterCompletion: Boolean(
      source.canAppendAfterCompletion ?? source.can_append_after_completion,
    ),
    contractCompanySubjectName: String(
      source.contractCompanySubjectName ??
        source.contract_company_subject_name ??
        "签约公司",
    ),
    requiredAmount: (source.requiredAmount ?? source.required_amount ?? 0) as
      | string
      | number,
    confirmedAmount: (source.confirmedAmount ??
      source.confirmed_amount ??
      0) as string | number,
    pendingAmount: (source.pendingAmount ?? source.pending_amount ?? 0) as
      | string
      | number,
    remainingAmount: (source.remainingAmount ??
      source.remaining_amount ??
      0) as string | number,
    availableRecognitionAmount: (source.availableRecognitionAmount ??
      source.available_recognition_amount ??
      undefined) as string | number | undefined,
    receipts: (Array.isArray(rawReceipts) ? rawReceipts : []).map((item) => {
      const receipt = recordOrNull(item) || {};
      return {
        id: String(receipt.id || ""),
        fileId: (receipt.fileId ?? receipt.file_id ?? null) as string | null,
        fileName: String(
          receipt.fileName ?? receipt.file_name ?? "工程划拨回单",
        ),
        fileSize: numberOrNull(receipt.fileSize ?? receipt.file_size),
        mimeType: (receipt.mimeType ?? receipt.mime_type ?? null) as
          | string
          | null,
        amount: (receipt.amount ?? 0) as string | number,
        paymentTime: String(
          receipt.paymentTime ??
            receipt.payment_time ??
            receipt.paymentDate ??
            receipt.payment_date ??
            "",
        ),
        electronicReceiptNo: (receipt.electronicReceiptNo ??
          receipt.electronic_receipt_no ??
          null) as string | null,
        payer: (receipt.payer ?? null) as string | null,
        payerAccount: (receipt.payerAccount ??
          receipt.payer_account ??
          null) as string | null,
        payee: (receipt.payee ?? null) as string | null,
        payeeAccount: (receipt.payeeAccount ??
          receipt.payee_account ??
          null) as string | null,
        previewUrl: (receipt.previewUrl ??
          receipt.preview_url ??
          receipt.fileUrl ??
          receipt.file_url ??
          null) as string | null,
      };
    }),
    pendingRecognitions: (Array.isArray(rawPendingRecognitions)
      ? rawPendingRecognitions
      : []
    ).map(normalizeCompletedInternalFundingRecognition),
  };
}

function normalizeCompletedInternalFundingRecognition(
  value: unknown,
): ContractCompletedInternalFundingRecognition {
  const source = recordOrNull(value) || {};
  const snapshot = recordOrNull(source.snapshot) || {};
  const fields = recordOrNull(source.fields ?? snapshot.fields) || {};
  return {
    jobId: String(source.jobId ?? source.job_id ?? source.id ?? ""),
    fileId: String(source.fileId ?? source.file_id ?? ""),
    fileName: (source.fileName ?? source.file_name ?? null) as string | null,
    fileSize: numberOrNull(source.fileSize ?? source.file_size),
    status: String(
      source.status || "blocked",
    ) as ContractFinancialOcrTaskStatus,
    validationStatus: (source.validationStatus ??
      source.validation_status ??
      null) as ContractFinancialValidationStatus | null,
    canConfirm: Boolean(
      source.canConfirm ?? source.can_confirm ?? source.canCreateDraft,
    ),
    fields: {
      paymentTime: String(fields.paymentTime ?? fields.payment_time ?? ""),
      amount: Number(fields.amount || 0),
      electronicReceiptNo: String(
        fields.electronicReceiptNo ?? fields.electronic_receipt_no ?? "",
      ),
      payer: String(fields.payer || ""),
      payerAccount: String(fields.payerAccount ?? fields.payer_account ?? ""),
      payee: String(fields.payee || ""),
      payeeAccount: String(fields.payeeAccount ?? fields.payee_account ?? ""),
    },
    blockingReasons: Array.isArray(
      source.blockingReasons ?? source.blocking_reasons,
    )
      ? ((source.blockingReasons ??
          source.blocking_reasons) as ContractFinancialBlockingReason[])
      : [],
    warnings: Array.isArray(source.warnings) ? source.warnings.map(String) : [],
    fileUrl: (source.fileUrl ?? source.file_url ?? null) as string | null,
  };
}

export async function getCompletedInternalFundingSummary(
  id: string,
): Promise<ContractCompletedInternalFundingSummary> {
  const result = unwrap(
    await api.get<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/completed-internal-funding-summary`,
    ),
  );
  return normalizeCompletedInternalFundingSummary(result);
}

export async function recognizeCompletedInternalFundingFile(
  id: string,
  file: File,
): Promise<ContractCompletedInternalFundingRecognition> {
  const formData = new FormData();
  formData.append("file", file);
  const result = unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/completed-internal-funding/recognize`,
      formData,
      { timeout: 180_000 },
    ),
  );
  return normalizeCompletedInternalFundingRecognition(result);
}

export async function deleteCompletedInternalFundingRecognition(
  id: string,
  jobId: string,
): Promise<void> {
  await unwrap(
    await api.delete<ApiEnvelope<{ deleted: boolean }>>(
      `/api/contracts/${encodeURIComponent(id)}/completed-internal-funding/recognitions/${encodeURIComponent(jobId)}`,
    ),
  );
}

export async function confirmCompletedInternalFunding(
  id: string,
  ocrJobIds: string[],
): Promise<ContractCompletedInternalFundingSummary> {
  const result = unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/completed-internal-funding/confirm`,
      { ocrJobIds },
    ),
  );
  return normalizeCompletedInternalFundingSummary(result);
}

export async function getContractExternalPaymentPurposeDetails(
  id: string,
  recordId: string,
): Promise<ContractPaymentPurposeDetails> {
  const result = unwrap(
    await api.get<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/external-payments/${encodeURIComponent(recordId)}/purpose-details`,
    ),
  );
  return normalizeContractPaymentPurposeDetails(result, id, recordId);
}

export async function updateContractExternalPaymentPurposeDetails(
  id: string,
  recordId: string,
  details: ContractPaymentPurposeDetail[],
): Promise<ContractPaymentPurposeDetails> {
  const result = unwrap(
    await api.put<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/external-payments/${encodeURIComponent(recordId)}/purpose-details`,
      { details },
    ),
  );
  return normalizeContractPaymentPurposeDetails(result, id, recordId);
}

export async function getContractPaymentPurposeDetails(
  id: string,
  recordId: string,
): Promise<ContractPaymentPurposeDetails> {
  const result = unwrap(
    await api.get<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/payments/${encodeURIComponent(recordId)}/purpose-details`,
    ),
  );
  return normalizeContractPaymentPurposeDetails(result, id, recordId);
}

export async function updateContractPaymentPurposeDetails(
  id: string,
  recordId: string,
  details: ContractPaymentPurposeDetail[],
): Promise<ContractPaymentPurposeDetails> {
  const result = unwrap(
    await api.put<ApiEnvelope<unknown>>(
      `/api/contracts/${encodeURIComponent(id)}/payments/${encodeURIComponent(recordId)}/purpose-details`,
      { details },
    ),
  );
  return normalizeContractPaymentPurposeDetails(result, id, recordId);
}

export async function recognizeContractFinancialFile(
  id: string,
  kind: "invoice" | "receipt" | "payment",
  file: File,
): Promise<ContractFinancialOcrResult> {
  const formData = new FormData();
  formData.append("kind", kind);
  formData.append("file", file);
  return unwrap(
    await api.post<ApiEnvelope<ContractFinancialOcrResult>>(
      `/api/contracts/${id}/financial-ocr`,
      formData,
      { timeout: 180_000 },
    ),
  );
}

export async function getPendingContractFinancialOcrUploads(
  id: string,
): Promise<ContractFinancialOcrResult[]> {
  return unwrap(
    await api.get<ApiEnvelope<ContractFinancialOcrResult[]>>(
      `/api/contracts/${id}/financial-ocr/pending`,
    ),
  );
}

export async function retryContractFinancialOcrUpload(
  id: string,
  ocrJobId: string,
): Promise<ContractFinancialOcrResult> {
  return unwrap(
    await api.post<ApiEnvelope<ContractFinancialOcrResult>>(
      `/api/contracts/${id}/financial-ocr/${ocrJobId}/retry`,
      {},
      { timeout: 180_000 },
    ),
  );
}

export async function deleteContractFinancialOcrUpload(
  id: string,
  ocrJobId: string,
): Promise<void> {
  await unwrap(
    await api.delete<ApiEnvelope<{ deleted: boolean }>>(
      `/api/contracts/${id}/financial-ocr/${ocrJobId}`,
    ),
  );
}

export async function createContractFinancialRegistration(
  id: string,
  payload: ContractFinancialRegistrationPayload,
): Promise<ContractFinancialRegistrationResult> {
  return unwrap(
    await api.post<ApiEnvelope<ContractFinancialRegistrationResult>>(
      `/api/contracts/${id}/financial-registrations`,
      payload,
      { timeout: 120_000 },
    ),
  );
}

export async function appendContractFinancialRegistrationSettlements(
  id: string,
  registrationId: string,
  payload: Pick<
    ContractFinancialRegistrationPayload,
    "invoiceOcrJobIds" | "bankOcrJobIds" | "expenseCategory" | "note"
  >,
): Promise<ContractFinancialRegistrationResult> {
  return unwrap(
    await api.post<ApiEnvelope<ContractFinancialRegistrationResult>>(
      `/api/contracts/${id}/financial-registrations/${registrationId}/settlements`,
      payload,
      { timeout: 120_000 },
    ),
  );
}

export async function appendContractFinancialRegistrationExternalPayments(
  id: string,
  registrationId: string,
  payload: Pick<
    ContractFinancialRegistrationPayload,
    "bankOcrJobIds" | "expenseCategory" | "note"
  >,
): Promise<ContractFinancialRegistrationResult> {
  return unwrap(
    await api.post<ApiEnvelope<ContractFinancialRegistrationResult>>(
      `/api/contracts/${id}/financial-registrations/${registrationId}/external-payments`,
      payload,
      { timeout: 120_000 },
    ),
  );
}

export async function createContractExternalPaymentRegistration(
  id: string,
  payload: ContractFinancialRegistrationPayload,
): Promise<ContractFinancialRegistrationResult> {
  return unwrap(
    await api.post<ApiEnvelope<ContractFinancialRegistrationResult>>(
      `/api/contracts/${id}/financial-registrations/external-payments`,
      payload,
    ),
  );
}

export async function updateContractAssetFundingMode(
  id: string,
  fundingMode: NonNullable<
    ContractDetailResponse["contract"]["assetFundingMode"]
  >,
): Promise<ContractDetailResponse["contract"]> {
  return unwrap(
    await api.patch<ApiEnvelope<ContractDetailResponse["contract"]>>(
      `/api/contracts/${id}/asset-funding-mode`,
      { fundingMode },
    ),
  );
}

export async function confirmContractFinancialRegistration(
  id: string,
  registrationId: string,
): Promise<unknown> {
  return unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${id}/financial-registrations/${registrationId}/confirm`,
    ),
  );
}

export async function deleteContractFinancialRegistration(
  id: string,
  registrationId: string,
): Promise<unknown> {
  return unwrap(
    await api.delete<ApiEnvelope<unknown>>(
      `/api/contracts/${id}/financial-registrations/${registrationId}`,
    ),
  );
}

export async function reverseContractFinancialRegistration(
  id: string,
  registrationId: string,
  reason: string,
): Promise<unknown> {
  return unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${id}/financial-registrations/${registrationId}/reverse`,
      { reason },
    ),
  );
}

export async function confirmContractRecord(
  id: string,
  type: "invoices" | "receipts" | "payments",
  recordId: string,
): Promise<unknown> {
  return unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${id}/${type}/${recordId}/confirm`,
    ),
  );
}

export async function deleteContractRecordDraft(
  id: string,
  type: "invoices" | "receipts" | "payments",
  recordId: string,
): Promise<unknown> {
  return unwrap(
    await api.delete<ApiEnvelope<unknown>>(
      `/api/contracts/${id}/${type}/${recordId}`,
    ),
  );
}

export async function reverseContractRecord(
  id: string,
  type: "invoices" | "receipts" | "payments",
  recordId: string,
  reason: string,
): Promise<unknown> {
  return unwrap(
    await api.post<ApiEnvelope<unknown>>(
      `/api/contracts/${id}/${type}/${recordId}/reverse`,
      { reason },
    ),
  );
}

export function getContractFileUrl(fileId: string, download = false): string {
  const url = `/api/contracts/files/${encodeURIComponent(fileId)}`;
  return download ? `${url}?download=1` : url;
}

export function getContractErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const candidate = error as {
    response?: { data?: { message?: string } };
  };
  if (candidate.response?.data?.message) return candidate.response.data.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function getContractErrorCode(error: unknown): string | null {
  const candidate = error as {
    response?: { data?: { code?: unknown } };
  };
  const code = candidate.response?.data?.code;
  return typeof code === "string" && code ? code : null;
}
