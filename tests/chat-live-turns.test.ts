import { test } from "node:test";
import assert from "node:assert/strict";
import { appendLiveTurn, endLiveTurn, getLiveTurn, startLiveTurn } from "../src/lib/chat-events";

test("live relay: completing an older overlap does not delete the selected replay", () => {
  const id = "fx-live-overlap";
  const older = startLiveTurn(id, { by: "fx-a", byName: "A", question: "older" });
  assert.equal(appendLiveTurn(id, "older token", older), true);
  const newer = startLiveTurn(id, { by: "fx-b", byName: "B", question: "newer" });
  assert.equal(appendLiveTurn(id, "newer token", newer), true);
  assert.equal(appendLiveTurn(id, "late older token", older), false);
  assert.equal(endLiveTurn(id, older), false);
  assert.deepEqual(getLiveTurn(id), { by: "fx-b", byName: "B", question: "newer", content: "newer token" });
  assert.equal(endLiveTurn(id, newer), true);
  assert.equal(getLiveTurn(id), null);
});

test("live relay: ownership distinguishes two streams from the same user", () => {
  const id = "fx-live-same-user";
  const first = startLiveTurn(id, { by: "fx-a", byName: "A", question: "first" });
  const second = startLiveTurn(id, { by: "fx-a", byName: "A", question: "second" });
  assert.equal(endLiveTurn(id, first), false);
  assert.equal(appendLiveTurn(id, "first", first), false);
  assert.equal(appendLiveTurn(id, "second", second), true);
  assert.equal(getLiveTurn(id)?.content, "second");
  endLiveTurn(id, second);
});

test("live relay: independent chats and ordinary single stream remain healthy", () => {
  const a = startLiveTurn("fx-live-a", { by: "fx-a", byName: "A", question: "one" });
  const b = startLiveTurn("fx-live-b", { by: "fx-b", byName: "B", question: "two" });
  assert.equal(appendLiveTurn("fx-live-b", "misdirected", a), false);
  assert.equal(appendLiveTurn("fx-live-a", "one", a), true);
  assert.equal(appendLiveTurn("fx-live-a", " two", a), true);
  assert.equal(getLiveTurn("fx-live-a")?.content, "one two");
  assert.equal(getLiveTurn("fx-live-b")?.content, "");
  assert.equal(endLiveTurn("fx-live-a", a), true);
  assert.equal(getLiveTurn("fx-live-b"), b);
  endLiveTurn("fx-live-b", b);
});
