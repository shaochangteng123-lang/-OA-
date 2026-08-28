jest.mock("nanoid", () => ({
  nanoid: jest.fn(() => "monthly-test-id"),
}));

jest.mock("../server/db/index", () => ({
  db: {
    all: jest.fn(),
    get: jest.fn(),
    transaction: jest.fn(),
  },
  pool: {
    query: jest.fn(),
  },
}));

jest.mock("../server/middleware/auth", () => ({
  requireAuth: Object.assign(
    (_req: unknown, _res: unknown, next: () => void) => next(),
    { authRequired: true },
  ),
  requireRole: jest.fn((roles: string[]) => {
    const middleware = (_req: unknown, _res: unknown, next: () => void) =>
      next();
    Object.assign(middleware, { allowedRoles: [...roles] });
    return middleware;
  }),
}));

jest.mock("../server/services/monthlyFinancialBankStatement", () => {
  const actual = jest.requireActual(
    "../server/services/monthlyFinancialBankStatement",
  );
  return {
    ...actual,
    analyzeMonthlyFinancialBankFile: jest.fn(),
    calculateMonthlyBankFileHash: jest.fn(),
  };
});

import fs from "fs";
import os from "os";
import path from "path";
import * as XLSX from "xlsx";
import { db, pool } from "../server/db/index";
import monthlyFinancialReportRouter from "../server/routes/monthly-financial-reports";
import {
  analyzeMonthlyFinancialBankFile,
  calculateMonthlyBankFileHash,
} from "../server/services/monthlyFinancialBankStatement";
import {
  MANUAL_CATEGORY_RULES,
  addFinancialAmounts,
  buildMonthlyFinancialReportView,
  centsToFinancialAmount,
  isValidFinancialDate,
  normalizeFinancialAmount,
  normalizeOpeningBalances,
  previousFinancialMonth,
  subtractFinancialAmounts,
  validateManualItems,
} from "../server/services/monthlyFinancialReport";
import {
  MONTHLY_FINANCIAL_MANUAL_CATEGORIES,
  type MonthlyFinancialAutomaticSnapshot,
  type MonthlyFinancialManualItemInput,
} from "../server/types/monthly-financial-report";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function emptyAutomaticSnapshot(): MonthlyFinancialAutomaticSnapshot {
  return {
    income: {
      mainBusinessReceipts: "0",
      tax: "0",
      marketingReserve: "0",
      businessCost: "0",
      accountingBase: "0",
    },
    expenses: {
      humanCost: "0",
      basicReimbursement: "0",
      largeReimbursement: "0",
      businessReimbursement: "0",
      assetAdministration: "0",
    },
    sources: [],
    details: [],
    generatedAt: "2026-08-20T01:00:00.000Z",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

interface RouterLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{
      handle: ((...args: unknown[]) => unknown) & {
        allowedRoles?: string[];
        authRequired?: boolean;
      };
    }>;
  };
}

function routeLayers(): RouterLayer[] {
  return (
    monthlyFinancialReportRouter as unknown as { stack: RouterLayer[] }
  ).stack.filter((layer) => Boolean(layer.route));
}

function findRoute(
  pathname: string,
  method: string,
): NonNullable<RouterLayer["route"]> {
  const route = routeLayers().find(
    (layer) =>
      layer.route?.path === pathname &&
      layer.route.methods[method.toLowerCase()],
  )?.route;
  if (!route) throw new Error(`未找到月报接口 ${method} ${pathname}`);
  return route;
}

describe("月度财务报表精确金额与分类规则", () => {
  it("启动时将手工项目分类约束升级为包含全部福利分类", () => {
    const databaseSource = source("server/db/index.ts");
    const migrationStart = databaseSource.indexOf(
      "DROP CONSTRAINT IF EXISTS monthly_financial_manual_items_category_check",
    );
    const migrationSection = databaseSource.slice(
      migrationStart,
      migrationStart + 1200,
    );

    expect(migrationStart).toBeGreaterThan(-1);
    for (const category of [
      "welfare_one_supplement",
      "welfare_two_supplement",
      "welfare_one_407",
      "welfare_one_drinking_water",
      "welfare_one_office",
      "welfare_one_electricity",
      "welfare_one_407_ai",
      "welfare_one_8h_ai",
      "welfare_two_refreshment",
      "welfare_two_team_building",
      "welfare_two_physical_exam",
    ]) {
      expect(migrationSection).toContain(`'${category}'`);
    }
  });

  it("自动快照保留薪资和报销人员稳定编号、姓名并返回前端", () => {
    const routeSource = source("server/routes/monthly-financial-reports.ts");
    const typeSource = source("server/types/monthly-financial-report.ts");

    expect(routeSource).toContain("applicant_name");
    expect(routeSource).toContain("personName: row.employee_name");
    expect(routeSource).toContain("personName: row.applicant_name");
    expect(routeSource).toContain("personId: row.employee_id");
    expect(routeSource).toContain("personId: row.user_id");
    expect(routeSource).toContain("payment_business_date::text AS occurred_at");
    expect(routeSource).toContain("payment_business_date >= ?::date");
    expect(routeSource).not.toContain(
      "LEFT(COALESCE(paid_time, pay_time, completed_time), 7)",
    );
    expect(routeSource).toContain('description: "人力成本"');
    expect(routeSource).toContain("automaticDetails: automatic.details");
    expect(routeSource).toContain("hasValidPersonMetadata");
    expect(typeSource).toContain("personId?: string | null");
    expect(typeSource).toContain("personName?: string | null");
  });

  it("一般和商务账户利息与手续费逐笔进入自动明细并保留来源账户", () => {
    const routeSource = source("server/routes/monthly-financial-reports.ts");
    const typeSource = source("server/types/monthly-financial-report.ts");

    expect(routeSource).toContain(
      'row.category !== "interest" && row.category !== "bank_fee"',
    );
    expect(routeSource).toContain(
      "const metric = `${row.account_code}_${row.category}`",
    );
    expect(routeSource).toContain("bankAccountCode: row.account_code");
    expect(routeSource).toContain(
      '!["general", "business"].includes(row.account_code)',
    );
    expect(typeSource).not.toContain("basicInterest: string");
    expect(typeSource).not.toContain("basicBankFee: string");
  });

  it("银行上传和自动同步均重跑报销与工资挂载，重复原件可直接补挂", () => {
    const routeSource = source("server/routes/monthly-financial-reports.ts");
    expect(routeSource).toContain(
      'from "../services/monthlyFinancialReimbursementMatcher.js"',
    );
    expect(
      routeSource.match(/await reconcileMonthlyReimbursementTransactions/gu),
    ).toHaveLength(2);
    expect(routeSource).toContain(
      "const duplicateOnly = candidates.length === 0",
    );
    expect(routeSource).toContain("文件已存在，已重新匹配并挂载业务回单");
    expect(routeSource).toContain("reimbursementReconciliation");
    expect(routeSource).toContain("salaryReconciliation");
  });

  it("自动收入只统计主营业务合同回款", () => {
    const routeSource = source("server/routes/monthly-financial-reports.ts");

    expect(routeSource).toContain(
      "COALESCE(root.category, root.declared_category) = 'main_business'",
    );
    expect(routeSource).not.toContain(
      "COALESCE(root.category, root.declared_category) IN ('main_business', 'non_main')",
    );
  });

  it("严格校验真实日历日期和完整四账户期初余额", () => {
    expect(isValidFinancialDate("2024-02-29")).toBe(true);
    expect(isValidFinancialDate("2026-02-29")).toBe(false);
    expect(isValidFinancialDate("2026-04-31")).toBe(false);
    expect(() =>
      validateManualItems(
        [
          {
            category: "general_interest",
            amount: "1",
            occurredOn: "2026-02-31",
          },
        ],
        "2026-02",
      ),
    ).toThrow("日期必须属于当前月份");
    expect(() =>
      normalizeOpeningBalances({
        general: "1",
        business: "2",
        welfare_one: "3",
      }),
    ).toThrow("四个账户期初余额必须完整提供");
  });

  it("按实际有效小数位标准化并使用精确十进制字符串运算", () => {
    expect(normalizeFinancialAmount("1")).toBe("1");
    expect(normalizeFinancialAmount("1.2")).toBe("1.2");
    expect(normalizeFinancialAmount("1.234567890123")).toBe("1.234567890123");
    expect(centsToFinancialAmount(100)).toBe("1");
    expect(centsToFinancialAmount(123)).toBe("1.23");
    expect(
      addFinancialAmounts("9007199254740991.123456789012", "0.000000000001"),
    ).toBe("9007199254740991.123456789013");
    expect(
      subtractFinancialAmounts("100000000000000000", "0.000000000001"),
    ).toBe("99999999999999999.999999999999");
    expect(previousFinancialMonth("2026-01")).toBe("2025-12");
  });

  it("拒绝超长、负数、前导零及非法金额，不静默截断", () => {
    expect(() => normalizeFinancialAmount("1.1234567890123")).toThrow(
      "金额整数最多18位、小数最多12位",
    );
    expect(() => normalizeFinancialAmount("1234567890123456789")).toThrow(
      "金额整数最多18位、小数最多12位",
    );
    expect(() => normalizeFinancialAmount("01.2")).toThrow(
      "金额整数最多18位、小数最多12位",
    );
    expect(() => normalizeFinancialAmount("-1")).toThrow(
      "金额整数最多18位、小数最多12位",
    );
    expect(() => centsToFinancialAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      "金额分值超出安全范围",
    );
    expect(() =>
      validateManualItems(
        [
          {
            category: "general_interest",
            amount: "0",
            occurredOn: "2026-08-01",
          },
        ],
        "2026-08",
      ),
    ).toThrow("手工项目金额必须大于零");
  });

  it("全部手工分类自动绑定唯一账户与收支方向", () => {
    const input = MONTHLY_FINANCIAL_MANUAL_CATEGORIES.map(
      (category, index) => ({
        category,
        amount: `${index + 1}.123`,
        occurredOn: `2026-08-${String(index + 1).padStart(2, "0")}`,
        description: category === "general_other" ? "其他支出说明" : "",
      }),
    );

    const result = validateManualItems(input, "2026-08");

    expect(result).toHaveLength(MONTHLY_FINANCIAL_MANUAL_CATEGORIES.length);
    result.forEach((item) => {
      const rule = MANUAL_CATEGORY_RULES[item.category];
      expect(item.accountCode).toBe(rule.accountCode);
      expect(item.direction).toBe(rule.direction);
    });
    expect(
      result.find((item) => item.category === "general_bank_fee"),
    ).toMatchObject({ accountCode: "general", direction: "expense" });
    expect(
      result.find((item) => item.category === "business_bank_fee"),
    ).toMatchObject({ accountCode: "business", direction: "expense" });
  });

  it("拒绝篡改分类账户、方向、所属月份及其他支出说明", () => {
    expect(() =>
      validateManualItems(
        [
          {
            category: "general_interest",
            accountCode: "business",
            direction: "income",
            amount: "1",
            occurredOn: "2026-08-01",
          },
        ],
        "2026-08",
      ),
    ).toThrow("账户或收支方向与分类不一致");

    expect(() =>
      validateManualItems(
        [
          {
            category: "business_interest",
            accountCode: "business",
            direction: "expense",
            amount: "1",
            occurredOn: "2026-08-01",
          },
        ],
        "2026-08",
      ),
    ).toThrow("账户或收支方向与分类不一致");

    expect(() =>
      validateManualItems(
        [
          {
            category: "general_interest",
            amount: "1",
            occurredOn: "2026-07-31",
          },
        ],
        "2026-08",
      ),
    ).toThrow("日期必须属于当前月份");

    expect(() =>
      validateManualItems(
        [
          {
            category: "general_other",
            amount: "1",
            occurredOn: "2026-08-01",
            description: "   ",
          },
        ],
        "2026-08",
      ),
    ).toThrow("其他支出必须填写说明");
  });
});

