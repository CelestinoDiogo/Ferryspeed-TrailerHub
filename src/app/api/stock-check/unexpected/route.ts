import { z } from "zod";
import { authorizeStockCheckMutation } from "@/lib/compound-stock-check-route-auth";
import { StockCheckFindingError, recordStockCheckFinding } from "@/lib/compound-stock-check-unexpected";
import { RbacPermissionError } from "@/lib/rbac/route";
import { StockCheckSessionError } from "@/lib/compound-stock-check-session";
import { SupabaseRouteAuthError } from "@/lib/supabase-route-client";

export const runtime = "nodejs";

const requestSchema = z.object({
  stockCheckId: z.string().uuid(),
  trailerNumber: z.string().min(1),
  actualPosition: z.string().min(1),
  physicalLoad: z.enum(["empty", "loaded"]),
  note: z.string().optional().nullable(),
  confirmUnknown: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const { supabase, operatorName } = await authorizeStockCheckMutation(request, "edit");
    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const result = await recordStockCheckFinding(supabase, {
      stockCheckId: payload.stockCheckId,
      trailerNumber: payload.trailerNumber,
      actualPosition: payload.actualPosition,
      physicalLoad: payload.physicalLoad,
      operatorName,
      note: payload.note,
      confirmUnknown: payload.confirmUnknown,
    });

    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof StockCheckSessionError || error instanceof StockCheckFindingError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid unexpected trailer payload." }, { status: 400 });
    }
    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "Unable to record unexpected trailer." }, { status: 500 });
  }
}
