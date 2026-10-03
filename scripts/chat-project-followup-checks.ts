// project-followup-v1: frozen positive consumer gates; genuine GET barriers,
// Chromium network disconnects, held loopback SSE, acknowledged HTTP + SQLite.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeFeedTransport } from "./chat-feed-transport";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController,
  pollUntil, setAppLocale, sqliteReadSession } from "./chat-browser-checks";

export const FOLLOWUP_HTTP_GATES = [
  "http.read-control", "http.local-fork-lww", "http.same-id-opaque-replace", "http.reconnect-current-snapshot",
];

export const FOLLOWUP_BROWSER_GATES = [
  "browser.logins-dark-en-de", "browser.idle-adoption-control", "browser.same-exchange-adoption",
  "browser.regenerate-immutable-snapshot", "browser.regenerate-local-fork", "browser.superseded-late-memory",
  "browser.regenerate-settles", "browser.foreign-action-gating", "browser.edit-earlier-local-fork",
  "browser.edit-earlier-settles", "browser.overlapping-genuine-reads", "browser.latest-read-wins",
  "browser.latest-read-feedback-recall", "browser.loaded-edit-last-fallback", "browser.edit-last-settles",
  "browser.idle-real-disconnect-reconnect", "browser.idle-missed-write-adopted", "browser.idle-reconnect-feedback-recall",
  "browser.live-relay-control", "browser.live-real-disconnect-reconnect", "browser.live-missed-completion-adopted",
  "browser.live-reconnect-feedback-recall", "browser.adoption-read-only", "browser.patch-acknowledgments",
  "browser.no-page-errors", "browser.no-blocked-requests", "browser.all-responses-released",
];
const blob = (tag: string) => ({ unknown: [null, "日本語", { tag }], opaque: tag });
const done = { done: true, pending_memory: true };
const memory = (value: unknown) => ({ memory_update: value });
const pair = (id: string, text: string) => [
  { id: `${id}-u`, role: "user", content: `${text} question` },
  { id: `${id}-a`, role: "assistant", content: `${text} answer` },
];
const projection = (messages: any[]) => messages.map(m => ({ id: m.id, role: m.role, content: m.content }));
async function json(ctx: any, path: string, cookie: string, method = "GET", body?: unknown) {
  const res = await ctx.request(path, { cookie, method, ...(body === undefined ? {} : { body }) });
  const value = await res.json();
  assert.equal(res.status, 200, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
async function login(ctx: any, name: string) {
  const res = await ctx.request("/api/auth/login", { method: "POST", body: ctx.users[name] });
  assert.equal(res.status, 200); await res.json();
  return res.headers.get("set-cookie")!.split(";")[0];
}
async function create(ctx: any, cookie: string, title: string) {
  return (await json(ctx, "/api/me/chats", cookie, "POST", { title, projectId: ctx.ids.project })).id as string;
}
async function patch(ctx: any, cookie: string, id: string, messages: any[], value: unknown) {
  await json(ctx, `/api/me/chats/${id}`, cookie, "PATCH", { messages, memory: value });
  const got = await json(ctx, `/api/me/chats/${id}`, cookie);
  assert.deepEqual(projection(got.messages), projection(messages));
  assert.deepEqual(got.memory, value);
  const db = sqliteReadSession(ctx.dataDir, id);
  assert.deepEqual(projection(db.messages), projection(messages));
  assert.equal(db.session.memory, JSON.stringify(value));
  return got;
}
async function gate(ctx: any, id: string, fn: () => Promise<unknown>) {
  try { ctx.check(id, true, await fn()); }
  catch (e) { ctx.check(id, false, { error: String((e as Error).stack ?? e) }); }
}
async function visible(s: BrowserSession, text: string, budget = 8000) {
  return pollUntil(() => s.page.locator("main").innerText().then((t: string) => t.includes(text)), budget);
}
async function feedState(s: BrowserSession, id: string) {
  return s.page.evaluate((chatId: string) => (window as any).__followupFeeds
    .filter((f: any) => f.url === `/api/me/chats/${chatId}/events` && !f.closed).at(-1), id);
}
async function ready(s: BrowserSession, id: string) {
  assert.ok(await pollUntil(async () => (await feedState(s, id))?.ready === 1, 15000), "actual EventSource OPEN required");
}
async function open(s: BrowserSession, ctx: any, id: string, text: string) {
  await s.page.goto(`${ctx.baseUrl}/?chat=${id}`, { waitUntil: "domcontentloaded" });
  await s.waitForComposer(); assert.ok(await visible(s, text)); await ready(s, id);
}
async function durable(s: BrowserSession, ctx: any, id: string, value: unknown, tail: string) {
  const got = await s.durableSettled(ctx, id, d => JSON.stringify(d.http.body?.memory) === JSON.stringify(value) &&
    d.sqlite.session?.memory === JSON.stringify(value) && d.http.body?.messages?.at(-1)?.content === tail);
  assert.deepEqual(got.http.body.memory, value); assert.equal(got.sqlite.session.memory, JSON.stringify(value));
  assert.equal(got.http.body.messages.at(-1).content, tail);
  assert.deepEqual(projection(got.sqlite.messages), projection(got.http.body.messages));
  return got;
}
async function feedback(s: BrowserSession, ctx: any, id: string, expected: any[], value: unknown, text: string) {
  const bubble = s.page.locator("div.group").filter({ hasText: text }).last();
  const selected = [...expected].reverse().find(m => m.role === "assistant" && m.content.includes(text));
  assert.ok(selected, "feedback selector must resolve an independently expected message");
  await bubble.hover(); await bubble.locator('button[aria-label="Bad answer"]').click();
  // The memory/content may already match BEFORE the feedback PATCH commits.
  // Wait for its actual metadata effect too, never merely a captured request.
  const got = await s.durableSettled(ctx, id, d => JSON.stringify(d.http.body?.memory) === JSON.stringify(value) &&
    d.sqlite.session?.memory === JSON.stringify(value) &&
    d.http.body?.messages?.find((m: any) => m.id === selected.id)?.feedback === "down");
  assert.deepEqual(got.http.body.memory, value); assert.equal(got.sqlite.session.memory, JSON.stringify(value));
  assert.deepEqual(projection(got.http.body.messages), projection(expected));
  assert.deepEqual(projection(got.sqlite.messages), projection(expected));
  assert.equal(got.http.body.messages.find((m: any) => m.id === selected.id)?.feedback, "down");
  return got;
}
// Hold the actual response AFTER fetching/decoding it from the running app.
async function holdReads(s: BrowserSession, ctx: any, id: string, count: number) {
  const reads: any[] = [];
  const matcher = `${ctx.baseUrl}/api/me/chats/${id}`;
  const handler = async (route: any) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const row = { body: await response.json(), status: response.status(), release, delivered: false };
    reads.push(row);
    await barrier; await route.fulfill({ response }); row.delivered = true;
  };
  await s.context.route(matcher, handler, { times: count });
  return { reads, async close() {
    for (const r of reads) r.release();
    await s.context.unroute(matcher, handler);
  } };
}
async function disconnect(s: BrowserSession, id: string, transport: Awaited<ReturnType<typeof makeFeedTransport>>) {
  await ready(s, id);
  const before = await feedState(s, id);
  transport.drop();
  assert.ok(await pollUntil(async () => (await feedState(s, id))?.errors > before.errors, 10000), "real feed error required");
  return before;
}
async function reconnect(s: BrowserSession, id: string, before: any, transport: Awaited<ReturnType<typeof makeFeedTransport>>) {
  transport.restore();
  let now: any;
  const reopened = await pollUntil(async () => {
    now = await feedState(s, id);
    return now?.ready === 1 && now.opens > before.opens && now.errors > before.errors;
  }, 20000);
  s.recorder.obs("reconnect", { before, after: now, reopened });
  assert.ok(reopened, `same actual EventSource must reopen after observed transport failure: ${JSON.stringify({ before, after: now })}`);
  return feedState(s, id);
}

// Evaluation helpers shared by the next bounded continuity scenario. Original
// gates remain here; none of these helpers mutate product source or live stores.
export const projectFixture = {
  blob, done, memory, pair, projection, json, login, create, patch, gate, visible,
  feedState, ready, open, durable, feedback, holdReads, disconnect, reconnect,
};

export async function runFollowupHttp(ctx: any) {
  const owner = await login(ctx, "owner"), member = await login(ctx, "member");
  const id = await create(ctx, owner, "HTTP followup fork");
  const base = pair("fx-follow-http-base", "HTTP base"), remote = [...base, ...pair("fx-follow-http-remote", "HTTP remote")];
  await gate(ctx, FOLLOWUP_HTTP_GATES[0], async () => {
    await patch(ctx, owner, id, base, blob("http-base"));
    const got = await json(ctx, `/api/me/chats/${id}`, member);
    assert.deepEqual(projection(got.messages), base); return got;
  });
  await gate(ctx, FOLLOWUP_HTTP_GATES[1], async () => {
    await patch(ctx, member, id, remote, blob("http-remote"));
    const fork = [...base, ...pair("fx-follow-http-fork", "HTTP deliberate fork")];
    return patch(ctx, owner, id, fork, blob("http-fork"));
  });
  await gate(ctx, FOLLOWUP_HTTP_GATES[2], async () => {
    const got = await json(ctx, `/api/me/chats/${id}`, member);
    const changed = got.messages.map((m: any, i: number) => i === got.messages.length - 1
      ? { ...m, content: "HTTP same identity changed", feedback: "up" } : m);
    return patch(ctx, member, id, changed, blob("http-same-id"));
  });
  await gate(ctx, FOLLOWUP_HTTP_GATES[3], async () => {
    const abort = new AbortController();
    const feed = await fetch(`${ctx.baseUrl}/api/me/chats/${id}/events`, { headers: { Cookie: owner }, signal: abort.signal });
    assert.equal(feed.status, 200);
    const first = await feed.body!.getReader().read();
    assert.ok(new TextDecoder().decode(first.value).includes(": connected")); abort.abort();
    await patch(ctx, member, id, remote, blob("http-offline-final"));
    const nextAbort = new AbortController();
    const next = await fetch(`${ctx.baseUrl}/api/me/chats/${id}/events`, { headers: { Cookie: owner }, signal: nextAbort.signal });
    assert.equal(next.status, 200);
    assert.ok(new TextDecoder().decode((await next.body!.getReader().read()).value).includes(": connected"));
    nextAbort.abort();
    const got = await json(ctx, `/api/me/chats/${id}`, owner);
    assert.deepEqual(got.memory, blob("http-offline-final")); assert.deepEqual(projection(got.messages), remote);
    return { reconnected: true, explicitRead: got, note: "HTTP driver reconnect + GET; browser recovery is a separate gate" };
  });
}

export async function runFollowupBrowser(ctx: any) {
  const recorder = new Recorder(join(ctx.workDir, "logs"));
  copyFileSync(join(ctx.appDir, "src/app/page.tsx"), join(recorder.dir, "input-page.tsx"));
  const prereq = browserPrerequisites(); assert.deepEqual(prereq.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json"));
  const pw = require(join(prereq.pwPath, "index.js"));
  writeFileSync(join(recorder.dir, "tooling.json"), JSON.stringify({ ...prereq,
    version: JSON.parse(readFileSync(join(prereq.pwPath, "package.json"), "utf8")).version,
    browserProfileTmpdir: process.env.TMPDIR, install: false }, null, 2));
  const owner = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder);
  const member = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder);
  const sessions = [owner, member], controller = makeUpstreamController(ctx);
  const acknowledgments: any[] = [], barriers: any[] = [];
  const transport = await makeFeedTransport(ctx.baseUrl);
  let adoptionWrites = 0;
  try {
    for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) {
      await s.start(s === member ? owner.browser : undefined);
      await s.context.addInitScript(() => {
        const Original = window.EventSource;
        (window as any).__followupFeeds = [];
        window.EventSource = class extends Original {
          observation: any;
          constructor(url: string | URL, init?: EventSourceInit) {
            super(url, init);
            const entry = { url: String(url), ready: 0, opens: 0, errors: 0, closed: false, events: [] as unknown[] };
            this.observation = entry; (window as any).__followupFeeds.push(entry);
            this.addEventListener("open", () => { entry.ready = this.readyState; entry.opens++; });
            this.addEventListener("error", () => { entry.ready = this.readyState; entry.errors++; });
            this.addEventListener("message", e => { entry.events.push(JSON.parse(e.data)); });
          }
          close() { this.observation.closed = true; this.observation.ready = 2; super.close(); }
        };
      });
      s.context.on("response", (res: any) => {
        if (res.request().method() === "PATCH" && /\/api\/me\/chats\/[^/?]+$/.test(new URL(res.url()).pathname))
          acknowledgments.push({ url: res.url(), status: res.status(), at: Date.now() });
      });
      await s.login(ctx, ctx.users[name].email, ctx.users[name].password);
    }
    // Rewrite only owner's feed network destination to an owned transparent
    // loopback forwarding barrier; EventSource still uses the supported URL.
    await owner.context.route(/\/api\/me\/chats\/[^/?]+\/events$/, (route: any) => {
      recorder.obs("feed-transport", { original: route.request().url(), forwarder: transport.url });
      return route.continue({ url: transport.url + new URL(route.request().url()).pathname });
    });
    const g = (id: string, fn: () => Promise<unknown>) => gate(ctx, `browser.${id}`, fn);
    await g("logins-dark-en-de", async () => {
      for (const [s, name] of [[owner, "owner"], [member, "member"]] as const)
        assert.equal((await json(ctx, "/api/auth/me", s.cookie)).id, ctx.users[name].id);
      assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de"); await owner.page.reload(); await owner.waitForComposer();
      assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research...");
      await recorder.screenshot(owner.page, "followup-dark-de");
      setAppLocale(ctx.dataDir, "en"); await owner.page.reload(); await owner.waitForComposer();
      assert.equal(await owner.composer().getAttribute("placeholder"), "Ask a complex question for deep research...");
      return { forms: 2, locales: ["de", "en"] };
    });
    const id = await create(ctx, owner.cookie, "Followup immutable fork");
    const base = pair("fx-follow-base", "Immutable base"), pre = blob("immutable-at-send");
    await patch(ctx, owner.cookie, id, base, pre); await open(owner, ctx, id, base[1].content);
    const q = `immutable-question-${ctx.label}`, a = "Immutable original answer";
    controller.plans.set(q, [{ frames: [{ content: a }, done], holdOnly: true },
      { frames: [{ content: "Immutable regenerated answer" }], holdOnly: true }]);
    await owner.send(q); await owner.waitAnswerVisible(a); await ready(owner, id);
    const original = (await durable(owner, ctx, id, pre, a)).http.body.messages;
    const revised = original.map((m: any) => m.content === a ? { ...m, content: "Remote same exchange revision", feedback: "up" } : m);
    let writes = recorder.patches.length;
    await patch(ctx, member.cookie, id, revised, blob("remote-same-exchange"));
    await g("same-exchange-adoption", async () => {
      assert.ok(await visible(owner, "Remote same exchange revision"));
      assert.equal(await owner.page.locator('button[aria-label="Regenerate"]').count(), 1);
      return { ids: revised.map((m: any) => m.id) };
    });
    adoptionWrites += recorder.patches.length - writes;
    const barrier = await holdReads(owner, ctx, id, 1); barriers.push(barrier);
    const unseen = [...revised, ...pair("fx-follow-unseen", "Unseen authoritative addition")];
    await patch(ctx, member.cookie, id, unseen, blob("unseen-authoritative"));
    assert.ok(await pollUntil(() => barrier.reads.length === 1, 10000));
    assert.deepEqual(barrier.reads[0].body.memory, blob("unseen-authoritative"));
    await owner.clickRegenerate(); assert.ok((await controller.waitHeld(q, 15000)).found);
    await g("regenerate-immutable-snapshot", async () => {
      const sent = ctx.upstream.requests.filter((r: any) => r.body?.question === q).at(-1).body;
      assert.deepEqual(sent.conversation_memory, pre); return sent;
    });
    await g("regenerate-local-fork", async () => {
      const sent = ctx.upstream.requests.filter((r: any) => r.body?.question === q).at(-1).body;
      assert.deepEqual(sent.conversation_history.slice(-base.length), base.map(m => ({ role: m.role, content: m.content })));
      assert.equal(JSON.stringify(sent).includes("Unseen authoritative addition"), false); return sent;
    });
    barrier.reads[0].release(); await barrier.close();
    controller.release(q, [memory(blob("superseded-original-late"))]);
    await g("superseded-late-memory", async () => {
      await new Promise(resolve => setTimeout(resolve, 600));
      assert.ok(await visible(owner, "Immutable regenerated answer"));
      assert.equal(recorder.patches.some(p => JSON.stringify(p.body).includes("superseded-original-late")), false);
      return { supersededCallbackIgnored: true };
    });
    controller.release(q, [memory(blob("regen-final")), done]);
    await g("regenerate-settles", async () => {
      const got = await durable(owner, ctx, id, blob("regen-final"), "Immutable regenerated answer");
      assert.deepEqual(projection(got.http.body.messages).slice(0, -2), base); return got;
    });
    const own = (await json(ctx, `/api/me/chats/${id}`, owner.cookie)).messages;
    const foreign = [...own, ...pair("fx-follow-foreign", "Foreign last exchange")];
    writes = recorder.patches.length;
    await patch(ctx, member.cookie, id, foreign, blob("foreign-tail"));
    assert.ok(await visible(owner, "Foreign last exchange answer"));
    adoptionWrites += recorder.patches.length - writes;
    await g("foreign-action-gating", async () => {
      assert.equal(await owner.page.locator('button[aria-label="Regenerate"]').count(), 0);
      const bubble = owner.page.locator("div.group").filter({ hasText: "Foreign last exchange question" }).last();
      assert.equal(await bubble.locator('button[aria-label="Edit message"]').count(), 0); return { foreignActions: 0 };
    });
    const edit = `earlier-edit-${ctx.label}`;
    controller.plans.set(edit, [{ frames: [{ content: "Earlier fork answer" }], holdOnly: true }]);
    await owner.editLastMessage(q, edit); assert.ok((await controller.waitHeld(edit, 15000)).found);
    await g("edit-earlier-local-fork", async () => {
      const sent = ctx.upstream.requests.find((r: any) => r.body?.question === edit).body;
      assert.deepEqual(sent.conversation_memory, {});
      assert.deepEqual(sent.conversation_history.slice(-base.length), base.map(m => ({ role: m.role, content: m.content })));
      return sent;
    });
    controller.release(edit, [done, memory(blob("earlier-edit-final"))]);
    await g("edit-earlier-settles", async () => {
      const got = await durable(owner, ctx, id, blob("earlier-edit-final"), "Earlier fork answer");
      assert.deepEqual(projection(got.http.body.messages).slice(0, -2), base); return got;
    });

    const orderedId = await create(ctx, owner.cookie, "Followup overlapping reads");
    const ordered = pair("fx-follow-ordered", "Ordered baseline");
    await patch(ctx, owner.cookie, orderedId, ordered, blob("ordered-base"));
    await open(owner, ctx, orderedId, ordered[1].content);
    const idle = ordered.map(m => m.role === "assistant" ? { ...m, content: "Healthy idle adopted answer" } : m);
    writes = recorder.patches.length;
    await patch(ctx, member.cookie, orderedId, idle, blob("idle-control"));
    await g("idle-adoption-control", async () => { assert.ok(await visible(owner, idle[1].content)); return { observed: idle }; });
    adoptionWrites += recorder.patches.length - writes;
    const reads = await holdReads(owner, ctx, orderedId, 2); barriers.push(reads);
    const old = idle.map(m => m.role === "assistant" ? { ...m, content: "Older held adoption answer" } : m);
    const latest = idle.map(m => m.role === "assistant" ? { ...m, content: "Latest held adoption answer", feedback: "up" } : m);
    writes = recorder.patches.length;
    await patch(ctx, member.cookie, orderedId, old, blob("ordered-old"));
    assert.ok(await pollUntil(() => reads.reads.length === 1, 10000));
    await patch(ctx, member.cookie, orderedId, latest, blob("ordered-latest"));
    assert.ok(await pollUntil(() => reads.reads.length === 2, 10000));
    await g("overlapping-genuine-reads", async () => {
      assert.deepEqual(reads.reads.map((r: any) => r.body.memory), [blob("ordered-old"), blob("ordered-latest")]);
      assert.ok(reads.reads.every((r: any) => r.status === 200 && !r.delivered));
      return { reads: reads.reads.map((r: any) => ({ body: r.body, status: r.status, delivered: r.delivered })) };
    });
    reads.reads[1].release(); assert.ok(await visible(owner, latest[1].content));
    reads.reads[0].release(); assert.ok(await pollUntil(() => reads.reads.every((r: any) => r.delivered), 5000));
    await reads.close();
    await g("latest-read-wins", async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.ok(await visible(owner, latest[1].content)); assert.equal(await visible(owner, old[1].content, 200), false);
      await recorder.screenshot(owner.page, "latest-read-wins"); return { final: latest };
    });
    adoptionWrites += recorder.patches.length - writes;
    await g("latest-read-feedback-recall", () => feedback(owner, ctx, orderedId, latest, blob("ordered-latest"), latest[1].content));
    const lastEdit = `loaded-last-edit-${ctx.label}`;
    controller.plans.set(lastEdit, [{ frames: [{ content: "Loaded edit fallback answer" }], holdOnly: true }]);
    await owner.editLastMessage(ordered[0].content, lastEdit); assert.ok((await controller.waitHeld(lastEdit, 15000)).found);
    await g("loaded-edit-last-fallback", async () => {
      const sent = ctx.upstream.requests.find((r: any) => r.body?.question === lastEdit).body;
      assert.deepEqual(sent.conversation_memory, blob("ordered-latest"));
      assert.equal(sent.conversation_history.some((m: any) => /Ordered|held adoption|idle adopted/.test(m.content)), false);
      return sent;
    });
    controller.release(lastEdit, [done, memory(blob("loaded-edit-final"))]);
    await g("edit-last-settles", async () => {
      const got = await durable(owner, ctx, orderedId, blob("loaded-edit-final"), "Loaded edit fallback answer");
      assert.equal(got.http.body.messages.length, 2); return got;
    });

    const offlineId = await create(ctx, owner.cookie, "Followup idle offline");
    const offlineBase = pair("fx-follow-offline", "Offline baseline");
    await patch(ctx, owner.cookie, offlineId, offlineBase, blob("offline-base"));
    await open(owner, ctx, offlineId, offlineBase[1].content);
    const before = await disconnect(owner, offlineId, transport);
    const offlineFinal = offlineBase.map(m => m.role === "assistant" ? { ...m, content: "Missed idle changed answer", feedback: "up" } : m);
    writes = recorder.patches.length;
    await patch(ctx, member.cookie, offlineId, offlineFinal, blob("missed-idle-final"));
    assert.equal(await visible(owner, offlineFinal[1].content, 200), false, "write must really be missed while offline");
    await g("idle-real-disconnect-reconnect", async () => ({ before, after: await reconnect(owner, offlineId, before, transport) }));
    await g("idle-missed-write-adopted", async () => {
      assert.ok(await visible(owner, offlineFinal[1].content), "reopened idle feed must refresh missed content");
      return { final: offlineFinal };
    });
    adoptionWrites += recorder.patches.length - writes;
    // Use the always-present base bubble on the broken baseline too: feedback
    // consumes adopted refs, and cannot repair stale recall by GET/rebase.
    await g("idle-reconnect-feedback-recall", () => feedback(owner, ctx, offlineId, offlineFinal, blob("missed-idle-final"),
      "answer"));

    const liveId = await create(ctx, owner.cookie, "Followup live offline");
    const liveBase = pair("fx-follow-live", "Live baseline");
    await patch(ctx, owner.cookie, liveId, liveBase, blob("live-base"));
    await open(owner, ctx, liveId, liveBase[1].content); await open(member, ctx, liveId, liveBase[1].content);
    const liveQ = `live-offline-question-${ctx.label}`, liveA = "Remote live answer across disconnect";
    controller.plans.set(liveQ, [{ frames: [{ content: liveA }], holdOnly: true }]);
    await member.send(liveQ); assert.ok((await controller.waitHeld(liveQ, 15000)).found);
    await g("live-relay-control", async () => { assert.ok(await visible(owner, liveA)); return { relayBeforeDrop: liveA }; });
    const liveBefore = await disconnect(owner, liveId, transport);
    controller.release(liveQ, [memory(blob("live-offline-final")), done]);
    const liveFinal = (await durable(member, ctx, liveId, blob("live-offline-final"), liveA)).http.body.messages;
    writes = recorder.patches.length;
    await g("live-real-disconnect-reconnect", async () => ({ before: liveBefore, after: await reconnect(owner, liveId, liveBefore, transport) }));
    await g("live-missed-completion-adopted", async () => {
      assert.ok(await pollUntil(() => owner.page.locator('button[aria-label="Bad answer"]').count().then((n: number) => n === 2), 8000),
        "missed turn_done must replace ephemeral streaming answer with settled answer");
      assert.equal(await owner.page.locator("main").getByText(liveQ, { exact: true }).count(), 1);
      await recorder.screenshot(owner.page, "live-reconnect-settled"); return { final: liveFinal };
    });
    adoptionWrites += recorder.patches.length - writes;
    await g("live-reconnect-feedback-recall", () => feedback(owner, ctx, liveId, liveFinal, blob("live-offline-final"), liveBase[1].content));
    await g("adoption-read-only", async () => { assert.equal(adoptionWrites, 0); return { adoptionWrites }; });
    await pollUntil(() => acknowledgments.length >= recorder.patches.length, 10000);
    await g("patch-acknowledgments", async () => {
      assert.ok(acknowledgments.length > 0); assert.equal(acknowledgments.length, recorder.patches.length);
      assert.ok(acknowledgments.every(a => a.status === 200)); return { patches: recorder.patches, acknowledgments };
    });
  } finally {
    for (const b of barriers) await b.close();
    ctx.check("browser.no-page-errors", sessions.every(s => s.pageErrors.length === 0), sessions.map(s => s.pageErrors));
    ctx.check("browser.no-blocked-requests", sessions.every(s => s.blocked.length === 0), sessions.map(s => s.blocked));
    ctx.check("browser.all-responses-released", controller.unmatched.length === 0 && controller.held.length === 0 &&
      barriers.every(b => b.reads.every((r: any) => r.delivered)), { unmatched: controller.unmatched, held: controller.held });
    writeFileSync(join(recorder.dir, "followup-observations.json"), JSON.stringify({ observations: recorder.observations,
      patches: recorder.patches, acknowledgments, reads: barriers.map(b => b.reads), transport: transport.observations,
      feeds: await Promise.all(sessions.map(s => s.page?.evaluate(() => (window as any).__followupFeeds).catch(() => null))) }, null, 2));
    await member.close(); await owner.close();
    await transport.close();
  }
}
