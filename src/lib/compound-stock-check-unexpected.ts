import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { normalizeCompoundPosition } from "@/lib/compound-yard";
import {
  classifyStockCheckObservation,
  encodeStockCheckFindingNotes,
  normalizeStockCheckPhysicalLoad,
  normalizeTrailerNumber,
  parseStockCheckFindingNotes,
  type StockCheck,
  type StockCheckItem,
  type StockCheckPhysicalLoad,
} from "@/lib/compound-stock-check";
import {
  persistStockCheckObservationTotals,
  requireOpenStockCheck,
  STOCK_CHECK_ITEM_SELECT,
} from "@/lib/compound-stock-check-session";
import { createTrailerActivity } from "@/lib/trailer-activity";

type FindingSupabase = SupabaseClient<Database>;

const TRAILER_CONTEXT_SELECT =
  "id, trailer_number, compound_position, load_status, operational_status, is_local, departure_date, customer";

export class StockCheckFindingError extends Error {
  status: number;
  code: string;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "StockCheckFindingError";
    this.status = status;
    this.code = code;
  }
}

export type StockCheckTrailerContext = {
  id: string;
  trailerNumber: string;
  compoundPosition: string | null;
  list: "main" | "local" | "unknown";
  loadStatus: string | null;
  operationalStatus: string | null;
  customer: string | null;
  departed: boolean;
  activeDelivery: { id: string; status: string; reference: string | null } | null;
  activeExport: { id: string; status: string; reference: string | null } | null;
};

export type StockCheckTrailerSearchResult = {
  query: string;
  exactMatch: StockCheckTrailerContext | null;
  matches: StockCheckTrailerContext[];
  unknown: boolean;
};

const closedJobStatuses = new Set(["completed", "cancelled", "canceled", "delivered", "collected"]);

const normalizeNumber = (value?: string | null) => {
  const normalized = normalizeTrailerNumber(value ?? "");
  return normalized || null;
};

export const matchStockCheckItemByTrailer = (
  items: StockCheckItem[],
  trailerNumber: string,
  trailerId?: string | null,
) => {
  const byNumber = items.find((item) => normalizeNumber(item.trailer_number) === trailerNumber);
  if (byNumber) {
    return byNumber;
  }
  if (trailerId) {
    return items.find((item) => item.trailer_id === trailerId) ?? null;
  }
  return null;
};

const toListLabel = (isLocal?: boolean | null): StockCheckTrailerContext["list"] => {
  if (isLocal === true) {
    return "local";
  }
  if (isLocal === false) {
    return "main";
  }
  return "unknown";
};

const loadJobContext = async (supabase: FindingSupabase, trailerIds: string[]) => {
  const deliveryByTrailerId = new Map<string, StockCheckTrailerContext["activeDelivery"]>();
  const exportByTrailerId = new Map<string, StockCheckTrailerContext["activeExport"]>();
  if (trailerIds.length === 0) {
    return { deliveryByTrailerId, exportByTrailerId };
  }

  const [{ data: deliveries }, { data: exports }] = await Promise.all([
    supabase.from("delivery_bookings").select("id, trailer_id, status, booking_reference").in("trailer_id", trailerIds),
    supabase.from("export_allocations").select("id, trailer_id, status, booking_reference").in("trailer_id", trailerIds),
  ]);

  for (const row of deliveries ?? []) {
    if (!row.trailer_id || closedJobStatuses.has((row.status ?? "").trim().toLowerCase())) {
      continue;
    }
    if (!deliveryByTrailerId.has(row.trailer_id)) {
      deliveryByTrailerId.set(row.trailer_id, {
        id: row.id,
        status: row.status,
        reference: row.booking_reference,
      });
    }
  }

  for (const row of exports ?? []) {
    if (!row.trailer_id || closedJobStatuses.has((row.status ?? "").trim().toLowerCase())) {
      continue;
    }
    if (!exportByTrailerId.has(row.trailer_id)) {
      exportByTrailerId.set(row.trailer_id, {
        id: row.id,
        status: row.status,
        reference: row.booking_reference,
      });
    }
  }

  return { deliveryByTrailerId, exportByTrailerId };
};

