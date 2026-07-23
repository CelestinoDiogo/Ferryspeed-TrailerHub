"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Mic, MicOff, Volume2 } from "lucide-react";
import type { RoleKey } from "@/lib/auth/roles";
import { supabase } from "@/lib/supabase";
import { parseVoiceCommand, resolveNextVoiceContext } from "@/lib/voice/parser";
import { useSpeechRecognition } from "@/lib/voice/speech-recognition";
import {
  getVoiceResponsesEnabled,
  isSpeechSynthesisSupported,
  setVoiceResponsesEnabled,
  speakVoiceResponse,
} from "@/lib/voice/speech-synthesis";
import { initialVoiceContext, isVoiceActionIntent, type VoiceContext, type VoiceExecutionResponse } from "@/lib/voice/types";

type VoiceOperationsPanelProps = {
  roleKey: RoleKey | null;
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

  const refresh = await supabase.auth.refreshSession();
  if (refresh.data.session?.access_token) {
    return refresh.data.session.access_token;
  }

  if (!user) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  throw new Error(refresh.error?.message ?? "Unable to refresh authentication session.");
};

export function VoiceOperationsPanel({ roleKey }: VoiceOperationsPanelProps) {
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<VoiceContext>(initialVoiceContext);
  const [response, setResponse] = useState<VoiceExecutionResponse | null>(null);
  const [pendingConfirmationText, setPendingConfirmationText] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceResponsesEnabled, setVoiceResponsesState] = useState(getVoiceResponsesEnabled());

  const {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    error: speechError,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition({ language: "en-GB", continuous: true });

  const effectiveTranscript = useMemo(() => {
    const parts = [transcript, interimTranscript].filter((item) => item.trim().length > 0);
    return parts.join(" ").trim();
  }, [interimTranscript, transcript]);

  const currentInput = draft.trim().length > 0 ? draft : effectiveTranscript;

  const executeVoiceCommand = useCallback(
    async (commandText: string, confirmed: boolean) => {
      setIsExecuting(true);
      setError(null);

      try {
        const token = await getSessionToken();
        const apiResponse = await fetch("/api/voice-operations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            commandText,
            context,
            confirmed,
          }),
        });

        const payload = (await apiResponse.json()) as VoiceExecutionResponse & { error?: string };

        if (apiResponse.status === 401) {
          throw new Error(SESSION_EXPIRED_MESSAGE);
        }

        if (!apiResponse.ok) {
          throw new Error(payload.error ?? "Voice command failed.");
        }

        setResponse(payload);
        setContext(payload.context);

        if (payload.mode === "action" && payload.actionPlan && !confirmed) {
          setPendingConfirmationText(commandText);
        } else {
          setPendingConfirmationText(null);
        }

        if (voiceResponsesEnabled && isSpeechSynthesisSupported()) {
          speakVoiceResponse(payload.message);
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Voice command failed.");
      } finally {
        setIsExecuting(false);
      }
    },
    [context, voiceResponsesEnabled],
  );

  const handleRun = useCallback(async () => {
    const text = currentInput.trim();
    if (!text || isExecuting) {
      return;
    }

    const parsed = parseVoiceCommand(text, context);
    const nextContext = resolveNextVoiceContext(context, parsed);
    setContext(nextContext);

    if (parsed.clarification) {
      setResponse(null);
      setPendingConfirmationText(null);
      setError(parsed.clarification);
      return;
    }

    if (isVoiceActionIntent(parsed.intent)) {
      setPendingConfirmationText(text);
    } else {
      setPendingConfirmationText(null);
    }

    await executeVoiceCommand(text, false);
  }, [context, currentInput, executeVoiceCommand, isExecuting]);

  const handleConfirm = useCallback(async () => {
    if (!pendingConfirmationText || isExecuting) {
      return;
    }

    await executeVoiceCommand(pendingConfirmationText, true);
  }, [executeVoiceCommand, isExecuting, pendingConfirmationText]);

  const handleToggleVoiceResponses = useCallback(() => {
    const nextValue = !voiceResponsesEnabled;
    setVoiceResponsesState(nextValue);
    setVoiceResponsesEnabled(nextValue);
  }, [voiceResponsesEnabled]);

  return (
    <section className="rounded-3xl border border-cyan-200 bg-cyan-50/70 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-700">Voice Operations</p>
          <p className="mt-1 text-sm font-medium text-slate-900">Hands-free commands with mandatory safety confirmation.</p>
        </div>
        <button
          type="button"
          onClick={handleToggleVoiceResponses}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full border ${voiceResponsesEnabled ? "border-cyan-400 bg-cyan-100 text-cyan-800" : "border-slate-300 bg-white text-slate-500"}`}
          aria-label="Toggle voice responses"
        >
          <Volume2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 rounded-2xl border border-cyan-200 bg-white px-3 py-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder={isSupported ? "Say or type a command: 'where is trailer FS1234'" : "Type a command: 'daily operations summary'"}
          className="w-full resize-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />

        {isSupported ? (
          <p className="mt-2 text-xs text-slate-500">Live transcript: {effectiveTranscript || "-"}</p>
        ) : (
          <p className="mt-2 text-xs text-amber-700">Speech recognition is not supported in this browser. Text command fallback is active.</p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={isListening ? stopListening : startListening}
          disabled={!isSupported}
          className={`inline-flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold ${isListening ? "bg-rose-100 text-rose-800" : "bg-cyan-100 text-cyan-800"} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400`}
        >
          {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {isListening ? "Stop" : "Listen"}
        </button>

        <button
          type="button"
          onClick={handleRun}
          disabled={isExecuting || currentInput.trim().length === 0}
          className="rounded-xl bg-slate-900 px-2 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {isExecuting ? "Running..." : "Run"}
        </button>

        <button
          type="button"
          onClick={() => {
            setDraft("");
            resetTranscript();
            setPendingConfirmationText(null);
            setResponse(null);
            setError(null);
          }}
          className="rounded-xl bg-white px-2 py-2 text-xs font-semibold text-slate-700"
        >
          Reset
        </button>
      </div>

      {pendingConfirmationText ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          <p className="font-semibold">Confirmation required</p>
          <p className="mt-1">Write commands are blocked until you confirm.</p>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isExecuting}
            className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-amber-300"
          >
            {isExecuting ? "Confirming..." : "Confirm command"}
          </button>
        </div>
      ) : null}

      {speechError ? <p className="mt-3 text-xs text-rose-700">{speechError}</p> : null}
      {error ? <p className="mt-3 text-xs text-rose-700">{error}</p> : null}

      {response ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800">
          <p className="font-semibold text-slate-900">{response.message}</p>
          {response.assistantResult?.title ? <p className="mt-1 text-xs text-slate-500">{response.assistantResult.title}</p> : null}
          {response.assistantResult ? (
            <p className="mt-2 text-xs text-slate-600">Result type: {response.assistantResult.resultType} · Rows: {response.assistantResult.dataCount}</p>
          ) : null}
          {response.actionPlan ? (
            <div className="mt-2">
              <p className="text-xs text-slate-600">Action is routed to existing {response.actionPlan.moduleLabel} workflow.</p>
              <Link href={response.actionPlan.moduleHref} className="mt-2 inline-flex rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white">
                Open {response.actionPlan.moduleLabel}
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="mt-3 text-[11px] text-slate-500">
        Current role: {roleKey ?? "unassigned"}. Voice commands respect the same permissions as operational modules.
      </p>
    </section>
  );
}
