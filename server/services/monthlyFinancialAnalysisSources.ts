import type { FinancialAnalysisQuery } from "../types/monthly-financial-analysis.js";
import {
  buildFinancialReimbursementScopeMap,
  unknownFinancialReimbursementScope,
  type FinancialReimbursementScopeNode,
} from "./monthlyFinancialReimbursementScope.js";
import {
  loadProjectReceiptFileMetadata,
  projectReceiptBusinessDate,
} from "./monthlyFinancialProjectReceiptPreview.js";
import { isValidFinancialDate } from "./monthlyFinancialReport.js";
import {
  financialReimbursementDatesComplete,
  financialReimbursementDateWarnings,
  type FinancialReimbursementDateDiagnostic,
} from "./monthlyFinancialReimbursementDateDiagnostics.js";
import {
  financialOverheadScopeEvidence,
  type FinancialOverheadScopeSource,
} from "./monthlyFinancialOverheadScope.js";
import type {
  AnalysisContract,
  AnalysisOverheadAllocation,
  AnalysisOverheadCandidate,
  AnalysisPayroll,
  AnalysisReceipt,
  AnalysisReimbursement,
  AnalysisUndatedReimbursement,
  AnalysisPersonnelIncurredReimbursement,
  FinancialAnalysisReport,
  MonthlyFinancialAnalysisInput,
  MonthlyFinancialAnalysisLoadOptions,
} from "./monthlyFinancialAnalysis.js";
import type { AnalysisRentAccrualContract } from "./monthlyFinancialRentAccrual.js";
import { loadMonthlyFinancialHousingCostInvoices } from "./monthlyFinancialHousingCostSources.js";

/**
 * 旧版第十一版解析结果未保存币种。以下三份原件已逐张目视核对为工商银行
 * 人民币电子回单，并以文件摘要锁定；除此之外的普通空币种旧记录不得按人民币
 * 推断。新任务由第十二版解析从正文提取明确币种，不再扩充此名单。
 */
export const LEGACY_REVIEWED_CNY_RECEIPT_FILE_HASHES = Object.freeze([
  "ae0c6e5862cc3b3b99953c7617bcf5c13bbd9bc143d8e354af3f39041363d9b3",
  "11f5f5edd62391d7b9544e385f0d7d6830fa9e649b821148dc388e95c0b3f32e",
  "fc4683ac497c68e6af972033a3ba22a56556109e4b8a9c0843b1ff1d4d8a0251",
]);

/**
 * 所有查询使用调用方开启的同一只读事务，不导入全局连接，也不初始化工资或同步月报。
 * 人员年度总成本需要完整自然年来源，返回页面仍由纯计算层限制到查询月份。
 */
