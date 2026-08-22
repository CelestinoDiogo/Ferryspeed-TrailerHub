import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isTrailerPresentInCompoundInventory } from "@/lib/export-allocation";

const localPage = readFileSync(path.resolve(process.cwd(), "src/app/dashboard/local-trailers/page.tsx"), "utf8");
const stockCheckPage = readFileSync(
  path.resolve(process.cwd(), "src/app/dashboard/compound/stock-check/page.tsx"),
  "utf8",
);
const stockCheckExpected = readFileSync(
  path.resolve(process.cwd(), "src/lib/compound-stock-check-expected.ts"),
  "utf8",
);
const searchPage = readFileSync(path.resolve(process.cwd(), "src/app/dashboard/search/page.tsx"), "utf8");
const editTrailerPage = readFileSync(path.resolve(process.cwd(), "src/app/dashboard/edit-trailer/page.tsx"), "utf8");

describe("Local Return and Stock Check UI contracts", () => {
  it("shows Return to Main List only on the Local trailers surface", () => {
    expect(localPage).toContain("Return to Main List");
    expect(localPage).toContain("returnLocalTrailerToMainList");
    expect(localPage).toContain("Compound position (optional)");
    expect(localPage).toContain("Leave blank to return without a Compound bay");
    expect(editTrailerPage).not.toContain("Return to Main List");
  });

  it("resyncs an in-progress Stock Check from canonical current Compound presence without deleting observations", () => {
    expect(stockCheckPage).toContain("syncOpenStockCheckExpectedStock");
    expect(stockCheckPage).toContain("isVisibleOpenStockCheckWorkingItem");
    expect(stockCheckPage).toContain("shouldOfferStartStockCheck");
    expect(stockCheckPage).toContain("setOpenStockCheck(openData)");
    expect(stockCheckPage.indexOf("setOpenStockCheck(openData)")).toBeLessThan(
      stockCheckPage.indexOf("syncOpenStockCheckExpectedStock(supabase, openData)"),
    );
    expect(stockCheckPage).not.toContain(".limit(1200)");
    expect(stockCheckExpected).toContain("isTrailerPresentInCompoundInventory");
    expect(stockCheckExpected).toContain("expected_in_compound: false");
    expect(stockCheckExpected).toContain("existingByTrailerNumber");
    expect(stockCheckExpected).not.toContain("normalizeTrailerCurrentOperationalState");
    expect(stockCheckExpected).not.toContain(".delete(");
    expect(stockCheckPage).toContain("syncTrailerCurrentOperationalState");
    expect(editTrailerPage).toContain("normalizeTrailerCurrentOperationalState");
  });

  it("uses canonical Compound presence for the explicit Compound search filter", () => {
    expect(searchPage).toContain('activeFilter === "compound"');
    expect(searchPage).toContain("isTrailerPresentInCompoundInventory");
    expect(
      isTrailerPresentInCompoundInventory(
        {
          id: "local",
          compound_position: "P01",
          departure_date: null,
          is_local: true,
        },
        null,
      ),
    ).toBe(false);
    expect(
      isTrailerPresentInCompoundInventory(
        {
          id: "main-no-bay",
          compound_position: null,
          departure_date: null,
          is_local: false,
        },
        null,
      ),
    ).toBe(false);
    expect(
      isTrailerPresentInCompoundInventory(
        {
          id: "compound",
          compound_position: "P01",
          departure_date: null,
          is_local: false,
        },
        null,
      ),
    ).toBe(true);
  });
});
