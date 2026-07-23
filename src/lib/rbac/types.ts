import type { Database } from "@/lib/database.types";
import type { PermissionModuleKey } from "@/lib/auth/permissions";

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
