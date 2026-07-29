import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { getSttConfig } from "@/lib/voice";

export const dynamic = "force-dynamic";

// Dictation cap — a minute of webm/opus is well under 1 MB, so this is
// generous headroom, not a real recording limit.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * STT proxy: browser multipart (field `file`) → OpenAI-compatible
 * /audio/transcriptions. The provider key never reaches the browser.
 */
export async function POST(request: Request) {
  await requireAuth();

  const stt = getSttConfig();
  if (!stt) {
    return NextResponse.json({ error: "Voice input not configured" }, { status: 404 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {}
  if (!file) {
    return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio too large" }, { status: 413 });
  }

  const upstreamForm = new FormData();
  // Some backends infer the decoder from the filename extension — make sure
  // the blob always carries one.
  upstreamForm.append("file", file, file.name || "audio.webm");
  upstreamForm.append("model", stt.model);
  upstreamForm.append("response_format", "json");

  try {
    const upstream = await fetch(`${stt.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: stt.apiKey ? { Authorization: `Bearer ${stt.apiKey}` } : {},
      body: upstreamForm,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      // Sanitize: never leak provider error bodies (may echo config details).
      return NextResponse.json(
        { error: `Transcription failed (${upstream.status})` },
        { status: upstream.status === 429 ? 429 : 502 }
      );
    }
    const data = (await upstream.json().catch(() => null)) as {
      text?: unknown;
    } | null;
    if (!data || typeof data.text !== "string") {
      return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
    }
    return NextResponse.json({ text: data.text });
  } catch (err) {
    console.error("Voice transcribe proxy error:", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 502 });
  }
}
