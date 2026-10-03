// project-terminal-v1.4: terminal edit and different/fresh-page stored fallback.
// Fixed synthetic snapshots are the oracle; direct consumers never rebase.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectFixture as F } from "./chat-project-followup-checks";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController, pollUntil, setAppLocale } from "./chat-browser-checks";

const cases = ["local-edit", "different-edit", "different-regenerate", "fresh-edit", "fresh-regenerate"] as const;
export const TERMINAL_HTTP_GATES = ["http.read-control", "http.different-owned-exchange", "http.direct-stored-fork", "http.eligible-origin-lww"];
export const TERMINAL_BROWSER_GATES = [
  "browser.logins-dark-locales",
  ...cases.flatMap(k => ["done-visible", "adoption-read-only", "return-selection", "feedback-coherence", "consumer-memory-prefix", "consumer-no-repairing-get", "fork-settles", "origin-eligibility"].map(n => `browser.${k}.${n}`)),
  "browser.patch-acknowledgments", "browser.no-page-errors", "browser.no-blocked-requests", "browser.all-responses-released",
];
export async function runTerminalHttp(ctx: any) {
  const owner = await F.login(ctx, "owner"), member = await F.login(ctx, "member"), id = await F.create(ctx, owner, "HTTP terminal fallback");
  const origin = F.pair("fx-terminal-http-origin", "HTTP original"), initial = F.blob("http-at-send"), stored = F.blob("http-stored");
  await F.patch(ctx, owner, id, origin, initial);
  await F.gate(ctx, TERMINAL_HTTP_GATES[0], async () => {
    const got = await F.json(ctx, `/api/me/chats/${id}`, member); assert.deepEqual(got.memory, initial); return got;
  });
  const adopted = [...origin, ...F.pair("fx-terminal-http-different", "HTTP different owned")];
  await F.patch(ctx, owner, id, adopted, stored);
  await F.gate(ctx, TERMINAL_HTTP_GATES[1], async () => {
    const got = await F.patch(ctx, member, id, adopted, stored);
    assert.ok(got.messages.every((m: any) => m.authorId === ctx.users.owner.id)); return got;
  });
  const fork = [...origin, ...F.pair("fx-terminal-http-fork", "HTTP direct fork")];
  await F.gate(ctx, TERMINAL_HTTP_GATES[2], () => F.patch(ctx, owner, id, fork, stored));
  await F.gate(ctx, TERMINAL_HTTP_GATES[3], () => F.patch(ctx, owner, id, origin, F.blob("http-origin-late")));
}

// Playwright route `times` counts PATCH fallthrough too. Reserve only the two
// real GETs from this document (effect entry + native open), in dispatch order.
async function holdTerminalReads(s: BrowserSession, ctx: any, id: string) {
  const reads: any[] = [], filtered: any[] = [], matcher = `${ctx.baseUrl}/api/me/chats/${id}`;
  const handler = async (route: any) => {
    const request = route.request();
    if (request.method() !== "GET" || request.frame().page() !== s.page || reads.length >= 2) {
      filtered.push({ method: request.method(), url: request.url() }); return route.fallback();
    }
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const row = { sequence: reads.length + 1, body: null as any, status: null as number | null, release, delivered: false };
    reads.push(row);
    const response = await route.fetch(); row.status = response.status(); row.body = await response.json();
    await barrier; await route.fulfill({ response }); row.delivered = true;
  };
  await s.context.route(matcher, handler);
  return { reads, filtered, async close() {
    for (const row of reads) row.release();
    await s.context.unroute(matcher, handler);
  } };
}

