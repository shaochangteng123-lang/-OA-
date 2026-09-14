export function isRouteRoleAllowed(
  role: string | null | undefined,
  requiredRoles: readonly string[],
  exactRoleMatch = false,
): boolean {
  if (!role) return false;
  if (requiredRoles.includes(role)) return true;

  return (
    !exactRoleMatch &&
    role === "chairman" &&
    requiredRoles.includes("super_admin")
  );
}
