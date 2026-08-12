import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { updateUserRole } from "@/lib/rbac/service";
import type { Database } from "@/lib/database.types";
import type { AppUserRoleRow } from "@/lib/rbac/types";

type DriverRow = Database["public"]["Tables"]["drivers"]["Row"];

type RoleState = {
  rows: AppUserRoleRow[];
  lastUpdatePatch: Record<string, unknown> | null;
  lastInsertPayload: Record<string, unknown> | null;
};

type DriverState = {
  rows: DriverRow[];
  lastUpdatePatch: Record<string, unknown> | null;
  lastInsertPayload: Record<string, unknown> | null;
};

const makeRoleRow = (overrides: Partial<AppUserRoleRow>): AppUserRoleRow => ({
  user_id: "user-a",
  email: "driver@example.com",
  display_name: "Driver One",
  role_key: "operator",
  is_active: true,
  created_at: "2026-08-12T00:00:00.000Z",
  updated_at: "2026-08-12T00:00:00.000Z",
  ...overrides,
});

const makeDriverRow = (overrides: Partial<DriverRow>): DriverRow => ({
  id: "driver-a",
  user_id: "user-a",
  display_name: "Driver One",
  phone: null,
  active: true,
  created_at: "2026-08-12T00:00:00.000Z",
  updated_at: "2026-08-12T00:00:00.000Z",
  ...overrides,
});

