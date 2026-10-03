#!/usr/bin/env node
// Isolated consumer check for a RESTORED cortex-chat state fixture.
//
//   node scripts/restore-consumer.mjs --state-dir <restored-fixture-copy>
//       [--backend-url <url>] [--work-dir <dir>]
//       [--build-timeout <ms>] [--startup-timeout <ms>] [--request-timeout <ms>]
//       [--keep-work-dir] [--gate-only]
//
// Runs the REAL Next application (production build + `next start`) from a
// throwaway source copy in a scratch work directory, against a COPY of an
// actually restored fixture state (SQLite + avatars + branding at the real
// volume-root layout). The state source is never written by the app.
//
// Scope (companion to scripts/restore-fixture.mjs and the qa/restore storage
// rehearsal): proves the restored chat state is consumable by the real app —
// password login mints a fresh session, authorized routes serve the restored
// messages/opaque memory, restored avatar/branding bytes are served by the
// actual HTTP routes, the group chat key decrypts and is injected upstream,
// and the negative controls (wrong password, foreign/private chat access,
// missing avatar bytes on the actual route, unauthenticated access, proxy
// allowlist) behave. This is an HTTP-route journey, NOT a browser journey and
// NOT upstream content proof: no LLM/model request is exercised.
//
// App runtime (--app-node): the local Node 22 build of the unchanged app
// fails prerendering /_global-error (cause unknown — see the record); the
// production builder stage is node:20. `--app-node <absolute node binary>`
// (default: the current process.execPath) selects the node binary used ONLY
// for the child `next build`/`next start` processes; the parent script and
// the fixture verifier keep the existing Node + native bindings. The app's
// dependencies always come from a LOCKED ISOLATED INSTALL in the scratch
// work copy (package.json + package-lock.json copied verbatim, installed via
// the chosen node's npm CLI with a bounded timer) so the runtime, the native
// ABI and the lockfile agree; the repository's node_modules is never reused
// for the app and never mutated. Package downloads (registry) are allowed;
// no model/LLM call is involved. Platform/libc note: a host Node 20 binary
// is glibc (Debian bookworm) — the isolated install fetches the matching
// glibc native bindings, which is NOT the musl/alpine production artifact;
// that limitation is explicit in the receipt. --app-node with --gate-only
// only validates the path (no install, no probe).
//
// Gates before anything is copied or booted: the state source must carry the
// fixture sentinel (validated against this script's independently derived
// fixture constants — never target-supplied values), the synthetic fx-* IDs
// must be present in the database, the set must be quiesced (no WAL/SHM), and
// the full real verifier (scripts/restore-fixture.mjs verify) must pass
// against the source. A canary-carrying or otherwise divergent "restore" is
// refused before boot.
//
// Declared runtime writes (the app's own boot + this consumer's logins, on the
// COPY only — every other byte of the seeded fixture state must survive
// byte-identically, proven by a pre/post row-snapshot diff on the copy):
// superadmin user insert from synthetic env, builtin soul rows
// (insert-if-missing), the defaultGroupProvisioned adoption marker (existing
// group adopted — no backend key mint), session/login_events/usage_events rows
// from the consumer's own logins, users.lastLoginAt updates, session
// last_seen touches, and one scratch private chat row used for the
// foreign-access negative control.
//
// Upstream: CORTEX_API_URL either points at an orchestrator-provided ISOLATED
// loopback backend (--backend-url, with --backend-admin-key provided by the
// backend runner and --document-file carrying the independent app/oracle v2
// citation snapshot) or at an in-process loopback sink (default). The two
// modes are NOT equivalent and are labeled as such:
// - loopback-sink: observes the proxy's X-API-Key injection (proof the
//   restored encrypted group key decrypts) and returns 404 — no upstream
//   content proof, sink/advisory only.
// - isolated-backend: a REQUIRED gate, not advisory — the proxy response must
//   be HTTP 200 listing the permitted collection fx-collection-0001 with the
//   off-scope col-crr-2 absent, and the citation content gate must pass: the
//   document id is DERIVED from the restored chat message's source metadata
//   (public Source shape, asserted) and GET /api/proxy/api/documents/
//   {document_id}/content must return the document identity with nonempty
//   chunks whose chunk_index-sorted "\n\n"-join (exactly the UI's rule in
//   SourceModal.tsx) equals the UTF-8 text of the independent --document-file
//   app/oracle v2 snapshot (full_content, if present, must equal it too).
//   ACCEPTANCE CORRECTION (lead, 2026-10-01): the earlier /file byte gate was
//   a BAD ORACLE — the chat proxy allowlist intentionally permits
//   /documents/{id}/content, NOT /file (the authenticated /file 404 is kept
//   as a permission-boundary negative control; the raw-file byte gate belongs
//   to the backend side). This proves the restored encrypted read key is
//   ACCEPTED by the real backend. No search/model/LLM claim is made here.
// Non-loopback or remote --backend-url values are rejected outright (exit 2,
// no fallback, no .env read): no live-instance ambiguity.
//
// Env hygiene: app processes get an explicit env allowlist only (no ambient
// credentials; HOME/TMPDIR redirected into the work dir); SENTRY_DISABLED=1,
// NEXT_PUBLIC_SENTRY_DISABLED=1, NEXT_TELEMETRY_DISABLED=1; SMTP/OIDC/VOICE/
// DEMO unset. A network tripwire is injected into every app/build node
// process (NODE_OPTIONS --require) that records and BLOCKS any non-loopback
// connection attempt (model/auth/telemetry egress would be blocked here) and
// fails the gate when one occurs. All binds are 127.0.0.1 on ephemeral ports.
// Exit: 0 success, 1 failure, 2 usage. The result JSON (single object) is
// printed on stdout; progress goes to stderr. On success the work directory
// is removed; on failure it is kept and its path reported. Only this run's
// processes and scratch files are cleaned up; the state source and the
// repository are never modified.

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
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(SCRIPT_PATH));
const VERIFIER = join(REPO_ROOT, "scripts", "restore-fixture.mjs");
const SENTINEL_NAME = "restore-fixture.sentinel.json";
const SESSION_COOKIE = "cortex_session";
const SCRATCH_CHAT_TITLE = "restore-consumer-scratch-private-chat";
// Per-app-runtime paths are resolved from the ISOLATED INSTALL inside the
// work copy (never the repository's node_modules): the app/build children run
// under the --app-node binary with dependencies matching that runtime and the
// committed lockfile. The parent process and the fixture verifier keep using
// the repository's existing Node + native bindings.

// ---- Fixture constants (independently derived, mirroring the frozen fixture
// the same way tests/restore-fixture.test.ts does — this gate never trusts the
// sentinel or the fixture script for its expectations) ------------------------

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const FIXTURE_VERSION = 2; // fixture pack v2: full public-Source citation metadata
const SOURCE_SID = "fx-source-0001";
const SOURCE_DOCUMENT_ID = "fx-source-0001"; // == sid: one authoritative id
const SOURCE_CHUNK_ID = "fx-source-0001-chunk-0";
const SOURCE_FILENAME = "fixture-source.md";
const SOURCE_SCORE = 0.42;
// Accepted MAIN producer text (cortex-app source oracle ~1565-71): ONE
// markdown chunk, quoted verbatim — the chat fixture and these mirrors pin it.
const SOURCE_CHUNK_0 =
  "Fixture Source content for the disposable restore rehearsal.\n" +
  "It's a \"test\" with escaping: back\\slash and 'quotes'.\n" +
  "The fixture graph cites this document as fx-source-0001 (Fixture Source).\n" +
  "Mentions Rehearsal Alpha and Rehearsal Beta for graph linkage.\n";
const SOURCE_CONTENT_PROXY = (documentId) => `/api/proxy/api/documents/${documentId}/content`;
const SOURCE_FILE_PROXY_PATH = `/api/proxy/api/documents/${SOURCE_DOCUMENT_ID}/file`; // unsupported: permission-boundary negative control
const INTERNAL_KEY = Buffer.alloc(32);
Buffer.from("synthetic-restore-fixture-key", "utf8").copy(INTERNAL_KEY);
const APP_ENCRYPTION_KEY_B64 = INTERNAL_KEY.toString("base64");
const KEY_FINGERPRINT = sha256Hex(INTERNAL_KEY);
const USER_PASSWORD = "fx-correct-horse-battery-staple";
const SUPERADMIN_EMAIL = "fixture-superadmin@example.invalid";
const SUPERADMIN_PASSWORD = "fx-superadmin-password-0001";
const BACKEND_ADMIN_API_KEY_DEFAULT = "fx-synthetic-admin-key-0001";
const READ_KEY_PLAINTEXT = "fx-synthetic-backend-read-key-0001";
const PERMITTED_COLLECTION = "fx-collection-0001";
const OFF_SCOPE_COLLECTION = "col-crr-2";
const MEMORY_BLOB = { conversation_memory: "fx-opaque-blob-v1", turns: 2 };

const IDS = {
  readKey: "fx-key-read-0001",
  group: "fx-group-0001",
  user1: "fx-user-0001",
  user2: "fx-user-0002",
  soul: "fx-soul-0001",
  project: "fx-project-0001",
  chat: "fx-chat-0001",
};

const FIXTURE_EMAIL1 = "fixture-user-0001@example.invalid";
const FIXTURE_EMAIL2 = "fixture-user-0002@example.invalid";
const AVATAR_NAME = "fx-user-0001.png";

const AVATAR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const BRANDING_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64"
);
const AVATAR_SHA = sha256Hex(AVATAR_PNG);
const BRANDING_SHA = sha256Hex(BRANDING_PNG);

const MESSAGE_EXPECTATIONS = [
  { id: "fx-msg-0001", role: "user", content: "What is stored in this fixture?", authorId: IDS.user1 },
  { id: "fx-msg-0002", role: "assistant", content: "Synthetic fixture answer citing fx-source-0001.", authorId: null, sourceSid: "fx-source-0001" },
  { id: "fx-msg-0003", role: "user", content: "Follow-up about the fixture.", authorId: IDS.user1 },
  { id: "fx-msg-0004", role: "assistant", content: "Synthetic follow-up answer with late memory.", authorId: null },
];

