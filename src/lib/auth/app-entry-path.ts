import { canAccessModule } from "@/lib/auth/permissions";
import { roleKeys, type RoleKey } from "@/lib/auth/roles";

export const APP_ENTRY_PATH = "/";
export const DRIVER_HOME_PATH = "/dashboard/driver";
export const MASTER_MOBILE_PATH = "/dashboard/mobile";
export const DESKTOP_HOME_PATH = "/dashboard";

const toRoleKey = (value: string | null | undefined): RoleKey | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "admin") {
    return "administrator";
  }

  return roleKeys.includes(normalized as RoleKey) ? (normalized as RoleKey) : null;
};

export const isSafeReturnToPath = (value: string | null | undefined): value is string => {
  const candidate = value?.trim() ?? "";
  return candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.startsWith("/\\");
};

export const toReturnPathname = (path: string) => {
  try {
    return new URL(path, "https://trailerhub.local").pathname;
  } catch {
    return path.split("?")[0] || path;
  }
};

export const isDriverMobilePath = (pathname: string) => {
  return pathname === DRIVER_HOME_PATH || pathname.startsWith(`${DRIVER_HOME_PATH}/`);
};

export const isDashboardPath = (pathname: string) => {
  return pathname === DESKTOP_HOME_PATH || pathname.startsWith(`${DESKTOP_HOME_PATH}/`);
};

export const resolveRoleHomePath = (input: {
  roleKey?: string | null;
  isActive?: boolean | null;
  standalone: boolean;
}) => {
  const roleKey = toRoleKey(input.roleKey);
  if (roleKey === "driver" && input.isActive !== false) {
    return DRIVER_HOME_PATH;
  }

  return input.standalone ? MASTER_MOBILE_PATH : DESKTOP_HOME_PATH;
};

export const canRoleAccessPath = (roleKey: string | null | undefined, path: string) => {
  const pathname = toReturnPathname(path);
  if (pathname === APP_ENTRY_PATH) {
    return false;
  }

  const parsedRole = toRoleKey(roleKey);
  if (!parsedRole) {
    return isSafeReturnToPath(path);
  }

  if (isDriverMobilePath(pathname)) {
    return canAccessModule(parsedRole, "driver_mobile");
  }

  if (isDashboardPath(pathname)) {
    return canAccessModule(parsedRole, "dashboard");
  }

  return isSafeReturnToPath(path);
};

export const resolveRoleAwareEntryPath = (input: {
  roleKey?: string | null;
  isActive?: boolean | null;
  returnTo: string | null;
  standalone: boolean;
}) => {
  const home = resolveRoleHomePath(input);
  const candidate = input.returnTo?.trim() ?? "";

  if (!isSafeReturnToPath(candidate)) {
    return home;
  }

  if (!canRoleAccessPath(input.roleKey, candidate)) {
    return home;
  }

  return candidate;
};
