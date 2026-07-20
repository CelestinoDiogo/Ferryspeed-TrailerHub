import { z } from "zod";
import {
  buildDeterministicVesselOperationAiReportDraft,
  buildVesselOperationAiReportBody,
  buildVesselOperationAiReportSubject,
  generateVesselOperationAiSections,
} from "@/lib/reports/vessel-operation-ai-report";
import type { VesselOperationAiReportDraft, VesselOperationAiReportHistoryItem } from "@/lib/reports/types";
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
  action: z.enum(["generate", "save_draft"]).default("generate"),
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
  }).optional(),
});

type DbReportRow = {
  id?: string;
  created_at?: string;
  generated_at?: string;
  generated_by?: string | null;
  subject?: string | null;
  title?: string | null;
  recipients?: string[] | null;
  cc?: string[] | null;
  generated_content?: string | null;
  edited_content?: string | null;
  executive_summary?: string | null;
  report_status?: string | null;
  generated_by_ai?: boolean | null;
  ai_model?: string | null;
};

const normalizeEmails = (values: string[]) => {
  const unique = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) {
      unique.add(trimmed);
    }
  }
  return [...unique];
};

const toHistoryItem = (row: DbReportRow): VesselOperationAiReportHistoryItem | null => {
  if (!row.id) {
    return null;
  }

  const generatedAt = row.generated_at ?? row.created_at ?? new Date().toISOString();
  const generationMode = row.generated_by_ai ? "ai" : "template";

  return {
    reportId: row.id,
    generatedAt,
    generatedBy: row.generated_by ?? null,
    subject: row.subject ?? row.title ?? "Vessel Operations Report",
    recipients: Array.isArray(row.recipients) ? row.recipients : [],
    cc: Array.isArray(row.cc) ? row.cc : [],
    generationMode,
    status: "draft",
  };
};

const toDraft = (row: DbReportRow): VesselOperationAiReportDraft | null => {
  const history = toHistoryItem(row);
  if (!history) {
    return null;
  }

  const generatedContent = row.generated_content ?? row.executive_summary ?? "";
  const editedContent = row.edited_content ?? generatedContent;
  const body = editedContent || generatedContent;

  return {
    reportId: history.reportId,
    subject: history.subject,
    recipients: history.recipients,
    cc: history.cc,
    body,
    generatedContent,
    editedContent,
    sections: {
      operationOverview: "",
      trailerDischargeSummary: "",
      inspectionSummary: "",
      damageFindings: "",
      temperatureFindings: "",
      outstandingItems: "",
      finalOperationalStatus: "",
    },
    generationMode: history.generationMode,
    usedFallback: history.generationMode === "template",
    aiModel: row.ai_model ?? null,
    generatedAt: history.generatedAt,
    generatedBy: history.generatedBy,
    status: "draft",
  };
};

async function loadDraftHistory(supabase: ReturnType<typeof createAuthenticatedRouteSupabaseClient>, operationId: string) {
  const db = supabase as any;
  const columns = "id, created_at, generated_at, generated_by, subject, title, recipients, cc, generated_content, edited_content, executive_summary, report_status, generated_by_ai, ai_model";

  const { data, error } = await db
    .from("vessel_operation_reports")
    .select(columns)
    .eq("vessel_operation_id", operationId)
    .eq("report_status", "draft")
    .order("generated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(error.message || "Unable to load AI report draft history.");
  }

  const rows = (data ?? []) as DbReportRow[];
  const history = rows.map(toHistoryItem).filter((item): item is VesselOperationAiReportHistoryItem => Boolean(item));
  const latestDraft = rows.length > 0 ? toDraft(rows[0]) : null;

  return {
    history,
    latestDraft,
  };
}

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
        usedFallback: false,
        message: "AI report preview is available after the vessel operation is completed.",
      });
    }

    const { history, latestDraft } = await loadDraftHistory(supabase, parsedParams.id);
    const reportDraft = latestDraft ?? buildDeterministicVesselOperationAiReportDraft(reportData);

    return Response.json({
      report: null,
      reportData,
      reportDraft,
      draftHistory: history,
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

    if (payload.action === "save_draft") {
      if (!payload.draft) {
        return Response.json({ error: "Draft payload is required to save a report draft." }, { status: 400 });
      }

      const db = supabase as any;
      const generatedAt = payload.draft.generatedAt ?? new Date().toISOString();
      const generatedBy = user.email ?? user.user_metadata?.full_name ?? user.id;
      const recipients = normalizeEmails(payload.draft.recipients ?? []);
      const cc = normalizeEmails(payload.draft.cc ?? []);
      const generatedContent = payload.draft.generatedContent || payload.draft.body;
      const editedContent = payload.draft.editedContent || payload.draft.body;
      const snapshot = {
        operation: liveData.operation,
        statistics: liveData.statistics,
      };

      const record = {
        vessel_operation_id: parsedParams.id,
        report_type: "operational",
        report_status: "draft",
        title: payload.draft.subject,
        subject: payload.draft.subject,
        recipients,
        cc,
        generated_content: generatedContent,
        edited_content: editedContent,
        executive_summary: generatedContent,
        structured_snapshot: snapshot,
        structured_data_snapshot: snapshot,
        generated_by_ai: payload.draft.generationMode === "ai",
        ai_model: payload.draft.aiModel ?? null,
        generated_at: generatedAt,
        generated_by: generatedBy,
      };

      let savedRow: DbReportRow | null = null;

      if (payload.draft.reportId) {
        const { data, error } = await db
          .from("vessel_operation_reports")
          .update(record)
          .eq("id", payload.draft.reportId)
          .eq("vessel_operation_id", parsedParams.id)
          .select("id, created_at, generated_at, generated_by, subject, title, recipients, cc, generated_content, edited_content, executive_summary, report_status, generated_by_ai, ai_model")
          .single();

        if (error) {
          throw new Error(error.message || "Unable to update AI report draft.");
        }

        savedRow = data as DbReportRow;
      } else {
        const { data, error } = await db
          .from("vessel_operation_reports")
          .insert(record)
          .select("id, created_at, generated_at, generated_by, subject, title, recipients, cc, generated_content, edited_content, executive_summary, report_status, generated_by_ai, ai_model")
          .single();

        if (error) {
          throw new Error(error.message || "Unable to save AI report draft.");
        }

        savedRow = data as DbReportRow;
      }

      const { history } = await loadDraftHistory(supabase, parsedParams.id);

      return Response.json({
        report: null,
        reportData: liveData,
        reportDraft: toDraft(savedRow),
        draftHistory: history,
        usedFallback: payload.draft.usedFallback,
        message: "Draft saved successfully.",
      });
    }

    let reportDraft = buildDeterministicVesselOperationAiReportDraft(liveData);
    let usedFallback = true;
    let message: string | null = "OPENAI_API_KEY is not configured. A deterministic template report was generated from live vessel data.";

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
        message = "AI generation failed, so a deterministic template was generated from the live vessel data.";
      }
    }

    const { history } = await loadDraftHistory(supabase, parsedParams.id);

    return Response.json({
      report: null,
      reportData: liveData,
      reportDraft,
      draftHistory: history,
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

    return Response.json({ error: error instanceof Error ? error.message : "Unable to generate AI report." }, { status: 500 });
  }
}