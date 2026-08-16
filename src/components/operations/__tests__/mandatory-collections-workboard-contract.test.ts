import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(process.cwd(), "src/components/operations/mandatory-collections-workboard.tsx"), "utf8");

describe("mandatory Collections workboard contract", () => {
  it("loads authoritative Delivery and Export states without a date cutoff", () => {
    expect(source).toContain('.from("delivery_bookings")');
    expect(source).toContain('.or("status.eq.waiting_collection,collected_at.not.is.null")');
    expect(source).toContain('.from("export_allocations")');
    expect(source).toContain('.in("status", ["delivered_empty", "waiting_loading", "collected_loaded", "completed"])');
    expect(source).not.toContain("collected_by_haulier");
    expect(source).not.toMatch(/\.g(?:te|t|lte|lt)\([^\n]*(?:delivery_date|collection_date|expected_return_at)/);
  });

  it("uses authoritative atomic completion APIs", () => {
    expect(source).toContain('supabase.rpc("complete_delivery_customer_collection"');
    expect(source).toContain("advanceExportAllocationStatus(supabase");
    expect(source).toContain('p_resulting_load_status: result');
  });

  it("offers explicit Delivery outcomes and source traceability", () => {
    expect(source).toContain("Collected Empty");
    expect(source).toContain("Collected Loaded");
    expect(source).toContain("Source job");
    expect(source).toContain("Original due");
  });

  it("uses the existing operational access boundary and explicit UTC display", () => {
    expect(source).toContain('moduleKey="dashboard"');
    expect(source).toContain("if (isLoadingUser || !canViewCollections) return");
    expect(source).toContain('timeZone: "UTC"');
  });
});