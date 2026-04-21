import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { getGroupChatKey } from "@/lib/auth/backend-key";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { newId } from "@/lib/auth/crypto";

export const dynamic = "force-dynamic";

function readEnv(key: string): string | undefined {
  return process.env[key];
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

  const apiUrl = readEnv("NEXT_PUBLIC_API_URL") || "http://localhost:8000";
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

  try {
    const upstream = await fetch(`${apiUrl}/api/ask/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": resolved.apiKey,
        "Accept-Encoding": "identity",
      },
      body,
    });

    if (!upstream.ok) {
      return new Response(`Upstream error: ${upstream.status}`, {
        status: upstream.status,
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
