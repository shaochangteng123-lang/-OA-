// 前端类型定义

// ==================== 用户相关 ====================

export interface User {
  id: string
  username?: string
  name: string
  email: string
  mobile?: string
  avatarUrl: string | null
  role: UserRole
  status: 'active' | 'inactive'
  department?: string
  position?: string
  lastLoginAt?: string
  createdAt?: string
  updatedAt?: string
  forceChangePassword?: boolean
}

export type UserRole = 'super_admin' | 'admin' | 'general_manager' | 'user' | 'guest'

export type Permission =
  | 'view_worklogs'
  | 'create_worklog'
  | 'edit_worklog'
  | 'delete_worklog'
  | 'view_projects'
  | 'create_project'
  | 'edit_project'
  | 'delete_project'
  | 'view_events'
  | 'manage_events'
  | 'view_presets'
  | 'manage_presets'
  | 'view_users'
  | 'manage_users'
  | 'view_calendar'
  | 'manage_calendar'
  | 'view_blocks'
  | 'manage_blocks'
  | 'view_departments'
  | 'manage_departments'
  | 'system_settings'
  | 'view_worklog_entries'
  | 'manage_worklog_entries'
  | 'manage_worklog_dicts'

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    'view_worklogs',
    'create_worklog',
    'edit_worklog',
    'delete_worklog',
    'view_projects',
    'create_project',
    'edit_project',
    'delete_project',
    'view_events',
    'manage_events',
    'view_presets',
    'manage_presets',
    'view_users',
    'manage_users',
    'view_calendar',
    'manage_calendar',
    'view_blocks',
    'manage_blocks',
    'view_departments',
    'manage_departments',
    'system_settings',
    'view_worklog_entries',
    'manage_worklog_entries',
    'manage_worklog_dicts',
  ],
  admin: [
    'view_worklogs',
    'create_worklog',
    'edit_worklog',
    'delete_worklog',
    'view_projects',
    'create_project',
    'edit_project',
    'delete_project',
    'view_events',
    'manage_events',
    'view_presets',
    'manage_presets',
    'view_users',
    'manage_users',
    'view_calendar',
    'manage_calendar',
    'view_blocks',
    'manage_blocks',
    'view_departments',
    'view_worklog_entries',
    'manage_worklog_entries',
    'manage_worklog_dicts',
  ],
  general_manager: [
    'view_worklogs',
    'create_worklog',
    'edit_worklog',
    'delete_worklog',
    'view_projects',
    'create_project',
    'edit_project',
    'delete_project',
    'view_events',
    'manage_events',
    'view_presets',
    'manage_presets',
    'view_users',
    'view_calendar',
    'manage_calendar',
    'view_blocks',
    'manage_blocks',
    'view_departments',
    'view_worklog_entries',
    'manage_worklog_entries',
  ],
  user: [
    'view_worklogs',
    'create_worklog',
    'edit_worklog',
    'view_projects',
    'create_project',
    'edit_project',
    'view_events',
    'view_presets',
    'view_calendar',
    'view_blocks',
    'view_worklog_entries',
    'manage_worklog_entries',
  ],
  guest: ['view_worklogs', 'view_projects', 'view_events', 'view_presets', 'view_calendar', 'view_worklog_entries'],
}

// ==================== 项目相关 ====================

export interface Project {
  id: string
  name: string
  district: string
  projectType: string
  implementationType: string
  status: 'active' | 'completed' | 'archived'
  startDate?: string
  reportSpecialist: string
  reportSpecialistPhone: string
  projectManager: string
  projectManagerPhone: string
  clientContactName: string
  clientContactPhone: string
  description?: string
  currentTask?: string
  userId: string
  createdAt: string
  updatedAt: string
}

// ==================== 事件相关 ====================

export interface EventNode {
  id: string
  name: string
  description?: string
  eventType: string
  level: number
  standardDuration?: number
  dependencies?: string[]
  departmentId?: string
}

export interface PresetEvent {
  id: string
  name: string
  description?: string
  eventType: string
  level: number
  standardDuration?: number
  dependencies?: string[]
  departmentId?: string
}

export interface EventLibrary {
  id: string
  name: string
  description?: string
  eventType: string
  level: number
  standardDuration?: number
  dependencies?: string[]
  departmentId?: string
  createdAt: string
  updatedAt: string
}

