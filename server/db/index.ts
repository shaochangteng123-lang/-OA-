import { Pool, Client, types, type PoolClient } from 'pg'

// 统一 PostgreSQL 数值类型解析，避免前后端把字符串当 number 使用
const PG_INT8_OID = 20
const PG_NUMERIC_OID = 1700

types.setTypeParser(PG_INT8_OID, (value: string) => Number(value))
types.setTypeParser(PG_NUMERIC_OID, (value: string) => Number(value))

const connectionString = process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD || 'postgres'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'yulilog_worklog'}`

console.log('📦 数据库连接:', connectionString.replace(/:[^:@]+@/, ':****@'))

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

// 捕获空闲连接错误，防止进程崩溃
pool.on('error', (err) => {
  console.error('PostgreSQL 连接池错误（已捕获）:', err.message)
})

// 全局未捕获错误处理，防止 pg client error 导致进程崩溃
process.on('uncaughtException', (err) => {
  if (err.message?.includes('Connection terminated') || (err as any).code === '08P01') {
    console.error('PostgreSQL 连接异常（已捕获，进程继续运行）:', err.message)
    return
  }
  console.error('未捕获异常:', err)
  process.exit(1)
})

function convertPlaceholders(sql: string): string {
  let index = 0
  // 1. 替换 ? 为 $N
  let result = sql.replace(/\?/g, () => `$${++index}`)
  // 2. 给驼峰别名自动加双引号（PostgreSQL 会把未引用的标识符转为小写）
  result = result.replace(/\bAS\s+([a-z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/gi, (_, alias) => `AS "${alias}"`)
  return result
}

export const db = {
  async get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
    try {
      const result = await pool.query(convertPlaceholders(sql), params)
      return result.rows[0] as T | undefined
    } catch (err: any) {
      console.error('❌ db.get 失败:', { sql: sql.substring(0, 100), params, error: err.message, code: err.code })
      throw err
    }
  },

  async all<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    try {
      const result = await pool.query(convertPlaceholders(sql), params)
      return result.rows as T[]
    } catch (err: any) {
      console.error('❌ db.all 失败:', { sql: sql.substring(0, 100), params, error: err.message, code: err.code })
      throw err
    }
  },

  async run(sql: string, ...params: any[]): Promise<{ changes: number }> {
    try {
      const result = await pool.query(convertPlaceholders(sql), params)
      return { changes: result.rowCount ?? 0 }
    } catch (err: any) {
      console.error('❌ db.run 失败:', { sql: sql.substring(0, 100), params, error: err.message, code: err.code })
      throw err
    }
  },

  async exec(sql: string): Promise<void> {
    await pool.query(sql)
  },

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      client.release()
      return result
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      client.release(true) // 销毁连接
      throw error
    }
  },

  prepare(sql: string) {
    const pgSql = convertPlaceholders(sql)
    return {
      async get<T = any>(...params: any[]): Promise<T | undefined> {
        try {
          const result = await pool.query(pgSql, params)
          return result.rows[0] as T | undefined
        } catch (err: any) {
          console.error('❌ prepare.get 失败:', { sql: pgSql.substring(0, 100), params, error: err.message, code: err.code })
          throw err
        }
      },
      async all<T = any>(...params: any[]): Promise<T[]> {
        try {
          const result = await pool.query(pgSql, params)
          return result.rows as T[]
        } catch (err: any) {
          console.error('❌ prepare.all 失败:', { sql: pgSql.substring(0, 100), params, error: err.message, code: err.code })
          throw err
        }
      },
      async run(...params: any[]): Promise<{ changes: number }> {
        try {
          const result = await pool.query(pgSql, params)
          return { changes: result.rowCount ?? 0 }
        } catch (err: any) {
          console.error('❌ prepare.run 失败:', { sql: pgSql.substring(0, 100), params, error: err.message, code: err.code })
          throw err
        }
      },
    }
  },

  pool,
}

export async function initDatabase() {
  console.log('🔧 初始化 PostgreSQL 数据库表...')

  // 使用独立连接（不经过连接池）执行 DDL，避免污染池中连接
  const ddlClient = new Client({ connectionString })
  await ddlClient.connect()
  try {
    await ddlClient.query(`
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
      last_login_at TEXT,
      bank_account_name TEXT,
      bank_account_phone TEXT,
      bank_name TEXT,
      bank_account_number TEXT,
      employee_no TEXT
    )
  `)

    await ddlClient.query(`
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
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS worklogs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      title TEXT,
      overall_content TEXT,
      projects_json TEXT,
      user_id TEXT NOT NULL REFERENCES users(id),
      notion_page_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(date, user_id)
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS government_departments (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL UNIQUE,
      short_names TEXT NOT NULL,
      website_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS event_library (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      event_type TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      standard_duration INTEGER,
      dependencies TEXT,
      department_id TEXT REFERENCES government_departments(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS event_presets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      implementation_type TEXT NOT NULL,
      project_type TEXT NOT NULL,
      events_json TEXT,
      blocks_json TEXT,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      theme TEXT DEFAULT 'light',
      language TEXT DEFAULT 'zh-CN',
      event_colors TEXT,
      color_labels TEXT,
      calendar_view_mode TEXT DEFAULT 'week',
      week_display_days INTEGER DEFAULT 7
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS user_activities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      description TEXT,
      metadata_json TEXT,
      ip_address TEXT,
      user_agent TEXT,
      timestamp TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      pages_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(date, user_id)
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS block_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS event_blocks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_id TEXT REFERENCES block_categories(id),
      description TEXT,
      events_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      all_day BOOLEAN NOT NULL DEFAULT FALSE,
      location TEXT,
      color TEXT DEFAULT '#3b82f6',
      reminder_minutes INTEGER,
      recurrence_rule TEXT,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
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

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS payment_batches (
      id TEXT PRIMARY KEY,
      batch_no TEXT UNIQUE NOT NULL,
      total_amount NUMERIC(12,2) NOT NULL,
      payment_proof_path TEXT,
      payer_id TEXT NOT NULL REFERENCES users(id),
      pay_time TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'uploaded', 'confirmed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      remark TEXT
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS reimbursements (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('basic', 'large', 'business')),
      title TEXT NOT NULL,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'pending', 'pending_first', 'pending_second', 'pending_final', 'approved', 'payment_uploaded', 'completed', 'rejected')),
      description TEXT,
      business_type TEXT,
      client TEXT,
      user_id TEXT NOT NULL REFERENCES users(id),
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
      category TEXT,
      receipt_confirmed_by TEXT,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at TEXT,
      reimbursement_scope TEXT,
      service_target TEXT,
      deduction_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      deduction_reason TEXT,
      original_amount NUMERIC(12,2),
      reimbursement_month TEXT,
      payment_batch_id TEXT
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS payment_batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES payment_batches(id),
      reimbursement_id TEXT NOT NULL REFERENCES reimbursements(id),
      amount NUMERIC(12,2) NOT NULL,
      created_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS reimbursement_invoices (
      id TEXT PRIMARY KEY,
      reimbursement_id TEXT NOT NULL REFERENCES reimbursements(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      invoice_date TEXT NOT NULL,
      invoice_number TEXT,
      file_path TEXT NOT NULL,
      seller TEXT,
      buyer TEXT,
      tax_amount NUMERIC(12,2),
      invoice_code TEXT,
      created_at TEXT NOT NULL,
      category TEXT,
      deducted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      file_hash TEXT,
      is_deduction INTEGER NOT NULL DEFAULT 0
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS approval_flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      steps_json TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS reimbursement_deductions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      deducted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, year, month)
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS approval_instances (
      id TEXT PRIMARY KEY,
      flow_id TEXT REFERENCES approval_flows(id),
      type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      applicant_id TEXT NOT NULL REFERENCES users(id),
      current_step INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      submit_time TEXT NOT NULL,
      complete_time TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS approval_records (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL REFERENCES approval_instances(id),
      step INTEGER NOT NULL,
      approver_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      comment TEXT,
      action_time TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS employee_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
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
      bank_account_name TEXT,
      bank_account_phone TEXT,
      bank_name TEXT,
      bank_account_number TEXT,
      employment_status TEXT DEFAULT 'active'
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS employee_documents (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS probation_confirmations (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
      hire_date TEXT NOT NULL,
      probation_end_date TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      submit_time TEXT,
      approve_time TEXT,
      approver_id TEXT REFERENCES users(id),
      approver_comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS probation_documents (
      id TEXT PRIMARY KEY,
      confirmation_id TEXT NOT NULL REFERENCES probation_confirmations(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS probation_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
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

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS reimbursement_scopes (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS reimbursement_deduction_invoices (
      id TEXT PRIMARY KEY,
      reimbursement_id TEXT NOT NULL REFERENCES reimbursements(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      invoice_date TEXT NOT NULL,
      invoice_number TEXT,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      file_hash TEXT
    )
  `)

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS department_position_configs (
      id TEXT PRIMARY KEY DEFAULT 'default',
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

    await ddlClient.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_district ON projects(district);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_worklogs_user_id ON worklogs(user_id);
    CREATE INDEX IF NOT EXISTS idx_worklogs_date ON worklogs(date);
    CREATE INDEX IF NOT EXISTS idx_event_library_event_type ON event_library(event_type);
    CREATE INDEX IF NOT EXISTS idx_event_library_department_id ON event_library(department_id);
    CREATE INDEX IF NOT EXISTS idx_event_presets_implementation_type ON event_presets(implementation_type);
    CREATE INDEX IF NOT EXISTS idx_event_presets_project_type ON event_presets(project_type);
    CREATE INDEX IF NOT EXISTS idx_event_presets_is_default ON event_presets(is_default);
    CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_activities_timestamp ON user_activities(timestamp);
    CREATE INDEX IF NOT EXISTS idx_user_activities_action ON user_activities(action);
    CREATE INDEX IF NOT EXISTS idx_drafts_user_id ON drafts(user_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_date ON drafts(date);
    CREATE INDEX IF NOT EXISTS idx_block_categories_sort_order ON block_categories(sort_order);
    CREATE INDEX IF NOT EXISTS idx_block_categories_is_active ON block_categories(is_active);
    CREATE INDEX IF NOT EXISTS idx_event_blocks_category_id ON event_blocks(category_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_start_time ON calendar_events(start_time);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_end_time ON calendar_events(end_time);
    CREATE INDEX IF NOT EXISTS idx_government_departments_full_name ON government_departments(full_name);
    CREATE INDEX IF NOT EXISTS idx_government_departments_short_names ON government_departments(short_names);
    CREATE INDEX IF NOT EXISTS idx_government_departments_is_active ON government_departments(is_active);
    CREATE INDEX IF NOT EXISTS idx_government_departments_sort_order ON government_departments(sort_order);
    CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
    CREATE INDEX IF NOT EXISTS idx_holidays_year ON holidays(year);
    CREATE INDEX IF NOT EXISTS idx_holidays_type ON holidays(type);
    CREATE INDEX IF NOT EXISTS idx_payment_batches_batch_no ON payment_batches(batch_no);
    CREATE INDEX IF NOT EXISTS idx_payment_batches_payer_id ON payment_batches(payer_id);
    CREATE INDEX IF NOT EXISTS idx_payment_batches_status ON payment_batches(status);
    CREATE INDEX IF NOT EXISTS idx_payment_batch_items_batch_id ON payment_batch_items(batch_id);
    CREATE INDEX IF NOT EXISTS idx_payment_batch_items_reimbursement_id ON payment_batch_items(reimbursement_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_user_id ON reimbursements(user_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_type ON reimbursements(type);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_status ON reimbursements(status);
    CREATE INDEX IF NOT EXISTS idx_reimbursements_submit_time ON reimbursements(submit_time);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_invoices_reimbursement_id ON reimbursement_invoices(reimbursement_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_invoices_invoice_number ON reimbursement_invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_invoices_file_hash ON reimbursement_invoices(file_hash);
    CREATE INDEX IF NOT EXISTS idx_approval_flows_type ON approval_flows(type);
    CREATE INDEX IF NOT EXISTS idx_approval_flows_is_active ON approval_flows(is_active);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_deductions_user_id ON reimbursement_deductions(user_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_deductions_year ON reimbursement_deductions(year);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_deductions_year_month ON reimbursement_deductions(year, month);
    CREATE INDEX IF NOT EXISTS idx_approval_instances_type ON approval_instances(type);
    CREATE INDEX IF NOT EXISTS idx_approval_instances_status ON approval_instances(status);
    CREATE INDEX IF NOT EXISTS idx_approval_instances_applicant ON approval_instances(applicant_id);
    CREATE INDEX IF NOT EXISTS idx_approval_instances_target ON approval_instances(target_id, target_type);
    CREATE INDEX IF NOT EXISTS idx_approval_records_instance ON approval_records(instance_id);
    CREATE INDEX IF NOT EXISTS idx_approval_records_approver ON approval_records(approver_id);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_user_id ON employee_profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_employee_no ON employee_profiles(employee_no);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_status ON employee_profiles(status);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_department ON employee_profiles(department);
    CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id ON employee_documents(employee_id);
    CREATE INDEX IF NOT EXISTS idx_employee_documents_document_type ON employee_documents(document_type);
    CREATE INDEX IF NOT EXISTS idx_probation_confirmations_employee_id ON probation_confirmations(employee_id);
    CREATE INDEX IF NOT EXISTS idx_probation_confirmations_status ON probation_confirmations(status);
    CREATE INDEX IF NOT EXISTS idx_probation_documents_confirmation_id ON probation_documents(confirmation_id);
    CREATE INDEX IF NOT EXISTS idx_onboarding_templates_file_type ON onboarding_templates(file_type);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_scopes_parent_id ON reimbursement_scopes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_scopes_sort_order ON reimbursement_scopes(sort_order);
  `)

  // DDL 完成，销毁初始化连接，确保后续查询用干净的连接
  } finally {
    await ddlClient.end()
  }

  const migrated = await db.run(`UPDATE reimbursements SET status = 'approved', updated_at = NOW()::text WHERE status = 'paying'`)
  if (migrated.changes > 0) {
    console.log(`✅ 已将 ${migrated.changes} 条 paying 状态记录迁移为 approved`)
  }

  const existingScopes = await db.get<{ count: string }>('SELECT COUNT(*) as count FROM reimbursement_scopes')
  if (Number(existingScopes?.count || 0) === 0) {
    const now = new Date().toISOString()
    await db.run(
      `INSERT INTO reimbursement_scopes (id, parent_id, name, value, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?)`,
      'scope_1', null, '公司内部', 'company_internal', 1, true, now, now,
      'scope_2', null, '海淀区', 'haidian', 2, true, now, now,
      'scope_3', null, '朝阳区', 'chaoyang', 3, true, now, now,
      'scope_2_1', 'scope_2', 'GJDW', 'haidian_gjdw', 1, true, now, now,
      'scope_2_2', 'scope_2', 'WFAH', 'haidian_wfah', 2, true, now, now,
      'scope_3_1', 'scope_3', 'GJDW', 'chaoyang_gjdw', 1, true, now, now,
    )
    console.log('✅ 初始化默认报销范围配置')
  }

  const usersWithoutNo = await db.all<{ id: string }>(`SELECT id FROM users WHERE employee_no IS NULL OR employee_no = '' ORDER BY created_at ASC`)
  if (usersWithoutNo.length > 0) {
    const maxResult = await db.get<{ employee_no: string }>(
      `SELECT employee_no FROM users WHERE employee_no IS NOT NULL AND employee_no LIKE 'YULI-CS%' ORDER BY employee_no DESC LIMIT 1`
    )

    let nextNum = 1
    if (maxResult?.employee_no) {
      const match = maxResult.employee_no.match(/YULI-CS(\d+)/)
      if (match) nextNum = parseInt(match[1], 10) + 1
    }

    for (const user of usersWithoutNo) {
      const employeeNo = `YULI-CS${nextNum.toString().padStart(3, '0')}`
      await db.run('UPDATE users SET employee_no = ? WHERE id = ?', employeeNo, user.id)
      await db.run('UPDATE employee_profiles SET employee_no = ? WHERE user_id = ?', employeeNo, user.id)
      nextNum++
    }
    console.log(`✅ 已为 ${usersWithoutNo.length} 个用户补充员工编号`)
  }

  const existingConfig = await db.get<{ id: string }>('SELECT id FROM department_position_configs WHERE id = ?', 'default')
  if (!existingConfig) {
    const defaultConfig = {
      '行政部': ['行政主管', '行政专员', '财务', '出纳'],
      '项目部': ['项目经理', '员工'],
    }
    const now = new Date().toISOString()
    await db.run(
      'INSERT INTO department_position_configs (id, config_json, updated_at) VALUES (?, ?, ?)',
      'default',
      JSON.stringify(defaultConfig),
      now
    )
    console.log('✅ 初始化默认部门职位配置')
  }

  // 数据库迁移：添加 is_deduction 字段
  try {
    await ddlClient.query(`
      ALTER TABLE reimbursement_invoices
      ADD COLUMN IF NOT EXISTS is_deduction INTEGER NOT NULL DEFAULT 0
    `)
    console.log('✅ 数据库迁移：添加 is_deduction 字段')
  } catch (error) {
    // 字段可能已存在，忽略错误
    console.log('ℹ️ is_deduction 字段已存在或迁移失败:', error)
  }

  console.log('✅ PostgreSQL 数据库表初始化完成')
}
