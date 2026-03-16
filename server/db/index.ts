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
      username TEXT UNIQUE,
      password_hash TEXT,
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

  // 添加 username 字段（如果表已存在但没有该字段）
  // 注意：SQLite 不支持直接添加 UNIQUE 列，先添加普通列，再通过索引保证唯一性
  try {
    db.exec(`ALTER TABLE users ADD COLUMN username TEXT`)
  } catch (error: any) {
    if (!error.message?.includes('duplicate column name')) {
      console.warn('添加username字段时出错:', error.message)
    }
  }

  // 添加 password_hash 字段（如果表已存在但没有该字段）
  try {
    db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`)
  } catch (error: any) {
    if (!error.message?.includes('duplicate column name')) {
      console.warn('添加password_hash字段时出错:', error.message)
    }
  }

  // 添加收款人信息字段（银行卡信息）
  const bankFields = [
    { name: 'bank_account_name', type: 'TEXT' },      // 收款人姓名
    { name: 'bank_account_phone', type: 'TEXT' },     // 收款人手机号
    { name: 'bank_name', type: 'TEXT' },              // 开户行
    { name: 'bank_account_number', type: 'TEXT' },    // 银行卡号
  ]

  for (const field of bankFields) {
    try {
      db.exec(`ALTER TABLE users ADD COLUMN ${field.name} ${field.type}`)
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn(`添加${field.name}字段时出错:`, error.message)
      }
    }
  }

  // 添加员工编号字段
  try {
    db.exec(`ALTER TABLE users ADD COLUMN employee_no TEXT`)
  } catch (error: any) {
    if (!error.message?.includes('duplicate column name')) {
      console.warn('添加employee_no字段时出错:', error.message)
    }
  }

  // 为缺少员工编号的用户自动补充
  const usersWithoutNo = db.prepare(
    `SELECT id FROM users WHERE employee_no IS NULL OR employee_no = '' ORDER BY created_at ASC`
  ).all() as { id: string }[]

  if (usersWithoutNo.length > 0) {
    // 获取当前最大编号
    const maxResult = db.prepare(
      `SELECT employee_no FROM users WHERE employee_no IS NOT NULL AND employee_no LIKE 'YULI-CS%' ORDER BY employee_no DESC LIMIT 1`
    ).get() as { employee_no: string } | undefined

    let nextNum = 1
    if (maxResult?.employee_no) {
      const match = maxResult.employee_no.match(/YULI-CS(\d+)/)
      if (match) nextNum = parseInt(match[1], 10) + 1
    }

    const updateUserStmt = db.prepare(`UPDATE users SET employee_no = ? WHERE id = ?`)
    const updateProfileStmt = db.prepare(`UPDATE employee_profiles SET employee_no = ? WHERE user_id = ?`)
    for (const user of usersWithoutNo) {
      const employeeNo = `YULI-CS${nextNum.toString().padStart(3, '0')}`
      updateUserStmt.run(employeeNo, user.id)
      updateProfileStmt.run(employeeNo, user.id)
      nextNum++
    }
    console.log(`✅ 已为 ${usersWithoutNo.length} 个用户补充员工编号`)
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
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
      notion_page_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(date, user_id)
    )
  `)

  // 添加notion_page_id字段（如果表已存在但没有该字段）
  try {
    db.exec(`ALTER TABLE worklogs ADD COLUMN notion_page_id TEXT`)
  } catch (error: any) {
    // 字段已存在，忽略错误
    if (!error.message?.includes('duplicate column name')) {
      console.warn('添加notion_page_id字段时出错:', error.message)
    }
  }

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

  // 14. reimbursements 表 - 报销单主表
  db.exec(`
    CREATE TABLE IF NOT EXISTS reimbursements (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('basic', 'large', 'business')),
      title TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'pending', 'pending_first', 'pending_second', 'pending_final', 'approved', 'payment_uploaded', 'completed', 'rejected')),
      description TEXT,
      business_type TEXT,
      client TEXT,
      user_id TEXT NOT NULL,
      applicant_name TEXT NOT NULL,
      submit_time TEXT,
      approve_time TEXT,
      approver TEXT,
      reject_reason TEXT,
      pay_time TEXT,
      payment_upload_time TEXT,
      completed_time TEXT,
      payment_proof_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  // 添加 category 字段（如果不存在）
  try {
    db.exec(`ALTER TABLE reimbursements ADD COLUMN category TEXT`)
    console.log('✅ 成功添加 category 字段到 reimbursements 表')
  } catch (error: any) {
    // 如果字段已存在，忽略错误
    if (!error.message.includes('duplicate column name')) {
      console.error('❌ 添加 category 字段失败:', error)
    }
  }

  // 添加财务流程相关字段（如果不存在）
  const newColumns = [
    { name: 'pay_time', type: 'TEXT' },
    { name: 'payment_upload_time', type: 'TEXT' },
    { name: 'completed_time', type: 'TEXT' },
    { name: 'payment_proof_path', type: 'TEXT' },
    { name: 'receipt_confirmed_by', type: 'TEXT' },
    { name: 'is_deleted', type: 'INTEGER DEFAULT 0' },  // 软删除标记：0=未删除，1=已删除
    { name: 'deleted_at', type: 'TEXT' },               // 删除时间
    { name: 'reimbursement_scope', type: 'TEXT' },      // 报销范围/区域
    { name: 'service_target', type: 'TEXT' },           // 服务对象
    { name: 'deduction_amount', type: 'REAL DEFAULT 0' }, // 核减金额
    { name: 'deduction_reason', type: 'TEXT' },         // 核减原因
    { name: 'original_amount', type: 'REAL' },          // 原始申请金额（核减前）
    { name: 'reimbursement_month', type: 'TEXT' },      // 报销月份（YYYY-MM）
  ]

  for (const column of newColumns) {
    try {
      db.exec(`ALTER TABLE reimbursements ADD COLUMN ${column.name} ${column.type}`)
      console.log(`✅ 成功添加 ${column.name} 字段到 reimbursements 表`)
    } catch (error: any) {
      // 如果字段已存在，忽略错误
      if (!error.message.includes('duplicate column name')) {
        console.error(`❌ 添加 ${column.name} 字段失败:`, error)
      }
    }
  }

  // 迁移历史 paying 状态数据到 approved（paying 状态已废弃）
  try {
    const migrated = db.prepare(`
      UPDATE reimbursements SET status = 'approved', updated_at = datetime('now')
      WHERE status = 'paying'
    `).run()
    if (migrated.changes > 0) {
      console.log(`✅ 已将 ${migrated.changes} 条 paying 状态记录迁移为 approved`)
    }
  } catch (error) {
    // 忽略迁移错误（如表尚未创建等边界情况）
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reimbursements_user_id ON reimbursements(user_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_type ON reimbursements(type);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_status ON reimbursements(status);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_submit_time ON reimbursements(submit_time);
  `)

  // 15. reimbursement_invoices 表 - 发票明细表
  db.exec(`
    CREATE TABLE IF NOT EXISTS reimbursement_invoices (
      id TEXT PRIMARY KEY,
      reimbursement_id TEXT NOT NULL,
      amount REAL NOT NULL,
      invoice_date TEXT NOT NULL,
      invoice_number TEXT,
      file_path TEXT NOT NULL,
      seller TEXT,
      buyer TEXT,
      tax_amount REAL,
      invoice_code TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (reimbursement_id) REFERENCES reimbursements(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reimbursement_invoices_reimbursement_id ON reimbursement_invoices(reimbursement_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_invoices_invoice_number ON reimbursement_invoices(invoice_number);
  `)

  // 发票号码唯一性通过应用层校验（check-invoice-duplicate 接口），
  // 不使用数据库唯一索引，因为软删除的报销单关联的发票仍在表中
  // 如果之前创建了唯一索引，需要删除以避免冲突
  try {
    db.exec(`DROP INDEX IF EXISTS idx_unique_invoice_number`)
  } catch {
    // 忽略
  }

  // 添加 category 和 deducted_amount 字段到 reimbursement_invoices 表
  const invoiceColumns = [
    { name: 'category', type: 'TEXT' },           // 发票类型（运输服务、汽油等）
    { name: 'deducted_amount', type: 'REAL DEFAULT 0' },  // 核减金额
  ]

  for (const column of invoiceColumns) {
    try {
      db.exec(`ALTER TABLE reimbursement_invoices ADD COLUMN ${column.name} ${column.type}`)
      console.log(`✅ 成功添加 ${column.name} 字段到 reimbursement_invoices 表`)
    } catch (error: any) {
      if (!error.message.includes('duplicate column name')) {
        console.error(`❌ 添加 ${column.name} 字段失败:`, error)
      }
    }
  }

  // 16. approval_flows 表 - 审批流程配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_approval_flows_type ON approval_flows(type);
    CREATE INDEX IF NOT EXISTS idx_approval_flows_is_active ON approval_flows(is_active);
  `)

  // 16.5. reimbursement_deductions 表 - 核减金额统计表（基础报销专用）
  db.exec(`
    CREATE TABLE IF NOT EXISTS reimbursement_deductions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      deducted_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, year, month)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reimbursement_deductions_user_id ON reimbursement_deductions(user_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_deductions_year ON reimbursement_deductions(year);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_deductions_year_month ON reimbursement_deductions(year, month);
  `)

  // 17. approval_instances 表 - 审批实例表
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_instances (
      id TEXT PRIMARY KEY,
      flow_id TEXT,
      type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      applicant_id TEXT NOT NULL,
      current_step INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      submit_time TEXT NOT NULL,
      complete_time TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (flow_id) REFERENCES approval_flows(id),
      FOREIGN KEY (applicant_id) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_approval_instances_type ON approval_instances(type);
    CREATE INDEX IF NOT EXISTS idx_approval_instances_status ON approval_instances(status);
    CREATE INDEX IF NOT EXISTS idx_approval_instances_applicant ON approval_instances(applicant_id);
    CREATE INDEX IF NOT EXISTS idx_approval_instances_target ON approval_instances(target_id, target_type);
  `)

  // 18. approval_records 表 - 审批记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_records (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      step INTEGER NOT NULL,
      approver_id TEXT NOT NULL,
      action TEXT NOT NULL,
      comment TEXT,
      action_time TEXT NOT NULL,
      FOREIGN KEY (instance_id) REFERENCES approval_instances(id),
      FOREIGN KEY (approver_id) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_approval_records_instance ON approval_records(instance_id);
    CREATE INDEX IF NOT EXISTS idx_approval_records_approver ON approval_records(approver_id);
  `)

  // 19. employee_profiles 表 - 员工基础信息表
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      employee_no TEXT,
      name TEXT NOT NULL,
      gender TEXT CHECK(gender IN ('male', 'female', 'other')),
      birth_date TEXT,
      id_number TEXT,
      native_place TEXT,
      ethnicity TEXT,
      marital_status TEXT CHECK(marital_status IN ('single', 'married', 'divorced', 'widowed')),
      education TEXT,
      school TEXT,
      major TEXT,
      mobile TEXT,
      email TEXT,
      emergency_contact TEXT,
      emergency_phone TEXT,
      address TEXT,
      hire_date TEXT,
      department TEXT,
      position TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'submitted')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_user_id ON employee_profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_employee_no ON employee_profiles(employee_no);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_status ON employee_profiles(status);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_department ON employee_profiles(department);
  `)

  // 添加收款信息字段到 employee_profiles 表（如果不存在）
  const employeeBankFields = [
    { name: 'bank_account_name', type: 'TEXT' },      // 收款人姓名
    { name: 'bank_account_phone', type: 'TEXT' },     // 收款人手机号
    { name: 'bank_name', type: 'TEXT' },              // 开户行
    { name: 'bank_account_number', type: 'TEXT' },    // 银行卡号
  ]

  for (const field of employeeBankFields) {
    try {
      db.exec(`ALTER TABLE employee_profiles ADD COLUMN ${field.name} ${field.type}`)
      console.log(`✅ 成功添加 ${field.name} 字段到 employee_profiles 表`)
    } catch (error: any) {
      if (!error.message?.includes('duplicate column name')) {
        console.warn(`添加 ${field.name} 字段时出错:`, error.message)
      }
    }
  }

  // 添加 employment_status 字段（员工在职状态：在职、实习期、已离职、休假中）
  try {
    db.exec(`ALTER TABLE employee_profiles ADD COLUMN employment_status TEXT DEFAULT 'active'`)
    console.log('✅ 成功添加 employment_status 字段到 employee_profiles 表')
  } catch (error: any) {
    if (!error.message?.includes('duplicate column name')) {
      console.warn('添加 employment_status 字段时出错:', error.message)
    }
  }

  // 20. employee_documents 表 - 员工人事档案文件表
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_documents (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL,
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employee_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id ON employee_documents(employee_id);
    CREATE INDEX IF NOT EXISTS idx_employee_documents_document_type ON employee_documents(document_type);
  `)

  // 21. probation_confirmations 表 - 转正申请表
  db.exec(`
    CREATE TABLE IF NOT EXISTS probation_confirmations (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      hire_date TEXT NOT NULL,
      probation_end_date TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      submit_time TEXT,
      approve_time TEXT,
      approver_id TEXT,
      approver_comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employee_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (approver_id) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_probation_confirmations_employee_id ON probation_confirmations(employee_id);
    CREATE INDEX IF NOT EXISTS idx_probation_confirmations_status ON probation_confirmations(status);
  `)

  // 22. probation_documents 表 - 转正文件表
  db.exec(`
    CREATE TABLE IF NOT EXISTS probation_documents (
      id TEXT PRIMARY KEY,
      confirmation_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL,
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (confirmation_id) REFERENCES probation_confirmations(id) ON DELETE CASCADE,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_probation_documents_confirmation_id ON probation_documents(confirmation_id);
  `)

  // 23. probation_templates 表 - 转正文件模板表
  db.exec(`
    CREATE TABLE IF NOT EXISTS probation_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL,
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `)

  // 24. onboarding_templates 表 - 入职文件模板表
  db.exec(`
    CREATE TABLE IF NOT EXISTS onboarding_templates (
      id TEXT PRIMARY KEY,
      file_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL,
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_onboarding_templates_file_type ON onboarding_templates(file_type);
  `)

  // 报销范围配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS reimbursement_scopes (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_reimbursement_scopes_parent_id ON reimbursement_scopes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_scopes_sort_order ON reimbursement_scopes(sort_order);
  `)

  // 初始化默认报销范围数据
  const existingScopes = db.prepare('SELECT COUNT(*) as count FROM reimbursement_scopes').get() as { count: number }
  if (existingScopes.count === 0) {
    const now = new Date().toISOString()
    const insertScope = db.prepare(`
      INSERT INTO reimbursement_scopes (id, parent_id, name, value, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    // 一级分类
    insertScope.run('scope_1', null, '公司内部', 'company_internal', 1, 1, now, now)
    insertScope.run('scope_2', null, '海淀区', 'haidian', 2, 1, now, now)
    insertScope.run('scope_3', null, '朝阳区', 'chaoyang', 3, 1, now, now)

    // 二级分类
    insertScope.run('scope_2_1', 'scope_2', 'GJDW', 'haidian_gjdw', 1, 1, now, now)
    insertScope.run('scope_2_2', 'scope_2', 'WFAH', 'haidian_wfah', 2, 1, now, now)
    insertScope.run('scope_3_1', 'scope_3', 'GJDW', 'chaoyang_gjdw', 1, 1, now, now)

    console.log('✅ 初始化默认报销范围配置')
  }

  console.log('✅ 数据库表初始化完成')
}
