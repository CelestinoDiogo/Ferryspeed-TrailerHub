export const roleKeys = ["administrator", "supervisor", "operator", "driver"] as const;
export type RoleKey = (typeof roleKeys)[number];

export const permissionModuleKeys = [
  "dashboard",
  "operations",
  "yard",
  "deliveries",
  "export_operations",
  "vessel_operations",
  "intelligence",
  "administration",
  "settings",
] as const;
export type PermissionModuleKey = (typeof permissionModuleKeys)[number];

export const permissionActions = ["view", "create", "edit", "delete", "reports"] as const;
export type PermissionAction = (typeof permissionActions)[number];
