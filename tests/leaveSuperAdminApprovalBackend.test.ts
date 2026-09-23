/** @jest-environment node */

const mockPrepare = jest.fn();
const mockTransaction = jest.fn();
const mockAll = jest.fn();

jest.mock("../server/db/index", () => ({
  db: {
    prepare: mockPrepare,
    transaction: mockTransaction,
  },
}));
jest.mock("nanoid", () => ({ nanoid: jest.fn(() => "approval-log-1") }));
jest.mock("../server/services/leaveSchedule", () => ({
  enrichLeaveRequestsWithSchedule: jest.fn(async (rows: unknown[]) => rows),
}));

import type { Request, Response } from "express";
import router from "../server/routes/leave";

function routeHandler(method: "get" | "post", routePath: string) {
  const layer = router.stack.find(
    (item) => item.route?.path === routePath && item.route.methods[method],
  );
  const handler = layer?.route.stack.at(-1)?.handle;
  if (!handler) throw new Error(`缺少路由${method.toUpperCase()} ${routePath}`);
  return handler;
}

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

function baseRequest(
  role = "super_admin",
  overrides: Partial<Request> = {},
): Request {
  return {
    session: {
      userId: "super-admin-1",
      user: {
        id: "super-admin-1",
        name: "超级管理员甲",
        role,
      },
    },
    params: { id: "leave-1" },
    query: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

function pendingRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "employee-1",
    leave_type_code: "other",
    total_days: 1,
    balance_allocations_json: JSON.stringify([{ year: 2026, days: 1 }]),
    balance_reserved: false,
    start_date: "2026-09-21",
    start_half: "morning",
    end_date: "2026-09-21",
    end_half: "afternoon",
    status: "pending",
    approver_id: "manager-1",
    applicant_role: "user",
    assigned_approver_role: "general_manager",
    assigned_approver_status: "active",
    ...overrides,
  };
}

