"use client";

import type { VesselOperationAiReportDraft } from "@/lib/reports/types";

type VesselOperationAiReportPreviewModalProps = {
  open: boolean;
  report: VesselOperationAiReportDraft | null;
  isLoading: boolean;
  isSaving: boolean;
  isFinalizing: boolean;
  isSending: boolean;
  emailProviderConfigured: boolean;
  notice: string | null;
  printHref: string;
  onClose: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  onSaveDraft: () => void;
  onFinalize: () => void;
  onSendReport: () => void;
  onSubjectChange: (value: string) => void;
  onRecipientsChange: (value: string) => void;
  onCcChange: (value: string) => void;
  onBodyChange: (value: string) => void;
};

export function VesselOperationAiReportPreviewModal({
  open,
  report,
  isLoading,
  isSaving,
  isFinalizing,
  isSending,
  emailProviderConfigured,
  notice,
  printHref,
  onClose,
  onRegenerate,
  onCopy,
  onSaveDraft,
  onFinalize,
  onSendReport,
  onSubjectChange,
  onRecipientsChange,
  onCcChange,
  onBodyChange,
}: VesselOperationAiReportPreviewModalProps) {
  if (!open || !report) {
    return null;
  }

  const isFinal = report.status === "final";
  const isSent = report.status === "sent";
  const hasRecipients = report.recipients.some((item) => item.trim().length > 0);
  const hasSubject = report.subject.trim().length > 0;
  const hasBody = report.body.trim().length > 0;
  const canSendReport = emailProviderConfigured && hasRecipients && hasSubject && hasBody;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-8 backdrop-blur-sm">
      <div className="flex h-[calc(100vh-64px)] max-h-[85vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-700">AI Vessel Operations Report</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">Preview Report</h2>
              <p className="mt-2 text-sm text-slate-600">Edit and review the report body before saving or finalising.</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            <span className={`rounded-full px-3 py-1 ${report.generationMode === "template" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
              {report.generationMode === "template" ? "Template-generated" : "AI-generated"}
            </span>
            <span className={`rounded-full px-3 py-1 ${isSent ? "bg-slate-900 text-white" : isFinal ? "bg-emerald-100 text-emerald-800" : "bg-cyan-100 text-cyan-800"}`}>
              {isSent ? "Sent" : isFinal ? "Final" : "Draft"}
            </span>
            {report.generatedAt ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Generated: {new Date(report.generatedAt).toLocaleString()}</span> : null}
            {report.sentAt ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Sent: {new Date(report.sentAt).toLocaleString()}</span> : null}
            {report.sentBy ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Sent by: {report.sentBy}</span> : null}
            <span className={`rounded-full px-3 py-1 ${emailProviderConfigured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {emailProviderConfigured ? "Email Delivery Configured" : "Email Delivery Not Configured"}
            </span>
          </div>

          {report.recipients.length > 0 ? (
            <p className="mt-3 text-sm text-slate-600">Recipients: {report.recipients.join(", ")}</p>
          ) : null}

          {notice ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div> : null}
        </div>

        <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[35%_65%]">
          <div className="border-b border-slate-200 px-5 py-4 xl:border-b-0 xl:border-r xl:px-6">
            <label className="block text-sm font-semibold text-slate-900">
              Subject
              <input
                value={report.subject}
                onChange={(event) => onSubjectChange(event.target.value)}
                disabled={isSent}
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none ring-0 transition focus:border-cyan-500"
              />
            </label>

            <label className="mt-4 block text-sm font-semibold text-slate-900">
              Recipients (comma, semicolon, or newline separated)
              <input
                value={report.recipients.join(", ")}
                onChange={(event) => onRecipientsChange(event.target.value)}
                disabled={isSent}
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none ring-0 transition focus:border-cyan-500"
              />
            </label>

            <label className="mt-4 block text-sm font-semibold text-slate-900">
              CC (comma, semicolon, or newline separated)
              <input
                value={report.cc.join(", ")}
                onChange={(event) => onCcChange(event.target.value)}
                disabled={isSent}
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none ring-0 transition focus:border-cyan-500"
              />
            </label>

            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-950">Preview Notes</p>
              <p className="mt-2">Saving stores this as draft only. Sending is done server-side using configured Gmail API credentials.</p>
            </div>
          </div>

          <div className="flex min-h-0 flex-col px-5 py-4 sm:px-6">
            <label className="block text-sm font-semibold text-slate-900">Report Body</label>
            <textarea
              value={report.body}
              onChange={(event) => onBodyChange(event.target.value)}
              disabled={isSent}
              className="mt-2 min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-3xl border border-slate-300 bg-white px-5 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <button
              type="button"
              onClick={onRegenerate}
              disabled={isLoading}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {isLoading ? "Generating..." : "Generate AI Report"}
            </button>
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={isSaving || isLoading || isFinalizing || isSending}
              className="rounded-2xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save Draft"}
            </button>
            <button
              type="button"
              onClick={onFinalize}
              disabled={isFinalizing || isSending || isSent}
              className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
            >
              {isFinalizing ? "Finalising..." : isSent ? "Already Sent" : isFinal ? "Finalised" : "Finalise"}
            </button>
            <a
              href={printHref}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Print
            </a>
            <button
              type="button"
              onClick={onCopy}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onSendReport}
              disabled={!canSendReport || isSending || isSaving || isFinalizing || isLoading}
              className="rounded-2xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-60"
            >
              {isSending ? "Sending..." : isSent ? "Send Again" : "Send Report"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}