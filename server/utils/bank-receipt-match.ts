/**
 * 检查收款账号是否完整一致，忽略账号中的空白字符。
 */
export function accountMatches(expected: string, ocr: string): boolean {
  const expectedAccount = expected.replace(/\s+/g, "");
  const recognizedAccount = ocr.replace(/\s+/g, "");
  if (!expectedAccount || !recognizedAccount) return false;
  return expectedAccount === recognizedAccount;
}

/**
 * 检查识别出的收款人字段是否匹配员工银行户名。
 */
export function nameMatches(expected: string, ocrPayee: string): boolean {
  const name = expected.replace(/\s+/g, "").trim();
  const payee = ocrPayee.replace(/\s+/g, "").trim();
  if (!name || !payee || payee === "付款" || payee === "收款") return false;

  // 两字姓名必须与识别出的收款人字段完整一致。
  if (payee === name) return true;
  if (name.length < 3) return false;

  // 三字及以上姓名允许缺失一个字，但仅在收款人字段内匹配，且至少保留两个字。
  for (let i = 0; i < name.length; i++) {
    const partial = name
      .split("")
      .filter((_, idx) => idx !== i)
      .join("");
    if (partial.length >= 2 && payee.includes(partial)) return true;
  }

  return false;
}

/**
 * 检查回单收款信息是否属于报销人。
 * 双方账号都有值时以账号精确一致为准，账号不一致时不再使用姓名放行。
 */
export function recipientMatches(
  expectedName: string,
  expectedAccount: string,
  ocrPayee: string,
  ocrPayeeAccount: string,
): boolean {
  const hasExpectedAccount = expectedAccount.replace(/\s+/g, "").length > 0;
  const hasOcrAccount = ocrPayeeAccount.replace(/\s+/g, "").length > 0;

  if (hasExpectedAccount && hasOcrAccount) {
    return accountMatches(expectedAccount, ocrPayeeAccount);
  }

  return nameMatches(expectedName, ocrPayee);
}
