import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { getUserContentKey } from "@/lib/auth/backend-key";
import { getBackendUrl } from "@/lib/backend";
import { newId } from "@/lib/auth/crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Web Import (MDHarvest / crawl4ai) — harvest URLs into the knowledge base as
// markdown. This is a MANAGE-permission action, so it rides the user's content
// key (same key as /api/me/upload), not the group chat read key. The backend
// gates the feature on ENABLE_WEB_CRAWL + CRAWL_SERVICE_URL and returns 404 when
// disabled, which we pass through so the UI can hide cleanly.

const bodySchema = z.object({
  urls: z.array(z.string()).min(1),
  collection_id: z.string().nullish(),
  // crawl4ai filter: "fit" (readable, default), "raw" (full page), "bm25" (relevance).
  content_filter: z.enum(["fit", "raw", "bm25"]).nullish(),
  query: z.string().nullish(),
});

export async function POST(request: Request) {
  const { user } = await requireAuth();

  const resolved = getUserContentKey(user);
  if (!resolved) {
    return NextResponse.json(
      { error: "You do not have upload permission." },
      { status: 403 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const collectionId = body.collection_id || null;

  // If the user's key is scoped, enforce the scope (mirror of the upload route).
  if (
    collectionId &&
    resolved.collectionIds.length > 0 &&
    !resolved.collectionIds.includes(collectionId)
  ) {
    return NextResponse.json(
      { error: "This collection is outside your upload scope." },
      { status: 403 }
    );
  }

  const apiUrl = getBackendUrl();
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const upstream = await fetch(`${apiUrl}/api/web-import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": resolved.apiKey,
        "X-Request-ID": requestId,
      },
      body: JSON.stringify({
        urls: body.urls,
        collection_id: collectionId,
        content_filter: body.content_filter ?? undefined,
        query: body.query ?? undefined,
      }),
    });

    const data = await upstream.json().catch(() => ({}));

    // Log as a content-add event (closest existing usage kind; no migration).
    db.insert(usageEvents)
      .values({
        id: newId(),
        userId: user.id,
        kind: "upload",
        collectionId,
        metadata: JSON.stringify({
          source: "web-import",
          urls: body.urls.length,
          status: upstream.status,
        }),
      })
      .run();

    if (!upstream.ok) {
      const errorHeaders: Record<string, string> = { "X-Request-ID": requestId };
      const retryAfter = upstream.headers.get("Retry-After");
      if (retryAfter) errorHeaders["Retry-After"] = retryAfter;
      const detail =
        (data && (data.detail || data.error)) || `Web import rejected (${upstream.status}).`;
      return NextResponse.json(
        { error: String(detail).slice(0, 400) },
        { status: upstream.status, headers: errorHeaders }
      );
    }

    // { task_id, accepted_urls, message } — the client polls task progress via
    // the generic proxy (GET /api/proxy/api/tasks/{task_id}).
    return NextResponse.json(data, { headers: { "X-Request-ID": requestId } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upstream error" },
      { status: 502 }
    );
  }
}
