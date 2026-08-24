import { Pool, Client, types, type PoolClient } from "pg";

// 统一 PostgreSQL 数值类型解析，避免前后端把字符串当 number 使用
const PG_INT8_OID = 20;
const PG_NUMERIC_OID = 1700;

types.setTypeParser(PG_INT8_OID, (value: string) => Number(value));
types.setTypeParser(PG_NUMERIC_OID, (value: string) => Number(value));

const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || "5432"}/${process.env.DB_NAME || "yulilog_worklog"}`;

console.log("📦 数据库连接:", connectionString.replace(/:[^:@]+@/, ":****@"));

export const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// 捕获空闲连接错误，防止进程崩溃
pool.on("error", (err) => {
  console.error("PostgreSQL 连接池错误（已捕获）:", err.message);
});

// 全局未捕获错误处理，防止 pg client error 导致进程崩溃
process.on("uncaughtException", (err) => {
  if (
    err.message?.includes("Connection terminated") ||
    (err as any).code === "08P01"
  ) {
    console.error("PostgreSQL 连接异常（已捕获，进程继续运行）:", err.message);
    return;
  }
  console.error("未捕获异常:", err);
  process.exit(1);
});

function convertPlaceholders(sql: string): string {
  let index = 0;
  // 1. 替换 ? 为 $N
  let result = sql.replace(/\?/g, () => `$${++index}`);
  // 2. 给驼峰别名自动加双引号（PostgreSQL 会把未引用的标识符转为小写）
  result = result.replace(
    /\bAS\s+([a-z][a-zA-Z]*[A-Z][a-zA-Z]*)\b/gi,
    (_, alias) => `AS "${alias}"`,
  );
  return result;
}

export const db = {
  async get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
    try {
      const result = await pool.query(convertPlaceholders(sql), params);
      return result.rows[0] as T | undefined;
    } catch (err: any) {
      console.error("❌ db.get 失败:", {
        sql: sql.substring(0, 100),
        params,
        error: err.message,
        code: err.code,
      });
      throw err;
    }
  },

  async all<T = any>(sql: string, ...params: any[]): Promise<T[]> {
    try {
      const result = await pool.query(convertPlaceholders(sql), params);
      return result.rows as T[];
    } catch (err: any) {
      console.error("❌ db.all 失败:", {
        sql: sql.substring(0, 100),
        params,
        error: err.message,
        code: err.code,
      });
      throw err;
    }
  },

  async run(sql: string, ...params: any[]): Promise<{ changes: number }> {
    try {
      const result = await pool.query(convertPlaceholders(sql), params);
      return { changes: result.rowCount ?? 0 };
    } catch (err: any) {
      console.error("❌ db.run 失败:", {
        sql: sql.substring(0, 100),
        params,
        error: err.message,
        code: err.code,
      });
      throw err;
    }
  },

  async exec(sql: string): Promise<void> {
    await pool.query(sql);
  },

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      client.release();
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // 原事务错误优先返回，回滚失败时销毁当前连接。
      }
      client.release(true); // 销毁连接
      throw error;
    }
  },

  prepare(sql: string) {
    const pgSql = convertPlaceholders(sql);
    return {
      async get<T = any>(...params: any[]): Promise<T | undefined> {
        try {
          const result = await pool.query(pgSql, params);
          return result.rows[0] as T | undefined;
        } catch (err: any) {
          console.error("❌ prepare.get 失败:", {
            sql: pgSql.substring(0, 100),
            params,
            error: err.message,
            code: err.code,
          });
          throw err;
        }
      },
      async all<T = any>(...params: any[]): Promise<T[]> {
        try {
          const result = await pool.query(pgSql, params);
          return result.rows as T[];
        } catch (err: any) {
          console.error("❌ prepare.all 失败:", {
            sql: pgSql.substring(0, 100),
            params,
            error: err.message,
            code: err.code,
          });
          throw err;
        }
      },
      async run(...params: any[]): Promise<{ changes: number }> {
        try {
          const result = await pool.query(pgSql, params);
          return { changes: result.rowCount ?? 0 };
        } catch (err: any) {
          console.error("❌ prepare.run 失败:", {
            sql: pgSql.substring(0, 100),
            params,
            error: err.message,
            code: err.code,
          });
          throw err;
        }
      },
    };
  },

  pool,
};

export type DatabaseColumnReader = {
  all<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]>;
};

const REQUIRED_DATABASE_COLUMNS = [
  {
    tableName: "probation_confirmations",
    columnName: "application_comment",
    featureName: "转正申请备注",
  },
] as const;

export async function assertRequiredDatabaseSchema(
  database: DatabaseColumnReader = db,
): Promise<void> {
  const tableNames = Array.from(
    new Set(REQUIRED_DATABASE_COLUMNS.map((column) => column.tableName)),
  );
  const existingColumns = await database.all<{
    table_name: string;
    column_name: string;
  }>(
    `
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ANY(?::text[])
    `,
    tableNames,
  );
  const existingColumnKeys = new Set(
    existingColumns.map(
      (column) => `${column.table_name}.${column.column_name}`,
    ),
  );
  const missingColumns = REQUIRED_DATABASE_COLUMNS.filter(
    (column) =>
      !existingColumnKeys.has(`${column.tableName}.${column.columnName}`),
  );

  if (missingColumns.length > 0) {
    const missingColumnDescription = missingColumns
      .map(
        (column) =>
          `${column.featureName}（${column.tableName}.${column.columnName}）`,
      )
      .join("、");
    throw new Error(
      `数据库结构校验失败：缺少${missingColumnDescription}。请先完成数据库迁移后再启动服务。`,
    );
  }
}

export async function initDatabase() {
  console.log("🔧 初始化 PostgreSQL 数据库表...");

  // 使用独立连接（不经过连接池）执行 DDL，避免污染池中连接
  const ddlClient = new Client({ connectionString });
  await ddlClient.connect();
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
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('super_admin', 'chairman', 'admin', 'general_manager', 'boss', 'user', 'guest')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
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
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS user_signatures (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      signature_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS user_delegated_signatures (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      represented_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      represented_user_name TEXT NOT NULL,
      signature_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

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
      requires_auxiliary_materials BOOLEAN NOT NULL DEFAULT FALSE,
      current_task TEXT,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

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
  `);

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
  `);

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
  `);

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
  `);

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
  `);

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
  `);

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
  `);

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
  `);

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
  `);

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
  `);

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
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS payment_batches (
      id TEXT PRIMARY KEY,
      batch_no TEXT UNIQUE NOT NULL,
      total_amount NUMERIC(12,2) NOT NULL,
      payment_proof_path TEXT,
      payer_id TEXT NOT NULL REFERENCES users(id),
      pay_time TEXT,
      payment_business_date DATE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'uploaded', 'confirmed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      remark TEXT
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS reimbursements (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('basic', 'large', 'business')),
      title TEXT NOT NULL,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'pending', 'pending_first', 'pending_second', 'pending_final', 'approved', 'paid', 'payment_uploaded', 'completed', 'rejected')),
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
      paid_time TEXT,
      payment_business_date DATE,
      paid_by TEXT,
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
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS payment_batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES payment_batches(id),
      reimbursement_id TEXT NOT NULL REFERENCES reimbursements(id),
      amount NUMERIC(12,2) NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

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
      note TEXT,
      tax_amount NUMERIC(12,2),
      invoice_code TEXT,
      created_at TEXT NOT NULL,
      category TEXT,
      deducted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      file_hash TEXT,
      is_deduction INTEGER NOT NULL DEFAULT 0
    )
  `);

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
  `);

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
  `);

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
  `);

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
  `);

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
      contract_end_date TEXT,
      contract_template_start_date TEXT,
      contract_template_end_date TEXT,
      probation_template_start_date TEXT,
      probation_template_end_date TEXT,
      last_contract_template_start_date TEXT,
      last_contract_template_end_date TEXT,
      last_probation_template_start_date TEXT,
      last_probation_template_end_date TEXT,
      last_contract_template_position TEXT,
      department TEXT,
      position TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'submitted')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      bank_account_name TEXT,
      bank_account_phone TEXT,
      bank_name TEXT,
      bank_account_number TEXT,
      employment_status TEXT DEFAULT 'active' CHECK(employment_status IN ('active', 'probation', 'resigned', 'on_leave'))
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS employee_documents (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL CHECK(document_type IN (
        'invitation', 'application', 'contract', 'nda', 'declaration', 'asset_handover',
        'id_card', 'health_report', 'diploma', 'bank_card', 'other'
      )),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      uploaded_by_name TEXT,
      contract_start_date TEXT,
      contract_end_date TEXT,
      contract_recognized_at TEXT,
      probation_end_date TEXT,
      created_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS employee_salary_profiles (
      employee_id TEXT PRIMARY KEY REFERENCES employee_profiles(id) ON DELETE CASCADE,
      initial_monthly_salary NUMERIC NOT NULL CHECK(initial_monthly_salary >= 0),
      source_document_id TEXT REFERENCES employee_documents(id) ON DELETE SET NULL,
      recognized_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS payroll_records (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
      payroll_month TEXT NOT NULL CHECK(payroll_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      automatic_salary NUMERIC NOT NULL DEFAULT 0 CHECK(automatic_salary >= 0),
      monthly_salary NUMERIC NOT NULL DEFAULT 0 CHECK(monthly_salary >= 0),
      housing_fund_base NUMERIC NOT NULL DEFAULT 0 CHECK(housing_fund_base >= 0),
      contribution_base NUMERIC NOT NULL DEFAULT 0 CHECK(contribution_base >= 0),
      individual_income_tax NUMERIC NOT NULL DEFAULT 0 CHECK(individual_income_tax >= 0),
      monthly_salary_is_manual BOOLEAN NOT NULL DEFAULT FALSE,
      housing_fund_base_is_manual BOOLEAN NOT NULL DEFAULT FALSE,
      contribution_base_is_manual BOOLEAN NOT NULL DEFAULT FALSE,
      tax_is_manual BOOLEAN NOT NULL DEFAULT FALSE,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      updated_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(employee_id, payroll_month)
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS payroll_change_logs (
      id TEXT PRIMARY KEY,
      payroll_record_id TEXT NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
      payroll_month TEXT NOT NULL,
      field_name TEXT NOT NULL CHECK(field_name IN ('monthly_salary', 'housing_fund_base', 'contribution_base', 'individual_income_tax')),
      old_value NUMERIC NOT NULL CHECK(old_value >= 0),
      new_value NUMERIC NOT NULL CHECK(new_value >= 0),
      changed_by TEXT NOT NULL REFERENCES users(id),
      changed_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS human_cost_receipts (
      id TEXT PRIMARY KEY,
      payroll_month TEXT NOT NULL CHECK(payroll_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      category TEXT NOT NULL CHECK(category IN ('social_security', 'housing_fund', 'income_tax', 'net_salary')),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL CHECK(file_size > 0),
      mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
      file_hash TEXT NOT NULL,
      recognized_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(recognized_amount >= 0),
      recognition_status TEXT NOT NULL DEFAULT 'processing'
        CHECK(recognition_status IN ('processing', 'recognized', 'partial', 'failed')),
      recognized_item_count INTEGER NOT NULL DEFAULT 0 CHECK(recognized_item_count >= 0),
      total_item_count INTEGER NOT NULL DEFAULT 0 CHECK(total_item_count >= 0),
      ignored_item_count INTEGER NOT NULL DEFAULT 0 CHECK(ignored_item_count >= 0),
      recognition_version INTEGER NOT NULL DEFAULT 1 CHECK(recognition_version >= 1),
      recognition_error TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(payroll_month, category, file_hash)
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS payroll_tax_detail_files (
      id TEXT PRIMARY KEY,
      payroll_month TEXT NOT NULL UNIQUE
        CHECK(payroll_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL CHECK(file_size > 0),
      mime_type TEXT NOT NULL
        CHECK(mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
      recognized_count INTEGER NOT NULL CHECK(recognized_count >= 0),
      zero_count INTEGER NOT NULL CHECK(zero_count >= 0),
      missing_employee_names JSONB NOT NULL DEFAULT '[]'::jsonb,
      unreadable_employee_names JSONB NOT NULL DEFAULT '[]'::jsonb,
      page_count INTEGER NOT NULL CHECK(page_count >= 1),
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS human_cost_receipt_items (
      id TEXT PRIMARY KEY,
      receipt_id TEXT NOT NULL REFERENCES human_cost_receipts(id) ON DELETE CASCADE,
      employee_id TEXT REFERENCES employee_profiles(id) ON DELETE SET NULL,
      payee_name TEXT NOT NULL,
      payee_account TEXT NOT NULL,
      amount NUMERIC(14,2) NOT NULL CHECK(amount > 0),
      proof_no TEXT,
      page_no INTEGER NOT NULL CHECK(page_no >= 1),
      position TEXT NOT NULL CHECK(position IN ('full', 'top', 'bottom')),
      match_status TEXT NOT NULL CHECK(match_status IN ('matched', 'unmatched', 'ambiguous')),
      created_at TEXT NOT NULL,
      UNIQUE(receipt_id, page_no, position)
    )
  `);

    // 超级管理员是系统维护账号，不属于公司人力成本统计范围。
    await ddlClient.query(`
    DELETE FROM payroll_records pr
    USING employee_profiles ep, users u
    WHERE pr.employee_id = ep.id
      AND ep.user_id = u.id
      AND u.role = 'super_admin'
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS probation_confirmations (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
      hire_date TEXT,
      probation_end_date TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'submitted', 'approved', 'rejected')),
      form_version INTEGER NOT NULL DEFAULT 0,
      review_stage TEXT NOT NULL DEFAULT 'employee' CHECK(review_stage IN ('employee', 'supervisor', 'hr', 'general_manager', 'completed')),
      conversion_type TEXT NOT NULL DEFAULT 'normal' CHECK(conversion_type IN ('normal', 'early', 'extended', 'other')),
      conversion_type_other TEXT,
      self_statement TEXT,
      applicant_name_snapshot TEXT,
      department_snapshot TEXT,
      position_snapshot TEXT,
      supervisor_id TEXT REFERENCES users(id),
      supervisor_name_snapshot TEXT,
      hr_approver_id TEXT REFERENCES users(id),
      hr_approver_name_snapshot TEXT,
      chairman_id TEXT REFERENCES users(id),
      chairman_name_snapshot TEXT,
      submit_time TEXT,
      approve_time TEXT,
      approver_id TEXT REFERENCES users(id),
      approver_comment TEXT,
      application_comment TEXT,
      formal_document_generated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS probation_documents (
      id TEXT PRIMARY KEY,
      confirmation_id TEXT REFERENCES probation_confirmations(id) ON DELETE CASCADE,
      employee_id TEXT REFERENCES employee_profiles(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL CHECK(document_type = 'application'),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      uploaded_by_name TEXT,
      source_type TEXT NOT NULL DEFAULT 'uploaded' CHECK(source_type IN ('uploaded', 'generated', 'official')),
      form_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS probation_signature_records (
      id TEXT PRIMARY KEY,
      confirmation_id TEXT NOT NULL REFERENCES probation_confirmations(id) ON DELETE CASCADE,
      form_version INTEGER NOT NULL,
      stage TEXT NOT NULL CHECK(stage IN ('employee', 'supervisor', 'hr', 'general_manager')),
      signer_id TEXT NOT NULL REFERENCES users(id),
      signer_name TEXT NOT NULL,
      signer_role TEXT NOT NULL,
      signer_department TEXT,
      signer_position TEXT,
      signature_path TEXT NOT NULL,
      signature_type TEXT NOT NULL DEFAULT 'personal' CHECK(signature_type IN ('personal', 'general_manager')),
      signature_owner_name TEXT NOT NULL,
      opinion TEXT,
      decision TEXT NOT NULL CHECK(decision IN ('submit', 'approve', 'reject')),
      signed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(confirmation_id, form_version, stage)
    )
  `);

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
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS resignation_requests (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
      employee_user_id TEXT REFERENCES users(id),
      handover_user_id TEXT REFERENCES users(id),
      handover_name TEXT,
      resign_type TEXT NOT NULL CHECK(resign_type IN ('voluntary', 'contract_end', 'dismissal')),
      resign_date TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'pending_confirmation', 'submitted', 'handover_confirmed', 'mutual_confirmed', 'approved', 'rejected', 'handover_rejected')),
      employee_confirm_time TEXT,
      handover_confirm_time TEXT,
      submit_time TEXT,
      approve_time TEXT,
      approver_id TEXT REFERENCES users(id),
      approver_comment TEXT,
      reject_target TEXT,
      created_by TEXT REFERENCES users(id),
      created_by_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(employee_id)
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS resignation_documents (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES resignation_requests(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL CHECK(document_type IN (
        'application_form', 'handover_form', 'handover_form_employee', 'handover_form_handover',
        'termination_proof', 'asset_handover', 'compensation_agreement',
        'expense_settlement_agreement', 'termination_agreement',
        'employee_handover_form', 'settlement_confirmation', 'resignation_certificate'
      )),
      uploader_role TEXT NOT NULL CHECK(uploader_role IN ('employee', 'handover', 'admin')),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0, 1))
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS resignation_templates (
      id TEXT PRIMARY KEY,
      template_type TEXT NOT NULL CHECK(template_type IN (
        'application_form', 'handover_form', 'termination_proof', 'asset_handover',
        'compensation_agreement', 'expense_settlement_agreement',
        'partner_dividend_settlement', 'termination_agreement',
        'employee_handover_form', 'settlement_confirmation', 'resignation_certificate'
      )),
      name TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS resignation_template_drafts (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES resignation_requests(id) ON DELETE CASCADE,
      template_type TEXT NOT NULL,
      template_id TEXT NOT NULL REFERENCES resignation_templates(id) ON DELETE CASCADE,
      content_html TEXT NOT NULL,
      overlay_json TEXT,
      updated_by TEXT NOT NULL REFERENCES users(id),
      updated_by_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(request_id, template_type)
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS resignation_audit_logs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES resignation_requests(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      operator_id TEXT NOT NULL REFERENCES users(id),
      operator_name TEXT,
      comment TEXT,
      created_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS onboarding_templates (
      id TEXT PRIMARY KEY,
      file_type TEXT NOT NULL CHECK(file_type IN ('invitation', 'application', 'contract', 'nda', 'declaration', 'asset')),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL,
      uploaded_by_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

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
  `);

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
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS department_position_configs (
      id TEXT PRIMARY KEY DEFAULT 'default',
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

    // ==================== 请假管理相关表 ====================

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS leave_type_configs (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      requires_attachment BOOLEAN DEFAULT FALSE,
      requires_balance_check BOOLEAN DEFAULT TRUE,
      default_days NUMERIC(5,1),
      description TEXT,
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS leave_balances (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      leave_type_code TEXT NOT NULL REFERENCES leave_type_configs(code),
      year INTEGER NOT NULL,
      total_days NUMERIC(5,1) NOT NULL CHECK(total_days >= 0),
      used_days NUMERIC(5,1) NOT NULL DEFAULT 0 CHECK(used_days >= 0),
      pending_days NUMERIC(5,1) NOT NULL DEFAULT 0 CHECK(pending_days >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, leave_type_code, year),
      CHECK(year BETWEEN 2000 AND 2200),
      CHECK(used_days + pending_days <= total_days)
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY,
      request_no TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      applicant_name TEXT NOT NULL,
      applicant_department TEXT,
      leave_type_code TEXT NOT NULL REFERENCES leave_type_configs(code),
      leave_type_name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      start_half TEXT NOT NULL CHECK(start_half IN ('morning', 'afternoon')),
      end_date TEXT NOT NULL,
      end_half TEXT NOT NULL CHECK(end_half IN ('morning', 'afternoon')),
      total_days NUMERIC(5,1) NOT NULL CHECK(total_days > 0),
      balance_allocations_json TEXT,
      balance_reserved BOOLEAN NOT NULL DEFAULT FALSE,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
      approver_id TEXT REFERENCES users(id),
      approver_name TEXT,
      reject_reason TEXT,
      approved_at TEXT,
      approval_notice_unread BOOLEAN NOT NULL DEFAULT FALSE,
      rejection_notice_unread BOOLEAN NOT NULL DEFAULT FALSE,
      rejected_at TEXT,
      cancelled_at TEXT,
      submitted_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      original_id TEXT REFERENCES leave_requests(id),
      application_kind TEXT NOT NULL DEFAULT 'normal'
        CHECK(application_kind IN ('normal', 'combined', 'extension', 'supplement')),
      combination_group_id TEXT,
      parent_request_id TEXT REFERENCES leave_requests(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
      UPDATE leave_requests legacy
      SET request_no = REGEXP_REPLACE(legacy.request_no, '^LR-', 'QJ-')
      WHERE legacy.request_no ~ '^LR-[0-9]{4}-[0-9]+$'
        AND NOT EXISTS (
          SELECT 1
          FROM leave_requests current_request
          WHERE current_request.id <> legacy.id
            AND current_request.request_no = REGEXP_REPLACE(legacy.request_no, '^LR-', 'QJ-')
        )
    `);

    await ddlClient.query(`
      WITH qj_max AS (
        SELECT
          SUBSTRING(request_no FROM '^QJ-([0-9]{4})-') AS request_year,
          MAX((SUBSTRING(request_no FROM '^QJ-[0-9]{4}-([0-9]+)$'))::INTEGER) AS max_sequence
        FROM leave_requests
        WHERE request_no ~ '^QJ-[0-9]{4}-[0-9]+$'
        GROUP BY SUBSTRING(request_no FROM '^QJ-([0-9]{4})-')
      ),
      legacy_ranked AS (
        SELECT
          lr.id,
          SUBSTRING(lr.request_no FROM '^LR-([0-9]{4})-') AS request_year,
          COALESCE(qj_max.max_sequence, 0) + ROW_NUMBER() OVER (
            PARTITION BY SUBSTRING(lr.request_no FROM '^LR-([0-9]{4})-')
            ORDER BY lr.created_at ASC, lr.id ASC
          ) AS next_sequence
        FROM leave_requests lr
        LEFT JOIN qj_max
          ON qj_max.request_year = SUBSTRING(lr.request_no FROM '^LR-([0-9]{4})-')
        WHERE lr.request_no ~ '^LR-[0-9]{4}-[0-9]+$'
      )
      UPDATE leave_requests lr
      SET request_no = 'QJ-' || legacy_ranked.request_year || '-' ||
        LPAD(legacy_ranked.next_sequence::TEXT, 5, '0')
      FROM legacy_ranked
      WHERE lr.id = legacy_ranked.id
    `);

    await ddlClient.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS balance_allocations_json TEXT
    `);

    await ddlClient.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS balance_reserved BOOLEAN
    `);
    await ddlClient.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS approval_notice_unread BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await ddlClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'leave_requests'
            AND column_name = 'rejection_notice_unread'
        ) THEN
          ALTER TABLE leave_requests
          ADD COLUMN rejection_notice_unread BOOLEAN;

          UPDATE leave_requests
          SET rejection_notice_unread = (status = 'rejected');

          ALTER TABLE leave_requests
          ALTER COLUMN rejection_notice_unread SET DEFAULT FALSE;

          ALTER TABLE leave_requests
          ALTER COLUMN rejection_notice_unread SET NOT NULL;
        END IF;
      END $$;
    `);
    await ddlClient.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS application_kind TEXT NOT NULL DEFAULT 'normal'
    `);
    await ddlClient.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS combination_group_id TEXT
    `);
    await ddlClient.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS parent_request_id TEXT
    `);
    await ddlClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'leave_requests_parent_request_id_fkey'
        ) THEN
          ALTER TABLE leave_requests
          ADD CONSTRAINT leave_requests_parent_request_id_fkey
          FOREIGN KEY (parent_request_id) REFERENCES leave_requests(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);
    await ddlClient.query(`
      UPDATE leave_requests lr
      SET balance_reserved = ltc.requires_balance_check
      FROM leave_type_configs ltc
      WHERE lr.leave_type_code = ltc.code
        AND lr.balance_reserved IS NULL
    `);
    await ddlClient.query(`
      ALTER TABLE leave_requests ALTER COLUMN balance_reserved SET DEFAULT FALSE;
      UPDATE leave_requests SET balance_reserved = FALSE WHERE balance_reserved IS NULL;
      ALTER TABLE leave_requests ALTER COLUMN balance_reserved SET NOT NULL;
    `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS leave_attachments (
      id TEXT PRIMARY KEY,
      leave_request_id TEXT NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      mime_type TEXT,
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE TABLE IF NOT EXISTS leave_approval_logs (
      id TEXT PRIMARY KEY,
      leave_request_id TEXT NOT NULL REFERENCES leave_requests(id),
      operator_id TEXT NOT NULL REFERENCES users(id),
      operator_name TEXT NOT NULL,
      action TEXT NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    )
  `);

    await ddlClient.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_users_employee_no
      ON users(employee_no)
      WHERE employee_no IS NOT NULL AND BTRIM(employee_no) <> '';
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
    CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_instances_pending_probation_target
      ON approval_instances(target_id)
      WHERE target_type = 'probation' AND status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_approval_records_instance ON approval_records(instance_id);
    CREATE INDEX IF NOT EXISTS idx_approval_records_approver ON approval_records(approver_id);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_user_id ON employee_profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_employee_no ON employee_profiles(employee_no);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_profiles_user_id
      ON employee_profiles(user_id) WHERE user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_profiles_employee_no
      ON employee_profiles(employee_no) WHERE employee_no IS NOT NULL AND BTRIM(employee_no) <> '';
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_id_number ON employee_profiles(id_number);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_status ON employee_profiles(status);
    CREATE INDEX IF NOT EXISTS idx_employee_profiles_department ON employee_profiles(department);
    CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id ON employee_documents(employee_id);
    CREATE INDEX IF NOT EXISTS idx_employee_documents_document_type ON employee_documents(document_type);
    CREATE INDEX IF NOT EXISTS idx_employee_salary_profiles_source_document ON employee_salary_profiles(source_document_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_records_month ON payroll_records(payroll_month);
    CREATE INDEX IF NOT EXISTS idx_payroll_records_employee ON payroll_records(employee_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_change_logs_record ON payroll_change_logs(payroll_record_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_change_logs_employee_month ON payroll_change_logs(employee_id, payroll_month);
    CREATE INDEX IF NOT EXISTS idx_human_cost_receipts_month_category ON human_cost_receipts(payroll_month, category);
    CREATE INDEX IF NOT EXISTS idx_human_cost_receipts_status ON human_cost_receipts(recognition_status);
    CREATE INDEX IF NOT EXISTS idx_human_cost_receipt_items_receipt ON human_cost_receipt_items(receipt_id);
    CREATE INDEX IF NOT EXISTS idx_human_cost_receipt_items_employee ON human_cost_receipt_items(employee_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_tax_detail_files_month ON payroll_tax_detail_files(payroll_month);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_probation_confirmations_employee_id ON probation_confirmations(employee_id);
    CREATE INDEX IF NOT EXISTS idx_probation_confirmations_status ON probation_confirmations(status);
    CREATE INDEX IF NOT EXISTS idx_probation_documents_confirmation_id ON probation_documents(confirmation_id);
    CREATE INDEX IF NOT EXISTS idx_resignation_requests_employee_id ON resignation_requests(employee_id);
    CREATE INDEX IF NOT EXISTS idx_resignation_requests_employee_user_id ON resignation_requests(employee_user_id);
    CREATE INDEX IF NOT EXISTS idx_resignation_requests_handover_user_id ON resignation_requests(handover_user_id);
    CREATE INDEX IF NOT EXISTS idx_resignation_requests_status ON resignation_requests(status);
    CREATE INDEX IF NOT EXISTS idx_resignation_documents_request_id ON resignation_documents(request_id);
    CREATE INDEX IF NOT EXISTS idx_resignation_documents_type ON resignation_documents(document_type);
    CREATE INDEX IF NOT EXISTS idx_resignation_templates_type ON resignation_templates(template_type);
    CREATE INDEX IF NOT EXISTS idx_resignation_template_drafts_request ON resignation_template_drafts(request_id);
    CREATE INDEX IF NOT EXISTS idx_onboarding_templates_file_type ON onboarding_templates(file_type);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_scopes_parent_id ON reimbursement_scopes(parent_id);
    CREATE INDEX IF NOT EXISTS idx_reimbursement_scopes_sort_order ON reimbursement_scopes(sort_order);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_user_id ON leave_requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_approver_id ON leave_requests(approver_id);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_approval_notice ON leave_requests(user_id, status, approval_notice_unread);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_rejection_notice ON leave_requests(user_id, status, rejection_notice_unread);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_combination_group ON leave_requests(combination_group_id);
    CREATE INDEX IF NOT EXISTS idx_leave_requests_parent_request ON leave_requests(parent_request_id);
    CREATE INDEX IF NOT EXISTS idx_leave_balances_user_year ON leave_balances(user_id, year);
    CREATE INDEX IF NOT EXISTS idx_leave_approval_logs_req_id ON leave_approval_logs(leave_request_id);
  `);

    // ==================== 项目日志模块相关表（v2） ====================

    // 行政区字典
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_districts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // 项目类型字典
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_project_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // 办理事项字典（含标准办理天数，用于甘特图和超期预警）
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_matters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        standard_days INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // 合同付款状态字典
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_contract_statuses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // 项目主表（v2 结构化项目日志）
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        client_name TEXT NOT NULL,
        client_contact_name TEXT NOT NULL DEFAULT '',
        client_contact_phone TEXT NOT NULL DEFAULT '',
        district TEXT NOT NULL,
        project_type TEXT NOT NULL,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        owner_name TEXT NOT NULL,
        owner_position TEXT,
        start_date TEXT NOT NULL,
        is_completed BOOLEAN NOT NULL DEFAULT FALSE,
        completed_at TEXT,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // 日志主表（一日多条，每条绑定一个项目 + 一个办理事项）
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_entries (
        id TEXT PRIMARY KEY,
        log_date TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES worklog_projects(id),
        matter TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id),
        user_name TEXT NOT NULL,
        user_position TEXT,
        owner_user_id TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        contract_status TEXT,
        contract_note TEXT,
        work_note TEXT,
        is_finalized BOOLEAN NOT NULL DEFAULT FALSE,
        finalized_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // 日志进展记录表（时间线追加）
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_progress_notes (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES worklog_entries(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    // 日志附件表（图片 + 文档）
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_attachments (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES worklog_entries(id) ON DELETE CASCADE,
        file_kind TEXT NOT NULL CHECK(file_kind IN ('image', 'screenshot', 'photo', 'document')),
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        uploaded_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      )
    `);

    // 项目日志模块权限白名单（周报下载等精细权限）
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_permissions (
        id TEXT PRIMARY KEY,
        permission_code TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        UNIQUE(permission_code, user_id)
      )
    `);

    await ddlClient.query(`
      CREATE INDEX IF NOT EXISTS idx_worklog_projects_owner ON worklog_projects(owner_user_id);
      CREATE INDEX IF NOT EXISTS idx_worklog_projects_district ON worklog_projects(district);
      CREATE INDEX IF NOT EXISTS idx_worklog_projects_completed ON worklog_projects(is_completed);
      CREATE INDEX IF NOT EXISTS idx_worklog_entries_date ON worklog_entries(log_date);
      CREATE INDEX IF NOT EXISTS idx_worklog_entries_project ON worklog_entries(project_id);
      CREATE INDEX IF NOT EXISTS idx_worklog_entries_user ON worklog_entries(user_id);
      CREATE INDEX IF NOT EXISTS idx_worklog_entries_matter ON worklog_entries(matter);
      CREATE INDEX IF NOT EXISTS idx_worklog_attachments_entry ON worklog_attachments(entry_id);
      CREATE INDEX IF NOT EXISTS idx_worklog_permissions_code ON worklog_permissions(permission_code);
      CREATE INDEX IF NOT EXISTS idx_worklog_progress_entry ON worklog_progress_notes(entry_id);
    `);

    // 合同进度跟踪表
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_contract_progress (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES worklog_projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        amount NUMERIC,
        note TEXT,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_by_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS worklog_contract_attachments (
        id TEXT PRIMARY KEY,
        progress_id TEXT NOT NULL REFERENCES worklog_contract_progress(id) ON DELETE CASCADE,
        file_kind TEXT NOT NULL CHECK(file_kind IN ('contract', 'invoice', 'receipt', 'other')),
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        uploaded_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      )
    `);

    await ddlClient.query(`
      CREATE INDEX IF NOT EXISTS idx_worklog_contract_progress_project ON worklog_contract_progress(project_id);
      CREATE INDEX IF NOT EXISTS idx_worklog_contract_attachments_progress ON worklog_contract_attachments(progress_id);
    `);

    // 今日日志（纯文本）
    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS daily_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        log_date TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'submitted')),
        weather TEXT,
        traffic_restriction TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(log_date, user_id)
      )
    `);

    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS daily_log_attachments (
        id TEXT PRIMARY KEY,
        daily_log_id TEXT NOT NULL REFERENCES daily_logs(id) ON DELETE CASCADE,
        file_kind TEXT NOT NULL CHECK(file_kind IN ('image', 'document')),
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        uploaded_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      )
    `);

    await ddlClient.query(`
      CREATE TABLE IF NOT EXISTS weekly_summaries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        week_start TEXT NOT NULL,
        week_end TEXT NOT NULL,
        summary_content TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        UNIQUE(user_id, week_start)
      )
    `);

    await ddlClient.query(`
      CREATE INDEX IF NOT EXISTS idx_daily_logs_user_date ON daily_logs(user_id, log_date);
      CREATE INDEX IF NOT EXISTS idx_daily_log_attachments_log ON daily_log_attachments(daily_log_id);
      CREATE INDEX IF NOT EXISTS idx_weekly_summaries_user ON weekly_summaries(user_id, week_start);
    `);

    // 数据库迁移：添加 is_deduction 字段
    try {
      await ddlClient.query(`
        ALTER TABLE reimbursement_invoices
        ADD COLUMN IF NOT EXISTS is_deduction INTEGER NOT NULL DEFAULT 0
      `);
      console.log("✅ 数据库迁移：is_deduction 字段检查完成");
    } catch (error: any) {
      console.log("ℹ️  is_deduction 字段已存在或迁移失败:", error.message);
    }

    // 数据库迁移：新建 payment_proof_hashes 表，每张付款回单哈希单独一行，防止单张回单跨批次重放
    try {
      await ddlClient.query(`
        CREATE TABLE IF NOT EXISTS payment_proof_hashes (
          id TEXT PRIMARY KEY,
          file_hash TEXT NOT NULL UNIQUE,
          proof_no TEXT,
          batch_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);

      // 兼容旧表：检查 proof_no 列是否存在，不存在则添加（同时处理旧字段 transaction_id）
      const proofNoCheck = await ddlClient.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'payment_proof_hashes' AND column_name = 'proof_no'
      `);
      if (proofNoCheck.rows.length === 0) {
        // 检查是否有旧字段 transaction_id，有则重命名
        const oldColCheck = await ddlClient.query(`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'payment_proof_hashes' AND column_name = 'transaction_id'
        `);
        if (oldColCheck.rows.length > 0) {
          await ddlClient.query(
            `ALTER TABLE payment_proof_hashes RENAME COLUMN transaction_id TO proof_no`,
          );
          console.log("✅ 数据库迁移：transaction_id 重命名为 proof_no");
        } else {
          await ddlClient.query(
            `ALTER TABLE payment_proof_hashes ADD COLUMN proof_no TEXT`,
          );
          console.log("✅ 数据库迁移：payment_proof_hashes 添加 proof_no 字段");
        }
      }

      // 为 proof_no 创建唯一索引（允许 NULL，但非 NULL 值必须唯一）
      await ddlClient.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_proof_no
        ON payment_proof_hashes (proof_no)
        WHERE proof_no IS NOT NULL
      `);

      console.log("✅ 数据库迁移：payment_proof_hashes 表检查完成");
    } catch (error: any) {
      console.log("ℹ️  payment_proof_hashes 迁移失败:", error.message);
    }

    // 数据库迁移：新建 user_uploaded_files 表，替代 session 存储临时上传的发票文件
    // 解决 session 过期/刷新后草稿发票无法预览的问题
    try {
      await ddlClient.query(`
        CREATE TABLE IF NOT EXISTS user_uploaded_files (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(user_id, file_path)
        )
      `);
      await ddlClient.query(`
        CREATE INDEX IF NOT EXISTS idx_user_uploaded_files_user_id
        ON user_uploaded_files (user_id)
      `);
      console.log("✅ 数据库迁移：user_uploaded_files 表检查完成");
    } catch (error: any) {
      console.log("ℹ️  user_uploaded_files 迁移失败:", error.message);
    }

    // 数据库迁移：employee_profiles 添加 contract_end_date 字段
    try {
      const contractEndCol = await ddlClient.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'employee_profiles' AND column_name = 'contract_end_date'
      `);
      if (contractEndCol.rows.length === 0) {
        await ddlClient.query(
          `ALTER TABLE employee_profiles ADD COLUMN contract_end_date TEXT`,
        );
        console.log(
          "✅ 数据库迁移：employee_profiles 添加 contract_end_date 字段",
        );
      }
    } catch (error: any) {
      console.log("ℹ️  contract_end_date 迁移失败:", error.message);
    }

    // 数据库迁移：员工合同模板拟定日期
    try {
      await ddlClient.query(`
        ALTER TABLE employee_profiles
          ADD COLUMN IF NOT EXISTS contract_template_start_date TEXT,
          ADD COLUMN IF NOT EXISTS contract_template_end_date TEXT,
          ADD COLUMN IF NOT EXISTS probation_template_start_date TEXT,
          ADD COLUMN IF NOT EXISTS probation_template_end_date TEXT,
          ADD COLUMN IF NOT EXISTS last_contract_template_start_date TEXT,
          ADD COLUMN IF NOT EXISTS last_contract_template_end_date TEXT,
          ADD COLUMN IF NOT EXISTS last_probation_template_start_date TEXT,
          ADD COLUMN IF NOT EXISTS last_probation_template_end_date TEXT,
          ADD COLUMN IF NOT EXISTS last_contract_template_position TEXT
      `);
      console.log("✅ 数据库迁移：员工合同模板日期字段检查完成");
    } catch (error: any) {
      console.log("ℹ️  员工合同模板日期字段迁移失败:", error.message);
    }

    // 数据库迁移：劳动合同档案保存识别出的合同期限
    try {
      await ddlClient.query(`
        ALTER TABLE employee_documents
          ADD COLUMN IF NOT EXISTS contract_start_date TEXT,
          ADD COLUMN IF NOT EXISTS contract_end_date TEXT,
          ADD COLUMN IF NOT EXISTS contract_recognized_at TEXT,
          ADD COLUMN IF NOT EXISTS probation_end_date TEXT
      `);
      await ddlClient.query(`
        ALTER TABLE probation_confirmations
          ALTER COLUMN hire_date DROP NOT NULL,
          ALTER COLUMN probation_end_date DROP NOT NULL
      `);
      await ddlClient.query(`
        CREATE INDEX IF NOT EXISTS idx_employee_documents_contract_end
        ON employee_documents (employee_id, contract_end_date)
      `);
      await ddlClient.query(`
        CREATE INDEX IF NOT EXISTS idx_employee_documents_probation_end
        ON employee_documents (employee_id, probation_end_date)
      `);
      await ddlClient.query(`
        UPDATE employee_profiles ep
        SET last_contract_template_start_date = latest.contract_start_date,
            last_contract_template_end_date = latest.contract_end_date,
            last_probation_template_start_date = CASE
              WHEN latest.probation_end_date IS NOT NULL THEN latest.contract_start_date
              ELSE NULL
            END,
            last_probation_template_end_date = latest.probation_end_date,
            last_contract_template_position = NULLIF(BTRIM(ep.position), '')
        FROM (
          SELECT DISTINCT ON (employee_id)
            employee_id,
            contract_start_date,
            contract_end_date,
            probation_end_date
          FROM employee_documents
          WHERE document_type = 'contract'
            AND contract_start_date IS NOT NULL
            AND contract_end_date IS NOT NULL
          ORDER BY employee_id, contract_end_date DESC, created_at DESC
        ) latest
        WHERE latest.employee_id = ep.id
          AND ep.last_contract_template_start_date IS NULL
      `);
      const inferredContractCleanup = await ddlClient.query(`
        UPDATE employee_profiles ep
        SET contract_end_date = NULL
        WHERE ep.hire_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
          AND ep.contract_end_date = TO_CHAR(
            (ep.hire_date::date + INTERVAL '1 year')::date,
            'YYYY-MM-DD'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM employee_documents ed
            WHERE ed.employee_id = ep.id
              AND ed.document_type = 'contract'
              AND ed.contract_end_date IS NOT NULL
          )
      `);
      if ((inferredContractCleanup.rowCount ?? 0) > 0) {
        console.log(
          `✅ 已清理 ${inferredContractCleanup.rowCount} 条由入职日期推算的旧合同到期时间`,
        );
      }

      const recognizedContractDateSync = await ddlClient.query(`
        WITH recognized_contracts AS (
          SELECT
            employee_id,
            contract_start_date,
            contract_end_date,
            probation_end_date,
            created_at
          FROM employee_documents
          WHERE document_type = 'contract'
            AND contract_start_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
            AND contract_end_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
        ),
        contract_dates AS (
          SELECT DISTINCT ON (employee_id)
            employee_id,
            MIN(contract_start_date) OVER (PARTITION BY employee_id) AS hire_date,
            contract_end_date,
            FIRST_VALUE(probation_end_date) OVER (
              PARTITION BY employee_id
              ORDER BY contract_start_date ASC, created_at ASC
            ) AS probation_end_date
          FROM recognized_contracts
          ORDER BY employee_id, contract_end_date DESC, created_at DESC
        )
        UPDATE employee_profiles ep
        SET
          hire_date = contract_dates.hire_date,
          contract_end_date = contract_dates.contract_end_date
        FROM contract_dates
        WHERE ep.id = contract_dates.employee_id
          AND (
            ep.hire_date IS DISTINCT FROM contract_dates.hire_date
            OR ep.contract_end_date IS DISTINCT FROM contract_dates.contract_end_date
          )
      `);
      if ((recognizedContractDateSync.rowCount ?? 0) > 0) {
        console.log(
          `✅ 已按劳动合同同步 ${recognizedContractDateSync.rowCount} 名员工的入职及合同到期日期`,
        );
      }

      const missingContractDateCleanup = await ddlClient.query(`
        UPDATE employee_profiles ep
        SET
          hire_date = NULL,
          contract_end_date = NULL
        WHERE (ep.hire_date IS NOT NULL OR ep.contract_end_date IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1
            FROM employee_documents ed
            WHERE ed.employee_id = ep.id
              AND ed.document_type = 'contract'
              AND ed.contract_start_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
              AND ed.contract_end_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
          )
      `);
      if ((missingContractDateCleanup.rowCount ?? 0) > 0) {
        console.log(
          `✅ 已清理 ${missingContractDateCleanup.rowCount} 名无合同依据员工的历史日期`,
        );
      }

      const probationDateSync = await ddlClient.query(`
        WITH recognized_contracts AS (
          SELECT
            employee_id,
            contract_start_date,
            contract_end_date,
            probation_end_date,
            created_at
          FROM employee_documents
          WHERE document_type = 'contract'
            AND contract_start_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
            AND contract_end_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
        ),
        contract_dates AS (
          SELECT DISTINCT ON (employee_id)
            employee_id,
            MIN(contract_start_date) OVER (PARTITION BY employee_id) AS hire_date,
            FIRST_VALUE(probation_end_date) OVER (
              PARTITION BY employee_id
              ORDER BY contract_start_date ASC, created_at ASC
            ) AS probation_end_date
          FROM recognized_contracts
          ORDER BY employee_id, contract_end_date DESC, created_at DESC
        )
        UPDATE probation_confirmations pc
        SET
          hire_date = contract_dates.hire_date,
          probation_end_date = contract_dates.probation_end_date,
          updated_at = NOW()::text
        FROM contract_dates
        WHERE pc.employee_id = contract_dates.employee_id
          AND (
            pc.hire_date IS DISTINCT FROM contract_dates.hire_date
            OR pc.probation_end_date IS DISTINCT FROM contract_dates.probation_end_date
          )
      `);
      if ((probationDateSync.rowCount ?? 0) > 0) {
        console.log(
          `✅ 已按劳动合同同步 ${probationDateSync.rowCount} 条转正记录日期`,
        );
      }

      const missingContractProbationCleanup = await ddlClient.query(`
        UPDATE probation_confirmations pc
        SET
          hire_date = NULL,
          probation_end_date = NULL,
          updated_at = NOW()::text
        WHERE (pc.hire_date IS NOT NULL OR pc.probation_end_date IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1
            FROM employee_documents ed
            WHERE ed.employee_id = pc.employee_id
              AND ed.document_type = 'contract'
              AND ed.contract_start_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
              AND ed.contract_end_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
          )
      `);
      if ((missingContractProbationCleanup.rowCount ?? 0) > 0) {
        console.log(
          `✅ 已清理 ${missingContractProbationCleanup.rowCount} 条无合同依据转正记录的历史日期`,
        );
      }
      console.log("✅ 数据库迁移：劳动合同期限字段检查完成");
    } catch (error: any) {
      console.log("ℹ️  劳动合同期限字段迁移失败:", error.message);
    }

    // 数据库迁移：新建 probation_history 表，记录管理员将员工改回实习期时的历史转正记录
    try {
      await ddlClient.query(`
        CREATE TABLE IF NOT EXISTS probation_history (
          id TEXT PRIMARY KEY,
          employee_id TEXT NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
          confirmation_id TEXT,
          hire_date TEXT,
          probation_end_date TEXT,
          status TEXT,
          submit_time TEXT,
          approve_time TEXT,
          approver_id TEXT,
          approver_comment TEXT,
          application_comment TEXT,
          reset_reason TEXT,
          reset_by TEXT REFERENCES users(id),
          reset_at TEXT NOT NULL,
          new_hire_date TEXT,
          form_version INTEGER NOT NULL DEFAULT 0,
          review_stage TEXT NOT NULL DEFAULT 'employee',
          approval_records_json TEXT NOT NULL DEFAULT '[]',
          signature_history_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL
        )
      `);
      await ddlClient.query(`
        ALTER TABLE probation_history
          ADD COLUMN IF NOT EXISTS form_version INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS review_stage TEXT NOT NULL DEFAULT 'employee',
          ADD COLUMN IF NOT EXISTS approval_records_json TEXT NOT NULL DEFAULT '[]',
          ADD COLUMN IF NOT EXISTS signature_history_json TEXT NOT NULL DEFAULT '[]'
      `);
      await ddlClient.query(`
        CREATE INDEX IF NOT EXISTS idx_probation_history_employee_id
        ON probation_history (employee_id)
      `);
      console.log("✅ 数据库迁移：probation_history 表检查完成");
    } catch (error: any) {
      console.log("ℹ️  probation_history 迁移失败:", error.message);
    }

    // 数据库迁移：更新离职模板与档案约束，支持管理员维护的五类离职材料。
    try {
      await ddlClient.query(`
        ALTER TABLE resignation_requests
        ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id)
      `);
      await ddlClient.query(`
        ALTER TABLE resignation_requests
        ADD COLUMN IF NOT EXISTS created_by_name TEXT
      `);
      await ddlClient.query(`
        ALTER TABLE resignation_requests
        ALTER COLUMN employee_user_id DROP NOT NULL
      `);
      await ddlClient.query(`
        ALTER TABLE resignation_requests
        ALTER COLUMN handover_user_id DROP NOT NULL
      `);
      await ddlClient.query(`
        ALTER TABLE resignation_templates
        DROP CONSTRAINT IF EXISTS resignation_templates_template_type_check
      `);
      await ddlClient.query(`
        ALTER TABLE resignation_templates
        ADD CONSTRAINT resignation_templates_template_type_check
        CHECK(template_type IN (
          'application_form', 'handover_form', 'termination_proof', 'asset_handover',
          'compensation_agreement', 'expense_settlement_agreement',
          'partner_dividend_settlement', 'termination_agreement',
          'employee_handover_form', 'settlement_confirmation', 'resignation_certificate'
        ))
      `);
      console.log(
        "✅ 数据库迁移：resignation_templates template_type 约束已更新",
      );
    } catch (error: any) {
      console.log("ℹ️  resignation_templates 约束迁移失败:", error.message);
    }

    try {
      await ddlClient.query(`
        ALTER TABLE resignation_template_drafts
        ADD COLUMN IF NOT EXISTS template_id TEXT REFERENCES resignation_templates(id) ON DELETE CASCADE
      `);
      await ddlClient.query(`
        ALTER TABLE resignation_template_drafts
        ADD COLUMN IF NOT EXISTS overlay_json TEXT
      `);
      await ddlClient.query(`
        UPDATE resignation_template_drafts draft
        SET template_id = (
          SELECT template.id
          FROM resignation_templates template
          WHERE template.template_type = draft.template_type
          ORDER BY template.created_at DESC
          LIMIT 1
        )
        WHERE draft.template_id IS NULL
      `);
      console.log("✅ 数据库迁移：离职模板草稿版本及原版叠加字段检查完成");
    } catch (error: any) {
      console.log("ℹ️  离职模板草稿版本字段迁移失败:", error.message);
    }

    // 数据库迁移：扩展 resignation_documents.document_type 的 CHECK 约束
    // 旧约束只允许 'application_form' 和 'handover_form'，
    // 需要支持 'handover_form_employee'、'handover_form_handover'、'termination_proof'、
    // 'asset_handover'、'compensation_agreement'、'expense_settlement_agreement'
    try {
      // 检查当前约束是否需要更新
      const constraintCheck = await ddlClient.query(`
        SELECT conname, pg_get_constraintdef(oid) as def
        FROM pg_constraint
        WHERE conrelid = 'resignation_documents'::regclass
          AND conname = 'resignation_documents_document_type_check'
      `);

      if (constraintCheck.rows.length > 0) {
        const currentDef = constraintCheck.rows[0].def as string;
        if (!currentDef.includes("resignation_certificate")) {
          // 先将旧类型数据迁移为新类型
          await ddlClient.query(`
            UPDATE resignation_documents SET document_type = 'handover_form_employee'
            WHERE document_type = 'handover_form' AND uploader_role = 'employee'
          `);
          await ddlClient.query(`
            UPDATE resignation_documents SET document_type = 'handover_form_handover'
            WHERE document_type = 'handover_form' AND uploader_role = 'handover'
          `);

          // 删除旧约束，添加新约束
          await ddlClient.query(`
            ALTER TABLE resignation_documents DROP CONSTRAINT resignation_documents_document_type_check
          `);
          await ddlClient.query(`
            ALTER TABLE resignation_documents ADD CONSTRAINT resignation_documents_document_type_check
            CHECK (document_type IN (
              'application_form', 'handover_form',
              'handover_form_employee', 'handover_form_handover',
              'termination_proof', 'asset_handover',
              'compensation_agreement', 'expense_settlement_agreement',
              'termination_agreement', 'employee_handover_form',
              'settlement_confirmation', 'resignation_certificate'
            ))
          `);
          console.log(
            "✅ 数据库迁移：resignation_documents document_type 约束已更新",
          );
        }
      }
    } catch (error: any) {
      console.log(
        "ℹ️  resignation_documents document_type 约束迁移:",
        error.message,
      );
    }

    // DDL 完成，销毁初始化连接，确保后续查询用干净的连接
  } finally {
    await ddlClient.end();
  }

  const migrated = await db.run(
    `UPDATE reimbursements SET status = 'approved', updated_at = NOW()::text WHERE status = 'paying'`,
  );
  if (migrated.changes > 0) {
    console.log(
      `✅ 已将 ${migrated.changes} 条 paying 状态记录迁移为 approved`,
    );
  }

  const existingScopes = await db.get<{ count: string }>(
    "SELECT COUNT(*) as count FROM reimbursement_scopes",
  );
  if (Number(existingScopes?.count || 0) === 0) {
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO reimbursement_scopes (id, parent_id, name, value, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?),
              (?, ?, ?, ?, ?, ?, ?, ?)`,
      "scope_1",
      null,
      "公司内部",
      "company_internal",
      1,
      true,
      now,
      now,
      "scope_2",
      null,
      "海淀区",
      "haidian",
      2,
      true,
      now,
      now,
      "scope_3",
      null,
      "朝阳区",
      "chaoyang",
      3,
      true,
      now,
      now,
      "scope_2_1",
      "scope_2",
      "GJDW",
      "haidian_gjdw",
      1,
      true,
      now,
      now,
      "scope_2_2",
      "scope_2",
      "WFAH",
      "haidian_wfah",
      2,
      true,
      now,
      now,
      "scope_3_1",
      "scope_3",
      "GJDW",
      "chaoyang_gjdw",
      1,
      true,
      now,
      now,
    );
    console.log("✅ 初始化默认报销范围配置");
  }

  const employeeNumberSyncResult = await db.run(
    `
    UPDATE employee_profiles ep
    SET employee_no = u.employee_no,
        updated_at = CASE
          WHEN COALESCE(ep.employee_no, '') <> COALESCE(u.employee_no, '') THEN ?
          ELSE ep.updated_at
        END
    FROM users u
    WHERE ep.user_id = u.id
      AND u.employee_no IS NOT NULL
      AND BTRIM(u.employee_no) <> ''
      AND COALESCE(ep.employee_no, '') <> COALESCE(u.employee_no, '')
  `,
    new Date().toISOString(),
  );
  if (employeeNumberSyncResult.changes > 0) {
    console.log(
      `✅ 已同步 ${employeeNumberSyncResult.changes} 份员工档案的员工编号`,
    );
  }

  // 工资接口依赖版本字段；该迁移必须独立成功，不能被其他历史脏数据回滚。
  await db.run(
    `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`,
  );
  await db.run(
    `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS housing_fund_base NUMERIC`,
  );
  await db.run(
    `UPDATE payroll_records
     SET housing_fund_base = monthly_salary
     WHERE housing_fund_base IS NULL`,
  );
  await db.run(
    `ALTER TABLE payroll_records ALTER COLUMN housing_fund_base SET DEFAULT 0`,
  );
  await db.run(
    `ALTER TABLE payroll_records ALTER COLUMN housing_fund_base SET NOT NULL`,
  );
  await db.run(
    `ALTER TABLE payroll_records ADD COLUMN IF NOT EXISTS housing_fund_base_is_manual BOOLEAN NOT NULL DEFAULT FALSE`,
  );
  await db.run(
    `ALTER TABLE human_cost_receipts ADD COLUMN IF NOT EXISTS ignored_item_count INTEGER NOT NULL DEFAULT 0`,
  );
  await db.run(
    `ALTER TABLE human_cost_receipts ADD COLUMN IF NOT EXISTS recognition_version INTEGER NOT NULL DEFAULT 1`,
  );

  // 允许直接创建为在职的员工补录转正申请表，不伪造转正审批记录。
  await db.run(`
    ALTER TABLE probation_documents
    ADD COLUMN IF NOT EXISTS employee_id TEXT REFERENCES employee_profiles(id) ON DELETE CASCADE
  `);
  await db.run(`
    UPDATE probation_documents pd
    SET employee_id = pc.employee_id
    FROM probation_confirmations pc
    WHERE pd.confirmation_id = pc.id
      AND pd.employee_id IS NULL
  `);
  await db.run(
    `ALTER TABLE probation_documents ALTER COLUMN confirmation_id DROP NOT NULL`,
  );
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_probation_documents_employee_id
    ON probation_documents(employee_id)
  `);

  // 在线转正申请单：表单版本、分级签署状态与正式文件来源。
  await db.run(`
    ALTER TABLE probation_confirmations
      ADD COLUMN IF NOT EXISTS form_version INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS review_stage TEXT NOT NULL DEFAULT 'employee',
      ADD COLUMN IF NOT EXISTS conversion_type TEXT NOT NULL DEFAULT 'normal',
      ADD COLUMN IF NOT EXISTS conversion_type_other TEXT,
      ADD COLUMN IF NOT EXISTS self_statement TEXT,
      ADD COLUMN IF NOT EXISTS applicant_name_snapshot TEXT,
      ADD COLUMN IF NOT EXISTS department_snapshot TEXT,
      ADD COLUMN IF NOT EXISTS position_snapshot TEXT,
      ADD COLUMN IF NOT EXISTS supervisor_id TEXT REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS supervisor_name_snapshot TEXT,
      ADD COLUMN IF NOT EXISTS hr_approver_id TEXT REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS hr_approver_name_snapshot TEXT,
      ADD COLUMN IF NOT EXISTS chairman_id TEXT REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS chairman_name_snapshot TEXT,
      ADD COLUMN IF NOT EXISTS application_comment TEXT,
      ADD COLUMN IF NOT EXISTS formal_document_generated_at TEXT
  `);
  await assertRequiredDatabaseSchema();
  await db.run(`
    UPDATE probation_confirmations pc
    SET supervisor_name_snapshot = u.name
    FROM users u
    WHERE pc.supervisor_id = u.id
      AND pc.supervisor_name_snapshot IS NULL
  `);
  await db.run(`
    UPDATE probation_confirmations pc
    SET hr_approver_id = candidate.id
    FROM (
      SELECT id
      FROM users
      WHERE status = 'active'
        AND role IN ('admin', 'super_admin')
      ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, created_at ASC
      LIMIT 1
    ) candidate
    WHERE pc.form_version > 0
      AND pc.hr_approver_id IS NULL
  `);
  await db.run(`
    UPDATE probation_confirmations pc
    SET hr_approver_name_snapshot = u.name
    FROM users u
    WHERE pc.hr_approver_id = u.id
      AND pc.hr_approver_name_snapshot IS NULL
  `);
  await db.run(`
    UPDATE probation_confirmations pc
    SET chairman_id = candidate.id
    FROM (
      SELECT id
      FROM users
      WHERE status = 'active'
        AND role = 'chairman'
      ORDER BY created_at ASC
      LIMIT 1
    ) candidate
    WHERE pc.form_version > 0
      AND pc.chairman_id IS NULL
  `);
  await db.run(`
    UPDATE probation_confirmations pc
    SET chairman_name_snapshot = u.name
    FROM users u
    WHERE pc.chairman_id = u.id
      AND pc.chairman_name_snapshot IS NULL
  `);
  await db.run(`
    UPDATE probation_confirmations
    SET review_stage = CASE
      WHEN status = 'approved' THEN 'completed'
      WHEN status = 'submitted' THEN 'general_manager'
      ELSE 'employee'
    END
    WHERE form_version = 0
  `);
  await db.run(`
    ALTER TABLE probation_documents
      ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'uploaded',
      ADD COLUMN IF NOT EXISTS form_version INTEGER NOT NULL DEFAULT 0
  `);
  await db.run(`
    CREATE TABLE IF NOT EXISTS probation_signature_records (
      id TEXT PRIMARY KEY,
      confirmation_id TEXT NOT NULL REFERENCES probation_confirmations(id) ON DELETE CASCADE,
      form_version INTEGER NOT NULL,
      stage TEXT NOT NULL,
      signer_id TEXT NOT NULL REFERENCES users(id),
      signer_name TEXT NOT NULL,
      signer_role TEXT NOT NULL,
      signer_department TEXT,
      signer_position TEXT,
      signature_path TEXT NOT NULL,
      signature_type TEXT NOT NULL DEFAULT 'personal',
      signature_owner_name TEXT,
      opinion TEXT,
      decision TEXT NOT NULL,
      signed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(confirmation_id, form_version, stage)
    )
  `);
  await db.run(`
    ALTER TABLE probation_signature_records
      ADD COLUMN IF NOT EXISTS signature_type TEXT NOT NULL DEFAULT 'personal',
      ADD COLUMN IF NOT EXISTS signature_owner_name TEXT
  `);
  await db.run(`
    UPDATE probation_signature_records
    SET signature_owner_name = signer_name
    WHERE signature_owner_name IS NULL
  `);
  await db.run(`
    ALTER TABLE probation_signature_records
    ALTER COLUMN signature_owner_name SET NOT NULL
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_probation_signature_records_confirmation
    ON probation_signature_records(confirmation_id, form_version, stage)
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_probation_confirmations_review_stage
    ON probation_confirmations(status, review_stage, supervisor_id)
  `);

  await db.run(`
    UPDATE probation_confirmations pc
    SET status = 'approved',
        approve_time = COALESCE(pc.approve_time, pc.updated_at),
        approver_comment = COALESCE(pc.approver_comment, '历史在职数据兼容迁移')
    FROM employee_profiles ep
    WHERE pc.employee_id = ep.id
      AND ep.employment_status = 'active'
      AND pc.status = 'pending'
      AND pc.submit_time IS NULL
  `);
  await db.run(`
    UPDATE probation_confirmations
    SET review_stage = 'completed'
    WHERE status = 'approved'
      AND form_version = 0
      AND review_stage <> 'completed'
  `);

  const constraintMigrations = [
    {
      name: "用户角色",
      statements: [
        `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`,
        `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('super_admin', 'chairman', 'admin', 'general_manager', 'boss', 'user', 'guest'))`,
      ],
    },
    {
      name: "用户状态",
      statements: [
        `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check`,
        `ALTER TABLE users ADD CONSTRAINT users_status_check CHECK(status IN ('active', 'inactive'))`,
      ],
    },
    {
      name: "员工状态",
      statements: [
        `ALTER TABLE employee_profiles DROP CONSTRAINT IF EXISTS employee_profiles_employment_status_check`,
        `ALTER TABLE employee_profiles ADD CONSTRAINT employee_profiles_employment_status_check CHECK(employment_status IN ('active', 'probation', 'resigned', 'on_leave'))`,
      ],
    },
    {
      name: "员工档案类型",
      statements: [
        `ALTER TABLE employee_documents DROP CONSTRAINT IF EXISTS employee_documents_document_type_check`,
        `ALTER TABLE employee_documents ADD CONSTRAINT employee_documents_document_type_check CHECK(document_type IN ('invitation', 'application', 'contract', 'nda', 'declaration', 'asset_handover', 'id_card', 'health_report', 'diploma', 'bank_card', 'other'))`,
      ],
    },
    {
      name: "转正状态",
      statements: [
        `ALTER TABLE probation_confirmations DROP CONSTRAINT IF EXISTS probation_confirmations_status_check`,
        `ALTER TABLE probation_confirmations ADD CONSTRAINT probation_confirmations_status_check CHECK(status IN ('pending', 'submitted', 'approved', 'rejected'))`,
        `ALTER TABLE probation_confirmations DROP CONSTRAINT IF EXISTS probation_confirmations_review_stage_check`,
        `ALTER TABLE probation_confirmations ADD CONSTRAINT probation_confirmations_review_stage_check CHECK(review_stage IN ('employee', 'supervisor', 'hr', 'general_manager', 'completed'))`,
        `ALTER TABLE probation_confirmations DROP CONSTRAINT IF EXISTS probation_confirmations_conversion_type_check`,
        `ALTER TABLE probation_confirmations ADD CONSTRAINT probation_confirmations_conversion_type_check CHECK(conversion_type IN ('normal', 'early', 'extended', 'other'))`,
      ],
    },
    {
      name: "转正文档类型",
      statements: [
        `ALTER TABLE probation_documents DROP CONSTRAINT IF EXISTS probation_documents_document_type_check`,
        `ALTER TABLE probation_documents ADD CONSTRAINT probation_documents_document_type_check CHECK(document_type = 'application')`,
        `ALTER TABLE probation_documents DROP CONSTRAINT IF EXISTS probation_documents_owner_check`,
        `ALTER TABLE probation_documents ADD CONSTRAINT probation_documents_owner_check CHECK(confirmation_id IS NOT NULL OR employee_id IS NOT NULL)`,
        `ALTER TABLE probation_documents DROP CONSTRAINT IF EXISTS probation_documents_source_type_check`,
        `ALTER TABLE probation_documents ADD CONSTRAINT probation_documents_source_type_check CHECK(source_type IN ('uploaded', 'generated', 'official'))`,
        `ALTER TABLE probation_signature_records DROP CONSTRAINT IF EXISTS probation_signature_records_stage_check`,
        `ALTER TABLE probation_signature_records ADD CONSTRAINT probation_signature_records_stage_check CHECK(stage IN ('employee', 'supervisor', 'hr', 'general_manager'))`,
        `ALTER TABLE probation_signature_records DROP CONSTRAINT IF EXISTS probation_signature_records_decision_check`,
        `ALTER TABLE probation_signature_records ADD CONSTRAINT probation_signature_records_decision_check CHECK(decision IN ('submit', 'approve', 'reject'))`,
        `ALTER TABLE probation_signature_records DROP CONSTRAINT IF EXISTS probation_signature_records_signature_type_check`,
        `ALTER TABLE probation_signature_records ADD CONSTRAINT probation_signature_records_signature_type_check CHECK(signature_type IN ('personal', 'general_manager'))`,
      ],
    },
    {
      name: "入职模板类型",
      statements: [
        `ALTER TABLE onboarding_templates DROP CONSTRAINT IF EXISTS onboarding_templates_file_type_check`,
        `ALTER TABLE onboarding_templates ADD CONSTRAINT onboarding_templates_file_type_check CHECK(file_type IN ('invitation', 'application', 'contract', 'nda', 'declaration', 'asset'))`,
      ],
    },
    {
      name: "离职文档版本",
      statements: [
        `ALTER TABLE resignation_documents DROP CONSTRAINT IF EXISTS resignation_documents_is_current_check`,
        `ALTER TABLE resignation_documents ADD CONSTRAINT resignation_documents_is_current_check CHECK(is_current IN (0, 1))`,
      ],
    },
    {
      name: "请假申请状态",
      statements: [
        `ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check`,
        `ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_allowed_check`,
        `ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_allowed_check CHECK(status IN ('draft', 'pending', 'approved', 'rejected', 'cancelled'))`,
      ],
    },
    {
      name: "请假申请类型",
      statements: [
        `ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_application_kind_check`,
        `ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_application_kind_check CHECK(application_kind IN ('normal', 'combined', 'extension', 'supplement'))`,
      ],
    },
    {
      name: "请假半天边界",
      statements: [
        `ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_half_day_check`,
        `ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_half_day_check CHECK(start_half IN ('morning', 'afternoon') AND end_half IN ('morning', 'afternoon'))`,
      ],
    },
    {
      name: "请假天数",
      statements: [
        `ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_total_days_positive_check`,
        `ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_total_days_positive_check CHECK(total_days > 0)`,
      ],
    },
    {
      name: "假期余额",
      statements: [
        `ALTER TABLE leave_balances DROP CONSTRAINT IF EXISTS leave_balances_values_check`,
        `ALTER TABLE leave_balances ADD CONSTRAINT leave_balances_values_check CHECK(year BETWEEN 2000 AND 2200 AND total_days >= 0 AND used_days >= 0 AND pending_days >= 0 AND used_days + pending_days <= total_days)`,
      ],
    },
    {
      name: "工资版本",
      statements: [
        `ALTER TABLE payroll_records DROP CONSTRAINT IF EXISTS payroll_records_version_check`,
        `ALTER TABLE payroll_records ADD CONSTRAINT payroll_records_version_check CHECK(version >= 1)`,
      ],
    },
    {
      name: "工资公积金缴费基数",
      statements: [
        `ALTER TABLE payroll_records DROP CONSTRAINT IF EXISTS payroll_records_housing_fund_base_check`,
        `ALTER TABLE payroll_records ADD CONSTRAINT payroll_records_housing_fund_base_check CHECK(housing_fund_base >= 0)`,
      ],
    },
    {
      name: "工资变更日志字段",
      statements: [
        `ALTER TABLE payroll_change_logs DROP CONSTRAINT IF EXISTS payroll_change_logs_field_name_check`,
        `ALTER TABLE payroll_change_logs ADD CONSTRAINT payroll_change_logs_field_name_check CHECK(field_name IN ('monthly_salary', 'housing_fund_base', 'contribution_base', 'individual_income_tax'))`,
      ],
    },
    {
      name: "人力成本回单忽略笔数",
      statements: [
        `ALTER TABLE human_cost_receipts DROP CONSTRAINT IF EXISTS human_cost_receipts_ignored_item_count_check`,
        `ALTER TABLE human_cost_receipts ADD CONSTRAINT human_cost_receipts_ignored_item_count_check CHECK(ignored_item_count >= 0)`,
      ],
    },
    {
      name: "人力成本回单识别版本",
      statements: [
        `ALTER TABLE human_cost_receipts DROP CONSTRAINT IF EXISTS human_cost_receipts_recognition_version_check`,
        `ALTER TABLE human_cost_receipts ADD CONSTRAINT human_cost_receipts_recognition_version_check CHECK(recognition_version >= 1)`,
      ],
    },
  ];
  for (const migration of constraintMigrations) {
    try {
      await db.transaction(async (client) => {
        for (const statement of migration.statements)
          await client.query(statement);
      });
    } catch (error: any) {
      console.log(`ℹ️  人事模块${migration.name}约束迁移:`, error.message);
    }
  }
  console.log("✅ 数据库迁移：人事状态、假期余额和工资版本约束已检查");

  // 管理员在人事转正档案上传的盖章文件独立标记为正式归档件。
  try {
    const directOfficialDocuments = await db.run(`
      UPDATE probation_documents pd
      SET source_type = 'official'
      FROM users u
      WHERE pd.uploaded_by = u.id
        AND pd.confirmation_id IS NULL
        AND pd.source_type = 'uploaded'
        AND u.role IN ('admin', 'super_admin')
    `);
    const workflowOfficialDocuments = await db.run(`
      UPDATE probation_documents pd
      SET source_type = 'official',
          form_version = pc.form_version
      FROM users u, probation_confirmations pc
      WHERE pd.uploaded_by = u.id
        AND pd.confirmation_id = pc.id
        AND pd.source_type = 'uploaded'
        AND pc.status = 'approved'
        AND u.role IN ('admin', 'super_admin')
    `);
    const migratedOfficialDocuments =
      directOfficialDocuments.changes + workflowOfficialDocuments.changes;
    if (migratedOfficialDocuments > 0) {
      console.log(
        `✅ 已将 ${migratedOfficialDocuments} 份管理员转正档案标记为正式盖章文件`,
      );
    }
  } catch (error: any) {
    console.log("ℹ️  转正正式盖章文件迁移:", error.message);
  }

  // 旧版撤回记录使用 cancelled，新版统一转为可重新提交、可永久删除的草稿。
  try {
    const migratedLeaveDrafts = await db.run(
      `UPDATE leave_requests
       SET status = 'draft',
           balance_reserved = FALSE,
           cancelled_at = COALESCE(cancelled_at, updated_at, created_at),
           updated_at = ?
       WHERE status = 'cancelled'`,
      new Date().toISOString(),
    );
    if (migratedLeaveDrafts.changes > 0) {
      console.log(
        `✅ 已将 ${migratedLeaveDrafts.changes} 条历史已撤销请假迁移为草稿`,
      );
    }
  } catch (error: any) {
    console.log("ℹ️  请假历史草稿迁移:", error.message);
  }

  // 普通员工请假由总经理审批，总经理请假由董事长审批。
  try {
    const leaveApproverMigration = await db.run(
      `
      WITH request_targets AS (
        SELECT lr.id AS request_id,
               lr.user_id,
               CASE
                 WHEN applicant.role = 'general_manager' THEN 'chairman'
                 ELSE 'general_manager'
               END AS approver_role
        FROM leave_requests lr
        INNER JOIN users applicant ON applicant.id = lr.user_id
        WHERE lr.status = 'pending'
      ),
      preferred_approvers AS (
        SELECT target.request_id, approver.id AS approver_id, approver.name AS approver_name
        FROM request_targets target
        LEFT JOIN LATERAL (
          SELECT u.id, u.name
          FROM users u
          WHERE u.status = 'active'
            AND u.id != target.user_id
            AND u.role = target.approver_role
          ORDER BY u.created_at ASC, u.id ASC
          LIMIT 1
        ) approver ON TRUE
      )
      UPDATE leave_requests lr
      SET approver_id = preferred.approver_id,
          approver_name = preferred.approver_name,
          updated_at = ?
      FROM preferred_approvers preferred
      WHERE lr.id = preferred.request_id
        AND (
          lr.approver_id IS DISTINCT FROM preferred.approver_id
          OR lr.approver_name IS DISTINCT FROM preferred.approver_name
        )
    `,
      new Date().toISOString(),
    );
    if (leaveApproverMigration.changes > 0) {
      console.log(
        `✅ 已按申请人角色重新分配 ${leaveApproverMigration.changes} 条历史请假待办`,
      );
    }
  } catch (error: any) {
    console.log("ℹ️  请假审批人迁移:", error.message);
  }

  const existingConfig = await db.get<{ id: string }>(
    "SELECT id FROM department_position_configs WHERE id = ?",
    "default",
  );
  if (!existingConfig) {
    const defaultConfig = {
      行政部: ["行政主管", "行政专员", "财务", "出纳"],
      项目部: ["项目经理", "员工"],
    };
    const now = new Date().toISOString();
    await db.run(
      "INSERT INTO department_position_configs (id, config_json, updated_at) VALUES (?, ?, ?)",
      "default",
      JSON.stringify(defaultConfig),
      now,
    );
    console.log("✅ 初始化默认部门职位配置");
  }

  // 数据库迁移：resignation_documents 添加 is_current 字段
  try {
    const colCheck = await db.get<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'resignation_documents' AND column_name = 'is_current'
    `);
    if (!colCheck) {
      await db.run(
        `ALTER TABLE resignation_documents ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1`,
      );
      console.log("✅ 数据库迁移：resignation_documents 添加 is_current 字段");
    }
  } catch (error: any) {
    console.log("ℹ️  is_current 字段迁移:", error.message);
  }

  // 数据库迁移：resignation_requests 添加 reject_target 字段，记录驳回对象
  try {
    const rejectTargetCheck = await db.get<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'resignation_requests' AND column_name = 'reject_target'
    `);
    if (!rejectTargetCheck) {
      await db.run(
        `ALTER TABLE resignation_requests ADD COLUMN reject_target TEXT`,
      );
      console.log(
        "✅ 数据库迁移：resignation_requests 添加 reject_target 字段",
      );
    }
  } catch (error: any) {
    console.log("ℹ️  reject_target 字段迁移:", error.message);
  }

  // 数据库迁移：离职档案齐全后进入待确认状态，管理员确认后才完成离职
  try {
    await db.run(`
      ALTER TABLE resignation_requests DROP CONSTRAINT IF EXISTS resignation_requests_status_check
    `);
    await db.run(`
      ALTER TABLE resignation_requests ADD CONSTRAINT resignation_requests_status_check
      CHECK(status IN ('draft', 'pending_confirmation', 'submitted', 'handover_confirmed', 'mutual_confirmed', 'approved', 'rejected', 'handover_rejected'))
    `);
    await db.run(`
      UPDATE resignation_requests rr
      SET status = 'pending_confirmation'
      WHERE rr.status = 'draft'
        AND (
          SELECT COUNT(DISTINCT rd.document_type)
          FROM resignation_documents rd
          WHERE rd.request_id = rr.id
            AND rd.is_current = 1
            AND rd.document_type IN (
              'termination_agreement',
              'employee_handover_form',
              'settlement_confirmation',
              'compensation_agreement',
              'resignation_certificate'
            )
        ) = 5
    `);
    await db.run(`
      UPDATE resignation_requests rr
      SET status = 'draft'
      WHERE rr.status = 'pending_confirmation'
        AND (
          SELECT COUNT(DISTINCT rd.document_type)
          FROM resignation_documents rd
          WHERE rd.request_id = rr.id
            AND rd.is_current = 1
            AND rd.document_type IN (
              'termination_agreement',
              'employee_handover_form',
              'settlement_confirmation',
              'compensation_agreement',
              'resignation_certificate'
            )
        ) < 5
    `);
    console.log("✅ 数据库迁移：resignation_requests status 约束已更新");
  } catch (error: any) {
    console.log("ℹ️  resignation_requests status 约束迁移:", error.message);
  }

  // 初始化假期类型配置
  const existingLeaveTypes = await db.get<{ count: string }>(
    "SELECT COUNT(*) as count FROM leave_type_configs",
  );
  if (Number(existingLeaveTypes?.count || 0) === 0) {
    const now = new Date().toISOString();
    const leaveTypes = [
      {
        id: "lt_annual",
        code: "annual",
        name: "年假",
        requires_attachment: false,
        requires_balance_check: true,
        default_days: 5,
        description:
          "所有员工每年默认5天年假，满10年上调至10天，满20年上调至15天",
        sort_order: 1,
      },
      {
        id: "lt_personal",
        code: "personal",
        name: "带薪事假",
        requires_attachment: false,
        requires_balance_check: true,
        default_days: 3,
        description: "个人原因请假，每年默认3天带薪额度",
        sort_order: 2,
      },
      {
        id: "lt_sick",
        code: "sick",
        name: "病假",
        requires_attachment: true,
        requires_balance_check: true,
        default_days: 30,
        description: "因病请假，需提供三甲医院病历或假条",
        sort_order: 3,
      },
      {
        id: "lt_compensatory",
        code: "compensatory",
        name: "丧假",
        requires_attachment: false,
        requires_balance_check: true,
        default_days: 3,
        description: "法定丧假默认3天，管理员可按公司制度调整",
        sort_order: 4,
      },
      {
        id: "lt_marriage",
        code: "marriage",
        name: "婚假",
        requires_attachment: false,
        requires_balance_check: true,
        default_days: 3,
        description: "法定婚假3天",
        sort_order: 5,
      },
      {
        id: "lt_maternity",
        code: "maternity",
        name: "产假",
        requires_attachment: false,
        requires_balance_check: true,
        default_days: 98,
        description: "法定产假98天",
        sort_order: 6,
      },
      {
        id: "lt_paternity",
        code: "paternity",
        name: "陪产假",
        requires_attachment: false,
        requires_balance_check: true,
        default_days: 15,
        description: "法定陪产假15天",
        sort_order: 7,
      },
      {
        id: "lt_other",
        code: "other",
        name: "其他请假",
        requires_attachment: false,
        requires_balance_check: false,
        default_days: 0,
        description: "不占用固定假期余额的其他请假",
        sort_order: 8,
      },
    ];
    for (const lt of leaveTypes) {
      await db.run(
        `INSERT INTO leave_type_configs (id, code, name, requires_attachment, requires_balance_check, default_days, description, sort_order, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, ?)`,
        lt.id,
        lt.code,
        lt.name,
        lt.requires_attachment,
        lt.requires_balance_check,
        lt.default_days,
        lt.description,
        lt.sort_order,
        now,
      );
    }
    console.log("✅ 初始化假期类型配置（8种）");
  }

  await db.run(
    `INSERT INTO leave_type_configs (
       id, code, name, requires_attachment, requires_balance_check,
       default_days, description, sort_order, is_active, created_at
     )
     SELECT ?, 'other', '其他请假', false, false, 0,
            '不占用固定假期余额的其他请假',
            COALESCE(MAX(sort_order), 0) + 1, true, ?
     FROM leave_type_configs
     HAVING NOT EXISTS (
       SELECT 1 FROM leave_type_configs WHERE code = 'other'
     )
     ON CONFLICT DO NOTHING`,
    "lt_other",
    new Date().toISOString(),
  );

  await db.run(
    `UPDATE leave_type_configs
     SET requires_balance_check = true
     WHERE code IN (
       'annual', 'personal', 'sick', 'bereavement', 'compensatory',
       'marriage', 'maternity', 'paternity'
     )
       AND requires_balance_check = false`,
  );

  const annualDescriptionMigration = await db.run(
    `UPDATE leave_type_configs
     SET description = '所有员工每年默认5天年假，满10年上调至10天，满20年上调至15天'
     WHERE code = 'annual'
       AND description = '法定年假，根据工龄计算：工龄<1年无年假，1-10年5天，10-20年10天，20年以上15天'`,
  );
  if (annualDescriptionMigration.changes > 0) {
    console.log("✅ 数据库迁移：年假基础额度说明已更新");
  }

  const bereavementTypeMigration = await db.run(
    `UPDATE leave_type_configs
     SET name = '丧假',
         default_days = 3,
         description = '法定丧假默认3天，管理员可按公司制度调整'
     WHERE code = 'compensatory'
       AND name = '调休假'
       AND default_days = 0`,
  );
  if (bereavementTypeMigration.changes > 0) {
    await db.run(
      `UPDATE leave_balances
       SET total_days = 3, updated_at = ?
       WHERE leave_type_code = 'compensatory'
         AND total_days = 0
         AND used_days = 0
         AND pending_days = 0`,
      new Date().toISOString(),
    );
    console.log("✅ 数据库迁移：旧版调休假配置已更新为丧假");
  }

  // 将旧版“999 天且不校验余额”的事假哨兵配置迁移为每年 3 天带薪事假。
  try {
    await db.transaction(async (client) => {
      const legacyConfigResult = await client.query<{
        default_days: number;
        requires_balance_check: boolean;
      }>(
        `SELECT default_days, requires_balance_check
         FROM leave_type_configs
         WHERE code = 'personal'
         FOR UPDATE`,
      );
      const legacyConfig = legacyConfigResult.rows[0];
      if (
        legacyConfig &&
        Number(legacyConfig.default_days) === 999 &&
        legacyConfig.requires_balance_check === false
      ) {
        const now = new Date().toISOString();
        await client.query(
          `UPDATE leave_type_configs
           SET name = '带薪事假', requires_balance_check = true, default_days = 3,
               description = '个人原因请假，每年默认3天带薪额度'
           WHERE code = 'personal'`,
        );
        const balanceResult = await client.query(
          `UPDATE leave_balances
           SET total_days = 3, updated_at = $1
           WHERE leave_type_code = 'personal'
             AND total_days = 999
             AND used_days + pending_days <= 3`,
          [now],
        );
        console.log(
          `✅ 数据库迁移：带薪事假旧配置已修正，同步 ${balanceResult.rowCount ?? 0} 条余额`,
        );
      }
    });
  } catch (error: any) {
    console.log("ℹ️  带薪事假旧配置迁移:", error.message);
  }

  // 数据库迁移：users 表添加 force_change_password 字段
  try {
    const colCheck = await db.get<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'force_change_password'
    `);
    if (!colCheck) {
      await db.run(
        `ALTER TABLE users ADD COLUMN force_change_password BOOLEAN NOT NULL DEFAULT false`,
      );
      console.log("✅ 数据库迁移：users 添加 force_change_password 字段");
    } else {
      console.log("✅ 数据库迁移：force_change_password 字段已存在");
    }
  } catch (error: any) {
    console.log("ℹ️  force_change_password 字段迁移:", error.message);
  }

  // 数据库迁移：补齐报销付款事实和回单交易日期，并更新状态约束。
  try {
    await db.exec(`
      ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS paid_time TEXT;
      ALTER TABLE reimbursements ADD COLUMN IF NOT EXISTS paid_by TEXT;
      ALTER TABLE reimbursements
        ADD COLUMN IF NOT EXISTS payment_business_date DATE;
      ALTER TABLE payment_batches
        ADD COLUMN IF NOT EXISTS payment_business_date DATE;

      DROP TRIGGER IF EXISTS trg_reimbursements_payment_business_date
        ON reimbursements;
      DROP TRIGGER IF EXISTS trg_payment_batches_business_date
        ON payment_batches;
      DROP FUNCTION IF EXISTS set_reimbursement_payment_business_date();
      DROP FUNCTION IF EXISTS set_payment_batch_business_date();
      DROP FUNCTION IF EXISTS reimbursement_business_date_in_shanghai(TEXT);

      ALTER TABLE reimbursements
        DROP CONSTRAINT IF EXISTS reimbursements_payment_business_date_check;
      ALTER TABLE reimbursements
        ADD CONSTRAINT reimbursements_payment_business_date_check CHECK(
          status NOT IN ('payment_uploaded', 'completed')
          OR payment_business_date IS NOT NULL
        ) NOT VALID;
      ALTER TABLE payment_batches
        DROP CONSTRAINT IF EXISTS payment_batches_business_date_check;
      ALTER TABLE payment_batches
        ADD CONSTRAINT payment_batches_business_date_check CHECK(
          status NOT IN ('uploaded', 'confirmed')
          OR payment_business_date IS NOT NULL
        ) NOT VALID;

      DO $validation$
      BEGIN
        BEGIN
          ALTER TABLE reimbursements
            VALIDATE CONSTRAINT reimbursements_payment_business_date_check;
        EXCEPTION WHEN check_violation THEN
          RAISE WARNING '存在缺少付款交易日期的历史报销，请人工核查';
        END;
        BEGIN
          ALTER TABLE payment_batches
            VALIDATE CONSTRAINT payment_batches_business_date_check;
        EXCEPTION WHEN check_violation THEN
          RAISE WARNING '存在无法推导业务付款日期的历史付款批次，请人工核查';
        END;
      END;
      $validation$;

      CREATE INDEX IF NOT EXISTS idx_reimbursements_payment_business_date
        ON reimbursements(payment_business_date, status, id)
        WHERE is_deleted = FALSE AND payment_business_date IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_payment_batches_business_date
        ON payment_batches(payment_business_date, status)
        WHERE payment_business_date IS NOT NULL;
    `);
    // 更新 status CHECK 约束以支持 paid 状态
    await db.run(`
      ALTER TABLE reimbursements DROP CONSTRAINT IF EXISTS reimbursements_status_check
    `);
    await db.run(`
      ALTER TABLE reimbursements ADD CONSTRAINT reimbursements_status_check
      CHECK(status IN ('draft', 'pending', 'pending_first', 'pending_second', 'pending_final', 'approved', 'paid', 'payment_uploaded', 'completed', 'rejected'))
    `);
    console.log("✅ 数据库迁移：报销回单交易日期与状态约束已更新");
  } catch (error: any) {
    console.log("ℹ️  报销付款业务日期迁移:", error.message);
  }

  // 数据库迁移：worklog_projects 表添加甲方项目负责人字段
  try {
    const clientContactCheck = await db.get<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'worklog_projects' AND column_name = 'client_contact_name'
    `);
    if (!clientContactCheck) {
      await db.run(
        `ALTER TABLE worklog_projects ADD COLUMN client_contact_name TEXT NOT NULL DEFAULT ''`,
      );
      await db.run(
        `ALTER TABLE worklog_projects ADD COLUMN client_contact_phone TEXT NOT NULL DEFAULT ''`,
      );
      console.log(
        "✅ 数据库迁移：worklog_projects 添加 client_contact_name 和 client_contact_phone 字段",
      );
    }
  } catch (error: any) {
    console.log("ℹ️  worklog_projects 甲方联系人字段迁移:", error.message);
  }

  // 工行回单自动化处理表
  await db.run(`
    CREATE TABLE IF NOT EXISTS bank_receipt_batches (
      id TEXT PRIMARY KEY,
      pdf_path TEXT NOT NULL,
      total_pages INTEGER DEFAULT 0,
      total_receipts INTEGER DEFAULT 0,
      matched_count INTEGER DEFAULT 0,
      unmatched_count INTEGER DEFAULT 0,
      uploaded_by TEXT REFERENCES users(id),
      status TEXT CHECK(status IN ('processing', 'done', 'failed')) DEFAULT 'processing',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS bank_receipts (
      id TEXT PRIMARY KEY,
      batch_id TEXT REFERENCES bank_receipt_batches(id) ON DELETE CASCADE,
      image_path TEXT NOT NULL,
      page_no INTEGER NOT NULL,
      position TEXT CHECK(position IN ('full', 'top', 'bottom')) DEFAULT 'full',
      ocr_payee TEXT,
      ocr_amount NUMERIC(12,2),
      ocr_remark TEXT,
      ocr_raw_json TEXT,
      parsed_type TEXT CHECK(parsed_type IN ('basic', 'large', 'business')),
      parsed_name TEXT,
      parsed_month TEXT,
      match_status TEXT CHECK(match_status IN ('matched', 'unmatched')) DEFAULT 'unmatched',
      matched_reimbursement_id TEXT REFERENCES reimbursements(id),
      payment_batch_id TEXT REFERENCES payment_batches(id),
      matched_by TEXT REFERENCES users(id),
      matched_at TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // 数据修正迁移：修复 total_amount 与发票核减不一致的历史数据
  // 背景：旧版代码存储的是原始发票总额，新版代码存储的是扣减核减后的净额
  // 对于 draft/pending 状态的报销单，重新用发票明细计算正确的净额
  try {
    const fixResult = await db.run(`
      UPDATE reimbursements
      SET total_amount = subq.net_amount,
          updated_at   = NOW()::text
      FROM (
        SELECT r.id,
          GREATEST(0.00, COALESCE(
            SUM(CASE WHEN COALESCE(ri.is_deduction, 0) = 0
                     THEN ri.amount - COALESCE(ri.deducted_amount, 0)
                     ELSE 0 END),
            0.00
          )) AS net_amount
        FROM reimbursements r
        LEFT JOIN reimbursement_invoices ri ON ri.reimbursement_id = r.id
        WHERE r.status IN ('draft', 'pending')
        GROUP BY r.id
      ) subq
      WHERE reimbursements.id = subq.id
        AND ABS(reimbursements.total_amount - subq.net_amount) > 0.005
    `);
    if (fixResult.changes > 0) {
      console.log(
        `✅ 数据修正：已修复 ${fixResult.changes} 条 total_amount 与发票核减不一致的报销单`,
      );
    }
  } catch (error: any) {
    console.log("ℹ️  total_amount 数据修正跳过:", error.message);
  }

  // 数据库迁移：worklog_attachments file_kind 约束扩展（screenshot/photo）
  try {
    await db.run(`
      ALTER TABLE worklog_attachments DROP CONSTRAINT IF EXISTS worklog_attachments_file_kind_check
    `);
    await db.run(`
      ALTER TABLE worklog_attachments ADD CONSTRAINT worklog_attachments_file_kind_check
      CHECK(file_kind IN ('image', 'screenshot', 'photo', 'document'))
    `);
    // 将旧的 image 数据迁移为 photo（项目现场照片）
    await db.run(
      `UPDATE worklog_attachments SET file_kind = 'photo' WHERE file_kind = 'image'`,
    );
  } catch (error: any) {
    console.log("ℹ️  worklog_attachments file_kind 约束迁移:", error.message);
  }

  // 数据库迁移：将已有 work_note 迁移到 worklog_progress_notes
  try {
    const migrated = await db.get<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt FROM worklog_progress_notes`,
    );
    if (migrated && migrated.cnt === 0) {
      const rows = await db.all<{
        id: string;
        work_note: string;
        user_id: string;
        user_name: string;
        created_at: string;
      }>(
        `SELECT id, work_note, user_id, user_name, created_at FROM worklog_entries WHERE work_note IS NOT NULL AND work_note != ''`,
      );
      for (const r of rows) {
        await db.run(
          `INSERT INTO worklog_progress_notes (id, entry_id, content, created_by, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          `mig_${r.id}`,
          r.id,
          r.work_note,
          r.user_id,
          r.user_name,
          r.created_at,
        );
      }
      if (rows.length > 0)
        console.log(
          `✅ 已迁移 ${rows.length} 条 work_note 到 worklog_progress_notes`,
        );
    }
  } catch (error: any) {
    console.log("ℹ️  work_note 迁移跳过:", error.message);
  }

  // 数据库迁移：worklog_attachments 新增 progress_note_id 列
  try {
    await db.run(
      `ALTER TABLE worklog_attachments ADD COLUMN IF NOT EXISTS progress_note_id TEXT REFERENCES worklog_progress_notes(id) ON DELETE SET NULL`,
    );
    console.log("✅ 数据库迁移：progress_note_id 字段检查完成");
  } catch (error: any) {
    if (
      !error.message?.includes("already exists") &&
      !error.message?.includes("duplicate column")
    ) {
      console.log("ℹ️  progress_note_id 迁移跳过:", error.message);
    }
  }

  // 将旧附件（progress_note_id 为 NULL）关联到时间最接近的进展记录
  try {
    await db.run(`
      UPDATE worklog_attachments a
      SET progress_note_id = (
        SELECT n.id FROM worklog_progress_notes n
        WHERE n.entry_id = a.entry_id
          AND n.created_at >= a.created_at
        ORDER BY n.created_at ASC LIMIT 1
      )
      WHERE a.progress_note_id IS NULL
        AND EXISTS (SELECT 1 FROM worklog_progress_notes n WHERE n.entry_id = a.entry_id AND n.created_at >= a.created_at)
    `);
    // 仍有未匹配的（附件时间晚于所有进展），关联到最后一条进展
    await db.run(`
      UPDATE worklog_attachments a
      SET progress_note_id = (
        SELECT n.id FROM worklog_progress_notes n
        WHERE n.entry_id = a.entry_id
        ORDER BY n.created_at DESC LIMIT 1
      )
      WHERE a.progress_note_id IS NULL
        AND EXISTS (SELECT 1 FROM worklog_progress_notes n WHERE n.entry_id = a.entry_id)
    `);
  } catch (error: any) {
    console.log("ℹ️  旧附件关联迁移跳过:", error.message);
  }

  // 数据库迁移：worklog_entries 新增 client_contact_name / client_contact_phone 快照列
  try {
    await db.run(
      `ALTER TABLE worklog_entries ADD COLUMN IF NOT EXISTS client_contact_name TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_entries ADD COLUMN IF NOT EXISTS client_contact_phone TEXT`,
    );
    // 回填已有日志
    await db.run(`
      UPDATE worklog_entries SET
        client_contact_name = (SELECT client_contact_name FROM worklog_projects WHERE id = worklog_entries.project_id),
        client_contact_phone = (SELECT client_contact_phone FROM worklog_projects WHERE id = worklog_entries.project_id)
      WHERE client_contact_name IS NULL
    `);
    console.log(
      "✅ 数据库迁移：worklog_entries client_contact 快照字段检查完成",
    );
  } catch (error: any) {
    if (
      !error.message?.includes("already exists") &&
      !error.message?.includes("duplicate column")
    ) {
      console.log("ℹ️  client_contact 快照迁移跳过:", error.message);
    }
  }

  // 数据库迁移：worklog_projects 新增合同跟踪字段
  try {
    await db.run(
      `ALTER TABLE worklog_projects ADD COLUMN IF NOT EXISTS contract_status TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_projects ADD COLUMN IF NOT EXISTS contract_total_amount NUMERIC`,
    );
    console.log("✅ 数据库迁移：worklog_projects 合同跟踪字段检查完成");
  } catch (error: any) {
    if (
      !error.message?.includes("already exists") &&
      !error.message?.includes("duplicate column")
    ) {
      console.log("ℹ️  合同跟踪字段迁移跳过:", error.message);
    }
  }

  // 数据库迁移：worklog_entries 新增 next_follow_up_date 字段（预计下次跟进时间）
  try {
    await db.run(
      `ALTER TABLE worklog_entries ADD COLUMN IF NOT EXISTS next_follow_up_date TEXT`,
    );
    console.log(
      "✅ 数据库迁移：worklog_entries next_follow_up_date 字段检查完成",
    );
  } catch (error: any) {
    if (
      !error.message?.includes("already exists") &&
      !error.message?.includes("duplicate column")
    ) {
      console.log("ℹ️  next_follow_up_date 迁移跳过:", error.message);
    }
  }

  // 数据库迁移：worklog_projects 新增办理机构字段
  try {
    await db.run(
      `ALTER TABLE worklog_projects ADD COLUMN IF NOT EXISTS agency_bureau TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_projects ADD COLUMN IF NOT EXISTS agency_department TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_projects ADD COLUMN IF NOT EXISTS agency_contact_name TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_projects ADD COLUMN IF NOT EXISTS agency_contact_phone TEXT`,
    );
    console.log("✅ 数据库迁移：worklog_projects 办理机构字段检查完成");
  } catch (error: any) {
    if (
      !error.message?.includes("already exists") &&
      !error.message?.includes("duplicate column")
    ) {
      console.log("ℹ️  办理机构字段迁移跳过:", error.message);
    }
  }

  // 数据库迁移：worklog_entries 新增 client_name 条目级覆盖字段
  try {
    await db.run(
      `ALTER TABLE worklog_entries ADD COLUMN IF NOT EXISTS client_name TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_entries ADD COLUMN IF NOT EXISTS agency_bureau TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_entries ADD COLUMN IF NOT EXISTS agency_department TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_entries ADD COLUMN IF NOT EXISTS agency_contact_name TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_entries ADD COLUMN IF NOT EXISTS agency_contact_phone TEXT`,
    );
    await db.run(
      `ALTER TABLE worklog_entries ADD COLUMN IF NOT EXISTS project_type TEXT`,
    );
    console.log("✅ 数据库迁移：worklog_entries 条目级覆盖字段检查完成");
  } catch (error: any) {
    if (
      !error.message?.includes("already exists") &&
      !error.message?.includes("duplicate column")
    ) {
      console.log("ℹ️  entries 覆盖字段迁移跳过:", error.message);
    }
  }

  // 数据库迁移：创建 daily_log_submissions 表，支持同一天多次提交
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS daily_log_submissions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        log_date TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        submitted_at TEXT NOT NULL
      )
    `);
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_daily_log_submissions_user_date ON daily_log_submissions(user_id, log_date)`,
    );
    console.log("✅ 数据库迁移：daily_log_submissions 表检查完成");
  } catch (error: any) {
    if (!error.message?.includes("already exists")) {
      console.log("ℹ️  daily_log_submissions 迁移跳过:", error.message);
    }
  }

  // 数据库迁移：创建 daily_log_comments 表（总经理/管理员对日志的评论）
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS daily_log_comments (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES daily_log_submissions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_daily_log_comments_submission ON daily_log_comments(submission_id)`,
    );
    // 添加 read_at 列（标记员工是否已读评论）
    try {
      await db.run(
        `ALTER TABLE daily_log_comments ADD COLUMN IF NOT EXISTS read_at TEXT DEFAULT NULL`,
      );
    } catch {
      /* 列已存在则忽略 */
    }
    // 添加 reply_to 列（回复某条评论）
    try {
      await db.run(
        `ALTER TABLE daily_log_comments ADD COLUMN IF NOT EXISTS reply_to TEXT DEFAULT NULL`,
      );
    } catch {
      /* 列已存在则忽略 */
    }
    // 添加 withdrawn_at 列（撤回评论）
    try {
      await db.run(
        `ALTER TABLE daily_log_comments ADD COLUMN IF NOT EXISTS withdrawn_at TEXT DEFAULT NULL`,
      );
    } catch {
      /* 列已存在则忽略 */
    }
    // 添加 due_date 列（总经理设置的完成期限）
    try {
      await db.run(
        `ALTER TABLE daily_log_comments ADD COLUMN IF NOT EXISTS due_date TEXT DEFAULT NULL`,
      );
    } catch {
      /* 列已存在则忽略 */
    }
    // 添加 completed_at 列（员工标记完成时间）
    try {
      await db.run(
        `ALTER TABLE daily_log_comments ADD COLUMN IF NOT EXISTS completed_at TEXT DEFAULT NULL`,
      );
    } catch {
      /* 列已存在则忽略 */
    }
    console.log("✅ 数据库迁移：daily_log_comments 表检查完成");
  } catch (error: any) {
    if (!error.message?.includes("already exists")) {
      console.log("ℹ️  daily_log_comments 迁移跳过:", error.message);
    }
  }

  // 数据库迁移：创建 daily_log_supplements 表（日志补充记录）
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS daily_log_supplements (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES daily_log_submissions(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        seq INTEGER NOT NULL DEFAULT 1,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(submission_id, seq)
      )
    `);
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_daily_log_supplements_submission ON daily_log_supplements(submission_id)`,
    );
    console.log("✅ 数据库迁移：daily_log_supplements 表检查完成");
  } catch (error: any) {
    if (!error.message?.includes("already exists")) {
      console.log("ℹ️  daily_log_supplements 迁移跳过:", error.message);
    }
  }

  // 数据库迁移：weekly_summaries 添加 locked_at 字段
  try {
    await db.run(
      `ALTER TABLE weekly_summaries ADD COLUMN IF NOT EXISTS locked_at TEXT DEFAULT NULL`,
    );
  } catch {
    /* 列已存在则忽略 */
  }

  // 数据库迁移：创建 weekly_summary_supplements 表（周报补充记录）
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS weekly_summary_supplements (
        id TEXT PRIMARY KEY,
        weekly_summary_id TEXT NOT NULL REFERENCES weekly_summaries(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        seq INTEGER NOT NULL DEFAULT 1,
        content TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(weekly_summary_id, seq)
      )
    `);
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_weekly_summary_supplements ON weekly_summary_supplements(weekly_summary_id)`,
    );
    console.log("✅ 数据库迁移：weekly_summary_supplements 表检查完成");
  } catch (error: any) {
    if (!error.message?.includes("already exists")) {
      console.log("ℹ️  weekly_summary_supplements 迁移跳过:", error.message);
    }
  }

  // ==================== 快捷短语表 ====================
  try {
    await db.run(`
      CREATE TABLE IF NOT EXISTS daily_log_phrases (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);
    await db.run(
      `CREATE INDEX IF NOT EXISTS idx_daily_log_phrases_user ON daily_log_phrases(user_id)`,
    );
    console.log("✅ 数据库迁移：daily_log_phrases 表检查完成");
  } catch (error: any) {
    if (!error.message?.includes("already exists")) {
      console.log("ℹ️  daily_log_phrases 迁移跳过:", error.message);
    }
  }

  // ==================== 项目日志模块字典 seed ====================
  await initContractDomainSchema();
  await initMonthlyFinancialReportSchema();
  await seedWorklogDicts();
  await seedWorklogPermissions();

  console.log("✅ PostgreSQL 数据库表初始化完成");
}

/**
 * 初始化月度财务报表业务域。
 *
 * 手工金额使用无固定小数位的 NUMERIC，接口查询时转为文本，避免展示层
 * 自动补零或截断有效小数。月结快照只新增不覆盖，用于历史追溯。
 */
async function initMonthlyFinancialReportSchema(): Promise<void> {
  await db.exec(`
    CREATE OR REPLACE FUNCTION monthly_financial_date_is_valid(value TEXT)
    RETURNS BOOLEAN
    LANGUAGE plpgsql
    IMMUTABLE
    STRICT
    AS $function$
    BEGIN
      RETURN value ~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$'
        AND value::DATE::TEXT = value;
    EXCEPTION WHEN OTHERS THEN
      RETURN FALSE;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION monthly_financial_account_amounts_are_valid(value JSONB)
    RETURNS BOOLEAN
    LANGUAGE sql
    IMMUTABLE
    STRICT
    AS $function$
      SELECT
        jsonb_typeof(value) = 'object'
        AND value ?& ARRAY['general', 'business', 'welfare_one', 'welfare_two']
        AND value - 'general' - 'business' - 'welfare_one' - 'welfare_two' = '{}'::JSONB
        AND jsonb_typeof(value -> 'general') = 'string'
        AND jsonb_typeof(value -> 'business') = 'string'
        AND jsonb_typeof(value -> 'welfare_one') = 'string'
        AND jsonb_typeof(value -> 'welfare_two') = 'string'
        AND value ->> 'general' ~ '^-?(0|[1-9][0-9]{0,17})([.][0-9]{1,12})?$'
        AND value ->> 'business' ~ '^-?(0|[1-9][0-9]{0,17})([.][0-9]{1,12})?$'
        AND value ->> 'welfare_one' ~ '^-?(0|[1-9][0-9]{0,17})([.][0-9]{1,12})?$'
        AND value ->> 'welfare_two' ~ '^-?(0|[1-9][0-9]{0,17})([.][0-9]{1,12})?$';
    $function$;

    CREATE OR REPLACE FUNCTION monthly_financial_manual_rule_is_valid(
      item_category TEXT,
      item_account_code TEXT,
      item_direction TEXT
    )
    RETURNS BOOLEAN
    LANGUAGE sql
    IMMUTABLE
    STRICT
    AS $function$
      SELECT
        (item_category = 'general_interest'
          AND item_account_code = 'general' AND item_direction = 'income')
        OR (item_category IN ('general_bank_fee', 'general_other')
          AND item_account_code = 'general' AND item_direction = 'expense')
        OR (item_category = 'business_interest'
          AND item_account_code = 'business' AND item_direction = 'income')
        OR (item_category = 'business_bank_fee'
          AND item_account_code = 'business' AND item_direction = 'expense')
        OR (item_category = 'welfare_one_supplement'
          AND item_account_code = 'welfare_one' AND item_direction = 'income')
        OR (item_category IN ('welfare_one_407', 'welfare_one_407_ai', 'welfare_one_8h_ai')
          AND item_account_code = 'welfare_one' AND item_direction = 'expense')
        OR (item_category = 'welfare_two_supplement'
          AND item_account_code = 'welfare_two' AND item_direction = 'income')
        OR (item_category IN (
          'welfare_two_refreshment', 'welfare_two_team_building',
          'welfare_two_physical_exam'
        ) AND item_account_code = 'welfare_two' AND item_direction = 'expense');
    $function$;

    CREATE TABLE IF NOT EXISTS financial_accounts (
      code TEXT PRIMARY KEY CHECK(code IN ('general', 'business', 'welfare_one', 'welfare_two')),
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL CHECK(sort_order > 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monthly_financial_reports (
      id TEXT PRIMARY KEY,
      report_month TEXT NOT NULL UNIQUE
        CHECK(report_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'closed', 'reopened')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      opening_balances_json JSONB NOT NULL DEFAULT
        '{"general":"0","business":"0","welfare_one":"0","welfare_two":"0"}'::jsonb,
      automatic_snapshot_json JSONB,
      closing_balances_json JSONB,
      last_refreshed_at TEXT,
      closed_at TEXT,
      closed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      reopened_at TEXT,
      reopened_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      reopen_reason TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(
        (status <> 'closed') OR
        (closed_at IS NOT NULL AND closed_by IS NOT NULL AND closing_balances_json IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS monthly_financial_manual_items (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES monthly_financial_reports(id) ON DELETE CASCADE,
      category TEXT NOT NULL CHECK(category IN (
        'general_interest', 'business_interest',
        'general_bank_fee', 'business_bank_fee', 'general_other',
        'welfare_one_supplement', 'welfare_two_supplement',
        'welfare_one_407', 'welfare_one_407_ai', 'welfare_one_8h_ai',
        'welfare_two_refreshment', 'welfare_two_team_building',
        'welfare_two_physical_exam'
      )),
      account_code TEXT NOT NULL
        CHECK(account_code IN ('general', 'business', 'welfare_one', 'welfare_two')),
      direction TEXT NOT NULL CHECK(direction IN ('income', 'expense')),
      amount NUMERIC NOT NULL CHECK(amount > 0),
      occurred_on TEXT NOT NULL CHECK(occurred_on ~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}$'),
      description TEXT,
      voucher_reference TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monthly_financial_snapshots (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES monthly_financial_reports(id) ON DELETE RESTRICT,
      report_version INTEGER NOT NULL CHECK(report_version >= 1),
      formula_version TEXT NOT NULL,
      snapshot_json JSONB NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      UNIQUE(report_id, report_version)
    );

    CREATE TABLE IF NOT EXISTS monthly_financial_audit_logs (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES monthly_financial_reports(id) ON DELETE RESTRICT,
      report_version INTEGER NOT NULL CHECK(report_version >= 1),
      action TEXT NOT NULL CHECK(action IN (
        'create', 'save_manual_items', 'refresh', 'close', 'reopen', 'export'
      )),
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      actor_role TEXT NOT NULL,
      reason TEXT,
      changes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TEXT NOT NULL
    );

    ALTER TABLE monthly_financial_manual_items
      DROP CONSTRAINT IF EXISTS monthly_financial_manual_items_amount_check;
    ALTER TABLE monthly_financial_manual_items
      ADD CONSTRAINT monthly_financial_manual_items_amount_check CHECK(amount > 0);

    ALTER TABLE monthly_financial_manual_items
      DROP CONSTRAINT IF EXISTS monthly_financial_manual_items_category_check;
    ALTER TABLE monthly_financial_manual_items
      ADD CONSTRAINT monthly_financial_manual_items_category_check CHECK(category IN (
        'general_interest', 'business_interest',
        'general_bank_fee', 'business_bank_fee', 'general_other',
        'welfare_one_supplement', 'welfare_two_supplement',
        'welfare_one_407', 'welfare_one_407_ai', 'welfare_one_8h_ai',
        'welfare_two_refreshment', 'welfare_two_team_building',
        'welfare_two_physical_exam'
      ));

    ALTER TABLE monthly_financial_manual_items
      DROP CONSTRAINT IF EXISTS monthly_financial_manual_items_date_check;
    ALTER TABLE monthly_financial_manual_items
      ADD CONSTRAINT monthly_financial_manual_items_date_check
      CHECK(monthly_financial_date_is_valid(occurred_on)) NOT VALID;

    ALTER TABLE monthly_financial_manual_items
      DROP CONSTRAINT IF EXISTS monthly_financial_manual_items_rule_check;
    ALTER TABLE monthly_financial_manual_items
      ADD CONSTRAINT monthly_financial_manual_items_rule_check CHECK(
        monthly_financial_manual_rule_is_valid(category, account_code, direction)
      ) NOT VALID;

    ALTER TABLE monthly_financial_reports
      DROP CONSTRAINT IF EXISTS monthly_financial_reports_opening_balances_check;
    ALTER TABLE monthly_financial_reports
      ADD CONSTRAINT monthly_financial_reports_opening_balances_check CHECK(
        monthly_financial_account_amounts_are_valid(opening_balances_json)
      ) NOT VALID;
    ALTER TABLE monthly_financial_reports
      DROP CONSTRAINT IF EXISTS monthly_financial_reports_closing_balances_check;
    ALTER TABLE monthly_financial_reports
      ADD CONSTRAINT monthly_financial_reports_closing_balances_check CHECK(
        closing_balances_json IS NULL
        OR monthly_financial_account_amounts_are_valid(closing_balances_json)
      ) NOT VALID;

    ALTER TABLE contract_receipts
      DROP CONSTRAINT IF EXISTS contract_receipts_receipt_date_valid_check;
    ALTER TABLE contract_receipts
      ADD CONSTRAINT contract_receipts_receipt_date_valid_check
      CHECK(monthly_financial_date_is_valid(receipt_date)) NOT VALID;
    ALTER TABLE contract_payments
      DROP CONSTRAINT IF EXISTS contract_payments_payment_date_valid_check;
    ALTER TABLE contract_payments
      ADD CONSTRAINT contract_payments_payment_date_valid_check
      CHECK(monthly_financial_date_is_valid(payment_date)) NOT VALID;

    DO $validation$
    BEGIN
      BEGIN
        ALTER TABLE monthly_financial_manual_items
          VALIDATE CONSTRAINT monthly_financial_manual_items_date_check;
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '存在无效日期的历史月报手工项目，请人工核查';
      END;
      BEGIN
        ALTER TABLE monthly_financial_manual_items
          VALIDATE CONSTRAINT monthly_financial_manual_items_rule_check;
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '存在分类、账户和方向不一致的历史月报手工项目，请人工核查';
      END;
      BEGIN
        ALTER TABLE monthly_financial_reports
          VALIDATE CONSTRAINT monthly_financial_reports_opening_balances_check;
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '存在期初四账户结构无效的历史月报，请人工核查';
      END;
      BEGIN
        ALTER TABLE monthly_financial_reports
          VALIDATE CONSTRAINT monthly_financial_reports_closing_balances_check;
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '存在期末四账户结构无效的历史月报，请人工核查';
      END;
      BEGIN
        ALTER TABLE contract_receipts
          VALIDATE CONSTRAINT contract_receipts_receipt_date_valid_check;
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '存在日期无效的历史合同回款，请人工核查';
      END;
      BEGIN
        ALTER TABLE contract_payments
          VALIDATE CONSTRAINT contract_payments_payment_date_valid_check;
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '存在日期无效的历史合同付款，请人工核查';
      END;
    END;
    $validation$;

    CREATE INDEX IF NOT EXISTS idx_monthly_financial_reports_month_status
      ON monthly_financial_reports(report_month DESC, status);
    CREATE INDEX IF NOT EXISTS idx_monthly_financial_manual_items_report
      ON monthly_financial_manual_items(report_id, occurred_on, category);
    CREATE INDEX IF NOT EXISTS idx_monthly_financial_snapshots_report
      ON monthly_financial_snapshots(report_id, report_version DESC);
    CREATE INDEX IF NOT EXISTS idx_monthly_financial_audit_report
      ON monthly_financial_audit_logs(report_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_receipts_monthly_confirmed_date
      ON contract_receipts(receipt_date, id)
      WHERE status = 'confirmed';
    CREATE INDEX IF NOT EXISTS idx_contract_payments_monthly_confirmed_date
      ON contract_payments(payment_date, id)
      WHERE status = 'confirmed';

    INSERT INTO financial_accounts(code, name, sort_order, is_active, created_at, updated_at)
    VALUES
      ('general', '一般账户', 1, TRUE, NOW()::text, NOW()::text),
      ('business', '商务账户', 2, TRUE, NOW()::text, NOW()::text),
      ('welfare_one', '福利账户一', 3, TRUE, NOW()::text, NOW()::text),
      ('welfare_two', '福利账户二', 4, TRUE, NOW()::text, NOW()::text)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      sort_order = EXCLUDED.sort_order,
      is_active = TRUE,
      updated_at = EXCLUDED.updated_at;
  `);
}

/**
 * 初始化合同全生命周期业务域。
 *
 * 合同金额统一使用 NUMERIC(18,2)，合同项目只关联结构化项目表
 * worklog_projects。这里使用幂等 DDL，既服务新库初始化，也兼容现有
 * 部署实例的增量启动。
 */
async function initContractDomainSchema(): Promise<void> {
  await db.exec(`
    CREATE SEQUENCE IF NOT EXISTS contract_no_sequence AS BIGINT START WITH 1;

    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      contract_no TEXT,
      business_contract_no TEXT,
      title TEXT,
      description TEXT,
      requires_auxiliary_materials BOOLEAN NOT NULL DEFAULT FALSE,
      declared_category TEXT
        CHECK(declared_category IN ('main_business', 'non_main', 'asset')),
      declared_subtype TEXT CHECK(declared_subtype IN (
        'engineering_consulting', 'preliminary_procedures',
        'technical_consulting', 'non_main_income', 'other_service',
        'procurement', 'software', 'equipment', 'house_rental',
        'vehicle_rental', 'parking_space', 'office_asset'
      )),
      category TEXT CHECK(category IN ('main_business', 'non_main', 'asset')),
      asset_category TEXT CHECK(asset_category IN (
        'procurement', 'software', 'equipment', 'house_rental',
        'vehicle_rental', 'parking_space', 'office_asset', 'other'
      )),
      relation_type TEXT NOT NULL
        CHECK(relation_type IN ('main', 'supplement', 'termination')),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'approving', 'pending_seal', 'effective', 'executing', 'completed', 'rejected', 'terminated')),
      area TEXT NOT NULL CHECK(area IN (
        '全部',
        '东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山区',
        '门头沟区', '房山区', '通州区', '顺义区', '昌平区', '大兴区',
        '怀柔区', '平谷区', '密云区', '延庆区'
      )),
      project_id TEXT REFERENCES worklog_projects(id) ON DELETE SET NULL,
      parent_contract_id TEXT REFERENCES contracts(id) ON DELETE RESTRICT,
      root_contract_id TEXT REFERENCES contracts(id) ON DELETE RESTRICT,
      termination_target_contract_id TEXT REFERENCES contracts(id) ON DELETE RESTRICT,
      renewed_from_contract_id TEXT REFERENCES contracts(id) ON DELETE RESTRICT,
      renewed_from_lease_end_date TEXT,
      party_a TEXT,
      party_b TEXT,
      project_name TEXT,
      amount_delta NUMERIC(18,2)
        CHECK(amount_delta IS NULL OR ABS(amount_delta) <= 999999999999.99),
      original_contract_amount NUMERIC(18,2),
      recognized_original_amount NUMERIC(18,2),
      recognized_final_amount NUMERIC(18,2),
      amount_before_change NUMERIC(18,2),
      amount_after_change NUMERIC(18,2),
      current_effective_amount NUMERIC(18,2),
      supplement_change_type TEXT CHECK(supplement_change_type IS NULL OR
        supplement_change_type IN (
          'payment_terms_only', 'amount_adjustment',
          'amount_and_payment', 'legacy_unresolved'
        )),
      supplement_sequence INTEGER CHECK(
        supplement_sequence IS NULL OR supplement_sequence > 0
      ),
      contract_date TEXT,
      contract_date_source TEXT CHECK(contract_date_source IN ('ocr', 'manual', 'upload_date')),
      lease_start_date TEXT,
      lease_end_date TEXT,
      lease_monthly_rent NUMERIC(18,2)
        CHECK(lease_monthly_rent IS NULL OR lease_monthly_rent > 0),
      lease_monthly_property_fee NUMERIC(18,2)
        CHECK(lease_monthly_property_fee IS NULL OR lease_monthly_property_fee > 0),
      lease_term_months INTEGER
        CHECK(lease_term_months IS NULL OR lease_term_months > 0),
      lease_amount_source TEXT
        CHECK(lease_amount_source IS NULL OR lease_amount_source IN (
          'contract_total', 'monthly_rent_calculated',
          'monthly_rent_property_fee_calculated'
        )),
      lease_operation_type TEXT
        CHECK(lease_operation_type IS NULL OR lease_operation_type = 'renewal'),
      lease_previous_end_date TEXT,
      financial_direction TEXT
        CHECK(financial_direction IS NULL OR financial_direction IN ('income', 'cost')),
      financial_direction_source TEXT
        CHECK(financial_direction_source IS NULL OR
          financial_direction_source IN ('contract_category', 'invoice')),
      financial_direction_invoice_id TEXT,
      financial_direction_confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      financial_direction_confirmed_at TEXT,
      financial_direction_version INTEGER NOT NULL DEFAULT 0
        CHECK(financial_direction_version >= 0),
      asset_funding_mode TEXT CHECK(asset_funding_mode IS NULL OR
        asset_funding_mode IN (
          'engineering_direct', 'engineering_to_technology',
          'technology_direct', 'pending_review'
        )),
      pending_action TEXT CHECK(pending_action IN ('seal', 'termination')),
      previous_status TEXT
        CHECK(previous_status IN ('draft', 'approving', 'pending_seal', 'effective', 'executing', 'completed', 'rejected', 'terminated')),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      submitted_at TEXT,
      approved_at TEXT,
      rejected_at TEXT,
      sealed_at TEXT,
      effective_at TEXT,
      executing_at TEXT,
      completed_at TEXT,
      terminated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at TEXT,
      CHECK(
        declared_category IS NULL OR
        declared_subtype IS NULL OR
        (declared_category = 'main_business' AND asset_category IS NULL AND
          declared_subtype IN ('engineering_consulting', 'preliminary_procedures', 'technical_consulting')) OR
        (declared_category = 'non_main' AND asset_category IS NULL AND
          declared_subtype IN ('non_main_income', 'other_service')) OR
        (declared_category = 'asset' AND asset_category = declared_subtype AND
          declared_subtype IN (
            'procurement', 'software', 'equipment', 'house_rental',
            'vehicle_rental', 'parking_space', 'office_asset'
          ))
      ),
      CONSTRAINT contracts_asset_project_check
        CHECK(COALESCE(declared_category, category) IS DISTINCT FROM 'asset' OR project_id IS NULL),
      CHECK(parent_contract_id IS NULL OR parent_contract_id <> id),
      CHECK(
        (
          renewed_from_contract_id IS NULL AND
          renewed_from_lease_end_date IS NULL
        ) OR (
          renewed_from_contract_id IS NOT NULL AND
          renewed_from_lease_end_date IS NOT NULL AND
          renewed_from_contract_id <> id AND relation_type = 'main' AND
          parent_contract_id IS NULL AND root_contract_id IS NOT NULL AND
          root_contract_id = id
        )
      ),
      CHECK(lease_operation_type IS NULL OR relation_type = 'supplement'),
      CHECK(lease_operation_type IS NULL OR lease_previous_end_date IS NOT NULL),
      CHECK(root_contract_id IS NULL OR root_contract_id <> id OR relation_type = 'main')
    );

    CREATE TABLE IF NOT EXISTS contract_files (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      file_type TEXT NOT NULL CHECK(file_type IN (
        'draft_contract', 'seal_application', 'triplicate', 'payment_request',
        'sealed_contract', 'invoice', 'receipt', 'payment', 'termination', 'other'
      )),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL CHECK(file_size > 0),
      mime_type TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      is_current BOOLEAN NOT NULL DEFAULT TRUE,
      uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      UNIQUE(contract_id, file_hash)
    );

    CREATE TABLE IF NOT EXISTS contract_seal_applications (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      form_version INTEGER NOT NULL DEFAULT 1 CHECK(form_version >= 1),
      contract_version INTEGER NOT NULL CHECK(contract_version >= 1),
      form_data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'signed', 'superseded')),
      signed_file_id TEXT REFERENCES contract_files(id) ON DELETE SET NULL,
      signer_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      signer_name TEXT,
      signer_role TEXT,
      signer_department TEXT,
      signature_snapshot_path TEXT,
      signed_at TEXT,
      approval_round_id TEXT,
      approved_file_id TEXT,
      approver_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      approver_name TEXT,
      approver_role TEXT,
      approver_signature_snapshot_path TEXT,
      approver_signature_snapshot_hash TEXT CHECK(
        approver_signature_snapshot_hash IS NULL OR
        approver_signature_snapshot_hash ~ '^[0-9a-f]{64}$'
      ),
      approver_signed_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_current BOOLEAN NOT NULL DEFAULT TRUE,
      CHECK(
        (status = 'signed' AND signed_file_id IS NOT NULL AND signer_id IS NOT NULL
          AND signature_snapshot_path IS NOT NULL AND signed_at IS NOT NULL) OR
        (status <> 'signed')
      )
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_seal_applications_current
      ON contract_seal_applications(contract_id)
      WHERE is_current = TRUE;

    CREATE SEQUENCE IF NOT EXISTS contract_download_request_no_sequence
      AS BIGINT START WITH 1;

    CREATE TABLE IF NOT EXISTS contract_download_requests (
      id TEXT PRIMARY KEY,
      request_no TEXT NOT NULL UNIQUE,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      applicant_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      applicant_name_snapshot TEXT NOT NULL,
      applicant_department_snapshot TEXT NOT NULL DEFAULT '',
      applicant_position_snapshot TEXT NOT NULL,
      contract_no_snapshot TEXT NOT NULL,
      contract_name_snapshot TEXT NOT NULL,
      contract_area_snapshot TEXT NOT NULL CHECK(contract_area_snapshot <> '全部'),
      contract_status_snapshot TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK(char_length(purpose) BETWEEN 1 AND 1000),
      status TEXT NOT NULL DEFAULT 'pending_approval' CHECK(status IN (
        'pending_approval', 'approved', 'rejected', 'withdrawn', 'processing', 'completed'
      )),
      chain_id TEXT NOT NULL,
      previous_request_id TEXT
        REFERENCES contract_download_requests(id) ON DELETE RESTRICT,
      attempt_no INTEGER NOT NULL DEFAULT 1 CHECK(attempt_no >= 1),
      target_approver_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      target_approver_name_snapshot TEXT NOT NULL,
      target_approver_position_snapshot TEXT NOT NULL,
      target_executor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      target_executor_name_snapshot TEXT NOT NULL,
      target_executor_position_snapshot TEXT NOT NULL,
      application_file_path TEXT NOT NULL,
      application_file_name TEXT NOT NULL,
      application_file_hash TEXT NOT NULL CHECK(
        application_file_hash ~ '^[0-9a-f]{64}$'
      ),
      applicant_signature_snapshot_path TEXT NOT NULL,
      applicant_signature_snapshot_hash TEXT NOT NULL CHECK(
        applicant_signature_snapshot_hash ~ '^[0-9a-f]{64}$'
      ),
      approved_application_file_path TEXT,
      approved_application_file_hash TEXT CHECK(
        approved_application_file_hash IS NULL OR
        approved_application_file_hash ~ '^[0-9a-f]{64}$'
      ),
      approver_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      approver_name_snapshot TEXT,
      approver_position_snapshot TEXT,
      approver_signature_snapshot_path TEXT,
      approver_signature_snapshot_hash TEXT CHECK(
        approver_signature_snapshot_hash IS NULL OR
        approver_signature_snapshot_hash ~ '^[0-9a-f]{64}$'
      ),
      decision_comment TEXT,
      decided_at TEXT,
      executor_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      executor_name_snapshot TEXT,
      executor_position_snapshot TEXT,
      processing_note TEXT CHECK(
        processing_note IS NULL OR char_length(processing_note) <= 1000
      ),
      processing_started_at TEXT,
      completed_at TEXT,
      withdrawn_at TEXT,
      withdrawal_reason TEXT CHECK(
        withdrawal_reason IS NULL OR char_length(withdrawal_reason) <= 1000
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      applicant_seen_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      CHECK(
        (status = 'pending_approval' AND approver_id IS NULL AND decided_at IS NULL
          AND withdrawn_at IS NULL AND withdrawal_reason IS NULL) OR
        (status = 'withdrawn' AND approver_id IS NULL AND decided_at IS NULL
          AND withdrawn_at IS NOT NULL) OR
        (status = 'rejected' AND approver_id IS NOT NULL AND decided_at IS NOT NULL) OR
        (status IN ('approved', 'processing', 'completed') AND
          approver_id IS NOT NULL AND decided_at IS NOT NULL AND
          approved_application_file_path IS NOT NULL AND
          approved_application_file_hash IS NOT NULL AND
          approver_signature_snapshot_path IS NOT NULL)
      ),
      CHECK(
        status <> 'completed' OR
        (executor_id IS NOT NULL AND completed_at IS NOT NULL)
      ),
      CHECK(
        (attempt_no = 1 AND previous_request_id IS NULL AND chain_id = id) OR
        (attempt_no > 1 AND previous_request_id IS NOT NULL AND chain_id <> id)
      )
    );

    CREATE TABLE IF NOT EXISTS contract_download_request_files (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL
        REFERENCES contract_download_requests(id) ON DELETE RESTRICT,
      contract_file_id TEXT NOT NULL REFERENCES contract_files(id) ON DELETE RESTRICT,
      file_type_snapshot TEXT NOT NULL,
      file_name_snapshot TEXT NOT NULL,
      file_path_snapshot TEXT NOT NULL,
      file_hash_snapshot TEXT NOT NULL CHECK(file_hash_snapshot ~ '^[0-9a-f]{64}$'),
      file_size_snapshot INTEGER NOT NULL CHECK(file_size_snapshot > 0),
      mime_type_snapshot TEXT NOT NULL,
      downloaded_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      downloaded_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(request_id, contract_file_id),
      CHECK(
        (downloaded_by IS NULL AND downloaded_at IS NULL) OR
        (downloaded_by IS NOT NULL AND downloaded_at IS NOT NULL)
      )
    );

    CREATE TABLE IF NOT EXISTS contract_download_request_audit_logs (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL
        REFERENCES contract_download_requests(id) ON DELETE RESTRICT,
      action TEXT NOT NULL CHECK(action IN (
        'submit', 'approve', 'reject', 'withdraw', 'resubmit',
        'download_file', 'complete'
      )),
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      actor_name_snapshot TEXT NOT NULL,
      actor_position_snapshot TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      comment TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_contract_download_requests_applicant
      ON contract_download_requests(applicant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_download_requests_applicant_unread
      ON contract_download_requests(applicant_id, updated_at)
      WHERE status <> 'pending_approval';
    CREATE INDEX IF NOT EXISTS idx_contract_download_requests_approver
      ON contract_download_requests(target_approver_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_contract_download_requests_admin_queue
      ON contract_download_requests(status, decided_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_download_requests_one_active
      ON contract_download_requests(applicant_id, contract_id)
      WHERE status IN ('pending_approval', 'approved', 'processing');
    CREATE INDEX IF NOT EXISTS idx_contract_download_request_files_request
      ON contract_download_request_files(request_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_contract_download_request_audit_request
      ON contract_download_request_audit_logs(request_id, created_at);

    CREATE SEQUENCE IF NOT EXISTS invoice_application_no_sequence
      AS BIGINT START WITH 1;

    CREATE TABLE IF NOT EXISTS invoice_applications (
      id TEXT PRIMARY KEY,
      application_no TEXT NOT NULL UNIQUE,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      applicant_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      applicant_name_snapshot TEXT NOT NULL,
      applicant_position_snapshot TEXT NOT NULL,
      contract_no_snapshot TEXT NOT NULL,
      contract_title_snapshot TEXT NOT NULL,
      contract_category_snapshot TEXT NOT NULL
        CHECK(contract_category_snapshot IN ('main_business', 'non_main')),
      contract_area_snapshot TEXT NOT NULL,
      party_a_snapshot TEXT NOT NULL,
      contract_amount_snapshot NUMERIC(18,2) NOT NULL
        CHECK(contract_amount_snapshot > 0),
      amount NUMERIC(18,2) NOT NULL CHECK(amount > 0),
      triplicate_project_name TEXT CHECK(
        triplicate_project_name IS NULL OR
        char_length(triplicate_project_name) BETWEEN 1 AND 300
      ),
      triplicate_previous_payment_snapshot NUMERIC(18,2) CHECK(
        triplicate_previous_payment_snapshot IS NULL OR
        triplicate_previous_payment_snapshot >= 0
      ),
      triplicate_cumulative_payment_snapshot NUMERIC(18,2) CHECK(
        triplicate_cumulative_payment_snapshot IS NULL OR
        triplicate_cumulative_payment_snapshot > 0
      ),
      invoice_content TEXT NOT NULL CHECK(char_length(invoice_content) <= 1000),
      invoice_type TEXT NOT NULL CHECK(char_length(invoice_type) <= 100),
      description TEXT CHECK(description IS NULL OR char_length(description) <= 2000),
      material_mode TEXT NOT NULL CHECK(material_mode IN (
        'material_need_seal', 'material_no_seal', 'no_material'
      )),
      billing_name TEXT NOT NULL DEFAULT '',
      billing_tax_number TEXT NOT NULL DEFAULT '',
      billing_address TEXT,
      billing_phone TEXT,
      billing_bank_name TEXT,
      billing_bank_account TEXT,
      billing_remark TEXT CHECK(
        billing_remark IS NULL OR char_length(billing_remark) <= 1000
      ),
      billing_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      billing_prefill_source_application_id TEXT
        REFERENCES invoice_applications(id) ON DELETE SET NULL,
      billing_original_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
        'draft', 'pending_approval', 'rejected',
        'pending_seal', 'pending_invoice', 'completed'
      )),
      target_approver_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      target_approver_name_snapshot TEXT,
      target_approver_position_snapshot TEXT,
      applicant_signature_snapshot_path TEXT,
      applicant_signature_snapshot_hash TEXT CHECK(
        applicant_signature_snapshot_hash IS NULL OR
        applicant_signature_snapshot_hash ~ '^[0-9a-f]{64}$'
      ),
      applicant_signed_at TEXT,
      applicant_signed_file_id TEXT,
      approver_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      approver_name_snapshot TEXT,
      approver_position_snapshot TEXT,
      approver_signature_snapshot_path TEXT,
      approver_signature_snapshot_hash TEXT CHECK(
        approver_signature_snapshot_hash IS NULL OR
        approver_signature_snapshot_hash ~ '^[0-9a-f]{64}$'
      ),
      approved_file_id TEXT,
      decision_comment TEXT,
      submitted_invoiced_amount_snapshot NUMERIC(18,2),
      submitted_pending_amount_snapshot NUMERIC(18,2),
      submitted_remaining_amount_snapshot NUMERIC(18,2),
      submitted_at TEXT,
      decided_at TEXT,
      delivered_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      delivered_by_name_snapshot TEXT,
      delivery_note TEXT CHECK(
        delivery_note IS NULL OR char_length(delivery_note) <= 1000
      ),
      delivered_at TEXT,
      issued_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      issued_by_name_snapshot TEXT,
      issue_note TEXT CHECK(
        issue_note IS NULL OR char_length(issue_note) <= 1000
      ),
      issued_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
    );

    CREATE TABLE IF NOT EXISTS invoice_application_generated_files (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL
        REFERENCES invoice_applications(id) ON DELETE CASCADE,
      file_kind TEXT NOT NULL CHECK(file_kind IN ('applicant_signed', 'approved')),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      is_current BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    );

    ALTER TABLE invoice_application_generated_files
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE invoice_application_generated_files
      ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE invoice_application_generated_files
      DROP CONSTRAINT IF EXISTS invoice_application_generated_files_version_check;
    ALTER TABLE invoice_application_generated_files
      ADD CONSTRAINT invoice_application_generated_files_version_check
      CHECK(version >= 1) NOT VALID;
    ALTER TABLE invoice_application_generated_files
      VALIDATE CONSTRAINT invoice_application_generated_files_version_check;
    ALTER TABLE invoice_application_generated_files
      DROP CONSTRAINT IF EXISTS invoice_application_generated_files_application_id_file_kind_key;
    ALTER TABLE invoice_application_generated_files
      DROP CONSTRAINT IF EXISTS invoice_application_generated_file_application_id_file_kind_key;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_application_generated_current
      ON invoice_application_generated_files(application_id, file_kind)
      WHERE is_current = TRUE;

    ALTER TABLE invoice_applications
      ADD COLUMN IF NOT EXISTS applicant_department_snapshot TEXT NOT NULL DEFAULT '';
    UPDATE invoice_applications application
       SET applicant_department_snapshot = COALESCE(employee.department, '')
      FROM employee_profiles employee
     WHERE employee.user_id = application.applicant_id
       AND application.applicant_department_snapshot = '';
    ALTER TABLE invoice_applications
      ADD COLUMN IF NOT EXISTS applicant_signed_file_id TEXT;
    ALTER TABLE invoice_applications
      ADD COLUMN IF NOT EXISTS approved_file_id TEXT;
    ALTER TABLE invoice_applications
      ADD COLUMN IF NOT EXISTS submitted_invoiced_amount_snapshot NUMERIC(18,2);
    ALTER TABLE invoice_applications
      ADD COLUMN IF NOT EXISTS submitted_pending_amount_snapshot NUMERIC(18,2);
    ALTER TABLE invoice_applications
      ADD COLUMN IF NOT EXISTS submitted_remaining_amount_snapshot NUMERIC(18,2);
    ALTER TABLE invoice_applications
      DROP CONSTRAINT IF EXISTS invoice_applications_applicant_signed_file_id_fkey;
    ALTER TABLE invoice_applications
      ADD CONSTRAINT invoice_applications_applicant_signed_file_id_fkey
      FOREIGN KEY (applicant_signed_file_id)
      REFERENCES invoice_application_generated_files(id) ON DELETE SET NULL;
    ALTER TABLE invoice_applications
      DROP CONSTRAINT IF EXISTS invoice_applications_approved_file_id_fkey;
    ALTER TABLE invoice_applications
      ADD CONSTRAINT invoice_applications_approved_file_id_fkey
      FOREIGN KEY (approved_file_id)
      REFERENCES invoice_application_generated_files(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS invoice_application_materials (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL
        REFERENCES invoice_applications(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL CHECK(file_size > 0),
      mime_type TEXT NOT NULL,
      file_hash TEXT NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'),
      requires_seal BOOLEAN NOT NULL DEFAULT FALSE,
      has_other_expense_sheet BOOLEAN NOT NULL DEFAULT FALSE,
      is_system_generated_triplicate BOOLEAN NOT NULL DEFAULT FALSE,
      uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      UNIQUE(application_id, file_hash)
    );

    ALTER TABLE invoice_applications
      ADD COLUMN IF NOT EXISTS triplicate_project_name TEXT;
    ALTER TABLE invoice_applications
      ADD COLUMN IF NOT EXISTS triplicate_previous_payment_snapshot NUMERIC(18,2);
    ALTER TABLE invoice_applications
      ADD COLUMN IF NOT EXISTS triplicate_cumulative_payment_snapshot NUMERIC(18,2);
    ALTER TABLE invoice_applications
      DROP CONSTRAINT IF EXISTS invoice_applications_triplicate_project_name_check;
    ALTER TABLE invoice_applications
      ADD CONSTRAINT invoice_applications_triplicate_project_name_check CHECK(
        triplicate_project_name IS NULL OR
        char_length(triplicate_project_name) BETWEEN 1 AND 300
      ) NOT VALID;
    ALTER TABLE invoice_applications
      VALIDATE CONSTRAINT invoice_applications_triplicate_project_name_check;
    ALTER TABLE invoice_applications
      DROP CONSTRAINT IF EXISTS invoice_applications_triplicate_amounts_check;
    ALTER TABLE invoice_applications
      ADD CONSTRAINT invoice_applications_triplicate_amounts_check CHECK(
        (triplicate_previous_payment_snapshot IS NULL AND
         triplicate_cumulative_payment_snapshot IS NULL) OR
        (triplicate_previous_payment_snapshot >= 0 AND
         triplicate_cumulative_payment_snapshot > 0 AND
         triplicate_cumulative_payment_snapshot =
           triplicate_previous_payment_snapshot + amount)
      ) NOT VALID;
    ALTER TABLE invoice_applications
      VALIDATE CONSTRAINT invoice_applications_triplicate_amounts_check;
    ALTER TABLE invoice_application_materials
      ADD COLUMN IF NOT EXISTS is_system_generated_triplicate BOOLEAN
      NOT NULL DEFAULT FALSE;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_application_generated_triplicate
      ON invoice_application_materials(application_id)
      WHERE is_system_generated_triplicate = TRUE;

    CREATE TABLE IF NOT EXISTS invoice_application_invoice_allocations (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL
        REFERENCES invoice_applications(id) ON DELETE RESTRICT,
      invoice_id TEXT NOT NULL REFERENCES contract_invoices(id) ON DELETE CASCADE,
      allocated_amount NUMERIC(18,2) NOT NULL CHECK(allocated_amount > 0),
      created_at TEXT NOT NULL,
      UNIQUE(application_id, invoice_id)
    );

    ALTER TABLE invoice_application_invoice_allocations
      DROP CONSTRAINT IF EXISTS invoice_application_invoice_allocations_invoice_id_fkey;
    ALTER TABLE invoice_application_invoice_allocations
      ADD CONSTRAINT invoice_application_invoice_allocations_invoice_id_fkey
      FOREIGN KEY (invoice_id) REFERENCES contract_invoices(id) ON DELETE CASCADE;

    CREATE TABLE IF NOT EXISTS invoice_application_audit_logs (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL
        REFERENCES invoice_applications(id) ON DELETE RESTRICT,
      action TEXT NOT NULL CHECK(action IN (
        'draft_created', 'draft_updated', 'material_uploaded',
        'material_deleted', 'submit', 'withdraw', 'approve', 'reject', 'deliver',
        'mark_issued', 'invoice_allocated', 'invoice_allocation_reversed',
        'auto_complete', 'auto_reopen'
      )),
      actor_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
      actor_name_snapshot TEXT NOT NULL,
      actor_position_snapshot TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      comment TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TEXT NOT NULL
    );

    ALTER TABLE invoice_application_audit_logs
      DROP CONSTRAINT IF EXISTS invoice_application_audit_logs_action_check;
    ALTER TABLE invoice_application_audit_logs
      ADD CONSTRAINT invoice_application_audit_logs_action_check CHECK(
        action IN (
          'draft_created', 'draft_updated', 'material_uploaded',
          'material_deleted', 'submit', 'withdraw', 'approve', 'reject',
          'deliver', 'mark_issued', 'invoice_allocated',
          'invoice_allocation_reversed', 'auto_complete', 'auto_reopen'
        )
      ) NOT VALID;
    ALTER TABLE invoice_application_audit_logs
      VALIDATE CONSTRAINT invoice_application_audit_logs_action_check;

    CREATE INDEX IF NOT EXISTS idx_invoice_applications_contract
      ON invoice_applications(contract_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_invoice_applications_applicant
      ON invoice_applications(applicant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_invoice_applications_approver
      ON invoice_applications(target_approver_id, status, submitted_at);
    CREATE INDEX IF NOT EXISTS idx_invoice_applications_admin
      ON invoice_applications(status, decided_at);
    CREATE INDEX IF NOT EXISTS idx_invoice_application_materials_application
      ON invoice_application_materials(application_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_invoice_application_generated_application
      ON invoice_application_generated_files(application_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_invoice_application_allocations_application
      ON invoice_application_invoice_allocations(application_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_invoice_application_allocations_invoice
      ON invoice_application_invoice_allocations(invoice_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_invoice_application_audit_application
      ON invoice_application_audit_logs(application_id, created_at);

    CREATE TABLE IF NOT EXISTS contract_auxiliary_packages (
      id TEXT PRIMARY KEY,
      parent_contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      party_a TEXT,
      party_b TEXT,
      recognized_amount NUMERIC(18,2)
        CHECK(recognized_amount IS NULL OR ABS(recognized_amount) <= 999999999999.99),
      note TEXT CHECK(note IS NULL OR char_length(note) <= 1000),
      status TEXT NOT NULL DEFAULT 'processing'
        CHECK(status IN ('processing', 'succeeded', 'partial', 'failed')),
      raw_text TEXT,
      ocr_fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      ocr_lines_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_message TEXT,
      model_version TEXT,
      parser_version TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      accounting_included BOOLEAN NOT NULL DEFAULT FALSE
        CHECK(accounting_included = FALSE),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    ALTER TABLE contract_auxiliary_packages
      ADD COLUMN IF NOT EXISTS ocr_lines_json JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE contract_auxiliary_packages
      ADD COLUMN IF NOT EXISTS error_message TEXT;
    ALTER TABLE contract_auxiliary_packages
      ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0
        CHECK(retry_count >= 0);
    ALTER TABLE contract_auxiliary_packages
      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1
        CHECK(version >= 1);

    CREATE TABLE IF NOT EXISTS contract_auxiliary_files (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL REFERENCES contract_auxiliary_packages(id) ON DELETE CASCADE,
      file_kind TEXT NOT NULL CHECK(file_kind IN ('contract', 'invoice', 'receipt')),
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL CHECK(file_size > 0),
      mime_type TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
      is_current BOOLEAN NOT NULL DEFAULT TRUE,
      uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      UNIQUE(package_id, file_hash)
    );

    DROP INDEX IF EXISTS idx_contract_auxiliary_files_current_kind;
    DROP INDEX IF EXISTS idx_contract_auxiliary_files_current_contract;
    CREATE INDEX IF NOT EXISTS idx_contract_auxiliary_files_kind
      ON contract_auxiliary_files(package_id, file_kind, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_contract_auxiliary_packages_parent
      ON contract_auxiliary_packages(parent_contract_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS contract_ocr_jobs (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL REFERENCES contract_files(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued', 'processing', 'succeeded', 'partial', 'failed')),
      method TEXT,
      engine_version TEXT,
      parser_version TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
      raw_text TEXT,
      warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_message TEXT,
      requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      worker_token TEXT,
      lease_expires_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_ocr_fields (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES contract_ocr_jobs(id) ON DELETE CASCADE,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      field_code TEXT NOT NULL,
      original_value TEXT,
      normalized_value TEXT,
      final_value TEXT,
      confidence NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK(confidence >= 0 AND confidence <= 100 AND confidence = TRUNC(confidence)),
      source TEXT NOT NULL,
      page_number INTEGER CHECK(page_number IS NULL OR page_number >= 1),
      evidence TEXT,
      manually_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(job_id, field_code)
    );

    CREATE TABLE IF NOT EXISTS contract_ocr_lines (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES contract_ocr_jobs(id) ON DELETE CASCADE,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      line_index INTEGER NOT NULL CHECK(line_index >= 0),
      page_number INTEGER NOT NULL CHECK(page_number >= 1),
      text TEXT NOT NULL,
      bbox JSONB NOT NULL DEFAULT '[]'::jsonb,
      confidence NUMERIC(8,6) NOT NULL
        CHECK(confidence >= 0 AND confidence <= 1),
      model_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(job_id, line_index)
    );

    CREATE TABLE IF NOT EXISTS contract_financial_file_hashes (
      file_hash TEXT PRIMARY KEY CHECK(file_hash ~ '^[0-9a-f]{64}$'),
      file_id TEXT NOT NULL UNIQUE REFERENCES contract_files(id) ON DELETE RESTRICT,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_financial_ocr_jobs (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      file_id TEXT NOT NULL UNIQUE REFERENCES contract_files(id) ON DELETE RESTRICT,
      file_hash TEXT NOT NULL UNIQUE CHECK(file_hash ~ '^[0-9a-f]{64}$'),
      record_kind TEXT NOT NULL CHECK(record_kind IN ('invoice', 'receipt', 'payment')),
      document_kind TEXT NOT NULL CHECK(document_kind IN ('invoice', 'bank_receipt')),
      status TEXT NOT NULL DEFAULT 'processing'
        CHECK(status IN ('processing', 'verified', 'blocked', 'failed', 'consumed')),
      validation_status TEXT CHECK(validation_status IN ('verified', 'blocked', 'failed')),
      failure_kind TEXT CHECK(failure_kind IN ('infrastructure', 'document', 'recognition')),
      retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count >= 0),
      worker_token TEXT,
      lease_expires_at TEXT,
      recognition_method TEXT,
      engine_version TEXT,
      parser_version TEXT,
      evidence_text_hash TEXT CHECK(
        evidence_text_hash IS NULL OR evidence_text_hash ~ '^[0-9a-f]{64}$'
      ),
      direction TEXT CHECK(direction IN (
        'input', 'output', 'third_party', 'receipt', 'payment', 'unknown'
      )),
      document_status TEXT CHECK(document_status IN ('normal', 'void', 'red', 'unknown')),
      can_auto_post BOOLEAN NOT NULL DEFAULT FALSE,
      snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      blocking_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      record_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(status <> 'consumed' OR record_id IS NOT NULL),
      CHECK(can_auto_post = FALSE OR (
        validation_status = 'verified' AND document_status = 'normal'
      ))
    );

    CREATE TABLE IF NOT EXISTS contract_seal_verifications (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      file_id TEXT NOT NULL UNIQUE REFERENCES contract_files(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN (
        'infrastructure_failed', 'review_required',
        'difference_explanation_required', 'difference_approving',
        'difference_approved', 'difference_rejected', 'ready_to_archive',
        'archived', 'superseded'
      )),
      upload_date TEXT NOT NULL,
      approved_snapshot_json JSONB NOT NULL,
      recognition_status TEXT NOT NULL
        CHECK(recognition_status IN ('succeeded', 'partial', 'failed')),
      recognition_method TEXT,
      recognition_warnings_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      raw_text TEXT,
      mismatches_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      infrastructure_failure BOOLEAN NOT NULL DEFAULT FALSE,
      difference_explanation TEXT,
      approval_submitted_at TEXT,
      approval_completed_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_at TEXT,
      archived_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_seal_verification_fields (
      id TEXT PRIMARY KEY,
      verification_id TEXT NOT NULL
        REFERENCES contract_seal_verifications(id) ON DELETE CASCADE,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      field_code TEXT NOT NULL
        CHECK(field_code IN ('party_a', 'party_b', 'amount', 'contract_date')),
      approved_value TEXT,
      recognized_value TEXT,
      final_value TEXT,
      confidence NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK(confidence >= 0 AND confidence <= 100 AND confidence = TRUNC(confidence)),
      source TEXT NOT NULL,
      requires_manual_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
      manually_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      is_mismatch BOOLEAN NOT NULL DEFAULT FALSE,
      confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(verification_id, field_code)
    );

    CREATE TABLE IF NOT EXISTS contract_approval_rounds (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      approval_kind TEXT NOT NULL
        CHECK(approval_kind IN ('seal', 'termination', 'seal_difference')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'approved', 'rejected', 'withdrawn')),
      initiator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      initiator_role TEXT NOT NULL,
      target_approver_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      target_approver_name_snapshot TEXT NOT NULL,
      target_approver_role_snapshot TEXT NOT NULL,
      target_source TEXT NOT NULL
        CHECK(target_source IN ('project_owner', 'general_manager')),
      project_id_snapshot TEXT,
      submitted_at TEXT NOT NULL,
      completed_at TEXT,
      completed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      completed_action TEXT CHECK(completed_action IN ('approve', 'reject', 'withdraw')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_approval_records (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      approval_round_id TEXT REFERENCES contract_approval_rounds(id) ON DELETE RESTRICT,
      action TEXT NOT NULL CHECK(action IN ('submit', 'approve', 'reject', 'comment', 'withdraw', 'termination_request', 'seal_difference_submit')),
      approver_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      approver_role TEXT NOT NULL,
      comment TEXT,
      from_status TEXT,
      to_status TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_invoices (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      file_id TEXT REFERENCES contract_files(id) ON DELETE SET NULL,
      invoice_code TEXT,
      invoice_no TEXT,
      item_name TEXT,
      invoice_date TEXT NOT NULL,
      amount NUMERIC(18,2) NOT NULL CHECK(amount > 0),
      tax_amount NUMERIC(18,2) CHECK(tax_amount IS NULL OR tax_amount >= 0),
      seller TEXT,
      buyer TEXT,
      financial_ocr_job_id TEXT UNIQUE
        REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT,
      deduplication_exempt BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed', 'reversed')),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_at TEXT,
      reversed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      reversed_at TEXT,
      reverse_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_invoice_line_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES contract_invoices(id) ON DELETE CASCADE,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      line_index INTEGER NOT NULL CHECK(line_index >= 0),
      item_name TEXT NOT NULL,
      net_amount NUMERIC(18,2) NOT NULL CHECK(net_amount >= 0),
      tax_amount NUMERIC(18,2) NOT NULL CHECK(tax_amount >= 0),
      gross_amount NUMERIC(18,2) NOT NULL CHECK(gross_amount > 0),
      expense_category TEXT NOT NULL CHECK(expense_category IN (
        'rent', 'property_management', 'electricity',
        'system_maintenance', 'other_cost', 'pending_review'
      )),
      include_in_contract_accounting BOOLEAN NOT NULL DEFAULT FALSE,
      recognition_status TEXT NOT NULL CHECK(recognition_status IN (
        'verified', 'pending_review'
      )),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(invoice_id, line_index),
      CHECK(gross_amount = net_amount + tax_amount)
    );

    CREATE TABLE IF NOT EXISTS contract_receipts (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      file_id TEXT REFERENCES contract_files(id) ON DELETE SET NULL,
      receipt_date TEXT NOT NULL,
      payment_time TEXT,
      booking_date TEXT,
      amount NUMERIC(18,2) NOT NULL CHECK(amount > 0),
      payer TEXT,
      payer_account TEXT,
      payee TEXT,
      payee_account TEXT,
      bank_name TEXT,
      currency TEXT,
      electronic_receipt_no TEXT,
      transaction_serial_no TEXT,
      proof_no TEXT,
      note TEXT,
      financial_ocr_job_id TEXT UNIQUE
        REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT,
      rate_snapshot_json JSONB,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed', 'reversed')),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_at TEXT,
      reversed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      reversed_at TEXT,
      reverse_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_payments (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      file_id TEXT REFERENCES contract_files(id) ON DELETE SET NULL,
      payment_date TEXT NOT NULL,
      payment_time TEXT,
      booking_date TEXT,
      amount NUMERIC(18,2) NOT NULL CHECK(amount > 0),
      expense_category TEXT NOT NULL DEFAULT 'other'
        CHECK(expense_category IN ('rent', 'electricity', 'parking', 'car_rental', 'internet', 'other')),
      payer TEXT,
      payer_account TEXT,
      payee TEXT,
      payee_account TEXT,
      bank_name TEXT,
      currency TEXT,
      electronic_receipt_no TEXT,
      transaction_serial_no TEXT,
      proof_no TEXT,
      note TEXT,
      financial_ocr_job_id TEXT UNIQUE
        REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed', 'reversed')),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_at TEXT,
      reversed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      reversed_at TEXT,
      reverse_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_external_payments (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      file_id TEXT REFERENCES contract_files(id) ON DELETE SET NULL,
      payment_date TEXT NOT NULL,
      payment_time TEXT,
      amount NUMERIC(18,2) NOT NULL CHECK(amount > 0),
      expense_category TEXT NOT NULL DEFAULT 'other'
        CHECK(expense_category IN ('rent', 'electricity', 'parking', 'car_rental', 'internet', 'other')),
      payer TEXT,
      payer_account TEXT,
      payee TEXT,
      payee_account TEXT,
      electronic_receipt_no TEXT,
      note TEXT,
      financial_ocr_job_id TEXT UNIQUE
        REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'confirmed', 'reversed')),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_at TEXT,
      reversed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      reversed_at TEXT,
      reverse_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contract_financial_registrations (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      settlement_kind TEXT NOT NULL CHECK(settlement_kind IN ('receipt', 'payment')),
      financial_direction TEXT
        CHECK(financial_direction IS NULL OR financial_direction IN ('income', 'cost')),
      direction_invoice_record_id TEXT REFERENCES contract_invoices(id) ON DELETE RESTRICT,
      invoice_ocr_job_id TEXT UNIQUE
        REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT,
      bank_ocr_job_id TEXT UNIQUE
        REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT,
      invoice_record_id TEXT UNIQUE
        REFERENCES contract_invoices(id) ON DELETE RESTRICT,
      receipt_record_id TEXT UNIQUE
        REFERENCES contract_receipts(id) ON DELETE RESTRICT,
      payment_record_id TEXT UNIQUE
        REFERENCES contract_payments(id) ON DELETE RESTRICT,
      bank_business_key_hash TEXT UNIQUE
        CHECK(bank_business_key_hash IS NULL OR bank_business_key_hash ~ '^[0-9a-f]{64}$'),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'confirmed', 'reversed')),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_at TEXT,
      reversed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      reversed_at TEXT,
      reverse_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK(bank_ocr_job_id IS NULL OR invoice_ocr_job_id <> bank_ocr_job_id),
      CHECK(
        financial_direction IS NULL OR
        (financial_direction = 'income' AND settlement_kind = 'receipt') OR
        (financial_direction = 'cost' AND settlement_kind = 'payment')
      ),
      CHECK(
        (bank_ocr_job_id IS NULL AND receipt_record_id IS NULL
          AND payment_record_id IS NULL AND bank_business_key_hash IS NULL)
        OR (settlement_kind = 'receipt' AND bank_ocr_job_id IS NOT NULL
          AND receipt_record_id IS NOT NULL AND payment_record_id IS NULL
          AND bank_business_key_hash IS NOT NULL)
        OR (settlement_kind = 'payment' AND bank_ocr_job_id IS NOT NULL
          AND payment_record_id IS NOT NULL AND receipt_record_id IS NULL
          AND bank_business_key_hash IS NOT NULL)
      )
    );

    ALTER TABLE contract_financial_registrations
      ALTER COLUMN invoice_ocr_job_id DROP NOT NULL;
    ALTER TABLE contract_financial_registrations
      ALTER COLUMN invoice_record_id DROP NOT NULL;

    CREATE TABLE IF NOT EXISTS contract_financial_registration_items (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL
        REFERENCES contract_financial_registrations(id) ON DELETE RESTRICT,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      item_kind TEXT NOT NULL CHECK(item_kind IN ('invoice', 'receipt', 'payment', 'external_payment')),
      ocr_job_id TEXT NOT NULL UNIQUE
        REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT,
      record_id TEXT NOT NULL UNIQUE,
      business_key_hash TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(registration_id, item_kind, record_id),
      CHECK(business_key_hash IS NULL OR business_key_hash ~ '^[0-9a-f]{64}$')
    );

    CREATE TABLE IF NOT EXISTS contract_financial_registration_matches (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL
        REFERENCES contract_financial_registrations(id) ON DELETE RESTRICT,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      invoice_item_id TEXT NOT NULL
        REFERENCES contract_financial_registration_items(id) ON DELETE RESTRICT,
      settlement_item_id TEXT NOT NULL
        REFERENCES contract_financial_registration_items(id) ON DELETE RESTRICT,
      allocated_amount NUMERIC(18,2) NOT NULL CHECK(allocated_amount > 0),
      created_at TEXT NOT NULL,
      UNIQUE(registration_id, invoice_item_id, settlement_item_id),
      CHECK(invoice_item_id <> settlement_item_id)
    );

    CREATE TABLE IF NOT EXISTS contract_rate_configs (
      id TEXT PRIMARY KEY,
      rate_code TEXT NOT NULL CHECK(rate_code IN ('tax', 'marketing', 'business', 'financial')),
      rate_value NUMERIC(9,6) NOT NULL CHECK(rate_value >= 0 AND rate_value <= 1),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      change_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(rate_code, effective_from),
      CHECK(effective_to IS NULL OR effective_to > effective_from)
    );

    CREATE TABLE IF NOT EXISTS contract_audit_logs (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      actor_role TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT,
      changes_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_contract_no_unique
      ON contracts(contract_no) WHERE contract_no IS NOT NULL AND is_deleted = FALSE;
    CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_root ON contracts(root_contract_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_parent ON contracts(parent_contract_id);
    CREATE INDEX IF NOT EXISTS idx_contracts_category_status ON contracts(category, status);
    CREATE INDEX IF NOT EXISTS idx_contracts_created_at ON contracts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_files_contract ON contract_files(contract_id, file_type);
    CREATE INDEX IF NOT EXISTS idx_contract_files_hash ON contract_files(file_hash);
    CREATE INDEX IF NOT EXISTS idx_contract_ocr_jobs_contract ON contract_ocr_jobs(contract_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_ocr_jobs_status ON contract_ocr_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_contract_ocr_fields_contract ON contract_ocr_fields(contract_id, field_code);
    CREATE INDEX IF NOT EXISTS idx_contract_ocr_lines_job_page
      ON contract_ocr_lines(job_id, page_number, line_index);
    CREATE INDEX IF NOT EXISTS idx_contract_financial_ocr_contract
      ON contract_financial_ocr_jobs(contract_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_financial_ocr_status
      ON contract_financial_ocr_jobs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_contract_approvals_contract ON contract_approval_records(contract_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_contract_approval_rounds_target
      ON contract_approval_rounds(target_approver_id, status, submitted_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_approval_rounds_one_pending
      ON contract_approval_rounds(contract_id) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_contract_seal_verifications_contract
      ON contract_seal_verifications(contract_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_seal_verifications_status
      ON contract_seal_verifications(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_contract_invoices_contract ON contract_invoices(contract_id, status, invoice_date);
    CREATE INDEX IF NOT EXISTS idx_contract_invoice_lines_contract
      ON contract_invoice_line_items(contract_id, expense_category, invoice_id);
    CREATE INDEX IF NOT EXISTS idx_contract_receipts_contract ON contract_receipts(contract_id, status, receipt_date);
    CREATE INDEX IF NOT EXISTS idx_contract_payments_contract ON contract_payments(contract_id, status, payment_date);
    CREATE INDEX IF NOT EXISTS idx_contract_external_payments_contract
      ON contract_external_payments(contract_id, status, payment_date);
    CREATE INDEX IF NOT EXISTS idx_contract_financial_registrations_contract
      ON contract_financial_registrations(contract_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_financial_registration_items_registration
      ON contract_financial_registration_items(registration_id, item_kind, created_at);
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM contract_financial_registrations
        WHERE status = 'draft'
        GROUP BY contract_id HAVING COUNT(*) > 1
      ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_financial_registration_one_draft_per_contract
          ON contract_financial_registrations(contract_id)
          WHERE status = 'draft';
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_financial_registration_items_business_key
      ON contract_financial_registration_items(business_key_hash)
      WHERE business_key_hash IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_contract_financial_registration_matches_registration
      ON contract_financial_registration_matches(registration_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_contract_financial_registration_matches_invoice
      ON contract_financial_registration_matches(invoice_item_id);
    CREATE INDEX IF NOT EXISTS idx_contract_financial_registration_matches_settlement
      ON contract_financial_registration_matches(settlement_item_id);
    CREATE INDEX IF NOT EXISTS idx_contract_rates_effective ON contract_rate_configs(rate_code, effective_from DESC);
    CREATE INDEX IF NOT EXISTS idx_contract_audit_contract ON contract_audit_logs(contract_id, created_at DESC);
  `);

  // 财务登记允许先保存发票草稿，待实际回款后再补充银行回单。
  await db.exec(`
    ALTER TABLE contract_financial_registrations
      ALTER COLUMN bank_ocr_job_id DROP NOT NULL;
    ALTER TABLE contract_financial_registrations
      ALTER COLUMN bank_business_key_hash DROP NOT NULL;
    ALTER TABLE contract_financial_registrations
      DROP CONSTRAINT IF EXISTS contract_financial_registrations_check;
    ALTER TABLE contract_financial_registrations
      DROP CONSTRAINT IF EXISTS contract_financial_registrations_check1;
    ALTER TABLE contract_financial_registrations
      DROP CONSTRAINT IF EXISTS contract_financial_registrations_bank_business_key_hash_check;
    ALTER TABLE contract_financial_registrations
      ADD CONSTRAINT contract_financial_registrations_check
      CHECK(bank_ocr_job_id IS NULL OR invoice_ocr_job_id <> bank_ocr_job_id);
    ALTER TABLE contract_financial_registrations
      ADD CONSTRAINT contract_financial_registrations_bank_business_key_hash_check
      CHECK(bank_business_key_hash IS NULL OR bank_business_key_hash ~ '^[0-9a-f]{64}$');
    ALTER TABLE contract_financial_registrations
      ADD CONSTRAINT contract_financial_registrations_check1
      CHECK(
        (bank_ocr_job_id IS NULL AND receipt_record_id IS NULL
          AND payment_record_id IS NULL AND bank_business_key_hash IS NULL)
        OR (settlement_kind = 'receipt' AND bank_ocr_job_id IS NOT NULL
          AND receipt_record_id IS NOT NULL AND payment_record_id IS NULL
          AND bank_business_key_hash IS NOT NULL)
        OR (settlement_kind = 'payment' AND bank_ocr_job_id IS NOT NULL
          AND payment_record_id IS NOT NULL AND receipt_record_id IS NULL
          AND bank_business_key_hash IS NOT NULL)
      );
  `);

  // 兼容已由早期开发版本创建的合同表：补齐资产分类并替换旧支出分类约束。
  await db.exec(`
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS declared_category TEXT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS target_executor_id TEXT
      REFERENCES users(id) ON DELETE RESTRICT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS target_executor_name_snapshot TEXT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS target_executor_position_snapshot TEXT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS applicant_signature_snapshot_hash TEXT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS approver_signature_snapshot_hash TEXT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS applicant_seen_at TEXT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS chain_id TEXT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS previous_request_id TEXT
      REFERENCES contract_download_requests(id) ON DELETE RESTRICT;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_previous_request_id_fkey;
    ALTER TABLE contract_download_requests
      ADD CONSTRAINT contract_download_requests_previous_request_id_fkey
      FOREIGN KEY(previous_request_id) REFERENCES contract_download_requests(id)
      ON DELETE RESTRICT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS attempt_no INTEGER;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS withdrawn_at TEXT;
    ALTER TABLE contract_download_requests
      ADD COLUMN IF NOT EXISTS withdrawal_reason TEXT;
    ALTER TABLE contract_download_request_files
      DROP CONSTRAINT IF EXISTS contract_download_request_files_request_id_fkey;
    ALTER TABLE contract_download_request_files
      ADD CONSTRAINT contract_download_request_files_request_id_fkey
      FOREIGN KEY(request_id) REFERENCES contract_download_requests(id)
      ON DELETE RESTRICT;
    ALTER TABLE contract_download_request_audit_logs
      DROP CONSTRAINT IF EXISTS contract_download_request_audit_logs_request_id_fkey;
    ALTER TABLE contract_download_request_audit_logs
      ADD CONSTRAINT contract_download_request_audit_logs_request_id_fkey
      FOREIGN KEY(request_id) REFERENCES contract_download_requests(id)
      ON DELETE RESTRICT;
    UPDATE contract_download_requests
    SET applicant_seen_at = COALESCE(applicant_seen_at, updated_at),
        chain_id = COALESCE(chain_id, id),
        attempt_no = COALESCE(attempt_no, 1)
    WHERE applicant_seen_at IS NULL OR chain_id IS NULL OR attempt_no IS NULL;
    ALTER TABLE contract_download_requests
      ALTER COLUMN applicant_seen_at SET NOT NULL;
    ALTER TABLE contract_download_requests
      ALTER COLUMN chain_id SET NOT NULL;
    ALTER TABLE contract_download_requests
      ALTER COLUMN attempt_no SET NOT NULL;
    ALTER TABLE contract_download_requests
      ALTER COLUMN attempt_no SET DEFAULT 1;
    CREATE INDEX IF NOT EXISTS idx_contract_download_requests_applicant_unread
      ON contract_download_requests(applicant_id, updated_at)
      WHERE status <> 'pending_approval';
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_check;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_check1;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_status_check;
    ALTER TABLE contract_download_requests
      ADD CONSTRAINT contract_download_requests_status_check CHECK(
        status IN (
          'pending_approval', 'approved', 'rejected', 'withdrawn',
          'processing', 'completed'
        )
      ) NOT VALID;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_attempt_no_check;
    ALTER TABLE contract_download_requests
      ADD CONSTRAINT contract_download_requests_attempt_no_check
      CHECK(attempt_no >= 1) NOT VALID;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_withdrawal_reason_check;
    ALTER TABLE contract_download_requests
      ADD CONSTRAINT contract_download_requests_withdrawal_reason_check CHECK(
        withdrawal_reason IS NULL OR char_length(withdrawal_reason) <= 1000
      ) NOT VALID;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_lineage_check;
    ALTER TABLE contract_download_requests
      ADD CONSTRAINT contract_download_requests_lineage_check CHECK(
        (attempt_no = 1 AND previous_request_id IS NULL AND chain_id = id) OR
        (attempt_no > 1 AND previous_request_id IS NOT NULL AND chain_id <> id)
      ) NOT VALID;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_applicant_signature_hash_check;
    ALTER TABLE contract_download_requests
      ADD CONSTRAINT contract_download_requests_applicant_signature_hash_check
      CHECK(applicant_signature_snapshot_hash ~ '^[0-9a-f]{64}$') NOT VALID;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_approver_signature_hash_check;
    ALTER TABLE contract_download_requests
      ADD CONSTRAINT contract_download_requests_approver_signature_hash_check
      CHECK(
        approver_signature_snapshot_hash IS NULL OR
        approver_signature_snapshot_hash ~ '^[0-9a-f]{64}$'
      ) NOT VALID;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_status_consistency_check;
    ALTER TABLE contract_download_requests
      ADD CONSTRAINT contract_download_requests_status_consistency_check CHECK(
        (status = 'pending_approval'
          AND approver_id IS NULL AND decided_at IS NULL
          AND approved_application_file_path IS NULL
          AND approved_application_file_hash IS NULL
          AND approver_signature_snapshot_path IS NULL
          AND approver_signature_snapshot_hash IS NULL
          AND withdrawn_at IS NULL AND withdrawal_reason IS NULL)
        OR (status = 'withdrawn'
          AND approver_id IS NULL AND decided_at IS NULL
          AND approved_application_file_path IS NULL
          AND approved_application_file_hash IS NULL
          AND approver_signature_snapshot_path IS NULL
          AND approver_signature_snapshot_hash IS NULL
          AND withdrawn_at IS NOT NULL)
        OR (status = 'rejected'
          AND approver_id IS NOT NULL AND decided_at IS NOT NULL
          AND approved_application_file_path IS NULL
          AND approved_application_file_hash IS NULL
          AND approver_signature_snapshot_path IS NULL
          AND approver_signature_snapshot_hash IS NULL
          AND withdrawn_at IS NULL AND withdrawal_reason IS NULL)
        OR (status IN ('approved', 'processing', 'completed')
          AND approver_id IS NOT NULL AND decided_at IS NOT NULL
          AND approved_application_file_path IS NOT NULL
          AND approved_application_file_hash IS NOT NULL
          AND approver_signature_snapshot_path IS NOT NULL
          AND approver_signature_snapshot_hash IS NOT NULL
          AND withdrawn_at IS NULL AND withdrawal_reason IS NULL)
      ) NOT VALID;
    ALTER TABLE contract_download_requests
      DROP CONSTRAINT IF EXISTS contract_download_requests_execution_consistency_check;
    ALTER TABLE contract_download_requests
      ADD CONSTRAINT contract_download_requests_execution_consistency_check CHECK(
        (status IN ('pending_approval', 'approved', 'rejected', 'withdrawn')
          AND executor_id IS NULL AND processing_started_at IS NULL
          AND completed_at IS NULL)
        OR (status = 'processing'
          AND executor_id IS NOT NULL AND executor_name_snapshot IS NOT NULL
          AND executor_position_snapshot IS NOT NULL
          AND processing_started_at IS NOT NULL AND completed_at IS NULL)
        OR (status = 'completed'
          AND executor_id IS NOT NULL AND executor_name_snapshot IS NOT NULL
          AND executor_position_snapshot IS NOT NULL
          AND processing_started_at IS NOT NULL AND completed_at IS NOT NULL)
      ) NOT VALID;
    UPDATE contract_download_requests request
    SET target_executor_id = administrator.id,
        target_executor_name_snapshot = administrator.name,
        target_executor_position_snapshot = '管理员'
    FROM (
      SELECT id, name
      FROM users
      WHERE status = 'active' AND role = 'admin'
      ORDER BY created_at, id
      LIMIT 1
    ) administrator
    WHERE request.target_executor_id IS NULL;
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM contract_download_requests
        WHERE target_executor_id IS NULL
           OR target_executor_name_snapshot IS NULL
           OR target_executor_position_snapshot IS NULL
      ) THEN
        ALTER TABLE contract_download_requests
          ALTER COLUMN target_executor_id SET NOT NULL;
        ALTER TABLE contract_download_requests
          ALTER COLUMN target_executor_name_snapshot SET NOT NULL;
        ALTER TABLE contract_download_requests
          ALTER COLUMN target_executor_position_snapshot SET NOT NULL;
      END IF;
    END $$;
    ALTER TABLE contract_download_requests
      VALIDATE CONSTRAINT contract_download_requests_status_check;
    ALTER TABLE contract_download_requests
      VALIDATE CONSTRAINT contract_download_requests_attempt_no_check;
    ALTER TABLE contract_download_requests
      VALIDATE CONSTRAINT contract_download_requests_withdrawal_reason_check;
    ALTER TABLE contract_download_requests
      VALIDATE CONSTRAINT contract_download_requests_lineage_check;
    ALTER TABLE contract_download_requests
      VALIDATE CONSTRAINT contract_download_requests_applicant_signature_hash_check;
    ALTER TABLE contract_download_requests
      VALIDATE CONSTRAINT contract_download_requests_approver_signature_hash_check;
    ALTER TABLE contract_download_requests
      VALIDATE CONSTRAINT contract_download_requests_status_consistency_check;
    ALTER TABLE contract_download_requests
      VALIDATE CONSTRAINT contract_download_requests_execution_consistency_check;
    ALTER TABLE contract_download_request_audit_logs
      DROP CONSTRAINT IF EXISTS contract_download_request_audit_logs_action_check;
    ALTER TABLE contract_download_request_audit_logs
      ADD CONSTRAINT contract_download_request_audit_logs_action_check CHECK(
        action IN (
          'submit', 'approve', 'reject', 'withdraw', 'resubmit',
          'download_file', 'complete'
        )
      ) NOT VALID;
    ALTER TABLE contract_download_request_audit_logs
      VALIDATE CONSTRAINT contract_download_request_audit_logs_action_check;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_download_requests_previous_unique
      ON contract_download_requests(previous_request_id)
      WHERE previous_request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_download_requests_chain_attempt
      ON contract_download_requests(chain_id, attempt_no);
    CREATE INDEX IF NOT EXISTS idx_contract_download_requests_chain_history
      ON contract_download_requests(chain_id, attempt_no, created_at);
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM contract_download_requests
        WHERE applicant_signature_snapshot_hash IS NULL
      ) THEN
        ALTER TABLE contract_download_requests
          ALTER COLUMN applicant_signature_snapshot_hash SET NOT NULL;
      END IF;
    END $$;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS requires_auxiliary_materials BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS declared_subtype TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS asset_category TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS financial_direction TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS financial_direction_source TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS financial_direction_invoice_id TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS financial_direction_confirmed_by TEXT
      REFERENCES users(id) ON DELETE RESTRICT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS financial_direction_confirmed_at TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS financial_direction_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_financial_direction_source_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_financial_direction_source_check CHECK(
        financial_direction_source IS NULL OR
        financial_direction_source IN ('contract_category', 'invoice')
      ) NOT VALID;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_financial_direction_check;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS original_contract_amount NUMERIC(18,2);
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS recognized_original_amount NUMERIC(18,2);
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS recognized_final_amount NUMERIC(18,2);
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS amount_before_change NUMERIC(18,2);
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS amount_after_change NUMERIC(18,2);
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS current_effective_amount NUMERIC(18,2);
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS supplement_change_type TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS supplement_sequence INTEGER;
    ALTER TABLE contract_financial_registrations
      ADD COLUMN IF NOT EXISTS financial_direction TEXT;
    ALTER TABLE contract_financial_registrations
      ADD COLUMN IF NOT EXISTS direction_invoice_record_id TEXT;
    ALTER TABLE contract_seal_applications
      ADD COLUMN IF NOT EXISTS approval_round_id TEXT;
    ALTER TABLE contract_seal_applications
      ADD COLUMN IF NOT EXISTS approved_file_id TEXT;
    ALTER TABLE contract_seal_applications
      ADD COLUMN IF NOT EXISTS approver_id TEXT;
    ALTER TABLE contract_seal_applications
      ADD COLUMN IF NOT EXISTS approver_name TEXT;
    ALTER TABLE contract_seal_applications
      ADD COLUMN IF NOT EXISTS approver_role TEXT;
    ALTER TABLE contract_seal_applications
      ADD COLUMN IF NOT EXISTS approver_signature_snapshot_path TEXT;
    ALTER TABLE contract_seal_applications
      ADD COLUMN IF NOT EXISTS approver_signature_snapshot_hash TEXT;
    ALTER TABLE contract_seal_applications
      ADD COLUMN IF NOT EXISTS approver_signed_at TEXT;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_financial_direction_invoice_id_fkey;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_financial_direction_invoice_id_fkey
      FOREIGN KEY (financial_direction_invoice_id) REFERENCES contract_invoices(id)
      ON DELETE RESTRICT;
    ALTER TABLE contract_financial_registrations
      DROP CONSTRAINT IF EXISTS contract_financial_registrations_direction_invoice_record_id_fkey;
    ALTER TABLE contract_financial_registrations
      ADD CONSTRAINT contract_financial_registrations_direction_invoice_record_id_fkey
      FOREIGN KEY (direction_invoice_record_id) REFERENCES contract_invoices(id)
      ON DELETE RESTRICT;
    UPDATE contract_financial_registrations registration
    SET financial_direction = CASE invoice_job.direction
          WHEN 'output' THEN 'income'
          WHEN 'input' THEN 'cost'
        END,
        direction_invoice_record_id = registration.invoice_record_id
    FROM contract_financial_ocr_jobs invoice_job
    WHERE invoice_job.id = registration.invoice_ocr_job_id
      AND invoice_job.direction IN ('input', 'output')
      AND NOT EXISTS (
        SELECT 1
        FROM contract_financial_registration_items item
        JOIN contract_financial_ocr_jobs item_job ON item_job.id = item.ocr_job_id
        WHERE item.registration_id = registration.id
          AND item.item_kind = 'invoice'
          AND item_job.direction IS DISTINCT FROM invoice_job.direction
      );
    WITH eligible_direction AS (
      SELECT COALESCE(contract.root_contract_id, contract.id) AS root_id,
        registration.id AS registration_id,
        registration.financial_direction,
        registration.direction_invoice_record_id AS invoice_record_id,
        registration.confirmed_by,
        registration.confirmed_at
      FROM contract_financial_registrations registration
      JOIN contracts contract ON contract.id = registration.contract_id
      WHERE registration.status = 'confirmed'
        AND registration.financial_direction IS NOT NULL
        AND registration.direction_invoice_record_id IS NOT NULL
        AND registration.confirmed_by IS NOT NULL
        AND registration.confirmed_at IS NOT NULL
    ), consistent_root AS (
      SELECT root_id FROM eligible_direction
      GROUP BY root_id
      HAVING COUNT(DISTINCT financial_direction) = 1
    ), confirmed_direction AS (
      SELECT DISTINCT ON (eligible.root_id)
        eligible.root_id, eligible.financial_direction,
        eligible.invoice_record_id, eligible.confirmed_by,
        eligible.confirmed_at
      FROM eligible_direction eligible
      JOIN consistent_root consistent ON consistent.root_id = eligible.root_id
      ORDER BY eligible.root_id, eligible.confirmed_at ASC,
        eligible.registration_id ASC
    )
    UPDATE contracts root
    SET financial_direction = confirmed.financial_direction,
        financial_direction_source = 'invoice',
        financial_direction_invoice_id = confirmed.invoice_record_id,
        financial_direction_confirmed_by = confirmed.confirmed_by,
        financial_direction_confirmed_at = confirmed.confirmed_at,
        financial_direction_version = 1
    FROM confirmed_direction confirmed
    WHERE root.id = confirmed.root_id
      AND root.financial_direction IS NULL;
    UPDATE contracts contract
    SET financial_direction = CASE
          WHEN COALESCE(contract.declared_category, contract.category) = 'asset'
            THEN 'cost'
          ELSE 'income'
        END,
        financial_direction_source = 'contract_category',
        financial_direction_invoice_id = NULL,
        financial_direction_confirmed_by = NULL,
        financial_direction_confirmed_at = NULL,
        financial_direction_version = GREATEST(contract.financial_direction_version, 1)
    WHERE COALESCE(contract.declared_category, contract.category)
      IN ('main_business', 'non_main', 'asset');
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_financial_direction_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_financial_direction_check CHECK(
        (
          financial_direction IS NULL AND financial_direction_source IS NULL AND
          financial_direction_invoice_id IS NULL AND
          financial_direction_confirmed_by IS NULL AND
          financial_direction_confirmed_at IS NULL AND
          financial_direction_version = 0 AND
          COALESCE(declared_category, category) IS NULL
        ) OR (
          financial_direction IN ('income', 'cost') AND
          financial_direction_source = 'contract_category' AND
          financial_direction = CASE
            WHEN COALESCE(declared_category, category) = 'asset' THEN 'cost'
            ELSE 'income'
          END AND
          financial_direction_invoice_id IS NULL AND
          financial_direction_confirmed_by IS NULL AND
          financial_direction_confirmed_at IS NULL AND
          financial_direction_version >= 1
        ) OR (
          financial_direction IN ('income', 'cost') AND
          financial_direction_source = 'invoice' AND
          financial_direction_invoice_id IS NOT NULL AND
          financial_direction_confirmed_by IS NOT NULL AND
          financial_direction_confirmed_at IS NOT NULL AND
          financial_direction_version >= 1
        )
      ) NOT VALID;
    ALTER TABLE contract_financial_registrations
      DROP CONSTRAINT IF EXISTS contract_financial_registrations_direction_check;
    ALTER TABLE contract_financial_registrations
      ADD CONSTRAINT contract_financial_registrations_direction_check CHECK(
        financial_direction IS NULL OR
        (financial_direction = 'income' AND settlement_kind = 'receipt') OR
        (financial_direction = 'cost' AND settlement_kind = 'payment')
      ) NOT VALID;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_financial_direction_check;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_financial_direction_source_check;
    ALTER TABLE contract_financial_registrations
      VALIDATE CONSTRAINT contract_financial_registrations_direction_check;
    ALTER TABLE contract_seal_applications
      DROP CONSTRAINT IF EXISTS contract_seal_applications_approval_round_id_fkey;
    ALTER TABLE contract_seal_applications
      ADD CONSTRAINT contract_seal_applications_approval_round_id_fkey
      FOREIGN KEY (approval_round_id) REFERENCES contract_approval_rounds(id)
      ON DELETE RESTRICT;
    ALTER TABLE contract_seal_applications
      DROP CONSTRAINT IF EXISTS contract_seal_applications_approved_file_id_fkey;
    ALTER TABLE contract_seal_applications
      ADD CONSTRAINT contract_seal_applications_approved_file_id_fkey
      FOREIGN KEY (approved_file_id) REFERENCES contract_files(id)
      ON DELETE RESTRICT;
    ALTER TABLE contract_seal_applications
      DROP CONSTRAINT IF EXISTS contract_seal_applications_approver_id_fkey;
    ALTER TABLE contract_seal_applications
      ADD CONSTRAINT contract_seal_applications_approver_id_fkey
      FOREIGN KEY (approver_id) REFERENCES users(id)
      ON DELETE RESTRICT;
    ALTER TABLE contract_seal_applications
      DROP CONSTRAINT IF EXISTS contract_seal_applications_approval_signature_check;
    ALTER TABLE contract_seal_applications
      ADD CONSTRAINT contract_seal_applications_approval_signature_check CHECK(
        (
          approval_round_id IS NULL AND approved_file_id IS NULL AND
          approver_id IS NULL AND approver_name IS NULL AND approver_role IS NULL AND
          approver_signature_snapshot_path IS NULL AND
          approver_signature_snapshot_hash IS NULL AND approver_signed_at IS NULL
        ) OR (
          status = 'signed' AND approval_round_id IS NOT NULL AND
          approved_file_id IS NOT NULL AND approver_id IS NOT NULL AND
          approver_name IS NOT NULL AND approver_role = 'general_manager' AND
          approver_signature_snapshot_path IS NOT NULL AND
          approver_signature_snapshot_hash ~ '^[0-9a-f]{64}$' AND
          approver_signed_at IS NOT NULL
        )
      ) NOT VALID;
    ALTER TABLE contract_seal_applications
      VALIDATE CONSTRAINT contract_seal_applications_approval_signature_check;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_seal_applications_approval_round
      ON contract_seal_applications(approval_round_id)
      WHERE approval_round_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_seal_applications_approved_file
      ON contract_seal_applications(approved_file_id)
      WHERE approved_file_id IS NOT NULL;
    ALTER TABLE contracts ALTER COLUMN relation_type DROP DEFAULT;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_status_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_status_check
      CHECK(status IN (
        'draft', 'approving', 'pending_seal', 'effective', 'executing',
        'completed', 'rejected', 'terminated'
      )) NOT VALID;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_previous_status_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_previous_status_check
      CHECK(previous_status IS NULL OR previous_status IN (
        'draft', 'approving', 'pending_seal', 'effective', 'executing',
        'completed', 'rejected', 'terminated'
      )) NOT VALID;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_approval_state_coherence_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_approval_state_coherence_check CHECK(
        (
          status = 'approving' AND pending_action IS NOT NULL AND
          previous_status IS NOT NULL
        ) OR (
          status <> 'approving' AND pending_action IS NULL AND
          previous_status IS NULL
        )
      ) NOT VALID;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_approval_state_coherence_check;
    ALTER TABLE contract_seal_verifications
      DROP CONSTRAINT IF EXISTS contract_seal_verifications_status_check;
    ALTER TABLE contract_seal_verifications
      ADD CONSTRAINT contract_seal_verifications_status_check
      CHECK(status IN (
        'infrastructure_failed', 'review_required',
        'difference_explanation_required', 'difference_approving',
        'difference_approved', 'difference_rejected', 'ready_to_archive',
        'archived', 'superseded'
      )) NOT VALID;
    UPDATE contracts
      SET declared_subtype = asset_category
      WHERE declared_subtype IS NULL
        AND declared_category = 'asset'
        AND asset_category IN (
          'procurement', 'software', 'equipment', 'house_rental',
          'vehicle_rental', 'parking_space', 'office_asset'
        );
    ALTER TABLE contracts ALTER COLUMN area DROP DEFAULT;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_declared_category_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_declared_category_check
      CHECK(declared_category IS NULL OR declared_category IN (
        'main_business', 'non_main', 'asset'
      )) NOT VALID;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_beijing_area_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_beijing_area_check
      CHECK(
        declared_category IS NULL OR area IN (
          '全部',
          '东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山区',
          '门头沟区', '房山区', '通州区', '顺义区', '昌平区', '大兴区',
          '怀柔区', '平谷区', '密云区', '延庆区'
        )
      ) NOT VALID;
    ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS business_contract_no TEXT;
    ALTER TABLE contracts
      ADD COLUMN IF NOT EXISTS termination_target_contract_id TEXT;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_termination_target_contract_id_fkey;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_termination_target_contract_id_fkey
      FOREIGN KEY (termination_target_contract_id) REFERENCES contracts(id)
      ON DELETE RESTRICT;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_termination_target_coherence_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_termination_target_coherence_check CHECK(
        (relation_type = 'termination' OR termination_target_contract_id IS NULL)
        AND termination_target_contract_id IS DISTINCT FROM id
      ) NOT VALID;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_termination_target_coherence_check;
    CREATE INDEX IF NOT EXISTS idx_contracts_termination_target
      ON contracts(termination_target_contract_id)
      WHERE termination_target_contract_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_active_termination_target
      ON contracts(termination_target_contract_id)
      WHERE relation_type = 'termination'
        AND termination_target_contract_id IS NOT NULL
        AND is_deleted = FALSE
        AND status NOT IN ('rejected', 'terminated');
    UPDATE contracts SET relation_type = 'main' WHERE relation_type = 'independent';
    WITH supplement_names AS (
      SELECT child.id,
        CASE
          WHEN BTRIM(COALESCE(NULLIF(parent.project_name, ''), parent.title))
            ~ '补充协议书?$'
          THEN REGEXP_REPLACE(
            BTRIM(COALESCE(NULLIF(parent.project_name, ''), parent.title)),
            '补充协议书?$',
            '补充协议'
          )
          ELSE BTRIM(COALESCE(NULLIF(parent.project_name, ''), parent.title))
            || '补充协议'
        END AS generated_name
      FROM contracts child
      JOIN contracts parent ON parent.id = child.parent_contract_id
      WHERE child.relation_type = 'supplement'
        AND BTRIM(COALESCE(NULLIF(parent.project_name, ''), parent.title, '')) <> ''
    )
    UPDATE contracts child
    SET title = supplement_names.generated_name,
      project_name = supplement_names.generated_name
    FROM supplement_names
    WHERE child.id = supplement_names.id
      AND (
        child.title IS DISTINCT FROM supplement_names.generated_name OR
        child.project_name IS DISTINCT FROM supplement_names.generated_name
      );
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_relation_type_check;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_relation_type_allowed_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_relation_type_allowed_check
      CHECK(relation_type IN ('main', 'supplement', 'termination')) NOT VALID;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_relation_type_allowed_check;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_relation_link_coherence_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_relation_link_coherence_check CHECK(
        (
          relation_type = 'main' AND parent_contract_id IS NULL AND
          root_contract_id = id
        ) OR (
          relation_type IN ('supplement', 'termination') AND
          parent_contract_id IS NOT NULL AND
          root_contract_id = parent_contract_id
        )
      ) NOT VALID;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_relation_link_coherence_check;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_supplement_change_type_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_supplement_change_type_check CHECK(
        supplement_change_type IS NULL OR supplement_change_type IN (
          'payment_terms_only', 'amount_adjustment',
          'amount_and_payment', 'legacy_unresolved'
        )
      ) NOT VALID;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_supplement_sequence_check;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_supplement_amount_chain_check;
    UPDATE contracts
    SET amount_before_change = NULL,
        amount_after_change = NULL,
        amount_delta = CASE
          WHEN supplement_change_type = 'payment_terms_only' THEN 0
          ELSE amount_delta
        END,
        supplement_change_type = CASE
          WHEN supplement_change_type = 'payment_terms_only'
            THEN 'payment_terms_only'
          ELSE 'legacy_unresolved'
        END
    WHERE relation_type = 'supplement'
      AND (
        (amount_before_change IS NULL) <>
          (amount_after_change IS NULL)
        OR (
          amount_before_change IS NOT NULL AND
          amount_after_change IS NOT NULL AND
          (
            amount_delta IS NULL OR
            amount_after_change <> amount_before_change + amount_delta
          )
        )
        OR (
          supplement_change_type = 'payment_terms_only' AND
          (
            amount_delta IS DISTINCT FROM 0 OR
            (
              amount_before_change IS NOT NULL AND
              amount_after_change IS DISTINCT FROM amount_before_change
            )
          )
        )
      );
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_supplement_amount_chain_check CHECK(
        relation_type <> 'supplement' OR
        (
          (
            amount_before_change IS NULL AND amount_after_change IS NULL
          ) OR (
            amount_before_change IS NOT NULL AND
            amount_after_change IS NOT NULL AND amount_delta IS NOT NULL AND
            amount_after_change = amount_before_change + amount_delta
          )
        ) AND (
          supplement_change_type IS DISTINCT FROM 'payment_terms_only' OR
          (
            amount_delta = 0 AND
            (
              amount_before_change IS NULL OR
              amount_after_change = amount_before_change
            )
          )
        )
      ) NOT VALID;
    UPDATE contracts
    SET supplement_sequence = NULL
    WHERE relation_type <> 'supplement'
       OR supplement_sequence <= 0;
    WITH duplicate_sequences AS (
      SELECT id, ROW_NUMBER() OVER (
        PARTITION BY root_contract_id, supplement_sequence
        ORDER BY created_at ASC, id ASC
      ) AS duplicate_rank
      FROM contracts
      WHERE relation_type = 'supplement'
        AND supplement_sequence IS NOT NULL
        AND supplement_sequence > 0
    )
    UPDATE contracts child
    SET supplement_sequence = NULL
    FROM duplicate_sequences duplicate
    WHERE child.id = duplicate.id
      AND duplicate.duplicate_rank > 1;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_supplement_sequence_check CHECK(
        (
          relation_type = 'supplement' AND
          supplement_sequence IS NOT NULL AND supplement_sequence > 0
        ) OR (
          relation_type <> 'supplement' AND supplement_sequence IS NULL
        )
      ) NOT VALID;
    UPDATE contracts
    SET original_contract_amount = amount_delta
    WHERE relation_type = 'main'
      AND original_contract_amount IS NULL
      AND amount_delta IS NOT NULL;
    WITH existing_sequence_max AS (
      SELECT root_contract_id,
        COALESCE(MAX(supplement_sequence), 0)::int AS max_sequence
      FROM contracts
      WHERE relation_type = 'supplement'
      GROUP BY root_contract_id
    ), ranked_supplements AS (
      SELECT child.id,
        COALESCE(existing.max_sequence, 0) + ROW_NUMBER() OVER (
          PARTITION BY child.root_contract_id
          ORDER BY
            CASE WHEN child.effective_at IS NULL THEN 1 ELSE 0 END,
            child.effective_at ASC NULLS LAST,
            child.sealed_at ASC NULLS LAST,
            child.created_at ASC,
            child.id ASC
        )::int AS sequence_number
      FROM contracts child
      LEFT JOIN existing_sequence_max existing
        ON existing.root_contract_id = child.root_contract_id
      WHERE child.relation_type = 'supplement'
        AND child.supplement_sequence IS NULL
    )
    UPDATE contracts child
    SET supplement_sequence = ranked.sequence_number
    FROM ranked_supplements ranked
    WHERE child.id = ranked.id;
    UPDATE contracts
    SET supplement_change_type = CASE
      WHEN amount_delta IS NULL THEN 'legacy_unresolved'
      ELSE 'amount_adjustment'
    END
    WHERE relation_type = 'supplement'
      AND supplement_change_type IS NULL;
    WITH effective_ordered AS (
      SELECT child.id, child.root_contract_id,
        ROW_NUMBER() OVER (
          PARTITION BY child.root_contract_id
          ORDER BY child.effective_at ASC NULLS LAST,
            child.supplement_sequence ASC, child.created_at ASC, child.id ASC
        ) AS sequence_order,
        COALESCE(root.original_contract_amount, root.amount_delta, 0)
          AS root_amount,
        CASE
          WHEN child.supplement_change_type = 'payment_terms_only' THEN NULL
          ELSE COALESCE(
            child.recognized_final_amount,
            CASE
              WHEN child.amount_before_change IS NOT NULL
                AND child.amount_after_change IS NOT NULL
              THEN child.amount_after_change
              ELSE NULL
            END
          )
        END AS authoritative_after,
        CASE
          WHEN child.supplement_change_type = 'payment_terms_only' THEN 0
          ELSE child.amount_delta
        END AS trusted_delta,
        CASE
          WHEN child.supplement_change_type = 'payment_terms_only' THEN TRUE
          WHEN child.recognized_final_amount IS NOT NULL THEN TRUE
          WHEN child.amount_before_change IS NOT NULL
            AND child.amount_after_change IS NOT NULL THEN TRUE
          WHEN child.amount_delta IS NOT NULL THEN TRUE
          ELSE FALSE
        END AS is_resolved
      FROM contracts child
      JOIN contracts root ON root.id = child.root_contract_id
      WHERE child.relation_type = 'supplement'
        AND child.is_deleted = FALSE
        AND child.status IN ('effective', 'executing', 'completed')
        AND NOT EXISTS (
          SELECT 1 FROM contracts termination
          WHERE termination.root_contract_id = child.root_contract_id
            AND termination.relation_type = 'termination'
            AND termination.termination_target_contract_id IS NOT NULL
            AND termination.is_deleted = FALSE
            AND termination.status IN ('effective', 'executing', 'completed')
        )
    ), effective_segmented AS (
      SELECT ordered.*,
        COUNT(authoritative_after) OVER (
          PARTITION BY root_contract_id
          ORDER BY sequence_order
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS amount_segment,
        SUM(CASE WHEN is_resolved THEN 0 ELSE 1 END) OVER (
          PARTITION BY root_contract_id
          ORDER BY sequence_order
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS unresolved_count
      FROM effective_ordered ordered
    ), effective_accumulated AS (
      SELECT segmented.*,
        CASE WHEN unresolved_count = 0 THEN
          COALESCE(
            MAX(authoritative_after) OVER (
              PARTITION BY root_contract_id, amount_segment
            ),
            root_amount
          ) + SUM(
            CASE WHEN authoritative_after IS NULL
              THEN trusted_delta ELSE 0 END
          ) OVER (
            PARTITION BY root_contract_id, amount_segment
            ORDER BY sequence_order
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )
        ELSE NULL END AS calculated_after
      FROM effective_segmented segmented
    ), effective_snapshots AS (
      SELECT id,
        LAG(calculated_after, 1, root_amount) OVER (
          PARTITION BY root_contract_id ORDER BY sequence_order
        ) AS calculated_before,
        calculated_after
      FROM effective_accumulated
    )
    UPDATE contracts child
    SET amount_before_change = snapshot.calculated_before,
        amount_after_change = snapshot.calculated_after,
        amount_delta = snapshot.calculated_after - snapshot.calculated_before,
        supplement_change_type = CASE
          WHEN child.supplement_change_type = 'payment_terms_only'
            THEN 'payment_terms_only'
          WHEN child.supplement_change_type = 'amount_and_payment'
            THEN 'amount_and_payment'
          ELSE 'amount_adjustment'
        END
    FROM effective_snapshots snapshot
    WHERE child.id = snapshot.id
      AND snapshot.calculated_before IS NOT NULL
      AND snapshot.calculated_after IS NOT NULL;
    WITH root_amounts AS (
      SELECT root.id,
        COALESCE((
          SELECT latest.amount_after_change
          FROM contracts latest
          WHERE latest.root_contract_id = root.id
            AND latest.relation_type = 'supplement'
            AND latest.is_deleted = FALSE
            AND latest.status IN ('effective', 'executing', 'completed')
            AND latest.amount_after_change IS NOT NULL
          ORDER BY latest.effective_at DESC NULLS LAST,
            latest.supplement_sequence DESC NULLS LAST,
            latest.created_at DESC, latest.id DESC
          LIMIT 1
        ), root.current_effective_amount, root.original_contract_amount,
          root.amount_delta, 0) AS current_amount
      FROM contracts root
      WHERE root.relation_type = 'main'
        AND NOT EXISTS (
          SELECT 1 FROM contracts termination
          WHERE termination.root_contract_id = root.id
            AND termination.relation_type = 'termination'
            AND termination.termination_target_contract_id IS NOT NULL
            AND termination.is_deleted = FALSE
            AND termination.status IN ('effective', 'executing', 'completed')
        )
        AND NOT EXISTS (
          SELECT 1 FROM contracts unresolved
          WHERE unresolved.root_contract_id = root.id
            AND unresolved.relation_type = 'supplement'
            AND unresolved.is_deleted = FALSE
            AND unresolved.status IN ('effective', 'executing', 'completed')
            AND (
              unresolved.amount_before_change IS NULL OR
              unresolved.amount_after_change IS NULL
            )
        )
    )
    UPDATE contracts root
    SET current_effective_amount = root_amounts.current_amount
    FROM root_amounts
    WHERE root.id = root_amounts.id
      AND root.current_effective_amount IS DISTINCT FROM root_amounts.current_amount;
    WITH supplement_names AS (
      SELECT child.id,
        REGEXP_REPLACE(
          BTRIM(COALESCE(NULLIF(parent.project_name, ''), parent.title)),
          '补充协议书?(?:[（(][0-9]+[）)])?$',
          ''
        ) || '补充协议（' || child.supplement_sequence::text || '）'
          AS generated_name
      FROM contracts child
      JOIN contracts parent ON parent.id = child.parent_contract_id
      WHERE child.relation_type = 'supplement'
        AND child.supplement_sequence IS NOT NULL
        AND BTRIM(COALESCE(NULLIF(parent.project_name, ''), parent.title, '')) <> ''
    )
    UPDATE contracts child
    SET title = names.generated_name,
      project_name = names.generated_name
    FROM supplement_names names
    WHERE child.id = names.id
      AND (child.title IS DISTINCT FROM names.generated_name OR
        child.project_name IS DISTINCT FROM names.generated_name);
    DROP INDEX IF EXISTS idx_contracts_supplement_sequence_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_supplement_sequence_unique
      ON contracts(root_contract_id, supplement_sequence)
      WHERE relation_type = 'supplement' AND supplement_sequence IS NOT NULL;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_supplement_change_type_check;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_supplement_sequence_check;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_supplement_amount_chain_check;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_business_contract_no_unique
      ON contracts(business_contract_no)
      WHERE business_contract_no IS NOT NULL AND is_deleted = FALSE;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_declared_asset_category_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_declared_asset_category_check
      CHECK(
        declared_category IS NULL OR
        declared_subtype IS NULL OR
        (declared_category = 'main_business' AND asset_category IS NULL AND
          declared_subtype IN ('engineering_consulting', 'preliminary_procedures', 'technical_consulting')) OR
        (declared_category = 'non_main' AND asset_category IS NULL AND
          declared_subtype IN ('non_main_income', 'other_service')) OR
        (declared_category = 'asset' AND asset_category = declared_subtype AND
          declared_subtype IN (
            'procurement', 'software', 'equipment', 'house_rental',
            'vehicle_rental', 'parking_space', 'office_asset'
          ))
      ) NOT VALID;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_declared_subtype_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_declared_subtype_check
      CHECK(declared_subtype IS NULL OR declared_subtype IN (
        'engineering_consulting', 'preliminary_procedures',
        'technical_consulting', 'non_main_income', 'other_service',
        'procurement', 'software', 'equipment', 'house_rental',
        'vehicle_rental', 'parking_space', 'office_asset'
      )) NOT VALID;
    WITH affected_projects AS MATERIALIZED (
      SELECT DISTINCT project_id
      FROM contracts
      WHERE COALESCE(declared_category, category) = 'asset'
        AND project_id IS NOT NULL
    ), cleared_asset_projects AS (
      UPDATE contracts
      SET project_id = NULL
      WHERE COALESCE(declared_category, category) = 'asset'
        AND project_id IS NOT NULL
      RETURNING id
    ), scoped AS (
      SELECT c.*,
        root_contract.status AS root_status,
        root_contract.pending_action AS root_pending_action,
        root_contract.previous_status AS root_previous_status,
        root_contract.is_deleted AS root_is_deleted,
        root_contract.current_effective_amount AS root_current_effective_amount,
        root_contract.original_contract_amount AS root_original_contract_amount,
        root_contract.amount_delta AS root_amount_delta
      FROM contracts c
      JOIN contracts root_contract
        ON root_contract.id = COALESCE(c.root_contract_id, c.id)
      WHERE c.project_id IN (SELECT project_id FROM affected_projects)
        AND COALESCE(c.declared_category, c.category) IS DISTINCT FROM 'asset'
        AND c.is_deleted = FALSE
    ), root_groups AS (
      SELECT DISTINCT project_id,
        COALESCE(root_contract_id, id) AS root_id,
        CASE
          WHEN root_status = 'approving'
            AND root_pending_action = 'termination'
            AND root_previous_status IN ('effective', 'executing', 'completed')
          THEN root_previous_status
          ELSE root_status
        END AS effective_root_status,
        root_is_deleted,
        COALESCE(
          root_current_effective_amount,
          root_original_contract_amount,
          root_amount_delta,
          0
        ) AS current_amount
      FROM scoped
    )
    UPDATE worklog_projects p
    SET contract_total_amount = COALESCE((
          SELECT SUM(root.current_amount)
          FROM root_groups root
          WHERE root.project_id = p.id
            AND root.root_is_deleted = FALSE
            AND root.effective_root_status IN (
              'effective', 'executing', 'completed'
            )
        ), 0),
        contract_status = CASE
          WHEN EXISTS (SELECT 1 FROM root_groups WHERE project_id = p.id AND root_is_deleted = FALSE AND effective_root_status = 'executing') THEN '执行中'
          WHEN EXISTS (SELECT 1 FROM root_groups WHERE project_id = p.id AND root_is_deleted = FALSE AND effective_root_status = 'effective') THEN '生效中'
          WHEN EXISTS (SELECT 1 FROM root_groups WHERE project_id = p.id AND root_is_deleted = FALSE AND effective_root_status = 'pending_seal') THEN '待盖章'
          WHEN EXISTS (SELECT 1 FROM root_groups WHERE project_id = p.id AND root_is_deleted = FALSE AND effective_root_status = 'approving') THEN '审批中'
          WHEN EXISTS (SELECT 1 FROM root_groups WHERE project_id = p.id AND root_is_deleted = FALSE AND effective_root_status = 'draft') THEN '草拟中'
          WHEN EXISTS (SELECT 1 FROM root_groups WHERE project_id = p.id AND root_is_deleted = FALSE AND effective_root_status = 'completed') THEN '已完成'
          WHEN EXISTS (SELECT 1 FROM root_groups WHERE project_id = p.id AND root_is_deleted = FALSE AND effective_root_status = 'rejected') THEN '已拒绝'
          WHEN EXISTS (SELECT 1 FROM root_groups WHERE project_id = p.id AND root_is_deleted = FALSE AND effective_root_status = 'terminated') THEN '终止'
          ELSE NULL
        END,
        updated_at = CURRENT_TIMESTAMP::TEXT
    WHERE p.id IN (SELECT project_id FROM affected_projects)
      AND (SELECT COUNT(*) FROM cleared_asset_projects) >= 0;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_asset_project_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_asset_project_check
      CHECK(COALESCE(declared_category, category) IS DISTINCT FROM 'asset' OR project_id IS NULL) NOT VALID;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_asset_project_check;
    ALTER TABLE contract_ocr_fields
      DROP CONSTRAINT IF EXISTS contract_ocr_fields_confidence_integer_check;
    ALTER TABLE contract_ocr_fields
      ADD CONSTRAINT contract_ocr_fields_confidence_integer_check
      CHECK(confidence = TRUNC(confidence)) NOT VALID;
    ALTER TABLE contract_seal_verification_fields
      DROP CONSTRAINT IF EXISTS contract_seal_verification_fields_confidence_integer_check;
    ALTER TABLE contract_seal_verification_fields
      ADD CONSTRAINT contract_seal_verification_fields_confidence_integer_check
      CHECK(confidence = TRUNC(confidence)) NOT VALID;

    SELECT setval(
      'contract_no_sequence',
      GREATEST(
        (SELECT last_value FROM contract_no_sequence),
        COALESCE((
          SELECT MAX(SUBSTRING(contract_no FROM '([0-9]+)$')::BIGINT)
          FROM contracts
          WHERE contract_no ~ '^HT-[0-9]{8}-[0-9]+$'
        ), 1)
      ),
      (SELECT is_called FROM contract_no_sequence) OR EXISTS (
        SELECT 1 FROM contracts WHERE contract_no ~ '^HT-[0-9]{8}-[0-9]+$'
      )
    );

    UPDATE contracts
    SET contract_no = 'HT-' ||
      TO_CHAR(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai', 'YYYYMMDD') ||
      '-' || LPAD(nextval('contract_no_sequence')::text, 6, '0')
    WHERE contract_no IS NULL OR BTRIM(contract_no) = '';
    ALTER TABLE contracts ALTER COLUMN contract_no SET NOT NULL;

    ALTER TABLE contract_approval_records
      ADD COLUMN IF NOT EXISTS approval_round_id TEXT
      REFERENCES contract_approval_rounds(id) ON DELETE RESTRICT;

    ALTER TABLE contract_approval_records
      DROP CONSTRAINT IF EXISTS contract_approval_records_action_check;
    ALTER TABLE contract_approval_records
      ADD CONSTRAINT contract_approval_records_action_check
      CHECK(action IN ('submit', 'approve', 'reject', 'comment', 'withdraw', 'termination_request', 'seal_difference_submit'));

    CREATE UNIQUE INDEX IF NOT EXISTS contract_files_contract_id_file_hash_key
      ON contract_files(contract_id, file_hash);
    DROP INDEX IF EXISTS idx_contract_files_contract_hash_unique;
    DROP INDEX IF EXISTS idx_contract_files_hash_unique;

    WITH ranked_current_approval_files AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY contract_id, file_type
          ORDER BY created_at DESC, id DESC
        ) AS current_rank
      FROM contract_files
      WHERE is_current = TRUE
        AND file_type IN ('draft_contract', 'seal_application', 'triplicate', 'payment_request')
    )
    UPDATE contract_files AS target
    SET is_current = FALSE
    FROM ranked_current_approval_files AS ranked
    WHERE target.id = ranked.id AND ranked.current_rank > 1;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_files_one_current_approval_material
      ON contract_files(contract_id, file_type)
      WHERE is_current = TRUE
        AND file_type IN ('draft_contract', 'seal_application', 'triplicate', 'payment_request');

    WITH ranked_current_sealed_files AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY contract_id
          ORDER BY created_at DESC, id DESC
        ) AS current_rank
      FROM contract_files
      WHERE is_current = TRUE AND file_type = 'sealed_contract'
    )
    UPDATE contract_files AS target
    SET is_current = FALSE
    FROM ranked_current_sealed_files AS ranked
    WHERE target.id = ranked.id AND ranked.current_rank > 1;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_contract_files_one_current_sealed_contract
      ON contract_files(contract_id)
      WHERE is_current = TRUE AND file_type = 'sealed_contract';

    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS asset_category TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lease_start_date TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lease_end_date TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lease_monthly_rent NUMERIC(18,2);
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lease_monthly_property_fee NUMERIC(18,2);
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lease_term_months INTEGER;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lease_amount_source TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lease_operation_type TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lease_previous_end_date TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewed_from_contract_id TEXT;
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS renewed_from_lease_end_date TEXT;
    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_renewed_from_contract_id_fkey;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_renewed_from_contract_id_fkey
      FOREIGN KEY (renewed_from_contract_id) REFERENCES contracts(id)
      ON DELETE RESTRICT;

    DROP TABLE IF EXISTS contract_safe_legacy_renewals;
    CREATE TEMP TABLE contract_safe_legacy_renewals AS
    SELECT child.id AS renewal_id,
      parent.id AS source_id,
      child.amount_before_change AS source_amount,
      child.amount_delta AS renewal_amount,
      child.lease_previous_end_date AS source_lease_end_date,
      child.lease_start_date AS renewal_lease_start_date,
      child.lease_end_date AS renewal_lease_end_date,
      child.status AS renewal_status,
      child.updated_by AS migration_actor_id,
      parent.status AS source_status_before,
      parent.current_effective_amount AS source_amount_before,
      parent.lease_end_date AS source_lease_end_before,
      parent.asset_funding_mode AS source_asset_funding_mode,
      child.relation_type AS legacy_relation_type,
      child.parent_contract_id AS legacy_parent_contract_id,
      child.root_contract_id AS legacy_root_contract_id,
      child.title AS legacy_title,
      child.project_name AS legacy_project_name,
      child.amount_before_change AS legacy_amount_before_change,
      child.amount_after_change AS legacy_amount_after_change,
      COALESCE(
        NULLIF(BTRIM(recognized_name.value), ''),
        NULLIF(BTRIM(REGEXP_REPLACE(
          COALESCE(NULLIF(child.project_name, ''), child.title, ''),
          '补充协议书?(?:[（(][0-9]+[）)])?$',
          ''
        )), ''),
        NULLIF(BTRIM(child.project_name), ''),
        NULLIF(BTRIM(child.title), ''),
        child.contract_no
      ) AS renewal_name
    FROM contracts child
    JOIN contracts parent ON parent.id = child.parent_contract_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        NULLIF(BTRIM(field.normalized_value), ''),
        NULLIF(BTRIM(field.original_value), '')
      ) AS value
      FROM contract_ocr_jobs job
      JOIN contract_ocr_fields field ON field.job_id = job.id
      WHERE job.contract_id = child.id
        AND field.field_code = 'project_name'
      ORDER BY job.created_at DESC, job.id DESC
      LIMIT 1
    ) recognized_name ON TRUE
    WHERE child.lease_operation_type = 'renewal'
      AND child.relation_type = 'supplement'
      AND child.status IN ('effective', 'executing', 'completed')
      AND child.is_deleted = FALSE
      AND parent.relation_type = 'main'
      AND parent.status IN ('effective', 'executing', 'completed')
      AND parent.is_deleted = FALSE
      AND COALESCE(parent.category, parent.declared_category) = 'asset'
      AND parent.declared_subtype IN (
        'house_rental', 'vehicle_rental', 'parking_space'
      )
      AND child.amount_before_change IS NOT NULL
      AND child.amount_delta IS NOT NULL
      AND child.amount_delta > 0
      AND child.amount_after_change =
        child.amount_before_change + child.amount_delta
      AND parent.current_effective_amount = child.amount_after_change
      AND child.lease_previous_end_date IS NOT NULL
      AND child.lease_start_date IS NOT NULL
      AND child.lease_end_date IS NOT NULL
      AND child.lease_start_date > child.lease_previous_end_date
      AND child.lease_end_date >= child.lease_start_date
      AND parent.lease_end_date = child.lease_end_date
      AND NOT EXISTS (
        SELECT 1 FROM contract_invoices record
        WHERE record.contract_id = child.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_receipts record
        WHERE record.contract_id = child.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_payments record
        WHERE record.contract_id = child.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_external_payments record
        WHERE record.contract_id = child.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_invoices record
        JOIN contracts linked ON linked.id = record.contract_id
        WHERE COALESCE(linked.root_contract_id, linked.id) = parent.id
          AND record.status = 'draft'
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_receipts record
        JOIN contracts linked ON linked.id = record.contract_id
        WHERE COALESCE(linked.root_contract_id, linked.id) = parent.id
          AND record.status = 'draft'
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_payments record
        JOIN contracts linked ON linked.id = record.contract_id
        WHERE COALESCE(linked.root_contract_id, linked.id) = parent.id
          AND record.status = 'draft'
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_external_payments record
        JOIN contracts linked ON linked.id = record.contract_id
        WHERE COALESCE(linked.root_contract_id, linked.id) = parent.id
          AND record.status = 'draft'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM contracts later
        WHERE later.root_contract_id = parent.id
          AND later.id <> child.id
          AND later.is_deleted = FALSE
          AND later.relation_type IN ('supplement', 'termination')
          AND later.status IN ('effective', 'executing', 'completed', 'terminated')
          AND (
            COALESCE(later.effective_at, later.created_at) >
              COALESCE(child.effective_at, child.created_at)
            OR COALESCE(later.supplement_sequence, 0) >
              COALESCE(child.supplement_sequence, 0)
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_invoices record
        JOIN contracts linked ON linked.id = record.contract_id
        WHERE COALESCE(linked.root_contract_id, linked.id) = parent.id
          AND record.status = 'confirmed'
          AND (
            record.invoice_date > child.lease_previous_end_date OR
            record.invoice_date >= child.lease_start_date
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_receipts record
        JOIN contracts linked ON linked.id = record.contract_id
        WHERE COALESCE(linked.root_contract_id, linked.id) = parent.id
          AND record.status = 'confirmed'
          AND (
            record.receipt_date > child.lease_previous_end_date OR
            record.receipt_date >= child.lease_start_date
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_payments record
        JOIN contracts linked ON linked.id = record.contract_id
        WHERE COALESCE(linked.root_contract_id, linked.id) = parent.id
          AND record.status = 'confirmed'
          AND (
            record.payment_date > child.lease_previous_end_date OR
            record.payment_date >= child.lease_start_date
          )
      )
      AND NOT EXISTS (
        SELECT 1 FROM contract_external_payments record
        JOIN contracts linked ON linked.id = record.contract_id
        WHERE COALESCE(linked.root_contract_id, linked.id) = parent.id
          AND record.status = 'confirmed'
          AND (
            record.payment_date > child.lease_previous_end_date OR
            record.payment_date >= child.lease_start_date
          )
      );

    UPDATE contracts source
    SET current_effective_amount = migration.source_amount,
      lease_end_date = migration.source_lease_end_date,
      lease_term_months = CASE
        WHEN source.lease_start_date ~ '^2[0-9]{3}-[0-9]{2}-[0-9]{2}$'
          AND migration.source_lease_end_date ~ '^2[0-9]{3}-[0-9]{2}-[0-9]{2}$'
        THEN (
          (EXTRACT(YEAR FROM migration.source_lease_end_date::date) -
            EXTRACT(YEAR FROM source.lease_start_date::date)) * 12 +
          EXTRACT(MONTH FROM migration.source_lease_end_date::date) -
            EXTRACT(MONTH FROM source.lease_start_date::date) +
          CASE WHEN EXTRACT(DAY FROM migration.source_lease_end_date::date) >
            EXTRACT(DAY FROM source.lease_start_date::date)
            THEN 1 ELSE 0 END
        )::integer
        ELSE source.lease_term_months
      END,
      status = CASE
        WHEN migration.source_amount > 0 AND COALESCE((
          SELECT SUM(record.amount)
          FROM contract_external_payments record
          JOIN contracts linked ON linked.id = record.contract_id
          WHERE COALESCE(linked.root_contract_id, linked.id) = source.id
            AND record.status = 'confirmed'
        ), 0) >= migration.source_amount
          AND source.asset_funding_mode = 'engineering_to_technology'
        THEN 'completed'
        WHEN migration.source_amount > 0 AND COALESCE((
          SELECT SUM(record.amount)
          FROM contract_payments record
          JOIN contracts linked ON linked.id = record.contract_id
          WHERE COALESCE(linked.root_contract_id, linked.id) = source.id
            AND record.status = 'confirmed'
        ), 0) >= migration.source_amount
          AND source.asset_funding_mode IS DISTINCT FROM 'engineering_to_technology'
        THEN 'completed'
        WHEN EXISTS (
          SELECT 1 FROM contract_invoices record
          JOIN contracts linked ON linked.id = record.contract_id
          WHERE COALESCE(linked.root_contract_id, linked.id) = source.id
            AND record.status = 'confirmed'
          UNION ALL
          SELECT 1 FROM contract_payments record
          JOIN contracts linked ON linked.id = record.contract_id
          WHERE COALESCE(linked.root_contract_id, linked.id) = source.id
            AND record.status = 'confirmed'
          UNION ALL
          SELECT 1 FROM contract_external_payments record
          JOIN contracts linked ON linked.id = record.contract_id
          WHERE COALESCE(linked.root_contract_id, linked.id) = source.id
            AND record.status = 'confirmed'
        ) THEN 'executing'
        ELSE 'effective'
      END,
      completed_at = CASE
        WHEN migration.source_amount > 0 AND (
          (source.asset_funding_mode = 'engineering_to_technology' AND
            COALESCE((SELECT SUM(record.amount)
              FROM contract_external_payments record
              JOIN contracts linked ON linked.id = record.contract_id
              WHERE COALESCE(linked.root_contract_id, linked.id) = source.id
                AND record.status = 'confirmed'), 0) >= migration.source_amount)
          OR
          (source.asset_funding_mode IS DISTINCT FROM 'engineering_to_technology' AND
            COALESCE((SELECT SUM(record.amount)
              FROM contract_payments record
              JOIN contracts linked ON linked.id = record.contract_id
              WHERE COALESCE(linked.root_contract_id, linked.id) = source.id
                AND record.status = 'confirmed'), 0) >= migration.source_amount)
        ) THEN COALESCE(source.completed_at, NOW()::text)
        ELSE NULL
      END,
      updated_at = NOW()::text,
      version = source.version + 1
    FROM contract_safe_legacy_renewals migration
    WHERE source.id = migration.source_id;

    UPDATE contracts renewal
    SET relation_type = 'main', parent_contract_id = NULL,
      root_contract_id = renewal.id,
      renewed_from_contract_id = migration.source_id,
      renewed_from_lease_end_date = migration.source_lease_end_date,
      title = migration.renewal_name,
      project_name = migration.renewal_name,
      original_contract_amount = migration.renewal_amount,
      recognized_original_amount = migration.renewal_amount,
      recognized_final_amount = migration.renewal_amount,
      current_effective_amount = migration.renewal_amount,
      amount_delta = migration.renewal_amount,
      amount_before_change = NULL, amount_after_change = NULL,
      supplement_change_type = NULL, supplement_sequence = NULL,
      lease_operation_type = NULL, lease_previous_end_date = NULL,
      asset_funding_mode = COALESCE(
        renewal.asset_funding_mode, migration.source_asset_funding_mode
      ),
      updated_at = NOW()::text, version = renewal.version + 1
    FROM contract_safe_legacy_renewals migration
    WHERE renewal.id = migration.renewal_id;

    INSERT INTO contract_audit_logs (
      id, contract_id, action, actor_id, actor_role, from_status, to_status,
      changes_json, created_at
    )
    SELECT 'migration-renewal-source-' || MD5(migration.renewal_id),
      migration.source_id, 'legacy_rental_renewal_source_restored',
      migration.migration_actor_id, actor.role,
      migration.source_status_before, source.status,
      JSONB_BUILD_OBJECT(
        'renewalContractId', migration.renewal_id,
        'previousStatus', migration.source_status_before,
        'previousAmount', migration.source_amount_before,
        'previousLeaseEndDate', migration.source_lease_end_before,
        'restoredAmount', migration.source_amount,
        'restoredLeaseEndDate', migration.source_lease_end_date,
        'migration', 'supplement_to_independent_main'
      ), NOW()::text
    FROM contract_safe_legacy_renewals migration
    JOIN contracts source ON source.id = migration.source_id
    JOIN users actor ON actor.id = migration.migration_actor_id
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO contract_audit_logs (
      id, contract_id, action, actor_id, actor_role, from_status, to_status,
      changes_json, created_at
    )
    SELECT 'migration-renewal-contract-' || MD5(migration.renewal_id),
      migration.renewal_id, 'legacy_rental_renewal_migrated',
      migration.migration_actor_id, actor.role,
      renewal.status, renewal.status,
      JSONB_BUILD_OBJECT(
        'renewedFromContractId', migration.source_id,
        'renewedFromLeaseEndDate', migration.source_lease_end_date,
        'renewalAmount', migration.renewal_amount,
        'legacyRelationType', migration.legacy_relation_type,
        'legacyParentContractId', migration.legacy_parent_contract_id,
        'legacyRootContractId', migration.legacy_root_contract_id,
        'legacyTitle', migration.legacy_title,
        'legacyProjectName', migration.legacy_project_name,
        'legacyAmountBeforeChange', migration.legacy_amount_before_change,
        'legacyAmountAfterChange', migration.legacy_amount_after_change,
        'migration', 'supplement_to_independent_main'
      ), NOW()::text
    FROM contract_safe_legacy_renewals migration
    JOIN contracts renewal ON renewal.id = migration.renewal_id
    JOIN users actor ON actor.id = migration.migration_actor_id
    ON CONFLICT (id) DO NOTHING;

    DROP TABLE IF EXISTS contract_safe_legacy_renewals;

    INSERT INTO contract_audit_logs (
      id, contract_id, action, actor_id, actor_role, from_status, to_status,
      changes_json, created_at
    )
    SELECT 'migration-renewal-source-evidence-' || MD5(renewal.id),
      source.id, 'legacy_rental_renewal_source_evidence_added',
      renewal.updated_by, actor.role, source.status, source.status,
      JSONB_BUILD_OBJECT(
        'referencedAuditId', original_audit.id,
        'renewalContractId', renewal.id,
        'previousAmount', source.current_effective_amount +
          renewal.current_effective_amount,
        'previousLeaseEndDate', renewal.lease_end_date,
        'evidenceType', 'migration_evidence_supplement'
      ), NOW()::text
    FROM contracts renewal
    JOIN contracts source ON source.id = renewal.renewed_from_contract_id
    JOIN users actor ON actor.id = renewal.updated_by
    JOIN contract_audit_logs original_audit
      ON original_audit.id =
        'migration-renewal-source-' || MD5(renewal.id)
    WHERE renewal.renewed_from_contract_id IS NOT NULL
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO contract_audit_logs (
      id, contract_id, action, actor_id, actor_role, from_status, to_status,
      changes_json, created_at
    )
    SELECT 'migration-renewal-contract-evidence-' || MD5(renewal.id),
      renewal.id, 'legacy_rental_renewal_contract_evidence_added',
      renewal.updated_by, actor.role, renewal.status, renewal.status,
      JSONB_BUILD_OBJECT(
        'referencedAuditId', original_audit.id,
        'legacyRelationType', 'supplement',
        'legacyParentContractId', renewal.renewed_from_contract_id,
        'legacyRootContractId', renewal.renewed_from_contract_id,
        'legacyTitle', COALESCE((
          SELECT creation.changes_json #>> '{inherited,contractName}'
          FROM contract_audit_logs creation
          WHERE creation.contract_id = renewal.id
            AND creation.action = 'create'
          ORDER BY creation.created_at ASC, creation.id ASC
          LIMIT 1
        ), renewal.title),
        'evidenceType', 'migration_evidence_supplement'
      ), NOW()::text
    FROM contracts renewal
    JOIN users actor ON actor.id = renewal.updated_by
    JOIN contract_audit_logs original_audit
      ON original_audit.id =
        'migration-renewal-contract-' || MD5(renewal.id)
    WHERE renewal.renewed_from_contract_id IS NOT NULL
    ON CONFLICT (id) DO NOTHING;

    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_renewed_from_coherence_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_renewed_from_coherence_check CHECK(
        (
          renewed_from_contract_id IS NULL AND
          renewed_from_lease_end_date IS NULL
        ) OR (
          renewed_from_contract_id IS NOT NULL AND
          renewed_from_lease_end_date IS NOT NULL AND
          renewed_from_contract_id IS DISTINCT FROM id AND
          relation_type = 'main' AND parent_contract_id IS NULL AND
          root_contract_id IS NOT NULL AND root_contract_id = id
        )
      ) NOT VALID;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_renewed_from_coherence_check;
    CREATE INDEX IF NOT EXISTS idx_contracts_renewed_from
      ON contracts(renewed_from_contract_id)
      WHERE renewed_from_contract_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contracts_one_renewal_successor
      ON contracts(renewed_from_contract_id)
      WHERE renewed_from_contract_id IS NOT NULL
        AND is_deleted = FALSE AND status <> 'rejected';
    ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_lease_operation_type_check;
    ALTER TABLE contracts ADD CONSTRAINT contracts_lease_operation_type_check
      CHECK(lease_operation_type IS NULL OR lease_operation_type = 'renewal');
    ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_lease_operation_relation_check;
    ALTER TABLE contracts ADD CONSTRAINT contracts_lease_operation_relation_check
      CHECK(lease_operation_type IS NULL OR relation_type = 'supplement');
    ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_lease_operation_previous_end_check;
    ALTER TABLE contracts ADD CONSTRAINT contracts_lease_operation_previous_end_check
      CHECK(lease_operation_type IS NULL OR lease_previous_end_date IS NOT NULL);
    ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_lease_monthly_property_fee_check;
    ALTER TABLE contracts ADD CONSTRAINT contracts_lease_monthly_property_fee_check
      CHECK(lease_monthly_property_fee IS NULL OR lease_monthly_property_fee > 0);
    ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_lease_amount_source_check;
    ALTER TABLE contracts ADD CONSTRAINT contracts_lease_amount_source_check
      CHECK(lease_amount_source IS NULL OR lease_amount_source IN (
        'contract_total', 'monthly_rent_calculated',
        'monthly_rent_property_fee_calculated'
      ));
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS asset_funding_mode TEXT;
    ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_asset_funding_mode_check;
    ALTER TABLE contracts ADD CONSTRAINT contracts_asset_funding_mode_check
      CHECK(asset_funding_mode IS NULL OR asset_funding_mode IN (
        'engineering_direct', 'engineering_to_technology',
        'technology_direct', 'pending_review'
      ));
    UPDATE contracts
    SET asset_funding_mode = CASE
      WHEN NORMALIZE(REGEXP_REPLACE(COALESCE(party_a, '') || COALESCE(party_b, ''), '[[:space:]]+', '', 'g'), NFKC)
        LIKE '%北京羽隶工程咨询有限公司%' THEN 'engineering_direct'
      ELSE 'engineering_to_technology'
    END
    WHERE COALESCE(category, declared_category) = 'asset'
      AND COALESCE(asset_funding_mode, 'pending_review') IN (
        'pending_review', 'technology_direct'
      );
    CREATE INDEX IF NOT EXISTS idx_contracts_lease_end_date
      ON contracts(lease_end_date)
      WHERE lease_end_date IS NOT NULL AND is_deleted = FALSE;
    ALTER TABLE contract_ocr_jobs ADD COLUMN IF NOT EXISTS worker_token TEXT;
    ALTER TABLE contract_ocr_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TEXT;
    ALTER TABLE contract_financial_ocr_jobs ADD COLUMN IF NOT EXISTS failure_kind TEXT;
    ALTER TABLE contract_financial_ocr_jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contract_financial_ocr_jobs ADD COLUMN IF NOT EXISTS worker_token TEXT;
    ALTER TABLE contract_financial_ocr_jobs ADD COLUMN IF NOT EXISTS lease_expires_at TEXT;
    ALTER TABLE contract_financial_ocr_jobs
      DROP CONSTRAINT IF EXISTS contract_financial_ocr_jobs_failure_kind_check;
    ALTER TABLE contract_financial_ocr_jobs
      ADD CONSTRAINT contract_financial_ocr_jobs_failure_kind_check
      CHECK(failure_kind IS NULL OR failure_kind IN ('infrastructure', 'document', 'recognition'));
    ALTER TABLE contract_financial_ocr_jobs
      DROP CONSTRAINT IF EXISTS contract_financial_ocr_jobs_retry_count_check;
    ALTER TABLE contract_financial_ocr_jobs
      ADD CONSTRAINT contract_financial_ocr_jobs_retry_count_check
      CHECK(retry_count >= 0);
    ALTER TABLE contract_invoices ADD COLUMN IF NOT EXISTS note TEXT;
    ALTER TABLE contract_invoices ADD COLUMN IF NOT EXISTS item_name TEXT;
    ALTER TABLE contract_invoices ALTER COLUMN tax_amount DROP NOT NULL;
    ALTER TABLE contract_invoices ALTER COLUMN tax_amount DROP DEFAULT;
    CREATE TABLE IF NOT EXISTS contract_invoice_line_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES contract_invoices(id) ON DELETE CASCADE,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      line_index INTEGER NOT NULL CHECK(line_index >= 0),
      item_name TEXT NOT NULL,
      net_amount NUMERIC(18,2) NOT NULL CHECK(net_amount >= 0),
      tax_amount NUMERIC(18,2) NOT NULL CHECK(tax_amount >= 0),
      gross_amount NUMERIC(18,2) NOT NULL CHECK(gross_amount > 0),
      expense_category TEXT NOT NULL CHECK(expense_category IN (
        'rent', 'property_management', 'electricity',
        'system_maintenance', 'other_cost', 'pending_review'
      )),
      include_in_contract_accounting BOOLEAN NOT NULL DEFAULT FALSE,
      recognition_status TEXT NOT NULL CHECK(recognition_status IN (
        'verified', 'pending_review'
      )),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(invoice_id, line_index),
      CHECK(gross_amount = net_amount + tax_amount)
    );
    CREATE INDEX IF NOT EXISTS idx_contract_invoice_lines_contract
      ON contract_invoice_line_items(contract_id, expense_category, invoice_id);
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS note TEXT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS payment_time TEXT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS booking_date TEXT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS payer_account TEXT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS payee_account TEXT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS bank_name TEXT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS currency TEXT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS electronic_receipt_no TEXT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS transaction_serial_no TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS note TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS payment_time TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS booking_date TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS payer_account TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS payee_account TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS bank_name TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS currency TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS electronic_receipt_no TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS transaction_serial_no TEXT;
    CREATE TABLE IF NOT EXISTS contract_external_payments (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE RESTRICT,
      file_id TEXT REFERENCES contract_files(id) ON DELETE SET NULL,
      payment_date TEXT NOT NULL,
      payment_time TEXT,
      amount NUMERIC(18,2) NOT NULL CHECK(amount > 0),
      expense_category TEXT NOT NULL DEFAULT 'other'
        CHECK(expense_category IN ('rent', 'electricity', 'parking', 'car_rental', 'internet', 'other')),
      payer TEXT,
      payer_account TEXT,
      payee TEXT,
      payee_account TEXT,
      electronic_receipt_no TEXT,
      note TEXT,
      financial_ocr_job_id TEXT UNIQUE
        REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK(status IN ('draft', 'confirmed', 'reversed')),
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      confirmed_at TEXT,
      reversed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      reversed_at TEXT,
      reverse_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_contract_external_payments_contract
      ON contract_external_payments(contract_id, status, payment_date);
    ALTER TABLE contract_financial_registration_items
      DROP CONSTRAINT IF EXISTS contract_financial_registration_items_item_kind_check;
    ALTER TABLE contract_financial_registration_items
      ADD CONSTRAINT contract_financial_registration_items_item_kind_check
      CHECK(item_kind IN ('invoice', 'receipt', 'payment', 'external_payment'));
    ALTER TABLE contract_invoices ADD COLUMN IF NOT EXISTS confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT;
    ALTER TABLE contract_invoices ADD COLUMN IF NOT EXISTS confirmed_at TEXT;
    ALTER TABLE contract_invoices ADD COLUMN IF NOT EXISTS deduplication_exempt BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE contract_invoices ADD COLUMN IF NOT EXISTS financial_ocr_job_id TEXT UNIQUE
      REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS confirmed_at TEXT;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS rate_snapshot_json JSONB;
    ALTER TABLE contract_receipts ADD COLUMN IF NOT EXISTS financial_ocr_job_id TEXT UNIQUE
      REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS confirmed_by TEXT REFERENCES users(id) ON DELETE RESTRICT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS confirmed_at TEXT;
    ALTER TABLE contract_payments ADD COLUMN IF NOT EXISTS financial_ocr_job_id TEXT UNIQUE
      REFERENCES contract_financial_ocr_jobs(id) ON DELETE RESTRICT;
    ALTER TABLE contract_rate_configs ADD COLUMN IF NOT EXISTS change_reason TEXT;
    ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_asset_category_check;
    ALTER TABLE contracts ADD CONSTRAINT contracts_asset_category_check
      CHECK(asset_category IS NULL OR asset_category IN (
        'procurement', 'software', 'equipment', 'house_rental',
        'vehicle_rental', 'parking_space', 'office_asset', 'other'
      ));

    UPDATE contracts
       SET declared_subtype = 'vehicle_rental',
           asset_category = 'vehicle_rental'
     WHERE COALESCE(declared_category, category) = 'asset'
       AND (lease_start_date IS NOT NULL OR lease_end_date IS NOT NULL)
       AND (COALESCE(title, '') || ' ' || COALESCE(project_name, ''))
         ~ '(小客车|车辆|汽车|租车)';
    UPDATE contracts
       SET declared_subtype = 'house_rental',
           asset_category = 'house_rental'
     WHERE COALESCE(declared_category, category) = 'asset'
       AND (lease_start_date IS NOT NULL OR lease_end_date IS NOT NULL)
       AND declared_subtype <> 'vehicle_rental'
       AND (COALESCE(title, '') || ' ' || COALESCE(project_name, ''))
         ~ '(房屋|房租|租房|办公场所|公寓|场地)';

    UPDATE contract_payments
    SET expense_category = 'other'
    WHERE expense_category NOT IN ('rent', 'electricity', 'parking', 'car_rental', 'internet', 'other');
    ALTER TABLE contract_payments DROP CONSTRAINT IF EXISTS contract_payments_expense_category_check;
    ALTER TABLE contract_payments ADD CONSTRAINT contract_payments_expense_category_check
      CHECK(expense_category IN ('rent', 'electricity', 'parking', 'car_rental', 'internet', 'other'));

    ALTER TABLE contract_invoices DROP CONSTRAINT IF EXISTS contract_invoices_status_check;
    ALTER TABLE contract_receipts DROP CONSTRAINT IF EXISTS contract_receipts_status_check;
    ALTER TABLE contract_payments DROP CONSTRAINT IF EXISTS contract_payments_status_check;

    UPDATE contract_invoices
    SET status = 'confirmed',
      confirmed_by = COALESCE(confirmed_by, created_by),
      confirmed_at = COALESCE(confirmed_at, created_at)
    WHERE status IN ('active', 'confirmed');
    UPDATE contract_receipts
    SET status = 'confirmed',
      confirmed_by = COALESCE(confirmed_by, created_by),
      confirmed_at = COALESCE(confirmed_at, created_at)
    WHERE status IN ('active', 'confirmed');
    UPDATE contract_payments
    SET status = 'confirmed',
      confirmed_by = COALESCE(confirmed_by, created_by),
      confirmed_at = COALESCE(confirmed_at, created_at)
    WHERE status IN ('active', 'confirmed');

    ALTER TABLE contract_invoices ALTER COLUMN status SET DEFAULT 'draft';
    ALTER TABLE contract_receipts ALTER COLUMN status SET DEFAULT 'draft';
    ALTER TABLE contract_payments ALTER COLUMN status SET DEFAULT 'draft';
    ALTER TABLE contract_invoices ADD CONSTRAINT contract_invoices_status_check
      CHECK(status IN ('draft', 'confirmed', 'reversed'));
    ALTER TABLE contract_receipts ADD CONSTRAINT contract_receipts_status_check
      CHECK(status IN ('draft', 'confirmed', 'reversed'));
    ALTER TABLE contract_payments ADD CONSTRAINT contract_payments_status_check
      CHECK(status IN ('draft', 'confirmed', 'reversed'));

    INSERT INTO contract_financial_file_hashes (
      file_hash, file_id, contract_id, created_at
    )
    SELECT DISTINCT ON (file.file_hash)
      file.file_hash, file.id, file.contract_id, file.created_at
    FROM contract_files AS file
    WHERE file.file_type IN ('invoice', 'receipt', 'payment')
      AND file.file_hash ~ '^[0-9a-f]{64}$'
    ORDER BY file.file_hash, file.created_at ASC, file.id ASC
    ON CONFLICT (file_hash) DO NOTHING;

    WITH ranked_invoice_numbers AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY
            LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(seller), NFKC), '[[:space:]]+', '', 'g')),
            LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(invoice_no), NFKC), '[[:space:]]+', '', 'g'))
          ORDER BY created_at ASC, id ASC
        ) AS duplicate_rank
      FROM contract_invoices
      WHERE seller IS NOT NULL AND invoice_no IS NOT NULL
    )
    UPDATE contract_invoices AS target
    SET deduplication_exempt = TRUE
    FROM ranked_invoice_numbers AS ranked
    WHERE target.id = ranked.id AND ranked.duplicate_rank > 1;

    DROP INDEX IF EXISTS idx_contract_invoice_number_unique;
    DROP INDEX IF EXISTS idx_contract_receipt_proof_unique;
    DROP INDEX IF EXISTS idx_contract_payment_proof_unique;
    DROP INDEX IF EXISTS idx_contract_invoice_seller_number_unique;
    CREATE UNIQUE INDEX idx_contract_invoice_seller_number_unique
      ON contract_invoices (
        LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(seller), NFKC), '[[:space:]]+', '', 'g')),
        LOWER(REGEXP_REPLACE(NORMALIZE(BTRIM(invoice_no), NFKC), '[[:space:]]+', '', 'g'))
      )
      WHERE seller IS NOT NULL AND invoice_no IS NOT NULL
        AND deduplication_exempt = FALSE;

    UPDATE contract_rate_configs
    SET rate_value = ROUND(rate_value, 4)
    WHERE rate_value <> ROUND(rate_value, 4);
    ALTER TABLE contract_rate_configs
      DROP CONSTRAINT IF EXISTS contract_rate_configs_basis_point_precision_check;
    ALTER TABLE contract_rate_configs
      ADD CONSTRAINT contract_rate_configs_basis_point_precision_check
      CHECK(rate_value = ROUND(rate_value, 4));

    ALTER TABLE contracts
      DROP CONSTRAINT IF EXISTS contracts_amount_safe_range_check;
    ALTER TABLE contracts
      ADD CONSTRAINT contracts_amount_safe_range_check
      CHECK(
        (amount_delta IS NULL OR ABS(amount_delta) <= 999999999999.99) AND
        (original_contract_amount IS NULL OR
          original_contract_amount BETWEEN 0 AND 999999999999.99) AND
        (recognized_original_amount IS NULL OR
          recognized_original_amount BETWEEN 0 AND 999999999999.99) AND
        (recognized_final_amount IS NULL OR
          recognized_final_amount BETWEEN 0 AND 999999999999.99) AND
        (amount_before_change IS NULL OR
          amount_before_change BETWEEN 0 AND 999999999999.99) AND
        (amount_after_change IS NULL OR
          amount_after_change BETWEEN 0 AND 999999999999.99) AND
        (current_effective_amount IS NULL OR
          current_effective_amount BETWEEN 0 AND 999999999999.99)
      )
      NOT VALID;
    ALTER TABLE contract_invoices
      DROP CONSTRAINT IF EXISTS contract_invoices_amount_safe_range_check;
    ALTER TABLE contract_invoices
      ADD CONSTRAINT contract_invoices_amount_safe_range_check
      CHECK(amount <= 999999999999.99 AND tax_amount <= 999999999999.99)
      NOT VALID;
    ALTER TABLE contract_receipts
      DROP CONSTRAINT IF EXISTS contract_receipts_amount_safe_range_check;
    ALTER TABLE contract_receipts
      ADD CONSTRAINT contract_receipts_amount_safe_range_check
      CHECK(amount <= 999999999999.99)
      NOT VALID;
    ALTER TABLE contract_payments
      DROP CONSTRAINT IF EXISTS contract_payments_amount_safe_range_check;
    ALTER TABLE contract_payments
      ADD CONSTRAINT contract_payments_amount_safe_range_check
      CHECK(amount <= 999999999999.99)
      NOT VALID;
    ALTER TABLE contract_external_payments
      DROP CONSTRAINT IF EXISTS contract_external_payments_amount_safe_range_check;
    ALTER TABLE contract_external_payments
      ADD CONSTRAINT contract_external_payments_amount_safe_range_check
      CHECK(amount <= 999999999999.99)
      NOT VALID;

    CREATE INDEX IF NOT EXISTS idx_contract_ocr_jobs_claim
      ON contract_ocr_jobs(status, lease_expires_at, created_at);
  `);

  const unresolvedEffectiveSupplementAmounts = await db.get<{
    count: number;
  }>(`
    SELECT COUNT(*)::int AS count
    FROM contracts
    WHERE relation_type = 'supplement'
      AND is_deleted = FALSE
      AND status IN ('effective', 'executing', 'completed')
      AND (
        supplement_change_type = 'legacy_unresolved' OR
        amount_before_change IS NULL OR
        amount_after_change IS NULL
      )
  `);
  if (Number(unresolvedEffectiveSupplementAmounts?.count || 0) > 0) {
    console.warn(
      `存在 ${Number(unresolvedEffectiveSupplementAmounts?.count || 0)} 份已生效补充协议无法安全重建金额链，已保留原根合同当前金额，请逐份核查`,
    );
  }

  const unsafeContractAmounts = await db.get<{
    contracts: number;
    invoices: number;
    receipts: number;
    payments: number;
    externalPayments: number;
  }>(`
    SELECT
      (SELECT COUNT(*)::int FROM contracts
       WHERE (amount_delta IS NOT NULL AND ABS(amount_delta) > 999999999999.99)
          OR (original_contract_amount IS NOT NULL AND
            original_contract_amount NOT BETWEEN 0 AND 999999999999.99)
          OR (recognized_original_amount IS NOT NULL AND
            recognized_original_amount NOT BETWEEN 0 AND 999999999999.99)
          OR (recognized_final_amount IS NOT NULL AND
            recognized_final_amount NOT BETWEEN 0 AND 999999999999.99)
          OR (amount_before_change IS NOT NULL AND
            amount_before_change NOT BETWEEN 0 AND 999999999999.99)
          OR (amount_after_change IS NOT NULL AND
            amount_after_change NOT BETWEEN 0 AND 999999999999.99)
          OR (current_effective_amount IS NOT NULL AND
            current_effective_amount NOT BETWEEN 0 AND 999999999999.99)) AS contracts,
      (SELECT COUNT(*)::int FROM contract_invoices
       WHERE amount > 999999999999.99
          OR tax_amount > 999999999999.99) AS invoices,
      (SELECT COUNT(*)::int FROM contract_receipts
       WHERE amount > 999999999999.99) AS receipts,
      (SELECT COUNT(*)::int FROM contract_payments
       WHERE amount > 999999999999.99) AS payments,
      (SELECT COUNT(*)::int FROM contract_external_payments
       WHERE amount > 999999999999.99) AS "externalPayments"
  `);
  if (
    unsafeContractAmounts &&
    Object.values(unsafeContractAmounts).every((count) => Number(count) === 0)
  ) {
    await db.exec(`
      ALTER TABLE contracts
        VALIDATE CONSTRAINT contracts_amount_safe_range_check;
      ALTER TABLE contract_invoices
        VALIDATE CONSTRAINT contract_invoices_amount_safe_range_check;
      ALTER TABLE contract_receipts
        VALIDATE CONSTRAINT contract_receipts_amount_safe_range_check;
      ALTER TABLE contract_payments
        VALIDATE CONSTRAINT contract_payments_amount_safe_range_check;
      ALTER TABLE contract_external_payments
        VALIDATE CONSTRAINT contract_external_payments_amount_safe_range_check;
    `);
  } else {
    console.warn(
      "合同金额安全约束存在历史超范围记录，已继续约束新数据，请尽快核查:",
      unsafeContractAmounts,
    );
  }

  // 旧版迁移曾以 NOT VALID 方式加入这些合同约束。初始化完成后必须验证
  // 全量历史数据，避免数据库只约束新记录、却继续容忍旧的非法状态。
  await db.exec(`
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_beijing_area_check;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_declared_asset_category_check;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_declared_category_check;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_declared_subtype_check;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_previous_status_check;
    ALTER TABLE contracts
      VALIDATE CONSTRAINT contracts_status_check;
    ALTER TABLE contract_ocr_fields
      VALIDATE CONSTRAINT contract_ocr_fields_confidence_integer_check;
    ALTER TABLE contract_seal_verifications
      VALIDATE CONSTRAINT contract_seal_verifications_status_check;
    ALTER TABLE contract_seal_verification_fields
      VALIDATE CONSTRAINT contract_seal_verification_fields_confidence_integer_check;
  `);

  const now = new Date().toISOString();
  const effectiveFrom = "1970-01-01T00:00:00.000Z";
  const defaults: Array<[string, string, number]> = [
    ["contract_rate_tax_default", "tax", 0.1172],
    ["contract_rate_marketing_default", "marketing", 0.05],
    ["contract_rate_business_default", "business", 0.1],
    ["contract_rate_financial_default", "financial", 0.0028],
  ];
  for (const [id, rateCode, rateValue] of defaults) {
    await db.run(
      `INSERT INTO contract_rate_configs (
         id, rate_code, rate_value, effective_from, effective_to,
         is_active, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, TRUE, NULL, ?, ?)
       ON CONFLICT (rate_code, effective_from) DO NOTHING`,
      id,
      rateCode,
      rateValue,
      effectiveFrom,
      now,
      now,
    );
  }
  // 已确认回款首次升级时固化其业务日期对应费率；之后新增费率版本不会
  // 反向改写历史核算结果。没有匹配配置时仍由核算层使用产品默认值。
  await db.run(`
    UPDATE contract_receipts AS receipt
    SET rate_snapshot_json = (
      SELECT JSONB_OBJECT_AGG(latest.rate_code, latest.rate_value) AS rates
      FROM (
        SELECT DISTINCT ON (rate.rate_code)
          rate.rate_code, rate.rate_value
        FROM contract_rate_configs AS rate
        WHERE rate.is_active = TRUE
          AND LEFT(rate.effective_from, 10) <= receipt.receipt_date
          AND (
            rate.effective_to IS NULL
            OR LEFT(rate.effective_to, 10) > receipt.receipt_date
          )
        ORDER BY rate.rate_code, rate.effective_from DESC
      ) AS latest
    )
    WHERE receipt.status = 'confirmed'
      AND receipt.rate_snapshot_json IS NULL
  `);
}

/**
 * 初始化项目日志模块字典：首次运行时插入默认值，已存在则跳过
 */
async function seedWorklogDicts() {
  const now = new Date().toISOString();

  const districts = [
    "东城区",
    "西城区",
    "朝阳区",
    "海淀区",
    "丰台区",
    "石景山区",
    "门头沟区",
    "房山区",
    "通州区",
    "顺义区",
    "昌平区",
    "大兴区",
    "怀柔区",
    "平谷区",
    "密云区",
    "延庆区",
  ];
  const districtCount = await db.get<{ count: string }>(
    "SELECT COUNT(*) as count FROM worklog_districts",
  );
  if (Number(districtCount?.count || 0) === 0) {
    for (let i = 0; i < districts.length; i++) {
      await db.run(
        `INSERT INTO worklog_districts (id, name, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, TRUE, ?, ?)`,
        `district_${i + 1}`,
        districts[i],
        i + 1,
        now,
        now,
      );
    }
    console.log(`✅ 初始化日志字典：行政区 ${districts.length} 个`);
  }

  const projectTypes = ["新建项目", "公共公益项目"];
  const ptCount = await db.get<{ count: string }>(
    "SELECT COUNT(*) as count FROM worklog_project_types",
  );
  if (Number(ptCount?.count || 0) === 0) {
    for (let i = 0; i < projectTypes.length; i++) {
      await db.run(
        `INSERT INTO worklog_project_types (id, name, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, TRUE, ?, ?)`,
        `ptype_${i + 1}`,
        projectTypes[i],
        i + 1,
        now,
        now,
      );
    }
    console.log(`✅ 初始化日志字典：项目类型 ${projectTypes.length} 个`);
  }

  // 办理事项 + 标准办理天数（根据工程咨询行业经验值设置，管理员可后台调整）
  const matters: Array<[string, number]> = [
    ["征地批复", 60],
    ["征地结案", 30],
    ["多规合一初审意见", 30],
    ["多规合一协同意见函", 20],
    ["建设项目选址意见书和用地预审", 45],
    ["建设工程规划许可证", 30],
    ["建筑工程施工许可证", 20],
    ["临时用地批复", 30],
    ["临时建设工程规划许可证", 20],
    ["建设工程规划核验意见（变电站）", 30],
    ["建设工程规划核验备案意见（隧道）", 30],
    ["建设工程消防验收意见书", 30],
    ["建设工程竣工验收备案意见", 30],
    ["权籍调查", 45],
    ["楼门牌证明信", 10],
    ["划拨批复", 45],
    ["划拨决定书", 30],
    ["不动产权证书（土地）", 30],
    ["不动产权证书（房产）", 30],
  ];
  const matterCount = await db.get<{ count: string }>(
    "SELECT COUNT(*) as count FROM worklog_matters",
  );
  if (Number(matterCount?.count || 0) === 0) {
    for (let i = 0; i < matters.length; i++) {
      const [name, days] = matters[i];
      await db.run(
        `INSERT INTO worklog_matters (id, name, standard_days, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, TRUE, ?, ?)`,
        `matter_${i + 1}`,
        name,
        days,
        i + 1,
        now,
        now,
      );
    }
    console.log(`✅ 初始化日志字典：办理事项 ${matters.length} 项`);
  }

  const contractStatuses = [
    "未签合同",
    "已签合同未付款",
    "已付首款",
    "已付进度款",
    "已开票未收款",
    "已结清",
  ];
  const csCount = await db.get<{ count: string }>(
    "SELECT COUNT(*) as count FROM worklog_contract_statuses",
  );
  if (Number(csCount?.count || 0) === 0) {
    for (let i = 0; i < contractStatuses.length; i++) {
      await db.run(
        `INSERT INTO worklog_contract_statuses (id, name, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, TRUE, ?, ?)`,
        `cstatus_${i + 1}`,
        contractStatuses[i],
        i + 1,
        now,
        now,
      );
    }
    console.log(
      `✅ 初始化日志字典：合同付款状态 ${contractStatuses.length} 个`,
    );
  }
}

/**
 * 初始化周报下载白名单：根据姓名匹配「于贵臣」「刘行」。
 * 用户不存在时静默跳过，后续可通过后台接口手动添加
 */
async function seedWorklogPermissions() {
  const now = new Date().toISOString();
  const targetNames = ["于贵臣", "刘行"];
  const users = await db.all<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE name = ANY($1::text[])`,
    targetNames,
  );

  let added = 0;
  for (const u of users) {
    const exist = await db.get(
      `SELECT id FROM worklog_permissions WHERE permission_code = ? AND user_id = ?`,
      "download_weekly_report",
      u.id,
    );
    if (!exist) {
      await db.run(
        `INSERT INTO worklog_permissions (id, permission_code, user_id, created_at)
         VALUES (?, ?, ?, ?)`,
        `wp_${u.id}_weekly`,
        "download_weekly_report",
        u.id,
        now,
      );
      added++;
    }
  }
  if (added > 0) {
    console.log(`✅ 初始化周报下载白名单：新增 ${added} 人（于贵臣、刘行等）`);
  }
}
