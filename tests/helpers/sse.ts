import type { AskRequest } from "@/types";
import type { StreamCallbacks } from "@/lib/api";

// Helpers for exercising the real SSE client (`askQuestionStream`) through a
// mocked global fetch — no runtime source is modified.

export function sseFrame(json: object): string {
  return `data: ${JSON.stringify(json)}\n\n`;
}

export const encoder = new TextEncoder();

// A Response whose body emits the given chunks then closes.
export function sseResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

// A Response that emits early chunks immediately, then (after `holdMs`)
// emits the late chunks and closes — simulating backend v2's post-answer
// memory compaction gap between `done` and `memory_update`.
export function heldSseResponse(
  earlyChunks: string[],
  holdMs: number,
  lateChunks: string[]
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of earlyChunks) controller.enqueue(encoder.encode(c));
        setTimeout(() => {
          try {
            for (const c of lateChunks) controller.enqueue(encoder.encode(c));
            controller.close();
          } catch {
            // stream already cancelled — nothing to deliver
          }
        }, holdMs);
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
}

// A Response that emits `chunks` and then ends WITHOUT `done` and without an
// `event: shutdown` frame (transport ends mid-conversation).
export function shutdownResponse(chunks: string[] = []): Response {
  return sseResponse([...chunks, "event: shutdown\n\n"]);
}

export const MINIMAL_ASK: AskRequest = { question: "q" };

export type TraceEvent = { kind: string; value?: unknown };

// Collects every callback invocation in dispatch order.
export function makeTrace() {
  const events: TraceEvent[] = [];
  const cb: StreamCallbacks = {
    onContent: (t) => events.push({ kind: "content", value: t }),
    onSources: (s) => events.push({ kind: "sources", value: s }),
    onGraphContext: (g) => events.push({ kind: "graph_context", value: g }),
    onThinking: (s) => events.push({ kind: "thinking", value: s }),
    onSubQuestions: (q) => events.push({ kind: "sub_questions", value: q }),
    onRetrieval: (r) => events.push({ kind: "retrieval", value: r }),
    onRetrievalStats: (s) => events.push({ kind: "retrieval_stats", value: s }),
    onStatus: (s) => events.push({ kind: "status", value: s }),
    onMemoryUpdate: (m) => events.push({ kind: "memory_update", value: m }),
    onDone: (f) => events.push({ kind: "done", value: f }),
    onError: (e) => events.push({ kind: "error", value: e }),
    onRateLimited: (r) => events.push({ kind: "rate_limited", value: r }),
    onReconnect: () => events.push({ kind: "reconnect" }),
  };
  return { events, cb };
}

export function kinds(events: TraceEvent[]): string[] {
  return events.map((e) => e.kind);
}

// The v2 (EMIT_DONE_BEFORE_MEMORY) scenario used by both the real
// implementation gate and the negative-control mutant: content, then
// `done` (with pending_memory), the stream is held open, then the
// memory blob arrives and the transport closes.
export function v2ScenarioChunks(memoryBlob: object): {
  early: string[];
  late: string[];
} {
  return {
    early: [
      sseFrame({ content: "Hello " }),
      sseFrame({ content: "world" }),
      sseFrame({ sources: [{ document_id: "d1", chunk_id: "c1", content: "x", score: 1, metadata: { filename: "f" }, sid: "s1" }] }),
      sseFrame({ done: true, pending_memory: true }),
    ],
    late: [sseFrame({ memory_update: memoryBlob })],
  };
}
