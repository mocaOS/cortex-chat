// project-lifecycle-v1: positive gates over actual HTTP/SQLite and Chromium.
// Reuses the existing isolated runtime and browser adapter; no runtime patching.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BrowserSession, Recorder, browserPrerequisites, makeUpstreamController,
  pollUntil, setAppLocale, sqliteReadSession,
} from "./chat-browser-checks";

export const HTTP_GATES = [
  "http.members-and-outsiders", "http.authorship-and-author-only-admin",
  "http.concurrent-coherent-lww", "http.sequential-last-writer",
  "http.overlap.askers-complete", "http.overlap.newer-live-replay",
];
export const BROWSER_GATES = [
  "browser.logins", "browser.dark-en-de", "browser.idle-adoption-control",
  "browser.same-id-adoption", "browser.adoption-no-writeback",
  "browser.delayed-adoption-navigation", "browser.destination-recall",
  "browser.project-fresh-rebase", "browser.return-own-live-loading",
  "browser.return-own-live-settles", "browser.done-visible-before-memory",
  "browser.overlap-both-started", "browser.overlap-first-does-not-clobber-live",
  "browser.overlap-lww-durable", "browser.overlap-converged",
  "browser.legacy-order-reload-replay", "browser.patch-acknowledgments",
  "browser.no-page-errors", "browser.no-blocked-requests", "browser.all-asks-released",
  "browser.same-id-feedback-recall",
];

const blob = (tag: string) => ({ unknown: [null, "日本語", { tag }], opaque: tag });
const done = { done: true, pending_memory: true };
const memory = (value: unknown) => ({ memory_update: value });
const pair = (id: string, text: string) => [
  { id: `${id}-u`, role: "user", content: `${text} question` },
  { id: `${id}-a`, role: "assistant", content: `${text} answer` },
];
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const projection = (messages: any[]) => messages.map(m => ({ id: m.id, role: m.role, content: m.content }));

async function json(ctx: any, path: string, cookie: string, method = "GET", body?: unknown) {
  const res = await ctx.request(path, { cookie, method, ...(body === undefined ? {} : { body }) });
  const value = await res.json();
  assert.equal(res.status, 200, `${method} ${path}: ${JSON.stringify(value)}`);
  return value;
}
async function login(ctx: any, name: string) {
  const res = await ctx.request("/api/auth/login", { method: "POST", body: ctx.users[name] });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).id, ctx.users[name].id);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("cortex_session="));
  return cookie;
}
async function create(ctx: any, cookie: string, title: string, project = true) {
  return (await json(ctx, "/api/me/chats", cookie, "POST", {
    title, ...(project ? { projectId: ctx.ids.project } : {}),
  })).id as string;
}
async function patch(ctx: any, cookie: string, id: string, messages: unknown[], value: unknown) {
  return json(ctx, `/api/me/chats/${id}`, cookie, "PATCH", { messages, memory: value });
}
async function gate(ctx: any, id: string, fn: () => Promise<unknown>) {
  try { ctx.check(id, true, await fn()); }
  catch (e) { ctx.check(id, false, { error: String((e as Error).stack ?? e) }); }
}
async function visible(session: BrowserSession, text: string, budget = 8000) {
  return pollUntil(() => session.page.locator("main").innerText().then((t: string) => t.includes(text)), budget);
}
async function open(session: BrowserSession, ctx: any, id: string, text: string) {
  await session.page.goto(`${ctx.baseUrl}/?chat=${id}`, { waitUntil: "domcontentloaded" });
  await session.waitForComposer();
  assert.ok(await visible(session, text), `chat ${id} did not render ${text}`);
  await readyFeed(session, id);
}
async function readyFeed(session: BrowserSession, id: string) {
  assert.ok(await pollUntil(() => session.page.evaluate((chatId: string) =>
    (window as any).__projectFeeds.some((f: any) => f.url === `/api/me/chats/${chatId}/events` && f.open && !f.closed), id), 15000),
  "real project EventSource must be connected before remote writes");
}
function durableIs(d: any, messages: any[], value: unknown) {
  return d.http.status === 200 && equal(projection(d.http.body?.messages ?? []), projection(messages)) &&
    equal(projection(d.sqlite.messages ?? []), projection(messages)) &&
    equal(d.http.body?.memory, value) && d.sqlite.session?.memory === JSON.stringify(value);
}
async function settled(session: BrowserSession, ctx: any, id: string, value: unknown, content: string) {
  return session.durableSettled(ctx, id, d => equal(d.http.body?.memory, value) &&
    d.sqlite.session?.memory === JSON.stringify(value) &&
    d.http.body?.messages?.some((m: any) => m.content === content));
}

