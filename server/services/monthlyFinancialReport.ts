import {
  FINANCIAL_ACCOUNT_CODES,
  MONTHLY_FINANCIAL_MANUAL_CATEGORIES,
  type FinancialAccountAmounts,
  type FinancialAccountCode,
  type MonthlyFinancialAutomaticSnapshot,
  type MonthlyFinancialDirection,
  type MonthlyFinancialManualCategory,
  type MonthlyFinancialManualItemInput,
  type MonthlyFinancialReportStatus,
  type MonthlyFinancialReportView,
} from "../types/monthly-financial-report.js";

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/;

interface ExactDecimal {
  units: bigint;
  scale: number;
}

export const FINANCIAL_ACCOUNT_NAMES: Record<FinancialAccountCode, string> = {
  general: "一般账户",
  business: "商务账户",
  welfare_one: "福利账户一",
  welfare_two: "福利账户二",
};

export const MANUAL_CATEGORY_RULES: Record<
  MonthlyFinancialManualCategory,
  {
    accountCode: FinancialAccountCode;
    direction: MonthlyFinancialDirection;
    label: string;
  }
> = {
  general_interest: {
    accountCode: "general",
    direction: "income",
    label: "一般账户利息",
  },
  business_interest: {
    accountCode: "business",
    direction: "income",
    label: "商务账户利息",
  },
  general_bank_fee: {
    accountCode: "general",
    direction: "expense",
    label: "一般账户跨行手续费",
  },
  business_bank_fee: {
    accountCode: "business",
    direction: "expense",
    label: "商务账户跨行手续费",
  },
  general_other: {
    accountCode: "general",
    direction: "expense",
    label: "一般账户其他支出",
  },
  welfare_one_supplement: {
    accountCode: "welfare_one",
    direction: "income",
    label: "福利账户一补充收入",
  },
  welfare_two_supplement: {
    accountCode: "welfare_two",
    direction: "income",
    label: "福利账户二补充收入",
  },
  welfare_one_407: {
    accountCode: "welfare_one",
    direction: "expense",
    label: "407费用（历史）",
  },
  welfare_one_drinking_water: {
    accountCode: "welfare_one",
    direction: "expense",
    label: "饮用水",
  },
  welfare_one_office: {
    accountCode: "welfare_one",
    direction: "expense",
    label: "办公",
  },
  welfare_one_electricity: {
    accountCode: "welfare_one",
    direction: "expense",
    label: "电费",
  },
  welfare_one_407_ai: {
    accountCode: "welfare_one",
    direction: "expense",
    label: "407-AI",
  },
  welfare_one_8h_ai: {
    accountCode: "welfare_one",
    direction: "expense",
    label: "8H-AI",
  },
  welfare_two_refreshment: {
    accountCode: "welfare_two",
    direction: "expense",
    label: "茶歇",
  },
  welfare_two_team_building: {
    accountCode: "welfare_two",
    direction: "expense",
    label: "团建",
  },
  welfare_two_physical_exam: {
    accountCode: "welfare_two",
    direction: "expense",
    label: "体检",
  },
};

