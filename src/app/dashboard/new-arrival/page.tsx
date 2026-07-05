"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { supabase } from "@/lib/supabase";

const arrivalSchema = z.object({
  trailerNumber: z.string().trim().min(1, "Trailer Number is required"),
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
  arrival_time: string;
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
  const { data, error } = await supabase
    .from("trailers")
    .select("compound_position")
    .is("departure_date", null);

  if (error) {
    throw error;
  }

  const occupiedPositions = new Set<string>();
  (data ?? []).forEach((item) => {
    const normalizedPosition = normalizeCompoundPosition(item.compound_position);
    if (normalizedPosition) {
      occupiedPositions.add(normalizedPosition);
    }
  });

  const availablePosition = Array.from({ length: 50 }, (_, index) => `P${String(index + 1).padStart(2, "0")}`).find(
    (position) => !occupiedPositions.has(position),
  );

  return { occupiedPositions, availablePosition };
};

export default function NewArrivalPage() {
  const router = useRouter();
  const [assignedPosition, setAssignedPosition] = useState<string | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ArrivalFormValues>({
    resolver: zodResolver(arrivalSchema),
    defaultValues: {
      trailerType: "Dry Van",
      loadStatus: "Empty",
    },
  });

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

  const onSubmit = async (values: ArrivalFormValues) => {
    const arrivalDate = new Date().toISOString().split("T")[0];
    const arrivalTime = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    setPositionError(null);

    try {
      const { occupiedPositions, availablePosition } = await getCompoundPositionState();
      const manualPosition = values.compoundPosition?.trim();
      let finalPosition: string | null = null;

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
        const message = "Compound is full.";
        setPositionError(message);
        window.alert(message);
        return;
      }

      const payload: TrailerInsert = {
        trailer_number: values.trailerNumber,
        trailer_type: values.trailerType,
        load_status: values.loadStatus,
        load_description: values.loadDescription?.trim() || null,
        customer: values.customer?.trim() || null,
        consignee: values.consignee?.trim() || null,
        container_number: values.containerNumber?.trim() || null,
        compound_position: finalPosition,
        notes: values.notes?.trim() || null,
        arrival_date: arrivalDate,
        arrival_time: arrivalTime,
      };

      console.log("Insert payload", payload);

      const { data, error } = await supabase.from("trailers").insert([payload]).select().single();

      console.log("Insert result", { data, error });

      if (error) {
        const message = error.message || "Unable to save arrival.";
        window.alert(message);
        return;
      }

      if (!data) {
        window.alert("The insert completed without returning a saved row.");
        return;
      }

      reset();
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-200">Trailer Number</label>
              <input
                {...register("trailerNumber")}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none ring-0"
                placeholder="e.g. TR-1042"
              />
              {errors.trailerNumber && <p className="mt-2 text-sm text-rose-400">{errors.trailerNumber.message}</p>}
            </div>

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
              {errors.trailerType && <p className="mt-2 text-sm text-rose-400">{errors.trailerType.message}</p>}
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
                  value={assignedPosition ?? "Loading..."}
                  readOnly
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-300 outline-none"
                />
                <select
                  {...register("compoundPosition")}
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
              {positionError ? <p className="mt-2 text-sm text-rose-400">{positionError}</p> : null}
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
