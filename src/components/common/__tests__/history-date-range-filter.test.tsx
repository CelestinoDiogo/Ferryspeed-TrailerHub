// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React, { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryDateRangeFilter } from "@/components/common/history-date-range-filter";
import { createHistoryDateRange, type HistoryDateRangeValue } from "@/lib/history-date-range";

function Harness() {
  const [range, setRange] = useState<HistoryDateRangeValue>({
    preset: "custom",
    startDate: "2026-08-15",
    endDate: "2026-08-15",
  });

  return (
    <>
      <HistoryDateRangeFilter value={range} onChange={setRange} />
      <output>{`${range.startDate}|${range.endDate}`}</output>
    </>
  );
}

afterEach(cleanup);

describe("HistoryDateRangeFilter", () => {
  it("allows complete two-digit day and month entry without cross-field constraints", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const start = screen.getByLabelText("Start Date");
    const end = screen.getByLabelText("End Date");

    expect(start).not.toHaveAttribute("max");
    expect(end).not.toHaveAttribute("min");

    await user.clear(start);
    await user.type(start, "2026-08-12");
    await user.clear(end);
    await user.type(end, "2026-12-28");

    expect(start).toHaveValue("2026-08-12");
    expect(end).toHaveValue("2026-12-28");
    expect(screen.getByText("2026-08-12|2026-12-28")).toBeInTheDocument();

    await user.clear(start);
    await user.type(start, "2026-08-07");
    expect(start).toHaveValue("2026-08-07");
  });

  it("preserves predefined period behavior", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.selectOptions(screen.getByLabelText("Period"), "last_7_days");

    const expected = createHistoryDateRange("last_7_days");
    expect(screen.getByText(`${expected.startDate}|${expected.endDate}`)).toBeInTheDocument();
  });
});