function powerOfTen(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function normalizeDecimal(decimal: ExactDecimal): ExactDecimal {
  let { units, scale } = decimal;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return { units, scale };
}

function parseDecimal(value: string): ExactDecimal {
  const text = String(value ?? "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error("金额格式不正确");
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  const units =
    BigInt(`${integerPart}${fractionPart}` || "0") * (negative ? -1n : 1n);
  return normalizeDecimal({ units, scale: fractionPart.length });
}

function formatDecimal(decimal: ExactDecimal): string {
  const normalized = normalizeDecimal(decimal);
  const negative = normalized.units < 0n;
  const absolute = negative ? -normalized.units : normalized.units;
  if (normalized.scale === 0) return `${negative ? "-" : ""}${absolute}`;
  const digits = absolute.toString().padStart(normalized.scale + 1, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -normalized.scale)}.${digits.slice(-normalized.scale)}`;
}

function alignDecimals(
  left: ExactDecimal,
  right: ExactDecimal,
): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.units * powerOfTen(scale - left.scale),
    right.units * powerOfTen(scale - right.scale),
    scale,
  ];
}

export function normalizeFinancialAmount(
  value: unknown,
  allowNegative = false,
): string {
  const text = String(value ?? "").trim();
  const pattern = allowNegative
    ? /^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/
    : MONEY_PATTERN;
  if (!pattern.test(text)) throw new Error("金额整数最多18位、小数最多12位");
  const formatted = formatDecimal(parseDecimal(text));
  if (!allowNegative && formatted.startsWith("-"))
    throw new Error("金额不能为负数");
  return formatted;
}

export function addFinancialAmounts(...values: string[]): string {
  let total = parseDecimal("0");
  for (const value of values) {
    const next = parseDecimal(value || "0");
    const [left, right, scale] = alignDecimals(total, next);
    total = normalizeDecimal({ units: left + right, scale });
  }
  return formatDecimal(total);
}

export function subtractFinancialAmounts(
  left: string,
  ...rights: string[]
): string {
  return addFinancialAmounts(left, ...rights.map((value) => `-${value}`));
}

export function isNegativeFinancialAmount(value: string): boolean {
  return parseDecimal(value).units < 0n;
}

export function centsToFinancialAmount(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("金额分值超出安全范围");
  return formatDecimal({ units: BigInt(cents), scale: 2 });
}

export function assertFinancialMonth(month: string): string {
  if (!MONTH_PATTERN.test(month)) throw new Error("月份格式必须为 YYYY-MM");
  return month;
}

export function previousFinancialMonth(month: string): string {
  assertFinancialMonth(month);
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function emptyAccountAmounts(): FinancialAccountAmounts {
  return { general: "0", business: "0", welfare_one: "0", welfare_two: "0" };
}

export function isValidFinancialDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function normalizeOpeningBalances(
  value: unknown,
): FinancialAccountAmounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("四个账户期初余额必须完整提供");
  }
  const input = value as Record<string, unknown>;
  for (const code of FINANCIAL_ACCOUNT_CODES) {
    if (!Object.prototype.hasOwnProperty.call(input, code)) {
      throw new Error("四个账户期初余额必须完整提供");
    }
  }
  return Object.fromEntries(
    FINANCIAL_ACCOUNT_CODES.map((code) => [
      code,
      normalizeFinancialAmount(input[code], true),
    ]),
  ) as FinancialAccountAmounts;
}

export function validateManualItems(
  value: unknown,
  month: string,
): MonthlyFinancialManualItemInput[] {
  assertFinancialMonth(month);
  if (!Array.isArray(value)) throw new Error("手工项目必须为数组");
  if (value.length > 500) throw new Error("单月手工项目不能超过500条");
  return value.map((raw, index) => {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<
      string,
      unknown
    >;
    const category = String(
      item.category || "",
    ) as MonthlyFinancialManualCategory;
    if (!MONTHLY_FINANCIAL_MANUAL_CATEGORIES.includes(category)) {
      throw new Error(`第${index + 1}条手工项目分类无效`);
    }
    const rule = MANUAL_CATEGORY_RULES[category];
    const accountCode = String(
      item.accountCode || rule.accountCode,
    ) as FinancialAccountCode;
    const direction = String(
      item.direction || rule.direction,
    ) as MonthlyFinancialDirection;
    if (accountCode !== rule.accountCode || direction !== rule.direction) {
      throw new Error(`第${index + 1}条手工项目账户或收支方向与分类不一致`);
    }
    const occurredOn = String(item.occurredOn || "");
    if (!isValidFinancialDate(occurredOn) || occurredOn.slice(0, 7) !== month) {
      throw new Error(`第${index + 1}条手工项目日期必须属于当前月份`);
    }
    const description = String(item.description || "").trim();
    if (category === "general_other" && !description) {
      throw new Error(`第${index + 1}条其他支出必须填写说明`);
    }
    const amount = normalizeFinancialAmount(item.amount);
    if (amount === "0") {
      throw new Error(`第${index + 1}条手工项目金额必须大于零`);
    }
    return {
      id: item.id ? String(item.id) : undefined,
      category,
      accountCode,
      direction,
      amount,
      occurredOn,
      description: description || null,
      voucherReference: String(item.voucherReference || "").trim() || null,
    };
  });
}

function sumManualCategory(
  items: MonthlyFinancialManualItemInput[],
  category: MonthlyFinancialManualCategory,
): string {
  return addFinancialAmounts(
    ...items
      .filter((item) => item.category === category)
      .map((item) => item.amount),
  );
}

export function buildMonthlyFinancialReportView(input: {
  id: string | null;
  month: string;
  status: MonthlyFinancialReportStatus;
  version: number;
  openingBalances: FinancialAccountAmounts;
  automatic: MonthlyFinancialAutomaticSnapshot;
  manualItems: MonthlyFinancialManualItemInput[];
  lastRefreshedAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
  canMaintain: boolean;
  closedSnapshot?: MonthlyFinancialReportView | null;
}): MonthlyFinancialReportView {
  if (input.status === "closed" && input.closedSnapshot) {
    return {
      ...input.closedSnapshot,
      permissions: {
        canMaintain: false,
        canClose: false,
        canReopen: input.canMaintain,
        canDownload: true,
      },
    };
  }

  const manual = input.manualItems;
  const activeBankAccounts = new Set(
    input.automatic.bank?.activeAccounts || [],
  );
  const chargeBankAccounts = new Set(
    input.automatic.bank?.chargeAccounts ||
      [...activeBankAccounts].filter(
        (code): code is "general" | "business" =>
          code === "general" || code === "business",
      ),
  );
  const income = {
    ...input.automatic.income,
    generalInterest: chargeBankAccounts.has("general")
      ? input.automatic.bank?.generalInterest || "0"
      : sumManualCategory(manual, "general_interest"),
    businessInterest: chargeBankAccounts.has("business")
      ? input.automatic.bank?.businessInterest || "0"
      : sumManualCategory(manual, "business_interest"),
    welfareOneSupplementIncome: sumManualCategory(
      manual,
      "welfare_one_supplement",
    ),
    welfareTwoSupplementIncome: sumManualCategory(
      manual,
      "welfare_two_supplement",
    ),
  };
  const expenses = {
    ...input.automatic.expenses,
    generalBankFee: chargeBankAccounts.has("general")
      ? input.automatic.bank?.generalBankFee || "0"
      : sumManualCategory(manual, "general_bank_fee"),
    businessBankFee: chargeBankAccounts.has("business")
      ? input.automatic.bank?.businessBankFee || "0"
      : sumManualCategory(manual, "business_bank_fee"),
    generalOtherExpense: sumManualCategory(manual, "general_other"),
    welfareOne407: sumManualCategory(manual, "welfare_one_407"),
    welfareOneDrinkingWater: sumManualCategory(
      manual,
      "welfare_one_drinking_water",
    ),
    welfareOneOffice: sumManualCategory(manual, "welfare_one_office"),
    welfareOneElectricity: sumManualCategory(manual, "welfare_one_electricity"),
    welfareOne407Ai: sumManualCategory(manual, "welfare_one_407_ai"),
    welfareOne8hAi: sumManualCategory(manual, "welfare_one_8h_ai"),
    welfareTwoRefreshment: sumManualCategory(manual, "welfare_two_refreshment"),
    welfareTwoTeamBuilding: sumManualCategory(
      manual,
      "welfare_two_team_building",
    ),
    welfareTwoHealthCheck: sumManualCategory(
      manual,
      "welfare_two_physical_exam",
    ),
  };

  const accountFlow: Record<
    FinancialAccountCode,
    { income: string; expense: string }
  > = {
    general: {
      income: addFinancialAmounts(
        income.accountingBase,
        income.generalInterest,
      ),
      expense: addFinancialAmounts(
        expenses.humanCost,
        expenses.basicReimbursement,
        expenses.largeReimbursement,
        expenses.assetAdministration,
        expenses.generalBankFee,
        expenses.generalOtherExpense,
      ),
    },
    business: {
      income: addFinancialAmounts(
        income.marketingReserve,
        income.businessCost,
        income.businessInterest,
      ),
      expense: addFinancialAmounts(
        expenses.businessReimbursement,
        expenses.businessBankFee,
      ),
    },
    welfare_one: {
      income: income.welfareOneSupplementIncome,
      expense: addFinancialAmounts(
        expenses.welfareOne407,
        expenses.welfareOneDrinkingWater,
        expenses.welfareOneOffice,
        expenses.welfareOneElectricity,
        expenses.welfareOne407Ai,
        expenses.welfareOne8hAi,
      ),
    },
    welfare_two: {
      income: income.welfareTwoSupplementIncome,
      expense: addFinancialAmounts(
        expenses.welfareTwoRefreshment,
        expenses.welfareTwoTeamBuilding,
        expenses.welfareTwoHealthCheck,
      ),
    },
  };
  const accounts = FINANCIAL_ACCOUNT_CODES.map((code) => ({
    code,
    name: FINANCIAL_ACCOUNT_NAMES[code],
    openingBalance: input.openingBalances[code],
    income: accountFlow[code].income,
    expense: accountFlow[code].expense,
    closingBalance: subtractFinancialAmounts(
      addFinancialAmounts(
        input.openingBalances[code],
        accountFlow[code].income,
      ),
      accountFlow[code].expense,
    ),
  }));
  const warnings = accounts
    .filter((account) => isNegativeFinancialAmount(account.closingBalance))
    .map((account) => ({
      code: `NEGATIVE_${account.code.toUpperCase()}`,
      message: `${account.name}期末余额为负数，请确认后再月结`,
      blocking: false,
    }));

  return {
    id: input.id,
    month: input.month,
    status: input.status,
    version: input.version,
    lastRefreshedAt: input.lastRefreshedAt,
    closedAt: input.closedAt,
    updatedAt: input.updatedAt,
    openingBalances: input.openingBalances,
    accounts,
    income,
    expenses,
    manualItems: manual,
    sources: input.automatic.sources,
    details: input.automatic.details,
    warnings,
    permissions: {
      canMaintain: input.canMaintain,
      canClose: input.canMaintain,
      canReopen: false,
      canDownload: true,
    },
  };
}