export interface EventPreset {
  id: string
  name: string
  implementationType: string
  projectType: string
  events?: PresetEvent[]
  blocks?: any[]
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

// ==================== 工作日志相关 ====================

export interface WorkLog {
  id: string
  date: string
  title?: string
  overallContent?: string
  projects?: any[]
  userId: string
  createdAt: string
  updatedAt: string
}

// ==================== 项目日志 v2（结构化） ====================

export interface WorklogDictItem {
  id: string
  name: string
  standard_days?: number | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface WorklogProject {
  id: string
  name: string
  clientName: string
  clientContactName: string
  clientContactPhone: string
  district: string
  projectType: string
  ownerUserId: string
  ownerName: string
  ownerPosition?: string | null
  startDate: string
  isCompleted: boolean
  completedAt?: string | null
  contractStatus?: string | null
  contractTotalAmount?: number | null
  agencyBureau?: string | null
  agencyDepartment?: string | null
  agencyContactName?: string | null
  agencyContactPhone?: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  entryCount?: number
}

export interface WorklogContractProgress {
  id: string
  projectId: string
  status: string
  amount?: number | null
  note?: string | null
  createdBy: string
  createdByName: string
  createdAt: string
  attachments?: WorklogContractAttachment[]
}

export interface WorklogContractAttachment {
  id: string
  progressId: string
  fileKind: 'contract' | 'invoice' | 'receipt' | 'other'
  fileName: string
  filePath: string
  fileSize?: number | null
  mimeType?: string | null
  uploadedBy: string
  createdAt: string
}

export interface WorklogAttachment {
  id: string
  fileKind: 'image' | 'screenshot' | 'photo' | 'document'
  fileName: string
  filePath: string
  fileSize?: number | null
  mimeType?: string | null
  uploadedBy: string
  createdAt: string
}

export interface WorklogEntry {
  id: string
  logDate: string
  projectId: string
  projectName?: string
  clientName?: string
  district?: string
  clientContactName?: string
  clientContactPhone?: string
  projectType?: string
  agencyBureau?: string
  agencyDepartment?: string
  agencyContactName?: string
  agencyContactPhone?: string
  matter: string
  userId: string
  userName: string
  userPosition?: string | null
  ownerUserId: string
  ownerName: string
  contractStatus?: string | null
  contractNote?: string | null
  workNote?: string | null
  nextFollowUpDate?: string | null
  isFinalized: boolean
  finalizedAt?: string | null
  projectIsCompleted?: boolean
  createdAt: string
  updatedAt: string
  attachments?: WorklogAttachment[]
  progressNotes?: WorklogProgressNote[]
}

export interface WorklogProgressNote {
  id: string
  entryId: string
  content: string
  createdBy: string
  createdByName: string
  createdAt: string
  attachments?: WorklogAttachment[]
}

export interface WorklogGanttMatter {
  matter: string
  firstDate: string
  lastDate: string
  daysElapsed: number
  standardDays: number | null
  isOverdue: boolean
  isFinalized: boolean
  totalCount: number
}

export interface WorklogRiskAlert {
  projectId: string
  projectName: string
  district: string
  ownerName: string
  matter: string
  firstDate: string
  daysElapsed: number
  standardDays: number
  level: 'high' | 'medium'
  message: string
}

// ==================== 部门相关 ====================

export interface Department {
  id: string
  fullName: string
  shortNames: string[]
  websiteUrl?: string
  sortOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ==================== 用户偏好相关 ====================

export interface UserPreferences {
  userId: string
  theme: 'light' | 'dark' | 'auto'
  language: string
  eventColors?: Record<string, string>
  colorLabels?: any[]
  calendarViewMode?: 'week' | 'month' | 'day'
  weekDisplayDays?: number
}

// ==================== 区块相关 ====================

export interface EventBlock {
  id: string
  name: string
  categoryId: string
  description?: string
  standardDuration?: number
  events?: any[]
}

export interface BlockCategoryEntity {
  id: string
  name: string
  description?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface PresetBlockRef {
  blockId: string
  sortOrder: number
  customName?: string
}

// ==================== Element Plus 相关 ====================

export type ElementPlusTagType = 'success' | 'info' | 'warning' | 'danger' | 'primary'

// ==================== 员工基础信息相关 ====================

export interface EmployeeProfile {
  id: string
  userId?: string
  employeeNo?: string
  name: string
  gender?: 'male' | 'female' | 'other'
  birthDate?: string
  idNumber?: string
  nativePlace?: string
  ethnicity?: string
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed'
  education?: string
  school?: string
  major?: string
  mobile?: string
  email?: string
  emergencyContact?: string
  emergencyPhone?: string
  address?: string
  hireDate?: string
  department?: string
  position?: string
  status: 'draft' | 'submitted'
  createdAt: string
  updatedAt: string
}
