// 合同管理模块类型定义

export type ContractCategory = "main_business" | "non_main" | "asset";

export type ContractDeclaredSubtype =
  | "engineering_consulting"
  | "preliminary_procedures"
  | "technical_consulting"
  | "non_main_income"
  | "other_service"
  | "procurement"
  | "software"
  | "equipment"
  | "house_rental"
  | "vehicle_rental"
  | "parking_space"
  | "office_asset";

export type ContractRelationType = "main" | "supplement" | "termination";

export type ContractSupplementChangeType =
  | "payment_terms_only"
  | "amount_adjustment"
  | "amount_and_payment"
  | "legacy_unresolved";

export type ContractStatus =
  | "draft"
  | "approving"
  | "pending_seal"
  | "effective"
  | "executing"
  | "completed"
  | "rejected"
  | "terminated";

export type ContractOcrStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "partial"
  | "failed";

export type ContractOcrFieldKey =
  | "party_a"
  | "party_b"
  | "project_name"
  | "amount"
  | "category"
  | "contract_date";

export type ContractApprovalAction = "approve" | "reject";
export type ContractApprovalKind = "seal" | "termination" | "seal_difference";
export type ContractApprovalTargetSource = "project_owner" | "general_manager";

export type ContractFinanceRecordType =
  | "invoice"
  | "receipt"
  | "payment"
  | "external_payment";
export type ContractAssetFundingMode =
  | "engineering_direct"
  | "engineering_to_technology"
  | "technology_direct"
  | "pending_review";
export type ContractFinanceRecordStatus = "draft" | "confirmed" | "reversed";
export type ContractDepositReceiptStatus =
  | "recognizing"
  | "recognized"
  | "manual_review"
  | "verified"
  | "failed"
  | "voided";
export type ContractDepositStatus =
  | "pending_payment"
  | "active"
  | "partially_settled"
  | "settled";
export type ContractDepositPaymentPurpose = "lease_deposit";
export type ContractDepositFundingSource =
  | "engineering_allocation"
  | "technology_self_funded"
  | "mixed"
  | "pending_review";
export type ContractDepositPaymentRecordKind = "payment" | "external_payment";
export type ContractDepositSettlementType =
  | "refund"
  | "deduction"
  | "rent_offset";
export type ContractPaymentPurpose = "contract_payment" | "lease_deposit";
export type ContractBusinessFinancialDirection = "income" | "cost";
export type ContractSettlementStatus = "unsettled" | "partial" | "settled";

export type ContractSealVerificationStatus =
  | "infrastructure_failed"
  | "review_required"
  | "difference_explanation_required"
  | "difference_approving"
  | "difference_approved"
  | "difference_rejected"
  | "ready_to_archive"
  | "archived"
  | "superseded";

export type ContractSealVerificationFieldKey =
  | "party_a"
  | "party_b"
  | "amount"
  | "contract_date";

export interface ContractSealVerificationField {
  field: ContractSealVerificationFieldKey;
  approvedValue?: string | null;
  recognizedValue?: string | null;
  finalValue?: string | null;
  confidence: number;
  source: string;
  requiresRecognitionRetry: boolean;
  isMismatch: boolean;
}

export interface ContractSealMismatch {
  field: ContractSealVerificationFieldKey;
  label: string;
  approvedValue: string;
  sealedValue: string;
}

export interface ContractSealVerification {
  id: string;
  contractId: string;
  fileId: string;
  fileName?: string | null;
  mimeType?: string | null;
  status: ContractSealVerificationStatus;
  uploadDate: string;
  approvedSnapshot: {
    partyA: string;
    partyB: string;
    amount: MoneyValue;
    contractDate?: string | null;
  };
  recognitionStatus: ContractOcrStatus;
  recognitionMethod?: string | null;
  recognitionWarnings: string[];
  mismatches: ContractSealMismatch[];
  infrastructureFailure: boolean;
  requiresRecognitionRetry: boolean;
  differenceExplanation?: string | null;
  approvalSubmittedAt?: string | null;
  approvalCompletedAt?: string | null;
  confirmedAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  fields: ContractSealVerificationField[];
}

export interface ContractSealWorkflowResponse {
  contract: ContractDetailResponse["contract"];
  verification: ContractSealVerification;
}

export type ContractRateCode = "tax" | "marketing" | "business" | "financial";

export type ContractAssetCategory =
  | "procurement"
  | "software"
  | "equipment"
  | "house_rental"
  | "vehicle_rental"
  | "parking_space"
  | "office_asset"
  | "other";

export type ContractUploadAssetCategory = Exclude<
  ContractAssetCategory,
  "other"
>;

export type ContractExpenseCategory =
  | "rent"
  | "electricity"
  | "parking"
  | "car_rental"
  | "internet"
  | "other";

export type MoneyValue = string | number;

export interface ContractProjectOption {
  id: string;
  name: string;
  clientName?: string | null;
  area?: string | null;
  contractAmount?: MoneyValue | null;
}

export interface ContractDeclaredSubtypeOption {
  value: ContractDeclaredSubtype;
  label: string;
}

