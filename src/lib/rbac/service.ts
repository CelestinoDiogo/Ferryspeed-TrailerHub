import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PermissionAction, PermissionModuleKey, RoleKey } from "@/lib/rbac/constants";
import type { AppPermissionModuleRow, AppRolePermissionRow, AppRoleRow, AppUserRoleRow, PermissionMatrixItem } from "@/lib/rbac/types";

const roleRank: Record<RoleKey, number> = {
  administrator: 0,
  supervisor: 1,
  operator: 2,
  driver: 3,
};

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

  const { data, error } = await supabase
    .from("app_role_permissions")
    .select("can_view, can_create, can_edit, can_delete, can_reports")
    .eq("role_key", userRole.role_key)
    .eq("module_key", moduleKey)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to verify permissions.");
  }

  if (!data) {
    return false;
  }

  if (action === "view") return data.can_view;
  if (action === "create") return data.can_create;
  if (action === "edit") return data.can_edit;
  if (action === "delete") return data.can_delete;
  return data.can_reports;
}

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
  payload: { userId: string; roleKey: RoleKey; isActive?: boolean },
) {
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

  return data as AppUserRoleRow;
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
  const [{ data: modules, error: modulesError }, { data: permissions, error: permissionsError }] = await Promise.all([
    supabase
      .from("app_permission_modules")
      .select("module_key, label, created_at, updated_at")
      .order("module_key", { ascending: true }),
    supabase
      .from("app_role_permissions")
      .select("role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports, created_at, updated_at")
      .order("role_key", { ascending: true })
      .order("module_key", { ascending: true }),
  ]);

  if (modulesError) {
    throw new Error(modulesError.message || "Unable to load permission modules.");
  }

  if (permissionsError) {
    throw new Error(permissionsError.message || "Unable to load permissions.");
  }

  const moduleRows = (modules ?? []) as AppPermissionModuleRow[];
  const permissionRows = (permissions ?? []) as AppRolePermissionRow[];
  const labelByModule = new Map(moduleRows.map((module) => [module.module_key, module.label]));

  return permissionRows.map((row) => ({
    roleKey: row.role_key,
    moduleKey: row.module_key,
    moduleLabel: labelByModule.get(row.module_key) ?? row.module_key,
    canView: row.can_view,
    canCreate: row.can_create,
    canEdit: row.can_edit,
    canDelete: row.can_delete,
    canReports: row.can_reports,
  }));
}

export async function updatePermission(
  supabase: SupabaseClient<Database>,
  payload: {
    roleKey: RoleKey;
    moduleKey: string;
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
    .eq("module_key", payload.moduleKey)
    .select("role_key, module_key, can_view, can_create, can_edit, can_delete, can_reports, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(error.message || "Unable to update role permission.");
  }

  return data as AppRolePermissionRow;
}
