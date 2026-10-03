import { test } from "node:test";
import assert from "node:assert/strict";
import { exact, replay } from "../scripts/chat-shutdown-checks";

// Comparator self-controls, not a browser mutant or defect reproduction.
// Imports are outside rejection assertions: wiring failures cannot pass them.
const base = [{ id: "fx-oracle-prefix", role: "user", content: "Retained prefix" }];
const expected = [...base, { id: "fx-oracle-answer", role: "assistant", content: "Replacement answer" }];
const memory = { unknown: [null, "日本語", { escaped: "\\\"\n", future: false }] };
const observation = () => ({
  http: { status: 200, body: { messages: structuredClone(expected), memory: structuredClone(memory) } },
  sqlite: { messages: structuredClone(expected), session: { memory: JSON.stringify(memory) } },
});
const rejects = (fn: () => void) => assert.throws(fn, e => e instanceof assert.AssertionError);
const attempts = () => Array.from({ length: 3 }, () => ({
  id: "fx-stable-request", headers: { "accept-encoding": "identity" },
  body: { question: "Retry question", conversation_memory: structuredClone(memory),
    conversation_history: base.map(({ role, content }) => ({ role, content })) },
}));

test("shutdown durable oracle accepts exact history and unknown opaque memory", () => {
  exact(observation(), expected, memory);
});

test("shutdown durable oracle rejects concatenated partial, changed prefix and HTTP/SQLite recall disagreement", () => {
  const partial = observation(); partial.http.body.messages[1].content = "Discarded partial Replacement answer";
  rejects(() => exact(partial, expected, memory));
  const prefix = observation(); prefix.sqlite.messages[0].content = "Lost prefix";
  rejects(() => exact(prefix, expected, memory));
  const hybrid = observation(); hybrid.sqlite.session.memory = JSON.stringify({ fabricated: true });
  rejects(() => exact(hybrid, expected, memory));
  const opaque = observation(); opaque.http.body.memory.unknown = [];
  rejects(() => exact(opaque, expected, memory));
});

test("shutdown replay oracle accepts three identical attempts with one request ID", () => {
  replay(attempts(), 3, memory, base);
});

test("shutdown replay oracle rejects new retry IDs, request drift, wrong immutable recall and a fourth attempt", () => {
  const ids = attempts(); ids[1].id = "fx-changed-request";
  rejects(() => replay(ids, 3, memory, base));
  const drift = attempts(); drift[1].body.question = "Changed question";
  rejects(() => replay(drift, 3, memory, base));
  const recall = attempts(); for (const r of recall) r.body.conversation_memory.unknown = [];
  rejects(() => replay(recall, 3, memory, base));
  rejects(() => replay([...attempts(), attempts()[0]], 3, memory, base));
});
