/**
 * 合同财务核算。
 *
 * 所有中间计算均使用整数分和基点，避免 JavaScript 浮点数在连续扣减时
 * 产生不可预测的小数误差。百分比结果仅用于展示，不参与后续金额计算。
 */

export const DEFAULT_CONTRACT_RATES_BPS = {
  tax: 1172,
  marketing: 500,
  business: 1000,
  financial: 28,
} as const;

export interface ContractRateBasisPoints {
  tax: number;
  marketing: number;
  business: number;
  financial: number;
}

export type MoneyValue = number | string;

/** 单笔合同或财务金额上限为一万亿元以内，确保数据库转为数值后仍可分辨到分。 */
export const MAX_CONTRACT_AMOUNT_CENTS = 99_999_999_999_999;

export interface MainBusinessIncomeCalculation {
  contractAmountCents: number;
  taxCents: number;
  marketingReserveCents: number;
  businessCostCents: number;
  accountingBaseCents: number;
}

export interface NonMainIncomeCalculation {
  contractAmountCents: number;
  financialCostCents: number;
  taxCents: number;
  accountingBaseCents: number;
}

export interface ContractCompletionResult {
  contractTotalCents: number;
  settledAmountCents: number;
  completionPercentage: number;
  completed: boolean;
  excessAmountCents: number;
  warning: string | null;
}

export interface ContractFinancialRecord {
  amount: MoneyValue;
  occurredAt: string;
  status?: "draft" | "confirmed" | "reversed";
}

export interface ContractMonthlyStatistics {
  month: string;
  activeRecordCount: number;
  amountCents: number;
}

export type ContractSettlementState = "unsettled" | "partial" | "settled";

export interface ContractAmountChange {
  amountCents: number;
  amount: number;
  percentage: number | null;
}

function assertSafeCents(value: bigint): number {
  const result = Number(value);
  if (
    !Number.isSafeInteger(result) ||
    value > BigInt(MAX_CONTRACT_AMOUNT_CENTS) ||
    value < BigInt(-MAX_CONTRACT_AMOUNT_CENTS)
  ) {
    throw new Error("金额超过系统可安全计算范围");
  }
  return result;
}

/** 将元转换为整数分；业务金额必须显式精确到分，禁止静默四舍五入。 */
export function toCents(value: MoneyValue): number {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[,，￥¥\s]/g, "");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("金额格式不正确");
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integerPart, decimalPart = ""] = unsigned.split(".");
  const padded = `${decimalPart}00`;
  let cents = BigInt(integerPart || "0") * 100n + BigInt(padded.slice(0, 2));
  if (negative) cents = -cents;
  return assertSafeCents(cents);
}

/** 将整数分转换为两位小数金额。 */
export function centsToAmount(cents: number): number {
  if (
    !Number.isSafeInteger(cents) ||
    Math.abs(cents) > MAX_CONTRACT_AMOUNT_CENTS
  ) {
    throw new Error("金额分值超过系统可安全展示范围");
  }
  return cents / 100;
}

/** 按基点计算金额并四舍五入到分。 */
export function multiplyByBasisPoints(
  cents: number,
  basisPoints: number,
): number {
  if (!Number.isSafeInteger(cents) || !Number.isInteger(basisPoints)) {
    throw new Error("核算参数不正确");
  }
  if (basisPoints < 0 || basisPoints > 10000) {
    throw new Error("费率必须在 0% 至 100% 之间");
  }
  const amount = BigInt(cents);
  const sign = amount < 0n ? -1n : 1n;
  const absolute = amount < 0n ? -amount : amount;
  const rounded = (absolute * BigInt(basisPoints) + 5000n) / 10000n;
  return assertSafeCents(rounded * sign);
}

function normalizeRates(
  rates: Partial<ContractRateBasisPoints> = {},
): ContractRateBasisPoints {
  return { ...DEFAULT_CONTRACT_RATES_BPS, ...rates };
}

/** 主营项目：税费后依次扣减营销预留和 10% 商务费用。 */
export function calculateMainBusinessIncome(
  amount: MoneyValue,
  rateOverrides: Partial<ContractRateBasisPoints> = {},
): MainBusinessIncomeCalculation {
  const rates = normalizeRates(rateOverrides);
  const contractAmountCents = toCents(amount);
  if (contractAmountCents < 0) throw new Error("收入金额不能为负数");

  const taxCents = multiplyByBasisPoints(contractAmountCents, rates.tax);
  const afterTaxCents = contractAmountCents - taxCents;
  const marketingReserveCents = multiplyByBasisPoints(
    afterTaxCents,
    rates.marketing,
  );
  const afterMarketingCents = afterTaxCents - marketingReserveCents;
  const businessCostCents = multiplyByBasisPoints(
    afterMarketingCents,
    rates.business,
  );

  return {
    contractAmountCents,
    taxCents,
    marketingReserveCents,
    businessCostCents,
    accountingBaseCents:
      contractAmountCents -
      taxCents -
      marketingReserveCents -
      businessCostCents,
  };
}

