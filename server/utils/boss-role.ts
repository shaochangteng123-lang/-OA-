const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const EXACT_PERSONAL_MUTATION_PATHS = new Set([
  "/api/auth/change-password",
  "/api/auth/logout",
]);

const PERSONAL_MUTATION_PATHS = ["/api/user-preferences"];

interface UserCreationRequiredFields {
  username: string;
  password: unknown;
  email: string;
  mobile: string;
  department: unknown;
  position: unknown;
  role: unknown;
}

export function isBossRole(role: unknown): role is "boss" {
  return role === "boss";
}

export function isSystemAdminRole(role: unknown): role is "super_admin" {
  return role === "super_admin";
}

export function requiresEmployeeProfile(role: unknown): boolean {
  return !isBossRole(role) && !isSystemAdminRole(role);
}

export function getBossRoleTransitionError(
  currentRole: unknown,
  nextRole: unknown,
): string | null {
  if (
    currentRole !== nextRole &&
    (isBossRole(currentRole) || isBossRole(nextRole))
  ) {
    return "BOSS账号需单独创建，不能与员工账号互相转换";
  }

  return null;
}

export function resolveUserAccountName(
  role: unknown,
  username: unknown,
  name: unknown,
  currentName: string,
): string {
  const normalizedUsername =
    typeof username === "string" ? username.trim() : "";
  const normalizedName = typeof name === "string" ? name.trim() : "";

  return isBossRole(role)
    ? normalizedUsername || currentName
    : normalizedName || currentName;
}

export function getUserCreationRequiredFieldsError(
  fields: UserCreationRequiredFields,
): string | null {
  if (!fields.username || !fields.password) {
    return requiresEmployeeProfile(fields.role)
      ? "用户名、密码、邮箱、手机号、部门、职位为必填项"
      : "用户名、密码为必填项";
  }

  if (
    requiresEmployeeProfile(fields.role) &&
    (!fields.email ||
      !fields.mobile ||
      !fields.department ||
      !fields.position)
  ) {
    return "用户名、密码、邮箱、手机号、部门、职位为必填项";
  }

  return null;
}

function matchesAllowedPath(path: string, allowedPath: string): boolean {
  if (allowedPath.endsWith("/")) {
    return path.startsWith(allowedPath);
  }

  return path === allowedPath || path.startsWith(`${allowedPath}/`);
}

export function isBossRequestAllowed(method: string, path: string): boolean {
  if (READ_ONLY_METHODS.has(method.toUpperCase())) {
    return true;
  }

  return (
    EXACT_PERSONAL_MUTATION_PATHS.has(path) ||
    PERSONAL_MUTATION_PATHS.some((allowedPath) =>
      matchesAllowedPath(path, allowedPath),
    )
  );
}
