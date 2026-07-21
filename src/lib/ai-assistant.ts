import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTrailerOperationalProfile, type TrailerOperationalProfile } from "@/lib/operations/trailer-operational-engine";
import { buildActiveExportStatusByTrailerId, isTrailerEligibleForCompoundViews, isTrailerPresentInCompoundInventory, normalizeExportAllocationRecord, type ExportAllocationRecord } from "@/lib/export-allocation";
import { getTrailerCurrentLocationLabel } from "@/lib/trailer-location";
import type { Database } from "@/lib/database.types";
import { aiAssistantIntentSchema, allowedExportStatuses, type AiAssistantIntent, type AiAssistantIntentName, type AiAssistantLink, type AiAssistantRecord, type AiAssistantResponse } from "@/lib/ai-assistant-types";

type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];
type VesselOperationRow = Database["public"]["Tables"]["vessel_operations"]["Row"];
type VesselOperationTrailerRow = Database["public"]["Tables"]["vessel_operation_trailers"]["Row"];

const QUESTION_MAX_LENGTH = 500;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 50;
const OPENAI_TIMEOUT_MS = 8000;

const promptRequestSchema = z.object({
  question: z.string().trim().min(1).max(QUESTION_MAX_LENGTH),
});

const openAiIntentResponseSchema = aiAssistantIntentSchema.extend({
  reason: z.string().trim().optional(),
});

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const normalizeTrailerNumber = (value?: string | null) => (value ?? "").trim().toUpperCase();

const sanitizeLimit = (value?: number | null) => {
  if (!Number.isFinite(value ?? NaN)) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.trunc(value ?? DEFAULT_LIST_LIMIT)));
};

const todayKey = () => new Date().toISOString().split("T")[0];

const compactString = (value?: string | null) => value?.trim().replace(/\s+/g, " ") ?? "";

const containsWriteIntent = (question: string) => {
  const normalized = normalizeText(question);
  return /(create|delete|remove|mark|set|update|change|assign|complete|cancel|advance|undo|insert|drop|alter|truncate|sql|query|statement|table|ignore.*rule|bypass)/i.test(normalized);
};

const looksLikeSql = (question: string) => /\b(select|insert|update|delete|drop|alter|truncate)\b|;|--|\/\*/i.test(question);

const extractTrailerNumber = (question: string) => {
  const match = question.match(/\b([A-Z]{2,5}\d{3,6})\b/i);
  return match ? normalizeTrailerNumber(match[1]) : undefined;
};

const extractDate = (question: string) => {
  const normalized = normalizeText(question);

  if (normalized.includes("today")) {
    return todayKey();
  }

  const direct = question.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (direct?.[1]) {
    return direct[1];
  }

  return undefined;
};

