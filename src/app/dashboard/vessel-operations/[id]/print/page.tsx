"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PrintButton } from "@/components/print/print-button";
import { loadVesselOperationSummaryAndPrintReportData } from "@/lib/reports/report-data";
import { supabase } from "@/lib/supabase";
import { getAcceptedTemperatureRange, getDefaultTemperatureToleranceSettings, isTemperatureOutOfRange } from "@/lib/temperature-tolerance";
import { formatVesselDateTime } from "@/lib/vessel-operations";
import type { VesselOperationalReportData } from "@/lib/reports/types";
import { VesselPrintStyles } from "./print-styles";

const formatStatusLabel = (value?: string | null) => {
  if (!value) return "Unknown";

  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatTemperature = (value: number | null, unit: string) => {
  return value === null ? "Not recorded" : `${value} ${unit}`;
};

const getTemperatureResultLabel = (trailer: VesselOperationalReportData["trailers"][number]) => {
  const tolerance = getDefaultTemperatureToleranceSettings();
  const expectedFront = trailer.expectedFrontTemperature;
  const expectedRear = trailer.expectedRearTemperature;
  const measuredFront = trailer.frontTemperature;
  const measuredRear = trailer.rearTemperature;

  if (expectedFront === null && expectedRear === null) {
    return "No expected temperature recorded";
  }

  const frontOut = expectedFront === null ? false : isTemperatureOutOfRange(measuredFront, expectedFront, tolerance);
  const rearOut = expectedRear === null ? false : isTemperatureOutOfRange(measuredRear, expectedRear, tolerance);

  if (frontOut || rearOut) {
    return "Out of accepted range";
  }

  if ((expectedFront !== null && measuredFront === null) || (expectedRear !== null && measuredRear === null)) {
    return "Pending measurement";
  }

  return "Within accepted range";
};

const getAcceptedRangeLabel = (trailer: VesselOperationalReportData["trailers"][number]) => {
  const tolerance = getDefaultTemperatureToleranceSettings();
  const unit = trailer.temperatureUnit || "C";
  const frontRange = trailer.expectedFrontTemperature === null ? null : getAcceptedTemperatureRange(trailer.expectedFrontTemperature, tolerance);
  const rearRange = trailer.expectedRearTemperature === null ? null : getAcceptedTemperatureRange(trailer.expectedRearTemperature, tolerance);

  const segments = [
    frontRange ? `Front ${frontRange.minimumAcceptedTemperature} to ${frontRange.maximumAcceptedTemperature} ${unit}` : null,
    rearRange ? `Rear ${rearRange.minimumAcceptedTemperature} to ${rearRange.maximumAcceptedTemperature} ${unit}` : null,
  ].filter(Boolean);

  return segments.length > 0 ? segments.join("; ") : "Not applicable";
};

const getInspectionStatusLabel = (trailer: VesselOperationalReportData["trailers"][number]) => {
  if (trailer.arrivalStatusRaw === "arrived" && trailer.inspectionStatus !== "inspected") {
    return "Inspection Pending";
  }

  return formatStatusLabel(trailer.inspectionStatus);
};

const loadPrintReport = async (operationId: string) => {
  try {
    const reportData = await loadVesselOperationSummaryAndPrintReportData(supabase, operationId);
    return { reportData, error: null } as const;
  } catch (error) {
    console.error("Vessel operation print report failed:", error);
    return {
      reportData: null,
      error: "Unable to load Vessel Operation Report.",
    } as const;
  }
};

export default function VesselOperationPrintPage() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";
  const [reportData, setReportData] = useState<VesselOperationalReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const run = async () => {
      if (!operationId) {
        if (isMounted) {
          setError("Invalid vessel operation reference.");
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      const result = await loadPrintReport(operationId);
      if (!isMounted) {
        return;
      }

      setReportData(result.reportData);
      setError(result.error);
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
  const operationNotes = reportData.operation.notes?.trim() ?? "";
  const hasNoTrailers = reportData.trailers.length === 0;
  const overviewRows = [
    { label: "Vessel", value: reportData.operation.vesselName?.trim() || null },
    { label: "Voyage / Sailing Reference", value: reportData.operation.voyageReference?.trim() || null },
    { label: "Origin Port", value: reportData.operation.port?.trim() || null },
    { label: "Berth", value: reportData.operation.berth?.trim() || null },
    { label: "Expected Arrival", value: reportData.operation.expectedArrivalAt ? formatVesselDateTime(reportData.operation.expectedArrivalAt) : null },
    { label: "Actual Arrival", value: reportData.operation.actualArrivalAt ? formatVesselDateTime(reportData.operation.actualArrivalAt) : null },
    { label: "Status", value: formatStatusLabel(reportData.operation.status) },
    { label: "Report Date", value: formatVesselDateTime(reportData.operation.operationCompletedAt ?? reportData.operation.actualArrivalAt ?? generatedAt) },
  ].filter((item) => item.value);

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
                {overviewRows.map((row) => (
                  <div key={row.label}>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{row.label}</p>
                    <p className="mt-1 font-semibold text-slate-950">{row.value}</p>
                  </div>
                ))}
              </div>
            </header>

            <section className="avoid-print-break mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected</p><p className="mt-2 text-2xl font-bold text-slate-950">{reportData.statistics.expectedTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-2 text-2xl font-bold text-amber-700">{reportData.statistics.arrivedTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending</p><p className="mt-2 text-2xl font-bold text-fuchsia-700">{reportData.statistics.pendingTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Priority</p><p className="mt-2 text-2xl font-bold text-rose-700">{reportData.statistics.priorityTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspected</p><p className="mt-2 text-2xl font-bold text-emerald-700">{reportData.statistics.inspectedTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspection Pending</p><p className="mt-2 text-2xl font-bold text-cyan-700">{reportData.statistics.pendingInspections}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Damages</p><p className="mt-2 text-2xl font-bold text-rose-700">{reportData.statistics.damagedTrailers}</p></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temperature Alerts</p><p className="mt-2 text-2xl font-bold text-orange-700">{reportData.statistics.temperatureAlertTrailers}</p></div>
            </section>

            {hasNoTrailers ? (
              <section className="avoid-print-break mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
                No trailer records found for this vessel operation yet.
              </section>
            ) : null}

            <section className="avoid-print-break mt-8">
              <h2 className="text-lg font-semibold text-slate-950">Trailer Status Table</h2>
              <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200">
                <table className="min-w-full border-collapse text-sm text-slate-800">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="border border-slate-200 px-3 py-2 text-left">Trailer</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Arrival</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Inspection</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Damage</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Temperature</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.trailers.map((trailer) => (
                      <tr key={trailer.id} className="trailer-print-card align-top">
                        <td className="border border-slate-200 px-3 py-3">
                          <p className="font-semibold text-slate-950">{trailer.trailerNumber}</p>
                          {trailer.bookingReference ? <p className="text-xs text-slate-600">Booking: {trailer.bookingReference}</p> : null}
                        </td>
                        <td className="border border-slate-200 px-3 py-3">{trailer.arrivalStatus}</td>
                        <td className="border border-slate-200 px-3 py-3">{getInspectionStatusLabel(trailer)}</td>
                        <td className="border border-slate-200 px-3 py-3">{trailer.hasDamage ? "Yes" : "No"}</td>
                        <td className="border border-slate-200 px-3 py-3">{getTemperatureResultLabel(trailer)}</td>
                        <td className="border border-slate-200 px-3 py-3">{trailer.compoundPosition?.trim() ? trailer.compoundPosition : "Not assigned"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-semibold text-slate-950">Damage Details</h2>
              {damagedTrailers.length === 0 ? (
                <p className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">No damage was recorded for this vessel operation.</p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200">
                  <table className="min-w-full border-collapse text-sm text-slate-800">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="border border-slate-200 px-3 py-2 text-left">Trailer</th>
                        <th className="border border-slate-200 px-3 py-2 text-left">Type</th>
                        <th className="border border-slate-200 px-3 py-2 text-left">Location</th>
                        <th className="border border-slate-200 px-3 py-2 text-left">Severity</th>
                        <th className="border border-slate-200 px-3 py-2 text-left">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {damagedTrailers.map((trailer) => (
                        <tr key={trailer.id} className="trailer-print-card align-top">
                          <td className="border border-slate-200 px-3 py-3 font-semibold text-slate-950">{trailer.trailerNumber}</td>
                          <td className="border border-slate-200 px-3 py-3">{trailer.damageDetails?.category ?? "Recorded"}</td>
                          <td className="border border-slate-200 px-3 py-3">{trailer.damageDetails?.damageLocation ?? "Recorded"}</td>
                          <td className="border border-slate-200 px-3 py-3">{trailer.damageDetails?.severity ?? "Recorded"}</td>
                          <td className="border border-slate-200 px-3 py-3">{trailer.damageDetails?.description || "No description provided"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-semibold text-slate-950">Temperature Details</h2>
              <div className="mt-4 overflow-x-auto rounded-3xl border border-slate-200">
                <table className="min-w-full border-collapse text-sm text-slate-800">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="border border-slate-200 px-3 py-2 text-left">Trailer</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Expected Front</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Measured Front</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Expected Rear</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Measured Rear</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Accepted Range</th>
                      <th className="border border-slate-200 px-3 py-2 text-left">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.trailers.map((trailer) => (
                      <tr key={trailer.id} className="trailer-print-card align-top">
                        <td className="border border-slate-200 px-3 py-3 font-semibold text-slate-950">{trailer.trailerNumber}</td>
                        <td className="border border-slate-200 px-3 py-3">{formatTemperature(trailer.expectedFrontTemperature, trailer.temperatureUnit)}</td>
                        <td className="border border-slate-200 px-3 py-3">{formatTemperature(trailer.frontTemperature, trailer.temperatureUnit)}</td>
                        <td className="border border-slate-200 px-3 py-3">{formatTemperature(trailer.expectedRearTemperature, trailer.temperatureUnit)}</td>
                        <td className="border border-slate-200 px-3 py-3">{formatTemperature(trailer.rearTemperature, trailer.temperatureUnit)}</td>
                        <td className="border border-slate-200 px-3 py-3">{getAcceptedRangeLabel(trailer)}</td>
                        <td className="border border-slate-200 px-3 py-3">{getTemperatureResultLabel(trailer)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
            </section>

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
