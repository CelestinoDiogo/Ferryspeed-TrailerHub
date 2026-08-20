import { z } from "zod";
import {
  createDeliveryBookingIfTrailerAvailable,
  DeliveryBookingAvailabilityError,
  DELIVERY_BOOKING_STATUSES,
} from "@/lib/delivery-booking-availability";
import { TrailerJobConflictError } from "@/lib/trailer-job-eligibility";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";

export const runtime = "nodejs";

const optionalTrimmedText = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

const createDeliveryBookingSchema = z
  .object({
    trailer_id: z.string().uuid(),
    driver_id: z.string().uuid().nullable().optional(),
    delivery_date: z.string().trim().min(1),
    delivery_time: optionalTrimmedText,
    customer: optionalTrimmedText,
    consignee: optionalTrimmedText,
    delivery_location: optionalTrimmedText,
    booking_reference: optionalTrimmedText,
    escort_required: z.boolean().optional(),
    status: z.enum(DELIVERY_BOOKING_STATUSES).optional(),
    notes: optionalTrimmedText,
  })
  .strict();

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "arrivals", "create");

    const payload = createDeliveryBookingSchema.parse(await request.json().catch(() => ({})));
    const booking = await createDeliveryBookingIfTrailerAvailable(supabase, payload);

    return Response.json({ booking }, { status: 201 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError || error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof DeliveryBookingAvailabilityError || error instanceof TrailerJobConflictError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid delivery booking payload." }, { status: 400 });
    }

    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to create delivery booking." },
      { status: 400 },
    );
  }
}
