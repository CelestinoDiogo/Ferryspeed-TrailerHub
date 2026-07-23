import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { hasPermission, moduleKeys, toLegacyPermissionColumn, toLegacyPermissionModule, type PermissionModuleKey } from "@/lib/auth/permissions";
import type { Database } from "@/lib/database.types";
import type { PermissionAction, RoleKey } from "@/lib/rbac/constants";
import type { AppRolePermissionRow, AppRoleRow, AppUserRoleRow, PermissionMatrixItem } from "@/lib/rbac/types";

const roleRank: Record<RoleKey, number> = {
  administrator: 0,
  supervisor: 1,
  operator: 2,
  driver: 3,
};

const moduleLabels: Record<PermissionModuleKey, string> = {
  dashboard: "Dashboard",
  arrivals: "Arrivals",
  compound: "Compound",
  stock_check: "Stock Check",
  reconciliation: "Reconciliation",
  departures: "Departures",
  export_operations: "Export Operations",
  vessel_operations: "Vessel Operations",
  reports: "Reports",
  timeline: "Timeline",
  ai_assistant: "AI Assistant",
  settings: "Settings",
  user_management: "User Management",
};

function isRoleKey(value: string): value is RoleKey {
  return value === "administrator" || value === "supervisor" || value === "operator" || value === "driver";
}

const getDisplayName = (user: User) => {
  const fromMeta = user.user_metadata;
  const fullName = typeof fromMeta?.full_name === "string" ? fromMeta.full_name.trim() : "";
  const name = typeof fromMeta?.name === "string" ? fromMeta.name.trim() : "";

  if (fullName) {
    return fullName;
  }

  if (name) {
    return name;
  }

  return user.email ?? "Unknown User";
};

export async function ensureCurrentUserRole(supabase: SupabaseClient<Database>, user: User) {
  const { data: existing, error: existingError } = await supabase
    .from("app_user_roles")
    .select("user_id, role_key")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message || "Unable to load user role.");
  }

  if (existing) {
    return existing;
  }

  const { count, error: countError } = await supabase
    .from("app_user_roles")
    .select("user_id", { count: "exact", head: true });

  if (countError) {
    throw new Error(countError.message || "Unable to evaluate role bootstrap.");
  }

  const defaultRole: RoleKey = (count ?? 0) === 0 ? "administrator" : "operator";

  const payload: Database["public"]["Tables"]["app_user_roles"]["Insert"] = {
    user_id: user.id,
    email: user.email ?? null,
    display_name: getDisplayName(user),
    role_key: defaultRole,
    is_active: true,
  };

  const { data, error } = await supabase
    .from("app_user_roles")
    .upsert(payload, { onConflict: "user_id" })
    .select("user_id, role_key")
    .single();

  if (error) {
    throw new Error(error.message || "Unable to bootstrap user role.");
  }

  return data;
}

export async function loadCurrentUserRole(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase
    .from("app_user_roles")
    .select("user_id, role_key, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load user role.");
  }

  return (data ?? null) as Pick<AppUserRoleRow, "user_id" | "role_key" | "is_active"> | null;
}

export async function requirePermission(
  supabase: SupabaseClient<Database>,
  userId: string,
  moduleKey: PermissionModuleKey,
  action: PermissionAction,
) {
  const userRole = await loadCurrentUserRole(supabase, userId);

  if (!userRole?.role_key || userRole.is_active === false) {
    return false;
  }

  if (!isRoleKey(userRole.role_key)) {
    return false;
  }

  if (!hasPermission(userRole.role_key, moduleKey, action)) {
    return false;
  }

  const legacyModuleKey = toLegacyPermissionModule(moduleKey);
  const legacyActionColumn = toLegacyPermissionColumn(action);

  const { data, error } = await supabase
    .from("app_role_permissions")
    .select("can_view, can_create, can_edit, can_delete, can_reports")
    .eq("role_key", userRole.role_key)
    .eq("module_key", legacyModuleKey)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to verify permissions.");
  }

  if (!data) {
    return false;
  }

  return data[legacyActionColumn];
}

export type UserRoleAuditEvent = {
  userId: string;
  previousRole: RoleKey;
  newRole: RoleKey;
  previousIsActive: boolean;
  newIsActive: boolean;
  changedBy: string;
  changedAt: string;
};

export async function listUsersWithRoles(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("app_user_roles")
    .select("user_id, email, display_name, role_key, is_active, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message || "Unable to load users.");
  }

  return (data ?? []) as AppUserRoleRow[];
}

