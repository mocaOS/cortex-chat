// project-move-v1: real native HTML5 drag/drop, native consent, genuine held
// PATCH acknowledgment, and direct consumers. No candidate repairs here.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController, pollUntil, setAppLocale } from "./chat-browser-checks";
import { projectFixture as f } from "./chat-project-followup-checks";
export const MOVE_HTTP_GATES = ["http.personal-control", "http.move-in-state", "http.member-not-author", "http.invalid-target", "http.move-out-state", "http.author-control"];
export const MOVE_BROWSER_GATES = ["browser.logins-dark-en-de", "browser.cancel-no-effect", "browser.move-in-state-sidebar", "browser.late-memory-after-move",
  "browser.moved-regenerate-at-send", "browser.moved-regenerate-settles", "browser.move-out-state-sidebar", "browser.out-feedback-recall", "browser.private-move-no-consent", "browser.private-edit-at-send", "browser.private-edit-settles",
  "browser.revoked-target-rejected", "browser.revoked-target-consumer-context", "browser.revoked-target-consumer-settles",
  "browser.held-ack-navigation-control", "browser.held-ack-consumer-context", "browser.held-ack-consumer-settles",
  "browser.acknowledgments", "browser.no-page-errors", "browser.no-blocked-requests", "browser.responses-drained"];