describe("月度财务报表账户公式", () => {
  const manualItems = validateManualItems(
    [
      {
        category: "general_interest",
        amount: "1.25",
        occurredOn: "2026-08-01",
      },
      {
        category: "business_interest",
        amount: "0.75",
        occurredOn: "2026-08-02",
      },
      { category: "general_bank_fee", amount: "0.5", occurredOn: "2026-08-03" },
      {
        category: "business_bank_fee",
        amount: "0.25",
        occurredOn: "2026-08-04",
      },
      {
        category: "general_other",
        amount: "1",
        occurredOn: "2026-08-05",
        description: "其他支出",
      },
      {
        category: "welfare_one_supplement",
        amount: "5",
        occurredOn: "2026-08-06",
      },
      { category: "welfare_one_407", amount: "1", occurredOn: "2026-08-07" },
      {
        category: "welfare_one_drinking_water",
        amount: "0.1",
        occurredOn: "2026-08-07",
      },
      {
        category: "welfare_one_office",
        amount: "0.2",
        occurredOn: "2026-08-07",
      },
      {
        category: "welfare_one_electricity",
        amount: "0.3",
        occurredOn: "2026-08-07",
      },
      { category: "welfare_one_407_ai", amount: "2", occurredOn: "2026-08-08" },
      { category: "welfare_one_8h_ai", amount: "3", occurredOn: "2026-08-09" },
      {
        category: "welfare_two_supplement",
        amount: "6",
        occurredOn: "2026-08-10",
      },
      {
        category: "welfare_two_refreshment",
        amount: "1.1",
        occurredOn: "2026-08-11",
      },
      {
        category: "welfare_two_team_building",
        amount: "2.2",
        occurredOn: "2026-08-12",
      },
      {
        category: "welfare_two_physical_exam",
        amount: "3.3",
        occurredOn: "2026-08-13",
      },
    ],
    "2026-08",
  );

  function report(
    items: MonthlyFinancialManualItemInput[] = manualItems,
    bank?: MonthlyFinancialAutomaticSnapshot["bank"],
  ) {
    return buildMonthlyFinancialReportView({
      id: "report-1",
      month: "2026-08",
      status: "draft",
      version: 1,
      openingBalances: {
        general: "1000",
        business: "200",
        welfare_one: "50",
        welfare_two: "60",
      },
      automatic: {
        ...emptyAutomaticSnapshot(),
        income: {
          mainBusinessReceipts: "160",
          tax: "10",
          marketingReserve: "20",
          businessCost: "30",
          accountingBase: "100",
        },
        expenses: {
          humanCost: "10",
          basicReimbursement: "5",
          largeReimbursement: "2",
          businessReimbursement: "4",
          assetAdministration: "3",
        },
        bank,
      },
      manualItems: items,
      lastRefreshedAt: null,
      closedAt: null,
      updatedAt: null,
      canMaintain: true,
    });
  }

  it("四账户均按期初加收入减支出计算", () => {
    const result = report();
    const accounts = Object.fromEntries(
      result.accounts.map((account) => [account.code, account]),
    );

    expect(accounts.general).toMatchObject({
      openingBalance: "1000",
      income: "101.25",
      expense: "21.5",
      closingBalance: "1079.75",
    });
    expect(accounts.business).toMatchObject({
      openingBalance: "200",
      income: "50.75",
      expense: "4.25",
      closingBalance: "246.5",
    });
    expect(accounts.welfare_one).toMatchObject({
      openingBalance: "50",
      income: "5",
      expense: "6.6",
      closingBalance: "48.4",
    });
    expect(result.expenses).toMatchObject({
      welfareOneDrinkingWater: "0.1",
      welfareOneOffice: "0.2",
      welfareOneElectricity: "0.3",
    });
    expect(accounts.welfare_two).toMatchObject({
      openingBalance: "60",
      income: "6",
      expense: "6.6",
      closingBalance: "59.4",
    });
  });

  it("一般及商务手续费分别只进入对应账户支出一次", () => {
    const withFees = report();
    const withoutFees = report(
      manualItems.filter(
        (item) =>
          item.category !== "general_bank_fee" &&
          item.category !== "business_bank_fee",
      ),
    );
    const account = (
      value: ReturnType<typeof report>,
      code: "general" | "business",
    ) => value.accounts.find((item) => item.code === code)!;

    expect(
      subtractFinancialAmounts(
        account(withoutFees, "general").closingBalance,
        account(withFees, "general").closingBalance,
      ),
    ).toBe("0.5");
    expect(
      subtractFinancialAmounts(
        account(withoutFees, "business").closingBalance,
        account(withFees, "business").closingBalance,
      ),
    ).toBe("0.25");
    expect(withFees.expenses.generalBankFee).toBe("0.5");
    expect(withFees.expenses.businessBankFee).toBe("0.25");
  });

  it("一般和商务银行来源活跃后覆盖各自手工利息手续费且只计一次", () => {
    const bankControlled = report(manualItems, {
      activeAccounts: ["basic", "general", "business"],
      chargeAccounts: ["general", "business"],
      generalInterest: "103.69",
      businessInterest: "36.65",
      generalBankFee: "18",
      businessBankFee: "0",
      internalTransferTotal: "0",
      partialAccounts: [],
      reviewRequiredCount: 0,
      unclassifiedCount: 0,
      conflictCount: 0,
      updatedAt: "2026-08-25T00:00:00.000Z",
    });

    expect(bankControlled.income).toMatchObject({
      generalInterest: "103.69",
      businessInterest: "36.65",
    });
    expect(bankControlled.expenses).toMatchObject({
      generalBankFee: "18",
      businessBankFee: "0",
    });
    expect(
      bankControlled.accounts.find((item) => item.code === "general"),
    ).toMatchObject({ income: "203.69", expense: "39" });
    expect(
      bankControlled.accounts.find((item) => item.code === "business"),
    ).toMatchObject({ income: "86.65", expense: "4" });
  });

  it("部分文件只接管安全利息手续费且不影响另一账户手工来源", () => {
    const partialCharges = report(manualItems, {
      activeAccounts: [],
      chargeAccounts: ["general"],
      generalInterest: "103.69",
      businessInterest: "0",
      generalBankFee: "18",
      businessBankFee: "0",
      internalTransferTotal: "0",
      partialAccounts: ["general"],
      reviewRequiredCount: 1,
      unclassifiedCount: 0,
      conflictCount: 0,
      updatedAt: "2026-08-25T00:00:00.000Z",
    });

    expect(partialCharges.income.generalInterest).toBe("103.69");
    expect(partialCharges.expenses.generalBankFee).toBe("18");
    expect(partialCharges.income.businessInterest).toBe("0.75");
    expect(partialCharges.expenses.businessBankFee).toBe("0.25");
    expect(
      partialCharges.accounts.find((item) => item.code === "general"),
    ).toMatchObject({ income: "203.69", expense: "39" });
    expect(
      partialCharges.accounts.find((item) => item.code === "business"),
    ).toMatchObject({ income: "50.75", expense: "4.25" });
  });
});

