import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import { loadCurrentUserRole } from "@/lib/rbac/service";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
} from "@/lib/supabase-route-client";
import type { PermissionAction } from "@/lib/rbac/constants";

export const resolveStockCheckOperatorName = (user: User) =>
  (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
  (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim()) ||
  user.email ||
  user.id;

export async function authorizeStockCheckMutation(request: Request, action: PermissionAction = "edit") {
  const accessToken = getRouteBearerToken(request);
  const supabase = createAuthenticatedRouteSupabaseClient(request);
  const user = await requireAuthenticatedRouteUser(supabase, accessToken);
  await bootstrapCurrentUserRole(supabase, user);
  await requireRbacPermission(supabase, user.id, "stock_check", action);

  const role = await loadCurrentUserRole(supabase, user.id);
  if (role?.role_key === "driver") {
    throw new RbacPermissionError("Drivers cannot add unexpected trailers or resolve stock check discrepancies.", 403);
  }

  return {
    supabase,
    user,
    operatorName: resolveStockCheckOperatorName(user),
    roleKey: role?.role_key ?? null,
  };
}

export type StockCheckRouteDatabase = Database;
