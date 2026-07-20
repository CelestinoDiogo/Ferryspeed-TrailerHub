import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export class SupabaseRouteAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "SupabaseRouteAuthError";
    this.status = status;
  }
}

export class SupabaseRouteNotFoundError extends Error {
  status: number;

  constructor(message: string, status = 404) {
    super(message);
    this.name = "SupabaseRouteNotFoundError";
    this.status = status;
  }
}

export function getRouteBearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? request.headers.get("Authorization");

  if (!authorization) {
    throw new SupabaseRouteAuthError("Missing or invalid authentication token.", 401);
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    throw new SupabaseRouteAuthError("Missing or invalid authentication token.", 401);
  }

  return token;
}

export function createAuthenticatedRouteSupabaseClient(request: Request): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  const accessToken = getRouteBearerToken(request);

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function requireAuthenticatedRouteUser(
  supabase: SupabaseClient<Database>,
  accessToken: string,
) {
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error) {
    throw new SupabaseRouteAuthError("Missing or invalid authentication token.", 401);
  }

  if (!data.user) {
    throw new SupabaseRouteAuthError("Missing or invalid authentication token.", 401);
  }

  return data.user;
}

export async function requireReadableVesselOperation(
  supabase: SupabaseClient<Database>,
  vesselOperationId: string,
) {
  const { data, error } = await supabase
    .from("vessel_operations")
    .select("id")
    .eq("id", vesselOperationId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load vessel operation.");
  }

  if (!data) {
    throw new SupabaseRouteNotFoundError("Vessel operation not found.", 404);
  }

  return data;
}