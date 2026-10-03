// ask-shutdown-v1: real Chromium consumers; genuine held loopback SSE shutdown.
// No runtime mutations. Personal chats avoid project normal-send's repairing GET.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askQuestionStream } from "../src/lib/api";
import { BrowserSession, Recorder, browserPrerequisites, pollUntil, setAppLocale } from "./chat-browser-checks";
import { projectFixture as f } from "./chat-project-followup-checks";

export const SHUTDOWN_HTTP_GATES = ["http.settled", "http.legacy", "http.shutdown-replay", "http.exhaustion", "http.responses-drained"];
const cases = ["settled", "legacy", "shutdown", "exhaustion"];
export const SHUTDOWN_BROWSER_GATES = ["browser.login-dark-en-de", ...cases.flatMap(c => [
  `browser.${c}.input-control`, `browser.${c}.transport`, `browser.${c}.exact-durable`,
  `browser.${c}.feedback-no-repair`, `browser.${c}.regenerate-at-send`, `browser.${c}.regenerate-settles`,
]), "browser.patch-acknowledgments", "browser.no-page-errors", "browser.no-blocked-requests", "browser.responses-drained"];
const restartError = "Error: Connection lost while the server was restarting";
const shutdown = 'event: shutdown\ndata: {"reason":"rolling_restart"}\n\n';
const blob = (tag: string) => ({ unknown: [null, "日本語", { tag, nested: [false, 0, "\\\"\n"] }], opaque: tag });
type Step = { frames: unknown[]; held?: boolean };

// Local adapter emits raw strings verbatim (the existing shared controller only
// JSON-encodes initial frames). Release uses the unchanged runtime's raw writer.
function controller(ctx: any) {
  const plans = new Map<string, Step[]>(), holds: any[] = [], unmatched: any[] = [];
  const events: any[] = [];
  ctx.upstream.setHandler((_req: any, res: any, record: any) => {
    if (record.path.split("?")[0] === "/api/collections") { res.setHeader("Content-Type", "application/json"); res.end("[]"); return; }
    const step = record.method === "POST" && record.path === "/api/ask/stream" ? plans.get(record.body?.question)?.shift() : undefined;
    if (!step) { unmatched.push(record); res.writeHead(500); res.end("no shutdown fixture plan"); return; }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" });
    res.flushHeaders();
    for (const frame of step.frames) res.write(typeof frame === "string" ? frame : `data: ${JSON.stringify(frame)}\n\n`);
    events.push({ kind: "dispatch", seq: record.seq, id: record.id, frames: step.frames, at: Date.now() });
    if (step.held) holds.push(record); else res.end();
  });
  function release(q: string, frames: unknown[]) {
    const index = holds.findIndex(r => r.body.question === q); assert.ok(index >= 0, `held response required: ${q}`);
    const [r] = holds.splice(index, 1); events.push({ kind: "release", seq: r.seq, id: r.id, frames, at: Date.now() });
    ctx.upstream.release(r.id, frames);
  }
  async function held(q: string, count: number) {
    assert.ok(await pollUntil(() => ctx.upstream.requests.filter((r: any) => r.body?.question === q).length === count &&
      holds.some(r => r.body.question === q), 15000), `attempt ${count} must genuinely reach held upstream: ${q}`);
  }
  return { plans, holds, unmatched, events, release, held };
}
export function exact(d: any, expected: any[], memory: unknown) {
  assert.equal(d.http.status, 200);
  assert.deepEqual(f.projection(d.http.body.messages), f.projection(expected));
  assert.deepEqual(f.projection(d.sqlite.messages), f.projection(expected));
  assert.deepEqual(d.http.body.memory, memory); assert.equal(d.sqlite.session.memory, JSON.stringify(memory));
}
export function replay(records: any[], count: number, pre: unknown, base: any[]) {
  assert.equal(records.length, count); assert.ok(records[0].id && records[0].id !== "null");
  assert.equal(new Set(records.map(r => r.id)).size, 1);
  for (const r of records) {
    assert.deepEqual(r.body, records[0].body); assert.deepEqual(r.body.conversation_memory, pre);
    assert.deepEqual(r.body.conversation_history.slice(-base.length), base.map(m => ({ role: m.role, content: m.content })));
    assert.equal(r.body.session_id, undefined); assert.equal(r.headers["accept-encoding"], "identity");
  }
}
async function personal(ctx: any, cookie: string, name: string, base: any[], pre: unknown) {
  const id = (await f.json(ctx, "/api/me/chats", cookie, "POST", { title: name })).id;
  await f.patch(ctx, cookie, id, base, pre); return id;
}
async function exactSettled(s: BrowserSession, ctx: any, id: string, base: any[], q: string, answer: string, value: unknown) {
  const d = await s.durableSettled(ctx, id, d => JSON.stringify(d.http.body?.memory) === JSON.stringify(value) &&
    d.sqlite.session?.memory === JSON.stringify(value) && d.http.body?.messages?.at(-1)?.content === answer);
  const messages = d.http.body.messages;
  assert.equal(messages.length, base.length + 2); assert.deepEqual(f.projection(messages).slice(0, -2), base);
  assert.equal(messages.at(-2).role, "user"); assert.equal(messages.at(-2).content, q);
  assert.equal(messages.at(-1).role, "assistant"); assert.equal(messages.at(-1).content, answer);
  assert.equal(new Set(messages.map((m: any) => m.id)).size, messages.length);
  exact(d, messages, value); return { d, messages };
}

