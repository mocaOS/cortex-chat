import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { askQuestionStream } from "@/lib/api";
import {
  MINIMAL_ASK,
  heldSseResponse,
  sseResponse,
  shutdownResponse,
  sseFrame,
  makeTrace,
  kinds,
  v2ScenarioChunks,
} from "./helpers/sse";

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("fetch not stubbed for this test");
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("backend v2: done arrives before memory_update — client keeps reading past done and delivers the late memory blob", async () => {
  const memoryBlob = { summary: "turn 1", source_ledger: [{ sid: "s1" }] };
  const { early, late } = v2ScenarioChunks(memoryBlob);
  let streamClosed = false;
  const res = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of early) controller.enqueue(enc.encode(c));
        setTimeout(() => {
          for (const c of late) controller.enqueue(enc.encode(c));
          controller.close();
          streamClosed = true;
        }, 25);
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  );
  globalThis.fetch = async () => res;

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  // onDone fired with the flags seen so far; the late memory was delivered
  // AFTER done; the loop only returned after the transport actually ended.
  assert.deepEqual(kinds(events), [
    "content",
    "content",
    "sources",
    "done",
    "memory_update",
  ]);
  assert.deepEqual(events[3].value, { refused: false, truncated: false, refusalSource: undefined });
  assert.deepEqual(events[4].value, memoryBlob);
  assert.equal(streamClosed, true, "stream must be fully consumed before askQuestionStream resolves");
});

test("legacy order: memory_update before done still works", async () => {
  const memoryBlob = { legacy: true };
  globalThis.fetch = async () =>
    sseResponse([
      sseFrame({ content: "answer" }),
      sseFrame({ memory_update: memoryBlob }),
      sseFrame({ done: true }),
    ]);

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.deepEqual(kinds(events), ["content", "memory_update", "done"]);
  assert.deepEqual(events[1].value, memoryBlob);
});

test("combined frame: memory_update and done in one JSON object dispatch memory before done", async () => {
  const memoryBlob = { both: true };
  globalThis.fetch = async () =>
    sseResponse([sseFrame({ memory_update: memoryBlob, done: true })]);

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.deepEqual(kinds(events), ["memory_update", "done"]);
});

test("a trailing empty sources frame never clobbers populated sources", async () => {
  const populated = [{ document_id: "d1", chunk_id: "c1", content: "x", score: 1, metadata: { filename: "f" } }];
  globalThis.fetch = async () =>
    sseResponse([
      sseFrame({ sources: populated }),
      sseFrame({ sources: [] }),
      sseFrame({ done: true }),
    ]);

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.deepEqual(kinds(events), ["sources", "done"]);
  assert.deepEqual(events[0].value, populated);
});

test("SSE framing: heartbeats, event lines (non-shutdown), malformed JSON and no-space data lines are inert; chunk splits are transparent", async () => {
  const payload = sseFrame({ content: "tok" });
  const split = payload.slice(0, 10);
  const rest = payload.slice(10);
  globalThis.fetch = async () =>
    sseResponse([
      ": ping\n\n",
      "event: ping\n\n",
      "data: {broken json\n\n",
      "data:{\"content\":\"no-space\"}\n\n",
      split,
      rest,
      sseFrame({ done: true }),
    ]);

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  // Only the well-formed `data: ` frame is dispatched; the byte-level split
  // across chunks must not affect parsing.
  assert.deepEqual(kinds(events), ["content", "done"]);
  assert.equal(events[0].value, "tok");
});

test("clean EOF without a done frame calls neither onDone nor onError (characterized)", async () => {
  globalThis.fetch = async () => sseResponse([sseFrame({ content: "partial" })]);

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.deepEqual(kinds(events), ["content"]);
});

test("answer-quality flags accumulate: false never clears true, unknown refusal_source never erases a known one", async () => {
  globalThis.fetch = async () =>
    sseResponse([
      sseFrame({ content: "refusal", refused: true, refusal_source: "heuristic" }),
      sseFrame({ refusal_source: "classifier" }),
      sseFrame({ refused: false, truncated: true, refusal_source: "brand-new-source" }),
      sseFrame({ done: true }),
    ]);

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  const done = events.find((e) => e.kind === "done");
  assert.deepEqual(done?.value, {
    refused: true,
    truncated: true,
    refusalSource: "classifier",
  });
});

test("429 with Retry-After: onRateLimited fires once, no retry, no onError", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 429, headers: { "Retry-After": "30" } });
  };

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.equal(calls, 1, "a 429 must never be retried by the client");
  assert.deepEqual(events, [{ kind: "rate_limited", value: 30 }]);
});

test("429 without Retry-After: onRateLimited receives null", async () => {
  globalThis.fetch = async () => new Response(null, { status: 429 });

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.deepEqual(events, [{ kind: "rate_limited", value: null }]);
});

test("other non-OK statuses are terminal: onError with the status, no retry", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 401 });
  };

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.equal(calls, 1, "a 401 is an authoritative auth verdict — never retried");
  assert.deepEqual(events, [{ kind: "error", value: "API error: 401" }]);
});

test("event: shutdown resubmits transparently: same X-Request-ID, onReconnect, then the fresh answer", async () => {
  const requestIds: string[] = [];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    requestIds.push(String(new Headers(init?.headers).get("X-Request-ID")));
    if (calls === 1) return shutdownResponse([sseFrame({ content: "partial" })]);
    return sseResponse([sseFrame({ content: "full" }), sseFrame({ done: true })]);
  };

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.equal(calls, 2);
  assert.equal(requestIds[0], requestIds[1], "one request id across shutdown reconnects");
  // The first attempt's partial content was delivered before the shutdown
  // frame; the page-level onReconnect handler clears it before the replay.
  assert.deepEqual(kinds(events), ["content", "reconnect", "content", "done"]);
  assert.equal(events[2].value, "full");
});

test("shutdown on the final allowed attempt surfaces the restart error", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return shutdownResponse([]);
  };

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.equal(calls, 3, "initial attempt + MAX_RECONNECTS=2");
  // Every replayed attempt first invokes onReconnect (clear partial output).
  assert.deepEqual(kinds(events), ["reconnect", "reconnect", "error"]);
  assert.deepEqual(events[2], { kind: "error", value: "Connection lost while the server was restarting" });
});

test("connect failure shares the reconnect budget and retries", async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) throw new TypeError("connect ECONNREFUSED");
    return sseResponse([sseFrame({ done: true })]);
  };

  const { events, cb } = makeTrace();
  await askQuestionStream(MINIMAL_ASK, cb);

  assert.equal(calls, 2);
  // Every retry (shutdown or connect failure) invokes onReconnect — the page
  // uses it to clear partial output before the replayed attempt.
  assert.deepEqual(kinds(events), ["reconnect", "done"]);
});
