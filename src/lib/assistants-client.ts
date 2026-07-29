import { AssistantSummary } from "@/types";

const BASE = "/api/me/assistants";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `Request failed: ${res.status}`
    );
  }
  return data as T;
}

export async function listAssistants(): Promise<AssistantSummary[]> {
  const data = await http<{ assistants: AssistantSummary[] }>(BASE);
  return data.assistants;
}

export async function createAssistant(input: {
  content?: string;
  url?: string;
}): Promise<AssistantSummary> {
  const data = await http<{ assistant: AssistantSummary }>(BASE, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.assistant;
}

export async function deleteAssistant(id: string): Promise<void> {
  await http(`${BASE}/${id}`, { method: "DELETE" });
}

/** Fetch the full soul and trigger a .md download. */
export async function downloadSoul(
  id: string,
  adminEndpoint = false
): Promise<void> {
  const path = adminEndpoint ? `/api/admin/assistants/${id}` : `${BASE}/${id}`;
  const data = await http<{ assistant: AssistantSummary & { soul: string } }>(
    path
  );
  const name =
    data.assistant.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 60) ||
    "soul";
  const blob = new Blob([data.assistant.soul], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.SOUL.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface GenerateCallbacks {
  onContent: (token: string) => void;
  onStatus: (message: string) => void;
  // Agent activity feed — thinking steps, skill calls, retrieval progress.
  onThinking?: (step: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  onRateLimited?: (retryAfterSeconds: number | null) => void;
}

/**
 * Stream a Soul Builder run. Minimal SSE reader — the generate route pipes
 * the backend's ask/stream frames through, but the builder UI only needs
 * content tokens, a live status line, and done/error.
 */
export async function generateSoulStream(
  req: {
    prompt: string;
    collectionId?: string | null;
    previousDraft?: string;
    refinement?: string;
  },
  callbacks: GenerateCallbacks,
  signal?: AbortSignal
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/me/souls/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    callbacks.onError(err instanceof Error ? err.message : "Request failed");
    return;
  }

  if (res.status === 429) {
    const raw = res.headers.get("Retry-After");
    const secs = raw && Number.isFinite(Number(raw)) ? Math.ceil(Number(raw)) : null;
    callbacks.onRateLimited?.(secs);
    if (!callbacks.onRateLimited) callbacks.onError(`API error: ${res.status}`);
    return;
  }
  if (!res.ok || !res.body) {
    callbacks.onError(`API error: ${res.status}`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;

  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      break; // aborted or connection dropped
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(trimmed.slice(6));
        if (data.content !== undefined) callbacks.onContent(data.content);
        if (data.status?.message) callbacks.onStatus(data.status.message);
        // Same event mapping as the chat's thinking card: agent thinking,
        // skill activity, and retrieval lines all feed the visible log.
        if (data.thinking) callbacks.onThinking?.(String(data.thinking));
        if (data.skill_tool) {
          callbacks.onThinking?.(
            data.skill_name
              ? `${data.skill_name}: ${data.skill_tool}`
              : String(data.skill_tool)
          );
        }
        if (data.retrieval) callbacks.onThinking?.(String(data.retrieval));
        if (data.error) callbacks.onError(data.error);
        if (data.done) {
          sawDone = true;
          callbacks.onDone();
        }
      } catch {
        // skip malformed lines
      }
    }
  }
  if (!sawDone && !signal?.aborted) callbacks.onDone();
}