// Raw SSE observer through the supported route, with bounded cancellation.
async function feed(ctx: any, cookie: string, id: string) {
  const abort = new AbortController();
  const res = await fetch(`${ctx.baseUrl}/api/me/chats/${id}/events`, {
    headers: { Cookie: cookie }, signal: abort.signal,
  });
  assert.equal(res.status, 200);
  const events: any[] = [];
  let error: unknown = null;
  const reading = (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) if (line.startsWith("data: ")) events.push(JSON.parse(line.slice(6)));
      }
    } catch (e) { if (!abort.signal.aborted) error = e; }
  })();
  return { events, async close() { abort.abort(); await reading; assert.equal(error, null); } };
}

export async function runProjectHttp(ctx: any) {
  const owner = await login(ctx, "owner");
  const member = await login(ctx, "member");
  const outsider = await login(ctx, "foreign");
  const id = await create(ctx, owner, "HTTP project LWW");
  const original = pair("fx-project-http-seed", "HTTP seed");
  const initial = blob("http-seed");
  await patch(ctx, owner, id, original, initial);
  await gate(ctx, HTTP_GATES[0], async () => {
    assert.equal((await json(ctx, `/api/me/chats/${id}`, member)).id, id);
    for (const method of ["GET", "PATCH"]) {
      const res = await ctx.request(`/api/me/chats/${id}`, { cookie: outsider, method,
        ...(method === "PATCH" ? { body: { messages: [], memory: null } } : {}) });
      await res.text(); assert.equal(res.status, 404);
    }
    const before = sqliteReadSession(ctx.dataDir, id);
    assert.equal(before.session.memory, JSON.stringify(initial));
    return { outsiderStatuses: [404, 404], memberRead: 200 };
  });
  await gate(ctx, HTTP_GATES[1], async () => {
    const next = [...original, ...pair("fx-project-http-member", "HTTP member")];
    await patch(ctx, member, id, next.map(m => ({ ...m, authorId: ctx.users.foreign.id })), blob("member"));
    const got = await json(ctx, `/api/me/chats/${id}`, owner);
    assert.deepEqual(got.messages.map((m: any) => m.authorId),
      [ctx.users.owner.id, ctx.users.owner.id, ctx.users.member.id, ctx.users.member.id]);
    const admin = await ctx.request(`/api/me/chats/${id}`, { method: "PATCH", cookie: member, body: { title: "forbidden" } });
    await admin.text(); assert.equal(admin.status, 404);
    return { authors: got.messages.map((m: any) => m.authorId), adminStatus: admin.status };
  });
  await gate(ctx, HTTP_GATES[2], async () => {
    const a = { messages: [...original, ...pair("fx-project-http-a", "Concurrent A")], memory: blob("A") };
    const b = { messages: [...original, ...pair("fx-project-http-b", "Concurrent B")], memory: blob("B") };
    // Both dispatch before either acknowledgment is awaited. No stale rejection promise.
    const [ra, rb] = await Promise.all([
      ctx.request(`/api/me/chats/${id}`, { cookie: owner, method: "PATCH", body: a }),
      ctx.request(`/api/me/chats/${id}`, { cookie: member, method: "PATCH", body: b }),
    ]);
    assert.equal(ra.status, 200); assert.equal(rb.status, 200);
    await Promise.all([ra.json(), rb.json()]);
    const session = await json(ctx, `/api/me/chats/${id}`, member);
    const db = sqliteReadSession(ctx.dataDir, id);
    assert.ok([a, b].some(v => equal(projection(session.messages), projection(v.messages)) &&
      equal(session.memory, v.memory) && equal(projection(db.messages), projection(v.messages)) &&
      db.session.memory === JSON.stringify(v.memory)), "concurrent writes must leave one coherent full pair");
    return { acknowledgments: [ra.status, rb.status], session, sqlite: db };
  });
  await gate(ctx, HTTP_GATES[3], async () => {
    const final = pair("fx-project-http-final", "Sequential final");
    const value = blob("sequential-final");
    await patch(ctx, owner, id, original, initial);
    await patch(ctx, member, id, final, value);
    assert.deepEqual(projection((await json(ctx, `/api/me/chats/${id}`, owner)).messages), final);
    assert.equal(sqliteReadSession(ctx.dataDir, id).session.memory, JSON.stringify(value));
    return { lastAcknowledgedWriter: "member", messages: final, memory: value };
  });

  const controller = makeUpstreamController(ctx);
  const qa = `http-overlap-a-${ctx.label}`, qb = `http-overlap-b-${ctx.label}`;
  controller.plans.set(qa, [{ frames: [{ content: "HTTP older tokens" }], holdOnly: true }]);
  controller.plans.set(qb, [{ frames: [{ content: "HTTP newer tokens" }], holdOnly: true }]);
  const request = (question: string, cookie: string) => ctx.request("/api/ask/stream", {
    cookie, method: "POST", timeoutMs: 120000,
    body: { question, session_id: id, project_id: ctx.ids.project, conversation_memory: initial },
  });
  const observer = await feed(ctx, member, id);
  const a = await request(qa, owner);
  const ar = a.text();
  assert.ok((await controller.waitHeld(qa, 10000)).found);
  const b = await request(qb, member);
  const br = b.text();
  assert.ok((await controller.waitHeld(qb, 10000)).found);
  controller.release(qa, [done, memory(blob("http-a"))]);
  const at = await ar;
  // turn_done is emitted on transport completion; wait for it before late join.
  await pollUntil(() => observer.events.some(e => e.kind === "turn_done" && e.by === ctx.users.owner.id), 1000);
  const late = await feed(ctx, owner, id);
  await gate(ctx, HTTP_GATES[5], async () => {
    assert.ok(await pollUntil(() => late.events.some(e => e.kind === "token"), 5000), "newer live replay must survive older completion");
    assert.equal(late.events.find(e => e.kind === "turn_start")?.question, qb);
    assert.deepEqual(late.events.filter(e => e.kind === "token").map(e => e.token), ["HTTP newer tokens"]);
    return { lateJoinEvents: late.events };
  });
  controller.release(qb, [done, memory(blob("http-b"))]);
  const bt = await br;
  await gate(ctx, HTTP_GATES[4], async () => {
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    assert.ok(at.includes("HTTP older tokens") && at.includes("http-a"));
    assert.ok(bt.includes("HTTP newer tokens") && bt.includes("http-b"));
    assert.equal(controller.held.length, 0);
    return { status: [a.status, b.status], answers: [at, bt], events: observer.events };
  });
  await late.close(); await observer.close();
  writeFileSync(join(ctx.workDir, "logs", "project-http-events.json"), JSON.stringify({
    observer: observer.events, lateJoin: late.events,
  }, null, 2));
}