const extractCustomer = (question: string) => {
  const match = question.match(/\bfor\s+([A-Za-z0-9&'"().,\-\s]{2,40})$/i) ?? question.match(/\bcustomer\s+([A-Za-z0-9&'"().,\-\s]{2,40})/i);
  return match ? compactString(match[1]) : undefined;
};

const extractStatus = (question: string) => {
  const normalized = normalizeText(question);
  for (const status of allowedExportStatuses) {
    if (normalized.includes(status.replace(/_/g, " ")) || normalized.includes(status)) {
      return status;
    }
  }
  return undefined;
};

const inferIntentFromRules = (question: string): AiAssistantIntent => {
  const normalized = normalizeText(question);
  const trailerNumber = extractTrailerNumber(question);
  const customer = extractCustomer(question);
  const date = extractDate(question);
  const status = extractStatus(question);

  if (!normalized) {
    return { intent: "unknown", limit: DEFAULT_LIST_LIMIT };
  }

  if (trailerNumber && /(where is|latest inspection|history|damage|temperature alert)/i.test(question)) {
    if (/latest inspection/i.test(question)) {
      return { intent: "latest_inspection", trailerNumber, limit: 1 };
    }

    if (/history/i.test(question)) {
      return { intent: "trailer_history", trailerNumber, limit: MAX_LIST_LIMIT };
    }

    return { intent: "find_trailer", trailerNumber, limit: 1 };
  }

  if (/waiting for compound|waiting for a compound position/i.test(normalized)) {
    return { intent: "list_waiting_compound", limit: DEFAULT_LIST_LIMIT };
  }

  if (/empty trailers|how many empty|available empty/i.test(normalized)) {
    return normalized.includes("how many") || normalized.includes("count") ? { intent: "count_empty", limit: 1 } : { intent: "list_empty", limit: DEFAULT_LIST_LIMIT };
  }

  if (/loaded trailers|show me all loaded/i.test(normalized)) {
    return normalized.includes("how many") || normalized.includes("count") ? { intent: "count_loaded", limit: 1 } : { intent: "list_loaded", limit: DEFAULT_LIST_LIMIT, customer };
  }

  if (/compound/i.test(normalized) && /how many|count/i.test(normalized)) {
    return { intent: "count_compound", limit: 1 };
  }

  if (/compound/i.test(normalized)) {
    return { intent: "list_compound", limit: DEFAULT_LIST_LIMIT };
  }

  if (/arrived today|what arrived today|which trailers arrived today/i.test(normalized)) {
    return { intent: "arrivals_today", date: date ?? todayKey(), limit: DEFAULT_LIST_LIMIT };
  }

  if (/departed today|what departed today|which trailers departed today/i.test(normalized)) {
    return { intent: "departures_today", date: date ?? todayKey(), limit: DEFAULT_LIST_LIMIT };
  }

  if (/vessel operations.*today|what vessel operations are scheduled for today/i.test(normalized)) {
    return { intent: "vessel_operations_today", date: date ?? todayKey(), limit: DEFAULT_LIST_LIMIT };
  }

  if (/export trailers.*collection|waiting for collection/i.test(normalized)) {
    return { intent: "export_by_status", status: status ?? "delivered_empty", limit: DEFAULT_LIST_LIMIT };
  }

  if (/damage/i.test(normalized)) {
    return { intent: "trailers_with_damage", limit: DEFAULT_LIST_LIMIT };
  }

  if (/temperature alert/i.test(normalized)) {
    return { intent: "trailers_with_temperature_alert", limit: DEFAULT_LIST_LIMIT };
  }

  if (customer) {
    return { intent: "trailers_by_customer", customer, limit: DEFAULT_LIST_LIMIT };
  }

  return { intent: "unknown", limit: DEFAULT_LIST_LIMIT };
};

const getOpenAiModel = () => process.env.OPENAI_MODEL || "gpt-4o-mini";

const buildOpenAiPrompt = (question: string) => [
  "You are a strict intent interpreter for a read-only trailer operations assistant.",
  "Choose exactly one intent from this list: find_trailer, count_compound, list_compound, count_empty, list_empty, count_loaded, list_loaded, list_waiting_compound, arrivals_today, departures_today, vessel_operations_today, export_by_status, trailers_by_customer, trailers_with_damage, trailers_with_temperature_alert, latest_inspection, trailer_history, unknown.",
  "Return JSON only with keys: intent, trailerNumber, customer, status, date, limit.",
  "Rules: trailerNumber must be uppercase if present; customer is free text search text; status must be one of allocated, delivered_empty, waiting_loading, collected_loaded, completed, cancelled; date must be YYYY-MM-DD; limit must not exceed 50; if the user asks for changes, return unknown.",
  `Question: ${question}`,
].join(" ");

const callOpenAiInterpreter = async (question: string) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { intent: inferIntentFromRules(question), provider: "rules" as const };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getOpenAiModel(),
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildOpenAiPrompt(question) },
          { role: "user", content: question },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}`);
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error("Empty OpenAI response.");
    }

    const parsed = openAiIntentResponseSchema.parse(JSON.parse(raw));
    const normalizedIntent = {
      intent: parsed.intent,
      trailerNumber: parsed.trailerNumber ? normalizeTrailerNumber(parsed.trailerNumber) : undefined,
      customer: parsed.customer ? compactString(parsed.customer) : undefined,
      status: parsed.status,
      date: parsed.date,
      limit: sanitizeLimit(parsed.limit),
    } satisfies AiAssistantIntent;

    return { intent: normalizedIntent, provider: "openai" as const };
  } catch (error) {
    console.error("AI Assistant interpreter fallback:", error);
    return { intent: inferIntentFromRules(question), provider: "rules" as const };
  } finally {
    clearTimeout(timeoutId);
  }
};

const toResultLink = (href?: string | null, label = "Open Trailer 360"): AiAssistantLink[] => (href ? [{ label, href }] : []);

const toTrailerSummary = (profile: TrailerOperationalProfile) => ({
  trailerId: profile.trailer?.id ?? null,
  trailerNumber: profile.trailer?.trailer_number ?? profile.identifier,
  loadStatus: profile.trailer?.load_status ?? null,
  operationalStatus: profile.position.stageLabel,
  currentLocation: getTrailerCurrentLocationLabel({
    departureDate: profile.trailer?.departure_date,
    isLocal: profile.trailer?.is_local,
    compoundPosition: profile.position.compoundPosition,
    waitingForCompound: profile.position.operationalStage === "hold",
    exportLocation: profile.position.currentLocation?.includes("Export") ? profile.position.currentLocation : null,
    fallbackLocation: profile.position.currentLocation,
  }),
  compoundPosition: profile.position.compoundPosition,
  customer: profile.position.customer ?? profile.trailer?.customer ?? null,
  container: profile.trailer?.container_number ?? null,
  arrival: profile.trailer?.arrival_date ?? null,
  departure: profile.trailer?.departure_date ?? null,
  currentExportOperation: profile.position.currentOperationReference ?? null,
  latestVesselOperation: profile.vesselOperations[0]
    ? {
        id: profile.vesselOperations[0].id,
        vesselName: profile.vesselOperations[0].vessel_name ?? null,
        sailingReference: profile.vesselOperations[0].sailing_reference ?? null,
      }
    : null,
  link: profile.trailer?.id ? `/dashboard/trailers/${profile.trailer.id}` : null,
});

const toCompactTrailerRow = (trailer: TrailerRow, activeExportStatus?: string | null) => {
  const currentLocation = getTrailerCurrentLocationLabel({
    departureDate: trailer.departure_date,
    isLocal: trailer.is_local,
    compoundPosition: trailer.compound_position,
    waitingForCompound: activeExportStatus === "waiting_loading",
    exportLocation: activeExportStatus ? "Export Operations" : null,
    fallbackLocation: null,
  });

  return {
    id: trailer.id,
    trailer_number: trailer.trailer_number ?? null,
    load_status: trailer.load_status ?? null,
    operational_status: trailer.operational_status ?? null,
    current_location: currentLocation,
    compound_position: trailer.compound_position ?? null,
    customer: trailer.customer ?? null,
    container_number: trailer.container_number ?? null,
    arrival_date: trailer.arrival_date ?? null,
    departure_date: trailer.departure_date ?? null,
    trailer_source: trailer.trailer_source ?? null,
    link: `/dashboard/trailers/${trailer.id}`,
  };
};

const fetchActiveExportStatusByTrailerId = async (supabase: SupabaseClient<Database>) => {
  const { data, error } = await supabase
    .from("export_allocations")
    .select("id, trailer_id, status, customer, collection_date, haulier, booking_reference, updated_at")
    .in("status", [...allowedExportStatuses])
    .order("updated_at", { ascending: false });

  if (error) {
    throw error;
  }

  const allocations = ((data ?? []) as ExportAllocationRecord[]).map((row) => normalizeExportAllocationRecord(row));
  return buildActiveExportStatusByTrailerId(allocations.filter((row) => row.status !== "completed" && row.status !== "cancelled"));
};

async function queryFindTrailer(supabase: SupabaseClient<Database>, trailerNumber: string) {
  const profile = await loadTrailerOperationalProfile(supabase, trailerNumber);
  const summary = toTrailerSummary(profile);

  return {
    answer: summary.trailerId
      ? `${summary.trailerNumber} is currently ${summary.currentLocation}${summary.compoundPosition ? ` in position ${summary.compoundPosition}` : ""}.`
      : `${summary.trailerNumber} has no active operational trailer record.`,
    resultType: "find_trailer" as const,
    data: [summary as AiAssistantRecord],
    summary: {
      trailerNumber: summary.trailerNumber,
      currentLocation: summary.currentLocation,
      operationalStatus: summary.operationalStatus,
    },
    links: toResultLink(summary.link),
    truncated: false,
  };
}

async function queryTrailerHistory(supabase: SupabaseClient<Database>, trailerNumber: string, limit: number) {
  const profile = await loadTrailerOperationalProfile(supabase, trailerNumber);
  const rows = profile.events.slice(0, limit).map((event) => ({
    id: event.id,
    title: event.title,
    eventType: event.eventType,
    sourceModule: event.sourceModule,
    occurredAt: event.occurredAt,
    description: event.description ?? null,
    trailerNumber: event.trailerNumber,
  }));

  return {
    answer: rows.length > 0 ? `Showing the latest ${rows.length} event${rows.length === 1 ? "" : "s"} for ${profile.identifier}.` : `No operational history is available for ${profile.identifier}.`,
    resultType: "trailer_history" as const,
    data: rows as AiAssistantRecord[],
    summary: { count: rows.length, trailerNumber: profile.identifier },
    links: toResultLink(profile.trailer?.id ? `/dashboard/trailers/${profile.trailer.id}` : null),
    truncated: profile.events.length > limit,
  };
}

async function queryLatestInspection(supabase: SupabaseClient<Database>, trailerNumber: string) {
  const profile = await loadTrailerOperationalProfile(supabase, trailerNumber);
  const latestTrailer = profile.vesselOperationTrailers[0] ?? null;
  const damages = profile.inspectionDamages;
  const temperatures = profile.inspectionTemperatures;
  const vesselTrailerIds = profile.vesselOperationTrailers.map((row) => row.id);
  const { data: photoData, error: photoError } = vesselTrailerIds.length > 0
    ? await supabase
        .from("vessel_inspection_photos")
        .select("id, vessel_trailer_id")
        .in("vessel_trailer_id", vesselTrailerIds)
    : { data: [], error: null };

  if (photoError) {
    throw photoError;
  }

  const photos = (photoData ?? []) as Array<{ id: string }>;

  const data = {
    trailerId: profile.trailer?.id ?? null,
    trailerNumber: profile.identifier,
    inspectionStatus: latestTrailer?.inspection_completed_at ? "completed" : latestTrailer?.inspection_started_at ? "in_progress" : "pending",
    inspectionStartedAt: latestTrailer?.inspection_started_at ?? null,
    inspectionCompletedAt: latestTrailer?.inspection_completed_at ?? null,
    damageCount: damages.length,
    temperatureCount: temperatures.length,
    photoCount: photos.length,
    hasDamage: damages.length > 0,
    hasTemperatureAlert: temperatures.some((row) => row.is_out_of_range === true),
    latestVesselOperation: latestTrailer
      ? {
          id: latestTrailer.vessel_operation_id,
          trailerTrailerId: latestTrailer.trailer_id ?? null,
          arrivalStatus: latestTrailer.arrival_status ?? null,
          assignedPosition: latestTrailer.assigned_position ?? null,
        }
      : null,
  };

  return {
    answer: latestTrailer ? `Latest inspection for ${profile.identifier} is ${data.inspectionStatus}.` : `No inspection records were found for ${profile.identifier}.`,
    resultType: "latest_inspection" as const,
    data: [data as AiAssistantRecord],
    summary: {
      trailerNumber: profile.identifier,
      inspectionStatus: data.inspectionStatus,
      damageCount: data.damageCount,
      temperatureCount: data.temperatureCount,
      photoCount: data.photoCount,
    },
    links: toResultLink(profile.trailer?.id ? `/dashboard/trailers/${profile.trailer.id}` : null),
    truncated: false,
  };
}

async function queryCompound(supabase: SupabaseClient<Database>, limit: number, onlyEmpty?: boolean, onlyLoaded?: boolean) {
  const activeExportStatusByTrailerId = await fetchActiveExportStatusByTrailerId(supabase);
  const { data, error } = await supabase
    .from("trailers")
    .select("id, trailer_number, load_status, customer, consignee, container_number, compound_position, arrival_date, departure_date, trailer_source, external_company, external_reference, is_local, operational_status")
    .is("departure_date", null)
    .limit(200)
    .order("arrival_date", { ascending: false });

  if (error) {
    throw error;
  }

  const trailers = (data ?? []) as TrailerRow[];
  const compoundTrailers = trailers.filter((trailer) => trailer.is_local !== true && isTrailerEligibleForCompoundViews(trailer, activeExportStatusByTrailerId.get(trailer.id)));
  const compoundInventoryTrailers = compoundTrailers.filter((trailer) => isTrailerPresentInCompoundInventory(trailer, activeExportStatusByTrailerId.get(trailer.id)));
  const rows = (onlyEmpty
    ? compoundInventoryTrailers.filter((trailer) => (trailer.load_status ?? "").trim().toLowerCase() === "empty" && !activeExportStatusByTrailerId.has(trailer.id))
    : onlyLoaded
      ? compoundInventoryTrailers.filter((trailer) => (trailer.load_status ?? "").trim().toLowerCase() === "loaded")
      : compoundInventoryTrailers
  ).slice(0, limit).map((trailer) => toCompactTrailerRow(trailer, activeExportStatusByTrailerId.get(trailer.id) ?? null));

  return {
    answer: onlyEmpty
      ? `${compoundInventoryTrailers.filter((trailer) => (trailer.load_status ?? "").trim().toLowerCase() === "empty" && !activeExportStatusByTrailerId.has(trailer.id)).length} empty trailer${compoundInventoryTrailers.filter((trailer) => (trailer.load_status ?? "").trim().toLowerCase() === "empty" && !activeExportStatusByTrailerId.has(trailer.id)).length === 1 ? "" : "s"} are currently in compound.`
      : onlyLoaded
        ? `${compoundInventoryTrailers.filter((trailer) => (trailer.load_status ?? "").trim().toLowerCase() === "loaded").length} loaded trailer${compoundInventoryTrailers.filter((trailer) => (trailer.load_status ?? "").trim().toLowerCase() === "loaded").length === 1 ? "" : "s"} are currently in compound.`
        : `${compoundInventoryTrailers.length} trailer${compoundInventoryTrailers.length === 1 ? "" : "s"} are currently in compound.`,
    resultType: onlyEmpty ? "count_empty" : onlyLoaded ? "count_loaded" : "count_compound",
    data: rows as AiAssistantRecord[],
    summary: { count: rows.length, total: compoundInventoryTrailers.length },
    links: rows.length > 0 ? rows.slice(0, 1).flatMap((row) => toResultLink(row.link)) : [],
    truncated: compoundInventoryTrailers.length > limit,
  };
}

async function queryWaitingCompound(supabase: SupabaseClient<Database>, limit: number) {
  const [{ data: waitingData, error: waitingError }, { data: occupancyData, error: occupancyError }, { data: noPositionTrailersData, error: noPositionTrailersError }, { data: exportStatusData, error: exportStatusError }] = await Promise.all([
    supabase
      .from("compound_waiting_active")
      .select("id, trailer_id, trailer_number, customer, load_status, priority_level, priority_reason, waiting_reason, arrived_at, waiting_since, waiting_minutes, vessel_operation_id, vessel_trailer_id, notes, created_at")
      .order("waiting_since", { ascending: true }),
    supabase.rpc("get_compound_occupancy"),
    supabase
      .from("trailers")
      .select("id, trailer_number, customer, load_status, arrival_date, departure_date, is_local, compound_position")
      .is("compound_position", null)
      .is("departure_date", null)
      .or("is_local.is.false,is_local.is.null"),
    supabase
      .from("export_allocations")
      .select("trailer_id, status, updated_at")
      .in("status", [...allowedExportStatuses]),
  ]);

  if (waitingError) throw waitingError;
  if (occupancyError) throw occupancyError;
  if (noPositionTrailersError) throw noPositionTrailersError;
  if (exportStatusError) throw exportStatusError;

  const waitingRows = ((waitingData ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    trailer_id: row.trailer_id as string,
    trailer_number: (row.trailer_number as string | null) ?? null,
    customer: (row.customer as string | null) ?? null,
    load_status: (row.load_status as string | null) ?? null,
    priority_level: (row.priority_level as string) ?? "normal",
    priority_reason: (row.priority_reason as string | null) ?? null,
    waiting_reason: (row.waiting_reason as string | null) ?? null,
    arrived_at: (row.arrived_at as string | null) ?? null,
    waiting_since: (row.waiting_since as string | null) ?? null,
    waiting_minutes: (row.waiting_minutes as number | null) ?? null,
    vessel_operation_id: (row.vessel_operation_id as string | null) ?? null,
    vessel_trailer_id: (row.vessel_trailer_id as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    source: "formal" as const,
    visual_id: row.id as string,
  }));

  const exportStatusByTrailerId = new Map<string, string>();
  ((exportStatusData ?? []) as Array<{ trailer_id?: string | null; status?: string | null }>).forEach((row) => {
    if (row.trailer_id && row.status) {
      exportStatusByTrailerId.set(row.trailer_id, row.status.trim().toLowerCase());
    }
  });

  const implicitRows = ((noPositionTrailersData ?? []) as TrailerRow[])
    .filter((trailer) => trailer.is_local !== true)
    .filter((trailer) => !trailer.departure_date)
    .filter((trailer) => {
      const status = exportStatusByTrailerId.get(trailer.id);
      return !status || !["delivered_empty", "waiting_loading", "collected_loaded", "ready_for_shipping", "loaded_on_vessel", "completed"].includes(status);
    })
    .filter((trailer) => !waitingRows.some((row) => row.trailer_id === trailer.id))
    .map((trailer) => ({
      id: `implicit:${trailer.id}`,
      trailer_id: trailer.id,
      trailer_number: trailer.trailer_number ?? null,
      customer: trailer.customer ?? null,
      load_status: trailer.load_status ?? null,
      priority_level: "normal",
      priority_reason: "Automatically surfaced from operational no-position list.",
      waiting_reason: "awaiting_compound_position",
      arrived_at: trailer.arrival_date ?? null,
      waiting_since: trailer.arrival_date ?? null,
      waiting_minutes: null,
      vessel_operation_id: null,
      vessel_trailer_id: null,
      notes: null,
      created_at: trailer.arrival_date ?? null,
      source: "implicit" as const,
      visual_id: `implicit:${trailer.id}`,
    }));

  const combinedRows = [...waitingRows, ...implicitRows].slice(0, limit).map((row) => ({
    ...row,
    link: `/dashboard/trailers/${row.trailer_id}`,
  }));

  return {
    answer: combinedRows.length > 0
      ? `${combinedRows.length} trailer${combinedRows.length === 1 ? "" : "s"} are waiting for a compound position.`
      : "There are no trailers waiting for a compound position.",
    resultType: "list_waiting_compound" as const,
    data: combinedRows as AiAssistantRecord[],
    summary: { count: combinedRows.length, occupancy: occupancyData ?? null },
    links: combinedRows.slice(0, 1).map((row) => ({ label: "Open Trailer 360", href: `/dashboard/trailers/${(row as { trailer_id?: string }).trailer_id}` })),
    truncated: combinedRows.length > limit,
  };
}

async function queryArrivalsOrDepartures(supabase: SupabaseClient<Database>, date: string, kind: "arrivals_today" | "departures_today", limit: number) {
  const column = kind === "arrivals_today" ? "arrival_date" : "departure_date";
  const { data, error } = await supabase
    .from("trailers")
    .select("id, trailer_number, load_status, customer, container_number, compound_position, arrival_date, departure_date, trailer_source, operational_status, is_local")
    .eq(column, date)
    .order(column, { ascending: false })
    .limit(limit + 1);

  if (error) throw error;

  const rows = ((data ?? []) as TrailerRow[]).slice(0, limit).map((trailer) => ({
    ...toCompactTrailerRow(trailer, null),
    link: `/dashboard/trailers/${trailer.id}`,
  }));

  return {
    answer: rows.length > 0
      ? `${rows.length} trailer${rows.length === 1 ? "" : "s"} ${kind === "arrivals_today" ? "arrived" : "departed"} on ${date}.`
      : `No trailers ${kind === "arrivals_today" ? "arrived" : "departed"} on ${date}.`,
    resultType: kind,
    data: rows as AiAssistantRecord[],
    summary: { date, count: rows.length },
    links: rows.length > 0 ? [{ label: "Open Trailer 360", href: rows[0].link }] : [],
    truncated: ((data ?? []) as TrailerRow[]).length > limit,
  };
}

async function queryVesselOperationsToday(supabase: SupabaseClient<Database>, date: string, limit: number) {
  const { data, error } = await supabase
    .from("vessel_operations")
    .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, created_at, updated_at")
    .order("expected_arrival_at", { ascending: true, nullsFirst: false })
    .limit(100);

  if (error) throw error;

  const rows = ((data ?? []) as VesselOperationRow[])
    .filter((operation) => {
      const actual = operation.actual_arrival_at ? operation.actual_arrival_at.split("T")[0] : null;
      const expected = operation.expected_arrival_at ? operation.expected_arrival_at.split("T")[0] : null;
      return actual === date || expected === date;
    })
    .slice(0, limit)
    .map((operation) => ({
      id: operation.id,
      vessel_name: operation.vessel_name ?? null,
      sailing_reference: operation.sailing_reference ?? null,
      expected_arrival_at: operation.expected_arrival_at ?? null,
      actual_arrival_at: operation.actual_arrival_at ?? null,
      status: operation.status,
      link: `/dashboard/vessel-operations/${operation.id}`,
    }));

  return {
    answer: rows.length > 0
      ? `${rows.length} vessel operation${rows.length === 1 ? "" : "s"} are scheduled for today.`
      : "No vessel operations are scheduled for today.",
    resultType: "vessel_operations_today" as const,
    data: rows as AiAssistantRecord[],
    summary: { date, count: rows.length },
    links: rows.length > 0 ? [{ label: "Open Vessel Operation", href: rows[0].link }] : [],
    truncated: ((data ?? []) as VesselOperationRow[]).length > limit,
  };
}

async function queryExportByStatus(supabase: SupabaseClient<Database>, status: AiAssistantIntent["status"], limit: number) {
  const targetStatus = status ?? "delivered_empty";
  const { data, error } = await supabase
    .from("export_allocations")
    .select("id, trailer_id, trailer_number, customer, collection_address, haulier, booking_reference, load_type, collection_date, expected_return_at, priority, status, notes, allocated_at, delivered_empty_at, waiting_loading_at, collected_loaded_at, completed_at, cancelled_at, created_at, updated_at")
    .eq("status", targetStatus)
    .order("updated_at", { ascending: false })
    .limit(limit + 1);

  if (error) throw error;

  const rows = ((data ?? []) as ExportAllocationRecord[]).slice(0, limit).map((allocation) => ({
    ...allocation,
    link: `/dashboard/export-operations/${allocation.id}`,
  }));

  return {
    answer: rows.length > 0 ? `${rows.length} export allocation${rows.length === 1 ? "" : "s"} are currently ${targetStatus.replace(/_/g, " ")}.` : `No export allocations are currently ${targetStatus.replace(/_/g, " ")}.`,
    resultType: "export_by_status" as const,
    data: rows as AiAssistantRecord[],
    summary: { status: targetStatus, count: rows.length },
    links: rows.length > 0 ? [{ label: "Open Export Allocation", href: rows[0].link }] : [],
    truncated: ((data ?? []) as ExportAllocationRecord[]).length > limit,
  };
}

async function queryTrailersByCustomer(supabase: SupabaseClient<Database>, customer: string, limit: number) {
  const { data, error } = await supabase
    .from("trailers")
    .select("id, trailer_number, load_status, customer, consignee, container_number, compound_position, arrival_date, departure_date, trailer_source, operational_status, is_local")
    .ilike("customer", `%${customer}%`)
    .order("trailer_number", { ascending: true })
    .limit(limit + 1);

  if (error) throw error;

  const rows = ((data ?? []) as TrailerRow[]).slice(0, limit).map((trailer) => ({
    ...toCompactTrailerRow(trailer, null),
    link: `/dashboard/trailers/${trailer.id}`,
  }));

  return {
    answer: rows.length > 0 ? `${rows.length} trailer${rows.length === 1 ? "" : "s"} match ${customer}.` : `No trailers matched ${customer}.`,
    resultType: "trailers_by_customer" as const,
    data: rows as AiAssistantRecord[],
    summary: { customer, count: rows.length },
    links: rows.length > 0 ? [{ label: "Open Trailer 360", href: rows[0].link }] : [],
    truncated: ((data ?? []) as TrailerRow[]).length > limit,
  };
}

async function queryDamageOrTemperatureAlerts(supabase: SupabaseClient<Database>, limit: number, kind: "trailers_with_damage" | "trailers_with_temperature_alert") {
  const column = kind === "trailers_with_damage" ? "has_damage" : "has_temperature_alert";
  const { data, error } = await supabase
    .from("vessel_operation_trailers")
    .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, planned_destination, status, arrived_at, arrival_status, arrival_confirmed_at, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
    .eq(column, true)
    .order("updated_at", { ascending: false })
    .limit(limit + 1);

  if (error) throw error;

  const rows = ((data ?? []) as VesselOperationTrailerRow[]).slice(0, limit).map((trailer) => ({
    id: trailer.id,
    trailer_id: trailer.trailer_id ?? null,
    trailer_number: trailer.trailer_number ?? null,
    customer: trailer.customer ?? null,
    booking_reference: trailer.booking_reference ?? null,
    load_status: trailer.load_status ?? null,
    status: trailer.status,
    arrival_status: trailer.arrival_status ?? null,
    has_damage: trailer.has_damage ?? null,
    has_temperature_alert: trailer.has_temperature_alert ?? null,
    inspection_started_at: trailer.inspection_started_at ?? null,
    inspection_completed_at: trailer.inspection_completed_at ?? null,
    assigned_position: trailer.assigned_position ?? null,
    link: trailer.trailer_id ? `/dashboard/trailers/${trailer.trailer_id}` : null,
  }));

  return {
    answer: rows.length > 0 ? `Found ${rows.length} trailer${rows.length === 1 ? "" : "s"} with ${kind === "trailers_with_damage" ? "damage" : "temperature alerts"}.` : `No trailers with ${kind === "trailers_with_damage" ? "damage" : "temperature alerts"} were found.`,
    resultType: kind,
    data: rows as AiAssistantRecord[],
    summary: { count: rows.length },
    links: rows.filter((row) => row.link).slice(0, 1).map((row) => ({ label: "Open Trailer 360", href: row.link as string })),
    truncated: ((data ?? []) as VesselOperationTrailerRow[]).length > limit,
  };
}

async function queryUnknown() {
  return {
    answer: "I could not map that request to a read-only trailer operations query.",
    resultType: "unknown" as const,
    data: [],
    summary: null,
    links: [],
    truncated: false,
  };
}

export async function runAiAssistantQuery(supabase: SupabaseClient<Database>, question: string) {
  const parsed = promptRequestSchema.parse({ question });
  const normalizedQuestion = parsed.question.trim();

  if (!normalizedQuestion) {
    throw new Error("Question is required.");
  }

  if (normalizedQuestion.length > QUESTION_MAX_LENGTH) {
    throw new Error(`Question must be ${QUESTION_MAX_LENGTH} characters or fewer.`);
  }

  if (containsWriteIntent(normalizedQuestion) || looksLikeSql(normalizedQuestion)) {
    return {
      answer: "The AI Assistant is currently read-only. Please use the relevant operational module to make changes.",
      resultType: "unknown" as const,
      intent: "unknown" as const,
      data: [],
      summary: { blocked: true },
      links: [],
      timestamp: new Date().toISOString(),
      truncated: false,
      provider: "rules" as const,
      usedFallback: true,
      notice: "Write actions are not permitted.",
    } satisfies AiAssistantResponse;
  }

  const interpretation = await callOpenAiInterpreter(normalizedQuestion);
  const intent = interpretation.intent;
  const limit = sanitizeLimit(intent.limit);
  const timestamp = new Date().toISOString();

  let response;
  switch (intent.intent) {
    case "find_trailer":
      response = intent.trailerNumber ? await queryFindTrailer(supabase, intent.trailerNumber) : await queryUnknown();
      break;
    case "count_compound":
      response = await queryCompound(supabase, 1, false, false);
      break;
    case "list_compound":
      response = await queryCompound(supabase, limit, false, false);
      break;
    case "count_empty":
      response = await queryCompound(supabase, 1, true, false);
      break;
    case "list_empty":
      response = await queryCompound(supabase, limit, true, false);
      break;
    case "count_loaded":
      response = await queryCompound(supabase, 1, false, true);
      break;
    case "list_loaded":
      response = await queryCompound(supabase, limit, false, true);
      break;
    case "list_waiting_compound":
      response = await queryWaitingCompound(supabase, limit);
      break;
    case "arrivals_today":
      response = await queryArrivalsOrDepartures(supabase, intent.date ?? todayKey(), "arrivals_today", limit);
      break;
    case "departures_today":
      response = await queryArrivalsOrDepartures(supabase, intent.date ?? todayKey(), "departures_today", limit);
      break;
    case "vessel_operations_today":
      response = await queryVesselOperationsToday(supabase, intent.date ?? todayKey(), limit);
      break;
    case "export_by_status":
      response = await queryExportByStatus(supabase, intent.status ?? "delivered_empty", limit);
      break;
    case "trailers_by_customer":
      response = intent.customer ? await queryTrailersByCustomer(supabase, intent.customer, limit) : await queryUnknown();
      break;
    case "trailers_with_damage":
      response = await queryDamageOrTemperatureAlerts(supabase, limit, "trailers_with_damage");
      break;
    case "trailers_with_temperature_alert":
      response = await queryDamageOrTemperatureAlerts(supabase, limit, "trailers_with_temperature_alert");
      break;
    case "latest_inspection":
      response = intent.trailerNumber ? await queryLatestInspection(supabase, intent.trailerNumber) : await queryUnknown();
      break;
    case "trailer_history":
      response = intent.trailerNumber ? await queryTrailerHistory(supabase, intent.trailerNumber, limit) : await queryUnknown();
      break;
    default:
      response = await queryUnknown();
      break;
  }

  const result: AiAssistantResponse = {
    answer: response.answer,
    resultType: response.resultType as AiAssistantIntentName,
    intent: intent.intent,
    data: response.data,
    summary: response.summary,
    links: response.links,
    timestamp,
    truncated: response.truncated,
    provider: interpretation.provider,
    usedFallback: interpretation.provider === "rules",
    notice: interpretation.provider === "rules" && intent.intent === "unknown" ? "Fallback rules could not interpret the question." : null,
  };

  return result;
}

export function getFallbackAiAssistantIntent(question: string): AiAssistantIntent {
  return inferIntentFromRules(question);
}
