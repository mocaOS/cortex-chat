import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { getGroupChatKey } from "@/lib/auth/backend-key";
import { getBackendUrl } from "@/lib/backend";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { newId } from "@/lib/auth/crypto";
import { getAppSettings } from "@/lib/settings";
import {
  injectCortexAnalytics,
  renderCortexAnalytics,
} from "@/lib/cortex-analytics";

export const dynamic = "force-dynamic";

/**
 * SSE streaming proxy with per-user key injection.
 *
 * Browsers always send `Accept-Encoding: gzip` and this header cannot be
 * overridden from client-side fetch. When the backend compresses the SSE
 * stream the browser's decompressor buffers chunks until a full gzip block
 * is available, which defeats real-time streaming. We request upstream with
 * `Accept-Encoding: identity` so data arrives uncompressed.
 */
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

  const apiUrl = getBackendUrl();
  const body = await request.text();

  let collectionId: string | null = null;
  try {
    collectionId = JSON.parse(body)?.collection_id ?? null;
  } catch {}
  db.insert(usageEvents)
    .values({
      id: newId(),
      userId: ctx.user.id,
      kind: "message",
      collectionId,
      metadata: JSON.stringify({ path: "/api/ask/stream" }),
    })
    .run();

  const rendered = renderCortexAnalytics(
    getAppSettings().cortexAnalyticsTemplate,
    ctx.user
  );
  const upstreamBody = injectCortexAnalytics(body, rendered);

  // Correlation id: reuse the client's, or mint one. The backend echoes and
  // forwards it to cortex-helper, so all three services log the same id.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const upstream = await fetch(`${apiUrl}/api/ask/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": resolved.apiKey,
        "Accept-Encoding": "identity",
        "X-Request-ID": requestId,
      },
      body: upstreamBody,
    });

    if (!upstream.ok) {
      const errorHeaders: Record<string, string> = {
        "X-Request-ID": requestId,
      };
      // Pass burst rate-limit hints through so the client can honor them.
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
    console.error("Stream proxy error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
