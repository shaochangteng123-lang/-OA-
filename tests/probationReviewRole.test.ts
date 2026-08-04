/** @jest-environment node */

import { getMonthlyProbationReviewStage } from "../server/utils/probation-review";

describe("转正本月已审批角色范围", () => {
  it("按各角色实际负责的签署环节查询", () => {
    expect(getMonthlyProbationReviewStage("general_manager")).toBe(
      "supervisor",
    );
    expect(getMonthlyProbationReviewStage("admin")).toBe("hr");
    expect(getMonthlyProbationReviewStage("super_admin")).toBe("hr");
    expect(getMonthlyProbationReviewStage("chairman")).toBe("general_manager");
  });

  it("不允许无关角色查询审批记录", () => {
    expect(getMonthlyProbationReviewStage("user")).toBeNull();
    expect(getMonthlyProbationReviewStage("boss")).toBeNull();
    expect(getMonthlyProbationReviewStage(null)).toBeNull();
  });
});
