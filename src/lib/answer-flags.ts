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
  // Which safeguard produced a refusal (backend 2026-09-15+): the pattern
  // validator, the prompt-guard classifier (may be a false positive), or the
  // writer itself emitting the canned deflection. Undefined on older backends.
  refusalSource?: RefusalSource;
}

export type RefusalSource = "heuristic" | "classifier" | "model";

const REFUSAL_SOURCES: readonly RefusalSource[] = ["heuristic", "classifier", "model"];

// Backend `refusal_source` → typed value; anything unknown is dropped so a
// future source falls back to the generic notice instead of a blank label.
export function parseRefusalSource(value: unknown): RefusalSource | undefined {
  return typeof value === "string" &&
    (REFUSAL_SOURCES as readonly string[]).includes(value)
    ? (value as RefusalSource)
    : undefined;
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
