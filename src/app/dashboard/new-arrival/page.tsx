"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { supabase } from "@/lib/supabase";

const arrivalSchema = z.object({
  trailerNumber: z.string().trim().min(1, "Trailer Number is required"),
  externalCompany: z.string().trim().optional(),
  externalReference: z.string().trim().optional(),
  trailerType: z.string().min(1, "Select a trailer type"),
  loadStatus: z.enum(["Empty", "Loaded"]),
  loadDescription: z.string().trim().optional(),
  customer: z.string().trim().optional(),
  consignee: z.string().trim().optional(),
  containerNumber: z.string().trim().optional(),
  compoundPosition: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

type ArrivalFormValues = z.infer<typeof arrivalSchema>;

type TrailerInsert = {
  trailer_number: string;
  trailer_type: string;
  load_status: ArrivalFormValues["loadStatus"];
  load_description: string | null;
  customer: string | null;
  consignee: string | null;
  container_number: string | null;
  compound_position: string | null;
  notes: string | null;
  arrival_date: string;
  trailer_source: "company" | "outsourced";
  external_company: string | null;
  external_reference: string | null;
  is_local: boolean;
};

type TrailerSource = "company" | "outsourced";

type CompanyTrailerOption = {
  id: string;
  trailer_number: string;
  prefix: string | null;
  numeric_part: number | null;
  trailer_type: string | null;
  active: boolean | null;
};

type VesselTrailerPrefill = {
  trailer_number?: string | null;
  customer?: string | null;
  load_description?: string | null;
  trailer_id?: string | null;
};

const trailerTypes = ["Dry Van", "Reefer", "Flatbed", "Tank", "Container"];

const normalizeCompoundPosition = (value?: string | null) => {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(P|A)?0*(\d{1,2})$/);
  if (!match) {
    return null;
  }

  const numericValue = Number(match[2]);
  if (numericValue < 1 || numericValue > 50) {
    return null;
  }

  return `P${numericValue.toString().padStart(2, "0")}`;
};

const getCompoundPositionState = async () => {
  const [{ data: trailerData, error: trailerError }, { data: availablePosition, error: positionError }] = await Promise.all([
    supabase
      .from("trailers")
      .select("compound_position")
      .is("departure_date", null)
      .neq("is_local", true),
    (supabase as any).rpc("get_first_available_compound_position"),
  ]);

  if (trailerError) {
    throw trailerError;
  }

  if (positionError) {
    throw positionError;
  }

  const occupiedPositions = new Set<string>();
  (trailerData ?? []).forEach((item) => {
    const normalizedPosition = normalizeCompoundPosition(item.compound_position);
    if (normalizedPosition) {
      occupiedPositions.add(normalizedPosition);
    }
  });

  return {
    occupiedPositions,
    availablePosition: typeof availablePosition === "string" ? availablePosition : null,
  };
};

function NewArrivalPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [assignedPosition, setAssignedPosition] = useState<string | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [trailerSource, setTrailerSource] = useState<TrailerSource>("company");
  const [isLocal, setIsLocal] = useState(false);
  const [companyTrailers, setCompanyTrailers] = useState<CompanyTrailerOption[]>([]);
  const [companyTrailerError, setCompanyTrailerError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedCompanyTrailer, setSelectedCompanyTrailer] = useState<CompanyTrailerOption | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ArrivalFormValues>({
    resolver: zodResolver(arrivalSchema),
    defaultValues: {
      trailerType: "Dry Van",
      loadStatus: "Empty",
      externalCompany: "",
      externalReference: "",
    },
  });

  useEffect(() => {
    const vesselTrailerId = searchParams.get("vesselTrailerId");

    if (!vesselTrailerId) {
      return;
    }

    const loadVesselTrailer = async () => {
      try {
        const { data, error } = await supabase
          .from("vessel_operation_trailers")
          .select("trailer_number, customer, load_description, trailer_id")
          .eq("id", vesselTrailerId)
          .single();

        if (error) {
          throw error;
        }

        const vesselTrailer = data as VesselTrailerPrefill;
        if (vesselTrailer.trailer_number?.trim()) {
          setValue("trailerNumber", vesselTrailer.trailer_number.trim(), { shouldDirty: true, shouldValidate: true });
        }

        if (vesselTrailer.customer?.trim()) {
          setValue("customer", vesselTrailer.customer.trim(), { shouldDirty: true, shouldValidate: true });
        }

        if (vesselTrailer.load_description?.trim()) {
          setValue("loadDescription", vesselTrailer.load_description.trim(), { shouldDirty: true, shouldValidate: true });
        }

        setTrailerSource("company");
        setShowSuggestions(false);
      } catch (prefillError) {
        const message = prefillError instanceof Error ? prefillError.message : "Unable to prefill vessel trailer.";
        setCompanyTrailerError(message);
      }
    };

    void loadVesselTrailer();
  }, [searchParams, setValue]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const trailerNumberValue = watch("trailerNumber") ?? "";

  useEffect(() => {
    if (trailerSource === "outsourced") {
      setSelectedCompanyTrailer(null);
      setShowSuggestions(false);
    } else {
      setValue("externalCompany", "", { shouldDirty: true });
      setValue("externalReference", "", { shouldDirty: true });
      clearErrors("externalCompany");
    }
  }, [clearErrors, setValue, trailerSource]);

  useEffect(() => {
    if (!isLocal) {
      return;
    }

    setValue("compoundPosition", "", { shouldDirty: true });
    setPositionError(null);
  }, [isLocal, setValue]);

  useEffect(() => {
    const loadAssignedPosition = async () => {
      try {
        const { availablePosition } = await getCompoundPositionState();
        setAssignedPosition(availablePosition ?? null);
        setValue("compoundPosition", "");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load compound availability.";
        setPositionError(message);
      }
    };

    void loadAssignedPosition();
  }, [setValue]);

  useEffect(() => {
    const loadCompanyTrailers = async () => {
      try {
        const { data, error } = await supabase
          .from("company_trailers")
          .select("id, trailer_number, prefix, numeric_part, trailer_type, active")
          .eq("active", true)
          .order("trailer_number", { ascending: true });

        if (error) {
          throw error;
        }

        setCompanyTrailers((data ?? []) as CompanyTrailerOption[]);
        setCompanyTrailerError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load company trailer master list.";
        setCompanyTrailerError(message);
      }
    };

    void loadCompanyTrailers();
  }, []);

  useEffect(() => {
    if (trailerSource !== "company") {
      return;
    }

    if (!trailerNumberValue?.trim()) {
      setSelectedCompanyTrailer(null);
      return;
    }

    const normalizedSearch = trailerNumberValue.trim().toLowerCase();
    const exactMatch = companyTrailers.find(
      (trailer) => trailer.trailer_number.trim().toLowerCase() === normalizedSearch,
    );

    if (exactMatch) {
      setSelectedCompanyTrailer(exactMatch);
      if (exactMatch.trailer_type?.trim()) {
        setValue("trailerType", exactMatch.trailer_type.trim(), { shouldDirty: true, shouldValidate: true });
      }
    } else {
      setSelectedCompanyTrailer(null);
    }
  }, [companyTrailers, setValue, trailerNumberValue, trailerSource]);

  const filteredCompanyTrailers = trailerNumberValue.trim()
    ? companyTrailers.filter((trailer) => {
        const search = trailerNumberValue.trim().toLowerCase();
        const searchFields = [trailer.trailer_number, trailer.prefix, trailer.numeric_part?.toString()]
          .filter(Boolean)
          .map((value) => value?.toLowerCase());

        return searchFields.some((value) => value?.includes(search));
      })
    : companyTrailers.slice(0, 8);

  const handleTrailerSelect = (trailer: CompanyTrailerOption) => {
    setValue("trailerNumber", trailer.trailer_number, { shouldDirty: true, shouldValidate: true });
    clearErrors("trailerNumber");
    setSelectedCompanyTrailer(trailer);
    setShowSuggestions(false);

    if (trailer.trailer_type?.trim()) {
      setValue("trailerType", trailer.trailer_type.trim(), { shouldDirty: true, shouldValidate: true });
    }
  };

  const onSubmit = async (values: ArrivalFormValues) => {
    const arrivalDate = new Date().toISOString().split("T")[0];

    setPositionError(null);

    const normalizedTrailerNumber = values.trailerNumber.trim();
    const matchedTrailer = companyTrailers.find(
      (trailer) => trailer.trailer_number.trim().toLowerCase() === normalizedTrailerNumber.toLowerCase(),
    );

    if (trailerSource === "company" && !matchedTrailer) {
      const message = "Please select a trailer number from the company trailer master list.";
      setError("trailerNumber", { type: "manual", message });
      window.alert(message);
      return;
    }

    if (trailerSource === "outsourced") {
      if (!normalizedTrailerNumber) {
        const message = "Trailer Number is required for outsourced trailers.";
        setError("trailerNumber", { type: "manual", message });
        window.alert(message);
        return;
      }

      if (!values.externalCompany?.trim()) {
        const message = "Transport Company is required for outsourced trailers.";
        setError("externalCompany", { type: "manual", message });
        window.alert(message);
        return;
      }
    }

    try {
      let finalPosition: string | null = null;
      let addToWaitingQueue = false;

      if (!isLocal) {
        const { occupiedPositions, availablePosition } = await getCompoundPositionState();
        const manualPosition = values.compoundPosition?.trim();

        if (manualPosition) {
          const normalizedManualPosition = normalizeCompoundPosition(manualPosition);
          if (!normalizedManualPosition) {
            const message = "Please select a valid compound position from P01 to P50.";
            setPositionError(message);
            window.alert(message);
            return;
          }

          if (occupiedPositions.has(normalizedManualPosition)) {
            const message = `Position ${normalizedManualPosition} is already occupied.`;
            setPositionError(message);
            window.alert(message);
            return;
          }

          finalPosition = normalizedManualPosition;
        } else {
          finalPosition = availablePosition ?? null;
        }

        if (!finalPosition) {
          addToWaitingQueue = true;
        }
      }

      const payload: TrailerInsert = {
        trailer_number:
          trailerSource === "company"
            ? (matchedTrailer?.trailer_number ?? normalizedTrailerNumber).trim()
            : normalizedTrailerNumber.toUpperCase(),
        trailer_type: values.trailerType,
        load_status: values.loadStatus,
        load_description: values.loadDescription?.trim() || null,
        customer: values.customer?.trim() || null,
        consignee: values.consignee?.trim() || null,
        container_number: values.containerNumber?.trim() || null,
        compound_position: isLocal ? null : finalPosition,
        notes: values.notes?.trim() || null,
        arrival_date: arrivalDate,
        trailer_source: trailerSource,
        external_company: trailerSource === "outsourced" ? values.externalCompany?.trim() || null : null,
        external_reference: trailerSource === "outsourced" ? values.externalReference?.trim() || null : null,
        is_local: isLocal,
      };

      const { data, error } = await supabase.from("trailers").insert([payload]).select().single();

      if (error) {
        const message = error.message || "Unable to save arrival.";
        window.alert(message);
        return;
      }

      if (!data) {
        window.alert("The insert completed without returning a saved row.");
        return;
      }

      if (addToWaitingQueue) {
        const { error: waitingError } = await (supabase as any).rpc("add_trailer_to_compound_waiting", {
          p_trailer_id: data.id,
          p_trailer_number: data.trailer_number,
          p_customer: payload.customer,
          p_load_status: payload.load_status,
          p_priority_level: "normal",
          p_priority_reason: null,
          p_waiting_reason: "compound_full",
          p_arrived_at: new Date().toISOString(),
          p_vessel_operation_id: null,
          p_vessel_trailer_id: searchParams.get("vesselTrailerId"),
          p_notes: payload.notes,
        });

        if (waitingError) {
          window.alert(waitingError.message || "Arrival saved, but the trailer could not be added to Waiting for Compound.");
          return;
        }
      }

      const eventDescription = isLocal
        ? "Local trailer arrival registered."
        : trailerSource === "outsourced"
          ? "Outsourced trailer arrival registered."
          : "Ferryspeed fleet trailer arrival registered.";

      const { error: eventError } = await supabase.from("trailer_events").insert({
        trailer_id: data.id,
        trailer_number: data.trailer_number,
        event_type: "arrival_registered",
        event_description: eventDescription,
        new_value: {
          trailer_source: payload.trailer_source,
          external_company: payload.external_company,
          external_reference: payload.external_reference,
          is_local: payload.is_local,
          compound_position: payload.compound_position,
          load_status: payload.load_status,
        },
      });

      if (eventError) {
        console.error("Failed to save trailer arrival event:", eventError);
      }

      reset();
      setTrailerSource("company");
      setIsLocal(false);

      if (addToWaitingQueue) {
        window.alert("Compound is full. Trailer added to Waiting for Compound.");
        router.push("/dashboard/compound/waiting");
        return;
      }

      router.push("/dashboard?saved=1");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save arrival.";
      window.alert(message);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">New Arrival</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">
            Register a new trailer arrival quickly and keep the compound updated.
          </p>
        </header>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-black/20 backdrop-blur sm:p-6"
        >
          <section className="mb-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-sm font-semibold text-white">Trailer Ownership</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTrailerSource("company")}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  trailerSource === "company"
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                Ferryspeed Fleet
              </button>
              <button
                type="button"
                onClick={() => setTrailerSource("outsourced")}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  trailerSource === "outsourced"
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                Outsourced / External
              </button>
            </div>
          </section>

          <section className="mb-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <p className="text-sm font-semibold text-white">Trailer Location</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setIsLocal(false)}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  !isLocal
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                Compound Trailer
              </button>
              <button
                type="button"
                onClick={() => setIsLocal(true)}
                className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                  isLocal
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
              >
                Local Trailer
              </button>
            </div>
            {isLocal ? (
              <p className="mt-3 text-sm text-indigo-200">
                Local trailers do not occupy a compound position and are excluded from compound occupancy.
              </p>
            ) : null}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-200">Trailer Number</label>
              <div className="relative">
                <input
                  {...register("trailerNumber")}
                  value={trailerNumberValue}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setValue("trailerNumber", nextValue, { shouldDirty: true, shouldValidate: true });
                    clearErrors("trailerNumber");
                    if (trailerSource === "company") {
                      setSelectedCompanyTrailer(null);
                      setShowSuggestions(true);
                    }
                  }}
                  onFocus={() => {
                    if (trailerSource === "company") {
                      setShowSuggestions(true);
                    }
                  }}
                  onBlur={() => {
                    if (trailerSource === "company") {
                      window.setTimeout(() => setShowSuggestions(false), 120);
                    }
                  }}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none ring-0"
                  placeholder={trailerSource === "company" ? "Search company trailers" : "Enter trailer number"}
                  autoComplete="off"
                />

                {trailerSource === "company" && showSuggestions && filteredCompanyTrailers.length > 0 ? (
                  <div className="absolute z-20 mt-2 max-h-56 w-full overflow-auto rounded-2xl border border-white/10 bg-slate-950/95 shadow-xl shadow-black/30">
                    {filteredCompanyTrailers.map((trailer) => {
                      const label = [trailer.trailer_number, trailer.prefix ? `• ${trailer.prefix}` : null]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <button
                          key={trailer.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-slate-800"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleTrailerSelect(trailer)}
                        >
                          <span>
                            <span className="font-medium text-white">{label}</span>
                            {trailer.trailer_type ? <span className="ml-2 text-slate-400">{trailer.trailer_type}</span> : null}
                          </span>
                          <span className="text-xs uppercase tracking-[0.28em] text-cyan-400">Select</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {companyTrailerError ? <p className="mt-2 text-sm text-amber-400">{companyTrailerError}</p> : null}
              {errors.trailerNumber ? <p className="mt-2 text-sm text-rose-400">{errors.trailerNumber.message}</p> : null}
              {trailerSource === "company" && selectedCompanyTrailer ? (
                <p className="mt-2 text-sm text-emerald-400">Selected from company master list.</p>
              ) : null}
            </div>

            {trailerSource === "outsourced" ? (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">Transport Company *</label>
                  <input
                    {...register("externalCompany")}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="External transport company"
                  />
                  {errors.externalCompany ? <p className="mt-2 text-sm text-rose-400">{errors.externalCompany.message}</p> : null}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-200">External Reference</label>
                  <input
                    {...register("externalReference")}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                    placeholder="Optional"
                  />
                </div>
              </>
            ) : null}

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Trailer Type</label>
              <select
                {...register("trailerType")}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              >
                {trailerTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              {errors.trailerType ? <p className="mt-2 text-sm text-rose-400">{errors.trailerType.message}</p> : null}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Load Status</label>
              <select
                {...register("loadStatus")}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              >
                <option value="Empty">Empty</option>
                <option value="Loaded">Loaded</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-200">Load Description</label>
              <input
                {...register("loadDescription")}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Describe the load"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Customer</label>
              <input
                {...register("customer")}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Customer name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Consignee</label>
              <input
                {...register("consignee")}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Consignee name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Container Number</label>
              <input
                {...register("containerNumber")}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Optional"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Compound Position</label>
              <div className="space-y-2">
                <input
                  value={isLocal ? "Local trailer" : assignedPosition ?? "Loading..."}
                  readOnly
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-300 outline-none"
                />
                <select
                  {...register("compoundPosition")}
                  disabled={isLocal}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                >
                  <option value="">Use auto-assigned position</option>
                  {Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`).map((position) => (
                    <option key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </select>
              </div>
              {!isLocal && positionError ? <p className="mt-2 text-sm text-rose-400">{positionError}</p> : null}
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-200">Notes</label>
              <textarea
                {...register("notes")}
                rows={4}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                placeholder="Additional delivery notes"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Arrival Date</label>
              <input
                value={new Date().toISOString().split("T")[0]}
                readOnly
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-400 outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-200">Arrival Time</label>
              <input
                value={new Date().toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
                readOnly
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-400 outline-none"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 text-sm font-medium text-slate-200 transition hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Saving..." : "Save Arrival"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function NewArrivalPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950 p-6 text-slate-200">Loading New Arrival...</div>}>
      <NewArrivalPageContent />
    </Suspense>
  );
}