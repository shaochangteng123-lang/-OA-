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
  type MonthlyFinancialWelfareOneExpenseCategory,
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
  general_tax_payment: {
    accountCode: "general",
    direction: "expense",
    label: "一般账户实际税费支出",
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
  welfare_one_expense: {
    accountCode: "welfare_one",
    direction: "expense",
    label: "福利账户一分类支出",
  },
  welfare_two_expense: {
    accountCode: "welfare_two",
    direction: "expense",
    label: "福利账户二分类支出",
  },
};

export const FIXED_WELFARE_ONE_EXPENSE_CATEGORIES = [
  {
    id: "welfare_one_drinking_water",
    code: "drinking_water",
    name: "饮用水",
    sortOrder: 1,
  },
  {
    id: "welfare_one_office",
    code: "office",
    name: "办公",
    sortOrder: 2,
  },
  {
    id: "welfare_one_electricity",
    code: "electricity",
    name: "电费",
    sortOrder: 3,
  },
  {
    id: "welfare_one_407_ai",
    code: "407_ai",
    name: "407-AI",
    sortOrder: 4,
  },
  {
    id: "welfare_one_8h_ai",
    code: "8h_ai",
    name: "8H-AI",
    sortOrder: 5,
  },
] as const;

export const FIXED_WELFARE_TWO_EXPENSE_CATEGORIES = [
  {
    id: "welfare_two_refreshment",
    code: "refreshment",
    name: "茶歇",
    sortOrder: 1,
  },
  {
    id: "welfare_two_team_building",
    code: "team_building",
    name: "团建",
    sortOrder: 2,
  },
  {
    id: "welfare_two_physical_exam",
    code: "physical_exam",
    name: "体检",
    sortOrder: 3,
  },
] as const;

export interface MonthlyFinancialWelfareCategoryCatalogRow {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * 开放月报只实时合并分类主数据；已保存自动金额仍取原快照，避免一次普通读取重算业务金额。
 * 已从主数据删除但快照仍有非零金额的分类继续以停用项保留，防止历史金额消失。
 */
export function mergeMonthlyFinancialAutomaticWelfareCatalog(
  stored:
    | MonthlyFinancialAutomaticSnapshot["welfareOneExpenseCategories"]
    | undefined,
  catalog: readonly MonthlyFinancialWelfareCategoryCatalogRow[],
): NonNullable<
  MonthlyFinancialAutomaticSnapshot["welfareOneExpenseCategories"]
> {
  const storedById = new Map((stored || []).map((row) => [row.id, row]));
  const currentIds = new Set(catalog.map((row) => row.id));
  return [
    ...catalog.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      amount: storedById.get(row.id)?.amount || "0",
    })),
    ...(stored || [])
      .filter(
        (row) =>
          !currentIds.has(row.id) && addFinancialAmounts(row.amount) !== "0",
      )
      .map((row) => ({ ...row, isActive: false })),
  ].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name, "zh-CN") ||
      left.id.localeCompare(right.id),
  );
}

/** 已月结快照必须原样返回；仅开放状态允许叠加实时分类主数据。 */
export function mergeOpenMonthlyFinancialWelfareCatalogs(
  status: MonthlyFinancialReportStatus,
  stored: MonthlyFinancialAutomaticSnapshot,
  welfareOneCatalog: readonly MonthlyFinancialWelfareCategoryCatalogRow[],
  welfareTwoCatalog: readonly MonthlyFinancialWelfareCategoryCatalogRow[],
): MonthlyFinancialAutomaticSnapshot {
  if (status === "closed") return stored;
  return {
    ...stored,
    welfareOneExpenseCategories: mergeMonthlyFinancialAutomaticWelfareCatalog(
      stored.welfareOneExpenseCategories,
      welfareOneCatalog,
    ),
    welfareTwoExpenseCategories: mergeMonthlyFinancialAutomaticWelfareCatalog(
      stored.welfareTwoExpenseCategories,
      welfareTwoCatalog,
    ),
  };
}

const LEGACY_WELFARE_ONE_MANUAL_CATEGORY_CODES: Partial<
  Record<MonthlyFinancialManualCategory, string>
> = {
  welfare_one_407: "office",
  welfare_one_drinking_water: "drinking_water",
  welfare_one_office: "office",
  welfare_one_electricity: "electricity",
  welfare_one_407_ai: "407_ai",
  welfare_one_8h_ai: "8h_ai",
};

