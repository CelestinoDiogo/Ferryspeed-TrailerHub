import type { Database } from "@/lib/database.types";
import type { PermissionModuleKey } from "@/lib/auth/permissions";
import type { RoleKey } from "@/lib/rbac/constants";

export type AppRoleRow = Database["public"]["Tables"]["app_roles"]["Row"];
export type AppUserRoleRow = Database["public"]["Tables"]["app_user_roles"]["Row"];
export type AppRolePermissionRow = Database["public"]["Tables"]["app_role_permissions"]["Row"];
export type AppPermissionModuleRow = Database["public"]["Tables"]["app_permission_modules"]["Row"];

export type PermissionMatrixItem = {
  roleKey: string;
  moduleKey: PermissionModuleKey;
  moduleLabel: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReports: boolean;
};

export type SettingsUserListItem = {
  userId: string;
  email: string | null;
  displayName: string | null;
  roleKey: RoleKey | null;
  isActive: boolean | null;
  lastSignInAt: string | null;
  driverLinked: boolean;
};
