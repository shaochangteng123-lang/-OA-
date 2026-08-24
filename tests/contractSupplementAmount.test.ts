/** @jest-environment node */

import {
  SupplementAmountCalculationError,
  calculateSupplementAmountSnapshot,
  calculateSupplementChain,
} from "../server/services/contractSupplementAmount";

describe("补充协议金额链计算", () => {
  it("正文明确调整后总额高于识别到的本次增减额", () => {
    expect(
      calculateSupplementAmountSnapshot({
        beforeAmount: 1_000_000,
        recognizedChangeAmount: 150_000,
        recognizedFinalAmount: 1_200_000,
        amountStatus: "confirmed_amount",
      }),
    ).toEqual({
      before: 1_000_000,
      delta: 200_000,
      after: 1_200_000,
      changeType: "amount_adjustment",
    });
  });

  it("仅变更付款方式时忽略分期数字并保持合同总额", () => {
    expect(
      calculateSupplementAmountSnapshot({
        beforeAmount: 1_200_000,
        recognizedChangeAmount: 600_000,
        amountStatus: "payment_only",
        paymentTermsDetected: true,
      }),
    ).toEqual({
      before: 1_200_000,
      delta: 0,
      after: 1_200_000,
      changeType: "payment_terms_only",
    });
  });

  it("金额和付款方式同时变更时返回混合变更类型", () => {
    expect(
      calculateSupplementAmountSnapshot({
        beforeAmount: 1_000_000,
        recognizedChangeAmount: 50_000,
        recognizedFinalAmount: 1_200_000,
        amountStatus: "calculated_amount",
        paymentTermsDetected: true,
      }),
    ).toEqual({
      before: 1_000_000,
      delta: 200_000,
      after: 1_200_000,
      changeType: "amount_and_payment",
    });
  });

  it("按节点顺序得到100万到120万再保持120万最后降至110万", () => {
    const chain = calculateSupplementChain(1_000_000, [
      {
        recognizedFinalAmount: 1_200_000,
        amountStatus: "calculated_amount",
      },
      {
        recognizedChangeAmount: 600_000,
        amountStatus: "payment_only",
        paymentTermsDetected: true,
      },
      {
        recognizedFinalAmount: 1_100_000,
        amountStatus: "calculated_amount",
      },
    ]);

    expect(chain).toEqual({
      originalAmount: 1_000_000,
      snapshots: [
        {
          before: 1_000_000,
          delta: 200_000,
          after: 1_200_000,
          changeType: "amount_adjustment",
        },
        {
          before: 1_200_000,
          delta: 0,
          after: 1_200_000,
          changeType: "payment_terms_only",
        },
        {
          before: 1_200_000,
          delta: -100_000,
          after: 1_100_000,
          changeType: "amount_adjustment",
        },
      ],
      currentAmount: 1_100_000,
    });
  });

  it("两笔相同增减额作为两个独立节点依次计算且不去重", () => {
    const chain = calculateSupplementChain(100, [
      {
        recognizedChangeAmount: 10,
        amountStatus: "confirmed_amount",
      },
      {
        recognizedChangeAmount: 10,
        amountStatus: "confirmed_amount",
      },
    ]);

    expect(chain.snapshots).toHaveLength(2);
    expect(chain.snapshots.map((snapshot) => snapshot.delta)).toEqual([10, 10]);
    expect(chain.snapshots.map((snapshot) => snapshot.after)).toEqual([
      110, 120,
    ]);
    expect(chain.currentAmount).toBe(120);
  });

  it("连续小数金额按整数分运算而不产生浮点尾差", () => {
    expect(
      calculateSupplementAmountSnapshot({
        beforeAmount: 0.1,
        recognizedChangeAmount: 0.2,
        amountStatus: "confirmed_amount",
      }),
    ).toEqual({
      before: 0.1,
      delta: 0.2,
      after: 0.3,
      changeType: "amount_adjustment",
    });
  });

  it.each([
    [
      "负数生效前金额",
      () =>
        calculateSupplementAmountSnapshot({
          beforeAmount: -1,
          recognizedChangeAmount: 1,
          amountStatus: "confirmed_amount",
        }),
      "SUPPLEMENT_AMOUNT_INVALID",
    ],
    [
      "调整后金额小于零",
      () =>
        calculateSupplementAmountSnapshot({
          beforeAmount: 100,
          recognizedChangeAmount: -101,
          amountStatus: "confirmed_amount",
        }),
      "SUPPLEMENT_AMOUNT_INVALID",
    ],
    [
      "金额达到一万亿元",
      () =>
        calculateSupplementAmountSnapshot({
          beforeAmount: 999_999_999_999.99,
          recognizedFinalAmount: 1_000_000_000_000,
          amountStatus: "calculated_amount",
        }),
      "SUPPLEMENT_AMOUNT_OUT_OF_RANGE",
    ],
    [
      "缺少可信金额依据",
      () =>
        calculateSupplementAmountSnapshot({
          beforeAmount: 100,
          recognizedChangeAmount: 20,
          amountStatus: "missing_amount",
        }),
      "SUPPLEMENT_AMOUNT_LEGACY_UNRESOLVED",
    ],
  ])("非法场景失败关闭：%s", (_name, calculate, expectedCode) => {
    try {
      calculate();
      throw new Error("预期金额计算失败，但实际成功");
    } catch (error) {
      expect(error).toBeInstanceOf(SupplementAmountCalculationError);
      expect((error as SupplementAmountCalculationError).code).toBe(
        expectedCode,
      );
    }
  });
});
