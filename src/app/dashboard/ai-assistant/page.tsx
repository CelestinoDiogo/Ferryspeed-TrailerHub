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

type FollowUpContext = {
  lastIntent: string | null;
  lastTrailerNumber: string | null;
  lastCustomer: string | null;
  lastStatus: string | null;
};

const exampleQuestions = [
  "Where is trailer PFF1216?",
  "Show its history.",
  "How many empty trailers are available?",
  "Which trailers are waiting for compound?",
  "How many trailers arrived today?",
  "Show me the list.",
  "How many trailers departed today?",
  "Give me today's operational summary.",
  "What vessel operations are scheduled today?",
  "Show export trailers waiting for collection.",
  "Which trailers have damage alerts?",
  "Which trailers have temperature alerts?",
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

const normalizeText = (value: string) => value.trim().toLowerCase();

const inferIntentFromQuestion = (question: string) => {
  const normalized = normalizeText(question);

  if (/show\s+its\s+history|trailer history/.test(normalized)) return "trailer_history";
  if (/where\s+is\s+trailer|where is/.test(normalized)) return "find_trailer";
  if (/latest inspection/.test(normalized)) return "latest_inspection";
  if (/how many.*arriv|count.*arriv/.test(normalized)) return "count_arrivals_today";
  if (/how many.*depart|count.*depart/.test(normalized)) return "count_departures_today";
  if (/arrived today|what arrived today|list.*arriv/.test(normalized)) return "arrivals_today";
  if (/departed today|what departed today|list.*depart/.test(normalized)) return "departures_today";
  if (/operational summary|daily summary/.test(normalized)) return "operations_summary_today";
  if (/vessel operations/.test(normalized)) return "vessel_operations_today";
  if (/waiting for compound/.test(normalized)) return "list_waiting_compound";
  if (/empty trailers/.test(normalized)) return normalized.includes("how many") ? "count_empty" : "list_empty";
  if (/loaded trailers/.test(normalized)) return normalized.includes("how many") ? "count_loaded" : "list_loaded";
  if (/compound/.test(normalized) && /how many|count/.test(normalized)) return "count_compound";
  if (/compound/.test(normalized)) return "list_compound";
  if (/export/.test(normalized)) return "export_by_status";
  if (/damage/.test(normalized)) return "trailers_with_damage";
  if (/temperature/.test(normalized)) return "trailers_with_temperature_alert";
  if (/customer/.test(normalized)) return "trailers_by_customer";
  return "unknown";
};

const extractFirstTrailerNumber = (response: AiAssistantResponse) => {
  const fromData = response.data.find((row) => typeof row.trailerNumber === "string")?.trailerNumber;
  if (typeof fromData === "string" && fromData.trim().length > 0) {
    return fromData.trim().toUpperCase();
  }

  const fromTitle = response.title?.match(/trailer\s+([a-z0-9-]{3,12})/i)?.[1];
  if (fromTitle) {
    return fromTitle.toUpperCase();
  }

  return null;
};

const extractFirstCustomer = (response: AiAssistantResponse) => {
  const fromData = response.data.find((row) => typeof row.customer === "string")?.customer;
  if (typeof fromData === "string" && fromData.trim().length > 0) {
    return fromData.trim();
  }
  return null;
};

const extractStatusFromQuestion = (question: string) => {
  const normalized = normalizeText(question);
  const knownStatuses = ["allocated", "delivered_empty", "waiting_loading", "collected_loaded", "completed", "cancelled"];
  const found = knownStatuses.find((status) => normalized.includes(status.replace("_", " ")) || normalized.includes(status));
  return found ?? null;
};

const resolveFollowUpQuestion = (raw: string, context: FollowUpContext) => {
  const normalized = normalizeText(raw);

  if (normalized === "show me the list." || normalized === "show me the list") {
    if (context.lastIntent === "count_arrivals_today") {
      return "What arrived today?";
    }
    if (context.lastIntent === "count_departures_today") {
      return "What departed today?";
    }
    if (context.lastIntent === "count_empty") {
      return "Show empty trailers in the compound.";
    }
    if (context.lastIntent === "count_loaded") {
      return "Show loaded trailers in the compound.";
    }
    if (context.lastIntent === "count_compound") {
      return "Show trailers in compound.";
    }
  }

  if ((normalized === "show its history." || normalized === "show its history") && context.lastTrailerNumber) {
    return `Show history for trailer ${context.lastTrailerNumber}.`;
  }

  return raw;
};

const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";

const getSessionToken = async () => {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    throw new Error(userError.message);
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (session?.access_token) {
    return session.access_token;
  }

  const refreshResult = await supabase.auth.refreshSession();
  if (refreshResult.data.session?.access_token) {
    return refreshResult.data.session.access_token;
  }

  if (!user) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  if (refreshResult.error) {
    throw new Error(refreshResult.error.message);
  }

  throw new Error("Unable to refresh authentication session.");
};

export default function AiAssistantPage() {
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUpContext, setFollowUpContext] = useState<FollowUpContext>({
    lastIntent: null,
    lastTrailerNumber: null,
    lastCustomer: null,
    lastStatus: null,
  });

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

    const effectiveQuestion = resolveFollowUpQuestion(trimmed, followUpContext);

    const createdAt = new Date().toISOString();
    const entryId = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
    setConversation((current) => [
      ...current,
      { id: entryId, question: effectiveQuestion, createdAt, response: null, error: null },
    ]);

    try {
      const token = await getSessionToken();
      const response = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: effectiveQuestion }),
      });

      const payload = (await response.json()) as AiAssistantResponse & { error?: string };

      if (response.status === 401) {
        throw new Error(SESSION_EXPIRED_MESSAGE);
      }

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to answer that question right now.");
      }

      setConversation((current) =>
        current.map((item) => (item.id === entryId ? { ...item, response: payload, error: null } : item)),
      );

      setFollowUpContext((current) => ({
        lastIntent: inferIntentFromQuestion(effectiveQuestion),
        lastTrailerNumber: extractFirstTrailerNumber(payload) ?? current.lastTrailerNumber,
        lastCustomer: extractFirstCustomer(payload) ?? current.lastCustomer,
        lastStatus: extractStatusFromQuestion(effectiveQuestion) ?? current.lastStatus,
      }));
    } catch (requestError) {
      const rawMessage = requestError instanceof Error ? requestError.message : "Unable to answer that question right now.";
      const message = rawMessage === "Auth session missing." ? SESSION_EXPIRED_MESSAGE : rawMessage;
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

    if (response.data.length === 1) {
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

    if (response.data.length <= 10) {
      return (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {response.data.map((row) => {
            const item = row as Record<string, unknown>;
            return (
              <div key={String(item.id ?? Math.random())} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                {Object.entries(item)
                  .slice(0, 6)
                  .map(([key, value]) => (
                    <div key={key} className="mb-2 last:mb-0">
                      <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500">{keyLabel(key)}</p>
                      <p className="text-sm text-slate-200">{typeof value === "string" ? value : value === null || value === undefined ? "—" : JSON.stringify(value)}</p>
                    </div>
                  ))}
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
                            {item.response.title ? <p className="text-sm font-semibold text-cyan-100">{item.response.title}</p> : null}
                            <p className="mt-3 text-sm text-white">{item.response.answer}</p>
                            <p className="mt-2 text-xs text-slate-300">Queried at {formatTimestamp(item.response.queriedAt)}</p>
                          </div>

                          {item.response.summary && item.response.summary.length > 0 ? (
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                              {item.response.summary.map((entry) => (
                                <div key={`${item.id}-${entry.label}`} className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{entry.label}</p>
                                  <p className="mt-1 text-base font-semibold text-white">{String(entry.value)}</p>
                                </div>
                              ))}
                            </div>
                          ) : null}

                          {item.response.truncated ? (
                            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                              Showing the first 50 results.
                            </div>
                          ) : null}

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

                          {item.response.links.length === 0 &&
                          item.response.data.some((row) => {
                            const record = row as Record<string, unknown>;
                            return record.linkUnavailableReason === "No operational trailer record available.";
                          }) ? (
                            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                              No operational trailer record available.
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
