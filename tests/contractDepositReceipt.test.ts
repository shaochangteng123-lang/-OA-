import fs from "fs";
import path from "path";

import {
  calculatePaymentInvoiceRequiredAmount,
  canConfirmContractDepositAmount,
  extractContractDepositAmount,
} from "../server/services/contractDepositReceipt";

describe("资产合同押金条闭环", () => {
  it("从押金标签后的阿拉伯数字识别金额", () => {
    expect(
      extractContractDepositAmount("租房押金金额：¥79,494.00元"),
    ).toMatchObject({ amount: 79_494 });
  });

  it("支持押金标签与中文大写金额分行", () => {
    expect(
      extractContractDepositAmount(
        "房屋租赁押金\n人民币柒万玖仟肆佰玖拾肆元整",
      ),
    ).toMatchObject({ amount: 79_494 });
  });

  it("明确为押金条时允许采用唯一金额", () => {
    expect(
      extractContractDepositAmount("押金条\n收款单位：国航\n金额：100000.00元"),
    ).toMatchObject({ amount: 100_000 });
  });

  it("多个不同押金候选时不自动猜测", () => {
    expect(
      extractContractDepositAmount("租房押金：50000元\n履约保证金：60000元"),
    ).toMatchObject({ amount: null });
  });

  it("不得使用付款与发票差额反推押金", () => {
    expect(
      extractContractDepositAmount("付款金额：100000元\n发票金额：79494元"),
    ).toMatchObject({ amount: null });
  });

  it("确认押金不得超过原始付款且应开票金额只扣除已确认押金", () => {
    expect(canConfirmContractDepositAmount(100_000, 20_000, 79_494)).toBe(true);
    expect(canConfirmContractDepositAmount(100_000, 20_000, 80_001)).toBe(
      false,
    );
    expect(calculatePaymentInvoiceRequiredAmount(158_988, 79_494)).toBe(79_494);
    expect(calculatePaymentInvoiceRequiredAmount(100_000, 120_000)).toBe(0);
  });

  it("数据库和API保留原始付款、押金证据与人工确认来源", () => {
    const databaseSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/db/index.ts"),
      "utf8",
    );
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );

    expect(databaseSource).toContain(
      "CREATE TABLE IF NOT EXISTS contract_payment_deposit_receipts",
    );
    expect(databaseSource).toContain(
      "payment_record_id TEXT REFERENCES contract_payments",
    );
    expect(databaseSource).toContain("external_payment_record_id TEXT");
    expect(databaseSource).toContain(
      "confirmation_source IN ('ocr', 'manual')",
    );
    expect(databaseSource).toContain(
      "status IN ('pending', 'confirmed', 'voided')",
    );
    expect(databaseSource).toContain("voided_by TEXT");
    expect(databaseSource).toContain("voided_at TEXT");
    expect(databaseSource).toContain("void_reason TEXT");
    expect(databaseSource).toContain(
      "voided_at IS NOT NULL AND void_reason IS NOT NULL",
    );
    expect(databaseSource).toContain(
      "char_length(trim(void_reason)) BETWEEN 1 AND 300",
    );
    expect(databaseSource).toContain(
      "'image/jpeg', 'image/png', 'application/pdf'",
    );
    expect(routeSource).toContain(
      '"/:id/financial-records/:recordId/deposit-receipts"',
    );
    expect(routeSource).toContain(
      '"/:id/financial-records/:recordId/deposit-receipts/:depositReceiptId/verify"',
    );
    expect(routeSource).toContain(
      '"/:id/financial-records/:recordId/deposit-receipts/:depositReceiptId/void"',
    );
    expect(routeSource).toContain("deposit_receipt_deleted");
    expect(routeSource).toContain("deposit_receipt_voided");
    expect(routeSource).toContain("DEPOSIT_RECEIPT_CONFIRMED_DELETE_FORBIDDEN");
    expect(routeSource).toContain("DEPOSIT_RECEIPT_VOID_REASON_REQUIRED");
    expect(routeSource).toContain("cleanupStoredFinancialFiles");
    expect(routeSource).toContain("voidedByName");
    expect(routeSource).toContain("voidReason");
    expect(routeSource).toContain("originalPaymentAmount: target.amount");
    expect(routeSource).toContain("confirmedDepositAmount");
    expect(routeSource).toContain("invoiceRequiredAmount");
    expect(routeSource).toContain("confirmationSource =");
    expect(routeSource).toContain("uploadedByName");
    expect(routeSource).toContain("confirmedByName");
    expect(routeSource).not.toContain(
      "UPDATE contract_external_payments\n           SET amount",
    );
  });
});
