type TrailerEventLike = {
  trailer_id?: string | null;
  event_type?: string | null;
  old_value?: unknown;
  reversed_at?: string | null;
  is_reversal?: boolean | null;
};

const REVERSIBLE_TRAILER_FIELDS = [
  "load_status",
  "load_description",
  "customer",
  "consignee",
  "container_number",
  "compound_position",
  "arrival_date",
  "arrival_time",
  "departure_date",
  "departure_time",
  "trailer_source",
  "external_company",
  "external_reference",
  "is_local",
  "operational_status",
  "delivered_at",
  "returned_empty_at",
  "notes",
  "trailer_type",
] as const;

type ReversibleTrailerField = (typeof REVERSIBLE_TRAILER_FIELDS)[number];

const REVERSIBLE_FIELD_SET = new Set<string>(REVERSIBLE_TRAILER_FIELDS);

export const REVERSIBLE_EVENT_TYPES = new Set<string>([
  "arrival_registered",
  "departure_registered",
  "trailer_loaded",
  "trailer_updated",
  "compound_position_changed",
  "trailer_location_changed",
  "trailer_source_changed",
  "external_company_changed",
  "Mark Empty",
  "Mark On Delivery",
  "Mark Delivered",
  "Return Empty",
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return false;
  }

  return true;
};

export function buildTrailerRestorePatch(oldValue: unknown): Record<string, unknown> {
  if (!isPlainObject(oldValue)) {
    return {};
  }

  const patch: Record<string, unknown> = {};

  Object.entries(oldValue).forEach(([key, value]) => {
    if (!REVERSIBLE_FIELD_SET.has(key)) {
      return;
    }

    patch[key as ReversibleTrailerField] = value;
  });

  return patch;
}

export function canReverseTrailerEvent(event: TrailerEventLike): {
  allowed: boolean;
  reason?: string;
} {
  if (!event.trailer_id) {
    return { allowed: false, reason: "Event is not associated with a trailer." };
  }

  if (event.is_reversal === true) {
    return { allowed: false, reason: "Reversal events cannot be reversed." };
  }

  if (event.reversed_at) {
    return { allowed: false, reason: "This movement has already been reversed." };
  }

  if (!event.event_type || !REVERSIBLE_EVENT_TYPES.has(event.event_type)) {
    return { allowed: false, reason: "Event type is not eligible for trailer-state undo." };
  }

  const patch = buildTrailerRestorePatch(event.old_value);
  if (Object.keys(patch).length === 0) {
    return { allowed: false, reason: "No reversible trailer fields found in old_value." };
  }

  return { allowed: true };
}

export function getReversibleTrailerFields(): ReadonlyArray<ReversibleTrailerField> {
  return REVERSIBLE_TRAILER_FIELDS;
}
