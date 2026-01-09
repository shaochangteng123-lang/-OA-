// 数据库表类型定义

export interface User {
  id: string
  feishu_open_id: string
  feishu_union_id: string | null
  name: string
  email: string | null
  mobile: string | null
  avatar_url: string | null
  role: 'super_admin' | 'admin' | 'user' | 'guest'
  status: 'active' | 'inactive'
  department: string | null
  position: string | null
  created_at: string
  updated_at: string
  last_login_at: string | null
}

export interface UserRow extends User {}

export interface Project {
  id: string
  name: string
  district: string
  project_type: string
  implementation_type: string
  status: 'active' | 'completed' | 'archived'
  start_date: string | null
  report_specialist: string
  report_specialist_phone: string
  project_manager: string
  project_manager_phone: string
  description: string | null
  current_task: string | null
  user_id: string
  created_at: string
  updated_at: string
}

export interface WorkLog {
  id: string
  date: string
  title: string | null
  overall_content: string | null
  projects_json: string | null
  user_id: string
  created_at: string
  updated_at: string
}

export interface EventLibrary {
  id: string
  name: string
  description: string | null
  event_type: string
  level: number
  standard_duration: number | null
  dependencies: string | null
  department_id: string | null
  created_at: string
  updated_at: string
}

export interface EventPreset {
  id: string
  name: string
  implementation_type: string
  project_type: string
  events_json: string | null
  blocks_json: string | null
  is_default: number
  created_at: string
  updated_at: string
}

export interface UserPreferencesRow {
  user_id: string
  theme: 'light' | 'dark' | 'auto'
  language: string
  event_colors: string | null
  color_labels: string | null
  calendar_view_mode: 'week' | 'month' | 'day'
  week_display_days: number
}

export interface UserActivityRow {
  id: string
  user_id: string
  action: string
  description: string | null
  metadata_json: string | null
  ip_address: string | null
  user_agent: string | null
  timestamp: string
}

export interface Draft {
  id: string
  user_id: string
  date: string
  pages_json: string
  created_at: string
  updated_at: string
}

export interface BlockCategory {
  id: string
  name: string
  description: string | null
  sort_order: number
  is_active: number
  created_at: string
  updated_at: string
}

export interface EventBlock {
  id: string
  name: string
  category_id: string | null
  description: string | null
  events_json: string | null
  created_at: string
  updated_at: string
}

export interface CalendarEvent {
  id: string
  title: string
  description: string | null
  start_time: string
  end_time: string
  all_day: number
  location: string | null
  color: string
  reminder_minutes: number | null
  recurrence_rule: string | null
  user_id: string
  created_at: string
  updated_at: string
}

export interface GovernmentDepartment {
  id: string
  full_name: string
  short_names: string
  website_url: string | null
  sort_order: number
  is_active: number
  created_at: string
  updated_at: string
}
