// Browser journey scenario for scripts/chat-journey-runtime.mjs (shared
// runtime, read-only): drives the REAL login form, composer, regenerate /
// edit-last controls and sidebar chat switch of the unchanged Next app in a
// real Chromium (installed Playwright + cached browser, no installs), with a
// browser request allowlist (loopback app origin only), passive PATCH
// observation, real HTTP GET + read-only SQLite durable observations and
// controllable held loopback SSE.
//
// Modes:
//   baseline  — frozen positive intended-behavior gates run against the
//               retained broken page; every gate that must reject is expected
//               to reject AT ITS OWN ASSERTION. A case counts as a successful
//               defect reproduction only when all such gates rejected and all
//               in-case healthy controls passed. Product obligations stay
//               FAILED (see the runner's claim-verdicts.json).
//   candidate — the SAME gates are judged directly (ok = gate passed) for a
//               separately authorized fix slice.
//
// This module owns evaluation only; it never edits runtime source, schema,
// migrations, configs or locks. The only declared run-owned scratch mutation
// is the DE locale app_settings flip for the DE dark-surface check (mirrors
// the runtime's augment-child pattern; reversed before the behavioral cases).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPTS_DIR);
const repoRequire = createRequire(join(REPO_ROOT, "package.json"));

export type BrowserMode = "baseline" | "candidate";

const PLAYWRIGHT_CORE_DEFAULT =
  "/home/clippy/coding/tixu-agent/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core";
const CHROMIUM_DEFAULT =
  "/home/clippy/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";

export function browserPrerequisites() {
  const pwPath = process.env.CHAT_BROWSER_PLAYWRIGHT_CORE || PLAYWRIGHT_CORE_DEFAULT;
  const chromiumPath = process.env.CHAT_BROWSER_CHROMIUM || CHROMIUM_DEFAULT;
  const problems: string[] = [];
  for (const [what, p] of [["playwright-core", pwPath], ["chromium executable", chromiumPath]] as const) {
    if (!existsSync(p)) problems.push(`${what} not found: ${p}`);
  }
  return { pwPath, chromiumPath, problems };
}

function sha256(buf: Buffer | string) {
  return createHash("sha256").update(buf).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

// ---- Frames -----------------------------------------------------------------

const mkBlob = (tag: string) => ({ conversation_memory: tag, turns: 2 });
const memFrame = (blob: unknown) => ({ memory_update: blob });
const donePending = { done: true, pending_memory: true, refused: false, truncated: false };
const donePlain = { done: true, refused: false, truncated: false };

function sourcesFrame(sid: string) {
  return {
    sources: [
      {
        document_id: sid,
        chunk_id: `${sid}-chunk-0`,
        content: `Fixture source content for ${sid}.\n`,
        score: 0.42,
        sid,
        title: sid,
        metadata: { filename: `${sid}.md`, chunk_index: 0 },
      },
    ],
  };
}

type Step = {
  frames: unknown[];
  // holdMemoryBlob: write `frames`, hold the response; the lead later releases
  // it with a single memory_update frame (the "old late memory").
  holdMemoryBlob?: unknown;
  // holdOnly: write `frames`, hold; released later with `releaseWith`.
  holdOnly?: boolean;
  releaseWith?: unknown[];
};

// ---- Recorder -----------------------------------------------------------------

export class Recorder {
  dir: string;
  blocked: { url: string; method: string }[] = [];
  patches: { t: string; chatId: string; body: any }[] = [];
  observations: Record<string, unknown>[] = [];
  private digestTargets: string[] = [];

  constructor(logsDir: string) {
    this.dir = join(logsDir, "browser");
    mkdirSync(join(this.dir, "screenshots"), { recursive: true });
  }

  track(p: string) {
    if (!this.digestTargets.includes(p)) this.digestTargets.push(p);
  }

  jsonl(name: string) {
    const p = join(this.dir, name);
    appendFileSync(p, "");
    this.track(p);
    return p;
  }

  appendJsonl(name: string, row: unknown) {
    appendFileSync(join(this.dir, name), JSON.stringify(row) + "\n");
    const p = join(this.dir, name);
    if (!this.digestTargets.includes(p)) this.digestTargets.push(p);
  }

  obs(id: string, data: unknown) {
    this.observations.push({ id, at: nowIso(), data });
    return { id, data };
  }

  async screenshot(page: any, name: string) {
    const p = join(this.dir, "screenshots", `${name}.png`);
    try {
      await page.screenshot({ path: p, fullPage: false });
      this.track(p);
    } catch (err) {
      this.obs(`screenshot-failed:${name}`, String(err));
    }
    return p;
  }

  writeDigests() {
    const digests: Record<string, string> = {};
    for (const p of this.digestTargets) {
      try {
        digests[p] = sha256(readFileSync(p));
      } catch (err) {
        digests[p] = `digest-failed: ${String(err)}`;
      }
    }
    const out = join(this.dir, "browser-evidence-digests.json");
    writeFileSync(out, JSON.stringify(digests, null, 2));
    return out;
  }
}

// ---- Durable observation helpers ------------------------------------------------

let probeCounter = 0;
async function httpGetChat(ctx: any, cookie: string, chatId: string) {
  probeCounter += 1;
  const probe = `jprobe=${probeCounter}`;
  const res = await ctx.request(`/api/me/chats/${chatId}?${probe}`, {
    cookie,
    headers: { Accept: "application/json" },
  });
  const status = res.status;
  let body: any = null;
  const headers401: Record<string, string> = {};
  if (status === 401) {
    for (const [k, v] of res.headers as any) headers401[k] = String(v);
    // Independent retry through a plain fetch (same explicit Cookie header)
    // to distinguish a transport/tooling issue from an app decision.
    try {
      const retry = await fetch(`${ctx.baseUrl}/api/me/chats/${chatId}?${probe}-retry`, {
        headers: { Accept: "application/json", Cookie: cookie },
        redirect: "manual",
      });
      let retryBody: any = null;
      try {
        retryBody = await retry.json();
      } catch {}
      return { status, body, probe, retry: { status: retry.status, body: retryBody }, headers401 };
    } catch (err) {
      return { status, body, probe, retryError: String(err), headers401 };
    }
  }
  try {
    body = await res.json();
  } catch {}
  return { status, body, probe };
}

// Resolve the cookie the browser actually holds, validated against the
// durable sessions table (several cortex_session cookies can exist; only one
// is a live DB session).
function validSessionTokens(dataDir: string) {
  const Database = repoRequire("better-sqlite3");
  const db = new Database(join(dataDir, "cortex-chat.db"), { readonly: true, fileMustExist: true });
  try {
    return new Set(db.prepare("SELECT token FROM sessions").all().map((r: any) => r.token));
  } finally {
    db.close();
  }
}

export function sqliteReadSession(dataDir: string, chatId: string) {
  const Database = repoRequire("better-sqlite3");
  const dbPath = join(dataDir, "cortex-chat.db");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const session = db
      .prepare("SELECT id, title, memory, updated_at FROM chat_sessions WHERE id = ?")
      .get(chatId);
    const messages = db
      .prepare(
        "SELECT id, role, content, user_id, created_at FROM chat_messages WHERE chat_session_id = ? ORDER BY created_at, rowid"
      )
      .all(chatId);
    return { session, messages };
  } finally {
    db.close();
  }
}

