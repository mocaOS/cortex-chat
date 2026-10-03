#!/usr/bin/env node
// Reusable bounded REAL Next request-context runtime for cortex-chat ask-route
// and memory journey checks. This module owns ONLY evaluation infrastructure:
// it is a library, not a scenario. The lead owns the scenario module
// (scripts/chat-journey-checks.ts) and all behavioral assertions; this file
// provides the isolated environment and the runtime context the scenario
// runs against.
//
//   import { withChatRuntime } from "./chat-journey-runtime.mjs";
//   const result = await withChatRuntime(async (ctx) => { ... }, options);
//
// What a run does, in order:
//
// 1. Preflight (before any scratch is created): option validation (unknown
//    options are refused), scratch capacity on the actual TMPDIR filesystem,
//    git revision + dirty snapshot, resolved dependency versions and lockfile
//    digests. Accepted uncommitted inputs (restore-fixture.mjs,
//    restore-consumer.mjs — the seeding tooling and the tripwire mechanism
//    replicated below) are hashed so provenance covers the exact bytes used.
// 2. Scratch work directory (owned): created under TMPDIR (never /tmp when
//    TMPDIR points elsewhere; refused if TMPDIR is set but missing). Layout:
//    workDir/{app,data,home,tmp,logs}, plus the generated augment child and
//    network tripwire scripts.
// 3. Allowlisted source copy: src/**, public/**, next.config.ts,
//    tsconfig.json, postcss.config.mjs, package.json, package-lock.json
//    copied VERBATIM (no .env*, no data/, no .next, no scripts, no docs;
//    symlinks in src/public are refused, never materialized). A per-file
//    SHA-256 manifest is frozen at copy time and re-checked at the end.
// 4. node_modules: a PRIVATE VERBATIM COPY of the repository's EXISTING
//    installed dependency graph (no npm install, no resolution change) is
//    placed inside the scratch app root. The earlier symlink made Next dev
//    resolve dependencies OUTSIDE the project root — observed failures in
//    run 20261002-a (retained, chat-journey-96HH28): webpack instrumentation
//    compiled better-sqlite3 with edge/fs misses + argon2 named-export
//    warnings, and the webpack versionCheck reached registry.npmjs.org
//    (caught by the tripwire; no paid/model call). The copy keeps the SAME
//    graph inside the app root for the default supported `next dev`
//    (Turbopack) runner and makes repository node_modules writes
//    structurally impossible. Actual resolved package versions and the
//    installed node_modules/.package-lock.json digest are recorded at start
//    and end (drift fails). Native binding smoke unchanged.
//    Next dev cache writes land in the private copy (scratch), never in the
//    repository.
// 5. Seed: the EXISTING scripts/restore-fixture.mjs `seed` (real Drizzle
//    migrations + real crypto/password modules, synthetic fx-* state only)
//    creates a fresh, quiesced fixture at workDir/data.
// 6. Augmentation (before boot, on the scratch copy only), via a generated
//    child executed with the repo's real crypto/password modules under tsx
//    (--import tsx --conditions=react-server, the contract-suite flags):
//    - a foreign user (fx-journey-user-0003) in a SEPARATE group
//      (fx-journey-group-0002) with its own encrypted group chat read key
//      (fx-journey-key-read-0003);
//    - a group-less user (fx-journey-user-0004, group_id NULL);
//    - a synthetic EXPIRED session token for the fixture owner;
//    - the fixture owner's username changed to a Unicode identity constant
//      (identity/analytics controls).
//    The child verifies its own writes (password verify + key decrypt
//    round-trip) and quiesces the database again.
// 7. Upstream: an owned loopback HTTP server (127.0.0.1, ephemeral port)
//    standing in for the Cortex backend, wired to the app via CORTEX_API_URL.
//    Every request is recorded (method, path, headers, parsed body, raw
//    length, request id). Default handler: POST /api/ask -> JSON ask
//    response; POST /api/ask/stream -> backend-v2-style SSE frames (content,
//    sources, done with pending_memory, then memory_update). The lead
//    installs a full-control handler via upstream.setHandler(fn(req,res,
//    record)); a handler that returns without ending the response is held in
//    upstream.pending (Map requestId -> {response, record}) and completed by
//    upstream.release(id, frames). Requests to paths outside the expected
//    list (default: the proxy allowlist endpoints) are recorded as
//    unexpected and FAIL the run.
// 8. Boot: the REAL Next dev server (`next dev --hostname 127.0.0.1`) from
//    the scratch copy under an explicit env allowlist (no ambient secrets,
//    scratch HOME/TMPDIR, DATABASE_PATH in scratch data, SENTRY_DISABLED=1,
//    NEXT_PUBLIC_SENTRY_DISABLED=1, NEXT_TELEMETRY_DISABLED=1, SMTP/OIDC/
//    DEMO/VOICE absent) and a child network tripwire (mechanism replicated
//    from scripts/restore-consumer.mjs: non-loopback DNS/connect attempts are
//    BLOCKED and logged; any attempt fails the run). The parent's own
//    request() helper refuses anything but same-origin paths on the loopback
//    app base.
//
//    EVIDENCE CLAIM (deliberate): this is a DEVELOPMENT request context
//    (`next dev`), explicitly NOT a production build/start claim. The result
//    carries this label; do not broaden it in records. The dev runner is the
//    default `next dev` (Turbopack) — the normal supported runner — against
//    the private copy so dependencies resolve inside the project root. If a
//    registry version check still occurs, the lead's fallback is a
//    production `next build` + `next start` with the same private copy; the
//    tripwire is never suppressed either way.
// 9. Scenario: the lead's runChecks callback receives the runtime context:
//    { baseUrl, dataDir, workDir, ids, users, request, upstream, checks,
//      check, app, environment }. request(path, {method, cookie, body,
//      headers, timeoutMs}) returns the raw fetch Response (bounded,
//      redirect: manual). The check schema is STRICT: ok must be a boolean
//      (truthy strings/objects must not pass), id must be a nonempty unique
//      string; violations — in ctx.check calls AND returned rows — are
//      recorded as failed checks and run errors, never silently filtered.
//      A run with ZERO checks fails.
// 10. Finalization: child lifecycle stopped in finally (owned process group,
//     SIGTERM then SIGKILL, exit awaited); evidence (upstream records,
//     tripwire log, frozen-manifest drift) is collected UNCONDITIONALLY —
//     also when the scenario threw; upstream closed; pending (unreleased)
//     responses are a failure; result.cleanup is assigned EARLY, and the
//     FINAL result (cleanup verdict + every late error) is written to the
//     retained receipt AFTER stop/copy/removal (kept scratch is rewritten
//     too). Artifacts (logs, results, provenance manifests, augment child,
//     tripwire script) are copied to options.outputDir BEFORE scratch
//     removal; the copied app tree (including the private node_modules
//     copy) and the scratch data are removed ONLY after the receipt is
//     retained elsewhere. A FAILED run keeps its scratch retained (never
//     removed) until the evidence is preserved and the owner says so.
//
// The result fails (ok: false) on: zero checks, any failed check, scenario
// callback throw, unexpected upstream path, egress tripwire attempt,
// manifest drift, unreleased pending upstream responses, app process exit
// during the scenario, seed/augment/boot failure, or cleanup failure.
//
// Scope guarantees: this module never edits runtime source, schema,
// migrations, manifests or locks; it never commits, deploys, touches live
// stores, or makes paid/model calls; the only network it creates is loopback.
// Exit/usage discipline is the runner's responsibility (lead's .ts runner);
// the module itself returns a structured result and only throws on usage
// errors that precede any scratch creation.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import net from "node:net";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(SCRIPT_PATH));
const FIXTURE_SCRIPT = join(REPO_ROOT, "scripts", "restore-fixture.mjs");
const CONSUMER_SCRIPT = join(REPO_ROOT, "scripts", "restore-consumer.mjs");
const SESSION_COOKIE = "cortex_session";

// ---- Fixture-side constants (independently mirrored from
// scripts/restore-fixture.mjs and scripts/restore-consumer.mjs, the same way
// tests/restore-fixture.test.ts pins them; never read from the fixture
// scripts at runtime — those are inputs, not importable modules) -----------

const FIXTURE_VERSION = 2;
const INTERNAL_KEY = Buffer.alloc(32);
Buffer.from("synthetic-restore-fixture-key", "utf8").copy(INTERNAL_KEY);
const APP_ENCRYPTION_KEY_B64 = INTERNAL_KEY.toString("base64");

const FIXTURE_SUPERADMIN_EMAIL = "fixture-superadmin@example.invalid";
const FIXTURE_SUPERADMIN_PASSWORD = "fx-superadmin-password-0001";
const FIXTURE_ADMIN_API_KEY = "fx-synthetic-admin-key-0001";
const FIXTURE_USER_PASSWORD = "fx-correct-horse-battery-staple";
const FIXTURE_EMAIL_OWNER = "fixture-user-0001@example.invalid";
const FIXTURE_EMAIL_MEMBER = "fixture-user-0002@example.invalid";

