/**
 * 合同履约结算金额的统一 SQL 口径。
 *
 * 房屋租赁的付款凭证可能同时包含保证金、电费等合同外费用，不能直接把
 * 银行付款总额当作租赁合同履约额。房租合同仅累计已经与发票建立匹配关系，
 * 且发票明细明确标记为计入合同核算的实际分配金额。只要资产合同已有发票
 * 明细，所有资产二级分类都采用该口径；没有明细的非房租资产兼容原有已确认
 * 付款全额，房租合同没有明细时保持为 0，不能把未拆分付款误算为房租履约。
 * 工程咨询向实际签约公司的内部划拨在没有发票明细时继续使用已确认外部付款
 * 全额；已有明细时也必须先排除保证金、电费等合同外费用。
 */

export interface ContractCostSettlementSqlOptions {
  /** 根合同记录别名，必须包含 asset_funding_mode 与 declared_subtype。 */
  rootAlias: string;
  /** 根合同 ID SQL 表达式。 */
  rootIdExpression: string;
  /** 可选期间条件；使用内部固定别名 `settlement_payment`。 */
  paymentDatePredicate?: string;
}

/** 与数据库 ROUND(..., 2) 一致地按正数比例分配整数分，避免大金额乘法溢出。 */
export function prorateContractSettlementCents(
  allocatedCents: number,
  accountingGrossCents: number,
  invoiceGrossCents: number,
): number {
  if (
    !Number.isSafeInteger(allocatedCents) ||
    !Number.isSafeInteger(accountingGrossCents) ||
    !Number.isSafeInteger(invoiceGrossCents) ||
    allocatedCents < 0 ||
    accountingGrossCents < 0 ||
    invoiceGrossCents <= 0 ||
    accountingGrossCents > invoiceGrossCents
  ) {
    throw new RangeError("合同履约分配金额必须是安全范围内的非负整数分");
  }
  const denominator = BigInt(invoiceGrossCents);
  const rounded =
    (BigInt(allocatedCents) * BigInt(accountingGrossCents) + denominator / 2n) /
    denominator;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("合同履约分配结果超过安全金额范围");
  }
  return result;
}

function confirmedPaymentTotalSql(
  rootIdExpression: string,
  table: "contract_payments" | "contract_external_payments",
  paymentDatePredicate: string,
): string {
  return `COALESCE((
    SELECT SUM(settlement_payment.amount)
    FROM ${table} settlement_payment
    JOIN contracts settlement_contract
      ON settlement_contract.id = settlement_payment.contract_id
    WHERE COALESCE(
        settlement_contract.root_contract_id,
        settlement_contract.id
      ) = ${rootIdExpression}
      AND settlement_contract.is_deleted = FALSE
      AND settlement_contract.status <> 'rejected'
      AND settlement_payment.status = 'confirmed'
      AND (${paymentDatePredicate})
  ), 0)`;
}

