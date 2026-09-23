import fs from "fs";
import path from "path";
import {
  resolveStandaloneLeaveApplicationKind,
  validateLeavePeriod,
  validateReturnSupplementPeriod,
} from "../server/utils/leave";

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("独立返岗补假后端规则", () => {
  const routeSource = fs.readFileSync(
    path.resolve(process.cwd(), "server/routes/leave.ts"),
    "utf8",
  );

  it("严格区分普通、组合和返岗补假申请类型", () => {
    expect(resolveStandaloneLeaveApplicationKind(undefined, "single")).toBe(
      "normal",
    );
    expect(resolveStandaloneLeaveApplicationKind("supplement", "single")).toBe(
      "supplement",
    );
    expect(
      resolveStandaloneLeaveApplicationKind("combined", "single"),
    ).toBeNull();
    expect(resolveStandaloneLeaveApplicationKind(undefined, "combined")).toBe(
      "combined",
    );
    expect(
      resolveStandaloneLeaveApplicationKind("supplement", "combined"),
    ).toBe("supplement");
    expect(
      resolveStandaloneLeaveApplicationKind("extension", "combined"),
    ).toBeNull();
  });

  it("历史日期仅在返岗补假中放开，且返岗补假不得晚于今天", () => {
    expect(
      validateLeavePeriod(
        "2026-07-16",
        "morning",
        "2026-07-16",
        "afternoon",
        "2026-07-17",
      ),
    ).toBe("开始日期不能早于今天");
    expect(
      validateLeavePeriod(
        "2026-07-16",
        "morning",
        "2026-07-16",
        "afternoon",
        "0000-01-01",
      ),
    ).toBeNull();
    expect(
      validateReturnSupplementPeriod("2026-07-16", "2026-07-16", "2026-07-17"),
    ).toBeNull();
    expect(
      validateReturnSupplementPeriod("2026-07-16", "2026-07-18", "2026-07-17"),
    ).toBe("返岗补假日期不能晚于今天");
  });

  it("单一和组合提交保存补假类型，并复用现有待审批创建流程", () => {
    const singleRoute = sourceBetween(
      routeSource,
      "router.post('/requests'",
      "// 提交组合请假",
    );
    expect(singleRoute).toContain(
      "resolveStandaloneLeaveApplicationKind(req.body.applicationKind, 'single')",
    );
    expect(singleRoute).toContain(
      "validateReturnSupplementPeriod(startDate, endDate)",
    );
    expect(singleRoute).toContain(
      "submitted_at, application_kind, created_at, updated_at",
    );
    expect(singleRoute).toContain("applicationKind,");

    const combinedRoute = sourceBetween(
      routeSource,
      "'/requests/combined'",
      "// 查询本人申请列表",
    );
    expect(combinedRoute).toContain(
      "resolveStandaloneLeaveApplicationKind(req.body.applicationKind, 'combined')",
    );
    expect(combinedRoute).toContain(
      "validateReturnSupplementPeriod(startDate, endDate)",
    );
    expect(combinedRoute).toContain("applicationKind,");
    expect(combinedRoute).toContain("combinationGroupId,");
  });

  it("驳回重提保留补假类型和空父申请，并再次校验日期上限", () => {
    const resubmitRoute = sourceBetween(
      routeSource,
      "router.post('/requests/:id/resubmit'",
      "// ==================== 审批端接口",
    );
    expect(resubmitRoute).toContain(
      "originalRequest.application_kind === 'supplement'",
    );
    expect(resubmitRoute).toContain("!originalRequest.parent_request_id");
    expect(resubmitRoute).toContain(
      "validateReturnSupplementPeriod(startDate, endDate)",
    );
    expect(resubmitRoute).toContain("lockedRequest.application_kind");
    expect(resubmitRoute).toContain("lockedRequest.combination_group_id");
    expect(resubmitRoute).toContain("lockedRequest.parent_request_id");

    const resubmitFormSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/leave/LeaveResubmitForm.vue"),
      "utf8",
    );
    expect(resubmitFormSource).toContain("isStandaloneReturnSupplement");
    expect(resubmitFormSource).toContain("isFutureLeaveDateDisabled(time)");
    expect(resubmitFormSource).toContain(
      "isReturnSupplementEndDateDisabled(time, form.value.startDate)",
    );
  });
});
