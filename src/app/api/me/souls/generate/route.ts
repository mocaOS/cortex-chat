import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuth } from "@/lib/auth/session";
import { getGroupChatKey } from "@/lib/auth/backend-key";
import { getBackendUrl } from "@/lib/backend";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { newId } from "@/lib/auth/crypto";
import { buildSoulAuthorPrompt } from "@/lib/soul-author-prompt";
import { fetchUpstreamWithRetry } from "@/lib/upstream-sse";

export const dynamic = "force-dynamic";

// Soul Builder: one deep-research run whose "question" is the soul-author
// prompt. The upstream SSE stream is piped through verbatim (the client reads
// token/status/thinking/done exactly like a chat turn) but nothing here
// touches chat history, memory, or the analytics/soul injection — a soul must
// not author itself into the next soul.
const Body = z.object({
  prompt: z.string().min(1).max(4000),
  collectionId: z.string().min(1).nullable().optional(),
  // Refine loop: both present = revise the draft instead of starting fresh.
  previousDraft: z.string().max(64_000).optional(),
  refinement: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const ctx = await getAuth();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = getGroupChatKey(ctx.user);
  if (!resolved) {
    return NextResponse.json(
      { error: "No chat access. Ask an administrator to assign you to a group." },
      { status: 403 }
    );
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  db.insert(usageEvents)
    .values({
      id: newId(),
      userId: ctx.user.id,
      kind: "message",
      collectionId: parsed.data.collectionId ?? null,
      metadata: JSON.stringify({ path: "/api/me/souls/generate" }),
    })
    .run();

  const question = buildSoulAuthorPrompt({
    userPrompt: parsed.data.prompt,
    previousDraft: parsed.data.previousDraft,
    refinement: parsed.data.refinement,
  });

  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const apiUrl = getBackendUrl();

  const upstreamRequest = (useAgentic: boolean) =>
    fetchUpstreamWithRetry(
      `${apiUrl}/api/ask/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": resolved.apiKey,
          "Accept-Encoding": "identity",
          "X-Request-ID": requestId,
        },
        body: JSON.stringify({
          question,
          use_agentic: useAgentic,
          use_graph: true,
          use_reranking: true,
          collection_id: parsed.data.collectionId ?? null,
          conversation_history: [],
          conversation_memory: {},
        }),
      },
      request.signal
    );

  try {
    // Deep research grounds the soul in the knowledge base; if a deployment
    // rejects agentic mode (4xx), fall back to chat mode — a shallower but
    // still grounded soul beats an error.
    let upstream = await upstreamRequest(true);
    if (!upstream.ok && upstream.status !== 429 && upstream.status < 500) {
      upstream = await upstreamRequest(false);
    }

    if (!upstream.ok) {
      const errorHeaders: Record<string, string> = { "X-Request-ID": requestId };
      const retryAfter = upstream.headers.get("Retry-After");
      if (retryAfter) errorHeaders["Retry-After"] = retryAfter;
      return new Response(`Upstream error: ${upstream.status}`, {
        status: upstream.status,
        headers: errorHeaders,
      });
    }
    if (!upstream.body) {
      return new Response("No upstream body", { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Request-ID": requestId,
      },
    });
  } catch (err) {
    console.error("Soul generate proxy error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
