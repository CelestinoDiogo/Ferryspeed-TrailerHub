"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bot, Loader2, Sparkles, Send, Trash2, ArrowRight, Clock3, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AiAssistantResponse } from "@/lib/ai-assistant-types";

type ConversationItem = {
  id: string;
  question: string;
  createdAt: string;
  response: AiAssistantResponse | null;
  error: string | null;
};

const exampleQuestions = [
  "Where is trailer PFF1216?",
  "How many empty trailers are available?",
  "Which trailers are waiting for compound?",
  "What arrived today?",
  "What departed today?",
  "What vessel operations are scheduled today?",
  "Show export trailers waiting for collection.",
  "Which trailers have damage alerts?",
];

const formatTimestamp = (value: string) => {
  try {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
};

const keyLabel = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const getSessionToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }

  const token = data.session?.access_token ?? null;
  if (!token) {
    throw new Error("Your session is not available. Please sign in again.");
  }

  return token;
};

export default function AiAssistantPage() {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasConversation = conversation.length > 0;

  const sendQuestion = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Please enter a question.");
      return;
    }

    if (trimmed.length > 500) {
      setError("Questions must be 500 characters or fewer.");
      return;
    }

    if (isSending) {
      return;
    }

    setIsSending(true);
    setError(null);

    const createdAt = new Date().toISOString();
    const entryId = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
    setConversation((current) => [
      ...current,
      { id: entryId, question: trimmed, createdAt, response: null, error: null },
    ]);

    try {
      const token = await getSessionToken();
      const response = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: trimmed }),
      });

      const payload = (await response.json()) as AiAssistantResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to answer that question right now.");
      }

      setConversation((current) =>
        current.map((item) => (item.id === entryId ? { ...item, response: payload, error: null } : item)),
      );
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unable to answer that question right now.";
      setError(message);
      setConversation((current) =>
        current.map((item) => (item.id === entryId ? { ...item, response: null, error: message } : item)),
      );
    } finally {
      setIsSending(false);
    }
  };

  const clearConversation = () => {
    setConversation([]);
    setQuestion("");
    setError(null);
  };

  const renderedExamples = useMemo(() => exampleQuestions, []);

  const renderStructuredData = (response: AiAssistantResponse) => {
    if (response.data.length === 0) {
      return (
        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
          No results were returned for this query.
        </div>
      );
    }

    if (response.resultType === "find_trailer" || response.resultType === "latest_inspection") {
      const item = response.data[0] as Record<string, unknown>;
      return (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {Object.entries(item).slice(0, 8).map(([key, value]) => (
            <div key={key} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{keyLabel(key)}</p>
              <p className="mt-2 text-sm font-semibold text-white">{typeof value === "string" ? value : value === null || value === undefined ? "—" : JSON.stringify(value)}</p>
            </div>
          ))}
        </div>
      );
    }

    if (response.resultType === "trailer_history") {
      return (
        <div className="mt-4 space-y-3">
          {response.data.map((row) => {
            const item = row as Record<string, unknown>;
            return (
              <div key={String(item.id ?? Math.random())} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-white">{String(item.title ?? item.eventType ?? "Event")}</p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                    {String(item.sourceModule ?? "system")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-300">{String(item.description ?? "No description")}</p>
                <p className="mt-2 text-xs text-slate-500">{formatTimestamp(String(item.occurredAt ?? response.timestamp))}</p>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
        <table className="min-w-full text-left text-sm text-slate-200">
          <thead className="border-b border-white/10 text-xs uppercase tracking-[0.2em] text-slate-500">
            <tr>
              {Object.keys(response.data[0] as Record<string, unknown>).slice(0, 6).map((key) => (
                <th key={key} className="px-4 py-3">{keyLabel(key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {response.data.map((row, index) => {
              const item = row as Record<string, unknown>;
              return (
                <tr key={String(item.id ?? index)} className="border-t border-white/5">
                  {Object.values(item).slice(0, 6).map((value, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-3 align-top text-slate-300">
                      {typeof value === "string" ? value : value === null || value === undefined ? "—" : JSON.stringify(value)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_30%),linear-gradient(135deg,_#020617_0%,_#0f172a_55%,_#111827_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl shadow-black/20 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">Ferryspeed TrailerHub</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">AI Assistant</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">
                Ask questions about live trailer, compound, export and vessel data. This first version is read-only and uses approved intents only.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
              <Bot className="h-4 w-4" />
              Read-only assistant
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendQuestion(question);
                }}
                className="space-y-4"
              >
                <label className="block text-sm font-medium text-slate-200" htmlFor="assistant-question">
                  Ask a question
                </label>
                <div className="flex flex-col gap-3 lg:flex-row">
                  <textarea
                    id="assistant-question"
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendQuestion(question);
                      }
                    }}
                    placeholder="Where is trailer PFF1216?"
                    rows={3}
                    maxLength={500}
                    className="min-h-[84px] flex-1 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-cyan-400/50"
                  />
                  <div className="flex flex-col gap-2 lg:w-44">
                    <button
                      type="submit"
                      disabled={isSending}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Ask
                    </button>
                    <button
                      type="button"
                      onClick={clearConversation}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-800 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
                    >
                      <Trash2 className="h-4 w-4" />
                      Clear Conversation
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {error}
                  </div>
                ) : null}
              </form>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">Examples</p>
                  <p className="mt-1 text-sm text-slate-300">Click a question to run it immediately.</p>
                </div>
                <Sparkles className="h-5 w-5 text-cyan-300" />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {renderedExamples.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setQuestion(item);
                      void sendQuestion(item);
                    }}
                    className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-2 text-left text-xs font-medium text-slate-200 transition hover:border-cyan-400/30 hover:bg-cyan-500/10"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">Conversation</h2>
                <span className="text-xs text-slate-400">{hasConversation ? `${conversation.length} message${conversation.length === 1 ? "" : "s"}` : "No messages yet"}</span>
              </div>

              {conversation.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-900/60 p-6 text-sm text-slate-400">
                  Try a question about a specific trailer, compound occupancy, vessel operations, or inspection history.
                </div>
              ) : (
                <div className="space-y-4">
                  {conversation.map((item) => (
                    <article key={item.id} className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/10 backdrop-blur">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-2 text-cyan-200">
                          <Search className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Question</p>
                          <p className="mt-1 text-base font-semibold text-white">{item.question}</p>
                          <p className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                            <Clock3 className="h-3.5 w-3.5" />
                            {formatTimestamp(item.createdAt)}
                          </p>
                        </div>
                      </div>

                      {item.error ? (
                        <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                          {item.error}
                        </div>
                      ) : item.response ? (
                        <div className="mt-4 space-y-4">
                          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
                            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-cyan-100">
                              <span className="rounded-full border border-cyan-400/20 bg-cyan-500/15 px-2.5 py-1">{item.response.provider}</span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{item.response.intent}</span>
                              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">{item.response.resultType}</span>
                              {item.response.truncated ? <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-amber-100">Truncated</span> : null}
                              {item.response.usedFallback ? <span className="rounded-full border border-slate-400/20 bg-slate-500/10 px-2.5 py-1 text-slate-200">Fallback</span> : null}
                            </div>
                            <p className="mt-3 text-sm text-white">{item.response.answer}</p>
                            <p className="mt-2 text-xs text-slate-300">{formatTimestamp(item.response.timestamp)}</p>
                            {item.response.notice ? <p className="mt-2 text-xs text-amber-200">{item.response.notice}</p> : null}
                          </div>

                          {item.response.links.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {item.response.links.map((link) => (
                                <Link key={`${item.id}-${link.href}`} href={link.href} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                                  {link.label}
                                  <ArrowRight className="h-4 w-4" />
                                </Link>
                              ))}
                            </div>
                          ) : null}

                          {renderStructuredData(item.response)}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-400">
                          Waiting for answer...
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">Capabilities</p>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <p>Read-only queries only. No state changes, no SQL, no writes.</p>
                <p>Uses authenticated Supabase sessions and approved intents only.</p>
                <p>Results are limited to 50 rows and truncated where required.</p>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/20 backdrop-blur">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-500">Example intents</p>
              <div className="mt-4 space-y-2 text-sm text-slate-300">
                <p>Trailer lookup and location</p>
                <p>Compound counts and lists</p>
                <p>Waiting for compound queue</p>
                <p>Arrivals and departures today</p>
                <p>Export allocations by status</p>
                <p>Damage and temperature alerts</p>
                <p>Latest inspection and history</p>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
