import "server-only";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { hasPermission, moduleKeys, toLegacyPermissionColumn, toLegacyPermissionModule, type PermissionModuleKey } from "@/lib/auth/permissions";
import type { Database } from "@/lib/database.types";
import type { PermissionAction, RoleKey } from "@/lib/rbac/constants";
import type { AppRolePermissionRow, AppRoleRow, AppUserRoleRow, PermissionMatrixItem, SettingsUserListItem } from "@/lib/rbac/types";

const roleRank: Record<RoleKey, number> = {
  administrator: 0,
  supervisor: 1,
  operator: 2,
  driver: 3,
};

const moduleLabels: Record<PermissionModuleKey, string> = {
  dashboard: "Dashboard",
  driver_mobile: "Driver Mobile",
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
  fleet_transport: "Fleet / Transport",
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

type UserIdentity = {
  email: string | null;
  displayName: string | null;
};

const driverSelect = "id,user_id,display_name,phone,active,created_at,updated_at";

const getServiceSupabase = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
};

const requireServiceSupabase = () => {
  const serviceSupabase = getServiceSupabase();

  if (!serviceSupabase) {
    throw new Error("Unable to list Auth users. Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL in server environment.");
  }

  return serviceSupabase;
};

const listAuthUsers = async () => {
  const serviceSupabase = requireServiceSupabase();
  const users: User[] = [];
  const perPage = 200;
  const maxPages = 20;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await serviceSupabase.auth.admin.listUsers({ page, perPage });

    if (error) {
      throw new Error(error.message || "Unable to list Auth users.");
    }

    const pageUsers = data?.users ?? [];
    users.push(...pageUsers);

    if (pageUsers.length < perPage) {
      break;
    }
  }

  return users;
};

export async function loadTargetUserIdentity(userId: string): Promise<UserIdentity | null> {
  const serviceSupabase = getServiceSupabase();

  if (!serviceSupabase) {
    return null;
  }

  const { data, error } = await serviceSupabase.auth.admin.getUserById(userId);

  if (error || !data.user) {
    return null;
  }

  return {
    email: data.user.email ?? null,
    displayName: getDisplayName(data.user),
  };
}

const resolveDriverDisplayName = (previousDisplayName: string | null | undefined, identity: UserIdentity | null) => {
  const fallbackName = identity?.displayName ?? identity?.email ?? "Driver";
  return previousDisplayName?.trim() || fallbackName.trim() || "Driver";
};

export const ensureActiveDriverProfileForUser = async (
  supabase: SupabaseClient<Database>,
  userId: string,
  identity: UserIdentity | null,
) => {
  const { data: existingDriver, error: existingError } = await supabase
    .from("drivers")
    .select(driverSelect)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message || "Unable to load driver profile.");
  }

  const resolvedDisplayName = resolveDriverDisplayName(existingDriver?.display_name ?? null, identity);

  if (existingDriver) {
    if (existingDriver.active) {
      return existingDriver as Database["public"]["Tables"]["drivers"]["Row"];
    }

    const { data: reactivatedDriver, error: reactivateError } = await supabase
      .from("drivers")
      .update({
        active: true,
        display_name: resolvedDisplayName,
      })
      .eq("id", existingDriver.id)
      .select(driverSelect)
      .single();

    if (reactivateError || !reactivatedDriver) {
      throw new Error(reactivateError?.message || "Unable to reactivate driver profile.");
    }

    return reactivatedDriver as Database["public"]["Tables"]["drivers"]["Row"];
  }

  const { data: insertedDriver, error: insertError } = await supabase
    .from("drivers")
    .insert({
      user_id: userId,
      display_name: resolvedDisplayName,
      phone: null,
      active: true,
    })
    .select(driverSelect)
    .single();

  if (insertError || !insertedDriver) {
    throw new Error(insertError?.message || "Unable to provision driver profile.");
  }

  return insertedDriver as Database["public"]["Tables"]["drivers"]["Row"];
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
  const decision = await evaluatePermission(supabase, userId, moduleKey, action);
  return decision.allowed;
}

export type PermissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "PROFILE_MISSING" | "PROFILE_INACTIVE" | "INVALID_ROLE" | "STATIC_PERMISSION_DENIED" | "DB_PERMISSION_DENIED";
    };