export function setAppLocale(dataDir: string, locale: "en" | "de") {
  const Database = repoRequire("better-sqlite3");
  const dbPath = join(dataDir, "cortex-chat.db");
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('locale', ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).run(locale, Date.now());
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'locale'").get();
    if (row?.value !== locale) throw new Error(`locale flip read-back mismatch: ${JSON.stringify(row)}`);
  } finally {
    db.close();
  }
}

export async function pollUntil(fn: () => boolean | Promise<boolean>, budgetMs: number, intervalMs = 100) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

const bodyHas = (patch: { body: any }, needle: string) =>
  JSON.stringify(patch.body ?? {}).includes(needle);

// ---- Upstream controller ----------------------------------------------------------

export function makeUpstreamController(ctx: any) {
  const plans = new Map<string, Step[]>();
  const unmatched: { id: string; question: unknown }[] = [];
  const held: { id: string; question: string }[] = [];

  ctx.upstream.setHandler((req: any, res: any, record: any) => {
    const path = (record.path || "").split("?")[0];
    if (path === "/api/collections") {
      record.handled = "browser-journey-collections";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("[]");
      return;
    }
    if (record.method === "POST" && path === "/api/ask/stream") {
      const question = record.body?.question;
      const queue = plans.get(String(question));
      const step = queue?.shift();
      if (!step) {
        unmatched.push({ id: record.id, question });
        record.handled = "browser-journey-unmatched";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "browser-journey: no plan for this question" }));
        return;
      }
      record.handled = "browser-journey-plan";
      for (const frame of step.frames) {
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
      }
      if (step.holdMemoryBlob !== undefined || step.holdOnly) {
        held.push({ id: record.id, question: String(question) });
        return;
      }
      res.end();
      return;
    }
    record.handled = "browser-journey-unhandled";
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "browser-journey upstream: unhandled path" }));
  });

  async function waitHeld(question: string, budgetMs: number) {
    const found = await pollUntil(() => {
      const recs = ctx.upstream.requests.filter((r: any) => r.body?.question === question);
      return recs.length > 0 && recs.every((r: any) => held.some((h) => h.id === r.id) || r.released);
    }, budgetMs);
    const records = ctx.upstream.requests.filter((r: any) => r.body?.question === question);
    return { found, records };
  }

  function release(question: string, frames: unknown[]) {
    const entry = held.find((h) => h.question === question);
    if (!entry) throw new Error(`no held upstream response for question: ${question}`);
    held.splice(held.indexOf(entry), 1);
    ctx.upstream.release(entry.id, frames);
    return entry.id;
  }

  return { plans, unmatched, held, waitHeld, release };
}

// ---- Browser environment ------------------------------------------------------------

const COMPOSER_EN = 'input[placeholder="Ask a complex question for deep research..."]';

export class BrowserSession {
  pw: any;
  chromiumPath: string;
  browser: any;
  context: any;
  page: any;
  baseUrl: string;
  recorder: Recorder;
  cookie = "";
  blocked: { url: string; method: string }[] = [];
  pageErrors: string[] = [];
  ownsBrowser = true;

  constructor(pw: any, chromiumPath: string, baseUrl: string, recorder: Recorder) {
    this.pw = pw;
    this.chromiumPath = chromiumPath;
    this.baseUrl = baseUrl;
    this.recorder = recorder;
  }

