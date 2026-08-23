import { z } from "zod";
import { cancelCompoundStockCheck, StockCheckSessionError } from "@/lib/compound-stock-check-session";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";

export const runtime = "nodejs";

const requestSchema = z.object({
  stockCheckId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "stock_check", "edit");

    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const cancelledBy =
      (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
      (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim()) ||
      user.email ||
      user.id;

    const result = await cancelCompoundStockCheck(supabase, {
      stockCheckId: payload.stockCheckId,
      cancelledBy,
    });

    return Response.json(
      {
        ok: true,
        alreadyCancelled: result.alreadyCancelled,
        stockCheck: result.stockCheck,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }

    if (error instanceof StockCheckSessionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid close stock check payload." }, { status: 400 });
    }

    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ error: "Unable to close stock check right now." }, { status: 500 });
  }
}
