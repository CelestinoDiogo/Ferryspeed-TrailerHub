"use client";

const VOICE_RESPONSES_KEY = "trailerhub.voice.responses.enabled";

type VoiceResponseCallbacks = {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (reason: string) => void;
};

type SpeakVoiceResponseOptions = {
  lang?: string;
  callbacks?: VoiceResponseCallbacks;
};

let activeUtterance: SpeechSynthesisUtterance | null = null;

const normalizeLanguage = (value?: string) => value?.trim() || "en-GB";

const toSpeechErrorReason = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized) {
    return "error";
  }

  return normalized;
};

export const buildVoiceTestPhrase = (language: string) => {
  return language.toLowerCase().startsWith("pt") ? "Teste de voz Ferryspeed." : "Ferryspeed voice test.";
};

export const resetVoiceResponseSpeechState = () => {
  activeUtterance = null;
};

export const getVoiceResponsesEnabled = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const stored = window.localStorage.getItem(VOICE_RESPONSES_KEY);
  if (stored === null) {
    return true;
  }

  return stored === "1";
};

export const setVoiceResponsesEnabled = (enabled: boolean) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(VOICE_RESPONSES_KEY, enabled ? "1" : "0");
};

export const isSpeechSynthesisSupported = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function");
};

export const cancelVoiceResponseSpeech = () => {
  if (!isSpeechSynthesisSupported() || !activeUtterance) {
    return;
  }

  window.speechSynthesis.cancel();
  activeUtterance = null;
};

export const speakVoiceResponse = (text: string, options?: SpeakVoiceResponseOptions) => {
  if (!isSpeechSynthesisSupported() || !text.trim()) {
    return false;
  }

  const utterance = new SpeechSynthesisUtterance(text.trim());
  const language = normalizeLanguage(options?.lang);
  const callbacks = options?.callbacks;

  if (activeUtterance) {
    window.speechSynthesis.cancel();
    activeUtterance = null;
  }

  if (window.speechSynthesis.paused && typeof window.speechSynthesis.resume === "function") {
    window.speechSynthesis.resume();
  }

  utterance.lang = language;
  utterance.rate = 1;
  utterance.pitch = 1;

  utterance.onstart = () => {
    if (activeUtterance === utterance) {
      callbacks?.onStart?.();
    }
  };

  utterance.onend = () => {
    if (activeUtterance === utterance) {
      activeUtterance = null;
    }
    callbacks?.onEnd?.();
  };

  utterance.onerror = (event) => {
    if (activeUtterance === utterance) {
      activeUtterance = null;
    }

    callbacks?.onError?.(toSpeechErrorReason(event.error));
  };

  activeUtterance = utterance;
  window.speechSynthesis.speak(utterance);

  return true;
};
