import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import {
  classifyStockCheckObservation,
  recountStockCheckObservationTotals,
  type StockCheckItem,
} from "@/lib/compound-stock-check";

const migrationSql = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/060_mark_compound_stock_check_present.sql"),
  "utf8",
);
const stockCheckPage = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/compound/stock-check/page.tsx"),
  "utf8",
);
const unexpectedRouteTest = readFileSync(
  path.resolve(process.cwd(), "src/app/api/stock-check/unexpected/__tests__/route.test.ts"),
  "utf8",
);

type MarkPresentResult =
  Database["public"]["Functions"]["mark_compound_stock_check_present"]["Returns"][number]["result"];

type SessionItem = Pick<
  StockCheckItem,
  | "id"
  | "trailer_id"
  | "trailer_number"
  | "expected_in_compound"
  | "physically_present"
  | "expected_position"
  | "actual_position"
  | "discrepancy_type"
  | "checked_at"
  | "checked_by"
  | "resolution_status"
>;

type LiveTrailer = {
  id: string;
  trailer_number: string;
  compound_position: string | null;
  load_status: string | null;
  operational_status: string | null;
};

const item = (overrides: Partial<SessionItem> = {}): SessionItem => ({
  id: "item-1",
  trailer_id: "trailer-1",
  trailer_number: "PRO810",
  expected_in_compound: true,
  physically_present: null,
  expected_position: "P10",
  actual_position: null,
  discrepancy_type: "unchecked",
  checked_at: null,
  checked_by: null,
  resolution_status: "unresolved",
  ...overrides,
});

const applyFound = (input: {
  status: "in_progress" | "cancelled" | "completed" | "missing";
  items: SessionItem[];
  expectedTotal: number;
  trailerNumber: string;
  liveTrailer?: LiveTrailer | null;
}):
  | { ok: true; result: MarkPresentResult; items: SessionItem[]; expectedTotal: number; liveTrailer: LiveTrailer | null }
  | { ok: false; error: string } => {
  if (input.status === "missing") {
    return { ok: false, error: "Stock check not found." };
  }
  if (input.status === "cancelled") {
    return { ok: false, error: "Stock check is cancelled and cannot be changed." };
  }
  if (input.status === "completed") {
    return { ok: false, error: "This stock check is already completed." };
  }

  const trailerNumber = input.trailerNumber.trim().toUpperCase();
  const existing = input.items.find((row) => (row.trailer_number ?? "").trim().toUpperCase() === trailerNumber) ?? null;
  const liveTrailer = input.liveTrailer ? { ...input.liveTrailer } : null;

  if (existing?.physically_present === true) {
    return {
      ok: true,
      result: "already_present",
      items: input.items.map((row) => ({ ...row })),
      expectedTotal: input.expectedTotal,
      liveTrailer,
    };
  }

  if (existing?.expected_in_compound === true) {
    return {
      ok: true,
      result: "marked_present",
      items: input.items.map((row) =>
        row.id === existing.id
          ? {
              ...row,
              physically_present: true,
              checked_at: row.checked_at ?? "2026-08-23T18:00:00.000Z",
              checked_by: row.checked_by ?? "Operator",
              discrepancy_type:
                !row.discrepancy_type || ["unchecked", "missing"].includes(row.discrepancy_type)
                  ? "matched"
                  : row.discrepancy_type,
            }
          : { ...row },
      ),
      expectedTotal: input.expectedTotal,
      liveTrailer,
    };
  }

  if (existing) {
    return {
      ok: true,
      result: "unexpected",
      items: input.items.map((row) =>
        row.id === existing.id
          ? {
              ...row,
              expected_in_compound: false,
              physically_present: true,
              discrepancy_type: "unexpected",
              checked_at: row.checked_at ?? "2026-08-23T18:00:00.000Z",
            }
          : { ...row },
      ),
      expectedTotal: input.expectedTotal,
      liveTrailer,
    };
  }

  return {
    ok: true,
    result: "unexpected",
    items: [
      ...input.items.map((row) => ({ ...row })),
      {
        id: "item-unexpected",
        trailer_id: liveTrailer?.id ?? null,
        trailer_number: trailerNumber,
        expected_in_compound: false,
        physically_present: true,
        expected_position: null,
        actual_position: null,
        discrepancy_type: "unexpected",
        checked_at: "2026-08-23T18:00:00.000Z",
        checked_by: "Operator",
        resolution_status: "unresolved",
      },
    ],
    expectedTotal: input.expectedTotal,
    liveTrailer,
  };
};

