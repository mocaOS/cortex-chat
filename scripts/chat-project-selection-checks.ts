// project-selection-v1: genuine held reads with latest relay/tokens and terminal
// navigation. Expected values are synthetic snapshots, never candidate helpers.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectFixture as F } from "./chat-project-followup-checks";
import { BrowserSession, Recorder, browserPrerequisites, makeUpstreamController, pollUntil, setAppLocale } from "./chat-browser-checks";

export const SELECTION_HTTP_GATES = ["http.read-control", "http.selected-relay-replacement", "http.older-relay-completion-control", "http.full-snapshot-lww"];
export const SELECTION_BROWSER_GATES = [
  "browser.logins-dark-locales", "browser.initial-relay-control", "browser.genuine-held-replacement-read",
  "browser.latest-relay-with-fresh-base", "browser.genuine-held-token-read", "browser.tokens-during-read",
  "browser.older-relay-completion-control", "browser.relay-adoption-read-only", "browser.relay-settled-feedback",
  ...["held", "away"].flatMap(k => ["done-visible", "remote-adoption-control", "navigation-return-control", "feedback-coherence", "regenerate-at-send", "fork-settles", "superseded-or-origin-write"].map(n => `browser.${k}.${n}`)),
  "browser.patch-acknowledgments", "browser.no-page-errors", "browser.no-blocked-requests", "browser.all-responses-released",
];
function append(ctx: any, controller: ReturnType<typeof makeUpstreamController>, q: string, content: string) {
  const h = controller.held.find(h => h.question === q); assert.ok(h);
  ctx.upstream.pending.get(h.id).response.write(`data: ${JSON.stringify({ content })}\n\n`);
}
async function ask(ctx: any, cookie: string, id: string, q: string, memory: unknown) {
  const response = await ctx.request("/api/ask/stream", { cookie, method: "POST", timeoutMs: 120000,
    body: { question: q, session_id: id, project_id: ctx.ids.project, conversation_memory: memory } });
  assert.equal(response.status, 200);
  const observation = { received: "" };
  const reading = (async () => { const reader = response.body.getReader(), decoder = new TextDecoder();
    while (true) { const n = await reader.read(); if (n.done) break; observation.received += decoder.decode(n.value, { stream: true }); } })();
  return { observation, reading };
}
async function feed(ctx: any, cookie: string, id: string) {
  const abort = new AbortController(), events: any[] = [];
  const response = await fetch(`${ctx.baseUrl}/api/me/chats/${id}/events`, { headers: { Cookie: cookie }, signal: abort.signal });
  assert.equal(response.status, 200);
  const reading = (async () => { const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = "";
    try { while (true) { const n = await reader.read(); if (n.done) break; buffer += decoder.decode(n.value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop()!;
      for (const line of lines) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6))); }
    } catch (e) { if (!abort.signal.aborted) throw e; } })();
  return { events, async close() { abort.abort(); await reading; } };
}
export async function runSelectionHttp(ctx: any) {
  const owner = await F.login(ctx, "owner"), member = await F.login(ctx, "member"), id = await F.create(ctx, owner, "HTTP selected relay");
  const base = F.pair("fx-selection-http", "HTTP selected base"), pre = F.blob("http-pre");
  await F.patch(ctx, owner, id, base, pre);
  await F.gate(ctx, SELECTION_HTTP_GATES[0], () => F.json(ctx, `/api/me/chats/${id}`, member));
  const controller = makeUpstreamController(ctx), q1 = `http-old-${ctx.label}`, q2 = `http-new-${ctx.label}`;
  controller.plans.set(q1, [{ frames: [{ content: "HTTP older" }], holdOnly: true }]);
  controller.plans.set(q2, [{ frames: [{ content: "HTTP selected" }], holdOnly: true }]);
  const old = await ask(ctx, member, id, q1, pre), selected = await ask(ctx, member, id, q2, pre);
  assert.ok((await controller.waitHeld(q2, 10000)).found);
  append(ctx, controller, q2, " + pending token");
  assert.ok(await pollUntil(() => selected.observation.received.includes("pending token"), 10000));
  const replay = await feed(ctx, owner, id);
  await F.gate(ctx, SELECTION_HTTP_GATES[1], async () => {
    assert.ok(await pollUntil(() => replay.events.some(e => e.kind === "token"), 10000));
    assert.equal(replay.events.find(e => e.kind === "turn_start").question, q2);
    assert.deepEqual(replay.events.filter(e => e.kind === "token").map(e => e.token), ["HTTP selected + pending token"]);
    return replay.events;
  });
  await replay.close(); controller.release(q1, [F.memory(F.blob("http-old-final")), F.done]); await old.reading;
  const next = await feed(ctx, owner, id);
  await F.gate(ctx, SELECTION_HTTP_GATES[2], async () => {
    assert.ok(await pollUntil(() => next.events.some(e => e.kind === "token"), 10000));
    assert.equal(next.events.find(e => e.kind === "turn_start").question, q2); return next.events;
  });
  await next.close(); controller.release(q2, [F.memory(F.blob("http-new-final")), F.done]); await selected.reading;
  await F.gate(ctx, SELECTION_HTTP_GATES[3], async () => {
    await F.patch(ctx, member, id, [...base, ...F.pair("fx-selection-http-new", "New origin")], F.blob("new-origin"));
    return F.patch(ctx, member, id, [...base, ...F.pair("fx-selection-http-old", "Old origin writes last")], F.blob("old-origin"));
  });
  writeFileSync(join(ctx.workDir, "logs", "selection-http.json"), JSON.stringify({ old: old.observation, selected: selected.observation, replay: replay.events, next: next.events }, null, 2));
}

