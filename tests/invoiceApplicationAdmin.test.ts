/** @jest-environment node */
import { db, pool } from "../server/db/index.js";
import {
  canInitiateInvoiceApplication,
  createInvoiceApplication,
  updateInvoiceApplication,
  submitInvoiceApplication,
  withdrawInvoiceApplication,
  deleteInvoiceApplicationDraft,
  deleteInvoiceApplicationMaterial,
  generateMainBusinessTriplicate,
  decideInvoiceApplication,
  listInvoiceApplications,
  getInvoiceApplicationPendingCounts,
} from "../server/services/invoiceApplication.js";

jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
jest.mock("../server/db/index", () => {
  const query = jest.fn();
  return {
    db: {
      transaction: async (callback: (client: unknown) => Promise<unknown>) =>
        callback({ query }),
    },
    pool: { query },
  };
});

const draft = {
  contractId: "contract-1",
  amount: 100,
  invoiceType: "专票",
  materialMode: "no_material",
  billingInfo: {},
};
const adminRoles = ["admin", "super_admin", "chairman"];

describe("管理员开票申请权限", () => {
  beforeEach(() => (pool.query as jest.Mock).mockReset());

  test.each(["user", ...adminRoles])(
    "允许员工及管理员作为申请人：%s",
    (role) => {
      expect(canInitiateInvoiceApplication(role)).toBe(true);
    },
  );
  test.each(["general_manager", "boss", "", "unknown"])(
    "不扩大其他角色申请权限：%s",
    (role) => {
      expect(canInitiateInvoiceApplication(role)).toBe(false);
    },
  );

  test.each(adminRoles)(
    "管理员发起申请仍执行合同资格校验：%s",
    async (role) => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(
        createInvoiceApplication({ id: "admin-1", role }, draft),
      ).rejects.toMatchObject({ statusCode: 404, code: "CONTRACT_NOT_FOUND" });
      expect(pool.query).toHaveBeenCalled();
    },
  );

  test.each(adminRoles)("管理员不能直接审批本人申请：%s", async (role) => {
    await expect(
      decideInvoiceApplication(
        { id: "admin-1", role },
        "application-1",
        "approve",
        "",
        1,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  test.each(adminRoles)("管理员我的申请按本人账号过滤：%s", async (role) => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
    await expect(
      listInvoiceApplications({ id: "admin-1", role }, "mine"),
    ).resolves.toMatchObject({ items: [], total: 0 });
    const calls = (pool.query as jest.Mock).mock.calls;
    const listCall = calls.find(([sql]) =>
      sql.includes("SELECT application.*"),
    );
    expect(listCall?.[0]).toContain("application.applicant_id=$1");
    expect(listCall?.[1][0]).toBe("admin-1");
  });

  test.each(adminRoles)(
    "管理员处理记录按本人实际处理动作过滤：%s",
    async (role) => {
      (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
      await expect(
        listInvoiceApplications(
          { id: "admin-1", role },
          "admin_history",
          undefined,
          2,
          10,
        ),
      ).resolves.toMatchObject({ items: [], total: 0 });
      const calls = (pool.query as jest.Mock).mock.calls;
      expect(calls[0][0]).toContain(
        "(application.delivered_by=$1 OR application.issued_by=$1)",
      );
      expect(calls[1][0]).toContain("application.issued_by = $1");
      expect(calls[1][1]).toEqual(["admin-1", 10, 10]);
    },
  );

  test.each(["user", "general_manager", "boss"])(
    "非管理员不能读取管理员处理记录：%s",
    async (role) => {
      await expect(
        listInvoiceApplications({ id: "actor-1", role }, "admin_history"),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  test("管理员本人驳回提醒与执行待办同时返回", async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        {
          applicant_rejected: 2,
          pending_seal: 1,
          pending_issue: 3,
          pending_finance_registration: 1,
          pending_invoice: 4,
        },
      ],
    });
    await expect(
      getInvoiceApplicationPendingCounts({ id: "admin-1", role: "admin" }),
    ).resolves.toMatchObject({
      employeeActionPending: 2,
      adminPending: 5,
      total: 7,
    });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("applicant_id = $1 AND status = 'rejected'"),
      ["admin-1"],
    );
  });

  const actions = [
    [
      "修改草稿",
      (actor: { id: string; role: string }) =>
        updateInvoiceApplication(actor, "application-1", draft, 1),
    ],
    [
      "提交",
      (actor: { id: string; role: string }) =>
        submitInvoiceApplication(actor, "application-1", 1),
    ],
    [
      "撤回",
      (actor: { id: string; role: string }) =>
        withdrawInvoiceApplication(actor, "application-1", 1),
    ],
    [
      "删除草稿",
      (actor: { id: string; role: string }) =>
        deleteInvoiceApplicationDraft(actor, "application-1", 1),
    ],
    [
      "删除材料",
      (actor: { id: string; role: string }) =>
        deleteInvoiceApplicationMaterial(
          actor,
          "application-1",
          "material-1",
          1,
        ),
    ],
    [
      "生成三联单",
      (actor: { id: string; role: string }) =>
        generateMainBusinessTriplicate(
          actor,
          "application-1",
          { projectName: "项目", amount: 100 },
          1,
        ),
    ],
  ] as const;

  test.each(actions)("管理员不能操作他人的申请：%s", async (_label, action) => {
    const application = {
      id: "application-1",
      applicant_id: "employee-1",
      contract_id: "contract-1",
      status: "draft",
      version: 1,
    };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("SELECT * FROM invoice_applications"))
        return { rows: [application] };
      if (sql.includes("SELECT COALESCE(root_contract_id, id) AS root_id"))
        return { rows: [{ root_id: "contract-1" }] };
      return { rows: [] };
    });
    const mutableDb = db as unknown as {
      transaction?: (
        callback: (client: { query: typeof query }) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    const previous = mutableDb.transaction;
    mutableDb.transaction = async (callback) => callback({ query });
    try {
      await expect(
        action({ id: "admin-1", role: "admin" }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(
        query.mock.calls.some(([sql]) =>
          /^(UPDATE|DELETE|INSERT)/.test(sql.trim()),
        ),
      ).toBe(false);
    } finally {
      mutableDb.transaction = previous;
    }
  });
});
