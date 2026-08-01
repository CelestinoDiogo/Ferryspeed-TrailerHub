import { z } from "zod";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";
import { GLOBAL_SEARCH_MAX_RESULTS, searchGlobalIndex } from "@/lib/search/global-search";

const querySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(GLOBAL_SEARCH_MAX_RESULTS).default(GLOBAL_SEARCH_MAX_RESULTS),
  offset: z.coerce.number().int().min(0).max(500).default(0),
});

export async function GET(request: Request) {
  try {
    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    const accessToken = getRouteBearerToken(request);
    const supabase = createAuthenticatedRouteSupabaseClient(request);
    await requireAuthenticatedRouteUser(supabase, accessToken);

    const response = await searchGlobalIndex(supabase, {
      query: parsed.q,
      limit: parsed.limit,
      offset: parsed.offset,
    });

    return Response.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid global search query." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to run global search.",
      },
      { status: 500 },
    );
  }
}
