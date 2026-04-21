export const dynamic = "force-dynamic";

// Server-side env access (not inlined by Turbopack)
function readEnv(key: string): string | undefined {
  return process.env[key];
}

/**
 * SSE streaming proxy.
 *
 * Browsers always send `Accept-Encoding: gzip` and this header cannot be
 * overridden from client-side fetch (it is a forbidden request header).
 * When the backend compresses the SSE stream with gzip the browser's
 * decompressor buffers chunks until a full gzip block is available,
 * which defeats real-time streaming.
 *
 * This proxy requests the upstream with `Accept-Encoding: identity` so the
 * data arrives uncompressed and can be forwarded to the browser chunk-by-chunk.
 */
export async function POST(request: Request) {
  const apiUrl =
    readEnv("NEXT_PUBLIC_API_URL") || "http://localhost:8000";
  const apiKey = readEnv("NEXT_PUBLIC_API_KEY") || "";

  const body = await request.text();

  try {
    const upstream = await fetch(`${apiUrl}/api/ask/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
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

    // Pipe the upstream ReadableStream straight through to the client
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
