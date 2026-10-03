import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Deterministic SQLite state-ownership contracts, exercised on throwaway
// file-backed databases in the OS temp dir (never ./data). The real Drizzle
// migrator applies the repository's actual migration journal — the same
// machinery the runtime uses on server start.

const MIGRATIONS_FOLDER = resolve(process.cwd(), "src/lib/db/migrations");
let workDir: string;

before(() => {
  workDir = mkdtempSync(join(tmpdir(), "cortex-chat-contracts-"));
});

after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // temp cleanup is best-effort
  }
});

function openMigratedDb(name: string, migrationsFolder: string = MIGRATIONS_FOLDER) {
  const dbPath = join(workDir, name);
  const sqlite = new Database(dbPath);
  // Same pragmas as src/lib/db/client.ts — the app's connection contract.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });
  return { sqlite, dbPath };
}

let dbPath: string;
let sqlite: Database.Database;

// better-sqlite3's .get() is typed `unknown`; tests read scalar columns.
function get1(sql: string, ...params: unknown[]): any {
  return sqlite.prepare(sql).get(...params);
}

before(() => {
  const opened = openMigratedDb("main.db");
  dbPath = opened.dbPath;
  sqlite = opened.sqlite;
});

// ---- Migration lifecycle & connection contract ----------------------------

test("connection contract: journal_mode is WAL and foreign_keys are enforced", () => {
  assert.equal(sqlite.pragma("journal_mode", { simple: true }), "wal");
  assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1);
});

test("the full migration journal (0000–0010) applies cleanly", () => {
  const rows = get1("SELECT COUNT(*) AS n FROM __drizzle_migrations");
  assert.equal(rows.n, 11);
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  const names = tables.map((t) => t.name);
  for (const expected of [
    "api_keys", "app_settings", "assistants", "chat_messages", "chat_sessions",
    "groups", "login_events", "password_reset_tokens", "projects",
    "project_shares", "registrations", "sessions", "usage_events", "users",
    "__drizzle_migrations",
  ]) {
    assert.ok(names.includes(expected), `missing table ${expected}`);
  }
});

test("re-running the migrator on an already-migrated DB applies nothing further", () => {
  const before = get1("SELECT COUNT(*) AS n FROM __drizzle_migrations").n;
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const after = get1("SELECT COUNT(*) AS n FROM __drizzle_migrations").n;
  assert.equal(after, before);
});

// ---- Historical column contracts (additive ALTERs) ------------------------

test("chat_sessions.memory is a nullable TEXT column (opaque blob, migration 0002)", () => {
  const col = (sqlite
    .prepare("PRAGMA table_info(chat_sessions)")
    .all() as any[]).find((c) => c.name === "memory");
  assert.ok(col, "memory column must exist");
  assert.equal(col.type, "TEXT");
  assert.equal(col.notnull, 0, "memory must stay nullable — turn 1 has no blob");
});

test("chat_sessions.pinned defaults to 0 (migration 0005); login_events.method defaults to 'password' (0010)", () => {
  const pinned = (sqlite.prepare("PRAGMA table_info(chat_sessions)").all() as any[]).find((c) => c.name === "pinned");
  assert.ok(pinned.dflt_value == 0, `pinned default must be 0, got ${pinned.dflt_value}`);
  const method = (sqlite.prepare("PRAGMA table_info(login_events)").all() as any[]).find((c) => c.name === "method");
  assert.equal(method.dflt_value, "'password'");
  assert.equal(method.notnull, 1);
});

test("historical rows adopt the additive defaults on insert without the new columns", () => {
  const userId = get1(
    "INSERT INTO users (id, email, password_hash, role) VALUES ('u-hist', 'historic@test.local', 'x', 'user') RETURNING id"
  ).id;
  const chatId = get1(
    "INSERT INTO chat_sessions (id, user_id, title) VALUES ('c-hist', ?, 'Historic') RETURNING id",
    userId
  ).id;
  const chat = get1("SELECT memory, pinned FROM chat_sessions WHERE id = ?", chatId);
  assert.equal(chat.memory, null, "no memory blob before the first turn");
  assert.equal(chat.pinned, 0, "old rows pin at 0");
  sqlite.prepare(
    "INSERT INTO login_events (id, email_attempted, success) VALUES ('le-hist', 'historic@test.local', 1)"
  ).run();
  const ev = get1("SELECT method FROM login_events WHERE email_attempted = 'historic@test.local'");
  assert.equal(ev.method, "password", "pre-OIDC rows are password logins");
});