export type ContractDeclaredSubtypeOptions = Record<
  ContractCategory,
  ContractDeclaredSubtypeOption[]
>;

export interface ContractMeta {
  projects: ContractProjectOption[];
  areas: string[];
  assetCategories: ContractAssetCategory[];
  declaredSubtypeOptions: ContractDeclaredSubtypeOptions;
  statuses?: Array<{ value: ContractStatus; label: string }>;
  expenseCategories?: ContractExpenseCategory[];
  companyName?: string | null;
}

export interface ContractOcrField {
  key: ContractOcrFieldKey;
  label: string;
  value: string | number | null;
  rawText?: string | null;
  evidenceText?: string | null;
  confidence: number | null;
  pageNumber?: number | null;
  required: boolean;
  manuallyConfirmed: boolean;
  manuallyEdited?: boolean;
  warning?: string | null;
}

export interface ContractOcrJob {
  id: string;
  contractId: string;
  status: ContractOcrStatus;
  fields: ContractOcrField[];
  errorMessage?: string | null;
  warnings: string[];
  createdAt?: string | null;
  finishedAt?: string | null;
  contractVersion?: number | null;
  engineVersion?: string | null;
  parserVersion?: string | null;
  requiresRefresh?: boolean;
}

export interface ContractListItem {
  id: string;
  contractNo?: string | null;
  systemContractNo?: string | null;
  businessContractNo?: string | null;
  name: string;
  partyA: string;
  partyB: string;
  projectName: string;
  projectId?: string | null;
  category: ContractCategory | null;
  declaredCategory?: ContractCategory | null;
  declaredSubtype?: ContractDeclaredSubtype | null;
  requiresAuxiliaryMaterials?: boolean;
  relationType: ContractRelationType;
  parentContractId?: string | null;
  rootContractId?: string | null;
  terminationTargetContractId?: string | null;
  parentContractName?: string | null;
  status: ContractStatus;
  version: number;
  pendingAction?: "seal" | "termination" | null;
  previousStatus?: ContractStatus | null;
  approvalRoundId?: string | null;
  approvalKind?: ContractApprovalKind | null;
  approvalTargetId?: string | null;
  approvalTargetName?: string | null;
  approvalTargetRole?: string | null;
  approvalTargetPosition?: string | null;
  approvalTargetSource?: ContractApprovalTargetSource | null;
  approvalRoundSubmittedAt?: string | null;
  area?: string | null;
  assetCategory?: ContractAssetCategory | null;
  amount: MoneyValue;
  supplementSequence?: number | null;
  supplementChangeType?: ContractSupplementChangeType | null;
  originalContractAmount?: MoneyValue | null;
  recognizedOriginalAmount?: MoneyValue | null;
  recognizedFinalAmount?: MoneyValue | null;
  currentAmount?: MoneyValue | null;
  currentEffectiveAmount?: MoneyValue | null;
  projectedAmount?: MoneyValue | null;
  pendingSupplementCount?: number | null;
  relatedAgreementCount?: number;
  supplementAgreementCount?: number;
  terminationAgreementCount?: number;
  amountBeforeChange?: MoneyValue | null;
  amountAfterChange?: MoneyValue | null;
  fulfilledAmount?: MoneyValue | null;
  unperformedAmount?: MoneyValue | null;
  terminationFinalAmount?: MoneyValue | null;
  receivedAmount?: MoneyValue | null;
  paidAmount?: MoneyValue | null;
  externalPaidAmount?: MoneyValue | null;
  /** 合同履约结算额；房租合同不包含保证金、电费等合同外付款。 */
  costSettledAmount?: MoneyValue | null;
  completionRate?: number | null;
  financialDirection?: ContractBusinessFinancialDirection | null;
  financialDirectionSource?: "contract_category" | "invoice" | null;
  financialDirectionInvoiceId?: string | null;
  financialDirectionConfirmedBy?: string | null;
  financialDirectionConfirmedAt?: string | null;
  financialDirectionVersion?: number;
  assetFundingMode?: ContractAssetFundingMode | null;
  contractDate?: string | null;
  effectiveAt?: string | null;
  leaseStartDate?: string | null;
  leaseEndDate?: string | null;
  contractCutoffDate?: string | null;
  leaseMonthlyRent?: MoneyValue | null;
  leaseMonthlyPropertyManagementFee?: MoneyValue | null;
  leaseTermMonths?: number | null;
  leaseAmountSource?:
    | "contract_total"
    | "monthly_rent_calculated"
    | "monthly_rent_property_fee_calculated"
    | null;
  previousLeaseContractId?: string | null;
  renewalContractId?: string | null;
  renewalContractName?: string | null;
  renewalContractStatus?: ContractStatus | null;
  hasSealedContractFile?: boolean;
  leaseExpiringSoon?: boolean;
  ownerName?: string | null;
  historicalImported?: boolean;
  updatedAt?: string | null;
  createdAt?: string | null;
  invoiceApplicationEligibility?: {
    eligible: boolean;
    reasonCode?: string | null;
    reason?: string | null;
    remainingAmount?: MoneyValue | null;
    pendingAmount?: MoneyValue | null;
    invoicedAmount?: MoneyValue | null;
  } | null;
}

