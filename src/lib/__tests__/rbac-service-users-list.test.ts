import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

const { listUsersMock, createClientMock } = vi.hoisted(() => {
  const listUsers = vi.fn();
  const createClient = vi.fn(() => ({
    auth: {
      admin: {
        listUsers,
      },
    },
  }));

  return {
    listUsersMock: listUsers,
    createClientMock: createClient,
  };
});

vi.mock("@supabase/supabase-js", async () => {
  const actual = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
  return {
    ...actual,
    createClient: createClientMock,
  };
});

import { listUsersWithRoles } from "@/lib/rbac/service";
import type { Database } from "@/lib/database.types";
import type { AppUserRoleRow } from "@/lib/rbac/types";

const makeAuthUser = (overrides: Partial<User>): User => ({
  id: "11111111-1111-4111-8111-111111111111",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-08-12T00:00:00.000Z",
  email: "user-a@example.com",
  last_sign_in_at: null,
  identities: [],
  ...overrides,
} as User);

const makeRoleRow = (overrides: Partial<AppUserRoleRow>): AppUserRoleRow => ({
  user_id: "11111111-1111-4111-8111-111111111111",
  email: "user-a@example.com",
  display_name: "User A",
  role_key: "administrator",
  is_active: true,
  created_at: "2026-08-12T00:00:00.000Z",
  updated_at: "2026-08-12T00:00:00.000Z",
  ...overrides,
});

type MockSupabaseState = {
  roleRows: AppUserRoleRow[];
  driverUserIds: string[];
};

