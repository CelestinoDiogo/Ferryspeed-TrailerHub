import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { moveCompoundTrailer, normalizeCompoundPosition } from "@/lib/compound-yard";
import {
  classifyStockCheckObservation,
  encodeStockCheckFindingNotes,
  isResolvedStockCheckItem,
  normalizeStockCheckPhysicalLoad,
  parseStockCheckFindingNotes,
  type StockCheck,
  type StockCheckItem,
} from "@/lib/compound-stock-check";
import { persistStockCheckObservationTotals, requireOpenStockCheck } from "@/lib/compound-stock-check-session";
import { returnLocalTrailerToMainList } from "@/lib/operations/return-local-trailer-to-main-list";
import { syncTrailerCurrentOperationalState } from "@/lib/operations/trailer-current-state";
import { createTrailerActivity } from "@/lib/trailer-activity";

type ResolutionSupabase = SupabaseClient<Database>;

export class StockCheckResolutionError extends Error {
  status: number;
  code: string;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "StockCheckResolutionError";
    this.status = status;
    this.code = code;
  }
}

export const STOCK_CHECK_RESOLUTION_ACTIONS = [
  "update_compound_position",
  "update_load_status",
  "return_to_main_list",
  "confirm_compound_presence",
  "keep_unresolved",
  "create_trailer",
] as const;

export type StockCheckResolutionAction = (typeof STOCK_CHECK_RESOLUTION_ACTIONS)[number];
export type StockCheckResolutionSurface = "desktop" | "master_mobile";

export type ResolveStockCheckDiscrepancyInput = {
  stockCheckId: string;
  itemId: string;
  action: StockCheckResolutionAction;
  operatorName: string;
  surface?: StockCheckResolutionSurface;
  note?: string | null;
  compoundPosition?: string | null;
  loadStatus?: string | null;
  customer?: string | null;
};

const HISTORICAL_FIELDS = [
  "expected_in_compound",
  "expected_position",
  "physically_present",
  "actual_position",
  "discrepancy_type",
  "system_load_status",
  "checked_at",
  "checked_by",
] as const;

const writeResolutionAudit = async (
  supabase: ResolutionSupabase,
  input: {
    trailerId: string | null;
    trailerNumber: string;
    operatorName: string;
    action: StockCheckResolutionAction;
    description: string;
    previousValue: Record<string, unknown>;
    newValue: Record<string, unknown>;
  },
) => {
  await supabase.from("trailer_audit_log").insert({
    trailer_id: input.trailerId,
    trailer_number: input.trailerNumber,
    event_type: "stock_check_resolution",
    description: input.description,
    previous_value: input.previousValue as Json,
    new_value: input.newValue as Json,
    source_module: "stock_check",
    performed_by: input.operatorName,
    performed_at: new Date().toISOString(),
  });

  if (input.trailerNumber) {
    await createTrailerActivity({
      supabaseClient: supabase,
      trailerId: input.trailerId,
      trailerNumber: input.trailerNumber,
      eventType: "stock_check_adjusted",
      eventTitle: "Stock Check discrepancy resolved",
      eventDescription: input.description,
      sourceModule: "stock_check",
      performedBy: input.operatorName,
      metadata: { action: input.action, ...input.newValue },
    });
  }
};

const mergeResolutionNote = (item: StockCheckItem, note?: string | null) => {
  const finding = parseStockCheckFindingNotes(item.notes);
  return encodeStockCheckFindingNotes({
    ...finding,
    operatorNote: note?.trim() || finding.operatorNote,
  });
};

const markItemResolution = async (
  supabase: ResolutionSupabase,
  item: StockCheckItem,
  input: {
    action: StockCheckResolutionAction;
    operatorName: string;
    note?: string | null;
    resolved: boolean;
  },
) => {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("compound_stock_check_items")
    .update({
      resolution_status: input.resolved ? "resolved" : "unresolved",
      resolution_action: input.action,
      resolved_at: input.resolved ? nowIso : null,
      resolved_by: input.resolved ? input.operatorName : null,
      notes: mergeResolutionNote(item, input.note),
      updated_at: nowIso,
    })
    .eq("id", item.id)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message || "Unable to update stock check resolution.");
  }

  return data as StockCheckItem;
};

const assertHistoricalFindingUnchanged = (before: StockCheckItem, after: StockCheckItem) => {
  for (const field of HISTORICAL_FIELDS) {
    if (before[field] !== after[field]) {
      throw new StockCheckResolutionError(
        "Resolution cannot rewrite the original Stock Check finding.",
        "HISTORICAL_FINDING_MUTATED",
        500,
      );
    }
  }
};