const contextText = "Synthetic moved project instruction marker.";
export function assertMoveOnly(before: any, after: any, projectId: string | null) {
  assert.deepEqual(after.session, { ...before.session, project_id: projectId });
  assert.deepEqual(after.messages, before.messages);
}
function state(ctx: any, id: string) {
  const require = createRequire(join(ctx.appDir, "package.json")), Database = require("better-sqlite3");
  const db = new Database(join(ctx.dataDir, "cortex-chat.db"), { readonly: true, fileMustExist: true });
  try { return { session: db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id),
    messages: db.prepare("SELECT * FROM chat_messages WHERE chat_session_id = ? ORDER BY created_at,rowid").all(id) }; } finally { db.close(); }
}
async function target(ctx: any, cookie: string, name: string, shareTo: string | null) {
  const p = (await f.json(ctx, "/api/me/projects", cookie, "POST", { name, instructions: contextText })).project;
  if (shareTo) await f.json(ctx, `/api/me/projects/${p.id}/shares`, cookie, "PUT", { shares: [{ userId: shareTo }] });
  return p;
}
async function personal(ctx: any, cookie: string, tag: string) {
  const id = (await f.json(ctx, "/api/me/chats", cookie, "POST", { title: tag, assistantId: ctx.ids.soul })).id;
  const base = f.pair(`fx-move-${tag}-${ctx.label}`, tag).map(m => m.role === "assistant" ? { ...m,
    feedback: "up", thinking: ["Preserved synthetic step"], sources: [{ document_id: "fx-move-source", chunk_id: "fx-move-chunk",
      content: "Preserved synthetic source bytes.", score: 0.42, sid: "fx-move-stable-sid", metadata: { filename: "fixture-move.md" } }] } : m), pre = f.blob(`${tag}-pre`);
  await f.patch(ctx, cookie, id, base, pre); return { id, base, pre, title: tag };
}
async function permission(ctx: any, cookie: string, id: string, allowed: boolean) {
  const res = await ctx.request(`/api/me/chats/${id}`, { cookie }); const body = await res.json(); assert.equal(res.status, allowed ? 200 : 404);
  const abort = new AbortController(); const feed = await fetch(`${ctx.baseUrl}/api/me/chats/${id}/events`, { headers: { Cookie: cookie },
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
  try { assert.equal(feed.status, allowed ? 200 : 404); if (allowed) assert.ok(new TextDecoder().decode((await feed.body!.getReader().read()).value).includes(": connected")); else await feed.json(); }
  finally { abort.abort(); } return { body, freshFeedStatus: feed.status };
}
export async function runMoveHttp(ctx: any) {
  const owner = await f.login(ctx, "owner"), member = await f.login(ctx, "member"), p = await target(ctx, owner, "HTTP move shared", ctx.users.member.id);
  const chat = await personal(ctx, owner, "HTTP move preserved"), before = state(ctx, chat.id);
  await f.gate(ctx, "http.personal-control", async () => { assert.ok((await f.json(ctx, "/api/me/chats", owner)).sessions.some((s: any) => s.id === chat.id)); return permission(ctx, member, chat.id, false); });
  await f.gate(ctx, "http.move-in-state", async () => { await f.json(ctx, `/api/me/chats/${chat.id}`, owner, "PATCH", { projectId: p.id });
    assertMoveOnly(before, state(ctx, chat.id), p.id); assert.equal((await f.json(ctx, "/api/me/chats", owner)).sessions.some((s: any) => s.id === chat.id), false); return permission(ctx, member, chat.id, true); });
  await f.gate(ctx, "http.member-not-author", async () => { const saved = state(ctx, chat.id), denied = await ctx.request(`/api/me/chats/${chat.id}`, { cookie: member, method: "PATCH", body: { projectId: null } });
    assert.equal(denied.status, 404); await denied.json(); assert.deepEqual(state(ctx, chat.id), saved); return { status: denied.status }; });
  await f.gate(ctx, "http.invalid-target", async () => { const foreign = await target(ctx, member, "HTTP inaccessible move target", null), saved = state(ctx, chat.id);
    const res = await ctx.request(`/api/me/chats/${chat.id}`, { cookie: owner, method: "PATCH", body: { projectId: foreign.id } });
    assert.equal(res.status, 400); await res.json(); assert.deepEqual(state(ctx, chat.id), saved); return { status: res.status }; });
  await f.gate(ctx, "http.move-out-state", async () => { await f.json(ctx, `/api/me/chats/${chat.id}`, owner, "PATCH", { projectId: null });
    assertMoveOnly(before, state(ctx, chat.id), null); return permission(ctx, member, chat.id, false); });
  await f.gate(ctx, "http.author-control", async () => { const got = await f.json(ctx, `/api/me/chats/${chat.id}`, owner);
    assert.deepEqual(got.memory, chat.pre); assert.equal(got.assistantId, ctx.ids.soul); assert.deepEqual(f.projection(got.messages), f.projection(chat.base)); return got; });
}

export async function runMoveBrowser(ctx: any) {
  const rec = new Recorder(join(ctx.workDir, "logs")), tool = browserPrerequisites(); assert.deepEqual(tool.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(tool.pwPath, "index.js"));
  for (const file of ["src/app/page.tsx", "src/components/Sidebar.tsx", "src/lib/chatHistory.ts"]) copyFileSync(join(ctx.appDir, file), join(rec.dir, file.split("/").pop()!));
  writeFileSync(join(rec.dir, "tooling.json"), JSON.stringify({ ...tool, version: JSON.parse(readFileSync(join(tool.pwPath, "package.json"), "utf8")).version, tmpdir: process.env.TMPDIR, install: false }, null, 2));
  const owner = new BrowserSession(pw, tool.chromiumPath, ctx.baseUrl, rec), member = new BrowserSession(pw, tool.chromiumPath, ctx.baseUrl, rec);
  const sessions = [owner, member], c = makeUpstreamController(ctx), acks: any[] = [], asks: any[] = [], reads: any[] = [], dialogs: any[] = [], barriers: any[] = [];
  const g = (name: string, fn: () => Promise<any>) => f.gate(ctx, `browser.${name}`, fn);
  try {
    for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) {
      await s.start(s === member ? owner.browser : undefined);
      await s.context.addInitScript(() => {
        const Original = window.EventSource; (window as any).__followupFeeds = [];
        window.EventSource = class extends Original { row: any;
          constructor(url: string | URL, init?: EventSourceInit) { super(url, init); this.row = { url: String(url), ready: 0, closed: false, events: [] as any[] }; (window as any).__followupFeeds.push(this.row);
            this.addEventListener("open", () => this.row.ready = this.readyState); this.addEventListener("error", () => this.row.ready = this.readyState);
            this.addEventListener("message", e => this.row.events.push(JSON.parse(e.data))); }
          close() { this.row.closed = true; this.row.ready = 2; super.close(); }
        };
      });
      s.context.on("request", (r: any) => { const path = new URL(r.url()).pathname;
        if (path === "/api/ask/stream") asks.push({ name, id: r.headers()["x-request-id"], body: r.postDataJSON(), at: Date.now() });
        if (r.method() === "GET" && /^\/api\/me\/chats\/[^/]+$/.test(path)) reads.push({ name, path, at: Date.now() }); });
      s.context.on("response", (r: any) => { if (r.request().method() === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(new URL(r.url()).pathname))
        acks.push({ name, path: new URL(r.url()).pathname, body: r.request().postDataJSON(), status: r.status(), at: Date.now() }); });
      await s.login(ctx, ctx.users[name].email, ctx.users[name].password);
    }
    const readyUser = async (s: BrowserSession) => assert.ok(await pollUntil(() => s.page.evaluate(() =>
      (window as any).__followupFeeds.some((r: any) => r.url === "/api/me/events" && !r.closed && r.ready === 1)), 15000));
    await g("logins-dark-en-de", async () => { for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) assert.equal((await f.json(ctx, "/api/auth/me", s.cookie)).id, ctx.users[name].id);
      assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de"); await owner.page.reload(); await owner.waitForComposer(); assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research..."); await rec.screenshot(owner.page, "move-dark-de");
      setAppLocale(ctx.dataDir, "en"); await owner.page.reload(); await owner.waitForComposer(); await readyUser(owner); await readyUser(member); return { forms: 2, locales: ["en", "de"] }; });
    const p = await target(ctx, owner.cookie, "Move shared target", ctx.users.member.id), privateP = await target(ctx, owner.cookie, "Move private target", null);
    const original = await personal(ctx, owner.cookie, "Move local origin");
    const q = `move-origin-${ctx.label}`, answer = "Move original completed answer", late = f.blob("move-origin-late"), redoAnswer = "Move regenerated answer";
    await owner.page.goto(`${ctx.baseUrl}/?chat=${original.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, original.base[1].content));
    c.plans.set(q, [{ frames: [{ content: answer }, f.done], holdMemoryBlob: late }, { frames: [{ content: redoAnswer }], holdOnly: true }]);
    await owner.send(q); await owner.waitAnswerVisible(answer); const origin = (await f.durable(owner, ctx, original.id, original.pre, answer)).http.body.messages;
    await member.openSidebar(); await readyUser(member);
    const sidebar = async () => { if (!await owner.drawer().isVisible()) await owner.openSidebar(); };
    const closeSidebar = async () => { if (await owner.drawer().isVisible()) await owner.drawer().locator("button").first().click(); };
    const committedView = () => owner.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const row = (s: BrowserSession, text: string) => s.drawer().getByText(text, { exact: true }).locator("..");
    const flat = () => owner.drawer().locator('div.min-h-\\[80px\\]');
    const drag = async (title: string, destination: string | null, decision: "accept" | "dismiss" | "none", beforeDecision?: () => Promise<void>) => {
      await sidebar(); const source = row(owner, title), dest = destination ? row(owner, destination) : flat();
      assert.equal(await source.getAttribute("draggable"), "true"); await source.scrollIntoViewIfNeeded(); await dest.scrollIntoViewIfNeeded();
      let handled: Promise<void> | null = null;
      if (decision !== "none") handled = new Promise<void>((resolve, reject) => owner.page.once("dialog", async (d: any) => { try {
        const observed = { type: d.type(), message: d.message(), decision, at: Date.now() }; dialogs.push(observed);
        assert.equal(d.type(), "confirm"); assert.equal(d.message(), "This project is shared — all members will be able to read this chat's entire history and continue the conversation. Move it?");
        if (beforeDecision) await beforeDecision(); await d[decision](); resolve();
      } catch (e) { await d.dismiss().catch(() => {}); reject(e); } }));
      await source.dragTo(dest); if (handled) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([handled, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("native move consent was not observed within15s")), 15000); })]); }
        finally { if (timer) clearTimeout(timer); }
      }
    };
    await g("cancel-no-effect", async () => { const before = state(ctx, original.id), patches = rec.patches.length;
      await drag(original.title, p.name, "dismiss"); assert.deepEqual(state(ctx, original.id), before); assert.equal(rec.patches.length, patches);
      await rec.screenshot(owner.page, "move-cancelled"); return permission(ctx, member.cookie, original.id, false); });
    await g("move-in-state-sidebar", async () => { const before = state(ctx, original.id); await drag(original.title, p.name, "accept");
      assert.ok(await pollUntil(() => state(ctx, original.id).session.project_id === p.id, 10000)); assertMoveOnly(before, state(ctx, original.id), p.id);
      assert.ok(await pollUntil(() => member.drawer().getByText(p.name, { exact: true }).count().then((n: number) => n === 1), 8000));
      await row(member, p.name).click(); assert.ok(await pollUntil(() => member.drawer().getByText(original.title, { exact: true }).count().then((n: number) => n === 1), 8000));
      const foreign = row(member, original.title); assert.notEqual(await foreign.getAttribute("draggable"), "true"); await rec.screenshot(member.page, "move-member-sidebar");
      return { before, after: state(ctx, original.id), admitted: await permission(ctx, member.cookie, original.id, true) }; });
    await closeSidebar(); await f.ready(owner, original.id); c.release(q, [{ memory_update: late }]);
    await g("late-memory-after-move", async () => { const got = await f.durable(owner, ctx, original.id, late, answer); assert.equal(got.http.body.projectId, p.id);
      assert.deepEqual(f.projection(got.http.body.messages), f.projection(origin)); return got; });
    const ownReads = () => reads.filter(r => r.name === "owner").length;
    const waitActive = async (question: string, count: number) => assert.ok(await pollUntil(() => {
      const upstream = ctx.upstream.requests.filter((r: any) => r.body?.question === question), browser = asks.filter(a => a.body.question === question);
      return upstream.length === count && browser.length === count && upstream.at(-1).id === browser.at(-1).id &&
        c.held.some(h => h.question === question && h.id === upstream.at(-1).id) && ctx.upstream.pending.has(upstream.at(-1).id);
    }, 15000), "new browser request must reach its own genuinely held upstream response");
    const readStart = ownReads(); await owner.clickRegenerate(); await waitActive(q, 2);
    await g("moved-regenerate-at-send", async () => { const sent = ctx.upstream.requests.filter((r: any) => r.body?.question === q).at(-1), raw = asks.filter(a => a.body.question === q).at(-1).body;
      assert.deepEqual(sent.body.conversation_memory, original.pre); assert.deepEqual(sent.body.conversation_history.slice(-original.base.length), original.base.map(m => ({ role: m.role, content: m.content })));
      assert.equal(raw.project_id, p.id); assert.equal(raw.assistant_id, ctx.ids.soul); assert.equal(ownReads(), readStart); return { raw, sent }; });
    c.release(q, [{ memory_update: f.blob("move-redo-final") }, f.done]);
    let selected: any[] = [];
    await g("moved-regenerate-settles", async () => { const got = await f.durable(owner, ctx, original.id, f.blob("move-redo-final"), redoAnswer); selected = got.http.body.messages;
      assert.deepEqual(f.projection(selected).slice(0, 2), f.projection(original.base)); assert.equal(got.http.body.assistantId, ctx.ids.soul); return got; });
    await g("move-out-state-sidebar", async () => { await f.ready(owner, original.id); const before = state(ctx, original.id), dialogCount = dialogs.length;
      await sidebar(); await row(owner, p.name).click(); await drag(original.title, null, "none");
      assert.ok(await pollUntil(() => state(ctx, original.id).session.project_id === null, 10000)); assertMoveOnly(before, state(ctx, original.id), null); assert.equal(dialogs.length, dialogCount);
      assert.ok(await pollUntil(() => member.drawer().getByText(original.title, { exact: true }).count().then((n: number) => n === 0), 8000)); return permission(ctx, member.cookie, original.id, false); });
    await closeSidebar(); await committedView();
    await g("out-feedback-recall", async () => { const start = ownReads(), before = rec.patches.length;
      const got = await f.feedback(owner, ctx, original.id, selected, f.blob("move-redo-final"), redoAnswer);
      assert.ok(rec.patches.length > before); assert.equal(ownReads(), start); assert.equal(got.http.body.projectId, null); return got; });
    await g("private-move-no-consent", async () => { const before = state(ctx, original.id), count = dialogs.length; await drag(original.title, privateP.name, "none");
      assert.ok(await pollUntil(() => state(ctx, original.id).session.project_id === privateP.id, 10000)); assertMoveOnly(before, state(ctx, original.id), privateP.id); assert.equal(dialogs.length, count); return { moved: true }; });
    await closeSidebar(); await committedView();
    const edited = `move-private-edited-${ctx.label}`, editedAnswer = "Move privately edited answer", editReads = ownReads();
    c.plans.set(edited, [{ frames: [{ content: editedAnswer }], holdOnly: true }]); await owner.editLastMessage(q, edited); await waitActive(edited, 1);
    await g("private-edit-at-send", async () => { const raw = asks.find(a => a.body.question === edited).body, sent = ctx.upstream.requests.find((r: any) => r.body?.question === edited).body;
      assert.equal(raw.project_id, privateP.id); assert.equal(raw.assistant_id, ctx.ids.soul); assert.deepEqual(sent.conversation_memory, original.pre);
      assert.deepEqual(sent.conversation_history.slice(-original.base.length), original.base.map(m => ({ role: m.role, content: m.content }))); assert.equal(ownReads(), editReads); return { raw, sent }; });
    c.release(edited, [{ memory_update: f.blob("private-edit-final") }, f.done]);
    await g("private-edit-settles", async () => { const got = await f.durable(owner, ctx, original.id, f.blob("private-edit-final"), editedAnswer);
      assert.equal(got.http.body.projectId, privateP.id); assert.deepEqual(f.projection(got.http.body.messages).slice(0, 2), f.projection(original.base)); return got; });

    // Membership changes while the actual consent dialog blocks the page. Only
    // the owner's separate loopback request changes the target grant.
    const revoked = await target(ctx, member.cookie, "Move revoked target", ctx.users.owner.id), stale = await personal(ctx, owner.cookie, "Move rejected origin");
    await owner.page.goto(`${ctx.baseUrl}/?chat=${stale.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, stale.base[1].content));
    const staleBefore = state(ctx, stale.id);
    await drag(stale.title, revoked.name, "accept", async () => { await f.json(ctx, `/api/me/projects/${revoked.id}/shares`, member.cookie, "PUT", { shares: [] }); });
    await g("revoked-target-rejected", async () => { assert.ok(await pollUntil(() => acks.some(a => a.path === `/api/me/chats/${stale.id}` && a.body?.projectId === revoked.id && a.status === 400), 10000));
      assert.deepEqual(state(ctx, stale.id), staleBefore); return { preserved: staleBefore, acknowledgment: acks.find(a => a.path === `/api/me/chats/${stale.id}` && a.status === 400) }; });
    await closeSidebar(); await committedView();
    const rejectedRedo = "Move rejected target redo", rejectedReadStart = ownReads();
    c.plans.set(stale.base[0].content, [{ frames: [{ content: rejectedRedo }], holdOnly: true }]);
    await owner.clickRegenerate(); await waitActive(stale.base[0].content, 1);
    await g("revoked-target-consumer-context", async () => { const raw = asks.filter(a => a.body.question === stale.base[0].content).at(-1).body;
      assert.equal(raw.session_id, stale.id); assert.equal(raw.project_id, null, "rejected move must not select a project context"); assert.equal(raw.assistant_id, ctx.ids.soul);
      assert.deepEqual(raw.conversation_memory, stale.pre); assert.equal(ownReads(), rejectedReadStart); return raw; });
    c.release(stale.base[0].content, [{ memory_update: f.blob("rejected-redo-final") }, f.done]);
    await g("revoked-target-consumer-settles", async () => { const got = await f.durable(owner, ctx, stale.id, f.blob("rejected-redo-final"), rejectedRedo); assert.equal(got.http.body.projectId, null); return got; });

    // Hold the genuine successful move response; navigation changes the view
    // before this asynchronous organizational acknowledgment reaches its caller.
    const moving = await personal(ctx, owner.cookie, "Move pending origin"), other = await personal(ctx, owner.cookie, "Move navigation destination");
    await owner.page.goto(`${ctx.baseUrl}/?chat=${moving.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, moving.base[1].content));
    const held: any = { body: null, status: null, delivered: false, release: null }, matcher = `${ctx.baseUrl}/api/me/chats/${moving.id}`;
    const handler = async (route: any) => {
      const request = route.request(); if (request.method() !== "PATCH" || request.postDataJSON()?.projectId !== p.id || held.release !== null) return route.fallback();
      // This exact-route interceptor fulfills before the generic passive route
      // recorder runs. Capture the same actual request here, once, before fetch.
      const patch = { t: new Date().toISOString(), chatId: moving.id, body: request.postDataJSON() };
      rec.patches.push(patch); rec.appendJsonl("browser-patch-bodies.jsonl", patch);
      let release!: () => void; const barrier = new Promise<void>(r => release = r); held.release = release;
      const res = await route.fetch(); held.body = await res.json(); held.status = res.status(); await barrier; await route.fulfill({ response: res }); held.delivered = true;
    };
    await owner.context.route(matcher, handler); barriers.push({ held, close: async () => { held.release?.(); await owner.context.unroute(matcher, handler); } });
    const movingBefore = state(ctx, moving.id); await drag(moving.title, p.name, "accept");
    assert.ok(await pollUntil(() => held.status === 200 && held.body !== null, 10000));
    await row(owner, other.title).click(); assert.ok(await f.visible(owner, other.base[1].content));
    await g("held-ack-navigation-control", async () => { assert.equal(new URL(owner.page.url()).searchParams.get("chat"), other.id); assertMoveOnly(movingBefore, state(ctx, moving.id), p.id);
      assert.equal(held.delivered, false); const observation = { heldResponse: { body: held.body, status: held.status }, moving: state(ctx, moving.id), current: state(ctx, other.id) };
      held.release(); assert.ok(await pollUntil(() => held.delivered, 5000)); await committedView(); await rec.screenshot(owner.page, "move-after-held-navigation"); return observation; });
    const otherRedo = "Move current destination redo", otherReadStart = ownReads();
    c.plans.set(other.base[0].content, [{ frames: [{ content: otherRedo }], holdOnly: true }]);
    await owner.clickRegenerate(); await waitActive(other.base[0].content, 1);
    await g("held-ack-consumer-context", async () => { const raw = asks.filter(a => a.body.question === other.base[0].content).at(-1).body;
      assert.equal(raw.session_id, other.id); assert.equal(raw.project_id, null, "origin move acknowledgment cannot rebind another view's project"); assert.equal(raw.assistant_id, ctx.ids.soul);
      assert.deepEqual(raw.conversation_memory, other.pre); assert.equal(ownReads(), otherReadStart); return raw; });
    c.release(other.base[0].content, [{ memory_update: f.blob("other-redo-final") }, f.done]);
    await g("held-ack-consumer-settles", async () => { const got = await f.durable(owner, ctx, other.id, f.blob("other-redo-final"), otherRedo); assert.equal(got.http.body.projectId, null); return got; });
    await pollUntil(() => acks.length === rec.patches.length, 10000);
    await g("acknowledgments", async () => { assert.equal(acks.length, rec.patches.length); const failed = acks.filter(a => a.status !== 200);
      assert.equal(failed.length, 1); assert.equal(failed[0].status, 400); assert.equal(failed[0].path, `/api/me/chats/${stale.id}`); return { patches: rec.patches, acknowledgments: acks }; });
  } finally {
    for (const b of barriers) await b.close();
    ctx.check("browser.no-page-errors", sessions.every(s => !s.pageErrors.length), sessions.map(s => s.pageErrors));
    ctx.check("browser.no-blocked-requests", sessions.every(s => !s.blocked.length), sessions.map(s => s.blocked));
    ctx.check("browser.responses-drained", !c.held.length && !c.unmatched.length && !ctx.upstream.pending.size && barriers.every(b => b.held.delivered), { held: c.held, unmatched: c.unmatched });
    writeFileSync(join(rec.dir, "move-observations.json"), JSON.stringify({ observations: rec.observations, dialogs, patches: rec.patches, acknowledgments: acks, asks, reads,
      heldAcks: barriers.map(b => ({ body: b.held.body, status: b.held.status, delivered: b.held.delivered })) }, null, 2));
    await member.close(); await owner.close();
  }
}