export interface CancelledContractFile {
  id: string;
  fileType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  version: number;
  createdAt?: string | null;
}

export interface CancelledContractItem extends ContractListItem {
  cancelledBy?: string | null;
  cancelledByName?: string | null;
  cancelledByRole?: string | null;
  cancelledFromStatus: ContractStatus;
  cancellationReason?: string | null;
  cancelledAt: string;
  files: CancelledContractFile[];
}

export interface ContractListSummary {
  totalCount?: number;
  totalAmount?: MoneyValue;
  allContractAmount?: MoneyValue;
  effectiveContractAmount?: MoneyValue;
  effectiveIncomeContractAmount?: MoneyValue;
  effectiveExpenseContractAmount?: MoneyValue;
  pendingSignatureAmount?: MoneyValue;
  allContractCount?: number;
  effectiveContractCount?: number;
  effectiveIncomeContractCount?: number;
  effectiveExpenseContractCount?: number;
  pendingSignatureContractCount?: number;
  periodContractCount?: number;
  periodContractAmount?: MoneyValue;
  executingCount?: number;
  executingAmount?: MoneyValue;
  receivedAmount?: MoneyValue;
  unreceivedAmount?: MoneyValue;
  pendingApprovalCount?: number;
  pendingSealCount?: number;
  leaseExpiringCount?: number;
  monthIncome?: MoneyValue;
  yearIncome?: MoneyValue;
  monthExpense?: MoneyValue;
  paidAmount?: MoneyValue;
  unpaidAmount?: MoneyValue;
  invoiceAmount?: MoneyValue;
  periodIncome?: MoneyValue;
  periodExpense?: MoneyValue;
  periodInvoiceAmount?: MoneyValue;
  periodAccountingIncome?: MoneyValue;
}

export interface ContractListResponse {
  items: ContractListItem[];
  total: number;
  summary: ContractListSummary;
}

export interface ContractFile {
  id: string;
  contractId?: string;
  sourceContractId?: string | null;
  sourceRelationType?: ContractRelationType | null;
  sourceSupplementSequence?: number | null;
  sourceContractName?: string | null;
  fileName: string;
  fileType: string;
  mimeType?: string | null;
  fileSize?: number | null;
  isCurrent?: boolean;
  uploadedByName?: string | null;
  createdAt?: string | null;
}

export type ContractSealApplicationSealType = "company" | "contract";

export interface ContractSealApplicationFields {
  sealPurpose: string;
  sealType: ContractSealApplicationSealType;
  copyCount: number | null;
  crossPageSeal: boolean;
  note: string;
}

export interface ContractSealCopyCountRecognition {
  status: "recognized" | "unrecognized" | "signed_snapshot";
  code: string | null;
  message: string | null;
}

export interface ContractSealApplication {
  id: string | null;
  formVersion: number;
  contractVersion: number;
  status: "draft" | "signed" | "superseded";
  fields: ContractSealApplicationFields;
  copyCountRecognition: ContractSealCopyCountRecognition;
  signedFileId: string | null;
  signerName: string | null;
  signerRole: string | null;
  signerDepartment: string | null;
  signedAt: string | null;
  approvedFileId: string | null;
  approverName: string | null;
  approverRole: string | null;
  approverSignedAt: string | null;
  fullySigned: boolean;
  updatedAt: string | null;
  stale: boolean;
  contract?: {
    contractNo: string;
    title: string | null;
    projectName: string | null;
    partyA: string | null;
    partyB: string | null;
    amount: MoneyValue | null;
    categoryLabel: string;
    relationLabel: string;
    area: string;
  };
}

export type ContractAuxiliaryStatus =
  | "processing"
  | "succeeded"
  | "partial"
  | "failed";
export type ContractAuxiliaryFileKind = "contract" | "invoice" | "receipt";

export interface ContractAuxiliaryFile {
  id: string;
  packageId: string;
  fileKind: ContractAuxiliaryFileKind;
  fileName: string;
  fileSize: number;
  mimeType: string;
  version: number;
  isCurrent: boolean;
  createdAt: string;
}

export interface ContractAuxiliaryOcrField {
  field: "party_a" | "party_b" | "amount";
  originalValue: string | null;
  normalizedValue: string | null;
  ocrConfidence: number | null;
  fieldScore: number;
  source: string;
  pageNumber: number | null;
  warnings: string[];
}

export interface ContractAuxiliaryPackage {
  id: string;
  parentContractId: string;
  partyA: string | null;
  partyB: string | null;
  recognizedAmount: MoneyValue | null;
  note: string | null;
  status: ContractAuxiliaryStatus;
  ocrFields: ContractAuxiliaryOcrField[];
  warnings: string[];
  errorMessage: string | null;
  modelVersion: string | null;
  parserVersion: string | null;
  retryCount: number;
  version: number;
  accountingIncluded: false;
  createdAt: string;
  updatedAt: string;
  files: ContractAuxiliaryFile[];
}

