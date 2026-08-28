export type MonthlyFinancialAmount = string;

export type MonthlyFinancialBankAccountCode = "basic" | "general" | "business";

export type MonthlyFinancialBankDirection = "inflow" | "outflow" | "unknown";

export type MonthlyFinancialBankTransactionCategory =
  | "interest"
  | "bank_fee"
  | "basic_reimbursement"
  | "large_reimbursement"
  | "business_reimbursement"
  | "salary"
  | "main_income"
  | "asset_expense"
  | "internal_transfer"
  | "ignored"
  | "unclassified"
  | string;

export interface MonthlyFinancialBankReceiptFile {
  id: string;
  originalName: string;
  fileHash: string;
  version: number;
  pageCount: number | null;
  receiptCount: number;
  includedReceiptCount: number;
  status: string;
  detectedMonths: string[];
  warnings: string[];
  anomalies: string[];
  uploadedBy: string;
  uploaderName: string | null;
  recognizedAt: string | null;
  updatedAt: string;
}

export interface MonthlyFinancialBankReceiptTotals {
  inflow: MonthlyFinancialAmount;
  outflow: MonthlyFinancialAmount;
  included: MonthlyFinancialAmount;
  internalTransfer: MonthlyFinancialAmount;
  interest: MonthlyFinancialAmount;
  bankFee: MonthlyFinancialAmount;
}

export interface MonthlyFinancialBankReceiptTransaction {
  id: string;
  electronicReceiptNo: string | null;
  transactionDate: string | null;
  amount: MonthlyFinancialAmount;
  direction: MonthlyFinancialBankDirection | string | null;
  payer: string | null;
  payerAccount: string | null;
  payee: string | null;
  payeeAccount: string | null;
  remark: string | null;
  pageNo: number;
  position: string;
  category: MonthlyFinancialBankTransactionCategory;
  recognitionStatus: string;
  includeInReport: boolean;
  warnings: string[];
  linkStatus: "matched" | "conflict" | "unmatched" | string;
  previewUrl: string | null;
  employeeMatch?: {
    status: "matched" | "unmatched" | "ambiguous";
    employeeId: string | null;
    employeeName: string | null;
  };
  reimbursementLink?: {
    status: "matched" | "unmatched" | "conflict";
    displayAction: "none" | "attached" | "replaced";
    reasons: string[];
    linkedReimbursements: Array<{
      id: string;
      type: "basic" | "large" | "business";
      title: string;
      applicantName: string;
      status: string;
      amount: MonthlyFinancialAmount;
      allocatedAmount: MonthlyFinancialAmount | null;
      detailUrl: string;
      originalProofPreviewUrl: string | null;
      bankProofPreviewUrl: string;
      effectiveProofPreviewUrl: string;
      paymentBatchId: string | null;
    }>;
  };
}

export interface MonthlyFinancialBankReceiptAccount {
  accountCode: MonthlyFinancialBankAccountCode;
  accountName: string;
  accountNumber: string;
  file: MonthlyFinancialBankReceiptFile | null;
  totals: MonthlyFinancialBankReceiptTotals;
  transactions: MonthlyFinancialBankReceiptTransaction[];
}

export interface MonthlyFinancialBankReceiptState {
  month: string;
  knownFileHashes: string[];
  accounts: MonthlyFinancialBankReceiptAccount[];
}

export interface MonthlyFinancialBankReceiptDuplicateFile {
  originalName: string;
  existingFileId: string;
}

export type MonthlyFinancialReportStatus =
  | "draft"
  | "pending_review"
  | "closed"
  | "reopened";

export type MonthlyFinancialAccountCode =
  | "general"
  | "business"
  | "welfare_one"
  | "welfare_two";

export type MonthlyFinancialManualDirection = "income" | "expense";

