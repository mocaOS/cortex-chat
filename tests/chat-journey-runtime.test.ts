// Tests for scripts/chat-journey-runtime.mjs — the reusable bounded real Next
// request-context runtime for ask-route and memory journey checks.
//
// The FULL journey (real `next dev` boot + HTTP scenarios against the seeded
// and augmented fixture) is far too heavy for the deterministic contract
// suite and is owned by the lead's runner (scripts/chat-journey-checks.ts via
// withChatRuntime). What belongs in the suite is the harness's own contract,
// judged where it is cheap:
//
// 1. Module surface: importing the library has no side effects and exports
//    the agreed API.
// 2. Env allowlist controls: the app env is an exact allowlist (no ambient
//    secrets can leak through, SENTRY/telemetry off, DATABASE_PATH inside the
//    scratch data dir, scratch HOME/TMPDIR, tripwire injected, loopback-only
//    CORTEX_API_URL enforced).
// 3. Upstream path classification and manifest drift comparator (pure
//    helpers): allowlist endpoints expected, foreign paths unexpected;
//    changed/added/removed entries detected.
// 4. Pre-boot usage refusals: invalid runChecks/options are refused BEFORE
//    any scratch directory is created.
// 5. Prepare-probe run (stopAfter: "augment" — seed + augment + upstream, NO
//    app boot): the seeded fixture is actually augmented as declared
//    (foreign user in a separate group with its own encrypted read key,
//    group-less user, synthetic expired session, Unicode owner username),
//    judged through independent read-only DB reads and the real decrypt
//    round-trip; the default upstream handlers respond (JSON ask + SSE
//    stream), a held handler is releasable, and release accounting is
//    fail-closed; request() refuses anything but same-origin loopback paths;
//    a healthy run cleans scratch ONLY after the receipt is retained under
//    outputDir; provenance (git revision, lockfile digest, native smoke,
//    zero tripwire attempts, zero drift) is present in the result.
// 6. Failure controls: an unexpected upstream path and a failed check fail
//    the run and RETAIN the scratch (results.json written before cleanup).
//    The full dev-server boot is deliberately NOT exercised here.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { decryptSecret } from "@/lib/auth/crypto";
// Importing the runtime module must not execute any run (library, no CLI).
import {
  withChatRuntime,
  buildAppEnv,
  hashTree,
  compareManifests,
  classifyUpstreamPath,
  readTripwireLog,
  EXPECTED_UPSTREAM_PREFIXES,
  DEFAULT_SSE_FRAMES,
  DEFAULT_ASK_JSON,
  AUGMENT_IDS,
  UNICODE_OWNER_USERNAME,
} from "../scripts/chat-journey-runtime.mjs";

const require2 = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const Database = require2("better-sqlite3");
const APP_ENCRYPTION_KEY = Buffer.alloc(32);
Buffer.from("synthetic-restore-fixture-key", "utf8").copy(APP_ENCRYPTION_KEY);
const APP_ENCRYPTION_KEY_B64 = APP_ENCRYPTION_KEY.toString("base64");
const REAL_AMBIENT_KEY = process.env.APP_ENCRYPTION_KEY;

function gitHead() {
  const res = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", timeout: 15_000 });
  assert.equal(res.status, 0);
  return res.stdout.trim();
}

function realNodeModulesPath(): string {
  return realpathSync(join(repoRoot, "node_modules"));
}

function openFixtureReadonly(dataDir: string) {
  const dbPath = join(dataDir, "cortex-chat.db");
  const sidecars = ["-wal", "-shm"].filter((s) => existsSync(dbPath + s));
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  return {
    sqlite,
    close: () => {
      try { sqlite.close(); } catch {}
      // A read-only open transiently creates empty sidecars on a WAL-mode
      // DB; only those are removed so the file set is left as found.
      for (const s of ["-wal", "-shm"]) {
        if (!sidecars.includes(s)) {
          try { rmSync(dbPath + s, { force: true }); } catch {}
        }
      }
    },
  };
}

async function readSseText(res: Response, opts: { untilHeld?: boolean } = {}) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (opts.untilHeld && text.includes("data: held")) break;
  }
  return { text, reader };
}

