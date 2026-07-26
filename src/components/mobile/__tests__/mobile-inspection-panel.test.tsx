import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MobileInspectionPanel } from "@/components/mobile/mobile-inspection-panel";

describe("MobileInspectionPanel", () => {
  it("renders camera and gallery photo inputs", () => {
    const html = renderToString(
      <MobileInspectionPanel
        open
        trailer={{
          vesselTrailerId: "11111111-1111-4111-8111-111111111111",
          trailerId: "22222222-2222-4222-8222-222222222222",
          trailerNumber: "FS1234",
          operationId: "33333333-3333-4333-8333-333333333333",
          status: "arrived",
          arrivalStatus: "arrived",
          inspectionStartedAt: null,
          inspectionCompletedAt: null,
          expectedFrontTemperature: 2,
          expectedRearTemperature: 3,
          expectedTemperatureUnit: "C",
          hasDamage: false,
          hasTemperatureAlert: false,
        }}
        progress={{
          frontTemperature: "",
          rearTemperature: "",
          damage: "no",
          damageType: "",
          damageLocation: "",
          damageDescription: "",
          notes: "",
        }}
        activityRows={[]}
        activityLoading={false}
        isOnline
        isSubmitting={false}
        onClose={() => undefined}
        onProgressChange={() => undefined}
        onStartInspection={() => undefined}
        onSaveProgress={() => undefined}
        onCompleteInspection={() => undefined}
        onUploadPhoto={async () => undefined}
      />,
    );

    expect(html).toContain("Photo capture / upload");
    expect(html).toContain("capture=\"environment\"");
    expect(html).toContain("type=\"file\"");
  });

  it("shows offline upload warning", () => {
    const html = renderToString(
      <MobileInspectionPanel
        open
        trailer={{
          vesselTrailerId: "11111111-1111-4111-8111-111111111111",
          trailerId: null,
          trailerNumber: "FS1234",
          operationId: "33333333-3333-4333-8333-333333333333",
          status: "arrived",
          arrivalStatus: "arrived",
          inspectionStartedAt: null,
          inspectionCompletedAt: null,
          expectedFrontTemperature: null,
          expectedRearTemperature: null,
          expectedTemperatureUnit: "C",
          hasDamage: false,
          hasTemperatureAlert: false,
        }}
        progress={{
          frontTemperature: "",
          rearTemperature: "",
          damage: "no",
          damageType: "",
          damageLocation: "",
          damageDescription: "",
          notes: "",
        }}
        activityRows={[]}
        activityLoading={false}
        isOnline={false}
        isSubmitting={false}
        onClose={() => undefined}
        onProgressChange={() => undefined}
        onStartInspection={() => undefined}
        onSaveProgress={() => undefined}
        onCompleteInspection={() => undefined}
        onUploadPhoto={async () => undefined}
      />,
    );

    expect(html).toContain("Photo upload requires a connection.");
  });
});
