// project-sharing-v1: actual share modal + independently expected grant set,
// current admission/opaque state, genuine held SSE and two Chromium contexts.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController, pollUntil, setAppLocale } from "./chat-browser-checks";
import { projectFixture as f } from "./chat-project-followup-checks";

export const SHARING_HTTP_GATES = ["http.directory", "http.private-admission", "http.direct-grant", "http.owner-only",
  "http.member-continuation", "http.grant-union", "http.revoke-admission", "http.regained-admission", "http.responses-drained"];
export const SHARING_BROWSER_GATES = ["browser.logins-dark-en-de", "browser.private-control", "browser.directory-modal",
  "browser.direct-grant-committed", "browser.member-sidebar-live", "browser.member-owner-controls", "browser.member-feedback-recall",
  "browser.member-continue-held", "browser.member-continue-durable", "browser.owner-adoption-feedback", "browser.dual-grants-committed",
  "browser.group-survives-user-revoke", "browser.revoke-committed", "browser.member-sidebar-revoked", "browser.fresh-revoke-admission",
  "browser.fresh-reload-denied", "browser.regained-sidebar", "browser.regained-consumer", "browser.owner-state-control",
  "browser.write-acknowledgments", "browser.no-page-errors", "browser.no-blocked-requests", "browser.responses-drained"];
const instructions = "Synthetic sharing project context: retain this exact private instruction marker.";

