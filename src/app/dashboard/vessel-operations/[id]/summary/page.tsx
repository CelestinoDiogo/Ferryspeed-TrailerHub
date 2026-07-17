"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getVesselOperationReport } from "@/lib/vessel-report";
import { buildDeterministicVesselOperationAiReportDraft } from "@/lib/reports/vessel-operation-ai-report-shared";
import { formatVesselDateTime } from "@/lib/vessel-operations";
import type { VesselOperationalReportData, VesselOperationAiReportDraft, VesselOperationAiReportResponse } from "@/lib/reports/types";
import { VesselOperationAiReportPreviewModal } from "@/components/reports/vessel-operation-ai-report-preview-modal";

type SummaryFilter = "all" | "arrived" | "inspected" | "damage" | "temperature_alert" | "not_discharged";

const FILTER_OPTIONS: Array<{ value: SummaryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "arrived", label: "Arrived" },
  { value: "inspected", label: "Inspected" },
  { value: "damage", label: "Damage" },
  { value: "temperature_alert", label: "Temperature Alert" },
  { value: "not_discharged", label: "Not Discharged" },
];

const formatStatusLabel = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatTemperatureValue = (value: number | null, unit: string) => {
  return value === null ? "-" : `${value} ${unit}`;
};

export default function VesselSummaryPage() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [reportData, setReportData] = useState<VesselOperationalReportData | null>(null);
  const [aiReportDraft, setAiReportDraft] = useState<VesselOperationAiReportDraft | null>(null);
  const [activeFilter, setActiveFilter] = useState<SummaryFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isAiReportGenerating, setIsAiReportGenerating] = useState(false);
  const [isAiReportPreviewOpen, setIsAiReportPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!operationId) {
      setError("Invalid vessel operation id.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setErrorDetails(null);

    try {
      const report = await getVesselOperationReport(supabase, operationId);
      setReportData(report);
    } catch (loadErr) {
      console.error("Unable to load vessel summary report:", loadErr);
      setError("Unable to load Vessel Operation Report.");
      setErrorDetails(loadErr instanceof Error ? loadErr.message : "Unknown error.");
    } finally {
      setIsLoading(false);
    }
  }, [operationId]);

  const getAuthHeaders = useCallback(async (): Promise<HeadersInit | undefined> => {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) {
      return undefined;
    }

    return { Authorization: `Bearer ${accessToken}` };
  }, [supabase]);

  useEffect(() => {
    if (!reportData || reportData.operation.status !== "completed") {
      setAiReportDraft(null);
      return;
    }

    setAiReportDraft((current) => {
      if (current?.generationMode === "ai") {
        return current;
      }

      return buildDeterministicVesselOperationAiReportDraft(reportData);
    });
  }, [reportData]);

  const generateAiReport = useCallback(async () => {
    if (!operationId || !reportData || reportData.operation.status !== "completed") {
      return;
    }

    setIsAiReportGenerating(true);
    setReportNotice(null);

    try {
      const authHeaders = await getAuthHeaders();
      const response = await fetch(`/api/vessel-operations/${operationId}/ai-report`, {
        method: "POST",
        headers: authHeaders,
      });

      const payload = (await response.json()) as VesselOperationAiReportResponse & { error?: string };
      if (!response.ok || !payload.reportDraft) {
        throw new Error(payload.error || "Unable to generate AI report.");
      }

      setAiReportDraft(payload.reportDraft);
      setIsAiReportPreviewOpen(true);
      setReportNotice(payload.message ?? (payload.usedFallback ? "Template-generated report created from live data." : "AI report generated successfully."));
    } catch (generateErr) {
      console.error("Unable to generate AI report:", generateErr);
      setReportNotice(generateErr instanceof Error ? generateErr.message : "Unable to generate AI report.");
    } finally {
      setIsAiReportGenerating(false);
    }
  }, [aiReportDraft?.reportId, getAuthHeaders, operationId, reportData]);

  const handleCopyAiReport = useCallback(async () => {
    if (!aiReportDraft) {
      return;
    }

    await navigator.clipboard.writeText(`${aiReportDraft.subject}\n\n${aiReportDraft.body}`);
    setReportNotice("Report copied to clipboard.");
  }, [aiReportDraft]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadReport();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadReport]);

  const filteredTrailers = useMemo(() => {
    if (!reportData) {
      return [];
    }

    return reportData.trailers.filter((trailer) => {
      switch (activeFilter) {
        case "arrived":
          return trailer.arrivalStatusRaw === "arrived";
        case "inspected":
          return trailer.inspectionStatus === "inspected";
        case "damage":
          return trailer.hasDamage;
        case "temperature_alert":
          return trailer.hasTemperatureAlert;
        case "not_discharged":
          return trailer.arrivalStatusRaw === "not_discharged";
        case "all":
        default:
          return true;
      }
    });
  }, [activeFilter, reportData]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">Loading vessel report...</div>
      </main>
    );
  }

  if (!reportData) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-rose-700">Ferryspeed TrailerHub</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">Unable to load Vessel Operation Report.</h1>
          <p className="mt-3 text-sm text-rose-700">{error ?? "Unable to load Vessel Operation Report."}</p>
          {errorDetails ? <p className="mt-2 text-sm text-slate-600">{errorDetails}</p> : null}
        </div>
      </main>
    );
  }

  const { operation, statistics } = reportData;
  const completed = operation.status === "completed";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-700">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">Vessel Operation Summary</h1>
              <p className="mt-2 text-sm text-slate-600">Read-only operation report with inspection, damage, temperature, and photo detail.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/dashboard/vessel-operations/${operation.id}`} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">Back to Operation</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/boat-check`} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">Boat Check</Link>
              <Link href={`/dashboard/vessel-operations/${operation.id}/print`} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Print Report</Link>
              {completed ? (
                <button
                  type="button"
                  onClick={() => void generateAiReport()}
                  disabled={isAiReportGenerating}
                  className="rounded-2xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-60"
                >
                  {isAiReportGenerating ? "Generating AI Report..." : "Generate AI Report"}
                </button>
              ) : null}
              {completed ? (
                <button
                  type="button"
                  onClick={() => setIsAiReportPreviewOpen(true)}
                  disabled={!aiReportDraft || isAiReportGenerating}
                  className="rounded-2xl border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-900 hover:bg-cyan-100 disabled:opacity-60"
                >
                  Preview Report
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {completed ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Operation Completed</div> : null}
        {reportNotice ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{reportNotice}</div> : null}

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-700">Operation Header</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Vessel Name</p><p className="mt-1 text-base font-semibold text-slate-950">{operation.vesselName}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Voyage / Sailing Ref</p><p className="mt-1 text-base font-semibold text-slate-950">{operation.voyageReference ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Origin Port</p><p className="mt-1 text-base font-semibold text-slate-950">{operation.port ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Berth</p><p className="mt-1 text-base font-semibold text-slate-950">{operation.berth ?? "-"}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected Arrival</p><p className="mt-1 text-base font-semibold text-slate-950">{formatVesselDateTime(operation.expectedArrivalAt)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Actual Arrival</p><p className="mt-1 text-base font-semibold text-slate-950">{formatVesselDateTime(operation.actualArrivalAt)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operation Status</p><p className="mt-1 text-base font-semibold text-slate-950">{formatStatusLabel(operation.status)}</p></div>
              <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">List Confirmed</p><p className="mt-1 text-base font-semibold text-slate-950">{formatVesselDateTime(operation.listConfirmedAt)}{operation.listConfirmedBy ? ` by ${operation.listConfirmedBy}` : ""}</p></div>
              <div className="sm:col-span-2"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Completion Status</p><p className="mt-1 text-base font-semibold text-slate-950">{completed ? `Completed at ${formatVesselDateTime(operation.operationCompletedAt)}` : "Operation not completed"}</p></div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-700">Filters</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {FILTER_OPTIONS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setActiveFilter(filter.value)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${activeFilter === filter.value ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Showing <span className="font-semibold text-slate-950">{filteredTrailers.length}</span> trailer report{filteredTrailers.length === 1 ? "" : "s"}.
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-7">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Trailers</p><p className="mt-2 text-2xl font-bold text-slate-950">{statistics.totalTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-2 text-2xl font-bold text-amber-700">{statistics.arrivedTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Not Discharged</p><p className="mt-2 text-2xl font-bold text-fuchsia-700">{statistics.notDischargedTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspected</p><p className="mt-2 text-2xl font-bold text-emerald-700">{statistics.inspectedTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending Inspection</p><p className="mt-2 text-2xl font-bold text-cyan-700">{statistics.pendingInspections}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Damages</p><p className="mt-2 text-2xl font-bold text-rose-700">{statistics.damagedTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temperature Alerts</p><p className="mt-2 text-2xl font-bold text-orange-700">{statistics.temperatureAlertTrailers}</p></div>
        </section>

        <section className="space-y-4">
          {filteredTrailers.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">No trailers match the current filter.</div>
          ) : (
            filteredTrailers.map((trailer) => (
              <article key={trailer.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-bold text-slate-950">{trailer.trailerNumber}</h2>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${trailer.priority === "priority" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"}`}>{trailer.priority === "priority" ? "Priority" : "Normal"}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{trailer.arrivalStatus}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{formatStatusLabel(trailer.inspectionStatus)}</span>
                      </div>

                      <div className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
                        <p>Arrival Date/Time: <span className="font-semibold text-slate-950">{formatVesselDateTime(trailer.arrivedAt)}</span></p>
                        <p>Customer: <span className="font-semibold text-slate-950">{trailer.customer ?? "-"}</span></p>
                        <p>Booking Ref: <span className="font-semibold text-slate-950">{trailer.bookingReference ?? "-"}</span></p>
                        <p>Load Status: <span className="font-semibold text-slate-950">{trailer.loadStatus ?? "-"}</span></p>
                        <p className="sm:col-span-2 xl:col-span-4">Notes: <span className="font-semibold text-slate-950">{trailer.notes ?? "-"}</span></p>
                      </div>
                    </div>
                  </div>

                  {trailer.inspectionStatus === "inspected" ? (
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-700">Inspection Result</p>
                      <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-5">
                        <p>Overall Condition: <span className="font-semibold text-slate-950">{trailer.overallCondition === "attention_required" ? "Attention Required" : "Good"}</span></p>
                        <p>Front Temp: <span className="font-semibold text-slate-950">{formatTemperatureValue(trailer.frontTemperature, trailer.temperatureUnit)}</span></p>
                        <p>Rear Temp: <span className="font-semibold text-slate-950">{formatTemperatureValue(trailer.rearTemperature, trailer.temperatureUnit)}</span></p>
                        <p>Temperature Alert: <span className="font-semibold text-slate-950">{trailer.hasTemperatureAlert ? "Yes" : "No"}</span></p>
                        <p>Damage: <span className="font-semibold text-slate-950">{trailer.hasDamage ? "Yes" : "No"}</span></p>
                      </div>

                      {trailer.damageDetails ? (
                        <div className="mt-4 rounded-2xl border border-rose-200 bg-white p-4 text-sm text-slate-700">
                          <p className="font-semibold text-slate-950">Damage Detail</p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <p>Type: <span className="font-semibold text-slate-950">{trailer.damageDetails.category ?? "-"}</span></p>
                            <p>Location: <span className="font-semibold text-slate-950">{trailer.damageDetails.damageLocation ?? "-"}</span></p>
                            <p>Severity: <span className="font-semibold text-slate-950">{trailer.damageDetails.severity ?? "-"}</span></p>
                            <p className="sm:col-span-2">Description: <span className="font-semibold text-slate-950">{trailer.damageDetails.description || "-"}</span></p>
                          </div>
                        </div>
                      ) : null}

                      {trailer.photos.some((photo) => photo.url) ? (
                        <div className="mt-4">
                          <p className="text-sm font-semibold text-slate-950">Inspection Photos</p>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {trailer.photos.filter((photo) => photo.url).map((photo) => (
                              <a key={photo.id} href={photo.url ?? undefined} target="_blank" rel="noreferrer" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                <div className="relative aspect-video w-full bg-slate-200">
                                  {photo.url ? <Image src={photo.url} alt={photo.caption ?? `${trailer.trailerNumber} photo`} fill className="object-cover" /> : null}
                                </div>
                                <div className="p-3 text-xs text-slate-600">
                                  <p className="font-semibold text-slate-900">{photo.caption ?? "Inspection Photo"}</p>
                                  <p>{formatVesselDateTime(photo.recordedAt)}</p>
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </section>
      </div>

      <VesselOperationAiReportPreviewModal
        open={isAiReportPreviewOpen}
        report={aiReportDraft}
        isLoading={isAiReportGenerating}
        notice={reportNotice}
        onClose={() => setIsAiReportPreviewOpen(false)}
        onRegenerate={() => void generateAiReport()}
        onCopy={() => void handleCopyAiReport()}
        onSubjectChange={(value) => {
          setAiReportDraft((current) => (current ? { ...current, subject: value } : current));
        }}
        onBodyChange={(value) => {
          setAiReportDraft((current) => (current ? { ...current, body: value } : current));
        }}
      />
    </main>
  );
}