const LEGACY_WELFARE_TWO_MANUAL_CATEGORY_CODES: Partial<
  Record<MonthlyFinancialManualCategory, string>
> = {
  welfare_two_refreshment: "refreshment",
  welfare_two_team_building: "team_building",
  welfare_two_physical_exam: "physical_exam",
};

function normalizedWelfareCategoryName(value: unknown): string {
  return String(value || "")
    .trim()
    .normalize("NFKC")
    .replace(/[\s_-]+/g, "")
    .toLocaleLowerCase("zh-CN");
}

function buildWelfareExpenseCategories(
  automaticCategories: NonNullable<
    MonthlyFinancialAutomaticSnapshot["welfareOneExpenseCategories"]
  >,
  manualItems: MonthlyFinancialManualItemInput[],
  fixedCategories: ReadonlyArray<{
    id: string;
    code: string;
    name: string;
    sortOrder: number;
  }>,
  dynamicCategory: "welfare_one_expense" | "welfare_two_expense",
  legacyCategoryCodes: Partial<Record<MonthlyFinancialManualCategory, string>>,
  useFixedFallback: boolean,
): MonthlyFinancialWelfareOneExpenseCategory[] {
  type WorkingCategory = MonthlyFinancialWelfareOneExpenseCategory & {
    aliases: Set<string>;
  };
  const rows = new Map<string, WorkingCategory>();
  const idToKey = new Map<string, string>();
  const codeToKey = new Map<string, string>();
  const nameToKey = new Map<string, string>();

  const registerAliases = (key: string, row: WorkingCategory) => {
    if (row.id) idToKey.set(row.id, key);
    if (row.code) codeToKey.set(row.code, key);
    const normalizedName = normalizedWelfareCategoryName(row.name);
    if (normalizedName) nameToKey.set(normalizedName, key);
    row.aliases.add(row.id);
    row.aliases.add(row.code);
    row.aliases.add(normalizedName);
  };
  const fixedByIdentity = (code: string, name: string) =>
    fixedCategories.find(
      (item) =>
        item.code === code ||
        normalizedWelfareCategoryName(item.name) ===
          normalizedWelfareCategoryName(name),
    );
  const resolveKey = (id: string, code: string, name: string) => {
    const fixed = fixedByIdentity(code, name);
    if (fixed) return `fixed:${fixed.code}`;
    return (
      idToKey.get(id) ||
      codeToKey.get(code) ||
      nameToKey.get(normalizedWelfareCategoryName(name)) ||
      `category:${id || code || normalizedWelfareCategoryName(name)}`
    );
  };

  if (useFixedFallback) {
    for (const fixed of fixedCategories) {
      const key = `fixed:${fixed.code}`;
      const row: WorkingCategory = {
        ...fixed,
        isActive: true,
        automaticAmount: "0",
        manualAmount: "0",
        totalAmount: "0",
        isFixed: true,
        aliases: new Set<string>(),
      };
      rows.set(key, row);
      registerAliases(key, row);
    }
  }

  for (const source of automaticCategories) {
    const key = resolveKey(source.id, source.code, source.name);
    const fixed = fixedByIdentity(source.code, source.name);
    const existing = rows.get(key);
    const row: WorkingCategory = existing || {
      id: source.id,
      code: source.code,
      name: source.name,
      sortOrder: source.sortOrder,
      isActive: source.isActive,
      automaticAmount: "0",
      manualAmount: "0",
      totalAmount: "0",
      isFixed: Boolean(fixed),
      aliases: new Set<string>(),
    };
    row.automaticAmount = addFinancialAmounts(
      row.automaticAmount,
      normalizeFinancialAmount(source.amount),
    );
    row.isActive = row.isActive || source.isActive;
    if (!row.isFixed) {
      row.name = source.name;
      row.sortOrder = Math.min(row.sortOrder, source.sortOrder);
    }
    rows.set(key, row);
    registerAliases(key, row);
    if (fixed) {
      idToKey.set(source.id, key);
      codeToKey.set(source.code, key);
    }
  }

  for (const item of manualItems) {
    let key: string | undefined;
    if (item.category === dynamicCategory) {
      const id = item.welfareCategoryId || "";
      const name = item.welfareCategoryNameSnapshot || "未命名福利分类";
      key =
        idToKey.get(id) ||
        nameToKey.get(normalizedWelfareCategoryName(name)) ||
        resolveKey(id, "", name);
      if (!rows.has(key)) {
        const row: WorkingCategory = {
          id,
          code: `legacy_${id || normalizedWelfareCategoryName(name)}`,
          name,
          sortOrder: Number.MAX_SAFE_INTEGER,
          isActive: false,
          automaticAmount: "0",
          manualAmount: "0",
          totalAmount: "0",
          isFixed: Boolean(fixedByIdentity("", name)),
          aliases: new Set<string>(),
        };
        rows.set(key, row);
        registerAliases(key, row);
      }
    } else {
      const code = legacyCategoryCodes[item.category];
      if (code) key = `fixed:${code}`;
    }
    if (!key) continue;
    const row = rows.get(key);
    if (!row) continue;
    row.manualAmount = addFinancialAmounts(row.manualAmount, item.amount);
  }

  return [...rows.values()]
    .map(({ aliases: _aliases, ...row }) => ({
      ...row,
      totalAmount: addFinancialAmounts(
        row.automaticAmount,
        row.manualAmount,
      ),
    }))
    .filter(
      (row) =>
        row.isFixed ||
        row.isActive ||
        row.automaticAmount !== "0" ||
        row.manualAmount !== "0",
    )
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.name.localeCompare(right.name, "zh-CN") ||
        left.id.localeCompare(right.id),
    );
}

