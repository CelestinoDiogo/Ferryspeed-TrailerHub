import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type {
  VesselOperationalReportData,
  VesselOperationAiReportDraft,
  VesselOperationAiReportHistoryItem,
} from "@/lib/reports/types";

type ReportRow = Database["public"]["Tables"]["vessel_operation_reports"]["Row"];
type ReportInsert = Database["public"]["Tables"]["vessel_operation_reports"]["Insert"];
type ReportUpdate = Database["public"]["Tables"]["vessel_operation_reports"]["Update"];
type ReportSelectRow = Pick<
  ReportRow,
  | "id"
  | "vessel_operation_id"
  | "report_status"
  | "created_at"
  | "generated_at"
  | "generated_by"
  | "subject"
  | "title"
  | "recipients"
  | "cc"
  | "generated_content"
  | "edited_content"
  | "executive_summary"
  | "generated_by_ai"
  | "ai_model"
  | "approved_at"
  | "approved_by"
  | "sent_at"
  | "sent_by"
>;

type DraftWriteInput = {
  reportId: string | null;
  subject: string;
  recipients: string[];
  cc: string[];
  generatedContent: string;
  editedContent: string;
  generationMode: "ai" | "template";
  usedFallback: boolean;
  aiModel: string | null;
  generatedAt: string;
};

const REPORT_SELECT =
  "id, vessel_operation_id, report_status, created_at, generated_at, generated_by, subject, title, recipients, cc, generated_content, edited_content, executive_summary, generated_by_ai, ai_model, approved_at, approved_by, sent_at, sent_by";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class VesselReportLifecycleError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "VesselReportLifecycleError";
    this.status = status;
  }
}

const normalizeStatus = (value?: string | null): "draft" | "final" | "sent" => {
  const status = (value ?? "").trim().toLowerCase();
  if (status === "sent") {
    return "sent";
  }
  if (status === "approved" || status === "final") {
    return "final";
  }
  return "draft";
};

const sanitizeEmails = (values: string[]) => {
  const unique = new Set<string>();
  for (const rawValue of values) {
    const value = rawValue.trim().toLowerCase();
    if (!value) {
      continue;
    }

    if (EMAIL_PATTERN.test(value)) {
      unique.add(value);
    }
  }
  return [...unique];
};

const toIso = (value?: string | null) => {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
};

const buildStructuredSnapshot = (reportData: VesselOperationalReportData): Json => {
  return {
    operation: reportData.operation,
    statistics: reportData.statistics,
    trailers: reportData.trailers.map((trailer) => ({
      trailerNumber: trailer.trailerNumber,
      arrivalStatus: trailer.arrivalStatus,
      inspectionStatus: trailer.inspectionStatus,
      compoundPosition: trailer.compoundPosition,
      hasDamage: trailer.hasDamage,
      hasTemperatureAlert: trailer.hasTemperatureAlert,
      frontTemperature: trailer.frontTemperature,
      rearTemperature: trailer.rearTemperature,
      temperatureUnit: trailer.temperatureUnit,
      photos: trailer.photos.map((photo) => ({
        id: photo.id,
        category: photo.category ?? null,
        fileName: photo.fileName ?? null,
        recordedAt: photo.recordedAt,
      })),
    })),
    damages: reportData.damages.map((damage) => ({
      trailerNumber: damage.trailerNumber,
      category: damage.category,
      damageLocation: damage.damageLocation,
      severity: damage.severity,
      recordedAt: damage.recordedAt,
      photoCount: damage.photos.length,
    })),
    temperatures: reportData.temperatures.map((temperature) => ({
      trailerNumber: temperature.trailerNumber,
      readingPoint: temperature.readingPoint,
      expectedTemperature: temperature.expectedTemperature,
      recordedTemperature: temperature.recordedTemperature,
      requiredMin: temperature.requiredMin,
      requiredMax: temperature.requiredMax,
      unit: temperature.unit,
      result: temperature.result,
      recordedAt: temperature.recordedAt,
    })),
    photos: reportData.photos.map((photo) => ({
      trailerNumber: photo.trailerNumber,
      category: photo.category ?? null,
      fileName: photo.fileName ?? null,
      recordedAt: photo.recordedAt,
    })),
    exceptions: reportData.exceptions,
    timeline: reportData.timeline,
  };
};

