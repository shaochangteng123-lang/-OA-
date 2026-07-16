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
  contribution_base: string;
  individual_income_tax: string;
  monthly_salary_is_manual: boolean;
  contribution_base_is_manual: boolean;
  tax_is_manual: boolean;
  salary_recognized: boolean;
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
  updated_at: string;
}

export type PayrollAmountField =
  | "monthly_salary"
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

export interface PayrollResponse {
  month: string;
  list: PayrollRow[];
  totals: Record<PayrollAmountField, string>;
}

export async function getPayroll(month: string): Promise<PayrollResponse> {
  const response = await api.get("/api/payroll", { params: { month } });
  return response.data.data;
}

export async function updatePayrollField(
  month: string,
  employeeId: string,
  field: "monthly_salary" | "contribution_base" | "individual_income_tax",
  value: string,
): Promise<PayrollRow> {
  const response = await api.patch(`/api/payroll/${month}/${employeeId}`, {
    [field]: value,
  });
  return response.data.data;
}
