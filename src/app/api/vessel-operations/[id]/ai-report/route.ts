import { z } from "zod";
import {
  buildDeterministicVesselOperationAiReportDraft,
  buildVesselOperationAiReportBody,
  buildVesselOperationAiReportSubject,
  generateVesselOperationAiSections,
} from "@/lib/reports/vessel-operation-ai-report";
import {
  finalizeVesselReport,
  isEmailProviderConfigured,
  loadVesselReportHistory,
  saveVesselReportDraft,
  VesselReportLifecycleError,
} from "@/lib/reports/vessel-operation-ai-report-store";
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
  action: z.enum(["generate", "save_draft", "finalize"]).default("generate"),
  draft: z.object({
    reportId: z.string().uuid().nullable().optional(),
    subject: z.string().trim().min(1),
    recipients: z.array(z.string().trim()).default([]),
    cc: z.array(z.string().trim()).default([]),
    generatedContent: z.string().default(""),
    editedContent: z.string().default(""),
    body: z.string().default(""),
    generationMode: z.enum(["ai", "template"]).default("template"),
    usedFallback: z.boolean().default(true),
    aiModel: z.string().nullable().optional(),
    generatedAt: z.string().optional(),
    status: z.enum(["draft", "final", "sent"]).default("draft"),
  }).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const accessToken = getRouteBearerToken(_request);
    const supabase = createAuthenticatedRouteSupabaseClient(_request);
    await requireAuthenticatedRouteUser(supabase, accessToken);
    await requireReadableVesselOperation(supabase, parsedParams.id);
    const reportData = await getVesselOperationReport(supabase, parsedParams.id);
    if (reportData.operation.status !== "completed") {
      return Response.json({
        report: null,
        reportData,
        reportDraft: null,
        draftHistory: [],
        emailProviderConfigured: isEmailProviderConfigured(),
        usedFallback: false,
        message: "AI report preview is available after the vessel operation is completed.",
      });
    }

    const { history, latestDraft } = await loadVesselReportHistory(supabase, parsedParams.id);
    const reportDraft = latestDraft ?? buildDeterministicVesselOperationAiReportDraft(reportData);

    return Response.json({
      report: null,
      reportData,
      reportDraft,
      draftHistory: history,
      emailProviderConfigured: isEmailProviderConfigured(),
      usedFallback: reportDraft.usedFallback,
      message: latestDraft ? "Loaded latest saved draft from report history." : "Live report preview generated from current vessel operation data.",
    });
  } catch (error) {
    console.error("Load AI report failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid vessel operation id." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof SupabaseRouteNotFoundError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json({ error: error instanceof Error ? error.message : "Unable to load AI report." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.parse(await context.params);
    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    await requireReadableVesselOperation(supabase, parsedParams.id);

    const liveData = await getVesselOperationReport(supabase, parsedParams.id);
    if (liveData.operation.status !== "completed") {
      return Response.json({ error: "AI report generation is available only after the vessel operation is completed." }, { status: 409 });
    }

    const generatedBy = user.email ?? user.user_metadata?.full_name ?? user.id;

    if (payload.action === "save_draft" || payload.action === "finalize") {
      if (!payload.draft) {
        return Response.json({ error: "Draft payload is required to save a report draft." }, { status: 400 });
      }

      const input = {
        reportId: payload.draft.reportId ?? null,
        subject: payload.draft.subject,
        recipients: payload.draft.recipients ?? [],
        cc: payload.draft.cc ?? [],
        generatedContent: payload.draft.generatedContent || payload.draft.body,
        editedContent: payload.draft.editedContent || payload.draft.body,
        generationMode: payload.draft.generationMode,
        usedFallback: payload.draft.usedFallback,
        aiModel: payload.draft.aiModel ?? null,
        generatedAt: payload.draft.generatedAt ?? new Date().toISOString(),
      };

      const savedDraft = payload.action === "finalize"
        ? await finalizeVesselReport(supabase, parsedParams.id, generatedBy, input, liveData)
        : await saveVesselReportDraft(supabase, parsedParams.id, generatedBy, input, liveData);

      const { history } = await loadVesselReportHistory(supabase, parsedParams.id);

      return Response.json({
        report: null,
        reportData: liveData,
        reportDraft: savedDraft,
        draftHistory: history,
        emailProviderConfigured: isEmailProviderConfigured(),
        usedFallback: payload.draft.usedFallback,
        message: payload.action === "finalize" ? "Report finalized successfully." : "Draft saved successfully.",
      });
    }

    let reportDraft = buildDeterministicVesselOperationAiReportDraft(liveData);
    let usedFallback = true;
    let message: string | null = "A data-based report has been prepared from the current vessel operation records.";

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const { sections, model } = await generateVesselOperationAiSections(liveData);
        const subject = buildVesselOperationAiReportSubject(liveData);
        const body = buildVesselOperationAiReportBody(sections);
        reportDraft = {
          reportId: null,
          subject,
          recipients: [],
          cc: [],
          body,
          generatedContent: body,
          editedContent: body,
          sections,
          generationMode: "ai",
          usedFallback: false,
          aiModel: model,
          generatedAt: new Date().toISOString(),
          generatedBy: user.email ?? user.user_metadata?.full_name ?? user.id,
          status: "draft",
        };
        usedFallback = false;
        message = null;
      } catch (error) {
        console.error("AI report generation failed:", error);
        message = "A data-based report has been prepared from the current vessel operation records.";
      }
    }

    const { history } = await loadVesselReportHistory(supabase, parsedParams.id);

    return Response.json({
      report: null,
      reportData: liveData,
      reportDraft,
      draftHistory: history,
      emailProviderConfigured: isEmailProviderConfigured(),
      usedFallback,
      message,
    });
  } catch (error) {
    console.error("Generate AI report failed:", error);

    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid request payload.", details: error.flatten() }, { status: 400 });
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

    return Response.json({ error: error instanceof Error ? error.message : "Unable to generate AI report." }, { status: 500 });
  }
}