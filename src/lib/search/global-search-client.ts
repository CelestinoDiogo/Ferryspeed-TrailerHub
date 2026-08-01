import { z } from "zod";
import { fetchRbacJson } from "@/lib/rbac/client-fetch";
import {
  GLOBAL_SEARCH_MAX_RESULTS,
  type GlobalSearchCategory,
  type GlobalSearchResponse,
} from "@/lib/search/global-search";

const categorySchema = z.enum([
  "trailers",
  "export_operations",
  "vessel_operations",
  "arrival_records",
  "inspection_records",
  "damage_reports",
  "temperature_records",
  "photos",
  "users",
  "reports",
  "compound_positions",
] satisfies GlobalSearchCategory[]);

const resultItemSchema = z.object({
  id: z.string().min(1),
  category: categorySchema,
  title: z.string(),
  subtitle: z.string(),
  status: z.string(),
  href: z.string(),
  quickActionLabel: z.string(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.undefined()])).optional(),
});

const groupedSchema = z.object({
  category: categorySchema,
  label: z.string(),
  count: z.number().int().nonnegative(),
  items: z.array(resultItemSchema),
});

const searchResponseSchema = z.object({
  query: z.string(),
  normalizedQuery: z.string(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  totalMatched: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  results: z.array(resultItemSchema),
  groups: z.array(groupedSchema),
});

export type GlobalSearchClientOptions = {
  query: string;
  limit?: number;
  offset?: number;
};

export async function searchGlobal(options: GlobalSearchClientOptions): Promise<GlobalSearchResponse> {
  const query = options.query.trim();
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(Math.max(1, Math.min(options.limit ?? GLOBAL_SEARCH_MAX_RESULTS, GLOBAL_SEARCH_MAX_RESULTS))));
  params.set("offset", String(Math.max(0, options.offset ?? 0)));

  const response = await fetchRbacJson<unknown>(`/api/search/global?${params.toString()}`);
  return searchResponseSchema.parse(response);
}
