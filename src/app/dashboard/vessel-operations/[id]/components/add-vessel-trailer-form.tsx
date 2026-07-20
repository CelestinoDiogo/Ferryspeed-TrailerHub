import type { VesselPriorityLevel } from "@/lib/vessel-operations";
import type { TrailerFormState } from "../hooks/use-vessel-operation";

type AddVesselTrailerFormProps = {
  editable: boolean;
  isSaving: boolean;
  formState: TrailerFormState;
  onFieldChange: <K extends keyof TrailerFormState>(field: K, value: TrailerFormState[K]) => void;
  onAddTrailer: () => Promise<void>;
};

export function AddVesselTrailerForm({
  editable,
  isSaving,
  formState,
  onFieldChange,
  onAddTrailer,
}: AddVesselTrailerFormProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Add Trailer</p>
      {!editable ? <p className="mt-2 text-sm text-amber-200">List is confirmed or completed. Trailer editing is locked.</p> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <input value={formState.trailerNumber} onChange={(event) => onFieldChange("trailerNumber", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Trailer Number *" disabled={!editable} />
        <input value={formState.customer} onChange={(event) => onFieldChange("customer", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Customer" disabled={!editable} />
        <input value={formState.bookingReference} onChange={(event) => onFieldChange("bookingReference", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Booking Reference" disabled={!editable} />
        <input value={formState.loadStatus} onChange={(event) => onFieldChange("loadStatus", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Load Status" disabled={!editable} />
        <input value={formState.expectedFrontTemperature} onChange={(event) => onFieldChange("expectedFrontTemperature", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Expected Front Temperature" disabled={!editable} />
        <input value={formState.expectedRearTemperature} onChange={(event) => onFieldChange("expectedRearTemperature", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Expected Rear Temperature" disabled={!editable} />
        <select value={formState.expectedTemperatureUnit} onChange={(event) => onFieldChange("expectedTemperatureUnit", event.target.value)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!editable}>
          <option value="C">Celsius (C)</option>
          <option value="F">Fahrenheit (F)</option>
        </select>
        <select value={formState.priorityLevel} onChange={(event) => onFieldChange("priorityLevel", event.target.value as VesselPriorityLevel)} className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" disabled={!editable}>
          <option value="normal">No Priority</option>
          <option value="priority">Priority</option>
        </select>
        <textarea value={formState.notes} onChange={(event) => onFieldChange("notes", event.target.value)} rows={3} className="md:col-span-2 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm outline-none" placeholder="Notes" disabled={!editable} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void onAddTrailer()} disabled={isSaving || !editable} className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
          {isSaving ? "Saving..." : "Add Trailer"}
        </button>
      </div>
    </div>
  );
}
