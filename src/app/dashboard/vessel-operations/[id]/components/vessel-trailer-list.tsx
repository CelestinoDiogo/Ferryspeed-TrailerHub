import {
  formatVesselDateTime,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselTrailerStatusClass,
  getVesselTrailerStatusLabel,
  normalizeExpectedTemperatureUnit,
  resolveExpectedFrontTemperature,
  resolveExpectedRearTemperature,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";
import type { TrailerInspectionState } from "../hooks/use-vessel-operation";

type VesselTrailerListProps = {
  sortedTrailers: VesselOperationTrailerRecord[];
  operationStatus: "draft" | "confirmed" | "completed";
  editable: boolean;
  isReadOnly: boolean;
  actioningTrailerId: string | null;
  getInspectionState: (trailerId: string) => TrailerInspectionState;
  onInspectionFieldChange: <K extends keyof TrailerInspectionState>(trailerId: string, field: K, value: TrailerInspectionState[K]) => void;
  onTogglePriority: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onRemoveTrailer: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onMarkArrived: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onSaveInspection: (trailer: VesselOperationTrailerRecord) => Promise<void>;
};

export function VesselTrailerList({
  sortedTrailers,
  operationStatus,
  editable,
  isReadOnly,
  actioningTrailerId,
  getInspectionState,
  onInspectionFieldChange,
  onTogglePriority,
  onRemoveTrailer,
  onMarkArrived,
  onSaveInspection,
}: VesselTrailerListProps) {
  return (
    <section className="space-y-3">
      {sortedTrailers.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">No trailers have been added to this vessel operation yet.</div>
      ) : (
        sortedTrailers.map((trailer) => {
          const inspection = getInspectionState(trailer.id);
          const expectedFront = resolveExpectedFrontTemperature(trailer);
          const expectedRear = resolveExpectedRearTemperature(trailer);
          const expectedUnit = normalizeExpectedTemperatureUnit(trailer.expected_temperature_unit);
          const canMarkArrived = operationStatus === "confirmed" && trailer.status === "expected";
          const canInspect = operationStatus === "confirmed" && (trailer.status === "arrived" || trailer.status === "inspected");

          return (
            <article key={trailer.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-white">{trailer.trailer_number ?? "-"}</h2>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselPriorityClass(trailer.priority_level)}`}>
                        {getVesselPriorityLabel(trailer.priority_level)}
                      </span>
                      <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getVesselTrailerStatusClass(trailer.status)}`}>
                        {getVesselTrailerStatusLabel(trailer.status)}
                      </span>
                    </div>
                    <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4">
                      <p>Customer: {trailer.customer ?? "-"}</p>
                      <p>Booking Ref: {trailer.booking_reference ?? "-"}</p>
                      <p>Load Status: {trailer.load_status ?? "-"}</p>
                      <p>Expected Front Temp: {expectedFront === null ? "-" : `${expectedFront} ${expectedUnit}`}</p>
                      <p>Expected Rear Temp: {expectedRear === null ? "-" : `${expectedRear} ${expectedUnit}`}</p>
                      <p>Arrival: {formatVesselDateTime(trailer.arrival_confirmed_at ?? trailer.arrived_at)}</p>
                      <p>Damage: {trailer.has_damage ? "Yes" : "No"}</p>
                      <p>Temp Alert: {trailer.has_temperature_alert ? "Yes" : "No"}</p>
                      <p>Notes: {trailer.planning_notes?.trim() || "-"}</p>
                    </div>
                  </div>

                  <div className="flex w-full flex-col gap-2 lg:w-60">
                    {canMarkArrived ? (
                      <button
                        type="button"
                        onClick={() => void onMarkArrived(trailer)}
                        disabled={actioningTrailerId === trailer.id}
                        className="rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                      >
                        Arrived
                      </button>
                    ) : null}

                    {editable ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void onTogglePriority(trailer)}
                          disabled={actioningTrailerId === trailer.id}
                          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-60"
                        >
                          {trailer.priority_level === "priority" ? "Set No Priority" : "Set Priority"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onRemoveTrailer(trailer)}
                          disabled={actioningTrailerId === trailer.id}
                          className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-200 hover:bg-rose-500/20 disabled:opacity-60"
                        >
                          Remove Trailer
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {canInspect ? (
                  <details className="rounded-2xl border border-white/10 bg-slate-950/60 p-4" open={trailer.status === "arrived"}>
                    <summary className="cursor-pointer text-sm font-semibold text-cyan-100">Boat Check</summary>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="text-sm text-slate-200">
                        Overall Condition
                        <select
                          value={inspection.overallCondition}
                          onChange={(event) => onInspectionFieldChange(trailer.id, "overallCondition", event.target.value as "good" | "attention_required")}
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                          disabled={isReadOnly || actioningTrailerId === trailer.id}
                        >
                          <option value="good">Good</option>
                          <option value="attention_required">Attention Required</option>
                        </select>
                      </label>

                      <label className="text-sm text-slate-200">
                        Damage
                        <select
                          value={inspection.damage}
                          onChange={(event) => onInspectionFieldChange(trailer.id, "damage", event.target.value as "yes" | "no")}
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                          disabled={isReadOnly || actioningTrailerId === trailer.id}
                        >
                          <option value="no">No</option>
                          <option value="yes">Yes</option>
                        </select>
                      </label>

                      <label className="text-sm text-slate-200">
                        Actual Front Temperature ({expectedUnit})
                        <input
                          type="number"
                          value={inspection.frontTemperature}
                          onChange={(event) => onInspectionFieldChange(trailer.id, "frontTemperature", event.target.value)}
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                          disabled={isReadOnly || actioningTrailerId === trailer.id}
                        />
                      </label>

                      <label className="text-sm text-slate-200">
                        Actual Rear Temperature ({expectedUnit})
                        <input
                          type="number"
                          value={inspection.rearTemperature}
                          onChange={(event) => onInspectionFieldChange(trailer.id, "rearTemperature", event.target.value)}
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                          disabled={isReadOnly || actioningTrailerId === trailer.id}
                        />
                      </label>

                      {inspection.damage === "yes" ? (
                        <>
                          <label className="text-sm text-slate-200">
                            Damage Type
                            <input
                              value={inspection.damageType}
                              onChange={(event) => onInspectionFieldChange(trailer.id, "damageType", event.target.value)}
                              className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                              disabled={isReadOnly || actioningTrailerId === trailer.id}
                            />
                          </label>
                          <label className="text-sm text-slate-200">
                            Damage Location
                            <input
                              value={inspection.damageLocation}
                              onChange={(event) => onInspectionFieldChange(trailer.id, "damageLocation", event.target.value)}
                              className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                              disabled={isReadOnly || actioningTrailerId === trailer.id}
                            />
                          </label>
                          <label className="text-sm text-slate-200 sm:col-span-2">
                            Damage Description
                            <textarea
                              rows={2}
                              value={inspection.damageDescription}
                              onChange={(event) => onInspectionFieldChange(trailer.id, "damageDescription", event.target.value)}
                              className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                              disabled={isReadOnly || actioningTrailerId === trailer.id}
                            />
                          </label>
                        </>
                      ) : null}

                      <label className="text-sm text-slate-200 sm:col-span-2">
                        Notes
                        <textarea
                          rows={2}
                          value={inspection.notes}
                          onChange={(event) => onInspectionFieldChange(trailer.id, "notes", event.target.value)}
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                          disabled={isReadOnly || actioningTrailerId === trailer.id}
                        />
                      </label>

                      <label className="text-sm text-slate-200 sm:col-span-2">
                        Photos
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => onInspectionFieldChange(trailer.id, "photos", Array.from(event.target.files ?? []))}
                          className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-sm"
                          disabled={isReadOnly || actioningTrailerId === trailer.id}
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void onSaveInspection(trailer)}
                        disabled={isReadOnly || actioningTrailerId === trailer.id}
                        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
                      >
                        Save Boat Check
                      </button>
                    </div>
                  </details>
                ) : null}
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
