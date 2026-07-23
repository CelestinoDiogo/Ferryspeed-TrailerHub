import { getTrailerCurrentLocationLabel } from "@/lib/trailer-location";
import { buildActiveExportStatusByTrailerId, isTrailerEligibleForCompoundViews, isTrailerPresentInCompoundInventory, normalizeExportAllocationRecord, type ExportAllocationRecord } from "@/lib/export-allocation";
import type { Database } from "@/lib/database.types";
import type { AssistantContext, AssistantIntent, AssistantQueryResult } from "@/lib/ai-assistant-foundation/types";

type TrailerRow = Database["public"]["Tables"]["trailers"]["Row"];

type DeliveryBookingRow = Database["public"]["Tables"]["delivery_bookings"]["Row"];

type StockCheckRow = Pick<Database["public"]["Tables"]["compound_stock_checks"]["Row"], "id" | "started_at" | "status">;

type StockCheckItemRow = Pick<Database["public"]["Tables"]["compound_stock_check_items"]["Row"], "id" | "trailer_id" | "trailer_number" | "discrepancy_type" | "resolution_status">;

const normalizeText = (value?: string | null) => value?.trim().toLowerCase() ?? "";

const todayDateKey = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

const findLatestStockCheck = async ({ supabase }: AssistantContext) => {
  const { data, error } = await supabase
    .from("compound_stock_checks")
    .select("id, started_at, status")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data ?? null) as StockCheckRow | null;
};

const listActiveTrailers = async ({ supabase }: AssistantContext) => {
  const { data, error } = await supabase
    .from("trailers")
    .select("id, trailer_number, load_status, customer, compound_position, is_local, arrival_date, departure_date, trailer_source, operational_status")
    .is("departure_date", null)
    .order("arrival_date", { ascending: false })
    .limit(400);

  if (error) {
    throw error;
  }

  return (data ?? []) as TrailerRow[];
};

const listActiveExportAllocations = async ({ supabase }: AssistantContext) => {
  const { data, error } = await supabase
    .from("export_allocations")
    .select("id, trailer_id, trailer_number, customer, booking_reference, status, updated_at")
    .in("status", ["allocated", "delivered_empty", "waiting_loading", "collected_loaded"])
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) {
    throw error;
  }

  return ((data ?? []) as ExportAllocationRecord[]).map((row) => normalizeExportAllocationRecord(row));
};

const queryWhereIsTrailer = async (context: AssistantContext, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  if (!intent.trailerNumber) {
    return {
      intent: "unknown",
      title: "AI Assistant",
      answer: "Please provide a trailer number, for example: Where is trailer PFF1216?",
      resultType: "text",
      data: [],
      links: [],
    };
  }

  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, load_status, customer, compound_position, is_local, arrival_date, departure_date, operational_status")
    .ilike("trailer_number", intent.trailerNumber)
    .order("arrival_date", { ascending: false })
    .limit(1);

  if (error) {
    throw error;
  }

  const trailer = (data ?? [])[0] as TrailerRow | undefined;

  if (!trailer) {
    return {
      intent: "where_is_trailer",
      title: `Trailer ${intent.trailerNumber}`,
      answer: `No trailer record found for ${intent.trailerNumber}.`,
      resultType: "text",
      data: [],
      links: [],
    };
  }

  const location = getTrailerCurrentLocationLabel({
    departureDate: trailer.departure_date,
    isLocal: trailer.is_local,
    compoundPosition: trailer.compound_position,
    waitingForCompound: false,
    exportLocation: null,
    fallbackLocation: null,
  });

  return {
    intent: "where_is_trailer",
    title: `Trailer ${trailer.trailer_number ?? intent.trailerNumber}`,
    answer: `${trailer.trailer_number ?? intent.trailerNumber} is currently at ${location}.`,
    resultType: "trailer",
    data: [
      {
        trailerNumber: trailer.trailer_number,
        currentLocation: location,
        loadStatus: trailer.load_status,
        customer: trailer.customer,
        operationalStatus: trailer.operational_status,
        arrivalDate: trailer.arrival_date,
        link: `/dashboard/trailers/${trailer.id}`,
      },
    ],
    summary: [
      { label: "Load Status", value: trailer.load_status ?? "Unknown" },
      { label: "Location", value: location },
    ],
    links: [{ label: "Open Trailer 360", href: `/dashboard/trailers/${trailer.id}` }],
  };
};

