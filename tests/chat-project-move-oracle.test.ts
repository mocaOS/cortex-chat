import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMoveOnly } from "../scripts/chat-project-move-checks";
const before = { session: { id: "fx-chat", project_id: null, updated_at: 12, assistant_id: "fx-soul", memory: '{"unknown":[null,"日本語"]}' },
  messages: [{ id: "fx-message", content: "Preserved", metadata: '{"feedback":"up"}', user_id: "fx-author", created_at: 13 }] };
test("move oracle accepts exactly the project association change, including moving back", () => {
  const moved = structuredClone(before); (moved.session.project_id as string | null) = "fx-project"; assertMoveOnly(before, moved, "fx-project"); assertMoveOnly(moved, before, null);
});
test("move oracle rejects recency, personality, opaque memory, metadata or authorship changes", () => {
  for (const mutate of [(v: any) => v.session.updated_at++, (v: any) => v.session.assistant_id = null,
    (v: any) => v.session.memory = "{}", (v: any) => v.messages[0].metadata = "{}", (v: any) => v.messages[0].user_id = "fx-other"]) {
    const v = structuredClone(before); (v.session.project_id as string | null) = "fx-project"; mutate(v);
    assert.throws(() => assertMoveOnly(before, v, "fx-project"), e => e instanceof assert.AssertionError);
  }
});
