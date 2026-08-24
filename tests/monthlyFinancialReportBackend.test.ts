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
  requireRole: jest.fn((roles: string[]) => {
    const middleware = (_req: unknown, _res: unknown, next: () => void) =>
      next();
    Object.assign(middleware, { allowedRoles: [...roles] });
    return middleware;
  }),
}));

import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { db, pool } from "../server/db/index";
import monthlyFinancialReportRouter from "../server/routes/monthly-financial-reports";
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
      handle: ((...args: unknown[]) => unknown) & { allowedRoles?: string[] };
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

  function report(items: MonthlyFinancialManualItemInput[] = manualItems) {
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
      expense: "6",
      closingBalance: "49",
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

  it("六个后端接口完整存在且分别绑定精确读写角色", () => {
    const expected = [
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
    expected.forEach(({ path: pathname, method, roles }) => {
      const route = findRoute(pathname, method);
      expect(route.stack[0].handle.allowedRoles).toEqual(roles);
      expect(route.stack[0].handle.allowedRoles).not.toEqual(
        expect.arrayContaining(["super_admin", "chairman", "boss", "user"]),
      );
    });
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