const createReadOnlySupabase = (state: MockSupabaseState) => {
  const roleOrder = vi.fn(async () => ({ data: state.roleRows, error: null }));
  const roleSelect = vi.fn(() => ({ order: roleOrder }));

  const driversNot = vi.fn(async () => ({
    data: state.driverUserIds.map((userId) => ({ user_id: userId })),
    error: null,
  }));
  const driversSelect = vi.fn(() => ({ not: driversNot }));

  const roleInsert = vi.fn(() => {
    throw new Error("app_user_roles insert must not be called during list");
  });
  const roleUpdate = vi.fn(() => {
    throw new Error("app_user_roles update must not be called during list");
  });
  const roleUpsert = vi.fn(() => {
    throw new Error("app_user_roles upsert must not be called during list");
  });

  const driverInsert = vi.fn(() => {
    throw new Error("drivers insert must not be called during list");
  });
  const driverUpdate = vi.fn(() => {
    throw new Error("drivers update must not be called during list");
  });

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "app_user_roles") {
        return {
          select: roleSelect,
          insert: roleInsert,
          update: roleUpdate,
          upsert: roleUpsert,
        };
      }

      if (table === "drivers") {
        return {
          select: driversSelect,
          insert: driverInsert,
          update: driverUpdate,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient<Database>;

  return {
    supabase,
    spies: {
      roleInsert,
      roleUpdate,
      roleUpsert,
      driverInsert,
      driverUpdate,
    },
  };
};

describe("listUsersWithRoles", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    listUsersMock.mockResolvedValue({ data: { users: [] }, error: null });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  });

  it("returns auth user with app role row", async () => {
    listUsersMock.mockResolvedValueOnce({
      data: {
        users: [
          makeAuthUser({
            id: "user-a",
            email: "user-a@example.com",
            user_metadata: { full_name: "User A" },
            last_sign_in_at: "2026-08-12T09:00:00.000Z",
          }),
        ],
      },
      error: null,
    });

    const { supabase } = createReadOnlySupabase({
      roleRows: [
        makeRoleRow({
          user_id: "user-a",
          role_key: "administrator",
          is_active: true,
        }),
      ],
      driverUserIds: [],
    });

    const users = await listUsersWithRoles(supabase);

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      userId: "user-a",
      email: "user-a@example.com",
      displayName: "User A",
      roleKey: "administrator",
      isActive: true,
      lastSignInAt: "2026-08-12T09:00:00.000Z",
      driverLinked: false,
    });
  });

  it("returns auth user without role row as unassigned", async () => {
    listUsersMock.mockResolvedValueOnce({
      data: {
        users: [
          makeAuthUser({
            id: "user-b",
            email: "user-b@example.com",
            user_metadata: { name: "User B" },
          }),
        ],
      },
      error: null,
    });

    const { supabase } = createReadOnlySupabase({ roleRows: [], driverUserIds: [] });
    const users = await listUsersWithRoles(supabase);

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      userId: "user-b",
      email: "user-b@example.com",
      displayName: "User B",
      roleKey: null,
      isActive: null,
      driverLinked: false,
    });
  });

  it("returns all auth users even when only one role row exists", async () => {
    listUsersMock.mockResolvedValueOnce({
      data: {
        users: [
          makeAuthUser({ id: "user-a", email: "a@example.com" }),
          makeAuthUser({ id: "user-b", email: "b@example.com" }),
          makeAuthUser({ id: "user-c", email: "c@example.com" }),
        ],
      },
      error: null,
    });

    const { supabase } = createReadOnlySupabase({
      roleRows: [makeRoleRow({ user_id: "user-b", role_key: "administrator", email: "b@example.com" })],
      driverUserIds: ["user-b"],
    });

    const users = await listUsersWithRoles(supabase);

    expect(users).toHaveLength(3);
    expect(users.map((item) => item.userId).sort()).toEqual(["user-a", "user-b", "user-c"]);

    const userB = users.find((item) => item.userId === "user-b");
    expect(userB).toMatchObject({ roleKey: "administrator", isActive: true, driverLinked: true });

    const unassigned = users.filter((item) => item.roleKey === null);
    expect(unassigned).toHaveLength(2);
  });

  it("maps auth last sign-in metadata when available", async () => {
    listUsersMock.mockResolvedValueOnce({
      data: {
        users: [makeAuthUser({ id: "user-a", email: "a@example.com", last_sign_in_at: "2026-08-12T10:11:12.000Z" })],
      },
      error: null,
    });

    const { supabase } = createReadOnlySupabase({ roleRows: [], driverUserIds: [] });
    const users = await listUsersWithRoles(supabase);

    expect(users[0]?.lastSignInAt).toBe("2026-08-12T10:11:12.000Z");
  });

  it("supports bounded pagination when listing auth users", async () => {
    const firstPageUsers = Array.from({ length: 200 }, (_, index) =>
      makeAuthUser({ id: `user-${index + 1}`, email: `u${index + 1}@example.com` }),
    );
    const secondPageUsers = [makeAuthUser({ id: "user-201", email: "u201@example.com" })];

    listUsersMock
      .mockResolvedValueOnce({ data: { users: firstPageUsers }, error: null })
      .mockResolvedValueOnce({ data: { users: secondPageUsers }, error: null });

    const { supabase } = createReadOnlySupabase({ roleRows: [], driverUserIds: [] });
    const users = await listUsersWithRoles(supabase);

    expect(users).toHaveLength(201);
    expect(listUsersMock).toHaveBeenCalledTimes(2);
    expect(listUsersMock).toHaveBeenNthCalledWith(1, { page: 1, perPage: 200 });
    expect(listUsersMock).toHaveBeenNthCalledWith(2, { page: 2, perPage: 200 });
  });

  it("remains read-only and does not create role or driver rows", async () => {
    listUsersMock.mockResolvedValueOnce({
      data: {
        users: [makeAuthUser({ id: "user-a", email: "a@example.com" })],
      },
      error: null,
    });

    const { supabase, spies } = createReadOnlySupabase({ roleRows: [], driverUserIds: [] });

    await listUsersWithRoles(supabase);

    expect(spies.roleInsert).not.toHaveBeenCalled();
    expect(spies.roleUpdate).not.toHaveBeenCalled();
    expect(spies.roleUpsert).not.toHaveBeenCalled();
    expect(spies.driverInsert).not.toHaveBeenCalled();
    expect(spies.driverUpdate).not.toHaveBeenCalled();
  });

  it("fails with a clear blocker when service-role env is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { supabase } = createReadOnlySupabase({ roleRows: [], driverUserIds: [] });

    await expect(listUsersWithRoles(supabase)).rejects.toThrow(
      "Unable to list Auth users. Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL in server environment.",
    );
  });

  it("uses service-role admin API on server-side only", async () => {
    listUsersMock.mockResolvedValueOnce({ data: { users: [] }, error: null });
    const { supabase } = createReadOnlySupabase({ roleRows: [], driverUserIds: [] });

    await listUsersWithRoles(supabase);

    expect(createClientMock).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "service-role-key",
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        }),
      }),
    );
    expect(listUsersMock).toHaveBeenCalled();
  });
});
