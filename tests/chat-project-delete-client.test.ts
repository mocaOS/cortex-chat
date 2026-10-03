import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteProject } from "../src/lib/projects-client";
test("project deletion client acknowledges successful DELETE once", async () => {
  const original = globalThis.fetch, calls: any[] = [];
  globalThis.fetch = (async (url: any, init: any) => { calls.push({ url, method: init.method }); return Response.json({ ok: true }); }) as typeof fetch;
  try { assert.equal(await deleteProject("fx-delete-client"), undefined); assert.deepEqual(calls, [{ url: "/api/me/projects/fx-delete-client", method: "DELETE" }]); } finally { globalThis.fetch = original; }
});
test("project deletion client propagates authoritative non-success statuses", async () => {
  const original = globalThis.fetch;
  try { for (const status of [403, 404, 500]) { globalThis.fetch = (async () => Response.json({ error: `Synthetic rejection ${status}` }, { status })) as typeof fetch;
    await assert.rejects(deleteProject("fx-delete-client"), new RegExp(`Synthetic rejection ${status}`)); } } finally { globalThis.fetch = original; }
});
test("project deletion client propagates transport failure without replay", async () => {
  const original = globalThis.fetch, error = new TypeError("Synthetic network failure"); let attempts = 0;
  globalThis.fetch = (async () => { attempts++; throw error; }) as typeof fetch;
  try { await assert.rejects(deleteProject("fx-delete-client"), e => e === error); assert.equal(attempts, 1); } finally { globalThis.fetch = original; }
});
