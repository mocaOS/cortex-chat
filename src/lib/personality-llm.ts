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

export interface ChatCompletionStats {
  /** Visible answer characters forwarded to onToken. */
  contentChars: number;
  /** Hidden chain-of-thought characters (reasoning_content / reasoning deltas). */
  reasoningChars: number;
  /** finish_reason of the last chunk that carried one (e.g. "length"). */
  finishReason: string | null;
}

/**
 * Stream a chat completion through the backend, invoking onToken per content
 * delta. The endpoint speaks the OpenAI SSE chunk shape (data: {choices:
 * [{delta:{content}}]} … data: [DONE]) and can emit sanitized
 * `data: {"error": ...}` frames, surfaced here as thrown errors.
 *
 * Thinking-capable models may stream hidden reasoning in a separate delta
 * field (`reasoning_content` on vLLM/DeepSeek/Qwen, `reasoning` on
 * OpenRouter) before the first visible token — the backend suppresses it by
 * default (DEFAULT_REASONING_MODE=off), but when it does arrive it is
 * reported via `onReasoning` so callers can show progress instead of
 * silence. The returned stats let callers tell "empty answer" from "answer".
 */
export async function streamChatCompletion(
  cfg: PersonalityLlmConfig,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
  options?: {
    temperature?: number;
    maxTokens?: number;
    onReasoning?: (delta: string) => void;
  }
): Promise<ChatCompletionStats> {
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

  const stats: ChatCompletionStats = {
    contentChars: 0,
    reasoningChars: 0,
    finishReason: null,
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
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
        if (payload === "[DONE]") return stats;
        try {
          const parsed = JSON.parse(payload);
          if (typeof parsed?.error === "string") {
            throw new Error(parsed.error);
          }
          const choice = parsed?.choices?.[0];
          const token = choice?.delta?.content;
          if (typeof token === "string" && token) {
            stats.contentChars += token.length;
            onToken(token);
          }
          const reasoning =
            choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
          if (typeof reasoning === "string" && reasoning) {
            stats.reasoningChars += reasoning.length;
            options?.onReasoning?.(reasoning);
          }
          if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
            stats.finishReason = choice.finish_reason;
          }
        } catch (err) {
          if (err instanceof Error && !(err instanceof SyntaxError)) {
            throw err; // backend error frame
          }
          // partial/malformed frame — skip
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
  }
  return stats;
}
