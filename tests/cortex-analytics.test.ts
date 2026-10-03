import { test } from "node:test";
import assert from "node:assert/strict";
import { injectCortexAnalytics, renderCortexAnalytics } from "@/lib/cortex-analytics";

const USER = { email: "u@example.com", username: "Ursula" };
const USER_NO_NAME = { email: "u@example.com", username: "" };

test("renderCortexAnalytics substitutes declared variables; blank username falls back to email", () => {
  assert.equal(
    renderCortexAnalytics("Hello $userName <$userEmail>", USER),
    "Hello Ursula <u@example.com>"
  );
  assert.equal(
    renderCortexAnalytics("Hello $userName", USER_NO_NAME),
    "Hello u@example.com"
  );
});

test("renderCortexAnalytics returns null for an empty/blank template so callers skip injection", () => {
  assert.equal(renderCortexAnalytics("", USER), null);
  assert.equal(renderCortexAnalytics("   ", USER), null);
});

test("injectCortexAnalytics prepends the block as the first conversation_history entry", () => {
  const body = JSON.stringify({
    question: "q",
    conversation_history: [{ role: "user", content: "earlier" }],
  });
  const out = JSON.parse(injectCortexAnalytics(body, "ANALYTICS-BLOCK"));
  assert.deepEqual(out.conversation_history[0], { role: "user", content: "ANALYTICS-BLOCK" });
  assert.deepEqual(out.conversation_history[1], { role: "user", content: "earlier" });
  assert.equal(out.question, "q");
});

test("injectCortexAnalytics creates conversation_history when absent and tolerates a non-array value", () => {
  const created = JSON.parse(injectCortexAnalytics(JSON.stringify({ question: "q" }), "B"));
  assert.deepEqual(created.conversation_history, [{ role: "user", content: "B" }]);

  const healed = JSON.parse(injectCortexAnalytics(JSON.stringify({ conversation_history: "garbage" }), "B"));
  assert.deepEqual(healed.conversation_history, [{ role: "user", content: "B" }]);
});

test("injectCortexAnalytics fails open on malformed JSON — never blocks a chat", () => {
  const malformed = "{not json";
  assert.equal(injectCortexAnalytics(malformed, "B"), malformed);
});

test("injectCortexAnalytics with a null rendered block is a no-op", () => {
  const body = JSON.stringify({ question: "q", conversation_history: [] });
  assert.equal(injectCortexAnalytics(body, null), body);
});
