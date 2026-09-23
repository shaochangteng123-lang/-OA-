jest.mock("../server/db/index", () => ({
  db: {
    prepare: jest.fn(),
  },
}));

import type { NextFunction, Request, Response } from "express";
import { db } from "../server/db/index";
import {
  requireLeaveOperator,
  requireLeaveStatisticsViewer,
} from "../server/middleware/auth";

function request(role: string): Request {
  return {
    path: "/api/leave/pending",
    session: {
      isLoggedIn: true,
      userId: `${role}-1`,
      user: {
        id: `${role}-1`,
        name: role,
        email: null,
        role,
        avatar_url: null,
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

function mockActiveUser(role: string) {
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

describe("请假超级管理员精确门禁", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each(["general_manager", "chairman", "super_admin"])(
    "%s 可进入请假审批接口",
    async (role) => {
      mockActiveUser(role);
      const res = response();
      const next: NextFunction = jest.fn();

      await requireLeaveOperator(request(role), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  it("普通管理员不能进入请假审批接口", async () => {
    mockActiveUser("admin");
    const res = response();
    const next: NextFunction = jest.fn();

    await requireLeaveOperator(request("admin"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it.each(["general_manager", "super_admin"])(
    "%s 可进入员工请假统计接口",
    async (role) => {
      mockActiveUser(role);
      const res = response();
      const next: NextFunction = jest.fn();

      await requireLeaveStatisticsViewer(request(role), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  it.each(["admin", "chairman"])(
    "%s 不能进入员工请假统计接口",
    async (role) => {
      mockActiveUser(role);
      const res = response();
      const next: NextFunction = jest.fn();

      await requireLeaveStatisticsViewer(request(role), res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    },
  );
});
