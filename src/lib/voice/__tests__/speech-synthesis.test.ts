// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildVoiceTestPhrase, cancelVoiceResponseSpeech, getVoiceResponsesEnabled, resetVoiceResponseSpeechState, speakVoiceResponse } from "@/lib/voice/speech-synthesis";

class MockSpeechSynthesisUtterance {
  text: string;

  lang = "";

  rate = 1;

  pitch = 1;

  voice: SpeechSynthesisVoice | null = null;

  onstart: (() => void) | null = null;

  onend: (() => void) | null = null;

  onerror: ((event: { error: string }) => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

describe("speech synthesis helper", () => {
  const cancel = vi.fn();
  const resume = vi.fn();
  const speak = vi.fn();
  const getVoices = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetVoiceResponseSpeechState();
    getVoices.mockReturnValue([]);

    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel, resume, speak, getVoices },
    });

    Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults voice responses to enabled when no preference is stored", () => {
    expect(getVoiceResponsesEnabled()).toBe(true);
  });

  it("cancels previous speech and uses the browser default voice when no match exists", () => {
    speakVoiceResponse("Hello world", { lang: "en-GB" });

    expect(cancel).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalledTimes(1);

    const utterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    expect(utterance.text).toBe("Hello world");
    expect(utterance.lang).toBe("en-GB");
    expect(utterance.voice).toBeNull();
  });

  it("invokes lifecycle callbacks from utterance events", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();

    speakVoiceResponse("Olá", {
      lang: "pt-PT",
      callbacks: {
        onStart,
        onEnd,
        onError,
      },
    });

    const utterance = speak.mock.calls[0][0] as MockSpeechSynthesisUtterance;
    utterance.onstart?.();
    utterance.onend?.();
    utterance.onerror?.({ error: "interrupted" });

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("interrupted");
  });

  it("cancels an active utterance before starting a new one", () => {
    speakVoiceResponse("First message", { lang: "en-GB" });
    speakVoiceResponse("Second message", { lang: "en-GB" });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it("builds the test voice phrase per language", () => {
    expect(buildVoiceTestPhrase("en-GB")).toBe("Ferryspeed voice test.");
    expect(buildVoiceTestPhrase("pt-PT")).toBe("Teste de voz Ferryspeed.");
  });

  it("does nothing when synthesis is unavailable", () => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: undefined,
    });

    speakVoiceResponse("Hello");

    expect(speak).not.toHaveBeenCalled();
  });

  it("cancels active speech through the explicit helper", () => {
    speakVoiceResponse("Hello");
    cancelVoiceResponseSpeech();

    expect(cancel).toHaveBeenCalledTimes(1);
  });
});