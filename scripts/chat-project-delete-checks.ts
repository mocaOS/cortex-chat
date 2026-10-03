// project-delete-v1: real native confirmation, exact durable detach and genuine
// delayed DELETE acknowledgment. Observational reads never repair the page.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController, pollUntil, setAppLocale } from "./chat-browser-checks";
import { projectFixture as f } from "./chat-project-followup-checks";

export const DELETE_HTTP_GATES = ["http.shared-control", "http.owner-only", "http.exact-detach", "http.author-flat-lists", "http.fresh-admission", "http.late-author-save", "http.deleted-context-omitted"];
export const DELETE_BROWSER_GATES = ["browser.logins-dark-en-de", "browser.owner-only", "browser.cancel-no-effect", "browser.exact-detach", "browser.author-flat-sidebars", "browser.fresh-admission", "browser.late-origin-compaction", "browser.direct-feedback", "browser.detached-regenerate-snapshot", "browser.detached-regenerate-settles", "browser.detached-edit-snapshot", "browser.detached-edit-settles", "browser.held-ack-navigation-control", "browser.held-ack-consumer-context", "browser.held-ack-consumer-settles", "browser.acknowledgments", "browser.no-page-errors", "browser.no-blocked-requests", "browser.responses-drained"];
const instruction = "Synthetic delete-project context marker.";
export function assertDeleteOnly(before: any, after: any, projectId: string) {
  assert.ok(before.projects.some((p: any) => p.id === projectId), "positive control: target exists");
  assert.ok(before.sessions.some((s: any) => s.project_id === projectId), "positive control: chats to detach");
  assert.deepEqual(after.projects, before.projects.filter((p: any) => p.id !== projectId));
  assert.deepEqual(after.shares, before.shares.filter((s: any) => s.project_id !== projectId));
  assert.deepEqual(after.sessions, before.sessions.map((s: any) => s.project_id === projectId ? { ...s, project_id: null } : s));
  assert.deepEqual(after.messages, before.messages);
}
function state(ctx: any) {
  const require = createRequire(join(ctx.appDir, "package.json")), Database = require("better-sqlite3");
  const db = new Database(join(ctx.dataDir, "cortex-chat.db"), { readonly: true, fileMustExist: true });
  try { return { projects: db.prepare("SELECT * FROM projects ORDER BY id").all(), shares: db.prepare("SELECT * FROM project_shares ORDER BY id").all(),
    sessions: db.prepare("SELECT * FROM chat_sessions ORDER BY id").all(), messages: db.prepare("SELECT * FROM chat_messages ORDER BY id").all() }; } finally { db.close(); }
}
async function project(ctx: any, cookie: string, name: string, shared = true) {
  const p = (await f.json(ctx, "/api/me/projects", cookie, "POST", { name, instructions: instruction, collectionId: "fx-project-creation-default" })).project;
  if (shared) await f.json(ctx, `/api/me/projects/${p.id}/shares`, cookie, "PUT", { shares: [{ userId: ctx.users.member.id }, { groupId: ctx.ids.group }] });
  return p;
}
async function chat(ctx: any, cookie: string, title: string, projectId: string) {
  const id = (await f.json(ctx, "/api/me/chats", cookie, "POST", { title, projectId, assistantId: ctx.ids.soul })).id;
  const base = f.pair(`fx-delete-${title}-${ctx.label}`, title).map(m => m.role === "assistant" ? { ...m, feedback: "up", thinking: ["Preserved synthetic step"],
    sources: [{ document_id: "fx-delete-source", chunk_id: "fx-delete-chunk", content: "Preserved source bytes", score: 0.42, sid: "fx-delete-stable-sid", metadata: { filename: "fixture-delete.md" } }] } : m), pre = f.blob(`${title}-pre`);
  await f.patch(ctx, cookie, id, base, pre); await f.json(ctx, `/api/me/chats/${id}`, cookie, "PATCH", { pinned: true });
  return { id, title, base, pre };
}
async function setup(ctx: any, owner: string, member: string, tag: string) {
  const p = await project(ctx, owner, `${tag} removed project`), other = await project(ctx, owner, `${tag} retained project`, false);
  const a = await chat(ctx, owner, `${tag} owner chat`, p.id), b = await chat(ctx, member, `${tag} member chat`, p.id), untouched = await chat(ctx, owner, `${tag} untouched chat`, other.id);
  // Mixed per-message authorship must survive deletion along with chat authorship.
  a.base = [...a.base, ...f.pair(`fx-delete-peer-${ctx.label}`, "Shared peer prefix")];
  await f.patch(ctx, member, a.id, a.base, a.pre);
  return { p, other, a, b, untouched };
}
async function admission(ctx: any, cookie: string, id: string, allowed: boolean) {
  const res = await ctx.request(`/api/me/chats/${id}`, { cookie }), body = await res.json(); assert.equal(res.status, allowed ? 200 : 404);
  const abort = new AbortController(), feed = await fetch(`${ctx.baseUrl}/api/me/chats/${id}/events`, { headers: { Cookie: cookie }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
  try { assert.equal(feed.status, allowed ? 200 : 404); if (allowed) assert.ok(new TextDecoder().decode((await feed.body!.getReader().read()).value).includes(": connected")); else await feed.json(); }
  finally { abort.abort(); }
  if (!allowed) { const saved = state(ctx), denied = await ctx.request(`/api/me/chats/${id}`, { cookie, method: "PATCH", body: { messages: [], memory: { forbidden: true } } });
    assert.equal(denied.status, 404); await denied.json(); assert.deepEqual(state(ctx), saved); }
  return { body, status: res.status, freshFeedStatus: feed.status };
}
async function flatLists(ctx: any, owner: string, member: string, a: any, b: any) {
  const lists = [];
  for (const [cookie, own, foreign] of [[owner, a, b], [member, b, a]]) { const rows = (await f.json(ctx, "/api/me/chats", cookie)).sessions;
    assert.equal(rows.filter((s: any) => s.id === own.id).length, 1); assert.equal(rows.some((s: any) => s.id === foreign.id), false); lists.push(rows); }
  return lists;
}
export async function runDeleteHttp(ctx: any) {
  const owner = await f.login(ctx, "owner"), member = await f.login(ctx, "member"), { p, a, b } = await setup(ctx, owner, member, "HTTP delete");
  await f.gate(ctx, "http.shared-control", async () => { const got = await admission(ctx, member, a.id, true); assert.deepEqual(got.body.memory, a.pre); return got; });
  await f.gate(ctx, "http.owner-only", async () => { const before = state(ctx), res = await ctx.request(`/api/me/projects/${p.id}`, { cookie: member, method: "DELETE" });
    assert.equal(res.status, 404); await res.json(); assert.deepEqual(state(ctx), before); return { status: res.status }; });
  await f.gate(ctx, "http.exact-detach", async () => { const before = state(ctx); await f.json(ctx, `/api/me/projects/${p.id}`, owner, "DELETE"); const after = state(ctx); assertDeleteOnly(before, after, p.id); return { before, after }; });
  await f.gate(ctx, "http.author-flat-lists", () => flatLists(ctx, owner, member, a, b));
  await f.gate(ctx, "http.fresh-admission", async () => ({ owner: await admission(ctx, owner, a.id, true), member: await admission(ctx, member, b.id, true),
    formerMember: await admission(ctx, member, a.id, false), formerOwner: await admission(ctx, owner, b.id, false) }));
  await f.gate(ctx, "http.late-author-save", async () => { const late = f.blob("http-delete-late"), got = await f.patch(ctx, owner, a.id, a.base, late);
    assert.equal(got.projectId, null); assert.equal(got.assistantId, ctx.ids.soul); assert.deepEqual(f.projection(got.messages), f.projection(a.base)); return got; });
  await f.gate(ctx, "http.deleted-context-omitted", async () => { const res = await ctx.request("/api/ask/stream", { cookie: member, method: "POST", body: { question: "Deleted optional project context", project_id: p.id, conversation_memory: b.pre } });
    assert.equal(res.status, 200); await res.text(); const sent = ctx.upstream.requests.filter((r: any) => r.body?.question === "Deleted optional project context").at(-1);
    assert.ok(sent); assert.equal("project_id" in sent.body, false); assert.equal(JSON.stringify(sent.body).includes(instruction), false); assert.deepEqual(sent.body.conversation_memory, b.pre); return sent; });
}

export async function runDeleteBrowser(ctx: any) {
  const rec = new Recorder(join(ctx.workDir, "logs")), tool = browserPrerequisites(); assert.deepEqual(tool.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(tool.pwPath, "index.js"));
  for (const [file, name] of [["src/app/page.tsx", "page.tsx"], ["src/components/Sidebar.tsx", "Sidebar.tsx"], ["src/app/api/me/projects/[id]/route.ts", "delete-route.ts"]]) copyFileSync(join(ctx.appDir, file), join(rec.dir, name));
  writeFileSync(join(rec.dir, "tooling.json"), JSON.stringify({ ...tool, version: JSON.parse(readFileSync(join(tool.pwPath, "package.json"), "utf8")).version, tmpdir: process.env.TMPDIR, install: false }, null, 2));
  const owner = new BrowserSession(pw, tool.chromiumPath, ctx.baseUrl, rec), member = new BrowserSession(pw, tool.chromiumPath, ctx.baseUrl, rec);
  const sessions = [owner, member], c = makeUpstreamController(ctx), writes: any[] = [], acks: any[] = [], asks: any[] = [], reads: any[] = [], dialogs: any[] = [], barriers: any[] = [];
  const g = (name: string, fn: () => Promise<any>) => f.gate(ctx, `browser.${name}`, fn);
  try {
    for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) {
      await s.start(s === member ? owner.browser : undefined);
      await s.context.addInitScript(() => { const Original = window.EventSource; (window as any).__followupFeeds = [];
        window.EventSource = class extends Original { row: any;
          constructor(url: string | URL, init?: EventSourceInit) { super(url, init); this.row = { url: String(url), ready: 0, closed: false }; (window as any).__followupFeeds.push(this.row);
            this.addEventListener("open", () => this.row.ready = this.readyState); this.addEventListener("error", () => this.row.ready = this.readyState); }
          close() { this.row.closed = true; this.row.ready = 2; super.close(); }
        };
      });
      s.context.on("request", (r: any) => { const path = new URL(r.url()).pathname, method = r.method();
        if (path === "/api/ask/stream") asks.push({ name, id: r.headers()["x-request-id"], body: r.postDataJSON(), at: Date.now() });
        if (method === "GET" && /^\/api\/me\/chats\/[^/]+$/.test(path)) reads.push({ name, path, at: Date.now() });
        if ((method === "DELETE" && /^\/api\/me\/projects\/[^/]+$/.test(path)) || (method === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(path))) writes.push({ name, path, method, body: r.postDataJSON(), at: Date.now() }); });
      s.context.on("response", (r: any) => { const path = new URL(r.url()).pathname, method = r.request().method();
        if ((method === "DELETE" && /^\/api\/me\/projects\/[^/]+$/.test(path)) || (method === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(path))) acks.push({ name, path, method, body: r.request().postDataJSON(), status: r.status(), at: Date.now() }); });
      await s.login(ctx, ctx.users[name].email, ctx.users[name].password);
    }
    const readyUser = async (s: BrowserSession) => assert.ok(await pollUntil(() => s.page.evaluate(() => (window as any).__followupFeeds.some((r: any) => r.url === "/api/me/events" && !r.closed && r.ready === 1)), 15000));
    const row = (s: BrowserSession, text: string) => s.drawer().getByText(text, { exact: true }).locator("..");
    const sidebar = async (s = owner) => { if (!await s.drawer().isVisible()) {
      await s.page.locator('button[aria-label="Toggle sidebar"], button[aria-label="Seitenleiste umschalten"]').click();
      await s.drawer().waitFor({ state: "visible", timeout: 30000 });
    } };
    const closeSidebar = async (s = owner) => { if (await s.drawer().isVisible()) await s.drawer().locator("button").first().click(); };
    const committedView = () => owner.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const deleteNative = async (p: any, decision: "accept" | "dismiss", locale: "en" | "de" = "en") => {
      await sidebar(); const target = row(owner, p.name); await target.hover();
      const handled = new Promise<void>((resolve, reject) => owner.page.once("dialog", async (d: any) => { try {
        dialogs.push({ type: d.type(), message: d.message(), decision, locale, project: p.id, at: Date.now() }); assert.equal(d.type(), "confirm");
        assert.equal(d.message(), locale === "en" ? "Delete this project? Chats are kept and move back to their authors' chat lists." : "Dieses Projekt löschen? Chats bleiben erhalten und wandern zurück in die Chat-Listen ihrer Autoren.");
        await d[decision](); resolve();
      } catch (e) { await d.dismiss().catch(() => {}); reject(e); } }));
      await target.locator(`button[title="${locale === "en" ? "Delete project" : "Projekt löschen"}"]`).click();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([handled, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("native delete confirm missing within15s")), 15000); })]); } finally { if (timer) clearTimeout(timer); }
    };
    const { p, other, a, b, untouched } = await setup(ctx, owner.cookie, member.cookie, "UI delete");
    await g("logins-dark-en-de", async () => { for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) assert.equal((await f.json(ctx, "/api/auth/me", s.cookie)).id, ctx.users[name].id);
      assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de"); await owner.page.reload(); await owner.waitForComposer(); assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research...");
      try { const before = state(ctx), count = writes.length; await deleteNative(p, "dismiss", "de"); assert.deepEqual(state(ctx), before); assert.equal(writes.length, count); await rec.screenshot(owner.page, "delete-dark-de-cancel"); }
      finally { setAppLocale(ctx.dataDir, "en"); }
      for (const s of sessions) { await s.page.reload(); await s.waitForComposer(); await readyUser(s); }
      return { forms: 2, locales: ["en", "de"] }; });
    await g("owner-only", async () => { await sidebar(member); assert.ok(await pollUntil(() => member.drawer().getByText(p.name, { exact: true }).count().then((n: number) => n === 1), 10000));
      assert.equal(await row(member, p.name).locator('button[title="Delete project"]').count(), 0);
      const before = state(ctx), res = await ctx.request(`/api/me/projects/${p.id}`, { cookie: member.cookie, method: "DELETE" }); assert.equal(res.status, 404); await res.json(); assert.deepEqual(state(ctx), before); return { status: res.status }; });
    await owner.page.goto(`${ctx.baseUrl}/?chat=${a.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, a.base.at(-1)!.content)); await f.ready(owner, a.id);
    const q = `delete-origin-${ctx.label}`, answer = "Delete origin completed answer", late = f.blob("delete-origin-late");
    c.plans.set(q, [{ frames: [{ content: answer }, f.done], holdMemoryBlob: late }, { frames: [{ content: "Detached regenerated answer" }], holdOnly: true }]);
    await owner.send(q); await owner.waitAnswerVisible(answer); const origin = (await f.durable(owner, ctx, a.id, a.pre, answer)).http.body.messages;
    await g("cancel-no-effect", async () => { const before = state(ctx), count = writes.length; await deleteNative(p, "dismiss"); assert.deepEqual(state(ctx), before); assert.equal(writes.length, count); await rec.screenshot(owner.page, "delete-en-cancel"); return { before }; });
    await g("exact-detach", async () => { const before = state(ctx); await deleteNative(p, "accept"); assert.ok(await pollUntil(() => acks.some(a => a.method === "DELETE" && a.path === `/api/me/projects/${p.id}` && a.status === 200), 10000));
      const after = state(ctx); assertDeleteOnly(before, after, p.id); return { before, after }; });
    await g("author-flat-sidebars", async () => { const lists = await flatLists(ctx, owner.cookie, member.cookie, a, b);
      for (const [s, own, foreign] of [[owner, a, b], [member, b, a]] as const) { await sidebar(s); assert.ok(await pollUntil(async () => await s.drawer().getByText(p.name, { exact: true }).count() === 0 && await s.drawer().getByText(own.title, { exact: true }).count() === 1, 10000));
        assert.equal(await s.drawer().getByText(foreign.title, { exact: true }).count(), 0); await rec.screenshot(s.page, `delete-flat-${s === owner ? "owner" : "member"}`); } return lists; });
    await g("fresh-admission", async () => ({ owner: await admission(ctx, owner.cookie, a.id, true), member: await admission(ctx, member.cookie, b.id, true), formerMember: await admission(ctx, member.cookie, a.id, false), formerOwner: await admission(ctx, owner.cookie, b.id, false) }));
    await closeSidebar(); await committedView(); c.release(q, [{ memory_update: late }]);
    await g("late-origin-compaction", async () => { const got = await f.durable(owner, ctx, a.id, late, answer); assert.equal(got.http.body.projectId, null); assert.equal(got.http.body.assistantId, ctx.ids.soul); assert.deepEqual(f.projection(got.http.body.messages), f.projection(origin)); return got; });
    const ownReads = () => reads.filter(r => r.name === "owner").length;
    await g("direct-feedback", async () => { const before = writes.length, count = ownReads(), got = await f.feedback(owner, ctx, a.id, origin, late, answer);
      assert.ok(writes.length > before); assert.equal(ownReads(), count); const raw = state(ctx).messages.find((m: any) => m.id === origin.at(-1).id); assert.equal(JSON.parse(raw.metadata).feedback, "down"); return got; });
    const waitActive = async (question: string, count: number) => assert.ok(await pollUntil(() => { const upstream = ctx.upstream.requests.filter((r: any) => r.body?.question === question), browser = asks.filter(a => a.body.question === question);
      return upstream.length === count && browser.length === count && upstream.at(-1).id === browser.at(-1).id && c.held.some(h => h.question === question && h.id === upstream.at(-1).id) && ctx.upstream.pending.has(upstream.at(-1).id); }, 15000), "matching active browser/upstream held request required");
    const consumer = (question: string, id: string, projectId: string | null, memory: any, prefix: any[], readCount: number) => { const raw = asks.filter(a => a.body.question === question).at(-1).body, sent = ctx.upstream.requests.filter((r: any) => r.body?.question === question).at(-1).body;
      assert.equal(raw.session_id, id); assert.equal(raw.project_id, projectId, "delete acknowledgment must respect the current selected project"); assert.equal(raw.assistant_id, ctx.ids.soul); assert.deepEqual(raw.conversation_memory, memory); assert.deepEqual(sent.conversation_memory, memory);
      assert.deepEqual(raw.conversation_history, prefix.map(m => ({ role: m.role, content: m.content }))); assert.equal(ownReads(), readCount); assert.equal(JSON.stringify(sent).includes(instruction), projectId !== null); return { raw, sent }; };
    const regenReads = ownReads(); await owner.clickRegenerate(); await waitActive(q, 2);
    await g("detached-regenerate-snapshot", async () => consumer(q, a.id, null, a.pre, a.base, regenReads));
    c.release(q, [{ memory_update: f.blob("delete-regen-final") }, f.done]);
    await g("detached-regenerate-settles", async () => { const got = await f.durable(owner, ctx, a.id, f.blob("delete-regen-final"), "Detached regenerated answer"); assert.equal(got.http.body.projectId, null); return got; });
    const edited = `delete-edited-${ctx.label}`, editReads = ownReads(); c.plans.set(edited, [{ frames: [{ content: "Detached edited answer" }], holdOnly: true }]);
    await owner.editLastMessage(q, edited); await waitActive(edited, 1);
    await g("detached-edit-snapshot", async () => consumer(edited, a.id, null, a.pre, a.base, editReads));
    c.release(edited, [{ memory_update: f.blob("delete-edit-final") }, f.done]);
    await g("detached-edit-settles", async () => { const got = await f.durable(owner, ctx, a.id, f.blob("delete-edit-final"), "Detached edited answer"); assert.equal(got.http.body.projectId, null); return got; });

    // Storage commits under a real DELETE, but its genuine response waits while
    // the same mounted page selects a chat in a different, still-existing project.
    const pendingProject = await project(ctx, owner.cookie, "Delete pending project"), pending = await chat(ctx, owner.cookie, "Delete pending chat", pendingProject.id);
    await owner.page.goto(`${ctx.baseUrl}/?chat=${pending.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, pending.base[1].content)); await f.ready(owner, pending.id);
    const held: any = { body: null, status: null, delivered: false, release: null }, matcher = `${ctx.baseUrl}/api/me/projects/${pendingProject.id}`;
    const handler = async (route: any) => { if (route.request().method() !== "DELETE" || held.release !== null) return route.fallback();
      let release!: () => void; const barrier = new Promise<void>(r => release = r); held.release = release;
      const response = await route.fetch(); held.body = await response.json(); held.status = response.status(); await barrier; await route.fulfill({ response }); held.delivered = true; };
    await owner.context.route(matcher, handler); barriers.push({ held, close: async () => { held.release?.(); await owner.context.unroute(matcher, handler); } });
    const beforeDelete = state(ctx); await deleteNative(pendingProject, "accept"); assert.ok(await pollUntil(() => held.status === 200 && held.body !== null, 10000));
    await row(owner, other.name).click(); await row(owner, untouched.title).click(); assert.ok(await f.visible(owner, untouched.base[1].content)); await f.ready(owner, untouched.id);
    await g("held-ack-navigation-control", async () => { assert.equal(new URL(owner.page.url()).searchParams.get("chat"), untouched.id); assert.equal(held.delivered, false); assertDeleteOnly(beforeDelete, state(ctx), pendingProject.id);
      const observation = { held: { body: held.body, status: held.status }, before: beforeDelete, after: state(ctx), selected: untouched.id };
      held.release(); assert.ok(await pollUntil(() => held.delivered && acks.some(a => a.method === "DELETE" && a.path === `/api/me/projects/${pendingProject.id}`), 5000)); await committedView(); await rec.screenshot(owner.page, "delete-after-navigation-ack"); return observation; });
    const otherReads = ownReads(); c.plans.set(untouched.base[0].content, [{ frames: [{ content: "Retained project direct redo" }], holdOnly: true }]); await owner.clickRegenerate(); await waitActive(untouched.base[0].content, 1);
    await g("held-ack-consumer-context", async () => consumer(untouched.base[0].content, untouched.id, other.id, untouched.pre, [], otherReads));
    c.release(untouched.base[0].content, [{ memory_update: f.blob("delete-other-final") }, f.done]);
    await g("held-ack-consumer-settles", async () => { const got = await f.durable(owner, ctx, untouched.id, f.blob("delete-other-final"), "Retained project direct redo"); assert.equal(got.http.body.projectId, other.id); assert.equal(got.http.body.assistantId, ctx.ids.soul); return got; });
    await pollUntil(() => acks.length === writes.length, 10000);
    await g("acknowledgments", async () => { assert.equal(acks.length, writes.length); assert.ok(acks.every(a => a.status === 200));
      assert.deepEqual(acks.map(({ name, path, method, body }) => ({ name, path, method, body })), writes.map(({ name, path, method, body }) => ({ name, path, method, body })));
      return { writes, acknowledgments: acks }; });
  } finally {
    for (const b of barriers) await b.close();
    ctx.check("browser.no-page-errors", sessions.every(s => !s.pageErrors.length), sessions.map(s => s.pageErrors));
    ctx.check("browser.no-blocked-requests", sessions.every(s => !s.blocked.length), sessions.map(s => s.blocked));
    ctx.check("browser.responses-drained", !c.held.length && !c.unmatched.length && !ctx.upstream.pending.size && barriers.every(b => b.held.delivered), { held: c.held, unmatched: c.unmatched });
    writeFileSync(join(rec.dir, "delete-observations.json"), JSON.stringify({ observations: rec.observations, dialogs, writes, acknowledgments: acks, asks, reads, patches: rec.patches,
      heldAcks: barriers.map(b => ({ body: b.held.body, status: b.held.status, delivered: b.held.delivered })) }, null, 2));
    await member.close(); await owner.close();
  }
}