const createMockSupabase = (roleState: RoleState, driverState: DriverState) => {
  let currentRoleUserId: string | null = null;
  let currentDriverUserId: string | null = null;
  let currentDriverId: string | null = null;

  const appUserRoleSelectChain = {
    eq: vi.fn((column: string, value: unknown) => {
      if (column === "user_id") {
        currentRoleUserId = typeof value === "string" ? value : null;
      }
      return appUserRoleSelectChain;
    }),
    maybeSingle: vi.fn(async () => {
      const row = roleState.rows.find((item) => item.user_id === currentRoleUserId) ?? null;
      return { data: row, error: null };
    }),
  };

  const appUserRoleUpdateChain = {
    eq: vi.fn((column: string, value: unknown) => {
      if (column === "user_id") {
        currentRoleUserId = typeof value === "string" ? value : null;
      }
      return appUserRoleUpdateChain;
    }),
    select: vi.fn(() => appUserRoleUpdateChain),
    single: vi.fn(async () => {
      const index = roleState.rows.findIndex((item) => item.user_id === currentRoleUserId);
      if (index === -1) {
        return { data: null, error: { message: "Role row not found" } };
      }

      roleState.rows[index] = {
        ...roleState.rows[index],
        ...(roleState.lastUpdatePatch ?? {}),
      } as AppUserRoleRow;

      return { data: roleState.rows[index], error: null };
    }),
  };

  const appUserRoleInsertChain = {
    select: vi.fn(() => appUserRoleInsertChain),
    single: vi.fn(async () => {
      const inserted = {
        ...(roleState.lastInsertPayload ?? {}),
        created_at: "2026-08-12T10:00:00.000Z",
        updated_at: "2026-08-12T10:00:00.000Z",
      } as AppUserRoleRow;
      roleState.rows = [...roleState.rows.filter((item) => item.user_id !== inserted.user_id), inserted];
      return { data: inserted, error: null };
    }),
  };

  const driversSelectChain = {
    eq: vi.fn((column: string, value: unknown) => {
      if (column === "user_id") {
        currentDriverUserId = typeof value === "string" ? value : null;
      }
      if (column === "id") {
        currentDriverId = typeof value === "string" ? value : null;
      }
      return driversSelectChain;
    }),
    maybeSingle: vi.fn(async () => {
      const row = driverState.rows.find((item) => item.user_id === currentDriverUserId) ?? null;
      return { data: row, error: null };
    }),
  };

  const driversUpdateChain = {
    eq: vi.fn((column: string, value: unknown) => {
      if (column === "id") {
        currentDriverId = typeof value === "string" ? value : null;
      }
      return driversUpdateChain;
    }),
    select: vi.fn(() => driversUpdateChain),
    single: vi.fn(async () => {
      const index = driverState.rows.findIndex((item) => item.id === currentDriverId);
      if (index === -1) {
        return { data: null, error: { message: "Driver row not found" } };
      }

      driverState.rows[index] = {
        ...driverState.rows[index],
        ...(driverState.lastUpdatePatch ?? {}),
      } as DriverRow;

      return { data: driverState.rows[index], error: null };
    }),
  };

  const driversInsertChain = {
    select: vi.fn(() => driversInsertChain),
    single: vi.fn(async () => {
      const inserted = {
        id: "driver-new",
        user_id: currentDriverUserId,
        display_name: String(driverState.lastInsertPayload?.display_name ?? "Driver"),
        phone: null,
        active: true,
        created_at: "2026-08-12T10:00:00.000Z",
        updated_at: "2026-08-12T10:00:00.000Z",
      } as DriverRow;
      driverState.rows = [...driverState.rows.filter((item) => item.user_id !== inserted.user_id), inserted];
      return { data: inserted, error: null };
    }),
  };

  const auditInsert = vi.fn(async () => ({ error: null }));

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "app_user_roles") {
        return {
          select: vi.fn(() => appUserRoleSelectChain),
          update: vi.fn((patch: Record<string, unknown>) => {
            roleState.lastUpdatePatch = patch;
            return appUserRoleUpdateChain;
          }),
          insert: vi.fn((payload: Record<string, unknown>) => {
            roleState.lastInsertPayload = payload;
            return appUserRoleInsertChain;
          }),
        };
      }

      if (table === "drivers") {
        return {
          select: vi.fn(() => driversSelectChain),
          update: vi.fn((patch: Record<string, unknown>) => {
            driverState.lastUpdatePatch = patch;
            return driversUpdateChain;
          }),
          insert: vi.fn((payload: Record<string, unknown>) => {
            driverState.lastInsertPayload = payload;
            currentDriverUserId = typeof payload.user_id === "string" ? payload.user_id : null;
            return driversInsertChain;
          }),
        };
      }

      if (table === "app_user_role_audit_log") {
        return {
          insert: auditInsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient<Database>;

  return { supabase, auditInsert };
};

describe("updateUserRole", () => {
  const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl ?? "https://example.supabase.co";
  });

  afterEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  });

  it("updates an existing role row and provisions a driver profile", async () => {
    const roleState: RoleState = { rows: [makeRoleRow({ user_id: "user-a", role_key: "operator" })], lastUpdatePatch: null, lastInsertPayload: null };
    const driverState: DriverState = { rows: [], lastUpdatePatch: null, lastInsertPayload: null };
    const { supabase, auditInsert } = createMockSupabase(roleState, driverState);

    const result = await updateUserRole(supabase, {
      userId: "user-a",
      roleKey: "driver",
      changedBy: "admin-a",
    });

    expect(result.user.role_key).toBe("driver");
    expect(roleState.lastUpdatePatch).toMatchObject({ role_key: "driver", is_active: true });
    expect(driverState.lastInsertPayload).toMatchObject({ user_id: "user-a", display_name: "Driver", active: true });
    expect(auditInsert).toHaveBeenCalledTimes(1);
  });

  it("inserts a missing role row and provisions a driver profile", async () => {
    const roleState: RoleState = { rows: [], lastUpdatePatch: null, lastInsertPayload: null };
    const driverState: DriverState = { rows: [], lastUpdatePatch: null, lastInsertPayload: null };
    const { supabase, auditInsert } = createMockSupabase(roleState, driverState);

    const result = await updateUserRole(supabase, {
      userId: "user-b",
      roleKey: "driver",
      changedBy: "admin-a",
    });

    expect(result.user.user_id).toBe("user-b");
    expect(roleState.lastInsertPayload).toMatchObject({ user_id: "user-b", role_key: "driver", is_active: true });
    expect(driverState.lastInsertPayload).toMatchObject({ user_id: "user-b", display_name: "Driver", active: true });
    expect(auditInsert).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing linked active driver profile", async () => {
    const roleState: RoleState = { rows: [makeRoleRow({ user_id: "user-c", role_key: "operator" })], lastUpdatePatch: null, lastInsertPayload: null };
    const driverState: DriverState = { rows: [makeDriverRow({ user_id: "user-c", active: true, display_name: "Existing Driver" })], lastUpdatePatch: null, lastInsertPayload: null };
    const { supabase } = createMockSupabase(roleState, driverState);

    await updateUserRole(supabase, {
      userId: "user-c",
      roleKey: "driver",
      changedBy: "admin-a",
    });

    expect(driverState.lastInsertPayload).toBeNull();
    expect(driverState.lastUpdatePatch).toBeNull();
  });

  it("reactivates an inactive linked driver profile instead of duplicating it", async () => {
    const roleState: RoleState = { rows: [makeRoleRow({ user_id: "user-d", role_key: "operator" })], lastUpdatePatch: null, lastInsertPayload: null };
    const driverState: DriverState = { rows: [makeDriverRow({ user_id: "user-d", active: false, display_name: "Inactive Driver" })], lastUpdatePatch: null, lastInsertPayload: null };
    const { supabase } = createMockSupabase(roleState, driverState);

    await updateUserRole(supabase, {
      userId: "user-d",
      roleKey: "driver",
      changedBy: "admin-a",
    });

    expect(driverState.lastInsertPayload).toBeNull();
    expect(driverState.lastUpdatePatch).toMatchObject({ active: true, display_name: "Inactive Driver" });
    expect(driverState.rows[0]?.active).toBe(true);
  });

  it("preserves the driver profile when changing away from driver", async () => {
    const roleState: RoleState = { rows: [makeRoleRow({ user_id: "user-e", role_key: "driver" })], lastUpdatePatch: null, lastInsertPayload: null };
    const driverState: DriverState = { rows: [makeDriverRow({ user_id: "user-e", active: true })], lastUpdatePatch: null, lastInsertPayload: null };
    const { supabase } = createMockSupabase(roleState, driverState);

    await updateUserRole(supabase, {
      userId: "user-e",
      roleKey: "supervisor",
      changedBy: "admin-a",
    });

    expect(driverState.lastInsertPayload).toBeNull();
    expect(driverState.lastUpdatePatch).toBeNull();
    expect(driverState.rows[0]?.active).toBe(true);
  });

  it("fails before role write when driver provisioning fails", async () => {
    const roleState: RoleState = { rows: [], lastUpdatePatch: null, lastInsertPayload: null };
    const driverState: DriverState = { rows: [], lastUpdatePatch: null, lastInsertPayload: null };
    const { supabase } = createMockSupabase(roleState, driverState);

    driverState.lastInsertPayload = { display_name: "Driver" };
    const brokenInsert = vi.fn(async () => ({ error: { message: "Driver insert failed" } }));
    (supabase.from as unknown as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      if (table === "drivers") {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
          insert: vi.fn(() => ({ select: vi.fn(() => ({ single: brokenInsert })) })),
        };
      }
      if (table === "app_user_roles") {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
          insert: vi.fn((payload: Record<string, unknown>) => {
            roleState.lastInsertPayload = payload;
            return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })) };
          }),
          update: vi.fn(),
        };
      }
      if (table === "app_user_role_audit_log") {
        return { insert: vi.fn(async () => ({ error: null })) };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(
      updateUserRole(supabase, {
        userId: "user-f",
        roleKey: "driver",
        changedBy: "admin-a",
      }),
    ).rejects.toThrow("Driver insert failed");
  });
});
