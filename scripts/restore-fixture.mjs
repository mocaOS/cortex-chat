#!/usr/bin/env node
// Synthetic whole-stack restore fixture for cortex-chat state (SQLite + files).
//
//   node scripts/restore-fixture.mjs seed   <directory>   create the fixture
//   node scripts/restore-fixture.mjs verify <directory>   compare against the frozen baseline (JSON)
//   node scripts/restore-fixture.mjs mutate <directory>   append post-snapshot canaries (verifier must fail)
//
// Scope (see docs/regeneration/records/2026-10-01-restore-fixture.md): this is a
// STATE-LEVEL fixture — it proves the chat SQLite rows/schema, encrypted keys,
// password digests and avatar/branding bytes survive a copy/restore, not that a
// login or browser journey works. Key properties:
//
// - Uses the REAL Drizzle migrator and the repo's REAL crypto/password modules
//   (`src/lib/auth/crypto.ts`, `src/lib/auth/password.ts`), loaded in a child
//   process via `--import tsx --conditions=react-server` (the same flags the
//   contract suite uses). No app boot, no DB singleton and no route code is
//   imported (`src/lib/db/client.ts` stays untouched); the retained runtime
//   dependencies are explicit: the migrator and those two auth modules.
// - Everything is hardcoded and clearly synthetic: IDs are `fx-*`, emails are
//   `*.example.invalid`, and the 32-byte APP_ENCRYPTION_KEY is derived from
//   the literal "synthetic-restore-fixture-key". No key/password provider, no
//   env lookup. Ambient DATABASE_PATH / APP_ENCRYPTION_KEY / service env is
//   stripped in the child.
// - Directory layout mirrors the actual mounted `/app/data` volume root:
//   `<dir>/cortex-chat.db`, `<dir>/avatars/`, `<dir>/branding/`, sentinel at
//   the root. All stored references are RELATIVE (`cortex-chat.db`,
//   `avatars/<userId>.png`, `avatar_path` filename) so a copied/restored
//   fixture verifies at any new location.
// - `seed` refuses an existing DB or a non-empty target (no surprise writes).
//   `verify`/`mutate` require the sentinel + the expected synthetic IDs before
//   any effect. The final DB is checkpointed and closed — quiesced, no WAL/SHM
//   remnants.
// - `verify` opens the database READ-ONLY (never writes or checkpoints the
//   artifact it judges; requires a quiesced source with no WAL/SHM, removes
//   the transient read-only sidecars SQLite itself creates, and leaves the
//   artifact's file set unchanged) and compares against FIXED expectations
//   built into this script:
//   exact table/column sets, exact row sets (extra/stale rows fail), decrypted
//   key values, argon2 password verification, and asset file sets + SHA-256
//   taken from the hardcoded AVATAR_PNG/BRANDING_PNG constants — never from
//   target-supplied values. The sentinel is validated against those same
//   fixed expectations (a forged/edited sentinel is rejected), it is metadata,
//   never the oracle.
// - `mutate` preserves all fixture IDs and only appends canaries (extra chat
//   message, mutated memory blob, extra usage row, extra avatar blob) so a
//   frozen baseline copy must pass verify while the mutated source fails.
// - Invocation model: the main qa/restore harness owns when this runs; it
//   must never be pointed at a live deployment's data volume (seed refuses
//   non-empty targets, but discipline is the rule — no competing runtime).

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CHILD_FLAG = "CORTEX_CHAT_RESTORE_FIXTURE_CHILD";
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(SCRIPT_PATH));
const MIGRATIONS_FOLDER = join(REPO_ROOT, "src/lib/db/migrations");
const SENTINEL_NAME = "restore-fixture.sentinel.json";
const USAGE = `usage:
  node scripts/restore-fixture.mjs seed <directory>    create the synthetic restore fixture
  node scripts/restore-fixture.mjs verify <directory>  compare against the frozen baseline (JSON, exit 0/1)
  node scripts/restore-fixture.mjs mutate <directory>  append post-snapshot canaries (verifier must fail)

verify prints its result JSON on stdout ({"ok":true|false,"failures":[...]}).
Content failures: JSON on stdout, exit 1. Refusals (missing sentinel, non-empty
seed target): JSON on stderr, exit 1. Bad usage: exit 2.`;

// ---- Synthetic constants (fixed; verify's expectations derive from these) --

const FIXTURE_VERSION = 2; // v2: full public-Source citation metadata (see
// docs/regeneration/records/2026-10-01-citation-content-correction.md; the
// historical v1 pack and its evidence remain recorded, not rewritten)
// 32 bytes derived from a literal, obviously-not-secret string.
const INTERNAL_KEY = Buffer.alloc(32);
Buffer.from("synthetic-restore-fixture-key", "utf8").copy(INTERNAL_KEY);
const INTERNAL_KEY_B64 = INTERNAL_KEY.toString("base64");
const KEY_FINGERPRINT = sha256Hex(INTERNAL_KEY);

