"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Loader2, Mic, MicOff, Send, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AiAssistantContext, AiAssistantResponse } from "@/lib/ai-assistant-types";

type AssistantMessage = {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  response?: AiAssistantResponse;
  createdAt: string;
};

type OperationsAssistantDrawerProps = {
  open: boolean;
  onClose: () => void;
  mobile?: boolean;
  context?: Partial<AiAssistantContext>;
  title?: string;
};

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const SUGGESTED_QUESTIONS = [
  "Show waiting trailers",
  "Where is PRO810?",
  "Show priority trailers",
  "Show compound occupancy",
  "Show damaged trailers",
  "Show temperature alerts",
  "Summarise today's operation",
];

const normalizeText = (value: string) => value.trim().toLowerCase();

const getSpeechRecognitionCtor = (): SpeechRecognitionCtor | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor })
    .SpeechRecognition
    ?? (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;

  return candidate ?? null;
};

const inferPathContext = (pathname: string | null): Partial<AiAssistantContext> => {
  if (!pathname) {
    return {};
  }

  const vesselMatch = pathname.match(/^\/dashboard\/vessel-operations\/([0-9a-f-]{36})/i);
  const trailerMatch = pathname.match(/^\/dashboard\/trailers\/([0-9a-f-]{36})/i);

  return {
    pathname,
    activeVesselOperationId: vesselMatch?.[1],
    openedTrailerId: trailerMatch?.[1],
  };
};

const resolveSpeechErrorMessage = (error: string) => {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Microphone permission was denied. You can still type your question.";
  }

  if (error === "audio-capture") {
    return "No microphone was detected on this device.";
  }

  if (error === "network") {
    return "Speech recognition network error. Try again or type your question.";
  }

  return "Speech recognition failed. You can still type your question.";
};

const formatTime = (value: string) => {
  try {
    return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return value;
  }
};

const getSessionToken = async () => {
  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) {
    throw new Error("Unable to validate authentication session.");
  }

  if (sessionResult.data.session?.access_token) {
    return sessionResult.data.session.access_token;
  }

  const refreshResult = await supabase.auth.refreshSession();
  if (refreshResult.error || !refreshResult.data.session?.access_token) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  return refreshResult.data.session.access_token;
};