  async start(sharedBrowser?: any) {
    this.ownsBrowser = !sharedBrowser;
    this.browser = sharedBrowser ?? await this.pw.chromium.launch({
      executablePath: this.chromiumPath,
      headless: true,
    });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    });
    this.context.setDefaultTimeout(60_000);
    this.context.setDefaultNavigationTimeout(180_000);
    const allowed = new URL(this.baseUrl).origin;
    const requestsPath = this.recorder.jsonl("browser-requests.jsonl");
    const patchesPath = this.recorder.jsonl("browser-patch-bodies.jsonl");
    await this.context.route("**/*", (route: any) => {
      const req = route.request();
      let url: URL;
      try {
        url = new URL(req.url());
      } catch {
        this.blocked.push({ url: req.url(), method: req.method() });
        this.recorder.appendJsonl("browser-blocked.jsonl", { at: nowIso(), url: req.url(), method: req.method(), reason: "unparseable" });
        return route.abort();
      }
      appendFileSync(requestsPath, JSON.stringify({ at: nowIso(), method: req.method(), url: req.url() }) + "\n");
      if (url.origin !== allowed) {
        this.blocked.push({ url: req.url(), method: req.method() });
        this.recorder.appendJsonl("browser-blocked.jsonl", { at: nowIso(), method: req.method(), url: req.url(), reason: "non-loopback-origin" });
        return route.abort();
      }
      if (req.method() === "PATCH" && /^\/api\/me\/chats\/[^/]+$/.test(url.pathname)) {
        let body: any = null;
        try {
          body = JSON.parse(req.postData() ?? "null");
        } catch {}
        const chatId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        const patch = { t: nowIso(), chatId, body };
        this.recorder.patches.push(patch);
        appendFileSync(patchesPath, JSON.stringify(patch) + "\n");
      }
      return route.continue();
    });
    this.context.on("page", (page: any) => page.on("pageerror", (err: Error) => {
      this.pageErrors.push(err.message);
      this.recorder.obs("page-error", { message: err.message });
    }));
    this.context.on("page", (page: any) => page.on("crash", () => {
      this.pageErrors.push("Chromium page crashed");
      this.recorder.obs("page-crash", { url: page.url() });
    }));
    this.page = await this.context.newPage();
    // Block the dev-only HMR websocket from the browser side. Next dev fires
    // its lazy registry version check exactly when a browser connects to the
    // HMR socket; without a connection the fetch never happens, so the shared
    // runtime's network tripwire stays clean. No production behavior is
    // changed — this is browser-side request handling only.
    await this.context.routeWebSocket("**/_next/*", (ws: any) => {
      this.recorder.obs("hmr-websocket-blocked", { url: ws.url?.() ?? null });
      ws.close();
    });
  }

  composer() {
    return this.page.locator("input[type=text]").last();
  }

  async waitForComposer(timeoutMs = 60_000) {
    await this.composer().waitFor({ state: "visible", timeout: timeoutMs });
  }

  async login(ctx: any, email: string, password: string) {
    const page = this.page;
    await page.goto(this.baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForURL((u: URL) => u.pathname.startsWith("/login"), { timeout: 180_000 });
    await page.waitForSelector("input[type=email]", { timeout: 60_000 });
    await this.recorder.screenshot(page, "login-page");
    await page.fill("input[type=email]", email);
    await page.fill("input[type=password]", password);
    await page.click("button[type=submit]");
    await page.waitForURL((u: URL) => !u.pathname.includes("login"), { timeout: 60_000 });
    await this.waitForComposer();
    const cookies = await this.context.cookies(this.baseUrl);
    const candidates = cookies.filter((c: any) => c.name === "cortex_session");
    const tokens = validSessionTokens(ctx.dataDir);
    const valid = candidates.find((c: any) => tokens.has(c.value));
    if (!valid) {
      throw new Error(
        "no cortex_session cookie matching a live DB session after login (candidates: " +
          JSON.stringify(candidates.map((c: any) => ({ path: c.path, fp: c.value.slice(0, 10) }))) +
          ")"
      );
    }
    this.cookie = `cortex_session=${valid.value}`;
    this.recorder.obs("login.cookie-resolved", {
      candidates: candidates.map((c: any) => ({ path: c.path, fp: c.value.slice(0, 10), inDb: tokens.has(c.value) })),
      note: "cookie value withheld; fingerprint only",
    });
    await this.recorder.screenshot(page, "after-login-empty-chat");
    return { cookiePresent: true, url: page.url() };
  }

  async send(text: string) {
    await this.composer().fill(text);
    await this.page.click('button[aria-label="Send"]');
  }

  async waitAnswerVisible(answerText: string, timeoutMs = 90_000) {
    const page = this.page;
    await page.waitForFunction((t: string) => document.body.innerText.includes(t), answerText, { timeout: timeoutMs });
    await page.waitForSelector('button[aria-label="Regenerate"]', { timeout: timeoutMs });
  }

  async waitForPatch(pred: (p: { chatId: string; body: any }) => boolean, budgetMs: number) {
    return pollUntil(() => this.recorder.patches.some(pred), budgetMs);
  }

  async chatIdFromUrl() {
    const page = this.page;
    await page.waitForURL("**/?chat=*", { timeout: 30_000 });
    return new URL(page.url()).searchParams.get("chat") ?? "";
  }

  async durable(ctx: any, chatId: string) {
    const http = await httpGetChat(ctx, this.cookie, chatId);
    const sqlite = sqliteReadSession(ctx.dataDir, chatId);
    return { http, sqlite };
  }

  // Durable read that waits for the observed persistence to actually commit:
  // PATCH requests are captured at send time, so a plain follow-up read can
  // race the in-flight transaction.
  async durableSettled(ctx: any, chatId: string, pred: (d: { http: any; sqlite: any }) => boolean, budgetMs = 10_000) {
    let last = await this.durable(ctx, chatId);
    await pollUntil(async () => {
      last = await this.durable(ctx, chatId);
      return pred(last);
    }, budgetMs, 250);
    return last;
  }

  drawer() {
    return this.page.locator("div.z-50.translate-x-0");
  }

  async openSidebar() {
    await this.page.click('button[aria-label="Toggle sidebar"]');
    await this.drawer().waitFor({ state: "visible", timeout: 30_000 });
  }

  async newChatViaSidebar() {
    await this.openSidebar();
    await this.recorder.screenshot(this.page, "sidebar-open");
    await this.drawer().locator("button", { hasText: "New Chat" }).first().click();
    await this.page.waitForURL((u: URL) => !u.searchParams.has("chat"), { timeout: 30_000 });
    await this.waitForComposer();
  }

  async switchToChatByTitle(title: string, waitText: string) {
    await this.openSidebar();
    await this.drawer().getByText(title, { exact: true }).first().click();
    // URL-only waits are ambiguous (?chat= may already match); the switch is
    // complete when the target chat's content is actually rendered.
    await this.page.waitForFunction((t: string) => document.body.innerText.includes(t), waitText, { timeout: 30_000 });
    await this.waitForComposer();
  }

  async clickRegenerate() {
    const page = this.page;
    const bubble = page.locator("div.group").last();
    await bubble.hover();
    await bubble.locator('button[aria-label="Regenerate"]').first().click();
  }

  async editLastMessage(from: string, to: string) {
    const page = this.page;
    const bubble = page.locator("div.group").filter({ hasText: from }).first();
    await bubble.hover();
    await bubble.locator('button[aria-label="Edit message"]').first().click();
    const textarea = page.locator("textarea");
    await textarea.waitFor({ state: "visible", timeout: 30_000 });
    await textarea.fill(to);
    await page.getByText("Save & send").click();
  }

  // Observe persisted state in a FRESH page without disturbing streams that
  // are deliberately held open in the main page (a reload would abort them).
  async peekPage(path: string, waitText: string | null, name: string) {
    const page = await this.context.newPage();
    try {
      await page.goto(this.baseUrl + path, { waitUntil: "domcontentloaded" });
      await page.locator("input[type=text]").last().waitFor({ state: "visible", timeout: 90_000 });
      if (waitText !== null) {
        await page.waitForFunction((t: string) => document.body.innerText.includes(t), waitText, { timeout: 30_000 }).catch(() => null);
        const shown = await page.evaluate((t: string) => document.body.innerText.includes(t), waitText);
        await this.recorder.screenshot(page, name);
        return { shown, url: page.url() };
      }
      await this.recorder.screenshot(page, name);
      return { shown: null, url: page.url() };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async close() {
    try {
      if (this.context) await this.context.close();
      if (this.browser && this.ownsBrowser) await this.browser.close();
    } catch {}
  }
}

// ---- Frozen positive gates ----------------------------------------------------------
// Each gate is a pure evaluation of observations. `intended` states what the
// frozen gate must do against the retained broken baseline:
//   reject — the gate's own assertion must reject (defect surface)
//   pass   — healthy control inside the case (must hold even on baseline)

type GateResult = {
  gate: string;
  intended: "reject" | "pass";
  rejected: boolean;
  passed: boolean;
  observed: Record<string, unknown>;
};

function gateResult(gate: string, intended: "reject" | "pass", ok: boolean, observed: Record<string, unknown>): GateResult {
  return { gate, intended, rejected: intended === "reject" ? !ok : false, passed: ok, observed };
}

// Positive intended behavior: a late callback of turn N must NEVER persist
// another turn's in-flight (streaming) content — not via PATCH body, not into
// durable HTTP state, not into durable SQLite rows.
function gateNoInflightPersisted(
  gate: string,
  marker: string,
  patchesSince: { chatId: string; body: any }[],
  durable: { http: any; sqlite: any }
): GateResult {
  const patchHits = patchesSince.filter((p) => bodyHas(p, marker));
  const httpMessages = JSON.stringify(durable.http.body?.messages ?? []);
  const sqliteMessages = JSON.stringify(durable.sqlite.messages ?? []);
  return gateResult(
    gate,
    "reject",
    patchHits.length === 0 && !httpMessages.includes(marker) && !sqliteMessages.includes(marker),
    { patchHits: patchHits.length, httpHit: httpMessages.includes(marker), sqliteHit: sqliteMessages.includes(marker), marker }
  );
}

// Positive intended behavior checks over durable memory (HTTP + SQLite).
function gateDurableMemoryIs(
  gate: string,
  expected: unknown,
  durable: { http: any; sqlite: any },
  intended: "reject" | "pass"
): GateResult {
  const httpMemory = durable.http.body?.memory ?? null;
  const sqliteMemory = durable.sqlite.session?.memory ?? null;
  const expectedSqlite = expected === null ? null : JSON.stringify(expected);
  return gateResult(
    gate,
    intended,
    JSON.stringify(httpMemory) === JSON.stringify(expected) && sqliteMemory === expectedSqlite,
    { expected, httpMemory, sqliteMemory }
  );
}

// ---- Case runner ---------------------------------------------------------------------

type CaseResult = {
  name: string;
  gates: GateResult[];
  allRejects: boolean;
  allPasses: boolean;
  preconditionError?: string;
};

async function runCase(name: string, recorder: Recorder, body: () => Promise<GateResult[]>): Promise<CaseResult> {
  try {
    const gates = await body();
    const allRejects = gates.filter((g) => g.intended === "reject").every((g) => g.rejected);
    const allPasses = gates.filter((g) => g.intended === "pass").every((g) => g.passed);
    return { name, gates, allRejects, allPasses };
  } catch (err) {
    return {
      name,
      gates: [],
      allRejects: false,
      allPasses: false,
      preconditionError: String((err as Error).stack ?? err),
    };
  }
}

// ---- Main scenario ---------------------------------------------------------------------

export async function runBrowserChecks(ctx: any, mode: BrowserMode) {
  const recorder = new Recorder(join(ctx.workDir, "logs"));
  const { pwPath, chromiumPath, problems } = browserPrerequisites();
  if (problems.length > 0) throw new Error(`browser prerequisites missing: ${problems.join("; ")}`);
  const pw = repoRequire(pwPath.endsWith("index.js") ? pwPath : join(pwPath, "index.js"));
  const pwPkg = JSON.parse(readFileSync(join(pwPath, "package.json"), "utf8"));
  const pwBrowserJson = readFileSync(join(pwPath, "browsers.json"), "utf8");

  // Baseline source identity: preserve the exact page.tsx under test plus its
  // git identity (working tree is the accepted frozen input).
  const pagePath = join(REPO_ROOT, "src", "app", "page.tsx");
  const pageBytes = readFileSync(pagePath);
  const baselinePageCopy = join(recorder.dir, "baseline-page.tsx");
  copyFileSync(pagePath, baselinePageCopy);
  recorder.track(baselinePageCopy);
  let gitHead: string | null = null;
  let gitPageBlob: string | null = null;
  try {
    gitHead = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    gitPageBlob = execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD:src/app/page.tsx"], { encoding: "utf8" }).trim();
  } catch {}

  const manifestPath = join(recorder.dir, "browser-run-manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        mode,
        at: nowIso(),
        tooling: {
          playwrightCorePath: pwPath,
          playwrightCoreVersion: pwPkg.version,
          playwrightCorePackageSha256: sha256(readFileSync(join(pwPath, "package.json"))),
          playwrightBrowsersJsonSha256: sha256(pwBrowserJson),
          chromiumExecutable: chromiumPath,
          chromiumExecutableSize: statSync(chromiumPath).size,
          installPerformed: false,
        },
        baselineSource: {
          pageTsWorkingTreeSha256: sha256(pageBytes),
          pageTsGitBlob: gitPageBlob,
          chatGitHead: gitHead,
          note: "working tree src is the accepted frozen runtime input; a verbatim page.tsx copy is retained beside this manifest",
        },
        declaredRunOwnedWrites: [
          "scratch app_settings.locale flip en->de->en for the DE dark-surface check (scratch data only, reversed)",
        ],
        isolationLimits: [
          "browser allowlist is Playwright route interception, not OS/native-socket egress confinement",
          "development `next dev` request context, not production build/start",
          "upstream is a synthetic loopback fixture; no model/provider calls",
        ],
      },
      null,
      2
    )
  );
  recorder.track(manifestPath);

  const session = new BrowserSession(pw, chromiumPath, ctx.baseUrl, recorder);
  const controller = makeUpstreamController(ctx);
  const label = ctx.label;

  try {
    await session.start();
    // --- Login through the real form (healthy control) ---
    const owner = ctx.users.owner;
    const login = await session.login(ctx, owner.email, owner.password);
    // Auth-pipeline diagnostic: replicate the D-proven parent-side path (HTTP
    // login via ctx.request, then an authenticated GET with the returned
    // cookie) to isolate any transport/middleware difference from the browser
    // login flow.
    let authProbe: Record<string, unknown>;
    try {
      const res = await ctx.request("/api/auth/login", {
        method: "POST",
        body: { email: owner.email, password: owner.password },
      });
      const setCookie = res.headers.get("set-cookie") ?? "";
      const loginBody = await res.json().catch(() => null);
      const m = /cortex_session=([^;]+)/.exec(setCookie);
      const probeCookie = m ? m[1] : null;
      let meStatus: number | null = null;
      let meOk: boolean | null = null;
      if (probeCookie) {
        const me = await ctx.request("/api/auth/me", { cookie: `cortex_session=${probeCookie}` });
        meStatus = me.status;
        const meBody = await me.json().catch(() => null);
        meOk = meStatus === 200 && !!meBody?.id;
      }
      authProbe = {
        loginStatus: res.status,
        loginOk: loginBody?.id ?? null,
        setCookiePresent: !!probeCookie,
        probeCookieMatchesBrowserCookie: probeCookie === session.cookie,
        meStatus,
        meOk,
      };
    } catch (err) {
      authProbe = { error: String((err as Error).message ?? err) };
    }
    recorder.obs("auth-pipeline-probe", authProbe);
    ctx.check("browser.login.form-real", authProbe.meOk === true, {
      redirectedTo: "/login first, then chat surface",
      url: login.url,
      cookie: "cortex_session resolved against the durable sessions table (value withheld)",
      parentAuthProbe: authProbe,
    });
    await recorder.screenshot(session.page, "logged-in");

    const surfaceSnapshot = async () => {
      const placeholder = await session.composer().getAttribute("placeholder");
      const rest = await session.page.evaluate(() => ({
        darkClass: document.documentElement.classList.contains("dark"),
        lang: document.documentElement.lang,
        bodyBg: getComputedStyle(document.body).backgroundColor,
      }));
      return { ...rest, placeholder };
    };

    // --- Dark surface EN (dark-only design; html.dark is the primary surface) ---
    const darkEn = await surfaceSnapshot();
    const enOk = darkEn.darkClass === true && darkEn.placeholder === "Ask a complex question for deep research...";
    ctx.check("browser.surface.dark-en", enOk, { ...darkEn, note: "dark class + EN composer placeholder; not a visual regression suite" });

    // --- DE surface via declared scratch locale flip, then restore EN ---
    let deOutcome: Record<string, unknown>;
    let deOk = false;
    try {
      setAppLocale(ctx.dataDir, "de");
      await session.page.reload({ waitUntil: "domcontentloaded" });
      await session.waitForComposer();
      const darkDe = await surfaceSnapshot();
      deOk = darkDe.darkClass === true && darkDe.lang === "de" && darkDe.placeholder === "Stelle eine komplexe Frage für Deep Research...";
      deOutcome = { ...darkDe };
      setAppLocale(ctx.dataDir, "en");
      await session.page.reload({ waitUntil: "domcontentloaded" });
      await session.waitForComposer();
      const restored = await session.page.evaluate(() => document.documentElement.lang);
      deOutcome = { ...deOutcome, restoredLocale: restored };
      if (restored !== "en") deOk = false;
    } catch (err) {
      deOutcome = { error: String((err as Error).message ?? err) };
      try {
        setAppLocale(ctx.dataDir, "en");
        await session.page.reload({ waitUntil: "domcontentloaded" });
        await session.waitForComposer();
      } catch {}
    }
    ctx.check("browser.surface.dark-de", deOk, { ...deOutcome, note: "DE flip is a declared run-owned scratch app_settings mutation, reversed after the check" });
    await recorder.screenshot(session.page, "surface-en-restored");

    // =====================================================================
    // Control 1: healthy settled turn with held late memory
    // =====================================================================
    const c1 = await runCase("settled-turn-late-memory", recorder, async () => {
      const q1 = `settled-q1-${label}`;
      const a1 = `Settled control answer one for ${label}.`;
      const blob1 = mkBlob(`fx-journey-memory-settled-v1-${label}`);
      const q2 = `settled-q2-${label}`;
      controller.plans.set(q1, [
        { frames: [{ content: a1 }, sourcesFrame("fx-src-settled"), donePending], holdMemoryBlob: blob1 },
      ]);
      controller.plans.set(q2, [{ frames: [{ content: `Settled control answer two for ${label}.` }, donePlain] }]);
      await session.send(q1);
      await session.waitAnswerVisible(a1);
      const chatId = await session.chatIdFromUrl();
      const persistSeen = await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, a1), 15_000);
      recorder.obs("settled.visible-completion-before-release", { chatId, persistSeen, answer: a1 });
      await recorder.screenshot(session.page, "settled-visible-complete");
      const before = await session.durable(ctx, chatId);
      controller.release(q1, [memFrame(blob1)]);
      const after = await session.durableSettled(
        ctx,
        chatId,
        (d) => JSON.stringify(d.http.body?.memory ?? null) === JSON.stringify(blob1) && d.sqlite.session?.memory === JSON.stringify(blob1)
      );
      const gMemory = gateDurableMemoryIs("gate.settled.late-memory-durable", blob1, after, "pass");
      await session.page.reload({ waitUntil: "domcontentloaded" });
      await session.waitAnswerVisible(a1);
      await session.send(q2);
      const gReplay = await pollUntil(
        () => ctx.upstream.requests.some((r: any) => r.body?.question === q2 && JSON.stringify(r.body?.conversation_memory ?? null) === JSON.stringify(blob1)),
        15_000
      );
      recorder.obs("settled.next-send-replay", { chatId, replay: gReplay, blob: blob1 });
      await recorder.screenshot(session.page, "settled-after-reload");
      return [
        gMemory,
        gateResult("gate.settled.reload-visible", "pass", true, { chatId, reloaded: true }),
        gateResult("gate.settled.next-send-replay", "pass", gReplay, { blob: blob1 }),
        gateResult("gate.settled.pre-release-state-clean", "pass", !JSON.stringify(before.http.body?.messages ?? []).includes("partial"), { beforeReleaseMemory: before.http.body?.memory ?? null }),
      ];
    });
    emitCase(ctx, mode, "control.settled-turn-late-memory", c1);

    // =====================================================================
    // Control 2: legacy ordering (memory_update BEFORE done)
    // =====================================================================
    const c2 = await runCase("legacy-order", recorder, async () => {
      await session.newChatViaSidebar();
      const q1 = `legacy-q1-${label}`;
      const a1 = `Legacy order answer one for ${label}.`;
      const legacyBlob = mkBlob(`fx-journey-memory-legacy-v1-${label}`);
      const q2 = `legacy-q2-${label}`;
      controller.plans.set(q1, [
        { frames: [memFrame(legacyBlob), { content: a1 }, sourcesFrame("fx-src-legacy"), donePlain] },
      ]);
      controller.plans.set(q2, [{ frames: [{ content: `Legacy order answer two for ${label}.` }, donePlain] }]);
      await session.send(q1);
      await session.waitAnswerVisible(a1);
      const chatId = await session.chatIdFromUrl();
      await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, a1), 15_000);
      const durable = await session.durableSettled(
        ctx,
        chatId,
        (d) => JSON.stringify(d.http.body?.memory ?? null) === JSON.stringify(legacyBlob) && d.sqlite.session?.memory === JSON.stringify(legacyBlob)
      );
      const gMemory = gateDurableMemoryIs("gate.legacy.memory-before-done-durable", legacyBlob, durable, "pass");
      await session.page.reload({ waitUntil: "domcontentloaded" });
      await session.waitAnswerVisible(a1);
      await session.send(q2);
      const gReplay = await pollUntil(
        () => ctx.upstream.requests.some((r: any) => r.body?.question === q2 && JSON.stringify(r.body?.conversation_memory ?? null) === JSON.stringify(legacyBlob)),
        15_000
      );
      recorder.obs("legacy.next-send-replay", { chatId, replay: gReplay });
      await recorder.screenshot(session.page, "legacy-after-reload");
      return [
        gMemory,
        gateResult("gate.legacy.reload-visible", "pass", true, { chatId, reloaded: true }),
        gateResult("gate.legacy.next-send-replay", "pass", gReplay, { blob: legacyBlob }),
      ];
    });
    emitCase(ctx, mode, "control.legacy-order", c2);

    // =====================================================================
    // Case A: done -> rapid next-send -> old late memory (turn N callback
    // persists turn N+1's in-flight partial content)
    // =====================================================================
    const cA = await runCase("rapid-next-send", recorder, async () => {
      await session.newChatViaSidebar();
      const q1 = `rapid-q1-${label}`;
      const a1 = `Rapid answer one for ${label}.`;
      const blob1 = mkBlob(`fx-journey-memory-rapid-v1-${label}`);
      const q2 = `rapid-q2-${label}`;
      const partial2 = `partial-next-answer marker ${label} in-flight turn content`;
      const blob2 = mkBlob(`fx-journey-memory-rapid-v2-${label}`);
      controller.plans.set(q1, [
        { frames: [{ content: a1 }, sourcesFrame("fx-src-rapid"), donePending], holdMemoryBlob: blob1 },
      ]);
      controller.plans.set(q2, [{ frames: [{ content: partial2 }], holdOnly: true, releaseWith: [donePlain, memFrame(blob2)] }]);
      await session.send(q1);
      await session.waitAnswerVisible(a1);
      const chatId = await session.chatIdFromUrl();
      await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, a1), 15_000);
      await recorder.screenshot(session.page, "rapid-turn1-visible-complete");
      recorder.obs("rapid.visible-completion-before-release", { chatId, turn1: a1 });

      const tSend2 = nowIso();
      await session.send(q2);
      const held2 = await controller.waitHeld(q2, 20_000);
      await session.page.waitForFunction((t: string) => document.body.innerText.includes(t), partial2, { timeout: 90_000 });
      recorder.obs("rapid.turn2-inflight-partial-visible", { held: held2.found, partial: partial2 });
      await recorder.screenshot(session.page, "rapid-turn2-inflight");

      controller.release(q1, [memFrame(blob1)]);
      await session.waitForPatch((p) => p.chatId === chatId && JSON.stringify(p.body?.memory ?? {}) === JSON.stringify(blob1), 5_000)
        .then((seen) => recorder.obs("rapid.late-callback-patch-with-blob", { seen }));
      await new Promise((r) => setTimeout(r, 3_000));
      const patchesSince = session.recorder.patches.filter((p) => p.t >= tSend2 && p.chatId === chatId);
      const durable = await session.durable(ctx, chatId);
      recorder.obs("rapid.durable-after-release", { durable });
      await recorder.screenshot(session.page, "rapid-after-late-release");

      const gNoInflight = gateNoInflightPersisted("gate.rapid.no-inflight-turn-persisted", partial2, patchesSince, durable);
      const gLateMemory = gateDurableMemoryIs("gate.rapid.late-memory-persisted", blob1, durable, "pass");

      // UI-visible defect evidence from a FRESH page (the main page keeps
      // turn 2's deliberately held stream open — a reload would abort it).
      const peek = await session.peekPage(`/?chat=${chatId}`, partial2, "rapid-fresh-page-shows-inflight-content");
      recorder.obs("rapid.fresh-page-shows-inflight-content", { peek, defectEvidence: peek.shown });

      const cleanupRelease = controller.release(q2, [donePlain, memFrame(blob2)]);
      const settled = await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, partial2) && bodyHas(p, JSON.stringify(blob2)), 20_000);
      const finalDurable = await session.durable(ctx, chatId);
      recorder.obs("rapid.cleanup-settled-turn2", { cleanupRelease, settled, finalMemory: finalDurable.http.body?.memory ?? null });
      await session.page.reload({ waitUntil: "domcontentloaded" });
      await session.waitForComposer();
      await recorder.screenshot(session.page, "rapid-after-settle");
      return [
        gNoInflight,
        gLateMemory,
        gateResult("gate.rapid.turn2-still-settles", "pass", settled && (finalDurable.http.body?.messages ?? []).length === 4, { settled, messages: (finalDurable.http.body?.messages ?? []).length }),
        gateResult("gate.rapid.turn2-request-memory-replay-clean", "pass", JSON.stringify(held2.records[0]?.body?.conversation_memory ?? null) === JSON.stringify({}), { turn2ConversationMemory: held2.records[0]?.body?.conversation_memory ?? null }),
      ];
    });
    emitCase(ctx, mode, "rapid.defect-reproduced", cA);

    // =====================================================================
    // Case B1: done -> regenerate -> old late memory displaces the restored
    // pre-turn snapshot and persists the redo's in-flight content
    // =====================================================================
    const cB1 = await runCase("regenerate-snapshot", recorder, async () => {
      await session.newChatViaSidebar();
      const q1 = `regen-q1-${label}`;
      const a1 = `Regenerate answer one for ${label}.`;
      const blob1 = mkBlob(`fx-journey-memory-regen-v1-${label}`);
      const q2 = `regen-q2-${label}`;
      const a2 = `Regenerate answer two for ${label}.`;
      const blob2 = mkBlob(`fx-journey-memory-regen-v2-${label}`);
      const superseded = `superseded-post-answer marker ${label} redo in-flight content`;
      const blobRedo = mkBlob(`fx-journey-memory-regen-redo-${label}`);
      controller.plans.set(q1, [{ frames: [{ content: a1 }, sourcesFrame("fx-src-regen"), donePending, memFrame(blob1)] }]);
      controller.plans.set(q2, [
        { frames: [{ content: a2 }, sourcesFrame("fx-src-regen"), donePending], holdMemoryBlob: blob2 },
        { frames: [{ content: superseded }], holdOnly: true, releaseWith: [donePlain, memFrame(blobRedo)] },
      ]);
      await session.send(q1);
      await session.waitAnswerVisible(a1);
      const chatId = await session.chatIdFromUrl();
      await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, a1), 15_000);
      const durableTurn1 = await session.durableSettled(ctx, chatId,
        (d) => JSON.stringify(d.http.body?.memory) === JSON.stringify(blob1) &&
          d.sqlite.session?.memory === JSON.stringify(blob1));
      const gTurn1 = gateDurableMemoryIs("gate.regen.turn1-memory-durable", blob1, durableTurn1, "pass");

      await session.send(q2);
      await session.waitAnswerVisible(a2);
      await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, a2), 15_000);
      await recorder.screenshot(session.page, "regen-turn2-visible-complete");
      recorder.obs("regen.visible-completion-before-regenerate", { chatId, turn2: a2 });

      const tRegen = nowIso();
      await session.clickRegenerate();
      const redoHeld = await controller.waitHeld(q2, 20_000);
      const redoRequest = redoHeld.records[redoHeld.records.length - 1];
      const gSnapshotRequest = gateResult(
        "gate.regen.snapshot-replay-request",
        "pass",
        JSON.stringify(redoRequest?.body?.conversation_memory ?? null) === JSON.stringify(blob1),
        { redoConversationMemory: redoRequest?.body?.conversation_memory ?? null, expected: blob1 }
      );
      await session.page.waitForFunction((t: string) => document.body.innerText.includes(t), superseded, { timeout: 90_000 });
      recorder.obs("regen.redo-inflight-visible", { superseded });
      await recorder.screenshot(session.page, "regen-redo-inflight");

      controller.release(q2, [memFrame(blob2)]);
      await session.waitForPatch((p) => p.chatId === chatId && JSON.stringify(p.body?.memory ?? {}) === JSON.stringify(blob2), 5_000)
        .then((seen) => recorder.obs("regen.late-callback-patch-with-superseded-blob", { seen }));
      await new Promise((r) => setTimeout(r, 3_000));
      const patchesSince = session.recorder.patches.filter((p) => p.t >= tRegen && p.chatId === chatId);
      const durable = await session.durable(ctx, chatId);
      recorder.obs("regen.durable-after-late-release", { durable });
      await recorder.screenshot(session.page, "regen-after-late-release");

      const gSnapshotDurable = gateDurableMemoryIs("gate.regen.snapshot-memory-durable", blob1, durable, "reject");
      const gNoInflight = gateNoInflightPersisted("gate.regen.no-inflight-turn-persisted", superseded, patchesSince, durable);

      const cleanupRelease = controller.release(q2, [donePlain, memFrame(blobRedo)]);
      const settled = await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, superseded), 20_000);
      recorder.obs("regen.cleanup-settled-redo", { cleanupRelease, settled });
      await recorder.screenshot(session.page, "regen-after-settle");
      return [
        gTurn1,
        gSnapshotRequest,
        gSnapshotDurable,
        gNoInflight,
        gateResult("gate.regen.redo-still-settles", "pass", settled, { settled }),
      ];
    });
    emitCase(ctx, mode, "regen.defect-reproduced", cB1);

    // =====================================================================
    // Case B2: done -> edit-last -> old late memory (same snapshot rule)
    // =====================================================================
    const cB2 = await runCase("edit-last-snapshot", recorder, async () => {
      await session.newChatViaSidebar();
      const q1 = `edit-q1-${label}`;
      const a1 = `Edit answer one for ${label}.`;
      const blob1 = mkBlob(`fx-journey-memory-edit-v1-${label}`);
      const q2 = `edit-q2-${label}`;
      const a2 = `Edit answer two for ${label}.`;
      const blob2 = mkBlob(`fx-journey-memory-edit-v2-${label}`);
      const q2Edited = `edit-q2-edited-${label}`;
      const redoPartial = `edited-redo-partial marker ${label} fork in-flight content`;
      const blobRedo = mkBlob(`fx-journey-memory-edit-redo-${label}`);
      controller.plans.set(q1, [{ frames: [{ content: a1 }, sourcesFrame("fx-src-edit"), donePending, memFrame(blob1)] }]);
      controller.plans.set(q2, [
        { frames: [{ content: a2 }, sourcesFrame("fx-src-edit"), donePending], holdMemoryBlob: blob2 },
      ]);
      controller.plans.set(q2Edited, [
        { frames: [{ content: redoPartial }], holdOnly: true, releaseWith: [donePlain, memFrame(blobRedo)] },
      ]);
      await session.send(q1);
      await session.waitAnswerVisible(a1);
      const chatId = await session.chatIdFromUrl();
      await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, a1), 15_000);

      await session.send(q2);
      await session.waitAnswerVisible(a2);
      await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, a2), 15_000);
      recorder.obs("edit.visible-completion-before-edit", { chatId, turn2: a2 });

      const tEdit = nowIso();
      await session.editLastMessage(q2, q2Edited);
      const redoHeld = await controller.waitHeld(q2Edited, 20_000);
      const redoRequest = redoHeld.records[redoHeld.records.length - 1];
      const gSnapshotRequest = gateResult(
        "gate.editlast.snapshot-replay-request",
        "pass",
        JSON.stringify(redoRequest?.body?.conversation_memory ?? null) === JSON.stringify(blob1),
        { redoConversationMemory: redoRequest?.body?.conversation_memory ?? null, expected: blob1 }
      );
      await session.page.waitForFunction((t: string) => document.body.innerText.includes(t), redoPartial, { timeout: 90_000 });
      await recorder.screenshot(session.page, "edit-redo-inflight");

      controller.release(q2, [memFrame(blob2)]);
      await session.waitForPatch((p) => p.chatId === chatId && JSON.stringify(p.body?.memory ?? {}) === JSON.stringify(blob2), 5_000)
        .then((seen) => recorder.obs("edit.late-callback-patch-with-superseded-blob", { seen }));
      await new Promise((r) => setTimeout(r, 3_000));
      const patchesSince = session.recorder.patches.filter((p) => p.t >= tEdit && p.chatId === chatId);
      const durable = await session.durable(ctx, chatId);
      recorder.obs("edit.durable-after-late-release", { durable });
      await recorder.screenshot(session.page, "edit-after-late-release");

      const gSnapshotDurable = gateDurableMemoryIs("gate.editlast.snapshot-memory-durable", blob1, durable, "reject");
      const gNoInflight = gateNoInflightPersisted("gate.editlast.no-inflight-turn-persisted", redoPartial, patchesSince, durable);

      const cleanupRelease = controller.release(q2Edited, [donePlain, memFrame(blobRedo)]);
      const settled = await session.waitForPatch((p) => p.chatId === chatId && bodyHas(p, redoPartial), 20_000);
      recorder.obs("edit.cleanup-settled-redo", { cleanupRelease, settled });
      await recorder.screenshot(session.page, "edit-after-settle");
      return [
        gSnapshotRequest,
        gSnapshotDurable,
        gNoInflight,
        gateResult("gate.editlast.redo-still-settles", "pass", settled, { settled }),
      ];
    });
    emitCase(ctx, mode, "editlast.defect-reproduced", cB2);

    // =====================================================================
    // Case C: done -> sidebar chat switch -> old late memory of the
    // originating chat must stay turn/session-bound
    // =====================================================================
    const cC = await runCase("chat-switch-isolation", recorder, async () => {
      await session.newChatViaSidebar();
      const qA = `switch-q-origin-${label}`;
      const aA = `Switch origin answer for ${label}.`;
      const blobA = mkBlob(`fx-journey-memory-switch-origin-${label}`);
      const qB = `switch-q-other-${label}`;
      const aB = `Switch other answer for ${label}.`;
      const blobB = mkBlob(`fx-journey-memory-switch-other-${label}`);
      controller.plans.set(qA, [
        { frames: [{ content: aA }, sourcesFrame("fx-src-switch"), donePending], holdMemoryBlob: blobA },
      ]);
      controller.plans.set(qB, [{ frames: [{ content: aB }, sourcesFrame("fx-src-switch"), donePending, memFrame(blobB)] }]);
      await session.send(qA);
      await session.waitAnswerVisible(aA);
      const chatA = await session.chatIdFromUrl();
      await session.waitForPatch((p) => p.chatId === chatA && bodyHas(p, aA), 15_000);
      recorder.obs("switch.origin-visible-complete-before-release", { chatA, answer: aA });
      await recorder.screenshot(session.page, "switch-origin-complete");

      await session.newChatViaSidebar();
      await session.send(qB);
      await session.waitAnswerVisible(aB);
      const chatB = await session.chatIdFromUrl();
      await session.waitForPatch((p) => p.chatId === chatB && bodyHas(p, aB), 15_000);
      const durableBBefore = await session.durable(ctx, chatB);
      recorder.obs("switch.other-chat-settled", { chatB, durable: durableBBefore });
      await recorder.screenshot(session.page, "switch-other-chat-active");

      const tRelease = nowIso();
      controller.release(qA, [memFrame(blobA)]);
      await new Promise((r) => setTimeout(r, 3_000));
      const patchesSinceA = session.recorder.patches.filter((p) => p.t >= tRelease && p.chatId === chatA);
      const durableA = await session.durable(ctx, chatA);
      const durableB = await session.durableSettled(
        ctx,
        chatB,
        (d) => (d.http.body?.messages?.length ?? 0) === 2 && (d.sqlite.messages?.length ?? 0) === 2
      );
      recorder.obs("switch.durable-after-release", { chatA: durableA, chatB: durableB, patchesToOrigin: patchesSinceA.length });
      await recorder.screenshot(session.page, "switch-after-late-release");

      // The late callback belongs to its originating turn/session: it must not
      // issue a persistence request for the originating chat carrying another
      // chat's message list. Captured at request level (passive PATCH
      // observation). On the broken baseline this fires and the route then
      // rejects it with 500 UNIQUE(chat_messages.id) — an incidental guard,
      // not session binding.
      const contaminatedPatch = patchesSinceA.find((p) => bodyHas(p, aB));
      const gCallbackSessionBound = gateResult("gate.switch.callback-session-bound", "reject", !contaminatedPatch, {
        contaminatedPatchSent: !!contaminatedPatch,
        patchCount: patchesSinceA.length,
      });

      // The originating chat's completed-turn late memory must survive a chat
      // switch (the onMemoryUpdate persistence obligation). On the broken
      // baseline the contaminated PATCH 500s and takes the blob down with it.
      const originMemoryLost =
        durableA.http.body?.memory == null && durableA.sqlite.session?.memory == null;
      const gOriginLateMemory = gateResult("gate.switch.origin-late-memory-not-lost", "reject",
        !originMemoryLost && JSON.stringify(durableA.http.body?.memory) === JSON.stringify(blobA) &&
          durableA.sqlite.session?.memory === JSON.stringify(blobA), {
        httpMemory: durableA.http.body?.memory ?? null,
        sqliteMemory: durableA.sqlite.session?.memory ?? null,
      });

      // Durable origin history must stay intact after switch + late release.
      // NOTE (baseline honesty): on the broken page this holds only because
      // the contaminated PATCH above is rejected by the incidental global
      // chat_messages.id UNIQUE constraint — recorded as such.
      const originIntact =
        (durableA.http.body?.messages?.length ?? 0) === 2 &&
        JSON.stringify(durableA.http.body?.messages ?? []).includes(aA) &&
        (durableA.sqlite.messages?.length ?? 0) === 2 &&
        JSON.stringify(durableA.sqlite.messages ?? []).includes(aA);
      const gOriginIntact = gateResult("gate.switch.origin-chat-history-intact", "pass", originIntact, {
        httpMessages: durableA.http.body?.messages?.map((m: any) => m.content) ?? null,
        sqliteMessages: durableA.sqlite.messages?.map((m: any) => m.content) ?? null,
        note: "baseline passes this via the incidental 500 (UNIQUE chat_messages.id), not via session-bound orchestration",
      });
      const otherIntact =
        JSON.stringify(durableB.http.body?.messages ?? []).includes(aB) &&
        (durableB.http.body?.messages?.length ?? 0) === 2 &&
        JSON.stringify(durableB.http.body?.memory ?? null) === JSON.stringify(blobB);
      const gOtherUntouched = gateResult("gate.switch.other-chat-untouched", "pass", otherIntact, {
        httpMessages: durableB.http.body?.messages?.map((m: any) => m.content) ?? null,
        memory: durableB.http.body?.memory ?? null,
      });

      await session.page.reload({ waitUntil: "domcontentloaded" });
      await session.waitAnswerVisible(aB);
      await session.switchToChatByTitle(qA, aA);
      const reloadShowsOrigin = await session.page.evaluate((t: string) => document.body.innerText.includes(t), aA);
      const reloadShowsForeign = await session.page.evaluate((t: string) => document.body.innerText.includes(t), aB);
      recorder.obs("switch.reload-origin-ui", { reloadShowsOrigin, reloadShowsForeign });
      await recorder.screenshot(session.page, "switch-origin-reloaded");
      return [
        gCallbackSessionBound,
        gOriginLateMemory,
        gOriginIntact,
        gOtherUntouched,
      ];
    });
    emitCase(ctx, mode, "switch.defect-reproduced", cC);

    // --- Controller hygiene: every planned ask was matched and released ---
    ctx.check("browser.upstream.no-unmatched-asks", controller.unmatched.length === 0, { unmatched: controller.unmatched });
    ctx.check("browser.upstream.all-released", controller.held.length === 0, { stillHeld: controller.held.map((h) => h.question) });
    ctx.check("browser.no-page-errors", session.pageErrors.length === 0, { errors: session.pageErrors });
    ctx.check("browser.isolation.no-blocked-browser-requests", session.blocked.length === 0, {
      blocked: session.blocked,
      note: "Playwright route allowlist (loopback app origin only); interception is not OS-level egress confinement",
    });

    await session.close();
    recorder.obs("final.mode", {
      mode,
      note: mode === "baseline"
        ? "defect-reproduction rows record frozen gates rejecting the broken baseline at their intended assertions; the underlying product obligations remain FAILED"
        : "gate rows record direct intended-behavior verdicts",
    });
    writeFileSync(join(recorder.dir, "browser-observations.json"), JSON.stringify(recorder.observations, null, 2));
    recorder.track(join(recorder.dir, "browser-observations.json"));
    recorder.writeDigests();
    return;
  } catch (err) {
    recorder.obs("scenario-error", { error: String((err as Error).stack ?? err) });
    writeFileSync(join(recorder.dir, "browser-observations.json"), JSON.stringify(recorder.observations, null, 2));
    try {
      recorder.writeDigests();
    } catch {}
    try {
      await session.close();
    } catch {}
    throw err;
  }
}

