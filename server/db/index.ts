import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'worklog.db')

console.log('📦 数据库路径:', dbPath)

export const db = new Database(dbPath)

// 启用外键约束
db.pragma('foreign_keys = ON')

// 初始化数据库表
export function initDatabase() {
  console.log('🔧 初始化数据库表...')

  // 1. users 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      feishu_open_id TEXT UNIQUE,
      feishu_union_id TEXT,
      name TEXT NOT NULL,
      email TEXT,
      mobile TEXT,
      avatar_url TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      department TEXT,
      position TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_feishu_open_id ON users(feishu_open_id);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
  `)

  // 2. projects 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      district TEXT NOT NULL,
      project_type TEXT NOT NULL,
      implementation_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT,
      report_specialist TEXT NOT NULL,
      report_specialist_phone TEXT NOT NULL,
      project_manager TEXT NOT NULL,
      project_manager_phone TEXT NOT NULL,
      description TEXT,
      current_task TEXT,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_district ON projects(district);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
  `)

  // 3. worklogs 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS worklogs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      title TEXT,
      overall_content TEXT,
      projects_json TEXT,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(date, user_id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_worklogs_user_id ON worklogs(user_id);
    CREATE INDEX IF NOT EXISTS idx_worklogs_date ON worklogs(date);
  `)

  // 4. event_library 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_library (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      event_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      standard_duration INTEGER,
      dependencies TEXT,
      department_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (department_id) REFERENCES government_departments(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_library_event_type ON event_library(event_type);
    CREATE INDEX IF NOT EXISTS idx_event_library_department_id ON event_library(department_id);
  `)

  // 5. event_presets 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      implementation_type TEXT NOT NULL,
      project_type TEXT NOT NULL,
      events_json TEXT,
      blocks_json TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_presets_implementation_type ON event_presets(implementation_type);
    CREATE INDEX IF NOT EXISTS idx_event_presets_project_type ON event_presets(project_type);
    CREATE INDEX IF NOT EXISTS idx_event_presets_is_default ON event_presets(is_default);
  `)

  // 6. user_preferences 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      theme TEXT DEFAULT 'light',
      language TEXT DEFAULT 'zh-CN',
      event_colors TEXT,
      color_labels TEXT,
      calendar_view_mode TEXT DEFAULT 'week',
      week_display_days INTEGER DEFAULT 7,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 7. user_activities 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_activities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT,
      metadata_json TEXT,
      ip_address TEXT,
      user_agent TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_activities_timestamp ON user_activities(timestamp);
    CREATE INDEX IF NOT EXISTS idx_user_activities_action ON user_activities(action);
  `)

  // 8. drafts 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      pages_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(date, user_id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_drafts_user_id ON drafts(user_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_date ON drafts(date);
  `)

  // 9. block_categories 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS block_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_block_categories_sort_order ON block_categories(sort_order);
    CREATE INDEX IF NOT EXISTS idx_block_categories_is_active ON block_categories(is_active);
  `)

  // 10. event_blocks 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_blocks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_id TEXT,
      description TEXT,
      events_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES block_categories(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_event_blocks_category_id ON event_blocks(category_id);
  `)

  // 11. calendar_events 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      location TEXT,
      color TEXT DEFAULT '#3b82f6',
      reminder_minutes INTEGER,
      recurrence_rule TEXT,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_start_time ON calendar_events(start_time);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_end_time ON calendar_events(end_time);
  `)

  // 12. government_departments 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS government_departments (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL UNIQUE,
      short_names TEXT NOT NULL,
      website_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_government_departments_full_name ON government_departments(full_name);
    CREATE INDEX IF NOT EXISTS idx_government_departments_short_names ON government_departments(short_names);
    CREATE INDEX IF NOT EXISTS idx_government_departments_is_active ON government_departments(is_active);
    CREATE INDEX IF NOT EXISTS idx_government_departments_sort_order ON government_departments(sort_order);
  `)

  // 13. holidays 表 - 节假日数据
  db.exec(`
    CREATE TABLE IF NOT EXISTS holidays (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('holiday', 'workday')),
      year INTEGER NOT NULL,
      source_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
    CREATE INDEX IF NOT EXISTS idx_holidays_year ON holidays(year);
    CREATE INDEX IF NOT EXISTS idx_holidays_type ON holidays(type);
  `)

  console.log('✅ 数据库表初始化完成')
}