const queryEmptyOrLoadedTrailers = async (
  context: AssistantContext,
  mode: "empty" | "loaded",
): Promise<AssistantQueryResult> => {
  const [trailers, allocations] = await Promise.all([
    listActiveTrailers(context),
    listActiveExportAllocations(context),
  ]);

  const allocationStatusByTrailer = buildActiveExportStatusByTrailerId(allocations);
  const compoundTrailers = trailers
    .filter((trailer) => trailer.is_local !== true)
    .filter((trailer) => isTrailerEligibleForCompoundViews(trailer, allocationStatusByTrailer.get(trailer.id)))
    .filter((trailer) => isTrailerPresentInCompoundInventory(trailer, allocationStatusByTrailer.get(trailer.id)));

  const filtered = compoundTrailers.filter((trailer) => {
    const loadStatus = normalizeText(trailer.load_status);
    if (mode === "empty") {
      return loadStatus === "empty" && !allocationStatusByTrailer.has(trailer.id);
    }

    return loadStatus === "loaded";
  });

  return {
    intent: mode === "empty" ? "show_empty_trailers" : "show_loaded_trailers",
    title: mode === "empty" ? "Empty Trailers" : "Loaded Trailers",
    answer:
      mode === "empty"
        ? `${filtered.length} empty trailers are currently available in compound.`
        : `${filtered.length} loaded trailers are currently in compound inventory.`,
    resultType: "trailer_list",
    data: filtered.slice(0, 50).map((trailer) => ({
      trailerNumber: trailer.trailer_number,
      customer: trailer.customer,
      loadStatus: trailer.load_status,
      compoundPosition: trailer.compound_position,
      operationalStatus: trailer.operational_status,
      link: `/dashboard/trailers/${trailer.id}`,
    })),
    summary: [{ label: "Count", value: filtered.length }],
    links: mode === "empty" ? [{ label: "Open Search Filter", href: "/dashboard/search?status=empty" }] : [{ label: "Open Search Filter", href: "/dashboard/search?status=loaded" }],
  };
};

const queryCompoundOccupancy = async (context: AssistantContext): Promise<AssistantQueryResult> => {
  const [trailers, allocations] = await Promise.all([
    listActiveTrailers(context),
    listActiveExportAllocations(context),
  ]);

  const allocationStatusByTrailer = buildActiveExportStatusByTrailerId(allocations);
  const compoundInventory = trailers
    .filter((trailer) => trailer.is_local !== true)
    .filter((trailer) => isTrailerEligibleForCompoundViews(trailer, allocationStatusByTrailer.get(trailer.id)))
    .filter((trailer) => isTrailerPresentInCompoundInventory(trailer, allocationStatusByTrailer.get(trailer.id)));

  const occupancy = Math.min(100, Math.round((compoundInventory.length / 50) * 100));

  return {
    intent: "compound_occupancy",
    title: "Compound Occupancy",
    answer: `Compound occupancy is currently ${occupancy}% (${compoundInventory.length} / 50 positions).`,
    resultType: "summary",
    data: [],
    summary: [
      { label: "Occupied Positions", value: compoundInventory.length },
      { label: "Capacity", value: 50 },
      { label: "Occupancy", value: `${occupancy}%` },
    ],
    links: [{ label: "Open Compound View", href: "/dashboard/compound" }],
  };
};

