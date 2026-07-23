import { z } from "zod";
import {
  isEmailProviderConfigured,
  loadVesselReportDraftById,
  loadVesselReportHistory,
  markVesselReportAsSent,
  VesselReportLifecycleError,
} from "@/lib/reports/vessel-operation-ai-report-store";
import { sendVesselReportEmail, VesselReportEmailError } from "@/lib/reports/vessel-report-email";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  requireReadableVesselOperation,
  SupabaseRouteAuthError,
  SupabaseRouteNotFoundError,
} from "@/lib/supabase-route-client";
import { getVesselOperationReport } from "@/lib/vessel-report";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const requestSchema = z.object({
  reportId: z.string().uuid(),
  sendDraft: z.boolean().optional(),
  recipients: z.array(z.string().trim()).optional(),
  cc: z.array(z.string().trim()).optional(),
  subject: z.string().trim().optional(),
  body: z.string().optional(),
});

const EMAIL_SPLIT_PATTERN = /[\n,;]+/;

const splitAndNormalizeEmails = (values: string[]) => {
  const expanded = values
    .flatMap((value) => value.split(EMAIL_SPLIT_PATTERN))
    .map((value) => value.trim())
    .filter(Boolean);

  const deduped = new Set<string>();
  for (const email of expanded) {
    deduped.add(email.toLowerCase());
  }

  return [...deduped];
};

const sanitizeTextInput = (value: string) => {
  return value.replace(/[\r\n]/g, " ").trim();
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await requireReadableVesselOperation(supabase, parsedParams.id);

    if (!isEmailProviderConfigured()) {
      return Response.json({ error: "Email delivery is not configured yet." }, { status: 412 });
    }

    const reportData = await getVesselOperationReport(supabase, parsedParams.id);
    if (reportData.operation.status !== "completed") {
      return Response.json({ error: "AI report delivery is available only after the vessel operation is completed." }, { status: 409 });
    }

    const selectedDraft = await loadVesselReportDraftById(supabase, parsedParams.id, payload.reportId);

    if (selectedDraft.status === "draft" && !payload.sendDraft) {
      return Response.json({ error: "This report is still a draft. Send it anyway?" }, { status: 409 });
    }

    const recipients = splitAndNormalizeEmails(payload.recipients ?? selectedDraft.recipients ?? []);
    const cc = splitAndNormalizeEmails(payload.cc ?? selectedDraft.cc ?? []);
    const subject = sanitizeTextInput(payload.subject ?? selectedDraft.subject ?? "");
    const body = (payload.body ?? selectedDraft.body ?? "").replace(/\r/g, "").trim();

    if (recipients.length === 0) {
      return Response.json({ error: "Add at least one valid recipient before sending this report." }, { status: 400 });
    }

    if (!subject) {
      return Response.json({ error: "Subject cannot be empty." }, { status: 400 });
    }

    if (!body) {
      return Response.json({ error: "Report body cannot be empty." }, { status: 400 });
    }

    const sendResult = await sendVesselReportEmail({
      subject,
      body,
      recipients,
      cc,
      vesselName: reportData.operation.vesselName,
      voyageReference: reportData.operation.voyageReference,
      reportDate: reportData.operation.operationCompletedAt ?? reportData.operation.actualArrivalAt ?? new Date().toISOString(),
      metrics: {
        expectedTrailers: reportData.statistics.expectedTrailers,
        arrivedTrailers: reportData.statistics.arrivedTrailers,
        inspectedTrailers: reportData.statistics.inspectedTrailers,
        pendingInspections: reportData.statistics.pendingInspections,
        damagedTrailers: reportData.statistics.damagedTrailers,
        temperatureAlertTrailers: reportData.statistics.temperatureAlertTrailers,
        notDischargedTrailers: reportData.statistics.notDischargedTrailers,
      },
    });

    const sentBy = user.email ?? user.user_metadata?.full_name ?? user.id;
    const sentDraft = await markVesselReportAsSent(supabase, parsedParams.id, payload.reportId, sentBy, {
      recipients: sendResult.recipients,
      cc: sendResult.cc,
      subject: sendResult.subject,
      body: sendResult.body,
    });
    const { history } = await loadVesselReportHistory(supabase, parsedParams.id);

    return Response.json({
      report: null,
      reportData,
      reportDraft: sentDraft,
      draftHistory: history,
      emailProviderConfigured: true,
      usedFallback: sentDraft.usedFallback,
      message: "Report sent successfully.",
    });
  } catch (error) {
    console.error("Send AI report failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid request payload." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof SupabaseRouteNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof VesselReportLifecycleError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof VesselReportEmailError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: "The report could not be sent. Please try again." }, { status: 500 });
  }
}