export async function updateUserRole(
  supabase: SupabaseClient<Database>,
  payload: { userId: string; roleKey: RoleKey; isActive?: boolean; changedBy: string },
) {
  const { data: previous, error: previousError } = await supabase
    .from("app_user_roles")
    .select("role_key, is_active")
    .eq("user_id", payload.userId)
    .single();

  if (previousError) {
    throw new Error(previousError.message || "Unable to load current user role before update.");
  }

  const updatePayload: Database["public"]["Tables"]["app_user_roles"]["Update"] = {
    role_key: payload.roleKey,
  };

  if (typeof payload.isActive === "boolean") {
    updatePayload.is_active = payload.isActive;
  }

  const { data, error } = await supabase
    .from("app_user_roles")
    .update(updatePayload)
    .eq("user_id", payload.userId)
    .select("user_id, email, display_name, role_key, is_active, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(error.message || "Unable to update user role.");
  }

  const auditEvent: UserRoleAuditEvent = {
    userId: payload.userId,
    previousRole: (previous.role_key as RoleKey) ?? "operator",
    newRole: (data.role_key as RoleKey) ?? payload.roleKey,
    previousIsActive: previous.is_active,
    newIsActive: data.is_active,
    changedBy: payload.changedBy,
    changedAt: new Date().toISOString(),
  };

  const { error: auditInsertError } = await supabase.from("app_user_role_audit_log").insert({
    user_id: auditEvent.userId,
    previous_role_key: auditEvent.previousRole,
    new_role_key: auditEvent.newRole,
    previous_is_active: auditEvent.previousIsActive,
    new_is_active: auditEvent.newIsActive,
    changed_by: auditEvent.changedBy,
    changed_at: auditEvent.changedAt,
  });

  if (auditInsertError) {
    const missingAuditTable = auditInsertError.message.includes("app_user_role_audit_log");
    if (!missingAuditTable) {
      throw new Error(auditInsertError.message || "Unable to persist user role audit event.");
    }
  }

  return {
    user: data as AppUserRoleRow,
    auditEvent,
  };
}

export async function listRoles(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("app_roles")
    .select("role_key, label, description, is_system, created_at, updated_at")
    .order("role_key", { ascending: true });

  if (error) {
    throw new Error(error.message || "Unable to load roles.");
  }

  const rows = (data ?? []) as AppRoleRow[];
  return rows.sort((a, b) => {
    const rankA = roleRank[(a.role_key as RoleKey) ?? "driver"] ?? 99;
    const rankB = roleRank[(b.role_key as RoleKey) ?? "driver"] ?? 99;
    return rankA - rankB;
  });
}

export async function updateRole(
  supabase: SupabaseClient<Database>,
  payload: { roleKey: RoleKey; label: string; description: string | null },
) {
  const { data, error } = await supabase
    .from("app_roles")
    .update({ label: payload.label, description: payload.description })
    .eq("role_key", payload.roleKey)
    .select("role_key, label, description, is_system, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(error.message || "Unable to update role.");
  }

  return data as AppRoleRow;
}

export async function listPermissions(supabase: SupabaseClient<Database>): Promise<PermissionMatrixItem[]> {
  const [{ data: roles, error: rolesError }, { data: permissions, error: permissionsError }] = await Promise.all([
    supabase.from("app_roles").select("role_key").order("role_key", { ascending: true }),
    supabase
      .from("app_role_permissions")
      .select("role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports, created_at, updated_at")
      .order("role_key", { ascending: true })
      .order("module_key", { ascending: true }),
  ]);

  if (rolesError) {
    throw new Error(rolesError.message || "Unable to load roles for permission matrix.");
  }

  if (permissionsError) {
    throw new Error(permissionsError.message || "Unable to load permissions.");
  }

  const permissionRows = (permissions ?? []) as AppRolePermissionRow[];
  const roleRows = (roles ?? []) as Pick<AppRoleRow, "role_key">[];

  const permissionByRoleAndLegacyModule = new Map<string, AppRolePermissionRow>();
  for (const row of permissionRows) {
    permissionByRoleAndLegacyModule.set(`${row.role_key}:${row.module_key}`, row);
  }

  const matrix: PermissionMatrixItem[] = [];

  for (const role of roleRows) {
    for (const moduleKey of moduleKeys) {
      const legacyModuleKey = toLegacyPermissionModule(moduleKey);
      const lookup = permissionByRoleAndLegacyModule.get(`${role.role_key}:${legacyModuleKey}`);

      matrix.push({
        roleKey: role.role_key,
        moduleKey,
        moduleLabel: moduleLabels[moduleKey],
        canView: lookup?.can_view ?? false,
        canCreate: lookup?.can_create ?? false,
        canEdit: lookup?.can_edit ?? false,
        canDelete: lookup?.can_delete ?? false,
        canReports: lookup?.can_reports ?? false,
      });
    }
  }

  return matrix;
}

export async function updatePermission(
  supabase: SupabaseClient<Database>,
  payload: {
    roleKey: RoleKey;
    moduleKey: PermissionModuleKey;
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canReports: boolean;
  },
) {
  const updatePayload: Database["public"]["Tables"]["app_role_permissions"]["Update"] = {
    can_view: payload.canView,
    can_create: payload.canCreate,
    can_edit: payload.canEdit,
    can_delete: payload.canDelete,
    can_reports: payload.canReports,
  };

  const { data, error } = await supabase
    .from("app_role_permissions")
    .update(updatePayload)
    .eq("role_key", payload.roleKey)
    .eq("module_key", toLegacyPermissionModule(payload.moduleKey))
    .select("role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(error.message || "Unable to update role permission.");
  }

  return data as AppRolePermissionRow;
}