const BUILTIN_SOUL_KEYS = ["research-analyst", "support-writer", "sales-companion"];

// Declared runtime writes (compared against the observed post-run delta).
const DECLARED_BOOT_WRITES = [
  "superadmin user row inserted from synthetic env (bootstrapSuperadmin)",
  "3 builtin soul rows inserted insert-if-missing (seedBuiltinSouls: research-analyst, support-writer, sales-companion)",
  "app_settings.defaultGroupProvisioned = '1' (existing group adopted, no backend key mint)",
  "1 fresh session row + 1 login_events row + 1 usage_events(login) row per successful consumer login",
  "1 failed login_events row per rejected consumer login attempt",
  "users.lastLoginAt updated for fixture users that logged in",
  "sessions.last_seen_at touched for consumer-minted sessions (getAuth)",
  `1 scratch private chat row ("${SCRATCH_CHAT_TITLE}") for the foreign-access negative control (healthy instance only)`,
];

// ---- CLI --------------------------------------------------------------------

const USAGE = `usage:
  node scripts/restore-consumer.mjs --state-dir <restored-fixture-copy>
      [--app-node <absolute node binary>] [--backend-url <loopback-url>]
      [--backend-admin-key <synthetic-key>] [--document-file <fixture-snapshot>]
      [--work-dir <dir>] [--install-timeout <ms>]
      [--build-timeout <ms>] [--startup-timeout <ms>] [--request-timeout <ms>]
      [--keep-work-dir] [--gate-only]

--state-dir (required): directory holding the RESTORED fixture state
  (cortex-chat.db + avatars/ + branding/ + ${SENTINEL_NAME}).
--app-node: absolute path to the node binary used ONLY for the child
  'next build'/'next start' processes (default: process.execPath, i.e. the
  node running this script). The parent script and the fixture verifier keep
  the existing node + native bindings. Dependencies ALWAYS come from a locked
  isolated install inside the work copy (committed package.json +
  package-lock.json, installed with the chosen node's npm CLI, bounded
  timer) — the repository node_modules is never reused for the app nor
  mutated. With --gate-only the path is merely validated (no install).
--backend-url: ISOLATED loopback Cortex backend base URL for CORTEX_API_URL
  (http://127.0.0.1/, http://[::1]/ or http://localhost/ only; remote targets
  are rejected without fallback). Turns on the REQUIRED real-backend gate:
  /api/proxy/api/collections -> 200 listing ${PERMITTED_COLLECTION} with
  ${OFF_SCOPE_COLLECTION} absent, and the citation content gate
  /api/proxy/api/documents/{document_id}/content (document_id DERIVED from
  the restored chat citation metadata) -> 200 whose chunk_index-sorted
  "\n\n"-joined content EXACTLY equals the UTF-8 text of --document-file
  (independent app/oracle v2 fixture snapshot; full_content, if present,
  must equal it). The authenticated unsupported /documents/{id}/file route
  must 404 without reaching the upstream (permission boundary; the raw-file
  byte gate belongs to the backend side). Not sink/advisory. Default: an
  in-process loopback sink (records proxied requests, replies 404) —
  decryption/injection proof only, NO upstream content proof.
--backend-admin-key: synthetic backend admin key for boot config alignment,
  provided by the backend runner (qa/restore/backend-consumer.py registers
  the fixture key/collections/documents under it). Default:
  ${BACKEND_ADMIN_API_KEY_DEFAULT} (sink mode).
--document-file: required with --backend-url; the independent app/oracle v2
  citation snapshot as UTF-8 text (nonempty, carries the stable sid
  ${SOURCE_SID}).
--work-dir: scratch directory for the source copy, install, build and state
  copy. Default: a unique temp dir (existing failure logs are never
  overwritten — an existing non-empty --work-dir is refused). Removed on
  success; kept on failure or with --keep-work-dir.
--install-timeout: bounded timer for the isolated npm install (ms; default
  600000). A failed/timed-out install is a failure receipt, never green.
--gate-only: run only the pre-boot state gates (sentinel/synthetic IDs/
  quiesce/real verifier) and report; no copy, no install, no build, no boot.

Prints one result JSON object on stdout. Exit: 0 success, 1 failure, 2 usage.`;

function parseArgs(argv) {
  const out = { stateDir: null, appNode: null, backendUrl: null, backendAdminKey: null, documentFile: null, workDir: null, keepWorkDir: false, gateOnly: false };
  const timeoutFlags = {
    "--install-timeout": 600_000,
    "--build-timeout": 600_000,
    "--startup-timeout": 180_000,
    "--request-timeout": 30_000,
  };
  const timeouts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--state-dir") out.stateDir = argv[++i];
    else if (a === "--app-node") out.appNode = argv[++i];
    else if (a === "--backend-url") out.backendUrl = argv[++i];
    else if (a === "--backend-admin-key") out.backendAdminKey = argv[++i];
    else if (a === "--document-file") out.documentFile = argv[++i];
    else if (a === "--work-dir") out.workDir = argv[++i];
    else if (a === "--keep-work-dir") out.keepWorkDir = true;
    else if (a === "--gate-only") out.gateOnly = true;
    else if (a in timeoutFlags) timeouts[a] = Number(argv[++i]);
    else return { error: `unknown argument: ${a}` };
    if (out.stateDir === undefined || out.appNode === undefined || out.backendUrl === undefined ||
        out.backendAdminKey === undefined || out.documentFile === undefined || out.workDir === undefined ||
        (a in timeoutFlags && (!Number.isFinite(timeouts[a]) || timeouts[a] <= 0))) {
      return { error: `missing or invalid value for ${a}` };
    }
  }
  if (!out.stateDir) return { error: "--state-dir is required" };
  if (out.appNode) {
    if (!isAbsolute(out.appNode)) {
      return { error: `--app-node must be an absolute path to a node binary: ${out.appNode}` };
    }
    if (!existsSync(out.appNode) || !statSync(out.appNode).isFile()) {
      return { error: `--app-node does not exist or is not a file: ${out.appNode}` };
    }
  }
  // A supplied backend must be an EXACT isolated loopback target: no remote
  // or live ambiguity is ever consumed, and no .env is read for it.
  if (out.backendUrl) {
    let parsedUrl = null;
    try { parsedUrl = new URL(out.backendUrl); } catch {}
    const loopbackHosts = new Set(["127.0.0.1", "[::1]", "::1", "localhost"]);
    const host = (parsedUrl?.hostname ?? "").toLowerCase();
    if (!parsedUrl || parsedUrl.protocol !== "http:" || !loopbackHosts.has(host)) {
      return {
        error: `--backend-url must be an exact isolated loopback http URL (127.0.0.1/::1/localhost); remote or non-loopback targets are rejected without fallback: ${out.backendUrl}`,
      };
    }
    if (!out.documentFile) {
      return {
        error: "--document-file is required with --backend-url: the isolated-backend gate includes the real citation-file byte comparison against the independent app/oracle fixture snapshot",
      };
    }
    if (!existsSync(out.documentFile)) {
      return { error: `--document-file does not exist: ${out.documentFile}` };
    }
    if (statSync(out.documentFile).size === 0) {
      return { error: `--document-file is empty (a nonempty fixture snapshot is required): ${out.documentFile}` };
    }
    if (!readFileSync(out.documentFile).includes("fx-source-0001")) {
      return {
        error: `--document-file does not carry the stable source sid fx-source-0001 — it is not the coordinated app/oracle v2 snapshot: ${out.documentFile}`,
      };
    }
  }
  for (const [flag, def] of Object.entries(timeoutFlags)) {
    timeouts[flag] = timeouts[flag] ?? def;
  }
  out.installTimeout = timeouts["--install-timeout"];
  out.buildTimeout = timeouts["--build-timeout"];
  out.startupTimeout = timeouts["--startup-timeout"];
  out.requestTimeout = timeouts["--request-timeout"];
  return { args: out };
}

// ---- Output -------------------------------------------------------------------

function note(msg) {
  process.stderr.write(`[restore-consumer] ${msg}\n`);
}

function emit(result, code) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(code);
}

class ConsumerFailure extends Error {}

// ---- State gates (before any copy/boot) ---------------------------------------

function checkQuiescedAndIds(stateDir) {
  const dbPath = join(stateDir, "cortex-chat.db");
  const refusals = [];
  const preExistingSidecars = new Set(
    ["-wal", "-shm"].filter((s) => existsSync(dbPath + s))
  );
  for (const s of preExistingSidecars) {
    refusals.push(`quiesce(cortex-chat.db${s}): journal file present at the source — a live or non-quiesced set is not a valid consumer input`);
  }
  if (!existsSync(dbPath)) {
    refusals.push("fixture database missing: cortex-chat.db");
  }
  const sentinelPath = join(stateDir, SENTINEL_NAME);
  if (!existsSync(sentinelPath)) {
    refusals.push(`fixture sentinel missing: ${SENTINEL_NAME} (run seed / restore first)`);
  }
  let sentinel = null;
  if (existsSync(sentinelPath)) {
    try {
      sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
    } catch (err) {
      refusals.push(`fixture sentinel unreadable: ${err.message}`);
    }
  }
  if (sentinel) {
    if (sentinel.kind !== "cortex-chat-restore-fixture" || sentinel.fixtureVersion !== FIXTURE_VERSION) {
      refusals.push("fixture sentinel kind/version mismatch — not a fixture of this version");
    } else if (sentinel.keyFingerprint !== KEY_FINGERPRINT) {
      refusals.push("fixture sentinel key fingerprint does not match this script's independently derived fixture key");
    }
  }
  if (refusals.length === 0 && existsSync(dbPath)) {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    let sqlite = null;
    try {
      sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
      const present = (sql, ...params) => sqlite.prepare(sql).get(...params) !== undefined;
      const idChecks = [
        ["users", IDS.user1], ["users", IDS.user2],
        ["groups", IDS.group],
        ["api_keys", IDS.readKey], ["api_keys", "fx-key-content-0002"],
        ["chat_sessions", IDS.chat],
        ...["fx-msg-0001", "fx-msg-0002", "fx-msg-0003", "fx-msg-0004"].map((id) => ["chat_messages", id]),
      ];
      for (const [table, id] of idChecks) {
        if (!present(`SELECT id FROM ${table} WHERE id = ?`, id)) {
          refusals.push(`synthetic IDs: expected fixture row ${id} missing from ${table}`);
        }
      }
    } catch (err) {
      refusals.push(`internal: cannot read database for the synthetic-ID gate: ${err.message}`);
    } finally {
      if (sqlite) {
        try { sqlite.close(); } catch {}
        // The read-only open transiently creates empty sidecars on a quiesced
        // source; only those (never a pre-existing journal) are removed so the
        // source file set is left exactly as found.
        for (const s of ["-wal", "-shm"]) {
          if (!preExistingSidecars.has(s)) {
            try { rmSync(dbPath + s, { force: true }); } catch {}
          }
        }
      }
    }
  }
  return refusals;
}