const loadTrailer = async (supabase: ResolutionSupabase, trailerId: string) => {
  const { data, error } = await supabase
    .from("trailers")
    .select("id, trailer_number, compound_position, load_status, operational_status, is_local, departure_date, customer")
    .eq("id", trailerId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Unable to load trailer.");
  }
  if (!data) {
    throw new StockCheckResolutionError("Linked trailer was not found.", "TRAILER_NOT_FOUND", 404);
  }
  return data;
};

export const listRelevantStockCheckResolutions = (
  item: StockCheckItem,
  trailer?: { is_local?: boolean | null; compound_position?: string | null; load_status?: string | null } | null,
  surface: StockCheckResolutionSurface = "desktop",
) => {
  const classification = classifyStockCheckObservation(item);
  const finding = parseStockCheckFindingNotes(item.notes);
  const actions: StockCheckResolutionAction[] = ["keep_unresolved"];

  if (classification.missing) {
    return actions;
  }

  if (finding.unknownTrailer || !item.trailer_id) {
    if (surface === "desktop") {
      actions.unshift("create_trailer");
    }
    return actions;
  }

  if (classification.positionMismatch || classification.unexpected) {
    actions.unshift("update_compound_position");
    actions.unshift("confirm_compound_presence");
  }
  if (classification.statusMismatch || finding.physicalLoad) {
    actions.unshift("update_load_status");
  }
  if (trailer?.is_local === true) {
    actions.unshift("return_to_main_list");
  }

  return Array.from(new Set(actions));
};