function matchedInvoiceAccountingTotalSql(
  rootAlias: string,
  rootIdExpression: string,
  paymentDatePredicate: string,
): string {
  return `COALESCE((
    SELECT SUM(
      ROUND(
        invoice_match.matched_amount
          * invoice_lines.accounting_gross_amount
          / NULLIF(invoice_lines.invoice_gross_amount, 0),
        2
      )
    )
    FROM (
      SELECT matched_invoice.id AS invoice_id,
        LEAST(
          matched_invoice.amount,
          SUM(financial_match.allocated_amount)
        ) AS matched_amount
      FROM public.contract_financial_registration_matches financial_match
      JOIN public.contract_financial_registration_items invoice_item
        ON invoice_item.id = financial_match.invoice_item_id
       AND invoice_item.item_kind = 'invoice'
      JOIN contract_invoices matched_invoice
        ON matched_invoice.id = invoice_item.record_id
       AND matched_invoice.status = 'confirmed'
      JOIN contracts invoice_contract
        ON invoice_contract.id = matched_invoice.contract_id
      JOIN public.contract_financial_registration_items settlement_item
        ON settlement_item.id = financial_match.settlement_item_id
       AND settlement_item.item_kind IN ('payment', 'external_payment')
      JOIN LATERAL (
        SELECT payment.id, payment.contract_id, payment.payment_date,
          payment.status
        FROM contract_payments payment
        WHERE settlement_item.item_kind = 'payment'
          AND payment.id = settlement_item.record_id
        UNION ALL
        SELECT external_payment.id, external_payment.contract_id,
          external_payment.payment_date, external_payment.status
        FROM contract_external_payments external_payment
        WHERE settlement_item.item_kind = 'external_payment'
          AND external_payment.id = settlement_item.record_id
      ) settlement_payment ON settlement_payment.status = 'confirmed'
      JOIN contracts settlement_contract
        ON settlement_contract.id = settlement_payment.contract_id
      WHERE COALESCE(
          settlement_contract.root_contract_id,
          settlement_contract.id
        ) = ${rootIdExpression}
        AND COALESCE(
          invoice_contract.root_contract_id,
          invoice_contract.id
        ) = ${rootIdExpression}
        AND invoice_contract.is_deleted = FALSE
        AND invoice_contract.status <> 'rejected'
        AND settlement_contract.is_deleted = FALSE
        AND settlement_contract.status <> 'rejected'
        AND (
          (${rootAlias}.asset_funding_mode = 'engineering_to_technology'
            AND settlement_item.item_kind = 'external_payment')
          OR
          (${rootAlias}.asset_funding_mode <> 'engineering_to_technology'
            AND settlement_item.item_kind = 'payment')
        )
        AND (${paymentDatePredicate})
      GROUP BY matched_invoice.id, matched_invoice.amount
    ) invoice_match
    JOIN LATERAL (
      SELECT SUM(line.gross_amount) AS invoice_gross_amount,
        COALESCE(SUM(line.gross_amount) FILTER (
          WHERE line.include_in_contract_accounting = TRUE
            AND line.recognition_status = 'verified'
        ), 0) AS accounting_gross_amount
      FROM contract_invoice_line_items line
      WHERE line.invoice_id = invoice_match.invoice_id
    ) invoice_lines
      ON invoice_lines.invoice_gross_amount > 0
  ), 0)`;
}

function contractInvoiceLineItemsExistSql(rootIdExpression: string): string {
  return `EXISTS (
    SELECT 1
    FROM contract_invoice_line_items accounting_line
    JOIN contract_invoices accounting_invoice
      ON accounting_invoice.id = accounting_line.invoice_id
    JOIN contracts accounting_invoice_contract
      ON accounting_invoice_contract.id = accounting_invoice.contract_id
    WHERE COALESCE(
        accounting_invoice_contract.root_contract_id,
        accounting_invoice_contract.id
      ) = ${rootIdExpression}
      AND accounting_invoice_contract.is_deleted = FALSE
      AND accounting_invoice_contract.status <> 'rejected'
      AND accounting_invoice.status <> 'reversed'
      AND accounting_line.recognition_status = 'verified'
  )`;
}

/**
 * 返回资产合同的履约结算金额表达式。该表达式刻意不等同于现金支出总额；
 * 现金流、费用分类等报表仍应使用原始付款金额。
 */
export function contractCostSettlementAmountSql(
  options: ContractCostSettlementSqlOptions,
): string {
  const paymentDatePredicate = options.paymentDatePredicate || "TRUE";
  const standardPayment = confirmedPaymentTotalSql(
    options.rootIdExpression,
    "contract_payments",
    paymentDatePredicate,
  );
  const externalPayment = confirmedPaymentTotalSql(
    options.rootIdExpression,
    "contract_external_payments",
    paymentDatePredicate,
  );
  const matchedInvoiceAccountingPayment = matchedInvoiceAccountingTotalSql(
    options.rootAlias,
    options.rootIdExpression,
    paymentDatePredicate,
  );
  const hasInvoiceLineItems = contractInvoiceLineItemsExistSql(
    options.rootIdExpression,
  );

  return `(CASE
    WHEN ${hasInvoiceLineItems}
      THEN ${matchedInvoiceAccountingPayment}
    WHEN ${options.rootAlias}.asset_funding_mode = 'engineering_to_technology'
      THEN ${externalPayment}
    WHEN ${options.rootAlias}.declared_subtype = 'house_rental'
      THEN 0
    ELSE ${standardPayment}
  END)`;
}

