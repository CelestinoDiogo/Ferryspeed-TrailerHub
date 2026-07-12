"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { parseDateParam } from "@/lib/calendar-utils";

type TrailerOption = {
  id: string;
  trailer_number: string;
  customer?: string | null;
  consignee?: string | null;
};

type FormValues = {
  trailer_id: string;
  delivery_date: string;
  delivery_time: string;
  customer: string;
  consignee: string;
  delivery_location: string;
  booking_reference: string;
  escort_required: boolean;
  status: string;
  notes: string;
};

const initialValues: FormValues = {
  trailer_id: "",
  delivery_date: "",
  delivery_time: "",
  customer: "",
  consignee: "",
  delivery_location: "",
  booking_reference: "",
  escort_required: false,
  status: "scheduled",
  notes: "",
};

const statuses = [
  "scheduled",
  "ready",
  "on_delivery",
  "delivered",
  "waiting_collection",
  "collected",
  "cancelled",
];

const statusLabel = (status: string) => {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

function NewDeliveryForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillDate = parseDateParam(searchParams.get("date"));
  const [trailers, setTrailers] = useState<TrailerOption[]>([]);
  const [values, setValues] = useState<FormValues>(() => ({
    ...initialValues,
    delivery_date: prefillDate ?? "",
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadTrailers = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: supabaseError } = await supabase
          .from("trailers")
          .select("id, trailer_number, customer, consignee")
          .is("departure_date", null)
          .order("trailer_number", { ascending: true });

        if (supabaseError) throw supabaseError;

        setTrailers((data ?? []) as TrailerOption[]);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unable to load trailers.";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadTrailers();
  }, []);

  const handleChange = (field: keyof FormValues, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    // Clear validation error for this field when user starts typing
    if (validation[field]) {
      setValidation((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleTrailerChange = (trailerId: string) => {
    const trailer = trailers.find((t) => t.id === trailerId);
    setValues((prev) => ({
      ...prev,
      trailer_id: trailerId,
      customer: trailer?.customer ?? prev.customer,
      consignee: trailer?.consignee ?? prev.consignee,
    }));
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!values.trailer_id.trim()) {
      errors.trailer_id = "Please select a trailer.";
    }

    if (!values.delivery_date.trim()) {
      errors.delivery_date = "Please select a delivery date.";
    }

    setValidation(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;

    setIsSaving(true);
    setError(null);

    try {
      const trailer = trailers.find((t) => t.id === values.trailer_id);

      const { error: insertError } = await supabase
        .from("delivery_bookings")
        .insert({
          trailer_id: values.trailer_id,
          delivery_date: values.delivery_date,
          delivery_time: values.delivery_time || null,
          customer: values.customer.trim() || null,
          consignee: values.consignee.trim() || null,
          delivery_location: values.delivery_location.trim() || null,
          booking_reference: values.booking_reference.trim() || null,
          escort_required: values.escort_required,
          status: values.status,
          notes: values.notes.trim() || null,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;

      // Create trailer event
      const eventDescription = `Delivery booking created for ${values.delivery_date}${values.delivery_time ? " at " + values.delivery_time : ""}.`;
      const { error: eventError } = await supabase
        .from("trailer_events")
        .insert({
          trailer_id: values.trailer_id,
          trailer_number: trailer?.trailer_number || "Unknown",
          event_type: "delivery_booking_created",
          event_description: eventDescription,
          old_value: null,
          new_value: {
            delivery_date: values.delivery_date,
            delivery_time: values.delivery_time,
            customer: values.customer,
            status: values.status,
          },
        });

      if (eventError) {
        console.error("Event creation failed:", {
          message: eventError.message,
          details: eventError.details,
          hint: eventError.hint,
          code: eventError.code,
        });
        // Don't fail the booking creation if event insertion fails
      }

      router.push("/dashboard/deliveries?saved=1");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to create delivery booking.";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-2xl shadow-black/20 backdrop-blur sm:p-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
              Ferryspeed TrailerHub
            </p>
            <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
              New Delivery Booking
            </h1>
            <p className="mt-2 text-sm text-slate-300 sm:text-base">
              Create a new delivery booking to schedule a trailer delivery.
            </p>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
          {isLoading ? (
            <p className="text-slate-400">Loading trailers...</p>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-200">
                  Trailer <span className="text-rose-400">*</span>
                </label>
                <select
                  value={values.trailer_id}
                  onChange={(e) => handleTrailerChange(e.target.value)}
                  className={`w-full rounded-2xl border bg-slate-950/80 px-4 py-3 text-sm outline-none ${
                    validation.trailer_id
                      ? "border-rose-500/50"
                      : "border-white/10"
                  }`}
                >
                  <option value="">Select a trailer...</option>
                  {trailers.map((trailer) => (
                    <option key={trailer.id} value={trailer.id}>
                      {trailer.trailer_number}
                    </option>
                  ))}
                </select>
                {validation.trailer_id ? (
                  <p className="mt-1 text-xs text-rose-200">{validation.trailer_id}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    Delivery Date <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={values.delivery_date}
                    onChange={(e) => handleChange("delivery_date", e.target.value)}
                    className={`w-full rounded-2xl border bg-slate-950/80 px-4 py-3 text-sm outline-none ${
                      validation.delivery_date
                        ? "border-rose-500/50"
                        : "border-white/10"
                    }`}
                  />
                  {validation.delivery_date ? (
                    <p className="mt-1 text-xs text-rose-200">
                      {validation.delivery_date}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    Delivery Time
                  </label>
                  <input
                    type="time"
                    value={values.delivery_time}
                    onChange={(e) => handleChange("delivery_time", e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    Customer
                  </label>
                  <input
                    type="text"
                    value={values.customer}
                    onChange={(e) => handleChange("customer", e.target.value)}
                    placeholder="Customer name"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    Consignee
                  </label>
                  <input
                    type="text"
                    value={values.consignee}
                    onChange={(e) => handleChange("consignee", e.target.value)}
                    placeholder="Consignee name"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-200">
                  Delivery Location
                </label>
                <input
                  type="text"
                  value={values.delivery_location}
                  onChange={(e) => handleChange("delivery_location", e.target.value)}
                  placeholder="Delivery address or location"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    Booking Reference
                  </label>
                  <input
                    type="text"
                    value={values.booking_reference}
                    onChange={(e) => handleChange("booking_reference", e.target.value)}
                    placeholder="Reference code"
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    Status
                  </label>
                  <select
                    value={values.status}
                    onChange={(e) => handleChange("status", e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                <input
                  type="checkbox"
                  id="escort_required"
                  checked={values.escort_required}
                  onChange={(e) => handleChange("escort_required", e.target.checked)}
                  className="h-5 w-5 cursor-pointer rounded border-white/20 bg-slate-800"
                />
                <label
                  htmlFor="escort_required"
                  className="cursor-pointer text-sm font-semibold text-slate-200"
                >
                  Escort Required
                </label>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-200">
                  Notes
                </label>
                <textarea
                  value={values.notes}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  placeholder="Additional notes..."
                  className="min-h-28 w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 rounded-2xl bg-cyan-500 px-5 py-3 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                >
                  {isSaving ? "Creating..." : "Create Delivery Booking"}
                </button>

                <Link
                  href="/dashboard/deliveries"
                  className="rounded-2xl border border-white/10 bg-slate-800 px-5 py-3 font-semibold text-white hover:bg-slate-700"
                >
                  Cancel
                </Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function NewDeliveryPage() {
  return (
    <Suspense fallback={null}>
      <NewDeliveryForm />
    </Suspense>
  );
}
