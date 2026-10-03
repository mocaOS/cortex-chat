import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchUpstreamWithRetry } from "@/lib/upstream-sse";

const realFetch = globalThis.fetch;
const signal = new AbortController().signal;

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("fetch not stubbed for this test");
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const INIT: RequestInit = { method: "POST", body: "{}" };

test("retries 502/503/504 (transient) then succeeds", async () => {
  let calls = 0;
  const statuses: number[] = [502, 504, 200];
  globalThis.fetch = async () =>
    new Response("upstream", {
      status: statuses[calls++],
      headers: { "content-type": "text/event-stream" },
    });

  const res = await fetchUpstreamWithRetry("http://upstream/api/ask/stream", INIT, signal);
  assert.equal(res.status, 200);
  assert.equal(calls, 3);
});

test("exhaustion returns the last transient response (503 x3) instead of throwing", async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    return new Response(null, { status: 503 });
  };

  const res = await fetchUpstreamWithRetry("http://upstream/api/ask/stream", INIT, signal);
  assert.equal(res.status, 503);
  assert.equal(n, 3, "UPSTREAM_RETRIES = 2 → three total fetches");
});

test("auth verdicts (401/403) and rate limits (429) and plain 500 are returned immediately — never retried", async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(null, { status });
    };
    const res = await fetchUpstreamWithRetry("http://upstream/api/ask/stream", INIT, signal);
    assert.equal(res.status, status);
    assert.equal(calls, 1, `status ${status} must not be retried server-side`);
  }
});

test("connect failure retries within the same budget, then throws", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("connect ECONNREFUSED");
  };

  await assert.rejects(
    () => fetchUpstreamWithRetry("http://upstream/api/ask/stream", INIT, signal),
    /ECONNREFUSED/
  );
  assert.equal(calls, 3);
});

test("numeric Retry-After is floored by the per-attempt fallback (100ms → 750ms)", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 503, headers: { "Retry-After": "0.1" } });
    return new Response("ok", { status: 200 });
  };
  const t0 = Date.now();
  await fetchUpstreamWithRetry("http://upstream/api/ask/stream", INIT, signal);
  assert.ok(
    Date.now() - t0 >= 700,
    `expected the 750ms fallback floor for a tiny Retry-After, got ${Date.now() - t0}ms`
  );
  assert.equal(calls, 2);
});

test("large numeric Retry-After is capped at 3000ms", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 503, headers: { "Retry-After": "3600" } });
    return new Response("ok", { status: 200 });
  };

  const t0 = Date.now();
  const res = await fetchUpstreamWithRetry("http://upstream/api/ask/stream", INIT, signal);
  assert.equal(res.status, 200);
  const waited = Date.now() - t0;
  assert.ok(waited >= 2900 && waited < 6000, `expected ~3000ms capped delay, got ${waited}ms`);
});

test("non-numeric (HTTP-date) Retry-After falls back to the fixed delay ladder", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1)
      return new Response(null, {
        status: 503,
        headers: { "Retry-After": "Wed, 21 Oct 2099 07:28:00 GMT" },
      });
    return new Response("ok", { status: 200 });
  };

  const t0 = Date.now();
  await fetchUpstreamWithRetry("http://upstream/api/ask/stream", INIT, signal);
  const waited = Date.now() - t0;
  assert.ok(
    waited >= 700 && waited < 2500,
    `expected the 750ms fallback for a non-numeric header, got ${waited}ms`
  );
});

test("an already-aborted signal stops retrying connect failures", async () => {
  const ac = new AbortController();
  ac.abort();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("connect ECONNREFUSED");
  };

  await assert.rejects(
    () => fetchUpstreamWithRetry("http://upstream/api/ask/stream", INIT, ac.signal),
    /ECONNREFUSED/
  );
  assert.equal(calls, 1, "aborted signal must not trigger further attempts");
});
