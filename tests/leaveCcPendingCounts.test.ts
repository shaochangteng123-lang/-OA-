/** @jest-environment node */

const mockPrepare = jest.fn();
const mockUnreadLeaveCcCount = jest.fn();

jest.mock("../server/db/index", () => ({
  db: { prepare: mockPrepare },
}));
jest.mock("../server/services/leaveCcNotice", () => ({
  getUnreadLeaveCcCount: mockUnreadLeaveCcCount,
}));
jest.mock("nanoid", () => ({ nanoid: jest.fn(() => "测试编号") }));

import type { Request, Response } from "express";
import router from "../server/routes/approval";

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

const handler = router.stack.find(
  (item) => item.route?.path === "/pending-counts" && item.route.methods.get,
)?.route.stack.at(-1)?.handle;

async function fetchCounts(role: string | null, sessionRole = role) {
  if (!handler) throw new Error("缺少待办计数路由");
  mockPrepare.mockImplementation((sql: string) => ({
    get: jest.fn(async () => {
      if (sql === "SELECT role FROM users WHERE id = ?") {
        return role ? { role } : undefined;
      }
      if (sql.includes("SELECT ep.id, ep.employment_status")) return undefined;
      return { count: 0 };
    }),
    all: jest.fn(async () => []),
  }));
  const req = {
    session: {
      userId: "接收人甲",
      user: { id: "接收人甲", role: sessionRole },
    },
  } as unknown as Request;
  const res = response();
  await handler(req, res, jest.fn());
  return res;
}

describe("请假抄送未读计数", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnreadLeaveCcCount.mockResolvedValue(3);
  });

  it.each(["admin", "super_admin"])(
    "%s 按当前接收人获取未读抄送，不混入请假审批待办",
    async (role) => {
      const res = await fetchCounts(role);
      expect(mockUnreadLeaveCcCount).toHaveBeenCalledTimes(1);
      expect(mockUnreadLeaveCcCount).toHaveBeenCalledWith("接收人甲");
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ leaveCcUnread: 3, leaveApprovalPending: 0 }),
      });
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  it.each(["user", "general_manager", "chairman", "boss"])(
    "%s 不查询抄送未读且固定返回零",
    async (role) => {
      const res = await fetchCounts(role);
      expect(mockUnreadLeaveCcCount).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({ leaveCcUnread: 0 }),
      });
    },
  );

  it("使用数据库实时角色，旧会话中的超级管理员身份不能获得抄送计数", async () => {
    const res = await fetchCounts("user", "super_admin");
    expect(mockUnreadLeaveCcCount).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ leaveCcUnread: 0 }),
    });
  });

  it("已移除的用户返回未登录结果，不查询抄送通知", async () => {
    const res = await fetchCounts(null, "super_admin");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockUnreadLeaveCcCount).not.toHaveBeenCalled();
  });
});
