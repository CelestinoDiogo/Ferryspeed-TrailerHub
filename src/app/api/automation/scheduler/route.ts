import { createClient } from "@supabase/supabase-js";
import { runScheduledAutomationJobs } from "@/lib/automation/engine";
import type { Database } from "@/lib/database.types";

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
  if (provided !== expected) {
    return false;
  }

  return true;
};

export async function POST(request: Request) {
  try {
    if (!requireSchedulerToken(request)) {
      return Response.json({ error: "Unauthorized scheduler call." }, { status: 401 });
    }

    const supabase = getServiceSupabase();
    const summaries = await runScheduledAutomationJobs(supabase);
    return Response.json({ ok: true, summaries });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run scheduler." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
