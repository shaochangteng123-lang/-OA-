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
  action: "approve" | "reject" | "comment" | "payment_uploaded" | "resubmit";
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
