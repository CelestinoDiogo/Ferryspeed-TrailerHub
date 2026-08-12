import { z } from "zod";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import {
  DRIVER_INSTRUCTION_MAX_LENGTH,
  listOperationalInstructionsForDriverContext,
  sendDriverOperationalInstruction,
} from "@/lib/driver-operational-instructions";

export const runtime = "nodejs";

const readQuerySchema = z.object({
  driverId: z.string().uuid(),
  deliveryBookingId: z.string().uuid().optional(),
  trailerId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const sendInstructionSchema = z.object({
  driverId: z.string().uuid(),
  deliveryBookingId: z.string().uuid().optional(),
  trailerId: z.string().uuid().optional(),
  trailerNumber: z.string().trim().max(32).optional(),
  instruction: z.string().trim().min(1).max(DRIVER_INSTRUCTION_MAX_LENGTH),
  priority: z.enum(["normal", "high", "critical"]).optional(),
});

export async function GET(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "dashboard", "view");

    const params = new URL(request.url).searchParams;
    const query = readQuerySchema.parse({
      driverId: params.get("driverId") ?? undefined,
      deliveryBookingId: params.get("deliveryBookingId") ?? undefined,
      trailerId: params.get("trailerId") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });

    const items = await listOperationalInstructionsForDriverContext(supabase, {
      userId: user.id,
      driverId: query.driverId,
      deliveryBookingId: query.deliveryBookingId,
      trailerId: query.trailerId,
      limit: query.limit,
    });

    return Response.json({ instructions: items }, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid operational instructions query." }, { status: 400 });
    }

    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    return Response.json({ error: "Unable to load operational instructions right now." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "dashboard", "create");

    const payload = sendInstructionSchema.parse(await request.json().catch(() => ({})));

    const created = await sendDriverOperationalInstruction(
      supabase,
      {
        driverId: payload.driverId,
        deliveryBookingId: payload.deliveryBookingId,
        trailerId: payload.trailerId,
        trailerNumber: payload.trailerNumber,
        instruction: payload.instruction,
        priority: payload.priority,
      },
      user,
    );

    return Response.json({ ok: true, instruction: created }, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid send-instruction payload." }, { status: 400 });
    }

    if (error instanceof Error) {
      const lowered = error.message.toLowerCase();
      if (lowered.includes("not found") || lowered.includes("not linked") || lowered.includes("not assigned")) {
        return Response.json({ error: error.message }, { status: 404 });
      }

      if (lowered.includes("required") || lowered.includes("must be") || lowered.includes("does not match")) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      return Response.json({ error: error.message }, { status: 403 });
    }

    return Response.json({ error: "Unable to send operational instruction right now." }, { status: 500 });
  }
}
