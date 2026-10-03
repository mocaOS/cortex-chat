// project-continuity-v1. Positive consumer gates frozen before runtime repair.
// Reuses existing genuine transport/GET barriers, auth/SQLite and browser adapter.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectFixture as F } from "./chat-project-followup-checks";
import { makeFeedTransport } from "./chat-feed-transport";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController, pollUntil, setAppLocale } from "./chat-browser-checks";

export const CONTINUITY_HTTP_GATES = [
  "http.initial-live-replay", "http.live-replay-round-1", "http.live-replay-round-2",
  "http.asker-completion-control", "http.origin-remote-origin-lww",
];
export const CONTINUITY_BROWSER_GATES = [
  "browser.logins-dark-locales", "browser.live-initial-control", "browser.live-reconnect-1", "browser.live-reconnect-2",
  "browser.live-reconnect-fresh-prefix", "browser.live-done-settles", "browser.live-feedback-recall", "browser.live-adoption-read-only",
  ...["append", "same"].flatMap(kind => ["done-visible", "adoption-control", "origin-late-write", "view-feedback-coherence", "adoption-read-only"]
    .map(id => `browser.${kind}.${id}`)),
  "browser.same.regenerate-at-send", "browser.patch-acknowledgments", "browser.no-page-errors",
  "browser.no-blocked-requests", "browser.all-responses-released",
];

async function rawFeed(ctx: any, cookie: string, id: string) {
  const abort = new AbortController();
  const response = await fetch(`${ctx.baseUrl}/api/me/chats/${id}/events`, { headers: { Cookie: cookie }, signal: abort.signal });
  assert.equal(response.status, 200);
  const events: any[] = [], frames: string[] = [];
  let unexpected: unknown = null;
  const reading = (async () => {
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop()!;
        for (const line of lines) {
          frames.push(line);
          if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
        }
      }
    } catch (error) { if (!abort.signal.aborted) unexpected = error; }
  })();
  assert.ok(await pollUntil(() => frames.includes(": connected"), 10000));
  return { events, frames, async close() { abort.abort(); await reading; assert.equal(unexpected, null); } };
}
function appendHeld(ctx: any, controller: ReturnType<typeof makeUpstreamController>, question: string, content: string) {
  const held = controller.held.find(h => h.question === question); assert.ok(held);
  ctx.upstream.pending.get(held.id).response.write(`data: ${JSON.stringify({ content })}\n\n`);
}
export async function runContinuityHttp(ctx: any) {
  const owner = await F.login(ctx, "owner"), member = await F.login(ctx, "member");
  const id = await F.create(ctx, owner, "HTTP continuity");
  const base = F.pair("fx-cont-http-base", "HTTP continuity base"), pre = F.blob("http-pre");
  await F.patch(ctx, owner, id, base, pre);
  const controller = makeUpstreamController(ctx), q = `http-live-continuity-${ctx.label}`;
  let answer = "HTTP replay prefix";
  controller.plans.set(q, [{ frames: [{ content: answer }], holdOnly: true }]);
  const asker = await ctx.request("/api/ask/stream", { cookie: member, method: "POST", timeoutMs: 120000,
    body: { question: q, session_id: id, project_id: ctx.ids.project, conversation_memory: pre } });
  let received = "";
  const reading = (async () => { const reader = asker.body.getReader(), decoder = new TextDecoder();
    while (true) { const next = await reader.read(); if (next.done) break; received += decoder.decode(next.value, { stream: true }); } })();
  assert.ok((await controller.waitHeld(q, 10000)).found);
  const feeds: any[] = [];
  for (let round = 0; round <= 2; round++) {
    if (round) {
      const suffix = ` + HTTP missed ${round}`; answer += suffix;
      appendHeld(ctx, controller, q, suffix);
      assert.ok(await pollUntil(() => received.includes(suffix), 10000), "actual asker must receive token before replay observation");
    }
    const feed = await rawFeed(ctx, owner, id); feeds.push(feed);
    await F.gate(ctx, CONTINUITY_HTTP_GATES[round], async () => {
      assert.ok(await pollUntil(() => feed.events.some((e: any) => e.kind === "token"), 10000));
      assert.equal(feed.events.find((e: any) => e.kind === "turn_start")?.question, q);
      assert.deepEqual(feed.events.filter((e: any) => e.kind === "token").map((e: any) => e.token), [answer]);
      assert.equal(ctx.upstream.requests.filter((r: any) => r.body?.question === q).length, 1);
      return { round, expected: answer, events: feed.events };
    });
    await feed.close();
  }
  controller.release(q, [F.memory(F.blob("http-final")), F.done]); await reading;
  await F.gate(ctx, CONTINUITY_HTTP_GATES[3], async () => {
    assert.equal(asker.status, 200); assert.ok(received.includes("http-final"));
    assert.equal(controller.held.length, 0); return { received, requests: 1 };
  });
  await F.gate(ctx, CONTINUITY_HTTP_GATES[4], async () => {
    const origin = [...base, ...F.pair("fx-cont-http-origin", "HTTP origin")];
    await F.patch(ctx, member, id, origin, pre);
    await F.patch(ctx, owner, id, [...origin, ...F.pair("fx-cont-http-remote", "HTTP remote")], F.blob("http-remote"));
    return F.patch(ctx, member, id, origin, F.blob("http-late-origin"));
  });
  writeFileSync(join(ctx.workDir, "logs", "continuity-http.json"), JSON.stringify({ feeds: feeds.map(f => ({ events: f.events, frames: f.frames })), received }, null, 2));
}

