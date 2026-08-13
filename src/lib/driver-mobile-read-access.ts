import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { DriverMobileIdentityError } from "@/lib/driver-mobile-identity";
import { requireRbacPermission } from "@/lib/rbac/route";
import { loadCurrentUserRole } from "@/lib/rbac/service";

export async function requireDriverMobileReadAccess(
  supabase: SupabaseClient<Database>,
  userId: string,
) {
  const role = await loadCurrentUserRole(supabase, userId);

  if (!role?.role_key) {
    await requireRbacPermission(supabase, userId, "driver_mobile", "view");
    return null;
  }

  if (role.is_active === false) {
    await requireRbacPermission(supabase, userId, "driver_mobile", "view");
    return null;
  }

  if (role.role_key === "administrator" || role.role_key === "supervisor") {
    return role;
  }

  if (role.role_key === "driver") {
    await requireRbacPermission(supabase, userId, "driver_mobile", "view");
    return role;
  }

  throw new DriverMobileIdentityError(
    "Driver Mobile preview is available only to Administrators and Supervisors.",
    "PREVIEW_NOT_ALLOWED",
    403,
  );
}
