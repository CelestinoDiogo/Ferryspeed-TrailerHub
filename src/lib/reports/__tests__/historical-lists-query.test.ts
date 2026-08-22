import { describe, expect, it } from "vitest";
import { fetchAllPagedRows, fetchByIdChunks, HISTORICAL_LIST_PAGE_SIZE } from "@/lib/reports/historical-lists-query";

describe("historical list paging", () => {
  it("does not silently stop at the Supabase 1000-row page size", async () => {
    const first = Array.from({ length: HISTORICAL_LIST_PAGE_SIZE }, (_, index) => index);
    const second = [1000, 1001];
    const pages = [first, second];
    const rows = await fetchAllPagedRows(async (from) => {
      const page = from === 0 ? pages[0] : pages[1];
      return { data: page, error: null };
    });
    expect(rows).toHaveLength(1002);
    expect(rows.at(-1)).toBe(1001);
  });

  it("loads ownership snapshots in id chunks", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `id-${index}`);
    const chunks: number[] = [];
    const rows = await fetchByIdChunks(ids, async (chunk) => {
      chunks.push(chunk.length);
      return { data: chunk.map((id) => ({ id })), error: null };
    });
    expect(chunks).toEqual([200, 50]);
    expect(rows).toHaveLength(250);
  });
});
