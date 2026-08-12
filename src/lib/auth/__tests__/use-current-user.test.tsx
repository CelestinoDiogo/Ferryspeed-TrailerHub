// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCurrentUser, resetCurrentUserCache } from "@/lib/auth/use-current-user";

type SessionUser = {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
};

type AuthCallback = (event: string, session: { access_token?: string; user?: SessionUser } | null) => void;

const state = vi.hoisted(() => {
  return {
    currentUser: null as SessionUser | null,
    roleByUserId: new Map<string, { role_key: string; is_active: boolean }>(),
    authCallbacks: [] as AuthCallback[],
    roleLookupCount: 0,
  };
});

const emitAuthEvent = (event: string, user: SessionUser | null) => {
  const session = user ? { access_token: "token", user } : null;
  for (const callback of state.authCallbacks) {
    callback(event, session);
  }
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: state.currentUser ? { access_token: "token", user: state.currentUser } : null,
        },
        error: null,
      })),
      onAuthStateChange: vi.fn((callback: AuthCallback) => {
        state.authCallbacks.push(callback);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                state.authCallbacks = state.authCallbacks.filter((item) => item !== callback);
              },
            },
          },
        };
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((_column: string, userId: string) => ({
          maybeSingle: vi.fn(async () => {
            state.roleLookupCount += 1;
            return {
              data: state.roleByUserId.get(userId) ?? null,
              error: null,
            };
          }),
        })),
      })),
    })),
  },
}));

function CurrentUserProbe() {
  const state = useCurrentUser();
  return (
    <div>
      <p data-testid="is-loading">{state.isLoading ? "yes" : "no"}</p>
      <p data-testid="user-id">{state.userId ?? "none"}</p>
      <p data-testid="role-key">{state.roleKey ?? "none"}</p>
    </div>
  );
}

describe("useCurrentUser cache and auth transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCurrentUserCache();
    state.currentUser = null;
    state.roleByUserId.clear();
    state.authCallbacks = [];
    state.roleLookupCount = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("resolves the correct role after user transition and never reuses another user's role", async () => {
    const adminUser = { id: "user-admin", email: "admin@example.com", user_metadata: {} };
    const driverUser = { id: "user-driver", email: "driver@example.com", user_metadata: {} };

    state.currentUser = adminUser;
    state.roleByUserId.set(adminUser.id, { role_key: "administrator", is_active: true });
    state.roleByUserId.set(driverUser.id, { role_key: "driver", is_active: true });

    render(<CurrentUserProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("is-loading")).toHaveTextContent("no");
      expect(screen.getByTestId("user-id")).toHaveTextContent("user-admin");
      expect(screen.getByTestId("role-key")).toHaveTextContent("administrator");
    });

    state.currentUser = null;
    await act(async () => {
      emitAuthEvent("SIGNED_OUT", null);
    });

    await waitFor(() => {
      expect(screen.getByTestId("user-id")).toHaveTextContent("none");
      expect(screen.getByTestId("role-key")).toHaveTextContent("none");
    });

    state.currentUser = driverUser;
    await act(async () => {
      emitAuthEvent("SIGNED_IN", driverUser);
    });

    await waitFor(() => {
      expect(screen.getByTestId("user-id")).toHaveTextContent("user-driver");
      expect(screen.getByTestId("role-key")).toHaveTextContent("driver");
    });
  });

  it("reuses cached role for the same authenticated user", async () => {
    const user = { id: "user-a", email: "a@example.com", user_metadata: {} };
    state.currentUser = user;
    state.roleByUserId.set(user.id, { role_key: "driver", is_active: true });

    const first = render(<CurrentUserProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("role-key")).toHaveTextContent("driver");
    });

    expect(state.roleLookupCount).toBe(1);

    first.unmount();

    render(<CurrentUserProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("role-key")).toHaveTextContent("driver");
    });

    expect(state.roleLookupCount).toBe(1);
  });

  it("invalidates cached identity when authenticated user id changes", async () => {
    const userA = { id: "user-a", email: "a@example.com", user_metadata: {} };
    const userB = { id: "user-b", email: "b@example.com", user_metadata: {} };

    state.currentUser = userA;
    state.roleByUserId.set(userA.id, { role_key: "administrator", is_active: true });
    state.roleByUserId.set(userB.id, { role_key: "driver", is_active: true });

    const first = render(<CurrentUserProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("user-id")).toHaveTextContent("user-a");
      expect(screen.getByTestId("role-key")).toHaveTextContent("administrator");
    });

    expect(state.roleLookupCount).toBe(1);
    first.unmount();

    state.currentUser = userB;
    render(<CurrentUserProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("user-id")).toHaveTextContent("user-b");
      expect(screen.getByTestId("role-key")).toHaveTextContent("driver");
    });

    expect(state.roleLookupCount).toBe(2);
  });

  it("reloads role on USER_UPDATED event for the current user", async () => {
    const user = { id: "user-driver", email: "driver@example.com", user_metadata: {} };
    state.currentUser = user;
    state.roleByUserId.set(user.id, { role_key: "operator", is_active: true });

    render(<CurrentUserProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("role-key")).toHaveTextContent("operator");
    });

    state.roleByUserId.set(user.id, { role_key: "driver", is_active: true });

    await act(async () => {
      emitAuthEvent("USER_UPDATED", user);
    });

    await waitFor(() => {
      expect(screen.getByTestId("role-key")).toHaveTextContent("driver");
    });
  });
});
