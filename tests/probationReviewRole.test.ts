/** @jest-environment node */

import { getMonthlyProbationReviewStages } from "../server/utils/probation-review";

describe("转正本月已审批角色范围", () => {
  it("按各角色实际负责的签署环节查询", () => {
    expect(getMonthlyProbationReviewStages("general_manager")).toEqual([
      "supervisor",
    ]);
    expect(getMonthlyProbationReviewStages("admin")).toEqual(["hr"]);
    expect(getMonthlyProbationReviewStages("super_admin")).toEqual([
      "supervisor",
      "hr",
    ]);
    expect(getMonthlyProbationReviewStages("chairman")).toEqual([
      "general_manager",
    ]);
  });

  it("不允许无关角色查询审批记录", () => {
    expect(getMonthlyProbationReviewStages("user")).toEqual([]);
    expect(getMonthlyProbationReviewStages("boss")).toEqual([]);
    expect(getMonthlyProbationReviewStages(null)).toEqual([]);
  });
});
