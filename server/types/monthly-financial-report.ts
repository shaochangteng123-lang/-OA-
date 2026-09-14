export const FINANCIAL_ACCOUNT_CODES = [
  "general",
  "business",
  "welfare_one",
  "welfare_two",
] as const;

export type FinancialAccountCode = (typeof FINANCIAL_ACCOUNT_CODES)[number];

export const MONTHLY_FINANCIAL_MANUAL_CATEGORIES = [
  "general_interest",
  "business_interest",
  "general_bank_fee",
  "business_bank_fee",
  "general_tax_payment",
  "general_other",
  "welfare_one_supplement",
  "welfare_two_supplement",
  "welfare_one_407",
  "welfare_one_drinking_water",
  "welfare_one_office",
  "welfare_one_electricity",
  "welfare_one_407_ai",
  "welfare_one_8h_ai",
  "welfare_two_refreshment",
  "welfare_two_team_building",
  "welfare_two_physical_exam",
  "welfare_one_expense",
  "welfare_two_expense",
] as const;

export type MonthlyFinancialManualCategory =
  (typeof MONTHLY_FINANCIAL_MANUAL_CATEGORIES)[number];

export type MonthlyFinancialDirection = "income" | "expense";
export type MonthlyFinancialReportStatus = "draft" | "closed" | "reopened";

export interface MonthlyFinancialManualItemInput {
  id?: string;
  category: MonthlyFinancialManualCategory;
  accountCode: FinancialAccountCode;
  direction: MonthlyFinancialDirection;
  amount: string;
  occurredOn: string;
  description?: string | null;
  voucherReference?: string | null;
  welfareCategoryId?: string | null;
  welfareCategoryNameSnapshot?: string | null;
}

export interface MonthlyFinancialWelfareOneExpenseCategory {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  automaticAmount: string;
  manualAmount: string;
  totalAmount: string;
  isFixed: boolean;
}

export type MonthlyFinancialWelfareTwoExpenseCategory =
  MonthlyFinancialWelfareOneExpenseCategory;

export type FinancialAccountAmounts = Record<FinancialAccountCode, string>;

export interface MonthlyFinancialAnalysisMetadata {
  schemaVersion: 1;
  payrollParts?: {
    salary: string;
    social: string;
    housing: string;
    adjustment: string;
  };
  canonicalPersonId?: string | null;
  reimbursementCategory?: string | null;
  reimbursementScope?: string | null;
  reimbursementScopeValue?: string | null;
  reimbursementScopePath?: string | null;
  reimbursementRegion?: string | null;
  reimbursementRegionSource?: string | null;
  reimbursementServiceTarget?: string | null;
  welfareCategoryId?: string | null;
  welfareCategoryCode?: string | null;
  welfareCategoryName?: string | null;
  contractRootId?: string | null;
  partyA?: string | null;
  contractRegion?: string | null;
}

export interface MonthlyFinancialAutomaticSnapshot {
  income: {
    mainBusinessReceipts: string;
    tax: string;
    marketingReserve: string;
    businessCost: string;
    accountingBase: string;
  };
  expenses: {
    humanCost: string;
    basicReimbursement: string;
    largeReimbursement: string;
    businessReimbursement: string;
    assetAdministration: string;
  };
  sources: Array<{
    code: string;
    name: string;
    recordCount: number;
    amount: string;
    updatedAt: string | null;
    available: boolean;
    message: string | null;
  }>;
  details: Array<{
    sourceType: string;
    sourceId: string;
    occurredOn: string;
    accountCode: FinancialAccountCode;
    metric: string;
    amount: string;
    description: string;
    personId?: string | null;
    personName?: string | null;
    analysis?: MonthlyFinancialAnalysisMetadata;
    bankAccountCode?: "basic" | "general" | "business" | null;
    electronicReceiptNo?: string | null;
    previewUrl?: string | null;
    linkStatus?: "matched" | "conflict" | "unmatched" | null;
  }>;
  welfareOneExpenseCategories?: Array<{
    id: string;
    code: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    amount: string;
  }>;
  welfareTwoExpenseCategories?: Array<{
    id: string;
    code: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    amount: string;
  }>;
  bank?: {
    activeAccounts: Array<"basic" | "general" | "business">;
    chargeAccounts?: Array<"general" | "business">;
    generalInterest: string;
    businessInterest: string;
    generalBankFee: string;
    businessBankFee: string;
    internalTransferTotal: string;
    partialAccounts: Array<"basic" | "general" | "business">;
    reviewRequiredCount: number;
    unclassifiedCount: number;
    conflictCount: number;
    updatedAt: string | null;
  };
  generatedAt: string;
}

export interface MonthlyFinancialReportView {
  id: string | null;
  month: string;
  status: MonthlyFinancialReportStatus;
  version: number;
  lastRefreshedAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
  openingBalances: FinancialAccountAmounts;
  accounts: Array<{
    code: FinancialAccountCode;
    name: string;
    openingBalance: string;
    income: string;
    expense: string;
    closingBalance: string;
  }>;
  income: MonthlyFinancialAutomaticSnapshot["income"] & {
    generalInterest: string;
    businessInterest: string;
    welfareOneSupplementIncome: string;
    welfareTwoSupplementIncome: string;
  };
  expenses: MonthlyFinancialAutomaticSnapshot["expenses"] & {
    generalBankFee: string;
    businessBankFee: string;
    generalOtherExpense: string;
    generalTaxPayment: string;
    welfareOne407: string;
    welfareOneDrinkingWater: string;
    welfareOneOffice: string;
    welfareOneElectricity: string;
    welfareOne407Ai: string;
    welfareOne8hAi: string;
    welfareTwoRefreshment: string;
    welfareTwoTeamBuilding: string;
    welfareTwoHealthCheck: string;
  };
  manualItems: MonthlyFinancialManualItemInput[];
  welfareOneExpenseCategories: MonthlyFinancialWelfareOneExpenseCategory[];
  welfareTwoExpenseCategories: MonthlyFinancialWelfareTwoExpenseCategory[];
  sources: MonthlyFinancialAutomaticSnapshot["sources"];
  details: MonthlyFinancialAutomaticSnapshot["details"];
  warnings: Array<{ code: string; message: string; blocking: boolean }>;
  permissions: {
    canMaintain: boolean;
    canClose: boolean;
    canReopen: boolean;
    canDownload: boolean;
  };
}

export interface MonthlyFinancialTrendPoint {
  month: string;
  status: MonthlyFinancialReportStatus | null;
  valueState: "closed" | "current" | null;
  actualReceiptState: "closed" | "current" | "confirmed_source" | null;
  actualReceipt: string | null;
  settlementInflow: string | null;
  totalOutflow: string | null;
  netChange: string | null;
  closingTotal: string | null;
  accountClosing: Record<FinancialAccountCode, string | null>;
}

export interface MonthlyFinancialTrendWarning {
  code: string;
  message: string;
  months: string[];
}

export interface MonthlyFinancialMainBusinessTrendPoint {
  month: string;
  region: string;
  actualReceipt: string | null;
  contractAmount: string | null;
  contractCount: number | null;
}

export interface MonthlyFinancialTrendData {
  from: string;
  to: string;
  availableYears: number[];
  points: MonthlyFinancialTrendPoint[];
  mainBusinessRegions: string[];
  mainBusinessPoints: MonthlyFinancialMainBusinessTrendPoint[];
  warnings: MonthlyFinancialTrendWarning[];
}
