import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isDuplicateDriverInstructionResponse } from "@/lib/driver-operational-instructions";
import { deriveMandatoryCollections } from "@/lib/mandatory-collections";

const serviceSource = readFileSync(path.resolve(process.cwd(), "src/lib/driver-mobile-service.ts"), "utf8");
const jobsDashboardSource = readFileSync(path.resolve(process.cwd(), "src/components/mobile/driver-mobile-jobs-dashboard.tsx"), "utf8");
const markReadSource = readFileSync(path.resolve(process.cwd(), "supabase/migrations/041_driver_operational_instructions.sql"), "utf8");

describe("driver mobile operational communication hardening", () => {
  it("keeps Driver Mobile on canonical delivery/collection records", () => {
    expect(serviceSource).toContain('from("delivery_bookings")');
    expect(serviceSource).toContain("complete_delivery_customer_collection");
    expect(serviceSource).not.toContain("export_allocations");
    expect(serviceSource).not.toContain("vessel_operations");
    expect(serviceSource).not.toContain("stock_check");
    expect(serviceSource).not.toContain("confirmTrailerDeparture");
    expect(serviceSource).not.toContain("operational_alerts");
  });

  it("sets collected_at for driver delivery collect to satisfy the existing lifecycle guard", () => {
    expect(serviceSource).toContain("collected_at: booking.collected_at ?? nowIso");
    expect(serviceSource).toContain("delivered_at: booking.delivered_at ?? nowIso");
    expect(serviceSource).not.toMatch(/patch:\s*\{[^}]*waiting_collection_since/);
  });

  it("marks instruction read once and does not replace the original timestamp", () => {
    expect(markReadSource).toContain("read_at = coalesce(read_at, now())");
    expect(markReadSource).toContain("read_by = coalesce(read_by, auth.uid())");
  });

  it("treats identical latest instruction responses as duplicates", () => {
    expect(isDuplicateDriverInstructionResponse(
      { event_type: "ok", message: null },
      "ok",
      null,
    )).toBe(true);
    expect(isDuplicateDriverInstructionResponse(
      { event_type: "ok", message: null },
      "completed",
      null,
    )).toBe(false);
    expect(isDuplicateDriverInstructionResponse(null, "ok", null)).toBe(false);
  });

  it("keeps the live Driver queue phone-first with large one-tap actions", () => {
    expect(jobsDashboardSource).toContain("overflow-x-hidden");
    expect(jobsDashboardSource).toContain("min-h-12");
    expect(jobsDashboardSource).toContain("Collected Empty");
    expect(jobsDashboardSource).toContain("Collected Loaded");
    expect(jobsDashboardSource).not.toContain("NEW ASSIGNMENT");
  });

  it("does not let a pending collection disappear before it is actually collected", () => {
    const pending = deriveMandatoryCollections({
      deliveries: [{
        id: "delivery-a",
        trailer_id: "trailer-a",
        trailer_number: "FS100",
        customer: "Customer A",
        delivery_location: "Customer Yard",
        booking_reference: "DEL-1",
        delivery_date: "2026-08-13",
        delivered_at: "2026-08-13T08:00:00.000Z",
        waiting_collection_since: "2026-08-13T09:00:00.000Z",
        collection_due_date: "2026-08-14",
        collected_at: null,
        status: "waiting_collection",
      }],
      exports: [],
      referenceAt: "2026-08-16T12:00:00.000Z",
    });

    expect(pending).toHaveLength(1);
    expect(pending[0].key).toBe("delivery:delivery-a");
  });
});
