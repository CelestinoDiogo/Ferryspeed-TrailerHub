import { supabase } from "@/lib/supabase";

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

export async function getAccessTokenOrThrow() {
  const sessionResult = await supabase.auth.getSession();
  const session = sessionResult.data.session;

  if (!session?.access_token) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  if (session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 30) {
    const refreshResult = await supabase.auth.refreshSession();
    const refreshedToken = refreshResult.data.session?.access_token;

    if (refreshedToken) {
      return refreshedToken;
    }

    if (refreshResult.error) {
      throw new Error(refreshResult.error.message);
    }

    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  return session.access_token;
}

export async function fetchRbacJson<T>(input: string, init?: RequestInit): Promise<T> {
  const token = await getAccessTokenOrThrow();
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Unable to complete request.");
  }

  return payload;
}
