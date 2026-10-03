import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimitMessage } from "@/lib/rate-limit-message";

// The two 429 flavors are told apart purely by the Retry-After horizon
// (>6h can only be the monthly quota). Exactly 21600s is still burst copy;
// 21601s flips to quota copy.
test("null/undefined Retry-After → generic wait message", () => {
  assert.equal(rateLimitMessage(null), rateLimitMessage(undefined));
  assert.match(rateLimitMessage(null), /wait a moment/);
});

test("burst horizon (≤6h) → 'wait about N seconds'", () => {
  assert.match(rateLimitMessage(30), /30 seconds/);
  assert.match(rateLimitMessage(1.4), /2 seconds/, "fractional seconds round up");
  assert.match(rateLimitMessage(21600), /21600 seconds/, "exactly 6h is still burst copy");
  assert.doesNotMatch(rateLimitMessage(21600), /monthly usage limit/);
});

test("quota horizon (>6h) → monthly quota message with a reset date", () => {
  const msg = rateLimitMessage(21601);
  assert.match(msg, /monthly usage limit has been reached/);
  assert.match(msg, /It resets on .+/);
  assert.notEqual(rateLimitMessage(21601), rateLimitMessage(21600));
});

test("the two flavors are distinguishable for every input class", () => {
  for (const seconds of [1, 90, 3600, 21600]) {
    assert.doesNotMatch(rateLimitMessage(seconds), /monthly usage limit/);
  }
  for (const seconds of [21601, 86400, 2_592_000]) {
    assert.match(rateLimitMessage(seconds), /monthly usage limit/);
  }
});
