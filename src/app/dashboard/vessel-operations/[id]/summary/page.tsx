"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { buildDeterministicVesselOperationAiReportDraft } from "@/lib/reports/vessel-operation-ai-report-shared";
import { loadVesselOperationSummaryAndPrintReportData } from "@/lib/reports/report-data";
import { formatVesselDateTime } from "@/lib/vessel-operations";
import type {
  VesselOperationalReportData,
  VesselOperationAiReportDraft,
  VesselOperationAiReportHistoryItem,
  VesselOperationAiReportResponse,
} from "@/lib/reports/types";
import { VesselOperationAiReportPreviewModal } from "@/components/reports/vessel-operation-ai-report-preview-modal";

type SummaryFilter = "all" | "arrived" | "inspected" | "damage" | "temperature_alert" | "not_discharged";
type ReportLoadErrorKind = "auth" | "not_found" | "data" | "unknown";
type AiReportErrorKind = "signed_out" | "not_found" | "invalid_request" | "configuration" | "database" | "provider" | "unknown";
const AI_SESSION_RETRY_DELAY_MS = 250;

class AiReportRequestError extends Error {
  status: number;
  kind: AiReportErrorKind;

  constructor(message: string, status: number, kind: AiReportErrorKind) {
    super(message);
    this.name = "AiReportRequestError";
    this.status = status;
    this.kind = kind;
  }
}

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

const getInspectionStatusLabel = (trailer: VesselOperationalReportData["trailers"][number]) => {
  if (trailer.arrivalStatusRaw === "arrived" && trailer.inspectionStatus !== "inspected") {
    return "Inspection Pending";
  }

  return formatStatusLabel(trailer.inspectionStatus);
};

const classifyReportLoadError = (error: unknown): { kind: ReportLoadErrorKind; userMessage: string } => {
  const details = error instanceof Error ? error.message : "Unknown error.";
  const message = details.toLowerCase();

  const isAuthError =
    message.includes("auth") ||
    message.includes("jwt") ||
    message.includes("not authenticated") ||
    message.includes("session") ||
    message.includes("permission denied") ||
    message.includes("rls");

  if (isAuthError) {
    return {
      kind: "auth",
      userMessage: "Authentication is required to load this report.",
    };
  }

  if (message.includes("not found") || message.includes("no rows")) {
    return {
      kind: "not_found",
      userMessage: "Vessel operation not found.",
    };
  }

  if (message.includes("unable to load report") || message.includes("unable to load")) {
    return {
      kind: "data",
      userMessage: "Unable to load Vessel Operation Report.",
    };
  }

  return {
    kind: "unknown",
    userMessage: "Unable to load Vessel Operation Report.",
  };
};

const classifyAiReportError = (error: unknown): { kind: AiReportErrorKind; message: string } => {
  if (error instanceof AiReportRequestError) {
    return { kind: error.kind, message: error.message };
  }

  const message = error instanceof Error ? error.message : "Unable to complete AI report request.";
  const lower = message.toLowerCase();

  if (lower.includes("authentication is required")) {
    return { kind: "signed_out", message: "Authentication is required." };
  }

  if (lower.includes("not found")) {
    return { kind: "not_found", message: "Report not found." };
  }

  if (lower.includes("invalid request") || lower.includes("invalid vessel operation id") || lower.includes("invalid request payload")) {
    return { kind: "invalid_request", message: "Invalid request." };
  }

  if (lower.includes("openai_api_key") || lower.includes("missing openai") || lower.includes("not configured")) {
    return { kind: "configuration", message: "AI report service is not configured." };
  }

  if (lower.includes("openai api error") || lower.includes("ai generation failed") || lower.includes("provider")) {
    return { kind: "provider", message: "AI report generation is temporarily unavailable." };
  }

  if (
    lower.includes("permission denied") ||
    lower.includes("rls") ||
    lower.includes("relation") ||
    lower.includes("column") ||
    lower.includes("database") ||
    lower.includes("unable to load ai report draft history") ||
    lower.includes("unable to save ai report draft") ||
    lower.includes("unable to update ai report draft")
  ) {
    return { kind: "database", message: "Unable to access report data right now." };
  }

  return { kind: "unknown", message: "Unable to complete AI report request." };
};