// Emit one check row per case. Baseline: the row is "defect reproduced at the
// frozen gates" — ok only when every reject-gate rejected at its own assertion
// and every in-case pass-gate held. Candidate: gates are judged directly.
function emitCase(ctx: any, mode: BrowserMode, id: string, result: CaseResult) {
  if (result.preconditionError) {
    ctx.check(id, false, {
      case: result.name,
      reason: "case execution failed before gate evaluation (inconclusive, not a reproduction)",
      error: result.preconditionError,
    });
    return;
  }
  if (mode === "candidate") {
    for (const g of result.gates) {
      ctx.check(`${id}.gate.${g.gate}`, g.passed, { intended: g.intended, observed: g.observed });
    }
    return;
  }
  const rejectedAt = result.gates.filter((g) => g.intended === "reject" && g.rejected).map((g) => g.gate);
  const notRejected = result.gates.filter((g) => g.intended === "reject" && !g.rejected).map((g) => g.gate);
  const passGates = result.gates.filter((g) => g.intended === "pass").map((g) => ({ gate: g.gate, passed: g.passed }));
  ctx.check(id, result.allRejects && result.allPasses, {
    case: result.name,
    defectConfirmed: result.allRejects,
    rejectedAt,
    notRejected,
    passGates,
    gates: result.gates,
    note: "baseline: ok means the frozen positive gates rejected the retained broken page at the intended assertions; the underlying product obligations remain FAILED",
  });
}
