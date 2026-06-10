import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth/session";
import { getGroupChatKey } from "@/lib/auth/backend-key";
import { getBackendUrl } from "@/lib/backend";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { newId } from "@/lib/auth/crypto";

export const dynamic = "force-dynamic";

async function proxyRequest(request: Request, method: string) {
  const ctx = await getAuth();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiUrl = getBackendUrl();
  const url = new URL(request.url);
  const upstreamPath = url.pathname.replace(/^\/api\/proxy/, "");
  const upstream = `${apiUrl}${upstreamPath}${url.search}`;

  const resolved = getGroupChatKey(ctx.user);
  if (!resolved) {
    return NextResponse.json(
      { error: "No chat access. Ask an administrator to assign you to a group." },
      { status: 403 }
    );
  }

  // Correlation id: reuse the client's, or mint one. The backend echoes and
  // forwards it to cortex-helper, so all three services log the same id.
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-Key": resolved.apiKey,
    "X-Request-ID": requestId,
  };

  const bodyText =
    method !== "GET" && method !== "HEAD" ? await request.text() : undefined;

  // Log /ask and /search as message usage events (fire-and-forget).
  if (method === "POST" && /\/api\/(ask|search)(\/|$)/.test(upstreamPath)) {
    let collectionId: string | null = null;
    try {
      const parsed = bodyText ? JSON.parse(bodyText) : null;
      collectionId = parsed?.collection_id ?? null;
    } catch {}
    db.insert(usageEvents)
      .values({
        id: newId(),
        userId: ctx.user.id,
        kind: "message",
        collectionId,
        metadata: JSON.stringify({ path: upstreamPath, method }),
      })
      .run();
  }

  try {
    const res = await fetch(upstream, {
      method,
      headers,
      ...(bodyText !== undefined ? { body: bodyText } : {}),
    });

    const responseHeaders: Record<string, string> = {
      "Content-Type": res.headers.get("Content-Type") || "application/json",
      "X-Request-ID": requestId,
    };
    // Pass burst rate-limit hints through so the client can honor them.
    const retryAfter = res.headers.get("Retry-After");
    if (retryAfter) responseHeaders["Retry-After"] = retryAfter;

    return new Response(res.body, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`Proxy error [${method} ${upstream}]:`, err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET(request: Request) {
  return proxyRequest(request, "GET");
}

export async function POST(request: Request) {
  return proxyRequest(request, "POST");
}