export type MonthlyFinancialManualCategory =
  | "general_interest"
  | "business_interest"
  | "general_bank_fee"
  | "general_other"
  | "business_bank_fee"
  | "welfare_one_supplement"
  | "welfare_one_407"
  | "welfare_one_drinking_water"
  | "welfare_one_office"
  | "welfare_one_electricity"
  | "welfare_one_407_ai"
  | "welfare_one_8h_ai"
  | "welfare_two_supplement"
  | "welfare_two_refreshment"
  | "welfare_two_team_building"
  | "welfare_two_physical_exam";

export interface MonthlyFinancialAccountSummary {
  code: MonthlyFinancialAccountCode;
  name: string;
  opening: MonthlyFinancialAmount;
  inflow: MonthlyFinancialAmount;
  outflow: MonthlyFinancialAmount;
  closing: MonthlyFinancialAmount;
}

export interface MonthlyFinancialIncomeSummary {
  mainReceipt: MonthlyFinancialAmount;
  tax: MonthlyFinancialAmount;
  marketingReserve: MonthlyFinancialAmount;
  businessCost: MonthlyFinancialAmount;
  accountingBase: MonthlyFinancialAmount;
  generalInterest: MonthlyFinancialAmount;
  businessInterest: MonthlyFinancialAmount;
  welfareOneSupplement: MonthlyFinancialAmount;
  welfareTwoSupplement: MonthlyFinancialAmount;
}

export interface MonthlyFinancialExpenseSummary {
  humanCost: MonthlyFinancialAmount;
  basicReimbursement: MonthlyFinancialAmount;
  largeReimbursement: MonthlyFinancialAmount;
  assetAdministration: MonthlyFinancialAmount;
  generalBankFee: MonthlyFinancialAmount;
  generalOther: MonthlyFinancialAmount;
  businessReimbursement: MonthlyFinancialAmount;
  businessBankFee: MonthlyFinancialAmount;
  welfareOne407: MonthlyFinancialAmount;
  welfareOneDrinkingWater: MonthlyFinancialAmount;
  welfareOneOffice: MonthlyFinancialAmount;
  welfareOneElectricity: MonthlyFinancialAmount;
  welfareOne407Ai: MonthlyFinancialAmount;
  welfareOne8hAi: MonthlyFinancialAmount;
  welfareTwoRefreshment: MonthlyFinancialAmount;
  welfareTwoTeamBuilding: MonthlyFinancialAmount;
  welfareTwoPhysicalExam: MonthlyFinancialAmount;
}

export interface MonthlyFinancialTotals {
  opening: MonthlyFinancialAmount;
  income: MonthlyFinancialAmount;
  expense: MonthlyFinancialAmount;
  closing: MonthlyFinancialAmount;
  netChange: MonthlyFinancialAmount;
}

export interface MonthlyFinancialManualItem {
  id: string;
  category: MonthlyFinancialManualCategory | string;
  categoryLabel: string;
  accountCode: MonthlyFinancialAccountCode;
  direction: MonthlyFinancialManualDirection;
  occurredOn: string;
  amount: MonthlyFinancialAmount;
  description: string | null;
  voucherReference: string | null;
  sourceType?: "manual" | "monthly_bank_transaction";
  readOnly?: boolean;
  effective?: boolean;
  previewUrl?: string | null;
}

export interface MonthlyFinancialManualItemInput {
  id?: string;
  category: MonthlyFinancialManualCategory | string;
  occurredOn: string;
  amount: MonthlyFinancialAmount;
  description?: string | null;
  voucherReference?: string | null;
}

export interface MonthlyFinancialAutomaticDetail {
  sourceType: string;
  sourceId: string;
  occurredOn: string;
  accountCode: MonthlyFinancialAccountCode;
  metric: string;
  amount: MonthlyFinancialAmount;
  description: string;
  personId?: string | null;
  personName: string | null;
  bankAccountCode?: MonthlyFinancialBankAccountCode | null;
  electronicReceiptNo?: string | null;
  previewUrl?: string | null;
  linkStatus?: "matched" | "conflict" | "unmatched" | null;
}

export type MonthlyFinancialSourceKey =
  | "contract_receipts"
  | "payroll"
  | "reimbursements"
  | "asset_payments"
  | "monthly_bank_receipts";

