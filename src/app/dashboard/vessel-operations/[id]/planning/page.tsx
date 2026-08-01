"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Json } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";
import {
  applyPlanningOwnershipSelection,
  PLANNED_DESTINATION_SUGGESTIONS,
  computeVesselOperationSummary,
  formatVesselDateTime,
  getVesselOperationStatusClass,
  getVesselOperationStatusLabel,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselTrailerStatusClass,
  getVesselTrailerStatusLabel,
  normalizeTrailerNumber,
  normalizeExpectedTemperatureUnit,
  normalizeVesselText,
  sortVesselOperationTrailersForArrivals,
  validateTrailerPlanning,
  type VesselOperationRecord,
  type VesselOperationTrailerRecord,
  type VesselPriorityLevel,
  type VesselTrailerStatus,
} from "@/lib/vessel-operations";
import type { TrailerOwnershipType } from "@/lib/trailer-ownership";

type FleetTrailer = {
  id: string;
  trailer_number?: string | null;
  customer?: string | null;
  load_description?: string | null;
  load_status?: string | null;
  departure_date?: string | null;
  compound_position?: string | null;
  trailer_source?: string | null;
  external_company?: string | null;
  is_local?: boolean | null;
};

type DraftTrailer = {
  clientId: string;
  trailer_id?: string | null;
  trailer_number: string;
  ownership_type: TrailerOwnershipType;
  trailer_source: "company" | "outsourced" | "unknown" | "local";
  external_company: string;
  customer: string;
  booking_reference: string;
  load_description: string;
  expected_front_temperature: string;
  expected_rear_temperature: string;
  expected_temperature_unit: string;
  priority_level: VesselPriorityLevel;
  priority_reason: string;
  planned_destination: string;
  planning_notes: string;
  manifest_change_reason: string;
  status: VesselTrailerStatus;
};

const emptyDraft = (): DraftTrailer => ({
  clientId: crypto.randomUUID(),
  trailer_id: null,
  trailer_number: "",
  ownership_type: "unknown",
  trailer_source: "unknown",
  external_company: "",
  customer: "",
  booking_reference: "",
  load_description: "",
  expected_front_temperature: "",
  expected_rear_temperature: "",
  expected_temperature_unit: "C",
  priority_level: "normal",
  priority_reason: "",
  planned_destination: "Compound",
  planning_notes: "",
  manifest_change_reason: "",
  status: "expected",
});

const toOperationDateTime = (operation?: VesselOperationRecord | null) =>
  operation?.expected_arrival_at ? formatVesselDateTime(operation.expected_arrival_at) : "—";

const parseOptionalTemperatureInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { value: null as number | null, error: null as string | null };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { value: null as number | null, error: "Temperature values must be numeric." };
  }

  return { value: parsed, error: null as string | null };
};

const parseLegacyFrontExpectedTemperature = (value?: string | null) => {
  const text = (value ?? "").trim();
  if (!text) {
    return "";
  }

  const direct = Number(text);
  if (Number.isFinite(direct)) {
    return String(direct);
  }

  const match = text.match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : "";
};

type ImportedTrailerRow = {
  trailer_number: string;
  expected_front_temperature: string;
  expected_rear_temperature: string;
  expected_temperature_unit: string;
};

const normalizeImportHeader = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const IMPORT_HEADER_ALIASES: Record<string, keyof ImportedTrailerRow> = {
  "trailer": "trailer_number",
  "trailer number": "trailer_number",
  "expected front temperature": "expected_front_temperature",
  "front temperature": "expected_front_temperature",
  "expected rear temperature": "expected_rear_temperature",
  "rear temperature": "expected_rear_temperature",
  "temperature unit": "expected_temperature_unit",
};

const parseImportedRows = (rawText: string) => {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [] as ImportedTrailerRow[];
  }

  const looksDelimited = lines[0].includes(",") || lines[0].includes("\t");
  if (!looksDelimited) {
    return lines.map((line) => ({
      trailer_number: normalizeTrailerNumber(line),
      expected_front_temperature: "",
      expected_rear_temperature: "",
      expected_temperature_unit: "C",
    })).filter((row) => Boolean(row.trailer_number));
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const cells = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const header = cells[0];
  const headerMap = new Map<number, keyof ImportedTrailerRow>();

  header.forEach((headerCell, index) => {
    const normalizedHeader = normalizeImportHeader(headerCell);
    const mapped = IMPORT_HEADER_ALIASES[normalizedHeader];
    if (mapped) {
      headerMap.set(index, mapped);
    }
  });

  const hasTrailerColumn = Array.from(headerMap.values()).includes("trailer_number");
  if (!hasTrailerColumn) {
    return [] as ImportedTrailerRow[];
  }

  return cells.slice(1).map((row) => {
    const imported: ImportedTrailerRow = {
      trailer_number: "",
      expected_front_temperature: "",
      expected_rear_temperature: "",
      expected_temperature_unit: "C",
    };

    row.forEach((value, index) => {
      const key = headerMap.get(index);
      if (!key) {
        return;
      }

      imported[key] = value;
    });

    imported.trailer_number = normalizeTrailerNumber(imported.trailer_number);
    imported.expected_temperature_unit = normalizeExpectedTemperatureUnit(imported.expected_temperature_unit || "C");
    return imported;
  }).filter((row) => Boolean(row.trailer_number));
};