function runRealVerifier(stateDir) {
  const res = spawnSync(process.execPath, [VERIFIER, "verify", resolve(stateDir)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  let parsed = null;
  for (const line of (res.stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try { parsed = JSON.parse(trimmed); } catch {}
    }
  }
  if (res.error) {
    return { ok: false, error: `verifier could not be executed: ${res.error.message}` };
  }
  if (res.status !== 0 || !parsed || parsed.ok !== true) {
    return {
      ok: false,
      verifierExit: res.status ?? null,
      verifierResult: parsed,
      stderr: (res.stderr || "").slice(0, 2000),
    };
  }
  return { ok: true, verifierResult: parsed };
}

function hashStateDir(stateDir) {
  const map = {};
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.isFile()) map[rel] = sha256Hex(readFileSync(join(dir, entry.name)));
    }
  };
  walk(stateDir, "");
  return map;
}

// ---- Work directory: state copy + allowlisted source copy ----------------------

function copyDirFiltered(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyDirFiltered(from, to);
    else if (entry.isFile()) cpSync(from, to, { preserveTimestamps: true });
  }
}

function prepareWorkDir(stateDir, requestedWorkDir) {
  const workDir = requestedWorkDir
    ? resolve(requestedWorkDir)
    : mkdtempSync(join(tmpdir(), "restore-consumer-"));
  if (existsSync(workDir) && readdirSync(workDir).length > 0) {
    return { error: `--work-dir must be empty or non-existent (existing evidence/logs are never overwritten): ${workDir}` };
  }
  mkdirSync(workDir, { recursive: true });
  for (const sub of ["home", "tmp", "logs"]) mkdirSync(join(workDir, sub), { recursive: true });

  // Copy of the restored state — the app only ever sees this copy.
  cpSync(stateDir, join(workDir, "data"), { recursive: true, preserveTimestamps: true });

  // Allowlisted source copy: exact config + src + public inputs; excluded:
  // .env*, .next, data, node_modules, .git, docs, scripts. Symlinks are never
  // materialized into the app source copy (recorded if encountered).
  const appDir = join(workDir, "app");
  const copiedFiles = [];
  const symlinksSkipped = [];
  const collectSymlinks = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) symlinksSkipped.push(rel);
      else if (entry.isDirectory()) collectSymlinks(join(dir, entry.name), rel);
    }
  };
  for (const f of ["next.config.ts", "tsconfig.json", "postcss.config.mjs"]) {
    cpSync(join(REPO_ROOT, f), join(appDir, f), { preserveTimestamps: true });
    copiedFiles.push(f);
  }
  // The lockfile manifests travel with the source copy: the isolated install
  // in the work copy is locked to the committed dependency graph.
  for (const f of ["package.json", "package-lock.json"]) {
    const src = join(REPO_ROOT, f);
    if (!existsSync(src)) return { error: `required manifest missing from the repository: ${f}` };
    cpSync(src, join(appDir, f), { preserveTimestamps: true });
    copiedFiles.push(f);
  }
  copyDirFiltered(join(REPO_ROOT, "src"), join(appDir, "src"));
  copiedFiles.push("src/**");
  collectSymlinks(join(REPO_ROOT, "src"), "src");
  copyDirFiltered(join(REPO_ROOT, "public"), join(appDir, "public"));
  copiedFiles.push("public/**");
  collectSymlinks(join(REPO_ROOT, "public"), "public");
  if (symlinksSkipped.length > 0) {
    return { error: `symlinks found in the app source inputs (never materialized into the copy): ${symlinksSkipped.join(", ")}` };
  }

  // Receipt digest over the copied source tree (sorted rel paths + content
  // hashes, node_modules excluded — it does not exist here yet) to identify
  // the exact source the compiled artifact was built from.
  const sourceTree = {};
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.isFile()) sourceTree[rel] = sha256Hex(readFileSync(join(dir, entry.name)));
    }
  };
  walk(appDir, "");
  const sourceTreeSha256 = sha256Hex(
    Buffer.from(Object.keys(sourceTree).sort().map((k) => `${k}:${sourceTree[k]}`).join("\n"), "utf8")
  );

  return {
    workDir, appDir, dataDir: join(workDir, "data"),
    copiedFiles, sourceTreeSha256, sourceFileCount: Object.keys(sourceTree).length,
  };
}

// ---- Isolated locked install (app-runtime dependencies) ----------------------
// Runs `node <appNode> <npm-cli.js> ci` inside the work-copy appDir using the
// copied package.json + package-lock.json. No repository node_modules reuse,
// no token inheritance (env allowlist: PATH with the app node first, fresh
// HOME/TMPDIR), bounded timer. Package downloads (registry) are allowed;
// failing or timing out is a failure receipt, never green.