export default function VesselSummaryPage() {
  const params = useParams();
  const operationId = typeof params?.id === "string" ? params.id : "";

  const [reportData, setReportData] = useState<VesselOperationalReportData | null>(null);
  const [aiReportDraft, setAiReportDraft] = useState<VesselOperationAiReportDraft | null>(null);
  const [draftHistory, setDraftHistory] = useState<VesselOperationAiReportHistoryItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<SummaryFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isAiReportLoading, setIsAiReportLoading] = useState(false);
  const [isAiReportGenerating, setIsAiReportGenerating] = useState(false);
  const [isAiReportSaving, setIsAiReportSaving] = useState(false);
  const [isAiReportPreviewOpen, setIsAiReportPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadErrorKind, setLoadErrorKind] = useState<ReportLoadErrorKind | null>(null);
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!operationId) {
      setError("Invalid vessel operation reference.");
      setLoadErrorKind("data");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setLoadErrorKind(null);

    try {
      const report = await loadVesselOperationSummaryAndPrintReportData(supabase, operationId);
      setReportData(report);
    } catch (loadErr) {
      console.error("Unable to load vessel summary report:", loadErr);
      const classified = classifyReportLoadError(loadErr);
      setError(classified.userMessage);
      setLoadErrorKind(classified.kind);
    } finally {
      setIsLoading(false);
    }
  }, [operationId]);

  const requestAiReport = useCallback(async (
    input: {
      method: "GET" | "POST";
      body?: string;
      fallbackError: string;
    },
  ) => {
    const getAccessToken = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        throw new Error(error.message);
      }

      if (data.session?.access_token) {
        return data.session.access_token;
      }

      await new Promise((resolve) => window.setTimeout(resolve, AI_SESSION_RETRY_DELAY_MS));

      const retryResult = await supabase.auth.getSession();
      if (retryResult.error) {
        throw new Error(retryResult.error.message);
      }

      if (!retryResult.data.session?.access_token) {
        throw new AiReportRequestError("You are signed out of AI report services. Refresh the page or sign in again.", 401, "signed_out");
      }

      return retryResult.data.session.access_token;
    };

    const accessToken = await getAccessToken();

    const response = await fetch(`/api/vessel-operations/${operationId}/ai-report`, {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      ...(input.body ? { body: input.body } : {}),
    });

    const payload = (await response.json()) as VesselOperationAiReportResponse & { error?: string };
    if (!response.ok) {
      const message = payload.error || input.fallbackError;
      let kind: AiReportErrorKind = "unknown";

      if (response.status === 401) {
        kind = "signed_out";
      } else if (response.status === 404) {
        kind = "not_found";
      } else if (response.status === 400) {
        kind = "invalid_request";
      } else {
        const classified = classifyAiReportError(message);
        kind = classified.kind;
      }

      throw new AiReportRequestError(message, response.status, kind);
    }

    return payload;
  }, [operationId]);

  const handleAiReportError = useCallback((error: unknown, fallbackMessage: string) => {
    const classified = classifyAiReportError(error);

    setReportNotice(classified.message || fallbackMessage);
  }, []);

  const loadAiReportDraft = useCallback(async () => {
    if (!operationId || !reportData || reportData.operation.status !== "completed") {
      setAiReportDraft(null);
      setDraftHistory([]);
      return;
    }

    setIsAiReportLoading(true);
    setReportNotice(null);
    try {
      const payload = await requestAiReport({ method: "GET", fallbackError: "Unable to load AI report draft." });

      setAiReportDraft(payload.reportDraft ?? buildDeterministicVesselOperationAiReportDraft(reportData));
      setDraftHistory(payload.draftHistory ?? []);
      if (payload.message) {
        setReportNotice("Draft loaded.");
      }
    } catch (loadErr) {
      console.error("Unable to load AI report draft:", loadErr);
      setAiReportDraft(buildDeterministicVesselOperationAiReportDraft(reportData));
      setDraftHistory([]);
      handleAiReportError(loadErr, "Unable to load saved draft history.");
    } finally {
      setIsAiReportLoading(false);
    }
  }, [handleAiReportError, reportData, requestAiReport]);

  useEffect(() => {
    void loadAiReportDraft();
  }, [loadAiReportDraft]);

  const generateAiReport = useCallback(async () => {
    if (!operationId || !reportData || reportData.operation.status !== "completed") {
      return;
    }

    setIsAiReportGenerating(true);
    setReportNotice(null);

    try {
      const payload = await requestAiReport({
        method: "POST",
        body: JSON.stringify({ action: "generate" }),
        fallbackError: "Unable to generate AI report.",
      });

      if (!payload.reportDraft) {
        throw new AiReportRequestError("Unable to generate AI report.", 500, "provider");
      }

      setAiReportDraft(payload.reportDraft);
      setDraftHistory(payload.draftHistory ?? []);
      setIsAiReportPreviewOpen(true);
      setReportNotice(payload.usedFallback ? "Template-generated report created from live data." : "AI report generated successfully.");
    } catch (generateErr) {
      console.error("Unable to generate AI report:", generateErr);
      handleAiReportError(generateErr, "Unable to generate AI report.");
    } finally {
      setIsAiReportGenerating(false);
    }
  }, [handleAiReportError, operationId, reportData, requestAiReport]);

  const saveAiReportDraft = useCallback(async () => {
    if (!operationId || !aiReportDraft) {
      return;
    }

    setIsAiReportSaving(true);
    setReportNotice(null);

    try {
      const payload = await requestAiReport({
        method: "POST",
        body: JSON.stringify({
          action: "save_draft",
          draft: {
            reportId: aiReportDraft.reportId,
            subject: aiReportDraft.subject,
            recipients: aiReportDraft.recipients,
            cc: aiReportDraft.cc,
            generatedContent: aiReportDraft.generatedContent,
            editedContent: aiReportDraft.editedContent || aiReportDraft.body,
            body: aiReportDraft.body,
            generationMode: aiReportDraft.generationMode,
            usedFallback: aiReportDraft.usedFallback,
            aiModel: aiReportDraft.aiModel,
            generatedAt: aiReportDraft.generatedAt,
          },
        }),
        fallbackError: "Unable to save report draft.",
      });

      if (!payload.reportDraft) {
        throw new AiReportRequestError("Unable to save report draft.", 500, "database");
      }

      setAiReportDraft(payload.reportDraft);
      setDraftHistory(payload.draftHistory ?? []);
      setReportNotice("Draft saved successfully.");
    } catch (saveErr) {
      console.error("Unable to save AI report draft:", saveErr);
      handleAiReportError(saveErr, "Unable to save AI report draft.");
    } finally {
      setIsAiReportSaving(false);
    }
  }, [aiReportDraft, handleAiReportError, operationId, requestAiReport]);

  const splitEmailList = useCallback((value: string) => {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }, []);

  const handleCopyAiReport = useCallback(async () => {
    if (!aiReportDraft) {
      return;
    }

    await navigator.clipboard.writeText(`${aiReportDraft.subject}\n\n${aiReportDraft.body}`);
    setReportNotice("Report copied to clipboard.");
  }, [aiReportDraft]);

  useEffect(() => {
    void loadReport();
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
        <div className="mx-auto max-w-7xl rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
          Loading vessel report...
        </div>
      </main>
    );
  }

  if (!reportData) {
    const title =
      loadErrorKind === "auth"
        ? "Authentication Required"
        : loadErrorKind === "not_found"
          ? "Vessel Operation Not Found"
          : "Unable to load Vessel Operation Report.";

    return (
      <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-rose-700">Ferryspeed TrailerHub</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">{title}</h1>
          <p className="mt-3 text-sm text-rose-700">{error ?? "Unable to load Vessel Operation Report."}</p>
        </div>
      </main>
    );
  }

  const { operation, statistics } = reportData;
  const completed = operation.status === "completed";
  const operationHasNoTrailers = reportData.trailers.length === 0;

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
              <Link href={`/dashboard/vessel-operations/${operation.id}/print`} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Print Report</Link>
              {completed ? (
                <button
                  type="button"
                  onClick={() => void generateAiReport()}
                  disabled={isAiReportGenerating || isAiReportLoading}
                  className="rounded-2xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-60"
                >
                  {isAiReportGenerating ? "Generating AI Report..." : "Generate AI Report"}
                </button>
              ) : null}
              {completed ? (
                <button
                  type="button"
                  onClick={() => setIsAiReportPreviewOpen(true)}
                  disabled={!aiReportDraft || isAiReportGenerating || isAiReportLoading}
                  className="rounded-2xl border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-900 hover:bg-cyan-100 disabled:opacity-60"
                >
                  Preview Report
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {completed ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">Operation Completed</div> : null}
        {completed && isAiReportLoading ? <div className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-800">Loading AI draft history...</div> : null}
        {reportNotice ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{reportNotice}</div> : null}

        {completed ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-700">Draft Save History</p>
            {draftHistory.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600">No saved drafts yet. Generate or edit a report and save draft to create history.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-left text-sm text-slate-700">
                  <thead className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="py-2 pr-4">Generated</th>
                      <th className="py-2 pr-4">Generated By</th>
                      <th className="py-2 pr-4">Subject</th>
                      <th className="py-2 pr-4">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftHistory.map((item) => (
                      <tr key={item.reportId} className="border-t border-slate-200">
                        <td className="py-2 pr-4">{new Date(item.generatedAt).toLocaleString()}</td>
                        <td className="py-2 pr-4">{item.generatedBy ?? "-"}</td>
                        <td className="py-2 pr-4">{item.subject}</td>
                        <td className="py-2 pr-4">{item.generationMode === "ai" ? "AI" : "Template"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : null}

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
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Expected</p><p className="mt-2 text-2xl font-bold text-slate-950">{statistics.expectedTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Arrived</p><p className="mt-2 text-2xl font-bold text-amber-700">{statistics.arrivedTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pending</p><p className="mt-2 text-2xl font-bold text-fuchsia-700">{statistics.pendingTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Priority</p><p className="mt-2 text-2xl font-bold text-rose-700">{statistics.priorityTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspected</p><p className="mt-2 text-2xl font-bold text-emerald-700">{statistics.inspectedTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inspection Pending</p><p className="mt-2 text-2xl font-bold text-cyan-700">{statistics.pendingInspections}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Damages</p><p className="mt-2 text-2xl font-bold text-rose-700">{statistics.damagedTrailers}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Temperature Alerts</p><p className="mt-2 text-2xl font-bold text-orange-700">{statistics.temperatureAlertTrailers}</p></div>
        </section>

        <section className="space-y-4">
          {operationHasNoTrailers ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">No trailer records found for this vessel operation yet.</div>
          ) : null}

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
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{getInspectionStatusLabel(trailer)}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{trailer.receptionStatus}</span>
                      </div>

                      <div className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-4">
                        <p>Arrival Date/Time: <span className="font-semibold text-slate-950">{formatVesselDateTime(trailer.arrivedAt)}</span></p>
                        <p>Reception Status: <span className="font-semibold text-slate-950">{trailer.receptionStatus}</span></p>
                        <p>Inspection Status: <span className="font-semibold text-slate-950">{getInspectionStatusLabel(trailer)}</span></p>
                        <p>Photo Count: <span className="font-semibold text-slate-950">{trailer.photos.length}</span></p>
                        <p>Customer: <span className="font-semibold text-slate-950">{trailer.customer ?? "-"}</span></p>
                        <p>Booking Ref: <span className="font-semibold text-slate-950">{trailer.bookingReference ?? "-"}</span></p>
                        <p>Load Status: <span className="font-semibold text-slate-950">{trailer.loadStatus ?? "-"}</span></p>
                        <p>Damages: <span className="font-semibold text-slate-950">{trailer.hasDamage ? "Yes" : "No"}</span></p>
                        <p>Temperature Alert: <span className="font-semibold text-slate-950">{trailer.hasTemperatureAlert ? "Yes" : "No"}</span></p>
                        <p>Expected Front Temp: <span className="font-semibold text-slate-950">{formatTemperatureValue(trailer.expectedFrontTemperature, trailer.temperatureUnit)}</span></p>
                        <p>Expected Rear Temp: <span className="font-semibold text-slate-950">{formatTemperatureValue(trailer.expectedRearTemperature, trailer.temperatureUnit)}</span></p>
                        <p>Front Temp: <span className="font-semibold text-slate-950">{formatTemperatureValue(trailer.frontTemperature, trailer.temperatureUnit)}</span></p>
                        <p>Rear Temp: <span className="font-semibold text-slate-950">{formatTemperatureValue(trailer.rearTemperature, trailer.temperatureUnit)}</span></p>
                        <p className="sm:col-span-2 xl:col-span-4">Notes: <span className="font-semibold text-slate-950">{trailer.notes ?? "-"}</span></p>
                        <p className="sm:col-span-2 xl:col-span-4">Latest Photo Metadata: <span className="font-semibold text-slate-950">{trailer.photos[trailer.photos.length - 1]?.recordedAt ? formatVesselDateTime(trailer.photos[trailer.photos.length - 1].recordedAt) : "No photos"}</span></p>
                      </div>
                    </div>
                  </div>

                  {trailer.inspectionStatus === "inspected" ? (
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-700">Inspection Result</p>
                      <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2 xl:grid-cols-5">
                        <p>Overall Condition: <span className="font-semibold text-slate-950">{trailer.overallCondition === "attention_required" ? "Attention Required" : "Good"}</span></p>
                        <p>Expected Front Temp: <span className="font-semibold text-slate-950">{formatTemperatureValue(trailer.expectedFrontTemperature, trailer.temperatureUnit)}</span></p>
                        <p>Expected Rear Temp: <span className="font-semibold text-slate-950">{formatTemperatureValue(trailer.expectedRearTemperature, trailer.temperatureUnit)}</span></p>
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
        isSaving={isAiReportSaving}
        notice={reportNotice}
        printHref={`/dashboard/vessel-operations/${operationId}/print`}
        onClose={() => setIsAiReportPreviewOpen(false)}
        onRegenerate={() => void generateAiReport()}
        onCopy={() => void handleCopyAiReport()}
        onSaveDraft={() => void saveAiReportDraft()}
        onSubjectChange={(value) => {
          setAiReportDraft((current) => (current ? { ...current, subject: value } : current));
        }}
        onRecipientsChange={(value) => {
          setAiReportDraft((current) => (current ? { ...current, recipients: splitEmailList(value) } : current));
        }}
        onCcChange={(value) => {
          setAiReportDraft((current) => (current ? { ...current, cc: splitEmailList(value) } : current));
        }}
        onBodyChange={(value) => {
          setAiReportDraft((current) => (current ? { ...current, body: value, editedContent: value } : current));
        }}
      />
    </main>
  );
}
