"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getLocalDateInputValue,
  getLocalDateTimeInputValue,
  logVesselSupabaseError,
} from "@/lib/vessel-operations";

type FormState = {
  vesselName: string;
  voyageReference: string;
  port: string;
  berth: string;
  expectedArrivalDate: string;
  expectedArrivalTime: string;
  actualArrivalDate: string;
  actualArrivalTime: string;
  notes: string;
};

const initialState: FormState = {
  vesselName: "",
  voyageReference: "",
  port: "",
  berth: "",
  expectedArrivalDate: getLocalDateInputValue(),
  expectedArrivalTime: getLocalDateTimeInputValue().slice(11, 16),
  actualArrivalDate: "",
  actualArrivalTime: "",
  notes: "",
};

const toIsoFromLocal = (date: string, time: string) => {
  if (!date.trim()) {
    return null;
  }

  const safeTime = time || "00:00";
  const value = new Date(`${date}T${safeTime}:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
};

const toOptionalIsoFromLocal = (date: string, time: string) => {
  if (!date.trim()) {
    return null;
  }

  return toIsoFromLocal(date, time);
};

export default function NewVesselOperationPage() {
  const router = useRouter();
  const [formState, setFormState] = useState<FormState>(initialState);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setFormState((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    if (!formState.vesselName.trim() || !formState.expectedArrivalDate.trim()) {
      setError("Vessel Name and Expected Arrival Date are required.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const expectedArrivalAt = toIsoFromLocal(formState.expectedArrivalDate, formState.expectedArrivalTime);
      const actualArrivalAt = toOptionalIsoFromLocal(formState.actualArrivalDate, formState.actualArrivalTime);

      if (!expectedArrivalAt) {
        setError("Expected Arrival Date/Time is invalid.");
        return;
      }

      const { data, error: insertError } = await supabase
        .from("vessel_operations")
        .insert({
          vessel_name: formState.vesselName.trim(),
          sailing_reference: formState.voyageReference.trim() || null,
          origin_port: formState.port.trim() || null,
          berth: formState.berth.trim() || null,
          expected_arrival_at: expectedArrivalAt,
          actual_arrival_at: actualArrivalAt,
          status: "planning",
          list_status: "draft",
          list_confirmed_at: null,
          list_confirmed_by: null,
          notes: formState.notes.trim() || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (insertError || !data) {
        console.error("Create vessel operation Supabase error details", {
          error: insertError,
          message: insertError?.message,
          details: insertError?.details,
          hint: insertError?.hint,
          code: insertError?.code,
          name: insertError?.name,
          status: (insertError as { status?: number } | null)?.status,
        });
        logVesselSupabaseError("Create vessel operation failed", insertError);
        throw insertError ?? new Error("Unable to create vessel operation.");
      }

      router.push(`/dashboard/vessel-operations/${data.id}`);
    } catch (saveErr) {
      console.error("Unable to save vessel operation:", saveErr);
      setError("Unable to save vessel operation.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">New Vessel Operation</h1>
          <p className="mt-2 text-sm text-slate-300 sm:text-base">Create a ferry operation before the vessel arrives.</p>
        </header>

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-semibold text-slate-200">Vessel Name *</label>
              <input
                value={formState.vesselName}
                onChange={(event) => handleChange("vesselName", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Voyage / Reference</label>
              <input
                value={formState.voyageReference}
                onChange={(event) => handleChange("voyageReference", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Port</label>
              <input
                value={formState.port}
                onChange={(event) => handleChange("port", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Berth</label>
              <input
                value={formState.berth}
                onChange={(event) => handleChange("berth", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Expected Arrival Date *</label>
              <input
                type="date"
                value={formState.expectedArrivalDate}
                onChange={(event) => handleChange("expectedArrivalDate", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Expected Arrival Time</label>
              <input
                type="time"
                value={formState.expectedArrivalTime}
                onChange={(event) => handleChange("expectedArrivalTime", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Actual Arrival Date</label>
              <input
                type="date"
                value={formState.actualArrivalDate}
                onChange={(event) => handleChange("actualArrivalDate", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-200">Actual Arrival Time</label>
              <input
                type="time"
                value={formState.actualArrivalTime}
                onChange={(event) => handleChange("actualArrivalTime", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-semibold text-slate-200">Notes</label>
              <textarea
                rows={4}
                value={formState.notes}
                onChange={(event) => handleChange("notes", event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/dashboard/vessel-operations" className="rounded-2xl border border-white/10 bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Create Vessel Operation"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
