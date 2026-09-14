import {
  createMonthlyBankContentCorrectionChallengeToken,
  fingerprintMonthlyBankContentCorrections,
  hashMonthlyBankContentCorrectionSession,
  verifyMonthlyBankContentCorrectionChallengeToken,
} from "../server/services/monthlyFinancialBankContentCorrection";

describe("月报银行回单历史识别纠正确认挑战", () => {
  const secret = "monthly-bank-content-correction-test-secret";

  it("只保存随机一次性令牌的消息认证摘要", () => {
    const first = createMonthlyBankContentCorrectionChallengeToken(secret);
    const second = createMonthlyBankContentCorrectionChallengeToken(secret);

    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.tokenHash).not.toContain(first.token);
    expect(
      verifyMonthlyBankContentCorrectionChallengeToken(
        first.token,
        first.tokenHash,
        secret,
      ),
    ).toBe(true);
  });

  it("拒绝错误令牌、错误密钥和篡改后的摘要", () => {
    const issued = createMonthlyBankContentCorrectionChallengeToken(secret);

    expect(
      verifyMonthlyBankContentCorrectionChallengeToken(
        `${issued.token}x`,
        issued.tokenHash,
        secret,
      ),
    ).toBe(false);
    expect(
      verifyMonthlyBankContentCorrectionChallengeToken(
        issued.token,
        issued.tokenHash,
        `${secret}-other`,
      ),
    ).toBe(false);
    expect(
      verifyMonthlyBankContentCorrectionChallengeToken(
        issued.token,
        `${issued.tokenHash.slice(0, -1)}${issued.tokenHash.endsWith("0") ? "1" : "0"}`,
        secret,
      ),
    ).toBe(false);
  });

  it("会话与差异清单摘要稳定且内容变化时不同", () => {
    expect(hashMonthlyBankContentCorrectionSession("session-1", secret)).toBe(
      hashMonthlyBankContentCorrectionSession("session-1", secret),
    );
    expect(
      hashMonthlyBankContentCorrectionSession("session-1", secret),
    ).not.toBe(hashMonthlyBankContentCorrectionSession("session-2", secret));
    expect(
      fingerprintMonthlyBankContentCorrections([{ amount: "19794.20" }]),
    ).not.toBe(
      fingerprintMonthlyBankContentCorrections([{ amount: "19794.27" }]),
    );
  });
});