const READ_KEY_PLAINTEXT = "fx-synthetic-backend-read-key-0001";
const CONTENT_KEY_PLAINTEXT = "fx-synthetic-backend-content-key-0002";
const USER_PASSWORD = "fx-correct-horse-battery-staple";
const T0 = 1767225600000; // 2026-01-01T00:00:00Z — fixed for deterministic rows
const SESSION_TOKEN = Buffer.from("synthetic-session-token-32-byte0", "utf8")
  .toString("base64url");
const MEMORY_BLOB = JSON.stringify({
  conversation_memory: "fx-opaque-blob-v1",
  turns: 2,
});
const CANARY_MEMORY_BLOB = JSON.stringify({
  conversation_memory: "fx-opaque-blob-v1",
  turns: 3,
  canary: "post-snapshot-write",
});
const CANARY_MESSAGE_ID = "fx-msg-canary-0005";
const CANARY_USAGE_ID = "fx-usage-canary-0001";
const CANARY_AVATAR_NAME = "fx-canary-0001.png";
const CANARY_BLOB = Buffer.from(
  "fx-canary-blob-post-snapshot-restore-fixture",
  "utf8"
);

// Synthetic asset bytes (1x1 PNGs — clearly fixture data, not real uploads).
const AVATAR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const BRANDING_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64"
);

const SOUL_TEXT = [
  "---",
  "name: Fixture Soul",
  "description: Synthetic restore fixture soul",
  "---",
  "",
  "You are a synthetic fixture soul used to verify a whole-stack restore.",
  "",
].join("\n");

// ---- Fixture citation pack v2 (accepted MAIN producer declaration) -----------
// The chat fixture aligns to the ACCEPTED main producer (cortex-app source
// oracle, source oracle.py ~1565-71): ONE markdown chunk for
// fx-source-0001, filename "fixture-source.md". The exact accepted text below
// is fixed verbatim (lead-declared); the restored citation is the full public
// Source shape (src/types/index.ts) whose content is that same exact text.
// Main owns the cross-repo fixture-consistency check (app-side oracle text vs
// these constants) before compiling; the chat-side tests pin the constants.

const FIXTURE_DOCUMENT_ID = "fx-source-0001";
const FIXTURE_SOURCE_FILENAME = "fixture-source.md";
const FIXTURE_DOCUMENT_TEXT =
  "Fixture Source content for the disposable restore rehearsal.\n" +
  "It's a \"test\" with escaping: back\\slash and 'quotes'.\n" +
  "The fixture graph cites this document as fx-source-0001 (Fixture Source).\n" +
  "Mentions Rehearsal Alpha and Rehearsal Beta for graph linkage.\n";
const FIXTURE_DOCUMENT_CHUNKS = [
  { id: `${FIXTURE_DOCUMENT_ID}-chunk-0`, chunk_index: 0, content: FIXTURE_DOCUMENT_TEXT },
];
// The restored citation (public Source shape) as stored in fx-msg-0002's
// metadata — the single accepted chunk, quoted verbatim.
const FIXTURE_CITATION_SOURCE = {
  document_id: FIXTURE_DOCUMENT_ID,
  chunk_id: `${FIXTURE_DOCUMENT_ID}-chunk-0`,
  content: FIXTURE_DOCUMENT_TEXT,
  score: 0.42,
  sid: "fx-source-0001",
  title: "Fixture Source",
  metadata: { filename: FIXTURE_SOURCE_FILENAME, chunk_index: 0 },
};

const IDS = {
  readKey: "fx-key-read-0001",
  contentKey: "fx-key-content-0002",
  group: "fx-group-0001",
  user1: "fx-user-0001",
  user2: "fx-user-0002",
  sessionToken: SESSION_TOKEN,
  loginEvent: "fx-login-event-0001",
  soul: "fx-soul-0001",
  project: "fx-project-0001",
  shareGroup: "fx-share-group-0001",
  shareUser: "fx-share-user-0002",
  chat: "fx-chat-0001",
  messages: ["fx-msg-0001", "fx-msg-0002", "fx-msg-0003", "fx-msg-0004"],
  settingsKeys: ["appTitle", "logoFile", "logoUpdatedAt"],
};

const AVATAR_NAME = `${IDS.user1}.png`;
const BRANDING_NAME = "logo.png";

// Fixed asset oracle: paths + bytes + digests all come from these constants.
// The sentinel merely DECLARES them; verify never trusts target-supplied
// digests or paths (a forged sentinel is rejected against this array).
const EXPECTED_ASSETS = [
  { path: `avatars/${AVATAR_NAME}`, bytes: AVATAR_PNG },
  { path: `branding/${BRANDING_NAME}`, bytes: BRANDING_PNG },
].map((a) => ({ path: a.path, sha256: sha256Hex(a.bytes) }));