// ---- FK action inventory & deletion behavior ------------------------------

test("fresh-schema FK inventory: the documented 19 foreign keys with their ON DELETE actions", () => {
  const tables = ["api_keys", "assistants", "chat_messages", "chat_sessions", "groups", "login_events",
    "password_reset_tokens", "projects", "project_shares", "sessions", "usage_events", "users"];
  const fks: { table: string; from: string; toTable: string; onDelete: string }[] = [];
  for (const t of tables) {
    for (const fk of sqlite.prepare(`PRAGMA foreign_key_list(${t})`).all() as any[]) {
      fks.push({ table: t, from: fk.from, toTable: fk.table, onDelete: fk.on_delete });
    }
  }
  assert.equal(fks.length, 19, "the FK set is a compatibility contract — changes need an explicit decision");

  const find = (table: string, from: string) => fks.find((f) => f.table === table && f.from === from)!;
  assert.equal(find("chat_messages", "chat_session_id").onDelete, "CASCADE");
  assert.equal(find("chat_sessions", "user_id").onDelete, "CASCADE");
  assert.equal(find("sessions", "user_id").onDelete, "CASCADE");
  assert.equal(find("login_events", "user_id").onDelete, "SET NULL");
  assert.equal(find("usage_events", "user_id").onDelete, "SET NULL");
  assert.equal(find("users", "group_id").onDelete, "SET NULL");
  assert.equal(find("users", "content_key_id").onDelete, "SET NULL");
  assert.equal(find("groups", "chat_key_id").onDelete, "SET NULL");
  // ALTER-added columns on the FRESH schema carry SET NULL — but older
  // deployments may not; the app never relies on it (see legacy fixture).
  assert.equal(find("chat_sessions", "project_id").onDelete, "SET NULL");
  assert.equal(find("chat_sessions", "assistant_id").onDelete, "SET NULL");
  assert.equal(find("chat_messages", "user_id").onDelete, "SET NULL");
});

test("deletion behavior: user delete cascades sessions/chats/messages but preserves login_events with NULLed user", () => {
  const s = sqlite;
  const userId = get1(
    "INSERT INTO users (id, email, password_hash, role) VALUES ('u-casc', 'cascade@test.local', 'x', 'user') RETURNING id"
  ).id;
  s.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES ('tok-s1', ?, ?)")
    .run(userId, Date.now() + 86_400_000);
  const chatId = get1(
    "INSERT INTO chat_sessions (id, user_id, title) VALUES ('c1', ?, 'T') RETURNING id",
    userId
  ).id;
  s.prepare("INSERT INTO chat_messages (id, chat_session_id, role, content) VALUES ('m1', ?, 'user', 'hi')").run(chatId);
  s.prepare("INSERT INTO login_events (id, user_id, email_attempted, success) VALUES ('le-casc', ?, 'cascade@test.local', 1)").run(userId);

  s.prepare("DELETE FROM users WHERE id = ?").run(userId);

  assert.equal(get1("SELECT COUNT(*) n FROM sessions WHERE user_id = ?", userId).n, 0);
  assert.equal(get1("SELECT COUNT(*) n FROM chat_sessions WHERE id = 'c1'").n, 0);
  assert.equal(get1("SELECT COUNT(*) n FROM chat_messages WHERE id = 'm1'").n, 0);
  const ev = get1("SELECT user_id FROM login_events WHERE email_attempted = 'cascade@test.local'");
  assert.ok(ev, "login event survives user deletion (audit trail)");
  assert.equal(ev.user_id, null);
});