function buildWelfareOneExpenseCategories(
  automaticCategories: MonthlyFinancialAutomaticSnapshot["welfareOneExpenseCategories"],
  manualItems: MonthlyFinancialManualItemInput[],
): MonthlyFinancialWelfareOneExpenseCategory[] {
  return buildWelfareExpenseCategories(
    automaticCategories || [],
    manualItems,
    FIXED_WELFARE_ONE_EXPENSE_CATEGORIES,
    "welfare_one_expense",
    LEGACY_WELFARE_ONE_MANUAL_CATEGORY_CODES,
    automaticCategories === undefined,
  );
}

function buildWelfareTwoExpenseCategories(
  automaticCategories: MonthlyFinancialAutomaticSnapshot["welfareTwoExpenseCategories"],
  manualItems: MonthlyFinancialManualItemInput[],
): MonthlyFinancialWelfareOneExpenseCategory[] {
  return buildWelfareExpenseCategories(
    automaticCategories || [],
    manualItems,
    FIXED_WELFARE_TWO_EXPENSE_CATEGORIES,
    "welfare_two_expense",
    LEGACY_WELFARE_TWO_MANUAL_CATEGORY_CODES,
    automaticCategories === undefined,
  );
}

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
  return addFinancialAmounts(
    left,
    ...rights.map((value) => {
      const decimal = parseDecimal(value);
      return formatDecimal({ units: -decimal.units, scale: decimal.scale });
    }),
  );
}

