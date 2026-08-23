import { z } from "zod";
import { authorizeStockCheckMutation } from "@/lib/compound-stock-check-route-auth";
import { completeCompoundStockCheck, StockCheckSessionError } from "@/lib/compound-stock-check-session";
import { RbacPermissionError } from "@/lib/rbac/route";
import { SupabaseRouteAuthError } from "@/lib/supabase-route-client";

export const runtime = "nodejs";

const requestSchema = z.object({
  stockCheckId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const { supabase, operatorName } = await authorizeStockCheckMutation(request, "edit");
    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const result = await completeCompoundStockCheck(supabase, {
      stockCheckId: payload.stockCheckId,
      completedBy: operatorName,
    });

    return Response.json({ ok: true, ...result }, { status: 200 });
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
      return Response.json({ error: "Invalid complete stock check payload." }, { status: 400 });
    }
    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "Unable to complete stock check." }, { status: 500 });
  }
}
