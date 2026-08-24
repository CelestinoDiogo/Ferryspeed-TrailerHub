import { describe, expect, it } from "vitest";
import {
  asImportOperationalTrailerNumber,
  normalizeImportTrailerNumber,
  parseImportDate,
  parseImportDateTime,
} from "@/lib/imports/import-normalize";

describe("export import trailer normalization", () => {
  it("compacts operational trailer numbers with internal spaces", () => {
    expect(normalizeImportTrailerNumber("PKD 22")).toBe("PKD22");
    expect(normalizeImportTrailerNumber("FSC 1310")).toBe("FSC1310");
    expect(normalizeImportTrailerNumber("FS 79")).toBe("FS79");
    expect(normalizeImportTrailerNumber("FAB 12")).toBe("FAB12");
    expect(normalizeImportTrailerNumber("CRB 504")).toBe("CRB504");
    expect(normalizeImportTrailerNumber("PKD  28")).toBe("PKD28");
    expect(normalizeImportTrailerNumber("PKD\u00A022")).toBe("PKD22");
    expect(normalizeImportTrailerNumber("\t FSC 1336 \n")).toBe("FSC1336");
  });

  it("leaves already-canonical trailer numbers unchanged", () => {
    expect(normalizeImportTrailerNumber("PKD22")).toBe("PKD22");
    expect(normalizeImportTrailerNumber("MAIL18-10")).toBe("MAIL18-10");
    expect(normalizeImportTrailerNumber("PFC49")).toBe("PFC49");
  });

  it("treats compacted operational ids as valid format", () => {
    expect(asImportOperationalTrailerNumber("PKD 22")).toBe("PKD22");
    expect(asImportOperationalTrailerNumber("DSV2045")).toBe("DSV2045");
    expect(asImportOperationalTrailerNumber("***")).toBe("");
    expect(asImportOperationalTrailerNumber("NOID")).toBe("");
  });
});

describe("export import Excel date conversion", () => {
  it("converts Excel serial dates and date-times", () => {
    expect(parseImportDate("46258")).toBe("2026-08-24");
    expect(parseImportDateTime("46258")).toBe("2026-08-24");
    expect(parseImportDateTime("46258.583333333336")).toBe("2026-08-24T14:00:00.000Z");
    expect(parseImportDate("21/08/2026")).toBe("2026-08-21");
    expect(parseImportDate("2026-08-21")).toBe("2026-08-21");
  });

  it("does not treat serial text as a locale Date parse", () => {
    expect(parseImportDate("46258")).not.toBe("46258");
    expect(parseImportDateTime("46258.583333333336")).not.toContain("46258");
  });
});
