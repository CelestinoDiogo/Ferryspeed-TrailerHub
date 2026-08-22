import { describe, expect, it } from "vitest";
import { isTrailerPresentInCompoundInventory } from "@/lib/export-allocation";

describe("search filter=compound canonical presence", () => {
  const match = (
    trailer: {
      id: string;
      compound_position?: string | null;
      departure_date?: string | null;
      is_local?: boolean | null;
      active_export_allocation?: { status?: string | null } | null;
    },
  ) =>
    isTrailerPresentInCompoundInventory(
      trailer,
      trailer.active_export_allocation?.status ?? null,
    );

  it("excludes Local, departed, no-position Main List, and off-compound Export", () => {
    expect(match({ id: "local", is_local: true, compound_position: "P01", departure_date: null })).toBe(false);
    expect(
      match({ id: "departed", is_local: false, compound_position: "P01", departure_date: "2026-08-03" }),
    ).toBe(false);
    expect(match({ id: "waiting", is_local: false, compound_position: null, departure_date: null })).toBe(false);
    expect(
      match({
        id: "export-off",
        is_local: false,
        compound_position: "P01",
        departure_date: null,
        active_export_allocation: { status: "delivered_empty" },
      }),
    ).toBe(false);
  });

  it("includes genuine Compound presence and ALLOCATED trailers still on the yard", () => {
    expect(match({ id: "compound", is_local: false, compound_position: "P12", departure_date: null })).toBe(true);
    expect(
      match({
        id: "allocated",
        is_local: false,
        compound_position: "P12",
        departure_date: null,
        active_export_allocation: { status: "allocated" },
      }),
    ).toBe(true);
  });
});