export async function resolveStockCheckDiscrepancy(
  supabase: ResolutionSupabase,
  input: ResolveStockCheckDiscrepancyInput,
) {
  const surface = input.surface ?? "desktop";
  if (input.action === "create_trailer" && surface !== "desktop") {
    throw new StockCheckResolutionError(
      "Unknown trailer creation is available on desktop only.",
      "CREATE_TRAILER_DESKTOP_ONLY",
      403,
    );
  }

  const { session, items } = await requireOpenStockCheck(supabase, input.stockCheckId);
  const existingItem = items.find((item) => item.id === input.itemId);
  if (!existingItem) {
    throw new StockCheckResolutionError("Stock check item not found.", "ITEM_NOT_FOUND", 404);
  }

  const originalExpectedTotal = session.expected_total ?? 0;
  const originalUnexpected = classifyStockCheckObservation(existingItem).unexpected;
  const operatorName = input.operatorName.trim() || "Stock Check operator";
  const finding = parseStockCheckFindingNotes(existingItem.notes);
  const targetPosition =
    normalizeCompoundPosition(input.compoundPosition ?? existingItem.actual_position ?? "") ?? null;
  const targetLoad =
    normalizeStockCheckPhysicalLoad(input.loadStatus ?? finding.physicalLoad) ??
    normalizeStockCheckPhysicalLoad(existingItem.system_load_status);

  let linkedTrailerId = existingItem.trailer_id;

  if (input.action === "keep_unresolved") {
    const updatedItem = await markItemResolution(supabase, existingItem, {
      action: input.action,
      operatorName,
      note: input.note,
      resolved: false,
    });
    assertHistoricalFindingUnchanged(existingItem, updatedItem);
    const nextItems = items.map((item) => (item.id === updatedItem.id ? updatedItem : item));
    const stockCheck = await persistStockCheckObservationTotals(supabase, session, nextItems);
    return {
      item: updatedItem,
      stockCheck: { ...stockCheck, expected_total: originalExpectedTotal },
      items: nextItems,
      repeated: isResolvedStockCheckItem(existingItem),
      unexpectedPreserved: originalUnexpected,
    };
  }

  if (input.action === "create_trailer") {
    if (existingItem.trailer_id) {
      throw new StockCheckResolutionError("This finding already has a linked trailer.", "TRAILER_ALREADY_LINKED");
    }
    const trailerNumber = (existingItem.trailer_number ?? "").trim().toUpperCase();
    if (!trailerNumber) {
      throw new StockCheckResolutionError("A trailer number is required to create a trailer.", "TRAILER_NUMBER_REQUIRED");
    }

    const { data: created, error: createError } = await supabase
      .from("trailers")
      .insert({
        trailer_number: trailerNumber,
        load_status: targetLoad === "loaded" ? "Loaded" : "Empty",
        compound_position: targetPosition,
        is_local: false,
        customer: input.customer?.trim() || null,
        notes: `Created from Stock Check unexpected finding.`,
      })
      .select("id, trailer_number, compound_position, load_status, operational_status, is_local")
      .maybeSingle();

    if (createError || !created) {
      throw new Error(createError?.message || "Unable to create trailer.");
    }

    await syncTrailerCurrentOperationalState(supabase, created.id, { intent: "place_on_compound" });
    linkedTrailerId = created.id;

    const { data: linked, error: linkError } = await supabase
      .from("compound_stock_check_items")
      .update({
        trailer_id: created.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingItem.id)
      .select("*")
      .maybeSingle();

    if (linkError || !linked) {
      throw new Error(linkError?.message || "Unable to link the created trailer to the finding.");
    }

    const linkedItem = linked as StockCheckItem;
    if (linkedItem.expected_in_compound !== false || linkedItem.physically_present !== true) {
      throw new StockCheckResolutionError(
        "Creating a trailer cannot rewrite the unexpected finding.",
        "HISTORICAL_FINDING_MUTATED",
        500,
      );
    }

    const resolvedItem = await markItemResolution(supabase, linkedItem, {
      action: input.action,
      operatorName,
      note: input.note,
      resolved: true,
    });
    assertHistoricalFindingUnchanged({ ...existingItem, trailer_id: created.id }, resolvedItem);

    await writeResolutionAudit(supabase, {
      trailerId: created.id,
      trailerNumber,
      operatorName,
      action: input.action,
      description: `${trailerNumber} created on the Main List from a Stock Check unexpected finding.`,
      previousValue: { trailer_id: null },
      newValue: { trailer_id: created.id, expected_in_compound: false, physically_present: true },
    });

    const nextItems = items.map((item) => (item.id === resolvedItem.id ? resolvedItem : item));
    const stockCheck = await persistStockCheckObservationTotals(supabase, session, nextItems);
    return {
      item: resolvedItem,
      stockCheck: { ...stockCheck, expected_total: originalExpectedTotal },
      items: nextItems,
      repeated: false,
      unexpectedPreserved: true,
    };
  }

  if (!linkedTrailerId) {
    throw new StockCheckResolutionError(
      "This unknown finding must be created as a trailer before operational correction.",
      "TRAILER_REQUIRED",
    );
  }

  const trailer = await loadTrailer(supabase, linkedTrailerId);

  if (input.action === "update_compound_position" || input.action === "confirm_compound_presence") {
    if (!targetPosition) {
      throw new StockCheckResolutionError("A compound position is required.", "POSITION_REQUIRED");
    }
    await moveCompoundTrailer(supabase, {
      trailerId: trailer.id,
      targetPosition,
      movedBy: operatorName,
      reason: "Stock Check resolution",
    });
  }

  if (input.action === "update_load_status") {
    if (!targetLoad) {
      throw new StockCheckResolutionError("Select Empty or Loaded.", "LOAD_STATUS_REQUIRED");
    }
    const { error } = await supabase
      .from("trailers")
      .update({ load_status: targetLoad === "loaded" ? "Loaded" : "Empty" })
      .eq("id", trailer.id);
    if (error) {
      throw new Error(error.message || "Unable to update load status.");
    }
    await syncTrailerCurrentOperationalState(supabase, trailer.id, { intent: "sync" });
  }

  if (input.action === "return_to_main_list") {
    await returnLocalTrailerToMainList(supabase, {
      trailerId: trailer.id,
      operatorName,
      compoundPosition: targetPosition,
    });
  }

  const resolvedItem = await markItemResolution(supabase, existingItem, {
    action: input.action,
    operatorName,
    note: input.note,
    resolved: true,
  });
  assertHistoricalFindingUnchanged(existingItem, resolvedItem);

  await writeResolutionAudit(supabase, {
    trailerId: trailer.id,
    trailerNumber: trailer.trailer_number ?? existingItem.trailer_number ?? "",
    operatorName,
    action: input.action,
    description: `${trailer.trailer_number ?? existingItem.trailer_number} operational record updated after Stock Check.`,
    previousValue: {
      compound_position: trailer.compound_position,
      load_status: trailer.load_status,
      is_local: trailer.is_local,
      resolution_status: existingItem.resolution_status,
    },
    newValue: {
      action: input.action,
      expected_in_compound: resolvedItem.expected_in_compound,
      physically_present: resolvedItem.physically_present,
      expected_position: resolvedItem.expected_position,
      actual_position: resolvedItem.actual_position,
    },
  });

  const nextItems = items.map((item) => (item.id === resolvedItem.id ? resolvedItem : item));
  const stockCheck = await persistStockCheckObservationTotals(supabase, session, nextItems);

  return {
    item: resolvedItem,
    stockCheck: { ...stockCheck, expected_total: originalExpectedTotal } as StockCheck,
    items: nextItems,
    repeated: isResolvedStockCheckItem(existingItem),
    unexpectedPreserved: originalUnexpected && classifyStockCheckObservation(resolvedItem).unexpected,
  };
}
