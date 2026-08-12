import { z } from "zod";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { markDriverOperationalInstructionRead } from "@/lib/driver-operational-instructions";

export const runtime = "nodejs";

const requestSchema = z.object({
  instructionId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "driver_mobile", "view");

    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const instruction = await markDriverOperationalInstructionRead(supabase, {
      instructionId: payload.instructionId,
    });

    return Response.json({ ok: true, instruction }, { status: 200 });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid mark-read payload." }, { status: 400 });
    }

    if (error instanceof Error) {
      if (error.message.toLowerCase().includes("not found")) {
        return Response.json({ error: error.message }, { status: 404 });
      }

      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ error: "Unable to mark instruction as read right now." }, { status: 500 });
  }
}
