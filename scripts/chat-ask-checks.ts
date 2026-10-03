// Behavioral obligations at the actual Next HTTP boundary. No route imports,
// auth bypasses or production writes. Fixture-only DB setup is declared below.
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { join } from "node:path";
import type { MemoryChecksCtx } from "./chat-memory-checks";

const READ_KEY = "fx-synthetic-backend-read-key-0001";
const FOREIGN_KEY = "fx-synthetic-foreign-read-key-0003";
const COLLECTION = "fx-collection-0001";
const SOUL = "You are a synthetic fixture soul used to verify a whole-stack restore.";
const PROJECT = "Synthetic project instructions for restore verification.";
const UNICODE_NAME = "üñícode-öwner-Ω-日本語-✓";
const LOCAL_IDS = ["session_id", "assistant_id", "project_id"];
const ROUTES = ["/api/ask/stream", "/api/proxy/api/ask"];

export function assertForwarded(record: any, expected: any) {
  assert.equal(record.method, "POST");
  assert.equal(record.headers["x-api-key"], expected.key, "caller must use their group key");
  assert.equal(record.headers["x-request-id"], expected.requestId);
  assert.equal(record.headers["authorization"], undefined, "caller authorization must not leak");
  for (const key of LOCAL_IDS) assert.ok(!(key in record.body), `${key} leaked upstream`);
  for (const key of ["question", "collection_id", "conversation_memory", "depth"])
    assert.deepEqual(record.body[key], expected.body[key], `${key} changed upstream`);
  if (expected.streaming) assert.equal(record.headers["accept-encoding"], "identity");
}

