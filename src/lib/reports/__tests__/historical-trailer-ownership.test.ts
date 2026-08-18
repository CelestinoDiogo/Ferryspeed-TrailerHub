import { describe, expect, it } from "vitest";
import { resolveHistoricalOwnership } from "@/lib/reports/historical-trailer-ownership";

describe("historical trailer ownership", () => {
  it("keeps explicit operation ownership authoritative over later state", () => {
    expect(resolveHistoricalOwnership({
      operationSnapshot: { ownership_type: "outsourcing", trailer_source: "outsourced", external_company: "External Owner" },
      sourceSnapshot: { ownership_type: "company", trailer_source: "company" },
    })).toBe("outsourcing");

    expect(resolveHistoricalOwnership({
      operationSnapshot: { ownership_type: "company", trailer_source: "company" },
      sourceSnapshot: { ownership_type: "outsourcing", trailer_source: "outsourced" },
    })).toBe("company");
  });

  it("keeps an explicit unknown snapshot unknown", () => {
    expect(resolveHistoricalOwnership({
      operationSnapshot: { ownership_type: "unknown", trailer_source: "unknown" },
    })).toBe("unknown");
    expect(resolveHistoricalOwnership({
      operationSnapshot: { ownership_type: "unknown", trailer_source: "unknown" },
    })).toBe("unknown");
  });

  it("uses separate immutable event evidence when an operation snapshot is unknown", () => {
    expect(resolveHistoricalOwnership({
      operationSnapshot: { ownership_type: "unknown", trailer_source: "unknown" },
      eventSnapshot: { trailer_source: "outsourced", external_company: "External Owner" },
    })).toBe("outsourcing");
  });

  it("uses an exact historical source snapshot without trailer-number matching", () => {
    expect(resolveHistoricalOwnership({ sourceSnapshot: { trailer_source: "outsourced", external_company: "External Owner" } })).toBe("outsourcing");
    expect(resolveHistoricalOwnership({})).toBe("unknown");
  });
});