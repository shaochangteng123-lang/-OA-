export type MonthlyFinancialAmount = string;

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
}

export type MonthlyFinancialSourceKey =
  | "contract_receipts"
  | "payroll"
  | "reimbursements"
  | "asset_payments";

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

export type MonthlyFinancialOpeningBalances = Partial<
  Record<MonthlyFinancialAccountCode, MonthlyFinancialAmount>
>;

export interface MonthlyFinancialClosePayload {
  expectedVersion: number;
  negativeBalanceConfirmed?: boolean;
  note?: string;
}
