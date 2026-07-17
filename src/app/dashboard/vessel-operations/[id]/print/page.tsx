"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";
import { PrintButton } from "@/components/print/print-button";
import { supabase } from "@/lib/supabase";
import { getVesselOperationReport } from "@/lib/vessel-report";
import { formatVesselDateTime } from "@/lib/vessel-operations";
import type { VesselOperationalReportData } from "@/lib/reports/types";
import { VesselPrintStyles } from "./print-styles";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const formatStatusLabel = (value?: string | null) => {
  if (!value) {
    return "-";
  }

  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatTemperature = (value: number | null, unit: string) => {
  return value === null ? "-" : `${value} ${unit}`;
};

const loadPrintReport = async (operationId: string) => {
  try {
    const parsedParams = paramsSchema.parse({ id: operationId });
    const reportData = await getVesselOperationReport(supabase, parsedParams.id);
    return { reportData, error: null } as const;
  } catch (error) {
    console.error("Vessel operation print report failed:", error);
    return {
      reportData: null,
      error: "Unable to load Vessel Operation Report.",
      errorDetails: error instanceof Error ? error.message : "Unknown error.",
    } as const;
  }
};

export default function VesselOperationPrintPage() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";
  const [reportData, setReportData] = useState<VesselOperationalReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!operationId) {
        if (isMounted) {
          setError("Invalid vessel operation id.");
          setErrorDetails(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);
      setErrorDetails(null);

      const result = await loadPrintReport(operationId);
      if (!isMounted) {
        return;
      }

      setReportData(result.reportData);
      setError(result.error);
      setErrorDetails(result.errorDetails ?? null);
      setIsLoading(false);
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [operationId]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
        <VesselPrintStyles />
        <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          Loading vessel operation print report...
        </div>
      </main>
    );
  }

  if (!reportData) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-rose-700">Ferryspeed TrailerHub</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">Print Report Unavailable</h1>
          <p className="mt-3 text-sm text-slate-600">The vessel operation report data could not be loaded for printing.</p>
          <p className="mt-4 text-sm text-rose-700">{error ?? "Unable to load Vessel Operation Report."}</p>
          {errorDetails ? <p className="mt-2 text-sm text-slate-600">{errorDetails}</p> : null}
          <div className="mt-6 screen-only">
            <Link href="/dashboard/vessel-operations" className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
              Back
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const generatedAt = new Date().toISOString();
  const damagedTrailers = reportData.trailers.filter((trailer) => trailer.hasDamage);
  const temperatureAlertTrailers = reportData.trailers.filter((trailer) => trailer.hasTemperatureAlert);
  const operationNotes = reportData.operation.notes?.trim() ?? "";

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <VesselPrintStyles />

      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="vessel-print-actions screen-only flex flex-wrap gap-2">
          <Link href={`/dashboard/vessel-operations/${reportData.operation.id}/summary`} className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50">
            Back
          </Link>
          <PrintButton label="Print Report" className="border-slate-300 bg-slate-900 text-white hover:bg-slate-800" />
        </div>

        <article id="print-report-root" className="vessel-print-report mx-auto w-full max-w-5xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 print-document print-portrait">
            <header className="avoid-print-break border-b border-slate-200 pb-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-4">
                  <Image
                    src="/branding/ferryspeed logo.png"
                    alt="Ferryspeed"
                    width={168}
                    height={72}
                    className="h-auto w-auto max-w-[168px]"
                    priority
                  />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Ferryspeed TrailerHub</p>
                    <h1 className="mt-2 text-3xl font-semibold text-slate-950">Vessel Operations Report</h1>
                    <p className="mt-2 text-sm text-slate-600">Professional vessel operation summary and inspection report.</p>
                  </div>
                </div>

                <div className="grid gap-2 text-sm text-slate-700 sm:text-right">
                  <p><span className="font-semibold text-slate-900">Generated:</span> {formatVesselDateTime(generatedAt)}</p>
                  <p><span className="font-semibold text-slate-900">Status:</span> {formatStatusLabel(reportData.operation.status)}</p>
                  <p><span className="font-semibold text-slate-900">List Confirmed:</span> {formatVesselDateTime(reportData.operation.listConfirmedAt)}</p>
                  <p><span className="font-semibold text-slate-900">Completion:</span> {reportData.operation.operationCompletedAt ? formatVesselDateTime(reportData.operation.operationCompletedAt) : "Not completed"}</p>
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Vessel Name</p><p className="mt-1 font-semibold text-slate-950">{reportData.operation.vesselName}</p></div>
                <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Voyage / Sailing Ref</p><p className="mt-1 font-semibold text-slate-950">{reportData.operation.voyageReference ?? "-"}</p></div>
                <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Origin Port</p><p className="mt-1 font-semibold text-slate-950">{reportData.operation.port ?? "-"}</p></div>
                <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Berth</p><p className="mt-1 font-semibold text-slate-950">{reportData.operation.berth ?? "-"}</p></div>
                <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected Arrival</p><p className="mt-1 font-semibold text-slate-950">{formatVesselDateTime(reportData.operation.expectedArrivalAt)}</p></div>
                <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Actual Arrival</p><p className="mt-1 font-semibold text-slate-950">{formatVesselDateTime(reportData.operation.actualArrivalAt)}</p></div>
                <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Operation Status</p><p className="mt-1 font-semibold text-slate-950">{formatStatusLabel(reportData.operation.status)}</p></div>
                <div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">List Status</p><p className="mt-1 font-semibold text-slate-950">{formatStatusLabel(reportData.operation.listStatus)}</p></div>
              </div>
            </header>

            <section className="avoid-print-break mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Trailers</p><p className="mt-2 text-2xl font-bold text-slate-950">{reportData.statistics.totalTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-2 text-2xl font-bold text-amber-700">{reportData.statistics.arrivedTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Not Discharged</p><p className="mt-2 text-2xl font-bold text-fuchsia-700">{reportData.statistics.notDischargedTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspected</p><p className="mt-2 text-2xl font-bold text-emerald-700">{reportData.statistics.inspectedTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending Inspection</p><p className="mt-2 text-2xl font-bold text-cyan-700">{reportData.statistics.pendingInspections}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Damages</p><p className="mt-2 text-2xl font-bold text-rose-700">{reportData.statistics.damagedTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temperature Alerts</p><p className="mt-2 text-2xl font-bold text-orange-700">{reportData.statistics.temperatureAlertTrailers}</p></div>
            </section>

            <section className="avoid-print-break mt-8">
              <h2 className="text-lg font-semibold text-slate-950">Trailer Report</h2>
              <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200">
                <table className="min-w-full border-collapse text-sm text-slate-800">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="border border-slate-200 px-3 py-2 text-left">Trailer</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Priority</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Arrival Status</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Arrival Time</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Inspection Status</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Front Temperature</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Rear Temperature</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Damage</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Temperature Alert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.trailers.map((trailer) => (
                      <tr key={trailer.id} className="trailer-print-card align-top">
                        <td className="border border-slate-200 px-3 py-3">
                          <p className="font-semibold text-slate-950">{trailer.trailerNumber}</p>
                          {trailer.customer ? <p className="mt-1 text-xs text-slate-600">Customer: {trailer.customer}</p> : null}
                          {trailer.bookingReference ? <p className="text-xs text-slate-600">Booking: {trailer.bookingReference}</p> : null}
                          {trailer.loadStatus ? <p className="text-xs text-slate-600">Load: {trailer.loadStatus}</p> : null}
                          {trailer.notes ? <p className="mt-1 text-xs text-slate-600">Notes: {trailer.notes}</p> : null}
                        </td>
                        <td className="border border-slate-200 px-3 py-3">{formatStatusLabel(trailer.priority)}</td>
                        <td className="border border-slate-200 px-3 py-3">{trailer.arrivalStatus}</td>
                        <td className="border border-slate-200 px-3 py-3">{formatVesselDateTime(trailer.arrivedAt)}</td>
                        <td className="border border-slate-200 px-3 py-3">{formatStatusLabel(trailer.inspectionStatus)}</td>
                        <td className="border border-slate-200 px-3 py-3">{formatTemperature(trailer.frontTemperature, trailer.temperatureUnit)}</td>
                        <td className="border border-slate-200 px-3 py-3">{formatTemperature(trailer.rearTemperature, trailer.temperatureUnit)}</td>
                        <td className="border border-slate-200 px-3 py-3">{trailer.hasDamage ? "Yes" : "No"}</td>
                        <td className="border border-slate-200 px-3 py-3">{trailer.hasTemperatureAlert ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {damagedTrailers.length > 0 ? (
              <section className="mt-8">
                <h2 className="text-lg font-semibold text-slate-950">Damage Details</h2>
                <div className="mt-4 space-y-4">
                  {damagedTrailers.map((trailer) => (
                    <div key={trailer.id} className="detail-print-card rounded-3xl border border-rose-200 bg-rose-50 p-4">
                      <p className="text-base font-semibold text-slate-950">{trailer.trailerNumber}</p>
                      <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                        <p>Damage Type: <span className="font-semibold text-slate-950">{trailer.damageDetails?.category ?? "-"}</span></p>
                        <p>Damage Location: <span className="font-semibold text-slate-950">{trailer.damageDetails?.damageLocation ?? "-"}</span></p>
                        <p>Severity: <span className="font-semibold text-slate-950">{trailer.damageDetails?.severity ?? "-"}</span></p>
                        <p>Description: <span className="font-semibold text-slate-950">{trailer.damageDetails?.description || "-"}</span></p>
                        <p>Recorded Date/Time: <span className="font-semibold text-slate-950">{formatVesselDateTime(reportData.damages.find((damage) => damage.trailerId === trailer.id)?.recordedAt)}</span></p>
                        <p>Recorded By: <span className="font-semibold text-slate-950">{reportData.damages.find((damage) => damage.trailerId === trailer.id)?.inspectedBy ?? "-"}</span></p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {temperatureAlertTrailers.length > 0 ? (
              <section className="mt-8">
                <h2 className="text-lg font-semibold text-slate-950">Temperature Alert Details</h2>
                <div className="mt-4 space-y-4">
                  {temperatureAlertTrailers.map((trailer) => {
                    const frontAlert = reportData.temperatures.find((row) => row.trailerId === trailer.id && row.readingPoint === "front" && row.result === "fail");
                    const rearAlert = reportData.temperatures.find((row) => row.trailerId === trailer.id && row.readingPoint === "rear" && row.result === "fail");
                    const alertSource = frontAlert && rearAlert ? "Front and Rear" : frontAlert ? "Front" : rearAlert ? "Rear" : "Unknown";
                    const notes = [frontAlert?.notes, rearAlert?.notes].filter(Boolean).join(" / ");
                    const requiredRange = (() => {
                      const frontRange = frontAlert ?? reportData.temperatures.find((row) => row.trailerId === trailer.id && row.readingPoint === "front");
                      const rearRange = rearAlert ?? reportData.temperatures.find((row) => row.trailerId === trailer.id && row.readingPoint === "rear");
                      const min = frontRange?.requiredMin ?? rearRange?.requiredMin;
                      const max = frontRange?.requiredMax ?? rearRange?.requiredMax;
                      if (min === null || min === undefined || max === null || max === undefined) {
                        return "-";
                      }
                      return `${min} to ${max} C`;
                    })();

                    return (
                      <div key={trailer.id} className="detail-print-card rounded-3xl border border-orange-200 bg-orange-50 p-4">
                        <p className="text-base font-semibold text-slate-950">{trailer.trailerNumber}</p>
                        <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                          <p>Front Temperature: <span className="font-semibold text-slate-950">{formatTemperature(trailer.frontTemperature, trailer.temperatureUnit)}</span></p>
                          <p>Rear Temperature: <span className="font-semibold text-slate-950">{formatTemperature(trailer.rearTemperature, trailer.temperatureUnit)}</span></p>
                          <p>Alert Source: <span className="font-semibold text-slate-950">{alertSource}</span></p>
                          <p>Required Temperature: <span className="font-semibold text-slate-950">{requiredRange}</span></p>
                          {notes ? <p className="sm:col-span-2">Notes: <span className="font-semibold text-slate-950">{notes}</span></p> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {reportData.photos.some((photo) => photo.url) ? (
              <section className="mt-8">
                <h2 className="text-lg font-semibold text-slate-950">Inspection Photos</h2>
                <div className="mt-4 space-y-5">
                  {reportData.trailers.filter((trailer) => trailer.photos.some((photo) => photo.url)).map((trailer) => (
                    <div key={trailer.id} className="detail-print-card rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-base font-semibold text-slate-950">{trailer.trailerNumber}</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {trailer.photos.filter((photo) => photo.url).map((photo) => (
                          <div key={photo.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                            <div className="relative aspect-[4/3] w-full bg-slate-100">
                              {photo.url ? <Image src={photo.url} alt={photo.caption ?? `${trailer.trailerNumber} inspection photo`} fill className="object-cover" /> : null}
                            </div>
                            <div className="p-3 text-xs text-slate-600">
                              <p className="font-semibold text-slate-900">{photo.caption ?? "Inspection Photo"}</p>
                              <p>{formatVesselDateTime(photo.recordedAt)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {operationNotes ? (
              <section className="avoid-print-break mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <h2 className="text-lg font-semibold text-slate-950">Operation Notes</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{operationNotes}</p>
              </section>
            ) : null}
        </article>
      </div>
      </main>
  );
}