describe("chat-journey-runtime — module surface (no side effects on import)", () => {
  it("exports the agreed API surface and no run starts on import", () => {
    assert.equal(typeof withChatRuntime, "function");
    assert.equal(typeof buildAppEnv, "function");
    assert.equal(typeof hashTree, "function");
    assert.equal(typeof compareManifests, "function");
    assert.equal(typeof classifyUpstreamPath, "function");
    assert.ok(Array.isArray(EXPECTED_UPSTREAM_PREFIXES));
    assert.ok(EXPECTED_UPSTREAM_PREFIXES.includes("/api/ask"));
    assert.ok(Array.isArray(DEFAULT_SSE_FRAMES));
    // Backend-v2 semantics the late-memory oracle depends on: done carries
    // pending_memory and is NOT the last frame — memory_update follows.
    const doneFrame = DEFAULT_SSE_FRAMES.find((f: any) => f.done === true);
    assert.ok(doneFrame, "default SSE must carry a done frame");
    assert.equal(doneFrame.pending_memory, true);
    assert.ok(
      DEFAULT_SSE_FRAMES.findIndex((f: any) => f.memory_update !== undefined) >
        DEFAULT_SSE_FRAMES.findIndex((f: any) => f.done === true),
      "memory_update must follow done (keep reading past done)"
    );
    assert.equal(typeof DEFAULT_ASK_JSON, "object");
    assert.match(UNICODE_OWNER_USERNAME, /[^\x00-\x7F]/, "unicode identity control must be non-ASCII");
    assert.match(AUGMENT_IDS.foreignUser, /^fx-journey-/);
  });
});

