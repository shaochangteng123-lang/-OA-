export type FinancialAnalysisGranularity = "month" | "quarter" | "year";
export type FinancialAnalysisModuleKey =
  | "balances"
  | "inflow"
  | "outflow"
  | "projects"
  | "settlement"
  | "business"
  | "personnel";

export interface FinancialAnalysisQuery {
  from: string;
  to: string;
  granularity: FinancialAnalysisGranularity;
  partyA?: string;
  contractRegion?: string;
  reimbursementScope?: string;
  personId?: string;
  comparisonYear?: number;
}

export interface FinancialAnalysisPeriod {
  key: string;
  label: string;
  from: string;
  to: string;
}

export interface FinancialAnalysisValue {
  key: string;
  label: string;
  amount: string | null;
  note?: string;
  unit?: "元" | "个" | "组";
}

export interface FinancialAnalysisSeriesSegment {
  key: string;
  label: string;
  values: Array<string | null>;
  region: string;
  serviceUnit: string;
  /** 与 periods 一一对应；空数组表示该期确实没有新签项目，null 表示来源未知。 */
  projectNames?: Array<string[] | null>;
}

export interface FinancialAnalysisSeries {
  key: string;
  label: string;
  values: Array<string | null>;
  /** 对应期间已核验的金额小计；完整值非空时通常与values相同。 */
  knownValues?: Array<string | null>;
  unit?: "元" | "个" | "组";
  /** 与期间一一对应；true表示金额仅为已知分类合计，未知项未按零处理。 */
  partial?: boolean[];
  /** 同一逻辑指标按可靠业务维度拆出的多条折线。 */
  segments?: FinancialAnalysisSeriesSegment[];
}

export interface FinancialAnalysisColumn {
  key: string;
  label: string;
  format: "text" | "amount" | "number";
}

export interface FinancialAnalysisDetail {
  id: string;
  [key: string]: string | null;
}

/** 项目期间回款的独立凭证清单，不改变通用明细的字符串单元格类型。 */
export interface FinancialAnalysisProjectReceipt {
  rootContractId: string;
  receiptId: string;
  periodKey: string;
  from: string;
  to: string;
  projectNumber: string | null;
  projectNumberSource: string;
  receiptDate: string;
  amount: string;
  receiptNumber: string | null;
  receiptNumberSource: "electronic_receipt_no" | "proof_no" | null;
  transactionSerialNo: string | null;
  bankName: string | null;
  fileName: string | null;
  mimeType: string | null;
  previewUrl: string | null;
  previewUnavailableReason: string | null;
}

export interface FinancialAnalysisModule {
  key: FinancialAnalysisModuleKey;
  title: string;
  payrollDetailsVisible?: boolean;
  description: string;
  sourceLabel: string;
  updatedAt: string | null;
  periods: FinancialAnalysisPeriod[];
  series: FinancialAnalysisSeries[];
  summaries: FinancialAnalysisValue[];
  breakdown: FinancialAnalysisValue[];
  comparison: FinancialAnalysisValue[];
  columns: FinancialAnalysisColumn[];
  details: FinancialAnalysisDetail[];
  /** 每人员、每自然年仅一行，独立于月／季清单，避免年度金额重复累计。 */
  personnelAnnualDetails?: FinancialAnalysisDetail[];
  /** 全历史未归期报销独立列示，不属于任何月／季／年费用合计。 */
  personnelUnassignedReimbursements?: FinancialAnalysisPersonnelUnassignedReimbursement[];
  personnelReimbursementBasis?: "reimbursement-month" | "payment-month";
  /** 公司所选统计期间的住房成本组成；不能与个人分摊合计再次相加。 */
  housingCostBreakdown?: FinancialAnalysisHousingCostValue[];
  housingCostBasis?: "invoice-lease";
  chartMetricKeys?: string[];
  outflowReimbursementBasis?: "reimbursement-month" | "payment-month";
  businessReimbursementBasis?: "reimbursement-month" | "payment-month";
  projectReceipts?: FinancialAnalysisProjectReceipt[];
  warnings: string[];
  appliedFilters: string[];
}

export interface FinancialAnalysisHousingCostValue {
  key:
    | "rent"
    | "property_management"
    | "electricity"
    | "system_maintenance"
    | "other_cost";
  label: string;
  amount: string | null;
  knownAmount: string | null;
  note?: string;
}

export interface FinancialAnalysisPersonnelUnassignedReimbursement {
  sourceId: string;
  type: "basic" | "large" | "business";
  amount: string;
  date: string | null;
  status: string;
  personId: string | null;
  personName: string;
  month?: string | null;
  reason?: string;
}

export interface MonthlyFinancialAnalysisData {
  query: FinancialAnalysisQuery;
  generatedAt: string;
  dataVersion?: string;
  filterOptions: {
    parties: string[];
    contractRegions: string[];
    reimbursementScopes: string[];
    people: Array<{ id: string; name: string }>;
  };
  modules: FinancialAnalysisModule[];
  warnings: string[];
  comparison?: {
    label: string;
    query: FinancialAnalysisQuery;
    modules: FinancialAnalysisModule[];
    warnings: string[];
  };
}