const FIXTURE_IDS = {
  readKey: "fx-key-read-0001",
  contentKey: "fx-key-content-0002",
  group: "fx-group-0001",
  owner: "fx-user-0001",
  member: "fx-user-0002",
  soul: "fx-soul-0001",
  project: "fx-project-0001",
  chat: "fx-chat-0001",
  messages: ["fx-msg-0001", "fx-msg-0002", "fx-msg-0003", "fx-msg-0004"],
};

// The single accepted fixture citation (accepted MAIN producer declaration,
// mirrored verbatim — see scripts/restore-fixture.mjs fixture pack v2).
const FIXTURE_CITATION_TEXT =
  "Fixture Source content for the disposable restore rehearsal.\n" +
  "It's a \"test\" with escaping: back\\slash and 'quotes'.\n" +
  "The fixture graph cites this document as fx-source-0001 (Fixture Source).\n" +
  "Mentions Rehearsal Alpha and Rehearsal Beta for graph linkage.\n";

// ---- Run-owned augmentation constants (fx-journey-* namespace; these rows
// are inserted by THIS harness into the scratch fixture copy before boot and
// are declared as run-owned writes) ------------------------------------------

export const UNICODE_OWNER_USERNAME = "üñícode-öwner-Ω-日本語-✓";

export const AUGMENT_IDS = {
  foreignGroup: "fx-journey-group-0002",
  foreignReadKey: "fx-journey-key-read-0003",
  foreignUser: "fx-journey-user-0003",
  noGroupUser: "fx-journey-user-0004",
  foreignEmail: "journey-foreign-user@example.invalid",
  noGroupEmail: "journey-nogroup-user@example.invalid",
  foreignPassword: "fx-journey-foreign-password-0003",
  noGroupPassword: "fx-journey-nogroup-password-0004",
  foreignUsername: "journey-foreign-üñí",
  noGroupUsername: "journey-nogroup",
  foreignReadKeyPlaintext: "fx-synthetic-foreign-read-key-0003",
  expiredToken: "fx-journey-expired-session-token-0001",
};

// ---- Upstream defaults ------------------------------------------------------

// The generic proxy allowlist endpoints (scoped guide: backend integration),
// plus the ask routes. Anything else reaching the upstream is unexpected.
export const EXPECTED_UPSTREAM_PREFIXES = [
  "/api/ask",
  "/api/collections",
  "/api/features",
  "/api/tasks/",
  "/api/documents/",
];

export function classifyUpstreamPath(path, prefixes = EXPECTED_UPSTREAM_PREFIXES) {
  const p = typeof path === "string" ? path.split("?")[0] : "";
  for (const prefix of prefixes) {
    if (p === prefix || p === prefix.replace(/\/$/, "") || p.startsWith(prefix)) {
      return { expected: true, matched: prefix };
    }
  }
  return { expected: false, matched: null };
}

// Backend-v2-style default SSE stream: content, populated sources, done with
// pending_memory (keep reading past done!), then the late memory_update.
export const DEFAULT_SSE_FRAMES = [
  { content: "Synthetic chat-journey answer citing fx-source-0001." },
  {
    sources: [
      {
        document_id: "fx-source-0001",
        chunk_id: "fx-source-0001-chunk-0",
        content: FIXTURE_CITATION_TEXT,
        score: 0.42,
        sid: "fx-source-0001",
        title: "Fixture Source",
        metadata: { filename: "fixture-source.md", chunk_index: 0 },
      },
    ],
  },
  { done: true, pending_memory: true, refused: false, truncated: false },
  { memory_update: { conversation_memory: "fx-journey-memory-v1", turns: 2 } },
];

export const DEFAULT_ASK_JSON = {
  answer: "Synthetic chat-journey answer citing fx-source-0001.",
  sources: DEFAULT_SSE_FRAMES[1].sources,
  finish_reason: "stop",
  refused: false,
  truncated: false,
};

// ---- Small helpers ------------------------------------------------------------

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function note(msg) {
  process.stderr.write(`[chat-journey-runtime] ${msg}\n`);
}

class UsageError extends Error {}

function assertDirExists(dir, what) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new UsageError(`${what} does not exist or is not a directory: ${dir}`);
  }
}

function freePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const srv = net.createServer();
    srv.once("error", rejectPromise);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
  });
}

// Frozen tree manifest: per-file SHA-256 over an allowlisted copy, skipping
// runtime-generated build artifacts that never belong to the input identity.
// node_modules is skipped wholesale (a private verbatim COPY of the
// repository's installed graph, hashed via its .package-lock.json instead —
// hashing ~900 MiB of packages per run is not meaningful provenance).
const MANIFEST_SKIP = new Set([".next", "next-env.d.ts", "tsconfig.tsbuildinfo", "node_modules"]);

export function hashTree(dir, { skip = MANIFEST_SKIP } = {}) {
  const files = {};
  const symlinks = {};
  const skipped = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skip.has(entry.name)) {
        skipped.push(rel);
        continue;
      }
      if (entry.isSymbolicLink()) {
        symlinks[rel] = realpathSync(join(current, entry.name));
      } else if (entry.isDirectory()) {
        walk(join(current, entry.name), rel);
      } else if (entry.isFile()) {
        files[rel] = sha256Hex(readFileSync(join(current, entry.name)));
      }
    }
  };
  walk(dir, "");
  return { files, symlinks, skipped };
}

export function compareManifests(startFiles, endFiles) {
  const drift = [];
  const keys = new Set([...Object.keys(startFiles), ...Object.keys(endFiles)]);
  for (const key of [...keys].sort()) {
    if (!(key in endFiles)) drift.push({ path: key, kind: "removed" });
    else if (!(key in startFiles)) drift.push({ path: key, kind: "added" });
    else if (startFiles[key] !== endFiles[key]) drift.push({ path: key, kind: "changed" });
  }
  return drift;
}

// ---- App env allowlist (also exported for unit controls) -----------------------
// Allowlist, not denylist: everything not listed here is deliberately absent
// (no ambient credentials, no SMTP/OIDC/DEMO/VOICE, no service endpoints).