test("deletion behavior on the FRESH schema: project delete SET NULLs chat_sessions.project_id and chats survive", () => {
  const s = sqlite;
  const userId = get1(
    "INSERT INTO users (id, email, password_hash, role) VALUES ('u-proj', 'proj@test.local', 'x', 'user') RETURNING id"
  ).id;
  const projId = get1(
    "INSERT INTO projects (id, owner_id, name) VALUES ('p1', ?, 'P') RETURNING id",
    userId
  ).id;
  s.prepare("INSERT INTO chat_sessions (id, user_id, title, project_id) VALUES ('c2', ?, 'T', ?)")
    .run(userId, projId);

  s.prepare("DELETE FROM projects WHERE id = 'p1'").run();

  const chat = get1("SELECT project_id FROM chat_sessions WHERE id = 'c2'");
  assert.ok(chat, "the chat itself must survive project deletion");
  assert.equal(chat.project_id, null, "fresh schema SET NULLs the reference");
});

// ---- Negative control: the legacy detach contract -------------------------
// The delete handlers detach chat_sessions.assistant_id/project_id EXPLICITLY
// because ALTER-added FK columns on older deployments may lack ON DELETE SET
// NULL. This fixture reconstructs such a legacy schema and proves that a
// bare project DELETE violates the FK, while the explicit-detach pattern
// (what the handlers do) succeeds.

test("negative control: without ON DELETE SET NULL (legacy schema), a bare project delete violates the FK; explicit detach succeeds", () => {
  // Build a temp migrations folder whose 0007 ALTER lacks ON DELETE SET NULL.
  const legacyFolder = join(workDir, "legacy-migrations");
  mkdirSync(join(legacyFolder, "meta"), { recursive: true });
  for (const f of ["0000_init.sql", "0001_app_settings.sql", "0002_mighty_living_mummy.sql",
    "0003_left_speed.sql", "0004_volatile_dexter_bennett.sql", "0005_absurd_may_parker.sql",
    "0006_dashing_synch.sql", "0007_secret_ghost_rider.sql", "0008_freezing_boom_boom.sql",
    "0009_naive_echo.sql", "0010_neat_moon_knight.sql"]) {
    copyFileSync(join(MIGRATIONS_FOLDER, f), join(legacyFolder, f));
  }
  copyFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), join(legacyFolder, "meta", "_journal.json"));

  const legacySqlPath = join(legacyFolder, "0007_secret_ghost_rider.sql");
  const legacySql = readFileSync(legacySqlPath, "utf8");
  const mutated = legacySql.replace(
    /ALTER TABLE `?chat_sessions`? ADD `?project_id`? text REFERENCES [^;]*? ON DELETE set null/i,
    (m) => m.replace(/ ON DELETE set null/i, "")
  );
  assert.notEqual(mutated, legacySql, "fixture must actually remove the SET NULL action");
  writeFileSync(legacySqlPath, mutated);

  const opened = openMigratedDb("legacy.db", legacyFolder);
  const s = opened.sqlite;
  const sget1 = (sql: string, ...params: unknown[]): any => s.prepare(sql).get(...params);
  const userId = sget1(
    "INSERT INTO users (id, email, password_hash, role) VALUES ('u-leg', 'legacy@test.local', 'x', 'user') RETURNING id"
  ).id;
  const projId = sget1(
    "INSERT INTO projects (id, owner_id, name) VALUES ('p1', ?, 'P') RETURNING id",
    userId
  ).id;
  s.prepare("INSERT INTO chat_sessions (id, user_id, title, project_id) VALUES ('c3', ?, 'T', ?)")
    .run(userId, projId);

  // Bare delete — what the code would break with if it relied on FK actions.
  assert.throws(
    () => s.prepare("DELETE FROM projects WHERE id = 'p1'").run(),
    /FOREIGN KEY constraint failed/,
    "legacy schema must reject the bare delete — this is why handlers detach explicitly"
  );

  // Explicit detach, then delete — the actual handler pattern.
  s.prepare("UPDATE chat_sessions SET project_id = NULL WHERE project_id = 'p1'").run();
  s.prepare("DELETE FROM projects WHERE id = 'p1'").run();
  const chat = s.prepare("SELECT project_id FROM chat_sessions WHERE id = 'c3'").get() as any;
  assert.ok(chat, "the chat survives");
  assert.equal(chat.project_id, null);
});
