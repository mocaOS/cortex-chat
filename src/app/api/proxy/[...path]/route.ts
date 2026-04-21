export const dynamic = "force-dynamic";

function readEnv(key: string): string | undefined {
  return process.env[key];
}

async function proxyRequest(request: Request, method: string) {
  const apiUrl = readEnv("NEXT_PUBLIC_API_URL") || "http://localhost:8000";
  const apiKey = readEnv("NEXT_PUBLIC_API_KEY") || "";

  const url = new URL(request.url);
  // Extract the path after /api/proxy/
  const upstreamPath = url.pathname.replace(/^\/api\/proxy/, "");
  const upstream = `${apiUrl}${upstreamPath}${url.search}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };

  try {
    const res = await fetch(upstream, {
      method,
      headers,
      ...(method !== "GET" && method !== "HEAD"
        ? { body: await request.text() }
        : {}),
    });

    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
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
