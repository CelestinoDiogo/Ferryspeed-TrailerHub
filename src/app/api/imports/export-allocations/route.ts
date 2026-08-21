import { z } from "zod";
import { persistExportAllocationImport } from "@/lib/imports/export-allocation-import-persist";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";

export const runtime = "nodejs";

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

const confirmRowSchema = z.object({
  trailerNumber: optionalText,
  customer: z.string().trim().min(1),
  collectionAddress: optionalText,
  haulier: optionalText,
  bookingReference: optionalText,
  loadType: optionalText,
  collectionDate: z.string().trim().min(1),
  expectedReturnAt: optionalText,
  priority: optionalText,
  notes: optionalText,
  sourceLine: optionalText,
  rowNumber: z.number().int().positive().nullable().optional(),
});

const confirmSchema = z.object({
  rows: z.array(confirmRowSchema).min(1),
});

const resolveOperatorName = (user: { email?: string | null; user_metadata?: Record<string, unknown> | null }) => {
  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim())
    || (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || "TrailerHub User";
};

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "export_operations", "edit");

    const payload = confirmSchema.parse(await request.json().catch(() => ({})));
    const result = await persistExportAllocationImport({
      supabase,
      operatorName: resolveOperatorName(user),
      rows: payload.rows,
    });

    return Response.json({ result }, { status: result.created.length > 0 ? 201 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid export Excel confirm request." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Export Excel import confirm failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to confirm export Excel import." },
      { status: 500 },
    );
  }
}