/** 新分析维度随自动来源一起冻结；旧快照没有此字段仍兼容，已存在但损坏则拒绝。 */
export function isValidFinancialAnalysisMetadata(
  value: unknown,
  sourceType: string,
  detailAmount: string,
): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  if (metadata.schemaVersion !== 1) return false;
  for (const key of [
    "canonicalPersonId",
    "reimbursementCategory",
    "reimbursementScope",
    "reimbursementScopeValue",
    "reimbursementScopePath",
    "reimbursementRegion",
    "reimbursementRegionSource",
    "reimbursementServiceTarget",
    "welfareCategoryId",
    "welfareCategoryCode",
    "welfareCategoryName",
    "contractRootId",
    "partyA",
    "contractRegion",
  ]) {
    const field = metadata[key];
    if (
      field !== undefined &&
      field !== null &&
      (typeof field !== "string" || field.length > 1000)
    )
      return false;
  }
  const regionKeys = [
    "reimbursementScopeValue",
    "reimbursementScopePath",
    "reimbursementRegion",
    "reimbursementRegionSource",
  ];
  if (regionKeys.some((key) => metadata[key] !== undefined)) {
    if (sourceType !== "reimbursement") return false;
    if (
      metadata.reimbursementRegion &&
      ![
        "reimbursementScopeValue",
        "reimbursementScopePath",
        "reimbursementRegionSource",
      ].every(
        (key) =>
          typeof metadata[key] === "string" &&
          Boolean((metadata[key] as string).trim()),
      )
    )
      return false;
  }
  if (
    [
      "welfareCategoryId",
      "welfareCategoryCode",
      "welfareCategoryName",
    ].some((key) => metadata[key] !== undefined)
  ) {
    if (
      sourceType !== "reimbursement" ||
      !["welfareCategoryId", "welfareCategoryCode", "welfareCategoryName"].every(
        (key) =>
          typeof metadata[key] === "string" &&
          Boolean((metadata[key] as string).trim()),
      )
    ) {
      return false;
    }
  }
  if (metadata.payrollParts !== undefined) {
    if (
      sourceType !== "payroll" ||
      !metadata.payrollParts ||
      typeof metadata.payrollParts !== "object" ||
      Array.isArray(metadata.payrollParts)
    )
      return false;
    const parts = metadata.payrollParts as Record<string, unknown>;
    try {
      const values = ["salary", "social", "housing", "adjustment"].map(
        (key) => {
          if (typeof parts[key] !== "string")
            throw new Error("分项金额必须为字符串");
          return normalizeFinancialAmount(parts[key], key === "adjustment");
        },
      );
      return (
        addFinancialAmounts(...values) ===
        normalizeFinancialAmount(detailAmount)
      );
    } catch {
      return false;
    }
  }
  return true;
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
    const voucherReference = String(item.voucherReference || "").trim();
    if (
      category === "general_tax_payment" &&
      (!description || !voucherReference)
    ) {
      throw new Error(`第${index + 1}条实际税费支出必须填写说明和凭证号`);
    }
    const amount = normalizeFinancialAmount(item.amount);
    if (amount === "0") {
      throw new Error(`第${index + 1}条手工项目金额必须大于零`);
    }
    const welfareCategoryId = String(item.welfareCategoryId || "").trim();
    const welfareCategoryNameSnapshot = String(
      item.welfareCategoryNameSnapshot || "",
    ).trim();
    const isDynamicWelfareCategory =
      category === "welfare_one_expense" || category === "welfare_two_expense";
    if (
      isDynamicWelfareCategory &&
      (!welfareCategoryId || !welfareCategoryNameSnapshot)
    ) {
      throw new Error(`第${index + 1}条福利账户手工项目缺少费用分类`);
    }
    if (
      !isDynamicWelfareCategory &&
      (welfareCategoryId || welfareCategoryNameSnapshot)
    ) {
      throw new Error(`第${index + 1}条手工项目不能携带福利账户费用分类`);
    }
    return {
      id: item.id ? String(item.id) : undefined,
      category,
      accountCode,
      direction,
      amount,
      occurredOn,
      description: description || null,
      voucherReference: voucherReference || null,
      welfareCategoryId: welfareCategoryId || null,
      welfareCategoryNameSnapshot: welfareCategoryNameSnapshot || null,
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
  const welfareOneExpenseCategories = buildWelfareOneExpenseCategories(
    input.automatic.welfareOneExpenseCategories,
    manual,
  );
  const welfareTwoExpenseCategories = buildWelfareTwoExpenseCategories(
    input.automatic.welfareTwoExpenseCategories,
    manual,
  );
  const welfareOneAmount = (code: string) =>
    welfareOneExpenseCategories.find((item) => item.code === code)?.totalAmount ||
    "0";
  const legacyWelfareOne407 = sumManualCategory(manual, "welfare_one_407");
  const welfareTwoAmount = (code: string) =>
    welfareTwoExpenseCategories.find((item) => item.code === code)?.totalAmount ||
    "0";
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
    generalTaxPayment: sumManualCategory(manual, "general_tax_payment"),
    welfareOne407: legacyWelfareOne407,
    welfareOneDrinkingWater: welfareOneAmount("drinking_water"),
    welfareOneOffice: subtractFinancialAmounts(
      welfareOneAmount("office"),
      legacyWelfareOne407,
    ),
    welfareOneElectricity: welfareOneAmount("electricity"),
    welfareOne407Ai: welfareOneAmount("407_ai"),
    welfareOne8hAi: welfareOneAmount("8h_ai"),
    welfareTwoRefreshment: welfareTwoAmount("refreshment"),
    welfareTwoTeamBuilding: welfareTwoAmount("team_building"),
    welfareTwoHealthCheck: welfareTwoAmount("physical_exam"),
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
        expenses.generalTaxPayment,
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
        ...welfareOneExpenseCategories.map((item) => item.totalAmount),
      ),
    },
    welfare_two: {
      income: income.welfareTwoSupplementIncome,
      expense: addFinancialAmounts(
        ...welfareTwoExpenseCategories.map((item) => item.totalAmount),
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
    welfareOneExpenseCategories,
    welfareTwoExpenseCategories,
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
