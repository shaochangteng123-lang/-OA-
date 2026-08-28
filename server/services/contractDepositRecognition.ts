import type {
  ContractAssetCategory,
  ContractDeclaredSubtype,
} from "../types/database.js";

export type ContractDepositRecognitionStatus = "confirmed" | "pending" | "none";

export type ContractDepositRecognitionReasonCode =
  | "rental_subtype_not_applicable"
  | "deposit_explicit_amount"
  | "deposit_formula_closed"
  | "deposit_explicitly_waived"
  | "deposit_mention_incomplete"
  | "deposit_conflict"
  | "deposit_not_mentioned";

export interface ContractDepositFormula {
  basis: "monthly_rent" | "monthly_rent_and_property_management_fee";
  months: number;
  monthlyRent: number;
  monthlyPropertyManagementFee: number | null;
  monthlyBasisAmount: number;
  calculatedAmount: number;
}

/**
 * 押金识别只表达合同正文中的押金事实，供后端后续建立独立押金记录。
 * 该结构不得并入合同总金额，也不得由文件名、付款差额或回单金额补齐。
 */
export interface ContractDepositRecognition {
  triggered: boolean;
  status: ContractDepositRecognitionStatus;
  amount: number | null;
  amountSource: "explicit_amount" | "formula" | null;
  formula: ContractDepositFormula | null;
  evidence: string | null;
  reasonCode: ContractDepositRecognitionReasonCode;
}

export interface RecognizeContractDepositInput {
  text: string;
  declaredSubtype?: ContractDeclaredSubtype | null;
  assetCategory?: ContractAssetCategory | null;
  monthlyRent?: number | null;
  monthlyPropertyManagementFee?: number | null;
}

const RENTAL_SUBTYPES = new Set<
  ContractDeclaredSubtype | ContractAssetCategory
>(["house_rental", "vehicle_rental", "parking_space"]);

const DEPOSIT_KEYWORD_PATTERN =
  /(?:(?:租赁)?(?:押金|保证金)|押[一二三四五六七八九十两兩\d]{1,3}付[一二三四五六七八九十两兩\d]{1,3})/u;
const DEPOSIT_KEYWORD_GLOBAL_PATTERN =
  /(?:(?:租赁)?(?:押金|保证金)|押[一二三四五六七八九十两兩\d]{1,3}付[一二三四五六七八九十两兩\d]{1,3})/gu;
const DEPOSIT_WAIVER_PATTERN =
  /(?:(?:免|不|无需|无须|毋须|不再)(?:另行)?(?:支付|缴纳|交纳|收取|设置|约定)?(?:任何)?(?:租赁)?(?:押金|保证金)|(?:不包含|不涉及|未约定)(?:任何)?(?:租赁)?(?:押金|保证金)(?:条款)?|(?:租赁)?(?:押金|保证金).{0,12}(?:免交|免缴|无需支付|无须支付|毋须支付|不予收取|不收取|为零|为\s*0(?:\.0+)?\s*元))/u;
const CHINESE_MONEY_PATTERN =
  /[零〇一二三四五六七八九壹贰貳两兩叁參肆伍陆陸柒捌玖十拾百佰千仟万萬亿億元圆圓角分整正]+/u;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function compactEvidence(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 240);
}

function depositEvidenceWindows(text: string): string[] {
  const normalized = String(text || "").normalize("NFKC");
  const windows: string[] = [];
  for (const match of normalized.matchAll(DEPOSIT_KEYWORD_GLOBAL_PATTERN)) {
    const index = match.index || 0;
    const leftBoundary = Math.max(
      normalized.lastIndexOf("\n", index),
      normalized.lastIndexOf("。", index),
      normalized.lastIndexOf("；", index),
      index - 80,
    );
    const followingBoundaries = [
      normalized.indexOf("\n", index + match[0].length),
      normalized.indexOf("。", index + match[0].length),
      normalized.indexOf("；", index + match[0].length),
      index + 240,
    ].filter((value) => value >= 0);
    const rightBoundary = Math.min(...followingBoundaries, normalized.length);
    const evidence = compactEvidence(
      normalized.slice(Math.max(0, leftBoundary + 1), rightBoundary),
    );
    if (evidence && !windows.includes(evidence)) windows.push(evidence);
  }
  return windows;
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  壹: 1,
  二: 2,
  贰: 2,
  貳: 2,
  两: 2,
  兩: 2,
  三: 3,
  叁: 3,
  參: 3,
  四: 4,
  肆: 4,
  五: 5,
  伍: 5,
  六: 6,
  陆: 6,
  陸: 6,
  七: 7,
  柒: 7,
  八: 8,
  捌: 8,
  九: 9,
  玖: 9,
};

