import { z } from "zod";
import { authorizeStockCheckMutation } from "@/lib/compound-stock-check-route-auth";
import {
  resolveStockCheckDiscrepancy,
  STOCK_CHECK_RESOLUTION_ACTIONS,
  StockCheckResolutionError,
} from "@/lib/compound-stock-check-resolution";
import { RbacPermissionError } from "@/lib/rbac/route";
import { StockCheckSessionError } from "@/lib/compound-stock-check-session";
import { SupabaseRouteAuthError } from "@/lib/supabase-route-client";

export const runtime = "nodejs";

const requestSchema = z.object({
  stockCheckId: z.string().uuid(),
  itemId: z.string().uuid(),
  action: z.enum(STOCK_CHECK_RESOLUTION_ACTIONS),
  note: z.string().optional().nullable(),
  compoundPosition: z.string().optional().nullable(),
  loadStatus: z.enum(["empty", "loaded"]).optional().nullable(),
  customer: z.string().optional().nullable(),
  surface: z.enum(["desktop", "master_mobile"]).optional(),
});

export async function POST(request: Request) {
  try {
    const { supabase, operatorName } = await authorizeStockCheckMutation(request, "edit");
    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const result = await resolveStockCheckDiscrepancy(supabase, {
      stockCheckId: payload.stockCheckId,
      itemId: payload.itemId,
      action: payload.action,
      operatorName,
      note: payload.note,
      compoundPosition: payload.compoundPosition,
      loadStatus: payload.loadStatus,
      customer: payload.customer,
      surface: payload.surface,
    });

    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof StockCheckSessionError || error instanceof StockCheckResolutionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid stock check resolution payload." }, { status: 400 });
    }
    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "Unable to resolve stock check discrepancy." }, { status: 500 });
  }
}
