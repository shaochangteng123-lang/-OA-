/** @jest-environment node */
const mockPrepare = jest.fn();
jest.mock("nanoid", () => ({ nanoid: jest.fn(() => "preview-test") }));
jest.mock("../server/db/index", () => ({
  db: { all: jest.fn(), get: jest.fn() },
  pool: { connect: jest.fn() },
}));
jest.mock("../server/middleware/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireExactRole: (roles: string[]) =>
    Object.assign((_req: unknown, _res: unknown, next: () => void) => next(), {
      allowedRoles: roles,
    }),
}));
jest.mock("../server/services/monthlyFinancialProjectReceiptPreview", () => ({
  prepareProjectReceiptPreview: (...args: unknown[]) => mockPrepare(...args),
  ProjectReceiptPreviewError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
import router from "../server/routes/monthly-financial-reports";
import { pool } from "../server/db/index";
import { ProjectReceiptPreviewError } from "../server/services/monthlyFinancialProjectReceiptPreview";

const routePath = "/analysis/projects/:rootId/receipts/:receiptId/preview";
type Handler = (req: unknown, res: unknown) => Promise<void>;
function route() {
  return (
    router as unknown as {
      stack: Array<{
        route?: {
          path: string;
          stack: Array<{ handle: Handler & { allowedRoles?: string[] } }>;
        };
      }>;
    }
  ).stack.find((item) => item.route?.path === routePath)!.route!;
}
function response() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    sendFile: jest.fn(),
    headersSent: false,
  };
  res.status.mockReturnValue(res);
  res.sendFile.mockImplementation(
    (_file: string, done: (error: Error | null) => void) => done(null),
  );
  return res;
}
function request() {
  return {
    session: { user: { id: "actor", role: "admin" } },
    params: { rootId: "root", receiptId: "receipt" },
    query: { from: "2026-08", to: "2026-08", evidenceVersion: "a".repeat(64) },
  };
}
let client: { query: jest.Mock; release: jest.Mock };
beforeEach(() => {
  jest.clearAllMocks();
  client = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() };
  (pool.connect as jest.Mock).mockResolvedValue(client);
  mockPrepare.mockResolvedValue({
    absolutePath: "/仅测试受控目录/回单.pdf",
    fileName: "回单.pdf",
    mimeType: "application/pdf",
  });
});

describe("分析项目回款窄预览路由", () => {
  it("沿用精确财务角色，使用只读事务并传递完整项目期间和证据版本", async () => {
    expect([...route().stack[0].handle.allowedRoles!].sort()).toEqual([
      "admin",
      "general_manager",
      "super_admin",
    ]);
    const req = request();
    const res = response();
    await route().stack.at(-1)!.handle(req, res);
    expect(client.query).toHaveBeenCalledWith(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(mockPrepare).toHaveBeenCalledWith({
      client,
      actorId: "actor",
      rootContractId: "root",
      receiptId: "receipt",
      from: "2026-08",
      to: "2026-08",
      evidenceVersion: "a".repeat(64),
    });
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff",
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/pdf",
    );
    expect(res.sendFile).toHaveBeenCalledWith(
      "/仅测试受控目录/回单.pdf",
      expect.any(Function),
    );
    expect(res.json).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledTimes(1);
  });
  it.each([400, 403, 404, 409])(
    "预览校验失败%d时回滚并返回中文，不能继续发文件",
    async (status) => {
      mockPrepare.mockRejectedValueOnce(
        new ProjectReceiptPreviewError(status, "该凭证当前不可预览"),
      );
      const res = response();
      await route().stack.at(-1)!.handle(request(), res);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(res.status).toHaveBeenCalledWith(status);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        code: "MONTHLY_FINANCE_PROJECT_RECEIPT_PREVIEW_UNAVAILABLE",
        message: "该凭证当前不可预览",
      });
      expect(res.sendFile).not.toHaveBeenCalled();
      expect(client.release).toHaveBeenCalledTimes(1);
    },
  );
  it("登录信息缺失不打开连接，底层错误不透出磁盘路径", async () => {
    const unauthorized = response();
    await route()
      .stack.at(-1)!
      .handle({ ...request(), session: {} }, unauthorized);
    expect(unauthorized.status).toHaveBeenCalledWith(401);
    expect(pool.connect).not.toHaveBeenCalled();
    mockPrepare.mockRejectedValueOnce(
      new Error("读取失败 /private/机密目录/file.pdf"),
    );
    const failure = response();
    await route().stack.at(-1)!.handle(request(), failure);
    expect(failure.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(failure.json.mock.calls)).not.toContain("private");
    expect(failure.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "回款凭证预览失败，请稍后重试" }),
    );
  });
});
