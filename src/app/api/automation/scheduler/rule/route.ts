import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runScheduledAutomationRule } from "@/lib/automation/engine";
import { schedulerJobKeys } from "@/lib/automation/types";
import type { Database } from "@/lib/database.types";

const payloadSchema = z.object({
  ruleId: z.string().uuid(),
  schedulerJob: z.enum(schedulerJobKeys).nullable().optional(),
}).strict();

const getServiceSupabase = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");
  }

  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
};

const requireSchedulerToken = (request: Request) => {
  const expected = process.env.AUTOMATION_SCHEDULER_TOKEN;
  if (!expected) {
    throw new Error("Missing AUTOMATION_SCHEDULER_TOKEN.");
  }

  const provided = request.headers.get("x-automation-token") ?? "";
  return provided === expected;
};

export async function POST(request: Request) {
  try {
    if (!requireSchedulerToken(request)) {
      return Response.json({ error: "Unauthorized scheduler call." }, { status: 401 });
    }

    const payload = payloadSchema.parse(await request.json().catch(() => ({})));
    const supabase = getServiceSupabase();
    const summary = await runScheduledAutomationRule(supabase, {
      ruleId: payload.ruleId,
      schedulerJob: payload.schedulerJob ?? null,
    });

    return Response.json({ ok: true, summary });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid scheduler rule payload." }, { status: 400 });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to run scheduler rule." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
