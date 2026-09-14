import fs from "node:fs";
import path from "node:path";

import {
  buildMonthlyFinancialReportView,
  validateManualItems,
} from "../server/services/monthlyFinancialReport";
import type { MonthlyFinancialAutomaticSnapshot } from "../server/types/monthly-financial-report";

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function automaticSnapshot(): MonthlyFinancialAutomaticSnapshot {
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
    generatedAt: "2026-09-09T00:00:00.000Z",
  };
}

function buildReport(
  automatic: MonthlyFinancialAutomaticSnapshot,
  manualItems: unknown[] = [],
) {
  return buildMonthlyFinancialReportView({
    id: "welfare-two-report",
    month: "2026-09",
    status: "draft",
    version: 1,
    openingBalances: {
      general: "0",
      business: "0",
      welfare_one: "0",
      welfare_two: "100",
    },
    automatic,
    manualItems: validateManualItems(manualItems, "2026-09"),
    lastRefreshedAt: null,
    closedAt: null,
    updatedAt: null,
    canMaintain: true,
  });
}

describe("董事长福利2报销后端契约", () => {
  const databaseSource = source("server/db/index.ts");
  const reimbursementSource = source("server/routes/reimbursement.ts");
  const approvalSource = source("server/routes/approval.ts");
  const scopeSource = source("server/routes/reimbursement-scope.ts");
  const monthlyRouteSource = source(
    "server/routes/monthly-financial-reports.ts",
  );

  it("数据库使用独立福利2分类、外键快照和动态手工分类", () => {
    expect(databaseSource).toContain(
      "CREATE TABLE IF NOT EXISTS welfare_two_expense_categories",
    );
    expect(databaseSource).toContain("welfare_two_category_id");
    expect(databaseSource).toContain("welfare_two_category_name_snapshot");
    expect(databaseSource).toContain(
      "reimbursements_welfare_two_category_check",
    );
    expect(databaseSource).toContain(
      "monthly_financial_manual_welfare_two_category_check",
    );
    expect(databaseSource).toContain("'welfare_two_expense'");
    expect(databaseSource).toContain("welfare_two_refreshment");
    expect(databaseSource).toContain("welfare_two_team_building");
    expect(databaseSource).toContain("welfare_two_physical_exam");
    expect(databaseSource).toContain("welfare_expense_category_tombstones");
    expect(databaseSource).toContain("tombstone.account_code = 'welfare_two'");
    expect(databaseSource).toContain("AND updated_at = created_at");
    expect(
      databaseSource.indexOf("idx_reimbursements_welfare_two_category"),
    ).toBeGreaterThan(
      databaseSource.indexOf(
        "ADD COLUMN IF NOT EXISTS welfare_two_category_id TEXT",
      ),
    );
  });

  it("福利2分类接口支持增改排序停用及安全删除", () => {
    const welfareTwoRoutes = scopeSource.slice(
      scopeSource.indexOf("router.get('/welfare-two/list'"),
    );
    expect(welfareTwoRoutes).toContain("router.get('/welfare-two/admin/list'");
    expect(welfareTwoRoutes).toContain("router.post('/welfare-two/create'");
    expect(welfareTwoRoutes).toContain("router.put('/welfare-two/sort'");
    expect(welfareTwoRoutes).toContain("router.put('/welfare-two/:id'");
    expect(welfareTwoRoutes).toContain("router.delete('/welfare-two/:id'");
    expect(welfareTwoRoutes).toContain("WELFARE_TWO_CATEGORY_IN_USE");
    expect(welfareTwoRoutes).toContain("welfare_two_category_id = $1");
    expect(welfareTwoRoutes).toContain("category = 'welfare_two_refreshment'");
    expect(welfareTwoRoutes).toContain("welfare_expense_category_tombstones");
    expect(welfareTwoRoutes).toContain(
      "DELETE FROM welfare_two_expense_categories",
    );
  });

  it("报销和审批中心识别福利2并沿用董事长免审批、管理员付款边界", () => {
    expect(reimbursementSource).toContain("'welfare_two'");
    expect(reimbursementSource).toContain("welfare_two_expense_categories");
    expect(reimbursementSource).toContain("welfare_two_category_name_snapshot");
    expect(reimbursementSource).toContain("isWelfareReimbursementType(type)");
    expect(reimbursementSource).toContain("'auto_approved'");
    expect(approvalSource).toContain("reimbursement_welfare_two");
    expect(approvalSource).toContain("welfareTwoStats");
    expect(approvalSource).toContain("myReimbursementWelfareTwo");
    expect(approvalSource).toContain("welfare_two: '福利2报销'");
  });

  it("福利2自动报销与固定、动态手工金额逐分类相加且只计入账户二", () => {
    const automatic = automaticSnapshot();
    automatic.welfareTwoExpenseCategories = [
      {
        id: "welfare_two_refreshment",
        code: "refreshment",
        name: "茶歇",
        sortOrder: 1,
        isActive: true,
        amount: "10",
      },
      {
        id: "welfare_two_team_building",
        code: "team_building",
        name: "团建",
        sortOrder: 2,
        isActive: true,
        amount: "20",
      },
      {
        id: "welfare_two_physical_exam",
        code: "physical_exam",
        name: "体检",
        sortOrder: 3,
        isActive: true,
        amount: "0",
      },
    ];
    const report = buildReport(automatic, [
      {
        category: "welfare_two_refreshment",
        amount: "1",
        occurredOn: "2026-09-01",
      },
      {
        category: "welfare_two_expense",
        amount: "2",
        occurredOn: "2026-09-02",
        welfareCategoryId: "welfare_two_team_building",
        welfareCategoryNameSnapshot: "团建",
      },
      {
        category: "welfare_two_physical_exam",
        amount: "3",
        occurredOn: "2026-09-03",
      },
    ]);

    expect(report.welfareTwoExpenseCategories).toEqual([
      expect.objectContaining({
        name: "茶歇",
        automaticAmount: "10",
        manualAmount: "1",
        totalAmount: "11",
      }),
      expect.objectContaining({
        name: "团建",
        automaticAmount: "20",
        manualAmount: "2",
        totalAmount: "22",
      }),
      expect.objectContaining({
        name: "体检",
        automaticAmount: "0",
        manualAmount: "3",
        totalAmount: "3",
      }),
    ]);
    expect(
      report.accounts.find((account) => account.code === "welfare_two"),
    ).toMatchObject({
      expense: "36",
      closingBalance: "64",
    });
    expect(
      report.accounts.find((account) => account.code === "welfare_one")
        ?.expense,
    ).toBe("0");
  });

  it("动态分类快照存在时以数据库目录为准，旧快照缺字段才回退固定三项", () => {
    const current = automaticSnapshot();
    current.welfareTwoExpenseCategories = [
      {
        id: "welfare_two_refreshment",
        code: "refreshment",
        name: "茶歇",
        sortOrder: 1,
        isActive: true,
        amount: "0",
      },
    ];
    expect(
      buildReport(current).welfareTwoExpenseCategories.map((item) => item.name),
    ).toEqual(["茶歇"]);
    expect(
      buildReport(automaticSnapshot()).welfareTwoExpenseCategories.map(
        (item) => item.name,
      ),
    ).toEqual(["茶歇", "团建", "体检"]);
  });

  it("月报自动快照、只读手工区和旧月结回退均包含福利2", () => {
    expect(monthlyRouteSource).toContain('accountCode: "welfare_two"');
    expect(monthlyRouteSource).toContain('metric: "welfare_two_expense"');
    expect(monthlyRouteSource).toContain("welfareTwoExpenseCategories");
    expect(monthlyRouteSource).toContain(
      'sourceType: "reimbursement" as const',
    );
    expect(monthlyRouteSource).toContain("legacyClosedWelfareTwoCategories");
    expect(monthlyRouteSource).toContain(
      "previousItem.category !== item.category",
    );
    expect(monthlyRouteSource).toContain(
      "monthly-finance-v6-dual-welfare-reimbursement-categories",
    );
  });
});