export async function runTerminalBrowser(ctx: any) {
  const recorder = new Recorder(join(ctx.workDir, "logs"));
  copyFileSync(join(ctx.appDir, "src/app/page.tsx"), join(recorder.dir, "input-page.tsx"));
  const prereq = browserPrerequisites(); assert.deepEqual(prereq.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(prereq.pwPath, "index.js"));
  writeFileSync(join(recorder.dir, "tooling.json"), JSON.stringify({ ...prereq, launcherSha256: createHash("sha256").update(readFileSync(prereq.chromiumPath)).digest("hex"),
    launcher: readFileSync(prereq.chromiumPath, "utf8"), playwrightVersion: JSON.parse(readFileSync(join(prereq.pwPath, "package.json"), "utf8")).version,
    browserProfileTmpdir: process.env.TMPDIR, install: false }, null, 2));
  const owner = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder), member = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder);
  const sessions = [owner, member], controller = makeUpstreamController(ctx), acknowledgments: any[] = [], reads: any[] = [], observations: any[] = [];
  const freshPages: any[] = [], barriers: any[] = [];
  const g = (id: string, fn: () => Promise<unknown>) => F.gate(ctx, `browser.${id}`, fn);
  try {
    for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) {
      await s.start(s === member ? owner.browser : undefined);
      await s.context.addInitScript(() => {
        const Original = window.EventSource; (window as any).__followupFeeds = [];
        window.EventSource = class extends Original {
          observation: any;
          constructor(url: string | URL, init?: EventSourceInit) { super(url, init);
            const row = { url: String(url), ready: 0, opens: 0, errors: 0, closed: false, events: [] as any[] };
            this.observation = row; (window as any).__followupFeeds.push(row);
            this.addEventListener("open", () => { row.ready = this.readyState; row.opens++; });
            this.addEventListener("error", () => { row.ready = this.readyState; row.errors++; });
            this.addEventListener("message", e => row.events.push(JSON.parse(e.data)));
          }
          close() { this.observation.closed = true; this.observation.ready = 2; super.close(); }
        };
      });
      s.context.on("request", (r: any) => { if (r.method() === "GET" && /\/api\/me\/chats\/[^/?]+$/.test(new URL(r.url()).pathname)) reads.push({ url: r.url(), at: Date.now() }); });
      s.context.on("response", (r: any) => { if (r.request().method() === "PATCH" && /\/api\/me\/chats\/[^/?]+$/.test(new URL(r.url()).pathname)) acknowledgments.push({ url: r.url(), status: r.status() }); });
      await s.login(ctx, ctx.users[name].email, ctx.users[name].password);
    }
    await g("logins-dark-locales", async () => {
      for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) assert.equal((await F.json(ctx, "/api/auth/me", s.cookie)).id, ctx.users[name].id);
      assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de"); await owner.page.reload(); await owner.waitForComposer();
      assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research..."); await recorder.screenshot(owner.page, "terminal-dark-de");
      setAppLocale(ctx.dataDir, "en"); await owner.page.reload(); await owner.waitForComposer();
      assert.equal(await owner.composer().getAttribute("placeholder"), "Ask a complex question for deep research..."); return { locales: ["de", "en"] };
    });
    // The member's real login is verified above; later member writes use HTTP.
    // Retire its unused renderer, retaining the context's all-page diagnostics.
    await member.page.close();
    for (const kind of cases) {
      const fresh = kind.startsWith("fresh"), different = kind.startsWith("different"), edit = kind.endsWith("edit");
      const id = await F.create(ctx, owner.cookie, `Terminal ${kind}`), prefix = F.pair(`fx-terminal-${kind}`, `${kind} prefix`), initial = F.blob(`${kind}-at-send`), stored = F.blob(`${kind}-stored`), late = F.blob(`${kind}-origin-late`);
      await F.patch(ctx, owner.cookie, id, prefix, initial); await F.open(owner, ctx, id, prefix[1].content);
      const q = `terminal-${kind}-${ctx.label}`, answer = `${kind} origin answer`, redo = `${kind} fork answer`, edited = `edited-${kind}-${ctx.label}`;
      controller.plans.set(q, [{ frames: [{ content: answer }, F.done], holdOnly: true }, ...(!edit && !different ? [{ frames: [{ content: redo }], holdOnly: true }] : [])]);
      await owner.send(q); await owner.waitAnswerVisible(answer); await F.ready(owner, id);
      const origin = (await F.durable(owner, ctx, id, initial, answer)).http.body.messages;
      await g(`${kind}.done-visible`, async () => { assert.equal(await owner.page.locator('button[title="Stop"]').count(), 0); assert.equal(controller.held.length, 1); return { origin, initial }; });
      const remote = different ? [...origin, ...F.pair(`fx-terminal-${kind}-adopted`, `${kind} adopted exchange`)]
        : origin.map((m: any) => m.content === answer ? { ...m, content: `${kind} adopted same-exchange answer`, feedback: "up" } : m);
      const writes = recorder.patches.length;
      // Another client of the same user establishes an own-authored tail; a
      // member replace preserves its IDs/authorship and genuinely signals adoption.
      if (different) await F.patch(ctx, owner.cookie, id, remote, stored);
      await F.patch(ctx, member.cookie, id, remote, stored);
      await g(`${kind}.adoption-read-only`, async () => {
        assert.ok(await F.visible(owner, remote.at(-1).content)); assert.equal(recorder.patches.length, writes);
        const got = await F.json(ctx, `/api/me/chats/${id}`, owner.cookie);
        assert.equal(got.messages.at(-2).authorId, ctx.users.owner.id); return { remote, stored, writes: 0 };
      });
      await owner.newChatViaSidebar(); await owner.page.goBack(); await owner.waitForComposer(); await F.ready(owner, id);
      let consumer = owner;
      if (fresh) {
        // New document, same authenticated context: no local turn registry.
        // Keep the origin page/transport alive so fresh-page action cannot cancel it.
        consumer = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder);
        consumer.context = owner.context; consumer.cookie = owner.cookie; consumer.page = await owner.context.newPage();
        freshPages.push(consumer.page); await F.open(consumer, ctx, id, remote.at(-1).content);
      }
      await g(`${kind}.return-selection`, async () => {
        assert.ok(await F.visible(consumer, remote.at(-1).content)); assert.equal(await consumer.page.locator('button[title="Stop"]').count(), 0);
        assert.equal(await consumer.page.locator('button[aria-label="Regenerate"]').count(), 1); assert.equal(controller.held.length, 1);
        await recorder.screenshot(consumer.page, `terminal-${kind}-return`); return { remote, stored, fresh, url: consumer.page.url() };
      });
      await g(`${kind}.feedback-coherence`, () => F.feedback(consumer, ctx, id, remote, stored, remote.at(-1).content));
      // Hold redo completion: reopening/adopting after completion is legitimate,
      // but no GET may repair recall before this direct consumer dispatches.
      const requestsBefore = reads.length, sourceQuestion = remote.at(-2).content, targetQuestion = edit ? edited : sourceQuestion;
      if (edit || different) controller.plans.set(targetQuestion, [{ frames: [{ content: redo }], holdOnly: true }]);
      if (edit) await consumer.editLastMessage(sourceQuestion, targetQuestion); else await consumer.clickRegenerate();
      await g(`${kind}.consumer-memory-prefix`, async () => {
        assert.ok(await pollUntil(() => ctx.upstream.requests.some((r: any) => r.body?.question === targetQuestion && r.body?.conversation_history?.at(-1)?.content !== undefined && (edit || different || ctx.upstream.requests.filter((r: any) => r.body?.question === q).length === 2)), 10000));
        const sent = ctx.upstream.requests.filter((r: any) => r.body?.question === targetQuestion).at(-1).body;
        assert.deepEqual(sent.conversation_memory, fresh || different ? stored : initial);
        const expectedBase = remote.slice(0, -2);
        assert.deepEqual(sent.conversation_history.slice(-expectedBase.length), expectedBase.map((m: any) => ({ role: m.role, content: m.content })));
        return sent;
      });
      await g(`${kind}.consumer-no-repairing-get`, async () => { assert.equal(reads.length, requestsBefore); return { readsDuringConsumer: reads.slice(requestsBefore), redoStillHeld: controller.held }; });
      // Stabilize the real post-completion adoption response, not the DOM while
      // it is still free to change between observation and a feedback click.
      const adoption = fresh ? await holdTerminalReads(consumer, ctx, id) : null;
      if (adoption) barriers.push(adoption);
      const forkHeld = controller.held.find(h => h.id === ctx.upstream.requests.filter((r: any) => r.body?.question === targetQuestion).at(-1).id);
      assert.ok(forkHeld); controller.held.splice(controller.held.indexOf(forkHeld), 1);
      ctx.upstream.release(forkHeld.id, [F.memory(F.blob(`${kind}-fork`)), F.done]);
      const fork = await F.durable(consumer, ctx, id, F.blob(`${kind}-fork`), redo);
      await g(`${kind}.fork-settles`, async () => { assert.deepEqual(F.projection(fork.http.body.messages).slice(0, -2), F.projection(remote.slice(0, -2))); return fork; });
      const beforeLate = recorder.patches.length;
      if (!fresh) controller.release(q, [F.memory(late)]);
      await g(`${kind}.origin-eligibility`, async () => {
        if (fresh) {
          await F.ready(consumer, id);
          assert.ok(await pollUntil(() => adoption!.reads.length === 2 && adoption!.reads.every(r => r.body !== null), 10000), "both genuine post-completion adoption GETs required");
          assert.ok(adoption!.filtered.some(r => r.method === "PATCH"), "fork PATCH must pass without consuming GET quota");
          for (const row of adoption!.reads) {
            assert.equal(row.status, 200); assert.equal(row.delivered, false);
            const expected = JSON.stringify(row.body.memory) === JSON.stringify(stored)
              ? { messages: remote, value: stored } : { messages: fork.http.body.messages, value: F.blob(`${kind}-fork`) };
            assert.deepEqual(row.body.memory, expected.value); assert.deepEqual(F.projection(row.body.messages), F.projection(expected.messages));
          }
          const read = adoption!.reads[1];
          // The read races the fork PATCH, so only these independently declared
          // complete snapshots may have been captured before origin release.
          const captured = JSON.stringify(read.body.memory) === JSON.stringify(stored)
            ? { messages: remote, value: stored, selection: "remote" }
            : { messages: fork.http.body.messages, value: F.blob(`${kind}-fork`), selection: "fork" };
          assert.deepEqual(read.body.memory, captured.value); assert.deepEqual(F.projection(read.body.messages), F.projection(captured.messages));
          controller.release(q, [F.memory(late)]);
          const saved = await F.durable(owner, ctx, id, late, answer); assert.deepEqual(F.projection(saved.http.body.messages), F.projection(origin));
          read.release(); assert.ok(await pollUntil(() => read.delivered, 5000));
          adoption!.reads[0].release(); assert.ok(await pollUntil(() => adoption!.reads.every(r => r.delivered), 5000)); await adoption!.close();
          assert.ok(await F.visible(consumer, captured.messages.at(-1).content));
          await recorder.screenshot(consumer.page, `terminal-${kind}-after-origin`);
          const feedback = await F.feedback(consumer, ctx, id, captured.messages, captured.value, captured.messages.at(-1).content);
          return { eligibleOrigin: saved, selected: captured.selection, genuineReads: adoption!.reads, filtered: adoption!.filtered, coherentFreshFeedback: feedback };
        }
        await new Promise(r => setTimeout(r, 500)); assert.equal(recorder.patches.slice(beforeLate).some(p => JSON.stringify(p.body).includes(`${kind}-origin-late`)), false);
        return F.durable(consumer, ctx, id, F.blob(`${kind}-fork`), redo);
      });
      observations.push({ kind, origin, remote, fork, fresh });
      if (fresh) await consumer.page.close();
    }
    await pollUntil(() => acknowledgments.length >= recorder.patches.length, 10000);
    await g("patch-acknowledgments", async () => { assert.ok(acknowledgments.length > 0); assert.equal(acknowledgments.length, recorder.patches.length); assert.ok(acknowledgments.every(a => a.status === 200)); return { patches: recorder.patches, acknowledgments }; });
  } finally {
    for (const barrier of barriers) await barrier.close();
    ctx.check("browser.no-page-errors", sessions.every(s => !s.pageErrors.length), sessions.map(s => s.pageErrors));
    ctx.check("browser.no-blocked-requests", sessions.every(s => !s.blocked.length), sessions.map(s => s.blocked));
    ctx.check("browser.all-responses-released", !controller.unmatched.length && !controller.held.length && barriers.every(b => b.reads.every((r: any) => r.delivered)), { unmatched: controller.unmatched, held: controller.held });
    writeFileSync(join(recorder.dir, "terminal-observations.json"), JSON.stringify({ observations, reads, adoptionReads: barriers.map(b => b.reads), patches: recorder.patches, acknowledgments }, null, 2));
    for (const page of freshPages) await page.close().catch(() => {});
    await member.close(); await owner.close();
  }
}
