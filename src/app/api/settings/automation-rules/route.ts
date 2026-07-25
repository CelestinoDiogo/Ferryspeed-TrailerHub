import { z } from "zod";
import {
  createAutomationRule,
  listAutomationExecutions,
  listAutomationRules,
  updateAutomationRule,
} from "@/lib/automation/engine";
import { automationRuleInputSchema, automationRulePatchSchema } from "@/lib/automation/types";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";

export async function GET(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "settings", "view");

    const [rules, executions] = await Promise.all([
      listAutomationRules(supabase),
      listAutomationExecutions(supabase, 120),
    ]);

    return Response.json({ rules, executions });
  } catch (error) {
    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load automation rules." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "settings", "manage_settings");

    const payload = automationRuleInputSchema.parse(await request.json().catch(() => ({})));
    const created = await createAutomationRule(supabase, payload, user.email ?? user.id);
    return Response.json({ rule: created });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid automation rule payload." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to create automation rule." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "settings", "manage_settings");

    const payload = automationRulePatchSchema.parse(await request.json().catch(() => ({})));
    const updated = await updateAutomationRule(supabase, payload, user.email ?? user.id);
    return Response.json({ rule: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid automation rule payload." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to update automation rule." }, { status: 500 });
  }
}
