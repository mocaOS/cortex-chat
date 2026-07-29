import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/session";
import { getTtsConfig } from "@/lib/voice";

export const dynamic = "force-dynamic";

// Long answers get truncated for read-aloud rather than rejected — hearing
// the first ~4k characters beats an error.
const MAX_TTS_CHARS = 4000;
const UPSTREAM_TIMEOUT_MS = 120_000;

const Body = z.object({
  text: z.string().min(1).max(64_000),
});

/**
 * TTS proxy: { text } → OpenAI-compatible /audio/speech, audio streamed back
 * as-is (mp3). The provider key never reaches the browser.
 */
export async function POST(request: Request) {
  await requireAuth();

  const tts = getTtsConfig();
  if (!tts) {
    return NextResponse.json({ error: "Voice output not configured" }, { status: 404 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const input = parsed.data.text.slice(0, MAX_TTS_CHARS);

  try {
    const upstream = await fetch(`${tts.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(tts.apiKey ? { Authorization: `Bearer ${tts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: tts.model,
        input,
        response_format: "mp3",
        // Some backends (Kokoro via speaches) require a voice; others default.
        ...(tts.voice ? { voice: tts.voice } : {}),
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: `Speech synthesis failed (${upstream.status})` },
        { status: upstream.status === 429 ? 429 : 502 }
      );
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Voice speech proxy error:", err);
    return NextResponse.json({ error: "Speech synthesis failed" }, { status: 502 });
  }
}
