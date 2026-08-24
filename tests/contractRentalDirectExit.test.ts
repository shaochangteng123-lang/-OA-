jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/db/index", () => ({ db: { transaction: jest.fn() } }));

import fs from "fs";
import path from "path";
import { db } from "../server/db/index";
import { confirmCompletedRentalExit } from "../server/services/contractService";

function rentalContract(overrides: Record<string, unknown> = {}) {
  return {
    id: "rental-root-1",
    contract_no: "HT-20260824-000001",
    business_contract_no: null,
    title: "测试车辆租赁合同",
    description: null,
    requires_auxiliary_materials: false,
    declared_category: "asset",
    declared_subtype: "vehicle_rental",
    category: "asset",
    asset_category: "vehicle_rental",
    relation_type: "main",
    status: "completed",
    area: "朝阳区",
    project_id: null,
    parent_contract_id: null,
    root_contract_id: "rental-root-1",
    termination_target_contract_id: null,
    party_a: "出租方",
    party_b: "承租方",
    project_name: "测试车辆租赁合同",
    amount_delta: 1200,
    original_contract_amount: 1200,
    recognized_original_amount: 1200,
    recognized_final_amount: 1200,
    amount_before_change: null,
    amount_after_change: null,
    current_effective_amount: 1200,
    supplement_change_type: null,
    supplement_sequence: null,
    contract_date: "2026-01-01",
    contract_date_source: "ocr",
    lease_start_date: "2026-01-01",
    lease_end_date: "2026-12-31",
    lease_monthly_rent: 100,
    lease_monthly_property_fee: null,
    lease_term_months: 12,
    lease_amount_source: "monthly_rent_calculated",
    lease_operation_type: null,
    lease_previous_end_date: null,
    financial_direction: "cost",
    financial_direction_source: "contract_category",
    financial_direction_invoice_id: null,
    financial_direction_confirmed_by: null,
    financial_direction_confirmed_at: null,
    financial_direction_version: 1,
    asset_funding_mode: "engineering_direct",
    pending_action: null,
    previous_status: null,
    version: 7,
    created_by: "admin-1",
    updated_by: "admin-1",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
    ...overrides,
  };
}

