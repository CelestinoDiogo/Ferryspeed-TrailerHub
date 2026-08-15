import { describe, expect, it } from "vitest";
import {
  createHistoryDateRange,
  isDateWithinHistoryRange,
  normalizeHistoryDateRange,
} from "@/lib/history-date-range";

describe("history date ranges", () => {
  it("keeps preset ranges stable", () => {
    expect(createHistoryDateRange("last_7_days", "2026-08-15")).toEqual({
      preset: "last_7_days",
      startDate: "2026-08-09",
      endDate: "2026-08-15",
    });
  });

  it("normalizes reversed custom ranges into chronological order", () => {
    const forwardRange = {
      preset: "custom" as const,
      startDate: "2026-08-07",
      endDate: "2026-08-15",
    };
    const reversedRange = normalizeHistoryDateRange({
      preset: "custom",
      startDate: "2026-08-15",
      endDate: "2026-08-07",
    });

    expect(reversedRange).toEqual(forwardRange);
    expect(isDateWithinHistoryRange("2026-08-07", reversedRange)).toBe(true);
    expect(isDateWithinHistoryRange("2026-08-15", reversedRange)).toBe(true);
    expect(isDateWithinHistoryRange("2026-08-06", reversedRange)).toBe(false);
    expect(isDateWithinHistoryRange("2026-08-16", reversedRange)).toBe(false);
  });
});