describe("月度财务报表月结、重开与快照安全", () => {
  function responseMock() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
      send: jest.fn(),
    };
  }

  function requestMock(month: string, body: Record<string, unknown> = {}) {
    return {
      params: { month },
      body,
      session: {
        user: { id: "admin-1", role: "admin", name: "管理员甲" },
      },
    };
  }

  function reportRow(input: Partial<Record<string, unknown>> = {}) {
    return {
      id: "report-1",
      report_month: "2026-08",
      status: "draft",
      version: 3,
      opening_balances_json: {
        general: "100",
        business: "20",
        welfare_one: "3",
        welfare_two: "4",
      },
      automatic_snapshot_json: emptyAutomaticSnapshot(),
      closing_balances_json: null,
      last_refreshed_at: "2026-08-20T01:00:00.000Z",
      closed_at: null,
      closed_by_name: null,
      reopened_at: null,
      updated_at: "2026-08-20T01:00:00.000Z",
      ...input,
    };
  }

  it("顶部收入按主营业务银行实际到账总额展示而非税后账户分配额", async () => {
    const automatic = {
      ...emptyAutomaticSnapshot(),
      income: {
        mainBusinessReceipts: "100000",
        tax: "11720",
        marketingReserve: "4414",
        businessCost: "8386.6",
        accountingBase: "75479.4",
      },
    };
    (db.get as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_reports report")) {
        return reportRow({ automatic_snapshot_json: automatic });
      }
      return undefined;
    });
    (db.all as jest.Mock).mockResolvedValue([]);
    const route = findRoute("/:month", "get");
    const response = responseMock();

    await route.stack.at(-1)!.handle(requestMock("2026-08"), response);

    expect(response.status).not.toHaveBeenCalled();
    const payload = response.json.mock.calls[0][0];
    expect(payload.data.income.mainReceipt).toBe("100000");
    expect(payload.data.totals.income).toBe("100000");
    expect(payload.data.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "general", inflow: "75479.4" }),
        expect.objectContaining({ code: "business", inflow: "12800.6" }),
      ]),
    );
  });

  it("开放报表实时叠加银行待复核状态并禁用月结入口", async () => {
    const automatic: MonthlyFinancialAutomaticSnapshot = {
      ...emptyAutomaticSnapshot(),
      bank: {
        activeAccounts: ["general"],
        generalInterest: "0",
        businessInterest: "0",
        generalBankFee: "0",
        businessBankFee: "0",
        internalTransferTotal: "0",
        partialAccounts: [],
        reviewRequiredCount: 0,
        unclassifiedCount: 0,
        conflictCount: 0,
        updatedAt: "2026-08-20T01:00:00.000Z",
      },
    };
    (db.get as jest.Mock).mockImplementation(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (sql.includes("FROM monthly_financial_reports report")) {
        return reportRow({ automatic_snapshot_json: automatic });
      }
      if (sql.includes("AS review_required_count")) {
        return {
          review_required_count: 1,
          unclassified_count: 0,
          conflict_count: 0,
        };
      }
      return undefined;
    });
    (db.all as jest.Mock).mockImplementation(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (
        sql.includes("SELECT account_code, recognition_status") &&
        sql.includes("FROM monthly_financial_bank_files")
      ) {
        return [{ account_code: "general", recognition_status: "partial" }];
      }
      return [];
    });
    const route = findRoute("/:month", "get");
    const response = responseMock();

    await route.stack.at(-1)!.handle(requestMock("2026-08"), response);

    const payload = response.json.mock.calls[0]?.[0] as {
      data: {
        validations: {
          canClose: boolean;
          blockers: Array<{ code: string; message: string }>;
        };
        permissions: { canClose: boolean };
      };
    };
    expect(payload.data.validations.canClose).toBe(false);
    expect(payload.data.permissions.canClose).toBe(false);
    expect(payload.data.validations.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MONTHLY_BANK_REVIEW_REQUIRED" }),
      ]),
    );
  });

  it("未持久化月份明确阻断月结", async () => {
    (db.get as jest.Mock).mockResolvedValue(undefined);
    (db.all as jest.Mock).mockResolvedValue([]);
    const route = findRoute("/:month", "get");
    const response = responseMock();

    await route.stack.at(-1)!.handle(requestMock("2026-08"), response);

    expect(response.status).not.toHaveBeenCalled();
    const payload = response.json.mock.calls[0][0];
    expect(payload.data.validations).toMatchObject({ canClose: false });
    expect(payload.data.validations.blockers).toContainEqual({
      code: "REPORT_NOT_PERSISTED",
      message: "请先保存或同步本月报表后再月结",
    });
  });

  it("已月结版本缺少快照时失败关闭且不实时重算", async () => {
    const closed = reportRow({
      status: "closed",
      closing_balances_json: {
        general: "100",
        business: "20",
        welfare_one: "3",
        welfare_two: "4",
      },
      closed_at: "2026-08-20T02:00:00.000Z",
    });
    (db.get as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_reports report")) return closed;
      return undefined;
    });
    (db.all as jest.Mock).mockResolvedValue([]);
    const route = findRoute("/:month", "get");
    const response = responseMock();

    await route.stack.at(-1)!.handle(requestMock("2026-08"), response);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "MONTHLY_FINANCE_DATA_INTEGRITY_ERROR",
      }),
    );
    expect(db.all).not.toHaveBeenCalled();
  });

  it("兼容读取旧版未月结快照中缺少人员展示元数据的明细", async () => {
    const legacyAutomatic: MonthlyFinancialAutomaticSnapshot = {
      ...emptyAutomaticSnapshot(),
      details: [
        {
          sourceType: "payroll",
          sourceId: "legacy-payroll-1",
          occurredOn: "2026-08-01",
          accountCode: "general",
          metric: "human_cost",
          amount: "100",
          description: "人力成本",
        },
      ],
    };
    const reopened = reportRow({
      status: "reopened",
      version: 6,
      automatic_snapshot_json: legacyAutomatic,
    });
    (db.get as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_reports report"))
        return reopened;
      return undefined;
    });
    (db.all as jest.Mock).mockResolvedValue([]);
    const route = findRoute("/:month", "get");
    const response = responseMock();

    await route.stack.at(-1)!.handle(requestMock("2026-08"), response);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json.mock.calls[0][0].data.automaticDetails).toHaveLength(
      1,
    );
  });

  it("手工项按编号差异更新并记录变更摘要，不再全量删除重建", async () => {
    const current = reportRow();
    const oldManualRow = {
      id: "manual-existing",
      category: "general_interest",
      account_code: "general",
      direction: "income",
      amount: "1",
      occurred_on: "2026-08-01",
      description: null,
      voucher_reference: null,
    };
    let auditChanges: Record<string, unknown> | undefined;
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM monthly_financial_reports report")) {
          return { rows: [current] };
        }
        if (sql.includes("WHERE report_month <")) return { rows: [] };
        if (sql.includes("WHERE report_month >")) return { rows: [] };
        if (sql.includes("FROM monthly_financial_manual_items")) {
          return { rows: [oldManualRow] };
        }
        if (
          sql.includes("INSERT INTO monthly_financial_audit_logs") &&
          params?.[3] === "save_manual_items"
        ) {
          auditChanges = JSON.parse(String(params[6]));
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementation(
      async (callback: (client: typeof client) => Promise<unknown>) =>
        callback(client),
    );
    (db.get as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_reports report")) {
        return reportRow({ version: 4 });
      }
      return undefined;
    });
    (db.all as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_manual_items")) {
        return [
          { ...oldManualRow, amount: "2" },
          {
            ...oldManualRow,
            id: "mfmi_monthly-test-id",
            amount: "3",
            occurred_on: "2026-08-02",
          },
        ];
      }
      return [];
    });
    const route = findRoute("/:month/manual-items", "put");
    const response = responseMock();

    await route.stack.at(-1)!.handle(
      requestMock("2026-08", {
        expectedVersion: 3,
        openingBalances: current.opening_balances_json,
        items: [
          {
            id: "manual-existing",
            category: "general_interest",
            amount: "2",
            occurredOn: "2026-08-01",
          },
          {
            category: "general_interest",
            amount: "3",
            occurredOn: "2026-08-02",
          },
        ],
      }),
      response,
    );

    expect(response.status).not.toHaveBeenCalled();
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE monthly_financial_manual_items"),
      ),
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes(
          "DELETE FROM monthly_financial_manual_items WHERE report_id = $1",
        ),
      ),
    ).toBe(false);
    expect(auditChanges?.manualItemChanges).toMatchObject({
      beforeCount: 1,
      afterCount: 2,
      beforeTotal: "1",
      afterTotal: "5",
      addedIds: ["mfmi_monthly-test-id"],
      changedIds: ["manual-existing"],
    });
  });

  it("非首月保存手工项不要求客户端重复提交期初余额", async () => {
    const current = reportRow({ report_month: "2026-08", version: 3 });
    const previousClosing = {
      general: "88",
      business: "22",
      welfare_one: "3",
      welfare_two: "4",
    };
    const previous = reportRow({
      id: "report-july",
      report_month: "2026-07",
      status: "closed",
      version: 2,
      closing_balances_json: previousClosing,
    });
    let savedOpeningBalances: Record<string, string> | undefined;
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM monthly_financial_reports report")) {
          return { rows: [current] };
        }
        if (sql.includes("WHERE report_month <")) return { rows: [previous] };
        if (sql.includes("WHERE report_month >")) return { rows: [] };
        if (sql.includes("FROM monthly_financial_manual_items")) {
          return { rows: [] };
        }
        if (sql.includes("UPDATE monthly_financial_reports")) {
          savedOpeningBalances = JSON.parse(String(params?.[1]));
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementation(
      async (callback: (client: typeof client) => Promise<unknown>) =>
        callback(client),
    );
    (db.get as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_reports report")) {
        return reportRow({ report_month: "2026-08", version: 4 });
      }
      if (sql.includes("WHERE report_month <")) return previous;
      return undefined;
    });
    (db.all as jest.Mock).mockResolvedValue([]);
    const route = findRoute("/:month/manual-items", "put");
    const response = responseMock();

    await route.stack
      .at(-1)!
      .handle(
        requestMock("2026-08", { expectedVersion: 3, items: [] }),
        response,
      );

    expect(response.status).not.toHaveBeenCalled();
    expect(savedOpeningBalances).toEqual(previousClosing);
  });

  it("月结在同一可串行化事务内读取全部来源、手工项并写入快照", async () => {
    const current = reportRow();
    let storedSnapshot: Record<string, unknown> | undefined;
    const client = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM monthly_financial_reports report")) {
          return { rows: [current] };
        }
        if (sql.includes("WHERE report_month <")) return { rows: [] };
        if (
          sql.includes("FROM contract_receipts") ||
          sql.includes("FROM payroll_records") ||
          sql.includes("FROM reimbursements") ||
          sql.includes("FROM contract_payments") ||
          sql.includes("FROM monthly_financial_manual_items")
        ) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO monthly_financial_snapshots")) {
          storedSnapshot = JSON.parse(String(params?.[4]));
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementation(
      async (callback: (client: typeof client) => Promise<unknown>) =>
        callback(client),
    );
    (db.get as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_reports report")) {
        return reportRow({
          status: "closed",
          version: 4,
          closing_balances_json: {
            general: "100",
            business: "20",
            welfare_one: "3",
            welfare_two: "4",
          },
          closed_at: "2026-08-20T02:00:00.000Z",
          closed_by_name: "管理员甲",
        });
      }
      if (sql.includes("FROM monthly_financial_snapshots")) {
        return { snapshot_json: storedSnapshot };
      }
      return undefined;
    });
    const route = findRoute("/:month/close", "post");
    const response = responseMock();

    await route.stack
      .at(-1)!
      .handle(requestMock("2026-08", { expectedVersion: 3 }), response);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: "月结完成" }),
    );
    const sqls = client.query.mock.calls.map(([sql]) => String(sql));
    expect(sqls[0]).toBe("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    expect(sqls).toEqual(
      expect.arrayContaining([
        expect.stringContaining("FROM contract_receipts"),
        expect.stringContaining("FROM payroll_records"),
        expect.stringContaining("FROM reimbursements"),
        expect.stringContaining("FROM contract_payments"),
        expect.stringContaining("FROM monthly_financial_manual_items"),
        expect.stringContaining("INSERT INTO monthly_financial_snapshots"),
      ]),
    );
    expect(storedSnapshot).toBeDefined();
  });

  it.each([
    [
      "活动银行文件为部分识别",
      [
        {
          account_code: "general",
          recognition_status: "partial",
          updated_at: "2026-08-24T01:00:00.000Z",
        },
      ],
      { review_required_count: 0, unclassified_count: 0, conflict_count: 0 },
    ],
    [
      "仍有待复核交易",
      [
        {
          account_code: "general",
          recognition_status: "recognized",
          updated_at: "2026-08-24T01:00:00.000Z",
        },
      ],
      { review_required_count: 1, unclassified_count: 0, conflict_count: 0 },
    ],
  ])("%s时服务端拒绝月结且不写快照", async (_label, bankFiles, bankIssues) => {
    const current = reportRow();
    const client = {
      query: jest.fn(async (sqlValue: string) => {
        const sql = String(sqlValue);
        if (sql.includes("FROM monthly_financial_reports report")) {
          return { rows: [current] };
        }
        if (sql.includes("WHERE report_month <")) return { rows: [] };
        if (
          sql.includes("SELECT account_code, recognition_status, updated_at") &&
          sql.includes("FROM monthly_financial_bank_files")
        ) {
          return { rows: bankFiles };
        }
        if (sql.includes("AS review_required_count")) {
          return { rows: [bankIssues] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementation(
      async (callback: (client: typeof client) => Promise<unknown>) =>
        callback(client),
    );
    const route = findRoute("/:month/close", "post");
    const response = responseMock();

    await route.stack
      .at(-1)!
      .handle(requestMock("2026-08", { expectedVersion: 3 }), response);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "MONTHLY_BANK_REVIEW_REQUIRED",
      }),
    );
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO monthly_financial_snapshots"),
      ),
    ).toBe(false);
  });

  it("上传存在待复核交易时在持久化前拒绝，不替换旧活动文件", async () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "monthly-bank-review-upload-"),
    );
    const filePath = path.join(temporaryRoot, "一般账户.pdf");
    fs.writeFileSync(filePath, "%PDF-1.4\n%%EOF\n");
    const fileHash = "a".repeat(64);
    (calculateMonthlyBankFileHash as jest.Mock).mockResolvedValue(fileHash);
    (analyzeMonthlyFinancialBankFile as jest.Mock).mockResolvedValue({
      originalName: "一般账户.pdf",
      fileHash,
      accountCode: "general",
      accountNumber: "0200303519000018418",
      filenameAccountHint: "general",
      pageCount: 1,
      skippedBlankPages: [],
      transactionMonths: [],
      requiresMixedMonthConfirmation: false,
      warnings: [],
      transactions: [
        {
          pageNo: 1,
          position: "full",
          previewPath: "review.jpg",
          electronicReceiptNo: "TEST-REVIEW-001",
          normalizedElectronicReceiptNo: "TESTREVIEW001",
          transactionDate: "",
          transactionMonth: "",
          amount: 100,
          payer: "测试付款人",
          payerAccount: "0200303519000018418",
          payee: "测试收款人",
          payeeAccount: "6222000000000000001",
          remark: "主营回款",
          direction: "outflow",
          category: "main_income",
          isInternalTransfer: false,
          includeInReport: false,
          recognitionStatus: "review_required",
          warnings: ["未识别到银行实际交易日期"],
          rawTextHash: "b".repeat(64),
        },
      ],
    });
    (db.get as jest.Mock).mockResolvedValue(undefined);
    const route = findRoute("/:month/bank-receipts", "post");
    const response = responseMock();
    const request = {
      params: { month: "2026-08" },
      body: { expectedVersion: "3", mixedMonthConfirmed: "false" },
      files: [
        {
          fieldname: "files",
          originalname: "一般账户.pdf",
          encoding: "7bit",
          mimetype: "application/pdf",
          size: fs.statSync(filePath).size,
          destination: temporaryRoot,
          filename: path.basename(filePath),
          path: filePath,
          buffer: Buffer.alloc(0),
        },
      ],
      session: {
        user: { id: "admin-1", role: "admin", name: "管理员甲" },
      },
    };

    try {
      await route.stack.at(-1)!.handle(request, response);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: "MONTHLY_BANK_REVIEW_REQUIRED",
        message: expect.stringContaining("未替换当前月报文件"),
      }),
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("管理员可填写原因排除冲正后的待复核交易并重新计算月报", async () => {
    const current = reportRow();
    const client = {
      query: jest.fn(async (sqlValue: string) => {
        const sql = String(sqlValue);
        if (sql.includes("SELECT role, status FROM users")) {
          return { rows: [{ role: "admin", status: "active" }] };
        }
        if (sql.includes("FROM monthly_financial_reports report")) {
          return { rows: [current] };
        }
        if (
          sql.includes(
            "FROM monthly_financial_bank_transactions bank_transaction",
          )
        ) {
          return {
            rows: [
              {
                id: "bank-review-1",
                current_file_id: "bank-file-1",
                recognition_status: "review_required",
                include_in_report: false,
              },
            ],
          };
        }
        if (sql.includes("AS review_required_count")) {
          return {
            rows: [
              {
                review_required_count: 0,
                unclassified_count: 0,
                conflict_count: 0,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementation(
      async (callback: (client: typeof client) => Promise<unknown>) =>
        callback(client),
    );
    (db.get as jest.Mock).mockImplementation(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (sql.includes("FROM monthly_financial_reports report")) {
        return reportRow({ version: 4 });
      }
      if (sql.includes("AS review_required_count")) {
        return {
          review_required_count: 0,
          unclassified_count: 0,
          conflict_count: 0,
        };
      }
      return undefined;
    });
    (db.all as jest.Mock).mockResolvedValue([]);
    const route = findRoute(
      "/:month/bank-transactions/:transactionId/review",
      "post",
    );
    const response = responseMock();
    const request = {
      ...requestMock("2026-08", {
        expectedVersion: 3,
        action: "exclude",
        reason: "原合同登记已冲正，确认不计入本月经营收支",
      }),
      params: { month: "2026-08", transactionId: "bank-review-1" },
    };

    await route.stack.at(-1)!.handle(request, response);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "待复核银行交易已排除，月报已重新计算",
      }),
    );
    const sqls = client.query.mock.calls.map(([sql]) => String(sql));
    expect(sqls).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "SET category = 'ignored', recognition_status = 'ignored'",
        ),
        expect.stringContaining("管理员已复核排除冲正交易"),
      ]),
    );
    expect(
      client.query.mock.calls.some(([, params]) =>
        JSON.stringify(params || []).includes(
          "monthly_bank_transaction_review",
        ),
      ),
    ).toBe(true);
  });

  it("重开历史月会级联失效后续已月结月份并保留旧快照", async () => {
    const may = reportRow({
      id: "report-may",
      report_month: "2026-05",
      status: "closed",
      version: 2,
    });
    const june = reportRow({
      id: "report-june",
      report_month: "2026-06",
      status: "closed",
      version: 4,
    });
    const july = reportRow({
      id: "report-july",
      report_month: "2026-07",
      status: "draft",
      version: 1,
    });
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("WHERE report_month >=")) {
          return { rows: [may, june, july] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementation(
      async (callback: (client: typeof client) => Promise<unknown>) =>
        callback(client),
    );
    (db.get as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_reports report")) {
        return {
          ...may,
          status: "reopened",
          version: 3,
          closing_balances_json: null,
          closed_at: null,
          automatic_snapshot_json: emptyAutomaticSnapshot(),
        };
      }
      return undefined;
    });
    (db.all as jest.Mock).mockResolvedValue([]);
    const route = findRoute("/:month/reopen", "post");
    const response = responseMock();

    await route.stack.at(-1)!.handle(
      requestMock("2026-05", {
        expectedVersion: 2,
        reason: "补录五月支出",
      }),
      response,
    );

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json.mock.calls[0][0].affectedMonths).toEqual([
      "2026-05",
      "2026-06",
    ]);
    const updates = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes("UPDATE monthly_financial_reports"),
    );
    expect(updates).toHaveLength(2);
    expect(updates.map((call) => call[1]?.[0])).toEqual([
      "report-may",
      "report-june",
    ]);
    expect(
      client.query.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM monthly_financial_snapshots"),
      ),
    ).toBe(false);
  });

  it("补建早于既有月结月份的报表时自动失效后续承接链", async () => {
    const august = reportRow({
      id: "report-august",
      report_month: "2026-08",
      status: "closed",
      version: 5,
    });
    const createdJuly = reportRow({
      id: "monthly-test-id",
      report_month: "2026-07",
      status: "draft",
      version: 1,
      automatic_snapshot_json: emptyAutomaticSnapshot(),
    });
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("FROM monthly_financial_reports report")) {
          return { rows: [] };
        }
        if (sql.includes("WHERE report_month <")) return { rows: [] };
        if (sql.includes("WHERE report_month >")) return { rows: [august] };
        if (
          sql.includes("FROM contract_receipts") ||
          sql.includes("FROM payroll_records") ||
          sql.includes("FROM reimbursements") ||
          sql.includes("FROM contract_payments")
        ) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };
    (db.transaction as jest.Mock).mockImplementation(
      async (callback: (client: typeof client) => Promise<unknown>) =>
        callback(client),
    );
    (db.get as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_reports report")) {
        return createdJuly;
      }
      return undefined;
    });
    (db.all as jest.Mock).mockResolvedValue([]);
    const route = findRoute("/:month/refresh", "post");
    const response = responseMock();

    await route.stack
      .at(-1)!
      .handle(requestMock("2026-07", { expectedVersion: 0 }), response);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json.mock.calls[0][0].affectedMonths).toEqual(["2026-08"]);
    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("UPDATE monthly_financial_reports") &&
          params?.[0] === "report-august",
      ),
    ).toBe(true);
  });
});