export async function loadFinancialAnalysisSources(
  query: FinancialAnalysisQuery,
  options: MonthlyFinancialAnalysisLoadOptions,
): Promise<Omit<MonthlyFinancialAnalysisInput, "query" | "generatedAt">> {
  const client = options.queryClient;
  const yearFrom = `${query.from.slice(0, 4)}-01`;
  const yearTo = `${query.to.slice(0, 4)}-12`;
  const reportRows = await client.query<{ month: string }>(
    `SELECT report_month AS month
       FROM monthly_financial_reports
      WHERE report_month BETWEEN $1 AND $2 ORDER BY report_month`,
    [yearFrom, yearTo],
  );
  const reports: FinancialAnalysisReport[] = [];
  for (const row of reportRows.rows)
    reports.push(await options.loadReport(row.month, client));

  const contracts = await client.query<AnalysisContract>(
    `SELECT contract.id, COALESCE(contract.root_contract_id, contract.id) AS "rootId",
            contract.relation_type AS "relationType",
            COALESCE(contract.project_name, contract.title, contract.contract_no, contract.id) AS title,
            root.party_a AS "partyA", root.area AS region, root.business_contract_no AS "businessContractNo", contract.status,
            contract.effective_at AS "effectiveAt",
            contract.contract_date AS "contractDate", contract.contract_date_source AS "contractDateSource",
            contract.original_contract_amount::text AS "originalAmount",
            contract.amount_delta::text AS "amountDelta",
            contract.amount_before_change::text AS "amountBefore",
            contract.amount_after_change::text AS "amountAfter",
            contract.supplement_sequence AS "supplementSequence",
            contract.supplement_change_type AS "changeType", contract.updated_at AS "updatedAt"
       FROM contracts contract
       JOIN contracts root ON root.id = COALESCE(contract.root_contract_id, contract.id)
      WHERE COALESCE(root.category, root.declared_category) = 'main_business'
        AND root.is_deleted = FALSE AND contract.is_deleted = FALSE
        AND root.status NOT IN ('draft', 'rejected')
        AND contract.status NOT IN ('draft', 'rejected')
        AND (contract.effective_at IS NOT NULL OR contract.status IN ('effective', 'executing', 'completed', 'terminated'))
      ORDER BY root.id, contract.effective_at, contract.supplement_sequence, contract.id`,
  );
  const receipts = await client.query<AnalysisReceipt>(
    `SELECT receipt.id, root.id AS "rootId", COALESCE(receipt.receipt_date, '') AS date,
            receipt.amount::text AS amount, receipt.currency, receipt.status,
            receipt.bank_name AS "bankName", receipt.electronic_receipt_no AS "electronicReceiptNo",
            receipt.transaction_serial_no AS "transactionSerialNo",
            receipt.proof_no AS "proofNo",
            receipt.reversed_at AS "reversedAt", receipt.updated_at AS "updatedAt",
            EXISTS (SELECT 1 FROM contract_financial_ocr_jobs historical
              WHERE historical.id = receipt.financial_ocr_job_id
                AND historical.contract_id = receipt.contract_id
                AND historical.status = 'consumed' AND historical.validation_status = 'verified'
                AND historical.document_status = 'normal'
                AND historical.record_kind = 'receipt'
                AND historical.snapshot_json->>'source' = 'confirmed_historical_import'
                AND historical.snapshot_json->>'repairBatchKey' = 'historical-import-2026-08-26-system-boundary-repair-v1'
                AND historical.snapshot_json->>'recordKind' = 'receipt'
                AND historical.snapshot_json->>'recordId' = receipt.id
                AND historical.snapshot_json->>'businessDate' = receipt.receipt_date
                AND CASE WHEN historical.snapshot_json->>'amount' ~ '^[0-9]+([.][0-9]+)?$'
                  THEN (historical.snapshot_json->>'amount')::numeric = receipt.amount ELSE FALSE END
                AND receipt.confirmed_at IS NOT NULL
                AND NULLIF(BTRIM(receipt.currency), '') IS NULL
              UNION ALL
              SELECT 1 FROM contract_financial_ocr_jobs historical
              JOIN contract_files source_file
                ON source_file.id = historical.file_id
               AND source_file.id = receipt.file_id
               AND source_file.file_hash = historical.file_hash
              WHERE historical.id = receipt.financial_ocr_job_id
                AND historical.contract_id = receipt.contract_id
                AND historical.status = 'consumed' AND historical.validation_status = 'verified'
                AND historical.document_status = 'normal'
                AND historical.record_kind = 'receipt'
                AND historical.record_id = receipt.id
                AND historical.can_auto_post = TRUE
                AND historical.recognition_method = 'historical_confirmed_import'
                AND historical.engine_version = 'historical-source-review'
                AND historical.parser_version = 'historical-confirmed-v1'
                AND historical.snapshot_json->>'historicalConfirmed' = 'true'
                AND historical.snapshot_json->>'businessDate' = receipt.receipt_date
                AND historical.snapshot_json->>'sourceHash' ~ '^[0-9a-f]{64}$'
                AND historical.snapshot_json->>'sourceHash' = historical.file_hash
                AND CASE WHEN historical.snapshot_json->>'amount' ~ '^[0-9]+([.][0-9]+)?$'
                  THEN (historical.snapshot_json->>'amount')::numeric = receipt.amount ELSE FALSE END
                AND receipt.confirmed_at IS NOT NULL
                AND NULLIF(BTRIM(receipt.currency), '') IS NULL
                AND EXISTS (
                  SELECT 1
                    FROM contract_historical_import_files imported_file
                    JOIN contract_historical_import_batches imported_batch
                      ON imported_batch.batch_key = imported_file.batch_key
                   WHERE imported_file.contract_id = receipt.contract_id
                     AND imported_file.contract_file_id = receipt.file_id
                     AND imported_file.source_hash = historical.file_hash
                     AND imported_file.accounting_included = TRUE
                     AND imported_batch.status = 'completed'
                )
            ) AS "historicalConfirmedAmount",
            EXISTS (SELECT 1 FROM contract_financial_ocr_jobs legacy
              JOIN contract_files source_file
                ON source_file.id = legacy.file_id
               AND source_file.id = receipt.file_id
               AND source_file.file_hash = legacy.file_hash
              WHERE legacy.id = receipt.financial_ocr_job_id
                AND legacy.contract_id = receipt.contract_id
                AND legacy.status = 'consumed' AND legacy.validation_status = 'verified'
                AND legacy.document_status = 'normal'
                AND legacy.record_kind = 'receipt'
                AND legacy.document_kind = 'bank_receipt'
                AND legacy.direction = 'receipt'
                AND legacy.record_id = receipt.id
                AND legacy.can_auto_post = TRUE
                AND legacy.recognition_method IN (
                  'paddle_ocr', 'paddle_and_tesseract',
                  'pdf_structured_and_paddle', 'pdf_structured_fast'
                )
                AND legacy.engine_version = 'v6_medium'
                AND legacy.parser_version = 'contract-bank-receipt-parser-v11'
                AND source_file.file_hash = ANY($2::text[])
                AND legacy.snapshot_json->>'format' IN ('pdf', 'jpeg', 'png')
                AND legacy.snapshot_json #>> '{fields,paymentTime}' = receipt.payment_time
                AND LEFT(legacy.snapshot_json #>> '{fields,paymentTime}', 10) = receipt.receipt_date
                AND legacy.snapshot_json #>> '{fields,payer}' = receipt.payer
                AND legacy.snapshot_json #>> '{fields,payerAccount}' = receipt.payer_account
                AND legacy.snapshot_json #>> '{fields,payee}' = receipt.payee
                AND legacy.snapshot_json #>> '{fields,payeeAccount}' = receipt.payee_account
                AND legacy.snapshot_json #>> '{fields,electronicReceiptNo}' = receipt.electronic_receipt_no
                AND CASE WHEN legacy.snapshot_json #>> '{fields,amount}' ~ '^[0-9]+([.][0-9]+)?$'
                  THEN (legacy.snapshot_json #>> '{fields,amount}')::numeric = receipt.amount ELSE FALSE END
                AND receipt.confirmed_at IS NOT NULL
                AND receipt.rate_snapshot_json IS NOT NULL
                AND NULLIF(BTRIM(receipt.currency), '') IS NULL
            ) AS "verifiedLegacyCnyAmount"
       FROM contract_receipts receipt
       JOIN contracts contract ON contract.id = receipt.contract_id
       JOIN contracts root ON root.id = COALESCE(contract.root_contract_id, contract.id)
      WHERE receipt.status IN ('confirmed', 'reversed')
        AND (receipt.receipt_date <= $1
          OR NOT COALESCE(monthly_financial_date_is_valid(receipt.receipt_date), FALSE))
        AND COALESCE(root.category, root.declared_category) = 'main_business'
        AND root.is_deleted = FALSE AND contract.is_deleted = FALSE
        AND root.status NOT IN ('draft', 'rejected')
        AND contract.status <> 'rejected'
      ORDER BY receipt.receipt_date, receipt.id`,
    [`${yearTo}-31`, LEGACY_REVIEWED_CNY_RECEIPT_FILE_HASHES],
  );
  const rootById = new Map(
    contracts.rows
      .filter((row) => row.relationType === "main")
      .map((row) => [row.id, row]),
  );
  const asOfDate = projectReceiptBusinessDate(options.now || new Date());
  // 累计指标仍保留完整历史；只有当前查询能展示且显式标记为人民币的回款才读取文件关系。
  // 旧空币种记录虽可经严格闭环证据参与统计，但预览接口仍要求币种字段完整，不能生成失效链接。
  const previewIds = receipts.rows
    .filter((row) => {
      const root = rootById.get(row.rootId);
      return (
        row.status === "confirmed" &&
        row.currency?.trim().toUpperCase() === "CNY" &&
        isValidFinancialDate(row.date) &&
        row.date >= `${query.from}-01` &&
        row.date <= `${query.to}-31` &&
        row.date <= asOfDate &&
        Boolean(root) &&
        (!query.partyA || root?.partyA === query.partyA) &&
        (!query.contractRegion || root?.region === query.contractRegion)
      );
    })
    .map((row) => row.id);
  const receiptFiles = await loadProjectReceiptFileMetadata(client, previewIds);
  const reimbursements = await client.query<AnalysisReimbursement>(
    `SELECT reimbursement.id, reimbursement.user_id AS "userId",
            employee.id AS "employeeId", reimbursement.applicant_name AS "personName",
            reimbursement.type, reimbursement.payment_business_date::text AS date,
            reimbursement.total_amount::text AS amount, reimbursement.title,
            reimbursement.category, reimbursement.reimbursement_scope AS scope,
            reimbursement.service_target AS "serviceTarget", reimbursement.updated_at AS "updatedAt"
       FROM reimbursements reimbursement
       LEFT JOIN employee_profiles employee ON employee.user_id = reimbursement.user_id
      WHERE reimbursement.status IN ('paid', 'payment_uploaded', 'completed')
        AND reimbursement.is_deleted = FALSE
        AND reimbursement.payment_business_date >= $1::date
        AND reimbursement.payment_business_date < ($2::date + INTERVAL '1 month')
      ORDER BY reimbursement.payment_business_date, reimbursement.id`,
    [`${yearFrom}-01`, `${yearTo}-01`],
  );
  const payroll = await client.query<AnalysisPayroll>(
    `SELECT payroll.id, employee.id AS "employeeId", employee.user_id AS "userId",
            employee.name AS "personName", payroll.payroll_month AS month,
            payroll.monthly_salary::text AS salary,
            payroll.housing_fund_base::text AS "housingBase",
            payroll.contribution_base::text AS "contributionBase",
            payroll.individual_income_tax::text AS tax,
            payroll.withheld_actual_amount::text AS "withheldActual",
            payroll.net_salary_actual_amount::text AS "netActual",
            payroll.updated_at AS "updatedAt"
       FROM payroll_records payroll
       JOIN employee_profiles employee ON employee.id = payroll.employee_id
       LEFT JOIN users user_account ON user_account.id = employee.user_id
      WHERE payroll.payroll_month BETWEEN $1 AND $2
        AND COALESCE(user_account.role, 'user') NOT IN ('super_admin', 'chairman', 'boss')
      ORDER BY payroll.payroll_month, employee.id, payroll.id`,
    [yearFrom, yearTo],
  );
  const rentAccrualContracts = await client.query<AnalysisRentAccrualContract>(
    `SELECT rental.id, COALESCE(rental.title, rental.id) AS title, rental.status,
            rental.effective_at::text AS "effectiveAt", rental.lease_start_date AS "leaseStartDate",
            rental.lease_end_date AS "leaseEndDate", rental.lease_monthly_rent::text AS "monthlyRent",
            rental.lease_monthly_property_fee::text AS "monthlyPropertyFee",
            rental.renewed_from_contract_id AS "previousContractId", NULL::text AS "actualEndDate",
            rental.updated_at::text AS "updatedAt", rental.version::text AS version,
            EXISTS (
              SELECT 1 FROM contracts rental_change
               WHERE COALESCE(rental_change.root_contract_id, rental_change.parent_contract_id) = rental.id
                 AND rental_change.id <> rental.id AND rental_change.is_deleted = FALSE
                 AND rental_change.relation_type = 'supplement'
                 AND rental_change.status IN ('effective', 'executing', 'completed', 'terminated')
                 AND (NOT COALESCE(monthly_financial_date_is_valid(LEFT(rental_change.effective_at, 10)), FALSE)
                   OR LEFT(rental_change.effective_at, 10) <= $1)
                 AND (COALESCE(rental_change.supplement_change_type, 'legacy_unresolved') <> 'payment_terms_only'
                   OR rental_change.lease_operation_type = 'renewal'
                   OR (rental_change.lease_monthly_rent IS NOT NULL AND rental_change.lease_monthly_rent IS DISTINCT FROM rental.lease_monthly_rent)
                   OR (rental_change.lease_monthly_property_fee IS NOT NULL AND rental_change.lease_monthly_property_fee IS DISTINCT FROM rental.lease_monthly_property_fee)
                   OR (rental_change.lease_start_date IS NOT NULL AND rental_change.lease_start_date IS DISTINCT FROM rental.lease_start_date)
                   OR (rental_change.lease_end_date IS NOT NULL AND rental_change.lease_end_date IS DISTINCT FROM rental.lease_end_date))
            ) AS "hasUnresolvedChange"
       FROM contracts rental
      WHERE rental.is_deleted = FALSE AND rental.relation_type = 'main'
        AND COALESCE(rental.category, rental.declared_category) = 'asset'
        AND COALESCE(rental.asset_category, rental.declared_subtype) = 'house_rental'
        AND rental.financial_direction = 'cost'
        AND rental.status IN ('effective', 'executing', 'completed', 'terminated')
      ORDER BY rental.id`,
    [asOfDate],
  );
  const generalPayments = await client.query<
    NonNullable<MonthlyFinancialAnalysisInput["generalPayments"]>[number]
  >(
    `SELECT payment.id, COALESCE(payment.payment_date, '') AS date, payment.amount::text AS amount,
       COALESCE(root.title, contract.title, payment.id) AS title, payment.currency, payment.updated_at AS "updatedAt"
     FROM contract_payments payment
     JOIN contracts contract ON contract.id = payment.contract_id
     JOIN contracts root ON root.id = COALESCE(contract.root_contract_id, contract.id)
     WHERE payment.status = 'confirmed' AND root.is_deleted = FALSE AND contract.is_deleted = FALSE
       AND root.status NOT IN ('draft', 'rejected') AND contract.status <> 'rejected'
       AND COALESCE(root.category, root.declared_category) = 'asset'
       AND (LEFT(payment.payment_date, 7) BETWEEN $1 AND $2
         OR NOT COALESCE(monthly_financial_date_is_valid(payment.payment_date), FALSE))
     ORDER BY payment.payment_date, payment.id`,
    [yearFrom, yearTo],
  );
  const overhead = await client.query<AnalysisOverheadAllocation>(
    `SELECT financial_match.id, payment.id AS "paymentId",
            settlement_item.item_kind AS "paymentKind", COALESCE(payment.payment_date, '') AS date, payment.currency,
            payment.amount::text AS "paymentAmount", financial_match.allocated_amount::text AS amount,
            invoice.id AS "invoiceId", invoice.amount::text AS "invoiceAmount",
            COALESCE(root.title, root.id) AS title,
            GREATEST(payment.updated_at, invoice.updated_at, financial_match.created_at,
                     invoice_lines.updated_at) AS "updatedAt", invoice_lines.lines
       FROM contract_financial_registration_matches financial_match
       JOIN contract_financial_registration_items invoice_item
         ON invoice_item.id = financial_match.invoice_item_id AND invoice_item.item_kind = 'invoice'
       JOIN contract_invoices invoice ON invoice.id = invoice_item.record_id AND invoice.status = 'confirmed'
       JOIN contracts invoice_contract ON invoice_contract.id = invoice.contract_id
       JOIN contract_financial_registration_items settlement_item
         ON settlement_item.id = financial_match.settlement_item_id
        AND settlement_item.item_kind IN ('payment', 'external_payment')
       JOIN LATERAL (
         SELECT id, contract_id, payment_date, amount, status, currency, updated_at
           FROM contract_payments WHERE settlement_item.item_kind = 'payment' AND id = settlement_item.record_id
         UNION ALL
         SELECT id, contract_id, payment_date, amount, status, NULL::text AS currency, updated_at
           FROM contract_external_payments WHERE settlement_item.item_kind = 'external_payment' AND id = settlement_item.record_id
       ) payment ON payment.status = 'confirmed'
       JOIN contracts payment_contract ON payment_contract.id = payment.contract_id
       JOIN contracts root ON root.id = COALESCE(payment_contract.root_contract_id, payment_contract.id)
       JOIN LATERAL (
         SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
                  'id', line.id, 'category', line.expense_category, 'amount', line.gross_amount::text,
                  'verified', line.recognition_status = 'verified') ORDER BY line.id) AS lines,
                MAX(line.updated_at) AS updated_at
           FROM contract_invoice_line_items line WHERE line.invoice_id = invoice.id
       ) invoice_lines ON invoice_lines.lines IS NOT NULL
      WHERE COALESCE(root.category, root.declared_category) = 'asset'
        AND root.is_deleted = FALSE AND payment_contract.is_deleted = FALSE AND invoice_contract.is_deleted = FALSE
        AND root.status NOT IN ('draft', 'rejected')
        AND payment_contract.status <> 'rejected' AND invoice_contract.status <> 'rejected'
        AND COALESCE(invoice_contract.root_contract_id, invoice_contract.id) = root.id
        AND ((root.asset_funding_mode = 'engineering_to_technology' AND settlement_item.item_kind = 'external_payment')
          OR (COALESCE(root.asset_funding_mode, '') <> 'engineering_to_technology' AND settlement_item.item_kind = 'payment'))
        AND (LEFT(payment.payment_date, 7) <= $1
          OR NOT COALESCE(monthly_financial_date_is_valid(payment.payment_date), FALSE))
      ORDER BY payment.payment_date, financial_match.id`,
    [yearTo],
  );
  const overheadCandidates = await client.query<FinancialOverheadScopeSource>(
    `SELECT payment.id, payment.kind, COALESCE(payment.payment_date, '') AS date,
            payment.amount::text AS amount, COALESCE(root.title, root.id) AS title,
            payment.expense_category AS "expenseCategory",
            (SELECT COUNT(scope_match.id)::text
               FROM contract_financial_registration_matches scope_match
               JOIN contract_financial_registration_items scope_item
                 ON scope_item.id = scope_match.settlement_item_id
              WHERE scope_item.item_kind = payment.kind
                AND scope_item.record_id = payment.id) AS "rawMatchCount"
       FROM (
         SELECT id, contract_id, payment_date, amount, status, expense_category, 'payment'::text AS kind FROM contract_payments
         UNION ALL
         SELECT id, contract_id, payment_date, amount, status, expense_category, 'external_payment'::text AS kind FROM contract_external_payments
       ) payment
       JOIN contracts contract ON contract.id = payment.contract_id
       JOIN contracts root ON root.id = COALESCE(contract.root_contract_id, contract.id)
      WHERE payment.status = 'confirmed' AND root.is_deleted = FALSE AND contract.is_deleted = FALSE
        AND root.status NOT IN ('draft', 'rejected') AND contract.status <> 'rejected'
        AND COALESCE(root.category, root.declared_category) = 'asset'
        AND ((root.asset_funding_mode = 'engineering_to_technology' AND payment.kind = 'external_payment')
          OR (COALESCE(root.asset_funding_mode, '') <> 'engineering_to_technology' AND payment.kind = 'payment'))
        AND (LEFT(payment.payment_date, 7) BETWEEN $1 AND $2
          OR NOT COALESCE(monthly_financial_date_is_valid(payment.payment_date), FALSE))
      ORDER BY payment.payment_date, payment.id`,
    [yearFrom, yearTo],
  );
  const scopeRows = await client.query<FinancialReimbursementScopeNode>(
    `SELECT id, parent_id AS "parentId", name, value
       FROM reimbursement_scopes ORDER BY sort_order, id`,
  );
  const scopes = buildFinancialReimbursementScopeMap(scopeRows.rows);
  const reimbursementSources = reimbursements.rows.map((row) => {
    const scope =
      scopes.get(row.scope || "") ||
      unknownFinancialReimbursementScope(row.scope);
    return {
      ...row,
      scopePath: scope.path,
      region: scope.region,
      regionSource: `当前台账范围归属；${scope.source}`,
    };
  });
  const incompleteRows =
    await client.query<FinancialReimbursementDateDiagnostic>(
      `SELECT type, COUNT(*)::text AS count, SUM(total_amount)::text AS amount
       FROM reimbursements
      WHERE status IN ('paid', 'payment_uploaded', 'completed') AND is_deleted = FALSE
        AND type IN ('basic', 'large', 'business')
        AND (payment_business_date IS NULL
          OR NOT COALESCE(monthly_financial_date_is_valid(payment_business_date::text), FALSE))
      GROUP BY type ORDER BY type`,
    );
  const undatedReimbursements =
    await client.query<AnalysisUndatedReimbursement>(
      `SELECT undated_reimbursement.id, undated_reimbursement.type,
            undated_reimbursement.total_amount::text AS amount,
            undated_reimbursement.payment_business_date::text AS date,
            undated_reimbursement.status, undated_reimbursement.user_id AS "userId",
            employee.id AS "employeeId", undated_reimbursement.applicant_name AS "personName"
       FROM reimbursements undated_reimbursement
       LEFT JOIN employee_profiles employee ON employee.user_id = undated_reimbursement.user_id
      WHERE undated_reimbursement.status IN ('paid', 'payment_uploaded', 'completed')
        AND undated_reimbursement.is_deleted = FALSE
        AND undated_reimbursement.type IN ('basic', 'large', 'business')
        AND (undated_reimbursement.payment_business_date IS NULL
          OR NOT COALESCE(monthly_financial_date_is_valid(undated_reimbursement.payment_business_date::text), FALSE))
      ORDER BY undated_reimbursement.type, undated_reimbursement.id`,
    );
  const personnelIncurredReimbursements =
    await client.query<AnalysisPersonnelIncurredReimbursement>(
      `SELECT personnel_reimbursement.id, personnel_reimbursement.type,
            personnel_reimbursement.reimbursement_month AS month,
            personnel_reimbursement.total_amount::text AS amount, personnel_reimbursement.status,
            personnel_reimbursement.user_id AS "userId", employee.id AS "employeeId",
            personnel_reimbursement.applicant_name AS "personName", personnel_reimbursement.updated_at AS "updatedAt",
            personnel_reimbursement.title, personnel_reimbursement.category,
            personnel_reimbursement.reimbursement_scope AS scope,
            personnel_reimbursement.service_target AS "serviceTarget"
       FROM reimbursements personnel_reimbursement
       LEFT JOIN employee_profiles employee ON employee.user_id = personnel_reimbursement.user_id
      WHERE personnel_reimbursement.status IN ('approved', 'paid', 'payment_uploaded', 'completed')
        AND personnel_reimbursement.is_deleted = FALSE
        AND personnel_reimbursement.type IN ('basic', 'large', 'business')
      ORDER BY personnel_reimbursement.type, personnel_reimbursement.id`,
    );
  const incurredReimbursementSources = personnelIncurredReimbursements.rows.map(
    (row) => {
      const scope =
        scopes.get(row.scope || "") ||
        unknownFinancialReimbursementScope(row.scope);
      return {
        ...row,
        scopePath: scope.path,
        region: scope.region,
        regionSource: `已确认报销月份来源的当前台账范围归属；${scope.source}`,
      };
    },
  );
  const warnings: string[] = [];
  const housingCostInvoices = await loadMonthlyFinancialHousingCostInvoices(
    client,
    asOfDate,
    "invoice-lease",
  );
  if (
    [...reimbursementSources, ...incurredReimbursementSources].some(
      (row) => row.type === "business" && !row.region,
    )
  ) {
    warnings.push(
      "部分商务报销范围无法唯一核对完整父级区域，已按行政区未知单列，不按叶名称合并区域或重复计算金额。",
    );
  }
  warnings.push(...financialReimbursementDateWarnings(incompleteRows.rows));
  return {
    reports,
    contracts: contracts.rows,
    receipts: receipts.rows.map((row) => ({
      ...row,
      fileMetadata: receiptFiles.get(row.id),
    })),
    reimbursements: reimbursementSources,
    undatedReimbursements: undatedReimbursements.rows,
    personnelIncurredReimbursements: incurredReimbursementSources,
    reimbursementDatesComplete: financialReimbursementDatesComplete(
      incompleteRows.rows,
    ),
    payroll: payroll.rows,
    rentAccrualContracts: rentAccrualContracts.rows,
    rentCurrentMonthMode: "daily",
    housingCostInvoices,
    housingCostBasis: "invoice-lease",
    generalPayments: generalPayments.rows,
    // 保留完整发票及跨次分配容量；租金范围在证据层判定，不能先过滤非租金明细放大租金份额。
    overheadAllocations: overhead.rows,
    overheadCandidates: overheadCandidates.rows.map(
      (row): AnalysisOverheadCandidate => ({
        id: row.id,
        kind: row.kind,
        date: row.date,
        amount: row.amount,
        title: row.title,
        ...financialOverheadScopeEvidence(row, overhead.rows),
      }),
    ),
    scopeNames: Object.fromEntries(
      [...scopes].map(([value, row]) => [value, row.path || value]),
    ),
    warnings,
  };
}