const queryTodaysArrivals = async (context: AssistantContext): Promise<AssistantQueryResult> => {
  const today = todayDateKey();
  const { data, error } = await context.supabase
    .from("trailers")
    .select("id, trailer_number, load_status, customer, compound_position, arrival_date, is_local")
    .eq("arrival_date", today)
    .order("trailer_number", { ascending: true })
    .limit(120);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as Array<Pick<TrailerRow, "id" | "trailer_number" | "load_status" | "customer" | "compound_position" | "arrival_date" | "is_local">>;

  return {
    intent: "todays_arrivals",
    title: "Today's Arrivals",
    answer: `${rows.length} trailers arrived today.`,
    resultType: "trailer_list",
    data: rows.map((row) => ({
      trailerNumber: row.trailer_number,
      customer: row.customer,
      loadStatus: row.load_status,
      position: row.is_local ? "Local" : row.compound_position ?? "Awaiting Position",
      arrivedAt: formatDateTime(row.arrival_date),
      link: `/dashboard/trailers/${row.id}`,
    })),
    summary: [{ label: "Arrivals Today", value: rows.length }],
    links: [{ label: "Open Arrivals Filter", href: "/dashboard/search?filter=arrivals_today" }],
  };
};

const queryWaitingCollection = async (context: AssistantContext): Promise<AssistantQueryResult> => {
  const { data, error } = await context.supabase
    .from("delivery_bookings")
    .select("id, trailer_id, delivery_date, waiting_collection_since, collection_due_date")
    .eq("status", "waiting_collection")
    .order("waiting_collection_since", { ascending: true });

  if (error) {
    throw error;
  }

  const bookings = (data ?? []) as Array<
    Pick<DeliveryBookingRow, "id" | "trailer_id" | "delivery_date" | "waiting_collection_since" | "collection_due_date">
  >;

  const trailerIds = Array.from(new Set(bookings.map((row) => row.trailer_id).filter((value): value is string => Boolean(value))));
  const trailerNumberById = new Map<string, string>();

  if (trailerIds.length > 0) {
    const { data: trailers, error: trailersError } = await context.supabase
      .from("trailers")
      .select("id, trailer_number")
      .in("id", trailerIds);

    if (trailersError) {
      throw trailersError;
    }

    for (const trailer of trailers ?? []) {
      trailerNumberById.set(trailer.id, trailer.trailer_number ?? "Unknown");
    }
  }

  const rows = bookings.map((row) => {
    return {
      id: row.id,
      trailerId: row.trailer_id,
      trailerNumber: row.trailer_id ? trailerNumberById.get(row.trailer_id) ?? "Unknown" : "Unknown",
      deliveryDate: row.delivery_date,
      waitingSince: row.waiting_collection_since,
      dueDate: row.collection_due_date,
    };
  });

  return {
    intent: "waiting_collection",
    title: "Waiting Collection",
    answer: `${rows.length} trailers are currently waiting for collection.`,
    resultType: "trailer_list",
    data: rows.map((row) => ({
      trailerNumber: row.trailerNumber,
      waitingSince: formatDateTime(row.waitingSince),
      dueDate: formatDateTime(row.dueDate),
      deliveryDate: row.deliveryDate,
      link: row.trailerId ? `/dashboard/trailers/${row.trailerId}` : null,
    })),
    summary: [{ label: "Waiting Collection", value: rows.length }],
    links: [{ label: "Open Deliveries Waiting", href: "/dashboard/deliveries?filter=waiting" }],
  };
};

