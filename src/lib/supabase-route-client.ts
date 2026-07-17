import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export function createAuthenticatedRouteSupabaseClient(request: Request): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  const authorization = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const headers = authorization ? { Authorization: authorization } : undefined;

  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: headers ? { headers } : undefined,
  });
}