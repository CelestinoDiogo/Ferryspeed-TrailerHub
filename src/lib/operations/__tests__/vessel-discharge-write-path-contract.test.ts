import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const desktopArrivals = readFileSync(new URL("../../../app/dashboard/vessel-operations/[id]/arrivals/page.tsx", import.meta.url), "utf8");
const desktopHook = readFileSync(new URL("../../../app/dashboard/vessel-operations/[id]/hooks/use-vessel-operation.ts", import.meta.url), "utf8");
const commandCentre = readFileSync(new URL("../../../app/dashboard/operations-command-centre/page.tsx", import.meta.url), "utf8");
const mobileService = readFileSync(new URL("../../mobile/mobile-actions-service.ts", import.meta.url), "utf8");
const receptionHook = readFileSync(new URL("../../../app/dashboard/vessel-operations/[id]/hooks/use-vessel-reception.ts", import.meta.url), "utf8");

describe("vessel discharge timestamp write-path contract", () => {
  it("uses the shared discharge helper on desktop, command centre, and Master Mobile", () => {
    expect(desktopArrivals).toContain("markVesselTrailerDischarged");
    expect(desktopHook).toContain("markVesselTrailerDischarged");
    expect(commandCentre).toContain("markVesselTrailerDischarged");
    expect(mobileService).toContain("markVesselTrailerDischarged");
  });

  it("keeps Compound reception on the existing arrival RPC without writing discharged_at", () => {
    expect(receptionHook).toContain("confirm_vessel_trailer_arrival");
    expect(receptionHook).not.toContain("discharged_at");
    expect(mobileService).toContain("confirm_vessel_trailer_arrival");
    expect(mobileService).toContain("markVesselTrailerDischarged");
  });
});
