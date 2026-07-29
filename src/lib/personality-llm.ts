import "server-only";

// Direct LLM for the personality Generate flow — soulweaver's architecture:
// Cortex is used for RESEARCH ONLY (benign questions), and the SOUL.md is
// written by a plain chat-completions call with the findings inlined. Sending
// the author meta-prompt as a Cortex query trips the backend's prompt-
// injection defense (instant canned deflection), so a separate model is the
// only reliable way. Env-configured like voice; any OpenAI-compatible
// endpoint works (LiteLLM router, Venice, OpenAI).

export interface PersonalityLlmConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

export function getPersonalityLlmConfig(): PersonalityLlmConfig | null {
  const baseUrl = process.env.PERSONALITY_LLM_BASE_URL;
  const model = process.env.PERSONALITY_LLM_MODEL;
  if (!baseUrl || !model) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: process.env.PERSONALITY_LLM_API_KEY || null,
    model,
  };
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
 * Stream a chat completion, invoking onToken per content delta. Parses the
 * OpenAI SSE shape (data: {choices:[{delta:{content}}]} … data: [DONE]).
 */
export async function streamChatCompletion(
  cfg: PersonalityLlmConfig,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
  options?: { temperature?: number; maxTokens?: number }
): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
      temperature: options?.temperature ?? 0.85,
      max_tokens: options?.maxTokens ?? 4000,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
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
        const token = parsed?.choices?.[0]?.delta?.content;
        if (typeof token === "string" && token) onToken(token);
      } catch {
        // partial/malformed frame — skip
      }
    }
  }
}
