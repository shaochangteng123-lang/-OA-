import crypto from "crypto";

export interface MonthlyBankContentCorrectionChallengeToken {
  token: string;
  tokenHash: string;
}

function hmacHex(value: string, secret: string): string {
  if (!secret) throw new Error("银行回单纠正确认密钥未配置");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export function fingerprintMonthlyBankContentCorrections(
  corrections: unknown[],
): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(corrections))
    .digest("hex");
}

export function createMonthlyBankContentCorrectionChallengeToken(
  secret: string,
): MonthlyBankContentCorrectionChallengeToken {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hmacHex(token, secret) };
}

export function hashMonthlyBankContentCorrectionSession(
  sessionId: string,
  secret: string,
): string {
  return hmacHex(`session:${sessionId}`, secret);
}

export function verifyMonthlyBankContentCorrectionChallengeToken(
  token: string,
  expectedTokenHash: string,
  secret: string,
): boolean {
  if (!token || !/^[0-9a-f]{64}$/u.test(expectedTokenHash)) return false;
  const suppliedHash = Buffer.from(hmacHex(token, secret), "hex");
  const storedHash = Buffer.from(expectedTokenHash, "hex");
  return (
    suppliedHash.length === storedHash.length &&
    crypto.timingSafeEqual(suppliedHash, storedHash)
  );
}
