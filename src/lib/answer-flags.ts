// Answer-quality flags stamped by the Cortex backend (2026-09-03+). A stream
// that was the prompt-injection safe refusal carries `refused: true` on its
// content and done frames; a writer that hit its output-token cap sets
// `truncated: true` on the done frame. The non-streaming POST /api/ask response
// has the same two fields top-level. Older backends send neither — callers
// fall back to isRefusalText() on the answer text. Shared by the browser
// stream parser (src/lib/api.ts) and server routes (personality generator).
export interface AnswerFlags {
  refused: boolean;
  truncated: boolean;
}

// Same stem the backend's is_refusal_message() matches: the canned refusal the
// prompt-security validator emits and the one the anti-injection system prompt
// instructs the model to emit. Tolerates quoting and curly apostrophes.
const REFUSAL_PREFIX = "i'm here to help with questions about your documents";

export function isRefusalText(text: string | undefined | null): boolean {
  if (!text) return false;
  return text
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/’/g, "'")
    .toLowerCase()
    .startsWith(REFUSAL_PREFIX);
}