describe("chat-journey-runtime — app env allowlist controls", () => {
  it("is an exact allowlist: no ambient secrets, sentry/telemetry off, scratch-scoped paths", () => {
    const prevKey = process.env.APP_ENCRYPTION_KEY;
    const prevSuper = process.env.SUPERADMIN_PASSWORD;
    process.env.APP_ENCRYPTION_KEY = "ambient-secret-must-not-leak";
    process.env.SUPERADMIN_PASSWORD = "ambient-superadmin-must-not-leak";
    try {
      const env: Record<string, string | undefined> = buildAppEnv({
        dataDir: "/scratch/data",
        backendUrl: "http://127.0.0.1:9000",
        workDir: "/scratch",
        tripwirePath: "/scratch/tripwire.cjs",
      });
      const expectedKeys = [
        "PATH", "DATABASE_PATH", "APP_ENCRYPTION_KEY", "BACKEND_ADMIN_API_KEY",
        "SUPERADMIN_EMAIL", "SUPERADMIN_PASSWORD", "CORTEX_API_URL",
        "SENTRY_DISABLED", "NEXT_PUBLIC_SENTRY_DISABLED", "NEXT_TELEMETRY_DISABLED",
        "HOME", "TMPDIR", "NODE_OPTIONS", "TRIPWIRE_LOG",
      ].sort();
      assert.deepEqual(Object.keys(env).sort(), expectedKeys, "env must be an exact allowlist");
      // Ambient secrets cannot leak: synthetic fixture constants only.
      assert.equal(env.APP_ENCRYPTION_KEY, APP_ENCRYPTION_KEY_B64);
      assert.notEqual(env.APP_ENCRYPTION_KEY, "ambient-secret-must-not-leak");
      assert.notEqual(env.SUPERADMIN_PASSWORD, "ambient-superadmin-must-not-leak");
      assert.match(String(env.SUPERADMIN_EMAIL), /@example\.invalid$/);
      assert.equal(env.SENTRY_DISABLED, "1");
      assert.equal(env.NEXT_PUBLIC_SENTRY_DISABLED, "1");
      assert.equal(env.NEXT_TELEMETRY_DISABLED, "1");
      assert.equal(env.DATABASE_PATH, "/scratch/data/cortex-chat.db");
      assert.equal(env.HOME, "/scratch/home");
      assert.equal(env.TMPDIR, "/scratch/tmp");
      assert.match(String(env.NODE_OPTIONS), /^--require \/scratch\/tripwire\.cjs$/);
      assert.equal(env.CORTEX_API_URL, "http://127.0.0.1:9000");
      // No feature-gate service env can be inherited (SMTP/OIDC/DEMO/VOICE).
      for (const key of Object.keys(env)) {
        assert.doesNotMatch(key, /^(SMTP_|OIDC_|DEMO_|VOICE_|SENTRY_DSN|SENTRY_AUTH)/);
      }
    } finally {
      if (prevKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
      else process.env.APP_ENCRYPTION_KEY = prevKey;
      if (prevSuper === undefined) delete process.env.SUPERADMIN_PASSWORD;
      else process.env.SUPERADMIN_PASSWORD = prevSuper;
    }
  });

  it("refuses a non-loopback CORTEX_API_URL outright (no live-instance ambiguity)", () => {
    assert.throws(
      () => buildAppEnv({ dataDir: "/s/data", backendUrl: "http://10.1.2.3:8000", workDir: "/s", tripwirePath: "/s/t.cjs" }),
      /loopback/
    );
  });
});

describe("chat-journey-runtime — pure helpers", () => {
  it("classifies the proxy allowlist endpoints as expected and foreign paths as unexpected", () => {
    for (const path of ["/api/ask", "/api/ask/stream", "/api/collections", "/api/features", "/api/tasks/t1", "/api/documents/d1/content"]) {
      assert.equal(classifyUpstreamPath(path).expected, true, path);
    }
    for (const path of ["/api/unknown", "/admin", "/etc/passwd", "/api/tasks-malformed"]) {
      assert.equal(classifyUpstreamPath(path).expected, false, path);
    }
    assert.equal(classifyUpstreamPath("/api/ask?x=1").expected, true);
  });

  it("detects changed, added and removed entries between manifests", () => {
    const start = { "a.ts": "1", "b.ts": "2", "c.ts": "3" };
    const end = { "a.ts": "1", "b.ts": "2x", "d.ts": "4" };
    const drift = compareManifests(start, end);
    assert.deepEqual(drift, [
      { path: "b.ts", kind: "changed" },
      { path: "c.ts", kind: "removed" },
      { path: "d.ts", kind: "added" },
    ]);
    assert.deepEqual(compareManifests(start, start), []);
  });

  it("hashTree records files and symlinks without following symlinks", () => {
    const base = mkdtempSync(join(tmpdir(), "chat-journey-hashtree-"));
    try {
      writeFileSync(join(base, "a.txt"), "alpha");
      mkdirSync(join(base, "sub"));
      writeFileSync(join(base, "sub", "b.txt"), "beta");
      const tree = hashTree(base, { skip: new Set() });
      const files = tree.files as Record<string, string>;
      assert.equal(files["a.txt"], createHash("sha256").update("alpha").digest("hex"));
      assert.equal(files["sub/b.txt"], createHash("sha256").update("beta").digest("hex"));
      assert.deepEqual(tree.symlinks, {});
      const startTree = hashTree(base, { skip: new Set() }).files;
      assert.deepEqual(compareManifests(startTree, hashTree(base, { skip: new Set() }).files), []);
      writeFileSync(join(base, "a.txt"), "mutated");
      const drift = compareManifests(startTree, hashTree(base, { skip: new Set() }).files);
      assert.deepEqual(drift, [{ path: "a.txt", kind: "changed" }]);
    } finally {
      try { rmSync(base, { recursive: true, force: true }); } catch {}
    }
  });
});

describe("chat-journey-runtime — pre-boot usage refusals (no scratch created)", () => {
  let base: string;
  before(() => {
    base = mkdtempSync(join(tmpdir(), "chat-journey-refusal-"));
  });
  after(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch {}
  });

  function refuseWorkDir() {
    const dir = join(base, `refusal-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir);
    return dir;
  }

  it("refuses a non-function runChecks", async () => {
    const dir = refuseWorkDir();
    await assert.rejects(() => withChatRuntime(null as any, { workDir: dir }), /runChecks must be a function/);
    assert.equal(readdirSync(dir).length, 0);
  });

  it("refuses unknown options and invalid stopAfter/expectedUpstreamPaths", async () => {
    const dir = refuseWorkDir();
    await assert.rejects(() => withChatRuntime(async () => {}, { workDir: dir, nonsense: 1 } as any), /unknown option/);
    await assert.rejects(() => withChatRuntime(async () => {}, { workDir: dir, stopAfter: "boot" } as any), /stopAfter/);
    await assert.rejects(
      () => withChatRuntime(async () => {}, { workDir: dir, expectedUpstreamPaths: ["not-a-path"] } as any),
      /expectedUpstreamPaths/
    );
    assert.equal(readdirSync(dir).length, 0);
  });

  it("refuses a non-empty workDir (existing evidence is never overwritten)", async () => {
    const dir = refuseWorkDir();
    writeFileSync(join(dir, "evidence.txt"), "keep");
    await assert.rejects(() => withChatRuntime(async () => {}, { workDir: dir }), /must be empty or non-existent/);
    assert.equal(readdirSync(dir).length, 1, "the existing evidence must be untouched");
  });

  it("refuses missing/relative scenarioInputs", async () => {
    const dir = refuseWorkDir();
    await assert.rejects(
      () => withChatRuntime(async () => {}, { workDir: dir, scenarioInputs: ["relative/path.ts"] }),
      /absolute/
    );
    await assert.rejects(
      () => withChatRuntime(async () => {}, { workDir: dir, scenarioInputs: [join(base, "does-not-exist.ts")] }),
      /does not exist/
    );
    assert.equal(readdirSync(dir).length, 0);
  });
});

describe("chat-journey-runtime — prepare-probe run (stopAfter: augment, no app boot)", () => {
  const ownerUsername = UNICODE_OWNER_USERNAME;
  let base: string;
  let outputDir: string;
  let workDir: string;
  let healthy: any;

  before(async () => {
    base = mkdtempSync(join(tmpdir(), "chat-journey-probe-"));
    outputDir = join(base, "receipts");
    workDir = join(base, "work");
    mkdirSync(workDir);
    process.env.APP_ENCRYPTION_KEY = APP_ENCRYPTION_KEY_B64;
    healthy = await withChatRuntime(async (ctx: any) => {
      // users contract (superadmin is bootstrapped from env at boot — it has
      // no fixture row, so no id at augment time)
      const usersOk = (() => {
        for (const name of ["owner", "member", "foreign", "noGroup"]) {
          const u = ctx.users[name];
          if (!u || typeof u.id !== "string" || typeof u.email !== "string" || typeof u.password !== "string") return false;
        }
        const superadmin = ctx.users.superadmin;
        return typeof superadmin?.email === "string" && typeof superadmin?.password === "string" &&
          ctx.users.owner.id === "fx-user-0001" &&
          ctx.users.member.id === "fx-user-0002" &&
          ctx.users.foreign.email === AUGMENT_IDS.foreignEmail &&
          ctx.users.noGroup.email === AUGMENT_IDS.noGroupEmail;
      })();
      ctx.check("users-shape", usersOk, ctx.users);

      // request() egress refusal (parent scenario is loopback/same-origin only)
      let refusedAbsolute = false;
      try { await ctx.request("http://10.9.9.9/steal", {}); } catch { refusedAbsolute = true; }
      ctx.check("request-refuses-absolute-url", refusedAbsolute);
      let refusedScheme = false;
      try { await ctx.request("//evil.example.invalid/x", {}); } catch { refusedScheme = true; }
      ctx.check("request-refuses-scheme-relative-path", refusedScheme);
      let refusedUnbooted = false;
      try { await ctx.request("/api/config", {}); } catch (err: any) { refusedAbsolute = false; refusedUnbooted = /not booted/.test(String(err?.message)); }
      ctx.check("request-refuses-when-not-booted", refusedUnbooted);

      // Augmentation judged independently: read-only DB + real crypto.
      const { sqlite, close } = openFixtureReadonly(ctx.dataDir);
      try {
        const foreign = sqlite.prepare("SELECT group_id, email FROM users WHERE id = ?").get(AUGMENT_IDS.foreignUser);
        ctx.check("foreign-user-in-foreign-group", foreign && foreign.group_id === AUGMENT_IDS.foreignGroup && foreign.email === AUGMENT_IDS.foreignEmail, foreign);
        const noGroup = sqlite.prepare("SELECT group_id FROM users WHERE id = ?").get(AUGMENT_IDS.noGroupUser);
        ctx.check("no-group-user-has-null-group", noGroup && noGroup.group_id === null, noGroup);
        const group = sqlite.prepare("SELECT chat_key_id FROM groups WHERE id = ?").get(AUGMENT_IDS.foreignGroup);
        ctx.check("foreign-group-owns-its-own-read-key", group && group.chat_key_id === AUGMENT_IDS.foreignReadKey, group);
        const foreignKeyRow = sqlite.prepare("SELECT encrypted_value FROM api_keys WHERE id = ?").get(AUGMENT_IDS.foreignReadKey);
        ctx.check(
          "foreign-read-key-decrypts-real-envelope",
          foreignKeyRow && decryptSecret(foreignKeyRow.encrypted_value) === AUGMENT_IDS.foreignReadKeyPlaintext,
        );
        const expired = sqlite.prepare("SELECT expires_at, user_id FROM sessions WHERE token = ?").get(AUGMENT_IDS.expiredToken);
        ctx.check("expired-session-token-is-past", expired && expired.user_id === "fx-user-0001" && Number(expired.expires_at) < Date.now(), expired);
        const unicode = sqlite.prepare("SELECT username FROM users WHERE id = 'fx-user-0001'").get();
        ctx.check("unicode-owner-username-round-trips", unicode && unicode.username === ownerUsername, unicode);
        const fixtureUser2 = sqlite.prepare("SELECT username, email FROM users WHERE id = 'fx-user-0002'").get();
        ctx.check("fixture-member-row-untouched", fixtureUser2 && fixtureUser2.email === "fixture-user-0002@example.invalid", fixtureUser2);
      } finally {
        close();
      }

      // Upstream default handlers (loopback parent fetches).
      const ask = await fetch(`${ctx.upstream.url}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-ID": "probe-ask-1" },
        body: JSON.stringify({ question: "q", conversation_history: [] }),
        signal: AbortSignal.timeout(10_000),
      });
      const askJson = await ask.json();
      ctx.check("upstream-default-ask-json", ask.status === 200 && askJson.answer === DEFAULT_ASK_JSON.answer, askJson);

      const stream = await fetch(`${ctx.upstream.url}/api/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "q", conversation_history: [] }),
        signal: AbortSignal.timeout(10_000),
      });
      const sseText = await stream.text();
      ctx.check(
        "upstream-default-sse-frames",
        sseText.includes(`data: ${JSON.stringify(DEFAULT_SSE_FRAMES[2])}`) &&
          sseText.indexOf("memory_update") > sseText.indexOf('"done":true'),
        sseText.slice(0, 400),
      );

      // Held handler + release flow. The synthetic hold path must be declared
      // expected first (setExpectedPaths is the documented scenario API);
      // off-allowlist paths are a failure by design.
      ctx.upstream.setExpectedPaths([...EXPECTED_UPSTREAM_PREFIXES, "/api/hold"]);
      ctx.check("upstream-expected-paths-extendable", ctx.upstream.expectedPaths.includes("/api/hold"));
      ctx.upstream.setHandler((req: any, res: any, record: any) => {
        if (record.path === "/api/hold") {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write("data: held\n\n");
          return; // not ended -> runtime registers it as pending
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      const held = await fetch(`${ctx.upstream.url}/api/hold`, { method: "POST", body: "{}", signal: AbortSignal.timeout(10_000) });
      const { text: heldText, reader } = await readSseText(held, { untilHeld: true });
      ctx.check("upstream-handler-holds-response", heldText.includes("data: held"));
      const pendingIds = [...ctx.upstream.pending.keys()];
      ctx.check("upstream-pending-registered", pendingIds.length === 1, pendingIds);
      assert.throws(() => ctx.upstream.release("no-such-id", []), /no pending upstream response/);
      ctx.upstream.release(pendingIds[0], [{ done: true }]);
      ctx.check("upstream-release-ends-response", ctx.upstream.pending.size === 0);
      const tail = await reader.read();
      ctx.check("upstream-release-delivered-frames", tail.done || new TextDecoder().decode(tail.value ?? new Uint8Array()).includes('"done":true'));
      // Restore the default behavior and the default expected paths for the
      // rest of the run.
      ctx.upstream.setExpectedPaths(EXPECTED_UPSTREAM_PREFIXES);
      ctx.upstream.setHandler((_req: any, res: any, record: any) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, path: record.path }));
      });
      const afterRelease = await fetch(`${ctx.upstream.url}/api/ask`, { method: "POST", body: "{}", signal: AbortSignal.timeout(10_000) });
      ctx.check("upstream-handler-can-be-replaced", afterRelease.status === 200);

      // Checks may also be returned as an array (merged with ctx.check calls).
      return [{ id: "returned-check-array-merged", ok: true, detail: "scenario return value" }];
    }, {
      label: "probe-healthy",
      workDir,
      outputDir,
      stopAfter: "augment",
      scenarioInputs: [join(repoRoot, "scripts", "chat-journey-runtime.mjs")],
    });
  });

  after(() => {
    if (REAL_AMBIENT_KEY === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = REAL_AMBIENT_KEY;
    try { rmSync(base, { recursive: true, force: true }); } catch {}
  });

  it("passes and the returned check array merges with ctx.check entries", () => {
    assert.equal(healthy.ok, true, JSON.stringify(healthy.errors ?? []));
    const ids = healthy.checks.map((c: any) => c.id);
    assert.ok(ids.includes("users-shape"));
    assert.ok(ids.includes("returned-check-array-merged"));
    assert.ok(healthy.checks.every((c: any) => c.ok === true), healthy.checks.filter((c: any) => !c.ok).map((c: any) => c.id).join(","));
  });

  it("declares dev-only evidence and records environment provenance", () => {
    assert.match(String(healthy.environment.evidenceLabel), /next dev/);
    assert.match(String(healthy.environment.evidenceLabel), /NOT a production build/i);
    assert.ok(healthy.evidence.claimsNotSupported.some((c: string) => /production build/i.test(c)));
    assert.equal(healthy.environment.nativeSmoke.ok, true);
    assert.match(String(healthy.environment.nativeSmoke.detail), /:memory:/, "smoke must instantiate a real database, not merely require the module");
    assert.equal(healthy.environment.dependencyVersions.next !== null, true);
    assert.equal(healthy.environment.sentryDisabled, true);
    assert.equal(healthy.environment.telemetryDisabled, true);
    assert.match(String(healthy.environment.scratchBaseSource), /TMPDIR|os\.tmpdir/);
    assert.match(String(healthy.environment.appRunner), /next dev \(Turbopack default/, "default supported dev runner must be recorded");
    assert.match(String(healthy.environment.appRunner), /private verbatim copy/, "the private-copy mode must be recorded");
    assert.match(String(healthy.environment.nodeModulesMode), /private verbatim copy/);
    assert.match(String(healthy.environment.nodeModulesMode), /no npm install/);
    assert.match(String(healthy.environment.nodeModulesMode), /never mounted/);
    assert.equal(healthy.isolation.nodeModulesSource.mode, "copied");
    assert.equal(healthy.isolation.nodeModulesSource.from, realNodeModulesPath(), "the copy source is the repository's installed graph");
    assert.ok(healthy.isolation.nodeModulesSource.copyMs >= 0);
    assert.notEqual(healthy.environment.dependencyVersions.next, null, "versions are read from the private copy");
    assert.equal(healthy.seed.env.tmpdir, join(workDir, "tmp"), "seed child must use the owned scratch TMPDIR");
    assert.equal(healthy.seed.env.home, join(workDir, "home"));
  });

  it("records provenance: git revision, lockfile digest, frozen inputs, zero drift", () => {
    assert.equal(healthy.isolation.git.head, gitHead());
    assert.equal(
      healthy.isolation.lockfileSha256 ?? healthy.environment.lockfileSha256,
      createHash("sha256").update(readFileSync(join(repoRoot, "package-lock.json"))).digest("hex"),
    );
    assert.ok(Object.keys(healthy.isolation.acceptedUncommittedInputs).includes("scripts/restore-fixture.mjs"));
    assert.ok(healthy.isolation.scenarioInputs[join(repoRoot, "scripts", "chat-journey-runtime.mjs")]);
    assert.ok(healthy.isolation.sourceTreeSha256.length === 64);
    assert.deepEqual(healthy.isolation.drift, []);
    assert.equal(healthy.isolation.networkTripwire.logOk, true, "tripwire log present and parseable");
    assert.equal(healthy.isolation.networkTripwire.problem, null);
    assert.deepEqual(healthy.isolation.networkTripwire.attempts, []);
    assert.equal(
      healthy.isolation.nodeModulesLockSha256,
      healthy.isolation.manifestEnd?.nodeModulesLockSha256,
      "installed .package-lock.json digest must be identical at start and end",
    );
    assert.equal(
      healthy.isolation.nodeModulesLockSha256,
      createHash("sha256").update(readFileSync(join(repoRoot, "node_modules", ".package-lock.json"))).digest("hex"),
      "the copied installed graph is byte-identical to the repository's (same .package-lock.json)",
    );
    assert.equal(healthy.upstream.unexpected.length, 0);
    assert.equal(healthy.upstream.pendingReleased, true);
    assert.equal(healthy.augmentation.ok, true);
    assert.ok(healthy.augmentation.declaredWrites.some((w: string) => w.includes(AUGMENT_IDS.foreignUser)));
    assert.ok(healthy.augmentation.declaredWrites.some((w: string) => w.includes("unicode")));
  });

  it("removes scratch ONLY after the receipt is retained under outputDir", () => {
    assert.equal(healthy.ok, true);
    assert.equal(healthy.cleanup.scratchRemoved, true, "healthy run must remove scratch after retention");
    assert.equal(existsSync(workDir), false, "work dir removed after retention");
    assert.ok(healthy.cleanup.artifactsCopiedTo, "receipt dir reported");
    const receiptDir = healthy.cleanup.artifactsCopiedTo as string;
    const retained = JSON.parse(readFileSync(join(receiptDir, "results.json"), "utf8"));
    assert.equal(retained.ok, true);
    // The retained receipt carries the FINAL verdict: cleanup status assigned,
    // removal recorded, no late errors swallowed.
    assert.notEqual(retained.cleanup, null);
    assert.equal(retained.cleanup.status, "ok");
    assert.equal(retained.cleanup.scratchRemoved, true);
    assert.deepEqual(retained.errors, []);
    assert.ok(existsSync(join(receiptDir, "chat-journey-augment-child.mjs")), "augment child retained as provenance");
    assert.ok(existsSync(join(receiptDir, "chat-journey-network-tripwire.cjs")), "tripwire script retained");
    assert.ok(existsSync(join(receiptDir, "network-tripwire.jsonl")), "tripwire log retained (empty = clean)");
  });
});

describe("chat-journey-runtime — failure controls retain evidence (no outputDir)", () => {
  let base: string;
  let workDir: string;
  let failing: any;

  before(async () => {
    base = mkdtempSync(join(tmpdir(), "chat-journey-fail-"));
    workDir = join(base, "work");
    mkdirSync(workDir);
    process.env.APP_ENCRYPTION_KEY = APP_ENCRYPTION_KEY_B64;
    failing = await withChatRuntime(async (ctx: any) => {
      ctx.check("intentional-failure", false, "negative control: the harness must fail a failed check");
      // Strict check schema: truthy non-boolean ok values must NOT pass.
      ctx.check("truthy-string-must-not-pass", "yes" as any, "negative control: ok must be boolean");
      // Duplicate ids must be rejected.
      ctx.check("duplicate-id", true);
      ctx.check("duplicate-id", true, "second call with the same id");
      // Unexpected upstream path: direct loopback probe of an off-allowlist path.
      const res = await fetch(`${ctx.upstream.url}/api/never-allowlisted`, { signal: AbortSignal.timeout(10_000) });
      await res.arrayBuffer();
      // Malformed scenario-returned rows must be recorded as failures, never
      // silently filtered.
      return [
        { id: "valid-returned-row", ok: true, detail: null },
        "oops-not-an-object" as any,
        { id: "missing-ok-row", detail: "ok property absent" } as any,
      ];
    }, { label: "probe-failing", workDir, stopAfter: "augment" });
  });

  after(() => {
    if (REAL_AMBIENT_KEY === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = REAL_AMBIENT_KEY;
    try { rmSync(base, { recursive: true, force: true }); } catch {}
  });

  it("fails on a failed check and an unexpected upstream path", () => {
    assert.equal(failing.ok, false);
    assert.ok(failing.errors.some((e: string) => /unexpected upstream paths/.test(e)));
    assert.ok(failing.upstream.unexpected.some((u: any) => u.path === "/api/never-allowlisted"));
    assert.equal(failing.upstream.pendingReleased, true);
    assert.equal(failing.upstream.handlerMode, "default");
  });

  it("enforces the strict check schema: truthy strings, duplicates and malformed rows are recorded failures", () => {
    assert.ok(failing.errors.some((e: string) => /malformed check "truthy-string-must-not-pass".*ok must be boolean/.test(e)), failing.errors.join("\n"));
    assert.ok(failing.errors.some((e: string) => /duplicate check id "duplicate-id"/.test(e)));
    assert.ok(failing.errors.some((e: string) => /malformed scenario-returned check row/.test(e)));
    assert.ok(failing.errors.some((e: string) => /missing-ok-row.*ok must be boolean/.test(e)));
    const ids = failing.checks.map((c: any) => c.id);
    assert.ok(ids.includes("valid-returned-row"), "well-formed returned rows still merge");
    assert.ok(failing.checks.some((c: any) => c.id === "intentional-failure" && c.ok === false));
    assert.ok(failing.checks.some((c: any) => c.reason === "ok must be boolean (got string)"));
    assert.ok(failing.checks.some((c: any) => c.reason === "duplicate check id"));
    assert.ok(failing.checks.some((c: any) => c.reason === "malformed scenario-returned check row"));
  });

  it("retains the scratch and rewrites the FINAL results.json (cleanup verdict included)", () => {
    assert.equal(failing.cleanup.status, "retained-on-failure");
    assert.equal(failing.cleanup.scratchRemoved, false);
    assert.equal(existsSync(workDir), true);
    const retained = JSON.parse(readFileSync(join(workDir, "logs", "results.json"), "utf8"));
    assert.equal(retained.ok, false);
    // The retained receipt must NOT carry a null cleanup section and must
    // reflect the final retained-on-failure verdict and the cleanup error.
    assert.notEqual(retained.cleanup, null);
    assert.equal(retained.cleanup.status, "retained-on-failure");
    assert.ok(retained.errors.some((e: string) => /cleanup: retained-on-failure/.test(e)));
    assert.ok(retained.checks.some((c: any) => c.id === "intentional-failure" && c.ok === false));
    assert.equal(existsSync(join(workDir, "data", "cortex-chat.db")), true, "seeded+augmented scratch state retained for diagnosis");
  });
});

describe("chat-journey-runtime — tripwire log parser is fail-closed (no false-green)", () => {
  let base: string;
  before(() => {
    base = mkdtempSync(join(tmpdir(), "chat-journey-tripwire-"));
    mkdirSync(join(base, "logs"));
  });
  after(() => {
    try { rmSync(base, { recursive: true, force: true }); } catch {}
  });

  it("fails when the tripwire log is missing (an unobservable tripwire is not a clean run)", () => {
    const verdict = readTripwireLog(base);
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.attempts, []);
    assert.match(String(verdict.problem), /missing/);
  });

  it("passes an existing empty log (zero attempts, observable tripwire)", () => {
    writeFileSync(join(base, "logs", "network-tripwire.jsonl"), "");
    const verdict = readTripwireLog(base);
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.attempts, []);
    assert.equal(verdict.problem, null);
  });

  it("parses recorded attempts", () => {
    const attempt = JSON.stringify({ pid: 1, kind: "connect", host: "10.0.0.1", blocked: true });
    writeFileSync(join(base, "logs", "network-tripwire.jsonl"), attempt + "\n");
    const verdict = readTripwireLog(base);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.attempts.length, 1);
    assert.equal(verdict.attempts[0].host, "10.0.0.1");
  });

  it("fails on a malformed (non-JSON) log line instead of reading it as zero attempts", () => {
    writeFileSync(join(base, "logs", "network-tripwire.jsonl"), "garbage output from some writer\n");
    const verdict = readTripwireLog(base);
    assert.equal(verdict.ok, false);
    assert.match(String(verdict.problem), /malformed/);
    const verdictTruncated = (() => {
      writeFileSync(join(base, "logs", "network-tripwire.jsonl"), '{"pid":1,"kind":"connect"}\n{"trunc');
      return readTripwireLog(base);
    })();
    assert.equal(verdictTruncated.ok, false);
    assert.match(String(verdictTruncated.problem), /malformed/);
  });
});

it("missing run logs cannot become green or remove unretained scratch", async () => {
  const base = mkdtempSync(join(tmpdir(), "chat-journey-missing-logs-"));
  const workDir = join(base, "work");
  try {
    const verdict: any = await withChatRuntime(async (ctx: any) => {
      ctx.check("healthy-before-lost-evidence", true);
      rmSync(join(ctx.workDir, "logs"), { recursive: true });
    }, { stopAfter: "augment", workDir, outputDir: join(base, "evidence"), label: "missing-logs-control" });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.cleanup.scratchRemoved, false);
    assert.ok(verdict.errors.some((e: string) => /logs directory disappeared/.test(e)));
    assert.ok(verdict.errors.some((e: string) => /tripwire.*missing/i.test(e)));
    const retained = JSON.parse(readFileSync(join(verdict.cleanup.artifactsCopiedTo, "results.json"), "utf8"));
    assert.equal(retained.ok, false);
    assert.equal(retained.cleanup.scratchRemoved, false);
    assert.ok(existsSync(workDir));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

describe("chat-journey-runtime — scenario exception still produces complete evidence", () => {
  let base: string;
  let workDir: string;
  let thrown: any;

  before(async () => {
    base = mkdtempSync(join(tmpdir(), "chat-journey-throw-"));
    workDir = join(base, "work");
    mkdirSync(workDir);
    process.env.APP_ENCRYPTION_KEY = APP_ENCRYPTION_KEY_B64;
    thrown = await withChatRuntime(async (ctx: any) => {
      // Upstream traffic happened BEFORE the callback explodes.
      const res = await fetch(`${ctx.upstream.url}/api/ask`, { method: "POST", body: "{}", signal: AbortSignal.timeout(10_000) });
      await res.arrayBuffer();
      ctx.check("recorded-before-throw", true);
      throw new Error("intentional scenario explosion (negative control)");
    }, { label: "probe-throw", workDir, stopAfter: "augment" });
  });

  after(() => {
    if (REAL_AMBIENT_KEY === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = REAL_AMBIENT_KEY;
    try { rmSync(base, { recursive: true, force: true }); } catch {}
  });

  it("fails the run with the callback error recorded", () => {
    assert.equal(thrown.ok, false);
    assert.ok(thrown.errors.some((e: string) => /intentional scenario explosion/.test(e)), thrown.errors.join("\n"));
    assert.ok(thrown.checks.some((c: any) => c.id === "recorded-before-throw" && c.ok === true));
  });

  it("still collects the evidence a thrown callback would otherwise skip", () => {
    assert.ok(thrown.isolation.manifestStart, "frozen start manifest must be in the result");
    assert.ok(thrown.isolation.manifestEnd, "end manifest must be collected despite the throw");
    assert.deepEqual(thrown.isolation.drift, []);
    assert.ok(Array.isArray(thrown.isolation.networkTripwire.attempts));
    assert.equal(thrown.isolation.networkTripwire.attempts.length, 0);
    assert.equal(thrown.isolation.networkTripwire.logOk, true, "tripwire log collected despite the throw");
    assert.ok(thrown.upstream.requests.length >= 1, "upstream records collected despite the throw");
    assert.equal(thrown.upstream.pendingReleased, true);
    assert.equal(thrown.cleanup.status, "retained-on-failure");
    assert.equal(existsSync(join(workDir, "logs", "results.json")), true);
  });
});
