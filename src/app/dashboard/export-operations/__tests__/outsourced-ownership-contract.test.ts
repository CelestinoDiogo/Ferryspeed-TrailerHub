import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "src/app/dashboard/export-operations/new/page.tsx"), "utf8");

describe("outsourced Export ownership contract", () => {
  it("captures and persists an optional external owner without inventing one", () => {
    expect(source).toContain("External Company / Supplier");
    expect(source).toContain('external_company: formState.externalCompany.trim() || null');
    expect(source).toContain('trailer_source: "outsourced"');
  });

  it("includes ownership evidence in Export creation history", () => {
    expect(source.match(/trailer_source: formState\.source === "outsourced"/g)).toHaveLength(2);
    expect(source.match(/external_company: formState\.source === "outsourced"/g)).toHaveLength(2);
  });

  it("blocks trailers that already have an active delivery booking", () => {
    expect(source).toContain("isTrailerEligibleForNewExportJob");
    expect(source).toContain(".from(\"delivery_bookings\")");
    expect(source).toContain("DELIVERY_BOOKING_RELEASE_STATUS_QUERY");
  });
});