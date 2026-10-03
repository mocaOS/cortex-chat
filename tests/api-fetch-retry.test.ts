import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { askQuestion, fetchCollections } from "@/lib/api";

// Notes: `apiFetch` is module-private; these tests exercise it through its
// public consumers. `fetchCollections` caches successful results for 60s in
// module state, so within this file the persistent-5xx GET test must run
// BEFORE any successful GET populates the cache (test files run in separate
// processes, so cross-file isolation is preserved).

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("fetch not stubbed for this test");
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("GET exhausts the retry budget on persistent 5xx and throws (runs before the cache-populating test)", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 500 });
  };

  await assert.rejects(() => fetchCollections(), /API error: 500/);
  assert.equal(calls, 3, "RETRY_ATTEMPTS = 3 total attempts for idempotent GETs");
});

test("429 throws RateLimitError carrying the parsed Retry-After (numeric)", async () => {
  globalThis.fetch = async () =>
    new Response(null, { status: 429, headers: { "Retry-After": "120" } });

  await assert.rejects(
    () => askQuestion({ question: "q" }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.name, "RateLimitError");
      assert.equal((err as { retryAfterSeconds?: number }).retryAfterSeconds, 120);
      return true;
    }
  );
});

test("429 with an unparseable Retry-After yields retryAfterSeconds null — and is never retried", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 429, headers: { "Retry-After": "soon" } });
  };

  await assert.rejects(() => askQuestion({ question: "q" }), (err: unknown) => {
    assert.equal((err as { retryAfterSeconds?: number }).retryAfterSeconds, null);
    return true;
  });
  assert.equal(calls, 1, "429 must never be auto-retried");
});

test("GET retries 5xx with backoff and succeeds after transient failures, carrying X-Request-ID", async () => {
  let calls = 0;
  let seenHeaders: Headers | undefined;
  globalThis.fetch = async (_url, init) => {
    calls++;
    seenHeaders = new Headers(init?.headers);
    return calls < 3
      ? new Response(null, { status: 503 })
      : Response.json({ collections: [] });
  };

  const collections = await fetchCollections();
  assert.deepEqual(collections, []);
  assert.equal(calls, 3);
  const id = seenHeaders?.get("X-Request-ID");
  assert.ok(id && id.length >= 8, "every proxied request carries a request id");
});

test("POST does NOT retry on 5xx (a POST may already have had effects)", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(null, { status: 500 });
  };

  await assert.rejects(() => askQuestion({ question: "q" }), /API error: 500/);
  assert.equal(calls, 1);
});

test("POST retries when fetch itself rejects (no response received), then succeeds", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return Response.json({ answer: "ok" });
  };

  const res = await askQuestion({ question: "q" });
  assert.deepEqual(res, { answer: "ok" });
  assert.equal(calls, 2);
});
