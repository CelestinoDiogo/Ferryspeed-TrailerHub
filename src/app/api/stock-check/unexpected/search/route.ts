import { authorizeStockCheckMutation } from "@/lib/compound-stock-check-route-auth";
import { searchStockCheckTrailers } from "@/lib/compound-stock-check-unexpected";
import { RbacPermissionError } from "@/lib/rbac/route";
import { SupabaseRouteAuthError } from "@/lib/supabase-route-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { supabase } = await authorizeStockCheckMutation(request, "edit");
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const result = await searchStockCheckTrailers(supabase, query);
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "Unable to search trailers." }, { status: 500 });
  }
}
