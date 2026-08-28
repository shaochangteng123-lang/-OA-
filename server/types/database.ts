// 数据库表类型定义

export interface User {
  id: string;
  username: string | null;
  password_hash: string | null;
  name: string;
  email: string | null;
  mobile: string | null;
  avatar_url: string | null;
  role:
    | "super_admin"
    | "chairman"
    | "admin"
    | "general_manager"
    | "boss"
    | "user"
    | "guest";
  status: "active" | "inactive";
  department: string | null;
  position: string | null;
  employee_no: string | null;
  bank_account_name: string | null;
  bank_account_phone: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  force_change_password: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export type UserRow = User;

export interface UserSignature {
  user_id: string;
  signature_path: string;
  created_at: string;
  updated_at: string;
}

export interface UserDelegatedSignature {
  user_id: string;
  represented_user_id: string | null;
  represented_user_name: string;
  signature_path: string;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  district: string;
  project_type: string;
  implementation_type: string;
  status: "active" | "completed" | "archived";
  start_date: string | null;
  report_specialist: string;
  report_specialist_phone: string;
  project_manager: string;
  project_manager_phone: string;
  description: string | null;
  requires_auxiliary_materials: boolean;
  current_task: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkLog {
  id: string;
  date: string;
  title: string | null;
  overall_content: string | null;
  projects_json: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface EventLibrary {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  level: number;
  standard_duration: number | null;
  dependencies: string | null;
  department_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventPreset {
  id: string;
  name: string;
  implementation_type: string;
  project_type: string;
  events_json: string | null;
  blocks_json: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserPreferencesRow {
  user_id: string;
  theme: "light" | "dark" | "auto";
  language: string;
  event_colors: string | null;
  color_labels: string | null;
  calendar_view_mode: "week" | "month" | "day";
  week_display_days: number;
}

export interface UserActivityRow {
  id: string;
  user_id: string;
  action: string;
  description: string | null;
  metadata_json: string | null;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: string;
}

export interface Draft {
  id: string;
  user_id: string;
  date: string;
  pages_json: string;
  created_at: string;
  updated_at: string;
}

export interface BlockCategory {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventBlock {
  id: string;
  name: string;
  category_id: string | null;
  description: string | null;
  events_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  all_day: boolean;
  location: string | null;
  color: string;
  reminder_minutes: number | null;
  recurrence_rule: string | null;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface GovernmentDepartment {
  id: string;
  full_name: string;
  short_names: string;
  website_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 合同全生命周期模块
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
export type ContractAssetCategory =
  | "procurement"
  | "software"
  | "equipment"
  | "house_rental"
  | "vehicle_rental"
  | "parking_space"
  | "office_asset"
  | "other";
export type ContractDepositStatus =
  | "pending_payment"
  | "active"
  | "partially_settled"
  | "settled";
export type ContractDepositSettlementType =
  | "refund"
  | "deduction"
  | "rent_offset";
export type ContractDepositFundingSource =
  | "engineering_allocation"
  | "technology_self_funded"
  | "mixed"
  | "pending_review";
export type ContractPaymentPurpose = "contract_payment" | "lease_deposit";
export type ContractRelationType = "main" | "supplement" | "termination";
export type ContractSupplementChangeType =
  | "payment_terms_only"
  | "amount_adjustment"
  | "amount_and_payment"
  | "legacy_unresolved";
export type ContractLifecycleStatus =
  | "draft"
  | "approving"
  | "pending_seal"
  | "effective"
  | "executing"
  | "completed"
  | "rejected"
  | "terminated";

export interface Contract {
  id: string;
  contract_no: string | null;
  business_contract_no: string | null;
  title: string | null;
  description: string | null;
  declared_category: ContractCategory | null;
  declared_subtype: ContractDeclaredSubtype | null;
  category: ContractCategory | null;
  asset_category: ContractAssetCategory | null;
  relation_type: ContractRelationType;
  status: ContractLifecycleStatus;
  area: string;
  project_id: string | null;
  parent_contract_id: string | null;
  root_contract_id: string | null;
  termination_target_contract_id?: string | null;
  renewed_from_contract_id: string | null;
  renewed_from_lease_end_date: string | null;
  party_a: string | null;
  party_b: string | null;
  project_name: string | null;
  amount_delta: number | null;
  original_contract_amount: number | null;
  recognized_original_amount: number | null;
  recognized_final_amount: number | null;
  amount_before_change: number | null;
  amount_after_change: number | null;
  current_effective_amount: number | null;
  supplement_change_type: ContractSupplementChangeType | null;
  supplement_sequence: number | null;
  contract_date: string | null;
  contract_date_source: "ocr" | "manual" | "upload_date" | null;
  financial_direction: "income" | "cost" | null;
  financial_direction_source: "contract_category" | "invoice" | null;
  financial_direction_invoice_id: string | null;
  financial_direction_confirmed_by: string | null;
  financial_direction_confirmed_at: string | null;
  financial_direction_version: number;
  pending_action: "seal" | "termination" | null;
  previous_status: ContractLifecycleStatus | null;
  version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractDeposit {
  id: string;
  contract_id: string;
  amount: number;
  clause_text: string | null;
  basis: string | null;
  payment_purpose: "lease_deposit";
  funding_source: ContractDepositFundingSource;
  engineering_allocation_amount: number;
  technology_self_funded_amount: number;
  payment_record_id: string | null;
  external_payment_record_id: string | null;
  paid_at: string | null;
  note: string | null;
  status: ContractDepositStatus;
  settled_amount: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface ContractDepositSettlement {
  id: string;
  deposit_id: string;
  contract_id: string;
  settlement_type: ContractDepositSettlementType;
  amount: number;
  settlement_date: string;
  note: string | null;
  engineering_return_required_amount: number;
  engineering_returned_amount: number;
  engineering_returned_at: string | null;
  engineering_return_note: string | null;
  engineering_returned_by: string | null;
  created_by: string;
  created_at: string;
}

export type ContractDepositSettlementReceiptKind =
  | "deposit_refund"
  | "engineering_return";

export interface ContractDepositSettlementReceipt {
  id: string;
  settlement_id: string;
  contract_id: string;
  receipt_kind: ContractDepositSettlementReceiptKind;
  amount: number;
  transaction_date: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: "image/jpeg" | "image/png" | "application/pdf";
  file_hash: string;
  file_id: string | null;
  financial_ocr_job_id: string | null;
  electronic_receipt_no: string | null;
  payer: string | null;
  payer_account: string | null;
  payee: string | null;
  payee_account: string | null;
  recognition_method: string | null;
  ocr_engine_version: string | null;
  ocr_parser_version: string | null;
  evidence_text_hash: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface ContractPaymentPurposeDetail {
  id: string;
  contract_id: string;
  payment_record_id: string | null;
  external_payment_record_id: string | null;
  purpose: ContractPaymentPurpose;
  amount: number;
  funding_source: ContractDepositFundingSource;
  engineering_allocation_amount: number;
  technology_self_funded_amount: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export type ContractApprovalKind = "seal" | "termination" | "seal_difference";
export type ContractApprovalRoundStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "withdrawn";

export interface ContractApprovalRound {
  id: string;
  contract_id: string;
  approval_kind: ContractApprovalKind;
  status: ContractApprovalRoundStatus;
  initiator_id: string;
  initiator_role: string;
  target_approver_id: string;
  target_approver_name_snapshot: string;
  target_approver_role_snapshot: string;
  target_source: "project_owner" | "general_manager";
  project_id_snapshot: string | null;
  submitted_at: string;
  completed_at: string | null;
  completed_by: string | null;
  completed_action: "approve" | "reject" | "withdraw" | null;
  created_at: string;
  updated_at: string;
}

export interface ContractFile {
  id: string;
  contract_id: string;
  file_type: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  file_hash: string;
  version: number;
  is_current: boolean;
  uploaded_by: string;
  created_at: string;
}

export interface ContractOcrJob {
  id: string;
  contract_id: string;
  file_id: string;
  status: "queued" | "processing" | "succeeded" | "partial" | "failed";
  method: string | null;
  engine_version: string | null;
  parser_version: string | null;
  retry_count: number;
  raw_text: string | null;
  warnings_json: string[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractOcrLine {
  id: string;
  job_id: string;
  contract_id: string;
  line_index: number;
  page_number: number;
  text: string;
  bbox: number[][];
  confidence: number;
  model_version: string;
  created_at: string;
}

export interface ContractOcrField {
  id: string;
  job_id: string;
  contract_id: string;
  field_code: string;
  original_value: string | null;
  normalized_value: string | null;
  final_value: string | null;
  confidence: number;
  source: string;
  manually_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export type ContractSealVerificationStatus =
  | "infrastructure_failed"
  | "review_required"
  | "difference_explanation_required"
  | "difference_approving"
  | "difference_approved"
  | "ready_to_archive"
  | "archived"
  | "superseded";

export interface ContractSealVerification {
  id: string;
  contract_id: string;
  file_id: string;
  status: ContractSealVerificationStatus;
  upload_date: string;
  approved_snapshot_json: Record<string, unknown>;
  recognition_status: "succeeded" | "partial" | "failed";
  recognition_method: string | null;
  recognition_warnings_json: string[];
  raw_text: string | null;
  mismatches_json: Array<Record<string, unknown>>;
  infrastructure_failure: boolean;
  difference_explanation: string | null;
  approval_submitted_at: string | null;
  approval_completed_at: string | null;
  created_by: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  archived_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractFinancialOcrRecordKind = "invoice" | "receipt" | "payment";

export interface ContractFinancialOcrJob {
  id: string;
  contract_id: string;
  file_id: string;
  file_hash: string;
  record_kind: ContractFinancialOcrRecordKind;
  document_kind: "invoice" | "bank_receipt";
  status: "processing" | "verified" | "blocked" | "failed" | "consumed";
  validation_status: "verified" | "blocked" | "failed" | null;
  recognition_method: string | null;
  engine_version: string | null;
  parser_version: string | null;
  evidence_text_hash: string | null;
  direction:
    | "input"
    | "output"
    | "third_party"
    | "receipt"
    | "payment"
    | "unknown"
    | null;
  document_status: "normal" | "void" | "red" | "unknown" | null;
  can_auto_post: boolean;
  snapshot_json: Record<string, unknown>;
  blocking_reasons_json: Array<{
    code: string;
    message: string;
    field?: string;
  }>;
  warnings_json: string[];
  business_purpose:
    | "deposit_refund"
    | "engineering_return"
    | "engineering_internal_funding"
    | null;
  target_id: string | null;
  requested_by: string;
  record_id: string | null;
  started_at: string;
  finished_at: string | null;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractSealVerificationField {
  id: string;
  verification_id: string;
  contract_id: string;
  field_code: "party_a" | "party_b" | "amount" | "contract_date";
  approved_value: string | null;
  recognized_value: string | null;
  final_value: string | null;
  confidence: number;
  source: string;
  requires_manual_confirmation: boolean;
  manually_confirmed: boolean;
  is_mismatch: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ContractRateCode = "tax" | "marketing" | "business" | "financial";

export interface ContractRateConfig {
  id: string;
  rate_code: ContractRateCode;
  rate_value: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_by: string | null;
  change_reason: string | null;
  created_at: string;
  updated_at: string;
}

// 审批流程配置
export interface ApprovalFlow {
  id: string;
  name: string;
  type: string; // worklog, reimbursement_basic, reimbursement_large, reimbursement_business, leave
  steps_json: string; // JSON数组
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 审批流程步骤（JSON解析后的类型）
export interface ApprovalStep {
  step: number;
  name: string;
  approver_type: "role" | "user" | "department";
  approver_value: string;
}

// 审批实例
export interface ApprovalInstance {
  id: string;
  flow_id: string | null;
  type: string;
  target_id: string;
  target_type: string; // worklog, reimbursement
  applicant_id: string;
  current_step: number;
  status: "pending" | "approved" | "rejected" | "cancelled" | "withdrawn";
  submit_time: string;
  complete_time: string | null;
  created_at: string;
  updated_at: string;
}

// 审批记录
export interface ApprovalRecord {
  id: string;
  instance_id: string;
  step: number;
  approver_id: string;
  action:
    | "approve"
    | "reject"
    | "comment"
    | "payment_uploaded"
    | "payment_proof_replaced"
    | "resubmit";
  comment: string | null;
  action_time: string;
}

// 员工基础信息
export interface EmployeeProfile {
  id: string;
  user_id: string | null;
  employee_no: string | null;
  name: string;
  gender: "male" | "female" | "other" | null;
  birth_date: string | null;
  id_number: string | null;
  native_place: string | null;
  ethnicity: string | null;
  marital_status: "single" | "married" | "divorced" | "widowed" | null;
  education: string | null;
  school: string | null;
  major: string | null;
  mobile: string | null;
  email: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  address: string | null;
  hire_date: string | null;
  contract_end_date: string | null;
  contract_template_start_date: string | null;
  contract_template_end_date: string | null;
  probation_template_start_date: string | null;
  probation_template_end_date: string | null;
  last_contract_template_start_date: string | null;
  last_contract_template_end_date: string | null;
  last_probation_template_start_date: string | null;
  last_probation_template_end_date: string | null;
  last_contract_template_position: string | null;
  department: string | null;
  position: string | null;
  bank_account_name: string | null;
  bank_account_phone: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  status: "draft" | "submitted"; // 入职信息提交状态
  employment_status: "active" | "probation" | "resigned" | "on_leave" | null; // 在职状态
  created_at: string;
  updated_at: string;
}

// 员工档案文件类型
export type EmployeeDocumentType =
  | "invitation" // 入职邀请函
  | "application" // 新员工入职申请表
  | "contract" // 劳动合同书
  | "nda" // 保密协议
  | "declaration" // 个人声明
  | "asset_handover" // 2025年度公司电脑管理办法
  | "id_card" // 身份证复印件
  | "health_report" // 入职体检报告
  | "diploma" // 学历证书复印件
  | "bank_card" // 工资卡复印件
  | "other"; // 其他员工提供资料

// 员工档案文件
export interface EmployeeDocument {
  id: string;
  employee_id: string;
  document_type: EmployeeDocumentType;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  contract_start_date: string | null;
  contract_end_date: string | null;
  contract_recognized_at: string | null;
  probation_end_date: string | null;
  created_at: string;
}

// 转正申请状态
export type ProbationStatus = "pending" | "submitted" | "approved" | "rejected";
export type ProbationReviewStage =
  | "employee"
  | "supervisor"
  | "hr"
  | "general_manager"
  | "completed";
export type ProbationConversionType = "normal" | "early" | "extended" | "other";

// 转正申请
export interface ProbationConfirmation {
  id: string;
  employee_id: string;
  hire_date: string | null;
  probation_end_date: string | null;
  status: ProbationStatus;
  form_version: number;
  review_stage: ProbationReviewStage;
  conversion_type: ProbationConversionType;
  conversion_type_other: string | null;
  self_statement: string | null;
  applicant_name_snapshot: string | null;
  department_snapshot: string | null;
  position_snapshot: string | null;
  supervisor_id: string | null;
  supervisor_name_snapshot: string | null;
  hr_approver_id: string | null;
  hr_approver_name_snapshot: string | null;
  chairman_id: string | null;
  chairman_name_snapshot: string | null;
  submit_time: string | null;
  approve_time: string | null;
  approver_id: string | null;
  approver_comment: string | null;
  application_comment: string | null;
  formal_document_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

// 转正申请（带员工信息）
export interface ProbationConfirmationWithEmployee extends ProbationConfirmation {
  employee_name: string;
  employee_department: string | null;
  employee_position: string | null;
  employee_mobile: string | null;
}

// 转正文件类型
export type ProbationDocumentType = "application"; // 转正申请书

// 转正文件
export interface ProbationDocument {
  id: string;
  confirmation_id: string | null;
  employee_id: string | null;
  document_type: ProbationDocumentType;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  source_type: "uploaded" | "generated" | "official";
  form_version: number;
  created_at: string;
}

export interface ProbationSignatureRecord {
  id: string;
  confirmation_id: string;
  form_version: number;
  stage: Exclude<ProbationReviewStage, "completed">;
  signer_id: string;
  signer_name: string;
  signer_role: string;
  signer_department: string | null;
  signer_position: string | null;
  signature_path: string;
  signature_type: "personal" | "general_manager";
  signature_owner_name: string;
  opinion: string | null;
  decision: "submit" | "approve" | "reject";
  signed_at: string;
  created_at: string;
}

export interface ProbationHistoryRecord {
  id: string;
  employee_id: string;
  confirmation_id: string | null;
  hire_date: string | null;
  probation_end_date: string | null;
  status: ProbationStatus | null;
  submit_time: string | null;
  approve_time: string | null;
  approver_id: string | null;
  approver_comment: string | null;
  application_comment: string | null;
  reset_reason: string | null;
  reset_by: string | null;
  reset_at: string;
  new_hire_date: string | null;
  form_version: number;
  review_stage: ProbationReviewStage;
  approval_records_json: string | null;
  signature_history_json: string | null;
  created_at: string;
}

// 转正文件模板
export interface ProbationTemplate {
  id: string;
  name: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  created_at: string;
}

// 离职申请状态
export type ResignationStatus =
  | "draft"
  | "pending_confirmation"
  | "submitted"
  | "handover_confirmed"
  | "mutual_confirmed"
  | "approved"
  | "rejected"
  | "handover_rejected"; // 仅驳回给交接人，离职人无感知

// 离职类型
export type ResignationType = "voluntary" | "contract_end" | "dismissal";

// 离职申请
export interface ResignationRequest {
  id: string;
  employee_id: string;
  employee_user_id: string | null;
  handover_user_id: string | null;
  handover_name: string | null;
  resign_type: ResignationType;
  resign_date: string;
  reason: string | null;
  status: ResignationStatus;
  reject_target: "employee" | "handover" | "both" | null;
  employee_confirm_time: string | null;
  handover_confirm_time: string | null;
  submit_time: string | null;
  approve_time: string | null;
  approver_id: string | null;
  approver_comment: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResignationRequestWithEmployee extends ResignationRequest {
  employee_name: string;
  employee_department: string | null;
  employee_position: string | null;
  employee_mobile: string | null;
}

export type ResignationDocumentType =
  | "application_form"
  | "handover_form_employee"
  | "handover_form_handover"
  | "termination_proof"
  | "asset_handover"
  | "compensation_agreement"
  | "expense_settlement_agreement"
  | "termination_agreement"
  | "employee_handover_form"
  | "settlement_confirmation"
  | "resignation_certificate";

export type ResignationTemplateType =
  | "application_form"
  | "handover_form"
  | "termination_proof"
  | "asset_handover"
  | "compensation_agreement"
  | "expense_settlement_agreement"
  | "partner_dividend_settlement"
  | "termination_agreement"
  | "employee_handover_form"
  | "settlement_confirmation"
  | "resignation_certificate";
export type ResignationUploaderRole = "employee" | "handover" | "admin";

// 离职附件
export interface ResignationDocument {
  id: string;
  request_id: string;
  document_type: ResignationDocumentType;
  uploader_role: ResignationUploaderRole;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  created_at: string;
  is_current: number;
}

// 离职模板
export interface ResignationTemplate {
  id: string;
  template_type: ResignationTemplateType;
  name: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface EmployeeResignationArchive {
  request: ResignationRequestWithEmployee | null;
  documents: ResignationDocument[];
  fallback_from_employee_status?: boolean;
}

export interface ResignationTemplateDraft {
  id: string;
  request_id: string;
  template_type: ResignationTemplateType;
  template_id: string | null;
  content_html: string;
  overlay_json: string | null;
  updated_by: string;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}
