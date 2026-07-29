import "server-only";
import { getBackendUrl } from "@/lib/backend";

// Writer model for the personality Generate flow — soulweaver's architecture:
// Cortex is used for RESEARCH ONLY (benign questions), and the SOUL.md is
// written by a plain chat-completions call with the findings inlined.
//
// Resolution order:
//  1. PERSONALITY_LLM_* env — explicit direct connection to any
//     OpenAI-compatible endpoint (LiteLLM router, Venice, OpenAI).
//  2. DEFAULT: the Cortex backend's own primary model via the admin-gated
//     POST /api/llm/completions (cortex-app ≥ the completions-endpoint
//     release) — one model configuration, unit-metered and Langfuse-traced
//     like every other completion. Zero extra config: rides CORTEX_API_URL +
//     BACKEND_ADMIN_API_KEY, which are required at boot anyway.

export interface PersonalityLlmConfig {
  // "openai": {baseUrl}/chat/completions with Bearer auth + model field.
  // "cortex": {baseUrl}/api/llm/completions with X-API-Key auth; the backend
  // picks its configured primary model.
  transport: "openai" | "cortex";
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

export function getPersonalityLlmConfig(): PersonalityLlmConfig | null {
  const baseUrl = process.env.PERSONALITY_LLM_BASE_URL;
  const model = process.env.PERSONALITY_LLM_MODEL;
  if (baseUrl && model) {
    return {
      transport: "openai",
      baseUrl: baseUrl.replace(/\/+$/, ""),
      apiKey: process.env.PERSONALITY_LLM_API_KEY || null,
      model,
    };
  }
  const adminKey = process.env.BACKEND_ADMIN_API_KEY;
  if (adminKey) {
    return {
      transport: "cortex",
      baseUrl: getBackendUrl(),
      apiKey: adminKey,
      model: "cortex-primary", // informational; the backend chooses
    };
  }
  return null;
}

export function validatePersonalityLlmEnv(): string[] {
  const errors: string[] = [];
  if (process.env.PERSONALITY_LLM_BASE_URL && !process.env.PERSONALITY_LLM_MODEL) {
    errors.push(
      "PERSONALITY_LLM_MODEL is required when PERSONALITY_LLM_BASE_URL is set."
    );
  }
  const v = process.env.PERSONALITY_LLM_BASE_URL;
  if (v && !/^https?:\/\//.test(v)) {
    errors.push("PERSONALITY_LLM_BASE_URL must start with http:// or https://.");
  }
  return errors;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Stream a chat completion, invoking onToken per content delta. Both
 * transports speak the OpenAI SSE chunk shape (data: {choices:[{delta:
 * {content}}]} … data: [DONE]); the cortex transport can additionally emit
 * sanitized `data: {"error": ...}` frames, surfaced as thrown errors.
 */
export async function streamChatCompletion(
  cfg: PersonalityLlmConfig,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
  options?: { temperature?: number; maxTokens?: number }
): Promise<void> {
  const isCortex = cfg.transport === "cortex";
  const url = isCortex
    ? `${cfg.baseUrl}/api/llm/completions`
    : `${cfg.baseUrl}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) {
    if (isCortex) headers["X-API-Key"] = cfg.apiKey;
    else headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  }
  const body: Record<string, unknown> = {
    messages,
    stream: true,
    temperature: options?.temperature ?? 0.85,
    max_tokens: options?.maxTokens ?? 4000,
  };
  if (!isCortex) body.model = cfg.model;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    if (isCortex && res.status === 404) {
      throw new Error(
        "The Cortex backend has no /api/llm/completions endpoint yet — " +
          "update cortex-app, or set PERSONALITY_LLM_* to a direct LLM."
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
        if (err instanceof Error && err.message && !(err instanceof SyntaxError)) {
          throw err; // backend error frame
        }
        // partial/malformed frame — skip
      }
    }
  }
}
