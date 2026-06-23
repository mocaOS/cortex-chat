import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { getUserContentKey } from "@/lib/auth/backend-key";
import { getBackendUrl } from "@/lib/backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Discover same-site candidate links on a page, so the user can pick which ones
// to import. MANAGE-permission (content key), same gating as the import route.

const bodySchema = z.object({ url: z.string() });

export async function POST(request: Request) {
  const { user } = await requireAuth();

  const resolved = getUserContentKey(user);
  if (!resolved) {
    return NextResponse.json(
      { error: "You do not have upload permission." },
      { status: 403 }
    );
  }

  let url: string;
  try {
    url = bodySchema.parse(await request.json()).url;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const apiUrl = getBackendUrl();
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    const upstream = await fetch(`${apiUrl}/api/web-import/discover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": resolved.apiKey,
        "X-Request-ID": requestId,
      },
      body: JSON.stringify({ url }),
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const detail =
        (data && (data.detail || data.error)) || `Link discovery failed (${upstream.status}).`;
      return NextResponse.json(
        { error: String(detail).slice(0, 400) },
        { status: upstream.status, headers: { "X-Request-ID": requestId } }
      );
    }

    // { source_url, domain, links: [{ url, title }] }
    return NextResponse.json(data, { headers: { "X-Request-ID": requestId } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upstream error" },
      { status: 502 }
    );
  }
}
