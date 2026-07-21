import {
  formatVesselDateTime,
  getVesselPriorityClass,
  getVesselPriorityLabel,
  getVesselInspectionProgressLabel,
  getVesselInspectionProgressState,
  getVesselTrailerStatusClass,
  getVesselTrailerStatusLabel,
  normalizeExpectedTemperatureUnit,
  resolveExpectedFrontTemperature,
  resolveExpectedRearTemperature,
  type VesselOperationTrailerRecord,
} from "@/lib/vessel-operations";
import Link from "next/link";

type VesselTrailerListProps = {
  sortedTrailers: VesselOperationTrailerRecord[];
  operationStatus: "draft" | "confirmed" | "completed";
  editable: boolean;
  isReadOnly: boolean;
  actioningTrailerId: string | null;
  onTogglePriority: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onRemoveTrailer: (trailer: VesselOperationTrailerRecord) => Promise<void>;
  onMarkArrived: (trailer: VesselOperationTrailerRecord) => Promise<void>;
};

export function VesselTrailerList({
  sortedTrailers,
  operationStatus,
  editable,
  isReadOnly,
  actioningTrailerId,
  onTogglePriority,
  onRemoveTrailer,
  onMarkArrived,
}: VesselTrailerListProps) {
  return (
    <section className="space-y-3">
      {sortedTrailers.length === 0 ? (
        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-300">No trailers have been added to this vessel operation yet.</div>
      ) : (
        sortedTrailers.map((trailer) => {
          const expectedFront = resolveExpectedFrontTemperature(trailer);
          const expectedRear = resolveExpectedRearTemperature(trailer);
          const expectedUnit = normalizeExpectedTemperatureUnit(trailer.expected_temperature_unit);
          const canMarkArrived = operationStatus === "confirmed" && trailer.status === "expected";
          const canOpenInspection = operationStatus !== "draft" && trailer.arrival_status !== "cancelled" && trailer.arrival_status !== "not_discharged";
          const inspectionState = getVesselInspectionProgressState(trailer);
          const inspectionLabel = getVesselInspectionProgressLabel(inspectionState);

          return (
            <article key={trailer.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-4 shadow-lg shadow-black/20 backdrop-blur sm:p-5">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-white">
                        {trailer.trailer_id ? (
                          <Link href={`/dashboard/trailers/${trailer.trailer_id}`} className="underline decoration-cyan-400/60 underline-offset-2 hover:text-cyan-200">
                            {trailer.trailer_number ?? "-"}
                          </Link>
                        ) : (
                          trailer.trailer_number ?? "-"
                        )}
                      </h2>
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
                      <p>Inspection Progress: {inspectionLabel}</p>
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

                    {canOpenInspection ? (
                      <Link
                        href={`/dashboard/vessel-operations/${trailer.vessel_operation_id}/boat-check/${trailer.id}`}
                        className="rounded-2xl bg-cyan-500 px-4 py-3 text-center text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                      >
                        Open Inspection
                      </Link>
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
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}