// Exact schema contract: column names per table, in order (from
// src/lib/db/schema.ts at fixture version 1). Extra/missing columns fail.
const EXPECTED_COLUMNS = {
  api_keys: ["id", "backend_key_id", "encrypted_value", "permission", "collection_ids", "label", "created_at"],
  groups: ["id", "name", "description", "chat_key_id", "created_at", "updated_at"],
  users: ["id", "email", "password_hash", "username", "avatar_path", "role", "group_id", "content_key_id", "created_at", "updated_at", "last_login_at", "oidc_sub", "oidc_issuer"],
  sessions: ["token", "user_id", "ip", "user_agent", "created_at", "last_seen_at", "expires_at"],
  password_reset_tokens: ["id", "user_id", "token_hash", "expires_at", "used_at", "created_at"],
  registrations: ["id", "email", "password_hash", "created_at"],
  login_events: ["id", "user_id", "email_attempted", "success", "ip", "user_agent", "created_at", "method"],
  assistants: ["id", "builtin_key", "name", "description", "soul", "starters", "collection_id", "scope", "group_id", "user_id", "enabled", "source_url", "verified_signer", "created_at", "updated_at"],
  projects: ["id", "owner_id", "name", "instructions", "assistant_id", "collection_id", "created_at", "updated_at"],
  project_shares: ["id", "project_id", "group_id", "user_id", "created_at"],
  chat_sessions: ["id", "user_id", "title", "created_at", "updated_at", "memory", "pinned", "assistant_id", "project_id"],
  chat_messages: ["id", "chat_session_id", "role", "content", "metadata", "created_at", "user_id"],
  usage_events: ["id", "user_id", "kind", "collection_id", "metadata", "created_at"],
  app_settings: ["key", "value", "updated_at"],
};
const MIGRATION_COUNT = 11;

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ---- Entry: parent re-execs itself under tsx so the real TS modules load ---

if (process.env[CHILD_FLAG] !== "1") {
  const mode = process.argv[2];
  const dirArg = process.argv[3];
  if (!mode || !["seed", "verify", "mutate"].includes(mode) || !dirArg || process.argv.length > 4) {
    process.stderr.write(USAGE + "\n");
    process.exit(2);
  }
  const childEnv = { ...process.env };
  // No ambient state or service env: the fixture is fully self-contained.
  for (const k of [
    "DATABASE_PATH", "APP_ENCRYPTION_KEY", "CORTEX_API_URL",
    "BACKEND_ADMIN_API_KEY", "SUPERADMIN_EMAIL", "SUPERADMIN_PASSWORD",
    "SMTP_HOST", "OIDC_ISSUER_URL", "DEMO_MODE", "SENTRY_DSN",
  ]) {
    delete childEnv[k];
  }
  childEnv[CHILD_FLAG] = "1";
  childEnv.APP_ENCRYPTION_KEY = INTERNAL_KEY_B64;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--conditions=react-server", SCRIPT_PATH, mode, resolve(dirArg)],
    { stdio: "inherit", cwd: REPO_ROOT, env: childEnv }
  );
  process.exit(result.status ?? 1);
}

// ---- Child: real migrator + real crypto/password modules -------------------

process.env.APP_ENCRYPTION_KEY = INTERNAL_KEY_B64; // unconditional, synthetic
delete process.env.DATABASE_PATH;

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { drizzle } = require("drizzle-orm/better-sqlite3");
const { migrate } = require("drizzle-orm/better-sqlite3/migrator");

const cryptoModule = await import(
  pathToFileURL(join(REPO_ROOT, "src/lib/auth/crypto.ts")).href
);
const passwordModule = await import(
  pathToFileURL(join(REPO_ROOT, "src/lib/auth/password.ts")).href
);
const { encryptSecret, decryptSecret } = cryptoModule;
const { hashPassword, verifyPassword } = passwordModule;

const targetDir = resolve(process.argv[3]);
// Volume-root layout: the target directory IS the mounted /app/data volume.
const dbPath = join(targetDir, "cortex-chat.db");
const avatarsDir = join(targetDir, "avatars");
const brandingDir = join(targetDir, "branding");
const sentinelPath = join(targetDir, SENTINEL_NAME);

function fail(reason) {
  process.stderr.write(JSON.stringify({ ok: false, mode: process.argv[2], error: reason }) + "\n");
  process.exit(1);
}

function openWritable(path, { create } = {}) {
  const sqlite = new Database(path, { fileMustExist: !create });
  // Same connection contract as src/lib/db/client.ts.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  return { sqlite, db };
}

// Verification must never write the artifact it judges: read-only open, no
// pragmas, no checkpoint. SQLite transiently creates empty -wal/-shm sidecars
// even for a read-only connection on a WAL-mode database — verify requires a
// quiesced source (no sidecars before open), removes any it created, and must
// leave the artifact with its original file set.
function openReadonly(path) {
  return new Database(path, { readonly: true, fileMustExist: true });
}