export async function evaluatePermission(
  supabase: SupabaseClient<Database>,
  userId: string,
  moduleKey: PermissionModuleKey,
  action: PermissionAction,
): Promise<PermissionDecision> {
  const userRole = await loadCurrentUserRole(supabase, userId);

  if (!userRole?.role_key) {
    return { allowed: false, reason: "PROFILE_MISSING" };
  }

  if (userRole.is_active === false) {
    return { allowed: false, reason: "PROFILE_INACTIVE" };
  }

  if (!isRoleKey(userRole.role_key)) {
    return { allowed: false, reason: "INVALID_ROLE" };
  }

  if (!hasPermission(userRole.role_key, moduleKey, action)) {
    return { allowed: false, reason: "STATIC_PERMISSION_DENIED" };
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
    return { allowed: false, reason: "DB_PERMISSION_DENIED" };
  }

  if (!data[legacyActionColumn]) {
    return { allowed: false, reason: "DB_PERMISSION_DENIED" };
  }

  return { allowed: true };
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
  const authUsers = await listAuthUsers();

  const { data: roleRows, error: roleError } = await supabase
    .from("app_user_roles")
    .select("user_id, email, display_name, role_key, is_active, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (roleError) {
    throw new Error(roleError.message || "Unable to load users.");
  }

  const { data: driverRows, error: driverError } = await supabase
    .from("drivers")
    .select("user_id")
    .not("user_id", "is", null);

  if (driverError) {
    throw new Error(driverError.message || "Unable to load users.");
  }

  const rolesByUserId = new Map<string, AppUserRoleRow>((roleRows ?? []).map((row) => [row.user_id, row as AppUserRoleRow]));
  const driverLinkedUserIds = new Set<string>((driverRows ?? []).flatMap((row) => (row.user_id ? [row.user_id] : [])));
  const mergedUsers: SettingsUserListItem[] = authUsers.map((authUser) => {
    const roleRow = rolesByUserId.get(authUser.id);
    const roleKey = roleRow?.role_key ?? null;

    return {
      userId: authUser.id,
      email: roleRow?.email ?? authUser.email ?? null,
      displayName: roleRow?.display_name ?? getDisplayName(authUser),
      roleKey: roleKey && isRoleKey(roleKey) ? roleKey : null,
      isActive: roleRow?.is_active ?? null,
      lastSignInAt: authUser.last_sign_in_at ?? null,
      driverLinked: driverLinkedUserIds.has(authUser.id),
    };
  });

  mergedUsers.sort((a, b) => {
    const signInA = a.lastSignInAt ? Date.parse(a.lastSignInAt) : 0;
    const signInB = b.lastSignInAt ? Date.parse(b.lastSignInAt) : 0;
    if (signInA !== signInB) {
      return signInB - signInA;
    }

    return (a.email ?? "").localeCompare(b.email ?? "");
  });

  return mergedUsers;
}

export async function updateUserRole(
  supabase: SupabaseClient<Database>,
  payload: { userId: string; roleKey: RoleKey; isActive?: boolean; changedBy: string; linkDriverProfile?: boolean },
) {
  const { data: previous, error: previousError } = await supabase
    .from("app_user_roles")
    .select("user_id, email, display_name, role_key, is_active")
    .eq("user_id", payload.userId)
    .maybeSingle();

  if (previousError) {
    throw new Error(previousError.message || "Unable to load current user role before update.");
  }

  if (payload.userId === payload.changedBy && payload.isActive === false) {
    throw new Error("You cannot deactivate your own account.");
  }

  const targetIdentity = await loadTargetUserIdentity(payload.userId);
  const resolvedEmail = previous?.email ?? targetIdentity?.email ?? null;
  const resolvedDisplayName = previous?.display_name ?? targetIdentity?.displayName ?? null;

  if (payload.roleKey === "driver" || payload.linkDriverProfile === true) {
    await ensureActiveDriverProfileForUser(supabase, payload.userId, targetIdentity);
  }

  const rolePayload: Database["public"]["Tables"]["app_user_roles"]["Insert"] = {
    user_id: payload.userId,
    email: resolvedEmail,
    display_name: resolvedDisplayName,
    role_key: payload.roleKey,
    is_active: typeof payload.isActive === "boolean" ? payload.isActive : previous?.is_active ?? true,
  };

  const wasActiveAdministrator = previous?.role_key === "administrator" && previous?.is_active === true;
  const remainsActiveAdministrator = rolePayload.role_key === "administrator" && rolePayload.is_active === true;

  if (wasActiveAdministrator && !remainsActiveAdministrator) {
    const { count: activeAdminCount, error: activeAdminCountError } = await supabase
      .from("app_user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role_key", "administrator")
      .eq("is_active", true);

    if (activeAdminCountError) {
      throw new Error(activeAdminCountError.message || "Unable to verify active administrator coverage.");
    }

    if ((activeAdminCount ?? 0) <= 1) {
      throw new Error("At least one active Administrator account is required.");
    }
  }

  let data: AppUserRoleRow | null = null;

  if (previous) {
    const updatePayload: Database["public"]["Tables"]["app_user_roles"]["Update"] = {
      role_key: payload.roleKey,
      is_active: rolePayload.is_active,
    };

    if (!previous.email && resolvedEmail) {
      updatePayload.email = resolvedEmail;
    }

    if (!previous.display_name && resolvedDisplayName) {
      updatePayload.display_name = resolvedDisplayName;
    }

    const { data: updated, error } = await supabase
      .from("app_user_roles")
      .update(updatePayload)
      .eq("user_id", payload.userId)
      .select("user_id, email, display_name, role_key, is_active, created_at, updated_at")
      .single();

    if (error) {
      throw new Error(error.message || "Unable to update user role.");
    }

    data = updated as AppUserRoleRow;
  } else {
    const { data: inserted, error } = await supabase
      .from("app_user_roles")
      .insert(rolePayload)
      .select("user_id, email, display_name, role_key, is_active, created_at, updated_at")
      .single();

    if (error) {
      throw new Error(error.message || "Unable to update user role.");
    }

    data = inserted as AppUserRoleRow;
  }

  if (!data) {
    throw new Error("Unable to update user role.");
  }

  const auditEvent: UserRoleAuditEvent = {
    userId: payload.userId,
    previousRole: (previous?.role_key as RoleKey) ?? payload.roleKey,
    newRole: (data.role_key as RoleKey) ?? payload.roleKey,
    previousIsActive: previous?.is_active ?? false,
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
