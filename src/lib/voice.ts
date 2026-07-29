import "server-only";

// Voice (STT dictation + TTS read-aloud) — pure env config, feature-gated
// like SMTP: unset base URL = feature invisible (ClientConfig.voice flags
// hide the buttons). Both pairs point at ANY OpenAI-compatible audio API —
// a LAN LiteLLM router aggregating speaches (faster-whisper/Kokoro/Piper),
// Venice (https://api.venice.ai/api/v1), or OpenAI itself. The browser never
// sees these values; /api/voice/* proxies inject the key server-side.

export interface VoiceEndpoint {
  baseUrl: string; // e.g. http://host:4000/v1 — endpoints appended: /audio/…
  apiKey: string | null;
  model: string;
}

export interface TtsEndpoint extends VoiceEndpoint {
  voice: string | null; // e.g. Kokoro's af_heart; omitted when unset
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

export function getSttConfig(): VoiceEndpoint | null {
  const baseUrl = process.env.VOICE_STT_BASE_URL;
  const model = process.env.VOICE_STT_MODEL;
  if (!baseUrl || !model) return null;
  return {
    baseUrl: trimBase(baseUrl),
    apiKey: process.env.VOICE_STT_API_KEY || null,
    model,
  };
}

export function getTtsConfig(): TtsEndpoint | null {
  const baseUrl = process.env.VOICE_TTS_BASE_URL;
  const model = process.env.VOICE_TTS_MODEL;
  if (!baseUrl || !model) return null;
  return {
    baseUrl: trimBase(baseUrl),
    apiKey: process.env.VOICE_TTS_API_KEY || null,
    model,
    voice: process.env.VOICE_TTS_VOICE || null,
  };
}

/** Boot-time validation strings (aggregated in instrumentation.ts). */
export function validateVoiceEnv(): string[] {
  const errors: string[] = [];
  if (process.env.VOICE_STT_BASE_URL && !process.env.VOICE_STT_MODEL) {
    errors.push(
      "VOICE_STT_MODEL is required when VOICE_STT_BASE_URL is set (e.g. faster-whisper-large-v3 or whisper-large-v3)."
    );
  }
  if (process.env.VOICE_TTS_BASE_URL && !process.env.VOICE_TTS_MODEL) {
    errors.push(
      "VOICE_TTS_MODEL is required when VOICE_TTS_BASE_URL is set (e.g. kokoro-82m or tts-kokoro)."
    );
  }
  for (const key of ["VOICE_STT_BASE_URL", "VOICE_TTS_BASE_URL"] as const) {
    const v = process.env[key];
    if (v && !/^https?:\/\//.test(v)) {
      errors.push(`${key} must start with http:// or https://.`);
    }
  }
  return errors;
}