export interface MonthlyFinancialAutomaticBankSummary {
  activeAccounts: MonthlyFinancialBankAccountCode[];
  chargeAccounts?: Array<"general" | "business">;
  generalInterest: MonthlyFinancialAmount;
  businessInterest: MonthlyFinancialAmount;
  generalBankFee: MonthlyFinancialAmount;
  businessBankFee: MonthlyFinancialAmount;
  internalTransferTotal: MonthlyFinancialAmount;
  partialAccounts: MonthlyFinancialBankAccountCode[];
  reviewRequiredCount: number;
  unclassifiedCount: number;
  conflictCount: number;
  updatedAt: string | null;
}

export type MonthlyFinancialSourceStatus =
  | "ready"
  | "empty"
  | "missing"
  | "changed";

export interface MonthlyFinancialSourceSummary {
  key: MonthlyFinancialSourceKey | string;
  status: MonthlyFinancialSourceStatus;
  recordCount: number;
  amount: MonthlyFinancialAmount;
  lastUpdatedAt: string | null;
  message: string | null;
}

export interface MonthlyFinancialValidationIssue {
  code: string;
  message: string;
}

export interface MonthlyFinancialPermissions {
  canEdit: boolean;
  canRefresh: boolean;
  canSubmitReview: boolean;
  canClose: boolean;
  canReopen: boolean;
  canDownload: boolean;
}

export interface MonthlyFinancialReport {
  month: string;
  status: MonthlyFinancialReportStatus;
  version: number;
  snapshotVersion: number | null;
  isFirstMonth: boolean;
  generatedAt: string;
  savedAt: string | null;
  closedAt: string | null;
  closedByName: string | null;
  reopenedAt: string | null;
  accounts: MonthlyFinancialAccountSummary[];
  income: MonthlyFinancialIncomeSummary;
  expenses: MonthlyFinancialExpenseSummary;
  automaticDetails: MonthlyFinancialAutomaticDetail[];
  bank?: MonthlyFinancialAutomaticBankSummary;
  totals: MonthlyFinancialTotals;
  manualItems: MonthlyFinancialManualItem[];
  sources: MonthlyFinancialSourceSummary[];
  validations: {
    canClose: boolean;
    blockers: MonthlyFinancialValidationIssue[];
    warnings: MonthlyFinancialValidationIssue[];
  };
  permissions: MonthlyFinancialPermissions;
}

export interface MonthlyFinancialReportSummary {
  month: string;
  status: MonthlyFinancialReportStatus;
  isEstimate: boolean;
  closingTotal: MonthlyFinancialAmount;
  mainReceipt: MonthlyFinancialAmount;
  totalExpense: MonthlyFinancialAmount;
  netChange: MonthlyFinancialAmount;
  accounts: MonthlyFinancialAccountSummary[];
  issues: MonthlyFinancialValidationIssue[];
  generatedAt: string;
}

export interface MonthlyFinancialTrendPoint {
  month: string;
  status: MonthlyFinancialReportStatus | null;
  valueState: "closed" | "current" | null;
  actualReceipt: MonthlyFinancialAmount | null;
  settlementInflow: MonthlyFinancialAmount | null;
  totalOutflow: MonthlyFinancialAmount | null;
  netChange: MonthlyFinancialAmount | null;
  closingTotal: MonthlyFinancialAmount | null;
  accountClosing: Record<
    MonthlyFinancialAccountCode,
    MonthlyFinancialAmount | null
  >;
}

export interface MonthlyFinancialTrendWarning {
  code: string;
  message: string;
  months: string[];
}

export interface MonthlyFinancialTrendData {
  from: string;
  to: string;
  availableYears: number[];
  points: MonthlyFinancialTrendPoint[];
  warnings: MonthlyFinancialTrendWarning[];
}

export type MonthlyFinancialOpeningBalances = Partial<
  Record<MonthlyFinancialAccountCode, MonthlyFinancialAmount>
>;

export interface MonthlyFinancialClosePayload {
  expectedVersion: number;
  negativeBalanceConfirmed?: boolean;
  note?: string;
}
