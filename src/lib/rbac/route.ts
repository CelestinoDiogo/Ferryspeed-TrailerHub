import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PermissionAction, PermissionModuleKey } from "@/lib/rbac/constants";
import { ensureCurrentUserRole, requirePermission } from "@/lib/rbac/service";

export class RbacPermissionError extends Error {
  status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "RbacPermissionError";
    this.status = status;
  }
}

export async function bootstrapCurrentUserRole(supabase: SupabaseClient<Database>, user: User) {
  await ensureCurrentUserRole(supabase, user);
}

export async function requireRbacPermission(
  supabase: SupabaseClient<Database>,
  userId: string,
  moduleKey: PermissionModuleKey,
  action: PermissionAction,
) {
  const allowed = await requirePermission(supabase, userId, moduleKey, action);

  if (!allowed) {
    throw new RbacPermissionError("You do not have permission to perform this action.", 403);
  }
}
