"use client";

import type { VesselOperationAiReportDraft } from "@/lib/reports/types";

type VesselOperationAiReportPreviewModalProps = {
  open: boolean;
  report: VesselOperationAiReportDraft | null;
  isLoading: boolean;
  notice: string | null;
  onClose: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
};

export function VesselOperationAiReportPreviewModal({
  open,
  report,
  isLoading,
  notice,
  onClose,
  onRegenerate,
  onCopy,
  onSubjectChange,
  onBodyChange,
}: VesselOperationAiReportPreviewModalProps) {
  if (!open || !report) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-700">AI Vessel Operations Report</p>
              <h2 className="mt-1 text-2xl font-semibold text-slate-950">Preview Report</h2>
              <p className="mt-2 text-sm text-slate-600">Edit the subject or report body before copying or regenerating the draft.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCopy}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Copy to Clipboard
              </button>
              <button
                type="button"
                onClick={onRegenerate}
                disabled={isLoading}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {isLoading ? "Regenerating..." : "Regenerate"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            <span className={`rounded-full px-3 py-1 ${report.generationMode === "template" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
              {report.generationMode === "template" ? "Template-generated" : "AI-generated"}
            </span>
            {report.aiModel ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Model: {report.aiModel}</span> : null}
            {report.generatedAt ? <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Generated: {new Date(report.generatedAt).toLocaleString()}</span> : null}
          </div>

          {notice ? <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div> : null}
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[1fr_1.5fr]">
          <div className="border-b border-slate-200 px-5 py-4 lg:border-b-0 lg:border-r lg:px-6">
            <label className="block text-sm font-semibold text-slate-900">
              Subject
              <input
                value={report.subject}
                onChange={(event) => onSubjectChange(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-950 outline-none ring-0 transition focus:border-cyan-500"
              />
            </label>

            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-950">Preview Notes</p>
              <p className="mt-2">The body remains editable in this panel. The report is generated from live vessel operation data and can be copied for review or later email drafting.</p>
            </div>
          </div>

          <div className="px-5 py-4 sm:px-6">
            <label className="block h-full text-sm font-semibold text-slate-900">
              Report Body
              <textarea
                value={report.body}
                onChange={(event) => onBodyChange(event.target.value)}
                className="mt-2 h-[58vh] min-h-[360px] w-full resize-none rounded-3xl border border-slate-300 bg-white px-4 py-4 text-sm leading-6 text-slate-900 outline-none transition focus:border-cyan-500"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}