function checkpointAndClose(sqlite) {
  sqlite.pragma("wal_checkpoint(TRUNCATE)");
  sqlite.close(); // clean close removes -wal/-shm — the fixture is quiesced
}

// ---- Expected logical rows (fixed; encrypted/password fields validated) ----

function expectedRows() {
  const rows = {
    api_keys: [
      {
        id: IDS.readKey, backend_key_id: "fx-backend-key-0001",
        permission: "read", collection_ids: "[]",
        label: "Fixture group read key", created_at: T0,
      },
      {
        id: IDS.contentKey, backend_key_id: "fx-backend-key-0002",
        permission: "manage", collection_ids: '["fx-collection-0001"]',
        label: "Fixture user content key", created_at: T0 + 1000,
      },
    ],
    groups: [
      {
        id: IDS.group, name: "Fixture Group",
        description: "Synthetic restore fixture group",
        chat_key_id: IDS.readKey, created_at: T0, updated_at: T0,
      },
    ],
    // password_hash omitted here on purpose: verify compares all other fields
    // and validates the digest with the real verifyPassword instead.
    users: [
      {
        id: IDS.user1, email: "fixture-user-0001@example.invalid",
        username: "fixture-admin", avatar_path: AVATAR_NAME, role: "admin",
        group_id: IDS.group, content_key_id: IDS.contentKey,
        oidc_sub: null, oidc_issuer: null, created_at: T0, updated_at: T0,
        last_login_at: T0 + 5000,
      },
      {
        id: IDS.user2, email: "fixture-user-0002@example.invalid",
        username: "fixture-user", avatar_path: null, role: "user",
        group_id: IDS.group, content_key_id: null,
        oidc_sub: null, oidc_issuer: null, created_at: T0 + 10, updated_at: T0 + 10,
        last_login_at: null,
      },
    ],
    sessions: [
      {
        token: IDS.sessionToken, user_id: IDS.user1, ip: "192.0.2.10",
        user_agent: "restore-fixture/1 (synthetic)", created_at: T0 + 2000,
        last_seen_at: T0 + 2000, expires_at: T0 + 30 * 86400000,
      },
    ],
    login_events: [
      {
        id: IDS.loginEvent, user_id: IDS.user1,
        email_attempted: "fixture-user-0001@example.invalid", success: 1,
        method: "password", ip: "192.0.2.10",
        user_agent: "restore-fixture/1 (synthetic)", created_at: T0 + 2000,
      },
    ],
    assistants: [
      {
        id: IDS.soul, builtin_key: null, name: "Fixture Soul",
        description: "Synthetic restore fixture soul", soul: SOUL_TEXT,
        starters: '["What does the fixture contain?"]', collection_id: null,
        scope: "global", group_id: null, user_id: null, enabled: 1,
        source_url: null, verified_signer: null,
        created_at: T0 + 3000, updated_at: T0 + 3000,
      },
    ],
    projects: [
      {
        id: IDS.project, owner_id: IDS.user1, name: "Fixture Project",
        instructions: "Synthetic project instructions for restore verification.",
        assistant_id: IDS.soul, collection_id: "fx-collection-0001",
        created_at: T0 + 4000, updated_at: T0 + 4000,
      },
    ],
    project_shares: [
      { id: IDS.shareGroup, project_id: IDS.project, group_id: IDS.group, user_id: null, created_at: T0 + 4100 },
      { id: IDS.shareUser, project_id: IDS.project, group_id: null, user_id: IDS.user2, created_at: T0 + 4101 },
    ],
    chat_sessions: [
      {
        id: IDS.chat, user_id: IDS.user1, title: "Fixture Chat",
        memory: MEMORY_BLOB, pinned: 1, assistant_id: IDS.soul,
        project_id: IDS.project, created_at: T0 + 5000, updated_at: T0 + 5010,
      },
    ],
    chat_messages: [
      { id: "fx-msg-0001", chat_session_id: IDS.chat, user_id: IDS.user1, role: "user", content: "What is stored in this fixture?", metadata: '{"sources":[]}', created_at: T0 + 5100 },
      { id: "fx-msg-0002", chat_session_id: IDS.chat, user_id: null, role: "assistant", content: "Synthetic fixture answer citing fx-source-0001.", metadata: JSON.stringify({ sources: [FIXTURE_CITATION_SOURCE], graphContext: null }), created_at: T0 + 5101 },
      { id: "fx-msg-0003", chat_session_id: IDS.chat, user_id: IDS.user1, role: "user", content: "Follow-up about the fixture.", metadata: '{"sources":[]}', created_at: T0 + 5102 },
      { id: "fx-msg-0004", chat_session_id: IDS.chat, user_id: null, role: "assistant", content: "Synthetic follow-up answer with late memory.", metadata: '{"sources":[]}', created_at: T0 + 5103 },
    ],
    app_settings: [
      { key: "appTitle", value: "Restore Fixture Chat", updated_at: T0 },
      { key: "logoFile", value: BRANDING_NAME, updated_at: T0 + 6000 },
      { key: "logoUpdatedAt", value: String(T0 + 6000), updated_at: T0 + 6000 },
    ],
  };
  return rows;
}