/** 非主营项目：合同额分别计算财务成本和税费。 */
export function calculateNonMainIncome(
  amount: MoneyValue,
  rateOverrides: Partial<ContractRateBasisPoints> = {},
): NonMainIncomeCalculation {
  const rates = normalizeRates(rateOverrides);
  const contractAmountCents = toCents(amount);
  if (contractAmountCents < 0) throw new Error("收入金额不能为负数");
  const financialCostCents = multiplyByBasisPoints(
    contractAmountCents,
    rates.financial,
  );
  const taxCents = multiplyByBasisPoints(contractAmountCents, rates.tax);

  return {
    contractAmountCents,
    financialCostCents,
    taxCents,
    accountingBaseCents: contractAmountCents - financialCostCents - taxCents,
  };
}

export function calculateContractCompletion(
  settledAmount: MoneyValue,
  contractTotal: MoneyValue,
): ContractCompletionResult {
  const settledAmountCents = toCents(settledAmount);
  const contractTotalCents = toCents(contractTotal);
  if (settledAmountCents < 0 || contractTotalCents < 0) {
    throw new Error("完成率金额不能为负数");
  }

  const excessAmountCents = Math.max(
    0,
    settledAmountCents - contractTotalCents,
  );
  const completionPercentage =
    contractTotalCents > 0
      ? Math.round((settledAmountCents / contractTotalCents) * 10000) / 100
      : 0;

  return {
    contractTotalCents,
    settledAmountCents,
    completionPercentage,
    completed:
      contractTotalCents > 0 && settledAmountCents >= contractTotalCents,
    excessAmountCents,
    warning:
      excessAmountCents > 0
        ? `结算金额超过合同总额 ${centsToAmount(excessAmountCents).toFixed(2)} 元`
        : null,
  };
}

/** 按累计结算金额与固定合同金额判断合同结算状态。 */
export function classifyContractSettlement(
  settledAmount: MoneyValue,
  contractTotal: MoneyValue,
): ContractSettlementState {
  const settledAmountCents = toCents(settledAmount);
  const contractTotalCents = toCents(contractTotal);
  if (settledAmountCents < 0 || contractTotalCents < 0) {
    throw new Error("结算状态金额不能为负数");
  }
  if (settledAmountCents === 0) return "unsettled";
  return settledAmountCents < contractTotalCents ? "partial" : "settled";
}

/** 计算环比或同比差额；基期为零时比例保持空值。 */
export function calculateContractAmountChange(
  currentAmount: MoneyValue,
  comparisonAmount: MoneyValue,
): ContractAmountChange {
  const currentCents = toCents(currentAmount);
  const comparisonCents = toCents(comparisonAmount);
  const amountCents = assertSafeCents(
    BigInt(currentCents) - BigInt(comparisonCents),
  );
  return {
    amountCents,
    amount: centsToAmount(amountCents),
    percentage:
      comparisonCents === 0
        ? null
        : Math.round((amountCents / comparisonCents) * 10000) / 100,
  };
}

/** 以自然月为单位偏移，跨年时保持 YYYY-MM 格式。 */
export function shiftContractNaturalMonth(
  month: string,
  offset: number,
): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(offset)) {
    throw new Error("自然月份或偏移量不正确");
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getContractExcessWarning(
  settledAmount: MoneyValue,
  contractTotal: MoneyValue,
): string | null {
  return calculateContractCompletion(settledAmount, contractTotal).warning;
}

/** 按自然月汇总已确认且未冲正的财务流水。 */
export function summarizeContractMonth(
  records: ContractFinancialRecord[],
  month: string,
): ContractMonthlyStatistics {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("月份格式必须为 YYYY-MM");
  }
  const activeRecords = records.filter(
    (record) =>
      record.status === "confirmed" &&
      String(record.occurredAt).slice(0, 7) === month,
  );
  let amountCents = 0;
  for (const record of activeRecords) {
    const nextAmountCents = amountCents + toCents(record.amount);
    if (
      !Number.isSafeInteger(nextAmountCents) ||
      Math.abs(nextAmountCents) > MAX_CONTRACT_AMOUNT_CENTS
    ) {
      throw new Error("月度金额超出安全范围");
    }
    amountCents = nextAmountCents;
  }
  return { month, activeRecordCount: activeRecords.length, amountCents };
}