export function buildAppEnv({ dataDir, backendUrl, workDir, tripwirePath }) {
  if (!isLoopbackHttpUrl(backendUrl)) {
    throw new UsageError(`backendUrl must be an exact loopback http URL: ${backendUrl}`);
  }
  const env = {
    PATH: process.env.PATH,
    DATABASE_PATH: join(dataDir, "cortex-chat.db"),
    APP_ENCRYPTION_KEY: APP_ENCRYPTION_KEY_B64,
    BACKEND_ADMIN_API_KEY: FIXTURE_ADMIN_API_KEY,
    SUPERADMIN_EMAIL: FIXTURE_SUPERADMIN_EMAIL,
    SUPERADMIN_PASSWORD: FIXTURE_SUPERADMIN_PASSWORD,
    CORTEX_API_URL: backendUrl,
    SENTRY_DISABLED: "1",
    NEXT_PUBLIC_SENTRY_DISABLED: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  if (workDir) {
    env.HOME = join(workDir, "home");
    env.TMPDIR = join(workDir, "tmp");
  }
  if (tripwirePath) {
    env.NODE_OPTIONS = `--require ${tripwirePath}`;
    env.TRIPWIRE_LOG = join(workDir, "logs", "network-tripwire.jsonl");
  }
  return env;
}

function isLoopbackHttpUrl(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {}
  const host = (parsed?.hostname ?? "").toLowerCase();
  return (
    !!parsed &&
    parsed.protocol === "http:" &&
    (host === "127.0.0.1" || host === "::1" || host === "localhost" || host === "[::1]")
  );
}

// ---- Network tripwire ------------------------------------------------------------
// Replicated from scripts/restore-consumer.mjs (uncommitted accepted input;
// its bytes are hashed into the run provenance). Blocks and records any
// non-loopback DNS resolution or connect attempt from every app/dev node
// process; loopback-only egress is the isolation claim.

const TRIPWIRE_SOURCE = `
const fs = require("node:fs");
const dnsMod = require("node:dns");
const netMod = require("node:net");
const LOG = process.env.TRIPWIRE_LOG;
function record(entry) {
  if (!LOG) return;
  try { fs.appendFileSync(LOG, JSON.stringify({ pid: process.pid, ppid: process.ppid, ...entry }) + "\\n"); } catch {}
}
function isLoopbackIp(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost" ||
    (typeof ip === "string" && (ip.startsWith("127.") || ip === "::ffff:127.0.0.1"));
}
function isLoopbackHost(host) {
  if (typeof host !== "string") return true;
  if (isLoopbackIp(host)) return true;
  try {
    if (netMod.isIP(host)) return false;
  } catch {}
  return null; // hostname — decided by the dns hook
}
const origLookup = dnsMod.lookup.bind(dnsMod);
dnsMod.lookup = function patchedLookup(hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  const wrapped = (err, ...rest) => {
    if (!err) {
      let first = rest[0];
      if (Array.isArray(first) && first.length > 0 && typeof first[0] === "object" && first[0] !== null) {
        first = first.map((a) => a.address);
      }
      const addresses = Array.isArray(first) ? first.flat() : [first];
      const allLoopback = addresses.every((a) => isLoopbackIp(a) || a === null || a === undefined);
      if (!allLoopback) {
        record({ kind: "dns", host: hostname, resolved: addresses, blocked: true, reason: "non-loopback resolution" });
        err = new Error("chat-journey network tripwire: non-loopback DNS resolution blocked: " + hostname);
        err.code = "ETRIPWIRE";
        rest = [];
      }
    }
    callback(err, ...rest);
  };
  return origLookup(hostname, options, wrapped);
};
const origConnect = netMod.Socket.prototype.connect;
netMod.Socket.prototype.connect = function patchedConnect(...args) {
  const options = typeof args[0] === "object" && args[0] !== null ? args[0] : (typeof args[1] === "object" && args[1] !== null ? args[1] : {});
  const host = options.host ?? (typeof args[0] === "string" ? args[0] : undefined);
  const verdict = isLoopbackHost(host);
  if (verdict === false) {
    record({ kind: "connect", host, blocked: true, reason: "non-loopback IP literal" });
    const err = new Error("chat-journey network tripwire: non-loopback connection blocked: " + host);
    err.code = "ETRIPWIRE";
    throw err;
  }
  return origConnect.apply(this, args);
};
`;

function writeTripwire(workDir) {
  const tripwirePath = join(workDir, "chat-journey-network-tripwire.cjs");
  writeFileSync(tripwirePath, TRIPWIRE_SOURCE);
  // The JSONL log exists from the start: a run with zero attempts is "clean"
  // because the log exists and is empty, not because it is missing.
  writeFileSync(join(workDir, "logs", "network-tripwire.jsonl"), "");
  return tripwirePath;
}

export function readTripwireLog(workDir) {
  const logPath = join(workDir, "logs", "network-tripwire.jsonl");
  if (!existsSync(logPath)) {
    // Fail-closed: a missing log is NOT evidence of a clean run — the
    // tripwire would have been unobservable.
    return { ok: false, attempts: [], problem: `network tripwire log missing: ${logPath}` };
  }
  const attempts = [];
  let malformed = null;
  const lines = readFileSync(logPath, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (!trimmed.startsWith("{")) {
      malformed = `line ${i + 1} is not a JSON object`;
      break;
    }
    try {
      attempts.push(JSON.parse(trimmed));
    } catch {
      malformed = `line ${i + 1} is not valid JSON`;
      break;
    }
  }
  if (malformed) {
    return { ok: false, attempts, problem: `network tripwire log malformed (${malformed}): ${logPath}` };
  }
  return { ok: true, attempts, problem: null };
}

// ---- Augmentation child (generated into the scratch work dir; executed with
// the repo's REAL crypto/password modules via tsx, the contract-suite loader
// flags). It mutates ONLY the scratch fixture copy, before boot. Module
// resolution is anchored at the repository root via createRequire, because
// the child file itself lives in scratch, outside any node_modules tree.

const AUGMENT_CHILD_SOURCE = `
import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [dataDir, repoRoot] = process.argv.slice(2);
const dbPath = join(dataDir, "cortex-chat.db");
const require2 = createRequire(join(repoRoot, "package.json"));
const Database = require2("better-sqlite3");

process.env.APP_ENCRYPTION_KEY = ${JSON.stringify(APP_ENCRYPTION_KEY_B64)};

const cryptoModule = await import(pathToFileURL(join(repoRoot, "src/lib/auth/crypto.ts")).href);
const passwordModule = await import(pathToFileURL(join(repoRoot, "src/lib/auth/password.ts")).href);
const { encryptSecret, decryptSecret } = cryptoModule;
const { hashPassword, verifyPassword } = passwordModule;

const AUG = ${JSON.stringify(AUGMENT_IDS)};
const UNICODE_OWNER_USERNAME = ${JSON.stringify(UNICODE_OWNER_USERNAME)};
const T0 = 1767225600000; // 2026-01-01T00:00:00Z — the fixture epoch

function fail(reason) {
  process.stderr.write(JSON.stringify({ ok: false, error: reason }) + "\\n");
  process.exit(1);
}

if (!existsSync(dbPath)) fail("augment: fixture database missing at " + dbPath);

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

try {
  const inserted = [];
  const insert = (sql, ...params) => sqlite.prepare(sql).run(...params);

  // Foreign read key (encrypted with the real app crypto, same envelope as
  // the fixture's own keys).
  const encryptedForeignKey = encryptSecret(AUG.foreignReadKeyPlaintext);
  if (decryptSecret(encryptedForeignKey) !== AUG.foreignReadKeyPlaintext) {
    fail("augment: foreign key envelope failed the decrypt round-trip before insert");
  }
  insert(
    "INSERT INTO api_keys (id, backend_key_id, encrypted_value, permission, collection_ids, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    AUG.foreignReadKey, "fx-journey-backend-key-0003", encryptedForeignKey,
    "read", "[]", "Journey foreign group read key", T0 + 7000
  );
  inserted.push("api_keys/" + AUG.foreignReadKey);

  insert(
    "INSERT INTO groups (id, name, description, chat_key_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    AUG.foreignGroup, "Journey Foreign Group", "chat-journey-runtime foreign-scope group",
    AUG.foreignReadKey, T0 + 7100, T0 + 7100
  );
  inserted.push("groups/" + AUG.foreignGroup);

  const foreignDigest = await hashPassword(AUG.foreignPassword);
  if (!(await verifyPassword(foreignDigest, AUG.foreignPassword))) {
    fail("augment: foreign user digest failed verification before insert");
  }
  insert(
    "INSERT INTO users (id, email, password_hash, username, avatar_path, role, group_id, content_key_id, created_at, updated_at, last_login_at, oidc_sub, oidc_issuer) VALUES (?, ?, ?, ?, NULL, 'user', ?, NULL, ?, ?, NULL, NULL, NULL)",
    AUG.foreignUser, AUG.foreignEmail, foreignDigest, AUG.foreignUsername,
    AUG.foreignGroup, T0 + 7200, T0 + 7200
  );
  inserted.push("users/" + AUG.foreignUser);

  const noGroupDigest = await hashPassword(AUG.noGroupPassword);
  if (!(await verifyPassword(noGroupDigest, AUG.noGroupPassword))) {
    fail("augment: no-group user digest failed verification before insert");
  }
  insert(
    "INSERT INTO users (id, email, password_hash, username, avatar_path, role, group_id, content_key_id, created_at, updated_at, last_login_at, oidc_sub, oidc_issuer) VALUES (?, ?, ?, ?, NULL, 'user', NULL, NULL, ?, ?, NULL, NULL, NULL)",
    AUG.noGroupUser, AUG.noGroupEmail, noGroupDigest, AUG.noGroupUsername,
    T0 + 7300, T0 + 7300
  );
  inserted.push("users/" + AUG.noGroupUser);

  // Synthetic EXPIRED session for the fixture owner: expires_at is the fixed
  // fixture epoch (2026-01-01), strictly in the past for any live run.
  insert(
    "INSERT INTO sessions (token, user_id, ip, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, '127.0.0.1', 'chat-journey-runtime/1 (synthetic)', ?, ?, ?)",
    AUG.expiredToken, "fx-user-0001", T0 - 86400000, T0 - 86400000, T0
  );
  inserted.push("sessions/expired:" + AUG.expiredToken);

  // Unicode identity control on the FIXTURE owner's username (run-owned
  // mutation of the scratch copy, declared here and visible to the app's
  // identity/analytics paths).
  sqlite.prepare("UPDATE users SET username = ?, updated_at = ? WHERE id = 'fx-user-0001'").run(UNICODE_OWNER_USERNAME, T0 + 7400);
  const readBack = sqlite.prepare("SELECT username FROM users WHERE id = 'fx-user-0001'").get();
  if (readBack.username !== UNICODE_OWNER_USERNAME) {
    fail("augment: unicode username did not round-trip");
  }

  // Independent read-back gates (not trusting this process's own inserts).
  const checks = {
    foreignUser: sqlite.prepare("SELECT group_id FROM users WHERE id = ?").get(AUG.foreignUser)?.group_id === AUG.foreignGroup,
    noGroupUser: sqlite.prepare("SELECT group_id FROM users WHERE id = ?").get(AUG.noGroupUser)?.group_id === null,
    foreignKeyDecrypts: decryptSecret(sqlite.prepare("SELECT encrypted_value FROM api_keys WHERE id = ?").get(AUG.foreignReadKey)?.encrypted_value ?? "") === AUG.foreignReadKeyPlaintext,
    foreignPasswordVerifies: await verifyPassword(sqlite.prepare("SELECT password_hash FROM users WHERE id = ?").get(AUG.foreignUser)?.password_hash ?? "", AUG.foreignPassword),
    expiredTokenPast: (() => { const row = sqlite.prepare("SELECT expires_at FROM sessions WHERE token = ?").get(AUG.expiredToken); return !!row && row.expires_at < Date.now(); })(),
    unicodeUsername: sqlite.prepare("SELECT username FROM users WHERE id = 'fx-user-0001'").get()?.username === UNICODE_OWNER_USERNAME,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (failed.length > 0) fail("augment read-back gates failed: " + failed.join(", "));

  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  sqlite.close();
  process.stdout.write(JSON.stringify({ ok: true, inserted, unicodeOwnerUsername: UNICODE_OWNER_USERNAME, gates: checks }) + "\\n");
} catch (err) {
  try { sqlite.pragma("wal_checkpoint(TRUNCATE)"); sqlite.close(); } catch {}
  fail("augment: " + (err && err.message ? err.message : String(err)));
}
`;

// ---- Upstream (owned loopback Cortex-backend stand-in) --------------------------

function startUpstreamServer({ expectedPrefixes }) {
  const requests = [];
  const unexpected = [];
  const pending = new Map();
  let handler = null;
  let expected = [...expectedPrefixes];

  function recordRequest(req, bodyBuf) {
    const rawBody = bodyBuf.toString("utf8");
    let parsed = null;
    if (rawBody.length > 0) {
      try { parsed = JSON.parse(rawBody); } catch { parsed = null; }
    }
    const seq = requests.length + 1;
    const record = {
      seq,
      id: req.headers["x-request-id"] ?? `upstream-${seq}`,
      method: req.method,
      path: req.url,
      headers: { ...req.headers },
      body: parsed,
      rawBodyLength: bodyBuf.length,
      receivedAt: new Date().toISOString(),
      handled: null,
      released: false,
    };
    requests.push(record);
    return record;
  }

  function writeFrames(res, frames) {
    for (const frame of frames) {
      if (typeof frame === "string") {
        res.write(frame.endsWith("\n\n") ? frame : frame + "\n\n");
      } else {
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
      }
    }
  }

  function defaultHandle(record, res) {
    if (record.method === "POST" && (record.path === "/api/ask/stream" || record.path.startsWith("/api/ask/stream?"))) {
      record.handled = "default-sse";
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      writeFrames(res, DEFAULT_SSE_FRAMES);
      res.end();
      return;
    }
    if (record.method === "POST" && (record.path === "/api/ask" || record.path.startsWith("/api/ask?"))) {
      record.handled = "default-json";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(DEFAULT_ASK_JSON));
      return;
    }
    record.handled = "default-404";
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "chat-journey-runtime upstream (no handler for this path)" }));
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const record = recordRequest(req, Buffer.concat(chunks));
      const verdict = classifyUpstreamPath(record.path, expected);
      if (!verdict.expected) {
        unexpected.push({ id: record.id, method: record.method, path: record.path });
        record.handled = "unexpected";
      }
      if (handler) {
        record.handled = record.handled === "unexpected" ? record.handled : "handler";
        try {
          handler(req, res, record);
        } catch (err) {
          record.handlerError = err && err.message ? err.message : String(err);
          if (!res.writableEnded) {
            try {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ detail: "chat-journey upstream handler threw", error: record.handlerError }));
            } catch {}
          }
        }
        // A handler that did not end the response holds it for the lead.
        if (!res.writableEnded) {
          pending.set(record.id, { response: res, record });
        } else {
          record.released = true;
        }
      } else {
        defaultHandle(record, res);
      }
    });
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolvePromise({
        server,
        url: `http://127.0.0.1:${port}`,
        requests,
        unexpected,
        pending,
        get expectedPaths() { return [...expected]; },
        get handlerActive() { return handler !== null; },
        setHandler(fn) {
          if (typeof fn !== "function") throw new UsageError("upstream.setHandler expects a function");
          handler = fn;
        },
        setExpectedPaths(prefixes) {
          if (!Array.isArray(prefixes) || prefixes.some((p) => typeof p !== "string")) {
            throw new UsageError("upstream.setExpectedPaths expects an array of path prefixes");
          }
          expected = [...prefixes];
        },
        release(id, frames = []) {
          const entry = pending.get(id);
          if (!entry) {
            throw new UsageError(`no pending upstream response for request id: ${id} (known: ${[...pending.keys()].join(", ") || "none"})`);
          }
          pending.delete(id);
          if (entry.response.writableEnded) {
            throw new UsageError(`pending response for ${id} already ended`);
          }
          writeFrames(entry.response, frames);
          entry.response.end();
          entry.record.released = true;
          if (entry.record.handled === "handler") entry.record.handled = "handler-released";
          return true;
        },
        close: async () => {
          for (const [, entry] of pending) {
            try { entry.response.destroy(); } catch {}
          }
          pending.clear();
          try { server.closeAllConnections?.(); } catch {}
          await new Promise((r) => server.close(() => r()));
        },
      });
    });
  });
}

