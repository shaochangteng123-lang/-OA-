import {
  normalizeDepartmentPositionMap,
  validateDepartmentPositionPair,
} from "../server/utils/department-position";

describe("部门职位配置", () => {
  it("清理部门职位首尾空格并去重", () => {
    const result = normalizeDepartmentPositionMap({
      " 项目部 ": [" 项目经理 ", "员工", "员工"],
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      项目部: ["项目经理", "员工"],
    });
  });

  it("只允许选择所属部门已配置的职位", () => {
    const config = {
      项目部: ["项目经理", "员工"],
    };

    expect(
      validateDepartmentPositionPair(config, "项目部", "项目经理").error,
    ).toBeNull();
    expect(
      validateDepartmentPositionPair(config, "项目部", "行政主管").error,
    ).toBe('职位“行政主管”不属于部门“项目部”');
  });

  it("旧账号允许部门和职位同时为空", () => {
    expect(
      validateDepartmentPositionPair({}, null, null, true),
    ).toEqual({
      department: null,
      position: null,
      error: null,
    });
  });
});
