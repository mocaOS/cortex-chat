// move-positive-list-v1.1: the delayed positive project-list ordering schedule
// on top of the reverse commit order. Native move A is captured and HELD BEFORE
// route.fetch/forwarding (no dispatch, no commit, no acknowledgment); native
// move B commits and is acknowledged while A remains unforwarded. While A is
// still unforwarded, the page's OWN genuine GET /api/me/projects response that
// contains the selected chat positively in target B is captured with its real
// bytes and HELD from delivery (browser-owned request; the handler only
// fulfills actual responses, never fabricated state). A is then released: it
// forwards, commits last and is acknowledged last; a newer genuine A-positive
// list response captured after commit A is delivered; only then is the older
// B-positive response delivered LAST. After that delivery a scoped
// unavailable-refresh observation window begins: every further genuine
// GET /api/me/projects response is still captured with its real bytes, but its
// DELIVERY is failed with an actual route.abort("failed") — the page's
// documented guarded refresh catch keeps the existing project list (no
// repairing association is provided, no product state is injected), and the
// per-chat write chain (persistSession → refreshSessions) resolves through that
// supported catch so queued saves proceed. Holding instead of failing would
// deadlock: the pending refresh never resolves and the queued regenerate/edit
// saves never dispatch. Releasing holds between consumer windows instead would
// repair the context before the edit dispatch and destroy its independent
// discrimination. Within the fail-delivery window, every observed request
// failure must be a strictly scoped expected GET /api/me/projects delivery
// failure (observed abort reason) correlated via request-object identity to its
// captured entry; chat-write transport failures must be zero. Pre-window
// request failures (native cancellations from deliberate navigation/reload,
// e.g. cancelled SSE or reads) are retained diagnostics outside the induced
// fail-window — no global network guarantee and no blanket health claim.
// v1.1 correction (pre-freeze, after v1 run a 25/26, exit1; no product value
// rejection): v1's phase-local accounting also rejected two in-window
// GET /api/me/chats/<selected>/events net::ERR_ABORTED records produced by the
// page's own isLoading-effect cleanup es.close() (page.tsx events effect
// cleanup) at the regenerate/edit loading teardowns — native cancellations of
// the selected chat's own open feed, not repairing reads and not product
// defects. v1.1 instruments every actual EventSource (unique page-local seq,
// created/open/error/close times, closeInvoked) in __followupFeeds, snapshots
// the actual browser close records at judgment time as the phase proof (never
// later retained SQLite), and permits an in-window ERR_ABORTED ONLY for the
// EXACT selected-chat events URL matched one-to-one (time-ordered, bounded 2s
// transport event delay) to an actual intentional close invocation; closes
// without an observed failure are retained diagnostics, not asserted healthy;
// projects GET expected aborts remain object-sequence matched; any other
// in-window failure still rejects; all writes 200 and the no chat-document GET
// rules are unchanged. Direct regenerate/edit consumers must
// consume the observed final association A (its injected instructions, not
// B's), the original immutable pre-turn memory and exact displayed prefix with
// no repairing chat GET — and no list response captured after the old delivery
// may reach the page before those consumer assertions. Both moves stay accepted
// under unchanged atomic full-snapshot LWW; no latest-start-wins, CAS,
// stale-write rejection or merged-history rule is asserted or implied.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController, pollUntil, setAppLocale } from "./chat-browser-checks";
import { projectFixture as f } from "./chat-project-followup-checks";
import { assertMoveOnly } from "./chat-project-move-checks";

export const POSITIVE_LIST_GATES = ["browser.login-dark-en-de", "browser.cancel-no-write", "browser.single-move-control",
  "browser.held-ack-navigation-control", "browser.held-ack-consumer-context", "browser.held-ack-consumer-settles",
  "browser.trigger-notifications",
  "browser.positive-a-held-preforward", "browser.positive-b-commit-ack", "browser.positive-b-list-captured-held",
  "browser.positive-a-release-commit-ack-last", "browser.positive-a-list-newer-delivered",
  "browser.positive-old-b-delivered-last", "browser.positive-schedule-ordering", "browser.positive-late-compaction",
  "browser.positive-regenerate-at-send", "browser.positive-regenerate-settles",
  "browser.positive-edit-at-send", "browser.positive-edit-settles", "browser.no-repairing-list-after-old-b",
  "browser.acknowledgments", "browser.no-page-errors", "browser.no-blocked-requests", "browser.responses-drained"];