export async function runSelectionBrowser(ctx: any) {
  const recorder = new Recorder(join(ctx.workDir, "logs"));
  copyFileSync(join(ctx.appDir, "src/app/page.tsx"), join(recorder.dir, "input-page.tsx"));
  const prereq = browserPrerequisites(); assert.deepEqual(prereq.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json")), pw = require(join(prereq.pwPath, "index.js"));
  writeFileSync(join(recorder.dir, "tooling.json"), JSON.stringify({ ...prereq, launcherSha256: createHash("sha256").update(readFileSync(prereq.chromiumPath)).digest("hex"),
    launcher: readFileSync(prereq.chromiumPath, "utf8"), playwrightVersion: JSON.parse(readFileSync(join(prereq.pwPath, "package.json"), "utf8")).version,
    browserProfileTmpdir: process.env.TMPDIR, install: false }, null, 2));
  const owner = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder), member = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder);
  const sessions = [owner, member], controller = makeUpstreamController(ctx), barriers: any[] = [], acknowledgments: any[] = [];
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
      s.context.on("response", (r: any) => { if (r.request().method() === "PATCH" && /\/api\/me\/chats\/[^/?]+$/.test(new URL(r.url()).pathname)) acknowledgments.push({ url: r.url(), status: r.status() }); });
      await s.login(ctx, ctx.users[name].email, ctx.users[name].password);
    }
    await g("logins-dark-locales", async () => {
      for (const [s, name] of [[owner, "owner"], [member, "member"]] as const) assert.equal((await F.json(ctx, "/api/auth/me", s.cookie)).id, ctx.users[name].id);
      assert.equal(await owner.page.evaluate(() => document.documentElement.classList.contains("dark")), true);
      setAppLocale(ctx.dataDir, "de"); await owner.page.reload(); await owner.waitForComposer();
      assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research..."); await recorder.screenshot(owner.page, "selection-dark-de");
      setAppLocale(ctx.dataDir, "en"); await owner.page.reload(); await owner.waitForComposer();
      assert.equal(await owner.composer().getAttribute("placeholder"), "Ask a complex question for deep research..."); return { locales: ["de", "en"] };
    });
    const id = await F.create(ctx, owner.cookie, "Held relay adoption"), base = F.pair("fx-selection-base", "Relay base"), pre = F.blob("relay-pre");
    await F.patch(ctx, owner.cookie, id, base, pre); await F.open(owner, ctx, id, base[1].content);
    const q1 = `browser-old-relay-${ctx.label}`, q2 = `browser-selected-relay-${ctx.label}`;
    controller.plans.set(q1, [{ frames: [{ content: "Old relay initial" }], holdOnly: true }]);
    controller.plans.set(q2, [{ frames: [{ content: "Selected relay initial" }], holdOnly: true }]);
    const old = await ask(ctx, member.cookie, id, q1, pre);
    await g("initial-relay-control", async () => { assert.ok(await F.visible(owner, "Old relay initial")); return { q1 }; });
    const writes = recorder.patches.length;
    const revised = base.map(m => m.role === "assistant" ? { ...m, content: "Fresh replacement read prefix" } : m), value = F.blob("replacement-read");
    const barrier = await F.holdReads(owner, ctx, id, 1); barriers.push(barrier);
    await F.patch(ctx, member.cookie, id, revised, value); assert.ok(await pollUntil(() => barrier.reads.length === 1, 10000));
    await g("genuine-held-replacement-read", async () => { assert.equal(barrier.reads[0].status, 200); assert.equal(barrier.reads[0].delivered, false); assert.deepEqual(barrier.reads[0].body.memory, value); assert.deepEqual(F.projection(barrier.reads[0].body.messages), revised); return barrier.reads[0]; });
    const selected = await ask(ctx, member.cookie, id, q2, pre); assert.ok((await controller.waitHeld(q2, 10000)).found);
    append(ctx, controller, q2, " + replacement pending token"); assert.ok(await F.visible(owner, "Selected relay initial + replacement pending token"));
    barrier.reads[0].release(); assert.ok(await pollUntil(() => barrier.reads[0].delivered, 5000)); await barrier.close();
    await g("latest-relay-with-fresh-base", async () => {
      assert.ok(await F.visible(owner, revised[1].content)); assert.ok(await F.visible(owner, "Selected relay initial + replacement pending token"));
      assert.equal(await F.visible(owner, "Old relay initial", 200), false); assert.equal(await owner.page.locator("main").getByText(q2, { exact: true }).count(), 1);
      await recorder.screenshot(owner.page, "held-read-latest-relay"); return { revised, q2 };
    });
    const second = await F.holdReads(owner, ctx, id, 1); barriers.push(second);
    const latestBase = revised.map(m => m.role === "assistant" ? { ...m, content: "Fresh token read prefix" } : m), latestMemory = F.blob("token-read");
    await F.patch(ctx, member.cookie, id, latestBase, latestMemory); assert.ok(await pollUntil(() => second.reads.length === 1, 10000));
    await g("genuine-held-token-read", async () => { assert.deepEqual(second.reads[0].body.memory, latestMemory); assert.equal(second.reads[0].delivered, false); return second.reads[0]; });
    append(ctx, controller, q2, " + next pending token"); assert.ok(await F.visible(owner, "Selected relay initial + replacement pending token + next pending token"));
    second.reads[0].release(); assert.ok(await pollUntil(() => second.reads[0].delivered, 5000)); await second.close();
    const answer = "Selected relay initial + replacement pending token + next pending token";
    await g("tokens-during-read", async () => { assert.ok(await F.visible(owner, latestBase[1].content)); assert.equal(await owner.page.locator("main").getByText(answer, { exact: true }).count(), 1); return { answer, latestBase }; });
    controller.release(q1, [F.memory(F.blob("old-relay-final")), F.done]); await old.reading;
    await g("older-relay-completion-control", async () => { assert.ok(await F.visible(owner, answer)); assert.equal(await owner.page.locator("main").getByText(q2, { exact: true }).count(), 1); assert.equal(controller.held.length, 1); return { selectedStillLive: true }; });
    await g("relay-adoption-read-only", async () => { assert.equal(recorder.patches.length, writes); return { writes: 0 }; });
    controller.release(q2, [F.memory(F.blob("selected-relay-final")), F.done]); await selected.reading;
    const settled = [...latestBase, ...F.pair("fx-selection-settled", "Selected settled")]; settled.at(-1)!.content = answer;
    await F.patch(ctx, member.cookie, id, settled, F.blob("selected-relay-final")); assert.ok(await F.visible(owner, answer));
    assert.ok(await pollUntil(() => owner.page.locator('button[aria-label="Bad answer"]').count().then((n: number) => n === 2), 10000));
    await g("relay-settled-feedback", () => F.feedback(owner, ctx, id, settled, F.blob("selected-relay-final"), answer));

    for (const kind of ["held", "away"] as const) {
      const chatId = await F.create(ctx, owner.cookie, `Terminal navigation ${kind}`), prefix = F.pair(`fx-selection-${kind}`, `${kind} terminal prefix`), initial = F.blob(`${kind}-at-send`);
      await F.patch(ctx, owner.cookie, chatId, prefix, initial); await F.open(owner, ctx, chatId, prefix[1].content);
      const q = `terminal-${kind}-${ctx.label}`, localAnswer = `${kind} terminal original answer`, redo = `${kind} terminal redo answer`, late = F.blob(`${kind}-late`);
      controller.plans.set(q, [{ frames: [{ content: localAnswer }, F.done], holdOnly: true }, { frames: [{ content: redo }, F.memory(F.blob(`${kind}-redo`)), F.done] }]);
      await owner.send(q); await owner.waitAnswerVisible(localAnswer); await F.ready(owner, chatId);
      const origin = (await F.durable(owner, ctx, chatId, initial, localAnswer)).http.body.messages;
      await g(`${kind}.done-visible`, async () => { assert.equal(await owner.page.locator('button[title="Stop"]').count(), 0); assert.equal(controller.held.length, 1); return { origin, initial }; });
      const remote = origin.map((m: any) => m.content === localAnswer ? { ...m, content: `${kind} terminal remote same exchange`, feedback: "up" } : m), remoteMemory = F.blob(`${kind}-remote`);
      await F.patch(ctx, member.cookie, chatId, remote, remoteMemory);
      await g(`${kind}.remote-adoption-control`, async () => { assert.ok(await F.visible(owner, remote.at(-1).content)); return { remote, remoteMemory }; });
      await owner.newChatViaSidebar(); assert.equal(new URL(owner.page.url()).searchParams.has("chat"), false);
      if (kind === "away") {
        controller.release(q, [F.memory(late)]);
        const got = await F.durable(owner, ctx, chatId, late, localAnswer); assert.deepEqual(F.projection(got.http.body.messages), F.projection(origin));
      }
      await owner.page.goBack(); await owner.waitForComposer(); await F.ready(owner, chatId);
      const expected = kind === "held" ? remote : origin, recall = kind === "held" ? remoteMemory : late;
      await g(`${kind}.navigation-return-control`, async () => { assert.ok(await F.visible(owner, expected.at(-1).content)); assert.equal(await owner.page.locator('button[title="Stop"]').count(), 0); assert.equal(controller.held.length, kind === "held" ? 1 : 0); return { expected, recall, url: owner.page.url() }; });
      await g(`${kind}.feedback-coherence`, () => F.feedback(owner, ctx, chatId, expected, recall, expected.at(-1).content));
      await owner.clickRegenerate();
      await g(`${kind}.regenerate-at-send`, async () => { assert.ok(await pollUntil(() => ctx.upstream.requests.filter((r: any) => r.body?.question === q).length === 2, 10000));
        const sent = ctx.upstream.requests.filter((r: any) => r.body?.question === q).at(-1).body;
        assert.deepEqual(sent.conversation_memory, initial, "navigation must retain the immutable local at-send snapshot for the same last exchange");
        assert.deepEqual(sent.conversation_history.slice(-prefix.length), prefix.map(m => ({ role: m.role, content: m.content }))); return sent; });
      await g(`${kind}.fork-settles`, () => F.durable(owner, ctx, chatId, F.blob(`${kind}-redo`), redo));
      const beforeLate = recorder.patches.length;
      if (kind === "held") controller.release(q, [F.memory(late)]);
      await g(`${kind}.superseded-or-origin-write`, async () => { await new Promise(r => setTimeout(r, 500));
        assert.equal(recorder.patches.slice(beforeLate).some(p => JSON.stringify(p.body).includes(`${kind}-late`)), false);
        return F.durable(owner, ctx, chatId, F.blob(`${kind}-redo`), redo); });
    }
    await pollUntil(() => acknowledgments.length >= recorder.patches.length, 10000);
    await g("patch-acknowledgments", async () => { assert.ok(acknowledgments.length > 0); assert.equal(acknowledgments.length, recorder.patches.length); assert.ok(acknowledgments.every(a => a.status === 200)); return { patches: recorder.patches, acknowledgments }; });
  } finally {
    for (const b of barriers) await b.close();
    ctx.check("browser.no-page-errors", sessions.every(s => !s.pageErrors.length), sessions.map(s => s.pageErrors));
    ctx.check("browser.no-blocked-requests", sessions.every(s => !s.blocked.length), sessions.map(s => s.blocked));
    ctx.check("browser.all-responses-released", !controller.unmatched.length && !controller.held.length && barriers.every(b => b.reads.every((r: any) => r.delivered)), { unmatched: controller.unmatched, held: controller.held });
    writeFileSync(join(recorder.dir, "selection-observations.json"), JSON.stringify({ observations: recorder.observations, patches: recorder.patches, acknowledgments,
      reads: barriers.map(b => b.reads), feeds: await Promise.all(sessions.map(s => s.page?.evaluate(() => (window as any).__followupFeeds).catch(() => null))) }, null, 2));
    await member.close(); await owner.close();
  }
}
