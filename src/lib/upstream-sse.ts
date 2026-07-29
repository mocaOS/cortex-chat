import "server-only";

// Transient upstream failures (backend restarting, Neo4j blip -> 503 with
// Retry-After, proxy hiccup -> 502/504, connect refused) are retried here,
// server-side, BEFORE any SSE bytes have flowed — the browser client treats
// every non-ok status as terminal, so retrying past the blip must happen in
// the proxy. Auth verdicts (401/403) are authoritative and never retried.
//
// Shared by /api/ask/stream and /api/me/souls/generate.
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

export async function fetchUpstreamWithRetry(
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