export function OperationsAssistantDrawer({
  open,
  onClose,
  mobile = false,
  context,
  title = "AI Operations Assistant",
}: OperationsAssistantDrawerProps) {
  const pathname = usePathname();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [confirmedPreparedActions, setConfirmedPreparedActions] = useState<Record<string, boolean>>({});
  const recognitionRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);

  const speechCtor = useMemo(() => getSpeechRecognitionCtor(), []);
  const speechSupported = Boolean(speechCtor);

  const mergedContext = useMemo<AiAssistantContext>(() => {
    const inferred = inferPathContext(pathname);
    const today = new Date().toISOString().slice(0, 10);

    return {
      pathname: context?.pathname ?? inferred.pathname,
      activeVesselOperationId: context?.activeVesselOperationId ?? inferred.activeVesselOperationId,
      selectedCompoundFilter: context?.selectedCompoundFilter,
      openedTrailerId: context?.openedTrailerId ?? inferred.openedTrailerId,
      openedTrailerNumber: context?.openedTrailerNumber,
      currentDate: context?.currentDate ?? today,
    };
  }, [context, pathname]);

  const appendMessage = (message: AssistantMessage) => {
    setMessages((current) => [...current, message]);
  };

  const sendQuestion = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || isLoading) {
      return;
    }

    setError(null);
    setSpeechError(null);

    const nowIso = new Date().toISOString();
    appendMessage({
      id: `${nowIso}-user`,
      role: "user",
      text: trimmed,
      createdAt: nowIso,
    });

    setIsLoading(true);
    setQuestion("");

    try {
      const token = await getSessionToken();
      const response = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ question: trimmed, context: mergedContext }),
      });

      const payload = (await response.json()) as AiAssistantResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Unable to answer that question right now.");
      }

      appendMessage({
        id: `${nowIso}-assistant`,
        role: "assistant",
        text: payload.summary,
        response: payload,
        createdAt: new Date().toISOString(),
      });
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unable to answer that question right now.";
      setError(message);
      appendMessage({
        id: `${nowIso}-error`,
        role: "error",
        text: message,
        createdAt: new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  };

  const handleMicClick = () => {
    if (!speechCtor) {
      setSpeechError("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    setSpeechError(null);
    const recognition = new speechCtor();
    recognition.lang = "en-GB";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? "";
      if (transcript) {
        setQuestion((current) => {
          const prefix = current.trim();
          if (!prefix) {
            return transcript;
          }
          return `${prefix} ${transcript}`;
        });
      }
    };

    recognition.onerror = (event) => {
      setSpeechError(resolveSpeechErrorMessage(event.error));
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const clearConversation = () => {
    setMessages([]);
    setError(null);
    setSpeechError(null);
    setConfirmedPreparedActions({});
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[85]" role="dialog" aria-modal="true" aria-label="AI operations assistant">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={() => {
          stopListening();
          onClose();
        }}
        aria-label="Close AI assistant"
      />

      <aside
        className={[
          "absolute bg-[#F8FAFC] shadow-2xl border-slate-200",
          mobile
            ? "inset-x-0 bottom-0 top-[8vh] rounded-t-3xl border-t px-4 pb-4 pt-3"
            : "right-0 top-0 h-full w-full max-w-[640px] border-l px-5 pb-5 pt-4",
        ].join(" ")}
      >
        <div className="flex h-full flex-col">
          <header className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Read-only</p>
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              <p className="text-sm text-slate-600">Ask operational questions using live application data.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                stopListening();
                onClose();
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700"
              aria-label="Close AI assistant"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearConversation}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear conversation
            </button>
            <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-800">
              No write actions
            </span>
          </div>

          <section className="mb-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Suggested</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => void sendQuestion(item)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-slate-500">
                <Bot className="h-7 w-7 text-cyan-700" />
                <p className="text-sm">No conversation yet. Ask an operational question to begin.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={[
                      "rounded-xl border p-3",
                      message.role === "user"
                        ? "border-cyan-200 bg-cyan-50"
                        : message.role === "error"
                          ? "border-rose-200 bg-rose-50"
                          : "border-slate-200 bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">
                        {message.role === "user" ? "Operator" : message.role === "error" ? "Error" : "Assistant"}
                      </p>
                      <p className="text-[11px] text-slate-500">{formatTime(message.createdAt)}</p>
                    </div>
                    <p className="text-sm text-slate-900">{message.text}</p>

                    {message.response ? (
                      <div className="mt-3 space-y-2">
                        {message.response.primaryMetrics && message.response.primaryMetrics.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2">
                            {message.response.primaryMetrics.map((metric, index) => (
                              <div key={`${message.id}-metric-${index}`} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
                                <p className="mt-1 text-sm font-semibold text-slate-900">{metric.value}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {typeof message.response.count === "number" ? (
                          <p className="text-xs text-slate-600">Count: {message.response.count}</p>
                        ) : null}

                        {message.response.items && message.response.items.length > 0 ? (
                          <div className="space-y-2">
                            {message.response.items.map((item, index) => (
                              <div key={`${message.id}-item-${index}`} className="rounded-lg border border-slate-200 bg-white p-2.5 text-sm">
                                <p className="font-semibold text-slate-900">{item.trailerNumber}</p>
                                <p className="text-slate-700">
                                  {item.status ?? "Status unavailable"}
                                  {item.compoundPosition ? ` · ${item.compoundPosition}` : ""}
                                </p>
                                {item.customer ? <p className="text-slate-600">{item.customer}</p> : null}
                                {item.detail ? <p className="text-slate-600">{item.detail}</p> : null}
                                {item.route ? (
                                  <Link href={item.route} className="mt-1 inline-block text-xs font-semibold text-cyan-700 hover:text-cyan-800">
                                    Open
                                  </Link>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {message.response.actions && message.response.actions.length > 0 ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {message.response.actions.map((action, index) => (
                              <Link
                                key={`${message.id}-action-${index}`}
                                href={action.route}
                                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                              >
                                {action.label}
                              </Link>
                            ))}
                          </div>
                        ) : null}

                        {message.response.sections && message.response.sections.length > 0 ? (
                          <div className="space-y-2 pt-1">
                            {message.response.sections.map((section) => (
                              <div key={`${message.id}-${section.key}`} className="rounded-lg border border-slate-200 bg-white p-2.5">
                                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{section.title}</p>
                                <div className="mt-1 space-y-1">
                                  {section.items.map((item, index) => (
                                    <p key={`${message.id}-${section.key}-${index}`} className="text-xs text-slate-700">
                                      <span className="font-semibold text-slate-900">{item.label}:</span> {item.value}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {message.response.alerts && message.response.alerts.length > 0 ? (
                          <div className="space-y-2 pt-1">
                            {message.response.alerts.map((alert, index) => (
                              <div
                                key={`${message.id}-alert-${index}`}
                                className={`rounded-lg border px-2.5 py-2 text-xs ${alert.severity === "critical" ? "border-rose-200 bg-rose-50 text-rose-900" : alert.severity === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}
                              >
                                <p className="inline-flex items-center gap-1 font-semibold">
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {alert.severity.toUpperCase()}
                                </p>
                                <p className="mt-1">{alert.message}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {message.response.preparedActions && message.response.preparedActions.length > 0 ? (
                          <div className="space-y-2 pt-1">
                            {message.response.preparedActions.map((preparedAction) => {
                              const confirmationKey = `${message.id}:${preparedAction.id}`;
                              const isConfirmed = confirmedPreparedActions[confirmationKey] === true;

                              return (
                                <div key={confirmationKey} className="rounded-lg border border-cyan-200 bg-cyan-50 p-2.5">
                                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">Safe Action</p>
                                  <p className="mt-1 text-sm font-semibold text-slate-900">{preparedAction.label}</p>
                                  <p className="mt-1 text-xs text-slate-700">{preparedAction.confirmationPrompt}</p>
                                  <p className="mt-1 text-[11px] text-slate-600">Safety: {preparedAction.safetyLevel} · Read-only AI</p>

                                  {!isConfirmed ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmedPreparedActions((current) => ({
                                          ...current,
                                          [confirmationKey]: true,
                                        }));
                                      }}
                                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Confirm action plan
                                    </button>
                                  ) : (
                                    <Link
                                      href={preparedAction.moduleHref}
                                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-cyan-600 px-2.5 py-1.5 text-xs font-semibold text-white"
                                    >
                                      Open {preparedAction.moduleLabel}
                                    </Link>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                ))}

                {isLoading ? (
                  <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading response...
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendQuestion(question);
            }}
            className="mt-3 rounded-2xl border border-slate-200 bg-white p-3"
          >
            <label htmlFor="assistant-question" className="mb-1 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Ask question
            </label>
            <textarea
              id="assistant-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Where is PRO810?"
              className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-cyan-500"
            />

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="min-h-[18px] text-xs text-slate-600">
                {speechError ? speechError : error ? error : null}
              </div>
              <div className="flex items-center gap-2">
                {speechSupported ? (
                  <button
                    type="button"
                    onClick={handleMicClick}
                    className={[
                      "inline-flex h-11 w-11 items-center justify-center rounded-xl border",
                      isListening
                        ? "border-rose-300 bg-rose-50 text-rose-700"
                        : "border-slate-300 bg-white text-slate-700",
                    ].join(" ")}
                    aria-label={isListening ? "Stop microphone" : "Start microphone"}
                    title={isListening ? "Stop microphone" : "Start microphone"}
                  >
                    {isListening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </button>
                ) : null}

                <button
                  type="submit"
                  disabled={isLoading || normalizeText(question).length === 0}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-cyan-600 px-4 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  Send
                </button>
              </div>
            </div>
          </form>
        </div>
      </aside>
    </div>
  );
}
