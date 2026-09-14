jest.mock("../server/db/index", () => ({
  db: {
    prepare: jest.fn(),
  },
}));

import type { NextFunction, Request, Response } from "express";
import { db } from "../server/db/index";
import { requireExactRole } from "../server/middleware/auth";

function request(role: string): Request {
  return {
    path: "/api/monthly-financial-reports/2026-08/close",
    session: {
      isLoggedIn: true,
      userId: `${role}-1`,
      user: {
        id: `${role}-1`,
        name: role,
        email: null,
        role,
        avatar_url: null,
        forceChangePassword: false,
      },
    },
  } as unknown as Request;
}

function response(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function mockActiveDatabaseUser(role: string): void {
  (db.prepare as jest.Mock).mockReturnValue({
    get: jest.fn().mockResolvedValue({
      id: `${role}-1`,
      name: role,
      email: null,
      role,
      avatar_url: null,
      status: "active",
      force_change_password: false,
    }),
  });
}

describe("月度财务报表精确角色中间件", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("超级管理员通过月报维护权限", async () => {
    mockActiveDatabaseUser("super_admin");
    const middleware = requireExactRole(["admin", "super_admin"]);
    const res = response();
    const next: NextFunction = jest.fn();

    await middleware(request("super_admin"), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("普通管理员通过月报维护权限", async () => {
    mockActiveDatabaseUser("admin");
    const middleware = requireExactRole(["admin", "super_admin"]);
    const res = response();
    const next: NextFunction = jest.fn();

    await middleware(request("admin"), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("董事长不继承超级管理员的月报权限", async () => {
    mockActiveDatabaseUser("chairman");
    const middleware = requireExactRole(["admin", "super_admin"]);
    const res = response();
    const next: NextFunction = jest.fn();

    await middleware(request("chairman"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "权限不足",
    });
  });

  it("总经理不能通过月报维护权限", async () => {
    mockActiveDatabaseUser("general_manager");
    const middleware = requireExactRole(["admin", "super_admin"]);
    const res = response();
    const next: NextFunction = jest.fn();

    await middleware(request("general_manager"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "权限不足",
    });
  });
});