function parseChineseInteger(value: string): number | null {
  const smallUnits: Record<string, number> = {
    十: 10,
    拾: 10,
    百: 100,
    佰: 100,
    千: 1_000,
    仟: 1_000,
  };
  const largeUnits: Record<string, number> = {
    万: 10_000,
    萬: 10_000,
    亿: 100_000_000,
    億: 100_000_000,
  };
  let total = 0;
  let section = 0;
  let digit: number | null = null;
  let recognized = false;
  for (const character of value) {
    if (character in CHINESE_DIGITS) {
      digit = CHINESE_DIGITS[character];
      recognized = true;
    } else if (character in smallUnits) {
      section += (digit == null ? 1 : digit) * smallUnits[character];
      digit = null;
      recognized = true;
    } else if (character in largeUnits) {
      section += digit || 0;
      total += section * largeUnits[character];
      section = 0;
      digit = null;
      recognized = true;
    }
  }
  return recognized ? total + section + (digit || 0) : null;
}

function parseChineseMoney(value: string): number | null {
  const normalized = value
    .replace(/人民币|\s/gu, "")
    .replace(/[圆圓]/gu, "元")
    .replace(/[整正]$/u, "");
  const yuanIndex = normalized.indexOf("元");
  const integerText =
    yuanIndex >= 0 ? normalized.slice(0, yuanIndex) : normalized;
  if (
    !/[零〇一二三四五六七八九壹贰貳两兩叁參肆伍陆陸柒捌玖十拾百佰千仟]/u.test(
      integerText,
    )
  ) {
    return null;
  }
  const integer = parseChineseInteger(integerText);
  if (integer == null) return null;
  const fraction = yuanIndex >= 0 ? normalized.slice(yuanIndex + 1) : "";
  const jiao = fraction.match(
    /([零〇一二三四五六七八九壹贰貳两兩叁參肆伍陆陸柒捌玖])角/u,
  )?.[1];
  const fen = fraction.match(
    /([零〇一二三四五六七八九壹贰貳两兩叁參肆伍陆陸柒捌玖])分/u,
  )?.[1];
  return roundMoney(
    integer +
      (jiao ? CHINESE_DIGITS[jiao]! / 10 : 0) +
      (fen ? CHINESE_DIGITS[fen]! / 100 : 0),
  );
}

function parseExplicitDepositAmounts(evidence: readonly string[]): number[] {
  const values: number[] = [];
  for (const window of evidence) {
    const keywordIndex = window.search(DEPOSIT_KEYWORD_PATTERN);
    if (keywordIndex < 0) continue;
    const depositClause = window.slice(keywordIndex).slice(0, 160);
    const arabic = depositClause.match(
      /(?:押金|保证金)(?:金额|数额)?(?:为|是|按|共计|合计|计|应(?:当)?(?:支付|缴纳|交纳)|需(?:支付|缴纳|交纳)|[:：]){0,2}\s*(?:人民币)?\s*(?:[¥￥]\s*)?([0-9][0-9,]*(?:\.\d{1,2})?)\s*(万)?\s*(?:元|圆|人民币)?/u,
    );
    if (
      arabic &&
      /人民币|[¥￥]|元|圆/u.test(arabic[0]) &&
      !/^\d+(?:\.\d+)?\s*(?:个)?月/u.test(
        arabic[0].replace(/^.*?(?:为|是|按|计|[:：])/u, ""),
      )
    ) {
      const numeric = Number(arabic[1]!.replace(/,/gu, ""));
      const amount = numeric * (arabic[2] ? 10_000 : 1);
      if (Number.isFinite(amount) && amount > 0)
        values.push(roundMoney(amount));
    }
    const chinese = depositClause.match(
      new RegExp(
        `(?:押金|保证金)(?:金额|数额)?(?:为|是|共计|合计|计|应(?:当)?(?:支付|缴纳|交纳)|需(?:支付|缴纳|交纳)|[:：]){0,2}\\s*(?:人民币)?\\s*(${CHINESE_MONEY_PATTERN.source})`,
        "u",
      ),
    );
    const chineseAmount =
      chinese && /[元圆圓]/u.test(chinese[1]!)
        ? parseChineseMoney(chinese[1]!)
        : null;
    if (chineseAmount != null && chineseAmount > 0) values.push(chineseAmount);
  }
  return [...new Set(values)];
}

function parseMonthCount(value: string): number | null {
  const normalized = value.normalize("NFKC").trim();
  const parsed = /^\d+$/u.test(normalized)
    ? Number(normalized)
    : parseChineseInteger(normalized);
  return parsed != null &&
    Number.isInteger(parsed) &&
    parsed >= 1 &&
    parsed <= 24
    ? parsed
    : null;
}

