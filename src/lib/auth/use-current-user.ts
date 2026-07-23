"use client";

import { useEffect, useState } from "react";
import type { Database } from "@/lib/database.types";
import type { RoleKey } from "@/lib/auth/roles";
import { supabase } from "@/lib/supabase";

type AppUserRoleRow = Database["public"]["Tables"]["app_user_roles"]["Row"];

export type CurrentUserState = {
  userId: string | null;
  email: string | null;
  fullName: string | null;
  roleKey: RoleKey | null;
  isActive: boolean | null;
  isLoading: boolean;
};

export function useCurrentUser(): CurrentUserState {
  const [state, setState] = useState<CurrentUserState>({
    userId: null,
    email: null,
    fullName: null,
    roleKey: null,
    isActive: null,
    isLoading: true,
  });

  useEffect(() => {
    let active = true;

    const loadUser = async () => {
      const { data, error } = await supabase.auth.getUser();

      if (!active) {
        return;
      }

      if (error || !data.user) {
        setState((current) => ({ ...current, isLoading: false }));
        return;
      }

      const metadata = data.user.user_metadata;
      const fullNameFromMetadata = typeof metadata?.full_name === "string" ? metadata.full_name.trim() : "";
      const nameFromMetadata = typeof metadata?.name === "string" ? metadata.name.trim() : "";
      const fullName = fullNameFromMetadata || nameFromMetadata || null;

      const { data: roleRow } = await supabase
        .from("app_user_roles")
        .select("role_key, is_active")
        .eq("user_id", data.user.id)
        .maybeSingle();

      if (!active) {
        return;
      }

      const typedRoleRow = roleRow as Pick<AppUserRoleRow, "role_key" | "is_active"> | null;

      setState({
        userId: data.user.id,
        email: data.user.email ?? null,
        fullName,
        roleKey: (typedRoleRow?.role_key as RoleKey | null) ?? null,
        isActive: typedRoleRow?.is_active ?? null,
        isLoading: false,
      });
    };

    void loadUser();

    return () => {
      active = false;
    };
  }, []);

  return state;
}
