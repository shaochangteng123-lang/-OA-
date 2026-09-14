/** @jest-environment node */
jest.mock("nanoid", () => ({ nanoid: jest.fn(() => "snapshot-test") }));
jest.mock("../server/db/index", () => ({
  db: { all: jest.fn(), get: jest.fn() },
  pool: {},
}));
jest.mock("../server/middleware/auth", () => ({
  requireAuth: jest.fn(),
  requireExactRole: () => jest.fn(),
}));

import { db } from "../server/db/index";
import { loadAutomaticSnapshot } from "../server/routes/monthly-financial-reports";
import {
  addFinancialAmounts,
  isValidFinancialAnalysisMetadata,
} from "../server/services/monthlyFinancialReport";

describe("自动月报冻结分析维度", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (db.all as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, parent_id AS "parentId", name, value'))
        return [
          {
            id: "scope-root",
            parentId: null,
            name: "海淀区",
            value: "haidian",
          },
          {
            id: "scope-child",
            parentId: "scope-root",
            name: "当时范围名称",
            value: "region-1",
          },
        ];
      if (sql.includes("SELECT receipt.id, receipt.receipt_date"))
        return [
          {
            id: "receipt-1",
            receipt_date: "2026-08-10",
            amount: "100.1",
            rate_snapshot_json: null,
            title: "主营项目",
            root_id: "contract-1",
            party_a: "当时甲方",
            region: "当时区域",
            updated_at: "2026-08-11",
          },
        ];
      if (sql.includes("SELECT payroll.id, employee.id"))
        return [
          {
            id: "payroll-1",
            employee_id: "employee-1",
            employee_name: "人员一",
            monthly_salary: "1000",
            housing_fund_base: "1000",
            contribution_base: "1000",
            individual_income_tax: "0",
            withheld_actual_amount: "300",
            net_salary_actual_amount: "1000",
            updated_at: "2026-08-12",
          },
        ];
      if (sql.includes("FROM reimbursements reimbursement"))
        return [
          {
            id: "reimbursement-1",
            user_id: "user-1",
            employee_id: "employee-1",
            type: "business",
            title: "商务报销",
            applicant_name: "人员一",
            total_amount: "50.1",
            occurred_at: "2026-08-10",
            category: "reception",
            reimbursement_scope: "region-1",
            scope_label: "当时范围名称",
            service_target: "当时服务对象",
            updated_at: "2026-08-13",
          },
        ];
      return [];
    });
  });

  it("新来源保存闭合工资分项及当时的维度，不改变收支本金", async () => {
    const snapshot = await loadAutomaticSnapshot("2026-08");
    const payroll = snapshot.details.find(
      (detail) => detail.sourceType === "payroll",
    )!;
    expect(payroll.amount).toBe("1300");
    expect(payroll.analysis?.canonicalPersonId).toBe("employee-1");
    const parts = payroll.analysis!.payrollParts!;
    expect(parts.salary).toBe("1000");
    expect(
      addFinancialAmounts(
        parts.salary,
        parts.social,
        parts.housing,
        parts.adjustment,
      ),
    ).toBe(payroll.amount);
    expect(
      isValidFinancialAnalysisMetadata(
        payroll.analysis,
        payroll.sourceType,
        payroll.amount,
      ),
    ).toBe(true);
    const reimbursement = snapshot.details.find(
      (detail) => detail.sourceType === "reimbursement",
    )!;
    expect(reimbursement.amount).toBe("50.1");
    expect(reimbursement.analysis).toEqual({
      schemaVersion: 1,
      canonicalPersonId: "employee-1",
      reimbursementCategory: "reception",
      reimbursementScope: "海淀区 / 当时范围名称",
      reimbursementScopeValue: "region-1",
      reimbursementScopePath: "海淀区 / 当时范围名称",
      reimbursementRegion: "海淀区",
      reimbursementRegionSource:
        "生成自动来源快照时核对；财务区报销范围完整父链唯一核对；行政区取根级配置，公司内部单列",
      reimbursementServiceTarget: "当时服务对象",
    });
    const receipt = snapshot.details.find(
      (detail) => detail.metric === "main_receipt",
    )!;
    expect(receipt.amount).toBe("100.1");
    expect(receipt.analysis).toEqual({
      schemaVersion: 1,
      contractRootId: "contract-1",
      partyA: "当时甲方",
      contractRegion: "当时区域",
    });
  });

  it("兼容旧无维度快照，但已有维度损坏不能当缺省跳过", () => {
    expect(isValidFinancialAnalysisMetadata(undefined, "payroll", "1300")).toBe(
      true,
    );
    expect(isValidFinancialAnalysisMetadata(null, "payroll", "1300")).toBe(
      false,
    );
    expect(
      isValidFinancialAnalysisMetadata({ schemaVersion: 2 }, "payroll", "1300"),
    ).toBe(false);
    expect(
      isValidFinancialAnalysisMetadata(
        { schemaVersion: 1, partyA: 123 },
        "contract_receipt",
        "1",
      ),
    ).toBe(false);
    expect(
      isValidFinancialAnalysisMetadata(
        {
          schemaVersion: 1,
          payrollParts: {
            salary: "1000",
            social: "200",
            housing: "100",
            adjustment: "0",
          },
        },
        "payroll",
        "1300",
      ),
    ).toBe(true);
    expect(
      isValidFinancialAnalysisMetadata(
        {
          schemaVersion: 1,
          payrollParts: {
            salary: "900",
            social: "200",
            housing: "100",
            adjustment: "0",
          },
        },
        "payroll",
        "1300",
      ),
    ).toBe(false);
    expect(
      isValidFinancialAnalysisMetadata(
        {
          schemaVersion: 1,
          payrollParts: {
            salary: "1000",
            social: "200",
            housing: "100",
            adjustment: "-10",
          },
        },
        "payroll",
        "1290",
      ),
    ).toBe(true);
  });

  it("范围字典名称不唯一不能使同一报销金额重复计入", async () => {
    (db.all as jest.Mock).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM reimbursements reimbursement")) {
        expect(sql).toContain("LEFT JOIN LATERAL");
        expect(sql).toContain("COUNT(DISTINCT name)");
        return [
          {
            id: "reimbursement-1",
            user_id: "user-1",
            type: "business",
            title: "报销",
            applicant_name: "人员一",
            total_amount: "100",
            occurred_at: "2026-08-10",
            reimbursement_scope: "duplicate",
            scope_label: null,
            scope_name_count: 2,
            updated_at: "2026-08-10",
          },
        ];
      }
      return [];
    });
    const snapshot = await loadAutomaticSnapshot("2026-08");
    expect(snapshot.expenses.businessReimbursement).toBe("100");
    expect(
      snapshot.details.find((detail) => detail.sourceType === "reimbursement")
        ?.analysis?.reimbursementScope,
    ).toBe("duplicate");
  });

  it("即使查询意外返回重复来源，也拒绝生成金额倍增快照", async () => {
    (db.all as jest.Mock).mockImplementation(async (sql: string) =>
      sql.includes("FROM reimbursements reimbursement")
        ? [{ id: "duplicate" }, { id: "duplicate" }]
        : [],
    );
    await expect(loadAutomaticSnapshot("2026-08")).rejects.toThrow(
      "报销自动来源出现重复编号",
    );
  });

  it("叶名称一致但同范围值跨行政区时，新快照冻结原值和未知归属，不复制金额", async () => {
    const original = (db.all as jest.Mock).getMockImplementation()!;
    (db.all as jest.Mock).mockImplementation(
      async (sql: string, ...args: unknown[]) => {
        if (sql.includes('SELECT id, parent_id AS "parentId", name, value'))
          return [
            { id: "haidian", parentId: null, name: "海淀区", value: "haidian" },
            {
              id: "chaoyang",
              parentId: null,
              name: "朝阳区",
              value: "chaoyang",
            },
            {
              id: "first",
              parentId: "haidian",
              name: "GJDW",
              value: "region-1",
            },
            {
              id: "second",
              parentId: "chaoyang",
              name: "GJDW",
              value: "region-1",
            },
          ];
        return original(sql, ...args);
      },
    );
    const snapshot = await loadAutomaticSnapshot("2026-08");
    const rows = snapshot.details.filter(
      (detail) => detail.sourceType === "reimbursement",
    );
    expect(rows).toHaveLength(1);
    expect(snapshot.expenses.businessReimbursement).toBe("50.1");
    expect(rows[0].analysis).toMatchObject({
      reimbursementScope: "region-1",
      reimbursementScopeValue: "region-1",
      reimbursementScopePath: null,
      reimbursementRegion: null,
    });
    expect(rows[0].analysis?.reimbursementRegionSource).toContain(
      "不同父级区域或路径",
    );
    expect(
      isValidFinancialAnalysisMetadata(
        rows[0].analysis,
        "reimbursement",
        "50.1",
      ),
    ).toBe(true);
  });
});
