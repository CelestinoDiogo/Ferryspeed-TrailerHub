import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoleKey } from "@/lib/auth/roles";
import type { Database } from "@/lib/database.types";
import { loadActiveDriverForUser, loadDriverById, type DriverRow } from "@/lib/driver-access";
import { loadCurrentUserRole } from "@/lib/rbac/service";

type RouteSupabase = SupabaseClient<Database>;

export type DriverMobileIdentityCode =
  | "DRIVER_PROFILE_REQUIRED"
  | "DRIVER_ACTION_NOT_ALLOWED"
  | "PREVIEW_DRIVER_REQUIRED"
  | "PREVIEW_DRIVER_INVALID"
  | "PREVIEW_DRIVER_INACTIVE"
  | "PREVIEW_NOT_ALLOWED";

export class DriverMobileIdentityError extends Error {
  status: number;
  code: DriverMobileIdentityCode;

  constructor(message: string, code: DriverMobileIdentityCode, status = 400) {
    super(message);
    this.name = "DriverMobileIdentityError";
    this.status = status;
    this.code = code;
  }
}

export type DriverMobileReadContext = {
  roleKey: Extract<RoleKey, "driver" | "administrator" | "supervisor">;
  driver: DriverRow;
  isPreview: boolean;
};

export async function resolveDriverMobileReadContext(
  supabase: RouteSupabase,
  userId: string,
  previewDriverId?: string | null,
): Promise<DriverMobileReadContext> {
  const userRole = await loadCurrentUserRole(supabase, userId);
  const roleKey = userRole?.role_key;

  if (roleKey === "driver") {
    if (previewDriverId) {
      throw new DriverMobileIdentityError("Driver accounts cannot select another Driver identity.", "PREVIEW_NOT_ALLOWED", 403);
    }

    const driver = await loadActiveDriverForUser(supabase, userId);
    if (!driver) {
      throw new DriverMobileIdentityError("This account is not linked to an active Driver profile.", "DRIVER_PROFILE_REQUIRED", 403);
    }

    return { roleKey, driver, isPreview: false };
  }

  if (roleKey === "administrator" || roleKey === "supervisor") {
    if (!previewDriverId) {
      throw new DriverMobileIdentityError("Select a Driver to preview Driver Mobile.", "PREVIEW_DRIVER_REQUIRED");
    }

    const driver = await loadDriverById(supabase, previewDriverId);
    if (!driver) {
      throw new DriverMobileIdentityError("The selected Driver does not exist.", "PREVIEW_DRIVER_INVALID", 404);
    }

    if (!driver.active) {
      throw new DriverMobileIdentityError("The selected Driver profile is inactive.", "PREVIEW_DRIVER_INACTIVE", 409);
    }

    return { roleKey, driver, isPreview: true };
  }

  throw new DriverMobileIdentityError("This role cannot access Driver Mobile.", "PREVIEW_NOT_ALLOWED", 403);
}
