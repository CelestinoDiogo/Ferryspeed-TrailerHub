import { z } from "zod";
import { aiAssistantContextSchema, type AiAssistantResponse } from "@/lib/ai-assistant-types";
import { runAiAssistantQuery } from "@/lib/ai-assistant";
import { bootstrapCurrentUserRole, RbacPermissionError, requireRbacPermission } from "@/lib/rbac/route";
import {
  createAuthenticatedRouteSupabaseClient,
  getRouteBearerToken,
  requireAuthenticatedRouteUser,
  SupabaseRouteAuthError,
} from "@/lib/supabase-route-client";

export const runtime = "nodejs";

const requestSchema = z.object({
  question: z.string().trim().min(1).max(500),
  context: aiAssistantContextSchema.optional(),
}).strict();

const toHex = (bytes: ArrayBuffer) => {
  const view = new Uint8Array(bytes);
  return Array.from(view)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

async function hashQuestion(question: string) {
  const encoded = new TextEncoder().encode(question.trim().slice(0, 500));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return toHex(digest).slice(0, 16);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");
  const cookieHeader = request.headers.get("cookie");

  try {
    console.info("AI Assistant auth debug", {
      phase: "request_received",
      hasAuthorizationHeader: Boolean(authHeader),
      hasCookieHeader: Boolean(cookieHeader),
      cookieHeaderLength: cookieHeader?.length ?? 0,
    });

    const accessToken = getRouteBearerToken(request);
    console.info("AI Assistant auth debug", {
      phase: "token_extracted",
      tokenLength: accessToken.length,
      tokenPrefix: accessToken.slice(0, 8),
    });

    const supabase = createAuthenticatedRouteSupabaseClient(request);

    const sessionProbe = await supabase.auth.getSession();
    console.info("AI Assistant auth debug", {
      phase: "session_probe",
      sessionFound: Boolean(sessionProbe.data.session),
      sessionError: sessionProbe.error?.message ?? null,
    });

    const user = await requireAuthenticatedRouteUser(supabase, accessToken);
    console.info("AI Assistant auth debug", {
      phase: "user_probe",
      userFound: Boolean(user),
      userId: user.id,
    });

    await bootstrapCurrentUserRole(supabase, user);
    await requireRbacPermission(supabase, user.id, "ai_assistant", "view");

    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const response = await runAiAssistantQuery(supabase, payload.question, user.id, payload.context);

    const elapsedMs = Date.now() - startedAt;
    const questionHash = await hashQuestion(payload.question);
    console.info("AI Assistant query", {
      userId: user.id,
      questionHash,
      intent: response.intent,
      success: true,
      elapsedMs,
      resultCount: response.count ?? response.items?.length ?? 0,
    });

    return Response.json(response satisfies AiAssistantResponse);
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const fallbackHash = typeof error === "object" && error && "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
    const questionHash = fallbackHash ? fallbackHash.slice(0, 16) : "unknown";

    if (error instanceof z.ZodError) {
      console.info("AI Assistant query", {
        questionHash,
        intent: "unknown",
        success: false,
        elapsedMs,
        resultCount: 0,
      });

      return Response.json({ error: "Invalid assistant request payload." }, { status: 400 });
    }

    if (error instanceof SupabaseRouteAuthError) {
      console.info("AI Assistant auth debug", {
        phase: "auth_rejected",
        status: error.status,
        reason: error.message,
        hasAuthorizationHeader: Boolean(authHeader),
        hasCookieHeader: Boolean(cookieHeader),
      });

      console.info("AI Assistant query", {
        questionHash,
        intent: "unknown",
        success: false,
        elapsedMs,
        resultCount: 0,
      });

      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof RbacPermissionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("AI Assistant request failed:", error);
    console.info("AI Assistant query", {
      questionHash,
      intent: "unknown",
      success: false,
      elapsedMs,
      resultCount: 0,
    });

    return Response.json({ error: "Unable to process AI assistant request right now." }, { status: 500 });
  }
}
