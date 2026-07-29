import "server-only";
import { getBackendUrl } from "@/lib/backend";

// Writer model for the personality Generate flow — soulweaver's architecture:
// Cortex is used for RESEARCH ONLY (benign questions), and the SOUL.md is
// written by a plain chat-completions call with the findings inlined.
//
// The writer ALWAYS runs through the Cortex backend's own primary model via
// the admin-gated POST /api/llm/completions (cortex-app ≥ the
// completions-endpoint release) — one model configuration for the whole
// stack, unit-metered and Langfuse-traced like every other completion. Rides
// CORTEX_API_URL + BACKEND_ADMIN_API_KEY, both required at boot anyway.

export interface PersonalityLlmConfig {
  baseUrl: string;
  apiKey: string;
}

export function getPersonalityLlmConfig(): PersonalityLlmConfig | null {
  const apiKey = process.env.BACKEND_ADMIN_API_KEY;
  if (!apiKey) return null; // unreachable in practice — validated at boot
  return { baseUrl: getBackendUrl(), apiKey };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Stream a chat completion through the backend, invoking onToken per content
 * delta. The endpoint speaks the OpenAI SSE chunk shape (data: {choices:
 * [{delta:{content}}]} … data: [DONE]) and can emit sanitized
 * `data: {"error": ...}` frames, surfaced here as thrown errors.
 */
export async function streamChatCompletion(
  cfg: PersonalityLlmConfig,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
  options?: { temperature?: number; maxTokens?: number }
): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/api/llm/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": cfg.apiKey,
      "Accept-Encoding": "identity",
    },
    body: JSON.stringify({
      messages,
      stream: true,
      temperature: options?.temperature ?? 0.85,
      max_tokens: options?.maxTokens ?? 4000,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    if (res.status === 404) {
      throw new Error(
        "The Cortex backend has no /api/llm/completions endpoint yet — update cortex-app."
      );
    }
    const detail = await res.text().catch(() => "");
    throw new Error(`LLM error ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload);
        if (typeof parsed?.error === "string") {
          throw new Error(parsed.error);
        }
        const token = parsed?.choices?.[0]?.delta?.content;
        if (typeof token === "string" && token) onToken(token);
      } catch (err) {
        if (err instanceof Error && !(err instanceof SyntaxError)) {
          throw err; // backend error frame
        }
        // partial/malformed frame — skip
      }
    }
  }
}