const mapRowToHistoryItem = (row: ReportSelectRow): VesselOperationAiReportHistoryItem => {
  const generatedAt = row.generated_at ?? row.created_at;

  return {
    reportId: row.id,
    generatedAt,
    generatedBy: row.generated_by ?? null,
    subject: row.subject ?? row.title ?? "Vessel Operations Report",
    recipients: Array.isArray(row.recipients) ? row.recipients : [],
    cc: Array.isArray(row.cc) ? row.cc : [],
    generationMode: row.generated_by_ai ? "ai" : "template",
    status: normalizeStatus(row.report_status),
  };
};

const mapRowToDraft = (row: ReportSelectRow): VesselOperationAiReportDraft => {
  const historyItem = mapRowToHistoryItem(row);
  const generatedContent = row.generated_content ?? row.executive_summary ?? "";
  const editedContent = row.edited_content ?? generatedContent;

  return {
    reportId: historyItem.reportId,
    subject: historyItem.subject,
    recipients: historyItem.recipients,
    cc: historyItem.cc,
    body: editedContent || generatedContent,
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
    generationMode: historyItem.generationMode,
    usedFallback: historyItem.generationMode === "template",
    aiModel: row.ai_model ?? null,
    generatedAt: historyItem.generatedAt,
    generatedBy: historyItem.generatedBy,
    status: historyItem.status,
    sentAt: row.sent_at ?? null,
    sentBy: row.sent_by ?? null,
  };
};

const buildBaseRecord = (
  operationId: string,
  generatedBy: string,
  input: DraftWriteInput,
  reportData: VesselOperationalReportData,
): ReportInsert => {
  const subject = input.subject.trim() || "Vessel Operations Report";
  const generatedContent = input.generatedContent || input.editedContent;
  const editedContent = input.editedContent || generatedContent;
  const snapshot = buildStructuredSnapshot(reportData);

  return {
    vessel_operation_id: operationId,
    report_type: "operational",
    title: subject,
    subject,
    recipients: sanitizeEmails(input.recipients),
    cc: sanitizeEmails(input.cc),
    generated_content: generatedContent,
    edited_content: editedContent,
    executive_summary: generatedContent,
    structured_snapshot: snapshot,
    structured_data_snapshot: snapshot,
    generated_by_ai: input.generationMode === "ai" && !input.usedFallback,
    ai_model: input.aiModel,
    generated_at: toIso(input.generatedAt),
    generated_by: generatedBy,
  };
};

const getReportById = async (supabase: SupabaseClient<Database>, operationId: string, reportId: string) => {
  const query = await supabase
    .from("vessel_operation_reports")
    .select(REPORT_SELECT)
    .eq("id", reportId)
    .eq("vessel_operation_id", operationId)
    .maybeSingle();

  if (query.error) {
    throw new VesselReportLifecycleError("Unable to load the selected report draft.", 500);
  }

  return query.data as ReportSelectRow | null;
};

export const isEmailProviderConfigured = () => {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN &&
      process.env.GMAIL_FROM_EMAIL &&
      process.env.GMAIL_FROM_NAME,
  );
};

export async function loadVesselReportDraftById(
  supabase: SupabaseClient<Database>,
  operationId: string,
  reportId: string,
) {
  const row = await getReportById(supabase, operationId, reportId);
  if (!row) {
    throw new VesselReportLifecycleError("The selected report was not found.", 404);
  }

  return mapRowToDraft(row);
}

export async function loadVesselReportHistory(supabase: SupabaseClient<Database>, operationId: string) {
  const { data, error } = await supabase
    .from("vessel_operation_reports")
    .select(REPORT_SELECT)
    .eq("vessel_operation_id", operationId)
    .order("generated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    throw new VesselReportLifecycleError("Unable to load report history right now.", 500);
  }

  const rows = (data ?? []) as ReportSelectRow[];
  const history = rows.map(mapRowToHistoryItem);

  const latestEditable = rows.find((row) => normalizeStatus(row.report_status) === "draft") ?? rows[0] ?? null;

  return {
    history,
    latestDraft: latestEditable ? mapRowToDraft(latestEditable) : null,
  };
}

