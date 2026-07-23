"use client";

const VOICE_RESPONSES_KEY = "trailerhub.voice.responses.enabled";

export const getVoiceResponsesEnabled = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(VOICE_RESPONSES_KEY) === "1";
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

  return "speechSynthesis" in window;
};

export const speakVoiceResponse = (text: string) => {
  if (!isSpeechSynthesisSupported() || !text.trim()) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.trim());
  utterance.lang = "en-GB";
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
};