function state(ctx: any, id: string) {
  const require = createRequire(join(ctx.appDir, "package.json")), Database = require("better-sqlite3");
  const db = new Database(join(ctx.dataDir, "cortex-chat.db"), { readonly: true, fileMustExist: true });
  try { return { session: db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id),
    messages: db.prepare("SELECT * FROM chat_messages WHERE chat_session_id = ? ORDER BY created_at,rowid").all(id) }; } finally { db.close(); }
}
const patchLines = (segment: string, id: string) => segment.split(`PATCH /api/me/chats/${id}`).length - 1;
async function target(ctx: any, cookie: string, name: string, instructions: string, shareTo: string) {
  const p = (await f.json(ctx, "/api/me/projects", cookie, "POST", { name, instructions })).project;
  await f.json(ctx, `/api/me/projects/${p.id}/shares`, cookie, "PUT", { shares: [{ userId: shareTo }] });
  return p;
}
async function ownChat(ctx: any, cookie: string, title: string) {
  const id = (await f.json(ctx, "/api/me/chats", cookie, "POST", { title, assistantId: ctx.ids.soul })).id, pre = f.blob(`${title}-pre`);
  const base = f.pair(`fx-positive-${title}-${ctx.label}`, title).map((m: any) => m.role === "assistant" ? { ...m,
    feedback: "up", thinking: ["Retained reasoning"], sources: [{ document_id: "fx-positive-source", chunk_id: "fx-positive-chunk",
      sid: "fx-positive-stable-sid", content: "Retained source", score: 0.42, metadata: { filename: "move-positive-list-fixture.md" } }] } : m);
  await f.patch(ctx, cookie, id, base, pre);
  return { id, title, pre, base };
}
export async function runPositiveListBrowser(ctx: any) {
  const rec = new Recorder(join(ctx.workDir, "logs")), tool = browserPrerequisites(); assert.deepEqual(tool.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(tool.pwPath, "index.js")), owner = new BrowserSession(pw, tool.chromiumPath, ctx.baseUrl, rec), c = makeUpstreamController(ctx);
  for (const [path, name] of [["src/app/page.tsx", "page.tsx"], ["src/components/Sidebar.tsx", "Sidebar.tsx"], ["src/lib/chatHistory.ts", "chatHistory.ts"]]) copyFileSync(join(ctx.appDir, path), join(rec.dir, name));
  writeFileSync(join(rec.dir, "tooling.json"), JSON.stringify({ ...tool, version: JSON.parse(readFileSync(join(tool.pwPath, "package.json"), "utf8")).version, tmpdir: process.env.TMPDIR, install: false }, null, 2));
  const writes: any[] = [], acks: any[] = [], failures: any[] = [], requestFailedAll: any[] = [], asks: any[] = [], reads: any[] = [], dialogs: any[] = [], holds: any[] = [], consumers: any[] = [], stateSamples: any[] = [], consoleErrors: any[] = [], schedules: any[] = [], listResponses: any[] = [], listHolds: any[] = [], feedSnapshots: any[] = [];
  // Request-object identity → captured list-entry sequence, so an observed
  // requestfailed record can be correlated to the exact intercepted entry.
  const requestObjects = new WeakMap<object, number>();
  let listFailDelivery = false, listFailDeliveryAt: number | null = null, listHoldPredicate: null | ((entry: any) => boolean) = null;
  const listMatcher = `${ctx.baseUrl}/api/me/projects`;
  // Browser-owned list capture: every GET /api/me/projects is the page's own
  // request; the handler reserves it, fetches the actual response and retains
  // the real bytes. Matching entries are held (predicate: first B-positive
  // response while A is unforwarded); after the old delivery, every further
  // response is captured then its DELIVERY failed with route.abort("failed"),
  // so no repairing list can reach the page while queued saves still proceed.
  // Nothing here fabricates state: HTTP/SQLite reads elsewhere in this gate are
  // observational only.
  const listHandler = async (route: any) => {
    if (route.request().method() !== "GET") return route.fallback();
    const entry: any = { sequence: listResponses.length + 1, actor: "owner-browser", requestedAt: Date.now(), delivered: false };
    listResponses.push(entry);
    requestObjects.set(route.request(), entry.sequence);
    const response = await route.fetch();
    entry.status = response.status();
    entry.rawBytes = await response.text();
    entry.body = JSON.parse(entry.rawBytes);
    entry.capturedAt = Date.now();
    entry.projects = (entry.body?.projects ?? []).map((p: any) => ({ id: p.id, name: p.name, chatIds: (p.chats ?? []).map((ch: any) => ch.id) }));
    entry.positive = (projectId: string, chatId: string) => entry.projects.some((p: any) => p.id === projectId && p.chatIds.includes(chatId));
    const predMatch = !!(listHoldPredicate && listHoldPredicate(entry));
    if (predMatch) listHoldPredicate = null;
    if (predMatch) {
      let release!: () => void; const barrier = new Promise<void>(r => release = r);
      entry.release = release; listHolds.push(entry);
      await barrier;
      await route.fulfill({ response });
      entry.delivered = true; entry.deliveredAt = Date.now();
    } else if (listFailDelivery) {
      // Scoped unavailable-refresh observation window (see header): the genuine
      // bytes are captured above, but the delivery itself fails with an actual
      // route.abort("failed"); the page's guarded refresh catch retains the
      // existing project list and the per-chat write chain resolves.
      entry.failDelivery = true;
      await route.abort("failed");
      entry.aborted = true; entry.abortedAt = Date.now();
    } else {
      await route.fulfill({ response });
      entry.delivered = true; entry.deliveredAt = Date.now();
    }
  };
  const listBarriers = { close: async () => { for (const e of listHolds) e.release?.(); if (owner.context) await owner.context.unroute(listMatcher, listHandler); } };
  const g = (id: string, fn: () => Promise<any>) => f.gate(ctx, `browser.${id}`, fn), log = () => readFileSync(join(ctx.workDir, "logs", "app-dev.log"), "utf8");
  const chatId = (path: string) => decodeURIComponent(path.split("/").pop()!);
  try {
    await owner.start();
    await owner.context.addInitScript(() => { const Original = window.EventSource; (window as any).__followupFeeds = []; let feedSeq = 0; window.EventSource = class extends Original { row: any;
      constructor(url: string | URL, init?: EventSourceInit) { super(url, init); this.row = { seq: ++feedSeq, url: String(url), ready: 0, closed: false, createdAt: Date.now(), openedAt: null as number | null, erroredAt: null as number | null, closedAt: null as number | null, closeInvoked: false }; (window as any).__followupFeeds.push(this.row); this.addEventListener("open", () => { this.row.ready = this.readyState; this.row.openedAt = Date.now(); }); this.addEventListener("error", () => { this.row.ready = this.readyState; this.row.erroredAt = Date.now(); }); } close() { this.row.closeInvoked = true; this.row.closedAt = Date.now(); this.row.closed = true; this.row.ready = 2; super.close(); } }; });
    owner.page.on("console", (m: any) => { if (m.type() === "error") consoleErrors.push({ text: m.text(), location: m.location(), at: Date.now() }); });
    owner.context.on("request", (r: any) => { const path = new URL(r.url()).pathname, method = r.method();
      if (method === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(path)) writes.push({ actor: "owner-browser", path, method, chatId: chatId(path), body: r.postDataJSON(), at: Date.now() });
      if (method === "GET" && /^\/api\/me\/chats\/[^/]+$/.test(path)) reads.push({ actor: "owner-browser", path, chatId: chatId(path), at: Date.now() });
      if (path === "/api/ask/stream") asks.push({ actor: "owner-browser", id: r.headers()["x-request-id"], body: r.postDataJSON(), at: Date.now() }); });
    owner.context.on("requestfailed", (r: any) => { const path = new URL(r.url()).pathname;
      const record = { path, method: r.method(), error: r.failure()?.errorText ?? null, at: Date.now(), listSequence: requestObjects.get(r) ?? null };
      requestFailedAll.push(record);
      if (/^\/api\/me\/chats\/[^/]+$/.test(path)) failures.push(record); });
    owner.context.on("response", (r: any) => { const path = new URL(r.url()).pathname, method = r.request().method();
      if (method === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(path)) acks.push({ actor: "owner-browser", path, chatId: chatId(path), body: r.request().postDataJSON(), status: r.status(), at: Date.now() }); });
    await owner.context.route(listMatcher, listHandler);
    await owner.login(ctx, ctx.users.owner.email, ctx.users.owner.password); const member = await f.login(ctx, "member");
    const sidebar = async () => { if (!await owner.drawer().isVisible()) { await owner.page.locator('button[aria-label="Toggle sidebar"], button[aria-label="Seitenleiste umschalten"]').click(); await owner.drawer().waitFor({ state: "visible", timeout: 30000 }); } };
    const closeSidebar = async () => { if (await owner.drawer().isVisible()) await owner.drawer().locator("button").first().click(); };
    const row = (text: string) => owner.drawer().getByText(text, { exact: true }).locator("..");
    const frames = () => owner.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const readyUser = async () => assert.ok(await pollUntil(() => owner.page.evaluate(() => (window as any).__followupFeeds.some((r: any) => r.url === "/api/me/events" && !r.closed && r.ready === 1)), 15000));
    const settleQuiet = async () => { assert.ok(await pollUntil(() => listResponses.every(e => e.delivered) && writes.length === acks.length, 10000)); await frames(); };
    const CONSENT_EN = "This project is shared — all members will be able to read this chat's entire history and continue the conversation. Move it?";
    const CONSENT_DE = "Dieses Projekt ist geteilt — alle Mitglieder können den gesamten Verlauf dieses Chats lesen und die Unterhaltung fortsetzen. Verschieben?";
    const drag = async (title: string, destination: string | null, decision: "accept" | "dismiss", opts: { locale?: "en" | "de"; expandFolder?: string } = {}) => {
      await sidebar();
      // Adapter note: the moved chat legitimately renders in either of two supported
      // source locations — the personal flat row (no association commit has been
      // observed for a pending gesture held before forwarding) or, after an observed
      // commit's own project-channel event refresh, inside the possibly collapsed
      // committed folder. The adapter resolves the visible row as-is and clicks the
      // declared folder only when the flat row is not visible; it never forces a
      // sidebar read or folder refresh and never rewrites product state.
      let source = row(title);
      if (opts.expandFolder && !await source.isVisible()) { await row(opts.expandFolder).click(); await source.waitFor({ state: "visible", timeout: 10000 }); source = row(title); }
      const dest = destination ? row(destination) : owner.drawer().locator("div.min-h-\\[80px\\]");
      assert.equal(await source.getAttribute("draggable"), "true");
      await source.scrollIntoViewIfNeeded(); await dest.scrollIntoViewIfNeeded();
      const handled = new Promise<void>((resolve, reject) => owner.page.once("dialog", async (d: any) => { try {
        assert.equal(d.type(), "confirm"); assert.equal(d.message(), opts.locale === "de" ? CONSENT_DE : CONSENT_EN);
        dialogs.push({ type: d.type(), text: d.message(), chat: title, destination, decision, locale: opts.locale ?? "en", at: Date.now() });
        await d[decision](); resolve();
      } catch (e) { await d.dismiss().catch(() => {}); reject(e); } }));
      await source.dragTo(dest);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([handled, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("native move consent was not observed within15s")), 15000); })]); }
      finally { if (timer) clearTimeout(timer); }
    };
    const waitActive = async (question: string, count: number) => assert.ok(await pollUntil(() => {
      const b = asks.filter(a => a.body.question === question), u = ctx.upstream.requests.filter((r: any) => r.body?.question === question);
      return b.length === count && u.length === count && b.at(-1).id === u.at(-1).id && ctx.upstream.pending.has(u.at(-1).id) && c.held.some(h => h.id === u.at(-1).id);
    }, 15000), "the redo must correlate with its own genuinely held active upstream operation");
    const consume = (question: string, chat: any, projectId: string | null, readCount: number, prefix: any[], allowedInstructions: string[], forbiddenInstructions: string[]) => {
      const browser = asks.filter(a => a.body.question === question).at(-1), upstream = ctx.upstream.requests.filter((r: any) => r.body?.question === question).at(-1);
      assert.ok(browser && upstream); assert.equal(browser.id, upstream.id, "browser and upstream operation IDs must correlate");
      const raw = browser.body, sent = upstream.body;
      const selectedChat = new URL(owner.page.url()).searchParams.get("chat");
      assert.equal(selectedChat, chat.id, "the direct consumer must dispatch from the captured selected view identity");
      assert.equal(raw.session_id, chat.id);
      assert.equal(raw.project_id, projectId, "the direct consumer must consume the current observed authoritative association");
      assert.equal(raw.assistant_id, ctx.ids.soul);
      // Personality scope: this gate asserts the consumer's soul *association*
      // (assistant_id) and the upstream-injected project instructions that
      // discriminate the actual observed target; the upstream soul-body
      // injection mechanism itself is not re-verified here — same accepted
      // reverse v1.1 scope, not a weakened or new obligation.
      assert.deepEqual(raw.conversation_memory, chat.pre);
      assert.deepEqual(sent.conversation_memory, chat.pre);
      assert.deepEqual(raw.conversation_history, prefix.map((m: any) => ({ role: m.role, content: m.content })));
      assert.equal(reads.length, readCount, "no repairing browser chat GET in the judged no-repair window (for the first direct consumer: from before the old list delivery through this held-redo dispatch; for the second: its own pre-dispatch window)");
      const sentText = JSON.stringify(sent);
      for (const allow of allowedInstructions) assert.ok(sentText.includes(allow), `upstream injected context must carry the actual observed target's instructions (${allow})`);
      for (const forbid of forbiddenInstructions) assert.equal(sentText.includes(forbid), false, `upstream injected context must not carry another target's instructions (${forbid})`);
      const observation = { question, chatId: chat.id, selectedChat, expectedProjectId: projectId, allowedInstructions, forbiddenInstructions, personalityScope: "assistant_id association asserted; upstream soul-body injection mechanism not re-verified (accepted reverse v1.1 scope)", raw, sent, activeOperationId: upstream.id, readsAtJudgment: reads.length };
      consumers.push(observation);
      return observation;
    };
    // Modes: "preforward" reserves the actual PATCH and holds it BEFORE
    // route.fetch/forwarding (no server dispatch, response or acknowledgment);
    // "hold" is the retained held-after-response mode (genuine commit captured,
    // response withheld from the browser); "pass" forwards immediately.
    const holdMove = async (chatIdValue: string, projectId: string, mode: "preforward" | "hold" | "pass") => {
      const matcher = `${ctx.baseUrl}/api/me/chats/${chatIdValue}`;
      const held: any = { sequence: holds.length + 1, actor: "owner-browser", chatId: chatIdValue, projectId, mode, captured: null, reserved: false, fetched: false, forwardReleasedAt: null, status: null, body: null, rawBytes: null, commitObservedAt: null, released: false, delivered: false, deliveredAt: null, finished: false, releaseForward: null, release: null };
      const handler = async (route: any) => {
        const request = route.request();
        if (request.method() !== "PATCH" || request.postDataJSON()?.projectId !== projectId || held.finished || held.reserved) return route.fallback();
        held.reserved = true;
        held.captured = { at: Date.now(), chatId: chatIdValue, body: request.postDataJSON() };
        rec.patches.push({ t: new Date().toISOString(), chatId: chatIdValue, body: request.postDataJSON() });
        rec.appendJsonl("browser-patch-bodies.jsonl", { ...held.captured, actor: held.actor, sequence: held.sequence, mode: held.mode });
        if (mode === "preforward") { let releaseForward!: () => void; const barrier = new Promise<void>(r => releaseForward = r); held.releaseForward = releaseForward; await barrier; held.forwardReleasedAt = Date.now(); }
        const response = await route.fetch();
        held.fetched = true; held.status = response.status(); held.rawBytes = await response.text(); held.body = JSON.parse(held.rawBytes); held.commitObservedAt = Date.now();
        if (mode === "hold") { let release!: () => void; const barrier = new Promise<void>(r => release = r); held.release = release; await barrier; held.released = true; }
        await route.fulfill({ response });
        held.delivered = true; held.deliveredAt = Date.now(); held.finished = true;
      };
      await owner.context.route(matcher, handler);
      const barrier = { row: held, close: async () => { held.releaseForward?.(); held.release?.(); await owner.context.unroute(matcher, handler); } };
      holds.push(barrier);
      return held;
    };
    const sample = (phase: string, value: any) => { const entry = { phase, at: Date.now(), state: value }; stateSamples.push(entry); return entry; };
    const requireGate = (id: string) => { const row0 = ctx.checks.find((c0: any) => c0.id === id); if (!row0 || row0.ok !== true) throw new Error(`prerequisite gate ${id} not met (${row0 ? "failed" : "missing"}); stopping dependent sequence, failure preserved`); };
    let oldB: any, newListA: any, noRepairReads = 0;

    await g("login-dark-en-de", async () => {
      assert.equal((await f.json(ctx, "/api/auth/me", owner.cookie)).id, ctx.users.owner.id);
      assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de");
      try { await owner.page.reload(); await owner.waitForComposer(); assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research..."); await rec.screenshot(owner.page, "positive-dark-de"); }
      finally { setAppLocale(ctx.dataDir, "en"); }
      await owner.page.reload(); await owner.waitForComposer();
      return { locales: ["de", "en"], actor: "owner browser form login; member via HTTP" };
    });
    const instructionsA = `Positive-list target A shared instructions ${ctx.label}`;
    const instructionsB = `Positive-list target B shared instructions ${ctx.label}`;
    const projA = await target(ctx, owner.cookie, "Positive-list target A", instructionsA, ctx.users.member.id);
    const projB = await target(ctx, owner.cookie, "Positive-list target B", instructionsB, ctx.users.member.id);
    const single = await ownChat(ctx, owner.cookie, "Positive-list single-move chat");
    const overlap = await ownChat(ctx, owner.cookie, "Positive-list moved chat");
    const navChat = await ownChat(ctx, owner.cookie, "Positive-list navigation chat");
    const viewDest = await ownChat(ctx, owner.cookie, "Positive-list view destination");
    const signalId = (await f.json(ctx, "/api/me/chats", owner.cookie, "POST", { title: "Positive-list trigger signal", projectId: projB.id })).id;
    const signalBase = f.pair(`fx-positive-trigger-${ctx.label}`, "Positive trigger");
    await owner.page.goto(`${ctx.baseUrl}/?chat=${single.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, single.base[1].content));
    await g("cancel-no-write", async () => {
      const before = state(ctx, single.id), w = writes.length, d = dialogs.length;
      setAppLocale(ctx.dataDir, "de");
      try { await owner.page.reload(); await owner.waitForComposer();
        await drag(single.title, projA.name, "dismiss", { locale: "de" });
        assert.deepEqual(state(ctx, single.id), before);
        assert.equal(writes.length, w);
        assert.equal(dialogs.length, d + 1);
        assert.equal(dialogs.at(-1).text, CONSENT_DE);
        await rec.screenshot(owner.page, "positive-dark-de-cancel");
      } finally { setAppLocale(ctx.dataDir, "en"); }
      await owner.page.reload(); await owner.waitForComposer();
      return { before, after: state(ctx, single.id), nativeConsent: dialogs.at(-1), attemptedWrites: 0 };
    });
    await g("single-move-control", async () => {
      const before = sample("single-before", state(ctx, single.id)).state, w = writes.length;
      await drag(single.title, projA.name, "accept");
      assert.ok(await pollUntil(() => acks.some(a => a.chatId === single.id && a.body?.projectId === projA.id && a.status === 200), 10000), "healthy single move must be acknowledged 200");
      assertMoveOnly(before, state(ctx, single.id), projA.id);
      assert.equal(writes.length, w + 1);
      const memberRead = await f.json(ctx, `/api/me/chats/${single.id}`, member);
      assert.equal(memberRead.projectId, projA.id);
      sample("single-after", state(ctx, single.id));
      await closeSidebar();
      return { before, after: state(ctx, single.id), attempts: 1, acknowledged200: true, memberFreshRead: { status: 200, projectId: memberRead.projectId } };
    });
    await owner.page.goto(`${ctx.baseUrl}/?chat=${navChat.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, navChat.base[1].content));
    const navBefore = state(ctx, navChat.id), navHold = await holdMove(navChat.id, projB.id, "hold");
    await g("held-ack-navigation-control", async () => {
      await drag(navChat.title, projB.name, "accept");
      assert.ok(await pollUntil(() => navHold.fetched && navHold.status === 200 && state(ctx, navChat.id).session.project_id === projB.id, 10000));
      assert.deepEqual(navHold.body, { ok: true });
      assert.equal(navHold.delivered, false, "navigation must happen while the acknowledgment is still held");
      assertMoveOnly(navBefore, state(ctx, navChat.id), projB.id);
      sample("navigation-commit-held", state(ctx, navChat.id));
      await sidebar(); await row(viewDest.title).click();
      assert.ok(await pollUntil(() => new URL(owner.page.url()).searchParams.get("chat") === viewDest.id, 10000));
      assert.ok(await f.visible(owner, viewDest.base[1].content));
      navHold.release();
      assert.ok(await pollUntil(() => navHold.delivered, 5000));
      await frames();
      assert.equal(new URL(owner.page.url()).searchParams.get("chat"), viewDest.id, "the late acknowledgment must not navigate");
      assertMoveOnly(navBefore, state(ctx, navChat.id), projB.id);
      await rec.screenshot(owner.page, "positive-held-ack-after-navigation");
      // Adapter note: the viewDest row click already closes the drawer via the
      // product's own onClose; the explicit close below makes that closure a
      // declared prerequisite for the following regenerate hover instead of an
      // incidental one. Closing is pure local drawer state — no chat GET, so it
      // cannot repair the refs the consumer is about to be judged on.
      await closeSidebar(); await frames();
      return { chatId: navChat.id, heldResponse: { status: navHold.status, body: navHold.body, rawBytes: navHold.rawBytes }, commit: state(ctx, navChat.id), navigationTarget: viewDest.id, acknowledgmentDeliveredAfterNavigation: true };
    });
    const navRedoQ = viewDest.base[0].content;
    c.plans.set(navRedoQ, [{ frames: [{ content: "Positive-list navigation-view redo" }], holdOnly: true }]);
    const navReads = reads.length;
    await owner.clickRegenerate(); await waitActive(navRedoQ, 1);
    await g("held-ack-consumer-context", async () => consume(navRedoQ, viewDest, null, navReads, [], [], [instructionsA, instructionsB]));
    c.release(navRedoQ, [{ memory_update: f.blob("positive-nav-redo-final") }, f.done]);
    await g("held-ack-consumer-settles", async () => {
      const got = await f.durable(owner, ctx, viewDest.id, f.blob("positive-nav-redo-final"), "Positive-list navigation-view redo");
      assert.equal(got.http.body.projectId, null);
      return got;
    });
    await closeSidebar(); await frames();
    await g("trigger-notifications", async () => {
      await readyUser();
      await settleQuiet();
      const beforeMemoryOnly = listResponses.length;
      await f.json(ctx, `/api/me/chats/${signalId}`, member, "PATCH", { memory: f.blob(`positive-trigger-memory-only-${ctx.label}`) });
      await settleQuiet();
      await new Promise(resolve => setTimeout(resolve, 1500));
      const afterMemoryOnly = listResponses.length;
      assert.equal(afterMemoryOnly, beforeMemoryOnly, "memory-only persistence publishes only the chat channel; the page's consumed user/project feed must not trigger a project-list refresh");
      const beforeMessages = listResponses.length;
      await f.json(ctx, `/api/me/chats/${signalId}`, member, "PATCH", { messages: signalBase, memory: f.blob(`positive-trigger-messages-${ctx.label}`) });
      assert.ok(await pollUntil(() => listResponses.length > beforeMessages && listResponses.at(-1).delivered, 10000), "an auxiliary messages+memory write must publish the project notification the page actually consumes");
      await settleQuiet();
      return { memoryOnlyRefreshes: afterMemoryOnly - beforeMemoryOnly, messagesMemoryRefreshes: listResponses.length - beforeMessages, signalChatId: signalId, triggerProjectId: projB.id };
    });
    await owner.page.goto(`${ctx.baseUrl}/?chat=${overlap.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, overlap.base[1].content));
    const q = `positive-origin-${ctx.label}`, answer = "Positive-list origin completed answer", late = f.blob("positive-origin-late");
    c.plans.set(q, [{ frames: [{ content: answer }, f.done], holdMemoryBlob: late }, { frames: [{ content: "Positive-list regenerated redo" }], holdOnly: true }]);
    await owner.send(q); await owner.waitAnswerVisible(answer);
    const origin = (await f.durable(owner, ctx, overlap.id, overlap.pre, answer)).http.body.messages;
    await waitActive(q, 1);
    const baseline = sample("positive-baseline", state(ctx, overlap.id)).state;
    const holdA = await holdMove(overlap.id, projA.id, "preforward");
    const logOffsetPreA = log().length;
    await g("positive-a-held-preforward", async () => {
      await drag(overlap.title, projA.name, "accept");
      assert.ok(await pollUntil(() => holdA.reserved && !holdA.fetched && !holdA.delivered, 10000), "A's actual PATCH must be captured once and held before any forwarding");
      const unchanged = sample("positive-a-captured-state-unchanged", state(ctx, overlap.id)).state;
      assert.deepEqual(unchanged, baseline, "no A commit while held before forwarding: exact unchanged full raw state");
      assert.equal(holdA.fetched, false, "A has not been forwarded: no route.fetch issued");
      assert.equal(holdA.delivered, false);
      assert.equal(holdA.status, null, "no response captured for A while held before forwarding");
      assert.equal(holdA.rawBytes, null, "no raw producer response bytes captured for A while held before forwarding");
      assert.equal(holdA.forwardReleasedAt, null, "A's forward has not been released while held before forwarding");
      // The A-move acknowledgment predicate is scoped to the move itself
      // (captured PATCH body carries projectId A): the same chat's earlier
      // accepted origin-history persistence save is a different acknowledged
      // write and must not count here (reverse v1 a's known evaluator pitfall).
      assert.equal(acks.some(a => a.chatId === overlap.id && a.body?.projectId === projA.id), false, "no browser acknowledgment for the A move while held before forwarding");
      const segment = log().slice(logOffsetPreA);
      assert.equal(patchLines(segment, overlap.id), 0, "no matching server dispatch in the operation-local pre-A log segment while A is held before forwarding");
      await rec.screenshot(owner.page, "positive-a-held-preforward");
      return { baseline, unchanged, logOffsetPreA, captured: holdA.captured, mode: holdA.mode, forwarded: holdA.fetched, forwardReleasedAt: holdA.forwardReleasedAt, status: holdA.status, rawBytes: holdA.rawBytes, browserAcknowledgment: "not delivered for the A move (chat-level earlier persistence acks excluded by the move-scoped predicate)", preALogSegmentPatchLines: 0 };
    });
    requireGate("browser.positive-a-held-preforward");
    const holdB = await holdMove(overlap.id, projB.id, "pass");
    // Arm the list hold BEFORE B is dispatched: the first genuine response that
    // contains the selected chat positively in B is necessarily post-commit-B
    // and therefore captured while A is still unforwarded.
    listHoldPredicate = (entry: any) => entry.positive(projB.id, overlap.id);
    let logOffsetAtRelease: number | null = null;
    await g("positive-b-commit-ack", async () => {
      assert.ok(holdA.reserved && holdA.fetched === false && holdA.delivered === false, "prerequisite: A captured and still held before forwarding");
      // Adapter note: A is held before forwarding, so no A commit/ack exists and
      // the page's own guarded refresh has no association event to consume; the
      // chat legitimately remains in the personal flat row. The declared folder
      // click below runs only if that row is not visible; it never refreshes the
      // sidebar or rewrites product state.
      await drag(overlap.title, projB.name, "accept", { expandFolder: projA.name });
      assert.ok(await pollUntil(() => holdB.fetched && holdB.status === 200 && holdB.delivered && state(ctx, overlap.id).session.project_id === projB.id, 10000), "B must be genuinely forwarded, committed and acknowledged while A remains held before forwarding");
      const committedB = sample("positive-commit-B", state(ctx, overlap.id)).state;
      assert.deepEqual(holdB.body, { ok: true });
      assert.ok(typeof holdB.rawBytes === "string" && holdB.rawBytes.length > 0, "genuine producer response bytes must be retained for B");
      assert.equal(holdA.fetched, false, "A must still be unforwarded while B commits and is acknowledged");
      assert.equal(holdA.delivered, false, "A must still be unacknowledged while B commits and is acknowledged");
      assertMoveOnly(baseline, committedB, projB.id);
      assert.ok(await pollUntil(() => acks.some(a => a.chatId === overlap.id && a.body?.projectId === projB.id && a.status === 200), 5000), "B's real 200 acknowledgment must be delivered to the browser before A is released");
      assert.ok(await pollUntil(() => log().slice(logOffsetPreA).includes(`PATCH /api/me/chats/${overlap.id} 200`), 5000), "a healthy actual PATCH 200 must appear in the same diagnostic channel while A is held — the absence claim for A is only meaningful against a live channel");
      logOffsetAtRelease = log().length;
      const segmentB = log().slice(logOffsetPreA, logOffsetAtRelease);
      assert.equal(patchLines(segmentB, overlap.id), 1, "the operation-local segment while A is held must contain exactly the one healthy B dispatch and no A dispatch");
      await rec.screenshot(owner.page, "positive-commit-b-acked");
      return { committedB, heldA: { reserved: holdA.reserved, fetched: holdA.fetched, delivered: holdA.delivered }, bResponse: { status: holdB.status, body: holdB.body, rawBytes: holdB.rawBytes }, ackBDeliveredBeforeRelease: true, healthyChannelControl: { segment: segmentB, matchingPatchLines: 1 } };
    });
    requireGate("browser.positive-b-commit-ack");
    await g("positive-b-list-captured-held", async () => {
      assert.ok(await pollUntil(() => listResponses.some(e => e.positive?.(projB.id, overlap.id)), 10000), "a genuine browser-owned GET /api/me/projects response containing the selected chat positively in B must be captured while A remains unforwarded");
      oldB = listResponses.filter((e: any) => e.positive?.(projB.id, overlap.id))[0];
      assert.ok(oldB, "the older B-positive list response must be identified");
      assert.equal(oldB.status, 200);
      assert.equal(oldB.delivered, false, "the B-positive list response must be HELD from browser delivery");
      assert.ok(typeof oldB.rawBytes === "string" && oldB.rawBytes.length > 0, "genuine raw response bytes must be retained for the old B list");
      assert.ok(oldB.capturedAt > holdB.commitObservedAt, "the old B list capture must follow commit B (its membership is the observed association)");
      const ackB = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projB.id);
      assert.ok(ackB, "B's browser acknowledgment must exist");
      assert.ok(oldB.capturedAt > ackB.at, "the old B list capture must follow B's browser acknowledgment");
      assert.equal(oldB.positive?.(projA.id, overlap.id), false, "the older B-positive list must exclude A membership for the selected chat (captured before commit A)");
      assert.equal(holdA.fetched, false, "A is still unforwarded at the old B list capture");
      assert.equal(state(ctx, overlap.id).session.project_id, projB.id, "storage association is B at the old B list capture");
      assert.equal(new URL(owner.page.url()).searchParams.get("chat"), overlap.id, "selected view identity is the moved chat");
      await rec.screenshot(owner.page, "positive-b-list-held");
      return { oldListB: { sequence: oldB.sequence, requestedAt: oldB.requestedAt, capturedAt: oldB.capturedAt, status: oldB.status, rawBytes: oldB.rawBytes, projects: oldB.projects, delivered: oldB.delivered }, selectedView: new URL(owner.page.url()).searchParams.get("chat"), positiveAssociation: { projectId: projB.id, chatId: overlap.id }, capturedAfterBAck: oldB.capturedAt > ackB.at, excludesA: oldB.positive?.(projA.id, overlap.id) === false, aUnforwardedAtCapture: holdA.fetched === false };
    });
    requireGate("browser.positive-b-list-captured-held");
    await g("positive-a-release-commit-ack-last", async () => {
      assert.ok(oldB && oldB.delivered === false, "prerequisite: the older B-positive list is still held");
      assert.ok(holdB.delivered && state(ctx, overlap.id).session.project_id === projB.id, "prerequisite: B committed and acknowledged while A is still held before forwarding");
      assert.equal(holdA.fetched, false, "prerequisite: A has not been forwarded");
      holdA.releaseForward();
      // The awaiting route-handler continuation resumes in a later microtask, so
      // the timestamp and forwarded state are polled, not read synchronously.
      assert.ok(await pollUntil(() => typeof holdA.forwardReleasedAt === "number" && holdA.fetched && holdA.status === 200 && holdA.delivered && state(ctx, overlap.id).session.project_id === projA.id, 10000), "released A must forward, commit last and be acknowledged");
      assert.ok(typeof holdA.forwardReleasedAt === "number", "A's forward release must carry its own timestamp");
      const committedA = sample("positive-commit-A", state(ctx, overlap.id)).state;
      assert.deepEqual(holdA.body, { ok: true });
      assert.ok(typeof holdA.rawBytes === "string" && holdA.rawBytes.length > 0, "genuine producer response bytes must be retained for A");
      assertMoveOnly(stateSamples.find(s => s.phase === "positive-commit-B")!.state, committedA, projA.id);
      assert.ok(await pollUntil(() => acks.some(a => a.chatId === overlap.id && a.body?.projectId === projA.id && a.status === 200), 5000), "A's real 200 acknowledgment must arrive after release");
      const ackB = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projB.id);
      const ackA = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projA.id);
      assert.ok(ackB && ackA, "both acknowledgments must exist");
      assert.ok(ackB.at < ackA.at, "the A acknowledgment must be delivered LAST (B first)");
      assert.ok(await pollUntil(() => log().slice(logOffsetAtRelease!).includes(`PATCH /api/me/chats/${overlap.id} 200`), 5000), "a NEW matching PATCH 200 must appear in the operation-local post-release log segment; the raw response and SQLite state remain the primary commit evidence");
      assert.equal(failures.length, 0);
      assert.equal(writes.filter(w => w.chatId === overlap.id && w.body?.projectId !== undefined).length, 2, "exactly one PATCH attempt per target; no replay of either move");
      await frames(); await rec.screenshot(owner.page, "positive-a-committed-acked-last");
      // Adapter note: drag gestures leave the drawer open, and its overlay then
      // intercepts the pointer on the main content, so the direct consumers'
      // regenerate/edit hovers would time out. Close through the drawer's real
      // close button and let two committed frames land before the late-memory
      // release and any direct consumer. Closing is pure local drawer state —
      // no chat GET, so it cannot repair the refs the consumers are judged on.
      await closeSidebar(); await frames();
      return { committedA, holdAResponse: { status: holdA.status, body: holdA.body, rawBytes: holdA.rawBytes, forwardReleasedAt: holdA.forwardReleasedAt, commitObservedAt: holdA.commitObservedAt, deliveredAt: holdA.deliveredAt }, acknowledgmentDelivery: [{ phase: "B", at: ackB.at }, { phase: "A", at: ackA.at }], postReleaseLogSegment: log().slice(logOffsetAtRelease!) };
    });
    requireGate("browser.positive-a-release-commit-ack-last");
    await g("positive-a-list-newer-delivered", async () => {
      const ackA = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projA.id);
      assert.ok(await pollUntil(() => listResponses.some(e => e.positive?.(projA.id, overlap.id) && e.delivered), 10000), "a newer genuine positive A project-list response must be captured and delivered after A's commit");
      newListA = listResponses.filter((e: any) => e.positive?.(projA.id, overlap.id))[0];
      assert.ok(newListA, "the newer A-positive list response must be identified");
      assert.equal(newListA.status, 200);
      assert.equal(newListA.delivered, true, "the newer A-positive list evidence must be delivered to the page");
      assert.ok(typeof newListA.rawBytes === "string" && newListA.rawBytes.length > 0, "genuine raw response bytes must be retained for the new A list");
      assert.ok(newListA.capturedAt > holdA.commitObservedAt, "the A-positive evidence must be captured after A's committed response");
      assert.ok(ackA && newListA.capturedAt > ackA.at, "the A-positive evidence must be captured after A's browser acknowledgment");
      assert.equal(newListA.sequence > oldB.sequence, true, "the delivered A-positive evidence is a newer list request than the held B response");
      assert.equal(newListA.positive?.(projB.id, overlap.id), false, "the newer A-positive list must exclude B membership for the selected chat (captured after commit A)");
      assert.equal(oldB.delivered, false, "the older B response must still be held while the newer A evidence is delivered");
      assert.equal(state(ctx, overlap.id).session.project_id, projA.id);
      assert.equal(new URL(owner.page.url()).searchParams.get("chat"), overlap.id, "selected view identity is the moved chat");
      await rec.screenshot(owner.page, "positive-a-list-delivered");
      return { newListA: { sequence: newListA.sequence, requestedAt: newListA.requestedAt, capturedAt: newListA.capturedAt, status: newListA.status, rawBytes: newListA.rawBytes, projects: newListA.projects, deliveredAt: newListA.deliveredAt }, positiveAssociation: { projectId: projA.id, chatId: overlap.id }, excludesB: newListA.positive?.(projB.id, overlap.id) === false, olderBStillHeld: oldB.delivered === false };
    });
    requireGate("browser.positive-a-list-newer-delivered");
    await g("positive-old-b-delivered-last", async () => {
      assert.ok(newListA && newListA.delivered, "prerequisite: newer A-positive list delivered");
      // The no-repair chat-GET window starts BEFORE the old delivery: the first
      // direct regenerate consumer is judged against this baseline, so no chat
      // GET between the old list delivery and its held-redo dispatch can hide.
      noRepairReads = reads.length;
      // Engage the scoped unavailable-refresh fail-delivery BEFORE the old
      // delivery: every list response captured from now on is failed-delivered
      // (real bytes retained, never delivered), so no repairing refresh can
      // mask the old response's damage while the page's documented refresh
      // catch resolves the queued per-chat saves (a plain hold would deadlock
      // them). The old entry itself is already captured and fulfilled from its
      // real bytes via its own barrier.
      listFailDeliveryAt = Date.now(); listFailDelivery = true;
      oldB.release();
      assert.ok(await pollUntil(() => oldB.delivered, 5000), "the held older B-positive list response must now be delivered");
      await frames();
      assert.ok(newListA.deliveredAt! < oldB.deliveredAt!, "delivery order: newer A-positive list first, older B-positive response LAST");
      assert.equal(new URL(owner.page.url()).searchParams.get("chat"), overlap.id, "the selected view identity must remain the moved chat");
      assert.equal(state(ctx, overlap.id).session.project_id, projA.id, "storage association remains A");
      await rec.screenshot(owner.page, "positive-old-b-delivered-last");
      return { olderBDelivery: { deliveredAt: oldB.deliveredAt, sequence: oldB.sequence }, newerADelivery: { deliveredAt: newListA.deliveredAt, sequence: newListA.sequence }, deliveryNewestToOldest: newListA.deliveredAt! < oldB.deliveredAt!, failDeliveryEngagedAt: listFailDeliveryAt, noRepairWindowReadsBaseline: noRepairReads, selectedView: new URL(owner.page.url()).searchParams.get("chat"), finalAssociation: state(ctx, overlap.id).session.project_id };
    });
    requireGate("browser.positive-old-b-delivered-last");
    await g("positive-schedule-ordering", async () => {
      const ackB = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projB.id);
      const ackA = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projA.id);
      assert.ok(ackB && ackA, "prerequisite: both acknowledgments delivered");
      const schedule = {
        gestures: dialogs.filter(d => d.chat === overlap.title).map(d => ({ target: d.destination, at: d.at })),
        requests: [{ phase: "A", at: holdA.captured.at }, { phase: "B", at: holdB.captured.at }],
        forwardRelease: [{ phase: "A", at: holdA.forwardReleasedAt }, { phase: "B", at: null as number | null }],
        responsesCaptured: [{ phase: "A", at: holdA.commitObservedAt }, { phase: "B", at: holdB.commitObservedAt }],
        commits: stateSamples.filter(s => s.phase === "positive-commit-A" || s.phase === "positive-commit-B").map(s => ({ phase: s.phase.replace("positive-commit-", ""), at: s.at, projectId: s.state.session.project_id })),
        acknowledgmentsDelivered: [{ phase: "B", at: ackB.at }, { phase: "A", at: ackA.at }],
        projectListResponses: {
          olderB: { sequence: oldB.sequence, requestedAt: oldB.requestedAt, capturedAt: oldB.capturedAt, status: oldB.status, deliveredAt: oldB.deliveredAt, positiveAssociation: { projectId: projB.id, chatId: overlap.id }, capturedAfterCommitB: oldB.capturedAt > holdB.commitObservedAt!, capturedAfterBAck: oldB.capturedAt > ackB.at, capturedWhileAUnforwarded: oldB.capturedAt < holdA.forwardReleasedAt!, excludesA: oldB.positive?.(projA.id, overlap.id) === false, deliveredLast: true },
          newerA: { sequence: newListA.sequence, requestedAt: newListA.requestedAt, capturedAt: newListA.capturedAt, status: newListA.status, deliveredAt: newListA.deliveredAt, positiveAssociation: { projectId: projA.id, chatId: overlap.id }, capturedAfterCommitAResponse: newListA.capturedAt > holdA.commitObservedAt!, excludesB: newListA.positive?.(projB.id, overlap.id) === false, deliveredBeforeOldB: newListA.deliveredAt! < oldB.deliveredAt! },
          capturedAfterOldBDelivery: listResponses.filter(e => e.capturedAt > oldB.deliveredAt!).length,
          deliveredAfterOldBDeliveryOtherThanOldB: listResponses.filter(e => e.delivered && e !== oldB && e.deliveredAt! > oldB.deliveredAt!).length,
        },
        selectedView: { overlapChatId: overlap.id, consumers: consumers.map(c0 => ({ question: c0.question, chatId: c0.chatId, selectedChat: c0.selectedChat })), urlNow: new URL(owner.page.url()).searchParams.get("chat") },
        serverDispatchSegments: { logOffsetPreA, logOffsetAtRelease, preReleaseHealthyControlLines: 1 },
        finalAssociation: state(ctx, overlap.id).session.project_id,
      };
      assert.equal(schedule.gestures.length, 2);
      assert.equal(schedule.gestures[0].target, projA.name);
      assert.equal(schedule.gestures[1].target, projB.name);
      assert.ok(schedule.gestures[0].at < schedule.gestures[1].at, "gesture order is A then B");
      assert.ok(schedule.requests[0].at < schedule.requests[1].at, "request capture order is A then B");
      assert.ok(holdA.captured.at < holdA.forwardReleasedAt! && holdA.forwardReleasedAt! < holdA.commitObservedAt! && holdA.commitObservedAt! < ackA.at, "A's own phases stay ordered: capture, forward release, response, acknowledgment");
      assert.ok(holdB.commitObservedAt < holdA.forwardReleasedAt!, "commit B's genuine response was captured before A was even forwarded: the schedules cannot coincide");
      assert.ok(schedule.projectListResponses.olderB.capturedAfterCommitB && schedule.projectListResponses.olderB.capturedAfterBAck && schedule.projectListResponses.olderB.capturedWhileAUnforwarded && schedule.projectListResponses.olderB.excludesA, "the older B-positive list was captured after commit B and B's acknowledgment while A remained unforwarded and excludes A membership");
      assert.equal(schedule.commits[0].projectId, projB.id, "observed commit order is B then A");
      assert.equal(schedule.commits[1].projectId, projA.id);
      assert.ok(ackB.at < ackA.at, "acknowledgment delivery order is B then A (A last)");
      assert.ok(schedule.projectListResponses.newerA.capturedAfterCommitAResponse && schedule.projectListResponses.newerA.excludesB && schedule.projectListResponses.newerA.deliveredBeforeOldB, "the newer A-positive list was captured after commit A, excludes B membership and was delivered before the older B response");
      assert.equal(schedule.projectListResponses.deliveredAfterOldBDeliveryOtherThanOldB, 0, "no list response other than the old B response may be delivered after it");
      assert.equal(schedule.finalAssociation, projA.id, "the final observed association follows the observed commit order, not gesture, acknowledgment or list-delivery order");
      // Per-consumer selected-view identity is recorded here as phase evidence
      // and judged after both direct consumers exist (post-consumer clause in
      // the no-repairing gate); at this schedule point they have not run yet.
      assert.equal(schedule.selectedView.urlNow, overlap.id);
      assert.equal(writes.filter(w => w.chatId === overlap.id && w.body?.projectId !== undefined).length, 2, "no replayed or extra move attempts");
      schedules.push(schedule);
      return { schedule, outcomes: { A: "accepted; committed last; final observed association", B: "accepted at its commit with a real 200 acknowledgment; later superseded in storage by the accepted A commit — not rejected, replayed or rolled back" }, discrimination: "the older B-positive list captured while A is unforwarded and delivered AFTER a newer A-positive list discriminates latest-request ownership from last-delivered-list binding: a page that selects context from the last-delivered list binds B here and its direct consumers are rejected; request/view-owned selection keeps A", inferenceGuard: "observations of this executed schedule only; unchanged atomic full-snapshot LWW, no latest-start-wins/CAS/stale-write-rejection/merged-history/gesture-order rule asserted or implied" };
    });
    requireGate("browser.positive-schedule-ordering");
    c.release(q, [{ memory_update: late }]);
    await g("positive-late-compaction", async () => {
      const got = await f.durable(owner, ctx, overlap.id, late, answer);
      assert.equal(got.http.body.projectId, projA.id, "valid held late compaction remains eligible and saves the observed final association A");
      assert.deepEqual(f.projection(got.http.body.messages), f.projection(origin));
      return got;
    });
    requireGate("browser.positive-late-compaction");
    await owner.clickRegenerate(); await waitActive(q, 2);
    await g("positive-regenerate-at-send", async () => consume(q, overlap, projA.id, noRepairReads, overlap.base, [instructionsA], [instructionsB]));
    c.release(q, [{ memory_update: f.blob("positive-regenerate-final") }, f.done]);
    await g("positive-regenerate-settles", async () => {
      const got = await f.durable(owner, ctx, overlap.id, f.blob("positive-regenerate-final"), "Positive-list regenerated redo");
      assert.equal(got.http.body.projectId, projA.id);
      assert.equal(got.http.body.assistantId, ctx.ids.soul);
      assert.deepEqual(f.projection(got.http.body.messages).slice(0, overlap.base.length), f.projection(overlap.base));
      await rec.screenshot(owner.page, "positive-regenerate-settled");
      return got;
    });
    const editedQ = `positive-edited-${ctx.label}`;
    c.plans.set(editedQ, [{ frames: [{ content: "Positive-list edited redo" }], holdOnly: true }]);
    const editReads = reads.length;
    await owner.editLastMessage(q, editedQ); await waitActive(editedQ, 1);
    await g("positive-edit-at-send", async () => consume(editedQ, overlap, projA.id, editReads, overlap.base, [instructionsA], [instructionsB]));
    c.release(editedQ, [{ memory_update: f.blob("positive-edit-final") }, f.done]);
    await g("positive-edit-settles", async () => {
      const got = await f.durable(owner, ctx, overlap.id, f.blob("positive-edit-final"), "Positive-list edited redo");
      assert.equal(got.http.body.projectId, projA.id);
      assert.equal(got.http.body.assistantId, ctx.ids.soul);
      assert.deepEqual(f.projection(got.http.body.messages).slice(0, overlap.base.length), f.projection(overlap.base));
      await rec.screenshot(owner.page, "positive-edit-settled");
      return got;
    });
    sample("positive-final", state(ctx, overlap.id));
    await g("no-repairing-list-after-old-b", async () => {
      assert.ok(oldB.deliveredAt, "prerequisite: old B list delivered");
      const overlapConsumers = consumers.filter(c0 => c0.chatId === overlap.id);
      assert.ok(overlapConsumers.length >= 2, "both direct overlap consumers must have been judged");
      assert.ok(overlapConsumers.every(c0 => c0.selectedChat === overlap.id), "both direct consumers dispatched from the moved chat's captured selected view");
      assert.ok(overlapConsumers.every(c0 => c0.raw.project_id === projA.id), "both direct consumers' observed dispatch association is the final observed association A");
      assert.equal(listFailDelivery, true, "the unavailable-refresh fail-delivery window must still be engaged at consumer judgment time");
      assert.ok(await pollUntil(() => listResponses.filter(e => e.capturedAt! > oldB.deliveredAt! || e.failDelivery).every(e => e.aborted), 5000), "every list request captured in the unavailable-refresh window must have reached its terminal failed delivery");
      const capturedAfter = listResponses.filter(e => e.capturedAt > oldB.deliveredAt!);
      assert.ok(capturedAfter.length >= 1, "the unavailable-refresh window must be non-empty: the page's own persist-chain refresh is expected after the old delivery");
      assert.ok(capturedAfter.every(e => !e.delivered), "no list response captured after the old delivery may reach the page before the direct consumer assertions");
      assert.ok(capturedAfter.every(e => e.aborted === true && e.failDelivery === true && typeof e.rawBytes === "string" && e.rawBytes.length > 0), "every window response must be failed-delivered with its genuine raw bytes retained as unavailable-refresh evidence");
      await new Promise(resolve => setTimeout(resolve, 300));
      // Actual browser close-record snapshot BEFORE the failure accounting: the
      // phase proof for intentional closes is the instrumented page state at
      // judgment time (seq/created/open/error/close times), never a later
      // retained SQLite sample.
      const feedSnapshot = await owner.page.evaluate(() => (window as any).__followupFeeds);
      feedSnapshots.push({ at: Date.now(), phase: "unavailable-refresh-accounting", feeds: feedSnapshot });
      const judgmentAt = Date.now();
      // Phase-local failure accounting: only failures OBSERVED INSIDE the
      // induced fail-delivery window (>= listFailDeliveryAt, <= this judgment)
      // are asserted, in exactly two permitted shapes. Pre-window records are
      // native cancellations outside the induced window (deliberate
      // navigation/reload can cancel in-flight SSE, the user feed or reads) —
      // retained verbatim as diagnostics, never labeled healthy by fiat and
      // never gated by a global network guarantee. The always-hard chat-write
      // failure control (failures.length === 0) is unchanged.
      const windowRequestFailed = requestFailedAll.filter(f0 => f0.at >= listFailDeliveryAt! && f0.at <= judgmentAt);
      const windowAborted = listResponses.filter(e => e.aborted);
      const selectedEventsPath = `/api/me/chats/${overlap.id}/events`;
      const unaccounted = windowRequestFailed.filter(f0 => !(f0.method === "GET" && f0.path === "/api/me/projects" && (f0.error ?? "").includes("ERR_FAILED") && typeof f0.listSequence === "number" && windowAborted.some(e => e.sequence === f0.listSequence)) &&
        !(f0.method === "GET" && f0.path === selectedEventsPath && (f0.error ?? "").includes("ERR_ABORTED")));
      assert.equal(unaccounted.length, 0, "during the fail-delivery window every observed request failure must be either a strictly scoped expected GET /api/me/projects delivery failure correlated to its captured entry or a selected-chat events ERR_ABORTED matched one-to-one to an actual intentional EventSource.close invocation (no broad endpoint exemption; unexpected in-window failures still reject)");
      for (const e of windowAborted) assert.equal(windowRequestFailed.filter(f0 => f0.listSequence === e.sequence).length, 1, `exactly one correlated browser requestfailed for captured list entry ${e.sequence}`);
      // One-to-one, time-ordered close matching with a bounded transport event
      // delay: each permitted selected-chat events record must match exactly
      // one still-unmatched intentional close of the EXACT selected-chat
      // events URL that PRECEDED the failure within the bound; each close is
      // consumed at most once. Closes without an observed failure are retained
      // diagnostics, not asserted healthy.
      const intentionalWindowCloses = feedSnapshot.filter((r0: any) => r0.url === selectedEventsPath && r0.closeInvoked === true && typeof r0.closedAt === "number" && r0.closedAt >= listFailDeliveryAt!);
      const unmatchedCloses = new Set<number>(intentionalWindowCloses.map((r0: any) => r0.seq));
      const permittedEventsRecords = windowRequestFailed.filter(f0 => f0.method === "GET" && f0.path === selectedEventsPath && (f0.error ?? "").includes("ERR_ABORTED"));
      const closeMatches: any[] = [];
      for (const f0 of permittedEventsRecords.slice().sort((a0: any, b0: any) => a0.at - b0.at)) {
        const match = intentionalWindowCloses.filter((r0: any) => unmatchedCloses.has(r0.seq) && r0.closedAt <= f0.at && f0.at - r0.closedAt <= 2000)
          .sort((a0: any, b0: any) => b0.closedAt - a0.closedAt)[0];
        assert.ok(match, `the in-window selected-chat events ERR_ABORTED must match one actual intentional EventSource.close invocation of the exact selected-chat events URL (time-ordered within the bounded transport event delay), record at ${f0.at}`);
        unmatchedCloses.delete(match.seq);
        closeMatches.push({ recordAt: f0.at, closeSeq: match.seq, closedAt: match.closedAt, delayMs: f0.at - match.closedAt });
      }
      const closesWithoutObservedFailure = intentionalWindowCloses.filter((r0: any) => unmatchedCloses.has(r0.seq));
      assert.equal(failures.length, 0, "no chat-write transport failure may occur in this schedule");
      const preWindowRequestFailed = requestFailedAll.filter(f0 => f0.at < listFailDeliveryAt!);
      const deliveredAfter = listResponses.filter(e => e.delivered && e !== oldB && e.deliveredAt! > oldB.deliveredAt!);
      assert.equal(deliveredAfter.length, 0, "no list response other than the old B response itself may be delivered after it");
      return { unavailableRefreshWindow: { from: oldB.deliveredAt, failDeliveryEngagedAt: listFailDeliveryAt, judgedAt: judgmentAt, capturedResponses: capturedAfter.length, allFailedNotDelivered: capturedAfter.every(e => e.aborted && !e.delivered), rawBytesRetained: capturedAfter.every(e => typeof e.rawBytes === "string" && e.rawBytes.length > 0), correlatedRequestFailed: windowAborted.length }, selectedChatEventsCancellations: { permitted: permittedEventsRecords.length, matchedCloses: closeMatches, closesWithoutObservedFailure: closesWithoutObservedFailure.map((r0: any) => ({ seq: r0.seq, createdAt: r0.createdAt, openedAt: r0.openedAt, erroredAt: r0.erroredAt, closedAt: r0.closedAt })), note: "one-to-one actual intentional-close correlation (time-ordered, bounded transport event delay); unmatched closes are retained diagnostics, not asserted healthy", phaseProof: "instrumented browser __followupFeeds snapshot at judgment time; not later retained SQLite" }, preWindowRequestFailed: { count: preWindowRequestFailed.length, records: preWindowRequestFailed, note: "retained diagnostics verbatim: native cancellations outside the induced fail-window (deliberate navigation/reload can cancel in-flight SSE or reads); no health claim and no global network guarantee" }, deliveredAfterOldBDeliveryOtherThanOldB: deliveredAfter.length, consumers: consumers.map(c0 => ({ question: c0.question, selectedChat: c0.selectedChat, expectedProjectId: c0.expectedProjectId, readsAtJudgment: c0.readsAtJudgment })) };
    });
    await g("acknowledgments", async () => {
      assert.ok(await pollUntil(() => writes.length === acks.length && failures.length === 0, 10000), "every attempted write must reach its actual acknowledgment before judgment");
      assert.equal(writes.length, acks.length, "every attempted write needs its actual acknowledgment");
      assert.equal(failures.length, 0, "this schedule introduces no transport faults; no request may fail");
      assert.ok(acks.every(a => a.status === 200));
      for (const w of writes) assert.ok(acks.some(a => a.chatId === w.chatId && JSON.stringify(a.body) === JSON.stringify(w.body)), "each acknowledgment must match its own attempted write");
      const moves = writes.filter(w => w.body?.projectId !== undefined);
      assert.equal(moves.length, 4, "exactly one acknowledged move PATCH per intended move: single, navigation, overlap A, overlap B");
      return { writes, acknowledgments: acks, failures, moveAttempts: moves.length };
    });
  } finally {
    // Retention must survive teardown faults: every close/unroute/drain step is
    // fault-recorded and the observations file is written LAST, so a drain
    // timeout or a close error can never drop the retained diagnostics.
    const closeErrors: any[] = [];
    for (const h of holds) { try { await h.close(); } catch (e) { closeErrors.push({ source: "move-hold", error: String(e) }); } }
    try { await listBarriers.close(); } catch (e) { closeErrors.push({ source: "list-barrier", error: String(e) }); }
    let listDrained = false;
    try { listDrained = await pollUntil(() => listResponses.every(e => e.delivered || e.aborted), 5000); } catch (e) { closeErrors.push({ source: "list-drain-poll", error: String(e) }); }
    try { await owner.close(); } catch (e) { closeErrors.push({ source: "browser-close", error: String(e) }); }
    ctx.check("browser.no-page-errors", !owner.pageErrors.length, owner.pageErrors);
    ctx.check("browser.no-blocked-requests", !owner.blocked.length, owner.blocked);
    // Mode-correct drain: "preforward" requires its forward release, response and
    // delivery; "hold" requires response, manual release and delivery; "pass"
    // requires forward and delivery without inventing a manual-release obligation.
    // The list barrier releases every held response for teardown drainage only;
    // the pre-release observation is owned by the no-repairing gate, not this
    // drain count. Window entries drain via their terminal failed delivery
    // (aborted), never by a late fulfillment. A drain timeout or any teardown
    // fault fails closed and is retained in the recorded diagnostics.
    ctx.check("browser.responses-drained", !c.held.length && !c.unmatched.length && !ctx.upstream.pending.size && holds.every(h => h.row.delivered &&
      (h.row.mode === "pass" ? h.row.fetched : h.row.mode === "preforward" ? (h.row.forwardReleasedAt !== null && h.row.fetched) : (h.row.fetched && h.row.released))) &&
      listHoldPredicate === null && listDrained && closeErrors.length === 0,
      { held: c.held, unmatched: c.unmatched, listDrained, closeErrors, drain: holds.map(h => ({ sequence: h.row.sequence, mode: h.row.mode, chatId: h.row.chatId, projectId: h.row.projectId, capturedAt: h.row.captured?.at ?? null, forwardReleasedAt: h.row.forwardReleasedAt, fetched: h.row.fetched, commitObservedAt: h.row.commitObservedAt, delivered: h.row.delivered, deliveredAt: h.row.deliveredAt, released: h.row.released })),
        listResponses: listResponses.map(({ release, ...rest }: any) => rest) });
    writeFileSync(join(rec.dir, "move-positive-list-observations.json"), JSON.stringify({ writes, acknowledgments: acks, failures, asks, reads, dialogs, consumers, schedules,
      holds: holds.map(h => ({ sequence: h.row.sequence, actor: h.row.actor, chatId: h.row.chatId, projectId: h.row.projectId, mode: h.row.mode, captured: h.row.captured, reserved: h.row.reserved, forwardReleasedAt: h.row.forwardReleasedAt, status: h.row.status, body: h.row.body, rawBytes: h.row.rawBytes, commitObservedAt: h.row.commitObservedAt, released: h.row.released, delivered: h.row.delivered, deliveredAt: h.row.deliveredAt })),
      listResponses: listResponses.map(({ release, ...rest }: any) => rest), stateSamples, consoleErrors, closeErrors, requestFailedAll, feedSnapshots, observations: rec.observations }, null, 2));
  }
}
