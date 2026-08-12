import { z } from "zod";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { applyDriverTaskAction } from "@/lib/driver-mobile-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  bookingId: z.string().uuid(),
  action: z.enum(["ACKNOWLEDGED", "COLLECTED", "DELIVERED"]),
  temperatureC: z.number().finite().min(-60).max(60).optional(),
});

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "driver_mobile", "view");

    const payload = requestSchema.parse(await request.json().catch(() => ({})));

    const updatedBooking = await applyDriverTaskAction({
      supabase,
      user,
      bookingId: payload.bookingId,
      action: payload.action,
      temperatureC: payload.temperatureC,
    });

    return Response.json({ ok: true, booking: updatedBooking }, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid driver action payload." }, { status: 400 });
    }

    if (error instanceof Error) {
      if (error.message.includes("not assigned") || error.message.includes("not found")) {
        return Response.json({ error: error.message }, { status: 404 });
      }

      if (error.message.includes("not eligible") || error.message.includes("No driver profile linked")) {
        return Response.json({ error: error.message }, { status: 409 });
      }

      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ error: "Unable to update driver task right now." }, { status: 500 });
  }
}