export async function runProjectBrowser(ctx: any) {
  const recorder = new Recorder(join(ctx.workDir, "logs"));
  copyFileSync(join(ctx.appDir, "src/app/page.tsx"), join(recorder.dir, "input-page.tsx"));
  const prereq = browserPrerequisites();
  assert.deepEqual(prereq.problems, []);
  const require = createRequire(join(ctx.appDir, "package.json"));
  const pw = require(join(prereq.pwPath, "index.js"));
  writeFileSync(join(recorder.dir, "tooling.json"), JSON.stringify({ ...prereq,
    version: JSON.parse(readFileSync(join(prereq.pwPath, "package.json"), "utf8")).version,
    browserProfileTmpdir: process.env.TMPDIR, install: false }, null, 2));
  const owner = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder);
  const member = new BrowserSession(pw, prereq.chromiumPath, ctx.baseUrl, recorder);
  const sessions = [owner, member];
  const controller = makeUpstreamController(ctx);
  const acknowledgments: any[] = [];
  try {
    for (const [session, name] of [[owner, "owner"], [member, "member"]] as const) {
      await session.start(session === member ? owner.browser : undefined);
      await session.context.addInitScript(() => {
        const Original = window.EventSource;
        (window as any).__projectFeeds = [];
        window.EventSource = class extends Original {
          observation: any;
          constructor(url: string | URL, init?: EventSourceInit) {
            super(url, init);
            const entry = { url: String(url), open: false, closed: false, events: [] as unknown[] };
            this.observation = entry;
            (window as any).__projectFeeds.push(entry);
            this.addEventListener("open", () => { entry.open = true; });
            this.addEventListener("message", e => { entry.events.push(JSON.parse(e.data)); });
          }
          close() { this.observation.closed = true; super.close(); }
        };
      });
      session.context.on("response", (res: any) => {
        if (res.request().method() === "PATCH" && /\/api\/me\/chats\/[^/?]+$/.test(new URL(res.url()).pathname))
          acknowledgments.push({ url: res.url(), status: res.status(), at: Date.now() });
      });
      await session.login(ctx, ctx.users[name].email, ctx.users[name].password);
    }
    await gate(ctx, BROWSER_GATES[0], async () => {
      for (const session of sessions) assert.equal((await json(ctx, "/api/auth/me", session.cookie)).id,
        session === owner ? ctx.users.owner.id : ctx.users.member.id);
      return { realForms: 2 };
    });
    await gate(ctx, BROWSER_GATES[1], async () => {
      const snapshot = () => owner.page.evaluate(() => ({ dark: document.documentElement.classList.contains("dark"),
        lang: document.documentElement.lang, placeholder: document.querySelector("main + div input")?.getAttribute("placeholder") }));
      assert.equal((await snapshot()).dark, true);
      assert.equal(await owner.composer().getAttribute("placeholder"), "Ask a complex question for deep research...");
      setAppLocale(ctx.dataDir, "de");
      await owner.page.reload({ waitUntil: "domcontentloaded" }); await owner.waitForComposer();
      assert.equal((await snapshot()).lang, "de"); assert.equal((await snapshot()).dark, true);
      assert.equal(await owner.composer().getAttribute("placeholder"), "Stelle eine komplexe Frage für Deep Research...");
      await recorder.screenshot(owner.page, "project-dark-de");
      setAppLocale(ctx.dataDir, "en");
      await owner.page.reload({ waitUntil: "domcontentloaded" }); await owner.waitForComposer();
      return { locales: ["en", "de", "en"], dark: true };
    });

    const id = await create(ctx, owner.cookie, "Browser project lifecycle");
    const base = pair("fx-project-browser-seed", "Project baseline");
    await patch(ctx, owner.cookie, id, base, blob("browser-seed"));
    await open(owner, ctx, id, base[1].content);
    await open(member, ctx, id, base[1].content);
    // Healthy remote advancement uses different IDs, independently of same-ID case.
    const advanced = [...base, ...pair("fx-project-browser-advance", "Remote advance")];
    const advanceMemory = blob("remote-advance");
    const writesBeforeAdopt = recorder.patches.length;
    await patch(ctx, member.cookie, id, advanced, advanceMemory);
    await gate(ctx, BROWSER_GATES[2], async () => {
      assert.ok(await visible(owner, "Remote advance answer"));
      return { rendered: "Remote advance answer" };
    });
    assert.ok(await visible(owner, "Remote advance answer", 500), "same-ID case requires independently observed adopted prefix");
    const changed = advanced.map(m => m.id.endsWith("advance-a")
      ? { ...m, content: "Same identity revised answer", feedback: "up" } : m);
    const changedMemory = blob("same-ids-new-memory");
    await patch(ctx, member.cookie, id, changed, changedMemory);
    await gate(ctx, BROWSER_GATES[3], async () => {
      assert.ok(await visible(owner, "Same identity revised answer"), "same-ID content/metadata must be adopted");
      assert.equal(await visible(owner, "Remote advance answer", 200), false);
      const bubble = owner.page.locator("div.group").filter({ hasText: "Same identity revised answer" }).last();
      assert.equal(await bubble.locator('button[aria-label="Good answer"] svg').getAttribute("fill"), "currentColor",
        "same-ID feedback must be rendered as selected");
      await recorder.screenshot(owner.page, "same-id-adoption");
      return { sameIds: changed.map(m => m.id), content: "Same identity revised answer" };
    });
    await gate(ctx, BROWSER_GATES[4], async () => {
      assert.equal(recorder.patches.length, writesBeforeAdopt, "adoption must not PATCH");
      return { browserWrites: 0 };
    });
    await gate(ctx, BROWSER_GATES[20], async () => {
      // A normal project send always re-fetches and can mask stale adopted
      // recall. Feedback instead persists the actual displayed snapshot/ref.
      const bubble = owner.page.locator("div.group").filter({ hasText: "Same identity revised answer" }).last();
      await bubble.hover();
      await bubble.locator('button[aria-label="Bad answer"]').click();
      const observed = await owner.durableSettled(ctx, id, d =>
        equal(d.http.body?.memory, changedMemory) &&
        d.http.body?.messages?.at(-1)?.feedback === "down" &&
        d.sqlite.session?.memory === JSON.stringify(changedMemory));
      assert.ok(durableIs(observed, changed, changedMemory));
      assert.equal(observed.http.body.messages.at(-1).feedback, "down");
      return { adoptedMemoryThroughFeedback: observed };
    });

    // Hold the real adoption GET response (no synthetic browser fulfillment).
    // Navigate while its genuine server response is in flight, then release.
    const personal = await create(ctx, owner.cookie, "Personal destination", false);
    const personalMessages = pair("fx-project-personal", "Destination clean");
    const personalMemory = blob("destination-memory");
    await patch(ctx, owner.cookie, personal, personalMessages, personalMemory);
    let heldResponse: any = null;
    let releaseRead!: () => void;
    const readBarrier = new Promise<void>(resolve => { releaseRead = resolve; });
    const matcher = `${ctx.baseUrl}/api/me/chats/${id}`;
    const holdRead = async (route: any) => {
      const response = await route.fetch();
      heldResponse = { response, body: await response.json() };
      await readBarrier;
      await route.fulfill({ response });
    };
    await owner.context.route(matcher, holdRead, { times: 1 });
    const delayed = [...changed, ...pair("fx-project-delayed", "Delayed origin")];
    const delayedMemory = blob("delayed-origin-memory");
    await patch(ctx, member.cookie, id, delayed, delayedMemory);
    assert.ok(await pollUntil(() => heldResponse !== null, 10000), "must capture genuine adoption read before navigation");
    assert.deepEqual(heldResponse.body.memory, delayedMemory, "held read must be the acknowledged origin snapshot");
    await owner.switchToChatByTitle("Personal destination", "Destination clean answer");
    releaseRead();
    await owner.context.unroute(matcher, holdRead);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await gate(ctx, BROWSER_GATES[5], async () => {
      assert.ok(await visible(owner, "Destination clean answer"));
      assert.equal(await visible(owner, "Delayed origin answer", 200), false,
        "late adoption must not replace destination view");
      assert.equal(new URL(owner.page.url()).searchParams.get("chat"), personal);
      return { heldServerResponse: heldResponse.body, destination: personal };
    });
    const personalQ = `destination-send-${ctx.label}`;
    controller.plans.set(personalQ, [{ frames: [{ content: "Destination continuation" }, done] }]);
    await owner.send(personalQ);
    await gate(ctx, BROWSER_GATES[6], async () => {
      assert.ok(await pollUntil(() => ctx.upstream.requests.some((r: any) => r.body?.question === personalQ), 10000));
      const sent = ctx.upstream.requests.find((r: any) => r.body?.question === personalQ).body;
      assert.deepEqual(sent.conversation_memory, personalMemory, "destination recall remains own blob");
      assert.deepEqual(sent.conversation_history, personalMessages.map(m => ({ role: m.role, content: m.content })));
      return sent;
    });
    await visible(owner, "Destination continuation");

    // A normal shared send freshly rebases onto acknowledged server state.
    // Start both real UI streams before releasing either; snapshots may differ
    // only by their own appended pair, with the same settled prefix/opaque base.
    await open(owner, ctx, id, "Delayed origin answer");
    await open(member, ctx, id, "Delayed origin answer");
    const qa = `browser-overlap-a-${ctx.label}`, qb = `browser-overlap-b-${ctx.label}`;
    const aa = "Owner held project answer", ab = "Member held project answer";
    const ma = blob("browser-overlap-owner"), mb = blob("browser-overlap-member");
    controller.plans.set(qa, [{ frames: [{ content: aa }], holdOnly: true }]);
    controller.plans.set(qb, [{ frames: [{ content: ab }], holdOnly: true }]);
    await owner.send(qa);
    assert.ok((await controller.waitHeld(qa, 15000)).found);
    await member.send(qb);
    assert.ok((await controller.waitHeld(qb, 15000)).found);
    await gate(ctx, BROWSER_GATES[7], async () => {
      for (const q of [qa, qb]) {
        const body = ctx.upstream.requests.find((r: any) => r.body?.question === q).body;
        assert.deepEqual(body.conversation_memory, delayedMemory);
        const tail = body.conversation_history.slice(-delayed.length);
        assert.deepEqual(tail, delayed.map(m => ({ role: m.role, content: m.content })));
      }
      return { prefix: delayed, opaque: delayedMemory };
    });
    await gate(ctx, BROWSER_GATES[11], async () => {
      assert.ok(await visible(owner, aa)); assert.ok(await visible(member, ab));
      assert.equal(controller.held.length, 2);
      return { overlappingHeldStreams: controller.held };
    });
    // Switch away/back via actual sidebar while own stream remains unfinished.
    await owner.switchToChatByTitle("Personal destination", "Destination clean answer");
    await owner.openSidebar();
    const folder = owner.drawer().getByText("Fixture Project", { exact: true });
    await folder.click();
    await owner.drawer().getByText("Browser project lifecycle", { exact: true }).click();
    await owner.waitForComposer();
    await gate(ctx, BROWSER_GATES[8], async () => {
      assert.ok(await visible(owner, aa), "returning owner must see its held live turn");
      assert.equal(await owner.page.locator('button[title="Stop"]').count(), 1,
        "returning live turn must remain loading/stoppable");
      return { ownLiveVisible: true };
    });
    controller.release(qb, [memory(mb), done]); // independent legacy order control
    await visible(member, ab);
    const memberDurable = await settled(member, ctx, id, mb, ab);
    await gate(ctx, BROWSER_GATES[12], async () => {
      assert.equal(memberDurable.http.status, 200);
      assert.deepEqual(memberDurable.http.body.memory, mb);
      assert.ok(await visible(owner, aa), "other completion must not clobber own live view");
      return { first: memberDurable, ownerStillLive: true };
    });
    // Owner done is visible BEFORE memory; hold again by dispatching done to
    // the existing held response without ending the transport.
    const ownerHeld = controller.held.find(h => h.question === qa)!;
    ctx.upstream.pending.get(ownerHeld.id).response.write(`data: ${JSON.stringify(done)}\n\n`);
    await gate(ctx, BROWSER_GATES[10], async () => {
      assert.ok(await pollUntil(() => owner.page.locator('button[title="Stop"]').count().then((n: number) => n === 0), 8000));
      assert.ok(await visible(owner, aa));
      assert.equal(controller.held.length, 1, "late memory still held after visible done");
      return { doneBeforeMemory: true };
    });
    controller.release(qa, [memory(ma)]);
    const final = await settled(owner, ctx, id, ma, aa);
    await gate(ctx, BROWSER_GATES[9], async () => {
      assert.ok(await visible(owner, aa));
      assert.deepEqual(final.http.body.memory, ma);
      assert.equal(final.sqlite.session.memory, JSON.stringify(ma));
      return { returnedOwnTurn: final };
    });
    await gate(ctx, BROWSER_GATES[13], async () => {
      const expectedPrefix = projection(delayed);
      assert.deepEqual(projection(final.http.body.messages).slice(0, -2), expectedPrefix);
      assert.equal(final.http.body.messages.at(-2).content, qa);
      assert.equal(final.http.body.messages.at(-1).content, aa);
      assert.ok(durableIs(final, final.http.body.messages, ma));
      assert.equal(final.http.body.messages.some((m: any) => m.content === qb), false,
        "full-snapshot LWW does not promise merging simultaneous turns");
      return { lastWriter: "owner", final };
    });
    await gate(ctx, BROWSER_GATES[14], async () => {
      assert.ok(await visible(member, aa), "idle member must converge to final winner");
      assert.equal(await visible(member, ab, 200), false);
      await recorder.screenshot(member.page, "overlap-converged");
      return { owner: aa, member: aa };
    });
    await gate(ctx, BROWSER_GATES[15], async () => {
      // Fresh reload shows final state; next normal send replays exact opaque
      // memory. Legacy memory-before-done was committed by member above.
      assert.deepEqual(memberDurable.http.body.memory, mb);
      await owner.page.reload({ waitUntil: "domcontentloaded" }); await owner.waitForComposer();
      assert.ok(await visible(owner, aa));
      const q = `reload-replay-${ctx.label}`;
      controller.plans.set(q, [{ frames: [memory(blob("replayed")), { content: "Reload replay complete" }, done] }]);
      await owner.send(q);
      assert.ok(await pollUntil(() => ctx.upstream.requests.some((r: any) => r.body?.question === q), 10000));
      assert.deepEqual(ctx.upstream.requests.find((r: any) => r.body?.question === q).body.conversation_memory, ma);
      assert.ok(await visible(owner, "Reload replay complete"));
      return { replayed: ma, legacy: mb };
    });
    await pollUntil(() => acknowledgments.length >= recorder.patches.length, 10000);
    await gate(ctx, BROWSER_GATES[16], async () => {
      assert.ok(acknowledgments.length > 0);
      assert.equal(acknowledgments.length, recorder.patches.length);
      assert.ok(acknowledgments.every(a => a.status === 200));
      return { requests: recorder.patches, acknowledgments };
    });
  } finally {
    // Every context participates in error/isolation acceptance, including on
    // scenario failure. Do not silently turn a precondition error into a gate.
    ctx.check(BROWSER_GATES[17], sessions.every(s => s.pageErrors.length === 0), sessions.map(s => s.pageErrors));
    ctx.check(BROWSER_GATES[18], sessions.every(s => s.blocked.length === 0), sessions.map(s => s.blocked));
    ctx.check(BROWSER_GATES[19], controller.unmatched.length === 0 && controller.held.length === 0,
      { unmatched: controller.unmatched, held: controller.held });
    writeFileSync(join(recorder.dir, "browser-observations.json"), JSON.stringify({
      observations: recorder.observations, patches: recorder.patches, acknowledgments,
      feeds: await Promise.all(sessions.map(s => s.page?.evaluate(() => (window as any).__projectFeeds).catch(() => null))),
    }, null, 2));
    await member.close(); await owner.close();
  }
}
