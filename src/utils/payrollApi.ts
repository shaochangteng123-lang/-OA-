import { api } from "@/utils/api";

export interface PayrollRow {
  id: string;
  employee_id: string;
  employee_no: string | null;
  employee_name: string;
  department: string | null;
  position: string | null;
  contract_end_date: string | null;
  initial_monthly_salary: string | null;
  automatic_salary: string;
  monthly_salary: string;
  housing_fund_base: string;
  contribution_base: string;
  individual_income_tax: string;
  monthly_salary_is_manual: boolean;
  housing_fund_base_is_manual: boolean;
  contribution_base_is_manual: boolean;
  tax_is_manual: boolean;
  salary_recognized: boolean;
  version: number;
  company_pension: string;
  company_medical: string;
  company_unemployment: string;
  company_injury: string;
  company_social_total: string;
  company_housing_fund: string;
  company_paid_total: string;
  withheld_social: string;
  withheld_housing_fund: string;
  withheld_tax: string;
  withheld_total: string;
  personal_pension: string;
  personal_medical: string;
  personal_unemployment: string;
  personal_social_total: string;
  personal_housing_fund: string;
  net_salary: string;
  salary_receipts: SalaryReceiptLink[];
  updated_at: string;
}

export interface SalaryReceiptLink {
  id: string;
  receipt_id: string;
  employee_id: string;
  payee_name: string;
  amount: string;
  page_no: number;
  position: "single" | "full" | "top" | "bottom" | "unknown";
  file_name: string;
  source: "human_cost" | "monthly_bank";
  transaction_id: string | null;
  electronic_receipt_no: string | null;
  transaction_date: string | null;
  previous_receipt_item_id: string | null;
  previous_file_name: string | null;
}

export type PayrollAmountField =
  | "monthly_salary"
  | "housing_fund_base"
  | "contribution_base"
  | "company_pension"
  | "company_medical"
  | "company_unemployment"
  | "company_injury"
  | "company_social_total"
  | "company_housing_fund"
  | "company_paid_total"
  | "withheld_social"
  | "withheld_housing_fund"
  | "withheld_tax"
  | "withheld_total"
  | "personal_pension"
  | "personal_medical"
  | "personal_unemployment"
  | "personal_social_total"
  | "personal_housing_fund"
  | "individual_income_tax"
  | "net_salary";

export type PayrollTotals = Record<PayrollAmountField, string> & {
  cost_total: string;
};

export interface PayrollResponse {
  month: string;
  list: PayrollRow[];
  totals: PayrollTotals;
}

export type HumanCostReceiptCategory =
  | "social_security"
  | "housing_fund"
  | "income_tax"
  | "net_salary";

export type HumanCostReceiptStatus =
  | "processing"
  | "recognized"
  | "partial"
  | "failed";

export interface HumanCostReceipt {
  id: string;
  payroll_month: string;
  category: HumanCostReceiptCategory;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: "application/pdf" | "image/jpeg" | "image/png";
  recognized_amount: string;
  recognition_status: HumanCostReceiptStatus;
  recognized_item_count: number;
  total_item_count: number;
  ignored_item_count: number;
  recognition_version: number;
  matched_employee_count: number;
  unmatched_employee_count: number;
  audit_locked: boolean;
  recognition_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlySalaryBankReceipt {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: "application/pdf";
  recognition_status: string;
  total_item_count: number;
  linked_item_count: number;
  conflict_item_count: number;
  recognized_amount: string;
  updated_at: string;
}

export interface PayrollTaxDetailFile {
  id: string;
  payroll_month: string;
  file_name: string;
  file_size: number;
  mime_type: "application/pdf" | "image/jpeg" | "image/png";
  recognized_count: number;
  zero_count: number;
  missing_employee_names: string[];
  unreadable_employee_names: string[];
  page_count: number;
  created_at: string;
  updated_at: string;
}

export interface HumanCostReceiptSummary {
  month: string;
  list: HumanCostReceipt[];
  totals: Record<HumanCostReceiptCategory, string>;
  processing_count: number;
  monthly_salary_bank: MonthlySalaryBankReceipt | null;
  tax_detail: PayrollTaxDetailFile | null;
  accepted_count?: number;
  duplicates?: string[];
}

export interface PayrollTaxDetailResult extends PayrollTaxDetailFile {
  payroll: PayrollResponse;
}

export async function getPayroll(month: string): Promise<PayrollResponse> {
  const response = await api.post("/api/payroll/generate", { month });
  return response.data.data;
}

export async function updatePayrollField(
  month: string,
  employeeId: string,
  field:
    | "monthly_salary"
    | "housing_fund_base"
    | "contribution_base"
    | "individual_income_tax",
  value: string,
  version: number,
): Promise<PayrollRow> {
  const response = await api.patch(`/api/payroll/${month}/${employeeId}`, {
    [field]: value,
    version,
  });
  return response.data.data;
}

export async function getHumanCostReceipts(
  month: string,
): Promise<HumanCostReceiptSummary> {
  const response = await api.get("/api/payroll/receipts", {
    params: { month },
  });
  return response.data.data;
}

export async function uploadHumanCostReceipts(
  month: string,
  category: HumanCostReceiptCategory,
  files: File[],
): Promise<HumanCostReceiptSummary> {
  const formData = new FormData();
  formData.append("month", month);
  formData.append("category", category);
  formData.append(
    "originalNames",
    JSON.stringify(files.map((file) => file.name)),
  );
  for (const file of files) formData.append("files", file);

  const response = await api.post("/api/payroll/receipts", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
}

export async function uploadPayrollTaxDetail(
  month: string,
  file: File,
): Promise<PayrollTaxDetailResult> {
  const formData = new FormData();
  formData.append("month", month);
  formData.append("originalName", file.name);
  formData.append("file", file);

  const response = await api.post("/api/payroll/tax-details", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.data;
}

export async function deleteHumanCostReceipt(receiptId: string): Promise<void> {
  await api.delete(`/api/payroll/receipts/${receiptId}`);
}

export function getHumanCostReceiptPreviewUrl(receiptId: string): string {
  return `/api/files/human-cost-receipts/${receiptId}`;
}

export function getPayrollTaxDetailPreviewUrl(fileId: string): string {
  return `/api/files/payroll-tax-details/${fileId}`;
}

export function getSalaryReceiptItemPreviewUrl(
  receipt: Pick<SalaryReceiptLink, "id" | "source" | "transaction_id">,
): string {
  return receipt.source === "monthly_bank"
    ? `/api/files/monthly-salary-receipts/${receipt.transaction_id || receipt.id}`
    : `/api/files/human-cost-receipt-items/${receipt.id}`;
}

export function getMonthlySalaryBankFilePreviewUrl(fileId: string): string {
  return `/api/files/monthly-salary-files/${fileId}`;
}

export function getPreviousSalaryReceiptItemPreviewUrl(itemId: string): string {
  return `/api/files/human-cost-receipt-items/${itemId}`;
}
