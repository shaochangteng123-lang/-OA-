import fs from "fs";
import path from "path";

describe("报销历史数据展示口径", () => {
  const serverIndexSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/index.ts"),
    "utf8",
  );
  const approvalRouteSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/approval.ts"),
    "utf8",
  );

  it("不再启动超过90天报销单自动归档任务", () => {
    expect(serverIndexSource).not.toContain("setupReimbursementCleanup");
    expect(serverIndexSource).not.toContain("月末报销数据自动归档任务已启动");
  });

  it("管理员全部查询不排除历史标记记录", () => {
    const routeStart = approvalRouteSource.indexOf(
      "router.get('/all-reimbursements'",
    );
    const routeEnd = approvalRouteSource.indexOf(
      "router.get('/export-monthly'",
      routeStart,
    );
    const routeSource = approvalRouteSource.slice(routeStart, routeEnd);

    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(routeEnd).toBeGreaterThan(routeStart);
    expect(routeSource).not.toContain("is_deleted");
    expect(routeSource).toContain(
      "r.status IN ('payment_uploaded', 'completed')",
    );
  });
});
