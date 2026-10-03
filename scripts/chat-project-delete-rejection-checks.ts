// delete-rejection-v1: abort the actual Chromium DELETE before server dispatch.
// Exact raw state, direct consumers, native cancel/success and transport evidence.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController, pollUntil, setAppLocale } from "./chat-browser-checks";
import { projectFixture as f } from "./chat-project-followup-checks";
import { assertDeleteOnly } from "./chat-project-delete-checks";

export const REJECTION_GATES = ["browser.login-dark-en-de", "browser.cancel-state", "browser.cancel-consumer", "browser.cancel-settles",
  ...["regenerate", "edit"].flatMap(kind => [`browser.${kind}-transport-failure`, `browser.${kind}-unchanged-state`, `browser.${kind}-late-memory`, `browser.${kind}-consumer-context`, `browser.${kind}-settles`]),
  "browser.success-detach", "browser.success-consumer", "browser.success-settles", "browser.operation-outcomes", "browser.no-page-errors", "browser.no-blocked-requests", "browser.responses-drained"];
const instructions = "Synthetic retained project instructions after failed deletion.";
function rawState(ctx: any) {
  const require = createRequire(join(ctx.appDir, "package.json")), Database = require("better-sqlite3"), db = new Database(join(ctx.dataDir, "cortex-chat.db"), { readonly: true, fileMustExist: true });
  try { return { projects: db.prepare("SELECT * FROM projects ORDER BY id").all(), shares: db.prepare("SELECT * FROM project_shares ORDER BY id").all(),
    sessions: db.prepare("SELECT * FROM chat_sessions ORDER BY id").all(), messages: db.prepare("SELECT * FROM chat_messages ORDER BY id").all() }; } finally { db.close(); }
}
async function fixture(ctx: any, owner: string, member: string, tag: string) {
  const p = (await f.json(ctx, "/api/me/projects", owner, "POST", { name: `${tag} project`, instructions })).project;
  await f.json(ctx, `/api/me/projects/${p.id}/shares`, owner, "PUT", { shares: [{ userId: ctx.users.member.id }] });
  const create = async (cookie: string, title: string) => {
    const id = (await f.json(ctx, "/api/me/chats", cookie, "POST", { title, projectId: p.id, assistantId: ctx.ids.soul })).id;
    const base = f.pair(`fx-rejection-${title}-${ctx.label}`, title).map(m => m.role === "assistant" ? { ...m, feedback: "up", thinking: ["Retained reasoning"],
      sources: [{ document_id: "fx-rejection-source", chunk_id: "fx-rejection-chunk", content: "Retained source bytes", score: 0.42, sid: "fx-rejection-sid", metadata: { filename: "fixture-rejection.md" } }] } : m), pre = f.blob(`${title}-pre`);
    await f.patch(ctx, cookie, id, base, pre); await f.json(ctx, `/api/me/chats/${id}`, cookie, "PATCH", { pinned: true }); return { id, title, base, pre };
  };
  const own = await create(owner, `${tag} owner chat`), peer = await create(member, `${tag} peer chat`); return { p, own, peer };
}
export async function runRejectionBrowser(ctx: any) {
  const rec = new Recorder(join(ctx.workDir, "logs")), tool = browserPrerequisites(); assert.deepEqual(tool.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(tool.pwPath, "index.js")), owner = new BrowserSession(pw, tool.chromiumPath, ctx.baseUrl, rec), c = makeUpstreamController(ctx);
  for (const [path, name] of [["src/app/page.tsx", "page.tsx"], ["src/lib/projects-client.ts", "projects-client.ts"], ["src/app/api/me/projects/[id]/route.ts", "delete-route.ts"]]) copyFileSync(join(ctx.appDir, path), join(rec.dir, name));
  writeFileSync(join(rec.dir, "tooling.json"), JSON.stringify({ ...tool, version: JSON.parse(readFileSync(join(tool.pwPath, "package.json"), "utf8")).version, tmpdir: process.env.TMPDIR, install: false }, null, 2));
  const writes: any[] = [], acks: any[] = [], failures: any[] = [], asks: any[] = [], reads: any[] = [], projectReads: any[] = [], dialogs: any[] = [], injected: any[] = [], barriers: any[] = [];
  const g = (id: string, fn: () => Promise<any>) => f.gate(ctx, `browser.${id}`, fn);
  const appLog = () => readFileSync(join(ctx.workDir, "logs", "app-dev.log"), "utf8");
  try {
    await owner.start();
    await owner.context.addInitScript(() => { const Original = window.EventSource; (window as any).__followupFeeds = [];
      window.EventSource = class extends Original { row: any;
        constructor(url: string | URL, init?: EventSourceInit) { super(url, init); this.row = { url: String(url), ready: 0, closed: false }; (window as any).__followupFeeds.push(this.row); this.addEventListener("open", () => this.row.ready = this.readyState); this.addEventListener("error", () => this.row.ready = this.readyState); }
        close() { this.row.closed = true; this.row.ready = 2; super.close(); }
      };
    });
    const tracked = (path: string, method: string) => (method === "DELETE" && /^\/api\/me\/projects\/[^/]+$/.test(path)) || (method === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(path));
    owner.context.on("request", (r: any) => { const path = new URL(r.url()).pathname, method = r.method();
      if (tracked(path, method)) writes.push({ path, method, body: r.postDataJSON(), at: Date.now() });
      if (path === "/api/ask/stream") asks.push({ id: r.headers()["x-request-id"], body: r.postDataJSON(), at: Date.now() });
      if (method === "GET" && /^\/api\/me\/chats\/[^/]+$/.test(path)) reads.push({ path, at: Date.now() }); });
    owner.context.on("requestfailed", (r: any) => { const path = new URL(r.url()).pathname; if (tracked(path, r.method())) failures.push({ path, method: r.method(), error: r.failure()?.errorText, at: Date.now() }); });
    owner.context.on("response", (r: any) => { const path = new URL(r.url()).pathname, method = r.request().method();
      if (tracked(path, method)) acks.push({ path, method, body: r.request().postDataJSON(), status: r.status(), at: Date.now() });
      if (method === "GET" && path === "/api/me/projects") projectReads.push({ path, status: r.status(), at: Date.now() }); });
    await owner.login(ctx, ctx.users.owner.email, ctx.users.owner.password); const member = await f.login(ctx, "member");
    const row = (text: string) => owner.drawer().getByText(text, { exact: true }).locator("..");
    const sidebar = async () => { if (!await owner.drawer().isVisible()) { await owner.page.locator('button[aria-label="Toggle sidebar"], button[aria-label="Seitenleiste umschalten"]').click(); await owner.drawer().waitFor({ state: "visible", timeout: 30000 }); } };
    const closeSidebar = async () => { if (await owner.drawer().isVisible()) await owner.drawer().locator("button").first().click(); };
    const frames = () => owner.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const native = async (p: any, decision: "accept" | "dismiss", locale: "en" | "de" = "en") => {
      await sidebar(); const target = row(p.name); await target.hover();
      const handled = new Promise<void>((resolve, reject) => owner.page.once("dialog", async (d: any) => { try {
        dialogs.push({ project: p.id, type: d.type(), text: d.message(), decision, locale, at: Date.now() }); assert.equal(d.type(), "confirm");
        assert.equal(d.message(), locale === "en" ? "Delete this project? Chats are kept and move back to their authors' chat lists." : "Dieses Projekt löschen? Chats bleiben erhalten und wandern zurück in die Chat-Listen ihrer Autoren."); await d[decision](); resolve();
      } catch (e) { await d.dismiss().catch(() => {}); reject(e); } }));
      await target.locator(`button[title="${locale === "en" ? "Delete project" : "Projekt löschen"}"]`).click(); let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([handled, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("native confirmation missing within15s")), 15000); })]); } finally { if (timer) clearTimeout(timer); }
    };
    const waitActive = async (question: string, count: number) => assert.ok(await pollUntil(() => { const browser = asks.filter(a => a.body.question === question), upstream = ctx.upstream.requests.filter((r: any) => r.body?.question === question);
      return browser.length === count && upstream.length === count && browser.at(-1).id === upstream.at(-1).id && ctx.upstream.pending.has(upstream.at(-1).id) && c.held.some(h => h.id === upstream.at(-1).id && h.question === question); }, 15000));
    const consume = (question: string, own: any, projectId: string | null, count: number, prefix = own.base) => {
      const raw = asks.filter(a => a.body.question === question).at(-1).body, sent = ctx.upstream.requests.filter((r: any) => r.body?.question === question).at(-1).body;
      assert.equal(raw.project_id, projectId, "failed deletion must retain selected project context"); assert.equal(raw.session_id, own.id); assert.equal(raw.assistant_id, ctx.ids.soul);
      assert.deepEqual(raw.conversation_memory, own.pre); assert.deepEqual(sent.conversation_memory, own.pre); assert.deepEqual(raw.conversation_history, prefix.map((m: any) => ({ role: m.role, content: m.content })));
      assert.equal(reads.length, count, "direct consumer must not perform a repairing chat GET"); assert.equal(JSON.stringify(sent).includes(instructions), projectId !== null); return { raw, sent };
    };
    const open = async (own: any) => { await owner.page.goto(`${ctx.baseUrl}/?chat=${own.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, own.base[1].content)); await f.ready(owner, own.id); };
    const cancel = await fixture(ctx, owner.cookie, member, "Cancel control");
    await g("login-dark-en-de", async () => { assert.equal((await f.json(ctx, "/api/auth/me", owner.cookie)).id, ctx.users.owner.id); assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de"); await owner.page.reload(); await owner.waitForComposer(); assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research...");
      try { const before = rawState(ctx), count = writes.length; await native(cancel.p, "dismiss", "de"); assert.deepEqual(rawState(ctx), before); assert.equal(writes.length, count); await rec.screenshot(owner.page, "rejection-dark-de-cancel"); } finally { setAppLocale(ctx.dataDir, "en"); }
      await owner.page.reload(); await owner.waitForComposer(); return { login: true, locales: ["en", "de"] }; });
    await open(cancel.own);
    await g("cancel-state", async () => { const before = rawState(ctx), count = writes.length; await native(cancel.p, "dismiss"); await closeSidebar(); await frames(); assert.deepEqual(rawState(ctx), before); assert.equal(writes.length, count); return before; });
    const cancelQuestion = cancel.own.base[0].content, cancelCount = reads.length; c.plans.set(cancelQuestion, [{ frames: [{ content: "Cancel control redo" }], holdOnly: true }]); await owner.clickRegenerate(); await waitActive(cancelQuestion, 1);
    await g("cancel-consumer", async () => consume(cancelQuestion, cancel.own, cancel.p.id, cancelCount, [])); c.release(cancelQuestion, [{ memory_update: f.blob("cancel-final") }, f.done]);
    await g("cancel-settles", async () => { const got = await f.durable(owner, ctx, cancel.own.id, f.blob("cancel-final"), "Cancel control redo"); assert.equal(got.http.body.projectId, cancel.p.id); return got; });
    for (const kind of ["regenerate", "edit"] as const) {
      const fx = await fixture(ctx, owner.cookie, member, `Failure ${kind}`); await open(fx.own);
      const q = `rejected-${kind}-${ctx.label}`, answer = `Original ${kind} completed answer`, late = f.blob(`${kind}-valid-late`);
      c.plans.set(q, [{ frames: [{ content: answer }, f.done], holdMemoryBlob: late }, { frames: [{ content: "Rejected regenerate redo" }], holdOnly: true }]);
      await owner.send(q); await owner.waitAnswerVisible(answer); const origin = (await f.durable(owner, ctx, fx.own.id, fx.own.pre, answer)).http.body.messages;
      const matcher = `${ctx.baseUrl}/api/me/projects/${fx.p.id}`, before = rawState(ctx), refreshes = projectReads.length, held: any = { path: `/api/me/projects/${fx.p.id}`, intercepted: false, aborted: false };
      const handler = async (route: any) => { const req = route.request(); if (req.method() !== "DELETE" || held.intercepted) return route.fallback(); held.intercepted = true; held.method = req.method(); held.at = Date.now(); injected.push(held);
        // No route.fetch/continue: this actual browser request cannot reach Next.
        await route.abort("failed"); held.aborted = true; };
      await owner.context.route(matcher, handler); barriers.push({ close: () => owner.context.unroute(matcher, handler) });
      await native(fx.p, "accept");
      await g(`${kind}-transport-failure`, async () => { assert.ok(await pollUntil(() => held.aborted && failures.some(r => r.path === held.path), 10000)); const failure = failures.find(r => r.path === held.path);
        assert.equal(failure.method, "DELETE"); assert.equal(failure.error, "net::ERR_FAILED"); assert.equal(acks.some(a => a.path === held.path), false); assert.equal(appLog().includes(`DELETE ${held.path} `), false); return { intercepted: held, failure, serverDispatch: "absent; aborted before forwarding" }; });
      assert.ok(await pollUntil(() => projectReads.length > refreshes && projectReads.at(-1).status === 200, 10000), "current page's post-failure list refresh must finish before direct consumer");
      await closeSidebar(); await frames();
      await g(`${kind}-unchanged-state`, async () => { assert.deepEqual(rawState(ctx), before); const visible = (await f.json(ctx, "/api/me/projects", owner.cookie)).projects.find((p: any) => p.id === fx.p.id); assert.ok(visible); assert.equal(new URL(owner.page.url()).searchParams.get("chat"), fx.own.id); return { before, after: rawState(ctx), project: visible }; });
      c.release(q, [{ memory_update: late }]);
      await g(`${kind}-late-memory`, async () => { const got = await f.durable(owner, ctx, fx.own.id, late, answer); assert.equal(got.http.body.projectId, fx.p.id); assert.deepEqual(f.projection(got.http.body.messages), f.projection(origin)); return got; });
      const question = kind === "edit" ? `rejected-edit-redo-${ctx.label}` : q, count = reads.length;
      if (kind === "edit") { c.plans.set(question, [{ frames: [{ content: "Rejected edit redo" }], holdOnly: true }]); await owner.editLastMessage(q, question); } else await owner.clickRegenerate();
      await waitActive(question, kind === "edit" ? 1 : 2);
      await g(`${kind}-consumer-context`, async () => consume(question, fx.own, fx.p.id, count));
      c.release(question, [{ memory_update: f.blob(`${kind}-redo-final`) }, f.done]);
      await g(`${kind}-settles`, async () => { const got = await f.durable(owner, ctx, fx.own.id, f.blob(`${kind}-redo-final`), `Rejected ${kind} redo`); assert.equal(got.http.body.projectId, fx.p.id); assert.equal(got.http.body.assistantId, ctx.ids.soul); assert.deepEqual(f.projection(got.http.body.messages).slice(0, fx.own.base.length), f.projection(fx.own.base)); return got; });
      await rec.screenshot(owner.page, `rejection-${kind}-settled`);
    }
    const success = await fixture(ctx, owner.cookie, member, "Success control"); await open(success.own);
    await g("success-detach", async () => { const before = rawState(ctx); await native(success.p, "accept"); assert.ok(await pollUntil(() => acks.some(a => a.method === "DELETE" && a.path === `/api/me/projects/${success.p.id}` && a.status === 200), 10000));
      assertDeleteOnly(before, rawState(ctx), success.p.id); assert.ok(await pollUntil(() => appLog().includes(`DELETE /api/me/projects/${success.p.id} 200`), 5000), "healthy actual DELETE must appear in the same server log"); await closeSidebar(); await frames(); return { before, after: rawState(ctx), loggedServerSuccess: true }; });
    const successQ = success.own.base[0].content, count = reads.length; c.plans.set(successQ, [{ frames: [{ content: "Success control redo" }], holdOnly: true }]); await owner.clickRegenerate(); await waitActive(successQ, 1);
    await g("success-consumer", async () => consume(successQ, success.own, null, count, [])); c.release(successQ, [{ memory_update: f.blob("success-final") }, f.done]);
    await g("success-settles", async () => { const got = await f.durable(owner, ctx, success.own.id, f.blob("success-final"), "Success control redo"); assert.equal(got.http.body.projectId, null); return got; });
    await pollUntil(() => writes.length === acks.length + failures.length, 10000);
    await g("operation-outcomes", async () => { assert.equal(failures.length, 2); assert.equal(injected.length, 2); assert.ok(injected.every(r => r.intercepted && r.aborted));
      assert.equal(writes.length, acks.length + failures.length); assert.ok(acks.every(a => a.status === 200));
      for (const failure of failures) { assert.equal(failure.error, "net::ERR_FAILED"); assert.equal(writes.filter(w => w.path === failure.path && w.method === "DELETE").length, 1); assert.equal(acks.filter(a => a.path === failure.path).length, 0); assert.equal(appLog().includes(`DELETE ${failure.path} `), false); }
      for (const ack of acks) assert.ok(writes.some(w => w.path === ack.path && w.method === ack.method && JSON.stringify(w.body) === JSON.stringify(ack.body)));
      return { writes, acknowledgments: acks, expectedTransportFailures: failures }; });
  } finally {
    for (const b of barriers) await b.close();
    ctx.check("browser.no-page-errors", !owner.pageErrors.length, owner.pageErrors); ctx.check("browser.no-blocked-requests", !owner.blocked.length, owner.blocked);
    ctx.check("browser.responses-drained", !c.held.length && !c.unmatched.length && !ctx.upstream.pending.size, { held: c.held, unmatched: c.unmatched });
    writeFileSync(join(rec.dir, "rejection-observations.json"), JSON.stringify({ dialogs, writes, acknowledgments: acks, expectedTransportFailures: failures, injected, asks, reads, projectReads, patches: rec.patches, observations: rec.observations }, null, 2));
    await owner.close();
  }
}