export async function runShutdownBrowser(ctx: any) {
  const rec = new Recorder(join(ctx.workDir, "logs")), p = browserPrerequisites(); assert.deepEqual(p.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(p.pwPath, "index.js"));
  copyFileSync(join(ctx.appDir, "src/app/page.tsx"), join(rec.dir, "input-page.tsx"));
  writeFileSync(join(rec.dir, "tooling.json"), JSON.stringify({ ...p, version: JSON.parse(readFileSync(join(p.pwPath, "package.json"), "utf8")).version,
    browserProfileTmpdir: process.env.TMPDIR, install: false }, null, 2));
  const s = new BrowserSession(pw, p.chromiumPath, ctx.baseUrl, rec), c = controller(ctx);
  const acks: any[] = [], browserAsks: any[] = [], reads: any[] = [];
  try {
    await s.start();
    s.context.on("request", (r: any) => {
      const path = new URL(r.url()).pathname;
      if (r.method() === "GET" && /^\/api\/me\/chats\/[^/]+$/.test(path)) reads.push({ path, at: Date.now() });
      if (path === "/api/ask/stream") browserAsks.push({ body: r.postDataJSON(), id: r.headers()["x-request-id"], at: Date.now() });
    });
    s.context.on("response", (r: any) => {
      if (r.request().method() === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(new URL(r.url()).pathname))
        acks.push({ status: r.status(), url: r.url(), at: Date.now() });
    });
    await s.login(ctx, ctx.users.owner.email, ctx.users.owner.password);
    await f.gate(ctx, "browser.login-dark-en-de", async () => {
      assert.equal((await f.json(ctx, "/api/auth/me", s.cookie)).id, ctx.users.owner.id);
      assert.equal(await s.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de"); await s.page.reload(); await s.waitForComposer();
      assert.equal(await s.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research...");
      await rec.screenshot(s.page, "shutdown-dark-de");
      setAppLocale(ctx.dataDir, "en"); await s.page.reload(); await s.waitForComposer();
      assert.equal(await s.composer().getAttribute("placeholder"), "Ask a complex question for deep research...");
      return { forms: 1, locales: ["en", "de"] };
    });
    for (const kind of cases) {
      const base = f.pair(`fx-shutdown-${kind}`, `${kind} retained prefix`), pre = blob(`${kind}-at-send`);
      const value = kind === "exhaustion" ? pre : blob(`${kind}-final`);
      const q = `${kind}-question-${ctx.label}`, answer = kind === "exhaustion" ? restartError : `${kind} complete replacement answer`;
      const id = await personal(ctx, s.cookie, `Shutdown ${kind}`, base, pre);
      await s.page.goto(`${ctx.baseUrl}/?chat=${id}`, { waitUntil: "domcontentloaded" }); await s.waitForComposer();
      assert.ok(await f.visible(s, base[1].content));
      const readStart = reads.length, patchStart = rec.patches.length;
      if (kind === "settled" || kind === "legacy") c.plans.set(q, [{ frames: [
        ...(kind === "legacy" ? [{ memory_update: value }] : []), { content: answer }, f.done,
      ], held: kind === "settled" }]);
      else c.plans.set(q, [0, 1, 2].map(i => ({ frames: i === 0 ? [{ content: `${kind} discarded partial ${i}` }] : [], held: true })));
      await s.send(q);
      await f.gate(ctx, `browser.${kind}.input-control`, async () => {
        assert.ok(await pollUntil(() => ctx.upstream.requests.some((r: any) => r.body?.question === q), 15000));
        replay(ctx.upstream.requests.filter((r: any) => r.body?.question === q), 1, pre, base);
        return { base, pre };
      });
      await f.gate(ctx, `browser.${kind}.transport`, async () => {
        if (kind === "shutdown" || kind === "exhaustion") {
          for (let attempt = 0; attempt < 3; attempt++) {
            await c.held(q, attempt + 1);
            if (attempt > 0) {
              assert.ok(await pollUntil(async () => !(await s.page.locator("main").innerText()).includes(`${kind} discarded partial`), 8000),
                "reconnect clears old partial before replay content arrives");
              const before = await s.durable(ctx, id); exact(before, base, pre);
              assert.equal(rec.patches.length, patchStart, "unfinished attempts must not persist");
              await rec.screenshot(s.page, `${kind}-cleared-${attempt}`);
              const held = c.holds.find(r => r.body.question === q);
              // Genuine token progress on the held socket, not DOM fabrication.
              const text = attempt === 2 && kind === "shutdown" ? answer : `${kind} discarded partial ${attempt}`;
              ctx.upstream.pending.get(held.id).response.write(`data: ${JSON.stringify({ content: text })}\n\n`);
              rec.obs("held-token", { seq: held.seq, text });
            }
            const text = attempt === 2 && kind === "shutdown" ? answer : `${kind} discarded partial ${attempt}`;
            assert.ok(await f.visible(s, text)); await rec.screenshot(s.page, `${kind}-partial-${attempt}`);
            if (attempt < 2 || kind === "exhaustion") c.release(q, [shutdown]);
          }
          if (kind === "shutdown") {
            // done-visible with post-answer compaction still genuinely held.
            const held = c.holds.find(r => r.body.question === q);
            ctx.upstream.pending.get(held.id).response.write(`data: ${JSON.stringify(f.done)}\n\n`);
            await s.waitAnswerVisible(answer);
            await exactSettled(s, ctx, id, base, q, answer, pre);
            c.release(q, [{ memory_update: value }]);
          } else {
            await s.waitAnswerVisible(restartError);
            // Observe longer than the 1s retry interval; reject a fourth dispatch.
            await new Promise(r => setTimeout(r, 1500));
          }
          replay(ctx.upstream.requests.filter((r: any) => r.body?.question === q), 3, pre, base);
          const browser = browserAsks.filter(r => r.body.question === q);
          assert.equal(browser.length, 3); assert.equal(new Set(browser.map(r => r.id)).size, 1);
          assert.equal(browser[0].id, ctx.upstream.requests.find((r: any) => r.body?.question === q).id);
          for (const r of browser) assert.deepEqual(r.body, browser[0].body);
        } else {
          await s.waitAnswerVisible(answer);
          if (kind === "settled") { await exactSettled(s, ctx, id, base, q, answer, pre); c.release(q, [{ memory_update: value }]); }
          replay(ctx.upstream.requests.filter((r: any) => r.body?.question === q), 1, pre, base);
        }
        assert.equal(reads.length, readStart, "transport/retry must not repair via chat GET");
        return { requests: ctx.upstream.requests.filter((r: any) => r.body?.question === q), events: c.events.filter(e =>
          ctx.upstream.requests.some((r: any) => r.seq === e.seq && r.body?.question === q)) };
      });
      let selected: any[] = [];
      await f.gate(ctx, `browser.${kind}.exact-durable`, async () => {
        const result = await exactSettled(s, ctx, id, base, q, answer, value); selected = result.messages;
        assert.equal((await s.page.locator("main").innerText()).includes(`${kind} discarded partial`), false);
        for (const patch of rec.patches.slice(patchStart)) assert.equal(JSON.stringify(patch.body).includes("discarded partial"), false);
        await rec.screenshot(s.page, `${kind}-durable`); return result;
      });
      await f.gate(ctx, `browser.${kind}.feedback-no-repair`, async () => {
        assert.ok(selected.length); const before = reads.length;
        const got = await f.feedback(s, ctx, id, selected, value, answer);
        assert.equal(reads.length, before); return got;
      });
      c.plans.set(q, [{ frames: [{ content: `${kind} explicit recovery answer` }], held: true }]);
      const priorRequests = ctx.upstream.requests.filter((r: any) => r.body?.question === q);
      const redoReadStart = reads.length;
      await s.clickRegenerate(); await c.held(q, priorRequests.length + 1);
      await f.gate(ctx, `browser.${kind}.regenerate-at-send`, async () => {
        const redo = ctx.upstream.requests.filter((r: any) => r.body?.question === q).at(-1);
        assert.notEqual(redo.id, priorRequests[0].id, "explicit user action gets a fresh correlation ID");
        replay([redo], 1, pre, base); assert.equal(reads.length, redoReadStart);
        return redo;
      });
      c.release(q, [{ memory_update: blob(`${kind}-recovery`) }, { done: true }]);
      await f.gate(ctx, `browser.${kind}.regenerate-settles`, async () => {
        const result = await exactSettled(s, ctx, id, base, q, `${kind} explicit recovery answer`, blob(`${kind}-recovery`));
        await s.page.reload({ waitUntil: "domcontentloaded" }); await s.waitAnswerVisible(`${kind} explicit recovery answer`);
        return { ...result, reloaded: true };
      });
    }
    await pollUntil(() => acks.length === rec.patches.length, 10000);
    await f.gate(ctx, "browser.patch-acknowledgments", async () => {
      assert.ok(acks.length > 0); assert.equal(acks.length, rec.patches.length); assert.ok(acks.every(a => a.status === 200));
      return { patches: rec.patches, acknowledgments: acks };
    });
  } finally {
    ctx.check("browser.no-page-errors", !s.pageErrors.length, s.pageErrors);
    ctx.check("browser.no-blocked-requests", !s.blocked.length, s.blocked);
    ctx.check("browser.responses-drained", !c.holds.length && !c.unmatched.length && !ctx.upstream.pending.size,
      { holds: c.holds, unmatched: c.unmatched });
    writeFileSync(join(rec.dir, "shutdown-observations.json"), JSON.stringify({ observations: rec.observations,
      patches: rec.patches, acknowledgments: acks, browserAsks, reads, events: c.events }, null, 2));
    await s.close();
  }
}

export async function runShutdownHttp(ctx: any) {
  const cookie = await f.login(ctx, "owner"), c = controller(ctx), originalFetch = globalThis.fetch;
  // Actual browser parser with only transport URL/cookie adaptation. Driver
  // writes below are explicitly HTTP persistence evidence, not UI orchestration.
  globalThis.fetch = async (_url, init) => {
    // ctx.request and persistence helpers use absolute URLs; preserve their
    // real transport instead of recursively adapting the adapter itself.
    if (String(_url) !== "/api/ask/stream") return originalFetch(_url, init);
    const res = await ctx.request("/api/ask/stream", { method: "POST", cookie,
      headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) });
    assert.equal(res.headers.get("x-request-id"), new Headers(init?.headers).get("x-request-id")); return res;
  };
  try {
    for (const kind of cases) await f.gate(ctx, `http.${kind === "shutdown" ? "shutdown-replay" : kind}`, async () => {
      const q = `http-${kind}-${ctx.label}`, base = f.pair(`fx-http-shutdown-${kind}`, `${kind} HTTP prefix`), pre = blob(`http-${kind}-pre`);
      const value = kind === "exhaustion" ? pre : blob(`http-${kind}-final`), trace: any[] = [];
      const answer = kind === "exhaustion" ? "Connection lost while the server was restarting" : `${kind} HTTP final answer`;
      c.plans.set(q, kind === "shutdown" || kind === "exhaustion" ? [0, 1, 2].map(i => ({ frames:
        i < 2 || kind === "exhaustion" ? [{ content: `discarded ${i}` }, shutdown] : [{ content: answer }, { done: true }, { memory_update: value }] })) :
        [{ frames: kind === "legacy" ? [{ memory_update: value }, { content: answer }, { done: true }] :
          [{ content: answer }, { done: true }, { memory_update: value }] }]);
      let content = "", memory: unknown = pre;
      await askQuestionStream({ question: q, conversation_memory: pre, conversation_history: base.map(m => ({ role: m.role as "user" | "assistant", content: m.content })) }, {
        onContent(t) { content += t; trace.push(["content", t]); }, onReconnect() { content = ""; trace.push(["reconnect"]); },
        onMemoryUpdate(m) { memory = m; trace.push(["memory", m]); }, onDone() { trace.push(["done"]); },
        onError(e) { content = e; trace.push(["error", e]); }, onSources() {}, onGraphContext() {}, onThinking() {},
        onSubQuestions() {}, onRetrieval() {}, onRetrievalStats() {}, onStatus() {},
      });
      replay(ctx.upstream.requests.filter((r: any) => r.body?.question === q), ["shutdown", "exhaustion"].includes(kind) ? 3 : 1, pre, base);
      assert.equal(content, answer); assert.deepEqual(memory, value);
      assert.equal(trace.filter(t => t[0] === "reconnect").length, ["shutdown", "exhaustion"].includes(kind) ? 2 : 0);
      assert.equal(trace.filter(t => t[0] === "error").length, kind === "exhaustion" ? 1 : 0);
      assert.equal(trace.filter(t => t[0] === "done").length, kind === "exhaustion" ? 0 : 1);
      const id = await personal(ctx, cookie, `HTTP ${kind}`, base, pre);
      const expected = [...base, { id: `fx-http-${kind}-q`, role: "user", content: q }, { id: `fx-http-${kind}-a`, role: "assistant", content }];
      const durable = await f.patch(ctx, cookie, id, expected, value); return { trace, durable, driverPersistence: true };
    });
  } finally { globalThis.fetch = originalFetch; }
  ctx.check("http.responses-drained", !c.holds.length && !c.unmatched.length && !ctx.upstream.pending.size, { holds: c.holds, unmatched: c.unmatched });
}