// ---- Process handling (per-run closure state, not module state) ------------------

function makeProcessRunner() {
  const children = [];
  const openFds = [];
  function spawnLogged(cmd, args, { cwd, env, logFile }) {
    const fs = require("node:fs");
    const out = fs.openSync(logFile, "a");
    const err = fs.openSync(logFile, "a");
    openFds.push(out, err);
    const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", out, err] });
    children.push(child);
    return child;
  }
  function killGroup(child, signal) {
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, signal); } catch {}
      try { child.kill(signal); } catch {}
    }
  }
  function killAll() {
    for (const child of children) killGroup(child, "SIGKILL");
  }
  function waitForExit(child, timeoutMs) {
    return new Promise((resolvePromise) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolvePromise({ code: child.exitCode, signal: child.signalCode, timedOut: false });
        return;
      }
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        killGroup(child, "SIGKILL");
        resolvePromise({ timedOut: true });
      }, timeoutMs);
      child.on("exit", (code, signal) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolvePromise({ code, signal, timedOut: false });
      });
      child.on("error", (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolvePromise({ error: err.message, timedOut: false });
      });
    });
  }
  async function stopAll({ graceMs }) {
    for (const child of children) killGroup(child, "SIGTERM");
    const exits = await Promise.all(
      children.map((child) => waitForExit(child, graceMs))
    );
    const stillRunning = children.filter((c) => c.exitCode === null && c.signalCode === null);
    killAll();
    if (stillRunning.length > 0) {
      await Promise.all(stillRunning.map((child) => waitForExit(child, graceMs)));
    }
    for (const fd of openFds) {
      try { require("node:fs").closeSync(fd); } catch {}
    }
    return exits;
  }
  return { spawnLogged, killAll, waitForExit, stopAll, children };
}

// ---- Git / dependency provenance ---------------------------------------------------

function gitSnapshot(cwd) {
  const run = (args) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });
  const head = run(["rev-parse", "HEAD"]);
  const status = run(["status", "--porcelain"]);
  const dirtyLines = (status.stdout || "").split("\n").filter((l) => l.trim().length > 0);
  return {
    head: head.status === 0 ? head.stdout.trim() : null,
    headCommand: "git rev-parse HEAD",
    dirtyCount: dirtyLines.length,
    dirty: dirtyLines.slice(0, 200),
    dirtyTruncated: dirtyLines.length > 200,
    available: head.status === 0,
  };
}

function resolvedDependencyVersions(nodeModulesDir) {
  const names = [
    "next", "react", "react-dom", "better-sqlite3", "@node-rs/argon2",
    "drizzle-orm", "@sentry/nextjs", "zod", "sharp", "typescript", "tsx",
  ];
  const versions = {};
  for (const name of names) {
    try {
      versions[name] = JSON.parse(
        readFileSync(join(nodeModulesDir, ...name.split("/"), "package.json"), "utf8")
      ).version;
    } catch {
      versions[name] = null;
    }
  }
  return versions;
}

// ---- Source copy --------------------------------------------------------------------

function copyDirFiltered(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isSymbolicLink()) throw new UsageError(`symlink in source inputs is never materialized: ${from}`);
    if (entry.isDirectory()) copyDirFiltered(from, to);
    else if (entry.isFile()) cpSync(from, to, { preserveTimestamps: true });
  }
}

const SOURCE_FILES = ["next.config.ts", "tsconfig.json", "postcss.config.mjs", "package.json", "package-lock.json"];