export interface ContractApprovalRecord {
  id: string;
  action:
    | ContractApprovalAction
    | "submit"
    | "withdraw"
    | "seal"
    | "terminate"
    | "termination_request"
    | "seal_difference_submit";
  actionLabel?: string | null;
  approverName?: string | null;
  approverRole?: string | null;
  approverPosition?: string | null;
  approvalRoundId?: string | null;
  approvalTargetId?: string | null;
  approvalTargetName?: string | null;
  approvalTargetRole?: string | null;
  approvalTargetSource?: ContractApprovalTargetSource | null;
  fromStatus?: ContractStatus | null;
  toStatus?: ContractStatus | null;
  comment?: string | null;
  createdAt?: string | null;
}

export interface ContractProcessedApprovalItem extends ContractListItem {
  approvalRecordId: string;
  approvalAction: ContractApprovalAction;
  approvalComment?: string | null;
  approvalFromStatus?: ContractStatus | null;
  approvalToStatus?: ContractStatus | null;
  processedAt?: string | null;
}

export interface ContractProcessedApprovalResponse {
  items: ContractProcessedApprovalItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ContractPendingApprovalResponse {
  items: ContractListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ContractFinanceRecord {
  id: string;
  type?: ContractFinanceRecordType;
  status: ContractFinanceRecordStatus;
  amount: MoneyValue;
  confirmedDepositAmount?: MoneyValue | null;
  invoiceRequiredAmount?: MoneyValue | null;
  recordDate?: string | null;
  invoiceNo?: string | null;
  itemName?: string | null;
  taxAmount?: MoneyValue | null;
  seller?: string | null;
  buyer?: string | null;
  lineItems?: ContractInvoiceLineItem[];
  bankReference?: string | null;
  electronicReceiptNo?: string | null;
  transactionSerialNo?: string | null;
  bookingDate?: string | null;
  bankName?: string | null;
  currency?: string | null;
  payer?: string | null;
  payerAccount?: string | null;
  payee?: string | null;
  payeeAccount?: string | null;
  expenseCategory?: ContractExpenseCategory | null;
  financialOcrJobId?: string | null;
  financialOcrStatus?: ContractFinancialOcrTaskStatus | null;
  financialRecognitionMethod?: string | null;
  financialEngineVersion?: string | null;
  historicalConfirmedImport?: boolean;
  financialValidationStatus?: ContractFinancialValidationStatus | null;
  financialDirection?: ContractFinancialDirection | null;
  financialDocumentStatus?: ContractFinancialDocumentStatus | null;
  financialCanAutoPost?: boolean;
  financialBlockingReasons?: ContractFinancialBlockingReason[];
  financialRegistrationId?: string | null;
  financialRegistrationStatus?: ContractFinanceRecordStatus | null;
  paymentTime?: string | null;
  note?: string | null;
  fileId?: string | null;
  fileName?: string | null;
  canonicalReceiptPreviewUrl?: string | null;
  reversed?: boolean;
  reversedAt?: string | null;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
}

export interface ContractDepositReceipt {
  id: string;
  contractId: string;
  financialRecordId: string;
  fileId: string;
  fileName: string;
  mimeType?: string | null;
  previewUrl?: string | null;
  ocrAmount?: MoneyValue | null;
  verifiedAmount?: MoneyValue | null;
  status: ContractDepositReceiptStatus;
  recognitionMessage?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
  verifiedBy?: string | null;
  verifiedByName?: string | null;
  verifiedAt?: string | null;
  voidedBy?: string | null;
  voidedByName?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
}

export interface ContractDepositSettlement {
  id: string;
  type: ContractDepositSettlementType;
  amount: MoneyValue;
  settlementDate: string;
  note?: string | null;
  refundReceipt: ContractDepositSettlementReceipt | null;
  engineeringReturnReceipts: ContractDepositSettlementReceipt[];
  engineeringReturnRequiredAmount?: MoneyValue | null;
  engineeringReturnedAmount?: MoneyValue | null;
  engineeringReturnStatus?:
    | "not_required"
    | "pending"
    | "partial"
    | "returned"
    | "completed"
    | null;
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
}

export interface ContractDepositSettlementReceipt {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType?: string | null;
  amount: MoneyValue;
  transactionDate: string;
  fileUrl: string;
  uploadedBy?: string | null;
  uploadedByName?: string | null;
  createdAt?: string | null;
}

export type ContractDepositReturnReceiptKind =
  | "deposit_refund"
  | "engineering_return";

export interface ContractDepositReturnReceiptFields {
  paymentTime: string;
  amount: MoneyValue | null;
  electronicReceiptNo: string;
  payer: string;
  payerAccount: string;
  payee: string;
  payeeAccount: string;
}

export interface ContractDepositReturnReceiptRecognition {
  jobId: string;
  fileId: string;
  receiptKind: ContractDepositReturnReceiptKind;
  targetId: string;
  status: ContractFinancialOcrTaskStatus;
  validationStatus: ContractFinancialValidationStatus | null;
  canConfirm: boolean;
  fields: ContractDepositReturnReceiptFields;
  blockingReasons: ContractFinancialBlockingReason[];
  warnings: string[];
  engineVersion?: string | null;
  parserVersion?: string | null;
  fileUrl?: string | null;
}

export interface ContractDepositRecord {
  id: string;
  contractId: string;
  amount: MoneyValue;
  clauseText?: string | null;
  basis?: string | null;
  paymentPurpose: ContractDepositPaymentPurpose;
  fundingSource: ContractDepositFundingSource;
  paymentRecordId?: string | null;
  paymentRecordKind?: ContractDepositPaymentRecordKind | null;
  paidAt?: string | null;
  note?: string | null;
  engineeringAllocationAmount: MoneyValue;
  technologySelfFundedAmount: MoneyValue;
  pendingEngineeringReturn: MoneyValue;
  status: ContractDepositStatus;
  settledAmount: MoneyValue;
  remainingAmount: MoneyValue;
  settlements: ContractDepositSettlement[];
  createdBy?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
  updatedBy?: string | null;
  updatedByName?: string | null;
  updatedAt?: string | null;
}

export interface ContractDepositEligibility {
  likely: boolean;
  reason: "rental_subtype" | "non_rental_subtype";
  subtype?: ContractDeclaredSubtype | null;
}

export interface ContractDepositSnapshot {
  eligibility: ContractDepositEligibility;
  deposit: ContractDepositRecord | null;
}

export interface ContractDepositMutationPayload {
  amount: MoneyValue;
  clauseText?: string;
  basis?: string;
  paymentPurpose: ContractDepositPaymentPurpose;
  fundingSource: ContractDepositFundingSource;
  engineeringAllocationAmount?: MoneyValue;
  technologySelfFundedAmount?: MoneyValue;
  paymentRecordId?: string;
  note?: string;
}

export type ContractDepositSettlementPayload =
  | {
      type: "refund";
      ocrJobId: string;
      note?: string;
    }
  | {
      type: "deduction" | "rent_offset";
      amount: MoneyValue;
      settlementDate: string;
      note: string;
      file?: never;
    };

export interface ContractDepositEngineeringReturnPayload {
  ocrJobId: string;
  note?: string;
}

export interface ContractCompletedInternalFundingReceipt {
  id: string;
  fileId?: string | null;
  fileName: string;
  fileSize?: number | null;
  mimeType?: string | null;
  amount: MoneyValue;
  paymentTime: string;
  electronicReceiptNo?: string | null;
  payer?: string | null;
  payerAccount?: string | null;
  payee?: string | null;
  payeeAccount?: string | null;
  previewUrl?: string | null;
}

export interface ContractCompletedInternalFundingRecognition {
  jobId: string;
  fileId: string;
  fileName?: string | null;
  fileSize?: number | null;
  status: ContractFinancialOcrTaskStatus;
  validationStatus: ContractFinancialValidationStatus | null;
  canConfirm: boolean;
  fields: ContractFinancialBankFields;
  blockingReasons: ContractFinancialBlockingReason[];
  warnings: string[];
  fileUrl?: string | null;
}

export interface ContractCompletedInternalFundingSummary {
  canAppendAfterCompletion: boolean;
  contractCompanySubjectName: string;
  requiredAmount: MoneyValue;
  confirmedAmount: MoneyValue;
  pendingAmount: MoneyValue;
  remainingAmount: MoneyValue;
  availableRecognitionAmount?: MoneyValue;
  receipts: ContractCompletedInternalFundingReceipt[];
  pendingRecognitions: ContractCompletedInternalFundingRecognition[];
}

export interface ContractPaymentPurposeDetail {
  purpose: ContractPaymentPurpose;
  amount: MoneyValue;
  fundingSource: ContractDepositFundingSource;
  engineeringAllocationAmount?: MoneyValue | null;
  technologySelfFundedAmount?: MoneyValue | null;
}

export interface ContractPaymentPurposeDetails {
  contractId: string;
  recordId: string;
  details: ContractPaymentPurposeDetail[];
}

export interface ContractRelation {
  id: string;
  relationType: ContractRelationType;
  contractId: string;
  contractName: string;
  contractNo?: string | null;
  terminationTargetContractId?: string | null;
  amount?: MoneyValue | null;
  supplementSequence?: number | null;
  supplementChangeType?: ContractSupplementChangeType | null;
  originalContractAmount?: MoneyValue | null;
  recognizedOriginalAmount?: MoneyValue | null;
  recognizedFinalAmount?: MoneyValue | null;
  amountBeforeChange?: MoneyValue | null;
  amountAfterChange?: MoneyValue | null;
  fulfilledAmount?: MoneyValue | null;
  unperformedAmount?: MoneyValue | null;
  terminationFinalAmount?: MoneyValue | null;
  currentEffectiveAmount?: MoneyValue | null;
  effectiveAt?: string | null;
  status?: ContractStatus | null;
}

export interface ContractAccountingLine {
  key: string;
  label: string;
  amount: MoneyValue;
  rate?: number | null;
  emphasized?: boolean;
}

export interface ContractAccounting {
  basis?: MoneyValue | null;
  monthIncome?: MoneyValue | null;
  yearIncome?: MoneyValue | null;
  unreceivedAmount?: MoneyValue | null;
  unpaidAmount?: MoneyValue | null;
  monthExpense?: MoneyValue | null;
  costSettledAmount?: MoneyValue | null;
  settledAmount?: MoneyValue | null;
  completionRate?: number | null;
  overAmount?: MoneyValue | null;
  lines: ContractAccountingLine[];
  note?: string | null;
}

export interface ContractDetailResponse {
  contract: ContractListItem & {
    description?: string | null;
    parentContractId?: string | null;
    sourceFileId?: string | null;
    sealedFileId?: string | null;
    submittedAt?: string | null;
    effectiveAt?: string | null;
    completedAt?: string | null;
    terminatedAt?: string | null;
    contractCompanySubjectName?: string | null;
  };
  files: ContractFile[];
  ocrJob: ContractOcrJob | null;
  ocrFields: ContractOcrField[];
  approvals: ContractApprovalRecord[];
  invoices: ContractFinanceRecord[];
  receipts: ContractFinanceRecord[];
  payments: ContractFinanceRecord[];
  externalPayments: ContractFinanceRecord[];
  depositReceipts: ContractDepositReceipt[];
  financialRegistrationMatches: ContractFinancialRegistrationMatch[];
  relations: ContractRelation[];
  accounting: ContractAccounting | null;
  rentalInvoiceSummary: ContractRentalInvoiceSummary;
}

export interface ContractRentalInvoiceSummary {
  rent: MoneyValue;
  propertyManagement: MoneyValue;
  contractAccountingExpense: MoneyValue;
  outsideContractCost: MoneyValue;
  electricity: MoneyValue;
  systemMaintenance: MoneyValue;
}

export interface ContractFinancialRegistrationMatch {
  registrationId: string;
  invoiceRecordId: string;
  settlementRecordId: string;
  settlementKind?: "receipt" | "payment" | "external_payment";
  allocatedAmount: MoneyValue;
}

export interface ContractRiskItem {
  id: string;
  level: "high" | "medium" | "low";
  title: string;
  description: string;
  contractId?: string | null;
  contractName?: string | null;
  projectId?: string | null;
  category?: ContractCategory | null;
  status?: ContractStatus | null;
  occurredAt?: string | null;
}

export interface ContractDashboardCategory {
  category: ContractCategory;
  contractCount: number;
  fixedAmountContractCount?: number;
  noFixedAmountCount?: number;
  totalAmount: MoneyValue;
  periodAmount?: MoneyValue | null;
  periodSettledAmount?: MoneyValue | null;
  monthAmount?: MoneyValue | null;
  monthSettledAmount?: MoneyValue | null;
  cumulativeAmount?: MoneyValue | null;
  cumulativeSettledAmount?: MoneyValue | null;
  settledAmount?: MoneyValue | null;
  outstandingAmount?: MoneyValue | null;
  monthReceiptAmount?: MoneyValue | null;
  periodReceiptAmount?: MoneyValue | null;
  cumulativeReceiptAmount?: MoneyValue | null;
  yearAmount?: MoneyValue | null;
  unreceivedAmount?: MoneyValue | null;
  monthPaymentAmount?: MoneyValue | null;
  periodPaymentAmount?: MoneyValue | null;
  cumulativePaymentAmount?: MoneyValue | null;
  unpaidAmount?: MoneyValue | null;
  completionRate?: number | null;
  accountingBase?: MoneyValue | null;
  progress?: number | null;
  lines?: ContractAccountingLine[];
}

export interface ContractDashboardMainBusiness {
  contractAmount: MoneyValue | null;
  totalContractAmount: MoneyValue | null;
  monthReceiptAmount: MoneyValue | null;
  periodReceiptAmount?: MoneyValue | null;
  cumulativeReceiptAmount: MoneyValue | null;
  unreceivedAmount: MoneyValue | null;
  tax: MoneyValue | null;
  marketingReserve: MoneyValue | null;
  businessCost: MoneyValue | null;
  accountingBase: MoneyValue | null;
}

export interface ContractDashboardNonMain {
  contractAmount: MoneyValue | null;
  totalContractAmount: MoneyValue | null;
  monthReceiptAmount: MoneyValue | null;
  periodReceiptAmount?: MoneyValue | null;
  cumulativeReceiptAmount: MoneyValue | null;
  unreceivedAmount: MoneyValue | null;
  financialCost: MoneyValue | null;
  tax: MoneyValue | null;
  accountingBase: MoneyValue | null;
}

export interface ContractDashboardAsset {
  paymentAmount: MoneyValue | null;
  totalContractAmount: MoneyValue | null;
  monthPaymentAmount: MoneyValue | null;
  periodPaymentAmount?: MoneyValue | null;
  cumulativePaymentAmount: MoneyValue | null;
  unpaidAmount: MoneyValue | null;
  rent: MoneyValue | null;
  electricity: MoneyValue | null;
  parking: MoneyValue | null;
  carRental: MoneyValue | null;
  internet: MoneyValue | null;
  other: MoneyValue | null;
}

export type ContractDashboardRates = Record<ContractRateCode, number | null>;

export interface ContractDashboardProjectRanking {
  rank?: number | null;
  projectId?: string | null;
  projectName: string;
  contractId?: string | null;
  category?: ContractCategory | null;
  contractCount?: number | null;
  contractAmount?: MoneyValue | null;
  receivedAmount?: MoneyValue | null;
  paidAmount?: MoneyValue | null;
  settledAmount?: MoneyValue | null;
  accountingIncome?: MoneyValue | null;
  unreceivedAmount?: MoneyValue | null;
  unpaidAmount?: MoneyValue | null;
  completionRate?: number | null;
}

export interface ContractDashboardSettlementContract {
  contractId: string;
  contractName: string;
  projectId: string | null;
  projectName: string;
  category: ContractCategory;
  contractAmount: MoneyValue;
  settledAmount: MoneyValue;
  outstandingAmount: MoneyValue;
  completionRate: number;
}

export interface ContractDashboardSettlementStatus {
  status: ContractSettlementStatus;
  contractCount: number;
  contractAmount: MoneyValue;
  settledAmount: MoneyValue;
  outstandingAmount: MoneyValue;
  contracts: ContractDashboardSettlementContract[];
}

export type ContractDashboardComparisonPeriodKey =
  | "current"
  | "previous_period"
  | "previous_year";

export interface ContractDashboardComparisonPeriod {
  key: ContractDashboardComparisonPeriodKey;
  period: string;
  startMonth: string;
  endMonth: string;
  incomeAmount: MoneyValue;
  expenseAmount: MoneyValue;
}

export interface ContractDashboardComparisonChange {
  amount: MoneyValue;
  percentage: number | null;
  comparable: boolean;
}

export interface ContractDashboardPeriodComparison {
  periods: ContractDashboardComparisonPeriod[];
  changes: {
    incomePreviousPeriod: ContractDashboardComparisonChange;
    expensePreviousPeriod: ContractDashboardComparisonChange;
    incomePreviousYear: ContractDashboardComparisonChange;
    expensePreviousYear: ContractDashboardComparisonChange;
  };
}

export interface ContractDashboardQuery {
  startMonth?: string;
  endMonth?: string;
  category?: ContractCategory | "";
  projectId?: string;
}

export interface ContractDashboardResponse {
  generatedAt?: string | null;
  startMonth: string;
  endMonth: string;
  summary: ContractListSummary;
  categories: ContractDashboardCategory[];
  settlementStatuses: ContractDashboardSettlementStatus[];
  noFixedAmountContractCount: number;
  periodComparison: ContractDashboardPeriodComparison | null;
  risks: ContractRiskItem[];
  monthlyTrend?: Array<{
    period: string;
    income: MoneyValue;
    expense: MoneyValue;
  }>;
  mainBusiness: ContractDashboardMainBusiness | null;
  nonMain: ContractDashboardNonMain | null;
  asset: ContractDashboardAsset | null;
  rates: ContractDashboardRates | null;
  periodAccountingIncome: MoneyValue | null;
  /** 兼容旧调用方；值与 periodAccountingIncome 相同。 */
  yearAccountingIncome: MoneyValue | null;
  unreceivedAmount: MoneyValue | null;
  projectRanking: ContractDashboardProjectRanking[] | null;
}

export interface ContractRateConfig {
  id: string;
  rateCode: ContractRateCode;
  rateValue: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdByName?: string | null;
  changeReason?: string | null;
  createdAt?: string | null;
}

export interface ContractRatesResponse {
  items: ContractRateConfig[];
  current: Record<ContractRateCode, number>;
}

export interface ContractRateMutationPayload {
  effectiveFrom: string;
  changeReason: string;
  items: Array<{
    rateCode: ContractRateCode;
    rateValue: number;
  }>;
}

export interface ContractListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  counterparty?: string;
  category?: ContractCategory | ContractCategory[] | "";
  status?: ContractStatus | ContractStatus[] | "";
  settlementStatus?: ContractSettlementStatus | "";
  relationType?: ContractRelationType | "";
  projectId?: string;
  area?: string;
  contractDateFrom?: string;
  contractDateTo?: string;
}

export interface ContractUpdatePayload {
  expectedVersion: number;
  projectId?: string | null;
  description?: string | null;
}

export interface ContractRecognitionUploadMetadata {
  area: string;
  declaredCategory: ContractCategory;
  declaredSubtype: ContractDeclaredSubtype;
  relationType: ContractRelationType;
  assetCategory?: ContractUploadAssetCategory | null;
  parentContractId?: string | null;
  requiresAuxiliaryMaterials?: boolean;
}

export interface ContractSupplementUploadContext {
  parentContractId: string;
  rootContractId: string;
  area: string;
  declaredCategory: ContractCategory;
  declaredSubtype: ContractDeclaredSubtype;
  assetCategory?: ContractUploadAssetCategory | null;
  projectId?: string | null;
  projectName: string;
  partyA: string;
  partyB: string;
  parentContractName: string;
  supplementSequence: number;
  generatedContractName: string;
  originalContractAmount: MoneyValue;
  currentEffectiveAmount: MoneyValue;
  canUpload: boolean;
  blockingReason?: string | null;
}

export interface ContractRentalRenewalUploadContext {
  sourceContractId: string;
  sourceContractName: string;
  area: string;
  declaredCategory: ContractCategory;
  declaredSubtype: ContractDeclaredSubtype;
  assetCategory?: ContractUploadAssetCategory | null;
  projectId?: string | null;
  projectName: string;
  partyA: string;
  partyB: string;
  currentLeaseEndDate: string;
  canUpload: boolean;
  blockingReason?: string | null;
}

export interface ContractTerminationUploadContext {
  rootContractId: string;
  parentContractId: string;
  targetContractId: string;
  targetRelationType: ContractRelationType;
  targetName: string;
  generatedContractName: string;
  area: string;
  declaredCategory: ContractCategory;
  declaredSubtype: ContractDeclaredSubtype;
  assetCategory?: ContractUploadAssetCategory | null;
  projectId?: string | null;
  projectName: string;
  partyA: string;
  partyB: string;
  currentEffectiveAmount: MoneyValue;
  settledAmount: MoneyValue;
  unperformedAmount: MoneyValue;
  canUpload: boolean;
  blockingReason?: string | null;
}

export interface ContractDraftDeleteResult {
  id: string;
  deleted: true;
  permanent: true;
  deletedFileCount: number;
  failedFileCount: number;
}

export interface ContractRecordPayload {
  ocrJobId?: string;
  amount?: string;
  recordDate?: string;
  file?: File;
  invoiceNo?: string;
  itemName?: string;
  taxAmount?: string;
  seller?: string;
  buyer?: string;
  bankReference?: string;
  payer?: string;
  payee?: string;
  expenseCategory?: ContractExpenseCategory;
  note?: string;
  confirmDuplicate?: boolean;
}

export interface ContractFinancialRegistrationPayload {
  invoiceOcrJobIds?: string[];
  bankOcrJobIds?: string[];
  expenseCategory?: ContractExpenseCategory;
  note?: string;
}

export interface ContractFinancialRegistrationResult {
  registrationId: string;
  invoiceRecordIds: string[];
  settlementRecordIds: string[];
  invoiceRecordId: string | null;
  settlementRecordId: string | null;
  matches: ContractFinancialRegistrationMatch[];
  status: "draft" | "confirmed";
}

export type ContractFinancialOcrTaskStatus =
  | "processing"
  | "verified"
  | "blocked"
  | "failed"
  | "consumed";
export type ContractFinancialValidationStatus =
  | "verified"
  | "blocked"
  | "failed";
export type ContractFinancialDirection =
  | "input"
  | "output"
  | "third_party"
  | "receipt"
  | "payment"
  | "unknown";
export type ContractFinancialDocumentStatus =
  | "normal"
  | "void"
  | "red"
  | "unknown";

export interface ContractFinancialBlockingReason {
  code: string;
  message: string;
  field?: string;
}

export interface ContractFinancialInvoiceFields {
  invoiceNumber: string;
  invoiceDate: string;
  itemName: string;
  amount: number;
  taxAmount: number | null;
  seller: string;
  buyer: string;
  lineItems: ContractInvoiceLineItem[];
}

export type ContractInvoiceLineExpenseCategory =
  | "rent"
  | "property_management"
  | "electricity"
  | "system_maintenance"
  | "other_cost"
  | "pending_review";

export interface ContractInvoiceLineItem {
  id?: string;
  itemName: string;
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
  expenseCategory: ContractInvoiceLineExpenseCategory;
  includeInContractAccounting: boolean;
  recognitionStatus: "verified" | "pending_review";
  actualPaidAmount?: number;
}

export interface ContractFinancialBankFields {
  electronicReceiptNo: string;
  paymentTime: string;
  payer: string;
  payerAccount: string;
  payee: string;
  payeeAccount: string;
  amount: number;
}

export interface ContractFinancialOcrResult {
  id: string;
  contractId: string;
  fileId: string;
  recordKind: ContractFinanceRecordType;
  status: ContractFinancialOcrTaskStatus;
  validationStatus: ContractFinancialValidationStatus | null;
  recognitionMethod: string | null;
  engineVersion?: string | null;
  parserVersion?: string | null;
  requiresRefresh?: boolean;
  evidenceTextHash: string | null;
  direction: ContractFinancialDirection | null;
  expectedDirection: "input" | "output" | "receipt" | "payment" | "unknown";
  documentStatus: ContractFinancialDocumentStatus | null;
  canCreateDraft: boolean;
  /** 诊断分仅用于排查识别质量，不能解释为字段正确率。 */
  diagnosticScore: number | null;
  snapshot: {
    format: "pdf" | "jpeg" | "png" | null;
    fields: ContractFinancialInvoiceFields | ContractFinancialBankFields;
  };
  blockingReasons: ContractFinancialBlockingReason[];
  warnings: string[];
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}
