import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELIVERED_WITH_ESCORT,
  DEFAULT_ESCORT_NEEDED,
  matchesEscortFilter,
  parseEscortFilter,
  resolveDeliveredWithEscortOnCompletion,
  shouldShowEscortBadge,
} from "@/lib/operations/escort-flags";

describe("escort operational flags", () => {
  it("defaults planned escort to no", () => {
    expect(DEFAULT_ESCORT_NEEDED).toBe(false);
    expect(DEFAULT_DELIVERED_WITH_ESCORT).toBe(false);
    expect(parseEscortFilter(null)).toBe("all");
  });

  it("filters escort needed, delivered with escort, and no escort records", () => {
    const needed = { escortNeeded: true, deliveredWithEscort: false };
    const delivered = { escortNeeded: true, deliveredWithEscort: true };
    const usedWithoutPlan = { escortNeeded: false, deliveredWithEscort: true };
    const none = { escortNeeded: false, deliveredWithEscort: false };

    expect(matchesEscortFilter(needed, "needed")).toBe(true);
    expect(matchesEscortFilter(delivered, "needed")).toBe(true);
    expect(matchesEscortFilter(none, "needed")).toBe(false);

    expect(matchesEscortFilter(delivered, "delivered")).toBe(true);
    expect(matchesEscortFilter(usedWithoutPlan, "delivered")).toBe(true);
    expect(matchesEscortFilter(needed, "delivered")).toBe(false);

    expect(matchesEscortFilter(none, "none")).toBe(true);
    expect(matchesEscortFilter(needed, "none")).toBe(false);
    expect(matchesEscortFilter(usedWithoutPlan, "none")).toBe(false);
  });

  it("records delivered with escort from the planned flag without a confirmation screen", () => {
    expect(resolveDeliveredWithEscortOnCompletion({
      escortNeeded: true,
      deliveredWithEscort: false,
    })).toBe(true);
    expect(resolveDeliveredWithEscortOnCompletion({
      escortNeeded: false,
      deliveredWithEscort: false,
    })).toBe(false);
    expect(resolveDeliveredWithEscortOnCompletion({
      escortNeeded: false,
      deliveredWithEscort: true,
    })).toBe(true);
  });

  it("shows a compact escort badge for needed or delivered-with-escort records", () => {
    expect(shouldShowEscortBadge({ escortNeeded: true })).toBe(true);
    expect(shouldShowEscortBadge({ deliveredWithEscort: true })).toBe(true);
    expect(shouldShowEscortBadge({ escortNeeded: false, deliveredWithEscort: false })).toBe(false);
  });

  it("reuses existing planned/actual escort fields without adding driver entities", () => {
    const exportNewPage = readFileSync(new URL("../../../app/dashboard/export-operations/new/page.tsx", import.meta.url), "utf8");
    const exportDetailPage = readFileSync(new URL("../../../app/dashboard/export-operations/[id]/page.tsx", import.meta.url), "utf8");
    const persistImport = readFileSync(new URL("../../imports/export-allocation-import-persist.ts", import.meta.url), "utf8");
    const migration = readFileSync(new URL("../../../../supabase/migrations/061_escort_needed_and_delivered_with_escort.sql", import.meta.url), "utf8");

    expect(exportNewPage).toContain("escortNeeded: DEFAULT_ESCORT_NEEDED");
    expect(exportNewPage).toContain("escort_needed: formState.escortNeeded");
    expect(exportDetailPage).toContain("escort_needed: formState.escort_needed");
    expect(exportDetailPage).toContain("delivered_with_escort: formState.delivered_with_escort");
    expect(persistImport).toContain("escort_needed: false");
    expect(persistImport).toContain("delivered_with_escort: false");
    expect(migration).toContain("add column if not exists escort_needed");
    expect(migration).toContain("add column if not exists delivered_with_escort");
    expect(migration).not.toMatch(/escort_driver/i);
  });
});