describe("月报银行交易关联状态与受控裁片预览", () => {
  function previewResponseMock() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      sendFile: jest.fn().mockReturnThis(),
    };
  }

  it("分别返回员工匹配与报销关联，并保留旧关联状态", async () => {
    (db.all as jest.Mock).mockImplementation(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (sql.includes("SELECT file.id, file.account_code")) {
        return [
          {
            id: "bank-file-1",
            account_code: "basic",
            original_name: "基本账户.pdf",
            file_hash: "bank-hash-1",
            file_version: 1,
            page_count: 1,
            recognized_receipt_count: 1,
            included_receipt_count: 1,
            recognition_status: "recognized",
            charge_eligible: false,
            detected_months_json: ["2026-08"],
            warnings_json: [],
            anomalies_json: [],
            uploaded_by: "admin-1",
            uploader_name: "管理员甲",
            recognized_at: "2026-08-25T01:00:00.000Z",
            updated_at: "2026-08-25T01:00:00.000Z",
          },
        ];
      }
      if (sql.includes("SELECT transaction.id, transaction.account_code")) {
        const matchedTransaction = {
          id: "bank-transaction-1",
          account_code: "basic",
          electronic_receipt_no: "BANK-001",
          transaction_date: "2026-08-20",
          amount: "88.5",
          direction: "outflow",
          payer_name: "公司",
          payer_account: "company-account",
          payee_name: "申请人甲",
          payee_account: "employee-account",
          remark: "基础报销-申请人甲",
          page_number: 1,
          receipt_position: "full",
          category: "basic_reimbursement",
          recognition_status: "recognized",
          file_recognition_status: "recognized",
          include_in_report: true,
          warnings_json: [],
          link_warnings: [],
          occurrence_account_codes: [],
          employee_match_status: "matched",
          employee_id: "employee-1",
          employee_name: "申请人甲",
          reimbursement_link_status: "matched",
          reimbursement_link_warnings: [],
          link_status: "matched",
        };
        return [
          matchedTransaction,
          {
            ...matchedTransaction,
            id: "bank-transaction-2",
            electronic_receipt_no: "BANK-002",
            remark: "基础报销-申请人乙",
            payee_name: "申请人乙",
            employee_id: "employee-2",
            employee_name: "申请人乙",
          },
        ];
      }
      if (
        sql.includes(
          "SELECT DISTINCT ON (link.transaction_id, reimbursement.id)",
        )
      ) {
        return [
          {
            transaction_id: "bank-transaction-1",
            reimbursement_id: "reimbursement-1",
            type: "basic",
            title: "八月差旅报销",
            user_id: "user-1",
            applicant_name: "申请人甲",
            status: "completed",
            total_amount: "88.5",
            allocated_amount: "88.5",
            display_action: "replaced",
            payment_batch_id: "payment-batch-1",
            original_payment_proof_path:
              "uploads/invoices/payment-proof-old.png",
          },
          {
            transaction_id: "bank-transaction-2",
            reimbursement_id: "reimbursement-2",
            type: "basic",
            title: "八月办公报销",
            user_id: "user-2",
            applicant_name: "申请人乙",
            status: "completed",
            total_amount: "88.5",
            allocated_amount: "88.5",
            display_action: "attached",
            payment_batch_id: "payment-batch-1",
            original_payment_proof_path: null,
          },
        ];
      }
      if (sql.includes("SELECT file_hash")) {
        return [{ file_hash: "bank-hash-1" }];
      }
      return [];
    });

    const route = findRoute("/:month/bank-receipts", "get");
    const response = previewResponseMock();
    await route.stack.at(-1)!.handle(
      {
        params: { month: "2026-08" },
        session: {
          user: { id: "admin-1", role: "admin", name: "管理员甲" },
        },
      },
      response,
    );

    const linkedQuery = (db.all as jest.Mock).mock.calls
      .map(([sql]) => String(sql))
      .find((sql) =>
        sql.includes(
          "SELECT DISTINCT ON (link.transaction_id, reimbursement.id)",
        ),
      );
    expect(linkedQuery).toContain(
      "link.match_key_json ->> 'previousPaymentProofPath'",
    );
    expect(linkedQuery).toContain("link.match_key_json ->> 'displayAction'");
    expect(linkedQuery).not.toContain("reimbursement.payment_proof_path");
    expect(linkedQuery).not.toContain("payment_batch.payment_proof_path");

    const transaction = response.json.mock.calls[0][0].data.accounts.find(
      (account: { accountCode: string }) => account.accountCode === "basic",
    ).transactions[0];
    expect(transaction).toMatchObject({
      linkStatus: "matched",
      employeeMatch: {
        status: "matched",
        employeeId: "employee-1",
        employeeName: "申请人甲",
      },
      reimbursementLink: {
        status: "matched",
        displayAction: "replaced",
        reasons: [],
      },
    });
    expect(transaction.reimbursementLink.linkedReimbursements).toEqual([
      expect.objectContaining({
        id: "reimbursement-1",
        applicantId: "user-1",
        allocatedAmount: "88.5",
        detailUrl: "/basic-reimbursement/reimbursement-1",
        originalProofPreviewUrl:
          "/api/monthly-financial-reports/bank-transactions/bank-transaction-1/reimbursements/reimbursement-1/previous-proof",
        bankProofPreviewUrl:
          "/api/monthly-financial-reports/bank-transactions/bank-transaction-1/preview?accountCode=basic",
        effectiveProofPreviewUrl:
          "/api/monthly-financial-reports/bank-transactions/bank-transaction-1/preview?accountCode=basic",
      }),
    ]);
    const attachedTransaction = response.json.mock.calls[0][0].data.accounts
      .find(
        (account: { accountCode: string }) => account.accountCode === "basic",
      )
      .transactions.find(
        (item: { id: string }) => item.id === "bank-transaction-2",
      );
    expect(attachedTransaction.reimbursementLink).toMatchObject({
      status: "matched",
      displayAction: "attached",
      linkedReimbursements: [
        expect.objectContaining({
          id: "reimbursement-2",
          originalProofPreviewUrl: null,
          effectiveProofPreviewUrl:
            "/api/monthly-financial-reports/bank-transactions/bank-transaction-2/preview?accountCode=basic",
        }),
      ],
    });
  });

  it("仅允许报销申请人或原月报读角色预览裁片，并拒绝路径逃逸", async () => {
    const previewRoot = path.join(
      process.cwd(),
      "uploads",
      "monthly-financial-bank",
      "recognized",
    );
    const temporaryDirectory = fs.mkdtempSync(
      path.join(previewRoot, "access-test-"),
    );
    const previewPath = path.join(temporaryDirectory, "receipt.jpg");
    fs.writeFileSync(previewPath, "preview");
    const storedPreviewPath = path.relative(process.cwd(), previewPath);
    const route = findRoute("/bank-transactions/:transactionId/preview", "get");

    try {
      (db.get as jest.Mock)
        .mockResolvedValueOnce({
          crop_path: storedPreviewPath,
          occurrence_crop_path: null,
          historical_crop_path: null,
          owns_linked_reimbursement: true,
        })
        .mockResolvedValueOnce({
          crop_path: storedPreviewPath,
          occurrence_crop_path: null,
          historical_crop_path: null,
          owns_linked_reimbursement: false,
        })
        .mockResolvedValueOnce({
          crop_path: "package.json",
          occurrence_crop_path: null,
          historical_crop_path: null,
          owns_linked_reimbursement: false,
        });

      const ownerResponse = previewResponseMock();
      await route.stack.at(-1)!.handle(
        {
          params: { transactionId: "bank-transaction-1" },
          query: {},
          session: {
            user: { id: "user-1", role: "user", name: "申请人甲" },
          },
        },
        ownerResponse,
      );
      expect(ownerResponse.status).not.toHaveBeenCalled();
      expect(ownerResponse.sendFile).toHaveBeenCalledWith(previewPath);

      const otherResponse = previewResponseMock();
      await route.stack.at(-1)!.handle(
        {
          params: { transactionId: "bank-transaction-1" },
          query: {},
          session: {
            user: { id: "user-2", role: "user", name: "申请人乙" },
          },
        },
        otherResponse,
      );
      expect(otherResponse.status).toHaveBeenCalledWith(403);
      expect(otherResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "MONTHLY_BANK_PREVIEW_FORBIDDEN" }),
      );
      expect(otherResponse.sendFile).not.toHaveBeenCalled();

      const unsafeResponse = previewResponseMock();
      await route.stack.at(-1)!.handle(
        {
          params: { transactionId: "bank-transaction-1" },
          query: {},
          session: {
            user: { id: "admin-1", role: "admin", name: "管理员甲" },
          },
        },
        unsafeResponse,
      );
      expect(unsafeResponse.status).toHaveBeenCalledWith(403);
      expect(unsafeResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MONTHLY_BANK_PREVIEW_PATH_FORBIDDEN",
        }),
      );
      expect(unsafeResponse.sendFile).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("原回单仅通过有效替换链接向申请人、管理员和商务总经理开放，并限制三类证据根目录", async () => {
    const fixtureRoots = [
      path.join(process.cwd(), "uploads", "invoices"),
      path.join(process.cwd(), "uploads", "bank-receipts"),
      path.join(process.cwd(), "uploads", "monthly-financial-bank"),
    ];
    fixtureRoots.forEach((root) => fs.mkdirSync(root, { recursive: true }));
    const fixtureDirectories = fixtureRoots.map((root, index) =>
      fs.mkdtempSync(path.join(root, `previous-proof-${index}-`)),
    );
    const fixturePaths = fixtureDirectories.map((directory, index) => {
      const filePath = path.join(directory, `proof-${index}.pdf`);
      fs.writeFileSync(filePath, `proof-${index}`);
      return filePath;
    });
    const storedPaths = fixturePaths.map((filePath) =>
      path.relative(process.cwd(), filePath),
    );
    const route = findRoute(
      "/bank-transactions/:transactionId/reimbursements/:reimbursementId/previous-proof",
      "get",
    );
    const linkedRow = (
      previousPaymentProofPath: string,
      type: "basic" | "large" | "business" = "basic",
    ) => ({
      user_id: "applicant-1",
      type,
      previous_payment_proof_path: previousPaymentProofPath,
    });
    const request = (user: { id: string; role: string }, query = {}) => ({
      params: {
        transactionId: "bank-transaction-1",
        reimbursementId: "reimbursement-1",
      },
      query,
      session: { user: { ...user, name: user.id } },
    });

    try {
      (db.get as jest.Mock)
        .mockResolvedValueOnce(linkedRow(storedPaths[0]!))
        .mockResolvedValueOnce(linkedRow(storedPaths[1]!))
        .mockResolvedValueOnce(linkedRow(`/${storedPaths[2]!}`, "business"))
        .mockResolvedValueOnce(linkedRow(storedPaths[0]!))
        .mockResolvedValueOnce(linkedRow(storedPaths[0]!))
        .mockResolvedValueOnce(linkedRow("uploads/invoices/../../package.json"))
        .mockResolvedValueOnce(null);

      const applicantResponse = previewResponseMock();
      await route.stack
        .at(-1)!
        .handle(
          request({ id: "applicant-1", role: "user" }),
          applicantResponse,
        );
      expect(applicantResponse.sendFile).toHaveBeenCalledWith(fixturePaths[0]);

      const adminResponse = previewResponseMock();
      await route.stack
        .at(-1)!
        .handle(request({ id: "admin-1", role: "admin" }), adminResponse);
      expect(adminResponse.sendFile).toHaveBeenCalledWith(fixturePaths[1]);

      const businessManagerResponse = previewResponseMock();
      await route.stack
        .at(-1)!
        .handle(
          request({ id: "manager-1", role: "general_manager" }),
          businessManagerResponse,
        );
      expect(businessManagerResponse.sendFile).toHaveBeenCalledWith(
        fixturePaths[2],
      );

      const basicManagerResponse = previewResponseMock();
      await route.stack
        .at(-1)!
        .handle(
          request({ id: "manager-1", role: "general_manager" }),
          basicManagerResponse,
        );
      expect(basicManagerResponse.status).toHaveBeenCalledWith(403);
      expect(basicManagerResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MONTHLY_PREVIOUS_PAYMENT_PROOF_FORBIDDEN",
        }),
      );

      const unrelatedResponse = previewResponseMock();
      await route.stack
        .at(-1)!
        .handle(
          request({ id: "applicant-2", role: "user" }),
          unrelatedResponse,
        );
      expect(unrelatedResponse.status).toHaveBeenCalledWith(403);
      expect(unrelatedResponse.sendFile).not.toHaveBeenCalled();

      const unsafeResponse = previewResponseMock();
      await route.stack
        .at(-1)!
        .handle(request({ id: "admin-1", role: "admin" }), unsafeResponse);
      expect(unsafeResponse.status).toHaveBeenCalledWith(403);
      expect(unsafeResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MONTHLY_PREVIOUS_PAYMENT_PROOF_PATH_FORBIDDEN",
        }),
      );
      expect(unsafeResponse.sendFile).not.toHaveBeenCalled();

      const inactiveLinkResponse = previewResponseMock();
      await route.stack
        .at(-1)!
        .handle(
          request({ id: "admin-1", role: "admin" }),
          inactiveLinkResponse,
        );
      expect(inactiveLinkResponse.status).toHaveBeenCalledWith(404);
      expect(inactiveLinkResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "MONTHLY_PREVIOUS_PAYMENT_PROOF_NOT_FOUND",
        }),
      );
      expect(inactiveLinkResponse.sendFile).not.toHaveBeenCalled();

      const linkedQuery = (db.get as jest.Mock).mock.calls
        .map(([sql]) => String(sql))
        .find(
          (sql) =>
            sql.includes("previousPaymentProofPath") &&
            sql.includes("displayAction") &&
            sql.includes("bank_transaction.is_current = TRUE"),
        );
      expect(linkedQuery).toContain("link.link_kind = 'display_replacement'");
      expect(linkedQuery).toContain("link.match_status = 'active'");
      expect(linkedQuery).toContain("link.is_active = TRUE");
      expect(linkedQuery).toContain("bank_file.is_active = TRUE");
      expect(linkedQuery).toContain("reimbursement.is_deleted = FALSE");

      const invalidIndexResponse = previewResponseMock();
      await route.stack
        .at(-1)!
        .handle(
          request({ id: "admin-1", role: "admin" }, { index: "../1" }),
          invalidIndexResponse,
        );
      expect(invalidIndexResponse.status).toHaveBeenCalledWith(400);
      expect(invalidIndexResponse.sendFile).not.toHaveBeenCalled();
    } finally {
      fixtureDirectories.forEach((directory) =>
        fs.rmSync(directory, { recursive: true, force: true }),
      );
    }
  });
});