const toTrailerContext = (
  row: {
    id: string;
    trailer_number?: string | null;
    compound_position?: string | null;
    load_status?: string | null;
    operational_status?: string | null;
    is_local?: boolean | null;
    departure_date?: string | null;
    customer?: string | null;
  },
  deliveryByTrailerId: Map<string, StockCheckTrailerContext["activeDelivery"]>,
  exportByTrailerId: Map<string, StockCheckTrailerContext["activeExport"]>,
): StockCheckTrailerContext => ({
  id: row.id,
  trailerNumber: normalizeNumber(row.trailer_number) ?? row.id,
  compoundPosition: row.compound_position ?? null,
  list: toListLabel(row.is_local),
  loadStatus: row.load_status ?? null,
  operationalStatus: row.operational_status ?? null,
  customer: row.customer ?? null,
  departed: Boolean(row.departure_date?.trim()),
  activeDelivery: deliveryByTrailerId.get(row.id) ?? null,
  activeExport: exportByTrailerId.get(row.id) ?? null,
});

export async function searchStockCheckTrailers(
  supabase: FindingSupabase,
  query: string,
): Promise<StockCheckTrailerSearchResult> {
  const normalized = normalizeNumber(query);
  if (!normalized) {
    throw new StockCheckFindingError("Enter a trailer number.", "TRAILER_NUMBER_REQUIRED");
  }

  const { data: exactRows, error: exactError } = await supabase
    .from("trailers")
    .select(TRAILER_CONTEXT_SELECT)
    .eq("trailer_number", normalized)
    .limit(5);

  if (exactError) {
    throw new Error(exactError.message || "Unable to search trailers.");
  }

  const { data: prefixRows, error: prefixError } = await supabase
    .from("trailers")
    .select(TRAILER_CONTEXT_SELECT)
    .ilike("trailer_number", `${normalized}%`)
    .limit(8);

  if (prefixError) {
    throw new Error(prefixError.message || "Unable to search trailers.");
  }

  const merged = new Map<string, NonNullable<typeof exactRows>[number]>();
  for (const row of [...(exactRows ?? []), ...(prefixRows ?? [])]) {
    if (row?.id && !merged.has(row.id)) {
      merged.set(row.id, row);
    }
  }

  const rows = Array.from(merged.values());
  const { deliveryByTrailerId, exportByTrailerId } = await loadJobContext(
    supabase,
    rows.map((row) => row.id),
  );
  const matches = rows.map((row) => toTrailerContext(row, deliveryByTrailerId, exportByTrailerId));
  const exactMatch = matches.find((row) => row.trailerNumber === normalized) ?? null;

  return {
    query: normalized,
    exactMatch,
    matches,
    unknown: !exactMatch,
  };
}

const findPositionOccupant = async (
  supabase: FindingSupabase,
  position: string,
  excludeTrailerId?: string | null,
) => {
  const { data, error } = await supabase
    .from("trailers")
    .select("id, trailer_number, compound_position")
    .eq("compound_position", position)
    .is("departure_date", null)
    .limit(5);

  if (error) {
    throw new Error(error.message || "Unable to check compound occupancy.");
  }

  const occupant = (data ?? []).find((row) => row.id !== excludeTrailerId) ?? null;
  return occupant
    ? { id: occupant.id, trailerNumber: normalizeNumber(occupant.trailer_number) ?? occupant.id }
    : null;
};

const writeFindingAudit = async (
  supabase: FindingSupabase,
  input: {
    trailerId: string | null;
    trailerNumber: string;
    operatorName: string;
    description: string;
    previousValue: Record<string, unknown>;
    newValue: Record<string, unknown>;
  },
) => {
  await supabase.from("trailer_audit_log").insert({
    trailer_id: input.trailerId,
    trailer_number: input.trailerNumber,
    event_type: "stock_check_finding",
    description: input.description,
    previous_value: input.previousValue as Json,
    new_value: input.newValue as Json,
    source_module: "stock_check",
    performed_by: input.operatorName,
    performed_at: new Date().toISOString(),
  });

  await createTrailerActivity({
    supabaseClient: supabase,
    trailerId: input.trailerId,
    trailerNumber: input.trailerNumber,
    eventType: "stock_check_confirmed",
    eventTitle: "Stock Check finding recorded",
    eventDescription: input.description,
    sourceModule: "stock_check",
    performedBy: input.operatorName,
    newCompoundPosition: typeof input.newValue.actual_position === "string" ? input.newValue.actual_position : null,
    metadata: input.newValue,
  });
};

const systemLoadMatchesPhysical = (systemLoad?: string | null, physicalLoad?: StockCheckPhysicalLoad | null) => {
  const system = normalizeStockCheckPhysicalLoad(systemLoad);
  if (!system || !physicalLoad) {
    return true;
  }
  return system === physicalLoad;
};

export type RecordStockCheckFindingInput = {
  stockCheckId: string;
  trailerNumber: string;
  actualPosition: string;
  physicalLoad: string;
  operatorName: string;
  note?: string | null;
  confirmUnknown?: boolean;
};

