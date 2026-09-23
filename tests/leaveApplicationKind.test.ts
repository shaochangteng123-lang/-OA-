import { getLeaveApplicationKindLabel } from "../src/utils/leaveApplication";

describe("请假申请方式标签", () => {
  it("区分独立返岗补假和关联补假", () => {
    expect(
      getLeaveApplicationKindLabel({
        application_kind: "supplement",
        combination_group_id: null,
        parent_request_id: null,
      }),
    ).toBe("返岗补假");
    expect(
      getLeaveApplicationKindLabel({
        application_kind: "supplement",
        combination_group_id: "group-1",
        parent_request_id: null,
      }),
    ).toBe("组合返岗补假");
    expect(
      getLeaveApplicationKindLabel({
        application_kind: "supplement",
        combination_group_id: null,
        parent_request_id: "parent-1",
      }),
    ).toBe("补假");
    expect(
      getLeaveApplicationKindLabel({
        application_kind: "supplement",
        combination_group_id: "group-2",
        parent_request_id: "parent-1",
      }),
    ).toBe("组合补假");
  });

  it("保留普通、组合和续假标签", () => {
    expect(getLeaveApplicationKindLabel({ application_kind: "normal" })).toBe(
      "普通请假",
    );
    expect(getLeaveApplicationKindLabel({ application_kind: "combined" })).toBe(
      "组合请假",
    );
    expect(
      getLeaveApplicationKindLabel({ application_kind: "extension" }),
    ).toBe("续假");
    expect(
      getLeaveApplicationKindLabel({
        application_kind: "extension",
        combination_group_id: "group-1",
      }),
    ).toBe("组合续假");
  });
});
