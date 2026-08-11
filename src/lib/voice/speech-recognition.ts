"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly [index: number]: {
    readonly transcript: string;
  };
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

type UseSpeechRecognitionOptions = {
  language?: string;
  continuous?: boolean;
};

export type SpeechRecognitionState = {
  isSupported: boolean;
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
};

export const describeSpeechRecognitionError = (code?: string | null) => {
  const normalizedCode = code?.trim().toLowerCase() ?? "";

  if (!normalizedCode) {
    return "Voice recognition failed. Please try again.";
  }

  if (normalizedCode === "not-allowed" || normalizedCode === "service-not-allowed") {
    return "Microphone access was denied. On iPhone, allow Safari microphone access and retry.";
  }

  if (normalizedCode === "audio-capture") {
    return "No microphone was found on this device.";
  }

  if (normalizedCode === "no-speech") {
    return "No speech was detected.";
  }

  if (normalizedCode === "network") {
    return "Speech recognition network error.";
  }

  if (normalizedCode === "aborted") {
    return "Voice recognition was stopped before it finished. Try again.";
  }

  if (normalizedCode === "language-not-supported") {
    return "This recognition language is not supported on this device.";
  }

  if (normalizedCode === "invalidstateerror") {
    return "Speech recognition could not start on this device. Reload Safari and retry.";
  }

  if (normalizedCode === "bad-grammar") {
    return "The speech request could not be understood. Try a shorter command.";
  }

  return `Voice recognition failed (${normalizedCode}). Please try again.`;
};

export const useSpeechRecognition = (options?: UseSpeechRecognitionOptions): SpeechRecognitionState => {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const isSupported = useMemo(() => {
    if (typeof window === "undefined") {
      return false;
    }

    const typedWindow = window as SpeechRecognitionWindow;
    return Boolean(typedWindow.SpeechRecognition || typedWindow.webkitSpeechRecognition);
  }, []);

  useEffect(() => {
    if (!isSupported || typeof window === "undefined") {
      return;
    }

    const typedWindow = window as SpeechRecognitionWindow;
    const Constructor = typedWindow.SpeechRecognition ?? typedWindow.webkitSpeechRecognition;
    if (!Constructor) {
      return;
    }

    const recognition = new Constructor();
    recognition.continuous = options?.continuous ?? true;
    recognition.interimResults = true;
    recognition.lang = options?.language ?? "en-GB";

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const candidate = result[0]?.transcript?.trim() ?? "";

        if (!candidate) {
          continue;
        }

        if (result.isFinal) {
          finalText += `${candidate} `;
        } else {
          interimText += `${candidate} `;
        }
      }

      if (finalText.trim().length > 0) {
        setTranscript((current) => `${current} ${finalText}`.trim());
      }

      setInterimTranscript(interimText.trim());
    };

    recognition.onerror = (event) => {
      setError(describeSpeechRecognitionError(event.error));
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript("");
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [isSupported, options?.continuous, options?.language]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListening) {
      return;
    }

    setError(null);

    try {
      recognitionRef.current.start();
    } catch (startError) {
      setIsListening(false);
      setError(describeSpeechRecognitionError(startError instanceof Error ? startError.name : null));
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (!recognitionRef.current || !isListening) {
      return;
    }

    try {
      recognitionRef.current.stop();
    } catch (stopError) {
      setIsListening(false);
      setError(describeSpeechRecognitionError(stopError instanceof Error ? stopError.name : null));
    }
  }, [isListening]);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setError(null);
  }, []);

  return {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    error,
    startListening,
    stopListening,
    resetTranscript,
  };
};
