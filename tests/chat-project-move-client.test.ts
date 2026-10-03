import { test } from "node:test";
import assert from "node:assert/strict";
import { setChatProject, setChatStorageMode } from "../src/lib/chatHistory";

test("move client sends only the association change and resolves an acknowledged save", async () => {
  const original = globalThis.fetch, requests: any[] = []; setChatStorageMode("server");
  globalThis.fetch = async (url, init) => { requests.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
    return new Response('{"ok":true}', { status: 200, headers: { "Content-Type": "application/json" } }); };
  try {
    assert.equal(await setChatProject("fx-chat", "fx-project"), undefined);
    assert.equal(await setChatProject("fx-chat", null), undefined);
    assert.deepEqual(requests, [{ url: "/api/me/chats/fx-chat", method: "PATCH", body: { projectId: "fx-project" } },
      { url: "/api/me/chats/fx-chat", method: "PATCH", body: { projectId: null } }]);
  } finally { globalThis.fetch = original; }
});

test("move client preserves authoritative rejection, including a missing or non-owned chat404", async () => {
  const original = globalThis.fetch; setChatStorageMode("server");
  try {
    for (const status of [404, 400]) {
      globalThis.fetch = async () => new Response('{"error":"Not found"}', { status });
      await assert.rejects(setChatProject("fx-chat", "fx-project"), new RegExp(`Chat API error: ${status}`));
    }
  } finally { globalThis.fetch = original; }
});
