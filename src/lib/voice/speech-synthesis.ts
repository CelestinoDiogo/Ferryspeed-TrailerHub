"use client";

const VOICE_RESPONSES_KEY = "trailerhub.voice.responses.enabled";

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

export const speakVoiceResponse = (text: string, options?: { lang?: string }) => {
  if (!isSpeechSynthesisSupported() || !text.trim()) {
    return;
  }

  window.speechSynthesis.cancel();

  if (typeof window.speechSynthesis.resume === "function") {
    window.speechSynthesis.resume();
  }

  const utterance = new SpeechSynthesisUtterance(text.trim());
  const language = options?.lang?.trim() || "en-GB";
  utterance.lang = language;
  utterance.rate = 1;
  utterance.pitch = 1;

  if (typeof window.speechSynthesis.getVoices === "function") {
    const voices = window.speechSynthesis.getVoices();
    const normalizedLanguage = language.toLowerCase();
    const preferredVoice = voices.find((voice) => {
      const voiceLanguage = voice.lang?.toLowerCase() ?? "";
      return voiceLanguage === normalizedLanguage || voiceLanguage.startsWith(normalizedLanguage.slice(0, 2));
    });

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
  }

  window.speechSynthesis.speak(utterance);
};
