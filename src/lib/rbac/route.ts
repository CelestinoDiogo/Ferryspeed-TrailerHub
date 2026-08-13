import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { PermissionAction, PermissionModuleKey } from "@/lib/rbac/constants";
import { ensureCurrentUserRole, evaluatePermission } from "@/lib/rbac/service";

export class RbacPermissionError extends Error {
  status: number;
  code: "RBAC_PERMISSION_DENIED" | "RBAC_PROFILE_INACTIVE" | "RBAC_PROFILE_MISSING";

  constructor(
    message: string,
    status = 403,
    code: "RBAC_PERMISSION_DENIED" | "RBAC_PROFILE_INACTIVE" | "RBAC_PROFILE_MISSING" = "RBAC_PERMISSION_DENIED",
  ) {
    super(message);
    this.name = "RbacPermissionError";
    this.status = status;
    this.code = code;
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
  const decision = await evaluatePermission(supabase, userId, moduleKey, action);

  if (decision.allowed) {
    return;
  }

  if (decision.reason === "PROFILE_INACTIVE") {
    throw new RbacPermissionError("Your application profile is inactive.", 403, "RBAC_PROFILE_INACTIVE");
  }

  if (decision.reason === "PROFILE_MISSING") {
    throw new RbacPermissionError("Application profile is missing for this account.", 403, "RBAC_PROFILE_MISSING");
  }

  throw new RbacPermissionError("You do not have permission to perform this action.", 403, "RBAC_PERMISSION_DENIED");
}
