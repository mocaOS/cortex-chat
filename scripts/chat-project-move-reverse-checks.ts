// move-reverse-v1: the discriminating reverse commit-order schedule for two
// overlapping successful moves of the same own chat to two different shared
// targets. Native move A is captured and HELD BEFORE route.fetch/forwarding;
// while A is held unforwarded, native move B is dispatched and observed with a
// genuine 200 {ok:true}, a full move-only SQLite commit B and a real browser 200
// acknowledgment. Only then is A released to route.fetch: A forwards, commits
// last (raw 200), and its acknowledgment is delivered last. Gestures/requests
// run A→B while observed commits and acknowledgments run B→A and the final
// association is A — the schedule that distinguishes observed commit truth from
// latest-dispatched selection (the previous overlap gate cannot discriminate
// those because its gestures and commits both ran A→B). Both writes stay
// accepted: B is superseded, not rejected, replayed or rolled back. Unchanged
// atomic full-snapshot LWW; no latest-start-wins, CAS, stale-write rejection or
// merged-history rule is asserted or implied.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController, pollUntil, setAppLocale } from "./chat-browser-checks";
import { projectFixture as f } from "./chat-project-followup-checks";
import { assertMoveOnly } from "./chat-project-move-checks";

export const REVERSE_GATES = ["browser.login-dark-en-de", "browser.cancel-no-write", "browser.single-move-control",
  "browser.held-ack-navigation-control", "browser.held-ack-consumer-context", "browser.held-ack-consumer-settles",
  "browser.reverse-a-held-preforward", "browser.reverse-b-commit-ack", "browser.reverse-a-release-commit-ack-last",
  "browser.reverse-commit-order-schedule", "browser.reverse-late-compaction",
  "browser.reverse-regenerate-at-send", "browser.reverse-regenerate-settles",
  "browser.reverse-edit-at-send", "browser.reverse-edit-settles",
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
  const base = f.pair(`fx-reverse-${title}-${ctx.label}`, title).map((m: any) => m.role === "assistant" ? { ...m,
    feedback: "up", thinking: ["Retained reasoning"], sources: [{ document_id: "fx-reverse-source", chunk_id: "fx-reverse-chunk",
      sid: "fx-reverse-stable-sid", content: "Retained source", score: 0.42, metadata: { filename: "move-reverse-fixture.md" } }] } : m);
  await f.patch(ctx, cookie, id, base, pre);
  return { id, title, pre, base };
}
export async function runReverseBrowser(ctx: any) {
  const rec = new Recorder(join(ctx.workDir, "logs")), tool = browserPrerequisites(); assert.deepEqual(tool.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(tool.pwPath, "index.js")), owner = new BrowserSession(pw, tool.chromiumPath, ctx.baseUrl, rec), c = makeUpstreamController(ctx);
  for (const [path, name] of [["src/app/page.tsx", "page.tsx"], ["src/components/Sidebar.tsx", "Sidebar.tsx"], ["src/lib/chatHistory.ts", "chatHistory.ts"]]) copyFileSync(join(ctx.appDir, path), join(rec.dir, name));
  writeFileSync(join(rec.dir, "tooling.json"), JSON.stringify({ ...tool, version: JSON.parse(readFileSync(join(tool.pwPath, "package.json"), "utf8")).version, tmpdir: process.env.TMPDIR, install: false }, null, 2));
  const writes: any[] = [], acks: any[] = [], failures: any[] = [], asks: any[] = [], reads: any[] = [], lists: any[] = [], dialogs: any[] = [], holds: any[] = [], consumers: any[] = [], stateSamples: any[] = [], consoleErrors: any[] = [], schedules: any[] = [];
  const g = (id: string, fn: () => Promise<any>) => f.gate(ctx, `browser.${id}`, fn), log = () => readFileSync(join(ctx.workDir, "logs", "app-dev.log"), "utf8");
  const chatId = (path: string) => decodeURIComponent(path.split("/").pop()!);
  try {
    await owner.start();
    owner.page.on("console", (m: any) => { if (m.type() === "error") consoleErrors.push({ text: m.text(), location: m.location(), at: Date.now() }); });
    owner.context.on("request", (r: any) => { const path = new URL(r.url()).pathname, method = r.method();
      if (method === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(path)) writes.push({ actor: "owner-browser", path, method, chatId: chatId(path), body: r.postDataJSON(), at: Date.now() });
      if (method === "GET" && /^\/api\/me\/chats\/[^/]+$/.test(path)) reads.push({ actor: "owner-browser", path, chatId: chatId(path), at: Date.now() });
      if (path === "/api/ask/stream") asks.push({ actor: "owner-browser", id: r.headers()["x-request-id"], body: r.postDataJSON(), at: Date.now() }); });
    owner.context.on("requestfailed", (r: any) => { const path = new URL(r.url()).pathname; if (/^\/api\/me\/chats\/[^/]+$/.test(path)) failures.push({ path, method: r.method(), error: r.failure()?.errorText, at: Date.now() }); });
    owner.context.on("response", (r: any) => { const path = new URL(r.url()).pathname, method = r.request().method();
      if (method === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(path)) acks.push({ actor: "owner-browser", path, chatId: chatId(path), body: r.request().postDataJSON(), status: r.status(), at: Date.now() });
      if (method === "GET" && path === "/api/me/chats") lists.push({ status: r.status(), at: Date.now() }); });
    await owner.login(ctx, ctx.users.owner.email, ctx.users.owner.password); const member = await f.login(ctx, "member");
    const sidebar = async () => { if (!await owner.drawer().isVisible()) { await owner.page.locator('button[aria-label="Toggle sidebar"], button[aria-label="Seitenleiste umschalten"]').click(); await owner.drawer().waitFor({ state: "visible", timeout: 30000 }); } };
    const closeSidebar = async () => { if (await owner.drawer().isVisible()) await owner.drawer().locator("button").first().click(); };
    const row = (text: string) => owner.drawer().getByText(text, { exact: true }).locator("..");
    const frames = () => owner.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const CONSENT_EN = "This project is shared — all members will be able to read this chat's entire history and continue the conversation. Move it?";
    const CONSENT_DE = "Dieses Projekt ist geteilt — alle Mitglieder können den gesamten Verlauf dieses Chats lesen und die Unterhaltung fortsetzen. Verschieben?";
    const drag = async (title: string, destination: string | null, decision: "accept" | "dismiss", opts: { locale?: "en" | "de"; expandFolder?: string } = {}) => {
      await sidebar();
      // Adapter note: the moved chat legitimately renders in either of two supported
      // source locations — the personal flat row (no association commit has been
      // observed for the pending gesture: A is held before forwarding and A's
      // acknowledgment is not delivered, so no project-channel event exists), or,
      // after an observed commit's own project-channel event refresh, inside the
      // possibly collapsed committed folder. The adapter resolves the visible row
      // as-is and clicks the declared folder only when the flat row is not visible;
      // it never forces a sidebar read or folder refresh and never rewrites
      // product state.
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
      assert.equal(raw.session_id, chat.id);
      assert.equal(raw.project_id, projectId, "the direct consumer must consume the current observed authoritative association");
      assert.equal(raw.assistant_id, ctx.ids.soul);
      // Personality scope: this gate asserts the consumer's soul *association*
      // (assistant_id) and the upstream-injected project instructions that
      // discriminate the actual observed target; the upstream soul-body
      // injection mechanism itself is not re-verified here — same accepted
      // overlap v1.1 scope, not a weakened or new obligation.
      assert.deepEqual(raw.conversation_memory, chat.pre);
      assert.deepEqual(sent.conversation_memory, chat.pre);
      assert.deepEqual(raw.conversation_history, prefix.map((m: any) => ({ role: m.role, content: m.content })));
      assert.equal(reads.length, readCount, "no repairing browser chat GET in the pre-dispatch/held-redo window");
      const sentText = JSON.stringify(sent);
      for (const allow of allowedInstructions) assert.ok(sentText.includes(allow), `upstream injected context must carry the actual observed target's instructions (${allow})`);
      for (const forbid of forbiddenInstructions) assert.equal(sentText.includes(forbid), false, `upstream injected context must not carry another target's instructions (${forbid})`);
      const observation = { question, chatId: chat.id, expectedProjectId: projectId, allowedInstructions, forbiddenInstructions, personalityScope: "assistant_id association asserted; upstream soul-body injection mechanism not re-verified (accepted overlap v1.1 scope)", raw, sent, activeOperationId: upstream.id, readsAtJudgment: reads.length };
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
    const requireGate = (id: string) => { const row = ctx.checks.find((c: any) => c.id === id); if (!row || row.ok !== true) throw new Error(`prerequisite gate ${id} not met (${row ? "failed" : "missing"}); stopping dependent sequence, failure preserved`); };

    await g("login-dark-en-de", async () => {
      assert.equal((await f.json(ctx, "/api/auth/me", owner.cookie)).id, ctx.users.owner.id);
      assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de");
      try { await owner.page.reload(); await owner.waitForComposer(); assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research..."); await rec.screenshot(owner.page, "reverse-dark-de"); }
      finally { setAppLocale(ctx.dataDir, "en"); }
      await owner.page.reload(); await owner.waitForComposer();
      return { locales: ["de", "en"], actor: "owner browser form login; member via HTTP" };
    });
    const instructionsA = `Reverse target A shared instructions ${ctx.label}`;
    const instructionsB = `Reverse target B shared instructions ${ctx.label}`;
    const projA = await target(ctx, owner.cookie, "Reverse target A", instructionsA, ctx.users.member.id);
    const projB = await target(ctx, owner.cookie, "Reverse target B", instructionsB, ctx.users.member.id);
    const single = await ownChat(ctx, owner.cookie, "Reverse single-move chat");
    const overlap = await ownChat(ctx, owner.cookie, "Reverse moved chat");
    const navChat = await ownChat(ctx, owner.cookie, "Reverse navigation chat");
    const viewDest = await ownChat(ctx, owner.cookie, "Reverse view destination");
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
        await rec.screenshot(owner.page, "reverse-dark-de-cancel");
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
      await rec.screenshot(owner.page, "reverse-held-ack-after-navigation");
      // Adapter note: the viewDest row click already closes the drawer via the
      // product's own onClose; the explicit close below makes that closure a
      // declared prerequisite for the following regenerate hover instead of an
      // incidental one. Closing is pure local drawer state — no chat GET, so it
      // cannot repair the refs the consumer is about to be judged on.
      await closeSidebar(); await frames();
      return { chatId: navChat.id, heldResponse: { status: navHold.status, body: navHold.body, rawBytes: navHold.rawBytes }, commit: state(ctx, navChat.id), navigationTarget: viewDest.id, acknowledgmentDeliveredAfterNavigation: true };
    });
    const navRedoQ = viewDest.base[0].content;
    c.plans.set(navRedoQ, [{ frames: [{ content: "Reverse navigation-view redo" }], holdOnly: true }]);
    const navReads = reads.length;
    await owner.clickRegenerate(); await waitActive(navRedoQ, 1);
    await g("held-ack-consumer-context", async () => consume(navRedoQ, viewDest, null, navReads, [], [], [instructionsA, instructionsB]));
    c.release(navRedoQ, [{ memory_update: f.blob("reverse-nav-redo-final") }, f.done]);
    await g("held-ack-consumer-settles", async () => {
      const got = await f.durable(owner, ctx, viewDest.id, f.blob("reverse-nav-redo-final"), "Reverse navigation-view redo");
      assert.equal(got.http.body.projectId, null);
      return got;
    });
    await closeSidebar(); await frames();
    await owner.page.goto(`${ctx.baseUrl}/?chat=${overlap.id}`, { waitUntil: "domcontentloaded" }); await owner.waitForComposer(); assert.ok(await f.visible(owner, overlap.base[1].content));
    const q = `reverse-origin-${ctx.label}`, answer = "Reverse origin completed answer", late = f.blob("reverse-origin-late");
    c.plans.set(q, [{ frames: [{ content: answer }, f.done], holdMemoryBlob: late }, { frames: [{ content: "Reverse regenerated redo" }], holdOnly: true }]);
    await owner.send(q); await owner.waitAnswerVisible(answer);
    const origin = (await f.durable(owner, ctx, overlap.id, overlap.pre, answer)).http.body.messages;
    await waitActive(q, 1);
    const baseline = sample("reverse-baseline", state(ctx, overlap.id)).state;
    const holdA = await holdMove(overlap.id, projA.id, "preforward");
    const logOffsetPreA = log().length;
    await g("reverse-a-held-preforward", async () => {
      await drag(overlap.title, projA.name, "accept");
      assert.ok(await pollUntil(() => holdA.reserved && !holdA.fetched && !holdA.delivered, 10000), "A's actual PATCH must be captured once and held before any forwarding");
      const unchanged = sample("reverse-a-captured-state-unchanged", state(ctx, overlap.id)).state;
      assert.deepEqual(unchanged, baseline, "no A commit while held before forwarding: exact unchanged full raw state");
      assert.equal(holdA.fetched, false, "A has not been forwarded: no route.fetch issued");
      assert.equal(holdA.delivered, false);
      assert.equal(holdA.status, null, "no response captured for A while held before forwarding");
      assert.equal(holdA.rawBytes, null, "no raw producer response bytes captured for A while held before forwarding");
      assert.equal(holdA.forwardReleasedAt, null, "A's forward has not been released while held before forwarding");
      // The A-move acknowledgment predicate is scoped to the move itself
      // (captured PATCH body carries projectId A): the same chat's earlier
      // accepted origin-history persistence save is a different acknowledged
      // write and must not count here.
      assert.equal(acks.some(a => a.chatId === overlap.id && a.body?.projectId === projA.id), false, "no browser acknowledgment for the A move while held before forwarding");
      const segment = log().slice(logOffsetPreA);
      assert.equal(patchLines(segment, overlap.id), 0, "no matching server dispatch in the operation-local pre-A log segment while A is held before forwarding");
      await rec.screenshot(owner.page, "reverse-a-held-preforward");
      return { baseline, unchanged, logOffsetPreA, captured: holdA.captured, mode: holdA.mode, forwarded: holdA.fetched, forwardReleasedAt: holdA.forwardReleasedAt, status: holdA.status, rawBytes: holdA.rawBytes, browserAcknowledgment: "not delivered for the A move (chat-level earlier persistence acks excluded by the move-scoped predicate)", preALogSegmentPatchLines: 0 };
    });
    requireGate("browser.reverse-a-held-preforward");
    const holdB = await holdMove(overlap.id, projB.id, "pass");
    let logOffsetAtRelease: number | null = null;
    await g("reverse-b-commit-ack", async () => {
      assert.ok(holdA.reserved && holdA.fetched === false && holdA.delivered === false, "prerequisite: A captured and still held before forwarding");
      // Adapter note: A is held before forwarding, so no A commit/ack exists and
      // the page's own guarded refresh has no association event to consume; the
      // chat legitimately remains in the personal flat row. The declared folder
      // click below runs only if that row is not visible; it never refreshes the
      // sidebar or rewrites product state.
      await drag(overlap.title, projB.name, "accept", { expandFolder: projA.name });
      assert.ok(await pollUntil(() => holdB.fetched && holdB.status === 200 && holdB.delivered && state(ctx, overlap.id).session.project_id === projB.id, 10000), "B must be genuinely forwarded, committed and acknowledged while A remains held before forwarding");
      const committedB = sample("reverse-commit-B", state(ctx, overlap.id)).state;
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
      await rec.screenshot(owner.page, "reverse-commit-b-acked");
      return { committedB, heldA: { reserved: holdA.reserved, fetched: holdA.fetched, delivered: holdA.delivered }, bResponse: { status: holdB.status, body: holdB.body, rawBytes: holdB.rawBytes }, ackBDeliveredBeforeRelease: true, healthyChannelControl: { segment: segmentB, matchingPatchLines: 1 } };
    });
    requireGate("browser.reverse-b-commit-ack");
    await g("reverse-a-release-commit-ack-last", async () => {
      assert.ok(holdB.delivered && state(ctx, overlap.id).session.project_id === projB.id, "prerequisite: B committed and acknowledged while A is still held before forwarding");
      assert.equal(holdA.fetched, false, "prerequisite: A has not been forwarded");
      holdA.releaseForward();
      // The awaiting route-handler continuation resumes in a later microtask, so
      // the timestamp and forwarded state are polled, not read synchronously.
      assert.ok(await pollUntil(() => typeof holdA.forwardReleasedAt === "number" && holdA.fetched && holdA.status === 200 && holdA.delivered && state(ctx, overlap.id).session.project_id === projA.id, 10000), "released A must forward, commit last and be acknowledged");
      assert.ok(typeof holdA.forwardReleasedAt === "number", "A's forward release must carry its own timestamp");
      const committedA = sample("reverse-commit-A", state(ctx, overlap.id)).state;
      assert.deepEqual(holdA.body, { ok: true });
      assert.ok(typeof holdA.rawBytes === "string" && holdA.rawBytes.length > 0, "genuine producer response bytes must be retained for A");
      assertMoveOnly(stateSamples.find(s => s.phase === "reverse-commit-B")!.state, committedA, projA.id);
      assert.ok(await pollUntil(() => acks.some(a => a.chatId === overlap.id && a.body?.projectId === projA.id && a.status === 200), 5000), "A's real 200 acknowledgment must arrive after release");
      const ackB = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projB.id);
      const ackA = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projA.id);
      assert.ok(ackB && ackA, "both acknowledgments must exist");
      assert.ok(ackB.at < ackA.at, "the A acknowledgment must be delivered LAST (B first)");
      assert.ok(await pollUntil(() => log().slice(logOffsetAtRelease!).includes(`PATCH /api/me/chats/${overlap.id} 200`), 5000), "a NEW matching PATCH 200 must appear in the operation-local post-release log segment; the raw response and SQLite state remain the primary commit evidence");
      assert.equal(failures.length, 0);
      assert.equal(writes.filter(w => w.chatId === overlap.id && w.body?.projectId !== undefined).length, 2, "exactly one PATCH attempt per target; no replay of either move");
      await frames(); await rec.screenshot(owner.page, "reverse-a-committed-acked-last");
      // Adapter note: drag gestures leave the drawer open, and its overlay then
      // intercepts the pointer on the main content, so the direct consumers'
      // regenerate/edit hovers would time out. Close through the drawer's real
      // close button and let two committed frames land before the late-memory
      // release and any direct consumer. Closing is pure local drawer state —
      // no chat GET, so it cannot repair the refs the consumers are judged on.
      await closeSidebar(); await frames();
      return { committedA, holdAResponse: { status: holdA.status, body: holdA.body, rawBytes: holdA.rawBytes, forwardReleasedAt: holdA.forwardReleasedAt, commitObservedAt: holdA.commitObservedAt, deliveredAt: holdA.deliveredAt }, acknowledgmentDelivery: [{ phase: "B", at: ackB.at }, { phase: "A", at: ackA.at }], postReleaseLogSegment: log().slice(logOffsetAtRelease!) };
    });
    requireGate("browser.reverse-a-release-commit-ack-last");
    await g("reverse-commit-order-schedule", async () => {
      const ackB = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projB.id);
      const ackA = acks.find(a => a.chatId === overlap.id && a.body?.projectId === projA.id);
      assert.ok(ackB && ackA, "prerequisite: both acknowledgments delivered");
      const schedule = {
        gestures: dialogs.filter(d => d.chat === overlap.title).map(d => ({ target: d.destination, at: d.at })),
        requests: [{ phase: "A", at: holdA.captured.at }, { phase: "B", at: holdB.captured.at }],
        forwardRelease: [{ phase: "A", at: holdA.forwardReleasedAt }, { phase: "B", at: null as number | null }],
        responsesCaptured: [{ phase: "A", at: holdA.commitObservedAt }, { phase: "B", at: holdB.commitObservedAt }],
        commits: stateSamples.filter(s => s.phase === "reverse-commit-A" || s.phase === "reverse-commit-B").map(s => ({ phase: s.phase.replace("reverse-commit-", ""), at: s.at, projectId: s.state.session.project_id })),
        acknowledgmentsDelivered: [{ phase: "B", at: ackB.at }, { phase: "A", at: ackA.at }],
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
      assert.equal(schedule.commits[0].projectId, projB.id, "observed commit order is B then A");
      assert.equal(schedule.commits[1].projectId, projA.id);
      assert.ok(ackB.at < ackA.at, "acknowledgment delivery order is B then A (A last)");
      assert.equal(schedule.finalAssociation, projA.id, "the final observed association follows the observed commit order, not gesture or acknowledgment order");
      assert.equal(writes.filter(w => w.chatId === overlap.id && w.body?.projectId !== undefined).length, 2, "no replayed or extra move attempts");
      schedules.push(schedule);
      return { schedule, outcomes: { A: "accepted; committed last; final observed association", B: "accepted at its commit with a real 200 acknowledgment; later superseded in storage by the accepted A commit — not rejected, replayed or rolled back" }, discrimination: "gestures A→B with observed commits B→A and acknowledgment delivery B→A: this schedule distinguishes observed commit truth from latest-dispatched selection, which the previous A→B commit / B→A acknowledgment schedule cannot", inferenceGuard: "observations of this executed schedule only; unchanged atomic full-snapshot LWW, no latest-start-wins/CAS/stale-write-rejection/merged-history rule asserted or implied" };
    });
    requireGate("browser.reverse-commit-order-schedule");
    c.release(q, [{ memory_update: late }]);
    await g("reverse-late-compaction", async () => {
      const got = await f.durable(owner, ctx, overlap.id, late, answer);
      assert.equal(got.http.body.projectId, projA.id, "valid held late compaction remains eligible and saves the observed final association A");
      assert.deepEqual(f.projection(got.http.body.messages), f.projection(origin));
      return got;
    });
    requireGate("browser.reverse-late-compaction");
    const regenReads = reads.length;
    await owner.clickRegenerate(); await waitActive(q, 2);
    await g("reverse-regenerate-at-send", async () => consume(q, overlap, projA.id, regenReads, overlap.base, [instructionsA], [instructionsB]));
    c.release(q, [{ memory_update: f.blob("reverse-regenerate-final") }, f.done]);
    await g("reverse-regenerate-settles", async () => {
      const got = await f.durable(owner, ctx, overlap.id, f.blob("reverse-regenerate-final"), "Reverse regenerated redo");
      assert.equal(got.http.body.projectId, projA.id);
      assert.equal(got.http.body.assistantId, ctx.ids.soul);
      assert.deepEqual(f.projection(got.http.body.messages).slice(0, overlap.base.length), f.projection(overlap.base));
      await rec.screenshot(owner.page, "reverse-regenerate-settled");
      return got;
    });
    const editedQ = `reverse-edited-${ctx.label}`;
    c.plans.set(editedQ, [{ frames: [{ content: "Reverse edited redo" }], holdOnly: true }]);
    const editReads = reads.length;
    await owner.editLastMessage(q, editedQ); await waitActive(editedQ, 1);
    await g("reverse-edit-at-send", async () => consume(editedQ, overlap, projA.id, editReads, overlap.base, [instructionsA], [instructionsB]));
    c.release(editedQ, [{ memory_update: f.blob("reverse-edit-final") }, f.done]);
    await g("reverse-edit-settles", async () => {
      const got = await f.durable(owner, ctx, overlap.id, f.blob("reverse-edit-final"), "Reverse edited redo");
      assert.equal(got.http.body.projectId, projA.id);
      assert.equal(got.http.body.assistantId, ctx.ids.soul);
      assert.deepEqual(f.projection(got.http.body.messages).slice(0, overlap.base.length), f.projection(overlap.base));
      await rec.screenshot(owner.page, "reverse-edit-settled");
      return got;
    });
    sample("reverse-final", state(ctx, overlap.id));
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
    for (const h of holds) await h.close();
    ctx.check("browser.no-page-errors", !owner.pageErrors.length, owner.pageErrors);
    ctx.check("browser.no-blocked-requests", !owner.blocked.length, owner.blocked);
    // Mode-correct drain: "preforward" requires its forward release, response and
    // delivery; "hold" requires response, manual release and delivery; "pass"
    // requires forward and delivery without inventing a manual-release obligation.
    ctx.check("browser.responses-drained", !c.held.length && !c.unmatched.length && !ctx.upstream.pending.size && holds.every(h => h.row.delivered &&
      (h.row.mode === "pass" ? h.row.fetched : h.row.mode === "preforward" ? (h.row.forwardReleasedAt !== null && h.row.fetched) : (h.row.fetched && h.row.released))),
      { held: c.held, unmatched: c.unmatched, drain: holds.map(h => ({ sequence: h.row.sequence, mode: h.row.mode, chatId: h.row.chatId, projectId: h.row.projectId, capturedAt: h.row.captured?.at ?? null, forwardReleasedAt: h.row.forwardReleasedAt, fetched: h.row.fetched, commitObservedAt: h.row.commitObservedAt, delivered: h.row.delivered, deliveredAt: h.row.deliveredAt, released: h.row.released })) });
    writeFileSync(join(rec.dir, "move-reverse-observations.json"), JSON.stringify({ writes, acknowledgments: acks, failures, asks, reads, listResponses: lists, dialogs, consumers, schedules,
      holds: holds.map(h => ({ sequence: h.row.sequence, actor: h.row.actor, chatId: h.row.chatId, projectId: h.row.projectId, mode: h.row.mode, captured: h.row.captured, reserved: h.row.reserved, forwardReleasedAt: h.row.forwardReleasedAt, status: h.row.status, body: h.row.body, rawBytes: h.row.rawBytes, commitObservedAt: h.row.commitObservedAt, released: h.row.released, delivered: h.row.delivered, deliveredAt: h.row.deliveredAt })),
      stateSamples, consoleErrors, observations: rec.observations }, null, 2));
    await owner.close();
  }
}