const EMPTY_TABLES = ["registrations", "password_reset_tokens", "usage_events"];
const ROW_TABLES = Object.keys(expectedRows());

// ---- seed -------------------------------------------------------------------

async function seed() {
  if (existsSync(dbPath)) fail(`seed refuses to overwrite an existing database: cortex-chat.db under ${targetDir}`);
  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    fail(`seed refuses a non-empty target directory: ${targetDir}`);
  }
  mkdirSync(avatarsDir, { recursive: true });
  mkdirSync(brandingDir, { recursive: true });

  const { sqlite } = openWritable(dbPath, { create: true });
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });

  const insert = (table, row) => {
    const cols = Object.keys(row);
    sqlite.prepare(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`
    ).run(...cols.map((c) => row[c]));
  };

  insert("api_keys", {
    id: IDS.readKey, backend_key_id: "fx-backend-key-0001",
    encrypted_value: encryptSecret(READ_KEY_PLAINTEXT), permission: "read",
    collection_ids: "[]", label: "Fixture group read key", created_at: T0,
  });
  insert("api_keys", {
    id: IDS.contentKey, backend_key_id: "fx-backend-key-0002",
    encrypted_value: encryptSecret(CONTENT_KEY_PLAINTEXT), permission: "manage",
    collection_ids: '["fx-collection-0001"]', label: "Fixture user content key",
    created_at: T0 + 1000,
  });
  for (const g of expectedRows().groups) insert("groups", g);
  insert("users", {
    id: IDS.user1, email: "fixture-user-0001@example.invalid",
    password_hash: "", username: "fixture-admin", avatar_path: AVATAR_NAME,
    role: "admin", group_id: IDS.group, content_key_id: IDS.contentKey,
    oidc_sub: null, oidc_issuer: null, created_at: T0, updated_at: T0,
    last_login_at: T0 + 5000,
  });
  insert("users", {
    id: IDS.user2, email: "fixture-user-0002@example.invalid",
    password_hash: "", username: "fixture-user", avatar_path: null,
    role: "user", group_id: IDS.group, content_key_id: null,
    oidc_sub: null, oidc_issuer: null, created_at: T0 + 10, updated_at: T0 + 10,
    last_login_at: null,
  });
  sqlite.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    await hashPassword(USER_PASSWORD), IDS.user1
  );
  sqlite.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    await hashPassword(USER_PASSWORD), IDS.user2
  );
  for (const s of expectedRows().sessions) insert("sessions", s);
  for (const e of expectedRows().login_events) insert("login_events", e);
  for (const a of expectedRows().assistants) insert("assistants", a);
  for (const p of expectedRows().projects) insert("projects", p);
  for (const s of expectedRows().project_shares) insert("project_shares", s);
  for (const c of expectedRows().chat_sessions) insert("chat_sessions", c);
  for (const m of expectedRows().chat_messages) insert("chat_messages", m);
  for (const s of expectedRows().app_settings) insert("app_settings", s);

  writeFileSync(join(avatarsDir, AVATAR_NAME), AVATAR_PNG);
  writeFileSync(join(brandingDir, BRANDING_NAME), BRANDING_PNG);

  checkpointAndClose(sqlite);

  writeFileSync(sentinelPath, JSON.stringify(expectedSentinel(), null, 2) + "\n");

  process.stdout.write(JSON.stringify({
    ok: true, mode: "seed", dbPath: "cortex-chat.db",
    sentinel: SENTINEL_NAME, quiesced: !existsSync(dbPath + "-wal") && !existsSync(dbPath + "-shm"),
  }) + "\n");
}

// ---- verify -----------------------------------------------------------------

// The sentinel is metadata the script DECLARES; it is validated against these
// fixed expectations and is never used as the oracle (assets/digests come from
// EXPECTED_ASSETS above, IDs/paths from the constants).
function expectedSentinel() {
  return {
    kind: "cortex-chat-restore-fixture",
    fixtureVersion: FIXTURE_VERSION,
    dbPath: "cortex-chat.db",
    ids: IDS,
    keyFingerprint: KEY_FINGERPRINT,
    keyNote: "synthetic 32-byte key hardcoded in scripts/restore-fixture.mjs — NOT a secret",
    passwordNote: "synthetic fixture password, argon2id-digested via src/lib/auth/password.ts",
    assets: EXPECTED_ASSETS,
  };
}

// Structural equality (key-order independent) for sentinel validation.
function structurallyEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => structurallyEqual(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => structurallyEqual(a[k], b[k]));
}

function readSentinel() {
  if (!existsSync(sentinelPath)) fail(`sentinel missing: ${SENTINEL_NAME} (run seed first)`);
  let sentinel;
  try {
    sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
  } catch (e) {
    fail(`sentinel unreadable: ${e.message}`);
  }
  if (sentinel.kind !== "cortex-chat-restore-fixture" || sentinel.fixtureVersion !== FIXTURE_VERSION) {
    fail("sentinel kind/version mismatch — not a fixture of this version");
  }
  if (sentinel.keyFingerprint !== KEY_FINGERPRINT) {
    fail("sentinel key fingerprint does not match this script's synthetic key");
  }
  if (!existsSync(dbPath)) fail(`fixture database missing: cortex-chat.db`);
  return sentinel;
}

// The sentinel content itself must equal the fixed expectation — an edited
// sentinel (forged digest, removed/added asset entry, changed IDs/dbPath)
// must never relax what verify checks.
function sentinelMatchesExpectation(sentinel) {
  return structurallyEqual(sentinel, expectedSentinel());
}

function missingFixtureIds(sqlite) {
  const missing = [];
  const present = (sql, ...params) => sqlite.prepare(sql).get(...params) !== undefined;
  if (!present("SELECT id FROM users WHERE id = ?", IDS.user1)) missing.push(IDS.user1);
  if (!present("SELECT id FROM users WHERE id = ?", IDS.user2)) missing.push(IDS.user2);
  if (!present("SELECT id FROM groups WHERE id = ?", IDS.group)) missing.push(IDS.group);
  if (!present("SELECT id FROM api_keys WHERE id = ?", IDS.readKey)) missing.push(IDS.readKey);
  if (!present("SELECT id FROM api_keys WHERE id = ?", IDS.contentKey)) missing.push(IDS.contentKey);
  if (!present("SELECT id FROM chat_sessions WHERE id = ?", IDS.chat)) missing.push(IDS.chat);
  for (const id of IDS.messages) {
    if (!present("SELECT id FROM chat_messages WHERE id = ?", id)) missing.push(id);
  }
  return missing;
}

async function verify() {
  const sentinel = readSentinel();
  const failures = [];
  let rowCount = 0;

  // The sentinel content must equal the fixed expectation — a target-supplied
  // (potentially forged) sentinel is metadata, never the oracle.
  if (!sentinelMatchesExpectation(sentinel)) {
    failures.push(
      `sentinel: content does not match the fixed fixture expectations (forged/edited sentinel rejected); expected ${JSON.stringify(expectedSentinel())}`
    );
  }

  // Quiesce gate: a WAL/SHM next to the DB before the read-only open means
  // the source was captured mid-write or is not the quiesced baseline —
  // refuse to bless it (and leave those files in place for forensics).
  const preExistingSidecars = new Set(
    ["-wal", "-shm"].filter((s) => existsSync(dbPath + s))
  );
  for (const s of preExistingSidecars) {
    failures.push(`quiesce(cortex-chat.db${s}): journal file present — fixture/restored set is not quiesced`);
  }

  let sqlite;
  try {
    sqlite = openReadonly(dbPath); // never writes/checkpoints the artifact
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, mode: "verify", failures: [`internal: cannot open database read-only: ${err.message}`] }) + "\n");
    process.exit(1);
  }

  try {
    // Synthetic identity gate: missing fixture IDs are verify FAILURES (JSON),
    // not refusals — detecting them is verify's job. mutate refuses instead.
    const missing = missingFixtureIds(sqlite);
    if (missing.length > 0) {
      failures.push(`fixture(ids): expected synthetic IDs missing from the database: ${missing.join(", ")}`);
    }

    // 0. Unknown tables: the schema set is fixed — any table outside the
    //    expected application tables + Drizzle journal fails (the main
    //    harness's full SQLite diff stays independent; this keeps the helper
    //    self-sufficient against unexpected tables).
    const EXPECTED_TABLES = new Set([
      ...Object.keys(EXPECTED_COLUMNS),
      "__drizzle_migrations",
    ]);
    const actualTables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    for (const t of actualTables) {
      if (!EXPECTED_TABLES.has(t)) {
        failures.push(`schema(tables): unexpected table "${t}" — not part of the frozen baseline schema`);
      }
    }
    for (const t of EXPECTED_TABLES) {
      if (!actualTables.includes(t)) {
        failures.push(`schema(tables): expected table "${t}" missing`);
      }
    }

    // 1. Schema: exact column names per table + real migration journal count.
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
      const actual = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (JSON.stringify(actual) !== JSON.stringify(cols)) {
        failures.push(`schema(${table}): columns ${JSON.stringify(actual)} != expected ${JSON.stringify(cols)}`);
      }
    }
    const journal = sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get();
    if (journal.n !== MIGRATION_COUNT) {
      failures.push(`schema(__drizzle_migrations): ${journal.n} entries, expected ${MIGRATION_COUNT}`);
    }

    // 2. Rows: exact logical content — every seeded table must match the fixed
    //    baseline row-for-row (extra or stale rows fail); encrypted values are
    //    validated by decrypting with the real module; password digests by
    //    verifying with the real module.
    const expected = expectedRows();
    for (const table of ROW_TABLES) {
      if (!actualTables.includes(table)) continue; // already failed above
      const actual = sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      const exp = expected[table];
      rowCount += actual.length;
      if (actual.length !== exp.length) {
        failures.push(`rows(${table}): ${actual.length} row(s), expected exactly ${exp.length}`);
      }
      for (let i = 0; i < Math.max(actual.length, exp.length); i++) {
        const a = actual[i];
        const e = exp[i];
        if (!a) {
          // Missing expected row is covered by the count failure; nothing to compare.
          continue;
        }
        if (!e) {
          failures.push(`rows(${table}): unexpected extra row ${JSON.stringify(a)} — not part of the frozen baseline`);
          continue;
        }
        const aCmp = { ...a };
        const eCmp = { ...e };
        if (table === "api_keys") {
          const expectedPlain = a.id === IDS.readKey ? READ_KEY_PLAINTEXT : CONTENT_KEY_PLAINTEXT;
          let decrypted;
          try {
            decrypted = decryptSecret(a.encrypted_value);
          } catch (err) {
            failures.push(`key(${a.id}): decryption failed (${err.message}) — encrypted_value is not recoverable with the fixture key`);
          }
          if (decrypted !== undefined && decrypted !== expectedPlain) {
            failures.push(`key(${a.id}): decrypted value ${JSON.stringify(decrypted)} != expected ${JSON.stringify(expectedPlain)}`);
          }
          delete aCmp.encrypted_value;
          delete eCmp.encrypted_value;
        }
        if (table === "users") {
          const digestOk = await verifyPassword(a.password_hash, USER_PASSWORD);
          if (!digestOk) {
            failures.push(`password(${a.id}): stored digest does not verify the fixture password`);
          }
          if (!String(a.password_hash).startsWith("$argon2id$")) {
            failures.push(`password(${a.id}): digest is not argon2id PHC`);
          }
          delete aCmp.password_hash;
          delete eCmp.password_hash;
        }
        const keys = new Set([...Object.keys(aCmp), ...Object.keys(eCmp)]);
        for (const k of keys) {
          if (!deepEqual(aCmp[k], eCmp[k])) {
            failures.push(`rows(${table})[${a.id ?? a.key ?? i}].${k}: ${JSON.stringify(aCmp[k])} != expected ${JSON.stringify(eCmp[k])}`);
          }
        }
      }
    }
    for (const table of EMPTY_TABLES) {
      if (!actualTables.includes(table)) continue; // already failed above
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
      if (rows.length !== 0) {
        failures.push(`rows(${table}): ${rows.length} unexpected row(s) ${JSON.stringify(rows)} — table must be empty in the frozen baseline (stale/canary rows present)`);
      }
    }

    // 2b. Citation pack v2: the restored citation in fx-msg-0002's metadata
    //     must carry the full public-Source shape (src/types/index.ts) with
    //     content excerpted verbatim from the authoritative document text.
    const citeRow = sqlite
      .prepare("SELECT metadata FROM chat_messages WHERE id = 'fx-msg-0002'")
      .get();
    let citeFailures = [];
    try {
      const cite = JSON.parse(citeRow.metadata).sources?.[0];
      if (!cite || cite.document_id !== FIXTURE_DOCUMENT_ID) {
        citeFailures.push(`document_id ${cite?.document_id} != ${FIXTURE_DOCUMENT_ID}`);
      }
      if (cite?.chunk_id !== `${FIXTURE_DOCUMENT_ID}-chunk-0`) {
        citeFailures.push(`chunk_id ${cite?.chunk_id} != ${FIXTURE_DOCUMENT_ID}-chunk-0`);
      }
      if (typeof cite?.score !== "number") citeFailures.push("score is not numeric");
      if (cite?.content !== FIXTURE_DOCUMENT_TEXT) citeFailures.push("content is not the accepted producer text verbatim");
      if (cite?.metadata?.filename !== FIXTURE_SOURCE_FILENAME) {
        citeFailures.push(`metadata.filename ${cite?.metadata?.filename} != ${FIXTURE_SOURCE_FILENAME}`);
      }
      if (cite?.sid !== "fx-source-0001") citeFailures.push(`sid ${cite?.sid} != fx-source-0001`);
    } catch (err) {
      citeFailures.push(`metadata unreadable: ${err.message}`);
    }
    for (const f of citeFailures) {
      failures.push(`citation(fx-msg-0002): ${f}`);
    }

    // 3. No absolute path references: the fixture must remap to any location.
    for (const table of [...ROW_TABLES, ...EMPTY_TABLES]) {
      if (!actualTables.includes(table)) continue; // already failed above
      for (const row of sqlite.prepare(`SELECT * FROM ${table}`).all()) {
        for (const [col, value] of Object.entries(row)) {
          if (typeof value === "string" && value.includes(targetDir)) {
            failures.push(`paths(${table}.${col}): absolute reference to the fixture directory found — references must be relative`);
          }
        }
      }
    }

    // 4. Assets: FIXED oracle from the hardcoded constants — exact file sets
    //    + SHA-256 bytes (extra canary blobs, corrupted bytes fail). The
    //    sentinel's declared digests are validated separately above and are
    //    never consulted here.
    const expectedByDir = new Map();
    for (const asset of EXPECTED_ASSETS) {
      const abs = join(targetDir, asset.path);
      if (!existsSync(abs)) {
        failures.push(`asset(${asset.path}): missing (fixed baseline expectation)`);
        continue;
      }
      const digest = sha256Hex(readFileSync(abs));
      if (digest !== asset.sha256) {
        failures.push(`asset(${asset.path}): sha256 ${digest} != expected ${asset.sha256} (corrupted bytes)`);
      }
      const dir = dirname(asset.path);
      if (!expectedByDir.has(dir)) expectedByDir.set(dir, new Set());
      expectedByDir.get(dir).add(asset.path.split("/").pop());
    }
    for (const [dir, expectedNames] of expectedByDir) {
      const absDir = join(targetDir, dir);
      if (!existsSync(absDir)) {
        failures.push(`asset(${dir}/): directory missing`);
        continue;
      }
      for (const f of readdirSync(absDir)) {
        if (!expectedNames.has(f)) {
          failures.push(`asset(${dir}/${f}): unexpected extra file in the frozen baseline`);
        }
      }
    }
  } catch (err) {
    try { sqlite.close(); } catch { /* best effort */ }
    process.stdout.write(JSON.stringify({ ok: false, mode: "verify", failures: [`internal: ${err.message}`] }) + "\n");
    process.exit(1);
  }

  // Verification must not leave journal files in the artifact it judged:
  // SQLite's read-only opens create empty transient sidecars for a WAL-mode
  // database; anything verify itself created is removed. Only files that
  // existed before (already failed the quiesce gate) are left untouched.
  sqlite.close();
  for (const s of ["-wal", "-shm"]) {
    if (existsSync(dbPath + s) && !preExistingSidecars.has(s)) {
      try {
        rmSync(dbPath + s, { force: true });
      } catch (err) {
        failures.push(`quiesce(verify): could not remove transient cortex-chat.db${s}: ${err.message}`);
      }
    }
  }

  process.stdout.write(JSON.stringify({
    ok: failures.length === 0, mode: "verify", failures,
    checked: { schema: Object.keys(EXPECTED_COLUMNS).length + 1, rows: rowCount, tables: ROW_TABLES.length + EMPTY_TABLES.length },
  }) + "\n");
  process.exit(failures.length === 0 ? 0 : 1);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- mutate -----------------------------------------------------------------

function mutate() {
  const sentinel = readSentinel();
  if (!sentinelMatchesExpectation(sentinel)) {
    fail("sentinel content does not match the fixed fixture expectations — refusing to mutate a tampered fixture");
  }
  const { sqlite } = openWritable(dbPath);
  const missing = missingFixtureIds(sqlite);
  if (missing.length > 0) {
    sqlite.close();
    fail(`expected synthetic IDs missing from the database: ${missing.join(", ")}`);
  }
  // Gate passed — append post-snapshot canaries, preserving all fixture IDs.
  sqlite.prepare(
    "INSERT INTO chat_messages (id, chat_session_id, user_id, role, content, metadata, created_at) VALUES (?, ?, ?, 'user', ?, '{}', ?)"
  ).run(CANARY_MESSAGE_ID, IDS.chat, IDS.user1, "Canary message written after the snapshot.", T0 + 86400000);
  sqlite.prepare("UPDATE chat_sessions SET memory = ?, updated_at = ? WHERE id = ?")
    .run(CANARY_MEMORY_BLOB, T0 + 86400001, IDS.chat);
  sqlite.prepare(
    "INSERT INTO usage_events (id, user_id, kind, collection_id, metadata, created_at) VALUES (?, ?, 'message', NULL, '{\"canary\":true}', ?)"
  ).run(CANARY_USAGE_ID, IDS.user1, T0 + 86400002);
  mkdirSync(avatarsDir, { recursive: true });
  writeFileSync(join(avatarsDir, CANARY_AVATAR_NAME), CANARY_BLOB);
  checkpointAndClose(sqlite);
  process.stdout.write(JSON.stringify({
    ok: true, mode: "mutate",
    canaries: { message: CANARY_MESSAGE_ID, usage: CANARY_USAGE_ID, memory: "chat_sessions.memory mutated", asset: `avatars/${CANARY_AVATAR_NAME}` },
  }) + "\n");
}

// ---- dispatch ---------------------------------------------------------------

const mode = process.argv[2];
if (mode === "seed") await seed();
else if (mode === "verify") await verify();
else if (mode === "mutate") mutate();
else {
  process.stderr.write(USAGE + "\n");
  process.exit(2);
}
