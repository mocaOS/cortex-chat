// Browser-side helpers for the /api/voice/* proxies.

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  const ext = blob.type.includes("ogg")
    ? "ogg"
    : blob.type.includes("mp4")
      ? "mp4"
      : "webm";
  form.append("file", blob, `dictation.${ext}`);
  const res = await fetch("/api/voice/transcribe", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  }
  return ((data as { text?: string }).text ?? "").trim();
}

export async function fetchSpeech(text: string): Promise<Blob> {
  const res = await fetch("/api/voice/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Error ${res.status}`);
  }
  return res.blob();
}

/**
 * Reduce an assistant answer's markdown to speakable text: drop code blocks
 * and citation markers, unwrap links/emphasis, strip structural syntax.
 */
export function stripForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/\s?\[[^\]]*?src_\d+[^\]]*?\](?!\()/gi, "") // citation markers
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> label
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/^#{1,6}\s+/gm, "") // heading markers
    .replace(/^\s*[-*+]\s+/gm, "") // list bullets
    .replace(/^\s*\d+\.\s+/gm, "") // ordered list markers
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/\|/g, " ") // table pipes
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1") // emphasis
    .replace(/\n{2,}/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