describe("月度财务报表菜单、路由与后端接口权限", () => {
  it("菜单和页面路由精确限制普通管理员及总经理", () => {
    const layoutSource = source("src/layouts/MainLayout.vue");
    const routerSource = source("src/router/index.ts");
    const financeStart = layoutSource.indexOf("<!-- 财务区 -->");
    const financeEnd = layoutSource.indexOf(
      "<!-- 人力资源区 -->",
      financeStart,
    );
    const financeSection = layoutSource.slice(financeStart, financeEnd);
    const permissionStart = layoutSource.indexOf(
      "const canViewMonthlyFinancialReport",
    );
    const permissionEnd = layoutSource.indexOf(
      "const isProjectUser",
      permissionStart,
    );
    const permissionBlock = layoutSource.slice(permissionStart, permissionEnd);
    const routeStart = routerSource.indexOf(
      'path: "/monthly-financial-report"',
    );
    const routeEnd = routerSource.indexOf(
      'path: "/reimbursement-management"',
      routeStart,
    );
    const routeBlock = routerSource.slice(routeStart, routeEnd);

    expect(financeSection).toContain('path="/monthly-financial-report"');
    expect(financeSection).toContain('v-if="canViewMonthlyFinancialReport"');
    expect(permissionBlock).toContain('authStore.user?.role === "admin"');
    expect(permissionBlock).toContain(
      'authStore.user?.role === "general_manager"',
    );
    expect(permissionBlock).not.toContain('"super_admin"');
    expect(permissionBlock).not.toContain('"chairman"');
    expect(permissionBlock).not.toContain('"boss"');
    expect(routeBlock).toContain('requiresRole: ["admin", "general_manager"]');
    expect(routeBlock).not.toContain('"super_admin"');
    expect(routeBlock).not.toContain('"chairman"');
    expect(routeBlock).not.toContain('"boss"');
  });

  it("十二个后端接口完整存在，裁片与原回单受登录保护且其余接口绑定精确角色", () => {
    const expected = [
      {
        path: "/bank-transactions/:transactionId/preview",
        method: "get",
        authRequired: true,
      },
      {
        path: "/bank-transactions/:transactionId/reimbursements/:reimbursementId/previous-proof",
        method: "get",
        authRequired: true,
      },
      {
        path: "/:month/bank-receipts",
        method: "get",
        roles: ["admin", "general_manager"],
      },
      {
        path: "/:month/bank-receipts",
        method: "post",
        roles: ["admin"],
      },
      {
        path: "/:month/bank-transactions/:transactionId/review",
        method: "post",
        roles: ["admin"],
      },
      { path: "/trend", method: "get", roles: ["admin", "general_manager"] },
      { path: "/:month", method: "get", roles: ["admin", "general_manager"] },
      { path: "/:month/manual-items", method: "put", roles: ["admin"] },
      { path: "/:month/refresh", method: "post", roles: ["admin"] },
      { path: "/:month/close", method: "post", roles: ["admin"] },
      { path: "/:month/reopen", method: "post", roles: ["admin"] },
      {
        path: "/:month/export",
        method: "get",
        roles: ["admin", "general_manager"],
      },
    ];

    expect(routeLayers()).toHaveLength(expected.length);
    expected.forEach(({ path: pathname, method, ...permission }) => {
      const route = findRoute(pathname, method);
      if ("authRequired" in permission) {
        expect(route.stack[0].handle.authRequired).toBe(true);
        expect(route.stack[0].handle.allowedRoles).toBeUndefined();
      } else {
        expect(route.stack[0].handle.allowedRoles).toEqual(permission.roles);
        expect(route.stack[0].handle.allowedRoles).not.toEqual(
          expect.arrayContaining(["super_admin", "chairman", "boss", "user"]),
        );
      }
    });
    expect(
      routeLayers().findIndex((layer) => layer.route?.path === "/trend"),
    ).toBeLessThan(
      routeLayers().findIndex((layer) => layer.route?.path === "/:month"),
    );
  });

  it("趋势接口从当前月结版本快照取值并为缺失月份返回空断点", async () => {
    const automatic: MonthlyFinancialAutomaticSnapshot = {
      ...emptyAutomaticSnapshot(),
      income: {
        mainBusinessReceipts: "500",
        tax: "10",
        marketingReserve: "20",
        businessCost: "30",
        accountingBase: "80",
      },
    };
    const internal = buildMonthlyFinancialReportView({
      id: "report-trend-closed",
      month: "2026-01",
      status: "closed",
      version: 2,
      openingBalances: {
        general: "0",
        business: "0",
        welfare_one: "0",
        welfare_two: "0",
      },
      automatic,
      manualItems: [],
      lastRefreshedAt: "2026-01-31T01:00:00.000Z",
      closedAt: "2026-02-01T01:00:00.000Z",
      updatedAt: "2026-02-01T01:00:00.000Z",
      canMaintain: true,
    });
    const accounts = internal.accounts.map((account) => ({
      code: account.code,
      name: account.name,
      opening: account.openingBalance,
      inflow: account.income,
      outflow: account.expense,
      closing: account.closingBalance,
    }));
    const storedSnapshot = {
      month: "2026-01",
      status: "closed",
      version: 2,
      snapshotVersion: 2,
      isFirstMonth: true,
      generatedAt: automatic.generatedAt,
      savedAt: "2026-02-01T01:00:00.000Z",
      closedAt: "2026-02-01T01:00:00.000Z",
      closedByName: "管理员甲",
      reopenedAt: null,
      accounts,
      income: {
        mainReceipt: "500",
        tax: "10",
        marketingReserve: "20",
        businessCost: "30",
        accountingBase: "80",
        generalInterest: "0",
        businessInterest: "0",
        welfareOneSupplement: "0",
        welfareTwoSupplement: "0",
      },
      expenses: {},
      automaticDetails: [],
      totals: {
        opening: "0",
        income: "500",
        expense: "0",
        closing: "130",
        netChange: "130",
      },
      manualItems: [],
      sources: [],
      validations: { canClose: false, blockers: [], warnings: [] },
      permissions: {
        canEdit: false,
        canRefresh: false,
        canSubmitReview: false,
        canClose: false,
        canReopen: true,
        canDownload: true,
      },
      __internal: internal,
      __automatic: automatic,
    };
    const row = {
      id: "report-trend-closed",
      report_month: "2026-01",
      status: "closed",
      version: 2,
      opening_balances_json: internal.openingBalances,
      automatic_snapshot_json: {
        ...automatic,
        income: { ...automatic.income, mainBusinessReceipts: "999" },
      },
      closing_balances_json: Object.fromEntries(
        accounts.map((account) => [account.code, account.closing]),
      ),
      last_refreshed_at: "2026-01-31T01:00:00.000Z",
      closed_at: "2026-02-01T01:00:00.000Z",
      closed_by_name: "管理员甲",
      reopened_at: null,
      updated_at: "2026-02-01T01:00:00.000Z",
    };

    (db.all as jest.Mock).mockImplementation(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (sql.includes("SELECT report_month")) {
        return [{ report_month: "2026-01" }];
      }
      if (sql.includes("SELECT DISTINCT LEFT(report_month, 4)")) {
        return [{ year: 2025 }, { year: 2026 }];
      }
      return [];
    });
    (db.get as jest.Mock).mockImplementation(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (sql.includes("FROM monthly_financial_reports report")) return row;
      if (sql.includes("WHERE report_month <")) return undefined;
      if (sql.includes("FROM monthly_financial_snapshots")) {
        return { snapshot_json: storedSnapshot };
      }
      return undefined;
    });
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const route = findRoute("/trend", "get");

    await route.stack.at(-1)!.handle(
      {
        query: { from: "2026-01", to: "2026-02" },
        session: {
          user: { id: "admin-1", role: "admin", name: "管理员甲" },
        },
      },
      response,
    );

    expect(response.status).not.toHaveBeenCalled();
    const payload = response.json.mock.calls[0]?.[0];
    expect(payload.data.availableYears).toEqual([2025, 2026]);
    expect(payload.data.points[0]).toMatchObject({
      month: "2026-01",
      status: "closed",
      valueState: "closed",
      actualReceipt: "500",
    });
    expect(payload.data.points[0].actualReceipt).not.toBe("999");
    expect(payload.data.points[1]).toMatchObject({
      month: "2026-02",
      status: null,
      valueState: null,
      actualReceipt: null,
      closingTotal: null,
    });
  });

  it("趋势接口对重新开启月份使用当前开放报表的精确工作值", async () => {
    const automatic: MonthlyFinancialAutomaticSnapshot = {
      ...emptyAutomaticSnapshot(),
      income: {
        mainBusinessReceipts: "300",
        tax: "10",
        marketingReserve: "20",
        businessCost: "30",
        accountingBase: "240",
      },
    };
    const row = {
      id: "report-trend-reopened",
      report_month: "2026-03",
      status: "reopened",
      version: 5,
      opening_balances_json: {
        general: "0",
        business: "0",
        welfare_one: "0",
        welfare_two: "0",
      },
      automatic_snapshot_json: automatic,
      closing_balances_json: null,
      last_refreshed_at: "2026-03-31T01:00:00.000Z",
      closed_at: null,
      closed_by_name: null,
      reopened_at: "2026-04-01T01:00:00.000Z",
      updated_at: "2026-04-01T01:00:00.000Z",
    };

    (db.all as jest.Mock).mockImplementation(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (sql.includes("SELECT report_month")) {
        return [{ report_month: "2026-03" }];
      }
      if (sql.includes("SELECT DISTINCT LEFT(report_month, 4)")) {
        return [{ year: 2026 }];
      }
      return [];
    });
    (db.get as jest.Mock).mockImplementation(async (sqlValue: string) => {
      const sql = String(sqlValue);
      if (sql.includes("FROM monthly_financial_reports report")) return row;
      if (sql.includes("FROM monthly_financial_snapshots")) {
        throw new Error("重新开启月份不应读取旧月结快照");
      }
      if (sql.includes("AS review_required_count")) {
        return {
          review_required_count: 0,
          unclassified_count: 0,
          conflict_count: 0,
        };
      }
      return undefined;
    });
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const route = findRoute("/trend", "get");

    await route.stack.at(-1)!.handle(
      {
        query: { from: "2026-03", to: "2026-03" },
        session: {
          user: { id: "admin-1", role: "admin", name: "管理员甲" },
        },
      },
      response,
    );

    expect(response.status).not.toHaveBeenCalled();
    const currentPoint = response.json.mock.calls[0]?.[0].data.points[0];
    expect(currentPoint).toMatchObject({
      month: "2026-03",
      status: "reopened",
      valueState: "current",
      actualReceipt: "300",
    });
    expect(currentPoint).not.toHaveProperty("isEstimate");
    expect(
      (db.get as jest.Mock).mock.calls.some(([sql]) =>
        String(sql).includes("FROM monthly_financial_snapshots"),
      ),
    ).toBe(false);
  });

  it("趋势接口拒绝倒序和超过二百四十个月的查询", async () => {
    const route = findRoute("/trend", "get");
    const request = (from: string, to: string) => ({
      query: { from, to },
      session: {
        user: { id: "admin-1", role: "admin", name: "管理员甲" },
      },
    });
    const response = () => ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    });
    const reversed = response();
    const oversized = response();

    await route.stack.at(-1)!.handle(request("2026-02", "2026-01"), reversed);
    await route.stack.at(-1)!.handle(request("2000-01", "2020-01"), oversized);

    for (const result of [reversed, oversized]) {
      expect(result.status).toHaveBeenCalledWith(400);
      expect(result.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          code: "MONTHLY_FINANCE_TREND_RANGE_INVALID",
        }),
      );
    }
    expect(db.all).not.toHaveBeenCalled();
  });

  it("下载生成完整工作簿并防止手工项和自动来源触发公式注入", async () => {
    const automatic: MonthlyFinancialAutomaticSnapshot = {
      ...emptyAutomaticSnapshot(),
      income: {
        mainBusinessReceipts: "100000",
        tax: "11720",
        marketingReserve: "4414",
        businessCost: "8386.6",
        accountingBase: "75479.4",
      },
      expenses: {
        ...emptyAutomaticSnapshot().expenses,
        basicReimbursement: "12.345",
      },
      details: [
        {
          sourceType: "reimbursement",
          sourceId: "source-1",
          occurredOn: "2026-08-12",
          accountCode: "general",
          metric: "basic_reimbursement",
          amount: "12.345",
          description: "@SUM(A1:A2)",
          personId: "person-1",
          personName: "测试人员",
        },
      ],
    };
    const reportRow = {
      id: "report-export",
      report_month: "2026-08",
      status: "draft",
      version: 3,
      opening_balances_json: {
        general: "100",
        business: "20",
        welfare_one: "3",
        welfare_two: "4",
      },
      automatic_snapshot_json: automatic,
      closing_balances_json: null,
      last_refreshed_at: "2026-08-20T01:00:00.000Z",
      closed_at: null,
      closed_by_name: null,
      reopened_at: null,
      updated_at: "2026-08-20T01:00:00.000Z",
    };

    (db.get as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_reports report")) {
        return reportRow;
      }
      if (sql.includes("WHERE report_month <")) return undefined;
      return undefined;
    });
    (db.all as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM monthly_financial_manual_items")) {
        return [
          {
            id: "manual-1",
            category: "general_other",
            account_code: "general",
            direction: "expense",
            amount: "1.2300",
            occurred_on: "2026-08-13",
            description: '=HYPERLINK("https://example.com")',
            voucher_reference: "+危险凭证",
          },
        ];
      }
      return [];
    });
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

    const exportRoute = findRoute("/:month/export", "get");
    const handler = exportRoute.stack.at(-1)!.handle;
    let sentBody: Buffer | undefined;
    const headers: Record<string, string> = {};
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
      }),
      send: jest.fn((body: Buffer) => {
        sentBody = body;
      }),
    };
    const request = {
      params: { month: "2026-08" },
      session: {
        user: { id: "admin-1", role: "admin", name: "管理员甲" },
      },
    };

    await handler(request, response);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(sentBody).toBeInstanceOf(Buffer);
    expect(headers["Content-Type"]).toContain("spreadsheetml.sheet");
    expect(headers["Content-Disposition"]).toContain(
      "monthly-financial-report-2026-08.xlsx",
    );
    const workbook = XLSX.read(sentBody!, { type: "buffer" });
    expect(workbook.SheetNames).toEqual([
      "月度结算",
      "手工项目明细",
      "自动来源明细",
      "校验",
    ]);
    const summarySheet = workbook.Sheets["月度结算"]!;
    expect(summarySheet["A11"]?.v).toBe(100000);
    expect(summarySheet["C11"]?.v).toBe(11720);
    expect(summarySheet["B14"]?.f).toBe("ROUND(D15+E15+F15+A17,2)");
    expect(summarySheet["B14"]?.v).toBe(13.58);
    expect(summarySheet["B15"]?.f).toBeUndefined();
    expect(summarySheet["A17"]?.f).toBe("ROUND(SUM(B17:H17),2)");
    expect(summarySheet["A17"]?.v).toBe(12.35);
    expect(summarySheet["A19"]?.f).toBe("ROUND(SUM(B19:H19),2)");
    expect(summarySheet["A19"]?.v).toBe(0);
    expect(summarySheet["B29"]?.f).toBe(
      "ROUND(A7+F11+G11-D15-E15-F15-H15-A17,2)",
    );
    expect(summarySheet["B29"]?.v).toBe(75565.83);
    expect(summarySheet["B16"]?.v).toBe("测试人员");
    expect(summarySheet["B17"]?.v).toBe(12.345);
    expect(summarySheet["!merges"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          s: { c: 0, r: 0 },
          e: { c: 7, r: 0 },
        }),
        expect.objectContaining({
          s: { c: 1, r: 13 },
          e: { c: 2, r: 14 },
        }),
      ]),
    );
    const manualRows = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets["手工项目明细"]!,
      { defval: "" },
    );
    const automaticRows = XLSX.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets["自动来源明细"]!,
      { defval: "" },
    );
    expect(manualRows[0]).toMatchObject({
      金额: 1.23,
      说明: '=HYPERLINK("https://example.com")',
      凭证引用: "+危险凭证",
    });
    expect(workbook.Sheets["手工项目明细"]!["F2"]?.t).toBe("s");
    expect(workbook.Sheets["手工项目明细"]!["F2"]?.f).toBeUndefined();
    expect(workbook.Sheets["手工项目明细"]!["G2"]?.t).toBe("s");
    expect(automaticRows[0]).toMatchObject({
      金额: 12.345,
      人员: "测试人员",
      说明: "@SUM(A1:A2)",
    });
    expect(workbook.Sheets["自动来源明细"]!["I2"]?.t).toBe("s");
    expect(workbook.Sheets["自动来源明细"]!["I2"]?.f).toBeUndefined();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("'export'"),
      expect.arrayContaining(["report-export", 3, "admin-1", "admin"]),
    );
  });
});
