interface ExactDecimal {
  units: bigint;
  scale: number;
}

export interface PayrollBreakdown {
  company_pension: string;
  company_medical: string;
  company_unemployment: string;
  company_injury: string;
  company_social_total: string;
  company_housing_fund: string;
  company_paid_total: string;
  withheld_social: string;
  withheld_housing_fund: string;
  withheld_tax: string;
  withheld_total: string;
  personal_pension: string;
  personal_medical: string;
  personal_unemployment: string;
  personal_social_total: string;
  personal_housing_fund: string;
  net_salary: string;
}

export type PayrollAmountField =
  | "monthly_salary"
  | "housing_fund_base"
  | "contribution_base"
  | "company_pension"
  | "company_medical"
  | "company_unemployment"
  | "company_injury"
  | "company_social_total"
  | "company_housing_fund"
  | "company_paid_total"
  | "withheld_social"
  | "withheld_housing_fund"
  | "withheld_tax"
  | "withheld_total"
  | "personal_pension"
  | "personal_medical"
  | "personal_unemployment"
  | "personal_social_total"
  | "personal_housing_fund"
  | "individual_income_tax"
  | "net_salary";

export type PayrollTotals = Record<PayrollAmountField, string> & {
  cost_total: string;
};

export const PAYROLL_AMOUNT_FIELDS: PayrollAmountField[] = [
  "monthly_salary",
  "housing_fund_base",
  "contribution_base",
  "company_pension",
  "company_medical",
  "company_unemployment",
  "company_injury",
  "company_social_total",
  "company_housing_fund",
  "company_paid_total",
  "withheld_social",
  "withheld_housing_fund",
  "withheld_tax",
  "withheld_total",
  "personal_pension",
  "personal_medical",
  "personal_unemployment",
  "personal_social_total",
  "personal_housing_fund",
  "individual_income_tax",
  "net_salary",
];

const INPUT_AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/;

function powerOfTen(value: number): bigint {
  return 10n ** BigInt(value);
}

function normalizeDecimal(value: ExactDecimal): ExactDecimal {
  let { units, scale } = value;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale--;
  }
  return { units, scale };
}

function parseDecimal(value: string): ExactDecimal {
  const normalized = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error("金额格式无效");
  }

  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  const units =
    BigInt(`${integerPart}${fractionPart}` || "0") * (negative ? -1n : 1n);
  return normalizeDecimal({ units, scale: fractionPart.length });
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

function addDecimals(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  const [leftUnits, rightUnits, scale] = alignDecimals(left, right);
  return normalizeDecimal({ units: leftUnits + rightUnits, scale });
}

function subtractDecimals(
  left: ExactDecimal,
  right: ExactDecimal,
): ExactDecimal {
  const [leftUnits, rightUnits, scale] = alignDecimals(left, right);
  return normalizeDecimal({ units: leftUnits - rightUnits, scale });
}

function multiplyByPowerOfTenRate(
  value: ExactDecimal,
  numerator: bigint,
  denominatorScale: number,
): ExactDecimal {
  return normalizeDecimal({
    units: value.units * numerator,
    scale: value.scale + denominatorScale,
  });
}

function compareDecimals(left: ExactDecimal, right: ExactDecimal): number {
  const [leftUnits, rightUnits] = alignDecimals(left, right);
  if (leftUnits === rightUnits) return 0;
  return leftUnits > rightUnits ? 1 : -1;
}