function prepareAppCopy(workDir) {
  const appDir = join(workDir, "app");
  mkdirSync(appDir, { recursive: true });
  const collected = { symlinks: [] };
  const scan = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) collected.symlinks.push(rel);
      else if (entry.isDirectory()) scan(join(dir, entry.name), rel);
    }
  };
  for (const f of SOURCE_FILES) {
    const src = join(REPO_ROOT, f);
    if (!existsSync(src)) throw new UsageError(`required manifest missing from the repository: ${f}`);
    cpSync(src, join(appDir, f), { preserveTimestamps: true });
  }
  copyDirFiltered(join(REPO_ROOT, "src"), join(appDir, "src"));
  copyDirFiltered(join(REPO_ROOT, "public"), join(appDir, "public"));
  scan(join(REPO_ROOT, "src"), "src");
  scan(join(REPO_ROOT, "public"), "public");
  if (collected.symlinks.length > 0) {
    throw new UsageError(`symlinks found in the app source inputs (never materialized into the copy): ${collected.symlinks.join(", ")}`);
  }

  const tree = hashTree(appDir, { skip: new Set() });
  const sourceTreeSha256 = sha256Hex(
    Buffer.from(Object.keys(tree.files).sort().map((k) => `${k}:${tree.files[k]}`).join("\n"), "utf8")
  );
  return { appDir, sourceTreeSha256, sourceFileCount: Object.keys(tree.files).length };
}

// ---- Private verbatim node_modules copy ----------------------------------------
// Copies the repository's EXISTING installed dependency graph into the
// scratch app root: no npm install, no resolution change, byte-identical
// packages. fs.cpSync with verbatimSymlinks preserves npm's internal symlink
// structure; a `cp -a` fallback covers runtimes without that option. The
// copy is the structural guarantee that the app can only ever write to
// scratch — the repository node_modules is never mounted, symlinked or
// written.