const queryLatestStockCheckDiscrepancies = async (
  context: AssistantContext,
  kind: "missing" | "unexpected",
): Promise<AssistantQueryResult> => {
  const latest = await findLatestStockCheck(context);

  if (!latest) {
    return {
      intent: kind === "missing" ? "missing_trailers" : "unexpected_trailers",
      title: kind === "missing" ? "Missing Trailers" : "Unexpected Trailers",
      answer: "No stock check records are available yet.",
      resultType: "text",
      data: [],
      links: [{ label: "Open Stock Check", href: "/dashboard/compound/stock-check" }],
    };
  }

  const { data, error } = await context.supabase
    .from("compound_stock_check_items")
    .select("id, trailer_id, trailer_number, discrepancy_type, resolution_status")
    .eq("stock_check_id", latest.id);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as StockCheckItemRow[];
  const filtered = rows.filter((row) => normalizeText(row.discrepancy_type).includes(kind));

  return {
    intent: kind === "missing" ? "missing_trailers" : "unexpected_trailers",
    title: kind === "missing" ? "Missing Trailers" : "Unexpected Trailers",
    answer:
      kind === "missing"
        ? `Latest stock check has ${filtered.length} missing trailer discrepancy${filtered.length === 1 ? "" : "ies"}.`
        : `Latest stock check has ${filtered.length} unexpected trailer discrepancy${filtered.length === 1 ? "" : "ies"}.`,
    resultType: "trailer_list",
    data: filtered.map((row) => ({
      trailerNumber: row.trailer_number,
      discrepancyType: row.discrepancy_type,
      resolutionStatus: row.resolution_status,
      link: row.trailer_id ? `/dashboard/trailers/${row.trailer_id}` : null,
    })),
    summary: [
      { label: "Stock Check Status", value: latest.status },
      { label: kind === "missing" ? "Missing" : "Unexpected", value: filtered.length },
      { label: "Started At", value: formatDateTime(latest.started_at) },
    ],
    links: [{ label: "Open Review Discrepancies", href: `/dashboard/compound/review-discrepancies?stockCheckId=${latest.id}&filter=${kind}` }],
  };
};

const queryAllocatedTrailers = async (context: AssistantContext): Promise<AssistantQueryResult> => {
  const { data, error } = await context.supabase
    .from("export_allocations")
    .select("id, trailer_id, trailer_number, customer, booking_reference, status, updated_at")
    .eq("status", "allocated")
    .order("updated_at", { ascending: false })
    .limit(120);

  if (error) {
    throw error;
  }

  const rows = ((data ?? []) as ExportAllocationRecord[]).map((row) => normalizeExportAllocationRecord(row));

  return {
    intent: "allocated_trailers",
    title: "Allocated Trailers",
    answer: `${rows.length} trailers are currently in allocated status.`,
    resultType: "trailer_list",
    data: rows.map((row) => ({
      trailerNumber: row.trailer_number,
      customer: row.customer,
      bookingReference: row.booking_reference,
      status: row.status,
      trailerLink: row.trailer_id ? `/dashboard/trailers/${row.trailer_id}` : null,
      allocationLink: `/dashboard/export-operations/${row.id}`,
    })),
    summary: [{ label: "Allocated", value: rows.length }],
    links: [{ label: "Open Export Allocations", href: "/dashboard/export-operations?status=allocated" }],
  };
};

const queryUnknown = (): AssistantQueryResult => ({
  intent: "unknown",
  title: "AI Assistant",
  answer:
    "I can help with: Where is trailer, Show empty trailers, Show loaded trailers, Compound occupancy, Today's arrivals, Waiting collection, Missing trailers, Unexpected trailers, and Allocated trailers.",
  resultType: "text",
  data: [],
  links: [],
});

export const runIntentQuery = async (context: AssistantContext, intent: AssistantIntent): Promise<AssistantQueryResult> => {
  switch (intent.intent) {
    case "where_is_trailer":
      return queryWhereIsTrailer(context, intent);
    case "show_empty_trailers":
      return queryEmptyOrLoadedTrailers(context, "empty");
    case "show_loaded_trailers":
      return queryEmptyOrLoadedTrailers(context, "loaded");
    case "compound_occupancy":
      return queryCompoundOccupancy(context);
    case "todays_arrivals":
      return queryTodaysArrivals(context);
    case "waiting_collection":
      return queryWaitingCollection(context);
    case "missing_trailers":
      return queryLatestStockCheckDiscrepancies(context, "missing");
    case "unexpected_trailers":
      return queryLatestStockCheckDiscrepancies(context, "unexpected");
    case "allocated_trailers":
      return queryAllocatedTrailers(context);
    default:
      return queryUnknown();
  }
};