function rentalExitClient(input?: {
  contract?: ReturnType<typeof rentalContract>;
  settledAmount?: number;
  pendingChild?: boolean;
  pendingFinancial?: boolean;
}) {
  const contract = input?.contract || rentalContract();
  const settledAmount = input?.settledAmount ?? 1200;
  return {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT id, root_contract_id FROM contracts")) {
        return {
          rows: [
            { id: contract.id, root_contract_id: contract.root_contract_id },
          ],
        };
      }
      if (sql.includes("SELECT * FROM contracts")) {
        return String(params[0] || "") === contract.id
          ? { rows: [contract] }
          : { rows: [] };
      }
      if (
        sql.includes("relation_type IN ('supplement', 'termination')") &&
        sql.includes("status IN ('draft', 'approving', 'pending_seal')")
      ) {
        return { rows: input?.pendingChild ? [{ id: "child-1" }] : [] };
      }
      if (sql.includes("SELECT pending.source FROM")) {
        return {
          rows: input?.pendingFinancial ? [{ source: "payment" }] : [],
        };
      }
      if (sql.includes("AS settled_amount")) {
        return { rows: [{ settled_amount: settledAmount }] };
      }
      if (sql.includes("UPDATE contracts SET status = 'terminated'")) {
        return {
          rows: [
            {
              ...contract,
              status: "terminated",
              current_effective_amount: settledAmount,
              version: contract.version + 1,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
}

describe("租赁合同满额直退后端闭环", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("普通资产按已确认付款严格满额后直接还车并写入独立审计", async () => {
    const client = rentalExitClient();
    (db.transaction as jest.Mock).mockImplementation(
      (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      confirmCompletedRentalExit({
        contractId: "rental-root-1",
        actorId: "admin-1",
        actorRole: "admin",
        expectedVersion: 7,
      }),
    ).resolves.toMatchObject({ status: "terminated", version: 8 });

    const settlementSql = String(
      client.query.mock.calls.find(([sql]) =>
        String(sql).includes("AS settled_amount"),
      )?.[0] || "",
    );
    expect(settlementSql).toContain("FROM contract_payments record");
    expect(settlementSql).not.toContain(
      "FROM contract_external_payments record",
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE contracts SET status = 'terminated'"),
      expect.arrayContaining(["rental-root-1", 1200, "admin-1", 7]),
    );
    expect(
      client.query.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("INSERT INTO contract_audit_logs") &&
          Array.isArray(params) &&
          params.includes("rental_direct_exit_confirmed"),
      ),
    ).toBe(true);
  });

  it("内部划拨资产按科技最终对外付款判断是否满额", async () => {
    const contract = rentalContract({
      asset_funding_mode: "engineering_to_technology",
    });
    const client = rentalExitClient({ contract });
    (db.transaction as jest.Mock).mockImplementation(
      (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await confirmCompletedRentalExit({
      contractId: contract.id,
      actorId: "admin-1",
      actorRole: "super_admin",
      expectedVersion: 7,
    });

    const settlementSql = String(
      client.query.mock.calls.find(([sql]) =>
        String(sql).includes("AS settled_amount"),
      )?.[0] || "",
    );
    expect(settlementSql).toContain("FROM contract_external_payments record");
  });

  it("未满100%时返回专门错误并要求继续上传解除协议", async () => {
    const client = rentalExitClient({ settledAmount: 1199.99 });
    (db.transaction as jest.Mock).mockImplementation(
      (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      confirmCompletedRentalExit({
        contractId: "rental-root-1",
        actorId: "admin-1",
        actorRole: "chairman",
        expectedVersion: 7,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_RENTAL_EXIT_AGREEMENT_REQUIRED",
    });
  });

  it("超额结算沿用结算快照的独立阻断错误", async () => {
    const client = rentalExitClient({ settledAmount: 1200.01 });
    (db.transaction as jest.Mock).mockImplementation(
      (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );

    await expect(
      confirmCompletedRentalExit({
        contractId: "rental-root-1",
        actorId: "admin-1",
        actorRole: "admin",
        expectedVersion: 7,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CONTRACT_TERMINATION_SETTLEMENT_EXCEEDS_AMOUNT",
    });
  });

  it("存在办理中子协议或财务草稿时禁止直接终止", async () => {
    const childClient = rentalExitClient({ pendingChild: true });
    (db.transaction as jest.Mock).mockImplementationOnce(
      (callback: (transactionClient: typeof childClient) => unknown) =>
        callback(childClient),
    );
    await expect(
      confirmCompletedRentalExit({
        contractId: "rental-root-1",
        actorId: "admin-1",
        actorRole: "admin",
        expectedVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "CONTRACT_RENTAL_EXIT_PENDING_CHILD",
    });

    const financialClient = rentalExitClient({ pendingFinancial: true });
    (db.transaction as jest.Mock).mockImplementationOnce(
      (callback: (transactionClient: typeof financialClient) => unknown) =>
        callback(financialClient),
    );
    await expect(
      confirmCompletedRentalExit({
        contractId: "rental-root-1",
        actorId: "admin-1",
        actorRole: "admin",
        expectedVersion: 7,
      }),
    ).rejects.toMatchObject({
      code: "CONTRACT_RENTAL_EXIT_PENDING_FINANCIAL",
    });
  });

  it("服务层再次校验管理员权限且拒绝过期合同版本", async () => {
    await expect(
      confirmCompletedRentalExit({
        contractId: "rental-root-1",
        actorId: "user-1",
        actorRole: "user",
        expectedVersion: 7,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "CONTRACT_RENTAL_EXIT_ADMIN_ONLY",
    });
    expect(db.transaction).not.toHaveBeenCalled();

    const client = rentalExitClient();
    (db.transaction as jest.Mock).mockImplementationOnce(
      (callback: (transactionClient: typeof client) => unknown) =>
        callback(client),
    );
    await expect(
      confirmCompletedRentalExit({
        contractId: "rental-root-1",
        actorId: "admin-1",
        actorRole: "admin",
        expectedVersion: 6,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "VERSION_CONFLICT",
    });
  });

  it("接口固定使用管理员权限和版本字段且终止状态消除到期提醒", () => {
    const routeSource = fs.readFileSync(
      path.resolve(process.cwd(), "server/routes/contracts.ts"),
      "utf8",
    );
    expect(routeSource).toContain(
      'router.post("/:id/rental-exit/confirm", requireFinance',
    );
    expect(routeSource).toContain(
      "expectedVersion: parseExpectedVersion(req.body?.expectedVersion)",
    );
    expect(routeSource).toContain(
      "c.status IN ('effective', 'executing', 'completed')",
    );
    expect(routeSource).toContain("relation_type = 'main'");
    expect(routeSource).toContain("BOOL_OR(c.relation_type = 'main'");
  });
});
