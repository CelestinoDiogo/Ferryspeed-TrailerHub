import { describe, expect, it } from "vitest";
import {
  LIVE_VESSEL_INSPECTION_DAMAGE_INSERT_COLUMNS,
  LIVE_VESSEL_INSPECTION_DAMAGE_SEVERITIES,
  buildInspectionDamageInsertPayload,
  normalizeInspectionDamageSeverity,
  persistVesselInspectionDamage,
} from "@/lib/operations/persist-inspection-damage";

type DamageRow = Record<string, unknown> & { id: string };

const makeClient = (options?: { insertError?: { message: string } | null }) => {
  const calls: string[] = [];
  const rows: DamageRow[] = [
    {
      id: "old-damage",
      vessel_trailer_id: "vt-1",
      description: "Existing dent",
    },
  ];

  const from = () => {
    const filters: { eq?: { column: string; value: unknown }; neq?: { column: string; value: unknown } } = {};

    const applyDelete = async () => {
      calls.push("delete");
      const remaining = rows.filter((row) => {
        if (filters.eq && row[filters.eq.column] !== filters.eq.value) {
          return true;
        }
        if (filters.neq && row[filters.neq.column] === filters.neq.value) {
          return true;
        }
        if (filters.eq && row[filters.eq.column] === filters.eq.value) {
          return false;
        }
        return true;
      });
      rows.splice(0, rows.length, ...remaining);
      return { error: null };
    };

    const chain = {
      eq(column: string, value: unknown) {
        filters.eq = { column, value };
        return chain;
      },
      neq(column: string, value: unknown) {
        filters.neq = { column, value };
        return applyDelete();
      },
      then(resolve: (value: { error: null }) => unknown) {
        return applyDelete().then(resolve);
      },
    };

    return {
      insert(payload: Record<string, unknown>) {
        calls.push("insert");
        if (options?.insertError) {
          return {
            select: () => ({
              single: async () => ({ data: null, error: options.insertError }),
            }),
          };
        }

        const inserted = { id: "new-damage", ...payload } as DamageRow;
        rows.push(inserted);
        return {
          select: () => ({
            single: async () => ({ data: { id: inserted.id }, error: null }),
          }),
        };
      },
      delete() {
        return chain;
      },
    };
  };

  return {
    calls,
    rows,
    from,
  };
};

const damageInput = {
  vesselTrailerId: "vt-1",
  vesselOperationId: "op-1",
  trailerId: "trailer-1",
  trailerNumber: "FS1001",
  hasDamage: true,
  damageType: "Dent",
  damageLocation: "Front",
  severity: "Moderate",
  description: "Front panel dent",
  recordedAt: "2026-08-25T08:00:00.000Z",
  recordedBy: "TrailerHub User",
};

describe("persist inspection damage", () => {
  it("writes only live vessel_inspection_damages columns and omits vessel_operation_id", () => {
    const payload = buildInspectionDamageInsertPayload(damageInput);

    expect(Object.keys(payload).sort()).toEqual([...LIVE_VESSEL_INSPECTION_DAMAGE_INSERT_COLUMNS].sort());
    expect(payload).toEqual({
      vessel_trailer_id: "vt-1",
      trailer_id: "trailer-1",
      trailer_number: "FS1001",
      damage_type: "Dent",
      damage_location: "Front",
      severity: "moderate",
      description: "Front panel dent",
      recorded_at: "2026-08-25T08:00:00.000Z",
      recorded_by: "TrailerHub User",
    });
    expect(payload).not.toHaveProperty("vessel_operation_id");
    expect(payload).not.toHaveProperty("vessel_operation_trailer_id");
    expect(LIVE_VESSEL_INSPECTION_DAMAGE_SEVERITIES).toContain(payload.severity);
  });

  it("maps UI severity labels onto the live check-constraint values", () => {
    expect(normalizeInspectionDamageSeverity("Minor")).toBe("minor");
    expect(normalizeInspectionDamageSeverity("Moderate")).toBe("moderate");
    expect(normalizeInspectionDamageSeverity("Severe")).toBe("major");
    expect(normalizeInspectionDamageSeverity("major")).toBe("major");
    expect(normalizeInspectionDamageSeverity("critical")).toBe("critical");
    expect(normalizeInspectionDamageSeverity("")).toBe("minor");

    expect(buildInspectionDamageInsertPayload(damageInput).severity).toBe("moderate");
    expect(buildInspectionDamageInsertPayload({ ...damageInput, severity: "Severe" }).severity).toBe("major");
  });

  it("identifies the inspection through vessel_trailer_id plus trailer identifiers", () => {
    const payload = buildInspectionDamageInsertPayload(damageInput);

    expect(payload.vessel_trailer_id).toBe("vt-1");
    expect(payload.trailer_id).toBe("trailer-1");
    expect(payload.trailer_number).toBe("FS1001");
  });

  it("inserts the new damage row before deleting previous evidence", async () => {
    const client = makeClient();
    const result = await persistVesselInspectionDamage(client as never, damageInput);

    expect(result.error).toBeNull();
    expect(client.calls).toEqual(["insert", "delete"]);
    expect(client.rows).toEqual([
      expect.objectContaining({
        id: "new-damage",
        vessel_trailer_id: "vt-1",
        description: "Front panel dent",
      }),
    ]);
    expect(client.rows[0]).not.toHaveProperty("vessel_operation_id");
  });

  it("preserves existing damage evidence when the new insert fails", async () => {
    const client = makeClient({
      insertError: { message: "Could not find the 'vessel_operation_id' column of 'vessel_inspection_damages' in the schema cache" },
    });
    const result = await persistVesselInspectionDamage(client as never, damageInput);

    expect(result.error?.message).toContain("schema cache");
    expect(client.calls).toEqual(["insert"]);
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0]?.id).toBe("old-damage");
    expect(client.rows[0]?.description).toBe("Existing dent");
  });

  it("can clear current damage after a successful no-damage save", async () => {
    const client = makeClient();
    const result = await persistVesselInspectionDamage(client as never, {
      ...damageInput,
      hasDamage: false,
    });

    expect(result.error).toBeNull();
    expect(client.calls).toEqual(["delete"]);
    expect(client.rows).toEqual([]);
  });
});
