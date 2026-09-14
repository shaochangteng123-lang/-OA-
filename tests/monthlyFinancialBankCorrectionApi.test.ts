jest.mock("@/utils/api", () => ({ api: {} }));

import { getMonthlyFinancialBankContentCorrectionReview } from "../src/utils/monthlyFinancialReportApi";

function reviewPayload() {
  return {
    reviewId: "mfbcr-review-1",
    expectedVersion: 19,
    batchDigest: "a".repeat(64),
    confirmationToken: "confirmation-token-".repeat(3),
    expiresAt: "2026-08-31T08:00:00.000Z",
    requiredFiles: [
      {
        originalName: "基本账户.pdf",
        fileHash: "b".repeat(64),
        accountCode: "basic",
      },
    ],
    conflicts: [
      {
        transactionId: "bank-transaction-1",
        receiptNo: "0918-9264-4631-1100",
        normalizedReceiptNo: "0918926446311100",
        differenceDigest: "c".repeat(64),
        accountCode: "basic",
        accountName: "基本账户",
        differences: ["amount"],
        correctable: true,
        blockingReason: null,
        previous: {
          fileName: "１.pdf",
          fileVersion: 1,
          transactionDate: "2026-08-12",
          amount: "19794.20",
          payerAccount: "0200…8271（19位）",
          payeeAccount: "0200…11（10位片段）",
        },
        incoming: {
          fileName: "基本账户.pdf",
          pageNo: 17,
          position: "bottom",
          transactionDate: "2026-08-12",
          amount: "19794.27",
          payerAccount: "0200…8271（19位）",
          payeeAccount: "未识别为完整账号",
        },
      },
    ],
  };
}

describe("月报银行历史识别差异响应解析", () => {
  it("仅接受精确状态、错误码和完整可纠正结构", () => {
    const payload = reviewPayload();
    expect(
      getMonthlyFinancialBankContentCorrectionReview({
        response: {
          status: 409,
          data: {
            code: "MONTHLY_BANK_RECEIPT_CONTENT_CONFLICT_CONFIRMATION_REQUIRED",
            data: payload,
          },
        },
      }),
    ).toEqual(payload);
    expect(
      getMonthlyFinancialBankContentCorrectionReview({
        response: {
          status: 400,
          data: {
            code: "MONTHLY_BANK_RECEIPT_CONTENT_CONFLICT_CONFIRMATION_REQUIRED",
            data: payload,
          },
        },
      }),
    ).toBeNull();
  });

  it("结构缺失、摘要非法或存在不可直接纠正项时不开放确认按钮", () => {
    const payload = reviewPayload();
    expect(
      getMonthlyFinancialBankContentCorrectionReview({
        response: {
          status: 409,
          data: {
            code: "MONTHLY_BANK_RECEIPT_CONTENT_CONFLICT_CONFIRMATION_REQUIRED",
            data: { ...payload, confirmationToken: "" },
          },
        },
      }),
    ).toBeNull();
    expect(
      getMonthlyFinancialBankContentCorrectionReview({
        response: {
          status: 409,
          data: {
            code: "MONTHLY_BANK_RECEIPT_CONTENT_CONFLICT_CONFIRMATION_REQUIRED",
            data: {
              ...payload,
              conflicts: [{ ...payload.conflicts[0], correctable: false }],
            },
          },
        },
      }),
    ).toBeNull();
  });
});
