/** @jest-environment node */
jest.mock("nanoid", () => ({ nanoid: jest.fn(() => "analysis-test") }));
jest.mock("../server/db/index", () => ({
  db: { all: jest.fn(), get: jest.fn() },
  pool: { connect: jest.fn() },
}));
jest.mock("../server/middleware/auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireExactRole: (roles: string[]) =>
    Object.assign((_req: unknown, _res: unknown, next: () => void) => next(), {
      allowedRoles: [...roles],
      exact: true,
    }),
}));
jest.mock("../server/services/monthlyFinancialAnalysis", () => ({
  loadMonthlyFinancialAnalysis: jest.fn(),
}));

import router from "../server/routes/monthly-financial-reports";
import { pool } from "../server/db/index";
import { loadMonthlyFinancialAnalysis } from "../server/services/monthlyFinancialAnalysis";
import { monthlyFinancialAnalysisVersion } from "../server/services/monthlyFinancialAnalysisWorkbook";
import type { MonthlyFinancialAnalysisData } from "../server/types/monthly-financial-analysis";

type Handler = (req: unknown, res: unknown) => Promise<void>;
function route(path: string) {
  const layer = (
    router as unknown as {
      stack: Array<{
        route?: {
          path: string;
          stack: Array<{
            handle: Handler & { allowedRoles?: string[]; exact?: boolean };
          }>;
        };
      }>;
    }
  ).stack.find((item) => item.route?.path === path);
  if (!layer?.route) throw new Error(`缺少路由${path}`);
  return layer.route;
}
function response() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
    setHeader: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}
function fixture(): MonthlyFinancialAnalysisData {
  return {
    query: { from: "2026-01", to: "2026-08", granularity: "month" },
    generatedAt: "2026-09-02T08:00:00Z",
    filterOptions: {
      parties: [],
      contractRegions: [],
      reimbursementScopes: [],
      people: [],
    },
    warnings: [],
    modules: [
      {
        key: "balances",
        title: "账户余额资金台帐",
        description: "期末值",
        sourceLabel: "月报",
        updatedAt: null,
        periods: [],
        series: [],
        summaries: [],
        breakdown: [],
        comparison: [],
        columns: [],
        details: [],
        warnings: [],
        appliedFilters: [],
      },
    ],
  };
}
const load = loadMonthlyFinancialAnalysis as jest.Mock;
const connect = pool.connect as unknown as jest.Mock;
let client: { query: jest.Mock; release: jest.Mock };
beforeEach(() => {
  jest.clearAllMocks();
  client = {
    query: jest.fn(async (sql: string) => ({
      rows: sql.startsWith("SELECT role")
        ? [{ role: "admin", status: "active" }]
        : [],
    })),
    release: jest.fn(),
  };
  connect.mockResolvedValue(client);
  load.mockResolvedValue(fixture());
});

describe("财务分析只读接口", () => {
  it.each(["/analysis", "/analysis/export"])(
    "%s 使用与月报相同的精确角色门禁",
    (path) => {
      const guard = route(path).stack[0].handle;
      expect([...(guard.allowedRoles || [])].sort()).toEqual([
        "admin",
        "general_manager",
        "super_admin",
      ]);
      expect(guard.exact).toBe(true);
    },
  );

  it("查询在同一可重复读只读事务内运行并附带数据版本", async () => {
    const res = response();
    await route("/analysis")
      .stack.at(-1)!
      .handle(
        {
          query: fixture().query,
          session: { user: { id: "admin-1", role: "admin" } },
        },
        res,
      );
    expect(client.query.mock.calls[0][0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(load.mock.calls[0][1].queryClient).toBe(client);
    expect(load.mock.calls[0][1].loadReport).toEqual(expect.any(Function));
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        ...fixture(),
        dataVersion: monthlyFinancialAnalysisVersion(fixture()),
      },
    });
  });

  it("无效筛选在连接数据库前拒绝", async () => {
    const res = response();
    await route("/analysis")
      .stack.at(-1)!
      .handle({ query: { from: "2026-02", to: "2026-01" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("开放月份只读重算最新业务而不读取过期保存金额，不执行任何写入", async () => {
    let loadedReport:
      | { income: { mainReceipt: string }; analysisLive?: boolean }
      | undefined;
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith("SELECT role"))
        return { rows: [{ role: "admin", status: "active" }] };
      if (sql.includes("SELECT report.*, closer.name"))
        return {
          rows: [
            {
              id: "report-8",
              report_month: "2026-08",
              status: "draft",
              version: 1,
              opening_balances_json: {
                general: "0",
                business: "0",
                welfare_one: "0",
                welfare_two: "0",
              },
              automatic_snapshot_json: {},
              last_refreshed_at: "2026-08-01",
              updated_at: "2026-08-01",
              closed_at: null,
            },
          ],
        };
      if (sql.includes("SELECT receipt.id, receipt.receipt_date"))
        return {
          rows: [
            {
              id: "new-receipt",
              receipt_date: "2026-08-12",
              amount: "100",
              rate_snapshot_json: null,
              title: "新回款",
              updated_at: "2026-08-12",
            },
          ],
        };
      return { rows: [] };
    });
    load.mockImplementation(async (_query, options) => {
      loadedReport = await options.loadReport("2026-08", client);
      return fixture();
    });
    const res = response();
    await route("/analysis")
      .stack.at(-1)!
      .handle(
        {
          query: fixture().query,
          session: { user: { id: "admin-1", role: "admin" } },
        },
        res,
      );
    expect(res.status).not.toHaveBeenCalled();
    expect(loadedReport?.income.mainReceipt).toBe("100");
    expect(loadedReport?.analysisLive).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]) =>
        /\b(INSERT|UPDATE|DELETE)\b/u.test(sql),
      ),
    ).toBe(false);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });

  it("事务内再次校验账号有效性，不给降权会话敏感数据", async () => {
    client.query.mockImplementation(async (sql: string) => ({
      rows: sql.startsWith("SELECT role")
        ? [{ role: "user", status: "active" }]
        : [],
    }));
    const res = response();
    await route("/analysis")
      .stack.at(-1)!
      .handle(
        {
          query: fixture().query,
          session: { user: { id: "admin-1", role: "admin" } },
        },
        res,
      );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(load).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("加载失败回滚并释放连接", async () => {
    load.mockRejectedValue(new Error("模拟来源读取失败"));
    const res = response();
    const errorLog = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await route("/analysis")
      .stack.at(-1)!
      .handle(
        {
          query: fixture().query,
          session: { user: { id: "admin-1", role: "admin" } },
        },
        res,
      );
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(500);
    errorLog.mockRestore();
  });

  it("数据发生变化时拒绝导出旧页面对应的文件", async () => {
    const res = response();
    await route("/analysis/export")
      .stack.at(-1)!
      .handle(
        {
          query: { ...fixture().query, dataVersion: "a".repeat(64) },
          session: { user: { id: "admin-1", role: "admin" } },
        },
        res,
      );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.send).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].code).toBe(
      "MONTHLY_FINANCE_ANALYSIS_CHANGED",
    );
  });

  it("版本一致才返回工作簿，不缓存敏感文件", async () => {
    const res = response();
    await route("/analysis/export")
      .stack.at(-1)!
      .handle(
        {
          query: {
            ...fixture().query,
            module: "balances",
            dataVersion: monthlyFinancialAnalysisVersion(fixture()),
          },
          session: { user: { id: "admin-1", role: "admin" } },
        },
        res,
      );
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
  });
});
