import { z } from "zod";
import { bootstrapCurrentUserRole, requireRbacPermission, RbacPermissionError } from "@/lib/rbac/route";
import { createAuthenticatedRouteSupabaseClient, getRouteBearerToken, requireAuthenticatedRouteUser, SupabaseRouteAuthError } from "@/lib/supabase-route-client";
import { createHistoryDateRange, normalizeHistoryPreset, type HistoryDateRangeValue } from "@/lib/history-date-range";
import { loadExecutiveDashboardReportData } from "@/lib/reports/executive-dashboard-report";

const rangeSchema = z.object({
  range: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
}).strict();

const resolveRange = (input: z.infer<typeof rangeSchema>): HistoryDateRangeValue => {
  const preset = normalizeHistoryPreset(input.range);

  if (preset === "custom") {
    const fallback = createHistoryDateRange("today");
    return {
      preset,
      startDate: input.startDate?.trim() || fallback.startDate,
      endDate: input.endDate?.trim() || fallback.endDate,
    };
  }

  return createHistoryDateRange(preset);
};

export async function GET(request: Request) {
  try {
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "reports", "view");

    const url = new URL(request.url);
    const parsed = rangeSchema.parse({
      range: url.searchParams.get("range") ?? undefined,
      startDate: url.searchParams.get("startDate") ?? undefined,
      endDate: url.searchParams.get("endDate") ?? undefined,
    });

    const range = resolveRange(parsed);
    const reportData = await loadExecutiveDashboardReportData(supabase, range);

    return Response.json({ reportData });
  } catch (error) {
    console.error("Load executive dashboard report failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid dashboard date range." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load executive dashboard." }, { status: 500 });
  }
}