"use client";

import { useState } from "react";
import { Bot } from "lucide-react";
import { OperationsAssistantDrawer } from "@/components/ai/operations-assistant-drawer";

export default function AiAssistantPage() {
  const [open, setOpen] = useState(true);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.12),_transparent_34%),linear-gradient(180deg,_#f8fafc_0%,_#f1f5f9_100%)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-700">Ferryspeed TrailerHub</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">AI Operations Assistant</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            This assistant is read-only. It answers operational questions using live application data for trailers,
            vessel operations, compound occupancy, exports, departures, alerts, and stock-check discrepancies.
          </p>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            <Bot className="h-4 w-4" />
            Open Assistant
          </button>
        </section>
      </div>

      <OperationsAssistantDrawer
        open={open}
        onClose={() => setOpen(false)}
        context={{ pathname: "/dashboard/ai-assistant" }}
      />
    </main>
  );
}