describe("超级管理员代总经理处理请假", () => {
  let clientQuery: jest.Mock;
  let lockedRequest: ReturnType<typeof pendingRequestRow>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    lockedRequest = pendingRequestRow();
    clientQuery = jest.fn(async (sql: string) => {
      if (sql.includes("SELECT lr.user_id")) {
        return { rows: [lockedRequest], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockTransaction.mockImplementation(async (callback) =>
      callback({ query: clientQuery }),
    );
    mockPrepare.mockImplementation((sql: string) => ({
      get: jest
        .fn()
        .mockResolvedValue(
          sql.includes("SELECT name, role FROM users")
            ? { name: "超级管理员甲", role: "super_admin" }
            : undefined,
        ),
      all: (...params: unknown[]) => mockAll(sql, ...params),
    }));
    mockAll.mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["approve", "/requests/:id/approve", { comment: "同意" }, "approve"],
    ["reject", "/requests/:id/reject", { rejectReason: "资料不足" }, "reject"],
  ] as const)(
    "超级管理员可%s活动总经理名下普通员工申请并记录真实操作人",
    async (methodName, routePath, body, expectedAction) => {
      const handler = routeHandler("post", routePath);
      const res = response();

      await handler(baseRequest("super_admin", { body }), res, jest.fn());

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
      );
      const selectCall = clientQuery.mock.calls.find(([sql]) =>
        String(sql).includes("SELECT lr.user_id"),
      );
      expect(selectCall?.[0]).toContain(
        "LEFT JOIN users assigned_approver ON assigned_approver.id = lr.approver_id",
      );
      expect(selectCall?.[0]).not.toContain("lr.approver_id = $2");

      const logCall = clientQuery.mock.calls.find(([sql]) =>
        String(sql).includes("INSERT INTO leave_approval_logs"),
      );
      expect(logCall?.[0]).toContain(`'${expectedAction}'`);
      expect(logCall?.[1]).toEqual(
        expect.arrayContaining(["super-admin-1", "超级管理员甲"]),
      );
    },
  );

  it("超级管理员不能审批需董事长处理的总经理申请", async () => {
    lockedRequest = pendingRequestRow({
      user_id: "manager-2",
      applicant_role: "general_manager",
      approver_id: "chairman-1",
      assigned_approver_role: "chairman",
      status: "approved",
    });
    const handler = routeHandler("post", "/requests/:id/approve");
    const res = response();

    await handler(baseRequest(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "申请不存在或无权操作",
    });
    expect(
      clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE leave_requests"),
      ),
    ).toBe(false);
  });

  it("有权处理的申请已结束时仍返回重复处理冲突", async () => {
    lockedRequest = pendingRequestRow({ status: "approved" });
    const handler = routeHandler("post", "/requests/:id/approve");
    const res = response();

    await handler(baseRequest(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "该申请已经处理，请勿重复操作",
    });
    expect(
      clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE leave_requests"),
      ),
    ).toBe(false);
  });

  it("超级管理员待办读取全部活动总经理范围且排除本人和总经理申请", async () => {
    const handler = routeHandler("get", "/pending");
    const res = response();

    await handler(baseRequest(), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    const [sql, ...params] = mockAll.mock.calls[0];
    expect(sql).toContain("assigned_manager.role = 'general_manager'");
    expect(sql).toContain("assigned_manager.status = 'active'");
    expect(sql).toContain("u.role <> 'general_manager'");
    expect(sql).toContain("lr.user_id <> ?");
    expect(params).toEqual(["super-admin-1"]);
  });

  it("总经理待办仍只读取分配给本人的申请", async () => {
    const handler = routeHandler("get", "/pending");
    const res = response();
    const req = baseRequest("general_manager");
    req.session.userId = "manager-1";
    req.session.user!.id = "manager-1";

    await handler(req, res, jest.fn());

    const [sql, ...params] = mockAll.mock.calls[0];
    expect(sql).toContain("lr.approver_id = ?");
    expect(sql).not.toContain("assigned_manager.role = 'general_manager'");
    expect(params).toEqual(["manager-1", "manager-1"]);
  });

  it("超级管理员统计聚合全部活动总经理和普通员工，不按自身编号过滤为空", async () => {
    const activeManagers = [
      { user_id: "manager-1", name: "总经理甲", department: "管理层" },
      { user_id: "manager-2", name: "总经理乙", department: "管理层" },
    ];
    const regularEmployees = [
      { user_id: "employee-1", name: "员工甲", department: "项目部" },
    ];
    mockPrepare.mockImplementation((sql: string) => ({
      get: jest.fn().mockResolvedValue(
        sql.includes("SELECT id, name, department, role")
          ? {
              id: "super-admin-1",
              name: "超级管理员甲",
              department: null,
              role: "super_admin",
            }
          : undefined,
      ),
      all: (...params: unknown[]) => {
        mockAll(sql, ...params);
        if (
          sql.includes("SELECT id AS user_id, name, department") &&
          sql.includes("role = 'general_manager'")
        ) {
          return Promise.resolve(activeManagers);
        }
        if (sql.includes("role IN ('user', 'admin')")) {
          return Promise.resolve(regularEmployees);
        }
        return Promise.resolve([]);
      },
    }));
    const handler = routeHandler("get", "/employee-statistics");
    const res = response();

    await handler(
      baseRequest("super_admin", { query: { year: "2026" } }),
      res,
      jest.fn(),
    );

    expect(res.status).not.toHaveBeenCalled();
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.manager).toEqual({
      id: "super-admin-1",
      name: "超级管理员甲",
      roleLabel: "超级管理员",
    });
    expect(
      payload.data.employees.map(
        (employee: { userId: string }) => employee.userId,
      ),
    ).toEqual(["employee-1", "manager-1", "manager-2"]);
    expect(
      payload.data.employees.some(
        (employee: { userId: string }) => employee.userId === "super-admin-1",
      ),
    ).toBe(false);

    const sourceQuery = mockAll.mock.calls.find(([sql]) =>
      String(sql).includes("FROM leave_requests lr"),
    );
    expect(sourceQuery?.[0]).toContain("lr.user_id = ANY(?::text[])");
    expect(sourceQuery?.slice(1, 4)).toEqual([
      ["manager-1", "manager-2"],
      ["manager-1", "manager-2"],
      ["manager-1", "manager-2"],
    ]);
    expect(sourceQuery?.slice(1)).not.toContain("super-admin-1");
  });
});
