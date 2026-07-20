import type { Database } from "@/lib/database.types";
import { getEventTimestamp } from "@/lib/operations/export-outbound-workflow";

type TrailerEventRow = Database["public"]["Tables"]["trailer_events"]["Row"];

type TimestampCase = {
  name: string;
  row: TrailerEventRow | null;
  expected: string | null;
};

const buildRow = (overrides: Partial<TrailerEventRow>): TrailerEventRow => ({
  id: "00000000-0000-0000-0000-000000000001",
  trailer_id: null,
  trailer_number: "TR-1001",
  event_type: "export_allocation_status_changed",
  event_description: "Status changed",
  old_value: null,
  new_value: null,
  created_at: "2026-07-19T10:00:00.000Z",
  created_by: "tester@ferryspeed.local",
  ...overrides,
});

export const EXPORT_WORKFLOW_TIMESTAMP_TEST_CASES: TimestampCase[] = [
  {
    name: "complete event uses new_value.occurred_at",
    row: buildRow({
      new_value: {
        occurred_at: "2026-07-19T08:00:00.000Z",
        delivered_empty_at: "2026-07-19T08:05:00.000Z",
      },
    }),
    expected: "2026-07-19T08:00:00.000Z",
  },
  {
    name: "new_value null falls back to created_at",
    row: buildRow({ new_value: null }),
    expected: "2026-07-19T10:00:00.000Z",
  },
  {
    name: "null row returns null",
    row: null,
    expected: null,
  },
  {
    name: "missing occurred_at uses event-relevant timestamp from new_value",
    row: buildRow({
      event_type: "collected_loaded",
      new_value: {
        collected_loaded_at: "2026-07-19T09:40:00.000Z",
      },
    }),
    expected: "2026-07-19T09:40:00.000Z",
  },
  {
    name: "legacy payload uses old_value fallback",
    row: buildRow({
      event_type: "waiting_loading",
      new_value: null,
      old_value: {
        waiting_loading_at: "2026-07-19T09:10:00.000Z",
      },
    }),
    expected: "2026-07-19T09:10:00.000Z",
  },
  {
    name: "created_at fallback when payload timestamps are absent",
    row: buildRow({
      event_type: "ready_for_shipping",
      new_value: {
        source_record_id: "alloc-1",
      },
      old_value: {
        source_record_id: "alloc-1",
      },
      created_at: "2026-07-19T11:15:00.000Z",
    }),
    expected: "2026-07-19T11:15:00.000Z",
  },
];

export const evaluateExportWorkflowTimestampCases = () => {
  for (const testCase of EXPORT_WORKFLOW_TIMESTAMP_TEST_CASES) {
    const actual = getEventTimestamp(testCase.row);
    if (actual !== testCase.expected) {
      throw new Error(`Timestamp case failed: ${testCase.name}. Expected ${testCase.expected ?? "null"}, got ${actual ?? "null"}.`);
    }
  }

  return true;
};