export async function runAskChecks(ctx: MemoryChecksCtx) {
  const checks: { id: string; ok: boolean; detail: unknown }[] = [];
  const add = async (id: string, fn: () => unknown | Promise<unknown>) => {
    try { checks.push({ id, ok: true, detail: await fn() }); }
    catch (e) { checks.push({ id, ok: false, detail: String(e) }); }
  };
  const cookies: Record<string, string> = {};
  for (const name of ["owner", "member", "foreign", "noGroup"] as const) {
    await add(`ask.login.${name}`, async () => {
      const user = ctx.users[name];
      const res = await ctx.request("/api/auth/login", { method: "POST", body: user });
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.id, user.id);
      const cookie = res.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie && cookie.startsWith("cortex_session="));
      cookies[name] = cookie;
      return { status: res.status, id: body.id };
    });
  }

  // Scope fixtures differ deliberately: owner/member scoped, foreign all-scope.
  // Also install invisible Unicode analytics and a foreign-only soul. These are
  // run-owned synthetic rows, never modifications to migrations or runtime.
  await add("ask.fixture.scope-and-private-context", () => {
    const db = new Database(join(ctx.dataDir, "cortex-chat.db"));
    try {
      assert.equal(db.prepare("UPDATE api_keys SET collection_ids = ? WHERE id = ?")
        .run(JSON.stringify([COLLECTION]), ctx.ids.readKey).changes, 1);
      db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)")
        .run("cortexAnalyticsTemplate", "Identity: $userName <$userEmail>", Date.now());
      db.prepare("INSERT INTO assistants(id,name,soul,scope,user_id,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run("fx-journey-private-soul", "Private fixture soul", "FOREIGN-PRIVATE-SOUL", "user", ctx.users.foreign.id, 1, Date.now(), Date.now());
      return { ownerScope: [COLLECTION], foreignScope: [], privateSoul: "foreign-only" };
    } finally { db.close(); }
  });

  // Fixture backend is intentionally independent of Chat scope helpers. A key
  // restricts collection access here even when the streaming proxy delegates it.
  ctx.upstream.setHandler((_req, res, rec: any) => {
    const statusQuestion = /^status-(401|403|429|500)$/.exec(rec.body?.question ?? "");
    const denied = rec.headers["x-api-key"] === READ_KEY &&
      rec.body?.collection_id && rec.body.collection_id !== COLLECTION;
    const status = statusQuestion ? Number(statusQuestion[1]) : denied ? 403 : 200;
    if (status !== 200) {
      res.writeHead(status, { "Content-Type": "application/json", "Retry-After": "17" });
      res.end(JSON.stringify({ detail: "synthetic upstream verdict" }));
    } else if (rec.path === "/api/ask/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const f of [{ content: "fixture answer" }, { done: true, pending_memory: true },
        { memory_update: { opaque: "ask-fixture", nested: [null, "日本語"] } }])
        res.write(`data: ${JSON.stringify(f)}\n\n`);
      res.end();
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ answer: "fixture answer", sources: [] }));
    }
  });

  for (const [i, route] of ROUTES.entries()) {
    const prefix = i === 0 ? "stream" : "generic";
    for (const [name, cookie, expected] of [
      ["anonymous", undefined, 401], ["invalid-token", "cortex_session=invalid-fixture", 401],
      ["expired", `cortex_session=${ctx.ids.expiredSessionToken}`, 401],
      ["no-group", cookies.noGroup, 403],
    ] as const) {
      await add(`ask.${prefix}.deny.${name}`, async () => {
        const before = ctx.upstream.requests.length;
        const res = await ctx.request(route, { method: "POST", cookie, body: { question: "denied" } });
        await res.text();
        assert.equal(res.status, expected);
        assert.equal(ctx.upstream.requests.length, before, "denial must precede upstream effects");
        return { status: res.status, upstreamHits: 0 };
      });
    }
    for (const name of ["owner", "foreign"] as const) {
      await add(`ask.${prefix}.forward.${name}`, async () => {
        const body = { question: `healthy-${prefix}-${name}`, collection_id: COLLECTION, depth: "standard",
          conversation_memory: { unknown: ["opaque", null, { unicode: "日本語" }] },
          conversation_history: [{ role: "user", content: "prior question" }],
          session_id: ctx.ids.chat, assistant_id: ctx.ids.soul, project_id: ctx.ids.project };
        const before = ctx.upstream.requests.length;
        const requestId = `fx-ask-${prefix}-${name}`;
        const res = await ctx.request(route, { method: "POST", cookie: cookies[name], body,
          headers: { "X-Request-ID": requestId, "X-API-Key": "forged-caller-key",
            Authorization: "Bearer forged-caller-authority", "Accept-Encoding": "gzip" } });
        const text = await res.text();
        assert.equal(res.status, 200);
        assert.equal(res.headers.get("x-request-id"), requestId);
        assert.equal(ctx.upstream.requests.length - before, 1);
        const record = ctx.upstream.requests[before] as any;
        assertForwarded(record, { key: name === "owner" ? READ_KEY : FOREIGN_KEY,
          requestId, body, streaming: i === 0 });
        const history = record.body.conversation_history;
        if (i === 0 && name === "owner") {
          assert.deepEqual(history, [
            { role: "user", content: `Identity: ${UNICODE_NAME} <${ctx.users.owner.email}>` },
            { role: "user", content: SOUL }, { role: "user", content: PROJECT },
            ...body.conversation_history,
          ], "authorized invisible context order/content");
        } else if (i === 0) {
          assert.ok(!JSON.stringify(history).includes(PROJECT), "foreign project must not inject");
        } else assert.deepEqual(history, body.conversation_history, "generic ask only strips local IDs");
        assert.ok(!text.includes("synthetic-backend-read-key"), "backend key exposed in response");
        assert.ok(!text.includes("Identity:"), "analytics must not echo");
        return { status: 200, requestId, keyMatches: true, stripped: LOCAL_IDS, history };
      });
    }
    await add(`ask.${prefix}.scope.off-collection`, async () => {
      const before = ctx.upstream.requests.length;
      const res = await ctx.request(route, { method: "POST", cookie: cookies.owner,
        body: { question: "off-scope", collection_id: "fx-off-scope" } });
      await res.text();
      assert.equal(res.status, 403);
      const hits = ctx.upstream.requests.length - before;
      assert.equal(hits, i === 0 ? 1 : 0, "stream delegates scope to scoped backend key; generic refuses locally");
      if (hits) assert.equal((ctx.upstream.requests[before] as any).headers["x-api-key"], READ_KEY);
      return { status: 403, upstreamHits: hits, scopeOwner: i === 0 ? "fixture-backend" : "Chat" };
    });
    await add(`ask.${prefix}.scope.unrestricted-control`, async () => {
      const res = await ctx.request(route, { method: "POST", cookie: cookies.foreign,
        body: { question: "all-scope", collection_id: "fx-off-scope" } });
      await res.text();
      assert.equal(res.status, 200, "empty key collection scope means all");
      return { status: 200 };
    });
    await add(`ask.${prefix}.request-id-minted`, async () => {
      const before = ctx.upstream.requests.length;
      const res = await ctx.request(route, { method: "POST", cookie: cookies.owner, body: { question: "mint-id" } });
      await res.text();
      const id = res.headers.get("x-request-id");
      assert.match(id ?? "", /^[0-9a-f-]{36}$/);
      assert.equal(id, (ctx.upstream.requests[before] as any).headers["x-request-id"]);
      return { requestId: id };
    });
    for (const status of [401, 403, 429, 500]) {
      await add(`ask.${prefix}.upstream.${status}`, async () => {
        const before = ctx.upstream.requests.length;
        const requestId = `fx-${prefix}-error-${status}`;
        const res = await ctx.request(route, { method: "POST", cookie: cookies.owner,
          headers: { "X-Request-ID": requestId }, body: { question: `status-${status}` } });
        await res.text();
        assert.equal(res.status, status);
        assert.equal(res.headers.get("retry-after"), "17");
        assert.equal(res.headers.get("x-request-id"), requestId);
        assert.equal(ctx.upstream.requests.length - before, 1, "authoritative verdict must not retry");
        return { status, retryAfter: "17", upstreamHits: 1 };
      });
    }
  }

  for (const [method, route] of [
    ["GET", "/api/proxy/api/ask"], ["POST", "/api/proxy/api/ask/stream"],
    ["POST", "/api/proxy/api/admin/keys"], ["GET", "/api/proxy/api/documents/fx-source-0001/file"],
    ["POST", "/api/proxy/api/search"], ["POST", "/api/proxy/api/ask/extra"],
  ]) {
    await add(`ask.allowlist.${method}.${route}`, async () => {
      const before = ctx.upstream.requests.length;
      const res = await ctx.request(route, { method, cookie: cookies.owner,
        ...(method === "POST" ? { body: { question: "forbidden route" } } : {}) });
      await res.text();
      assert.equal(res.status, 404);
      assert.equal(ctx.upstream.requests.length, before);
      return { status: 404, upstreamHits: 0 };
    });
  }
  await add("ask.stream.foreign-private-context-ignored", async () => {
    const before = ctx.upstream.requests.length;
    const res = await ctx.request(ROUTES[0], { method: "POST", cookie: cookies.owner,
      body: { question: "private context control", assistant_id: "fx-journey-private-soul", project_id: "unknown-project" } });
    await res.text();
    assert.equal(res.status, 200, "inaccessible context ignored, not an ask authorization verdict");
    const forwarded = (ctx.upstream.requests[before] as any).body;
    assert.ok(!JSON.stringify(forwarded).includes("FOREIGN-PRIVATE-SOUL"));
    assert.ok(!("assistant_id" in forwarded) && !("project_id" in forwarded));
    return { status: 200, privateContextInjected: false };
  });
  return checks;
}