function copyInstalledNodeModules(source, target) {
  const started = Date.now();
  let method = "fs.cpSync(verbatimSymlinks)";
  try {
    cpSync(source, target, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
  } catch (err) {
    const res = spawnSync("cp", ["-a", "--", source, target], { encoding: "utf8", timeout: 600_000 });
    if (res.status !== 0) {
      throw new Error(
        `private node_modules copy failed (fs.cpSync: ${err && err.message ? err.message : err}; cp -a exit ${res.status}): ${(res.stderr || "").slice(0, 300)}`
      );
    }
    method = "cp -a";
  }
  if (!existsSync(join(target, "next", "package.json"))) {
    throw new Error(`private node_modules copy is incomplete: next/package.json missing (source: ${source})`);
  }
  if (!existsSync(join(target, "better-sqlite3", "package.json"))) {
    throw new Error(`private node_modules copy is incomplete: better-sqlite3/package.json missing (source: ${source})`);
  }
  return { method, copyMs: Date.now() - started };
}

// ---- Options -------------------------------------------------------------------------

const ALLOWED_OPTIONS = new Set([
  "label", "workDir", "outputDir", "stopAfter", "scenarioInputs",
  "expectedUpstreamPaths", "startupTimeoutMs", "requestTimeoutMs",
  "seedTimeoutMs", "augmentTimeoutMs", "killGraceMs",
]);

const DEFAULTS = {
  label: "chat-journey",
  startupTimeoutMs: 240_000,
  requestTimeoutMs: 30_000,
  seedTimeoutMs: 180_000,
  augmentTimeoutMs: 120_000,
  killGraceMs: 5_000,
};

function scratchBase() {
  const configured = process.env.TMPDIR ? process.env.TMPDIR.trim() : "";
  if (configured) {
    assertDirExists(configured, `TMPDIR (scratch base)`);
    return { base: configured, source: "TMPDIR" };
  }
  return { base: tmpdir(), source: "os.tmpdir()" };
}

// ---- Main entry -----------------------------------------------------------------------

export async function withChatRuntime(runChecks, options = {}) {
  if (typeof runChecks !== "function") {
    throw new UsageError("withChatRuntime(runChecks, options): runChecks must be a function");
  }
  for (const key of Object.keys(options)) {
    if (!ALLOWED_OPTIONS.has(key)) {
      throw new UsageError(`unknown option "${key}" (allowed: ${[...ALLOWED_OPTIONS].join(", ")})`);
    }
  }
  const opts = {
    label: typeof options.label === "string" && options.label ? options.label : DEFAULTS.label,
    workDir: options.workDir ? resolve(options.workDir) : null,
    outputDir: options.outputDir ? resolve(options.outputDir) : null,
    stopAfter: options.stopAfter ?? null,
    scenarioInputs: options.scenarioInputs ?? [],
    expectedUpstreamPaths: options.expectedUpstreamPaths ?? EXPECTED_UPSTREAM_PREFIXES,
    startupTimeoutMs: options.startupTimeoutMs ?? DEFAULTS.startupTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs,
    seedTimeoutMs: options.seedTimeoutMs ?? DEFAULTS.seedTimeoutMs,
    augmentTimeoutMs: options.augmentTimeoutMs ?? DEFAULTS.augmentTimeoutMs,
    killGraceMs: options.killGraceMs ?? DEFAULTS.killGraceMs,
  };
  if (opts.stopAfter !== null && opts.stopAfter !== "augment") {
    throw new UsageError(`options.stopAfter must be "augment" or null/undefined (full run), got: ${opts.stopAfter}`);
  }
  if (!Array.isArray(opts.scenarioInputs)) {
    throw new UsageError("options.scenarioInputs must be an array of absolute file paths");
  }
  if (
    !Array.isArray(opts.expectedUpstreamPaths) ||
    opts.expectedUpstreamPaths.some((p) => typeof p !== "string" || !p.startsWith("/"))
  ) {
    throw new UsageError("options.expectedUpstreamPaths must be an array of upstream path prefixes starting with \"/\"");
  }
  for (const input of opts.scenarioInputs) {
    if (!isAbsolute(input)) throw new UsageError(`scenarioInputs entries must be absolute paths: ${input}`);
    assertDirExists(dirname(input), `scenario input parent directory (${input})`);
    if (!existsSync(input)) throw new UsageError(`scenario input does not exist: ${input}`);
  }
  if (opts.workDir && existsSync(opts.workDir)) {
    const entries = readdirSync(opts.workDir);
    if (entries.length > 0) {
      throw new UsageError(`options.workDir must be empty or non-existent (existing evidence is never overwritten): ${opts.workDir}`);
    }
  }

  const t0 = Date.now();
  const errors = [];
  const runner = makeProcessRunner();
  let upstream = null;
  let appChild = null;
  let appExitInfo = null;
  let unexpectedAppExit = null;
  let intentionalStop = false;
  const startedManifestRef = { current: null };
  const result = {
    ok: false,
    label: opts.label,
    errors,
    checks: [],
    evidence: null,
    environment: null,
    isolation: null,
    seed: null,
    augmentation: null,
    app: null,
    upstream: null,
    cleanup: null,
    timings: {},
  };

  const finalize = () => {
    const checksOk = result.checks.length > 0 && result.checks.every((c) => c.ok);
    result.ok = checksOk && errors.length === 0;
    result.timings.totalMs = Date.now() - t0;
    return result;
  };

  try {
    // ---- Preflight (no scratch created yet) ----
    const scratch = scratchBase();
    const capacity = (() => {
      try {
        const s = statfsSync(scratch.base);
        return { freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) };
      } catch {
        return null;
      }
    })();
    if (capacity && capacity.freeBytes < 2 * 1024 * 1024 * 1024) {
      throw new UsageError(`scratch base has less than 2 GiB free (${scratch.base}); refusing to run`);
    }
    const gitStart = gitSnapshot(REPO_ROOT);
    const lockfileSha256 = sha256Hex(readFileSync(join(REPO_ROOT, "package-lock.json")));
    const packageJsonSha256 = sha256Hex(readFileSync(join(REPO_ROOT, "package.json")));
    const acceptedUncommittedInputs = {
      "scripts/restore-fixture.mjs": sha256Hex(readFileSync(FIXTURE_SCRIPT)),
      "scripts/restore-consumer.mjs": sha256Hex(readFileSync(CONSUMER_SCRIPT)),
    };
    const scenarioInputHashes = {};
    for (const input of opts.scenarioInputs) {
      scenarioInputHashes[input] = sha256Hex(readFileSync(input));
    }
    result.environment = {
      node: process.version,
      platform: process.platform,
      scratchBase: scratch.base,
      scratchBaseSource: scratch.source,
      scratchCapacity: capacity,
      dependencyVersions: null,
      lockfileSha256,
      packageJsonSha256,
      nativeSmoke: null,
      appEnvKeys: null,
      sentryDisabled: true,
      telemetryDisabled: true,
      nodeModulesMode:
        "private verbatim copy of the repository's installed dependency graph (no npm install, no resolution change; the repository node_modules is never mounted, symlinked or written)",
      evidenceLabel:
        "development request context: real `next dev` server on 127.0.0.1 with real migrations/crypto — explicitly NOT a production build/start claim",
    };
    result.isolation = {
      repoRoot: REPO_ROOT,
      git: gitStart,
      acceptedUncommittedInputs,
      scenarioInputs: scenarioInputHashes,
      sourceTreeSha256: null,
      manifestStart: null,
      manifestEnd: null,
      drift: [],
      networkTripwire: { attempts: [], logOk: null, problem: null },
      fixtureVersion: FIXTURE_VERSION,
    };
    result.evidence = {
      claimsSupported: [
        "real Next dev request context (route handlers, middleware, cookies, SQLite via real migrations)",
        "real seeded+augmented fixture state consumed through the actual HTTP surface",
        "controlled loopback upstream with recorded requests and controllable SSE",
      ],
      claimsNotSupported: [
        "production build/start behavior (next dev only)",
        "browser journeys",
        "model/LLM or upstream content quality (upstream is synthetic)",
        "live store, deployment, or paid-provider evidence",
      ],
    };

    if (opts.stopAfter === "augment") {
      note(`label=${opts.label} mode=prepare-probe (stopAfter=augment; no app boot)`);
    } else {
      note(`label=${opts.label} mode=full (real next dev request context)`);
    }

    // ---- Scratch work dir ----
    const workDir = opts.workDir ?? mkdtempSync(join(scratch.base, "chat-journey-"));
    mkdirSync(join(workDir, "home"), { recursive: true });
    mkdirSync(join(workDir, "tmp"), { recursive: true });
    mkdirSync(join(workDir, "logs"), { recursive: true });
    const dataDir = join(workDir, "data");
    result.workDir = workDir;
    result.dataDir = dataDir;
    note(`workDir=${workDir}`);

    const tripwirePath = writeTripwire(workDir);
    const augmentChildPath = join(workDir, "chat-journey-augment-child.mjs");
    writeFileSync(augmentChildPath, AUGMENT_CHILD_SOURCE);

    // ---- Source copy + PRIVATE node_modules copy ----
    const copyStart = Date.now();
    const { appDir, sourceTreeSha256, sourceFileCount } = prepareAppCopy(workDir);
    const nodeModulesSource = realpathSync(join(REPO_ROOT, "node_modules"));
    const nodeModulesTarget = join(appDir, "node_modules");
    const nmCopy = copyInstalledNodeModules(nodeModulesSource, nodeModulesTarget);
    result.isolation.sourceTreeSha256 = sourceTreeSha256;
    result.isolation.sourceFileCount = sourceFileCount;
    result.isolation.nodeModulesSource = {
      mode: "copied",
      from: nodeModulesSource,
      to: nodeModulesTarget,
      method: nmCopy.method,
      copyMs: nmCopy.copyMs,
    };
    result.environment.dependencyVersions = resolvedDependencyVersions(nodeModulesTarget);
    const nodeModulesLockPath = join(nodeModulesTarget, ".package-lock.json");
    const nodeModulesLockSha256 = existsSync(nodeModulesLockPath)
      ? sha256Hex(readFileSync(nodeModulesLockPath))
      : null;
    result.isolation.nodeModulesLockSha256 = nodeModulesLockSha256;
    result.environment.nodeModulesInstalledLockHash = nodeModulesLockSha256;

    // Native smoke: the real native bindings must load AND actually work
    // THROUGH the copy — better-sqlite3 instantiates a :memory: database,
    // writes and reads back, and closes; argon2 produces a real PHC digest.
    const smokeScript = [
      "const Database = require('better-sqlite3');",
      "const db = new Database(':memory:');",
      "db.pragma('journal_mode = WAL');",
      "db.exec('CREATE TABLE smoke (x INTEGER)');",
      "db.prepare('INSERT INTO smoke VALUES (?)').run(1);",
      "if (db.prepare('SELECT x FROM smoke').get().x !== 1) throw new Error('sqlite smoke query mismatch');",
      "db.close();",
      "const argon2 = require('@node-rs/argon2');",
      "if (!String(argon2.hashSync('chat-journey-native-smoke')).startsWith('$argon2')) throw new Error('argon2 smoke digest missing');",
      "process.stdout.write('native-ok');",
    ].join("\n");
    const smoke = spawnSync(process.execPath, ["-e", smokeScript], {
      cwd: appDir, encoding: "utf8", timeout: 30_000,
    });
    result.environment.nativeSmoke = {
      ok: smoke.status === 0 && (smoke.stdout || "").includes("native-ok"),
      detail: "better-sqlite3: :memory: instantiate + WAL pragma + write/read-back + close; @node-rs/argon2: real PHC hash",
      exitCode: smoke.status ?? null,
      stderr: (smoke.stderr || "").slice(0, 300),
    };
    if (!result.environment.nativeSmoke.ok) {
      throw new Error(`native binding smoke failed through the symlinked graph (cwd=${appDir}): exit ${smoke.status}`);
    }
    result.timings.copyMs = Date.now() - copyStart;

    // ---- Seed (existing fixture tooling: real migrations + crypto) ----
    const seedStart = Date.now();
    const seedRes = spawnSync(process.execPath, [FIXTURE_SCRIPT, "seed", dataDir], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: opts.seedTimeoutMs,
      // Scratch-scoped env hygiene: owned TMPDIR/HOME (never /tmp — it may be
      // nearly full), no ambient secrets.
      env: {
        PATH: process.env.PATH,
        HOME: join(workDir, "home"),
        TMPDIR: join(workDir, "tmp"),
      },
    });
    result.seed = {
      ok: seedRes.status === 0,
      exitCode: seedRes.status ?? null,
      signal: seedRes.signal ?? null,
      tool: "scripts/restore-fixture.mjs seed",
      env: { home: join(workDir, "home"), tmpdir: join(workDir, "tmp") },
      stderr: (seedRes.stderr || "").slice(0, 2000),
    };
    if (seedRes.status !== 0) {
      throw new Error(`fixture seed failed (exit ${seedRes.status}): ${(seedRes.stderr || seedRes.stdout || "").slice(0, 2000)}`);
    }
    result.timings.seedMs = Date.now() - seedStart;
    note("fixture seeded (real migrations/crypto)");

    // ---- Augmentation (before boot, scratch copy only) ----
    const augmentStart = Date.now();
    const augmentRes = spawnSync(
      process.execPath,
      ["--import", "tsx", "--conditions=react-server", augmentChildPath, dataDir, REPO_ROOT],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: opts.augmentTimeoutMs,
        env: {
          PATH: process.env.PATH,
          APP_ENCRYPTION_KEY: APP_ENCRYPTION_KEY_B64,
          HOME: join(workDir, "home"),
          TMPDIR: join(workDir, "tmp"),
        },
      }
    );
    let augmentReceipt = null;
    for (const line of (augmentRes.stdout || "").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{")) {
        try { augmentReceipt = JSON.parse(trimmed); } catch {}
      }
    }
    result.augmentation = {
      ok: augmentRes.status === 0 && augmentReceipt?.ok === true,
      exitCode: augmentRes.status ?? null,
      receipt: augmentReceipt,
      stderr: (augmentRes.stderr || "").slice(0, 2000),
      declaredWrites: [
        `api_keys/${AUGMENT_IDS.foreignReadKey} (encrypted foreign group chat key, real envelope)`,
        `groups/${AUGMENT_IDS.foreignGroup} (separate foreign group)`,
        `users/${AUGMENT_IDS.foreignUser} (foreign user, foreign group)`,
        `users/${AUGMENT_IDS.noGroupUser} (group-less user)`,
        `sessions/expired token ${AUGMENT_IDS.expiredToken} for ${FIXTURE_IDS.owner}`,
        `users/${FIXTURE_IDS.owner}.username -> ${UNICODE_OWNER_USERNAME} (unicode identity control)`,
      ],
    };
    if (!result.augmentation.ok) {
      throw new Error(`fixture augmentation failed (exit ${augmentRes.status}): ${(augmentRes.stderr || "").slice(0, 2000)}`);
    }
    result.timings.augmentMs = Date.now() - augmentStart;
    note("fixture augmented (foreign group/user, no-group user, expired token, unicode username)");

    // ---- Upstream ----
    upstream = await startUpstreamServer({ expectedPrefixes: opts.expectedUpstreamPaths });
    result.upstream = {
      url: upstream.url,
      requests: upstream.requests,
      unexpected: upstream.unexpected,
      expectedPaths: upstream.expectedPaths,
      handlerMode: "default",
      pendingReleased: null,
    };

    // ---- Freeze the start manifest AFTER all input preparation ----
    startedManifestRef.current = {
      files: hashTree(appDir).files,
      scenarioInputs: { ...scenarioInputHashes },
      lockfileSha256,
      packageJsonSha256,
      nodeModulesLockSha256,
      acceptedUncommittedInputs,
    };

    // ---- App boot (full mode only) ----
    if (opts.stopAfter !== "augment") {
      const port = await freePort();
      const base = `http://127.0.0.1:${port}`;
      const appEnv = buildAppEnv({ dataDir, backendUrl: upstream.url, workDir, tripwirePath });
      result.environment.appEnvKeys = Object.keys(appEnv).sort();
      const nextBin = join(appDir, "node_modules", "next", "dist", "bin", "next");
      const bootStart = Date.now();
      appChild = runner.spawnLogged(process.execPath, [nextBin, "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
        cwd: appDir,
        env: appEnv,
        logFile: join(workDir, "logs", "app-dev.log"),
      });
      appChild.on("exit", (code, signal) => {
        appExitInfo = { code, signal };
        if (!intentionalStop) unexpectedAppExit = appExitInfo;
      });
      let ready = false;
      let lastError = null;
      const deadline = Date.now() + opts.startupTimeoutMs;
      while (Date.now() < deadline) {
        if (appExitInfo) break;
        try {
          const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(4000) });
          if (res.ok) { ready = true; break; }
          lastError = `/api/config -> ${res.status}`;
        } catch (err) {
          lastError = err.message;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      result.app = {
        mode: "next dev (turbopack default)",
        base,
        pid: appChild.pid,
        ready,
        bootMs: Date.now() - bootStart,
        exitInfo: null,
        lastError,
      };
      if (!ready) {
        throw new Error(`next dev did not become ready within ${opts.startupTimeoutMs}ms (last: ${lastError ?? "none"}; exit: ${JSON.stringify(appExitInfo)}; log: ${join(workDir, "logs", "app-dev.log")})`);
      }
      note(`next dev ready at ${base} (${result.app.bootMs}ms)`);
    } else {
      result.app = { mode: "not-booted (stopAfter=augment probe)", base: null, ready: false };
    }
    result.environment.appRunner =
      "next dev (Turbopack default — the normal supported runner) against a private verbatim copy of the installed dependency graph inside the scratch app root; no registry check suppression, the tripwire stays strict. Fallback if an egress attempt still occurs: production next build + next start with the same private copy.";

    // ---- Run the lead's scenario ----
    const checksStart = Date.now();
    const ctx = {
      label: opts.label,
      baseUrl: result.app?.base ?? null,
      dataDir,
      workDir,
      appDir,
      ids: {
        ...FIXTURE_IDS,
        foreignGroup: AUGMENT_IDS.foreignGroup,
        foreignReadKey: AUGMENT_IDS.foreignReadKey,
        foreignUser: AUGMENT_IDS.foreignUser,
        noGroupUser: AUGMENT_IDS.noGroupUser,
        expiredSessionToken: AUGMENT_IDS.expiredToken,
      },
      users: {
        owner: { id: FIXTURE_IDS.owner, email: FIXTURE_EMAIL_OWNER, password: FIXTURE_USER_PASSWORD },
        member: { id: FIXTURE_IDS.member, email: FIXTURE_EMAIL_MEMBER, password: FIXTURE_USER_PASSWORD },
        foreign: { id: AUGMENT_IDS.foreignUser, email: AUGMENT_IDS.foreignEmail, password: AUGMENT_IDS.foreignPassword },
        noGroup: { id: AUGMENT_IDS.noGroupUser, email: AUGMENT_IDS.noGroupEmail, password: AUGMENT_IDS.noGroupPassword },
        superadmin: { email: FIXTURE_SUPERADMIN_EMAIL, password: FIXTURE_SUPERADMIN_PASSWORD },
      },
      checks: result.checks,
      check(id, ok, detail) {
        return recordCheck(id, ok, detail, "ctx.check");
      },
      app: result.app,
      environment: result.environment,
      upstream,
      requestTimeoutMs: opts.requestTimeoutMs,
      request,
    };

    function request(path, { method = "GET", cookie, body, headers, timeoutMs } = {}) {
      // Parent scenario egress control: same-origin paths on the loopback app
      // base only — absolute URLs and anything off-origin are refused.
      if (typeof path !== "string" || !path.startsWith("/") || path.includes("://")) {
        return Promise.reject(new UsageError(`request() only accepts same-origin paths starting with "/" on ${ctx.baseUrl}; got: ${path}`));
      }
      if (!ctx.baseUrl) {
        return Promise.reject(new UsageError("request() is unavailable: the app was not booted in this mode"));
      }
      const finalHeaders = { ...(headers ?? {}) };
      if (cookie !== undefined) finalHeaders.Cookie = cookie;
      let finalBody;
      if (body !== undefined) {
        if (!finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
          finalHeaders["Content-Type"] = "application/json";
        }
        finalBody = typeof body === "string" || body instanceof Buffer || body instanceof Uint8Array ? body : JSON.stringify(body);
      }
      return fetch(`${ctx.baseUrl}${path}`, {
        method,
        headers: finalHeaders,
        body: finalBody,
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs ?? opts.requestTimeoutMs),
      });
    }

    const returned = await runChecks(ctx);
    // Returned check rows are validated with the SAME strict schema as
    // ctx.check calls — malformed rows are recorded as failures, never
    // silently filtered.
    if (Array.isArray(returned)) {
      for (const row of returned) {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          recordCheck(row.id, row.ok, row.detail, "scenario return");
        } else {
          errors.push(`malformed scenario-returned check row (expected {id, ok:boolean, detail?}): ${JSON.stringify(row)?.slice(0, 200) ?? String(row)}`);
          result.checks.push({ id: `malformed-return-row#${result.checks.length}`, ok: false, detail: null, reason: "malformed scenario-returned check row" });
        }
      }
    } else if (returned !== undefined && returned !== null) {
      errors.push("scenario returned a non-array, non-null value (expected an optional array of check rows)");
    }
    result.timings.checksMs = Date.now() - checksStart;
  } catch (err) {
    errors.push(err && err.stack ? `${err.message}\n${err.stack.split("\n").slice(1, 4).join("\n")}` : String(err));
  }

  // Strict check schema: ok MUST be boolean (truthy strings/objects must not
  // pass), id MUST be a nonempty string, ids must be unique. Violations are
  // recorded as failed rows AND run errors, with the source named.
  function recordCheck(id, ok, detail, source) {
    if (typeof id !== "string" || id.trim() === "") {
      errors.push(`malformed check from ${source}: id must be a nonempty string (got ${id === null ? "null" : typeof id})`);
      result.checks.push({ id: `malformed-check-id#${result.checks.length}`, ok: false, detail: detail ?? null, reason: "malformed check id" });
      return false;
    }
    if (typeof ok !== "boolean") {
      errors.push(`malformed check "${id}" from ${source}: ok must be boolean (got ${typeof ok}); truthy values must not pass`);
      result.checks.push({ id: `rejected:${id}#${result.checks.length}`, ok: false, detail: detail ?? null, reason: `ok must be boolean (got ${typeof ok})` });
      return false;
    }
    if (result.checks.some((c) => c.id === id)) {
      errors.push(`duplicate check id "${id}" from ${source}`);
      result.checks.push({ id: `rejected:${id}#${result.checks.length}`, ok: false, detail: detail ?? null, reason: "duplicate check id" });
      return false;
    }
    result.checks.push({ id, ok, detail: detail ?? null });
    return ok;
  }

  // Evidence collection runs in the finalization path UNCONDITIONALLY — also
  // when the scenario callback threw, so the receipt always carries the tripwire
  // log, upstream records, and the frozen-manifest drift verdict.
  function collectRunEvidence() {
    if (upstream) {
      result.upstream.requests = [...upstream.requests];
      result.upstream.unexpected = [...upstream.unexpected];
      result.upstream.pendingReleased = upstream.pending.size === 0;
      result.upstream.handlerMode = upstream.handlerActive ? "custom" : "default";
      if (upstream.unexpected.length > 0) {
        errors.push(`unexpected upstream paths (${upstream.unexpected.length}): ${upstream.unexpected.map((u) => `${u.method} ${u.path}`).join("; ")}`);
      }
      if (upstream.pending.size > 0 && !errors.some((e) => e.startsWith("unreleased pending"))) {
        errors.push(`unreleased pending upstream responses: ${[...upstream.pending.keys()].join(", ")}`);
      }
    }
    if (result.workDir) {
      const tripwire = readTripwireLog(result.workDir);
      // Fail-closed: a missing or malformed tripwire log is never a
      // false-green "zero attempts" observation.
      result.isolation.networkTripwire = { attempts: tripwire.attempts, logOk: tripwire.ok, problem: tripwire.problem };
      if (!tripwire.ok) {
        errors.push(`fail-closed: ${tripwire.problem}`);
      } else if (tripwire.attempts.length > 0) {
        errors.push(`network tripwire blocked ${tripwire.attempts.length} non-loopback attempt(s)`);
      }
      const appDir = join(result.workDir, "app");
      const start = startedManifestRef.current;
      if (start && existsSync(appDir)) {
        // End manifest + drift (frozen inputs must be byte-identical at the
        // end). A Next dev rewrite of the COPIED tsconfig.json would surface
        // here as an explicit "changed" row — diagnose it as generated
        // configuration drift before ever relaxing the frozen-input assertion.
        const endFiles = hashTree(appDir).files;
        const endLockfile = sha256Hex(readFileSync(join(REPO_ROOT, "package-lock.json")));
        const endPackageJson = sha256Hex(readFileSync(join(REPO_ROOT, "package.json")));
        const endNmLockPath = join(appDir, "node_modules", ".package-lock.json");
        const endNmLock = existsSync(endNmLockPath) ? sha256Hex(readFileSync(endNmLockPath)) : null;
        const endScenario = {};
        for (const input of opts.scenarioInputs) {
          try { endScenario[input] = sha256Hex(readFileSync(input)); } catch {}
        }
        result.isolation.manifestEnd = {
          files: endFiles,
          scenarioInputs: endScenario,
          lockfileSha256: endLockfile,
          packageJsonSha256: endPackageJson,
          nodeModulesLockSha256: endNmLock,
        };
        const drift = compareManifests(start.files, endFiles);
        for (const input of opts.scenarioInputs) {
          if (start.scenarioInputs[input] !== endScenario[input]) {
            drift.push({ path: input, kind: "changed (scenario input)" });
          }
        }
        if (start.lockfileSha256 !== endLockfile) drift.push({ path: "package-lock.json (repo)", kind: "changed" });
        if (start.packageJsonSha256 !== endPackageJson) drift.push({ path: "package.json (repo)", kind: "changed" });
        if (start.nodeModulesLockSha256 !== undefined) {
          if (start.nodeModulesLockSha256 === null && endNmLock !== null) {
            drift.push({ path: "node_modules/.package-lock.json (copy)", kind: "added" });
          } else if (start.nodeModulesLockSha256 !== null && endNmLock === null) {
            drift.push({ path: "node_modules/.package-lock.json (copy)", kind: "removed" });
          } else if (start.nodeModulesLockSha256 !== null && endNmLock !== null && start.nodeModulesLockSha256 !== endNmLock) {
            drift.push({ path: "node_modules/.package-lock.json (copy)", kind: "changed" });
          }
        }
        const acceptedInputs = result.isolation?.acceptedUncommittedInputs ?? {};
        for (const [name, hash] of Object.entries(acceptedInputs)) {
          try {
            if (sha256Hex(readFileSync(join(REPO_ROOT, name))) !== hash) {
              drift.push({ path: name, kind: "changed (accepted uncommitted input)" });
            }
          } catch {}
        }
        result.isolation.drift = drift;
        if (drift.length > 0) {
          errors.push(`manifest drift detected on frozen inputs (${drift.length}): ${drift.slice(0, 10).map((d) => `${d.kind}:${d.path}`).join("; ")}`);
        }
        result.isolation.manifestStart = start;
      }
      result.isolation.git = { ...result.isolation.git, endHead: gitSnapshot(REPO_ROOT).head };
    }
    if (result.checks.length === 0) {
      errors.push("no checks were recorded by the scenario (a run with zero checks is never a pass)");
    }
    if (appChild && unexpectedAppExit) {
      errors.push(`app process exited during the scenario (code=${unexpectedAppExit.code}, signal=${unexpectedAppExit.signal})`);
    }
    if (result.app) result.app.exitInfo = appExitInfo;
  }

  // ---- Finalization: stop owned children, collect evidence, retain, remove ----
  // result.cleanup is assigned EARLY so the in-scratch results.json can never
  // claim a missing cleanup section; the FINAL result (with the cleanup
  // verdict and every late error) is written to the retained receipt AFTER
  // stop + copy/removal, and rewritten into kept scratch.
  const cleanup = { status: "ok", errors: [], scratchRemoved: false, retainedWorkDir: result.workDir ?? null, artifactsCopiedTo: null };
  result.cleanup = cleanup;
  try {
    const stopStart = Date.now();
    let stopExits = null;
    try {
      intentionalStop = true;
      stopExits = await runner.stopAll({ graceMs: opts.killGraceMs });
    } catch (stopErr) {
      runner.killAll();
      cleanup.errors.push(`process-group stop failed (SIGKILL issued): ${stopErr && stopErr.message ? stopErr.message : stopErr}`);
      cleanup.status = "failed";
    }
    if (appChild) {
      result.app.exitInfo = appExitInfo ?? { stopped: true, exits: stopExits };
    }
    result.timings.stopMs = Date.now() - stopStart;

    collectRunEvidence();

    if (upstream) {
      await upstream.close();
    }

    const logsDir = result.workDir ? join(result.workDir, "logs") : null;
    if (logsDir && !existsSync(logsDir)) {
      errors.push("evidence logs directory disappeared; recreated only to retain failure receipt");
      mkdirSync(logsDir, { recursive: true });
    }
    if (logsDir && existsSync(logsDir)) {
      // Keep a provisional structured verdict before artifact copy or removal;
      // the final receipt below adds the actual retention/removal outcome.
      writeFileSync(join(logsDir, "results.json"), JSON.stringify(finalize(), null, 2));
    }
    // Provenance artifacts beside the logs BEFORE the receipt copy.
    if (logsDir && existsSync(logsDir)) {
      for (const f of ["chat-journey-augment-child.mjs", "chat-journey-network-tripwire.cjs"]) {
        const src = join(result.workDir, f);
        if (existsSync(src)) {
          try { cpSync(src, join(logsDir, f)); } catch {}
        }
      }
    }
    let receiptDir = null;
    if (opts.outputDir && logsDir && existsSync(logsDir)) {
      try {
        mkdirSync(opts.outputDir, { recursive: true });
        receiptDir = join(opts.outputDir, `chat-journey-${opts.label}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
        cpSync(logsDir, receiptDir, { recursive: true });
        cleanup.artifactsCopiedTo = receiptDir;
      } catch (err) {
        cleanup.status = "failed";
        cleanup.errors.push(`artifact retention failed: ${err.message}`);
      }
    }

    // Removal decision from the run verdict (checks + evidence errors); the
    // cleanup verdict itself lands in the FINAL result below.
    const runVerdict = finalize();
    if (opts.outputDir && !cleanup.artifactsCopiedTo) {
      cleanup.status = "failed";
      cleanup.errors.push("required artifact retention did not produce a receipt directory");
    }
    if (runVerdict.ok && cleanup.status === "ok" && !!cleanup.artifactsCopiedTo && result.workDir) {
      try {
        // Removes the private copied app/dependency tree, scratch data,
        // home/tmp and logs — only after
        // the receipt was retained under outputDir.
        rmSync(result.workDir, { recursive: true, force: true });
        cleanup.scratchRemoved = true;
        cleanup.retainedWorkDir = null;
      } catch (err) {
        cleanup.status = "failed";
        cleanup.errors.push(`scratch removal failed: ${err.message}`);
      }
    } else if (!runVerdict.ok) {
      cleanup.status = "retained-on-failure";
    } else if (!opts.outputDir) {
      cleanup.status = "retained-no-output-dir";
    }
    if (cleanup.status !== "ok") {
      errors.push(`cleanup: ${cleanup.status}${cleanup.errors.length ? ` — ${cleanup.errors.join("; ")}` : ""}`);
    }

    // The retained receipt must carry the FINAL verdict (incl. cleanup).
    const finalResult = finalize();
    if (cleanup.artifactsCopiedTo) {
      try {
        writeFileSync(join(cleanup.artifactsCopiedTo, "results.json"), JSON.stringify(finalResult, null, 2));
      } catch (err) {
        cleanup.status = "failed";
        cleanup.errors.push(`retained results.json write failed: ${err.message}`);
        errors.push(`cleanup: retained results.json write failed: ${err.message}`);
      }
    }
    if (!cleanup.scratchRemoved && logsDir && existsSync(logsDir)) {
      try {
        writeFileSync(join(logsDir, "results.json"), JSON.stringify(finalResult, null, 2));
      } catch {}
    }
    return finalize();
  } catch (err) {
    errors.push(`finalization/cleanup failed: ${err && err.message ? err.message : String(err)}`);
    cleanup.status = "failed";
    cleanup.errors.push(String(err && err.message ? err.message : err));
    result.cleanup = cleanup;
    return finalize();
  }
}

// (removed: the symlinked node_modules mode was replaced by a private
// verbatim copy — see copyInstalledNodeModules)
