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

// Transient upstream failures (backend restarting, Neo4j blip -> 503 with
// Retry-After, proxy hiccup -> 502/504, connect refused) are retried here,
// server-side, BEFORE any SSE bytes have flowed — the browser client treats
// every non-ok status as terminal, so retrying past the blip must happen in
// this route. Auth verdicts (401/403) are authoritative and never retried.
const UPSTREAM_RETRIES = 2;
const RETRY_DELAY_MS = [750, 1500];
const MAX_RETRY_AFTER_MS = 3000;

function retryDelayMs(res: Response | null, attempt: number): number {
  const fallback = RETRY_DELAY_MS[attempt] ?? 1500;
  const raw = res?.headers.get("Retry-After");
  if (!raw) return fallback;
  const secs = Number(raw);
  if (!Number.isFinite(secs)) return fallback;
  return Math.min(Math.max(secs * 1000, fallback), MAX_RETRY_AFTER_MS);
}

async function fetchUpstreamWithRetry(
  url: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      lastResponse = await fetch(url, init);
    } catch (err) {
      // Connect failure — nothing was streamed, safe to retry the POST.
      if (attempt >= UPSTREAM_RETRIES || signal.aborted) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs(null, attempt)));
      continue;
    }
    const transient = [502, 503, 504].includes(lastResponse.status);
    if (!transient || attempt >= UPSTREAM_RETRIES || signal.aborted) {
      return lastResponse;
    }
    await new Promise((r) =>
      setTimeout(r, retryDelayMs(lastResponse, attempt))
    );
  }
}

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
    const upstream = await fetchUpstreamWithRetry(
      `${apiUrl}/api/ask/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": resolved.apiKey,
          "Accept-Encoding": "identity",
          "X-Request-ID": requestId,
        },
        body: upstreamBody,
      },
      request.signal
    );

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