export async function runContinuityBrowser(ctx: any) {
  const recorder = new Recorder(join(ctx.workDir, "logs"));
  copyFileSync(join(ctx.appDir, "src/app/page.tsx"), join(recorder.dir, "input-page.tsx"));
  const prereq = browserPrerequisites(); assert.deepEqual(prereq.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(prereq.pwPath, "index.js"));
  writeFileSync(join(recorder.dir, "tooling.json"), JSON.stringify({ ...prereq,
    launcherSha256: createHash("sha256").update(readFileSync(prereq.chromiumPath)).digest("hex"),
    launcher: readFileSync(prereq.chromiumPath).length < 10000 ? readFileSync(prereq.chromiumPath, "utf8") : null,
    playwrightVersion: JSON.parse(readFileSync(join(prereq.pwPath, "package.json"), "utf8")).version,
    browserProfileTmpdir: process.env.TMPDIR, install: false }, null, 2));
  const owner = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder), member = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder);
  const sessions = [owner, member], controller = makeUpstreamController(ctx), transport = await makeFeedTransport(ctx.baseUrl);
  const acknowledgments: any[] = [];
  try {
    for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) {
      await s.start(s === member ? owner.browser : undefined);
      await s.context.addInitScript(() => {
        const Original = window.EventSource; (window as any).__followupFeeds = [];
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
      s.context.on("response", (response: any) => {
        if (response.request().method() === "PATCH" && /\/api\/me\/chats\/[^/?]+$/.test(new URL(response.url()).pathname))
          acknowledgments.push({ url: response.url(), status: response.status(), at: Date.now() });
      });
      await s.login(ctx, ctx.users[name].email, ctx.users[name].password);
    }
    await owner.context.route(/\/api\/me\/chats\/[^/?]+\/events$/, (route: any) => {
      recorder.obs("feed-transport", { original: route.request().url(), forwarder: transport.url });
      return route.continue({ url: transport.url + new URL(route.request().url()).pathname });
    });
    const g = (id: string, fn: () => Promise<unknown>) => F.gate(ctx, `browser.${id}`, fn);
    await g("logins-dark-locales", async () => {
      for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) assert.equal((await F.json(ctx, "/api/auth/me", s.cookie)).id, ctx.users[name].id);
      assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de"); await owner.page.reload(); await owner.waitForComposer();
      assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research...");
      await recorder.screenshot(owner.page, "continuity-dark-de");
      setAppLocale(ctx.dataDir, "en"); await owner.page.reload(); await owner.waitForComposer();
      assert.equal(await owner.composer().getAttribute("placeholder"), "Ask a complex question for deep research..."); return { forms: 2, locales: ["de", "en"] };
    });
    const liveId = await F.create(ctx, owner.cookie, "Still-live continuity"), base = F.pair("fx-cont-live-base", "Live settled prefix");
    await F.patch(ctx, owner.cookie, liveId, base, F.blob("live-base"));
    await F.open(owner, ctx, liveId, base[1].content); await F.open(member, ctx, liveId, base[1].content);
    const q = `browser-live-continuity-${ctx.label}`; let answer = "Live replay prefix";
    controller.plans.set(q, [{ frames: [{ content: answer }], holdOnly: true }]);
    const writes = recorder.patches.length;
    await member.send(q); assert.ok((await controller.waitHeld(q, 15000)).found);
    await g("live-initial-control", async () => { assert.ok(await F.visible(owner, answer)); return { answer }; });
    for (let round = 1; round <= 2; round++) {
      const before = await F.disconnect(owner, liveId, transport);
      const suffix = ` + missed segment ${round}`; answer += suffix; appendHeld(ctx, controller, q, suffix);
      assert.ok(await F.visible(member, answer), "actual asker must receive token while observer is disconnected");
      if (round === 2) {
        const revised = base.map(m => m.role === "assistant" ? { ...m, content: "Revised settled prefix during live outage" } : m);
        await F.patch(ctx, member.cookie, liveId, revised, F.blob("live-revised-base"));
      }
      const after = await F.reconnect(owner, liveId, before, transport);
      await g(`live-reconnect-${round}`, async () => {
        assert.ok(await F.visible(owner, answer));
        assert.equal(await owner.page.locator("main").getByText(q, { exact: true }).count(), 1);
        assert.equal(await owner.page.locator("main").getByText(answer, { exact: true }).count(), 1);
        assert.equal(controller.held.length, 1); return { before, after, answer };
      });
    }
    await g("live-reconnect-fresh-prefix", async () => {
      assert.ok(await F.visible(owner, "Revised settled prefix during live outage"), "reconnect must adopt missed settled prefix alongside genuine still-live replay");
      assert.equal(await F.visible(owner, base[1].content, 200), false); return { settledPrefix: "Revised settled prefix during live outage", live: answer };
    });
    await g("live-adoption-read-only", async () => { assert.equal(recorder.patches.length, writes); return { browserWrites: 0 }; });
    controller.release(q, [F.memory(F.blob("live-final")), F.done]);
    const liveFinal = (await F.durable(member, ctx, liveId, F.blob("live-final"), answer)).http.body.messages;
    await g("live-done-settles", async () => {
      assert.ok(await pollUntil(() => owner.page.locator('button[aria-label="Bad answer"]').count().then((n: number) => n === 2), 8000));
      assert.ok(await F.visible(owner, answer)); assert.ok(await F.visible(owner, base[1].content));
      assert.deepEqual(F.projection(liveFinal).slice(0, -2), base); return { lastWriter: "member origin", messages: liveFinal };
    });
    await g("live-feedback-recall", () => F.feedback(owner, ctx, liveId, liveFinal, F.blob("live-final"), answer));

    for (const kind of ["append", "same"] as const) {
      const id = await F.create(ctx, owner.cookie, `Late memory ${kind}`), pre = F.blob(`${kind}-pre`);
      const prefix = F.pair(`fx-cont-${kind}-base`, `${kind} immutable prefix`);
      await F.patch(ctx, owner.cookie, id, prefix, pre); await F.open(owner, ctx, id, prefix[1].content);
      const question = `late-memory-${kind}-${ctx.label}`, localAnswer = `Local ${kind} completed answer`;
      controller.plans.set(question, [{ frames: [{ content: localAnswer }, F.done], holdOnly: true },
        { frames: [{ content: "Same exchange redo answer" }, F.memory(F.blob("same-redo")), F.done] }]);
      await owner.send(question); await owner.waitAnswerVisible(localAnswer); await F.ready(owner, id);
      const origin = (await F.durable(owner, ctx, id, pre, localAnswer)).http.body.messages;
      await g(`${kind}.done-visible`, async () => {
        assert.equal(await owner.page.locator('button[title="Stop"]').count(), 0);
        assert.equal(controller.held.length, 1); return { origin, pre, heldLateMemory: true };
      });
      const remote = kind === "append" ? [...origin, ...F.pair("fx-cont-remote-append", "Remote appended exchange")]
        : origin.map((m: any) => m.content === localAnswer ? { ...m, content: "Remote same exchange revised answer", feedback: "up" } : m);
      const remoteMemory = F.blob(`${kind}-remote`), late = F.blob(`${kind}-late-origin`), remoteAnswer = remote.at(-1).content;
      const beforeAdopt = recorder.patches.length;
      await F.patch(ctx, member.cookie, id, remote, remoteMemory);
      assert.ok(await F.visible(owner, remoteAnswer), "late-memory case requires independently observed remote adoption");
      await g(`${kind}.adoption-read-only`, async () => { assert.equal(recorder.patches.length, beforeAdopt); return { browserWrites: 0 }; });
      await g(`${kind}.adoption-control`, () => F.feedback(owner, ctx, id, remote, remoteMemory, remoteAnswer));
      controller.release(question, [F.memory(late)]);
      const lateOrigin = await F.durable(owner, ctx, id, late, localAnswer);
      await g(`${kind}.origin-late-write`, async () => {
        assert.deepEqual(F.projection(lateOrigin.http.body.messages), F.projection(origin));
        return { lastWriter: "valid origin late-memory callback", durable: lateOrigin };
      });
      await g(`${kind}.view-feedback-coherence`, async () => {
        // Either coherent originating view or coherent adopted view is allowed.
        // A hybrid of remote messages and local blob is never a valid snapshot.
        const adoptedStillVisible = await F.visible(owner, remoteAnswer, 300);
        const expected = adoptedStillVisible ? remote : origin, value = adoptedStillVisible ? remoteMemory : late;
        assert.ok(await F.visible(owner, expected.at(-1).content));
        recorder.obs(`${kind}.consumer-selected-view`, { adoptedStillVisible, expected: F.projection(expected), value });
        return F.feedback(owner, ctx, id, expected, value, expected.at(-1).content);
      });
      if (kind === "same") {
        await owner.clickRegenerate();
        await g("same.regenerate-at-send", async () => {
          assert.ok(await pollUntil(() => ctx.upstream.requests.filter((r: any) => r.body?.question === question).length === 2, 10000));
          const sent = ctx.upstream.requests.filter((r: any) => r.body?.question === question).at(-1).body;
          assert.deepEqual(sent.conversation_memory, pre);
          assert.deepEqual(sent.conversation_history.slice(-prefix.length), prefix.map(m => ({ role: m.role, content: m.content })));
          return { sent, durable: await F.durable(owner, ctx, id, F.blob("same-redo"), "Same exchange redo answer") };
        });
      }
    }
    await pollUntil(() => acknowledgments.length >= recorder.patches.length, 10000);
    await g("patch-acknowledgments", async () => {
      assert.ok(acknowledgments.length > 0); assert.equal(acknowledgments.length, recorder.patches.length);
      assert.ok(acknowledgments.every(a => a.status === 200)); return { patches: recorder.patches, acknowledgments };
    });
  } finally {
    ctx.check("browser.no-page-errors", sessions.every(s => s.pageErrors.length === 0), sessions.map(s => s.pageErrors));
    ctx.check("browser.no-blocked-requests", sessions.every(s => s.blocked.length === 0), sessions.map(s => s.blocked));
    ctx.check("browser.all-responses-released", controller.unmatched.length === 0 && controller.held.length === 0, { unmatched: controller.unmatched, held: controller.held });
    writeFileSync(join(recorder.dir, "continuity-observations.json"), JSON.stringify({ observations: recorder.observations,
      patches: recorder.patches, acknowledgments, transport: transport.observations,
      feeds: await Promise.all(sessions.map(s => s.page?.evaluate(() => (window as any).__followupFeeds).catch(() => null))) }, null, 2));
    await member.close(); await owner.close(); await transport.close();
  }
}
