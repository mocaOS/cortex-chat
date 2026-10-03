import { test } from "node:test";
import assert from "node:assert/strict";
import { assertDeleteOnly } from "../scripts/chat-project-delete-checks";
const before = { projects: [{ id: "p" }, { id: "other" }], shares: [{ id: "s", project_id: "p" }, { id: "t", project_id: "other" }],
  sessions: [{ id: "a", user_id: "owner", project_id: "p", assistant_id: "soul", memory: '{"unknown":[null,"日本語"]}', updated_at: 12 },
    { id: "b", user_id: "member", project_id: "p", assistant_id: null, memory: "null", updated_at: 13 }, { id: "c", project_id: "other" }],
  messages: [{ id: "m", chat_session_id: "a", user_id: "member", content: "Preserved", metadata: '{"sources":[{"sid":"stable"}]}', created_at: 14 }] };
const valid = () => ({ projects: [before.projects[1]], shares: [before.shares[1]], sessions: before.sessions.map(s => s.project_id === "p" ? { ...s, project_id: null } : s), messages: before.messages });
test("delete oracle accepts exact multi-author detach and preserves unrelated project state", () => assertDeleteOnly(before, valid(), "p"));
test("delete oracle rejects missing chats, residual grants and unrelated or opaque state loss", () => {
  for (const mutate of [(v: any) => v.sessions.splice(1, 1), (v: any) => v.shares.push(before.shares[0]), (v: any) => v.projects.pop(),
    (v: any) => v.sessions[0].memory = "{}", (v: any) => v.sessions[0].assistant_id = null, (v: any) => v.sessions[0].updated_at++,
    (v: any) => v.messages[0].metadata = "{}", (v: any) => v.messages[0].user_id = "owner", (v: any) => v.sessions[1].project_id = "p"]) {
    const v = structuredClone(valid()); mutate(v); assert.throws(() => assertDeleteOnly(before, v, "p"), e => e instanceof assert.AssertionError);
  }
});