describe("mark_compound_stock_check_present RPC", () => {
  it("matches the typed RPC contract used by Stock Check Found", () => {
    type Args = Database["public"]["Functions"]["mark_compound_stock_check_present"]["Args"];
    type Row = Database["public"]["Functions"]["mark_compound_stock_check_present"]["Returns"][number];

    const args: Args = {
      p_stock_check_id: "273206eb-2cb0-4529-8f67-e5d7d8fab4f1",
      p_trailer_number: "PRO810",
      p_checked_by: "Operator",
    };
    const row: Row = {
      stock_check_id: args.p_stock_check_id,
      stock_check_item_id: "item-1",
      trailer_number: "PRO810",
      result: "marked_present",
      checked_total: 1,
      present_total: 1,
      expected_total: 49,
      remaining_total: 48,
    };

    expect(stockCheckPage).toContain('supabase.rpc("mark_compound_stock_check_present"');
    expect(stockCheckPage).toContain("p_stock_check_id:");
    expect(stockCheckPage).toContain("p_trailer_number:");
    expect(stockCheckPage).toContain("p_checked_by:");
    expect(migrationSql).toContain("create or replace function public.mark_compound_stock_check_present(");
    expect(migrationSql).toContain("p_stock_check_id uuid");
    expect(migrationSql).toContain("p_trailer_number text");
    expect(migrationSql).toContain("p_checked_by text");
    expect(migrationSql).toContain("marked_present");
    expect(migrationSql).toContain("already_present");
    expect(migrationSql).toContain("unexpected");
    expect(row.result).toBe("marked_present");
  });

  it("marks an unchecked expected trailer Found without changing Expected or live trailer state", () => {
    const liveTrailer = {
      id: "trailer-1",
      trailer_number: "PRO810",
      compound_position: "P10",
      load_status: "Empty",
      operational_status: "In Compound",
    };
    const result = applyFound({
      status: "in_progress",
      expectedTotal: 2,
      trailerNumber: "PRO810",
      liveTrailer,
      items: [item(), item({ id: "item-2", trailer_id: "trailer-2", trailer_number: "PRO811", expected_position: "P11" })],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.result).toBe("marked_present");
    expect(result.expectedTotal).toBe(2);
    expect(result.items.filter((row) => row.expected_in_compound === true)).toHaveLength(2);
    expect(result.items[0]?.physically_present).toBe(true);
    expect(result.items[0]?.expected_position).toBe("P10");
    expect(result.items[0]?.actual_position).toBeNull();
    expect(result.liveTrailer).toEqual(liveTrailer);
    expect(recountStockCheckObservationTotals(result.items as StockCheckItem[]).present_total).toBe(1);
  });

  it("returns already_present on repeated Found without duplicating the item", () => {
    const present = item({
      physically_present: true,
      checked_at: "2026-08-23T17:00:00.000Z",
      discrepancy_type: "matched",
    });
    const first = applyFound({
      status: "in_progress",
      expectedTotal: 1,
      trailerNumber: "PRO810",
      items: [present],
    });
    const second = applyFound({
      status: "in_progress",
      expectedTotal: 1,
      trailerNumber: "pro810",
      items: first.ok ? first.items : [present],
    });

    expect(first.ok && first.result).toBe("already_present");
    expect(second.ok && second.result).toBe("already_present");
    expect(second.ok && second.items).toHaveLength(1);
  });

  it("records Unexpected without converting it to Expected or changing expected_total", () => {
    const liveTrailer = {
      id: "trailer-ghost",
      trailer_number: "ZZZ999",
      compound_position: "P04",
      load_status: "Loaded",
      operational_status: "In Compound",
    };
    const result = applyFound({
      status: "in_progress",
      expectedTotal: 1,
      trailerNumber: "ZZZ999",
      liveTrailer,
      items: [item()],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.result).toBe("unexpected");
    expect(result.expectedTotal).toBe(1);
    expect(result.items).toHaveLength(2);
    const unexpected = result.items.find((row) => row.trailer_number === "ZZZ999");
    expect(unexpected?.expected_in_compound).toBe(false);
    expect(unexpected?.physically_present).toBe(true);
    expect(unexpected?.expected_position).toBeNull();
    expect(unexpected?.actual_position).toBeNull();
    expect(classifyStockCheckObservation(unexpected as StockCheckItem).unexpected).toBe(true);
    expect(result.items.filter((row) => row.expected_in_compound === true)).toHaveLength(1);
    expect(result.liveTrailer?.compound_position).toBe("P04");
    expect(result.liveTrailer?.load_status).toBe("Loaded");
  });

  it("does not duplicate a repeated Unexpected finding", () => {
    const unexpected = item({
      id: "item-unexpected",
      trailer_id: null,
      trailer_number: "FAB12",
      expected_in_compound: false,
      physically_present: true,
      expected_position: null,
      discrepancy_type: "unexpected",
    });
    const result = applyFound({
      status: "in_progress",
      expectedTotal: 4,
      trailerNumber: "FAB12",
      items: [item(), unexpected],
    });

    expect(result.ok && result.result).toBe("already_present");
    expect(result.ok && result.items.filter((row) => row.trailer_number === "FAB12")).toHaveLength(1);
    expect(result.ok && result.expectedTotal).toBe(4);
  });

  it("rejects cancelled, completed, and missing sessions", () => {
    const items = [item()];
    expect(applyFound({ status: "cancelled", expectedTotal: 1, trailerNumber: "PRO810", items }).ok).toBe(false);
    expect(applyFound({ status: "completed", expectedTotal: 1, trailerNumber: "PRO810", items }).ok).toBe(false);
    expect(applyFound({ status: "missing", expectedTotal: 1, trailerNumber: "PRO810", items }).ok).toBe(false);
    expect(migrationSql).toContain("Stock check is cancelled and cannot be changed.");
    expect(migrationSql).toContain("This stock check is already completed.");
    expect(migrationSql).toContain("Stock check not found.");
    expect(migrationSql).toContain("v_session.status is distinct from 'in_progress'");
  });

  it("keeps the unique item contract and does not rewrite live trailer rows", () => {
    expect(migrationSql).toContain("when unique_violation then");
    expect(migrationSql).toContain("upper(trim(trailer_number)) = v_trailer_number");
    expect(migrationSql).not.toMatch(/update\s+public\.trailers/i);
    expect(migrationSql).not.toMatch(/^\s*expected_total\s*=/m);
    expect(migrationSql).toContain("v_session.expected_total");
    expect(migrationSql).toContain("expected_in_compound,");
    expect(migrationSql).toContain("false,");
    expect(migrationSql).toContain("actual_position,");
  });

  it("preserves Stock Check authorization and blocks the driver mutation path", () => {
    expect(migrationSql).toContain("role_key in ('administrator', 'supervisor', 'operator')");
    expect(migrationSql).toContain("raise exception 'Stock check permission denied.'");
    expect(migrationSql).not.toContain("'driver'");
    expect(migrationSql).toContain(
      "revoke all on function public.mark_compound_stock_check_present(uuid, text, text) from public",
    );
    expect(migrationSql).toContain(
      "revoke all on function public.mark_compound_stock_check_present(uuid, text, text) from anon",
    );
    expect(migrationSql).toContain(
      "grant execute on function public.mark_compound_stock_check_present(uuid, text, text) to authenticated",
    );
    expect(migrationSql).toContain("security invoker");
    expect(unexpectedRouteTest).toContain("blocks a driver from adding an unexpected trailer");
  });
});
