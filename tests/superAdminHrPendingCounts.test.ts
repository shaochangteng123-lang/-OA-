import fs from "node:fs";
import path from "node:path";

function readPendingCountsRoute(): string {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/approval.ts"),
    "utf8",
  );
  const start = source.indexOf("router.get('/pending-counts'");
  const end = source.indexOf("router.get('/:id'", start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("超级管理员人力资源待办计数", () => {
  const route = readPendingCountsRoute();

  it("转正待签合并活动总经理名下主管任务与原人事部任务", () => {
    expect(route).toContain(
      "LEFT JOIN users supervisor ON supervisor.id = pc.supervisor_id",
    );
    expect(route).toContain("? = 'super_admin'");
    expect(route).toContain("supervisor.role = 'general_manager'");
    expect(route).toContain("supervisor.status = 'active'");
    expect(route).toContain("pc.review_stage = 'hr'");
    expect(route).toContain("? IN ('admin', 'super_admin')");
    expect(route).toContain("AND COALESCE(ep.user_id, '') <> ?");
    expect(route).toContain(
      "data.probationPending = data.probationSignaturePending",
    );
  });

  it("超级管理员请假待办只接管活动总经理名下的非总经理申请", () => {
    const leaveStart = route.indexOf("data.leaveApprovalPending = 0");
    const leaveEnd = route.indexOf("// 所有用户：本人尚未查看", leaveStart);
    const leaveCount = route.slice(leaveStart, leaveEnd);

    expect(leaveStart).toBeGreaterThanOrEqual(0);
    expect(leaveEnd).toBeGreaterThan(leaveStart);
    expect(leaveCount).toContain("else if (user.role === 'super_admin')");
    expect(leaveCount).toContain("AND lr.user_id <> ?");
    expect(leaveCount).toContain("AND applicant.role <> 'general_manager'");
    expect(leaveCount).not.toContain("applicant.role IN ('user', 'admin'");
    expect(leaveCount).toContain("assigned_manager.role = 'general_manager'");
    expect(leaveCount).toContain("assigned_manager.status = 'active'");
    expect(leaveCount).not.toContain("else if (user.role === 'admin')");
  });

  it("总经理与董事长仍只统计分配给本人且非本人申请", () => {
    expect(route).toContain(
      "if (user.role === 'general_manager' || user.role === 'chairman')",
    );
    expect(route).toMatch(
      /WHERE status = 'pending'\s+AND approver_id = \?\s+AND user_id <> \?/,
    );
  });
});