function confirmedPaymentLastDateSql(
  rootIdExpression: string,
  table: "contract_payments" | "contract_external_payments",
): string {
  return `(
    SELECT MAX(settlement_payment.payment_date)
    FROM ${table} settlement_payment
    JOIN contracts settlement_contract
      ON settlement_contract.id = settlement_payment.contract_id
    WHERE COALESCE(
        settlement_contract.root_contract_id,
        settlement_contract.id
      ) = ${rootIdExpression}
      AND settlement_contract.is_deleted = FALSE
      AND settlement_contract.status <> 'rejected'
      AND settlement_payment.status = 'confirmed'
  )`;
}

function matchedInvoiceAccountingLastDateSql(
  rootAlias: string,
  rootIdExpression: string,
): string {
  return `(
    SELECT MAX(settlement_payment.payment_date)
    FROM public.contract_financial_registration_matches financial_match
    JOIN public.contract_financial_registration_items invoice_item
      ON invoice_item.id = financial_match.invoice_item_id
     AND invoice_item.item_kind = 'invoice'
    JOIN contract_invoices matched_invoice
      ON matched_invoice.id = invoice_item.record_id
     AND matched_invoice.status = 'confirmed'
    JOIN contracts invoice_contract
      ON invoice_contract.id = matched_invoice.contract_id
    JOIN public.contract_financial_registration_items settlement_item
      ON settlement_item.id = financial_match.settlement_item_id
     AND settlement_item.item_kind IN ('payment', 'external_payment')
    JOIN LATERAL (
      SELECT payment.id, payment.contract_id, payment.payment_date,
        payment.status
      FROM contract_payments payment
      WHERE settlement_item.item_kind = 'payment'
        AND payment.id = settlement_item.record_id
      UNION ALL
      SELECT external_payment.id, external_payment.contract_id,
        external_payment.payment_date, external_payment.status
      FROM contract_external_payments external_payment
      WHERE settlement_item.item_kind = 'external_payment'
        AND external_payment.id = settlement_item.record_id
    ) settlement_payment ON settlement_payment.status = 'confirmed'
    JOIN contracts settlement_contract
      ON settlement_contract.id = settlement_payment.contract_id
    WHERE COALESCE(
        settlement_contract.root_contract_id,
        settlement_contract.id
      ) = ${rootIdExpression}
      AND COALESCE(
        invoice_contract.root_contract_id,
        invoice_contract.id
      ) = ${rootIdExpression}
      AND invoice_contract.is_deleted = FALSE
      AND invoice_contract.status <> 'rejected'
      AND settlement_contract.is_deleted = FALSE
      AND settlement_contract.status <> 'rejected'
      AND (
        (${rootAlias}.asset_funding_mode = 'engineering_to_technology'
          AND settlement_item.item_kind = 'external_payment')
        OR
        (${rootAlias}.asset_funding_mode <> 'engineering_to_technology'
          AND settlement_item.item_kind = 'payment')
      )
      AND EXISTS (
        SELECT 1
        FROM contract_invoice_line_items accounting_line
        WHERE accounting_line.invoice_id = matched_invoice.id
          AND accounting_line.include_in_contract_accounting = TRUE
          AND accounting_line.recognition_status = 'verified'
      )
  )`;
}

/** 与履约金额使用同一边界的最后结算日期。 */
export function contractCostSettlementLastDateSql(options: {
  rootAlias: string;
  rootIdExpression: string;
}): string {
  const hasInvoiceLineItems = contractInvoiceLineItemsExistSql(
    options.rootIdExpression,
  );
  return `(CASE
    WHEN ${hasInvoiceLineItems}
      THEN ${matchedInvoiceAccountingLastDateSql(
        options.rootAlias,
        options.rootIdExpression,
      )}
    WHEN ${options.rootAlias}.asset_funding_mode = 'engineering_to_technology'
      THEN ${confirmedPaymentLastDateSql(
        options.rootIdExpression,
        "contract_external_payments",
      )}
    WHEN ${options.rootAlias}.declared_subtype = 'house_rental'
      THEN NULL
    ELSE ${confirmedPaymentLastDateSql(
      options.rootIdExpression,
      "contract_payments",
    )}
  END)`;
}
