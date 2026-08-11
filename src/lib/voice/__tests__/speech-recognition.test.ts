import { describe, expect, it } from "vitest";
import { describeSpeechRecognitionError } from "@/lib/voice/speech-recognition";

describe("speech recognition error messaging", () => {
  it("surfaces iPhone microphone guidance for denied access", () => {
    expect(describeSpeechRecognitionError("not-allowed")).toContain("iPhone");
    expect(describeSpeechRecognitionError("service-not-allowed")).toContain("Safari microphone access");
  });

  it("covers the most common Web Speech failure modes", () => {
    expect(describeSpeechRecognitionError("no-speech")).toBe("No speech was detected.");
    expect(describeSpeechRecognitionError("aborted")).toContain("stopped before it finished");
    expect(describeSpeechRecognitionError("language-not-supported")).toContain("not supported");
    expect(describeSpeechRecognitionError("unknown-code")).toContain("unknown-code");
  });
});