function findDepositFormula(
  evidence: readonly string[],
  monthlyRent: number | null,
  monthlyPropertyManagementFee: number | null,
): { formula: ContractDepositFormula | null; evidence: string | null } {
  for (const window of evidence) {
    const compact = window.replace(/\s+/gu, "");
    const pressed = compact.match(
      /押([一二三四五六七八九十两兩\d]{1,3})付[一二三四五六七八九十两兩\d]{1,3}/u,
    );
    const described = compact.match(
      /(?:押金|保证金).{0,28}?(?:为|按|相当于|等同于|标准为)?([一二三四五六七八九十两兩\d]{1,3})(?:个)?月(?:的)?(?:租金|租赁费用)(及|和|与)?(?:月)?(?:物业(?:管理)?费)?/u,
    );
    const inverse = compact.match(
      /([一二三四五六七八九十两兩\d]{1,3})(?:个)?月(?:的)?(?:租金|租赁费用)(及|和|与)?(?:月)?(?:物业(?:管理)?费)?.{0,16}(?:作为|用作|计作)(?:押金|保证金)/u,
    );
    const multiplier = compact.match(
      /(?:押金|保证金).{0,24}?(?:月租金|每月租金|月租赁费用)(?:的)?([一二三四五六七八九十两兩\d]{1,3})倍/u,
    );
    const matched = pressed || described || inverse || multiplier;
    const months = matched ? parseMonthCount(matched[1]!) : null;
    if (!matched || months == null || monthlyRent == null || monthlyRent <= 0) {
      continue;
    }
    const includesPropertyManagementFee =
      !pressed && /租金(?:及|和|与)(?:月)?物业(?:管理)?费/u.test(matched[0]);
    if (
      includesPropertyManagementFee &&
      (monthlyPropertyManagementFee == null || monthlyPropertyManagementFee < 0)
    ) {
      return { formula: null, evidence: window };
    }
    const propertyFee = includesPropertyManagementFee
      ? monthlyPropertyManagementFee || 0
      : 0;
    const monthlyBasisAmount = roundMoney(monthlyRent + propertyFee);
    const calculatedAmount = roundMoney(monthlyBasisAmount * months);
    return {
      formula: {
        basis: includesPropertyManagementFee
          ? "monthly_rent_and_property_management_fee"
          : "monthly_rent",
        months,
        monthlyRent: roundMoney(monthlyRent),
        monthlyPropertyManagementFee: includesPropertyManagementFee
          ? roundMoney(propertyFee)
          : null,
        monthlyBasisAmount,
        calculatedAmount,
      },
      evidence: window,
    };
  }
  return { formula: null, evidence: null };
}

function emptyRecognition(
  triggered: boolean,
  reasonCode: ContractDepositRecognitionReasonCode,
  evidence: string | null = null,
  status: ContractDepositRecognitionStatus = "none",
): ContractDepositRecognition {
  return {
    triggered,
    status,
    amount: null,
    amountSource: null,
    formula: null,
    evidence,
    reasonCode,
  };
}

export function isRentalDepositRecognitionSubtype(input: {
  declaredSubtype?: ContractDeclaredSubtype | null;
  assetCategory?: ContractAssetCategory | null;
}): boolean {
  return (
    (Boolean(input.declaredSubtype) &&
      RENTAL_SUBTYPES.has(input.declaredSubtype!)) ||
    (Boolean(input.assetCategory) && RENTAL_SUBTYPES.has(input.assetCategory!))
  );
}

/**
 * 依据已锁定租赁二级分类启动押金识别，再由合同正文形成最终结论。
 */
export function recognizeContractDeposit(
  input: RecognizeContractDepositInput,
): ContractDepositRecognition {
  if (!isRentalDepositRecognitionSubtype(input)) {
    return emptyRecognition(false, "rental_subtype_not_applicable");
  }

  const text = String(input.text || "").normalize("NFKC");
  const evidence = depositEvidenceWindows(text);
  if (!DEPOSIT_KEYWORD_PATTERN.test(text)) {
    return emptyRecognition(true, "deposit_not_mentioned");
  }

  const waiverEvidence = evidence.find((item) =>
    DEPOSIT_WAIVER_PATTERN.test(item),
  );
  const explicitAmounts = parseExplicitDepositAmounts(evidence);
  const formulaResult = findDepositFormula(
    evidence,
    input.monthlyRent ?? null,
    input.monthlyPropertyManagementFee ?? null,
  );

  if (
    explicitAmounts.length > 1 ||
    (waiverEvidence && (explicitAmounts.length > 0 || formulaResult.formula)) ||
    (explicitAmounts.length === 1 &&
      formulaResult.formula &&
      explicitAmounts[0] !== formulaResult.formula.calculatedAmount)
  ) {
    return emptyRecognition(
      true,
      "deposit_conflict",
      evidence.join("；").slice(0, 240),
      "pending",
    );
  }

  if (waiverEvidence) {
    return emptyRecognition(true, "deposit_explicitly_waived", waiverEvidence);
  }

  if (explicitAmounts.length === 1) {
    return {
      triggered: true,
      status: "confirmed",
      amount: explicitAmounts[0]!,
      amountSource: "explicit_amount",
      formula: formulaResult.formula,
      evidence:
        evidence.find((item) => item.includes(String(explicitAmounts[0]))) ||
        evidence[0] ||
        null,
      reasonCode: "deposit_explicit_amount",
    };
  }

  if (formulaResult.formula) {
    return {
      triggered: true,
      status: "confirmed",
      amount: formulaResult.formula.calculatedAmount,
      amountSource: "formula",
      formula: formulaResult.formula,
      evidence: formulaResult.evidence,
      reasonCode: "deposit_formula_closed",
    };
  }

  return emptyRecognition(
    true,
    "deposit_mention_incomplete",
    evidence[0] || null,
    "pending",
  );
}