export async function saveVesselReportDraft(
  supabase: SupabaseClient<Database>,
  operationId: string,
  generatedBy: string,
  input: DraftWriteInput,
  reportData: VesselOperationalReportData,
) {
  const baseRecord = buildBaseRecord(operationId, generatedBy, input, reportData);
  const now = new Date().toISOString();

  if (input.reportId) {
    const existing = await getReportById(supabase, operationId, input.reportId);
    if (existing && normalizeStatus(existing.report_status) === "draft") {
      const updateRecord: ReportUpdate = {
        ...baseRecord,
        report_status: "draft",
        approved_at: null,
        approved_by: null,
        sent_at: null,
        sent_by: null,
        updated_at: now,
      };

      const { data, error } = await supabase
        .from("vessel_operation_reports")
        .update(updateRecord)
        .eq("id", input.reportId)
        .eq("vessel_operation_id", operationId)
        .select(REPORT_SELECT)
        .single();

      if (error || !data) {
        throw new VesselReportLifecycleError("Unable to save report draft right now.", 500);
      }

      return mapRowToDraft(data);
    }
  }

  const insertRecord: ReportInsert = {
    ...baseRecord,
    report_status: "draft",
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("vessel_operation_reports")
    .insert(insertRecord)
    .select(REPORT_SELECT)
    .single();

  if (error || !data) {
    throw new VesselReportLifecycleError("Unable to save report draft right now.", 500);
  }

  return mapRowToDraft(data);
}

export async function finalizeVesselReport(
  supabase: SupabaseClient<Database>,
  operationId: string,
  generatedBy: string,
  input: DraftWriteInput,
  reportData: VesselOperationalReportData,
) {
  const baseRecord = buildBaseRecord(operationId, generatedBy, input, reportData);
  const now = new Date().toISOString();

  if (input.reportId) {
    const existing = await getReportById(supabase, operationId, input.reportId);
    if (existing && normalizeStatus(existing.report_status) === "sent") {
      throw new VesselReportLifecycleError("This report was already marked as sent and cannot be edited.", 409);
    }

    const updateRecord: ReportUpdate = {
      ...baseRecord,
      report_status: "final",
      approved_at: now,
      approved_by: generatedBy,
      updated_at: now,
    };

    const { data, error } = await supabase
      .from("vessel_operation_reports")
      .update(updateRecord)
      .eq("id", input.reportId)
      .eq("vessel_operation_id", operationId)
      .select(REPORT_SELECT)
      .single();

    if (error || !data) {
      throw new VesselReportLifecycleError("Unable to finalize the report right now.", 500);
    }

    return mapRowToDraft(data);
  }

  const insertRecord: ReportInsert = {
    ...baseRecord,
    report_status: "final",
    approved_at: now,
    approved_by: generatedBy,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("vessel_operation_reports")
    .insert(insertRecord)
    .select(REPORT_SELECT)
    .single();

  if (error || !data) {
    throw new VesselReportLifecycleError("Unable to finalize the report right now.", 500);
  }

  return mapRowToDraft(data);
}

export async function markVesselReportAsSent(
  supabase: SupabaseClient<Database>,
  operationId: string,
  reportId: string,
  sentBy: string,
  delivery?: {
    recipients?: string[];
    cc?: string[];
    subject?: string;
    body?: string;
  },
) {
  const existing = await getReportById(supabase, operationId, reportId);
  if (!existing) {
    throw new VesselReportLifecycleError("The selected report was not found.", 404);
  }

  const recipients = delivery?.recipients ? sanitizeEmails(delivery.recipients) : Array.isArray(existing.recipients) ? sanitizeEmails(existing.recipients) : [];
  const cc = delivery?.cc ? sanitizeEmails(delivery.cc) : Array.isArray(existing.cc) ? sanitizeEmails(existing.cc) : [];
  const subject = (delivery?.subject ?? existing.subject ?? existing.title ?? "Vessel Operations Report").trim() || "Vessel Operations Report";
  const body = (delivery?.body ?? existing.edited_content ?? existing.generated_content ?? existing.executive_summary ?? "").trim();

  if (recipients.length === 0) {
    throw new VesselReportLifecycleError("Add at least one valid recipient before sending this report.", 409);
  }

  if (!body) {
    throw new VesselReportLifecycleError("Report body cannot be empty before sending.", 409);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("vessel_operation_reports")
    .update({
      report_status: "sent",
      subject,
      title: subject,
      edited_content: body,
      recipients,
      cc,
      sent_at: now,
      sent_by: sentBy,
      updated_at: now,
    })
    .eq("id", reportId)
    .eq("vessel_operation_id", operationId)
    .select(REPORT_SELECT)
    .single();

  if (error || !data) {
    throw new VesselReportLifecycleError("Unable to mark this report as sent right now.", 500);
  }

  return mapRowToDraft(data);
}
