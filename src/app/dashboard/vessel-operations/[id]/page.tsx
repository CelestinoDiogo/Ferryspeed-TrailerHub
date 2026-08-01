"use client";

import { useParams } from "next/navigation";
import { AddVesselTrailerForm } from "./components/add-vessel-trailer-form";
import { BulkAddVesselTrailers } from "./components/bulk-add-vessel-trailers";
import { VesselListControl } from "./components/vessel-list-control";
import { VesselOperationDetails } from "./components/vessel-operation-details";
import { VesselOperationHeader } from "./components/vessel-operation-header";
import { VesselOperationSummary } from "./components/vessel-operation-summary";
import { VesselTrailerList } from "./components/vessel-trailer-list";
import { SuccessToast } from "@/components/common/success-toast";
import { useVesselOperation } from "./hooks/use-vessel-operation";

function VesselOperationDetailsPageContent() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const {
    operation,
    operationStatus,
    workflowStep,
    sortedTrailers,
    summary,
    completionSummary,
    planningReadiness,
    completionReadiness,
    editable,
    isReadOnly,
    isLoading,
    isSaving,
    isCompleting,
    actioningTrailerId,
    error,
    success,
    dismissSuccess,
    formState,
    bulkText,
    setBulkText,
    handleFieldChange,
    handleAddSingleTrailer,
    handleBulkAdd,
    handleTogglePriority,
    handleRemoveTrailer,
    handleConfirmList,
    handleMarkArrived,
    handleMarkCancelled,
    handleMarkNoShow,
    handleUndoCancelled,
    handleUndoNoShow,
    handleCompleteOperation,
  } = useVesselOperation(operationId);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_32%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Loading vessel operation...</div>
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
        <VesselOperationHeader operation={operation} workflowStep={workflowStep} />

        {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
        {success ? <SuccessToast message={success} onClose={dismissSuccess} /> : null}

        <VesselOperationSummary operation={operation} summary={summary} completionSummary={completionSummary} operationStatus={operationStatus} />

        <VesselListControl
          operation={operation}
          operationStatus={operationStatus}
          isChangingListState={isSaving}
          isSaving={isSaving}
          trailersCount={sortedTrailers.length}
          planningReadiness={planningReadiness}
          onConfirmList={handleConfirmList}
        />

        {operationStatus !== "completed" ? (
          <section className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-5 shadow-lg shadow-black/20 backdrop-blur sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-200">Complete Discharge and Checks</p>
                <p className="mt-1 text-sm text-emerald-100">Finalize only when every active trailer is arrived/not discharged and all arrived trailers have checks completed. Cancelled and no-show trailers are terminal outcomes.</p>
              </div>
              <button
                type="button"
                onClick={() => void handleCompleteOperation()}
                disabled={isCompleting || isSaving || operationStatus !== "confirmed" || !completionReadiness.canComplete}
                className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
              >
                {isCompleting ? "Completing..." : "Complete Discharge and Checks"}
              </button>
            </div>

            {!completionReadiness.canComplete && completionReadiness.blockers.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                <p className="font-semibold">Completion blocked by required tasks:</p>
                <p className="mt-1">{completionReadiness.blockers[0].trailerNumber}: {completionReadiness.blockers[0].reason}</p>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <VesselOperationDetails operation={operation} />
          {!isReadOnly ? (
            <AddVesselTrailerForm
              editable={editable}
              isSaving={isSaving}
              formState={formState}
              onFieldChange={handleFieldChange}
              onAddTrailer={handleAddSingleTrailer}
            />
          ) : null}
        </section>

        {!isReadOnly ? (
          <BulkAddVesselTrailers
            editable={editable}
            isSaving={isSaving}
            bulkText={bulkText}
            setBulkText={setBulkText}
            onBulkAdd={handleBulkAdd}
          />
        ) : null}

        <VesselTrailerList
          sortedTrailers={sortedTrailers}
          operationStatus={operationStatus}
          editable={editable}
          isReadOnly={isReadOnly}
          actioningTrailerId={actioningTrailerId}
          onTogglePriority={handleTogglePriority}
          onRemoveTrailer={handleRemoveTrailer}
          onMarkArrived={handleMarkArrived}
          onMarkCancelled={handleMarkCancelled}
          onMarkNoShow={handleMarkNoShow}
          onUndoCancelled={handleUndoCancelled}
          onUndoNoShow={handleUndoNoShow}
        />
      </div>
    </main>
  );
}

export default function VesselOperationDetailsPage() {
  return <VesselOperationDetailsPageContent />;
}
