import {
  canCreateChairmanAccount,
  getBossRoleTransitionError,
  getStandaloneRoleTransitionError,
  getUserCreationRequiredFieldsError,
  isBossRole,
  isChairmanRole,
  isRoleAllowed,
  requiresEmployeeProfile,
  resolveUserAccountName,
} from "../server/utils/boss-role";

describe("BOSS轻量账号", () => {
  it("BOSS账号只要求用户名和密码", () => {
    expect(
      getUserCreationRequiredFieldsError({
        username: "boss",
        password: "BossPassword_2026!",
        email: "",
        mobile: "",
        department: "",
        position: "",
        role: "boss",
      }),
    ).toBeNull();
  });

  it("BOSS账号仍然必须提供用户名和密码", () => {
    expect(
      getUserCreationRequiredFieldsError({
        username: "",
        password: "",
        email: "",
        mobile: "",
        department: "",
        position: "",
        role: "boss",
      }),
    ).toBe("用户名、密码为必填项");
  });

  it("董事长账号只要求用户名和密码且不建立员工档案", () => {
    expect(
      getUserCreationRequiredFieldsError({
        username: "chairman",
        password: "ChairmanPassword_2026!",
        email: "",
        mobile: "",
        department: "",
        position: "",
        role: "chairman",
      }),
    ).toBeNull();
    expect(isChairmanRole("chairman")).toBe(true);
    expect(requiresEmployeeProfile("chairman")).toBe(false);
  });

  it("董事长可通过超级管理员权限校验", () => {
    expect(isRoleAllowed("chairman", ["super_admin"])).toBe(true);
    expect(isRoleAllowed("chairman", ["general_manager"])).toBe(false);
  });

  it("管理员可以创建董事长账号但普通用户不能创建", () => {
    expect(canCreateChairmanAccount("admin")).toBe(true);
    expect(canCreateChairmanAccount("super_admin")).toBe(true);
    expect(canCreateChairmanAccount("chairman")).toBe(true);
    expect(canCreateChairmanAccount("general_manager")).toBe(false);
    expect(canCreateChairmanAccount("user")).toBe(false);
  });

  it("普通角色继续要求完整员工基础字段", () => {
    expect(
      getUserCreationRequiredFieldsError({
        username: "employee",
        password: "EmployeePassword_2026!",
        email: "",
        mobile: "",
        department: "",
        position: "",
        role: "user",
      }),
    ).toBe("用户名、密码、邮箱、手机号、部门、职位为必填项");
  });

  it("BOSS不进入员工档案流程", () => {
    expect(isBossRole("boss")).toBe(true);
    expect(requiresEmployeeProfile("boss")).toBe(false);
    expect(requiresEmployeeProfile("user")).toBe(true);
  });

  it("BOSS账号必须单独创建，不能与员工账号互转", () => {
    expect(getBossRoleTransitionError("user", "boss")).toBe(
      "BOSS账号需单独创建，不能与员工账号互相转换",
    );
    expect(getBossRoleTransitionError("boss", "admin")).toBe(
      "BOSS账号需单独创建，不能与员工账号互相转换",
    );
    expect(getBossRoleTransitionError("boss", "boss")).toBeNull();
    expect(getBossRoleTransitionError("user", "admin")).toBeNull();
  });

  it("编辑BOSS用户名时同步更新显示名称", () => {
    expect(
      resolveUserAccountName("boss", "董事长", "旧显示名", "原BOSS"),
    ).toBe("董事长");
    expect(
      resolveUserAccountName("user", "employee", "员工新名称", "员工旧名称"),
    ).toBe("员工新名称");
  });

  it("董事长账号必须单独创建，不能与员工账号互转", () => {
    expect(getStandaloneRoleTransitionError("user", "chairman")).toBe(
      "BOSS、董事长和超级管理员账号需单独创建，不能转换角色",
    );
    expect(getStandaloneRoleTransitionError("chairman", "admin")).toBe(
      "BOSS、董事长和超级管理员账号需单独创建，不能转换角色",
    );
    expect(getStandaloneRoleTransitionError("chairman", "chairman")).toBeNull();
  });
});
