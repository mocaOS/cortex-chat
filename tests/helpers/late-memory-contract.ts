import assert from "node:assert/strict";
import type { AskRequest } from "@/types";
import type { StreamCallbacks } from "@/lib/api";
import { MINIMAL_ASK, makeTrace, kinds, v2ScenarioChunks, heldSseResponse } from "./sse";

// Shared observable contract oracle for the backend-v2 late-memory incident
// constraint. It runs the SAME scenario against ANY implementation of the
// `askQuestionStream` entry boundary and asserts implementation-independent
// obligations:
//   1. the late memory blob is RETAINED — delivered after `done`, verbatim;
//   2. the read loop consumes the transport past `done` (order proves it).
// The healthy control and the negative control both run this function
// unchanged; the only difference is which implementation is passed in.
export async function runV2LateMemoryContract(
  ask: (req: AskRequest, cb: StreamCallbacks) => Promise<void>
): Promise<void> {
  const memoryBlob = { summary: "turn 1", source_ledger: [{ sid: "s1" }] };
  const { early, late } = v2ScenarioChunks(memoryBlob);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => heldSseResponse(early, 25, late);
  try {
    const { events, cb } = makeTrace();
    await ask(MINIMAL_ASK, cb);

    assert.deepEqual(
      kinds(events),
      ["content", "content", "sources", "done", "memory_update"],
      "late memory_update must be dispatched AFTER done — the read loop may not stop at the done frame"
    );
    const memory = events.find((e) => e.kind === "memory_update");
    assert.ok(memory, "the late memory blob must reach the caller");
    assert.deepEqual(
      memory.value,
      memoryBlob,
      "the memory blob must be replayed verbatim (opaque, never reconstructed)"
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}