export type RecordStockCheckFindingResult = {
  kind: "unexpected" | "found_expected";
  unknownTrailer: boolean;
  positionConflict: { trailerNumber: string } | null;
  item: StockCheckItem;
  stockCheck: StockCheck;
  items: StockCheckItem[];
  expectedTotal: number;
  unexpectedTotal: number;
  trailerCreated: false;
};

const countUnexpected = (items: StockCheckItem[]) =>
  items.filter((item) => classifyStockCheckObservation(item).unexpected).length;

export async function recordStockCheckFinding(
  supabase: FindingSupabase,
  input: RecordStockCheckFindingInput,
): Promise<RecordStockCheckFindingResult> {
  const trailerNumber = normalizeNumber(input.trailerNumber);
  if (!trailerNumber) {
    throw new StockCheckFindingError("Enter a trailer number.", "TRAILER_NUMBER_REQUIRED");
  }

  const actualPosition = normalizeCompoundPosition(input.actualPosition);
  if (!actualPosition) {
    throw new StockCheckFindingError("Enter a valid compound position (P01–P50).", "INVALID_POSITION");
  }

  const physicalLoad = normalizeStockCheckPhysicalLoad(input.physicalLoad);
  if (!physicalLoad) {
    throw new StockCheckFindingError("Select Empty or Loaded.", "PHYSICAL_LOAD_REQUIRED");
  }

  const { session, items } = await requireOpenStockCheck(supabase, input.stockCheckId);
  const originalExpectedTotal = session.expected_total ?? 0;
  const search = await searchStockCheckTrailers(supabase, trailerNumber);
  const matchedTrailer = search.exactMatch;

  if (!matchedTrailer && !input.confirmUnknown) {
    throw new StockCheckFindingError(
      "This trailer number is not in TrailerHub. Confirm to record it as Unknown / Unexpected.",
      "UNKNOWN_TRAILER_CONFIRMATION_REQUIRED",
    );
  }

  const existingItem = matchStockCheckItemByTrailer(items, trailerNumber, matchedTrailer?.id ?? null);
  const occupant = await findPositionOccupant(supabase, actualPosition, matchedTrailer?.id ?? existingItem?.trailer_id);
  const positionConflict =
    occupant && occupant.trailerNumber !== trailerNumber ? { trailerNumber: occupant.trailerNumber } : null;
  const nowIso = new Date().toISOString();
  const operatorName = input.operatorName.trim() || "Stock Check operator";
  const unknownTrailer = !matchedTrailer;
  const findingNotes = encodeStockCheckFindingNotes({
    physicalLoad,
    positionConflictOccupant: positionConflict?.trailerNumber ?? null,
    unknownTrailer,
    operatorNote: input.note?.trim() || null,
  });

  if (existingItem?.expected_in_compound === true) {
    const loadMismatch = !systemLoadMatchesPhysical(existingItem.system_load_status, physicalLoad);
    const expectedPosition = normalizeCompoundPosition(existingItem.expected_position ?? "");
    const positionMismatch = Boolean(expectedPosition) && expectedPosition !== actualPosition;
    const discrepancyType = positionMismatch ? "wrong_position" : loadMismatch ? "wrong_load_status" : "matched";

    const { data: updatedItem, error: updateError } = await supabase
      .from("compound_stock_check_items")
      .update({
        physically_present: true,
        actual_position: actualPosition,
        discrepancy_type: discrepancyType,
        checked_at: existingItem.checked_at ?? nowIso,
        checked_by: existingItem.checked_by ?? operatorName,
        notes: findingNotes,
        updated_at: nowIso,
      })
      .eq("id", existingItem.id)
      .eq("stock_check_id", session.id)
      .select(STOCK_CHECK_ITEM_SELECT)
      .maybeSingle();

    if (updateError || !updatedItem) {
      throw new Error(updateError?.message || "Unable to update the expected stock check item.");
    }

    const nextItems = items.map((item) => (item.id === updatedItem.id ? (updatedItem as StockCheckItem) : item));
    const stockCheck = await persistStockCheckObservationTotals(supabase, session, nextItems);
    await writeFindingAudit(supabase, {
      trailerId: existingItem.trailer_id,
      trailerNumber,
      operatorName,
      description: `${trailerNumber} recorded as found during Stock Check.`,
      previousValue: {
        physically_present: existingItem.physically_present,
        actual_position: existingItem.actual_position,
        discrepancy_type: existingItem.discrepancy_type,
      },
      newValue: {
        physically_present: true,
        actual_position: actualPosition,
        physical_load: physicalLoad,
        discrepancy_type: discrepancyType,
        expected_in_compound: true,
      },
    });

    return {
      kind: "found_expected",
      unknownTrailer: false,
      positionConflict,
      item: updatedItem as StockCheckItem,
      stockCheck: { ...stockCheck, expected_total: originalExpectedTotal },
      items: nextItems,
      expectedTotal: originalExpectedTotal,
      unexpectedTotal: countUnexpected(nextItems),
      trailerCreated: false,
    };
  }

  const payload = {
    stock_check_id: session.id,
    trailer_id: matchedTrailer?.id ?? existingItem?.trailer_id ?? null,
    trailer_number: trailerNumber,
    expected_in_compound: false,
    physically_present: true,
    expected_position: existingItem?.expected_position ?? null,
    actual_position: actualPosition,
    system_load_status: existingItem?.system_load_status ?? matchedTrailer?.loadStatus ?? null,
    system_operational_status: existingItem?.system_operational_status ?? matchedTrailer?.operationalStatus ?? null,
    discrepancy_type: "unexpected",
    checked_at: existingItem?.checked_at ?? nowIso,
    checked_by: existingItem?.checked_by ?? operatorName,
    resolution_status: existingItem?.resolution_status ?? "unresolved",
    notes: findingNotes,
    updated_at: nowIso,
  };

  let savedItem: StockCheckItem | null = null;
  if (existingItem) {
    const { data, error } = await supabase
      .from("compound_stock_check_items")
      .update(payload)
      .eq("id", existingItem.id)
      .eq("stock_check_id", session.id)
      .select(STOCK_CHECK_ITEM_SELECT)
      .maybeSingle();
    if (error || !data) {
      throw new Error(error?.message || "Unable to update the unexpected finding.");
    }
    savedItem = data as StockCheckItem;
  } else {
    const { data, error } = await supabase
      .from("compound_stock_check_items")
      .insert(payload)
      .select(STOCK_CHECK_ITEM_SELECT)
      .maybeSingle();

    if (error) {
      if (/compound_stock_check_items_stock_check_id_trailer_number_key/i.test(error.message)) {
        const retryItem = matchStockCheckItemByTrailer(items, trailerNumber, matchedTrailer?.id ?? null);
        if (retryItem) {
          const retried = await supabase
            .from("compound_stock_check_items")
            .update(payload)
            .eq("id", retryItem.id)
            .select(STOCK_CHECK_ITEM_SELECT)
            .maybeSingle();
          savedItem = (retried.data as StockCheckItem | null) ?? null;
        }
      }
      if (!savedItem) {
        throw new Error(error.message || "Unable to record the unexpected finding.");
      }
    } else {
      savedItem = data as StockCheckItem;
    }
  }

  if (!savedItem) {
    throw new Error("Unable to record the unexpected finding.");
  }

  const nextItems = existingItem
    ? items.map((item) => (item.id === savedItem?.id ? savedItem : item))
    : [...items.filter((item) => item.id !== savedItem?.id), savedItem];
  const stockCheck = await persistStockCheckObservationTotals(supabase, session, nextItems);

  if (stockCheck.expected_total !== originalExpectedTotal) {
    await supabase.from("compound_stock_checks").update({ expected_total: originalExpectedTotal }).eq("id", session.id);
  }

  await writeFindingAudit(supabase, {
    trailerId: savedItem.trailer_id,
    trailerNumber,
    operatorName,
    description: unknownTrailer
      ? `Unknown trailer ${trailerNumber} recorded as unexpected during Stock Check.`
      : `${trailerNumber} recorded as unexpected during Stock Check.`,
    previousValue: {
      expected_in_compound: existingItem?.expected_in_compound ?? false,
      physically_present: existingItem?.physically_present ?? null,
    },
    newValue: {
      expected_in_compound: false,
      physically_present: true,
      actual_position: actualPosition,
      physical_load: physicalLoad,
      unknown_trailer: unknownTrailer,
      position_conflict: positionConflict?.trailerNumber ?? null,
      trailer_created: false,
    },
  });

  return {
    kind: "unexpected",
    unknownTrailer,
    positionConflict,
    item: savedItem,
    stockCheck: { ...stockCheck, expected_total: originalExpectedTotal },
    items: nextItems,
    expectedTotal: originalExpectedTotal,
    unexpectedTotal: countUnexpected(nextItems),
    trailerCreated: false,
  };
}

export const getStockCheckFindingSummary = (item: StockCheckItem) => {
  const classification = classifyStockCheckObservation(item);
  const finding = parseStockCheckFindingNotes(item.notes);
  return {
    classification,
    finding,
    physicalLoad: finding.physicalLoad,
    positionConflictOccupant: finding.positionConflictOccupant,
    unknownTrailer: finding.unknownTrailer,
  };
};
