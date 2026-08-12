"use client";

import { useEffect, useState } from "react";
import { roleKeys, type RoleKey } from "@/lib/auth/roles";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";
const AUTH_LOADING_TIMEOUT_MS = 10_000;
const isDev = process.env.NODE_ENV !== "production";

type RoleSource = "database" | "session_user_metadata" | "unassigned";

type CachedCurrentUserState = {
  userId: string | null;
  state: Omit<CurrentUserState, "isLoading">;
};

let cachedResolvedState: CachedCurrentUserState | null = null;
let inFlightStatePromise: Promise<CachedCurrentUserState> | null = null;

export function resetCurrentUserCache() {
  cachedResolvedState = null;
  inFlightStatePromise = null;
}

const withTimeout = async <T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    }),
  ]);
};

const toRoleKeyOrNull = (value: unknown): RoleKey | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  // Accept legacy/short alias while preserving the app's canonical role key.
  if (normalized === "admin") {
    return "administrator";
  }

  return roleKeys.includes(normalized as RoleKey) ? (normalized as RoleKey) : null;
};

const buildCurrentUserStateFromSessionUser = async (user: User): Promise<Omit<CurrentUserState, "isLoading">> => {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const roleFromMetadata = toRoleKeyOrNull(metadata?.role_key) ?? toRoleKeyOrNull(metadata?.role);

  const { data: roleRow, error: roleError } = await supabase
    .from("app_user_roles")
    .select("role_key, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError && isDev) {
    console.warn("[auth] app_user_roles lookup failed", {
      userId: user.id,
      message: roleError.message,
      code: roleError.code,
    });
  }

  const roleFromDatabase = toRoleKeyOrNull(roleRow?.role_key);
  const roleKey = roleFromDatabase ?? roleFromMetadata ?? null;
  const roleSource: RoleSource = roleFromDatabase ? "database" : roleFromMetadata ? "session_user_metadata" : "unassigned";

  const fullNameFromMetadata = typeof metadata?.full_name === "string" ? metadata.full_name.trim() : "";
  const nameFromMetadata = typeof metadata?.name === "string" ? metadata.name.trim() : "";
  const fullName = fullNameFromMetadata || nameFromMetadata || user.email?.trim() || "Ferryspeed User";

  if (isDev) {
    console.info("[auth] profile loaded", {
      userId: user.id,
      roleKey,
      roleSource,
    });
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName,
    roleKey,
    isActive: roleRow?.is_active ?? true,
    loadError: null,
  };
};

const loadCurrentUserState = async (): Promise<Omit<CurrentUserState, "isLoading">> => {
  const { data, error } = await withTimeout(supabase.auth.getSession(), AUTH_LOADING_TIMEOUT_MS, "Supabase auth.getSession");

  const sessionUser = data.session?.user ?? null;

  if (error || !sessionUser) {
    if (isDev) {
      console.info("[auth] user not available", {
        hasError: Boolean(error),
        message: error?.message ?? null,
      });
    }

    return {
      userId: null,
      email: null,
      fullName: null,
      roleKey: null,
      isActive: null,
      loadError: null,
    };
  }

  if (isDev) {
    console.info("[auth] user loaded", { userId: sessionUser.id });
  }

  return buildCurrentUserStateFromSessionUser(sessionUser);
};

const resolveCurrentUserState = async (): Promise<CachedCurrentUserState> => {
  const state = await loadCurrentUserState();
  return {
    userId: state.userId,
    state,
  };
};

export type CurrentUserState = {
  userId: string | null;
  email: string | null;
  fullName: string | null;
  roleKey: RoleKey | null;
  isActive: boolean | null;
  loadError: string | null;
  isLoading: boolean;
};

export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({
    userId: null,
    email: null,
    fullName: null,
    roleKey: null,
    isActive: null,
    loadError: null,
    isLoading: true,
  });

  useEffect(() => {
    let active = true;
    let authSubscription: { unsubscribe: () => void } | null = null;

    const loadUser = async () => {
      if (active) {
        setState((current) => ({ ...current, isLoading: true }));
      }

      try {
        const { data, error } = await withTimeout(supabase.auth.getSession(), AUTH_LOADING_TIMEOUT_MS, "Supabase auth.getSession");
        const sessionUser = data.session?.user ?? null;

        if (error || !sessionUser) {
          resetCurrentUserCache();

          if (!active) {
            return;
          }

          setState({
            userId: null,
            email: null,
            fullName: null,
            roleKey: null,
            isActive: null,
            loadError: null,
            isLoading: false,
          });
          return;
        }

        if (cachedResolvedState?.userId === sessionUser.id) {
          if (!active) {
            return;
          }

          setState({ ...cachedResolvedState.state, isLoading: false });
          return;
        }

        cachedResolvedState = null;
        inFlightStatePromise = null;

        if (!inFlightStatePromise) {
          inFlightStatePromise = resolveCurrentUserState()
            .then((resolved) => {
              cachedResolvedState = resolved;
              return resolved;
            })
            .finally(() => {
              inFlightStatePromise = null;
            });
        }

        const resolvedState = await inFlightStatePromise;

        if (!active) {
          return;
        }

        setState({
          ...resolvedState.state,
          isLoading: false,
        });
      } catch (error) {
        if (!active) {
          return;
        }

        if (isDev) {
          console.error("[auth] current user load failed", error);
        }

        setState({
          userId: null,
          email: null,
          fullName: null,
          roleKey: null,
          isActive: null,
          loadError: error instanceof Error ? error.message : "Unable to load your session.",
          isLoading: false,
        });
      } finally {
        if (!active) {
          return;
        }

        setState((current) => ({ ...current, isLoading: false }));

        if (isDev) {
          console.info("[auth] current user loading finished");
        }
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") {
        resetCurrentUserCache();
        if (active) {
          void loadUser();
        }
      }
    });

    authSubscription = subscription;
    void loadUser();

    return () => {
      active = false;
      authSubscription?.unsubscribe();
    };
  }, []);

  return state;
}