function resolveNpmCli(appNode) {
  const candidates = [];
  try {
    const real = realpathSync(appNode);
    const prefix = dirname(dirname(real)); // <prefix>/bin/node -> <prefix>
    candidates.push(join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  } catch {}
  try {
    const real = realpathSync(process.execPath);
    const prefix = dirname(dirname(real));
    candidates.push(join(prefix, "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  } catch {}
  try { candidates.push(require.resolve("npm/bin/npm-cli.js", { paths: [REPO_ROOT] })); } catch {}
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

function probeNodeVersion(appNode) {
  const res = spawnSync(appNode, ["--version"], { encoding: "utf8", timeout: 15_000 });
  const version = (res.stdout || "").trim();
  if (res.status !== 0 || !version.startsWith("v")) {
    return { error: `--app-node is not a working node binary (${appNode}): exit ${res.status}, out=${version || "none"}, err=${(res.stderr || "").slice(0, 200)}` };
  }
  return { version };
}

async function runAppInstall({ appDir, appNode, appNodeVersion, workDir, installTimeoutMs }) {
  const npmCli = resolveNpmCli(appNode);
  if (!npmCli) {
    return {
      ok: false,
      node: { path: appNode, version: appNodeVersion },
      error: `npm CLI not found for the app node (${appNode}) or the parent node — cannot run the locked isolated install`,
    };
  }
  const logPath = join(workDir, "logs", "app-install.log");
  const child = spawnLogged(appNode, [
    npmCli, "ci", "--no-audit", "--no-fund", "--loglevel=warn",
  ], {
    cwd: appDir,
    // Token hygiene: allowlist env only — no inherited npm/auth tokens; the
    // app node binary leads PATH so install lifecycle scripts (native
    // binding resolution) run under the app runtime's ABI.
    env: {
      PATH: `${dirname(appNode)}:${process.env.PATH ?? ""}`,
      HOME: join(workDir, "home"),
      TMPDIR: join(workDir, "tmp"),
    },
    logFile: logPath,
  });
  const startedAt = Date.now();
  const exit = await waitForExit(child, installTimeoutMs);
  const receipt = {
    ok: exit.code === 0 && !exit.timedOut && !exit.error,
    node: { path: appNode, version: appNodeVersion },
    npmCli,
    installDir: appDir,
    installMs: Date.now() - startedAt,
    exitCode: exit.code ?? null,
    timedOut: !!exit.timedOut,
    error: exit.error ?? null,
    logPath,
    note: "locked isolated install from the copied package.json + package-lock.json (registry downloads allowed; no token inheritance; repository node_modules untouched)",
  };
  if (!receipt.ok) {
    receipt.error = receipt.error || `npm ci failed (exit ${exit.code}${exit.timedOut ? ", timed out" : ""}); log: ${logPath}`;
    return receipt;
  }
  // Actual dependency versions from the installed tree — cited, not assumed.
  const actualVersions = {};
  for (const name of ["next", "react", "react-dom", "@sentry/nextjs", "better-sqlite3"]) {
    try {
      actualVersions[name] = JSON.parse(readFileSync(join(appDir, "node_modules", ...name.split("/"), "package.json"), "utf8")).version;
    } catch {
      actualVersions[name] = null;
    }
  }
  receipt.actualVersions = actualVersions;
  // Native binding smoke: the installed better-sqlite3 must load under the
  // app node (ABI agreement between runtime, lockfile install and libc).
  const smoke = spawnSync(appNode, ["-e", "require('better-sqlite3'); process.stdout.write('binding-ok')"], {
    cwd: appDir, encoding: "utf8", timeout: 30_000,
  });
  receipt.nativeBindingSmoke = {
    ok: smoke.status === 0 && (smoke.stdout || "").includes("binding-ok"),
    exitCode: smoke.status ?? null,
    stderr: (smoke.stderr || "").slice(0, 300),
  };
  if (!receipt.nativeBindingSmoke.ok) {
    receipt.ok = false;
    receipt.error = `better-sqlite3 native binding does not load under ${appNode} (${appNodeVersion}) — runtime/ABI mismatch; log: ${logPath}`;
  }
  return receipt;
}

// ---- Process handling -----------------------------------------------------------

const children = [];

function spawnLogged(cmd, args, { cwd, env, logFile }) {
  const fs = require("node:fs");
  const out = fs.openSync(logFile, "a");
  const err = fs.openSync(logFile, "a");
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", out, err] });
  children.push(child);
  return child;
}

function killAll() {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      try { child.kill("SIGKILL"); } catch {}
    }
  }
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolvePromise) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      try { child.kill("SIGKILL"); } catch {}
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

// ---- Env allowlist ---------------------------------------------------------------

function appEnv({ dataDir, backendUrl, backendAdminKey, workDir, tripwirePath }) {
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    DATABASE_PATH: join(dataDir, "cortex-chat.db"),
    APP_ENCRYPTION_KEY: APP_ENCRYPTION_KEY_B64,
    BACKEND_ADMIN_API_KEY: backendAdminKey,
    SUPERADMIN_EMAIL,
    SUPERADMIN_PASSWORD,
    CORTEX_API_URL: backendUrl,
    SENTRY_DISABLED: "1",
    NEXT_PUBLIC_SENTRY_DISABLED: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    // SMTP/OIDC/VOICE/DEMO and every other ambient variable are deliberately
    // absent: feature gates stay off, no service is configured, no ambient
    // credential can leak in.
  };
  if (workDir) {
    // Scratch home/tmp: no shared tree, no shared temp paths with other
    // writers; the app processes can only write inside the work dir.
    env.HOME = join(workDir, "home");
    env.TMPDIR = join(workDir, "tmp");
  }
  if (tripwirePath) {
    env.NODE_OPTIONS = `--require ${tripwirePath}`;
    env.TRIPWIRE_LOG = join(workDir, "logs", "network-tripwire.jsonl");
  }
  return env;
}

// ---- Network tripwire (injected into every app/build node process) ----------
// Blocks and records any non-loopback outbound connection attempt (model,
// auth, telemetry, font or any other egress) from the actual Next processes.
// Loopback is allowed (the sink/backend/app all bind 127.0.0.1); every block
// is appended to a JSONL log that is checked after the run and fails the gate.

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
      // Callback shapes: (err, address, family), (err, [{address, family}])
      // for {all:true}, or (err, [addresses]) variants.
      let first = rest[0];
      if (Array.isArray(first) && first.length > 0 && typeof first[0] === "object" && first[0] !== null) {
        first = first.map((a) => a.address);
      }
      const addresses = Array.isArray(first) ? first.flat() : [first];
      const allLoopback = addresses.every((a) => isLoopbackIp(a) || a === null || a === undefined);
      if (!allLoopback) {
        record({ kind: "dns", host: hostname, resolved: addresses, blocked: true, reason: "non-loopback resolution" });
        err = new Error("restore-consumer network tripwire: non-loopback DNS resolution blocked: " + hostname);
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
    const err = new Error("restore-consumer network tripwire: non-loopback connection blocked: " + host);
    err.code = "ETRIPWIRE";
    throw err;
  }
  return origConnect.apply(this, args);
};
`;

function writeTripwire(workDir) {
  const tripwirePath = join(workDir, "network-tripwire.cjs");
  writeFileSync(tripwirePath, TRIPWIRE_SOURCE);
  // The JSONL log exists from the start: a run with zero blocked attempts is
  // "clean" because the log exists and is empty, not because it is missing.
  writeFileSync(join(workDir, "logs", "network-tripwire.jsonl"), "");
  return tripwirePath;
}

function readTripwireLog(workDir) {
  const logPath = join(workDir, "logs", "network-tripwire.jsonl");
  if (!existsSync(logPath)) return [];
  const attempts = [];
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try { attempts.push(JSON.parse(trimmed)); } catch {}
    }
  }
  return attempts;
}

// ---- Loopback sink (mock upstream for no-upstream scenarios) ----------------------

function startLoopbackSink() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        xApiKey: req.headers["x-api-key"] ?? null,
        requestId: req.headers["x-request-id"] ?? null,
        bodyBytes: Buffer.concat(chunks).length,
      });
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "restore-consumer loopback sink (no upstream)" }));
    });
  });
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolvePromise({
        server,
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
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

// ---- HTTP helpers -------------------------------------------------------------------

async function httpRequest(base, path, { method = "GET", cookie, body, timeoutMs } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const setCookie = res.headers.get("set-cookie");
  const buffer = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buffer.toString("utf8")); } catch {}
  return { status: res.status, contentType: res.headers.get("content-type") || "", setCookie, bodyBuffer: buffer, json };
}

function cookieFrom(setCookie) {
  if (!setCookie) return null;
  const pair = setCookie.split(";")[0];
  return pair.startsWith(`${SESSION_COOKIE}=`) ? pair : null;
}

// Structural collection-id extraction from the proxy response body (array of
// {id,...}, {collections:[...]}, or anything else — the string-level fallback
// for presence/absence stays strict in the checks themselves).
function extractCollectionIds(bodyBuffer) {
  let json = null;
  try { json = JSON.parse(bodyBuffer.toString("utf8")); } catch {}
  const list = Array.isArray(json) ? json : Array.isArray(json?.collections) ? json.collections : [];
  return list.map((c) => c?.id ?? null).filter((x) => typeof x === "string");
}

async function login(base, email, password, requestTimeoutMs) {
  const res = await httpRequest(base, "/api/auth/login", {
    method: "POST",
    body: { email, password },
    timeoutMs: requestTimeoutMs,
  });
  return { res, cookie: cookieFrom(res.setCookie) };
}

// ---- Row snapshot / ledger (always on the COPY, read-only) ------------------------

const require = createRequire(import.meta.url);

function snapshotRows(dbPath) {
  const Database = require("better-sqlite3");
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = (sql) => sqlite.prepare(sql).all();
    return {
      users: rows(`SELECT id, email, password_hash, username, avatar_path, role, group_id, content_key_id, oidc_sub, oidc_issuer, created_at, updated_at, last_login_at FROM users WHERE id LIKE 'fx-%' ORDER BY rowid`),
      groups: rows(`SELECT * FROM groups ORDER BY rowid`),
      api_keys: rows(`SELECT id, backend_key_id, encrypted_value, permission, collection_ids, label, created_at FROM api_keys ORDER BY rowid`),
      assistants_fixture: rows(`SELECT * FROM assistants WHERE id = '${IDS.soul}'`),
      assistants_builtin_keys: rows(`SELECT builtin_key FROM assistants WHERE scope = 'builtin' ORDER BY builtin_key`),
      projects: rows(`SELECT * FROM projects ORDER BY rowid`),
      project_shares: rows(`SELECT * FROM project_shares ORDER BY rowid`),
      chat_sessions_fixture: rows(`SELECT * FROM chat_sessions WHERE id = '${IDS.chat}'`),
      chat_messages_fixture: rows(`SELECT * FROM chat_messages WHERE id LIKE 'fx-%' ORDER BY rowid`),
      app_settings: rows(`SELECT * FROM app_settings ORDER BY key`),
      counts: {
        users: rows(`SELECT COUNT(*) AS n FROM users`)[0].n,
        sessions: rows(`SELECT COUNT(*) AS n FROM sessions`)[0].n,
        login_events: rows(`SELECT COUNT(*) AS n FROM login_events`)[0].n,
        usage_events: rows(`SELECT COUNT(*) AS n FROM usage_events`)[0].n,
        assistants: rows(`SELECT COUNT(*) AS n FROM assistants`)[0].n,
        chat_sessions: rows(`SELECT COUNT(*) AS n FROM chat_sessions`)[0].n,
      },
    };
  } finally {
    // Never remove journal sidecars here: on post-run snapshots the app
    // instance may still be running with a live WAL on the copy.
    try { sqlite.close(); } catch {}
  }
}

// Compare the post-run snapshot against the pre-boot snapshot; everything must
// be identical except the DECLARED deltas. expectedCounts states how many new
// rows each counter may gain for this instance's declared writes.
function checkLedger(before, after, instance, failures, expectedCounts) {
  const declared = [];
  const fail = (msg) => failures.push(`ledger(${instance}): ${msg}`);

  if (before.users.length !== after.users.length) {
    fail(`fixture user rows changed: ${before.users.length} -> ${after.users.length}`);
  } else {
    for (let i = 0; i < before.users.length; i++) {
      const b = before.users[i];
      const a = after.users[i];
      if (b.id !== a.id) { fail(`fixture user row identity changed at index ${i}`); continue; }
      for (const col of Object.keys(b)) {
        if (col === "last_login_at") continue;
        if (JSON.stringify(b[col]) !== JSON.stringify(a[col])) {
          fail(`users.${b.id}.${col} changed: ${JSON.stringify(b[col])} -> ${JSON.stringify(a[col])} (password digests and identity must survive the journey untouched)`);
        }
      }
      if (a.last_login_at !== b.last_login_at) declared.push(`users.${a.id}.last_login_at updated`);
    }
  }

  for (const table of ["groups", "api_keys", "projects", "project_shares"]) {
    if (JSON.stringify(before[table]) !== JSON.stringify(after[table])) {
      fail(`${table} rows changed (not declared)`);
    }
  }

  if (JSON.stringify(before.assistants_fixture) !== JSON.stringify(after.assistants_fixture)) {
    fail(`fixture soul ${IDS.soul} row changed`);
  }
  const keysBefore = before.assistants_builtin_keys.map((r) => r.builtin_key).filter(Boolean);
  const keysAfter = after.assistants_builtin_keys.map((r) => r.builtin_key).filter(Boolean);
  for (const k of keysBefore) {
    if (!keysAfter.includes(k)) fail(`existing builtin soul row removed: ${k}`);
  }
  for (const k of keysAfter) {
    if (!keysBefore.includes(k)) {
      if (!BUILTIN_SOUL_KEYS.includes(k)) fail(`unexpected builtin soul inserted: ${k}`);
      else declared.push(`builtin soul inserted: ${k}`);
    }
  }

  const settingsBefore = new Map(before.app_settings.map((r) => [r.key, r]));
  const settingsAfter = new Map(after.app_settings.map((r) => [r.key, r]));
  for (const [key, row] of settingsAfter) {
    const b = settingsBefore.get(key);
    if (!b) {
      if (key === "defaultGroupProvisioned" && row.value === "1") {
        declared.push("app_settings.defaultGroupProvisioned adoption marker written (existing group adopted, no backend key mint)");
      } else {
        fail(`unexpected app_settings key added: ${key}`);
      }
    } else if (JSON.stringify(b) !== JSON.stringify(row)) {
      fail(`app_settings.${key} changed: ${JSON.stringify(b)} -> ${JSON.stringify(row)}`);
    }
  }
  for (const key of settingsBefore.keys()) {
    if (!settingsAfter.has(key)) fail(`app_settings key removed: ${key}`);
  }

  if (JSON.stringify(before.chat_sessions_fixture) !== JSON.stringify(after.chat_sessions_fixture)) {
    fail(`fixture chat session ${IDS.chat} row changed (memory/messages must survive untouched)`);
  }
  if (JSON.stringify(before.chat_messages_fixture) !== JSON.stringify(after.chat_messages_fixture)) {
    fail("fixture chat_messages rows changed");
  }

  for (const [name, expectedAdded] of Object.entries(expectedCounts)) {
    const b = before.counts[name];
    const a = after.counts[name];
    if (a - b !== expectedAdded) {
      fail(`${name}: ${b} -> ${a} (${a - b} added), expected exactly ${expectedAdded}`);
    }
  }
  return declared;
}

// ---- App instance -------------------------------------------------------------------

async function bootApp({ appDir, appNode, appNodeVersion, dataDir, port, backendUrl, backendAdminKey, workDir, tripwirePath, timeouts, logFile }) {
  const startedAt = Date.now();
  const nextBin = join(appDir, "node_modules", "next", "dist", "bin", "next");
  const child = spawnLogged(appNode, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: appDir,
    env: appEnv({ dataDir, backendUrl, backendAdminKey, workDir, tripwirePath }),
    logFile,
  });
  const base = `http://127.0.0.1:${port}`;
  let exitInfo = null;
  child.on("exit", (code, signal) => { exitInfo = { code, signal }; });
  let ready = false;
  let lastError = null;
  const deadline = Date.now() + timeouts.startupTimeout;
  while (Date.now() < deadline) {
    if (exitInfo) break;
    try {
      const res = await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) { ready = true; break; }
      lastError = `/api/config -> ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { child, pid: child.pid, node: { path: appNode, version: appNodeVersion }, base, ready, exitInfo, lastError, bootMs: Date.now() - startedAt };
}

// ---- Checks --------------------------------------------------------------------------

function check(id, route, method, ok, detail, extra = {}) {
  return { id, route, method, ok: !!ok, detail, ...extra };
}

async function runHealthyJourney({ base, upstream, backendAdminKeyFingerprint, documentFile, requestTimeoutMs }) {
  const checks = [];
  const add = (c) => checks.push(c);

  const anonChats = await httpRequest(base, "/api/me/chats", { timeoutMs: requestTimeoutMs });
  add(check("anon-chats-401", "/api/me/chats", "GET", anonChats.status === 401,
    { expected: 401, actual: anonChats.status }));

  const wrongPw = await login(base, FIXTURE_EMAIL1, "fx-wrong-password-attempt", requestTimeoutMs);
  add(check("login-wrong-password-401", "/api/auth/login", "POST", wrongPw.res.status === 401 && !wrongPw.cookie,
    { expected: 401, actual: wrongPw.res.status, body: wrongPw.res.json }));

  const unknownEmail = await login(base, "nobody@example.invalid", USER_PASSWORD, requestTimeoutMs);
  add(check("login-unknown-email-401", "/api/auth/login", "POST", unknownEmail.res.status === 401,
    { expected: 401, actual: unknownEmail.res.status }));

  const login1 = await login(base, FIXTURE_EMAIL1, USER_PASSWORD, requestTimeoutMs);
  add(check("login-user1-200", "/api/auth/login", "POST",
    login1.res.status === 200 && !!login1.cookie && login1.res.json?.id === IDS.user1,
    { expected: `200 + ${SESSION_COOKIE} cookie + id ${IDS.user1} (fresh session minted from the restored digest)`, actual: { status: login1.res.status, cookie: !!login1.cookie, id: login1.res.json?.id ?? null } }));
  const cookie1 = login1.cookie;
  if (!cookie1) return { checks, scratchChatId: null };

  const me1 = await httpRequest(base, "/api/auth/me", { cookie: cookie1, timeoutMs: requestTimeoutMs });
  add(check("me-user1-restored-identity", "/api/auth/me", "GET",
    me1.status === 200 && me1.json?.id === IDS.user1 && me1.json?.role === "admin" &&
      me1.json?.group?.id === IDS.group && me1.json?.avatarUrl === `/api/avatars/${IDS.user1}`,
    { expected: { id: IDS.user1, role: "admin", group: IDS.group, avatarUrl: `/api/avatars/${IDS.user1}` }, actual: me1.json }));

  const chats1 = await httpRequest(base, "/api/me/chats", { cookie: cookie1, timeoutMs: requestTimeoutMs });
  add(check("chats-list-shape", "/api/me/chats", "GET",
    chats1.status === 200 && Array.isArray(chats1.json?.sessions) &&
      !chats1.json.sessions.some((s) => s.id === IDS.chat),
    { expected: "200; the fixture chat is project-bound, so the flat personal list excludes it (project chats render under their project)", actual: chats1.json }));

  const projects1 = await httpRequest(base, "/api/me/projects", { cookie: cookie1, timeoutMs: requestTimeoutMs });
  const fixtureProject = (projects1.json?.projects ?? []).find((p) => p.id === IDS.project);
  add(check("projects-list-restored", "/api/me/projects", "GET",
    projects1.status === 200 && !!fixtureProject && fixtureProject.name === "Fixture Project" &&
      fixtureProject.collectionId === "fx-collection-0001" &&
      (fixtureProject.chats ?? []).some((c) => c.id === IDS.chat),
    { expected: `restored project ${IDS.project} with its collection and chat ${IDS.chat}`, actual: fixtureProject ?? projects1.json }));

  const chat = await httpRequest(base, `/api/me/chats/${IDS.chat}`, { cookie: cookie1, timeoutMs: requestTimeoutMs });
  const msgs = chat.json?.messages ?? [];
  const memoryOk = JSON.stringify(chat.json?.memory) === JSON.stringify(MEMORY_BLOB);
  const msgsOk = MESSAGE_EXPECTATIONS.every((e, i) => {
    const m = msgs[i];
    if (!m || m.id !== e.id || m.role !== e.role || m.content !== e.content) return false;
    if ((m.authorId ?? null) !== e.authorId) return false;
    if (e.sourceSid && !(m.sources ?? []).some((s) => s.sid === e.sourceSid)) return false;
    return true;
  });
  add(check("chat-load-messages-memory", `/api/me/chats/${IDS.chat}`, "GET",
    chat.status === 200 && chat.json?.title === "Fixture Chat" && memoryOk && msgsOk && msgs.length === 4,
    { expected: { title: "Fixture Chat", memory: MEMORY_BLOB, messages: MESSAGE_EXPECTATIONS }, actual: chat.json }));

  // Citation linkage (fixture pack v2): the restored citation must carry the
  // full public Source shape; its document_id (not a manually hardcoded
  // string) is what the content gate fetches. The known sid is ASSERTED.
  const citeMsg = msgs.find((m) => m.id === "fx-msg-0002");
  const restoredSources = Array.isArray(citeMsg?.sources) ? citeMsg.sources : [];
  const restoredSource = restoredSources[0] ?? null;
  const shapeFailures = [];
  if (restoredSources.length !== 1) shapeFailures.push(`expected exactly 1 restored source, got ${restoredSources.length}`);
  if (restoredSource?.sid !== SOURCE_SID) shapeFailures.push(`sid ${restoredSource?.sid} != ${SOURCE_SID}`);
  if (restoredSource?.document_id !== SOURCE_DOCUMENT_ID) shapeFailures.push(`document_id ${restoredSource?.document_id} != ${SOURCE_DOCUMENT_ID}`);
  if (restoredSource?.chunk_id !== SOURCE_CHUNK_ID) shapeFailures.push(`chunk_id ${restoredSource?.chunk_id} != ${SOURCE_CHUNK_ID}`);
  if (restoredSource?.content !== SOURCE_CHUNK_0) shapeFailures.push("content is not the chunk-0 excerpt of the authoritative document text");
  if (typeof restoredSource?.score !== "number" || restoredSource?.score !== SOURCE_SCORE) shapeFailures.push(`score ${restoredSource?.score} != ${SOURCE_SCORE}`);
  if (restoredSource?.metadata?.filename !== SOURCE_FILENAME) shapeFailures.push(`metadata.filename ${restoredSource?.metadata?.filename} != ${SOURCE_FILENAME}`);
  add(check("chat-restored-citation-source-shape", `/api/me/chats/${IDS.chat}`, "GET",
    shapeFailures.length === 0,
    {
      expected: {
        source: {
          sid: SOURCE_SID, document_id: SOURCE_DOCUMENT_ID, chunk_id: SOURCE_CHUNK_ID,
          content: "chunk-0 excerpt of the authoritative document text",
          score: SOURCE_SCORE, metadata: { filename: SOURCE_FILENAME, chunk_index: 0 },
        },
        note: "public Source shape (src/types/index.ts) restored verbatim in the chat message metadata",
      },
      actual: { source: restoredSource, failures: shapeFailures },
    }));
  const restoredCitationSource = { documentId: restoredSource?.document_id ?? null, source: restoredSource };

  const avatar = await httpRequest(base, `/api/avatars/${IDS.user1}`, { cookie: cookie1, timeoutMs: requestTimeoutMs });
  const avatarSha = sha256Hex(avatar.bodyBuffer);
  add(check("avatar-restored-bytes", `/api/avatars/${IDS.user1}`, "GET",
    avatar.status === 200 && avatar.contentType.startsWith("image/png") && avatarSha === AVATAR_SHA,
    { expected: { status: 200, contentType: "image/png", sha256: AVATAR_SHA }, actual: { status: avatar.status, contentType: avatar.contentType, sha256: avatarSha } }));

  const logo = await httpRequest(base, "/api/branding/logo", { timeoutMs: requestTimeoutMs });
  const logoSha = sha256Hex(logo.bodyBuffer);
  add(check("branding-restored-bytes", "/api/branding/logo", "GET",
    logo.status === 200 && logo.contentType.startsWith("image/png") && logoSha === BRANDING_SHA,
    { expected: { status: 200, contentType: "image/png", sha256: BRANDING_SHA }, actual: { status: logo.status, contentType: logo.contentType, sha256: logoSha } }));

  const noAvatar = await httpRequest(base, `/api/avatars/${IDS.user2}`, { cookie: cookie1, timeoutMs: requestTimeoutMs });
  add(check("avatar-absent-404", `/api/avatars/${IDS.user2}`, "GET", noAvatar.status === 404,
    { expected: 404, actual: noAvatar.status }));

  const avatarAnon = await httpRequest(base, `/api/avatars/${IDS.user1}`, { timeoutMs: requestTimeoutMs });
  add(check("avatar-anon-401", `/api/avatars/${IDS.user1}`, "GET", avatarAnon.status === 401,
    { expected: 401, actual: avatarAnon.status }));

  const scratch = await httpRequest(base, "/api/me/chats", {
    method: "POST", cookie: cookie1, body: { title: SCRATCH_CHAT_TITLE }, timeoutMs: requestTimeoutMs,
  });
  const scratchId = scratch.json?.id ?? null;
  add(check("scratch-private-chat-created", "/api/me/chats", "POST",
    scratch.status === 200 && !!scratchId,
    { expected: "200 with a fresh chat id (declared scratch write on the copy, author user1)", actual: scratch.json }));

  const login2 = await login(base, FIXTURE_EMAIL2, USER_PASSWORD, requestTimeoutMs);
  add(check("login-user2-200", "/api/auth/login", "POST",
    login2.res.status === 200 && !!login2.cookie && login2.res.json?.id === IDS.user2,
    { expected: `200 + id ${IDS.user2} (same restored fixture password)`, actual: { status: login2.res.status, id: login2.res.json?.id ?? null } }));
  const cookie2 = login2.cookie;

  if (cookie2 && scratchId) {
    const foreign = await httpRequest(base, `/api/me/chats/${scratchId}`, { cookie: cookie2, timeoutMs: requestTimeoutMs });
    add(check("foreign-private-chat-404", `/api/me/chats/${scratchId}`, "GET", foreign.status === 404,
      { expected: 404, actual: foreign.status, note: "user2 is not the author and the scratch chat is not project-shared" }));
    const foreignDelete = await httpRequest(base, `/api/me/chats/${scratchId}`, { method: "DELETE", cookie: cookie2, timeoutMs: requestTimeoutMs });
    add(check("foreign-private-chat-delete-404", `/api/me/chats/${scratchId}`, "DELETE", foreignDelete.status === 404,
      { expected: 404, actual: foreignDelete.status, note: "writes stay author-only even for project members" }));
  } else {
    add(check("foreign-private-chat-404", "/api/me/chats/[scratch]", "GET", false,
      { expected: 404, actual: `skipped (cookie2=${!!cookie2}, scratchId=${scratchId})` }));
  }

  if (cookie2) {
    const me2 = await httpRequest(base, "/api/auth/me", { cookie: cookie2, timeoutMs: requestTimeoutMs });
    const shared = await httpRequest(base, `/api/me/chats/${IDS.chat}`, { cookie: cookie2, timeoutMs: requestTimeoutMs });
    add(check("user2-scope-and-shared-read", "/api/auth/me + /api/me/chats/fx-chat-0001", "GET",
      me2.json?.role === "user" && me2.json?.canUpload === false && shared.status === 200 &&
        shared.json?.title === "Fixture Chat",
      { expected: "user2 role=user, canUpload=false (no restored content key); the project-shared fixture chat is readable — expected share behavior, not a leak", actual: { me: me2.json, sharedStatus: shared.status } }));
  }

  // Proxy: the restored encrypted group key must decrypt and be injected upstream.
  const proxy = await httpRequest(base, "/api/proxy/api/collections", { cookie: cookie1, timeoutMs: requestTimeoutMs });
  const observed = (upstream.requests ?? []).filter((r) => (r.url ?? "").includes("/api/collections"));
  const keyObserved = observed.some((r) => r.xApiKey === READ_KEY_PLAINTEXT);
  if (upstream.kind === "loopback-sink") {
    add(check("proxy-restored-group-key-injected", "/api/proxy/api/collections", "GET",
      proxy.status !== 401 && proxy.status !== 403 && keyObserved,
      {
        expected: `loopback sink receives X-API-Key = ${READ_KEY_PLAINTEXT} (restored encrypted group key decrypts with the fixture APP_ENCRYPTION_KEY)`,
        actual: { proxyStatus: proxy.status, observedRequests: observed, keyObserved },
      },
      { note: "local decryption/injection proof via sink; labeled no upstream content proof (no real backend behind the sink)" }));
  } else {
    // REQUIRED gate — never reportOnly: the restored encrypted read key must
    // be ACCEPTED by the real isolated backend (HTTP 200 with the permitted
    // collection present and the off-scope collection absent), and the
    // citation file must come back byte-exact against the independent
    // app/oracle v2 fixture snapshot. No search/model claim is made here.
    const bodyText = proxy.bodyBuffer.toString("utf8");
    const collectionIds = extractCollectionIds(proxy.bodyBuffer);
    const hasPermitted = collectionIds.includes(PERMITTED_COLLECTION) || bodyText.includes(PERMITTED_COLLECTION);
    const offScopePresent = collectionIds.includes(OFF_SCOPE_COLLECTION) || bodyText.includes(OFF_SCOPE_COLLECTION);
    add(check("proxy-isolated-backend-collections-200-scoped", "/api/proxy/api/collections", "GET",
      proxy.status === 200 && hasPermitted && !offScopePresent,
      {
        expected: {
          status: 200,
          permittedCollectionPresent: PERMITTED_COLLECTION,
          offScopeCollectionAbsent: OFF_SCOPE_COLLECTION,
          note: `the restored encrypted read key (${IDS.readKey}) is accepted by the real isolated backend under the boot-aligned admin key ${backendAdminKeyFingerprint}`,
        },
        actual: { status: proxy.status, collectionIds, hasPermitted, offScopePresent, bodyPreview: bodyText.slice(0, 500) },
      },
      { note: "REQUIRED real-backend gate: proves the restored encrypted read key decrypts AND is accepted at the isolated backend — not sink/advisory; no search/model/LLM claim" }));

    // Citation content gate — the document id is DERIVED from the restored
    // chat message's source metadata (public Source shape asserted), never
    // from a manually hardcoded unrelated source id.
    const docRef = readFileSync(documentFile);
    const expectedText = docRef.toString("utf8");
    const source = restoredCitationSource; // captured during the chat-load check
    const content = await httpRequest(base, SOURCE_CONTENT_PROXY(source.documentId), { cookie: cookie1, timeoutMs: requestTimeoutMs });
    const verdict = evaluateCitationContent({
      json: content.json,
      documentId: source.documentId,
      expectedText,
      expectedFilename: SOURCE_FILENAME,
    });
    add(check("proxy-isolated-backend-citation-content-exact", SOURCE_CONTENT_PROXY(source.documentId), "GET",
      content.status === 200 && verdict.ok,
      {
        expected: {
          status: 200,
          documentId: source.documentId,
          filename: SOURCE_FILENAME,
          nonemptyChunks: true,
          chunkIndexSortedJoinEqualsSnapshot: true,
          fullContentEqualsSnapshotIfPresent: true,
          snapshot: "independent app/oracle v2 fixture snapshot (--document-file, UTF-8 text)",
        },
        actual: { status: content.status, verdict },
      },
      { note: "REQUIRED real-backend gate: the joined chunk content (UI rule, SourceModal.tsx) equals the app/oracle v2 snapshot verbatim; document id derived from the restored citation metadata — not sink/advisory; no search/model claim" }));

  }

  // Permission boundary (kept after the acceptance correction, BOTH modes):
  // the chat proxy allowlist intentionally does NOT permit
  // /documents/{id}/file — the authenticated request must 404 WITHOUT
  // reaching the upstream (sink mode proves non-forwarding via the recorded
  // sink requests; allowlist rejection never touches the network).
  const fileBlocked = await httpRequest(base, SOURCE_FILE_PROXY_PATH, { cookie: cookie1, timeoutMs: requestTimeoutMs });
  const fileForwarded = (upstream.requests ?? []).some((r) => (r.url ?? "").includes("/documents/"));
  checks.push(check("proxy-file-route-404-permission-boundary", SOURCE_FILE_PROXY_PATH, "GET",
    fileBlocked.status === 404 && !fileForwarded,
    {
      expected: { status: 404, upstreamSeen: false, note: "allowlist rejects /file before the backend — no proxy widening; the raw-file byte gate belongs to the backend side" },
      actual: { status: fileBlocked.status, upstreamSeen: fileForwarded },
    }));

  const disallowed = await httpRequest(base, "/api/proxy/api/admin/api-keys", { cookie: cookie1, timeoutMs: requestTimeoutMs });
  add(check("proxy-allowlist-404", "/api/proxy/api/admin/api-keys", "GET", disallowed.status === 404,
    { expected: 404, actual: disallowed.status }));

  return { checks, scratchChatId: scratchId };
}

async function runByteMissingJourney({ base, requestTimeoutMs }) {
  const checks = [];
  const wrongPw = await login(base, FIXTURE_EMAIL1, "fx-wrong-password-attempt", requestTimeoutMs);
  checks.push(check("byte-missing-login-wrong-password-401", "/api/auth/login", "POST",
    wrongPw.res.status === 401 && !wrongPw.cookie,
    { expected: 401, actual: wrongPw.res.status, note: "counterpart auth control on the isolated byte-missing copy" }));
  const login1 = await login(base, FIXTURE_EMAIL1, USER_PASSWORD, requestTimeoutMs);
  checks.push(check("byte-missing-login-200", "/api/auth/login", "POST",
    login1.res.status === 200 && !!login1.cookie,
    { expected: "login still works on the byte-missing copy (password digests intact)", actual: login1.res.status }));
  const cookie = login1.cookie;
  if (!cookie) return checks;
  const avatar = await httpRequest(base, `/api/avatars/${IDS.user1}`, { cookie, timeoutMs: requestTimeoutMs });
  checks.push(check("byte-missing-avatar-404", `/api/avatars/${IDS.user1}`, "GET", avatar.status === 404,
    { expected: 404, actual: avatar.status, note: "actual-route negative control on an isolated copy whose restored avatar file is missing" }));
  const avatarAnon = await httpRequest(base, `/api/avatars/${IDS.user1}`, { timeoutMs: requestTimeoutMs });
  checks.push(check("byte-missing-avatar-anon-401", `/api/avatars/${IDS.user1}`, "GET", avatarAnon.status === 401,
    { expected: 401, actual: avatarAnon.status, note: "unauthorized counterpart on the byte-missing copy" }));
  const logo = await httpRequest(base, "/api/branding/logo", { timeoutMs: requestTimeoutMs });
  checks.push(check("byte-missing-branding-still-200", "/api/branding/logo", "GET",
    logo.status === 200 && sha256Hex(logo.bodyBuffer) === BRANDING_SHA,
    { expected: "only the avatar file was removed; branding bytes still served verbatim", actual: logo.status }));
  return checks;
}

// ---- Main -----------------------------------------------------------------------------

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error) {
    process.stderr.write(USAGE + "\n");
    emit({ ok: false, error: parsed.error, usage: "see stderr" }, 2);
  }
  const args = parsed.args;
  const stateDir = resolve(args.stateDir);

  const result = {
    ok: false,
    cli: {
      script: "scripts/restore-consumer.mjs",
      node: process.version,
      repoRoot: REPO_ROOT,
      flags: {
        stateDir,
        appNode: args.appNode ?? process.execPath,
        appNodeIsDefault: !args.appNode,
        backendUrl: args.backendUrl,
        backendAdminKey: args.backendAdminKey ?? null,
        backendAdminKeyDefault: args.backendAdminKey ? null : BACKEND_ADMIN_API_KEY_DEFAULT,
        documentFile: args.documentFile,
        workDir: args.workDir,
        installTimeoutMs: args.installTimeout,
        buildTimeoutMs: args.buildTimeout,
        startupTimeoutMs: args.startupTimeout,
        requestTimeoutMs: args.requestTimeout,
        keepWorkDir: args.keepWorkDir,
        gateOnly: args.gateOnly,
      },
    },
    inputs: {},
    apps: [],
    mocks: [],
    checks: [],
    exercisedRoutes: [],
    upstream: {},
    networkTripwire: null,
    declaredWrites: DECLARED_BOOT_WRITES,
    limitations: [],
    cleanup: {},
    failures: [],
  };

  // 1. Gates on the state source — before any copy or boot.
  note(`gating state source ${stateDir}`);
  if (!existsSync(stateDir) || !statSync(stateDir).isDirectory()) {
    result.inputs.gate = { refused: [`state-dir is not a directory: ${stateDir}`] };
    note("state source refused: not a directory");
    emit(result, 1);
  }
  const refusals = checkQuiescedAndIds(stateDir);
  if (refusals.length > 0) {
    result.inputs.gate = { refused: refusals };
    note(`state source refused: ${refusals.join("; ")}`);
    emit(result, 1);
  }
  const verifier = runRealVerifier(stateDir);
  result.inputs.gate = { refusals: [], realVerifier: verifier };
  if (!verifier.ok) {
    note("state source refused by the real fixture verifier");
    emit(result, 1);
  }
  const stateHashBefore = hashStateDir(stateDir);
  result.inputs.stateSource = { files: Object.keys(stateHashBefore).length };

  if (args.gateOnly) {
    result.ok = true;
    result.inputs.appNode = { path: args.appNode ?? process.execPath, validated: "path only (gate-only: no probe, no install)" };
    result.cleanup = { stateDirUnchanged: true, note: "gate-only run: no copy, no install, no build, no boot, no work directory" };
    note("gate-only: state source accepted");
    emit(result, 0);
  }

  let exitCode = 1;
  try {
    // 2. Work directory + copies.
    const prep = prepareWorkDir(stateDir, args.workDir);
    if (prep.error) throw new ConsumerFailure(prep.error);
    const { workDir, appDir, dataDir, copiedFiles, sourceTreeSha256, sourceFileCount } = prep;
    result.inputs.workDir = workDir;
    result.inputs.sourceCopy = {
      copied: copiedFiles,
      treeSha256: sourceTreeSha256,
      fileCount: sourceFileCount,
      note: "sha over the copied source tree (sorted rel paths + content hashes) identifies the exact source the compiled artifact was built from; symlinks are never materialized",
    };
    note(`work dir ${workDir}`);

    // 3. App runtime identity + locked isolated install (before the
    //    tripwire-protected build/start runtime).
    const appNode = args.appNode ?? process.execPath;
    const versionProbe = probeNodeVersion(appNode);
    if (versionProbe.error) {
      result.inputs.appInstall = { ok: false, node: { path: appNode }, error: versionProbe.error };
      throw new ConsumerFailure(versionProbe.error);
    }
    const appNodeVersion = versionProbe.version;
    result.inputs.appNode = {
      path: appNode,
      version: appNodeVersion,
      parentNode: process.version,
      note: "--app-node selects ONLY the child next build/start runtime; libc note: a host Node 20 binary is glibc (bookworm) — the isolated install fetches glibc native bindings, NOT the musl/alpine production artifact",
    };
    note(`app node ${appNode} ${appNodeVersion}; running locked isolated install...`);
    const install = await runAppInstall({ appDir, appNode, appNodeVersion, workDir, installTimeoutMs: args.installTimeout });
    result.inputs.appInstall = install;
    if (!install.ok) {
      throw new ConsumerFailure(`isolated locked install failed: ${install.error}`);
    }
    note(`install ok in ${Math.round(install.installMs / 1000)}s (next ${install.actualVersions?.next}, react ${install.actualVersions?.react}, better-sqlite3 ${install.actualVersions?.["better-sqlite3"]})`);
    const nextBin = join(appDir, "node_modules", "next", "dist", "bin", "next");
    if (!existsSync(nextBin)) {
      throw new ConsumerFailure(`next binary not found after the isolated install: ${nextBin}`);
    }

    // 3. Upstream: isolated backend or loopback sink.
    let sink = null;
    let upstream;
    const backendAdminKey = args.backendAdminKey ?? BACKEND_ADMIN_API_KEY_DEFAULT;
    const backendAdminKeyFingerprint = sha256Hex(Buffer.from(backendAdminKey, "utf8")).slice(0, 16);
    result.inputs.backendAdminKey = {
      source: args.backendAdminKey ? "--backend-admin-key (backend runner)" : `default (sink mode): ${BACKEND_ADMIN_API_KEY_DEFAULT}`,
      sha256_16: backendAdminKeyFingerprint,
      note: "synthetic orchestrator-provided key for boot config alignment; fingerprint recorded, not a real secret",
    };
    result.inputs.documentFile = args.documentFile
      ? { path: resolve(args.documentFile), sha256: sha256Hex(readFileSync(args.documentFile)), bytes: statSync(args.documentFile).size }
      : null;
    if (args.backendUrl) {
      upstream = { kind: "isolated-backend", url: args.backendUrl, requests: [] };
      result.upstream = { mode: "isolated-backend", url: args.backendUrl };
    } else {
      sink = await startLoopbackSink();
      result.mocks.push({ kind: "loopback-sink", url: sink.url, behavior: "records requests/headers, returns 404 — no upstream dependency" });
      upstream = { kind: "loopback-sink", url: sink.url, requests: sink.requests };
      result.upstream = { mode: "loopback-sink", url: sink.url };
    }
    const backendUrl = args.backendUrl ?? sink.url;

    // Network tripwire: injected into every build/app node process via
    // NODE_OPTIONS --require; blocks and records non-loopback egress.
    const tripwirePath = writeTripwire(workDir);
    result.networkTripwire = {
      injected: tripwirePath,
      log: join(workDir, "logs", "network-tripwire.jsonl"),
      scope: "all build/app node processes (NODE_OPTIONS propagates to workers)",
      blockedAttempts: [],
    };

    // 4. Production build of the allowlisted source copy.
    note("building the real Next application (production build)...");
    const buildStartedAt = Date.now();
    const buildEnv = {
      ...appEnv({
        dataDir: join(workDir, "build-data"), backendUrl, backendAdminKey,
        workDir, tripwirePath,
      }),
    };
    mkdirSync(join(workDir, "build-data"), { recursive: true });
    const buildChild = spawnLogged(appNode, [nextBin, "build"], {
      cwd: appDir, env: buildEnv, logFile: join(workDir, "logs", "build.log"),
    });
    const buildExit = await waitForExit(buildChild, args.buildTimeout);
    result.apps.push({
      instance: "build",
      node: { path: appNode, version: appNodeVersion },
      pid: buildChild.pid,
      buildMs: Date.now() - buildStartedAt,
      exitCode: buildExit.code ?? null,
      timedOut: !!buildExit.timedOut,
      error: buildExit.error ?? null,
    });
    if (buildExit.timedOut) {
      throw new ConsumerFailure(`next build exceeded ${args.buildTimeout}ms and was killed; log: ${join(workDir, "logs", "build.log")}`);
    }
    if (buildExit.code !== 0) {
      throw new ConsumerFailure(`next build failed (exit ${buildExit.code}); log: ${join(workDir, "logs", "build.log")}`);
    }
    note(`build ok in ${Math.round((Date.now() - buildStartedAt) / 1000)}s`);

    // 5. Instance A: healthy restored copy — the real journey.
    // Pre-boot snapshot of the COPY: the declared boot writes (superadmin
    // insert, builtin souls, adoption marker) happen before /api/config is
    // ready, so the ledger baseline must be captured before bootApp.
    const beforeA = snapshotRows(join(dataDir, "cortex-chat.db"));
    const portA = await freePort();
    const bootA = await bootApp({
      appDir, appNode, appNodeVersion, dataDir, port: portA, backendUrl, backendAdminKey, workDir, tripwirePath,
      timeouts: args, logFile: join(workDir, "logs", "app-healthy.log"),
    });
    const appA = {
      instance: "healthy", node: bootA.node, pid: bootA.pid, port: portA, base: bootA.base, bootMs: bootA.bootMs, ready: bootA.ready,
      env: "explicit allowlist (no ambient credentials, HOME/TMPDIR in work dir); SENTRY_DISABLED=1, NEXT_PUBLIC_SENTRY_DISABLED=1; SMTP/OIDC/VOICE/DEMO unset; network tripwire via NODE_OPTIONS --require",
      declaredBootWrites: DECLARED_BOOT_WRITES,
      ledger: null,
    };
    result.apps.push(appA);
    if (!bootA.ready) {
      throw new ConsumerFailure(`app did not become ready within ${args.startupTimeout}ms (process ${bootA.exitInfo ? "exited: " + JSON.stringify(bootA.exitInfo) : "still starting"}; last: ${bootA.lastError ?? "n/a"}); log: ${join(workDir, "logs", "app-healthy.log")}`);
    }
    note(`healthy instance ready at ${bootA.base} (${Math.round(bootA.bootMs / 1000)}s)`);

    const journeyA = await runHealthyJourney({
      base: bootA.base, upstream, backendAdminKeyFingerprint, documentFile: args.documentFile,
      requestTimeoutMs: args.requestTimeout,
    });
    result.checks.push(...journeyA.checks);

    const declaredA = checkLedger(beforeA, snapshotRows(join(dataDir, "cortex-chat.db")), "healthy", result.failures, {
      users: 1, sessions: 2, login_events: 4, usage_events: 2, chat_sessions: 1, assistants: 3,
    });
    appA.ledger = { declaredWrites: declaredA, counts: "see result.failures for any ledger violation" };

    // 6. Instance B: byte-missing avatar negative control on a fresh copy.
    const missingDir = join(workDir, "data-byte-missing");
    mkdirSync(missingDir, { recursive: true });
    cpSync(stateDir, missingDir, { recursive: true, preserveTimestamps: true });
    rmSync(join(missingDir, "avatars", AVATAR_NAME), { force: true });
    const beforeB = snapshotRows(join(missingDir, "cortex-chat.db"));
    const portB = await freePort();
    const bootB = await bootApp({
      appDir, appNode, appNodeVersion, dataDir: missingDir, port: portB, backendUrl, backendAdminKey, workDir, tripwirePath,
      timeouts: args, logFile: join(workDir, "logs", "app-byte-missing.log"),
    });
    const appB = {
      instance: "byte-missing", node: bootB.node, pid: bootB.pid, port: portB, base: bootB.base, bootMs: bootB.bootMs, ready: bootB.ready,
      note: `fresh copy of the restored state with ${AVATAR_NAME} removed before boot`,
      declaredBootWrites: DECLARED_BOOT_WRITES, ledger: null,
    };
    result.apps.push(appB);
    if (!bootB.ready) {
      throw new ConsumerFailure(`byte-missing instance did not become ready; log: ${join(workDir, "logs", "app-byte-missing.log")}`);
    }
    result.checks.push(...(await runByteMissingJourney({ base: bootB.base, requestTimeoutMs: args.requestTimeout })));
    const declaredB = checkLedger(beforeB, snapshotRows(join(missingDir, "cortex-chat.db")), "byte-missing", result.failures, {
      users: 1, sessions: 1, login_events: 2, usage_events: 1, chat_sessions: 0, assistants: 3,
    });
    appB.ledger = { declaredWrites: declaredB };

    // 7. Upstream summary + network tripwire verdict.
    if (sink) {
      result.upstream.requests = sink.requests;
      result.upstream.keyObserved = sink.requests.some((r) => r.xApiKey);
      result.upstream.note = result.upstream.keyObserved
        ? `loopback sink received the restored group chat key (X-API-Key = ${READ_KEY_PLAINTEXT}) through the real proxy route — local decryption proof, labeled no upstream content proof`
        : "loopback sink received no proxied request carrying an API key";
    } else {
      result.upstream.note =
        "isolated loopback backend supplied by the orchestrator; the required gates (collections 200 + permitted scope + off-scope absent; citation file byte-exact vs the app/oracle v2 snapshot) prove the restored encrypted read key is ACCEPTED at the real backend — not sink/advisory. No search/model/LLM request was exercised.";
    }
    result.networkTripwire.blockedAttempts = readTripwireLog(workDir);
    result.networkTripwire.clean =
      result.networkTripwire.blockedAttempts.length === 0 &&
      existsSync(result.networkTripwire.log);
    if (result.networkTripwire.blockedAttempts.length > 0) {
      result.failures.push(
        `network tripwire: ${result.networkTripwire.blockedAttempts.length} non-loopback connection/resolution attempt(s) from the app/build processes — recorded and failing the gate: ${JSON.stringify(result.networkTripwire.blockedAttempts).slice(0, 1000)}`
      );
    }

    // 8. Roll up.
    result.exercisedRoutes = [...new Set(result.checks.map((c) => `${c.method} ${c.route}`))];
    result.limitations = [
      result.upstream.mode === "isolated-backend"
        ? "isolated-backend mode: restored encrypted read key acceptance + permitted collection scope + citation-file byte fidelity PROVEN against the real isolated loopback backend; no search/model/LLM request was exercised and none may be claimed"
        : "loopback-sink mode: decryption/injection proof only — NO upstream content proof (sink/advisory; cannot satisfy the real integrated gate)",
      "HTTP-route journeys against the real Next server only — NOT a browser journey; no visual/UI claim",
      "the source copy is the unchanged real app with an explicit env allowlist and a network tripwire; no framework or auth mock",
      `app runtime: ${appNode} ${appNodeVersion} with a locked isolated install (committed package.json + package-lock.json); the parent/verifier stay on ${process.version}; glibc host bindings are NOT the musl/alpine production artifact`,
      "boot/startup writes are enumerated in declaredWrites and enforced by the row ledger on the COPY; the state source stays byte-identical (pre/post hash)",
      "CI runs the light gate-only refusal suite only; the full production build + next start belongs to the main orchestrator",
    ];
    const failedChecks = result.checks.filter((c) => !c.ok);
    if (failedChecks.length === 0 && result.failures.length === 0) {
      result.ok = true;
      exitCode = 0;
    } else {
      result.ok = false;
      result.failedChecks = failedChecks.map((c) => c.id);
    }
  } catch (err) {
    if (err instanceof ConsumerFailure) {
      result.failures.push(err.message);
    } else {
      result.failures.push(`internal: ${err?.stack || err?.message || String(err)}`);
    }
  } finally {
    const killed = [];
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) killed.push(child.pid);
    }
    killAll();
    result.cleanup.processesKilled = killed;

    const stateHashAfter = hashStateDir(stateDir);
    const unchanged = JSON.stringify(stateHashBefore) === JSON.stringify(stateHashAfter);
    result.cleanup.stateDirUnchanged = unchanged;
    if (!unchanged) result.failures.push("the state source changed during the run — this must never happen (the app only ever sees a copy)");

    // Finalization is part of acceptance. Preserve diagnostic artifacts and a
    // failing exit status if it reveals a violation after the HTTP checks pass.
    if (result.failures.length > 0 || !unchanged) {
      result.ok = false;
      exitCode = 1;
    }

    const keep = args.keepWorkDir || exitCode !== 0;
    if (keep) {
      result.cleanup.workDirRemoved = false;
      result.cleanup.workDirKeptReason = args.keepWorkDir ? "--keep-work-dir" : "kept for forensics after failure";
      result.cleanup.workDir = result.inputs.workDir ?? null;
    } else if (result.inputs.workDir) {
      try {
        rmSync(result.inputs.workDir, { recursive: true, force: true });
        result.cleanup.workDirRemoved = true;
      } catch (err) {
        result.cleanup.workDirRemoved = false;
        result.cleanup.workDirKeptReason = `removal failed: ${err.message}`;
        result.cleanup.workDir = result.inputs.workDir;
      }
    }
    result.timings = { completedAt: new Date().toISOString() };
    note(exitCode === 0 ? "consumer journey PASSED" : `consumer journey FAILED (${result.failures.length} failure(s))`);
    emit(result, exitCode);
  }
}
process.on("SIGINT", () => { killAll(); process.exit(130); });
process.on("SIGTERM", () => { killAll(); process.exit(143); });

// ---- Citation content evaluation (pure; unit-gated in the contract suite) ---
// Mirrors the UI rule exactly (SourceModal.tsx): sort a copy of the chunks by
// chunk_index, take the contents, join with "\n\n".

function joinDocumentChunks(chunks) {
  return [...(chunks ?? [])]
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .map((c) => c.content)
    .join("\n\n");
}

function evaluateCitationContent({ json, documentId, expectedText, expectedFilename }) {
  const failures = [];
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, joined: null, failures: [`response is not a JSON object: ${JSON.stringify(json)?.slice(0, 200)}`] };
  }
  if (json.id !== documentId) failures.push(`document identity: id ${json.id} != ${documentId}`);
  if (json.filename !== expectedFilename) failures.push(`filename ${json.filename} != ${expectedFilename}`);
  const chunks = Array.isArray(json.chunks) ? json.chunks : null;
  if (!chunks || chunks.length === 0) {
    failures.push(`chunks must be a nonempty array, got ${chunks === null ? "missing/not-array" : chunks.length}`);
  } else {
    for (const c of chunks) {
      if (!Number.isInteger(c?.chunk_index) || c.chunk_index < 0) failures.push(`chunk_index ${c?.chunk_index} is not a nonnegative integer`);
      if (typeof c?.content !== "string" || c.content.length === 0) failures.push(`chunk ${c?.chunk_index} has empty/non-string content`);
    }
    const indexes = chunks.map((c) => c.chunk_index).sort((a, b) => a - b);
    for (let i = 0; i < indexes.length; i++) {
      if (indexes[i] !== i) {
        failures.push(`chunk_index coverage broken at position ${i}: [${indexes.join(", ")}] — a chunk is missing or duplicated`);
        break;
      }
    }
    const joined = joinDocumentChunks(chunks);
    if (joined !== expectedText) {
      failures.push(`chunk_index-sorted "\\n\\n" join (${joined.length} chars) != the independent app/oracle v2 snapshot text (${expectedText.length} chars)`);
    }
    if ("full_content" in json && json.full_content !== expectedText) {
      failures.push("full_content, though promised, does not equal the snapshot text");
    }
    return { ok: failures.length === 0, joined, failures };
  }
  return { ok: false, joined: null, failures };
}

// Exported for the contract suite's unit controls (importing this module must
// not run the CLI: main() only runs when this file IS the entry point).
export { joinDocumentChunks, evaluateCitationContent };

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) main();