export function assertGrants(rows: any[], expected: string[]) {
  const actual = rows.map(r => {
    assert.equal(Boolean(r.groupId) !== Boolean(r.userId), true, "exactly one grant principal");
    return r.groupId ? `g:${r.groupId}` : `u:${r.userId}`;
  });
  assert.equal(new Set(actual).size, actual.length, "duplicate grants are not a valid stored set");
  assert.deepEqual(actual.sort(), [...expected].sort());
}
function db(ctx: any, fn: (d: any) => any) {
  const require = createRequire(join(ctx.appDir, "package.json")), Database = require("better-sqlite3");
  const d = new Database(join(ctx.dataDir, "cortex-chat.db"), { readonly: true, fileMustExist: true });
  try { return fn(d); } finally { d.close(); }
}
function state(ctx: any, id: string) {
  return db(ctx, d => ({ session: d.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id),
    messages: d.prepare("SELECT * FROM chat_messages WHERE chat_session_id = ? ORDER BY created_at, rowid").all(id) }));
}
async function grants(ctx: any, cookie: string, id: string, expected: string[]) {
  const project = (await f.json(ctx, "/api/me/projects", cookie)).projects.find((p: any) => p.id === id);
  assert.ok(project?.isOwner); assertGrants(project.shares, expected);
  const rows = db(ctx, d => d.prepare("SELECT group_id AS groupId, user_id AS userId FROM project_shares WHERE project_id = ?").all(id));
  assertGrants(rows, expected); return { project, rows };
}
async function status(ctx: any, path: string, cookie: string, expected: number, method = "GET", body?: unknown) {
  const r = await ctx.request(path, { method, cookie, ...(body === undefined ? {} : { body }) });
  const value = await r.json(); assert.equal(r.status, expected, `${method} ${path}: ${JSON.stringify(value)}`); return value;
}
async function project(ctx: any, cookie: string, name: string) {
  const p = (await f.json(ctx, "/api/me/projects", cookie, "POST", { name, instructions })).project;
  const id = (await f.json(ctx, "/api/me/chats", cookie, "POST", { title: `Chat ${name}`, projectId: p.id })).id;
  const base = f.pair(`fx-share-${ctx.label}`, "Sharing preserved base"), pre = f.blob("sharing-at-send");
  await f.patch(ctx, cookie, id, base, pre); return { p, id, base, pre };
}
async function feed(ctx: any, cookie: string, id: string) {
  const abort = new AbortController(), frames: string[] = [], errors: string[] = [];
  const res = await fetch(`${ctx.baseUrl}/api/me/chats/${id}/events`, { headers: { Cookie: cookie },
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
  if (res.status !== 200) { const body = await res.json(); return { status: res.status, body, frames, errors, close: async () => {} }; }
  const reader = res.body!.getReader(), decoder = new TextDecoder();
  const pump = (async () => { try { while (true) { const r = await reader.read(); if (r.done) break; frames.push(decoder.decode(r.value)); } }
    catch (e) { if (!abort.signal.aborted) errors.push(String(e)); } })();
  assert.ok(await pollUntil(() => frames.join("").includes(": connected"), 15000));
  return { status: res.status, body: null, frames, errors, close: async () => { abort.abort(); await pump; } };
}
async function admission(ctx: any, cookie: string, p: string, id: string, allowed: boolean) {
  const listed = (await f.json(ctx, "/api/me/projects", cookie)).projects.find((x: any) => x.id === p);
  assert.equal(Boolean(listed), allowed);
  const body = await status(ctx, `/api/me/chats/${id}`, cookie, allowed ? 200 : 404);
  const opened = await feed(ctx, cookie, id); try { assert.equal(opened.status, allowed ? 200 : 404); }
  finally { await opened.close(); }
  assert.deepEqual(opened.errors, []); return { listed, body, newFeedStatus: opened.status };
}
async function askScope(ctx: any, c: ReturnType<typeof makeUpstreamController>, cookie: string, p: string, id: string, allowed: boolean, suffix: string) {
  const question = `sharing-scope-${suffix}-${ctx.label}`;
  c.plans.set(question, [{ frames: [{ content: "Synthetic scope probe answer" }, { done: true }] }]);
  const res = await ctx.request("/api/ask/stream", { cookie, method: "POST", body: { question, project_id: p,
    session_id: id, conversation_history: [], conversation_memory: {} } });
  assert.equal(res.status, 200); await res.text();
  const sent = ctx.upstream.requests.find((r: any) => r.body?.question === question);
  assert.ok(sent); assert.equal(JSON.stringify(sent.body).includes(instructions), allowed);
  for (const key of ["project_id", "session_id", "assistant_id"]) assert.equal(sent.body[key], undefined);
  return { sent, note: "general ask stays available; inaccessible project context/relay is omitted, not a blanket 403" };
}

export async function runSharingHttp(ctx: any) {
  const owner = await f.login(ctx, "owner"), member = await f.login(ctx, "member"), c = makeUpstreamController(ctx);
  const { p, id, base, pre } = await project(ctx, owner, "HTTP sharing private");
  const put = (shares: unknown[]) => f.json(ctx, `/api/me/projects/${p.id}/shares`, owner, "PUT", { shares });
  let before = state(ctx, id), observed: any = null;
  await f.gate(ctx, "http.directory", async () => {
    assert.deepEqual(await f.json(ctx, "/api/me/directory?q=x", owner), { groups: [], users: [] });
    const users = await f.json(ctx, `/api/me/directory?q=${encodeURIComponent(ctx.users.member.email)}`, owner);
    assert.deepEqual(users.users.map((u: any) => u.id), [ctx.users.member.id]);
    const groups = await f.json(ctx, "/api/me/directory?q=Fixture%20Group", owner);
    assert.deepEqual(groups.groups.map((g: any) => g.id), [ctx.ids.group]);
    assert.ok(users.users.length <= 8 && groups.groups.length <= 8); return { users, groups };
  });
  await f.gate(ctx, "http.private-admission", async () => ({ denied: await admission(ctx, member, p.id, id, false),
    ask: await askScope(ctx, c, member, p.id, id, false, "private") }));
  await f.gate(ctx, "http.direct-grant", async () => {
    await put([{ userId: ctx.users.member.id }, { userId: ctx.users.member.id }, { userId: ctx.users.owner.id }, { userId: "fx-unknown-user" }]);
    const got = await grants(ctx, owner, p.id, [`u:${ctx.users.member.id}`]); assert.deepEqual(state(ctx, id), before);
    const malformed = await status(ctx, `/api/me/projects/${p.id}/shares`, owner, 400, "PUT", { shares: [{ userId: ctx.users.member.id, groupId: ctx.ids.group }] });
    await grants(ctx, owner, p.id, [`u:${ctx.users.member.id}`]);
    return { got, malformed, admitted: await admission(ctx, member, p.id, id, true), ask: await askScope(ctx, c, member, p.id, id, true, "granted") };
  });
  await f.gate(ctx, "http.owner-only", async () => {
    const denied = [];
    for (const [path, method, body] of [[`/api/me/projects/${p.id}/shares`, "PUT", { shares: [] }],
      [`/api/me/projects/${p.id}`, "PATCH", { name: "Rejected mutation" }], [`/api/me/projects/${p.id}`, "DELETE", undefined],
      [`/api/me/chats/${id}`, "PATCH", { title: "Rejected rename" }]] as const) denied.push(await status(ctx, path, member, 404, method, body));
    await grants(ctx, owner, p.id, [`u:${ctx.users.member.id}`]); assert.deepEqual(state(ctx, id), before); return denied;
  });
  await f.gate(ctx, "http.member-continuation", async () => {
    const messages = [...base, ...f.pair(`fx-http-share-member-${ctx.label}`, "HTTP member continuation")];
    const got = await f.patch(ctx, member, id, messages, f.blob("http-member-final"));
    assert.deepEqual(got.messages.map((m: any) => m.authorId), [ctx.users.owner.id, ctx.users.owner.id, ctx.users.member.id, ctx.users.member.id]);
    before = state(ctx, id); return got;
  });
  await f.gate(ctx, "http.grant-union", async () => {
    await put([{ userId: ctx.users.member.id }, { groupId: ctx.ids.group }]); await grants(ctx, owner, p.id, [`u:${ctx.users.member.id}`, `g:${ctx.ids.group}`]);
    await put([{ groupId: ctx.ids.group }]); await grants(ctx, owner, p.id, [`g:${ctx.ids.group}`]);
    assert.deepEqual(state(ctx, id), before); observed = await feed(ctx, member, id); return admission(ctx, member, p.id, id, true);
  });
  try { await f.gate(ctx, "http.revoke-admission", async () => {
    await put([]); await grants(ctx, owner, p.id, []); assert.deepEqual(state(ctx, id), before);
    const denied = await admission(ctx, member, p.id, id, false);
    await status(ctx, `/api/me/chats/${id}`, member, 404, "PATCH", { messages: base, memory: pre });
    // Existing subscription is an observed connect-time snapshot, not a new
    // instantaneous revocation promise. A same-memory write signals its channel.
    const start = observed.frames.length;
    await f.json(ctx, `/api/me/chats/${id}`, owner, "PATCH", { memory: f.blob("http-member-final") });
    const existingReceived = await pollUntil(() => observed.frames.slice(start).join("").includes('"by"'), 1500);
    return { denied, ask: await askScope(ctx, c, member, p.id, id, false, "revoked"),
      existingFeedObservation: { existingReceived, frames: observed.frames, admissionOnly: true } };
  }); } finally { if (observed) await observed.close(); }
  await f.gate(ctx, "http.regained-admission", async () => {
    await put([{ userId: ctx.users.member.id }]); await grants(ctx, owner, p.id, [`u:${ctx.users.member.id}`]);
    const got = await admission(ctx, member, p.id, id, true);
    assert.deepEqual(f.projection(got.body.messages).slice(0, 2), base); assert.deepEqual(got.body.memory, f.blob("http-member-final")); return got;
  });
  ctx.check("http.responses-drained", !c.held.length && !c.unmatched.length && !ctx.upstream.pending.size, { held: c.held, unmatched: c.unmatched });
}

export async function runSharingBrowser(ctx: any) {
  const rec = new Recorder(join(ctx.workDir, "logs")), p = browserPrerequisites(); assert.deepEqual(p.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(p.pwPath, "index.js"));
  for (const file of ["src/app/page.tsx", "src/components/projects/ProjectShareModal.tsx", "src/components/Sidebar.tsx"])
    copyFileSync(join(ctx.appDir, file), join(rec.dir, file.split("/").pop()!));
  writeFileSync(join(rec.dir, "tooling.json"), JSON.stringify({ ...p, version: JSON.parse(readFileSync(join(p.pwPath, "package.json"), "utf8")).version,
    browserProfileTmpdir: process.env.TMPDIR, install: false }, null, 2));
  const owner = new BrowserSession(pw, p.chromiumPath, ctx.baseUrl, rec), member = new BrowserSession(pw, p.chromiumPath, ctx.baseUrl, rec);
  const sessions = [owner, member], c = makeUpstreamController(ctx), writes: any[] = [], acks: any[] = [], directory: any[] = [], reads: any[] = [];
  try {
    for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) {
      await s.start(s === member ? owner.browser : undefined);
      await s.context.addInitScript(() => {
        const Original = window.EventSource; (window as any).__followupFeeds = [];
        window.EventSource = class extends Original {
          observation: any;
          constructor(url: string | URL, init?: EventSourceInit) {
            super(url, init); const row = { url: String(url), ready: 0, opens: 0, closed: false, events: [] as any[] };
            this.observation = row; (window as any).__followupFeeds.push(row);
            this.addEventListener("open", () => { row.ready = this.readyState; row.opens++; });
            this.addEventListener("message", e => row.events.push(JSON.parse(e.data)));
            this.addEventListener("error", () => { row.ready = this.readyState; });
          }
          close() { this.observation.closed = true; this.observation.ready = 2; super.close(); }
        };
      });
      s.context.on("request", (r: any) => {
        const path = new URL(r.url()).pathname;
        if (r.method() === "PUT" && /\/shares$/.test(path)) writes.push({ name, path, body: r.postDataJSON(), at: Date.now() });
        if (path === "/api/me/directory") directory.push({ name, query: new URL(r.url()).searchParams.get("q") });
        if (r.method() === "GET" && /^\/api\/me\/chats\/[^/]+$/.test(path)) reads.push({ name, path, at: Date.now() });
      });
      s.context.on("response", (r: any) => { if (["PUT", "PATCH"].includes(r.request().method()))
        acks.push({ name, path: new URL(r.url()).pathname, method: r.request().method(), status: r.status(), at: Date.now() }); });
      await s.login(ctx, ctx.users[name].email, ctx.users[name].password);
    }
    const g = (name: string, fn: () => Promise<any>) => f.gate(ctx, `browser.${name}`, fn);
    const userReady = async (s: BrowserSession) => assert.ok(await pollUntil(() => s.page.evaluate(() =>
      (window as any).__followupFeeds.some((r: any) => r.url === "/api/me/events" && !r.closed && r.ready === 1)), 15000));
    await g("logins-dark-en-de", async () => {
      for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) assert.equal((await f.json(ctx, "/api/auth/me", s.cookie)).id, ctx.users[name].id);
      assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de"); await owner.page.reload(); await owner.waitForComposer();
      assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research..."); await rec.screenshot(owner.page, "sharing-dark-de");
      setAppLocale(ctx.dataDir, "en"); await owner.page.reload(); await owner.waitForComposer(); await userReady(owner); await userReady(member);
      return { forms: 2, locales: ["en", "de"] };
    });
    const { p: proj, id, base, pre } = await project(ctx, owner.cookie, "Sharing browser gate");
    // A consumer owns its no-refetch window; the peer may legitimately adopt
    // that consumer's acknowledged write. Regained access must change rating,
    // because clicking an already-selected thumb intentionally performs no write.
    const ownReads = (name: string) => reads.filter(r => r.name === name && r.path === `/api/me/chats/${id}`).length;
    const freshFeedback = async (s: BrowserSession, name: string, expected: any[], value: unknown, target: any, rating: "up" | "down") => {
      const beforeReads = ownReads(name), beforePatches = rec.patches.length, beforeAcks = acks.length;
      const bubble = s.page.locator("div.group").filter({ hasText: target.content }).last();
      await bubble.hover(); await bubble.locator(`button[aria-label="${rating === "up" ? "Good answer" : "Bad answer"}"]`).click();
      assert.ok(await pollUntil(() => rec.patches.slice(beforePatches).some(p => p.chatId === id && p.body?.messages?.some((m: any) => m.id === target.id && m.feedback === rating)), 10000), "this feedback must dispatch a new matching PATCH");
      const got = await s.durableSettled(ctx, id, d => JSON.stringify(d.http.body?.memory) === JSON.stringify(value) &&
        d.sqlite.session?.memory === JSON.stringify(value) && d.http.body?.messages?.find((m: any) => m.id === target.id)?.feedback === rating);
      assert.deepEqual(f.projection(got.http.body.messages), f.projection(expected)); assert.deepEqual(f.projection(got.sqlite.messages), f.projection(expected));
      assert.deepEqual(got.http.body.memory, value); assert.equal(got.sqlite.session.memory, JSON.stringify(value));
      assert.equal(JSON.parse(state(ctx, id).messages.find((m: any) => m.id === target.id).metadata).feedback, rating);
      assert.ok(await pollUntil(() => acks.slice(beforeAcks).some(a => a.name === name && a.method === "PATCH" && a.path === `/api/me/chats/${id}` && a.status === 200), 10000));
      assert.equal(ownReads(name), beforeReads); return { got, actor: name, targetId: target.id, rating, newPatches: rec.patches.slice(beforePatches), acknowledgments: acks.slice(beforeAcks) };
    };
    const initial = state(ctx, id);
    await owner.page.reload(); await owner.waitForComposer(); await userReady(owner);
    await member.openSidebar();
    const projectRow = (s: BrowserSession) => s.drawer().getByText(proj.name, { exact: true }).locator("..");
    const modal = () => owner.page.locator("div.max-w-md").filter({ has: owner.page.getByRole("heading", { name: `Share: ${proj.name}`, exact: true }) });
    const openShare = async () => { if (!await owner.drawer().isVisible()) await owner.openSidebar();
      await projectRow(owner).hover(); await projectRow(owner).locator('button[title="Share project"]').click(); await modal().waitFor(); };
    const save = async (expected: string[]) => { await modal().getByRole("button", { name: "Save", exact: true }).click(); await modal().waitFor({ state: "hidden" });
      assert.ok(await pollUntil(async () => { try { await grants(ctx, owner.cookie, proj.id, expected); return true; } catch { return false; } }, 10000));
      return grants(ctx, owner.cookie, proj.id, expected); };
    const add = async (query: string, text: string) => { await modal().getByPlaceholder("Search groups and people…").fill(query);
      await modal().getByRole("button").filter({ hasText: text }).last().click(); };
    const remove = async (label: string) => { await modal().locator("span.inline-flex").filter({ hasText: label }).locator('button[aria-label="Remove"]').click(); };
    await g("private-control", async () => { assert.equal(await member.drawer().getByText(proj.name, { exact: true }).count(), 0);
      await grants(ctx, owner.cookie, proj.id, []); assert.deepEqual(state(ctx, id), initial); return admission(ctx, member.cookie, proj.id, id, false); });
    await openShare();
    await g("directory-modal", async () => {
      const count = directory.length; await modal().getByPlaceholder("Search groups and people…").fill("f"); await new Promise(r => setTimeout(r, 450));
      assert.equal(directory.length, count, "one-character search must not dispatch");
      await add(ctx.users.member.email, ctx.users.member.email);
      assert.ok(directory.some(d => d.name === "owner" && d.query === ctx.users.member.email));
      assert.equal(await modal().locator('button[aria-label="Remove"]').count(), 1); await rec.screenshot(owner.page, "direct-share-chip"); return directory;
    });
    await g("direct-grant-committed", async () => { const got = await save([`u:${ctx.users.member.id}`]); assert.deepEqual(state(ctx, id), initial); return got; });
    await g("member-sidebar-live", async () => { assert.ok(await pollUntil(() => member.drawer().getByText(proj.name, { exact: true }).count().then((n: number) => n === 1), 8000), "live user feed must reveal grant without reload");
      await rec.screenshot(member.page, "member-granted-sidebar"); return admission(ctx, member.cookie, proj.id, id, true); });
    await g("member-owner-controls", async () => { for (const title of ["Share project", "Edit project", "Delete project"]) assert.equal(await projectRow(member).locator(`button[title="${title}"]`).count(), 0);
      await status(ctx, `/api/me/projects/${proj.id}/shares`, member.cookie, 404, "PUT", { shares: [] }); return { ownerManagementButtons: 0 }; });
    await projectRow(member).click(); await member.drawer().getByText(`Chat ${proj.name}`, { exact: true }).click();
    assert.ok(await f.visible(member, base[1].content)); await f.ready(member, id);
    await g("member-feedback-recall", () => freshFeedback(member, "member", base, pre, base[1], "down"));
    await f.open(owner, ctx, id, base[1].content);
    const q = `sharing-member-question-${ctx.label}`, answer = "Sharing member acknowledged answer", late = f.blob("sharing-member-final");
    c.plans.set(q, [{ frames: [{ content: answer }, f.done], holdMemoryBlob: late }]);
    await member.send(q); assert.ok((await c.waitHeld(q, 15000)).found); await member.waitAnswerVisible(answer);
    await g("member-continue-held", async () => { const sent = ctx.upstream.requests.find((r: any) => r.body?.question === q);
      assert.deepEqual(sent.body.conversation_memory, pre); assert.deepEqual(sent.body.conversation_history.slice(-base.length), base.map(m => ({ role: m.role, content: m.content })));
      assert.ok(JSON.stringify(sent.body).includes(instructions)); assert.ok(await f.visible(owner, answer)); return sent; });
    await f.durable(member, ctx, id, pre, answer); c.release(q, [{ memory_update: late }]);
    let selected: any[] = [];
    await g("member-continue-durable", async () => { const got = await f.durable(member, ctx, id, late, answer); selected = got.http.body.messages;
      assert.deepEqual(f.projection(selected).slice(0, 2), base); assert.equal(selected.length, 4);
      assert.deepEqual(selected.map(m => m.authorId), [ctx.users.owner.id, ctx.users.owner.id, ctx.users.member.id, ctx.users.member.id]); return got; });
    await f.ready(owner, id);
    await g("owner-adoption-feedback", async () => { assert.ok(await pollUntil(() => owner.page.locator('button[aria-label="Bad answer"]').count().then((n: number) => n === 2), 8000));
      return freshFeedback(owner, "owner", selected, late, selected.at(-1), "down"); });
    // Future share mutations must preserve every persisted chat column and
    // metadata byte, not just the prefix or memory projection.
    const settled = state(ctx, id);
    await openShare(); await add("Fixture Group", "Fixture Group");
    await g("dual-grants-committed", async () => { const got = await save([`u:${ctx.users.member.id}`, `g:${ctx.ids.group}`]); assert.deepEqual(state(ctx, id), settled); return got; });
    await openShare(); await remove("fixture-user");
    await g("group-survives-user-revoke", async () => { const got = await save([`g:${ctx.ids.group}`]); assert.deepEqual(state(ctx, id), settled);
      return { got, admitted: await admission(ctx, member.cookie, proj.id, id, true) }; });
    await userReady(member); await openShare(); await remove("Fixture Group");
    await g("revoke-committed", async () => { const got = await save([]); assert.deepEqual(state(ctx, id), settled); return got; });
    await member.openSidebar();
    await g("member-sidebar-revoked", async () => { assert.ok(await pollUntil(() => member.drawer().getByText(proj.name, { exact: true }).count().then((n: number) => n === 0), 8000), "live list must remove revoked project");
      await rec.screenshot(member.page, "member-revoked-sidebar"); return { oldChatFeed: await f.feedState(member, id), observation: "old chat feed admission is connect-time; fresh admission below rechecks membership" }; });
    await g("fresh-revoke-admission", async () => { const denied = await admission(ctx, member.cookie, proj.id, id, false);
      await status(ctx, `/api/me/chats/${id}`, member.cookie, 404, "PATCH", { messages: base, memory: pre }); assert.deepEqual(state(ctx, id), settled); return denied; });
    await g("fresh-reload-denied", async () => { await member.page.reload(); await member.waitForComposer();
      assert.ok(await pollUntil(() => !new URL(member.page.url()).searchParams.has("chat"), 8000)); assert.equal(await f.visible(member, answer, 200), false);
      assert.deepEqual(state(ctx, id), settled); await userReady(member); return { url: member.page.url() }; });
    await openShare(); await add("Fixture Group", "Fixture Group"); await save([`g:${ctx.ids.group}`]);
    await member.openSidebar();
    await g("regained-sidebar", async () => { assert.ok(await pollUntil(() => member.drawer().getByText(proj.name, { exact: true }).count().then((n: number) => n === 1), 8000));
      return admission(ctx, member.cookie, proj.id, id, true); });
    await projectRow(member).click(); await member.drawer().getByText(`Chat ${proj.name}`, { exact: true }).click(); assert.ok(await f.visible(member, answer)); await f.ready(member, id);
    await g("regained-consumer", () => freshFeedback(member, "member", selected, late, base[1], "up"));
    await g("owner-state-control", async () => { const got = await f.durable(owner, ctx, id, late, answer); assert.deepEqual(f.projection(got.http.body.messages), f.projection(selected));
      assert.equal(got.http.body.projectId, proj.id); return { got, grants: await grants(ctx, owner.cookie, proj.id, [`g:${ctx.ids.group}`]) }; });
    await pollUntil(() => acks.length === writes.length + rec.patches.length, 10000);
    await g("write-acknowledgments", async () => { assert.equal(acks.length, writes.length + rec.patches.length); assert.ok(acks.length > 0);
      assert.ok(acks.every(a => a.status === 200)); return { writes, patches: rec.patches, acknowledgments: acks }; });
  } finally {
    ctx.check("browser.no-page-errors", sessions.every(s => !s.pageErrors.length), sessions.map(s => s.pageErrors));
    ctx.check("browser.no-blocked-requests", sessions.every(s => !s.blocked.length), sessions.map(s => s.blocked));
    ctx.check("browser.responses-drained", !c.held.length && !c.unmatched.length && !ctx.upstream.pending.size, { held: c.held, unmatched: c.unmatched });
    writeFileSync(join(rec.dir, "sharing-observations.json"), JSON.stringify({ observations: rec.observations, writes, patches: rec.patches, acknowledgments: acks,
      directory, reads, feeds: await Promise.all(sessions.map(s => s.page?.evaluate(() => (window as any).__followupFeeds).catch(() => null))) }, null, 2));
    await member.close(); await owner.close();
  }
}
