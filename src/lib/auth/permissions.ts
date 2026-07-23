import type { RoleKey } from "@/lib/auth/roles";

export const moduleKeys = [
  "dashboard",
  "arrivals",
  "compound",
  "stock_check",
  "reconciliation",
  "departures",
  "export_operations",
  "vessel_operations",
  "reports",
  "timeline",
  "ai_assistant",
  "settings",
  "user_management",
] as const;

export type PermissionModuleKey = (typeof moduleKeys)[number];

export const permissionActions = [
  "view",
  "create",
  "edit",
  "delete",
  "reconcile",
  "complete",
  "print",
  "manage_users",
  "manage_settings",
] as const;

export type PermissionAction = (typeof permissionActions)[number];

type RolePermissionMap = Record<PermissionModuleKey, Set<PermissionAction>>;

const allActions = new Set<PermissionAction>(permissionActions);

const operationalModules: PermissionModuleKey[] = [
  "dashboard",
  "arrivals",
  "compound",
  "stock_check",
  "reconciliation",
  "departures",
  "export_operations",
  "vessel_operations",
  "reports",
  "timeline",
  "ai_assistant",
];

function createEmptyMap(): RolePermissionMap {
  return {
    dashboard: new Set<PermissionAction>(),
    arrivals: new Set<PermissionAction>(),
    compound: new Set<PermissionAction>(),
    stock_check: new Set<PermissionAction>(),
    reconciliation: new Set<PermissionAction>(),
    departures: new Set<PermissionAction>(),
    export_operations: new Set<PermissionAction>(),
    vessel_operations: new Set<PermissionAction>(),
    reports: new Set<PermissionAction>(),
    timeline: new Set<PermissionAction>(),
    ai_assistant: new Set<PermissionAction>(),
    settings: new Set<PermissionAction>(),
    user_management: new Set<PermissionAction>(),
  };
}

const administratorPermissions = createEmptyMap();
for (const moduleKey of moduleKeys) {
  administratorPermissions[moduleKey] = new Set(allActions);
}

const supervisorPermissions = createEmptyMap();
for (const moduleKey of operationalModules) {
  supervisorPermissions[moduleKey] = new Set(["view", "create", "edit", "reconcile", "complete", "print"]);
}
supervisorPermissions.settings = new Set(["view"]);

const operatorPermissions = createEmptyMap();
operatorPermissions.dashboard = new Set(["view"]);
operatorPermissions.arrivals = new Set(["view", "create", "edit"]);
operatorPermissions.compound = new Set(["view", "create", "edit"]);
operatorPermissions.stock_check = new Set(["view", "create", "edit"]);
operatorPermissions.reconciliation = new Set(["view", "edit"]);
operatorPermissions.departures = new Set(["view", "create", "edit"]);
operatorPermissions.export_operations = new Set(["view", "create", "edit"]);
operatorPermissions.vessel_operations = new Set(["view", "create", "edit"]);
operatorPermissions.reports = new Set(["view"]);
operatorPermissions.timeline = new Set(["view"]);
operatorPermissions.ai_assistant = new Set(["view"]);

const driverPermissions = createEmptyMap();

const rolePermissionMatrix: Record<RoleKey, RolePermissionMap> = {
  administrator: administratorPermissions,
  supervisor: supervisorPermissions,
  operator: operatorPermissions,
  driver: driverPermissions,
};

export function hasPermission(roleKey: RoleKey, moduleKey: PermissionModuleKey, action: PermissionAction) {
  const modulePermissions = rolePermissionMatrix[roleKey][moduleKey];
  return modulePermissions.has(action);
}

export function canAccessModule(roleKey: RoleKey, moduleKey: PermissionModuleKey) {
  return hasPermission(roleKey, moduleKey, "view");
}

export function canPerformAction(roleKey: RoleKey, moduleKey: PermissionModuleKey, action: PermissionAction) {
  return hasPermission(roleKey, moduleKey, action);
}

type LegacyPermissionModuleKey =
  | "dashboard"
  | "operations"
  | "yard"
  | "deliveries"
  | "export_operations"
  | "vessel_operations"
  | "intelligence"
  | "administration"
  | "settings";

export type LegacyPermissionColumn = "can_view" | "can_create" | "can_edit" | "can_delete" | "can_reports";

const moduleToLegacyMap: Record<PermissionModuleKey, LegacyPermissionModuleKey> = {
  dashboard: "dashboard",
  arrivals: "operations",
  compound: "yard",
  stock_check: "yard",
  reconciliation: "yard",
  departures: "operations",
  export_operations: "export_operations",
  vessel_operations: "vessel_operations",
  reports: "intelligence",
  timeline: "intelligence",
  ai_assistant: "intelligence",
  settings: "settings",
  user_management: "settings",
};

const actionToLegacyColumnMap: Record<PermissionAction, LegacyPermissionColumn> = {
  view: "can_view",
  create: "can_create",
  edit: "can_edit",
  delete: "can_delete",
  reconcile: "can_edit",
  complete: "can_edit",
  print: "can_reports",
  manage_users: "can_edit",
  manage_settings: "can_edit",
};

export function toLegacyPermissionModule(moduleKey: PermissionModuleKey) {
  return moduleToLegacyMap[moduleKey];
}

export function toLegacyPermissionColumn(action: PermissionAction) {
  return actionToLegacyColumnMap[action];
}
