import {
  getUserCreationRequiredFieldsError,
  isBossRequestAllowed,
  requiresEmployeeProfile,
} from "../server/utils/boss-role";
import { ROLE_PERMISSIONS } from "../src/types";

describe("BOSS角色权限", () => {
  it("只包含经营查看所需权限", () => {
    const permissions = ROLE_PERMISSIONS.boss;

    expect(permissions).toEqual(
      expect.arrayContaining([
        "view_worklogs",
        "view_projects",
        "view_calendar",
        "view_worklog_entries",
      ]),
    );
    expect(
      permissions.some(
        (permission) =>
          permission.startsWith("create_") ||
          permission.startsWith("edit_") ||
          permission.startsWith("delete_") ||
          permission.startsWith("manage_"),
      ),
    ).toBe(false);
  });

  it("允许读取经营数据，拒绝修改业务数据", () => {
    expect(isBossRequestAllowed("GET", "/api/boss-dashboard/summary")).toBe(
      true,
    );
    expect(isBossRequestAllowed("POST", "/api/reimbursement")).toBe(false);
    expect(isBossRequestAllowed("PUT", "/api/projects/project-1")).toBe(false);
    expect(isBossRequestAllowed("PATCH", "/api/worklog-projects/project-1")).toBe(
      false,
    );
    expect(isBossRequestAllowed("DELETE", "/api/worklog-entries/entry-1")).toBe(
      false,
    );
  });

  it("保留账号安全和个人偏好，但不开放员工档案维护", () => {
    expect(isBossRequestAllowed("POST", "/api/auth/change-password")).toBe(
      true,
    );
    expect(isBossRequestAllowed("POST", "/api/auth/logout")).toBe(true);
    expect(isBossRequestAllowed("POST", "/api/auth/signature")).toBe(false);
    expect(isBossRequestAllowed("PUT", "/api/user-preferences")).toBe(true);
    expect(
      isBossRequestAllowed("POST", "/api/employees/my-profile/submit"),
    ).toBe(false);
    expect(
      isBossRequestAllowed("POST", "/api/employees/my-profile-other"),
    ).toBe(false);
  });
});

describe("系统账号资料规则", () => {
  it("超级管理员、董事长和BOSS不要求员工档案字段", () => {
    expect(requiresEmployeeProfile("super_admin")).toBe(false);
    expect(requiresEmployeeProfile("chairman")).toBe(false);
    expect(requiresEmployeeProfile("boss")).toBe(false);
    expect(requiresEmployeeProfile("admin")).toBe(true);

    expect(
      getUserCreationRequiredFieldsError({
        username: "admin",
        password: "secret",
        email: "",
        mobile: "",
        department: null,
        position: null,
        role: "super_admin",
      }),
    ).toBeNull();
  });

  it("董事长与超级管理员权限完全一致", () => {
    expect(ROLE_PERMISSIONS.chairman).toEqual(ROLE_PERMISSIONS.super_admin);
  });
});
