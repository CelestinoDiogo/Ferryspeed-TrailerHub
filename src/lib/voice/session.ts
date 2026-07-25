"use client";

import { supabase } from "@/lib/supabase";

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

export const getSessionToken = async () => {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (session?.access_token) {
    return session.access_token;
  }

  const refresh = await supabase.auth.refreshSession();
  if (refresh.data.session?.access_token) {
    return refresh.data.session.access_token;
  }

  if (!user) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  throw new Error(refresh.error?.message ?? "Unable to refresh authentication session.");
};