function formatDecimal(value: ExactDecimal, minimumFractionDigits = 2): string {
  const normalized = normalizeDecimal(value);
  const negative = normalized.units < 0n;
  const absoluteUnits = negative ? -normalized.units : normalized.units;
  const scale = Math.max(normalized.scale, minimumFractionDigits);
  const paddedUnits = absoluteUnits * powerOfTen(scale - normalized.scale);
  const digits = paddedUnits.toString().padStart(scale + 1, "0");
  const sign = negative ? "-" : "";

  if (scale === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function roundDecimal(
  value: ExactDecimal,
  fractionDigits: number,
): ExactDecimal {
  const normalized = normalizeDecimal(value);
  if (normalized.scale <= fractionDigits) return normalized;

  const divisor = powerOfTen(normalized.scale - fractionDigits);
  const negative = normalized.units < 0n;
  const absoluteUnits = negative ? -normalized.units : normalized.units;
  const quotient = absoluteUnits / divisor;
  const remainder = absoluteUnits % divisor;
  const roundedUnits = quotient + (remainder * 2n >= divisor ? 1n : 0n);
  return normalizeDecimal({
    units: negative ? -roundedUnits : roundedUnits,
    scale: fractionDigits,
  });
}

function formatMoney(value: ExactDecimal): string {
  return formatDecimal(roundDecimal(value, 2), 2);
}

function addMany(values: ExactDecimal[]): ExactDecimal {
  return values.reduce(addDecimals, parseDecimal("0"));
}

export function normalizePayrollAmount(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("金额不能为空");
  }

  const text = String(value).trim();
  if (!INPUT_AMOUNT_PATTERN.test(text)) {
    throw new Error("金额必须是非负数字，整数最多12位，小数最多8位");
  }
  return formatDecimal(parseDecimal(text), 0);
}

export function formatPayrollAmount(value: string): string {
  return formatDecimal(parseDecimal(value), 2);
}

export function comparePayrollAmounts(left: string, right: string): number {
  return compareDecimals(parseDecimal(left), parseDecimal(right));
}

export function multiplyPayrollAmountByInteger(
  value: string,
  multiplier: number,
): string {
  if (!Number.isSafeInteger(multiplier) || multiplier < 0)
    throw new Error("乘数无效");
  const decimal = parseDecimal(value);
  return formatDecimal(
    { units: decimal.units * BigInt(multiplier), scale: decimal.scale },
    0,
  );
}

export function calculatePayrollBreakdown(
  monthlySalaryValue: string,
  housingFundBaseValue: string,
  contributionBaseValue: string,
  individualIncomeTaxValue: string,
): PayrollBreakdown {
  const monthlySalary = parseDecimal(
    normalizePayrollAmount(monthlySalaryValue),
  );
  const housingFundBase = parseDecimal(
    normalizePayrollAmount(housingFundBaseValue),
  );
  const contributionBase = parseDecimal(
    normalizePayrollAmount(contributionBaseValue),
  );
  const individualIncomeTax = roundDecimal(
    parseDecimal(normalizePayrollAmount(individualIncomeTaxValue)),
    2,
  );

  // 社保和公积金按税务缴费口径逐项精确到分，再计算个人及全员合计。
  const companyPension = roundDecimal(
    multiplyByPowerOfTenRate(contributionBase, 16n, 2),
    2,
  );
  const companyMedical = roundDecimal(
    multiplyByPowerOfTenRate(contributionBase, 98n, 3),
    2,
  );
  const companyUnemployment = roundDecimal(
    multiplyByPowerOfTenRate(contributionBase, 5n, 3),
    2,
  );
  const companyInjury = roundDecimal(
    multiplyByPowerOfTenRate(contributionBase, 4n, 3),
    2,
  );
  const companySocialTotal = addMany([
    companyPension,
    companyMedical,
    companyUnemployment,
    companyInjury,
  ]);
  const companyHousingFund = roundDecimal(
    multiplyByPowerOfTenRate(housingFundBase, 6n, 2),
    2,
  );
  const companyPaidTotal = addDecimals(companySocialTotal, companyHousingFund);

  const personalPension = roundDecimal(
    multiplyByPowerOfTenRate(contributionBase, 8n, 2),
    2,
  );
  const personalMedical =
    compareDecimals(contributionBase, parseDecimal("0")) > 0
      ? roundDecimal(
          addDecimals(
            multiplyByPowerOfTenRate(contributionBase, 2n, 2),
            parseDecimal("3"),
          ),
          2,
        )
      : parseDecimal("0");
  const personalUnemployment = roundDecimal(
    multiplyByPowerOfTenRate(contributionBase, 5n, 3),
    2,
  );
  const personalSocialTotal = addMany([
    personalPension,
    personalMedical,
    personalUnemployment,
  ]);
  const personalHousingFund = roundDecimal(
    multiplyByPowerOfTenRate(housingFundBase, 6n, 2),
    2,
  );

  const withheldSocial = addDecimals(companySocialTotal, personalSocialTotal);
  const withheldHousingFund = addDecimals(
    companyHousingFund,
    personalHousingFund,
  );
  const withheldTotal = addMany([
    withheldSocial,
    withheldHousingFund,
    individualIncomeTax,
  ]);
  const netSalary = subtractDecimals(
    subtractDecimals(
      subtractDecimals(monthlySalary, personalSocialTotal),
      personalHousingFund,
    ),
    individualIncomeTax,
  );

  return {
    company_pension: formatMoney(companyPension),
    company_medical: formatMoney(companyMedical),
    company_unemployment: formatMoney(companyUnemployment),
    company_injury: formatMoney(companyInjury),
    company_social_total: formatMoney(companySocialTotal),
    company_housing_fund: formatMoney(companyHousingFund),
    company_paid_total: formatMoney(companyPaidTotal),
    withheld_social: formatMoney(withheldSocial),
    withheld_housing_fund: formatMoney(withheldHousingFund),
    withheld_tax: formatMoney(individualIncomeTax),
    withheld_total: formatMoney(withheldTotal),
    personal_pension: formatMoney(personalPension),
    personal_medical: formatMoney(personalMedical),
    personal_unemployment: formatMoney(personalUnemployment),
    personal_social_total: formatMoney(personalSocialTotal),
    personal_housing_fund: formatMoney(personalHousingFund),
    net_salary: formatMoney(netSalary),
  };
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function addCalendarYears(value: Date, years: number): Date {
  const targetYear = value.getUTCFullYear() + years;
  const month = value.getUTCMonth();
  const day = value.getUTCDate();
  const lastDay = new Date(Date.UTC(targetYear, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, month, Math.min(day, lastDay)));
}

export function getPayrollMonthRange(payrollMonth: string): {
  startDate: string;
  endDate: string;
} {
  const match = /^(\d{4})-(\d{2})$/.exec(payrollMonth);
  if (!match) throw new Error("工资月份格式无效");

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12) {
    throw new Error("工资月份无效");
  }

  const startDate = `${match[1]}-${match[2]}-01`;
  const endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { startDate, endDate };
}

export function countCompletedSalaryYears(
  salaryStartDate: string | null,
  payrollMonth: string,
): number {
  if (!salaryStartDate) return 0;
  const startDate = parseDate(salaryStartDate);
  if (!startDate) return 0;

  const { endDate } = getPayrollMonthRange(payrollMonth);
  const payrollDate = parseDate(endDate)!;
  if (addCalendarYears(startDate, 1).getTime() > payrollDate.getTime())
    return 0;

  let completedYears = 0;
  for (let offset = 1; offset <= 200; offset++) {
    if (addCalendarYears(startDate, offset).getTime() > payrollDate.getTime())
      break;
    completedYears++;
  }
  return completedYears;
}

export function calculateAutomaticMonthlySalary(
  initialMonthlySalary: string | null,
  salaryStartDate: string | null,
  payrollMonth: string,
): string {
  if (!initialMonthlySalary) return "0.00";

  const initial = parseDecimal(normalizePayrollAmount(initialMonthlySalary));
  const cap = parseDecimal("10000");
  if (compareDecimals(initial, cap) >= 0) return formatDecimal(initial);

  const completedYears = countCompletedSalaryYears(
    salaryStartDate,
    payrollMonth,
  );
  const raised = addDecimals(
    initial,
    parseDecimal(String(completedYears * 1000)),
  );
  return formatDecimal(compareDecimals(raised, cap) > 0 ? cap : raised);
}

export function calculatePayrollTotals(
  rows: Array<Record<PayrollAmountField, string>>,
): PayrollTotals {
  const totals = {} as PayrollTotals;
  for (const field of PAYROLL_AMOUNT_FIELDS) {
    totals[field] = formatMoney(
      addMany(rows.map((row) => parseDecimal(row[field] || "0"))),
    );
  }
  totals.cost_total = formatMoney(
    addDecimals(
      parseDecimal(totals.withheld_total),
      parseDecimal(totals.net_salary),
    ),
  );
  return totals;
}