const resolveOperatorName = async () => {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) {
    return "TrailerHub User";
  }

  const metadataName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name.trim());

  return metadataName || user.email || user.id || "TrailerHub User";
};

function VesselPlanningPageContent() {
  const params = useParams();
  const router = useRouter();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [operation, setOperation] = useState<VesselOperationRecord | null>(null);
  const [trailers, setTrailers] = useState<DraftTrailer[]>([]);
  const [persistedTrailerIds, setPersistedTrailerIds] = useState<Set<string>>(new Set());
  const [fleetTrailers, setFleetTrailers] = useState<FleetTrailer[]>([]);
  const [newDraft, setNewDraft] = useState<DraftTrailer>(emptyDraft);
  const [importText, setImportText] = useState("");
  const [fleetSearch, setFleetSearch] = useState("");
  const [selectedFleetTrailerId, setSelectedFleetTrailerId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isEditable = operation?.status !== "completed" && operation?.status !== "cancelled";

  useEffect(() => {
    const loadPlanning = async () => {
      if (!operationId) {
        setError("Invalid vessel operation reference.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const [operationResult, trailersResult, fleetResult] = await Promise.all([
          supabase
            .from("vessel_operations")
            .select("id, vessel_name, sailing_reference, origin_port, berth, expected_arrival_at, actual_arrival_at, status, list_status, list_confirmed_at, list_confirmed_by, notes, completed_at, completed_by, final_locked_at, created_at, updated_at")
            .eq("id", operationId)
            .single(),
          supabase
            .from("vessel_operation_trailers")
            .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, ownership_type, trailer_source, external_company, manifest_change_reason, status, arrived_at, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
            .eq("vessel_operation_id", operationId)
            .order("created_at", { ascending: true }),
          supabase
            .from("trailers")
            .select("id, trailer_number, customer, load_description, load_status, departure_date, compound_position, trailer_source, external_company, is_local")
            .is("departure_date", null)
            .order("trailer_number", { ascending: true }),
        ]);

        if (operationResult.error || !operationResult.data) throw operationResult.error ?? new Error("Operation not found.");
        if (trailersResult.error) throw trailersResult.error;
        if (fleetResult.error) throw fleetResult.error;

        setOperation(operationResult.data as VesselOperationRecord);
        const nextTrailers = ((trailersResult.data ?? []) as VesselOperationTrailerRecord[]).map((row) => ({
          clientId: row.id,
          trailer_id: row.trailer_id ?? null,
          trailer_number: row.trailer_number ?? "",
          ownership_type: (row.ownership_type === "company" || row.ownership_type === "outsourcing" || row.ownership_type === "unknown"
            ? row.ownership_type
            : "unknown") as TrailerOwnershipType,
          trailer_source: (row.trailer_source === "company" || row.trailer_source === "outsourced" || row.trailer_source === "local"
            ? row.trailer_source
            : "unknown") as DraftTrailer["trailer_source"],
          external_company: row.external_company ?? "",
          customer: row.customer ?? "",
          booking_reference: row.booking_reference ?? "",
          load_description: row.load_description ?? "",
          expected_front_temperature:
            typeof row.expected_front_temperature === "number"
              ? String(row.expected_front_temperature)
              : parseLegacyFrontExpectedTemperature(row.temperature_required),
          expected_rear_temperature:
            typeof row.expected_rear_temperature === "number"
              ? String(row.expected_rear_temperature)
              : "",
          expected_temperature_unit: normalizeExpectedTemperatureUnit(row.expected_temperature_unit),
          priority_level: (row.priority_level ?? "normal") as VesselPriorityLevel,
          priority_reason: row.priority_reason ?? "",
          planned_destination: row.planned_destination ?? "Compound",
          planning_notes: row.planning_notes ?? "",
          manifest_change_reason: row.manifest_change_reason ?? "",
          status: (row.status ?? "expected") as VesselTrailerStatus,
        }));

        setTrailers(sortVesselOperationTrailersForArrivals(nextTrailers));
        setPersistedTrailerIds(new Set(nextTrailers.map((item) => item.clientId)));
        setFleetTrailers((fleetResult.data ?? []) as FleetTrailer[]);
        setNewDraft(emptyDraft());
      } catch (loadErr) {
        console.error("Unable to load planning data:", loadErr);
        setError("Unable to load planning data.");
      } finally {
        setIsLoading(false);
      }
    };

    void loadPlanning();
  }, [operationId]);

  const filteredFleetTrailers = useMemo(() => {
    const search = normalizeVesselText(fleetSearch);
    if (!search) {
      return fleetTrailers.slice(0, 12);
    }

    return fleetTrailers.filter((item) =>
      [item.trailer_number, item.customer, item.load_description, item.external_company].some((value) =>
        normalizeVesselText(value).includes(search),
      ),
    );
  }, [fleetSearch, fleetTrailers]);

  const summary = useMemo(() => computeVesselOperationSummary(trailers), [trailers]);

  const toValidationInput = (trailer: DraftTrailer): Pick<
    VesselOperationTrailerRecord,
    | "id"
    | "trailer_number"
    | "customer"
    | "priority_level"
    | "planned_destination"
    | "temperature_required"
    | "expected_front_temperature"
    | "expected_rear_temperature"
    | "ownership_type"
    | "external_company"
    | "status"
    | "arrival_status"
  > => {
    const front = parseOptionalTemperatureInput(trailer.expected_front_temperature);
    const rear = parseOptionalTemperatureInput(trailer.expected_rear_temperature);

    return {
      id: trailer.clientId,
      trailer_number: trailer.trailer_number,
      customer: trailer.customer,
      priority_level: trailer.priority_level,
      planned_destination: trailer.planned_destination,
      temperature_required: front.value !== null ? String(front.value) : null,
      expected_front_temperature: front.value,
      expected_rear_temperature: rear.value,
      ownership_type: trailer.ownership_type,
      external_company: trailer.external_company,
      status: trailer.status,
      arrival_status: "expected",
    };
  };

  const trailerPlanningIssues = useMemo(() => {
    const issuesById = new Map<string, string[]>();

    for (const trailer of trailers) {
      const validation = validateTrailerPlanning(toValidationInput(trailer));
      if (validation.issues.length > 0) {
        issuesById.set(
          trailer.clientId,
          validation.issues.map((issue) => issue.message),
        );
      }
    }

    return issuesById;
  }, [trailers]);

  const isLocalSource = (value?: string | null) => normalizeVesselText(value) === "local";

  const applyOwnershipToDraft = (draft: DraftTrailer, requestedOwnership: TrailerOwnershipType): DraftTrailer => {
    const nextOwnership = applyPlanningOwnershipSelection(
      requestedOwnership,
      draft.trailer_source,
      draft.external_company,
    );

    return {
      ...draft,
      ownership_type: nextOwnership.ownershipType,
      trailer_source: nextOwnership.trailerSource,
      external_company: nextOwnership.externalCompany,
    };
  };

  const applyOwnershipForTrailer = (clientId: string, requestedOwnership: TrailerOwnershipType) => {
    setTrailers((current) =>
      sortVesselOperationTrailersForArrivals(
        current.map((item) => {
          if (item.clientId !== clientId) {
            return item;
          }
          return applyOwnershipToDraft(item, requestedOwnership);
        }),
      ),
    );
  };

  const updateDraft = <K extends keyof DraftTrailer>(field: K, value: DraftTrailer[K], clientId: string) => {
    setTrailers((current) =>
      sortVesselOperationTrailersForArrivals(
        current.map((item) => {
          if (item.clientId !== clientId) {
            return item;
          }

          if (field === "ownership_type") {
            return applyOwnershipToDraft(item, value as TrailerOwnershipType);
          }

          if (field === "trailer_source") {
            const requestedSource = value as DraftTrailer["trailer_source"];
            if (requestedSource === "local") {
              return {
                ...item,
                trailer_source: "local",
                ownership_type: "unknown",
                external_company: "",
              };
            }

            const requestedOwnership: TrailerOwnershipType =
              requestedSource === "outsourced"
                ? "outsourcing"
                : (requestedSource === "company" ? "company" : "unknown");
            const canonicalOwnership = applyPlanningOwnershipSelection(
              requestedOwnership,
              requestedSource,
              item.external_company,
            );

            return {
              ...item,
              ownership_type: canonicalOwnership.ownershipType,
              trailer_source: canonicalOwnership.trailerSource,
              external_company: canonicalOwnership.externalCompany,
            };
          }

          return { ...item, [field]: value };
        }),
      ),
    );
  };

  const updateNewDraft = <K extends keyof DraftTrailer>(field: K, value: DraftTrailer[K]) => {
    setNewDraft((current) => ({ ...current, [field]: value }));
  };

  const addNewTrailer = () => {
    const trailerNumber = normalizeTrailerNumber(newDraft.trailer_number);
    if (!trailerNumber) {
      setError("Trailer Number is required.");
      return;
    }

    const normalizedExisting = new Set(trailers.map((item) => normalizeTrailerNumber(item.trailer_number)));
    if (normalizedExisting.has(trailerNumber)) {
      setError(`Trailer ${trailerNumber} is already in this vessel operation.`);
      return;
    }

    const canonicalOwnership = applyPlanningOwnershipSelection(
      newDraft.ownership_type,
      newDraft.trailer_source,
      newDraft.external_company,
    );

    if (canonicalOwnership.ownershipType === "outsourcing" && !canonicalOwnership.externalCompany) {
      setError("Enter external company for outsourcing trailer.");
      return;
    }

    if (canonicalOwnership.ownershipType === "unknown") {
      setError("Select trailer ownership.");
      return;
    }

    const nextTrailer: DraftTrailer = {
      ...newDraft,
      clientId: crypto.randomUUID(),
      trailer_number: trailerNumber,
      ownership_type: canonicalOwnership.ownershipType,
      trailer_source: canonicalOwnership.trailerSource,
      external_company: canonicalOwnership.externalCompany,
      status: "expected",
      planned_destination: newDraft.planned_destination.trim() || "Compound",
    };

    setTrailers((current) => sortVesselOperationTrailersForArrivals([...current, nextTrailer]));
    setNewDraft(emptyDraft());
    setError(null);
  };

  const importTrailers = () => {
    const rows = parseImportedRows(importText);

    if (rows.length === 0) {
      setError("No valid trailer rows found. Add trailer numbers or include a header with Trailer Number.");
      return;
    }

    const existing = new Set(trailers.map((item) => normalizeTrailerNumber(item.trailer_number)));
    const uniqueImported = rows.filter((row, index) => rows.findIndex((candidate) => candidate.trailer_number === row.trailer_number) === index);
    const imported = uniqueImported.filter((row) => !existing.has(row.trailer_number));

    if (imported.length === 0) {
      setError("No new trailer numbers to import.");
      return;
    }

    const nextItems = imported.map((row) => ({
      ...emptyDraft(),
      clientId: crypto.randomUUID(),
      trailer_number: row.trailer_number,
      expected_front_temperature: row.expected_front_temperature,
      expected_rear_temperature: row.expected_rear_temperature,
      expected_temperature_unit: normalizeExpectedTemperatureUnit(row.expected_temperature_unit),
      status: "expected" as VesselTrailerStatus,
    }));

    setTrailers((current) => sortVesselOperationTrailersForArrivals([...current, ...nextItems]));
    setImportText("");
    setError(null);
  };

  const savePlanning = async () => {
    if (!operation || !isEditable) {
      return false;
    }

    const normalizedNumbers = new Set<string>();
    for (const trailer of trailers) {
      const normalized = normalizeTrailerNumber(trailer.trailer_number);
      if (!normalized) {
        setError("Every trailer needs a trailer number.");
        return false;
      }

      if (normalizedNumbers.has(normalized)) {
        setError(`Duplicate trailer number found: ${normalized}`);
        return false;
      }

      if (!trailer.planned_destination.trim()) {
        setError(`${normalized}: planned destination is required.`);
        return false;
      }

      if (trailer.ownership_type === "outsourcing" && !trailer.external_company.trim()) {
        setError(`${normalized}: enter external company for outsourcing trailer.`);
        return false;
      }

      if (trailer.ownership_type === "unknown") {
        setError(`${normalized}: select trailer ownership.`);
        return false;
      }

      const parsedFront = parseOptionalTemperatureInput(trailer.expected_front_temperature);
      if (parsedFront.error) {
        setError(`${normalized}: expected front temperature must be numeric.`);
        return false;
      }

      const parsedRear = parseOptionalTemperatureInput(trailer.expected_rear_temperature);
      if (parsedRear.error) {
        setError(`${normalized}: expected rear temperature must be numeric.`);
        return false;
      }

      normalizedNumbers.add(normalized);
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const nowIso = new Date().toISOString();
      const operatorName = await resolveOperatorName();
      const isPostConfirmation = (operation.list_status ?? "draft") === "confirmed";

      const rowsToPersist = trailers.map((trailer) => {
        const parsedFront = parseOptionalTemperatureInput(trailer.expected_front_temperature);
        const parsedRear = parseOptionalTemperatureInput(trailer.expected_rear_temperature);
        const unit = normalizeExpectedTemperatureUnit(trailer.expected_temperature_unit || "C");
        const canonicalOwnership = applyPlanningOwnershipSelection(
          trailer.ownership_type,
          trailer.trailer_source,
          trailer.external_company,
        );

        return {
          vessel_operation_id: operation.id,
          trailer_id: trailer.trailer_id ?? null,
          trailer_number: normalizeTrailerNumber(trailer.trailer_number),
          ownership_type: canonicalOwnership.ownershipType,
          trailer_source: canonicalOwnership.trailerSource,
          external_company: canonicalOwnership.externalCompany || null,
          customer: trailer.customer.trim() || null,
          booking_reference: trailer.booking_reference.trim() || null,
          load_description: trailer.load_description.trim() || null,
          expected_front_temperature: parsedFront.value,
          expected_rear_temperature: parsedRear.value,
          expected_temperature_unit: unit,
          temperature_required: parsedFront.value !== null ? String(parsedFront.value) : null,
          priority_level: trailer.priority_level,
          priority_reason: trailer.priority_reason.trim() || null,
          planned_destination: trailer.planned_destination.trim() || "Compound",
          planning_notes: trailer.planning_notes.trim() || null,
          manifest_change_reason: trailer.manifest_change_reason.trim() || null,
          status: "expected" as VesselTrailerStatus,
          arrival_status: isPostConfirmation ? "available_for_arrival" : "expected",
          added_after_confirmation: isPostConfirmation,
          added_after_confirmation_at: isPostConfirmation ? nowIso : null,
          added_after_confirmation_by: isPostConfirmation ? operatorName : null,
          created_at: nowIso,
          updated_at: nowIso,
        };
      });

      for (const trailer of trailers) {
        const parsedFront = parseOptionalTemperatureInput(trailer.expected_front_temperature);
        const parsedRear = parseOptionalTemperatureInput(trailer.expected_rear_temperature);
        const unit = normalizeExpectedTemperatureUnit(trailer.expected_temperature_unit || "C");
        const canonicalOwnership = applyPlanningOwnershipSelection(
          trailer.ownership_type,
          trailer.trailer_source,
          trailer.external_company,
        );
        const updatePayload = {
          trailer_id: trailer.trailer_id ?? null,
          trailer_number: normalizeTrailerNumber(trailer.trailer_number),
          ownership_type: canonicalOwnership.ownershipType,
          trailer_source: canonicalOwnership.trailerSource,
          external_company: canonicalOwnership.externalCompany || null,
          customer: trailer.customer.trim() || null,
          booking_reference: trailer.booking_reference.trim() || null,
          load_description: trailer.load_description.trim() || null,
          expected_front_temperature: parsedFront.value,
          expected_rear_temperature: parsedRear.value,
          expected_temperature_unit: unit,
          temperature_required: parsedFront.value !== null ? String(parsedFront.value) : null,
          priority_level: trailer.priority_level,
          priority_reason: trailer.priority_reason.trim() || null,
          planned_destination: trailer.planned_destination.trim() || "Compound",
          planning_notes: trailer.planning_notes.trim() || null,
          manifest_change_reason: trailer.manifest_change_reason.trim() || null,
          updated_at: nowIso,
        };

        if (persistedTrailerIds.has(trailer.clientId)) {
          const { error: updateError } = await supabase
            .from("vessel_operation_trailers")
            .update(updatePayload)
            .eq("id", trailer.clientId)
            .eq("vessel_operation_id", operation.id);

          if (updateError) {
            throw updateError;
          }
          continue;
        }

        const insertPayload = {
          ...updatePayload,
          vessel_operation_id: operation.id,
          status: "expected" as VesselTrailerStatus,
          arrival_status: isPostConfirmation ? "available_for_arrival" : "expected",
          added_after_confirmation: isPostConfirmation,
          added_after_confirmation_at: isPostConfirmation ? nowIso : null,
          added_after_confirmation_by: isPostConfirmation ? operatorName : null,
          created_at: nowIso,
        };

        const { error: insertError } = await supabase
          .from("vessel_operation_trailers")
          .insert(insertPayload);

        if (insertError) {
          throw insertError;
        }
      }

      for (const trailer of rowsToPersist) {
        const eventPayload = {
          trailer_id: trailer.trailer_id,
          trailer_number: trailer.trailer_number,
          event_type: trailer.priority_level === "priority" ? "vessel_priority_planned" : "vessel_trailer_planned",
          event_description:
            trailer.priority_level === "priority"
              ? `Priority trailer planned for ${trailer.planned_destination}.`
              : `Trailer planned for ${trailer.planned_destination}.`,
          old_value: null,
          new_value: trailer as unknown as Json,
        };

        const { error: eventError } = await supabase.from("trailer_events").insert(eventPayload);
        if (eventError) {
          console.error("Failed to create planning event:", eventError);
        }
      }

      setSuccess("Planning saved successfully.");
      router.refresh();
      const { data: reloadedTrailers } = await supabase
        .from("vessel_operation_trailers")
        .select("id, vessel_operation_id, trailer_id, trailer_number, customer, booking_reference, load_status, load_description, temperature_required, expected_front_temperature, expected_rear_temperature, expected_temperature_unit, priority_level, priority_reason, planned_destination, planning_notes, ownership_type, trailer_source, external_company, manifest_change_reason, status, arrived_at, arrival_confirmed_by, inspection_started_at, inspection_completed_at, position_assigned_at, assigned_position, has_damage, has_temperature_alert, created_at, updated_at")
        .eq("vessel_operation_id", operation.id)
        .order("created_at", { ascending: true });

      const mappedReload = ((reloadedTrailers ?? []) as VesselOperationTrailerRecord[]).map((row) => ({
        clientId: row.id,
        trailer_id: row.trailer_id ?? null,
        trailer_number: row.trailer_number ?? "",
        ownership_type: (row.ownership_type === "company" || row.ownership_type === "outsourcing" || row.ownership_type === "unknown"
          ? row.ownership_type
          : "unknown") as TrailerOwnershipType,
        trailer_source: (row.trailer_source === "company" || row.trailer_source === "outsourced" || row.trailer_source === "local"
          ? row.trailer_source
          : "unknown") as DraftTrailer["trailer_source"],
        external_company: row.external_company ?? "",
        customer: row.customer ?? "",
        booking_reference: row.booking_reference ?? "",
        load_description: row.load_description ?? "",
        expected_front_temperature:
          typeof row.expected_front_temperature === "number"
            ? String(row.expected_front_temperature)
            : parseLegacyFrontExpectedTemperature(row.temperature_required),
        expected_rear_temperature:
          typeof row.expected_rear_temperature === "number"
            ? String(row.expected_rear_temperature)
            : "",
        expected_temperature_unit: normalizeExpectedTemperatureUnit(row.expected_temperature_unit),
        priority_level: (row.priority_level ?? "normal") as VesselPriorityLevel,
        priority_reason: row.priority_reason ?? "",
        planned_destination: row.planned_destination ?? "Compound",
        planning_notes: row.planning_notes ?? "",
        manifest_change_reason: row.manifest_change_reason ?? "",
        status: (row.status ?? "expected") as VesselTrailerStatus,
      }));

      setTrailers(sortVesselOperationTrailersForArrivals(mappedReload));
      setPersistedTrailerIds(new Set(mappedReload.map((item) => item.clientId)));
      return true;
    } catch (saveErr) {
      console.error("Unable to save planning:", saveErr);
      setError("Unable to save planning.");
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const startArrivals = async () => {
    if (!operation) {
      return;
    }

    const saved = await savePlanning();
    if (!saved) {
      return;
    }

    if ((operation.list_status ?? "draft") !== "confirmed") {
      setSuccess("Planning saved. Confirm the vessel list before arrivals.");
      router.push(`/dashboard/vessel-operations/${operation.id}`);
      return;
    }

    router.push(`/dashboard/vessel-operations/${operation.id}/arrivals`);
  };

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading planning data...</div>
      </main>
    );
  }

  if (!operation) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">{error ?? "Vessel operation not found."}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Planning</h1>
              <p className="mt-2 text-sm text-slate-300 sm:text-base">
                {operation.vessel_name ?? "Unnamed vessel"} - Expected {toOperationDateTime(operation)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/vessel-operations/${operation.id}/arrivals`} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
                Arrivals
              </Link>
              <button
                type="button"
                disabled={!isEditable || isSaving}
                onClick={() => void savePlanning()}
                className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save Planning"}
              </button>
              <button
                type="button"
                disabled={!isEditable || isSaving}
                onClick={() => void startArrivals()}
                className="rounded-2xl border border-amber-500/30 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Continue To Arrivals
              </button>
            </div>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{success}</div> : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Vessel</p><p className="mt-2 text-lg font-semibold text-white">{operation.vessel_name ?? "-"}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</p><p className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getVesselOperationStatusClass(operation.status)}`}>{getVesselOperationStatusLabel(operation.status)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Trailer Count</p><p className="mt-2 text-lg font-semibold text-white">{summary.expected}</p></div>
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Priority Pending</p><p className="mt-2 text-lg font-semibold text-rose-200">{summary.priorityRemaining}</p></div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Add Trailer</p>
              <p className="mt-2 text-sm text-slate-300">Create the expected trailer list before the ferry arrives.</p>
            </div>
            {!isEditable ? (
              <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">Planning is read-only after final completion.</p>
            ) : null}
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-200">Trailer Number *</label>
                  <input
                    value={newDraft.trailer_number}
                    onChange={(event) => updateNewDraft("trailer_number", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="PRO810"
                    disabled={!isEditable}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Ownership *</label>
                  <select
                    value={newDraft.ownership_type}
                    onChange={(event) => {
                      setNewDraft((current) =>
                        applyOwnershipToDraft(current, event.target.value as TrailerOwnershipType),
                      );
                    }}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    disabled={!isEditable}
                  >
                    <option value="company">Company Trailer</option>
                    <option value="outsourcing">Outsourcing Trailer</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Source</label>
                  <select
                    value={newDraft.trailer_source}
                    onChange={(event) => {
                      const source = event.target.value as DraftTrailer["trailer_source"];
                      if (source === "local") {
                        setNewDraft((current) => ({
                          ...current,
                          trailer_source: "local",
                          ownership_type: "unknown",
                          external_company: "",
                        }));
                        return;
                      }

                      setNewDraft((current) => {
                        const requestedOwnership: TrailerOwnershipType =
                          source === "outsourced" ? "outsourcing" : (source === "company" ? "company" : "unknown");
                        const canonicalOwnership = applyPlanningOwnershipSelection(
                          requestedOwnership,
                          source,
                          current.external_company,
                        );
                        return {
                          ...current,
                          ownership_type: canonicalOwnership.ownershipType,
                          trailer_source: canonicalOwnership.trailerSource,
                          external_company: canonicalOwnership.externalCompany,
                        };
                      });
                    }}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    disabled={!isEditable}
                  >
                    <option value="unknown">Unknown</option>
                    <option value="company">Company Fleet</option>
                    <option value="outsourced">Outsourcing</option>
                    <option value="local">Local Trailer</option>
                  </select>
                </div>

                <div className="md:col-span-2" hidden={newDraft.ownership_type !== "outsourcing"}>
                  <label className="mb-2 block text-sm font-medium text-slate-200">External Company / Supplier *</label>
                  <input
                    value={newDraft.external_company}
                    onChange={(event) => updateNewDraft("external_company", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    disabled={!isEditable}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Customer</label>
                  <input value={newDraft.customer} onChange={(event) => updateNewDraft("customer", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Booking Reference</label>
                  <input value={newDraft.booking_reference} onChange={(event) => updateNewDraft("booking_reference", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-200">Load Description</label>
                  <input value={newDraft.load_description} onChange={(event) => updateNewDraft("load_description", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Expected Front Temperature</label>
                  <input
                    value={newDraft.expected_front_temperature}
                    onChange={(event) => updateNewDraft("expected_front_temperature", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="Optional"
                    disabled={!isEditable}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Expected Rear Temperature</label>
                  <input
                    value={newDraft.expected_rear_temperature}
                    onChange={(event) => updateNewDraft("expected_rear_temperature", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="Optional"
                    disabled={!isEditable}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Temperature Unit</label>
                  <select
                    value={newDraft.expected_temperature_unit}
                    onChange={(event) => updateNewDraft("expected_temperature_unit", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    disabled={!isEditable}
                  >
                    <option value="C">Celsius (C)</option>
                    <option value="F">Fahrenheit (F)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Priority</label>
                  <select value={newDraft.priority_level} onChange={(event) => updateNewDraft("priority_level", event.target.value as VesselPriorityLevel)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable}>
                    <option value="priority">Priority</option>
                    <option value="normal">Normal</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Priority Reason</label>
                  <input value={newDraft.priority_reason} onChange={(event) => updateNewDraft("priority_reason", event.target.value)} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-200">Planned Destination</label>
                  <input
                    list="planned-destinations"
                    value={newDraft.planned_destination}
                    onChange={(event) => updateNewDraft("planned_destination", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    disabled={!isEditable}
                  />
                  <datalist id="planned-destinations">
                    {PLANNED_DESTINATION_SUGGESTIONS.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-200">Planning Notes</label>
                  <textarea value={newDraft.planning_notes} onChange={(event) => updateNewDraft("planning_notes", event.target.value)} rows={3} className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!isEditable} />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-slate-200">Manifest Change Reason</label>
                  <input
                    value={newDraft.manifest_change_reason}
                    onChange={(event) => updateNewDraft("manifest_change_reason", event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    disabled={!isEditable}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => void addNewTrailer()} disabled={!isEditable} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
                  Add Trailer
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <label className="mb-2 block text-sm font-medium text-slate-200">Import Trailer Numbers</label>
              <textarea
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                rows={8}
                placeholder={"PRO810\nPFC102\n\nOr CSV header:\nTrailer Number,Expected Front Temperature,Expected Rear Temperature,Temperature Unit"}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                disabled={!isEditable}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={importTrailers} disabled={!isEditable} className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60">
                  Import Trailers
                </button>
              </div>

              <div className="mt-4">
                <label className="mb-2 block text-sm font-medium text-slate-200">Existing Trailer Search</label>
                <input
                  value={fleetSearch}
                  onChange={(event) => setFleetSearch(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  placeholder="Search company, outsourcing, local, or supplier trailers"
                  disabled={!isEditable}
                />

                <div className="mt-3 max-h-72 overflow-auto rounded-2xl border border-white/10 bg-slate-950/60">
                  {filteredFleetTrailers.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">No trailers match this search.</p>
                  ) : (
                    filteredFleetTrailers.map((fleetTrailer) => (
                      <button
                        key={fleetTrailer.id}
                        type="button"
                        onClick={() => {
                          setSelectedFleetTrailerId(fleetTrailer.id);
                          setNewDraft((current) => {
                            const sourceHint: DraftTrailer["trailer_source"] = fleetTrailer.is_local
                              ? "local"
                              : (fleetTrailer.trailer_source === "outsourced" ? "outsourced" : "company");
                            const requestedOwnership: TrailerOwnershipType =
                              sourceHint === "outsourced" ? "outsourcing" : (sourceHint === "company" ? "company" : "unknown");
                            const canonicalOwnership = applyPlanningOwnershipSelection(
                              requestedOwnership,
                              sourceHint,
                              fleetTrailer.external_company ?? current.external_company,
                            );

                            return {
                              ...current,
                              trailer_id: fleetTrailer.id,
                              trailer_number: fleetTrailer.trailer_number ?? current.trailer_number,
                              ownership_type: canonicalOwnership.ownershipType,
                              trailer_source: canonicalOwnership.trailerSource,
                              external_company: canonicalOwnership.externalCompany,
                              customer: fleetTrailer.customer ?? current.customer,
                              load_description: fleetTrailer.load_description ?? current.load_description,
                            };
                          });
                        }}
                        className={`w-full border-b border-white/5 px-4 py-3 text-left text-sm hover:bg-white/5 ${selectedFleetTrailerId === fleetTrailer.id ? "bg-cyan-500/10 text-cyan-100" : "text-slate-200"}`}
                      >
                        {fleetTrailer.trailer_number ?? "-"}
                        <span className="ml-2 text-xs text-slate-400">{fleetTrailer.customer ?? "No customer"}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Expected Trailers</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Planning list</h2>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Expected</p><p className="text-lg font-bold text-white">{summary.expected}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Priority</p><p className="text-lg font-bold text-rose-200">{summary.priority}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Inspected</p><p className="text-lg font-bold text-emerald-200">{summary.inspected}</p></div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-center"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Pending</p><p className="text-lg font-bold text-cyan-200">{summary.pendingInspection}</p></div>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
            {trailers.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">No trailers planned yet.</p>
            ) : (
              trailers.map((trailer) => (
                <article key={trailer.clientId} className="rounded-3xl border border-white/10 bg-slate-950/70 p-4">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-2 xl:min-w-[260px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xl font-semibold text-white">{trailer.trailer_number || "Trailer Number"}</p>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>{getVesselPriorityLabel(trailer.priority_level)}</span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselTrailerStatusClass(trailer.status)}`}>{getVesselTrailerStatusLabel(trailer.status)}</span>
                        {isLocalSource(trailer.trailer_source) ? (
                          <span className="rounded-full border border-amber-400/50 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">Local Trailer</span>
                        ) : null}
                      </div>
                      <p className="text-sm text-slate-300">Planned Destination: {trailer.planned_destination || "-"}</p>
                      <p className="text-sm text-slate-300">Ownership: {trailer.ownership_type}</p>
                      <p className="text-sm text-slate-300">Source: {trailer.trailer_source}</p>
                      <p className="text-sm text-slate-300">Customer: {trailer.customer || "-"}</p>
                      {trailer.ownership_type === "outsourcing" ? <p className="text-sm text-slate-300">External Company: {trailer.external_company || "-"}</p> : null}
                      <p className="text-sm text-slate-300">Booking Reference: {trailer.booking_reference || "-"}</p>
                    </div>

                    <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <input value={trailer.trailer_number} onChange={(event) => updateDraft("trailer_number", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Trailer Number" />
                      <select value={trailer.ownership_type} onChange={(event) => applyOwnershipForTrailer(trailer.clientId, event.target.value as TrailerOwnershipType)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable || isLocalSource(trailer.trailer_source)}>
                        <option value="company">Company Trailer</option>
                        <option value="outsourcing">Outsourcing Trailer</option>
                        <option value="unknown">Unknown</option>
                      </select>
                      <select value={trailer.trailer_source} onChange={(event) => updateDraft("trailer_source", event.target.value as DraftTrailer["trailer_source"], trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable}>
                        <option value="unknown">Source: Unknown</option>
                        <option value="company">Source: Company Fleet</option>
                        <option value="outsourced">Source: Outsourcing</option>
                        <option value="local">Source: Local Trailer</option>
                      </select>
                      <input value={trailer.external_company} onChange={(event) => updateDraft("external_company", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable || trailer.ownership_type !== "outsourcing" || isLocalSource(trailer.trailer_source)} placeholder="External Company" hidden={trailer.ownership_type !== "outsourcing" || isLocalSource(trailer.trailer_source)} />
                      <input value={trailer.customer} onChange={(event) => updateDraft("customer", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Customer" />
                      <input value={trailer.booking_reference} onChange={(event) => updateDraft("booking_reference", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Booking Reference" />
                      <input value={trailer.load_description} onChange={(event) => updateDraft("load_description", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Load Description" />
                      <input value={trailer.expected_front_temperature} onChange={(event) => updateDraft("expected_front_temperature", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Expected Front Temp" />
                      <input value={trailer.expected_rear_temperature} onChange={(event) => updateDraft("expected_rear_temperature", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Expected Rear Temp" />
                      <select value={trailer.expected_temperature_unit} onChange={(event) => updateDraft("expected_temperature_unit", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable}>
                        <option value="C">Celsius (C)</option>
                        <option value="F">Fahrenheit (F)</option>
                      </select>
                      <select value={trailer.priority_level} onChange={(event) => updateDraft("priority_level", event.target.value as VesselPriorityLevel, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable}>
                        <option value="priority">Priority</option>
                        <option value="normal">Normal</option>
                      </select>
                      <input value={trailer.priority_reason} onChange={(event) => updateDraft("priority_reason", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Priority Reason" />
                      <input list="planned-destinations" value={trailer.planned_destination} onChange={(event) => updateDraft("planned_destination", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Planned Destination" />
                      <input value={trailer.manifest_change_reason} onChange={(event) => updateDraft("manifest_change_reason", event.target.value, trailer.clientId)} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none" disabled={!isEditable} placeholder="Manifest Change Reason" />
                      <textarea value={trailer.planning_notes} onChange={(event) => updateDraft("planning_notes", event.target.value, trailer.clientId)} rows={2} className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm outline-none md:col-span-2 xl:col-span-3" disabled={!isEditable} placeholder="Planning Notes" />
                    </div>
                  </div>
                  {(trailerPlanningIssues.get(trailer.clientId) ?? []).length > 0 ? (
                    <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                      {(trailerPlanningIssues.get(trailer.clientId) ?? []).join(" ")}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function VesselPlanningPage() {
  return <VesselPlanningPageContent />;
}
